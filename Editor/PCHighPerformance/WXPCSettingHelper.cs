using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
using UnityEditor.Build.Reporting;
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

        public WXPCSettingHelper()
        {
            projectRootPath = Path.GetFullPath(Application.dataPath + "/../");
        }

        // UI 状态
        private Vector2 scrollRoot;
        private bool foldBaseInfo = true;

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

            // 基本信息区域
            foldBaseInfo = EditorGUILayout.Foldout(foldBaseInfo, "基本信息");
            if (foldBaseInfo)
            {
                EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));

                // 游戏AppID - 必填项
                FormInput("appId", "游戏AppID *", "必填项，微信小游戏的AppID");

                // 小游戏项目名 - 非必填项
                FormInput("projectName", "项目名(?)", "非必填项，用于设置导出的运行启动器名称，留空则使用Unity项目名");

                // 导出路径 - 支持相对路径和选择目录
                FormInputWithFolderSelectorAndHelp("exportPath", "导出路径", "支持输入相对于项目根目录的相对路径，如 wxbuild");

                EditorGUILayout.EndVertical();
            }

            EditorGUILayout.EndScrollView();

            // 检测 GUI 变化并自动保存
            if (GUI.changed)
            {
                SaveData();
            }
        }

        public void OnBuildButtonGUI(EditorWindow window)
        {
            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();

            // 生成并转换按钮
            if (GUILayout.Button("生成并转换", GUILayout.Width(120), GUILayout.Height(30)))
            {
                OnBuildButtonClicked(window);
            }

            EditorGUILayout.EndHorizontal();

            GUILayout.Space(10);
        }

        /// <summary>
        /// 点击生成并转换按钮
        /// </summary>
        private void OnBuildButtonClicked(EditorWindow window)
        {
            // 验证必填项
            var appId = GetDataInput("appId");
            if (string.IsNullOrEmpty(appId.Trim()))
            {
                EditorUtility.DisplayDialog("错误", "请填写游戏AppID", "确定");
                return;
            }

            SaveData();

            // 获取当前运行平台
            var currentPlatform = GetCurrentPlatform();
            Debug.Log($"[PC高性能小游戏] 当前运行平台: {currentPlatform}");

            // 根据平台设置构建目标
            SetBuildTargetForPlatform(currentPlatform);
            
            // 配置 Player Settings
            ConfigurePlayerSettings();

            // 实现PC高性能小游戏的转换逻辑
            Debug.Log($"[PC高性能小游戏] 开始转换，AppID: {appId}");
            
            // 根据平台执行构建
            BuildForPlatform(currentPlatform);
        }

        /// <summary>
        /// 获取当前运行平台
        /// </summary>
        private RuntimePlatform GetCurrentPlatform()
        {
            return Application.platform;
        }

        /// <summary>
        /// 判断当前是否为 Windows 平台
        /// </summary>
        private bool IsWindowsPlatform()
        {
            return Application.platform == RuntimePlatform.WindowsEditor || 
                   Application.platform == RuntimePlatform.WindowsPlayer;
        }

        /// <summary>
        /// 判断当前是否为 Mac 平台
        /// </summary>
        private bool IsMacPlatform()
        {
            return Application.platform == RuntimePlatform.OSXEditor || 
                   Application.platform == RuntimePlatform.OSXPlayer;
        }

        /// <summary>
        /// 根据平台设置构建目标
        /// </summary>
        private void SetBuildTargetForPlatform(RuntimePlatform platform)
        {
            if (IsMacPlatform())
            {
                SetBuildTargetToMac();
            }
            else
            {
                // 默认使用 Windows
                SetBuildTargetToWindows();
            }
        }

        /// <summary>
        /// 根据平台执行构建
        /// </summary>
        private void BuildForPlatform(RuntimePlatform platform)
        {
            if (IsMacPlatform())
            {
                BuildForMac();
            }
            else
            {
                // 默认使用 Windows
                BuildForWindows();
            }
        }

        /// <summary>
        /// 设置构建目标为 Windows
        /// </summary>
        private void SetBuildTargetToWindows()
        {
            try
            {
                var currentTarget = EditorUserBuildSettings.activeBuildTarget;
                var targetGroup = BuildTargetGroup.Standalone;
                var buildTarget = BuildTarget.StandaloneWindows64;

                if (currentTarget != buildTarget)
                {
                    Debug.Log("[PC高性能小游戏] 切换构建目标到 Windows x64");
                    EditorUserBuildSettings.SwitchActiveBuildTarget(targetGroup, buildTarget);
                }
                else
                {
                    Debug.Log("[PC高性能小游戏] 构建目标已经是 Windows x64");
                }
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[PC高性能小游戏] 设置构建目标失败: {e.Message}");
            }
        }

        /// <summary>
        /// 设置构建目标为 Mac
        /// </summary>
        private void SetBuildTargetToMac()
        {
            try
            {
                var currentTarget = EditorUserBuildSettings.activeBuildTarget;
                var targetGroup = BuildTargetGroup.Standalone;
                var buildTarget = BuildTarget.StandaloneOSX;

                if (currentTarget != buildTarget)
                {
                    Debug.Log("[PC高性能小游戏] 切换构建目标到 macOS");
                    EditorUserBuildSettings.SwitchActiveBuildTarget(targetGroup, buildTarget);
                }
                else
                {
                    Debug.Log("[PC高性能小游戏] 构建目标已经是 macOS");
                }
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[PC高性能小游戏] 设置构建目标失败: {e.Message}");
            }
        }

        /// <summary>
        /// 配置 Player Settings
        /// </summary>
        private void ConfigurePlayerSettings()
        {
            try
            {
                Debug.Log("[PC高性能小游戏] 配置 Player Settings");
                
                // 设置 Fullscreen Mode 为 Windowed
                PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
                
                // 可选：设置默认窗口分辨率
                PlayerSettings.defaultScreenWidth = 1280;
                PlayerSettings.defaultScreenHeight = 720;
                
                // 可选：允许用户调整窗口大小
                PlayerSettings.resizableWindow = true;
                
                // 保存设置
                AssetDatabase.SaveAssets();
                
                Debug.Log("[PC高性能小游戏] Player Settings 配置完成");
                Debug.Log($"[PC高性能小游戏] Fullscreen Mode: {PlayerSettings.fullScreenMode}");
                Debug.Log($"[PC高性能小游戏] 默认分辨率: {PlayerSettings.defaultScreenWidth}x{PlayerSettings.defaultScreenHeight}");
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[PC高性能小游戏] 配置 Player Settings 失败: {e.Message}");
            }
        }

        /// <summary>
        /// 执行 Windows 构建
        /// </summary>
        private void BuildForWindows()
        {
            try
            {
                var appId = GetDataInput("appId");
                var buildPath = GetBuildPath("PC", appId);
                
                // 确保构建目录存在
                if (!Directory.Exists(buildPath))
                {
                    Directory.CreateDirectory(buildPath);
                }
                
                var executablePath = Path.Combine(buildPath, $"{GetProductName()}.exe");
                
                // 获取当前场景列表
                var scenes = new List<string>();
                foreach (var scene in EditorBuildSettings.scenes)
                {
                    if (scene.enabled)
                    {
                        scenes.Add(scene.path);
                    }
                }
                
                if (scenes.Count == 0)
                {
                    Debug.LogWarning("[PC高性能小游戏] 没有启用的场景，请在 Build Settings 中添加场景");
                    EditorUtility.DisplayDialog("警告", "没有启用的场景，请在 Build Settings 中添加场景", "确定");
                    return;
                }
                
                // 构建选项
                var buildOptions = BuildOptions.None;
                
                Debug.Log($"[PC高性能小游戏] 开始构建到: {executablePath}");
                Debug.Log($"[PC高性能小游戏] 使用项目名称: {GetProductName()}");
                
                // 执行构建
                var report = BuildPipeline.BuildPlayer(scenes.ToArray(), executablePath, BuildTarget.StandaloneWindows64, buildOptions);
                
                // 检查构建结果
                if (report.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded)
                {
                    Debug.Log($"[PC高性能小游戏] 构建成功! 输出路径: {buildPath}");
                    EditorUtility.DisplayDialog("构建成功", $"PC高性能小游戏构建完成!\n\n输出路径:\n{buildPath}", "确定");
                    
                    // 可选：打开构建目录
                    if (EditorUtility.DisplayDialog("打开目录", "是否打开构建输出目录？", "是", "否"))
                    {
                        EditorUtility.RevealInFinder(buildPath);
                    }
                }
                else
                {
                    Debug.LogError($"[PC高性能小游戏] 构建失败: {report.summary.result}");
                    EditorUtility.DisplayDialog("构建失败", $"构建过程中出现错误:\n{report.summary.result}", "确定");
                }
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[PC高性能小游戏] 构建异常: {e.Message}");
                EditorUtility.DisplayDialog("构建异常", $"构建过程中发生异常:\n{e.Message}", "确定");
            }
        }

        /// <summary>
        /// 执行 Mac 构建
        /// </summary>
        private void BuildForMac()
        {
            try
            {
                var appId = GetDataInput("appId");
                var buildPath = GetBuildPath("Mac", appId);
                
                // 确保构建目录存在
                if (!Directory.Exists(buildPath))
                {
                    Directory.CreateDirectory(buildPath);
                }
                
                // Mac 应用程序是 .app 包
                var executablePath = Path.Combine(buildPath, $"{GetProductName()}.app");
                
                // 获取当前场景列表
                var scenes = new List<string>();
                foreach (var scene in EditorBuildSettings.scenes)
                {
                    if (scene.enabled)
                    {
                        scenes.Add(scene.path);
                    }
                }
                
                if (scenes.Count == 0)
                {
                    Debug.LogWarning("[PC高性能小游戏] 没有启用的场景，请在 Build Settings 中添加场景");
                    EditorUtility.DisplayDialog("警告", "没有启用的场景，请在 Build Settings 中添加场景", "确定");
                    return;
                }
                
                // 构建选项
                var buildOptions = BuildOptions.None;
                
                Debug.Log($"[PC高性能小游戏] 开始构建 macOS 应用到: {executablePath}");
                Debug.Log($"[PC高性能小游戏] 使用项目名称: {GetProductName()}");
                
                // 执行构建
                var report = BuildPipeline.BuildPlayer(scenes.ToArray(), executablePath, BuildTarget.StandaloneOSX, buildOptions);
                
                // 检查构建结果
                if (report.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded)
                {
                    Debug.Log($"[PC高性能小游戏] macOS 构建成功! 输出路径: {buildPath}");
                    EditorUtility.DisplayDialog("构建成功", $"PC高性能小游戏 macOS 构建完成!\n\n输出路径:\n{buildPath}", "确定");
                    
                    // 可选：打开构建目录
                    if (EditorUtility.DisplayDialog("打开目录", "是否打开构建输出目录？", "是", "否"))
                    {
                        EditorUtility.RevealInFinder(buildPath);
                    }
                }
                else
                {
                    Debug.LogError($"[PC高性能小游戏] macOS 构建失败: {report.summary.result}");
                    EditorUtility.DisplayDialog("构建失败", $"构建过程中出现错误:\n{report.summary.result}", "确定");
                }
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[PC高性能小游戏] macOS 构建异常: {e.Message}");
                EditorUtility.DisplayDialog("构建异常", $"构建过程中发生异常:\n{e.Message}", "确定");
            }
        }

        /// <summary>
        /// 获取构建输出路径
        /// </summary>
        private string GetBuildPath(string platformName, string appId)
        {
            var exportPath = GetDataInput("exportPath");
            
            // 如果用户指定了导出路径
            if (!string.IsNullOrEmpty(exportPath))
            {
                // 判断是否为绝对路径
                if (Path.IsPathRooted(exportPath))
                {
                    return Path.Combine(exportPath, platformName, appId);
                }
                else
                {
                    // 相对路径，相对于项目根目录
                    return Path.Combine(projectRootPath, exportPath, platformName, appId);
                }
            }
            
            // 默认路径：{projectRoot}/Build/{Platform}/{AppID}
            return Path.Combine(projectRootPath, "Build", platformName, appId);
        }

        /// <summary>
        /// 获取产品名称（优先使用用户配置的名称，否则使用Unity项目名）
        /// </summary>
        private string GetProductName()
        {
            var projectName = GetDataInput("projectName");
            if (!string.IsNullOrEmpty(projectName))
            {
                return projectName.Trim();
            }
            return PlayerSettings.productName;
        }

        /// <summary>
        /// 加载配置数据
        /// </summary>
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
                        SetData("appId", config.appId ?? "");
                        SetData("projectName", config.projectName ?? "");
                        SetData("exportPath", config.exportPath ?? "");
                    }
                }
                catch (System.Exception e)
                {
                    Debug.LogWarning($"[PC高性能小游戏] 加载配置失败: {e.Message}");
                }
            }
            else
            {
                // 初始化默认值
                SetData("appId", "");
                SetData("projectName", "");
                SetData("exportPath", "");
            }
        }

        /// <summary>
        /// 保存配置数据
        /// </summary>
        private void SaveData()
        {
            try
            {
                var config = new PCHPConfigData
                {
                    appId = GetDataInput("appId"),
                    projectName = GetDataInput("projectName"),
                    exportPath = GetDataInput("exportPath")
                };

                var directory = Path.GetDirectoryName(ConfigFilePath);
                if (!Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                var json = JsonUtility.ToJson(config, true);
                File.WriteAllText(ConfigFilePath, json);
            }
            catch (System.Exception e)
            {
                Debug.LogWarning($"[PC高性能小游戏] 保存配置失败: {e.Message}");
            }
        }

        /// <summary>
        /// 获取输入框数据
        /// </summary>
        private string GetDataInput(string target)
        {
            if (formInputData.ContainsKey(target))
            {
                return formInputData[target];
            }
            return "";
        }

        /// <summary>
        /// 设置数据
        /// </summary>
        private void SetData(string target, string value)
        {
            if (formInputData.ContainsKey(target))
            {
                formInputData[target] = value;
            }
            else
            {
                formInputData.Add(target, value);
            }
        }

        /// <summary>
        /// 绘制输入框
        /// </summary>
        private void FormInput(string target, string label, string help = null)
        {
            if (!formInputData.ContainsKey(target))
            {
                formInputData[target] = "";
            }

            GUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(string.Empty, GUILayout.Width(10));

            if (help == null)
            {
                GUILayout.Label(label, GUILayout.Width(140));
            }
            else
            {
                GUILayout.Label(new GUIContent(label, help), GUILayout.Width(140));
            }

            formInputData[target] = GUILayout.TextField(formInputData[target], GUILayout.MaxWidth(EditorGUIUtility.currentViewWidth - 195));
            GUILayout.EndHorizontal();
        }

        /// <summary>
        /// 绘制带文件夹选择器的输入框
        /// </summary>
        private void FormInputWithFolderSelector(string target, string label, string help = null)
        {
            if (!formInputData.ContainsKey(target))
            {
                formInputData[target] = "";
            }

            GUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(string.Empty, GUILayout.Width(10));

            if (help == null)
            {
                GUILayout.Label(label, GUILayout.Width(140));
            }
            else
            {
                GUILayout.Label(new GUIContent(label, help), GUILayout.Width(140));
            }

            // 输入框
            formInputData[target] = GUILayout.TextField(formInputData[target], GUILayout.MaxWidth(EditorGUIUtility.currentViewWidth - 275));
            
            // 选择按钮
            if (GUILayout.Button("选择", GUILayout.Width(60)))
            {
                var selectedPath = EditorUtility.OpenFolderPanel("选择导出目录", projectRootPath, "");
                if (!string.IsNullOrEmpty(selectedPath))
                {
                    // 尝试转换为相对路径
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
                        // 使用绝对路径
                        formInputData[target] = selectedPath;
                    }
                }
            }
            
            GUILayout.EndHorizontal();
        }

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

            // 标题（带问号和 Tooltip）
            var displayLabel = help == null ? label : $"{label}(?)";
            GUILayout.Label(new GUIContent(displayLabel, help), GUILayout.Width(140));

            // 输入框
            formInputData[target] = GUILayout.TextField(formInputData[target], GUILayout.MaxWidth(EditorGUIUtility.currentViewWidth - 275));
            
            // 选择按钮
            if (GUILayout.Button("选择", GUILayout.Width(60)))
            {
                var selectedPath = EditorUtility.OpenFolderPanel("选择导出目录", projectRootPath, "");
                if (!string.IsNullOrEmpty(selectedPath))
                {
                    // 尝试转换为相对路径
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
                        // 使用绝对路径
                        formInputData[target] = selectedPath;
                    }
                }
            }
            
            GUILayout.EndHorizontal();
        }

    }

    /// <summary>
    /// PC高性能小游戏配置数据类
    /// </summary>
    [System.Serializable]
    public class PCHPConfigData
    {
        public string appId;
        public string projectName;
        public string exportPath;
    }
}
