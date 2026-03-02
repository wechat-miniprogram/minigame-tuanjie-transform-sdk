using UnityEngine;
using UnityEditor;

namespace WeChatWASM
{

    public class WXEditorPCHPWin : EditorWindow
    {
        [MenuItem("微信小游戏 / 转换PC高性能小游戏", false, 3)]
        public static void Open()
        {
            var win = GetWindow(typeof(WXEditorPCHPWin), false, "PC高性能小游戏转换工具面板");
            win.minSize = new Vector2(350, 400);
            win.position = new Rect(100, 100, 600, 400);
            win.Show();
        }

        public void OnFocus()
        {
            WXPCSettingsHelperInterface.helper.OnFocus();
        }

        public void OnLostFocus()
        {
            WXPCSettingsHelperInterface.helper.OnLostFocus();
        }

        public void OnDisable()
        {
            WXPCSettingsHelperInterface.helper.OnDisable();
        }

        public void OnGUI()
        {
            WXPCSettingsHelperInterface.helper.OnSettingsGUI(this);
            WXPCSettingsHelperInterface.helper.OnBuildButtonGUI(this);
        }
    }
}
