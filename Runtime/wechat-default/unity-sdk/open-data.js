import response from './response';
import moduleHelper from './module-helper';
import { getDefaultData } from './utils';
import { isDebug, isSupportSharedCanvasMode } from '../check-version';

let cachedOpenDataContext;
let cachedSharedCanvas;
var SharedCanvasMode;
(function (SharedCanvasMode) {
    SharedCanvasMode["ScreenCanvas"] = "screenCanvas";
    SharedCanvasMode["OffScreenCanvas"] = "offscreenCanvas";
})(SharedCanvasMode || (SharedCanvasMode = {}));
let sharedCanvasMode;
let timerId;
let textureObject = null;
let textureId;

function getOpenDataContext(mode) {
    if (cachedOpenDataContext) {
        return cachedOpenDataContext;
    }
    
    if (!isSupportSharedCanvasMode) {
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
    const { GL } = GameGlobal.manager.gameInstance.Module;
    const gl = GL.currentContext.GLctx;
    if (!textureObject) {
        textureObject = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, textureObject);
        if (GameGlobal.unityNamespace.unityColorSpace === 'Linear') {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, getSharedCanvas());
        }
        else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, getSharedCanvas());
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    else {
        
        gl.bindTexture(gl.TEXTURE_2D, textureObject);
        if (GameGlobal.unityNamespace.unityColorSpace === 'Linear') {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, getSharedCanvas());
        }
        else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, getSharedCanvas());
        }
    }
    GL.textures[textureId] = textureObject;
    timerId = requestAnimationFrame(hookUnityRender);
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
    
    const { GL } = GameGlobal.manager.gameInstance.Module;
    const gl = GL.currentContext.GLctx;
    gl.deleteTexture(textureObject);
    textureObject = null;
}
export default {
    WXGetOpenDataContext(mode) {
        if (isDebug) {
            console.warn('WXGetOpenDataContext:', mode);
        }
        getOpenDataContext(mode);
    },
    WXDataContextPostMessage(msg) {
        if (isDebug) {
            console.warn('WXDataContextPostMessage:', msg);
        }
        getOpenDataContext().postMessage(msg);
    },
    WXShowOpenData(id, x, y, width, height) {
        if (isDebug) {
            console.warn('WXShowOpenData:', id, x, y, width, height);
        }
        if (width <= 0 || height <= 0) {
            console.error('[unity-sdk]: WXShowOpenData要求 width 和 height 参数必须大于0');
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
        if (isDebug) {
            console.warn('WXHideOpenData');
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
        if (isDebug) {
            console.warn('WXOpenDataToTempFilePathSync', conf);
        }
        const sharedCanvas = getSharedCanvas();
        if (!sharedCanvas) {
            return 'Please use WX.GetOpenDataContext() first';
        }
        return sharedCanvas.toTempFilePathSync(getDefaultData(sharedCanvas, conf));
    },
    WXOpenDataToTempFilePath(conf, s, f, c) {
        if (isDebug) {
            console.warn('WXOpenDataToTempFilePath', conf);
        }
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
