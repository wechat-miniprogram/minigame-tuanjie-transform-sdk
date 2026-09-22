export default {
    WXLogManagerDebug(str) {
        GameGlobal.WXGameKit.Logger.logManager.debug(str);
    },
    WXLogManagerInfo(str) {
        GameGlobal.WXGameKit.Logger.logManager.info(str);
    },
    WXLogManagerLog(str) {
        GameGlobal.WXGameKit.Logger.logManager.log(str);
    },
    WXLogManagerWarn(str) {
        GameGlobal.WXGameKit.Logger.logManager.warn(str);
    },
};
