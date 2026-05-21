mergeInto(LibraryManager.library, {

    glCompressedTexImage2D: function(target, level, internalFormat, width, height, border, imageSize, data) {

        var lastTid = window._lastTextureId;
        var isMiniProgram = typeof wx !== 'undefined';

        function getMatchId() {
            var webgl1c = internalFormat == 36196;
            if (isMiniProgram && GameGlobal.USED_TEXTURE_COMPRESSION && webgl1c) {
                var length = HEAPU8.subarray(data, data + 1)[0];
                var d = HEAPU8.subarray(data + 1, data + 1 + length);
                var res = [];
                d.forEach(function(v) {
                    res.push(String.fromCharCode(v));
                });
                var matchId = res.join('');
                var start0 = res.length - 8;
                var start1 = res.length - 5;
                if (res[start0] == '_') {
                    start0++;
                    var header = ['a', 's', 't', 'c'];
                    for (var i = 0; i < header.length; i++) {
                        if (res[start0 + i] != header[i]) {
                            return [matchId, '8x8', false];
                        }
                    }
                    start0--;
                    var astcBlockSize = matchId.substring(start0 + 5);
                    return [matchId.substr(0, start0), astcBlockSize, false];
                } else if (res[start1] == '_') {
                    start1++;
                    var size = res[start1++];
                    if (size != '4' && size != '5' && size != '6' && size != '8') {
                        return [matchId, '8x8', false];
                    }
                    var astcBlockSize = size + 'x' + size;
                    var limit = res[start1];
                    var limitType = false;
                    if (limit != '#') {
                        limitType = true;
                    }
                    start1 -= 2;
                    return [matchId.substr(0, start1), astcBlockSize, limitType];
                } else {
                    return [matchId, '8x8', false];
                }
            }
            return [-1, '8x8', false];
        }

        var matchIdInfo = getMatchId();
        var matchId = matchIdInfo[0];
        var astcBlockSize = matchIdInfo[1];
        var limitType = matchIdInfo[2];

        function compressedImage2D(rawData) {
            var format = 0;
            var dataOffset = 16;
            var compressFormat = limitType ? GameGlobal.NoneLimitSupportedTexture : GameGlobal.TextureCompressedFormat;
            switch (compressFormat) {
                case "astc":
                    var astcList = GLctx.getExtension("WEBGL_compressed_texture_astc");
                    if (astcBlockSize == '4x4') {
                        format = astcList.COMPRESSED_RGBA_ASTC_4x4_KHR;
                        break;
                    }
                    if (astcBlockSize == '5x5') {
                        format = astcList.COMPRESSED_RGBA_ASTC_5x5_KHR;
                        break;
                    }
                    if (astcBlockSize == '6x6') {
                        format = 0x93B4;
                        break;
                    }
                    format = astcList.COMPRESSED_RGBA_ASTC_8x8_KHR;
                    break;
                case "etc2":
                    format = GLctx.getExtension("WEBGL_compressed_texture_etc").COMPRESSED_RGBA8_ETC2_EAC;
                    break;
                case "dds":
                    format = GLctx.getExtension("WEBGL_compressed_texture_s3tc").COMPRESSED_RGBA_S3TC_DXT5_EXT;
                    dataOffset = 128;
                    break;
                case "pvr":
                    format = GLctx.getExtension("WEBGL_compressed_texture_pvrtc").COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;
                    var PVR_HEADER_METADATA = 12;
                    var PVR_HEADER_LENGTH = 13; // The header length in 32 bit ints.
                    var header = new Int32Array(rawData, 0, PVR_HEADER_LENGTH);
                    dataOffset = header[PVR_HEADER_METADATA] + 52;
                    break;
                case "etc1":
                    format = GLctx.getExtension("WEBGL_compressed_texture_etc1").COMPRESSED_RGB_ETC1_WEBGL;
                    break
            }
            GLctx["compressedTexImage2D"](target, level, format, width, height, border, new Uint8Array(rawData, dataOffset))
        }

        function texImage2D(image) {
            GLctx.texImage2D(GLctx.TEXTURE_2D, 0, GLctx.RGBA, GLctx.RGBA, GLctx.UNSIGNED_BYTE, image)
        }

        function renderTexture(id) {
            if (!GL.textures[lastTid]) {
                return;
            }
            var PotList = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
            var _data = GameGlobal.DownloadedTextures[id].data;
            var tid = lastTid;
            if (!GL.textures[tid]) {
                return;
            }
            GLctx.bindTexture(GLctx.TEXTURE_2D, GL.textures[tid]);

            if (limitType && !GameGlobal.NoneLimitSupportedTexture) {
                texImage2D(_data);
            } else if (!GameGlobal.TextureCompressedFormat) {
                texImage2D(_data);
            } else if (GameGlobal.TextureCompressedFormat == "pvr" && (width !== height || PotList.indexOf(height) == -1)) {
                texImage2D(_data);
            } else if (GameGlobal.TextureCompressedFormat == 'dds' && (height % 4 !== 0 || width % 4 !== 0)) {
                texImage2D(_data);
            } else {
                compressedImage2D(_data);
            }
            GLctx.bindTexture(GLctx.TEXTURE_2D, window._lastBoundTexture ? GL.textures[window._lastBoundTexture] : null);

        }

        function renderTransparent() {
            GLctx.texImage2D(GLctx.TEXTURE_2D, 0, GLctx.RGBA, 1, 1, 0, GLctx.RGBA, GLctx.UNSIGNED_SHORT_4_4_4_4, new Uint16Array([0, 0]))
        }

        if (matchId != -1) {
            if (GameGlobal.DownloadedTextures[matchId] && GameGlobal.DownloadedTextures[matchId].data) {
                renderTexture(matchId)
            } else {
                renderTransparent();
                window.WXWASMSDK.WXDownloadTexture(matchId, width, height, (function() {
                    renderTexture(matchId)
                }), limitType)
            }
            return
        }
        var isAstcFmt = internalFormat >= 37808 && internalFormat <= 37821 || internalFormat >= 37840 && internalFormat <= 37853;
        if (GameGlobal._webgpuASTCEnabled && GameGlobal._webgpuASTCDecoder && isAstcFmt) {
          if (!GameGlobal.__astcBlockMap__) {
            GameGlobal.__astcBlockMap__ = {
              37808: [4, 4], 37809: [5, 4], 37810: [5, 5], 37811: [6, 5],
              37812: [6, 6], 37813: [8, 5], 37814: [8, 6], 37815: [8, 8],
              37816: [10, 5], 37817: [10, 6], 37818: [10, 8], 37819: [10, 10],
              37820: [12, 10], 37821: [12, 12],
              37840: [4, 4], 37841: [5, 4], 37842: [5, 5], 37843: [6, 5],
              37844: [6, 6], 37845: [8, 5], 37846: [8, 6], 37847: [8, 8],
              37848: [10, 5], 37849: [10, 6], 37850: [10, 8], 37851: [10, 10],
              37852: [12, 10], 37853: [12, 12]
            };
          }
          if (!GameGlobal.__astcSrgbAlphaExt__) {
            var _ext = GLctx.getExtension("EXT_sRGB");
            GameGlobal.__astcSrgbAlphaExt__ = (_ext && _ext.SRGB_ALPHA_EXT) ? _ext.SRGB_ALPHA_EXT : 0;
          }
          var astcBytes = data ? HEAPU8.subarray(data, data + imageSize) : null;
          if (astcBytes) {
            var blk = GameGlobal.__astcBlockMap__[internalFormat] || [8, 8];
            var _isSrgbAstc = (internalFormat >= 37840 && internalFormat <= 37853);
            // 同步用占位 RGBA（全 0）调原生 texImage2D 建立 storage，
            // 异步解码完成后 decoder 会用真实 RGBA 覆盖（见 webgpu-astc-bootstrap.js）。
            var CUBE_LO = 0x8515, CUBE_HI = 0x851A, T2D = 0x0DE1, TCUBE = 0x8513;
            var _imgTarget, _bindTarget, _bindQuery;
            if (target >= CUBE_LO && target <= CUBE_HI) {
              _imgTarget = target; _bindTarget = TCUBE; _bindQuery = 0x8514; /* TEXTURE_BINDING_CUBE_MAP */
            } else {
              _imgTarget = T2D; _bindTarget = T2D; _bindQuery = GLctx.TEXTURE_BINDING_2D;
            }
            var _needBytes = width * height * 4;
            if (!GameGlobal._astcPlaceholderZeros || GameGlobal._astcPlaceholderZeros.length < _needBytes) {
              GameGlobal._astcPlaceholderZeros = new Uint8Array(_needBytes);
            }
            var _zeros = GameGlobal._astcPlaceholderZeros.subarray(0, _needBytes);
            var _prevBind = GLctx.getParameter(_bindQuery);
            var _texObj = GL.textures[lastTid];
            // WebGL1 sRGB: EXT_sRGB → SRGB_ALPHA_EXT (0x8C42) 作为 internalFormat 和 format
            // 非 sRGB 或无扩展 → RGBA / RGBA
            var _srgbExt = GameGlobal.__astcSrgbAlphaExt__;
            var _phInternalFormat = (_isSrgbAstc && _srgbExt) ? _srgbExt : GLctx.RGBA;
            var _phFormat = (_isSrgbAstc && _srgbExt) ? _srgbExt : GLctx.RGBA;
            if (_texObj) {
              GLctx.bindTexture(_bindTarget, _texObj);
              GLctx.texImage2D(_imgTarget, level, _phInternalFormat, width, height, 0,
                               _phFormat, GLctx.UNSIGNED_BYTE, _zeros);
              GLctx.bindTexture(_bindTarget, _prevBind);
            }
            GameGlobal._webgpuASTCDecoder.decodeAndInjectToGLTexture(lastTid, astcBytes, width, height, blk[0], blk[1], {
              target: target, level: level, isSub: false, internalFormat: internalFormat
            }).catch(function (e) {
              if (GameGlobal.logmanager) {
                GameGlobal.logmanager.warn("[WebGPU ASTC Linear] decodeAndInject failed:", e && e.message)
              }
            })
          }
          return
        }
        GLctx["compressedTexImage2D"](target, level, internalFormat, width, height, border, data ? HEAPU8.subarray(data, data + imageSize) : null)
    },
    glCompressedTexSubImage2D: function(target, level, xoffset, yoffset, width, height, format, imageSize, data) {
        var lastTid = window._lastTextureId;
        var isMiniProgram = typeof wx !== 'undefined';

        function getMatchId() {
            var webgl1c = format == 36196;
            if (isMiniProgram && GameGlobal.USED_TEXTURE_COMPRESSION && webgl1c) {
                var length = HEAPU8.subarray(data, data + 1)[0];
                var d = HEAPU8.subarray(data + 1, data + 1 + length);
                var res = [];
                d.forEach(function(v) {
                    res.push(String.fromCharCode(v));
                });
                var matchId = res.join('');
                var start0 = res.length - 8;
                var start1 = res.length - 5;
                if (res[start0] == '_') {
                    start0++;
                    var header = ['a', 's', 't', 'c'];
                    for (var i = 0; i < header.length; i++) {
                        if (res[start0 + i] != header[i]) {
                            return [matchId, '8x8', false];
                        }
                    }
                    start0--;
                    var astcBlockSize = matchId.substring(start0 + 5);
                    return [matchId.substr(0, start0), astcBlockSize, false];
                } else if (res[start1] == '_') {
                    start1++;
                    var size = res[start1++];
                    if (size != '4' && size != '5' && size != '6' && size != '8') {
                        return [matchId, '8x8', false];
                    }
                    var astcBlockSize = size + 'x' + size;
                    var limit = res[start1];
                    var limitType = false;
                    if (limit != '#') {
                        limitType = true;
                    }
                    start1 -= 2;
                    return [matchId.substr(0, start1), astcBlockSize, limitType];
                } else {
                    return [matchId, '8x8', false];
                }
            }
            return [-1, '8x8', false];
        }

        var matchIdInfo = getMatchId();
        var matchId = matchIdInfo[0];
        var astcBlockSize = matchIdInfo[1];
        var limitType = matchIdInfo[2];

        function compressedImage2D(rawData) {
            var format = 0;
            var dataOffset = 16;
            var compressFormat = limitType ? GameGlobal.NoneLimitSupportedTexture : GameGlobal.TextureCompressedFormat;
            switch (compressFormat) {
                case "astc":
                    var astcList = GLctx.getExtension("WEBGL_compressed_texture_astc");
                    if (astcBlockSize == '4x4') {
                        format = astcList.COMPRESSED_RGBA_ASTC_4x4_KHR;
                        break;
                    }
                    if (astcBlockSize == '5x5') {
                        format = astcList.COMPRESSED_RGBA_ASTC_5x5_KHR;
                        break;
                    }
                    if (astcBlockSize == '6x6') {
                        format = 0x93B4;
                        break;
                    }
                    format = astcList.COMPRESSED_RGBA_ASTC_8x8_KHR;
                    break;
                case "etc2":
                    format = GLctx.getExtension("WEBGL_compressed_texture_etc").COMPRESSED_RGBA8_ETC2_EAC;
                    break;
                case "dds":
                    format = GLctx.getExtension("WEBGL_compressed_texture_s3tc").COMPRESSED_RGBA_S3TC_DXT5_EXT;
                    dataOffset = 128;
                    break;
                case "pvr":
                    format = GLctx.getExtension("WEBGL_compressed_texture_pvrtc").COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;
                    var PVR_HEADER_METADATA = 12;
                    var PVR_HEADER_LENGTH = 13; // The header length in 32 bit ints.
                    var header = new Int32Array(rawData, 0, PVR_HEADER_LENGTH);
                    dataOffset = header[PVR_HEADER_METADATA] + 52;
                    break;
                case "etc1":
                    format = GLctx.getExtension("WEBGL_compressed_texture_etc1").COMPRESSED_RGB_ETC1_WEBGL;
                    break
            }
            GLctx["compressedTexSubImage2D"](target, level, xoffset, yoffset, width, height, format, new Uint8Array(rawData, dataOffset))
        }

        function texImage2D(image) {
            GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, GLctx.RGBA, GLctx.UNSIGNED_BYTE, image)
        }

        function renderTexture(id) {
            if (!GL.textures[lastTid]) {
                return;
            }
            var _data = GameGlobal.DownloadedTextures[id].data;
            var tid = lastTid;
            if (!GL.textures[tid]) {
                return;
            }
            GLctx.bindTexture(GLctx.TEXTURE_2D, GL.textures[tid]);

            if (limitType && !GameGlobal.NoneLimitSupportedTexture) {
                texImage2D(_data);
            } else if (!GameGlobal.TextureCompressedFormat) {
                texImage2D(_data);
            } else if (GameGlobal.TextureCompressedFormat == "pvr" && (width !== height || PotList.indexOf(height) == -1)) {
                texImage2D(_data);
            } else if (GameGlobal.TextureCompressedFormat == 'dds' && (height % 4 !== 0 || width % 4 !== 0)) {
                texImage2D(_data);
            } else {
                compressedImage2D(_data);
            }


            GLctx.bindTexture(GLctx.TEXTURE_2D, window._lastBoundTexture ? GL.textures[window._lastBoundTexture] : null);

        }

        var p = window._lastTexStorage2DParams;
        if (matchId != -1) {
            var f = GLctx.RGBA8;
            switch (GameGlobal.TextureCompressedFormat) {
                case "astc":
                    var astcList = GLctx.getExtension("WEBGL_compressed_texture_astc");
                    if (astcBlockSize == '4x4') {
                        f = astcList.COMPRESSED_RGBA_ASTC_4x4_KHR;
                        break;
                    }
                    if (astcBlockSize == '5x5') {
                        f = astcList.COMPRESSED_RGBA_ASTC_5x5_KHR;
                        break;
                    }
                    if (astcBlockSize == '6x6') {
                        f = 0x93B4;
                        break;
                    }
                    f = astcList.COMPRESSED_RGBA_ASTC_8x8_KHR;
                    break;
                case "etc2":
                    f = GLctx.getExtension("WEBGL_compressed_texture_etc").COMPRESSED_RGBA8_ETC2_EAC;
                    break;
                case "dds":
                    f = GLctx.getExtension("WEBGL_compressed_texture_s3tc").COMPRESSED_RGBA_S3TC_DXT5_EXT;
                    break;
                case "pvr":
                    f = GLctx.getExtension("WEBGL_compressed_texture_pvrtc").COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;
                    break;
            }
            GLctx["texStorage2D"](p[0], p[1], f, width, height);
            if (GameGlobal.DownloadedTextures[matchId] && GameGlobal.DownloadedTextures[matchId].data) {
                renderTexture(matchId)
            } else {
                window.WXWASMSDK.WXDownloadTexture(matchId, width, height, (function() {
                    renderTexture(matchId)
                }), limitType)
            }
            return
        }
        var isAstcFmt = format >= 37808 && format <= 37821 || format >= 37840 && format <= 37853;
        if (GameGlobal._webgpuASTCEnabled && GameGlobal._webgpuASTCDecoder && isAstcFmt) {
          if (!GameGlobal.__astcBlockMap__) {
            GameGlobal.__astcBlockMap__ = {
              37808: [4, 4], 37809: [5, 4], 37810: [5, 5], 37811: [6, 5],
              37812: [6, 6], 37813: [8, 5], 37814: [8, 6], 37815: [8, 8],
              37816: [10, 5], 37817: [10, 6], 37818: [10, 8], 37819: [10, 10],
              37820: [12, 10], 37821: [12, 12],
              37840: [4, 4], 37841: [5, 4], 37842: [5, 5], 37843: [6, 5],
              37844: [6, 6], 37845: [8, 5], 37846: [8, 6], 37847: [8, 8],
              37848: [10, 5], 37849: [10, 6], 37850: [10, 8], 37851: [10, 10],
              37852: [12, 10], 37853: [12, 12]
            };
          }
          if (!GameGlobal.__astcSrgbAlphaExt__) {
            var _ext = GLctx.getExtension("EXT_sRGB");
            GameGlobal.__astcSrgbAlphaExt__ = (_ext && _ext.SRGB_ALPHA_EXT) ? _ext.SRGB_ALPHA_EXT : 0;
          }
          var astcBytes = data ? HEAPU8.subarray(data, data + imageSize) : null;
          if (astcBytes) {
            var blk = GameGlobal.__astcBlockMap__[format] || [8, 8];
            var _isSrgbAstcSub = (format >= 37840 && format <= 37853);
            var CUBE_LO2 = 0x8515, CUBE_HI2 = 0x851A, T2D2 = 0x0DE1, TCUBE2 = 0x8513;
            var _imgTarget2, _bindTarget2, _bindQuery2;
            if (target >= CUBE_LO2 && target <= CUBE_HI2) {
              _imgTarget2 = target; _bindTarget2 = TCUBE2; _bindQuery2 = 0x8514;
            } else {
              _imgTarget2 = T2D2; _bindTarget2 = T2D2; _bindQuery2 = GLctx.TEXTURE_BINDING_2D;
            }
            var _needBytes2 = width * height * 4;
            if (!GameGlobal._astcPlaceholderZeros || GameGlobal._astcPlaceholderZeros.length < _needBytes2) {
              GameGlobal._astcPlaceholderZeros = new Uint8Array(_needBytes2);
            }
            var _zeros2 = GameGlobal._astcPlaceholderZeros.subarray(0, _needBytes2);
            var _prevBind2 = GLctx.getParameter(_bindQuery2);
            var _texObj2 = GL.textures[lastTid];
            // WebGL1 sRGB: EXT_sRGB → SRGB_ALPHA_EXT (0x8C42) 作为 internalFormat 和 format
            var _srgbExt2 = GameGlobal.__astcSrgbAlphaExt__;
            var _subFormat = (_isSrgbAstcSub && _srgbExt2) ? _srgbExt2 : GLctx.RGBA;
            var _phInternalFormat2 = (_isSrgbAstcSub && _srgbExt2) ? _srgbExt2 : GLctx.RGBA;
            if (_texObj2) {
              GLctx.bindTexture(_bindTarget2, _texObj2);
              GLctx.texImage2D(_imgTarget2, level, _phInternalFormat2, width, height, 0,
                               _subFormat, GLctx.UNSIGNED_BYTE, _zeros2);
              GLctx.bindTexture(_bindTarget2, _prevBind2);
            }
            GameGlobal._webgpuASTCDecoder.decodeAndInjectToGLTexture(lastTid, astcBytes, width, height, blk[0], blk[1], {
              target: target, level: level, xoffset: xoffset, yoffset: yoffset, isSub: true,
              internalFormat: format
            }).catch(function (e) {
              if (GameGlobal.logmanager) {
                GameGlobal.logmanager.warn("[WebGPU ASTC Sub] decodeAndInject failed:", e && e.message)
              }
            })
          }
          return
        }
        GLctx["compressedTexSubImage2D"](target, level, xoffset, yoffset, width, height, format, data ? HEAPU8.subarray(data, data + imageSize) : null)
    },
});