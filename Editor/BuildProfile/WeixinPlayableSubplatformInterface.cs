#if TUANJIE_1_6_OR_NEWER
using System;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEditor.Build.Profile;
using UnityEngine;
using UnityEngine.Rendering;

namespace WeChatWASM
{
    // 接管引擎内置的 DefaultWeChatAdsHelper
    public class WeixinPlayableSubplatformInterface : MiniGameSubplatformInterface
    {
        public override string GetSubplatformName() => "WeChat:微信试玩广告";
        public override bool SupportsMiniGamePlatform() => false;
        public override bool SupportsPlayableAdsPlatform() => true;

        public override MiniGameSettings GetSubplatformSettings()
            => new WeixinPlayableMiniGameSettings(new WeixinPlayableMiniGameSettingsEditor());

        public override BuildMiniGameError Build(BuildProfile buildProfile) => BuildMiniGameError.InvalidInput;

        public override BuildMiniGameError Build(BuildProfile buildProfile, BuildOptions options)
        {
            var settings = WeixinPlayableMiniGameSettings.From(buildProfile?.miniGameSettings);
            if (settings == null)
            {
                Debug.LogError("[WX][Playable] Build stopped: unsupported miniGameSettings.");
                return BuildMiniGameError.InvalidInput;
            }
            if (string.IsNullOrEmpty(buildProfile.buildPath))
            {
                Debug.LogError("Build Path is empty!");
                return BuildMiniGameError.InvalidInput;
            }

            bool webgl2 = settings.CompileOptions.Webgl2;
            if (!PlayablePreprocess(buildProfile, ref webgl2))
                return BuildMiniGameError.InvalidInput;

            // 配置对象由 SDK 自己管理（UnityUtil）
            var config = UnityUtil.GetPlayableEditorConf();
            string backup = JsonUtility.ToJson(config);

            JsonUtility.FromJsonOverwrite(JsonUtility.ToJson(settings.ProjectConf), config.ProjectConf);
            JsonUtility.FromJsonOverwrite(JsonUtility.ToJson(settings.CompileOptions), config.CompileOptions);
            string projectRoot = Path.GetFullPath(Application.dataPath + "/../");
            bool absolute = WXSettingsHelper.IsAbsolutePath(buildProfile.buildPath);
            config.ProjectConf.DST = absolute ? buildProfile.buildPath : Path.Combine(projectRoot, buildProfile.buildPath);
            config.ProjectConf.relativeDST = absolute ? Path.GetRelativePath(projectRoot, buildProfile.buildPath) : buildProfile.buildPath;
            config.CompileOptions.DevelopBuild = buildProfile.platformSettings.development;
            config.CompileOptions.Webgl2 = webgl2;
            EditorUtility.SetDirty(config);
            AssetDatabase.SaveAssets();

            var result = BuildMiniGameError.Unknown;
            try
            {
                switch (WXPlayableConvertCore.DoExport())
                {
                    case WXConvertCore.WXExportError.SUCCEED:
                        result = PostExport(buildProfile, settings, config.ProjectConf.DST);
                        break;
                    case WXConvertCore.WXExportError.BUILD_WEBGL_FAILED:
                        result = BuildMiniGameError.PlayerBuildFailed;
                        break;
                }
            }
            finally
            {
                JsonUtility.FromJsonOverwrite(backup, config);
                EditorUtility.SetDirty(config);
                AssetDatabase.SaveAssets();
            }
            return result;
        }

        // 与引擎 DefaultWeChatBuildProfileHelper.WechatBuildPreprocess 一致
        private static bool PlayablePreprocess(BuildProfile buildProfile, ref bool webgl2)
        {
            PlayerSettings playerSettings = buildProfile.playerSettings;
            ColorSpace colorSpace = PlayerSettings.colorSpace;
            GraphicsDeviceType[] apis = PlayerSettings.GetGraphicsAPIs(buildProfile.buildTarget);
            if (playerSettings != null)
            {
                colorSpace = PlayerSettings.GetColorSpace_Internal(playerSettings);
                apis = PlayerSettings.GetGraphicsAPIs_Internal(playerSettings, buildProfile.buildTarget);

                var template = Path.GetFullPath(Path.Combine("Packages", "com.qq.weixin.minigame", "WebGLTemplates/WXTemplate2022TJ"));
                if (!Directory.Exists(template))
                    template = Path.GetFullPath(Path.Combine(Application.dataPath, "WebGLTemplates/WXTemplate2022TJ"));
                if (Directory.Exists(template))
                    PlayerSettings.MiniGame.SetTemplatePath_Internal(playerSettings, $"PATH:{template}");

                PlayerSettings.MiniGame.SetCompressionFormat_Internal(playerSettings, MiniGameCompressionFormat.Disabled);
                PlayerSettings.MiniGame.SetLinkerTarget_Internal(playerSettings, MiniGameLinkerTarget.Wasm);
                PlayerSettings.MiniGame.SetDataCaching_Internal(playerSettings, false);
                PlayerSettings.MiniGame.SetDebugSymbolMode_Internal(playerSettings, MiniGameDebugSymbolMode.External);
                PlayerSettings.SetRunInBackground_Internal(playerSettings, false);
            }

            bool hasWebGL1 = apis.Contains(GraphicsDeviceType.OpenGLES2);
            if (hasWebGL1 && colorSpace == ColorSpace.Linear)
            {
                Debug.LogError("WebGL1 does not support Linear color space. Please switch to Gamma color space.");
                return false;
            }
            webgl2 = !hasWebGL1;
            return true;
        }

        // 与引擎 DefaultWeChatAdsHelper.Build 成功分支一致：MethodMap.tsv 挪到 minigame 目录，再按需上传分包
        private static BuildMiniGameError PostExport(BuildProfile buildProfile, WeixinPlayableMiniGameSettings settings, string dst)
        {
            string methodMapSrc = Path.Combine(dst, "webgl", "Build", "MethodMap.tsv");
            string miniGameDir = Path.Combine(dst, "minigame");
            if (File.Exists(methodMapSrc) && Directory.Exists(miniGameDir))
                File.Copy(methodMapSrc, Path.Combine(miniGameDir, "MethodMap.tsv"), true);

            if (!settings.automaticUploadWasmSplit)
                return BuildMiniGameError.Succeeded;

            if (settings.useIncrementalWasmSplit && string.IsNullOrEmpty(settings.incrementalWasmSplitRelevantBundleId))
            {
                Debug.LogError("创建增量分包失败：未指定历史分包的 Bundle ID。");
                return BuildMiniGameError.PlayerBuildFailed;
            }

            string name = string.IsNullOrEmpty(settings.ProjectConf.projectName) ? PlayerSettings.productName : settings.ProjectConf.projectName;
            WasmSplitUpload(Path.Combine(buildProfile.buildPath, "minigame"), name, settings.incrementalWasmSplitRelevantBundleId);
            return BuildMiniGameError.Succeeded;
        }

        // UnityEditor.WasmSplit.WasmSplitService / WasmSplitWindow 都是 internal，只能反射
        private static void WasmSplitUpload(string buildPath, string bundleName, string relevantBundleId)
        {
            var editorAssembly = typeof(EditorWindow).Assembly;
            var service = editorAssembly.GetType("UnityEditor.WasmSplit.WasmSplitService");
            var windowType = editorAssembly.GetType("UnityEditor.WasmSplit.WasmSplitWindow");
            if (service == null)
            {
                Debug.LogError("WasmSplitService not found. Please upload manually.");
                return;
            }

            const BindingFlags flags = BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;
            service.GetField("s_CreateBundleSync_OnSuccess", flags)?.SetValue(null, new Action<string>(bundleId =>
            {
                Debug.Log($"Bundle upload successfully with id: {bundleId}");
                if (windowType == null)
                    return;
                var window = EditorWindow.GetWindow(windowType);
                window.titleContent = new GUIContent("Wasm Split Tool");
                window.Show();
            }));
            service.GetField("s_CreateBundleSync_OnError", flags)?.SetValue(null, new Action<string>(error =>
            {
                Debug.LogError($"Failed to initialize upload: \"{error}\". Please upload manually.");
            }));
            service.GetMethod("UploadBundle", flags)?.Invoke(null, new object[] { buildPath, bundleName, relevantBundleId });
        }
    }

    /// <summary>
    /// 字段名与引擎 DefaultWeChatAdsSettings 完全一致，接管前建出来的 BuildProfile 可以按 JSON 原样搬过来。
    /// </summary>
    [Serializable]
    public class WeixinPlayableMiniGameSettings : MiniGameSettings
    {
        public WXPlayableProjectConf ProjectConf = new WXPlayableProjectConf();
        public PlayableCompileOptions CompileOptions = new PlayableCompileOptions();
        [SerializeField] public bool automaticUploadWasmSplit = true;
        [SerializeField] public bool useIncrementalWasmSplit = false;
        [SerializeField] public string incrementalWasmSplitRelevantBundleId = "";

        public WeixinPlayableMiniGameSettings(MiniGameSettingsEditor editor) : base(editor) { }

        // 引擎的 DefaultWeChatAdsSettings 是 internal，只能按类型名 + 反射取值
        internal static WeixinPlayableMiniGameSettings From(MiniGameSettings source)
        {
            if (source is WeixinPlayableMiniGameSettings own)
                return own;
            if (source == null || source.GetType().Name != "DefaultWeChatAdsSettings")
                return null;

            const BindingFlags flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            var type = source.GetType();
            object Get(string field) => type.GetField(field, flags)?.GetValue(source);

            var result = new WeixinPlayableMiniGameSettings(null);
            if (Get("ProjectConf") is object projectConf)
                JsonUtility.FromJsonOverwrite(JsonUtility.ToJson(projectConf), result.ProjectConf);
            if (Get("CompileOptions") is object compileOptions)
                JsonUtility.FromJsonOverwrite(JsonUtility.ToJson(compileOptions), result.CompileOptions);
            result.automaticUploadWasmSplit = Get("automaticUploadWasmSplit") as bool? ?? true;
            result.useIncrementalWasmSplit = Get("useIncrementalWasmSplit") as bool? ?? false;
            result.incrementalWasmSplitRelevantBundleId = Get("incrementalWasmSplitRelevantBundleId") as string ?? "";
            return result;
        }

        [Serializable]
        public class WXPlayableProjectConf
        {
            public string projectName;
            public string Appid;
            public string relativeDST = string.Empty;
            public string DST = string.Empty;
            public int MemorySize = 256;
            public WXScreenOritation Orientation = WXScreenOritation.Portrait;
            public float IOSDevicePixelRatio = 0.0f;
        }

        [Serializable]
        public class PlayableCompileOptions
        {
            public bool DevelopBuild = false;
            public bool Il2CppOptimizeSize = true;
            public bool profilingFuncs = true;
            public bool Webgl2 = false;
            public string CustomNodePath = string.Empty;
        }
    }

    [Serializable]
    public class WeixinPlayableMiniGameSettingsEditor : MiniGameSettingsEditor
    {
        private Vector2 scrollRoot;

        public override void OnMiniGameSettingsIMGUI(SerializedObject serializedObject, SerializedProperty miniGameProperty)
        {
            serializedObject.UpdateIfRequiredOrScript();
            scrollRoot = EditorGUILayout.BeginScrollView(scrollRoot);

            var projectConf = miniGameProperty.FindPropertyRelative("ProjectConf");
            var compileOptions = miniGameProperty.FindPropertyRelative("CompileOptions");

            EditorGUILayout.LabelField("基本信息", EditorStyles.boldLabel);
            EditorGUILayout.PropertyField(projectConf.FindPropertyRelative("Appid"), new GUIContent("小游戏试玩AppID"));
            EditorGUILayout.PropertyField(projectConf.FindPropertyRelative("projectName"), new GUIContent("小游戏试玩项目名"));
            EditorGUILayout.PropertyField(projectConf.FindPropertyRelative("Orientation"), new GUIContent("游戏方向"));
            EditorGUILayout.PropertyField(projectConf.FindPropertyRelative("MemorySize"), new GUIContent("UnityHeap预留内存(MB)"));

            EditorGUILayout.LabelField("调试编译选项", EditorStyles.boldLabel);
            EditorGUILayout.PropertyField(compileOptions.FindPropertyRelative("Il2CppOptimizeSize"), new GUIContent("Il2Cpp Optimize Size"));
            EditorGUILayout.PropertyField(compileOptions.FindPropertyRelative("profilingFuncs"), new GUIContent("Profiling Funcs"));

            EditorGUILayout.LabelField("Wasm 分包", EditorStyles.boldLabel);
            var automaticUpload = miniGameProperty.FindPropertyRelative("automaticUploadWasmSplit");
            EditorGUILayout.PropertyField(automaticUpload, new GUIContent("自动上传进行分包"));
            if (automaticUpload.boolValue)
            {
                var incremental = miniGameProperty.FindPropertyRelative("useIncrementalWasmSplit");
                EditorGUILayout.PropertyField(incremental, new GUIContent("使用增量分包"));
                if (incremental.boolValue)
                    EditorGUILayout.PropertyField(miniGameProperty.FindPropertyRelative("incrementalWasmSplitRelevantBundleId"), new GUIContent("增量分包使用的历史 Bundle ID"));
            }

            EditorGUILayout.EndScrollView();
            serializedObject.ApplyModifiedProperties();
        }
    }
}
#endif
