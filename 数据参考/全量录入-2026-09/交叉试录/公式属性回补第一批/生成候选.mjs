import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
assert.equal(process.argv.length,2,'本文件仅生成只读候选');
const dir=path.dirname(fileURLToPath(import.meta.url));
assert(!fs.existsSync(path.join(dir,'写前方案.json')),'方案已冻结，禁止用后续实值覆盖历史写前快照');
const oldDir=path.resolve(dir,'../Cursor/英雄机制第八批');
const gearDir='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/装备技能实录/第十五批伤害装备';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=(d,n)=>JSON.parse(fs.readFileSync(path.join(d,n)));
const hero=read(oldDir,'最终请求.json'),gear=read(gearDir,'完整候选.json');
assert.equal(hash(fs.readFileSync(path.join(oldDir,'最终请求.json'))),'56dbefdb84857b820fe5278f6d82e226967c5f7edee828e37c8b937003b1af4b');
assert.equal(hash(fs.readFileSync(path.join(gearDir,'完整候选.json'))),'8eef5d285f2ee624db477c9519e7aa94c4cb7c61f1a24ff227daa084931947be');
const sources={hero:read(oldDir,'根绑定与数值证据.json'),gear:read(gearDir,'冻结来源.json')};
const attr=attributeKey=>({nodeType:'ATTRIBUTE',attributeOwner:'SOURCE',attributeKey,attributeValueKind:'TOTAL'});
const map={caitlyn_p:{current_attack_damage_value:attr('attack_damage')},jhin_w:{current_attack_damage_value:attr('attack_damage')},jhin_r:{current_attack_damage_value:attr('attack_damage')},kalista_e:{current_attack_damage_value:attr('attack_damage'),current_other_stat_value:attr('ability_power')},item_2503_passive:{burn_scaling_stat_value:attr('ability_power')},item_3118_passive:{ground_damage_scaling_stat_value:attr('ability_power')},item_3152_active:{firebolt_scaling_stat_value:attr('ability_power')},item_6655_passive:{echo_scaling_stat_value:attr('ability_power')},item_4646_passive:{squall_scaling_stat_value:attr('ability_power')}};
const kinds=['parameters','formulas','effects','processes','internal-states','trigger-rules'];
const reads=[],operations=[],evidence=[];
async function get(route){const r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,route);const actual=await r.json();reads.push({route,status:r.status,actual});return actual;}
const pick=(actual,expected)=>Object.fromEntries(Object.keys(expected).map(k=>[k,actual[k]??null]));
const save=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data,null,2)+'\n');
function walk(v,fn,p=''){if(v&&typeof v==='object'){fn(v,p);for(const [k,x]of Object.entries(v))walk(x,fn,p+'/'+k);}}
function replace(v,m){if(Array.isArray(v))return v.map(x=>replace(x,m));if(v&&typeof v==='object'){if(v.nodeType==='PARAMETER'&&m[v.parameterKey])return structuredClone(m[v.parameterKey]);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,replace(x,m)]));}return v;}
const desc={
 'caitlyn_p/headshot_bonus_damage':'总攻击力×（外部已核等级比例 + 暴击几率×1×（暴击倍率−1））；攻击力已按同构建默认及本版具名证据绑定，等级比例仍无默认值，这是普通攻击之外的额外部分。',
 'jhin_w/damage':'70/105/140/175/210 +0.5×施法者总攻击力；仅首个英雄目标，来源是同构建具体类默认及本版TotalADRatio具名交叉。',
 'jhin_r/base_damage':'64/128/192 +0.25×施法者总攻击力；每颗子弹的未增幅端点，同构建默认及本版具名交叉已补齐属性口径。',
 'jhin_r/maximum_damage':'基础子弹伤害×4；仅目标已损生命增幅的最大端点，内联基础式使用总攻击力。',
 'kalista_e/first_spear_damage':'5/15/25/35/45 +0.7×总攻击力+0.65×法术强度；属性口径由同构建默认及本版具名交叉补齐，尚未接完整伤害执行。',
 'kalista_e/additional_spear_damage':'7/14/21/28/35 +0.2/0.275/0.35/0.425/0.5×总攻击力+0.5×法术强度。',
 'kalista_e/total_spear_damage':'目标至少有一根长矛时：第一根伤害 +（实际根数-1）×每根后续伤害；攻击力取总值，第二属性为法术强度。',
 'kalista_e/slow_ratio':'基础0.1/0.18/0.26/0.34/0.42 +0.0005×施法者法术强度；比例1表示100%，未自创封顶。'
};
const newNames={
 'jhin_w/attack_damage_ratio':'致命华彩总攻击力系数','jhin_r/attack_damage_ratio':'完美谢幕总攻击力系数',
 'kalista_e/first_spear_other_stat_ratio':'撕裂第一根法术强度系数','kalista_e/additional_spear_other_stat_ratio':'撕裂后续长矛法术强度系数','kalista_e/other_stat_slow_ratio':'撕裂法术强度减速系数'
};
for(const [skillKey,m]of Object.entries(map)){
 const old=hero.skills[skillKey]?.write||gear.objects.find(o=>o.skillKey===skillKey)?.apiPayload;assert(old,skillKey);
 const actual={};actual.skill=await get('/skills/'+skillKey);
 for(const kind of kinds){
  const list=await get(`/skills/${skillKey}/${kind}`),id={parameters:'parameterKey',formulas:'formulaKey',effects:'effectKey',processes:'processKey','internal-states':'stateKey','trigger-rules':'ruleKey'}[kind];
  actual[kind]=[];for(const row of list)actual[kind].push(await get(`/skills/${skillKey}/${kind}/${row[id]}`));
 }
 actual.image=await get(`/skills/${skillKey}/representative-image`);
 const isHero=Boolean(hero.skills[skillKey]);
 const source=isHero?sources.hero.heroes.flatMap(h=>h.spells).find(s=>s.skillKey===skillKey).object.mSpell.mSpellCalculations:sources.gear.objects.find(o=>o.equipmentKey===gear.objects.find(g=>g.skillKey===skillKey).equipmentKey).object.mItemCalculations;
 const allowed=[];walk(source,(n,p)=>{if(['StatByCoefficientCalculationPart','StatByNamedDataValueCalculationPart','StatBySubPartCalculationPart'].includes(n.__type)&&[0,2].includes(n.mStat??0)){
   assert.equal(n.UseNewStats??false,false);assert.equal(n.OutputType??0,0);assert.equal(n.mStatFormula??0,0);allowed.push({path:p,node:n,attribute:(n.mStat??0)===2?'attack_damage':'ability_power'});
 }});assert(allowed.length,skillKey);evidence.push({skillKey,originalNodes:allowed,decision:'同构建构造默认 + 本版具名交叉；静态资料推断，非客户端运行'});
 for(const f of old.formulas){const next=replace(f,m);if(JSON.stringify(next.expression)===JSON.stringify(f.expression))continue;
  next.description=desc[skillKey+'/'+f.formulaKey]||f.description.replaceAll('显式缩放属性输入','施法者法术强度').replaceAll('不指定mStat属性','属性口径由同构建默认及本版具名交叉补齐');
  const before=actual.formulas.find(x=>x.formulaKey===f.formulaKey);assert.deepEqual(pick(before,f),f);
  operations.push({skillKey,kind:'formulas',key:f.formulaKey,method:'PUT',route:`/skills/${skillKey}/formulas/${f.formulaKey}`,before:pick(before,f),after:next});
 }
 for(const p of old.parameters){if(m[p.parameterKey])continue;const next=structuredClone(p);const name=newNames[skillKey+'/'+p.parameterKey];
  if(name)next.name=name;
  else if(!isHero&&/未定属性/.test(p.name))next.name=p.name.replace('未定属性','法术强度');
  else if(!(skillKey==='caitlyn_p'&&p.parameterKey==='level_bonus_ratio'))continue;
  next.description=skillKey==='caitlyn_p'?'同构建构造记录已证明初始斜率及断点缺省斜率为0；具体求值循环与当级计入仍未证，暂保留外部已核等级比例输入，不猜18级数组。':p.description.split('；')[0]+'；属性口径按同构建具体类默认及本版具名交叉已核对，数值保持原来源。';
  const before=actual.parameters.find(x=>x.parameterKey===p.parameterKey);assert.deepEqual(pick(before,p),p);
  operations.push({skillKey,kind:'parameters',key:p.parameterKey,method:'PUT',route:`/skills/${skillKey}/parameters/${p.parameterKey}`,before:pick(before,p),after:next});
 }
 if(!isHero){const p=old.skill,before=actual.skill;assert.deepEqual(pick(before,p),p);const after=structuredClone(p);
  after.description=after.description.replaceAll('显式缩放属性输入','施法者法术强度').replaceAll('缩放属性由显式小数输入提供，mStat缺失不命名为法术强度','缩放属性按同构建默认及本版具名交叉绑定法术强度').replaceAll('伤害使用显式未定属性输入，mStat缺失不补法术强度','伤害按同构建默认及本版具名交叉绑定法术强度').replaceAll('当前FireboltDamage的mStat缺失，不把系数命名为法术强度','当前FireboltDamage按同构建默认及本版具名交叉绑定法术强度').replaceAll('mStat缺失不补法强','法强口径由同构建默认及本版具名交叉补齐').replaceAll('缩放属性显式输入，mStat缺失不补法术强度','缩放属性按同构建默认及本版具名交叉绑定法术强度');
  operations.push({skillKey,kind:'skill',key:skillKey,method:'PUT',route:'/skills/'+skillKey,before:pick(before,p),after});
 }
 for(const key of Object.keys(m)){const oldParam=old.parameters.find(p=>p.parameterKey===key);assert(oldParam);const current=actual.parameters.find(p=>p.parameterKey===key);assert.deepEqual(pick(current,oldParam),oldParam);
  const refs=[];for(const kind of kinds.filter(k=>k!=='parameters'))walk(actual[kind],(n,p)=>{if(n.parameterKey===key)refs.push({kind,path:p,node:n});});
  assert(refs.length&&refs.every(r=>r.kind==='formulas'),'删除只能涉及本次已替换的公式引用');
  const expectedFormulas=actual.formulas.map(f=>replace(f,m));walk(expectedFormulas,n=>assert(!(n.parameterKey===key),'替换后仍有引用'));
  operations.push({skillKey,kind:'parameters',key,method:'DELETE',route:`/skills/${skillKey}/parameters/${key}`,before:pick(current,oldParam),after:null,referenceCheck:refs});
 }
}
// 先完成全部引用替换，再移除本轮新建、已经无引用的10个临时属性输入。
operations.sort((a,b)=>(a.method==='DELETE')-(b.method==='DELETE'));
const proposal={generatedAt:new Date().toISOString(),sourceCommit:'4b19cb03',scope:Object.keys(map),boundaries:'只补已证属性引用及对应名称说明；不补等级曲线、触发、伤害资格或时序；不改主体身份、图片或挂载。删除范围仅原批次新建的10个未知属性临时输入，先改引用再GET确认无引用。',mapping:map,sourceEvidence:evidence,operations,counts:{skills:Object.keys(map).length,puts:operations.filter(o=>o.method==='PUT').length,deletes:operations.filter(o=>o.method==='DELETE').length},reads};
assert.equal(proposal.counts.deletes,10);save('写前方案.json',proposal);console.log(JSON.stringify({counts:proposal.counts,reads:reads.length,sha256:hash(fs.readFileSync(path.join(dir,'写前方案.json'))),businessWrites:0}));
