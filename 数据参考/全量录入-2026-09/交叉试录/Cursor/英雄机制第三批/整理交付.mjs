import {readFile,writeFile} from 'node:fs/promises';
import {plan} from './英雄候选.mjs';
const report=JSON.parse(await readFile(new URL('./护盾消费纠错/批次回读摘要.json',import.meta.url),'utf8'));
if(report.failures.length)throw Error('最终独立回读未通过，不生成完成记录');
const labels={parameters:'参数',formulas:'公式',effects:'效果',processes:'过程',internalStates:'内部状态',triggerRules:'触发规则'};
const counts=Object.entries(report.totals).map(([k,n])=>n+'个'+labels[k]).join('、');
const dispositions={generatedAt:new Date().toISOString(),scope:plan.meta.scope,executor:'Cursor完成来源准备；Cursor执行因ECONNRESET中断且未写。Codex接手代理完成API录入，主负责人完成Sivir E护盾/成功规则真实页面及施放过程。',sourceVersions:{official:'16.17.1',client:'16.17'},validation:{components:report.componentsChecked,arithmetic:report.arithmeticCount,invariants:report.invariantCount,failures:0,boundary:report.boundary},totals:report.totals,skills:Object.values(plan.skills).map(s=>({skillKey:s.skillKey,name:s.name,source:s.source,proofs:s.proofs,actualCounts:report.skills[s.skillKey].counts,savedKeys:Object.fromEntries(Object.entries(s.write).map(([k,a])=>[k,a.map(v=>v.parameterKey??v.formulaKey??v.effectKey??v.processKey??v.stateKey??v.ruleKey)])),pending:s.pending,excluded:s.excluded,status:s.skillKey==='tristana_p'?'原树已冻结，缺省起点未证；业务组成未写':s.pending.length?'部分机制已录，所列待补继续跟踪':'本轮范围录入完成，非战斗运行验收'}))};
await writeFile(new URL('./来源与处置清单.json',import.meta.url),JSON.stringify(dispositions,null,2)+'\n');
const table=dispositions.skills.map(s=>'| '+s.skillKey+' '+s.name+' | '+Object.values(s.actualCounts).reduce((a,b)=>a+b,0)+' | '+s.pending.map(p=>p.component).join('；')+' | '+s.excluded.map(p=>p.component).join('；')+' |').join('\n');
const readme=`# 第三批英雄技能实录

2026-09-08护盾消费纠错：希维尔E在原治疗效果内追加自身REMOVE，不改变210个组成计数。完整旧值、原候选、历史报告及新增写后GET分别保留在“护盾消费纠错”；原“独立回读证据.json / 回读摘要.json / 希维尔E页面回读.json”仅证明修正前时点，不用于声称当时已有消费。当前接口证据为“护盾消费纠错/批次独立回读证据.json / 批次回读摘要.json”。

最终独立GET核对20个技能主体及${report.componentsChecked}个已存组成：${counts}。${report.arithmeticCount}个独立来源算例、${report.invariantCount}项结构约束均通过。当前文件依据 ${report.finishedAt} 的真实接口结果。

Cursor仅完成来源准备，执行因连接重置中断；实际业务录入由接手代理完成。主负责人在真实页面创建希维尔E法术护盾和成功格挡治疗规则，并补缺施放过程。详细页面证据由主负责人维护“核对希维尔E页面.mjs / 希维尔E页面回读.json”，本脚本不覆盖这两文件。

这不是20个完整战斗机制全部完成。崔丝塔娜P保留原文，缺省插值起点待证，6类业务组成仍为空。其余19个技能均已保存可证明的组成，逐技能待补见下表和“来源与处置清单.json”。没有变更主体、角色关联、图片、共享目录或应用源码；未执行全量回归或Wasm战斗。

## 文件与恢复操作

- “根绑定与数值证据.json”保存角色根绑定的完整技能对象；“来源冻结/主技能数值展开.json”现已保留完整计算树，修复原摘要漏子树的问题。
- “英雄候选.mjs”定义20技能候选；“候选.mjs”是局部构造工具；“录入候选.json”是可审阅请求内容。
- “录入.mjs”默认仅GET业务接口。显式加 --apply 才补缺；先全批预检，同键不同停止，每次写后独立GET。可用 --skill=lucian_p 限定本批技能。希维尔E的护盾、过程、成功规则三项仍预留主负责人，不会被该脚本补写或覆盖。
- “独立回读.mjs”再次读取20主体及120组成列表、每项详情，比较候选并执行独立算例；当前证据写入“护盾消费纠错/批次独立回读证据.json / 批次回读摘要.json”，保留原时点证据。
- “首次写入受阻记录.json”和“击杀类别受阻记录.json”保存两次400错误；“写入流水.jsonl”记录所有普通API写后回读。
- “修正毫秒浮点.mjs”默认只读，显式 --apply 仅允许本批Tristana R眩晕参数从精确原值改到400/550/700毫秒，已执行并回读通过。原参数和修正记录均保留。
- “生成候选.mjs / 整理交付.mjs”只生成本批资料；后者要求最终回读没有失败。

## 本批技能处置

| 技能 | 已存组成数 | 仍需补齐 | 本轮排除 |
| --- | ---: | --- | --- |
${table}
`;
await writeFile(new URL('./README.md',import.meta.url),readme);
const experience=`# 第三批实际录入体验报告

已保存并独立GET核对${report.componentsChecked}个组成，${report.arithmeticCount}个独立算例和${report.invariantCount}项结构约束通过。执行者是接手代理；Cursor只做来源准备。希维尔E的法术护盾与成功格挡规则由主负责人真实页面保存，其余沿成熟API形状录入。本报告不将静态配置当作战斗效果完成。

## 录入中发现并已经修正

1. 原数值摘要丢失修改公式、嵌套加法和乘法子树，会遗漏卢锡安P暴击、R子弹数量、希维尔Q暴击属性折算、崔丝塔娜E层数增幅和图奇E毒层。现保留完整树并沿角色根精确绑定，所有来源SHA已核验。
2. 崔丝塔娜Q旧mana字段30/35/40/45/50与当前manaValues冲突。当前数组15/20/25/30/35与官方16.17.1一致，采用后者；卢锡安E的32/24/16/8/0是真实0消耗，正常保存。不能统一“数组从第0项取”或“遇0跳过”。
3. 希维尔R用自身范围持续效果条件时，显式SOURCE被接口400拒绝。现按契约将承受对象留空；该字段只有TARGET或SOURCE_TARGET范围才需要。应在录入说明中直接展示这个关系。
4. 崔丝塔娜R浮点秒先乘1000会得到400.000006等尾差。独立算例发现后，改为先归一原浮点再换单位，仅有界修正该参数为整数400/550/700，原值和写后GET都保留。
5. 真实页面自动生成成功规则动作标识action_1且编辑只读。候选已同步真实标识，效果目标仍为block_heal；没有为标识差异改应用或重写现值。
6. 后续独立审查发现成功格挡只治疗而没有消费；2026-09-08保留原治疗并追加SOURCE的REMOVE spell_shield，真实PUT和GET通过。组成仍为210，结果增加1；当前结构核对增加了显式消费断言。修正前证据完整保留，本次接口证据不冒充新的页面验收。

## 当前结构需要最小修正

- 击杀事件的目标类别条件：实际尝试KILL加CHAMPION条件时，接口400明确只允许命中事件使用类别。崔丝塔娜W需要击杀英雄后重置，不能删掉门槛让击杀小兵也重置。保留准确重置效果，未保存被拒规则。下一步核清KILL的当前目标就是死者后，使条件在作者接口与页面同样可选；参与击杀与近期伤害因果另列。
- 衰减属性：当前文本明确希维尔P在1.5秒持续衰减55至75的移速。持续属性的恒定快照、重新取当前属性都不能直接表达按时间衰减；先补通用时间输入或经核对的衰减表达，再接攻击/技能造成英雄伤害与E成功挡技能事件，不写恒定移速假效果。
- 目标与来源绑定的跨技能取层：运行输入参数、事件绑定和生命周期结构已经存在。缺口需要落在P/W/E如何读取同一来源施加给同一目标的合法层数与到期/叠层时序，不能笼统说系统没有层数。图奇E与崔丝塔娜E已保留实际层数参数和全层范围伤害公式，未创建空绑定命中规则。
- 当前有眩晕、法术护盾和强化普攻步骤能力。击退、减速/韧性组合、伪装可选取规则及重复攻击判定仍需单独核清；不能用眩晕替代击退、用恒定移速替代衰减或认为不影响1V1。

## 资料或配置待补，不等同结构缺口

- 卢锡安R子弹连续计算值：22×[1+暴击率×(1+额外暴伤)]。25%暴击、无额外暴伤得到27.5；完整客户端说明树没有证明整数发数取整方式。已录单发伤害与真实命中规则，总量只用于核对，未构造猜测次数的引导流程。
- 卢锡安Q施法随等级缩短，希维尔Q随额外攻速缩短，崔丝塔娜E沿普攻施法时长；固定字段不是完整时长算法。
- 崔丝塔娜P的等级插值只有终点150，没有显式起点；未补0，也未建立猜测18级曲线。证明缺省数值语义后可继续初始化攻击距离。
- 图奇Q攻速是离开伪装后持续6秒，不是按下Q立即生效。图奇W毒雾每秒叠毒要求仍在区域，P每秒伤害的首周期与刷新相位需来源核对。
- 崔丝塔娜E满4层一般立即爆炸，但R提供末层时要等击退后爆炸。统一真实爆炸事件后，再连W冷却重置；提前移除事件不是引爆事件。
- 卢锡安P警惕定身分支不限制友军来源，不能整段排除。15+0.2总AD、2次/最多4次/6秒已录，来自自身装备控制的合法触发仍待核。

## 具体数值核对

- 卢锡安P在13级、200总AD：第二发基础120；额外暴伤0.4时暴击倍率2.15，警惕额外魔法伤害55。
- 希维尔Q在5级、80额外AD、100AP、50%暴击和0.4额外暴伤：276×1.28=353.28；没有再重掷暴击。
- 崔丝塔娜E在1级、80额外AD、100AP、无暴击：0至4层分别174/217.5/261/304.5/348；5级、50%暴击和0.4额外暴伤，4层701.44。
- 图奇E在1级、80额外AD、100AP：1/3/6层分别63/149/278物理和35/105/210魔法；两个结果属于同一次效果，法术盾按整个效果阻挡。
- 希维尔E在200总AD、100AP：1级治疗170、5级治疗210；1500毫秒护盾，仅成功格挡后治疗，P衰减移速另待补。

## 可复用录入步骤

先核版本和根绑定完整树，逐字段确认等级索引与单位；再按1V1分清混合效果保留部分。成熟形状用API前先GET同键，缺项创建、不同值停止。新组合先真实页面录一例，再独立GET核字段。用零/满暴击、不同暴伤、0至满层、关键等级断点作独立算例；失败只修明确错项。最后保存每技能已录/待补/排除和恢复脚本。普通保存成功不能替代命中、触发、生命周期与实际层数来源的完整说明。
`;
await writeFile(new URL('./实际体验报告.md',import.meta.url),experience);
console.log(JSON.stringify({components:report.componentsChecked,files:['来源与处置清单.json','README.md','实际体验报告.md']}));
