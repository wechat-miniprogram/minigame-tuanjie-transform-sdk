using UnityEngine;
using WeChatWASM;

namespace WeChatWASM.Examples
{
    /// <summary>
    /// PC高性能小游戏通信测试示例
    /// 
    /// 通信链路：
    /// 1. C# 调用 ShowToast
    /// 2. WXPCHPInitScript.CallWXAPI 构建 PCHPRequestMessage
    /// 3. SendMsgAsync -> direct_applet_sdk.dll -> 内核
    /// 4. 内核 -> 基础库 pc-adapter -> game.js
    /// 5. game.js 执行 wx.showToast
    /// 6. 回调 -> 基础库 -> 内核 -> DLL -> HandleAsyncMessage
    /// 7. 解析 PCHPResponseMessage -> 触发 C# 回调
    /// </summary>
    public class PCHPTestExample : MonoBehaviour
    {
        private WXPCHighPerformanceManager _pcManager;

        private void Start()
        {
            Debug.Log("[PCHPTestExample] Start - 获取 PC 高性能管理器");
            
#if UNITY_STANDALONE_WIN
            _pcManager = WXPCHighPerformanceManager.GetInstance();
            
            if (_pcManager != null && _pcManager.IsSupported)
            {
                Debug.Log("[PCHPTestExample] PC 高性能模式已支持！");
            }
            else
            {
                Debug.LogWarning("[PCHPTestExample] PC 高性能模式不可用");
            }
#else
            Debug.Log("[PCHPTestExample] 当前平台非 Windows，PC 高性能模式不可用");
#endif
        }

        /// <summary>
        /// 测试 ShowToast - 在 Inspector 中调用或通过 UI 按钮调用
        /// </summary>
        [ContextMenu("Test ShowToast")]
        public void TestShowToast()
        {
            if (_pcManager == null || !_pcManager.IsSupported)
            {
                Debug.LogError("[PCHPTestExample] PC 高性能模式不可用");
                return;
            }

            Debug.Log("[PCHPTestExample] 调用 ShowToast...");
            
            _pcManager.ShowToast(
                new PCHPShowToastOption
                {
                    title = "Hello from Unity!",
                    icon = "success",
                    duration = 2000,
                    mask = false
                },
                success: (res) =>
                {
                    Debug.Log($"[PCHPTestExample] ShowToast 成功: {res.errMsg}");
                },
                fail: (res) =>
                {
                    Debug.LogError($"[PCHPTestExample] ShowToast 失败: {res.errMsg}");
                },
                complete: (res) =>
                {
                    Debug.Log($"[PCHPTestExample] ShowToast 完成");
                }
            );
        }

        /// <summary>
        /// 测试 ShowModal - 在 Inspector 中调用或通过 UI 按钮调用
        /// </summary>
        [ContextMenu("Test ShowModal")]
        public void TestShowModal()
        {
            if (_pcManager == null || !_pcManager.IsSupported)
            {
                Debug.LogError("[PCHPTestExample] PC 高性能模式不可用");
                return;
            }

            Debug.Log("[PCHPTestExample] 调用 ShowModal...");
            
            _pcManager.ShowModal(
                new PCHPShowModalOption
                {
                    title = "提示",
                    content = "这是一个来自 Unity 的模态框测试",
                    showCancel = true,
                    cancelText = "取消",
                    confirmText = "确定"
                },
                success: (res) =>
                {
                    if (res.confirm)
                    {
                        Debug.Log("[PCHPTestExample] 用户点击了确定");
                    }
                    else if (res.cancel)
                    {
                        Debug.Log("[PCHPTestExample] 用户点击了取消");
                    }
                },
                fail: (res) =>
                {
                    Debug.LogError($"[PCHPTestExample] ShowModal 失败: {res.errMsg}");
                },
                complete: (res) =>
                {
                    Debug.Log($"[PCHPTestExample] ShowModal 完成");
                }
            );
        }

        /// <summary>
        /// 测试 ShowLoading - 在 Inspector 中调用或通过 UI 按钮调用
        /// </summary>
        [ContextMenu("Test ShowLoading")]
        public void TestShowLoading()
        {
            if (_pcManager == null || !_pcManager.IsSupported)
            {
                Debug.LogError("[PCHPTestExample] PC 高性能模式不可用");
                return;
            }

            Debug.Log("[PCHPTestExample] 调用 ShowLoading...");
            
            _pcManager.ShowLoading("加载中...", true,
                success: (res) =>
                {
                    Debug.Log($"[PCHPTestExample] ShowLoading 成功");
                    
                    // 2秒后隐藏
                    StartCoroutine(HideLoadingAfterDelay(2f));
                },
                fail: (res) =>
                {
                    Debug.LogError($"[PCHPTestExample] ShowLoading 失败: {res.errMsg}");
                }
            );
        }

        private System.Collections.IEnumerator HideLoadingAfterDelay(float delay)
        {
            yield return new WaitForSeconds(delay);
            
            _pcManager?.HideLoading(
                success: (res) =>
                {
                    Debug.Log("[PCHPTestExample] HideLoading 成功");
                }
            );
        }

        /// <summary>
        /// 测试通用 API 调用
        /// </summary>
        [ContextMenu("Test Generic API Call")]
        public void TestGenericAPICall()
        {
            if (_pcManager == null || !_pcManager.IsSupported)
            {
                Debug.LogError("[PCHPTestExample] PC 高性能模式不可用");
                return;
            }

            Debug.Log("[PCHPTestExample] 调用通用 API (getSystemInfoSync)...");
            
            // 示例：调用任意 wx API
            _pcManager.CallWXAPI(
                "getSystemInfo",
                new { }, // 无参数
                onSuccess: (res) =>
                {
                    Debug.Log($"[PCHPTestExample] getSystemInfo 成功: {res}");
                },
                onFail: (res) =>
                {
                    Debug.LogError($"[PCHPTestExample] getSystemInfo 失败: {res}");
                },
                onComplete: (res) =>
                {
                    Debug.Log("[PCHPTestExample] getSystemInfo 完成");
                }
            );
        }

        /// <summary>
        /// 测试事件监听
        /// </summary>
        [ContextMenu("Test Event Listener")]
        public void TestEventListener()
        {
            if (_pcManager == null || !_pcManager.IsSupported)
            {
                Debug.LogError("[PCHPTestExample] PC 高性能模式不可用");
                return;
            }

            Debug.Log("[PCHPTestExample] 注册 onShow 事件监听...");
            
            _pcManager.On("onShow", (data) =>
            {
                Debug.Log($"[PCHPTestExample] 收到 onShow 事件: {data}");
            });

            _pcManager.On("onHide", (data) =>
            {
                Debug.Log($"[PCHPTestExample] 收到 onHide 事件: {data}");
            });
        }

        private void OnGUI()
        {
            // 简单的测试按钮 UI
            GUILayout.BeginArea(new Rect(10, 10, 200, 300));
            GUILayout.Label("PC高性能小游戏测试");
            
            if (GUILayout.Button("ShowToast"))
            {
                TestShowToast();
            }
            
            if (GUILayout.Button("ShowModal"))
            {
                TestShowModal();
            }
            
            if (GUILayout.Button("ShowLoading"))
            {
                TestShowLoading();
            }
            
            if (GUILayout.Button("GetSystemInfo"))
            {
                TestGenericAPICall();
            }
            
            if (GUILayout.Button("Register Events"))
            {
                TestEventListener();
            }
            
            GUILayout.EndArea();
        }
    }
}
