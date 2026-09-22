
import moduleHelper from './module-helper';
import canvasHelper from './canvas';
import fs from './fs';
import util from './util';
import audio from './audio/index';
import texture from './texture';
import fix from './fix';
import canvasContext from './canvas-context';
import video from './video';
import logger from './logger';
import sdk from './sdk';
import videoDecoder from './video/index';
import mobileKeyboard from './mobileKeyboard/index';
import touch from './touch/index';
import specialCallbacks from './special-callbacks';
const unityVersion = '$unityVersion$';
GameGlobal.unityNamespace = GameGlobal.unityNamespace || {};
GameGlobal.unityNamespace.unityVersion = unityVersion;
window._ScaleRate = 1;

if (unityVersion && unityVersion.split('.').slice(0, 2)
    .join('') < '20193') {
    const width = window.innerWidth * window.devicePixelRatio;
    const height = window.innerHeight * window.devicePixelRatio;
    canvas.width = width;
    canvas.height = height;
    window._ScaleRate = window.devicePixelRatio;
}
Object.defineProperty(canvas, 'clientHeight', {
    get() {
        return window.innerHeight * window._ScaleRate;
    },
    configurable: true,
});
Object.defineProperty(canvas, 'clientWidth', {
    get() {
        return window.innerWidth * window._ScaleRate;
    },
    configurable: true,
});
Object.defineProperty(document.body, 'clientHeight', {
    get() {
        return window.innerHeight * window._ScaleRate;
    },
    configurable: true,
});
Object.defineProperty(document.body, 'clientWidth', {
    get() {
        return window.innerWidth * window._ScaleRate;
    },
    configurable: true,
});
Object.defineProperty(document, 'fullscreenEnabled', {
    get() {
        return true;
    },
    configurable: true,
});
fix.init();
const WXWASMSDK = {
        WXInitializeSDK() {
        moduleHelper.init();
        moduleHelper.send('Inited', 200);
    },
    ...canvasHelper,
    ...fs,
    ...util,
    ...audio,
    ...texture,
    ...video,
    ...logger,
    canvasContext,
    ...sdk,
    ...videoDecoder,
    ...mobileKeyboard,
    ...touch,
    ...specialCallbacks,
};
GameGlobal.WXWASMSDK = WXWASMSDK;
