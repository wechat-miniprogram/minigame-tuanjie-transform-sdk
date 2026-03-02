# PC高性能小游戏 - 自动化构建注入

## 📂 文件结构

```
WX-WASM-SDK-V2/Editor/PCHighPerformance/
├── PCHPBuildPreProcessor.cs           # 构建预处理器（自动注入）
├── WXPCSettingHelper.cs               # 构建配置助手
├── WXEditorPCHPWindow.cs              # 编辑器窗口
└── Templates/
    └── EmbeddedAppletSDK.cs           # SDK 运行时脚本模板
```

---

## 🎯 功能说明

### 自动注入机制

**触发时机**：开发者点击「生成并转换」按钮，Unity 开始构建 Windows/macOS 平台前

**工作流程**：

```
构建开始
    ↓
PCHPBuildPreProcessor.OnPreprocessBuild() 触发
    ↓
Step 1: 检查用户项目是否有 EmbeddedAppletSDK.cs
    ├── 有 → 跳过
    └── 没有 → 从 Templates/ 复制到 Assets/Scripts/
    ↓
Step 2: 打开首个启用场景
    ↓
Step 3: 检查场景是否已有 "EmbeddedAppletSDK" GameObject
    ├── 有 → 跳过注入
    └── 没有 → 创建空 GameObject + 添加 EmbeddedAppletSDK 组件
    ↓
Step 4: 保存场景并恢复原始布局
    ↓
继续正常构建流程
```

---

## ✅ 关键特性

1. **零侵入**：不修改开发者当前打开的场景
2. **智能检测**：自动检测是否已存在脚本/对象，避免重复
3. **自动复制**：首次使用时自动将 SDK 脚本复制到用户项目
4. **可定制**：开发者可修改复制后的脚本实现自定义逻辑

---

## 🔧 配置说明

### 模板文件位置

```
Assets/WX-WASM-SDK-V2/Editor/PCHighPerformance/Templates/EmbeddedAppletSDK.cs
```

**作用**：首次构建时自动复制到用户项目的 `Assets/Scripts/` 目录

### 复制目标路径

```
用户项目/Assets/Scripts/EmbeddedAppletSDK.cs
```

**策略**：`File.Copy(overwrite: false)` → 不会覆盖用户已修改的文件

---

## 🐛 常见问题

### Q: 为什么导出的工程没有 SDK 对象？

检查 Console 日志：
- ✅ `[PC高性能小游戏] 已在 XXX 中创建 SDK 对象并添加组件` → 成功
- ⚠️ `找不到 EmbeddedAppletSDK 类型` → 脚本未编译或命名空间错误

### Q: 如何自定义 SDK 逻辑？

1. 构建一次（自动复制模板到 `Assets/Scripts/EmbeddedAppletSDK.cs`）
2. 修改该文件
3. 后续构建会使用你修改的版本

### Q: DLL 加载失败？

**原因**：`direct_applet_sdk.dll` 必须在 **运行时** 的根目录（与 .exe 同级）

**解决**：确保宿主程序启动时提供 DLL

---

## 📝 技术细节

| 项 | 值 |
|---|---|
| 触发接口 | `IPreprocessBuildWithReport` |
| 回调优先级 | `callbackOrder = 0` |
| 支持平台 | Windows x64, macOS |
| 场景修改策略 | 临时打开 → 注入 → 保存 → 恢复 |
| 脚本复制策略 | 首次复制，不覆盖已有文件 |

---

## 🔄 更新日志

### v1.0.0 (2026-03-02)
- ✅ 实现自动注入 EmbeddedAppletSDK GameObject
- ✅ 智能检测并复制模板脚本
- ✅ 兼容 Windows 和 macOS 构建
