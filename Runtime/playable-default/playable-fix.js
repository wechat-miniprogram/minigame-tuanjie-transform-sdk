/* eslint-disable */
delete wx.getWindowInfo;
delete wx.getDeviceInfo;
delete wx.getAppBaseInfo;
wx.getPerformance = function () {
    return {
        now: function () {
            return Date.now() * 1000;
        },
    };
};
wx.getRealtimeLogManager = function () {
    return {
        info: function (...args) {
            console.log.apply(console, args);
        },
        warn: function (...args) {
            console.warn.apply(console, args);
        },
        error: function (...args) {
            console.error.apply(console, args);
        },
        setFilterMsg: function () { },
        addFilterMsg: function () { },
    };
};
wx.getLogManager = function () {
    return {
        info: function (...args) {
            console.log.apply(console, args);
        },
        warn: function (...args) {
            console.warn.apply(console, args);
        },
        log: function (...args) {
            console.log.apply(console, args);
        },
        debug: function (...args) {
            console.log.apply(console, args);
        },
    };
};
