// UnityAudio对象池
export const WEBAudio = {
    audioInstanceIdCounter: 0,
    audioInstances: {},
    audioContext: null,
    audioWebEnabled: 0,
    audioCache: [],
    lOrientation: {
        x: 0,
        y: 0,
        z: 0,
        xUp: 0,
        yUp: 0,
        zUp: 0,
    },
    lPosition: { x: 0, y: 0, z: 0 },
    audio3DSupport: 0,
    audioWebSupport: 0,
    bufferSourceNodeLength: 0,
    audioBufferLength: 0,
    isMute: false,
    FAKEMOD_SAMPLERATE: 44100, // 模拟采样率
};
// innerAudio对象池
export const audios = {};
// 当前生命周期内的临时音频路径
export const localAudioMap = {};
// 正在下载中的音频
export const downloadingAudioMap = {};
// 缓存音量设置
export const unityAudioVolume = new WeakMap();
// innerAudio缓存音量设置
export const innerAudioVolume = new WeakMap();
