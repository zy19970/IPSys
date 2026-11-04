"use strict";
const {EXPECTED,assertResults}=require("./result-gate.cjs");
const pass=scope=>EXPECTED[scope].map(id=>({
  id,result:"PASS",observed:"verified",expected:"required"
}));
function mustReject(label,scope,rows){
  let rejected=false;
  try{assertResults(scope,rows)}catch{rejected=true}
  if(!rejected)throw Error("Result gate missed "+label);
}
const http=pass("http"),browser=pass("browser");
assertResults("http",http);
assertResults("browser",browser);
function replace(rows,id,change){
  return rows.map(r=>r.id===id?{...r,...change}:r);
}
mustReject("HTTP FAIL","http",replace(http,"T-P1-03",{result:"FAIL"}));
mustReject("HTTP ERROR","http",replace(http,"R-03",{result:"ERROR"}));
mustReject("nonheadline browser FAIL","browser",
  replace(browser,"T-P2-07",{result:"FAIL"}));
mustReject("missing browser case","browser",browser.slice(1));
mustReject("duplicate HTTP case","http",[...http,http[0]]);
mustReject("unknown HTTP case","http",[...http,
  {id:"not-in-suite",result:"PASS"}]);
mustReject("unapproved BLOCKED","browser",
  replace(browser,"T-P2-07",{result:"BLOCKED"}));
mustReject("other HTTP BLOCKED","http",
  replace(http,"T-P1-03",{result:"BLOCKED"}));
const allowed=replace(http,"T-P1-07",{
  result:"BLOCKED",
  observed:"合成数据库 VACUUM 窗口过短，无法抓拍",
  expected:"等待人工观察进度"
});
assertResults("http",allowed);
mustReject("allowed BLOCKED without reason","http",
  replace(allowed,"T-P1-07",{observed:""}));
console.log("RESULT GATE NEGATIVE TEST PASS");
