import moduleHelper from './module-helper';
import { formatJsonStr, getListObject, uid } from './utils';
const videoList = {};
const getObject = getListObject(videoList, 'video');
export default {
    WXCreateVideo(conf) {
        const id = uid();
        const params = formatJsonStr(conf);
        
        
        
        
        videoList[id] = wx.createVideo(params);
        return id;
    },
    WXVideoSetProperty(id, key, value) {
        console.log('WXVideoSetProperty', id, key, value);
        const obj = getObject(id);
        console.log('obj', obj);
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
            obj[key] = value === 'true';
        }
    },
    WXVideoAddListener(id, key) {
        getObject(id)?.[key]((e) => {
            moduleHelper.send('OnVideoCallback', JSON.stringify({
                callbackId: id,
                type: key,
                position: e && e.position,
                buffered: e && e.buffered,
                duration: e && e.duration,
                errMsg: e && e.errMsg,
            }));
            if (key === 'onError') {
                
                console.error(e);
            }
        });
    },
    WXVideoRemoveListener(id, key) {
        getObject(id)?.[key]();
    },
    WXVideoDestroy(id) {
        getObject(id)?.destroy();
        
        
        
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
