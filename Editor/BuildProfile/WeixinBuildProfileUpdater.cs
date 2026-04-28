#if TUANJIE_1_6_OR_NEWER && !TUANJIE_1_8_OR_NEWER

using System.Collections.Generic;
using UnityEditor;
using UnityEditor.ExternalMiniGame;
using UnityEngine;

namespace WeChatWASM
{
    [InitializeOnLoad]
    public class WeixinBuildProfileUpdater
    {
        static WeixinBuildProfileUpdater()
        {
            UpdateBuildProfile();
        }

        public static void UpdateBuildProfile()
        {
            string buildProfilePath = "Assets/Settings/Build Profiles";
            if (!AssetDatabase.IsValidFolder(buildProfilePath))
            {
                return;
            }

            string[] guids = AssetDatabase.FindAssets("t:BuildProfile", new[] { buildProfilePath });
            foreach (string guid in guids)
            {
                string assetPath = AssetDatabase.GUIDToAssetPath(guid);
                UnityEditor.Build.Profile.BuildProfile buildProfile = AssetDatabase.LoadAssetAtPath<UnityEditor.Build.Profile.BuildProfile>(assetPath);

                if (buildProfile != null)
                {
                    bool isDefaultWeixinSettings = buildProfile.miniGameSettings is DefaultWeChatMiniGameSettings;

                    // If use DefaultWeChatMiniGameSettings, convert to WeixinMiniGameSettings
                    if (isDefaultWeixinSettings)
                    {
                        var oldSettings = (DefaultWeChatMiniGameSettings)buildProfile.miniGameSettings;
                        var editor = new WeixinMiniGameSettingsEditor();
                        var newSettings = new WeixinMiniGameSettings(editor);

                        newSettings.ProjectConf = new WXProjectConf();
                        newSettings.SDKOptions = new SDKOptions();
                        newSettings.CompileOptions = new CompileOptions();
                        newSettings.CompressTexture = new CompressTexture();
                        newSettings.FontOptions = new FontOptions();

                        string projJson = JsonUtility.ToJson(oldSettings.ProjectConf, true);
                        JsonUtility.FromJsonOverwrite(projJson, newSettings.ProjectConf);
                        string sdkOptionsJson = JsonUtility.ToJson(oldSettings.SDKOptions, true);
                        JsonUtility.FromJsonOverwrite(sdkOptionsJson, newSettings.SDKOptions);
                        string compileOptionsJson = JsonUtility.ToJson(oldSettings.CompileOptions, true);
                        JsonUtility.FromJsonOverwrite(compileOptionsJson, newSettings.CompileOptions);
                        string compressTextureJson = JsonUtility.ToJson(oldSettings.CompressTexture, true);
                        JsonUtility.FromJsonOverwrite(compressTextureJson, newSettings.CompressTexture);
                        string fontOptionsJson = JsonUtility.ToJson(oldSettings.FontOptions, true);
                        JsonUtility.FromJsonOverwrite(fontOptionsJson, newSettings.FontOptions);

                        var property = typeof(UnityEditor.Build.Profile.BuildProfile).GetProperty("miniGameSettings",
                            System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
                        property.SetValue(buildProfile, newSettings);
                        buildProfile.miniGameSettings = newSettings;

                        EditorUtility.SetDirty(buildProfile);
                        AssetDatabase.SaveAssets();
                        AssetDatabase.ImportAsset(AssetDatabase.GetAssetPath(buildProfile));

                    }

                }
            }
        }

    }

}
#endif