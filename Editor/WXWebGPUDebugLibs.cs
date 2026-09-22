using System.IO;
using UnityEditor;
using UnityEngine;

namespace WeChatWASM
{
    // 微信 WebGPU SDK debug 模式：切换链接 -debug 静态库。
    // debug 库下 adapter 会在创建对象后补发 ObjectSetLabel，validation error 消息里能带上对象 label
    // （SDK README Q11）；引擎侧通过 wgpu_device_set_uncapturederror_callback 把错误打到日志。
    // 开关直接落在四个 .a 的 .meta（WeixinMiniGame enabled），引擎按 meta 决定链接哪一份。
    // 入口：转换面板「调试编译选项 / WebGPU Debug 库」（WXEditorSettingHelper）。
    public static class WXWebGPUDebugLibs
    {
        private static readonly string[] ReleaseLibs = { "libwxwgpu-core.a", "libwxwgpu-adapter-emsdk-legacy.a" };
        private static readonly string[] DebugLibs = { "libwxwgpu-core-debug.a", "libwxwgpu-adapter-emsdk-legacy-debug.a" };

        private static string PluginsDir =>
            UnityUtil.GetSDKMode() == UnityUtil.SDKMode.Package
                ? "Packages/com.qq.weixin.minigame/Runtime/Plugins/"
                : "Assets/WX-WASM-SDK-V2/Runtime/Plugins/";

        public static bool Enabled
        {
            get
            {
                var importer = AssetImporter.GetAtPath(PluginsDir + DebugLibs[0]) as PluginImporter;
                return importer != null && importer.GetCompatibleWithPlatform(BuildTarget.WeixinMiniGame);
            }
        }

        public static void Set(bool debug)
        {
            foreach (var lib in ReleaseLibs) SetLib(lib, !debug);
            foreach (var lib in DebugLibs) SetLib(lib, debug);
            AssetDatabase.SaveAssets();
            UnityEngine.Debug.Log("[WX WebGPU] 链接 " + (debug ? "debug" : "release") + " SDK 静态库");
        }

        private static void SetLib(string lib, bool enabled)
        {
            string path = PluginsDir + lib;
            var importer = AssetImporter.GetAtPath(path) as PluginImporter;
            if (importer == null)
            {
                UnityEngine.Debug.LogError("[WX WebGPU] 找不到 " + path);
                return;
            }

            // WeixinMiniGame 是虚拟构建 target，PluginImporter.SetCompatibleWithPlatform +
            // SaveAndReimport 的改动不会持久化，读回 Enabled 仍是旧值（表现为面板勾选立即被重置）。
            // 与 WXConvertCore.SetPluginCompatibilityByModifyingMetadataFile 一致：
            // 直接改写 .meta 里 WeixinMiniGame 段的 enabled 标志，再 ForceUpdate 重导入。
            try
            {
                string metaPath = AssetDatabase.GetTextMetaFilePathFromAssetPath(path);
                string metaContent = File.ReadAllText(metaPath);
                int tagIdx = metaContent.IndexOf("WeixinMiniGame: WeixinMiniGame");
                int enabledIdx = tagIdx >= 0 ? metaContent.IndexOf("enabled: ", tagIdx) : -1;
                if (enabledIdx < 0)
                {
                    UnityEngine.Debug.LogError("[WX WebGPU] " + metaPath + " 中找不到 WeixinMiniGame enabled 标志");
                    return;
                }
                enabledIdx += "enabled: ".Length;
                metaContent = metaContent.Remove(enabledIdx, 1).Insert(enabledIdx, enabled ? "1" : "0");
                File.WriteAllText(metaPath, metaContent);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceUpdate);
            }
            catch (System.Exception ex)
            {
                UnityEngine.Debug.LogError("[WX WebGPU] 切换 " + path + " 失败: " + ex.Message);
            }
        }
    }
}
