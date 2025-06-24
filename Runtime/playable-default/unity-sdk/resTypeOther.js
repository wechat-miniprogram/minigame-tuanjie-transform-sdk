export const ResTypeOther = {
    Stats: {
        lastAccessedTime: 'number',
        lastModifiedTime: 'number',
        mode: 'number',
        size: 'number',
    },
    TCPSocketOnMessageListenerResult: {
        localInfo: 'LocalInfo',
        message: 'arrayBuffer',
        remoteInfo: 'RemoteInfo',
    },
    LocalInfo: {
        address: 'string',
        family: 'string',
        port: 'number',
    },
    RemoteInfo: {
        address: 'string',
        family: 'string',
        port: 'number',
    },
    UDPSocketConnectOption: {
        address: 'string',
        port: 'number',
    },
    UDPSocketOnMessageListenerResult: {
        localInfo: 'LocalInfo',
        message: 'arrayBuffer',
        remoteInfo: 'RemoteInfo',
    },
    UDPSocketSendOption: {
        address: 'string',
        message: 'string|arrayBuffer',
        port: 'number',
        length: 'number',
        offset: 'number',
        setBroadcast: 'bool',
    },
    UDPSocketSendParam: {
        address: 'string',
        port: 'number',
        length: 'number',
        offset: 'number',
        setBroadcast: 'bool',
    },
    CallFunctionResult: {
        result: 'string',
        requestID: 'string',
        errMsg: 'string',
    },
    CallContainerResult: {
        data: 'string',
        statusCode: 'number',
        header: 'object',
        callID: 'string',
        errMsg: 'string',
    },
    UploadFileResult: {
        fileID: 'string',
        statusCode: 'number',
        errMsg: 'string',
    },
    DownloadFileResult: {
        tempFilePath: 'string',
        statusCode: 'number',
        errMsg: 'string',
    },
    GetTempFileURLResult: {
        fileList: 'GetTempFileURLResultItem[]',
        errMsg: 'string',
    },
    GetTempFileURLResultItem: {
        fileID: 'string',
        tempFileURL: 'string',
        maxAge: 'number',
        status: 'number',
        errMsg: 'string',
    },
    DeleteFileResult: {
        fileList: 'DeleteFileResultItem[]',
        errMsg: 'string',
    },
    DeleteFileResultItem: {
        fileID: 'string',
        status: 'number',
        errMsg: 'string',
    },
};
