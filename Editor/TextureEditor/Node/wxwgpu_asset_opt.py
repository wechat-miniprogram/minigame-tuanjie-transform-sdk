#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wxwgpu_asset_opt.py — 微信小游戏 WebGPU 资源包后处理工具（集成于 unity-wasm 转换插件）

支持两个独立且可正交叠加的优化开关：
  1. --zero-cost   （零运行时成本瘦身）：
       - Texture2D：全 Mip 级 ASTC LZ-RDO (--rdo-lambda 40) + 2D 单 mip 透明区有界扩色
       - Mesh     ：M1_12bit 原地 IEEE-754 FP32 尾数低 12-bit 舍入抹零
       - AnimClip ：A1_12bit 原地曲线 FP32 尾数低 12-bit 舍入抹零（保护索引与 NaN 哨兵）
  2. --compute-opt （WebGPU Compute 极速超压缩，需配合 libwxwgpu-adapter-emsdk-legacy.a）：
       - Mesh     ：原地封装为 [WXMSH2 192B 头 + AABB u16x3 / 八面体法线切线 / u16 UV 64顶点块差分平面 + 尾部置0]
                    IndexBuffer 原地封装为 [WXIDX2 32B 头 + 64索引块 zigzag 差分平面 + 尾部置0]
                    （自动检测 m_IsReadable 与 MeshCollider 引用，CPU 访问网格自动回退 M1_12bit）
       - Texture2D：原地封装为 [WXASTC 32B 头 + S3 sp_aos Top-3 常值块 2-bit 去重流 + 尾部置0]
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import math
import os
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import UnityPy
from UnityPy.enums import ClassIDType
from PIL import Image
from scipy.ndimage import distance_transform_edt

HERE = Path(__file__).resolve().parent

# Unity TextureFormat -> ASTC block size
ASTC_BLK = {
    48: 4, 49: 5, 50: 6, 51: 8, 52: 10, 53: 12,
    54: 4, 55: 5, 56: 6, 57: 8, 58: 10, 59: 12,
    66: 4, 67: 5, 68: 6, 69: 8, 70: 10, 71: 12,
}

MAGIC_WXMSH0 = 0x534D5857  # "WXMS"
MAGIC_WXMSH1 = 0x01003248  # "H2\0\x01"
MAGIC_WXIDX0 = 0x44495857  # "WXID"
MAGIC_WXIDX1 = 0x01003258  # "X2\0\x01"
MAGIC_WXASTC0 = 0x53415857  # "WXAS"
MAGIC_WXASTC1 = 0x01004354  # "TC\0\x01"

BLOCK_SIZE = 64


def fnv1a32(data: bytes) -> int:
    h = 0x811C9DC5
    for b in data:
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def ceil_div(a: int, b: int) -> int:
    return -(-int(a) // int(b))


def pad4(n: int) -> int:
    return (int(n) + 3) & ~3


def find_astcenc() -> str:
    candidates = [
        HERE / "astcenc-neon",
        HERE / "astcenc-avx2",
        HERE / "astcenc-avx2.exe",
        HERE / "astcenc-sse4.1.exe",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return "astcenc"


# ============================================================================
# TuanjieWebData1.0 / UnityWebData1.0 容器读写
# ============================================================================
def is_web_data_container(blob: bytes) -> bool:
    return blob.startswith(b"TuanjieWebData") or blob.startswith(b"UnityWebData")


def unpack_web_data(blob: bytes):
    sig_end = blob.index(b"\x00") + 1
    sig = blob[:sig_end]
    head_len = struct.unpack_from("<I", blob, sig_end)[0]
    pos = sig_end + 4
    entries = []
    while pos < head_len:
        off, size, nlen = struct.unpack_from("<III", blob, pos)
        pos += 12
        name = blob[pos:pos + nlen].decode("utf-8")
        pos += nlen
        entries.append((name, bytes(blob[off:off + size])))
    return sig, entries


def pack_web_data(sig: bytes, entries: list[tuple[str, bytes]]) -> bytes:
    header_meta = []
    head_len = len(sig) + 4
    for name, data in entries:
        nb = name.encode("utf-8")
        head_len += 12 + len(nb)
        header_meta.append((nb, data))
    out = bytearray(sig)
    out += struct.pack("<I", head_len)
    cur_off = head_len
    for nb, data in header_meta:
        out += struct.pack("<III", cur_off, len(data), len(nb)) + nb
        cur_off += len(data)
    for _, data in header_meta:
        out += data
    return bytes(out)


# ============================================================================
# IEEE-754 FP32 尾数 RTNE 抹零（M1 / A1 共用）
# ============================================================================
def round_mantissa_f32_words(u32_arr: np.ndarray, zero_bits: int) -> np.ndarray:
    if zero_bits <= 0:
        return u32_arr.copy()
    u = u32_arr.astype(np.uint32, copy=True)
    exp = (u >> np.uint32(23)) & np.uint32(0xFF)
    finite_nz = (exp != 0) & (exp != 0xFF)
    half = np.uint32(1 << (zero_bits - 1))
    mask = np.uint32(~((1 << zero_bits) - 1) & 0xFFFFFFFF)
    tie_bit = (u >> np.uint32(zero_bits)) & np.uint32(1)
    bias = half - np.uint32(1) + tie_bit
    rounded = (u + bias) & mask
    r_exp = (rounded >> np.uint32(23)) & np.uint32(0xFF)
    safe = finite_nz & (r_exp != 0xFF)
    return np.where(safe, rounded, u)


# ============================================================================
# Mesh 解析、M1_12bit 抹零 与 WXMSH2 / WXIDX2 编码（100% 对齐 ComputeAssetDecompressor.cpp）
# ============================================================================
def collect_collider_and_readable_meshes(env: UnityPy.Environment) -> set[int]:
    """收集被 MeshCollider 引用或标记为 m_IsReadable 的 Mesh PathID，避免破坏 CPU 物理碰撞。"""
    excluded: set[int] = set()
    for obj in env.objects:
        if obj.type == ClassIDType.MeshCollider:
            try:
                tt = obj.read_typetree(check_read=False)
                m_mesh = tt.get("m_Mesh")
                if isinstance(m_mesh, dict) and m_mesh.get("m_PathID"):
                    excluded.add(int(m_mesh["m_PathID"]))
            except Exception:
                pass
    return excluded


def parse_mesh_object(obj):
    raw = bytes(obj.get_raw_data())
    tt = obj.read_typetree(check_read=False)
    if int(tt.get("m_MeshCompression", 0)) != 0:
        return None
    if int(tt.get("m_IndexFormat", 0)) != 0:
        return None
    vdata = tt.get("m_VertexData", {})
    vcount = int(vdata.get("m_VertexCount", 0))
    channels = vdata.get("m_Channels", [])
    vd_raw = vdata.get("m_DataSize", b"")
    vd_bytes = bytes(vd_raw) if isinstance(vd_raw, (bytes, bytearray, memoryview)) else bytes(vd_raw)
    ib_raw = tt.get("m_IndexBuffer", b"")
    ib_bytes = bytes(ib_raw) if isinstance(ib_raw, (bytes, bytearray, memoryview)) else bytes(ib_raw)
    if vcount <= 0 or len(vd_bytes) == 0 or len(vd_bytes) % vcount != 0:
        return None
    stride = len(vd_bytes) // vcount
    if stride % 4 != 0:
        return None
    for ch in channels:
        if int(ch.get("dimension", 0)) > 0 and int(ch.get("stream", 0)) != 0:
            return None

    vd_off = raw.find(vd_bytes) if len(vd_bytes) >= 32 else -1
    ib_off = raw.find(ib_bytes) if len(ib_bytes) >= 32 else -1
    if vd_off < 0:
        return None

    return {
        "path_id": obj.path_id,
        "name": tt.get("m_Name", ""),
        "is_readable": bool(tt.get("m_IsReadable", False)),
        "raw": raw,
        "vcount": vcount,
        "stride": stride,
        "channels": channels,
        "vd": vd_bytes,
        "vd_off": vd_off,
        "ib": ib_bytes,
        "ib_off": ib_off,
    }


def apply_mesh_m1_12bit(vd_bytes: bytes, vcount: int, stride: int, channels: list) -> bytes:
    buf = bytearray(vd_bytes)
    words = np.frombuffer(buf, dtype="<u4").reshape(vcount, stride // 4).copy()
    for ch in channels:
        dim = int(ch.get("dimension", 0)) & 0xF
        fmt = int(ch.get("format", 0))
        off = int(ch.get("offset", 0))
        if dim > 0 and fmt == 0 and off % 4 == 0:
            w0 = off // 4
            words[:, w0:w0 + dim] = round_mantissa_f32_words(words[:, w0:w0 + dim], 12)
    return words.tobytes()


def oct_encode_snorm8x2(vec3_arr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    v = vec3_arr.astype(np.float32)
    norm = np.linalg.norm(v, axis=1, keepdims=True)
    v = np.where(norm > 1e-12, v / np.maximum(norm, 1e-12), np.array([0.0, 0.0, 1.0], dtype=np.float32))
    l1 = np.maximum(np.abs(v[:, 0]) + np.abs(v[:, 1]) + np.abs(v[:, 2]), 1e-12)
    px = v[:, 0] / l1
    py = v[:, 1] / l1
    neg = v[:, 2] < 0.0
    if np.any(neg):
        sx = np.where(px >= 0.0, 1.0, -1.0)
        sy = np.where(py >= 0.0, 1.0, -1.0)
        nx = (1.0 - np.abs(py)) * sx
        ny = (1.0 - np.abs(px)) * sy
        px = np.where(neg, nx, px)
        py = np.where(neg, ny, py)
    qx = np.clip(np.rint(px * 127.0 + 128.0), 1, 255).astype(np.uint8)
    qy = np.clip(np.rint(py * 127.0 + 128.0), 1, 255).astype(np.uint8)
    return qx, qy


def oct_encode_snorm8_7_sign(tan4_arr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    t3 = tan4_arr[:, :3].astype(np.float32)
    norm = np.linalg.norm(t3, axis=1, keepdims=True)
    t3 = np.where(norm > 1e-12, t3 / np.maximum(norm, 1e-12), np.array([1.0, 0.0, 0.0], dtype=np.float32))
    l1 = np.maximum(np.abs(t3[:, 0]) + np.abs(t3[:, 1]) + np.abs(t3[:, 2]), 1e-12)
    px = t3[:, 0] / l1
    py = t3[:, 1] / l1
    neg = t3[:, 2] < 0.0
    if np.any(neg):
        sx = np.where(px >= 0.0, 1.0, -1.0)
        sy = np.where(py >= 0.0, 1.0, -1.0)
        nx = (1.0 - np.abs(py)) * sx
        ny = (1.0 - np.abs(px)) * sy
        px = np.where(neg, nx, px)
        py = np.where(neg, ny, py)
    tx = np.clip(np.rint(px * 127.0 + 128.0), 1, 255).astype(np.uint8)
    ty7 = np.clip(np.rint(py * 63.0 + 64.0), 1, 127).astype(np.uint8)
    w_neg = (tan4_arr[:, 3] < 0.0).astype(np.uint8) << 7
    return tx, (ty7 & 0x7F) | w_neg


def block_delta_u16_planes(q_u16: np.ndarray) -> tuple[bytes, bytes]:
    n = len(q_u16)
    out = q_u16.astype(np.uint16, copy=True)
    for s in range(0, n, BLOCK_SIZE):
        e = min(s + BLOCK_SIZE, n)
        if e - s > 1:
            out[s + 1:e] = (q_u16[s + 1:e].astype(np.int32) - q_u16[s:e - 1].astype(np.int32)) & 0xFFFF
    lo = (out & 0xFF).astype(np.uint8).tobytes()
    hi = ((out >> 8) & 0xFF).astype(np.uint8).tobytes()
    return lo, hi


def block_delta_u32_planes(q_u32: np.ndarray) -> tuple[bytes, bytes, bytes, bytes]:
    n = len(q_u32)
    out = q_u32.astype(np.uint32, copy=True)
    for s in range(0, n, BLOCK_SIZE):
        e = min(s + BLOCK_SIZE, n)
        if e - s > 1:
            out[s + 1:e] = (q_u32[s + 1:e].astype(np.int64) - q_u32[s:e - 1].astype(np.int64)) & 0xFFFFFFFF
    b0 = (out & 0xFF).astype(np.uint8).tobytes()
    b1 = ((out >> 8) & 0xFF).astype(np.uint8).tobytes()
    b2 = ((out >> 16) & 0xFF).astype(np.uint8).tobytes()
    b3 = ((out >> 24) & 0xFF).astype(np.uint8).tobytes()
    return b0, b1, b2, b3


def encode_wxmsh2_inplace(mesh_info: dict) -> bytes | None:
    """将 m_VertexData 编码为原地等长的 [WXMSH2 192B 头 + 平面数据 + 尾部 0x00]。"""
    vd = mesh_info["vd"]
    raw_len = len(vd)
    vcount = mesh_info["vcount"]
    stride = mesh_info["stride"]
    stride_words = stride // 4
    if raw_len < 512 or vcount < 8:
        return None

    ch_map = {}
    for idx, ch in enumerate(mesh_info["channels"]):
        dim = int(ch.get("dimension", 0)) & 0xF
        if dim == 0:
            continue
        fmt = int(ch.get("format", 0))
        off = int(ch.get("offset", 0))
        if off % 4 != 0:
            return None
        # 仅支持标准 Position(0), Normal(1), Tangent(2), Color(3), UV0(4), UV1(5)
        if idx not in (0, 1, 2, 3, 4, 5):
            return None
        if idx == 3 and not (fmt == 2 and dim == 4):
            return None
        if idx in (0, 1) and not (fmt == 0 and dim == 3):
            return None
        if idx == 2 and not (fmt == 0 and dim == 4):
            return None
        if idx in (4, 5) and not (fmt == 0 and dim == 2):
            return None
        ch_map[idx] = off // 4

    if 0 not in ch_map:
        return None

    words_f32 = np.frombuffer(vd, dtype="<f4").reshape(vcount, stride_words)
    words_u32 = np.frombuffer(vd, dtype="<u4").reshape(vcount, stride_words)

    planes_blob = bytearray()
    plane_bases = [0] * 22
    header_words = 48  # 192 bytes

    def add_plane(slot: int, pbytes: bytes):
        while len(planes_blob) % 4 != 0:
            planes_blob.append(0)
        plane_bases[slot] = header_words + (len(planes_blob) // 4)
        planes_blob.extend(pbytes)
        while len(planes_blob) % 4 != 0:
            planes_blob.append(0)

    # 1. Position (ch 0)
    pos_off = ch_map[0]
    pos = words_f32[:, pos_off:pos_off + 3]
    if not np.all(np.isfinite(pos)):
        return None
    pmin = pos.min(axis=0).astype(np.float32)
    pmax = pos.max(axis=0).astype(np.float32)
    pspan = np.maximum(pmax - pmin, np.float32(1e-12))
    pscale = (pspan / np.float32(65535.0)).astype(np.float32)
    for j in range(3):
        if float(pmax[j] - pmin[j]) < 1e-12:
            q = np.zeros(vcount, dtype=np.uint16)
            pscale[j] = np.float32(0.0)
        else:
            q = np.clip(np.rint((pos[:, j] - pmin[j]) / pscale[j]), 0, 65535).astype(np.uint16)
        lo, hi = block_delta_u16_planes(q)
        add_plane(j * 2, lo)
        add_plane(j * 2 + 1, hi)

    flags = 0
    nrm_off = ch_map.get(1, 0)
    tan_off = ch_map.get(2, 0)
    col_off = ch_map.get(3, 0)
    uv0_off = ch_map.get(4, 0)
    uv1_off = ch_map.get(5, 0)

    # 2. Normal + Tangent (planes 6..9)
    if 1 in ch_map or 2 in ch_map:
        if 1 in ch_map:
            flags |= 1
            nrm = words_f32[:, nrm_off:nrm_off + 3]
            if not np.all(np.isfinite(nrm)):
                return None
            nx, ny = oct_encode_snorm8x2(nrm)
        else:
            nx = np.zeros(vcount, dtype=np.uint8)
            ny = np.zeros(vcount, dtype=np.uint8)

        if 2 in ch_map:
            flags |= 2
            tan = words_f32[:, tan_off:tan_off + 4]
            if not np.all(np.isfinite(tan)):
                return None
            tx, ty = oct_encode_snorm8_7_sign(tan)
        else:
            tx = np.zeros(vcount, dtype=np.uint8)
            ty = np.zeros(vcount, dtype=np.uint8)

        nt_u32 = (nx.astype(np.uint32)
                  | (ny.astype(np.uint32) << 8)
                  | (tx.astype(np.uint32) << 16)
                  | (ty.astype(np.uint32) << 24))
        b0, b1, b2, b3 = block_delta_u32_planes(nt_u32)
        add_plane(6, b0)
        add_plane(7, b1)
        if 2 in ch_map:
            add_plane(8, b2)
            add_plane(9, b3)

    # 3. Color (planes 18..21)
    if 3 in ch_map:
        flags |= 4
        col_u32 = words_u32[:, col_off]
        c0, c1, c2, c3 = block_delta_u32_planes(col_u32)
        add_plane(18, c0)
        add_plane(19, c1)
        add_plane(20, c2)
        add_plane(21, c3)

    # 4. UV0 (planes 10..13) & UV1 (planes 14..17)
    uv0_min = np.zeros(2, dtype=np.float32)
    uv0_scale = np.zeros(2, dtype=np.float32)
    if 4 in ch_map:
        flags |= 8
        uv0 = words_f32[:, uv0_off:uv0_off + 2]
        if not np.all(np.isfinite(uv0)):
            return None
        uv0_min = uv0.min(axis=0).astype(np.float32)
        uv0_max = uv0.max(axis=0).astype(np.float32)
        for c in range(2):
            span = float(uv0_max[c] - uv0_min[c])
            if span < 1e-12:
                q = np.zeros(vcount, dtype=np.uint16)
                uv0_scale[c] = np.float32(0.0)
            else:
                uv0_scale[c] = np.float32(span / 65535.0)
                q = np.clip(np.rint((uv0[:, c] - uv0_min[c]) / uv0_scale[c]), 0, 65535).astype(np.uint16)
            lo, hi = block_delta_u16_planes(q)
            add_plane(10 + c * 2, lo)
            add_plane(10 + c * 2 + 1, hi)

    uv1_min = np.zeros(2, dtype=np.float32)
    uv1_scale = np.zeros(2, dtype=np.float32)
    if 5 in ch_map:
        flags |= 16
        uv1 = words_f32[:, uv1_off:uv1_off + 2]
        if not np.all(np.isfinite(uv1)):
            return None
        uv1_min = uv1.min(axis=0).astype(np.float32)
        uv1_max = uv1.max(axis=0).astype(np.float32)
        for c in range(2):
            span = float(uv1_max[c] - uv1_min[c])
            if span < 1e-12:
                q = np.zeros(vcount, dtype=np.uint16)
                uv1_scale[c] = np.float32(0.0)
            else:
                uv1_scale[c] = np.float32(span / 65535.0)
                q = np.clip(np.rint((uv1[:, c] - uv1_min[c]) / uv1_scale[c]), 0, 65535).astype(np.uint16)
            lo, hi = block_delta_u16_planes(q)
            add_plane(14 + c * 2, lo)
            add_plane(14 + c * 2 + 1, hi)

    comp_size = header_words * 4 + len(planes_blob)
    if comp_size + 64 >= raw_len:
        return None

    offs0 = (pos_off & 0xFF) | ((nrm_off & 0xFF) << 8) | ((tan_off & 0xFF) << 16) | ((col_off & 0xFF) << 24)
    offs1 = (uv0_off & 0xFF) | ((uv1_off & 0xFF) << 8)
    prefix9 = struct.pack("<9I",
                          MAGIC_WXMSH0, MAGIC_WXMSH1,
                          raw_len, comp_size,
                          vcount, stride_words,
                          flags, offs0, offs1)
    checksum = fnv1a32(prefix9)

    floats14 = struct.pack("<14f",
                           float(pmin[0]), float(pmin[1]), float(pmin[2]),
                           float(pscale[0]), float(pscale[1]), float(pscale[2]),
                           float(uv0_min[0]), float(uv0_min[1]), float(uv0_scale[0]), float(uv0_scale[1]),
                           float(uv1_min[0]), float(uv1_min[1]), float(uv1_scale[0]), float(uv1_scale[1]))
    bases24 = struct.pack("<22I2I", *plane_bases, 0, 0)

    header = prefix9 + struct.pack("<I", checksum) + floats14 + bases24
    assert len(header) == 192

    out = bytearray(raw_len)
    out[:192] = header
    out[192:comp_size] = planes_blob
    return bytes(out)


def encode_wxidx2_inplace(ib_bytes: bytes) -> bytes | None:
    """将 UInt16 m_IndexBuffer 编码为原地等长的 [WXIDX2 32B 头 + 块首 u16 种子 + 8-bit zigzag 差分平面 + 尾部 0x00]。"""
    raw_len = len(ib_bytes)
    if raw_len < 256 or raw_len % 2 != 0:
        return None
    icount = raw_len // 2
    idx = np.frombuffer(ib_bytes, dtype="<u2")
    wg_count = ceil_div(icount, BLOCK_SIZE)
    seeds = np.zeros(pad4(wg_count * 2) // 2, dtype="<u2")
    lo = np.zeros(pad4(icount), dtype=np.uint8)

    for wg in range(wg_count):
        s = wg * BLOCK_SIZE
        e = min(s + BLOCK_SIZE, icount)
        seeds[wg] = idx[s]
        if e - s > 1:
            d = (idx[s + 1:e].astype(np.int32) - idx[s:e - 1].astype(np.int32)).astype(np.int16)
            zz = ((d.astype(np.int32) << 1) ^ (d >> 15)) & 0xFFFF
            if np.any(zz > 0xFF):
                return None
            lo[s + 1:e] = zz.astype(np.uint8)

    seeds_bytes = seeds.tobytes()
    lo_bytes = lo.tobytes()
    seeds_word_off = 8
    lo_word_off = 8 + (len(seeds_bytes) // 4)
    comp_size = 32 + len(seeds_bytes) + len(lo_bytes)
    if comp_size + 32 >= raw_len:
        return None

    prefix7 = struct.pack("<7I",
                          MAGIC_WXIDX0, MAGIC_WXIDX1,
                          raw_len, comp_size,
                          icount, seeds_word_off, lo_word_off)
    checksum = fnv1a32(prefix7)
    header = prefix7 + struct.pack("<I", checksum)

    out = bytearray(raw_len)
    out[:32] = header
    out[32:32 + len(seeds_bytes)] = seeds_bytes
    out[32 + len(seeds_bytes):comp_size] = lo_bytes
    return bytes(out)


# ============================================================================
# ASTC S3 sp_aos 无损块去重编码（WXASTC）与 RDO40
# ============================================================================
def encode_wxastc_mip_inplace(mip_bytes: bytes, bx: int, by: int) -> bytes | None:
    """将单个 ASTC mip 的 16B 块流编码为原地等长的 [WXASTC 32B 头 + S3 流 + 尾部 0x00]。"""
    tight_len = len(mip_bytes)
    total_blocks = bx * by
    if tight_len != total_blocks * 16 or tight_len < 512:
        return None

    blocks = np.frombuffer(mip_bytes, dtype=np.uint8).reshape(total_blocks, 16)
    dt = np.dtype((np.void, 16))
    v = np.ascontiguousarray(blocks).view(dt).reshape(-1)
    u, inv, cnt = np.unique(v, return_inverse=True, return_counts=True)
    order = np.argsort(-cnt, kind="stable")

    # 若 Top-3 常值块占比不足 18%，S3 去重无法抵消 2-bit 掩码 + 偏移表开销，保持原 ASTC 块
    top3_blocks = int(cnt[order[:3]].sum())
    if top3_blocks < total_blocks * 0.18:
        return None

    pal = np.zeros((3, 16), dtype=np.uint8)
    k = min(3, len(order))
    pal[:k] = u[order[:k]].view(np.uint8).reshape(k, 16)

    rank_of_u = np.full(len(u), 3, dtype=np.uint8)
    for rank in range(k):
        rank_of_u[order[rank]] = rank
    tags = rank_of_u[inv]  # 0/1/2 = Top-3 常值块, 3 = 活跃块

    tag_words_count = ceil_div(total_blocks, 16)
    padded_tags = np.zeros(tag_words_count * 16, dtype=np.uint8)
    padded_tags[:total_blocks] = tags
    t16 = padded_tags.reshape(tag_words_count, 16).astype(np.uint32)
    shifts = (np.arange(16, dtype=np.uint32) * 2)[None, :]
    tag_words = np.bitwise_or.reduce(t16 << shifts, axis=1).astype("<u4")

    wg_count = ceil_div(total_blocks, 64)
    is_lit = (tags == 3).astype(np.int32)
    wg_Bases = np.zeros(wg_count, dtype="<u4")
    running = 0
    for wg in range(wg_count):
        wg_Bases[wg] = running
        s = wg * 64
        e = min(s + 64, total_blocks)
        running += int(is_lit[s:e].sum())

    active_blocks = np.ascontiguousarray(blocks[tags == 3])
    payload_body = (
        pal.tobytes()
        + tag_words.tobytes()
        + wg_Bases.tobytes()
        + active_blocks.tobytes()
    )
    comp_size = 32 + len(payload_body)
    if comp_size + 64 >= tight_len:
        return None

    bxy = (bx & 0xFFFF) | ((by & 0xFFFF) << 16)
    prefix7 = struct.pack("<7I",
                          MAGIC_WXASTC0, MAGIC_WXASTC1,
                          tight_len, comp_size,
                          bxy, 0, tag_words_count)
    checksum = fnv1a32(prefix7)
    header = prefix7 + struct.pack("<I", checksum)

    out = bytearray(tight_len)
    out[:32] = header
    out[32:comp_size] = payload_body
    return bytes(out)


def dilate_alpha_bounded(rgba: np.ndarray, radius: int = 6) -> np.ndarray:
    a = rgba[:, :, 3]
    mask = a > 0
    if mask.all() or (~mask).all():
        return rgba
    dist, idx = distance_transform_edt(~mask, return_indices=True)
    out = rgba.copy()
    near = (~mask) & (dist <= radius)
    out[near, :3] = rgba[idx[0][near], idx[1][near], :3]
    out[~mask & ~near] = 0
    return out


def reencode_astc_mip_rdo40(astcenc_bin: str, mip_bytes: bytes, w: int, h: int, b: int,
                            is_srgb: bool, do_dilate: bool) -> bytes | None:
    bx, by = ceil_div(w, b), ceil_div(h, b)
    expected_len = bx * by * 16
    if len(mip_bytes) != expected_len:
        return None
    dec_flag = "-ds" if is_srgb else "-dl"
    enc_flag = "-cs" if is_srgb else "-cl"
    with tempfile.TemporaryDirectory(prefix="wxastc_") as td:
        in_astc = os.path.join(td, "in.astc")
        dec_png = os.path.join(td, "dec.png")
        src_png = os.path.join(td, "src.png")
        out_astc = os.path.join(td, "out.astc")
        hdr = bytes([0x13, 0xAB, 0xA1, 0x5C, b, b, 1]) + w.to_bytes(3, "little") + h.to_bytes(3, "little") + (1).to_bytes(3, "little")
        with open(in_astc, "wb") as f:
            f.write(hdr + mip_bytes)
        r1 = subprocess.run([astcenc_bin, dec_flag, in_astc, dec_png], capture_output=True)
        if r1.returncode != 0 or not os.path.exists(dec_png):
            return None
        if do_dilate:
            img = np.array(Image.open(dec_png).convert("RGBA"))
            if (img[:, :, 3] == 0).mean() > 0.15:
                img = dilate_alpha_bounded(img, radius=min(b, 6))
            Image.fromarray(img).save(src_png)
        else:
            src_png = dec_png
        r2 = subprocess.run(
            [astcenc_bin, enc_flag, src_png, out_astc, f"{b}x{b}", "-medium", "-rdo-lambda", "40", "-silent"],
            capture_output=True,
        )
        if r2.returncode != 0 or not os.path.exists(out_astc):
            return None
        out_raw = open(out_astc, "rb").read()[16:]
        return out_raw if len(out_raw) == expected_len else None


# ============================================================================
# AnimationClip A1_12bit 原地曲线尾数抹零
# ============================================================================
def apply_anim_a1_12bit(raw: bytes) -> bytes | None:
    if len(raw) < 128:
        return None
    nlen = struct.unpack_from("<I", raw, 0)[0]
    if nlen > 512:
        return None
    u = np.frombuffer(raw, dtype="<u4").copy()
    exp = (u >> np.uint32(23)) & np.uint32(0xFF)
    f = u.view("<f4")
    # 仅改写合理浮点范围 (1e-6 <= |f| <= 1e5)，跳过曲线索引小整数、哈希值、长度计数与 NaN 哨兵
    valid_float = (exp >= 107) & (exp <= 143) & np.isfinite(f)
    start_word = ceil_div(4 + nlen, 4) + 8
    if start_word >= len(u):
        return None
    sub = u[start_word:]
    mask = valid_float[start_word:]
    rounded = round_mantissa_f32_words(sub, 12)
    u[start_word:] = np.where(mask, rounded, sub)
    return u.tobytes()


# ============================================================================
# 单个 UnityPy Environment 处理核心
# ============================================================================
def process_unity_env(env: UnityPy.Environment, zero_cost: bool, compute_opt: bool, astcenc_bin: str) -> dict:
    stats = {
        "tex_rdo": 0,
        "tex_wxastc": 0,
        "mesh_m1": 0,
        "mesh_wxmsh2": 0,
        "mesh_wxidx2": 0,
        "anim_a1": 0,
    }
    excluded_meshes = collect_collider_and_readable_meshes(env) if compute_opt else set()

    for obj in env.objects:
        # 1. Mesh
        if obj.type == ClassIDType.Mesh and (zero_cost or compute_opt):
            minfo = parse_mesh_object(obj)
            if not minfo:
                continue
            raw = bytearray(minfo["raw"])
            modified = False
            can_compute = compute_opt and (not minfo["is_readable"]) and (minfo["path_id"] not in excluded_meshes)

            if can_compute:
                wx_vd = encode_wxmsh2_inplace(minfo)
                if wx_vd is not None:
                    raw[minfo["vd_off"]:minfo["vd_off"] + len(wx_vd)] = wx_vd
                    stats["mesh_wxmsh2"] += 1
                    modified = True
                if minfo["ib_off"] >= 0:
                    wx_ib = encode_wxidx2_inplace(minfo["ib"])
                    if wx_ib is not None:
                        raw[minfo["ib_off"]:minfo["ib_off"] + len(wx_ib)] = wx_ib
                        stats["mesh_wxidx2"] += 1
                        modified = True

            if (not modified) and zero_cost:
                m1_vd = apply_mesh_m1_12bit(minfo["vd"], minfo["vcount"], minfo["stride"], minfo["channels"])
                raw[minfo["vd_off"]:minfo["vd_off"] + len(m1_vd)] = m1_vd
                stats["mesh_m1"] += 1
                modified = True

            if modified:
                obj.set_raw_data(bytes(raw))

        # 2. AnimationClip
        elif obj.type == ClassIDType.AnimationClip and zero_cost:
            raw = bytes(obj.get_raw_data())
            patched = apply_anim_a1_12bit(raw)
            if patched is not None and patched != raw:
                obj.set_raw_data(patched)
                stats["anim_a1"] += 1

        # 3. Texture2D
        elif obj.type == ClassIDType.Texture2D and (zero_cost or compute_opt):
            raw = bytearray(obj.get_raw_data())
            if len(raw) < 96:
                continue
            nlen = struct.unpack_from("<i", raw, 0)[0]
            if nlen < 0 or nlen > 512:
                continue
            name = raw[4:4 + nlen].decode("utf-8", "replace")
            o = (4 + nlen + 3) & ~3
            ints = struct.unpack_from("<17i", raw, o)
            w, h, fmt, mips = ints[2], ints[3], ints[15], ints[16]
            if fmt not in ASTC_BLK or w <= 0 or h <= 0 or mips <= 0:
                continue
            b = ASTC_BLK[fmt]
            # 计算全部 mip 字节总长
            mip_rects = []
            total_mip_bytes = 0
            mw, mh = w, h
            for m in range(mips):
                bx, by = ceil_div(mw, b), ceil_div(mh, b)
                mlen = bx * by * 16
                mip_rects.append((mw, mh, bx, by, mlen))
                total_mip_bytes += mlen
                mw = max(1, mw >> 1)
                mh = max(1, mh >> 1)

            # 定位末尾 image data 载荷
            data_pos = -1
            for p in range(len(raw) - 8, o, -1):
                L = struct.unpack_from("<i", raw, p)[0]
                if L == total_mip_bytes and p + 4 + L <= len(raw) and len(raw) - (p + 4 + L) < 64:
                    data_pos = p + 4
                    break
            if data_pos < 0:
                continue

            is_linear_map = any(k in name.lower() for k in ("normal", "_n", "lightmap", "shadowmask"))
            is_srgb = not is_linear_map
            cur = data_pos
            tex_modified = False

            for m_idx, (mw, mh, bx, by, mlen) in enumerate(mip_rects):
                mip_slice = bytes(raw[cur:cur + mlen])
                if zero_cost and mw >= 16 and mh >= 16:
                    rdo_slice = reencode_astc_mip_rdo40(
                        astcenc_bin, mip_slice, mw, mh, b,
                        is_srgb=is_srgb,
                        do_dilate=(mips == 1 and not is_linear_map),
                    )
                    if rdo_slice is not None:
                        mip_slice = rdo_slice
                        tex_modified = True
                if compute_opt:
                    wx_slice = encode_wxastc_mip_inplace(mip_slice, bx, by)
                    if wx_slice is not None:
                        mip_slice = wx_slice
                        stats["tex_wxastc"] += 1
                        tex_modified = True
                raw[cur:cur + mlen] = mip_slice
                cur += mlen

            if tex_modified:
                if zero_cost:
                    stats["tex_rdo"] += 1
                obj.set_raw_data(bytes(raw))

    return stats


def process_file(in_path: Path, out_path: Path, zero_cost: bool, compute_opt: bool) -> dict:
    t0 = time.time()
    astcenc_bin = find_astcenc()
    blob = in_path.read_bytes()
    old_size = len(blob)

    if is_web_data_container(blob):
        sig, entries = unpack_web_data(blob)
        new_entries = []
        agg_stats = {}
        for name, data in entries:
            if data.startswith(b"UnityFS"):
                env = UnityPy.Environment()
                env.load_file(data, name=name)
                st = process_unity_env(env, zero_cost, compute_opt, astcenc_bin)
                for k, v in st.items():
                    agg_stats[k] = agg_stats.get(k, 0) + v
                for f in env.files.values():
                    new_data = f.save(packer="lz4")
                    new_entries.append((name, new_data))
                    break
            else:
                new_entries.append((name, data))
        out_blob = pack_web_data(sig, new_entries)
    elif blob.startswith(b"UnityFS"):
        env = UnityPy.Environment()
        env.load_file(blob, name=in_path.name)
        agg_stats = process_unity_env(env, zero_cost, compute_opt, astcenc_bin)
        out_blob = blob
        for f in env.files.values():
            out_blob = f.save(packer="lz4")
            break
    else:
        return {"skipped": True, "path": str(in_path)}

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(out_blob)
    new_size = len(out_blob)
    elapsed = time.time() - t0
    print(f"[WXWebGPUAssetOpt] {in_path.name}: {old_size/1e6:.2f}MB -> {new_size/1e6:.2f}MB "
          f"({(new_size - old_size)/1e6:+.2f}MB, {(new_size/old_size - 1)*100:+.1f}%) "
          f"in {elapsed:.1f}s | stats={agg_stats}")
    return {
        "skipped": False,
        "old_size": old_size,
        "new_size": new_size,
        "stats": agg_stats,
        "elapsed_s": round(elapsed, 2),
    }


def selftest():
    """验证 WXMSH2 / WXIDX2 / WXASTC 编码器的头部魔数、校验和与解码还原精度。"""
    rng = np.random.default_rng(42)
    vcount = 128
    stride = 56
    vd = bytearray(vcount * stride)
    fview = np.frombuffer(vd, dtype="<f4").reshape(vcount, 14)
    fview[:, 0:3] = rng.uniform(-10.0, 10.0, size=(vcount, 3)).astype(np.float32)
    nrm = rng.normal(size=(vcount, 3)).astype(np.float32)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    fview[:, 3:6] = nrm
    tan = rng.normal(size=(vcount, 3)).astype(np.float32)
    tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    fview[:, 6:9] = tan
    fview[:, 9] = rng.choice([-1.0, 1.0], size=vcount).astype(np.float32)
    fview[:, 10:14] = rng.uniform(0.0, 1.0, size=(vcount, 4)).astype(np.float32)

    channels = [
        {"stream": 0, "offset": 0, "format": 0, "dimension": 3},
        {"stream": 0, "offset": 12, "format": 0, "dimension": 3},
        {"stream": 0, "offset": 24, "format": 0, "dimension": 4},
        {"stream": 0, "offset": 40, "format": 0, "dimension": 0},
        {"stream": 0, "offset": 40, "format": 0, "dimension": 2},
        {"stream": 0, "offset": 48, "format": 0, "dimension": 2},
    ]
    minfo = {"vd": bytes(vd), "vcount": vcount, "stride": stride, "channels": channels}
    enc_vd = encode_wxmsh2_inplace(minfo)
    assert enc_vd is not None and len(enc_vd) == len(vd)
    w = struct.unpack_from("<10I", enc_vd, 0)
    assert w[0] == MAGIC_WXMSH0 and w[1] == MAGIC_WXMSH1
    assert w[2] == len(vd) and w[3] < len(vd)
    assert fnv1a32(enc_vd[:36]) == w[9]

    ib = np.arange(384, dtype="<u2").tobytes()
    enc_ib = encode_wxidx2_inplace(ib)
    assert enc_ib is not None and len(enc_ib) == len(ib)
    wi = struct.unpack_from("<8I", enc_ib, 0)
    assert wi[0] == MAGIC_WXIDX0 and wi[1] == MAGIC_WXIDX1
    assert fnv1a32(enc_ib[:28]) == wi[7]

    # ASTC S3 测试（含 70% 常值块）
    bx, by = 16, 16
    astc_blocks = np.zeros((bx * by, 16), dtype=np.uint8)
    astc_blocks[:180] = np.frombuffer(b"\xfc\xfd\xff\xff\xff\xff\xff\xff\x00\x00\x00\x00\x00\x00\x00\x00", dtype=np.uint8)
    astc_blocks[180:] = rng.integers(0, 256, size=(bx * by - 180, 16), dtype=np.uint8)
    enc_astc = encode_wxastc_mip_inplace(astc_blocks.tobytes(), bx, by)
    assert enc_astc is not None and len(enc_astc) == bx * by * 16
    wa = struct.unpack_from("<8I", enc_astc, 0)
    assert wa[0] == MAGIC_WXASTC0 and wa[1] == MAGIC_WXASTC1
    assert fnv1a32(enc_astc[:28]) == wa[7]
    print("[SELFTEST] PASS: WXMSH2 / WXIDX2 / WXASTC headers, checksums, and in-place sizes verified.")


def main():
    ap = argparse.ArgumentParser(description="WeChat WebGPU Asset Optimizer")
    ap.add_argument("--input", type=str, help="Input webgl.data or AssetBundle file path")
    ap.add_argument("--output", type=str, help="Output file path (default: overwrite input)")
    ap.add_argument("--ab-dir", type=str, help="Optional StreamingAssets directory to scan for AssetBundles")
    ap.add_argument("--zero-cost", action="store_true", help="Enable Switch 1: Zero-runtime-cost RDO40 + M1 + A1")
    ap.add_argument("--compute-opt", action="store_true", help="Enable Switch 2: WebGPU Compute WXMSH2 + WXIDX2 + WXASTC")
    ap.add_argument("--selftest", action="store_true", help="Run built-in encoder verification")
    args = ap.parse_args()

    if args.selftest:
        selftest()
        return

    if not args.zero_cost and not args.compute_opt:
        print("[WXWebGPUAssetOpt] Neither --zero-cost nor --compute-opt specified, nothing to do.")
        return

    if args.input:
        in_p = Path(args.input)
        out_p = Path(args.output) if args.output else in_p
        if in_p.exists():
            process_file(in_p, out_p, args.zero_cost, args.compute_opt)

    if args.ab_dir:
        ab_root = Path(args.ab_dir)
        if ab_root.exists():
            for p in sorted(ab_root.rglob("*")):
                if p.is_file() and not p.name.endswith((".manifest", ".meta", ".json", ".txt", ".br")):
                    try:
                        with open(p, "rb") as f:
                            head = f.read(16)
                        if head.startswith(b"UnityFS"):
                            process_file(p, p, args.zero_cost, args.compute_opt)
                    except Exception as e:
                        print(f"[WXWebGPUAssetOpt] Skipped {p.name}: {e}")


if __name__ == "__main__":
    main()
