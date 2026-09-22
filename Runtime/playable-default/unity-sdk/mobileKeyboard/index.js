/* eslint-disable @typescript-eslint/naming-convention */
let FrameworkData = null;
const keyboardSetting = {
    value: '',
    maxLength: 140,
    multiple: false,
    confirmHold: false,
    confirmType: 'done',
};
const keyboardInputlistener = function (res) {
    keyboardSetting.value = res.value;
};
const keyboardConfirmlistener = function (res) {
    keyboardSetting.value = res.value;
    _JS_MobileKeyboard_Hide(false);
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const keyboardCompletelistener = function (res) {
    removeKeyboardListeners();
};
let hasExistingMobileInput = false;
let mobile_input_hide_delay = null;
let mobile_input_ignore_blur_event = false;
function _JS_MobileKeybard_GetIgnoreBlurEvent() {
    // On some platforms, such as iOS15, a blur event is sent to the window after the keyboard
    // is closed. This causes the game to be paused in the blur event handler in ScreenManagerWebGL.
    // It checks this return value to see if it should ignore the blur event.
    return mobile_input_ignore_blur_event;
}
function _JS_MobileKeyboard_GetKeyboardStatus() {
    const kKeyboardStatusVisible = 0;
    const kKeyboardStatusDone = 1;
    // var kKeyboardStatusCanceled = 2;
    // var kKeyboardStatusLostFocus = 3;
    if (!hasExistingMobileInput) {
        return kKeyboardStatusDone;
    }
    return kKeyboardStatusVisible;
}
function _JS_MobileKeyboard_GetText(buffer, bufferSize) {
    if (buffer) {
        FrameworkData.stringToUTF8(keyboardSetting.value, buffer, bufferSize);
    }
    return FrameworkData.lengthBytesUTF8(keyboardSetting.value);
}
function _JS_MobileKeyboard_GetTextSelection(outStart, outLength) {
    // 未支持，光标始终在最后
    const n = keyboardSetting.value.length;
    FrameworkData.HEAP32[outStart >> 2] = n;
    FrameworkData.HEAP32[outLength >> 2] = 0;
}
function _JS_MobileKeyboard_Hide(delay) {
    if (mobile_input_hide_delay) {
        return;
    }
    mobile_input_ignore_blur_event = true;
    function hideMobileKeyboard() {
        if (hasExistingMobileInput) {
            wx.hideKeyboard();
        }
        hasExistingMobileInput = false;
        mobile_input_hide_delay = null;
        // mobile_input_ignore_blur_event was set to true so that ScreenManagerWebGL will ignore
        // the blur event it might get from the closing of the keyboard. But it might not get that
        // blur event, too, depending on the browser. So we want to clear the flag, as soon as we
        // can, but some time after the blur event has been potentially fired.
        setTimeout(() => {
            mobile_input_ignore_blur_event = false;
        }, 100);
    }
    if (delay) {
        // Delaying the hide of the input/keyboard allows a new input to be selected and re-use the
        // existing control. This fixes a problem where a quick tap select of a new element would
        // cause it to not be displayed because it tried to be focused before the old keyboard finished
        // sliding away.
        const hideDelay = 200;
        mobile_input_hide_delay = setTimeout(hideMobileKeyboard, hideDelay);
    }
    else {
        hideMobileKeyboard();
    }
}
function _JS_MobileKeyboard_SetCharacterLimit(limit) {
    keyboardSetting.maxLength = limit;
}
function _JS_MobileKeyboard_SetText(text) {
    if (!hasExistingMobileInput) {
        return;
    }
    keyboardSetting.value = FrameworkData.UTF8ToString(text);
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _JS_MobileKeyboard_SetTextSelection(start, length) {
    // 未支持
}
function _JS_MobileKeyboard_Show(text, keyboardType, autocorrection, multiline, secure, alert, placeholder, characterLimit, data) {
    if (FrameworkData === null) {
        FrameworkData = data;
    }
    if (mobile_input_hide_delay) {
        clearTimeout(mobile_input_hide_delay);
        mobile_input_hide_delay = null;
    }
    if (hasExistingMobileInput) {
        if (keyboardSetting.multiple !== !!multiline) {
            _JS_MobileKeyboard_Hide(false);
            return;
        }
    }
    keyboardSetting.value = FrameworkData.UTF8ToString(text);
    keyboardSetting.maxLength = characterLimit > 0 ? characterLimit : 524288;
    keyboardSetting.multiple = !!multiline;
    wx.showKeyboard({ defaultValue: keyboardSetting.value, maxLength: keyboardSetting.maxLength, multiple: keyboardSetting.multiple, confirmHold: keyboardSetting.confirmHold, confirmType: keyboardSetting.confirmType });
    addKeyboardListeners();
    hasExistingMobileInput = true;
}
function addKeyboardListeners() {
    wx.onKeyboardInput(keyboardInputlistener);
    wx.onKeyboardConfirm(keyboardConfirmlistener);
    wx.onKeyboardComplete(keyboardCompletelistener);
}
function removeKeyboardListeners() {
    wx.offKeyboardInput(keyboardInputlistener);
    wx.offKeyboardConfirm(keyboardConfirmlistener);
    wx.offKeyboardComplete(keyboardCompletelistener);
}
export default {
    _JS_MobileKeybard_GetIgnoreBlurEvent,
    _JS_MobileKeyboard_GetKeyboardStatus,
    _JS_MobileKeyboard_GetText,
    _JS_MobileKeyboard_GetTextSelection,
    _JS_MobileKeyboard_Hide,
    _JS_MobileKeyboard_SetCharacterLimit,
    _JS_MobileKeyboard_SetText,
    _JS_MobileKeyboard_SetTextSelection,
    _JS_MobileKeyboard_Show,
};
