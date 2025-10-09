#if TUANJIE_1_4_OR_NEWER
using System;
using System.IO;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using UnityEditor;
using UnityEngine;
using UnityEditor.Build.Profile;

namespace WeChatWASM
{
    public class WeixinMiniGameSettings : MiniGameSettings
    {
        public WXProjectConf ProjectConf;
        public SDKOptions SDKOptions;
        public CompileOptions CompileOptions;
        public CompressTexture CompressTexture;
        public List<string> PlayerPrefsKeys = new List<string>();
        public FontOptions FontOptions;

        [SerializeField] public bool m_AutomaticFillInstantGame = true;

        public WeixinMiniGameSettings(MiniGameSettingsEditor editor) : base(editor)
        {
        }

        public bool PreprocessBuild(BuildProfile buildProfile, BuildOptions options)
        {
            bool result = true;
            if (!string.IsNullOrEmpty(buildProfile.buildPath))
            {
                this.ProjectConf.DST = buildProfile.buildPath;
            }
            else
            {
                Debug.LogError("Build Path is empty!");
                result = false;
            }
            this.CompileOptions.DevelopBuild = buildProfile.platformSettings.development;
            this.CompileOptions.AutoProfile = buildProfile.platformSettings.connectProfiler;

            this.CompileOptions.CleanBuild = ((int)options & (int)BuildOptions.CleanBuildCache) != 0;
            this.CompileOptions.ScriptOnly = ((int)options & (int)BuildOptions.BuildScriptsOnly) != 0;

            return result;
        }

        internal void FillAutoStreamingAutomatically()
        {
            // Instant Game
            if (WXConvertCore.IsInstantGameAutoStreaming())
            {
                if (m_AutomaticFillInstantGame)
                {
                    ProjectConf.CDN = WXConvertCore.GetInstantGameAutoStreamingCDN();
                    if (!ProjectConf.bundlePathIdentifier.Contains("CUS/CustomAB;"))
                    {
                        ProjectConf.bundlePathIdentifier = "CUS/CustomAB;" + ProjectConf.bundlePathIdentifier;
                    }
                    if (!ProjectConf.bundlePathIdentifier.Contains("AS;"))
                    {
                        ProjectConf.bundlePathIdentifier = "AS;" + ProjectConf.bundlePathIdentifier;
                    }
                    ProjectConf.dataFileSubPrefix = "CUS";
                }
            }
        }

        public static void AutoStreamingLoad()
        {
            if (!WXConvertCore.IsInstantGameAutoStreaming())
            {
                return;
            }

            // Generate
            Type asTextureUIType = Type.GetType("Unity.AutoStreaming.ASTextureUI,Unity.InstantGame.Editor");
            if (asTextureUIType == null)
            {
                Debug.LogError("Type 'Unity.AutoStreaming.ASTextureUI' not found. ");
                return;
            }
            MethodInfo generateTextureAssetBundlesMethod = asTextureUIType.GetMethod("GenerateTextureAssetBundles", BindingFlags.NonPublic | BindingFlags.Static);
            generateTextureAssetBundlesMethod?.Invoke(null, new object[] { false });

            // reflection to get WXConvertCore.FirstBundlePath
            String FirstBundlePath = "";
            var type = Type.GetType("WeChatWASM.WXConvertCore,WxEditor");
            if (type == null)
            {
                Debug.LogError("Type 'WeChatWASM.WXConvertCore,WxEditor' not found. ");
                return;
            }
            FieldInfo fieldInfo = type.GetField("FirstBundlePath", BindingFlags.Public | BindingFlags.Static);
            if (fieldInfo != null)
            {
                FirstBundlePath = fieldInfo.GetValue(null) as String;
            }

            if (!string.IsNullOrEmpty(FirstBundlePath) && File.Exists(FirstBundlePath))
            {
                Type igBuildPipelineType = Type.GetType("Unity.InstantGame.IGBuildPipeline,Unity.InstantGame.Editor");
                if (igBuildPipelineType == null)
                {
                    Debug.LogError("Type 'Unity.InstantGame.IGBuildPipeline' not found. ");
                    return;
                }
                MethodInfo uploadMethod = igBuildPipelineType.GetMethod("UploadWeChatDataFile", BindingFlags.Public | BindingFlags.Static);

                bool returnValue = false;
                if (uploadMethod != null)
                {
                    object[] parameters = new object[] { FirstBundlePath };
                    object result = uploadMethod.Invoke(null, parameters);
                    returnValue = Convert.ToBoolean(result);
                }

                if (returnValue)
                {
                    Debug.Log("转换完成并成功上传首包资源");
                }
                else
                {
                    Debug.LogError("首包资源上传失败，请检查网络以及Auto Streaming配置是否正确。");
                }
            }
            else
            {
                Debug.LogError("转换失败");
            }
        }
    
    }
}
#endif
