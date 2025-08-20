import moduleHelper from './module-helper';
import { formatJsonStr, getListObject, uid } from './utils';
const videoList = {};
const getObject = getListObject(videoList, 'video');
export default {
    WXCreateVideo(conf) {
        const id = uid();
        const params = formatJsonStr(conf);
        
        if (params.underGameView) {
            GameGlobal.enableTransparentCanvas = true;
        }
        videoList[id] = wx.createVideo(params);
        return id;
    },
    WXVideoSetProperty(id, key, value) {
        const obj = getObject(id);
        if (!obj) {
            return;
        }
        if (key === 'x' || key === 'y' || key === 'width' || key === 'height' || key === 'initialTime' || key === 'playbackRate') {
            obj[key] = +value;
        }
        else if (key === 'src' || key === 'poster' || key === 'objectFit' || key === 'backgroundColor') {
            obj[key] = value;
        }
        else if (key === 'live' || key === 'controls' || key === 'showProgress' || key === 'showProgressInControlMode'
            || key === 'autoplay' || key === 'loop' || key === 'muted' || key === 'obeyMuteSwitch'
            || key === 'enableProgressGesture' || key === 'enablePlayGesture' || key === 'showCenterPlayBtn') {
            obj[key] = value === 'True';
        }
    },
    WXVideoAddListener(id, key) {
        getObject(id)?.[key]((e) => {
            moduleHelper.send('OnVideoCallback', JSON.stringify({
                callbackId: id,
                type: key,
                position: e?.position,
                buffered: e?.buffered ? Number(e.buffered) : undefined,
                duration: e?.duration,
                errMsg: e?.errMsg,
            }));
            if (key === 'onError') {
                GameGlobal.enableTransparentCanvas = false;
                console.error(e);
            }
        });
    },
    WXVideoRemoveListener(id, key) {
        getObject(id)?.[key]();
    },
    WXVideoDestroy(id, isLast) {
        getObject(id)?.destroy();
        if (isLast) {
            GameGlobal.enableTransparentCanvas = false;
        }
    },
    WXVideoPlay(id) {
        getObject(id)?.play();
    },
    WXVideoPause(id) {
        getObject(id)?.pause();
    },
    WXVideoStop(id) {
        getObject(id)?.stop();
    },
    WXVideoSeek(id, time) {
        getObject(id)?.seek(time);
    },
    WXVideoRequestFullScreen(id, direction) {
        getObject(id)?.requestFullScreen(direction);
    },
    WXVideoExitFullScreen(id) {
        getObject(id)?.exitFullScreen();
    },
};
