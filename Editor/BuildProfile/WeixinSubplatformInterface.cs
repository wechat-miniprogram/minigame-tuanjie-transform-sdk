#if TUANJIE_1_6_OR_NEWER
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Profile;
using UnityEngine;
using UnityEngine.Rendering;


namespace WeChatWASM
{
    [InitializeOnLoad]
    public static class WeixinSubTargetManager
    {
        static WeixinSubTargetManager()
        {
            MiniGameSubplatformManager.RegisterSubplatform(new WeixinSubplatformInterface());
        }
    }

    public class WeixinSubplatformInterface : MiniGameSubplatformInterface
    {
        class CacheConfig
        {
            public WXProjectConf ProjectConf;
            public SDKOptions SDKOptions;
            public CompileOptions CompileOptions;
            public CompressTexture CompressTexture;
            public List<string> PlayerPrefsKeys = new List<string>();
            public FontOptions FontOptions;
        }

        private CacheConfig cacheConfig = new CacheConfig();

        public override string GetSubplatformName()
        {
            return "WeChat:微信小游戏";
        }

        public override MiniGameSettings GetSubplatformSettings()
        {
            return new WeixinMiniGameSettings(new WeixinMiniGameSettingsEditor());
        }

        public override BuildMiniGameError Build(BuildProfile buildProfile)
        {
            // Useless
            return BuildMiniGameError.InvalidInput;
        }

        public override BuildMiniGameError Build(BuildProfile buildProfile, BuildOptions options)
        {
            Debug.LogFormat("[WX][BuildProfile] Build start. buildProfile={0}, buildPath={1}, buildTarget={2}, miniGameSettings={3}",
                buildProfile != null ? buildProfile.name : "null",
                buildProfile != null ? buildProfile.buildPath : "null",
                buildProfile != null ? buildProfile.buildTarget.ToString() : "null",
                buildProfile != null && buildProfile.miniGameSettings != null ? buildProfile.miniGameSettings.GetType().FullName : "null");
            BuildMiniGameError buildMiniGameError = BuildMiniGameError.Unknown;
            bool preprocessSuccess = WechatBuildPreprocess(buildProfile);
            Debug.LogFormat("[WX][BuildProfile] WechatBuildPreprocess result={0}", preprocessSuccess);
            if (!preprocessSuccess)
            {
                Debug.LogError("[WX][BuildProfile] Build stopped: WechatBuildPreprocess failed.");
                return BuildMiniGameError.InvalidInput;
            }

            var error = CallDoExport(buildProfile, options);
            Debug.LogFormat("[WX][BuildProfile] WXConvertCore.DoExport result={0}", error);
            int enumIntValue = Convert.ToInt32(error);
            switch (enumIntValue)
            {
                case 0: // SUCCEED
                    {
                        WeixinMiniGameSettings.AutoStreamingLoad();
                        buildMiniGameError = BuildMiniGameError.Succeeded;
                        break;
                    }
                case 2: // BUILD_WEBGL_FAILED
                    {
                        buildMiniGameError = BuildMiniGameError.PlayerBuildFailed;
                        break;
                    }
                case 1: // NODE_NOT_FOUND
                default:
                    {
                        buildMiniGameError = BuildMiniGameError.Unknown;
                        break;
                    }
            }

            BuildPostProcess(buildProfile);
            Debug.LogFormat("[WX][BuildProfile] Build finished. result={0}", buildMiniGameError);
            return buildMiniGameError;
        }

        private bool ApplyMiniGameSettingsToConfig(BuildProfile buildProfile, BuildOptions options, WXEditorScriptObject config)
        {
            if (buildProfile == null || buildProfile.miniGameSettings == null)
            {
                Debug.LogError("[WX][BuildProfile] Build stopped: buildProfile.miniGameSettings is null.");
                return false;
            }

            if (config.ProjectConf == null) config.ProjectConf = new WXProjectConf();
            if (config.SDKOptions == null) config.SDKOptions = new SDKOptions();
            if (config.CompileOptions == null) config.CompileOptions = new CompileOptions();
            if (config.CompressTexture == null) config.CompressTexture = new CompressTexture();
            if (config.FontOptions == null) config.FontOptions = new FontOptions();
            if (config.PlayerPrefsKeys == null) config.PlayerPrefsKeys = new List<string>();

            bool automaticFillInstantGame = true;
            if (buildProfile.miniGameSettings is WeixinMiniGameSettings weixinSettings)
            {
                config.ProjectConf = weixinSettings.ProjectConf ?? config.ProjectConf;
                config.SDKOptions = weixinSettings.SDKOptions ?? config.SDKOptions;
                config.CompileOptions = weixinSettings.CompileOptions ?? config.CompileOptions;
                config.CompressTexture = weixinSettings.CompressTexture ?? config.CompressTexture;
                config.FontOptions = weixinSettings.FontOptions ?? config.FontOptions;
                config.PlayerPrefsKeys = weixinSettings.PlayerPrefsKeys ?? config.PlayerPrefsKeys;
                automaticFillInstantGame = weixinSettings.m_AutomaticFillInstantGame;
            }
            else if (buildProfile.miniGameSettings is UnityEditor.ExternalMiniGame.DefaultWeChatMiniGameSettings defaultSettings)
            {
                JsonUtility.FromJsonOverwrite(JsonUtility.ToJson(defaultSettings.ProjectConf, true), config.ProjectConf);
                JsonUtility.FromJsonOverwrite(JsonUtility.ToJson(defaultSettings.SDKOptions, true), config.SDKOptions);
                JsonUtility.FromJsonOverwrite(JsonUtility.ToJson(defaultSettings.CompileOptions, true), config.CompileOptions);
                JsonUtility.FromJsonOverwrite(JsonUtility.ToJson(defaultSettings.CompressTexture, true), config.CompressTexture);
                JsonUtility.FromJsonOverwrite(JsonUtility.ToJson(defaultSettings.FontOptions, true), config.FontOptions);
                config.PlayerPrefsKeys = defaultSettings.PlayerPrefsKeys ?? config.PlayerPrefsKeys;
            }
            else
            {
                Debug.LogErrorFormat("[WX][BuildProfile] Build stopped: unsupported miniGameSettings type {0}.", buildProfile.miniGameSettings.GetType().FullName);
                return false;
            }

            FillAutoStreamingAutomatically(config.ProjectConf, automaticFillInstantGame);
            if (!ApplyBuildProfileOptions(buildProfile, options, config))
            {
                return false;
            }

#if TUANJIE_1_9_OR_NEWER
            WXConvertCore.RefreshEnableRenderThread(buildProfile);
            Debug.LogFormat("[WX][BuildProfile] RefreshEnableRenderThread done. enableRenderThread={0}", WXConvertCore.EnableRenderThread);
            config.CompileOptions.enableRenderThread = WXConvertCore.EnableRenderThread;
#endif
            return true;
        }

        private void FillAutoStreamingAutomatically(WXProjectConf projectConf, bool automaticFillInstantGame)
        {
            if (!WXConvertCore.IsInstantGameAutoStreaming() || !automaticFillInstantGame)
            {
                return;
            }

            projectConf.CDN = WXConvertCore.GetInstantGameAutoStreamingCDN();
            if (!projectConf.bundlePathIdentifier.Contains("CUS/CustomAB;"))
            {
                projectConf.bundlePathIdentifier = "CUS/CustomAB;" + projectConf.bundlePathIdentifier;
            }
            if (!projectConf.bundlePathIdentifier.Contains("AS;"))
            {
                projectConf.bundlePathIdentifier = "AS;" + projectConf.bundlePathIdentifier;
            }
            projectConf.dataFileSubPrefix = "CUS";
        }

        private bool ApplyBuildProfileOptions(BuildProfile buildProfile, BuildOptions options, WXEditorScriptObject config)
        {
            if (!string.IsNullOrEmpty(buildProfile.buildPath))
            {
                if (WXSettingsHelper.IsAbsolutePath(buildProfile.buildPath))
                {
                    config.ProjectConf.DST = buildProfile.buildPath;
                    config.ProjectConf.relativeDST = Path.GetRelativePath(Path.GetFullPath(Application.dataPath + "/../"), buildProfile.buildPath);
                }
                else
                {
                    config.ProjectConf.DST = Path.Combine(Path.GetFullPath(Application.dataPath + "/../"), buildProfile.buildPath);
                    config.ProjectConf.relativeDST = buildProfile.buildPath;
                }
            }
            else
            {
                Debug.LogError("Build Path is empty!");
                return false;
            }

            config.CompileOptions.DevelopBuild = buildProfile.platformSettings.development;
            config.CompileOptions.AutoProfile = buildProfile.platformSettings.connectProfiler;
            config.CompileOptions.CleanBuild = ((int)options & (int)BuildOptions.CleanBuildCache) != 0;
            config.CompileOptions.ScriptOnly = ((int)options & (int)BuildOptions.BuildScriptsOnly) != 0;
            return true;
        }

        private bool WechatBuildPreprocess(BuildProfile buildProfile)
        {
            // Check GFX API and Color Space
            if (buildProfile != null)
            {
                PlayerSettings playerSettings = buildProfile.playerSettings;
                // Global PlayerSettings
                ColorSpace colorSpace = PlayerSettings.colorSpace;
                GraphicsDeviceType[] apis = PlayerSettings.GetGraphicsAPIs(buildProfile.buildTarget);
                bool isAutomatic = PlayerSettings.GetUseDefaultGraphicsAPIs(buildProfile.buildTarget);
                if (playerSettings != null)
                {
                    // BuildProfile PlayerSettings Override
                    colorSpace = PlayerSettings.GetColorSpace_Internal(playerSettings);
                    apis = PlayerSettings.GetGraphicsAPIs_Internal(playerSettings, buildProfile.buildTarget);
                    isAutomatic = PlayerSettings.GetUseDefaultGraphicsAPIs_Internal(playerSettings, buildProfile.buildTarget);

                    // set override templatePath
                    var absolutePath = Path.GetFullPath(Path.Combine("Packages", "com.qq.weixin.minigame", "WebGLTemplates/WXTemplate2022TJ"));
                    if (!Directory.Exists(absolutePath))
                        absolutePath = Path.GetFullPath(Path.Combine(Application.dataPath, "WebGLTemplates/WXTemplate2022TJ"));

                    if (Directory.Exists(absolutePath))
                        PlayerSettings.MiniGame.SetTemplatePath_Internal(playerSettings, $"PATH:{absolutePath}");

                    PlayerSettings.MiniGame.SetThreadsSupport_Internal(playerSettings, WXConvertCore.EnableRenderThread);
                    Debug.LogFormat("[WX][BuildProfile] Apply PlayerSettings override. templatePath={0}, threadsSupport={1}", absolutePath, WXConvertCore.EnableRenderThread);
                    PlayerSettings.MiniGame.SetCompressionFormat_Internal(playerSettings, MiniGameCompressionFormat.Disabled);
                    PlayerSettings.MiniGame.SetLinkerTarget_Internal(playerSettings, MiniGameLinkerTarget.Wasm);
                    PlayerSettings.MiniGame.SetDataCaching_Internal(playerSettings, false);
                    PlayerSettings.MiniGame.SetDebugSymbolMode_Internal(playerSettings, MiniGameDebugSymbolMode.External);
                    PlayerSettings.SetRunInBackground_Internal(playerSettings, false);
                }
                return true;
            }
            else
            {
                throw new InvalidOperationException("Build profile has not been initialized.");
            }
        }

        private WXConvertCore.WXExportError CallDoExport(BuildProfile buildProfile, BuildOptions options)
        {
            WXEditorScriptObject config = UnityUtil.GetEditorConf();
            cacheConfig.ProjectConf = config.ProjectConf;
            cacheConfig.SDKOptions = config.SDKOptions;
            cacheConfig.CompileOptions = config.CompileOptions;
            cacheConfig.CompressTexture = config.CompressTexture;
            cacheConfig.PlayerPrefsKeys = config.PlayerPrefsKeys;
            cacheConfig.FontOptions = config.FontOptions;

            if (!ApplyMiniGameSettingsToConfig(buildProfile, options, config))
            {
                return WXConvertCore.WXExportError.BUILD_WEBGL_FAILED;
            }

            Debug.LogFormat("[WX][BuildProfile] Apply settings to MiniGameConfig. DST={0}, relativeDST={1}, enableRenderThread={2}",
                config.ProjectConf != null ? config.ProjectConf.DST : "null",
                config.ProjectConf != null ? config.ProjectConf.relativeDST : "null",
                config.CompileOptions != null ? config.CompileOptions.enableRenderThread.ToString() : "null");
            EditorUtility.SetDirty(config);
            AssetDatabase.SaveAssets();
            return WXConvertCore.DoExport();
        }

        private void BuildPostProcess(BuildProfile buildProfile)
        {
            // Restore the original settings
            WXEditorScriptObject config = UnityUtil.GetEditorConf();
            config.ProjectConf = cacheConfig.ProjectConf;
            config.SDKOptions = cacheConfig.SDKOptions;
            config.CompileOptions = cacheConfig.CompileOptions;
            config.CompressTexture = cacheConfig.CompressTexture;
            config.PlayerPrefsKeys = cacheConfig.PlayerPrefsKeys;
            config.FontOptions = cacheConfig.FontOptions;
            EditorUtility.SetDirty(config);
            AssetDatabase.SaveAssets();
            Debug.Log("[WX][BuildProfile] MiniGameConfig restored after BuildProfile build.");
        }

    }
}
#endif
