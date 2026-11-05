"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"../wwwroot");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const source=fs.readFileSync(path.join(root,"js/interactions.js"),"utf8");
const ids=["setChangePassword","changePasswordMask","changePasswordForm",
  "passwordCurrent","passwordNew","passwordNewConfirm","passwordChangeAck",
  "passwordChangeMsg","passwordChangeCancel","passwordChangeSubmit"];
for(const id of ids)assert(html.includes('id="'+id+'"'),"missing password UI: "+id);
for(const id of ["passwordCurrent","passwordNew","passwordNewConfirm"]){
 const el=html.match(new RegExp('<input[^>]*id="'+id+'"[^>]*>'));
 assert(el&&el[0].includes('type="password"'),
   "sensitive values must be password fields: "+id);
}
assert(source.includes('"/api/vault/change-password"'),
  "frontend must call the authenticated server-side SQLCipher key rotation endpoint");
assert(source.includes('sessionStorage.removeItem("od-token")'),
  "success should clear existing browser token");
assert(source.includes('sessionStorage.removeItem("od-db")'));
assert(source.includes('sessionStorage.setItem("ipsys.passwordChangeNotice"'));
assert(source.includes('if ($("#changePasswordMask")?.classList.contains("show"))'),
  "Escape should honor the password modal before handling settings");

const begin=source.indexOf("let passwordChangeBusy = false;");
const end=source.indexOf("/* 头像菜单和设置面板共用同一段关库逻辑 */",begin);
assert(begin>0 && end>begin);
const classes=new Set();
function field(id){
 return {
   id,value:"",checked:false,disabled:false,textContent:"",className:"",
   focus(){this.focused=true;},
   reset(){for(const x of ["passwordCurrent","passwordNew","passwordNewConfirm"]){
     nodes[x].value="";
   }nodes.passwordChangeAck.checked=false;},
   classList:{add(name){classes.add(name);},remove(name){classes.delete(name);}},
 };
}
const nodes={};for(const id of ids)nodes[id]=field(id);
const messages=new Map();
const store=new Map();
let reloads=0, requests=0, locked=false, failure=false;
const ctx={
  $:id=>nodes[id.slice(1)],
  sessionStorage:{
    removeItem(key){messages.delete(key);},
    setItem(key,value){messages.set(key,value);},
  },
  VaultStore:{
    token:"existing-token",
    async api(path,options){
      assert.equal(path,"/api/vault/change-password");
      assert.equal(options.method,"POST");
      assert(options.json.currentPassword&&options.json.newPassword);
      assert.equal(options.json.newPassword,options.json.confirmPassword);
      requests++;
      if(failure)throw Error("密码错误");
      return {json:async()=>({ok:true,locked:true})};
    },
    async status(){return {unlocked:!locked};},
  },
  location:{reload(){reloads++;}},
  console,
};
vm.createContext(ctx);
vm.runInContext(source.slice(begin,end),ctx,{filename:"password-settings.js"});
async function submit(){return vm.runInContext("submitChangePassword({preventDefault(){}})",ctx);}
function populate(){
 nodes.passwordCurrent.value="original-secret";
 nodes.passwordNew.value="新的强密码!123";
 nodes.passwordNewConfirm.value="新的强密码!123";
 nodes.passwordChangeAck.checked=true;
}
(async()=>{
 vm.runInContext("openChangePassword()",ctx);
 assert(classes.has("show")&&nodes.passwordCurrent.focused);
 await submit();
 assert.equal(requests,0,"invalid input must not be posted");
 populate();nodes.passwordNewConfirm.value="mismatch";
 await submit();
 assert.equal(requests,0,"mismatched confirmations must be local-only");
 populate();nodes.passwordChangeAck.checked=false;
 await submit();
 assert.equal(requests,0,"acknowledgment required");
 populate();failure=true;
 await submit();
 assert.equal(requests,1);
 assert.equal(reloads,0,"failed change may not revoke browser login");
 assert.equal(nodes.passwordCurrent.value,"");
 assert.equal(nodes.passwordNew.value,"");
 assert.match(nodes.passwordChangeMsg.textContent,/密码错误/);

 populate();failure=false;
 await submit();
 assert.equal(requests,2);
 assert.equal(reloads,1,"successful rekey requires a fresh login");
 assert.equal(messages.get("ipsys.passwordChangeNotice"),
   "资料库密码修改成功，请使用新密码重新打开。");
 assert.equal(ctx.VaultStore.token,"");
 assert.equal(nodes.passwordCurrent.value,"");
 assert.equal(nodes.passwordNew.value,"");
 assert.equal(nodes.passwordNewConfirm.value,"");
 vm.runInContext("closeChangePassword()",ctx);
 assert.equal(classes.has("show"),false);
 console.log("VAULT PASSWORD SETTINGS UI SMOKE PASS: masked inputs, validation, error, successful re-login and credential clearing");
})().catch(e=>{console.error(e);process.exitCode=1;});
