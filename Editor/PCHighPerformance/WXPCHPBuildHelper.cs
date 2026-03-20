using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEditor;
using UnityEditor.Build.Reporting;

namespace WeChatWASM
{
    /// <summary>
    /// PC高性能小游戏构建辅助类
    /// 用于在微信小游戏转换工具面板中集成PC高性能模式构建
    /// </summary>
    public static class WXPCHPBuildHelper
    {
        /// <summary>
        /// PC高性能构建产物目录名
        /// </summary>
        public const string PCHPOutputDir = "pchpcode";

        /// <summary>
        /// 检查是否开启了PC高性能模式
        /// </summary>
        public static bool IsPCHighPerformanceEnabled()
        {
            var config = UnityUtil.GetEditorConf();
            bool enabled = config != null && config.ProjectConf.EnablePCHighPerformance;
            Debug.Log($"[PC高性能模式] 检查配置: config={config != null}, EnablePCHighPerformance={config?.ProjectConf?.EnablePCHighPerformance}, 结果={enabled}");
            return enabled;
        }

        /// <summary>
        /// 执行PC高性能构建
        /// </summary>
        /// <param name="exportBasePath">导出基础路径（来自小游戏面板配置）</param>
        /// <returns>构建是否成功</returns>
        public static bool BuildPCHighPerformance(string exportBasePath)
        {
            if (string.IsNullOrEmpty(exportBasePath))
            {
                Debug.LogError("[PC高性能模式] 导出路径为空，无法构建");
                return false;
            }

            // 确定构建目标平台
            var currentPlatform = Application.platform;
            BuildTarget buildTarget;
            string platformName;

            if (currentPlatform == RuntimePlatform.OSXEditor)
            {
                buildTarget = BuildTarget.StandaloneOSX;
                platformName = "Mac";
            }
            else
            {
                buildTarget = BuildTarget.StandaloneWindows64;
                platformName = "Windows";
            }

            // 构建输出路径：直接放在 minigame/pchpcode 目录下
            string pchpOutputPath = Path.Combine(exportBasePath, WXConvertCore.miniGameDir, PCHPOutputDir);

            Debug.Log($"[PC高性能模式] 开始构建，目标平台: {platformName}");
            Debug.Log($"[PC高性能模式] 输出路径: {pchpOutputPath}");

            // 保存当前构建目标
            var originalTarget = EditorUserBuildSettings.activeBuildTarget;
            var originalTargetGroup = EditorUserBuildSettings.selectedBuildTargetGroup;

            try
            {
                // 切换构建目标（如果需要）
                if (originalTarget != buildTarget)
                {
                    Debug.Log($"[PC高性能模式] 切换构建目标: {originalTarget} -> {buildTarget}");
                    if (!EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Standalone, buildTarget))
                    {
                        Debug.LogError("[PC高性能模式] 切换构建目标失败");
                        return false;
                    }
                }

                // 配置 Player Settings
                ConfigurePlayerSettings();

                // 确保输出目录存在
                if (!Directory.Exists(pchpOutputPath))
                {
                    Directory.CreateDirectory(pchpOutputPath);
                }

                // 获取可执行文件路径
                string executablePath = GetExecutablePath(pchpOutputPath, buildTarget);

                // 获取场景列表
                var scenes = GetEnabledScenes();
                if (scenes.Length == 0)
                {
                    Debug.LogError("[PC高性能模式] 没有启用的场景，请在 Build Settings 中添加场景");
                    EditorUtility.DisplayDialog("PC高性能模式构建失败", "没有启用的场景，请在 Build Settings 中添加场景", "确定");
                    return false;
                }

                // 构建选项
                var buildOptions = BuildOptions.None;

                // 执行构建
                Debug.Log($"[PC高性能模式] 执行构建，输出: {executablePath}");
                var report = BuildPipeline.BuildPlayer(scenes, executablePath, buildTarget, buildOptions);

                // 检查构建结果
                if (report.summary.result == BuildResult.Succeeded)
                {
                    Debug.Log($"[PC高性能模式] 构建成功! 耗时: {report.summary.totalTime.TotalSeconds:F2}秒");
                    Debug.Log($"[PC高性能模式] 输出路径: {pchpOutputPath}");

                    // 打包成 wxapkg 格式（先打包到临时位置）
                    string tempWxapkgPath = Path.Combine(exportBasePath, WXConvertCore.miniGameDir, $"{PCHPOutputDir}_temp.wxapkg");
                    string finalWxapkgPath = Path.Combine(pchpOutputPath, $"{PCHPOutputDir}.wxapkg");

                    Debug.Log($"[PC高性能模式] 开始打包 wxapkg...");

                    if (WXApkgPacker.Pack(pchpOutputPath, tempWxapkgPath))
                    {
                        // 删除原始构建材料
                        Debug.Log($"[PC高性能模式] 清理原始构建材料...");
                        Directory.Delete(pchpOutputPath, true);

                        // 重新创建目录并移动 wxapkg
                        Directory.CreateDirectory(pchpOutputPath);
                        File.Move(tempWxapkgPath, finalWxapkgPath);

                        Debug.Log($"[PC高性能模式] wxapkg 打包完成: {finalWxapkgPath}");
                    }
                    else
                    {
                        Debug.LogWarning("[PC高性能模式] wxapkg 打包失败，保留原始构建产物");
                        if (File.Exists(tempWxapkgPath))
                        {
                            File.Delete(tempWxapkgPath);
                        }
                    }

                    return true;
                }
                else
                {
                    Debug.LogError($"[PC高性能模式] 构建失败: {report.summary.result}");
                    foreach (var step in report.steps)
                    {
                        foreach (var message in step.messages)
                        {
                            if (message.type == LogType.Error)
                            {
                                Debug.LogError($"[PC高性能模式] 构建错误: {message.content}");
                            }
                        }
                    }
                    return false;
                }
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[PC高性能模式] 构建异常: {e.Message}");
                Debug.LogException(e);
                return false;
            }
            finally
            {
                // 始终恢复到 WebGL 构建目标，确保微信小游戏转换工具能正常加载
                if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.WebGL)
                {
                    Debug.Log($"[PC高性能模式] 切换回 WebGL 构建目标");
                    EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WebGL, BuildTarget.WebGL);
                }
            }
        }

        /// <summary>
        /// 配置 Player Settings 用于 PC 高性能构建
        /// </summary>
        private static void ConfigurePlayerSettings()
        {
            // 设置窗口模式
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;

            // 设置默认分辨率
            PlayerSettings.defaultScreenWidth = 1280;
            PlayerSettings.defaultScreenHeight = 720;

            // 允许调整窗口大小
            PlayerSettings.resizableWindow = true;

            // 处理 Windows 上 Linear 色彩空间与图形 API 的兼容性问题
            if (Application.platform == RuntimePlatform.WindowsEditor)
            {
                ConfigureWindowsGraphicsAPI();
            }

            Debug.Log("[PC高性能模式] Player Settings 配置完成");
        }

        /// <summary>
        /// 配置 Windows 图形 API，解决 Linear 色彩空间兼容性问题
        /// </summary>
        private static void ConfigureWindowsGraphicsAPI()
        {
            // 检查当前色彩空间
            bool isLinear = PlayerSettings.colorSpace == ColorSpace.Linear;

            if (isLinear)
            {
                // Linear 色彩空间需要 DX11 或更高版本
                // 禁用自动图形 API，手动指定兼容的 API
                PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.StandaloneWindows64, false);

                var graphicsAPIs = new UnityEngine.Rendering.GraphicsDeviceType[]
                {
                    UnityEngine.Rendering.GraphicsDeviceType.Direct3D11,
                    UnityEngine.Rendering.GraphicsDeviceType.Direct3D12,
                    UnityEngine.Rendering.GraphicsDeviceType.Vulkan
                };

                PlayerSettings.SetGraphicsAPIs(BuildTarget.StandaloneWindows64, graphicsAPIs);
                Debug.Log("[PC高性能模式] 已配置 Windows 图形 API: D3D11, D3D12, Vulkan（Linear 色彩空间兼容）");
            }
            else
            {
                // Gamma 色彩空间，使用默认图形 API 即可
                PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.StandaloneWindows64, true);
                Debug.Log("[PC高性能模式] 使用默认 Windows 图形 API（Gamma 色彩空间）");
            }
        }

        /// <summary>
        /// 获取可执行文件路径
        /// </summary>
        private static string GetExecutablePath(string outputPath, BuildTarget target)
        {
            string productName = PlayerSettings.productName;
            if (string.IsNullOrEmpty(productName))
            {
                productName = "Game";
            }

            if (target == BuildTarget.StandaloneOSX)
            {
                return Path.Combine(outputPath, $"{productName}.app");
            }
            else
            {
                return Path.Combine(outputPath, $"{productName}.exe");
            }
        }

        /// <summary>
        /// 获取启用的场景列表
        /// </summary>
        private static string[] GetEnabledScenes()
        {
            var scenes = new List<string>();
            foreach (var scene in EditorBuildSettings.scenes)
            {
                if (scene.enabled)
                {
                    scenes.Add(scene.path);
                }
            }
            return scenes.ToArray();
        }
    }
}
