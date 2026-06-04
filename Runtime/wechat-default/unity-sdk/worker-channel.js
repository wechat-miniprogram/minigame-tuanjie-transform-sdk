import { addRunnerEndListener } from './runner-hooks';
const HEADER_SIZE = 12;
const DEFAULT_BUFFER_SIZE = 256 * 1024; 
const CHUNK_SIZE = 8192;

function utf8Encode(str) {
    const len = str.length;
    const bytes = new Uint8Array(len * 4);
    let pos = 0;
    for (let i = 0; i < len; i++) {
        let cp = str.charCodeAt(i);
        if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < len) {
            const lo = str.charCodeAt(i + 1);
            if (lo >= 0xDC00 && lo <= 0xDFFF) {
                cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                i++;
            }
        }
        if (cp < 0x80) {
            bytes[pos++] = cp;
        }
        else if (cp < 0x800) {
            bytes[pos++] = 0xC0 | (cp >> 6);
            bytes[pos++] = 0x80 | (cp & 0x3F);
        }
        else if (cp < 0x10000) {
            bytes[pos++] = 0xE0 | (cp >> 12);
            bytes[pos++] = 0x80 | ((cp >> 6) & 0x3F);
            bytes[pos++] = 0x80 | (cp & 0x3F);
        }
        else {
            bytes[pos++] = 0xF0 | (cp >> 18);
            bytes[pos++] = 0x80 | ((cp >> 12) & 0x3F);
            bytes[pos++] = 0x80 | ((cp >> 6) & 0x3F);
            bytes[pos++] = 0x80 | (cp & 0x3F);
        }
    }
    return bytes.subarray(0, pos);
}
function utf8Decode(bytes) {
    const len = bytes.length;
    const codes = new Array(len);
    let ci = 0;
    for (let i = 0; i < len;) {
        const b = bytes[i];
        if (b < 0x80) {
            codes[ci++] = b;
            i++;
        }
        else if ((b & 0xE0) === 0xC0) {
            codes[ci++] = ((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F);
            i += 2;
        }
        else if ((b & 0xF0) === 0xE0) {
            codes[ci++] = ((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F);
            i += 3;
        }
        else {
            const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
            codes[ci++] = 0xD800 + ((cp - 0x10000) >> 10);
            codes[ci++] = 0xDC00 + ((cp - 0x10000) & 0x3FF);
            i += 4;
        }
    }
    if (ci <= CHUNK_SIZE) {
        return String.fromCharCode.apply(null, codes.slice(0, ci));
    }
    let str = '';
    for (let i = 0; i < ci; i += CHUNK_SIZE) {
        str += String.fromCharCode.apply(null, codes.slice(i, Math.min(i + CHUNK_SIZE, ci)));
    }
    return str;
}
function replaceBufRefs(obj, buffers) {
    if (!obj || typeof obj !== 'object')
        return;
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            const item = obj[i];
            if (item && typeof item === 'object') {
                if (typeof item.__bufIdx === 'number') {
                    obj[i] = buffers[item.__bufIdx];
                }
                else {
                    replaceBufRefs(item, buffers);
                }
            }
        }
    }
    else {
        const keys = Object.keys(obj);
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const v = obj[k];
            if (v && typeof v === 'object') {
                if (typeof v.__bufIdx === 'number') {
                    obj[k] = buffers[v.__bufIdx];
                }
                else {
                    replaceBufRefs(v, buffers);
                }
            }
        }
    }
}

export class WorkerChannel {
    bufferSize;
    frameBatch;
    sab = null;
    flagArray = null;
    dataView = null;
    worker = null;
    ready = false;
    batchQueue = [];
    constructor(options) {
        const opts = options || {};
        this.bufferSize = opts.bufferSize || DEFAULT_BUFFER_SIZE;
        this.frameBatch = opts.frameBatch !== false;
        addRunnerEndListener(() => this.flush());
    }
        create(workerPath, initPayload) {
        this.worker = wx.createWorker(workerPath);
        this.sab = new SharedArrayBuffer(this.bufferSize);
        this.flagArray = new Int32Array(this.sab, 0, 1);
        this.dataView = new DataView(this.sab);
        this.ready = true;
        const msg = {
            type: 'WORKER_SAB_INIT',
            buffer: this.sab,
            initPayload: initPayload || null,
        };
        this.worker.postMessage(msg);
    }
        postQueued(type, payload) {
        if (!this.frameBatch) {
            if (!this.writeCommand([{ type, payload }])) {
                this.batchQueue.push({ type, payload });
            }
            return;
        }
        this.batchQueue.push({ type, payload });
    }
        flush() {
        if (!this.batchQueue.length)
            return;
        const msgs = this.batchQueue;
        this.batchQueue = [];
        if (!this.writeCommand(msgs)) {
            this.batchQueue = msgs.concat(this.batchQueue);
        }
    }
        isReady() {
        return this.ready;
    }
        readCommand() {
        if (!this.sab || !this.flagArray || !this.dataView)
            return null;
        if (Atomics.load(this.flagArray, 0) !== 1)
            return null;
        const jsonLen = this.dataView.getUint32(4);
        const bufCount = this.dataView.getUint32(8);
        if (jsonLen === 0 || jsonLen > this.bufferSize - HEADER_SIZE) {
            Atomics.store(this.flagArray, 0, 0);
            return null;
        }
        const jsonBytes = new Uint8Array(this.sab, HEADER_SIZE, jsonLen);
        const json = utf8Decode(jsonBytes);
        let buffers = null;
        if (bufCount > 0) {
            buffers = new Array(bufCount);
            let offset = HEADER_SIZE + jsonLen;
            for (let i = 0; i < bufCount; i++) {
                const bufLen = this.dataView.getUint32(offset);
                offset += 4;
                const copy = new Uint8Array(bufLen);
                copy.set(new Uint8Array(this.sab, offset, bufLen));
                buffers[i] = copy.buffer;
                offset += bufLen;
            }
        }
        Atomics.store(this.flagArray, 0, 0);
        try {
            const cmds = JSON.parse(json);
            if (buffers)
                replaceBufRefs(cmds, buffers);
            return cmds;
        }
        catch (e) {
            return null;
        }
    }
        initWorkerSide(dispatchFn) {
        worker.onMessage((res) => {
            const { type } = res;
            if (type === 'WORKER_SAB_INIT') {
                let buffer = res.buffer;
                
                if (buffer && buffer.constructor && buffer.constructor.name !== 'SharedArrayBuffer') {
                    if (buffer.buffer && buffer.buffer.constructor && buffer.buffer.constructor.name === 'SharedArrayBuffer') {
                        buffer = buffer.buffer;
                    }
                }
                this.sab = buffer;
                this.flagArray = new Int32Array(buffer, 0, 1);
                this.dataView = new DataView(buffer);
                if (res.initPayload) {
                    dispatchFn(res.initPayload);
                }
                setInterval(() => {
                    const cmds = this.readCommand();
                    if (!cmds)
                        return;
                    for (let i = 0; i < cmds.length; i++) {
                        const cmd = cmds[i];
                        if (cmd && typeof cmd.type === 'number') {
                            dispatchFn(cmd);
                        }
                    }
                }, 1);
                console.warn('[worker-channel] SAB ready');
                return;
            }
            
            if (typeof type === 'number' && type >= 100) {
                dispatchFn({ type, payload: res.payload });
            }
        });
    }
    
    writeCommand(cmdArray, buffers) {
        if (!this.sab || !this.flagArray || !this.dataView)
            return false;
        if (Atomics.load(this.flagArray, 0) === 1) {
            return false;
        }
        const json = JSON.stringify(cmdArray);
        const jsonBytes = utf8Encode(json);
        const jsonLen = jsonBytes.byteLength || jsonBytes.length;
        const bufCount = buffers ? buffers.length : 0;
        let bufTotalLen = 0;
        if (bufCount > 0 && buffers) {
            for (let i = 0; i < bufCount; i++) {
                bufTotalLen += 4 + buffers[i].byteLength;
            }
        }
        const totalLen = jsonLen + bufTotalLen;
        const dataSize = this.bufferSize - HEADER_SIZE;
        if (totalLen > dataSize) {
            console.warn('[worker-channel] command too large, drop:', totalLen);
            return false;
        }
        this.dataView.setUint32(4, jsonLen);
        this.dataView.setUint32(8, bufCount);
        const jsonDst = new Uint8Array(this.sab, HEADER_SIZE, jsonLen);
        jsonDst.set(jsonBytes);
        if (bufCount > 0 && buffers) {
            let offset = HEADER_SIZE + jsonLen;
            for (let i = 0; i < bufCount; i++) {
                const buf = buffers[i];
                const bufLen = buf.byteLength;
                this.dataView.setUint32(offset, bufLen);
                offset += 4;
                const dst = new Uint8Array(this.sab, offset, bufLen);
                dst.set(new Uint8Array(buf));
                offset += bufLen;
            }
        }
        Atomics.store(this.flagArray, 0, 1);
        return true;
    }
}
