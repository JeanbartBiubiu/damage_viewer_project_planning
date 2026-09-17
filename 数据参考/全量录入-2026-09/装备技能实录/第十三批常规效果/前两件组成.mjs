import assert from 'node:assert/strict';
import {source,base,data,numberCalc,param,note,proof,cloneReference,pv} from './候选工具.mjs';
export function firstTwo(){const objects=[];
 {
  const o=source.objects.find(o=>o.id===3145),x=base(3145,'passive','转速加快','对敌方英雄造成伤害后附加65魔法伤害，冷却40秒。候选保留伤害数值及冷却参数；法术护盾资格待核，伤害效果尚未进入保存集合。覆盖合法英雄伤害事件、冷却消费和自身伤害递归排除尚未接线，不缩为仅普攻或仅技能触发。');
  const amount=numberCalc(o,'DamageAmount'),cd=data(o,'Cooldown');assert.equal(amount,65);assert.equal(cd,40);
  param(x,'proc_damage','转速加快魔法伤害',amount,'当前 Items/3145 的 DamageAmount 计算式直接给出 NumberCalculationPart=65。');param(x,'proc_cooldown_ms','转速加快冷却',cd*1000,'当前 Cooldown=40秒，当前绑定 Item_Cooldown 读取该值。');
  x.withdrawnDrafts=[{component:'revved_damage',previousSnapshot:'原前两件候选-4a0e5c3d.json',reason:'法术护盾交互来源待核；原草稿 null 会明确不参与阻挡，不能作为未知占位。当前没有替换为其他阻挡范围，正常候选无伤害效果。'}];
  proof(x,'/Items~13145/mItemCalculations/DamageAmount',65,o.object.mItemCalculations.DamageAmount);proof(x,'/Items~13145/mDataValues + /entries/item_3145_tooltip',{cooldownMs:40000,trigger:'对敌方英雄造成伤害'},[o.object.mDataValues,o.bound.keyTooltip]);
  note(x,'来源待核','特殊伤害资格与法术护盾交互','当前主说明没有细列反射、持续、其他装备伤害及法术护盾交互。法术护盾范围 null 明确表示不参与阻挡，不能当作未知占位，原独立伤害草稿已撤出正常候选；待资格确证后再选择实际阻挡语义，不把全部来源无筛选接入。');
  note(x,'系统缺口','完整英雄伤害事件门槛','现有成熟装备批次已确认 DAMAGE_DEALT 伤害事件不能同时完成英雄类别筛选；也不能用仅普通攻击或仅某个技能命中替代当前广义伤害条件。');
  note(x,'尚未接线','40秒冷却与一次附伤消费','尚未建立冷却就绪、合法伤害发生时消费冷却及触发一次的完整规则，不建立只有冷却的空过程。伤害效果待护盾资格确定后补录。');
  note(x,'尚未接线','触发产生的装备伤害递归门禁','装备自身产生的65伤害不能无限触发自身；合法来源和冷却消费先后必须在规则接线时明确。');
  objects.push(x);
 }
 {
  const o=source.objects.find(o=>o.id===4629),x=base(4629,'passive','咒舞','对英雄造成魔法或真实伤害后提供自身20点固定移动速度，持续4秒。候选保留单层独立移速效果；伤害类型与英雄类别门槛尚未接线，不重复现有4%直接移速，不采用未绑定旧叠层字段。');const amount=numberCalc(o,'MoveSpeedAmount'),duration=data(o,'StackDuration');assert.equal(amount,20);assert.equal(duration,4);assert.ok(o.bound.keyTooltip.text.includes('@MovespeedAmount@'));
  param(x,'move_speed_bonus','咒舞固定移动速度',amount,'当前绑定 MovespeedAmount 对应同根 MoveSpeedAmount 计算式，常量20；大小写按客户端变量名称匹配。');param(x,'move_speed_duration_ms','咒舞移动速度持续时间',duration*1000,'当前绑定 StackDuration=4秒，换算4000毫秒。');
  const effect=cloneReference('item_3044_passive','/effects/melee_move_speed');effect.effectKey='spelldance_move_speed';effect.name='咒舞自身移动速度';effect.description='对英雄造成魔法或真实伤害后，单份20点固定移动速度持续4秒；合法事件选择尚未接线。';effect.results[0].name=effect.name;effect.results[0].description=effect.description;effect.results[0].valueRule.value=pv('move_speed_bonus');x.apiPayload.effects.push(effect);
  proof(x,'/Items~14629/mItemCalculations/MoveSpeedAmount + /entries/item_4629_tooltip',{amount:20,durationMs:4000},[o.object.mItemCalculations.MoveSpeedAmount,o.bound.keyTooltip]);
  proof(x,'/Items~14629/mDataValues','未绑定旧字段只保留原文：不建立3层、40移速、15%或10秒冷却',o.object.mDataValues.filter(d=>d.mName!=='StackDuration'));
  note(x,'范围外','装备已有4%直接移动速度','无条件直接属性已由装备提供，不新增相同属性效果，原值保持。');
  note(x,'系统缺口','魔法或真实伤害并限定英雄','需要合并魔法与真实伤害两个合法入口并限定英雄类别，不能只用普通技能命中，也不能让物理伤害或对非英雄伤害触发。');
  note(x,'尚未接线','持续刷新与合法触发','独立效果按成熟单实例20点移速结构配置；重新施加刷新4秒、不叠加多份。尚无自动规则触发它，不创建假3层或10秒冷却。');objects.push(x);
 }
 return objects;
}
