/* eslint-disable @typescript-eslint/no-this-alias */
import moduleHelper from './module-helper';
export default {
    handleText(s, f, c) {
        const self = this;
        return {
            success(res) {
                self.textFormat(s, res);
            },
            fail(res) {
                self.textFormat(f, res);
            },
            complete(res) {
                self.textFormat(c, res);
            },
        };
    },
    handleTextLongBack(s, f, c) {
        const self = this;
        return {
            success(res) {
                self.textFormatLongBack(s, res);
            },
            fail(res) {
                self.textFormatLongBack(f, res);
            },
            complete(res) {
                self.textFormatLongBack(c, res);
            },
        };
    },
    textFormat(id, res) {
        if (!id) {
            return false;
        }
        moduleHelper.send('TextResponseCallback', JSON.stringify({
            callbackId: id,
            errMsg: res.errMsg,
            errCode: res.errCode,
        }));
    },
    textFormatLongBack(id, res) {
        if (!id) {
            return false;
        }
        moduleHelper.send('TextResponseLongCallback', JSON.stringify({
            callbackId: id,
            errMsg: res.errMsg,
            errCode: res.errCode,
        }));
    },
    handle(formatFunc, s, f, c) {
        return {
            success(res) {
                if (!s) {
                    return false;
                }
                formatFunc(s, res);
            },
            fail(res) {
                if (!f) {
                    return false;
                }
                formatFunc(f, res);
            },
            complete(res) {
                if (!c) {
                    return false;
                }
                formatFunc(c, res);
            },
        };
    },
};
