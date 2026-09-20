#if UNITY_WEBGL || WEIXINMINIGAME || UNITY_EDITOR
using System;
using System.Runtime.InteropServices;
using UnityEngine;

namespace WeChatWASM
{
    /// <summary>
    /// WebGPU 截帧能力
    ///
    /// 底层调用小游戏基础库的 canvas.getContext('webgpu').webgpu.captureFrame()，
    /// 该接口是异步的，截帧产物会写入用户目录（形如 ${wx.env.USER_DATA_PATH}/wgpuc_xxx.wgpuc），
    /// 完成后通过回调把文件保存路径返回给 C#。
    /// </summary>
    public static class WXWebGPUFrameCapture
    {
        private const string CallbackGameObjectName = "WXWebGPUFrameCaptureCallback";
        private const string CallbackMethodName = "OnWebGPUFrameCaptured";

#if !UNITY_EDITOR
        [DllImport("__Internal", EntryPoint = "WX_CaptureWebGPUFrame")]
        private static extern void WX_CaptureWebGPUFrame(string gameObjectName, string methodName, int timeoutMs);
#endif

        private static Action<string> s_callback;

        /// <summary>
        /// 截取当前一帧并落盘（异步）
        /// </summary>
        /// <param name="callback">完成回调，参数为截帧文件的保存路径；失败或当前环境不支持时返回空字符串</param>
        /// <param name="timeoutMs">超时时间（毫秒），小于等于 0 时使用基础库默认值</param>
        public static void CaptureWebGPUFrame(Action<string> callback, int timeoutMs = 0)
        {
            s_callback = callback;
#if UNITY_EDITOR
            UnityEngine.Debug.LogWarning("[WX WebGPU] CaptureWebGPUFrame 仅在微信小游戏（WebGPU）运行环境下可用");
            InvokeCallback(string.Empty);
#else
            EnsureReceiver();
            try
            {
                WX_CaptureWebGPUFrame(CallbackGameObjectName, CallbackMethodName, timeoutMs);
            }
            catch (Exception e)
            {
                UnityEngine.Debug.LogWarning("[WX WebGPU] CaptureWebGPUFrame 调用失败: " + e.Message);
                InvokeCallback(string.Empty);
            }
#endif
        }

        private static void EnsureReceiver()
        {
            var go = GameObject.Find(CallbackGameObjectName);
            if (go == null)
            {
                go = new GameObject(CallbackGameObjectName);
                UnityEngine.Object.DontDestroyOnLoad(go);
            }
            if (go.GetComponent<WXWebGPUFrameCaptureReceiver>() == null)
            {
                go.AddComponent<WXWebGPUFrameCaptureReceiver>();
            }
        }

        private static void InvokeCallback(string filePath)
        {
            var callback = s_callback;
            s_callback = null;
            if (callback != null)
            {
                callback.Invoke(filePath ?? string.Empty);
            }
        }

        /// <summary>
        /// 内部使用：接收 JS 侧 SendMessage 回调的组件，请勿手动挂载
        /// </summary>
        public class WXWebGPUFrameCaptureReceiver : MonoBehaviour
        {
            // 由 JS 侧通过 Module.SendMessage(gameObjectName, 'OnWebGPUFrameCaptured', filePath) 调用
            public void OnWebGPUFrameCaptured(string filePath)
            {
                InvokeCallback(filePath);
            }
        }
    }
}
#endif
