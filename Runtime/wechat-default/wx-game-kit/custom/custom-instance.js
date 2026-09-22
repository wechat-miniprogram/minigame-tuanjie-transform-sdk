Object.assign(WXGameKit.gameInstance, {
  isDevelopmentBuild: $Is_Development_Build,
  isProfilingBuild: $Is_Profiling_Build,
  ttlAssetBundle: 5,
  enableProfileStats: $ENABLE_PROFILE_STATS,
  iOSAutoGCInterval: $IOS_AUTO_GC_INTERVAL,
  textureParallelBundle: false,
  textureBundles: '',
  needCacheTextures: $NEED_CACHE_TEXTURES, // 纹理缓存总开关，默认取 Unity 面板配置
  enableWebSocketDebugLog: false,  // WebSocket 调试日志开关
  enableSocketDebugLog: false,     // TCP/UDP Socket 调试日志开关
  mainLoopMinDelay: 0,             // 主循环最小延迟(ms)，用于给JS回调事件留出处理时间
  forceReleaseCacheOnTimeout: false // 开启后Android等平台的缓存淘汰策略与iOS保持一致
});
