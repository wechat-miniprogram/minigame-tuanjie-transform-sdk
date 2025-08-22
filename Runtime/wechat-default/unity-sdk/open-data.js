import response from './response';
import moduleHelper from './module-helper';
import { getDefaultData, debugLog } from './utils';
import { isSupportSharedCanvasMode } from '../check-version';

let cachedOpenDataContext;
let cachedSharedCanvas;
var SharedCanvasMode;
(function (SharedCanvasMode) {
    SharedCanvasMode["ScreenCanvas"] = "screenCanvas";
    SharedCanvasMode["OffScreenCanvas"] = "offscreenCanvas";
})(SharedCanvasMode || (SharedCanvasMode = {}));
let sharedCanvasMode;
let timerId;
let textureId;

function getOpenDataContext(mode) {
    if (cachedOpenDataContext) {
        return cachedOpenDataContext;
    }
    
    if (!isSupportSharedCanvasMode) {
        if (mode === 'ScreenCanvas') {
            console.warn('[unity-sdk]: 当前环境不支持 ScreenCanvas 模式');
        }
        sharedCanvasMode = SharedCanvasMode.OffScreenCanvas;
    }
    
    if (!sharedCanvasMode) {
        if (typeof mode === 'string' && SharedCanvasMode[mode]) {
            sharedCanvasMode = SharedCanvasMode[mode];
        }
        else {
            sharedCanvasMode = SharedCanvasMode.OffScreenCanvas;
        }
    }
    console.log(`[unity-sdk]: 当前开放数据域为 ${sharedCanvasMode} 模式`);
    // @ts-ignore
    cachedOpenDataContext = wx.getOpenDataContext({
        sharedCanvasMode,
    });
    return cachedOpenDataContext;
}

function getSharedCanvas() {
    return cachedSharedCanvas || getOpenDataContext().canvas;
}

function hookUnityRender() {
    if (!textureId) {
        return;
    }
    const Module = GameGlobal.manager.gameInstance.Module;
    const { GL } = Module;
    const gl = GL.currentContext.GLctx;
    const isLinearColorSpace = GameGlobal.unityNamespace.unityColorSpace === 'Linear';
    
    if (gl.emscriptenGLX) {
        Module.ccall('glxShowOpenData', null, ['number', 'number', 'bool'], [textureId, getSharedCanvas().__uid(), isLinearColorSpace]);
    }
    else {
        
        gl.bindTexture(gl.TEXTURE_2D, GL.textures[textureId]);
        if (isLinearColorSpace) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, getSharedCanvas());
        }
        else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, getSharedCanvas());
        }
        timerId = requestAnimationFrame(hookUnityRender);
    }
}

function stopLastRenderLoop() {
    
    if (typeof timerId !== 'undefined') {
        cancelAnimationFrame(timerId);
    }
}
function startHookUnityRender() {
    stopLastRenderLoop();
    hookUnityRender();
}
function stopHookUnityRender() {
    stopLastRenderLoop();
    
    const sharedCanvas = getSharedCanvas();
    sharedCanvas.width = 1;
    sharedCanvas.height = 1;
    
    const Module = GameGlobal.manager.gameInstance.Module;
    const { GL } = Module;
    const gl = GL.currentContext.GLctx;
    
    if (gl.emscriptenGLX) {
        Module.ccall('glxHideOpenData', null, [], []);
    }
}
wx.onShow(() => {
    if (cachedOpenDataContext) {
        getOpenDataContext().postMessage({
            type: 'WXShow',
        });
    }
});
export default {
    WXGetOpenDataContext(mode) {
        debugLog('WXGetOpenDataContext:', mode);
        getOpenDataContext(mode);
    },
    WXDataContextPostMessage(msg) {
        debugLog('WXDataContextPostMessage:', msg);
        getOpenDataContext().postMessage(msg);
    },
    WXShowOpenData(id, x, y, width, height) {
        debugLog('WXShowOpenData:', id, x, y, width, height);
        if (width <= 0 || height <= 0) {
            console.error('[unity-sdk]: WXShowOpenData要求 width 和 height 参数必须大于0');
        }
        
        if (!cachedOpenDataContext) {
            console.warn('[unity-sdk]: 请先调用 WXGetOpenDataContext');
        }
        
        const openDataContext = getOpenDataContext();
        const sharedCanvas = openDataContext.canvas;
        sharedCanvas.width = width;
        sharedCanvas.height = height;
        if (sharedCanvasMode === SharedCanvasMode.ScreenCanvas && sharedCanvas.style) {
            sharedCanvas.style.left = `${x / window.devicePixelRatio}px`;
            sharedCanvas.style.top = `${y / window.devicePixelRatio}px`;
            sharedCanvas.style.width = `${width / window.devicePixelRatio}px`;
            sharedCanvas.style.height = `${height / window.devicePixelRatio}px`;
        }
        openDataContext.postMessage({
            type: 'WXRender',
            x,
            y,
            width,
            height,
            devicePixelRatio: window.devicePixelRatio,
        });
        if (sharedCanvasMode === SharedCanvasMode.OffScreenCanvas) {
            textureId = id;
            startHookUnityRender();
        }
    },
    WXHideOpenData() {
        debugLog('WXHideOpenData');
        if (!cachedOpenDataContext) {
            console.warn('[unity-sdk]: 请先调用 WXGetOpenDataContext');
            return;
        }
        getOpenDataContext().postMessage({
            type: 'WXDestroy',
        });
        if (sharedCanvasMode === SharedCanvasMode.OffScreenCanvas) {
            stopHookUnityRender();
        }
        else if (sharedCanvasMode === SharedCanvasMode.ScreenCanvas) {
            const sharedCanvas = getSharedCanvas();
            if (sharedCanvas.style) {
                sharedCanvas.style.top = '9999px';
            }
        }
    },
    WXOpenDataToTempFilePathSync(conf) {
        debugLog('WXOpenDataToTempFilePathSync', conf);
        const sharedCanvas = getSharedCanvas();
        if (!sharedCanvas) {
            return 'Please use WX.GetOpenDataContext() first';
        }
        return sharedCanvas.toTempFilePathSync(getDefaultData(sharedCanvas, conf));
    },
    WXOpenDataToTempFilePath(conf, s, f, c) {
        debugLog('WXOpenDataToTempFilePath', conf);
        if (conf) {
            const sharedCanvas = getSharedCanvas();
            if (!sharedCanvas) {
                console.error('Please use WX.GetOpenDataContext() first');
                return;
            }
            sharedCanvas.toTempFilePath({
                ...getDefaultData(sharedCanvas, conf),
                ...response.handleText(s, f, c),
                success: (res) => {
                    moduleHelper.send('ToTempFilePathCallback', JSON.stringify({
                        callbackId: s,
                        errMsg: res.errMsg,
                        errCode: res.errCode || 0,
                        tempFilePath: res.tempFilePath,
                    }));
                },
            });
        }
    },
};
