import assert from 'node:assert/strict';
import {source,base,data,param,runtime,formula,note,proof,pn,op} from './候选工具.mjs';
export function remaining(){const objects=[];
 {
  const o=source.objects.find(o=>o.id===3146),x=base(3146,'active','闪电弹','震击目标敌方英雄，造成魔法伤害和25%减速，减速持续1.5秒，冷却60秒。候选保留当前伤害插值两个值端点与0.3未定属性系数，以及减速和冷却参数；插值等级端点及省略属性枚举的默认解码待核，未生成猜测伤害公式或伤害效果。');const parts=o.object.mItemCalculations.ActiveDamage.mFormulaParts;assert.equal(parts.length,2);assert.equal(parts[0].__type,'ByCharLevelInterpolationCalculationPart');assert.equal(parts[1].__type,'StatByCoefficientCalculationPart');assert.equal(parts[0].mStartValue,175);assert.equal(parts[0].mEndValue,253);
  param(x,'damage_interpolation_start','伤害插值起始数值',parts[0].mStartValue,'当前计算节点 mStartValue=175；仅为数值端点，没有证明对应角色1级。');param(x,'damage_interpolation_end','伤害插值结束数值',parts[0].mEndValue,'当前计算节点 mEndValue=253；仅为数值端点，没有证明对应角色18级。');param(x,'damage_stat_coefficient','伤害未定属性系数',Math.round(parts[1].mCoefficient*1e6)/1e6,'当前 StatByCoefficientCalculationPart 显示系数0.3，但 mStat、mStatFormula 均省略。未解码前不能命名为法强或总量系数。');param(x,'slow_ratio','闪电弹减速比例',data(o,'SlowAmount'),'当前 SlowAmount=0.25，当前绑定主动显示25%。');param(x,'slow_duration_ms','闪电弹减速持续时间',data(o,'SlowDuration')*1000,'当前 SlowDuration=1.5秒，换算1500毫秒。');param(x,'active_cooldown_ms','闪电弹主动冷却',data(o,'Cooldown')*1000,'当前 Cooldown=60秒。官方文本显示0秒与0伤害为模板未展开，不采用为数值。');
  proof(x,'/Items~13146/mItemCalculations/ActiveDamage/mFormulaParts',{valueEndpoints:[175,253],unresolvedStatCoefficient:.3,levelEndpoints:'未显式提供',stat:'未显式提供',statFormula:'未显式提供'},parts);proof(x,'/Items~13146/mDataValues + /entries/item_3146_active',{slowRatio:.25,slowDurationMs:1500,cooldownMs:60000},[o.object.mDataValues,o.bound.keyActive]);
  note(x,'范围外','已有攻击力、法强与10%全能吸血直接属性','原装备直接属性保持，不为普通属性再创建被动效果。');
  note(x,'来源待核','伤害插值等级域和系数属性默认值','当前节点只写175、253与0.3，未显式给出起止等级、属性编号及基础/额外/总量类型；需要同版本可靠解码默认依据，不能猜1至18线性或0.3法强。');
  note(x,'来源待核','目标技能伤害与减速的法术护盾粒度','主动针对敌方英雄；伤害与减速应按确证资格处理护盾，当前没有把 null 当未知占位，也没有生成来源不足伤害效果。');
  note(x,'系统缺口','减速的合法结果与组合','当前状态目录只有眩晕；普通减少移动速度比例属性不等于游戏减速。慢速、抗性与跨来源组合需要合法表达，不能套用眩晕或借普通属性加算区。');
  note(x,'尚未接线','主动施放与实际目标命中','冷却参数已候选，合法目标、主动消费、伤害和减速组合未接线；不创建仅有60秒冷却的空过程或虚构命中。');
  proof(x,'/Items~13146/mItemDataClient/mTooltipData/mLocKeys','升级配方含3145不代表继承转速加快；当前绑定只有闪电弹',o.bound);objects.push(x);
 }
 {
  const o=source.objects.find(o=>o.id===3082),x=base(3082,'passive','坚如磐石','降低来自英雄单次攻击的伤害15点，单次格挡上限为该攻击伤害20%。候选保存两项确定参数及以待绑定伤害输入计算的独立上限公式；伤害取值阶段、整次攻击伤害包范围及减伤结果尚待配，不伪造护甲、治疗或每包15点格挡。');
  param(x,'flat_block','英雄攻击固定格挡量',data(o,'BlockBase'),'当前绑定主说明引用 BlockBase=15。');param(x,'block_cap_ratio','单次攻击格挡占伤害上限',data(o,'WardenDamageMax'),'当前扩展绑定明确单次格挡不超过该次攻击伤害20%。');runtime(x,'attack_damage_for_block_cap','本次攻击格挡上限伤害输入','DECIMAL 非负输入：来源必须是同一次英雄攻击用于20%上限的完整伤害基数；具体伤害取值阶段和伤害包集合待核，当前没有运行时绑定，不能传入任意单包或未知默认0。');
  formula(x,'block_amount','本次攻击格挡量上限公式','仅表达 MIN(15, 0.2 × 本次攻击上限伤害输入)。输入阶段未定、没有减伤效果或触发规则，不能将独立算例视为真实伤害管线结算。',op('MIN',pn('flat_block'),op('MULTIPLY',pn('block_cap_ratio'),pn('attack_damage_for_block_cap'))));
  proof(x,'/Items~13082/mDataValues + /entries/item_3082_tooltipextended',{flatBlock:15,capRatio:.2,formula:'min(15, .2 * D)',unresolved:'D的伤害取值阶段与整次攻击包集合'},[o.object.mDataValues,o.bound.keyTooltip,o.bound.keyTooltipExtended]);proof(x,'/Items~13082/mDataValues/0','MaxHPRatio=.005 未由当前绑定引用，不新增最大生命缩放',o.object.mDataValues[0]);
  note(x,'来源待核','格挡伤害基数与执行阶段','当前文字未证明护甲前/后、其他减伤前/后及混合伤害包如何构成该次攻击。独立公式输入留待绑定，不把任何未经证明的阶段写成已确定。');
  note(x,'系统缺口','英雄攻击过滤及单次平减与上限','当前目录无伤害计算区；不能以属性区、护甲增加、伤后治疗或每伤害包固定减15近似。需同时表达只限英雄攻击与同次攻击总上限。');
  note(x,'尚未接线','伤害输入生产与实际格挡','保留小数输入和独立公式便于之后对接；没有事件绑定、伤害修正效果或初始化规则，不声称已减少实际伤害。');objects.push(x);
 }
 {
  const o=source.objects.find(o=>o.id===3110),x=base(3110,'passive','凛冬之抚','降低附近敌方英雄20%攻击速度。本轮保留对单个对手的攻速削减比例；正确攻速计算区与同类削减叠加规则待核，不改成减少20个百分点额外攻速，不自动继承守望者格挡。');assert.equal(data(o,'ASPDSlow'),-.2);param(x,'attack_speed_reduction_ratio','凛冬之抚攻击速度削减比例',-data(o,'ASPDSlow'),'当前 ASPDSlow=-0.2；绑定乘以-100显示攻击速度降低20%，保存为正削减比例0.2，不是额外攻速减少20个百分点。');
  proof(x,'/Items~13110/mDataValues/0 + /entries/item_3110_tooltip',{attackSpeedReductionRatio:.2},[o.object.mDataValues[0],o.bound.keyTooltip]);proof(x,'/Items~13110/mDataValues/1 + /Items~13110/mItemDataClient/effectRadius',{auraRadius:700,clientDisplayRadius:o.object.mItemDataClient.effectRadius},[o.object.mDataValues[1],o.object.mItemDataClient.effectRadius]);
  note(x,'范围外','空间半径与多目标光环遍历','700光环字段和750客户端显示半径分别保留来源，不混用；本轮排除距离检测及多目标分发，不为范围建立可执行参数。对单个对手的攻速削减仍保留。');
  note(x,'来源待核','攻速削减读取阶段与同类叠加','当前文字确证降低攻击速度20%，没有给出与其他攻速削减、攻速上限、最低值和特殊免疫的运算顺序。不能把来源待核部分固定为额外攻速减0.2或猜测独立乘区。');
  note(x,'系统缺口','正确攻速削减计算区','现有普通额外攻速比例属性及4个属性计算区不能独立证明攻速慢速的正确语义；没有以借用区、固定20点或初始化修改额外攻速冒充。');
  note(x,'尚未接线','对手生效与退出移除','对单个合法敌方英雄授予、移除与来源实例组合尚未接线，没有无限持续属性效果。');proof(x,'/Items~13110/mItemDataClient/mTooltipData/mLocKeys','升级配方含3082不代表继承坚如磐石；当前绑定只有凛冬之抚',o.bound);objects.push(x);
 }
 {
  const o=source.objects.find(o=>o.id===3143),x=base(3143,'passive','复原力','所受的来自暴击的伤害降低30%。本被动候选仅保留确定削减比例；暴击过滤、减伤计算区和作用阶段未接线，不能减少对手暴击率或借属性区代替。');param(x,'critical_damage_reduction_ratio','受到暴击伤害削减比例',data(o,'PercentCritDamageReduction'),'当前 PercentCritDamageReduction=0.3，绑定复原力与官方说明一致。');proof(x,'/Items~13143/mDataValues/0 + /entries/item_3143_tooltip',{criticalDamageReductionRatio:.3},[o.object.mDataValues[0],o.bound.keyTooltip]);
  note(x,'来源待核','暴击判定范围和伤害包阶段','当前文字没有细列特殊可暴击技能、附带伤害包、真伤及多种减伤顺序。保留30%确定值，不生成未经核实的包级或攻击级过滤。');note(x,'系统缺口','受到暴击伤害的合法修正区','当前目录没有伤害计算区，不借属性区或降低对手额外暴击伤害属性表达。减伤应在持有者受到方向且限定合法暴击伤害。');note(x,'尚未接线','被动初始化和受到伤害过滤','只有比例参数，未构造初始化规则、无限效果或所有伤害30%减免。');proof(x,'/Items~13143/mItemDataClient/mTooltipData/mLocKeys','升级配方含3082不代表继承坚如磐石；当前被动绑定只有复原力',o.bound);objects.push(x);
  const a=base(3143,'active','谦卑','主动使附近敌人减速70%，持续2秒，冷却90秒。本轮保留对单个对手的减速与冷却参数；合法减速表达与主动命中未接线，空间及多目标分发后置。');param(a,'slow_ratio','谦卑减速比例',data(o,'SlowAmount'),'当前 SlowAmount=0.7，绑定谦卑与官方说明一致。');param(a,'slow_duration_ms','谦卑减速持续时间',data(o,'SlowDuration')*1000,'当前 SlowDuration=2秒，换算2000毫秒。');param(a,'active_cooldown_ms','谦卑主动冷却',data(o,'Cooldown')*1000,'当前 Cooldown=90秒，当前主动绑定的 Item_Cooldown 读取该值。');proof(a,'/Items~13143/mDataValues + /entries/item_3143_active',{slowRatio:.7,durationMs:2000,cooldownMs:90000},[o.object.mDataValues,o.bound.keyActive]);
  note(a,'范围外','500半径与多目标施加','空间距离检测及对多个敌人的分发本轮后置，原 Radius=500 保留来源；保留对单个对手的减速。');note(a,'来源待核','主动减速与法术护盾粒度','当前主动文本没有直接说明法术护盾交互。不得以 null 作为未知或为通过持续目标效果而改变期限语义。');note(a,'系统缺口','合法减速与来源组合','只有眩晕状态及属性区，不能以减0.7移动速度加成比例或降低70点固定移速代替70%减速。减速抗性及跨来源组合待正确结果表达。');note(a,'尚未接线','主动施放冷却及真实命中','没有90秒空过程或假施法事件；待合法减速结果与目标命中门槛明确后补主动过程。');objects.push(a);
 }
 return objects;
}
