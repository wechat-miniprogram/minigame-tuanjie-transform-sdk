using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

#if PLATFORM_WEIXINMINIGAME || PLATFORM_WEBGL || UNITY_EDITOR
namespace WeChatWASM
{
    public class WXRuntimeExtDef
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void OnWXRuntimeExtDefLoadRuntimeMethod()
        {
            Init();
        }

        private static void Init()
        {

#if UNITY_2018_1_OR_NEWER
            WXRuntimeExtEnvDef.SETDEF("UNITY_2018_1_OR_NEWER", true);
#else
            WXRuntimeExtEnvDef.SETDEF("UNITY_2018_1_OR_NEWER", false);
#endif

#if UNITY_2020_1_OR_NEWER
            WXRuntimeExtEnvDef.SETDEF("UNITY_2020_1_OR_NEWER", true);
#else
            WXRuntimeExtEnvDef.SETDEF("UNITY_2020_1_OR_NEWER", false);
#endif

#if UNITY_2021_1_OR_NEWER
            WXRuntimeExtEnvDef.SETDEF("UNITY_2021_1_OR_NEWER", true);
#else
            WXRuntimeExtEnvDef.SETDEF("UNITY_2021_1_OR_NEWER", false);
#endif
#if UNITY_2021_2_OR_NEWER
            WXRuntimeExtEnvDef.SETDEF("UNITY_2021_2_OR_NEWER", true);
#else
            WXRuntimeExtEnvDef.SETDEF("UNITY_2021_2_OR_NEWER", false);
#endif
#if UNITY_2021_3_OR_NEWER
            WXRuntimeExtEnvDef.SETDEF("UNITY_2021_3_OR_NEWER", true);
#else
            WXRuntimeExtEnvDef.SETDEF("UNITY_2021_3_OR_NEWER", false);
#endif
#if UNITY_EDITOR_OSX
            WXRuntimeExtEnvDef.SETDEF("UNITY_EDITOR_OSX", true);
#else
            WXRuntimeExtEnvDef.SETDEF("UNITY_EDITOR_OSX", false);
#endif
#if UNITY_EDITOR_LINUX
            WXRuntimeExtEnvDef.SETDEF("UNITY_EDITOR_LINUX", true);
#else
            WXRuntimeExtEnvDef.SETDEF("UNITY_EDITOR_LINUX", false);
#endif
#if UNITY_2020
            WXRuntimeExtEnvDef.SETDEF("UNITY_2020", true);
#else
            WXRuntimeExtEnvDef.SETDEF("UNITY_2020", false);
#endif
#if UNITY_2021
            WXRuntimeExtEnvDef.SETDEF("UNITY_2021", true);
#else
            WXRuntimeExtEnvDef.SETDEF("UNITY_2021", false);
#endif
#if UNITY_2022
            WXRuntimeExtEnvDef.SETDEF("UNITY_2022", true);
#else
            WXRuntimeExtEnvDef.SETDEF("UNITY_2022", false);
#endif
#if UNITY_2022_2_OR_NEWER
            WXRuntimeExtEnvDef.SETDEF("UNITY_2022_2_OR_NEWER", true);
#else
            WXRuntimeExtEnvDef.SETDEF("UNITY_2022_2_OR_NEWER", false);
#endif
#if UNITY_INSTANTGAME
            WXRuntimeExtEnvDef.SETDEF("UNITY_INSTANTGAME", true);
#else
            WXRuntimeExtEnvDef.SETDEF("UNITY_INSTANTGAME", false);
#endif
#if WEIXINMINIGAME
            WXRuntimeExtEnvDef.SETDEF("WEIXINMINIGAME", true);
#else
            WXRuntimeExtEnvDef.SETDEF("WEIXINMINIGAME", false);
#endif
#if TUANJIE_2022_3_OR_NEWER
            WXRuntimeExtEnvDef.SETDEF("TUANJIE_2022_3_OR_NEWER", true);
#else
            WXRuntimeExtEnvDef.SETDEF("TUANJIE_2022_3_OR_NEWER", false);
#endif

#if PLATFORM_WEIXINMINIGAME
            WXRuntimeExtEnvDef.SETDEF("PLATFORM_WEIXINMINIGAME", true);
#else
            WXRuntimeExtEnvDef.SETDEF("PLATFORM_WEIXINMINIGAME", false);
#endif

#if PLATFORM_WEBGL
            WXRuntimeExtEnvDef.SETDEF("PLATFORM_WEBGL", true);
#else
            WXRuntimeExtEnvDef.SETDEF("PLATFORM_WEBGL", false);
#endif
            RegisterController();
        }

        private static void RegisterController()
        {
            // Example: 
            /*
            WXRuntimeExtDef.RegisterAction("xxx", (args) =>
            {
#if UNITY_2018
                return 1;
#else
                return 0; 
#endif
            });
            */
            WXRuntimeExtEnvDef.RegisterAction("Unity.GetObjectInstanceID", (args) =>
            {
#if UNITY_2021_3_OR_NEWER
                if (args is UnityEngine.Object unityObject)
                {
                    return unityObject.GetInstanceID();
                }
#endif
                // unityObject.GetInstanceID() would never return 0. 
                return 0;
            });
        }
    }

}

#endif