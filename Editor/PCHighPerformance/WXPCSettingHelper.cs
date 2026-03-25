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
                "1. 向首场景注入 WXPCHPInitScript 脚本\n" +
                "2. 构建 Standalone 可执行文件\n" +
                "3. SDK 初始化时会弹窗展示各步骤进度",
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

            try
            {
                // Step 1: 注入 WXPCHPInitScript 到首场景
                EditorUtility.DisplayProgressBar("PC高性能模式", "正在向首场景注入 SDK 脚本...", 0.1f);
                InjectSDKToFirstScene();

                // Step 2: 切换构建目标
                EditorUtility.DisplayProgressBar("PC高性能模式", "正在切换构建目标...", 0.2f);
                var originalTarget = EditorUserBuildSettings.activeBuildTarget;
                if (originalTarget != buildTarget)
                {
                    Debug.Log($"[PC高性能模式] 切换构建目标: {originalTarget} -> {buildTarget}");
                    EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Standalone, buildTarget);
                }

                // Step 3: 配置 Player Settings
                EditorUtility.DisplayProgressBar("PC高性能模式", "正在配置 Player Settings...", 0.3f);
                ConfigurePlayerSettings();

                // Step 4: 准备输出目录
                if (!Directory.Exists(fullExportPath))
                {
                    Directory.CreateDirectory(fullExportPath);
                }

                string productName = PlayerSettings.productName;
                if (string.IsNullOrEmpty(productName)) productName = "Game";

                string executablePath = buildTarget == BuildTarget.StandaloneOSX
                    ? Path.Combine(fullExportPath, $"{productName}.app")
                    : Path.Combine(fullExportPath, $"{productName}.exe");

                // Step 5: 获取场景列表
                var scenes = GetEnabledScenes();
                if (scenes.Length == 0)
                {
                    EditorUtility.ClearProgressBar();
                    EditorUtility.DisplayDialog("构建失败", "没有启用的场景，请在 Build Settings 中添加场景", "确定");
                    return;
                }

                // Step 6: 执行构建
                EditorUtility.DisplayProgressBar("PC高性能模式", "正在构建 Standalone...", 0.5f);
                Debug.Log($"[PC高性能模式] 开始构建，输出: {executablePath}");

                var report = BuildPipeline.BuildPlayer(scenes, executablePath, buildTarget, BuildOptions.None);

                EditorUtility.ClearProgressBar();

                if (report.summary.result == BuildResult.Succeeded)
                {
                    Debug.Log($"[PC高性能模式] 构建成功! 耗时: {report.summary.totalTime.TotalSeconds:F2}秒");
                    
                    if (EditorUtility.DisplayDialog("构建成功",
                        $"PC高性能模式构建完成!\n\n平台: {platformName}\n耗时: {report.summary.totalTime.TotalSeconds:F2}秒\n输出: {fullExportPath}",
                        "打开目录", "关闭"))
                    {
                        EditorUtility.RevealInFinder(fullExportPath);
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

        #region Scene Injection

        /// <summary>
        /// 向首场景注入 WXPCHPInitScript
        /// </summary>
        private void InjectSDKToFirstScene()
        {
            // 查找脚本类型
            var sdkType = FindTypeInAllAssemblies(SDK_CLASS_NAME);
            if (sdkType == null)
            {
                throw new System.Exception($"找不到 {SDK_CLASS_NAME} 类型，请确保 WX-WASM-SDK-V2 已正确安装");
            }

            var assemblyName = sdkType.Assembly.GetName().Name;
            Debug.Log($"[PC高性能模式] 找到 WXPCHPInitScript，程序集: {assemblyName}");

            if (assemblyName.Contains("Editor"))
            {
                throw new System.Exception("WXPCHPInitScript 在 Editor 程序集中，无法用于 Runtime 构建！请确保脚本放在 Runtime 目录下");
            }

            // 获取首场景
            var firstScenePath = GetFirstEnabledScenePath();
            if (string.IsNullOrEmpty(firstScenePath))
            {
                throw new System.Exception("没有启用的场景，请在 Build Settings 中添加场景");
            }

            // 打开首场景
            var currentScenes = EditorSceneManager.GetSceneManagerSetup();
            var scene = EditorSceneManager.OpenScene(firstScenePath, OpenSceneMode.Single);

            // 清理旧对象
            var oldSDK = GameObject.Find("EmbeddedAppletSDK");
            if (oldSDK != null)
            {
                Debug.Log("[PC高性能模式] 删除旧的 EmbeddedAppletSDK 对象");
                GameObject.DestroyImmediate(oldSDK);
            }

            // 删除已存在的同名对象（避免重复）
            var existingSDK = GameObject.Find(SDK_GAMEOBJECT_NAME);
            if (existingSDK != null)
            {
                Debug.Log($"[PC高性能模式] 删除已存在的 {SDK_GAMEOBJECT_NAME}，重新创建");
                GameObject.DestroyImmediate(existingSDK);
            }

            // 创建新的 GameObject 并添加 WXPCHPInitScript
            var sdkObject = new GameObject(SDK_GAMEOBJECT_NAME);
            sdkObject.AddComponent(sdkType);
            Debug.Log($"[PC高性能模式] ✅ 已在场景 [{scene.name}] 创建 {SDK_GAMEOBJECT_NAME} 并挂载 WXPCHPInitScript");

            // 保存场景
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);

            // 恢复场景状态
            if (currentScenes != null && currentScenes.Length > 0)
            {
                EditorSceneManager.RestoreSceneManagerSetup(currentScenes);
            }
        }

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
        private void ConfigurePlayerSettings()
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
        private string[] GetEnabledScenes()
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
