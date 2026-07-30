#if TUANJIE_1_6_OR_NEWER
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

        public WXSettingsHelper helper = new WXSettingsHelper();

        public override void OnMiniGameSettingsIMGUI(SerializedObject serializedObject, SerializedProperty miniGameProperty)
        {
            if (helper == null)
            {
                Debug.LogWarning("WXSettingsHelper is null, recreate it before drawing MiniGame settings.");
                helper = new WXSettingsHelper();
            }

            helper.OnSettingsGUI(serializedObject, miniGameProperty);
        }

    }
}
#endif
