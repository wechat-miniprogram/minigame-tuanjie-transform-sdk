import moduleHelper from './module-helper';
import { setArrayBuffer, uid } from './utils';


function getWebGPUCaptureFrame() {
  const targetCanvas = canvas
    || (typeof GameGlobal !== 'undefined' && GameGlobal.canvas)
    || (typeof window !== 'undefined' && window.canvas);
  if (!targetCanvas) {
    return null;
  }
  
  const el = targetCanvas.offscreenCanvas || targetCanvas;
  let ctx = null;
  try {
    ctx = el.getContext('webgpu');
  } catch (e) {
    return null;
  }
  if (!ctx) {
    return null;
  }
  const api = ctx.webgpu || ctx;
  if (!api || typeof api.captureFrame !== 'function') {
    return null;
  }
  return api.captureFrame.bind(api);
}

export default {
  WXReportGameStart() {
    WXGameKit.reporter.reportCustomLaunchInfo();
  },
  WXReportGameSceneError(sceneId, errorType, errStr, extInfo) {
    if (WXGameKit.reporter && WXGameKit.reporter.reportGameSceneError) {
      WXGameKit.reporter.reportGameSceneError(sceneId, errorType, errStr, extInfo);
    }
  },
  WXWriteLog(str) {
    if (WXGameKit.Logger && WXGameKit.Logger.writeLog) {
      WXGameKit.Logger.writeLog(str);
    }
  },
  WXWriteWarn(str) {
    if (WXGameKit.Logger && WXGameKit.Logger.writeWarn) {
      WXGameKit.Logger.writeWarn(str);
    }
  },
  WXHideLoadingPage() {
    if (WXGameKit.splash && WXGameKit.splash.loadingPage.hide) {
      WXGameKit.splash.loadingPage.hide();
    }
  },
  WXReportUserBehaviorBranchAnalytics(branchId, branchDim, eventType) {
    wx.reportUserBehaviorBranchAnalytics({ branchId, branchDim, eventType });
  },
  WXPreloadConcurrent(count) {
    if (WXGameKit.network.preload && WXGameKit.network.preload.setMaxConcurrent) {
      WXGameKit.network.preload.setMaxConcurrent(count);
    }
  },
  WXIsCloudTest() {
    if (typeof GameGlobal.isTest !== 'undefined' && GameGlobal.isTest) {
      return true;
    }
    return false;
  },
  WXUncaughtException(needAbort) {
    function currentStackTrace() {
      const err = new Error('WXUncaughtException');
      return err;
    }
    const err = currentStackTrace();
    let fullTrace = err.stack?.toString();
    if (fullTrace) {
      const posOfThisFunc = fullTrace.indexOf('WXUncaughtException');
      if (posOfThisFunc !== -1) {
        fullTrace = fullTrace.substr(posOfThisFunc);
      }
      const posOfRaf = fullTrace.lastIndexOf('browserIterationFunc');
      if (posOfRaf !== -1) {
        fullTrace = fullTrace.substr(0, posOfRaf);
      }
    }
    GameGlobal.WXGameKit.Logger.realtimeLogManager.error(fullTrace);
    GameGlobal.WXGameKit.Logger.logManager.warn(fullTrace);
    if (needAbort === true) {
      WXGameKit.status.onCrash();
      throw err;
    }
    else {
      setTimeout(() => {
        throw err;
      }, 0);
    }
  },
  WXCleanAllFileCache() {
    if (WXGameKit.fs && WXGameKit.fs.cleanAllCache) {
      const key = uid();
      WXGameKit.fs.cleanAllCache().then((res) => {
        moduleHelper.send('CleanAllFileCacheCallback', JSON.stringify({
          callbackId: key,
          result: res,
        }));
      });
      return key;
    }
    return '';
  },
  WXCleanFileCache(fileSize) {
    if (WXGameKit.fs && WXGameKit.fs.cleanCache) {
      const key = uid();
      WXGameKit.fs.cleanCache(fileSize).then((res) => {
        moduleHelper.send('CleanFileCacheCallback', JSON.stringify({
          callbackId: key,
          result: res,
        }));
      });
      return key;
    }
    return '';
  },
  WXRemoveFile(path) {
    if (WXGameKit.fs && WXGameKit.fs.removeFile && path) {
      const key = uid();
      WXGameKit.fs.removeFile(path).then((res) => {
        moduleHelper.send('RemoveFileCallback', JSON.stringify({
          callbackId: key,
          result: res,
        }));
      });
      return key;
    }
    return '';
  },
  WXGetCachePath(url) {
    if (WXGameKit.fs && WXGameKit.fs.getCachePath) {
      return WXGameKit.fs.getCachePath(url);
    }
  },
  WXGetPluginCachePath() {
    if (WXGameKit.fs && WXGameKit.fs.pluginCachePath) {
      return WXGameKit.fs.pluginCachePath;
    }
  },
  WXOnLaunchProgress() {
    if (WXGameKit.lifeCycle && WXGameKit.lifeCycle.on) {
      const key = uid();
      // 异步执行，保证C#已经记录这个回调ID
      setTimeout(() => {
        WXGameKit.lifeCycle.on((e) => {
          moduleHelper.send('OnLaunchProgressCallback', JSON.stringify({
            callbackId: key,
            res: JSON.stringify(Object.assign({}, e.data, {
              type: e.type,
            })),
          }));

          if (e.type === launchEventType.prepareGame) {
            moduleHelper.send('RemoveLaunchProgressCallback', JSON.stringify({
              callbackId: key,
            }));
          }
        });
      }, 0);
      return key;
    }
    return '';
  },
  WXSetDataCDN(path) {
    if (WXGameKit.network && WXGameKit.network.setDataCDN) {
      WXGameKit.network.setDataCDN(path);
    }
  },
  WXSetPreloadList(paths) {
    if (WXGameKit.network && WXGameKit.network.setPreloadList) {
      const list = (paths || '').split(',').filter(str => !!str && !!str.trim());
      WXGameKit.network.setPreloadList(list);
    }
  },
  WXSetArrayBuffer(buffer, offset, callbackId) {
    setArrayBuffer(buffer, offset, callbackId);
  },
  WXLaunchOperaBridge(args) {
    const res = WXGameKit.splash.launchOpera.emit('launchOperaMsgBridgeFromWasm', args);
    if (Array.isArray(res) && res.length > 0) {
      return res[0];
    }
    return null;
  },
  WXLaunchOperaBridgeToC(callback, args) {
    moduleHelper.send('WXLaunchOperaBridgeToC', JSON.stringify({
      callback,
      args,
    }));
  },
  WX_SetPreferredFramesPerSecond(fps) {
    wx.setPreferredFramesPerSecond(fps);
  },
  
  WXSetSyncReadCacheEnabled(enabled) {
    if (WXGameKit && WXGameKit.fs && WXGameKit.fs.setSyncReadCacheEnabled) {
      WXGameKit.fs.setSyncReadCacheEnabled(!!enabled);
    }
  },
    WX_CaptureWebGPUFrame(gameObjectName, methodName, timeoutMs) {
    const send = (path) => {
      if (!gameObjectName || !methodName) {
        return;
      }
      const sendMessage = WXGameKit.loader && WXGameKit.loader.module && WXGameKit.loader.module.SendMessage;
      if (sendMessage) {
        sendMessage(gameObjectName, methodName, path || '');
      }
    };
    const captureFrame = getWebGPUCaptureFrame();
    if (!captureFrame) {
      console.warn('[WX WebGPU] CaptureWebGPUFrame 不可用：当前不存在可用的 WebGPU 上下文');
      send('');
      return Promise.resolve('');
    }
    return Promise.resolve()
      .then(() => captureFrame(timeoutMs && timeoutMs > 0 ? timeoutMs : undefined))
      .then((path) => {
        send(path);
        return path || '';
      })
      .catch((err) => {
        console.warn('[WX WebGPU] CaptureWebGPUFrame 失败:', err);
        send('');
        return '';
      });
  },
};
