#if UNITY_WEBGL || WEIXINMINIGAME || UNITY_EDITOR
using System;
using UnityEngine;
using WeChatWASM;


internal class DisableKeyboardInput : MonoBehaviour
{
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    private static void OnGameLaunch()
    {
#if !UNITY_EDITOR
#if PLATFORM_WEIXINMINIGAME
        WeixinMiniGameInput.mobileKeyboardSupport = false;
#elif PLATFORM_WEBGL
#if UNITY_2022_1_OR_NEWER
        WebGLInput.mobileKeyboardSupport = false;
#endif
#endif
#endif
    }
}
#endif