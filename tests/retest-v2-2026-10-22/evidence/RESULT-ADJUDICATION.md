# V2 原始结果复核与判定更正

日期：2026-10-22；适用分支：`work/onedrive-file-manager`
本轮实测：Windows GitHub Actions run [39726553781](https://github.com/zy19970/IPSys/actions/runs/39726553781)，源码基线 `02289ea7020861360baa0a4c49ca045f3c783aea`。原始旧结果与证据文件保留不动；新结果单独存放于 `evidence/runs/v2ci-39726553781-1/`。

## R-08：原 BUG-017 判定为误报

`ui-tree-smoke.cjs` 中的 `f:2:1` 与 `f:3:2` 分别对应 `linkId=2` 与 `linkId=3`，属于两个独立附件。原断言没有把同一 linkId 的每个版本要求为多行。因此撤销 BUG-017，R-08 保持 PASS。现有 smoke 未覆盖同一 linkId 多版本折叠；BUG-002 由 T-P0-02 的独立动态证据确认。

## T-P2-07：旧 PASS 证据不足；本轮有效复测 PASS

旧版脚本只查询“档案-01”，不足以证明附件映射。本轮 HTTP 实测返回 2 条文件命中，分别属于 IP-A 与 IP-B；IP-A 命中包含 `ownerKind=ip`、`ownerId=19`，不存在词返回空数组。Edge 层精确命中 `a:achievement:10` 并跳转；“综合资料附件.txt”映射到真实节点 `f:6:1`、`fileId=5`、`linkId=6`、所属记录 `g:21`。HTTP 与浏览器两层均 PASS，CSV 当前状态为 PASS，不再 BLOCKED。

## T-P2-09：旧 PASS 无效；本轮确认 BUG-018

本轮使用有效两页 PDF fixture，下载接口返回 HTTP 200、844 字节。Edge 预览仍停留在“正在解析 PDF…”，页码为“加载中”，Canvas 为初始 `300×150`，两页均未完成渲染。宿主日志记录 `/pdfjs/pdf.min.js` 成功加载，但没有后续 `/pdfjs/pdf.worker.min.js` 请求。

源码复核发现 `frontend/explorer/js/interactions.js` 的 `previewFile()` 只执行 `pdfViewer = viewer.create(body, buffer)`，没有调用 `pdfViewer.open()`。`src/IPSys.Web/wwwroot/pdf-preview.js` 中 `create()` 只创建界面并返回 `{open,destroy}`，`getDocument()` 和 `renderPage()` 均在 `open()` 内。因此这次失败归因于产品集成缺陷，而非 PDF fixture；登记为 BUG-018。修复后仍须重跑两页渲染测试。

## T-P1-02：复合用例不等于已确认 BUG-007

整体删项目后合同不单列、恢复项目后合同回来，HTTP 证据为 PASS。单独删除合同后的回收站 UI 行为仍未独立复测，因此该子项继续 BLOCKED，不确认 BUG-007。

## 当前统计口径

38 项总数不变。当前状态为 PASS 7、CONFIRMED_BUG 8、IMPLEMENTATION_GAP 6、DOC_GAP 1、BLOCKED 16；有效结论 22 项，BLOCKED 16 项。方法分布为 `DYNAMIC-BROWSER` 9、`DYNAMIC-HTTP` 4、`STATIC` 3、`MIXED` 9、未指定 13。

当前缺陷目录包含 14 个编号：BUG-004 为上轮已证实、本轮未复跑；BUG-007 与 BUG-017 已撤销；BUG-018 为本轮新增。R-02 保留为实现缺口，R-07 保留为文档缺口。

## 本轮证据

- 分层结果：`http-results.json`、`browser-results.json`。
- 关键文本证据：`T-P2-07-http.txt`、`T-P2-07.txt`、`T-P2-09.txt`。
- 截图与完整宿主日志：[Actions artifact（30 天保留）](https://github.com/zy19970/IPSys/actions/runs/39726553781/artifacts/12403621382)。
- Windows CI 总结成功仅代表构建与测试执行流程完成；产品层仍有 8 项确认缺陷及 6 项实现缺口。