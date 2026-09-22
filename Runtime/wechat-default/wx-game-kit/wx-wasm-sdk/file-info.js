function getObjectSize(data) {
    if (data && (typeof data === 'string' || data.byteLength)) {
        return data.byteLength || data.length || 0;
    }
    return 0;
}
export const fileInfoHandler = {
    addFileInfo(filePath, data) {
        if (WXGameKit.fs && WXGameKit.fs.addFileInfo) {
            WXGameKit.fs.addFileInfo({ path: filePath, size: getObjectSize(data), erasable: false });
        }
    },
    modifyFileInfo(filePath, data) {
        if (WXGameKit.fs && WXGameKit.fs.modifyFileInfo) {
            WXGameKit.fs.modifyFileInfo({ path: filePath, size: getObjectSize(data) });
        }
    },
    removeFileInfo(filePath) {
        if (WXGameKit.fs && WXGameKit.fs.removeFileInfo) {
            WXGameKit.fs.removeFileInfo(filePath);
        }
    },
};
export const fileInfoType = {
    add: 0,
    remove: 1,
    modify: 2,
};
export function responseWrapper(responseHandler, info) {
    const { filePath, data, type } = info;
    return {
        success(res) {
            if (type === fileInfoType.add) {
                fileInfoHandler.addFileInfo(filePath, data);
            }
            if (type === fileInfoType.remove) {
                fileInfoHandler.removeFileInfo(filePath);
            }
            if (type === fileInfoType.modify) {
                fileInfoHandler.modifyFileInfo(filePath, data);
            }
            responseHandler.success(res);
        },
        fail: responseHandler.fail,
        complete: responseHandler.complete,
    };
}
