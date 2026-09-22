// @ts-nocheck
import './wx-game-kit/index';
import './wx-game-kit/custom/index';
import commFrameWork from "./framework";
if (typeof WXGameKit.loader !== 'undefined') {
    WXGameKit.loader.setModuleFunctionHandler(commFrameWork);
    WXGameKit.loader.start().then(() => {
        console.log('start success');
    }).catch((err) => {
        console.error('start fail', err);
    });
}
