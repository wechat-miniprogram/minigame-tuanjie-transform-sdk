import moduleHelper from './module-helper';
import { formatJsonStr, formatResponse } from './utils';
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
        config.data = JSON.parse(config.data);
        if (config.data) {
            fixCallFunctionData(config.data);
        }
        let targetCloud;
        if (env === '_default_') {
            targetCloud = wx.cloud;
        }
        else {
            targetCloud = CloudList[env];
        }
        targetCloud.callFunction({
            ...config,
            success(res) {
                res.result = JSON.stringify(res.result);
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
    },
    WX_CloudCloudID(cloudId) {
        const res = wx.cloud.CloudID(cloudId);
        const r = JSON.stringify(res);
        CloudIDObject[r] = res;
        return r;
    },
    WX_CloudCallContainer(env, conf, callbackId) {
        const config = formatJsonStr(conf);
        let targetCloud;
        if (env === '_default_') {
            targetCloud = wx.cloud;
        }
        else {
            targetCloud = CloudList[env];
        }
        targetCloud.callContainer({
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
    },
};
