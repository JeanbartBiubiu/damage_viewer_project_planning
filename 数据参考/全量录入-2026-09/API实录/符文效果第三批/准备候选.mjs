import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
if(process.argv.length!==2)throw Error('只生成候选；没有业务写入口');
const here=path.dirname(fileURLToPath(import.meta.url)), base=path.dirname(here);
if(fs.existsSync(path.join(here,'可审查请求.json')))throw Error('本批候选已冻结；拒绝覆盖现有请求。纠错须保留当前摘要另建版本。');
const ids=[8105,8106,8304,8352,8347,8410,8014,8017,8429,8444,8451,8234];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(f));
const save=(f,x)=>fs.writeFileSync(path.join(here,f),JSON.stringify(x,null,2)+'\n');
const inputs=[];
const input=(relative)=>{const file=path.join(base,relative),bytes=fs.readFileSync(file);inputs.push({file,sha256:sha(bytes),bytes:bytes.length});return JSON.parse(bytes)};
const source=input('符文客户端数值补证/当前69项数值来源.json');
const old=input('符文机制盘点/冻结来源.json'),scope=input('符文机制盘点/逐项机器清单.json');
input('符文效果第二批/可审查请求.json');
const current=read(path.join(here,'当前目录只读.json'));
const rawGz=fs.readFileSync(path.join(base,'符文客户端数值补证/perks-16.17.cdtb.bin.json.gz')),raw=zlib.gunzipSync(rawGz);
assert.equal(sha(raw),'1427c70c4d1172198a1a9787362224c871a90cc4f66f3f769ef5830cbcd401b1');
assert.equal(sha(rawGz),'141a289f8b83c543c108930675088ec1e5bd0f482799d2677a436f0ff9e65fac');
const rawData=JSON.parse(raw),byId=new Map(source.entries.filter(e=>ids.includes(e.id)).map(e=>[e.id,e]));assert.equal(byId.size,12);
for(const e of byId.values()){assert.deepEqual(rawData[e.sourcePath],e.object);assert.equal(sha(JSON.stringify(e.object)),e.sourceObjectSha256);}
const officialFile=path.join(base,'../../全量录入-2026-09/装备符文/官方原始资料/runesReforged-16.17.1-zh_CN.json');
assert.equal(sha(fs.readFileSync(officialFile)),old.inputs.find(i=>i.version==='16.17.1').sha256);
const auditFile='C:/project/damage_web_dev/.agents/artifacts/rune-third-cursor-audit.json';
fs.copyFileSync(auditFile,path.join(here,'Cursor失败审计.json'));
const oldItems=new Map(old.items.map(i=>[i.id,i])),oldScope=new Map(scope.entries.map(i=>[i.id,i]));
save('冻结来源.json',{at:new Date().toISOString(),clientVersion:'16.17',officialVersion:'16.17.1',rawSource:source.sources[0],inputs,entries:ids.map(id=>({current:byId.get(id),official:oldItems.get(id),previousScope:oldScope.get(id)})),verification:'12个原始对象全字段一致；重新验证原始及压缩摘要；旧范围只作对照，数值优先当前绑定。'});
const attrs=new Map(current.records.find(r=>r.route==='/attributes').data.items.map(a=>[a.attributeKey,a]));
assert.equal(attrs.get('move_speed')?.status,'ENABLED');assert.equal(attrs.get('armor')?.status,'ENABLED');assert.equal(attrs.get('magic_resistance')?.status,'ENABLED');
assert.equal(current.records.find(r=>r.route==='/modifier-zones').data.items.find(z=>z.modifierZoneKey==='attribute_flat_add')?.calculationMode,'FLAT_ADD');
for(const id of ids)assert.equal(current.records.find(r=>r.route===`/skills/rune_${id}_passive`).status,404);
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
{
 const x=proposal(8105,'确定非战斗固定移速系数及按已确认赏金层数计算的数值；不自动授予移速');
 parameter(x,'move_speed_per_bounty','每赏金层非战斗移速',8,'仅非战斗状态获得8×已确认赏金层数。',{field:'OOCMS'});
 runtime(x,'confirmed_bounty_stacks','已确认赏金层数','来自每名独特敌方英雄首次参与击杀的已核实进度；不默认0、不硬猜5层上限。','INTEGER');
 formula(x,'out_of_combat_move_speed','非战斗移速数值',mul(P('move_speed_per_bounty'),P('confirmed_bounty_stacks')),'仅数值公式；非战斗进入退出条件未接线。');
 pending(x,'来源','非战斗进入退出精确定义及判定时点未提供','当前模式非战斗规则');pending(x,'未接线','层数和独特英雄去重未生产','战前进度及变化供值');x.qualification.required=['真实赏金层数','非战斗成立'];x.qualification.notDefaulted=['默认满层','任意伤害后立即保持非战斗'];
}
{
 const x=proposal(8106,'6+5×已确认赏金层数的终极技能急速数值；不扩大到所有技能');
 parameter(x,'base_ultimate_haste','基础终极技能急速',6,'只适用于终极技能。',{field:'StartingUltAH'});parameter(x,'ultimate_haste_per_bounty','每赏金层终极技能急速',5,'每名独特敌方英雄首次参与击杀获得一层。',{field:'AdditionalUltAH'});
 runtime(x,'confirmed_bounty_stacks','已确认赏金层数','不默认层数，不凭队伍人数设置最大层数。','INTEGER');
 formula(x,'ultimate_haste','终极技能急速数值',add(P('base_ultimate_haste'),mul(P('ultimate_haste_per_bounty'),P('confirmed_bounty_stacks'))),'结果是急速点数；不是百分比，也不是当前冷却毫秒数。');
 pending(x,'系统','支持SKILL_HASTE_MODIFIER，但尚无合法终极技能集合','按拥有者明确的终极技能键或真实分类');pending(x,'未接线','赏金层数供值和更新未绑定','唯一敌方英雄进度');x.qualification.required=['终极技能身份集合','真实赏金层数'];x.qualification.notDefaulted=['作用于ALL','加到ability_haste属性','已拥有5层'];
}
{
 const x=proposal(8304,'有点神奇之鞋额外10固定移速独立组成；保留取得时点依赖');
 parameter(x,'additional_move_speed','神奇之鞋额外移速',10,'仅额外部分；当前item_2422已保存25直接移速，二者合计35。',{field:'AdditionalMovementSpeed'});
 parameter(x,'base_grant_time_ms','通常取得鞋子时间',720000,'相对于本局开始的12分钟，不是来源创建后12分钟；实际时点还受参与击杀与未知限制影响。',{field:'GiveBootsAtMinute',scale:60000});
 parameter(x,'earlier_per_takedown_ms','每次参与击杀提前时间',45000,'只保留影响实际持有状态的成长依赖。',{field:'SecondsSoonerPerTakedown',scale:1000});
 fixedAttribute(x,'magical_footwear_additional_speed','神奇之鞋额外移速','move_speed','additional_move_speed','独立额外10；只有已确认持有item_2422、且该额外来源尚未由其他装备效果授予时才可执行。当前未创建触发；不包含升级鞋继承。');
 pending(x,'未接线','鞋子实际装备及移除条件尚未绑定','合法item_2422持有事件；同来源唯一实例');pending(x,'来源','升级后额外移速的绑定继承及未知{c07791e4}=300尚未解码','当前升级链/原脚本约束，不猜最低到达时间');x.excluded.push({field:'{c07791e4}',value:300,reason:'语义未命名，不当金钱或最低时间猜录'},{branch:'免费和禁止购买流程',reason:'经济流程范围外；只保留实际持有时间依赖'});x.qualification.required=['实际持有item_2422','确认额外10未由其他效果重复应用'];x.qualification.notDefaulted=['选符文立刻拥有鞋','升级鞋自动继承','直接属性35再叠加10'];
}
{
 const x=proposal(8352,'药水40%生命恢复额度提前与60%剩余额度的独立数值，不发起额外治疗');
 parameter(x,'instant_restore_ratio','提前恢复额度比例',.4,'同一瓶药水总额度的40%，不是额外增加40%。',{field:'RestorationPercentage'});
 runtime(x,'confirmed_potion_total_heal','已确认药水总生命恢复额度','必须来自本次合法消耗且与原药水持续治疗统一口径；不使用角色最大生命或任意药剂值。');
 formula(x,'instant_potion_heal_budget','提前恢复生命额度',mul(P('confirmed_potion_total_heal'),P('instant_restore_ratio')),'同一总额度的即时部分；没有创建DIRECT_HEAL效果。');
 formula(x,'remaining_potion_heal_budget','剩余持续恢复额度',sub(P('confirmed_potion_total_heal'),mul(P('confirmed_potion_total_heal'),P('instant_restore_ratio'))),'从原额度扣除即时部分，不能保留100%持续治疗后再加40%。');
 pending(x,'来源','当前绑定说明未说明周期和剩余额度分配、Cooldown20的作用','同版本药水与符文执行链');pending(x,'系统','缺少对已存在药水恢复计划的统一扣减/改写','同一消耗下的恢复额度守恒');pending(x,'未接线','药水合法消耗与总额度供值未绑定','对应药水作用于自己的消耗事件');x.excluded.push({field:'BonusMS',value:0,reason:'当前绑定不包含加速，不能复活旧版效果'},{field:'Cooldown',value:20,reason:'未被当前说明绑定，不猜独立冷却'});x.qualification.required=['合法药水消耗','同一总额度的时序重分配'];x.qualification.notDefaulted=['额外40%治疗','100%原持续治疗照旧','所有药剂均可触发'];
}
{
 const x=proposal(8347,'独立保留18召唤师技能急速和10装备急速，范围未绑定');
 parameter(x,'summoner_haste','召唤师技能急速',18,'仅召唤师技能急速，不改变英雄技能急速。',{field:'SummonerHaste'});parameter(x,'item_haste','装备急速',10,'仅合法装备技能急速，不与18相加成28通用技能急速。',{field:'ItemHaste'});
 pending(x,'系统','现有分类不能准确表示召唤师和装备技能集合','明确的作用范围及装备主动/被动适用口径');x.qualification.required=['召唤师技能集合','受装备急速影响的技能集合'];x.qualification.notDefaulted=['ALL','通用急速28','所有装备触发间隔均受影响'];
}
{
 const x=proposal(8410,'保留朝向自己施加移动受损的敌方英雄时15%移速比例');
 parameter(x,'self_control_move_speed_ratio','朝向自身控制目标移速比例',.15,'当前1V1仅保留自己施加移动受损的目标分支。',{field:'MovementSpeedPercentBonus'});
 pending(x,'来源','可计入移动受损的状态全集、方向和百分比移速组合待核','状态归属及移速组合规则');pending(x,'系统','当前没有已验证的移动朝向/控制归属条件','相关事件输入及条件');x.excluded.push({branch:'友军控制的7.5%及1000激活距离',reason:'严格1V1无第三名友军；不能将1000距离套给自身控制分支',sourceField:'ActivationDistance',value:1000});x.qualification.required=['目标是敌方英雄','控制由自己施加','正在朝向该目标移动'];x.qualification.notDefaulted=['任意方向都生效','必须1000距离以内','所有百分比来源统一加算'];
}
for(const [id,threshold,label] of [[8014,.4,'低于'],[8017,.6,'高于']]){
 const x=proposal(id,`${label}${threshold*100}%英雄生命时的8%伤害增幅参数及阈值数值；未连接伤害修正`);
 parameter(x,'target_health_threshold_ratio','目标生命门槛比例',threshold,`目标英雄当前生命严格${label}此门槛；等于门槛不成立。`,{field:'EnemyHealthPercentageThreshold'});
 parameter(x,'bonus_damage_ratio','额外伤害比例',.08,'仅合格伤害的增幅；尚未确定真实伤害等例外，不创建DAMAGE结果。',{field:'BonusPercentDamage'});
 runtime(x,'confirmed_eligible_damage','已确认适用伤害基数','由已核实伤害阶段及资格供值；不假设包含所有伤害类型，不默认抗性前或后。');
 formula(x,'target_health_threshold','目标生命门槛数值',mul(A('TARGET','hp','TOTAL'),P('target_health_threshold_ratio')),'只计算门槛值；比较和取样时点尚未绑定。');
 formula(x,'extra_damage_amount','合格伤害额外数值',mul(P('confirmed_eligible_damage'),P('bonus_damage_ratio')),'只算已确认基数的8%；不是自动参与伤害结算的乘区。');
 pending(x,'来源','目标生命采样时点、伤害包资格及跨来源增幅顺序未提供','当前伤害修正分支和例外');pending(x,'未接线','门槛判断和合格伤害供值未绑定','严格边界条件和统一结算阶段');x.qualification.required=[`目标英雄生命严格${label}${threshold*100}%`,'伤害包符合资格'];x.qualification.notDefaulted=['等于门槛也触发','真实伤害可增幅','任意事件后生命可当作伤害前生命'];
 if(id===8017)for(const field of ['MinBonusDamagePercent','MaxBonusDamagePercent','MinHealthDifference','MaxHealthDifference'])x.excluded.push({field,value:byId.get(id).object.mScript.mSpellScriptData.mEffectAmount[field],reason:'旧生命差字段仍在原对象；当前绑定只引用60%门槛和8%，不录旧5–15%公式'});
}
{
 const x=proposal(8429,'12分钟后固定+8双抗独立组成及当前提示公式；比例与固定顺序待补');
 parameter(x,'flat_armor','固定护甲',8,'仅固定组成，不代表完整调节收益。',{field:'ArmorBase'});parameter(x,'flat_magic_resistance','固定魔法抗性',8,'仅固定组成，不代表完整调节收益。',{field:'MRBase'});parameter(x,'resistance_ratio','双抗提升比例',.03,'后续百分比组合不直接写入共用乘区。',{field:'ExtraResist'});parameter(x,'activation_game_time_ms','激活游戏绝对时间',720000,'普通模式本局12分钟后；不是来源初始化的延迟。',{field:'MinutesRequired',scale:60000});
 runtime(x,'confirmed_armor_basis','已确认提示公式护甲基数','原树ArmorCalcTooltip读取护甲；是否已含本符文固定/比例收益及其他来源的取值次序待核，不默认当前TOTAL。');runtime(x,'confirmed_magic_resistance_basis','已确认提示公式魔抗基数','对应MagicResistCalcTooltip，精确取值和百分比组合次序待核。');
 formula(x,'armor_tooltip_amount','调节护甲提示数值',add(P('flat_armor'),mul(P('confirmed_armor_basis'),P('resistance_ratio'))),'逐项对应同版本ArmorCalcTooltip；基数明确作为未绑定输入，不用自身已修改属性循环读取。');
 formula(x,'magic_resistance_tooltip_amount','调节魔抗提示数值',add(P('flat_magic_resistance'),mul(P('confirmed_magic_resistance_basis'),P('resistance_ratio'))),'仅提示数值，不能把它当成独立固定加算结果自动执行。');
 fixedAttribute(x,'flat_armor_component','调节固定护甲组成','armor','flat_armor','仅已明确的+8固定组成；未连接12分钟条件和完整百分比流程，不能当作完整调节或单独自动初始化。');fixedAttribute(x,'flat_magic_resistance_component','调节固定魔抗组成','magic_resistance','flat_magic_resistance','仅已明确的+8固定组成；未来需与百分比部分按核实的顺序统一应用。');
 pending(x,'来源','8与3%的组合顺序、提示基数及其他来源组合未证','实际属性修改流程及独立乘区口径');pending(x,'未接线','本局绝对时间门槛未连接','可靠的本局游戏时间输入');x.excluded.push({field:'Range',value:800,reason:'当前绑定无对应含义，不当作调节作用半径'});x.qualification.required=['游戏绝对时间达到普通模式门槛','完整固定及比例顺序核实'];x.qualification.notDefaulted=['来源创建后等待12分钟','当前TOTAL就是百分比基数','共享百分比区一定正确'];
}
{
 const x=proposal(8444,'受到敌方英雄伤害后10秒内共回复4%已损生命的总量公式；不创建瞬发或周期治疗');
 parameter(x,'missing_health_heal_ratio','已损生命恢复总比例',.04,'当前绑定只有4%已损生命；原RegenFlat=0，不沿用旧版固定治疗。',{field:'RegenPercentMax'});parameter(x,'heal_duration_ms','总恢复持续时间',10000,'10秒总量；不能视为单跳或每秒4%。',{field:'RegenSeconds',scale:1000});
 formula(x,'healing_total_budget','十秒治疗总额度',mul(A('SOURCE','hp','MISSING'),P('missing_health_heal_ratio')),'只表示在调用者已选定的合法采样时点，已损生命对应的总额度。采样与刷新规则未核实，本批无治疗效果。');
 pending(x,'来源','已损生命快照还是动态、跳频/首跳、再次受伤刷新规则未提供','当前治疗执行链');pending(x,'未接线','来自敌方英雄伤害资格未绑定','合法受伤事件及持续恢复');x.qualification.required=['来源为敌方英雄的伤害','核实采样时点及10秒恢复安排'];x.qualification.notDefaulted=['全额瞬间治疗','每秒4%','固定加3或6','再次受伤独立叠加'];
}
{
 const x=proposal(8451,'每8单位+3永久生命、120门槛3.5%及1400吸收范围；保留战前成长输入');
 parameter(x,'units_per_tier','每档吸收单位数',8,'野怪或小兵死亡进度，不能因为对线外对象而删除已获得进度。',{field:'UnitsPerTier'});parameter(x,'flat_health_per_tier','每档永久最大生命',3,'普通模式每完成8个死亡进度增加3。',{field:'FlatHealthPerTier'});parameter(x,'threshold_units','比例增益吸收门槛',120,'普通模式吸收120个单位。',{field:'ThresholdUnits'});parameter(x,'threshold_max_health_ratio','门槛后最大生命比例',.035,'额外3.5%，精确基数及跨来源组合待核。',{field:'ThresholdMaxHealthRatio'});parameter(x,'absorption_range','吸收范围',1400,'当前默认模式Range字段；具体距离边界与死亡事件资格仍需装配。',{field:'Range'});
 runtime(x,'confirmed_completed_tiers','已确认完成档数','应由已确认吸收进度按每8个完成一档生产，当前公式无FLOOR；不把总单位数直接除8作为档数。','INTEGER');runtime(x,'confirmed_max_health_basis','已确认比例最大生命基数','只在已达到120门槛并核实组合时点后供值；不默认TOTAL已含或未含本符文。');
 formula(x,'permanent_flat_health','固定永久生命累计数值',mul(P('confirmed_completed_tiers'),P('flat_health_per_tier')),'明确完成档数×3；不设任意最大层数，状态生产尚未接线。');formula(x,'threshold_percent_health','门槛后比例生命数值',mul(P('confirmed_max_health_basis'),P('threshold_max_health_ratio')),'仅独立数值，门槛与基数仍未绑定；不自动增加生命。');
 pending(x,'系统','当前公式无整数向下取整，不能用除法代替档数','外部已确认完整档数或后续合法进度机制');pending(x,'来源','最大生命百分比精确基数、组合顺序及未命名字段未证','当前生命叠加执行链');pending(x,'未接线','范围内合法小兵野怪死亡和战前累计未绑定','死亡进度供值及去重');x.excluded.push({fields:['{1663f8e7}','{ca029a2b}'],reason:'未命名0.75和2不猜语义；原对象全文保留'});x.qualification.required=['已确认吸收进度','完整档数','达到120门槛后才有比例部分'];x.qualification.notDefaulted=['开局120层','单位数/8小数也增加生命','上限15档','把小兵野怪进度删掉'];
}
{
 const x=proposal(8234,'移动加成效能+7%和额外1%移速的确定比例；增强基数未接线');
 parameter(x,'movement_bonus_amplification_ratio','移动加成效能提升比例',.07,'只增强合法移动加成；不是把角色总移速乘1.07。',{field:'PercentHasteMod'});parameter(x,'additional_move_speed_ratio','额外移速比例',.01,'明确额外1%；自身1%是否受7%增强及其他组合顺序待核。',{field:'PercentMS'});
 runtime(x,'confirmed_eligible_movement_bonus','已确认可增强移动加成基数','必须排除不适用来源并确定合并顺序；不默认当前总移速或全部move_speed_percent。');formula(x,'amplified_movement_bonus_increment','合法移动加成增强数值',mul(P('confirmed_eligible_movement_bonus'),P('movement_bonus_amplification_ratio')),'只计算指定合法加成基数的7%增量；基础1%暂仅参数，不擅自合并。');
 pending(x,'来源','可增强来源、自身1%与软上限前后顺序未确定','移动速度完整组合规则');pending(x,'未接线','合法移动加成基数未供值','来源过滤和取值时点');x.qualification.required=['合法移动加成基数','明确组合顺序'];x.qualification.notDefaulted=['总移速×1.07','把7%和1%加成通用8%','所有来源都适用'];
}
const requests=[];
for(const x of proposals){
 x.skillBody={skillKey:x.skillKey,name:'符文·'+x.name,description:'本批仅录入：'+x.scope+'。其余条件及组合尚未连接，不代表完整符文。',maxLevel:1,status:'ENABLED',sortOrder:0,skillCategoryKeys:['passive']};
 x.relationBody={runeKey:x.runeKey,skillKey:x.skillKey,sortOrder:0};const route='/skills/'+x.skillKey;
 const push=(kind,route,readRoute,body)=>requests.push({id:x.id,skillKey:x.skillKey,kind,route,readRoute,body});
 push('skill','/skills',route,x.skillBody);
 for(const [kind,list,child,key]of [['parameter',x.parameters,'parameters','parameterKey'],['formula',x.formulas,'formulas','formulaKey'],['effect',x.effects,'effects','effectKey']])for(const body of list)push(kind,route+'/'+child,route+'/'+child+'/'+body[key],body);
 push('relation','/rune-skill-relations',`/rune-skill-relations?runeKey=${x.runeKey}&skillKey=${x.skillKey}`,x.relationBody);
}
const counts=Object.fromEntries(['skill','parameter','formula','effect','relation','rule','process','internalState'].map(k=>[k,requests.filter(r=>r.kind===k).length]));assert.equal(counts.skill,12);assert.equal(counts.effect,3);
save('可审查候选.json',{at:new Date().toISOString(),executor:'Codex执行代理接手；Cursor实际运行失败且输出为空',cursorAuditSha256:sha(fs.readFileSync(auditFile)),scope:'12项普通符文有界候选，API写入未授权且未执行',counts,proposals});
save('可审查请求.json',{sourceRawSha256:sha(raw),candidateSha256:sha(fs.readFileSync(path.join(here,'可审查候选.json'))),boundary:'仅可审查请求；没有执行这些POST，12身份已存在，不创建符文或布局、图片；根后续批准批录',counts,requests});
save('生成摘要.json',{at:new Date().toISOString(),counts,totalRequests:requests.length,candidateSha256:sha(fs.readFileSync(path.join(here,'可审查候选.json'))),requestSha256:sha(fs.readFileSync(path.join(here,'可审查请求.json'))),frozenSha256:sha(fs.readFileSync(path.join(here,'冻结来源.json'))),pendingCounts:proposals.flatMap(p=>p.pending).reduce((a,p)=>(a[p.type]=(a[p.type]||0)+1,a),{}),businessWrites:0});
console.log(JSON.stringify({counts,requests:requests.length,writes:0}));
