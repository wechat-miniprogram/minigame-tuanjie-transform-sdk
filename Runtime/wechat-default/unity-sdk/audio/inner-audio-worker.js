import { isSupportPlayBackRate } from '../../check-version';
import { localAudioMap } from './store';
import { uid } from '../utils';
import { WorkerChannel } from '../worker-channel';

export const AUDIO_CFG = {
    frameBatch: true,
    autoDestroyOnEnd: true,
};

export const MSG = {
    INIT_CONFIG: 100,
    AUDIO_CREATE: 110,
    AUDIO_SET_BOOL: 111,
    AUDIO_SET_STRING: 112,
    AUDIO_SET_FLOAT: 113,
    AUDIO_PLAY: 116,
    AUDIO_PAUSE: 117,
    AUDIO_STOP: 118,
    AUDIO_DESTROY: 119,
    AUDIO_SEEK: 120,
    AUDIO_ADD_LISTENER: 121,
    AUDIO_REMOVE_LISTENER: 122,
    AUDIO_BATCH: 145,
    AUDIO_SET_MUTE: 150,
    AUDIO_ON_HIDE: 151,
    AUDIO_ON_SHOW: 152,
    AUDIO_INTERRUPTION: 153,
};

export const channel = new WorkerChannel({ frameBatch: AUDIO_CFG.frameBatch });

export const workerAudios = {};

let workerReady = false;
function compareVersion(v1, v2) {
    const a = v1.split('.').map(Number);
    const b = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] || 0) > (b[i] || 0))
            return 1;
        if ((a[i] || 0) < (b[i] || 0))
            return -1;
    }
    return 0;
}
function isSupportAudioWorker() {
    try {
        
        if (!GameGlobal.unityNamespace.useAudioWorker)
            return false;
        const ns = GameGlobal.unityNamespace;
        const { platform, SDKVersion } = wx.getSystemInfoSync();
        const isAndroidSupport = platform === 'android' && compareVersion(SDKVersion, '3.14.3') >= 0;
        
        if (ns.useAudioWorkerAndroidOnly !== false) {
            return isAndroidSupport;
        }
        
        const isStandardWorker = !!(wx.env && wx.env.isSupportStandardWorker);
        return isAndroidSupport || isStandardWorker;
    }
    catch (e) {
        return false;
    }
}
function initAudioWorker() {
    if (!isSupportAudioWorker())
        return;
    try {
        channel.create('workers/audio/index.js', {
            assetPath: (GameGlobal.manager && GameGlobal.manager.assetPath) || '',
            autoDestroyOnEnd: !!AUDIO_CFG.autoDestroyOnEnd,
        });
        workerReady = channel.isReady();
        if (workerReady)
            console.warn('[audio-worker] started');
    }
    catch (e) {
        console.warn('[audio-worker] create failed:', e);
        workerReady = false;
    }
}
initAudioWorker();

function getFullUrl(v) {
    if (!v)
        return '';
    if (/^https?:\/\//.test(v) || /^wxfile:\/\//.test(v))
        return v;
    const cdnPath = (GameGlobal.manager && GameGlobal.manager.assetPath) || '';
    return `${cdnPath.replace(/\/$/, '')}/${v.replace(/^\//, '').replace(/^Assets\//, '')}`;
}
function nextWorkerId() {
    return `wa_${uid()}`;
}
// ─── 导出 ─────────────────────────────────────────────────────────
export function isWorkerReady() {
    return workerReady;
}
export default {
    WXCreateInnerAudioContext(src, loop, startTime, autoplay, volume, playbackRate, needDownload) {
        const id = nextWorkerId();
        const fullSrc = src ? getFullUrl(src) : '';
        const vol = (typeof volume === 'undefined') ? 1 : +volume.toFixed(2);
        const rate = (!isSupportPlayBackRate || typeof playbackRate === 'undefined')
            ? 1 : +playbackRate.toFixed(2);
        
        workerAudios[id] = { paused: !autoplay, volume: vol, loop: !!loop };
        channel.postQueued(MSG.AUDIO_CREATE, {
            audioId: id,
            fullSrc,
            loop: !!loop,
            startTime: (typeof startTime === 'undefined' || startTime <= 0) ? 0 : +startTime.toFixed(2),
            autoplay: !!autoplay,
            volume: vol,
            playbackRate: rate,
            needDownload: !!needDownload,
            localPathHint: (fullSrc && localAudioMap[fullSrc]) || undefined,
        });
        return id;
    },
    WXInnerAudioContextSetBool(id, k, v) {
        const state = workerAudios[id];
        if (state && k === 'loop')
            state.loop = Boolean(+v);
        channel.postQueued(MSG.AUDIO_SET_BOOL, { audioId: id, k, v: Boolean(+v) });
    },
    WXInnerAudioContextSetString(id, k, v) {
        if (k === 'src') {
            const fullSrc = v ? getFullUrl(v) : '';
            channel.postQueued(MSG.AUDIO_SET_STRING, {
                audioId: id, k, v: fullSrc,
                localPathHint: (fullSrc && localAudioMap[fullSrc]) || undefined,
            });
        }
        else {
            channel.postQueued(MSG.AUDIO_SET_STRING, { audioId: id, k, v });
        }
    },
    WXInnerAudioContextSetFloat(id, k, v) {
        const state = workerAudios[id];
        if (state && k === 'volume')
            state.volume = +v.toFixed(2);
        channel.postQueued(MSG.AUDIO_SET_FLOAT, { audioId: id, k, v: +v.toFixed(2) });
    },
    WXInnerAudioContextGetFloat(id, k) {
        const state = workerAudios[id];
        if (state && k === 'volume')
            return state.volume;
        return 0;
    },
    WXInnerAudioContextGetBool(id, k) {
        const state = workerAudios[id];
        if (state && k === 'loop')
            return state.loop;
        if (state && k === 'paused')
            return state.paused;
        return false;
    },
    WXInnerAudioContextPlay(id) {
        const state = workerAudios[id];
        if (state)
            state.paused = false;
        channel.postQueued(MSG.AUDIO_PLAY, { audioId: id });
    },
    WXInnerAudioContextPause(id) {
        const state = workerAudios[id];
        if (state)
            state.paused = true;
        channel.postQueued(MSG.AUDIO_PAUSE, { audioId: id });
    },
    WXInnerAudioContextStop(id) {
        const state = workerAudios[id];
        if (state)
            state.paused = true;
        channel.postQueued(MSG.AUDIO_STOP, { audioId: id });
    },
    WXInnerAudioContextDestroy(id) {
        delete workerAudios[id];
        channel.postQueued(MSG.AUDIO_DESTROY, { audioId: id });
    },
    WXInnerAudioContextSeek(id, position) {
        channel.postQueued(MSG.AUDIO_SEEK, { audioId: id, position: +position.toFixed(3) });
    },
    WXInnerAudioContextAddListener() { },
    WXInnerAudioContextRemoveListener() { },
};
