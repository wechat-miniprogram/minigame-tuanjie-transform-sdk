# PC高性能小游戏 - 自动化构建注入

## 📂 文件结构

```
WX-WASM-SDK-V2/
├── Editor/PCHighPerformance/
│   ├── PCHPBuildPreProcessor.cs    # 构建预处理器（自动注入）
│   ├── PCHPDebugHelper.cs          # 调试工具
│   ├── WXPCSettingHelper.cs        # 构建配置助手
│   └── WXEditorPCHPWindow.cs       # 编辑器窗口
└── Runtime/
    └── WXPCHPInitScript.cs         # SDK 运行时脚本
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
Step 1: 检查 WXPCHPInitScript 是否已加载
    ├── 已加载 → 继续
    └── 未加载 → 报错中断（SDK 安装问题）
    ↓
Step 2: 打开首个启用场景
    ↓
Step 3: 检查场景是否已有 "WXPCHPInitScript" GameObject
    ├── 有 → 删除重建
    └── 没有 → 创建新 GameObject + 添加 WXPCHPInitScript 组件
    ↓
Step 4: 保存场景并恢复原始布局
    ↓
继续正常构建流程
```

---

## ✅ 关键特性

1. **零侵入**：不修改开发者当前打开的场景
2. **智能检测**：自动检测是否已存在脚本/对象
3. **SDK 内置**：脚本位于 SDK Runtime 目录，无需复制到用户项目
4. **命名空间隔离**：使用 `WeChatWASM` 命名空间避免冲突

---

## 🔧 配置说明

### 脚本位置

```
Assets/WX-WASM-SDK-V2/Runtime/WXPCHPInitScript.cs
```

**类名**：`WeChatWASM.WXPCHPInitScript`

**作用**：运行时初始化 PC 高性能小游戏 SDK，与宿主程序通信

---

## 🐛 常见问题

### Q: 为什么导出的工程没有 SDK 对象？

检查 Console 日志：
- ✅ `[PC高性能小游戏] ✅ 已在 XXX 中创建 WXPCHPInitScript 并添加组件` → 成功
- ⚠️ `找不到 WXPCHPInitScript 类型` → SDK 未正确安装

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
| 类全名 | `WeChatWASM.WXPCHPInitScript` |

---

## 🔄 更新日志

### v1.1.0 (2026-03-02)
- ✅ 重命名 `EmbeddedAppletSDK` → `WXPCHPInitScript`
- ✅ 迁移脚本到 Runtime 目录（解决 Editor 脚本无法挂载问题）
- ✅ 添加 `WeChatWASM` 命名空间
- ✅ 移除模板复制机制（脚本现在内置于 SDK）

### v1.0.0 (2026-03-02)
- ✅ 实现自动注入 EmbeddedAppletSDK GameObject
- ✅ 智能检测并复制模板脚本
- ✅ 兼容 Windows 和 macOS 构建
