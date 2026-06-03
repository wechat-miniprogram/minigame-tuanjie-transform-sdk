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
    /// PC高性能方案通信协议 - 下行指令（C# → JS）
    /// 格式与 issue 协议对齐：{ callbackId, method, params }
    /// </summary>
    [Serializable]
    public class PCHPExeCommand
    {
        /// <summary>
        /// C# 生成的唯一标识，用于结果回传配对
        /// 格式: "{timestamp}-{counter}"，与 WebGL 模式一致
        /// </summary>
        public string callbackId;

        /// <summary>
        /// wx API 名称（驼峰），如 "showToast", "login", "getSystemInfo"
        /// </summary>
        public string method;

        /// <summary>
        /// wx API 参数（JSON 字符串），不含 success/fail/complete
        /// JS 侧收到后需 JSON.parse(params) 还原为对象
        /// </summary>
        public string @params;
    }

    /// <summary>
    /// PC高性能方案通信协议 - 上行响应（JS → C#）
    /// 与 WebGL 模式的 WXJSCallback 完全对齐：{ callbackId, type, res }
    /// 一次调用最多 3 次响应：success + complete，或 fail + complete
    /// </summary>
    [Serializable]
    public class PCHPExeCommandResponse
    {
        /// <summary>
        /// 原样回传 C# 的 callbackId
        /// </summary>
        public string callbackId;

        /// <summary>
        /// 回调类型: "success" | "fail" | "complete"
        /// 与 wx API 的回调对应，与 WebGL 模式 WXJSCallback.type 一致
        /// </summary>
        public string type;

        /// <summary>
        /// 回调数据（JSON 字符串），C# 侧用 JsonMapper.ToObject&lt;T&gt;(res) 反序列化
        /// 与 WebGL 模式 WXJSCallback.res 完全一致
        /// </summary>
        public string res;
    }

    /// <summary>
    /// PC高性能方案通信协议 - 事件消息（JS → C# 主动推送）
    /// 用于 onShow、onHide 等生命周期事件
    /// </summary>
    [Serializable]
    public class PCHPExeEventMessage
    {
        /// <summary>
        /// 固定为 "event"，C# 侧据此区分是 API 响应还是事件推送
        /// </summary>
        public string type;

        /// <summary>
        /// 事件名称，如 "onShow", "onHide", "onError"
        /// </summary>
        public string @event;

        /// <summary>
        /// 事件数据（JSON 字符串）
        /// </summary>
        public string res;
    }

    #endregion

    /// <summary>
    /// PC高性能小游戏初始化脚本
    /// 负责与宿主程序的 pchp_sdk.dll 进行交互
    /// </summary>
    public class WXPCHPInitScript : MonoBehaviour
    {
        /// <summary>
        /// PC高性能模式 SDK 版本号，每次发版时同步更新 PCHP_VERSION 和 PCHP_BUILD_DATE
        /// </summary>
        public const string PCHP_VERSION = "0.1.32";
        public const string PCHP_BUILD_DATE = "2026-06-02";

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

        // DLL 搜索路径设置（解决 pchp_sdk.dll 不在 exe 同级目录的问题）
        // 注意：不用 #if UNITY_STANDALONE_WIN 包裹，因为 Mac 编辑器交叉构建 Windows 包时
        // 也需要这个声明。运行时通过 Application.platform 判断是否调用。
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool SetDllDirectory(string lpPathName);

        // Windows 窗口控制 API
#if UNITY_STANDALONE_WIN
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

        private const int SW_HIDE = 0;
        private const int SW_SHOW = 5;

        /// <summary>
        /// 通过多种方式获取 Unity 窗口句柄（即使窗口被隐藏也能找到）
        /// </summary>
        private static IntPtr GetUnityWindowHandle()
        {
            // 1. 优先用缓存
            if (_cachedWindowHandle != IntPtr.Zero)
                return _cachedWindowHandle;

            // 2. 尝试 Process.MainWindowHandle
            var hwnd = System.Diagnostics.Process.GetCurrentProcess().MainWindowHandle;
            if (hwnd != IntPtr.Zero)
                return hwnd;

            // 3. 通过 Unity 固定窗口类名查找（窗口被 SW_HIDE 后 MainWindowHandle 返回 Zero，但 FindWindow 仍能找到）
            hwnd = FindWindow("UnityWndClass", null);
            if (hwnd != IntPtr.Zero)
            {
                Debug.Log($"[WXPCHPInitScript] 通过 FindWindow(\"UnityWndClass\") 获取到句柄: 0x{hwnd.ToInt64():X}");
                return hwnd;
            }

            // 4. 通过产品名查找
            hwnd = FindWindow(null, UnityEngine.Application.productName);
            if (hwnd != IntPtr.Zero)
            {
                Debug.Log($"[WXPCHPInitScript] 通过 FindWindow(productName=\"{UnityEngine.Application.productName}\") 获取到句柄: 0x{hwnd.ToInt64():X}");
                return hwnd;
            }

            return IntPtr.Zero;
        }
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
        /// 回调信息封装（与 WebGL 模式的三回调机制一致）
        /// </summary>
        private class CallbackInfo
        {
            public Action<string> OnSuccess;
            public Action<string> OnFail;
            public Action<string> OnComplete;
            public string ApiName;
        }

        // 待处理的回调字典 <callbackId, CallbackInfo>
        private readonly Dictionary<string, CallbackInfo> _pendingCallbacks = new Dictionary<string, CallbackInfo>();

        // 事件监听器字典 <eventName, List<Action<string>>>
        private readonly Dictionary<string, List<Action<string>>> _eventListeners = new Dictionary<string, List<Action<string>>>();

        // callbackId 计数器（格式: "{timestamp}-{counter}"，与 WebGL 模式一致）
        private int _callbackIdCounter = 0;

        // 线程安全的消息队列，用于主线程处理（存储原始 JSON 字符串）
        private readonly ConcurrentQueue<string> _messageQueue = new ConcurrentQueue<string>();

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
            // 最先设置 DLL 搜索路径（内部自带运行时平台检测）
            SetupDllSearchPathStatic();

#if UNITY_STANDALONE_WIN
            // 强制窗口模式，防止 Unity 用注册表残留的全屏分辨率尝试独占全屏
            Screen.fullScreenMode = FullScreenMode.Windowed;

            try
            {
                var hwnd = GetUnityWindowHandle();
                if (hwnd != IntPtr.Zero)
                {
                    ShowWindow(hwnd, SW_HIDE);
                    _cachedWindowHandle = hwnd;
                    Debug.Log($"[WXPCHPInitScript] BeforeSceneLoad: 窗口已隐藏并缓存句柄: 0x{hwnd.ToInt64():X}");
                }
                else
                {
                    Debug.LogWarning("[WXPCHPInitScript] BeforeSceneLoad: 窗口句柄尚未就绪，将在 Awake 阶段重试");
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
            Debug.Log($"[WXPCHPInitScript] ========== PC高性能模式 SDK v{PCHP_VERSION} (build {PCHP_BUILD_DATE}) ==========");
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
                var hwnd = GetUnityWindowHandle();
                if (hwnd != IntPtr.Zero)
                {
                    WindowHandle = hwnd;
                    _cachedWindowHandle = hwnd;
                    ShowWindow(hwnd, SW_HIDE);
                    Debug.Log($"[WXPCHPInitScript] HideGameWindow: 窗口已隐藏，句柄: 0x{hwnd.ToInt64():X}");
                }
                else
                {
                    Debug.LogWarning("[WXPCHPInitScript] HideGameWindow: 无法获取窗口句柄");
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
        /// 静态方法：在 BeforeSceneLoad 阶段设置 DLL 搜索路径
        /// 必须在任何 [DllImport("pchp_sdk.dll")] 调用之前执行
        /// 
        /// DLL 位置约定（构建时由 SDK 自动放置）：
        /// - Windows: {ProductName}_Data/Plugins/x86_64/pchp_sdk.dll
        /// - 兜底: exe 同级目录（向上查找）
        /// </summary>
        private static void SetupDllSearchPathStatic()
        {
            Debug.Log($"[WXPCHPInitScript] SetupDllSearchPath 进入，platform={Application.platform}, dataPath={Application.dataPath}");

            try
            {
                // 候选搜索目录列表（优先级从高到低）
                var candidateDirs = new System.Collections.Generic.List<string>();

                // 1. Unity 标准 Plugin 位置: {dataPath}/Plugins/x86_64/
                string pluginDir = System.IO.Path.Combine(Application.dataPath, "Plugins", "x86_64");
                candidateDirs.Add(pluginDir);

                // 2. Unity 标准 Plugin 位置（无子目录版本）: {dataPath}/Plugins/
                candidateDirs.Add(System.IO.Path.Combine(Application.dataPath, "Plugins"));

                // 3. dataPath 本身（{ProductName}_Data/）
                candidateDirs.Add(Application.dataPath);

                // 4. dataPath 的父目录（即 exe 同级目录）
                string exeDir = System.IO.Directory.GetParent(Application.dataPath)?.FullName;
                if (!string.IsNullOrEmpty(exeDir))
                {
                    candidateDirs.Add(exeDir);
                }

                // 5. 当前工作目录（微信沙箱可能设了奇怪的值，但还是试一下）
                string cwd = System.IO.Directory.GetCurrentDirectory();
                if (!string.IsNullOrEmpty(cwd) && cwd != "/")
                {
                    candidateDirs.Add(cwd);
                }

                // 逐个检查
                foreach (var dir in candidateDirs)
                {
                    string dllPath = System.IO.Path.Combine(dir, DLL_NAME);
                    Debug.Log($"[WXPCHPInitScript] SetupDllSearchPath: 检查 {dllPath}");

                    if (System.IO.File.Exists(dllPath))
                    {
                        bool result = SetDllDirectory(dir);
                        Debug.Log($"[WXPCHPInitScript] ✅ 找到 DLL，SetDllDirectory(\"{dir}\") = {result}");
                        return;
                    }
                }

                // 所有候选目录都没找到，再从 dataPath 向上逐级找（最多 5 级兜底）
                Debug.Log("[WXPCHPInitScript] SetupDllSearchPath: 标准位置未找到，向上逐级查找...");
                string searchDir = Application.dataPath;
                for (int i = 0; i < 5; i++)
                {
                    var parent = System.IO.Directory.GetParent(searchDir);
                    if (parent == null) break;
                    searchDir = parent.FullName;

                    string dllPath = System.IO.Path.Combine(searchDir, DLL_NAME);
                    if (System.IO.File.Exists(dllPath))
                    {
                        bool result = SetDllDirectory(searchDir);
                        Debug.Log($"[WXPCHPInitScript] ✅ 向上查找到 DLL，SetDllDirectory(\"{searchDir}\") = {result}");
                        return;
                    }
                }

                Debug.LogWarning($"[WXPCHPInitScript] ⚠️ 所有候选路径均未找到 {DLL_NAME}");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[WXPCHPInitScript] SetupDllSearchPath 异常: {e.Message}");
            }
        }

        /// <summary>
        /// 实例方法包装（Initialize 中调用，确保冗余设置）
        /// </summary>
        private void SetupDllSearchPath()
        {
            SetupDllSearchPathStatic();
        }

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
            Debug.Log($"[WXPCHPInitScript] DLL 名称: {DLL_NAME}");

            // 动态定位 pchp_sdk.dll：从 exe 所在目录向上逐级查找
            SetupDllSearchPath();

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
                // 通过多种策略获取窗口句柄（FindWindow 即使窗口被隐藏也能找到）
                if (WindowHandle == IntPtr.Zero)
                {
                    WindowHandle = GetUnityWindowHandle();
                }
                if (WindowHandle == IntPtr.Zero)
                {
                    // 极端情况：窗口尚未创建，短暂等待后重试
                    Debug.LogWarning("[WXPCHPInitScript] 窗口句柄为空，等待 200ms 后重试...");
                    System.Threading.Thread.Sleep(200);
                    WindowHandle = GetUnityWindowHandle();
                }
                if (WindowHandle == IntPtr.Zero)
                {
                    ShowError("获取窗口句柄失败：所有策略均无法获取窗口句柄。请确保游戏以窗口模式运行（非 -batchmode）");
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
        /// 协议格式: { callbackId, method, params }
        /// params 为 JSON 字符串（JsonMapper.ToJson 的直接产物）
        /// </summary>
        /// <param name="method">API名称（驼峰），如 "showToast"</param>
        /// <param name="data">API参数对象，将被序列化为 JSON 字符串</param>
        /// <param name="onSuccess">成功回调，参数为 res JSON 字符串</param>
        /// <param name="onFail">失败回调，参数为 res JSON 字符串</param>
        /// <param name="onComplete">完成回调，参数为 res JSON 字符串</param>
        /// <returns>callbackId</returns>
        public string CallWXAPI(string method, object data, Action<string> onSuccess = null, Action<string> onFail = null, Action<string> onComplete = null)
        {
            if (!IsInitialized || !IsConnected)
            {
                Debug.LogWarning($"[WXPCHPInitScript] SDK未初始化或未连接，无法调用 {method}");
                string errRes = "{\"errMsg\":\"SDK not initialized\"}";
                onFail?.Invoke(errRes);
                onComplete?.Invoke(errRes);
                return null;
            }

            string callbackId = GenerateCallbackId();
            string paramsJson = data != null ? JsonMapper.ToJson(data) : "{}";

            // 注册回调
            _pendingCallbacks[callbackId] = new CallbackInfo
            {
                OnSuccess = onSuccess,
                OnFail = onFail,
                OnComplete = onComplete,
                ApiName = method
            };

            // 构建下行指令: { callbackId, method, params }
            var command = new PCHPExeCommand
            {
                callbackId = callbackId,
                method = method,
                @params = paramsJson
            };

            string commandJson = JsonMapper.ToJson(command);
            Debug.Log($"[WXPCHPInitScript] 发送API请求: {method}, callbackId: {callbackId}");

            if (!SendMessageInternal(commandJson))
            {
                _pendingCallbacks.Remove(callbackId);
                string errRes = "{\"errMsg\":\"Failed to send message\"}";
                onFail?.Invoke(errRes);
                onComplete?.Invoke(errRes);
                return null;
            }

            return callbackId;
        }

        /// <summary>
        /// 桥接方法：供 WXSDKManagerHandler 生成代码调用（OneWayCallback 类 API）
        /// 使用外部已分配的 callbackId，不自行管理回调，通过统一委托回传结果
        /// </summary>
        /// <param name="method">API名称（驼峰），如 "login"</param>
        /// <param name="callbackId">WXSDKManagerHandler 已分配的 callbackId</param>
        /// <param name="paramsJson">已序列化的 JSON 参数字符串</param>
        /// <param name="onResponse">统一回调，参数为 WXJSCallback 格式的 JSON: { callbackId, type, res }</param>
        public void CallWXAPIBridge(string method, string callbackId, string paramsJson, Action<string> onResponse)
        {
            if (!IsInitialized || !IsConnected)
            {
                Debug.LogWarning($"[WXPCHPInitScript] SDK未初始化或未连接，无法调用 {method}");
                // 构造 fail + complete 回调给上层
                string errRes = "{\"errMsg\":\"" + method + ":fail SDK not initialized\"}";
                string failMsg = JsonMapper.ToJson(new PCHPExeCommandResponse { callbackId = callbackId, type = "fail", res = errRes });
                string compMsg = JsonMapper.ToJson(new PCHPExeCommandResponse { callbackId = callbackId, type = "complete", res = errRes });
                onResponse?.Invoke(failMsg);
                onResponse?.Invoke(compMsg);
                return;
            }

            // 注册回调（统一 onResponse 分发 success/fail/complete）
            _pendingCallbacks[callbackId] = new CallbackInfo
            {
                OnSuccess = (res) => {
                    string msg = JsonMapper.ToJson(new PCHPExeCommandResponse { callbackId = callbackId, type = "success", res = res });
                    onResponse?.Invoke(msg);
                },
                OnFail = (res) => {
                    string msg = JsonMapper.ToJson(new PCHPExeCommandResponse { callbackId = callbackId, type = "fail", res = res });
                    onResponse?.Invoke(msg);
                },
                OnComplete = (res) => {
                    string msg = JsonMapper.ToJson(new PCHPExeCommandResponse { callbackId = callbackId, type = "complete", res = res });
                    onResponse?.Invoke(msg);
                },
                ApiName = method
            };

            // 构建下行指令
            var command = new PCHPExeCommand
            {
                callbackId = callbackId,
                method = method,
                @params = paramsJson ?? "{}"
            };

            string commandJson = JsonMapper.ToJson(command);
            Debug.Log($"[WXPCHPInitScript] Bridge发送API请求: {method}, callbackId: {callbackId}");

            if (!SendMessageInternal(commandJson))
            {
                _pendingCallbacks.Remove(callbackId);
                string errRes = "{\"errMsg\":\"" + method + ":fail send message failed\"}";
                string failMsg = JsonMapper.ToJson(new PCHPExeCommandResponse { callbackId = callbackId, type = "fail", res = errRes });
                string compMsg = JsonMapper.ToJson(new PCHPExeCommandResponse { callbackId = callbackId, type = "complete", res = errRes });
                onResponse?.Invoke(failMsg);
                onResponse?.Invoke(compMsg);
            }
        }

        /// <summary>
        /// 桥接方法：供 WXSDKManagerHandler 生成代码调用（OneWayNoCallback 类 API）
        /// 只发消息，不注册回调
        /// </summary>
        /// <param name="method">API名称</param>
        /// <param name="paramsJson">已序列化的 JSON 参数字符串，可为 null</param>
        public void CallWXAPINoCallback(string method, string paramsJson = null)
        {
            if (!IsInitialized || !IsConnected)
            {
                Debug.LogWarning($"[WXPCHPInitScript] SDK未初始化或未连接，无法调用 {method}");
                return;
            }

            var command = new PCHPExeCommand
            {
                callbackId = GenerateCallbackId(),
                method = method,
                @params = paramsJson ?? "{}"
            };

            string commandJson = JsonMapper.ToJson(command);
            Debug.Log($"[WXPCHPInitScript] Bridge发送无回调API请求: {method}");
            SendMessageInternal(commandJson);
        }

        /// <summary>
        /// 桥接方法：供 WXSDKManagerHandler 生成代码调用（SyncFunction 类 API）
        /// 由于 PCHP 通道是异步的，同步 API 通过阻塞等待实现
        /// </summary>
        /// <param name="method">API名称</param>
        /// <param name="paramsJson">已序列化的 JSON 参数字符串</param>
        /// <param name="timeoutMs">超时时间（毫秒）</param>
        /// <returns>API 返回的 JSON 字符串</returns>
        public string CallWXAPISyncBridge(string method, string paramsJson = null, int timeoutMs = 5000)
        {
            if (!IsInitialized || !IsConnected)
            {
                Debug.LogWarning($"[WXPCHPInitScript] SDK未初始化或未连接，无法调用 {method}");
                return "";
            }

            string callbackId = GenerateCallbackId();
            string result = null;
            bool completed = false;

            _pendingCallbacks[callbackId] = new CallbackInfo
            {
                OnSuccess = (res) => { result = res; completed = true; },
                OnFail = (res) => { result = res; completed = true; },
                OnComplete = (res) => { /* success/fail 已经设置了 result */ },
                ApiName = method
            };

            var command = new PCHPExeCommand
            {
                callbackId = callbackId,
                method = method,
                @params = paramsJson ?? "{}"
            };

            string commandJson = JsonMapper.ToJson(command);
            Debug.Log($"[WXPCHPInitScript] Bridge发送同步API请求: {method}, callbackId: {callbackId}");

            if (!SendMessageInternal(commandJson))
            {
                _pendingCallbacks.Remove(callbackId);
                return "";
            }

            // 阻塞等待结果（注意：需要在非主线程调用或接受帧阻塞）
            var startTime = DateTime.UtcNow;
            while (!completed && (DateTime.UtcNow - startTime).TotalMilliseconds < timeoutMs)
            {
                // 手动 pump 消息队列以处理响应
                if (_messageQueue.TryDequeue(out var messageJson))
                {
                    try { ProcessIncomingMessage(messageJson); } catch { }
                }
                System.Threading.Thread.Sleep(1);
            }

            if (!completed)
            {
                Debug.LogWarning($"[WXPCHPInitScript] 同步API超时: {method}");
                _pendingCallbacks.Remove(callbackId);
            }

            return result ?? "";
        }

        /// <summary>
        /// 桥接方法：供 WXSDKManagerHandler 生成代码调用（OnEvent 事件注册）
        /// </summary>
        /// <param name="eventName">事件名称，如 "OnShow"</param>
        /// <param name="callback">回调函数，参数为事件数据 JSON 字符串</param>
        public void RegisterEventBridge(string eventName, Action<string> callback)
        {
            RegisterEventListener(eventName, callback);
        }

        /// <summary>
        /// 桥接方法：供 WXSDKManagerHandler 生成代码调用（OffEvent 事件注销）
        /// </summary>
        /// <param name="eventName">事件名称</param>
        public void UnregisterEventBridge(string eventName)
        {
            UnregisterEventListener(eventName);
        }

        #endregion

        #region Public Methods - Event Listeners

        /// <summary>
        /// 注册事件监听器
        /// </summary>
        /// <param name="eventName">事件名称，如 "onShow", "onHide"</param>
        /// <param name="callback">回调函数，参数为事件数据 JSON 字符串</param>
        public void RegisterEventListener(string eventName, Action<string> callback)
        {
            if (!_eventListeners.ContainsKey(eventName))
            {
                _eventListeners[eventName] = new List<Action<string>>();

                // 通知 JS 侧注册事件监听（复用下行指令格式）
                var command = new PCHPExeCommand
                {
                    callbackId = GenerateCallbackId(),
                    method = "_eventRegister",
                    @params = $"{{\"event\":\"{eventName}\"}}"
                };
                SendMessageInternal(JsonMapper.ToJson(command));
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

            // 如果没有监听器了，通知 JS 侧取消注册
            if (!_eventListeners.ContainsKey(eventName))
            {
                var command = new PCHPExeCommand
                {
                    callbackId = GenerateCallbackId(),
                    method = "_eventUnregister",
                    @params = $"{{\"event\":\"{eventName}\"}}"
                };
                SendMessageInternal(JsonMapper.ToJson(command));
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
        /// 生成唯一 callbackId（格式: "{timestamp}-{counter}"，与 WebGL 模式一致）
        /// </summary>
        private string GenerateCallbackId()
        {
            return $"{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}-{++_callbackIdCounter}";
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
            while (_messageQueue.TryDequeue(out var messageJson))
            {
                try
                {
                    ProcessIncomingMessage(messageJson);
                }
                catch (Exception e)
                {
                    Debug.LogError($"[WXPCHPInitScript] 处理响应消息异常: {e.Message}");
                }
            }
        }

        /// <summary>
        /// 处理上行消息（统一入口）
        /// 根据消息内容区分：API 响应 vs 事件推送
        /// </summary>
        private void ProcessIncomingMessage(string messageJson)
        {
            // 先尝试解析为事件消息（检查 type == "event"）
            var jsonData = JsonMapper.ToObject(messageJson);

            if (jsonData.ContainsKey("type") && (string)jsonData["type"] == "event")
            {
                // 事件消息: { type: "event", event: "onShow", res: "..." }
                string eventName = jsonData.ContainsKey("event") ? (string)jsonData["event"] : "";
                string res = jsonData.ContainsKey("res") ? (string)jsonData["res"] : "{}";

                if (_eventListeners.TryGetValue(eventName, out var listeners))
                {
                    Debug.Log($"[WXPCHPInitScript] 收到事件: {eventName}");
                    foreach (var listener in listeners.ToArray())
                    {
                        try
                        {
                            listener?.Invoke(res);
                        }
                        catch (Exception e)
                        {
                            Debug.LogError($"[WXPCHPInitScript] 事件回调异常: {eventName}, {e.Message}");
                        }
                    }
                }
            }
            else if (jsonData.ContainsKey("callbackId"))
            {
                // API 响应: { callbackId, type: "success"|"fail"|"complete", res: "..." }
                string callbackId = (string)jsonData["callbackId"];
                string type = jsonData.ContainsKey("type") ? (string)jsonData["type"] : "";
                string res = jsonData.ContainsKey("res") ? (string)jsonData["res"] : "{}";

                if (_pendingCallbacks.TryGetValue(callbackId, out var callbackInfo))
                {
                    Debug.Log($"[WXPCHPInitScript] 收到API响应: {callbackInfo.ApiName}, type: {type}");

                    switch (type)
                    {
                        case "success":
                            callbackInfo.OnSuccess?.Invoke(res);
                            break;
                        case "fail":
                            callbackInfo.OnFail?.Invoke(res);
                            break;
                        case "complete":
                            callbackInfo.OnComplete?.Invoke(res);
                            // complete 后移除回调（与 WebGL 模式行为一致）
                            _pendingCallbacks.Remove(callbackId);
                            break;
                    }
                }
                else
                {
                    Debug.LogWarning($"[WXPCHPInitScript] 未找到对应的回调: callbackId={callbackId}");
                }
            }
            else
            {
                Debug.LogWarning($"[WXPCHPInitScript] 收到未知格式消息: {messageJson}");
            }
        }

        /// <summary>
        /// 异步消息处理回调（从DLL回调，可能在非主线程）
        /// 只做最小工作：拷贝数据 + 入队，解析留给主线程
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

                    // 转为字符串，加入消息队列（主线程处理）
                    string message = System.Text.Encoding.UTF8.GetString(buffer);
                    Debug.Log($"[WXPCHPInitScript] 收到原始消息: {message}");
                    instance._messageQueue.Enqueue(message);
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
        /// 调用微信API（通用方法）
        /// </summary>
        /// <param name="method">API名称（驼峰），如 "showToast"</param>
        /// <param name="data">API参数对象</param>
        /// <param name="onSuccess">成功回调，参数为 res JSON 字符串</param>
        /// <param name="onFail">失败回调，参数为 res JSON 字符串</param>
        /// <param name="onComplete">完成回调，参数为 res JSON 字符串</param>
        public string CallWXAPI(string method, object data, Action<string> onSuccess = null, Action<string> onFail = null, Action<string> onComplete = null)
        {
            if (_initScript == null)
            {
                Debug.LogError("[WXPCHighPerformanceManager] InitScript 未初始化");
                return null;
            }
            return _initScript.CallWXAPI(method, data, onSuccess, onFail, onComplete);
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
