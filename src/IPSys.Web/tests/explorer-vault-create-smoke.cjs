/* Explorer F2-01: real login/create event handlers, not merely markup tests. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../wwwroot");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css/app.css"), "utf8");
const code = fs.readFileSync(path.join(root, "js/interactions.js"), "utf8");
const backend = fs.readFileSync(path.resolve(__dirname, "../SessionEndpoints.cs"), "utf8");

for (const marker of [
  'id="lockHeading"', 'id="lockForm"', 'id="switchLockMode"',
  'id="createConfirmField" hidden', 'id="confirmPassword"', 'id="submitOpen"',
]) assert.ok(html.includes(marker), "Missing vault UI element: " + marker);
assert.match(html, /<h1 id="lockHeading">打开资料库<\/h1>/,
  "Opening an existing vault remains the default screen");
assert.match(css, /\.lock-confirm\[hidden\]\s*\{\s*display:\s*none;\s*\}/,
  "Confirmation must stay hidden in default login mode");
assert.match(backend, /input\.Create\s*&&\s*File\.Exists\(path\)/,
  "Backend must reject creation over an existing encrypted database");

const start = code.indexOf("function bindLockScreen() {");
const stop = code.indexOf("function bindWorkspaceSwitch()", start);
assert.ok(start >= 0 && stop > start, "Cannot locate real vault login handler");
const handlers = new Map(), elems = new Map();
for (const id of ["#lockForm", "#switchLockMode", "#lockHeading", "#lockSub",
                  "#createConfirmField", "#confirmPassword", "#password",
                  "#dbPath", "#submitOpen", "#lockHint"]) {
  elems.set(id, {
    value: "", hidden: id === "#createConfirmField",
    disabled: false, textContent: "",
    addEventListener(name, listener) { handlers.set(id + ":" + name, listener); },
  });
}
elems.get("#dbPath").value = "C:\\TestVaults\\new.db";
const active = [], sessions = new Map(), navigation = [];
let shouldReject = false;
const vault = {
  needsResume: false, token: "", dbName: "",
  async open(...args) {
    active.push({type:"open",args});
    if (shouldReject) throw Error("文件已存在；不会覆盖原数据库。");
    this.token = "token-for-new-vault";
    this.dbName = "new.db";
  },
  async resume(password) {
    active.push({type:"resume",password});
    this.token = "resumed";
    this.dbName = "open.db";
  },
};
const sandbox = vm.createContext({
  $: id => elems.get(id) || null,
  VaultStore: vault,
  sessionStorage: { setItem: (k, v) => sessions.set(k, v) },
  defaultWorkspace: () => "personal",
  enterWorkspace: async ws => { navigation.push(ws); },
});
vm.runInContext(code.slice(start,stop), sandbox);
vm.runInContext("bindLockScreen()", sandbox);
const input = id => elems.get("#" + id);
const toggle = handlers.get("#switchLockMode:click");
const submit = handlers.get("#lockForm:submit");
assert.equal(typeof toggle,"function");
assert.equal(typeof submit,"function");
const fire = () => submit({ preventDefault() {} });

(async () => {
  assert.equal(input("createConfirmField").hidden,true);
  toggle();
  assert.equal(input("createConfirmField").hidden,false);
  assert.equal(input("submitOpen").textContent,"创建并打开");
  assert.equal(input("switchLockMode").textContent,"返回打开已有资料库");

  input("password").value = "first";
  input("confirmPassword").value = "different";
  await fire();
  assert.match(input("lockHint").textContent,/两次输入/);
  assert.equal(active.length,0,"Mismatch must not send network request");
  assert.equal(input("submitOpen").disabled,false);

  input("confirmPassword").value = "first";
  shouldReject = true;
  await fire();
  assert.equal(active.at(-1).args[2],true);
  assert.match(input("lockHint").textContent,/不会覆盖原数据库/);
  assert.equal(input("submitOpen").disabled,false);
  assert.equal(navigation.length,0,"Existing file must not unlock workspace");

  shouldReject = false;
  await fire();
  assert.deepEqual(active.at(-1).args,
    ["C:\\TestVaults\\new.db","first",true],"Create mode must send create:true");
  assert.equal(sessions.get("od-token"),"token-for-new-vault");
  assert.equal(sessions.get("od-db"),"new.db");
  assert.deepEqual(navigation,["personal"]);
  assert.equal(input("password").value,"");
  assert.equal(input("confirmPassword").value,"");

  // Successful login navigates away and intentionally leaves its submit
  // disabled; model a fresh login entry before testing another mode.
  input("submitOpen").disabled = false;
  toggle();
  assert.equal(input("createConfirmField").hidden,true);
  assert.equal(input("submitOpen").textContent,"打开");
  input("password").value="pass-old";
  await fire();
  assert.deepEqual(active.at(-1).args,
    ["C:\\TestVaults\\new.db","pass-old",false],
    "Normal opening must never accidentally request create:true");

  input("submitOpen").disabled = false; // another fresh login entry
  vault.needsResume = true;
  toggle();
  assert.equal(input("createConfirmField").hidden,true,
    "An already unlocked vault cannot enter create mode");
  input("password").value="pass-resume";
  await fire();
  assert.deepEqual(active.at(-1),{type:"resume",password:"pass-resume"},
    "Already-unlocked server must resume, not create or reopen");
  console.log("EXPLORER VAULT CREATE PASS: create entry, confirmation, no-overwrite, normal open and secure resume");
})().catch(e=>{console.error(e);process.exitCode=1;});
