mergeInto(LibraryManager.library, {
    JSStartGameDataMonitor: function() {
        GameGlobal.manager.getGameDataMonitor().start();
    },
    JSReportUnityProfileData: function(
        targetFrameRate, // fps.
        monoHeapReserved, monoHeapUsed, nativeReserved, nativeUnused, nativeAllocated, // profiler.
        setPassCalls, drawCalls, vertices, trianglesCount // render.
    ) {
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
                sizeInMemory:  _WXGetBundleSizeInMemory(),
                sizeOnDisk: _WXGetBundleSizeOnDisk(),
            }
        }

        GameGlobal.manager.getGameDataMonitor().reportUnityProfileData(report_data)
    },
});