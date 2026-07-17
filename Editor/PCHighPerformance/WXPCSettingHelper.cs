using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using System.IO;

namespace WeChatWASM
{

    [InitializeOnLoad]
    public class WXPCSettingsHelperInterface
    {
        public static WXPCSettingHelper helper = new WXPCSettingHelper();
    }

    public class WXPCSettingHelper
    {
        public static string projectRootPath;

        // SDK 脚本常量
        private const string SDK_CLASS_NAME = "WeChatWASM.WXPCHPInitScript";
        private const string SDK_GAMEOBJECT_NAME = "WXPCHPInitScript";

        public WXPCSettingHelper()
        {
            projectRootPath = Path.GetFullPath(Application.dataPath + "/../");
        }

        // UI 状态
        private Vector2 scrollRoot;

        // 表单数据
        private Dictionary<string, string> formInputData = new Dictionary<string, string>();

        // 配置文件路径
        private string ConfigFilePath => Path.Combine(Application.dataPath, "WX-WASM-SDK-V2", "Editor", "PCHighPerformance", "PCHPConfig.json");

        public void OnFocus()
        {
            LoadData();
        }

        public void OnLostFocus()
        {
            SaveData();
        }

        public void OnDisable()
        {
            SaveData();
        }

        public void OnSettingsGUI(EditorWindow window)
        {
            scrollRoot = EditorGUILayout.BeginScrollView(scrollRoot);

            EditorGUILayout.Space(10);

            // 标题
            var titleStyle = new GUIStyle(EditorStyles.boldLabel)
            {
                fontSize = 14,
                alignment = TextAnchor.MiddleCenter
            };
            EditorGUILayout.LabelField("PC高性能模式转换", titleStyle);

            EditorGUILayout.Space(10);

            EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));

            // 导出路径 - 支持相对路径和选择目录
            FormInputWithFolderSelectorAndHelp("exportPath", "导出路径", "Standalone 构建产物的输出目录，支持相对路径（相对项目根目录）或绝对路径");

            EditorGUILayout.EndVertical();

            EditorGUILayout.Space(5);

            // 提示信息
            EditorGUILayout.HelpBox(
                "点击「生成并转换」将执行以下操作：\n" +
                "1. 自动添加 WX_PCHP_ENABLED 宏到 Standalone 平台\n" +
                "2. 构建 Standalone 可执行文件\n" +
                "3. 运行时通过 RuntimeInitializeOnLoadMethod 自动初始化 SDK\n\n" +
                "提示：开发者也可以手动在场景中挂载 WXPCHPInitScript 来精确控制初始化时机",
                MessageType.Info);

            EditorGUILayout.EndScrollView();

            // 检测 GUI 变化并自动保存
            if (GUI.changed)
            {
                SaveData();
            }
        }

        public void OnBuildButtonGUI(EditorWindow window)
        {
            EditorGUILayout.Space(5);
            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();

            // 生成并转换按钮
            var buttonStyle = new GUIStyle(GUI.skin.button)
            {
                fontSize = 13,
                fontStyle = FontStyle.Bold
            };
            if (GUILayout.Button("生成并转换", buttonStyle, GUILayout.Width(160), GUILayout.Height(36)))
            {
                OnBuildButtonClicked(window);
            }

            GUILayout.FlexibleSpace();
            EditorGUILayout.EndHorizontal();

            GUILayout.Space(10);
        }

        // SessionState keys 用于路径B的两阶段构建
        private const string SESSION_KEY_PATHB_EXPORT = "PCHP_PathB_ExportPath";
        private const string SESSION_KEY_PATHB_TARGET = "PCHP_PathB_Target";

        /// <summary>
        /// Domain Reload 后恢复路径B构建
        /// </summary>
        [InitializeOnLoadMethod]
        private static void OnDomainReloadPathB()
        {
            string pendingExportPath = SessionState.GetString(SESSION_KEY_PATHB_EXPORT, "");
            int pendingTarget = SessionState.GetInt(SESSION_KEY_PATHB_TARGET, 0);

            if (!string.IsNullOrEmpty(pendingExportPath) && pendingTarget != 0)
            {
                SessionState.EraseString(SESSION_KEY_PATHB_EXPORT);
                SessionState.EraseInt(SESSION_KEY_PATHB_TARGET);

                var buildTarget = (BuildTarget)pendingTarget;
                Debug.Log($"[PC高性能模式] [路径B] Domain Reload 完成，恢复构建: path={pendingExportPath}");

                EditorApplication.delayCall += () =>
                {
                    // 验证类型已编译
                    System.Type pchpType = null;
                    foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
                    {
                        pchpType = asm.GetType("WeChatWASM.WXPCHighPerformanceManager");
                        if (pchpType != null) break;
                    }

                    if (pchpType == null)
                    {
                        Debug.LogError("[PC高性能模式] [路径B] Domain Reload 后 WXPCHighPerformanceManager 仍不存在！");
                        EditorUtility.DisplayDialog("构建失败",
                            "WX_PCHP_ENABLED 宏生效后重编译未产生 PCHP 类型。\n\n请确认 Standalone 平台的 Scripting Define Symbols 包含 WX_PCHP_ENABLED，等编译完成后重试。", "确定");
                        return;
                    }

                    Debug.Log("[PC高性能模式] [路径B] ✅ 类型已就绪，继续构建...");
                    ExecutePathBBuild(pendingExportPath, buildTarget);
                };
            }
        }

        /// <summary>
        /// 点击生成并转换按钮
        /// </summary>
        private void OnBuildButtonClicked(EditorWindow window)
        {
            SaveData();

            var exportPath = GetDataInput("exportPath");
            if (string.IsNullOrEmpty(exportPath.Trim()))
            {
                EditorUtility.DisplayDialog("错误", "请先设置导出路径", "确定");
                return;
            }

            // 计算完整输出路径
            string fullExportPath;
            if (Path.IsPathRooted(exportPath))
            {
                fullExportPath = exportPath;
            }
            else
            {
                fullExportPath = Path.Combine(projectRootPath, exportPath);
            }

            Debug.Log($"[PC高性能模式] 导出路径: {fullExportPath}");

            // 确定构建平台
            BuildTarget buildTarget;
            string platformName;
            if (Application.platform == RuntimePlatform.OSXEditor)
            {
                buildTarget = BuildTarget.StandaloneOSX;
                platformName = "macOS";
            }
            else
            {
                buildTarget = BuildTarget.StandaloneWindows64;
                platformName = "Windows x64";
            }

            Debug.Log($"[PC高性能模式] 目标平台: {platformName}");

            // Step 1: 确保 WX_PCHP_ENABLED 宏已定义
            bool macroReady = EnsurePCHPDefineSymbol();

            // 检查类型是否已编译
            System.Type pchpType = null;
            foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
            {
                pchpType = asm.GetType("WeChatWASM.WXPCHighPerformanceManager");
                if (pchpType != null) break;
            }

            if (!macroReady || pchpType == null)
            {
                // 两阶段模式：保存参数，触发 Reload
                SessionState.SetString(SESSION_KEY_PATHB_EXPORT, fullExportPath);
                SessionState.SetInt(SESSION_KEY_PATHB_TARGET, (int)buildTarget);

                Debug.Log("[PC高性能模式] [路径B] ⏳ 需要等待脚本重编译，构建将在 Domain Reload 后自动继续...");

                if (EditorUserBuildSettings.activeBuildTarget != buildTarget)
                {
                    EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Standalone, buildTarget);
                }
                else
                {
                    UnityEditor.Compilation.CompilationPipeline.RequestScriptCompilation();
                }

                EditorUtility.DisplayDialog("等待编译",
                    "WX_PCHP_ENABLED 宏已写入，正在触发脚本重编译。\n\n编译完成后将自动开始构建，请稍候...", "确定");
                return;
            }

            // 宏和类型都就绪，直接构建
            ExecutePathBBuild(fullExportPath, buildTarget);
        }

        /// <summary>
        /// 路径B 实际执行构建（宏已生效、类型已编译）
        /// </summary>
        private static void ExecutePathBBuild(string fullExportPath, BuildTarget buildTarget)
        {
            string platformName = buildTarget == BuildTarget.StandaloneOSX ? "macOS" : "Windows x64";

            try
            {
                // 切换构建目标
                EditorUtility.DisplayProgressBar("PC高性能模式", "正在准备构建...", 0.2f);
                if (EditorUserBuildSettings.activeBuildTarget != buildTarget)
                {
                    EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Standalone, buildTarget);
                }

                // 配置 Player Settings
                ConfigurePlayerSettings();

                // 准备输出目录
                if (!Directory.Exists(fullExportPath))
                {
                    Directory.CreateDirectory(fullExportPath);
                }

                const string execName = "pchp";
                string executablePath = buildTarget == BuildTarget.StandaloneOSX
                    ? Path.Combine(fullExportPath, $"{execName}.app")
                    : Path.Combine(fullExportPath, $"{execName}.exe");

                // 获取场景列表
                var scenes = GetEnabledScenes();
                if (scenes.Length == 0)
                {
                    EditorUtility.ClearProgressBar();
                    EditorUtility.DisplayDialog("构建失败", "没有启用的场景，请在 Build Settings 中添加场景", "确定");
                    return;
                }

                // 执行构建
                EditorUtility.DisplayProgressBar("PC高性能模式", "正在构建 Standalone...", 0.5f);
                Debug.Log($"[PC高性能模式] 开始构建，输出: {executablePath}");

                // [诊断]
#if UNITY_2023_1_OR_NEWER
                var diagDefines = PlayerSettings.GetScriptingDefineSymbols(UnityEditor.Build.NamedBuildTarget.Standalone);
#else
                var diagDefines = PlayerSettings.GetScriptingDefineSymbolsForGroup(BuildTargetGroup.Standalone);
#endif
                Debug.Log($"[PC高性能模式] [诊断] Standalone Defines: {diagDefines}");
                Debug.Log($"[PC高性能模式] [诊断] Contains WX_PCHP_ENABLED: {diagDefines.Contains("WX_PCHP_ENABLED")}");

                var report = BuildPipeline.BuildPlayer(scenes, executablePath, buildTarget, BuildOptions.None);

                EditorUtility.ClearProgressBar();

                if (report.summary.result == BuildResult.Succeeded)
                {
                    Debug.Log($"[PC高性能模式] ✅ 构建成功! 耗时: {report.summary.totalTime.TotalSeconds:F2}秒");

                    // 复制 pchp_sdk.dll
                    WXPCHPBuildHelper.CopyPCHPNativeDllPublic(fullExportPath, buildTarget);

                    // 打包 wxapkg
                    EditorUtility.DisplayProgressBar("PC高性能模式", "正在打包 wxapkg...", 0.8f);
                    string wxapkgOutputDir = fullExportPath;
                    string tempWxapkgPath = Path.Combine(Path.GetDirectoryName(fullExportPath), $"{WXPCHPBuildHelper.PCHPOutputDir}_temp.wxapkg");
                    string finalWxapkgPath = Path.Combine(wxapkgOutputDir, $"{WXPCHPBuildHelper.PCHPOutputDir}.wxapkg");

                    if (WXApkgPacker.Pack(fullExportPath, tempWxapkgPath))
                    {
                        Directory.Delete(fullExportPath, true);
                        Directory.CreateDirectory(wxapkgOutputDir);
                        File.Move(tempWxapkgPath, finalWxapkgPath);

                        string gameJsPath = Path.Combine(wxapkgOutputDir, "game.js");
                        File.WriteAllText(gameJsPath, "");
                        Debug.Log($"[PC高性能模式] wxapkg 打包完成: {finalWxapkgPath}");
                        EditorUtility.ClearProgressBar();

                        if (EditorUtility.DisplayDialog("构建成功",
                            $"PC高性能模式构建完成!\n\n平台: {platformName}\n耗时: {report.summary.totalTime.TotalSeconds:F2}秒\n输出: {wxapkgOutputDir}\n\n产物:\n• {WXPCHPBuildHelper.PCHPOutputDir}.wxapkg\n• game.js",
                            "打开目录", "关闭"))
                        {
                            EditorUtility.RevealInFinder(wxapkgOutputDir);
                        }
                    }
                    else
                    {
                        Debug.LogWarning("[PC高性能模式] wxapkg 打包失败，保留原始构建产物");
                        if (File.Exists(tempWxapkgPath)) File.Delete(tempWxapkgPath);
                        EditorUtility.ClearProgressBar();

                        if (EditorUtility.DisplayDialog("构建成功（未打包）",
                            $"PC高性能模式构建完成，但 wxapkg 打包失败。\n\n原始构建产物保留在: {fullExportPath}",
                            "打开目录", "关闭"))
                        {
                            EditorUtility.RevealInFinder(fullExportPath);
                        }
                    }
                }
                else
                {
                    Debug.LogError($"[PC高性能模式] 构建失败: {report.summary.result}");
                    EditorUtility.DisplayDialog("构建失败", $"构建失败: {report.summary.result}\n\n请查看 Console 获取详细错误信息", "确定");
                }
            }
            catch (System.Exception e)
            {
                EditorUtility.ClearProgressBar();
                Debug.LogError($"[PC高性能模式] 构建异常: {e.Message}\n{e.StackTrace}");
                EditorUtility.DisplayDialog("构建异常", $"构建过程中发生异常:\n{e.Message}", "确定");
            }
        }

        /// <summary>
        /// 确保 WX_PCHP_ENABLED 宏已定义。
        /// 如果宏是新增的，使用两阶段构建：先写入宏并触发 Domain Reload，
        /// Reload 后通过 SessionState 恢复构建流程。
        /// </summary>
        /// <returns>true 表示宏已就绪可继续；false 表示需要等待 Domain Reload</returns>
        private bool EnsurePCHPDefineSymbol()
        {
            var targetGroup = BuildTargetGroup.Standalone;
#if UNITY_2023_1_OR_NEWER
            var namedTarget = UnityEditor.Build.NamedBuildTarget.Standalone;
            var defines = PlayerSettings.GetScriptingDefineSymbols(namedTarget);
#else
            var defines = PlayerSettings.GetScriptingDefineSymbolsForGroup(targetGroup);
#endif

            if (!defines.Contains("WX_PCHP_ENABLED"))
            {
                var newDefines = string.IsNullOrEmpty(defines)
                    ? "WX_PCHP_ENABLED"
                    : defines + ";WX_PCHP_ENABLED";

#if UNITY_2023_1_OR_NEWER
                PlayerSettings.SetScriptingDefineSymbols(namedTarget, newDefines);
#else
                PlayerSettings.SetScriptingDefineSymbolsForGroup(targetGroup, newDefines);
#endif
                Debug.Log("[PC高性能模式] 已自动添加 WX_PCHP_ENABLED 宏，需要等待 Domain Reload...");
                return false;
            }
            return true;
        }

        /// <summary>
        /// 检查首场景是否已有 SDK 组件，没有时可选注入
        /// 有 RuntimeInitializeOnLoadMethod 兜底，场景注入不再是必须
        /// </summary>
        private void CheckAndOptionallyInjectSDK()
        {
            var sdkType = FindTypeInAllAssemblies(SDK_CLASS_NAME);
            if (sdkType == null)
            {
                Debug.LogWarning($"[PC高性能模式] 未找到 {SDK_CLASS_NAME}，可能需要等待宏生效后重新编译");
                return;
            }

            // 检查首场景
            var firstScenePath = GetFirstEnabledScenePath();
            if (string.IsNullOrEmpty(firstScenePath)) return;

            var currentScenes = EditorSceneManager.GetSceneManagerSetup();
            try
            {
                var scene = EditorSceneManager.OpenScene(firstScenePath, OpenSceneMode.Single);
                var existing = GameObject.Find(SDK_GAMEOBJECT_NAME);

                if (existing != null && existing.GetComponent(sdkType) != null)
                {
                    Debug.Log("[PC高性能模式] 首场景已有 WXPCHPInitScript，跳过注入");
                    return;
                }

                // 清理旧对象
                var oldSDK = GameObject.Find("EmbeddedAppletSDK");
                if (oldSDK != null)
                {
                    GameObject.DestroyImmediate(oldSDK);
                }

                // 场景中没有，但 RuntimeInitializeOnLoadMethod 会自动创建
                Debug.Log("[PC高性能模式] 首场景无 SDK 组件，将依赖 RuntimeInitializeOnLoadMethod 自动初始化");

                EditorSceneManager.SaveScene(scene);
            }
            finally
            {
                if (currentScenes != null && currentScenes.Length > 0)
                {
                    EditorSceneManager.RestoreSceneManagerSetup(currentScenes);
                }
            }
        }

        #region Scene Helpers

        /// <summary>
        /// 在所有程序集中查找类型
        /// </summary>
        private System.Type FindTypeInAllAssemblies(string typeName)
        {
            foreach (var assembly in System.AppDomain.CurrentDomain.GetAssemblies())
            {
                var type = assembly.GetType(typeName);
                if (type != null) return type;
            }
            return null;
        }

        /// <summary>
        /// 获取首个启用的场景路径
        /// </summary>
        private string GetFirstEnabledScenePath()
        {
            foreach (var scene in EditorBuildSettings.scenes)
            {
                if (scene.enabled) return scene.path;
            }
            return null;
        }

        #endregion

        #region Build Configuration

        /// <summary>
        /// 配置 Player Settings
        /// </summary>
        private static void ConfigurePlayerSettings()
        {
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
            PlayerSettings.defaultScreenWidth = 1280;
            PlayerSettings.defaultScreenHeight = 720;
            PlayerSettings.resizableWindow = true;

            // Windows Linear 色彩空间需要 DX11+
            if (Application.platform == RuntimePlatform.WindowsEditor &&
                PlayerSettings.colorSpace == ColorSpace.Linear)
            {
                PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.StandaloneWindows64, false);
                PlayerSettings.SetGraphicsAPIs(BuildTarget.StandaloneWindows64, new[]
                {
                    UnityEngine.Rendering.GraphicsDeviceType.Direct3D11,
                    UnityEngine.Rendering.GraphicsDeviceType.Direct3D12,
                    UnityEngine.Rendering.GraphicsDeviceType.Vulkan
                });
            }

            Debug.Log("[PC高性能模式] Player Settings 配置完成");
        }

        /// <summary>
        /// 获取启用的场景列表
        /// </summary>
        private static string[] GetEnabledScenes()
        {
            var scenes = new List<string>();
            foreach (var scene in EditorBuildSettings.scenes)
            {
                if (scene.enabled) scenes.Add(scene.path);
            }
            return scenes.ToArray();
        }

        #endregion

        #region Data Persistence

        private void LoadData()
        {
            if (File.Exists(ConfigFilePath))
            {
                try
                {
                    var json = File.ReadAllText(ConfigFilePath);
                    var config = JsonUtility.FromJson<PCHPConfigData>(json);
                    if (config != null)
                    {
                        SetData("exportPath", config.exportPath ?? "");
                    }
                }
                catch (System.Exception e)
                {
                    Debug.LogWarning($"[PC高性能模式] 加载配置失败: {e.Message}");
                }
            }
            else
            {
                SetData("exportPath", "");
            }
        }

        private void SaveData()
        {
            try
            {
                var config = new PCHPConfigData
                {
                    exportPath = GetDataInput("exportPath")
                };

                var directory = Path.GetDirectoryName(ConfigFilePath);
                if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                var json = JsonUtility.ToJson(config, true);
                File.WriteAllText(ConfigFilePath, json);
            }
            catch (System.Exception e)
            {
                Debug.LogWarning($"[PC高性能模式] 保存配置失败: {e.Message}");
            }
        }

        private string GetDataInput(string target)
        {
            return formInputData.ContainsKey(target) ? formInputData[target] : "";
        }

        private void SetData(string target, string value)
        {
            formInputData[target] = value;
        }

        #endregion

        #region GUI Helpers

        /// <summary>
        /// 绘制带文件夹选择器和帮助提示的输入框
        /// </summary>
        private void FormInputWithFolderSelectorAndHelp(string target, string label, string help = null)
        {
            if (!formInputData.ContainsKey(target))
            {
                formInputData[target] = "";
            }

            GUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(string.Empty, GUILayout.Width(10));

            var displayLabel = help == null ? label : $"{label}(?)";
            GUILayout.Label(new GUIContent(displayLabel, help), GUILayout.Width(140));

            formInputData[target] = GUILayout.TextField(formInputData[target], GUILayout.MaxWidth(EditorGUIUtility.currentViewWidth - 275));

            if (GUILayout.Button("选择", GUILayout.Width(60)))
            {
                var selectedPath = EditorUtility.OpenFolderPanel("选择导出目录", projectRootPath, "");
                if (!string.IsNullOrEmpty(selectedPath))
                {
                    if (selectedPath.StartsWith(projectRootPath))
                    {
                        var relativePath = selectedPath.Substring(projectRootPath.Length);
                        if (relativePath.StartsWith("/") || relativePath.StartsWith("\\"))
                        {
                            relativePath = relativePath.Substring(1);
                        }
                        formInputData[target] = relativePath;
                    }
                    else
                    {
                        formInputData[target] = selectedPath;
                    }
                }
            }

            GUILayout.EndHorizontal();
        }

        #endregion
    }

    /// <summary>
    /// PC高性能小游戏配置数据
    /// </summary>
    [System.Serializable]
    public class PCHPConfigData
    {
        public string exportPath;
    }
}
