import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const here=new URL('.',import.meta.url);
const plan=JSON.parse(await readFile(new URL('./完整候选.json',here),'utf8'));
const evidence=JSON.parse(await readFile(new URL('./根绑定与数值证据.json',here),'utf8'));
const keys=['irelia_p','irelia_q','irelia_w','irelia_e','irelia_r','fiora_p','fiora_q','fiora_w','fiora_e','fiora_r','camille_p','camille_q','camille_w','camille_e','camille_r','gwen_p','gwen_q','gwen_w','gwen_e','gwen_r'];
const clean=n=>Math.round(n*1e6)/1e6;
const sha256=b=>createHash('sha256').update(b).digest('hex');
const numEqual=(a,b)=>typeof a==='number'&&typeof b==='number'?Math.abs(a-b)<1e-5:isDeepStrictEqual(a,b);
const stable=value=>JSON.stringify(value,(k,v)=>['gameId','skillKey','createdAt','updatedAt'].includes(k)?undefined:v);
const errors=[];
const checks=[];
function check(name,ok,detail){checks.push({name,ok,detail});if(!ok)errors.push({name,detail});}
function sourceSpell(skillKey){for(const h of evidence.heroes){const s=h.spells.find(v=>v.skillKey===skillKey);if(s)return {hero:h,spell:s};}throw Error('缺来源 '+skillKey);}
function param(skill,key){const p=skill.write.parameters.find(v=>v.parameterKey===key);if(!p)throw Error('候选缺参数 '+skill.skillKey+'/'+key);return p;}
function pv(skill,key,rank=1,level=1,runtime={}){const p=param(skill,key);if(p.valueMode==='FIXED')return p.fixedValue;if(p.valueMode==='RUNTIME_INPUT'){const v=runtime[key];if(!Number.isFinite(v))throw Error('缺运行时输入 '+skill.skillKey+'/'+key);return v;}const index=p.valueMode==='CHARACTER_LEVEL'?level:rank;const v=p.levelValues?.[String(index)];if(!Number.isFinite(v))throw Error('缺等级值 '+skill.skillKey+'/'+key+'/'+index);return v;}
function valueOf(node,skill,ctx){
  if(!node||typeof node!=='object')throw Error('空表达式节点 '+skill.skillKey);
  if(node.nodeType==='PARAMETER')return pv(skill,node.parameterKey,ctx.rank,ctx.level,ctx.runtime);
  if(node.nodeType==='ATTRIBUTE'){
    const k=`${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`;const v=ctx.attributes[k];if(!Number.isFinite(v))throw Error('缺属性输入 '+skill.skillKey+'/'+k);return v;
  }
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
  throw Error('公式含不支持节点 '+JSON.stringify(node));
}
function runtimeFor(skill){
  const out={};
  for(const p of skill.write.parameters.filter(v=>v.valueMode==='RUNTIME_INPUT')){
    if(p.parameterKey==='on_hit_level_component')out[p.parameterKey]=3;
    else if(p.parameterKey==='shield_stat_value')out[p.parameterKey]=1800;
    else if(p.parameterKey==='current_damage_conversion_ratio')out[p.parameterKey]=.6;
    else if(p.parameterKey==='actual_outer_damage')out[p.parameterKey]=100;
    else if(p.parameterKey==='actual_passive_hero_damage')out[p.parameterKey]=100;
    else if(p.parameterKey==='shield_stat_value')out[p.parameterKey]=1800;
    else if(/ratio|multiplier|percent/i.test(p.parameterKey))out[p.parameterKey]=1;
    else if(/value/i.test(p.parameterKey))out[p.parameterKey]=100;
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
  'SOURCE.mana.TOTAL':1000,
  'TARGET.attack_damage.BONUS':100,
  'TARGET.attack_damage.TOTAL':250,
  'TARGET.ability_power.TOTAL':80,
  'TARGET.hp.TOTAL':1800,
  'TARGET.hp.CURRENT':1200,
  'TARGET.hp.MISSING':600,
  'TARGET.mana.TOTAL':800,
};
const expressionNodeTypes=new Set(['PARAMETER','ATTRIBUTE','OPERATION']);
function checkExpressionNode(node,path){
  const supported=!!node&&typeof node==='object'&&expressionNodeTypes.has(node.nodeType);
  check('公式表达式节点类型 '+path,supported,node);
  if(!supported)return;
  if(node.nodeType==='PARAMETER')check('公式表达式参数键 '+path,typeof node.parameterKey==='string'&&node.parameterKey.length>0,node);
  if(node.nodeType==='ATTRIBUTE')check('公式表达式属性字段 '+path,[node.attributeOwner,node.attributeKey,node.attributeValueKind].every(v=>typeof v==='string'&&v.length>0),node);
  if(node.nodeType==='OPERATION'){
    check('公式表达式二元运算 '+path,Array.isArray(node.operands)&&node.operands.length===2,node);
    if(Array.isArray(node.operands))node.operands.forEach((child,i)=>checkExpressionNode(child,path+'.operands['+i+']'));
  }
}
function requirePath(relative){return `C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录/${relative.replace(/^\.\//,'')}`;}

// 1. 独立重算客户端压缩原文、解压原文和官方原文哈希，并核对扁平根绑定。
for(const h of evidence.heroes){
  const cPath=`C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录/${h.client.path}`;
  const oPath=requirePath(h.official.path);
  const cb=await readFile(cPath), raw=gunzipSync(cb), ob=await readFile(oPath);
  check('客户端解压原文哈希 '+h.id,sha256(raw)===h.client.sha256,{expected:h.client.sha256,actual:sha256(raw)});
  check('客户端压缩哈希 '+h.id,sha256(cb)===h.client.compressedSha256,{expected:h.client.compressedSha256,actual:sha256(cb)});
  check('官方原文哈希 '+h.id,sha256(ob)===h.official.sha256,{expected:h.official.sha256,actual:sha256(ob)});
  const obj=JSON.parse(raw);
  check('角色根存在 '+h.id,!!obj[h.rootPath],h.rootPath);
  for(const s of h.spells)check('技能根绑定存在 '+s.skillKey,!!obj[s.binding]?.mSpell,s.binding);
}

// 2. 技能槽、稳定键、GET复用和不越界输出核对。
check('技能槽精确20个',Object.keys(plan.skills).length===20&&isDeepStrictEqual(Object.keys(plan.skills),keys),Object.keys(plan.skills));
check('候选声明不写业务API',plan.meta.apiWrites===0,plan.meta.apiWrites);
check('当前组成读取成功',plan.meta.currentCompositionRead?.status==='success',plan.meta.currentCompositionRead);
check('当前组成无重复',plan.meta.currentCompositionRead?.summary?.duplicateCount===0,plan.meta.currentCompositionRead?.summary);
check('当前组成无错误',plan.meta.currentCompositionRead?.summary?.errorCount===0,plan.meta.currentCompositionRead?.summary);
check('无完整旧批次克隆',plan.meta.reuseReport?.existingCompleteSkills?.length===0,plan.meta.reuseReport?.existingCompleteSkills);
check('同值参数复用记录29项',plan.meta.reuseReport?.sameValueParameters?.length===29,plan.meta.reuseReport?.sameValueParameters?.length);
check('无异值公共参数',plan.meta.reuseReport?.differentValueParameters?.length===0,plan.meta.reuseReport?.differentValueParameters);
check('无组成键冲突',plan.meta.reuseReport?.collidingComponents?.length===0,plan.meta.reuseReport?.collidingComponents);
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
  const damageResults=s.write.effects.flatMap(e=>e.results??[]).filter(r=>r.resultType==='DAMAGE');
  const healResults=s.write.effects.flatMap(e=>e.results??[]).filter(r=>r.resultType==='DIRECT_HEAL');
  check('新候选未生成未证DAMAGE '+key,damageResults.length===0,damageResults);
  check('新候选未生成未证DIRECT_HEAL '+key,healResults.length===0,healResults);
  check('新候选未生成占位过程 '+key,s.write.processes.length===0,s.write.processes);
  for(const f of s.write.formulas??[])checkExpressionNode(f.expression,`${key}/${f.formulaKey}`);
}
// 3. 独立从原始根对象重算DataValues索引、缩放，并核对排除字段的缺值事实。
for(const key of keys){
  const {spell}=sourceSpell(key),s=plan.skills[key],dataValues=spell.object.mSpell.DataValues??spell.object.mSpell.mDataValues??[];
  for(const proof of s.proofs.filter(v=>/^DataValues\./.test(v.source??''))){
    const source=proof.source.slice('DataValues.'.length);
    const d=dataValues.find(v=>v.name===source||v.mName===source);
    check(`来源字段存在 ${key}/${source}`,!!d,d);
    if(!d)continue;
    const raw=d.values??d.mValues;
    if(proof.raw===undefined){
      check(`缺值字段保持缺值 ${key}/${source}`,raw===undefined,proof);
      check(`缺值字段未写参数 ${key}/${source}`,!s.write.parameters.some(v=>v.parameterKey===proof.parameterKey),proof);
      continue;
    }
    const proofRaw=proof.excluded?(proof.raw?.values??proof.raw?.mValues):proof.raw;
    if(proofRaw===undefined){
      check(`缺值字段保持缺值 ${key}/${source}`,raw===undefined,proof);
      check(`缺值字段未写参数 ${key}/${source}`,!s.write.parameters.some(v=>v.parameterKey===proof.parameterKey),proof);
      continue;
    }
    check(`来源原值一致 ${key}/${source}`,isDeepStrictEqual(proofRaw,raw),{proof:proofRaw,raw});
    if(proof.parameterKey){
      const offset=proof.offset??1, scale=proof.scale??1;
      const expected=raw.slice(offset,offset+s.maxLevel).map(v=>clean(clean(v)*scale));
      check(`来源逐级算术一致 ${key}/${source}`,isDeepStrictEqual(proof.values,expected),{proof:proof.values,expected});
      const p=param(s,proof.parameterKey),actual=p.valueMode==='FIXED'?[p.fixedValue]:Object.values(p.levelValues??{}).map(Number);
      check(`参数映射一致 ${key}/${proof.parameterKey}`,actual.length===1?expected.every(v=>numEqual(v,actual[0])):actual.length===expected.length&&actual.every((v,i)=>numEqual(v,expected[i])),{actual,expected});
    }
  }
}
const camilleShield=plan.skills.camille_p.proofs.find(v=>v.parameterKey==='shield_level_ratio');
check('卡蜜尔P护盾断点19级字段留证',!!camilleShield&&camilleShield.raw?.mBreakpoints?.some(v=>v.mLevel===19&&v.mAdditionalBonusAtThisLevel!=null),camilleShield);
const camilleConversion=plan.skills.camille_q.proofs.find(v=>v.parameterKey===undefined&&String(v.source).includes('DamageConversionPercentage'));
check('卡蜜尔Q17级缺增量不插值',!!camilleConversion&&camilleConversion.raw?.mBreakpoints?.some(v=>v.mLevel===17&&v.mAdditionalBonusAtThisLevel==null&&v.mBonusPerLevelAtAndAfter==null)&&!!plan.skills.camille_q.write.parameters.find(v=>v.parameterKey==='current_damage_conversion_ratio'),camilleConversion);
const missing=plan.skills.camille_r.proofs.find(v=>String(v.source).endsWith('DataValues.ROnHitDamage'));
check('卡蜜尔R缺值不补参数',!!missing&&missing.raw?.values===undefined&&!plan.skills.camille_r.write.parameters.some(v=>v.parameterKey==='on_hit_damage'),missing);
const zoneMissing=plan.skills.gwen_w.proofs.find(v=>String(v.source).endsWith('DataValues.ZONE_VARS'));
check('格温W缺值不补参数',!!zoneMissing&&zoneMissing.raw?.values===undefined&&!plan.skills.gwen_w.write.parameters.some(v=>v.parameterKey==='zone_vars'),zoneMissing);

// 4. 多等级、多角色等级独立重算每个候选公式，禁止非有限值。
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
function findRun(skillKey,formulaKey,rank,level){return formulaRuns.find(v=>v.skillKey===skillKey)?.runs.find(v=>v.formulaKey===formulaKey&&v.rank===rank&&v.level===level)?.value;}
function findParameter(skillKey,parameterKey,rank=1,level=1){const s=plan.skills[skillKey];return pv(s,parameterKey,rank,level,runtimeFor(s));}
check('艾瑞莉娅Q英雄伤害独立算术',numEqual(findRun('irelia_q','champion_damage',3,9),285),findRun('irelia_q','champion_damage',3,9));
check('艾瑞莉娅Q自我治疗独立算术',numEqual(findRun('irelia_q','heal_amount',3,9),33),findRun('irelia_q','heal_amount',3,9));
check('艾瑞莉娅W魔法减伤独立算术',numEqual(findRun('irelia_w','final_magic_reduction_percent',5,18),39),findRun('irelia_w','final_magic_reduction_percent',5,18));
check('艾瑞莉娅E伤害独立算术',numEqual(findRun('irelia_e','total_damage',5,9),330),findRun('irelia_e','total_damage',5,9));
check('艾瑞莉娅R刃墙伤害独立算术',numEqual(findRun('irelia_r','zone_damage',3,9),375),findRun('irelia_r','zone_damage',3,9));
check('菲奥娜P破绽伤害独立算术',numEqual(findRun('fiora_p','passive_vital_true_damage',1,1),140.4),findRun('fiora_p','passive_vital_true_damage',1,1));
check('菲奥娜P大招四破绽独立算术',numEqual(findRun('fiora_p','r_vital_true_damage',1,1),561.6),findRun('fiora_p','r_vital_true_damage',1,1));
check('菲奥娜Q伤害独立算术',numEqual(findRun('fiora_q','total_damage',5,9),242),findRun('fiora_q','total_damage',5,9));
check('菲奥娜W刺击独立算术',numEqual(findRun('fiora_w','stab_damage',3,9),290),findRun('fiora_w','stab_damage',3,9));
check('菲奥娜E第二次攻击独立算术',numEqual(findRun('fiora_e','second_attack_damage',5,9),600),findRun('fiora_e','second_attack_damage',5,9));
check('卡蜜尔P冷却断点独立算术',numEqual(findParameter('camille_p','passive_cooldown_seconds',1,7),11),findParameter('camille_p','passive_cooldown_seconds',1,7));
check('卡蜜尔P护盾比例运行输入独立算术',numEqual(findRun('camille_p','shield_amount',1,18),360),findRun('camille_p','shield_amount',1,18));
check('卡蜜尔Q第二段独立算术',numEqual(findRun('camille_q','empowered_bonus_damage',5,9),240),findRun('camille_q','empowered_bonus_damage',5,9));
check('卡蜜尔W外沿独立算术',numEqual(findRun('camille_w','outer_damage',5,9),216),findRun('camille_w','outer_damage',5,9));
check('卡蜜尔R当前生命附伤独立算术',numEqual(findRun('camille_r','on_hit_magic_damage',3,9),96),findRun('camille_r','on_hit_magic_damage',3,9));
check('格温P最大生命伤害独立算术',numEqual(findRun('gwen_p','passive_magic_damage',1,9),28.8),findRun('gwen_p','passive_magic_damage',1,9));
check('格温Q最大剪切独立算术',numEqual(findRun('gwen_q','max_damage',5,9),350),findRun('gwen_q','max_damage',5,9));
check('格温W双抗独立算术',numEqual(findRun('gwen_w','total_resists',5,9),37),findRun('gwen_w','total_resists',5,9));
check('格温E附加伤害独立算术',numEqual(findRun('gwen_e','on_hit_damage',5,9),35),findRun('gwen_e','on_hit_damage',5,9));
check('格温R三段独立算术',numEqual(findRun('gwen_r','total_damage_3',3,9),240)&&numEqual(findRun('gwen_r','total_damage_5',3,9),400)&&numEqual(findRun('gwen_r','max_damage',3,9),720),{one:findRun('gwen_r','total_damage',3,9),three:findRun('gwen_r','total_damage_3',3,9),five:findRun('gwen_r','total_damage_5',3,9),max:findRun('gwen_r','max_damage',3,9)});

// 5. 输出边界与当前GET状态再次写入独立审计。
const outputCounts={
  totalDamageResults:keys.reduce((n,k)=>n+plan.skills[k].write.effects.flatMap(e=>e.results??[]).filter(r=>r.resultType==='DAMAGE').length,0),
  totalDirectHealResults:keys.reduce((n,k)=>n+plan.skills[k].write.effects.flatMap(e=>e.results??[]).filter(r=>r.resultType==='DIRECT_HEAL').length,0),
  totalProcesses:keys.reduce((n,k)=>n+plan.skills[k].write.processes.length,0),
  totalManaResults:keys.reduce((n,k)=>n+plan.skills[k].write.effects.flatMap(e=>e.results??[]).filter(r=>r.resultType==='RESOURCE_CHANGE').length,0),
};
check('所有新英雄DAMAGE结果为0',outputCounts.totalDamageResults===0,outputCounts);
check('所有新英雄DIRECT_HEAL结果为0',outputCounts.totalDirectHealResults===0,outputCounts);
check('所有新英雄过程为0',outputCounts.totalProcesses===0,outputCounts);
check('法力效果只保留非零资源消耗',outputCounts.totalManaResults===16,outputCounts);
const currentReport=JSON.parse(await readFile(new URL('./当前20技能组成核对.json',here)));
check('审计引用8080成功GET',currentReport.summary?.errorCount===0&&currentReport.statusCounts?.['200']===173,currentReport.summary);
const report={generatedAt:new Date().toISOString(),skillCount:keys.length,apiWrites:0,errors,checks,formulaRuns,outputCounts,currentRead:{status:'success',summary:currentReport.summary,snapshotSha256:currentReport.snapshotSha256},sourceHashes:evidence.heroes.map(h=>({id:h.id,clientSha256:h.client.sha256,clientCompressedSha256:h.client.compressedSha256,officialSha256:h.official.sha256})),pass:errors.length===0};
await writeFile(new URL('./完整独立核算.json',here),JSON.stringify(report,null,2)+'\n');
await mkdir(new URL('../../../../../.agents/artifacts/hero11-20260909/',here),{recursive:true});
await writeFile(new URL('../../../../../.agents/artifacts/hero11-20260909/独立核算摘要.json',here),JSON.stringify({generatedAt:report.generatedAt,pass:report.pass,skillCount:report.skillCount,apiWrites:0,errorCount:errors.length,checkCount:checks.length,currentRead:report.currentRead,outputCounts:report.outputCounts,sourceHashes:report.sourceHashes,formulaCheckCount:formulaRuns.reduce((n,s)=>n+s.runs.length,0)},null,2)+'\n');
console.log(JSON.stringify({pass:report.pass,skillCount:keys.length,apiWrites:0,errorCount:errors.length,checkCount:checks.length,formulaCheckCount:formulaRuns.reduce((n,s)=>n+s.runs.length,0),currentRead:report.currentRead.status}));
