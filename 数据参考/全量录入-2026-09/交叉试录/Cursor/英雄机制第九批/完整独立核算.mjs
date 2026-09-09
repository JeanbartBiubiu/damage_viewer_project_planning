import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const here=new URL('.',import.meta.url);
const root='C:/project/damage_web_dev';
const plan=JSON.parse(await readFile(process.env.HERO9_CANDIDATE_PATH??new URL('./完整候选.json',here),'utf8'));
const evidence=JSON.parse(await readFile(new URL('./根绑定与数值证据.json',here),'utf8'));
const old=JSON.parse(await readFile(new URL('../英雄机制第五批/完整候选.json',here),'utf8'));
const namedHealthEvidence=JSON.parse(await readFile('C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/API实录/符文客户端数值补证/当前69项数值来源.json','utf8'));
const keys=['masteryi_p','masteryi_q','masteryi_w','masteryi_e','masteryi_r','trundle_p','trundle_q','trundle_w','trundle_e','trundle_r','pantheon_p','pantheon_q','pantheon_w','pantheon_e','pantheon_r','talon_p','talon_q','talon_w','talon_e','talon_r'];
const clean=n=>Math.round(n*1e6)/1e6;
const sha256=b=>createHash('sha256').update(b).digest('hex');
const numEqual=(a,b)=>typeof a==='number'&&typeof b==='number'?Math.abs(a-b)<1e-5:isDeepStrictEqual(a,b);
const stable=value=>JSON.stringify(value,(k,v)=>['gameId','skillKey','createdAt','updatedAt'].includes(k)?undefined:v);
const errors=[];
const checks=[];
function check(name,ok,detail){checks.push({name,ok,detail});if(!ok)errors.push({name,detail});}
const expressionNodeTypes=new Set(['PARAMETER','ATTRIBUTE','OPERATION']);
function checkExpressionNode(node,path){
  const supported=!!node&&typeof node==='object'&&expressionNodeTypes.has(node.nodeType);
  check(`公式表达式节点类型 ${path}`,supported,node);
  if(!supported)return;
  if(node.nodeType==='PARAMETER')check(`公式表达式参数键 ${path}`,typeof node.parameterKey==='string'&&node.parameterKey.length>0,node);
  if(node.nodeType==='ATTRIBUTE')check(`公式表达式属性字段 ${path}`,[node.attributeOwner,node.attributeKey,node.attributeValueKind].every(v=>typeof v==='string'&&v.length>0),node);
  if(node.nodeType==='OPERATION'){
    check(`公式表达式二元运算 ${path}`,Array.isArray(node.operands)&&node.operands.length===2,node);
    if(Array.isArray(node.operands))node.operands.forEach((child,i)=>checkExpressionNode(child,path+'.operands['+i+']'));
  }
}
function sourceSpell(skillKey){for(const h of evidence.heroes){const s=h.spells.find(v=>v.skillKey===skillKey);if(s)return {hero:h,spell:s};}throw Error('缺来源 '+skillKey);}
function param(skill,key){const p=skill.write.parameters.find(v=>v.parameterKey===key);if(!p)throw Error('候选缺参数 '+skill.skillKey+'/'+key);return p;}
function pv(skill,key,rank=1,level=1,runtime={}){const p=param(skill,key);if(p.valueMode==='FIXED')return p.fixedValue;if(p.valueMode==='RUNTIME_INPUT'){const v=runtime[key];if(!Number.isFinite(v))throw Error('缺运行时输入 '+skill.skillKey+'/'+key);return v;}return p.levelValues[String(p.valueMode==='CHARACTER_LEVEL'?level:rank)];}
function valueOf(node,skill,ctx){
  if(node==null)throw Error('空表达式节点 '+skill.skillKey);
  if(node.nodeType==='PARAMETER')return pv(skill,node.parameterKey,ctx.rank,ctx.level,ctx.runtime);
  if(node.nodeType==='ATTRIBUTE'){
    const k=`${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`;
    const v=ctx.attributes[k];if(!Number.isFinite(v))throw Error('缺属性输入 '+skill.skillKey+'/'+k);return v;
  }
  if(node.kind==='PARAMETER')return pv(skill,node.parameterKey,ctx.rank,ctx.level,ctx.runtime);
  if(node.kind==='FIXED')return node.value;
  if(node.kind==='FORMULA')return formulaValue(node.formulaKey,skill,ctx);
  if(node.nodeType==='OPERATION'){
    const [a,b]=node.operands.map(v=>valueOf(v,skill,ctx));
    if(node.operation==='ADD')return a+b;
    if(node.operation==='SUBTRACT')return a-b;
    if(node.operation==='MULTIPLY')return a*b;
    if(node.operation==='DIVIDE')return a/b;
    if(node.operation==='MIN')return Math.min(a,b);
    if(node.operation==='MAX')return Math.max(a,b);
    throw Error('未知运算 '+node.operation);
  }
  throw Error('未知表达式节点 '+JSON.stringify(node));
}
function formulaValue(key,skill,ctx){const f=skill.write.formulas.find(v=>v.formulaKey===key);if(!f)throw Error('公式引用缺失 '+skill.skillKey+'/'+key);return valueOf(f.expression,skill,ctx);}
function runtimeFor(skill){
  const out={};
  // 仅为算术核验显式提供的任意实际值，不对应等级曲线，不进入候选默认。
  const suppliedLevelValues={empowered_base_damage_by_level:137,empowered_attack_ratio_by_level:.47,resists_base_by_level:17,bleed_base_damage_by_level:193,kill_heal_by_level:23};
  for(const p of skill.write.parameters.filter(v=>v.valueMode==='RUNTIME_INPUT')){
    if(Object.hasOwn(suppliedLevelValues,p.parameterKey))out[p.parameterKey]=suppliedLevelValues[p.parameterKey];
    else if(p.valueType==='INTEGER')out[p.parameterKey]=2;
    else if(/critical_stat/i.test(p.parameterKey))out[p.parameterKey]=1;
    else if(/missing_health/i.test(p.parameterKey))out[p.parameterKey]=1.5;
    else if(/multiplier|ratio|refund|percent/i.test(p.parameterKey))out[p.parameterKey]=1;
    else if(/max_mana/i.test(p.parameterKey))out[p.parameterKey]=1000;
    else if(/q_hold_damage/i.test(p.parameterKey))out[p.parameterKey]=200;
    else out[p.parameterKey]=100;
  }
  return out;
}
const attributes={
  'SOURCE.attack_damage.BONUS':120,
  'SOURCE.attack_damage.TOTAL':300,
  'SOURCE.ability_power.TOTAL':100,
  'SOURCE.hp.TOTAL':1800,
  'SOURCE.hp.BONUS':600,
  'SOURCE.hp.CURRENT':1400,
  'SOURCE.hp.MISSING':500,
  'SOURCE.mana.TOTAL':1000,
  'TARGET.attack_damage.BONUS':100,
  'TARGET.attack_damage.TOTAL':250,
  'TARGET.ability_power.TOTAL':80,
  'TARGET.hp.TOTAL':1800,
  'TARGET.hp.CURRENT':1200,
  'TARGET.hp.MISSING':600,
  'TARGET.mana.TOTAL':800,
};

// 1. 独立重算4份客户端压缩原文与4份官方原文哈希，并检查根绑定对象仍然相同。
for(const h of evidence.heroes){
  const cPath=`C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录/${h.client.path}`;
  const oPath=requirePath(h.official.path);
  const cb=await readFile(cPath), raw=gunzipSync(cb), ob=await readFile(oPath);
  const clientHash=sha256(raw),compressedHash=sha256(cb),officialHash=sha256(ob);
  check('客户端原文哈希 '+h.id,clientHash===h.client.sha256,{expected:h.client.sha256,actual:clientHash});
  check('客户端压缩哈希 '+h.id,compressedHash===h.client.compressedSha256,{expected:h.client.compressedSha256,actual:compressedHash});
  check('官方原文哈希 '+h.id,officialHash===h.official.sha256,{expected:h.official.sha256,actual:officialHash});
  const obj=JSON.parse(raw);
  check('角色根存在 '+h.id,!!obj[h.rootPath],h.rootPath);
  for(const s of h.spells){check('技能根绑定存在 '+s.skillKey,!!obj[s.binding]?.mSpell,s.binding);}
}
function requirePath(relative){return `C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录/${relative.replace(/^\.\//,'')}`;}

// 2. 技能槽、组件稳定键、未知字段和第五批完整特朗德尔写对象核对。
check('技能槽精确20个',Object.keys(plan.skills).length===20&&isDeepStrictEqual(Object.keys(plan.skills),keys),Object.keys(plan.skills));
check('候选声明不写业务API',plan.meta.apiWrites===0,plan.meta.apiWrites);
for(const key of keys){
  const s=plan.skills[key];
  for(const [kind,items] of Object.entries(s.write)){
    const ids=items.map(v=>v.parameterKey??v.formulaKey??v.effectKey??v.processKey??v.stateKey??v.ruleKey);
    check(`稳定键唯一 ${key}/${kind}`,ids.length===new Set(ids).size,ids);
    check(`组成对象完整 ${key}/${kind}`,items.every(v=>v&&typeof v==='object'),items.length);
  }
  for(const p of s.write.parameters){
    if(p.valueMode==='RUNTIME_INPUT')check(`未知输入不写固定值 ${key}/${p.parameterKey}`,p.fixedValue===null&&p.levelValues===null,p);
    if(p.valueMode==='CHARACTER_LEVEL')check(`角色等级参数18级 ${key}/${p.parameterKey}`,Object.keys(p.levelValues??{}).length===18,p.levelValues);
  }
}
function comparableComponents(write){
  const id=v=>v.parameterKey??v.formulaKey??v.effectKey??v.processKey??v.stateKey??v.ruleKey;
  return Object.fromEntries(Object.entries(write).map(([kind,items])=>[kind,items.map(v=>Object.fromEntries(Object.entries(v).filter(([key])=>!['gameId','skillKey','createdAt','updatedAt'].includes(key)))).sort((a,b)=>id(a).localeCompare(id(b)))]));
}
for(const key of ['trundle_p','trundle_q','trundle_w','trundle_e','trundle_r']){
  check('特朗德尔完整写对象原样复用 '+key,isDeepStrictEqual(comparableComponents(plan.skills[key].write),comparableComponents(old.skills[key].write)),{current:plan.skills[key].write,old:old.skills[key].write});
}
for(const key of keys.filter(k=>!k.startsWith('trundle_'))){
  const s=plan.skills[key];
  const damageResults=s.write.effects.flatMap(e=>e.results??[]).filter(r=>r.resultType==='DAMAGE');
  const healResults=s.write.effects.flatMap(e=>e.results??[]).filter(r=>r.resultType==='DIRECT_HEAL');
  check('新候选未生成未证DAMAGE '+key,damageResults.length===0,damageResults);
  check('新候选未生成未证DIRECT_HEAL '+key,healResults.length===0,healResults);
  check('新候选未生成占位过程 '+key,s.write.processes.length===0,s.write.processes);
}
check('泰隆E纯地形候选写对象为空',isDeepStrictEqual(plan.skills.talon_e.write,{parameters:[],formulas:[],effects:[],processes:[],internalStates:[],triggerRules:[]}),plan.skills.talon_e.write);
for(const key of keys)for(const f of plan.skills[key].write.formulas??[])checkExpressionNode(f.expression,`${key}/${f.formulaKey}`);
const missing=plan.skills.pantheon_e.proofs.find(v=>v.parameterKey==='self_slow_ratio');
check('潘森E缺值不补参数',!!missing&&missing.missingValues===true&&!plan.skills.pantheon_e.write.parameters.some(v=>v.parameterKey==='self_slow_ratio'),missing);
const aftershock=namedHealthEvidence.entries?.find(v=>v.id===8439&&v.name==='余震');
const aftershockPart=aftershock?.object?.mScript?.mSpellScriptData?.mCalculations?.DamageCalc?.mFormulaParts?.[1];
const aftershockLongDesc=aftershock?.bound?.mLongDescLocalizationKey?.text;
const pantheonW=plan.skills.pantheon_w;
const pantheonWMaxHealth=sourceSpell('pantheon_w').spell.object.mSpell.mSpellCalculations?.MaxHealthDamageCalc?.mFormulaParts;
const pantheonWHealthProof=pantheonW.proofs.find(v=>(v.source??'').includes('当前69项数值来源.json#entries[38]'));
const pantheonWRatioFormula=pantheonW.write.formulas.find(v=>v.formulaKey==='max_health_damage_ratio_calc')?.expression;
function hasAttribute(node,owner,key,kind){if(!node||typeof node!=='object')return false;if(node.nodeType==='ATTRIBUTE'&&node.attributeOwner===owner&&node.attributeKey===key&&node.attributeValueKind===kind)return true;return Array.isArray(node.operands)&&node.operands.some(v=>hasAttribute(v,owner,key,kind));}
check('同版余震HealthRatio节点证据',aftershockPart?.mStat===12&&aftershockPart?.mStatFormula===2&&aftershockPart?.mDataValue==='HealthRatio'&&aftershockPart?.__type==='StatByNamedDataValueCalculationPart'&&numEqual(aftershock?.object?.mScript?.mSpellScriptData?.mEffectAmount?.HealthRatio,0.07999999821186066),{aftershockPart,healthRatio:aftershock?.object?.mScript?.mSpellScriptData?.mEffectAmount?.HealthRatio});
check('同版余震长说明确认额外生命',typeof aftershockLongDesc==='string'&&aftershockLongDesc.includes('额外生命值'),aftershockLongDesc);
check('潘森W原始节点同组合',pantheonWMaxHealth?.[1]?.mStat===12&&pantheonWMaxHealth?.[1]?.mStatFormula===2&&numEqual(pantheonWMaxHealth?.[1]?.mCoefficient,0.000039999998989515007),pantheonWMaxHealth?.[1]);
check('潘森W旁证已记录',!!pantheonWHealthProof&&pantheonWHealthProof.raw?.mStat===12&&pantheonWHealthProof.raw?.mStatFormula===2&&pantheonWHealthProof.raw?.mDataValue==='HealthRatio'&&String(pantheonWHealthProof.source).includes('8439'),pantheonWHealthProof);
check('潘森W最大生命项映射自身额外生命',hasAttribute(pantheonWRatioFormula,'SOURCE','hp','BONUS')&&!pantheonW.write.parameters.some(v=>v.parameterKey==='current_max_health_stat_value'),{formula:pantheonWRatioFormula,parameters:pantheonW.write.parameters.map(v=>v.parameterKey)});

// 3. 对所有DataValues证据独立从原始根对象重算索引、缩放并对照候选参数。
for(const key of keys){
  const {hero,spell}=sourceSpell(key),s=plan.skills[key],dataValues=spell.object.mSpell.DataValues??spell.object.mSpell.mDataValues??[];
  for(const proof of s.proofs.filter(v=>v.parameterKey&&/^DataValues\./.test(v.source??''))){
    const source=proof.source.slice('DataValues.'.length);
    if(proof.missingValues){check(`来源缺值保持空 ${key}/${source}`,proof.values==null&&!s.write.parameters.some(v=>v.parameterKey===proof.parameterKey),proof);continue;}
    const d=dataValues.find(v=>v.name===source||v.mName===source);
    check(`来源字段存在 ${key}/${source}`,!!d,d);
    if(!d)continue;
    const raw=d.values??d.mValues;
    const offset=proof.offset??1, scale=proof.scale??1, expected=raw.slice(offset,offset+s.maxLevel).map(v=>clean(clean(v)*scale));
    check(`来源原值一致 ${key}/${source}`,isDeepStrictEqual(proof.raw,raw),{proof:proof.raw,raw});
    check(`来源逐级算术一致 ${key}/${source}`,isDeepStrictEqual(proof.values,expected),{proof:proof.values,expected});
    const p=param(s,proof.parameterKey),actual=p.valueMode==='FIXED'?[p.fixedValue]:Object.values(p.levelValues??{}).map(Number);
    check(`参数映射一致 ${key}/${proof.parameterKey}`,actual.length===1?expected.every(v=>numEqual(v,actual[0])):actual.length===expected.length&&actual.every((v,i)=>numEqual(v,expected[i])),{actual,expected});
  }
}

// 4. 用独立解释器以多个技能等级和角色等级计算全部候选公式，禁止任何非有限结果。
const formulaRuns=[];
for(const key of keys){
  const s=plan.skills[key],runs=[];
  for(const rank of [...new Set([1,Math.ceil(s.maxLevel/2),s.maxLevel])])for(const level of [1,9,18]){
    const ctx={rank,level,runtime:runtimeFor(s),attributes};
    for(const f of s.write.formulas){
      try{const value=clean(valueOf(f.expression,s,ctx));runs.push({formulaKey:f.formulaKey,rank,level,value,finite:Number.isFinite(value)});}
      catch(error){runs.push({formulaKey:f.formulaKey,rank,level,error:String(error),finite:false});}
    }
  }
  const bad=runs.filter(v=>!v.finite||!Number.isFinite(v.value));
  check('公式独立核算有限 '+key,bad.length===0,bad);
  formulaRuns.push({skillKey:key,runs});
}
function findRun(skillKey,formulaKey,rank,level){const x=formulaRuns.find(v=>v.skillKey===skillKey);return x?.runs.find(v=>v.formulaKey===formulaKey&&v.rank===rank&&v.level===level)?.value;}
check('易P 0.5总攻击力独立算术',numEqual(findRun('masteryi_p','second_attack_damage',1,1),150),findRun('masteryi_p','second_attack_damage',1,1));
check('易Q后续比例独立算术',numEqual(findRun('masteryi_q','subsequent_damage',3,9),clean((60+0.7*300)*.25)),findRun('masteryi_q','subsequent_damage',3,9));
check('易E额外真实伤害独立算术',numEqual(findRun('masteryi_e','on_hit_true_damage',5,18),clean(40+.35*120)),findRun('masteryi_e','on_hit_true_damage',5,18));
check('潘森Q蓄力独立算术',numEqual(findRun('pantheon_q','hold_damage',1,1),clean(70+1.15*120+.5*100)),findRun('pantheon_q','hold_damage',1,1));
check('潘森W强化三击外供0.47独立算术',numEqual(findRun('pantheon_w','empowered_damage',5,18),clean(3*.47*300)),findRun('pantheon_w','empowered_damage',5,18));
check('潘森W最大生命比例独立算术',numEqual(findRun('pantheon_w','max_health_damage_ratio_calc',1,1),clean(.06+.00004*600+.00015*100)),findRun('pantheon_w','max_health_damage_ratio_calc',1,1));
check('潘森W跃击额外生命独立算术',numEqual(findRun('pantheon_w','jump_damage',1,1),clean((.06+.00004*600+.00015*100)*1800)),findRun('pantheon_w','jump_damage',1,1));
check('潘森R边缘最低比例独立算术',numEqual(findRun('pantheon_r','edge_damage_floor_ratio',1,1),.5),findRun('pantheon_r','edge_damage_floor_ratio',1,1));
check('泰隆P外供基础值193独立算术',numEqual(findRun('talon_p','bleed_damage',1,18),clean(193+2.1*120)),findRun('talon_p','bleed_damage',1,18));
check('泰隆Q近战暴击独立算术',numEqual(findRun('talon_q','critical_damage',5,9),clean((1.5+1)*((145+120)))),findRun('talon_q','critical_damage',5,9));

// 从当前输入（实录时为实际GET）核秒到毫秒结果，显式倍率不是运行默认。
for(const multiplier of [.5,1,1.25]){const skill=plan.skills.masteryi_q,ctx={rank:1,level:1,runtime:{current_cooldown_multiplier:multiplier},attributes},result=skill.write.effects.find(e=>e.effectKey==='basic_attack_cooldown_reduction').results[0],actual=valueOf(result.valueRule.value,skill,ctx)*result.valueRule.fixedMultiplier;check('易Q实际结果毫秒 '+multiplier,numEqual(actual,1000*multiplier),{actual,expected:1000*multiplier});}

// 5. 生命周期运行时规则与当前只读状态边界检查。
for(const [key,s] of Object.entries(plan.skills)){
  for(const e of s.write.effects)for(const r of e.results??[]){
    const p=r.valueRule?.value?.kind==='PARAMETER'?s.write.parameters.find(v=>v.parameterKey===r.valueRule.value.parameterKey):null;
    const b=r.lifecycleBehavior;
    const invalid=b?.moment==='PERSISTENT'&&b.valueReadMode==='MOMENT_EVALUATION'&&p?.valueMode==='RUNTIME_INPUT';
    check(`动态输入不挂持续瞬时读取 ${key}/${e.effectKey}/${r.resultKey}`,!invalid,{result:r,p});
  }
}
let currentRead={status:'unavailable',reason:'未成功GET'};
try{
  const currentReport=JSON.parse(await readFile(new URL('./当前20技能组成核对.json',here)));
  const currentSnapshot=JSON.parse(await readFile(new URL('./写前现值.json',here)));
  if(currentReport.summary?.errorCount===0&&currentSnapshot.skills)currentRead={...currentSnapshot,success:true,status:'success',summary:currentReport.summary,snapshotSha256:currentReport.snapshotSha256};
}catch{}
const failurePath=new URL('../../../../../.agents/artifacts/hero9-fix/当前20技能GET失败.json',here);
let getFailure=null;try{getFailure=JSON.parse(await readFile(failurePath));}catch{}
check('当前组成只读状态如实记录',currentRead.success===true||getFailure?.summary?.errorCount>=0,{currentRead,getFailure:getFailure?.summary});

const outputCounts={
  totalDamageResults:keys.reduce((n,k)=>n+plan.skills[k].write.effects.flatMap(e=>e.results??[]).filter(r=>r.resultType==='DAMAGE').length,0),
  totalDirectHealResults:keys.reduce((n,k)=>n+plan.skills[k].write.effects.flatMap(e=>e.results??[]).filter(r=>r.resultType==='DIRECT_HEAL').length,0),
  totalProcesses:keys.reduce((n,k)=>n+plan.skills[k].write.processes.length,0),
  newHeroDamageResults:keys.filter(k=>!k.startsWith('trundle_')).reduce((n,k)=>n+plan.skills[k].write.effects.flatMap(e=>e.results??[]).filter(r=>r.resultType==='DAMAGE').length,0),
  newHeroDirectHealResults:keys.filter(k=>!k.startsWith('trundle_')).reduce((n,k)=>n+plan.skills[k].write.effects.flatMap(e=>e.results??[]).filter(r=>r.resultType==='DIRECT_HEAL').length,0),
  newHeroProcesses:keys.filter(k=>!k.startsWith('trundle_')).reduce((n,k)=>n+plan.skills[k].write.processes.length,0),
};
const report={generatedAt:new Date().toISOString(),skillCount:keys.length,apiWrites:0,errors,checks,formulaRuns,outputCounts,currentRead:{status:currentRead.success?'success':'unavailable',summary:currentRead.summary??getFailure?.summary??currentRead.reason},sourceHashes:evidence.heroes.map(h=>({id:h.id,clientSha256:h.client.sha256,clientCompressedSha256:h.client.compressedSha256,officialSha256:h.official.sha256})),reusedExisting:keys.filter(k=>k.startsWith('trundle_')).map(k=>({skillKey:k,writeSha256:sha256(stable(plan.skills[k].write))})),pass:errors.length===0};
await writeFile(process.env.HERO9_CHECK_OUTPUT_PATH??new URL('./完整独立核算.json',here),JSON.stringify(report,null,2)+'\n');
if(!process.env.HERO9_CHECK_OUTPUT_PATH) await mkdir(new URL('../../../../../.agents/artifacts/hero9-fix/',here),{recursive:true});
if(!process.env.HERO9_CHECK_OUTPUT_PATH) await writeFile(new URL('../../../../../.agents/artifacts/hero9-fix/独立核算摘要.json',here),JSON.stringify({generatedAt:report.generatedAt,pass:report.pass,skillCount:report.skillCount,apiWrites:0,errorCount:errors.length,checkCount:checks.length,currentRead:report.currentRead,outputCounts:report.outputCounts,sourceHashes:report.sourceHashes,reusedExisting:report.reusedExisting,formulaCheckCount:formulaRuns.reduce((n,s)=>n+s.runs.length,0)},null,2)+'\n');
console.log(JSON.stringify({pass:report.pass,skillCount:keys.length,apiWrites:0,errorCount:errors.length,checkCount:checks.length,formulaCheckCount:formulaRuns.reduce((n,s)=>n+s.runs.length,0),currentRead:report.currentRead.status}));
