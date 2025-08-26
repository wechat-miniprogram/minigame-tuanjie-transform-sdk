
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

        /// <summary>
        /// This method is used to add an annotation to the performance data.
        /// The annotation string is uploaded to the server along with the current frame ID.
        /// </summary>
        /// <param name="InAnnotationString">The annotation string to be added. It should not be null or empty.</param>
        /// <remarks>
        /// If the provided annotation string is null or empty, an error message will be logged.
        /// </remarks>
        public static void Annotation(string InAnnotationString)
        {
#if UNITY_EDITOR
            return; 
#else
            // Don't record annotation if we are not recording.
            if (!IsRecording())
            {
                return;
            }

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

        
        /// <summary>
        /// 检查是否正在录制性能数据
        /// </summary>
        /// <returns>如果正在录制返回true，否则返回false</returns>
        public static bool IsRecording()
        {
#if UNITY_EDITOR
            return false;
#else
            return m_PerfEngineImplementation != null && m_PerfEngineImplementation.IsRecording();
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

		/// <summary>
        /// 指定luaState
        /// </summary>
        /// <param name="L">luaState</param>
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
    
		/// <summary>
		/// 声明自定义性能指标
		/// </summary>
		/// <param name="inStatName">性能指标名称</param>
		/// <param name="inStatCategory">性能指标类别</param>
		/// <param name="inStatInterpType">性能指标展示方式，0. 不插值. 1. 线性插值；2. Step插值；</param>
		public static void DeclareCustomStatInfo(string inStatName, string inStatCategory, int inStatInterpType = 1)
		{
#if UNITY_EDITOR
            return; 
#else
            if (m_PerfEngineImplementation == null)
            {
                UnityEngine.Debug.LogError("DeclareCustomStatInfo: Invalid m_PerfEngineImplementation! ");
                return;
            }

            m_PerfEngineImplementation.DeclareCustomStatInfo(inStatName, inStatCategory, inStatInterpType);
#endif
		}

        /// <summary>
		/// 设置自定义性能指标，目前只支持浮点数
        /// 若该指标未通过DeclareCustomStatInfo进行类别的声明，则将被归为默认自定义类别，以及使用默认线性插值
		/// </summary>
		/// <param name="inStatName">性能指标名称</param>
		/// <param name="inValue">性能指标数值</param>
		public static void SetCustomStatValue(string inStatName, float inValue)
		{
#if UNITY_EDITOR
            return; 
#else
            if (m_PerfEngineImplementation == null)
            {
                UnityEngine.Debug.LogError("SetCustomStatInfo: Invalid m_PerfEngineImplementation! ");
                return;
            }

            m_PerfEngineImplementation.SetCustomStatInfo(inStatName, inValue);
#endif
		}

        /// 在自定义性能指标值的基础上增加一段数值。
        /// 如果未进行指标声明，将自动声明该指标，该指标将出现在报告的“Project Default Stat Category”中
        /// </summary>
        /// <param name="inStatName">性能指标名称</param>
        /// <param name="inValue">性能指标数值</param>
		public static void AddCustomStatInfoBy(string inStatName, float inValue)
		{
#if UNITY_EDITOR
            return; 
#else
            if (m_PerfEngineImplementation == null)
            {
                UnityEngine.Debug.LogError("AddCustomStatInfoBy: Invalid m_PerfEngineImplementation! ");
                return;
            }

            m_PerfEngineImplementation.AddCustomStatInfoBy(inStatName, inValue); 
#endif
			
		}


        /// <summary>
        /// 手动开始记录
        /// </summary>
        /// <param name="inEnableStackTrace">是否启用堆栈跟踪</param>
        /// <param name="inEnableStatInfo">是否启用统计信息</param>
        /// <param name="inFrequentScreenShot">是否频繁截图</param>
        /// <param name="inEnablebRenderInst">是否记录渲染指令</param>
        /// <param name="inEnableCaptureResource">是否启用资源捕获</param>
        /// <param name="inEnableLuaMemoryMonitor">是否启用Lua内存监控</param>
        /// <param name="inEnableLuaFunctionMemoryTracking">是否启用Lua函数内存跟踪</param>
        public static void StartRecordManually(bool inEnableStackTrace, bool inEnableStatInfo, bool inFrequentScreenShot, bool inEnablebRenderInst, 
            bool inEnableCaptureResource, bool inEnableLuaMemoryMonitor, bool inEnableLuaFunctionMemoryTracking)
        {
#if UNITY_EDITOR
            return; 
#else
            if (m_PerfEngineImplementation == null)
            {
                UnityEngine.Debug.LogError("StartRecordManually: Invalid m_PerfEngineImplementation! ");
                return;
            }

            m_PerfEngineImplementation.StartRecordManually(inEnableStackTrace, inEnableStatInfo, inFrequentScreenShot, inEnablebRenderInst, 
                inEnableCaptureResource, inEnableLuaMemoryMonitor, inEnableLuaFunctionMemoryTracking);
#endif
        }

        /// <summary>
        /// 手动停止记录
        /// </summary>
        public static void StopRecordManually()
		{
#if UNITY_EDITOR
            return; 
#else
            if (m_PerfEngineImplementation == null)
            {
                UnityEngine.Debug.LogError("StartRecordManually: Invalid m_PerfEngineImplementation! ");
                return;
            }

            m_PerfEngineImplementation.StopRecordManually();
#endif
		}
    }
}
#endif

#endif // ENABLE_WX_PERF_FEATURE