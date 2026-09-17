import {begin,data,literal,formula,pn,attr,add,mul,op,val,common,effect,result,runtime,pending,exclude} from './英雄工具.mjs';

{
 const x=begin('kalista_p');
 pending(x,'普通攻击不可取消与攻击起手','当前主根扩展说明明确攻击不能取消，影响1V1动作提交而非仅视觉；没有通用动作取消资格配置，未把它伪装成属性效果。','系统');
 pending(x,'当前标准模式被动正文','当前根GameModeInteger=1；mLocKeys指向动态Spell_KalistaP_Tooltip_1，但冻结中文表缺少此键。直接mBuff旧描述仍含普攻90%且子引用有其他英雄残留文案，不能据此确认当前普攻倍率。原始冲突保留在后十来源补充.json。','来源');
 exclude(x,'武术姿态位移与鞋品质','冲刺方向、距离与鞋等级空间模拟后置；不可取消攻击的动作约束仍单独待配。');
 exclude(x,'特殊模式攻速转换','GameModeInteger=2只来自Cherry/URF覆盖；ModesASCap6、ModesAStoADRatio.7不套入当前普通模式。');
}
{
 const x=begin('kalista_q');common(x);
 data(x,'BaseDamage','base_damage','穿刺基础伤害');
 data(x,'TotalADRatio','total_ad_ratio','穿刺总攻击力系数');
 const part=x.p.mSpellCalculations.TotalDamage.mFormulaParts[1];
 if(part.mStat!==2||part.mDataValue!=='TotalADRatio')throw Error('Q总攻击力具名来源不符');
 x.c.proofs.push({source:'mSpellCalculations.TotalDamage.mFormulaParts[1]',raw:part,semantic:'当前具名TotalADRatio明确总攻击力；未使用通用省略字段默认解码'});
 formula(x,'first_target_damage','穿刺首个目标物理伤害',add(pn('base_damage'),mul(pn('total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL'))),'当前主根10/75/140/205/270 +1.05总攻击力。只首目标，不借用Q索引0的-55或旧子对象。');
 pending(x,'Q伤害资格与E长矛来源','Q直接首目标公式保留；普通首目标是否及何时追加E长矛、Q暴击资格/法术护盾与吸血规则尚待完整核对，不以默认伤害结果强行接线。','来源');
 pending(x,'Q真实命中与E层数关系','尚未创建伤害结果；真实Q命中与本卡莉丝塔对该英雄的E长矛归属、加层因果尚未接线。');
 pending(x,'施放过程和冷却起算','保留9秒基础冷却与60/65/70/75/80法力，独立法力消耗效果没有绑定猜测起算的过程。','来源');
 exclude(x,'击杀穿透及转移长矛到下一目标','多个单位间穿透和已有E层数转移属于本批多目标支路；不把下一个对象的层数加回当前单目标。');
 exclude(x,'Q后的位移','Q与武术姿态冲刺的空间输入后置，不能因此删除本次伤害。');
}
{
 const x=begin('kalista_w');
 exclude(x,'誓约者协同伤害','需要卡莉丝塔和额外友方誓约者共同命中同一目标，超出1V1双角色范围；不保存10%-18%最大生命伤害为单人被动。');
 exclude(x,'侦查幽灵及显形','主动是独立侦查召唤物、巡逻和视野；依既定范围跳过，不录纯视野机制或无消耗占位。');
}
{
 const x=begin('kalista_e');common(x,{cooldown:false});
 data(x,'FakedCooldown','cooldown_ms','基础冷却时间（毫秒）',{scale:1000});
 x.c.proofs.push({source:'mLocKeys.keyCooldown',key:'Spell_KalistaExpungeWrapper_Cooldown',text:'@FakedCooldown@秒冷却时间',rawRootCooldown:x.p.Cooldown,semantic:'主根Cooldown全部0是包装技能内部字段，当前展示冷却明确取FakedCooldown，不录0冷却'});
 data(x,'BaseDamage','first_spear_base_damage','撕裂第一根基础伤害');
 data(x,'BaseADRatio','first_spear_ad_ratio','撕裂第一根攻击力系数');
 data(x,'APRatio','first_spear_other_stat_ratio','撕裂第一根未解码属性系数');
 data(x,'AdditionalBaseDamage','additional_spear_base_damage','撕裂每根后续长矛基础伤害');
 data(x,'AdditionalADRatio','additional_spear_ad_ratio','撕裂后续长矛攻击力系数');
 data(x,'AdditionalAPRatio','additional_spear_other_stat_ratio','撕裂后续长矛未解码属性系数');
 data(x,'SlowAmount','base_slow_ratio','撕裂基础减速比例');
 data(x,'SlowAPRatio','other_stat_slow_ratio','撕裂未解码属性减速系数');
 data(x,'SlowDuration','slow_duration_ms','撕裂减速期限（毫秒）',{scale:1000});
 data(x,'ManaRefund','mana_refund','撕裂满足击杀条件的法力返还');
 literal(x,'spear_duration_ms','长矛存留说明期限（毫秒）',4000,'当前mLocKeys正文与官方均明确长矛在目标身上存留4秒；不表示每层独立计时或整体刷新已证。','mLocKeys.keyTooltip');
 runtime(x,'current_attack_damage_value','本次撕裂计算所需攻击力值','当前NormalDamage/AdditionalDamage明确mStat=2但省略mStatFormula；本批不依通用默认解码其取值种类。只有确认该节点的实际攻击力口径后才能绑定，不能用0代替。');
 runtime(x,'current_other_stat_value','本次撕裂未解码属性值','当前同型StatByNamedDataValue节点只给APRatio/AdditionalAPRatio/SlowAPRatio，不显式给mStat/mStatFormula；名字提示法强但不足以认定默认枚举。本批用同一未绑定输入保留原数学式，不能直接取AP或默认为0。');
 runtime(x,'additional_spear_count','第一根之外实际长矛数量','只有目标确有至少一根属于此卡莉丝塔的长矛时才能使用；非负整数表示实际总根数减1。零表示一根总量，不是无长矛。未构造初始层、254上限或状态供值。','INTEGER');
 const ad=()=>pn('current_attack_damage_value'),other=()=>pn('current_other_stat_value');
 const first=()=>add(pn('first_spear_base_damage'),mul(pn('first_spear_ad_ratio'),ad()),mul(pn('first_spear_other_stat_ratio'),other()));
 const extra=()=>add(pn('additional_spear_base_damage'),mul(pn('additional_spear_ad_ratio'),ad()),mul(pn('additional_spear_other_stat_ratio'),other()));
 formula(x,'first_spear_damage','撕裂第一根伤害计算',first(),'5/15/25/35/45 +.7×已核对攻击力输入+.65×未解码属性输入；输入口径尚未绑定，不宣称完整可执行伤害。');
 formula(x,'additional_spear_damage','撕裂每根后续长矛伤害计算',extra(),'7/14/21/28/35 +.2/.275/.35/.425/.5×攻击力输入+.5×未解码属性输入。');
 formula(x,'total_spear_damage','至少一根长矛时撕裂总伤害',add(first(),mul(pn('additional_spear_count'),extra())),'目标至少有一根长矛时：第一根 +（实际根数-1）×每根后续伤害。没有把第一根重复按总根数累乘；无长矛目标不适用此式。');
 formula(x,'slow_ratio','撕裂减速比例计算',add(pn('base_slow_ratio'),mul(pn('other_stat_slow_ratio'),other())),'基础.1/.18/.26/.34/.42 + .0005×同一未解码属性输入；比例1表示100%，没有自创封顶值或把.0005转成.05。');
 effect(x,'kill_mana_refund','撕裂实际击杀后法力返还',[result('refund','返还撕裂法力','RESOURCE_CHANGE','SOURCE',val('mana_refund'),{attributeKey:'mana',operation:'REFUND'})],null,'10/15/20/25/30法力；仅在本次撕裂真实击杀至少一个目标时，由后续因果规则调用，本轮未绑定。');
 effect(x,'kill_cooldown_reset','撕裂实际击杀后本技能冷却重置',[result('reset','重置撕裂冷却','COOLDOWN_CHANGE','SOURCE',null,{affectedSkillScope:{mode:'SKILLS',skillKeys:['kalista_e'],skillCategoryKeys:[]},operation:'RESET'})],null,'仅实际由本次撕裂击杀至少一个目标后的E重置；不连接任意英雄击杀事件。');
 pending(x,'攻击力与另一个属性节点的默认枚举','三个完整数学关系保留明确参数输入；没有借旧子技能、通用默认枚举或系数字段名直接接总AD/AP。需要确认其属性取值口径后再绑定。','来源');
 pending(x,'长矛层上限与刷新语义','主正文说可任意叠加，同根MaxSpears=254；不能直接把254当对玩家承诺上限。4秒存留的逐根计时/整体刷新未明确，且当前源与目标必须成对归属，未建假生命周期或初始层。','来源');
 pending(x,'单次撕裂击杀因果与冷却','英雄目标击杀条件仍在1V1范围；独立返还和重置效果不能由普通KILL或无条件施放调用。包装技能零Cooldown也不证明零冷却；过程起算与Q/E状态消费尚未接线。');
 pending(x,'减速结果字典','当前目录只有眩晕，减速不是总移速直接减去比例；没有当前可用减速字典，不用眩晕或空字段冒充减速。','系统');
 pending(x,'伤害与减速资格','完整伤害的法术护盾、暴击、吸血资格及减速的法术护盾范围未确证；只保留未绑定数学关系，不创建默认伤害或减速结果。','来源');
 exclude(x,'史诗野怪伤害和多目标拔矛','EpicMonsterDamageMod以及同时对多个单位拔矛执行后置；至少一个英雄被本次E击杀的返还依赖保留。');
}
{
 const x=begin('kalista_r');
 exclude(x,'誓约者救援与抛投','全部依赖第三名友方誓约者，包括凝滞、拉回、其点击投放和碰撞击飞；按已确认1V1范围跳过，不单独把友军击飞包装为卡莉丝塔自身R效果。');
}
