import { formatJsonStr, formatResponse } from './utils';
import moduleHelper from './module-helper';
const CloudIDObject = {};
function fixCallFunctionData(data) {
    Object.keys(data).forEach((key) => {
        if (typeof data[key] === 'string' && CloudIDObject[data[key]]) {
            data[key] = CloudIDObject[data[key]];
        }
    });
}
const CloudList = {};




export default {
    WX_CloudCloud(option) {
        const config = formatJsonStr(option);
        
        const cloud = new wx.cloud.Cloud(config);
        CloudList[config.resourceEnv] = cloud;
        return config.resourceEnv;
    },
    WX_CloudInit(option) {
        const config = formatJsonStr(option);
        if (config.env === '_default_') {
            wx.cloud.init();
        }
        else {
            wx.cloud.init(config);
        }
    },
    WX_CloudCallFunction(env, conf, callbackId) {
        const config = formatJsonStr(conf);
        if (config.data) {
            fixCallFunctionData(config.data);
        }
        if (env === '_default_') {
            wx.cloud.callFunction({
                ...config,
                success(res) {
                    formatResponse('CallFunctionResult', res);
                    moduleHelper.send('_CloudCallFunctionCallback', JSON.stringify({
                        callbackId, type: 'success', res: JSON.stringify(res),
                    }));
                },
                fail(res) {
                    formatResponse('GeneralCallbackResult', res);
                    moduleHelper.send('_CloudCallFunctionCallback', JSON.stringify({
                        callbackId, type: 'fail', res: JSON.stringify(res),
                    }));
                },
                complete(res) {
                    formatResponse('GeneralCallbackResult', res);
                    moduleHelper.send('_CloudCallFunctionCallback', JSON.stringify({
                        callbackId, type: 'complete', res: JSON.stringify(res),
                    }));
                },
            });
        }
        else {
            CloudList[env].callFunction({
                ...config,
                success(res) {
                    formatResponse('CallFunctionResult', res);
                    moduleHelper.send('_CloudCallFunctionCallback', JSON.stringify({
                        callbackId, type: 'success', res: JSON.stringify(res),
                    }));
                },
                fail(res) {
                    formatResponse('GeneralCallbackResult', res);
                    moduleHelper.send('_CloudCallFunctionCallback', JSON.stringify({
                        callbackId, type: 'fail', res: JSON.stringify(res),
                    }));
                },
                complete(res) {
                    formatResponse('GeneralCallbackResult', res);
                    moduleHelper.send('_CloudCallFunctionCallback', JSON.stringify({
                        callbackId, type: 'complete', res: JSON.stringify(res),
                    }));
                },
            });
        }
    },
    WX_CloudCloudID(cloudId) {
        const res = wx.cloud.CloudID(cloudId);
        const key = 'CloudID-'.concat(cloudId);
        CloudIDObject[key] = res;
        return key;
    },
    WX_CloudCallContainer(env, conf, callbackId) {
        const config = formatJsonStr(conf);
        if (env === '_default_') {
            wx.cloud.callContainer({
                ...config,
                success(res) {
                    formatResponse('CallContainerResult', res);
                    moduleHelper.send('_CloudCallContainerCallback', JSON.stringify({
                        callbackId, type: 'success', res: JSON.stringify(res),
                    }));
                },
                fail(res) {
                    formatResponse('GeneralCallbackResult', res);
                    moduleHelper.send('_CloudCallContainerCallback', JSON.stringify({
                        callbackId, type: 'fail', res: JSON.stringify(res),
                    }));
                },
                complete(res) {
                    formatResponse('GeneralCallbackResult', res);
                    moduleHelper.send('_CloudCallContainerCallback', JSON.stringify({
                        callbackId, type: 'complete', res: JSON.stringify(res),
                    }));
                },
            });
        }
        else {
            CloudList[env].callContainer({
                ...config,
                success(res) {
                    formatResponse('CallContainerResult', res);
                    moduleHelper.send('_CloudCallContainerCallback', JSON.stringify({
                        callbackId, type: 'success', res: JSON.stringify(res),
                    }));
                },
                fail(res) {
                    formatResponse('GeneralCallbackResult', res);
                    moduleHelper.send('_CloudCallContainerCallback', JSON.stringify({
                        callbackId, type: 'fail', res: JSON.stringify(res),
                    }));
                },
                complete(res) {
                    formatResponse('GeneralCallbackResult', res);
                    moduleHelper.send('_CloudCallContainerCallback', JSON.stringify({
                        callbackId, type: 'complete', res: JSON.stringify(res),
                    }));
                },
            });
        }
    },
};
