import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
if(process.argv.length!==2)throw new Error('只生成候选，不执行业务请求');
const here=path.dirname(fileURLToPath(import.meta.url));
const inventory=JSON.parse(fs.readFileSync(path.join(here,'逐项机器清单.json'),'utf8'));
const current=JSON.parse(fs.readFileSync(path.join(here,'当前目录.json'),'utf8'));
const attrs=new Map(current.records.find(x=>x.route==='/attributes').data.items.map(x=>[x.attributeKey,x]));
const sourceById=new Map(inventory.entries.map(x=>[x.id,x]));
const P=parameterKey=>({nodeType:'PARAMETER',parameterKey});
const A=(attributeKey,attributeValueKind='TOTAL')=>({nodeType:'ATTRIBUTE',attributeOwner:'SOURCE',attributeKey,attributeValueKind});
const O=(operation,left,right)=>({nodeType:'OPERATION',operation,operands:[left,right]});
const add=(a,b)=>O('ADD',a,b),mul=(a,b)=>O('MULTIPLY',a,b);
const fixed=value=>({kind:'FIXED',value}),pv=parameterKey=>({kind:'PARAMETER',parameterKey}),fv=formulaKey=>({kind:'FORMULA',formulaKey});
const rule=value=>({value,fixedMultiplier:1,fixedMinValue:0,fixedMaxValue:null});
function param(parameterKey,name,value,description,sortOrder=10){return{parameterKey,name,valueType:Number.isInteger(value)?'INTEGER':'DECIMAL',valueMode:'FIXED',fixedValue:value,levelValues:null,description,sortOrder};}
function formula(formulaKey,name,expression,description){return{formulaKey,name,description,sortOrder:10,expression};}
const life=durationValue=>({durationValue,maxStacksValue:fixed(1),applicationStacksValue:fixed(1),instanceScope:'SOURCE',reapplicationStackMode:'KEEP',reapplicationDurationMode:durationValue?'REFRESH_ALL':null,expiryMode:durationValue?'ALL_AT_ONCE':'EXPLICIT_ONLY',periodicIntervalValue:null,firstPeriodicExecution:null});
const behavior=dynamic=>({moment:'PERSISTENT',valueReadMode:dynamic?'MOMENT_EVALUATION':'APPLICATION_SNAPSHOT',stackValueMode:'SHARED',reapplicationValueMode:dynamic?null:'REPLACE',periodicExecutionMode:null});
function attributeEffect(effectKey,name,attributeKey,value,{duration=null,dynamic=false}={}){assert.equal(attrs.get(attributeKey)?.status,'ENABLED');return{effectKey,name,description:'仅包含本候选注明的独立属性组成，触发按候选边界另行核对。',sortOrder:10,lifecycle:life(duration),results:[{resultKey:'attribute_bonus',name,description:null,sortOrder:10,resultType:'ATTRIBUTE_CHANGE',target:'SOURCE',lifecycleBehavior:behavior(dynamic),spellShieldBlockScope:null,valueRule:rule(value),detail:{attributeKey,operation:'INCREASE',modifierZoneKey:'attribute_flat_add'}}]};}
function immediate(effectKey,name,resultType,value,detail={},target='SOURCE'){return{effectKey,name,description:'独立数值结果；没有自动初始化或命中/击杀触发规则。',sortOrder:10,lifecycle:null,results:[{resultKey:'result',name,description:null,sortOrder:10,resultType,target,lifecycleBehavior:null,spellShieldBlockScope:null,valueRule:rule(value),detail}]};}
function initialize(effectKey,name){return{ruleKey:'initialize_'+effectKey,name:'初始化'+name,description:'只初始化此来源明确无条件的属性组成，未包含其他有条件分支。',sortOrder:10,eventSource:{eventType:'SOURCE_INITIALIZED',detail:{}},conditionGroups:[],actions:[{actionKey:'execute_'+effectKey,name:'建立'+name,actionType:'EXECUTE_EFFECT',targetContext:'EVENT_SOURCE',sortOrder:10,detail:{effectKey},runtimeInputBindings:[],resultModifiers:[]}],perTargetCooldown:null,maxTriggersPerProcess:null};}
const proposals=[];
function base(id,scope){const row=sourceById.get(id);assert(row&&row.scope!=='范围外');const item={id,runeKey:row.runeKey,skillKey:row.skillKey,name:row.name,scope,sourceReferences:row.sourceReferences,remainingFacts:row.missingFacts,stage:'可审查组成候选，未写入',parameters:[],formulas:[],effects:[],triggerRules:[],notIncluded:[],checks:[]};proposals.push(item);return item;}
{
 const x=base(9104,'先录无条件3%额外攻速；保留每层系数和层数上限参数');
 x.parameters=[param('base_attack_speed_ratio','基础额外攻速比例',.03,'官方明确获得3%攻击速度'),param('attack_speed_ratio_per_stack','每传奇层额外攻速比例',.015,'官方每层1.5%'),param('maximum_legend_stacks','传奇层数上限',10,'官方最大层数10')];
 x.effects=[attributeEffect('base_attack_speed','欢欣基础攻速','bonus_attack_speed_percent',pv('base_attack_speed_ratio'))];x.triggerRules=[initialize('base_attack_speed','欢欣基础攻速')];
 x.notIncluded=['不预设传奇层数为10；英雄/野怪/小兵进度权重与累计生产未连接。'];x.checks=[{expression:'0.20 + 0.03',expected:.23}];
}
{
 const x=base(8210,'先录来源明确5级/8级断点急速；不录11级剩余冷却返还');
 const values=Object.fromEntries(Array.from({length:18},(_,i)=>[String(i+1),i+1<5?0:i+1<8?5:10]));
 x.parameters=[{parameterKey:'level_ability_haste',name:'超然等级技能急速',valueType:'INTEGER',valueMode:'CHARACTER_LEVEL',fixedValue:null,levelValues:values,description:'明确断点：5级+5、8级再+5；不是从等级端点插值。',sortOrder:10},param('remaining_cooldown_refund_ratio','11级击杀剩余冷却返还比例',.20,'只保留比例，不把总冷却或固定毫秒当剩余冷却')];
 x.effects=[attributeEffect('level_ability_haste','超然等级急速','ability_haste',pv('level_ability_haste'),{dynamic:true})];x.triggerRules=[initialize('level_ability_haste','超然等级急速')];
 x.notIncluded=['11级门槛、参与击杀及每个基础技能当前剩余冷却仍待接；当前时点读等级的运行效果未验。'];x.checks=[{levels:[1,4,5,7,8,18],expected:[0,0,5,5,10,10]}];
}
{
 const x=base(8453,'先录无条件5%治疗与护盾强度；低生命分支只留参数');
 x.parameters=[param('base_heal_shield_power_ratio','基础治疗护盾强度比例',.05,'官方获得5%治疗和护盾强度'),param('low_health_threshold','低生命比例阈值',.4,'低于40%'),param('low_health_amplification_ratio','低生命额外增强比例',.10,'施放或获得方向需另核')];
 x.effects=[attributeEffect('base_heal_shield_power','复苏基础强度','heal_shield_power_percent',pv('base_heal_shield_power_ratio'))];x.triggerRules=[initialize('base_heal_shield_power','复苏基础强度')];
 x.notIncluded=['不把低生命10%加成全写入施放者属性；不模拟队友治疗护盾；当前治疗修正区及收到护盾增强结构仍缺。'];x.checks=[{expression:'已有强度0.10 + 基础0.05',expected:.15}];
}
{
 const x=base(9111,'保存完整治疗数值公式与独立自身治疗，不自动触发');
 x.parameters=[param('missing_health_ratio','已损生命治疗比例',.05,'5%已损失生命值'),param('maximum_health_ratio','最大生命治疗比例',.025,'2.5%最大生命值')];
 x.formulas=[formula('triumph_heal','凯旋治疗值',add(mul(A('hp','MISSING'),P('missing_health_ratio')),mul(A('hp'),P('maximum_health_ratio'))),'最大生命与已损生命来自SOURCE不同属性视图')];
 x.effects=[immediate('triumph_heal','凯旋独立治疗','DIRECT_HEAL',fv('triumph_heal'))];
 x.notIncluded=['金币全部排除；参与击杀回调、延迟及去重未配，不用SOURCE_INITIALIZED治疗。'];x.checks=[{attributes:{maximumHealth:2000,currentHealth:500},expression:'1500×0.05 + 2000×0.025',expected:125},{attributes:{maximumHealth:2000,currentHealth:2000},expression:'0×0.05 + 2000×0.025',expected:50}];
}
{
 const x=base(8009,'独立记录6能量和两种最大资源15%恢复分支，不同时应用');
 x.parameters=[param('damage_energy_restore','伤害英雄能量恢复',6,'法力6–50缺曲线，但能量固定6'),param('damage_restore_cooldown_ms','伤害恢复冷却',8000,'8秒'),param('ranged_mana_ratio','远程法力恢复效能',.8,'远程法力80%，不扩到能量'),param('takedown_resource_ratio','击杀最大资源恢复比例',.15,'15%最大法力或能量')];
 x.formulas=[formula('takedown_mana_restore','最大法力恢复',mul(A('mana'),P('takedown_resource_ratio')),'只在明确法力来源的参与击杀分支使用'),formula('takedown_energy_restore','最大能量恢复',mul(A('energy'),P('takedown_resource_ratio')),'只在明确能量来源的参与击杀分支使用')];
 x.effects=[immediate('damage_energy_restore','伤害英雄固定能量恢复','RESOURCE_CHANGE',pv('damage_energy_restore'),{attributeKey:'energy',operation:'RESTORE'}),immediate('takedown_mana_restore','击杀最大法力恢复','RESOURCE_CHANGE',fv('takedown_mana_restore'),{attributeKey:'mana',operation:'RESTORE'}),immediate('takedown_energy_restore','击杀最大能量恢复','RESOURCE_CHANGE',fv('takedown_energy_restore'),{attributeKey:'energy',operation:'RESTORE'})];
 x.notIncluded=['法力逐等级表待核；角色资源选择、伤害去重与参与击杀事件未连接。'];x.checks=[{expression:'最大法力1000×0.15',expected:150},{expression:'最大能量200×0.15',expected:30}];
}
{
 const x=base(8226,'保存法力层数参数与满层回复公式/独立资源效果，先不挂周期');
 x.parameters=[param('mana_per_stack','每次永久法力',25,'每合法技能命中英雄提升25'),param('maximum_bonus_mana','额外法力上限',250,'官方上限250'),param('maximum_stacks','推导的合法提升次数',10,'250/25=10，不把它当已经拥有10层'),param('hit_cooldown_ms','命中加法力冷却',15000,'15秒'),param('restore_period_ms','满层恢复间隔',5000,'每5秒'),param('missing_mana_restore_ratio','已损法力恢复比例',.01,'满层后恢复1%已损法力')];
 x.formulas=[formula('missing_mana_restore','已损法力恢复',mul(A('mana','MISSING'),P('missing_mana_restore_ratio')),'读取SOURCE当前已损法力')];
 x.effects=[immediate('missing_mana_restore','法力流独立恢复','RESOURCE_CHANGE',fv('missing_mana_restore'),{attributeKey:'mana',operation:'RESTORE'})];
 x.notIncluded=['未设定满层首跳IMMEDIATE或AFTER_INTERVAL；不在未满层时初始化恢复；未生成永久法力叠层生产。'];x.checks=[{expression:'(1000最大-400当前)×0.01',expected:6},{expression:'250/25',expected:10}];
}
{
 const x=base(8437,'保存近远程完整伤害/治疗公式及独立治疗；伤害暴击/吸血元数据未确证，仅公式不落DAMAGE结果');
 x.parameters=[param('maximum_health_damage_ratio','最大生命魔法伤害比例',.035,'3.5%最大生命'),param('maximum_health_heal_ratio','最大生命治疗比例',.013,'1.3%最大生命'),param('ranged_efficiency','远程收益效能',.4,'远程伤害、治疗、永久生命均40%'),param('permanent_health_per_melee_proc','近战永久生命增长',5,'近战每次5'),param('combat_charge_ms','战斗就绪间隔',4000,'战斗中每4秒')];
 for(const [kind,ratio] of [['damage','maximum_health_damage_ratio'],['heal','maximum_health_heal_ratio']])for(const ranged of [false,true]){const key=(ranged?'ranged_':'melee_')+kind;const amount=mul(A('hp'),P(ratio));x.formulas.push(formula(key,(ranged?'远程':'近战')+'不灭'+kind,ranged?mul(amount,P('ranged_efficiency')):amount,'仅选择一个来源类型分支；无自适应转换'));if(kind==='heal')x.effects.push(immediate(key,key,'DIRECT_HEAL',fv(key)));}
 x.notIncluded=['不能同时执行近战/远程分支；计时、就绪消费、攻击附带包继承、暴击及吸血例外未确证，因此伤害只保存公式，不带默认DAMAGE元数据。','永久生命增长不虚构一个任意最大层数；效果结果不代表已经连到普攻。'];
 x.checks=[{expression:'2000×0.035',expected:70},{expression:'2000×0.013',expected:26},{expression:'70×0.4',expected:28},{expression:'26×0.4',expected:10.4},{expression:'5×0.4',expected:2}];
}
{
 const x=base(8351,'只保存明确减速比例公式和时间参数，不创建减速状态或自身减伤');
 x.parameters=[param('base_slow_ratio','基础减速比例',.20,'20%'),param('heal_shield_power_coefficient','治疗护盾强度系数',.90,'每100%治疗护盾强度增加90%减速'),param('ability_power_coefficient','每点法强减速比例',.0006,'每100法强6%'),param('bonus_attack_damage_coefficient','每点额外攻击力减速比例',.0007,'每100额外攻击力7%'),param('base_duration_ms','基础霜冻时长',3000,'3秒+定身时长，暂只记录3秒'),param('cooldown_ms','冷却',25000,'25秒')];
 x.formulas=[formula('glacial_slow_ratio','冰川减速比例',add(add(P('base_slow_ratio'),mul(A('heal_shield_power_percent'),P('heal_shield_power_coefficient'))),add(mul(A('ability_power'),P('ability_power_coefficient')),mul(A('attack_damage','BONUS'),P('bonus_attack_damage_coefficient')))),'数值公式不是已经实现减速，也未声称没有上限或无需目标区域判断')];
 x.notIncluded=['不保存15%队友减伤；无完整减速语义/区/合法状态；定身实际时长输入和减速最终上限/组合待核。'];x.checks=[{attributes:{healShieldPowerRatio:.2,abilityPower:100,bonusAttackDamage:50},expression:'0.20+0.90×0.20+0.0006×100+0.0007×50',expected:.475}];
}
{
 const x=base(8313,'保留原力合剂和技能合剂确定参数；不录贪财战斗分支');
 x.parameters=[param('force_elixir_grant_level','原力合剂获得等级',6,'符文原文6级'),param('force_elixir_adaptive_force','原力合剂适应之力',25,'官方装备2152'),param('force_elixir_duration_ms','原力合剂持续时间',60000,'官方2152持续60秒'),param('skill_elixir_grant_level','技能合剂获得等级',9,'符文原文9级'),param('skill_elixir_skill_points','技能合剂技能点',1,'官方2150不提升等级且不能投给已满级技能')];
 x.notIncluded=['没有经验或角色升级效果；不猜25适应之力=15攻击力；不重复建立已存在2150/2152装备或把持有等同已消耗。'];x.checks=[{expression:'60秒×1000',expected:60000},{expression:'技能点1不等于角色等级+1',expectedSkillPoints:1,expectedCharacterLevelChange:0}];
}
{
 const x=base(8242,'只准备控制已确认结束后的2秒双抗组成，控制期间另接');
 x.parameters=[param('armor_bonus','护甲加成',10,'被控制时和之后2秒获得10护甲'),param('magic_resistance_bonus','魔抗加成',10,'同条件10魔抗'),param('after_control_duration_ms','控制结束后的持续时间',2000,'只用于结束后部分，不从受控开始计时')];
 x.effects=[attributeEffect('after_control_armor','控制结束后护甲','armor',pv('armor_bonus'),{duration:pv('after_control_duration_ms')}),attributeEffect('after_control_magic_resistance','控制结束后魔抗','magic_resistance',pv('magic_resistance_bonus'),{duration:pv('after_control_duration_ms')})];
 x.notIncluded=['控制期间覆盖与多个控制衔接未连；不能CONTROL_RECEIVED后只开2秒冒充完整坚定。'];x.checks=[{expression:'已有护甲60+10',expected:70},{expression:'已有魔抗40+10',expected:50}];
}
{
 const x=base(9103,'只保存生命偷取每层系数、满层生命及上限；不建立层数生产');
 x.parameters=[param('life_steal_ratio_per_stack','每层生命偷取比例',.0045,'0.45%每层'),param('maximum_legend_stacks','传奇层数上限',15,'上限15'),param('full_stack_health_bonus','满层最大生命',85,'满层才提供85生命')];
 x.notIncluded=['不在初始化时授予15层或85生命；保留野怪小兵历史成长依赖；当前层数未核实，不先创任意RUNTIME_INPUT默认值。'];x.checks=[{expression:'15×0.0045',expected:.0675},{expression:'14层时满层85生命不成立',expectedHealthBonus:0}];
}
{
 const x=base(8128,'保存黑暗收割完整伤害数值公式，灵魂输入未接线且不创建适应伤害结果');
 x.parameters=[param('base_damage','固定基础伤害',30,'官方基础30，无等级曲线'),param('damage_per_soul','每灵魂伤害',11,'每灵魂+11'),param('bonus_attack_damage_ratio','额外攻击力系数',.10,'官方0.1额外攻击力'),param('ability_power_ratio','法强系数',.05,'官方0.05法强'),param('target_health_threshold','目标生命阈值',.5,'严格低于50%'),param('cooldown_ms','通常冷却',35000,'35秒'),param('takedown_cooldown_ms','参与击杀后冷却',1000,'重置到1秒'),{parameterKey:'confirmed_souls',name:'已确认灵魂数量输入',valueType:'INTEGER',valueMode:'RUNTIME_INPUT',fixedValue:null,levelValues:null,description:'必须由已核实灵魂状态绑定，不设默认数值，不在本批伪造生产规则。',sortOrder:20}];
 x.formulas=[formula('harvest_damage','黑暗收割伤害数值',add(add(P('base_damage'),mul(P('damage_per_soul'),P('confirmed_souls'))),add(mul(A('attack_damage','BONUS'),P('bonus_attack_damage_ratio')),mul(A('ability_power'),P('ability_power_ratio')))),'运行输入尚未绑定，只保存可审查公式，不用于持续动态读取')];
 x.notIncluded=['自适应伤害类型与本次收割先后次序待核；灵魂输入没有自动绑定，不声称触发可用。'];x.checks=[{inputs:{souls:4,bonusAttackDamage:100,abilityPower:200},expression:'30+11×4+0.1×100+0.05×200',expected:94}];
}
assert.equal(proposals.length,12);assert.equal(new Set(proposals.map(x=>x.runeKey)).size,12);
const qualifications=new Map([
 [9104,{eligible:'明确携带且启用此符文来源时仅授予基础3%攻速。',requiredInputs:['符文来源装配'],notDefaulted:['传奇层数','击杀对象权重']}],
 [8210,{eligible:'明确携带此符文，按实际角色等级读取明确断点；11级返还分支未启用。',requiredInputs:['实际角色等级','符文来源装配'],notDefaulted:['18级','参与击杀事件','技能当前剩余冷却']}],
 [8453,{eligible:'只授予持有者基础治疗护盾强度属性，不发起治疗，不启用低生命增强分支。',requiredInputs:['符文来源装配','后续实际治疗/护盾结果资格'],notDefaulted:['低生命成立','施放与获得方向','队友目标']}],
 [9111,{eligible:'仅作为已核准参与击杀后的独立治疗候选；原文中的参与击杀对象资格、助攻及准确时点仍待补证，不等同任何KILL事件。',requiredInputs:['SOURCE hp TOTAL最大生命','SOURCE hp CURRENT当前生命并据此形成MISSING','合法参与击杀及治疗时点'],notDefaulted:['满血','所有目标击杀均合格','零延迟','自动触发']}],
 [8009,{eligible:'固定6能量仅属于伤害敌方英雄的合法能量来源；15%分支仅属于已核准参与击杀且按角色实际资源二选一。',requiredInputs:['角色资源身份','SOURCE mana或energy TOTAL最大值','当前资源值','伤害目标英雄资格或参与击杀资格'],notDefaulted:['同时恢复法力和能量','缺失资源身份时选能量','当前资源已空','所有伤害都能触发']}],
 [8226,{eligible:'恢复仅在本符文累计额外法力达到250之后，且合法5秒周期到达时使用；不以总法力超过250判定满层。',requiredInputs:['本符文累计额外法力/层数','SOURCE mana TOTAL和CURRENT','满层周期时点'],notDefaulted:['已经10层','基础法力计入符文层数','满层立即首跳','已损法力为最大法力']}],
 [8437,{eligible:'只在战斗计时就绪后的下一次对英雄普攻满足条件时选择对应近战或远程治疗；本候选没有该自动触发。',requiredInputs:['SOURCE hp TOTAL最大生命','SOURCE hp CURRENT用于实际治疗上限','角色明确近战/远程身份','战斗就绪和合法英雄普攻'],notDefaulted:['选择近战','两个分支同时执行','每次普攻都就绪','永久生命已经累计']}],
 [8351,{eligible:'减速公式只属于合法定身敌方英雄产生的霜冻分支；公式结果不代表区域内目标已获得减速。',requiredInputs:['合法定身来源和实际时长','SOURCE治疗护盾强度TOTAL','SOURCE法强TOTAL','SOURCE攻击力BONUS','霜冻有效目标'],notDefaulted:['所有控制都是定身','定身时长0','所有敌人都处于区域','减速计算区']}],
 [8313,{eligible:'先获得对应药剂再合法消耗；技能点与原力分支互不替代。',requiredInputs:['实际药剂持有和单次消耗','技能等级及可分配点数规则','适应之力选择与转换'],notDefaulted:['持有即消耗','25适应等于15攻击力','角色等级+1','对已满技能投入']}],
 [8242,{eligible:'两个限时效果仅用于已确认控制结束后部分，不能在控制开始时启动2秒并宣称覆盖全部效果。',requiredInputs:['完整控制资格','控制实际结束时点','重叠控制和续期规则'],notDefaulted:['所有控制都等于眩晕','控制持续时间0','控制开始即结束']}],
 [9103,{eligible:'只有确定参数；需要真实传奇进度和层数才能授予分层偷取或满层生命。',requiredInputs:['已确认传奇层数和其来源','满层判定'],notDefaulted:['初始15层','无条件85生命','击杀小兵进度被丢弃']}],
 [8128,{eligible:'公式需要已确认灵魂数输入；目标低于50%、合法伤害和冷却门槛均未自动连接。',requiredInputs:['实际灵魂数','SOURCE额外攻击力BONUS和法强TOTAL','目标生命比例及采样时点','合法伤害与冷却资格'],notDefaulted:['初始灵魂0或最大值','本次收割前后顺序','当前模板显示物理就固定物理伤害']}]
]);
for(const x of proposals){
 const keys=new Set(x.parameters.map(p=>p.parameterKey));
 const formulaKeys=new Set(x.formulas.map(f=>f.formulaKey));
 function visit(node){if(node.nodeType==='PARAMETER')assert(keys.has(node.parameterKey));else if(node.nodeType==='ATTRIBUTE')assert(attrs.has(node.attributeKey));else{assert.equal(node.operands.length,2);node.operands.forEach(visit);}}
 x.formulas.forEach(f=>visit(f.expression));
 for(const e of x.effects)for(const r of e.results){const value=r.valueRule.value;if(value.kind==='PARAMETER')assert(keys.has(value.parameterKey));if(value.kind==='FORMULA')assert(formulaKeys.has(value.formulaKey));}
 x.triggerRules.forEach(r=>r.actions.forEach(a=>assert(x.effects.some(e=>e.effectKey===a.detail.effectKey))));
 x.skillBody={skillKey:x.skillKey,name:`符文·${x.name}`,description:`本批仅录入：${x.scope}。其他分支见候选剩余事实，未代表完整符文机制。`,maxLevel:1,status:'ENABLED',sortOrder:0,skillCategoryKeys:['passive']};
 x.relationBody={runeKey:x.runeKey,skillKey:x.skillKey,sortOrder:0};
 x.stage=x.effects.length?'参数/公式及独立效果候选':'确定参数/公式候选';
 x.executionQualification=qualifications.get(x.id);
 x.numericResultMeaning='公式值和结果valueRule表示配置数值，不是已按当前生命/资源上限结算的实际恢复量。';
}
const counts={selected:12,parameters:proposals.reduce((n,x)=>n+x.parameters.length,0),formulas:proposals.reduce((n,x)=>n+x.formulas.length,0),effects:proposals.reduce((n,x)=>n+x.effects.length,0),initializationRules:proposals.reduce((n,x)=>n+x.triggerRules.length,0),completeRuneMechanisms:0,businessWrites:0};
fs.writeFileSync(path.join(here,'下一批最多12项.json'),JSON.stringify({status:'待主负责人选择与页面验证，只有本地候选',counts,proposals,contractBoundary:'有效字段沿现行技能参数/公式/效果/触发契约。所有数值以冻结来源为据；技能主体和挂载由执行时查重确认。不存在默认满层、玩家符文选择或未核实的伤害乘区。'},null,2)+'\n');
console.log(JSON.stringify(counts,null,2));
