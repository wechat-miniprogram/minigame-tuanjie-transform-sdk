// ★ 自动生成文件 — 请勿手动编辑 ★
// 由 tools/gen_glue.py 从 emsdk 4.0.13 的 libwebgpu.js 生成。
// 生成日期：2026-09-17
//
// 全 emsdk 版本通用（3.1.8 / 3.1.39 / 4.0.13 均已实测）：
//   - 浏览器端：wxwgpu_browser_wgpuXxx 为真实现（marshaling 复用 emsdk
//     library_webgpu.js 已验证逻辑，转发到 navigator.gpu）
//   - 微信端：同一份 emscripten .js 携带本 glue 以解析 wasm import 表，
//     函数体不会被调用（C++ 分发壳只走微信指令流路径）
//
// 与 emsdk 解耦的三件事（详见 tools/gen_glue.py 文件头）：
//   1. struct 偏移不用 C_STRUCTS，冻结为 adapter webgpu.h 实测字面量
//      （tools/struct_offsets-4.0.13.json）——C_STRUCTS 是链接时 emcc 自己的
//      webgpu.h 生成的，旧 emsdk 与 adapter 的 4.0.13 webgpu.h 不同代；
//   2. 库条目一律 function 形式、不用可选链、不用 u32/i53 堆类型、
//      不依赖系统库 $ 符号（全部本地 polyfill）；
//   3. 不用 PTHREADS 预处理分支（3.1.x/4.x 名字不同），改运行期判断。
//
// 前提与约束：
//   - 只适用 wasm32（指针 4 字节）；
//   - 改 include/webgpu/webgpu.h 后必须重跑：
//       python3 tools/gen_glue.py --gen-offsets && python3 tools/gen_glue.py
//     （可用 --check 校验偏移表是否过期）
//   - 链接要求：glue 直接调用 _malloc/_free/_memalign，若应用未导出需加
//     -sEXPORTED_FUNCTIONS=...,_malloc,_free,_memalign
//
// 重新生成：python3 tools/gen_glue.py

/**
 * @license
 * Copyright 2019 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

/*
 * WebGPU support.
 *
 * **IMPORTANT NOTICE:**
 * These bindings are **deprecated and unmaintained** and will be removed.
 * Please see system/include/webgpu/README.md for more information.
 *
 * This file and system/lib/webgpu/webgpu.cpp together implement the
 * to-be-standardized C header <webgpu/webgpu.h> on top of the
 * browser's native JS WebGPU implementation. This allows applications targeting
 * wgpu-native (https://github.com/gfx-rs/wgpu-native) or
 * Dawn (https://dawn.googlesource.com/dawn/) to also target the Web with the
 * same graphics API and fairly minimal changes - similar to OpenGL ES 2.0/3.0
 * on WebGL 1.0/2.0.
 *
 * To test this, run the following tests:
 * - test/runner.py 'other.test_webgpu*'
 * - EMTEST_BROWSER="/path/to/chrome --user-data-dir=chromeuserdata --enable-unsafe-webgpu" \
 *   test/runner.py 'browser.test_webgpu*'
 */

{{{
  // Helper functions for code generation
  globalThis.gpu = {
    makeInitManager: function(type) {
      return `WebGPU.mgr${type} = new Manager();`;
    },

    makeReferenceRelease: function(type) {
      return `
wxwgpu_browser_wgpu${type}Reference: function(id) { return WebGPU.mgr${type}.reference(id); },
wxwgpu_browser_wgpu${type}Release: function(id) { return WebGPU.mgr${type}.release(id); },`;
    },

    convertSentinelToUndefined: function(name) {
      return `if (${name} == -1) ${name} = undefined;`;
    },

    makeGetBool: function(struct, offset) {
      return `!!(HEAPU32[((${struct})+(${offset}))>>2])`;
    },
    makeGetU32: function(struct, offset) {
      return `HEAPU32[((${struct})+(${offset}))>>2]`;
    },
    makeGetU64: function(struct, offset) {
      var l = `HEAPU32[((${struct})+(${offset}))>>2]`;
      var h = `HEAPU32[(((${struct}+4)+(${offset}))>>2)]`
      return `${h} * 0x100000000 + ${l}`
    },
    makeCheck: function(str) {
      if (!ASSERTIONS) return '';
      return `assert(${str});`;
    },
    makeCheckDefined: function(name) {
      return this.makeCheck(`typeof ${name} != "undefined"`);
    },
    makeCheckDescriptor: function(descriptor) {
      // Assert descriptor is non-null, then that its nextInChain is null.
      // For descriptors that aren't the first in the chain (e.g
      // ShaderModuleSPIRVDescriptor), there is no .nextInChain pointer, but
      // instead a ChainedStruct object: .chain. So we need to check if
      // .chain.nextInChain is null. As long as nextInChain and chain are always
      // the first member in the struct, descriptor.nextInChain and
      // descriptor.chain.nextInChain should have the same offset (0) to the
      // descriptor pointer and we can check it to be null.
      var OffsetOfNextInChainMember = 0;
      return this.makeCheck(descriptor) + this.makeCheck(makeGetValue(descriptor, OffsetOfNextInChainMember, '*') + ' === 0');
    },

    // Compile-time table for enum integer values used with templating.
    // Must be in sync with webgpu.h.
    // TODO: Generate this to keep it in sync with webgpu.h
    COPY_STRIDE_UNDEFINED: 0xFFFFFFFF,
    LIMIT_U32_UNDEFINED: 0xFFFFFFFF,
    MIP_LEVEL_COUNT_UNDEFINED: 0xFFFFFFFF,
    ARRAY_LAYER_COUNT_UNDEFINED: 0xFFFFFFFF,
    AdapterType: {
      CPU: 3,
      Unknown: 4,
    },
    BackendType: {
      WebGPU: 2,
    },
    BufferMapAsyncStatus: {
      Success: 0,
      ValidationError: 1,
      Unknown: 2,
      DeviceLost: 3,
      DestroyedBeforeCallback: 4,
      UnmappedBeforeCallback: 5,
      MappingAlreadyPending: 6,
      OffsetOutOfRange: 7,
      SizeOutOfRange: 8,
    },
    CompilationInfoRequestStatus: {
      Success: 0,
      Error: 1,
      DeviceLost: 2,
      Unknown: 3,
    },
    CompositeAlphaMode: {
      Auto: 0,
      Opaque: 1,
      Premultiplied: 2,
    },
    CreatePipelineAsyncStatus: {
      Success: 0,
      ValidationError: 1,
      InternalError: 2,
      DeviceLost: 3,
      DeviceDestroyed: 4,
      Unknown: 5,
    },
    ErrorType: {
      NoError: 0,
      Validation: 1,
      OutOfMemory: 2,
      Internal: 3,
      Unknown: 4,
      DeviceLost: 5,
    },
    PresentMode: {
      Fifo: 1,
      Immediate: 3,
      Mailbox: 4,
    },
    LoadOp: {
      Undefined: 0,
      Clear: 1,
      Load: 2,
    },
    StoreOp: {
      Undefined: 0,
      Store: 1,
      Discard: 2,
    },
    MapMode: {
      None: 0,
      Read: 1,
      Write: 2
    },
    RequestAdapterStatus: {
      Success: 0,
      Unavailable: 1,
      Error: 2,
      Unknown: 3,
    },
    RequestDeviceStatus: {
      Success: 0,
      Error: 1,
      Unknown: 1,
    },
    SType: {
      SurfaceDescriptorFromCanvasHTMLSelector: 0x4,
      ShaderModuleSPIRVDescriptor: 0x5,
      ShaderModuleWGSLDescriptor: 0x6,
      PrimitiveDepthClipControl: 0x7,
      RenderPassDescriptorMaxDrawCount: 0xF,
      TextureBindingViewDimensionDescriptor: 0x11,
    },
    SurfaceGetCurrentTextureStatus: {
      Success: 0,
      DeviceLost: 5,
    },
    QueueWorkDoneStatus: {
      Success: 0,
      Error: 1,
      Unknown: 2,
      DeviceLost: 3,
    },
    TextureFormat: {
      Undefined: 0,
    },
    VertexStepMode: {
      Undefined: 0,
      VertexBufferNotUsed: 1,
      Vertex: 2,
      Instance: 3,
    },
  };
''
}}}

var LibraryWebGPU = {
  $WebGPU__postset: 'WebGPU.initManagers();',
  $WebGPU__deps: ['$wxwgpuStringToUTF8OnStack'],
  $WebGPU: {
    errorCallback: (callback, type, message, userdata) => {
      var sp = stackSave();
      var messagePtr = wxwgpuStringToUTF8OnStack(message);
      {{{ makeDynCall('vipp', 'callback') }}}(type, messagePtr, userdata);
      stackRestore(sp);
    },

    initManagers: () => {
#if ASSERTIONS
      assert(!WebGPU.mgrDevice, 'initManagers already called');
#endif

      /** @constructor */
      function Manager() {
        this.objects = {};
        Manager.nextId = Manager.nextId || 1;
        this.create = function(object, wrapper = {}) {
          var id = Manager.nextId++;
          {{{ gpu.makeCheck("typeof this.objects[id] == 'undefined'") }}}
          wrapper.refcount = 1;
          wrapper.object = object;
          this.objects[id] = wrapper;
          return id;
        };
        this.get = function(id) {
          if (!id) return undefined;
          var o = this.objects[id];
          {{{ gpu.makeCheckDefined('o') }}}
          return o.object;
        };
        this.reference = function(id) {
          var o = this.objects[id];
          {{{ gpu.makeCheckDefined('o') }}}
          o.refcount++;
        };
        this.release = function(id) {
          var o = this.objects[id];
          {{{ gpu.makeCheckDefined('o') }}}
          {{{ gpu.makeCheck('o.refcount > 0') }}}
          o.refcount--;
          if (o.refcount <= 0) {
            delete this.objects[id];
          }
        };
      }

      {{{ gpu.makeInitManager('Surface') }}}
      {{{ gpu.makeInitManager('SwapChain') }}}

      {{{ gpu.makeInitManager('Adapter') }}}
      // TODO: Release() the device's default queue when the device is freed.
      {{{ gpu.makeInitManager('Device') }}}
      {{{ gpu.makeInitManager('Queue') }}}

      {{{ gpu.makeInitManager('CommandBuffer') }}}
      {{{ gpu.makeInitManager('CommandEncoder') }}}
      {{{ gpu.makeInitManager('RenderPassEncoder') }}}
      {{{ gpu.makeInitManager('ComputePassEncoder') }}}

      {{{ gpu.makeInitManager('BindGroup') }}}
      {{{ gpu.makeInitManager('Buffer') }}}
      {{{ gpu.makeInitManager('Sampler') }}}
      {{{ gpu.makeInitManager('Texture') }}}
      {{{ gpu.makeInitManager('TextureView') }}}
      {{{ gpu.makeInitManager('QuerySet') }}}

      {{{ gpu.makeInitManager('BindGroupLayout') }}}
      {{{ gpu.makeInitManager('PipelineLayout') }}}
      {{{ gpu.makeInitManager('RenderPipeline') }}}
      {{{ gpu.makeInitManager('ComputePipeline') }}}
      {{{ gpu.makeInitManager('ShaderModule') }}}

      {{{ gpu.makeInitManager('RenderBundleEncoder') }}}
      {{{ gpu.makeInitManager('RenderBundle') }}}
    },

    makeColor: (ptr) => {
      return {
        "r": {{{ makeGetValue('ptr', 0, 'double') }}},
        "g": {{{ makeGetValue('ptr', 8, 'double') }}},
        "b": {{{ makeGetValue('ptr', 16, 'double') }}},
        "a": {{{ makeGetValue('ptr', 24, 'double') }}},
      };
    },

    makeExtent3D: (ptr) => {
      return {
        "width": {{{ gpu.makeGetU32('ptr', 0) }}},
        "height": {{{ gpu.makeGetU32('ptr', 4) }}},
        "depthOrArrayLayers": {{{ gpu.makeGetU32('ptr', 8) }}},
      };
    },

    makeOrigin3D: (ptr) => {
      return {
        "x": {{{ gpu.makeGetU32('ptr', 0) }}},
        "y": {{{ gpu.makeGetU32('ptr', 4) }}},
        "z": {{{ gpu.makeGetU32('ptr', 8) }}},
      };
    },

    makeImageCopyTexture: (ptr) => {
      {{{ gpu.makeCheckDescriptor('ptr') }}}
      return {
        "texture": WebGPU.mgrTexture.get(
          {{{ makeGetValue('ptr', 4, '*') }}}),
        "mipLevel": {{{ gpu.makeGetU32('ptr', 8) }}},
        "origin": WebGPU.makeOrigin3D(ptr + {{{ 12 }}}),
        "aspect": WebGPU.TextureAspect[{{{ gpu.makeGetU32('ptr', 24) }}}],
      };
    },

    makeTextureDataLayout: (ptr) => {
      {{{ gpu.makeCheckDescriptor('ptr') }}}
      var bytesPerRow = {{{ gpu.makeGetU32('ptr', 16) }}};
      var rowsPerImage = {{{ gpu.makeGetU32('ptr', 20) }}};
      return {
        "offset": {{{ gpu.makeGetU64('ptr', 8) }}},
        "bytesPerRow": bytesPerRow === {{{ gpu.COPY_STRIDE_UNDEFINED }}} ? undefined : bytesPerRow,
        "rowsPerImage": rowsPerImage === {{{ gpu.COPY_STRIDE_UNDEFINED }}} ? undefined : rowsPerImage,
      };
    },

    makeImageCopyBuffer: (ptr) => {
      {{{ gpu.makeCheckDescriptor('ptr') }}}
      var layoutPtr = ptr + {{{ 8 }}};
      var bufferCopyView = WebGPU.makeTextureDataLayout(layoutPtr);
      bufferCopyView["buffer"] = WebGPU.mgrBuffer.get(
        {{{ makeGetValue('ptr', 32, '*') }}});
      return bufferCopyView;
    },

    makePipelineConstants: (constantCount, constantsPtr) => {
      if (!constantCount) return;
      var constants = {};
      for (var i = 0; i < constantCount; ++i) {
        var entryPtr = constantsPtr + {{{ 16 }}} * i;
        var key = UTF8ToString({{{ makeGetValue('entryPtr', 4, '*') }}});
        constants[key] = {{{ makeGetValue('entryPtr', 8, 'double') }}};
      }
      return constants;
    },

    makePipelineLayout: (layoutPtr) => {
      if (!layoutPtr) return 'auto';
      return WebGPU.mgrPipelineLayout.get(layoutPtr);
    },

    makeProgrammableStageDescriptor: (ptr) => {
      if (!ptr) return undefined;
      {{{ gpu.makeCheckDescriptor('ptr') }}}
      var desc = {
        "module": WebGPU.mgrShaderModule.get(
          {{{ makeGetValue('ptr', 4, '*') }}}),
        "constants": WebGPU.makePipelineConstants(
          {{{ gpu.makeGetU32('ptr', 12) }}},
          {{{ makeGetValue('ptr', 16, '*') }}}),
      };
      var entryPointPtr = {{{ makeGetValue('ptr', 8, '*') }}};
      if (entryPointPtr) desc["entryPoint"] = UTF8ToString(entryPointPtr);
      return desc;
    },

    fillLimitStruct: (limits, supportedLimitsOutPtr) => {
      var limitsOutPtr = supportedLimitsOutPtr + {{{ 8 }}};

      function setLimitValueU32(name, limitOffset) {
        var limitValue = limits[name];
        {{{ makeSetValue('limitsOutPtr', 'limitOffset', 'limitValue', 'i32') }}};
      }
      function setLimitValueU64(name, limitOffset) {
        var limitValue = limits[name];
        {{{ makeSetValue('limitsOutPtr', 'limitOffset', 'limitValue', 'i64') }}};
      }
  
      setLimitValueU32('maxTextureDimension1D', {{{ 0 }}});
      setLimitValueU32('maxTextureDimension2D', {{{ 4 }}});
      setLimitValueU32('maxTextureDimension3D', {{{ 8 }}});
      setLimitValueU32('maxTextureArrayLayers', {{{ 12 }}});
      setLimitValueU32('maxBindGroups', {{{ 16 }}});
      setLimitValueU32('maxBindGroupsPlusVertexBuffers', {{{ 20 }}});
      setLimitValueU32('maxBindingsPerBindGroup', {{{ 24 }}});
      setLimitValueU32('maxDynamicUniformBuffersPerPipelineLayout', {{{ 28 }}});
      setLimitValueU32('maxDynamicStorageBuffersPerPipelineLayout', {{{ 32 }}});
      setLimitValueU32('maxSampledTexturesPerShaderStage', {{{ 36 }}});
      setLimitValueU32('maxSamplersPerShaderStage', {{{ 40 }}});
      setLimitValueU32('maxStorageBuffersPerShaderStage', {{{ 44 }}});
      setLimitValueU32('maxStorageTexturesPerShaderStage', {{{ 48 }}});
      setLimitValueU32('maxUniformBuffersPerShaderStage', {{{ 52 }}});
      setLimitValueU32('minUniformBufferOffsetAlignment', {{{ 72 }}});
      setLimitValueU32('minStorageBufferOffsetAlignment', {{{ 76 }}});
  
      setLimitValueU64('maxUniformBufferBindingSize', {{{ 56 }}});
      setLimitValueU64('maxStorageBufferBindingSize', {{{ 64 }}});
  
      setLimitValueU32('maxVertexBuffers', {{{ 80 }}});
      setLimitValueU64('maxBufferSize', {{{ 88 }}});
      setLimitValueU32('maxVertexAttributes', {{{ 96 }}});
      setLimitValueU32('maxVertexBufferArrayStride', {{{ 100 }}});
      setLimitValueU32('maxInterStageShaderComponents', {{{ 104 }}});
      setLimitValueU32('maxInterStageShaderVariables', {{{ 108 }}});
      setLimitValueU32('maxColorAttachments', {{{ 112 }}});
      setLimitValueU32('maxColorAttachmentBytesPerSample', {{{ 116 }}});
      setLimitValueU32('maxComputeWorkgroupStorageSize', {{{ 120 }}});
      setLimitValueU32('maxComputeInvocationsPerWorkgroup', {{{ 124 }}});
      setLimitValueU32('maxComputeWorkgroupSizeX', {{{ 128 }}});
      setLimitValueU32('maxComputeWorkgroupSizeY', {{{ 132 }}});
      setLimitValueU32('maxComputeWorkgroupSizeZ', {{{ 136 }}});
      setLimitValueU32('maxComputeWorkgroupsPerDimension', {{{ 140 }}});
    },

    // Map from enum string back to enum number, for callbacks.
    Int_BufferMapState: {
      'unmapped': 1,
      'pending': 2,
      'mapped': 3,
    },
    Int_CompilationMessageType : {
      'error': 1,
      'warning': 2,
      'info': 3,
    },
    Int_DeviceLostReason: {
      'undefined': 1,
      'unknown': 1,
      'destroyed': 2,
    },
    Int_PreferredFormat: {
      'rgba8unorm': 0x12,
      'bgra8unorm': 0x17,
    },

    // Map from enum number to enum string.
    // This section is auto-generated. See system/include/webgpu/README.md for details.
    WGSLFeatureName: [
      undefined,
      'readonly_and_readwrite_storage_textures',
      'packed_4x8_integer_dot_product',
      'unrestricted_pointer_parameters',
      'pointer_composite_access',
    ],
    AddressMode: [
      undefined,
      'clamp-to-edge',
      'repeat',
      'mirror-repeat',
    ],
    AlphaMode: [
      undefined, // "Auto" uses the default (which is always opaque according to the spec's IDL)
      'opaque',
      'premultiplied',
    ],
    BlendFactor: [
      undefined,
      'zero',
      'one',
      'src',
      'one-minus-src',
      'src-alpha',
      'one-minus-src-alpha',
      'dst',
      'one-minus-dst',
      'dst-alpha',
      'one-minus-dst-alpha',
      'src-alpha-saturated',
      'constant',
      'one-minus-constant',
    ],
    BlendOperation: [
      undefined,
      'add',
      'subtract',
      'reverse-subtract',
      'min',
      'max',
    ],
    BufferBindingType: [
      undefined,
      'uniform',
      'storage',
      'read-only-storage',
    ],
    BufferMapState: {
      1: 'unmapped',
      2: 'pending',
      3: 'mapped',
    },
    CompareFunction: [
      undefined,
      'never',
      'less',
      'equal',
      'less-equal',
      'greater',
      'not-equal',
      'greater-equal',
      'always',
    ],
    CompilationInfoRequestStatus: [
      'success',
      'error',
      'device-lost',
      'unknown',
    ],
    CullMode: [
      undefined,
      'none',
      'front',
      'back',
    ],
    ErrorFilter: {
      1: 'validation',
      2: 'out-of-memory',
      3: 'internal',
    },
    FeatureName: [
      undefined,
      'depth-clip-control',
      'depth32float-stencil8',
      'timestamp-query',
      'texture-compression-bc',
      'texture-compression-etc2',
      'texture-compression-astc',
      'indirect-first-instance',
      'shader-f16',
      'rg11b10ufloat-renderable',
      'bgra8unorm-storage',
      'float32-filterable',
    ],
    FilterMode: [
      undefined,
      'nearest',
      'linear',
    ],
    FrontFace: [
      undefined,
      'ccw',
      'cw',
    ],
    IndexFormat: [
      undefined,
      'uint16',
      'uint32',
    ],
    LoadOp: [
      undefined,
      'clear',
      'load',
    ],
    MipmapFilterMode: [
      undefined,
      'nearest',
      'linear',
    ],
    PowerPreference: [
      undefined,
      'low-power',
      'high-performance',
    ],
    PrimitiveTopology: [
      undefined,
      'point-list',
      'line-list',
      'line-strip',
      'triangle-list',
      'triangle-strip',
    ],
    QueryType: {
      1: 'occlusion',
      2: 'timestamp',
    },
    SamplerBindingType: [
      undefined,
      'filtering',
      'non-filtering',
      'comparison',
    ],
    StencilOperation: [
      undefined,
      'keep',
      'zero',
      'replace',
      'invert',
      'increment-clamp',
      'decrement-clamp',
      'increment-wrap',
      'decrement-wrap',
    ],
    StorageTextureAccess: [
      undefined,
      'write-only',
      'read-only',
      'read-write',
    ],
    StoreOp: [
      undefined,
      'store',
      'discard',
    ],
    TextureAspect: [
      undefined,
      'all',
      'stencil-only',
      'depth-only',
    ],
    TextureDimension: [
      undefined,
      '1d',
      '2d',
      '3d',
    ],
    TextureFormat: [
      undefined,
      'r8unorm',
      'r8snorm',
      'r8uint',
      'r8sint',
      'r16uint',
      'r16sint',
      'r16float',
      'rg8unorm',
      'rg8snorm',
      'rg8uint',
      'rg8sint',
      'r32float',
      'r32uint',
      'r32sint',
      'rg16uint',
      'rg16sint',
      'rg16float',
      'rgba8unorm',
      'rgba8unorm-srgb',
      'rgba8snorm',
      'rgba8uint',
      'rgba8sint',
      'bgra8unorm',
      'bgra8unorm-srgb',
      'rgb10a2uint',
      'rgb10a2unorm',
      'rg11b10ufloat',
      'rgb9e5ufloat',
      'rg32float',
      'rg32uint',
      'rg32sint',
      'rgba16uint',
      'rgba16sint',
      'rgba16float',
      'rgba32float',
      'rgba32uint',
      'rgba32sint',
      'stencil8',
      'depth16unorm',
      'depth24plus',
      'depth24plus-stencil8',
      'depth32float',
      'depth32float-stencil8',
      'bc1-rgba-unorm',
      'bc1-rgba-unorm-srgb',
      'bc2-rgba-unorm',
      'bc2-rgba-unorm-srgb',
      'bc3-rgba-unorm',
      'bc3-rgba-unorm-srgb',
      'bc4-r-unorm',
      'bc4-r-snorm',
      'bc5-rg-unorm',
      'bc5-rg-snorm',
      'bc6h-rgb-ufloat',
      'bc6h-rgb-float',
      'bc7-rgba-unorm',
      'bc7-rgba-unorm-srgb',
      'etc2-rgb8unorm',
      'etc2-rgb8unorm-srgb',
      'etc2-rgb8a1unorm',
      'etc2-rgb8a1unorm-srgb',
      'etc2-rgba8unorm',
      'etc2-rgba8unorm-srgb',
      'eac-r11unorm',
      'eac-r11snorm',
      'eac-rg11unorm',
      'eac-rg11snorm',
      'astc-4x4-unorm',
      'astc-4x4-unorm-srgb',
      'astc-5x4-unorm',
      'astc-5x4-unorm-srgb',
      'astc-5x5-unorm',
      'astc-5x5-unorm-srgb',
      'astc-6x5-unorm',
      'astc-6x5-unorm-srgb',
      'astc-6x6-unorm',
      'astc-6x6-unorm-srgb',
      'astc-8x5-unorm',
      'astc-8x5-unorm-srgb',
      'astc-8x6-unorm',
      'astc-8x6-unorm-srgb',
      'astc-8x8-unorm',
      'astc-8x8-unorm-srgb',
      'astc-10x5-unorm',
      'astc-10x5-unorm-srgb',
      'astc-10x6-unorm',
      'astc-10x6-unorm-srgb',
      'astc-10x8-unorm',
      'astc-10x8-unorm-srgb',
      'astc-10x10-unorm',
      'astc-10x10-unorm-srgb',
      'astc-12x10-unorm',
      'astc-12x10-unorm-srgb',
      'astc-12x12-unorm',
      'astc-12x12-unorm-srgb',
    ],
    TextureSampleType: [
      undefined,
      'float',
      'unfilterable-float',
      'depth',
      'sint',
      'uint',
    ],
    TextureViewDimension: [
      undefined,
      '1d',
      '2d',
      '2d-array',
      'cube',
      'cube-array',
      '3d',
    ],
    VertexFormat: [
      undefined,
      'uint8x2',
      'uint8x4',
      'sint8x2',
      'sint8x4',
      'unorm8x2',
      'unorm8x4',
      'snorm8x2',
      'snorm8x4',
      'uint16x2',
      'uint16x4',
      'sint16x2',
      'sint16x4',
      'unorm16x2',
      'unorm16x4',
      'snorm16x2',
      'snorm16x4',
      'float16x2',
      'float16x4',
      'float32',
      'float32x2',
      'float32x3',
      'float32x4',
      'uint32',
      'uint32x2',
      'uint32x3',
      'uint32x4',
      'sint32',
      'sint32x2',
      'sint32x3',
      'sint32x4',
      'unorm10-10-10-2',
    ],
    VertexStepMode: [
      undefined,
      'vertex-buffer-not-used',
      'vertex',
      'instance',
    ],
  },

  // Non-method functions

  wxwgpu_browser_wgpuGetInstanceFeatures: function(featuresPtr) {
    abort('TODO: wgpuGetInstanceFeatures unimplemented');
    return 0;
  },

  wxwgpu_browser_wgpuGetProcAddress: function(device, procName) {
    abort('TODO(#11526): wgpuGetProcAddress unimplemented');
    return 0;
  },

  // *Reference/*Release

  {{{ gpu.makeReferenceRelease('Surface') }}}
  {{{ gpu.makeReferenceRelease('SwapChain') }}}

  {{{ gpu.makeReferenceRelease('Adapter') }}}
  {{{ gpu.makeReferenceRelease('Device') }}}
  {{{ gpu.makeReferenceRelease('Queue') }}}

  {{{ gpu.makeReferenceRelease('CommandBuffer') }}}
  {{{ gpu.makeReferenceRelease('CommandEncoder') }}}
  {{{ gpu.makeReferenceRelease('RenderPassEncoder') }}}
  {{{ gpu.makeReferenceRelease('ComputePassEncoder') }}}

  {{{ gpu.makeReferenceRelease('BindGroup') }}}
  {{{ gpu.makeReferenceRelease('Buffer') }}}
  {{{ gpu.makeReferenceRelease('Sampler') }}}
  {{{ gpu.makeReferenceRelease('Texture') }}}
  {{{ gpu.makeReferenceRelease('TextureView') }}}
  {{{ gpu.makeReferenceRelease('QuerySet') }}}

  {{{ gpu.makeReferenceRelease('BindGroupLayout') }}}
  {{{ gpu.makeReferenceRelease('PipelineLayout') }}}
  {{{ gpu.makeReferenceRelease('RenderPipeline') }}}
  {{{ gpu.makeReferenceRelease('ComputePipeline') }}}
  {{{ gpu.makeReferenceRelease('ShaderModule') }}}

  {{{ gpu.makeReferenceRelease('RenderBundleEncoder') }}}
  {{{ gpu.makeReferenceRelease('RenderBundle') }}}

  // *Destroy

  wxwgpu_browser_wgpuBufferDestroy: function(bufferId) {
    var bufferWrapper = WebGPU.mgrBuffer.objects[bufferId];
    {{{ gpu.makeCheckDefined('bufferWrapper') }}}
    if (bufferWrapper.onUnmap) {
      for (var f of bufferWrapper.onUnmap) {
        f();
      }
      bufferWrapper.onUnmap = undefined;
    }

    WebGPU.mgrBuffer.get(bufferId).destroy();
  },
  wxwgpu_browser_wgpuTextureDestroy: function(textureId) { return WebGPU.mgrTexture.get(textureId).destroy(); },
  wxwgpu_browser_wgpuQuerySetDestroy: function(querySetId) { return WebGPU.mgrQuerySet.get(querySetId).destroy(); },

  // wgpuDevice

  wxwgpu_browser_wgpuDeviceEnumerateFeatures: function(deviceId, featuresOutPtr) {
    var offset = 0;
    var numFeatures = 0;
    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    device.features.forEach(feature => {
      var featureEnumValue = WebGPU.FeatureNameString2Enum[feature];
      if (featureEnumValue !== undefined) {
        if (featuresOutPtr !== 0) {
          {{{ makeSetValue('featuresOutPtr', 'offset', 'featureEnumValue', 'i32') }}};
          offset += 4;
        }
        numFeatures++;
      }
    });
    return numFeatures;
  },

  wxwgpu_browser_wgpuDeviceDestroy: function(deviceId) { return WebGPU.mgrDevice.get(deviceId).destroy(); },

  wxwgpu_browser_wgpuDeviceGetLimits: function(deviceId, limitsOutPtr) {
    var device = WebGPU.mgrDevice.objects[deviceId].object;
    WebGPU.fillLimitStruct(device.limits, limitsOutPtr);
    return 1;
  },

  wxwgpu_browser_wgpuDeviceGetQueue: function(deviceId) {
    var queueId = WebGPU.mgrDevice.objects[deviceId].queueId;
#if ASSERTIONS
    assert(queueId, 'wgpuDeviceGetQueue: queue was missing or null');
#endif
    // Returns a new reference to the existing queue.
    WebGPU.mgrQueue.reference(queueId);
    return queueId;
  },

  wxwgpu_browser_wgpuDeviceHasFeature: function(deviceId, featureEnumValue) {
    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    return device.features.has(WebGPU.FeatureName[featureEnumValue]);
  },

  wxwgpu_browser_wgpuDevicePushErrorScope: function(deviceId, filter) {
    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    device.pushErrorScope(WebGPU.ErrorFilter[filter]);
  },

  wxwgpu_browser_wgpuDevicePopErrorScope__deps: ['$wxwgpuCallUserCallback'],
  wxwgpu_browser_wgpuDevicePopErrorScope: function(deviceId, callback, userdata) {
    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    {{{ runtimeKeepalivePush() }}}
    device.popErrorScope().then((gpuError) => {
      {{{ runtimeKeepalivePop() }}}
      wxwgpuCallUserCallback(() => {
        if (!gpuError) {
          {{{ makeDynCall('vipp', 'callback') }}}(
            {{{ gpu.ErrorType.NoError }}}, 0, userdata);
        } else if (gpuError instanceof GPUOutOfMemoryError) {
          {{{ makeDynCall('vipp', 'callback') }}}(
            {{{ gpu.ErrorType.OutOfMemory }}}, 0, userdata);
        } else {
#if ASSERTIONS
          // TODO: Implement GPUInternalError
          assert(gpuError instanceof GPUValidationError);
#endif
          WebGPU.errorCallback(callback, {{{ gpu.ErrorType.Validation }}}, gpuError.message, userdata);
        }
      });
    }, (ex) => {
      {{{ runtimeKeepalivePop() }}}
      wxwgpuCallUserCallback(() => {
        // TODO: This can mean either the device was lost or the error scope stack was empty. Figure
        // out how to synthesize the DeviceLost error type. (Could be by simply tracking the error
        // scope depth, but that isn't ideal.)
        WebGPU.errorCallback(callback, {{{ gpu.ErrorType.Unknown }}}, ex.message, userdata);
      });
    });
  },

  wxwgpu_browser_wgpuDeviceSetLabel: function(deviceId, labelPtr) {
    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    device.label = UTF8ToString(labelPtr);
  },

  wxwgpu_browser_wgpuDeviceSetUncapturedErrorCallback__deps: ['$wxwgpuCallUserCallback'],
  wxwgpu_browser_wgpuDeviceSetUncapturedErrorCallback: function(deviceId, callback, userdata) {
    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    device.onuncapturederror = function(ev) {
      // This will skip the callback if the runtime is no longer alive.
      wxwgpuCallUserCallback(() => {
        // WGPUErrorType type, const char* message, void* userdata
        var Validation = 0x00000001;
        var OutOfMemory = 0x00000002;
        var type;
#if ASSERTIONS
        assert(typeof GPUValidationError != 'undefined');
        assert(typeof GPUOutOfMemoryError != 'undefined');
#endif
        if (ev.error instanceof GPUValidationError) type = Validation;
        else if (ev.error instanceof GPUOutOfMemoryError) type = OutOfMemory;
        // TODO: Implement GPUInternalError

        WebGPU.errorCallback(callback, type, ev.error.message, userdata);
      });
    };
  },

  // wgpuDeviceCreate*

  wxwgpu_browser_wgpuDeviceCreateCommandEncoder: function(deviceId, descriptor) {
    var desc;
    if (descriptor) {
      {{{ gpu.makeCheckDescriptor('descriptor') }}}
      desc = {
        "label": undefined,
      };
      var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
      if (labelPtr) desc["label"] = UTF8ToString(labelPtr);
    }
    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    return WebGPU.mgrCommandEncoder.create(device.createCommandEncoder(desc));
  },

  wxwgpu_browser_wgpuDeviceCreateBuffer: function(deviceId, descriptor) {
    {{{ gpu.makeCheckDescriptor('descriptor') }}}

    var mappedAtCreation = {{{ gpu.makeGetBool('descriptor', 24) }}};

    var desc = {
      "label": undefined,
      "usage": {{{ gpu.makeGetU32('descriptor', 8) }}},
      "size": {{{ gpu.makeGetU64('descriptor', 16) }}},
      "mappedAtCreation": mappedAtCreation,
    };
    var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
    if (labelPtr) desc["label"] = UTF8ToString(labelPtr);

    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    var bufferWrapper = {};
    var id = WebGPU.mgrBuffer.create(device.createBuffer(desc), bufferWrapper);
    if (mappedAtCreation) {
      bufferWrapper.mapMode = {{{ gpu.MapMode.Write }}};
      bufferWrapper.onUnmap = [];
    }
    return id;
  },

  wxwgpu_browser_wgpuDeviceCreateTexture: function(deviceId, descriptor) {
    {{{ gpu.makeCheckDescriptor('descriptor') }}}

    var desc = {
      "label": undefined,
      "size": WebGPU.makeExtent3D(descriptor + {{{ 16 }}}),
      "mipLevelCount": {{{ gpu.makeGetU32('descriptor', 32) }}},
      "sampleCount": {{{ gpu.makeGetU32('descriptor', 36) }}},
      "dimension": WebGPU.TextureDimension[
        {{{ gpu.makeGetU32('descriptor', 12) }}}],
      "format": WebGPU.TextureFormat[
        {{{ gpu.makeGetU32('descriptor', 28) }}}],
      "usage": {{{ gpu.makeGetU32('descriptor', 8) }}},
    };
    var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
    if (labelPtr) desc["label"] = UTF8ToString(labelPtr);

    var viewFormatCount = {{{ gpu.makeGetU32('descriptor', 40) }}};
    if (viewFormatCount) {
      var viewFormatsPtr = {{{ makeGetValue('descriptor', 44, '*') }}};
      // viewFormatsPtr pointer to an array of TextureFormat which is an enum of size uint32_t
      desc['viewFormats'] = Array.from({{{ makeHEAPView('32', 'viewFormatsPtr', 'viewFormatsPtr + viewFormatCount * 4') }}},
        format => WebGPU.TextureFormat[format]);
    }

    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    return WebGPU.mgrTexture.create(device.createTexture(desc));
  },

  wxwgpu_browser_wgpuDeviceCreateSampler: function(deviceId, descriptor) {
    var desc;
    if (descriptor) {
      {{{ gpu.makeCheckDescriptor('descriptor') }}}

      desc = {
        "label": undefined,
        "addressModeU": WebGPU.AddressMode[
            {{{ gpu.makeGetU32('descriptor', 8) }}}],
        "addressModeV": WebGPU.AddressMode[
            {{{ gpu.makeGetU32('descriptor', 12) }}}],
        "addressModeW": WebGPU.AddressMode[
            {{{ gpu.makeGetU32('descriptor', 16) }}}],
        "magFilter": WebGPU.FilterMode[
            {{{ gpu.makeGetU32('descriptor', 20) }}}],
        "minFilter": WebGPU.FilterMode[
            {{{ gpu.makeGetU32('descriptor', 24) }}}],
        "mipmapFilter": WebGPU.MipmapFilterMode[
            {{{ gpu.makeGetU32('descriptor', 28) }}}],
        "lodMinClamp": {{{ makeGetValue('descriptor', 32, 'float') }}},
        "lodMaxClamp": {{{ makeGetValue('descriptor', 36, 'float') }}},
        "compare": WebGPU.CompareFunction[
            {{{ gpu.makeGetU32('descriptor', 40) }}}],
      };
      var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
      if (labelPtr) desc["label"] = UTF8ToString(labelPtr);
    }

    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    return WebGPU.mgrSampler.create(device.createSampler(desc));
  },

  wxwgpu_browser_wgpuDeviceCreateBindGroupLayout: function(deviceId, descriptor) {
    {{{ gpu.makeCheckDescriptor('descriptor') }}}

    function makeBufferEntry(entryPtr) {
      {{{ gpu.makeCheck('entryPtr') }}}

      var typeInt =
        {{{ gpu.makeGetU32('entryPtr', 4) }}};
      if (!typeInt) return undefined;

      return {
        "type": WebGPU.BufferBindingType[typeInt],
        "hasDynamicOffset":
          {{{ gpu.makeGetBool('entryPtr', 8) }}},
        "minBindingSize":
          {{{ gpu.makeGetU64('entryPtr', 16) }}},
      };
    }

    function makeSamplerEntry(entryPtr) {
      {{{ gpu.makeCheck('entryPtr') }}}

      var typeInt =
        {{{ gpu.makeGetU32('entryPtr', 4) }}};
      if (!typeInt) return undefined;

      return {
        "type": WebGPU.SamplerBindingType[typeInt],
      };
    }

    function makeTextureEntry(entryPtr) {
      {{{ gpu.makeCheck('entryPtr') }}}

      var sampleTypeInt =
        {{{ gpu.makeGetU32('entryPtr', 4) }}};
      if (!sampleTypeInt) return undefined;

      return {
        "sampleType": WebGPU.TextureSampleType[sampleTypeInt],
        "viewDimension": WebGPU.TextureViewDimension[
          {{{ gpu.makeGetU32('entryPtr', 8) }}}],
        "multisampled":
          {{{ gpu.makeGetBool('entryPtr', 12) }}},
      };
    }

    function makeStorageTextureEntry(entryPtr) {
      {{{ gpu.makeCheck('entryPtr') }}}

      var accessInt =
        {{{ gpu.makeGetU32('entryPtr', 4) }}}
      if (!accessInt) return undefined;

      return {
        "access": WebGPU.StorageTextureAccess[accessInt],
        "format": WebGPU.TextureFormat[
          {{{ gpu.makeGetU32('entryPtr', 8) }}}],
        "viewDimension": WebGPU.TextureViewDimension[
          {{{ gpu.makeGetU32('entryPtr', 12) }}}],
      };
    }

    function makeEntry(entryPtr) {
      {{{ gpu.makeCheck('entryPtr') }}}

      return {
        "binding":
          {{{ gpu.makeGetU32('entryPtr', 4) }}},
        "visibility":
          {{{ gpu.makeGetU32('entryPtr', 8) }}},
        "buffer": makeBufferEntry(entryPtr + {{{ 16 }}}),
        "sampler": makeSamplerEntry(entryPtr + {{{ 40 }}}),
        "texture": makeTextureEntry(entryPtr + {{{ 48 }}}),
        "storageTexture": makeStorageTextureEntry(entryPtr + {{{ 64 }}}),
      };
    }

    function makeEntries(count, entriesPtrs) {
      var entries = [];
      for (var i = 0; i < count; ++i) {
        entries.push(makeEntry(entriesPtrs +
            {{{ 80 }}} * i));
      }
      return entries;
    }

    var desc = {
      "entries": makeEntries(
        {{{ gpu.makeGetU32('descriptor', 8) }}},
        {{{ makeGetValue('descriptor', 12, '*') }}}
      ),
    };
    var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
    if (labelPtr) desc["label"] = UTF8ToString(labelPtr);

    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    return WebGPU.mgrBindGroupLayout.create(device.createBindGroupLayout(desc));
  },

  wxwgpu_browser_wgpuDeviceCreateBindGroup__deps: [],
  wxwgpu_browser_wgpuDeviceCreateBindGroup: function(deviceId, descriptor) {
    {{{ gpu.makeCheckDescriptor('descriptor') }}}

    function makeEntry(entryPtr) {
      {{{ gpu.makeCheck('entryPtr') }}}

      var bufferId = {{{ gpu.makeGetU32('entryPtr', 8) }}};
      var samplerId = {{{ gpu.makeGetU32('entryPtr', 32) }}};
      var textureViewId = {{{ gpu.makeGetU32('entryPtr', 36) }}};
#if ASSERTIONS
      assert((bufferId !== 0) + (samplerId !== 0) + (textureViewId !== 0) === 1);
#endif

      var binding = {{{ gpu.makeGetU32('entryPtr', 4) }}};

      if (bufferId) {
        var size = {{{ makeGetValue('entryPtr', 24, 'i64') }}};
        {{{ gpu.convertSentinelToUndefined('size') }}}

        return {
          "binding": binding,
          "resource": {
            "buffer": WebGPU.mgrBuffer.get(bufferId),
            "offset": {{{ gpu.makeGetU64('entryPtr', 16) }}},
            "size": size
          },
        };
      } else if (samplerId) {
        return {
          "binding": binding,
          "resource": WebGPU.mgrSampler.get(samplerId),
        };
      } else {
        return {
          "binding": binding,
          "resource": WebGPU.mgrTextureView.get(textureViewId),
        };
      }
    }

    function makeEntries(count, entriesPtrs) {
      var entries = [];
      for (var i = 0; i < count; ++i) {
        entries.push(makeEntry(entriesPtrs +
            {{{40}}} * i));
      }
      return entries;
    }

    var desc = {
      "label": undefined,
      "layout": WebGPU.mgrBindGroupLayout.get(
        {{{ makeGetValue('descriptor', 8, '*') }}}),
      "entries": makeEntries(
        {{{ gpu.makeGetU32('descriptor', 12) }}},
        {{{ makeGetValue('descriptor', 16, '*') }}}
      ),
    };
    var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
    if (labelPtr) desc["label"] = UTF8ToString(labelPtr);

    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    return WebGPU.mgrBindGroup.create(device.createBindGroup(desc));
  },

  wxwgpu_browser_wgpuDeviceCreatePipelineLayout: function(deviceId, descriptor) {
    {{{ gpu.makeCheckDescriptor('descriptor') }}}
    var bglCount = {{{ gpu.makeGetU32('descriptor', 8) }}};
    var bglPtr = {{{ makeGetValue('descriptor', 12, '*') }}};
    var bgls = [];
    for (var i = 0; i < bglCount; ++i) {
      bgls.push(WebGPU.mgrBindGroupLayout.get(
        {{{ makeGetValue('bglPtr', `${POINTER_SIZE} * i`, '*') }}}));
    }
    var desc = {
      "label": undefined,
      "bindGroupLayouts": bgls,
    };
    var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
    if (labelPtr) desc["label"] = UTF8ToString(labelPtr);

    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    return WebGPU.mgrPipelineLayout.create(device.createPipelineLayout(desc));
  },

  wxwgpu_browser_wgpuDeviceCreateQuerySet: function(deviceId, descriptor) {
    {{{ gpu.makeCheckDescriptor('descriptor') }}}

    var desc = {
      "type": WebGPU.QueryType[
        {{{ gpu.makeGetU32('descriptor', 8) }}}],
      "count": {{{ gpu.makeGetU32('descriptor', 12) }}},
    };

    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    return WebGPU.mgrQuerySet.create(device.createQuerySet(desc));
  },

  wxwgpu_browser_wgpuDeviceCreateRenderBundleEncoder: function(deviceId, descriptor) {
    {{{ gpu.makeCheck('descriptor') }}}

    function makeRenderBundleEncoderDescriptor(descriptor) {
      {{{ gpu.makeCheck('descriptor') }}}

      function makeColorFormats(count, formatsPtr) {
        var formats = [];
        for (var i = 0; i < count; ++i, formatsPtr += 4) {
          // format could be undefined
          formats.push(WebGPU.TextureFormat[{{{ gpu.makeGetU32('formatsPtr', 0) }}}]);
        }
        return formats;
      }

      var desc = {
        "label": undefined,
        "colorFormats": makeColorFormats(
          {{{ gpu.makeGetU32('descriptor', 8) }}},
          {{{ makeGetValue('descriptor', 12, '*') }}}),
        "depthStencilFormat": WebGPU.TextureFormat[{{{ gpu.makeGetU32('descriptor', 16) }}}],
        "sampleCount": {{{ gpu.makeGetU32('descriptor', 20) }}},
        "depthReadOnly": {{{ gpu.makeGetBool('descriptor', 24) }}},
        "stencilReadOnly": {{{ gpu.makeGetBool('descriptor', 28) }}},
      };
      var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
      if (labelPtr) desc["label"] = UTF8ToString(labelPtr);
      return desc;
    }

    var desc = makeRenderBundleEncoderDescriptor(descriptor);
    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    return WebGPU.mgrRenderBundleEncoder.create(device.createRenderBundleEncoder(desc));
  },

  $generateComputePipelineDesc: function(descriptor) {
    {{{ gpu.makeCheckDescriptor('descriptor') }}}

    var desc = {
      "label": undefined,
      "layout": WebGPU.makePipelineLayout(
        {{{ makeGetValue('descriptor', 8, '*') }}}),
      "compute": WebGPU.makeProgrammableStageDescriptor(
        descriptor + {{{ 12 }}}),
    };
    var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
    if (labelPtr) desc["label"] = UTF8ToString(labelPtr);
    return desc;
  },

  wxwgpu_browser_wgpuDeviceCreateComputePipeline__deps: ['$generateComputePipelineDesc'],
  wxwgpu_browser_wgpuDeviceCreateComputePipeline: function(deviceId, descriptor) {
    var desc = generateComputePipelineDesc(descriptor);
    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    return WebGPU.mgrComputePipeline.create(device.createComputePipeline(desc));
  },

  wxwgpu_browser_wgpuDeviceCreateComputePipelineAsync__deps: ['$wxwgpuCallUserCallback', '$wxwgpuStringToUTF8OnStack', '$generateComputePipelineDesc'],
  wxwgpu_browser_wgpuDeviceCreateComputePipelineAsync: function(deviceId, descriptor, callback, userdata) {
    var desc = generateComputePipelineDesc(descriptor);
    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    {{{ runtimeKeepalivePush() }}}
    device.createComputePipelineAsync(desc).then((pipeline) => {
      {{{ runtimeKeepalivePop() }}}
      wxwgpuCallUserCallback(() => {
        var pipelineId = WebGPU.mgrComputePipeline.create(pipeline);
        {{{ makeDynCall('vippp', 'callback') }}}({{{ gpu.CreatePipelineAsyncStatus.Success }}}, pipelineId, 0, userdata);
      });
    }, (pipelineError) => {
      {{{ runtimeKeepalivePop() }}}
      wxwgpuCallUserCallback(() => {
        var sp = stackSave();
        var messagePtr = wxwgpuStringToUTF8OnStack(pipelineError.message);
        if (pipelineError.reason === 'validation') {
          {{{ makeDynCall('vippp', 'callback') }}}({{{ gpu.CreatePipelineAsyncStatus.ValidationError }}}, 0, messagePtr, userdata);
        } else if (pipelineError.reason === 'internal') {
          {{{ makeDynCall('vippp', 'callback') }}}({{{ gpu.CreatePipelineAsyncStatus.InternalError }}}, 0, messagePtr, userdata);
        } else {
          {{{ makeDynCall('vippp', 'callback') }}}({{{ gpu.CreatePipelineAsyncStatus.Unknown }}}, 0, messagePtr, userdata);
        }
        stackRestore(sp);
      });
    });
  },

  $generateRenderPipelineDesc: function(descriptor) {
    {{{ gpu.makeCheckDescriptor('descriptor') }}}
    function makePrimitiveState(rsPtr) {
      if (!rsPtr) return undefined;
      {{{ gpu.makeCheck('rsPtr') }}}

      // TODO: This small hack assumes that there's only one type that can be in the chain of
      // WGPUPrimitiveState. The correct thing would be to traverse the chain, but unclippedDepth
      // is going to move into the core object soon, so we'll just do this for now. See:
      // https://github.com/webgpu-native/webgpu-headers/issues/212#issuecomment-1682801259
      var nextInChainPtr = {{{ makeGetValue('rsPtr', 0, '*') }}};
      var sType = nextInChainPtr ? {{{ gpu.makeGetU32('nextInChainPtr', 4) }}} : 0;
      
      return {
        "topology": WebGPU.PrimitiveTopology[
          {{{ gpu.makeGetU32('rsPtr', 4) }}}],
        "stripIndexFormat": WebGPU.IndexFormat[
          {{{ gpu.makeGetU32('rsPtr', 8) }}}],
        "frontFace": WebGPU.FrontFace[
          {{{ gpu.makeGetU32('rsPtr', 12) }}}],
        "cullMode": WebGPU.CullMode[
          {{{ gpu.makeGetU32('rsPtr', 16) }}}],
        "unclippedDepth": sType === {{{ gpu.SType.PrimitiveDepthClipControl }}} && {{{ gpu.makeGetBool('nextInChainPtr', 8) }}},
      };
    }

    function makeBlendComponent(bdPtr) {
      if (!bdPtr) return undefined;
      return {
        "operation": WebGPU.BlendOperation[
          {{{ gpu.makeGetU32('bdPtr', 0) }}}],
        "srcFactor": WebGPU.BlendFactor[
          {{{ gpu.makeGetU32('bdPtr', 4) }}}],
        "dstFactor": WebGPU.BlendFactor[
          {{{ gpu.makeGetU32('bdPtr', 8) }}}],
      };
    }

    function makeBlendState(bsPtr) {
      if (!bsPtr) return undefined;
      return {
        "alpha": makeBlendComponent(bsPtr + {{{ 12 }}}),
        "color": makeBlendComponent(bsPtr + {{{ 0 }}}),
      };
    }

    function makeColorState(csPtr) {
      {{{ gpu.makeCheckDescriptor('csPtr') }}}
      var formatInt = {{{ gpu.makeGetU32('csPtr', 4) }}};
      return formatInt === {{{ gpu.TextureFormat.Undefined }}} ? undefined : {
        "format": WebGPU.TextureFormat[formatInt],
        "blend": makeBlendState({{{ makeGetValue('csPtr', 8, '*') }}}),
        "writeMask": {{{ gpu.makeGetU32('csPtr', 12) }}},
      };
    }

    function makeColorStates(count, csArrayPtr) {
      var states = [];
      for (var i = 0; i < count; ++i) {
        states.push(makeColorState(csArrayPtr + {{{ 16 }}} * i));
      }
      return states;
    }

    function makeStencilStateFace(ssfPtr) {
      {{{ gpu.makeCheck('ssfPtr') }}}
      return {
        "compare": WebGPU.CompareFunction[
          {{{ gpu.makeGetU32('ssfPtr', 0) }}}],
        "failOp": WebGPU.StencilOperation[
          {{{ gpu.makeGetU32('ssfPtr', 4) }}}],
        "depthFailOp": WebGPU.StencilOperation[
          {{{ gpu.makeGetU32('ssfPtr', 8) }}}],
        "passOp": WebGPU.StencilOperation[
          {{{ gpu.makeGetU32('ssfPtr', 12) }}}],
      };
    }

    function makeDepthStencilState(dssPtr) {
      if (!dssPtr) return undefined;

      {{{ gpu.makeCheck('dssPtr') }}}
      return {
        "format": WebGPU.TextureFormat[
          {{{ gpu.makeGetU32('dssPtr', 4) }}}],
        "depthWriteEnabled": {{{ gpu.makeGetBool('dssPtr', 8) }}},
        "depthCompare": WebGPU.CompareFunction[
          {{{ gpu.makeGetU32('dssPtr', 12) }}}],
        "stencilFront": makeStencilStateFace(dssPtr + {{{ 16 }}}),
        "stencilBack": makeStencilStateFace(dssPtr + {{{ 32 }}}),
        "stencilReadMask": {{{ gpu.makeGetU32('dssPtr', 48) }}},
        "stencilWriteMask": {{{ gpu.makeGetU32('dssPtr', 52) }}},
        "depthBias": {{{ makeGetValue('dssPtr', 56, 'i32') }}},
        "depthBiasSlopeScale": {{{ makeGetValue('dssPtr', 60, 'float') }}},
        "depthBiasClamp": {{{ makeGetValue('dssPtr', 64, 'float') }}},
      };
    }

    function makeVertexAttribute(vaPtr) {
      {{{ gpu.makeCheck('vaPtr') }}}
      return {
        "format": WebGPU.VertexFormat[
          {{{ gpu.makeGetU32('vaPtr', 0) }}}],
        "offset": {{{ gpu.makeGetU64('vaPtr', 8) }}},
        "shaderLocation": {{{ gpu.makeGetU32('vaPtr', 16) }}},
      };
    }

    function makeVertexAttributes(count, vaArrayPtr) {
      var vas = [];
      for (var i = 0; i < count; ++i) {
        vas.push(makeVertexAttribute(vaArrayPtr + i * {{{ 24 }}}));
      }
      return vas;
    }

    function makeVertexBuffer(vbPtr) {
      if (!vbPtr) return undefined;
      var stepModeInt = {{{ gpu.makeGetU32('vbPtr', 8) }}};
      return stepModeInt === {{{ gpu.VertexStepMode.VertexBufferNotUsed }}} ? null : {
        "arrayStride": {{{ gpu.makeGetU64('vbPtr', 0) }}},
        "stepMode": WebGPU.VertexStepMode[stepModeInt],
        "attributes": makeVertexAttributes(
          {{{ gpu.makeGetU32('vbPtr', 12) }}},
          {{{ makeGetValue('vbPtr', 16, '*') }}}),
      };
    }

    function makeVertexBuffers(count, vbArrayPtr) {
      if (!count) return undefined;

      var vbs = [];
      for (var i = 0; i < count; ++i) {
        vbs.push(makeVertexBuffer(vbArrayPtr + i * {{{ 24 }}}));
      }
      return vbs;
    }

    function makeVertexState(viPtr) {
      if (!viPtr) return undefined;
      {{{ gpu.makeCheckDescriptor('viPtr') }}}
      var desc = {
        "module": WebGPU.mgrShaderModule.get(
          {{{ makeGetValue('viPtr', 4, '*') }}}),
        "constants": WebGPU.makePipelineConstants(
          {{{ gpu.makeGetU32('viPtr', 12) }}},
          {{{ makeGetValue('viPtr', 16, '*') }}}),
        "buffers": makeVertexBuffers(
          {{{ gpu.makeGetU32('viPtr', 20) }}},
          {{{ makeGetValue('viPtr', 24, '*') }}}),
        };
      var entryPointPtr = {{{ makeGetValue('viPtr', 8, '*') }}};
      if (entryPointPtr) desc["entryPoint"] = UTF8ToString(entryPointPtr);
      return desc;
    }

    function makeMultisampleState(msPtr) {
      if (!msPtr) return undefined;
      {{{ gpu.makeCheckDescriptor('msPtr') }}}
      return {
        "count": {{{ gpu.makeGetU32('msPtr', 4) }}},
        "mask": {{{ gpu.makeGetU32('msPtr', 8) }}},
        "alphaToCoverageEnabled": {{{ gpu.makeGetBool('msPtr', 12) }}},
      };
    }

    function makeFragmentState(fsPtr) {
      if (!fsPtr) return undefined;
      {{{ gpu.makeCheckDescriptor('fsPtr') }}}
      var desc = {
        "module": WebGPU.mgrShaderModule.get(
          {{{ makeGetValue('fsPtr', 4, '*') }}}),
        "constants": WebGPU.makePipelineConstants(
          {{{ gpu.makeGetU32('fsPtr', 12) }}},
          {{{ makeGetValue('fsPtr', 16, '*') }}}),
        "targets": makeColorStates(
          {{{ gpu.makeGetU32('fsPtr', 20) }}},
          {{{ makeGetValue('fsPtr', 24, '*') }}}),
        };
      var entryPointPtr = {{{ makeGetValue('fsPtr', 8, '*') }}};
      if (entryPointPtr) desc["entryPoint"] = UTF8ToString(entryPointPtr);
      return desc;
    }

    var desc = {
      "label": undefined,
      "layout": WebGPU.makePipelineLayout(
        {{{ makeGetValue('descriptor', 8, '*') }}}),
      "vertex": makeVertexState(
        descriptor + {{{ 12 }}}),
      "primitive": makePrimitiveState(
        descriptor + {{{ 40 }}}),
      "depthStencil": makeDepthStencilState(
        {{{ makeGetValue('descriptor', 60, '*') }}}),
      "multisample": makeMultisampleState(
        descriptor + {{{ 64 }}}),
      "fragment": makeFragmentState(
        {{{ makeGetValue('descriptor', 80, '*') }}}),
    };
    var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
    if (labelPtr) desc["label"] = UTF8ToString(labelPtr);
    return desc;
  },

  wxwgpu_browser_wgpuDeviceCreateRenderPipeline__deps: ['$generateRenderPipelineDesc'],
  wxwgpu_browser_wgpuDeviceCreateRenderPipeline: function(deviceId, descriptor) {
    var desc = generateRenderPipelineDesc(descriptor);
    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    return WebGPU.mgrRenderPipeline.create(device.createRenderPipeline(desc));
  },

  wxwgpu_browser_wgpuDeviceCreateRenderPipelineAsync__deps: ['$wxwgpuCallUserCallback', '$wxwgpuStringToUTF8OnStack', '$generateRenderPipelineDesc'],
  wxwgpu_browser_wgpuDeviceCreateRenderPipelineAsync: function(deviceId, descriptor, callback, userdata) {
    var desc = generateRenderPipelineDesc(descriptor);
    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    {{{ runtimeKeepalivePush() }}}
    device.createRenderPipelineAsync(desc).then((pipeline) => {
      {{{ runtimeKeepalivePop() }}}
      wxwgpuCallUserCallback(() => {
        var pipelineId = WebGPU.mgrRenderPipeline.create(pipeline);
        {{{ makeDynCall('vippp', 'callback') }}}({{{ gpu.CreatePipelineAsyncStatus.Success }}}, pipelineId, 0, userdata);
      });
    }, (pipelineError) => {
      {{{ runtimeKeepalivePop() }}}
      wxwgpuCallUserCallback(() => {
        var sp = stackSave();
        var messagePtr = wxwgpuStringToUTF8OnStack(pipelineError.message);
        if (pipelineError.reason === 'validation') {
          {{{ makeDynCall('vippp', 'callback') }}}({{{ gpu.CreatePipelineAsyncStatus.ValidationError }}}, 0, messagePtr, userdata);
        } else if (pipelineError.reason === 'internal') {
          {{{ makeDynCall('vippp', 'callback') }}}({{{ gpu.CreatePipelineAsyncStatus.InternalError }}}, 0, messagePtr, userdata);
        } else {
          {{{ makeDynCall('vippp', 'callback') }}}({{{ gpu.CreatePipelineAsyncStatus.Unknown }}}, 0, messagePtr, userdata);
        }
        stackRestore(sp);
      });
    });
  },

  wxwgpu_browser_wgpuDeviceCreateShaderModule: function(deviceId, descriptor) {
    {{{ gpu.makeCheck('descriptor') }}}
    var nextInChainPtr = {{{ makeGetValue('descriptor', 0, '*') }}};
#if ASSERTIONS
    assert(nextInChainPtr !== 0);
#endif
    var sType = {{{ gpu.makeGetU32('nextInChainPtr', 4) }}};

    var desc = {
      "label": undefined,
      "code": "",
    };
    var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
    if (labelPtr) desc["label"] = UTF8ToString(labelPtr);

    switch (sType) {
      case {{{ gpu.SType.ShaderModuleSPIRVDescriptor }}}: {
        var count = {{{ gpu.makeGetU32('nextInChainPtr', 8) }}};
        var start = {{{ makeGetValue('nextInChainPtr', 12, '*') }}};
        var offset = {{{ getHeapOffset('start', 'i32') }}};
// 运行期判断：SharedArrayBuffer 时 Chrome 需要拷贝一份（等价于 #if PTHREADS 分支）
        if (typeof SharedArrayBuffer != "undefined" && HEAPU32.buffer instanceof SharedArrayBuffer) {
        // Chrome can't currently handle a SharedArrayBuffer view here, so make a copy.
        desc["code"] = HEAPU32.slice(offset, offset + count);
        } else {
        desc["code"] = HEAPU32.subarray(offset, offset + count);
        }
        break;
      }
      case {{{ gpu.SType.ShaderModuleWGSLDescriptor }}}: {
        var sourcePtr = {{{ makeGetValue('nextInChainPtr', 8, '*') }}};
        if (sourcePtr) {
          desc["code"] = UTF8ToString(sourcePtr);
        }
        break;
      }
#if ASSERTIONS
      default: abort('unrecognized ShaderModule sType');
#endif
    }

    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    return WebGPU.mgrShaderModule.create(device.createShaderModule(desc));
  },

  // wgpuQuerySet

  wxwgpu_browser_wgpuQuerySetGetCount: function(querySetId) {
    var querySet = WebGPU.mgrQuerySet.get(querySetId);
    if (!querySet) return;
    return querySet.count;
  },

  wxwgpu_browser_wgpuQuerySetGetType: function(querySetId, labelPtr) {
    var querySet = WebGPU.mgrQuerySet.get(querySetId);
    if (!querySet) return;
    return querySet.type;
  },

  wxwgpu_browser_wgpuQuerySetSetLabel: function(querySetId, labelPtr) {
    var querySet = WebGPU.mgrQuerySet.get(querySetId);
    if (!querySet) return;
    querySet.label = UTF8ToString(labelPtr);
  },

  // wgpuQueue

  wxwgpu_browser_wgpuQueueSetLabel: function(queueId, labelPtr) {
    var queue = WebGPU.mgrQueue.get(queueId);
    if (!queue) return;
    queue.label = UTF8ToString(labelPtr);
  },

  wxwgpu_browser_wgpuQueueSubmit: function(queueId, commandCount, commands) {
#if ASSERTIONS
    assert(commands % 4 === 0);
#endif
    var queue = WebGPU.mgrQueue.get(queueId);
    if (!queue) return;
    var cmds = Array.from({{{ makeHEAPView(`${POINTER_BITS}`, 'commands', `commands + commandCount * ${POINTER_SIZE}`)}}},
      (id) => WebGPU.mgrCommandBuffer.get(id));
    queue.submit(cmds);
  },

  wxwgpu_browser_wgpuQueueOnSubmittedWorkDone__deps: ['$wxwgpuCallUserCallback'],
  wxwgpu_browser_wgpuQueueOnSubmittedWorkDone: function(queueId, callback, userdata) {
    var queue = WebGPU.mgrQueue.get(queueId);
    if (!queue) return;

    {{{ runtimeKeepalivePush() }}}
    queue.onSubmittedWorkDone().then(() => {
      {{{ runtimeKeepalivePop() }}}
      wxwgpuCallUserCallback(() => {
        {{{ makeDynCall('vip', 'callback') }}}({{{ gpu.QueueWorkDoneStatus.Success }}}, userdata);
      });
    }, () => {
      {{{ runtimeKeepalivePop() }}}
      wxwgpuCallUserCallback(() => {
        {{{ makeDynCall('vip', 'callback') }}}({{{ gpu.QueueWorkDoneStatus.Error }}}, userdata);
      });
    });
  },

  wxwgpu_browser_wgpuQueueWriteBuffer: function(queueId, bufferId, bufferOffset, data, size) {
    var queue = WebGPU.mgrQueue.get(queueId);
    if (!queue) return;
    var buffer = WebGPU.mgrBuffer.get(bufferId);
    if (!buffer) return;
    // There is a size limitation for ArrayBufferView. Work around by passing in a subarray
    // instead of the whole heap. crbug.com/1201109
    var subarray = HEAPU8.subarray(data, data + size);
    queue.writeBuffer(buffer, bufferOffset, subarray, 0, size);
  },

  wxwgpu_browser_wgpuQueueWriteTexture: function(queueId, destinationPtr, data, dataSize, dataLayoutPtr, writeSizePtr) {
    var queue = WebGPU.mgrQueue.get(queueId);
    if (!queue) return;

    var destination = WebGPU.makeImageCopyTexture(destinationPtr);
    var dataLayout = WebGPU.makeTextureDataLayout(dataLayoutPtr);
    var writeSize = WebGPU.makeExtent3D(writeSizePtr);
    // This subarray isn't strictly necessary, but helps work around an issue
    // where Chromium makes a copy of the entire heap. crbug.com/1134457
    var subarray = HEAPU8.subarray(data, data + dataSize);
    queue.writeTexture(destination, subarray, dataLayout, writeSize);
  },

  // wgpuCommandEncoder

  wxwgpu_browser_wgpuCommandEncoderBeginComputePass: function(encoderId, descriptor) {
    var desc;

    function makeComputePassTimestampWrites(twPtr) {
      if (twPtr === 0) return undefined;

      return {
        "querySet": WebGPU.mgrQuerySet.get(
          {{{ makeGetValue('twPtr', 0, '*') }}}),
        "beginningOfPassWriteIndex": {{{ gpu.makeGetU32('twPtr', 4) }}},
        "endOfPassWriteIndex": {{{ gpu.makeGetU32('twPtr', 8) }}},
      };
    }

    if (descriptor) {
      {{{ gpu.makeCheckDescriptor('descriptor') }}}
      desc = {
        "label": undefined,
        "timestampWrites": makeComputePassTimestampWrites(
          {{{ makeGetValue('descriptor', 8, '*') }}}),
      };
      var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
      if (labelPtr) desc["label"] = UTF8ToString(labelPtr);

    }
    var commandEncoder = WebGPU.mgrCommandEncoder.get(encoderId);
    if (!commandEncoder) return;
    return WebGPU.mgrComputePassEncoder.create(commandEncoder.beginComputePass(desc));
  },

  wxwgpu_browser_wgpuCommandEncoderBeginRenderPass: function(encoderId, descriptor) {
    {{{ gpu.makeCheck('descriptor') }}}

    function makeColorAttachment(caPtr) {
      var viewPtr = {{{ gpu.makeGetU32('caPtr', 4) }}};
      if (viewPtr === 0) {
        // view could be undefined.
        return undefined;
      }

      var depthSlice = {{{ makeGetValue('caPtr', 8, 'i32') }}};
      {{{ gpu.convertSentinelToUndefined('depthSlice') }}}

      var loadOpInt = {{{ gpu.makeGetU32('caPtr', 16) }}};
      #if ASSERTIONS
          assert(loadOpInt !== {{{ gpu.LoadOp.Undefined }}});
      #endif

      var storeOpInt = {{{ gpu.makeGetU32('caPtr', 20) }}};
      #if ASSERTIONS
          assert(storeOpInt !== {{{ gpu.StoreOp.Undefined }}});
      #endif

      var clearValue = WebGPU.makeColor(caPtr + {{{ 24 }}});

      return {
        "view": WebGPU.mgrTextureView.get(viewPtr),
        "depthSlice": depthSlice,
        "resolveTarget": WebGPU.mgrTextureView.get(
          {{{ gpu.makeGetU32('caPtr', 12) }}}),
        "clearValue": clearValue,
        "loadOp":  WebGPU.LoadOp[loadOpInt],
        "storeOp": WebGPU.StoreOp[storeOpInt],
      };
    }

    function makeColorAttachments(count, caPtr) {
      var attachments = [];
      for (var i = 0; i < count; ++i) {
        attachments.push(makeColorAttachment(caPtr + {{{ 56 }}} * i));
      }
      return attachments;
    }

    function makeDepthStencilAttachment(dsaPtr) {
      if (dsaPtr === 0) return undefined;

      return {
        "view": WebGPU.mgrTextureView.get(
          {{{ gpu.makeGetU32('dsaPtr', 0) }}}),
        "depthClearValue": {{{ makeGetValue('dsaPtr', 12, 'float') }}},
        "depthLoadOp": WebGPU.LoadOp[
          {{{ gpu.makeGetU32('dsaPtr', 4) }}}],
        "depthStoreOp": WebGPU.StoreOp[
          {{{ gpu.makeGetU32('dsaPtr', 8) }}}],
        "depthReadOnly": {{{ gpu.makeGetBool('dsaPtr', 16) }}},
        "stencilClearValue": {{{ gpu.makeGetU32('dsaPtr', 28) }}},
        "stencilLoadOp": WebGPU.LoadOp[
          {{{ gpu.makeGetU32('dsaPtr', 20) }}}],
        "stencilStoreOp": WebGPU.StoreOp[
          {{{ gpu.makeGetU32('dsaPtr', 24) }}}],
        "stencilReadOnly": {{{ gpu.makeGetBool('dsaPtr', 32) }}},
      };
    }

    function makeRenderPassTimestampWrites(twPtr) {
      if (twPtr === 0) return undefined;

      return {
        "querySet": WebGPU.mgrQuerySet.get(
          {{{ makeGetValue('twPtr', 0, '*') }}}),
        "beginningOfPassWriteIndex": {{{ gpu.makeGetU32('twPtr', 4) }}},
        "endOfPassWriteIndex": {{{ gpu.makeGetU32('twPtr', 8) }}},
      };
    }

    function makeRenderPassDescriptor(descriptor) {
      {{{ gpu.makeCheck('descriptor') }}}
      var nextInChainPtr = {{{ makeGetValue('descriptor', 0, '*') }}};

      var maxDrawCount = undefined;
      if (nextInChainPtr !== 0) {
        var sType = {{{ gpu.makeGetU32('nextInChainPtr', 4) }}};
#if ASSERTIONS
        assert(sType === {{{ gpu.SType.RenderPassDescriptorMaxDrawCount }}});
        assert(0 === {{{ makeGetValue('nextInChainPtr', 0, '*') }}});
#endif
        var renderPassDescriptorMaxDrawCount = nextInChainPtr;
        {{{ gpu.makeCheckDescriptor('renderPassDescriptorMaxDrawCount') }}}
        maxDrawCount = {{{ gpu.makeGetU64('renderPassDescriptorMaxDrawCount', 8) }}};
      }

      var desc = {
        "label": undefined,
        "colorAttachments": makeColorAttachments(
          {{{ gpu.makeGetU32('descriptor', 8) }}},
          {{{ makeGetValue('descriptor', 12, '*') }}}),
        "depthStencilAttachment": makeDepthStencilAttachment(
          {{{ makeGetValue('descriptor', 16, '*') }}}),
        "occlusionQuerySet": WebGPU.mgrQuerySet.get(
          {{{ makeGetValue('descriptor', 20, '*') }}}),
        "timestampWrites": makeRenderPassTimestampWrites(
          {{{ makeGetValue('descriptor', 24, '*') }}}),
          "maxDrawCount": maxDrawCount,
      };
      var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
      if (labelPtr) desc["label"] = UTF8ToString(labelPtr);

      return desc;
    }

    var desc = makeRenderPassDescriptor(descriptor);

    var commandEncoder = WebGPU.mgrCommandEncoder.get(encoderId);
    if (!commandEncoder) return;
    return WebGPU.mgrRenderPassEncoder.create(commandEncoder.beginRenderPass(desc));
  },

  wxwgpu_browser_wgpuCommandEncoderClearBuffer: function(encoderId, bufferId, offset, size) {
    var commandEncoder = WebGPU.mgrCommandEncoder.get(encoderId);
    if (!commandEncoder) return;
    {{{ gpu.convertSentinelToUndefined('size') }}}

    var buffer = WebGPU.mgrBuffer.get(bufferId);
    if (!buffer) return;
    commandEncoder.clearBuffer(buffer, offset, size);
  },

  wxwgpu_browser_wgpuCommandEncoderCopyBufferToBuffer: function(encoderId, srcId, srcOffset, dstId, dstOffset, size) {
    var commandEncoder = WebGPU.mgrCommandEncoder.get(encoderId);
    if (!commandEncoder) return;
    var src = WebGPU.mgrBuffer.get(srcId);
    if (!src) return;
    var dst = WebGPU.mgrBuffer.get(dstId);
    if (!dst) return;
    commandEncoder.copyBufferToBuffer(src, srcOffset, dst, dstOffset, size);
  },

  wxwgpu_browser_wgpuCommandEncoderCopyBufferToTexture: function(encoderId, srcPtr, dstPtr, copySizePtr) {
    var commandEncoder = WebGPU.mgrCommandEncoder.get(encoderId);
    if (!commandEncoder) return;
    var copySize = WebGPU.makeExtent3D(copySizePtr);
    commandEncoder.copyBufferToTexture(
      WebGPU.makeImageCopyBuffer(srcPtr), WebGPU.makeImageCopyTexture(dstPtr), copySize);
  },

  wxwgpu_browser_wgpuCommandEncoderCopyTextureToBuffer: function(encoderId, srcPtr, dstPtr, copySizePtr) {
    var commandEncoder = WebGPU.mgrCommandEncoder.get(encoderId);
    if (!commandEncoder) return;
    var copySize = WebGPU.makeExtent3D(copySizePtr);
    commandEncoder.copyTextureToBuffer(
      WebGPU.makeImageCopyTexture(srcPtr), WebGPU.makeImageCopyBuffer(dstPtr), copySize);
  },

  wxwgpu_browser_wgpuCommandEncoderCopyTextureToTexture: function(encoderId, srcPtr, dstPtr, copySizePtr) {
    var commandEncoder = WebGPU.mgrCommandEncoder.get(encoderId);
    if (!commandEncoder) return;
    var copySize = WebGPU.makeExtent3D(copySizePtr);
    commandEncoder.copyTextureToTexture(
      WebGPU.makeImageCopyTexture(srcPtr), WebGPU.makeImageCopyTexture(dstPtr), copySize);
  },

  wxwgpu_browser_wgpuCommandEncoderResolveQuerySet: function(encoderId, querySetId, firstQuery, queryCount, destinationId, destinationOffset) {
    var commandEncoder = WebGPU.mgrCommandEncoder.get(encoderId);
    if (!commandEncoder) return;
    var querySet = WebGPU.mgrQuerySet.get(querySetId);
    if (!querySet) return;
    var destination = WebGPU.mgrBuffer.get(destinationId);
    if (!destination) return;

    commandEncoder.resolveQuerySet(querySet, firstQuery, queryCount, destination, destinationOffset);
  },

  wxwgpu_browser_wgpuCommandEncoderWriteTimestamp: function(encoderId, querySetId, queryIndex) {
    var commandEncoder = WebGPU.mgrCommandEncoder.get(encoderId);
    if (!commandEncoder) return;
    var querySet = WebGPU.mgrQuerySet.get(querySetId);
    if (!querySet) return;
    commandEncoder.writeTimestamp(querySet, queryIndex);
  },

  wxwgpu_browser_wgpuCommandEncoderPushDebugGroup: function(encoderId, groupLabelPtr) {
    var encoder = WebGPU.mgrCommandEncoder.get(encoderId);
    if (!encoder) return;
    encoder.pushDebugGroup(UTF8ToString(groupLabelPtr));
  },
  wxwgpu_browser_wgpuCommandEncoderPopDebugGroup: function(encoderId) {
    var encoder = WebGPU.mgrCommandEncoder.get(encoderId);
    if (!encoder) return;
    encoder.popDebugGroup();
  },
  wxwgpu_browser_wgpuCommandEncoderInsertDebugMarker: function(encoderId, markerLabelPtr) {
    var encoder = WebGPU.mgrCommandEncoder.get(encoderId);
    if (!encoder) return;
    encoder.insertDebugMarker(UTF8ToString(markerLabelPtr));
  },

  wxwgpu_browser_wgpuCommandEncoderFinish: function(encoderId, descriptor) {
    // TODO: Use the descriptor.
    var commandEncoder = WebGPU.mgrCommandEncoder.get(encoderId);
    if (!commandEncoder) return;
    return WebGPU.mgrCommandBuffer.create(commandEncoder.finish());
  },

  wxwgpu_browser_wgpuCommandEncoderSetLabel: function(encoderId, labelPtr) {
    var commandEncoder = WebGPU.mgrCommandEncoder.get(encoderId);
    if (!commandEncoder) return;
    commandEncoder.label = UTF8ToString(labelPtr);
  },

  // wgpuCommandBuffer

  wxwgpu_browser_wgpuCommandBufferSetLabel: function(commandBufferId, labelPtr) {
    var commandBuffer = WebGPU.mgrCommandBuffer.get(commandBufferId);
    if (!commandBuffer) return;
    commandBuffer.label = UTF8ToString(labelPtr);
  },

  // wgpuPipelineLayout

  wxwgpu_browser_wgpuPipelineLayoutSetLabel: function(pipelineLayoutId, labelPtr) {
    var pipelineLayout = WebGPU.mgrPipelineLayout.get(pipelineLayoutId);
    if (!pipelineLayout) return;
    pipelineLayout.label = UTF8ToString(labelPtr);
  },

  // wgpuShaderModule

  wxwgpu_browser_wgpuShaderModuleGetCompilationInfo__deps: ['$wxwgpuCallUserCallback'],
  wxwgpu_browser_wgpuShaderModuleGetCompilationInfo: function(shaderModuleId, callback, userdata) {
    var shaderModule = WebGPU.mgrShaderModule.get(shaderModuleId);
    if (!shaderModule) return;
    {{{ runtimeKeepalivePush() }}}
    shaderModule.getCompilationInfo().then((compilationInfo) => {
      {{{ runtimeKeepalivePop() }}}
      wxwgpuCallUserCallback(() => {
        var compilationMessagesPtr = _malloc({{{ 72 }}} * compilationInfo.messages.length);
        var messageStringPtrs = []; // save these to free later
        for (var i = 0; i < compilationInfo.messages.length; ++i) {
          var compilationMessage = compilationInfo.messages[i];
          var compilationMessagePtr = compilationMessagesPtr + {{{ 72 }}} * i;
          var messageSize = lengthBytesUTF8(compilationMessage.message) + 1;
          var messagePtr = _malloc(messageSize);
          messageStringPtrs.push(messagePtr);
          stringToUTF8(compilationMessage.message, messagePtr, messageSize);
          {{{ makeSetValue('compilationMessagePtr', 4, 'messagePtr', '*') }}};
          {{{ makeSetValue('compilationMessagePtr', 8, 'WebGPU.Int_CompilationMessageType[compilationMessage.type]', 'i32') }}};
          {{{ makeSetValue('compilationMessagePtr', 16, 'compilationMessage.lineNum', 'i64') }}};
          {{{ makeSetValue('compilationMessagePtr', 24, 'compilationMessage.linePos', 'i64') }}};
          {{{ makeSetValue('compilationMessagePtr', 32, 'compilationMessage.offset', 'i64') }}};
          {{{ makeSetValue('compilationMessagePtr', 40, 'compilationMessage.length', 'i64') }}};
          // TODO: Convert JavaScript's UTF-16-code-unit offsets to UTF-8-code-unit offsets.
          // https://github.com/webgpu-native/webgpu-headers/issues/246
          {{{ makeSetValue('compilationMessagePtr', 48, 'compilationMessage.linePos', 'i64') }}};
          {{{ makeSetValue('compilationMessagePtr', 56, 'compilationMessage.offset', 'i64') }}};
          {{{ makeSetValue('compilationMessagePtr', 64, 'compilationMessage.length', 'i64') }}};
        }
        var compilationInfoPtr = _malloc({{{ 12 }}});
        {{{ makeSetValue('compilationInfoPtr', 4, 'compilationInfo.messages.length', '*') }}}
        {{{ makeSetValue('compilationInfoPtr', 8, 'compilationMessagesPtr', '*') }}};

        {{{ makeDynCall('vipp', 'callback') }}}({{{ gpu.CompilationInfoRequestStatus.Success }}}, compilationInfoPtr, userdata);

        messageStringPtrs.forEach((ptr) => {
          _free(ptr);
        });
        _free(compilationMessagesPtr);
        _free(compilationInfoPtr);
      });
    });
  },
  wxwgpu_browser_wgpuShaderModuleSetLabel: function(shaderModuleId, labelPtr) {
    var shaderModule = WebGPU.mgrShaderModule.get(shaderModuleId);
    if (!shaderModule) return;
    shaderModule.label = UTF8ToString(labelPtr);
  },

  // wgpuComputePipeline

  wxwgpu_browser_wgpuComputePipelineGetBindGroupLayout: function(pipelineId, groupIndex) {
    var pipeline = WebGPU.mgrComputePipeline.get(pipelineId);
    if (!pipeline) return;
    return WebGPU.mgrBindGroupLayout.create(pipeline.getBindGroupLayout(groupIndex));
  },
  wxwgpu_browser_wgpuComputePipelineSetLabel: function(pipelineId, labelPtr) {
    var pipeline = WebGPU.mgrComputePipeline.get(pipelineId);
    if (!pipeline) return;
    pipeline.label = UTF8ToString(labelPtr);
  },

  // wgpuRenderPipeline

  wxwgpu_browser_wgpuRenderPipelineGetBindGroupLayout: function(pipelineId, groupIndex) {
    var pipeline = WebGPU.mgrRenderPipeline.get(pipelineId);
    if (!pipeline) return;
    return WebGPU.mgrBindGroupLayout.create(pipeline.getBindGroupLayout(groupIndex));
  },
  wxwgpu_browser_wgpuRenderPipelineSetLabel: function(pipelineId, labelPtr) {
    var pipeline = WebGPU.mgrRenderPipeline.get(pipelineId);
    if (!pipeline) return;
    pipeline.label = UTF8ToString(labelPtr);
  },

  // wgpuBindGroup

  wxwgpu_browser_wgpuBindGroupSetLabel: function(bindGroupId, labelPtr) {
    var bindGroup = WebGPU.mgrBindGroup.get(bindGroupId);
    if (!bindGroup) return;
    bindGroup.label = UTF8ToString(labelPtr);
  },

  // wgpuBindGroupLayout

  wxwgpu_browser_wgpuBindGroupLayoutSetLabel: function(bindGroupLayoutId, labelPtr) {
    var bindGroupLayout = WebGPU.mgrBindGroupLayout.get(bindGroupLayoutId);
    if (!bindGroupLayout) return;
    bindGroupLayout.label = UTF8ToString(labelPtr);
  },

  // wgpuBuffer

  // In webgpu.h offset and size are passed in as size_t.
  // And library_webgpu assumes that size_t is always 32bit in emscripten.
  wxwgpu_browser_wgpuBufferGetConstMappedRange__deps: ['$wxwgpuWarnOnce'],
  wxwgpu_browser_wgpuBufferGetConstMappedRange: function(bufferId, offset, size) {
    var bufferWrapper = WebGPU.mgrBuffer.objects[bufferId];
    {{{ gpu.makeCheckDefined('bufferWrapper') }}}

    if (size === 0) wxwgpuWarnOnce('getMappedRange size=0 no longer means WGPU_WHOLE_MAP_SIZE');

    {{{ gpu.convertSentinelToUndefined('size') }}}

    var mapped;
    try {
      mapped = bufferWrapper.object.getMappedRange(offset, size);
    } catch (ex) {
#if ASSERTIONS
      err(`wgpuBufferGetConstMappedRange(${offset}, ${size}) failed: ${ex}`);
#endif
      // TODO(kainino0x): Somehow inject a validation error?
      return 0;
    }
    var data = _memalign(16, mapped.byteLength);
    HEAPU8.set(new Uint8Array(mapped), data);
    bufferWrapper.onUnmap.push(() => _free(data));
    return data;
  },

  wxwgpu_browser_wgpuBufferGetMapState: function(bufferId) {
    var buffer = WebGPU.mgrBuffer.get(bufferId);
    if (!buffer) return;
    return WebGPU.Int_BufferMapState[buffer.mapState];
  },

  // In webgpu.h offset and size are passed in as size_t.
  // And library_webgpu assumes that size_t is always 32bit in emscripten.
  wxwgpu_browser_wgpuBufferGetMappedRange__deps: ['$wxwgpuWarnOnce', '$wxwgpuZeroMemory'],
  wxwgpu_browser_wgpuBufferGetMappedRange: function(bufferId, offset, size) {
    var bufferWrapper = WebGPU.mgrBuffer.objects[bufferId];
    {{{ gpu.makeCheckDefined('bufferWrapper') }}}

    if (size === 0) wxwgpuWarnOnce('getMappedRange size=0 no longer means WGPU_WHOLE_MAP_SIZE');

    {{{ gpu.convertSentinelToUndefined('size') }}}

    if (bufferWrapper.mapMode !== {{{ gpu.MapMode.Write }}}) {
#if ASSERTIONS
      abort("GetMappedRange called, but buffer not mapped for writing");
#endif
      // TODO(kainino0x): Somehow inject a validation error?
      return 0;
    }

    var mapped;
    try {
      mapped = bufferWrapper.object.getMappedRange(offset, size);
    } catch (ex) {
#if ASSERTIONS
      err(`wgpuBufferGetMappedRange(${offset}, ${size}) failed: ${ex}`);
#endif
      // TODO(kainino0x): Somehow inject a validation error?
      return 0;
    }

    var data = _memalign(16, mapped.byteLength);
    wxwgpuZeroMemory(data, mapped.byteLength);
    bufferWrapper.onUnmap.push(() => {
      new Uint8Array(mapped).set(HEAPU8.subarray(data, data + mapped.byteLength));
      _free(data);
    });
    return data;
  },

  // In webgpu.h offset and size are passed in as size_t.
  // And library_webgpu assumes that size_t is always 32bit in emscripten.
  wxwgpu_browser_wgpuBufferMapAsync__deps: ['$wxwgpuCallUserCallback'],
  wxwgpu_browser_wgpuBufferMapAsync: function(bufferId, mode, offset, size, callback, userdata) {
    var bufferWrapper = WebGPU.mgrBuffer.objects[bufferId];
    {{{ gpu.makeCheckDefined('bufferWrapper') }}}
    bufferWrapper.mapMode = mode;
    bufferWrapper.onUnmap = [];
    var buffer = bufferWrapper.object;

    {{{ gpu.convertSentinelToUndefined('size') }}}

    // `callback` takes (WGPUBufferMapAsyncStatus status, void * userdata)

    {{{ runtimeKeepalivePush() }}}
    buffer.mapAsync(mode, offset, size).then(() => {
      {{{ runtimeKeepalivePop() }}}
      wxwgpuCallUserCallback(() => {
        {{{ makeDynCall('vip', 'callback') }}}({{{ gpu.BufferMapAsyncStatus.Success }}}, userdata);
      });
    }, () => {
      {{{ runtimeKeepalivePop() }}}
      wxwgpuCallUserCallback(() => {
        // TODO(kainino0x): Figure out how to pick other error status values.
        {{{ makeDynCall('vip', 'callback') }}}({{{ gpu.BufferMapAsyncStatus.ValidationError }}}, userdata);
      });
    });
  },

  wxwgpu_browser_wgpuBufferGetSize: function(bufferId) {
    var buffer = WebGPU.mgrBuffer.get(bufferId);
    if (!buffer) return;
    // 64-bit
    return buffer.size;
  },

  wxwgpu_browser_wgpuBufferGetUsage: function(bufferId) {
    var buffer = WebGPU.mgrBuffer.get(bufferId);
    if (!buffer) return;
    return buffer.usage;
  },

  wxwgpu_browser_wgpuBufferSetLabel: function(bufferId, labelPtr) {
    var buffer = WebGPU.mgrBuffer.get(bufferId);
    if (!buffer) return;
    buffer.label = UTF8ToString(labelPtr);
  },

  wxwgpu_browser_wgpuBufferUnmap: function(bufferId) {
    var bufferWrapper = WebGPU.mgrBuffer.objects[bufferId];
    {{{ gpu.makeCheckDefined('bufferWrapper') }}}

    if (!bufferWrapper.onUnmap) {
      // Already unmapped
      return;
    }

    for (var f of bufferWrapper.onUnmap) {
      f();
    }
    bufferWrapper.onUnmap = undefined;

    bufferWrapper.object.unmap();
  },

  // wgpuTexture

  wxwgpu_browser_wgpuTextureGetDepthOrArrayLayers: function(textureId) {
    var texture = WebGPU.mgrTexture.get(textureId);
    if (!texture) return;
    return texture.depthOrArrayLayers;
  },

  wxwgpu_browser_wgpuTextureGetDimension: function(textureId) {
    var texture = WebGPU.mgrTexture.get(textureId);
    if (!texture) return;
    return WebGPU.TextureDimension.indexOf(texture.dimension);
  },

  wxwgpu_browser_wgpuTextureGetFormat: function(textureId) {
    var texture = WebGPU.mgrTexture.get(textureId);
    if (!texture) return;
    // Should return the enum integer instead of string.
    return WebGPU.TextureFormat.indexOf(texture.format);
  },

  wxwgpu_browser_wgpuTextureGetHeight: function(textureId) {
    var texture = WebGPU.mgrTexture.get(textureId);
    if (!texture) return;
    return texture.height;
  },

  wxwgpu_browser_wgpuTextureGetMipLevelCount: function(textureId) {
    var texture = WebGPU.mgrTexture.get(textureId);
    if (!texture) return;
    return texture.mipLevelCount;
  },

  wxwgpu_browser_wgpuTextureGetSampleCount: function(textureId) {
    var texture = WebGPU.mgrTexture.get(textureId);
    if (!texture) return;
    return texture.sampleCount;
  },

  wxwgpu_browser_wgpuTextureGetUsage: function(textureId) {
    var texture = WebGPU.mgrTexture.get(textureId);
    if (!texture) return;
    return texture.usage;
  },

  wxwgpu_browser_wgpuTextureGetWidth: function(textureId) {
    var texture = WebGPU.mgrTexture.get(textureId);
    if (!texture) return;
    return texture.width;
  },

  wxwgpu_browser_wgpuTextureSetLabel: function(textureId, labelPtr) {
    var texture = WebGPU.mgrTexture.get(textureId);
    if (!texture) return;
    texture.label = UTF8ToString(labelPtr);
  },

  wxwgpu_browser_wgpuTextureCreateView: function(textureId, descriptor) {
    var desc;
    if (descriptor) {
      {{{ gpu.makeCheckDescriptor('descriptor') }}}
      var mipLevelCount = {{{ gpu.makeGetU32('descriptor', 20) }}};
      var arrayLayerCount = {{{ gpu.makeGetU32('descriptor', 28) }}};
      desc = {
        "format": WebGPU.TextureFormat[
          {{{ gpu.makeGetU32('descriptor', 8) }}}],
        "dimension": WebGPU.TextureViewDimension[
          {{{ gpu.makeGetU32('descriptor', 12) }}}],
        "baseMipLevel": {{{ gpu.makeGetU32('descriptor', 16) }}},
        "mipLevelCount": mipLevelCount === {{{ gpu.MIP_LEVEL_COUNT_UNDEFINED }}} ? undefined : mipLevelCount,
        "baseArrayLayer": {{{ gpu.makeGetU32('descriptor', 24) }}},
        "arrayLayerCount": arrayLayerCount === {{{ gpu.ARRAY_LAYER_COUNT_UNDEFINED }}} ? undefined : arrayLayerCount,
        "aspect": WebGPU.TextureAspect[
          {{{ gpu.makeGetU32('descriptor', 32) }}}],
      };
      var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
      if (labelPtr) desc["label"] = UTF8ToString(labelPtr);
    }

    var texture = WebGPU.mgrTexture.get(textureId);
    if (!texture) return;
    return WebGPU.mgrTextureView.create(texture.createView(desc));
  },

  // wgpuTextureView

  wxwgpu_browser_wgpuTextureViewSetLabel: function(textureViewId, labelPtr) {
    var textureView = WebGPU.mgrTextureView.get(textureViewId);
    if (!textureView) return;
    textureView.label = UTF8ToString(labelPtr);
  },

  // wgpuComputePass

  wxwgpu_browser_wgpuComputePassEncoderSetBindGroup: function(passId, groupIndex, groupId, dynamicOffsetCount, dynamicOffsetsPtr) {
    var pass = WebGPU.mgrComputePassEncoder.get(passId);
    if (!pass) return;
    var group = WebGPU.mgrBindGroup.get(groupId);
    if (!group) return;
    if (dynamicOffsetCount == 0) {
      pass.setBindGroup(groupIndex, group);
    } else {
      var offsets = [];
      for (var i = 0; i < dynamicOffsetCount; i++, dynamicOffsetsPtr += 4) {
        offsets.push({{{ gpu.makeGetU32('dynamicOffsetsPtr', 0) }}});
      }
      pass.setBindGroup(groupIndex, group, offsets);
    }
  },
  wxwgpu_browser_wgpuComputePassEncoderSetLabel: function(passId, labelPtr) {
    var pass = WebGPU.mgrComputePassEncoder.get(passId);
    if (!pass) return;
    pass.label = UTF8ToString(labelPtr);
  },
  wxwgpu_browser_wgpuComputePassEncoderSetPipeline: function(passId, pipelineId) {
    var pass = WebGPU.mgrComputePassEncoder.get(passId);
    if (!pass) return;
    var pipeline = WebGPU.mgrComputePipeline.get(pipelineId);
    if (!pipeline) return;
    pass.setPipeline(pipeline);
  },

  wxwgpu_browser_wgpuComputePassEncoderDispatchWorkgroups: function(passId, x, y, z) {
    var pass = WebGPU.mgrComputePassEncoder.get(passId);
    if (!pass) return;
    pass.dispatchWorkgroups(x, y, z);
  },
  wxwgpu_browser_wgpuComputePassEncoderDispatchWorkgroupsIndirect: function(passId, indirectBufferId, indirectOffset) {
    var indirectBuffer = WebGPU.mgrBuffer.get(indirectBufferId);
    if (!indirectBuffer) return;
    var pass = WebGPU.mgrComputePassEncoder.get(passId);
    if (!pass) return;
    pass.dispatchWorkgroupsIndirect(indirectBuffer, indirectOffset);
  },

  wxwgpu_browser_wgpuComputePassEncoderWriteTimestamp: function(encoderId, querySetId, queryIndex) {
    var pass = WebGPU.mgrComputePassEncoder.get(encoderId);
    if (!pass) return;
    var querySet = WebGPU.mgrQuerySet.get(querySetId);
    if (!querySet) return;
    pass.writeTimestamp(querySet, queryIndex);
  },

  wxwgpu_browser_wgpuComputePassEncoderPushDebugGroup: function(encoderId, groupLabelPtr) {
    var encoder = WebGPU.mgrComputePassEncoder.get(encoderId);
    if (!encoder) return;
    encoder.pushDebugGroup(UTF8ToString(groupLabelPtr));
  },
  wxwgpu_browser_wgpuComputePassEncoderPopDebugGroup: function(encoderId) {
    var encoder = WebGPU.mgrComputePassEncoder.get(encoderId);
    if (!encoder) return;
    encoder.popDebugGroup();
  },
  wxwgpu_browser_wgpuComputePassEncoderInsertDebugMarker: function(encoderId, markerLabelPtr) {
    var encoder = WebGPU.mgrComputePassEncoder.get(encoderId);
    if (!encoder) return;
    encoder.insertDebugMarker(UTF8ToString(markerLabelPtr));
  },

  wxwgpu_browser_wgpuComputePassEncoderEnd: function(passId) {
    var pass = WebGPU.mgrComputePassEncoder.get(passId);
    if (!pass) return;
    pass.end();
  },

  // wgpuRenderPass

  wxwgpu_browser_wgpuRenderPassEncoderSetLabel: function(passId, labelPtr) {
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;
    pass.label = UTF8ToString(labelPtr);
  },

  wxwgpu_browser_wgpuRenderPassEncoderSetBindGroup: function(passId, groupIndex, groupId, dynamicOffsetCount, dynamicOffsetsPtr) {
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;
    var group = WebGPU.mgrBindGroup.get(groupId);
    if (!group) return;
    if (dynamicOffsetCount == 0) {
      pass.setBindGroup(groupIndex, group);
    } else {
      var offsets = [];
      for (var i = 0; i < dynamicOffsetCount; i++, dynamicOffsetsPtr += 4) {
        offsets.push({{{ gpu.makeGetU32('dynamicOffsetsPtr', 0) }}});
      }
      pass.setBindGroup(groupIndex, group, offsets);
    }
  },
  wxwgpu_browser_wgpuRenderPassEncoderSetBlendConstant: function(passId, colorPtr) {
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;
    var color = WebGPU.makeColor(colorPtr);
    pass.setBlendConstant(color);
  },
  wxwgpu_browser_wgpuRenderPassEncoderSetIndexBuffer: function(passId, bufferId, format, offset, size) {
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;
    var buffer = WebGPU.mgrBuffer.get(bufferId);
    if (!buffer) return;
    {{{ gpu.convertSentinelToUndefined('size') }}}
    pass.setIndexBuffer(buffer, WebGPU.IndexFormat[format], offset, size);
  },
  wxwgpu_browser_wgpuRenderPassEncoderSetPipeline: function(passId, pipelineId) {
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;
    var pipeline = WebGPU.mgrRenderPipeline.get(pipelineId);
    if (!pipeline) return;
    pass.setPipeline(pipeline);
  },
  wxwgpu_browser_wgpuRenderPassEncoderSetScissorRect: function(passId, x, y, w, h) {
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;
    pass.setScissorRect(x, y, w, h);
  },
  wxwgpu_browser_wgpuRenderPassEncoderSetViewport: function(passId, x, y, w, h, minDepth, maxDepth) {
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;
    pass.setViewport(x, y, w, h, minDepth, maxDepth);
  },
  wxwgpu_browser_wgpuRenderPassEncoderSetStencilReference: function(passId, reference) {
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;
    pass.setStencilReference(reference);
  },
  wxwgpu_browser_wgpuRenderPassEncoderSetVertexBuffer: function(passId, slot, bufferId, offset, size) {
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;
    var buffer = WebGPU.mgrBuffer.get(bufferId);
    if (!buffer) return;
    {{{ gpu.convertSentinelToUndefined('size') }}}
    pass.setVertexBuffer(slot, buffer, offset, size);
  },

  wxwgpu_browser_wgpuRenderPassEncoderDraw: function(passId, vertexCount, instanceCount, firstVertex, firstInstance) {
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;
    pass.draw(vertexCount, instanceCount, firstVertex, firstInstance);
  },
  wxwgpu_browser_wgpuRenderPassEncoderDrawIndexed: function(passId, indexCount, instanceCount, firstIndex, baseVertex, firstInstance) {
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;
    pass.drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
  },
  wxwgpu_browser_wgpuRenderPassEncoderDrawIndirect: function(passId, indirectBufferId, indirectOffset) {
    var indirectBuffer = WebGPU.mgrBuffer.get(indirectBufferId);
    if (!indirectBuffer) return;
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;
    pass.drawIndirect(indirectBuffer, indirectOffset);
  },
  wxwgpu_browser_wgpuRenderPassEncoderDrawIndexedIndirect: function(passId, indirectBufferId, indirectOffset) {
    var indirectBuffer = WebGPU.mgrBuffer.get(indirectBufferId);
    if (!indirectBuffer) return;
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;
    pass.drawIndexedIndirect(indirectBuffer, indirectOffset);
  },

  wxwgpu_browser_wgpuRenderPassEncoderExecuteBundles: function(passId, count, bundlesPtr) {
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;

#if ASSERTIONS
    assert(bundlesPtr % 4 === 0);
#endif

    var bundles = Array.from({{{ makeHEAPView(`${POINTER_BITS}`, 'bundlesPtr', `bundlesPtr + count * ${POINTER_SIZE}`) }}},
      (id) => WebGPU.mgrRenderBundle.get(id));
    pass.executeBundles(bundles);
  },

  wxwgpu_browser_wgpuRenderPassEncoderBeginOcclusionQuery: function(passId, queryIndex) {
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;
    pass.beginOcclusionQuery(queryIndex);
  },
  wxwgpu_browser_wgpuRenderPassEncoderEndOcclusionQuery: function(passId) {
    var pass = WebGPU.mgrRenderPassEncoder.get(passId);
    if (!pass) return;
    pass.endOcclusionQuery();
  },

  wxwgpu_browser_wgpuRenderPassEncoderWriteTimestamp: function(encoderId, querySetId, queryIndex) {
    var pass = WebGPU.mgrRenderPassEncoder.get(encoderId);
    if (!pass) return;
    var querySet = WebGPU.mgrQuerySet.get(querySetId);
    if (!querySet) return;
    pass.writeTimestamp(querySet, queryIndex);
  },

  wxwgpu_browser_wgpuRenderPassEncoderPushDebugGroup: function(encoderId, groupLabelPtr) {
    var encoder = WebGPU.mgrRenderPassEncoder.get(encoderId);
    if (!encoder) return;
    encoder.pushDebugGroup(UTF8ToString(groupLabelPtr));
  },
  wxwgpu_browser_wgpuRenderPassEncoderPopDebugGroup: function(encoderId) {
    var encoder = WebGPU.mgrRenderPassEncoder.get(encoderId);
    if (!encoder) return;
    encoder.popDebugGroup();
  },
  wxwgpu_browser_wgpuRenderPassEncoderInsertDebugMarker: function(encoderId, markerLabelPtr) {
    var encoder = WebGPU.mgrRenderPassEncoder.get(encoderId);
    if (!encoder) return;
    encoder.insertDebugMarker(UTF8ToString(markerLabelPtr));
  },
  wxwgpu_browser_wgpuRenderPassEncoderEnd: function(encoderId) {
    var encoder = WebGPU.mgrRenderPassEncoder.get(encoderId);
    if (!encoder) return;
    encoder.end();
  },

  // Render bundle

  wxwgpu_browser_wgpuRenderBundleSetLabel: function(bundleId, labelPtr) {
    var bundle = WebGPU.mgrRenderBundle.get(bundleId);
    if (!bundle) return;
    bundle.label = UTF8ToString(labelPtr);
  },

  // Render bundle encoder

  wxwgpu_browser_wgpuRenderBundleEncoderSetLabel: function(bundleId, labelPtr) {
    var pass = WebGPU.mgrRenderBundleEncoder.get(bundleId);
    if (!pass) return;
    pass.label = UTF8ToString(labelPtr);
  },

  wxwgpu_browser_wgpuRenderBundleEncoderSetBindGroup: function(bundleId, groupIndex, groupId, dynamicOffsetCount, dynamicOffsetsPtr) {
    var pass = WebGPU.mgrRenderBundleEncoder.get(bundleId);
    if (!pass) return;
    var group = WebGPU.mgrBindGroup.get(groupId);
    if (!group) return;
    if (dynamicOffsetCount == 0) {
      pass.setBindGroup(groupIndex, group);
    } else {
      var offsets = [];
      for (var i = 0; i < dynamicOffsetCount; i++, dynamicOffsetsPtr += 4) {
        offsets.push({{{ gpu.makeGetU32('dynamicOffsetsPtr', 0) }}});
      }
      pass.setBindGroup(groupIndex, group, offsets);
    }
  },
  wxwgpu_browser_wgpuRenderBundleEncoderSetIndexBuffer: function(bundleId, bufferId, format, offset, size) {
    var pass = WebGPU.mgrRenderBundleEncoder.get(bundleId);
    if (!pass) return;
    var buffer = WebGPU.mgrBuffer.get(bufferId);
    if (!buffer) return;
    {{{ gpu.convertSentinelToUndefined('size') }}}
    pass.setIndexBuffer(buffer, WebGPU.IndexFormat[format], offset, size);
  },
  wxwgpu_browser_wgpuRenderBundleEncoderSetPipeline: function(bundleId, pipelineId) {
    var pass = WebGPU.mgrRenderBundleEncoder.get(bundleId);
    if (!pass) return;
    var pipeline = WebGPU.mgrRenderPipeline.get(pipelineId);
    if (!pipeline) return;
    pass.setPipeline(pipeline);
  },
  wxwgpu_browser_wgpuRenderBundleEncoderSetVertexBuffer: function(bundleId, slot, bufferId, offset, size) {
    var pass = WebGPU.mgrRenderBundleEncoder.get(bundleId);
    if (!pass) return;
    var buffer = WebGPU.mgrBuffer.get(bufferId);
    if (!buffer) return;
    {{{ gpu.convertSentinelToUndefined('size') }}}
    pass.setVertexBuffer(slot, buffer, offset, size);
  },

  wxwgpu_browser_wgpuRenderBundleEncoderDraw: function(bundleId, vertexCount, instanceCount, firstVertex, firstInstance) {
    var pass = WebGPU.mgrRenderBundleEncoder.get(bundleId);
    if (!pass) return;
    pass.draw(vertexCount, instanceCount, firstVertex, firstInstance);
  },
  wxwgpu_browser_wgpuRenderBundleEncoderDrawIndexed: function(bundleId, indexCount, instanceCount, firstIndex, baseVertex, firstInstance) {
    var pass = WebGPU.mgrRenderBundleEncoder.get(bundleId);
    if (!pass) return;
    pass.drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
  },
  wxwgpu_browser_wgpuRenderBundleEncoderDrawIndirect: function(bundleId, indirectBufferId, indirectOffset) {
    var indirectBuffer = WebGPU.mgrBuffer.get(indirectBufferId);
    if (!indirectBuffer) return;
    var pass = WebGPU.mgrRenderBundleEncoder.get(bundleId);
    if (!pass) return;
    pass.drawIndirect(indirectBuffer, indirectOffset);
  },
  wxwgpu_browser_wgpuRenderBundleEncoderDrawIndexedIndirect: function(bundleId, indirectBufferId, indirectOffset) {
    var indirectBuffer = WebGPU.mgrBuffer.get(indirectBufferId);
    if (!indirectBuffer) return;
    var pass = WebGPU.mgrRenderBundleEncoder.get(bundleId);
    if (!pass) return;
    pass.drawIndexedIndirect(indirectBuffer, indirectOffset);
  },

  wxwgpu_browser_wgpuRenderBundleEncoderPushDebugGroup: function(encoderId, groupLabelPtr) {
    var encoder = WebGPU.mgrRenderBundleEncoder.get(encoderId);
    if (!encoder) return;
    encoder.pushDebugGroup(UTF8ToString(groupLabelPtr));
  },
  wxwgpu_browser_wgpuRenderBundleEncoderPopDebugGroup: function(encoderId) {
    var encoder = WebGPU.mgrRenderBundleEncoder.get(encoderId);
    if (!encoder) return;
    encoder.popDebugGroup();
  },
  wxwgpu_browser_wgpuRenderBundleEncoderInsertDebugMarker: function(encoderId, markerLabelPtr) {
    var encoder = WebGPU.mgrRenderBundleEncoder.get(encoderId);
    if (!encoder) return;
    encoder.insertDebugMarker(UTF8ToString(markerLabelPtr));
  },

  wxwgpu_browser_wgpuRenderBundleEncoderFinish: function(bundleId, descriptor) {
    var desc;
    if (descriptor) {
      {{{ gpu.makeCheckDescriptor('descriptor') }}}
      desc = {};
      var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
      if (labelPtr) desc["label"] = UTF8ToString(labelPtr);
    }
    var encoder = WebGPU.mgrRenderBundleEncoder.get(bundleId);
    if (!encoder) return;
    return WebGPU.mgrRenderBundle.create(encoder.finish(desc));
  },

  // Instance

  wxwgpu_browser_wgpuInstanceCreateSurface__deps: ['$wxwgpuFindCanvasEventTarget'],
  wxwgpu_browser_wgpuInstanceCreateSurface: function(instanceId, descriptor) {
    {{{ gpu.makeCheck('descriptor') }}}
    {{{ gpu.makeCheck('instanceId === 1, "WGPUInstance must be created by wgpuCreateInstance"') }}}
    var nextInChainPtr = {{{ makeGetValue('descriptor', 0, '*') }}};
#if ASSERTIONS
    assert(nextInChainPtr !== 0);
    assert({{{ gpu.SType.SurfaceDescriptorFromCanvasHTMLSelector }}} ===
      {{{ gpu.makeGetU32('nextInChainPtr', 4) }}});
#endif
    var descriptorFromCanvasHTMLSelector = nextInChainPtr;

    {{{ gpu.makeCheckDescriptor('descriptorFromCanvasHTMLSelector') }}}
    var selectorPtr = {{{ makeGetValue('descriptorFromCanvasHTMLSelector', 8, '*') }}};
    {{{ gpu.makeCheck('selectorPtr') }}}
    var canvas = wxwgpuFindCanvasEventTarget(selectorPtr);
#if OFFSCREENCANVAS_SUPPORT
    if (canvas.offscreenCanvas) canvas = canvas.offscreenCanvas;
#endif
    var context = canvas.getContext('webgpu');
#if ASSERTIONS
    assert(context);
#endif
    if (!context) return 0;

    var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
    if (labelPtr) context.surfaceLabelWebGPU = UTF8ToString(labelPtr);

    return WebGPU.mgrSurface.create(context);
  },

  wxwgpu_browser_wgpuInstanceHasWGSLLanguageFeature: function(instance, featureEnumValue) {
    if (!('wgslLanguageFeatures' in navigator["gpu"])) {
      return false;
    }
    return navigator["gpu"]["wgslLanguageFeatures"].has(WebGPU.WGSLFeatureName[featureEnumValue]);
  },

  wxwgpu_browser_wgpuInstanceProcessEvents: function(instance) {
    // TODO: This could probably be emulated with ASYNCIFY.
#if ASSERTIONS
    abort('wgpuInstanceProcessEvents is unsupported (use requestAnimationFrame via html5.h instead)');
#endif
  },

  wxwgpu_browser_wgpuInstanceRequestAdapter__deps: ['$wxwgpuCallUserCallback', '$wxwgpuStringToUTF8OnStack'],
  wxwgpu_browser_wgpuInstanceRequestAdapter: function(instanceId, options, callback, userdata) {
    {{{ gpu.makeCheck('instanceId === 1, "WGPUInstance must be created by wgpuCreateInstance"') }}}

    var opts;
    if (options) {
      {{{ gpu.makeCheckDescriptor('options') }}}
      opts = {
        "powerPreference": WebGPU.PowerPreference[
          {{{ gpu.makeGetU32('options', 8) }}}],
        "forceFallbackAdapter":
          {{{ gpu.makeGetBool('options', 16) }}},
      };
    }

    if (!('gpu' in navigator)) {
      var sp = stackSave();
      var messagePtr = wxwgpuStringToUTF8OnStack('WebGPU not available on this browser (navigator.gpu is not available)');
      {{{ makeDynCall('vippp', 'callback') }}}({{{ gpu.RequestAdapterStatus.Unavailable }}}, 0, messagePtr, userdata);
      stackRestore(sp);
      return;
    }

    {{{ runtimeKeepalivePush() }}}
    navigator["gpu"]["requestAdapter"](opts).then((adapter) => {
      {{{ runtimeKeepalivePop() }}}
      wxwgpuCallUserCallback(() => {
        if (adapter) {
          var adapterId = WebGPU.mgrAdapter.create(adapter);
          {{{ makeDynCall('vippp', 'callback') }}}({{{ gpu.RequestAdapterStatus.Success }}}, adapterId, 0, userdata);
        } else {
          var sp = stackSave();
          var messagePtr = wxwgpuStringToUTF8OnStack('WebGPU not available on this system (requestAdapter returned null)');
          {{{ makeDynCall('vippp', 'callback') }}}({{{ gpu.RequestAdapterStatus.Unavailable }}}, 0, messagePtr, userdata);
          stackRestore(sp);
        }
      });
    }, (ex) => {
      {{{ runtimeKeepalivePop() }}}
      wxwgpuCallUserCallback(() => {
        var sp = stackSave();
        var messagePtr = wxwgpuStringToUTF8OnStack(ex.message);
        {{{ makeDynCall('vippp', 'callback') }}}({{{ gpu.RequestAdapterStatus.Error }}}, 0, messagePtr, userdata);
        stackRestore(sp);
      });
    });
  },

  // WGPUAdapter

  wxwgpu_browser_wgpuAdapterEnumerateFeatures: function(adapterId, featuresOutPtr) {
    var offset = 0;
    var numFeatures = 0;
    var adapter = WebGPU.mgrAdapter.get(adapterId);
    if (!adapter) return;
    adapter.features.forEach(feature => {
      var featureEnumValue = WebGPU.FeatureNameString2Enum[feature];
      if (featureEnumValue !== undefined) {
        if (featuresOutPtr !== 0) {
          {{{ makeSetValue('featuresOutPtr', 'offset', 'featureEnumValue', 'i32') }}};
          offset += 4;
        }
        numFeatures++;
      }
    });
    return numFeatures;
  },

  wxwgpu_browser_wgpuAdapterGetInfo__deps: ['$wxwgpuStringToNewUTF8'],
  wxwgpu_browser_wgpuAdapterGetInfo: function(adapterId, info) {
    var adapter = WebGPU.mgrAdapter.get(adapterId);
    if (!adapter) return;
    {{{ gpu.makeCheckDescriptor('info') }}}

    var vendorPtr = wxwgpuStringToNewUTF8(adapter.info.vendor);
    {{{ makeSetValue('info', 4, 'vendorPtr', '*') }}};
    var architecturePtr = wxwgpuStringToNewUTF8(adapter.info.architecture);
    {{{ makeSetValue('info', 8, 'architecturePtr', '*') }}};
    var devicePtr = wxwgpuStringToNewUTF8(adapter.info.device);
    {{{ makeSetValue('info', 12, 'devicePtr', '*') }}};
    var descriptionPtr = wxwgpuStringToNewUTF8(adapter.info.description);
    {{{ makeSetValue('info', 16, 'descriptionPtr', '*') }}};
    {{{ makeSetValue('info', 20, gpu.BackendType.WebGPU, 'i32') }}};
    var adapterType = adapter.isFallbackAdapter ? {{{ gpu.AdapterType.CPU }}} : {{{ gpu.AdapterType.Unknown }}};
    {{{ makeSetValue('info', 24, 'adapterType', 'i32') }}};
    {{{ makeSetValue('info', 28, '0', 'i32') }}};
    {{{ makeSetValue('info', 32, '0', 'i32') }}};
  },

  wxwgpu_browser_wgpuAdapterGetProperties__deps: ['$wxwgpuWarnOnce'],
  wxwgpu_browser_wgpuAdapterGetProperties: function(adapterId, properties) {
    wxwgpuWarnOnce('wgpuAdapterGetProperties is deprecated, use wgpuAdapterGetInfo instead');

    {{{ gpu.makeCheckDescriptor('properties') }}}
    {{{ makeSetValue('properties', 4, '0', 'i32') }}};
    {{{ makeSetValue('properties', 8, '0', 'i32') }}};
    {{{ makeSetValue('properties', 12, '0', 'i32') }}};
    {{{ makeSetValue('properties', 16, '0', 'i32') }}};
    {{{ makeSetValue('properties', 20, '0', 'i32') }}};
    {{{ makeSetValue('properties', 24, '0', 'i32') }}};
    {{{ makeSetValue('properties', 28, gpu.AdapterType.Unknown, 'i32') }}};
    {{{ makeSetValue('properties', 32, gpu.BackendType.WebGPU, 'i32') }}};
    {{{ makeSetValue('properties', 36, '0', 'i32') }}};
  },

  wxwgpu_browser_wgpuAdapterGetLimits: function(adapterId, limitsOutPtr) {
    var adapter = WebGPU.mgrAdapter.get(adapterId);
    if (!adapter) return;
    WebGPU.fillLimitStruct(adapter.limits, limitsOutPtr);
    return 1;
  },

  wxwgpu_browser_wgpuAdapterHasFeature: function(adapterId, featureEnumValue) {
    var adapter = WebGPU.mgrAdapter.get(adapterId);
    if (!adapter) return;
    return adapter.features.has(WebGPU.FeatureName[featureEnumValue]);
  },

  wxwgpu_browser_wgpuAdapterRequestDevice__deps: ['$wxwgpuCallUserCallback', '$wxwgpuStringToUTF8OnStack'],
  wxwgpu_browser_wgpuAdapterRequestDevice: function(adapterId, descriptor, callback, userdata) {
    var adapter = WebGPU.mgrAdapter.get(adapterId);
    if (!adapter) return;

    var desc = {};
    if (descriptor) {
      {{{ gpu.makeCheckDescriptor('descriptor') }}}
      var requiredFeatureCount = {{{ gpu.makeGetU32('descriptor', 8) }}};
      if (requiredFeatureCount) {
        var requiredFeaturesPtr = {{{ makeGetValue('descriptor', 12, '*') }}};
        // requiredFeaturesPtr is a pointer to an array of FeatureName which is an enum of size uint32_t
        desc["requiredFeatures"] = Array.from({{{ makeHEAPView('U32', 'requiredFeaturesPtr', `requiredFeaturesPtr + requiredFeatureCount * 4`) }}},
          (feature) => WebGPU.FeatureName[feature]);
      }
      var requiredLimitsPtr = {{{ makeGetValue('descriptor', 16, '*') }}};
      if (requiredLimitsPtr) {
        {{{ gpu.makeCheckDescriptor('requiredLimitsPtr') }}}
        var limitsPtr = requiredLimitsPtr + {{{ 8 }}};
        var requiredLimits = {};
        function setLimitU32IfDefined(name, limitOffset) {
            if (!(name in adapter.limits)) return;   // 浏览器不认识的 limit 直接跳过
          var ptr = limitsPtr + limitOffset;
          var value = {{{ gpu.makeGetU32('ptr', 0) }}};
          if (value != {{{ gpu.LIMIT_U32_UNDEFINED }}}) {
            requiredLimits[name] = value;
          }
        }
        function setLimitU64IfDefined(name, limitOffset) {
            if (!(name in adapter.limits)) return;
          var ptr = limitsPtr + limitOffset;
          // Handle WGPU_LIMIT_U64_UNDEFINED.
          var limitPart1 = {{{ gpu.makeGetU32('ptr', 0) }}};
          var limitPart2 = {{{ gpu.makeGetU32('ptr', 4) }}};
          if (limitPart1 != 0xFFFFFFFF || limitPart2 != 0xFFFFFFFF) {
            requiredLimits[name] = {{{ gpu.makeGetU64('ptr', 0) }}}
          }
        }

        setLimitU32IfDefined("maxTextureDimension1D", {{{ 0 }}});
        setLimitU32IfDefined("maxTextureDimension2D", {{{ 4 }}});
        setLimitU32IfDefined("maxTextureDimension3D", {{{ 8 }}});
        setLimitU32IfDefined("maxTextureArrayLayers", {{{ 12 }}});
        setLimitU32IfDefined("maxBindGroups", {{{ 16 }}});
        setLimitU32IfDefined('maxBindGroupsPlusVertexBuffers', {{{ 20 }}});
        setLimitU32IfDefined("maxDynamicUniformBuffersPerPipelineLayout", {{{ 28 }}});
        setLimitU32IfDefined("maxDynamicStorageBuffersPerPipelineLayout", {{{ 32 }}});
        setLimitU32IfDefined("maxSampledTexturesPerShaderStage", {{{ 36 }}});
        setLimitU32IfDefined("maxSamplersPerShaderStage", {{{ 40 }}});
        setLimitU32IfDefined("maxStorageBuffersPerShaderStage", {{{ 44 }}});
        setLimitU32IfDefined("maxStorageTexturesPerShaderStage", {{{ 48 }}});
        setLimitU32IfDefined("maxUniformBuffersPerShaderStage", {{{ 52 }}});
        setLimitU32IfDefined("minUniformBufferOffsetAlignment", {{{ 72 }}});
        setLimitU32IfDefined("minStorageBufferOffsetAlignment", {{{ 76 }}});
        setLimitU64IfDefined("maxUniformBufferBindingSize", {{{ 56 }}});
        setLimitU64IfDefined("maxStorageBufferBindingSize", {{{ 64 }}});
        setLimitU32IfDefined("maxVertexBuffers", {{{ 80 }}});
        setLimitU64IfDefined("maxBufferSize", {{{ 88 }}});
        setLimitU32IfDefined("maxVertexAttributes", {{{ 96 }}});
        setLimitU32IfDefined("maxVertexBufferArrayStride", {{{ 100 }}});
        setLimitU32IfDefined("maxInterStageShaderComponents", {{{ 104 }}});
        setLimitU32IfDefined("maxInterStageShaderVariables", {{{ 108 }}});
        setLimitU32IfDefined("maxColorAttachments", {{{ 112 }}});
        setLimitU32IfDefined("maxColorAttachmentBytesPerSample", {{{ 116 }}});
        setLimitU32IfDefined("maxComputeWorkgroupStorageSize", {{{ 120 }}});
        setLimitU32IfDefined("maxComputeInvocationsPerWorkgroup", {{{ 124 }}});
        setLimitU32IfDefined("maxComputeWorkgroupSizeX", {{{ 128 }}});
        setLimitU32IfDefined("maxComputeWorkgroupSizeY", {{{ 132 }}});
        setLimitU32IfDefined("maxComputeWorkgroupSizeZ", {{{ 136 }}});
        setLimitU32IfDefined("maxComputeWorkgroupsPerDimension", {{{ 140 }}});
        desc["requiredLimits"] = requiredLimits;
      }

      var defaultQueuePtr = {{{ makeGetValue('descriptor', 20, '*') }}};
      if (defaultQueuePtr) {
        var defaultQueueDesc = {};
        var labelPtr = {{{ makeGetValue('defaultQueuePtr', 4, '*') }}};
        if (labelPtr) defaultQueueDesc["label"] = UTF8ToString(labelPtr);
        desc["defaultQueue"] = defaultQueueDesc;
      }

      var deviceLostCallbackPtr = {{{ makeGetValue('descriptor', 28, '*') }}};
      var deviceLostUserdataPtr = {{{ makeGetValue('descriptor', 32, '*') }}};

      var labelPtr = {{{ makeGetValue('descriptor', 4, '*') }}};
      if (labelPtr) desc["label"] = UTF8ToString(labelPtr);
    }

    {{{ runtimeKeepalivePush() }}}
    adapter.requestDevice(desc).then((device) => {
      {{{ runtimeKeepalivePop() }}}
      wxwgpuCallUserCallback(() => {
        var deviceWrapper = { queueId: WebGPU.mgrQueue.create(device.queue) };
        var deviceId = WebGPU.mgrDevice.create(device, deviceWrapper);
        if (deviceLostCallbackPtr) {
          device.lost.then((info) => {
            wxwgpuCallUserCallback(() => WebGPU.errorCallback(deviceLostCallbackPtr,
              WebGPU.Int_DeviceLostReason[info.reason], info.message, deviceLostUserdataPtr));
          });
        }
        {{{ makeDynCall('vippp', 'callback') }}}({{{ gpu.RequestDeviceStatus.Success }}}, deviceId, 0, userdata);
      });
    }, function(ex) {
      {{{ runtimeKeepalivePop() }}}
      wxwgpuCallUserCallback(() => {
        var sp = stackSave();
        var messagePtr = wxwgpuStringToUTF8OnStack(ex.message);
        {{{ makeDynCall('vippp', 'callback') }}}({{{ gpu.RequestDeviceStatus.Error }}}, 0, messagePtr, userdata);
        stackRestore(sp);
      });
    });
  },

  // WGPUAdapterProperties

  wxwgpu_browser_wgpuAdapterPropertiesFreeMembers: function(value) {
    // wgpuAdapterGetProperties doesn't currently allocate anything.
  },

  // WGPUSampler

  wxwgpu_browser_wgpuSamplerSetLabel: function(samplerId, labelPtr) {
    var sampler = WebGPU.mgrSampler.get(samplerId);
    if (!sampler) return;
    sampler.label = UTF8ToString(labelPtr);
  },

  // WGPUSurface

  wxwgpu_browser_wgpuSurfaceConfigure: function(surfaceId, config) {
    {{{ gpu.makeCheckDescriptor('config') }}}
    var deviceId = {{{ makeGetValue('config', 4, '*') }}};
    var context = WebGPU.mgrSurface.get(surfaceId);
    if (!context) return;

#if ASSERTIONS
    assert({{{ gpu.PresentMode.Fifo }}} ===
      {{{ gpu.makeGetU32('config', 36) }}});
#endif

    var canvasSize = [
      {{{ gpu.makeGetU32('config', 28) }}},
      {{{ gpu.makeGetU32('config', 32) }}}
    ];

    if (canvasSize[0] !== 0) {
      context["canvas"]["width"] = canvasSize[0];
    }

    if (canvasSize[1] !== 0) {
      context["canvas"]["height"] = canvasSize[1];
    }

    var configuration = {
      "device": WebGPU.mgrDevice.get(deviceId),
      "format": WebGPU.TextureFormat[
        {{{ gpu.makeGetU32('config', 8) }}}],
      "usage": {{{ gpu.makeGetU32('config', 12) }}},
      "alphaMode": WebGPU.AlphaMode[
        {{{ gpu.makeGetU32('config', 24) }}}],
    };

    var viewFormatCount = {{{ gpu.makeGetU32('config', 16) }}};

    if (viewFormatCount) {
      var viewFormats = {{{ makeGetValue('config', 20, '*') }}};
      // viewFormats pointer to an array of TextureFormat which is an enum of size uint32_t
      configuration['viewFormats'] = Array.from({{{ makeHEAPView('32', 'viewFormats', 'viewFormats + viewFormatCount * 4') }}},
        format => WebGPU.TextureFormat[format]);
    }

    context.configure(configuration);
  },

  wxwgpu_browser_wgpuSurfaceGetCurrentTexture: function(surfaceId, surfaceTexturePtr) {
    {{{ gpu.makeCheck('surfaceTexturePtr') }}}
    var context = WebGPU.mgrSurface.get(surfaceId);
    if (!context) return;

    try {
      var texture = WebGPU.mgrTexture.create(context.getCurrentTexture());
      {{{ makeSetValue('surfaceTexturePtr', 0, 'texture', '*') }}};
      {{{ makeSetValue('surfaceTexturePtr', 4, '0', 'i32') }}};
      {{{ makeSetValue('surfaceTexturePtr', 8, 
        gpu.SurfaceGetCurrentTextureStatus.Success, 'i32') }}};
    } catch (ex) {
#if ASSERTIONS
      err(`wgpuSurfaceGetCurrentTexture() failed: ${ex}`);
#endif
      {{{ makeSetValue('surfaceTexturePtr', 0, '0', '*') }}};
      {{{ makeSetValue('surfaceTexturePtr', 4, '0', 'i32') }}};
      // TODO(https://github.com/webgpu-native/webgpu-headers/issues/291): What should the status be here?
      {{{ makeSetValue('surfaceTexturePtr', 8,
        gpu.SurfaceGetCurrentTextureStatus.DeviceLost, 'i32') }}};
    }
  },

  wxwgpu_browser_wgpuSurfaceGetPreferredFormat: function(surfaceId, adapterId) {
    var format = navigator["gpu"]["getPreferredCanvasFormat"]();
    return WebGPU.Int_PreferredFormat[format];
  },

  wxwgpu_browser_wgpuSurfacePresent: function(surfaceId) {
    // TODO: This could probably be emulated with ASYNCIFY.
    abort('wgpuSurfacePresent is unsupported (use requestAnimationFrame via html5.h instead)');
  },

  wxwgpu_browser_wgpuSurfaceUnconfigure: function(surfaceId) {
    var context = WebGPU.mgrSurface.get(surfaceId);
    if (!context) return;
    context.unconfigure();
  },

  // WGPUSwapChain

  wxwgpu_browser_wgpuDeviceCreateSwapChain: function(deviceId, surfaceId, descriptor) {
    {{{ gpu.makeCheckDescriptor('descriptor') }}}
    var device = WebGPU.mgrDevice.get(deviceId);
    if (!device) return;
    var context = WebGPU.mgrSurface.get(surfaceId);
    if (!context) return;

#if ASSERTIONS
    assert({{{ gpu.PresentMode.Fifo }}} ===
      {{{ gpu.makeGetU32('descriptor', 24) }}});
#endif

    var canvasSize = [
      {{{ gpu.makeGetU32('descriptor', 16) }}},
      {{{ gpu.makeGetU32('descriptor', 20) }}}
    ];

    if (canvasSize[0] !== 0) {
      context["canvas"]["width"] = canvasSize[0];
    }

    if (canvasSize[1] !== 0) {
      context["canvas"]["height"] = canvasSize[1];
    }

    var configuration = {
      "device": device,
      "format": WebGPU.TextureFormat[
        {{{ gpu.makeGetU32('descriptor', 12) }}}],
      "usage": {{{ gpu.makeGetU32('descriptor', 8) }}},
      "alphaMode": "opaque",
    };
    context.configure(configuration);

    return WebGPU.mgrSwapChain.create(context);
  },

  wxwgpu_browser_wgpuSwapChainGetCurrentTexture: function(swapChainId) {
    var context = WebGPU.mgrSwapChain.get(swapChainId);
    if (!context) return;
    return WebGPU.mgrTexture.create(context.getCurrentTexture());
  },
  wxwgpu_browser_wgpuSwapChainGetCurrentTextureView: function(swapChainId) {
    var context = WebGPU.mgrSwapChain.get(swapChainId);
    if (!context) return;
    return WebGPU.mgrTextureView.create(context.getCurrentTexture().createView());
  },
  wxwgpu_browser_wgpuSwapChainPresent: function(swapChainId) {
    // TODO: This could probably be emulated with ASYNCIFY.
    abort('wgpuSwapChainPresent is unsupported (use requestAnimationFrame via html5.h instead)');
  },
};

// Inverted index used by EnumerateFeatures/HasFeature
LibraryWebGPU.$WebGPU.FeatureNameString2Enum = {};
for (var value in LibraryWebGPU.$WebGPU.FeatureName) {
  LibraryWebGPU.$WebGPU.FeatureNameString2Enum[LibraryWebGPU.$WebGPU.FeatureName[value]] = value;
}

for (const key of Object.keys(LibraryWebGPU)) {
  if (typeof LibraryWebGPU[key] === 'function') {
    const sig = LibraryManager.library[key + '__sig'];
    if ((sig && sig.includes('j'))) {
      LibraryManager.library[key + '__i53abi'] = true;
    }
  }
}

autoAddDeps(LibraryWebGPU, '$WebGPU');
mergeInto(LibraryManager.library, LibraryWebGPU);

// ════════════════════════════════════════════════════════════════════════
// wxwgpu 浏览器后端补齐函数
// 来源：emsdk system/lib/webgpu/webgpu.cpp（C++ 侧实现的 JS 等价物）
// + SurfacePresent 的 no-op 语义（浏览器由合成器 present，对齐微信行为）
// ════════════════════════════════════════════════════════════════════════
var LibraryWxwgpuBrowserExtra = {
  // webgpu.cpp: wgpuCreateInstance 返回固定句柄（glue 内 assert instanceId===INSTANCE_ID）
  wxwgpu_browser_wgpuCreateInstance: function(descriptor) {
    return 1;
  },

  // webgpu.cpp: Instance 引用计数 no-op
  wxwgpu_browser_wgpuInstanceReference: function(instanceId) {},
  wxwgpu_browser_wgpuInstanceRelease: function(instanceId) {},

  // 浏览器由页面合成器在 rAF 帧结束时自动 present（emsdk 原版此处 abort；
  // 为对齐微信 SurfacePresent 的"提交即呈现"语义改为 no-op）
  wxwgpu_browser_wgpuSurfacePresent: function(surfaceId) {},

  // webgpu.cpp: Surface 能力表（静态数据，与 C++ 版本同布局）
  wxwgpu_browser_wgpuSurfaceGetCapabilities: function(surfaceId, adapterId, capabilities) {
    if (!capabilities) return;
    if (!WebGPU.surfaceCapsFormatsPtr) {
      // 首选格式跟随浏览器 getPreferredCanvasFormat（Chrome/Mac=bgra8unorm, 其他多为 rgba8unorm）
      var preferredIsBgra = navigator["gpu"]["getPreferredCanvasFormat"]() === 'bgra8unorm';
      var formats = _malloc(4 * 3);
      {{{ makeSetValue('formats', 0, "preferredIsBgra ? 0x17 /*BGRA8Unorm*/ : 0x12 /*RGBA8Unorm*/", 'i32') }}};
      {{{ makeSetValue('formats', 4, "preferredIsBgra ? 0x12 /*RGBA8Unorm*/ : 0x17 /*BGRA8Unorm*/", 'i32') }}};
      {{{ makeSetValue('formats', 8, '0x22 /*RGBA16Float*/', 'i32') }}};
      var presentModes = _malloc(4);
      {{{ makeSetValue('presentModes', 0, '1 /*WGPUPresentMode_Fifo*/', 'i32') }}};
      var alphaModes = _malloc(4 * 2);
      {{{ makeSetValue('alphaModes', 0, '1 /*Opaque*/', 'i32') }}};
      {{{ makeSetValue('alphaModes', 4, '2 /*Premultiplied*/', 'i32') }}};
      WebGPU.surfaceCapsFormatsPtr = formats;
      WebGPU.surfaceCapsPresentModesPtr = presentModes;
      WebGPU.surfaceCapsAlphaModesPtr = alphaModes;
    }
    {{{ makeSetValue('capabilities', 0, '0', '*') }}};
    {{{ makeSetValue('capabilities', 4, '3', 'i32') }}};
    {{{ makeSetValue('capabilities', 8, 'WebGPU.surfaceCapsFormatsPtr', '*') }}};
    {{{ makeSetValue('capabilities', 12, '1', 'i32') }}};
    {{{ makeSetValue('capabilities', 16, 'WebGPU.surfaceCapsPresentModesPtr', '*') }}};
    {{{ makeSetValue('capabilities', 20, '2', 'i32') }}};
    {{{ makeSetValue('capabilities', 24, 'WebGPU.surfaceCapsAlphaModesPtr', '*') }}};
  },
  wxwgpu_browser_wgpuSurfaceCapabilitiesFreeMembers: function(value) {
    // 静态生命周期数据，no-op（与 C++ 版一致）
  },

  // webgpu.cpp: 释放 wgpuAdapterGetInfo 中 stringToNewUTF8 分配的字符串
  wxwgpu_browser_wgpuAdapterInfoFreeMembers__deps: [],
  wxwgpu_browser_wgpuAdapterInfoFreeMembers: function(adapterInfo) {
    if (!adapterInfo) return;
    var fields = [
      4,
      8,
      12,
      16,
    ];
    for (var i = 0; i < fields.length; ++i) {
      var ptr = {{{ makeGetValue('adapterInfo', 'fields[i]', '*') }}};
      if (ptr) _free(ptr);
    }
  },
};

mergeInto(LibraryManager.library, LibraryWxwgpuBrowserExtra);

// ════════════════════════════════════════════════════════════════════════
// 自包含 polyfill：把 glue 用到的外部 $ 符号全部本地化。
// 语义与 emsdk 同名符号等价，实现参考 emsdk 3.1.8 src/library.js。
// ════════════════════════════════════════════════════════════════════════
var LibraryWxwgpuCompat = {
  $wxwgpuCallUserCallback: function(func) {
    // runtime 已退出 / 已 abort 时忽略回调
    if (typeof ABORT !== 'undefined' && ABORT) return;
    try {
      func();
    } catch (e) {
      // 回调里抛出 ExitStatus 时按 emsdk 语义走 maybeExit，其余原样抛出
      if (e && e.name === 'ExitStatus' && typeof maybeExit === 'function') {
        maybeExit();
        return;
      }
      throw e;
    }
  },

  $wxwgpuWarnOnce: function(text) {
    if (!wxwgpuWarnOnce.shown) wxwgpuWarnOnce.shown = {};
    if (wxwgpuWarnOnce.shown[text]) return;
    wxwgpuWarnOnce.shown[text] = 1;
    if (typeof err === 'function') err(text);
    else console.warn(text);
  },

  // 4.0 的 $stringToNewUTF8（malloc + stringToUTF8）
  $wxwgpuStringToNewUTF8: function(jsString) {
    var size = lengthBytesUTF8(jsString) + 1;
    var ptr = _malloc(size);
    if (ptr) stringToUTF8(jsString, ptr, size);
    return ptr;
  },

  // 4.0 的 $zeroMemory
  $wxwgpuZeroMemory: function(ptr, size) {
    HEAPU8.fill(0, ptr, ptr + size);
  },

  // html5 的 $findCanvasEventTarget：selector 为空/默认 → Module['canvas']
  $wxwgpuFindCanvasEventTarget: function(target) {
    var selector = target ? UTF8ToString(target) : '';
    if (!selector) return Module['canvas'];
    if (selector[0] === '#' || selector[0] === '.') {
      return document.querySelector(selector);
    }
    return document.querySelector('#' + selector);
  },

  // 4.0 的 $stringToUTF8OnStack：栈上分配，随 stackRestore 回收
  $wxwgpuStringToUTF8OnStack: function(str) {
    var size = lengthBytesUTF8(str) + 1;
    var ptr = stackAlloc(size);
    stringToUTF8(str, ptr, size);
    return ptr;
  },
};

mergeInto(LibraryManager.library, LibraryWxwgpuCompat);
