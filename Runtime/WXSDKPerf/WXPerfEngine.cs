
using System;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Xml;
using UnityEngine;
using UnityEngine.Scripting;
using System.IO;


#if PLATFORM_WEIXINMINIGAME || PLATFORM_WEBGL || UNITY_EDITOR


#if ENABLE_WX_PERF_FEATURE
namespace WXSDKPerf
{
	[Preserve]
	[ComVisible(false)]
	public class WXPerfEngine
	{
#if !UNITY_EDITOR
		static WXPerfEngine_Implementation m_PerfEngineImplementation = null; 
#endif

        [RuntimeInitializeOnLoadMethod]
		public static void StartWXPerfEngine()
		{
#if UNITY_EDITOR
            return; 
#else
            m_PerfEngineImplementation = new WXPerfEngine_Implementation();
            m_PerfEngineImplementation.StartPerfEngine(); 
#endif
		}


        public static void Annotation(string InAnnotationString)
        {
#if UNITY_EDITOR
            return; 
#else
            if (m_PerfEngineImplementation == null)
            {
                UnityEngine.Debug.LogError("Annotation: Invalid m_PerfEngineImplementation! ");
                return;
            }

            if (InAnnotationString.Contains("CaptureUnityMemorySnapshot"))
			{
				TakeAndUploadUnityMemorySnapshot();
			}

            m_PerfEngineImplementation.Annotation(InAnnotationString);
#endif

        }

        private static void TakeAndUploadUnityMemorySnapshot()
        {
#if UNITY_EDITOR
            return;
#else
			DateTime timestamp = DateTime.Now;
			var dateString = timestamp.ToLocalTime().ToString("yyyy-MM-dd_HH-mm-ss", System.Globalization.CultureInfo.InvariantCulture);
			var snapshotFileName = $"{dateString}.snap"; 

#if UNITY_2018_3_OR_NEWER && !UNITY_2022_2_OR_NEWER
            UnityEngine.Profiling.Memory.Experimental.MemoryProfiler.TakeSnapshot(Path.Combine(Application.persistentDataPath, snapshotFileName), 
            WXPerfEngine_Implementation.CaptureSnapshotCallback, (UnityEngine.Profiling.Memory.Experimental.CaptureFlags)31);
            
#elif UNITY_2022_2_OR_NEWER
            Unity.Profiling.Memory.MemoryProfiler.TakeSnapshot(Path.Combine(Application.persistentDataPath, snapshotFileName), 
            WXPerfEngine_Implementation.CaptureSnapshotCallback, (Unity.Profiling.Memory.CaptureFlags)31);
#endif
#endif
        }
        
        public static void SetLuaState(IntPtr L)
        {
#if UNITY_EDITOR
            return; 
#else
            if (m_PerfEngineImplementation == null)
            {
                UnityEngine.Debug.LogError("SetLuaState: WXPerfEngine Not Started yet! Please Call WXSDKPerf.StartWXPerfEngine first! ");
                return;
            }

            m_PerfEngineImplementation.SetLuaState(L);
#endif
        }
    }

}
#endif

#endif // ENABLE_WX_PERF_FEATURE