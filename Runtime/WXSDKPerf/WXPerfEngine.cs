#if ENABLE_WX_PERF_FEATURE

using System;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Xml;
using UnityEngine;
using UnityEngine.Scripting;
using WXPerf;

namespace WXSDKPerf
{
	[Preserve]
	[ComVisible(false)]
	public class WXPerfEngine
	{
		static WXPerfEngine_Implementation m_PerfEngineImplementation = null; 
		
        [RuntimeInitializeOnLoadMethod]
		public static void StartWXPerfEngine()
		{
#if UNITY_EDITOR
            return; 
#endif

            m_PerfEngineImplementation = new WXPerfEngine_Implementation();

            m_PerfEngineImplementation.StartPerfEngine(); 
		}


        public static void Annotation(string InAnnotationString)
        {
#if UNITY_EDITOR
            return; 
#endif
            if (m_PerfEngineImplementation == null)
            {
                UnityEngine.Debug.LogError("Annotation: Invalid m_PerfEngineImplementation! ");
                return;
            }

            m_PerfEngineImplementation.Annotation(InAnnotationString);
        }
    }

}
#endif // ENABLE_WX_PERF_FEATURE