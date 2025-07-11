using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace WeChatWASM
{
    public class WXPlayableConvertCore
    {
        static WXPlayableConvertCore() { }
        public static WXPlayableEditorScriptObject config => UnityUtil.GetPlayableEditorConf();

        public static WXConvertCore.WXExportError DoExport(bool buildWebGL = true)
        {
            WXConvertCore.isPlayableBuild = true;
            // var preCheckResult = WXConvertCore.PreCheck();
            // if (preCheckResult != WXConvertCore.WXExportError.SUCCEED)
            // {
            //   WXConvertCore.isPlayableBuild = false;
            //   return preCheckResult;
            // }
            // WXConvertCore.PreInit();
            var exportResult = WXConvertCore.DoExport();

            WXConvertCore.isPlayableBuild = false;
            return exportResult;
        }

        public static WXEditorScriptObject GetFakeScriptObject()
        {
            return SetDefaultProperties(ConvertPlayableConfigToCommon(config));
        }

        public static WXEditorScriptObject ConvertPlayableConfigToCommon(
            WXPlayableEditorScriptObject source,
            WXEditorScriptObject target = null)
        {
            // 创建或使用现有的目标实例
            var newTarget = target ?? ScriptableObject.CreateInstance<WXEditorScriptObject>();

            // 使用序列化方式深度拷贝公共字段
            var so = new SerializedObject(newTarget);

            // 遍历源对象的所有字段
            var sourceType = source.GetType();
            foreach (var sourceField in sourceType.GetFields(
                System.Reflection.BindingFlags.Public |
                System.Reflection.BindingFlags.Instance |
                System.Reflection.BindingFlags.NonPublic))
            {
                // 跳过readonly字段
                if (sourceField.IsInitOnly) continue;

                // 查找目标对象中的对应字段
                var targetField = typeof(WXEditorScriptObject).GetField(
                    sourceField.Name,
                    System.Reflection.BindingFlags.Public |
                    System.Reflection.BindingFlags.Instance |
                    System.Reflection.BindingFlags.NonPublic);

                // if (targetField != null && !targetField.FieldType.IsValueType && !targetField.FieldType.IsEnum)
                // {
                //   // // 复制字段值
                //   // var value = sourceField.GetValue(source);
                //   // targetField.SetValue(newTarget, value);
                //   // 递归复制子对象属性
                //   var subObj = targetField.GetValue(newTarget) ?? Activator.CreateInstance(targetField.FieldType);
                //   CopySubObjectProperties(value, subObj);
                //   targetField.SetValue(newTarget, subObj);
                // }

                // if (targetField != null && 
                //     (targetField.FieldType.IsAssignableFrom(sourceField.FieldType) || 
                //     (targetField.FieldType.IsValueType && sourceField.FieldType.IsValueType && 
                //      targetField.FieldType == sourceField.FieldType)))
                // {
                // 复制字段值
                var value = sourceField.GetValue(source);
                // 特殊处理嵌套对象类型的字段
                if (value != null && !targetField.FieldType.IsValueType && !targetField.FieldType.IsEnum)
                {
                    // 递归复制子对象属性
                    var subObj = targetField.GetValue(newTarget) ?? Activator.CreateInstance(targetField.FieldType);
                    CopySubObjectProperties(value, subObj);
                    targetField.SetValue(newTarget, subObj);
                }
                else
                {
                    targetField.SetValue(newTarget, value);
                }
                // }
            }

            // 应用修改到序列化对象
            so.ApplyModifiedProperties();
            return newTarget;
        }

        private static void CopySubObjectProperties(object source, object target)
        {
            var sourceType = source.GetType();
            var targetType = target.GetType();

            foreach (var sourceField in sourceType.GetFields(
                System.Reflection.BindingFlags.Public |
                System.Reflection.BindingFlags.Instance |
                System.Reflection.BindingFlags.NonPublic))
            {
                if (sourceField.IsInitOnly) continue;

                var targetField = targetType.GetField(
                    sourceField.Name,
                    System.Reflection.BindingFlags.Public |
                    System.Reflection.BindingFlags.Instance |
                    System.Reflection.BindingFlags.NonPublic);

                if (targetField != null &&
                    (targetField.FieldType.IsAssignableFrom(sourceField.FieldType) ||
                    (targetField.FieldType.IsValueType && sourceField.FieldType.IsValueType &&
                     targetField.FieldType == sourceField.FieldType)))
                {
                    var value = sourceField.GetValue(source);
                    targetField.SetValue(target, value);
                }
            }
        }

        public static WXEditorScriptObject SetDefaultProperties(WXEditorScriptObject target)
        {
            target.ProjectConf.CDN = "";
            target.ProjectConf.assetLoadType = 1;
            target.ProjectConf.compressDataPackage = true;

            target.CompileOptions.showMonitorSuggestModal = false;
            return target;
        }
    }
}