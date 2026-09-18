import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..'),web=path.resolve(root,'../../../damage_web_dev');
const prefix='数据参考/全量录入-2026-09/';
const c=JSON.parse(fs.readFileSync(path.join(web,prefix+'交叉试录/Cursor/英雄机制第三批/录入候选.json'),'utf8')).skills.tristana_q;
const frozen=JSON.parse(fs.readFileSync(path.join(web,prefix+'交叉试录/六项英雄主动触发补录/02-合并冻结请求.json'),'utf8')).requests.find(x=>x.skillKey==='tristana_q');
const bytes=fs.readFileSync(path.join(root,'技能公共参数实录/客户端原文/Tristana.json.gz')),raw=zlib.gunzipSync(bytes),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
assert.equal(sha(raw),c.source.clientSha256);
const officialBytes=fs.readFileSync(path.join(root,'英雄/原始资料/zh_CN/champion/Tristana.json'));
assert.equal(sha(officialBytes),c.source.officialSha256);
const official=JSON.parse(officialBytes);assert.equal(official.version,'16.17.1');
const all=JSON.parse(raw);assert.equal(all[c.source.rootPath].spellNames[0],'TristanaQAbility/TristanaQ');
const spell=all[c.source.spellPath].mSpell,q=official.data.Tristana.spells[0];
const values=name=>spell.DataValues.find(x=>x.name===name).values.slice(1,6);
assert.deepEqual(q.cooldown,spell.cooldownTime.slice(1,6));assert.deepEqual(q.cost,spell.manaValues.values.slice(0,5));
const token=crypto.randomUUID(),responses={},requests=[],base='http://127.0.0.1:8080/api/admin/games/lol',skill='/skills/tristana_q';
async function get(p){const r=await fetch(base+p,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,p);requests.push({method:'GET',path:p,status:200});return responses[p]=await r.json();}
for(const p of [skill,'/characters/champion_tristana','/character-skill-relations?skillKey=tristana_q',skill+'/representative-image'])await get(p);
const kinds=[['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey'],['processes','processKey'],['internal-states','stateKey'],['trigger-rules','ruleKey']];
const strip=x=>Array.isArray(x)?x.map(strip):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([k])=>!['gameId','skillKey','createdAt','updatedAt'].includes(k)).map(([k,v])=>[k,strip(v)])):x;
for(const [kind,key]of kinds){const list=await get(skill+'/'+kind);assert.equal(new Set(list.map(x=>x[key])).size,list.length);for(const x of list)await get(skill+'/'+kind+'/'+x[key]);
  const expected=kind==='trigger-rules'?[frozen.body]:c.write[kind==='internal-states'?'internalStates':kind];assert.equal(list.length,expected.length);
  for(const x of expected)assert.deepEqual(strip(responses[skill+'/'+kind+'/'+x[key]]),x);
}
for(const key of ['mana','bonus_attack_speed_percent'])assert.equal((await get('/attributes/'+key)).status,'ENABLED');assert.equal((await get('/modifier-zones/attribute_flat_add')).status,'ENABLED');
const level=(key,arr)=>assert.deepEqual(responses[skill+'/parameters/'+key].levelValues,Object.fromEntries(arr.map((v,i)=>[String(i+1),v])));
level('cooldown_ms',q.cooldown.map(x=>x*1000));level('mana_cost',q.cost);level('bonus_attack_speed_ratio',values('AttackSpeedMod').map(x=>Math.round(x*100)/100));
assert(values('BuffDuration').every(x=>x===7));assert.equal(responses[skill+'/parameters/buff_duration_ms'].fixedValue,7000);
assert.equal(responses[skill].maxLevel,5);assert.equal(responses[skill].status,'ENABLED');assert.equal(responses[skill+'/representative-image'].image.enabled,true);
assert.equal(responses['/character-skill-relations?skillKey=tristana_q'].total,1);
const report={at:new Date().toISOString(),status:'PASS',executor:'主负责人',GETs:requests.length,businessWrites:0,requests,responses,
 source:{clientSha256:sha(raw),compressedSha256:sha(bytes),officialSha256:sha(officialBytes),spellPath:c.source.spellPath,cooldownSeconds:q.cooldown,mana:q.cost,attackSpeed:values('AttackSpeedMod'),durationSeconds:values('BuffDuration')},
 conclusion:'本轮管理组成齐全：60/75/90/105/120%额外攻速持续7秒，主动过程开始扣除15/20/25/30/35法力并启动20/19/18/17/16秒冷却，主动规则仅启动一次完整过程。',
 followups:['mana_cost参数说明误写明确0消耗保留，实际所有等级均为非零，须纠正文案','技能主体保留初始导入的数值和机制待补证文字，须纠正文案'],
 boundary:'本次纯GET核对；全部参数、效果、过程与原已验收候选相同，规则与后续正式冻结请求相同，不代表宿主或战斗运行已验证。'};
fs.writeFileSync(path.join(here,'01-当前核对.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,GETs:report.GETs,conclusion:report.conclusion,followups:report.followups}));
