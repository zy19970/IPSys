# 生成 38 项用例表。保留原始 JSON；仅对旧版证据中的已知误判作显式复核。
import json, csv, collections, os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
RUNID = os.environ.get('IPSYS_RETEST_RUN_ID', '')
E = Path(os.environ.get('IPSYS_EVIDENCE_DIR', ROOT / 'evidence'))
OUT = Path(os.environ.get('IPSYS_CASES_OUTPUT', ROOT / 'IPSys_Explorer_Full_Retest_V2_Cases.csv'))
with open(E / 'http-results.json', encoding='utf-8') as f:
    http = {r['id']: r for r in json.load(f)}
with open(E / 'browser-results.json', encoding='utf-8') as f:
    br = {r['id']: r for r in json.load(f)}

rows = []
RESULT_SOURCES = {
    'T-P0-01': [('http', 'T-P0-01#backend'), ('browser', 'T-P0-01')],
    'T-P0-02': [('http', 'T-P0-02#api'), ('browser', 'T-P0-02')],
    'T-P0-03': [('http', 'T-P0-03'), ('browser', 'T-P0-03')],
    'T-P0-05': [('http', 'T-P0-05')],
    'T-P1-01': [('browser', 'T-P1-01')],
    'T-P1-03': [('http', 'T-P1-03')],
    'T-P1-04': [('http', 'T-P1-04')],
    'T-P1-05': [('http', 'T-P1-05')],
    'T-P1-07': [('http', 'T-P1-07')],
    'T-P2-01': [('browser', 'T-P2-01')],
    'T-P2-02': [('browser', 'T-P2-02')],
    'T-P2-03': [('browser', 'T-P2-03')],
    'T-P2-04': [('browser', 'T-P2-04')],
    'T-P2-06': [('browser', 'T-P2-06')],
    'T-P2-07': [('http', 'T-P2-07'), ('browser', 'T-P2-07')],
    'T-P2-09': [('browser', 'T-P2-09')],
    'T-P2-11': [('browser', 'T-P2-11')],
    'T-P2-12': [('http', 'T-P2-12')],
    'R-03': [('http', 'R-03')],
    'R-05': [('http', 'R-05')],
}
def live_records(case_id):
    out = []
    for source, result_id in RESULT_SOURCES.get(case_id, []):
        record = (http if source == 'http' else br).get(result_id)
        if record:
            out.append((source, record))
    return out
def add(i, p, f, m, res, did, att, obs, exp, ev, src, notes=''):
    records = live_records(i)
    if records:
        raw = [r.get('result', 'BLOCKED') for _, r in records]
        if any(x in ('FAIL', 'CONFIRMED_BUG') for x in raw):
            res = 'CONFIRMED_BUG'
        elif any(x == 'IMPLEMENTATION_GAP' for x in raw):
            res = 'IMPLEMENTATION_GAP'
        elif any(x == 'DOC_GAP' for x in raw):
            res = 'DOC_GAP'
        elif any(x == 'BLOCKED' for x in raw):
            res = 'BLOCKED'
        elif all(x == 'PASS' for x in raw):
            res = 'PASS'
        if res in ('PASS', 'BLOCKED'):
            did = '-'
        try:
            att = str(int(att) + 1)
        except (TypeError, ValueError):
            att = '1'
        if len(records) > 1:
            m = 'MIXED'
            obs = '；'.join(('HTTP' if source == 'http' else '浏览器') + '：' + str(r.get('observed', ''))
                            for source, r in records)
        else:
            m = records[0][1].get('method', m)
            obs = records[0][1].get('observed', obs)
        if RUNID:
            evidence_base = f'evidence/runs/{RUNID}/'
            if i in ('T-P0-01', 'T-P0-02', 'T-P0-03', 'T-P2-07') and len(records) > 1:
                ev = f'{evidence_base}{i}.txt; {evidence_base}{i}-http.txt'
            elif (E / f'{i}.txt').exists():
                ev = f'{evidence_base}{i}.txt'
        if i == 'T-P2-07' and len(records) > 1:
            m = 'MIXED'
    rows.append([i, p, f, m, res, did, att, obs, exp, ev, src, notes])

add('T-P0-01','P0','三级业务档案','MIXED','CONFIRMED_BUG','BUG-001','2',br['T-P0-01']['observed'],'每层都在树中，记录归属最深处','evidence/T-P0-01.txt','frontend/explorer/js/store.js buildTree')
add('T-P0-02','P0','附件多版本折叠','MIXED','CONFIRMED_BUG','BUG-002','2',br['T-P0-02']['observed'],'同一 linkId 一条可见附件，默认最新版','evidence/T-P0-02.txt','frontend/explorer/js/store.js:281,296')
add('T-P0-03','P0','同一 LinkId 重复删除','MIXED','CONFIRMED_BUG','BUG-003','2',br['T-P0-03']['observed'],'不得多次 DELETE 同一 linkId；失败要给成功/失败数','evidence/T-P0-03.txt','frontend/explorer/js/interactions.js deleteNodes')
add('T-P0-04','P0','任务占用时关库','DYNAMIC-BROWSER','BLOCKED','BUG-004','0','本轮未复跑；上轮限速上传制造真实 409 已证实','拒绝后不得清 token/reload，需显示原因','evidence/BLOCKED-LIST.md','frontend/explorer/js/interactions.js lockVault','上轮证据 build-retest/agent-explorer-check/evidence/T-P0-04-lockvault-real.txt')
add('T-P0-05','P0','跨记录引用','MIXED','IMPLEMENTATION_GAP','BUG-005','1',http['T-P0-05']['observed'],'FileId 可复用且 LinkId 独立；UI 有通用入口','evidence/T-P0-05.txt','frontend/explorer/js/bridge.js associateOriginal')
add('T-P1-01','P1','首次创建新库','DYNAMIC-BROWSER','IMPLEMENTATION_GAP','BUG-006','1',br['T-P1-01']['observed'],'登录页提供创建资料库入口（UI_BASELINE §2.1）','evidence/T-P1-01.txt','frontend/explorer/js/interactions.js:270-280','违反冻结基线，不只是“探索未发现”')
add('T-P1-02','P1','合同两种回收站情况','MIXED','BLOCKED','-','1','①整体删除项目 PASS（回收站只有 project，恢复后合同回来）；②单独删合同的 UI 本轮未复跑','①整体删除项目后合同随项目恢复；②单独删合同的回收站呈现与恢复行为需独立验证','evidence/T-P1-02.txt','src/IPSys.Web/RecycleStore.cs; frontend/explorer/js/store.js','复合用例：①已 PASS；②未完成 UI 复测，暂不确认 BUG-007')
add('T-P1-03','P1','复制/转移','MIXED','IMPLEMENTATION_GAP','BUG-008','1',http['T-P1-03']['observed'],'前端有复制/转移入口','evidence/T-P1-03.txt','grep transfer 零命中')
add('T-P1-04','P1','档案目录 CRUD','MIXED','IMPLEMENTATION_GAP','BUG-009','1',http['T-P1-04']['observed'],'自建目录有新建/更名/移动/删除入口','evidence/T-P1-04.txt','frontend/explorer/js/interactions.js:1047,1334')
add('T-P1-05','P1','手工持久排序','MIXED','IMPLEMENTATION_GAP','BUG-010','1',http['T-P1-05']['observed'],'用户可调 position 且重启保持','evidence/T-P1-05.txt','frontend/explorer/js/app.js 排序菜单')
add('T-P1-06','P1','单接口故障注入','-','BLOCKED','BUG-011','0','未执行：需 CDP 拦截单接口后重载','部分加载失败要可见并可重试','evidence/BLOCKED-LIST.md','frontend/explorer/js/store.js loadAll','本轮上下文不足以安全完成')
add('T-P1-07','P1','压缩期间切工作区/关库','DYNAMIC-HTTP','BLOCKED','-','1',http['T-P1-07']['observed'],'压缩中切工作区有明确说明，关库不得假关闭','evidence/T-P1-07.txt','src/IPSys.Web/VaultCompactJob.cs','测试库 33MB 但未 purge，reusableBytes=0')
add('T-P1-08','P1','ZIP 导出未完成时切工作区','-','BLOCKED','BUG-012','0','未执行：需要真实多文件 ZIP 导出链路','导出中切换被阻止或明确提示','evidence/BLOCKED-LIST.md','frontend/explorer/js/bridge.js fileTaskBusy')
add('T-P1-09','P1','Node 缺失/旧 dist','-','BLOCKED','-','0','未执行：需隔离副本 + 子进程 PATH 模拟','无 dist 明确报错；旧 dist 有警告','evidence/BLOCKED-LIST.md','src/IPSys.Web/IPSys.Web.csproj:50-61','安全替代法见任务书 §7.2，本轮未跑')
add('T-P1-10','P1','A 上传新版本 / B 关联同步','-','BLOCKED','-','0','A/B 均未本轮复跑（上轮 A 仅静态 PASS）','A 保存后刷新为最新版；B 目标记录自动出现','evidence/BLOCKED-LIST.md','frontend/explorer/js/bridge.js','A PASS 不推出 B PASS')
add('T-P2-01','P2','右键重命名 / F2 / 修改','DYNAMIC-BROWSER','CONFIRMED_BUG','BUG-013','1',br['T-P2-01']['observed'],'真正改名，或不误导','evidence/T-P2-01.txt','frontend/explorer/js/interactions.js:1060,1280')
add('T-P2-02','P2','真实拖放','DYNAMIC-BROWSER','CONFIRMED_BUG','BUG-014','1',br['T-P2-02']['observed'],'内部移动执行；后端已有 /associate?move=true','evidence/T-P2-02.txt','frontend/explorer/js/interactions.js:999-1004','提示语把责任推给不存在的后端缺口')
add('T-P2-03','P2','快捷访问添加按钮','DYNAMIC-BROWSER','CONFIRMED_BUG','BUG-015','1',br['T-P2-03']['observed'],'能添加自定义快捷方式，或按钮不可用','evidence/T-P2-03.txt','frontend/explorer/js/interactions.js:700')
add('T-P2-04','P2','首页导入资料','DYNAMIC-BROWSER','CONFIRMED_BUG','BUG-016','1',br['T-P2-04']['observed'],'不得无归属上传，应引导先选记录','evidence/T-P2-04.txt','frontend/explorer/js/interactions.js:1648-1652','REQUIREMENTS.md:30/153')
add('T-P2-05','P2','一般批量删除部分失败','-','BLOCKED','BUG-003','0','未执行：需 3 个不同 LinkId 且第二项受控失败','成功/失败数与刷新后真实结果一致','evidence/BLOCKED-LIST.md','frontend/explorer/js/interactions.js deleteNodes')
add('T-P2-06','P2','键盘/鼠标','DYNAMIC-BROWSER','PASS','-','1',br['T-P2-06']['observed'],'按预期执行','evidence/T-P2-06.txt','frontend/explorer/js/interactions.js bindKeyboard')
add('T-P2-07','P2','搜索与跳转','DYNAMIC-BROWSER','PASS','-','2',br['T-P2-07']['observed'],'命中映射到真实节点并跳转','evidence/T-P2-07.txt','frontend/explorer/js/store.js search')
add('T-P2-08','P2','Excel 端到端','-','BLOCKED','-','0','未执行：需真实 xlsx 导入与浏览器点击','合法/错误行/重复策略全部落库可查','evidence/BLOCKED-LIST.md','frontend/explorer/js/excel.js')
add('T-P2-09','P2','预览','DYNAMIC-BROWSER','PASS','-','1',br['T-P2-09']['observed'],'PDF/图片正确显示','evidence/T-P2-09.txt','vendor pdf-preview.js')
add('T-P2-10','P2','下载边界与中断','-','BLOCKED','-','0','未执行：需 31/33MiB 与拾取器桩','按字节核验，取消不留半成品','evidence/BLOCKED-LIST.md','frontend/explorer/js/interactions.js:1502')
add('T-P2-11','P2','响应式','DYNAMIC-BROWSER','PASS','-','1',br['T-P2-11']['observed'],'三种视口不溢出、不重叠','evidence/T-P2-11.txt','frontend/explorer/css')
add('T-P2-12','P2','Host/Origin/token','DYNAMIC-HTTP','PASS','-','1',http['T-P2-12']['observed'],'非法 Host/Origin 被拒，未授权不可访问','evidence/T-P2-12.txt','src/IPSys.Web/Program.cs:52-65')
add('T-P2-13','P2','离线单 EXE','-','BLOCKED','-','0','未执行：Release 单文件发布未跑','不依赖 CDN，断网可用','evidence/BLOCKED-LIST.md','src/IPSys.Web/IPSys.Web.csproj')
add('T-P2-14','P2','任务进度与恢复','-','BLOCKED','-','0','未执行：批量上传/彻底删除进度本轮未跑','100% 不等于成功，刷新后可接续','evidence/BLOCKED-LIST.md','frontend/explorer/js/bridge.js')
add('T-P2-15','P2','空数据与故障视觉','-','BLOCKED','BUG-011','0','未执行：与 T-P1-06 同一注入手段','空库与故障可区分','evidence/BLOCKED-LIST.md','frontend/explorer/js/app.js')
add('R-01','P1','一键清空回收站','-','BLOCKED','-','0','未执行：取消/确认/任务链路未跑','取消零修改，确认按任务提交并显示结果','evidence/BLOCKED-LIST.md','frontend/explorer/js/interactions.js:1409','按钮存在属允许功能，不记 BUG')
add('R-02','P1','Excel 导出范围','STATIC','IMPLEMENTATION_GAP','-','1','exportLedger 固定 {mode:"all",ids:null}，无范围选择控件','提供当前筛选/全部记录选择','evidence/R-02.txt','frontend/explorer/js/excel.js:43-58')
add('R-03','P1','文件归属与删除语义','DYNAMIC-HTTP','PASS','-','1',http['R-03']['observed'],'删一处不影响另一处；同名不共用','evidence/R-03.txt','src/IPSys.Web/NativeFileAssociateEndpoints.cs')
add('R-04','P1','展示排序语义','-','BLOCKED','-','0','未执行：混排只有后端证据，UI 无拖拽入口','目录与资料按 position 自由混排','evidence/T-P1-05.txt','UI_BASELINE.md §3')
add('R-05','P2','体积/最新版/历史版','DYNAMIC-HTTP','PASS','-','1',http['R-05']['observed'],'四项分别计量','evidence/R-05.txt','-')
add('R-06','P1','关闭/切换期间活动任务','-','BLOCKED','-','0','未执行：四种任务的 busy 行为未逐项跑','每项记录拒绝/阻塞/允许与反馈','evidence/BLOCKED-LIST.md','frontend/explorer/js/bridge.js fileTaskBusy')
add('R-07','P2','文档与最新决定','STATIC','DOC_GAP','-','1','REQUIREMENTS.md:195 仍写「不提供一键清空回收站」','仅一条 DOC_GAP，不改冻结需求','evidence/R-07.txt','REQUIREMENTS.md:85,195')
add('R-08','P1','版本折叠测试覆盖','STATIC','PASS','-','1','断言 f:2:1 与 f:3:2 的 linkId 分别为 2、3，是两个独立附件，不是同一附件的两个版本','同一 linkId 多版本折叠；不同 linkId 各保留一条可见附件','evidence/R-08.txt','src/IPSys.Web/tests/ui-tree-smoke.cjs:62-63','原 BUG-017 判定为误报；该 smoke 未覆盖同 linkId 多版本，专项动态测试仍由 T-P0-02 负责')

assert len(rows) == 38, f'应生成 38 项，实际 {len(rows)}'
assert len({r[0] for r in rows}) == len(rows), '用例 ID 必须唯一'
OUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUT,'w',encoding='utf-8',newline='') as f:
    w = csv.writer(f)
    w.writerow(['ID','Priority','Feature','Method','Result','DefectID','AttemptCount','Observed','Expected','Evidence','SourcePath','Notes'])
    w.writerows(rows)
print('rows', len(rows))
print('statuses', collections.Counter(r[4] for r in rows))
print('methods', collections.Counter(r[3] for r in rows))
