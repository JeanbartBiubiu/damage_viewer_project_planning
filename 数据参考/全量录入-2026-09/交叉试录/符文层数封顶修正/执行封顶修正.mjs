import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=n=>JSON.parse(fs.readFileSync(path.join(here,n)));
const mode=process.argv[2]||'--preview';assert.ok(['--preview','--apply','--verify'].includes(mode));assert.ok(process.argv.length<=3);
const planBytes=fs.readFileSync(path.join(here,'可审查请求.json')),planSha=sha(planBytes);assert.equal(planSha,'9eedde869856eaf7fd119d4b1ad192fa4cba7509ddc6b9a8571ac7c261ee89d9');
const plan=JSON.parse(planBytes),approval=read('主审批准.json');assert.equal(approval.verdict,'READY');assert.equal(approval.requestSha256,planSha);assert.equal(plan.changes.length,3);
if(mode==='--apply')assert.ok(!fs.existsSync(path.join(here,'写入启动锁.json')),'存在启动锁，不重放；仅可只读对账');
const auth=process.env.RUNE_CAP_WRITE_TOKEN;assert.ok(auth,'缺少本地认证环境变量');
const original=read('独立审查/实际五项回读.json'),keys=['rune_8010_passive','rune_8008_passive'];
const relevant=original.reads.filter(r=>keys.some(k=>r.route===`/skills/${k}`||r.route.startsWith(`/skills/${k}/`)));assert.equal(relevant.length,44);
const changes=new Map(plan.changes.map(c=>[c.route,c]));
const run=new Date().toISOString().replace(/[-:.TZ]/g,''),reportName=`${mode.slice(2)}-${run}.json`,journal=`流水-${run}.jsonl`;
const report={startedAt:new Date().toISOString(),mode,planSha256:planSha,reads:[],writes:[],checks:[],summary:null};
const save=()=>fs.writeFileSync(path.join(here,reportName),JSON.stringify(report,null,2)+'\n');
function durable(value){const fd=fs.openSync(path.join(here,journal),'a');try{fs.writeSync(fd,JSON.stringify({at:new Date().toISOString(),...value})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function normalized(data){if(data&&typeof data==='object'&&!Array.isArray(data)&&typeof data.imageBase64==='string'){const clone={...data},raw=Buffer.from(clone.imageBase64.includes(',')?clone.imageBase64.split(',').at(-1):clone.imageBase64,'base64');delete clone.imageBase64;return{metadata:clone,byteCount:raw.length,contentSha256:sha(raw)};}return data;}
async function call(method,route,body){if(method!=='GET'){assert.equal(mode,'--apply');const allowed=changes.get(route);assert.ok(allowed&&method==='PUT');assert.deepEqual(body,allowed.body);}
 durable({phase:'before',method,route,...(body?{body}:{})});try{const res=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{method,headers:{Authorization:'Bearer '+auth,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const actual=normalized(await res.json());durable({phase:'after',method,route,status:res.status,actual});return{status:res.status,actual};}catch(e){durable({phase:'unknown',method,route,error:e.name});throw new Error(`${method} ${route} 结果未知 ${e.name}`);}}
async function get(route){const r=await call('GET',route);report.reads.push({at:new Date().toISOString(),route,...r});save();assert.equal(r.status,200,route);return r.actual;}
function expectFor(route,before,after,current){let expected=structuredClone(before);if(after&&changes.has(route)){expected={...expected,...changes.get(route).body};if(Object.hasOwn(expected,'updatedAt'))expected.updatedAt=current.updatedAt;return expected;}
 if(after&&Array.isArray(expected)&&route.endsWith('/formulas'))return expected.map(row=>{const c=changes.get(route+'/'+row.formulaKey);if(!c)return row;const answer={...row};for(const[k,v]of Object.entries(c.body))if(Object.hasOwn(row,k))answer[k]=v;if(Object.hasOwn(row,'updatedAt'))answer.updatedAt=current.find(v=>v.formulaKey===row.formulaKey).updatedAt;return answer;});return expected;}
async function checkRelevant(after,phase){const rows=[];for(const r of relevant){const actual=await get(r.route),expected=expectFor(r.route,r.data,after,actual);assert.deepEqual(actual,expected,r.route+' 全字段/原有列表投影');rows.push({route:r.route,actual});}report.checks.push({phase,routes:rows.length,fullFieldsMatched:true});return rows;}
async function protection(){const rows=[];for(const key of keys){const id=key.match(/^rune_(\d+)_passive$/)[1],runeKey='rune_'+id;const routes=[`/skills/${key}/representative-image`,`/runes/${runeKey}`,`/runes/${runeKey}/representative-image`,`/rune-skill-relations?runeKey=${runeKey}&skillKey=${key}`];for(const route of routes)rows.push({route,actual:await get(route)});const rep=rows.find(v=>v.route===routes[0]).actual;assert.ok(rep.image?.imageKey&&rep.image.enabled);for(const route of [`/images/${rep.image.imageKey}`,`/images/${rep.image.imageKey}/usages`])rows.push({route,actual:await get(route)});}return rows;}
try{
 if(mode==='--verify'){
  const baseline=read('写前保护快照.json');const current=await protection();assert.deepEqual(current,baseline.protection);await checkRelevant(true,'独立写后全量GET');report.summary={passed:true,mode,businessWrites:0,actualGET:report.reads.length,protectedRoutes:current.length,componentRoutes:44};
 }else{
  const protectedRows=await protection();await checkRelevant(false,'写前原44路由');
  if(mode==='--preview')report.summary={passed:true,mode,businessWrites:0,actualGET:report.reads.length,plannedPUT:3};
  else{
   fs.writeFileSync(path.join(here,'写前保护快照.json'),JSON.stringify({at:new Date().toISOString(),planSha256:planSha,protection:protectedRows,originalRelevantRoutes:relevant},null,2)+'\n',{flag:'wx'});
   fs.writeFileSync(path.join(here,'写入启动锁.json'),JSON.stringify({at:new Date().toISOString(),planSha256:planSha,replayForbidden:true},null,2)+'\n',{flag:'wx'});
   for(const c of plan.changes){const before=await get(c.route);assert.deepEqual(before,c.before,'单项写前完整对象不得漂移');let response,error;try{response=await call('PUT',c.route,c.body);}catch(e){error=e.message;}const after=await get(c.route),expected=expectFor(c.route,c.before,true,after);const row={route:c.route,method:'PUT',responseStatus:response?.status??null,unknownError:error??null,after,matched:false};report.writes.push(row);save();assert.deepEqual(after,expected,'写后实值与请求不符，禁止重放');row.matched=true;save();}
   fs.writeFileSync(path.join(here,'三项写入完成锁.json'),JSON.stringify({at:new Date().toISOString(),planSha256:planSha,writes:3,report:reportName,replayForbidden:true},null,2)+'\n',{flag:'wx'});
   await checkRelevant(true,'写后44路由');const afterProtection=await protection();assert.deepEqual(afterProtection,protectedRows);report.summary={passed:true,mode,businessWrites:3,actualGET:report.reads.length,protectedRoutes:12,componentRoutes:44};
  }
 }
 report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({file:reportName,...report.summary,reportSha256:sha(fs.readFileSync(path.join(here,reportName)))}));
}catch(e){report.failure={name:e.name,message:e.message};save();console.error(JSON.stringify({file:reportName,error:e.message,writesRecorded:report.writes.length,confirmedWrites:report.writes.filter(v=>v.matched).length}));process.exitCode=1;}
