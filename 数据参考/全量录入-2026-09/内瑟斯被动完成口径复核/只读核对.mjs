import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)), root=path.resolve(here,'..');
const prior=JSON.parse(fs.readFileSync(path.join(root,'内瑟斯技能实录第一批/初始化回读.json'),'utf8'));
const candidate=JSON.parse(fs.readFileSync(path.join(root,'内瑟斯技能实录第一批/录入候选.json'),'utf8'));
const bytes=fs.readFileSync(path.join(root,'技能公共参数实录/客户端原文/Nasus.json.gz'));
const raw=zlib.gunzipSync(bytes), sha=x=>crypto.createHash('sha256').update(x).digest('hex');
assert.equal(sha(bytes),candidate.source.client.compressedSha256);assert.equal(sha(raw),candidate.source.client.sha256);
const client=JSON.parse(raw), pointer=client['Characters/Nasus/CharacterRecords/Root'].mCharacterPassiveSpell;
assert.equal(pointer,'Characters/Nasus/Spells/NasusPassiveAbility/NasusPassive');
const curve=client[pointer].mSpell.mSpellCalculations.LifestealTooltip.mFormulaParts[0];
assert.deepEqual(curve,candidate.passiveCurve);
const official=JSON.parse(fs.readFileSync(path.join(root,'英雄/原始资料/zh_CN/champion/Nasus.json'),'utf8'));
assert.equal(official.version,'16.17.1');assert.match(official.data.Nasus.passive.description,/生命偷取/);
const token=crypto.randomUUID(),responses={},requests=[];
const base='http://127.0.0.1:8080/api/admin/games/lol';
async function get(p){const r=await fetch(base+p,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,p);requests.push({method:'GET',path:p,status:200});return responses[p]=await r.json();}
const skill='/skills/nasus_p';
await get(skill);await get('/characters/champion_nasus');await get('/character-skill-relations?skillKey=nasus_p');await get(skill+'/representative-image');
for(const [kind,key] of [['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey'],['processes','processKey'],['internal-states','stateKey'],['trigger-rules','ruleKey']]){
  const rows=await get(skill+'/'+kind);for(const row of rows)await get(skill+'/'+kind+'/'+row[key]);
}
await get('/attributes/life_steal_percent');await get('/modifier-zones/attribute_flat_add');
assert.equal(responses[skill].status,'ENABLED');assert.equal(responses[skill].maxLevel,1);
const relation=responses['/character-skill-relations?skillKey=nasus_p'];
assert.equal(relation.total,1);assert.equal(relation.items[0].characterKey,'champion_nasus');
assert.equal(responses[skill+'/representative-image'].image.enabled,true);
const parameter=responses[skill+'/parameters/life_steal_ratio'];
assert.equal(parameter.valueMode,'CHARACTER_LEVEL');
const expected=Object.fromEntries(Array.from({length:18},(_,i)=>[String(i+1),(curve.mLevel1Value+curve.mBreakpoints.filter(x=>x.mLevel<=i+1).reduce((n,x)=>n+x.mAdditionalBonusAtThisLevel,0))/100]));
assert.deepEqual(parameter.levelValues,expected);
assert.deepEqual(responses[skill+'/effects/soul_eater_lifesteal'],prior.effect);
assert.deepEqual(responses[skill+'/trigger-rules/initialize_lifesteal'],prior.rule);
for(const kind of ['formulas','processes','internal-states'])assert.deepEqual(responses[skill+'/'+kind],[]);
for(const kind of ['parameters','effects','trigger-rules'])assert.equal(responses[skill+'/'+kind].length,1);
assert.equal(responses['/attributes/life_steal_percent'].status,'ENABLED');
assert.equal(responses['/modifier-zones/attribute_flat_add'].status,'ENABLED');
const report={at:new Date().toISOString(),status:'PASS',executor:'主负责人',businessWrites:0,GETs:requests.length,requests,responses,
 source:{version:'客户端16.17/官方16.17.1',compressedSha256:sha(bytes),decompressedSha256:sha(raw),passivePointer:pointer,curve,officialDescription:official.data.Nasus.passive.description},
 conclusion:'当前1至18级管理配置完整：独立来源、完整等级图、无限期自身生命偷取效果、当前时点读值、初始化一次入口和全部挂载引用均已表达。',
 staleDescription:'技能本体保留旧的数值和机制待补证说明，不是当前缺失组成；后续单独纠正文案，不据此重复录入。',
 boundary:'本次纯GET及来源验证；初始化规则和效果与既有独立回读逐字段一致；不证明宿主初始化事件或实际吸血结算。'};
fs.writeFileSync(path.join(here,'01-当前核对.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,GETs:report.GETs,conclusion:report.conclusion}));
