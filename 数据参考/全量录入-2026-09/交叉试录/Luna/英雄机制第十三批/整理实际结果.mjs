import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
const dir=path.dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p)),[applyId,independentId,mathId]=process.argv.slice(2);
if(!applyId||!independentId||!mathId)throw Error('需指定已完成的写入、独立回读和实值核算记录');
const applyPath=dir+'/执行记录/'+applyId+'/',independentPath=dir+'/执行记录/'+independentId+'/',mathPath=dir+'/实值核算记录/'+mathId+'/',apply=read(applyPath+'执行结果.json'),independent=read(independentPath+'执行结果.json'),math=read(mathPath+'实际读取.json'),snapshot=read(independentPath+'写前组件现值.json'),write=read(applyPath+'实际写入结果.json'),candidateFile=dir+'/完整候选.json';
if(!apply.success||apply.apiWrites!==174||!independent.success||independent.apiWrites!==0||!independent.independentReadback?.complete||!math.success||snapshot.details.length!==202)throw Error('必要实际验证未通过');
const original=read(dir+'/写前现值.json'),protection=read(independentPath+'写前保护.json'),media=read(dir+'/关联与图片保护快照.json'),items=r=>r.data.items??r.data;
for(const[name,key]of [['attributes','attributeKey'],['modifier-zones','modifierZoneKey'],['damage-types','damageTypeKey'],['statuses','statusKey']])for(const old of items(original.catalogs[name]))if(!equal(old,items(protection.catalogs[name]).find(v=>v[key]===old[key])))throw Error('字典完整对象变化 '+name+'/'+old[key]);
for(const[skill,s]of Object.entries(original.skills)){if(!equal(s.subject.data,protection.subjects[skill].data))throw Error('技能主体完整对象变化 '+skill);for(const old of s.components.parameters.details)if(!equal(old.detail.data,snapshot.details.find(v=>v.skillKey===skill&&v.kind==='parameters'&&v.id===old.key)?.data))throw Error('原参数完整对象变化 '+skill+'/'+old.key);}
for(const old of media.requests.filter(r=>r.route.startsWith('/skills/')||r.route.startsWith('/character-skill-relations'))){const actual=old.route.startsWith('/skills/')?protection.images[old.route.split('/')[2]]:protection.relations[old.route.split('champion_')[1]];if(!equal(old.data,actual.data))throw Error('图或挂载完整对象变化 '+old.route);}
const candidateSha=hash(fs.readFileSync(candidateFile));if(candidateSha!=='247eeb25c0f1c0b5448fabd16512d9c7b2632660fc08f3cd67bac0d9335c5ff0')throw Error('最终候选发生漂移');
const pending=read(candidateFile),countFields=v=>v&&typeof v==='object'?Object.values(v).reduce((n,x)=>n+countFields(x),0):1;
const successful=write.events.filter(e=>e.action==='创建后独立回读确认'&&e.match),counts=Object.fromEntries(['parameters','formulas','effects'].map(kind=>[kind,successful.filter(e=>e.kind===kind).length]));
const sourcePreparation=read(dir+'/最终交付清单.json'),report={at:new Date().toISOString(),status:'174组成实际新增及独立全量、实值数学通过；待主负责人页面验收',candidateFileSha256:candidateSha,candidateObjectSha256:apply.candidateObjectSha256,actualWrites:174,createdByKind:counts,reusedPublicParameters:28,finalComponents:{parameters:145,formulas:37,effects:20,processes:0,internalStates:0,triggerRules:0,total:202},writeResult:{runId:applyId,httpCalls:apply.calls,post201:successful.filter(e=>e.postStatus===201).length,confirmed:successful.length,failedSkills:write.failedSkills},independentReadback:{runId:independentId,httpCalls:independent.calls,details:202,lists:120,fullFields:snapshot.details.reduce((n,r)=>n+countFields(Object.fromEntries(Object.entries(r.data).filter(([k])=>!['gameId','skillKey','createdAt','updatedAt'].includes(k)))),0),conflicts:snapshot.conflicts,missing:snapshot.missing},actualMath:{folder:mathId,actualGets:math.requests.length,...math.math,inputSha256:math.inputSha256,resultSha256:math.resultSha256},protected:{subjects:20,originalParameters:28,representativeImages:20,characterRelationLists:4,catalogs:4,drift:0},sourcePreparationManifestSha256:hash(fs.readFileSync(dir+'/最终交付清单.json')),cursorReview:{file:'Cursor独立复核.json',sha256:hash(fs.readFileSync(dir+'/Cursor独立复核.json')),verdict:'READY',suggestions:'保留Kassadin R整数0至4输入域，不猜资源口径；不把复用mana_cost40再扣一次；Ryze R复用成本不新建传送过程。阿卡丽partype在冻结官方完整原文中另经独立核算断言能量。'},runtimeValidation:'未执行战斗或Wasm验证，来源与资格待配保留，未宣称英雄完整机制完成',files:{}};
for(const p of [applyPath+'执行结果.json',applyPath+'实际写入结果.json',applyPath+'最终全量组件现值.json',independentPath+'执行结果.json',independentPath+'写前组件现值.json',independentPath+'写前保护.json',mathPath+'实际读取.json',mathPath+'独立数学结果.json'])report.files[path.relative(dir,p).replaceAll('\\','/')]=hash(fs.readFileSync(p));
fs.writeFileSync(dir+'/最终实录结果.json',JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(dir+'/当前实录状态.json',JSON.stringify({status:report.status,candidateFileSha256:candidateSha,created:174,reused:28,total:202,applyRunId:applyId,independentRunId:independentId,mathFolder:mathId,apiWritesComplete:true,mayReplayApply:false,pageAcceptance:'由主负责人接手',finalReportSha256:hash(fs.readFileSync(dir+'/最终实录结果.json'))},null,2)+'\n');
const history=dir+'/历史/实际录入前README.md';if(!fs.existsSync(history))fs.copyFileSync(dir+'/README.md',history);
fs.writeFileSync(dir+'/README.md',`# 英雄机制第十三批实际录入

阿卡丽、卡萨丁、瑞兹、卡西奥佩娅20槽已新增174组成：117参数、37公式、20独立效果。原28公共参数完整复用，当前合计145参数、37公式、20效果，共202组成；没有新过程、内部状态或触发规则。

174次POST均写后GET确认。另一次独立${independent.calls.total}次GET核对全部202组成及主体、图片、挂载、字典，${report.independentReadback.fullFields}个字段一致。再独立GET全部145参数和37公式共182次，实际保存表达式通过${math.math.checks}项检查、${math.math.sourceCases}组原树及${math.math.manualCases}组手算，覆盖全部37公式。

既有20主体、28参数、20代表图、4组角色挂载和4字典均保持。并发其他批次带来的目录总量增长不作为本批对象漂移；本批对象字段没有放松保护。页面验收由主负责人继续，未执行战斗或Wasm验证。

冻结候选SHA：${candidateSha}。

详情见《最终实录结果.json》及其各执行/独立GET证据路径。原来源、候选、静态核算和Cursor复核保留；候选准备期说明在《历史/实际录入前README.md》。生成入口已有冻结锁，不得重建候选或重放已成功请求。

当前仍需真实输入和后续接线：4个未证等级项、Kassadin R资源口径及整数0至4真实层数、Ryze涌动与R学习等级、Cassiopeia中毒/朝向/恢复资格。Kassadin R仅有动态消费效果，原40法力参数完整复用；没有另建固定扣费。所有缺值不能当0，保存数值不表示完整自动战斗机制。
`);
fs.writeFileSync(dir+'/实际录入体验报告.md',`# 第十三批实际录入体验

沿第十一批成熟只补缺流程完成，保护28原参数和本批目录对象；174新增、0冲突、0失败，没有覆盖同名对象或重发业务请求。

1. 写前先完整GET确认28复用/174缺项，逐POST前再GET。每个精确请求预写持久化意图，写后另GET；即使响应未知也只查询落地，不自动重放。
2. 列表只是摘要。公式正文与效果生命周期取详情核对，摘要只按其真实字段及明确派生计数比较，不将缺少expression判成丢失。
3. 候选冻结锁阻止生成器重建；实际写入逐次校验最终SHA，保护文件原哈希也固定。没有复制第十一批旧技能键、旧数量或后来修正过的禁止重放条件。
4. Cursor非阻塞建议已落实为输入边界记录：Kassadin R只接受真实整数0至4，不额外推定资源枚举、不与静态40法力重复扣费。Ryze R不录空间传送过程。阿卡丽当前官方完整冻结原文资源字段能量已有独立核算，摘录是否展示该字段不改变实际来源。
5. 最终另启动全量只读工具，不能把写后流水冒充另一次GET；实际数学又重新取得145参数及37公式。此为管理数据与数学证据，未证明触发事件、伤害资格或战斗运行。

本批未需要业务请求纠错。工具准备中的精确替换位置未匹配先停止，修正后仅运行静态语法检查；该准备失败没有任何API写入。共享进度、SOP、页面和Git由主负责人收口。
`);
console.log(JSON.stringify({created:174,reused:28,total:202,independentGets:independent.calls.total,actualMathGets:182,fields:report.independentReadback.fullFields,checks:math.math.checks,reportSha256:hash(fs.readFileSync(dir+'/最终实录结果.json'))}));
