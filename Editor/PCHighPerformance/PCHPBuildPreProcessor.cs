using UnityEngine;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using System.IO;

namespace WeChatWASM
{
    /// <summary>
    /// PC高性能小游戏构建预处理器
    /// 负责在构建前向首场景注入 EmbeddedAppletSDK
    /// </summary>
    public class PCHPBuildPreProcessor : IPreprocessBuildWithReport
    {
        public int callbackOrder => 0;

        public void OnPreprocessBuild(BuildReport report)
        {
            // 只处理 Windows/Mac Standalone 构建
            var buildTarget = report.summary.platform;
            if (buildTarget != BuildTarget.StandaloneWindows64 && 
                buildTarget != BuildTarget.StandaloneOSX)
            {
                return;
            }

            Debug.Log("[PC高性能小游戏] 开始预处理构建...");

            try
            {
                // 1. 确保用户项目中有 EmbeddedAppletSDK 脚本（可选）
                EnsureSDKScriptExists();

                // 2. 向首场景注入 SDK GameObject
                InjectSDKToFirstScene();

                Debug.Log("[PC高性能小游戏] 预处理完成!");
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[PC高性能小游戏] 预处理失败: {e.Message}\n{e.StackTrace}");
            }
        }

        /// <summary>
        /// 确保用户项目中存在 EmbeddedAppletSDK.cs 脚本
        /// 如果不存在，从模板复制
        /// </summary>
        private void EnsureSDKScriptExists()
        {
            // 检查用户项目中是否已有脚本
            var sdkType = System.Type.GetType("EmbeddedAppletSDK");
            if (sdkType != null)
            {
                Debug.Log("[PC高性能小游戏] 用户项目中已存在 EmbeddedAppletSDK 脚本");
                return;
            }

            // 模板路径（SDK 包内）
            string templatePath = Path.Combine(
                Application.dataPath,
                "WX-WASM-SDK-V2/Editor/PCHighPerformance/Templates/EmbeddedAppletSDK.cs"
            );

            if (!File.Exists(templatePath))
            {
                Debug.LogWarning($"[PC高性能小游戏] 找不到模板文件: {templatePath}");
                Debug.LogWarning("[PC高性能小游戏] 将仅创建空 GameObject，不添加组件");
                return;
            }

            // 目标路径（用户项目 Scripts 目录）
            string targetPath = Path.Combine(Application.dataPath, "Scripts/EmbeddedAppletSDK.cs");

            // 确保目标目录存在
            string targetDir = Path.GetDirectoryName(targetPath);
            if (!Directory.Exists(targetDir))
            {
                Directory.CreateDirectory(targetDir);
            }

            // 复制文件
            File.Copy(templatePath, targetPath, false); // 不覆盖已存在的文件
            AssetDatabase.Refresh();

            Debug.Log($"[PC高性能小游戏] 已复制 EmbeddedAppletSDK.cs 到: {targetPath}");
        }

        /// <summary>
        /// 向第一个启用的场景注入 SDK GameObject
        /// </summary>
        private void InjectSDKToFirstScene()
        {
            // 1. 获取第一个启用的场景
            var firstScenePath = GetFirstEnabledScene();
            if (string.IsNullOrEmpty(firstScenePath))
            {
                Debug.LogWarning("[PC高性能小游戏] 没有找到启用的场景，跳过注入");
                return;
            }

            // 2. 保存当前场景状态
            var currentScenes = EditorSceneManager.GetSceneManagerSetup();

            // 3. 打开目标场景
            var scene = EditorSceneManager.OpenScene(firstScenePath, OpenSceneMode.Single);

            // 4. 检查是否已存在 SDK 对象
            var existingSDK = GameObject.Find("EmbeddedAppletSDK");
            if (existingSDK != null)
            {
                Debug.Log($"[PC高性能小游戏] 场景 {scene.name} 中已存在 SDK 对象，跳过注入");
                RestoreScenes(currentScenes);
                return;
            }

            // 5. 创建空 GameObject 并添加 EmbeddedAppletSDK 组件
            var sdkObject = new GameObject("EmbeddedAppletSDK");
            
            // 尝试添加组件（如果用户项目中有该脚本）
            var sdkType = System.Type.GetType("EmbeddedAppletSDK");
            if (sdkType != null)
            {
                sdkObject.AddComponent(sdkType);
                Debug.Log($"[PC高性能小游戏] 已在 {scene.name} 中创建 SDK 对象并添加组件");
            }
            else
            {
                Debug.LogWarning("[PC高性能小游戏] 找不到 EmbeddedAppletSDK 类型，仅创建空对象");
                Debug.LogWarning("[PC高性能小游戏] 请确保项目中包含 EmbeddedAppletSDK.cs 脚本");
            }

            // 6. 保存场景
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);

            // 7. 恢复之前的场景布局
            RestoreScenes(currentScenes);
        }

        /// <summary>
        /// 获取第一个启用的场景路径
        /// </summary>
        private string GetFirstEnabledScene()
        {
            foreach (var scene in EditorBuildSettings.scenes)
            {
                if (scene.enabled)
                {
                    return scene.path;
                }
            }
            return null;
        }

        /// <summary>
        /// 恢复之前打开的场景布局
        /// </summary>
        private void RestoreScenes(UnityEditor.SceneManagement.SceneSetup[] setup)
        {
            if (setup != null && setup.Length > 0)
            {
                EditorSceneManager.RestoreSceneManagerSetup(setup);
            }
        }
    }
}
