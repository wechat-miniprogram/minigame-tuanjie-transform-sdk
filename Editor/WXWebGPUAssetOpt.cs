using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace WeChatWASM
{
    /// <summary>
    /// 微信小游戏 WebGPU 资源优化双开关管理与构建期后处理：
    ///   1. ZeroCostEnabled   — 零运行时成本方案（ASTC 有界扩色+RDO40 / Mesh M1_12bit / Anim A1_12bit）
    ///   2. ComputeOptEnabled — WebGPU Compute 超压缩方案（Mesh WXMSH2/WXIDX2 + ASTC S3 WXASTC + 注入 __wxComputeAssetOpt）
    /// 状态持久化于 ProjectSettings/WXWebGPUAssetOpt.json，不改动 wx-runtime-editor.dll 序列化结构。
    /// </summary>
    public static class WXWebGPUAssetOpt
    {
        [Serializable]
        private class OptConfig
        {
            public bool zeroCostEnabled = false;
            public bool computeOptEnabled = false;
        }

        private static string ConfigPath =>
            Path.Combine(Directory.GetParent(Application.dataPath).FullName, "ProjectSettings", "WXWebGPUAssetOpt.json");

        private static OptConfig LoadConfig()
        {
            try
            {
                if (File.Exists(ConfigPath))
                {
                    return JsonUtility.FromJson<OptConfig>(File.ReadAllText(ConfigPath, Encoding.UTF8)) ?? new OptConfig();
                }
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning("[WX WebGPU AssetOpt] 读取配置失败: " + ex.Message);
            }
            return new OptConfig();
        }

        private static void SaveConfig(OptConfig cfg)
        {
            try
            {
                string dir = Path.GetDirectoryName(ConfigPath);
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(ConfigPath, JsonUtility.ToJson(cfg, true), Encoding.UTF8);
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogError("[WX WebGPU AssetOpt] 保存配置失败: " + ex.Message);
            }
        }

        public static bool ZeroCostEnabled
        {
            get => LoadConfig().zeroCostEnabled;
            set
            {
                var cfg = LoadConfig();
                if (cfg.zeroCostEnabled == value) return;
                cfg.zeroCostEnabled = value;
                SaveConfig(cfg);
                UnityEngine.Debug.Log("[WX WebGPU AssetOpt] 零运行时成本瘦身 (RDO40/M1/A1): " + (value ? "已开启" : "已关闭"));
            }
        }

        public static bool ComputeOptEnabled
        {
            get => LoadConfig().computeOptEnabled;
            set
            {
                var cfg = LoadConfig();
                if (cfg.computeOptEnabled == value) return;
                cfg.computeOptEnabled = value;
                SaveConfig(cfg);
                UnityEngine.Debug.Log("[WX WebGPU AssetOpt] WebGPU Compute 资源超压缩 (WXMSH2/WXASTC): " + (value ? "已开启" : "已关闭"));
            }
        }

        public static void SetZeroCost(bool enabled) => ZeroCostEnabled = enabled;
        public static void SetComputeOpt(bool enabled) => ComputeOptEnabled = enabled;

        private static string GetOptimizerScriptPath()
        {
            return Path.Combine(UnityUtil.GetWxSDKRootPath(), "Editor/TextureEditor/Node/wxwgpu_asset_opt.py");
        }

        private static string FindPythonExecutable()
        {
            string envPy = Environment.GetEnvironmentVariable("WXWGPU_PYTHON");
            if (!string.IsNullOrEmpty(envPy) && File.Exists(envPy)) return envPy;

            string[] candidates =
            {
                "/tmp/texvenv/bin/python",
                "/opt/homebrew/bin/python3",
                "/usr/local/bin/python3",
                "/usr/bin/python3",
                "python3",
                "python"
            };
            foreach (var c in candidates)
            {
                if (c.StartsWith("/") && File.Exists(c)) return c;
            }
            return Application.platform == RuntimePlatform.WindowsEditor ? "python" : "python3";
        }

        /// <summary>
        /// 在生成 MD5 与 Brotli 压缩前，对首包 webgl.data 及 StreamingAssets 下的 AB 包执行后处理。
        /// </summary>
        public static void ProcessBundleAssets(string dataFilePath, string streamingAssetsDir, bool isWebGPU)
        {
            bool doZeroCost = ZeroCostEnabled;
            bool doCompute = ComputeOptEnabled && isWebGPU;
            if (!doZeroCost && !doCompute) return;

            string scriptPath = GetOptimizerScriptPath();
            if (!File.Exists(scriptPath))
            {
                UnityEngine.Debug.LogWarning("[WX WebGPU AssetOpt] 找不到后处理脚本: " + scriptPath);
                return;
            }

            var args = new StringBuilder();
            args.AppendFormat("\"{0}\"", scriptPath);
            if (!string.IsNullOrEmpty(dataFilePath) && File.Exists(dataFilePath))
            {
                args.AppendFormat(" --input \"{0}\"", dataFilePath);
            }
            if (!string.IsNullOrEmpty(streamingAssetsDir) && Directory.Exists(streamingAssetsDir))
            {
                args.AppendFormat(" --ab-dir \"{0}\"", streamingAssetsDir);
            }
            if (doZeroCost) args.Append(" --zero-cost");
            if (doCompute) args.Append(" --compute-opt");

            try
            {
                var p = new Process();
                p.StartInfo.FileName = FindPythonExecutable();
                p.StartInfo.Arguments = args.ToString();
                p.StartInfo.UseShellExecute = false;
                p.StartInfo.RedirectStandardOutput = true;
                p.StartInfo.RedirectStandardError = true;
                p.StartInfo.CreateNoWindow = true;
                p.Start();

                string stdout = p.StandardOutput.ReadToEnd();
                string stderr = p.StandardError.ReadToEnd();
                p.WaitForExit();
                int exitCode = p.ExitCode;
                p.Close();

                if (!string.IsNullOrEmpty(stdout))
                {
                    UnityEngine.Debug.Log(stdout.Trim());
                }
                if (exitCode != 0)
                {
                    UnityEngine.Debug.LogWarning("[WX WebGPU AssetOpt] 后处理退出码 " + exitCode + ": " + stderr);
                }
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning("[WX WebGPU AssetOpt] 执行后处理异常（已自动跳过）: " + ex.Message);
            }
        }

        /// <summary>
        /// 当开启 ComputeOptEnabled 时，向小游戏 game.js 顶部注入一次性启动开关 GameGlobal.__wxComputeAssetOpt = true;
        /// 未开启时不注入任何内容，确保 libwxwgpu-*.a 对常态项目零开销。
        /// </summary>
        public static void InjectGameJsSwitch(string minigameRootDir, bool isWebGPU)
        {
            if (!isWebGPU || !ComputeOptEnabled || string.IsNullOrEmpty(minigameRootDir)) return;

            string gameJsPath = Path.Combine(minigameRootDir, "game.js");
            if (!File.Exists(gameJsPath)) return;

            const string flagLine = "GameGlobal.__wxComputeAssetOpt = true;";
            string content = File.ReadAllText(gameJsPath, Encoding.UTF8);
            if (!content.Contains("__wxComputeAssetOpt"))
            {
                File.WriteAllText(gameJsPath, flagLine + "\n" + content, Encoding.UTF8);
                UnityEngine.Debug.Log("[WX WebGPU AssetOpt] 已向 game.js 注入 GameGlobal.__wxComputeAssetOpt = true");
            }
        }
    }
}
