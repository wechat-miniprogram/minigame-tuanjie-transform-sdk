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
    /// 负责在构建前向首场景注入 WXPCHPInitScript
    /// </summary>
    public class PCHPBuildPreProcessor : IPreprocessBuildWithReport
    {
        // SDK 脚本名称常量
        private const string SDK_CLASS_NAME = "WeChatWASM.WXPCHPInitScript";
        private const string SDK_GAMEOBJECT_NAME = "WXPCHPInitScript";

        public int callbackOrder => 0;

        public void OnPreprocessBuild(BuildReport report)
        {
            Debug.Log("========================================");
            Debug.Log("[PC高性能小游戏] PCHPBuildPreProcessor.OnPreprocessBuild 被调用");
            Debug.Log("========================================");

            // 只处理 Windows/Mac Standalone 构建
            var buildTarget = report.summary.platform;
            if (buildTarget != BuildTarget.StandaloneWindows64 && 
                buildTarget != BuildTarget.StandaloneOSX)
            {
                Debug.LogWarning($"[PC高性能小游戏] 当前平台 {buildTarget} 不是 Windows/Mac，跳过预处理");
                return;
            }

            Debug.Log("[PC高性能小游戏] 开始预处理构建...");

            try
            {
                Debug.Log("[PC高性能小游戏] → 步骤1: 检查 WXPCHPInitScript 脚本是否存在");
                EnsureSDKScriptExists();

                Debug.Log("[PC高性能小游戏] → 步骤2: 向首场景注入 SDK GameObject");
                InjectSDKToFirstScene();

                Debug.Log("[PC高性能小游戏] ✅ 预处理完成!");
            }
            catch (System.Exception e)
            {
                Debug.LogError("========================================");
                Debug.LogError($"[PC高性能小游戏] ❌ 预处理失败: {e.Message}\n{e.StackTrace}");
                Debug.LogError("========================================");
                throw;
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
                if (type != null)
                {
                    return type;
                }
            }
            return null;
        }

        /// <summary>
        /// 确保 WXPCHPInitScript 脚本存在
        /// </summary>
        private void EnsureSDKScriptExists()
        {
            var sdkType = FindTypeInAllAssemblies(SDK_CLASS_NAME);
            if (sdkType != null)
            {
                Debug.Log($"[PC高性能小游戏] ✅ WXPCHPInitScript 脚本已加载 (程序集: {sdkType.Assembly.GetName().Name})");
                return;
            }

            // 脚本应该在 SDK Runtime 目录，如果找不到说明 SDK 安装有问题
            Debug.LogError("[PC高性能小游戏] ❌ 找不到 WXPCHPInitScript 类型");
            Debug.LogError("[PC高性能小游戏] 请确保 WX-WASM-SDK-V2 已正确安装");
            throw new BuildFailedException("[PC高性能小游戏] 缺少 WXPCHPInitScript 脚本，请检查 SDK 安装");
        }

        /// <summary>
        /// 向第一个启用的场景注入 SDK GameObject
        /// </summary>
        private void InjectSDKToFirstScene()
        {
            var firstScenePath = GetFirstEnabledScene();
            if (string.IsNullOrEmpty(firstScenePath))
            {
                Debug.LogWarning("[PC高性能小游戏] 没有找到启用的场景，跳过注入");
                return;
            }

            var currentScenes = EditorSceneManager.GetSceneManagerSetup();
            var scene = EditorSceneManager.OpenScene(firstScenePath, OpenSceneMode.Single);

            // 删除旧的对象（兼容从 EmbeddedAppletSDK 迁移）
            var oldSDK = GameObject.Find("EmbeddedAppletSDK");
            if (oldSDK != null)
            {
                Debug.Log("[PC高性能小游戏] 删除旧的 EmbeddedAppletSDK 对象");
                GameObject.DestroyImmediate(oldSDK);
            }

            // 检查是否已存在新的 SDK 对象
            var existingSDK = GameObject.Find(SDK_GAMEOBJECT_NAME);
            if (existingSDK != null)
            {
                Debug.Log($"[PC高性能小游戏] 场景中已存在 {SDK_GAMEOBJECT_NAME}，重新创建");
                GameObject.DestroyImmediate(existingSDK);
            }

            // 创建 GameObject 并添加组件
            var sdkObject = new GameObject(SDK_GAMEOBJECT_NAME);
            var sdkType = FindTypeInAllAssemblies(SDK_CLASS_NAME);
            
            if (sdkType != null)
            {
                var assemblyName = sdkType.Assembly.GetName().Name;
                Debug.Log($"[PC高性能小游戏] 找到 WXPCHPInitScript，程序集: {assemblyName}");
                
                if (assemblyName.Contains("Editor"))
                {
                    Debug.LogError("[PC高性能小游戏] ❌ WXPCHPInitScript 在 Editor 程序集中!");
                    GameObject.DestroyImmediate(sdkObject);
                    throw new BuildFailedException("[PC高性能小游戏] WXPCHPInitScript 必须在 Runtime 程序集");
                }
                
                sdkObject.AddComponent(sdkType);
                Debug.Log($"[PC高性能小游戏] ✅ 已在 {scene.name} 中创建 {SDK_GAMEOBJECT_NAME} 并添加组件");
            }
            else
            {
                Debug.LogError("[PC高性能小游戏] ❌ 找不到 WXPCHPInitScript 类型");
                GameObject.DestroyImmediate(sdkObject);
                throw new BuildFailedException("[PC高性能小游戏] 无法找到 WXPCHPInitScript 组件");
            }

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            RestoreScenes(currentScenes);
        }

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

        private void RestoreScenes(UnityEditor.SceneManagement.SceneSetup[] setup)
        {
            if (setup != null && setup.Length > 0)
            {
                EditorSceneManager.RestoreSceneManagerSetup(setup);
            }
        }
    }
}
