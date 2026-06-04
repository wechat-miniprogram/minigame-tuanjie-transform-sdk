// @ts-nocheck
/**
 * 音频 Worker 入口脚本（独立 Worker，纯音频）。单向通信：只接收主线程消息，不回发。
 *
 *   [1] 消息常量 MSG（与主线程 unity-sdk/audio/inner-audio-worker.ts 手动同步）
 *   [2] 环境能力探测
 *   [3] 全局状态
 *   [4] 音频实例（create / destroy；含 onCanplay 钩子）
 *   [5] 下载器
 *   [6] 监听器（只在 Worker 内部防御性响应底层事件，不回传）
 *   [7] 消息处理 Handlers + 初始化
 *
 * Worker 里 wx API 挂在 worker 上：
 *   worker.createInnerAudioContext / worker.downloadFile
 */

import { WorkerChannel } from '../worker-channel';

// [1] ----------------------------------------------------------
const MSG = {
    INIT_CONFIG:           100,

    AUDIO_CREATE:          110,
    AUDIO_SET_BOOL:        111,
    AUDIO_SET_STRING:      112,
    AUDIO_SET_FLOAT:       113,
    AUDIO_PLAY:            116,
    AUDIO_PAUSE:           117,
    AUDIO_STOP:            118,
    AUDIO_DESTROY:         119,
    AUDIO_SEEK:            120,
    AUDIO_ADD_LISTENER:    121,   // Worker 不回传事件，此消息 no-op
    AUDIO_REMOVE_LISTENER: 122,   // 同上

    AUDIO_PRE_DOWNLOAD:    130,   // Worker 不回传 → 主线程已改走 Legacy，Worker 不会收到
    AUDIO_BATCH:           145,

    AUDIO_SET_MUTE:        150,
    AUDIO_ON_HIDE:         151,
    AUDIO_ON_SHOW:         152,
    AUDIO_INTERRUPTION:    153,
};

// [2] ----------------------------------------------------------

function fullUrl(v, assetPath) {
    if (!v) return v;
    if (/^https?:\/\//.test(v) || /^wxfile:\/\//.test(v)) return v;
    const base = (assetPath || '').replace(/\/$/, '');
    const rest = v.replace(/^\//, '').replace(/^Assets\//, '');
    return base ? `${base}/${rest}` : v;
}

// [3] ----------------------------------------------------------
const audios = {};        // audioId → InnerAudioContext
const metas = {};         // audioId → { pendingPlay, isLoading, canplay }
const localMap = {};      // src → 本地路径
const downloading = {};   // src → [{resolve, reject}]
const origVol = new WeakMap();
let isMute = false;
let interruptList = {};
const IGNORE_ERROR = "audio is playing, don't play again";

let cfg = null;   // 由 INIT_CONFIG 下发

// [4] ----------------------------------------------------------
function createAudio(audioId) {
    if (audios[audioId]) return audios[audioId]; // 复用已有实例
    if (typeof worker.createInnerAudioContext !== 'function') {
        console.error('[audio-worker] worker.createInnerAudioContext unavailable');
        return null;
    }
    const audio = worker.createInnerAudioContext({ useWebAudioImplement: true });
    audios[audioId] = audio;
    metas[audioId] = { pendingPlay: false, isLoading: undefined, canplay: false };

    // onCanplay：标记可播 + 如果有 pendingPlay 立刻 play
    if (typeof audio.onCanplay === 'function') {
        audio.onCanplay(() => {
            const m = metas[audioId];
            if (!m) return;
            m.canplay = true;
            if (m.pendingPlay) {
                m.pendingPlay = false;
                try { audio.play(); } catch (e) {}
            }
        });
    }

    // 非 loop 播完不再自动 destroy，保留实例供 Unity 复用
    if (typeof audio.onEnded === 'function') {
        audio.onEnded(() => {
            // no-op: 实例复用，由 Unity 显式 destroy
        });
    }

    // onError（静默处理已知错误）
    if (typeof audio.onError === 'function') {
        audio.onError(() => {});
    }
    return audio;
}

function destroyAudio(audioId) {
    const audio = audios[audioId];
    if (!audio) return;
    try { audio.destroy(); } catch (e) {}
    delete audios[audioId];
    delete metas[audioId];
}

// [5] ----------------------------------------------------------
function downloadEnd(src, ok, path) {
    const q = downloading[src];
    if (!q) return;
    while (q.length) {
        const it = q.shift();
        ok ? it && it.resolve && it.resolve(path) : it && it.reject && it.reject();
    }
    delete downloading[src];
}

function downloadOne(src) {
    return new Promise((resolve, reject) => {
        if (localMap[src]) return resolve(localMap[src]);
        if (downloading[src]) return downloading[src].push({ resolve, reject });
        downloading[src] = [{ resolve, reject }];
        if (typeof worker.downloadFile !== 'function') {
            return downloadEnd(src, false);
        }
        try {
            worker.downloadFile({
                url: src,
                success(res) {
                    if (res && res.statusCode === 200 && res.tempFilePath) {
                        localMap[src] = res.tempFilePath;
                        downloadEnd(src, true, res.tempFilePath);
                    } else {
                        downloadEnd(src, false);
                    }
                },
                fail(e) {
                    downloadEnd(src, false);
                },
            });
        } catch (e) {
            downloadEnd(src, false);
        }
    });
}

function applySrc(audio, audioId, fullSrc, localPathHint) {
    if (!fullSrc) return;
    // 优先用主线程下发的 hint（通常是 WXPreDownloadAudios 预下载的结果）
    if (localPathHint) {
        localMap[fullSrc] = localPathHint;
        audio.src = localPathHint;
        return;
    }
    if (localMap[fullSrc]) { audio.src = localMap[fullSrc]; return; }
    if (!audio.needDownload) { audio.src = fullSrc; return; }

    const meta = metas[audioId];
    if (meta) meta.isLoading = fullSrc;
    downloadOne(fullSrc).then((path) => {
        if (!audios[audioId]) return;
        audios[audioId].src = path;
        finishLoading(audioId);
    }).catch(() => {
        if (!audios[audioId]) return;
        audios[audioId].src = fullSrc;  // fallback 远程 URL
        finishLoading(audioId);
    });
}

function finishLoading(audioId) {
    const m = metas[audioId];
    if (!m) return;
    m.isLoading = undefined;
    if (m.pendingPlay && m.canplay) {
        m.pendingPlay = false;
        try { audios[audioId].play(); } catch (e) {}
    }
}

// [6] ----------------------------------------------------------
// Worker 不回传任何事件给主线程，所以：
//   - AUDIO_ADD_LISTENER / AUDIO_REMOVE_LISTENER 均 no-op
//   - 底层事件（onPlay/onEnded 等）Worker 不挂（除了 onCanplay / onEnded）

// [7] ----------------------------------------------------------
const Handlers = {
    [MSG.AUDIO_BATCH](payload) {
        if (!Array.isArray(payload)) return;
        for (let i = 0; i < payload.length; i++) {
            const item = payload[i];
            if (!item || typeof item.type !== 'number') continue;
            if (item.type === MSG.AUDIO_BATCH) continue;
            dispatch(item);
        }
    },
    [MSG.INIT_CONFIG](payload) {
        cfg = payload || {};
    },

    [MSG.AUDIO_CREATE](payload) {
        const { audioId, fullSrc, loop, startTime, autoplay, volume,
                playbackRate, needDownload, localPathHint } = payload || {};
        if (!audioId) return;
        const audio = createAudio(audioId);
        if (!audio) return;
        audio.needDownload = !!needDownload;
        if (fullSrc) applySrc(audio, audioId, fullSrc, localPathHint);
        if (loop) audio.loop = true;
        if (autoplay) audio.autoplay = true;
        if (startTime && startTime > 0) audio.startTime = startTime;

        let vol = (typeof volume === 'undefined') ? 1 : volume;
        origVol.set(audio, vol);
        if (isMute) vol = 0;
        if (vol !== 1) audio.volume = vol;
        if (typeof playbackRate !== 'undefined' && playbackRate !== 1) {
            try { audio.playbackRate = playbackRate; } catch (e) {}
        }
    },

    [MSG.AUDIO_SET_BOOL](payload) {
        const a = audios[payload && payload.audioId];
        if (!a) return;
        try { a[payload.k] = !!payload.v; } catch (e) {}
    },

    [MSG.AUDIO_SET_STRING](payload) {
        const { audioId, k, v, localPathHint } = payload || {};
        const a = audios[audioId];
        if (!a) return;
        if (k === 'src') applySrc(a, audioId, v, localPathHint);
        else if (k === 'needDownload') a.needDownload = !!v;
        else { try { a[k] = v; } catch (e) {} }
    },

    [MSG.AUDIO_SET_FLOAT](payload) {
        const { audioId, k, v } = payload || {};
        const a = audios[audioId];
        if (!a) return;
        let value = v;
        if (k === 'volume') {
            origVol.set(a, value);
            if (isMute) value = 0;
        }
        try { a[k] = value; } catch (e) {}
    },

    [MSG.AUDIO_PLAY](payload) {
        const a = audios[payload && payload.audioId];
        const m = metas[payload && payload.audioId];
        if (!a || !m) return;
        if (m.isLoading) {
            m.pendingPlay = true;
        } else if (m.canplay) {
            try { a.play(); } catch (e) {}
        } else {
            m.pendingPlay = true;
        }
    },
    [MSG.AUDIO_PAUSE](p) { const a = audios[p && p.audioId]; if (a) { try { a.pause(); } catch (e) {} } },
    [MSG.AUDIO_STOP](p)  { const a = audios[p && p.audioId]; if (a) { try { a.stop(); } catch (e) {} } },
    [MSG.AUDIO_SEEK](p)  {
        const a = audios[p && p.audioId];
        if (a) { try { a.seek(p.position); } catch (e) {} }
    },
    [MSG.AUDIO_DESTROY](p) { destroyAudio(p && p.audioId); },

    // Worker 不回传事件 → addListener / removeListener 无意义，静默忽略
    [MSG.AUDIO_ADD_LISTENER]()    {},
    [MSG.AUDIO_REMOVE_LISTENER]() {},

    [MSG.AUDIO_SET_MUTE](p) {
        const value = !!(p && p.value);
        if (isMute === value) return;
        isMute = value;
        Object.keys(audios).forEach((id) => {
            const a = audios[id];
            const orig = origVol.get(a);
            try { a.volume = value ? 0 : (typeof orig === 'number' ? orig : 1); } catch (e) {}
        });
    },
    [MSG.AUDIO_ON_HIDE]() {
        interruptList = {};
        Object.keys(audios).forEach((id) => {
            if (audios[id] && audios[id].paused === false) interruptList[id] = true;
        });
    },
    [MSG.AUDIO_ON_SHOW]() {
        Object.keys(audios).forEach((id) => {
            if (audios[id] && audios[id].paused !== false && interruptList[id]) {
                try { audios[id].play(); } catch (e) {}
            }
        });
        interruptList = {};
    },
    [MSG.AUDIO_INTERRUPTION](p) {
        const phase = p && p.phase;
        if (phase === 'begin') {
            Object.keys(audios).forEach((id) => {
                if (audios[id] && audios[id].paused === false) interruptList[id] = true;
            });
        } else if (phase === 'end') {
            Object.keys(audios).forEach((id) => {
                if (audios[id] && audios[id].paused !== false && interruptList[id]) {
                    try { audios[id].play(); } catch (e) {}
                }
            });
            interruptList = {};
        }
    },
};

function dispatch(cmd) {
    // 支持两种调用方式：dispatch({ type, payload }) 和 dispatch(initPayload) 用于 INIT_CONFIG
    let type, payload;
    if (typeof cmd === 'object' && typeof cmd.type === 'number') {
        type = cmd.type;
        payload = cmd.payload;
    } else {
        // INIT_CONFIG 直接传 payload 对象
        type = MSG.INIT_CONFIG;
        payload = cmd;
    }
    const fn = Handlers[type];
    if (fn) fn(payload);
}

// --- 初始化 ---
const channel = new WorkerChannel();
channel.initWorkerSide(dispatch);
