# IPSys Explorer V2 Windows 实测复测记录

执行编号：`39726553781`（run attempt 1）
分支：`work/onedrive-file-manager`
本次执行提交：`4a2a7a2ee93bc42d7b63db1346de5d0a79fde7b0`
被测产品源码基线：`02289ea7020861360baa0a4c49ca045f3c783aea`（本轮未修改产品业务代码）
结果 artifact：[IPSys-Explorer-V2-Retest-39726553781-1](https://github.com/zy19970/IPSys/actions/runs/39726553781/artifacts/12403621382)，保留 30 天。

## 执行结论

Windows 工作流成功完成：Debug 构建、Release 单文件发布与产物检查、MCP stdio 握手、8 项 Node 冒烟测试、SQLCipher/HTTP smoke，以及隔离临时资料库上的 HTTP 和 Edge CDP 动态复测。完整截图、fixture 日志与宿主日志保存在 Actions artifact 中。

本轮产生 13 条 HTTP 层结果（PASS 8、IMPLEMENTATION_GAP 4、BLOCKED 1）与 12 条浏览器层结果（PASS 3、CONFIRMED_BUG 7、FAIL 1、IMPLEMENTATION_GAP 1）。将两层结果合并到 38 项用例后，当前状态为 PASS 7、CONFIRMED_BUG 8、IMPLEMENTATION_GAP 6、DOC_GAP 1、BLOCKED 16。

## 关键结果

1. **P0 目录树 BUG-001 复现**：后端返回完整 `parentId` 链 `1 → 8 → 9`，Edge 树中却看不到 `af:8/af:9`，最深记录被提升到分类根。
2. **P0 版本折叠 BUG-002 复现**：IP-A 的同一 `linkId` 仍显示 v1（22 B）与 v2（37 B）两行。
3. **P0 批量删除 BUG-003 复现**：服务端已删除全部关联，但 UI 仍显示两行，并只提示「关联已解除。」。
4. **T-P2-07 搜索映射 PASS**：HTTP 返回 IP-A 的 `ownerKind=ip, ownerId=19`；Edge 将档案精确跳转到 `a:achievement:10`，并把综合资料附件映射到 `fileId=5, linkId=6, parentId=g:21`。
5. **T-P2-09 确认 BUG-018**：有效 PDF 下载 200、844 字节，但 UI 仍为“加载中/正在解析 PDF…”，两页均未渲染。

## BUG-018 根因

`frontend/explorer/js/interactions.js` 的 `previewFile()` 只调用 `viewer.create(body, buffer)` 并保存返回对象，没有调用 `pdfViewer.open()`。`src/IPSys.Web/wwwroot/pdf-preview.js` 的 `create()` 只创建 UI 并返回 `{open,destroy}`；PDF.js `getDocument()` 与 `renderPage()` 均在 `open()` 内执行。宿主日志有 `/pdfjs/pdf.min.js` 的 200 请求，但没有 `/pdfjs/pdf.worker.min.js` 请求，与解析流程未启动的根因吻合。

本轮只确认并记录 BUG-018，没有修复产品源码。修复后必须重新运行两页 PDF 渲染回归。

## 文件索引

- `http-results.json`：本轮 13 条 HTTP 层原始结果。
- `browser-results.json`：本轮 12 条 Edge 浏览器层原始结果。
- `T-P2-07-http.txt` / `T-P2-07.txt`：搜索归属字段与浏览器跳转证据摘录。
- `T-P2-09.txt`：PDF 两页渲染失败的具体页码、状态与 Canvas 尺寸。
- `IPSys_Explorer_Full_Retest_V2_Cases.csv`：合并后的 38 项结果快照。
- 截图与完整日志：[Actions artifact](https://github.com/zy19970/IPSys/actions/runs/39726553781/artifacts/12403621382)。