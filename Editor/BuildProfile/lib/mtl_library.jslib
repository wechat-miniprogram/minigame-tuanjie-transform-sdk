mergeInto(LibraryManager.library, {
    // 定义供 C/C++ 调用的 JS 函数  
    js_batchRender_malloc: function(data, size, isSync) {
        // 直接从 WASM 内存创建视图（零拷贝）
        const binaryData = new Uint8Array(Module.HEAPU8.buffer, data, size);
        // 转换为标准 ArrayBuffer（如果需要复制）
        const targetBuffer =
            binaryData.buffer.slice(binaryData.byteOffset, binaryData.byteOffset + binaryData.byteLength);
        //console.log("processBinaryData invoke");
        const extBuffer = new ArrayBuffer(1);   
        const headerBuffer = new ArrayBuffer(8);
        const headerBufferView = new DataView(headerBuffer);    
        headerBufferView.setUint32(0, 0xDEC0DE, true);
        headerBufferView.setUint32(4, mtl.ctx.__uid(), true);   
        const merged = new Uint8Array(headerBuffer.byteLength + targetBuffer.byteLength);   
        merged.set(new Uint8Array(headerBuffer), 0);
        merged.set(new Uint8Array(targetBuffer), headerBuffer.byteLength);  
        if(!isSync){
            mtl.batchRenderAsync(merged.buffer, extBuffer); 
            return null;
        }
        const result = mtl.batchRender(merged.buffer, extBuffer).buffer;
        if(result.byteLength == 0){
            return null;;
        }
        // 申请内存空间,后续在cpp wasm部分使用，记得释放
        const ptr = Module._malloc(result.byteLength);
        // 将数据拷贝到WASM内存
        Module.HEAPU8.set(new Uint8Array(result), ptr);
        // 返回结构化的数据信息（指针和长度）
        const ret = new DataView(new ArrayBuffer(8));
        ret.setUint32(0, ptr, true);    // 指针地址（4字节）
        ret.setUint32(4, result.byteLength, true);  // 数据长度（4字节）
        // 返回合并后的8字节缓冲区指针，记得也要在cpp部分释放
        const retPtr = Module._malloc(8);
        Module.HEAPU8.set(new Uint8Array(ret.buffer), retPtr);
        return retPtr;

    },
    js_swapWindow: function(){
        mtl.swapWindow();
    }
  });