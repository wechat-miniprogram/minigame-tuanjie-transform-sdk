using UnityEngine;
using UnityEditor;
using static WeChatWASM.WXConvertCore;

namespace WeChatWASM
{

    public class WXPlayableWin : EditorWindow
    {
        [MenuItem("微信小游戏 / 转换小游戏试玩", false, 2)]
        public static void Open()
        {
            var win = GetWindow(typeof(WXPlayableWin), false, "微信小游戏试玩转换工具面板");
            win.minSize = new Vector2(350, 400);
            win.position = new Rect(200, 200, 600, 300);
            win.Show();
        }

        // 向前兼容，请使用 WXConvertCore.cs
        public static WXExportError DoExport(bool buildWebGL = true)
        {
            return WXPlayableConvertCore.DoExport(buildWebGL);
        }

        public void OnFocus()
        {
            WXPlayableSettingsHelperInterface.helper.OnFocus();
        }

        public void OnLostFocus()
        {
            WXPlayableSettingsHelperInterface.helper.OnLostFocus();
        }

        public void OnDisable()
        {
            WXPlayableSettingsHelperInterface.helper.OnDisable();
        }

        public void OnGUI()
        {
            WXPlayableSettingsHelperInterface.helper.OnSettingsGUI(this);
            WXPlayableSettingsHelperInterface.helper.OnBuildButtonGUI(this);
        }
    }
}