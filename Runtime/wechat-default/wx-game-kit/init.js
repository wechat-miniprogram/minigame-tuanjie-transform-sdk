GameGlobal.WebAssembly = GameGlobal.WXWebAssembly;
GameGlobal.disableMultiTouch = $DISABLE_MULTI_TOUCH;
// 提前监听错误并打日志
function bindGloblException() {
  // 默认上报小游戏实时日志与用户反馈日志(所有error日志+小程序框架异常)
  wx.onError((result) => {
    // 若manager已初始化，则直接用manager打日志即可
    if (WXGameKit?.reporter) {
      WXGameKit.reporter.printErr(result.message);
    }
    else {
      GameGlobal.WXGameKit.Logger.realtimeLogManager.error(result);
      const isErrorObj = result && result.stack;
      GameGlobal.WXGameKit.Logger.logManager.warn(isErrorObj ? result.stack : result);
      console.error('onError:', result);
    }
  });
  wx.onUnhandledRejection((result) => {
    GameGlobal.WXGameKit.Logger.realtimeLogManager.error(result);
    const isErrorObj = result && result.reason && result.reason.stack;
    GameGlobal.WXGameKit.Logger.logManager.warn(isErrorObj ? result.reason.stack : result.reason);
    console.error('unhandledRejection:', result.reason);
  });
  // 上报初始信息
  function printSystemInfo(appBaseInfo, deviceInfo) {
    const bootinfo = {
      renderer: GameGlobal.isIOSHighPerformanceMode ? 'h5' : '',
      isH5Plus: GameGlobal.isIOSHighPerformanceModePlus || false,
      abi: deviceInfo.abi || '',
      brand: deviceInfo.brand,
      model: deviceInfo.model,
      platform: deviceInfo.platform,
      system: deviceInfo.system,
      version: appBaseInfo.version,
      SDKVersion: appBaseInfo.SDKVersion,
      benchmarkLevel: deviceInfo.benchmarkLevel,
    };
    GameGlobal.WXGameKit.Logger.realtimeLogManager.info('game starting', bootinfo);
    GameGlobal.WXGameKit.Logger.logManager.info('game starting', bootinfo);
    console.info('game starting', bootinfo);
  }
  const appBaseInfo = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
  const deviceInfo = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();
  printSystemInfo(appBaseInfo, deviceInfo);
}
bindGloblException();
