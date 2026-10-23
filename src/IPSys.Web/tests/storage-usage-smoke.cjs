/* SQLCipher storage UI contract — no synthetic 10 GB denominator. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const SHELL=path.resolve(__dirname,'../wwwroot');
const WEB=path.resolve(__dirname,'..');
const read=(f)=>fs.readFileSync(path.join(SHELL,f),'utf8');
const app=read('js/app.js'), store=read('js/store.js'), interactions=read('js/interactions.js');
const html=read('index.html');
const server=fs.readFileSync(path.join(WEB,'VaultStorageEndpoints.cs'),'utf8');
assert.match(server,/PRAGMA page_count;/);
assert.match(server,/PRAGMA freelist_count;/);
assert.match(server,/PRAGMA page_size;/);
assert.match(server,/v.Allowed\(ctx\)/);
assert.match(server,/Gate.WaitAsync/);
assert.match(server,/v.FileTaskActive/);
assert.match(store,/getJson\("\/api\/vault\/storage"\)/);
assert.match(app,/VaultStore\.storage/);
assert.match(app,/paintStorage\(\)/);
assert.match(app,/data-storage-total/);
assert.match(app,/data-storage-used/);
assert.match(app,/data-storage-free/);
assert.match(html,/id="storageSideSummary"/);
assert.match(html,/id="storageSideFree"/);
assert.ok(!app.includes('10 * GB'),'No fake 10 GB storage capacity denominator');
assert.ok(!app.includes('10 GB 参考刻度'),'No fake 10 GB capacity label');
assert.match(interactions,/void VaultStore\.refreshStorage\(\)/);
assert.match(interactions,/if \(st.state === "succeeded"\) void VaultStore\.refreshStorage\(\)/);

// Exercise real store validation and state propagation without a browser.
let paints=0;
let fixture={totalBytes:16384,usedBytes:12288,freeBytes:4096};
const ctx=vm.createContext({
  console, Date, Math, JSON, Set, Map, String, Number, Object, Array,
  Promise, Error, RegExp, Headers,
  sessionStorage:{removeItem(){},setItem(){},getItem:()=>null},
  window:{}, Drive:{paintStorage(){paints++;}},
  fetch:async()=>({ok:true,status:200,json:async()=>fixture}),
  setTimeout:()=>{throw Error('successful statistics request should not retry');}
});
for(const file of ['js/data.js','js/store.js'])
  vm.runInContext(read(file),ctx,{filename:file});
(async()=>{
  const state=await vm.runInContext(`(async()=>{
    VaultStore.token='test';
    await VaultStore.refreshStorage();
    return VaultStore.storage;
  })()`,ctx);
  assert.equal(state.total,16384);
  assert.equal(state.used,12288);
  assert.equal(state.free,4096);
  assert.equal(paints,1,'UI refreshes when fresh values arrive');
  const afterSwitch=vm.runInContext(`(VaultStore.ws='company', VaultStore.storage.total)`,ctx);
  assert.equal(afterSwitch,16384,'Both workspaces share the same database allocation');
  fixture={totalBytes:16384,usedBytes:16384,freeBytes:1};
  await vm.runInContext('VaultStore.refreshStorage()',ctx);
  assert.equal(vm.runInContext('VaultStore.storage.free',ctx),4096,
    'A malformed response must not overwrite valid storage values');
  assert.equal(vm.runInContext('VaultStore.storageError',ctx),'数据库空间暂不可用');
  console.log('STORAGE USAGE SMOKE PASS: whole-vault accounting, cache and validation');
})().catch(error=>{console.error(error);process.exitCode=1;});
