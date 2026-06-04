
import { WEBAudio, audios, unityAudioVolume, innerAudioVolume } from './store';
import { resumeWebAudio, mkCacheDir } from './utils';
import { MSG, channel, workerAudios, isWorkerReady } from './inner-audio-worker';

mkCacheDir();
export default {
        WXGetAudioCount() {
        return {
            innerAudio: Object.keys(audios).length + Object.keys(workerAudios).length,
            webAudio: WEBAudio.bufferSourceNodeLength,
            buffer: WEBAudio.audioBufferLength,
        };
    },
        WXSetAudioMute(value) {
        if (typeof value !== 'boolean') {
            return;
        }
        if (WEBAudio.isMute === value) {
            return;
        }
        WEBAudio.isMute = value;
        
        for (const channelInstance of Object.keys(WEBAudio.audioInstances)) {
            const channelInst = WEBAudio.audioInstances[+channelInstance];
            if (channelInst.source) {
                channelInst.setVolume?.(value ? 0 : unityAudioVolume.get(channelInst) ?? 1);
            }
        }
        
        for (const innerAudio of Object.values(audios)) {
            innerAudio.volume = value ? 0 : innerAudioVolume.get(innerAudio) ?? 1;
        }
        
        if (isWorkerReady()) {
            channel.postQueued(MSG.AUDIO_SET_MUTE, { value });
        }
    },
};

const HandleInterruption = {
    init() {
        let INTERRUPT_LIST = {};
        wx.onHide(() => {
            
            Object.keys(audios).forEach((key) => {
                if (!audios[key].paused !== false) {
                    INTERRUPT_LIST[key] = true;
                }
            });
            
            Object.keys(workerAudios).forEach((key) => {
                if (workerAudios[key] && !workerAudios[key].paused) {
                    INTERRUPT_LIST[key] = true;
                }
            });
            if (isWorkerReady())
                channel.postQueued(MSG.AUDIO_ON_HIDE, {});
        });
        wx.onShow(() => {
            Object.keys(audios).forEach((key) => {
                if (audios[key].paused !== false && INTERRUPT_LIST[key]) {
                    audios[key].play();
                }
            });
            INTERRUPT_LIST = {};
            if (isWorkerReady())
                channel.postQueued(MSG.AUDIO_ON_SHOW, {});
        });
        wx.onAudioInterruptionBegin(() => {
            Object.keys(audios).forEach((key) => {
                if (!audios[key].paused !== false) {
                    INTERRUPT_LIST[key] = true;
                }
            });
            Object.keys(workerAudios).forEach((key) => {
                if (workerAudios[key] && !workerAudios[key].paused) {
                    INTERRUPT_LIST[key] = true;
                }
            });
            if (isWorkerReady())
                channel.postQueued(MSG.AUDIO_INTERRUPTION, { phase: 'begin' });
        });
        wx.onAudioInterruptionEnd(() => {
            Object.keys(audios).forEach((key) => {
                if (audios[key].paused !== false && INTERRUPT_LIST[key]) {
                    audios[key].play();
                }
            });
            INTERRUPT_LIST = {};
            resumeWebAudio();
            if (isWorkerReady())
                channel.postQueued(MSG.AUDIO_INTERRUPTION, { phase: 'end' });
        });
    },
};
HandleInterruption.init();
