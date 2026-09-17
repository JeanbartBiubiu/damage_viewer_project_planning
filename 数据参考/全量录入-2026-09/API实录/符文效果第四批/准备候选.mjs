import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import zlib from 'node:zlib';import {fileURLToPath} from 'node:url';
if(process.argv.length!==2)throw Error('只生成候选，没有业务写入口');
const here=path.dirname(fileURLToPath(import.meta.url)),base=path.dirname(here),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),save=(name,x)=>fs.writeFileSync(path.join(here,name),JSON.stringify(x,null,2)+'\n',{flag:'wx'});
assert(!fs.existsSync(path.join(here,'可审查请求.json')),'已有候选不覆盖');
const frozenBytes=fs.readFileSync(path.join(here,'冻结来源.json'));assert.equal(sha(frozenBytes),'91f4d81e86bc07e1c294afc0ad5e300db4b476b2f3fd7728fa6eb1e7cfc5fb5b');
const frozen=JSON.parse(frozenBytes),byId=new Map(frozen.entries.map(e=>[e.id,e])),raw=zlib.gunzipSync(fs.readFileSync(path.join(base,'符文客户端数值补证/perks-16.17.cdtb.bin.json.gz')));assert.equal(sha(raw),frozen.rawSha256);const originals=JSON.parse(raw);for(const e of byId.values()){assert.deepEqual(e.object,originals[e.sourcePath]);assert.equal(sha(JSON.stringify(e.object)),e.sourceObjectSha256);}
const P=parameterKey=>({nodeType:'PARAMETER',parameterKey});
const A=(attributeOwner,attributeKey,attributeValueKind)=>({nodeType:'ATTRIBUTE',attributeOwner,attributeKey,attributeValueKind});
const O=(operation,a,b)=>({nodeType:'OPERATION',operation,operands:[a,b]});
const add=(a,b)=>O('ADD',a,b),mul=(a,b)=>O('MULTIPLY',a,b),sub=(a,b)=>O('SUBTRACT',a,b);
const fixed=value=>({kind:'FIXED',value});
const proposals=[];
function proposal(id,scopeText){const e=byId.get(id);const x={id,runeKey:`rune_${id}`,skillKey:`rune_${id}_passive`,name:e.name,scope:scopeText,sourcePath:e.sourcePath,sourceObjectSha256:e.sourceObjectSha256,parameters:[],formulas:[],effects:[],triggerRules:[],processes:[],internalStates:[],parameterEvidence:[],pending:[],excluded:[],qualification:{required:[],notDefaulted:[]}};proposals.push(x);return x;}
function parameter(x,key,name,value,description,{field,scale=1,category='来源确定',runtime=false,type}={}){
 const sourceValues=byId.get(x.id).object.mScript.mSpellScriptData.mEffectAmount;
 if(field){assert.ok(Object.hasOwn(sourceValues,field),`${x.id}/${field}`);assert.ok(Math.abs(sourceValues[field]*scale-value)<Math.max(1e-6,Math.abs(value)*1e-7),`${x.id}/${field} numeric`);}
 x.parameters.push({parameterKey:key,name,valueType:type||(runtime?'DECIMAL':Number.isInteger(value)?'INTEGER':'DECIMAL'),valueMode:runtime?'RUNTIME_INPUT':'FIXED',fixedValue:runtime?null:value,levelValues:null,description,sortOrder:(x.parameters.length+1)*10});
 x.parameterEvidence.push({parameterKey:key,category,sourcePath:field?`${x.sourcePath}/mScript/mSpellScriptData/mEffectAmount/${field}`:null,sourceRawValue:field?sourceValues[field]:null,scale,normalization:field&&sourceValues[field]*scale!==value?'同版本绑定说明的可读数值；仅清除float32尾差，容差1e-7相对值':null,defaultSupplied:!runtime});
}
const runtime=(x,key,name,description,type='DECIMAL')=>parameter(x,key,name,null,description,{runtime:true,type,category:'未接线输入'});
function formula(x,key,name,expression,description){x.formulas.push({formulaKey:key,name,description,sortOrder:(x.formulas.length+1)*10,expression});}
function pending(x,type,reason,needed){x.pending.push({type,reason,needed});}
function fixedAttribute(x,key,name,attr,param,description){
 x.effects.push({effectKey:key,name,description,sortOrder:(x.effects.length+1)*10,lifecycle:{durationValue:null,maxStacksValue:fixed(1),applicationStacksValue:fixed(1),instanceScope:'SOURCE',reapplicationStackMode:'KEEP',reapplicationDurationMode:null,expiryMode:'EXPLICIT_ONLY',periodicIntervalValue:null,firstPeriodicExecution:null},results:[{resultKey:'attribute_bonus',name,description:null,sortOrder:10,resultType:'ATTRIBUTE_CHANGE',target:'SOURCE',lifecycleBehavior:{moment:'PERSISTENT',valueReadMode:'APPLICATION_SNAPSHOT',stackValueMode:'SHARED',reapplicationValueMode:'REPLACE',periodicExecutionMode:null},spellShieldBlockScope:null,valueRule:{value:{kind:'PARAMETER',parameterKey:param},fixedMultiplier:1,fixedMinValue:0,fixedMaxValue:null},detail:{attributeKey:attr,operation:'INCREASE',modifierZoneKey:'attribute_flat_add'}}]});
}
const direct=(x,key,name,value,field,scale=1,description='当前普通模式绑定数值。')=>parameter(x,key,name,value,description,{field,scale});
function curve(x,key,label,start,end,fieldStart,fieldEnd){
 direct(x,key+'_source_start',label+'来源起点',start,fieldStart,1,'仅保留当前来源起点，不凭端点生成1至18级表。');direct(x,key+'_source_end',label+'来源终点',end,fieldEnd,1,'仅保留当前来源终点；等级求值过程待补。');
 runtime(x,key,'已确认'+label,'应由当前等级的已核实来源供值；没有默认值，不按1至18级线性猜算。');pending(x,'来源',label+'曲线起止等级、选项、取整及断点求值未完整证实','同构建的完整求值依据；本批显式外供数值');
}
function damageFormula(x,key,base,apField,adField,apValue,adValue,label='伤害数值'){
 let expression=P(base);if(apField){direct(x,'ability_power_ratio','法术强度系数',apValue,apField);expression=add(expression,mul(A('SOURCE','ability_power','TOTAL'),P('ability_power_ratio')));}
 if(adField){direct(x,'bonus_attack_damage_ratio','额外攻击力系数',adValue,adField);expression=add(expression,mul(A('SOURCE','attack_damage','BONUS'),P('bonus_attack_damage_ratio')));}
 formula(x,key,label,expression,'对应当前绑定计算树；等级基础值须明确外供。法强与额外攻击力直接读取来源属性，不填虚构值。');
}
function qualify(x,required,reason){x.qualification.required=required;x.qualification.notDefaulted=['未满足资格也生效','来源创建后自动触发','未知等级数值默认为0'];pending(x,'未接线',reason,'核实触发资格、取值时点和对象归属后装配');}
{
 const x=proposal(8112,'电刑等级基础值、双属性系数和三次独立命中条件；伤害类型选择与事件未连接');curve(x,'confirmed_level_base','等级基础伤害',70,240,'DamageBase','DamageMax');damageFormula(x,'damage_amount','confirmed_level_base','APRatio','BonusADRatio',.05,.1);
 direct(x,'cooldown_ms','冷却时间',20000,'Cooldown',1000);direct(x,'hit_window_ms','独立命中窗口',3000,'WindowDuration',1000);parameter(x,'required_unique_hits','所需独立命中次数',3,'当前绑定明确3个独立攻击或技能。',{category:'当前绑定正文'});
 qualify(x,['3秒内3个独立攻击或技能命中同一英雄','冷却可用','自适应伤害类型已确定'],'独立命中去重、窗口维护及自适应类型未连接');
}
{
 const x=proposal(8126,'恶意中伤等级真实伤害数值与冷却；控制资格未连接');curve(x,'confirmed_level_base','等级基础伤害',10,45,'DamageIncMin','DamageIncMax');damageFormula(x,'damage_amount','confirmed_level_base');direct(x,'cooldown_ms','冷却时间',4000,'Cooldown',1000);qualify(x,['目标英雄移动或行动受损','在移动受损之后触发','冷却可用'],'状态全集和先控制后伤害的判定尚未连接');
}
{
 const x=proposal(8139,'血之滋味恢复数值和20秒冷却；恢复时序待证');curve(x,'confirmed_level_base','等级基础恢复',16,40,'HealAmount','HealAmountMax');damageFormula(x,'heal_amount','confirmed_level_base','APRatio','ADRatio',.05,.1,'自身恢复数值');direct(x,'cooldown_ms','冷却时间',20000,'Cooldown',1000);qualify(x,['伤害敌方英雄','冷却可用'],'恢复触发及采样时点未连接');pending(x,'来源','当前正文未绑定RegenDuration=4，不能确定瞬时或4秒持续恢复','当前治疗执行链');x.excluded.push({field:'RegenDuration',value:4,reason:'原字段保留资料，未取得当前消费证明，不生成持续参数或瞬时治疗效果'});
}
{
 const x=proposal(8143,'猛然冲击等级真实伤害数值与4秒待用窗口');curve(x,'confirmed_level_base','等级基础伤害',20,80,'MinDamageTooltip','MaxDamageTooltip');damageFormula(x,'damage_amount','confirmed_level_base');direct(x,'armed_window_ms','待用窗口',4000,'ArmedDuration',1000);direct(x,'cooldown_ms','冷却时间',10000,'Cooldown',1000);qualify(x,['合法突进、跃击、闪烁、传送或离开潜行','随后4秒内用普攻或技能伤害敌方英雄','冷却可用'],'待用资格授予、消费及冷却起点未连接');
}
{
 const x=proposal(9923,'丛刃近远程攻速比例、三次基础攻击、相邻攻击间隔和真实伤害数值；不默认选择分支');curve(x,'confirmed_level_base','等级基础伤害',2,20,'BonusDamageMin','BonusDamageMax');damageFormula(x,'damage_amount','confirmed_level_base','APRatio','BonusADRatio',.1,.12);
 direct(x,'base_attack_count','基础攻击次数',3,'NumHits');direct(x,'max_attack_gap_ms','相邻攻击最大间隔',3000,'Duration',1000,'约束相邻攻击间隔，不能作为整个增益3秒固定持续时间。');direct(x,'cooldown_ms','冷却时间',10000,'Cooldown',1000);direct(x,'melee_attack_speed_ratio','近战攻击速度比例',.9,'ASBoost');direct(x,'ranged_attack_speed_ratio','远程攻击速度比例',.6,'ASBoostRanged');direct(x,'max_bonus_reset_attacks','重置攻击额外次数上限',2,'MaxBonusHits',1,'原提示为重置普攻增加次数；该2不是覆盖基础3次的总上限。');parameter(x,'additional_attack_per_reset','每次普攻重置增加次数',1,'当前绑定明确普攻重置增加1次。',{category:'当前绑定正文'});
 qualify(x,['攻击敌方英雄','按真实近战或远程分支选择攻速','相邻攻击间隔不超过3秒','真实普攻重置进度'],'攻击计数、重置扩展及攻速上限临时突破未连接');pending(x,'来源','BonusDamage基础节点为未命名{ee18a47b}，不套已知插值算法','同构建节点求值证明');
}
{
 const x=proposal(8439,'余震双抗原始收益、等级封顶和爆发魔法伤害数值；属性取样及定身条件待连接');curve(x,'confirmed_level_damage','等级基础伤害',25,120,'StartingBaseDamage','MaxBaseDamage');curve(x,'confirmed_level_resist_cap','等级双抗封顶',80,150,'BonusResistMin','BonusResistMax');direct(x,'flat_resistance','固定双抗数值',45,'FlatResists');direct(x,'bonus_resistance_ratio','额外双抗系数',.75,'PercentBonusResist');direct(x,'bonus_health_damage_ratio','额外生命伤害系数',.08,'HealthRatio');direct(x,'resistance_duration_ms','双抗持续及爆发延迟',2500,'DelayBeforeBurst',1000);direct(x,'cooldown_ms','冷却时间',20000,'Cooldown',1000);
 for(const [key,label]of [['armor','护甲'],['magic_resistance','魔抗']])formula(x,key+'_bonus_amount',label+'封顶后增加数值',O('MIN',add(P('flat_resistance'),mul(A('SOURCE',key,'BONUS'),P('bonus_resistance_ratio'))),P('confirmed_level_resist_cap')),'当前绑定45+75%额外属性并受等级上限约束；仅在已核实的取样时点调用，不能反复读取自身已增加值形成自我叠加。');
 formula(x,'damage_amount','爆发魔法伤害数值',add(P('confirmed_level_damage'),mul(A('SOURCE','hp','BONUS'),P('bonus_health_damage_ratio'))),'当前具名文本和mStat12/formula2直接证明额外生命值口径；爆发时点取样仍待连接。');
 qualify(x,['自己定身敌方英雄','冷却可用','双抗2.5秒后爆发','独立核实属性取样时点'],'定身资格、双抗应用与到期爆发未连接');pending(x,'来源','额外双抗与生命值采样时点、重复定身和自身反馈处理未证','当前效果执行链');x.excluded.push({field:'DamageRadius',value:350,reason:'纯空间覆盖范围不录普通参数；不会因此删除对单一英雄的爆发伤害'});
}
{
 const x=proposal(9101,'吸收生命力击杀恢复的已确认等级数值；保留小兵野怪的战前恢复依赖');runtime(x,'confirmed_level_heal','已确认等级恢复量','源HealAmount为断点计算；缺完整断点当级和斜率规则，不凭端点1与23生成曲线。');formula(x,'heal_amount','击杀后自身恢复数值',P('confirmed_level_heal'),'显式等级输入，没有默认0，不把它当已连接治疗效果。');qualify(x,['实际击杀目标','合法击杀归属','已确认等级恢复量'],'击杀归属、战前恢复与治疗时序未连接');pending(x,'来源','初值1、初始斜率0.25及6/11级断点全文已冻结，但完整求值尚未证实','同构建断点求值算法');x.excluded.push({fields:['TooltipMinHeal','TooltipMaxHeal'],reason:'当前绑定只引用HealAmount；1与23留资料，不把未消费提示字段当已证明曲线'});
}
{
 const x=proposal(8233,'绝对专注70%生命严格门槛、适应之力与0.6攻击力换算数值');curve(x,'confirmed_adaptive_force','等级适应之力',3,30,'MinAdaptive','MaxAdaptive');direct(x,'health_threshold_ratio','生命门槛比例',.7,'HealthPercent');parameter(x,'adaptive_to_attack_damage_ratio','适应之力转攻击力系数',.6,'本对象当前长说明显式MinAdaptive乘0.6为攻击力；仅换算，不代替适应分支选择。',{category:'当前绑定具名表达式'});
 formula(x,'health_threshold','最大生命门槛数值',mul(A('SOURCE','hp','TOTAL'),P('health_threshold_ratio')),'必须严格高于70%，等于不满足。');formula(x,'attack_damage_amount','选攻击力时的数值',mul(P('confirmed_adaptive_force'),P('adaptive_to_attack_damage_ratio')),'仅已确定攻击力分支时计算，不同时授予法强和攻击力。');formula(x,'ability_power_amount','选法术强度时的数值',P('confirmed_adaptive_force'),'仅已确定法强分支时计算。');qualify(x,['当前生命严格高于70%最大生命','已核实适应之力选择规则'],'生命变化资格与适应属性选择、移除未连接');
}
{
 const x=proposal(8214,'艾黎敌方英雄伤害数值及返回前不可再派出的依赖');curve(x,'confirmed_level_base','等级基础伤害',10,50,'DamageBase','DamageMax');damageFormula(x,'damage_amount','confirmed_level_base','DamageAPRatio','DamageADRatio',.05,.1);qualify(x,['攻击或技能伤害敌方英雄','艾黎已经返回','自适应类型已确定'],'派出、返回及伤害资格未连接');x.excluded.push({branch:'给第三名友方英雄提供护盾',fields:['ShieldBase','ShieldMax','ShieldRatio','ShieldRatioAD','ShieldDuration','ShieldCalc'],reason:'第三者友方护盾不属于本轮1V1；敌方伤害和返回依赖仍保留'});
}
{
 const x=proposal(8229,'彗星等级伤害、冷却求值输入和750距离处100%增幅端点；不猜距离曲线');curve(x,'confirmed_level_base','等级基础伤害',15,100,'DamageBase','DamageMax');damageFormula(x,'base_damage_amount','confirmed_level_base','APRatio','ADRatio',.05,.1);curve(x,'confirmed_level_cooldown_seconds','等级冷却秒数',20,8,'RechargeTime','RechargeTimeMin');direct(x,'maximum_distance_damage_ratio','距离最大伤害增幅比例',1,'MaxDamageAmp');direct(x,'maximum_amplification_distance','最大增幅对应距离',750,'MaxRange',1,'距离直接影响伤害，应保留端点；不据此构造线性斜率。');
 parameter(x,'cooldown_floor_seconds','冷却原树下限秒数',.3,'当前CooldownCalc钳制节点mFloor=0.30000001192092896。',{category:'当前绑定计算树'});parameter(x,'seconds_to_ms','秒转毫秒系数',1000,'单位换算常数，不是游戏平衡数值。',{category:'单位换算'});
 formula(x,'cooldown_ms','钳制后冷却毫秒数',mul(O('MIN',P('confirmed_level_cooldown_seconds_source_start'),O('MAX',P('cooldown_floor_seconds'),P('confirmed_level_cooldown_seconds'))),P('seconds_to_ms')),'只保留当前原树MIN(20,MAX(0.3,明确外供秒数))再转换毫秒，不猜等级插值。');
 qualify(x,['技能伤害英雄','彗星实际命中该目标','距离采样和增幅求值已核实','冷却可用'],'发射、落点命中、距离增幅和自适应类型未连接');pending(x,'来源','750距离100%端点不足以证明中间曲线或距离采样时点','当前距离伤害求值');x.excluded.push({fields:['PercentRefund','DotPercentRefund','AoEPercentRefund'],reason:'当前绑定未提到伤害减少彗星冷却；保留原字段，不复活旧版返还机制'});
}
{
 const x=proposal(8237,'焦灼等级魔法伤害与1秒延迟；不按持续伤害拆跳');curve(x,'confirmed_level_base','等级基础伤害',20,40,'Damage','DamageMax');damageFormula(x,'damage_amount','confirmed_level_base');direct(x,'cooldown_ms','冷却时间',10000,'BurnlockoutDuration',1000);direct(x,'damage_delay_ms','命中后伤害延迟',1000,'DotDuration',1000,'当前中文绑定明确1秒后造成伤害，不是1秒内均匀持续伤害。');qualify(x,['下一个合法伤害技能命中敌方英雄','冷却可用','1秒后结算'],'首个命中筛选及延迟伤害未连接');x.excluded.push({fields:['OOCTimer','{89367404}'],reason:'未被当前绑定说明消费，不猜脱战或内部判定机制'});
}
{
 const x=proposal(8232,'水上行走10固定移速独立组成及等级适应之力数值');curve(x,'confirmed_adaptive_force','等级适应之力',13,30,'MinAdaptive','MaxAdaptive');direct(x,'river_flat_move_speed','河道固定移速',10,'MovementSpeed');formula(x,'adaptive_force_amount','河道适应之力数值',P('confirmed_adaptive_force'),'仅数值；未连接河道条件或自动选择属性。');fixedAttribute(x,'river_flat_move_speed_component','河道固定移速组成','move_speed','river_flat_move_speed','只有已确认处在河道时可应用，离开时需移除；当前无自动触发和河道状态，不能初始化无条件常驻。');qualify(x,['实际处于河道','已核实适应属性选择'],'河道进入退出条件与适应属性授予/移除未连接');x.excluded.push({field:'{6f2f0d30}',value:1,reason:'字段未命名，不猜加成语义'});
}
const requests=[];for(const x of proposals){x.skillBody={skillKey:x.skillKey,name:'符文·'+x.name,description:'本批仅录入：'+x.scope+'。其余条件尚未连接，不代表完整符文。',maxLevel:1,status:'ENABLED',sortOrder:0,skillCategoryKeys:['passive']};x.relationBody={runeKey:x.runeKey,skillKey:x.skillKey,sortOrder:0};const route='/skills/'+x.skillKey,push=(kind,route,readRoute,body)=>requests.push({id:x.id,skillKey:x.skillKey,kind,route,readRoute,body});push('skill','/skills',route,x.skillBody);for(const[kind,list,child,key]of [['parameter',x.parameters,'parameters','parameterKey'],['formula',x.formulas,'formulas','formulaKey'],['effect',x.effects,'effects','effectKey']])for(const body of list)push(kind,route+'/'+child,route+'/'+child+'/'+body[key],body);push('relation','/rune-skill-relations','/rune-skill-relations?runeKey='+x.runeKey+'&skillKey='+x.skillKey,x.relationBody);}
const counts=Object.fromEntries(['skill','parameter','formula','effect','relation','rule','process','internalState'].map(k=>[k,requests.filter(r=>r.kind===k).length]));assert.equal(counts.skill,12);assert.equal(counts.effect,1);assert(proposals.every(p=>p.parameters.every(x=>x.valueMode!=='CHARACTER_LEVEL')));
save('可审查候选.json',{at:new Date().toISOString(),executor:'主负责人',scope:'12项普通符文候选，业务写入尚未执行',counts,proposals});save('可审查请求.json',{sourceRawSha256:sha(raw),candidateSha256:sha(fs.readFileSync(path.join(here,'可审查候选.json'))),boundary:'12身份复用；尚未POST，代表图后续仅复用',counts,requests});save('生成摘要.json',{at:new Date().toISOString(),counts,totalRequests:requests.length,candidateSha256:sha(fs.readFileSync(path.join(here,'可审查候选.json'))),requestSha256:sha(fs.readFileSync(path.join(here,'可审查请求.json'))),frozenSha256:sha(frozenBytes),businessWrites:0});console.log(JSON.stringify({counts,requests:requests.length,writes:0}));
