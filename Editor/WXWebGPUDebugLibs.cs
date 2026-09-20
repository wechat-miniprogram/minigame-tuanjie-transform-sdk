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
            importer.SetCompatibleWithPlatform(BuildTarget.WeixinMiniGame, enabled);
            importer.SetExcludeFromAnyPlatform(BuildTarget.WeixinMiniGame, !enabled);
            importer.SaveAndReimport();
        }
    }
}
