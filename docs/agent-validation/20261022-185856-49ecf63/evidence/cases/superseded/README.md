# superseded —— 被推翻的中间判定（不要当作最终结论）

这里的 JSON 是**同一用例的先前尝试**，判定后来被推翻。保留是为了让"改了什么"可追溯，不是结论。

| 文件 | 当时的判定 | 为什么推翻 | 最终判定 |
|---|---|---|---|
| `R-02.http3.json` | CONFIRMED_BUG / BUG-024 | 请求体写成 `{ids:[]}`，后端只认 `{Mode:"all"\|"filtered", Ids}`；改对后两条都 200 | PASS（`R-02.http4.json`） |
| `T-P1-07.http2.json` | CONFIRMED_BUG / BUG-021 | 压缩前没有可回收页，`reusableBytes=0`，等于没测到压缩 | PASS（`T-P1-07.http2b.json`，先造 8192 可回收字节再压） |
| `T-P2-10.http3.json` | CONFIRMED_BUG / BUG-025 | 拿的下载对象已被 S12 删进回收站，404 是正常的 | PASS（`T-P2-10.http4.json`，先 restore 再测） |
| `T-P2-15.http2.json` | TEST_ERROR | 空库建库时主库还开着，被 409 挡住 | PASS（`T-P2-15.http2b.json`，先 lock 再 open） |

因此 `BUG-021`、`BUG-024`、`BUG-025` **不是真实缺陷编号**，未进入 `DEFECTS.md`；`BUG-022` 从未占用。

对应测试器缺陷见 `TEST-DEFECTS.md`：TD-10（导出字段名）、TD-06/07（fixture 与顺序）、TD-11（对象已删）、TD-13（空库 409）。
