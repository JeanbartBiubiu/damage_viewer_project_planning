// 独立重新GET全部组成，逐字段相同后，使用实际回读表达式执行独立算例。
import {mkdir,writeFile} from 'node:fs/promises';
import {loadPlan,verifySources,checkCatalogs,fullSnapshot,verifySaved,here} from './录入工具.mjs';
if(process.argv.length!==2)throw Error('独立回读只读，不接受任何写参数');
const {plan,planSha256}=await loadPlan(),runId=new Date().toISOString().replace(/[:.]/g,'-'),runDir=new URL('独立回读/'+runId+'/',here);await mkdir(runDir,{recursive:true});
const report={at:new Date().toISOString(),runId,planSha256,apiWrites:0,boundary:'全部请求GET；字段与算例通过也不表示技能条件已接线或战斗执行通过。',sources:null,catalogs:null,snapshot:null,verification:null,errors:[],success:false};
try{
 report.sources=await verifySources(plan);report.catalogs=await checkCatalogs(plan);report.snapshot=await fullSnapshot(plan);report.verification=await verifySaved(plan,report.snapshot,new URL('实际表达式核算/',runDir));
 report.success=report.catalogs.failures.length===0&&report.verification.failures.length===0;
}catch(error){report.errors.push({message:String(error)});}
report.finishedAt=new Date().toISOString();const bytes=JSON.stringify(report,null,2)+'\n';await writeFile(new URL('独立全量回读.json',runDir),bytes);await writeFile(new URL('独立全量回读.json',here),bytes);
console.log(JSON.stringify({success:report.success,runId,planSha256,subjects:report.snapshot?.subjects.length,collections:report.snapshot?.lists.length,details:report.snapshot?.readbacks.length,missing:report.snapshot?.missing.length,conflicts:report.snapshot?.conflicts.length,fields:report.verification?.fields,arithmetic:report.verification?.arithmetic.length,invariants:report.verification?.invariants.length,errors:report.errors}));if(!report.success)process.exitCode=1;
