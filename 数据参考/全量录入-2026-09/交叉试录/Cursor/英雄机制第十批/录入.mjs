// 默认只读；未获得明确放行时 --apply 在任何HTTP请求前拒绝。无PUT/DELETE。
import {mkdir,writeFile} from 'node:fs/promises';
import {here,loadPlan,candidateFileSha256,writeAuthorization,createRequester,checkCatalogs,fullSnapshot,independentArithmetic,createMissing,verifySaved,appendDurable} from './录入工具.mjs';
const args=process.argv.slice(2);if(args.length>1||args.some(x=>x!=='--apply'))throw Error('只接受 --apply 或默认只读');
const apply=args.includes('--apply');if(apply&&writeAuthorization!==candidateFileSha256)throw Error('英雄10仅完成工具准备；尚未得到主负责人实际写入放行');
const {plan,bytes}=await loadPlan(),runId=new Date().toISOString().replace(/[:.]/g,'-'),runDir=new URL('执行记录/'+runId+'/',here);await mkdir(runDir,{recursive:true});await writeFile(new URL('候选快照.json',runDir),bytes,{flag:'wx'});
const {request,calls}=await createRequester(runDir,{apply}),report={startedAt:new Date().toISOString(),runId,candidateFileSha256,apply,mode:apply?'仅创建精确缺项':'只读计划',apiWrites:0,preflight:null,catalogs:null,candidateArithmetic:null,events:[],failedSkills:[],final:null,verification:null,errors:[],success:false};
const save=async()=>writeFile(new URL('执行结果.json',runDir),JSON.stringify({...report,httpSummary:{total:calls.length,methods:calls.reduce((m,x)=>(m[x.method]=(m[x.method]??0)+1,m),{}),statuses:calls.reduce((m,x)=>(m[x.status]=(m[x.status]??0)+1,m),{})}},null,2)+'\n');
try{
 report.candidateArithmetic=await independentArithmetic(plan,new URL('候选核算/',runDir));if(!report.candidateArithmetic.pass)throw Error('候选来源/独立数学检查失败');
 report.catalogs=await checkCatalogs(plan,request);report.preflight=await fullSnapshot(plan,request,{apply});await save();if(report.catalogs.failures.length||report.preflight.conflicts.length)throw Error('目录或现值冲突，不写业务数据');
 const missingCounts=report.preflight.missing.reduce((m,x)=>(m[x.kind]=(m[x.kind]??0)+1,m),{});if(report.preflight.readbacks.length===27&&(missingCounts.parameters!==143||missingCounts.formulas!==49||missingCounts.effects!==21))throw Error('首次27复用时缺项分类须为143/49/21');
 console.log(JSON.stringify({stage:'完整预检',reused:report.preflight.readbacks.length,missing:report.preflight.missing.length,missingCounts,apply}));
 if(apply){const result=await createMissing(plan,report.preflight,request,{journal:async e=>{report.events.push(e);await appendDurable(new URL('写入流水.jsonl',runDir),e);await save();if(e.match&&report.events.filter(x=>x.match).length%20===0)console.log(JSON.stringify({stage:'已回读补缺',confirmed:report.events.filter(x=>x.match).length}));}});report.failedSkills=result.failedSkills;report.final=await fullSnapshot(plan,request,{apply:true});report.verification=await verifySaved(plan,report.final,new URL('实值核算/',runDir));if(!report.verification.pass)throw Error('最终字段或实际表达式核算未通过');}
 report.success=true;
}catch(e){report.errors.push({name:e.name,message:e.message});}finally{report.apiWrites=calls.filter(x=>x.method==='POST').length;report.finishedAt=new Date().toISOString();await save();}
console.log(JSON.stringify({success:report.success,runId,apply,apiWrites:report.apiWrites,httpCalls:calls.length,reused:report.preflight?.readbacks.length,missingBefore:report.preflight?.missing.length,confirmed:report.events.filter(x=>x.match).length,failedSkills:report.failedSkills,missingAfter:report.final?.missing.length??null,conflictsAfter:report.final?.conflicts.length??null,errors:report.errors}));if(!report.success)process.exitCode=1;
