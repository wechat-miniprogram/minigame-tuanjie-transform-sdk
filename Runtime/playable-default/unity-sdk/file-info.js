/**
 * 计算string或arraybuffer的大小，用于同步插件侧文件大小变更
 * string粗暴的判断length，不检查是否中文
 *
 * @export
 * @param {(string | ArrayBuffer)} data
 * @returns
 */
function getObjectSize(data) {
    if (data && (typeof data === 'string' || data.byteLength)) {
        return data.byteLength || data.length || 0;
    }
    return 0;
}
/**
 * 开发者自己写入的文件，将文件信息同步到插件，开发者自行写入的文件，不纳入自动清理的范围
 * 20240510: 只处理writeFile(Sync)，unlink(Sync)
 */
export const fileInfoHandler = {
    addFileInfo(filePath, data) {
        if (GameGlobal.manager.fs && GameGlobal.manager.fs.addFileInfo) {
            GameGlobal.manager.fs.addFileInfo({ path: filePath, size: getObjectSize(data), erasable: false });
        }
    },
    modifyFileInfo(filePath, data) {
        if (GameGlobal.manager.fs && GameGlobal.manager.fs.modifyFileInfo) {
            GameGlobal.manager.fs.modifyFileInfo({ path: filePath, size: getObjectSize(data) });
        }
    },
    removeFileInfo(filePath) {
        if (GameGlobal.manager.fs && GameGlobal.manager.fs.removeFileInfo) {
            GameGlobal.manager.fs.removeFileInfo(filePath);
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
