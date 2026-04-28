// WX_PCHP_ENABLED: PC高性能模式总开关
// 路径A（转换工具链）: 由转换工具自动添加到 ScriptingDefineSymbols
// 路径B（原生接入）: 开发者手动添加，或通过 Editor 菜单一键开启
#if WX_PCHP_ENABLED
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using UnityEngine;
using LitJson;

namespace WeChatWASM
{
    #region Message Protocol Models

    /// <summary>
    /// PC高性能方案通信协议 - 请求消息
    /// C# -> DLL -> 内核 -> 基础库
    /// </summary>
    [Serializable]
    public class PCHPRequestMessage
    {
        /// <summary>
        /// 消息类型: "request" | "event_register" | "event_unregister"
        /// </summary>
        public string type;

        /// <summary>
        /// 请求ID，用于匹配回调
        /// </summary>
        public string requestId;

        /// <summary>
        /// API名称，如 "showToast", "login" 等
        /// </summary>
        public string api;

        /// <summary>
        /// API参数，JSON格式
        /// </summary>
        public string data;

        /// <summary>
        /// 时间戳
        /// </summary>
        public long timestamp;
    }

    /// <summary>
    /// PC高性能方案通信协议 - 响应消息
    /// 基础库 -> 内核 -> DLL -> C#
    /// </summary>
    [Serializable]
    public class PCHPResponseMessage
    {
        /// <summary>
        /// 消息类型: "response" | "event"
        /// </summary>
        public string type;

        /// <summary>
        /// 请求ID，与请求消息匹配
        /// </summary>
        public string requestId;

        /// <summary>
        /// 回调类型: "success" | "fail" | "complete"
        /// </summary>
        public string callbackType;

        /// <summary>
        /// API名称（事件类型时使用）
        /// </summary>
        public string api;

        /// <summary>
        /// 响应数据，JSON格式
        /// </summary>
        public string data;

        /// <summary>
        /// 错误信息（失败时）
        /// </summary>
        public string errMsg;

        /// <summary>
        /// 时间戳
        /// </summary>
        public long timestamp;
    }

    /// <summary>
    /// 通用回调结果
    /// </summary>
    [Serializable]
    public class PCHPGeneralCallbackResult
    {
        public string errMsg;
    }

    /// <summary>
    /// ShowToast 参数
    /// </summary>
    [Serializable]
    public class PCHPShowToastOption
    {
        public string title;
        public string icon;
        public string image;
        public int duration;
        public bool mask;
    }

    /// <summary>
    /// ShowModal 参数
    /// </summary>
    [Serializable]
    public class PCHPShowModalOption
    {
        public string title;
        public string content;
        public bool showCancel;
        public string cancelText;
        public string cancelColor;
        public string confirmText;
        public string confirmColor;
        public bool editable;
        public string placeholderText;
    }

    /// <summary>
    /// ShowModal 成功回调结果
    /// </summary>
    [Serializable]
    public class PCHPShowModalSuccessCallbackResult
    {
        public bool confirm;
        public bool cancel;
        public string content;
        public string errMsg;
    }

    #endregion

    /// <summary>
    /// PC高性能小游戏初始化脚本
    /// 负责与宿主程序的 pchp_sdk.dll 进行交互
    /// </summary>
    public class WXPCHPInitScript : MonoBehaviour
    {
        #region DLL Imports

        private const string DLL_NAME = "pchp_sdk.dll";

        // 初始化SDK
        [DllImport(DLL_NAME, CallingConvention = CallingConvention.Cdecl)]
        private static extern bool InitEmbeddedGameSDK();

        // 注册异步消息处理器
        [DllImport(DLL_NAME, CallingConvention = CallingConvention.Cdecl)]
        private static extern void RegisterAsyncMsgHandler(AsyncMsgHandlerDelegate handler);

        // 建立Mojo连接
        [DllImport(DLL_NAME, CallingConvention = CallingConvention.Cdecl)]
        private static extern bool EstablishConnection();

        // 初始化游戏窗口 - 传入窗口句柄
        [DllImport(DLL_NAME, CallingConvention = CallingConvention.Cdecl)]
        private static extern bool InitGameWindow(ulong hwnd);

        // 异步发送消息
        [DllImport(DLL_NAME, CallingConvention = CallingConvention.Cdecl)]
        private static extern bool SendMsgAsync(IntPtr data, int len);

        // 清理资源
        [DllImport(DLL_NAME, CallingConvention = CallingConvention.Cdecl)]
        private static extern bool Cleanup();

        // Windows 窗口控制 API
#if UNITY_STANDALONE_WIN
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        private const int SW_HIDE = 0;
        private const int SW_SHOW = 5;
#endif

        #endregion

        #region Delegate Definition

        // 异步消息处理器委托
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate void AsyncMsgHandlerDelegate(IntPtr data, int len);

        // 保持委托引用，防止被GC回收
        private static AsyncMsgHandlerDelegate asyncMsgHandler;

        #endregion

        #region Singleton

        private static WXPCHPInitScript instance;
        public static WXPCHPInitScript Instance => instance;

        #endregion

        #region Callback Management

        /// <summary>
        /// 回调信息封装
        /// </summary>
        private class CallbackInfo
        {
            public Action<string> OnSuccess;
            public Action<string> OnFail;
            public Action<string> OnComplete;
            public string ApiName;
            public long Timestamp;
        }

        // 待处理的回调字典 <requestId, CallbackInfo>
        private readonly Dictionary<string, CallbackInfo> _pendingCallbacks = new Dictionary<string, CallbackInfo>();

        // 事件监听器字典 <eventName, List<Action<string>>>
        private readonly Dictionary<string, List<Action<string>>> _eventListeners = new Dictionary<string, List<Action<string>>>();

        // 请求ID计数器
        private int _requestIdCounter = 0;

        // 线程安全的消息队列，用于主线程处理
        private readonly ConcurrentQueue<PCHPResponseMessage> _messageQueue = new ConcurrentQueue<PCHPResponseMessage>();

        #endregion

        #region Events

        // 收到异步消息时触发的事件（原始字节）
        public event Action<byte[]> OnMessageReceived;

        #endregion

        #region Properties

        // SDK是否已初始化
        public bool IsInitialized { get; private set; }

        // 是否已连接
        public bool IsConnected { get; private set; }

        // 窗口句柄
        public IntPtr WindowHandle { get; private set; }

        #endregion

        #region Auto Initialize

        /// <summary>
        /// 最早时机隐藏窗口（BeforeSceneLoad 是 C# 能触达的最早时机）
        /// 在 Splash Screen 结束后、场景加载前立即执行，最大程度减少窗口可见时间
        /// </summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void HideWindowEarly()
        {
#if UNITY_STANDALONE_WIN
            try
            {
                var hwnd = System.Diagnostics.Process.GetCurrentProcess().MainWindowHandle;
                if (hwnd != IntPtr.Zero)
                {
                    ShowWindow(hwnd, SW_HIDE);
                    _cachedWindowHandle = hwnd;
                    Debug.Log($"[WXPCHPInitScript] BeforeSceneLoad: 窗口已隐藏并缓存句柄: 0x{hwnd.ToInt64():X}");
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[WXPCHPInitScript] BeforeSceneLoad: 隐藏窗口失败: {e.Message}");
            }
#endif
        }

        // 静态缓存句柄，BeforeSceneLoad 时保存，Awake 时使用
        private static IntPtr _cachedWindowHandle = IntPtr.Zero;

        /// <summary>
        /// 自动初始化入口（零侵入）
        /// 通过 RuntimeInitializeOnLoadMethod 在场景加载后自动创建
        /// 如果开发者已手动在场景中挂载，则跳过
        /// </summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void AutoInitialize()
        {
            if (Instance != null) return;

            var go = new GameObject("[WXPCHPInitScript]");
            go.AddComponent<WXPCHPInitScript>();
            Debug.Log("[WXPCHPInitScript] 通过 RuntimeInitializeOnLoadMethod 自动创建");
        }

        #endregion

        #region Unity Lifecycle

        private void Awake()
        {
            Debug.Log("[WXPCHPInitScript] ========== Awake 被调用 ==========");
            Debug.Log($"[WXPCHPInitScript] GameObject 名称: {gameObject.name}");
            Debug.Log($"[WXPCHPInitScript] 场景名称: {UnityEngine.SceneManagement.SceneManager.GetActiveScene().name}");

            // 立即隐藏窗口，防止 Unity 独立窗口暴露在桌面上
            // 后续由微信客户端通过 InitGameWindow 接管窗口显示
            HideGameWindow();

            if (instance != null && instance != this)
            {
                Debug.LogWarning("[WXPCHPInitScript] 检测到重复实例，销毁当前对象");
                Destroy(gameObject);
                return;
            }

            instance = this;
            DontDestroyOnLoad(gameObject);
            Debug.Log("[WXPCHPInitScript] 单例创建成功，已设置 DontDestroyOnLoad");

            // 初始化SDK
            Initialize();
        }

        private void Update()
        {
            // 在主线程中处理消息队列
            ProcessMessageQueue();
        }

        private void OnDestroy()
        {
            if (instance == this)
            {
                CleanupSDK();
                instance = null;
            }
        }

        private void OnApplicationQuit()
        {
            CleanupSDK();
        }

        #endregion

        #region Window Management

        /// <summary>
        /// 隐藏游戏窗口，防止 Unity 独立窗口暴露在桌面上。
        /// 在 Awake 时立即调用，后续由微信客户端通过 InitGameWindow 接管窗口显示。
        /// </summary>
        private void HideGameWindow()
        {
#if UNITY_STANDALONE_WIN
            try
            {
                // 优先使用 BeforeSceneLoad 阶段已缓存的句柄
                if (_cachedWindowHandle != IntPtr.Zero)
                {
                    WindowHandle = _cachedWindowHandle;
                    Debug.Log($"[WXPCHPInitScript] HideGameWindow: 使用 BeforeSceneLoad 缓存句柄: 0x{WindowHandle.ToInt64():X}");
                    return;
                }

                // fallback: BeforeSceneLoad 没拿到的情况
                var hwnd = System.Diagnostics.Process.GetCurrentProcess().MainWindowHandle;
                if (hwnd != IntPtr.Zero)
                {
                    WindowHandle = hwnd;
                    ShowWindow(hwnd, SW_HIDE);
                    Debug.Log($"[WXPCHPInitScript] HideGameWindow: 窗口已隐藏并缓存句柄: 0x{hwnd.ToInt64():X}");
                }
                else
                {
                    Debug.LogWarning("[WXPCHPInitScript] HideGameWindow: MainWindowHandle 为空，窗口可能尚未创建");
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[WXPCHPInitScript] 隐藏窗口失败: {e.Message}");
            }
#endif
        }

        #endregion

        #region Public Methods - SDK Lifecycle

        /// <summary>
        /// 初始化SDK并建立连接
        /// </summary>
        public void Initialize()
        {
            if (IsInitialized)
            {
                Debug.LogWarning("[WXPCHPInitScript] SDK已经初始化");
                return;
            }

            Debug.Log("[WXPCHPInitScript] ========== 开始初始化 ==========");
            Debug.Log($"[WXPCHPInitScript] 当前工作目录: {System.IO.Directory.GetCurrentDirectory()}");
            Debug.Log($"[WXPCHPInitScript] DLL 搜索路径: {DLL_NAME}");

            ShowStepInfo("SDK 初始化开始", "即将执行 PC 高性能模式 SDK 初始化流程...\n\n共 5 个步骤：\n1. InitEmbeddedGameSDK\n2. RegisterAsyncMsgHandler\n3. EstablishConnection\n4. GetActiveWindow\n5. InitGameWindow");

            try
            {
                // 1. 初始化SDK
                Debug.Log("[WXPCHPInitScript] Step 1: 调用 InitEmbeddedGameSDK");
                ShowStepInfo("步骤 1/5 - InitEmbeddedGameSDK", "正在初始化嵌入式游戏 SDK...");
                if (!InitEmbeddedGameSDK())
                {
                    ShowError("InitEmbeddedGameSDK 返回 false");
                    return;
                }
                ShowStepInfo("步骤 1/5 - InitEmbeddedGameSDK ✅", "InitEmbeddedGameSDK 调用成功！");

                // 2. 注册消息处理器 
                Debug.Log("[WXPCHPInitScript] Step 2: 调用 RegisterAsyncMsgHandler");
                ShowStepInfo("步骤 2/5 - RegisterAsyncMsgHandler", "正在注册异步消息处理器...");
                asyncMsgHandler = HandleAsyncMessage;
                RegisterAsyncMsgHandler(asyncMsgHandler);
                ShowStepInfo("步骤 2/5 - RegisterAsyncMsgHandler ✅", "异步消息处理器注册成功！");

                // 3. 建立连接
                Debug.Log("[WXPCHPInitScript] Step 3: 调用 EstablishConnection");
                ShowStepInfo("步骤 3/5 - EstablishConnection", "正在建立 Mojo 连接...");
                if (!EstablishConnection())
                {
                    ShowError("EstablishConnection 返回 false");
                    IsConnected = false;
                    return;
                }
                IsConnected = true; 
                ShowStepInfo("步骤 3/5 - EstablishConnection ✅", "Mojo 连接建立成功！");

                // 4. 获取窗口句柄并初始化游戏窗口
                Debug.Log("[WXPCHPInitScript] Step 4: 获取窗口句柄");
                ShowStepInfo("步骤 4/5 - 获取窗口句柄", "正在获取游戏窗口句柄...");
#if UNITY_STANDALONE_WIN
                // 优先使用 HideGameWindow 阶段缓存的句柄
                // （窗口被 SW_HIDE 后 MainWindowHandle 会返回 IntPtr.Zero）
                if (WindowHandle == IntPtr.Zero)
                {
                    WindowHandle = System.Diagnostics.Process.GetCurrentProcess().MainWindowHandle;
                }
                if (WindowHandle == IntPtr.Zero)
                {
                    // 极端情况下主窗口句柄还未就绪，短暂等待后重试
                    Debug.LogWarning("[WXPCHPInitScript] MainWindowHandle 为空，等待 200ms 后重试...");
                    System.Threading.Thread.Sleep(200);
                    WindowHandle = System.Diagnostics.Process.GetCurrentProcess().MainWindowHandle;
                }
                if (WindowHandle == IntPtr.Zero)
                {
                    ShowError("获取窗口句柄失败：Process.MainWindowHandle 返回空。请确保游戏以窗口模式运行（非 -batchmode）");
                    return;
                }
#else
                // macOS: 暂不通过 P/Invoke 获取窗口句柄，传 0 由 DLL 内部处理
                WindowHandle = IntPtr.Zero;
                Debug.Log("[WXPCHPInitScript] macOS 平台，窗口句柄由 DLL 内部获取");
#endif
                Debug.Log($"[WXPCHPInitScript] 获取窗口句柄成功: 0x{WindowHandle.ToInt64():X}");
                ShowStepInfo("步骤 4/5 - 获取窗口句柄 ✅", $"窗口句柄获取成功: 0x{WindowHandle.ToInt64():X}");

                // 5. 通知内核获取窗口句柄
                Debug.Log("[WXPCHPInitScript] Step 5: 调用 InitGameWindow");
                ShowStepInfo("步骤 5/5 - InitGameWindow", $"正在初始化游戏窗口...\n窗口句柄: 0x{WindowHandle.ToInt64():X}");
                if (!InitGameWindow((ulong)WindowHandle.ToInt64()))
                {
                    ShowError("InitGameWindow 返回 false");
                    return;
                }
                ShowStepInfo("步骤 5/5 - InitGameWindow ✅", "游戏窗口初始化成功！");

                IsInitialized = true;
                Debug.Log("[WXPCHPInitScript] ========== 初始化完成 ==========");
                ShowStepInfo("🎉 SDK 初始化完成", "PC 高性能模式 SDK 所有步骤均已成功完成！\n\n✅ InitEmbeddedGameSDK\n✅ RegisterAsyncMsgHandler\n✅ EstablishConnection\n✅ GetActiveWindow\n✅ InitGameWindow");
            }
            catch (DllNotFoundException e)
            {
                ShowError($"找不到DLL: {e.Message}\n\n请确保 {DLL_NAME} 在以下位置之一：\n- 与 .exe 同级目录\n- System32 目录\n- PATH 环境变量包含的路径");
                Debug.LogError($"[WXPCHPInitScript] DLL 加载失败，请确保 {DLL_NAME} 在以下位置之一：");
                Debug.LogError($"  - 与 .exe 同级目录");
                Debug.LogError($"  - System32 目录");
                Debug.LogError($"  - PATH 环境变量包含的路径");
            }
            catch (EntryPointNotFoundException e)
            {
                ShowError($"找不到函数入口: {e.Message}\n\n可能是 DLL 版本不匹配");
                Debug.LogError($"[WXPCHPInitScript] 函数入口点错误，可能是 DLL 版本不匹配");
            }
            catch (Exception e)
            {
                ShowError($"初始化异常: {e.Message}\n{e.StackTrace}");
                Debug.LogError($"[WXPCHPInitScript] 未知异常: {e}");
            }
        }

        #endregion

        #region Public Methods - WX API Calls

        /// <summary>
        /// 调用微信API（通用方法）
        /// </summary>
        /// <param name="apiName">API名称，如 "showToast"</param>
        /// <param name="data">API参数对象</param>
        /// <param name="onSuccess">成功回调</param>
        /// <param name="onFail">失败回调</param>
        /// <param name="onComplete">完成回调</param>
        /// <returns>请求ID</returns>
        public string CallWXAPI(string apiName, object data, Action<string> onSuccess = null, Action<string> onFail = null, Action<string> onComplete = null)
        {
            if (!IsInitialized || !IsConnected)
            {
                Debug.LogWarning($"[WXPCHPInitScript] SDK未初始化或未连接，无法调用 {apiName}");
                onFail?.Invoke(JsonMapper.ToJson(new PCHPGeneralCallbackResult { errMsg = "SDK not initialized" }));
                onComplete?.Invoke(JsonMapper.ToJson(new PCHPGeneralCallbackResult { errMsg = "SDK not initialized" }));
                return null;
            }

            string requestId = GenerateRequestId();
            string dataJson = data != null ? JsonMapper.ToJson(data) : "{}";

            // 注册回调
            var callbackInfo = new CallbackInfo
            {
                OnSuccess = onSuccess,
                OnFail = onFail,
                OnComplete = onComplete,
                ApiName = apiName,
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };
            _pendingCallbacks[requestId] = callbackInfo;

            // 构建请求消息
            var request = new PCHPRequestMessage
            {
                type = "request",
                requestId = requestId,
                api = apiName,
                data = dataJson,
                timestamp = callbackInfo.Timestamp
            };

            string requestJson = JsonMapper.ToJson(request);
            Debug.Log($"[WXPCHPInitScript] 发送API请求: {apiName}, requestId: {requestId}");

            if (!SendMessageInternal(requestJson))
            {
                _pendingCallbacks.Remove(requestId);
                onFail?.Invoke(JsonMapper.ToJson(new PCHPGeneralCallbackResult { errMsg = "Failed to send message" }));
                onComplete?.Invoke(JsonMapper.ToJson(new PCHPGeneralCallbackResult { errMsg = "Failed to send message" }));
                return null;
            }

            return requestId;
        }

        /// <summary>
        /// 显示消息提示框
        /// </summary>
        public void ShowToast(PCHPShowToastOption option, Action<PCHPGeneralCallbackResult> success = null, Action<PCHPGeneralCallbackResult> fail = null, Action<PCHPGeneralCallbackResult> complete = null)
        {
            CallWXAPI("showToast", option,
                res => success?.Invoke(JsonMapper.ToObject<PCHPGeneralCallbackResult>(res)),
                res => fail?.Invoke(JsonMapper.ToObject<PCHPGeneralCallbackResult>(res)),
                res => complete?.Invoke(JsonMapper.ToObject<PCHPGeneralCallbackResult>(res))
            );
        }

        /// <summary>
        /// 隐藏消息提示框
        /// </summary>
        public void HideToast(Action<PCHPGeneralCallbackResult> success = null, Action<PCHPGeneralCallbackResult> fail = null, Action<PCHPGeneralCallbackResult> complete = null)
        {
            CallWXAPI("hideToast", null,
                res => success?.Invoke(JsonMapper.ToObject<PCHPGeneralCallbackResult>(res)),
                res => fail?.Invoke(JsonMapper.ToObject<PCHPGeneralCallbackResult>(res)),
                res => complete?.Invoke(JsonMapper.ToObject<PCHPGeneralCallbackResult>(res))
            );
        }

        /// <summary>
        /// 显示模态对话框
        /// </summary>
        public void ShowModal(PCHPShowModalOption option, Action<PCHPShowModalSuccessCallbackResult> success = null, Action<PCHPGeneralCallbackResult> fail = null, Action<PCHPGeneralCallbackResult> complete = null)
        {
            CallWXAPI("showModal", option,
                res => success?.Invoke(JsonMapper.ToObject<PCHPShowModalSuccessCallbackResult>(res)),
                res => fail?.Invoke(JsonMapper.ToObject<PCHPGeneralCallbackResult>(res)),
                res => complete?.Invoke(JsonMapper.ToObject<PCHPGeneralCallbackResult>(res))
            );
        }

        /// <summary>
        /// 显示 loading 提示框
        /// </summary>
        public void ShowLoading(string title, bool mask = false, Action<PCHPGeneralCallbackResult> success = null, Action<PCHPGeneralCallbackResult> fail = null, Action<PCHPGeneralCallbackResult> complete = null)
        {
            CallWXAPI("showLoading", new { title, mask },
                res => success?.Invoke(JsonMapper.ToObject<PCHPGeneralCallbackResult>(res)),
                res => fail?.Invoke(JsonMapper.ToObject<PCHPGeneralCallbackResult>(res)),
                res => complete?.Invoke(JsonMapper.ToObject<PCHPGeneralCallbackResult>(res))
            );
        }

        /// <summary>
        /// 隐藏 loading 提示框
        /// </summary>
        public void HideLoading(Action<PCHPGeneralCallbackResult> success = null, Action<PCHPGeneralCallbackResult> fail = null, Action<PCHPGeneralCallbackResult> complete = null)
        {
            CallWXAPI("hideLoading", null,
                res => success?.Invoke(JsonMapper.ToObject<PCHPGeneralCallbackResult>(res)),
                res => fail?.Invoke(JsonMapper.ToObject<PCHPGeneralCallbackResult>(res)),
                res => complete?.Invoke(JsonMapper.ToObject<PCHPGeneralCallbackResult>(res))
            );
        }

        #endregion

        #region Public Methods - Event Listeners

        /// <summary>
        /// 注册事件监听器
        /// </summary>
        /// <param name="eventName">事件名称，如 "onShow", "onHide"</param>
        /// <param name="callback">回调函数</param>
        public void RegisterEventListener(string eventName, Action<string> callback)
        {
            if (!_eventListeners.ContainsKey(eventName))
            {
                _eventListeners[eventName] = new List<Action<string>>();

                // 发送事件注册消息到基础库
                var request = new PCHPRequestMessage
                {
                    type = "event_register",
                    requestId = GenerateRequestId(),
                    api = eventName,
                    data = "{}",
                    timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                };
                SendMessageInternal(JsonMapper.ToJson(request));
            }

            _eventListeners[eventName].Add(callback);
            Debug.Log($"[WXPCHPInitScript] 注册事件监听: {eventName}");
        }

        /// <summary>
        /// 移除事件监听器
        /// </summary>
        /// <param name="eventName">事件名称</param>
        /// <param name="callback">要移除的回调函数，为null则移除所有</param>
        public void UnregisterEventListener(string eventName, Action<string> callback = null)
        {
            if (!_eventListeners.ContainsKey(eventName))
            {
                return;
            }

            if (callback == null)
            {
                _eventListeners.Remove(eventName);
            }
            else
            {
                _eventListeners[eventName].Remove(callback);
                if (_eventListeners[eventName].Count == 0)
                {
                    _eventListeners.Remove(eventName);
                }
            }

            // 如果没有监听器了，通知基础库取消注册
            if (!_eventListeners.ContainsKey(eventName))
            {
                var request = new PCHPRequestMessage
                {
                    type = "event_unregister",
                    requestId = GenerateRequestId(),
                    api = eventName,
                    data = "{}",
                    timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                };
                SendMessageInternal(JsonMapper.ToJson(request));
            }

            Debug.Log($"[WXPCHPInitScript] 移除事件监听: {eventName}");
        }

        #endregion

        #region Public Methods - Raw Message

        /// <summary>
        /// 发送原始消息字符串
        /// </summary>
        /// <param name="message">消息内容</param>
        /// <returns>是否发送成功</returns>
        public bool SendRawMessage(string message)
        {
            return SendMessageInternal(message);
        }

        /// <summary>
        /// 发送原始消息字节数组
        /// </summary>
        /// <param name="data">消息数据</param>
        /// <returns>是否发送成功</returns>
        public bool SendMessage(byte[] data)
        {
            if (!IsInitialized || !IsConnected)
            {
                Debug.LogWarning("[WXPCHPInitScript] SDK未初始化或未连接");
                return false;
            }

            if (data == null || data.Length == 0)
            {
                Debug.LogWarning("[WXPCHPInitScript] 发送的数据为空");
                return false;
            }

            try
            {
                IntPtr ptr = Marshal.AllocHGlobal(data.Length);
                try
                {
                    Marshal.Copy(data, 0, ptr, data.Length);
                    return SendMsgAsync(ptr, data.Length);
                }
                finally
                {
                    Marshal.FreeHGlobal(ptr);
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[WXPCHPInitScript] 发送消息异常: {e.Message}");
                return false;
            }
        }

        #endregion

        #region Private Methods

        /// <summary>
        /// 生成唯一请求ID
        /// </summary>
        private string GenerateRequestId()
        {
            return $"pchp_{++_requestIdCounter}_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
        }

        /// <summary>
        /// 内部发送消息方法
        /// </summary>
        private bool SendMessageInternal(string message)
        {
            if (!IsInitialized || !IsConnected)
            {
                Debug.LogWarning("[WXPCHPInitScript] SDK未初始化或未连接");
                return false;
            }

            try
            {
                byte[] data = System.Text.Encoding.UTF8.GetBytes(message);
                return SendMessage(data);
            }
            catch (Exception e)
            {
                Debug.LogError($"[WXPCHPInitScript] 发送消息异常: {e.Message}");
                return false;
            }
        }

        /// <summary>
        /// 显示步骤信息日志（仅输出到控制台，不弹窗阻塞流程）
        /// </summary>
        private void ShowStepInfo(string title, string message)
        {
            Debug.Log($"[WXPCHPInitScript] [{title}] {message}");
        }

        /// <summary>
        /// 显示错误弹窗（仅 Windows）
        /// </summary>
        private void ShowError(string message)
        {
            Debug.LogError($"[WXPCHPInitScript] {message}");
#if UNITY_STANDALONE_WIN
            try
            {
                // MB_OK | MB_ICONERROR = 0x10
                MessageBox(IntPtr.Zero, message, "WXPCHPInitScript Error", 0x10);
            }
            catch (System.Exception e)
            {
                Debug.LogWarning($"[WXPCHPInitScript] MessageBox 调用失败: {e.Message}");
            }
#endif
        }

        /// <summary>
        /// 清理SDK资源
        /// </summary>
        private void CleanupSDK()
        {
            if (!IsInitialized)
            {
                return;
            }

            try
            {
                // 清理待处理回调
                _pendingCallbacks.Clear();
                _eventListeners.Clear();

                Cleanup();
                Debug.Log("[WXPCHPInitScript] SDK清理完成");
            }
            catch (Exception e)
            {
                Debug.LogError($"[WXPCHPInitScript] 清理异常: {e.Message}");
            }
            finally
            {
                IsInitialized = false;
                IsConnected = false;
            }
        }

        /// <summary>
        /// 在主线程中处理消息队列
        /// </summary>
        private void ProcessMessageQueue()
        {
            while (_messageQueue.TryDequeue(out var response))
            {
                try
                {
                    ProcessResponse(response);
                }
                catch (Exception e)
                {
                    Debug.LogError($"[WXPCHPInitScript] 处理响应消息异常: {e.Message}");
                }
            }
        }

        /// <summary>
        /// 处理响应消息
        /// </summary>
        private void ProcessResponse(PCHPResponseMessage response)
        {
            if (response.type == "response")
            {
                // 处理API回调
                if (_pendingCallbacks.TryGetValue(response.requestId, out var callbackInfo))
                {
                    Debug.Log($"[WXPCHPInitScript] 收到API响应: {callbackInfo.ApiName}, callbackType: {response.callbackType}");

                    switch (response.callbackType)
                    {
                        case "success":
                            callbackInfo.OnSuccess?.Invoke(response.data ?? "{}");
                            break;
                        case "fail":
                            callbackInfo.OnFail?.Invoke(response.data ?? $"{{\"errMsg\":\"{response.errMsg}\"}}");
                            break;
                        case "complete":
                            callbackInfo.OnComplete?.Invoke(response.data ?? "{}");
                            // complete 后移除回调
                            _pendingCallbacks.Remove(response.requestId);
                            break;
                    }
                }
                else
                {
                    Debug.LogWarning($"[WXPCHPInitScript] 未找到对应的回调: requestId={response.requestId}");
                }
            }
            else if (response.type == "event")
            {
                // 处理事件通知
                string eventName = response.api;
                if (_eventListeners.TryGetValue(eventName, out var listeners))
                {
                    Debug.Log($"[WXPCHPInitScript] 收到事件: {eventName}");
                    foreach (var listener in listeners.ToArray())
                    {
                        try
                        {
                            listener?.Invoke(response.data ?? "{}");
                        }
                        catch (Exception e)
                        {
                            Debug.LogError($"[WXPCHPInitScript] 事件回调异常: {eventName}, {e.Message}");
                        }
                    }
                }
            }
        }

        /// <summary>
        /// 异步消息处理回调（从DLL回调，可能在非主线程）
        /// </summary>
        [AOT.MonoPInvokeCallback(typeof(AsyncMsgHandlerDelegate))]
        private static void HandleAsyncMessage(IntPtr data, int len)
        {
            if (data == IntPtr.Zero || len <= 0)
            {
                return;
            }

            try
            {
                byte[] buffer = new byte[len];
                Marshal.Copy(data, buffer, 0, len);

                if (instance != null)
                {
                    // 触发原始消息事件
                    instance.OnMessageReceived?.Invoke(buffer);

                    // 解析消息
                    string message = System.Text.Encoding.UTF8.GetString(buffer);
                    Debug.Log($"[WXPCHPInitScript] 收到原始消息: {message}");

                    try
                    {
                        // 尝试解析为响应消息
                        var response = JsonMapper.ToObject<PCHPResponseMessage>(message);
                        if (response != null && !string.IsNullOrEmpty(response.type))
                        {
                            // 加入消息队列，在主线程中处理
                            instance._messageQueue.Enqueue(response);
                        }
                    }
                    catch (Exception parseEx)
                    {
                        Debug.LogWarning($"[WXPCHPInitScript] 消息解析失败，可能是非标准格式: {parseEx.Message}");
                    }
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[WXPCHPInitScript] 处理消息异常: {e.Message}");
            }
        }

        #endregion
    }

    /// <summary>
    /// PC高性能小游戏管理器
    /// 提供类似 wx.getPCHighPerformanceManager() 的接口
    /// </summary>
    public class WXPCHighPerformanceManager
    {
        private static WXPCHighPerformanceManager _instance;
        private WXPCHPInitScript _initScript;

        /// <summary>
        /// 获取 PC 高性能管理器实例
        /// </summary>
        public static WXPCHighPerformanceManager GetInstance()
        {
            if (_instance == null)
            {
                _instance = new WXPCHighPerformanceManager();
            }
            return _instance;
        }

        private WXPCHighPerformanceManager()
        {
            _initScript = WXPCHPInitScript.Instance;
        }

        /// <summary>
        /// 是否支持PC高性能模式
        /// </summary>
        public bool IsSupported => _initScript != null && _initScript.IsInitialized && _initScript.IsConnected;

        /// <summary>
        /// 调用微信API
        /// </summary>
        public string CallWXAPI(string apiName, object data, Action<string> onSuccess = null, Action<string> onFail = null, Action<string> onComplete = null)
        {
            if (_initScript == null)
            {
                Debug.LogError("[WXPCHighPerformanceManager] InitScript 未初始化");
                return null;
            }
            return _initScript.CallWXAPI(apiName, data, onSuccess, onFail, onComplete);
        }

        /// <summary>
        /// 显示 Toast
        /// </summary>
        public void ShowToast(PCHPShowToastOption option, Action<PCHPGeneralCallbackResult> success = null, Action<PCHPGeneralCallbackResult> fail = null, Action<PCHPGeneralCallbackResult> complete = null)
        {
            _initScript?.ShowToast(option, success, fail, complete);
        }

        /// <summary>
        /// 隐藏 Toast
        /// </summary>
        public void HideToast(Action<PCHPGeneralCallbackResult> success = null, Action<PCHPGeneralCallbackResult> fail = null, Action<PCHPGeneralCallbackResult> complete = null)
        {
            _initScript?.HideToast(success, fail, complete);
        }

        /// <summary>
        /// 显示模态对话框
        /// </summary>
        public void ShowModal(PCHPShowModalOption option, Action<PCHPShowModalSuccessCallbackResult> success = null, Action<PCHPGeneralCallbackResult> fail = null, Action<PCHPGeneralCallbackResult> complete = null)
        {
            _initScript?.ShowModal(option, success, fail, complete);
        }

        /// <summary>
        /// 显示 Loading
        /// </summary>
        public void ShowLoading(string title, bool mask = false, Action<PCHPGeneralCallbackResult> success = null, Action<PCHPGeneralCallbackResult> fail = null, Action<PCHPGeneralCallbackResult> complete = null)
        {
            _initScript?.ShowLoading(title, mask, success, fail, complete);
        }

        /// <summary>
        /// 隐藏 Loading
        /// </summary>
        public void HideLoading(Action<PCHPGeneralCallbackResult> success = null, Action<PCHPGeneralCallbackResult> fail = null, Action<PCHPGeneralCallbackResult> complete = null)
        {
            _initScript?.HideLoading(success, fail, complete);
        }

        /// <summary>
        /// 注册事件监听
        /// </summary>
        public void On(string eventName, Action<string> callback)
        {
            _initScript?.RegisterEventListener(eventName, callback);
        }

        /// <summary>
        /// 移除事件监听
        /// </summary>
        public void Off(string eventName, Action<string> callback = null)
        {
            _initScript?.UnregisterEventListener(eventName, callback);
        }

        /// <summary>
        /// 发送原始消息
        /// </summary>
        public bool SendRawMessage(string message)
        {
            return _initScript?.SendRawMessage(message) ?? false;
        }
    }
}
#endif // WX_PCHP_ENABLED
