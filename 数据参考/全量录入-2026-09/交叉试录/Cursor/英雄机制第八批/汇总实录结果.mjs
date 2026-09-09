import {readFile,writeFile,readdir} from 'node:fs/promises';
import {loadPlan,approvedParts,approvedCorrection,here} from './录入工具.mjs';
if(process.argv.length!==2)throw Error('只汇总本地结果，不调用接口');
const read=async name=>JSON.parse(await readFile(new URL(name,here),'utf8'));
const loaded=await loadPlan(),independent=await read('独立全量回读.json'),latest=await read('写入结果.json'),equivalence=await read('接口纠错独立核算.json');
if(!independent.success||independent.planSha256!==loaded.planSha256||latest.planSha256!==loaded.planSha256||latest.errors.length||equivalence.failures.length)throw Error('最终独立回读或最新写入尚未全部通过');
const events=(await readFile(new URL('写入流水.jsonl',here),'utf8')).trim().split(/\r?\n/).map(JSON.parse);
const confirmed=events.filter(e=>e.postStatus>=200&&e.postStatus<300&&e.match),id=e=>[e.skillKey,e.kind,e.id].join('/');
if(new Set(confirmed.map(id)).size!==confirmed.length)throw Error('同项多次创建，需人工核对流水');
const snapshot=independent.snapshot,verification=independent.verification;
const rejected=events.filter(e=>e.postStatus>=400).map(e=>({runId:e.runId,skillKey:e.skillKey,kind:e.kind,id:e.id,postStatus:e.postStatus,readbackStatus:e.readbackStatus,reason:e.postResponse?.error?.code,resolved:snapshot.readbacks.some(r=>id(r)===id(e)&&r.match)}));
const reused=Object.values(loaded.plan.skills).flatMap(s=>s.reusedParameters.map(parameterKey=>({skillKey:s.skillKey,parameterKey,match:snapshot.readbacks.some(r=>r.skillKey===s.skillKey&&r.kind==='parameters'&&r.id===parameterKey&&r.match)})));
if(reused.length!==23||reused.some(p=>!p.match)||confirmed.length!==128||rejected.some(r=>!r.resolved))throw Error('新增、原参数复用或拒绝闭环不完整');
const byHero=['caitlyn','jhin','draven','kalista'].map(hero=>({hero,components:snapshot.readbacks.filter(r=>r.skillKey.startsWith(hero+'_')).length,newConfirmed:confirmed.filter(r=>r.skillKey.startsWith(hero+'_')).length,reused:reused.filter(r=>r.skillKey.startsWith(hero+'_')).length}));
const runSummaries=[];
for(const entry of await readdir(new URL('执行记录/',here),{withFileTypes:true})){if(!entry.isDirectory())continue;const record=await read('执行记录/'+entry.name+'/执行结果.json');runSummaries.push({runId:record.runId,mode:record.mode,planSha256:record.planSha256,newConfirmed:record.events.filter(e=>e.postStatus>=200&&e.postStatus<300&&e.match).length,missing:record.final?.missing.length??record.preflight?.missing.length??null,conflicts:record.final?.conflicts.length??record.preflight?.conflicts.length??null,errors:record.errors});}
const report={at:new Date().toISOString(),success:true,finalRequestSha256:loaded.planSha256,approvedParts,approvedCorrection,totals:snapshot.totals,newConfirmed:confirmed.length,reusedPublicParameters:reused.length,byHero,independentReadback:{runId:independent.runId,subjects:snapshot.subjects.length,collections:snapshot.lists.length,details:snapshot.readbacks.length,fields:verification.fields,arithmetic:verification.arithmetic.length,invariants:verification.invariants.length,sourceChecks:independent.sources.length,missing:snapshot.missing.length,conflicts:snapshot.conflicts.length,failures:verification.failures.length},protected:{subjects:snapshot.subjects.length,representativeImages:snapshot.images.length,characterSkillRelations:snapshot.relations.length,publicParameters:reused},historicalRejected:rejected,equivalence:{originalCases:equivalence.originalCases.length,variationCases:equivalence.variationCases.length,failures:equivalence.failures.length},journalLines:events.length,runs:runSummaries,boundary:'已通过真实管理API写入和独立GET全字段/实际公式核算；没有浏览器验收或战斗执行。本执行代理未改应用代码、服务、其他批次、共享进度或Git，主负责人后续页面验收和提交。'};
await writeFile(new URL('最终请求.json',here),loaded.bytes);
await writeFile(new URL('最终请求版本.json',here),JSON.stringify({file:'最终请求.json',sha256:loaded.planSha256,approvedParts,approvedCorrection},null,2)+'\n');
await writeFile(new URL('最终结果.json',here),JSON.stringify(report,null,2)+'\n');
const lines=['# 英雄机制第八批','',
 `已通过管理API保存完整确定集合 **${snapshot.readbacks.length}项**：新增 **${confirmed.length}项**，精确复用 **${reused.length}项**公共参数。独立重新GET ${snapshot.subjects.length}个主体、${snapshot.lists.length}个组成列表、${snapshot.readbacks.length}个组成详情，最终缺项、异值均为0。`,'',
 `组成：${snapshot.totals.parameters}参数、${snapshot.totals.formulas}公式、${snapshot.totals.effects}效果，0过程、0内部状态、0触发规则；没有伤害结果。逐字段核对${verification.fields}个业务叶字段，采用实际保存表达式的${verification.arithmetic.length}个算例和${verification.invariants.length}项约束全部通过。20主体、20代表图和4英雄关系列表与写前一致。`,'',
 '| 英雄 | 组成 | 新增 | 原参数复用 |','| --- | ---: | ---: | ---: |',...byHero.map(h=>`| ${h.hero} | ${h.components} | ${h.newConfirmed} | ${h.reused} |`),'',
 '首次写入有2条公式因表达式误用了普通数值引用而被明确拒绝，均POST400后GET404；该技能后续两项成本效果随即暂停，其余124项正常保存。主负责人授权等价展开后，原46算例及36个AD/暴击/目标生命变化算例均相同；只补齐剩余4项，没有重放原请求或覆盖已成功对象。全部原失败报告保存在按运行编号分开的执行记录中。','',
 `最终请求SHA256：${loaded.planSha256}`,'',
 `两项接口修正SHA256：${approvedCorrection.sha256}`,'',
 '两个原始分批候选及SHA保持原样。最终请求以“两个冻结集合 + 接口拒绝修正候选.json”合成为准，精确内容见最终请求.json；不要仅用旧前十候选中的普通数值引用节点执行。原始16.17客户端与16.17.1官方来源界限未改变。','',
 '- [最终统计](./最终结果.json)、[最终请求及版本](./最终请求版本.json)。',
 '- [独立全量回读](./独立全量回读.json)：再次GET与实际表达式核算。',
 '- [写入结果](./写入结果.json)：最新补缺；历史各次运行在执行记录目录中。',
 '- [接口纠错等价核算](./接口纠错独立核算.json)、[实录体验](./实录短体验.md)。',
 '- [审查前历史](./历史审查前/初始文件清单.json)、[Cursor逐项修正](./Cursor对应纠错清单.md)。','',
 '录入.mjs默认只读，显式--apply仍逐项校验两冻结SHA与仅两公式修正SHA。创建前持久记账，创建后GET确认；现值不同停止该技能，未知响应先查询且不自动重放。脚本不提供覆盖或删除。鉴权只从HERO8_API_TOKEN进程环境读取，不写入文件。全量独立回读.mjs只允许GET。','',
 '资料不足仍分为来源待核、系统缺口和未接线：未知AD/等级输入不默认零，未知伤害资格不写空规则，死亡扣层不猜取整。管理保存与数学核对不代表这些状态/时序已连接或战斗可执行。浏览器验收和提交由主负责人继续。'];
await writeFile(new URL('README.md',here),lines.join('\n')+'\n');
const experience=[
 '# 第八批真实接口录入体验','',
 `本批新增128、复用23，最终151组成逐字段一致；实际公式46算例全部通过。首次2个400拒绝已保留并闭环，未掩成全程无拒绝。`,'',
 '最直接的问题是“普通数值引用”和“公式表达式节点”看起来相似，但属于不同契约。效果数值可使用kind:FORMULA引用；公式运算的操作数必须是合法nodeType节点，不能直接塞同一个对象。本批只内联原子公式，不新增FORMULA表达式类型。入口增加了表达式节点检查，独立回读采用最终合成请求比较。','',
 '旧数学核算能识别普通公式引用，因此算例通过仍无法发现请求格式错误。必须同时核对真实API结构。遇到400先GET确认未创建；暂停当前技能依赖，保留其他已成功对象。确定性格式修正后重新完整只读预检，只补仍缺的4项。','',
 '只保留确定公式/消耗能帮助持续录入，但不应把“已保存”当“战斗已完成”。凯特琳R额外AD已正确保存；凯特琳P、烬W/R及等级曲线的未知输入仍无默认。Jhin R最大端点并未被当作任意目标生命下的实际倍率。Draven崇拜、Kalista长矛/击杀返还及跨技能状态仍等待有证据的接线。','',
 `最终独立回读编号：${independent.runId}。本轮未进行浏览器或Wasm运行，页面验收交主负责人。`
 ].join('\n')+'\n';
await writeFile(new URL('实录短体验.md',here),experience);
await writeFile(new URL('短体验.md',here),experience);
console.log(JSON.stringify({success:true,newConfirmed:128,reused:23,totals:snapshot.totals,readback:report.independentReadback,byHero,historicalRejected:rejected.length,finalRequestSha256:loaded.planSha256}));
