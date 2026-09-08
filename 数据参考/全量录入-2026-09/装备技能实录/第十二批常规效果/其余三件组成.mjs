import assert from 'node:assert/strict';
export function extra({source,before,base,data,parameter,parameterValue,fixed}){
 const objects=[],fval=formulaKey=>({kind:'FORMULA',formulaKey}),pn=parameterKey=>({nodeType:'PARAMETER',parameterKey});
 const life=duration=>({durationValue:duration,maxStacksValue:fixed(1),applicationStacksValue:fixed(1),instanceScope:'SOURCE',reapplicationStackMode:'KEEP',reapplicationDurationMode:'REFRESH_ALL',expiryMode:'ALL_AT_ONCE',periodicIntervalValue:null,firstPeriodicExecution:null});
 const behavior={moment:'PERSISTENT',valueReadMode:'APPLICATION_SNAPSHOT',stackValueMode:'SHARED',reapplicationValueMode:'REPLACE',periodicExecutionMode:null};
 function speedEffect(key,name,attributeKey,value,description,sortOrder=10){return {effectKey:key,name,description,sortOrder,lifecycle:life(parameterValue('move_speed_duration_ms')),results:[{resultKey:'move_speed',name,description,sortOrder:10,resultType:'ATTRIBUTE_CHANGE',target:'SOURCE',lifecycleBehavior:behavior,spellShieldBlockScope:null,valueRule:{value,fixedMultiplier:1,fixedMinValue:0,fixedMaxValue:null},detail:{attributeKey,operation:'INCREASE',modifierZoneKey:'attribute_flat_add'}}]};}
 {
  const o=source.objects.find(o=>o.id===2420),x=base(o,'active',o.name+'·时间停止','当前绑定明确单次使用，进入凝滞2.5秒。候选仅记录确证的单次次数、持续时间及独立伤害免疫组成；不可被选取、无法移动和一次性使用控制未完整配置。不复制中娅沙漏120秒冷却。');const duration=data(o,'Duration');assert.equal(duration,2.5);assert.ok(o.bound.keyActive.text.includes('单次使用'));assert.ok(!o.object.mDataValues.some(v=>v.mName==='Cooldown'));
  x.apiPayload.parameters=[parameter('stasis_duration_ms','凝滞持续时间',duration*1000,'当前根Duration=2.5秒，绑定主动及官方说明一致。',10),parameter('maximum_uses','当前装备单次使用上限',1,'当前绑定主动明确单次使用；该值不是可周期恢复的弹药。',20)];
  const ref=before.references.find(s=>s.skillKey==='item_3157_active').records.find(r=>r.route.endsWith('/effects/stasis_damage_immunity')).data;
  const effect=Object.fromEntries(Object.entries(structuredClone(ref)).filter(([k])=>!['gameId','skillKey','createdAt','updatedAt'].includes(k)));effect.description='单次凝滞中的独立伤害免疫组成，持续2.5秒；不包含不可选取、移动限制和一次性消费，不自动触发。';effect.name='探索者凝滞伤害免疫';x.apiPayload.effects=[effect];
  x.proofs.push({source:o.path+'/mDataValues.Duration + 当前keyActive',durationSeconds:duration,maximumUses:1,activeBinding:o.bound.keyActive,stasisDefinition:source.boundDefinitions.Item_KeywordDefinition_Stasis,reference:'item_3157_active仅复用合法伤害免疫结构，不复用其冷却与循环施放'});
  x.disposition.系统缺口.push({component:'完整凝滞限制',reason:'既有3157实录只确证DAMAGE_IMMUNITY结构；当前作者配置尚不能完整表达凝滞中的不可被选取和无法移动，不能把独立伤害免疫视为完整凝滞。'});
  x.disposition.尚未接线.push({component:'单次使用消费及主动施放',reason:'当前单次使用上限1已明确，尚未建立物品实例消费与合法主动执行门槛；不建立冷却0或120秒的循环过程，不以来源初始化授予主动免疫。'});
  x.proofs.push({source:'探索者使用后形态补证.json',transition:'同版本根转换记录{e246dfd1}的{06d9d838}=Items/2420，{917537a9}=Items/2421；2421的mRequiredBuffCurrencyName=Item2420',conclusion:'使用后形态2421已确证；官方2421文本确认护臂破碎后商店只出售碎裂的护臂，仍可用于升级。不改变本批独立免伤载荷。'});
  x.disposition.来源待核.push({component:'非商店方式重新获得装备的次数处理',reason:'同版本来源已确认2420使用后对应2421，且之后商店只出售碎裂的护臂；其他方式重新获得装备实例是否重置单次使用，仍未由这些记录确定。详见探索者使用后形态补证.json。'});
  x.arithmetic.push({sample:'2.5秒换算毫秒',expected:2500,actual:duration*1000,match:duration*1000===2500},{sample:'当前绑定单次使用次数',expected:1,actual:x.apiPayload.parameters.find(p=>p.parameterKey==='maximum_uses').fixedValue,match:true},{sample:'不复制沙漏冷却参数或无限主动过程',expected:0,actual:x.apiPayload.parameters.filter(p=>p.parameterKey.includes('cooldown')).length+x.apiPayload.processes.length,match:x.apiPayload.parameters.every(p=>!p.parameterKey.includes('cooldown'))&&x.apiPayload.processes.length===0});objects.push(x);
 }
 {
  const o=source.objects.find(o=>o.id===3139),x=base(o,'active',o.name+'·水银','当前绑定主动移除全部控制类减益但浮空除外，并给自身50%移动速度持续2秒，冷却90秒。独立移速组成保留；通用解控与浮空例外未完整表达，当前不接部分解控冒充水银。');const cd=data(o,'Cooldown'),duration=data(o,'MSDuration'),ratio=data(o,'MoveSpeed');assert.equal(cd,90);assert.equal(duration,2);assert.equal(ratio,.5);assert.ok(o.bound.keyActive.text.includes('浮空'));
  x.apiPayload.parameters=[parameter('active_cooldown_ms','水银主动冷却',cd*1000,'当前根Cooldown=90秒，绑定Item_Cooldown模板明确读取该值。',10),parameter('move_speed_ratio','水银自身移动速度比例',ratio,'当前根MoveSpeed=0.5，绑定主动说明×100显示50%。',20),parameter('move_speed_duration_ms','水银自身移速持续时间',duration*1000,'当前根MSDuration=2秒，换算2000毫秒。',30)];
  x.apiPayload.effects=[speedEffect('quicksilver_move_speed','水银自身移动速度','move_speed_percent',parameterValue('move_speed_ratio'),'自身增加50个百分点移速加成，持续2秒；不表示50点固定移速，也不包含解除控制。')];
  x.proofs.push({source:o.path+'/mDataValues + 当前keyActive',raw:o.object.mDataValues,cleanseExclusion:'浮空',airborneDefinition:source.boundDefinitions.Item_KeywordDefinition_Airborne});
  x.disposition.系统缺口.push({component:'所有控制类减益移除并排除浮空',reason:'沿用3140实录限制：单个状态移除不足以表达完整通用控制集合及浮空例外。当前状态目录只有眩晕，不能只清眩晕，也不能反向取消所有状态。'});
  x.disposition.尚未接线.push({component:'合法主动与移速施加',reason:'保留成熟自身2秒移速效果，尚不单独启动省略解控的完整水银过程；需核对受控制时允许主动与浮空期间不可主动的门槛。'});
  x.arithmetic.push({sample:'90秒主动冷却',expected:90000,actual:cd*1000,match:cd*1000===90000},{sample:'50%移速按比例存储',expected:.5,actual:ratio,match:ratio===.5},{sample:'2秒移速时长',expected:2000,actual:duration*1000,match:duration*1000===2000});objects.push(x);
 }
 {
  const o=source.objects.find(o=>o.id===3044),x=base(o,'passive',o.name+'·狂怒','当前绑定攻击单位后获得2秒移速：近战20点、远程10点。保留两个独立分支，来源近远程选择尚未接线，不复制三相之力无条件20点规则。');const amount=data(o,'MoveSpeedBonus'),ratio=data(o,'RangedMod'),duration=data(o,'MoveSpeedDuration'),calc=o.object.mItemCalculations.MSBonusSplit;assert.equal(amount,20);assert.equal(ratio,.5);assert.equal(duration,2);assert.equal(calc.mRangedMultiplier.mDataValue,'RangedMod');assert.equal(calc.mFormulaParts[0].mDataValue,'MoveSpeedBonus');
  x.apiPayload.parameters=[parameter('melee_move_speed_bonus','近战攻击后固定移速',amount,'当前MSBonusSplit基础值引用MoveSpeedBonus=20。',10),parameter('ranged_multiplier','远程移速倍率',ratio,'当前MSBonusSplit.mRangedMultiplier引用RangedMod=0.5。',20),parameter('move_speed_duration_ms','狂怒移速持续时间',duration*1000,'当前MoveSpeedDuration=2秒，换算2000毫秒。',30)];
  x.apiPayload.formulas=[{formulaKey:'ranged_move_speed_bonus',name:'远程攻击后固定移速',description:'20点基础值×0.5远程倍率=10点；来源类型选择另配。',sortOrder:10,expression:{nodeType:'OPERATION',operation:'MULTIPLY',operands:[pn('melee_move_speed_bonus'),pn('ranged_multiplier')]}}];
  x.apiPayload.effects=[speedEffect('melee_move_speed','近战狂怒移动速度','move_speed',parameterValue('melee_move_speed_bonus'),'仅近战来源实际攻击单位后选择此分支，20点固定移速持续2秒。'),speedEffect('ranged_move_speed','远程狂怒移动速度','move_speed',fval('ranged_move_speed_bonus'),'仅远程来源实际攻击单位后选择此分支，10点固定移速持续2秒。',20)];
  x.proofs.push({source:o.path+'/mItemCalculations.MSBonusSplit',tree:calc,values:{melee:amount,ranged:amount*ratio,durationMs:duration*1000},currentText:o.bound.keyTooltipInventory});
  x.disposition.尚未接线.push({component:'来源近远程分类和互斥选择',reason:'当前实际攻击命中事件可沿3078成熟来源，但还需合法来源近远程条件。不能按攻击距离数值猜近远程，也不能无条件应用20点或同时叠加20与10点。'});
  x.arithmetic.push({sample:'近战分支固定移速',expected:20,actual:amount,match:amount===20},{sample:'远程分支固定移速',expected:10,actual:amount*ratio,match:amount*ratio===10},{sample:'移速时长',expected:2000,actual:duration*1000,match:duration*1000===2000},{sample:'尚未选择来源类型时不写无条件攻击规则',expected:0,actual:x.apiPayload.triggerRules.length,match:x.apiPayload.triggerRules.length===0});objects.push(x);
 }
 return objects;
}
