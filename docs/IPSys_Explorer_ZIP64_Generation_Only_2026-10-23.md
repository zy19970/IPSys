# Explorer 第三批 ZIP64：只验证实际生成，解包由用户人工确认

依据用户 2026-10-23 的最新验收要求，ZIP64 剩余项调整为：**从生产导出逻辑真正生成超过 4 GiB 的 ZIP 文件，并确认实际物理字节、ZIP64 EOCD/locator、中央目录和两份不同来源的数据字节抽样。** 这不包括 7-Zip 自动解包，不以源程序模拟文件头代替落盘，也不宣称已完成 Windows 原生选择文件窗口的实机交互。

## 已有与新增验证范围

`src/IPSys.Web/tests/zip64-smoke.cjs` 已验证 ZIP64 数值与头部函数。新增 `src/IPSys.Web/tests/zip64-real-generate.cjs` 从正式 `wwwroot/export.js` 调用 `IPSysExport.start("zip", selected)`，向真实文件提供两份大小均为 2 GiB + 80 MiB 的独立、可重复流式内容，确保生成文件总长超过 4 GiB。保存完成后核对 ZIP64 结束记录、定位器、中央目录实际偏移、各文件长度和文件起始样本，并对**实际磁盘 ZIP 全文件**流式计算 SHA-256，生成 JSON 证据。

此项使用模拟的流式 HTTP 响应和程序化磁盘写入适配层，但 ZIP 字节由生产 ZIP64 写入函数生成，文件确实占用物理磁盘空间。它**不是** Explorer UI、Windows `showSaveFilePicker`、SQLCipher 原件链路或第三方解压器测试。CI 标识 `PASS_GENERATION_ONLY`，不得上升为完整端到端通过。

## 本机保留文件供用户手动解包

在仓库根目录打开 PowerShell，先确认空闲空间至少约 5 GiB，并可执行：

```powershell
$env:IPSYS_ZIP64_OUTPUT_DIR = "D:\IPSys-QA\zip64"
node src/IPSys.Web/tests/zip64-real-generate.cjs
```

成功后本机保留 `IPSys-actual-over-4GiB.zip` 和 `zip64-generation-evidence.json`。用户可使用自己熟悉的 Windows 解压软件手动查看/解压；验证目录内包含 `ZIP64-QA-project-1/source-101.bin` 与 `ZIP64-QA-project-2/source-102.bin`，各约 2.08 GiB。可用证据 JSON 中的 `sourceSha256` 结合解压后文件哈希对比。不能因尚未解包而认定 ZIP64 互操作已通过。

Windows CI 仅在显式 `zip64_file_smoke` 输入或提交标题包含 `[zip64-real-test]` 时运行这一昂贵测试，运行后只保留 JSON 证据，清理 CI 临时的大 ZIP 文件。
