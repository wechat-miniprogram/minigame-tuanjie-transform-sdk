using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEditor;
using UnityEditor.Build.Reporting;

namespace WeChatWASM
{
    /// <summary>
    /// PC高性能小游戏构建辅助类
    /// 用于在微信小游戏转换工具面板中集成PC高性能模式构建
    /// </summary>
    public static class WXPCHPBuildHelper
    {
        /// <summary>
        /// PC高性能构建产物目录名
        /// </summary>
        public const string PCHPOutputDir = "pchpcode";

        /// <summary>
        /// 检查是否开启了PC高性能模式
        /// </summary>
        public static bool IsPCHighPerformanceEnabled()
        {
            var config = UnityUtil.GetEditorConf();
            bool enabled = config != null && config.ProjectConf.EnablePCHighPerformance;
            Debug.Log($"[PC高性能模式] 检查配置: config={config != null}, EnablePCHighPerformance={config?.ProjectConf?.EnablePCHighPerformance}, 结果={enabled}");
            return enabled;
        }

        /// <summary>
        /// 执行PC高性能构建
        /// </summary>
        /// <param name="exportBasePath">导出基础路径（来自小游戏面板配置）</param>
        /// <returns>构建是否成功</returns>
        public static bool BuildPCHighPerformance(string exportBasePath)
        {
            if (string.IsNullOrEmpty(exportBasePath))
            {
                Debug.LogError("[PC高性能模式] 导出路径为空，无法构建");
                return false;
            }

            // 确定构建目标平台
            var currentPlatform = Application.platform;
            BuildTarget buildTarget;
            string platformName;

            if (currentPlatform == RuntimePlatform.OSXEditor)
            {
                buildTarget = BuildTarget.StandaloneOSX;
                platformName = "Mac";
            }
            else
            {
                buildTarget = BuildTarget.StandaloneWindows64;
                platformName = "Windows";
            }

            // 构建输出路径：直接放在 minigame/pchpcode 目录下
            string pchpOutputPath = Path.Combine(exportBasePath, WXConvertCore.miniGameDir, PCHPOutputDir);

            Debug.Log($"[PC高性能模式] 开始构建，目标平台: {platformName}");
            Debug.Log($"[PC高性能模式] 输出路径: {pchpOutputPath}");

            // 保存当前构建目标
            var originalTarget = EditorUserBuildSettings.activeBuildTarget;
            var originalTargetGroup = EditorUserBuildSettings.selectedBuildTargetGroup;

            try
            {
                // 在切换平台之前确保宏已定义，这样 SwitchActiveBuildTarget 触发的
                // Domain Reload 重编译时，WX_PCHP_ENABLED 宏就已经在 ScriptingDefineSymbols 中了
                EnsurePCHPDefineSymbol(buildTarget);

                // 切换构建目标（如果需要）
                if (originalTarget != buildTarget)
                {
                    Debug.Log($"[PC高性能模式] 切换构建目标: {originalTarget} -> {buildTarget}");
                    if (!EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Standalone, buildTarget))
                    {
                        Debug.LogError("[PC高性能模式] 切换构建目标失败");
                        return false;
                    }
                }

                // 配置 Player Settings
                ConfigurePlayerSettings();

                // 确保输出目录存在
                if (!Directory.Exists(pchpOutputPath))
                {
                    Directory.CreateDirectory(pchpOutputPath);
                }

                // 获取可执行文件路径
                string executablePath = GetExecutablePath(pchpOutputPath, buildTarget);

                // 获取场景列表
                var scenes = GetEnabledScenes();
                if (scenes.Length == 0)
                {
                    Debug.LogError("[PC高性能模式] 没有启用的场景，请在 Build Settings 中添加场景");
                    EditorUtility.DisplayDialog("PC高性能模式构建失败", "没有启用的场景，请在 Build Settings 中添加场景", "确定");
                    return false;
                }

                // 构建选项
                var buildOptions = BuildOptions.None;

                // 执行构建
                Debug.Log($"[PC高性能模式] 执行构建，输出: {executablePath}");
                var report = BuildPipeline.BuildPlayer(scenes, executablePath, buildTarget, buildOptions);

                // 检查构建结果
                if (report.summary.result == BuildResult.Succeeded)
                {
                    Debug.Log($"[PC高性能模式] 构建成功! 耗时: {report.summary.totalTime.TotalSeconds:F2}秒");
                    Debug.Log($"[PC高性能模式] 输出路径: {pchpOutputPath}");

                    // 复制 pchp_sdk.dll 到构建产物中（确保运行时能找到）
                    CopyPCHPNativeDll(pchpOutputPath, buildTarget);

                    // 打包成 wxapkg 格式（先打包到临时位置）
                    string tempWxapkgPath = Path.Combine(exportBasePath, WXConvertCore.miniGameDir, $"{PCHPOutputDir}_temp.wxapkg");
                    string finalWxapkgPath = Path.Combine(pchpOutputPath, $"{PCHPOutputDir}.wxapkg");

                    Debug.Log($"[PC高性能模式] 开始打包 wxapkg...");

                    if (WXApkgPacker.Pack(pchpOutputPath, tempWxapkgPath))
                    {
                        // 删除原始构建材料
                        Debug.Log($"[PC高性能模式] 清理原始构建材料...");
                        Directory.Delete(pchpOutputPath, true);

                        // 重新创建目录并移动 wxapkg
                        Directory.CreateDirectory(pchpOutputPath);
                        File.Move(tempWxapkgPath, finalWxapkgPath);

                        // 创建空的 game.js 文件
                        string gameJsPath = Path.Combine(pchpOutputPath, "game.js");
                        File.WriteAllText(gameJsPath, "");
                        Debug.Log($"[PC高性能模式] 已创建 game.js: {gameJsPath}");

                        Debug.Log($"[PC高性能模式] wxapkg 打包完成: {finalWxapkgPath}");
                    }
                    else
                    {
                        Debug.LogWarning("[PC高性能模式] wxapkg 打包失败，保留原始构建产物");
                        if (File.Exists(tempWxapkgPath))
                        {
                            File.Delete(tempWxapkgPath);
                        }
                    }

                    return true;
                }
                else
                {
                    Debug.LogError($"[PC高性能模式] 构建失败: {report.summary.result}");
                    foreach (var step in report.steps)
                    {
                        foreach (var message in step.messages)
                        {
                            if (message.type == LogType.Error)
                            {
                                Debug.LogError($"[PC高性能模式] 构建错误: {message.content}");
                            }
                        }
                    }
                    return false;
                }
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[PC高性能模式] 构建异常: {e.Message}");
                Debug.LogException(e);
                return false;
            }
        }

        /// <summary>
        /// 恢复到小游戏平台（仅路径A——转换工具链——需要调用）
        /// 路径B（原生 Standalone 接入）不应调用此方法
        /// 团结引擎使用 WeixinMiniGame，Unity 使用 WebGL
        /// </summary>
        public static void RestoreToMiniGamePlatform()
        {
#if TUANJIE_2022_3_OR_NEWER
            // 团结引擎：切换到 WeixinMiniGame 平台
            if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.WeixinMiniGame)
            {
                Debug.Log($"[PC高性能模式] 切换回 WeixinMiniGame 构建目标");
                EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WeixinMiniGame, BuildTarget.WeixinMiniGame);
            }

            // 激活微信小游戏子平台
            ActivateWeixinSubplatform();
#else
            // Unity：切换到 WebGL 平台
            if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.WebGL)
            {
                Debug.Log($"[PC高性能模式] 切换回 WebGL 构建目标");
                EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WebGL, BuildTarget.WebGL);
            }
#endif
        }

#if TUANJIE_2022_3_OR_NEWER
        /// <summary>
        /// 激活微信小游戏子平台（通过反射兼容不同版本团结引擎）
        /// </summary>
        private static void ActivateWeixinSubplatform()
        {
            try
            {
                var miniGameType = typeof(PlayerSettings).GetNestedType("MiniGame");
                if (miniGameType == null)
                {
                    Debug.LogWarning("[PC高性能模式] 未找到 PlayerSettings.MiniGame 类型");
                    return;
                }

                var methods = miniGameType.GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                System.Reflection.MethodInfo setActiveMethod = null;

                foreach (var m in methods)
                {
                    if (m.Name == "SetActiveSubplatform")
                    {
                        setActiveMethod = m;
                        break;
                    }
                }

                if (setActiveMethod == null)
                {
                    Debug.LogWarning("[PC高性能模式] 未找到 SetActiveSubplatform 方法");
                    return;
                }

                var parameters = setActiveMethod.GetParameters();
                if (parameters.Length != 2)
                {
                    Debug.LogWarning($"[PC高性能模式] SetActiveSubplatform 参数数量异常: {parameters.Length}");
                    return;
                }

                var firstParamType = parameters[0].ParameterType;

                if (firstParamType.IsEnum)
                {
                    // 枚举版本：尝试多个可能的枚举值名称
                    string[] enumNames = { "WeChat", "Weixin", "WeiXin" };
                    foreach (var name in enumNames)
                    {
                        try
                        {
                            var enumValue = System.Enum.Parse(firstParamType, name);
                            setActiveMethod.Invoke(null, new object[] { enumValue, true });
                            Debug.Log($"[PC高性能模式] 已激活微信小游戏子平台 (enum: {name})");
                            return;
                        }
                        catch { }
                    }

                    // 如果上面都没命中，打印所有可用枚举值帮助排查
                    var allNames = System.Enum.GetNames(firstParamType);
                    Debug.LogWarning($"[PC高性能模式] 未找到匹配的枚举值，可用值: {string.Join(", ", allNames)}");
                }
                else if (firstParamType == typeof(string))
                {
                    // 字符串版本：按优先级尝试多个可能的标识符
                    // "weixin" 与命令行参数 -minigamesubplatform weixin 一致
                    string[] candidates = { "weixin", "WeChat", "Weixin", "wechat", "WeChat:微信小游戏" };
                    foreach (var candidate in candidates)
                    {
                        try
                        {
                            setActiveMethod.Invoke(null, new object[] { candidate, true });
                            Debug.Log($"[PC高性能模式] 已激活微信小游戏子平台 (name: {candidate})");
                            return;
                        }
                        catch (System.Reflection.TargetInvocationException ex)
                        {
                            // 内部抛出异常说明名称不对，继续尝试下一个
                            Debug.Log($"[PC高性能模式] 尝试子平台名称 \"{candidate}\" 失败: {ex.InnerException?.Message}");
                        }
                    }

                    Debug.LogWarning("[PC高性能模式] 所有候选子平台名称均失败");
                }
                else
                {
                    Debug.LogWarning($"[PC高性能模式] SetActiveSubplatform 参数类型未知: {firstParamType}");
                }
            }
            catch (System.Exception e)
            {
                Debug.LogWarning($"[PC高性能模式] 激活微信小游戏子平台失败: {e.Message}");
            }
        }
#endif

        /// <summary>
        /// 确保 Standalone 平台的 ScriptingDefineSymbols 包含 WX_PCHP_ENABLED
        /// 必须在 SwitchActiveBuildTarget 之前调用，这样切换平台触发的 Domain Reload
        /// 重编译脚本时宏就已经生效，首次构建即可正确编译 WXPCHPInitScript
        /// </summary>
        private static void EnsurePCHPDefineSymbol(BuildTarget buildTarget)
        {
            const string PCHP_DEFINE_SYMBOL = "WX_PCHP_ENABLED";

            // 仅对 Standalone 平台操作
            if (buildTarget != BuildTarget.StandaloneWindows64 &&
                buildTarget != BuildTarget.StandaloneWindows &&
                buildTarget != BuildTarget.StandaloneOSX)
            {
                return;
            }

            var targetGroup = BuildTargetGroup.Standalone;
#if UNITY_2023_1_OR_NEWER
            var namedTarget = UnityEditor.Build.NamedBuildTarget.Standalone;
            var defines = PlayerSettings.GetScriptingDefineSymbols(namedTarget);
#else
            var defines = PlayerSettings.GetScriptingDefineSymbolsForGroup(targetGroup);
#endif

            if (!defines.Contains(PCHP_DEFINE_SYMBOL))
            {
                var newDefines = string.IsNullOrEmpty(defines)
                    ? PCHP_DEFINE_SYMBOL
                    : defines + ";" + PCHP_DEFINE_SYMBOL;

#if UNITY_2023_1_OR_NEWER
                PlayerSettings.SetScriptingDefineSymbols(namedTarget, newDefines);
#else
                PlayerSettings.SetScriptingDefineSymbolsForGroup(targetGroup, newDefines);
#endif
                Debug.Log($"[PC高性能模式] 已自动添加 {PCHP_DEFINE_SYMBOL} 到 Standalone ScriptingDefineSymbols");

                // 防御性处理：如果后续不会触发 SwitchActiveBuildTarget（已经在 Standalone），
                // 需要强制同步重编译，否则 BuildPlayer 时宏未生效
                if (EditorUserBuildSettings.activeBuildTarget == buildTarget)
                {
                    Debug.Log($"[PC高性能模式] 当前已在目标平台，强制触发脚本重编译...");
                    UnityEditor.Compilation.CompilationPipeline.RequestScriptCompilation();
                    AssetDatabase.SaveAssets();
                    AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
                    Debug.Log($"[PC高性能模式] 脚本重编译完成");
                }
            }
            else
            {
                Debug.Log($"[PC高性能模式] {PCHP_DEFINE_SYMBOL} 宏已存在，跳过");
            }
        }

        /// <summary>
        /// 配置 Player Settings 用于 PC 高性能构建
        /// </summary>
        private static void ConfigurePlayerSettings()
        {
            // 设置窗口模式
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;

            // 设置默认分辨率
            PlayerSettings.defaultScreenWidth = 1280;
            PlayerSettings.defaultScreenHeight = 720;

            // 允许调整窗口大小
            PlayerSettings.resizableWindow = true;

            // 关闭 Splash Screen，防止启动时独立窗口暴露在桌面上
            // PC高性能模式下窗口由微信客户端接管，不需要 Unity 的启动画面
            PlayerSettings.SplashScreen.show = false;

            // 处理 Windows 上 Linear 色彩空间与图形 API 的兼容性问题
            if (Application.platform == RuntimePlatform.WindowsEditor)
            {
                ConfigureWindowsGraphicsAPI();
            }

            Debug.Log("[PC高性能模式] Player Settings 配置完成（Splash Screen 已关闭）");
        }

        /// <summary>
        /// 配置 Windows 图形 API，解决 Linear 色彩空间兼容性问题
        /// </summary>
        private static void ConfigureWindowsGraphicsAPI()
        {
            // 检查当前色彩空间
            bool isLinear = PlayerSettings.colorSpace == ColorSpace.Linear;

            if (isLinear)
            {
                // Linear 色彩空间需要 DX11 或更高版本
                // 禁用自动图形 API，手动指定兼容的 API
                PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.StandaloneWindows64, false);

                var graphicsAPIs = new UnityEngine.Rendering.GraphicsDeviceType[]
                {
                    UnityEngine.Rendering.GraphicsDeviceType.Direct3D11,
                    UnityEngine.Rendering.GraphicsDeviceType.Direct3D12,
                    UnityEngine.Rendering.GraphicsDeviceType.Vulkan
                };

                PlayerSettings.SetGraphicsAPIs(BuildTarget.StandaloneWindows64, graphicsAPIs);
                Debug.Log("[PC高性能模式] 已配置 Windows 图形 API: D3D11, D3D12, Vulkan（Linear 色彩空间兼容）");
            }
            else
            {
                // Gamma 色彩空间，使用默认图形 API 即可
                PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.StandaloneWindows64, true);
                Debug.Log("[PC高性能模式] 使用默认 Windows 图形 API（Gamma 色彩空间）");
            }
        }

        /// <summary>
        /// 获取可执行文件路径
        /// PC高性能模式统一使用固定名称 pchp，确保微信客户端能正确定位可执行文件
        /// </summary>
        private static string GetExecutablePath(string outputPath, BuildTarget target)
        {
            const string execName = "pchp";

            if (target == BuildTarget.StandaloneOSX)
            {
                return Path.Combine(outputPath, $"{execName}.app");
            }
            else
            {
                return Path.Combine(outputPath, $"{execName}.exe");
            }
        }

        /// <summary>
        /// 获取启用的场景列表
        /// </summary>
        private static string[] GetEnabledScenes()
        {
            var scenes = new List<string>();
            foreach (var scene in EditorBuildSettings.scenes)
            {
                if (scene.enabled)
                {
                    scenes.Add(scene.path);
                }
            }
            return scenes.ToArray();
        }

        /// <summary>
        /// 公开接口：复制 pchp_sdk.dll 到构建产物目录（供 WXPCSettingHelper 等外部调用）
        /// </summary>
        public static void CopyPCHPNativeDllPublic(string outputPath, BuildTarget buildTarget)
        {
            CopyPCHPNativeDll(outputPath, buildTarget);
        }

        /// <summary>
        /// 复制 pchp_sdk.dll 到构建产物目录
        /// 
        /// 放置策略：
        /// 1. 复制到 {outputPath}/ （exe 同级目录，Windows 标准 DLL 搜索的最高优先级）
        /// 2. 复制到 {outputPath}/pchp_Data/Plugins/x86_64/ （Mono 标准 native plugin 搜索路径）
        /// 
        /// DLL 源文件位置：Assets/WX-WASM-SDK-V2/Runtime/Plugins/Win64/pchp_sdk.dll
        /// </summary>
        private static void CopyPCHPNativeDll(string outputPath, BuildTarget buildTarget)
        {
            if (buildTarget != BuildTarget.StandaloneWindows64 && buildTarget != BuildTarget.StandaloneWindows)
            {
                Debug.Log("[PC高性能模式] 非 Windows 构建，跳过 pchp_sdk.dll 复制");
                return;
            }

            const string DLL_NAME = "pchp_sdk.dll";

            // 查找 DLL 源文件（在 SDK 的 Plugins 目录下）
            string dllSourcePath = FindPCHPDllSource();
            if (string.IsNullOrEmpty(dllSourcePath))
            {
                Debug.LogWarning($"[PC高性能模式] ⚠️ 未找到 {DLL_NAME} 源文件，跳过复制。" +
                    $"请将 {DLL_NAME} 放到以下任一位置：\n" +
                    "  - Assets/WX-WASM-SDK-V2/Runtime/Plugins/Win64/pchp_sdk.dll\n" +
                    "  - Assets/Plugins/x86_64/pchp_sdk.dll\n" +
                    "  - 项目根目录/pchp_sdk.dll");
                return;
            }

            Debug.Log($"[PC高性能模式] 找到 DLL 源文件: {dllSourcePath}");

            // 目标路径 1：exe 同级目录（最高优先级，DllImport 默认搜索这里）
            string destExeDir = Path.Combine(outputPath, DLL_NAME);
            CopyFileWithLog(dllSourcePath, destExeDir);

            // 目标路径 2：pchp_Data/Plugins/x86_64/（Mono 标准 native plugin 搜索路径）
            // 必须用标准目录名 x86_64，Mono runtime 的 DllImport 只认这个路径
            string dataDir = Path.Combine(outputPath, "pchp_Data", "Plugins", "x86_64");
            if (!Directory.Exists(dataDir))
            {
                Directory.CreateDirectory(dataDir);
            }
            string destPluginDir = Path.Combine(dataDir, DLL_NAME);
            CopyFileWithLog(dllSourcePath, destPluginDir);
        }

        /// <summary>
        /// 在多个候选位置查找 pchp_sdk.dll 源文件
        /// </summary>
        private static string FindPCHPDllSource()
        {
            const string DLL_NAME = "pchp_sdk.dll";

            var candidates = new List<string>();

            // === 1. 通过当前脚本路径定位 Package 内的 DLL ===
            // 当 SDK 以 Package 形式安装时，代码在 Library/PackageCache/com.qq.weixin.minigame@xxx/ 下
            // 通过 CallerFilePath 或 ScriptableObject 获取当前脚本路径，然后相对定位到 Runtime/Plugins/Win64/
            string packageRoot = FindPackageRoot();
            if (!string.IsNullOrEmpty(packageRoot))
            {
                candidates.Add(Path.Combine(packageRoot, "Runtime", "Plugins", "Win64", DLL_NAME));
            }

            // === 2. Assets 内的标准位置（SDK 以 Assets 形式存在时）===
            candidates.Add(Path.Combine(Application.dataPath, "WX-WASM-SDK-V2", "Runtime", "Plugins", "Win64", DLL_NAME));
            // 通用 Plugins 目录
            candidates.Add(Path.Combine(Application.dataPath, "Plugins", "x86_64", DLL_NAME));
            candidates.Add(Path.Combine(Application.dataPath, "Plugins", "Win64", DLL_NAME));
            candidates.Add(Path.Combine(Application.dataPath, "Plugins", DLL_NAME));
            // 项目根目录
            candidates.Add(Path.Combine(Path.GetDirectoryName(Application.dataPath), DLL_NAME));
            // StreamingAssets
            candidates.Add(Path.Combine(Application.streamingAssetsPath, DLL_NAME));

            // === 3. Library/PackageCache 暴力搜索（兜底）===
            string packageCacheDir = Path.Combine(Path.GetDirectoryName(Application.dataPath), "Library", "PackageCache");
            if (Directory.Exists(packageCacheDir))
            {
                // 搜索所有 com.qq.weixin.minigame* 开头的目录
                try
                {
                    foreach (var dir in Directory.GetDirectories(packageCacheDir, "com.qq.weixin.minigame*"))
                    {
                        candidates.Add(Path.Combine(dir, "Runtime", "Plugins", "Win64", DLL_NAME));
                    }
                }
                catch { }
            }

            // 逐个检查
            foreach (var path in candidates)
            {
                Debug.Log($"[PC高性能模式] FindPCHPDllSource 检查: {path}");
                if (File.Exists(path))
                {
                    Debug.Log($"[PC高性能模式] ✅ 找到 DLL: {path}");
                    return path;
                }
            }

            // 兜底：搜索整个 Assets 目录
            string[] found = Directory.GetFiles(Application.dataPath, DLL_NAME, SearchOption.AllDirectories);
            if (found.Length > 0)
            {
                return found[0];
            }

            return null;
        }

        /// <summary>
        /// 查找当前 SDK 的 Package 根目录
        /// 通过 UnityEditor.PackageManager 或脚本路径推导
        /// </summary>
        private static string FindPackageRoot()
        {
            // 方式 1：通过 Unity PackageManager API 查找已安装的包
            try
            {
                string packagePath = UnityEditor.PackageManager.PackageInfo.FindForAssembly(
                    System.Reflection.Assembly.GetExecutingAssembly())?.resolvedPath;
                if (!string.IsNullOrEmpty(packagePath))
                {
                    Debug.Log($"[PC高性能模式] Package 根目录 (via PackageInfo): {packagePath}");
                    return packagePath;
                }
            }
            catch { }

            // 方式 2：通过 Packages/com.qq.weixin.minigame 路径（本地包引用时）
            string localPackagePath = Path.GetFullPath("Packages/com.qq.weixin.minigame");
            if (Directory.Exists(localPackagePath))
            {
                Debug.Log($"[PC高性能模式] Package 根目录 (via local): {localPackagePath}");
                return localPackagePath;
            }

            return null;
        }

        /// <summary>
        /// 复制文件并输出日志
        /// </summary>
        private static void CopyFileWithLog(string source, string dest)
        {
            try
            {
                File.Copy(source, dest, true);
                Debug.Log($"[PC高性能模式] ✅ 已复制 DLL: {dest}");
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[PC高性能模式] ❌ 复制 DLL 失败 ({dest}): {e.Message}");
            }
        }
    }
}
