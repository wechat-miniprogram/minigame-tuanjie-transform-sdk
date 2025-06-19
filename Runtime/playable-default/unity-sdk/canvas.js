import response from './response';
import moduleHelper from './module-helper';
import { getDefaultData } from './utils';
export default {
    WXToTempFilePathSync(conf) {
        return canvas.toTempFilePathSync(getDefaultData(canvas, conf));
    },
    WXToTempFilePath(conf, s, f, c) {
        if (conf) {
            canvas.toTempFilePath({
                ...getDefaultData(canvas, conf),
                ...response.handleText(s, f, c),
                success: (res) => {
                    moduleHelper.send('ToTempFilePathCallback', JSON.stringify({
                        callbackId: s,
                        errMsg: res.errMsg,
                        errCode: res.errCode || 0,
                        tempFilePath: res.tempFilePath,
                    }));
                },
            });
        }
    },
};
