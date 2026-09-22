# PC 高性能模式 Native DLL — `pchp_sdk.dll`

## 概述

`pchp_sdk.dll` 是 PC 高性能模式(PCHP)的核心原生通信层,负责在 Unity 游戏进程(child)与微信客户端浏览器进程(host)之间建立 Mojo IPC 通道。

```
Unity C# (WXPCHPInitScript)
    ↓  P/Invoke
pchp_sdk.dll  (本 DLL)
    ↓  Mojo IPC
微信客户端浏览器进程 (Chromium)
    ↓  adapter → sdk.js
wx.* API
```

## 文件部署

将 `pchp_sdk.dll` 放在此目录下。构建 Windows Standalone 时,SDK 会自动复制到构建产物的以下位置:
- `{输出目录}/pchp_sdk.dll`(exe 同级目录)
- `{输出目录}/pchp_Data/Plugins/x86_64/pchp_sdk.dll`(Unity 标准 Plugin 路径)

运行时 `WXPCHPInitScript` 会按以下优先级查找 DLL:
1. `{dataPath}/Plugins/x86_64/`
2. `{dataPath}/Plugins/`
3. `{dataPath}/`(即 `{ProductName}_Data/`)
4. exe 同级目录(`{dataPath}` 的父目录)
5. 向上逐级查找(兜底)

## 导出函数一览

所有函数均使用 `cdecl` 调用约定,通过 `__declspec(dllexport)` 导出。

| 函数 | 类型 | 说明 |
|------|------|------|
| `InitEmbeddedGameSDK` | 生命周期 | 初始化 SDK |
| `EstablishConnection` | 生命周期 | 建立 Mojo 连接 |
| `InitGameWindow` | 生命周期 | 绑定游戏窗口 |
| `Cleanup` | 生命周期 | 清理资源 |
| `RegisterAsyncMsgHandler` | 异步通信 | 注册异步消息回调 |
| `SendMsgAsync` | 异步通信 | 异步发送消息 |
| `RegisterSyncMsgHandler` | 同步通信 | 注册同步消息回调(JS → C# 方向) |
| `IsChannelReady` | 通道就绪 | 查询 host_remote 是否已 bind |
| `PinupNativeWindow` | 窗口控制 | 设置原生窗口置顶状态 |
| `IsNativeWindowPinup` | 窗口控制 | 查询原生窗口置顶状态 |

注:`SendMsgSync` / `FreeMsgData` 已删除——Mojo 同步调用死锁,不可用。

---

## 生命周期管理

### `InitEmbeddedGameSDK`

```c
__declspec(dllexport) bool InitEmbeddedGameSDK();
```

初始化嵌入式游戏 SDK。在调用任何其他通信函数之前必须先调用此函数。

- **返回**:`true` = 初始化成功;`false` = 失败
- **线程**:主线程
- **C# 声明**:`WXPCHPInitScript.InitEmbeddedGameSDK()`

### `EstablishConnection`

```c
__declspec(dllexport) bool EstablishConnection();
```

建立到浏览器进程的 Mojo IPC 连接。连接成功后才能收发消息。

- **返回**:`true` = 连接已建立;`false` = 连接失败
- **线程**:主线程
- **C# 声明**:`WXPCHPInitScript.EstablishConnection()`

### `InitGameWindow`

```c
__declspec(dllexport) bool InitGameWindow(ulong hwnd);
```

绑定游戏窗口句柄,供 SDK 进行窗口层级控制、输入路由等操作。

- **参数 `hwnd`**:Unity 主窗口的 HWND
- **返回**:`true` = 绑定成功;`false` = 失败
- **线程**:主线程
- **C# 声明**:`WXPCHPInitScript.InitGameWindow(ulong hwnd)`

### `Cleanup`

```c
__declspec(dllexport) bool Cleanup();
```

清理 SDK 资源,断开 Mojo 连接。应用退出时调用。

- **返回**:`true` = 清理成功;`false` = 失败
- **线程**:主线程(**不能在 SDK IPC 线程或消息处理器中调用**)
- **C# 声明**:`WXPCHPInitScript.Cleanup()`

---

## 异步通信

异步通信模式下,C# 侧通过 `SendMsgAsync` 发送消息,通过 `RegisterAsyncMsgHandler` 注册的回调接收浏览器侧的响应。发送方不阻塞,响应通过回调异步返回。

### `RegisterAsyncMsgHandler`

```c
typedef void (*AsyncMsgHandler)(const uint8_t* data, int len);

__declspec(dllexport) void RegisterAsyncMsgHandler(AsyncMsgHandler handler);
```

注册异步消息处理器。浏览器进程返回的消息会通过此回调投递到 C# 侧。

- **参数 `handler`**:消息处理回调函数指针
  - `data`:消息体(字节流,JSON 序列化后的协议数据)
  - `len`:消息体长度
  - **注意**:回调在 SDK IPC 线程执行,C# 侧需通过线程安全的方式(如 ConcurrentQueue)转发到主线程
- **线程**:主线程注册,IPC 线程回调
- **C# 声明**:`WXPCHPInitScript.RegisterAsyncMsgHandler(AsyncMsgHandlerDelegate handler)`

### `SendMsgAsync`

```c
__declspec(dllexport) bool SendMsgAsync(const uint8_t* data, int len);
```

异步发送消息到浏览器进程。消息发出后立即返回,不等待浏览器处理完成。

- **参数 `data`**:消息体指针(`data` 可为 null 当 `len` 为 0)
- **参数 `len`**:消息体长度
- **返回**:`true` = 消息已投递;`false` = 投递失败
- **注意**:`true` 只表示 DLL 接受了消息,不等于 host 已收到。host_remote 未 bind 时消息进 pending 队列,等 bind 完成后才 flush。
- **线程**:任意线程
- **C# 声明**:`WXPCHPInitScript.SendMsgAsync(IntPtr data, int len)`

---

## 通道就绪查询

### `IsChannelReady`

```c
__declspec(dllexport) bool IsChannelReady();
```

查询 Mojo IPC 通道是否就绪(host_remote 已 bind)。

- **返回**:`true` = host_remote 已 bind,`SendMsgAsync` 立即送达;`false` = 未 bind,消息进 pending 队列
- **语义**:真等 browser 侧 ConnectPchp 完成 host_remote bind 才返回 `true`,C# 侧调用前应轮询 `WaitForChannelReady` 等就绪
- **优雅降级**:dll 未导出此函数时 EntryPointNotFoundException 被捕获,后续走多次重试 fallback 路径
- **线程**:任意线程
- **C# 声明**:`WXPCHPInitScript.IsChannelReady()` → `WaitForChannelReady(int timeoutMs)` 轮询

---

## 同步通信(JS → C# 方向)

### `RegisterSyncMsgHandler`

```c
typedef bool (*SyncMsgHandler)(const uint8_t* data,
                                int len,
                                const uint8_t** response,
                                int* response_len);

__declspec(dllexport) void RegisterSyncMsgHandler(SyncMsgHandler handler);
```

注册同步消息处理器。当浏览器进程需要**主动向 C# 侧同步请求数据**时,通过此回调投递。

- **参数 `handler`**:同步消息处理回调函数指针
  - `data` / `len`:请求消息体
  - `response` / `response_len`:出参,handler 需设置响应数据的指针和长度
  - **响应内存**:只需在 handler 返回前保持有效,SDK 会在返回前拷贝数据
  - **返回值**:`true` = 处理成功并设置了 response;`false` = 处理失败
- **线程**:回调在 SDK IPC 线程执行
- **约束**:`Cleanup()` **不能**在 handler 中调用
- **C# 声明**:`WXPCHPInitScript.RegisterSyncMsgHandler(SyncMsgHandlerDelegate handler)`

注:C# → JS 方向的同步语义通过**伪同步**(异步 SendMsgAsync + while 轮询 _messageQueue 等回包)实现,见下文。

---

## C# → JS 伪同步通信

由于 Mojo 同步调用会死锁(详见下文"已知限制"),C# → JS 方向的同步语义通过**异步通道 + 主线程 while 阻塞等回包**实现。对游戏代码表现为同步返回。

### `SendAppEventSync`(C# 公开方法,非 DLL 导出)

```csharp
public string SendAppEventSync(string eventName, string jsonStr);
```

伪同步发送事件给 game.js,阻塞等待回包。失败/超时返回空字符串。

**实现链路**:
1. 入口:`IsInitialized && IsConnected` 检查
2. GetDeviceInfo 缓存命中检查(命中直接返回,绕开阻塞)
3. 优先路径:dll 暴露 `IsChannelReady` 时
   - `WaitForChannelReady(6000)`:轮询等 host_remote bind,6s 超时
   - `SendAppEventSyncInternal(2000)`:bind 完成后发请求 + while 阻塞等回包,2s 超时
4. Fallback:dll 未暴露 `IsChannelReady` 时
   - 首次调用:5 次重试 × 2s = 总 10s(覆盖 bind 延迟窗口)
   - 后续调用:单次 5s(bind 已完成)
5. while 阻塞期间 ConcurrentQueue 轮询 + Windows 消息泵(防未响应)
6. IPC 线程收到 Mojo reply → `HandleAsyncMessage` → `_messageQueue.Enqueue` → 主线程 `ProcessIncomingMessage` 识别 syncResponse → `_syncResponseCompleted = true` 解锁

### `SendAppEvent`(异步发送,C# 公开方法)

```csharp
public void SendAppEvent(string eventName, string jsonStr);
```

异步发送事件给 game.js(fire-and-forget)。内部:`WrapAppEvent` 包装 envelope → `SendMessage` 转 byte[] → `SendMsgAsync` P/Invoke。

### GetDeviceInfo 预热 + 缓存

`Initialize()` 完成后立即异步发出 GetDeviceInfo 预热请求(fire-and-forget)。回包到达 `_messageQueue` 时被 `ProcessIncomingMessage` 识别并缓存到 `_cachedDeviceInfo`。后续业务调用 `wx.getDeviceInfo()` 命中缓存,毫秒级返回,绕开 SendAppEventSyncInternal 同步阻塞。

用唯一 `_preheatRequestId` 区分预热回包和当前调用回包,避免误触发解锁。

---

## 窗口控制

### `PinupNativeWindow`

```c
__declspec(dllexport) bool PinupNativeWindow(bool pinup);
```

控制嵌入式原生窗口是否置顶于 Chromium 自有的子 HWND 之上。

- **参数 `pinup`**:`true` = 置顶(默认值);`false` = 允许宿主 UI 覆盖
- **返回**:`true` = 请求已投递到浏览器进程;`false` = 投递失败
- **语义**:返回值仅表示请求已投递,浏览器侧窗口层级变更是**异步**的
- **用途**:当宿主/原生 UI(如系统文件选择器、微信设置面板)需要覆盖 PCHP 窗口时设为 `false`,使用完毕后设回 `true` 恢复游戏输入/光标行为
- **注意**:webview 内的 Toast / Modal 等 UI 走 syncArea 机制,**不需要**通过 pinup 控制
- **线程**:任意线程
- **C# 声明**:`WXPCHPInitScript.PinupNativeWindow(bool pinup)` → 公开方法 `SetNativeWindowPinup(bool)`(已废弃,迁移到 pc-adapter JS 侧)

### `IsNativeWindowPinup`

```c
__declspec(dllexport) bool IsNativeWindowPinup();
```

查询当前原生窗口的置顶请求状态。

- **返回**:`true` = 已请求置顶(默认);`false` = 已请求降级
- **线程**:任意线程
- **C# 声明**:`WXPCHPInitScript.IsNativeWindowPinup()` → 公开方法 `IsNativeWindowPinupEnabled()`(已废弃)

---

## C# 侧接入状态

| DLL 函数 | DllImport 声明 | 公开包装方法 | 状态 |
|----------|---------------|-------------|------|
| `InitEmbeddedGameSDK` | ✅ | — | 已接入 |
| `EstablishConnection` | ✅ | — | 已接入 |
| `InitGameWindow` | ✅ | — | 已接入 |
| `Cleanup` | ✅ | — | 已接入 |
| `RegisterAsyncMsgHandler` | ✅ | — | 已接入 |
| `SendMsgAsync` | ✅ | `SendAppEvent` / `SendAppEventSync` | 已接入 |
| `RegisterSyncMsgHandler` | ✅ | — | 已接入 |
| `IsChannelReady` | ✅ | `WaitForChannelReady` | 已接入 |
| `PinupNativeWindow` | ✅ | `SetNativeWindowPinup`(已废弃) | 已接入 |
| `IsNativeWindowPinup` | ✅ | `IsNativeWindowPinupEnabled`(已废弃) | 已接入 |
| `SendMsgSync` | — | — | 已删除(Mojo 死锁) |
| `FreeMsgData` | — | — | 已删除(随 SendMsgSync) |

---

## 已知限制:Mojo 同步调用死锁(C# → JS 方向)

`SendMsgSync`(已删除)在 Mojo 同步调用下**必然死锁**:

```
C# SendMsgSync → pchp_sdk.dll IPC 线程 Mojo 同步阻塞等回包
              → host 处理完 → Mojo 回包需要 IPC 线程 pump
              → IPC 线程被同步调用占着 → 回包收不到 → 死锁
```

**替代方案**(已实现):C# → JS 同步语义通过**异步通道 + 主线程 while 阻塞等回包**(`SendAppEventSync`)实现:
- C# 用 `SendMsgAsync` 异步发(不阻塞 IPC 线程,不死锁)
- 插件侧对 Sync API 直接调 `wx[method]()` 拿返回值,主动 `reply` 回包
- C# 侧 while 轮询 ConcurrentQueue 等回包,对游戏代码表现为同步返回

`RegisterSyncMsgHandler`(JS → C# 方向,JS 主动 sendMsgSync)不受此死锁影响,正常使用。

---

## 典型调用流程

### 异步通信(如 `showToast`)

```
1. InitEmbeddedGameSDK()              → 初始化 SDK
2. RegisterAsyncMsgHandler(cb)        → 注册异步消息回调
3. RegisterSyncMsgHandler(cb)        → 注册同步消息回调(内核 Initialize 要求)
4. EstablishConnection()              → 建立 Mojo 连接
5. InitGameWindow(hwnd)               → 绑定游戏窗口
6. SendMsgAsync(data, len)            → 发送 showToast 请求
7. [IPC 线程] AsyncMsgHandler(data)   → 收到 success/complete 回调
8. [主线程] ProcessMessageQueue → 处理回调
```

### 伪同步通信(如 `getDeviceInfo`)

```
1. Initialize() 完成 → PreheatGetDeviceInfo() 异步发出预热请求
2. 业务调用 wx.getDeviceInfo() → C# SendAppEventSync

3. SendAppEventSync 入口:
   ├─ GetDeviceInfo 缓存命中 → 直接返回(毫秒级)
   └─ 未命中 → 走同步阻塞路径:
      a. IsChannelReady available:
         - WaitForChannelReady(6000) 等 host_remote bind
         - SendAppEventSyncInternal(2000) 发请求 + while 阻塞等回包
      b. Fallback:
         - 首次:5 × 2s 重试(覆盖 bind 延迟)
         - 后续:单次 5s

4. while 阻塞期间:
   ├─ ConcurrentQueue.TryDequeue → ProcessIncomingMessage 识别 syncResponse
   └─ Windows 消息泵(防未响应)

5. IPC 线程 HandleAsyncMessage → _messageQueue.Enqueue
6. 主线程 TryDequeue → 识别 syncResponse → _syncResponseCompleted = true → while 退出
7. 返回 _pendingSyncResponse 给业务
```

### 窗口控制(如宿主 UI 覆盖)

```
1. PinupNativeWindow(false)   → 降级原生窗口
2. [宿主 UI 显示并覆盖游戏窗口]
3. PinupNativeWindow(true)    → 恢复置顶
```
