mergeInto(LibraryManager.library, {
    JSStartGameDataMonitor: function() {
        console.log("call JSStartGameDataMonitor \n"); 

        if (typeof GameGlobal.manager.getGameDataMonitor === 'function')
        {
            GameGlobal.manager.getGameDataMonitor().start();
        }
        else
        {
            console.log("GameGlobal.manager.getGameDataMonitor is not a function \n");
        }
    },
    JSReportUnityProfileData: function(
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
                sizeInMemory:  _WXGetBundleSizeInMemory(),
                sizeOnDisk: _WXGetBundleSizeOnDisk(),
            }
        }

        GameGlobal.manager.getGameDataMonitor().reportUnityProfileData(report_data)
    },
});