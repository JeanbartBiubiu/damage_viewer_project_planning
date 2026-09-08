import {readFile,writeFile,mkdir,copyFile,access,appendFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {request,diff} from './录入.mjs';
import assert from 'node:assert/strict';
const dir=new URL('./动态攻速纠错/',import.meta.url);
await mkdir(dir,{recursive:true});
for(const f of ['录入候选.json','组成.mjs','阶段独立回读证据.json']){const target=new URL(f.endsWith('.mjs')?f+'.txt':f,dir);if(!await access(target).then(()=>true,()=>false))await copyFile(new URL('./'+f,import.meta.url),target,constants.COPYFILE_EXCL);}
const before=JSON.parse(await readFile(new URL('录入候选.json',dir),'utf8')).skills.diana_p;
const nextBehavior={moment:'PERSISTENT',valueReadMode:'MOMENT_EVALUATION',stackValueMode:'SHARED',reapplicationValueMode:null,periodicExecutionMode:null};
const apply=process.argv.includes('--apply');assert.ok(process.argv.slice(2).every(v=>v==='--apply'));
const report={at:new Date().toISOString(),mode:apply?'explicit-bounded-apply':'read-only',changes:[],preflight:[]};
const tasks=['passive_attack_speed','cast_attack_speed'].map(key=>{const old=before.write.effects.find(e=>e.effectKey===key),target=structuredClone(old);assert.equal(old.results.length,1);assert.equal(old.results[0].lifecycleBehavior.valueReadMode,'APPLICATION_SNAPSHOT');target.results[0].lifecycleBehavior=nextBehavior;return {route:'/skills/diana_p/effects/'+key,old,target};});
for(const t of tasks){const r=await request(t.route);assert.equal(r.status,200);const same=!diff(t.target,r.data);assert.ok(same||!diff(t.old,r.data),'出现范围外不同值 '+t.route);t.before=r;t.same=same;report.preflight.push({route:t.route,before:r,target:t.target,state:same?'target':'old'});}
await writeFile(new URL(apply?'写前检查.json':'只读检查.json',dir),JSON.stringify(report,null,2)+'\n');
if(apply)for(const t of tasks){if(t.same)continue;const fresh=await request(t.route);assert.deepEqual(fresh,t.before,'写前变化');const payload=structuredClone(t.target);delete payload.effectKey;const saved=await request(t.route,{method:'PUT',body:payload});assert.equal(saved.status,200);const after=await request(t.route);assert.equal(after.status,200);assert.equal(diff(t.target,after.data),null);const change={at:new Date().toISOString(),route:t.route,before:t.before,after,status:saved.status};report.changes.push(change);await appendFile(new URL('纠错流水.jsonl',dir),JSON.stringify(change)+'\n');}
await writeFile(new URL(apply?'执行结果.json':'只读检查.json',dir),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({mode:report.mode,changes:report.changes.length,same:tasks.filter(t=>t.same).length}));
