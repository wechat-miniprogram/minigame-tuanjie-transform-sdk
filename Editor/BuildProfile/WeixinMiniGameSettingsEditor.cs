#if TUANJIE_1_4_OR_NEWER
using UnityEditor;
using UnityEditor.Build.Profile;
using static WeChatWASM.WXConvertCore;

namespace WeChatWASM
{
    public class WeixinMiniGameSettingsEditor : MiniGameSettingsEditor
    {
        public static WXExportError DoExport(bool buildWebGL = true)
        {
            return WXConvertCore.DoExport(buildWebGL);
        }

        public void OnFocus()
        {
            WXSettingsHelperInterface.helper.OnFocus();
        }

        public void OnLostFocus()
        {
            WXSettingsHelperInterface.helper.OnLostFocus();
        }

        public void OnDisable()
        {
            WXSettingsHelperInterface.helper.OnDisable();
        }

        public override void OnMiniGameSettingsIMGUI(SerializedObject serializedObject, SerializedProperty miniGameProperty)
        {
            WXSettingsHelperInterface.helper.OnSettingsGUI(null);
        }

    }
}
#endif
