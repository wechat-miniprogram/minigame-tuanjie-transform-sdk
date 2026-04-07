using UnityEngine;
using UnityEditor;
using System.IO;
using System;

namespace WeChatWASM
{
    /// <summary>
    /// 多包融合工具面板
    /// UI层实现，业务逻辑调用 WXMultiPackageMergeCore
    /// 纯C#实现，无需Node.js
    /// </summary>
    public class WXMultiPackageMergeWindow : EditorWindow
    {
        // 开发调试插件ID，由 preview:robot 自动更新
        private const string DevPluginId = "fa0437c7ef2edbeccceea93cec2b68d6";
        private static WXEditorScriptObject config;
        private Vector2 scrollPosition;
        private bool foldStPackage = true;
        private bool foldMtPackage = true;
        private bool foldMergeOptions = true;
        private bool foldAdvancedOptions = true;

        [MenuItem("微信小游戏 / 多包融合工具", false, 2)]
        public static void Open()
        {
            var win = GetWindow(typeof(WXMultiPackageMergeWindow), false, "多包融合工具");
            win.minSize = new Vector2(500, 600);
            win.position = new Rect(100, 100, 700, 800);
            win.Show();
        }

        private void OnEnable()
        {
            LoadConfig();
        }

        private void OnFocus()
        {
            LoadConfig();
        }

        private void LoadConfig()
        {
            if (config == null)
            {
                config = UnityUtil.GetEditorConf();
            }
            if (config.MultiPackageMerge == null)
            {
                config.MultiPackageMerge = new MultiPackageMergeConfig();
            }
        }

        private void SaveConfig()
        {
            if (config != null)
            {
                EditorUtility.SetDirty(config);
            }
        }

        public void OnGUI()
        {
            LoadConfig();

            scrollPosition = EditorGUILayout.BeginScrollView(scrollPosition);

            GUILayout.Space(10);
            EditorGUILayout.LabelField("多包融合工具", new GUIStyle(EditorStyles.largeLabel) { fontSize = 18, fontStyle = FontStyle.Bold });
            EditorGUILayout.LabelField("将单线程包(ST)和多线程包(MT)融合为一个支持多线程的小游戏", EditorStyles.wordWrappedLabel);
            GUILayout.Space(10);

            // ST包配置
            foldStPackage = EditorGUILayout.Foldout(foldStPackage, "ST包配置 (单线程包)", true, EditorStyles.foldoutHeader);
            if (foldStPackage)
            {
                EditorGUILayout.BeginVertical("box");

                EditorGUILayout.LabelField("ST包路径", EditorStyles.boldLabel);
                EditorGUILayout.BeginHorizontal();
                config.MultiPackageMerge.stPackagePath = EditorGUILayout.TextField(config.MultiPackageMerge.stPackagePath);
                if (GUILayout.Button("选择", GUILayout.Width(60)))
                {
                    string path = EditorUtility.OpenFolderPanel("选择ST包目录", config.MultiPackageMerge.stPackagePath, "");
                    if (!string.IsNullOrEmpty(path))
                    {
                        config.MultiPackageMerge.stPackagePath = path;
                        SaveConfig();
                    }
                }
                if (GUILayout.Button("打开", GUILayout.Width(60)) && !string.IsNullOrEmpty(config.MultiPackageMerge.stPackagePath) && Directory.Exists(config.MultiPackageMerge.stPackagePath))
                {
                    EditorUtility.RevealInFinder(config.MultiPackageMerge.stPackagePath);
                }
                EditorGUILayout.EndHorizontal();

                GUILayout.Space(5);
                EditorGUILayout.LabelField("ST构建模式", EditorStyles.boldLabel);
                string[] stModes = new string[] { "standard (标准模式)", "split (代码分包模式)" };
                int stModeIndex = config.MultiPackageMerge.stMode == "split" ? 1 : 0;
                stModeIndex = EditorGUILayout.Popup(stModeIndex, stModes);
                config.MultiPackageMerge.stMode = stModeIndex == 1 ? "split" : "standard";

                EditorGUILayout.EndVertical();
            }

            GUILayout.Space(10);

            // MT包配置
            foldMtPackage = EditorGUILayout.Foldout(foldMtPackage, "MT包配置 (多线程包)", true, EditorStyles.foldoutHeader);
            if (foldMtPackage)
            {
                EditorGUILayout.BeginVertical("box");

                EditorGUILayout.LabelField("MT包路径", EditorStyles.boldLabel);
                EditorGUILayout.BeginHorizontal();
                config.MultiPackageMerge.mtPackagePath = EditorGUILayout.TextField(config.MultiPackageMerge.mtPackagePath);
                if (GUILayout.Button("选择", GUILayout.Width(60)))
                {
                    string path = EditorUtility.OpenFolderPanel("选择MT包目录", config.MultiPackageMerge.mtPackagePath, "");
                    if (!string.IsNullOrEmpty(path))
                    {
                        config.MultiPackageMerge.mtPackagePath = path;
                        SaveConfig();
                    }
                }
                if (GUILayout.Button("打开", GUILayout.Width(60)) && !string.IsNullOrEmpty(config.MultiPackageMerge.mtPackagePath) && Directory.Exists(config.MultiPackageMerge.mtPackagePath))
                {
                    EditorUtility.RevealInFinder(config.MultiPackageMerge.mtPackagePath);
                }
                EditorGUILayout.EndHorizontal();

                EditorGUILayout.EndVertical();
            }

            GUILayout.Space(10);

            // 融合选项
            foldMergeOptions = EditorGUILayout.Foldout(foldMergeOptions, "融合选项", true, EditorStyles.foldoutHeader);
            if (foldMergeOptions)
            {
                EditorGUILayout.BeginVertical("box");

                EditorGUILayout.LabelField("融合模式", EditorStyles.boldLabel);
                string[] mergeModes = new string[] { "standard (标准融合)", "seperateJsCode (JS分离模式)" };
                int mergeModeIndex = config.MultiPackageMerge.mergeMode == "seperateJsCode" ? 1 : 0;
                mergeModeIndex = EditorGUILayout.Popup(mergeModeIndex, mergeModes);
                config.MultiPackageMerge.mergeMode = mergeModeIndex == 1 ? "seperateJsCode" : "standard";

                // 分离文件列表和存放方式已注释，使用默认的 topDir 模式
                // if (config.MultiPackageMerge.mergeMode == "seperateJsCode")
                // {
                //     GUILayout.Space(5);
                //     EditorGUILayout.LabelField("分离文件列表 (逗号分隔)", EditorStyles.boldLabel);
                //     config.MultiPackageMerge.seperateFileList = EditorGUILayout.TextField(config.MultiPackageMerge.seperateFileList);
                //
                //     GUILayout.Space(5);
                //     EditorGUILayout.LabelField("分离文件存放方式", EditorStyles.boldLabel);
                //     string[] seperateModes = new string[] { "subDir (子目录)", "topDir (顶层目录)" };
                //     int seperateModeIndex = config.MultiPackageMerge.seperateMode == "topDir" ? 1 : 0;
                //     seperateModeIndex = EditorGUILayout.Popup(seperateModeIndex, seperateModes);
                //     config.MultiPackageMerge.seperateMode = seperateModeIndex == 1 ? "topDir" : "subDir";
                // }
                // 强制使用 topDir 模式
                config.MultiPackageMerge.seperateMode = "topDir";

                GUILayout.Space(5);
                EditorGUILayout.LabelField("输出目录", EditorStyles.boldLabel);
                EditorGUILayout.BeginHorizontal();
                config.MultiPackageMerge.outputPath = EditorGUILayout.TextField(config.MultiPackageMerge.outputPath);
                if (GUILayout.Button("选择", GUILayout.Width(60)))
                {
                    string path = EditorUtility.OpenFolderPanel("选择输出目录", config.MultiPackageMerge.outputPath, "");
                    if (!string.IsNullOrEmpty(path))
                    {
                        config.MultiPackageMerge.outputPath = path;
                        SaveConfig();
                    }
                }
                if (GUILayout.Button("打开", GUILayout.Width(60)) && !string.IsNullOrEmpty(config.MultiPackageMerge.outputPath) && Directory.Exists(config.MultiPackageMerge.outputPath))
                {
                    EditorUtility.RevealInFinder(config.MultiPackageMerge.outputPath);
                }
                EditorGUILayout.EndHorizontal();

                EditorGUILayout.EndVertical();
            }

            // 高级选项仅在非 release 模式下显示
#if !RELEASE
            GUILayout.Space(10);

            // 高级选项
            foldAdvancedOptions = EditorGUILayout.Foldout(foldAdvancedOptions, "高级选项", true, EditorStyles.foldoutHeader);
            if (foldAdvancedOptions)
            {
                EditorGUILayout.BeginVertical("box");

                EditorGUILayout.LabelField("开发插件 ID (devPluginId)", EditorStyles.boldLabel);
                EditorGUILayout.LabelField("用于开发调试的插件 ID，发布时请使用正式插件 ID", EditorStyles.miniLabel);
                config.MultiPackageMerge.devPluginId = EditorGUILayout.TextField(config.MultiPackageMerge.devPluginId);

                EditorGUILayout.EndVertical();
            }
#endif

            GUILayout.Space(20);

            // 操作按钮
            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();

            GUI.backgroundColor = new Color(0.2f, 0.8f, 0.2f);
            if (GUILayout.Button("开始融合", GUILayout.Width(150), GUILayout.Height(40)))
            {
                StartMerge();
            }
            GUI.backgroundColor = Color.white;

            GUILayout.FlexibleSpace();
            EditorGUILayout.EndHorizontal();

            GUILayout.Space(20);

            // 说明文档
            EditorGUILayout.LabelField("使用说明:", EditorStyles.boldLabel);
            EditorGUILayout.LabelField(
                "1. 准备ST包(单线程包)和MT包(多线程包)\n" +
                "2. 分别选择两个包的路径\n" +
                "3. 配置融合选项\n" +
                "4. 点击\"开始融合\"按钮\n" +
                "5. 融合完成后在输出目录查看结果",
                EditorStyles.wordWrappedLabel);

            EditorGUILayout.EndScrollView();

            // 实时保存
            if (GUI.changed)
            {
                SaveConfig();
            }
        }

        private void StartMerge()
        {
            // 验证配置
            if (!WXMultiPackageMergeCore.ValidateConfig(config.MultiPackageMerge, out string errorMessage))
            {
                EditorUtility.DisplayDialog("错误", errorMessage, "确定");
                return;
            }

            SaveConfig();

            // 调用融合逻辑
            WXMultiPackageMergeCore.ExecuteMerge(
                config.MultiPackageMerge,
                onOutput: (log) => UnityEngine.Debug.Log(log),
                onError: (error) => UnityEngine.Debug.LogError(error),
                onSuccess: () =>
                {
                    EditorUtility.DisplayDialog("成功", $"多包融合完成！\n输出目录: {config.MultiPackageMerge.outputPath}", "确定");
                    EditorUtility.RevealInFinder(config.MultiPackageMerge.outputPath);
                },
                onFailed: (error) =>
                {
                    EditorUtility.DisplayDialog("错误", $"融合失败:\n{error}", "确定");
                }
            );
        }
    }
}
