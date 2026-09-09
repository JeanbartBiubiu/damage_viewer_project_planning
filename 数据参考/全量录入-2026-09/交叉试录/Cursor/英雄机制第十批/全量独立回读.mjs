// 单独进程、全部GET；完整替换实际参数与公式后求值，不引用上次写入响应代替实值。
import {mkdir,writeFile} from 'node:fs/promises';
import {here,loadPlan,candidateFileSha256,createRequester,checkCatalogs,fullSnapshot,verifySaved} from './录入工具.mjs';
if(process.argv.length!==2)throw Error('独立回读不接受任何写参数');
const {plan}=await loadPlan(),runId=new Date().toISOString().replace(/[:.]/g,'-'),runDir=new URL('独立回读/'+runId+'/',here);await mkdir(runDir,{recursive:true});
const {request,calls}=await createRequester(runDir),report={startedAt:new Date().toISOString(),runId,candidateFileSha256,apiWrites:0,catalogs:null,snapshot:null,verification:null,success:false,errors:[]};
try{report.catalogs=await checkCatalogs(plan,request);report.snapshot=await fullSnapshot(plan,request);report.verification=await verifySaved(plan,report.snapshot,new URL('实际表达式核算/',runDir));report.success=!report.catalogs.failures.length&&report.verification.pass;}catch(e){report.errors.push({name:e.name,message:e.message});}
report.finishedAt=new Date().toISOString();report.httpSummary={requests:calls.length,methods:calls.reduce((m,x)=>(m[x.method]=(m[x.method]??0)+1,m),{}),statuses:calls.reduce((m,x)=>(m[x.status]=(m[x.status]??0)+1,m),{})};await writeFile(new URL('独立全量回读.json',runDir),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({success:report.success,runId,apiWrites:0,requests:calls.length,subjects:report.snapshot?.subjects.length,collections:report.snapshot?.lists.length,details:report.snapshot?.readbacks.length,missing:report.snapshot?.missing.length,conflicts:report.snapshot?.conflicts.length,fields:report.verification?.fields,sourceCases:report.verification?.sourceCases?.length,cases:report.verification?.cases?.length,errors:report.errors}));if(!report.success)process.exitCode=1;
