import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const mode=process.argv[2], dir=path.resolve('output/slow-status-toggle');
const paths=['/statuses','/statuses/vertigo','/statuses/movement_slow','/statuses/root','/skills/urgot_q/effects/corrosive_charge_slow','/skills/urgot_q/trigger-rules/apply_slow_on_unblocked_hit'];
const audit=[],token=crypto.randomUUID(),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const save=(name,x)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(x,null,2)+'\n',{flag:'wx'});
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name)));
async function get(route){const r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});audit.push({method:'GET',path:route,status:r.status});assert.equal(r.status,200);return r.json();}
async function all(){const values={};for(const route of paths)values[route]=await get(route);return values;}
const target='/statuses/movement_slow';
const business=x=>{const{updatedAt,...b}=x;assert(Number.isFinite(Date.parse(updatedAt)));return b;};
if(mode==='prepare'){
 assert(!fs.existsSync(dir));fs.mkdirSync(dir);const values=await all();assert.equal(values[target].status,'ENABLED');assert.equal(values[target].statusKind,'MOVEMENT_SLOW');
 const {statusKind,name,description,sortOrder}=values[target];
 save('01-完整现值与请求.json',{at:new Date().toISOString(),businessWrites:0,values,audit,requests:['DISABLED','ENABLED'].map(status=>({method:'PUT',path:target,body:{statusKind,name,description,status,sortOrder}})),scope:'页面依次停用再启用；只允许目标status与updatedAt变化；保留种类、标识、排序、创建时间及原控制目录与厄加特减速引用。'});
 console.log(JSON.stringify({status:'READY',GETs:audit.length,sha256:sha(fs.readFileSync(path.join(dir,'01-完整现值与请求.json')))}));
} else if(mode==='before-disable'||mode==='before-enable'){
 const baseline=read('01-完整现值与请求.json'),previous=mode==='before-disable'?baseline.values[target]:read('03-停用即时回读.json').current;
 assert.deepEqual(await get(target),previous);save(mode==='before-disable'?'02-停用前核对.json':'04-启用前核对.json',{at:new Date().toISOString(),status:'PASS',audit,businessWrites:0});
 console.log(JSON.stringify({status:'PASS',GETs:audit.length}));
} else if(mode==='after-disable'||mode==='after-enable'){
 const baseline=read('01-完整现值与请求.json'),current=await get(target),next=mode==='after-disable'?'DISABLED':'ENABLED';
 assert.deepEqual(business(current),{...business(baseline.values[target]),status:next});
 save(mode==='after-disable'?'03-停用即时回读.json':'05-启用即时回读.json',{at:new Date().toISOString(),status:'PASS',current,audit,businessWrites:0,writer:'CUA真实页面单次确认，接口结果由另次GET确认；未捕获PUT响应正文。'});
 console.log(JSON.stringify({status:'PASS',GETs:audit.length,statusKind:current.statusKind,currentStatus:current.status}));
} else if(mode==='readback'){
 const baseline=read('01-完整现值与请求.json'),values=await all();let preserved=0;
 for(const route of paths){if(route===target){assert.deepEqual(values[route],read('05-启用即时回读.json').current);assert.deepEqual(business(values[route]),business(baseline.values[route]));}else if(route==='/statuses'){const expected=structuredClone(baseline.values[route]);assert(Array.isArray(expected.items));const idx=expected.items.findIndex(x=>x.statusKey==='movement_slow');assert(idx>=0);expected.items[idx]=values[target];assert.deepEqual(values[route],expected);}else {assert.deepEqual(values[route],baseline.values[route]);preserved++;}}
 save('06-另进程独立回读.json',{at:new Date().toISOString(),status:'PASS',executor:'主负责人另启仅GET进程，非独立代理',businessWrites:0,GETs:audit.length,unchangedResponsesIncludingTimestamps:preserved,values,audit});console.log(JSON.stringify({status:'PASS',GETs:audit.length,preserved}));
} else throw new Error('Unknown mode');
