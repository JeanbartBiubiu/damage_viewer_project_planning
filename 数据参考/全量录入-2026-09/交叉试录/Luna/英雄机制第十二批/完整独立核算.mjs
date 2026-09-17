import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';

const here=new URL('.',import.meta.url);
const rootBase='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录';
const keys=['twitch_p','twitch_q','twitch_w','twitch_e','twitch_r','lucian_p','lucian_q','lucian_w','lucian_e','lucian_r','sivir_p','sivir_q','sivir_w','sivir_e','sivir_r','tristana_p','tristana_q','tristana_w','tristana_e','tristana_r'];
const rawPlan=JSON.parse(await readFile(new URL('./候选原始.json',here),'utf8'));
const plan=JSON.parse(await readFile(new URL('./完整候选.json',here),'utf8'));
const evidence=JSON.parse(await readFile(new URL('./根绑定与数值证据.json',here),'utf8'));
const current=JSON.parse(await readFile(new URL('./当前20技能组成核对.json',here),'utf8'));
const currentSnapshot=JSON.parse(await readFile(new URL('./写前现值.json',here),'utf8'));
const errors=[];
const checks=[];
const formulaRuns=[];
const sha256=value=>createHash('sha256').update(Buffer.isBuffer(value)?value:typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const clean=n=>Math.round(n*1e6)/1e6;
const numEqual=(a,b)=>typeof a==='number'&&typeof b==='number'?Math.abs(a-b)<1e-5:isDeepStrictEqual(a,b);
const stripServerFields=value=>Object.fromEntries(Object.entries(value).filter(([k])=>!['gameId','skillKey','createdAt','updatedAt'].includes(k)));
function check(name,ok,detail){checks.push({name,ok,detail});if(!ok)errors.push({name,detail});}
function sourceSpell(skillKey){for(const h of evidence.heroes){const s=h.spells.find(v=>v.skillKey===skillKey);if(s)return {hero:h,spell:s};}throw Error('缺来源 '+skillKey);}
function param(skill,key){const p=skill.write.parameters.find(v=>v.parameterKey===key);if(!p)throw Error('候选缺参数 '+skill.skillKey+'/'+key);return p;}
function runtimeFor(skill,overrides={}){
  const out={};
  for(const p of skill.write.parameters.filter(v=>v.valueMode==='RUNTIME_INPUT')){
    if(Number.isFinite(overrides[p.parameterKey]))out[p.parameterKey]=overrides[p.parameterKey];
    else if(p.parameterKey==='poison_stacks')out[p.parameterKey]=3;
    else if(p.parameterKey==='bomb_stacks')out[p.parameterKey]=2;
    else out[p.parameterKey]=1;
  }
  return out;
}
function parameterValue(skill,key,ctx){
  const p=param(skill,key);
  if(p.valueMode==='FIXED')return p.fixedValue;
  if(p.valueMode==='RUNTIME_INPUT'){
    const value=ctx.runtime[key];
    if(!Number.isFinite(value))throw Error('缺运行时输入 '+skill.skillKey+'/'+key);
    return value;
  }
  const index=p.valueMode==='CHARACTER_LEVEL'?ctx.level:ctx.rank;
  const value=p.levelValues?.[String(index)];
  if(!Number.isFinite(value))throw Error('缺等级值 '+skill.skillKey+'/'+key+'/'+index);
  return value;
}
const attributes={
  'SOURCE.attack_damage.BONUS':120,
  'SOURCE.attack_damage.TOTAL':300,
  'SOURCE.ability_power.TOTAL':100,
  'SOURCE.critical_strike_chance.TOTAL':0.5,
  'SOURCE.critical_strike_damage_bonus_percent.TOTAL':0.4,
  'SOURCE.hp.TOTAL':1800,
  'SOURCE.hp.BONUS':600,
  'SOURCE.hp.CURRENT':1400,
  'SOURCE.mana.TOTAL':1000,
  'TARGET.attack_damage.BONUS':100,
  'TARGET.attack_damage.TOTAL':250,
  'TARGET.ability_power.TOTAL':80,
  'TARGET.hp.TOTAL':1800,
  'TARGET.hp.CURRENT':1200,
  'TARGET.hp.MISSING':600,
  'TARGET.mana.TOTAL':800
};
function evaluate(node,skill,ctx){
  if(node?.nodeType==='PARAMETER')return parameterValue(skill,node.parameterKey,ctx);
  if(node?.nodeType==='ATTRIBUTE'){
    const key=node.attributeOwner+'.'+node.attributeKey+'.'+node.attributeValueKind;
    if(!Object.prototype.hasOwnProperty.call(attributes,key))throw Error('缺属性输入 '+skill.skillKey+'/'+key);
    return attributes[key];
  }
  if(node?.nodeType==='OPERATION'){
    const a=evaluate(node.operands[0],skill,ctx),b=evaluate(node.operands[1],skill,ctx);
    if(node.operation==='ADD')return a+b;
    if(node.operation==='SUBTRACT')return a-b;
    if(node.operation==='MULTIPLY')return a*b;
    if(node.operation==='DIVIDE')return a/b;
    if(node.operation==='MIN')return Math.min(a,b);
    if(node.operation==='MAX')return Math.max(a,b);
    throw Error('未知运算 '+node.operation);
  }
  throw Error('公式含不支持节点 '+JSON.stringify(node));
}
const expressionNodeTypes=new Set(['PARAMETER','ATTRIBUTE','OPERATION']);
function assertExpression(node,pathName,skill){
  const supported=!!node&&typeof node==='object'&&expressionNodeTypes.has(node.nodeType);
  check('公式表达式节点类型 '+pathName,supported,node);
  if(!supported)return;
  if(node.nodeType==='PARAMETER')check('公式表达式参数键 '+pathName,typeof node.parameterKey==='string'&&skill.write.parameters.some(p=>p.parameterKey===node.parameterKey),node);
  if(node.nodeType==='ATTRIBUTE')check('公式表达式属性字段 '+pathName,[node.attributeOwner,node.attributeKey,node.attributeValueKind].every(v=>typeof v==='string'&&v.length>0),node);
  if(node.nodeType==='OPERATION'){
    check('公式表达式二元运算 '+pathName,Array.isArray(node.operands)&&node.operands.length===2,node);
    if(Array.isArray(node.operands))node.operands.forEach((child,i)=>assertExpression(child,pathName+'.operands['+i+']',skill));
  }
}
function formulaValue(skillKey,formulaKey,rank,level,runtimeOverrides={}){
  const skill=rawPlan.skills[skillKey],formula=skill?.write.formulas.find(v=>v.formulaKey===formulaKey);
  if(!skill||!formula)throw Error('缺公式 '+skillKey+'/'+formulaKey);
  return clean(evaluate(formula.expression,skill,{rank,level,runtime:runtimeFor(skill,runtimeOverrides)}));
}

// 1. 重新读取固定来源，核对压缩原文、解压原文、官方原文哈希与根绑定。
for(const h of evidence.heroes){
  const clientCompressed=await readFile(path.join(rootBase,h.client.path));
  const clientRaw=gunzipSync(clientCompressed);
  const officialRaw=await readFile(path.resolve(rootBase,h.official.path));
  check('客户端解压原文哈希 '+h.id,sha256(clientRaw)===h.client.sha256,{expected:h.client.sha256,actual:sha256(clientRaw)});
  check('客户端压缩哈希 '+h.id,sha256(clientCompressed)===h.client.compressedSha256,{expected:h.client.compressedSha256,actual:sha256(clientCompressed)});
  check('官方原文哈希 '+h.id,sha256(officialRaw)===h.official.sha256,{expected:h.official.sha256,actual:sha256(officialRaw)});
  const obj=JSON.parse(clientRaw);
  check('角色根存在 '+h.id,!!obj[h.rootPath],h.rootPath);
  for(const s of h.spells)check('技能根绑定存在 '+s.skillKey,!!obj[s.binding]?.mSpell,s.binding);
}
const textEvidence=JSON.parse(await readFile(new URL('./补充文本证据.json',here),'utf8'));
const textRaw=gunzipSync(await readFile(textEvidence.path));
check('补充文本原文哈希',sha256(textRaw)===textEvidence.sha256,{expected:textEvidence.sha256,actual:sha256(textRaw)});
const textJson=JSON.parse(textRaw),textEntries=textJson.entries??textJson;
for(const [key,value] of Object.entries(textEvidence.entries??{}))check('补充文本内容 '+key,textEntries[key]===value,{expected:value,actual:textEntries[key]});

// 2. 槽位顺序、只读边界、现值保护和表达式节点约束。
check('技能槽精确20个',Object.keys(plan.skills).length===20&&isDeepStrictEqual(Object.keys(plan.skills),keys),Object.keys(plan.skills));
check('原始候选覆盖20个',Object.keys(rawPlan.skills).length===20&&keys.every(key=>rawPlan.skills[key]),Object.keys(rawPlan.skills));
check('候选声明不写业务API',plan.meta.apiWrites===0,plan.meta.apiWrites);
check('当前组成读取成功',current.summary?.skillCount===20&&current.summary?.errorCount===0&&current.statusCounts?.['200']===354,current.summary);
check('当前组成无重复',current.summary?.duplicateCount===0,current.summary);
check('写前快照哈希一致',current.snapshotSha256===sha256(await readFile(new URL('./写前现值.json',here))),{report:current.snapshotSha256,actual:sha256(await readFile(new URL('./写前现值.json',here)))});
check('无完整旧批次克隆',plan.meta.reuseReport?.existingCompleteHeroes?.length===0,plan.meta.reuseReport?.existingCompleteHeroes);
check('四名英雄当前均为结构完整但语义部分',plan.meta.reuseReport?.existingPartialHeroes?.length===4&&plan.meta.reuseReport.existingPartialHeroes.every(v=>v.structuralComplete&&!v.semanticCandidateComplete),plan.meta.reuseReport?.existingPartialHeroes);
check('当前组成逐项保护210项',plan.meta.reuseReport?.currentProtectedComponents?.length===210,plan.meta.reuseReport?.currentProtectedComponents?.length);
const reuse=plan.meta.reuseReport??{};
const representedCount=(reuse.currentProtectedComponents??[]).filter(v=>v.represented).length;
check('同值组成存在复用记录',(reuse.sameValueComponents?.length??0)>0,reuse.sameValueComponents?.length);
check('异值组成均有记录',(reuse.differentValueComponents?.length??0)>=0,reuse.differentValueComponents?.length);
check('现值保护分类计数一致',(reuse.sameValueComponents?.length??0)+(reuse.differentValueComponents?.length??0)===representedCount,{same:reuse.sameValueComponents?.length,different:reuse.differentValueComponents?.length,representedCount});
check('保护后候选不含待写组成',keys.reduce((n,key)=>n+Object.values(plan.skills[key].write).reduce((m,a)=>m+a.length,0),0)===0,keys.map(key=>[key,Object.values(plan.skills[key].write).reduce((n,a)=>n+a.length,0)]));
for(const key of keys){
  const skill=rawPlan.skills[key];
  for(const [kind,items] of Object.entries(skill.write)){
    const ids=items.map(v=>v.parameterKey??v.formulaKey??v.effectKey??v.processKey??v.stateKey??v.ruleKey);
    check('稳定键唯一 '+key+'/'+kind,ids.length===new Set(ids).size,ids);
    check('组成对象完整 '+key+'/'+kind,items.every(v=>v&&typeof v==='object'),items.length);
  }
  for(const p of skill.write.parameters){
    if(p.valueMode==='RUNTIME_INPUT')check('未知输入不写固定值 '+key+'/'+p.parameterKey,p.fixedValue===null&&p.levelValues===null,p);
    if(p.valueMode==='CHARACTER_LEVEL')check('角色等级参数18级 '+key+'/'+p.parameterKey,Object.keys(p.levelValues??{}).length===18,p.levelValues);
  }
  for(const f of skill.write.formulas)assertExpression(f.expression,key+'/'+f.formulaKey,skill);
  const unsafe=skill.write.effects.flatMap(e=>e.results??[]).filter(r=>r.resultType==='DAMAGE'||r.resultType==='DIRECT_HEAL');
  check('新候选未生成未证DAMAGE或DIRECT_HEAL '+key,unsafe.length===0,unsafe);
  check('新候选未生成空过程 '+key,skill.write.processes.every(p=>Array.isArray(p.steps)&&p.steps.length>0),skill.write.processes);
  for(const effect of skill.write.effects)for(const result of effect.results??[]){
    if(result.resultType==='RESOURCE_CHANGE'){
      const keyName=result.valueRule?.value?.parameterKey;
      const p=keyName&&skill.write.parameters.find(v=>v.parameterKey===keyName);
      check('资源效果有参数来源 '+key+'/'+effect.effectKey,!!p,p);
      check('资源效果不为全零 '+key+'/'+effect.effectKey,!!p&&!(p.valueMode==='FIXED'&&p.fixedValue===0)&&!(p.valueMode!=='FIXED'&&Object.values(p.levelValues??{}).every(v=>Number(v)===0)),p);
    }
  }
}

// 3. 从冻结根对象重新计算DataValues取值和单位换算，确认候选没有静默改数。
for(const key of keys){
  const source=sourceSpell(key),skill=rawPlan.skills[key],dataValues=source.spell.object.mSpell.DataValues??source.spell.object.mSpell.mDataValues??[];
  for(const proof of skill.proofs.filter(v=>String(v.source??'').startsWith('DataValues.'))){
    const sourceName=String(proof.source).slice('DataValues.'.length);
    const d=dataValues.find(v=>(v.name??v.mName)===sourceName);
    check('来源字段存在 '+key+'/'+sourceName,!!d,d);
    if(!d)continue;
    const rawValues=d.values??d.mValues;
    if(!Array.isArray(rawValues)){check('缺值字段保持缺值 '+key+'/'+sourceName,proof.raw===undefined,proof);continue;}
    const proofRaw=Array.isArray(proof.raw)?proof.raw:proof.raw?.values??proof.raw?.mValues;
    if(proofRaw!==undefined)check('来源原值一致 '+key+'/'+sourceName,isDeepStrictEqual(proofRaw,rawValues),{proof:proofRaw,raw:rawValues});
    const expected=rawValues.slice(proof.offset??1,(proof.offset??1)+skill.maxLevel).map(v=>clean(clean(v)*(proof.scale??1)));
    if(proof.values)check('来源逐级算术一致 '+key+'/'+sourceName,isDeepStrictEqual(proof.values,expected),{proof:proof.values,expected});
    if(proof.parameterKey){
      const p=skill.write.parameters.find(v=>v.parameterKey===proof.parameterKey);
      const actual=p?.valueMode==='FIXED'?[p.fixedValue]:Object.values(p?.levelValues??{}).map(Number);
      check('参数映射一致 '+key+'/'+proof.parameterKey,!!p&&(actual.length===1?expected.every(v=>numEqual(v,actual[0])):actual.length===expected.length&&actual.every((v,i)=>numEqual(v,expected[i]))),{actual,expected});
    }
  }
}

// 4. 多等级独立求值，且抽查各英雄的核心数值关系。
for(const key of keys){
  const skill=rawPlan.skills[key],runs=[];
  for(const rank of [...new Set([1,Math.ceil(skill.maxLevel/2),skill.maxLevel])])for(const level of [1,9,18])for(const formula of skill.write.formulas){
    try{const value=formulaValue(key,formula.formulaKey,rank,level);runs.push({formulaKey:formula.formulaKey,rank,level,value,finite:Number.isFinite(value)});}
    catch(error){runs.push({formulaKey:formula.formulaKey,rank,level,error:String(error),finite:false});}
  }
  const bad=runs.filter(v=>!v.finite||!Number.isFinite(v.value));
  check('公式独立核算有限 '+key,bad.length===0,bad);
  formulaRuns.push({skillKey:key,runs});
}
const examples=[
  ['twitch_p','damage_per_stack_second',1,1,{},4],
  ['twitch_p','damage_per_second',1,1,{poison_stacks:3},12],
  ['twitch_p','max_full_duration_damage',1,1,{poison_stacks:3},144],
  ['twitch_w','slow_ratio',3,3,{},0.46],
  ['twitch_e','physical_damage',1,1,{poison_stacks:3},191],
  ['twitch_e','magic_damage',1,1,{poison_stacks:3},105],
  ['lucian_p','second_shot_damage',1,9,{},165],
  ['lucian_p','vigilance_damage',1,1,{},75],
  ['lucian_q','damage',5,5,{},340],
  ['lucian_w','damage',5,5,{},305],
  ['lucian_r','bullet_damage',1,1,{},105],
  ['lucian_r','continuous_shot_count',1,1,{},37.4],
  ['lucian_r','tooltip_total_damage',1,1,{},3927],
  ['sivir_q','precrit_damage',5,5,{},304],
  ['sivir_q','damage',5,5,{},389.12],
  ['sivir_e','block_heal',5,5,{},290],
  ['tristana_w','damage',5,5,{},380],
  ['tristana_e','unstacked_damage',1,1,{bomb_stacks:2},263.68],
  ['tristana_e','bomb_damage',1,1,{bomb_stacks:2},395.52],
  ['tristana_e','max_damage',1,1,{bomb_stacks:2},527.36],
  ['tristana_r','damage',3,3,{},509]
];
for(const [skillKey,formulaKey,rank,level,overrides,expected] of examples){let actual=null;try{actual=formulaValue(skillKey,formulaKey,rank,level,overrides);}catch(error){actual=String(error);}check('独立算例 '+skillKey+'/'+formulaKey,numEqual(actual,expected),{actual,expected,rank,level,overrides});}

const outputCounts={
  totalDamageResults:keys.reduce((n,key)=>n+rawPlan.skills[key].write.effects.flatMap(e=>e.results??[]).filter(r=>r.resultType==='DAMAGE').length,0),
  totalDirectHealResults:keys.reduce((n,key)=>n+rawPlan.skills[key].write.effects.flatMap(e=>e.results??[]).filter(r=>r.resultType==='DIRECT_HEAL').length,0),
  totalProcesses:keys.reduce((n,key)=>n+rawPlan.skills[key].write.processes.length,0),
  totalManaResults:keys.reduce((n,key)=>n+rawPlan.skills[key].write.effects.flatMap(e=>e.results??[]).filter(r=>r.resultType==='RESOURCE_CHANGE').length,0),
  totalCandidateComponents:keys.reduce((n,key)=>n+Object.values(rawPlan.skills[key].write).reduce((m,a)=>m+a.length,0),0)
};
check('所有新候选DAMAGE结果为0',outputCounts.totalDamageResults===0,outputCounts);
check('所有新候选DIRECT_HEAL结果为0',outputCounts.totalDirectHealResults===0,outputCounts);
check('所有新候选过程均非空',keys.every(key=>rawPlan.skills[key].write.processes.every(p=>p.steps?.length>0)),outputCounts);
check('所有新候选资源效果均有非零成本',outputCounts.totalManaResults>0,outputCounts);
const artifactPath=new URL('../../../../../.agents/artifacts/hero12-20260909/候选生成摘要.json',here);
const artifact=JSON.parse(await readFile(artifactPath,'utf8'));
check('候选原始哈希一致',artifact.rawPlanSha256===sha256(rawPlan),{report:artifact.rawPlanSha256,actual:sha256(rawPlan)});
check('保护后候选哈希一致',artifact.planSha256===sha256(plan),{report:artifact.planSha256,actual:sha256(plan)});
const report={generatedAt:new Date().toISOString(),skillCount:keys.length,apiWrites:0,errors,checks,formulaRuns,outputCounts,currentRead:{status:'success',summary:current.summary,snapshotSha256:current.snapshotSha256},sourceHashes:evidence.heroes.map(h=>({id:h.id,clientSha256:h.client.sha256,clientCompressedSha256:h.client.compressedSha256,officialSha256:h.official.sha256})),candidateHashes:{rawPlanSha256:sha256(rawPlan),planSha256:sha256(plan)},pass:errors.length===0};
await writeFile(new URL('./完整独立核算.json',here),JSON.stringify(report,null,2)+'\n');
await mkdir(new URL('../../../../../.agents/artifacts/hero12-20260909/',here),{recursive:true});
await writeFile(new URL('../../../../../.agents/artifacts/hero12-20260909/独立核算摘要.json',here),JSON.stringify({generatedAt:report.generatedAt,pass:report.pass,skillCount:report.skillCount,apiWrites:0,errorCount:errors.length,checkCount:checks.length,formulaCheckCount:formulaRuns.reduce((n,s)=>n+s.runs.length,0),currentRead:report.currentRead,outputCounts,sourceHashes:report.sourceHashes,candidateHashes:report.candidateHashes},null,2)+'\n');
console.log(JSON.stringify({pass:report.pass,skillCount:keys.length,apiWrites:0,errorCount:errors.length,checkCount:checks.length,formulaCheckCount:formulaRuns.reduce((n,s)=>n+s.runs.length,0),currentRead:report.currentRead.status,outputCounts,candidateHashes:report.candidateHashes}));
