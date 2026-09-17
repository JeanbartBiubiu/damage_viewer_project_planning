// 每次重新GET全部20主体、120列表及所有组成详情，再核算实际回读表达式。
import {writeFile} from 'node:fs/promises';
import {loadPlan,verifySources,fullSnapshot,checkCatalogs,verifySaved,here} from './录入工具.mjs';
if(process.argv.length>2)throw Error('独立回读无跳过缺项或忽略差异选项');
const {plan,planSha256}=await loadPlan(),out={startedAt:new Date().toISOString(),planSha256,boundary:'完整作者态GET及已保存表达式独立算术；不代表浏览器、Wasm或战斗运行通过。'};
try{out.sourceChecks=await verifySources(plan);out.catalogChecks=await checkCatalogs(plan);out.snapshot=await fullSnapshot(plan);out.verification=verifySaved(plan,out.snapshot);out.success=!out.catalogChecks.failures.length&&!out.verification.failures.length;}catch(error){out.error=String(error);out.success=false;}
out.finishedAt=new Date().toISOString();await writeFile(new URL('最终独立回读证据.json',here),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({success:out.success,skills:out.snapshot?.subjects.length,lists:out.snapshot?.lists.length,details:out.snapshot?.readbacks.length,missing:out.snapshot?.missing.length,conflicts:out.snapshot?.conflicts,arithmetic:out.verification?.arithmetic.length,invariants:out.verification?.invariants.length,error:out.error}));if(!out.success)process.exitCode=1;
