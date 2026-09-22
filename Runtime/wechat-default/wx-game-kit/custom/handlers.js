WXGameKit.fs.setAssetCacheableHandler((path) => {
  const cacheableFileIdentifier = [$BUNDLE_PATH_IDENTIFIER];
  const excludeFileIdentifier = [$EXCLUDE_FILE_EXTENSIONS];
  if (cacheableFileIdentifier.some(identifier => path.includes(identifier)
    && excludeFileIdentifier.every(excludeIdentifier => !path.includes(excludeIdentifier)))) {
    return true;
  }
  return false;
});
WXGameKit.fs.setErasableHandler((info) => {
  /* 业务自定义规则在下面添加!!! */
  // 用于特定AssetBundle的缓存保持
  if (typeof info === 'string') {
    if (WXGameKit.fs.isWXAssetBundle(info)) {
      return false;
    }
  }
  else {
    if (WXGameKit.fs.isWXAssetBundle(info.path)) {
      return false;
    }
  }
  // 达到缓存上限时，不会被自动清理的文件
  const inErasableIdentifier = [];
  if (inErasableIdentifier.some(identifier => info.path.includes(identifier))) {
    return false;
  }
  return true;
});
WXGameKit.status.setOnCrashHandler(() => {
  WXGameKit.status.showAbort();
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  wx.createFeedbackButton({
    type: 'text',
    text: '提交反馈',
    style: {
      left: (windowInfo.screenWidth - 184) / 2,
      top: windowInfo.screenHeight / 3 + 140,
      width: 184,
      height: 40,
      lineHeight: 40,
      backgroundColor: '#07C160',
      color: '#ffffff',
      textAlign: 'center',
      fontSize: 16,
      borderRadius: 4,
    },
  });
});
WXGameKit.fs.setWXAssetBundleHandler((path) => {
  return WXGameKit.fs.wxAssetBundles.has(WXGameKit.fs.pathInFileOS(path));
});
WXGameKit.fs.setTextureCacheableHandler((path) => {
  // 控制纹理是否缓存到本地，如需按路径细化控制（例如仅特定目录纹理缓存），可在此扩展 path 判断逻辑
  return !!WXGameKit.gameInstance.needCacheTextures;
});
