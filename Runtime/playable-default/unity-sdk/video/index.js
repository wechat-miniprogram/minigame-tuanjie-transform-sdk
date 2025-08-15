/* eslint-disable @typescript-eslint/prefer-for-of */
/* eslint-disable @typescript-eslint/naming-convention */
import { isH5Renderer, isSupportVideoPlayer, isPc, isDevtools } from '../../check-version';
import { debugLog } from '../utils';
let FrameworkData = null;

const isWebVideo = (isH5Renderer && !GameGlobal.isIOSHighPerformanceModePlus) || isPc || isDevtools;
const needCache = true;
const cacheVideoDecoder = [];
const supportVideoFrame = !!GameGlobal.isIOSHighPerformanceModePlus;
const videoInstances = {};
function _JS_Video_CanPlayFormat(format, data) {
    
    
    FrameworkData = data;
    return !!isSupportVideoPlayer;
}
let videoInstanceIdCounter = 0;
function dynCall_vi(...args) {
    if (FrameworkData) {
        FrameworkData.dynCall_vi(...args);
    }
}
function dynCall_vii(...args) {
    if (FrameworkData) {
        FrameworkData.dynCall_vii(...args);
    }
}
function jsVideoEnded() {
    debugLog('jsVideoEnded');
    // @ts-ignore
    if (this.onendedCallback) {
        // @ts-ignore
        dynCall_vi(this.onendedCallback, this.onendedRef);
    }
}
function _JS_Video_Create(url) {
    let source = '';
    if (FrameworkData) {
        source = FrameworkData.UTF8ToString(url);
    }
    debugLog('_JS_Video_Create', source);
    if (isWebVideo) {
        // @ts-ignore
        const video = GameGlobal.manager.createWKVideo(source, FrameworkData.GLctx);
        // eslint-disable-next-line no-plusplus
        videoInstances[++videoInstanceIdCounter] = video;
    }
    else {
        let videoDecoder;
        if (cacheVideoDecoder.length > 0) {
            videoDecoder = cacheVideoDecoder.pop();
        }
        else {
            // @ts-ignore 8.0.38客户端+3.0.0基础库，才能正常使用type参数
            videoDecoder = wx.createVideoDecoder({
                type: 'wemedia',
            });
        }
        // eslint-disable-next-line no-plusplus
        const videoInstance = {
            videoDecoder,
            videoWidth: 0,
            videoHeight: 0,
            isReady: false,
            stoped: false,
            paused: false,
            ended: false,
            seeking: false,
            duration: 1,
        };
        // eslint-disable-next-line no-plusplus
        videoInstances[++videoInstanceIdCounter] = videoInstance;
        
        videoDecoder.remove();
        videoDecoder.on('start', (res) => {
            debugLog('wxVideoDecoder start:', res);
            videoInstance.paused = false;
            videoInstance.stoped = false;
            if (!videoInstance.isReady) {
                if (res.video && res.video.duration) {
                    videoInstance.duration = res.video.duration / 1000;
                }
                videoInstance.videoWidth = res.width ?? 0;
                videoInstance.videoHeight = res.height ?? 0;
                videoInstance.isReady = true;
                videoDecoder.stop();
            }
        });
        videoDecoder.on('stop', (res) => {
            debugLog('wxVideoDecoder stop:', res);
            videoInstance.stoped = true;
        });
        videoDecoder.on('bufferchange', (res) => {
            debugLog('wxVideoDecoder bufferchange:', res);
        });
        videoDecoder.on('ended', (res) => {
            debugLog('wxVideoDecoder ended:', res);
            if (videoInstance.loop) {
                videoInstance.seek(0);
            }
            else {
                videoInstance.ended = true;
                videoInstance.onended?.();
            }
        });
        // @ts-ignore
        videoDecoder.on('frame', (res) => {
            // @ts-ignore
            videoInstance.currentTime = res.pts / 1000;
            
            if (supportVideoFrame) {
                
                videoInstance.frameData?.close?.();
            }
            videoInstance.frameData = res;
        });
        const startOption = {
            source,
        };
        if (supportVideoFrame) {
            startOption.videoDataType = 2;
        }
        videoInstance.play = () => {
            if (videoInstance.seeking) {
                videoInstance.seeking = false;
            }
            if (videoInstance.paused) {
                videoInstance.paused = false;
                videoDecoder.wait(false);
            }
            else {
                videoDecoder.start(startOption);
            }
        };
        videoInstance.pause = () => {
            videoDecoder.wait(true);
            videoInstance.paused = true;
        };
        videoInstance.seek = (time) => {
            // @ts-ignore
            videoDecoder.avSync.seek({ stamp: time });
            videoInstance.seeking = true;
            videoDecoder.emitter.emit('seek', {});
        };
        videoInstance.play();
        videoInstance.destroy = () => {
            if (needCache) {
                videoDecoder.stop();
                cacheVideoDecoder.push(videoDecoder);
            }
            else {
                videoDecoder.remove();
            }
            if (videoInstance.loopEndPollInterval) {
                clearInterval(videoInstance.loopEndPollInterval);
            }
            delete videoInstance.videoDecoder;
            delete videoInstance.onendedCallback;
            delete videoInstance.frameData;
            videoInstance.stoped = false;
            videoInstance.paused = false;
            videoInstance.ended = false;
            videoInstance.seeking = false;
            videoInstance.currentTime = 0;
            videoInstance.onended = null;
        };
    }
    return videoInstanceIdCounter;
}
function _JS_Video_Destroy(video) {
    debugLog('_JS_Video_Destroy', video);
    videoInstances[video].destroy();
    const Module = GameGlobal.manager.gameInstance.Module;
    const { GL } = Module;
    const gl = GL.currentContext.GLctx;
    if (!isWebVideo && gl.emscriptenGLX && Module._glxVideoDestroy) {
        Module._glxVideoDestroy(video);
    }
    delete videoInstances[video];
}
function _JS_Video_Duration(video) {
    return videoInstances[video].duration;
}
function _JS_Video_EnableAudioTrack(video, trackIndex, enabled) {
    const v = videoInstances[video];
    
    if (!v.enabledTracks) {
        v.enabledTracks = [];
    }
    while (v.enabledTracks.length <= trackIndex) {
        v.enabledTracks.push(true);
    }
    v.enabledTracks[trackIndex] = enabled;
    const tracks = v.audioTracks;
    if (!tracks) {
        return;
    }
    const track = tracks[trackIndex];
    if (track) {
        track.enabled = !!enabled;
    }
}
function _JS_Video_GetAudioLanguageCode(video, trackIndex) {
    
    const tracks = videoInstances[video].audioTracks;
    if (!tracks) {
        return '';
    }
    const track = tracks[trackIndex];
    return track ? track.language : '';
}
function _JS_Video_GetNumAudioTracks(video) {
    const tracks = videoInstances[video].audioTracks;
    // console.log('_JS_Video_GetNumAudioTracks', tracks);
    return tracks ? tracks.length : 1;
}
function _JS_Video_Height(video) {
    return videoInstances[video].videoHeight;
}
function _JS_Video_IsPlaying(video) {
    if (isWebVideo) {
        const v = videoInstances[video];
        return v.isPlaying;
    }
    const v = videoInstances[video];
    return v.isReady && !v.stoped && !v.paused && !v.ended;
}
function _JS_Video_IsReady(video) {
    const v = videoInstances[video];
    return !!v.isReady;
}
function _JS_Video_IsSeeking(video) {
    const v = videoInstances[video];
    return !!v.seeking;
}
function _JS_Video_Pause(video) {
    debugLog('_JS_Video_Pause');
    const v = videoInstances[video];
    if (v.loopEndPollInterval) {
        clearInterval(v.loopEndPollInterval);
    }
    v.pause();
}
function _JS_Video_SetLoop(video, loop = false) {
    debugLog('_JS_Video_SetLoop', video, loop);
    const v = videoInstances[video];
    if (v.loopEndPollInterval) {
        clearInterval(v.loopEndPollInterval);
    }
    v.loop = loop;
    if (loop) {
        
        v.loopEndPollInterval = setInterval(() => {
            if (typeof v.currentTime !== 'undefined' && typeof v.lastSeenPlaybackTime !== 'undefined') {
                const cur = Math.floor(v.currentTime);
                const last = Math.floor(v.lastSeenPlaybackTime);
                if (cur < last) {
                    const dur = v.duration;
                    const margin = 0.2;
                    const closeToBegin = margin * dur;
                    const closeToEnd = dur - closeToBegin;
                    if (cur < closeToBegin && last > closeToEnd) {
                        jsVideoEnded.apply(v);
                    }
                }
            }
            v.lastSeenPlaybackTime = v.currentTime;
        }, 1e3 / 30);
        v.lastSeenPlaybackTime = v.currentTime;
        v.onended = null;
    }
    else {
        v.onended = jsVideoEnded;
    }
}
function jsVideoAllAudioTracksAreDisabled(v) {
    debugLog('jsVideoAllAudioTracksAreDisabled');
    if (!v.enabledTracks) {
        return false;
    }
    for (let i = 0; i < v.enabledTracks.length; ++i) {
        if (v.enabledTracks[i]) {
            return false;
        }
    }
    return true;
}
function _JS_Video_Play(video, muted) {
    debugLog('_JS_Video_Play', video, muted);
    const v = videoInstances[video];
    v.muted = muted || jsVideoAllAudioTracksAreDisabled(v);
    v.play();
    _JS_Video_SetLoop(video, v.loop);
}
function _JS_Video_Seek(video, time) {
    debugLog('_JS_Video_Seek', video, time);
    const v = videoInstances[video];
    v.seek(time);
}
function _JS_Video_SetEndedHandler(video, ref, onended) {
    debugLog('_JS_Video_SetEndedHandler', video, ref, onended);
    const v = videoInstances[video];
    v.onendedCallback = onended;
    v.onendedRef = ref;
}
function _JS_Video_SetErrorHandler(video, ref, onerror) {
    debugLog('_JS_Video_SetErrorHandler', video, ref, onerror);
    if (isWebVideo) {
        videoInstances[video].on('error', (errMsg) => {
            debugLog('video error:', errMsg);
            dynCall_vii(onerror, ref, errMsg);
        });
    }
}
function _JS_Video_SetMute(video, muted) {
    debugLog('_JS_Video_SetMute', video, muted);
    const v = videoInstances[video];
    v.muted = muted || jsVideoAllAudioTracksAreDisabled(v);
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _JS_Video_SetPlaybackRate(video, rate) {
    
    
    
    
    
    
    return;
    
    
}
function _JS_Video_SetReadyHandler(video, ref, onready) {
    debugLog('_JS_Video_SetReadyHandler', video, ref, onready);
    const v = videoInstances[video];
    if (isWebVideo) {
        v.on('canplay', () => {
            dynCall_vi(onready, ref);
        });
    }
    else {
        const fn = () => {
            console.log('_JS_Video_SetReadyHandler onCanPlay');
            dynCall_vi(onready, ref);
            v.videoDecoder?.off('bufferchange', fn);
        };
        v.videoDecoder?.on('bufferchange', fn);
    }
}
function _JS_Video_SetSeekedOnceHandler(video, ref, onseeked) {
    debugLog('_JS_Video_SetSeekedOnceHandler', video, ref, onseeked);
    const v = videoInstances[video];
    if (isWebVideo) {
        v.on('seek', () => {
            dynCall_vi(onseeked, ref);
        });
    }
    else {
        v.videoDecoder?.on('seek', () => {
            dynCall_vi(onseeked, ref);
        });
    }
}
function _JS_Video_SetVolume(video, volume) {
    debugLog('_JS_Video_SetVolume');
    videoInstances[video].volume = volume;
}
function _JS_Video_Time(video) {
    return videoInstances[video].currentTime;
}
function _JS_Video_UpdateToTexture(video, tex) {
    
    const v = videoInstances[video];
    if (!(v.videoWidth > 0 && v.videoHeight > 0)) {
        return false;
    }
    if (v.lastUpdateTextureTime === v.currentTime) {
        return false;
    }
    v.lastUpdateTextureTime = v.currentTime;
    if (!FrameworkData) {
        return false;
    }
    const Module = GameGlobal.manager.gameInstance.Module;
    const { GL, GLctx } = FrameworkData;
    const gl = GL.currentContext.GLctx;
    
    if (!isWebVideo && Module._glxVideoUpdateToTexture && gl.emscriptenGLX) {
        const data = v.frameData?.data;
        const source = supportVideoFrame ? data : new Uint8ClampedArray(data);
        const byteLength = supportVideoFrame ? 0 : source.byteLength;
        let sourceIdOrPtr;
        if (supportVideoFrame) {
            sourceIdOrPtr = source.__uid;
        }
        else {
            sourceIdOrPtr = Module._glxGetVideoTempBuffer(video, byteLength);
            if (sourceIdOrPtr) {
                Module.HEAPU8.set(source, sourceIdOrPtr);
            }
        }
        
        Module._glxVideoUpdateToTexture(v, supportVideoFrame, tex, v.videoWidth, v.videoHeight, sourceIdOrPtr);
        return true;
    }
    
    GLctx.pixelStorei(GLctx.UNPACK_FLIP_Y_WEBGL, true);
    
    
    const internalFormat = GLctx.RGBA;
    const format = GLctx.RGBA;
    const width = v.videoWidth;
    const height = v.videoHeight;
    if (v.previousUploadedWidth !== width || v.previousUploadedHeight !== height) {
        GLctx.deleteTexture(GL.textures[tex]);
        const t = GLctx.createTexture();
        t.name = tex;
        GL.textures[tex] = t;
        GLctx.bindTexture(GLctx.TEXTURE_2D, t);
        GLctx.texParameteri(GLctx.TEXTURE_2D, GLctx.TEXTURE_WRAP_S, GLctx.CLAMP_TO_EDGE);
        GLctx.texParameteri(GLctx.TEXTURE_2D, GLctx.TEXTURE_WRAP_T, GLctx.CLAMP_TO_EDGE);
        GLctx.texParameteri(GLctx.TEXTURE_2D, GLctx.TEXTURE_MIN_FILTER, GLctx.LINEAR);
        if (isWebVideo) {
            v.render();
        }
        else {
            
            const data = v.frameData?.data;
            const source = supportVideoFrame ? data : new Uint8ClampedArray(data);
            
            if (supportVideoFrame) {
                GLctx.texImage2D(GLctx.TEXTURE_2D, 0, internalFormat, format, GLctx.UNSIGNED_BYTE, source);
            }
            else {
                GLctx.texImage2D(GLctx.TEXTURE_2D, 0, internalFormat, v.videoWidth, v.videoHeight, 0, format, GLctx.UNSIGNED_BYTE, source);
            }
        }
        v.previousUploadedWidth = width;
        v.previousUploadedHeight = height;
    }
    else {
        GLctx.bindTexture(GLctx.TEXTURE_2D, GL.textures[tex]);
        if (isWebVideo) {
            v.render();
        }
        else {
            const data = v.frameData?.data;
            const source = supportVideoFrame ? data : new Uint8ClampedArray(data);
            
            if (supportVideoFrame) {
                GLctx.texImage2D(GLctx.TEXTURE_2D, 0, internalFormat, format, GLctx.UNSIGNED_BYTE, source);
            }
            else {
                GLctx.texImage2D(GLctx.TEXTURE_2D, 0, internalFormat, v.videoWidth, v.videoHeight, 0, format, GLctx.UNSIGNED_BYTE, source);
            }
        }
    }
    GLctx.pixelStorei(GLctx.UNPACK_FLIP_Y_WEBGL, false);
    return true;
}
function _JS_Video_Width(video) {
    return videoInstances[video].videoWidth;
}
function _JS_Video_SetSeekedHandler(video, ref, onseeked) {
    const v = videoInstances[video];
    if (isWebVideo) {
        v.on('seek', () => {
            dynCall_vi(onseeked, ref);
        });
    }
    else {
        v.videoDecoder?.on('seek', () => {
            dynCall_vi(onseeked, ref);
        });
    }
}
function _JS_Video_GetPlaybackRate(video) {
    return videoInstances[video].playbackRate;
}
export default {
    _JS_Video_CanPlayFormat,
    _JS_Video_Create,
    _JS_Video_Destroy,
    _JS_Video_Duration,
    _JS_Video_EnableAudioTrack,
    _JS_Video_GetAudioLanguageCode,
    _JS_Video_GetNumAudioTracks,
    _JS_Video_Height,
    _JS_Video_IsPlaying,
    _JS_Video_IsReady,
    _JS_Video_IsSeeking,
    _JS_Video_Pause,
    _JS_Video_SetLoop,
    _JS_Video_Play,
    _JS_Video_Seek,
    _JS_Video_SetEndedHandler,
    _JS_Video_SetErrorHandler,
    _JS_Video_SetMute,
    _JS_Video_SetPlaybackRate,
    _JS_Video_SetReadyHandler,
    _JS_Video_SetSeekedOnceHandler,
    _JS_Video_SetVolume,
    _JS_Video_Time,
    _JS_Video_UpdateToTexture,
    _JS_Video_Width,
    _JS_Video_SetSeekedHandler,
    _JS_Video_GetPlaybackRate,
};
