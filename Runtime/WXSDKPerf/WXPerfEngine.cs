
using System;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Xml;
using UnityEngine;
using UnityEngine.Scripting;

#if PLATFORM_WEIXINMINIGAME || PLATFORM_WEBGL || UNITY_EDITOR
using WXPerf;

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

            m_PerfEngineImplementation.Annotation(InAnnotationString);
#endif
        }

        /// <summary>
		/// 声明自定义性能指标
		/// </summary>
		/// <param name="inStatName">性能指标名称</param>
		/// <param name="inStatCategory">性能指标类别</param>
        public static void DeclareCustomStatInfo(string inStatName, string inStatCategory = "", int inStatInterpType = 1)
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
        /// 设置自定义性能值，目前只支持浮点数
        /// 如果未进行指标声明，将自动声明该指标，对应指标将出现在报告的“Project Default Stat Category”中
        /// </summary>
        /// <param name="inStatName">性能指标名称</param>
        /// <param name="inStatCategory">性能指标类别</param>
        /// <param name="inStatInterpType">性能指标展示方式，1. 线性插值；2. Step插值；0. 只显示单一值</param>
        public static void SetCustomStatInfo(string inStatName, float inValue)
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

        /// <summary>
		/// 指定 lua State.
		/// </summary>
		/// <param name="L">lua_State</param>
        public static void SetLuaState(IntPtr L)
        {
#if UNITY_EDITOR
	        return; 
#else
	        m_PerfEngineImplementation.SetLuaState(L);
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
                UnityEngine.Debug.LogError("AddCustomStatInfo: Invalid m_PerfEngineImplementation! ");
                return;
            }

            m_PerfEngineImplementation.AddCustomStatInfoBy(inStatName, inValue);
#endif
        }
    }

}
#endif

#endif // ENABLE_WX_PERF_FEATURE