mergeInto(LibraryManager.library, {

  JSInitProfiler: function (savePathPtr, metaInfoPtr) {
    const savePath = UTF8ToString(savePathPtr);
    // const uploadUrl = UTF8ToString(uploadUrlPtr);
    const metaInfo = UTF8ToString(metaInfoPtr);
    if (GameGlobal.WXGameKit && GameGlobal.WXGameKit.debug && GameGlobal.WXGameKit.debug.profiler && GameGlobal.WXGameKit.debug.profiler.initProfiler) {
      // 新架构配置系统未保留 PROFILER_UPLOAD_URL，传空串由 Profiler 内部使用默认值
      const uploadUrl = '';
      GameGlobal.WXGameKit.debug.profiler.initProfiler({ 'savePath': savePath, 'uploadUrl': uploadUrl, 'meta': metaInfo, 'cb': _JSInitProfilerCallback, 'errorCb': _JSProfilerErrorCallback });
    }
  },
  JSStartProfiler: function () {
    //const savePath = UTF8ToString(savePathPtr);
    //const uploadUrl = UTF8ToString(uploadUrlPtr);
    //const metaInfo = UTF8ToString(metaInfoPtr);
    if (GameGlobal.WXGameKit && GameGlobal.WXGameKit.debug && GameGlobal.WXGameKit.debug.profiler && GameGlobal.WXGameKit.debug.profiler.startProfile) {
      GameGlobal.WXGameKit.debug.profiler.startProfile();
    }
  },
  StartJSProfilerRecord: function (frameId, interval, savePathPtr) {
    const savePath = UTF8ToString(savePathPtr);
    if (GameGlobal && GameGlobal.WXGameKit && GameGlobal.WXGameKit.gameInstance && GameGlobal.WXGameKit.gameInstance.ProfileWebgl && GameGlobal.WXGameKit.gameInstance.ProfileWebgl.startRecord) {
      GameGlobal.WXGameKit.gameInstance.ProfileWebgl.startRecord(frameId, interval, savePath);
    }
  },
  StopJSProfilerRecord: function () {
    if (GameGlobal && GameGlobal.WXGameKit && GameGlobal.WXGameKit.gameInstance && GameGlobal.WXGameKit.gameInstance.ProfileWebgl && GameGlobal.WXGameKit.gameInstance.ProfileWebgl.stopRecord) {
      GameGlobal.WXGameKit.gameInstance.ProfileWebgl.stopRecord();
    }
  },
  JSProfilerUploadBinary: function (dataPtr, bufSize, namePtr, dirPtr, id, inStartFrameIdx, inEndFrameIdx) {
    if (GameGlobal.WXGameKit && GameGlobal.WXGameKit.debug && GameGlobal.WXGameKit.debug.profiler && GameGlobal.WXGameKit.debug.profiler.uploadBinary) {
      const name = UTF8ToString(namePtr);
      const dir = UTF8ToString(dirPtr);
      const content = HEAPU8.slice(dataPtr, dataPtr + bufSize);
      GameGlobal.WXGameKit.debug.profiler.uploadBinary({
        'data': content,
        'len': bufSize,
        'fileName': name,
        'uploadDir': dir,
        'id': id,
        'startFrameIndex': inStartFrameIdx,
        'endFrameIndex': inEndFrameIdx
      });
    }
  },
  JSProfilerUploadString: function (dataPtr, bufSize, namePtr, dirPtr, id, inStartFrameIdx, inEndFrameIdx) {
    if (GameGlobal.WXGameKit && GameGlobal.WXGameKit.debug && GameGlobal.WXGameKit.debug.profiler && GameGlobal.WXGameKit.debug.profiler.uploadString) {
      const name = UTF8ToString(namePtr);
      const dir = UTF8ToString(dirPtr);
      const content = UTF8ToString(dataPtr);
      GameGlobal.WXGameKit.debug.profiler.uploadString({ 'str': content, 'len': bufSize, 'fileName': name, 'uploadDir': dir, 'id': id, 'cb': _JSPerfUploadStringCallback, 'startFrameIdx': inStartFrameIdx, 'endFrameIdx': inEndFrameIdx });
    }
  },
  JSProfilerUploadAnnotation: function (inAnnotationDataPtr, inFrameIdx) {
    const annotationData = UTF8ToString(inAnnotationDataPtr);
    if (GameGlobal.WXGameKit && GameGlobal.WXGameKit.debug && GameGlobal.WXGameKit.debug.profiler && GameGlobal.WXGameKit.debug.profiler.uploadAnnotation) {
      GameGlobal.WXGameKit.debug.profiler.uploadAnnotation({ 'annotationData': annotationData, 'annotationFrameIDX': inFrameIdx });
    }
  },
  JSGetMetaDataInfo: function () {
    var convertPluginVersion = (GameGlobal.WXGameKit && GameGlobal.WXGameKit.config && GameGlobal.WXGameKit.config.project) ? GameGlobal.WXGameKit.config.project.convertPluginVersion : '';
    var unityHeapReservedMemory = (GameGlobal.WXGameKit && GameGlobal.WXGameKit.config && GameGlobal.WXGameKit.config.unity) ? GameGlobal.WXGameKit.config.unity.unityHeapReservedMemory : 0;
    var contextType = (GameGlobal.WXGameKit && GameGlobal.WXGameKit.config && GameGlobal.WXGameKit.config.runtime && GameGlobal.WXGameKit.config.runtime.contextConfig) ? GameGlobal.WXGameKit.config.runtime.contextConfig.contextType : 0;
    var webglVersion;

    switch (contextType) {
      case 1:
        webglVersion = "webgl1";
        break;
      case 2:
        webglVersion = "webgl2";
        break;
      case 3:
        webglVersion = "auto";
        break;
      default:
        webglVersion = "unknown";
    }

    var metaDataString = "convertPluginVersion="
      + convertPluginVersion + "\nwebglVersion=" + webglVersion +
      "\nunityHeapReservedMemory=" + unityHeapReservedMemory + "\ndpr=" +
      window.devicePixelRatio + "\n";
    var lengthBytes = lengthBytesUTF8(metaDataString) + 1;
    var stringOnWasmHeap = _malloc(lengthBytes);
    stringToUTF8(metaDataString, stringOnWasmHeap, lengthBytes);

    return stringOnWasmHeap;
  },

  JSFreeIntPtr: function (ptr) {
    _free(ptr);
  },
  JSProfilerUploadStringWithDir: function (dataPtr, bufSize, namePtr, dirPtr) {
    if (GameGlobal.WXGameKit && GameGlobal.WXGameKit.debug && GameGlobal.WXGameKit.debug.profiler && GameGlobal.WXGameKit.debug.profiler.uploadStringWithDir) {
      const name = UTF8ToString(namePtr);
      const dir = UTF8ToString(dirPtr);
      const content = UTF8ToString(dataPtr);
      GameGlobal.WXGameKit.debug.profiler.uploadStringWithDir({ 'str': content, 'len': bufSize, 'fileName': name, 'uploadDir': dir, 'cb': _JSProfilerUploadStringWithDirCallback });
    }
  },

  JSExportFromIDBFS: function (idbfsPath, targetPath, snapshotFileName, frameIdx) {
    const idbfsPathStr = UTF8ToString(idbfsPath);
    const targetPathStr = UTF8ToString(targetPath);
    const fileName = UTF8ToString(snapshotFileName);
    if (GameGlobal.WXGameKit && GameGlobal.WXGameKit.debug && GameGlobal.WXGameKit.debug.profiler && GameGlobal.WXGameKit.debug.profiler.uploadSnapshotBuffer) {
      GameGlobal.WXGameKit.debug.profiler.uploadSnapshotBuffer({
        'fileName': fileName,
        'uploadSnapshotPath': targetPathStr,
        'frameIdx': frameIdx,
        'idbfsPathStr': idbfsPathStr,
        'targetPathStr': targetPathStr
      })
    }
  },

  JSGetDPR: function () {
    return window.devicePixelRatio;
  },

  JSGetConvertPluginVersion: function () {
    var convertPluginVersion = (GameGlobal.WXGameKit && GameGlobal.WXGameKit.config && GameGlobal.WXGameKit.config.project) ? GameGlobal.WXGameKit.config.project.convertPluginVersion : '';
    var lengthBytes = lengthBytesUTF8(convertPluginVersion) + 1;
    var stringOnWasmHeap = _malloc(lengthBytes);
    stringToUTF8(convertPluginVersion, stringOnWasmHeap, lengthBytes);

    return stringOnWasmHeap;
  },

  JSProfilerCanvasToFilepathSync: function (savePath) {
    if (GameGlobal && GameGlobal.WXGameKit && GameGlobal.WXGameKit.gameInstance && GameGlobal.WXGameKit.gameInstance.ProfileWebgl && GameGlobal.WXGameKit.gameInstance.ProfileWebgl.stopRecord) {
      const savePathJSStr = UTF8ToString(savePath);
      if (GameGlobal.WXGameKit.debug && GameGlobal.WXGameKit.debug.profiler && GameGlobal.WXGameKit.debug.profiler.canvasToFilepathSync) {
        GameGlobal.WXGameKit.debug.profiler.canvasToFilepathSync(savePathJSStr);
      }
    }
  }
});
