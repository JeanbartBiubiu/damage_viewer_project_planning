// 默认完整只读预检；仅显式 --apply 创建缺项。没有PUT/DELETE路径。
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {loadPlan,assertPlanUnchanged,verifySources,fullSnapshot,checkCatalogs,createMissing,verifySaved,here} from './前十技能录入工具.mjs';
const args=process.argv.slice(2);if(args.some(a=>a!=='--apply'))throw Error('只接受显式--apply；不能跳过完整预检');
const apply=args.includes('--apply'),loaded=await loadPlan(),{plan,planSha256}=loaded,runId=new Date().toISOString().replace(/[:.]/g,'-'),runDir=new URL('执行记录/'+runId+'/',here);
await mkdir(runDir,{recursive:true});await writeFile(new URL('候选快照.json',runDir),loaded.bytes,{flag:'wx'});
const report={runId,startedAt:new Date().toISOString(),mode:apply?'显式仅创建缺项':'默认只读',planSha256,scope:Object.keys(plan.skills),preflight:null,sourceChecks:[],catalogChecks:null,events:[],failedSkills:[],final:null,errors:[]};
async function save(){const content=JSON.stringify(report,null,2)+'\n';await writeFile(new URL('执行结果.json',runDir),content);await writeFile(new URL(apply?'前十技能写入结果.json':'前十技能录入只读检查.json',here),content);}
try{
 report.sourceChecks=await verifySources(plan);report.catalogChecks=await checkCatalogs(plan);report.preflight=await fullSnapshot(plan);await writeFile(new URL('全量写前现值.json',runDir),JSON.stringify(report.preflight,null,2)+'\n',{flag:'wx'});await save();
 if(report.catalogChecks.failures.length||report.preflight.conflicts.length)throw Error('完整预检存在目录或现值冲突，未执行写入');
 console.log(JSON.stringify({stage:'完整预检',skills:report.preflight.subjects.length,lists:report.preflight.lists.length,same:report.preflight.readbacks.length,missing:report.preflight.missing.length,conflicts:0,apply}));
 if(apply){const result=await createMissing(plan,report.preflight,{assertFrozen:()=>assertPlanUnchanged(planSha256),journal:async event=>{report.events.push(event);await appendFile(new URL('写入流水.jsonl',here),JSON.stringify({runId,planSha256,...event})+'\n');await appendFile(new URL('写入流水.jsonl',runDir),JSON.stringify(event)+'\n');if(event.match===false)console.log(JSON.stringify({stage:'当前技能暂停',skill:event.skillKey,kind:event.kind,id:event.id,postStatus:event.postStatus,readbackStatus:event.readbackStatus,diff:event.diff}));}});report.failedSkills=result.failedSkills;report.final=await fullSnapshot(plan);report.verification=verifySaved(plan,report.final);await writeFile(new URL('最终全量回读.json',runDir),JSON.stringify({snapshot:report.final,verification:report.verification},null,2)+'\n');if(report.verification.failures.length)report.errors.push({finalVerificationFailures:report.verification.failures.length});}
}catch(error){report.errors.push({message:String(error)});}finally{report.finishedAt=new Date().toISOString();await save();}
console.log(JSON.stringify({mode:report.mode,runId,planSha256,newConfirmed:report.events.filter(e=>e.postStatus>=200&&e.postStatus<300&&e.match).length,reconciledAfterError:report.events.filter(e=>e.action==='创建响应异常后查询落地'&&e.match).length,failedSkills:report.failedSkills,finalMissing:report.final?.missing.length??null,finalConflicts:report.final?.conflicts.length??null,arithmetic:report.verification?.arithmetic.length??0,errors:report.errors}));
if(report.errors.length)process.exitCode=1;
