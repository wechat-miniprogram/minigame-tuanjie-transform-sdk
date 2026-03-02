using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using System.Linq;

namespace WeChatWASM
{
    /// <summary>
    /// PC高性能小游戏调试工具
    /// </summary>
    public class PCHPDebugHelper
    {
        [MenuItem("微信小游戏 / PC高性能调试 / 检查SDK注入状态", false, 100)]
        public static void CheckSDKInjectionStatus()
        {
            var report = new System.Text.StringBuilder();
            report.AppendLine("========== PC高性能小游戏 SDK 注入检查 ==========\n");

            // 1. 检查构建场景
            var enabledScenes = EditorBuildSettings.scenes.Where(s => s.enabled).ToArray();
            report.AppendLine($"[构建场景] 启用的场景数: {enabledScenes.Length}");
            
            if (enabledScenes.Length == 0)
            {
                report.AppendLine("  ⚠️ 警告: 没有启用的场景，SDK 无法注入");
            }
            else
            {
                report.AppendLine($"  ✅ 首场景: {enabledScenes[0].path}");
                
                // 打开首场景检查
                var scene = EditorSceneManager.OpenScene(enabledScenes[0].path, OpenSceneMode.Single);
                var sdkObject = GameObject.Find("EmbeddedAppletSDK");
                
                if (sdkObject == null)
                {
                    report.AppendLine("  ❌ 场景中未找到 EmbeddedAppletSDK GameObject");
                    report.AppendLine("  提示: 需要先执行一次构建才会注入");
                }
                else
                {
                    report.AppendLine($"  ✅ 找到 SDK GameObject: {sdkObject.name}");
                    
                    var component = sdkObject.GetComponent<MonoBehaviour>();
                    if (component == null)
                    {
                        report.AppendLine("  ⚠️ GameObject 上没有挂载脚本组件");
                    }
                    else
                    {
                        report.AppendLine($"  ✅ 挂载的脚本: {component.GetType().Name}");
                    }
                }
            }

            // 2. 检查脚本文件
            report.AppendLine("\n[脚本文件检查]");
            string scriptPath = System.IO.Path.Combine(Application.dataPath, "Scripts/EmbeddedAppletSDK.cs");
            
            if (System.IO.File.Exists(scriptPath))
            {
                report.AppendLine($"  ✅ 用户项目中存在 EmbeddedAppletSDK.cs");
                report.AppendLine($"  路径: {scriptPath}");
            }
            else
            {
                report.AppendLine("  ❌ 用户项目中不存在 EmbeddedAppletSDK.cs");
                report.AppendLine("  提示: 首次构建时会自动复制模板文件");
            }

            // 3. 检查模板文件
            report.AppendLine("\n[SDK 模板文件检查]");
            string templatePath = System.IO.Path.Combine(
                Application.dataPath,
                "WX-WASM-SDK-V2/Editor/PCHighPerformance/Templates/EmbeddedAppletSDK.cs"
            );
            
            if (System.IO.File.Exists(templatePath))
            {
                report.AppendLine($"  ✅ SDK 模板文件存在");
            }
            else
            {
                report.AppendLine($"  ❌ SDK 模板文件丢失");
                report.AppendLine($"  路径: {templatePath}");
            }

            // 4. 检查类型是否加载
            report.AppendLine("\n[类型加载检查]");
            var sdkType = System.Type.GetType("EmbeddedAppletSDK");
            if (sdkType != null)
            {
                report.AppendLine($"  ✅ EmbeddedAppletSDK 类型已加载");
                report.AppendLine($"  程序集: {sdkType.Assembly.GetName().Name}");
            }
            else
            {
                report.AppendLine("  ❌ EmbeddedAppletSDK 类型未加载");
                report.AppendLine("  可能原因: 脚本文件不存在或编译错误");
            }

            report.AppendLine("\n=".PadRight(50, '='));

            // 显示报告
            Debug.Log(report.ToString());
            EditorUtility.DisplayDialog("SDK 注入状态检查", report.ToString(), "确定");
        }

        [MenuItem("微信小游戏 / PC高性能调试 / 查看导出路径", false, 101)]
        public static void ShowExportPath()
        {
            string configPath = System.IO.Path.Combine(
                Application.dataPath,
                "WX-WASM-SDK-V2/Editor/PCHighPerformance/PCHPConfig.json"
            );

            if (!System.IO.File.Exists(configPath))
            {
                EditorUtility.DisplayDialog("提示", "配置文件不存在，请先在面板中设置导出路径", "确定");
                return;
            }

            try
            {
                var json = System.IO.File.ReadAllText(configPath);
                var config = JsonUtility.FromJson<PCHPConfigData>(json);
                
                string exportPath;
                if (string.IsNullOrEmpty(config.exportPath))
                {
                    exportPath = "未设置";
                }
                else if (System.IO.Path.IsPathRooted(config.exportPath))
                {
                    exportPath = config.exportPath;
                }
                else
                {
                    string projectRoot = System.IO.Path.GetFullPath(Application.dataPath + "/../");
                    exportPath = System.IO.Path.Combine(projectRoot, config.exportPath);
                }

                string message = $"AppID: {config.appId}\n";
                message += $"项目名: {(string.IsNullOrEmpty(config.projectName) ? "使用Unity项目名" : config.projectName)}\n";
                message += $"导出路径: {exportPath}\n\n";

                if (System.IO.Directory.Exists(exportPath))
                {
                    message += "✅ 目录存在";
                    
                    // 检查是否有 .exe 文件
                    var exeFiles = System.IO.Directory.GetFiles(exportPath, "*.exe");
                    if (exeFiles.Length > 0)
                    {
                        message += $"\n找到 {exeFiles.Length} 个可执行文件";
                    }
                }
                else
                {
                    message += "⚠️ 目录不存在（尚未构建）";
                }

                EditorUtility.DisplayDialog("导出路径信息", message, "确定");
            }
            catch (System.Exception e)
            {
                EditorUtility.DisplayDialog("错误", $"读取配置失败: {e.Message}", "确定");
            }
        }

        [MenuItem("微信小游戏 / PC高性能调试 / 打开导出目录", false, 102)]
        public static void OpenExportDirectory()
        {
            string configPath = System.IO.Path.Combine(
                Application.dataPath,
                "WX-WASM-SDK-V2/Editor/PCHighPerformance/PCHPConfig.json"
            );

            if (!System.IO.File.Exists(configPath))
            {
                EditorUtility.DisplayDialog("提示", "配置文件不存在，请先在面板中设置导出路径", "确定");
                return;
            }

            try
            {
                var json = System.IO.File.ReadAllText(configPath);
                var config = JsonUtility.FromJson<PCHPConfigData>(json);
                
                string exportPath;
                if (System.IO.Path.IsPathRooted(config.exportPath))
                {
                    exportPath = config.exportPath;
                }
                else
                {
                    string projectRoot = System.IO.Path.GetFullPath(Application.dataPath + "/../");
                    exportPath = System.IO.Path.Combine(projectRoot, config.exportPath);
                }

                if (System.IO.Directory.Exists(exportPath))
                {
                    EditorUtility.RevealInFinder(exportPath);
                }
                else
                {
                    EditorUtility.DisplayDialog("提示", $"目录不存在:\n{exportPath}", "确定");
                }
            }
            catch (System.Exception e)
            {
                EditorUtility.DisplayDialog("错误", $"打开目录失败: {e.Message}", "确定");
            }
        }
    }
}
