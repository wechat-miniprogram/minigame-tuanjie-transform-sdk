mergeInto(LibraryManager.library, {
    // 定义供 C/C++ 调用的 JS 函数  
    js_batchRender_malloc: function(data, size, isSync) {
        // 直接从 WASM 内存创建视图（零拷贝）
        const targetBuffer = new Uint8Array(Module.HEAPU8.buffer, data, size);
        //console.log("processBinaryData invoke");
        const extBuffer = new ArrayBuffer(1); 

        if(!isSync){
            mtl.batchRenderAsync(targetBuffer, extBuffer); 
            return null;
        }
        const response = mtl.batchRender(targetBuffer, extBuffer);
        if (!response) {
          return null;
        }
        const result = response.buffer;
        if(!result || result.byteLength == 0){
            return null;
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