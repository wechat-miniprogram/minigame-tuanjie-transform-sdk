/*!
 * WebGPUASTCDecoderSDK.js (bundled)
 *
 * 环境无关的 WebGPU ASTC 解码器 SDK。
 * 内联了 WGSL Compute Shader，无外部依赖。
 *
 * 支持环境：
 *   - PC 浏览器（Chrome/Edge，支持 WebGPU）
 *   - Unity WebGL 网页版
 *   - 微信 PC 小游戏（待 WebGPU 就绪）
 *
 * 对外 API：
 *   const sdk = new WebGPUASTCDecoderSDK({ debug, glContext });
 *   await sdk.init();                              // 初始化 Pipeline（60~230ms）
 *   sdk.isAvailable();                             // 是否可用
 *   sdk.setGLContext(gl);                          // 设置 WebGL context（零拷贝模式）
 *   await sdk.decodeToCanvas(data, w, h, bw, bh);  // 返回 OffscreenCanvas
 *   await sdk.decodeToUint8Array(data, w, h, bw, bh); // 返回 RGBA Uint8Array
 *   sdk.decodeAndInjectToGLTexture(glTexId, data, w, h, bw, bh); // 注入到 GL 纹理
 *   sdk.onDeviceLost(cb);                          // 注册 device.lost 回调
 *   sdk.destroy();
 */
(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    const api = factory();
    global.WebGPUASTCDecoderSDK = api.WebGPUASTCDecoderSDK;
    global.WebGPUASTCPipelineInit = api.WebGPUASTCPipelineInit;
    global.WebGPUASTCTextureFactory = api.WebGPUASTCTextureFactory;
    global.WebGPUASTCDecoder = api.WebGPUASTCDecoder;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ======================================================================
  // 全局开关（可通过 SDK 构造参数 { debug: true } 打开）
  // ======================================================================
  let _SDK_DEBUG = false;

  // ======================================================================
  // 内联 WGSL 源码
  // ======================================================================
  const __INLINE_WGSL_CODE__ = `/**
 *  图片的基本数据
*/
struct Params {
  imgWidth: u32,      // 图像宽度
  imgHeight: u32,     // 图像高度
  blockWidth: u32,    // 块的宽度
  blockHeight: u32,   // 块的高度
  blockCountX: u32,   // X轴 块的数量
  blockCountY: u32,   // Y轴 块的数量
  totalBlocks: u32,   // 总块数
  blockOffset: u32,   // 分批解码时当前批次的块偏移（全量解码时为0）
  batchSize: u32,     // 当前批次要处理的块数量（全量解码时等于 totalBlocks）
}
/**
 *  图片非头部数据
*/
struct InBuf {
  values: array<u32>,
}
struct BlockData {
  bw: u32,              // 块宽度
  bh: u32,              // 块高度
  width: u32,           // 图像宽度
  height: u32,          // 图像高度
  part_num: u32,        // 分区数量 (1-4)
  dual_plane: u32,      // 是否双平面 (0或1)
  plane_selector: u32,  // 平面选择器
  weight_range: u32,    // 权重范围
  weight_num: u32,      // 权重数量
  cem: array<u32, 4>,   // 颜色端点模式 (每个分区一个)
  cem_range: u32,       // 颜色端点模式范围
  endpoint_value_num: u32, // 端点值数量
  endpoints: array<array<i32, 8>, 4>, // 端点数据 (最多4个分区，每个分区8个值)
  weights: array<array<u32, 4>, 144>, // 权重数据 (144个位置，每个最多4个权重值)
  partitions: array<u32, 144> // 分区数据 (144个像素位置的分区信息)
}

@group(0) @binding(0) var<uniform> params : Params; // 图像参数
@group(0) @binding(1) var<storage, read> inBuf : InBuf; // ASTC 压缩数据
@group(0) @binding(2) var outTex : texture_storage_2d<rgba8unorm, write>; // 输出纹理 (零拷贝)

// 权重精度表A
const WeightPrecTableA: array<u32, 16> = array<u32, 16>(
  0u, 0u, 0u, 3u, 0u, 5u, 3u, 0u, 0u, 0u, 5u, 3u, 0u, 5u, 3u, 0u
);

// 权重精度表B
const WeightPrecTableB: array<u32, 16> = array<u32, 16>(
  0u, 0u, 1u, 0u, 2u, 0u, 1u, 3u, 0u, 0u, 1u, 2u, 4u, 2u, 3u, 5u
);

// CEM表A (19个元素)
const CemTableA: array<u32, 19> = array<u32, 19>(
  0u, 3u, 5u, 0u, 3u, 5u, 0u, 3u, 5u, 0u, 3u, 5u, 0u, 3u, 5u, 0u, 3u, 0u, 0u
);

// CEM表B (19个元素)
const CemTableB: array<u32, 19> = array<u32, 19>(
  8u, 6u, 5u, 7u, 5u, 4u, 6u, 4u, 3u, 5u, 3u, 2u, 4u, 2u, 1u, 3u, 1u, 2u, 1u
);

// 位反转表 - 8位反转表（256个条目） //
const BitReverseTable: array<u32, 256> = array<u32, 256>(
  0x00u, 0x80u, 0x40u, 0xC0u, 0x20u, 0xA0u, 0x60u, 0xE0u, 0x10u, 0x90u, 0x50u, 0xD0u, 0x30u, 0xB0u, 0x70u, 0xF0u,
  0x08u, 0x88u, 0x48u, 0xC8u, 0x28u, 0xA8u, 0x68u, 0xE8u, 0x18u, 0x98u, 0x58u, 0xD8u, 0x38u, 0xB8u, 0x78u, 0xF8u,
  0x04u, 0x84u, 0x44u, 0xC4u, 0x24u, 0xA4u, 0x64u, 0xE4u, 0x14u, 0x94u, 0x54u, 0xD4u, 0x34u, 0xB4u, 0x74u, 0xF4u,
  0x0Cu, 0x8Cu, 0x4Cu, 0xCCu, 0x2Cu, 0xACu, 0x6Cu, 0xECu, 0x1Cu, 0x9Cu, 0x5Cu, 0xDCu, 0x3Cu, 0xBCu, 0x7Cu, 0xFCu,
  0x02u, 0x82u, 0x42u, 0xC2u, 0x22u, 0xA2u, 0x62u, 0xE2u, 0x12u, 0x92u, 0x52u, 0xD2u, 0x32u, 0xB2u, 0x72u, 0xF2u,
  0x0Au, 0x8Au, 0x4Au, 0xCAu, 0x2Au, 0xAAu, 0x6Au, 0xEAu, 0x1Au, 0x9Au, 0x5Au, 0xDAu, 0x3Au, 0xBAu, 0x7Au, 0xFAu,
  0x06u, 0x86u, 0x46u, 0xC6u, 0x26u, 0xA6u, 0x66u, 0xE6u, 0x16u, 0x96u, 0x56u, 0xD6u, 0x36u, 0xB6u, 0x76u, 0xF6u,
  0x0Eu, 0x8Eu, 0x4Eu, 0xCEu, 0x2Eu, 0xAEu, 0x6Eu, 0xEEu, 0x1Eu, 0x9Eu, 0x5Eu, 0xDEu, 0x3Eu, 0xBEu, 0x7Eu, 0xFEu,
  0x01u, 0x81u, 0x41u, 0xC1u, 0x21u, 0xA1u, 0x61u, 0xE1u, 0x11u, 0x91u, 0x51u, 0xD1u, 0x31u, 0xB1u, 0x71u, 0xF1u,
  0x09u, 0x89u, 0x49u, 0xC9u, 0x29u, 0xA9u, 0x69u, 0xE9u, 0x19u, 0x99u, 0x59u, 0xD9u, 0x39u, 0xB9u, 0x79u, 0xF9u,
  0x05u, 0x85u, 0x45u, 0xC5u, 0x25u, 0xA5u, 0x65u, 0xE5u, 0x15u, 0x95u, 0x55u, 0xD5u, 0x35u, 0xB5u, 0x75u, 0xF5u,
  0x0Du, 0x8Du, 0x4Du, 0xCDu, 0x2Du, 0xADu, 0x6Du, 0xEDu, 0x1Du, 0x9Du, 0x5Du, 0xDDu, 0x3Du, 0xBDu, 0x7Du, 0xFDu,
  0x03u, 0x83u, 0x43u, 0xC3u, 0x23u, 0xA3u, 0x63u, 0xE3u, 0x13u, 0x93u, 0x53u, 0xD3u, 0x33u, 0xB3u, 0x73u, 0xF3u,
  0x0Bu, 0x8Bu, 0x4Bu, 0xCBu, 0x2Bu, 0xABu, 0x6Bu, 0xEBu, 0x1Bu, 0x9Bu, 0x5Bu, 0xDBu, 0x3Bu, 0xBBu, 0x7Bu, 0xFBu,
  0x07u, 0x87u, 0x47u, 0xC7u, 0x27u, 0xA7u, 0x67u, 0xE7u, 0x17u, 0x97u, 0x57u, 0xD7u, 0x37u, 0xB7u, 0x77u, 0xF7u,
  0x0Fu, 0x8Fu, 0x4Fu, 0xCFu, 0x2Fu, 0xAFu, 0x6Fu, 0xEFu, 0x1Fu, 0x9Fu, 0x5Fu, 0xDFu, 0x3Fu, 0xBFu, 0x7Fu, 0xFFu
);

// DImt表 - 三进制解码的偏移量 //
const DImt: array<u32, 5> = array<u32, 5>(0u, 2u, 4u, 5u, 7u);

// DImq表 - 五进制解码的偏移量 //
const DImq: array<u32, 3> = array<u32, 3>(0u, 3u, 5u);

// 三进制解码表 //
const DETritsTable: array<i32, 7> = array<i32, 7>(0, 204, 93, 44, 22, 11, 5);

// 五进制解码表 //
const DEQuintsTable: array<i32, 6> = array<i32, 6>(0, 113, 54, 26, 13, 6);

// DITritsTable - 完整的三进制解码表 (5行×256列)
// 这里使用多个一维数组来模拟二维数组，因为WGSL不支持真正的二维常量数组 //
const DITritsTable_0: array<u32, 256> = array<u32, 256>(
  0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 0u, 0u, 1u, 2u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 2u, 2u
);

const DITritsTable_1: array<u32, 256> = array<u32, 256>(
  0u, 0u, 0u, 0u, 1u, 1u, 1u, 0u, 2u, 2u, 2u, 0u, 2u, 2u, 2u, 0u, 0u, 0u, 0u, 1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u, 1u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 1u, 1u, 1u, 0u, 2u, 2u, 2u, 0u, 2u, 2u, 2u, 0u, 0u, 0u, 0u, 1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u, 1u, 1u, 1u, 1u, 0u, 0u, 0u, 0u, 0u, 1u, 1u, 1u, 0u, 2u, 2u, 2u, 0u, 2u, 2u, 2u, 0u, 0u, 0u, 0u, 1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u, 1u, 2u, 2u, 2u, 0u, 0u, 0u, 0u, 0u, 1u, 1u, 1u, 0u, 2u, 2u, 2u, 0u, 2u, 2u, 2u, 0u, 0u, 0u, 0u, 1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u, 1u, 2u, 2u, 2u, 0u, 0u, 0u, 0u, 0u, 1u, 1u, 1u, 0u, 2u, 2u, 2u, 0u, 2u, 2u, 2u, 0u, 0u, 0u, 0u, 1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u, 1u, 0u, 0u, 0u, 1u, 0u, 0u, 0u, 0u, 1u, 1u, 1u, 0u, 2u, 2u, 2u, 0u, 2u, 2u, 2u, 0u, 0u, 0u, 0u, 1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u, 1u, 1u, 1u, 1u, 1u, 0u, 0u, 0u, 0u, 1u, 1u, 1u, 0u, 2u, 2u, 2u, 0u, 2u, 2u, 2u, 0u, 0u, 0u, 0u, 1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u, 1u, 2u, 2u, 2u, 1u, 0u, 0u, 0u, 0u, 1u, 1u, 1u, 0u, 2u, 2u, 2u, 0u, 2u, 2u, 2u, 0u, 0u, 0u, 0u, 1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u, 1u, 2u, 2u, 2u, 1u
);

const DITritsTable_2: array<u32, 256> = array<u32, 256>(
  0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 2u, 2u, 2u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 2u, 2u, 2u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 2u, 2u, 2u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 2u, 2u, 2u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 2u, 2u, 2u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 2u, 2u, 2u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 2u, 2u, 2u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 2u, 2u, 2u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 0u, 0u, 0u, 2u, 2u, 2u, 2u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 1u, 1u, 1u, 2u, 2u, 2u, 2u, 2u
);

const DITritsTable_3: array<u32, 256> = array<u32, 256>(
  0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 2u, 2u, 2u, 2u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 2u, 2u, 2u, 2u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 2u, 2u, 2u, 2u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u, 2u
);

const DITritsTable_4: array<u32, 256> = array<u32, 256>(
  0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 2u, 2u, 2u, 2u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 2u, 2u, 2u, 2u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u, 2u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u, 2u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u
);

// 生成一个工具函数可以快速返回DITritsTable_0~4的值
fn GetDITritsTable(index: u32, value: u32) -> u32 {
  switch (index) {
    case 0u: { return DITritsTable_0[value]; }
    case 1u: { return DITritsTable_1[value]; }
    case 2u: { return DITritsTable_2[value]; }
    case 3u: { return DITritsTable_3[value]; }
    case 4u: { return DITritsTable_4[value]; }
    default: { return 0u; }
  }
}


// DIQuintsTable - 完整的五进制解码表 (3行×125列) //
const DIQuintsTable_0: array<u32, 128> = array<u32, 128>(
  0u, 1u, 2u, 3u, 4u, 0u, 4u, 4u, 0u, 1u, 2u, 3u, 4u, 1u, 4u, 4u, 0u, 1u, 2u, 3u, 4u, 2u, 4u, 4u, 0u, 1u, 2u, 3u, 4u, 3u, 4u, 4u, 0u, 1u, 2u, 3u, 4u, 0u, 4u, 0u, 0u, 1u, 2u, 3u, 4u, 1u, 4u, 1u, 0u, 1u, 2u, 3u, 4u, 2u, 4u, 2u, 0u, 1u, 2u, 3u, 4u, 3u, 4u, 3u, 0u, 1u, 2u, 3u, 4u, 0u, 2u, 3u, 0u, 1u, 2u, 3u, 4u, 1u, 2u, 3u, 0u, 1u, 2u, 3u, 4u, 2u, 2u, 3u, 0u, 1u, 2u, 3u, 4u, 3u, 2u, 3u, 0u, 1u, 2u, 3u, 4u, 0u, 0u, 1u, 0u, 1u, 2u, 3u, 4u, 1u, 0u, 1u, 0u, 1u, 2u, 3u, 4u, 2u, 0u, 1u, 0u, 1u, 2u, 3u, 4u, 3u, 0u, 1u
);

const DIQuintsTable_1: array<u32, 128> = array<u32, 128>(
  0u, 0u, 0u, 0u, 0u, 4u, 4u, 4u, 1u, 1u, 1u, 1u, 1u, 4u, 4u, 4u, 2u, 2u, 2u, 2u, 2u, 4u, 4u, 4u, 3u, 3u, 3u, 3u, 3u, 4u, 4u, 4u, 0u, 0u, 0u, 0u, 0u, 4u, 0u, 4u, 1u, 1u, 1u, 1u, 1u, 4u, 1u, 4u, 2u, 2u, 2u, 2u, 2u, 4u, 2u, 4u, 3u, 3u, 3u, 3u, 3u, 4u, 3u, 4u, 0u, 0u, 0u, 0u, 0u, 4u, 0u, 0u, 1u, 1u, 1u, 1u, 1u, 4u, 1u, 1u, 2u, 2u, 2u, 2u, 2u, 4u, 2u, 2u, 3u, 3u, 3u, 3u, 3u, 4u, 3u, 3u, 0u, 0u, 0u, 0u, 0u, 4u, 0u, 0u, 1u, 1u, 1u, 1u, 1u, 4u, 1u, 1u, 2u, 2u, 2u, 2u, 2u, 4u, 2u, 2u, 3u, 3u, 3u, 3u, 3u, 4u, 3u, 3u
);

const DIQuintsTable_2: array<u32, 128> = array<u32, 128>(
  0u, 0u, 0u, 0u, 0u, 0u, 0u, 4u, 0u, 0u, 0u, 0u, 0u, 0u, 1u, 4u, 0u, 0u, 0u, 0u, 0u, 0u, 2u, 4u, 0u, 0u, 0u, 0u, 0u, 0u, 3u, 4u, 1u, 1u, 1u, 1u, 1u, 1u, 4u, 4u, 1u, 1u, 1u, 1u, 1u, 1u, 4u, 4u, 1u, 1u, 1u, 1u, 1u, 1u, 4u, 4u, 1u, 1u, 1u, 1u, 1u, 1u, 4u, 4u, 2u, 2u, 2u, 2u, 2u, 2u, 4u, 4u, 2u, 2u, 2u, 2u, 2u, 2u, 4u, 4u, 2u, 2u, 2u, 2u, 2u, 2u, 4u, 4u, 2u, 2u, 2u, 2u, 2u, 2u, 4u, 4u, 3u, 3u, 3u, 3u, 3u, 3u, 4u, 4u, 3u, 3u, 3u, 3u, 3u, 3u, 4u, 4u, 3u, 3u, 3u, 3u, 3u, 3u, 4u, 4u, 3u, 3u, 3u, 3u, 3u, 3u, 4u, 4u
);

// 生成一个工具函数可以快速返回DIQuintsTable_0~2的值
fn GetDIQuintsTable(index: u32, value: u32) -> u32 {
  switch (index) {
    case 0u: { return DIQuintsTable_0[value]; }
    case 1u: { return DIQuintsTable_1[value]; }
    case 2u: { return DIQuintsTable_2[value]; }
    default: { return 0u; }
  }
}


@compute @workgroup_size(__WORKGROUP_SIZE__)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  // gid.x 是当前批次内的本地索引，加上 blockOffset 得到全局块索引
  let localIdx = gid.x;
  if (localIdx >= params.batchSize) {
    return;
  }
  let blockIdx = params.blockOffset + localIdx;
  if (blockIdx >= params.totalBlocks) {
    return;
  }

  /*
    由于 wgsl 仅支持 i32 u32 f32 f16
    而 astc 解码器需要基于 u8 数据处理比较方便
    因此针对每一个块的数据，需要将 u8 数据转换为 u32 数据，单个局部变量的块而言会放大 4 倍，但是处理更加方便
  */
  let blockLength = 4u; // 一个块的大小为 4个 u32 数据（也就是16字节）        
  let inputOffset = blockIdx * blockLength; // 当前计算线程的起始偏移索引

  // 创建一个针对当前块的原始数据局部变量数组将原本的 u32 数据转换为 u32 格式的 u8 数据
  var blockOriginData: array<u32, 16>;
  // 展开赋值避免编译器对循环的优化问题
  let inBufVal0 = inBuf.values[inputOffset + 0u];
  let inBufVal1 = inBuf.values[inputOffset + 1u];
  let inBufVal2 = inBuf.values[inputOffset + 2u];
  let inBufVal3 = inBuf.values[inputOffset + 3u];
  
  blockOriginData[0]  = inBufVal0 & 0xffu;
  blockOriginData[1]  = (inBufVal0 >> 8u) & 0xffu;
  blockOriginData[2]  = (inBufVal0 >> 16u) & 0xffu;
  blockOriginData[3]  = (inBufVal0 >> 24u) & 0xffu;
  blockOriginData[4]  = inBufVal1 & 0xffu;
  blockOriginData[5]  = (inBufVal1 >> 8u) & 0xffu;
  blockOriginData[6]  = (inBufVal1 >> 16u) & 0xffu;
  blockOriginData[7]  = (inBufVal1 >> 24u) & 0xffu;
  blockOriginData[8]  = inBufVal2 & 0xffu;
  blockOriginData[9]  = (inBufVal2 >> 8u) & 0xffu;
  blockOriginData[10] = (inBufVal2 >> 16u) & 0xffu;
  blockOriginData[11] = (inBufVal2 >> 24u) & 0xffu;
  blockOriginData[12] = inBufVal3 & 0xffu;
  blockOriginData[13] = (inBufVal3 >> 8u) & 0xffu;
  blockOriginData[14] = (inBufVal3 >> 16u) & 0xffu;
  blockOriginData[15] = (inBufVal3 >> 24u) & 0xffu;

  let blockBufferSize = params.blockWidth * params.blockHeight * 4u; // 一个块实际的 rgba 数据大小（byte）

  // 临时存储区块像素数据。ASTC block footprint 最大到 12x12=144，必须覆盖完整范围，
  // 否则 10xN / 12xN 这类块会在下方写回循环中越界读 → 黑块或垃圾色。
  var blockBuffer: array<u32, 144>;

  // 开始解码
  decodeBlock(&blockOriginData, &blockBuffer, inputOffset);

  // 到此为止，blockBuffer 中存储了当前块的解码数据，需要将数据写入 outBuf 中
  
  // 计算当前块在网格中的位置
  let blockX = blockIdx % params.blockCountX;
  let blockY = blockIdx / params.blockCountX; // 整数除法
  
  // 计算需要写入的实际宽度和高度（处理边缘块）
  var writeW = params.blockWidth;
  var writeH = params.blockHeight;
  
  // 处理右边缘块
  if (blockX == params.blockCountX - 1u) {
    let remainderX = params.imgWidth % params.blockWidth;
    if (remainderX != 0u) {
      writeW = remainderX;
    }
  }
  
  // 处理上边缘块  
  if (blockY == params.blockCountY - 1u) {
    let remainderY = params.imgHeight % params.blockHeight;
    if (remainderY != 0u) {
      writeH = remainderY;
    }
  }
  
  // 计算当前块的起始Y坐标（从顶部开始）
  let startY = blockY * params.blockHeight;
  
  // 将块数据写入输出纹理 (零拷贝: 直接写 GPUTexture)
  for (var i = 0u; i < writeH; i++) {
    let outY = startY + i;
    if (outY >= params.imgHeight) { continue; }
    
    for (var x = 0u; x < writeW; x++) {
      let outX = blockX * params.blockWidth + x;
      if (outX >= params.imgWidth) { continue; }
      
      // blockBuffer 中的像素索引（从顶行到底行）
      let pixelIdx = i * params.blockWidth + x;
      let pixel = blockBuffer[pixelIdx];
      
      // ColorU32 打包格式: R[31:24] G[23:16] B[15:8] A[7:0]
      // 拆解为 vec4<f32> (归一化到 0.0~1.0)
      let r = f32((pixel >> 24u) & 0xffu) / 255.0;
      let g = f32((pixel >> 16u) & 0xffu) / 255.0;
      let b = f32((pixel >> 8u) & 0xffu) / 255.0;
      let a = f32(pixel & 0xffu) / 255.0;
      
      textureStore(outTex, vec2<u32>(outX, outY), vec4<f32>(r, g, b, a));
    }
  }

}

/**
 *  blockOriginData 是astc压缩数据（已经将 u8[] 转换成 u32[]），blockBuffer是对这个块解码后的rgba数据
*/
fn decodeBlock(blockOriginData: ptr<function, array<u32, 16>>, blockBuffer: ptr<function, array<u32, 144>>, inputOffset: u32) {
  
  // for (var i = 0u; i < 64u; i++) {
  //   if (i < 16u) {
  //     (*blockBuffer)[i] = (*blockOriginData)[i];
  //   } else {
  //     (*blockBuffer)[i] = 2u;
  //   }
  // }

  // ASTC 有一种特殊的快速路径：当块的首字节为 0xFC 且第二字节最低位为 1 时，
  // 该块表示单一颜色（constant-color block）。在这种情况下，颜色直接存于块内的特定字节位置。
  // 这里按实现读取 RGBA（字节偏移 9/11/13/15），用 Color() 打包为 32-bit，然后填充整个块的像素。
  if ((*blockOriginData)[0] == 0xfc && (((*blockOriginData)[1] & 1u) == 1)) {
    // 读取块中保存的常量颜色（R,G,B,A）并打包为 32-bit
    let color = ColorU32((*blockOriginData)[9], (*blockOriginData)[11], (*blockOriginData)[13], (*blockOriginData)[15]);
    // 将相同颜色写入临时输出缓冲的每个像素位置
    for (var i = 0u; i < 64u; i++) {
      (*blockBuffer)[i] = color;
      // (*blockBuffer)[i] = 100;
    }
    return;
  }


  // 区别c#使用 mBlockData wgsl中直接创建相关的 mBlockData 数据
  var mBlockData: BlockData;
  mBlockData.bw = params.blockWidth;
  mBlockData.bh = params.blockHeight;

  // 解析块的参数位域（包括 weight_range、width/height、part_num、cem 等）
  DecodeBlockParameters(blockOriginData, &mBlockData, inputOffset);

  // DecodeEndpoints
  // 根据解析到的参数读取并解码端点（endpoint）值，端点用于插值生成像素颜色
  DecodeEndpoints(blockOriginData, &mBlockData, inputOffset);

  // DecodeWeights
  DecodeWeights(blockOriginData, &mBlockData, inputOffset);

  if (mBlockData.part_num > 1u) {
    SelectPartition(blockOriginData, &mBlockData, inputOffset);
  }

				ApplicateColor(&mBlockData, blockBuffer);
}

/**
 * not check
*/
fn SelectPartition(blockOriginData: ptr<function, array<u32, 16>>, mBlockData: ptr<function, BlockData>, inputOffset: u32) {
  // 判断是否为小块
  let small_block = ((*mBlockData).bw * (*mBlockData).bh < 31u);
  
  // 提取 seed 值
  // C# 中的 BitConverter.ToInt32(input, ioff) >> 13 & 0x3ff 
  // 由于 blockOriginData 是将 u8 数据转换为 u32 数组，前4个字节对应 blockOriginData[0]
  // 需要从 blockOriginData[0] 中提取前4个字节组成32位值
  let input32 = ((*blockOriginData)[3] << 24u) | ((*blockOriginData)[2] << 16u) | ((*blockOriginData)[1] << 8u) | (*blockOriginData)[0];
  let seed_value = (input32 >> 13u) & 0x3ffu;
  let seed = seed_value | (((*mBlockData).part_num - 1u) << 10u);
  
  // 计算 rnum (伪随机数)
  var rnum = seed;
  rnum ^= rnum >> 15u;
  rnum = rnum - (rnum << 17u);
  rnum += rnum << 7u;
  rnum += rnum << 4u;
  rnum ^= rnum >> 5u;
  rnum += rnum << 16u;
  rnum ^= rnum >> 7u;
  rnum ^= rnum >> 3u;
  rnum ^= rnum << 6u;
  rnum ^= rnum >> 17u;
  
  // 创建 seeds 数组
  var seeds: array<u32, 8>;
  for (var i = 0u; i < 8u; i++) {
    seeds[i] = (rnum >> (i * 4u)) & 0xFu;
    seeds[i] *= seeds[i];
  }
  
  // 创建 sh 数组
  var sh: array<u32, 2>;
  sh[0] = select(5u, 4u, (seed & 2u) != 0u);
  sh[1] = select(5u, 6u, (*mBlockData).part_num == 3u);
  
  // 根据种子位移调整 seeds 值
  if ((seed & 1u) != 0u) {
    for (var i = 0u; i < 8u; i++) {
      seeds[i] >>= sh[i % 2u];
    }
  } else {
    for (var i = 0u; i < 8u; i++) {
      seeds[i] >>= sh[1u - (i % 2u)];
    }
  }
  
  var i = 0u;
  
  if (small_block) {
    // 小块处理：坐标翻倍
    for (var t = 0u; t < (*mBlockData).bh; t++) {
      for (var s = 0u; s < (*mBlockData).bw; s++) {
        let x = s << 1u;
        let y = t << 1u;
        
        let a = ((seeds[0] * x + seeds[1] * y + (rnum >> 14u)) & 0x3fu);
        let b = ((seeds[2] * x + seeds[3] * y + (rnum >> 10u)) & 0x3fu);
        let c_value = select(0u, ((seeds[4] * x + seeds[5] * y + (rnum >> 6u)) & 0x3fu), (*mBlockData).part_num >= 3u);
        let d = select(0u, ((seeds[6] * x + seeds[7] * y + (rnum >> 2u)) & 0x3fu), (*mBlockData).part_num >= 4u);
        
        // 确定分区：选择最大值对应的分区索引
        let partition_value = select(
          select(
            select(3u, 2u, c_value >= d),
            1u, b >= c_value && b >= d
          ),
          0u, a >= b && a >= c_value && a >= d
        );
        
        (*mBlockData).partitions[i] = partition_value;
        i++;
      }
    }
  } else {
    // 大块处理：正常坐标
    for (var y = 0u; y < (*mBlockData).bh; y++) {
      for (var x = 0u; x < (*mBlockData).bw; x++) {
        let a = ((seeds[0] * x + seeds[1] * y + (rnum >> 14u)) & 0x3fu);
        let b = ((seeds[2] * x + seeds[3] * y + (rnum >> 10u)) & 0x3fu);
        let c_value = select(0u, ((seeds[4] * x + seeds[5] * y + (rnum >> 6u)) & 0x3fu), (*mBlockData).part_num >= 3u);
        let d = select(0u, ((seeds[6] * x + seeds[7] * y + (rnum >> 2u)) & 0x3fu), (*mBlockData).part_num >= 4u);
        
        // 确定分区：选择最大值对应的分区索引
        let partition_value = select(
          select(
            select(3u, 2u, c_value >= d),
            1u, b >= c_value && b >= d
          ),
          0u, a >= b && a >= c_value && a >= d
        );
        
        (*mBlockData).partitions[i] = partition_value;
        i++;
      }
    }
  }
}


/**
 *  pass
*/
fn DecodeWeights(blockOriginData: ptr<function, array<u32, 16>>, mBlockData: ptr<function, BlockData>, inputOffset: u32) {
  var wSeq: array<vec2<u32>, 144>; // x: bits, y: nonbits
  var wv: array<u32, 144>; // 权重值
  
  // 首先解码整数序列
  DecodeIntseq(blockOriginData, 128u, WeightPrecTableA[(*mBlockData).weight_range], WeightPrecTableB[(*mBlockData).weight_range], (*mBlockData).weight_num, true, &wSeq);

  // 根据 WeightPrecTableA 的值进行不同的解码处理
  let weightA = WeightPrecTableA[(*mBlockData).weight_range];
  let weightB = WeightPrecTableB[(*mBlockData).weight_range];
  
  if (weightA == 0u) {
    switch (weightB) {
      case 1u: {
        for (var i = 0u; i < (*mBlockData).weight_num; i++) {
          wv[i] = select(0u, 63u, wSeq[i].x != 0u);
        }
        break;
      }
      case 2u: {
        for (var i = 0u; i < (*mBlockData).weight_num; i++) {
          wv[i] = (wSeq[i].x << 4u) | (wSeq[i].x << 2u) | wSeq[i].x;
        }
        break;
      }
      case 3u: {
        for (var i = 0u; i < (*mBlockData).weight_num; i++) {
          wv[i] = (wSeq[i].x << 3u) | wSeq[i].x;
        }
        break;
      }
      case 4u: {
        for (var i = 0u; i < (*mBlockData).weight_num; i++) {
          wv[i] = (wSeq[i].x << 2u) | (wSeq[i].x >> 2u);
        }
        break;
      }
      case 5u: {
        for (var i = 0u; i < (*mBlockData).weight_num; i++) {
          wv[i] = (wSeq[i].x << 1u) | (wSeq[i].x >> 4u);
        }
        break;
      }
      default: {
        for (var i = 0u; i < (*mBlockData).weight_num; i++) {
          wv[i] = 0u;
        }
        break;
      }
    }
    
    // 对大于32的值进行特殊处理
    for (var i = 0u; i < (*mBlockData).weight_num; i++) {
      if (wv[i] > 32u) {
        wv[i] = wv[i] + 1u;
      }
    }
  } else if (weightB == 0u) {
    let s = select(16u, 32u, weightA == 3u);
    for (var i = 0u; i < (*mBlockData).weight_num; i++) {
      wv[i] = wSeq[i].y * s;
    }
  } else {
    // 复杂的权重解码逻辑
    if (weightA == 3u) {
      switch (weightB) {
        case 1u: {
          for (var i = 0u; i < (*mBlockData).weight_num; i++) {
            wv[i] = wSeq[i].y * 50u;
          }
          break;
        }
        case 2u: {
          for (var i = 0u; i < (*mBlockData).weight_num; i++) {
            wv[i] = wSeq[i].y * 23u;
            if ((wSeq[i].x & 2u) != 0u) {
              wv[i] = wv[i] + 69u; // 0b1000101 = 69
            }
          }
          break;
        }
        case 3u: {
          for (var i = 0u; i < (*mBlockData).weight_num; i++) {
            wv[i] = (wSeq[i].y * 11u) + (((wSeq[i].x << 4u) | (wSeq[i].x >> 1u)) & 99u);
          }
          break;
        }
        default: {
          for (var i = 0u; i < (*mBlockData).weight_num; i++) {
            wv[i] = 0u;
          }
          break;
        }
      }
    } else if (weightA == 5u) {
      switch (weightB) {
        case 1u: {
          for (var i = 0u; i < (*mBlockData).weight_num; i++) {
            wv[i] = wSeq[i].y * 28u;
          }
          break;
        }
        case 2u: {
          for (var i = 0u; i < (*mBlockData).weight_num; i++) {
            wv[i] = wSeq[i].y * 13u;
            if ((wSeq[i].x & 2u) != 0u) {
              wv[i] = wv[i] + 66u; // 0b1000010 = 66
            }
          }
          break;
        }
        default: {
          for (var i = 0u; i < (*mBlockData).weight_num; i++) {
            wv[i] = 0u;
          }
          break;
        }
      }
    }
    
    // 对所有权重进行最后的处理
    for (var i = 0u; i < (*mBlockData).weight_num; i++) {
      let a = (wSeq[i].x & 1u) * 0x7fu;
      wv[i] = (a & 0x20u) | ((wv[i] ^ a) >> 2u);
      if (wv[i] > 32u) {
        wv[i] = wv[i] + 1u;
      }
    }
  }

  // 进行双线性插值计算最终的权重值
  let ds = (1024 + (*mBlockData).bw / 2u) / ((*mBlockData).bw - 1u);
  let dt = (1024 + (*mBlockData).bh / 2u) / ((*mBlockData).bh - 1u);
  let pn = select(1u, 2u, (*mBlockData).dual_plane != 0u);

  var i = 0u;
  for (var t = 0u; t < (*mBlockData).bh; t++) {
    for (var s = 0u; s < (*mBlockData).bw; s++) {
      let gs = (ds * s * ((*mBlockData).width - 1u) + 32u) >> 6u;
      let gt = (dt * t * ((*mBlockData).height - 1u) + 32u) >> 6u;
      let fs = gs & 0xfu;
      let ft = gt & 0xfu;
      let v = (gs >> 4u) + (gt >> 4u) * (*mBlockData).width;
      let w11 = (fs * ft + 8u) >> 4u;
      let w10 = ft - w11;
      let w01 = fs - w11;
      let w00 = 16u - fs - ft + w11;

      for (var p = 0u; p < pn; p++) {
        let p00 = u32(wv[v * pn + p]);
        let p01 = u32(wv[(v + 1u) * pn + p]);
        let p10 = u32(wv[(v + (*mBlockData).width) * pn + p]);
        let p11 = u32(wv[(v + (*mBlockData).width + 1u) * pn + p]);
        (*mBlockData).weights[i][p] = (p00 * w00 + p01 * w01 + p10 * w10 + p11 * w11 + 8) >> 4;
      }
      i++;
    }
  }
}

/**
 *  pass
*/
fn DecodeEndpoints(blockOriginData: ptr<function, array<u32, 16>>, mBlockData: ptr<function, BlockData>, inputOffset: u32) {
  // 由于 WGSL 不支持动态数组，我们需要使用固定大小的数组来存储解码后的端点值
  var ev: array<i32, 32>; // 最多支持32个端点值
  var epSeq: array<vec2<u32>, 144>; // x: bits, y: nonbits
  
  // 首先解码整数序列
  let offset = select(17u, 29u, (*mBlockData).part_num > 1u);
  DecodeIntseq(blockOriginData, offset, CemTableA[(*mBlockData).cem_range], CemTableB[(*mBlockData).cem_range], (*mBlockData).endpoint_value_num, false, &epSeq);

  // 根据 CemTableA 的值进行不同的解码处理
  let cemA = CemTableA[(*mBlockData).cem_range];
  let cemB = CemTableB[(*mBlockData).cem_range];
  
  if (cemA == 3u) {
    // 三进制解码
    let c = DETritsTable[cemB];
    for (var i = 0u; i < (*mBlockData).endpoint_value_num; i++) {
      let a = select(0, 0x1ff, (epSeq[i].x & 1u) != 0u);
      let x = epSeq[i].x >> 1u;
      var b = 0i;
      
      switch (cemB) {
        case 1u: { b = 0i; break; }
        case 2u: { b = 278 * i32(x); break; }
        case 3u: { b = i32((x << 7u) | (x << 2u) | x); break; }
        case 4u: { b = i32((x << 6u) | x); break; }
        case 5u: { b = i32((x << 5u) | (x >> 2u)); break; }
        case 6u: { b = i32((x << 4u) | (x >> 4u)); break; }
        default: { b = 0i; break; }
      }
      
      ev[i] = ((a & 0x80) | (((i32(epSeq[i].y) * c + b) ^ a) >> 2)) | 0;
    }
  } else if (cemA == 5u) {
    // 五进制解码
    let c = DEQuintsTable[cemB];
    for (var i = 0u; i < (*mBlockData).endpoint_value_num; i++) {
      let a = select(0, 0x1ff, (epSeq[i].x & 1u) != 0u);
      let x = epSeq[i].x >> 1u;
      var b = 0i;
      
      switch (cemB) {
        case 1u: { b = 0i; break; }
        case 2u: { b = 268 * i32(x); break; }
        case 3u: { b = i32((x << 7u) | (x << 1u) | (x >> 1u)); break; }
        case 4u: { b = i32((x << 6u) | (x >> 1u)); break; }
        case 5u: { b = i32((x << 5u) | (x >> 3u)); break; }
        default: { b = 0i; break; }
      }
      
      ev[i] = ((a & 0x80) | (((i32(epSeq[i].y) * c + b) ^ a) >> 2)) | 0;
    }
  } else {
    // 默认情况
    switch (cemB) {
      case 1u: {
        for (var i = 0u; i < (*mBlockData).endpoint_value_num; i++) {
          ev[i] = i32(epSeq[i].x) * 0xff;
        }
        break;
      }
      case 2u: {
        for (var i = 0u; i < (*mBlockData).endpoint_value_num; i++) {
          ev[i] = i32(epSeq[i].x) * 0x55;
        }
        break;
      }
      case 3u: {
        for (var i = 0u; i < (*mBlockData).endpoint_value_num; i++) {
          ev[i] = i32((epSeq[i].x << 5u) | (epSeq[i].x << 2u) | (epSeq[i].x >> 1u));
        }
        break;
      }
      case 4u: {
        for (var i = 0u; i < (*mBlockData).endpoint_value_num; i++) {
          ev[i] = i32((epSeq[i].x << 4u) | epSeq[i].x);
        }
        break;
      }
      case 5u: {
        for (var i = 0u; i < (*mBlockData).endpoint_value_num; i++) {
          ev[i] = i32((epSeq[i].x << 3u) | (epSeq[i].x >> 2u));
        }
        break;
      }
      case 6u: {
        for (var i = 0u; i < (*mBlockData).endpoint_value_num; i++) {
          ev[i] = i32((epSeq[i].x << 2u) | (epSeq[i].x >> 4u));
        }
        break;
      }
      case 7u: {
        for (var i = 0u; i < (*mBlockData).endpoint_value_num; i++) {
          ev[i] = i32((epSeq[i].x << 1u) | (epSeq[i].x >> 6u));
        }
        break;
      }
      case 8u: {
        for (var i = 0u; i < (*mBlockData).endpoint_value_num; i++) {
          ev[i] = i32(epSeq[i].x);
        }
        break;
      }
      default: {
        for (var i = 0u; i < (*mBlockData).endpoint_value_num; i++) {
          ev[i] = i32(epSeq[i].x);
        }
        break;
      }
    }
  }

  // 设置端点数据
  var v = 0u;
  for (var cem = 0u; cem < (*mBlockData).part_num; cem++) {
    switch ((*mBlockData).cem[cem]) {
      case 0u: {
        SetEndpoint(&(*mBlockData).endpoints[cem], ev[v], ev[v], ev[v], 255, ev[v + 1], ev[v + 1], ev[v + 1], 255);
        break;
      }
      case 1u: {
        let l0 = (ev[v] >> 2) | (ev[v + 1] & 0xc0);
        let l1 = Clamp(i32(l0 + (ev[v + 1] & 0x3f)));
        SetEndpoint(&(*mBlockData).endpoints[cem], l0, l0, l0, 255, l1, l1, l1, 255);
        break;
      }
      case 4u: {
        SetEndpoint(&(*mBlockData).endpoints[cem], ev[v], ev[v], ev[v], ev[v + 2], ev[v + 1], ev[v + 1], ev[v + 1], ev[v + 3]);
        break;
      }
      case 5u: {
        BitTransferSigned(&ev, v + 1u, v + 0u);
        BitTransferSigned(&ev, v + 3u, v + 2u);
        ev[v + 1] += ev[v + 0];
        SetEndpointClamp(&(*mBlockData).endpoints[cem], ev[v], ev[v], ev[v], ev[v + 2], ev[v + 1], ev[v + 1], ev[v + 1], ev[v + 2] + ev[v + 3]);
        break;
      }
      case 6u: {
        SetEndpoint(&(*mBlockData).endpoints[cem], (ev[v] * ev[v + 3]) >> 8, (ev[v + 1] * ev[v + 3]) >> 8, (ev[v + 2] * ev[v + 3]) >> 8, 255, ev[v], ev[v + 1], ev[v + 2], 255);
        break;
      }
      case 8u: {
        if (ev[v] + ev[v + 2] + ev[v + 4] <= ev[v + 1] + ev[v + 3] + ev[v + 5]) {
          SetEndpoint(&(*mBlockData).endpoints[cem], ev[v], ev[v + 2], ev[v + 4], 255, ev[v + 1], ev[v + 3], ev[v + 5], 255);
        } else {
          SetEndpointBlue(&(*mBlockData).endpoints[cem], ev[v + 1], ev[v + 3], ev[v + 5], 255, ev[v], ev[v + 2], ev[v + 4], 255);
        }
        break;
      }
      case 9u: {
        BitTransferSigned(&ev, v + 1u, v + 0u);
        BitTransferSigned(&ev, v + 3u, v + 2u);
        BitTransferSigned(&ev, v + 5u, v + 4u);
        if (ev[v + 1] + ev[v + 3] + ev[v + 5] >= 0) {
          SetEndpointClamp(&(*mBlockData).endpoints[cem], ev[v], ev[v + 2], ev[v + 4], 255, ev[v] + ev[v + 1], ev[v + 2] + ev[v + 3], ev[v + 4] + ev[v + 5], 255);
        } else {
          SetEndpointBlueClamp(&(*mBlockData).endpoints[cem], ev[v] + ev[v + 1], ev[v + 2] + ev[v + 3], ev[v + 4] + ev[v + 5], 255, ev[v], ev[v + 2], ev[v + 4], 255);
        }
        break;
      }
      case 10u: {
        SetEndpoint(&(*mBlockData).endpoints[cem], (ev[v] * ev[v + 3]) >> 8, (ev[v + 1] * ev[v + 3]) >> 8, (ev[v + 2] * ev[v + 3]) >> 8, ev[v + 4], ev[v], ev[v + 1], ev[v + 2], ev[v + 5]);
        break;
      }
      case 12u: {
        if (ev[v] + ev[v + 2] + ev[v + 4] <= ev[v + 1] + ev[v + 3] + ev[v + 5]) {
          SetEndpoint(&(*mBlockData).endpoints[cem], ev[v], ev[v + 2], ev[v + 4], ev[v + 6], ev[v + 1], ev[v + 3], ev[v + 5], ev[v + 7]);
        } else {
          SetEndpointBlue(&(*mBlockData).endpoints[cem], ev[v + 1], ev[v + 3], ev[v + 5], ev[v + 7], ev[v], ev[v + 2], ev[v + 4], ev[v + 6]);
        }
        break;
      }
      case 13u: {
        BitTransferSigned(&ev, v + 1u, v + 0u);
        BitTransferSigned(&ev, v + 3u, v + 2u);
        BitTransferSigned(&ev, v + 5u, v + 4u);
        BitTransferSigned(&ev, v + 7u, v + 6u);
        if (ev[v + 1] + ev[v + 3] + ev[v + 5] >= 0) {
          SetEndpointClamp(&(*mBlockData).endpoints[cem], ev[v], ev[v + 2], ev[v + 4], ev[v + 6], ev[v] + ev[v + 1], ev[v + 2] + ev[v + 3], ev[v + 4] + ev[v + 5], ev[v + 6] + ev[v + 7]);
        } else {
          SetEndpointBlueClamp(&(*mBlockData).endpoints[cem], ev[v] + ev[v + 1], ev[v + 2] + ev[v + 3], ev[v + 4] + ev[v + 5], ev[v + 6] + ev[v + 7], ev[v], ev[v + 2], ev[v + 4], ev[v + 6]);
        }
        break;
      }
      default: {
        // 不支持的 ASTC 格式，设置默认值
        SetEndpoint(&(*mBlockData).endpoints[cem], 0, 0, 0, 255, 255, 255, 255, 255);
        break;
      }
    }
    v += (((u32((*mBlockData).cem[cem]) >> 2u) + 1u) * 2u);
  }
}


// 辅助函数：将值限制在 0-255 范围内
fn Clamp(n: i32) -> i32 {
  return select(select(n, 255, n > 255), 0, n < 0);
}

// 辅助函数：有符号位传输
fn BitTransferSigned(buffer: ptr<function, array<i32, 32>>, index1: u32, index2: u32) {
  var a = (*buffer)[index1];
  var b = (*buffer)[index2];
  
  b = (b >> 1) | (a & 0x80);
  a = (a >> 1) & 0x3f;
  if ((a & 0x20) != 0) {
    a = a - 0x40;
  }
  
  (*buffer)[index1] = a;
  (*buffer)[index2] = b;
}

// 辅助函数：设置端点值
// pass
fn SetEndpoint(endpoint: ptr<function, array<i32, 8>>, r1: i32, g1: i32, b1: i32, a1: i32, r2: i32, g2: i32, b2: i32, a2: i32) {
  (*endpoint)[0] = r1;
  (*endpoint)[1] = g1;
  (*endpoint)[2] = b1;
  (*endpoint)[3] = a1;
  (*endpoint)[4] = r2;
  (*endpoint)[5] = g2;
  (*endpoint)[6] = b2;
  (*endpoint)[7] = a2;
}

// 辅助函数：设置端点值并进行限制
// pass
fn SetEndpointClamp(endpoint: ptr<function, array<i32, 8>>, r1: i32, g1: i32, b1: i32, a1: i32, r2: i32, g2: i32, b2: i32, a2: i32) {
  (*endpoint)[0] = Clamp(r1);
  (*endpoint)[1] = Clamp(g1);
  (*endpoint)[2] = Clamp(b1);
  (*endpoint)[3] = Clamp(a1);
  (*endpoint)[4] = Clamp(r2);
  (*endpoint)[5] = Clamp(g2);
  (*endpoint)[6] = Clamp(b2);
  (*endpoint)[7] = Clamp(a2);
}

// 辅助函数：设置蓝色端点值
// pass
fn SetEndpointBlue(endpoint: ptr<function, array<i32, 8>>, r1: i32, g1: i32, b1: i32, a1: i32, r2: i32, g2: i32, b2: i32, a2: i32) {
  (*endpoint)[0] = (r1 + b1) >> 1;
  (*endpoint)[1] = (g1 + b1) >> 1;
  (*endpoint)[2] = b1;
  (*endpoint)[3] = a1;
  (*endpoint)[4] = (r2 + b2) >> 1;
  (*endpoint)[5] = (g2 + b2) >> 1;
  (*endpoint)[6] = b2;
  (*endpoint)[7] = a2;
}

// 辅助函数：设置蓝色端点值并进行限制
// pass
fn SetEndpointBlueClamp(endpoint: ptr<function, array<i32, 8>>, r1: i32, g1: i32, b1: i32, a1: i32, r2: i32, g2: i32, b2: i32, a2: i32) {
  (*endpoint)[0] = Clamp((r1 + b1) >> 1);
  (*endpoint)[1] = Clamp((g1 + b1) >> 1);
  (*endpoint)[2] = Clamp(b1);
  (*endpoint)[3] = Clamp(a1);
  (*endpoint)[4] = Clamp((r2 + b2) >> 1);
  (*endpoint)[5] = Clamp((g2 + b2) >> 1);
  (*endpoint)[6] = Clamp(b2);
  (*endpoint)[7] = Clamp(a2);
}


/**
 *  解码整数序列的函数
 *  
 *  pass
*/
fn DecodeIntseq(blockOriginData: ptr<function, array<u32, 16>>, offset: u32, a: u32, b: u32, count: u32, reverse: bool, epSeq: ptr<function, array<vec2<u32>, 144>>) {
  if (count <= 0u) {
    return;
  }

  var n = 0u;

  if (a == 3u) {
    // 三进制解码
    let mask = (1u << b) - 1u;
    let block_count = (count + 4u) / 5u;
    let last_block_count = (count + 4u) % 5u + 1u;
    let block_size = 8u + 5u * b;
    let last_block_size = (block_size * last_block_count + 4u) / 5u;

    if (reverse) {
      var p = offset;
      for (var i = 0u; i < block_count; i++) {
        let now_size = select(last_block_size, block_size, i < block_count - 1u);
        let d = BitReverseU64(GetBits64(blockOriginData, p - now_size, now_size), now_size);
        let x = (u642u32(u64_right_cal(d, b)) & 3u) | 
               (u642u32(u64_right_cal(d, 2u * b)) & 0xcu) | 
               (u642u32(u64_right_cal(d, 3u * b)) & 0x10u) | 
               (u642u32(u64_right_cal(d, 4u * b)) & 0x60u) | 
               (u642u32(u64_right_cal(d, 5u * b)) & 0x80u);
        
        for (var j = 0u; j < 5u && n < count; j++) {
          let bits_val = u642u32(u64_right_cal(d, DImt[j] + b * j)) & mask;
          let nonbits_val = GetDITritsTable(j, x);
          (*epSeq)[n] = vec2<u32>(bits_val, nonbits_val);
          n++;
        }
        p -= block_size;
      }
    } else {
      var p = offset;
      for (var i = 0u; i < block_count; i++) {
        let now_size = select(last_block_size, block_size, i < block_count - 1u);
        let d = GetBits64(blockOriginData, p, now_size);
        let x = (u642u32(u64_right_cal(d, b)) & 3u) | 
               (u642u32(u64_right_cal(d, 2u * b)) & 0xcu) | 
               (u642u32(u64_right_cal(d, 3u * b)) & 0x10u) | 
               (u642u32(u64_right_cal(d, 4u * b)) & 0x60u) | 
               (u642u32(u64_right_cal(d, 5u * b)) & 0x80u);
        
        for (var j = 0u; j < 5u && n < count; j++) {
          let bits_val = u642u32(u64_right_cal(d, DImt[j] + b * j)) & mask;
          let nonbits_val = GetDITritsTable(j, x);
          (*epSeq)[n] = vec2<u32>(bits_val, nonbits_val);
          n++;
        }
        p += block_size;
      }
    }
  } else if (a == 5u) {
    // 五进制解码
    let mask = (1u << b) - 1u;
    let block_count = (count + 2u) / 3u;
    let last_block_count = (count + 2u) % 3u + 1u;
    let block_size = 7u + 3u * b;
    let last_block_size = (block_size * last_block_count + 2u) / 3u;

    if (reverse) {
      var p = offset;
      for (var i = 0u; i < block_count; i++) {
        let now_size = select(last_block_size, block_size, i < block_count - 1u);
        let d = BitReverseU64(GetBits64(blockOriginData, p - now_size, now_size), now_size);
        let x = (u642u32(u64_right_cal(d, b)) & 7u) | 
               (u642u32(u64_right_cal(d, 2u * b)) & 0x18u) | 
               (u642u32(u64_right_cal(d, 3u * b)) & 0x60u);
        
        for (var j = 0u; j < 3u && n < count; j++) {
          let bits_val = u642u32(u64_right_cal(d, DImq[j] + b * j)) & mask;
          let nonbits_val = GetDIQuintsTable(j, x);
          (*epSeq)[n] = vec2<u32>(bits_val, nonbits_val);
          n++;
        }
        p -= block_size;
      }
    } else {
      var p = offset;
      for (var i = 0u; i < block_count; i++) {
        let now_size = select(last_block_size, block_size, i < block_count - 1u);
        let d = GetBits64(blockOriginData, p, now_size);
        let x = (u642u32(u64_right_cal(d, b)) & 7u) | 
               (u642u32(u64_right_cal(d, 2u * b)) & 0x18u) | 
               (u642u32(u64_right_cal(d, 3u * b)) & 0x60u);
        
        for (var j = 0u; j < 3u && n < count; j++) {
          let bits_val = u642u32(u64_right_cal(d, DImq[j] + b * j)) & mask;
          let nonbits_val = GetDIQuintsTable(j, x);
          (*epSeq)[n] = vec2<u32>(bits_val, nonbits_val);
          n++;
        }
        p += block_size;
      }
    }
  } else {
    // 普通解码
    if (reverse) {
      var p = offset - b;
      while (n < count) {
        let bits_val = BitReverseU8(GetBits(blockOriginData, p, b), b);
        (*epSeq)[n] = vec2<u32>(bits_val, 0u);
        n++;
        p -= b;
      }
    } else {
      var p = offset;
      while (n < count) {
        let bits_val = GetBits(blockOriginData, p, b);
        (*epSeq)[n] = vec2<u32>(bits_val, 0u);
        n++;
        p += b;
      }
    }
  }
}

/**
 *  U64 反转
 *  
 *  pass
*/
fn BitReverseU64(bits64: vec2<u32>, size: u32) -> vec2<u32> {
  // 基于 C# 版本的 BitReverseU64 实现
  // 对64位值的每个字节进行位反转，然后右移 (64 - size) 位
  
  // 提取每个字节并查表反转
  // 注意：bits64.x 是高位，bits64.y 是低位
  let byte0 = (bits64.y >> 0u) & 0xffu;
  let byte1 = (bits64.y >> 8u) & 0xffu;  
  let byte2 = (bits64.y >> 16u) & 0xffu;
  let byte3 = (bits64.y >> 24u) & 0xffu;
  let byte4 = (bits64.x >> 0u) & 0xffu;
  let byte5 = (bits64.x >> 8u) & 0xffu;
  let byte6 = (bits64.x >> 16u) & 0xffu;
  let byte7 = (bits64.x >> 24u) & 0xffu;
  
  // 构建反转后的64位值
  var reversed: vec2<u32>;
  // 高32位：包含反转后的 byte0~byte3
  reversed.x = (BitReverseTable[byte0] << 24u) | 
              (BitReverseTable[byte1] << 16u) | 
              (BitReverseTable[byte2] << 8u) | 
              BitReverseTable[byte3];
  // 低32位：包含反转后的 byte4~byte7  
  reversed.y = (BitReverseTable[byte4] << 24u) | 
              (BitReverseTable[byte5] << 16u) | 
              (BitReverseTable[byte6] << 8u) | 
              BitReverseTable[byte7];
  
  // 右移 (64 - size) 位
  if (size >= 64u) {
    return reversed;
  } else {
    return u64_right_cal(reversed, 64u - size);
  }
}

 /**
 *  读取一个u64数据
 *  blockOriginData: 原始数据，每个元素用 u32 存储一个 u8，所以读取的时候需要读取 8 个 u32 数据，取其 u8 拼合
 *  
 *  pass
*/
fn BitConverterToU64(blockOriginData: ptr<function, array<u32, 16>>, ioff: u32) -> vec2<u32> {
  // 从指定偏移开始读取8个字节，组成u64
  // iooff: 字节偏移量
  
  // 检查边界
  if (ioff + 8u > 16u) {
    return vec2<u32>(0u, 0u);
  }
  
  // 读取8个字节，输入的 blockOriginData 中每个元素保存一个字节 (小端序)
  // C# 的 BitConverter.ToUInt64 在小端主机上以低位字节为低含义字节
  // 我们需要构建与 C# 等价的 vec2<u32>：x=高32位, y=低32位
  // low32 = b0 | b1<<8 | b2<<16 | b3<<24
  // high32 = b4 | b5<<8 | b6<<16 | b7<<24

  let low_part = ((*blockOriginData)[ioff + 0u]) |
                 ((*blockOriginData)[ioff + 1u] << 8u) |
                 ((*blockOriginData)[ioff + 2u] << 16u) |
                 ((*blockOriginData)[ioff + 3u] << 24u);

  let high_part = ((*blockOriginData)[ioff + 4u]) |
                  ((*blockOriginData)[ioff + 5u] << 8u) |
                  ((*blockOriginData)[ioff + 6u] << 16u) |
                  ((*blockOriginData)[ioff + 7u] << 24u);

  return vec2<u32>(high_part, low_part);
}

/**
 *  pass
*/
fn GetBits64(blockOriginData: ptr<function, array<u32, 16>>, bit: u32, len: u32) -> vec2<u32> {
  // 基于C#版本的GetBits64实现，使用已实现的u64运算函数
  
  // 创建掩码：len == 64 ? 0xffffffffffffffff : (1UL << len) - 1
  var mask: vec2<u32>;
  if (len >= 64u) {
    mask = vec2<u32>(0xffffffffu, 0xffffffffu);
  } else if (len == 0u) {
    mask = vec2<u32>(0u, 0u);
  } else if (len <= 32u) {
    // 低 32 位有 len 个 1，高 32 位为 0
    mask = vec2<u32>(0u, ((1u << len) - 1u));
  } else {
    // len > 32 && len < 64
    let highBits = len - 32u;
    mask = vec2<u32>(((1u << highBits) - 1u), 0xffffffffu);
  }
  
  if (len == 0u) {
    return vec2<u32>(0u, 0u);
  } else if (bit >= 64u) {
    // return BitConverter.ToUInt64(input, ioff + 8) >> (bit - 64) & mask;
    let data = BitConverterToU64(blockOriginData, 8u);
    let shifted = u64_right_cal(data, bit - 64u);
    return u64_and_cal(shifted, mask);
  } else if (bit == 0u) {
    // return BitConverter.ToUInt64(input, ioff) << 0 & mask; (简化了C#中的 -bit)
    let data = BitConverterToU64(blockOriginData, 0u);
    return u64_and_cal(data, mask);
  } else if (bit + len <= 64u) {
    // return BitConverter.ToUInt64(input, ioff) >> bit & mask;
    let data = BitConverterToU64(blockOriginData, 0u);
    let shifted = u64_right_cal(data, bit);
    return u64_and_cal(shifted, mask);
  } else {
    // return (BitConverter.ToUInt64(input, ioff) >> bit | BitConverter.ToUInt64(input, ioff + 8) << (64 - bit)) & mask;
    let data1 = BitConverterToU64(blockOriginData, 0u);
    let data2 = BitConverterToU64(blockOriginData, 8u);
    let shifted1 = u64_right_cal(data1, bit);
    let shifted2 = u64_left_cal(data2, 64u - bit);
    let combined = u64_or_cal(shifted1, shifted2);
    return u64_and_cal(combined, mask);
  }
}

/**
 *  使用 vec2<u32> 来存储 u64 数据
 *  bitCount 表示右移的位数
 *  返回一个新的 vec2<u32> 数据
 * 
 *  pass
*/
fn u64_right_cal(value: vec2<u32>, bitCount: u32) -> vec2<u32> {
  // 处理右移操作，value.x 是高位，value.y 是低位
  // 语义：整体 64 位向右移 bitCount 位
  if (bitCount == 0u) {
    return value;
  } else if (bitCount >= 64u) {
    return vec2<u32>(0u, 0u);
  } else if (bitCount >= 32u) {
    // 右移 >=32 位：高位整体移入低位，新的高位为0
    let shift = bitCount - 32u;
    return vec2<u32>(0u, value.x >> shift);
  } else {
    // 右移 1..31 位：低位由高位低位组合而成
    return vec2<u32>(value.x >> bitCount, (value.x << (32u - bitCount)) | (value.y >> bitCount));
  }
}

/**
 *  使用 vec2<u32> 来存储 u64 数据
 *  bitCount 表示左移的位数
 *  返回一个新的 vec2<u32> 数据
 *  
 *  pass
*/
fn u64_left_cal(value: vec2<u32>, bitCount: u32) -> vec2<u32> {
  // 处理左移操作，value.x 是高位，value.y 是低位
  // 语义：整体 64 位向左移 bitCount 位
  if (bitCount == 0u) {
    return value;
  } else if (bitCount >= 64u) {
    return vec2<u32>(0u, 0u);
  } else if (bitCount >= 32u) {
    // 左移 >=32 位：低位整体移入高位，新的低位为0
    let shift = bitCount - 32u;
    return vec2<u32>(value.y << shift, 0u);
  } else {
    // 左移 1..31 位：高位由高位低位组合而成
    return vec2<u32>((value.x << bitCount) | (value.y >> (32u - bitCount)), value.y << bitCount);
  }
}

/**
 *  使用 vec2<u32> 来存储 u64 数据
 *  value1 与 value2 做 & 运算
 *  返回一个新的 vec2<u32> 数据
 * 
 *  pass
*/
fn u64_and_cal(value1: vec2<u32>, value2: vec2<u32>) -> vec2<u32> {
  // 处理与运算，分别对高位和低位进行与操作
  return vec2<u32>(value1.x & value2.x, value1.y & value2.y);
}

/**
 *  使用 vec2<u32> 来存储 u64 数据
 *  value1 与 value2 做 | 运算
 *  返回一个新的 vec2<u32> 数据
 * 
 *  pass
*/
fn u64_or_cal(value1: vec2<u32>, value2: vec2<u32>) -> vec2<u32> {
  // 处理或运算，分别对高位和低位进行或操作
  return vec2<u32>(value1.x | value2.x, value1.y | value2.y);
}

/**
 * vec2<u32> 数据转换为 u32 数据
 * x 是高位，y 是低位
 * 返回一个 u32 数据
 * 
 * pass
*/
fn u642u32(value: vec2<u32>) -> u32 {
  // 如果高32位不为0，说明数据超过u32范围，这里可以根据需求处理
  // 暂时返回低32位
  return value.y;
}

/**
 * 8位位反转函数
 * @param bits 要反转的8位值
 * @param size 反转的位数
 * @return 反转后的值
 */
fn BitReverseU8(bits: u32, size: u32) -> u32 {
  // 使用位反转表进行8位反转，然后右移 (8 - size) 位
  let reversed = BitReverseTable[bits & 0xffu];
  if (size >= 8u) {
    return reversed;
  } else {
    return reversed >> (8u - size);
  }
}

/**
 *  WGSL 版本的 GetBits 函数：从字节数组中指定位开始读取指定位数的值
 *  @param blockOriginData 块数据（每个字节存储在u32中）
 *  @param bitOffset 位的偏移量（从0开始）
 *  @param bitLen 要读取的位数
 *  @return 读取到的值
 * 
 *  pass
*/
fn GetBits(blockOriginData: ptr<function, array<u32, 16>>, bitOffset: u32, bitLen: u32) -> u32 {
  let byteOffset = bitOffset / 8u;
  let bitInByte = bitOffset % 8u;
  
  // 安全读取4个字节作为32位整数（小端序）
  // blockOriginData 只有16个元素(index 0-15)，需要处理边界
  var dword = 0u;
  if (byteOffset < 16u) {
    dword = (*blockOriginData)[byteOffset];
  }
  if (byteOffset + 1u < 16u) {
    dword |= (*blockOriginData)[byteOffset + 1u] << 8u;
  }
  if (byteOffset + 2u < 16u) {
    dword |= (*blockOriginData)[byteOffset + 2u] << 16u;
  }
  if (byteOffset + 3u < 16u) {
    dword |= (*blockOriginData)[byteOffset + 3u] << 24u;
  }
  
  // 右移到目标位位置，然后使用位掩码提取指定位数
  return (dword >> bitInByte) & ((1u << bitLen) - 1u);
}

/**
 *  实现一个 WGSL 的 getUint32 函数
 *  这里的 blockOriginData 是一个用 u32 数组表示的 u8 数据
 *  所以取 byteOffset 需要从 byteOffset 开始 byteOffset+0、+1、+2、+3 取其 u8 数据组成一个新的 u32 数据
 *  
 *  pass
*/
fn GetUint32(blockOriginData: ptr<function, array<u32, 16>>, byteOffset: u32) -> u32 {
  // 从指定字节偏移开始读取4个字节，组成32位小端序整数
  // 安全处理边界
  var result = 0u;
  if (byteOffset < 16u) {
    result = (*blockOriginData)[byteOffset];
  }
  if (byteOffset + 1u < 16u) {
    result |= (*blockOriginData)[byteOffset + 1u] << 8u;
  }
  if (byteOffset + 2u < 16u) {
    result |= (*blockOriginData)[byteOffset + 2u] << 16u;
  }
  if (byteOffset + 3u < 16u) {
    result |= (*blockOriginData)[byteOffset + 3u] << 24u;
  }
  return result;
}

/**
 *  解码块参数：解析块头信息，包括分区数量、权重尺寸、双平面等
 *  @param blockOriginData 块数据（每个字节存储在u32中）
 *  @param mBlockData 输出的块数据结构
 * 
 *  pass
*/
fn DecodeBlockParameters(blockOriginData: ptr<function, array<u32, 16>>, mBlockData: ptr<function, BlockData>, inputOffset: u32) {

  // 解析基本参数
  (*mBlockData).dual_plane = ((*blockOriginData)[1u] & 4u) >> 2u;
  (*mBlockData).weight_range = (((*blockOriginData)[0u] >> 4u) & 1u) | (((*blockOriginData)[1u] << 2u) & 8u);
  
  // 解析块的宽度和高度
  if (((*blockOriginData)[0u] & 3u) != 0u) {
    (*mBlockData).weight_range |= (((*blockOriginData)[0u] << 1u) & 6u);
    let temp = ((*blockOriginData)[0u] & 0xcu);
    if (temp == 0u) {
      (*mBlockData).width = ((inBuf.values[inputOffset] >> 7u) & 3) + 4u;
      (*mBlockData).height = (((*blockOriginData)[0u] >> 5u) & 3u) + 2u;
    } else if (temp == 4u) {
      (*mBlockData).width = ((inBuf.values[inputOffset] >> 7u) & 3) + 8u;
      (*mBlockData).height = (((*blockOriginData)[0u] >> 5u) & 3u) + 2u;
    } else if (temp == 8u) {
      (*mBlockData).width = (((*blockOriginData)[0u] >> 5u) & 3u) + 2u;
      (*mBlockData).height = ((inBuf.values[inputOffset] >> 7u) & 3) + 8u;
    } else { // temp == 12u
      if (((*blockOriginData)[1u] & 1u) != 0u) {
        (*mBlockData).width = (((*blockOriginData)[0u] >> 7u) & 1u) + 2u;
        (*mBlockData).height = (((*blockOriginData)[0u] >> 5u) & 3u) + 2u;
      } else {
        (*mBlockData).width = (((*blockOriginData)[0u] >> 5u) & 3u) + 2u;
        (*mBlockData).height = (((*blockOriginData)[0u] >> 7u) & 1u) + 6u;
      }
    }
  } else {
    (*mBlockData).weight_range |= (((*blockOriginData)[0u] >> 1u) & 6u);
    let temp = inBuf.values[inputOffset] & 0x180u;
    if (temp == 0u) {
      (*mBlockData).width = 12u;
      (*mBlockData).height = (((*blockOriginData)[0u] >> 5u) & 3u) + 2u;
    } else if (temp == 0x80u) {
      (*mBlockData).width = (((*blockOriginData)[0u] >> 5u) & 3u) + 2u;
      (*mBlockData).height = 12u;
    } else if (temp == 0x100) {
      (*mBlockData).width = (((*blockOriginData)[0u] >> 5u) & 3u) + 6u;
      (*mBlockData).height = (((*blockOriginData)[1u] >> 1u) & 3u) + 6u;
      (*mBlockData).dual_plane = 0u;
      (*mBlockData).weight_range &= 7u;
    } else { // temp == 0x180
      if (((*blockOriginData)[0u] & 0x20u) != 0u) {
        (*mBlockData).width = 10u;
        (*mBlockData).height = 6u;
      } else {
        (*mBlockData).width = 6u;
        (*mBlockData).height = 10u;
      }
    }
  }
  
  // 分区数量
  (*mBlockData).part_num = (((*blockOriginData)[1u] >> 3u) & 3u) + 1u;
  
  // 权重数量
  (*mBlockData).weight_num = (*mBlockData).width * (*mBlockData).height;
  if ((*mBlockData).dual_plane != 0u) {
    (*mBlockData).weight_num *= 2u;
  }
  
  var weight_bits: u32;
  var config_bits: u32;
  var cem_base: u32 = 0u;
  
  // 计算权重位数
  let weightPrecA = WeightPrecTableA[(*mBlockData).weight_range];
  let weightPrecB = WeightPrecTableB[(*mBlockData).weight_range];
  
  if (weightPrecA == 3u) {
    weight_bits = (*mBlockData).weight_num * weightPrecB + (((*mBlockData).weight_num * 8u + 4u) / 5u);
  } else if (weightPrecA == 5u) {
    weight_bits = (*mBlockData).weight_num * weightPrecB + (((*mBlockData).weight_num * 7u + 2u) / 3u);
  } else {
    weight_bits = (*mBlockData).weight_num * weightPrecB;
  }

  // 解析颜色端点模式 (CEM)
  if ((*mBlockData).part_num == 1u) {
    (*mBlockData).cem[0u] = (GetUint32(blockOriginData, 1u) >> 5u) & 0xfu;
    config_bits = 17u;
  } else {
    cem_base = (GetUint32(blockOriginData, 2u) >> 7u) & 3u;
    if (cem_base == 0u) {
      let cem = (((*blockOriginData)[3u] >> 1u) & 0xfu);
      for (var i = 0u; i < (*mBlockData).part_num; i++) {
        (*mBlockData).cem[i] = cem;
      }
      config_bits = 29u;
    } else {
      for (var i = 0u; i < (*mBlockData).part_num; i++) {
        (*mBlockData).cem[i] = (((((*blockOriginData)[3u] >> (i + 1u)) & 1u) + cem_base - 1u) << 2u);
      }
      
      if ((*mBlockData).part_num == 2u) {
        (*mBlockData).cem[0u] |= (((*blockOriginData)[3u] >> 3u) & 3u);
        (*mBlockData).cem[1u] |= GetBits(blockOriginData, 126u - weight_bits, 2u);
      } else if ((*mBlockData).part_num == 3u) {
        (*mBlockData).cem[0u] |= (((*blockOriginData)[3u] >> 4u) & 1u);
        (*mBlockData).cem[0u] |= GetBits(blockOriginData, 122u - weight_bits, 2u) & 2u;
        (*mBlockData).cem[1u] |= GetBits(blockOriginData, 124u - weight_bits, 2u);
        (*mBlockData).cem[2u] |= GetBits(blockOriginData, 126u - weight_bits, 2u);
      } else { // part_num == 4u
        for (var i = 0u; i < 4u; i++) {
          (*mBlockData).cem[i] |= GetBits(blockOriginData, 120u + i * 2u - weight_bits, 2u);
        }
      }
      config_bits = 25u + (*mBlockData).part_num * 3u;
    }
  }
  
  // 双平面选择器
  if ((*mBlockData).dual_plane != 0u) {
    config_bits += 2u;
    if (cem_base != 0u) {
      (*mBlockData).plane_selector = GetBits(blockOriginData, 130u - weight_bits - (*mBlockData).part_num * 3u, 2u);
    } else {
      (*mBlockData).plane_selector = GetBits(blockOriginData, 126u - weight_bits, 2u);
    }
  }
  
  // 计算剩余位数
  let remain_bits = 128u - config_bits - weight_bits;
  
  // 计算端点值数量
  (*mBlockData).endpoint_value_num = 0u;
  for (var i = 0u; i < (*mBlockData).part_num; i++) {
    (*mBlockData).endpoint_value_num += ((((*mBlockData).cem[i] >> 1u) & 6u) + 2u);
  }
  
  // 确定 CEM 范围
  (*mBlockData).cem_range = 0u;
  for (var i = 0u; i < 19u; i++) {
    var endpoint_bits: u32;
    let cemA = CemTableA[i];
    let cemB = CemTableB[i];
    
    if (cemA == 3u) {
      endpoint_bits = (*mBlockData).endpoint_value_num * cemB + (((*mBlockData).endpoint_value_num * 8u + 4u) / 5u);
    } else if (cemA == 5u) {
      endpoint_bits = (*mBlockData).endpoint_value_num * cemB + (((*mBlockData).endpoint_value_num * 7u + 2u) / 3u);
    } else {
      endpoint_bits = (*mBlockData).endpoint_value_num * cemB;
    }
    
    if (endpoint_bits <= remain_bits) {
      (*mBlockData).cem_range = i;
      break;
    }
  }
}

// 根据权重在两个端点颜色之间进行插值
fn SelectColor(v0: i32, v1: i32, weight: u32) -> i32 {
  // C# 实现：return (byte)(((((v0 << 8 | v0) * (64 - weight) + (v1 << 8 | v1) * weight + 32) >> 6) * 255 + 32768) / 65536);
  let v0Expanded = (v0 << 8) | v0;
  let v1Expanded = (v1 << 8) | v1;
  let weightedSum = (v0Expanded * (64 - i32(weight))) + (v1Expanded * i32(weight)) + 32;
  let interpolated = (weightedSum >> 6) * 255 + 32768;
  return (interpolated / 65536);
}

// 应用颜色到输出缓冲区
fn ApplicateColor(mBlockData: ptr<function, BlockData>, blockBuffer: ptr<function, array<u32, 144>>) {
  var planeSelector: array<u32, 4>;
  
  if (mBlockData.dual_plane != 0u) {
    // 初始化平面选择器
    planeSelector[0] = 0u;
    planeSelector[1] = 0u;
    planeSelector[2] = 0u;
    planeSelector[3] = 0u;
    planeSelector[mBlockData.plane_selector] = 1u;
    
    if (mBlockData.part_num > 1u) {
      // 双平面 + 多分区
      for (var i = 0u; i < (mBlockData.bw * mBlockData.bh); i++) {
        let p = mBlockData.partitions[i];
        let r = SelectColor(mBlockData.endpoints[p][0], mBlockData.endpoints[p][4], mBlockData.weights[i][planeSelector[0]]);
        let g = SelectColor(mBlockData.endpoints[p][1], mBlockData.endpoints[p][5], mBlockData.weights[i][planeSelector[1]]);
        let b = SelectColor(mBlockData.endpoints[p][2], mBlockData.endpoints[p][6], mBlockData.weights[i][planeSelector[2]]);
        let a = SelectColor(mBlockData.endpoints[p][3], mBlockData.endpoints[p][7], mBlockData.weights[i][planeSelector[3]]);
        (*blockBuffer)[i] = Color(r, g, b, a);
      }
    } else {
      // 双平面 + 单分区
      for (var i = 0u; i < (mBlockData.bw * mBlockData.bh); i++) {
        let r = SelectColor(mBlockData.endpoints[0][0], mBlockData.endpoints[0][4], mBlockData.weights[i][planeSelector[0]]);
        let g = SelectColor(mBlockData.endpoints[0][1], mBlockData.endpoints[0][5], mBlockData.weights[i][planeSelector[1]]);
        let b = SelectColor(mBlockData.endpoints[0][2], mBlockData.endpoints[0][6], mBlockData.weights[i][planeSelector[2]]);
        let a = SelectColor(mBlockData.endpoints[0][3], mBlockData.endpoints[0][7], mBlockData.weights[i][planeSelector[3]]);
        (*blockBuffer)[i] = Color(r, g, b, a);
      }
    }
  } else if (mBlockData.part_num > 1u) {
    // 单平面 + 多分区
    for (var i = 0u; i < (mBlockData.bw * mBlockData.bh); i++) {
      let p = mBlockData.partitions[i];
      let r = SelectColor(mBlockData.endpoints[p][0], mBlockData.endpoints[p][4], mBlockData.weights[i][0]);
      let g = SelectColor(mBlockData.endpoints[p][1], mBlockData.endpoints[p][5], mBlockData.weights[i][0]);
      let b = SelectColor(mBlockData.endpoints[p][2], mBlockData.endpoints[p][6], mBlockData.weights[i][0]);
      let a = SelectColor(mBlockData.endpoints[p][3], mBlockData.endpoints[p][7], mBlockData.weights[i][0]);
      (*blockBuffer)[i] = Color(r, g, b, a);
    }
  } else {
    // 单平面 + 单分区
    for (var i = 0u; i < (mBlockData.bw * mBlockData.bh); i++) {
      let r = SelectColor(mBlockData.endpoints[0][0], mBlockData.endpoints[0][4], mBlockData.weights[i][0]);
      let g = SelectColor(mBlockData.endpoints[0][1], mBlockData.endpoints[0][5], mBlockData.weights[i][0]);
      let b = SelectColor(mBlockData.endpoints[0][2], mBlockData.endpoints[0][6], mBlockData.weights[i][0]);
      let a = SelectColor(mBlockData.endpoints[0][3], mBlockData.endpoints[0][7], mBlockData.weights[i][0]);
      (*blockBuffer)[i] = Color(r, g, b, a);
    }
  }
}

/*
  Color(r, g, b, a) {
    return ((a & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
  }
  这里尊重 c# 原始的顺序，返回的是 a r g b

  pass
*/
fn Color(r: i32, g: i32, b: i32, a: i32) -> u32 {
  return ColorU32(u32(r), u32(g), u32(b), u32(a));
}

fn ColorU32(r: u32, g: u32, b: u32, a: u32) -> u32 {
  return ((r & 0xffu) << 24u) | ((g & 0xffu) << 16u) | ((b & 0xffu) << 8u) | (a & 0xffu);
}

`;

  // ======================================================================
  // 内嵌模块：WebGPUASTCPipelineInit
  // ======================================================================
  class WebGPUASTCPipelineInit {

  // ============ pipeline 初始 ============
  _adapter = null;
  _device = null;
  _shaderModule = null;
  _pipeline = null;
  _workgroupSize = 64; // 用于修改shader占位符，在pipeline创建的时候就已经确定
  

  // ============ webGPU pipeline 初始化 ==================
  async WebGPUPipelineInitialize(){
    const timings = {};
    const pipelineStartTime = performance.now();

    // 1. 检查 WebGPU 支持
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported');
    }

    // 2. 获取 Adapter
    let t0 = performance.now();
    this._adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance'
    });
    timings['requestAdapter (系统I/O)'] = performance.now() - t0;
    if (!this._adapter) {
      throw new Error('Failed to get webGPU adapter');
    }

    // 3. 获取 Device
    t0 = performance.now();
    this._device = await this._adapter.requestDevice({
      requiredFeatures: [],//后续可填充
      requiredLimits: {}//后续可填充
    });
    timings['requestDevice (系统I/O)'] = performance.now() - t0;
    if (!this._device) {
      throw new Error('Failed to get webGPU device');
    }

    // 4. 创建 shader module
    t0 = performance.now();
    await this.createShaderModule();
    timings['createShaderModule (网络I/O+GPU编译)'] = performance.now() - t0;

    if(!this._shaderModule){
      throw new Error('Failed to create webGPU decoder shader module');
    }

    // 5. 创建 Compute Pipeline
    t0 = performance.now();
    this._pipeline = this._device.createComputePipeline({
      label: 'WebGPU Pipeline for ASTC Decoder',
      layout: 'auto',
      compute: {
        module: this._shaderModule,
        entryPoint: 'main'
      }
    });
    timings['createComputePipeline (GPU编译)'] = performance.now() - t0;

    if(!this._pipeline){
      throw new Error('Failed to get webGPU pipeline');
    }

    timings['Pipeline总耗时'] = performance.now() - pipelineStartTime;

    // 输出 Pipeline 初始化耗时报告
    if (_SDK_DEBUG) {
      console.log('%c========== Pipeline 初始化耗时报告 ==========', 'color: #ff6600; font-weight: bold; font-size: 14px;');
      const total = timings['Pipeline总耗时'];
      for (const [key, value] of Object.entries(timings)) {
        const pct = ((value / total) * 100).toFixed(1);
        console.log(`  [Pipeline] ${key}: ${value.toFixed(2)}ms (${pct}%)`);
      }
      console.log('%c=============================================', 'color: #ff6600; font-weight: bold;');
    }

    this.consoleLog();
  }

  
  // 创建 shader module；需要关注@compute @workgroup_size
  async createShaderModule(){
    this._workgroupSize = this.getWorkGroupSize();

    // 使用构建时内联的 WGSL 代码（无需网络/文件系统）
    let shaderCode = __INLINE_WGSL_CODE__;

    // 将占位符替换为实际的 workgroup_size
    shaderCode = shaderCode.replace('__WORKGROUP_SIZE__', String(this._workgroupSize));

    this._shaderModule = this._device.createShaderModule({
      label: 'ASTC Decoder Compute Shader',
      code: shaderCode
    });
  }

  getWorkGroupSize(){
    const maxSize = parseInt(this._adapter.limits.maxComputeWorkgroupSizeX / 3);
    const size = Math.pow(2, Math.floor(Math.log2(maxSize)));
    if(_SDK_DEBUG){
      console.log("getWorkGroupSize() = %d", size);
    }
    return size;
  }

  consoleLog(){
    // limits
    const limits = this._adapter.limits;
    _SDK_DEBUG && console.log('[WebGPU] Adapter limits:');
    _SDK_DEBUG && console.log('  - Max compute workgroups per dimension:', limits.maxComputeWorkgroupsPerDimension);
    _SDK_DEBUG && console.log('  - Max workgroup size X:', limits.maxComputeWorkgroupSizeX);
    _SDK_DEBUG && console.log('  - Max workgroup size Y:', limits.maxComputeWorkgroupSizeY);
    _SDK_DEBUG && console.log('  - Max workgroup size Z:', limits.maxComputeWorkgroupSizeZ);
    _SDK_DEBUG && console.log('  - Max total threads per workgroup:', limits.maxComputeInvocationsPerWorkgroup);

    _SDK_DEBUG && console.log('[WebGPU] Pipeline initialized successfully');
  }
}

  // ======================================================================
  // 内嵌模块：WebGPUASTCTextureFactory
  // ======================================================================
  // 使用示例
/*
// 创建纹理工厂实例
const textureFactory = new WebGPUASTCTextureFactory();

// 在 glCompressedTexImage2D 中调用，自动使用 window._lastTextureId
// glGenTextures() → window._lastTextureId = 123
// glBindTexture(TEXTURE_2D, 123)
// glCompressedTexImage2D() → AddASTCTexture(data, w, h, bw, bh) → returns 123
const textureId = textureFactory.AddASTCTexture(astcData, 512, 512, 8, 8);

// 获取队列统计
console.log('队列统计:', textureFactory.getQueueStats());

// 获取待解码纹理（按优先级排序）
const undecodedTextures = textureFactory.getUndecodedTextures();

// 解码完成后标记
textureFactory.markTextureAsDecoded(textureId, decodedPixelData);

// 解码完成后用同一个 textureId 回写 WebGL
// GLctx.bindTexture(GLctx.TEXTURE_2D, GL.textures[textureId]);
// GLctx.texImage2D(..., decodedData);
*/


class WebGPUASTCTextureFactory{

  constructor() {
    this.decodedList = new Map(); // 已解码纹理队列 Map<glTextureId, TextureInfo>
    this.undecodedList = new Map(); // 未解码纹理队列 Map<glTextureId, TextureInfo>
  }

  /**
   * 添加ASTC纹理到队列
   * @param {Uint8Array|ArrayBuffer} data - ASTC压缩数据
   * @param {number} width - 图像宽度
   * @param {number} height - 图像高度
   * @param {number} blockWidth_ - 块宽度
   * @param {number} blockHeight_ - 块高度
   * @returns {number} 返回 WebGL 的纹理ID (即 window._lastTextureId)
   */
  AddASTCTexture(data, width, height, blockWidth_, blockHeight_){
    // 使用 glGenTextures 分配的 WebGL TextureId
    const textureId = window._lastTextureId;
    
    if (textureId === undefined || textureId === null) {
      console.error('[WebGPUASTCTextureFactory] 无法获取 WebGL TextureId，请确保在 glGenTextures 之后调用');
      return -1;
    }
    
    // 计算块相关参数
    const imgWidth = width;
    const imgHeight = height;
    const blockWidth = blockWidth_;
    const blockHeight = blockHeight_;
    const blockCountX = Math.floor((imgWidth + blockWidth - 1) / blockWidth);
    const blockCountY = Math.floor((imgHeight + blockHeight - 1) / blockHeight);
    const totalBlocks = blockCountX * blockCountY;
    
    // 验证数据完整性
    const expectedDataSize = totalBlocks * 16; // 每个ASTC块16字节
    const actualDataSize = data instanceof ArrayBuffer ? data.byteLength : data.length;
    
    if (actualDataSize < expectedDataSize) {
      _SDK_DEBUG && console.warn(`[WebGPUASTCTextureFactory] 数据大小不匹配: 期望 ${expectedDataSize} 字节，实际 ${actualDataSize} 字节`);
    }
    
    // 创建纹理信息对象
    const textureInfo = {
      id: textureId, // WebGL TextureId (整数)
      data: data instanceof ArrayBuffer ? new Uint8Array(data) : data,
      width: imgWidth,
      height: imgHeight,
      blockWidth: blockWidth,
      blockHeight: blockHeight,
      blockCountX: blockCountX,
      blockCountY: blockCountY,
      totalBlocks: totalBlocks,
      dataSize: actualDataSize,
      createTime: Date.now(),
      status: 'pending', // pending, decoding, decoded, error
      priority: this._calculatePriority(imgWidth, imgHeight), // 根据尺寸计算优先级
      retryCount: 0,
      maxRetries: 3
    };
    
    // 添加到未解码队列，使用 WebGL TextureId 作为 key
    this.undecodedList.set(textureId, textureInfo);
    
    _SDK_DEBUG && console.log(`[WebGPUASTCTextureFactory.AddASTCTexture] 添加纹理到队列, glTextureId: ${textureId}`, {
      size: `${width}x${height}`,
      blockSize: `${blockWidth_}x${blockHeight_}`,
      blocks: `${blockCountX}x${blockCountY}=${totalBlocks}`,
      dataSize: `${actualDataSize} bytes`,
      priority: textureInfo.priority
    });
    
    return textureId;
  }

  /**
   * 根据纹理尺寸计算优先级（尺寸越小优先级越高）
   */
  _calculatePriority(width, height) {
    const pixelCount = width * height;
    if (pixelCount <= 256 * 256) return 1; // 高优先级
    if (pixelCount <= 512 * 512) return 2; // 中优先级
    return 3; // 低优先级
  }

  /**
   * 获取未解码队列中的纹理（按优先级排序）
   */
  getUndecodedTextures() {
    return Array.from(this.undecodedList.values());

    //先不使用优先级先进先出
    //.sort((a, b) => a.priority - b.priority || a.createTime - b.createTime);
  }

  /**
   * 获取已解码队列中的纹理
   */
  getDecodedTextures() {
    return Array.from(this.decodedList.values());
  }

  /**
   * 将纹理从未解码队列移动到已解码队列
   */
  markTextureAsDecoded(textureId, decodedData) {
    _SDK_DEBUG && console.log('markTextureAsDecoded', textureId);
    const textureInfo = this.undecodedList.get(textureId);
    if (textureInfo) {
      textureInfo.status = 'decoded';
      textureInfo.decodedData = decodedData;
      textureInfo.decodeTime = Date.now();
      textureInfo.processingTime = textureInfo.decodeTime - textureInfo.createTime;
      
      // 移动到已解码队列
      this.decodedList.set(textureId, textureInfo);
      this.undecodedList.delete(textureId);
      
      _SDK_DEBUG && console.log(`[WebGPUASTCTextureFactory] 纹理解码完成, glTextureId: ${textureId}`, {
        processingTime: `${textureInfo.processingTime}ms`
      });
    }
  }

  /**
   * 标记纹理解码失败
   */
  markTextureAsError(textureId, error) {
    const textureInfo = this.undecodedList.get(textureId);
    if (textureInfo) {
      textureInfo.retryCount++;
      if (textureInfo.retryCount >= textureInfo.maxRetries) {
        textureInfo.status = 'error';
        textureInfo.error = error;
        console.error(`[WebGPUASTCTextureFactory] 纹理解码失败, glTextureId: ${textureId}`, error);
      } else {
        textureInfo.status = 'pending'; // 重新排队
        _SDK_DEBUG && console.warn(`[WebGPUASTCTextureFactory] 纹理解码重试, glTextureId: ${textureId} (${textureInfo.retryCount}/${textureInfo.maxRetries})`);
      }
    }
  }

  /**
   * 获取队列统计信息
   */
  getQueueStats() {
    const undecodedCount = this.undecodedList.size;
    const decodedCount = this.decodedList.size;
    const totalCount = undecodedCount + decodedCount;
    
    const undecodedByPriority = {};
    this.undecodedList.forEach(texture => {
      undecodedByPriority[texture.priority] = (undecodedByPriority[texture.priority] || 0) + 1;
    });
    
    return {
      total: totalCount,
      undecoded: undecodedCount,
      decoded: decodedCount,
      undecodedByPriority: undecodedByPriority
    };
  }

  getTextureById(textureId) {
    return this.undecodedList.get(textureId) || this.decodedList.get(textureId);
  }

  /**
   * 清理已解码的纹理（释放内存）
   */
  clearDecodedTextures() {
    const count = this.decodedList.size;
    this.decodedList.clear();
    _SDK_DEBUG && console.log(`[WebGPUASTCTextureFactory] 清理已解码纹理: ${count} 个`);
  }

  /**
   * 检查纹理是否在队列中
   * @param {number} textureId - WebGL TextureId
   */
  hasTexture(textureId) {
    return this.undecodedList.has(textureId) || this.decodedList.has(textureId);
  }

  /**
   * 删除指定纹理
   * @param {number} textureId - WebGL TextureId
   */
  removeTexture(textureId) {
    const removed = this.undecodedList.delete(textureId) || this.decodedList.delete(textureId);
    if (removed) {
      _SDK_DEBUG && console.log(`[WebGPUASTCTextureFactory] 删除纹理, glTextureId: ${textureId}`);
    }
    return removed;
  }

  /**
   * 获取所有 pending 状态的纹理（可供 Decoder 消费）
   * @returns {Array} pending 纹理列表
   */
  getPendingTextures() {
    return Array.from(this.undecodedList.values()).filter(t => t.status === 'pending');
  }

  /**
   * 重置所有队列
   */
  reset() {
    this.decodedList.clear();
    this.undecodedList.clear();
    _SDK_DEBUG && console.log('[WebGPUASTCTextureFactory] 队列已重置');
  }
}

  // ======================================================================
  // 内嵌模块：WebGPUASTCDecoder
  // ======================================================================
  /**
 * WebGPU ASTC 纹理解码器 - 负责 GPU 资源管理、分批解码调度
 * 
 * 核心策略：
 * 1. 大纹理分批 dispatch，避免长时间独占 GPU 导致浏览器看门狗超时
 * 2. 批次间通过 MessageChannel / setTimeout 让出主线程时间片
 * 3. 多纹理顺序解码，纹理间也让出时间片
 * 
 * 使用示例：
 * const pipelineInit = new WebGPUASTCPipelineInit();
 * await pipelineInit.WebGPUPipelineInitialize();
 * 
 * const textureFactory = new WebGPUASTCTextureFactory();
 * const decoder = new WebGPUASTCDecoder(pipelineInit, textureFactory);
 * 
 * // 添加纹理后启动解码循环
 * textureFactory.AddASTCTexture(data, 512, 512, 8, 8);
 * await decoder.startDecodeLoop();
 */

class WebGPUASTCDecoder {

  // ============ 配置参数 ============
  static DEFAULT_MAX_BLOCKS_PER_BATCH = 64; // 默认每批最大块数
  static YIELD_MODE_RAF = 'raf';               // requestAnimationFrame 让出
  static YIELD_MODE_TIMEOUT = 'timeout';       // setTimeout(0) 让出
  static YIELD_MODE_MESSAGE = 'message';       // MessageChannel 让出（最快）

  /**
   * @param {WebGPUASTCPipelineInit} pipelineInit - 已初始化的 pipeline 实例
   * @param {WebGPUASTCTextureFactory} textureFactory - 纹理队列工厂
   * @param {Object} options - 配置选项
   * @param {number} options.maxBlocksPerBatch - 每批最大块数（默认4096）
   * @param {string} options.yieldMode - 让出模式: 'message' | 'timeout' | 'raf'（默认 'message'）
   * @param {boolean} options.autoLoop - 是否自动循环检测并解码（默认 true）
   * @param {number} options.loopInterval - 自动循环检测间隔 ms（默认 16）
   */
  constructor(pipelineInit, textureFactory, options = {}) {
    this._pipelineInit = pipelineInit;
    this._textureFactory = textureFactory;

    // 配置参数
    this._maxBlocksPerBatch = options.maxBlocksPerBatch || WebGPUASTCDecoder.DEFAULT_MAX_BLOCKS_PER_BATCH;
    _SDK_DEBUG && console.log("%d",this._maxBlocksPerBatch);
    this._yieldMode = options.yieldMode || WebGPUASTCDecoder.YIELD_MODE_MESSAGE;
    this._autoLoop = options.autoLoop !== undefined ? options.autoLoop : true;
    this._loopInterval = options.loopInterval || 16;

    // 零拷贝模式：通过 OffscreenCanvas 将 GPUTexture 传给 WebGL
    // 设置 glContext 后启用零拷贝，否则回退到 readback 模式
    this._glContext = options.glContext || null;   // WebGL context 引用
    this._offscreenCanvas = null;  // 复用的 OffscreenCanvas（单尺寸快路径）
    this._gpuCanvasCtx = null;     // 复用的 WebGPU canvas context

    // M2: 池化配置
    this._enableCanvasPool = options.enableCanvasPool !== false;  // 默认开启
    this._enableBufferPool = options.enableBufferPool !== false;  // 默认开启
    this._canvasPoolMax    = options.canvasPoolMax || 4;          // 每个尺寸最多缓存数
    this._bufferPoolMax    = options.bufferPoolMax || 8;          // 每个 size 桶最多缓存数
    this._canvasPoolMap = new Map(); // key: "WxH" -> [{canvas, ctx}, ...]
    this._bufferPoolMap = new Map(); // key: byteLength -> [GPUBuffer, ...]

    // 池化命中统计（供 M2 性能报告使用）
    this._poolStats = {
      canvasHit: 0, canvasMiss: 0,
      canvasFastReuse: 0,  // 单 canvas 快路径：同尺寸直接复用（不经过池）
      bufferHit: 0, bufferMiss: 0,
    };

    // 内部状态
    this._isDecoding = false;       // 是否正在解码
    this._loopTimer = null;         // 循环定时器
    this._decodeCount = 0;          // 已解码纹理计数
    this._messageChannel = null;    // MessageChannel 实例（复用）

    // 统计信息
    this._stats = {
      totalTexturesDecoded: 0,
      totalBatchesDispatched: 0,
      totalDecodeTimeMs: 0,
      lastDecodeTimeMs: 0,
    };
  }

  /**
   * 设置 WebGL context 以启用零拷贝模式
   * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
   */
  setGLContext(gl) {
    this._glContext = gl;
    _SDK_DEBUG && console.log('[WebGPUASTCDecoder] 零拷贝模式已启用 (WebGL context 已设置)');
  }

  /**
   * 是否处于零拷贝模式（有 WebGL context）
   */
  get zeroCopyEnabled() {
    return !!this._glContext;
  }

  // ============ 公开 API ============

  /**
   * 启动自动解码循环，持续检查未解码队列并解码
   */
  startDecodeLoop() {
    if (this._loopTimer !== null) {
      _SDK_DEBUG && console.warn('[WebGPUASTCDecoder] 解码循环已在运行');
      return;
    }

    _SDK_DEBUG && console.log('[WebGPUASTCDecoder] 启动解码循环');
    this._scheduleLoop();
  }

  /**
   * 停止自动解码循环
   */
  stopDecodeLoop() {
    if (this._loopTimer !== null) {
      clearTimeout(this._loopTimer);
      this._loopTimer = null;
      _SDK_DEBUG && console.log('[WebGPUASTCDecoder] 解码循环已停止');
    }
  }

  /**
   * 手动触发一次解码（处理当前未解码队列中的所有纹理）
   * @returns {Promise<number>} 本次解码的纹理数量
   */
  async decodeAll() {
    if (this._isDecoding) {
      _SDK_DEBUG && console.warn('[WebGPUASTCDecoder] 正在解码中，请等待完成');
      return 0;
    }
    return await this._processQueue();
  }

  /**
   * 解码单个纹理
   * - 零拷贝模式：直接将 GPUTexture 写入 WebGL texture，返回 null
   * - 回退模式：返回解码后的 RGBA Uint8Array
   * @param {Object} textureInfo - 纹理信息对象（来自 TextureFactory）
   * @returns {Promise<Uint8Array|null>} 零拷贝模式返回 null，回退模式返回 RGBA 数据
   */
  async decodeSingleTexture(textureInfo) {
    _SDK_DEBUG && console.log(" async decodeSingleTexture(textureInfo)");
    const t_total = performance.now();

    let t0 = performance.now();
    const result = await this._decodeTexture(textureInfo);
    const decodeTime = performance.now() - t0;

    t0 = performance.now();
    this._textureFactory.markTextureAsDecoded(textureInfo.id, result);
    const markTime = performance.now() - t0;

    if (_SDK_DEBUG) {
      const totalTime = performance.now() - t_total;
      console.log('%c---------- decodeSingleTexture 耗时明细 ----------', 'color: #ff6600; font-weight: bold;');
      console.log(`  _decodeTexture (含await): ${decodeTime.toFixed(2)}ms`);
      console.log(`  markTextureAsDecoded: ${markTime.toFixed(2)}ms`);
      console.log(`  decodeSingleTexture 总计: ${totalTime.toFixed(2)}ms`);
      console.log('%c--------------------------------------------------', 'color: #ff6600; font-weight: bold;');
    }

    return result;
  }

  /**
   * 解码单个纹理（无同步版本，用于批量压测）
   * - 零拷贝模式：提交 GPU 命令后立即返回，不等待 GPU 完成
   * - 回退模式：仍然需要 await mapAsync，无法跳过
   * @param {Object} textureInfo - 纹理信息对象（来自 TextureFactory）
   * @returns {Promise<Uint8Array|null>} 零拷贝模式返回 null，回退模式返回 RGBA 数据
   */
  async decodeSingleTextureNoSync(textureInfo) {
    _SDK_DEBUG && console.log(" async decodeSingleTextureNoSync(textureInfo)");

    const result = await this._decodeTextureNoSync(textureInfo);
    this._textureFactory.markTextureAsDecoded(textureInfo.id, result);
    return result;
  }

  /**
   * 预分配 GPU 资源，返回可复用的资源句柄（供吞吐量压测使用）
   * 调用者负责在结束后调用 releasePreallocated(handle) 释放资源
   * @param {Object} textureInfo - 纹理信息对象
   * @returns {Object} 预分配资源句柄 { inputBuffer, outputTexture, textureInfo, blockOffset, batchSize }
   */
  preallocateResources(textureInfo) {
    const device = this._pipelineInit._device;
    const { totalBlocks, width, height } = textureInfo;

    // 创建输出纹理
    const outputTexture = device.createTexture({
      label: `ASTC Output Texture (Prealloc) - texture ${textureInfo.id}`,
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // 上传输入数据
    const inputData = textureInfo.data;
    const inputBuffer = device.createBuffer({
      label: `ASTC Input Buffer (Prealloc) - texture ${textureInfo.id}`,
      size: inputData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint8Array(inputBuffer.getMappedRange()).set(inputData);
    inputBuffer.unmap();

    return {
      inputBuffer,
      outputTexture,
      textureInfo,
      blockOffset: 0,
      batchSize: Math.min(totalBlocks, this._maxBlocksPerBatch),
      totalBlocks,
    };
  }

  /**
   * 释放预分配的 GPU 资源
   * @param {Object} handle - preallocateResources 返回的句柄
   */
  releasePreallocated(handle) {
    if (handle.inputBuffer) handle.inputBuffer.destroy();
    if (handle.outputTexture) handle.outputTexture.destroy();
  }

  /**
   * 纯 dispatch + transfer（吞吐量压测专用）
   * 复用预分配的 inputBuffer 和 outputTexture，不做任何资源创建/销毁
   * 零拷贝路径：dispatch → transfer → submit，全同步，0 次 await
   * 回退路径：只做 dispatch + submit，不做 readback（吞吐量测试不需要拿回数据）
   * @param {Object} handle - preallocateResources 返回的句柄
   */
  dispatchAndTransferOnly(handle) {
    const { inputBuffer, outputTexture, textureInfo, blockOffset, batchSize, totalBlocks } = handle;

    if (totalBlocks <= this._maxBlocksPerBatch) {
      // 小纹理：单次 dispatch
      this._dispatchBatch(textureInfo, inputBuffer, outputTexture, blockOffset, batchSize);
    } else {
      // 大纹理：多次 dispatch（不让出）
      const batchCount = Math.ceil(totalBlocks / this._maxBlocksPerBatch);
      for (let batchIdx = 0; batchIdx < batchCount; batchIdx++) {
        const offset = batchIdx * this._maxBlocksPerBatch;
        const size = Math.min(this._maxBlocksPerBatch, totalBlocks - offset);
        this._dispatchBatch(textureInfo, inputBuffer, outputTexture, offset, size);
      }
    }

    // 零拷贝模式：传输到 WebGL（不等待 GPU）
    // 回退模式：只做 dispatch + submit，吞吐量测试不需要 readback 数据
    if (this.zeroCopyEnabled) {
      this._transferToWebGL(outputTexture, textureInfo);
    }
  }

  /**
   * 获取 WebGPU device 引用（供外部批量压测使用）
   * @returns {GPUDevice}
   */
  getDevice() {
    return this._pipelineInit._device;
  }

  /**
   * 获取解码统计信息
   */
  getStats() {
    return { ...this._stats };
  }

  /**
   * 销毁解码器，释放资源
   */
  destroy() {
    this.stopDecodeLoop();
    this._messageChannel = null;
    // 释放池
    for (const list of this._canvasPoolMap.values()) {
      // OffscreenCanvas 没有 destroy，GC 即可
      list.length = 0;
    }
    this._canvasPoolMap.clear();
    for (const list of this._bufferPoolMap.values()) {
      for (const b of list) { try { b.destroy(); } catch (e) {} }
      list.length = 0;
    }
    this._bufferPoolMap.clear();
    _SDK_DEBUG && console.log('[WebGPUASTCDecoder] 解码器已销毁');
  }

  /**
   * 获取池化统计（M2 性能报告使用）
   */
  getPoolStats() {
    return Object.assign({}, this._poolStats, {
      canvasPoolSize: Array.from(this._canvasPoolMap.entries()).map(([k, v]) => `${k}:${v.length}`),
      bufferPoolSize: Array.from(this._bufferPoolMap.entries()).map(([k, v]) => `${k}B:${v.length}`),
    });
  }

  resetPoolStats() {
    this._poolStats = { canvasHit: 0, canvasMiss: 0, canvasFastReuse: 0, bufferHit: 0, bufferMiss: 0 };
  }

  // ============ 内部：资源池（Canvas / GPUBuffer） ============

  /**
   * 按尺寸从池中取一个 OffscreenCanvas（含已 configure 的 webgpu context）
   */
  _acquireCanvasFromPool(width, height) {
    if (!this._enableCanvasPool) return null;
    const key = `${width}x${height}`;
    const pool = this._canvasPoolMap.get(key);
    if (pool && pool.length) {
      this._poolStats.canvasHit++;
      return pool.pop();
    }
    this._poolStats.canvasMiss++;
    return null;
  }

  _releaseCanvasToPool(entry) {
    if (!this._enableCanvasPool || !entry) return;
    const key = `${entry.canvas.width}x${entry.canvas.height}`;
    if (!this._canvasPoolMap.has(key)) this._canvasPoolMap.set(key, []);
    const pool = this._canvasPoolMap.get(key);
    if (pool.length < this._canvasPoolMax) pool.push(entry);
  }

  /**
   * 按字节长度从池中获取一个 STORAGE GPUBuffer（未 mapped）
   * 命中则返回 buffer；未命中返回 null
   */
  _acquireInputBufferFromPool(byteLength) {
    if (!this._enableBufferPool) return null;
    const pool = this._bufferPoolMap.get(byteLength);
    if (pool && pool.length) {
      this._poolStats.bufferHit++;
      return pool.pop();
    }
    this._poolStats.bufferMiss++;
    return null;
  }

  _releaseInputBufferToPool(buffer, byteLength) {
    if (!this._enableBufferPool || !buffer) return false;
    if (!this._bufferPoolMap.has(byteLength)) this._bufferPoolMap.set(byteLength, []);
    const pool = this._bufferPoolMap.get(byteLength);
    if (pool.length < this._bufferPoolMax) {
      pool.push(buffer);
      return true;
    }
    return false;
  }

  /**
   * 申请一个 input buffer 并写入 ASTC 压缩数据
   * - 命中池：createBuffer 不发生，使用 writeBuffer 写入数据
   * - 未命中：new GPUBuffer（可以使用 mappedAtCreation 走更快路径，但为简化池复用统一用 writeBuffer）
   * @param {Uint8Array} inputData
   * @param {string} label
   * @returns {GPUBuffer}
   */
  _acquireAndUploadInputBuffer(inputData, label) {
    const device = this._pipelineInit._device;
    const byteLength = inputData.byteLength;
    // 优先池
    let buffer = this._acquireInputBufferFromPool(byteLength);
    if (buffer) {
      device.queue.writeBuffer(buffer, 0, inputData);
      return buffer;
    }
    // 池未命中：如果启用池，创建时不使用 mappedAtCreation（便于后续复用）
    if (this._enableBufferPool) {
      buffer = device.createBuffer({
        label: label,
        size: byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, inputData);
      return buffer;
    }
    // 未启用池：走 mappedAtCreation 快路径
    buffer = device.createBuffer({
      label: label,
      size: byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint8Array(buffer.getMappedRange()).set(inputData);
    buffer.unmap();
    return buffer;
  }

  /**
   * 释放 input buffer：优先入池，池满则 destroy
   */
  _disposeInputBuffer(buffer, byteLength) {
    if (!buffer) return;
    if (!this._releaseInputBufferToPool(buffer, byteLength)) {
      try { buffer.destroy(); } catch (e) {}
    }
  }

  // ============ 内部：循环调度 ============

  _scheduleLoop() {
    this._loopTimer = setTimeout(async () => {
      await this._processQueue();
      if (this._loopTimer !== null) {
        this._scheduleLoop();
      }
    }, this._loopInterval);
  }

  /**
   * 处理未解码队列中的所有纹理
   * @returns {Promise<number>} 本次处理的纹理数量
   */
  async _processQueue() {
    const undecodedTextures = this._textureFactory.getUndecodedTextures();
    if (undecodedTextures.length === 0) {
      return 0;
    }

    this._isDecoding = true;
    let decodedCount = 0;

    try {
      for (const textureInfo of undecodedTextures) {
        if (textureInfo.status !== 'pending') {
          continue;
        }

        try {
          textureInfo.status = 'decoding';
          const decodedData = await this._decodeTexture(textureInfo);
          this._textureFactory.markTextureAsDecoded(textureInfo.id, decodedData);
          decodedCount++;

          // 纹理间让出时间片，避免连续占用
          if (decodedCount < undecodedTextures.length) {
            await this._yieldToMain();
          }
        } catch (error) {
          console.error(`[WebGPUASTCDecoder] 解码纹理 ${textureInfo.id} 失败:`, error);
          this._textureFactory.markTextureAsError(textureInfo.id, error);
        }
      }
    } finally {
      this._isDecoding = false;
    }

    return decodedCount;
  }

  // ============ 内部：单纹理解码（分批策略） ============

  /**
   * 解码单个纹理，自动判断是否需要分批
   * @param {Object} textureInfo - 纹理信息
   * @returns {Promise<Uint8Array|null>} 零拷贝模式返回 null，回退模式返回 RGBA 数据
   */
  async _decodeTexture(textureInfo) {
    _SDK_DEBUG && console.log("async _decodeTexture(textureInfo)");
    const startTime = performance.now();
    const { totalBlocks, width, height } = textureInfo;

    // 创建 GPUTexture 作为 compute shader 输出
    const device = this._pipelineInit._device;
    const t_createTex = performance.now();
    const outputTexture = device.createTexture({
      label: `ASTC Output Texture - texture ${textureInfo.id}`,
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const createTextureTime = performance.now() - t_createTex;
    _SDK_DEBUG && console.log(`[_decodeTexture] createOutputTexture(${width}x${height}): ${createTextureTime.toFixed(2)}ms`);

    // 判断是否需要分批
    if (totalBlocks <= this._maxBlocksPerBatch) {
      // 小纹理：一次 dispatch 完成
      let t1 = performance.now();
      const result = await this._decodeBatch(textureInfo, 0, totalBlocks, outputTexture, createTextureTime);
      const batchTime = performance.now() - t1;

      t1 = performance.now();
      this._recordStats(startTime, 1);
      const recordStatsTime = performance.now() - t1;

      if (_SDK_DEBUG) {
        const totalDecodeTexture = performance.now() - startTime;
        console.log('%c---------- _decodeTexture 耗时明细 ----------', 'color: #cc6600; font-weight: bold;');
        console.log(`  createOutputTexture: ${createTextureTime.toFixed(2)}ms`);
        console.log(`  _decodeBatch (含await): ${batchTime.toFixed(2)}ms`);
        console.log(`  _recordStats: ${recordStatsTime.toFixed(2)}ms`);
        console.log(`  _decodeTexture 总计: ${totalDecodeTexture.toFixed(2)}ms`);
        console.log('%c----------------------------------------------', 'color: #cc6600; font-weight: bold;');
      }

      return result;
    }

    // 大纹理：分批 dispatch
    let t1 = performance.now();
    const result = await this._decodeBatches(textureInfo, outputTexture, createTextureTime);
    const batchesTime = performance.now() - t1;

    t1 = performance.now();
    this._recordStats(startTime, Math.ceil(totalBlocks / this._maxBlocksPerBatch));
    const recordStatsTime = performance.now() - t1;

    if (_SDK_DEBUG) {
      const totalDecodeTexture = performance.now() - startTime;
      console.log('%c---------- _decodeTexture 耗时明细 (大纹理) ----------', 'color: #cc6600; font-weight: bold;');
      console.log(`  createOutputTexture: ${createTextureTime.toFixed(2)}ms`);
      console.log(`  _decodeBatches (含await): ${batchesTime.toFixed(2)}ms`);
      console.log(`  _recordStats: ${recordStatsTime.toFixed(2)}ms`);
      console.log(`  _decodeTexture 总计: ${totalDecodeTexture.toFixed(2)}ms`);
      console.log('%c----------------------------------------------------', 'color: #cc6600; font-weight: bold;');
    }

    return result;
  }

  /**
   * 解码单个纹理（无同步版本）—— 零拷贝路径不等待 GPU 完成
   * @param {Object} textureInfo - 纹理信息
   * @returns {Promise<Uint8Array|null>}
   */
  async _decodeTextureNoSync(textureInfo) {
    const device = this._pipelineInit._device;
    const { totalBlocks, width, height } = textureInfo;

    const outputTexture = device.createTexture({
      label: `ASTC Output Texture (NoSync) - texture ${textureInfo.id}`,
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    if (totalBlocks <= this._maxBlocksPerBatch) {
      return this._decodeBatchNoSync(textureInfo, 0, totalBlocks, outputTexture);
    }

    // 大纹理：分批 dispatch（但不做批次间让出，不做 GPU 同步）
    const inputData = textureInfo.data;
    const inputBuffer = this._acquireAndUploadInputBuffer(
      inputData,
      `ASTC Input Buffer (NoSync) - texture ${textureInfo.id}`
    );

    const batchCount = Math.ceil(totalBlocks / this._maxBlocksPerBatch);
    for (let batchIdx = 0; batchIdx < batchCount; batchIdx++) {
      const blockOffset = batchIdx * this._maxBlocksPerBatch;
      const batchSize = Math.min(this._maxBlocksPerBatch, totalBlocks - blockOffset);
      this._dispatchBatch(textureInfo, inputBuffer, outputTexture, blockOffset, batchSize);
    }

    // 零拷贝传输但不等待 GPU
    if (this.zeroCopyEnabled) {
      this._transferToWebGL(outputTexture, textureInfo);
      this._disposeInputBuffer(inputBuffer, inputData.byteLength);
      outputTexture.destroy();
      return null;
    }

    // 回退模式仍需 await
    const result = await this._readbackFromTexture(outputTexture, width, height);
    this._disposeInputBuffer(inputBuffer, inputData.byteLength);
    outputTexture.destroy();
    return result;
  }

  /**
   * 小纹理一次性解码 —— 无同步版本（零拷贝路径不 await）
   * @param {Object} textureInfo
   * @param {number} blockOffset
   * @param {number} batchSize
   * @param {GPUTexture} outputTexture
   * @returns {Uint8Array|null}
   */
  _decodeBatchNoSync(textureInfo, blockOffset, batchSize, outputTexture) {
    const device = this._pipelineInit._device;
    const { width, height } = textureInfo;

    // 上传输入数据
    const inputData = textureInfo.data;
    const inputBuffer = this._acquireAndUploadInputBuffer(
      inputData,
      `ASTC Input Buffer (NoSync) - texture ${textureInfo.id}`
    );

    // dispatch
    this._dispatchBatch(textureInfo, inputBuffer, outputTexture, blockOffset, batchSize);

    // 零拷贝：传输到 WebGL 但不等待 GPU 完成
    if (this.zeroCopyEnabled) {
      this._transferToWebGL(outputTexture, textureInfo);
      this._disposeInputBuffer(inputBuffer, inputData.byteLength);
      outputTexture.destroy();
      return null;  // 同步返回，不 await
    }

    // 回退模式：仍需 await mapAsync（返回 Promise）
    return this._readbackFromTexture(outputTexture, width, height).then(result => {
      this._disposeInputBuffer(inputBuffer, inputData.byteLength);
      outputTexture.destroy();
      return result;
    });
  }

  /**
   * 分批解码大纹理
   * @param {Object} textureInfo - 纹理信息
   * @param {GPUTexture} outputTexture - 输出 GPUTexture
   * @returns {Promise<Uint8Array|null>} 零拷贝模式返回 null，回退模式返回 RGBA 数据
   */
  async _decodeBatches(textureInfo, outputTexture, createTextureTime = 0) {
    const { totalBlocks, width, height } = textureInfo;
    const batchCount = Math.ceil(totalBlocks / this._maxBlocksPerBatch);
    const decodeTimings = {};
    let t0;

    // 0. createOutputTexture（来自 _decodeTexture）
    if (createTextureTime > 0) {
      decodeTimings['createOutputTexture (GPU资源分配)'] = createTextureTime;
    }

    _SDK_DEBUG && console.log(`[WebGPUASTCDecoder] 大纹理分批解码, textureId: ${textureInfo.id}, 总块数: ${totalBlocks}, 批次: ${batchCount}`);

    // 上传 ASTC 压缩数据（所有批次共享同一份输入数据）
    t0 = performance.now();
    const device = this._pipelineInit._device;
    const inputData = textureInfo.data;
    const inputBuffer = this._acquireAndUploadInputBuffer(
      inputData,
      `ASTC Input Buffer - texture ${textureInfo.id}`
    );
    decodeTimings['createInputBuffer+upload (CPU→GPU I/O)'] = performance.now() - t0;

    // 分批 dispatch（所有批次共享同一个 outputTexture）
    let totalDispatchTime = 0;
    let totalYieldTime = 0;
    for (let batchIdx = 0; batchIdx < batchCount; batchIdx++) {
      const blockOffset = batchIdx * this._maxBlocksPerBatch;
      const batchSize = Math.min(this._maxBlocksPerBatch, totalBlocks - blockOffset);

      t0 = performance.now();
      this._dispatchBatch(textureInfo, inputBuffer, outputTexture, blockOffset, batchSize);
      totalDispatchTime += performance.now() - t0;

      // 批次间让出时间片
      if (batchIdx < batchCount - 1) {
        t0 = performance.now();
        await this._yieldToMain();
        totalYieldTime += performance.now() - t0;
      }
    }
    decodeTimings[`dispatchBatch x${batchCount} (GPU计算)`] = totalDispatchTime;
    if (totalYieldTime > 0) {
      decodeTimings['yieldToMain (让出时间片)'] = totalYieldTime;
    }

    // 零拷贝传输到 WebGL 或回退到 readback
    t0 = performance.now();
    let result;
    if (this.zeroCopyEnabled) {
      this._transferToWebGL(outputTexture, textureInfo);
      // 等待 GPU 真正完成所有提交的工作（含 compute + copy），确保计时准确
      await device.queue.onSubmittedWorkDone();
      result = null;
      decodeTimings['transferToWebGL+gpuSync (零拷贝 GPU→GPU)'] = performance.now() - t0;
    } else {
      result = await this._readbackFromTexture(outputTexture, width, height);
      decodeTimings['readbackFromTexture (GPU→CPU I/O)'] = performance.now() - t0;
    }

    // 清理 GPU 资源
    t0 = performance.now();
    this._disposeInputBuffer(inputBuffer, inputData.byteLength);
    outputTexture.destroy();
    decodeTimings['cleanup (GPU资源释放)'] = performance.now() - t0;

    // 输出解码耗时报告
    if (_SDK_DEBUG) {
      const totalDecode = Object.values(decodeTimings).reduce((a, b) => a + b, 0);
      console.log('%c---------- 解码阶段耗时明细 (大纹理分批) ----------', 'color: #009900; font-weight: bold;');
      for (const [key, value] of Object.entries(decodeTimings)) {
        const pct = ((value / totalDecode) * 100).toFixed(1);
        const bar = '█'.repeat(Math.round(pct / 2));
        console.log(`  ${key}: ${value.toFixed(2)}ms (${pct}%) ${bar}`);
      }
      console.log(`  >>> 解码子阶段合计: ${totalDecode.toFixed(2)}ms <<<`);
      console.log('%c-------------------------------------------------', 'color: #009900; font-weight: bold;');
    }

    return result;
  }

  /**
   * 小纹理一次性解码（不分批）
   * @param {Object} textureInfo - 纹理信息
   * @param {number} blockOffset - 块偏移（始终 0）
   * @param {number} batchSize - 块数量
   * @param {GPUTexture} outputTexture - 输出 GPUTexture
   * @returns {Promise<Uint8Array|null>} 零拷贝返回 null，回退返回 RGBA 数据
   */
  async _decodeBatch(textureInfo, blockOffset, batchSize, outputTexture, createTextureTime = 0) {
    const t_batchEntry = performance.now();
    const device = this._pipelineInit._device;
    const { width, height } = textureInfo;
    const decodeTimings = {};
    let t0;

    // 0. createOutputTexture（来自 _decodeTexture）
    if (createTextureTime > 0) {
      decodeTimings['createOutputTexture (GPU资源分配)'] = createTextureTime;
    }

    // 1. 上传输入数据
    t0 = performance.now();
    const inputData = textureInfo.data;

    // ====== 诊断：打印传入 GPU 的前 16 字节 ======
    if (_SDK_DEBUG) {
      const first16 = Array.from(inputData.slice(0, 16));
      console.log('%c====== JS→GPU 数据诊断 ======', 'color: #ff00ff; font-weight: bold;');
      console.log('inputData 类型:', inputData.constructor.name, '长度:', inputData.byteLength);
      console.log('前16字节 (hex):', first16.map(b => '0x' + b.toString(16).padStart(2, '0')).join(', '));
      console.log('前16字节 (dec):', first16.join(', '));
      // 以 u32 小端序查看（与 WGSL inBuf.values 对应）
      const dv = new DataView(inputData.buffer, inputData.byteOffset, Math.min(inputData.byteLength, 16));
      const u32_0 = dv.getUint32(0, true);  // little-endian
      const u32_1 = dv.getUint32(4, true);
      const u32_2 = dv.getUint32(8, true);
      const u32_3 = dv.getUint32(12, true);
      console.log(`inBuf.values[0]=0x${u32_0.toString(16).padStart(8,'0')} (${u32_0})`);
      console.log(`inBuf.values[1]=0x${u32_1.toString(16).padStart(8,'0')} (${u32_1})`);
      console.log(`inBuf.values[2]=0x${u32_2.toString(16).padStart(8,'0')} (${u32_2})`);
      console.log(`inBuf.values[3]=0x${u32_3.toString(16).padStart(8,'0')} (${u32_3})`);
      console.log('%c=============================', 'color: #ff00ff; font-weight: bold;');
    }
    // ====== 诊断结束 ======

    const inputBuffer = this._acquireAndUploadInputBuffer(
      inputData,
      `ASTC Input Buffer - texture ${textureInfo.id}`
    );
    decodeTimings['createInputBuffer+upload (CPU→GPU I/O)'] = performance.now() - t0;

    // 2. 执行 dispatch（输出到 GPUTexture）
    t0 = performance.now();
    this._dispatchBatch(textureInfo, inputBuffer, outputTexture, blockOffset, batchSize);
    decodeTimings['dispatchBatch (GPU计算)'] = performance.now() - t0;

    // 3. 零拷贝传输到 WebGL 或回退到 readback
    t0 = performance.now();
    let result;
    if (this.zeroCopyEnabled) {
      this._transferToWebGL(outputTexture, textureInfo);
      // 等待 GPU 真正完成所有提交的工作（含 compute + copy），确保计时准确
      await device.queue.onSubmittedWorkDone();
      result = null;
      decodeTimings['transferToWebGL+gpuSync (零拷贝 GPU→GPU)'] = performance.now() - t0;
    } else {
      result = await this._readbackFromTexture(outputTexture, width, height);
      decodeTimings['readbackFromTexture (GPU→CPU I/O)'] = performance.now() - t0;
    }

    // 4. 清理
    t0 = performance.now();
    this._disposeInputBuffer(inputBuffer, inputData.byteLength);
    outputTexture.destroy();
    decodeTimings['cleanup (GPU资源释放)'] = performance.now() - t0;

    // 计算核心工作时间（不含日志打印）
    const coreWorkTime = performance.now() - t_batchEntry;

    // 输出解码耗时报告
    if (_SDK_DEBUG) {
      const t_log = performance.now();
      const totalDecode = Object.values(decodeTimings).reduce((a, b) => a + b, 0);
      console.log('%c---------- 解码阶段耗时明细 (小纹理单批) ----------', 'color: #009900; font-weight: bold;');
      for (const [key, value] of Object.entries(decodeTimings)) {
        const pct = ((value / totalDecode) * 100).toFixed(1);
        const bar = '█'.repeat(Math.round(pct / 2));
        console.log(`  ${key}: ${value.toFixed(2)}ms (${pct}%) ${bar}`);
      }
      console.log(`  >>> 解码子阶段合计: ${totalDecode.toFixed(2)}ms <<<`);
      const logTime = performance.now() - t_log;
      const totalBatchTime = performance.now() - t_batchEntry;
      console.log(`  >>> _decodeBatch 核心工作(不含log): ${coreWorkTime.toFixed(2)}ms, 日志打印: ${logTime.toFixed(2)}ms, 函数总计: ${totalBatchTime.toFixed(2)}ms <<<`);
      console.log('%c-------------------------------------------------', 'color: #009900; font-weight: bold;');
    }

    return result;
  }

  // ============ 内部：GPU dispatch ============

  /**
   * 执行一次 compute dispatch
   * @param {Object} textureInfo - 纹理信息
   * @param {GPUBuffer} inputBuffer - 输入 buffer（ASTC 压缩数据）
   * @param {GPUTexture} outputTexture - 输出 GPUTexture（解码后纹理）
   * @param {number} blockOffset - 本批次块偏移
   * @param {number} batchSize - 本批次块数量
   */
  _dispatchBatch(textureInfo, inputBuffer, outputTexture, blockOffset, batchSize) {
    const device = this._pipelineInit._device;
    const pipeline = this._pipelineInit._pipeline;
    const dispatchTimings = {};
    let t0;

    // 1. 创建 Params uniform buffer
    t0 = performance.now();
    const paramsData = new Uint32Array([
      textureInfo.width,
      textureInfo.height,
      textureInfo.blockWidth,
      textureInfo.blockHeight,
      textureInfo.blockCountX,
      textureInfo.blockCountY,
      textureInfo.totalBlocks,
      blockOffset,
      batchSize,
    ]);

    const paramsBuffer = device.createBuffer({
      label: 'ASTC Params Uniform',
      size: paramsData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(paramsBuffer, 0, paramsData);
    dispatchTimings['createParamsBuffer+writeBuffer'] = performance.now() - t0;

    // 2. 创建 BindGroup
    t0 = performance.now();
    const bindGroup = device.createBindGroup({
      label: `ASTC BindGroup - offset ${blockOffset}`,
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: inputBuffer } },
        { binding: 2, resource: outputTexture.createView() },
      ],
    });
    dispatchTimings['createBindGroup'] = performance.now() - t0;

    // 3. 编码 + 提交命令
    t0 = performance.now();
    const commandEncoder = device.createCommandEncoder({
      label: `ASTC Decode - offset ${blockOffset}, size ${batchSize}`,
    });

    const computePass = commandEncoder.beginComputePass({
      label: `ASTC ComputePass - offset ${blockOffset}`,
    });

    computePass.setPipeline(pipeline);
    computePass.setBindGroup(0, bindGroup);

    // 计算需要的 workgroup 数量
    const workgroupCount = Math.ceil(batchSize / this._pipelineInit._workgroupSize);
    computePass.dispatchWorkgroups(workgroupCount);

    computePass.end();

    // 提交命令 ------------------------------------------------------------------------------可以进一步优化
    const commandBuffer = commandEncoder.finish();
    device.queue.submit([commandBuffer]);
    dispatchTimings['encodeCommands+submit'] = performance.now() - t0;

    // 不再等待 onSubmittedWorkDone()：
    // - readback 路径：后续 mapAsync 会隐式等待 GPU 完成
    // - 零拷贝路径：后续 texImage2D 会隐式同步 WebGPU 命令队列

    // 清理 params buffer
    paramsBuffer.destroy();

    // 输出 dispatch 耗时（始终输出，用于分析各阶段耗时）
    if (_SDK_DEBUG){
      const totalDispatch = Object.values(dispatchTimings).reduce((a, b) => a + b, 0);
      console.log(`    [Dispatch offset=${blockOffset}, size=${batchSize}] 耗时明细 (total:${totalDispatch.toFixed(2)}ms):`);
      for (const [key, value] of Object.entries(dispatchTimings)) {
        const pct = ((value / totalDispatch) * 100).toFixed(1);
        console.log(`      ${key}: ${value.toFixed(2)}ms (${pct}%)`);
      }
    }
  }

  // ============ 内部：零拷贝传输 (WebGPU Texture → WebGL Texture) ============

  /**
   * 零拷贝：将 GPUTexture 通过 OffscreenCanvas 传给 WebGL texture
   * 数据全程在 GPU 上，不经过 CPU
   * @param {GPUTexture} gpuTexture - compute shader 输出的 GPUTexture
   * @param {Object} textureInfo - 纹理信息（包含 id, width, height）
   */
  _transferToWebGL(gpuTexture, textureInfo) {
    const device = this._pipelineInit._device;
    const { width, height, id: glTextureId } = textureInfo;

    // 创建/复用 OffscreenCanvas（尺寸可能变化）
    // 接入 canvas 池：尺寸不匹配时先把当前 canvas 归还池中，再尝试从池中按目标尺寸取一个
    if (!this._offscreenCanvas || this._offscreenCanvas.width !== width || this._offscreenCanvas.height !== height) {
      // 归还旧 canvas（若存在且启用池）
      if (this._offscreenCanvas && this._enableCanvasPool) {
        this._releaseCanvasToPool({ canvas: this._offscreenCanvas, ctx: this._gpuCanvasCtx });
        this._offscreenCanvas = null;
        this._gpuCanvasCtx = null;
      }
      // 从池中按目标尺寸取一个
      const pooled = this._acquireCanvasFromPool(width, height);
      if (pooled) {
        this._offscreenCanvas = pooled.canvas;
        this._gpuCanvasCtx = pooled.ctx;
      } else {
        this._offscreenCanvas = new OffscreenCanvas(width, height);
        this._gpuCanvasCtx = this._offscreenCanvas.getContext('webgpu');
        this._gpuCanvasCtx.configure({
          device: device,
          format: 'rgba8unorm',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
          alphaMode: 'opaque',
        });
      }
    } else {
      // 快路径：单 canvas 同尺寸复用
      this._poolStats.canvasFastReuse++;
    }

    // 将 compute shader 输出纹理拷贝到 canvas 的当前纹理（GPU 内部拷贝）
    const canvasTexture = this._gpuCanvasCtx.getCurrentTexture();
    const encoder = device.createCommandEncoder({ label: 'ASTC ZeroCopy Transfer' });
    encoder.copyTextureToTexture(
      { texture: gpuTexture },        // 源：compute shader 输出
      { texture: canvasTexture },      // 目标：OffscreenCanvas 的 texture
      [width, height]
    );
    device.queue.submit([encoder.finish()]);

    // 将 OffscreenCanvas 数据注入 WebGL texture，并恢复 GL 绑定状态
    this._glContextMerge(glTextureId);

    _SDK_DEBUG && console.log(`[ZeroCopy] GPUTexture → WebGL Texture 完成, glTextureId: ${glTextureId}, size: ${width}x${height}`);
  }

  // ============ 内部：WebGL 上下文注入与状态恢复 ============

  /**
   * 将 OffscreenCanvas 数据注入指定的 WebGL texture，并恢复 GL 绑定状态
   * @param {number} glTextureId - 目标 WebGL 纹理 ID（GL.textures 中的 key）
   */
  _glContextMerge(glTextureId) {
    // const gl = this._glContext;

    // // 注入 OffscreenCanvas 数据（GPU 内部共享，不经 CPU）
    // gl.bindTexture(gl.TEXTURE_2D, GL.textures[glTextureId]);
    // gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._offscreenCanvas);

    // // 恢复 WebGL 绑定状态
    // // 防止污染 TEXTURE_2D 绑定
    // gl.bindTexture(gl.TEXTURE_2D, window._lastBoundTexture ? GL.textures[window._lastBoundTexture] : null);


        const gl = this._glContext;

    // 注入 OffscreenCanvas 数据
    gl.bindTexture(gl.TEXTURE_2D, GL.textures[glTextureId]);

    // ====== 验证 texImage2D 是 GPU→GPU 还是 GPU→CPU→GPU ======
    const t_texImage_start = performance.now();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._offscreenCanvas);
    const t_texImage_noSync = performance.now() - t_texImage_start;

    const t_finish_start = performance.now();
    // gl.finish(); // 强制等待 GPU 完成所有命令
    const t_finish = performance.now() - t_finish_start;

    const t_total = t_texImage_noSync + t_finish;
    const canvasWidth = this._offscreenCanvas.width;
    const canvasHeight = this._offscreenCanvas.height;
    const pixelCount = canvasWidth * canvasHeight;
    const dataSizeKB = (pixelCount * 4 / 1024).toFixed(1);

    // 判定逻辑：
    // GPU→GPU (零拷贝): texImage2D + finish 通常 < 1ms (1024x1024)
    // GPU→CPU→GPU (readback): texImage2D + finish 通常 > 2ms (1024x1024)
    const isLikelyZeroCopy = t_total < 1.5;
    const verdict = isLikelyZeroCopy
      ? '🟢 大概率 GPU→GPU (零拷贝)'
      : '🔴 大概率 GPU→CPU→GPU (readback)';

    if (_SDK_DEBUG) {
      console.log(
        '%c====== texImage2D 传输路径验证 ======',
        'color: #ff00ff; font-weight: bold; font-size: 14px;'
      );
      console.log(`  纹理尺寸: ${canvasWidth}x${canvasHeight} (${dataSizeKB}KB RGBA)`);
      console.log(`  texImage2D (不含同步): ${t_texImage_noSync.toFixed(3)}ms`);
      console.log(`  gl.finish() (强制同步): ${t_finish.toFixed(3)}ms`);
      console.log(`  总耗时 (texImage2D + finish): ${t_total.toFixed(3)}ms`);
      console.log(`  判定结果: ${verdict}`);
      console.log(
        '%c=====================================',
        'color: #ff00ff; font-weight: bold; font-size: 14px;'
      );
    }
    // ====== 验证结束 ======

    // 恢复 WebGL 绑定状态
    // 防止污染 TEXTURE_2D 绑定
    gl.bindTexture(gl.TEXTURE_2D, window._lastBoundTexture ? GL.textures[window._lastBoundTexture] : null);

  }

  // ============ 内部：回退 readback（从 GPUTexture 回读到 CPU） ============

  /**
   * 从 GPUTexture 回读像素数据到 CPU（回退路径，不走零拷贝时使用）
   * @param {GPUTexture} texture - 源 GPUTexture
   * @param {number} width - 纹理宽度
   * @param {number} height - 纹理高度
   * @returns {Promise<Uint8Array>} RGBA 像素数据
   */
  async _readbackFromTexture(texture, width, height) {
    _SDK_DEBUG && console.log("func async _readbackFromTexture");
    const device = this._pipelineInit._device;
    const readbackTimings = {};
    let t0;

    // 每行需要 256 字节对齐 (WebGPU 要求 bytesPerRow 必须是 256 的倍数)
    const bytesPerPixel = 4;
    const unpaddedBytesPerRow = width * bytesPerPixel;
    const align = 256;
    const paddedBytesPerRow = Math.ceil(unpaddedBytesPerRow / align) * align;
    const bufferSize = paddedBytesPerRow * height;

    // 1. 创建 staging buffer
    t0 = performance.now();
    const stagingBuffer = device.createBuffer({
      label: 'ASTC Texture Readback Buffer',
      size: bufferSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    readbackTimings['createStagingBuffer'] = performance.now() - t0;

    // 2. 拷贝 GPUTexture → Buffer
    t0 = performance.now();
    const encoder = device.createCommandEncoder({ label: 'ASTC Texture Readback Copy' });
    encoder.copyTextureToBuffer(
      { texture: texture },
      { buffer: stagingBuffer, bytesPerRow: paddedBytesPerRow, rowsPerImage: height },
      [width, height]
    );
    device.queue.submit([encoder.finish()]);
    readbackTimings['copyTextureToBuffer+submit (GPU内部拷贝)'] = performance.now() - t0;

    // 3. 映射 (GPU→CPU)
    t0 = performance.now();
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    readbackTimings['mapAsync (GPU→CPU 映射)'] = performance.now() - t0;

    // 4. 读取数据（处理行对齐 padding）
    t0 = performance.now();
    const mappedData = new Uint8Array(stagingBuffer.getMappedRange());
    const resultU8 = new Uint8Array(width * height * bytesPerPixel);
    
    if (paddedBytesPerRow === unpaddedBytesPerRow) {
      // 无 padding，直接拷贝
      resultU8.set(mappedData.subarray(0, resultU8.length));
    } else {
      // 有 padding，逐行拷贝
      for (let row = 0; row < height; row++) {
        const srcOffset = row * paddedBytesPerRow;
        const dstOffset = row * unpaddedBytesPerRow;
        resultU8.set(mappedData.subarray(srcOffset, srcOffset + unpaddedBytesPerRow), dstOffset);
      }
    }
    readbackTimings['读取数据 (含行对齐处理)'] = performance.now() - t0;

    // 5. 清理
    t0 = performance.now();
    stagingBuffer.unmap();
    stagingBuffer.destroy();
    readbackTimings['unmap+destroy'] = performance.now() - t0;

    // 输出 readback 耗时
    if (_SDK_DEBUG) {
      const totalReadback = Object.values(readbackTimings).reduce((a, b) => a + b, 0);
      console.log(`    [Readback from Texture] 耗时明细 (${width}x${height}, ${(bufferSize / 1024).toFixed(1)}KB):`);
      for (const [key, value] of Object.entries(readbackTimings)) {
        const pct = ((value / totalReadback) * 100).toFixed(1);
        console.log(`      ${key}: ${value.toFixed(2)}ms (${pct}%)`);
      }
    }

    return resultU8;
  }

  // ============ 内部：时间片让出 ============

  /**
   * 让出主线程时间片，防止长时间阻塞渲染
   * @returns {Promise<void>}
   */
  _yieldToMain() {
    switch (this._yieldMode) {
      case WebGPUASTCDecoder.YIELD_MODE_MESSAGE:
        return this._yieldViaMessageChannel();
      case WebGPUASTCDecoder.YIELD_MODE_RAF:
        return new Promise(resolve => requestAnimationFrame(resolve));
      case WebGPUASTCDecoder.YIELD_MODE_TIMEOUT:
      default:
        return new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  /**
   * 通过 MessageChannel 让出（比 setTimeout(0) 更快，约 0.1ms vs 4ms）
   */
  _yieldViaMessageChannel() {
    return new Promise(resolve => {
      if (!this._messageChannel) {
        this._messageChannel = new MessageChannel();
      }
      this._messageChannel.port1.onmessage = resolve;
      this._messageChannel.port2.postMessage(null);
    });
  }

  // ============ 内部：统计 ============

  _recordStats(startTime, batchCount) {
    const elapsed = performance.now() - startTime;
    this._stats.totalTexturesDecoded++;
    this._stats.totalBatchesDispatched += batchCount;
    this._stats.totalDecodeTimeMs += elapsed;
    this._stats.lastDecodeTimeMs = elapsed;
  }
}

  // ======================================================================
  // ASTC 格式码常量 / Block 尺寸查表
  // ======================================================================
  const ASTC_FORMATS = {
    0x93B0: { name: 'RGBA_ASTC_4x4',   bw: 4,  bh: 4,  srgb: false },
    0x93B1: { name: 'RGBA_ASTC_5x4',   bw: 5,  bh: 4,  srgb: false },
    0x93B2: { name: 'RGBA_ASTC_5x5',   bw: 5,  bh: 5,  srgb: false },
    0x93B3: { name: 'RGBA_ASTC_6x5',   bw: 6,  bh: 5,  srgb: false },
    0x93B4: { name: 'RGBA_ASTC_6x6',   bw: 6,  bh: 6,  srgb: false },
    0x93B5: { name: 'RGBA_ASTC_8x5',   bw: 8,  bh: 5,  srgb: false },
    0x93B6: { name: 'RGBA_ASTC_8x6',   bw: 8,  bh: 6,  srgb: false },
    0x93B7: { name: 'RGBA_ASTC_8x8',   bw: 8,  bh: 8,  srgb: false },
    0x93B8: { name: 'RGBA_ASTC_10x5',  bw: 10, bh: 5,  srgb: false },
    0x93B9: { name: 'RGBA_ASTC_10x6',  bw: 10, bh: 6,  srgb: false },
    0x93BA: { name: 'RGBA_ASTC_10x8',  bw: 10, bh: 8,  srgb: false },
    0x93BB: { name: 'RGBA_ASTC_10x10', bw: 10, bh: 10, srgb: false },
    0x93BC: { name: 'RGBA_ASTC_12x10', bw: 12, bh: 10, srgb: false },
    0x93BD: { name: 'RGBA_ASTC_12x12', bw: 12, bh: 12, srgb: false },
    0x93D0: { name: 'SRGB_ASTC_4x4',   bw: 4,  bh: 4,  srgb: true  },
    0x93D1: { name: 'SRGB_ASTC_5x4',   bw: 5,  bh: 4,  srgb: true  },
    0x93D2: { name: 'SRGB_ASTC_5x5',   bw: 5,  bh: 5,  srgb: true  },
    0x93D3: { name: 'SRGB_ASTC_6x5',   bw: 6,  bh: 5,  srgb: true  },
    0x93D4: { name: 'SRGB_ASTC_6x6',   bw: 6,  bh: 6,  srgb: true  },
    0x93D5: { name: 'SRGB_ASTC_8x5',   bw: 8,  bh: 5,  srgb: true  },
    0x93D6: { name: 'SRGB_ASTC_8x6',   bw: 8,  bh: 6,  srgb: true  },
    0x93D7: { name: 'SRGB_ASTC_8x8',   bw: 8,  bh: 8,  srgb: true  },
    0x93D8: { name: 'SRGB_ASTC_10x5',  bw: 10, bh: 5,  srgb: true  },
    0x93D9: { name: 'SRGB_ASTC_10x6',  bw: 10, bh: 6,  srgb: true  },
    0x93DA: { name: 'SRGB_ASTC_10x8',  bw: 10, bh: 8,  srgb: true  },
    0x93DB: { name: 'SRGB_ASTC_10x10', bw: 10, bh: 10, srgb: true  },
    0x93DC: { name: 'SRGB_ASTC_12x10', bw: 12, bh: 10, srgb: true  },
    0x93DD: { name: 'SRGB_ASTC_12x12', bw: 12, bh: 12, srgb: true  },
  };

  function isASTCInternalFormat(fmt) {
    return (fmt >= 0x93B0 && fmt <= 0x93BD) || (fmt >= 0x93D0 && fmt <= 0x93DD);
  }

  function getBlockSizeFromFormat(fmt) {
    const info = ASTC_FORMATS[fmt];
    return info ? { bw: info.bw, bh: info.bh, srgb: info.srgb } : null;
  }

  // ======================================================================
  // 统一入口 SDK
  // ======================================================================
  class WebGPUASTCDecoderSDK {
    /**
     * @param {Object} [options]
     * @param {boolean} [options.debug=false]             是否打开调试日志
     * @param {WebGLRenderingContext|WebGL2RenderingContext} [options.glContext] WebGL context（启用零拷贝模式）
     * @param {number} [options.maxBlocksPerBatch=Infinity] 单批最大块数
     * @param {string} [options.yieldMode='message']      批次让出模式
     * @param {function} [options.onDeviceLost]           device.lost 回调
     */
    constructor(options) {
      options = options || {};
      _SDK_DEBUG = !!options.debug;

      this._options = options;
      this._pipelineInit = null;
      this._textureFactory = null;
      this._decoder = null;
      this._initialized = false;
      this._deviceLostHandlers = options.onDeviceLost ? [options.onDeviceLost] : [];
      this._lastInitError = null;
      this._glContext = options.glContext || null;

      // 零拷贝模式下用于 OffscreenCanvas 池化
      this._canvasPool = new Map(); // key: `${w}x${h}` -> [{canvas, ctx}, ...]

      // GPUBuffer 池化（按 byteLength 分桶）
      this._bufferPool = new Map(); // key: byteLength -> [GPUBuffer, ...]
    }

    // ---------------- 静态方法 ----------------
    static isWebGPUSupported() {
      return typeof navigator !== 'undefined' && !!navigator.gpu;
    }

    static get ASTC_FORMATS() { return ASTC_FORMATS; }
    static isASTCInternalFormat(fmt) { return isASTCInternalFormat(fmt); }
    static getBlockSizeFromFormat(fmt) { return getBlockSizeFromFormat(fmt); }

    // ---------------- 生命周期 ----------------

    /**
     * 初始化 WebGPU pipeline；成功后 sdk.isAvailable() === true
     * 任何失败都会让 isAvailable() 返回 false，并通过 lastError() 暴露原因。
     * @returns {Promise<boolean>} 是否初始化成功
     */
    async init() {
      if (this._initialized) return true;
      if (!WebGPUASTCDecoderSDK.isWebGPUSupported()) {
        this._lastInitError = new Error('WebGPU not supported in this environment');
        _SDK_DEBUG && console.warn('[WebGPUASTCDecoderSDK] WebGPU not supported');
        return false;
      }
      try {
        this._pipelineInit = new WebGPUASTCPipelineInit();
        await this._pipelineInit.WebGPUPipelineInitialize();

        // 注册 device.lost 处理
        const device = this._pipelineInit._device;
        if (device && device.lost) {
          device.lost.then((info) => this._onDeviceLost(info)).catch(() => {});
        }

        this._textureFactory = new WebGPUASTCTextureFactory();
        this._decoder = new WebGPUASTCDecoder(this._pipelineInit, this._textureFactory, {
          maxBlocksPerBatch: this._options.maxBlocksPerBatch || Infinity,
          yieldMode: this._options.yieldMode || 'message',
          glContext: this._glContext,
        });
        this._initialized = true;
        _SDK_DEBUG && console.log('[WebGPUASTCDecoderSDK] 初始化成功');
        return true;
      } catch (e) {
        this._lastInitError = e;
        console.error('[WebGPUASTCDecoderSDK] 初始化失败:', e);
        return false;
      }
    }

    isAvailable() {
      return this._initialized && !!this._pipelineInit && !!this._pipelineInit._device;
    }

    lastError() { return this._lastInitError; }

    setGLContext(gl) {
      this._glContext = gl;
      if (this._decoder) this._decoder.setGLContext(gl);
    }

    onDeviceLost(cb) {
      if (typeof cb === 'function') this._deviceLostHandlers.push(cb);
    }

    _onDeviceLost(info) {
      console.warn('[WebGPUASTCDecoderSDK] device.lost:', info && info.message);
      this._initialized = false;
      for (const cb of this._deviceLostHandlers) {
        try { cb(info); } catch (e) { console.error(e); }
      }
    }

    destroy() {
      if (this._decoder) {
        try { this._decoder.destroy(); } catch (e) {}
      }
      // 释放 buffer 池
      for (const bufs of this._bufferPool.values()) {
        for (const b of bufs) { try { b.destroy(); } catch (e) {} }
      }
      this._bufferPool.clear();
      this._canvasPool.clear();
      this._pipelineInit = null;
      this._textureFactory = null;
      this._decoder = null;
      this._initialized = false;
    }

    // ---------------- 解码 API ----------------

    _ensureReady() {
      if (!this._initialized) {
        throw new Error('[WebGPUASTCDecoderSDK] SDK not initialized. Call await sdk.init() first.');
      }
    }

    _buildTextureInfo(data, width, height, blockWidth, blockHeight, glTextureId) {
      const blockCountX = Math.floor((width + blockWidth - 1) / blockWidth);
      const blockCountY = Math.floor((height + blockHeight - 1) / blockHeight);
      const totalBlocks = blockCountX * blockCountY;
      return {
        id: glTextureId != null ? glTextureId : (-1),
        data: data instanceof Uint8Array ? data : new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength),
        width, height,
        blockWidth, blockHeight, blockCountX, blockCountY, totalBlocks,
        status: 'pending',
      };
    }

    /**
     * 解码 ASTC 到 RGBA Uint8Array（CPU 回读）
     */
    async decodeToUint8Array(astcData, width, height, blockWidth, blockHeight) {
      this._ensureReady();
      const textureInfo = this._buildTextureInfo(astcData, width, height, blockWidth, blockHeight, -1);
      const originalGL = this._decoder._glContext;
      this._decoder._glContext = null; // 临时关闭零拷贝，强制走 readback
      try {
        return await this._decoder._decodeTexture(textureInfo);
      } finally {
        this._decoder._glContext = originalGL;
      }
    }

    /**
     * 解码 ASTC 到一个 OffscreenCanvas（零拷贝路径，数据停留在 GPU）
     * 返回 OffscreenCanvas 可直接传给 gl.texImage2D。
     * @returns {Promise<OffscreenCanvas>}
     */
    async decodeToCanvas(astcData, width, height, blockWidth, blockHeight) {
      this._ensureReady();
      const device = this._pipelineInit._device;

      const textureInfo = this._buildTextureInfo(astcData, width, height, blockWidth, blockHeight, -1);
      // 创建/复用目标 canvas
      const { canvas, ctx } = this._acquireCanvas(width, height);

      // 创建 output texture
      const outputTexture = device.createTexture({
        label: 'ASTC SDK decodeToCanvas Output',
        size: [width, height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
      });

      // 上传输入
      const inputBuffer = device.createBuffer({
        label: 'ASTC SDK decodeToCanvas Input',
        size: textureInfo.data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Uint8Array(inputBuffer.getMappedRange()).set(textureInfo.data);
      inputBuffer.unmap();

      // dispatch
      this._decoder._dispatchBatch(textureInfo, inputBuffer, outputTexture, 0, textureInfo.totalBlocks);

      // GPU→GPU 拷贝到 canvas 当前 texture
      const canvasTexture = ctx.getCurrentTexture();
      const encoder = device.createCommandEncoder({ label: 'ASTC SDK decodeToCanvas Transfer' });
      encoder.copyTextureToTexture(
        { texture: outputTexture },
        { texture: canvasTexture },
        [width, height]
      );
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();

      // 释放
      inputBuffer.destroy();
      outputTexture.destroy();

      return canvas;
    }

    /**
     * 解码 ASTC 并注入到指定的 WebGL 纹理（零拷贝首选，回退 readback）
     * @param {number} glTextureId - window.GL.textures 中的纹理 id
     * @returns {Promise<void>}
     */
    async decodeAndInjectToGLTexture(glTextureId, astcData, width, height, blockWidth, blockHeight) {
      this._ensureReady();
      if (!this._glContext) {
        throw new Error('[WebGPUASTCDecoderSDK] glContext 未设置，请先调用 setGLContext(gl)');
      }
      const textureInfo = this._buildTextureInfo(astcData, width, height, blockWidth, blockHeight, glTextureId);
      await this._decoder._decodeTexture(textureInfo);
    }

    // ---------------- OffscreenCanvas 池 ----------------
    _acquireCanvas(width, height) {
      const key = `${width}x${height}`;
      const pool = this._canvasPool.get(key);
      if (pool && pool.length) {
        return pool.pop();
      }
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('webgpu');
      ctx.configure({
        device: this._pipelineInit._device,
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
        alphaMode: 'opaque',
      });
      return { canvas, ctx };
    }

    _releaseCanvas(entry) {
      const key = `${entry.canvas.width}x${entry.canvas.height}`;
      if (!this._canvasPool.has(key)) this._canvasPool.set(key, []);
      const pool = this._canvasPool.get(key);
      // 最多保留 4 个
      if (pool.length < 4) pool.push(entry);
    }

    getCanvasPoolStats() {
      const stats = {};
      for (const [k, v] of this._canvasPool) stats[k] = v.length;
      return stats;
    }
  }

  return {
    WebGPUASTCDecoderSDK,
    WebGPUASTCPipelineInit,
    WebGPUASTCTextureFactory,
    WebGPUASTCDecoder,
    ASTC_FORMATS,
    isASTCInternalFormat,
    getBlockSizeFromFormat,
  };
});
