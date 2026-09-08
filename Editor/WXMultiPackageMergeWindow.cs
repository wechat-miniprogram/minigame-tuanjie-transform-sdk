using UnityEngine;
using UnityEditor;
using System.IO;
using System;
using System.Collections.Generic;
using System.Linq;

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
        private const string DevPluginId = "e0de6573e8409e74024ac9130c3f62ab";
        private static MultiPackageMergeConfig mergeConfig;
        private Vector2 scrollPosition;
        private bool foldConditions = true;

        // 临时存储条件列表的折叠状态
        private Dictionary<int, bool> conditionFoldouts = new Dictionary<int, bool>();

        // EditorPrefs key
        private const string PrefsKey = "WXMultiPackageMergeConfig";

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
            if (mergeConfig == null)
            {
                mergeConfig = LoadFromEditorPrefs();
            }
        }

        private MultiPackageMergeConfig LoadFromEditorPrefs()
        {
            var config = new MultiPackageMergeConfig();
            string json = EditorPrefs.GetString(PrefsKey, "");
            if (!string.IsNullOrEmpty(json))
            {
                try
                {
                    JsonUtility.FromJsonOverwrite(json, config);
                }
                catch
                {
                    // 使用默认值
                }
            }
            // 确保条件列表有默认值
            if (config.packageConditions == null || config.packageConditions.Count == 0)
            {
                config.packageConditions = new List<PackageCondition>
                {
                    new PackageCondition { condition = "wx.env.isSupportStandardWorker", packageSuffix = "mt" }
                };
            }
            // devPluginId 不通过 UI 管理，始终清空（由 CLI 参数传入）
            config.devPluginId = "";
            return config;
        }

        private void SaveConfig()
        {
            if (mergeConfig != null)
            {
                string json = JsonUtility.ToJson(mergeConfig);
                EditorPrefs.SetString(PrefsKey, json);
            }
        }

        public void OnGUI()
        {
            LoadConfig();

            scrollPosition = EditorGUILayout.BeginScrollView(scrollPosition);

            GUILayout.Space(10);
            EditorGUILayout.LabelField("多包融合工具", new GUIStyle(EditorStyles.largeLabel) { fontSize = 18, fontStyle = FontStyle.Bold }, GUILayout.Height(24));
            EditorGUILayout.LabelField("将文件收拢到 minigame-xx 目录，支持动态条件选择包", EditorStyles.wordWrappedLabel);
            GUILayout.Space(10);

            // 默认包路径（else分支）
            EditorGUILayout.LabelField("默认包路径", EditorStyles.boldLabel);
            EditorGUILayout.LabelField("覆盖设备最多的包（else分支，无后缀）", EditorStyles.miniLabel);
            EditorGUILayout.BeginHorizontal();
            mergeConfig.defaultPackagePath = EditorGUILayout.TextField(mergeConfig.defaultPackagePath);
            if (GUILayout.Button("选择", GUILayout.Width(60)))
            {
                string path = EditorUtility.OpenFolderPanel("选择默认包目录", mergeConfig.defaultPackagePath, "");
                if (!string.IsNullOrEmpty(path))
                {
                    mergeConfig.defaultPackagePath = path;
                    SaveConfig();
                }
            }
            if (GUILayout.Button("打开", GUILayout.Width(60)) && !string.IsNullOrEmpty(mergeConfig.defaultPackagePath) && Directory.Exists(mergeConfig.defaultPackagePath))
            {
                EditorUtility.RevealInFinder(mergeConfig.defaultPackagePath);
            }
            EditorGUILayout.EndHorizontal();

            GUILayout.Space(10);

            // 条件配置
            foldConditions = EditorGUILayout.Foldout(foldConditions, "条件配置 (动态选择包)", true, EditorStyles.foldoutHeader);
            if (foldConditions)
            {
                DrawConditionsConfig();
            }

            GUILayout.Space(10);

            // 额外公共目录
            EditorGUILayout.LabelField("额外公共目录 (可选)", EditorStyles.boldLabel);
            EditorGUILayout.LabelField("逗号分隔，已内置：images/, unity-sdk/", EditorStyles.miniLabel);
            mergeConfig.commonDirectories = EditorGUILayout.TextField(mergeConfig.commonDirectories);

            GUILayout.Space(5);

            // 额外公共文件
            EditorGUILayout.LabelField("额外公共文件 (可选)", EditorStyles.boldLabel);
            EditorGUILayout.LabelField("逗号分隔，已内置：check-version.js, events.js, project.json, weapp-adapter.js, plugin-config.js", EditorStyles.miniLabel);
            mergeConfig.commonFiles = EditorGUILayout.TextField(mergeConfig.commonFiles);

            GUILayout.Space(10);

            // 输出目录
            EditorGUILayout.LabelField("输出目录", EditorStyles.boldLabel);
            EditorGUILayout.BeginHorizontal();
            mergeConfig.outputPath = EditorGUILayout.TextField(mergeConfig.outputPath);
            if (GUILayout.Button("选择", GUILayout.Width(60)))
            {
                string path = EditorUtility.OpenFolderPanel("选择输出目录", mergeConfig.outputPath, "");
                if (!string.IsNullOrEmpty(path))
                {
                    mergeConfig.outputPath = path;
                    SaveConfig();
                }
            }
            if (GUILayout.Button("打开", GUILayout.Width(60)) && !string.IsNullOrEmpty(mergeConfig.outputPath) && Directory.Exists(mergeConfig.outputPath))
            {
                EditorUtility.RevealInFinder(mergeConfig.outputPath);
            }
            EditorGUILayout.EndHorizontal();

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
                "1. 选择默认包路径（else分支，对应 minigame/ 目录）\n" +
                "2. 配置条件包（如MT包），条件满足时选择对应 minigame-{后缀}/ 目录\n" +
                "3. 选择输出目录\n" +
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

        /// <summary>
        /// 绘制条件配置区域
        /// </summary>
        private void DrawConditionsConfig()
        {
            EditorGUILayout.BeginVertical("box");

            if (mergeConfig.packageConditions == null)
            {
                mergeConfig.packageConditions = new List<PackageCondition>();
            }

            for (int i = 0; i < mergeConfig.packageConditions.Count; i++)
            {
                var condition = mergeConfig.packageConditions[i];

                if (!conditionFoldouts.ContainsKey(i))
                {
                    conditionFoldouts[i] = true;
                }

                EditorGUILayout.BeginHorizontal();
                conditionFoldouts[i] = EditorGUILayout.Foldout(conditionFoldouts[i], $"条件 {i + 1}", true, EditorStyles.foldoutHeader);

                // 删除按钮
                if (GUILayout.Button("删除", GUILayout.Width(60)))
                {
                    mergeConfig.packageConditions.RemoveAt(i);
                    SaveConfig();
                    EditorGUILayout.EndHorizontal();
                    break;
                }
                EditorGUILayout.EndHorizontal();

                if (conditionFoldouts[i])
                {
                    EditorGUILayout.BeginVertical("box");

                    EditorGUILayout.LabelField("条件表达式", EditorStyles.boldLabel);
                    EditorGUILayout.LabelField("JavaScript表达式，返回true时选择对应包，例：wx.env.isSupportStandardWorker", EditorStyles.miniLabel);
                    {
                        var placeholder = "wx.env.isSupportStandardWorker";
                        var display = string.IsNullOrEmpty(condition.condition) ? placeholder : condition.condition;
                        var style = string.IsNullOrEmpty(condition.condition) ? new GUIStyle(EditorStyles.textField) { normal = { textColor = Color.gray } } : EditorStyles.textField;
                        var input = EditorGUILayout.TextField(display, style);
                        condition.condition = (input == placeholder && string.IsNullOrEmpty(condition.condition)) ? "" : input;
                    }

                    GUILayout.Space(5);

                    EditorGUILayout.LabelField("包后缀", EditorStyles.boldLabel);
                    EditorGUILayout.LabelField("对应包目录：minigame-{后缀}/", EditorStyles.miniLabel);
                    condition.packageSuffix = EditorGUILayout.TextField(condition.packageSuffix);

                    GUILayout.Space(5);

                    EditorGUILayout.LabelField("条件包目录", EditorStyles.boldLabel);
                    EditorGUILayout.BeginHorizontal();
                    condition.packagePath = EditorGUILayout.TextField(condition.packagePath);
                    if (GUILayout.Button("选择", GUILayout.Width(60)))
                    {
                        string path = EditorUtility.OpenFolderPanel("选择条件包目录", condition.packagePath, "");
                        if (!string.IsNullOrEmpty(path))
                        {
                            condition.packagePath = path;
                            SaveConfig();
                        }
                    }
                    if (GUILayout.Button("打开", GUILayout.Width(60)) && !string.IsNullOrEmpty(condition.packagePath) && Directory.Exists(condition.packagePath))
                    {
                        EditorUtility.RevealInFinder(condition.packagePath);
                    }
                    EditorGUILayout.EndHorizontal();

                    EditorGUILayout.EndVertical();
                }

                GUILayout.Space(5);
            }

            // 添加条件按钮
            GUILayout.Space(5);
            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();
            if (GUILayout.Button("+ 添加条件", GUILayout.Width(120)))
            {
                mergeConfig.packageConditions.Add(new PackageCondition
                {
                    condition = "",
                    packageSuffix = "",
                    packagePath = ""
                });
                SaveConfig();
            }
            GUILayout.FlexibleSpace();
            EditorGUILayout.EndHorizontal();

            GUILayout.Space(5);
            EditorGUILayout.LabelField("说明：默认包（else分支）固定为 minigame/，无需配置", EditorStyles.miniLabel);

            EditorGUILayout.EndVertical();
        }

        private void StartMerge()
        {
            // 验证配置
            if (!WXMultiPackageMergeCore.ValidateConfig(mergeConfig, out string errorMessage))
            {
                EditorUtility.DisplayDialog("错误", errorMessage, "确定");
                return;
            }

            SaveConfig();

            // 调用融合逻辑
            WXMultiPackageMergeCore.ExecuteMerge(
                mergeConfig,
                onOutput: (log) => UnityEngine.Debug.Log(log),
                onError: (error) => UnityEngine.Debug.LogError(error),
                onSuccess: () =>
                {
                    EditorUtility.DisplayDialog("成功", $"多包融合完成！\n输出目录: {mergeConfig.outputPath}", "确定");
                    EditorUtility.RevealInFinder(mergeConfig.outputPath);
                },
                onFailed: (error) =>
                {
                    EditorUtility.DisplayDialog("错误", $"融合失败:\n{error}", "确定");
                }
            );
        }
    }
}
