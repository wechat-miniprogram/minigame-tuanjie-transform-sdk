#if TUANJIE_1_4_OR_NEWER
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

            var bcLibPath = Path.GetFullPath(Path.Combine("Packages", "com.qq.weixin.minigame", "Editor", "BuildProfile", "lib", "libwx-metal-cpp.bc"));
            var jsLibPath = Path.GetFullPath(Path.Combine("Packages", "com.qq.weixin.minigame", "Editor", "BuildProfile", "lib", "mtl_library.jslib"));
            string libPath = bcLibPath + ';' + jsLibPath;
            EditorUtility.SetMiniGameGfxLibraryPath(libPath);

            WeixinMiniGameSettings settings = buildProfile.miniGameSettings as WeixinMiniGameSettings;

            BuildMiniGameError buildMiniGameError = BuildMiniGameError.Unknown;
            bool preprocessSuccess = WechatBuildPreprocess(buildProfile);
            if (!preprocessSuccess)
            {
                return BuildMiniGameError.InvalidInput;
            }

            if (settings is not null)
            {
                settings.FillAutoStreamingAutomatically();
                if (settings.PreprocessBuild(buildProfile, options))
                {

                    var error = CallDoExport(buildProfile);
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
                }
            }
            BuildPostProcess(buildProfile);
            return buildMiniGameError;
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

                    PlayerSettings.MiniGame.SetThreadsSupport_Internal(playerSettings, false);
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

        private WXConvertCore.WXExportError CallDoExport(BuildProfile buildProfile)
        {
            WXEditorScriptObject config = UnityUtil.GetEditorConf();
            cacheConfig.ProjectConf = config.ProjectConf;
            cacheConfig.SDKOptions = config.SDKOptions;
            cacheConfig.CompileOptions = config.CompileOptions;
            cacheConfig.CompressTexture = config.CompressTexture;
            cacheConfig.PlayerPrefsKeys = config.PlayerPrefsKeys;
            cacheConfig.FontOptions = config.FontOptions;

            WeixinMiniGameSettings weixinSettings = buildProfile.miniGameSettings as WeixinMiniGameSettings;
            config.ProjectConf = weixinSettings.ProjectConf;
            config.SDKOptions = weixinSettings.SDKOptions;
            config.CompileOptions = weixinSettings.CompileOptions;
            config.CompressTexture = weixinSettings.CompressTexture;
            config.PlayerPrefsKeys = weixinSettings.PlayerPrefsKeys;
            config.FontOptions = weixinSettings.FontOptions;
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
        }

    }
}
#endif
