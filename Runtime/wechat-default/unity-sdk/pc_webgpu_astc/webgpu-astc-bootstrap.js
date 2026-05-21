var DEFAULT_TIMEOUT_MS = 2000;
var _GL = null;
function mark() {
    try {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
    }
    catch (_) { }
    return Date.now();
}
function log(level, ...args) {
    const tag = '[WebGPU ASTC Bootstrap]';
    (console[level] || console.log).call(console, tag, ...args);
}



function wxIsWebGPUSupported(timeoutMs) {
    return new Promise((resolve) => {
        var done = false;
        var timer = setTimeout(function () {
            if (done)
                return;
            done = true;
            resolve({ supported: false, reason: 'probe-timeout' });
        }, timeoutMs || DEFAULT_TIMEOUT_MS);
        try {
            wx.isWebGPUSupported({
                success: function (res) {
                    if (done)
                        return;
                    done = true;
                    clearTimeout(timer);
                    resolve({ supported: !!(res && res.supported) });
                },
                fail: function (err) {
                    if (done)
                        return;
                    done = true;
                    clearTimeout(timer);
                    resolve({ supported: false, reason: 'probe-failed', error: err });
                },
            });
        }
        catch (e) {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            
            resolve({ supported: false, reason: 'api-missing', error: e });
        }
    });
}
var _WX_DECODE_QUEUE = [];
var _WX_DECODE_INFLIGHT = 0;











var DEFAULT_MAX_CONCURRENCY = 6;
function _getMaxConcurrency() {
    try {
        if (typeof GameGlobal !== 'undefined'
            && typeof GameGlobal._WEBGPU_ASTC_DECODE_CONCURRENCY === 'number'
            && GameGlobal._WEBGPU_ASTC_DECODE_CONCURRENCY > 0) {
            return GameGlobal._WEBGPU_ASTC_DECODE_CONCURRENCY;
        }
    }
    catch (_) { }
    return DEFAULT_MAX_CONCURRENCY;
}
function _drainWxDecodeQueue() {
    var max = _getMaxConcurrency();
    while (_WX_DECODE_INFLIGHT < max && _WX_DECODE_QUEUE.length > 0) {
        var task = _WX_DECODE_QUEUE.shift();
        _WX_DECODE_INFLIGHT++;
        _runWxDecodeTask(task);
    }
}
function _runWxDecodeTask(task) {
    var hostT0 = mark();
    try {
        wx.decodeASTC({
            data: task.params.data,
            width: task.params.width,
            height: task.params.height,
            blockWidth: task.params.blockWidth,
            blockHeight: task.params.blockHeight,
            success: function (res) {
                _WX_DECODE_INFLIGHT--;
                if (!res || !res.rgba) {
                    task.reject(new Error('decodeASTC: empty response'));
                }
                else {
                    task.resolve(res);
                }
                _drainWxDecodeQueue();
            },
            fail: function (err) {
                _WX_DECODE_INFLIGHT--;
                var wallMs = (mark() - hostT0).toFixed(2);
                log('error', '[wxDecodeASTC fail]', 'size=' + task.params.width + 'x' + task.params.height, 'wallMs=' + wallMs, 'errMsg=' + (err && err.errMsg));
                task.reject(new Error((err && err.errMsg) || 'decodeASTC: unknown fail'));
                _drainWxDecodeQueue();
            },
        });
    }
    catch (e) {
        _WX_DECODE_INFLIGHT--;
        task.reject(e);
        _drainWxDecodeQueue();
    }
}
function wxDecodeASTC(params) {
    return new Promise(function (resolve, reject) {
        _WX_DECODE_QUEUE.push({
            params: params,
            resolve: resolve,
            reject: reject,
        });
        _drainWxDecodeQueue();
    });
}
var _INJECT_QUEUE = [];
var _INJECT_RAF_SCHEDULED = false;
var DEFAULT_INJECT_BYTES_PER_FRAME = 8 * 1024 * 1024;
var DEFAULT_INJECT_COUNT_PER_FRAME = 4;
function _getInjectBudgetBytes() {
    try {
        if (typeof GameGlobal !== 'undefined'
            && typeof GameGlobal._WEBGPU_ASTC_INJECT_BYTES_PER_FRAME === 'number') {
            var v = GameGlobal._WEBGPU_ASTC_INJECT_BYTES_PER_FRAME;
            if (v > 0)
                return v; 
        }
    }
    catch (_) { }
    return DEFAULT_INJECT_BYTES_PER_FRAME;
}
function _getInjectBudgetCount() {
    try {
        if (typeof GameGlobal !== 'undefined'
            && typeof GameGlobal._WEBGPU_ASTC_INJECT_COUNT_PER_FRAME === 'number') {
            var v = GameGlobal._WEBGPU_ASTC_INJECT_COUNT_PER_FRAME;
            if (v > 0)
                return v;
        }
    }
    catch (_) { }
    return DEFAULT_INJECT_COUNT_PER_FRAME;
}
function _isInjectThrottlingDisabled() {
    
    try {
        if (typeof GameGlobal !== 'undefined') {
            var b = GameGlobal._WEBGPU_ASTC_INJECT_BYTES_PER_FRAME;
            var c = GameGlobal._WEBGPU_ASTC_INJECT_COUNT_PER_FRAME;
            if (b === Infinity || c === Infinity)
                return true;
            if (typeof b === 'number' && b <= 0)
                return true;
            if (typeof c === 'number' && c <= 0)
                return true;
        }
    }
    catch (_) { }
    return false;
}
function _scheduleInjectFlush() {
    if (_INJECT_RAF_SCHEDULED)
        return;
    _INJECT_RAF_SCHEDULED = true;
    var raf = (typeof requestAnimationFrame === 'function')
        ? requestAnimationFrame
        : function (cb) { return setTimeout(cb, 16); };
    raf(function () {
        _INJECT_RAF_SCHEDULED = false;
        var budgetBytes = _getInjectBudgetBytes();
        var budgetCount = _getInjectBudgetCount();
        var spentBytes = 0;
        var spentCount = 0;
        while (_INJECT_QUEUE.length > 0
            && spentCount < budgetCount
            && spentBytes < budgetBytes) {
            var job = _INJECT_QUEUE.shift();
            try {
                job.run();
            }
            catch (e) {
                
                try {
                    log('error', '[ASTC inject job exception]', e && e.message);
                }
                catch (_) { }
            }
            spentBytes += job.bytes;
            spentCount += 1;
        }
        if (_INJECT_QUEUE.length > 0)
            _scheduleInjectFlush();
    });
}
function _enqueueInject(job) {
    if (_isInjectThrottlingDisabled()) {
        
        
        
        
        job.run();
        return;
    }
    _INJECT_QUEUE.push(job);
    
    
    
    
    var _len = _INJECT_QUEUE.length;
    if (_len === 50 || _len === 200) {
        try {
            log('warn', '[ASTC inject queue large]', 'len=' + _len);
        }
        catch (_) { }
    }
    _scheduleInjectFlush();
}





var ASTC_INTERNAL_FORMATS = {
    0x93B0: { bw: 4, bh: 4 },
    0x93B1: { bw: 5, bh: 4 },
    0x93B2: { bw: 5, bh: 5 },
    0x93B3: { bw: 6, bh: 5 },
    0x93B4: { bw: 6, bh: 6 },
    0x93B5: { bw: 8, bh: 5 },
    0x93B6: { bw: 8, bh: 6 },
    0x93B7: { bw: 8, bh: 8 },
    0x93B8: { bw: 10, bh: 5 },
    0x93B9: { bw: 10, bh: 6 },
    0x93BA: { bw: 10, bh: 8 },
    0x93BB: { bw: 10, bh: 10 },
    0x93BC: { bw: 12, bh: 10 },
    0x93BD: { bw: 12, bh: 12 },
    
    0x93D0: { bw: 4, bh: 4, srgb: true },
    0x93D1: { bw: 5, bh: 4, srgb: true },
    0x93D2: { bw: 5, bh: 5, srgb: true },
    0x93D3: { bw: 6, bh: 5, srgb: true },
    0x93D4: { bw: 6, bh: 6, srgb: true },
    0x93D5: { bw: 8, bh: 5, srgb: true },
    0x93D6: { bw: 8, bh: 6, srgb: true },
    0x93D7: { bw: 8, bh: 8, srgb: true },
    0x93D8: { bw: 10, bh: 5, srgb: true },
    0x93D9: { bw: 10, bh: 6, srgb: true },
    0x93DA: { bw: 10, bh: 8, srgb: true },
    0x93DB: { bw: 10, bh: 10, srgb: true },
    0x93DC: { bw: 12, bh: 10, srgb: true },
    0x93DD: { bw: 12, bh: 12, srgb: true },
};



export async function bootstrapWebGPUASTC(opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    
    
    
    
    
    var shimEnabled = !!((typeof globalThis !== 'undefined' && globalThis.__WEBGPU_ASTC_SHIM_ENABLED__) ||
        (typeof GameGlobal !== 'undefined' && GameGlobal.__WEBGPU_ASTC_SHIM_ENABLED__));
    if (!shimEnabled) {
        GameGlobal._webgpuASTCEnabled = false;
        GameGlobal._webgpuASTCDecoder = null;
        log('info', 'skip: disabled by EnableWebGPUAstcShim=false (no WebGPU context will be initialized)');
        return { enabled: false, reason: 'disabled-by-config' };
    }
    GameGlobal._webgpuASTCEnabled = false;
    GameGlobal._webgpuASTCDecoder = null;
    var t0 = mark();
    
    var isPc = !!(GameGlobal.unityNamespace && GameGlobal.unityNamespace.isPc);
    if (!isPc) {
        log('info', 'skip: non-pc platform');
        return { enabled: false, reason: 'non-pc' };
    }
    
    var probe = await wxIsWebGPUSupported(timeoutMs);
    if (!probe.supported) {
        log('info', 'skip: wx.isWebGPUSupported returned false', probe.reason);
        return { enabled: false, reason: probe.reason || 'no-webgpu', costMs: mark() - t0 };
    }
    
    
    
    function _toArrayBuffer(data) {
        if (!data)
            return data;
        if (data instanceof ArrayBuffer)
            return data;
        if (data.buffer && typeof data.byteLength === 'number' && typeof data.byteOffset === 'number') {
            if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
                return data.buffer;
            }
            return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        }
        return data;
    }
    
    var _glContext = null;
    
    var _initFailed = false;
    var _initFailReason = null;
    
    var _extSRGB = null;
    
    var _isWebGL2Cached = null;
    function _detectIsWebGL2(gl) {
        if (_isWebGL2Cached !== null)
            return _isWebGL2Cached;
        var r = false;
        
        if (typeof GameGlobal !== 'undefined'
            && GameGlobal.managerConfig
            && GameGlobal.managerConfig.contextConfig) {
            r = GameGlobal.managerConfig.contextConfig.contextType === 2;
        }
        
        if (!r && typeof GameGlobal !== 'undefined'
            && GameGlobal.GL && GameGlobal.GL.currentContext
            && GameGlobal.GL.currentContext.supportsWebGL2EntryPoints) {
            r = true;
        }
        
        if (!r && typeof gl.texStorage2D === 'function') {
            r = true;
        }
        _isWebGL2Cached = r;
        return r;
    }
    
    
    function _doInjectToGL(gl, res, glTextureId, targetEnum, levelArg, xoffsetArg, yoffsetArg, isSub, isSrgbAstc, width, height) {
        var _TAG = '[WebGPU ASTC decodeAndInjectToGLTexture]';
        
        var glTexObj = null;
        var _GL_get = _GL;
        if (_GL_get && _GL_get.textures) {
            glTexObj = _GL_get.textures[glTextureId];
        }
        if (!glTexObj) {
            log('error', _TAG, 'GL.textures[' + glTextureId + '] 为空，无法注入纹理', '_GL=' + (_GL_get ? 'ok' : 'null'), 'texturesLen=' + (_GL_get && _GL_get.textures ? _GL_get.textures.length : 'n/a'));
            return;
        }
        
        var TARGET_2D = 0x0DE1;
        var TARGET_CUBE_MAP = 0x8513;
        var CUBE_FACE_LO = 0x8515; 
        var CUBE_FACE_HI = 0x851A; 
        var imageTarget = targetEnum;
        var bindTarget;
        if (imageTarget >= CUBE_FACE_LO && imageTarget <= CUBE_FACE_HI) {
            bindTarget = TARGET_CUBE_MAP;
        }
        else if (imageTarget === TARGET_CUBE_MAP) {
            bindTarget = TARGET_CUBE_MAP;
            imageTarget = CUBE_FACE_LO;
        }
        else {
            bindTarget = TARGET_2D;
            imageTarget = TARGET_2D;
        }
        var isWebGL2 = _detectIsWebGL2(gl);
        gl.bindTexture(bindTarget, glTexObj);
        var pixels = new Uint8Array(res.rgba);
        var SRGB8_ALPHA8 = 0x8C43;
        var SRGB_ALPHA_EXT = 0x8C42;
        var uploadInternalFormat = gl.RGBA;
        var uploadFormat = gl.RGBA;
        if (isSrgbAstc) {
            if (isWebGL2) {
                uploadInternalFormat = SRGB8_ALPHA8;
                uploadFormat = gl.RGBA;
            }
            else {
                if (!_extSRGB) {
                    _extSRGB = gl.getExtension('EXT_sRGB');
                }
                if (_extSRGB) {
                    uploadInternalFormat = SRGB_ALPHA_EXT;
                    uploadFormat = SRGB_ALPHA_EXT;
                }
                else {
                    uploadInternalFormat = gl.RGBA;
                    uploadFormat = gl.RGBA;
                }
            }
        }
        if (isSub) {
            gl.texSubImage2D(imageTarget, levelArg, xoffsetArg, yoffsetArg, width, height, uploadFormat, gl.UNSIGNED_BYTE, pixels);
        }
        else {
            gl.texImage2D(imageTarget, levelArg, uploadInternalFormat, width, height, 0, uploadFormat, gl.UNSIGNED_BYTE, pixels);
        }
    }
    var decoderProxy = {
                decodeAndInjectToGLTexture: function (glTextureId, astcData, width, height, blockWidth, blockHeight, meta) {
            var _TAG = '[WebGPU ASTC decodeAndInjectToGLTexture]';
            var t0 = mark();
            
            
            meta = meta || {};
            var targetEnum = (meta.target != null) ? meta.target : 0x0DE1 ;
            var levelArg = (meta.level != null) ? meta.level : 0;
            var xoffsetArg = (meta.xoffset != null) ? meta.xoffset : 0;
            var yoffsetArg = (meta.yoffset != null) ? meta.yoffset : 0;
            var isSub = !!meta.isSub;
            
            
            var astcInternalFormat = (meta.internalFormat != null) ? meta.internalFormat : 0;
            var astcInfo = ASTC_INTERNAL_FORMATS[astcInternalFormat];
            var isSrgbAstc = !!(astcInfo && astcInfo.srgb);
            
            if (_initFailed) {
                return Promise.reject(new Error(_TAG + ' decoder 已熔断: ' + _initFailReason));
            }
            
            if (!astcData) {
                var err = new Error(_TAG + ' astcData 为空');
                log('error', err.message);
                return Promise.reject(err);
            }
            if (width <= 0 || height <= 0 || blockWidth <= 0 || blockHeight <= 0) {
                var err2 = new Error(_TAG + ' 参数无效: width=' + width + ', height=' + height +
                    ', blockWidth=' + blockWidth + ', blockHeight=' + blockHeight);
                log('error', err2.message);
                return Promise.reject(err2);
            }
            var gl = _glContext;
            if (!gl) {
                log('warn', _TAG, 'gl context 未绑定，仅解码不注入纹理');
            }
            var buf = _toArrayBuffer(astcData);
            return wxDecodeASTC({
                data: buf,
                width: width,
                height: height,
                blockWidth: blockWidth,
                blockHeight: blockHeight,
            }).then(function (res) {
                if (!gl) {
                    log('warn', _TAG, '无 gl context，跳过纹理注入');
                    return;
                }
                
                
                return new Promise(function (injectResolve, injectReject) {
                    var jobBytes = (res && res.rgba && res.rgba.byteLength)
                        ? res.rgba.byteLength
                        : (width * height * 4);
                    _enqueueInject({
                        bytes: jobBytes,
                        run: function () {
                            try {
                                _doInjectToGL(gl, res, glTextureId, targetEnum, levelArg, xoffsetArg, yoffsetArg, isSub, isSrgbAstc, width, height);
                                injectResolve();
                            }
                            catch (e) {
                                injectReject(e);
                            }
                        },
                    });
                });
            }).catch(function (err) {
                var elapsed = (mark() - t0).toFixed(2);
                var errMsg = err && err.message || String(err);
                
                var isInitFailure = errMsg.indexOf('decoder init failed') !== -1 ||
                    errMsg.indexOf('WebGPU not supported') !== -1 ||
                    errMsg.indexOf('DXGI_ERROR') !== -1 ||
                    errMsg.indexOf('DEVICE_REMOVED') !== -1 ||
                    errMsg.indexOf('D3D12') !== -1;
                if (isInitFailure && !_initFailed) {
                    _initFailed = true;
                    _initFailReason = errMsg;
                    GameGlobal._webgpuASTCEnabled = false;
                    log('error', _TAG, 'init 失败，触发熔断，后续调用将立即拒绝', 'reason=' + errMsg);
                }
                log('error', _TAG, '失败', 'glTextureId=' + glTextureId, 'size=' + width + 'x' + height, 'target=0x' + (targetEnum || 0).toString(16), 'level=' + levelArg, 'isSub=' + isSub, 'astcFmt=0x' + astcInternalFormat.toString(16), 'srgb=' + isSrgbAstc, '耗时=' + elapsed + 'ms', 'error=' + errMsg, err);
                throw err;
            });
        },
        setGLContext: function (gl) {
            _glContext = gl;
        },
    };
    GameGlobal._webgpuASTCDecoder = decoderProxy;
    GameGlobal._webgpuASTCEnabled = true;
    var costMs = mark() - t0;
    log('info', 'ready (via wx.decodeASTC)', { costMs: Math.round(costMs) });
    return { enabled: true, costMs: costMs };
}

export function bindDecoderGLContextOnce(GLctx, GL) {
    if (GameGlobal._webgpuASTCDecoder && typeof GameGlobal._webgpuASTCDecoder.setGLContext === 'function') {
        GameGlobal._webgpuASTCDecoder.setGLContext(GLctx);
    }
    _GL = GL;
}




if ((typeof globalThis !== 'undefined' && globalThis.__WEBGPU_ASTC_SHIM_ENABLED__) ||
    (typeof GameGlobal !== 'undefined' && GameGlobal.__WEBGPU_ASTC_SHIM_ENABLED__)) {
    GameGlobal._bindWebGPUASTCDecoderGLContext = bindDecoderGLContextOnce;
}
