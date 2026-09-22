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
  WXVideoPlay(id) {
    const obj = getObject(id);
    if (!obj) {
      return;
    }
    obj.play();
  },
  WXVideoAddListener(id, key) {
    const obj = getObject(id);
    if (!obj) {
      return;
    }
    obj[key]((e) => {
      
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
  WXVideoDestroy(id, isLast) {
    const obj = getObject(id);
    if (!obj) {
      return;
    }
    obj.destroy();
    
    if (isLast) {
      GameGlobal.enableTransparentCanvas = false;
    }
  },
  WXVideoExitFullScreen(id) {
    const obj = getObject(id);
    if (!obj) {
      return;
    }
    obj.exitFullScreen();
  },
  WXVideoPause(id) {
    const obj = getObject(id);
    if (!obj) {
      return;
    }
    obj.pause();
  },
  WXVideoRequestFullScreen(id, direction) {
    const obj = getObject(id);
    if (!obj) {
      return;
    }
    obj.requestFullScreen(direction);
  },
  WXVideoSeek(id, time) {
    const obj = getObject(id);
    if (!obj) {
      return;
    }
    obj.seek(time);
  },
  WXVideoStop(id) {
    const obj = getObject(id);
    if (!obj) {
      return;
    }
    obj.stop();
  },
  WXVideoRemoveListener(id, key) {
    const obj = getObject(id);
    if (!obj) {
      return;
    }
    obj[key]();
  },
};
