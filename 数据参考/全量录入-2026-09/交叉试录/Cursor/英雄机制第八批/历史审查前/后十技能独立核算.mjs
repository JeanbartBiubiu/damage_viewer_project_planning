import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';

const here=new URL('./',import.meta.url);
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const inputPath=new URL('./后十技能候选.json',here);
const bytes=await readFile(inputPath);
const plan=await read(inputPath);
const before=await read(new URL('./写前现值.json',here));
const sources=await read(new URL('./根绑定与数值证据.json',here));
const texts=await read(new URL('./补充文本证据.json',here));
const catalogs=await read(new URL('./目录现值.json',here));
const checks=[];
const arithmetic=[];
const hashes=[];
const check=(name,match,detail=null)=>checks.push({name,match,detail});
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-7;
const record=(skillKey,name,expected,actual,detail=null)=>arithmetic.push({skillKey,name,expected,actual,match:near(actual,expected),detail});
const body=key=>plan.skills[key]?.write;
const parameter=(key,parameterKey)=>body(key)?.parameters.find(p=>p.parameterKey===parameterKey);
const value=(key,parameterKey,{rank=1,runtime={}}={})=>{
 const p=parameter(key,parameterKey);if(!p)throw Error(`缺参数 ${key}/${parameterKey}`);
 if(p.valueMode==='FIXED')return p.fixedValue;
 if(p.valueMode==='RUNTIME_INPUT')return runtime[parameterKey];
 return p.levelValues?.[String(rank)];
};
function evaluate(key,node,input,stack=new Set()){
 if(!node||typeof node!=='object')throw Error(`空表达式 ${key}`);
 if(node.kind==='FORMULA'){
  if(stack.has(node.formulaKey))throw Error(`公式循环 ${key}/${node.formulaKey}`);
  const f=body(key)?.formulas.find(v=>v.formulaKey===node.formulaKey);if(!f)throw Error(`缺公式 ${key}/${node.formulaKey}`);
  const next=new Set(stack);next.add(node.formulaKey);return evaluate(key,f.expression,input,next);
 }
 if(node.kind==='PARAMETER'||node.nodeType==='PARAMETER')return value(key,node.parameterKey,input);
 if(node.kind==='FIXED')return node.value;
 if(node.nodeType==='ATTRIBUTE'){
  const mapKey=[node.attributeOwner,node.attributeKey,node.attributeValueKind].join('.');
  const n=input.attributes?.[mapKey];if(!Number.isFinite(n))throw Error(`缺属性 ${mapKey}`);return n;
 }
 if(node.nodeType==='OPERATION'){
  const args=(node.operands??[]).map(v=>evaluate(key,v,input,stack));
  switch(node.operation){
   case 'ADD':return args.reduce((a,b)=>a+b,0);
   case 'SUBTRACT':return args[0]-args[1];
   case 'MULTIPLY':return args[0]*args[1];
   case 'DIVIDE':return args[0]/args[1];
   case 'MIN':return Math.min(...args);
   case 'MAX':return Math.max(...args);
   default:throw Error(`未知运算 ${node.operation}`);
  }
 }
 throw Error(`未知表达式节点 ${JSON.stringify(node)}`);
}
const calculate=(key,formulaKey,input={})=>{
 const f=body(key)?.formulas.find(v=>v.formulaKey===formulaKey);if(!f)throw Error(`缺公式 ${key}/${formulaKey}`);
 return evaluate(key,f.expression,input);
};
const attrs={'SOURCE.attack_damage.TOTAL':200,'SOURCE.attack_damage.BONUS':100,'TARGET.hp.TOTAL':2000};
const sourceBase='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录';
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');
for(const h of sources.heroes.filter(h=>['Draven','Kalista'].includes(h.id))){
 const clientBytes=gunzipSync(await readFile(path.join(sourceBase,h.client.path)));
 const officialBytes=await readFile(path.resolve(sourceBase,h.official.path));
 hashes.push({hero:h.id,kind:'client',expected:h.client.sha256,actual:sha256(clientBytes),match:sha256(clientBytes)===h.client.sha256});
 hashes.push({hero:h.id,kind:'official',expected:h.official.sha256,actual:sha256(officialBytes),match:sha256(officialBytes)===h.official.sha256});
}
const textBytes=gunzipSync(await readFile(texts.path));
hashes.push({kind:'当前字符串表',expected:texts.sha256,actual:sha256(textBytes),match:sha256(textBytes)===texts.sha256});
for(const h of sources.heroes.filter(h=>['Draven','Kalista'].includes(h.id)))for(const s of h.spells){
 const c=plan.skills[s.skillKey];
 check(s.skillKey+'根绑定与来源哈希',!!c&&c.source.hero===h.id&&c.source.rootPath===h.rootPath&&c.source.spellPath===s.binding&&c.source.clientSha256===h.client.sha256&&c.source.officialSha256===h.official.sha256);
 check(s.skillKey+'当前mLocKeys中文精确复用',equal(c?.source?.currentBoundText,texts.skills[s.skillKey]));
}
check('来源文件哈希全部一致',hashes.every(v=>v.match),hashes);
const expectedKeys=['draven','kalista'].flatMap(h=>['p','q','w','e','r'].map(s=>h+'_'+s));
check('只含德莱文与卡莉丝塔后十十槽',equal(Object.keys(plan.skills),expectedKeys),Object.keys(plan.skills));
check('候选明确未写业务API',plan.meta.apiWrites===0&&plan.meta.stage==='后十技能候选；未写业务API',plan.meta);
const publicKeys={draven_q:['cooldown_ms','mana_cost'],draven_w:['cooldown_ms','mana_cost'],draven_e:['cooldown_ms','mana_cost'],draven_r:['cooldown_ms','mana_cost'],kalista_q:['cooldown_ms','mana_cost'],kalista_e:['mana_cost']};
let reused=0;const reuseFailures=[];
for(const [skillKey,keys] of Object.entries(publicKeys)){
 const prev=before.skills[skillKey].components.parameters;
 const current=body(skillKey).parameters;
 for(const key of keys){
  const old=prev.find(p=>p.parameterKey===key);const now=current.find(p=>p.parameterKey===key);
  const stripped=old&&Object.fromEntries(Object.entries(old).filter(([k])=>!['gameId','skillKey','createdAt','updatedAt'].includes(k)));
  const ok=!!old&&!!now&&plan.skills[skillKey].reusedParameters.includes(key)&&equal(now,stripped);
  if(ok)reused++;else reuseFailures.push(skillKey+'/'+key);
  check(skillKey+'公共参数逐字段保留 '+key,ok,{old:old&&stripped,current:now});
 }
}
check('精确保留11项既有公共参数',reused===11&&!reuseFailures.length,{reused,reuseFailures});
const dataMap={
 draven_p:[['StackGain','catch_adoration_gain',1],['PercentOfStacksLost','death_adoration_loss_ratio',.01]],
 draven_q:[['BaseDamage','base_bonus_damage',1],['ADScaling','bonus_ad_ratio',1],['DurationTOOLTIP','idle_axe_expiry_ms',1000]],
 draven_w:[['Temp_AS','attack_speed_gain_ratio',.01],['Temp_ASDuration','attack_speed_duration_ms',1000],['Temp_MSMod','initial_move_speed_ratio',.01],['Temp_MSDuration','move_speed_duration_ms',1000]],
 draven_e:[['BaseDamage','base_damage',1],['SlowAmount','slow_ratio',.01],['SlowDuration','slow_duration_ms',1000],['KnockbackDuration','knockback_duration_ms',1000]],
 draven_r:[['RBaseDamage','base_damage',1],['RCoefficient','bonus_ad_ratio',1],['RMinDamagePercent','minimum_damage_ratio',.01],['RDamageReductionPerHit','damage_reduction_per_hit',1],['RPassiveStacksCoefficient','adoration_execute_coefficient',1]],
 kalista_q:[['BaseDamage','base_damage',1],['TotalADRatio','total_ad_ratio',1]],
 kalista_e:[['FakedCooldown','cooldown_ms',1000],['BaseDamage','first_spear_base_damage',1],['BaseADRatio','first_spear_ad_ratio',1],['APRatio','first_spear_other_stat_ratio',1],['AdditionalBaseDamage','additional_spear_base_damage',1],['AdditionalADRatio','additional_spear_ad_ratio',1],['AdditionalAPRatio','additional_spear_other_stat_ratio',1],['SlowAmount','base_slow_ratio',1],['SlowAPRatio','other_stat_slow_ratio',1],['SlowDuration','slow_duration_ms',1000],['ManaRefund','mana_refund',1]]
};
for(const [skillKey,entries] of Object.entries(dataMap)){
 const spell=sources.heroes.flatMap(h=>h.spells).find(s=>s.skillKey===skillKey);const root=spell?.object.mSpell;const maxLevel=spell?.official.maxrank??1;
 for(const [sourceName,key,scale] of entries){
  const d=(root?.DataValues??[]).find(v=>v.name===sourceName);const raw=d?.values??[];const expected=raw.slice(1,maxLevel+1).map(v=>Math.round(Math.round(v*1e6)/1e6*scale*1e6)/1e6);const p=parameter(skillKey,key);const actual=Array.from({length:maxLevel},(_,i)=>p?.valueMode==='FIXED'?p.fixedValue:p?.levelValues?.[String(i+1)]);
  check(skillKey+'参数原值 '+key,equal(actual,expected),{sourceName,expected,actual});
 }
}
const literals=[['draven_q','max_held_axes',2],['draven_e','bonus_ad_ratio',.5],['kalista_e','spear_duration_ms',4000]];
for(const [skillKey,key,expected] of literals)check(skillKey+'明确派生参数 '+key,value(skillKey,key)===expected,{expected,actual:value(skillKey,key)});
for(const [skillKey,s] of Object.entries(plan.skills)){
 const w=s.write;const allKeys={parameters:new Set(w.parameters.map(v=>v.parameterKey)),formulas:new Set(w.formulas.map(v=>v.formulaKey)),effects:new Set(w.effects.map(v=>v.effectKey))};
 const missing=[];
 function references(node,stack=[]){if(!node||typeof node!=='object')return;if(node.kind==='PARAMETER'||node.nodeType==='PARAMETER'){if(!allKeys.parameters.has(node.parameterKey))missing.push(node.parameterKey);}if(node.kind==='FORMULA'){if(!allKeys.formulas.has(node.formulaKey))missing.push(node.formulaKey);else if(!stack.includes(node.formulaKey)){const f=w.formulas.find(v=>v.formulaKey===node.formulaKey);references(f.expression,[...stack,node.formulaKey]);}}for(const v of Object.values(node))if(v&&typeof v==='object')references(v,stack);}
 references(w);
 check(skillKey+'参数公式效果内部引用完整',missing.length===0,missing);
 check(skillKey+'稳定键不重复',Object.values(w).every(arr=>Array.isArray(arr)&&new Set(arr.map(v=>v.parameterKey??v.formulaKey??v.effectKey??v.processKey??v.stateKey??v.ruleKey)).size===arr.length));
 const invalidDynamic=w.effects.flatMap(e=>e.results??[]).filter(r=>r.lifecycleBehavior?.moment==='PERSISTENT'&&r.lifecycleBehavior.valueReadMode==='MOMENT_EVALUATION'&&r.valueRule?.value?.kind==='PARAMETER'&&parameter(skillKey,r.valueRule.value.parameterKey)?.valueMode==='RUNTIME_INPUT');
 check(skillKey+'没有持续瞬时读取运行时输入',invalidDynamic.length===0,invalidDynamic.map(r=>r.resultKey));
 check(skillKey+'没有假事件',w.triggerRules.every(r=>r.eventSource?.eventType==='SKILL_HIT'&&r.eventSource?.detail?.sourceSkillKey===skillKey),w.triggerRules.map(r=>r.eventSource?.eventType));
 for(const e of w.effects)for(const r of e.results??[]){if(r.detail?.attributeKey){const items=catalogs.catalogs.attributes.items;check(skillKey+'/'+e.effectKey+'属性目录存在',items.some(v=>v.attributeKey===r.detail.attributeKey&&v.status==='ENABLED'));}if(r.detail?.damageTypeKey){const items=catalogs.catalogs['damage-types'].items;check(skillKey+'/'+e.effectKey+'伤害类型目录存在',items.some(v=>v.damageTypeKey===r.detail.damageTypeKey&&v.status==='ENABLED'));}}
 check(skillKey+'没有内部状态误填',w.internalStates.length===0);
}
for(const [rank,expected] of [[1,115],[5,175]])record('draven_q','等级'+rank+'额外物理伤害BAD100',expected,calculate('draven_q','bonus_attack_damage',{rank,attributes:attrs}));
for(const [rank,expected] of [[1,125],[5,265]])record('draven_e','等级'+rank+'开道利斧BAD100',expected,calculate('draven_e','hit_damage',{rank,attributes:attrs}));
for(const [rank,expected] of [[1,310],[3,550]])record('draven_r','等级'+rank+'冷血追命首目标BAD100',expected,calculate('draven_r','first_target_damage',{rank,attributes:attrs}));
for(const [stacks,expected] of [[0,0],[120,120],[501,501]])record('draven_r','崇拜层数'+stacks+'处决阈值',expected,calculate('draven_r','adoration_execute_threshold',{runtime:{current_adoration_stacks:stacks},attributes:attrs}));
for(const [rank,expected] of [[1,220],[5,480]])record('kalista_q','等级'+rank+'穿刺总AD200',expected,calculate('kalista_q','first_target_damage',{rank,attributes:attrs}));
record('kalista_e','等级1第一根AD200其他属性100',210,calculate('kalista_e','first_spear_damage',{rank:1,runtime:{current_attack_damage_value:200,current_other_stat_value:100},attributes:attrs}));
record('kalista_e','等级1后续一根AD200其他属性100',97,calculate('kalista_e','additional_spear_damage',{rank:1,runtime:{current_attack_damage_value:200,current_other_stat_value:100},attributes:attrs}));
record('kalista_e','等级1三根总伤害AD200其他属性100',404,calculate('kalista_e','total_spear_damage',{rank:1,runtime:{current_attack_damage_value:200,current_other_stat_value:100,additional_spear_count:2},attributes:attrs}));
record('kalista_e','等级5四根总伤害AD200其他属性100',805,calculate('kalista_e','total_spear_damage',{rank:5,runtime:{current_attack_damage_value:200,current_other_stat_value:100,additional_spear_count:3},attributes:attrs}));
record('kalista_e','等级1减速比例其他属性100',.15,calculate('kalista_e','slow_ratio',{rank:1,runtime:{current_other_stat_value:100},attributes:attrs}));
record('kalista_e','等级5减速比例其他属性100',.47,calculate('kalista_e','slow_ratio',{rank:5,runtime:{current_other_stat_value:100},attributes:attrs}));
record('draven_w','等级1攻速加成',.2,value('draven_w','attack_speed_gain_ratio',{rank:1}));
record('draven_w','等级5初始移速加成',.7,value('draven_w','initial_move_speed_ratio',{rank:5}));
check('德莱文P未写金币奖励且保留崇拜参数',equal(body('draven_p').parameters.map(p=>p.parameterKey),['catch_adoration_gain','death_adoration_loss_ratio'])&&body('draven_r').parameters.some(p=>p.parameterKey==='current_adoration_stacks'));
check('卡莉丝塔E没有把包装根Cooldown0当冷却',value('kalista_e','cooldown_ms',{rank:1})===10000&&value('kalista_e','cooldown_ms',{rank:5})===8000);
check('卡莉丝塔W与R纯队友范围外为空',body('kalista_w').parameters.length===0&&body('kalista_w').formulas.length===0&&body('kalista_w').effects.length===0&&body('kalista_r').parameters.length===0&&body('kalista_r').formulas.length===0&&body('kalista_r').effects.length===0);
check('卡莉丝塔P未采用旧90%普攻或特殊模式攻速',body('kalista_p').parameters.length===0&&body('kalista_p').formulas.length===0&&body('kalista_p').effects.length===0&&body('kalista_p').triggerRules?.length===0);
check('未解码属性使用运行时输入且不是0占位',parameter('kalista_e','current_attack_damage_value')?.valueMode==='RUNTIME_INPUT'&&parameter('kalista_e','current_other_stat_value')?.valueMode==='RUNTIME_INPUT');
const candidateSha256=sha256(bytes);
const failures=[...hashes,...checks,...arithmetic].filter(v=>!v.match);
const report={generatedAt:new Date().toISOString(),boundary:'仅冻结来源、候选结构与独立算术；没有业务保存、数据库回读、浏览器或战斗运行证据。后十候选来自前置Codex执行，当前独算由接手代理完成。',candidateSha256,reusedPublicParameters:reused,sourceChecks:hashes,arithmetic,invariants:checks,failures};
await writeFile(new URL('./后十技能独立核算.json',here),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({candidateSha256,reused,sourceChecks:hashes.length,arithmetic:arithmetic.length,invariants:checks.length,failures:failures.length}));
if(failures.length)process.exitCode=1;
