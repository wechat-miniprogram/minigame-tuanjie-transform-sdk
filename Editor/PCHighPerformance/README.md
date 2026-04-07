# PC 高性能小游戏开发指南

## 目录

- [架构概览](#架构概览)
- [两条接入路径](#两条接入路径)
- [文件结构](#文件结构)
- [宏开关机制](#宏开关机制)
- [初始化机制](#初始化机制)
- [构建流程](#构建流程)
- [通信协议](#通信协议)
- [问题排查](#问题排查)
- [调试工具](#调试工具)
- [更新日志](#更新日志)

---

## 架构概览

```
C# (Unity)  ←→  direct_applet_sdk.dll  ←→  微信内核  ←→  基础库
```

| 模块 | 职责 |
|------|------|
| `WXPCHPInitScript` | MonoBehaviour，运行时核心——DLL P/Invoke、消息收发、回调调度 |
| `WXPCHighPerformanceManager` | 门面类，提供类似 `wx.xxx()` 的上层 API |
| `PCHPBuildPreProcessor` | 构建预处理器，自动管理宏定义和场景注入（兜底） |
| `WXPCHPBuildHelper` | 路径A 构建配置助手（转换工具链集成） |
| `WXPCHPWindow` | Editor 窗口 UI + 宏开关菜单 |
| `WXPCSettingHelper` | 路径B 构建设置管理（独立窗口） |
| `WXApkgPacker` | wxapkg 打包工具 |

---

## 两条接入路径

```
路径 A: "转换工具链"  ← 走 WX-WASM-SDK 转换面板，项目本身是小游戏工程
路径 B: "原生接入"    ← 项目本身就是 Standalone，只想接 PC 高性能能力
```

| 维度 | 路径 A（转换工具链） | 路径 B（原生接入） |
|------|---------------------|-------------------|
| **宏定义** | 转换工具/PreProcessor 自动添加 `WX_PCHP_ENABLED` | 开发者通过菜单一键开启，或手动添加 |
| **Build Target** | WebGL/WeixinMiniGame → 临时切 Standalone → 切回 | 始终 Standalone，不切换 |
| **初始化方式** | `RuntimeInitializeOnLoadMethod` 自动 + PreProcessor 兜底注入 | `RuntimeInitializeOnLoadMethod` 自动，或开发者手动挂载 |
| **Editor 入口** | "微信小游戏 → 生成并转换" 面板 | "微信小游戏 → 转换PC高性能模式" 独立窗口 |
| **构建后** | `RestoreToMiniGamePlatform()` 恢复平台 | 不恢复，保持 Standalone |
| **多平台兼容** | `WX_PCHP_ENABLED` 不在 WebGL 下定义，无干扰 | `WX_PCHP_ENABLED` 只在 Standalone 下定义，Android/iOS 不受影响 |

---

## 文件结构

```
WX-WASM-SDK-V2/
├── Editor/PCHighPerformance/
│   ├── PCHPBuildPreProcessor.cs   # 构建预处理器（宏管理 + 兜底注入）
│   ├── WXPCHPBuildHelper.cs       # 路径A 构建配置助手
│   ├── WXPCHPWindow.cs            # 编辑器窗口 + WX_PCHP_ENABLED 宏开关菜单
│   ├── WXPCSettingHelper.cs       # 路径B 构建设置管理
│   └── WXApkgPacker.cs            # wxapkg 打包
└── Runtime/
    └── WXPCHPInitScript.cs        # SDK 运行时脚本（整文件 #if WX_PCHP_ENABLED）
```

---

## 宏开关机制

### `WX_PCHP_ENABLED` — 总开关

**作用**：控制 `WXPCHPInitScript.cs` 及 `WXPCHighPerformanceManager` 是否参与编译。

**未定义时**：Runtime 脚本整文件跳过编译，Android/iOS/WebGL 等平台完全无干扰。

**定义方式**（三选一）：

| 方式 | 适用场景 |
|------|---------|
| Editor 菜单：`微信小游戏 → PC高性能模式宏开关` | 路径B，一键切换 |
| `PCHPBuildPreProcessor` 自动添加 | 路径A/B，Standalone 构建时自动 |
| 手动：`Player Settings → Scripting Define Symbols` 添加 `WX_PCHP_ENABLED` | 任何路径 |

### `UNITY_STANDALONE_WIN` — 平台细分

`user32.dll`（`GetActiveWindow`、`MessageBox`）的 P/Invoke 声明被 `#if UNITY_STANDALONE_WIN` 包裹，macOS 构建时不会引入。

---

## 初始化机制

### 三级策略（优先级从高到低）

| 优先级 | 方式 | 说明 |
|--------|------|------|
| 1 | **开发者手动挂载** | 场景中已存在 `WXPCHPInitScript` 组件 → `AutoInitialize` 检测到 `Instance != null`，跳过 |
| 2 | **`RuntimeInitializeOnLoadMethod`** | 场景加载后自动创建 GameObject 并挂载，零侵入不修改任何场景文件 |
| 3 | **构建时注入（兜底）** | `PCHPBuildPreProcessor` 在路径A 转换工具链模式下注入首场景 |

### 运行时初始化流程

`WXPCHPInitScript.Initialize()` 在 `Awake` 时触发，5 步串行：

```
InitEmbeddedGameSDK()     → 加载 DLL，初始化底层 SDK
       ↓
RegisterAsyncMsgHandler() → 注册 C# 静态回调到 DLL（防 GC 回收）
       ↓
EstablishConnection()     → 建立 Mojo IPC 连接
       ↓
GetActiveWindow()         → Windows: 获取 HWND / macOS: IntPtr.Zero（DLL 内部处理）
       ↓
InitGameWindow(hwnd)      → 把窗口句柄传给内核，绑定渲染窗口
```

任何一步失败整个链路中断，Windows 平台会弹 `MessageBox` 提示具体步骤。

---

## 构建流程

### PCHPBuildPreProcessor（构建预处理器）

**触发条件**：任何 Standalone (Windows/macOS) 构建

**流程**：

```
构建开始
  ↓
① 确保 WX_PCHP_ENABLED 宏已添加到 Standalone ScriptingDefineSymbols
  ↓
② 检查 WXPCHPInitScript 类型是否存在
  ├─ 未找到 → 跳过（可能需要宏生效后重新编译）
  └─ 找到 → 继续
  ↓
③ 检查首场景是否已有 WXPCHPInitScript 组件
  ├─ 已有 → 跳过注入（开发者手动挂载的）
  └─ 没有 → 检查是否为转换工具链模式
       ├─ 是 → 兜底注入到首场景
       └─ 否 → 依赖 RuntimeInitializeOnLoadMethod 自动初始化
```

### 路径A — 转换工具链构建（WXPCHPBuildHelper）

由 `WXConvertCore` 在小游戏构建完成后调用，额外步骤：
- 构建产物打包为 wxapkg 格式
- 构建完成后调用 `RestoreToMiniGamePlatform()` 恢复到 WebGL/WeixinMiniGame

### 路径B — 独立窗口构建（WXPCSettingHelper）

通过 `微信小游戏 → 转换PC高性能模式` 菜单打开，特点：
- 自动确保 `WX_PCHP_ENABLED` 宏已定义
- 不强制注入场景（依赖 `RuntimeInitializeOnLoadMethod`）
- 构建完成后 **不恢复平台**，保持 Standalone

---

## 通信协议

### 消息方向

| type | 方向 | 用途 |
|------|------|------|
| `"request"` | C# → 内核 | 调用 wx API（showToast、login 等） |
| `"event_register"` | C# → 内核 | 订阅事件（onShow、onHide 等） |
| `"event_unregister"` | C# → 内核 | 取消事件订阅 |
| `"response"` | 内核 → C# | API 回调（success / fail / complete） |
| `"event"` | 内核 → C# | 事件推送 |

### 线程模型

DLL 回调在非主线程，通过 `ConcurrentQueue` 转到主线程 `Update` 中处理：

```
DLL 线程: HandleAsyncMessage → 反序列化 → _messageQueue.Enqueue()
主线程:   Update → ProcessMessageQueue → ProcessResponse → 触发回调
```

---

## 问题排查

### 快速检查清单

- [ ] `Player Settings → Scripting Define Symbols` 包含 `WX_PCHP_ENABLED`
- [ ] Build Settings 中有至少一个启用的场景
- [ ] 导出目录包含 `.exe` 和 `direct_applet_sdk.dll`（同级）
- [ ] 运行 .exe 后 Player.log 有 `[WXPCHPInitScript]` 日志

### 问题 1：Android/iOS 构建时报 DLL 相关编译错误

**原因**：`WX_PCHP_ENABLED` 宏被错误添加到了非 Standalone 平台

**解决**：在 `Player Settings → Scripting Define Symbols` 中，确保只有 Standalone 平台定义了 `WX_PCHP_ENABLED`。或通过菜单 `微信小游戏 → PC高性能模式宏开关` 关闭。

### 问题 2：DLL 加载失败（~90% 的运行时问题）

**症状**：运行 .exe 后没有弹窗，日志报 `DllNotFoundException`

**验证导出目录结构**：
```
导出路径/
├── YourGame.exe
├── direct_applet_sdk.dll  ← 必须存在
└── YourGame_Data/
```

**解决**：确保 `direct_applet_sdk.dll` 与 `.exe` 同级

### 问题 3：GetActiveWindow 返回空句柄

**原因**：窗口尚未创建时调用了初始化

**解决**：检查 Unity Player Settings，确保非后台启动；或考虑延迟初始化

**注意**：macOS 平台会传 `IntPtr.Zero`，由 DLL 内部获取窗口句柄，这是正常行为。

### 问题 4：宏添加后代码未生效

**原因**：修改 `ScriptingDefineSymbols` 后需要 Unity 重新编译脚本

**解决**：等待 Unity 编译完成（底部进度条），或手动 `Assets → Reimport All`

### 错误代码速查

| 错误信息 | 原因 | 解决 |
|----------|------|------|
| `DllNotFoundException` | DLL 不在 .exe 同级目录 | 复制 DLL 到 .exe 目录 |
| `EntryPointNotFoundException` | DLL 版本不匹配 | 更新 `direct_applet_sdk.dll` |
| `找不到 WXPCHPInitScript 类型` | SDK 未安装或宏未生效 | 重新导入 SDK 或等待编译 |
| `GetActiveWindow 返回空句柄` | 窗口未创建（仅 Windows） | 延迟初始化或检查 Player Settings |
| `WXPCHPInitScript 必须在 Runtime 程序集` | 脚本放在了 Editor 目录 | 移到 Runtime 目录 |

---

## 调试工具

### 日志查看

**Player.log 位置**：
- Windows: `%APPDATA%\..\LocalLow\<CompanyName>\<ProductName>\Player.log`
- macOS: `~/Library/Logs/<CompanyName>/<ProductName>/Player.log`

**搜索关键字**：`[WXPCHPInitScript]`、`DllNotFoundException`、`InitEmbeddedGameSDK`

**正常日志示例**：
```
[WXPCHPInitScript] 通过 RuntimeInitializeOnLoadMethod 自动创建
[WXPCHPInitScript] ========== Awake 被调用 ==========
[WXPCHPInitScript] ========== 开始初始化 ==========
[WXPCHPInitScript] Step 1: 调用 InitEmbeddedGameSDK
...
[WXPCHPInitScript] ========== 初始化完成 ==========
```

### Editor 菜单

| 菜单项 | 功能 |
|--------|------|
| 微信小游戏 → 转换PC高性能模式 | 打开路径B独立构建窗口 |
| 微信小游戏 → PC高性能模式宏开关 | 一键启用/禁用 `WX_PCHP_ENABLED` 宏 |

---

## 更新日志

### v2.0.0 (2026-04-07)
- **双路径架构**：支持"转换工具链"和"原生接入"两条路径
- **`WX_PCHP_ENABLED` 宏**：总开关，整文件条件编译，Android/iOS 零干扰
- **`RuntimeInitializeOnLoadMethod`**：零侵入自动初始化，不再强制修改场景
- **`user32.dll` 平台隔离**：`#if UNITY_STANDALONE_WIN` 包裹，macOS 兼容
- **`RestoreToMiniGamePlatform` 解耦**：从 `BuildPCHighPerformance` 的 finally 移到调用方
- **Editor 宏开关菜单**：`微信小游戏 → PC高性能模式宏开关`

### v1.1.0 (2026-03-02)
- 重命名 `EmbeddedAppletSDK` → `WXPCHPInitScript`
- 迁移脚本到 Runtime 目录
- 添加 `WeChatWASM` 命名空间

### v1.0.0 (2026-03-02)
- 实现自动注入 EmbeddedAppletSDK GameObject
- 智能检测并复制模板脚本
- 兼容 Windows 和 macOS 构建
