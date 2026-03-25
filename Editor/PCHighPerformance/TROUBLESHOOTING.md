# PC高性能小游戏 - 问题排查指南

## 🐛 问题1：设置面板数据被清空

### 原因
`OnLostFocus()` 时机不对，输入框的值可能还未同步到 `formInputData`

### 解决方案 ✅
已修复：在 `OnSettingsGUI()` 中添加 `GUI.changed` 检测，每次输入时自动保存

---

## 🐛 问题2：ShowInfo 逻辑未执行

### 可能原因

#### 1. DLL 未找到 (最常见 90%)
**症状**：运行 .exe 后没有任何弹窗  
**原因**：`direct_applet_sdk.dll` 不在 .exe 同级目录

**验证**：
```bash
# 检查导出目录结构
导出路径/
├── YourGame.exe
├── direct_applet_sdk.dll  ← 必须存在
└── YourGame_Data/
```

**解决**：
- 确保 DLL 在运行时根目录
- 查看 Unity Player.log：
  - Windows: `%APPDATA%\..\LocalLow\<CompanyName>\<ProductName>\Player.log`
  - 搜索关键字: `[WXPCHPInitScript]` 或 `DllNotFoundException`

---

#### 2. GameObject 未注入 (10%)
**症状**：构建后场景中没有 `WXPCHPInitScript` 对象

**验证**：使用调试工具
```
Unity 菜单 → 微信小游戏 → PC高性能调试 → 检查SDK注入状态
```

**可能的问题**：
- ❌ Build Settings 中没有启用场景
- ❌ 构建前 `PCHPBuildPreProcessor` 未执行
- ❌ SDK 未正确安装

**解决**：
1. 确保 Build Settings 有至少一个启用场景
2. 查看 Console 日志：
   ```
   [PC高性能小游戏] 开始预处理构建...
   [PC高性能小游戏] ✅ 已在 XXX 中创建 WXPCHPInitScript 并添加组件
   ```

---

## 🔍 调试步骤（按顺序）

### Step 1: 检查 SDK 注入状态
```
Unity 菜单 → 微信小游戏 → PC高性能调试 → 检查SDK注入状态
```

✅ 正常输出示例：
```
[构建场景] 启用的场景数: 1
  ✅ 首场景: Assets/Scenes/Main.unity
  ✅ 找到 SDK GameObject: WXPCHPInitScript
  ✅ 挂载的脚本: WeChatWASM.WXPCHPInitScript

[类型加载检查]
  ✅ WXPCHPInitScript 类型已加载
  程序集: WxWasmSDKRuntime
```

---

### Step 2: 检查导出路径
```
Unity 菜单 → 微信小游戏 → PC高性能调试 → 查看导出路径
```

确认：
- ✅ 目录存在
- ✅ 有 .exe 文件

---

### Step 3: 运行 .exe 并查看日志

**日志位置**：
```
Windows: %APPDATA%\..\LocalLow\YourCompany\YourProduct\Player.log
Mac: ~/Library/Logs/Company Name/Product Name/Player.log
```

**搜索关键字**：
```
[WXPCHPInitScript]
DllNotFoundException
InitEmbeddedGameSDK
```

**正常日志**：
```
[WXPCHPInitScript] ========== Awake 被调用 ==========
[WXPCHPInitScript] GameObject 名称: WXPCHPInitScript
[WXPCHPInitScript] ========== 开始初始化 ==========
[WXPCHPInitScript] Step 1: 调用 InitEmbeddedGameSDK
[WXPCHPInitScript] InitEmbeddedGameSDK 成功
...
```

**异常日志**：
```
DllNotFoundException: Unable to load DLL 'direct_applet_sdk.dll'
  → 解决: 复制 DLL 到 .exe 同级目录
```

---

## 📝 快速检查清单

- [ ] Build Settings 中有启用的场景
- [ ] 构建时 Console 有 `[PC高性能小游戏] 预处理完成!` 日志
- [ ] 导出目录包含 `.exe` 和 `direct_applet_sdk.dll`
- [ ] 运行 .exe 后有弹窗或 Player.log 有日志

---

## 🛠️ 调试工具菜单

| 菜单项 | 功能 |
|--------|------|
| 检查SDK注入状态 | 验证场景中是否有 SDK 对象和脚本 |
| 查看导出路径 | 显示配置的导出路径和状态 |
| 打开导出目录 | 在文件管理器中打开导出目录 |

---

## 💡 常见错误代码

| 错误信息 | 原因 | 解决方法 |
|----------|------|----------|
| `DllNotFoundException` | DLL 未找到 | 复制 DLL 到 .exe 同级目录 |
| `EntryPointNotFoundException` | 函数不存在 | 检查 DLL 版本是否匹配 |
| `找不到 WXPCHPInitScript 类型` | SDK 未安装 | 重新导入 WX-WASM-SDK-V2 |
| `GetActiveWindow 返回空句柄` | 窗口未创建 | 延迟初始化或检查 Unity Player 设置 |
