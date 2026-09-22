import { preloadWxCommonFont } from '../index';

// ============================================================================
// 模块预载完成后的操作
// ============================================================================
WXGameKit.lifeCycle.on(WXGameKit.lifeCycle.event.PreparedModule, (e) => {
  preloadWxCommonFont();
});

// ============================================================================
// iOS高性能模式定期GC
// ============================================================================
if (GameGlobal.canUseiOSAutoGC && WXGameKit.gameInstance.iOSAutoGCInterval !== 0) {
  setInterval(() => {
    wx.triggerGC();
  }, WXGameKit.gameInstance.iOSAutoGCInterval);
}

// ============================================================================
// 启动流程生命周期钩子
// ----------------------------------------------------------------------------
// 每个事件回调参数 e 为 EventOptions：
//   { costTimeMs: 阶段耗时, runTimeMs: 总耗时, type: 'IntervalStart'|'IntervalEnd'|'Point' }
// 事件枚举全集见 WXGameKit.lifeCycle.event
//   - PluginLaunch     插件启动（点事件）        对应老 launchEventType.launchPlugin
//   - LoadingPageReady 启动页ready完成（点事件）  新增
//   - LoadWasm         wasm下载区间                对应老 launchEventType.loadWasm
//   - InstantiateWasm  wasm编译区间                对应老 launchEventType.compileWasm
//   - PrepareAsset     首资源包总区间              新增（含 LoadAsset+ReadAsset+UnzipAsset）
//   - LoadAsset        首资源包下载区间            对应老 launchEventType.loadAssets
//   - ReadAsset        首资源包读取区间            对应老 launchEventType.readAssets
//   - UnzipAsset       首资源包解压区间            新增
//   - ProcessedAsset   处理首资源包完成的点        新增
//   - PreparedModule   Module 配置完成的点        新增
//   - CallMain         callmain 区间               对应老 launchEventType.prepareGame
// 如需业务埋点/进度上报，取消对应回调注释后添加逻辑。
// ============================================================================
// eslint-disable-next-line no-unused-vars
WXGameKit.lifeCycle.on(WXGameKit.lifeCycle.event.PluginLaunch, (e) => {
  // TODO: 插件启动埋点
});
// eslint-disable-next-line no-unused-vars
WXGameKit.lifeCycle.on(WXGameKit.lifeCycle.event.LoadWasm, (e) => {
  // TODO: wasm 下载埋点（IntervalStart / IntervalEnd 各触发一次）
});
// eslint-disable-next-line no-unused-vars
WXGameKit.lifeCycle.on(WXGameKit.lifeCycle.event.InstantiateWasm, (e) => {
  // TODO: wasm 编译埋点
});
// eslint-disable-next-line no-unused-vars
WXGameKit.lifeCycle.on(WXGameKit.lifeCycle.event.LoadAsset, (e) => {
  // TODO: 首资源包下载埋点
});
// eslint-disable-next-line no-unused-vars
WXGameKit.lifeCycle.on(WXGameKit.lifeCycle.event.ReadAsset, (e) => {
  // TODO: 首资源包读取埋点
});
// eslint-disable-next-line no-unused-vars
WXGameKit.lifeCycle.on(WXGameKit.lifeCycle.event.CallMain, (e) => {
  // TODO: callmain 阶段埋点
});

// 插件捕获到引擎错误后，会通过此事件抛给游戏（对齐老版 gameManager.onLogError）
// eslint-disable-next-line no-unused-vars
WXGameKit.reporter.onLogError = (err) => {
  // TODO: 业务侧的错误上报/告警逻辑，例如：
  GameGlobal.WXGameKit.Logger.realtimeLogManager.error(err);
  const isErrorObj = err && err.stack;
  GameGlobal.WXGameKit.Logger.logManager.warn(isErrorObj ? err.stack : err);
};
