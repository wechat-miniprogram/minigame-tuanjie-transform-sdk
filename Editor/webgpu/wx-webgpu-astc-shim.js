/**
 * wx-webgpu-astc-shim.js
 * -------------------------------------------------------------------------
 * M3 - Unity WebGL Demo 运行时 ASTC 兼容 shim（readback 回退模式）
 *
 * 作用：
 *   浏览器 / 设备不支持 WEBGL_compressed_texture_astc 时，
 *   拦截 Unity 产物(webgl.framework.js) 对 ASTC 相关 GL API 的调用，
 *   通过 WebGPUASTCDecoderSDK 将 ASTC 解码为 RGBA 并回写到 WebGL。
 *
 * 本版本（M3 readback）核心策略：
 *   默认走 "异步 readback"：
 *     compressedTexImage2D(ASTC)  ──hook──▶
 *       1) 立即用 RGBA 占位写入（洋红 0xFF00FF），保证 Unity 后续 draw 不
 *          触发 INVALID_OPERATION；
 *       2) 将原始字节入"按纹理 FIFO"队列 → sdk.decodeToUint8Array(...)
 *          ─ .then 回调里做 GL state save / restore → texSubImage2D 回写。
 *     compressedTexImage3D / compressedTexSubImage3D：
 *       对 TEXTURE_2D_ARRAY / TEXTURE_3D，按 z 轴拆成每层 2D slice 独立解码，
 *       回写走 texSubImage3D(..., zoffset+i, ..., 1, ...)。
 *       TEXTURE_3D（真正的体积 ASTC）在规范上并不标准，仅以 2D slice 近似。
 *     PBO 分支（第 7 参数是 GPU 侧 offset）：仅打 warning 并写占位，
 *       不做 gl.getBufferSubData 回拉。本 Demo 不使用 PBO。
 *     OffscreenCanvas 零拷贝路径暂不启用（保留 MODE='zerocopy' 开关）。
 *
 * 关键风险点与本版本采取的对策：
 *   R1  异步 .then 回来后 Unity 的 GL 绑定已改变
 *        → 完整保存 / 恢复 activeTexture + 4 个 target binding + pixelStorei。
 *   R2  微任务被调度进 rAF 内的两次 drawCall 之间，污染纹理单元状态
 *        → 所有 GL 状态修改都被 state save/restore 包住，做到 "零副作用"。
 *   R3  异步回写期间 Unity 可能已 deleteTexture()
 *        → 监听 gl.deleteTexture，配合 gl.isTexture 二次校验，过期则丢弃。
 *   R4  同一张纹理多 mip level 被乱序回写 → 按纹理 FIFO 串行化（WeakMap）。
 *   R5  texStorage2D(ASTC) 分配了不可变压缩存储，后续 texSubImage2D(RGBA)
 *        会 INVALID_OPERATION → hook texStorage2D/3D 把 ASTC internalFormat
 *        改写为 RGBA8 / SRGB8_ALPHA8（SRGB 分支走 SRGB8_ALPHA8）。
 *   R6  rawBytes 是 HEAPU8.subarray(...) 视图，若 WASM 内存 grow，旧 buffer
 *        detach，回调里读到 byteLength=0 → HEAP_SAFE 开关控制：
 *          - 默认 true：无论路径都 snapshot 一份字节，彻底脱钩；
 *          - 可改 false：仅在可能异步分叉前才 snapshot；
 *        本实现里 happy path 仍调用 SDK 同步 queue.writeBuffer 完成 GPU
 *        拷贝，所以 "不 snapshot" 也安全；但开关默认开，覆盖最坏情况。
 *   R7  target 可能是 cubemap face / 2D_ARRAY / 3D → 按 target 选择对应
 *        的 binding pname；当前 Unity 主要上 2D，其它先走 2D binding（后续
 *        可按需扩展）。
 *   R8  WebGPU device.lost → 关 sdkReady，后续全部走占位。
 *
 * 开关（均可在引入本脚本前置于 window 上）：
 *   window.__WEBGPU_ASTC_DECODER_ENABLE__       = true;       // 总开关
 *   window.__WEBGPU_ASTC_DECODER_MODE__         = 'readback'; // 'readback'|'zerocopy'（zerocopy 预留未启用）
 *   window.__WEBGPU_ASTC_DECODER_VERBOSE__      = false;
 *   window.__WEBGPU_ASTC_DECODER_HEAP_SAFE__    = true;       // 是否拷贝原始 ASTC 字节抵御 HEAP detach
 *   window.__WEBGPU_ASTC_DECODER_PLACEHOLDER__  = 0xff00ff;   // 占位颜色（debug 用）
 *   window.__WEBGPU_ASTC_DECODER_APPLY_DECODE__ = true;       // 是否执行"异步解码 + 回写"；
 *                                                             //   true  → 正常走 WebGPU 解码回写，纹理渲染正常（默认）
 *                                                             //   false → 跳过异步解码与回写，纹理停留在占位色，
 *                                                             //           用于对比验证 / 开关 A/B 测试
 *                                                             // 运行期可热切，直接 window.__WEBGPU_ASTC_DECODER_APPLY_DECODE__ = false 即生效
 *
 * 观测接口（runtime 可读）：
 *   window.__WEBGPU_ASTC_DECODER_STATS__()       // 返回统计信息
 *   window.__WEBGPU_ASTC_DECODER_FLUSH__()       // 返回 Promise，等所有 pending 完成
 *
 * 引入方式（保持与旧版一致）：
 *   <script src="WebGPUASTCDecoderSDK.js"></script>
 *   <script src="wx-webgpu-astc-shim.js"></script>
 *   <script src="Build/xxx.loader.js"></script>
 * -------------------------------------------------------------------------
 */
(function () {
  'use strict';

  // ============================================================
  //                         开关 & 日志
  // ============================================================
  if (typeof window.__WEBGPU_ASTC_DECODER_ENABLE__ === 'undefined') {
    window.__WEBGPU_ASTC_DECODER_ENABLE__ = true;
  }
  var VERBOSE =
    typeof window.__WEBGPU_ASTC_DECODER_VERBOSE__ === 'boolean'
      ? window.__WEBGPU_ASTC_DECODER_VERBOSE__
      : false;
  var MODE =
    window.__WEBGPU_ASTC_DECODER_MODE__ === 'zerocopy' ? 'zerocopy' : 'readback';
  var HEAP_SAFE =
    typeof window.__WEBGPU_ASTC_DECODER_HEAP_SAFE__ === 'boolean'
      ? window.__WEBGPU_ASTC_DECODER_HEAP_SAFE__
      : true;
  var PLACEHOLDER_RGBA =
    typeof window.__WEBGPU_ASTC_DECODER_PLACEHOLDER__ === 'number'
      ? (window.__WEBGPU_ASTC_DECODER_PLACEHOLDER__ | 0)
      : 0xff00ff;

  // APPLY_DECODE 开关：控制"异步解码 + 回写"是否真正执行
  //   - true  → 正常走 WebGPU 解码并 texSubImage2D/3D 回写，纹理显示正常
  //   - false → 立即占位写完后直接 return，不下发解码任务，纹理维持占位色（验证用）
  // 只在 window 上读取，支持运行期热切（每次 hook 调用都取最新值）。
  if (typeof window.__WEBGPU_ASTC_DECODER_APPLY_DECODE__ === 'undefined') {
    window.__WEBGPU_ASTC_DECODER_APPLY_DECODE__ = true;
  }
  function isApplyDecodeEnabled() {
    // 显式 === false 才关闭，避免 undefined / 其它 truthy 值误判
    return window.__WEBGPU_ASTC_DECODER_APPLY_DECODE__ !== false;
  }

  var LOG_PREFIX = '[WXWebGPUAstcShim]';
  function log() {
    if (!VERBOSE) return;
    var a = Array.prototype.slice.call(arguments); a.unshift(LOG_PREFIX);
    // eslint-disable-next-line no-console
    console.log.apply(console, a);
  }
  function warn() {
    var a = Array.prototype.slice.call(arguments); a.unshift(LOG_PREFIX);
    // eslint-disable-next-line no-console
    console.warn.apply(console, a);
  }
  function errlog() {
    var a = Array.prototype.slice.call(arguments); a.unshift(LOG_PREFIX);
    // eslint-disable-next-line no-console
    console.error.apply(console, a);
  }

  if (!window.__WEBGPU_ASTC_DECODER_ENABLE__) {
    log('Disabled via window.__WEBGPU_ASTC_DECODER_ENABLE__ = false.');
    return;
  }
  if (typeof window.WebGPUASTCDecoderSDK === 'undefined') {
    errlog('WebGPUASTCDecoderSDK 未加载！请在本 shim 之前 <script src="WebGPUASTCDecoderSDK.js"></script>');
    return;
  }
  if (!(navigator && navigator.gpu)) {
    warn('当前环境不支持 WebGPU，保持原生行为。');
    return;
  }
  if (!window.WebGPUASTCDecoderSDK.isWebGPUSupported()) {
    warn('WebGPUASTCDecoderSDK.isWebGPUSupported() === false，保持原生行为。');
    return;
  }
  if (MODE !== 'readback') {
    // 预留：zerocopy 路径当前版本不启用
    warn('MODE=' + MODE + ' 暂未实现，自动回退到 readback。');
    MODE = 'readback';
  }

  // ============================================================
  //                       ASTC 常量 & 元数据
  // ============================================================
  // 14 个 block size：按 WEBGL_compressed_texture_astc 规范顺序
  var ASTC_BLOCK_SIZES = [
    [4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [8, 5], [8, 6],
    [8, 8], [10, 5], [10, 6], [10, 8], [10, 10], [12, 10], [12, 12]
  ];
  var ASTC_SUFFIXES = [
    '4x4', '5x4', '5x5', '6x5', '6x6', '8x5', '8x6',
    '8x8', '10x5', '10x6', '10x8', '10x10', '12x10', '12x12'
  ];
  var ASTC_RGBA_BASE = 0x93B0; // COMPRESSED_RGBA_ASTC_4x4_KHR
  var ASTC_SRGB_BASE = 0x93D0; // COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR

  var fakeAstcExt = { getSupportedProfiles: function () { return ['ldr']; } };
  var FORMAT_TO_BLOCK = Object.create(null);
  var FORMAT_IS_SRGB = Object.create(null);
  for (var i = 0; i < ASTC_SUFFIXES.length; i++) {
    var rgbaVal = ASTC_RGBA_BASE + i;
    var srgbVal = ASTC_SRGB_BASE + i;
    fakeAstcExt['COMPRESSED_RGBA_ASTC_' + ASTC_SUFFIXES[i] + '_KHR'] = rgbaVal;
    fakeAstcExt['COMPRESSED_SRGB8_ALPHA8_ASTC_' + ASTC_SUFFIXES[i] + '_KHR'] = srgbVal;
    FORMAT_TO_BLOCK[rgbaVal] = ASTC_BLOCK_SIZES[i];
    FORMAT_TO_BLOCK[srgbVal] = ASTC_BLOCK_SIZES[i];
    FORMAT_IS_SRGB[rgbaVal] = false;
    FORMAT_IS_SRGB[srgbVal] = true;
  }
  function isAstcInternalFormat(fmt) { return FORMAT_TO_BLOCK[fmt] !== undefined; }

  // ============================================================
  //                       SDK 单例
  // ============================================================
  var sdkInstance = null;
  var sdkInitPromise = null;
  var sdkReady = false;
  var sdkDead = false; // device lost 或初始化失败

  function ensureSDK(gl) {
    if (sdkInstance) return sdkInitPromise;
    try {
      sdkInstance = new window.WebGPUASTCDecoderSDK({
        debug: VERBOSE,
        glContext: gl,
        onDeviceLost: function (info) {
          sdkReady = false;
          sdkDead = true;
          warn('WebGPU device.lost，shim 已关闭，后续全部走占位。', info);
        }
      });
    } catch (e) {
      errlog('创建 WebGPUASTCDecoderSDK 失败：', e);
      sdkDead = true;
      sdkInitPromise = Promise.resolve(false);
      return sdkInitPromise;
    }
    sdkInitPromise = sdkInstance.init()
      .then(function (ok) {
        sdkReady = !!ok;
        sdkDead = !ok;
        if (ok) log('WebGPUASTCDecoderSDK 初始化成功。');
        else warn('WebGPUASTCDecoderSDK.init() 返回 false。');
        return ok;
      })
      .catch(function (e) {
        errlog('WebGPUASTCDecoderSDK.init() 抛异常：', e);
        sdkReady = false;
        sdkDead = true;
        return false;
      });
    window.__WEBGPU_ASTC_DECODER_SDK__ = sdkInstance;
    return sdkInitPromise;
  }

  // ============================================================
  //                       工具函数
  // ============================================================
  function normalizeAstcData(data) {
    if (data == null) return null;
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (typeof data === 'number') return null; // PBO offset 不支持
    return null;
  }

  /**
   * 将原始 ASTC 字节"脱钩"：即使 WASM HEAP grow 导致原 ArrayBuffer detach，
   * 也能保证我们持有的数据是有效的。
   */
  function snapshotRaw(view) {
    var copy = new Uint8Array(view.byteLength);
    copy.set(view);
    return copy;
  }

  /**
   * 构造一张纯色占位 RGBA 数据（仅用于首次 compressedTexImage2D 的占位）。
   * 使用缓存避免重复 alloc，同尺寸共享同一份 Uint8Array（只读不写）。
   */
  var _placeholderCache = Object.create(null);
  function buildPlaceholderRGBA(w, h) {
    var key = w + 'x' + h;
    if (_placeholderCache[key]) return _placeholderCache[key];
    var arr = new Uint8Array(w * h * 4);
    var r = (PLACEHOLDER_RGBA >> 16) & 0xff;
    var g = (PLACEHOLDER_RGBA >> 8) & 0xff;
    var b = PLACEHOLDER_RGBA & 0xff;
    for (var p = 0; p < arr.length; p += 4) {
      arr[p] = r; arr[p + 1] = g; arr[p + 2] = b; arr[p + 3] = 0xff;
    }
    _placeholderCache[key] = arr;
    return arr;
  }

  /**
   * 由 ASTC internalFormat 得到替代用的不可变存储格式。
   *   - RGBA 分支 → RGBA8
   *   - SRGB 分支 → SRGB8_ALPHA8
   */
  function getRewriteInternalFormat(gl, astcFmt) {
    return FORMAT_IS_SRGB[astcFmt] ? gl.SRGB8_ALPHA8 : gl.RGBA8;
  }

  /**
   * 根据 target 选择对应的 TEXTURE_BINDING_* pname。
   * 当前版本只处理 2D / CUBE_MAP / 2D_ARRAY / 3D。
   */
  function bindingEnumFor(gl, target) {
    switch (target) {
      case gl.TEXTURE_2D:                    return gl.TEXTURE_BINDING_2D;
      case gl.TEXTURE_CUBE_MAP:              return gl.TEXTURE_BINDING_CUBE_MAP;
      case gl.TEXTURE_CUBE_MAP_POSITIVE_X:
      case gl.TEXTURE_CUBE_MAP_NEGATIVE_X:
      case gl.TEXTURE_CUBE_MAP_POSITIVE_Y:
      case gl.TEXTURE_CUBE_MAP_NEGATIVE_Y:
      case gl.TEXTURE_CUBE_MAP_POSITIVE_Z:
      case gl.TEXTURE_CUBE_MAP_NEGATIVE_Z:
        return gl.TEXTURE_BINDING_CUBE_MAP;
      case gl.TEXTURE_2D_ARRAY:              return gl.TEXTURE_BINDING_2D_ARRAY;
      case gl.TEXTURE_3D:                    return gl.TEXTURE_BINDING_3D;
      default:                               return gl.TEXTURE_BINDING_2D;
    }
  }

  /** cubemap face target → 真正的 cubemap 容器 target */
  function containerTarget(gl, target) {
    switch (target) {
      case gl.TEXTURE_CUBE_MAP_POSITIVE_X:
      case gl.TEXTURE_CUBE_MAP_NEGATIVE_X:
      case gl.TEXTURE_CUBE_MAP_POSITIVE_Y:
      case gl.TEXTURE_CUBE_MAP_NEGATIVE_Y:
      case gl.TEXTURE_CUBE_MAP_POSITIVE_Z:
      case gl.TEXTURE_CUBE_MAP_NEGATIVE_Z:
        return gl.TEXTURE_CUBE_MAP;
      default: return target;
    }
  }

  // ============================================================
  //                     GL state save / restore
  // ============================================================
  /**
   * 保存将被我们触碰的 GL 状态：
   *   - activeTexture（4 个 target 的 binding 只在"当前 active unit"上生效）
   *   - 4 个 TEXTURE_BINDING_*
   *   - 6 个 pixelStorei
   * 这 11 项基本覆盖了 texSubImage2D / bindTexture 可能带来的副作用。
   */
  function saveGLState(gl) {
    return {
      activeTexture: gl.getParameter(gl.ACTIVE_TEXTURE),
      bind2D:        gl.getParameter(gl.TEXTURE_BINDING_2D),
      bindCube:      gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP),
      bind2DArray:   gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY),
      bind3D:        gl.getParameter(gl.TEXTURE_BINDING_3D),
      unpackAlign:   gl.getParameter(gl.UNPACK_ALIGNMENT),
      unpackRow:     gl.getParameter(gl.UNPACK_ROW_LENGTH),
      unpackSkipR:   gl.getParameter(gl.UNPACK_SKIP_ROWS),
      unpackSkipP:   gl.getParameter(gl.UNPACK_SKIP_PIXELS),
      flipY:         gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),
      premul:        gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL)
    };
  }
  function restoreGLState(gl, s) {
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,              s.unpackAlign);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH,             s.unpackRow);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS,              s.unpackSkipR);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS,            s.unpackSkipP);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,           s.flipY);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, s.premul);
    gl.bindTexture(gl.TEXTURE_2D,       s.bind2D);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, s.bindCube);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, s.bind2DArray);
    gl.bindTexture(gl.TEXTURE_3D,       s.bind3D);
    gl.activeTexture(s.activeTexture);
  }

  // ============================================================
  //                   每张目标纹理一条 FIFO 队列
  // ============================================================
  // 目的：保证同一张 WebGLTexture 的多个 level / face 按提交顺序回写，
  //       避免 mipmap 乱序。不同纹理之间允许并发。
  var queuesByTex = new WeakMap();
  function enqueueForTexture(tex, job) {
    var tail = queuesByTex.get(tex) || Promise.resolve();
    var next = tail.then(job, job); // 前序失败不影响后续
    queuesByTex.set(tex, next);
    return next;
  }

  // 跟踪被 delete 的纹理 -> pending 任务应丢弃
  var cancelledTextures = new WeakSet();

  // ============================================================
  //                           统计
  // ============================================================
  var stats = {
    hookedTexStorage2D: 0,
    hookedTexStorage3D: 0,
    hookedCompressedTexImage2D: 0,
    hookedCompressedTexSubImage2D: 0,
    hookedCompressedTexImage3D: 0,
    hookedCompressedTexSubImage3D: 0,
    decodeSuccess: 0,
    decodeFailed: 0,
    decodeDroppedByDeletedTex: 0,
    decodeDroppedByLostDevice: 0,
    decodeSkippedByDisabled: 0, // APPLY_DECODE 关闭时跳过的次数
    pboSkipped: 0,            // PBO 路径被跳过的总次数（2D + 3D）
    volumeAstcSkipped: 0,     // 体积 ASTC（非数组纹理）被跳过的次数
    pendingPeak: 0,
    pendingNow: 0
  };
  var pendingJobs = []; // 仅供 FLUSH 接口同步一次性 await

  // ============================================================
  //                           gl 包装
  // ============================================================
  function wrapGL(gl) {
    if (gl.__wxAstcShimWrapped) return gl;
    gl.__wxAstcShimWrapped = true;

    // 原生支持就不拦截
    var nativeAstc = null;
    try { nativeAstc = gl.getExtension('WEBGL_compressed_texture_astc'); } catch (_) {}
    if (nativeAstc) {
      log('原生支持 WEBGL_compressed_texture_astc，shim 不做拦截。');
      return gl;
    }
    warn('原生不支持 ASTC，启用 WebGPU readback fallback 路径。');

    ensureSDK(gl);

    // ---------- hook getExtension ----------
    var origGetExtension = gl.getExtension.bind(gl);
    gl.getExtension = function (name) {
      if (name === 'WEBGL_compressed_texture_astc') return fakeAstcExt;
      return origGetExtension(name);
    };

    // ---------- hook getSupportedExtensions ----------
    // Unity 2022 的 GraphicsFormatUtility 会先扫 getSupportedExtensions()，
    // 命中 'WEBGL_compressed_texture_astc' 才把 ASTC 家族标为 GPU 支持，
    // 否则直接走 CPU 软解 + Shader fallback。所以必须把 ASTC 加进列表。
    var origGetSupportedExtensions = gl.getSupportedExtensions
      ? gl.getSupportedExtensions.bind(gl) : null;
    if (origGetSupportedExtensions) {
      gl.getSupportedExtensions = function () {
        var arr = origGetSupportedExtensions() || [];
        if (arr.indexOf('WEBGL_compressed_texture_astc') === -1) {
          arr = arr.concat(['WEBGL_compressed_texture_astc']);
        }
        return arr;
      };
    }

    // ---------- hook getInternalformatParameter ----------
    // Unity 会用 getInternalformatParameter(TEXTURE_2D, <ASTC_FMT>, NUM_SAMPLE_COUNTS)
    // 二次校验。原生不支持时驱动抛 INVALID_ENUM，Unity 就判 ASTC 不可用 →
    // 走 decompressing texture 这条 CPU 慢路径。我们对 ASTC 枚举直接返回合法值。
    if (typeof gl.getInternalformatParameter === 'function') {
      var origGetIFP = gl.getInternalformatParameter.bind(gl);
      var GL_NUM_SAMPLE_COUNTS = 0x9380;
      var GL_SAMPLES           = 0x80A9;
      gl.getInternalformatParameter = function (target, internalFormat, pname) {
        if (isAstcInternalFormat(internalFormat)) {
          // ASTC 是压缩纹理，不支持多重采样。给出合法但"无采样数"的答复：
          // NUM_SAMPLE_COUNTS=1 / SAMPLES=[0]。
          // 关键在于"不抛 INVALID_ENUM"，让 Unity 认为驱动认识这个格式。
          if (pname === GL_SAMPLES) return new Int32Array([0]);
          if (pname === GL_NUM_SAMPLE_COUNTS) return new Int32Array([1]);
          return new Int32Array([0]);
        }
        return origGetIFP(target, internalFormat, pname);
      };
    }

    // ---------- hook texStorage2D / texStorage3D（R5） ----------
    if (typeof gl.texStorage2D === 'function') {
      var origTexStorage2D = gl.texStorage2D.bind(gl);
      gl.texStorage2D = function (target, levels, internalFormat, width, height) {
        if (isAstcInternalFormat(internalFormat)) {
          stats.hookedTexStorage2D++;
          var rf = getRewriteInternalFormat(gl, internalFormat);
          log('texStorage2D ASTC(0x' + internalFormat.toString(16) + ') → 0x' + rf.toString(16),
              levels, width, height);
          return origTexStorage2D(target, levels, rf, width, height);
        }
        return origTexStorage2D(target, levels, internalFormat, width, height);
      };
    }
    if (typeof gl.texStorage3D === 'function') {
      var origTexStorage3D = gl.texStorage3D.bind(gl);
      gl.texStorage3D = function (target, levels, internalFormat, width, height, depth) {
        if (isAstcInternalFormat(internalFormat)) {
          stats.hookedTexStorage3D++;
          var rf = getRewriteInternalFormat(gl, internalFormat);
          return origTexStorage3D(target, levels, rf, width, height, depth);
        }
        return origTexStorage3D(target, levels, internalFormat, width, height, depth);
      };
    }

    // ---------- hook deleteTexture（R3） ----------
    var origDeleteTexture = gl.deleteTexture.bind(gl);
    gl.deleteTexture = function (tex) {
      if (tex) cancelledTextures.add(tex);
      return origDeleteTexture(tex);
    };

    // ---------- 共用：异步回写（2D 路径） ----------
    /**
     * 下发解码 + 异步回写。
     * @param {WebGLTexture} tex        目标 WebGLTexture
     * @param {number}       target     真正的 GL target（face 会被展开）
     * @param {number}       level
     * @param {number}       xoffset    fullImage 时为 0
     * @param {number}       yoffset    fullImage 时为 0
     * @param {number}       width
     * @param {number}       height
     * @param {number}       bw
     * @param {number}       bh
     * @param {Uint8Array}   rawBytes   已 snapshot 过 / 未 snapshot 的字节
     * @param {boolean}      fullImage  true=走 texImage2D 重分配，false=texSubImage2D
     */
    function scheduleDecode(tex, target, level, xoffset, yoffset, width, height,
                            bw, bh, rawBytes, fullImage) {
      if (!tex) return; // 没绑定，放弃
      if (!isApplyDecodeEnabled()) {
        // APPLY_DECODE 关闭：不下发异步解码，纹理保持占位色（用于 A/B 验证）
        stats.decodeSkippedByDisabled = (stats.decodeSkippedByDisabled | 0) + 1;
        return;
      }
      var job = enqueueForTexture(tex, function () {
        if (sdkDead || !sdkReady) {
          stats.decodeDroppedByLostDevice++;
          return;
        }
        if (cancelledTextures.has(tex) || !gl.isTexture(tex)) {
          stats.decodeDroppedByDeletedTex++;
          return;
        }
        return sdkInstance.decodeToUint8Array(rawBytes, width, height, bw, bh)
          .then(function (rgba) {
            if (cancelledTextures.has(tex) || !gl.isTexture(tex)) {
              stats.decodeDroppedByDeletedTex++;
              return;
            }
            var saved = saveGLState(gl);
            try {
              var ctarget = containerTarget(gl, target);
              gl.activeTexture(saved.activeTexture); // 保持在当前 active unit，降低副作用面
              gl.bindTexture(ctarget, tex);
              gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
              gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
              gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
              gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
              gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
              gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
              if (fullImage) {
                // compressedTexImage2D 对应：占位已是 texImage2D 分配好的 storage
                // → 用 texSubImage2D 回写（不改变 storage 格式）
                gl.texSubImage2D(target, level, 0, 0, width, height,
                  gl.RGBA, gl.UNSIGNED_BYTE, rgba);
              } else {
                gl.texSubImage2D(target, level, xoffset, yoffset, width, height,
                  gl.RGBA, gl.UNSIGNED_BYTE, rgba);
              }
              stats.decodeSuccess++;
              log('回写完成 level=' + level + ' ' + width + 'x' + height +
                  (fullImage ? ' (full)' : ' (sub ' + xoffset + ',' + yoffset + ')'));
            } finally {
              restoreGLState(gl, saved);
              stats.pendingNow--;
            }
          })
          .catch(function (e) {
            stats.decodeFailed++;
            stats.pendingNow--;
            errlog('decodeToUint8Array 失败：', e);
          });
      });
      stats.pendingNow++;
      if (stats.pendingNow > stats.pendingPeak) stats.pendingPeak = stats.pendingNow;
      pendingJobs.push(job);
    }

    // ---------- 共用：异步回写（3D / 2D_ARRAY 分层路径） ----------
    /**
     * 把一张 2D slice 解码后通过 texSubImage3D 写回对应的 zoffset 层。
     * 仅用于 `compressedTexImage3D` / `compressedTexSubImage3D` 的分层处理，
     * 每次调用对应一层（depth=1）。
     */
    function scheduleDecode3DSlice(tex, target, level, xoffset, yoffset, zoffset,
                                   width, height, bw, bh, sliceBytes) {
      if (!tex) return;
      if (!isApplyDecodeEnabled()) {
        stats.decodeSkippedByDisabled = (stats.decodeSkippedByDisabled | 0) + 1;
        return;
      }
      var job = enqueueForTexture(tex, function () {
        if (sdkDead || !sdkReady) {
          stats.decodeDroppedByLostDevice++;
          return;
        }
        if (cancelledTextures.has(tex) || !gl.isTexture(tex)) {
          stats.decodeDroppedByDeletedTex++;
          return;
        }
        return sdkInstance.decodeToUint8Array(sliceBytes, width, height, bw, bh)
          .then(function (rgba) {
            if (cancelledTextures.has(tex) || !gl.isTexture(tex)) {
              stats.decodeDroppedByDeletedTex++;
              return;
            }
            var saved = saveGLState(gl);
            try {
              gl.activeTexture(saved.activeTexture);
              gl.bindTexture(target, tex);
              gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
              gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
              gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
              gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
              gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
              gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
              gl.texSubImage3D(target, level, xoffset, yoffset, zoffset,
                width, height, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
              stats.decodeSuccess++;
              log('3D 分层回写 level=' + level + ' ' + width + 'x' + height +
                  ' z=' + zoffset);
            } finally {
              restoreGLState(gl, saved);
              stats.pendingNow--;
            }
          })
          .catch(function (e) {
            stats.decodeFailed++;
            stats.pendingNow--;
            errlog('decodeToUint8Array(3D slice) 失败：', e);
          });
      });
      stats.pendingNow++;
      if (stats.pendingNow > stats.pendingPeak) stats.pendingPeak = stats.pendingNow;
      pendingJobs.push(job);
    }

    /**
     * 对 TEXTURE_2D_ARRAY：每层是独立的 2D ASTC slice，字节步长固定：
     *   sliceBytes = ceil(w/bw) * ceil(h/bh) * 16
     * 对 TEXTURE_3D（真正的 3D 体积 ASTC）：ASTC 只有 2D block footprint，
     *   体积纹理的分层行为在规范上并不标准（ES3.2 不要求 ASTC 3D），
     *   此处按"每 z-slice 独立 2D ASTC 块流"近似处理，实践中非常罕见。
     */
    function computeSliceBytes(w, h, bw, bh) {
      var cx = Math.ceil(w / bw);
      var cy = Math.ceil(h / bh);
      return cx * cy * 16;
    }

    // ---------- hook compressedTexImage2D ----------
    var origCompressedTexImage2D = gl.compressedTexImage2D.bind(gl);
    gl.compressedTexImage2D = function (target, level, internalFormat, width, height, border) {
      if (!isAstcInternalFormat(internalFormat)) {
        return origCompressedTexImage2D.apply(null, arguments);
      }
      stats.hookedCompressedTexImage2D++;

      var data = arguments[6];
      var srcOffset = arguments[7];
      var srcLengthOverride = arguments[8];
      var block = FORMAT_TO_BLOCK[internalFormat];
      var bw = block[0], bh = block[1];

      // PBO 分支：第 7 参数是 GPU 侧 offset（number）而非 ArrayBufferView，
      //          当前 WebGPU decoder 无法直接拿到 PIXEL_UNPACK_BUFFER 里的字节，
      //          需要额外走 gl.getBufferSubData 才能拿到原始 ASTC 流。
      //          本 Demo 不使用，先打 warning 并仅做占位，保留"早失败"特性。
      if (typeof data === 'number') {
        stats.pboSkipped++;
        warn('compressedTexImage2D(PBO offset=' + data + ') 暂不支持，' +
             '仅写占位色。level=' + level + ' ' + width + 'x' + height +
             ' fmt=0x' + internalFormat.toString(16));
      }

      var rawBytes = normalizeAstcData(data);
      if (rawBytes && typeof srcOffset === 'number') {
        var byteLen = typeof srcLengthOverride === 'number'
          ? srcLengthOverride
          : (rawBytes.byteLength - srcOffset);
        rawBytes = new Uint8Array(rawBytes.buffer, rawBytes.byteOffset + srcOffset, byteLen);
      }

      // 记录当前绑定的 WebGLTexture（R7：按 target 选 pname）
      var tex = gl.getParameter(bindingEnumFor(gl, target));

      // 立即占位（R5 的配套：占位用 RGBA8/RGBA 无压缩格式写入）
      var rewriteFmt = getRewriteInternalFormat(gl, internalFormat);
      var savedForPlaceholder = saveGLState(gl);
      try {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(target, level, rewriteFmt, width, height, 0,
          gl.RGBA, gl.UNSIGNED_BYTE, buildPlaceholderRGBA(width, height));
      } finally {
        // texImage2D 不改 binding，pixelStorei 恢复到调用者原值
        restoreGLState(gl, savedForPlaceholder);
      }

      if (!rawBytes || !sdkReady || sdkDead) {
        return;
      }

      // R6：snapshot 决策
      //   HEAP_SAFE=true  → 总拷贝（128KB/张，memcpy 级别开销，换稳）
      //   HEAP_SAFE=false → 相信 SDK 在同步段完成 queue.writeBuffer，不拷贝
      var bytesForDecode = HEAP_SAFE ? snapshotRaw(rawBytes) : rawBytes;

      scheduleDecode(tex, target, level, 0, 0, width, height, bw, bh, bytesForDecode, true);
    };

    // ---------- hook compressedTexSubImage2D ----------
    var origCompressedTexSubImage2D = gl.compressedTexSubImage2D.bind(gl);
    gl.compressedTexSubImage2D = function (target, level, xoffset, yoffset, width, height, format) {
      if (!isAstcInternalFormat(format)) {
        return origCompressedTexSubImage2D.apply(null, arguments);
      }
      stats.hookedCompressedTexSubImage2D++;

      // 签名：(target, level, xoffset, yoffset, width, height, format, imageSize|srcData, srcOffset?, srcLengthOverride?)
      var arg7 = arguments[7];
      var arg8 = arguments[8];
      var arg9 = arguments[9];
      var rawBytes = null;
      var srcOffset = 0, srcLengthOverride;

      if (typeof arg7 === 'number' && (arg8 == null)) {
        // PBO 路径：arg7 是 GPU 侧 offset（number）。理由同 compressedTexImage2D。
        stats.pboSkipped++;
        warn('compressedTexSubImage2D(PBO offset=' + arg7 + ') 暂不支持，跳过回写。' +
             'level=' + level + ' ' + width + 'x' + height +
             ' fmt=0x' + format.toString(16));
        return;
      }
      if (arg7 && (arg7.buffer || arg7 instanceof ArrayBuffer)) {
        rawBytes = normalizeAstcData(arg7);
        srcOffset = typeof arg8 === 'number' ? arg8 : 0;
        srcLengthOverride = typeof arg9 === 'number' ? arg9 : undefined;
      } else {
        warn('compressedTexSubImage2D 未识别参数，跳过。');
        return;
      }
      if (rawBytes && srcOffset) {
        var byteLen2 = (typeof srcLengthOverride === 'number')
          ? srcLengthOverride
          : (rawBytes.byteLength - srcOffset);
        rawBytes = new Uint8Array(rawBytes.buffer, rawBytes.byteOffset + srcOffset, byteLen2);
      }

      var block2 = FORMAT_TO_BLOCK[format];
      var bw2 = block2[0], bh2 = block2[1];

      var tex2 = gl.getParameter(bindingEnumFor(gl, target));
      if (!rawBytes || !sdkReady || sdkDead || !tex2) return;

      var bytesForDecode2 = HEAP_SAFE ? snapshotRaw(rawBytes) : rawBytes;
      scheduleDecode(tex2, target, level, xoffset, yoffset, width, height, bw2, bh2,
        bytesForDecode2, false);
    };

    // ---------- hook compressedTexImage3D ----------
    // 仅 WebGL2 存在。签名：
    //   compressedTexImage3D(target, level, internalformat, width, height, depth, border,
    //                        imageSize | srcData, srcOffset?, srcLengthOverride?)
    if (typeof gl.compressedTexImage3D === 'function') {
      var origCompressedTexImage3D = gl.compressedTexImage3D.bind(gl);
      gl.compressedTexImage3D = function (target, level, internalFormat,
                                          width, height, depth, border) {
        if (!isAstcInternalFormat(internalFormat)) {
          return origCompressedTexImage3D.apply(null, arguments);
        }
        stats.hookedCompressedTexImage3D++;

        var data3d = arguments[7];
        var srcOffset3d = arguments[8];
        var srcLengthOverride3d = arguments[9];
        var block3d = FORMAT_TO_BLOCK[internalFormat];
        var bw3d = block3d[0], bh3d = block3d[1];

        // PBO 路径 warning（同 2D）
        if (typeof data3d === 'number') {
          stats.pboSkipped++;
          warn('compressedTexImage3D(PBO offset=' + data3d + ') 暂不支持，' +
               '仅写占位色。level=' + level + ' ' + width + 'x' + height +
               'x' + depth + ' fmt=0x' + internalFormat.toString(16));
        }

        // 体积 ASTC（TEXTURE_3D）不在 WebGL/ES 规范要求范围内，标记 warning 后继续
        // 按"每 z-slice 独立 2D ASTC 字节流"处理；TEXTURE_2D_ARRAY 是正常路径。
        if (target === gl.TEXTURE_3D) {
          stats.volumeAstcSkipped++;
          warn('compressedTexImage3D(TEXTURE_3D) 的体积 ASTC 极少见，' +
               '按 2D slice 近似解码。如画面异常请反馈。');
        }

        var raw3d = normalizeAstcData(data3d);
        if (raw3d && typeof srcOffset3d === 'number') {
          var byteLen3d = typeof srcLengthOverride3d === 'number'
            ? srcLengthOverride3d
            : (raw3d.byteLength - srcOffset3d);
          raw3d = new Uint8Array(raw3d.buffer, raw3d.byteOffset + srcOffset3d, byteLen3d);
        }

        var tex3d = gl.getParameter(bindingEnumFor(gl, target));

        // 占位：用 texImage3D 分配 RGBA8 / SRGB8_ALPHA8 storage，保证后续 draw 合法
        var rewriteFmt3d = getRewriteInternalFormat(gl, internalFormat);
        var placeholder2D = buildPlaceholderRGBA(width, height);
        var savedPh3d = saveGLState(gl);
        try {
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
          gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
          gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
          gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          // 先分配整体 storage（null data），再逐层占位避免构造巨大数组
          gl.texImage3D(target, level, rewriteFmt3d, width, height, depth, 0,
            gl.RGBA, gl.UNSIGNED_BYTE, null);
          // 当前 GL 上下文仍绑定着对应纹理，直接填占位
          gl.bindTexture(target, tex3d);
          for (var zi = 0; zi < depth; zi++) {
            gl.texSubImage3D(target, level, 0, 0, zi, width, height, 1,
              gl.RGBA, gl.UNSIGNED_BYTE, placeholder2D);
          }
        } finally {
          restoreGLState(gl, savedPh3d);
        }

        if (!raw3d || !sdkReady || sdkDead || !tex3d) return;

        var sliceStride = computeSliceBytes(width, height, bw3d, bh3d);
        if (raw3d.byteLength < sliceStride * depth) {
          warn('compressedTexImage3D 数据长度不足（expect ' + (sliceStride * depth) +
               ', got ' + raw3d.byteLength + '），停止 3D 分层解码。');
          return;
        }

        // 逐层入队；每层独立 snapshot（HEAP_SAFE 语义需要）
        for (var z = 0; z < depth; z++) {
          var sliceView = new Uint8Array(raw3d.buffer,
            raw3d.byteOffset + z * sliceStride, sliceStride);
          var sliceBytes = HEAP_SAFE ? snapshotRaw(sliceView) : sliceView;
          scheduleDecode3DSlice(tex3d, target, level, 0, 0, z,
            width, height, bw3d, bh3d, sliceBytes);
        }
      };
    }

    // ---------- hook compressedTexSubImage3D ----------
    // 签名：
    //   compressedTexSubImage3D(target, level, xoffset, yoffset, zoffset,
    //                           width, height, depth, format,
    //                           imageSize | srcData, srcOffset?, srcLengthOverride?)
    if (typeof gl.compressedTexSubImage3D === 'function') {
      var origCompressedTexSubImage3D = gl.compressedTexSubImage3D.bind(gl);
      gl.compressedTexSubImage3D = function (target, level, xoffset, yoffset, zoffset,
                                             width, height, depth, format) {
        if (!isAstcInternalFormat(format)) {
          return origCompressedTexSubImage3D.apply(null, arguments);
        }
        stats.hookedCompressedTexSubImage3D++;

        var argA = arguments[9];
        var argB = arguments[10];
        var argC = arguments[11];

        // PBO 路径
        if (typeof argA === 'number' && (argB == null)) {
          stats.pboSkipped++;
          warn('compressedTexSubImage3D(PBO offset=' + argA + ') 暂不支持，跳过回写。' +
               'level=' + level + ' ' + width + 'x' + height + 'x' + depth +
               ' fmt=0x' + format.toString(16));
          return;
        }

        if (target === gl.TEXTURE_3D) {
          stats.volumeAstcSkipped++;
          warn('compressedTexSubImage3D(TEXTURE_3D) 的体积 ASTC 按 2D slice 近似处理。');
        }

        var rawSub3d = null;
        var srcOff3d = 0, srcLen3d;
        if (argA && (argA.buffer || argA instanceof ArrayBuffer)) {
          rawSub3d = normalizeAstcData(argA);
          srcOff3d = typeof argB === 'number' ? argB : 0;
          srcLen3d = typeof argC === 'number' ? argC : undefined;
        } else {
          warn('compressedTexSubImage3D 未识别参数，跳过。');
          return;
        }
        if (rawSub3d && srcOff3d) {
          var byteLenS3d = (typeof srcLen3d === 'number')
            ? srcLen3d
            : (rawSub3d.byteLength - srcOff3d);
          rawSub3d = new Uint8Array(rawSub3d.buffer,
            rawSub3d.byteOffset + srcOff3d, byteLenS3d);
        }

        var blockSub3d = FORMAT_TO_BLOCK[format];
        var bwS3d = blockSub3d[0], bhS3d = blockSub3d[1];

        var texSub3d = gl.getParameter(bindingEnumFor(gl, target));
        if (!rawSub3d || !sdkReady || sdkDead || !texSub3d) return;

        var sliceStrideSub = computeSliceBytes(width, height, bwS3d, bhS3d);
        if (rawSub3d.byteLength < sliceStrideSub * depth) {
          warn('compressedTexSubImage3D 数据长度不足（expect ' +
               (sliceStrideSub * depth) + ', got ' + rawSub3d.byteLength + '），跳过。');
          return;
        }

        for (var zs = 0; zs < depth; zs++) {
          var svSub = new Uint8Array(rawSub3d.buffer,
            rawSub3d.byteOffset + zs * sliceStrideSub, sliceStrideSub);
          var bytesSliceSub = HEAP_SAFE ? snapshotRaw(svSub) : svSub;
          scheduleDecode3DSlice(texSub3d, target, level,
            xoffset, yoffset, zoffset + zs,
            width, height, bwS3d, bhS3d, bytesSliceSub);
        }
      };
    }

    // 暴露调试入口
    window.__WEBGPU_ASTC_DECODER_GL__ = gl;

    return gl;
  }

  // ============================================================
  //                       hook getContext
  // ============================================================
  var _origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    var ctx = _origGetContext.call(this, type, attrs);
    if (!ctx) return ctx;
    if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') {
      try { wrapGL(ctx); } catch (e) { errlog('wrapGL 失败：', e); }
    }
    return ctx;
  };

  // ============================================================
  //                   hook createUnityInstance
  // ============================================================
  var _createUnityInstanceInternal;
  Object.defineProperty(window, 'createUnityInstance', {
    configurable: true,
    get: function () {
      if (!_createUnityInstanceInternal) return undefined;
      return function wrappedCreateUnityInstance(canvas, config, onProgress) {
        log('createUnityInstance 被调用，预初始化 WebGPU SDK...');
        if (!sdkInstance) {
          try {
            sdkInstance = new window.WebGPUASTCDecoderSDK({
              debug: VERBOSE,
              onDeviceLost: function (info) {
                sdkReady = false;
                sdkDead = true;
                warn('WebGPU device.lost（预初始化阶段）：', info);
              }
            });
            window.__WEBGPU_ASTC_DECODER_SDK__ = sdkInstance;
            sdkInitPromise = sdkInstance.init()
              .then(function (ok) {
                sdkReady = !!ok;
                sdkDead = !ok;
                if (ok) log('SDK 预初始化成功（createUnityInstance 前置）');
                else warn('SDK 预初始化失败');
                return ok;
              })
              .catch(function (e) {
                errlog('SDK 预初始化异常：', e);
                sdkDead = true;
                return false;
              });
          } catch (e) {
            errlog('SDK 预构造失败：', e);
            sdkDead = true;
            sdkInitPromise = Promise.resolve(false);
          }
        }
        var startTs = performance.now();
        return sdkInitPromise.then(function () {
          log('SDK 初始化耗时 ' + (performance.now() - startTs).toFixed(1) + 'ms，开始 Unity 启动');
          return _createUnityInstanceInternal(canvas, config, onProgress);
        });
      };
    },
    set: function (v) {
      _createUnityInstanceInternal = v;
      log('已截获 createUnityInstance 赋值。');
    }
  });

  // ============================================================
  //                        外部观测接口
  // ============================================================
  window.__WEBGPU_ASTC_DECODER_STATS__ = function () {
    return {
      mode: MODE,
      heapSafe: HEAP_SAFE,
      applyDecode: isApplyDecodeEnabled(),
      sdkReady: sdkReady,
      sdkDead: sdkDead,
      stats: Object.assign({}, stats)
    };
  };
  window.__WEBGPU_ASTC_DECODER_FLUSH__ = function () {
    // 复制快照；新增的 job 不在此次等待范围，调用者需要时可再次调用
    var snap = pendingJobs.slice();
    return Promise.allSettled
      ? Promise.allSettled(snap)
      : Promise.all(snap.map(function (p) { return p.catch(function () {}); }));
  };

  log('shim 装载完成。MODE=' + MODE + ' HEAP_SAFE=' + HEAP_SAFE +
      ' VERBOSE=' + VERBOSE +
      ' APPLY_DECODE=' + isApplyDecodeEnabled() +
      '。enable=' + window.__WEBGPU_ASTC_DECODER_ENABLE__);
})();
