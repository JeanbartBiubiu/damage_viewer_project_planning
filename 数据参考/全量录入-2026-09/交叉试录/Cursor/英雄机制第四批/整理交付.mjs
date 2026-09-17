import {readFile,writeFile,access} from 'node:fs/promises';
import {plan} from './组成.mjs';
const exists=async n=>access(new URL(n,import.meta.url)).then(()=>true,()=>false);
const final=await exists('./最终回读摘要.json'),prefix=final?'最终':'阶段';
const summary=JSON.parse(await readFile(new URL('./'+prefix+'回读摘要.json',import.meta.url),'utf8'));
if(summary.failures.length)throw Error('当前回读尚有失败，不能生成成功交付口径');
const evidence=JSON.parse(await readFile(new URL('./根绑定与数值证据.json',import.meta.url),'utf8'));
const liveTotal=Object.values(summary.totals).reduce((a,b)=>a+b,0),pendingBrowser=summary.pendingBrowser??[];
const labels={parameters:'参数',formulas:'公式',effects:'效果',processes:'过程',internalStates:'内部状态',triggerRules:'触发规则'};
const countText=Object.entries(summary.totals).map(([k,v])=>v+' '+labels[k]).join('、');
const table=['| 技能 | 参数 | 公式 | 效果 | 过程 | 内部状态 | 规则 |','| --- | ---: | ---: | ---: | ---: | ---: | ---: |',...Object.entries(summary.skills).map(([k,v])=>'| '+k+' '+v.name+' | '+Object.keys(labels).map(t=>v.counts[t]).join(' | ')+' |')].join('\n');
const readme=`# 阿狸、德莱厄斯、黛安娜、维迦机制实录第四批

本批已保存并独立回读 ${liveTotal} 个组成：${countText}。其中21个参数是先前公共参数，本批复用原业务字段，新增${liveTotal-21}项。20个技能主体均已读取，120类列表及${summary.componentsChecked}个组成详情核对一致；${summary.arithmeticCount}个独立算例和${summary.invariantCount}个关键约束检查通过。

维迦E状态效果与边缘命中规则经真实页面确认存在结构/来源问题，均未保存。本批当前批准集合为230项；原232候选与页面方案位于未保存候选目录，不属当前录入目标，也不属1V1范围外。待系统修正后再补。

这是已确定组成的作者态实录，不表示20技能的全机制或战斗运行完成。每个技能的待配与排除见来源处置清单.md。Cursor路线连接中断后由Codex执行代理接手来源整理、API录入与核算，本报告不冒称Cursor已经成功实录或提供独立用户体验。

## 冻结与保留

版本固定官方16.17.1及客户端16.17。根绑定与数值证据.json 保留四英雄20个P/Q/W/E/R的角色根引用、完整主技能对象、官方字段和哈希。来源冻结/主技能数值展开.json 本批保留完整计算树，不把精简摘要当无损源；补充文本证据.json 中仅当前根mLocKeys指向的文本作为当前说明依据。

写前现值.json 是原始21参数及其余组成空列表证据，不应重跑核对现值.mjs覆盖它。写入流水.jsonl 是真实新增的逐项POST及独立GET结果；重复运行录入脚本不能替代这份原始流水。

## 重复运行

在本目录使用可用Node运行录入.mjs，默认仅校验冻源与GET，不写业务。显式增加 --apply 只补缺：全批先GET，同键相同跳过，不同保留现值并停止当前选定范围；可用 --skill=技能标识 单独检查和继续其他对象。每次POST前再次GET同键，保存后独立GET比较。脚本不执行PUT、DELETE，也不改角色、图片、技能分类或关联。

维迦E两项未保存候选不由常规入口重放。生成候选.mjs 只更新当前批准集合，并拒绝混入这两项；页面方案保持归档。独立回读.mjs 默认严格核当前230项，旧 --allow-pending-browser 只用于历史阶段核验，不用于最终结论。整理交付.mjs 根据最终或阶段回读生成本说明。

## 当前真实数量

${table}

未运行全量回归、Wasm或战斗计算；独立算例执行的是数据库表达式的数值核算。主负责人负责代表页面验收及集成提交，执行代理未提交或推送。
`;
await writeFile(new URL('./README.md',import.meta.url),readme);
let dispositions='# 来源处置清单\n\n本清单按当前候选列明已录、待配和排除；真实保存数以'+prefix+'回读摘要.json为准。纯经济、经验、小兵野怪特供和多对象搜索不进入当前1V1实录；混合技能的英雄战斗部分继续保留。\n\n';
for(const h of evidence.heroes)dispositions+='- '+h.id+'：客户端 '+h.client.path+'，SHA-256 '+h.client.sha256+'；官方 '+h.official.path+'，SHA-256 '+h.official.sha256+'。\n';
for(const s of Object.values(plan.skills)){
 const actual=summary.skills[s.skillKey];dispositions+='\n## '+s.skillKey+' '+s.name+'\n\n';
 dispositions+='角色根：'+s.source.rootPath+'；技能绑定：'+s.source.spellPath+'。\n\n';
 dispositions+='已回读：'+Object.entries(actual.counts).map(([k,v])=>labels[k]+v).join('、')+'。';
 if(s.reusedParameters.length)dispositions+=' 复用公共参数：'+s.reusedParameters.join('、')+'。';
 dispositions+='\n\n';
 for(const[k,arr]of Object.entries(s.write))if(arr.length)dispositions+='- '+labels[k]+'候选：'+arr.map(v=>v.parameterKey??v.formulaKey??v.effectKey??v.processKey??v.stateKey??v.ruleKey).join('、')+'。\n';
 dispositions+='\n';for(const p of s.pending)dispositions+='- 待补（'+p.kind+'）'+p.component+'：'+p.reason+'\n';
 for(const p of s.excluded)dispositions+='- 本轮排除：'+p.component+'。'+p.reason+'\n';
}
dispositions+='\n## 关键来源处置\n\n- Ahri W 当前根RepeatDamageMod=0.4，旧别名spell_ahriw的30%不用于16.17；当前R重施放窗口15秒，旧别名10秒不覆盖它。\n- Veigar W 主cooldown和官方0是动态占位，BaseCooldown=8秒保留为基础参数；没有创建0秒过程。\n- Darius R 三级法力消耗是真实0，保留；未用缺值默认0。\n- Darius Q/W/R的施法原字段不一致，未用某一个字段假装完整时序；Veigar R只证明基础和2倍上限，未猜连续生命值倍率。\n- 黛安娜W护盾依据额外生命，不能把BHPRatio用到总生命；月光的E刷新用途仍在1V1范围，不能作为纯视野删除。\n';
await writeFile(new URL('./来源处置清单.md',import.meta.url),dispositions);
const report=`# 实际配置体验报告

这是Codex执行代理接手Cursor连接中断后的作者态体验。已确认的事实是${liveTotal}组成真实GET一致、${summary.arithmeticCount}项独立算例及${summary.invariantCount}项约束通过。没有用源资料文件或POST成功替代回读，也没有宣称战斗运行完成。

## 已验证可用的录入方式

- 21个既有公共参数可在数值一致时直接复用完整名称、说明和顺序。不得用新候选覆盖原参数的其他业务字段。
- 常规伤害、直接治疗、自护盾、成本、基础冷却、施法延迟、实际命中和来源初始化均能录入。11个过程已绑定明确成本与冷却；不会在过程结束自动生成敌方命中。
- 黛安娜被动用初始化常态攻速，加仅Q/W/E/R施放触发的临时额外2倍攻速，实现常态1倍+临时2倍=3倍；18级为0.35+0.70=1.05，两效果现均按当前等级求值；已将施加时快照有界纠正，证据在动态攻速纠错目录，避免升级后仍读旧等级。动作来源明确筛选英雄技能，不扩大为装备使用。
- 已存在RUNTIME_INPUT可保存Darius R实际出血层数和Veigar实际层数。Darius R按0至5层限制的公式已录；没有合法取层绑定时不接空输入规则。
- 强化普攻、重施放和内部计数已有作者态形状；本批缺确切等待窗口、来源事件或重置顺序的部分被列为待补，并未笼统说系统不支持这些能力。

## 需要系统核对或最小修正

| 问题 | 具体例子 | 处置与下一步 |
| --- | --- | --- |
| 百分比穿透来源合并 | 已有40%与Darius E20%应为52%，固定加算会成60% | 当前目录仅固定加算/比例加成；保留20%至40%参数，待正确剩余比例组合后补效果 |
| 无上限且可读取的叠层 | Veigar P没有上限，W又要读取其真实层数 | COUNTER最大值必填，不能造999999；属性ADD可以累计法强但不能代替真实层数来源。补可读无上限层数后统一接P/Q/W |
| 状态名字不等于行动限制 | /statuses/vertigo仅有眩晕名字、启停、说明 | 真实页面另确认PERSISTENT+TARGET不能配置法术护盾阻挡粒度；null会绕过护盾，APPLICATION则无本次状态归属和期限。不能以statusKey结束移除误删其他来源，两项未保存待修。行动限制仍需完整核对 |
| 同技能阶段来源 | Ahri Q去程未命中而返程首次命中仍是真实伤害；Diana R拉入与1秒后爆炸不同阶段 | 不能用命中序号冒充方向或初始拉入直接触发爆炸。应补真实事件阶段或经过验证的输入绑定 |
| 技能击杀与近期本人伤害因果 | Ahri魂魄要求近期3秒本人伤害；Darius R必须本次R击杀才刷新 | 不建任何KILL就触发的替代规则；需要已有事件字段的精确筛选或最小补充 |

## 有能力但尚未配置的组成

阿狸R有限次重施放、P补次数和续窗；Darius W强化普攻时序与暴击，P周期及满层血怒；黛安娜第三次普攻、月光和E刷新、W最后一球加盾刷新；Veigar的P/Q真实英雄命中及击杀计层、W分档冷却。这些仍属目标内待配，资料和事件表达核清后回填。冻结源暂不足的关键数值是Darius部分施放时序与周期分配，以及Veigar R连续生命倍率；不能用旧网页或默认零凑齐。

## 本批整理出的标准操作顺序

1. 先GET已有技能和全部组成，冻结写前快照；确认英雄根P/Q/W/E/R绑定，再展开完整计算树和当前mLocKeys文本。
2. 逐字段确认数组起点、当前字段优先级、百分数单位和毫秒换算；当前数值与旧字段冲突单列，不覆盖正确公共参数。
3. 将组成分成有证据可录、已有能力待配、系统缺口、范围外；每条待配写出需要的具体输入或表达，不能只写“复杂”。
4. 先参数和公式，再效果、过程、内部状态和触发规则；新表单形状经真实页面试录，稳定形状API只补缺。保留独立效果时明确实际命中尚未接线。
5. 保存后独立GET，再用边界算例检查基础/额外属性、真实0、层数上限、单次与总量以及事件因果；最后把实际数量、未配和来源处置同时更新。

首次算例中的阿狸E五级手工期望误写已更正，详见算例处置.md；业务公式始终正确。未运行全量回归，主负责人处理代表浏览器验收。本批没有角色、图片、共享字典或其他批次写入。
`;
await writeFile(new URL('./实际配置体验报告.md',import.meta.url),report);
console.log(JSON.stringify({source:prefix,total:liveTotal,pendingBrowser:pendingBrowser.length,generated:['README.md','来源处置清单.md','实际配置体验报告.md']}));
