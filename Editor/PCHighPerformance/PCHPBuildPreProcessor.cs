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
    /// 
    /// 注入策略（优先级从高到低）：
    /// 1. 开发者已在场景中手动挂载 WXPCHPInitScript → 跳过注入
    /// 2. WX_PCHP_ENABLED 宏已定义 → RuntimeInitializeOnLoadMethod 会自动创建，无需注入
    /// 3. 走转换工具链但未手动挂载 → 兜底注入到首场景（路径A 兼容）
    /// 
    /// 触发条件：
    /// - 仅 Standalone (Windows/macOS) 构建时生效
    /// - 未定义 WX_PCHP_ENABLED 时自动添加宏到 ScriptingDefineSymbols
    /// </summary>
    public class PCHPBuildPreProcessor : IPreprocessBuildWithReport
    {
        private const string SDK_CLASS_NAME = "WeChatWASM.WXPCHPInitScript";
        private const string SDK_GAMEOBJECT_NAME = "WXPCHPInitScript";
        private const string PCHP_DEFINE_SYMBOL = "WX_PCHP_ENABLED";

        public int callbackOrder => 0;

        public void OnPreprocessBuild(BuildReport report)
        {
            var buildTarget = report.summary.platform;

            // 只处理 Standalone 构建
            if (buildTarget != BuildTarget.StandaloneWindows64 &&
                buildTarget != BuildTarget.StandaloneOSX)
            {
                return;
            }

            Debug.Log("[PC高性能模式] PCHPBuildPreProcessor 开始预处理");

            // 确保 WX_PCHP_ENABLED 宏已定义
            EnsurePCHPDefineSymbol();

            // 检查 SDK 脚本是否存在
            var sdkType = FindTypeInAllAssemblies(SDK_CLASS_NAME);
            if (sdkType == null)
            {
                Debug.LogWarning("[PC高性能模式] 未找到 WXPCHPInitScript 类型，跳过注入（可能需要重新编译）");
                return;
            }

            // 检查首场景是否已有 WXPCHPInitScript 组件
            if (IsSDKAlreadyInFirstScene())
            {
                Debug.Log("[PC高性能模式] 首场景中已存在 WXPCHPInitScript，跳过注入");
                return;
            }

            // RuntimeInitializeOnLoadMethod 会自动创建实例，仅在路径A兼容模式下才注入
            // 判断依据：如果当前是从微信小游戏转换工具链触发的构建（build target 此前是 WebGL/WeixinMiniGame）
            if (WXPCHPBuildHelper.IsPCHighPerformanceEnabled())
            {
                Debug.Log("[PC高性能模式] 转换工具链模式，兜底注入首场景");
                InjectSDKToFirstScene(sdkType);
            }
            else
            {
                Debug.Log("[PC高性能模式] 非转换工具链模式，依赖 RuntimeInitializeOnLoadMethod 自动初始化");
            }
        }

        /// <summary>
        /// 确保 Standalone 平台的 ScriptingDefineSymbols 包含 WX_PCHP_ENABLED
        /// </summary>
        private void EnsurePCHPDefineSymbol()
        {
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
            }
        }

        /// <summary>
        /// 检查首场景是否已包含 WXPCHPInitScript 组件
        /// </summary>
        private bool IsSDKAlreadyInFirstScene()
        {
            var firstScenePath = GetFirstEnabledScene();
            if (string.IsNullOrEmpty(firstScenePath)) return false;

            var currentScenes = EditorSceneManager.GetSceneManagerSetup();

            try
            {
                var scene = EditorSceneManager.OpenScene(firstScenePath, OpenSceneMode.Single);
                var existing = GameObject.Find(SDK_GAMEOBJECT_NAME);

                if (existing != null)
                {
                    // 检查是否真的挂载了正确的组件
                    var sdkType = FindTypeInAllAssemblies(SDK_CLASS_NAME);
                    if (sdkType != null && existing.GetComponent(sdkType) != null)
                    {
                        return true;
                    }
                }

                return false;
            }
            finally
            {
                RestoreScenes(currentScenes);
            }
        }

        /// <summary>
        /// 向首场景注入 SDK（兜底方式）
        /// </summary>
        private void InjectSDKToFirstScene(System.Type sdkType)
        {
            var firstScenePath = GetFirstEnabledScene();
            if (string.IsNullOrEmpty(firstScenePath))
            {
                Debug.LogWarning("[PC高性能模式] 没有启用的场景，跳过注入");
                return;
            }

            var currentScenes = EditorSceneManager.GetSceneManagerSetup();
            var scene = EditorSceneManager.OpenScene(firstScenePath, OpenSceneMode.Single);

            // 清理旧对象（兼容迁移）
            var oldSDK = GameObject.Find("EmbeddedAppletSDK");
            if (oldSDK != null)
            {
                Debug.Log("[PC高性能模式] 删除旧的 EmbeddedAppletSDK 对象");
                GameObject.DestroyImmediate(oldSDK);
            }

            // 删除已存在的同名对象
            var existingSDK = GameObject.Find(SDK_GAMEOBJECT_NAME);
            if (existingSDK != null)
            {
                GameObject.DestroyImmediate(existingSDK);
            }

            // 创建并挂载
            var assemblyName = sdkType.Assembly.GetName().Name;
            if (assemblyName.Contains("Editor"))
            {
                Debug.LogError("[PC高性能模式] WXPCHPInitScript 在 Editor 程序集中，无法用于 Runtime！");
                throw new BuildFailedException("[PC高性能模式] WXPCHPInitScript 必须在 Runtime 程序集");
            }

            var sdkObject = new GameObject(SDK_GAMEOBJECT_NAME);
            sdkObject.AddComponent(sdkType);
            Debug.Log($"[PC高性能模式] ✅ 已在 [{scene.name}] 注入 {SDK_GAMEOBJECT_NAME}");

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            RestoreScenes(currentScenes);
        }

        private System.Type FindTypeInAllAssemblies(string typeName)
        {
            foreach (var assembly in System.AppDomain.CurrentDomain.GetAssemblies())
            {
                var type = assembly.GetType(typeName);
                if (type != null) return type;
            }
            return null;
        }

        private string GetFirstEnabledScene()
        {
            foreach (var scene in EditorBuildSettings.scenes)
            {
                if (scene.enabled) return scene.path;
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
