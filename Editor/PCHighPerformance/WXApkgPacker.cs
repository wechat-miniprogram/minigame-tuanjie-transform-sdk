using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;

namespace WeChatWASM
{
    /// <summary>
    /// wxapkg 文件打包器
    /// 将目录内容打包成 .wxapkg 格式
    /// 
    /// wxapkg 格式结构：
    /// 1. 头部段 (14 字节)
    ///    - 起始标志: 1 字节 (0xBE)
    ///    - 未知字段: 4 字节 (固定为 0)
    ///    - 结束标志: 1 字节 (0xED)
    ///    - 索引段长度: 4 字节 (大端序)
    ///    - 数据段长度: 4 字节 (大端序)
    /// 2. 索引段
    ///    - 文件数量: 4 字节 (大端序)
    ///    - 文件信息块序列（每个文件）：
    ///      - 文件名长度: 4 字节 (大端序)
    ///      - 文件名: 可变长度 (UTF-8)
    ///      - 文件偏移: 4 字节 (大端序)
    ///      - 文件长度: 4 字节 (大端序)
    /// 3. 数据段
    ///    - 实际文件内容的二进制数据
    /// </summary>
    public static class WXApkgPacker
    {
        private const byte HEADER_MARK_START = 0xBE;
        private const byte HEADER_MARK_END = 0xED;
        private const int HEADER_SIZE = 14;

        /// <summary>
        /// 文件信息结构
        /// </summary>
        private class FileInfo
        {
            public string RelativePath;  // 相对路径（以 / 开头）
            public string FullPath;      // 完整路径
            public int Size;             // 文件大小
            public int Offset;           // 在数据段中的偏移
        }

        /// <summary>
        /// 将目录打包成 wxapkg 文件
        /// </summary>
        /// <param name="sourceDir">源目录路径</param>
        /// <param name="outputPath">输出的 wxapkg 文件路径</param>
        /// <returns>是否成功</returns>
        public static bool Pack(string sourceDir, string outputPath)
        {
            try
            {
                if (!Directory.Exists(sourceDir))
                {
                    Debug.LogError($"[WXApkgPacker] 源目录不存在: {sourceDir}");
                    return false;
                }

                // 收集所有文件信息
                var files = CollectFiles(sourceDir);
                if (files.Count == 0)
                {
                    Debug.LogError($"[WXApkgPacker] 目录为空: {sourceDir}");
                    return false;
                }

                Debug.Log($"[WXApkgPacker] 收集到 {files.Count} 个文件");

                // 构建索引段
                byte[] indexData = BuildIndexSection(files);

                // 构建数据段
                byte[] dataSection = BuildDataSection(files);

                // 构建头部
                byte[] header = BuildHeader(indexData.Length, dataSection.Length);

                // 确保输出目录存在
                string outputDir = Path.GetDirectoryName(outputPath);
                if (!string.IsNullOrEmpty(outputDir) && !Directory.Exists(outputDir))
                {
                    Directory.CreateDirectory(outputDir);
                }

                // 写入文件
                using (var fs = new FileStream(outputPath, FileMode.Create, FileAccess.Write))
                {
                    fs.Write(header, 0, header.Length);
                    fs.Write(indexData, 0, indexData.Length);
                    fs.Write(dataSection, 0, dataSection.Length);
                }

                long totalSize = header.Length + indexData.Length + dataSection.Length;
                Debug.Log($"[WXApkgPacker] 打包完成: {outputPath}");
                Debug.Log($"[WXApkgPacker] 文件大小: {totalSize / 1024.0 / 1024.0:F2} MB");

                return true;
            }
            catch (Exception e)
            {
                Debug.LogError($"[WXApkgPacker] 打包失败: {e.Message}");
                Debug.LogException(e);
                return false;
            }
        }

        /// <summary>
        /// 收集目录下所有文件
        /// </summary>
        private static List<FileInfo> CollectFiles(string sourceDir)
        {
            var files = new List<FileInfo>();
            var allFiles = Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories);

            foreach (var filePath in allFiles)
            {
                // 跳过 .DS_Store 等隐藏文件
                string fileName = Path.GetFileName(filePath);
                if (fileName.StartsWith("."))
                {
                    continue;
                }

                // 计算相对路径（使用正斜杠，以 / 开头）
                string relativePath = filePath.Substring(sourceDir.Length);
                relativePath = relativePath.Replace('\\', '/');
                if (!relativePath.StartsWith("/"))
                {
                    relativePath = "/" + relativePath;
                }

                var info = new System.IO.FileInfo(filePath);
                files.Add(new FileInfo
                {
                    RelativePath = relativePath,
                    FullPath = filePath,
                    Size = (int)info.Length
                });
            }

            // 按路径排序，保持一致性
            files.Sort((a, b) => string.Compare(a.RelativePath, b.RelativePath, StringComparison.Ordinal));

            return files;
        }

        /// <summary>
        /// 构建头部段 (14 字节)
        /// </summary>
        private static byte[] BuildHeader(int indexLength, int dataLength)
        {
            byte[] header = new byte[HEADER_SIZE];

            // 起始标志
            header[0] = HEADER_MARK_START;

            // 4 字节未知字段 (固定为 0)
            header[1] = 0;
            header[2] = 0;
            header[3] = 0;
            header[4] = 0;

            // 结束标志
            header[5] = HEADER_MARK_END;

            // 索引段长度 (大端序)
            WriteInt32BE(header, 6, indexLength);

            // 数据段长度 (大端序)
            WriteInt32BE(header, 10, dataLength);

            return header;
        }

        /// <summary>
        /// 构建索引段
        /// </summary>
        private static byte[] BuildIndexSection(List<FileInfo> files)
        {
            using (var ms = new MemoryStream())
            using (var writer = new BinaryWriter(ms))
            {
                // 文件数量 (大端序)
                WriteInt32BE(writer, files.Count);

                // 计算数据段起始偏移
                // 偏移量 = 头部大小 + 索引段大小
                // 需要先计算索引段大小
                int indexSize = 4; // 文件数量
                foreach (var file in files)
                {
                    byte[] nameBytes = Encoding.UTF8.GetBytes(file.RelativePath);
                    indexSize += 4 + nameBytes.Length + 4 + 4; // nameLen + name + offset + size
                }

                int dataOffset = HEADER_SIZE + indexSize;

                // 写入每个文件的索引信息
                foreach (var file in files)
                {
                    byte[] nameBytes = Encoding.UTF8.GetBytes(file.RelativePath);

                    // 文件名长度 (大端序)
                    WriteInt32BE(writer, nameBytes.Length);

                    // 文件名
                    writer.Write(nameBytes);

                    // 文件偏移 (大端序)
                    file.Offset = dataOffset;
                    WriteInt32BE(writer, dataOffset);

                    // 文件大小 (大端序)
                    WriteInt32BE(writer, file.Size);

                    // 更新下一个文件的偏移
                    dataOffset += file.Size;
                }

                return ms.ToArray();
            }
        }

        /// <summary>
        /// 构建数据段
        /// </summary>
        private static byte[] BuildDataSection(List<FileInfo> files)
        {
            using (var ms = new MemoryStream())
            {
                foreach (var file in files)
                {
                    byte[] content = File.ReadAllBytes(file.FullPath);
                    ms.Write(content, 0, content.Length);
                }

                return ms.ToArray();
            }
        }

        /// <summary>
        /// 写入 32 位大端序整数到字节数组
        /// </summary>
        private static void WriteInt32BE(byte[] buffer, int offset, int value)
        {
            buffer[offset] = (byte)((value >> 24) & 0xFF);
            buffer[offset + 1] = (byte)((value >> 16) & 0xFF);
            buffer[offset + 2] = (byte)((value >> 8) & 0xFF);
            buffer[offset + 3] = (byte)(value & 0xFF);
        }

        /// <summary>
        /// 写入 32 位大端序整数到流
        /// </summary>
        private static void WriteInt32BE(BinaryWriter writer, int value)
        {
            writer.Write((byte)((value >> 24) & 0xFF));
            writer.Write((byte)((value >> 16) & 0xFF));
            writer.Write((byte)((value >> 8) & 0xFF));
            writer.Write((byte)(value & 0xFF));
        }
    }
}
