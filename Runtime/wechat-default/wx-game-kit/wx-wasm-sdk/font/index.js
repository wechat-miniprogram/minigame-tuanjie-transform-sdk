/* eslint-disable no-param-reassign */

import moduleHelper from '../module-helper';
import { formatJsonStr } from '../utils';
import fixCmapTable from './fix-cmap';
import readMetrics from './read-metrics';
import splitTTCToBufferOnlySC from './split-sc';

const { platform } = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();

const tempCacheObj = {};
let fontDataCache;
let getFontPromise;
let isReadFromCache = false;
const isIOS = platform === 'ios';
const isAndroid = platform === 'android';
const fontOptions = {
  CJK_Unified_Ideographs: {
    include: true,
    unicodeRange: [0x4E00, 0x9FFF],
  },
  C0_Controls_and_Basic_Latin: {
    include: true,
    unicodeRange: [0x0000, 0x007F],
  },
  CJK_Symbols_and_Punctuation: {
    include: true,
    unicodeRange: [0x3000, 0x303F],
  },
  General_Punctuation: {
    include: true,
    unicodeRange: [0x2000, 0x206F],
  },
  Enclosed_CJK_Letters_and_Months: {
    include: true,
    unicodeRange: [0x3200, 0x32FF],
  },
  Vertical_Forms: {
    include: true,
    unicodeRange: [0xFE10, 0xFE1F],
  },
  CJK_Compatibility_Forms: {
    include: true,
    unicodeRange: [0xFE30, 0xFE4F],
  },
  Miscellaneous_Symbols: {
    include: true,
    unicodeRange: [0x2600, 0x26FF],
  },
  CJK_Compatibility: {
    include: true,
    unicodeRange: [0x3300, 0x33FF],
  },
  Halfwidth_and_Fullwidth_Forms: {
    include: true,
    unicodeRange: [0xFF00, 0xFFEF],
  },
  Dingbats: {
    include: true,
    unicodeRange: [0x2700, 0x27BF],
  },
  Letterlike_Symbols: {
    include: true,
    unicodeRange: [0x2100, 0x214F],
  },
  Enclosed_Alphanumerics: {
    include: true,
    unicodeRange: [0x2460, 0x24FF],
  },
  Number_Forms: {
    include: true,
    unicodeRange: [0x2150, 0x218F],
  },
  Currency_Symbols: {
    include: true,
    unicodeRange: [0x20A0, 0x20CF],
  },
  Arrows: {
    include: true,
    unicodeRange: [0x2190, 0x21FF],
  },
  Geometric_Shapes: {
    include: true,
    unicodeRange: [0x25A0, 0x25FF],
  },
  Mathematical_Operators: {
    include: true,
    unicodeRange: [0x2200, 0x22FF],
  },
  CustomUnicodeRange: [],
};
function handleGetFontData(config, forceFallback) {

  
  const canGetWxCommonFont = !isIOS && !!WXGameKit.font?.getCommonFont;

  if (!config && !canGetWxCommonFont) {
    return Promise.reject('invalid usage');
  }
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  if (!getFontPromise || forceFallback) {
    getFontPromise = new Promise((resolve, reject) => {

      if ((!canGetWxCommonFont || forceFallback) && !!config) {
        const xhr = new WXGameKit.network.XMLHttpRequest();
        xhr.open('GET', config.fallbackUrl, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => {

          if ((xhr.status === 200 || xhr.status === 0) && xhr.response) {
            const notoFontData = xhr.response;
            fontDataCache = notoFontData;
            isReadFromCache = xhr.isReadFromCache;
            resolve();
          }
        };
        xhr.onerror = reject;
        xhr.send();
        return;
      }
      let unicodeRange = [];

      Object.keys(fontOptions).forEach((key) => {
        if (fontOptions[key].include) {
          unicodeRange.push(fontOptions[key].unicodeRange);
        }
      });

      unicodeRange = unicodeRange.concat(fontOptions.CustomUnicodeRange);

      WXGameKit.font.getCommonFont({
        success(fontData) {

          if (isIOS) {
            fixCmapTable(fontData);
          }

          if (isAndroid) {
            const tempData = splitTTCToBufferOnlySC(fontData);
            if (tempData) {
              fontData = tempData;
            }
          }
          fontDataCache = fontData;
          resolve();
        },
        fail: reject,
      }, unicodeRange);
    });
  }
  return getFontPromise;
}
function WXGetFontRawData(conf, callbackId, forceFallback = false) {
  const config = formatJsonStr(conf);
  const loadFromRemote = !WXGameKit.font?.getCommonFont;
  WXGameKit.TimeLogger.timeStart('WXGetFontRawData');

  handleGetFontData(config, forceFallback).then(() => {
    if (fontDataCache) {

      WXGameKit.font.reportGetFontCost(WXGameKit.TimeLogger.timeEnd('WXGetFontRawData'), { loadFromRemote: forceFallback || loadFromRemote, isReadFromCache, preloadWXFont: WXGameKit.config.sdk.preloadWXFont });
      const { ascent, descent, lineGap, unitsPerEm } = readMetrics(fontDataCache) || {};
      tempCacheObj[callbackId] = fontDataCache;
      moduleHelper.send('GetFontRawDataCallback', JSON.stringify({ callbackId, type: 'success', res: JSON.stringify({ byteLength: fontDataCache.byteLength, ascent, descent, lineGap, unitsPerEm }) }));
      WXGameKit.Logger.pluginLog(`[font] load font from ${forceFallback || loadFromRemote ? `network, url=${config.fallbackUrl}` : 'local'}`);

      fontDataCache = null;
    }
    else {
      WXGameKit.Logger.pluginError('[font] load font error: empty content');
    }
  })
    .catch((err) => {
      if (err.errmsg === 'no support font' && forceFallback === false) {

        WXGetFontRawData(conf, callbackId, true);
      }
      else {
        WXGameKit.Logger.pluginError('[font] load font error: ', err);
      }
    });
}
function WXShareFontBuffer(buffer, offset, callbackId) {
  if (typeof tempCacheObj[callbackId] === 'string') {
    WXGameKit.Logger.pluginError('[font]内存写入异常');
  }
  buffer.set(new Uint8Array(tempCacheObj[callbackId]), offset);
  delete tempCacheObj[callbackId];
}
export function preloadWxCommonFont() {

  if (!!WXGameKit.config.sdk.preloadWXFont && !!WXGameKit.font.getCommonFont) {
    handleGetFontData();
  }
}
export default {
  WXGetFontRawData,
  WXShareFontBuffer,
};
