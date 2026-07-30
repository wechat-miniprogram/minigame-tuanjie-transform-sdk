# PC 高性能模式 Native DLL — `pchp_sdk.dll`

## 概述

`pchp_sdk.dll` 是 PC 高性能模式（PCHP）的核心原生通信层，负责在 Unity 游戏进程与微信客户端浏览器进程之间建立 Mojo IPC 通道。

**架构定位**：

```
Unity C# (WXPCHPInitScript)
    ↓  P/Invoke
pchp_sdk.dll  (本 DLL)
    ↓  Mojo IPC
微信浏览器进程 (Chromium)
    ↓  adapter → sdk.js
wx.* API
```

## 文件部署

将 `pchp_sdk.dll` 放在此目录下。

构建 Windows Standalone 时，SDK 会自动将其复制到构建产物的以下位置：
- `{输出目录}/pchp_sdk.dll`（exe 同级目录）
- `{输出目录}/pchp_Data/Plugins/x86_64/pchp_sdk.dll`（Unity 标准 Plugin 路径）

运行时 `WXPCHPInitScript` 会按以下优先级查找 DLL：
1. `{dataPath}/Plugins/x86_64/`
2. `{dataPath}/Plugins/`
3. `{dataPath}/`（即 `{ProductName}_Data/`）
4. exe 同级目录（`{dataPath}` 的父目录）
5. 向上逐级查找（兜底）

## 导出函数一览

所有函数均使用 `cdecl` 调用约定，通过 `__declspec(dllexport)` 导出。

| 函数 | 类型 | 说明 |
|------|------|------|
| `InitEmbeddedGameSDK` | 生命周期 | 初始化 SDK |
| `EstablishConnection` | 生命周期 | 建立 Mojo 连接 |
| `InitGameWindow` | 生命周期 | 绑定游戏窗口 |
| `Cleanup` | 生命周期 | 清理资源 |
| `RegisterAsyncMsgHandler` | 异步通信 | 注册异步消息回调 |
| `SendMsgAsync` | 异步通信 | 异步发送消息 |
| `RegisterSyncMsgHandler` | 同步通信 **NEW** | 注册同步消息回调 |
| `SendMsgSync` | 同步通信 **NEW** | 同步发送消息（阻塞等待响应） |
| `FreeMsgData` | 同步通信 **NEW** | 释放同步响应内存 |
| `PinupNativeWindow` | 窗口控制 | 设置原生窗口置顶状态 |
| `IsNativeWindowPinup` | 窗口控制 | 查询原生窗口置顶状态 |

---

## 生命周期管理

### `InitEmbeddedGameSDK`

```c
__declspec(dllexport) bool InitEmbeddedGameSDK();
```

初始化嵌入式游戏 SDK。在调用任何其他通信函数之前必须先调用此函数。

- **返回**：`true` = 初始化成功；`false` = 失败
- **线程**：主线程
- **C# 声明**：`WXPCHPInitScript.InitEmbeddedGameSDK()`

### `EstablishConnection`

```c
__declspec(dllexport) bool EstablishConnection();
```

建立到浏览器进程的 Mojo IPC 连接。连接成功后才能收发消息。

- **返回**：`true` = 连接已建立；`false` = 连接失败
- **线程**：主线程
- **C# 声明**：`WXPCHPInitScript.EstablishConnection()`

### `InitGameWindow`

```c
__declspec(dllexport) bool InitGameWindow(ulong hwnd);
```

绑定游戏窗口句柄，供 SDK 进行窗口层级控制、输入路由等操作。

- **参数 `hwnd`**：Unity 主窗口的 HWND
- **返回**：`true` = 绑定成功；`false` = 失败
- **线程**：主线程
- **C# 声明**：`WXPCHPInitScript.InitGameWindow(ulong hwnd)`

### `Cleanup`

```c
__declspec(dllexport) bool Cleanup();
```

清理 SDK 资源，断开 Mojo 连接。应用退出时调用。

- **返回**：`true` = 清理成功；`false` = 失败
- **线程**：主线程（**不能在 SDK IPC 线程或消息处理器中调用**）
- **C# 声明**：`WXPCHPInitScript.Cleanup()`

---

## 异步通信

异步通信模式下，C# 侧通过 `SendMsgAsync` 发送消息，通过 `RegisterAsyncMsgHandler` 注册的回调接收浏览器侧的响应。发送方不阻塞，响应通过回调异步返回。

### `RegisterAsyncMsgHandler`

```c
typedef void (*AsyncMsgHandler)(const uint8_t* data, int len);

__declspec(dllexport) void RegisterAsyncMsgHandler(AsyncMsgHandler handler);
```

注册异步消息处理器。浏览器进程返回的消息会通过此回调投递到 C# 侧。

- **参数 `handler`**：消息处理回调函数指针
  - `data`：消息体（字节流，JSON 序列化后的协议数据）
  - `len`：消息体长度
  - **注意**：回调在 SDK IPC 线程执行，C# 侧需通过线程安全的方式（如队列）转发到主线程
- **线程**：主线程注册，IPC 线程回调
- **C# 声明**：`WXPCHPInitScript.RegisterAsyncMsgHandler(AsyncMsgHandlerDelegate handler)`

### `SendMsgAsync`

```c
__declspec(dllexport) bool SendMsgAsync(const uint8_t* data, int len);
```

异步发送消息到浏览器进程。消息发出后立即返回，不等待浏览器处理完成。

- **参数 `data`**：消息体指针（`data` 可为 null 当 `len` 为 0）
- **参数 `len`**：消息体长度
- **返回**：`true` = 消息已投递；`false` = 投递失败
- **线程**：任意线程
- **C# 声明**：`WXPCHPInitScript.SendMsgAsync(IntPtr data, int len)`

---

## 同步通信（NEW）

同步通信模式下，C# 侧通过 `SendMsgSync` 发送消息并**阻塞等待**浏览器进程返回响应。响应内存由 SDK 分配，调用方负责通过 `FreeMsgData` 释放。

适用于需要立即获取返回值的 API（如 `getDeviceInfo`、`getWindowInfo` 等同步 API）。

### `RegisterSyncMsgHandler`

```c
typedef bool (*SyncMsgHandler)(const uint8_t* data,
                                int len,
                                const uint8_t** response,
                                int* response_len);

__declspec(dllexport) void RegisterSyncMsgHandler(SyncMsgHandler handler);
```

注册同步消息处理器。当浏览器进程需要**主动向 C# 侧同步请求数据**时，通过此回调投递。

- **参数 `handler`**：同步消息处理回调函数指针
  - `data` / `len`：请求消息体
  - `response` / `response_len`：出参，handler 需设置响应数据的指针和长度
  - **响应内存**：只需在 handler 返回前保持有效，SDK 会在返回前拷贝数据。响应内存由 handler 自行管理（通常用栈或固定 buffer）
  - **返回值**：`true` = 处理成功并设置了 response；`false` = 处理失败
- **线程**：回调在 SDK IPC 线程执行
- **约束**：`Cleanup()` **不能**在 handler 中调用
- **C# 声明**：待补充（`WXPCHPInitScript` 尚未声明此 DllImport）

### `SendMsgSync`

```c
__declspec(dllexport) bool SendMsgSync(const uint8_t* data,
                                        int len,
                                        uint8_t** response,
                                        int* response_len);
```

同步发送消息到浏览器进程，**阻塞等待**浏览器处理并返回响应。

- **参数 `data`**：请求消息体（`data` 可为 null 当 `len` 为 0）
- **参数 `len`**：请求消息体长度
- **参数 `response`**：出参，接收 SDK 分配的响应内存指针（成功时非 null）
- **参数 `response_len`**：出参，接收响应内存长度
- **返回**：`true` = 成功，`response` 指向有效内存；`false` = 失败
- **内存管理**：`response` 指向的内存由 SDK 分配，**必须通过 `FreeMsgData` 释放**，否则内存泄漏
- **线程**：任意线程（但会阻塞调用线程直到浏览器响应，**不建议在主线程调用**，会导致帧卡顿）
- **C# 声明**：待补充（`WXPCHPInitScript` 尚未声明此 DllImport）

### `FreeMsgData`

```c
__declspec(dllexport) void FreeMsgData(uint8_t* data);
```

释放 `SendMsgSync` 返回的响应内存。

- **参数 `data`**：`SendMsgSync` 的 `response` 出参指针。传 null 安全（空操作）
- **线程**：任意线程
- **C# 声明**：待补充（`WXPCHPInitScript` 尚未声明此 DllImport）

---

## 窗口控制

### `PinupNativeWindow`

```c
__declspec(dllexport) bool PinupNativeWindow(bool pinup);
```

控制嵌入式原生窗口是否置顶于 Chromium 自有的子 HWND 之上。

- **参数 `pinup`**：`true` = 置顶（默认值）；`false` = 允许宿主 UI 覆盖
- **返回**：`true` = 请求已投递到浏览器进程；`false` = 投递失败
- **语义**：返回值仅表示请求已投递，浏览器侧窗口层级变更是**异步**的
- **用途**：当宿主/原生 UI（如系统文件选择器、微信设置面板）需要覆盖 PCHP 窗口时设为 `false`，使用完毕后设回 `true` 恢复游戏输入/光标行为
- **注意**：webview 内的 Toast / Modal 等 UI 走 syncArea 机制，**不需要**通过 pinup 控制
- **线程**：任意线程
- **C# 声明**：`WXPCHPInitScript.PinupNativeWindow(bool pinup)` → 公开方法 `SetNativeWindowPinup(bool)`

### `IsNativeWindowPinup`

```c
__declspec(dllexport) bool IsNativeWindowPinup();
```

查询当前原生窗口的置顶请求状态。

- **返回**：`true` = 已请求置顶（默认）；`false` = 已请求降级
- **线程**：任意线程
- **C# 声明**：`WXPCHPInitScript.IsNativeWindowPinup()` → 公开方法 `IsNativeWindowPinupEnabled()`

---

## C# 侧接入状态

| DLL 函数 | DllImport 声明 | 公开包装方法 | 状态 |
|----------|---------------|-------------|------|
| `InitEmbeddedGameSDK` | ✅ | — | 已接入 |
| `EstablishConnection` | ✅ | — | 已接入 |
| `InitGameWindow` | ✅ | — | 已接入 |
| `Cleanup` | ✅ | — | 已接入 |
| `RegisterAsyncMsgHandler` | ✅ | — | 已接入 |
| `SendMsgAsync` | ✅ | `CallWXAPI` | 已接入 |
| `RegisterSyncMsgHandler` | ❌ | — | **待接入** |
| `SendMsgSync` | ❌ | — | **待接入** |
| `FreeMsgData` | ❌ | — | **待接入** |
| `PinupNativeWindow` | ✅ | `SetNativeWindowPinup` | 已接入 |
| `IsNativeWindowPinup` | ✅ | `IsNativeWindowPinupEnabled` | 已接入 |

同步通信三个函数的 C# DllImport 声明 + 公开包装方法尚未在 `WXPCHPInitScript.cs` 中实现，需后续补充。

---

## 典型调用流程

### 异步通信（如 `showToast`）

```
1. InitEmbeddedGameSDK()           → 初始化 SDK
2. RegisterAsyncMsgHandler(cb)     → 注册异步消息回调
3. EstablishConnection()           → 建立 Mojo 连接
4. SendMsgAsync(data, len)         → 发送 showToast 请求
5. [IPC 线程] AsyncMsgHandler(data) → 收到 success/complete 回调
6. [主线程] 处理回调，更新 UI
```

### 同步通信（如 `getDeviceInfo`）

```
1. InitEmbeddedGameSDK()           → 初始化 SDK（同上）
2. EstablishConnection()           → 建立 Mojo 连接（同上）
3. SendMsgSync(req, len, &resp, &respLen)  → 阻塞等待浏览器返回设备信息
4. 处理 resp 中的 JSON 数据
5. FreeMsgData(resp)               → 释放响应内存
```

### 窗口控制（如宿主 UI 覆盖）

```
1. PinupNativeWindow(false)        → 降级原生窗口
2. [宿主 UI 显示并覆盖游戏窗口]
3. PinupNativeWindow(true)         → 恢复置顶
```
