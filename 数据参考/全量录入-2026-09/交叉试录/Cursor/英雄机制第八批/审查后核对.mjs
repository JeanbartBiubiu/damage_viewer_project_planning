// 只读本地冻结来源和候选；仅在本目录写核对报告与体验，不调用接口。
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';

if(process.argv.length>2)throw Error('仅本地审查，无业务写入入口');
const here=new URL('./',import.meta.url);
const read=async name=>JSON.parse(await readFile(new URL(name,here),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const checks=[];
const check=(name,match,detail=null)=>checks.push({name,match,detail});
const historical=await read('历史审查前/初始文件清单.json');
check('初始清单严格29件',historical.initialCount===29&&historical.files.length===29);
const historyChecks=[];
for(const entry of historical.files){
 const actual=digest(await readFile(new URL('历史审查前/'+entry.relativePath.replaceAll('\\','/'),here)));
 historyChecks.push({path:entry.relativePath,expected:entry.sha256,actual,match:actual===entry.sha256&&entry.copySha256===entry.sha256});
}
check('29件历史副本均未修改',historyChecks.every(v=>v.match),historyChecks);
const preserved=['根绑定与数值证据.json','补充文本证据.json','后十来源补充.json','写前现值.json','目录现值.json','来源冻结/来源与哈希汇总.json','来源冻结/主技能数值展开.json'];
for(const name of preserved){
 const old=historical.files.find(e=>e.relativePath.replaceAll('\\','/')===name);
 const actual=digest(await readFile(new URL(name,here)));
 check('原始冻结证据未修改 '+name,!!old&&actual===old.sha256,{expected:old?.sha256,actual});
}

const evidence=await read('根绑定与数值证据.json');
const texts=await read('补充文本证据.json');
const sourceBase='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录';
const rawHeroes={};
const sourceHashes=[];
for(const hero of evidence.heroes){
 const clientBytes=gunzipSync(await readFile(path.join(sourceBase,hero.client.path)));
 const officialBytes=await readFile(path.resolve(sourceBase,hero.official.path));
 const raw=JSON.parse(clientBytes);rawHeroes[hero.id]=raw;
 for(const [kind,bytes,source] of [['client',clientBytes,hero.client],['official',officialBytes,hero.official]]){
  const actual=digest(bytes);const item={hero:hero.id,kind,url:source.sourceUrl??source.url,expected:source.sha256,actual,match:actual===source.sha256};sourceHashes.push(item);check(hero.id+' '+kind+'原文件SHA',item.match,item);
 }
 for(const spell of hero.spells){
  const root=raw[hero.rootPath];
  // 旧摘录的 slot 若缺失，以显式技能稳定键末位定位角色根；不做名称评分。
  const slot=spell.slot??spell.skillKey.split('_').at(-1).toUpperCase();
  const rootBound=slot==='P'?root.mCharacterPassiveSpell:root.spells?.[['Q','W','E','R'].indexOf(slot)];
  check(spell.skillKey+'原始角色根精确绑定',rootBound===spell.binding,{rootPath:hero.rootPath,slot,rootBound,binding:spell.binding});
  check(spell.skillKey+'完整技能对象与原始文件相同',equal(spell.object,raw[spell.binding]),{binding:spell.binding});
 }
}
const textBytes=gunzipSync(await readFile(texts.path));
check('当前中文表原文件SHA',digest(textBytes)===texts.sha256,{expected:texts.sha256,actual:digest(textBytes)});
const cursorAudit=await read('Cursor只读运行审计.json');
const cursorAuditOriginal=await readFile('C:/project/damage_web_dev/.agents/artifacts/hero8-cursor-review-audit.json');
check('Cursor审计副本与主负责人原文件一致',digest(cursorAuditOriginal)===digest(await readFile(new URL('Cursor只读运行审计.json',here))));
const cursorSummary=JSON.parse(await readFile('C:/project/damage_web_dev/.agents/artifacts/hero8-review-20260909/.agents/artifacts/review/summary.json','utf8'));
check('Cursor审查正文精确摘录',String(await readFile(new URL('Cursor独立审查.md',here),'utf8')).trimEnd()===cursorSummary.assistantText.trimEnd());
check('Cursor审查只对应修改前版本',cursorAudit.resultStatus==='finished'&&cursorAudit.planRevision==='HERO8-CANDIDATE-20260909-PRE1'&&cursorAudit.verdict==='REVISE'&&cursorAudit.fileDelta===0&&cursorAudit.unchangedSeeds===29&&cursorAudit.truncatedTools===0,cursorAudit);

const caitRPath=evidence.heroes.find(h=>h.id==='Caitlyn').spells.find(s=>s.skillKey==='caitlyn_r').binding;
const caitWPath=evidence.heroes.find(h=>h.id==='Caitlyn').spells.find(s=>s.skillKey==='caitlyn_w').binding;
const dravenRPath=evidence.heroes.find(h=>h.id==='Draven').spells.find(s=>s.skillKey==='draven_r').binding;
const caitR=rawHeroes.Caitlyn[caitRPath].mSpell;
const rPart=caitR.mSpellCalculations.RTotalDamage.mFormulaParts[1];
const wPart=rawHeroes.Caitlyn[caitWPath].mSpell.mSpellCalculations.HeadShotBonusDamage.mFormulaParts[1];
const dravenR=rawHeroes.Draven[dravenRPath];
const dravenPart=dravenR.mSpell.mSpellCalculations.RCalculatedDamage.mFormulaParts[1];
const labels=[];
function findLabels(node,at){if(!node||typeof node!=='object')return;if(node.nameOverride==='Spell_ListType_BonusADRatio')labels.push({path:at,node});for(const [k,v] of Object.entries(node))if(v&&typeof v==='object')findLabels(v,at+'.'+k);}
findLabels(dravenR,dravenRPath);
check('Caitlyn R额外AD映射有独立具名依据',[rPart,wPart,dravenPart].every(p=>p.mStat===2&&p.mStatFormula===2)&&labels.some(v=>v.node.type===dravenPart.mDataValue),{caitlynR:rPart,caitlynW:wPart,dravenR:dravenPart,bonusLabels:labels});
for(const [hero,key,dataName] of [['Caitlyn','caitlyn_q','tADRatio'],['Jhin','jhin_q','ADRatio']]){
 const binding=evidence.heroes.find(h=>h.id===hero).spells.find(s=>s.skillKey===key).binding;
 const totalLabels=[];
 function collect(node,at){if(!node||typeof node!=='object')return;if(node.nameOverride==='Spell_ListType_TotalADRatio')totalLabels.push({path:at,node});for(const[k,v]of Object.entries(node))if(v&&typeof v==='object')collect(v,at+'.'+k);}
 collect(rawHeroes[hero][binding],binding);
 check(key+'保留总AD读取的同版本具名证据',totalLabels.some(v=>v.node.type===dataName),totalLabels);
}
const base=caitR.DataValues.find(v=>v.name==='RBaseDamage').values[1];
const ratio=caitR.DataValues.find(v=>v.name==='RADRatio').values[1];
check('R1原始参数独立差异算例',base+ratio*100===400&&base+ratio*200===500,{base,ratio,totalAD:200,bonusAD:100,correct:base+ratio*100,wrongTotalAD:base+ratio*200});

const batches=[];
const components=['parameters','formulas','effects','processes','internalStates','triggerRules'];
for(const prefix of ['前十','后十']){
 const file=prefix+'技能候选.json';const bytes=await readFile(new URL(file,here));const candidate=JSON.parse(bytes);
 const old=await read('历史审查前/'+file);const audit=await read(prefix+'技能独立核算.json');
 const count=p=>Object.fromEntries(components.map(k=>[k,Object.values(p.skills).reduce((n,s)=>n+s.write[k].length,0)]));
 const changes=[];
 for(const [skillKey,s] of Object.entries(candidate.skills))for(const component of components){
  const keyOf=v=>v.parameterKey??v.formulaKey??v.effectKey??v.processKey??v.stateKey??v.ruleKey;
  const a=old.skills[skillKey].write[component],b=s.write[component];
  const removed=a.filter(v=>!b.some(w=>keyOf(w)===keyOf(v))).map(keyOf);
  const added=b.filter(v=>!a.some(w=>keyOf(w)===keyOf(v))).map(keyOf);
  const changed=b.filter(v=>{const prev=a.find(w=>keyOf(w)===keyOf(v));return prev&&!equal(prev,v);}).map(keyOf);
  if(removed.length||added.length||changed.length)changes.push({skillKey,component,removed,added,changed});
 }
 const disposition=Object.fromEntries(['范围外','来源待核','系统缺口','尚未接线'].map(k=>[k,Object.values(candidate.skills).reduce((n,s)=>n+s.disposition[k].length,0)]));
 check(prefix+'独算对应最终候选且0失败',audit.candidateSha256===digest(bytes)&&audit.failures.length===0,{candidateSha256:digest(bytes),auditSha256:audit.candidateSha256,failures:audit.failures});
 check(prefix+'无伤害/触发/过程待核资格绕过',Object.values(candidate.skills).every(s=>s.write.effects.every(e=>e.results.every(r=>r.resultType!=='DAMAGE'))&&s.write.triggerRules.length===0&&s.write.processes.length===0));
 batches.push({file,sha256:digest(bytes),before:count(old),after:count(candidate),reusedPublicParameters:audit.reusedPublicParameters,arithmetic:audit.arithmetic.length,invariants:audit.invariants.length,sourceChecks:audit.sourceChecks.length,disposition,changes});
}
const scopeReviews=[
 {skillKey:'caitlyn_q',removed:['secondary_damage_ratio','secondary_damage'],source:texts.skills.caitlyn_q.keys.keyTooltip,dependency:'唯一英雄作为首目标，无其他先前单位；W显形全额条件保留，不能重复给首目标加成。'},
 {skillKey:'jhin_q',removed:['bounce_count','bounce_range','kill_bounce_amp_ratio'],source:texts.skills.jhin_q.keys.keyTooltip,dependency:'只弹到另一未命中目标；仅一名英雄不能反复弹跳，击杀只影响后续目标。不扩展前置小兵弹跳场景。'},
 {skillKey:'jhin_w',removed:['minion_damage_ratio'],source:texts.skills.jhin_w.keys.keyTooltipExtendedBelowLine,dependency:'仅小兵修正；本烬伤害、E陷阱标记与P增速关系继续保留。'},
 {skillKey:'draven_r',removed:['minimum_damage_ratio','damage_reduction_per_hit'],source:texts.skills.draven_r.keys.keyTooltip,resetSource:texts.skills.draven_r.keys.keyTooltipExtendedBelowLine,dependency:'每方向只有唯一英雄，折返时衰减重置；同一英雄去回两次真实命中及伤后P层数处决仍需独立接线。'},
 {skillKey:'draven_p',removed:[],source:texts.skills.draven_p.keys.keyTooltip,dependency:'不模拟额外单位战斗，但非英雄/防御塔与接斧积累的当前崇拜仍影响R。保留战前输入，不默认为0；50%死亡扣层的奇数舍入未证。'}
];
const failures=checks.filter(v=>!v.match);
const report={generatedAt:new Date().toISOString(),boundary:'只核本地冻结来源、历史副本、候选结构和独立算术；无API调用、数据库、浏览器或战斗执行。',executor:'Codex执行代理纠错；原Cursor前十生成未完成，Cursor本轮只读审查已完成PRE1版REVISE，修正后尚待主负责人复核。',historyCount:historical.files.length,cursorReview:cursorAudit,sourceHashes,batches,scopeReviews,checks,failures};
await writeFile(new URL('审查后核对.json',here),JSON.stringify(report,null,2)+'\n');
const [front,back]=batches;
const summary=[
 '# 英雄机制第八批审查后结果','',
 '本批仍为四名英雄的20个技能槽本地候选，未录业务数据。历史审查前保留初始29文件及复制哈希清单，原冻结来源保持原样。原Cursor前十生成未完成，前十/后十候选均由Codex生成，本轮纠错由Codex执行代理接手；本轮Cursor独立审查已真实完成，对应纠错前版本HERO8-CANDIDATE-20260909-PRE1，结论REVISE，不能充作最终通过；本轮逐项修正后待主负责人复核。','',
 '| 批次 | 参数 | 公式 | 效果 | 触发/过程/内部状态 | 公共参数复用 |','| --- | ---: | ---: | ---: | --- | ---: |',
 ...batches.map((b,i)=>`| ${i?'后十':'前十'} | ${b.after.parameters} | ${b.after.formulas} | ${b.after.effects} | 0 / 0 / 0 | ${b.reusedPublicParameters} |`),'',
 '修正凯特琳R总/额外攻击力错配：R1基础300+1×额外攻击力；总AD200、额外AD100时裸伤害400，暴击率25%、额外暴伤40%时442。总AD单独改300仍为400；额外AD改50则为350。独立依据包括原始R/W节点与Draven R具名额外AD显示节点。','',
 '撤前十5个未证法术护盾、暴击及吸血资格的伤害结果及5条actual_hit；绳网和手雷的未解码属性仍为无默认输入，没有空绑定动作。正常候选撤7个范围外参数及1个后续目标公式，逐项依据和保留依赖见审查后核对.json。后十原本未建伤害结果，本轮保持该边界。另按Cursor补充，把凯特琳P、烬W、烬R未证的攻击力口径改为无默认输入，烬W/R参数改名去除总AD断言；凯特琳Q和烬Q的具名TotalADRatio证据保留。','',
 '凯特琳P和烬P的三条旧18级曲线依赖未证缺省字段，已改未绑定比例输入。只验证源中明确的1级值，不再把等级7/13、6/11或10/12后的曲线默认当已知。Draven P死亡扣层奇数取整、Kalista E未解码属性和长矛刷新、Jhin R已损生命连续增幅、Draven W移速衰减均未猜。','',
 '待补问题按来源、系统和未接线分别标记。Draven战前非英雄崇拜对R、Caitlyn P/W/E强化、Jhin自身伤害/E标记/P加速、Kalista Q/E层数及英雄击杀返还依赖都保留。目录快照目前只有眩晕，不据此创造减速或禁锢字典。','',
 `前十SHA256：${front.sha256}`,'',`后十SHA256：${back.sha256}`,'',
 `前十：${front.sourceChecks}项来源哈希、${front.arithmetic}项算例、${front.invariants}项结构约束；后十：${back.sourceChecks} / ${back.arithmetic} / ${back.invariants}。审查后额外${checks.length}项核对，包括29历史副本、冻结证据、20完整原始对象、原始角色根绑定和最终候选对应关系；失败${failures.length}项。`,'',
 '体验：能保存参数或公式不代表伤害资格、供值和因果已完整。旧独算复制了同一曲线推导和AD错误，缺少能区分总/额外AD的输入；本轮用两种AD独立变动、原始文件对象比较及撤出断言弥补。范围外参数应连同依赖一起核对，不能只看经济或多目标关键词。','',
 '以上均为本地证据，不代表管理页面实录成功、数据库已更新或战斗能够执行。'
 ];
await writeFile(new URL('短体验.md',here),summary.join('\n')+'\n');
await writeFile(new URL('审查修正摘要.md',here),summary.join('\n')+'\n');
await writeFile(new URL('Cursor前十技能短体验.md',here),[
 '# 第八批前十实际执行与体验','',
 '原Cursor生成运行未完成，纠错前候选、生成器、报告及原Cursor失败体验说明已保留在历史审查前。当前前十由Codex接手生成并纠错，不将原运行称为完成；Cursor本轮独立审查是真实完成的另一只读运行，结论仅对应PRE1版REVISE，已归档并逐项修正，最终版本待主负责人复核。','',
 `当前候选：${front.after.parameters}参数、${front.after.formulas}公式、${front.after.effects}法力消耗效果、0触发/过程/内部状态，复用12公共参数。SHA256：${front.sha256}。`,'',
 '凯特琳R1在总AD200、额外AD100时裸伤害400，旧值500来自错取总AD；改变总AD且保持额外AD不变已做差异核算。未证伤害资格和未绑定属性供值阻止建立伤害结果，已撤前十5伤害与5实际命中规则。三条缺省曲线仅保留待核输入，不再宣称18级分段已证。凯特琳P、烬W/R也撤掉未证TOTAL读取，保留无默认攻击力输入。','',
 `独算${front.arithmetic}项、结构${front.invariants}项、来源哈希${front.sourceChecks}项，失败0。详见前十技能独立核算.json和审查后核对.json；不含API/浏览器/战斗证据。`
 ].join('\n')+'\n');
console.log(JSON.stringify({checks:checks.length,failures:failures.length,batches:batches.map(({file,sha256,after})=>({file,sha256,after}))}));
if(failures.length)process.exitCode=1;
