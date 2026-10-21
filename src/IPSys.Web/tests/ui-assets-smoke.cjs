/* Shell asset contract.
   --------------------------------------------------------------------------
   The old UI smoke test read wwwroot/{index.html,app.js,style.css} and asserted
   the old shell's markup. Those files are gone: the shell now lives in
   frontend/explorer and is bundled into dist/ before every build. What still
   needs guarding is the wiring, and this file guards exactly that:

     A. assets      — what index.html loads, what the csproj embeds, what the
                      bundler is told to concatenate;
     B. bridge      — every free variable the capability layer expects the shell
                      to provide (two real outages came from this);
     C. freshness   — dist/ must equal a fresh bundle of the sources;
     D. invariants  — product rules that outlive any one shell.
   -------------------------------------------------------------------------- */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const SHELL=path.resolve(__dirname,'../../../frontend/explorer');
const WEB=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(SHELL,rel),'utf8');
const srcHtml=read('index.html');
const srcCss=read('css/app.css');
const csproj=fs.readFileSync(path.join(WEB,'IPSys.Web.csproj'),'utf8');
const bundle=read('tools/bundle.cjs');

/* ---------------- A. assets ---------------- */

assert.ok(srcHtml.includes('href="/style.css"'),'index.html must load the embedded stylesheet');
assert.ok(srcHtml.includes('src="/app.js"'),'index.html must load the bundled shell');
for(const file of ['/ip-v2.js','/upload-progress.js','/export.js','/pdf-preview.js'])
 assert.ok(srcHtml.includes('src="'+file+'"'),'index.html must load the capability script '+file);

for(const asset of ['index.html','style.css','app.js'])
 assert.ok(csproj.includes('..\\..\\frontend\\explorer\\dist\\'+asset)&&
  csproj.includes('LogicalName="IPSys.Web.Embedded.'+asset+'"'),
  'The csproj must embed dist/'+asset+' under its original logical name');
/* Everything else the server serves still comes straight from wwwroot. */
for(const asset of ['ip-v2.js','upload-progress.js','export.js','pdf-preview.js'])
 assert.ok(csproj.includes('Include="wwwroot\\'+asset+'"'),
  'The capability script '+asset+' must stay embedded from wwwroot');
assert.ok(csproj.includes('BundleExplorerShell')&&csproj.includes('BeforeTargets="BeforeBuild"'),
 'The bundle must run before the build, otherwise dist/ goes stale on the first edit');

/* Every shell module must be listed, and nothing may be listed twice: a source
   file that exists but is never bundled fails silently at runtime, which is the
   single easiest way to break this shell. */
const order=[...bundle.matchAll(/"js\/([\w.-]+\.js)"/g)].map(m=>m[1]);
assert.ok(order.length>0,'tools/bundle.cjs must declare a concatenation order');
assert.equal(new Set(order).size,order.length,'No module may be listed twice in ORDER');
const onDisk=fs.readdirSync(path.join(SHELL,'js')).filter(f=>f.endsWith('.js')).sort();
assert.deepEqual(order.slice().sort(),onDisk,
 'ORDER must list exactly the modules that exist in js/ (add new files to tools/bundle.cjs)');
/* Load order is semantic, not alphabetical. These three pairs would break at
   runtime if reversed, so pin them here instead of hoping nobody reshuffles. */
const at=rel=>order.indexOf(rel);
assert.ok(at('store.js')<at('app.js'),'store.js must define VaultStore before app.js renders');
assert.ok(at('bridge.js')<at('interactions.js'),
 'bridge.js must define the capability adapter before interactions.js uses it');
assert.equal(order.at(-1),'interactions.js','Event wiring must run last');

/* ---------------- B. the capability bridge ---------------- */

const bridge=read('js/bridge.js');
/* export.js calls `notice(message, bad)` and `api(url, {signal})` as free
   variables. Deleting the old shell removed both, and neither failure was
   obvious: one produced an empty report, the other made every file in a ZIP
   export fail individually. */
assert.match(bridge,/function notice\s*\(/,'export.js calls the shell global notice()');
assert.match(bridge,/async function api\s*\(/,'export.js calls the shell global api()');
/* ip-v2.js requires a hybrid request object, not a plain function. */
assert.match(bridge,/uploadProgress:\s*globalThis\.IPSysUploadProgress/,
 'ip-v2.js reads api.uploadProgress for progress, cancel and signals');
assert.match(bridge,/async uploadFile\s*\(/,'ip-v2.js calls api.uploadFile for streamed bodies');
const interactions=read('js/interactions.js');
assert.match(interactions,/window\.IPSysPdfViewer/,'PDF preview must use the packaged canvas viewer');
assert.match(bridge,/globalThis\.IPSysExport/,'ZIP export must go through IPSysExport');
assert.match(bridge,/globalThis\.IPSysNativeIp/,'Uploads must go through the native V2 adapter');
assert.match(interactions,/exportNodes\s*\(/,'Selection and folder downloads must go through the exporter');
assert.match(interactions,/uploadAttachments\s*\(/,'File picks must go through the bridged upload path');

/* The capability layer must define the globals the bridge reaches for. */
const GLOBALS={ 'wwwroot/ip-v2.js':'IPSysNativeIp',
 'wwwroot/upload-progress.js':'IPSysUploadProgress',
 'wwwroot/export.js':'IPSysExport',
 'wwwroot/pdf-preview.js':'IPSysPdfViewer' };
for(const [rel,name] of Object.entries(GLOBALS)){
 const code=fs.readFileSync(path.join(WEB,rel),'utf8');
 assert.ok(new RegExp('(const|var|let|window\\.)["\\s]*'+name+'\\s*=|'+name+'\\s*=\\s*\\(').test(code)
  ||code.includes(name),
  rel+' must still expose '+name);
}

/* Contracts hang off a project, which makes them an export owner and an upload
   target. Dropping "contract" from either list does not fail loudly: the node
   still renders, but its originals quietly disappear from every download and
   every upload silently refuses. The detail panel also offers 修改 on any
   record carrying a biz id, so a kind without a form is a dead button. */
assert.match(bridge,/EXPORTABLE_KINDS\s*=\s*new Set\(\[[^\]]*"contract"/,'Contracts must stay exportable');
assert.match(bridge,/UPLOADABLE_KINDS\s*=\s*\[[^\]]*"contract"/,'Contracts must accept attachments');
assert.match(read('js/forms.js'),/if \(kind === "contract"\) return this\.contract\(node\)/,
 'Contracts need an edit form: 修改 is offered on every record with a biz id');
const store=read('js/store.js');
assert.ok(store.includes('contracts/${w}'),'The tree must load contracts, otherwise none of this is reachable');
assert.ok(store.includes('contractsByProject'),'Contracts must be attached to their project, not left loose');

/* ---------------- C. freshness ---------------- */

const dist=path.join(SHELL,'dist');
if(!fs.existsSync(path.join(dist,'app.js')))
 execFileSync(process.execPath,[path.join(SHELL,'tools/bundle.cjs')],{stdio:'ignore'});

const header='/* 资料库前端 — 由 tools/bundle.cjs 生成,请勿直接编辑。\n   源文件: '+order.map(f=>'js/'+f).join(' → ')+' */\n';
const expected=header+order.map(f=>'\n/* ===== js/'+f+' ===== */\n'+read('js/'+f)).join('\n');
assert.equal(fs.readFileSync(path.join(dist,'app.js'),'utf8'),expected,
 'dist/app.js is stale — run node frontend/explorer/tools/bundle.cjs');
assert.equal(fs.readFileSync(path.join(dist,'style.css'),'utf8'),srcCss,
 'dist/style.css is stale — run node frontend/explorer/tools/bundle.cjs');
assert.equal(fs.readFileSync(path.join(dist,'index.html'),'utf8'),srcHtml,
 'dist/index.html is stale — run node frontend/explorer/tools/bundle.cjs');
assert.ok(fs.statSync(path.join(dist,'app.js')).size>90*1024,
 'The bundled shell is suspiciously small; a module probably failed to load');

/* ---------------- D. invariants that outlive the shell ---------------- */

assert.ok(!srcHtml.includes('onclick='),'No inline script handlers: CSP allows script-src self only');
const shellSources=(()=>{const out=[];(function walk(dir){
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const full=path.join(dir,entry.name);
  if(entry.isDirectory())walk(full);
  else if(entry.name.endsWith('.js'))out.push(fs.readFileSync(full,'utf8'));
 }return out;})(path.join(SHELL,'js'));return out.join('\n');})();
assert.ok(!/fetch\s*\(\s*['"`]https?:/.test(shellSources),'The browser must never call an external service');
assert.ok(!shellSources.includes('/api/exit'),'The web UI must not expose a process-exit endpoint');
assert.ok(!srcHtml.includes('知识产权与资料管理系统'),'The retired product name must not return');
assert.ok(/const esc\s*=/.test(shellSources)||/function esc\s*\(/.test(shellSources),
 'Record and attachment names are untrusted and must be escaped');
/* Switching workspace while a file task is streaming would send the remaining
   requests to the new workspace with folder ids from the old one. */
const switchAt=interactions.indexOf('async function switchWorkspace(');
assert.ok(switchAt>0,'switchWorkspace must exist');
const switchBody=interactions.slice(switchAt,interactions.indexOf('\n}\n',switchAt));
assert.ok(switchBody.includes('fileTaskBusy()'),
 'switchWorkspace must refuse to switch while an upload or export is running');
assert.ok(switchBody.indexOf('fileTaskBusy()')<switchBody.indexOf('VaultStore'),
 'The file-task guard must come before any request against the new workspace');
assert.ok(!interactions.includes("createElement('iframe')")&&!interactions.includes('createElement("iframe")'),
 'PDF preview must stay on the canvas renderer; the Chromium plugin cannot be styled or released');

/* ---------------- E. MCP independence ----------------
   The local MCP channel is stdio (-mcp) -> named pipe -> the host's own HTTP API.
   It shares no code with the browser shell, so a shell swap must not be able to
   take it down. Two invariants keep it that way:
   1. the -mcp branch must return BEFORE any embedded page asset is read, so a
      broken/missing dist cannot stop an Agent from connecting;
   2. the pipe host must still be started by the GUI host. */
const program=fs.readFileSync(path.join(WEB,'Program.cs'),'utf8');
const mcpBranch=program.indexOf('args.Contains("--mcp")');
const firstAsset=program.indexOf('EmbeddedWebAssets.Read(');
assert.ok(mcpBranch>0,'Program.cs must keep the --mcp stdio branch');
assert.ok(firstAsset>0&&mcpBranch<firstAsset,
 '--mcp must exit before any EmbeddedWebAssets.Read: the MCP bridge cannot depend on '+
 'the browser shell assets, or a stale dist/ would break every Agent connection');
assert.ok(program.includes('McpLocal.RunHostAsync('),
 'The GUI host must still start the named-pipe MCP host');
assert.ok(!fs.readdirSync(path.join(WEB,'wwwroot')).some(f=>/^mcp/i.test(f)),
 'MCP must not grow a browser-side script; it is a local Agent channel');

console.log('UI ASSETS SMOKE PASS: load order, bridge globals, fresh bundle, product invariants, MCP independence');
