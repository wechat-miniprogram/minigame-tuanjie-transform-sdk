using UnityEditor;
using System;
using System.Reflection;
using System.IO;
/*
public class WXAssetPostprocessor : AssetPostprocessor
{
    private static void OnPostprocessAllAssets(string[] importedAssets, string[] deletedAssets, string[] movedAssets, string[] movedFromAssetPaths)
    {
        foreach (string asset in importedAssets)
        {
            ProcessWxPerfPluginAsset(asset);
        }
    }

    public static bool EnableWXPostProcess = false;

    static void ProcessWxPerfPluginAsset(string wxPerfPluginAsset)
    {
        PluginImporter importer = AssetImporter.GetAtPath(wxPerfPluginAsset) as PluginImporter;
        if (importer == null) return;

        // 判断是否是wx_perf_2022.a/o文件
        if (wxPerfPluginAsset.Contains("wx_perf_2022.a"))
        {
            if (IsCompatibleWithUnity202203OrNewer() && EnableWXPostProcess)
            {
#if PLATFORM_WEIXINMINIGAME
                if (importer.GetCompatibleWithPlatform(BuildTarget.WeixinMiniGame))
#else
                if (importer.GetCompatibleWithPlatform(BuildTarget.WebGL))
#endif
                {
                    return;
                }
                EnablePluginAsset(wxPerfPluginAsset);
                AssetDatabase.Refresh();
            }
            else
            {
                RemovePluginAssetAllCompatibility(wxPerfPluginAsset);
            }

            return; 
        }


        // 判断是否是wx_perf_2021.a/o文件
        if (wxPerfPluginAsset.Contains("wx_perf_2021.a"))
        {
            if (IsCompatibleWithUnity202103To202203() && EnableWXPostProcess)
            {
                // UnityEngine.Debug.Log($"Before --- WebGL: {importer.GetCompatibleWithPlatform(BuildTarget.WebGL)}, Editor: {importer.GetCompatibleWithEditor()}");
#if PLATFORM_WEIXINMINIGAME
                if (importer.GetCompatibleWithPlatform(BuildTarget.WeixinMiniGame))
#else
                if (importer.GetCompatibleWithPlatform(BuildTarget.WebGL))
#endif
                {
                    return;
                }

                EnablePluginAsset(wxPerfPluginAsset);
                // UnityEngine.Debug.Log($"After --- WebGL: {importer.GetCompatibleWithPlatform(BuildTarget.WebGL)}, Editor: {importer.GetCompatibleWithEditor()}");

                AssetDatabase.Refresh();
            }
            else
            {
                RemovePluginAssetAllCompatibility(wxPerfPluginAsset);
            }

            return; 
        }

        if (wxPerfPluginAsset.Contains("WxPerfJsBridge.jslib"))
        {
            if (EnableWXPostProcess)
            {
                // UnityEngine.Debug.Log($"Before --- WebGL: {importer.GetCompatibleWithPlatform(BuildTarget.WebGL)}, Editor: {importer.GetCompatibleWithEditor()}");
#if PLATFORM_WEIXINMINIGAME
                if (importer.GetCompatibleWithPlatform(BuildTarget.WeixinMiniGame))
#else
                if (importer.GetCompatibleWithPlatform(BuildTarget.WebGL))
#endif
                {
                    return;
                }

                EnablePluginAsset(wxPerfPluginAsset);
                // UnityEngine.Debug.Log($"After --- WebGL: {importer.GetCompatibleWithPlatform(BuildTarget.WebGL)}, Editor: {importer.GetCompatibleWithEditor()}");

                AssetDatabase.Refresh();
            }
            else
            {
                RemovePluginAssetAllCompatibility(wxPerfPluginAsset);
            }

            return;
        }
        


    }

    static bool IsCompatibleWithUnity202203OrNewer()
    {
#if UNITY_2022_3_OR_NEWER
        return true;
#endif
        return false;
    }

    static bool IsCompatibleWithUnity202103To202203()
    {
#if UNITY_2022_3_OR_NEWER
        return false;
#endif

#if !UNITY_2021_3_OR_NEWER
        return false;
#endif

        return true;
    }


    private static void RemovePluginAssetAllCompatibility(string inAssetPath)
    {
        PluginImporter importer = AssetImporter.GetAtPath(inAssetPath) as PluginImporter;

#if PLATFORM_WEIXINMINIGAME
        importer.SetCompatibleWithPlatform(BuildTarget.WeixinMiniGame, false);
#else
        importer.SetCompatibleWithPlatform(BuildTarget.WebGL, false);
#endif

        AssetDatabase.WriteImportSettingsIfDirty(inAssetPath);
    }

    private static bool IsPluginAssetValid(PluginImporter inPluginImporter)
    {
        if (inPluginImporter == null) return false;

        if (inPluginImporter.GetCompatibleWithEditor()) return true;

        foreach (BuildTarget target in Enum.GetValues(typeof(BuildTarget)))
        {
            if (inPluginImporter.GetCompatibleWithPlatform(target))
            {
                return true;
            }
        }

        return false;
    }

    private static void EnablePluginAsset(string inAssetPath)
    {
        PluginImporter importer = AssetImporter.GetAtPath(inAssetPath) as PluginImporter;
#if PLATFORM_WEIXINMINIGAME
        importer.SetCompatibleWithPlatform(BuildTarget.WeixinMiniGame, EnableWXPostProcess);
#else
        importer.SetCompatibleWithPlatform(BuildTarget.WebGL, EnableWXPostProcess);
#endif
        AssetDatabase.WriteImportSettingsIfDirty(inAssetPath);
    }

    private static int GetEnabledFlagStringIndex(string inAllText, string inTagStr)
    {
        int tagStrIdx = inAllText.IndexOf(inTagStr);

        int enabledStrIdx = inAllText.IndexOf("enabled: ", tagStrIdx);

        // inAllText[enabledStrIdx] == 'e'
        // And that is to say, inAllText[enabledStrIdx + 9] should be 0 or 1
        return enabledStrIdx + 9;
    }
}
*/