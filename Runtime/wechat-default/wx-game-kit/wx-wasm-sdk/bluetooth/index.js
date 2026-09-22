/* eslint-disable @typescript-eslint/naming-convention */
import { convertDataToPointer } from '../utils';
let wxOnBLECharacteristicValueChangeCallback;
const OnBLECharacteristicValueChange = (res) => {
    const deviceIdPtr = convertDataToPointer(res.deviceId);
    const serviceIdPtr = convertDataToPointer(res.serviceId);
    const characteristicIdPtr = convertDataToPointer(res.characteristicId);
    const valuePtr = convertDataToPointer(res.value);
    WXGameKit.loader.module.dynCall_viiiii(wxOnBLECharacteristicValueChangeCallback, deviceIdPtr, serviceIdPtr, characteristicIdPtr, valuePtr, res.value.byteLength);
    WXGameKit.loader.module._free(deviceIdPtr);
    WXGameKit.loader.module._free(serviceIdPtr);
    WXGameKit.loader.module._free(characteristicIdPtr);
    WXGameKit.loader.module._free(valuePtr);
};
function WX_OnBLECharacteristicValueChange() {
    wx.onBLECharacteristicValueChange(OnBLECharacteristicValueChange);
}
function WX_OffBLECharacteristicValueChange() {
    wx.offBLECharacteristicValueChange();
}
function WX_RegisterOnBLECharacteristicValueChangeCallback(callback) {
    wxOnBLECharacteristicValueChangeCallback = callback;
}
export default {
    WX_OnBLECharacteristicValueChange,
    WX_OffBLECharacteristicValueChange,
    WX_RegisterOnBLECharacteristicValueChangeCallback,
};
