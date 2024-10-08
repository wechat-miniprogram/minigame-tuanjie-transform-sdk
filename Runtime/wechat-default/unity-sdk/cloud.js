/* eslint-disable no-param-reassign */
import moduleHelper from './module-helper';
import { uid, formatJsonStr, formatResponse } from './utils';
const CloudIDObject = {};
const CDNObject = {};
function fixCallFunctionData(data) {
    Object.keys(data).forEach((key) => {
        if (typeof data[key] === 'object') {
            fixCallFunctionData(data[key]);
        }
        else if (typeof data[key] === 'string') {
            if (CloudIDObject[data[key]]) {
                data[key] = CloudIDObject[data[key]];
            }
            if (CDNObject[data[key]]) {
                data[key] = CDNObject[data[key]];
            }
        }
    });
}
const CloudList = {};
export default {
    WX_CloudCloud(option) {
        const config = formatJsonStr(option);
        // @ts-ignore
        const cloud = new wx.cloud.Cloud(config);
        CloudList[config.resourceEnv] = cloud;
    },
    WX_CloudInit(option) {
        const config = formatJsonStr(option);
        if (config.env === '_default_') {
            wx.cloud.init();
        }
        else {
            CloudList[config.env].init(config);
        }
    },
    WX_CloudCallFunction(env, conf, callbackId) {
        const config = formatJsonStr(conf);
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
    WX_CloudCloudID(env, cloudID) {
        let targetCloud;
        if (env === '_default_') {
            targetCloud = wx.cloud;
        }
        else {
            targetCloud = CloudList[env];
        }
        const res = targetCloud.CloudID(cloudID);
        const id = `CloudID-${uid()}`;
        CloudIDObject[id] = res;
        return id;
    },
    WX_CloudCDN(env, target) {
        let targetCloud;
        if (env === '_default_') {
            targetCloud = wx.cloud;
        }
        else {
            targetCloud = CloudList[env];
        }
        const res = targetCloud.CDN(target);
        const id = `CDN-${uid()}`;
        CDNObject[id] = res;
        return id;
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
    WX_CloudUploadFile(env, conf, callbackId) {
        const config = formatJsonStr(conf);
        let targetCloud;
        if (env === '_default_') {
            targetCloud = wx.cloud;
        }
        else {
            targetCloud = CloudList[env];
        }
        targetCloud.uploadFile({
            ...config,
            success(res) {
                formatResponse('UploadFileResult', res);
                moduleHelper.send('_CloudUploadFileCallback', JSON.stringify({
                    callbackId, type: 'success', res: JSON.stringify(res),
                }));
            },
            fail(res) {
                formatResponse('GeneralCallbackResult', res);
                moduleHelper.send('_CloudUploadFileCallback', JSON.stringify({
                    callbackId, type: 'fail', res: JSON.stringify(res),
                }));
            },
            complete(res) {
                formatResponse('GeneralCallbackResult', res);
                moduleHelper.send('_CloudUploadFileCallback', JSON.stringify({
                    callbackId, type: 'complete', res: JSON.stringify(res),
                }));
            },
        });
    },
    WX_CloudDownloadFile(env, conf, callbackId) {
        const config = formatJsonStr(conf);
        let targetCloud;
        if (env === '_default_') {
            targetCloud = wx.cloud;
        }
        else {
            targetCloud = CloudList[env];
        }
        targetCloud.downloadFile({
            ...config,
            success(res) {
                formatResponse('DownloadFileResult', res);
                moduleHelper.send('_CloudDownloadFileCallback', JSON.stringify({
                    callbackId, type: 'success', res: JSON.stringify(res),
                }));
            },
            fail(res) {
                formatResponse('GeneralCallbackResult', res);
                moduleHelper.send('_CloudDownloadFileCallback', JSON.stringify({
                    callbackId, type: 'fail', res: JSON.stringify(res),
                }));
            },
            complete(res) {
                formatResponse('GeneralCallbackResult', res);
                moduleHelper.send('_CloudDownloadFileCallback', JSON.stringify({
                    callbackId, type: 'complete', res: JSON.stringify(res),
                }));
            },
        });
    },
    WX_CloudGetTempFileURL(env, conf, callbackId) {
        const config = formatJsonStr(conf);
        let targetCloud;
        if (env === '_default_') {
            targetCloud = wx.cloud;
        }
        else {
            targetCloud = CloudList[env];
        }
        targetCloud.getTempFileURL({
            ...config,
            success(res) {
                formatResponse('GetTempFileURLResult', res);
                moduleHelper.send('_CloudGetTempFileURLCallback', JSON.stringify({
                    callbackId, type: 'success', res: JSON.stringify(res),
                }));
            },
            fail(res) {
                formatResponse('GeneralCallbackResult', res);
                moduleHelper.send('_CloudGetTempFileURLCallback', JSON.stringify({
                    callbackId, type: 'fail', res: JSON.stringify(res),
                }));
            },
            complete(res) {
                formatResponse('GeneralCallbackResult', res);
                moduleHelper.send('_CloudGetTempFileURLCallback', JSON.stringify({
                    callbackId, type: 'complete', res: JSON.stringify(res),
                }));
            },
        });
    },
    WX_CloudDeleteFile(env, conf, callbackId) {
        const config = formatJsonStr(conf);
        let targetCloud;
        if (env === '_default_') {
            targetCloud = wx.cloud;
        }
        else {
            targetCloud = CloudList[env];
        }
        targetCloud.deleteFile({
            ...config,
            success(res) {
                formatResponse('DeleteFileResult', res);
                moduleHelper.send('_CloudDeleteFileCallback', JSON.stringify({
                    callbackId, type: 'success', res: JSON.stringify(res),
                }));
            },
            fail(res) {
                formatResponse('GeneralCallbackResult', res);
                moduleHelper.send('_CloudDeleteFileCallback', JSON.stringify({
                    callbackId, type: 'fail', res: JSON.stringify(res),
                }));
            },
            complete(res) {
                formatResponse('GeneralCallbackResult', res);
                moduleHelper.send('_CloudDeleteFileCallback', JSON.stringify({
                    callbackId, type: 'complete', res: JSON.stringify(res),
                }));
            },
        });
    },
};
