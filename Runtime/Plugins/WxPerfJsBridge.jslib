mergeInto(LibraryManager.library, {

    JSInitProfiler: function(savePathPtr, metaInfoPtr) {
        const savePath = UTF8ToString(savePathPtr);
        // const uploadUrl = UTF8ToString(uploadUrlPtr);
        const metaInfo = UTF8ToString(metaInfoPtr);
        //if (GameGlobal && GameGlobal.manager && GameGlobal.manager.initProfiler) {
            const uploadUrl = GameGlobal.managerConfig.PROFILER_UPLOAD_URL;
            GameGlobal.manager.initProfiler({'savePath': savePath, 'uploadUrl': uploadUrl, 'meta': metaInfo, 'cb': _JSInitProfilerCallback, 'errorCb': _JSProfilerErrorCallback});
        //}
    },
    JSStartProfiler: function() {
        //const savePath = UTF8ToString(savePathPtr);
        //const uploadUrl = UTF8ToString(uploadUrlPtr);
        //const metaInfo = UTF8ToString(metaInfoPtr);
        //if (GameGlobal && GameGlobal.manager && GameGlobal.manager.profiler) {
            GameGlobal.manager.profiler.startProfile();
        //}
    },
    StartJSProfilerRecord: function(frameId, interval, savePathPtr) {
        const savePath = UTF8ToString(savePathPtr);
        if (GameGlobal && GameGlobal.unityNamespace && GameGlobal.unityNamespace.ProfileWebgl && GameGlobal.unityNamespace.ProfileWebgl.startRecord) {
            GameGlobal.unityNamespace.ProfileWebgl.startRecord(frameId, interval, savePath);
        }
    },
    StopJSProfilerRecord: function() {
        if (GameGlobal && GameGlobal.unityNamespace && GameGlobal.unityNamespace.ProfileWebgl && GameGlobal.unityNamespace.ProfileWebgl.stopRecord) {
            GameGlobal.unityNamespace.ProfileWebgl.stopRecord();
        }
    },
    JSProfilerUploadString: function(dataPtr, bufSize, namePtr, dirPtr, id, inStartFrameIdx, inEndFrameIdx) {
        //if (GameGlobal && GameGlobal.manager && GameGlobal.manager.profiler) {
            const name = UTF8ToString(namePtr);
            const dir = UTF8ToString(dirPtr);
            const content = UTF8ToString(dataPtr);
            GameGlobal.manager.profiler.uploadString({'str': content, 'len': bufSize, 'fileName': name, 'uploadDir': dir, 'id': id, 'cb': _JSPerfUploadStringCallback, 'startFrameIdx': inStartFrameIdx, 'endFrameIdx': inEndFrameIdx});
        //}
    },
    JSProfilerUploadAnnotation: function(inAnnotationDataPtr, inFrameIdx) {
        const annotationData = UTF8ToString(inAnnotationDataPtr);
        GameGlobal.manager.profiler.uploadAnnotation({'annotationData': annotationData, 'annotationFrameIDX': inFrameIdx});
    },
    JSGetMetaDataInfo: function() {
        var convertPluginVersion = GameGlobal.unityNamespace.convertPluginVersion;
        var unityHeapReservedMemory = GameGlobal.unityNamespace.unityHeapReservedMemory; 
        var contextType = GameGlobal.managerConfig.contextConfig.contextType;
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

    JSFreeIntPtr: function(ptr) {
        _free(ptr); 
    }, 
    JSProfilerUploadStringWithDir: function(dataPtr, bufSize, namePtr, dirPtr) {
        //if (GameGlobal && GameGlobal.manager && GameGlobal.manager.profiler) {
            const name = UTF8ToString(namePtr);
            const dir = UTF8ToString(dirPtr);
            const content = UTF8ToString(dataPtr);
            GameGlobal.manager.profiler.uploadStringWithDir({'str': content, 'len': bufSize, 'fileName': name, 'uploadDir': dir, 'cb': _JSProfilerUploadStringWithDirCallback});
        //}
    }
});
