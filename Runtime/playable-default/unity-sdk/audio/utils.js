import { uid } from '../utils';
import { isSupportCacheAudio } from '../../check-version';
import { WEBAudio, audios } from './store';
import { TEMP_DIR_PATH } from './const';
/**
 * 重新播放WebAudio（当被广告/电话等场景强制中断音频时调用）
 */
export const resumeWebAudio = () => {
    // if (
    //   WEBAudio.audioContext
    //   && (WEBAudio.audioContext.state === 'suspended' || WEBAudio.audioContext.state === 'interrupted')
    // ) {
    //   WEBAudio.audioContext.resume();
    // }
    WEBAudio.audioContext?.resume();
};
/**
 * 创建innerAudio音频
 * 如果有使用缓存，则优先使用缓存的音频对象
 */
export const createInnerAudio = () => {
    const id = uid();
    const audio = (isSupportCacheAudio && WEBAudio.audioCache.length ? WEBAudio.audioCache.shift() : wx.createInnerAudioContext());
    if (audio) {
        audios[id] = audio;
    }
    return {
        id,
        audio,
    };
};
/**
 * 销毁innerAudio音频
 * 如果有使用缓存，则只重置不销毁
 * useCache目前有非常多的问题，暂时不使用
 */
export const destroyInnerAudio = (id, useCache) => {
    if (!id) {
        return;
    }
    if (!useCache || !isSupportCacheAudio || WEBAudio.audioCache.length > 32) {
        audios[id].destroy();
    }
    else {
        // 重置innerAudio，复用对象
        ['Play', 'Pause', 'Stop', 'Canplay', 'Error', 'Ended', 'Waiting', 'Seeking', 'Seeked', 'TimeUpdate'].forEach((eventName) => {
            audios[id][`off${eventName}`]();
        });
        const state = {
            startTime: 0,
            obeyMuteSwitch: true,
            volume: 1,
            autoplay: false,
            loop: false,
            referrerPolicy: '',
        };
        Object.keys(state).forEach((key) => {
            try {
                // 重置属性，此处忽略检查
                // @ts-ignore
                audios[id][key] = state[key];
            }
            catch (e) { }
        });
        audios[id].stop();
        const cacheAudio = audios[id];
        // 由于innerAudio调用自带延迟，所以需要等stop等调用完再放回缓存
        setTimeout(() => {
            // 放回缓存
            WEBAudio.audioCache.push(cacheAudio);
        }, 1000);
    }
    delete audios[id];
};
/**
 * 打印报错并写入到客户端日志
 */
export const printErrMsg = (msg) => {
    GameGlobal.manager.printErr(msg);
};
/**
 * 重置音频本地缓存文件夹
 */
export function mkCacheDir() {
    const fs = wx.getFileSystemManager();
    fs.rmdir({
        dirPath: TEMP_DIR_PATH,
        recursive: true,
        complete: () => {
            fs.mkdir({
                dirPath: TEMP_DIR_PATH,
            });
        },
    });
}
