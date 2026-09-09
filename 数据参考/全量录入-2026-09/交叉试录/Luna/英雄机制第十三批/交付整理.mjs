import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const here=new URL('./',import.meta.url),read=async f=>JSON.parse(await readFile(new URL(f,here),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex'),fileHash=async name=>hash(await readFile(new URL(name,here)));
const [plan,version,before,protection,math]=await Promise.all(['完整候选.json','候选版本.json','写前现值.json','关联与图片保护快照.json','独立源值与算例.json'].map(read));
if(math.failures.length||version.fileSha256!==await fileHash('完整候选.json'))throw Error('最终候选与核对不一致');
const protectedChecks=[];
for(const hero of ['akali','kassadin','ryze','cassiopeia']){
 const character=protection.requests.find(r=>r.route==='/characters/champion_'+hero);
 if(character?.status!==200||character.data.characterKey!=='champion_'+hero)throw Error('目录主体不对应 '+hero);
 const relation=protection.requests.find(r=>r.route==='/character-skill-relations?characterKey=champion_'+hero);
 const expected=['p','q','w','e','r'].map(s=>hero+'_'+s);
 if(relation?.status!==200||relation.data.total!==5||JSON.stringify(relation.data.items.map(r=>r.skillKey))!==JSON.stringify(expected)||relation.data.items.some(r=>r.characterKey!=='champion_'+hero||r.gameId!=='lol'||r.skillStatus!=='ENABLED'))throw Error('角色关联不对应 '+hero);
 protectedChecks.push({hero,characterSha256:hash(JSON.stringify(character.data)),relationsSha256:hash(JSON.stringify(relation.data)),skillKeys:expected});
}
for(const skillKey of Object.keys(plan.skills)){
 const image=protection.requests.find(r=>r.route==='/skills/'+skillKey+'/representative-image');
 if(image?.status!==200||!image.data.image?.enabled||image.data.image.name!==skillKey||image.data.image.imageKey!=='entry_16171_'+skillKey)throw Error('技能图不对应 '+skillKey);
 protectedChecks.push({skillKey,representativeImage:image.data,imageRelationSha256:hash(JSON.stringify(image.data))});
}
const rows=[],reuse=[];
for(const s of Object.values(plan.skills))for(const [kind,items]of Object.entries(s.write)){
 const config=before.kinds.find(k=>k.name===kind);
 for(const body of items){const key=body[config.id],existing=before.skills[s.skillKey].components[kind].details.find(v=>v.key===key);const row={skillKey:s.skillKey,kind,key,route:'/skills/'+s.skillKey+'/'+config.api,detailRoute:'/skills/'+s.skillKey+'/'+config.api+'/'+key,body};if(existing)reuse.push({...row,method:'GET',decision:'完整同值复用，不更新'});else rows.push({...row,method:'POST',decision:'仅静态候选，实际执行前必须GET查现值'});}
}
if(rows.length!==174||reuse.length!==28)throw Error('请求数量不符');
const requestPlan={at:new Date().toISOString(),candidateSha256:version.fileSha256,planSha256:version.planSha256,mode:'仅静态写前计划；本脚本不调用网络，不执行POST',apiWrites:0,policy:'逐项实际GET；缺项才可新增，同值复用，异值停该项；保护原主体/参数/目录/图片/关系；未知结果先读现值，不重放。',newCounts:{parameters:rows.filter(r=>r.kind==='parameters').length,formulas:rows.filter(r=>r.kind==='formulas').length,effects:rows.filter(r=>r.kind==='effects').length},newRequests:rows,reusedComponents:reuse,protectedChecks};
await writeFile(new URL('写前计划.json',here),JSON.stringify(requestPlan,null,2)+'\n');
const perHero=['akali','kassadin','ryze','cassiopeia'].map((key,i)=>{const skills=Object.values(plan.skills).filter(s=>s.skillKey.startsWith(key+'_'));return {hero:['阿卡丽','卡萨丁','瑞兹','卡西奥佩娅'][i],skillCount:skills.length,parameters:skills.reduce((n,s)=>n+s.write.parameters.length,0),formulas:skills.reduce((n,s)=>n+s.write.formulas.length,0),effects:skills.reduce((n,s)=>n+s.write.effects.length,0),reuse:reuse.filter(r=>r.skillKey.startsWith(key+'_')).length,new:rows.filter(r=>r.skillKey.startsWith(key+'_')).length};});
const counts=Object.values(plan.skills).reduce((out,s)=>{for(const [kind,arr]of Object.entries(s.disposition))out[kind]=(out[kind]??0)+arr.length;return out;},{});
await writeFile(new URL('README.md',here),`# 英雄机制第十三批候选

当前状态：20 槽候选已完成独立核算，等待主负责人语义复核与实际录入；本批业务写入为 0。对象为阿卡丽、卡萨丁、瑞兹、卡西奥佩娅，均包含 P/Q/W/E/R。

台账中这四名英雄只命中公共参数批次。实际 172 次 GET 确认 20 个主体、120 份组成列表、28 个参数详情及 4 份字典；仅有 28 个公共参数。另 28 次 GET 已核对 4 个角色主体、4 组共 20 条技能关联和 20 个代表图关系，完整响应保存用于保护；没有下载或修改图字节。

| 英雄 | 参数总数 | 公式 | 独立效果 | 原参数复用 | 预计新增 |
| --- | ---: | ---: | ---: | ---: | ---: |
${perHero.map(h=>`| ${h.hero} | ${h.parameters} | ${h.formulas} | ${h.effects} | ${h.reuse} | ${h.new} |`).join('\n')}
| 合计 | 145 | 37 | 20 | 28 | 174 |

预计新增为 117 参数、37 公式、20 独立效果；没有过程、内部状态、触发规则、伤害结果或直接治疗结果。组成可保存不表示实际战斗机制已完成。原对象的名称、说明、排序及数值完整复用。

来源沿固定客户端 16.17（构建 16.17.8104348）与官方目录 16.17.1，原始字节、网址和散列见《来源冻结/来源与哈希汇总.json》。中文绑定文本原文 SHA：${textSourceHash() }。不以相似技能名字替代角色根绑定。

- 阿卡丽的 Q/E 消耗能量；W 最大能量增加和实际能量回复分别保存，隐形资格仍待接线。R 无消耗不创建空资源效果。
- 卡萨丁 R 的资源节点口径未具名证明，保留无默认实际输入；真实连续层数无默认。费用仅在整数 0 至 4 的有限域内等价于 40、80、160、320、640，未声称有运行时范围验证。
- 瑞兹 P 当前正文具名证明 Q/W/E 使用额外法力；P 显示百分比点另转比例，100 法强对应 10% 即 0.1。Q 消耗涌动读取 R 真实等级；未学习 R 的原索引 0 另列待核。
- 蛇女 Q 为 3 秒总伤害，W 为每秒伤害；E 中毒、恢复目标分类与击杀返还，R 朝向决定的互斥控制均保留依赖。
- 4 个等级计算项只保存原节点与无默认实际输入，没有生成 18 级插值或补零。阿卡丽 Q、卡萨丁 E、蛇女 E 的简述有陈旧或矛盾表述，当前直接绑定长说明和计算树单独记录，交主审核对。

独立核算：${math.checks} 项检查通过；${math.sourceCases.length} 组原树求值和 ${math.manualCases.length} 组手算覆盖全部 37 公式。使用原始压缩资料直接核对源值，未导入生成辅助函数；包括总/额外 AD、总/额外法力、已损法力、动态层数及百分比点区别性输入。示例等级值是外供值，不是曲线证明。见《独立源值与算例.json》。

最终候选 SHA：${version.fileSha256}。

候选对象 SHA：${version.planSha256}。

《写前计划.json》只列请求，不含执行器或授权。若开始实录，先逐项 GET，同值复用、异值停项、只补缺；不得因 5xx 推断失败重发。默认工具均为只读或本地生成，认证只通过环境输入，不在证据中保存。

核对入口：用现有 Node 运行《独立源值核算.mjs》。不要为了复核运行《生成候选.mjs》，它会重建候选并改变时间字段及散列。
`);
function textSourceHash(){return '3bdb4829379195044927237f2c5a97609cb872d1dbd1eb597edffa797333e031';}
await writeFile(new URL('体验报告.md',here),`# 第十三批候选准备体验

已完成资料整理及只读核对，没有进行浏览器验收或业务录入。全部 200 次 GET 成功；原 28 参数可完整复用，原始名称和说明保留，避免重复整批。

1. 通用来源字段 manaValues 不能决定资源类别。阿卡丽官方资源为能量，W 的当前成本文字又明确“回复能量”；应先核角色资源，再建立资源效果。
2. 同一技能的短摘要可能陈旧。阿卡丽 Q 摘要写额外 AD，而当前绑定 Damage 的 tADRatio 和旧属性节点证明总 AD；卡萨丁 E 摘要仍说充能，长说明为附近施法缩短冷却；蛇女 E 摘要称按实际伤害恢复，当前绑定树为 AP×HealRatio。候选保留差异和选择依据，未默称资料一致。
3. 必须读扩展说明。阿卡丽 R 扩展说明明确低于 30% 当前生命时造成最高伤害，已补确定阈值；仍未根据最低/最高值猜中间曲线。第一次未纳入该阈值的候选留在“历史/独立核算前”。
4. 等级节点不能仅凭类型或端点展开。4 个实际项保留为无默认输入；缺 values 的字段留来源，不按 0 处理。原始树和候选分别求值，可防止生成器与检查器复述同一错误。
5. 百分比点和比例是两个输入单位。瑞兹 P 的显示值 10 再除以 100 得 0.1；Q 的 28% 移速用 move_speed_percent，而非实际移速。卡萨丁 W 则取自身已损法力乘比例，不能误取总法力。
6. 动态费用不复用固定基础成本结果。卡萨丁 R 的原 40 法力参数保留，但独立消费结果引用真实层数费用公式。当前公式没有幂运算，有限整数域用等价二元表达式；输入约束尚未接线，不能声称可直接自动执行。
7. 范围外应拆分分支。烟幕自身资源、瑞兹 R 被动、蛇女对小兵或小型野怪恢复仍影响单人伤害或战前状态；只排除纯空间/多目标传播/竞技场数值。中毒、涌动、朝向和施法来源资格单独保留。

当前逐项分类数量：${JSON.stringify(counts)}。这表示记录条目数，不是技能完成数；尚未进行战斗运行验证。
`);
const manifest={at:new Date().toISOString(),status:'候选完成，等待主负责人复核',apiWrites:0,actualGetRequests:200,counts:version.counts,newCounts:requestPlan.newCounts,reusedParameters:28,newComponents:174,perHero,classificationCounts:counts,checks:math.checks,sourceCases:math.sourceCases.length,manualCases:math.manualCases.length,unknownCurves:math.unknownCurves.length,files:{}};
for(const name of ['完整候选.json','候选版本.json','写前计划.json','写前现值.json','关联与图片保护快照.json','独立源值与算例.json','根绑定与数值证据.json','补充文本证据.json','来源冻结/来源与哈希汇总.json','阶段去重预检.json','README.md','体验报告.md'])manifest.files[name]=await fileHash(name);
await writeFile(new URL('最终交付清单.json',here),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({candidateSha256:version.fileSha256,requestPlanSha256:manifest.files['写前计划.json'],manifestSha256:await fileHash('最终交付清单.json'),newComponents:174,actualGetRequests:200,apiWrites:0}));
