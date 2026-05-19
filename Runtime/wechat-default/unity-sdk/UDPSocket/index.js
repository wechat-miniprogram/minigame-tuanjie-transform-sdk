/* eslint-disable @typescript-eslint/naming-convention */
import { formatJsonStr, uid, onEventCallback, offEventCallback, getListObject, convertDataToPointer, convertInfoToPointer, formatResponse } from '../utils';
const UDPSocketList = {};
const wxUDPSocketCloseList = {};
const wxUDPSocketErrorList = {};
const wxUDPSocketListeningList = {};
const wxUDPSocketMessageList = {};
const getUDPSocketObject = getListObject(UDPSocketList, 'UDPSocket');
let wxUDPSocketOnMessageCallback;
let wxUDPSocketOnMessageCallbackV2;
const UDPSocketIdBuffers = {};
const UDPSocketMessageBuffers = {};
const UDPSocketRemoteIpBuffers = {};
const UDPSocketLocalIpBuffers = {};

function allocateUTF8WithBuffer(str, buffers, id) {
    const Module = GameGlobal.Module;
    if (str === undefined || str === null)
        str = '';
    const size = Module.lengthBytesUTF8(str) + 1;
    let slot = buffers[id];
    if (!slot || !slot.ptr || slot.len < size) {
        if (slot && slot.ptr) {
            Module._free(slot.ptr);
        }
        const ptr = Module._malloc(size);
        if (!ptr) {
            buffers[id] = { ptr: 0, len: 0 };
            return 0;
        }
        slot = { ptr, len: size };
        buffers[id] = slot;
    }
    Module.stringToUTF8(str, slot.ptr, slot.len);
    return slot.ptr;
}
// 分配/复用 message 字节缓冲，写入由调用方完成（HEAPU8.set）
function allocateDataBuffer(byteLen, buffers, id) {
    const Module = GameGlobal.Module;
    let slot = buffers[id];
    if (!slot || !slot.ptr || slot.len < byteLen) {
        if (slot && slot.ptr) {
            Module._free(slot.ptr);
        }
        // 留 32B 冗余降低小幅波动触发的扩容
        const cap = byteLen + 32;
        const ptr = Module._malloc(cap);
        if (!ptr) {
            buffers[id] = { ptr: 0, len: 0 };
            return 0;
        }
        slot = { ptr, len: cap };
        buffers[id] = slot;
    }
    return slot.ptr;
}
function releaseRecvBuffers(id) {
    const Module = GameGlobal.Module;
    const release = (buffers, key) => {
        const slot = buffers[key];
        if (slot && slot.ptr) {
            Module._free(slot.ptr);
        }
        delete buffers[key];
    };
    release(UDPSocketIdBuffers, id);
    release(UDPSocketMessageBuffers, id);
    release(UDPSocketRemoteIpBuffers, id);
    release(UDPSocketLocalIpBuffers, id);
}
// 发送侧 ArrayBuffer 池，环形分配，容量不够时扩容
const UDP_POOL_INITIAL_SIZE = 1024;
const UDP_POOL_GROW_EXTRA = 200;
const UDPSocketBufferPool = {};
function createUdpBufferPool(size) {
    const buf = new ArrayBuffer(size);
    return {
        buffer: buf,
        u8: new Uint8Array(buf),
        offset: 0,
    };
}
function allocFromUdpPool(id, dataPtr, dataLength) {
    let pool = UDPSocketBufferPool[id];
    if (!pool) {
        pool = createUdpBufferPool(Math.max(UDP_POOL_INITIAL_SIZE, dataLength + UDP_POOL_GROW_EXTRA));
        UDPSocketBufferPool[id] = pool;
    }
    if (dataLength > pool.buffer.byteLength) {
        // 单包超过池容量：扩容并从头分配
        const newSize = dataLength + UDP_POOL_GROW_EXTRA;
        pool.buffer = new ArrayBuffer(newSize);
        pool.u8 = new Uint8Array(pool.buffer);
        pool.offset = 0;
    }
    else if (pool.offset + dataLength > pool.buffer.byteLength) {
        // 剩余空间不足：回环
        pool.offset = 0;
    }
    const start = pool.offset;
    pool.u8.set(GameGlobal.Module.HEAPU8.subarray(dataPtr, dataPtr + dataLength), start);
    pool.offset = start + dataLength;
    return { buffer: pool.buffer, offset: start, length: dataLength };
}
function WX_CreateUDPSocket() {
    const obj = wx.createUDPSocket();
    const key = uid();
    UDPSocketList[key] = obj;
    UDPSocketBufferPool[key] = createUdpBufferPool(UDP_POOL_INITIAL_SIZE);
    return key;
}
function WX_UDPSocketClose(id) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return;
    }
    obj.close();
    delete UDPSocketList[id];
    delete UDPSocketBufferPool[id];
    releaseRecvBuffers(id);
}
function WX_UDPSocketConnect(id, option) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return;
    }
    obj.connect(formatJsonStr(option));
}
function WX_UDPSocketOffClose(id) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return;
    }
    offEventCallback(wxUDPSocketCloseList, (v) => {
        obj.offClose(v);
    }, id);
}
function WX_UDPSocketOffError(id) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return;
    }
    offEventCallback(wxUDPSocketErrorList, (v) => {
        obj.offError(v);
    }, id);
}
function WX_UDPSocketOffListening(id) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return;
    }
    offEventCallback(wxUDPSocketListeningList, (v) => {
        obj.offListening(v);
    }, id);
}
function WX_UDPSocketOffMessage(id) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return;
    }
    offEventCallback(wxUDPSocketMessageList, (v) => {
        obj.offMessage(v);
    }, id);
}
function WX_UDPSocketOnClose(id) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return;
    }
    const callback = onEventCallback(wxUDPSocketCloseList, '_UDPSocketOnCloseCallback', id, id);
    obj.onClose(callback);
}
function WX_UDPSocketOnError(id) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return;
    }
    const callback = onEventCallback(wxUDPSocketErrorList, '_UDPSocketOnErrorCallback', id, id);
    obj.onError(callback);
}
function WX_UDPSocketOnListening(id) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return;
    }
    const callback = onEventCallback(wxUDPSocketListeningList, '_UDPSocketOnListeningCallback', id, id);
    obj.onListening(callback);
}
function WX_UDPSocketOnMessage(id, needInfo) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return;
    }
    if (!wxUDPSocketMessageList[id]) {
        wxUDPSocketMessageList[id] = [];
    }
    
    const Module = GameGlobal.Module;
    const callback = (res) => {
        try {
            if (!wxUDPSocketOnMessageCallbackV2) {
                
                formatResponse('UDPSocketOnMessageListenerResult', res);
                const idPtr = convertDataToPointer(id);
                const messagePtr = convertDataToPointer(res.message);
                if (needInfo) {
                    const localInfoPtr = convertInfoToPointer(res.localInfo);
                    const remoteInfoPtr = convertInfoToPointer(res.remoteInfo);
                    Module.dynCall_viiiii(wxUDPSocketOnMessageCallback, idPtr, messagePtr, res.message.length || res.message.byteLength, localInfoPtr, remoteInfoPtr);
                    Module._free(localInfoPtr);
                    Module._free(remoteInfoPtr);
                }
                else {
                    Module.dynCall_viiiii(wxUDPSocketOnMessageCallback, idPtr, messagePtr, res.message.length || res.message.byteLength, 0, 0);
                }
                Module._free(idPtr);
                Module._free(messagePtr);
                return;
            }
            
            const message = res.message;
            const remoteInfo = needInfo ? res.remoteInfo : null;
            const msgLen = (message && (message.byteLength || message.length)) || 0;
            const idPtr = allocateUTF8WithBuffer(id, UDPSocketIdBuffers, id);
            let msgPtr = 0;
            if (msgLen > 0 && message) {
                msgPtr = allocateDataBuffer(msgLen, UDPSocketMessageBuffers, id);
                if (msgPtr) {
                    Module.HEAPU8.set(message instanceof Uint8Array ? message : new Uint8Array(message), msgPtr);
                }
            }
            let family = 0;
            let remoteAddrPtr = 0;
            let remotePort = 0;
            let localAddrPtr = 0;
            let localPort = 0;
            if (remoteInfo) {
                const fam = remoteInfo.family;
                family = fam === 'IPv6' ? 2 : (fam === 'IPv4' ? 1 : 0);
                remoteAddrPtr = allocateUTF8WithBuffer(remoteInfo.address || '', UDPSocketRemoteIpBuffers, id);
                remotePort = remoteInfo.port | 0;
                // localInfo 兜底：部分基础库版本不下发 res.localInfo，只在 remoteInfo 上挂 localaddress/localport
                const localInfo = res.localInfo;
                const localAddr = (localInfo && localInfo.address)
                    ? localInfo.address
                    : (remoteInfo.localaddress || '');
                const lp = (localInfo && localInfo.port)
                    ? localInfo.port
                    : (remoteInfo.localport || 0);
                if (localAddr) {
                    localAddrPtr = allocateUTF8WithBuffer(localAddr, UDPSocketLocalIpBuffers, id);
                }
                localPort = lp | 0;
            }
            Module.dynCall_viiiiiiii(wxUDPSocketOnMessageCallbackV2, idPtr, msgPtr, msgLen, family, remoteAddrPtr, remotePort, localAddrPtr, localPort);
            
        }
        catch (e) {
            console.error(`udp socket ${id} onMessage error:`, e);
        }
    };
    wxUDPSocketMessageList[id].push(callback);
    obj.onMessage(callback);
}
function WX_UDPSocketSendString(id, data, param) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return;
    }
    const config = formatJsonStr(param);
    obj.send({
        address: config.address,
        message: data,
        port: config.port,
        setBroadcast: config.setBroadcast,
    });
}
function WX_UDPSocketSendBuffer(id, dataPtr, dataLength, param) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return;
    }
    const config = formatJsonStr(param);
    const alloc = allocFromUdpPool(id, dataPtr, dataLength);
    const wxOffset = alloc.offset + (config.offset || 0);
    const wxLength = (config.length != null) ? config.length : alloc.length;
    obj.send({
        address: config.address,
        message: alloc.buffer,
        port: config.port,
        length: wxLength,
        offset: wxOffset,
        setBroadcast: config.setBroadcast,
    });
}
function WX_UDPSocketSetTTL(id, ttl) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return;
    }
    obj.setTTL(ttl);
}
function WX_UDPSocketWriteString(id, data, param) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return;
    }
    const config = formatJsonStr(param);
    obj.write({
        address: config.address,
        message: data,
        port: config.port,
        setBroadcast: config.setBroadcast,
    });
}
function WX_UDPSocketWriteBuffer(id, dataPtr, dataLength, param) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return;
    }
    const config = formatJsonStr(param);
    const alloc = allocFromUdpPool(id, dataPtr, dataLength);
    const wxOffset = alloc.offset + (config.offset || 0);
    const wxLength = (config.length != null) ? config.length : alloc.length;
    obj.write({
        address: config.address,
        message: alloc.buffer,
        port: config.port,
        length: wxLength,
        offset: wxOffset,
        setBroadcast: config.setBroadcast,
    });
}
function WX_UDPSocketBind(id, param) {
    const obj = getUDPSocketObject(id);
    if (!obj) {
        return 0;
    }
    const config = formatJsonStr(param);
    return obj.bind(config.port);
}
function WX_RegisterUDPSocketOnMessageCallback(callback) {
    wxUDPSocketOnMessageCallback = callback;
}
function WX_RegisterUDPSocketOnMessageCallbackV2(callback) {
    wxUDPSocketOnMessageCallbackV2 = callback;
}
export default {
    WX_CreateUDPSocket,
    WX_UDPSocketBind,
    WX_UDPSocketClose,
    WX_UDPSocketConnect,
    WX_UDPSocketOffClose,
    WX_UDPSocketOffError,
    WX_UDPSocketOffListening,
    WX_UDPSocketOffMessage,
    WX_UDPSocketOnClose,
    WX_UDPSocketOnError,
    WX_UDPSocketOnListening,
    WX_UDPSocketOnMessage,
    WX_UDPSocketSendString,
    WX_UDPSocketSendBuffer,
    WX_UDPSocketSetTTL,
    WX_UDPSocketWriteString,
    WX_UDPSocketWriteBuffer,
    WX_RegisterUDPSocketOnMessageCallback,
    WX_RegisterUDPSocketOnMessageCallbackV2,
};
