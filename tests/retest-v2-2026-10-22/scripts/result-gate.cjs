"use strict";
const fs=require("node:fs");

// Enumerate every current obligatory case, not just the S5 headline cases.
const EXPECTED=Object.freeze({
  http:Object.freeze([
    "T-P0-01#backend","T-P0-02#api","T-P0-03","T-P0-05",
    "T-P1-02#cascade","T-P1-03","R1-HTTP","R1-PURGE","T-P1-04","T-P1-05","T-P1-07",
    "T-P2-07","T-P2-12","R-03","R-05"
  ]),
  browser:Object.freeze([
    "T-P1-01","T-UI-SELECT-ALL","T-P0-01","T-P0-02","T-P0-03",
    "T-P2-01","T-P2-02","T-P2-03","T-P2-04","T-P2-06",
    "T-P2-07","T-P2-09","T-P2-11","S5-E2E"
  ])
});
const ALLOWED_BLOCKED=Object.freeze({
  http:new Set(["T-P1-07"]),
  browser:new Set()
});

function assertResults(scope,rows){
  const expected=EXPECTED[scope];
  if(!expected || !Array.isArray(rows))
    throw Error("Invalid results scope or JSON array: "+scope);
  const wanted=new Set(expected),seen=new Set();
  const allowed=ALLOWED_BLOCKED[scope];
  for(const item of rows){
    if(!item || typeof item.id!=="string" || !wanted.has(item.id))
      throw Error(scope+": unexpected or missing case id "+String(item?.id));
    if(seen.has(item.id))throw Error(scope+": duplicate case id "+item.id);
    seen.add(item.id);
    if(item.result==="PASS")continue;
    if(item.result==="BLOCKED" && allowed.has(item.id) &&
       typeof item.observed==="string" &&
       item.observed.includes("窗口过短") &&
       typeof item.expected==="string" && item.expected.trim())
      continue;
    throw Error(scope+": case "+item.id+" failed or unapproved status: "+
      String(item.result));
  }
  const missing=expected.filter(id=>!seen.has(id));
  if(missing.length)throw Error(scope+": missing mandatory cases: "+missing.join(","));
  return {scope,count:seen.size,blocked:rows.filter(x=>x.result==="BLOCKED").length};
}
module.exports={assertResults,EXPECTED};

if(require.main===module){
  try{
    const scope=process.argv[2],file=process.argv[3];
    if(!file)throw Error("Usage: node result-gate.cjs <http|browser> <results.json>");
    const result=assertResults(scope,JSON.parse(fs.readFileSync(file,"utf8")));
    console.log("RESULT GATE PASS",result);
  }catch(error){
    console.error("RESULT GATE FAIL:",error.message);
    process.exitCode=1;
  }
}
