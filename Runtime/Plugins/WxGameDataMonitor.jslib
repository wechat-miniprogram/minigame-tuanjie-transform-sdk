mergeInto(LibraryManager.library, {
    JSStartGameDataMonitor: function() {
        GameGlobal.manager.getGameDataMonitor().start();
    },
    JSReportUnityProfileData: function() {
        GameGlobal.manager.getGameDataMonitor().reportUnityProfileData({
            timestamp: new Date().getTime(),
            dynamicMemorySize: WXGetDynamicMemorySize(),
        })
    },
});