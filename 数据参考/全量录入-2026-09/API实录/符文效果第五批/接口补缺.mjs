import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2);assert.ok(args.length<=1&&args.every(a=>['--apply','--verify'].includes(a)),'默认只读预检；--apply补缺；--verify只读');
const mode=args[0]||'--preview',here=path.dirname(fileURLToPath(import.meta.url)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const bytes=fs.readFileSync(path.join(here,'最终请求.json'));assert.equal(sha(bytes),'1b03784e003fa63675b4665eac66f772b93f770dffd8c0b128888a3043384f44');
const plan=JSON.parse(bytes),baseline=JSON.parse(fs.readFileSync(path.join(here,'最终保护基线.json'))),version=JSON.parse(fs.readFileSync(path.join(here,'最终请求版本.json')));assert.equal(sha(fs.readFileSync(path.join(here,'最终保护基线.json'))),version.baselineSha256);
assert.equal(sha(fs.readFileSync(path.join(here,'可审查请求.json'))),'5fd438535c6133e2fb65bfc6a8bcb8a2df1caecc6f6df9c1c5df04f577003a61');assert.equal(sha(fs.readFileSync(path.join(here,'冻结来源.json'))),'878fd1147a277282f6bacd04ecddafe55e980e729a67d4469b31b2ff93d492a7');
assert.equal(plan.requests.length,174);assert.equal(plan.scope.length,12);assert.equal(plan.requests.filter(r=>r.kind==='parameter').length,105);assert.ok(!plan.requests.some(r=>r.body.parameterKey==='absorption_range'));
const token=process.env.RUNE5_API_TOKEN;assert.ok(token,'缺少本地认证环境变量');
const id=new Date().toISOString().replace(/[-:.TZ]/g,''),reportFile=path.join(here,`${mode.slice(2)}-${id}.json`),journal=path.join(here,`流水-${id}.jsonl`);
const report={startedAt:new Date().toISOString(),mode,requestSha256:sha(bytes),preflight:[],writes:[],reuse:[],finalReads:[],collections:[],protected:[],summary:null};
const safe=x=>Array.isArray(x)?x.map(safe):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([k])=>!['imageBase64','authorization','cookie','token'].includes(k.toLowerCase()==='imagebase64'?'imageBase64':k.toLowerCase())).map(([k,v])=>[k,safe(v)])):x;
const save=()=>fs.writeFileSync(reportFile,JSON.stringify(safe(report),null,2)+'\n');
const log=x=>fs.appendFileSync(journal,JSON.stringify(safe({at:new Date().toISOString(),...x}))+'\n');
const match=(a,b)=>b===null||typeof b!=='object'?Object.is(a,b):Array.isArray(b)?Array.isArray(a)&&a.length===b.length&&b.every((v,i)=>match(a[i],v)):a&&Object.entries(b).every(([k,v])=>match(a[k],v));
async function call(method,route,body){
 if(method!=='GET'){assert.equal(mode,'--apply');assert.ok(plan.requests.some(p=>p.method===method&&p.route===route&&match(body,p.body)&&match(p.body,body)),'写入必须属于固定最终请求');}
 log({phase:'before',method,route,body});try{const r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const text=await r.text();const data=text?JSON.parse(text):null;log({phase:'after',method,route,status:r.status,data});return{status:r.status,data};}catch(e){log({phase:'unknown',method,route,error:e.name});throw Error(`${method} ${route} 结果未知 ${e.name}`);}
}
async function inspect(p){const r=await call('GET',p.readRoute);if(r.status===404){if(p.kind==='relation'){const parent=await call('GET','/skills/'+p.skillKey);if(parent.status!==404)throw Error('已存在技能的关系GET404，停止核对');}return{state:'missing',...r};}assert.equal(r.status,200,p.readRoute);let value=r.data;if(p.kind==='relation'){assert.ok(Array.isArray(value.items));if(!value.items.length)return{state:'missing',...r};assert.equal(value.items.length,1);value=value.items[0];}if(p.kind==='image'){if(!value.image)return{state:'missing',...r};value={imageKey:value.image.imageKey};if(r.data.image.enabled!==true)return{state:'conflict',...r};}return{state:match(value,p.body)?'same':'conflict',...r};}
function imageFingerprint(data){const x=structuredClone(data),value=x.imageBase64;assert.equal(typeof value,'string');const b=Buffer.from(value.includes(',')?value.split(',').at(-1):value,'base64');delete x.imageBase64;return{metadata:x,bytes:b.length,contentSha256:sha(b)};}
async function protect(){
 for(const [route,expected]of [['/runes',baseline.identities],['/rune-paths',baseline.layouts]]){const r=await call('GET',route);assert.equal(r.status,200);assert.deepEqual(r.data,expected);report.protected.push({route,matched:true});}
 for(const o of baseline.owners){const r=await call('GET','/runes/'+o.runeKey);assert.equal(r.status,200);assert.deepEqual(r.data,o.rune);const image=await call('GET','/images/'+o.imageKey);assert.equal(image.status,200);assert.deepEqual(imageFingerprint(image.data),o.image);const rep=await call('GET','/runes/'+o.runeKey+'/representative-image');assert.deepEqual(rep.data,o.sourceImage);report.protected.push({runeKey:o.runeKey,imageKey:o.imageKey,matched:true,contentSha256:o.image.contentSha256});}
}
try{
 await protect();
 for(const p of plan.requests){const r=await inspect(p);report.preflight.push({kind:p.kind,route:p.readRoute,state:r.state});if(r.state==='conflict')throw Error(p.readRoute+' 现值不同，停止且不覆盖');}
 save();
 if(mode==='--apply')for(const p of plan.requests){
  const before=await inspect(p);if(before.state==='same'){report.reuse.push({route:p.readRoute,kind:p.kind});continue;}if(before.state!=='missing')throw Error(p.readRoute+' 写前现值变化');
  let response=null,error=null;try{response=await call(p.method,p.route,p.body);}catch(e){error=e.message;}
  // 无论响应已知与否均先GET，任何不符都停止，绝不自动重放写请求。
  const after=await inspect(p);const entry={kind:p.kind,route:p.route,readRoute:p.readRoute,method:p.method,responseStatus:response?.status??null,unknownError:error,readbackStatus:after.status,matched:after.state==='same',actual:after.data};report.writes.push(entry);save();if(after.state!=='same')throw Error(p.readRoute+' 写后GET不符，停止，不自动重发');
 }
 if(mode!=='--preview'){
  for(const p of plan.requests){const r=await inspect(p);assert.equal(r.state,'same',p.readRoute);report.finalReads.push({kind:p.kind,id:p.id,skillKey:p.skillKey,route:p.readRoute,actual:r.data,matched:true});}
  const kinds=[['parameters','parameter','parameterKey'],['formulas','formula','formulaKey'],['effects','effect','effectKey'],['processes','process','processKey'],['internal-states','internalState','stateKey'],['trigger-rules','rule','ruleKey']];
  for(const o of baseline.owners){for(const [child,kind,key]of kinds){const route=`/skills/${o.skillKey}/${child}`,list=await call('GET',route);assert.equal(list.status,200);assert.ok(Array.isArray(list.data));const expected=new Map(o.existing[child].map(x=>[x[key],x]));for(const p of plan.requests.filter(p=>p.skillKey===o.skillKey&&p.kind===kind))expected.set(p.body[key],p.body);assert.deepEqual(list.data.map(r=>r[key]).sort(),[...expected.keys()].sort(),route+' 组成集合');const rows=[];for(const row of list.data){const detail=await call('GET',route+'/'+row[key]);assert.equal(detail.status,200);assert.ok(match(detail.data,expected.get(row[key])),route+'/'+row[key]);rows.push(detail.data);}report.collections.push({skillKey:o.skillKey,kind:child,count:rows.length,rows,matched:true});}
   const uses=await call('GET','/images/'+o.imageKey+'/usages');assert.equal(uses.status,200);assert.ok(uses.data.runes.some(r=>r.runeKey===o.runeKey));assert.ok(uses.data.skills.some(s=>s.skillKey===o.skillKey));for(const [kind,items]of Object.entries(o.usagesBefore)){if(Array.isArray(items))for(const previous of items)assert.ok(uses.data[kind].some(current=>match(current,previous)),'原图片用途必须保留');}report.finalReads.push({kind:'imageUsages',runeKey:o.runeKey,skillKey:o.skillKey,imageKey:o.imageKey,actual:uses.data,matched:true});
  }
  await protect();
 }
 report.summary={passed:true,mode,planned:174,preflightSame:report.preflight.filter(x=>x.state==='same').length,preflightMissing:report.preflight.filter(x=>x.state==='missing').length,writes:report.writes.length,reused:report.reuse.length,contentWrites:report.writes.filter(x=>x.kind!=='image').length,imageWrites:report.writes.filter(x=>x.kind==='image').length,finalReads:report.finalReads.length,collections:report.collections.length,completeRuneMechanisms:0};report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({file:reportFile,...report.summary}));
}catch(e){report.failure={name:e.name,message:e.message};save();console.error(JSON.stringify({file:reportFile,error:e.message}));process.exitCode=1;}
