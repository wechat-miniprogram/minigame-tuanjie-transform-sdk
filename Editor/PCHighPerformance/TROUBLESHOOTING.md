# PC高性能小游戏 - 问题排查指南

## 🐛 问题1：设置面板数据被清空

### 原因
`OnLostFocus()` 时机不对，输入框的值可能还未同步到 `formInputData`

### 解决方案 ✅
已修复：在 `OnSettingsGUI()` 中添加 `GUI.changed` 检测，每次输入时自动保存

```csharp
// OnSettingsGUI() 结尾
if (GUI.changed)
{
    SaveData();  // 实时保存
}
```

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
  - 搜索关键字: `[EmbeddedAppletSDK]` 或 `DllNotFoundException`

---

#### 2. GameObject 未注入 (10%)
**症状**：构建后场景中没有 `EmbeddedAppletSDK` 对象

**验证**：使用调试工具
```
Unity 菜单 → 微信小游戏 → PC高性能调试 → 检查SDK注入状态
```

**可能的问题**：
- ❌ Build Settings 中没有启用场景
- ❌ 构建前 `PCHPBuildPreProcessor` 未执行
- ❌ 脚本编译错误导致组件未挂载

**解决**：
1. 确保 Build Settings 有至少一个启用场景
2. 查看 Console 日志：
   ```
   [PC高性能小游戏] 开始预处理构建...
   [PC高性能小游戏] 已在 XXX 中创建 SDK 对象并添加组件
   ```

---

#### 3. MessageBox 被禁用 (少见 <5%)
**症状**：有日志输出但没有弹窗

**验证**：
- 查看 Unity Editor Console 是否有 `[EmbeddedAppletSDK]` 日志
- 运行 .exe 时查看 Player.log

**临时禁用弹窗**（调试用）：
```csharp
// 修改 Templates/EmbeddedAppletSDK.cs
private void ShowInfo(string message)
{
    Debug.Log($"[EmbeddedAppletSDK] {message}");
    // MessageBox(IntPtr.Zero, message, "Info", 0x40);  // 注释掉
}
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
  ✅ 找到 SDK GameObject: EmbeddedAppletSDK
  ✅ 挂载的脚本: EmbeddedAppletSDK

[脚本文件检查]
  ✅ 用户项目中存在 EmbeddedAppletSDK.cs

[类型加载检查]
  ✅ EmbeddedAppletSDK 类型已加载
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
[EmbeddedAppletSDK]
DllNotFoundException
InitEmbeddedGameSDK
```

**正常日志**：
```
[EmbeddedAppletSDK] ========== Awake 被调用 ==========
[EmbeddedAppletSDK] GameObject 名称: EmbeddedAppletSDK
[EmbeddedAppletSDK] ========== 开始初始化 ==========
[EmbeddedAppletSDK] 当前工作目录: C:\...\YourBuild
[EmbeddedAppletSDK] Step 1: 调用 InitEmbeddedGameSDK
[EmbeddedAppletSDK] InitEmbeddedGameSDK 成功
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
| `找不到 EmbeddedAppletSDK 类型` | 脚本未编译 | 检查编译错误或重新导入 |
| `GetActiveWindow 返回空句柄` | 窗口未创建 | 延迟初始化或检查 Unity Player 设置 |

---

## 🚀 最小验证示例

创建一个最简单的测试场景：

1. **创建新场景** `TestSDK.unity`
2. **添加到 Build Settings** 并设为首场景
3. **构建一次** → 应该自动注入 SDK
4. **检查场景** → 应该有 `EmbeddedAppletSDK` GameObject
5. **运行 .exe**（确保 DLL 存在）→ 应该有弹窗

如果这个流程失败，提供 Console 和 Player.log 完整日志。
