#if TUANJIE_1_4_OR_NEWER
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using UnityEditor;
using UnityEditor.Build.Profile;
using UnityEngine;
using static WeChatWASM.WXConvertCore;

namespace WeChatWASM
{
    public class WeixinMiniGameSettingsEditor : MiniGameSettingsEditor
    {
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
        public Texture tex;

        public override void OnMiniGameSettingsIMGUI(SerializedObject serializedObject, SerializedProperty miniGameProperty)
        {
            OnSettingsGUI(serializedObject, miniGameProperty);
        }

        public void OnSettingsGUI(SerializedObject serializedObject, SerializedProperty miniGameProperty)
        {
            loadData(serializedObject, miniGameProperty);

            scrollRoot = EditorGUILayout.BeginScrollView(scrollRoot);

            GUIStyle linkStyle = new GUIStyle(GUI.skin.label);
            linkStyle.normal.textColor = Color.yellow;
            linkStyle.hover.textColor = Color.yellow;
            linkStyle.stretchWidth = false;
            linkStyle.alignment = TextAnchor.UpperLeft;
            linkStyle.wordWrap = true;

            foldBaseInfo = EditorGUILayout.Foldout(foldBaseInfo, "基本信息");
            if (foldBaseInfo)
            {
                EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));

                formInput("appid", "游戏AppID");
                formInput("cdn", "游戏资源CDN");
                formInput("projectName", "小游戏项目名");
                formIntPopup("orientation", "游戏方向", new[] { "Portrait", "Landscape", "LandscapeLeft", "LandscapeRight" }, new[] { 0, 1, 2, 3 });
                formInput("memorySize", "UnityHeap预留内存(?)", "单位MB，预分配内存值，超休闲游戏256/中轻度496/重度游戏768，需预估游戏最大UnityHeap值以防止内存自动扩容带来的峰值尖刺。预估方法请查看GIT文档《优化Unity WebGL的内存》");

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
                if (!string.IsNullOrEmpty(currentBgSrc) && currentBgSrc != formInputData[targetBg])
                {
                    formInputData[targetBg] = currentBgSrc;
                    saveData(serializedObject, miniGameProperty);
                }
                GUILayout.EndHorizontal();

                formInput("videoUrl", "加载阶段视频URL");
                formIntPopup("assetLoadType", "首包资源加载方式", new[] { "CDN", "小游戏包内" }, new[] { 0, 1 });
                formCheckbox("compressDataPackage", "压缩首包资源(?)", "将首包资源Brotli压缩, 降低资源大小. 注意: 首次启动耗时可能会增加200ms, 仅推荐使用小游戏分包加载时节省包体大小使用");
                formInput("bundleExcludeExtensions", "不自动缓存文件类型(?)", "(使用;分割)当请求url包含资源'cdn+StreamingAssets'时会自动缓存，但StreamingAssets目录下不是所有文件都需缓存，此选项配置不需要自动缓存的文件拓展名。默认值json");
                formInput("bundleHashLength", "Bundle名称Hash长度(?)", "自定义Bundle文件名中hash部分长度，默认值32，用于缓存控制。");
                formInput("preloadFiles", "预下载文件列表(?)", "使用;间隔，支持模糊匹配");

                EditorGUILayout.EndVertical();
            }

            foldSDKOptions = EditorGUILayout.Foldout(foldSDKOptions, "SDK功能选项");
            if (foldSDKOptions)
            {
                EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));

                formCheckbox("useFriendRelation", "使用好友关系链");
                formCheckbox("useMiniGameChat", "使用社交组件");
                formCheckbox("preloadWXFont", "预加载微信字体(?)", "在game.js执行开始时预载微信系统字体，运行期间可使用WX.GetWXFont获取微信字体");
                formCheckbox("disableMultiTouch", "禁止多点触控");

                EditorGUILayout.EndVertical();
            }

            foldDebugOptions = EditorGUILayout.Foldout(foldDebugOptions, "调试编译选项");
            if (foldDebugOptions)
            {
                EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));
                // formCheckbox("developBuild", "Development Build");
                formCheckbox("autoProfile", "Auto connect Profiler");
                formCheckbox("scriptOnly", "Scripts Only Build");
#if TUANJIE_2022_3_OR_NEWER
                // TODO: if overwrite by OverwritePlayerSettings
                bool UseIL2CPP = PlayerSettings.GetScriptingBackend(BuildTargetGroup.WeixinMiniGame) == ScriptingImplementation.IL2CPP;
#else
                bool UseIL2CPP = true;
#endif
                formCheckbox("il2CppOptimizeSize", "Il2Cpp Optimize Size(?)", "对应于Il2CppCodeGeneration选项，勾选时使用OptimizeSize(默认推荐)，生成代码小15%左右，取消勾选则使用OptimizeSpeed。游戏中大量泛型集合的高频访问建议OptimizeSpeed，在使用HybridCLR等第三方组件时只能用OptimizeSpeed。(Dotnet Runtime模式下该选项无效)", !UseIL2CPP);
                formCheckbox("profilingFuncs", "Profiling Funcs");
                formCheckbox("profilingMemory", "Profiling Memory");

                formCheckbox("webgl2", "WebGL2.0(beta)");
                formCheckbox("iOSPerformancePlus", "iOSPerformancePlus(?)", "是否使用iOS高性能+渲染方案，有助于提升渲染兼容性、降低WebContent进程内存");
                formCheckbox("EmscriptenGLX", "EmscriptenGLX(?)", "是否使用EmscriptenGLX渲染方案");
                formCheckbox("iOSMetal", "iOSMetal(?)", "是否使用iOSMetal渲染方案，需要开启iOS高性能+模式，有助于提升运行性能，降低iOS功耗");
                formCheckbox("deleteStreamingAssets", "Clear Streaming Assets");
                 formCheckbox("cleanBuild", "Clean WebGL Build");
                // formCheckbox("cleanCloudDev", "Clean Cloud Dev");
                formCheckbox("fbslim", "首包资源优化(?)", "导出时自动清理UnityEditor默认打包但游戏项目从未使用的资源，瘦身首包资源体积。（团结引擎已无需开启该能力）", UnityUtil.GetEngineVersion() > 0, (res) =>
                {
                    var fbWin = EditorWindow.GetWindow(typeof(WXFbSettingWindow), false, "首包资源优化配置面板", true);
                    fbWin.minSize = new Vector2(680, 350);
                    fbWin.Show();
                });
                formCheckbox("autoAdaptScreen", "自适应屏幕尺寸(?)", "移动端旋转屏幕和PC端拉伸窗口时，自动调整画布尺寸");
                formCheckbox("showMonitorSuggestModal", "显示优化建议弹窗");
                formCheckbox("enableProfileStats", "显示性能面板");
                formCheckbox("enableRenderAnalysis", "显示渲染日志(dev only)");

                {
                    formCheckbox("brotliMT", "brotli多线程压缩(?)", "开启多线程压缩可以提高出包速度，但会降低压缩率。如若不使用wasm代码分包请勿用多线程出包上线");
                }
                EditorGUILayout.EndVertical();
            }

            if (WXConvertCore.IsInstantGameAutoStreaming())
            {
                foldInstantGame = EditorGUILayout.Foldout(foldInstantGame, "Instant Game - AutoStreaming");
                if (foldInstantGame)
                {
                    var automaticfillinstantgame = miniGameProperty.FindPropertyRelative("m_AutomaticFillInstantGame");
                    EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));
                    GUILayout.BeginHorizontal();
                    EditorGUILayout.LabelField(string.Empty, GUILayout.Width(10));
                    formCheckbox("m_AutomaticFillInstantGame", "自动填写AutoStreaming", "仅在开启AutoStreaming生效");
                    GUILayout.EndHorizontal();
                    formInput("bundlePathIdentifier", "Bundle Path Identifier");
                    formInput("dataFileSubPrefix", "Data File Sub Prefix");

                    EditorGUI.BeginDisabledGroup(true);
                    formCheckbox("autoUploadFirstBundle", "构建后自动上传首包(?)", "仅在开启AutoStreaming生效", true);
                    EditorGUI.EndDisabledGroup();

                    GUILayout.BeginHorizontal();
                    EditorGUILayout.LabelField(string.Empty, GUILayout.Width(10));
                    GUILayout.Label(new GUIContent("清理AS配置(?)", "如需关闭AutoStreaming选用默认发布方案则需要清理AS配置项目。"), GUILayout.Width(140));
                    EditorGUI.BeginDisabledGroup(WXConvertCore.IsInstantGameAutoStreaming());
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

            {
                foldFontOptions = EditorGUILayout.Foldout(foldFontOptions, "字体配置");
                if (foldFontOptions)
                {
                    EditorGUILayout.BeginVertical("frameBox", GUILayout.ExpandWidth(true));
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
                    EditorGUILayout.EndVertical();
                }
            }

            EditorGUILayout.EndScrollView();
            saveData(serializedObject, miniGameProperty);
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

            setData("projectName", ProjectConf.FindPropertyRelative("projectName").stringValue);
            setData("appid", ProjectConf.FindPropertyRelative("Appid").stringValue);
            setData("cdn", ProjectConf.FindPropertyRelative("CDN").stringValue);
            setData("assetLoadType", ProjectConf.FindPropertyRelative("assetLoadType").intValue);
            setData("compressDataPackage", ProjectConf.FindPropertyRelative("compressDataPackage").boolValue);
            setData("videoUrl", ProjectConf.FindPropertyRelative("VideoUrl").stringValue);
            setData("orientation", (int)ProjectConf.FindPropertyRelative("Orientation").enumValueIndex);
            //setData("dst", ProjectConf.FindPropertyRelative("relativeDST").stringValue);
            setData("bundleHashLength", ProjectConf.FindPropertyRelative("bundleHashLength").intValue.ToString());
            setData("bundlePathIdentifier", ProjectConf.FindPropertyRelative("bundlePathIdentifier").stringValue);
            setData("bundleExcludeExtensions", ProjectConf.FindPropertyRelative("bundleExcludeExtensions").stringValue);
            setData("preloadFiles", ProjectConf.FindPropertyRelative("preloadFiles").stringValue);

            var CompileOptions = miniGameProperty.FindPropertyRelative("CompileOptions");
            // setData("developBuild", CompileOptions.FindPropertyRelative("DevelopBuild").boolValue);
            setData("autoProfile", CompileOptions.FindPropertyRelative("AutoProfile").boolValue);
            setData("scriptOnly", CompileOptions.FindPropertyRelative("ScriptOnly").boolValue);
            setData("il2CppOptimizeSize", CompileOptions.FindPropertyRelative("Il2CppOptimizeSize").boolValue);
            setData("profilingFuncs", CompileOptions.FindPropertyRelative("profilingFuncs").boolValue);
            setData("profilingMemory", CompileOptions.FindPropertyRelative("ProfilingMemory").boolValue);
            setData("deleteStreamingAssets", CompileOptions.FindPropertyRelative("DeleteStreamingAssets").boolValue);
            setData("cleanBuild", CompileOptions.FindPropertyRelative("CleanBuild").boolValue);
            setData("customNodePath", CompileOptions.FindPropertyRelative("CustomNodePath").stringValue);
            setData("webgl2", CompileOptions.FindPropertyRelative("Webgl2").boolValue);
            setData("iOSPerformancePlus", CompileOptions.FindPropertyRelative("enableIOSPerformancePlus").boolValue);
            setData("iOSMetal", CompileOptions.FindPropertyRelative("enableiOSMetal").boolValue);
            setData("EmscriptenGLX", CompileOptions.FindPropertyRelative("enableEmscriptenGLX").boolValue);
            setData("fbslim", CompileOptions.FindPropertyRelative("fbslim").boolValue);

            var SDKOptions = miniGameProperty.FindPropertyRelative("SDKOptions");
            setData("useFriendRelation", SDKOptions.FindPropertyRelative("UseFriendRelation").boolValue);
            setData("useMiniGameChat", SDKOptions.FindPropertyRelative("UseMiniGameChat").boolValue);
            setData("preloadWXFont", SDKOptions.FindPropertyRelative("PreloadWXFont").boolValue);
            setData("disableMultiTouch", SDKOptions.FindPropertyRelative("disableMultiTouch").boolValue);
            setData("bgImageSrc", ProjectConf.FindPropertyRelative("bgImageSrc").stringValue);
            tex = AssetDatabase.LoadAssetAtPath<Texture>(ProjectConf.FindPropertyRelative("bgImageSrc").stringValue);
            setData("memorySize", ProjectConf.FindPropertyRelative("MemorySize").intValue.ToString());
            setData("hideAfterCallMain", ProjectConf.FindPropertyRelative("HideAfterCallMain").boolValue);

            setData("dataFileSubPrefix", ProjectConf.FindPropertyRelative("dataFileSubPrefix").stringValue);
            setData("maxStorage", ProjectConf.FindPropertyRelative("maxStorage").intValue.ToString());
            setData("defaultReleaseSize", ProjectConf.FindPropertyRelative("defaultReleaseSize").intValue.ToString());
            setData("texturesHashLength", ProjectConf.FindPropertyRelative("texturesHashLength").intValue.ToString());
            setData("texturesPath", ProjectConf.FindPropertyRelative("texturesPath").stringValue);
            setData("needCacheTextures", ProjectConf.FindPropertyRelative("needCacheTextures").boolValue);
            setData("loadingBarWidth", ProjectConf.FindPropertyRelative("loadingBarWidth").intValue.ToString());
            setData("needCheckUpdate", ProjectConf.FindPropertyRelative("needCheckUpdate").boolValue);
            setData("disableHighPerformanceFallback", ProjectConf.FindPropertyRelative("disableHighPerformanceFallback").boolValue);
            setData("autoAdaptScreen", CompileOptions.FindPropertyRelative("autoAdaptScreen").boolValue);
            setData("showMonitorSuggestModal", CompileOptions.FindPropertyRelative("showMonitorSuggestModal").boolValue);
            setData("enableProfileStats", CompileOptions.FindPropertyRelative("enableProfileStats").boolValue);
            setData("enableRenderAnalysis", CompileOptions.FindPropertyRelative("enableRenderAnalysis").boolValue);
            setData("brotliMT", CompileOptions.FindPropertyRelative("brotliMT").boolValue);
            setData("autoUploadFirstBundle", true);
            setData("m_AutomaticFillInstantGame", miniGameProperty.FindPropertyRelative("m_AutomaticFillInstantGame").boolValue);

            // font options
            var FontOptions = miniGameProperty.FindPropertyRelative("FontOptions");
            setData("CJK_Unified_Ideographs", FontOptions.FindPropertyRelative("CJK_Unified_Ideographs").boolValue);
            setData("C0_Controls_and_Basic_Latin", FontOptions.FindPropertyRelative("C0_Controls_and_Basic_Latin").boolValue);
            setData("CJK_Symbols_and_Punctuation", FontOptions.FindPropertyRelative("CJK_Symbols_and_Punctuation").boolValue);
            setData("General_Punctuation", FontOptions.FindPropertyRelative("General_Punctuation").boolValue);
            setData("Enclosed_CJK_Letters_and_Months", FontOptions.FindPropertyRelative("Enclosed_CJK_Letters_and_Months").boolValue);
            setData("Vertical_Forms", FontOptions.FindPropertyRelative("Vertical_Forms").boolValue);
            setData("CJK_Compatibility_Forms", FontOptions.FindPropertyRelative("CJK_Compatibility_Forms").boolValue);
            setData("Miscellaneous_Symbols", FontOptions.FindPropertyRelative("Miscellaneous_Symbols").boolValue);
            setData("CJK_Compatibility", FontOptions.FindPropertyRelative("CJK_Compatibility").boolValue);
            setData("Halfwidth_and_Fullwidth_Forms", FontOptions.FindPropertyRelative("Halfwidth_and_Fullwidth_Forms").boolValue);
            setData("Dingbats", FontOptions.FindPropertyRelative("Dingbats").boolValue);
            setData("Letterlike_Symbols", FontOptions.FindPropertyRelative("Letterlike_Symbols").boolValue);
            setData("Enclosed_Alphanumerics", FontOptions.FindPropertyRelative("Enclosed_Alphanumerics").boolValue);
            setData("Number_Forms", FontOptions.FindPropertyRelative("Number_Forms").boolValue);
            setData("Currency_Symbols", FontOptions.FindPropertyRelative("Currency_Symbols").boolValue);
            setData("Arrows", FontOptions.FindPropertyRelative("Arrows").boolValue);
            setData("Geometric_Shapes", FontOptions.FindPropertyRelative("Geometric_Shapes").boolValue);
            setData("Mathematical_Operators", FontOptions.FindPropertyRelative("Mathematical_Operators").boolValue);
            setData("CustomUnicode", FontOptions.FindPropertyRelative("CustomUnicode").stringValue);
        }

        private void saveData(SerializedObject serializedObject, SerializedProperty miniGameProperty)
        {
            serializedObject.UpdateIfRequiredOrScript();

            var ProjectConf = miniGameProperty.FindPropertyRelative("ProjectConf");
            ProjectConf.FindPropertyRelative("projectName").stringValue = getDataInput("projectName");
            ProjectConf.FindPropertyRelative("Appid").stringValue = getDataInput("appid");
            ProjectConf.FindPropertyRelative("CDN").stringValue = getDataInput("cdn");
            ProjectConf.FindPropertyRelative("assetLoadType").intValue = getDataPop("assetLoadType");
            ProjectConf.FindPropertyRelative("compressDataPackage").boolValue = getDataCheckbox("compressDataPackage");
            ProjectConf.FindPropertyRelative("VideoUrl").stringValue = getDataInput("videoUrl");
            ProjectConf.FindPropertyRelative("Orientation").enumValueIndex = getDataPop("orientation");
            ProjectConf.FindPropertyRelative("relativeDST").stringValue = serializedObject.FindProperty("m_BuildPath").stringValue;
            ProjectConf.FindPropertyRelative("DST").stringValue = GetAbsolutePath(config.ProjectConf.relativeDST);

            ProjectConf.FindPropertyRelative("bundleHashLength").intValue = int.Parse(getDataInput("bundleHashLength"));
            ProjectConf.FindPropertyRelative("bundlePathIdentifier").stringValue = getDataInput("bundlePathIdentifier");
            ProjectConf.FindPropertyRelative("bundleExcludeExtensions").stringValue = getDataInput("bundleExcludeExtensions");
            ProjectConf.FindPropertyRelative("preloadFiles").stringValue = getDataInput("preloadFiles");

            var CompileOptions = miniGameProperty.FindPropertyRelative("CompileOptions");

            CompileOptions.FindPropertyRelative("DevelopBuild").boolValue = serializedObject.FindProperty("m_PlatformSettings").FindPropertyRelative("m_Development").boolValue;
            CompileOptions.FindPropertyRelative("AutoProfile").boolValue = getDataCheckbox("autoProfile");
            CompileOptions.FindPropertyRelative("ScriptOnly").boolValue = getDataCheckbox("scriptOnly");
            CompileOptions.FindPropertyRelative("Il2CppOptimizeSize").boolValue = getDataCheckbox("il2CppOptimizeSize");
            CompileOptions.FindPropertyRelative("profilingFuncs").boolValue = getDataCheckbox("profilingFuncs");
            CompileOptions.FindPropertyRelative("ProfilingMemory").boolValue = getDataCheckbox("profilingMemory");
            CompileOptions.FindPropertyRelative("DeleteStreamingAssets").boolValue = getDataCheckbox("deleteStreamingAssets");
            CompileOptions.FindPropertyRelative("CleanBuild").boolValue = getDataCheckbox("cleanBuild");
            CompileOptions.FindPropertyRelative("CustomNodePath").stringValue = getDataInput("customNodePath");
            CompileOptions.FindPropertyRelative("Webgl2").boolValue = getDataCheckbox("webgl2");
            CompileOptions.FindPropertyRelative("enableIOSPerformancePlus").boolValue = getDataCheckbox("iOSPerformancePlus");
            CompileOptions.FindPropertyRelative("enableiOSMetal").boolValue = getDataCheckbox("iOSMetal");
            CompileOptions.FindPropertyRelative("enableEmscriptenGLX").boolValue = getDataCheckbox("EmscriptenGLX");
            CompileOptions.FindPropertyRelative("fbslim").boolValue = getDataCheckbox("fbslim");

            var SDKOptions = miniGameProperty.FindPropertyRelative("SDKOptions");
            SDKOptions.FindPropertyRelative("UseFriendRelation").boolValue = getDataCheckbox("useFriendRelation");
            SDKOptions.FindPropertyRelative("UseMiniGameChat").boolValue = getDataCheckbox("useMiniGameChat");
            SDKOptions.FindPropertyRelative("PreloadWXFont").boolValue = getDataCheckbox("preloadWXFont");
            SDKOptions.FindPropertyRelative("disableMultiTouch").boolValue = getDataCheckbox("disableMultiTouch");
            ProjectConf.FindPropertyRelative("bgImageSrc").stringValue = getDataInput("bgImageSrc");
            ProjectConf.FindPropertyRelative("MemorySize").intValue = int.Parse(getDataInput("memorySize"));
            ProjectConf.FindPropertyRelative("HideAfterCallMain").boolValue = getDataCheckbox("hideAfterCallMain");
            ProjectConf.FindPropertyRelative("dataFileSubPrefix").stringValue = getDataInput("dataFileSubPrefix");
            ProjectConf.FindPropertyRelative("maxStorage").intValue = int.Parse(getDataInput("maxStorage"));
            ProjectConf.FindPropertyRelative("defaultReleaseSize").intValue = int.Parse(getDataInput("defaultReleaseSize"));
            ProjectConf.FindPropertyRelative("texturesHashLength").intValue = int.Parse(getDataInput("texturesHashLength"));
            ProjectConf.FindPropertyRelative("texturesPath").stringValue = getDataInput("texturesPath");
            ProjectConf.FindPropertyRelative("needCacheTextures").boolValue = getDataCheckbox("needCacheTextures");
            ProjectConf.FindPropertyRelative("loadingBarWidth").intValue = int.Parse(getDataInput("loadingBarWidth"));
            ProjectConf.FindPropertyRelative("needCheckUpdate").boolValue = getDataCheckbox("needCheckUpdate");
            ProjectConf.FindPropertyRelative("disableHighPerformanceFallback").boolValue = getDataCheckbox("disableHighPerformanceFallback");
            CompileOptions.FindPropertyRelative("autoAdaptScreen").boolValue = getDataCheckbox("autoAdaptScreen");
            CompileOptions.FindPropertyRelative("showMonitorSuggestModal").boolValue = getDataCheckbox("showMonitorSuggestModal");
            CompileOptions.FindPropertyRelative("enableProfileStats").boolValue = getDataCheckbox("enableProfileStats");
            CompileOptions.FindPropertyRelative("enableRenderAnalysis").boolValue = getDataCheckbox("enableRenderAnalysis");
            CompileOptions.FindPropertyRelative("brotliMT").boolValue = getDataCheckbox("brotliMT");

            // font options
            var FontOptions = miniGameProperty.FindPropertyRelative("FontOptions");
            FontOptions.FindPropertyRelative("CJK_Unified_Ideographs").boolValue = getDataCheckbox("CJK_Unified_Ideographs");
            FontOptions.FindPropertyRelative("C0_Controls_and_Basic_Latin").boolValue = getDataCheckbox("C0_Controls_and_Basic_Latin");
            FontOptions.FindPropertyRelative("CJK_Symbols_and_Punctuation").boolValue = getDataCheckbox("CJK_Symbols_and_Punctuation");
            FontOptions.FindPropertyRelative("General_Punctuation").boolValue = getDataCheckbox("General_Punctuation");
            FontOptions.FindPropertyRelative("Enclosed_CJK_Letters_and_Months").boolValue = getDataCheckbox("Enclosed_CJK_Letters_and_Months");
            FontOptions.FindPropertyRelative("Vertical_Forms").boolValue = getDataCheckbox("Vertical_Forms");
            FontOptions.FindPropertyRelative("CJK_Compatibility_Forms").boolValue = getDataCheckbox("CJK_Compatibility_Forms");
            FontOptions.FindPropertyRelative("Miscellaneous_Symbols").boolValue = getDataCheckbox("Miscellaneous_Symbols");
            FontOptions.FindPropertyRelative("CJK_Compatibility").boolValue = getDataCheckbox("CJK_Compatibility");
            FontOptions.FindPropertyRelative("Halfwidth_and_Fullwidth_Forms").boolValue = getDataCheckbox("Halfwidth_and_Fullwidth_Forms");
            FontOptions.FindPropertyRelative("Dingbats").boolValue = getDataCheckbox("Dingbats");
            FontOptions.FindPropertyRelative("Letterlike_Symbols").boolValue = getDataCheckbox("Letterlike_Symbols");
            FontOptions.FindPropertyRelative("Enclosed_Alphanumerics").boolValue = getDataCheckbox("Enclosed_Alphanumerics");
            FontOptions.FindPropertyRelative("Number_Forms").boolValue = getDataCheckbox("Number_Forms");
            FontOptions.FindPropertyRelative("Currency_Symbols").boolValue = getDataCheckbox("Currency_Symbols");
            FontOptions.FindPropertyRelative("Arrows").boolValue = getDataCheckbox("Arrows");
            FontOptions.FindPropertyRelative("Geometric_Shapes").boolValue = getDataCheckbox("Geometric_Shapes");
            FontOptions.FindPropertyRelative("Mathematical_Operators").boolValue = getDataCheckbox("Mathematical_Operators");
            FontOptions.FindPropertyRelative("CustomUnicode").stringValue = getDataInput("CustomUnicode");
            FontOptions.FindPropertyRelative("Arrows").boolValue = getDataCheckbox("Arrows");
            FontOptions.FindPropertyRelative("Geometric_Shapes").boolValue = getDataCheckbox("Geometric_Shapes");
            FontOptions.FindPropertyRelative("Mathematical_Operators").boolValue = getDataCheckbox("Mathematical_Operators");
            FontOptions.FindPropertyRelative("CustomUnicode").stringValue = getDataInput("CustomUnicode");

            miniGameProperty.FindPropertyRelative("m_AutomaticFillInstantGame").boolValue = getDataCheckbox("m_AutomaticFillInstantGame");

            serializedObject.ApplyModifiedProperties();
        }

        private bool getDataCheckbox(string target)
        {
            if (formCheckboxData.ContainsKey(target))
                return formCheckboxData[target];
            return false;
        }

        private string getDataInput(string target)
        {
            if (formInputData.ContainsKey(target))
                return formInputData[target];
            return "";
        }

        private int getDataPop(string target)
        {
            if (formIntPopupData.ContainsKey(target))
                return formIntPopupData[target];
            return 0;
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

        private void formCheckbox(string target, string label, string help = null, bool disable = false, Action<bool> setting = null)
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
            formCheckboxData[target] = EditorGUILayout.Toggle(disable ? false : formCheckboxData[target]);

            if (setting != null)
            {
                EditorGUILayout.LabelField("", GUILayout.Width(10));
                // ���ð�ť
                if (GUILayout.Button(new GUIContent("����"), GUILayout.Width(40), GUILayout.Height(18)))
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
            string projectRootPath = System.IO.Path.GetFullPath(Application.dataPath + "/../");
            return Path.Combine(projectRootPath, path);
        }
    }
}
#endif
