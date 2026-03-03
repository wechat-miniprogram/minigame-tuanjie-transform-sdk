using System;
using System.Runtime.InteropServices;
using UnityEngine;

namespace WeChatWASM
{
    /// <summary>
    /// PC高性能小游戏初始化脚本
    /// 负责与宿主程序的 direct_applet_sdk.dll 进行交互
    /// </summary>
    public class WXPCHPInitScript : MonoBehaviour
    {
        #region DLL Imports

        private const string DLL_NAME = "direct_applet_sdk.dll";

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

        // 获取当前活动窗口句柄
        [DllImport("user32.dll")]
        private static extern IntPtr GetActiveWindow();

        // Windows MessageBox
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);

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

        #region Events

        // 收到异步消息时触发的事件
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

        #region Unity Lifecycle

        private void Awake()
        {
            Debug.Log("[WXPCHPInitScript] ========== Awake 被调用 ==========");
            Debug.Log($"[WXPCHPInitScript] GameObject 名称: {gameObject.name}");
            Debug.Log($"[WXPCHPInitScript] 场景名称: {UnityEngine.SceneManagement.SceneManager.GetActiveScene().name}");

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

        #region Public Methods

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

            try
            {
                // 1. 初始化SDK
                Debug.Log("[WXPCHPInitScript] Step 1: 调用 InitEmbeddedGameSDK");
                if (!InitEmbeddedGameSDK())
                {
                    ShowError("InitEmbeddedGameSDK 返回 false");
                    return;
                }

                // 2. 注册消息处理器 
                Debug.Log("[WXPCHPInitScript] Step 2: 调用 RegisterAsyncMsgHandler");
                asyncMsgHandler = HandleAsyncMessage;
                RegisterAsyncMsgHandler(asyncMsgHandler);

                // 3. 建立连接
                Debug.Log("[WXPCHPInitScript] Step 3: 调用 EstablishConnection");
                if (!EstablishConnection())
                {
                    ShowError("EstablishConnection 返回 false");
                    IsConnected = false;
                    return;
                }
                IsConnected = true; 

                // 4. 获取窗口句柄并初始化游戏窗口
                Debug.Log("[WXPCHPInitScript] Step 4: 获取窗口句柄");
                WindowHandle = GetActiveWindow();
                if (WindowHandle == IntPtr.Zero)
                {
                    ShowError("GetActiveWindow 返回空句柄");
                    return;
                }
                Debug.Log($"获取窗口句柄成功: 0x{WindowHandle.ToInt64():X}");

                Debug.Log("[WXPCHPInitScript] Step 5: 调用 InitGameWindow");
                if (!InitGameWindow((ulong)WindowHandle.ToInt64()))
                {
                    ShowError("InitGameWindow 返回 false");
                    return;
                }

                IsInitialized = true;
                Debug.Log("[WXPCHPInitScript] ========== 初始化完成 ==========");
            }
            catch (DllNotFoundException e)
            {
                ShowError($"找不到DLL: {e.Message}");
                Debug.LogError($"[WXPCHPInitScript] DLL 加载失败，请确保 {DLL_NAME} 在以下位置之一：");
                Debug.LogError($"  - 与 .exe 同级目录");
                Debug.LogError($"  - System32 目录");
                Debug.LogError($"  - PATH 环境变量包含的路径");
            }
            catch (EntryPointNotFoundException e)
            {
                ShowError($"找不到函数入口: {e.Message}");
                Debug.LogError($"[WXPCHPInitScript] 函数入口点错误，可能是 DLL 版本不匹配");
            }
            catch (Exception e)
            {
                ShowError($"初始化异常: {e.Message}\n{e.StackTrace}");
                Debug.LogError($"[WXPCHPInitScript] 未知异常: {e}");
            }
        }

        /// <summary>
        /// 显示信息弹窗（仅 Windows）
        /// </summary>
        private void ShowInfo(string message)
        {
            Debug.Log($"[WXPCHPInitScript] {message}");
#if UNITY_STANDALONE_WIN
            try
            {
                // MB_OK | MB_ICONINFORMATION = 0x40
                MessageBox(IntPtr.Zero, message, "WXPCHPInitScript Info", 0x40);
            }
            catch (System.Exception e)
            {
                Debug.LogWarning($"[WXPCHPInitScript] MessageBox 调用失败: {e.Message}");
            }
#endif
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
        /// 发送异步消息到宿主
        /// </summary>
        /// <param name="message">消息内容</param>
        /// <returns>是否发送成功</returns>
        public bool SendMessage(string message)
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
        /// 发送异步消息到宿主
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
        /// 异步消息处理回调
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

                // 在主线程中触发事件
                if (instance != null)
                {
                    // 直接调用，如果需要线程安全可以使用Unity的主线程调度
                    instance.OnMessageReceived?.Invoke(buffer);

                    // 打印收到的消息（用于调试）
                    string message = System.Text.Encoding.UTF8.GetString(buffer);
                    Debug.Log($"[WXPCHPInitScript] 收到消息: {message}");
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[WXPCHPInitScript] 处理消息异常: {e.Message}");
            }
        }

        #endregion
    }
}
