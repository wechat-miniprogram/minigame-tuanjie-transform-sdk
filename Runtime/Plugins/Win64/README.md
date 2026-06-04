# PC 高性能模式 Native DLL

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
