import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const routes=['/api/games','/api/admin/games/lol/statuses','/api/admin/games/lol/statuses/vertigo','/api/admin/games/lol/skills/veigar_e/effects/event_horizon_stun','/api/admin/games/lol/skills/morgana_q'];
const report={at:new Date().toISOString(),status:'RUNNING',GETs:0,businessWrites:0,audit:[],values:{},newRootRecordCreated:false};
const authorization='Bearer '+crypto.randomUUID();
for(const route of routes){const response=await fetch('http://127.0.0.1:8080'+route,{method:'GET',redirect:'error',headers:{Authorization:authorization},signal:AbortSignal.timeout(15000)});report.GETs++;report.audit.push({method:'GET',path:route,status:response.status});assert.equal(response.status,200,route);report.values[route]=await response.json();}
const list=report.values[routes[1]].items;assert.equal(list.length,1);assert.equal(list[0].statusKey,'vertigo');assert.equal(list[0].statusKind,'STUN');assert.deepEqual(list[0],report.values[routes[2]]);
const oldEffect=report.values[routes[3]];assert.equal(oldEffect.results[0].detail.statusKey,'vertigo');assert.equal(oldEffect.results[0].valueRule,null);assert.equal(oldEffect.results[0].lifecycleBehavior.moment,'PERSISTENT');
report.status='PASS';report.boundary='最终服务只读可用，既有眩晕完整回读；新ROOT真实创建与页面尚未验收。';fs.writeFileSync('output/root-status-preflight/03-service-readback.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log({status:report.status,GETs:report.GETs,businessWrites:0});
