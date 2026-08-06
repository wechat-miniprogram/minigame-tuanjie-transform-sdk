// WX_PCHP_ENABLED: PC高性能模式总开关
// 编译条件说明：
//   - UNITY_EDITOR: Editor 下始终编译（开发调试需要）
//   - UNITY_STANDALONE: 实际 Standalone 构建时编译（含 Win/Mac/Linux）
//   - 排除 WebGL/MiniGame 实际构建（避免 DllImport 进 WASM）
#if WX_PCHP_ENABLED && (UNITY_EDITOR || UNITY_STANDALONE)
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
        public const string PCHP_VERSION = "0.1.36";
        public const string PCHP_BUILD_DATE = "2026-08-03 (sync bridge: CallWXAPISyncBridge + SendAppEventSync 伪同步 + 清理 SendMsgSync 死锁代码)";

        #region DLL Imports

        // DllImport 使用不带后缀的名称，让 Mono runtime 按标准路径搜索
        // Mono 搜索顺序：{DataDir}/Plugins/x86_64/ → exe 同级 → PATH
        private const string DLL_NAME = "pchp_sdk";

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

        // SendMsgSync / FreeMsgData 已删除：Mojo 同步调用死锁，不可用（详见 issue #13020 §1.7）
        // 如需恢复，参考 README.md 同步通信章节 + 历史代码

        // 注册同步消息 handler（接住来自 JS 侧 sendMsgSync 的同步请求，跑在 SDK IPC 线程）
        // 内核 Initialize 流程要求必须注册
        [DllImport(DLL_NAME, CallingConvention = CallingConvention.Cdecl)]
        private static extern void RegisterSyncMsgHandler(SyncMsgHandlerDelegate handler);

        // 清理资源
        [DllImport(DLL_NAME, CallingConvention = CallingConvention.Cdecl)]
        private static extern bool Cleanup();

        // 控制嵌入式原生窗口是否置顶于 Chromium 自有的子 HWND 之上。
        // 当宿主/原生 UI 需要覆盖 PCHP 窗口时设为 false；恢复游戏输入/光标行为时设回 true。
        // 返回 true 表示请求已成功投递到浏览器进程。
        [DllImport(DLL_NAME, CallingConvention = CallingConvention.Cdecl)]
        [return: MarshalAs(UnmanagedType.U1)]
        private static extern bool PinupNativeWindow([MarshalAs(UnmanagedType.U1)] bool pinup);

        // 查询当前原生窗口的置顶状态，默认为 true。
        [DllImport(DLL_NAME, CallingConvention = CallingConvention.Cdecl)]
        [return: MarshalAs(UnmanagedType.U1)]
        private static extern bool IsNativeWindowPinup();

        // DLL 搜索路径设置（解决 pchp_sdk.dll 不在 exe 同级目录的问题）
        // 注意：不用 #if UNITY_STANDALONE_WIN 包裹，因为 Mac 编辑器交叉构建 Windows 包时
        // 也需要这个声明。运行时通过 Application.platform 判断是否调用。
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool SetDllDirectory(string lpPathName);

        // 手动加载 DLL（绕过 Mono VFS 的文件可见性限制）
        // 微信沙箱的 VFS 层会隐藏 .dll 文件（File.Exists 返回 false），
        // 但 kernel32.LoadLibrary 走 Windows 原生路径，不受 VFS 限制
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibrary(string lpLibFileName);

        [DllImport("kernel32.dll")]
        private static extern uint GetLastError();

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

        // 同步消息处理器委托（JS→C# 方向，接住 JS 侧 sendMsgSync）
        // handler 成功时设置 response/responseLen；response 内存只需存活到 handler 返回（SDK 会拷贝）
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate bool SyncMsgHandlerDelegate(IntPtr data, int len, out IntPtr response, out int responseLen);

        // 保持委托引用，防止被GC回收
        private static AsyncMsgHandlerDelegate asyncMsgHandler;
        private static SyncMsgHandlerDelegate syncMsgHandler;

        // 同步 handler 的响应缓冲区（handler 跑在 SDK IPC 线程，单线程无并发）
        // 用 GCHandle.Pinned 固定内存，handler 里直接把 response 指向这块缓冲区，避免每次 alloc 泄漏
        private static readonly byte[] _syncResponseBuffer = new byte[65536];
        private static GCHandle _syncResponseHandle;

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

        // ─── 自定义链路字段（接入方自带协议闭环时使用） ───
        // 提供 SendAppEvent / SendAppEventSync / HandleHostEvent 三个方法，
        // 与 AHP MinaSDKAHP.cs 签名对齐，让 TS 适配方可跨平台复用。
        // 详见 issue #13020 § 1.6。

    /// <summary>
    /// Host → TS 事件回调委托
    /// TS 侧通过 Puerts 赋值：Instance.HandleHostEvent = (eventName, data) => {...}
    /// </summary>
    public Action<string, string> HandleHostEvent;

    /// <summary>SendAppEventSync 伪同步回包（ProcessIncomingMessage 写，SendAppEventSync 读）</summary>
    private volatile string _pendingSyncResponse;
    /// <summary>SendAppEventSync 伪同步是否完成</summary>
    private volatile bool _syncResponseCompleted;

        /// <summary>
        /// Host → TS 业务事件回调委托（biz 前缀事件走此委托）
        /// </summary>
        public Action<string, string> HandleBizHostEvent;

        /// <summary>
        /// TS → C# 主动同步请求回调委托（接住 JS 侧 sendMsgSync）
        /// 与 HandleHostEvent（下行）方向相反：这是【上行同步】链路的 C# 落点。
        /// TS 侧通过 Puerts 赋值：Instance.HandleSyncHostEvent = (eventName, data) => resultJson
        /// 委托必须【同步返回】结果 JSON 字符串（跑在 SDK IPC 线程），不能 async。
        /// 未赋值时 HandleSyncMessage 回空 JSON {}。
        /// </summary>
        public Func<string, string, string> HandleSyncHostEvent;

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

            // ★ PC 高性能模式必备：窗口失焦后保持主循环运行
            // Unity Standalone 默认 runInBackground=false，失焦时 Update 会暂停，
            // 导致消息队列不处理、按钮点不动、异步回调不触发。
            // PC HP 模式下 Unity 窗口被 SW_HIDE 隐藏，焦点实际由微信客户端外壳持有，
            // 必须显式开启后台运行。
            Application.runInBackground = true;
            Debug.Log($"[WXPCHPInitScript] Application.runInBackground = true (PC HP 模式必备)");

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

        /// <summary>
        /// 焦点变化回调——用于诊断 PC HP 模式下"按钮失焦后点不动"的问题。
        /// Unity 窗口被 SW_HIDE 后，焦点状态由微信客户端外壳窗口决定，
        /// 这里记录 isFocused 变化，便于定位是否因失焦导致主循环/输入中断。
        /// </summary>
        private void OnApplicationFocus(bool hasFocus)
        {
            Debug.Log($"[WXPCHPInitScript] OnApplicationFocus(hasFocus={hasFocus}) | runInBackground={Application.runInBackground} | isFocused={Application.isFocused}");
        }

        /// <summary>
        /// 暂停回调——PC HP 模式下若被系统挂起（如锁屏、切到锁屏界面）会触发。
        /// </summary>
        private void OnApplicationPause(bool pauseStatus)
        {
            Debug.Log($"[WXPCHPInitScript] OnApplicationPause(pauseStatus={pauseStatus}) | runInBackground={Application.runInBackground}");
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
        /// 静态方法：在 BeforeSceneLoad 阶段尝试设置 DLL 搜索路径
        /// 
        /// 微信 PC 高性能沙箱限制已知：
        /// - Application.dataPath → https:// URL
        /// - AppDomain.BaseDirectory → "/"
        /// - Assembly.Location → "/wx.dll"（虚拟路径）
        /// - kernel32 SetDllDirectory → 可能被拦截
        /// - Directory.GetCurrentDirectory() → "/"
        /// 
        /// 核心加载策略（优先级）：
        /// 1. Mono runtime 内置的 native plugin 搜索（pchp_Data/Plugins/x86_64/）
        /// 2. Windows 标准 DLL 搜索（exe 同级目录）
        /// 3. 通过 %APPDATA% 环境变量硬编码路径模式
        /// 
        /// 策略 1 和 2 由构建时 CopyPCHPNativeDll 保证文件在正确位置，
        /// 不需要运行时手动设置路径——Mono 会自动找到。
        /// 此函数仅做兜底尝试 + 诊断日志。
        /// </summary>
        private static void SetupDllSearchPathStatic()
        {
            Debug.Log($"[WXPCHPInitScript] SetupDllSearchPath 进入，platform={Application.platform}, dataPath={Application.dataPath}");

            try
            {
                // 诊断信息（帮助排查问题）
                string assemblyLocation = "";
                try { assemblyLocation = System.Reflection.Assembly.GetExecutingAssembly().Location; } catch { }
                string baseDir = System.AppDomain.CurrentDomain.BaseDirectory;
                string cwd = "/";
                try { cwd = System.IO.Directory.GetCurrentDirectory(); } catch { }

                Debug.Log($"[WXPCHPInitScript] Assembly.Location = {assemblyLocation}");
                Debug.Log($"[WXPCHPInitScript] AppDomain.BaseDirectory = {baseDir}");
                Debug.Log($"[WXPCHPInitScript] CurrentDirectory = {cwd}");

                // === 诊断：打印命令行参数 ===
                try
                {
                    string[] cmdArgs = System.Environment.GetCommandLineArgs();
                    Debug.Log($"[WXPCHPInitScript] 命令行参数 ({cmdArgs.Length}个):");
                    for (int i = 0; i < cmdArgs.Length; i++)
                    {
                        Debug.Log($"[WXPCHPInitScript]   arg[{i}] = {cmdArgs[i]}");
                    }
                }
                catch (Exception ex) { Debug.Log($"[WXPCHPInitScript] 获取命令行参数失败: {ex.Message}"); }

                // === 诊断：打印所有环境变量 ===
                try
                {
                    var envVars = System.Environment.GetEnvironmentVariables();
                    Debug.Log($"[WXPCHPInitScript] 环境变量 ({envVars.Count}个):");
                    foreach (System.Collections.DictionaryEntry entry in envVars)
                    {
                        Debug.Log($"[WXPCHPInitScript]   {entry.Key} = {entry.Value}");
                    }
                }
                catch (Exception ex) { Debug.Log($"[WXPCHPInitScript] 获取环境变量失败: {ex.Message}"); }

                // === 策略 2：从 arg[0] 推导 exe 目录，直接 LoadLibrary ===
                // 不依赖 File.Exists（被 VFS 屏蔽），直接尝试 LoadLibrary
                try
                {
                    string[] args = System.Environment.GetCommandLineArgs();
                    if (args.Length > 0 && !string.IsNullOrEmpty(args[0]) && args[0] != "/" && !args[0].StartsWith("http"))
                    {
                        string exeDir = System.IO.Path.GetDirectoryName(args[0]);
                        if (!string.IsNullOrEmpty(exeDir))
                        {
                            string[] exeDirCandidates = new string[]
                            {
                                System.IO.Path.Combine(exeDir, "pchp_sdk.dll"),
                                System.IO.Path.Combine(exeDir, "pchp_Data", "pchp_sdk.dll"),
                                System.IO.Path.Combine(exeDir, "pchp_Data", "Plugins", "x86_64", "pchp_sdk.dll"),
                            };
                            foreach (var candidate in exeDirCandidates)
                            {
                                Debug.Log($"[WXPCHPInitScript] arg[0] 策略尝试 LoadLibrary: {candidate}");
                                try
                                {
                                    IntPtr handle = LoadLibrary(candidate);
                                    if (handle != IntPtr.Zero)
                                    {
                                        Debug.Log($"[WXPCHPInitScript] ✅ arg[0] LoadLibrary 成功！路径: {candidate}");
                                        return;
                                    }
                                    else
                                    {
                                        uint err = GetLastError();
                                        Debug.Log($"[WXPCHPInitScript] ❌ arg[0] LoadLibrary 失败，错误码: {err}");
                                    }
                                }
                                catch (Exception innerEx)
                                {
                                    Debug.Log($"[WXPCHPInitScript] arg[0] LoadLibrary 异常: {innerEx.Message}");
                                }
                            }

                            // LoadLibrary 失败则尝试 SetDllDirectory
                            try
                            {
                                bool result = SetDllDirectory(exeDir);
                                Debug.Log($"[WXPCHPInitScript] SetDllDirectory(\"{exeDir}\") = {result}");
                                if (result) return;
                            }
                            catch { }
                        }
                    }
                }
                catch (Exception ex) { Debug.Log($"[WXPCHPInitScript] arg[0] 策略失败: {ex.Message}"); }

                // === 诊断：探测 VFS 文件系统，找出 DLL 实际映射位置 ===
                try
                {
                    // 列出根目录
                    Debug.Log("[WXPCHPInitScript] === VFS 根目录 / 内容 ===");
                    foreach (var entry in System.IO.Directory.GetFileSystemEntries("/"))
                    {
                        Debug.Log($"[WXPCHPInitScript]   {entry}");
                    }
                }
                catch (Exception ex) { Debug.Log($"[WXPCHPInitScript] 列出 / 失败: {ex.Message}"); }

                try
                {
                    // 列出当前目录 ./ 
                    Debug.Log("[WXPCHPInitScript] === VFS 当前目录 ./ 内容 ===");
                    foreach (var entry in System.IO.Directory.GetFileSystemEntries("."))
                    {
                        Debug.Log($"[WXPCHPInitScript]   {entry}");
                    }
                }
                catch (Exception ex) { Debug.Log($"[WXPCHPInitScript] 列出 ./ 失败: {ex.Message}"); }

                // 搜索常见 native lib 目录
                // 注意：微信沙箱 VFS 的工作目录 ./ 实际就是 pchp_Data/（非 exe 同级）
                string[] probeDirs = new string[] { "/", ".", "./Plugins", "./Plugins/x86_64", "./pchp_Data", "./pchp_Data/Plugins", "./pchp_Data/Plugins/x86_64" };
                foreach (var dir in probeDirs)
                {
                    try
                    {
                        if (System.IO.Directory.Exists(dir))
                        {
                            var files = System.IO.Directory.GetFiles(dir);
                            if (files.Length > 0 && files.Length <= 50)
                            {
                                Debug.Log($"[WXPCHPInitScript] === {dir} 下的文件 ({files.Length}个) ===");
                                foreach (var f in files) Debug.Log($"[WXPCHPInitScript]   {f}");
                            }
                            else
                            {
                                Debug.Log($"[WXPCHPInitScript] {dir} 有 {files.Length} 个文件");
                            }
                        }
                        else
                        {
                            Debug.Log($"[WXPCHPInitScript] {dir} 目录不存在");
                        }
                    }
                    catch (Exception ex) { Debug.Log($"[WXPCHPInitScript] 探测 {dir} 失败: {ex.Message}"); }
                }

                // 直接尝试各种可能的路径检查文件是否存在
                // VFS 的 ./ = pchp_Data/，所以 ./Plugins/x86_64/ = 原 pchp_Data/Plugins/x86_64/
                string[] dllProbes = new string[]
                {
                    "./pchp_sdk.dll", "/pchp_sdk.dll",
                    "./Plugins/x86_64/pchp_sdk.dll",
                    "./Plugins/pchp_sdk.dll",
                    "./pchp_Data/Plugins/x86_64/pchp_sdk.dll",
                    "./pchp_Data/Plugins/pchp_sdk.dll",
                    "pchp_sdk.dll",
                    "./libpchp_sdk.so", "/libpchp_sdk.so",
                    "./pchp_sdk.so", "/pchp_sdk.so",
                    "./Plugins/x86_64/libpchp_sdk.so",
                    "./pchp_Data/Plugins/x86_64/libpchp_sdk.so",
                };
                Debug.Log("[WXPCHPInitScript] === DLL 路径探测 ===");
                foreach (var probe in dllProbes)
                {
                    bool exists = false;
                    try { exists = System.IO.File.Exists(probe); } catch { }
                    if (exists) Debug.Log($"[WXPCHPInitScript] ✅ 存在: {probe}");
                    else Debug.Log($"[WXPCHPInitScript] ❌ 不存在: {probe}");
                }

                // === 策略 3：通过 %APPDATA% 构造绝对路径 + LoadLibrary 强制加载 ===
                // 微信沙箱 VFS 会隐藏 .dll 文件（File.Exists 返回 false），
                // 但 kernel32.LoadLibrary 走 Windows 原生文件系统，不受 VFS 限制。
                // 因此不能依赖 File.Exists 判断，直接暴力 LoadLibrary 所有候选路径。
                string appData = null;
                try { appData = System.Environment.GetFolderPath(System.Environment.SpecialFolder.ApplicationData); } catch { }
                Debug.Log($"[WXPCHPInitScript] APPDATA = {appData}");

                if (!string.IsNullOrEmpty(appData) && appData != "/" && !appData.StartsWith("http"))
                {
                    string radiumPath = System.IO.Path.Combine(appData, "Tencent", "xwechat", "radium", "pchp");
                    Debug.Log($"[WXPCHPInitScript] 检查微信安装路径: {radiumPath}");

                    if (System.IO.Directory.Exists(radiumPath))
                    {
                        try
                        {
                            foreach (var appDir in System.IO.Directory.GetDirectories(radiumPath))
                            {
                                // 构造所有可能的 DLL 绝对路径（不依赖 File.Exists）
                                string[] candidatePaths = new string[]
                                {
                                    System.IO.Path.Combine(appDir, "pchp_sdk.dll"),
                                    System.IO.Path.Combine(appDir, "pchp_Data", "pchp_sdk.dll"),
                                    System.IO.Path.Combine(appDir, "pchp_Data", "Plugins", "pchp_sdk.dll"),
                                    System.IO.Path.Combine(appDir, "pchp_Data", "Plugins", "x86_64", "pchp_sdk.dll"),
                                };

                                foreach (var candidatePath in candidatePaths)
                                {
                                    Debug.Log($"[WXPCHPInitScript] 尝试 LoadLibrary: {candidatePath}");
                                    try
                                    {
                                        IntPtr handle = LoadLibrary(candidatePath);
                                        if (handle != IntPtr.Zero)
                                        {
                                            Debug.Log($"[WXPCHPInitScript] ✅ LoadLibrary 成功！路径: {candidatePath}, handle: {handle}");
                                            // LoadLibrary 成功后，后续 DllImport("pchp_sdk") 就能自动找到已加载的模块
                                            return;
                                        }
                                        else
                                        {
                                            uint err = GetLastError();
                                            Debug.Log($"[WXPCHPInitScript] ❌ LoadLibrary 失败，错误码: {err}, 路径: {candidatePath}");
                                        }
                                    }
                                    catch (Exception ex)
                                    {
                                        Debug.Log($"[WXPCHPInitScript] LoadLibrary 异常: {ex.Message}, 路径: {candidatePath}");
                                    }
                                }

                                // LoadLibrary 全失败了，最后尝试 SetDllDirectory 兜底
                                try
                                {
                                    string pluginDir = System.IO.Path.Combine(appDir, "pchp_Data", "Plugins", "x86_64");
                                    bool result = SetDllDirectory(pluginDir);
                                    Debug.Log($"[WXPCHPInitScript] SetDllDirectory(\"{pluginDir}\") = {result}");
                                    if (result)
                                    {
                                        Debug.Log($"[WXPCHPInitScript] ✅ SetDllDirectory 兜底成功");
                                        return;
                                    }
                                }
                                catch (Exception ex)
                                {
                                    Debug.Log($"[WXPCHPInitScript] SetDllDirectory 被拦截: {ex.Message}");
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            Debug.Log($"[WXPCHPInitScript] 遍历微信目录异常: {ex.Message}");
                        }
                    }
                }

                // 如果走到这里，说明所有主动策略都失败了
                Debug.Log($"[WXPCHPInitScript] ℹ️ 主动路径设置未成功，依赖 Mono 内置 native plugin 搜索机制（pchp_Data/Plugins/x86_64/）");
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

                // 2.5 注册同步消息处理器（内核 Initialize 流程要求必须注册）
                syncMsgHandler = HandleSyncMessage;
                _syncResponseHandle = GCHandle.Alloc(_syncResponseBuffer, GCHandleType.Pinned);
                RegisterSyncMsgHandler(syncMsgHandler);
                Debug.Log("[WXPCHPInitScript] RegisterSyncMsgHandler registered ✓");

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

        #region Public Methods - Window Control

        /// <summary>
        /// [已废弃] 控制嵌入式原生窗口是否置顶于 Chromium 自有的子 HWND 之上。
        ///
        /// 此能力已迁移到 pc-adapter JS 侧：NativeGlobal.pchp.windowControl.pinupNativeWindow(bool)。
        /// 内核通过 xWebBinding.api.nativeGameSDK.pinupNativeWindow 直接暴露给 JS，
        /// C# 侧保留仅为向后兼容，后续版本将删除。
        ///
        /// 迁移指南：
        /// - TS 适配方：调用 NativeGlobal.pchp.windowControl.pinupNativeWindow(pinup)
        /// - 游戏 C# 代码：通过 WXSDKManager 生成代码桥接到 JS 侧，或暂保留调用（会触发编译警告）
        ///
        /// 典型用法：弹出 toast / 原生 UI 前 pinup=false 让宿主覆盖游戏窗口，
        /// UI 关闭后 pinup=true 恢复游戏输入与光标行为。
        /// </summary>
        /// <param name="pinup">true=置顶（默认值）；false=允许宿主 UI 覆盖</param>
        /// <returns>true=请求已投递到浏览器进程；false=平台不支持或调用失败</returns>
        /// <remarks>
        /// 设计说明：
        /// 1. 本方法是纯窗口层级控制，不依赖 Mojo 通道（IsConnected）；
        ///    也不需要 InitEmbeddedGameSDK 完成（IsInitialized），只要 DLL 已加载即可。
        ///    因此不做 IsInitialized/IsConnected 守卫，让"游戏 loading 阶段就想 pinup=false"的场景可用。
        /// 2. 返回值仅表示请求已投递，浏览器侧实际窗口层级变更是异步的。
        ///    若后续操作强依赖层级已变更（例如紧接着 ShowWindow），调用方需自行做时序同步。
        /// 3. DllNotFoundException 会被 catch 兜底，非 Windows 平台或 DLL 缺失时返回 false 且不崩游戏。
        /// </remarks>
        [Obsolete("已迁移到 pc-adapter JS 侧 NativeGlobal.pchp.windowControl.pinupNativeWindow，C# 侧将删除。详见方法 XML 注释。")]
        public bool SetNativeWindowPinup(bool pinup)
        {
            Debug.Log($"[WXPCHPInitScript] ▶ SetNativeWindowPinup({pinup}) [DEPRECATED, 迁移至 JS NativeGlobal.pchp.windowControl]");
            try
            {
                bool queued = PinupNativeWindow(pinup);
                Debug.Log($"[WXPCHPInitScript] ✓ SetNativeWindowPinup({pinup}) → queued={queued}");
                return queued;
            }
            catch (DllNotFoundException)
            {
                Debug.LogWarning($"[WXPCHPInitScript] SetNativeWindowPinup({pinup}) 跳过：pchp_sdk.dll 未加载（当前平台 {Application.platform}）");
                return false;
            }
            catch (Exception e)
            {
                Debug.LogError($"[WXPCHPInitScript] ✗ SetNativeWindowPinup({pinup}) 异常: {e.Message}");
                return false;
            }
        }

        /// <summary>
        /// [已废弃] 查询当前原生窗口的置顶请求状态。默认值为 true。
        ///
        /// 此能力已迁移到 pc-adapter JS 侧：NativeGlobal.pchp.windowControl.isNativeWindowPinup()。
        /// C# 侧保留仅为向后兼容，后续版本将删除。
        /// </summary>
        /// <returns>true=已请求置顶；false=已请求降级或平台不支持</returns>
        /// <remarks>
        /// 与 <see cref="SetNativeWindowPinup"/> 一致，不做 IsInitialized 守卫。
        /// DLL 未加载时返回默认值 true（对齐 DLL 侧默认行为）。
        /// </remarks>
        [Obsolete("已迁移到 pc-adapter JS 侧 NativeGlobal.pchp.windowControl.isNativeWindowPinup，C# 侧将删除。详见方法 XML 注释。")]
        public bool IsNativeWindowPinupEnabled()
        {
            try
            {
                bool v = IsNativeWindowPinup();
                Debug.Log($"[WXPCHPInitScript] ✓ IsNativeWindowPinupEnabled → {v} [DEPRECATED]");
                return v;
            }
            catch (DllNotFoundException)
            {
                Debug.LogWarning($"[WXPCHPInitScript] IsNativeWindowPinupEnabled 跳过：pchp_sdk.dll 未加载（当前平台 {Application.platform}），返回默认值 true");
                return true;
            }
            catch (Exception e)
            {
                Debug.LogError($"[WXPCHPInitScript] ✗ IsNativeWindowPinupEnabled 异常: {e.Message}");
                return true;
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
            Debug.Log($"[WXPCHPInitScript] ▶ CallWXAPI ENTER: method={method}, IsInitialized={IsInitialized}, IsConnected={IsConnected}, hasSuccess={onSuccess != null}, hasFail={onFail != null}, hasComplete={onComplete != null}");

            if (!IsInitialized || !IsConnected)
            {
                Debug.LogWarning($"[WXPCHPInitScript] ✗ SDK未初始化或未连接，无法调用 {method}");
                string errRes = "{\"errMsg\":\"SDK not initialized\"}";
                onFail?.Invoke(errRes);
                onComplete?.Invoke(errRes);
                return null;
            }

            string callbackId = GenerateCallbackId();
            string paramsJson = data != null ? JsonMapper.ToJson(data) : "{}";
            Debug.Log($"[WXPCHPInitScript] ▶ CallWXAPI STEP: callbackId={callbackId}, paramsJson={paramsJson}");

            // 注册回调
            _pendingCallbacks[callbackId] = new CallbackInfo
            {
                OnSuccess = onSuccess,
                OnFail = onFail,
                OnComplete = onComplete,
                ApiName = method
            };
            Debug.Log($"[WXPCHPInitScript] ▶ CallWXAPI STEP: 已注册回调到 _pendingCallbacks (当前待处理数: {_pendingCallbacks.Count})");

            // 构建下行指令: { callbackId, method, params }
            var command = new PCHPExeCommand
            {
                callbackId = callbackId,
                method = method,
                @params = paramsJson
            };

            string commandJson = JsonMapper.ToJson(command);
            Debug.Log($"[WXPCHPInitScript] ▶ CallWXAPI STEP: 即将发送指令 JSON: {commandJson}");

            if (!SendMessageInternal(commandJson))
            {
                Debug.LogError($"[WXPCHPInitScript] ✗ CallWXAPI 发送失败: method={method}, callbackId={callbackId}");
                _pendingCallbacks.Remove(callbackId);
                string errRes = "{\"errMsg\":\"Failed to send message\"}";
                onFail?.Invoke(errRes);
                onComplete?.Invoke(errRes);
                return null;
            }

            Debug.Log($"[WXPCHPInitScript] ✓ CallWXAPI EXIT: method={method}, callbackId={callbackId} 已成功投递到 native 层");
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

        #region Custom Link Methods (自定义链路接入方专用)
        //
        // 提供 SendAppEvent / SendAppEventSync / HandleHostEvent 三个方法，
        // 与 AHP MinaSDKAHP.cs 签名对齐，让 TS 适配方（MinaSDKAHP.ts）
        // 可跨 AHP / PCHP 平台复用，无需维护两套适配代码。
        //
        // 链路：
        //   TS → SendAppEvent(jsonStr) → 内核 → game.js onExeMessage(payload)
        //   TS → SendAppEventSync(jsonStr) → 内核 → game.js → postToExe({eventName:"syncResponse", data:...})
        //   game.js → postToExe({eventName:"callback", data:...}) → ProcessIncomingMessage → HandleHostEvent
        //
        // 详见 issue #13020 § 1.6。

        /// <summary>
        /// 异步发送事件给 game.js（fire-and-forget）
        /// 与 AHP 平台 sendAppEvent(eventName, jsonStr) 双参数语义对齐：
        /// eventName 与 jsonStr 一起过桥，下行协议为 { eventName, data }，
        /// 与上行 ProcessIncomingMessage 解析的 { eventName, data } 完全对称。
        /// </summary>
        /// <param name="eventName">事件名称（随消息一起发到 game.js，C# 不解析其含义）</param>
        /// <param name="jsonStr">完整 JSON 载荷（由 TS 侧构造，作为 data 字段内联）</param>
        public void SendAppEvent(string eventName, string jsonStr)
        {
            if (!IsInitialized || !IsConnected)
            {
                Debug.LogWarning($"[WXPCHPInitScript] SDK未初始化或未连接，无法发送 {eventName}");
                return;
            }

            Debug.Log($"[WXPCHPInitScript] SendAppEvent: {eventName}");
            SendMessageInternal(WrapAppEvent(eventName, jsonStr));
        }

        /// <summary>
        /// 同步发送事件给 game.js，阻塞等待回包
        /// 伪同步实现：走异步通道 SendAppEvent（SendMsgAsync，不死锁），C# 侧 while 轮询
        /// _messageQueue 等 syncResponse 回包。对游戏代码表现为同步返回。
        /// 与 AHP 平台 sendAppEvent(eventName, jsonStr) 双参数语义对齐。
        ///
        /// ⚠️ 不走 SendMsgSync 真同步（Mojo 同步调用死锁，详见 issue #13020 §1.7）。
        /// </summary>
        /// <param name="eventName">事件名称（随消息一起发到 game.js，C# 不解析其含义）</param>
        /// <param name="jsonStr">完整 JSON 载荷（由 TS 侧构造，作为 data 字段内联）</param>
        /// <returns>回包原始数据字符串，失败/超时返回空字符串</returns>
        public string SendAppEventSync(string eventName, string jsonStr)
        {
            if (!IsInitialized || !IsConnected)
            {
                Debug.LogWarning($"[WXPCHPInitScript] SDK未初始化或未连接，无法调用 {eventName}");
                return "";
            }

            Debug.Log($"[WXPCHPInitScript] SendAppEventSync (伪同步): {eventName}");

            // 异步发（走 SendMsgAsync，不阻塞 IPC 线程，不死锁）
            _syncResponseCompleted = false;
            _pendingSyncResponse = null;
            SendAppEvent(eventName, jsonStr);

            // 阻塞等 syncResponse 回包（HandleAsyncMessage 在 IPC 线程入队，调用线程轮询取）
            var startTime = DateTime.UtcNow;
            while (!_syncResponseCompleted && (DateTime.UtcNow - startTime).TotalMilliseconds < 10000)
            {
                if (_messageQueue.TryDequeue(out var messageJson))
                {
                    try { ProcessIncomingMessage(messageJson); } catch { }
                }
                System.Threading.Thread.Sleep(1);
            }

            if (!_syncResponseCompleted)
            {
                Debug.LogWarning($"[WXPCHPInitScript] SendAppEventSync 超时(10s): {eventName}");
            }

            return _pendingSyncResponse ?? "";
        }

        /// <summary>
        /// 把 (eventName, jsonStr) 包成与 AHP 对齐的下行协议 { eventName, data }。
        /// AHP 底层 Java WVAAppSDKProvider.sendAppEvent(eventName, jsonStr) 是双参数；
        /// PCHP 底层 SendMsgAsync 只能发单个字节流，故合并为一个 JSON，
        /// 使下行与上行 ProcessIncomingMessage 解析的 { eventName, data } 协议对称。
        /// eventName 手动 JSON 转义（不能直接调 JsonMapper.ToJson(string)，LitJson 不允许
        /// string 作为顶层值序列化，会抛 "Can't add a value here"）；
        /// jsonStr 本身已是合法 JSON，直接内联为 data，避免二次转义。
        /// </summary>
        private string WrapAppEvent(string eventName, string jsonStr)
        {
            // 手动转义 eventName：JSON string 只需处理 \ 和 " 两个字符
            string ev = (eventName ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
            string data = string.IsNullOrEmpty(jsonStr) ? "null" : jsonStr;
            string envelope = $"{{\"eventName\":\"{ev}\",\"data\":{data}}}";
            Debug.Log($"[WXPCHPInitScript] WrapAppEvent: eventName={ev}, dataLen={data.Length}, envelopeLen={envelope.Length}");
            return envelope;
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
                Debug.LogWarning("[WXPCHPInitScript] SendMessage ✗ SDK未初始化或未连接");
                return false;
            }

            if (data == null || data.Length == 0)
            {
                Debug.LogWarning("[WXPCHPInitScript] SendMessage ✗ 发送的数据为空");
                return false;
            }

            try
            {
                IntPtr ptr = Marshal.AllocHGlobal(data.Length);
                try
                {
                    Marshal.Copy(data, 0, ptr, data.Length);
                    bool ok = SendMsgAsync(ptr, data.Length);
                    Debug.Log($"[WXPCHPInitScript] ▶ SendMsgAsync 返回={ok}, len={data.Length}, ptr=0x{ptr.ToInt64():X}");
                    return ok;
                }
                finally
                {
                    Marshal.FreeHGlobal(ptr);
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[WXPCHPInitScript] SendMessage ✗ 发送消息异常: {e.Message}");
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
                Debug.LogWarning("[WXPCHPInitScript] SendMessageInternal ✗ SDK未初始化或未连接");
                return false;
            }

            try
            {
                byte[] data = System.Text.Encoding.UTF8.GetBytes(message);
                bool ok = SendMessage(data);
                Debug.Log($"[WXPCHPInitScript] ▶ SendMessageInternal 结果={ok}, payloadLen={data.Length}");
                return ok;
            }
            catch (Exception e)
            {
                Debug.LogError($"[WXPCHPInitScript] SendMessageInternal ✗ 发送消息异常: {e.Message}");
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

                // 释放同步 handler 的 GCHandle
                if (_syncResponseHandle.IsAllocated)
                {
                    _syncResponseHandle.Free();
                }

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
            else if (jsonData.ContainsKey("eventName"))
            {
                // 自定义链路消息：{ eventName: string, data: string }
                string hostEventName = (string)jsonData["eventName"];
                string hostData;
                if (jsonData.ContainsKey("data"))
                {
                    var dataValue = jsonData["data"];
                    hostData = dataValue.IsString ? (string)dataValue : JsonMapper.ToJson(dataValue);
                }
                else
                {
                    hostData = messageJson;
                }

                {
                    // syncResponse → 解锁 SendAppEventSync 伪同步
                    if (hostEventName == "syncResponse" || hostEventName == "bizSyncResponse")
                    {
                        _pendingSyncResponse = hostData;
                        _syncResponseCompleted = true;
                        Debug.Log($"[WXPCHPInitScript] ← syncResponse received, unlocking SendAppEventSync: len={hostData?.Length ?? 0}");
                        return;
                    }

                    // 普通事件，转发给 HandleHostEvent / HandleBizHostEvent
                    var hostHandler = hostEventName.StartsWith("biz", StringComparison.OrdinalIgnoreCase)
                        ? HandleBizHostEvent
                        : HandleHostEvent;

                    Debug.Log($"[WXPCHPInitScript] ← ProcessIncomingMessage: host event eventName={hostEventName}, dataLen={hostData?.Length ?? 0}, hasHandler={hostHandler != null}");

                    try
                    {
                        if (hostHandler != null)
                        {
                            hostHandler.Invoke(hostEventName, hostData);
                            Debug.Log($"[WXPCHPInitScript] ✓ forwarded to {(hostEventName.StartsWith("biz", StringComparison.OrdinalIgnoreCase) ? "HandleBizHostEvent" : "HandleHostEvent")}: {hostEventName}");
                        }
                        else
                        {
                            Debug.LogWarning($"[WXPCHPInitScript] HandleHostEvent is null, event dropped: {hostEventName}");
                        }
                    }
                    catch (Exception e)
                    {
                        Debug.LogError($"[WXPCHPInitScript] HandleHostEvent error: {e}");
                    }
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
                Debug.LogWarning($"[WXPCHPInitScript] HandleAsyncMessage 收到空数据: data={data}, len={len}");
                return;
            }

            Debug.Log($"[WXPCHPInitScript] ◀ HandleAsyncMessage 收到 native 回调: len={len}, ptr=0x{data.ToInt64():X}");

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
                    Debug.Log($"[WXPCHPInitScript] ◀ 收到原始消息: {message}");
                    instance._messageQueue.Enqueue(message);
                }
                else
                {
                    Debug.LogWarning("[WXPCHPInitScript] HandleAsyncMessage: instance 为 null，消息丢弃");
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[WXPCHPInitScript] HandleAsyncMessage ✗ 处理消息异常: {e.Message}");
            }
        }

        /// <summary>
        /// 同步消息处理回调（JS→C# 方向，接住 JS 侧 sendMsgSync）
        /// 跑在 SDK IPC 线程，必须同步返回。
        /// 解析上行 envelope { eventName, data }，路由到 instance.HandleSyncHostEvent 委托，
        /// 委托同步返回结果 JSON 字符串，原样回包给 JS。
        /// 未注册委托 / 解析失败时回空 JSON {}。
        /// </summary>
        [AOT.MonoPInvokeCallback(typeof(SyncMsgHandlerDelegate))]
        private static bool HandleSyncMessage(IntPtr data, int len, out IntPtr response, out int responseLen)
        {
            response = IntPtr.Zero;
            responseLen = 0;

            if (data == IntPtr.Zero || len <= 0)
            {
                Debug.LogWarning("[WXPCHPInitScript] HandleSyncMessage: empty data");
                return false;
            }

            try
            {
                byte[] buffer = new byte[len];
                Marshal.Copy(data, buffer, 0, len);
                string requestJson = System.Text.Encoding.UTF8.GetString(buffer);
                string preview = requestJson.Length > 200 ? requestJson.Substring(0, 200) + "..." : requestJson;
                Debug.Log($"[WXPCHPInitScript] ← HandleSyncMessage (JS→C# sync): len={len}, json={preview}");

                // 默认空响应；成功路由到委托后替换
                string responseJson = "{}";

                // 解析上行 envelope { eventName, data }（与下行 WrapAppEvent 对称）
                if (instance != null && instance.HandleSyncHostEvent != null)
                {
                    string eventName = "";
                    string hostData = "";
                    try
                    {
                        var jsonData = JsonMapper.ToObject(requestJson);
                        if (jsonData.ContainsKey("eventName"))
                        {
                            eventName = (string)jsonData["eventName"];
                        }
                        if (jsonData.ContainsKey("data"))
                        {
                            var dataValue = jsonData["data"];
                            hostData = dataValue == null ? "" : (dataValue.IsString ? (string)dataValue : JsonMapper.ToJson(dataValue));
                        }
                    }
                    catch (Exception pe)
                    {
                        // 非 envelope 结构：整体作为 data 传给委托，eventName 留空
                        Debug.LogWarning($"[WXPCHPInitScript] HandleSyncMessage: not an envelope, pass raw. {pe.Message}");
                        hostData = requestJson;
                    }

                    string result = instance.HandleSyncHostEvent(eventName, hostData);
                    responseJson = string.IsNullOrEmpty(result) ? "{}" : result;
                    Debug.Log($"[WXPCHPInitScript] HandleSyncMessage routed → HandleSyncHostEvent(eventName={eventName}), respLen={responseJson.Length}");
                }
                else
                {
                    Debug.LogWarning("[WXPCHPInitScript] HandleSyncMessage: no HandleSyncHostEvent registered, return {}");
                }

                byte[] respBytes = System.Text.Encoding.UTF8.GetBytes(responseJson);
                if (respBytes.Length > _syncResponseBuffer.Length)
                {
                    Debug.LogError($"[WXPCHPInitScript] HandleSyncMessage: response too large ({respBytes.Length})");
                    return false;
                }
                Array.Copy(respBytes, 0, _syncResponseBuffer, 0, respBytes.Length);
                response = _syncResponseHandle.AddrOfPinnedObject();
                responseLen = respBytes.Length;
                Debug.Log($"[WXPCHPInitScript] → HandleSyncMessage response: len={respBytes.Length}");
                return true;
            }
            catch (Exception e)
            {
                Debug.LogError($"[WXPCHPInitScript] HandleSyncMessage error: {e.Message}");
                return false;
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
        /// 同步发送应用事件（伪同步：异步 SendAppEvent + while 轮询 _messageQueue 等 syncResponse 回包）
        ///
        /// 链路：C# → SendAppEvent → SendMsgAsync → 内核 → JS handleMessage → 插件 _handleCustomLinkEvent
        ///       → gameWX[method](...) → postToExe({eventName:"syncResponse", data:...})
        ///       → 内核 → C# HandleAsyncMessage → _messageQueue → ProcessIncomingMessage syncResponse 分支 → 解锁
        ///
        /// ⚠️ 不走 SendMsgSync 真同步（Mojo 同步调用死锁，详见 issue #13020 §1.7）。
        /// </summary>
        /// <param name="eventName">事件名（随消息一起发到 game.js）</param>
        /// <param name="jsonStr">完整 JSON 载荷</param>
        /// <returns>回包数据字符串；空字符串表示失败/超时</returns>
        public string SendAppEventSync(string eventName, string jsonStr)
        {
            if (_initScript == null)
            {
                Debug.LogError("[WXPCHighPerformanceManager] InitScript 未初始化");
                return "";
            }
            return _initScript.SendAppEventSync(eventName, jsonStr);
        }

        /// <summary>
        /// 伪同步调用微信 API（异步通道 + 阻塞等回调，对游戏代码表现为同步返回）
        /// 走 SendMsgAsync 异步通道（不死锁），C# 侧 while 轮询 _messageQueue 等回调。
        /// 插件侧对 Sync API 直接调 wx[method]() 拿返回值，主动 reply 回包。
        /// ⚠️ 可在主线程调用，但会阻塞调用线程直到回调或超时。
        /// </summary>
        public string CallWXAPISyncBridge(string method, string paramsJson = null, int timeoutMs = 5000)
        {
            if (_initScript == null)
            {
                Debug.LogError("[WXPCHighPerformanceManager] InitScript 未初始化");
                return "";
            }
            return _initScript.CallWXAPISyncBridge(method, paramsJson, timeoutMs);
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

        /// <summary>
        /// [已废弃] 控制嵌入式原生窗口是否置顶于 Chromium 自有子 HWND 之上。
        ///
        /// 此能力已迁移到 pc-adapter JS 侧：NativeGlobal.pchp.windowControl.pinupNativeWindow(bool)。
        /// C# 侧保留仅为向后兼容，后续版本将删除。
        ///
        /// 弹出原生 UI（toast 等）前置 false 让宿主覆盖游戏窗口，关闭后置 true。
        /// </summary>
        /// <param name="pinup">true=置顶（默认）；false=允许宿主 UI 覆盖</param>
        /// <returns>true=请求已投递到浏览器进程；false=不支持或调用失败</returns>
        /// <remarks>
        /// 返回值仅表示请求已投递，浏览器侧窗口层级变更是异步的。
        /// 调用方若需严格的时序保证，应自行做同步等待。
        /// </remarks>
        [Obsolete("已迁移到 pc-adapter JS 侧 NativeGlobal.pchp.windowControl.pinupNativeWindow，C# 侧将删除。")]
        public bool SetNativeWindowPinup(bool pinup)
        {
            if (_initScript == null)
            {
                Debug.LogWarning("[WXPCHighPerformanceManager] InitScript 未初始化，SetNativeWindowPinup 失败");
                return false;
            }
            return _initScript.SetNativeWindowPinup(pinup);
        }

        /// <summary>
        /// [已废弃] 查询当前原生窗口的置顶请求状态（默认 true）。
        ///
        /// 此能力已迁移到 pc-adapter JS 侧：NativeGlobal.pchp.windowControl.isNativeWindowPinup()。
        /// C# 侧保留仅为向后兼容，后续版本将删除。
        /// </summary>
        /// <returns>true=已请求置顶；false=已请求降级或平台不支持</returns>
        [Obsolete("已迁移到 pc-adapter JS 侧 NativeGlobal.pchp.windowControl.isNativeWindowPinup，C# 侧将删除。")]
        public bool IsNativeWindowPinupEnabled()
        {
            return _initScript?.IsNativeWindowPinupEnabled() ?? true;
        }
    }
}
#endif // WX_PCHP_ENABLED
