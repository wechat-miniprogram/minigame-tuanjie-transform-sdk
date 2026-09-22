/* eslint-disable no-underscore-dangle */
import { MODULE_NAME } from './conf';
export default {
    _send: null,
    init() {
        this._send = WXGameKit.loader.module.SendMessage;
    },
    send(method, str = '') {
        if (!this._send) {
            this.init();
        }
        // @ts-ignore
        this._send(MODULE_NAME, method, str);
    },
};
