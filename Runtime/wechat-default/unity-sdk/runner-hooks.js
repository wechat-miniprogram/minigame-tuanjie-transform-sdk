const beginListeners = [];
const endListeners = [];
export function addRunnerBeginListener(fn) {
    beginListeners.push(fn);
}
export function addRunnerEndListener(fn) {
    endListeners.push(fn);
}

function invokeBegin() {
    for (let i = 0; i < beginListeners.length; i++) {
        beginListeners[i]();
    }
}
function invokeEnd() {
    for (let i = 0; i < endListeners.length; i++) {
        endListeners[i]();
    }
}

GameGlobal.unityNamespace = GameGlobal.unityNamespace || {};
GameGlobal.unityNamespace.onRunnerBegin = invokeBegin;
GameGlobal.unityNamespace.onRunnerEnd = invokeEnd;
