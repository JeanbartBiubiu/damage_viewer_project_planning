import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';

const here=new URL('./',import.meta.url);
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const inputPath=process.env.HERO8_CANDIDATE_PATH??new URL('./前十技能候选.json',here);
const bytes=await readFile(inputPath);
const plan=JSON.parse(bytes);
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
const value=(key,parameterKey,{rank=1,level=1,runtime={}}={})=>{
 const p=parameter(key,parameterKey);if(!p)throw Error(`缺参数 ${key}/${parameterKey}`);
 if(p.valueMode==='FIXED')return p.fixedValue;
 if(p.valueMode==='RUNTIME_INPUT')return runtime[parameterKey];
 if(p.valueMode==='CHARACTER_LEVEL')return p.levelValues?.[String(level)];
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
const attrs={
 'SOURCE.attack_damage.TOTAL':200,
 'SOURCE.attack_damage.BONUS':100,
 'SOURCE.critical_strike_chance.TOTAL':.25,
 'SOURCE.critical_strike_damage_bonus_percent.TOTAL':.4,
 'SOURCE.bonus_attack_speed_percent.TOTAL':.5,
 'TARGET.hp.MISSING':1000
};
const sourceBase='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录';
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');
for(const h of sources.heroes.filter(h=>['Caitlyn','Jhin'].includes(h.id))){
 const clientBytes=gunzipSync(await readFile(path.join(sourceBase,h.client.path)));
 const officialBytes=await readFile(path.resolve(sourceBase,h.official.path));
 hashes.push({hero:h.id,kind:'client',expected:h.client.sha256,actual:sha256(clientBytes),match:sha256(clientBytes)===h.client.sha256});
 hashes.push({hero:h.id,kind:'official',expected:h.official.sha256,actual:sha256(officialBytes),match:sha256(officialBytes)===h.official.sha256});
}
const textBytes=gunzipSync(await readFile(texts.path));
hashes.push({kind:'当前字符串表',expected:texts.sha256,actual:sha256(textBytes),match:sha256(textBytes)===texts.sha256});
for(const h of sources.heroes.filter(h=>['Caitlyn','Jhin'].includes(h.id)))for(const s of h.spells){
 const c=plan.skills[s.skillKey];
 check(s.skillKey+'根绑定与来源哈希',!!c&&c.source.hero===h.id&&c.source.rootPath===h.rootPath&&c.source.spellPath===s.binding&&c.source.clientSha256===h.client.sha256&&c.source.officialSha256===h.official.sha256);
 check(s.skillKey+'当前mLocKeys中文精确复用',equal(c?.source?.currentBoundText,texts.skills[s.skillKey]));
}
check('来源文件哈希全部一致',hashes.every(v=>v.match),hashes);
const expectedKeys=['caitlyn','jhin'].flatMap(h=>['p','q','w','e','r'].map(s=>h+'_'+s));
check('只含凯特琳与烬前十十槽',equal(Object.keys(plan.skills),expectedKeys),Object.keys(plan.skills));
check('候选明确未写业务API',plan.meta.apiWrites===0&&plan.meta.stage==='前十技能候选；未写业务API',plan.meta);
const publicKeys={caitlyn_q:['cooldown_ms','mana_cost'],caitlyn_e:['cooldown_ms','mana_cost'],caitlyn_r:['cooldown_ms','mana_cost'],jhin_q:['cooldown_ms','mana_cost'],jhin_w:['cooldown_ms','mana_cost'],jhin_r:['cooldown_ms','mana_cost']};
let reused=0;const reuseFailures=[];
for(const [skillKey,keys] of Object.entries(publicKeys)){
 const prev=before.skills[skillKey].components.parameters;
 const current=body(skillKey).parameters;
 for(const key of keys){
  const old=prev.find(p=>p.parameterKey===key);
  const now=current.find(p=>p.parameterKey===key);
  const stripped=old&&Object.fromEntries(Object.entries(old).filter(([k])=>!['gameId','skillKey','createdAt','updatedAt'].includes(k)));
  const ok=!!old&&!!now&&plan.skills[skillKey].reusedParameters.includes(key)&&equal(now,stripped);
  if(ok)reused++;else reuseFailures.push(skillKey+'/'+key);
  check(skillKey+'公共参数逐字段保留 '+key,ok,{old:old&&stripped,current:now});
 }
}
check('精确保留12项既有公共参数',reused===12&&!reuseFailures.length,{reused,reuseFailures});
const dataMap={
 caitlyn_p:[['CriticalStrikeScaling','critical_strike_scaling',1],['AttacksPerHeadshot','attacks_per_headshot',1],['BrushStackBonus','brush_stack_bonus',1]],
 caitlyn_q:[['BaseDamage','base_damage',1],['tADRatio','total_ad_ratio',1]],
 caitlyn_w:[['BaseDamage','trap_headshot_base_damage',1],['ADRatio','trap_headshot_ad_ratio',1]],
 caitlyn_e:[['Damage','base_damage',1],['SlowDuration','slow_duration_ms',1000],['SlowAmount','slow_ratio',.01]],
 caitlyn_r:[['RBaseDamage','base_damage',1],['RADRatio','bonus_ad_ratio',1],['CriticalStrikeModifier','crit_damage_scaling',1]],
 jhin_p:[['MaxAmmo','max_ammo',1],['ReloadTime','reload_time_ms',1000],['HasteDuration','crit_move_speed_duration_ms',1000],['OutOfCombatTimeBeforeReload','out_of_combat_reload_delay_ms',1000],['FourthShotDamageMult','fourth_shot_damage_multiplier',1],['CritReductionPercent','crit_damage_reduction_ratio',1],['BaseAttackSpeed','base_attack_speed',1],['PercentAttackSpeedPerLevel','attack_speed_per_level_ratio',1],['CritMoveSpeedPercentASRatio','crit_move_speed_attack_speed_ratio',1]],
 jhin_q:[['BaseDamage','base_damage',1],['ADRatio','total_ad_ratio',1]],
 jhin_w:[['BaseDamage','base_damage',1],['RootDuration','root_duration_ms',1000],['SpottingDuration','spotting_duration_ms',1000]],
 jhin_r:[['Damage','base_damage',1],['FourthShotMultiplier','fourth_shot_multiplier',1],['SlowPercent','slow_ratio',1],['SlowDuration','slow_duration_ms',1000],['PercentMissingAmp','missing_health_max_amp',1],['MInimumDelayBetweenShots','minimum_shot_interval_ms',1000],['ADRatio','attack_damage_ratio',1]]
};
for(const [skillKey,entries] of Object.entries(dataMap)){
 const spell=sources.heroes.flatMap(h=>h.spells).find(s=>s.skillKey===skillKey);const root=spell?.object.mSpell;const maxLevel=spell?.official.maxrank??1;
 for(const [sourceName,key,scale] of entries){
  const d=(root?.DataValues??[]).find(v=>v.name===sourceName);const raw=d?.values??[];const expected=raw.slice(1,maxLevel+1).map(v=>Math.round(Math.round(v*1e6)/1e6*scale*1e6)/1e6);const p=parameter(skillKey,key);const actual=Array.from({length:maxLevel},(_,i)=>p?.valueMode==='FIXED'?p.fixedValue:p?.levelValues?.[String(i+1)]);
  check(skillKey+'参数原值 '+key,equal(actual,expected),{sourceName,expected,actual});
 }
}
const caitP=sources.heroes.find(h=>h.id==='Caitlyn').spells.find(s=>s.skillKey==='caitlyn_p').object.mSpell;
const caitPcurve=caitP.mSpellCalculations.HeadShotBonusDamage.mFormulaParts[0].mSubpart.mSubparts[0];
const jhinP=sources.heroes.find(h=>h.id==='Jhin').spells.find(s=>s.skillKey==='jhin_p').object.mSpell;
for(const [skillKey,key,node] of [
 ['caitlyn_p','level_bonus_ratio',caitPcurve],
 ['jhin_p','fourth_shot_execute_percent',jhinP.mSpellCalculations.FourthShotExecutePercent.mFormulaParts[0]],
 ['jhin_p','level_attack_damage_percent',jhinP.mSpellCalculations.TotalADPercent.mFormulaParts[0]]
])check(skillKey+'未证完整等级曲线不展开 '+key,parameter(skillKey,key).valueMode==='RUNTIME_INPUT'&&parameter(skillKey,key).levelValues===null&&parameter(skillKey,key).fixedValue===null,{raw:node,candidate:parameter(skillKey,key)});
for(const [skillKey,s] of Object.entries(plan.skills)){
 const w=s.write;const allKeys={parameters:new Set(w.parameters.map(v=>v.parameterKey)),formulas:new Set(w.formulas.map(v=>v.formulaKey)),effects:new Set(w.effects.map(v=>v.effectKey))};
 const missing=[];const formulaStack=[];
 function references(node,stack=[]){if(!node||typeof node!=='object')return;if(node.kind==='PARAMETER'||node.nodeType==='PARAMETER'){if(!allKeys.parameters.has(node.parameterKey))missing.push(node.parameterKey);}if(node.kind==='FORMULA'){if(!allKeys.formulas.has(node.formulaKey))missing.push(node.formulaKey);else if(!stack.includes(node.formulaKey)){const f=w.formulas.find(v=>v.formulaKey===node.formulaKey);references(f.expression,[...stack,node.formulaKey]);}}for(const v of Object.values(node))if(v&&typeof v==='object')references(v,stack);}
 references(w);
 check(skillKey+'参数公式效果内部引用完整',missing.length===0,missing);
 check(skillKey+'稳定键不重复',Object.values(w).every(arr=>Array.isArray(arr)&&new Set(arr.map(v=>v.parameterKey??v.formulaKey??v.effectKey??v.processKey??v.stateKey??v.ruleKey)).size===arr.length));
 const invalidDynamic=w.effects.flatMap(e=>e.results??[]).filter(r=>r.lifecycleBehavior?.moment==='PERSISTENT'&&r.lifecycleBehavior.valueReadMode==='MOMENT_EVALUATION'&&r.valueRule?.value?.kind==='PARAMETER'&&parameter(skillKey,r.valueRule.value.parameterKey)?.valueMode==='RUNTIME_INPUT');
 check(skillKey+'没有持续瞬时读取运行时输入',invalidDynamic.length===0,invalidDynamic.map(r=>r.resultKey));
 const events=w.triggerRules.map(r=>r.eventSource?.eventType);check(skillKey+'没有假事件',events.every(t=>t==='SKILL_HIT')&&w.triggerRules.every(r=>r.eventSource?.detail?.sourceSkillKey===skillKey),events);
 for(const e of w.effects)for(const r of e.results??[]){if(r.detail?.attributeKey){const items=catalogs.catalogs.attributes.items;check(skillKey+'/'+e.effectKey+'属性目录存在',items.some(v=>v.attributeKey===r.detail.attributeKey&&v.status==='ENABLED'));}if(r.detail?.damageTypeKey){const items=catalogs.catalogs['damage-types'].items;check(skillKey+'/'+e.effectKey+'伤害类型目录存在',items.some(v=>v.damageTypeKey===r.detail.damageTypeKey&&v.status==='ENABLED'));}for(const a of w.triggerRules.flatMap(v=>v.actions??[])){if(a.detail?.effectKey)check(skillKey+'规则效果引用存在',allKeys.effects.has(a.detail.effectKey));}}
 check(skillKey+'没有内部状态误填',w.internalStates.length===0);
}
record('caitlyn_p','源中显式1级比例.6；暴击25%额外暴伤40%且攻击力输入200（口径待核）',190,calculate('caitlyn_p','headshot_bonus_damage',{attributes:attrs,runtime:{level_bonus_ratio:Math.round(caitPcurve.mLevel1Value*1e6)/1e6,current_attack_damage_value:200}}),{source:'HeadShotBonusDamage.mLevel1Value',noFullLevelCurve:true});
for(const [rank,expected] of [[1,300],[5,620]])record('caitlyn_q','等级'+rank+'Q首目标',expected,calculate('caitlyn_q','initial_damage',{rank,attributes:attrs}));
for(const [rank,expected] of [[1,65],[5,245]])record('caitlyn_w','等级'+rank+'陷阱强化爆头',expected,calculate('caitlyn_w','trap_headshot_bonus_damage',{rank,attributes:attrs}));
for(const [rank,expected] of [[1,120],[5,320]])record('caitlyn_e','等级'+rank+'E含未解码属性50',expected,calculate('caitlyn_e','net_damage',{rank,attributes:attrs,runtime:{unresolved_scaling_attribute:50}}));
for(const [rank,raw,mult,total] of [[1,400,1.105,442],[3,750,1.105,828.75]]){record('caitlyn_r','等级'+rank+'R未计暴击增幅',raw,calculate('caitlyn_r','raw_damage',{rank,attributes:attrs}));record('caitlyn_r','等级'+rank+'R暴击几率增幅倍率',mult,calculate('caitlyn_r','crit_damage_multiplier',{rank,attributes:attrs}));record('caitlyn_r','等级'+rank+'R完整伤害',total,calculate('caitlyn_r','damage',{rank,attributes:attrs}));}
record('caitlyn_r','总AD200额外AD100且暴击率0时R1裸伤害400',400,calculate('caitlyn_r','damage',{rank:1,attributes:{...attrs,'SOURCE.critical_strike_chance.TOTAL':0}}),{totalAD:200,bonusAD:100,wrongTotalADResult:500});
record('caitlyn_r','总AD改300但额外AD仍100，R1裸伤害不变400',400,calculate('caitlyn_r','raw_damage',{rank:1,attributes:{...attrs,'SOURCE.attack_damage.TOTAL':300}}));
record('caitlyn_r','总AD仍200而额外AD改50，R1裸伤害350',350,calculate('caitlyn_r','raw_damage',{rank:1,attributes:{...attrs,'SOURCE.attack_damage.BONUS':50}}));
record('jhin_p','源中显式1级比例.15，已损生命1000第四发额外量',150,calculate('jhin_p','fourth_shot_bonus_damage',{attributes:attrs,runtime:{fourth_shot_execute_percent:Math.round(jhinP.mSpellCalculations.FourthShotExecutePercent.mFormulaParts[0].mLevel1Value*1e6)/1e6}}),{noFullLevelCurve:true});
record('jhin_p','源中显式1级等级比例.04，暴击.25额外攻速.5转换',.2775,calculate('jhin_p','total_attack_damage_percent',{attributes:attrs,runtime:{level_attack_damage_percent:Math.round(jhinP.mSpellCalculations.TotalADPercent.mFormulaParts[0].mLevel1Value*1e6)/1e6}}),{noFullLevelCurve:true});
record('jhin_p','暴击移动速度比例',.36,calculate('jhin_p','crit_move_speed_percent',{attributes:attrs}));
for(const [rank,expected] of [[1,192],[5,352]])record('jhin_q','等级'+rank+'Q首目标含未解码属性100',expected,calculate('jhin_q','first_target_damage',{rank,attributes:attrs,runtime:{unresolved_scaling_attribute:100}}));
for(const [rank,expected] of [[1,170],[5,310]])record('jhin_w','等级'+rank+'W首英雄',expected,calculate('jhin_w','damage',{rank,attributes:attrs,runtime:{current_attack_damage_value:200}}));
for(const [rank,base,max] of [[1,114,456],[3,242,968]]){record('jhin_r','等级'+rank+'R基础端点',base,calculate('jhin_r','base_damage',{rank,attributes:attrs,runtime:{current_attack_damage_value:200}}));record('jhin_r','等级'+rank+'R最大端点',max,calculate('jhin_r','maximum_damage',{rank,attributes:attrs,runtime:{current_attack_damage_value:200}}));}
check('凯特琳W只保留强化公式不生成陷阱伤害',body('caitlyn_w').effects.length===0&&body('caitlyn_w').triggerRules.length===0);
check('烬E完整陷阱按范围外跳过',body('jhin_e').parameters.length===0&&body('jhin_e').formulas.length===0&&body('jhin_e').effects.length===0&&body('jhin_e').triggerRules.length===0);
check('未知枚举仅使用运行时输入',parameter('caitlyn_e','unresolved_scaling_attribute')?.valueMode==='RUNTIME_INPUT'&&parameter('jhin_q','unresolved_scaling_attribute')?.valueMode==='RUNTIME_INPUT');
const caitR=sources.heroes.find(h=>h.id==='Caitlyn').spells.find(s=>s.skillKey==='caitlyn_r').object.mSpell;
const caitW=sources.heroes.find(h=>h.id==='Caitlyn').spells.find(s=>s.skillKey==='caitlyn_w').object.mSpell;
const rNode=caitR.mSpellCalculations.RTotalDamage.mFormulaParts[1],wNode=caitW.mSpellCalculations.HeadShotBonusDamage.mFormulaParts[1];
check('Caitlyn R/W同源额外AD枚举一致',rNode.mStat===2&&rNode.mStatFormula===2&&wNode.mStat===2&&wNode.mStatFormula===2,{rNode,wNode});
check('Caitlyn R不含总AD系数或TOTAL读取',!parameter('caitlyn_r','total_ad_ratio')&&JSON.stringify(body('caitlyn_r').formulas.find(v=>v.formulaKey==='raw_damage')).includes('BONUS')&&!JSON.stringify(body('caitlyn_r').formulas.find(v=>v.formulaKey==='raw_damage')).includes('TOTAL'));
for(const [skillKey,keys] of [['caitlyn_q',['secondary_damage_ratio','secondary_damage']],['jhin_q',['kill_bounce_amp_ratio','bounce_count','bounce_range']],['jhin_w',['minion_damage_ratio']]])check(skillKey+'范围外组成不进入正常候选',keys.every(k=>!body(skillKey).parameters.some(p=>p.parameterKey===k)&&!body(skillKey).formulas.some(f=>f.formulaKey===k)),keys);
for(const [skillKey,s] of Object.entries(plan.skills)){
 check(skillKey+'未核伤害及触发全部撤出',s.write.effects.every(e=>e.results.every(r=>r.resultType!=='DAMAGE'))&&s.write.triggerRules.length===0&&s.write.processes.length===0);
 check(skillKey+'待补分类合法',s.pending.every(p=>['来源','系统','未接线'].includes(p.kind)));
}
check('前十来源与系统问题真实分栏',Object.values(plan.skills).some(s=>s.disposition.来源待核.length>0)&&Object.values(plan.skills).some(s=>s.disposition.系统缺口.length>0));
for(const key of ['caitlyn_p','jhin_w','jhin_r']){
 const p=parameter(key,'current_attack_damage_value');
 check(key+'无明确攻击力取值不默认TOTAL',p?.valueMode==='RUNTIME_INPUT'&&p.fixedValue===null&&p.levelValues===null&&!JSON.stringify(body(key).formulas).includes('attack_damage"'),{parameter:p});
}
const candidateSha256=sha256(bytes);
const failures=[...hashes,...checks,...arithmetic].filter(v=>!v.match);
const report={generatedAt:new Date().toISOString(),boundary:'仅冻结来源、候选结构与独立算术；没有业务保存、数据库回读、浏览器或战斗运行证据。原Cursor运行未完成，前十由Codex接手生成。',candidateSha256,reusedPublicParameters:reused,sourceChecks:hashes,arithmetic,invariants:checks,failures};
await writeFile(process.env.HERO8_CHECK_OUTPUT_PATH??new URL('./前十技能独立核算.json',here),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({candidateSha256,reused,sourceChecks:hashes.length,arithmetic:arithmetic.length,invariants:checks.length,failures:failures.length}));
if(failures.length)process.exitCode=1;
