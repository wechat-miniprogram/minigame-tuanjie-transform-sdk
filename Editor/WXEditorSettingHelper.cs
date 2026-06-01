using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
using System.IO;
using static WeChatWASM.WXConvertCore;
using System;
using System.Reflection;

namespace WeChatWASM
{

    [InitializeOnLoad]
    public class WXSettingsHelperInterface
    {
        public static WXSettingsHelper helper = new WXSettingsHelper();
    }

    public class WXSettingsHelper
    {
        public static string projectRootPath;

        public WXSettingsHelper()
        {
            Type weixinMiniGamePackageHelpersType = Type.GetType("UnityEditor.WeixinPackageHelpers,UnityEditor");
            if (weixinMiniGamePackageHelpersType != null)
            {
                EventInfo onSettingsGUIEvent = weixinMiniGamePackageHelpersType.GetEvent("OnPackageSettingsGUI");
                EventInfo onPackageFocusEvent = weixinMiniGamePackageHelpersType.GetEvent("OnPackageFocus");
                EventInfo onPackageLostFocusEvent = weixinMiniGamePackageHelpersType.GetEvent("OnPackageLostFocus");
                EventInfo onBuildButtonGUIEvent = weixinMiniGamePackageHelpersType.GetEvent("OnPackageBuildButtonGUI");

                if (onPackageFocusEvent != null)
                {
                    onPackageFocusEvent.AddEventHandler(null, new Action(OnFocus));
                }

                if (onPackageLostFocusEvent != null)
                {
                    onPackageLostFocusEvent.AddEventHandler(null, new Action(OnLostFocus));
                }
                if (onSettingsGUIEvent != null)
                {
                    onSettingsGUIEvent.AddEventHandler(null, new Action<EditorWindow>(OnSettingsGUI));
                }
                if (onBuildButtonGUIEvent != null)
                {
                    onBuildButtonGUIEvent.AddEventHandler(null, new Action<EditorWindow>(OnBuildButtonGUI));
                }

            }

            //loadData();
            foldInstantGame = WXConvertCore.IsInstantGameAutoStreaming();

            projectRootPath = System.IO.Path.GetFullPath(Application.dataPath + "/../");
        }

        private static WXEditorScriptObject config;
        private static bool m_EnablePerfTool = false;

        public void OnFocus()
        {
            loadData();
        }

        public void OnLostFocus()
        {
            saveData();
        }

        public void OnDisable()
        {
            EditorUtility.SetDirty(config);
        }

        public Texture tex;
        public void OnSettingsGUI(EditorWindow window)
        {
            PluginUpdateManager.CheckUpdateOnce();
            scrollRoot = EditorGUILayout.BeginScrollView(scrollRoot);

            GUIStyle linkStyle = GetLinkStyle();

            foldBaseInfo = EditorGUILayout.Foldout(foldBaseInfo, "基本信息");
            if (foldBaseInfo)
            {
                EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));
                OnSettingBaseInfo();
                OnSettingChooseFolder();
                EditorGUILayout.EndVertical();
            }

            foldLoadingConfig = EditorGUILayout.Foldout(foldLoadingConfig, "启动Loading配置");
            if (foldLoadingConfig)
            {
                EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));

                GUILayout.BeginHorizontal();
                string targetBg = "bgImageSrc";
                EditorGUILayout.LabelField(string.Empty, GUILayout.Width(10));
                tex = (Texture)EditorGUILayout.ObjectField("启动背景图/视频封面", tex, typeof(Texture2D), false);
                var currentBgSrc = AssetDatabase.GetAssetPath(tex);
                if (!string.IsNullOrEmpty(currentBgSrc) && currentBgSrc != this.formInputData[targetBg])
                {
                    this.formInputData[targetBg] = currentBgSrc;
                    this.saveData();
                }
                GUILayout.EndHorizontal();

                OnSettingLoadingConfig();

                EditorGUILayout.EndVertical();
            }

            foldSDKOptions = EditorGUILayout.Foldout(foldSDKOptions, "SDK功能选项");
            if (foldSDKOptions)
            {
                EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));
                OnSettingSDKOptions();
                EditorGUILayout.EndVertical();
            }

            foldDebugOptions = EditorGUILayout.Foldout(foldDebugOptions, "调试编译选项");
            if (foldDebugOptions)
            {
                OnSettingDebugOptions(true);
            }


#if UNITY_INSTANTGAME
            foldInstantGame = EditorGUILayout.Foldout(foldInstantGame, "Instant Game - AutoStreaming");
            if (foldInstantGame)
            {
                EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));
                this.formInput("bundlePathIdentifier", "Bundle Path Identifier");
                this.formInput("dataFileSubPrefix", "Data File Sub Prefix");

                EditorGUI.BeginDisabledGroup(true);
                this.formCheckbox("autoUploadFirstBundle", "构建后自动上传首包(?)", "仅在开启AutoStreaming生效", true);
                EditorGUI.EndDisabledGroup();

                GUILayout.BeginHorizontal();
                EditorGUILayout.LabelField(string.Empty, GUILayout.Width(10));
                GUILayout.Label(new GUIContent("清理AS配置(?)", "如需关闭AutoStreaming选用默认发布方案则需要清理AS配置项目。"), GUILayout.Width(140));
                EditorGUI.BeginDisabledGroup(WXConvertCore.IsInstantGameAutoStreaming());
                if(GUILayout.Button(new GUIContent("恢复"),GUILayout.Width(60))){
                    string identifier = config.ProjectConf.bundlePathIdentifier;
                    string[] identifiers = identifier.Split(";");
                    string idStr = "";
                    foreach (string id in identifiers)
                    {
                        if (id != "AS" && id != "CUS/CustomAB")
                        {
                            idStr += id + ";";
                        }
                    }
                    config.ProjectConf.bundlePathIdentifier = idStr.Trim(';');
                    if (config.ProjectConf.dataFileSubPrefix == "CUS")
                    {
                        config.ProjectConf.dataFileSubPrefix = "";
                    }
                    this.loadData();
                }
                EditorGUI.EndDisabledGroup();
                GUILayout.EndHorizontal();

                EditorGUILayout.BeginHorizontal();
                EditorGUILayout.LabelField(string.Empty);
                if (GUILayout.Button(new GUIContent("了解Instant Game AutoStreaming", ""), linkStyle))
                {
                    Application.OpenURL("https://github.com/wechat-miniprogram/minigame-unity-webgl-transform/blob/main/Design/InstantGameGuide.md");
                }
                EditorGUILayout.EndHorizontal();
                EditorGUILayout.EndVertical();
            }
#endif
            foldFontOptions = EditorGUILayout.Foldout(foldFontOptions, "字体配置");
            if (foldFontOptions)
            {
                EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));
                OnSettingFontOptions();
                EditorGUILayout.EndVertical();
            }

            EditorGUILayout.EndScrollView();
        }

        public void OnSettingsGUI(SerializedObject serializedObject, SerializedProperty miniGameProperty)
        {
            loadData(serializedObject, miniGameProperty);

            scrollRoot = EditorGUILayout.BeginScrollView(scrollRoot);

            GUIStyle linkStyle = GetLinkStyle();

            foldBaseInfo = EditorGUILayout.Foldout(foldBaseInfo, "基本信息");
            if (foldBaseInfo)
            {
                EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));
                OnSettingBaseInfo();
                EditorGUILayout.EndVertical();
            }

            foldLoadingConfig = EditorGUILayout.Foldout(foldLoadingConfig, "启动Loading配置");
            if (foldLoadingConfig)
            {
                EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));

                // Call saveData(serializedObject, miniGameProperty) not saveData()
                GUILayout.BeginHorizontal();
                string targetBg = "bgImageSrc";
                EditorGUILayout.LabelField(string.Empty, GUILayout.Width(10));
                tex = (Texture)EditorGUILayout.ObjectField("启动背景图/视频封面", tex, typeof(Texture2D), false);
                var currentBgSrc = AssetDatabase.GetAssetPath(tex);
                if (!string.IsNullOrEmpty(currentBgSrc) && currentBgSrc != formInputData[targetBg])
                {
                    formInputData[targetBg] = currentBgSrc;
                    saveData(serializedObject, miniGameProperty);
                }
                GUILayout.EndHorizontal();

                OnSettingLoadingConfig();

                EditorGUILayout.EndVertical();
            }

            foldSDKOptions = EditorGUILayout.Foldout(foldSDKOptions, "SDK功能选项");
            if (foldSDKOptions)
            {
                EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));
                OnSettingSDKOptions();
                EditorGUILayout.EndVertical();
            }

            foldDebugOptions = EditorGUILayout.Foldout(foldDebugOptions, "调试编译选项");
            if (foldDebugOptions)
            {
                OnSettingDebugOptions(false);
            }

            if (WXConvertCore.IsInstantGameAutoStreaming())
            {
                foldInstantGame = EditorGUILayout.Foldout(foldInstantGame, "Instant Game - AutoStreaming");
                if (foldInstantGame)
                {
                    EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));
                    formInput("bundlePathIdentifier", "Bundle Path Identifier");
                    formInput("dataFileSubPrefix", "Data File Sub Prefix");

                    EditorGUI.BeginDisabledGroup(true);
                    formCheckbox("autoUploadFirstBundle", "构建后自动上传首包(?)", "仅在开启AutoStreaming生效", true);
                    EditorGUI.EndDisabledGroup();

                    GUILayout.BeginHorizontal();
                    EditorGUILayout.LabelField(string.Empty, GUILayout.Width(10));
                    GUILayout.Label(new GUIContent("清理AS配置(?)", "如需关闭AutoStreaming选用默认发布方案则需要清理AS配置项目。"), GUILayout.Width(140));
                    EditorGUI.BeginDisabledGroup(WXConvertCore.IsInstantGameAutoStreaming());
                    // It is not same as OnSettingsGUI(EditorWindow)
                    if (GUILayout.Button(new GUIContent("恢复"), GUILayout.Width(60)))
                    {
                        var ProjectConf = miniGameProperty.FindPropertyRelative("ProjectConf");
                        string identifier = ProjectConf.FindPropertyRelative("bundlePathIdentifier").stringValue;
                        string[] identifiers = identifier.Split(";");
                        string idStr = "";
                        foreach (string id in identifiers)
                        {
                            if (id != "AS" && id != "CUS/CustomAB")
                            {
                                idStr += id + ";";
                            }
                        }
                        ProjectConf.FindPropertyRelative("bundlePathIdentifier").stringValue = idStr.Trim(';');

                        if (ProjectConf.FindPropertyRelative("dataFileSubPrefix").stringValue == "CUS")
                        {
                            ProjectConf.FindPropertyRelative("dataFileSubPrefix").stringValue = "";
                        }
                        loadData(serializedObject, miniGameProperty);
                    }
                    EditorGUI.EndDisabledGroup();
                    GUILayout.EndHorizontal();

                    EditorGUILayout.BeginHorizontal();
                    EditorGUILayout.LabelField(string.Empty);
                    if (GUILayout.Button(new GUIContent("了解Instant Game AutoStreaming", ""), linkStyle))
                    {
                        Application.OpenURL("https://github.com/wechat-miniprogram/minigame-unity-webgl-transform/blob/main/Design/InstantGameGuide.md");
                    }
                    EditorGUILayout.EndHorizontal();
                    EditorGUILayout.EndVertical();
                }
            }

            foldFontOptions = EditorGUILayout.Foldout(foldFontOptions, "字体配置");
            if (foldFontOptions)
            {
                EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));
                OnSettingFontOptions();
                EditorGUILayout.EndVertical();
            }

            EditorGUILayout.EndScrollView();
            saveData(serializedObject, miniGameProperty);
        }

        private GUIStyle GetLinkStyle()
        {
            GUIStyle linkStyle = new GUIStyle(GUI.skin.label);
            linkStyle.normal.textColor = Color.yellow;
            linkStyle.hover.textColor = Color.yellow;
            linkStyle.stretchWidth = false;
            linkStyle.alignment = TextAnchor.UpperLeft;
            linkStyle.wordWrap = true;
            return linkStyle;
        }

        private void OnSettingBaseInfo()
        {
            this.formInput("appid", "游戏AppID");
            this.formInput("cdn", "游戏资源CDN");
            this.formInput("projectName", "小游戏项目名");
            this.formIntPopup("orientation", "游戏方向", new[] { "Portrait", "Landscape", "LandscapeLeft", "LandscapeRight" }, new[] { 0, 1, 2, 3 });
            this.formInput("memorySize", "UnityHeap预留内存(?)", "单位MB，预分配内存值，超休闲游戏256/中轻度496/重度游戏768，需预估游戏最大UnityHeap值以防止内存自动扩容带来的峰值尖刺。预估方法请查看GIT文档《优化Unity WebGL的内存》");
        }

        private void OnSettingChooseFolder()
        {
            GUILayout.BeginHorizontal();
            string targetDst = "dst";
            if (!formInputData.ContainsKey(targetDst))
            {
                formInputData[targetDst] = "";
            }
            EditorGUILayout.LabelField(string.Empty, GUILayout.Width(10));
            GUILayout.Label(new GUIContent("导出路径(?)", "支持输入相对于项目根目录的相对路径，如：wxbuild"), GUILayout.Width(140));
            formInputData[targetDst] = GUILayout.TextField(formInputData[targetDst], GUILayout.MaxWidth(EditorGUIUtility.currentViewWidth - 270));
            if (GUILayout.Button(new GUIContent("打开"), GUILayout.Width(40)))
            {
                if (!formInputData[targetDst].Trim().Equals(string.Empty))
                {
                    EditorUtility.RevealInFinder(GetAbsolutePath(formInputData[targetDst]));
                }
                GUIUtility.ExitGUI();
            }
            if (GUILayout.Button(new GUIContent("选择"), GUILayout.Width(40)))
            {
                var dstPath = EditorUtility.SaveFolderPanel("选择你的游戏导出目录", string.Empty, string.Empty);
                if (dstPath != string.Empty)
                {
                    formInputData[targetDst] = dstPath;
                    this.saveData();
                }
                GUIUtility.ExitGUI();
            }
            GUILayout.EndHorizontal();
        }

        private void OnSettingLoadingConfig()
        {
            this.formInput("videoUrl", "加载阶段视频URL");
            this.formIntPopup("assetLoadType", "首包资源加载方式", new[] { "CDN", "小游戏包内" }, new[] { 0, 1 });
            this.formCheckbox("compressDataPackage", "压缩首包资源(?)", "将首包资源Brotli压缩, 降低资源大小. 注意: 首次启动耗时可能会增加200ms, 仅推荐使用小游戏分包加载时节省包体大小使用");
            this.formInput("bundleExcludeExtensions", "不自动缓存文件类型(?)", "(使用;分割)当请求url包含资源'cdn+StreamingAssets'时会自动缓存，但StreamingAssets目录下不是所有文件都需缓存，此选项配置不需要自动缓存的文件拓展名。默认值json");
            this.formInput("bundleHashLength", "Bundle名称Hash长度(?)", "自定义Bundle文件名中hash部分长度，默认值32，用于缓存控制。");
            this.formInput("preloadFiles", "预下载文件列表(?)", "使用;间隔，支持模糊匹配");
        }

        private void OnSettingSDKOptions()
        {
            formCheckbox("useFriendRelation", "使用好友关系链");
            formCheckbox("useMiniGameChat", "使用社交组件");
            formCheckbox("preloadWXFont", "预加载微信字体(?)", "在game.js执行开始时预载微信系统字体，运行期间可使用WX.GetWXFont获取微信字体");
            formCheckbox("disableMultiTouch", "禁止多点触控");
        }

        private void OnSettingDebugOptions(bool showDevBuild)
        {
            EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));

            if (showDevBuild)
            {
                this.formCheckbox("developBuild", "Development Build", "", false, null, OnDevelopmentBuildToggleChanged);
            }
            this.formCheckbox("autoProfile", "Auto connect Profiler");
            this.formCheckbox("scriptOnly", "Scripts Only Build");
            this.formCheckbox("il2CppOptimizeSize", "Il2Cpp Optimize Size(?)", "对应于Il2CppCodeGeneration选项，勾选时使用OptimizeSize(默认推荐)，生成代码小15%左右，取消勾选则使用OptimizeSpeed。游戏中大量泛型集合的高频访问建议OptimizeSpeed，在使用HybridCLR等第三方组件时只能用OptimizeSpeed。(Dotnet Runtime模式下该选项无效)", !UseIL2CPP);
            this.formCheckbox("profilingFuncs", "Profiling Funcs");
            this.formCheckbox("profilingMemory", "Profiling Memory");
            this.formCheckbox("webgl2", "WebGL2.0");
            this.formCheckbox("iOSPerformancePlus", "iOSPerformancePlus(?)", "是否使用iOS高性能+渲染方案，有助于提升渲染兼容性、降低WebContent进程内存");
            this.formCheckbox("EmscriptenGLX", "EmscriptenGLX(?)", "是否使用EmscriptenGLX渲染方案");
            this.formCheckbox("iOSMetal", "iOSMetal(?)", "是否使用iOSMetal渲染方案，需要开启iOS高性能+模式，有助于提升运行性能，降低iOS功耗");
            this.formCheckbox("deleteStreamingAssets", "Clear Streaming Assets");
            this.formCheckbox("cleanBuild", "Clean WebGL Build");
            // this.formCheckbox("cleanCloudDev", "Clean Cloud Dev");
            this.formCheckbox("fbslim", "首包资源优化(?)", "导出时自动清理UnityEditor默认打包但游戏项目从未使用的资源，瘦身首包资源体积。（团结引擎已无需开启该能力）", UnityUtil.GetEngineVersion() > 0, (res) =>
            {
                var fbWin = EditorWindow.GetWindow(typeof(WXFbSettingWindow), false, "首包资源优化配置面板", true);
                fbWin.minSize = new Vector2(680, 350);
                fbWin.Show();
            });
            this.formCheckbox("autoAdaptScreen", "自适应屏幕尺寸(?)", "移动端旋转屏幕和PC端拉伸窗口时，自动调整画布尺寸");
            this.formCheckbox("showMonitorSuggestModal", "显示优化建议弹窗");
            this.formCheckbox("enableProfileStats", "显示性能面板");
            this.formCheckbox("enableRenderAnalysis", "显示渲染日志(dev only)");
            this.formCheckbox("brotliMT", "brotli多线程压缩(?)", "开启多线程压缩可以提高出包速度，但会降低压缩率。如若不使用wasm代码分包请勿用多线程出包上线");
#if UNITY_6000_0_OR_NEWER
            this.formCheckbox("enableWasm2023", "WebAssembly 2023(?)", "WebAssembly 2023包括对WebAssembly.Table和BigInt的支持。（Android (Android 10 or later recommended), iOS (iOS 15 or later recommended)）");
#endif

            if (m_EnablePerfTool)
            {
                this.formCheckbox("enablePerfAnalysis", "集成性能分析工具", "将性能分析工具集成入Development Build包中", false, null, OnPerfAnalysisFeatureToggleChanged);
            }

            EditorGUILayout.EndVertical();
        }

        private void OnSettingFontOptions()
        {
            formCheckbox("CJK_Unified_Ideographs", "基本汉字(?)", "Unicode [0x4e00, 0x9fff]");
            formCheckbox("C0_Controls_and_Basic_Latin", "基本拉丁语（英文大小写、数字、英文标点）(?)", "Unicode [0x0, 0x7f]");
            formCheckbox("CJK_Symbols_and_Punctuation", "中文标点符号(?)", "Unicode [0x3000, 0x303f]");
            formCheckbox("General_Punctuation", "通用标点符号(?)", "Unicode [0x2000, 0x206f]");
            formCheckbox("Enclosed_CJK_Letters_and_Months", "CJK字母及月份(?)", "Unicode [0x3200, 0x32ff]");
            formCheckbox("Vertical_Forms", "中文竖排标点(?)", "Unicode [0xfe10, 0xfe1f]");
            formCheckbox("CJK_Compatibility_Forms", "CJK兼容符号(?)", "Unicode [0xfe30, 0xfe4f]");
            formCheckbox("Miscellaneous_Symbols", "杂项符号(?)", "Unicode [0x2600, 0x26ff]");
            formCheckbox("CJK_Compatibility", "CJK特殊符号(?)", "Unicode [0x3300, 0x33ff]");
            formCheckbox("Halfwidth_and_Fullwidth_Forms", "全角ASCII、全角中英文标点、半宽片假名、半宽平假名、半宽韩文字母(?)", "Unicode [0xff00, 0xffef]");
            formCheckbox("Dingbats", "装饰符号(?)", "Unicode [0x2700, 0x27bf]");
            formCheckbox("Letterlike_Symbols", "字母式符号(?)", "Unicode [0x2100, 0x214f]");
            formCheckbox("Enclosed_Alphanumerics", "带圈或括号的字母数字(?)", "Unicode [0x2460, 0x24ff]");
            formCheckbox("Number_Forms", "数字形式(?)", "Unicode [0x2150, 0x218f]");
            formCheckbox("Currency_Symbols", "货币符号(?)", "Unicode [0x20a0, 0x20cf]");
            formCheckbox("Arrows", "箭头(?)", "Unicode [0x2190, 0x21ff]");
            formCheckbox("Geometric_Shapes", "几何图形(?)", "Unicode [0x25a0, 0x25ff]");
            formCheckbox("Mathematical_Operators", "数学运算符号(?)", "Unicode [0x2200, 0x22ff]");
            formInput("CustomUnicode", "自定义Unicode(?)", "将填入的所有字符强制加入字体预加载列表");
        }


        public void OnBuildButtonGUI(EditorWindow window)
        {
            GUIStyle linkStyle = new GUIStyle(GUI.skin.label);
            linkStyle.normal.textColor = Color.yellow;
            linkStyle.hover.textColor = Color.yellow;
            linkStyle.stretchWidth = false;
            linkStyle.alignment = TextAnchor.UpperLeft;
            linkStyle.wordWrap = true;
            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button(new GUIContent("更多配置项"), GUILayout.Width(100), GUILayout.Height(25)))
            {
                var minigameConfig = AssetDatabase.LoadAssetAtPath<UnityEngine.Object>("Assets/WX-WASM-SDK-V2/Editor/MiniGameConfig.asset");
                Selection.activeObject = minigameConfig;
                GUIUtility.ExitGUI();
            }
            if (GUILayout.Button(new GUIContent("WebGL转小游戏(不常用)"), GUILayout.Width(150), GUILayout.Height(25)))
            {
                this.saveData();
                if (WXConvertCore.DoExport(false) == WXConvertCore.WXExportError.SUCCEED)
                {
                    window.ShowNotification(new GUIContent("转换完成"));
                }

                GUIUtility.ExitGUI();
            }
            EditorGUILayout.LabelField(string.Empty, GUILayout.MinWidth(10));
            if (GUILayout.Button(new GUIContent("生成并转换"), GUILayout.Width(100), GUILayout.Height(25)))
            {
                this.saveData();
                if (WXConvertCore.DoExport() == WXConvertCore.WXExportError.SUCCEED)
                {
                    if (!WXConvertCore.IsInstantGameAutoStreaming())
                        window.ShowNotification(new GUIContent("转换完成"));
                    else
                    {
#if (UNITY_WEBGL || WEIXINMINIGAME) && UNITY_INSTANTGAME
                        // 上传首包资源
                        if (!string.IsNullOrEmpty(WXConvertCore.FirstBundlePath) && File.Exists(WXConvertCore.FirstBundlePath))
                        {
                            if (Unity.InstantGame.IGBuildPipeline.UploadWeChatDataFile(WXConvertCore.FirstBundlePath))
                            {
                                Debug.Log("转换完成并成功上传首包资源");
                                window.ShowNotification(new GUIContent("转换完成并成功上传"));
                            }
                            else
                            {
                                Debug.LogError("首包资源上传失败，请检查网络以及Auto Streaming配置是否正确。");
                                window.ShowNotification(new GUIContent("上传失败"));
                            }
                        }
                        else
                        {
                            Debug.LogError("转换失败");
                            window.ShowNotification(new GUIContent("转换失败"));
                        }
#else
                        window.ShowNotification(new GUIContent("转换完成"));
#endif
                    }
                }
                GUIUtility.ExitGUI();
            }
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(string.Empty);
            if (GUILayout.Button(new GUIContent("了解如何实现自定义构建", ""), linkStyle))
            {
                Application.OpenURL("https://wechat-miniprogram.github.io/minigame-unity-webgl-transform/Design/DevelopmentQAList.html#_13-%E5%A6%82%E4%BD%95%E8%87%AA%E5%AE%9A%E4%B9%89%E6%8E%A5%E5%85%A5%E6%9E%84%E5%BB%BA%E6%B5%81%E7%A8%8B");
                GUIUtility.ExitGUI();
            }
            EditorGUILayout.EndHorizontal();
        }

        private Vector2 scrollRoot;
        private bool foldBaseInfo = true;
        private bool foldLoadingConfig = true;
        private bool foldSDKOptions = true;
        private bool foldDebugOptions = true;
        private bool foldInstantGame = false;
        private bool foldFontOptions = false;
        private Dictionary<string, string> formInputData = new Dictionary<string, string>();
        private Dictionary<string, int> formIntPopupData = new Dictionary<string, int>();
        private Dictionary<string, bool> formCheckboxData = new Dictionary<string, bool>();

        private string SDKFilePath;

        private void addBundlePathIdentifier(string value)
        {
            string identifier = config.ProjectConf.bundlePathIdentifier;
            if (identifier[identifier.Length - 1] != ';')
            {
                identifier += ";";
            }
            identifier += value;
            config.ProjectConf.bundlePathIdentifier = identifier;
        }
        private void loadData()
        {
            // SDKFilePath = Path.Combine(Application.dataPath, "WX-WASM-SDK-V2", "Runtime", "wechat-default", "unity-sdk", "index.js");
            SDKFilePath = Path.Combine(UnityUtil.GetWxSDKRootPath(), "Runtime", "wechat-default", "unity-sdk", "index.js");
            config = UnityUtil.GetEditorConf();

            // Instant Game
            if (WXConvertCore.IsInstantGameAutoStreaming())
            {
                config.ProjectConf.CDN = WXConvertCore.GetInstantGameAutoStreamingCDN();
                string identifier = config.ProjectConf.bundlePathIdentifier;
                string[] identifiers = identifier.Split(';');
                bool AS = false;
                bool CUS = false;
                foreach (string id in identifiers)
                {
                    if (id == "AS")
                    {
                        AS = true;
                    }
                    if (id == "CUS/CustomAB")
                    {
                        CUS = true;
                    }
                }
                if (!AS)
                {
                    this.addBundlePathIdentifier("AS");
                }
                if (!CUS)
                {
                    this.addBundlePathIdentifier("CUS/CustomAB");
                }
                if (config.ProjectConf.dataFileSubPrefix != "CUS")
                {
                    config.ProjectConf.dataFileSubPrefix = "CUS";
                }
            }

            this.setData("autoUploadFirstBundle", true);
            loadProjectConfData(config.ProjectConf);
            loadSDKOptionsData(config.SDKOptions);
            loadCompileOptionsData(config.CompileOptions);
            loadFontOptionsData(config.FontOptions);
        }

        private void loadData(SerializedObject serializedObject, SerializedProperty miniGameProperty)
        {
            serializedObject.UpdateIfRequiredOrScript();
            var ProjectConf = miniGameProperty.FindPropertyRelative("ProjectConf");

            // Instant Game
            if (WXConvertCore.IsInstantGameAutoStreaming())
            {
                var automaticfillinstantgame = miniGameProperty.FindPropertyRelative("m_AutomaticFillInstantGame");
                if (automaticfillinstantgame.boolValue)
                {
                    ProjectConf.FindPropertyRelative("CDN").stringValue = WXConvertCore.GetInstantGameAutoStreamingCDN();
                    if (!ProjectConf.FindPropertyRelative("bundlePathIdentifier").stringValue.Contains("AS;"))
                    {
                        ProjectConf.FindPropertyRelative("bundlePathIdentifier").stringValue += "AS;";
                    }
                    if (!ProjectConf.FindPropertyRelative("bundlePathIdentifier").stringValue.Contains("CUS/CustomAB;"))
                    {
                        ProjectConf.FindPropertyRelative("bundlePathIdentifier").stringValue += "CUS/CustomAB;";
                    }
                    ProjectConf.FindPropertyRelative("dataFileSubPrefix").stringValue = "CUS";
                }
            }

            var _ProjectConf = new WXProjectConf();
            deserializeProjectConf(_ProjectConf, ProjectConf);
            loadProjectConfData(_ProjectConf);

            var SDKOptions = miniGameProperty.FindPropertyRelative("SDKOptions");
            var _SDKOptions = new SDKOptions();
            deserializeSDKOptions(_SDKOptions, SDKOptions);
            loadSDKOptionsData(_SDKOptions);

            var CompileOptions = miniGameProperty.FindPropertyRelative("CompileOptions");
            var _CompileOptions = new CompileOptions();
            deserializeCompileOptions(_CompileOptions, CompileOptions);
            loadCompileOptionsData(_CompileOptions);

            var FontOptions = miniGameProperty.FindPropertyRelative("FontOptions");
            var _FontOptions = new FontOptions();
            deserializeFontOptions(_FontOptions, FontOptions);
            loadFontOptionsData(_FontOptions);
        }

        private void loadProjectConfData(WXProjectConf ProjectConf)
        {
            this.setData("projectName", ProjectConf.projectName);
            this.setData("appid", ProjectConf.Appid);
            this.setData("cdn", ProjectConf.CDN);
            this.setData("assetLoadType", ProjectConf.assetLoadType);
            this.setData("compressDataPackage", ProjectConf.compressDataPackage);
            this.setData("videoUrl", ProjectConf.VideoUrl);
            this.setData("orientation", (int)ProjectConf.Orientation);
            this.setData("dst", ProjectConf.relativeDST);
            this.setData("bundleHashLength", ProjectConf.bundleHashLength.ToString());
            this.setData("bundlePathIdentifier", ProjectConf.bundlePathIdentifier);
            this.setData("bundleExcludeExtensions", ProjectConf.bundleExcludeExtensions);
            this.setData("preloadFiles", ProjectConf.preloadFiles);
            this.setData("bgImageSrc", ProjectConf.bgImageSrc);

            tex = AssetDatabase.LoadAssetAtPath<Texture>(ProjectConf.bgImageSrc);
            this.setData("memorySize", ProjectConf.MemorySize.ToString());
            this.setData("hideAfterCallMain", ProjectConf.HideAfterCallMain);

            this.setData("dataFileSubPrefix", ProjectConf.dataFileSubPrefix);
            this.setData("maxStorage", ProjectConf.maxStorage.ToString());
            this.setData("defaultReleaseSize", ProjectConf.defaultReleaseSize.ToString());
            this.setData("texturesHashLength", ProjectConf.texturesHashLength.ToString());
            this.setData("texturesPath", ProjectConf.texturesPath);
            this.setData("needCacheTextures", ProjectConf.needCacheTextures);
            this.setData("loadingBarWidth", ProjectConf.loadingBarWidth.ToString());
            this.setData("needCheckUpdate", ProjectConf.needCheckUpdate);
            this.setData("disableHighPerformanceFallback", ProjectConf.disableHighPerformanceFallback);
        }

        private void loadSDKOptionsData(SDKOptions SDKOptions)
        {
            this.setData("useFriendRelation", SDKOptions.UseFriendRelation);
            this.setData("useMiniGameChat", SDKOptions.UseMiniGameChat);
            this.setData("preloadWXFont", SDKOptions.PreloadWXFont);
            this.setData("disableMultiTouch", SDKOptions.disableMultiTouch);
        }

        private void loadCompileOptionsData(CompileOptions CompileOptions)
        {
            this.setData("developBuild", CompileOptions.DevelopBuild);
            this.setData("autoProfile", CompileOptions.AutoProfile);
            this.setData("scriptOnly", CompileOptions.ScriptOnly);
            this.setData("il2CppOptimizeSize", CompileOptions.Il2CppOptimizeSize);
            this.setData("profilingFuncs", CompileOptions.profilingFuncs);
            this.setData("profilingMemory", CompileOptions.ProfilingMemory);
            this.setData("deleteStreamingAssets", CompileOptions.DeleteStreamingAssets);
            this.setData("cleanBuild", CompileOptions.CleanBuild);
            this.setData("customNodePath", CompileOptions.CustomNodePath);
            this.setData("webgl2", CompileOptions.Webgl2);
            this.setData("iOSPerformancePlus", CompileOptions.enableIOSPerformancePlus);
            this.setData("iOSMetal", CompileOptions.enableiOSMetal);
            this.setData("EmscriptenGLX", CompileOptions.enableEmscriptenGLX);
            this.setData("fbslim", CompileOptions.fbslim);
            this.setData("autoAdaptScreen", CompileOptions.autoAdaptScreen);
            this.setData("showMonitorSuggestModal", CompileOptions.showMonitorSuggestModal);
            this.setData("enableProfileStats", CompileOptions.enableProfileStats);
            this.setData("enableRenderAnalysis", CompileOptions.enableRenderAnalysis);
            this.setData("brotliMT", CompileOptions.brotliMT);
#if UNITY_6000_0_OR_NEWER
            this.setData("enableWasm2023", CompileOptions.enableWasm2023);
#endif      
            this.setData("enablePerfAnalysis", CompileOptions.enablePerfAnalysis);
        }

        private void loadFontOptionsData(FontOptions FontOptions)
        {
            this.setData("CJK_Unified_Ideographs", FontOptions.CJK_Unified_Ideographs);
            this.setData("C0_Controls_and_Basic_Latin", FontOptions.C0_Controls_and_Basic_Latin);
            this.setData("CJK_Symbols_and_Punctuation", FontOptions.CJK_Symbols_and_Punctuation);
            this.setData("General_Punctuation", FontOptions.General_Punctuation);
            this.setData("Enclosed_CJK_Letters_and_Months", FontOptions.Enclosed_CJK_Letters_and_Months);
            this.setData("Vertical_Forms", FontOptions.Vertical_Forms);
            this.setData("CJK_Compatibility_Forms", FontOptions.CJK_Compatibility_Forms);
            this.setData("Miscellaneous_Symbols", FontOptions.Miscellaneous_Symbols);
            this.setData("CJK_Compatibility", FontOptions.CJK_Compatibility);
            this.setData("Halfwidth_and_Fullwidth_Forms", FontOptions.Halfwidth_and_Fullwidth_Forms);
            this.setData("Dingbats", FontOptions.Dingbats);
            this.setData("Letterlike_Symbols", FontOptions.Letterlike_Symbols);
            this.setData("Enclosed_Alphanumerics", FontOptions.Enclosed_Alphanumerics);
            this.setData("Number_Forms", FontOptions.Number_Forms);
            this.setData("Currency_Symbols", FontOptions.Currency_Symbols);
            this.setData("Arrows", FontOptions.Arrows);
            this.setData("Geometric_Shapes", FontOptions.Geometric_Shapes);
            this.setData("Mathematical_Operators", FontOptions.Mathematical_Operators);
            this.setData("CustomUnicode", FontOptions.CustomUnicode);
        }

        private void saveData()
        {
            saveProjectConfData(config.ProjectConf);
            saveSDKOptionsData(config.SDKOptions);
            saveCompileOptionsData(config.CompileOptions);
            saveFontOptionsData(config.FontOptions);

            ApplyPerfAnalysisSetting();
        }

        private void saveData(SerializedObject serializedObject, SerializedProperty miniGameProperty)
        {
            serializedObject.UpdateIfRequiredOrScript();

            var ProjectConf = miniGameProperty.FindPropertyRelative("ProjectConf");
            var _ProjectConf = new WXProjectConf();
            saveProjectConfData(_ProjectConf);
            serializeProjectConf(_ProjectConf, ProjectConf);

            var CompileOptions = miniGameProperty.FindPropertyRelative("CompileOptions");
            var _CompileOptions = new CompileOptions();
            saveCompileOptionsData(_CompileOptions);
            serializeCompileOptions(_CompileOptions, CompileOptions);

            var SDKOptions = miniGameProperty.FindPropertyRelative("SDKOptions");
            var _SDKOptions = new SDKOptions();
            saveSDKOptionsData(_SDKOptions);
            serializeSDKOptions(_SDKOptions, SDKOptions);

            var FontOptions = miniGameProperty.FindPropertyRelative("FontOptions");
            var _FontOptions = new FontOptions();
            saveFontOptionsData(_FontOptions);
            serializeFontOptions(_FontOptions, FontOptions);

            miniGameProperty.FindPropertyRelative("m_AutomaticFillInstantGame").boolValue = getDataCheckbox("m_AutomaticFillInstantGame");

            serializedObject.ApplyModifiedProperties();
        }

        private void saveProjectConfData(WXProjectConf ProjectConf)
        {
            ProjectConf.projectName = this.getDataInput("projectName");
            ProjectConf.Appid = this.getDataInput("appid");
            ProjectConf.CDN = this.getDataInput("cdn");
            ProjectConf.assetLoadType = this.getDataPop("assetLoadType");
            ProjectConf.compressDataPackage = this.getDataCheckbox("compressDataPackage");
            ProjectConf.VideoUrl = this.getDataInput("videoUrl");
            ProjectConf.Orientation = (WXScreenOritation)this.getDataPop("orientation");
            ProjectConf.relativeDST = this.getDataInput("dst");
            ProjectConf.DST = GetAbsolutePath(ProjectConf.relativeDST);
            ProjectConf.bundleHashLength = int.Parse(this.getDataInput("bundleHashLength"));
            ProjectConf.bundlePathIdentifier = this.getDataInput("bundlePathIdentifier");
            ProjectConf.bundleExcludeExtensions = this.getDataInput("bundleExcludeExtensions");
            ProjectConf.preloadFiles = this.getDataInput("preloadFiles");

            ProjectConf.bgImageSrc = this.getDataInput("bgImageSrc");
            ProjectConf.MemorySize = int.Parse(this.getDataInput("memorySize"));
            ProjectConf.HideAfterCallMain = this.getDataCheckbox("hideAfterCallMain");
            ProjectConf.dataFileSubPrefix = this.getDataInput("dataFileSubPrefix");
            ProjectConf.maxStorage = int.Parse(this.getDataInput("maxStorage"));
            ProjectConf.defaultReleaseSize = int.Parse(this.getDataInput("defaultReleaseSize"));
            ProjectConf.texturesHashLength = int.Parse(this.getDataInput("texturesHashLength"));
            ProjectConf.texturesPath = this.getDataInput("texturesPath");
            ProjectConf.needCacheTextures = this.getDataCheckbox("needCacheTextures");
            ProjectConf.loadingBarWidth = int.Parse(this.getDataInput("loadingBarWidth"));
            ProjectConf.needCheckUpdate = this.getDataCheckbox("needCheckUpdate");
            ProjectConf.disableHighPerformanceFallback = this.getDataCheckbox("disableHighPerformanceFallback");
        }

        private void saveSDKOptionsData(SDKOptions SDKOptions)
        {
            SDKOptions.UseFriendRelation = this.getDataCheckbox("useFriendRelation");
            SDKOptions.UseMiniGameChat = this.getDataCheckbox("useMiniGameChat");
            SDKOptions.PreloadWXFont = this.getDataCheckbox("preloadWXFont");
            SDKOptions.disableMultiTouch = this.getDataCheckbox("disableMultiTouch");
        }

        private void saveCompileOptionsData(CompileOptions CompileOptions)
        {
            CompileOptions.DevelopBuild = this.getDataCheckbox("developBuild");
            CompileOptions.AutoProfile = this.getDataCheckbox("autoProfile");
            CompileOptions.ScriptOnly = this.getDataCheckbox("scriptOnly");
            CompileOptions.Il2CppOptimizeSize = this.getDataCheckbox("il2CppOptimizeSize");
            CompileOptions.profilingFuncs = this.getDataCheckbox("profilingFuncs");
            CompileOptions.ProfilingMemory = this.getDataCheckbox("profilingMemory");
            CompileOptions.DeleteStreamingAssets = this.getDataCheckbox("deleteStreamingAssets");
            CompileOptions.CleanBuild = this.getDataCheckbox("cleanBuild");
            CompileOptions.CustomNodePath = this.getDataInput("customNodePath");
            CompileOptions.Webgl2 = this.getDataCheckbox("webgl2");
            CompileOptions.enableIOSPerformancePlus = this.getDataCheckbox("iOSPerformancePlus");
            CompileOptions.enableiOSMetal = this.getDataCheckbox("iOSMetal");
            CompileOptions.enableEmscriptenGLX = this.getDataCheckbox("EmscriptenGLX");
            CompileOptions.fbslim = this.getDataCheckbox("fbslim");

            CompileOptions.autoAdaptScreen = this.getDataCheckbox("autoAdaptScreen");
            CompileOptions.showMonitorSuggestModal = this.getDataCheckbox("showMonitorSuggestModal");
            CompileOptions.enableProfileStats = this.getDataCheckbox("enableProfileStats");
            CompileOptions.enableRenderAnalysis = this.getDataCheckbox("enableRenderAnalysis");
            CompileOptions.brotliMT = this.getDataCheckbox("brotliMT");
#if UNITY_6000_0_OR_NEWER
            CompileOptions.enableWasm2023 = this.getDataCheckbox("enableWasm2023");
#endif
            CompileOptions.enablePerfAnalysis = this.getDataCheckbox("enablePerfAnalysis");
        }

        private void saveFontOptionsData(FontOptions FontOptions)
        {
            FontOptions.CJK_Unified_Ideographs = this.getDataCheckbox("CJK_Unified_Ideographs");
            FontOptions.C0_Controls_and_Basic_Latin = this.getDataCheckbox("C0_Controls_and_Basic_Latin");
            FontOptions.CJK_Symbols_and_Punctuation = this.getDataCheckbox("CJK_Symbols_and_Punctuation");
            FontOptions.General_Punctuation = this.getDataCheckbox("General_Punctuation");
            FontOptions.Enclosed_CJK_Letters_and_Months = this.getDataCheckbox("Enclosed_CJK_Letters_and_Months");
            FontOptions.Vertical_Forms = this.getDataCheckbox("Vertical_Forms");
            FontOptions.CJK_Compatibility_Forms = this.getDataCheckbox("CJK_Compatibility_Forms");
            FontOptions.Miscellaneous_Symbols = this.getDataCheckbox("Miscellaneous_Symbols");
            FontOptions.CJK_Compatibility = this.getDataCheckbox("CJK_Compatibility");
            FontOptions.Halfwidth_and_Fullwidth_Forms = this.getDataCheckbox("Halfwidth_and_Fullwidth_Forms");
            FontOptions.Dingbats = this.getDataCheckbox("Dingbats");
            FontOptions.Letterlike_Symbols = this.getDataCheckbox("Letterlike_Symbols");
            FontOptions.Enclosed_Alphanumerics = this.getDataCheckbox("Enclosed_Alphanumerics");
            FontOptions.Number_Forms = this.getDataCheckbox("Number_Forms");
            FontOptions.Currency_Symbols = this.getDataCheckbox("Currency_Symbols");
            FontOptions.Arrows = this.getDataCheckbox("Arrows");
            FontOptions.Geometric_Shapes = this.getDataCheckbox("Geometric_Shapes");
            FontOptions.Mathematical_Operators = this.getDataCheckbox("Mathematical_Operators");
            FontOptions.CustomUnicode = this.getDataInput("CustomUnicode");
        }

        private void deserializeProjectConf(WXProjectConf _ProjectConf, SerializedProperty ProjectConf)
        {
            _ProjectConf.projectName = ProjectConf.FindPropertyRelative("projectName").stringValue;
            _ProjectConf.Appid = ProjectConf.FindPropertyRelative("Appid").stringValue;
            _ProjectConf.CDN = ProjectConf.FindPropertyRelative("CDN").stringValue;
            _ProjectConf.assetLoadType = ProjectConf.FindPropertyRelative("assetLoadType").intValue;
            _ProjectConf.compressDataPackage = ProjectConf.FindPropertyRelative("compressDataPackage").boolValue;
            _ProjectConf.VideoUrl = ProjectConf.FindPropertyRelative("VideoUrl").stringValue;
            _ProjectConf.Orientation = (WXScreenOritation)ProjectConf.FindPropertyRelative("Orientation").enumValueIndex;
            _ProjectConf.relativeDST = ProjectConf.FindPropertyRelative("relativeDST").stringValue;
            _ProjectConf.DST = ProjectConf.FindPropertyRelative("DST").stringValue;

            _ProjectConf.bundleHashLength = ProjectConf.FindPropertyRelative("bundleHashLength").intValue;
            _ProjectConf.bundlePathIdentifier = ProjectConf.FindPropertyRelative("bundlePathIdentifier").stringValue;
            _ProjectConf.bundleExcludeExtensions = ProjectConf.FindPropertyRelative("bundleExcludeExtensions").stringValue;
            _ProjectConf.preloadFiles = ProjectConf.FindPropertyRelative("preloadFiles").stringValue;
            _ProjectConf.bgImageSrc = ProjectConf.FindPropertyRelative("bgImageSrc").stringValue;
            _ProjectConf.MemorySize = ProjectConf.FindPropertyRelative("MemorySize").intValue;
            _ProjectConf.HideAfterCallMain = ProjectConf.FindPropertyRelative("HideAfterCallMain").boolValue;
            _ProjectConf.dataFileSubPrefix = ProjectConf.FindPropertyRelative("dataFileSubPrefix").stringValue;
            _ProjectConf.maxStorage = ProjectConf.FindPropertyRelative("maxStorage").intValue;
            _ProjectConf.defaultReleaseSize = ProjectConf.FindPropertyRelative("defaultReleaseSize").intValue;
            _ProjectConf.texturesHashLength = ProjectConf.FindPropertyRelative("texturesHashLength").intValue;
            _ProjectConf.texturesPath = ProjectConf.FindPropertyRelative("texturesPath").stringValue;
            _ProjectConf.needCacheTextures = ProjectConf.FindPropertyRelative("needCacheTextures").boolValue;
            _ProjectConf.loadingBarWidth = ProjectConf.FindPropertyRelative("loadingBarWidth").intValue;
            _ProjectConf.needCheckUpdate = ProjectConf.FindPropertyRelative("needCheckUpdate").boolValue;
            _ProjectConf.disableHighPerformanceFallback = ProjectConf.FindPropertyRelative("disableHighPerformanceFallback").boolValue;
        }
        private void serializeProjectConf(WXProjectConf _ProjectConf, SerializedProperty ProjectConf)
        {
            ProjectConf.FindPropertyRelative("projectName").stringValue = _ProjectConf.projectName;
            ProjectConf.FindPropertyRelative("Appid").stringValue = _ProjectConf.Appid;
            ProjectConf.FindPropertyRelative("CDN").stringValue = _ProjectConf.CDN;
            ProjectConf.FindPropertyRelative("assetLoadType").intValue = _ProjectConf.assetLoadType;
            ProjectConf.FindPropertyRelative("compressDataPackage").boolValue = _ProjectConf.compressDataPackage;
            ProjectConf.FindPropertyRelative("VideoUrl").stringValue = _ProjectConf.VideoUrl;
            ProjectConf.FindPropertyRelative("Orientation").enumValueIndex = (int)_ProjectConf.Orientation;
            ProjectConf.FindPropertyRelative("relativeDST").stringValue = _ProjectConf.relativeDST;
            ProjectConf.FindPropertyRelative("DST").stringValue = _ProjectConf.DST;

            ProjectConf.FindPropertyRelative("bundleHashLength").intValue = _ProjectConf.bundleHashLength;
            ProjectConf.FindPropertyRelative("bundlePathIdentifier").stringValue = _ProjectConf.bundlePathIdentifier;
            ProjectConf.FindPropertyRelative("bundleExcludeExtensions").stringValue = _ProjectConf.bundleExcludeExtensions;
            ProjectConf.FindPropertyRelative("preloadFiles").stringValue = _ProjectConf.preloadFiles;
            ProjectConf.FindPropertyRelative("bgImageSrc").stringValue = _ProjectConf.bgImageSrc;
            ProjectConf.FindPropertyRelative("MemorySize").intValue = _ProjectConf.MemorySize;
            ProjectConf.FindPropertyRelative("HideAfterCallMain").boolValue = _ProjectConf.HideAfterCallMain;
            ProjectConf.FindPropertyRelative("dataFileSubPrefix").stringValue = _ProjectConf.dataFileSubPrefix;
            ProjectConf.FindPropertyRelative("maxStorage").intValue = _ProjectConf.maxStorage;
            ProjectConf.FindPropertyRelative("defaultReleaseSize").intValue = _ProjectConf.defaultReleaseSize;
            ProjectConf.FindPropertyRelative("texturesHashLength").intValue = _ProjectConf.texturesHashLength;
            ProjectConf.FindPropertyRelative("texturesPath").stringValue = _ProjectConf.texturesPath;
            ProjectConf.FindPropertyRelative("needCacheTextures").boolValue = _ProjectConf.needCacheTextures;
            ProjectConf.FindPropertyRelative("loadingBarWidth").intValue = _ProjectConf.loadingBarWidth;
            ProjectConf.FindPropertyRelative("needCheckUpdate").boolValue = _ProjectConf.needCheckUpdate;
            ProjectConf.FindPropertyRelative("disableHighPerformanceFallback").boolValue = _ProjectConf.disableHighPerformanceFallback;

            //miniGameProperty.FindPropertyRelative("m_AutomaticFillInstantGame").boolValue = getDataCheckbox("m_AutomaticFillInstantGame");

        }

        private void deserializeSDKOptions(SDKOptions _SDKOptions, SerializedProperty SDKOptions)
        {
            _SDKOptions.UseFriendRelation = SDKOptions.FindPropertyRelative("UseFriendRelation").boolValue;
            _SDKOptions.UseMiniGameChat = SDKOptions.FindPropertyRelative("UseMiniGameChat").boolValue;
            _SDKOptions.PreloadWXFont = SDKOptions.FindPropertyRelative("PreloadWXFont").boolValue;
            _SDKOptions.disableMultiTouch = SDKOptions.FindPropertyRelative("disableMultiTouch").boolValue;
        }
        private void serializeSDKOptions(SDKOptions _SDKOptionsf, SerializedProperty SDKOptions)
        {
            SDKOptions.FindPropertyRelative("UseFriendRelation").boolValue = _SDKOptionsf.UseFriendRelation;
            SDKOptions.FindPropertyRelative("UseMiniGameChat").boolValue = _SDKOptionsf.UseMiniGameChat;
            SDKOptions.FindPropertyRelative("PreloadWXFont").boolValue = _SDKOptionsf.PreloadWXFont;
            SDKOptions.FindPropertyRelative("disableMultiTouch").boolValue = _SDKOptionsf.disableMultiTouch;
        }

        private void deserializeCompileOptions(CompileOptions _CompileOptions, SerializedProperty CompileOptions)
        {
            //CompileOptions.FindPropertyRelative("DevelopBuild").boolValue = serializedObject.FindProperty("m_PlatformSettings").FindPropertyRelative("m_Development").boolValue;
            _CompileOptions.DevelopBuild = CompileOptions.FindPropertyRelative("DevelopBuild").boolValue;
            _CompileOptions.AutoProfile = CompileOptions.FindPropertyRelative("AutoProfile").boolValue;
            _CompileOptions.ScriptOnly = CompileOptions.FindPropertyRelative("ScriptOnly").boolValue;
            _CompileOptions.Il2CppOptimizeSize = CompileOptions.FindPropertyRelative("Il2CppOptimizeSize").boolValue;
            _CompileOptions.profilingFuncs = CompileOptions.FindPropertyRelative("profilingFuncs").boolValue;
            _CompileOptions.ProfilingMemory = CompileOptions.FindPropertyRelative("ProfilingMemory").boolValue;
            _CompileOptions.DeleteStreamingAssets = CompileOptions.FindPropertyRelative("DeleteStreamingAssets").boolValue;
            _CompileOptions.CleanBuild = CompileOptions.FindPropertyRelative("CleanBuild").boolValue;
            _CompileOptions.CustomNodePath = CompileOptions.FindPropertyRelative("CustomNodePath").stringValue;
            _CompileOptions.Webgl2 = CompileOptions.FindPropertyRelative("Webgl2").boolValue;
            _CompileOptions.enableIOSPerformancePlus = CompileOptions.FindPropertyRelative("enableIOSPerformancePlus").boolValue;
            _CompileOptions.enableiOSMetal = CompileOptions.FindPropertyRelative("enableiOSMetal").boolValue;
            _CompileOptions.enableEmscriptenGLX = CompileOptions.FindPropertyRelative("enableEmscriptenGLX").boolValue;
            _CompileOptions.fbslim = CompileOptions.FindPropertyRelative("fbslim").boolValue;

            _CompileOptions.autoAdaptScreen = CompileOptions.FindPropertyRelative("autoAdaptScreen").boolValue;
            _CompileOptions.showMonitorSuggestModal = CompileOptions.FindPropertyRelative("showMonitorSuggestModal").boolValue;
            _CompileOptions.enableProfileStats = CompileOptions.FindPropertyRelative("enableProfileStats").boolValue;
            _CompileOptions.enableRenderAnalysis = CompileOptions.FindPropertyRelative("enableRenderAnalysis").boolValue;
            _CompileOptions.brotliMT = CompileOptions.FindPropertyRelative("brotliMT").boolValue;
#if UNITY_6000_0_OR_NEWER
            _CompileOptions.enableWasm2023 = CompileOptions.FindPropertyRelative("enableWasm2023").boolValue;
#endif
            _CompileOptions.enablePerfAnalysis = CompileOptions.FindPropertyRelative("enablePerfAnalysis").boolValue;
        }
        private void serializeCompileOptions(CompileOptions _CompileOptions, SerializedProperty CompileOptions)
        {
            //CompileOptions.FindPropertyRelative("DevelopBuild").boolValue = serializedObject.FindProperty("m_PlatformSettings").FindPropertyRelative("m_Development").boolValue;
            CompileOptions.FindPropertyRelative("AutoProfile").boolValue = _CompileOptions.AutoProfile;
            CompileOptions.FindPropertyRelative("ScriptOnly").boolValue = _CompileOptions.ScriptOnly;
            CompileOptions.FindPropertyRelative("Il2CppOptimizeSize").boolValue = _CompileOptions.Il2CppOptimizeSize;
            CompileOptions.FindPropertyRelative("profilingFuncs").boolValue = _CompileOptions.profilingFuncs;
            CompileOptions.FindPropertyRelative("ProfilingMemory").boolValue = _CompileOptions.ProfilingMemory;
            CompileOptions.FindPropertyRelative("DeleteStreamingAssets").boolValue = _CompileOptions.DeleteStreamingAssets;
            CompileOptions.FindPropertyRelative("CleanBuild").boolValue = _CompileOptions.CleanBuild;
            CompileOptions.FindPropertyRelative("CustomNodePath").stringValue = _CompileOptions.CustomNodePath;
            CompileOptions.FindPropertyRelative("Webgl2").boolValue = _CompileOptions.Webgl2;
            CompileOptions.FindPropertyRelative("enableIOSPerformancePlus").boolValue = _CompileOptions.enableIOSPerformancePlus;
            CompileOptions.FindPropertyRelative("enableiOSMetal").boolValue = _CompileOptions.enableiOSMetal;
            CompileOptions.FindPropertyRelative("enableEmscriptenGLX").boolValue = _CompileOptions.enableEmscriptenGLX;
            CompileOptions.FindPropertyRelative("fbslim").boolValue = _CompileOptions.fbslim;

            CompileOptions.FindPropertyRelative("autoAdaptScreen").boolValue = _CompileOptions.autoAdaptScreen;
            CompileOptions.FindPropertyRelative("showMonitorSuggestModal").boolValue = _CompileOptions.showMonitorSuggestModal;
            CompileOptions.FindPropertyRelative("enableProfileStats").boolValue = _CompileOptions.enableProfileStats;
            CompileOptions.FindPropertyRelative("enableRenderAnalysis").boolValue = _CompileOptions.enableRenderAnalysis;
            CompileOptions.FindPropertyRelative("brotliMT").boolValue = _CompileOptions.brotliMT;

        }

        private void deserializeFontOptions(FontOptions _FontOptions, SerializedProperty FontOptions)
        {
            _FontOptions.CJK_Unified_Ideographs = FontOptions.FindPropertyRelative("CJK_Unified_Ideographs").boolValue;
            _FontOptions.C0_Controls_and_Basic_Latin = FontOptions.FindPropertyRelative("C0_Controls_and_Basic_Latin").boolValue;
            _FontOptions.CJK_Symbols_and_Punctuation = FontOptions.FindPropertyRelative("CJK_Symbols_and_Punctuation").boolValue;
            _FontOptions.General_Punctuation = FontOptions.FindPropertyRelative("General_Punctuation").boolValue;
            _FontOptions.Enclosed_CJK_Letters_and_Months = FontOptions.FindPropertyRelative("Enclosed_CJK_Letters_and_Months").boolValue;
            _FontOptions.Vertical_Forms = FontOptions.FindPropertyRelative("Vertical_Forms").boolValue;
            _FontOptions.CJK_Compatibility_Forms = FontOptions.FindPropertyRelative("CJK_Compatibility_Forms").boolValue;
            _FontOptions.Miscellaneous_Symbols = FontOptions.FindPropertyRelative("Miscellaneous_Symbols").boolValue;
            _FontOptions.CJK_Compatibility = FontOptions.FindPropertyRelative("CJK_Compatibility").boolValue;
            _FontOptions.Halfwidth_and_Fullwidth_Forms = FontOptions.FindPropertyRelative("Halfwidth_and_Fullwidth_Forms").boolValue;
            _FontOptions.Dingbats = FontOptions.FindPropertyRelative("Dingbats").boolValue;
            _FontOptions.Letterlike_Symbols = FontOptions.FindPropertyRelative("Letterlike_Symbols").boolValue;
            _FontOptions.Enclosed_Alphanumerics = FontOptions.FindPropertyRelative("Enclosed_Alphanumerics").boolValue;
            _FontOptions.Number_Forms = FontOptions.FindPropertyRelative("Number_Forms").boolValue;
            _FontOptions.Currency_Symbols = FontOptions.FindPropertyRelative("Currency_Symbols").boolValue;
            _FontOptions.Arrows = FontOptions.FindPropertyRelative("Arrows").boolValue;
            _FontOptions.Geometric_Shapes = FontOptions.FindPropertyRelative("Geometric_Shapes").boolValue;
            _FontOptions.Mathematical_Operators = FontOptions.FindPropertyRelative("Mathematical_Operators").boolValue;
            _FontOptions.CustomUnicode = FontOptions.FindPropertyRelative("CustomUnicode").stringValue;
        }
        private void serializeFontOptions(FontOptions _FontOptions, SerializedProperty FontOptions)
        {
            FontOptions.FindPropertyRelative("CJK_Unified_Ideographs").boolValue = _FontOptions.CJK_Unified_Ideographs;
            FontOptions.FindPropertyRelative("C0_Controls_and_Basic_Latin").boolValue = _FontOptions.C0_Controls_and_Basic_Latin;
            FontOptions.FindPropertyRelative("CJK_Symbols_and_Punctuation").boolValue = _FontOptions.CJK_Symbols_and_Punctuation;
            FontOptions.FindPropertyRelative("General_Punctuation").boolValue = _FontOptions.General_Punctuation;
            FontOptions.FindPropertyRelative("Enclosed_CJK_Letters_and_Months").boolValue = _FontOptions.Enclosed_CJK_Letters_and_Months;
            FontOptions.FindPropertyRelative("Vertical_Forms").boolValue = _FontOptions.Vertical_Forms;
            FontOptions.FindPropertyRelative("CJK_Compatibility_Forms").boolValue = _FontOptions.CJK_Compatibility_Forms;
            FontOptions.FindPropertyRelative("Miscellaneous_Symbols").boolValue = _FontOptions.Miscellaneous_Symbols;
            FontOptions.FindPropertyRelative("CJK_Compatibility").boolValue = _FontOptions.CJK_Compatibility;
            FontOptions.FindPropertyRelative("Halfwidth_and_Fullwidth_Forms").boolValue = _FontOptions.Halfwidth_and_Fullwidth_Forms;
            FontOptions.FindPropertyRelative("Dingbats").boolValue = _FontOptions.Dingbats;
            FontOptions.FindPropertyRelative("Letterlike_Symbols").boolValue = _FontOptions.Letterlike_Symbols;
            FontOptions.FindPropertyRelative("Enclosed_Alphanumerics").boolValue = _FontOptions.Enclosed_Alphanumerics;
            FontOptions.FindPropertyRelative("Number_Forms").boolValue = _FontOptions.Number_Forms;
            FontOptions.FindPropertyRelative("Currency_Symbols").boolValue = _FontOptions.Currency_Symbols;
            FontOptions.FindPropertyRelative("Arrows").boolValue = _FontOptions.Arrows;
            FontOptions.FindPropertyRelative("Geometric_Shapes").boolValue = _FontOptions.Geometric_Shapes;
            FontOptions.FindPropertyRelative("Mathematical_Operators").boolValue = _FontOptions.Mathematical_Operators;
            FontOptions.FindPropertyRelative("CustomUnicode").stringValue = _FontOptions.CustomUnicode;
            FontOptions.FindPropertyRelative("Arrows").boolValue = _FontOptions.Arrows;
            FontOptions.FindPropertyRelative("Geometric_Shapes").boolValue = _FontOptions.Geometric_Shapes;
            FontOptions.FindPropertyRelative("Mathematical_Operators").boolValue = _FontOptions.Mathematical_Operators;
            FontOptions.FindPropertyRelative("CustomUnicode").stringValue = _FontOptions.CustomUnicode;
        }


        private string getDataInput(string target)
        {
            if (this.formInputData.ContainsKey(target))
                return this.formInputData[target];
            return "";
        }
        private int getDataPop(string target)
        {
            if (this.formIntPopupData.ContainsKey(target))
                return this.formIntPopupData[target];
            return 0;
        }
        private bool getDataCheckbox(string target)
        {
            if (this.formCheckboxData.ContainsKey(target))
                return this.formCheckboxData[target];
            return false;
        }

        private void setData(string target, string value)
        {
            if (formInputData.ContainsKey(target))
            {
                formInputData[target] = value;
            }
            else
            {
                formInputData.Add(target, value);
            }
        }
        private void setData(string target, bool value)
        {
            if (formCheckboxData.ContainsKey(target))
            {
                formCheckboxData[target] = value;
            }
            else
            {
                formCheckboxData.Add(target, value);
            }
        }
        private void setData(string target, int value)
        {
            if (formIntPopupData.ContainsKey(target))
            {
                formIntPopupData[target] = value;
            }
            else
            {
                formIntPopupData.Add(target, value);
            }
        }
        private void formInput(string target, string label, string help = null)
        {
            if (!formInputData.ContainsKey(target))
            {
                formInputData[target] = "";
            }
            GUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(string.Empty, GUILayout.Width(10));
            if (help == null)
            {
                GUILayout.Label(label, GUILayout.Width(140));
            }
            else
            {
                GUILayout.Label(new GUIContent(label, help), GUILayout.Width(140));
            }
            formInputData[target] = GUILayout.TextField(formInputData[target], GUILayout.MaxWidth(EditorGUIUtility.currentViewWidth - 195));
            GUILayout.EndHorizontal();
        }

        private void formIntPopup(string target, string label, string[] options, int[] values)
        {
            if (!formIntPopupData.ContainsKey(target))
            {
                formIntPopupData[target] = 0;
            }
            GUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(string.Empty, GUILayout.Width(10));
            GUILayout.Label(label, GUILayout.Width(140));
            formIntPopupData[target] = EditorGUILayout.IntPopup(formIntPopupData[target], options, values, GUILayout.MaxWidth(EditorGUIUtility.currentViewWidth - 195));
            GUILayout.EndHorizontal();
        }

        private void formCheckbox(string target, string label, string help = null, bool disable = false, Action<bool> setting = null, Action<bool> onValueChanged = null)
        {
            if (!formCheckboxData.ContainsKey(target))
            {
                formCheckboxData[target] = false;
            }
            GUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(string.Empty, GUILayout.Width(10));
            if (help == null)
            {
                GUILayout.Label(label, GUILayout.Width(140));
            }
            else
            {
                GUILayout.Label(new GUIContent(label, help), GUILayout.Width(140));
            }
            EditorGUI.BeginDisabledGroup(disable);

            // Toggle the checkbox value based on the disable condition
            bool newValue = EditorGUILayout.Toggle(disable ? false : formCheckboxData[target]);
            // Update the checkbox data if the value has changed and invoke the onValueChanged action
            if (newValue != formCheckboxData[target])
            {
                formCheckboxData[target] = newValue;
                onValueChanged?.Invoke(newValue);
            }

            if (setting != null)
            {
                EditorGUILayout.LabelField("", GUILayout.Width(10));
                // 配置按钮
                if (GUILayout.Button(new GUIContent("设置"), GUILayout.Width(40), GUILayout.Height(18)))
                {
                    setting?.Invoke(true);
                }
                EditorGUILayout.LabelField("", GUILayout.MinWidth(10));
            }

            EditorGUI.EndDisabledGroup();

            if (setting == null)
                EditorGUILayout.LabelField(string.Empty);
            GUILayout.EndHorizontal();
        }

        private void OnDevelopmentBuildToggleChanged(bool InNewValue)
        {
            // 针对non-dev build，取消性能分析工具的集成
            if (!InNewValue)
            {
                this.setData("enablePerfAnalysis", false);
            }
        }

        private void OnPerfAnalysisFeatureToggleChanged(bool InNewValue)
        {
            // 针对non-dev build，取消性能分析工具的集成
            if (!formCheckboxData["developBuild"] && InNewValue)
            {
                this.setData("enablePerfAnalysis", false);
            }
        }

        private void ApplyPerfAnalysisSetting()
        {
            const string MACRO_ENABLE_WX_PERF_FEATURE = "ENABLE_WX_PERF_FEATURE";
            string defineSymbols = PlayerSettings.GetScriptingDefineSymbolsForGroup(EditorUserBuildSettings.selectedBuildTargetGroup);

            bool shouldAddSymbol = this.getDataCheckbox("enablePerfAnalysis") && this.getDataCheckbox("developBuild");

#if !UNITY_2021_2_OR_NEWER || UNITY_2023_2_OR_NEWER
            if (shouldAddSymbol)
            {
                shouldAddSymbol = false;
                EditorUtility.DisplayDialog("警告", $"当前Unity版本({Application.unityVersion})不在性能分析工具适配范围内(2021.2-2023.1), 性能分析工具将被禁用。", "确定");
                config.CompileOptions.enablePerfAnalysis = false;
                this.setData("enablePerfAnalysis", false);
            }
#endif

            if (shouldAddSymbol)
            {
                if (defineSymbols.IndexOf(MACRO_ENABLE_WX_PERF_FEATURE) == -1)
                {
                    PlayerSettings.SetScriptingDefineSymbolsForGroup(EditorUserBuildSettings.selectedBuildTargetGroup, MACRO_ENABLE_WX_PERF_FEATURE + $";{defineSymbols}");
                }
            }
            else
            {
                // 删除掉已有的ENABLE_WX_PERF_FEATURE
                if (defineSymbols.IndexOf(MACRO_ENABLE_WX_PERF_FEATURE) != -1)
                {
                    defineSymbols = defineSymbols.Replace(MACRO_ENABLE_WX_PERF_FEATURE, "").Replace(";;", ";").Trim(';');
                    PlayerSettings.SetScriptingDefineSymbolsForGroup(EditorUserBuildSettings.selectedBuildTargetGroup, defineSymbols);
                }
            }
        }

        public static bool IsAbsolutePath(string path)
        {
            // 检查是否为空或空白
            if (string.IsNullOrWhiteSpace(path))
            {
                return false;
            }

            // 在 Windows 上，检查驱动器字母或网络路径
            if (Application.platform == RuntimePlatform.WindowsEditor && Path.IsPathRooted(path))
            {
                return true;
            }

            // 在 Unix/Linux 和 macOS 上，检查是否以 '/' 开头
            if (Application.platform == RuntimePlatform.OSXEditor && path.StartsWith("/"))
            {
                return true;
            }

            return false; // 否则为相对路径
        }

        public static string GetAbsolutePath(string path)
        {
            if (IsAbsolutePath(path))
            {
                return path;
            }

            return Path.Combine(projectRootPath, path);
        }
    }
}
