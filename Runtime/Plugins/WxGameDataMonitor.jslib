mergeInto(LibraryManager.library, {
  JSStartGameDataMonitor: function () {
    if (!Module.IsWxGame) return;
    console.log("call JSStartGameDataMonitor \n");

    if (typeof GameGlobal.WXGameKit.debug.getGameDataMonitor === 'function') {
      GameGlobal.WXGameKit.debug.getGameDataMonitor().start();
    }
    else {
      console.log("WXGameKit.debug.getGameDataMonitor is not a function \n");
    }
  },
  JSReportUnityProfileData: function (
    targetFrameRate, // fps.
    monoHeapReserved, monoHeapUsed, nativeReserved, nativeUnused, nativeAllocated, // profiler.
    setPassCalls, drawCalls, vertices, trianglesCount // render.
  ) {
    console.log("call JSReportUnityProfileData \n");
    let report_data = {
      timestamp: new Date().getTime(),
      fps: {
        targetFrameRate: targetFrameRate,
        avgEXFrameTime: _WXGetEXFrameTime(),
      },
      profiler: {
        monoHeapReserved: monoHeapReserved,
        monoHeapUsed: monoHeapUsed,
        nativeReserved: nativeReserved,
        nativeUnused: nativeUnused,
        nativeAllocated: nativeAllocated,
      },
      render: {
        setPassCalls: setPassCalls,
        drawCalls: drawCalls,
        vertices: vertices,
        trianglesCount: trianglesCount,
      },
      webassembly: {
        totalHeapMemory: _WXGetTotalMemorySize(),
        dynamicMemory: _WXGetDynamicMemorySize(),
        usedHeapMemory: _WXGetUsedMemorySize(),
        unAllocatedMemory: _WXGetUnAllocatedMemorySize(),
      },
      assetbundle: {
        numberInMemory: _WXGetBundleNumberInMemory(),
        numberOnDisk: _WXGetBundleNumberOnDisk(),
        sizeInMemory: _WXGetBundleSizeInMemory(),
        sizeOnDisk: _WXGetBundleSizeOnDisk(),
      }
    }

    GameGlobal.WXGameKit.debug.getGameDataMonitor().reportUnityProfileData(report_data)
  },
  // forward-port from master (feat/cpu-profile-marker): CPU Profile 采集与上传
  // 依赖 monitor 对象具备 isRunning / shouldStartCpuProfile / onCpuProfileStarted /
  // shouldStopCpuProfile / onCpuProfileFileReady 方法（由 WXGameKit 插件提供）
  JSManageCpuProfile: function () {
    if (!Module.IsWxGame) return;
    if (typeof GameGlobal.WXGameKit.debug.getGameDataMonitor !== 'function') return;
    var monitor = GameGlobal.WXGameKit.debug.getGameDataMonitor();
    if (!monitor || typeof monitor.isRunning !== 'function' || !monitor.isRunning()) return;

    if (monitor.shouldStartCpuProfile && monitor.shouldStartCpuProfile()) {
      wx.startCPUProfiling();
      monitor.onCpuProfileStarted && monitor.onCpuProfileStarted();
    } else if (monitor.shouldStopCpuProfile && monitor.shouldStopCpuProfile()) {
      var cpuProfileData = wx.stopCPUProfiling();
      var jsonString = JSON.stringify(cpuProfileData);
      var filePath = wx.env.USER_DATA_PATH + '/cpuprofile_temp.cpuprofile';
      var fs = wx.getFileSystemManager();
      fs.writeFileSync(filePath, jsonString, 'utf8');
      var stat = fs.statSync(filePath);
      monitor.onCpuProfileFileReady && monitor.onCpuProfileFileReady(filePath, stat.size);
    }
  },
});
