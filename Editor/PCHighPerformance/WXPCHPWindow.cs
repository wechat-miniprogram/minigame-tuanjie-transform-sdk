using UnityEngine;
using UnityEditor;

namespace WeChatWASM
{

    public class WXPCHPWin : EditorWindow
    {
        [MenuItem("微信小游戏 / 转换PC高性能模式", false, 3)]
        public static void Open()
        {
            var win = GetWindow(typeof(WXPCHPWin), false, "PC高性能模式转换工具");
            win.minSize = new Vector2(350, 200);
            win.position = new Rect(150, 150, 500, 300);
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
