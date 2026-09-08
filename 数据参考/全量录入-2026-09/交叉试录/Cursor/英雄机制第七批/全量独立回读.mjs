// 独立重新GET全部组成，逐字段相同后，使用实际回读表达式执行独立算例。
import {mkdir,writeFile} from 'node:fs/promises';
import {loadPlan,verifySources,checkCatalogs,fullSnapshot,verifySaved,here} from './录入工具.mjs';
if(process.argv.length!==2)throw Error('独立回读只读，不接受任何写参数');
const {plan,planSha256}=await loadPlan(),runId=new Date().toISOString().replace(/[:.]/g,'-'),runDir=new URL('独立回读/'+runId+'/',here);await mkdir(runDir,{recursive:true});
const sources=await verifySources(plan),catalogs=await checkCatalogs(plan),snapshot=await fullSnapshot(plan),verification=await verifySaved(plan,snapshot,new URL('实际表达式核算/',runDir)),report={at:new Date().toISOString(),runId,planSha256,boundary:'全部请求GET；字段与算例通过也不表示技能条件已接线或战斗执行通过。',sources,catalogs,snapshot,verification};
report.success=catalogs.failures.length===0&&verification.failures.length===0;const bytes=JSON.stringify(report,null,2)+'\n';await writeFile(new URL('独立全量回读.json',runDir),bytes);await writeFile(new URL('独立全量回读.json',here),bytes);
console.log(JSON.stringify({success:report.success,runId,planSha256,subjects:snapshot.subjects.length,collections:snapshot.lists.length,details:snapshot.readbacks.length,missing:snapshot.missing.length,conflicts:snapshot.conflicts.length,fields:verification.fields,arithmetic:verification.arithmetic.length,invariants:verification.invariants.length}));if(!report.success)process.exitCode=1;
