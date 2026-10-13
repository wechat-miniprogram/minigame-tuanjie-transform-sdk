# WX-WASM-SDK V2 到 V3 迁移指南

V3 是一次架构级重构：将原本 Unity 专属的模板结构升级为通用引擎适配架构（微信小游戏 WXGameKit 统一启动内核）。因此无法直接原地覆盖 V2，需要先手动删除 V2 目录并检查用户自定义代码，否则会出现"找不到 xxx""xxx is undefined"等运行时错误。

如果你的项目从未修改过 SDK 的 JS 模板 / jslib 胶水代码，只在 C# 层调用 `WX.xxx()` API，通常只需删旧包 + 导新包即可，无需改代码。但仍建议通读第 3 节，确认是否触发了任何用户可感知差异。

## 目录

1. [为什么需要迁移](#1-为什么必须迁移)
2. [删除旧包（V2）步骤](#2-删除旧包v2步骤)
3. [用户代码适配点](#3-用户代码适配点)
4. [常见错误与排查](#4-常见错误与排查)
5. [API 映射速查表](#5-api-映射速查表)

## 1. 为什么需要迁移

老的 V2 模板后续仅做 bug 修复，不再新增特性；所有新增能力都在 V3 模板下开发，建议游戏按需升级。

V3 切换到通用启动内核 WXGameKit：

- 引擎无关（同一套内核可支撑 Unity / Tuanjie / 通用 WASM 游戏）
- 全局对象统一收敛到 `GameGlobal.WXGameKit` 命名空间
- 配置驱动：多数原本的硬编码开关改由 `WXGameKit.config.*` 读取
- 生命周期改为事件订阅（`WXGameKit.lifeCycle.on()`），不再直接挂函数

注意：V3 与 V2 在 JS 侧全局命名空间、customEnv 注入变量、生命周期时机三个维度都不兼容。

## 2. 删除旧包（V2）步骤

按顺序执行下面步骤，任何一步跳过都可能残留冲突文件导致运行时报错。

### 2.1 备份用户自定义修改

如果你曾经修改过以下位置，请先备份：

- `Assets/WX-WASM-SDK-V2/Editor/template/`（自定义 cover-base / 加载页 / plugin.js）
- `Assets/WX-WASM-SDK-V2/Editor/MiniGameConfig.asset`（发布配置：AppID、AppSecret、CDN 等）
- `Assets/WX-WASM-SDK-V2/Runtime/Plugins/*.jslib`（用户自定义的 JS 胶水层）

配置迁移说明：`MiniGameConfig.asset` 的 .meta guid 在 V2 与 V3 之间不同，直接拷贝过来 Unity 会认不出。推荐做法是导入 V3 后在编辑器窗口重新填一遍配置（AppID、CDN 等字段不多）。

### 2.2 关闭 Unity Editor

务必完全退出 Unity Editor（不是最小化，也不是只关工程），否则删除目录时 Unity 会立刻重新扫描并锁死文件。

### 2.3 删除旧的 SDK 目录

V2 SDK 有两种安装方式，先判断你的安装方式，再按对应小节操作。判断方法：

| 判据 | Mode A：UnityPackage 导入 | Mode B：Git URL / UPM 安装 |
|---|---|---|
| 目录位置 | `Assets/WX-WASM-SDK-V2/` 存在 | `Assets/` 下没有 `WX-WASM-SDK-V2/`；`Packages/manifest.json` 里含 `com.qq.weixin.minigame` 条目 |
| Package Manager 窗口 | 看不到该包 | `In Project → com.qq.weixin.minigame` 可见 |
| 官方发布渠道 | `minigame.<版本号>.unitypackage` | GitHub `wechat-miniprogram/minigame-tuanjie-transform-sdk` 或 `minigame-unity-webgl-transform` |

两种模式互斥，同一个工程通常只用其中一种；如果两种都装过（不推荐），需要 A 和 B 都执行一遍。

#### 2.3-A 模式 A：UnityPackage 导入方式的清理

在项目根目录下执行（或用文件管理器手动删）：

```bash
# 必删（V2 版本）
rm -rf Assets/WX-WASM-SDK-V2/
rm -f  Assets/WX-WASM-SDK-V2.meta

# 若曾经安装过更老的 V1（2023-05 之前）也要一并清理
rm -rf Assets/WX-WASM-SDK/
rm -f  Assets/WX-WASM-SDK.meta
```

#### 2.3-B 模式 B：Git URL / Unity Package Manager 安装方式的清理

V2 时代也支持通过 UPM（Unity Package Manager）+ Git URL 安装 SDK，此时 SDK 不在 `Assets/` 下，而是被 Unity 解压到 `Packages/` 目录，manifest 里对应一条 Git 依赖：

```jsonc
// Packages/manifest.json 中的旧条目
{
  "dependencies": {
    "com.qq.weixin.minigame": "https://github.com/wechat-miniprogram/minigame-tuanjie-transform-sdk"
  }
}
```

推荐做法（图形化，不易漏）：

1. 打开菜单 `Window → Package Manager`
2. 顶部下拉选 `In Project`
3. 找到 `WeChat MiniGame`（或包名 `com.qq.weixin.minigame`），右侧点 `Remove`
4. Unity 会自动更新 `Packages/manifest.json` 并删除 `Packages/com.qq.weixin.minigame/`

手动做法（脚本化，适合 CI）：

```bash
# 1) 编辑 Packages/manifest.json，删掉这一行：
#    "com.qq.weixin.minigame": "https://github.com/..."
#    如果它是最后一行，别忘了把上一行末尾多余的逗号也去掉。

# 2) 删除 UPM 本地解压缓存
rm -rf Packages/com.qq.weixin.minigame/
rm -f  Packages/com.qq.weixin.minigame.meta

# 3) 清 UPM 全局缓存里对应这个 Git 依赖的解压目录（出问题时再执行）
rm -rf "$HOME/.cache/unity3d/npm/com.qq.weixin.minigame"*   # Linux
# macOS: ~/Library/Unity/cache/npm/com.qq.weixin.minigame*
# Windows: %LOCALAPPDATA%\Unity\cache\npm\com.qq.weixin.minigame*
```

同时检查以下位置是否残留（有则删）：

```bash
rm -f Packages/packages-lock.json    # 让 Unity 下次重新解析依赖
```

同时用过 A + B 的用户：先按 B 卸载 UPM 版本，再按 A 删除 `Assets/` 下的残留，最后清 Library。顺序不能反，否则 UPM 会尝试重新解压丢失的 Git 包，卡在下载失败。

#### 2.3-C 通用后置检查

无论 A / B 哪种模式，删完后跑一遍：

```bash
# 项目根目录，应该完全没有输出
find . -type d \( -name "WX-WASM-SDK" -o -name "WX-WASM-SDK-V2" -o -name "com.qq.weixin.minigame" \) 2>/dev/null | grep -v "^./Library/"
```

有任何输出说明还有残留，继续删；输出全在 `Library/` 下的可以忽略（下一步会清 Library）。

### 2.4 清理 Unity Library 缓存

避免 Unity 复用旧的 asmdef / dll 元数据：

```bash
rm -rf Library/ScriptAssemblies/
rm -rf Library/PackageCache/
rm -rf Temp/
```

保留 `Library/` 的其他内容以避免重导入所有资源；如果 SDK 导入后仍有编译错误，再整体 `rm -rf Library/`。

### 2.5 导入 V3 SDK

根据之前在 2.3 判断的安装方式，选一种导入方式，不要两种都装：

#### 2.5-A 方式 A：导入 V3 UnityPackage

- 双击 `minigame.<版本号>.unitypackage`，或通过 Unity 菜单 `Assets → Import Package → Custom Package...`
- 必须勾选全部文件，包括 `WebGLTemplates/` 和 `WX-WASM-SDK-V3/`

#### 2.5-B 方式 B：通过 Unity Package Manager 安装 V3

打开 `Window → Package Manager → 左上角 + → Add package from git URL...`，输入 V3 版本对应的 Git URL（以官方 README 提供的最新地址为准）。

或直接编辑 `Packages/manifest.json`，将旧条目替换为 V3：

```jsonc
{
  "dependencies": {
    "com.qq.weixin.minigame": "https://github.com/wechat-miniprogram/minigame-tuanjie-transform-sdk#v0.x.x"
  }
}
```

Git URL 后加 `#<tag>` 可以锁定版本，避免每次 `Package Manager → Refresh` 都拉最新可能引入不确定性。

### 2.6 打开 Unity 让其重新导入

首次打开会执行 SDK 的 `InitializeOnLoad` 钩子。查看 Console：

- 正常：`[WeChatWASM] 微信小游戏转换插件版本: v0.x.x`
- 报错 `找不到 Assets/WX-WASM-SDK-V2/...`（Mode A 残留）或 `找不到 Packages/com.qq.weixin.minigame/...`（Mode B 残留）：说明还有用户脚本 hardcode 了旧路径，全局搜替换

### 2.7 重新填写 MiniGameConfig

菜单 `微信小游戏 → 转换小游戏` 打开配置窗口，填入 AppID、导出目录等配置。

## 3. 用户代码适配点

判断顺序：先看 A、B、O（所有人必看）；然后按你对 SDK 的改动深度从上到下判断是否需要改：

- 只用 `WX.xxx()` C# API：只做 A + O
- 改过 jslib / SendMessage 胶水：加做 C、G、H、I、M
- 改过 plugin.js / 自定义 cover-base：加做 B、E、L
- 改过启动流程钩子（onModulePrepared / onCrash）：加做 F、J、K

### A. 目录名与包路径（必改）

| 位置 | V2 | V3 |
|---|---|---|
| SDK 根目录 | `Assets/WX-WASM-SDK-V2/` | `Assets/WX-WASM-SDK-V3/` |
| 配置文件 | `Assets/WX-WASM-SDK-V2/Editor/MiniGameConfig.asset` | `Assets/WX-WASM-SDK-V3/Editor/MiniGameConfig.asset` |
| Runtime DLL | `Assets/WX-WASM-SDK-V2/Runtime/Plugins/wx-runtime.dll` | `Assets/WX-WASM-SDK-V3/Runtime/Plugins/wx-runtime.dll` |
| 模板目录 | `Assets/WX-WASM-SDK-V2/Editor/template/` | `Assets/WX-WASM-SDK-V3/Editor/template/` |

用户需检查的地方：

```bash
# 在你自己的项目里全局搜"WX-WASM-SDK-V2"，把结果按需替换成"WX-WASM-SDK-V3"
grep -rn "WX-WASM-SDK-V2" Assets/ Editor/ your-custom-scripts/
```

常见需要改的自定义脚本：

- 自动化打包脚本里 `Path.Combine(Application.dataPath, "WX-WASM-SDK-V2", ...)`
- 自定义 asmdef 或 .csproj 里 `HintPath="Assets/WX-WASM-SDK-V2/..."`
- CI/CD 脚本里的路径

### B. 小游戏插件名 UnityPlugin 改为 WXGameKit

如果你在小游戏侧（不是 Unity 侧）改过 `game.json` 或 `plugin.json`：

```json
// V2 老写法
{
  "plugins": {
    "UnityPlugin": { "provider": "wxe5a48f1ed5f544b7", "version": "..." }
  }
}
```

```json
// V3 新写法
{
  "plugins": {
    "WXGameKit": { "provider": "wxe5a48f1ed5f544b7", "version": "..." }
  }
}
```

老版启动插件（UnityPlugin）与 V3 使用的通用启动插件（WXGameKit）AppID 不同。微信小游戏转换插件会自动生成正确的 `game.json`，通常不用手动改；只有你手动定制过 `game.json` 才需要注意。

获取 JS API：

```js
// V2
const UnityPlugin = requirePlugin('UnityPlugin');

// V3
const WXGameKit = requirePlugin('WXGameKit');
```

### C. 全局挂载点 unityNamespace 改为 WXGameKit（核心）

这是 V2 到 V3 最大的一处不兼容点。V2 时代所有全局对象散落挂在 `GameGlobal.unityNamespace.*`，V3 全部收敛到 `GameGlobal.WXGameKit.*`。

| V2（老） | V3（新） |
|---|---|
| `GameGlobal.unityNamespace.Module` | `GameGlobal.WXGameKit.gameInstance.Module` |
| `GameGlobal.unityNamespace.UnityModule` | `GameGlobal.WXGameKit.gameInstance.UnityModule` |
| `GameGlobal.unityNamespace.Browser` | `GameGlobal.WXGameKit.gameInstance.Browser` |
| `GameGlobal.unityNamespace.FS` | `GameGlobal.WXGameKit.gameInstance.FS` |
| `GameGlobal.unityNamespace.IDBFS` | `GameGlobal.WXGameKit.gameInstance.IDBFS` |
| `GameGlobal.unityNamespace.runDependencies` | `GameGlobal.WXGameKit.gameInstance.runDependencies` |
| `GameGlobal.unityNamespace.isLoopRunnerEnable` | `GameGlobal.WXGameKit.gameInstance.isLoopRunnerEnable` |
| `GameGlobal.unityNamespace.enableProfileStats` | `GameGlobal.WXGameKit.gameInstance.enableProfileStats` |
| `GameGlobal.unityNamespace.isAndroid` | `GameGlobal.WXGameKit.gameInstance.env.isAndroid` |
| `GameGlobal.unityNamespace.isIOS` | `GameGlobal.WXGameKit.gameInstance.env.isIOS` |
| `GameGlobal.unityNamespace.isDevtools` | `GameGlobal.WXGameKit.gameInstance.env.isDevtools` |
| `GameGlobal.unityNamespace.isH5Renderer` | `GameGlobal.WXGameKit.gameInstance.env.isH5Renderer` |
| `GameGlobal.unityNamespace.isDevelopmentBuild` | `WXGameKit.config.project.isDevelopmentBuild` |
| `GameGlobal.unityNamespace.isProfilingBuild` | `WXGameKit.config.project.isProfilingBuild` |
| `GameGlobal.unityNamespace.unityVersion` | `WXGameKit.config.project.engine.version` |
| `GameGlobal.unityNamespace.unityColorSpace` | `WXGameKit.config.runtime.colorSpace` |
| `GameGlobal.unityNamespace.DATA_CDN` | `WXGameKit.config.network.dataFileCDN` |
| `GameGlobal.unityNamespace.maxStorage` | `WXGameKit.config.fileSystem.maxStorage` |
| `GameGlobal.unityNamespace.releaseMemorySize` | `WXGameKit.config.fileSystem.releaseMemorySize` |
| `GameGlobal.unityNamespace.iOSAutoGCInterval` | `WXGameKit.config.runtime.iOSAutoGCInterval` |
| `GameGlobal.unityNamespace.monitorConfig` | `WXGameKit.config.develop.monitor` |
| `GameGlobal.unityNamespace.preloadWXFont` | `WXGameKit.config.sdk.preloadWXFont` |
| `GameGlobal.unityNamespace.needCacheTextures`（全局开关） | `WXGameKit.fs.getIsTextureCacheable(path)`（按资源判断） |

批量搜替换命令（建议在自定义 jslib 目录里执行）：

```bash
grep -rn "GameGlobal\.unityNamespace" your-jslibs/ your-custom-templates/
```

### D. GameGlobal.manager / managerConfig 已移除

V2 时代还有另外两个挂载点也一并没了：

| V2（老） | V3（新） |
|---|---|
| `GameGlobal.manager.wasmsplit.*` | 分包 API 未迁移（详见 N 节，待补） |
| `GameGlobal.manager.getWXAppCheatMonitor` | 已合并进 `WXGameKit.debug.*` |
| `GameGlobal.managerConfig.XXX` | `WXGameKit.config.launch.XXX` 或对应命名空间 |

如果你的胶水层引用了 `GameGlobal.manager.` 或 `GameGlobal.managerConfig.` 且没改，运行时会直接抛 `Cannot read property 'xxx' of undefined`。

### E. customEnv 注入变量变化（影响自定义 plugin.js）

小游戏插件 `plugin.js` 里通过 `customEnv` 向宿主注入的变量集合发生了变化：

| V2 注入 | V3 注入 |
|---|---|
| `wx` | `wx` |
| `unityNamespace` | （移除） |
| `document` | `document` |
| `canvas` | `canvas` |
| `events` | （移除） |
| （无） | `navigator`（新增） |
| （无） | `XMLHttpRequest`（新增） |
| `WXWASMSDK` | `WXWASMSDK` |

影响：

- 如果你的自定义 `plugin.js` 依赖 `unityNamespace` 或 `events` 参数，会拿到 `undefined`，改为通过 `WXGameKit.config.*` 或 `WXGameKit.lifeCycle` 获取
- `navigator` / `XMLHttpRequest` 现在由内核统一注入，你不再需要自己 mock

### F. 文件缓存策略钩子改为 Handler 注册模式

老版是在 unity-namespace.js 里挂函数，V3 改为在 `handlers.js` 里注册回调：

```js
// V2 老写法（在 index.js 里挂）
GameGlobal.unityNamespace.isCacheableFile = function (path) { ... };
GameGlobal.unityNamespace.isErasableFile = function (path) { ... };
GameGlobal.unityNamespace.isWXAssetBundle = function (path) { ... };
```

```js
// V3 新写法（在 handlers.js 里注册）
WXGameKit.fs.setAssetCacheableHandler(function (path) { ... });
WXGameKit.fs.setErasableHandler(function (path) { ... });
WXGameKit.fs.setWXAssetBundleHandler(function (path) { ... });
```

同样，`isCacheableFile(src)`（InnerAudioContext 判断音频缓存）改为 `WXGameKit.fs.getIsAssetCacheable(src)`。

### G. XMLHttpRequest 命名空间迁移

任何在 jslib 里创建自定义 XHR 的代码都要改：

```js
// V2
var xhr = new GameGlobal.unityNamespace.UnityLoader.UnityCache.XMLHttpRequest();
```

```js
// V3
var xhr = new WXGameKit.network.XMLHttpRequest();
```

这个改动对纹理并行下载（TEXTURE_PARALLEL_BUNDLE）和字体资源下载特别关键。如果你有自研的资源预下载 / 并行下载逻辑（例如自己实现了 `GameGlobal.ParalleLDownloadTexture`），务必检查。

### H. Unity Module / UnityModule 访问路径

Unity 生成的胶水层入口从"直接暴露到 GameGlobal"改为"挂在 `WXGameKit.gameInstance` 下"：

```js
// V2
Module = GameGlobal.unityNamespace.Module;
unityFramework = GameGlobal.unityNamespace.UnityModule;
```

```js
// V3
Module = WXGameKit.gameInstance.Module;
unityFramework = WXGameKit.gameInstance.UnityModule;
```

如果你有自定义的 `dynCall / cwrap / addFunction` 调用点用到 Module，需一并迁移。

### I. 游戏配置读取方式（managerConfig 改为 WXGameKit.config）

V3 的 config 是分域的，不再是老的扁平字段：

| 域 | 内容 | 举例 |
|---|---|---|
| `WXGameKit.config.project` | 项目 / 引擎信息 | `engine.name`、`engine.version`、`convertPluginVersion`、`isDevelopmentBuild` |
| `WXGameKit.config.launch` | 启动参数 | 启动 CDN、启动流程配置 |
| `WXGameKit.config.network` | 网络 | `dataFileCDN`、超时 / 重试参数 |
| `WXGameKit.config.fileSystem` | 文件系统 | `maxStorage`、`releaseMemorySize` |
| `WXGameKit.config.runtime` | 运行时 | `contextConfig.contextType`、`colorSpace`、`iOSAutoGCInterval` |
| `WXGameKit.config.develop` | 开发调试 | `monitor` |
| `WXGameKit.config.sdk` | SDK 内 | `preloadWXFont` |
| `WXGameKit.config.unity` | Unity 专属 | `unityHeapReservedMemory` |

对老代码里 `GameGlobal.managerConfig.xxx` 或 `unityNamespace.xxx` 里的字段，按上表分域找到对应字段。

### J. onCrash 崩溃处理注册方式

```js
// V2
GameGlobal.onCrash = function (err) { ... };
```

```js
// V3
WXGameKit.status.setOnCrashHandler(function (err) { ... });
// 判断可见性
if (WXGameKit.status.isVisible) { ... }
```

### K. 启动生命周期钩子改用事件订阅

```js
// V2
gameManager.onModulePrepared = function () { ... };
GameGlobal.onLogError = function (msg) { ... };
```

```js
// V3
WXGameKit.lifeCycle.on(WXGameKit.event.PreparedModule, function () { ... });
wx.onError(function (msg) { ... });    // 统一走 wx 原生事件
WXGameKit.Logger.eventLog('addRunDependency: ', id);   // 内核日志
```

### L. 默认背景图（CoverView）路径

如果你在自定义 CoverView 皮肤时引用了默认背景图：

| V2 | V3 |
|---|---|
| `Assets/WX-WASM-SDK-V2/Runtime/wechat-default/images/mini-loading.jpg` | `Assets/WX-WASM-SDK-V3/Runtime/wechat-default/wx-game-kit/images/background.jpg` |

在 Editor 里可通过 `MiniGameConfig.asset` 的 `bgImageSrc` 字段查看默认值。

### M. enableProfileStats 触发路径

```js
// V2
if (GameGlobal.unityNamespace.enableProfileStats) {
  setTimeout(() => SendMessage('WXSDKManagerHandler', 'OpenProfileStats'), 10000);
}
```

```js
// V3
if (WXGameKit.gameInstance.enableProfileStats) {
  setTimeout(() => SendMessage('WXSDKManagerHandler', 'OpenProfileStats'), 10000);
}
```

通常不用手动改：微信小游戏转换插件会在导出小游戏时自动完成替换。仅当你关闭了 SDK 的胶水替换、自己维护胶水层时才需要手动改。

### N. wasm-split 分包

V2 支持的 `GameGlobal.manager.wasmsplit.*` 主包 / 子包动态加载能力，V3 已切换到通用分包方案，具体接入请参考官方文档：

- 通用分包方案：https://developers.weixin.qq.com/minigame/dev/guide/game-engine/WasmSplitV2_1.html

### O. 迁移完成后的自检清单

按顺序在 Unity Editor 和小游戏开发者工具里各自跑一遍，任何一项失败都不算完成：

- Unity Console 没有 `找不到 Assets/WX-WASM-SDK-V2/xxx` 之类的错误
- 菜单 `微信小游戏 → 转换小游戏` 能正常打开配置面板
- 点击"转换"能成功导出 `webgl-min/` 目录
- 小游戏开发者工具打开 `webgl-min/`，控制台没有 `Cannot read property 'xxx' of undefined`，尤其检查以下 undefined：
  - `GameGlobal.unityNamespace is undefined`
  - `GameGlobal.manager is undefined`
  - `GameGlobal.managerConfig is undefined`
- 游戏正常加载并进入首个场景
- 已使用的关键功能验证：登录 / 支付 / 分享 / 广告 / AssetBundle 加载 / WXFile 缓存 / 纹理压缩
- 真机验证（iOS 和 Android 各至少一台）

## 4. 常见错误与排查

| 报错关键字 | 可能原因 | 处理 |
|---|---|---|
| `找不到 Assets/WX-WASM-SDK-V2/...` | 用户脚本 hardcode 了 V2 路径 | 全局搜 `WX-WASM-SDK-V2` 替换为 `WX-WASM-SDK-V3` |
| `GameGlobal.unityNamespace is undefined` | jslib / plugin.js 用了老挂载点 | 按 C 节映射表改 |
| `GameGlobal.manager is undefined` | 用了老 wasm-split / cheat monitor API | 按 D 节处理 |
| `wx.env.USER_DATA_PATH is undefined`（部分基础库） | 基础库版本过低 | 升级到 3.0.0+ |
| `requirePlugin('UnityPlugin') is not a function` | 还在用老启动插件 | 换为 `requirePlugin('WXGameKit')`，并更新 `game.json`（B 节） |
| Unity Editor 编译报错 `MiniGameConfig.asset 找不到` | 旧 asset guid 与新 SDK 不匹配 | 手动删除 `Library/`，重开 Unity |
| 音频 / 视频 / 纹理下载失败 | 自定义 XHR 用了老命名空间 | 按 G 节改 |
| 首帧黑屏但无报错 | 自定义 CoverView 引用了旧背景图路径 | 按 L 节改 |

## 5. API 映射速查表

快速定位：Ctrl+F 搜你原来用的 API 名字。

### 5.1 全局对象

| V2 | V3 |
|---|---|
| `GameGlobal.unityNamespace` | `GameGlobal.WXGameKit` |
| `GameGlobal.manager` | （移除） |
| `GameGlobal.managerConfig` | `WXGameKit.config.*` |
| `GameGlobal.onCrash = fn` | `WXGameKit.status.setOnCrashHandler(fn)` |
| `GameGlobal.onLogError = fn` | `wx.onError(fn)` |

### 5.2 模块访问

| V2 | V3 |
|---|---|
| `GameGlobal.unityNamespace.Module` | `WXGameKit.gameInstance.Module` |
| `GameGlobal.unityNamespace.UnityModule` | `WXGameKit.gameInstance.UnityModule` |
| `GameGlobal.unityNamespace.Browser` | `WXGameKit.gameInstance.Browser` |
| `GameGlobal.unityNamespace.FS` | `WXGameKit.gameInstance.FS` |
| `GameGlobal.unityNamespace.IDBFS` | `WXGameKit.gameInstance.IDBFS` |

### 5.3 环境判断

| V2 | V3 |
|---|---|
| `GameGlobal.unityNamespace.isAndroid` | `WXGameKit.gameInstance.env.isAndroid` |
| `GameGlobal.unityNamespace.isIOS` | `WXGameKit.gameInstance.env.isIOS` |
| `GameGlobal.unityNamespace.isDevtools` | `WXGameKit.gameInstance.env.isDevtools` |
| `GameGlobal.unityNamespace.isH5Renderer` | `WXGameKit.gameInstance.env.isH5Renderer` |

### 5.4 配置读取

| V2 | V3 |
|---|---|
| `GameGlobal.unityNamespace.DATA_CDN` | `WXGameKit.config.network.dataFileCDN` |
| `GameGlobal.unityNamespace.maxStorage` | `WXGameKit.config.fileSystem.maxStorage` |
| `GameGlobal.unityNamespace.releaseMemorySize` | `WXGameKit.config.fileSystem.releaseMemorySize` |
| `GameGlobal.unityNamespace.iOSAutoGCInterval` | `WXGameKit.config.runtime.iOSAutoGCInterval` |
| `GameGlobal.unityNamespace.unityColorSpace` | `WXGameKit.config.runtime.colorSpace` |
| `GameGlobal.unityNamespace.unityVersion` | `WXGameKit.config.project.engine.version` |
| `GameGlobal.unityNamespace.preloadWXFont` | `WXGameKit.config.sdk.preloadWXFont` |
| `GameGlobal.unityNamespace.monitorConfig` | `WXGameKit.config.develop.monitor` |
| `GameGlobal.unityNamespace.isDevelopmentBuild` | `WXGameKit.config.project.isDevelopmentBuild` |

### 5.5 网络

| V2 | V3 |
|---|---|
| `new GameGlobal.unityNamespace.UnityLoader.UnityCache.XMLHttpRequest()` | `new WXGameKit.network.XMLHttpRequest()` |

### 5.6 文件系统与缓存策略

| V2 | V3 |
|---|---|
| `GameGlobal.unityNamespace.isCacheableFile = fn` | `WXGameKit.fs.setAssetCacheableHandler(fn)` |
| `GameGlobal.unityNamespace.isErasableFile = fn` | `WXGameKit.fs.setErasableHandler(fn)` |
| `GameGlobal.unityNamespace.isWXAssetBundle = fn` | `WXGameKit.fs.setWXAssetBundleHandler(fn)` |
| `unityNamespace.isCacheableFile(src)` | `WXGameKit.fs.getIsAssetCacheable(src)` |
| `unityNamespace.needCacheTextures`（全局开关） | `WXGameKit.fs.getIsTextureCacheable(path)`（按路径判断） |
| （无） | `WXGameKit.fs.pluginCachePath`（插件缓存目录） |
| （无） | `WXGameKit.fs.cleanCache(size)` 和 `cleanAllCache()` |
| （无） | `WXGameKit.fs.pathInFileOS` 和 `WXGameKit.fs.wxAssetBundles` |

### 5.7 状态与生命周期

| V2 | V3 |
|---|---|
| `GameGlobal.onCrash = fn` | `WXGameKit.status.setOnCrashHandler(fn)` |
| （无） | `WXGameKit.status.isVisible` |
| `gameManager.onModulePrepared = fn` | `WXGameKit.lifeCycle.on(WXGameKit.event.PreparedModule, fn)` |

### 5.8 调试与 Profiler

| V2 | V3 |
|---|---|
| `GameGlobal.manager.getWXAppCheatMonitor()` | `WXGameKit.debug.getCheatMonitor()` |
| （无） | `WXGameKit.debug.getGameDataMonitor()`（性能数据） |
| （无） | `WXGameKit.debug.profiler.startProfile()` 和 `initProfiler()` 和 `uploadBinary()` |

### 5.9 日志

| V2 | V3 |
|---|---|
| `console.log`（散落） | `WXGameKit.Logger.eventLog(...)` 和 `pluginLog(...)` |
| （无） | `WXGameKit.Logger.logManager.warn/error(...)` |
| （无） | `WXGameKit.Logger.realtimeLogManager.error(...)` |

### 5.10 上报

| V2 | V3 |
|---|---|
| （无） | `WXGameKit.reporter.alarm.malloc(alarm_item)` |
| （无） | `WXGameKit.reporter.wxassetbundleReporter.reportEmptyContent(err)` |
