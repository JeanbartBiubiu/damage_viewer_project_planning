import {plan,common,literal,formula,pending,exclude,statEffect,effect,result,val,fval,op,pn,life,behavior} from './候选.mjs';
import {start,datum,fixed,input,calc,sourceOnly} from './计算树候选.mjs';

const plus=(a,b)=>op('ADD',a,b),times=(a,b)=>op('MULTIPLY',a,b),min=(a,b)=>op('MIN',a,b),max=(a,b)=>op('MAX',a,b);
const d=(x,source,key,name,scale=1,unit='')=>datum(x,source,key,name,{scale,unit});
const fact=(x,key,name,value,why)=>fixed(x,key,name,value,why,'当前绑定中文正文；原文见source.currentBoundText');

function standard(x,{passive=false,channelDuration=false}={}){
  if(!passive)common(x,{channelDuration});
  pending(x,'施放与实际命中接线','只保存有证独立组成；实际施放、命中、状态资格和运行输入还未接线，不创建空过程或无条件初始化。');
}
function damage(x,source,key,name,why){
  calc(x,source,key,name,why);
  pending(x,'伤害结果：'+key,'当前计算树只保留数学关系；该分支的法术护盾、暴击、吸血及技能结果资格没有完整实证，不填默认DAMAGE结果或空绑定命中动作。','来源');
}
function healPendingOnly(x,key,name,why){
  pending(x,'治疗结果：'+key,why+'；只保留来源或数学关系，不创建瞬时DIRECT_HEAL结果。','来源');
}
function rest(x,explicit={}){
  for(const v of x.p.DataValues??[]){
    const name=v.name??v.mName;
    if(x.dataMap.has(name)||x.c.proofs.some(p=>p.source==='DataValues.'+name))continue;
    if(explicit[name])sourceOnly(x,'DataValues.'+name,explicit[name][1],explicit[name][0]);
    else sourceOnly(x,'DataValues.'+name,'原字段没有当前1V1数值消费或含义证据；完整原值保留，不能据字段名自动创建正常组成。');
  }
  for(const key of Object.keys(x.p.mSpellCalculations??{})){
    if(x.c.proofs.some(p=>p.source==='mSpellCalculations.'+key))continue;
    sourceOnly(x,'mSpellCalculations.'+key,'当前绑定的其他计算完整留源；与已存表达式的适用关系未核清，不重复或猜分支。');
  }
}
function shieldEffect(x,key,name,formulaKey,durationKey,why){
  effect(x,key,name,[result('shield',name,'NORMAL_SHIELD','SOURCE',fval(formulaKey),{absorbedDamageTypeKey:null,decayMode:'NONE'},behavior)],life(val(durationKey)),why+'；护盾伤害类型不由字段名猜定，实际施放、采样时点与强化条件尚未接线。');
}

// 维克托：保留进化层、Q自益护盾与强化移速；塔、竞技场和纯空间字段只留来源。
{
  const x=start('viktor_p');
  d(x,'MinionStacks','minion_stacks','普通小兵提供层数');
  d(x,'CannonStacks','cannon_stacks','炮车小兵提供层数');
  d(x,'ChampionStacks','champion_stacks','英雄提供层数');
  d(x,'EvolutionStackBreakpoint','evolution_stack_breakpoint','进化所需层数');
  exclude(x,'竞技场层数时间与节拍','ARAMStacksoverTime、ARAMStackCadence只用于特殊模式的随时间层数，不进入普通1V1。');
  pending(x,'层数获取与技能进化','击杀单位、达到100层及四个技能进化的真实事件与技能状态还未接线；保留层数依赖，不创建无条件初始化。');
  rest(x,{ARAMStacksoverTime:['范围外','竞技场特殊模式随时间层数。'],ARAMStackCadence:['范围外','竞技场特殊模式层数节拍。']});
}
{
  const x=start('viktor_q');
  standard(x);
  d(x,'MissileDamage','missile_base_damage','法球基础魔法伤害');
  d(x,'AABonusDamage','next_attack_base_damage','强化后续普攻基础伤害');
  d(x,'BuffDuration','buff_duration_ms','强化普攻与护盾持续时间（毫秒）',1000,'毫秒');
  d(x,'MissileAPRatio','missile_ap_ratio','法球法强系数');
  d(x,'HitAPRatio','next_attack_ap_ratio','强化后续普攻法强系数');
  d(x,'ShieldManaRatio','shield_mana_ratio','护盾法力系数');
  d(x,'ShieldAPRatio','shield_ap_ratio','护盾法强系数');
  d(x,'AugmentShieldBonus','augmented_shield_multiplier','强化护盾倍数');
  d(x,'AugmentMoveSpeedBonus','augment_move_speed_ratio','强化移速加成比例',.01);
  damage(x,'TotalMissileDamage','missile_damage','法球魔法伤害','实际命中敌方英雄的法球伤害；后续普攻与护盾分开。');
  damage(x,'AttackTotalDMG','next_attack_damage','强化后续普攻伤害','当前树为基础伤害+法强项+总AD；实际普攻资格待接。');
  calc(x,'{147c7de9}','next_attack_total_ad','强化后续普攻总AD分量','当前匿名树只表达mStat2/formula0总AD分量，保留为独立公式。');
  calc(x,'ShieldLevelScaling','shield_amount','基础护盾数值','角色等级插值基础项+护盾法强系数；实际等级值外供，不按端点猜线性。');
  calc(x,'TotalAugmentedShieldValue','augmented_shield_amount','强化护盾数值','基础护盾乘当前强化护盾倍数1.6；强化触发条件待接。');
  shieldEffect(x,'shield','虹吸能量自身护盾','shield_amount','buff_duration_ms','当前正文明确Q命中后自身获得护盾。');
  shieldEffect(x,'augmented_shield','虹吸能量强化自身护盾','augmented_shield_amount','buff_duration_ms','当前正文明确进化Q护盾提高60%；强化状态待接。');
  statEffect(x,'augment_move_speed','虹吸能量强化移速',val('augment_move_speed_ratio'),'move_speed_percent',{duration:val('buff_duration_ms'),description:'当前正文明确进化Q提供30%移动速度；仅表达强化期间自身收益，实际触发与提前结束未接线。'});
  rest(x,{TurretDamageMod:['范围外','仅防御塔伤害倍率；当前1V1英雄伤害不使用。']});
}
{
  const x=start('viktor_w');
  standard(x);
  d(x,'SlowPotency','slow_ratio','重力场减速比例',-.01);
  d(x,'StunDuration','stun_duration_ms','眩晕时长（毫秒）',1000,'毫秒');
  d(x,'FieldDuration','field_duration_ms','重力场持续时间（毫秒）',1000,'毫秒');
  d(x,'StackCadence','stack_cadence_ms','重力场层数节拍（毫秒）',1000,'毫秒');
  d(x,'StacksForStun','stun_stack_count','眩晕所需层数');
  d(x,'SlowDuration','slow_duration_ms','强化减速持续时间（毫秒）',1000,'毫秒');
  d(x,'AugmentSlow','augment_slow_ratio','强化减速比例',.01);
  exclude(x,'重力场范围与特殊占位字段','Size是纯空间半径；两个IGNORE字段没有值且仅为替换占位，不补0。');
  pending(x,'持续停留与眩晕','敌方在场内停留、层数节拍、达到6层及进化技能施加减速的事件顺序未接线；不把场持续时间直接当控制持续。');
  rest(x,{Size:['范围外','纯场地空间半径，不新增战斗参数。'],IGNORE___replaced_the_values_in_the__json:['范围外','无值的替换占位，不补默认值。']});
}
{
  const x=start('viktor_e');
  standard(x);
  exclude(x,'激光射程','LaserRange为纯施法空间范围；命中敌方英雄的伤害公式保留。');
  d(x,'BaseDamageLaser','laser_base_damage','激光基础魔法伤害');
  d(x,'BaseDamageAftershock','aftershock_base_damage','后续爆炸基础魔法伤害');
  d(x,'Delay','aftershock_delay_ms','后续爆炸延迟（毫秒）',1000,'毫秒');
  d(x,'LaserAPRatio','laser_ap_ratio','激光法强系数');
  d(x,'AftershockAPRatio','aftershock_ap_ratio','后续爆炸法强系数');
  damage(x,'LaserDamage','laser_damage','激光魔法伤害','当前英雄目标命中的直线激光伤害。');
  damage(x,'AftershockDamage','aftershock_damage','后续爆炸魔法伤害','进化E沿激光路径的后续爆炸伤害；命中时序待接。');
  sourceOnly(x,'mSpellCalculations.{86b88e5d}','仅小兵/野怪承伤折减的后续爆炸分支，当前英雄单目标范围外。','范围外');
  rest(x,{LaserRange:['范围外','纯激光射程。'],AftershockMinionMulti:['范围外','仅小兵/野怪折减，不用于当前英雄目标。']});
  pending(x,'激光与后续爆炸接线','激光命中、进化后沿路径爆炸及两段先后时点未接线；不将后续爆炸合并为首段或默认同时命中。');
}
{
  const x=start('viktor_r');
  standard(x);
  d(x,'InitialBurstBaseDamage','initial_burst_base_damage','初始爆发基础魔法伤害');
  d(x,'SubsequentBurstBaseDamage','subsequent_burst_base_damage','后续爆发基础魔法伤害');
  d(x,'StormDuration','storm_duration_ms','风暴持续时间（毫秒）',1000,'毫秒');
  d(x,'TickCadence','tick_cadence_ms','后续伤害节拍（毫秒）',1000,'毫秒');
  d(x,'MaxTicks','max_ticks','最大后续节拍次数');
  d(x,'AugmentBoost','augment_boost_ratio','进化后风暴速度提升比例');
  d(x,'EnhancedSlow','enhanced_slow_ratio','进化后减速比例',.01);
  d(x,'EnhancedSlowDuration','enhanced_slow_duration_ms','进化后减速持续时间（毫秒）',1000,'毫秒');
  d(x,'MaxGrowths','max_growths','最大成长次数');
  d(x,'SubsequentBurstAPRaio','subsequent_burst_ap_ratio','后续爆发法强系数');
  d(x,'InitialBurstAPRatio','initial_burst_ap_ratio','初始爆发法强系数');
  d(x,'Tooltip_DurationExtension','duration_extension_ms','击杀英雄延长持续时间（毫秒）',1000,'毫秒');
  damage(x,'InitialBurstDamage','initial_burst_damage','初始爆发魔法伤害','R首次爆发对当前敌方目标的伤害。');
  damage(x,'SubsequentBurstDamage','subsequent_burst_damage','后续爆发魔法伤害','R后续单次爆发伤害；持续总量和节拍不折算成一次伤害。');
  exclude(x,'风暴追踪与区域几何','MaxStormSpeed、MinStormSpeed、MinDistance、MaxDistance、StormRadius、EnhancedSizeMult均为移动或范围几何，不新增当前英雄伤害参数。');
  pending(x,'风暴周期、追踪和成长','实际首次/后续节拍、重新指向、英雄死亡增长与持续时间延长未接线；保留上限、节拍和延长字段，不凭6.5秒与1秒直接造总伤或固定跳数。');
  rest(x,{MaxStormSpeed:['范围外','风暴追踪速度上限，纯空间移动。'],MinStormSpeed:['范围外','风暴追踪速度下限，纯空间移动。'],MinDistance:['范围外','重新指向的纯距离条件。'],MaxDistance:['范围外','重新指向的纯距离条件。'],StormRadius:['范围外','风暴区域半径。'],EnhancedSizeMult:['范围外','进化后风暴尺寸倍率，纯区域几何。']});
}

// 奥莉安娜：球的位置与路径留待接线；自身伤害、护盾和抗性数值继续保留。
{
  const x=start('orianna_p');
  standard(x,{passive:true});
  d(x,'StackMult','stack_damage_ratio','同一目标每层额外伤害比例');
  d(x,'StackCount','stack_count','同一目标最多额外层数');
  d(x,'StackDuration','stack_duration_ms','同一目标层数持续时间（毫秒）',1000,'毫秒');
  d(x,'APRatio','passive_ap_ratio','被动法强系数');
  damage(x,'TotalDamage','passive_total_damage','普通攻击附加魔法伤害','当前角色等级基础项+法强系数；同一目标层数由真实攻击事件决定。');
  damage(x,'StackDamage','passive_stack_damage','同一目标单层额外魔法伤害','保留同一目标层数分支，不把层数自动叠满。');
  damage(x,'StackDamageMax','passive_max_stack_damage','同一目标满层额外魔法伤害','仅作为最多两层的算术上限，不表示每次攻击必定满层。');
  pending(x,'普攻与球归属','普通攻击实际命中、同一目标层数刷新及球当前位置未接线；不把球当独立召唤物删掉全技能。');
  rest(x);
}
{
  const x=start('orianna_q');
  standard(x);
  d(x,'BaseDamage','base_damage','球路径基础魔法伤害');
  d(x,'ReducedDamagePercent','reduced_damage_ratio','后续目标伤害减少比例',-.01);
  d(x,'MinimumDamagePercent','minimum_damage_ratio','后续目标最低伤害比例',.01);
  damage(x,'TotalDamageTooltip','damage','指令：攻击魔法伤害','球沿路径对当前敌方目标的伤害；同一目标单次取值保留。');
  damage(x,'MinimumDamageTooltip','minimum_damage','指令：攻击最低魔法伤害','当前树明确最低伤害比例；路径目标次序和衰减触发待接。');
  pending(x,'球路径与伤害衰减','球经过多个单位的顺序、重复目标判定和位置移动未接线；不把普通多段路径删除，也不默认一次命中所有目标。');
  rest(x);
}
{
  const x=start('orianna_w');
  standard(x);
  d(x,'BaseDamage','base_damage','指令：杂音基础魔法伤害');
  d(x,'APRatio','ap_ratio','法强系数');
  d(x,'SlowAmount','slow_ratio','敌方减速比例');
  d(x,'HasteAmount','self_haste_ratio','自身加速比例');
  d(x,'FieldDuration','field_duration_ms','场地持续时间（毫秒）',1000,'毫秒');
  d(x,'SlowAndHasteDuration','slow_haste_duration_ms','减速与加速持续时间（毫秒）',1000,'毫秒');
  damage(x,'TotalDamage','damage','指令：杂音魔法伤害','当前球位置对唯一敌方目标的伤害。');
  pending(x,'球场控制与自益','减速、对自身的加速、场地路径和重复施放资格未接线；保留自身收益，不把友军第三者收益写入。');
  rest(x);
}
{
  const x=start('orianna_e');
  standard(x);
  d(x,'ShieldAmount','shield_base_amount','指令：防卫基础护盾');
  d(x,'DefenseBonus','defense_bonus','附着目标护甲与魔抗加成');
  d(x,'BaseDamage','pass_through_base_damage','球经过敌人的基础魔法伤害');
  d(x,'ShieldDuration','shield_duration_ms','护盾持续时间（毫秒）',1000,'毫秒');
  damage(x,'TotalDamageTooltip','pass_through_damage','指令：防卫经过伤害','球移动经过当前敌方目标的伤害；第三方友军附着关系待接。');
  calc(x,'TotalShieldTooltip','shield_amount','指令：防卫护盾数值','基础护盾+0.45AP；目标附着与取样时点待接。');
  pending(x,'球附着、穿过与抗性加成','球附着对象、穿过敌人的命中顺序及护甲/魔抗加成的对象资格未接线；不把第三方友军字段扩展为默认目标。');
  rest(x);
}
{
  const x=start('orianna_r');
  standard(x);
  d(x,'Damage','base_damage','冲击波基础魔法伤害');
  exclude(x,'冲击波范围半径','AoERadius为纯范围几何；范围命中唯一敌人仍保留。');
  d(x,'StunDuration','control_duration_ms','拉拽击飞控制时长（毫秒）',1000,'毫秒');
  damage(x,'TotalDamage','damage','指令：冲击波魔法伤害','范围命中当前唯一敌方目标的伤害。');
  pending(x,'拉拽击飞时点','球位置、拉拽/击飞实际控制时点和护盾资格未接线；不由控制时长创建默认控制结果。');
  rest(x,{AoERadius:['范围外','纯冲击波范围半径；单目标命中分支保留。']});
}

// 辛德拉：碎片、球和跨技能升级是依赖；不把收集事件或球数量写成默认过程。
{
  const x=start('syndra_p');
  standard(x,{passive:true});
  d(x,'MarkDuration','mark_duration_ms','碎片标记持续时间（毫秒）',1000,'毫秒');
  d(x,'Q1UpgradeThreshold','q_upgrade_threshold','Q升级所需碎片');
  d(x,'WUpgradeThreshold','w_upgrade_threshold','W升级所需碎片');
  d(x,'EUpgradeThreshold','e_upgrade_threshold','E升级所需碎片');
  d(x,'RUpgradeThreshold','r_upgrade_threshold','R升级所需碎片');
  d(x,'CapstoneAPPerc','capstone_ap_ratio','终极被动法强增幅比例');
  d(x,'MaxStackAmount','max_stack_amount','碎片上限');
  d(x,'StackPerSiege','stack_per_siege','炮车小兵提供碎片');
  d(x,'PassiveMarkCooldown','passive_mark_cooldown_ms','被动标记冷却（毫秒）',1000,'毫秒');
  d(x,'PassiveStacksPerLevel','passive_stacks_per_level','每次升级碎片');
  calc(x,'StacksPerProc','stacks_per_proc','每次触发碎片数','角色等级断点树；实际等级值外供，不展开断点表。');
  calc(x,'ManaPerProc','mana_per_proc','每次触发法力回复','角色等级断点树；实际等级值外供，不把断点值当固定值。');
  pending(x,'碎片收集与升级','技能伤害、升级阈值、标记冷却和小兵碎片的触发顺序未接线；小兵战前进度影响自身状态，保留数值但不创建默认事件。');
  rest(x);
}
{
  const x=start('syndra_q');
  standard(x);
  d(x,'Upgrade1MaxAmmo','q_upgrade_max_ammo','Q第一次升级最大充能数');
  d(x,'Upgrade2MaxAmmo','q_upgrade2_max_ammo','Q第二次升级最大充能数');
  d(x,'SphereDuration','sphere_duration_ms','暗黑法球存在时间（毫秒）',1000,'毫秒');
  d(x,'BaseDamage','base_damage','暗黑法球基础魔法伤害');
  damage(x,'TotalDamage','damage','暗黑法球魔法伤害','实际命中当前敌方目标的法球伤害；球的后续操作另接。');
  pending(x,'法球存在与跨技能操作','法球生成、存在时间、W拾取及E/R操作的跨技能关系未接线；不创建独立召唤物或空过程。');
  rest(x);
}
{
  const x=start('syndra_w');
  standard(x);
  d(x,'BaseSlow','slow_ratio','驱使念力减速比例',.01);
  d(x,'SlowDuration','slow_duration_ms','减速持续时间（毫秒）',1000,'毫秒');
  d(x,'BaseDamage','base_damage','驱使念力基础魔法伤害');
  exclude(x,'额外法球拾取半径','ExtraSpherePickupRadius为拾取几何范围；法球跨技能状态和对英雄伤害保留。');
  damage(x,'ThrowDamage','throw_damage','投掷魔法伤害','当前树基础伤害+0.65AP；实际拾取、投掷及目标资格待接。');
  damage(x,'PassiveBonusDamage','passive_bonus_damage','升级W额外真实伤害','当前树只保留升级后的额外数学关系；真实伤害结果资格仍未证，不创建默认结果。');
  calc(x,'TotalSlowAmount','slow_amount','投掷减速幅度','当前树直接绑定BaseSlow；按比例参数保存。');
  calc(x,'TOOLTIPONLYPassiveBonusPercent','passive_bonus_ratio','升级W额外伤害比例','tooltipOnly数学关系保留；不把显示百分比误当独立伤害结果。');
  pending(x,'拾取、重施放与升级伤害类型','拾取法球/小兵、重施放、升级额外真实伤害的法术护盾与技能结果资格未接线；纯拾取半径不新增。');
  rest(x,{ExtraSpherePickupRadius:['范围外','纯法球拾取空间半径。']});
}
{
  const x=start('syndra_e');
  standard(x);
  exclude(x,'锥形角度','ConeAngle与UpgradedConeAngle是纯命中几何；球命中当前敌人造成控制的依赖保留。');
  d(x,'StunDuration','stun_duration_ms','法球命中后的晕眩时长（毫秒）',1000,'毫秒');
  d(x,'UpgradedSlowDuration','upgraded_slow_duration_ms','升级后减速持续时间（毫秒）',1000,'毫秒');
  d(x,'UpgradedSlowAmount','upgraded_slow_ratio','升级后减速比例');
  d(x,'BaseDamage','base_damage','弱者退散基础魔法伤害');
  d(x,'APRatio','ap_ratio','法强系数');
  damage(x,'TotalDamage','damage','弱者退散魔法伤害','锥形命中当前敌方目标的伤害；法球命中控制另接。');
  pending(x,'球命中与控制','击退球、球命中敌人、晕眩分支及升级后减速资格未接线；不把角度字段误作伤害或默认控制。');
  rest(x,{ConeAngle:['范围外','纯锥形角度。'],UpgradedConeAngle:['范围外','纯升级锥形角度。']});
}
{
  const x=start('syndra_r');
  standard(x);
  d(x,'DamagePerSphere','damage_per_sphere','每个法球基础魔法伤害');
  d(x,'MaxSpheresToUse','max_spheres_to_use','最多使用法球数');
  d(x,'UpgradeExecuteThreshold','execute_threshold','升级处决生命比例');
  d(x,'QHastePerRank','q_haste_per_rank','Q每级急速');
  d(x,'TOOLTIPONLYTotalQHaste','tooltip_q_haste','升级后Q总急速');
  d(x,'MinSpheresToUse','min_spheres_to_use','最少使用法球数');
  d(x,'APRatio','ap_ratio','法强系数');
  damage(x,'DamageCalc','damage_per_sphere_total','每个法球总魔法伤害','当前树为每个法球基础值+法强；实际使用数量待接。');
  damage(x,'MinDamageCalc','minimum_damage','最低三球总魔法伤害','仅表示源树最少三球的算术值，不表示实际施法一定满足命中。');
  damage(x,'MaxDamageCalc','maximum_damage','最多七球总魔法伤害','仅表示源树最多七球的算术上限，不表示每次施法必定满球。');
  pending(x,'法球数量与处决','自身三球、附近额外法球、实际3至7球数量和低于15%处决触发未接线；不创建默认满球或处决结果。');
  rest(x);
}

// 塔莉垭：自身移速、对英雄伤害和已明确的工作地面资源保留，墙体与击飞位移为范围外/待接。
{
  const x=start('taliyah_p');
  standard(x,{passive:true});
  d(x,'FallOffTime','wall_speed_falloff_ms','靠墙移速衰减时间（毫秒）',1000,'毫秒');
  calc(x,'TotalMS','wall_move_speed_ratio','靠墙移动速度比例','角色等级断点树保留；实际等级值外供，不按断点端点展开。');
  pending(x,'靠墙判定与移速衰减','靠墙条件、离墙与受伤打断及衰减算法未接线；保留自身收益，不创建常驻移速效果。');
  rest(x);
}
{
  const x=start('taliyah_q');
  standard(x);
  d(x,'WorkedGroundCDR','worked_ground_cooldown_ratio','工作地面冷却缩短比例');
  d(x,'MinimumWorkedGroundCD','minimum_worked_ground_cooldown_ms','工作地面冷却下限（毫秒）',1000,'毫秒');
  d(x,'BigRockDamageMult','big_rock_damage_multiplier','工作地面大石块伤害倍数');
  d(x,'BaseDamage','base_damage','石块基础魔法伤害');
  d(x,'ExtraMissileReducedDamagePercent','subsequent_rock_reduction_ratio','后续石块伤害减少比例',.01);
  d(x,'SlowPercent','slow_ratio','工作地面大石块减速比例',.01);
  d(x,'SlowDuration','slow_duration_ms','工作地面减速持续时间（毫秒）',1000,'毫秒');
  d(x,'GroundExhaustDuration','worked_ground_duration_ms','工作地面持续时间（毫秒）',1000,'毫秒');
  d(x,'BigRockManaCost','worked_ground_mana_cost','工作地面大石块额外法力消耗');
  d(x,'APRatio','ap_ratio','法强系数');
  damage(x,'RockDamage','rock_damage','石穿单发魔法伤害','当前树基础伤害+法强；后续石块对同一目标的折减保留为待接分支。');
  damage(x,'BigRockDamage','big_rock_damage','工作地面大石块魔法伤害','当前树基础单发伤害乘1.8；工作地面条件待接。');
  damage(x,'MaxDamageTooltip','max_rock_damage','最多石块合计伤害','当前tooltipOnly公式为单发伤害乘2.6，只作为源算术上限，不把五发总伤或命中资格写成默认结果。');
  effect(x,'worked_ground_mana_cost','工作地面大石块额外法力消耗',[result('consume','消耗额外法力','RESOURCE_CHANGE','SOURCE',val('worked_ground_mana_cost'),{attributeKey:'mana',operation:'CONSUME'})],null,'仅工作地面再次施放时适用；实际工作地面状态与扣除时点未接线。');
  exclude(x,'小兵野怪专用与纯空间字段','MinionExecuteThreshold、MonsterBonusFlatDamage、MonsterStunDuration、AoERadius、AoERadiusBig、GroundExhaustRadius只用于小兵/野怪或范围几何。');
  sourceOnly(x,'mSpellCalculations.TotalBonusFlatMonsterDamage','仅小兵/野怪额外伤害数值，当前英雄单目标范围外。','范围外');
  sourceOnly(x,'mSpellCalculations.{c363b92e}','仅小兵/野怪额外伤害的工作地面倍率，当前英雄单目标范围外。','范围外');
  pending(x,'工作地面、后续石块与资源','工作地面生成/消耗、后续石块同目标折减、减速时点和怪物专用分支未接线；不把5发或工作地面状态默认初始化。');
  rest(x,{MinionExecuteThreshold:['范围外','仅小兵处决阈值，无当前英雄目标用途。'],MonsterBonusFlatDamage:['范围外','仅野怪额外伤害。'],MonsterStunDuration:['范围外','仅野怪控制时长。'],AoERadius:['范围外','纯石块范围半径。'],AoERadiusBig:['范围外','纯大石块范围半径。'],GroundExhaustRadius:['范围外','纯工作地面空间半径。']});
}
{
  const x=start('taliyah_w');
  standard(x);
  d(x,'KnockupDelay','knockup_delay_ms','岩突击飞延迟（毫秒）',1000,'毫秒');
  exclude(x,'击飞距离','ThrowDistance为纯位移距离；击飞对当前敌方目标的控制依赖保留。');
  pending(x,'岩突位移控制','选择落点、击飞方向与实际控制资格未接线；不创建空控制结果或默认位移过程。');
  rest(x,{ThrowDistance:['范围外','纯击飞位移距离。']});
}
{
  const x=start('taliyah_e');
  standard(x);
  d(x,'BaseDamage','scatter_base_damage','撒石阵基础魔法伤害');
  d(x,'BaseDetonationDamage','detonation_base_damage','触发爆炸基础魔法伤害');
  d(x,'StunDuration','stun_duration_ms','触发爆炸基础晕眩时长（毫秒）',1000,'毫秒');
  d(x,'MaxStunDuration','max_stun_duration_ms','触发爆炸最大晕眩时长（毫秒）',1000,'毫秒');
  d(x,'MineDamageFalloff','mine_damage_falloff_ratio','后续地雷伤害衰减比例');
  d(x,'DelayBetweenRows','delay_between_rows_ms','地雷行间隔（毫秒）',1000,'毫秒');
  d(x,'SlowPercent','slow_ratio','撒石阵减速比例',.01);
  d(x,'MineLifetime','mine_lifetime_ms','地雷持续时间（毫秒）',1000,'毫秒');
  damage(x,'ScatterDamage','scatter_damage','撒石阵初始魔法伤害','对当前敌方目标的初始地雷伤害。');
  damage(x,'DetonationDamage','detonation_damage','撒石阵触发爆炸魔法伤害','位移触发的单次爆炸伤害；后续地雷衰减保留待接。');
  damage(x,'MaxDetonationDamageTooltip','max_detonation_damage','撒石阵最大爆炸伤害','当前tooltipOnly公式为单次爆炸乘2.5，只作为源算术上限。');
  exclude(x,'野怪倍率与地雷几何','MonsterModPercent仅野怪倍率；MineRadius为纯地雷半径。');
  pending(x,'位移触发与多段时序','敌人冲刺/位移触发、额外晕眩、地雷行间隔和同一目标后续伤害衰减未接线；不把总地雷伤害合并为一次命中。');
  rest(x,{MonsterModPercent:['范围外','仅野怪伤害倍率。'],MineRadius:['范围外','纯地雷空间半径。']});
}
{
  const x=start('taliyah_r');
  standard(x,{channelDuration:true});
  d(x,'DamageLockoutTime','damage_lockout_ms','受英雄或建筑伤害后的施放锁定时间（毫秒）',1000,'毫秒');
  exclude(x,'墙体、冲浪与位移几何','MaxJumpRange、MinJumpRange、MaxJumpRangeOverWalls、WallDuration、WallLength、MissileSpeed、ManaCost、DCapPassive均为墙体/冲浪空间或重复资源字段。');
  pending(x,'墙幔与冲浪','墙体生成、骑墙移动、受伤打断和不可再次施放条件未接线；本批不创建纯空间过程或0法力占位。');
  rest(x,{MaxJumpRange:['范围外','纯冲浪跳跃范围。'],MinJumpRange:['范围外','纯冲浪最小范围。'],MaxJumpRangeOverWalls:['范围外','纯越墙范围。'],WallDuration:['范围外','墙体存在时间。'],WallLength:['范围外','墙体长度。'],DCapPassive:['范围外','墙体相关被动空间字段。'],MissileSpeed:['范围外','墙体生成移动速度。'],ManaCost:['范围外','与公共法力成本重复且不新增当前战斗效果。']});
}

if(Object.keys(plan.skills).length!==20)throw Error('必须覆盖20槽');
