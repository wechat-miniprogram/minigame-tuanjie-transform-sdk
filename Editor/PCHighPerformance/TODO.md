# PC 高性能模式 — TODO

## 🔴 高优先级

### 路径B 平台依赖问题
- **现状**：PC 高性能模式的 Editor 代码（菜单、面板）在 `com.qq.weixin.minigame` UPM 包内，团结引擎的子平台包加载机制导致**只有 Active Platform 切到 WeixinMiniGame 时，包才会被编译加载**
- **影响**：路径B（PC 纯项目）开发者必须先切到小游戏平台才能看到 `微信小游戏 → 转换PC高性能模式` 菜单，认知摩擦极大
- **方案选项**：
  - [ ] **方案 A（低成本）**：文档说明 "切平台仅为激活菜单，不影响最终构建"（v0.1.x 临时方案）
  - [ ] **方案 B（推荐）**：将 PC 高性能模式拆成独立 Unity Package，不依赖小游戏子平台加载（v0.2 目标）
  - [ ] **方案 C（折中）**：提供独立 `.unitypackage` 安装包，绕过 UPM 子平台系统

### ~~PCHPBuildPreProcessor 首次构建宏时序问题~~ ✅ 已修复
- **修复方案**：采用方案 A —— 在 `BuildPlayer()` 之前（`SwitchActiveBuildTarget` 之前）就调用 `EnsurePCHPDefineSymbol()`
  - 路径A (`WXPCHPBuildHelper.BuildPCHighPerformance`)：新增 `EnsurePCHPDefineSymbol(buildTarget)` 在 try 块开头
  - 路径B (`WXPCSettingHelper`)：原本已在 Step 1 正确处理
  - `PCHPBuildPreProcessor`：保留作为兜底（手动 Build 时仍能补宏，第二次生效）

## 🟡 中优先级

### 清理 WXPCHPInitScript 中的 ShowStepInfo 调用
- **现状**：初始化流程每一步都调用 `ShowStepInfo()` 输出详细日志（当前已移除 MessageBox 弹窗，仅保留 `Debug.Log`）
- **待办**：删除 `InitSDK()` 中所有 `ShowStepInfo(...)` 调用及 `ShowStepInfo` 方法本身，初始化流程的日志由现有 `Debug.Log` 覆盖即可
- **相关**：`ShowError` 保留，出错时仍需 MessageBox 提醒

### README 需要更新的内容
- [ ] 删除"PC高性能模式宏开关"菜单相关的文档描述（菜单已删除，宏由构建流程自动管理）
  - 涉及：`## 宏开关机制` 中的菜单方式、`## 调试工具 → Editor 菜单` 表格、`## 两条接入路径` 表格中的宏定义列
- [ ] 路径B 的接入文档中明确说明"需要先将 Active Platform 切到 WeixinMiniGame"及原因

### WXBase.cs 条件编译
- **现状**：`GetPCHighPerformanceManager()` 在未定义 `WX_PCHP_ENABLED` 时返回 `object` 类型，已修复编译错误
- [ ] 考虑后续拆包时（方案 B），是否改用 Assembly Definition + 弱引用替代宏方案，提升类型安全性

## 🟢 低优先级

### 架构优化（v1.0+ 考虑）
- [ ] 将 `WXPCHPInitScript` 放入独立 asmdef（`WX-WASM-SDK-V2.Runtime.PCHP.asmdef`），通过平台过滤天然隔离编译，替代宏方案
- [ ] `WXBase.cs` 中通过反射获取 Manager，不直接引用类型（配合 asmdef 拆分）
- [ ] 代价评估：反射调用丢失类型安全、包结构复杂度增加、IDE 跳转体验变差

---

*最后更新：2026-04-13*
