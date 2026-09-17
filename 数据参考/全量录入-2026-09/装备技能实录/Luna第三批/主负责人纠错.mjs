import fs from 'node:fs';
import assert from 'node:assert/strict';
const local = name => new URL(name, import.meta.url);
const snapshot = local('./纠错前候选.json');
if (!fs.existsSync(snapshot)) fs.copyFileSync(local('./录入候选.json'), snapshot);
const original = JSON.parse(fs.readFileSync(snapshot));
const next = structuredClone(original);
const apply = process.argv.includes('--apply');
const base='http://127.0.0.1:8080/api/admin/games/lol';
const corrections=[];
const replacements = new Map([
  ['魔法伤害后生命值低于30%时触发，小数1表示100%。','受到将使生命值跌至30%以下的魔法伤害时触发，小数1表示100%。'],
  ['触发时的距离分支待接。','触发时的来源对象近战/远程攻击类型分支待接。'],
  ['近战/远程分支没有共同的距离选择条件，不能把任一分支直接接到全部普攻。','需按来源对象近战/远程攻击类型选择分支，不能按双方实际距离选择，也不能把任一分支接到全部普攻。'],
  ['近战/远程分支缺少共同的距离选择条件，保留两套效果但不接任意命中规则。','需按来源对象近战/远程攻击类型选择分支，保留两套效果但不接任意命中规则。'],
  ['小兵和野怪上限需要目标类别条件；三次攻击计数、6秒窗口、目标独立性和减速状态键未在本批虚构接线。','小兵和野怪上限按本轮范围排除；三次攻击计数、6秒窗口、目标独立性和减速状态键仍待补证及接线。'],
]);
function rewrite(value) {
  if(typeof value==='string') {for(const [a,b] of replacements) value=value.replaceAll(a,b); return value;}
  if(Array.isArray(value)) return value.map(rewrite);
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v)]));
  return value;
}
next.objects=next.objects.map(rewrite);
const shield=next.objects.find(x=>x.equipmentKey==='item_1054');
shield.skill.name='多兰之盾·耐久专注';
shield.skill.description='保存受英雄伤害后的8秒回复参数、近战40与远程30的回复上限、群体或周期伤害的治疗效能。已损失生命到总回复量的函数与刷新接线待补。每5秒固定4点回复已归入装备hp_regen直接属性，小兵额外伤害按本轮范围排除。';
shield.parameters=shield.parameters.filter(p=>!['base_regen_per_5s','minion_bonus_damage'].includes(p.parameterKey));
shield.effects=[]; shield.triggerRules=[];
const bork=next.objects.find(x=>x.equipmentKey==='item_3153');
bork.parameters=bork.parameters.filter(p=>p.parameterKey!=='minion_monster_damage_cap');
bork.skill.description=bork.skill.description.replace('、对小兵和野怪单次上限100','');
async function request(endpoint,method='GET',body) {
 const r=await fetch(base+endpoint,{method,headers:{Authorization:'Bearer local-entry','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
 const text=await r.text(); return {status:r.status,data:text?JSON.parse(text):null};
}
function pick(actual,expected) {return expected&&typeof expected==='object'?Array.isArray(expected)?actual.map((v,i)=>pick(v,expected[i])):Object.fromEntries(Object.keys(expected).map(k=>[k,pick(actual[k],expected[k])])):actual;}
const removals=[]; const updates=[];
for(const old of original.objects) {
 const fresh=next.objects.find(o=>o.equipmentKey===old.equipmentKey), root='/skills/'+old.skill.skillKey;
 if(JSON.stringify(old.skill)!==JSON.stringify(fresh.skill)) updates.push({endpoint:root,key:'skillKey',before:old.skill,after:fresh.skill});
 for(const [group,type,key] of [['triggerRules','trigger-rules','ruleKey'],['effects','effects','effectKey'],['parameters','parameters','parameterKey']]) {
  for(const before of old[group]) {const after=fresh[group].find(v=>v[key]===before[key]); const item={endpoint:root+'/'+type+'/'+before[key],key,before,after};
   if(!after) removals.push(item); else if(JSON.stringify(before)!==JSON.stringify(after)) updates.push(item);
  }
 }
}
assert.equal(removals.length,6);
const attrs=await request('/equipment/item_1054/attributes');assert.equal(attrs.status,200);
assert.deepEqual(attrs.data.attributeValues.hp,110);
assert.ok(Object.keys(attrs.data.attributeValues).every(k=>['hp','hp_regen'].includes(k)));
assert.ok(attrs.data.attributeValues.hp_regen===undefined || attrs.data.attributeValues.hp_regen===4);
for(const item of [...removals,...updates]) {
 const live=await request(item.endpoint); item.live=live;
 if(!item.after && live.status===404) continue;
 assert.equal(live.status,200,item.endpoint);
 const actual=pick(live.data,item.before);
 if(item.after && JSON.stringify(actual)===JSON.stringify(item.after)) continue;
 assert.deepEqual(actual,item.before,'现值已变化，禁止覆盖：'+item.endpoint);
}
if(apply) {
 if(attrs.data.attributeValues.hp_regen!==4) {
  const r=await request('/equipment/item_1054/attributes','PUT',{attributeValues:{hp:110,hp_regen:4}});assert.ok(r.status>=200&&r.status<300);
 }
 assert.deepEqual((await request('/equipment/item_1054/attributes')).data.attributeValues,{hp:110,hp_regen:4});
 for(const item of removals) {if(item.live.status!==404) {const r=await request(item.endpoint,'DELETE');assert.ok(r.status>=200&&r.status<300,item.endpoint);} assert.equal((await request(item.endpoint)).status,404); corrections.push({endpoint:item.endpoint,action:'移除本批越界或错误分类组成',absentAfter:true});}
 for(const item of updates) {
  if(JSON.stringify(pick(item.live.data,item.after))!==JSON.stringify(item.after)) {const {[item.key]:_,...body}=item.after; const r=await request(item.endpoint,'PUT',body);assert.ok(r.status>=200&&r.status<300,item.endpoint);}
  assert.deepEqual(pick((await request(item.endpoint)).data,item.after),item.after);corrections.push({endpoint:item.endpoint,action:'仅修正名称或语义说明',matches:true});
 }
 let code=fs.readFileSync(local('./录入装备技能.mjs'),'utf8');
 const start=code.indexOf('  {\n    equipmentKey: \'item_1054\'');
 const end=code.indexOf('  {\n    equipmentKey: \'item_3153\'');
 if(start>=0 && end>start) code=code.slice(0,start)+JSON.stringify(shield,null,2)+',\n'+code.slice(end);
 code=code.replace(/^.*parameterKey: 'minion_monster_damage_cap'.*\r?\n/m,'');
 for(const [a,b] of replacements) code=code.replaceAll(a,b);
 code=code.replace('、对小兵和野怪单次上限100','');
 fs.writeFileSync(local('./录入装备技能.mjs'),code);
 fs.writeFileSync(local('./录入候选.json'),JSON.stringify(next,null,2)+'\n');
 fs.writeFileSync(local('./纠错回读.json'),JSON.stringify({checkedAt:new Date().toISOString(),corrections,directAttribute:{equipmentKey:'item_1054',before:attrs.data.attributeValues,after:{hp:110,hp_regen:4},source:'官方FlatHPRegenMod=0.8/秒与客户端约0.8/秒；hp_regen目录单位每5秒'},passed:true,runtimeValidation:'未执行'},null,2)+'\n');
}
console.log(JSON.stringify({mode:apply?'纠错及回读':'只读预检',removals:removals.length,descriptionUpdates:updates.length}));
