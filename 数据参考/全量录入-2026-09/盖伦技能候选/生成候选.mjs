// 仅从已冻结资料生成盖伦录入候选；不连接应用、数据库或浏览器。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const hero = path.resolve(dir, '../英雄');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const rawPath = path.join(hero, '成长补充原始资料/16.17/garen.bin.json');
const rawBytes = fs.readFileSync(rawPath);
const bin = JSON.parse(rawBytes);
const zhPath = path.join(hero, '原始资料/zh_CN/champion/Garen.json');
const enPath = path.join(hero, '原始资料/en_US/champion/Garen.json');
const zh = read(zhPath).data.Garen;
const en = read(enPath).data.Garen;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (hash(rawBytes) !== 'dd48d09a3ca8c1db5a35a3f47993cb7e1afd25b92e8a30d7748a37fcc238767e') throw Error('已冻结的盖伦客户端响应发生变化，先重新核对');
const spellPath = slot => `Characters/Garen/Spells/Garen${slot === 'P' ? 'Passive' : slot}Ability/Garen${slot === 'P' ? 'Passive' : slot}`;
const spell = slot => bin[spellPath(slot)].mSpell;
// 客户端单精度浮点误差只在候选中整理到六位小数，原始对象完整保留。
const clean = v => Math.round(v * 1e6) / 1e6;
const values = (slot, key) => {
  const v = spell(slot).DataValues.find(x => x.name === key);
  if (!v?.values) throw Error(`${slot}.${key} 缺值，禁止补零`);
  return v.values.map(clean);
};
const ranks = (slot, key) => values(slot, key).slice(1, slot === 'R' ? 4 : 6);
const value = (slot, key) => values(slot, key)[1];
const ms = n => Math.round(n * 1000);
const levels = arr => Object.fromEntries(arr.map((v, i) => [String(i + 1), v]));
const fixed = value => ({ kind: 'FIXED', value });
const param = parameterKey => ({ kind: 'PARAMETER', parameterKey });
const formula = formulaKey => ({ kind: 'FORMULA', formulaKey });
const pnode = parameterKey => ({ nodeType: 'PARAMETER', parameterKey });
const attr = (attributeOwner, attributeKey, attributeValueKind = 'TOTAL') => ({ nodeType: 'ATTRIBUTE', attributeOwner, attributeKey, attributeValueKind });
const op = (operation, a, b) => ({ nodeType: 'OPERATION', operation, operands: [a, b] });
const add = (a, b) => op('ADD', a, b);
const mul = (a, b) => op('MULTIPLY', a, b);
const ruleValue = value => ({ value, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null });
const parameter = (key, name, val, description, mode) => ({ parameterKey: key, name, valueType: (Array.isArray(val) ? val : [val]).every(Number.isInteger) ? 'INTEGER' : 'DECIMAL', valueMode: mode ?? (Array.isArray(val) ? 'SKILL_LEVEL' : 'FIXED'), fixedValue: Array.isArray(val) ? null : val, levelValues: Array.isArray(val) ? levels(val) : null, description, sortOrder: 0 });
const formulaEntry = (key, name, expression, description) => ({ formulaKey: key, name, description, sortOrder: 0, expression });
const life = (duration, scope = 'SOURCE', max = fixed(1), stackMode = 'KEEP') => ({ durationValue: duration, maxStacksValue: max, applicationStacksValue: fixed(1), instanceScope: scope, reapplicationStackMode: stackMode, reapplicationDurationMode: duration ? 'REFRESH_ALL' : null, expiryMode: duration ? 'ALL_AT_ONCE' : 'EXPLICIT_ONLY', periodicIntervalValue: null, firstPeriodicExecution: null });
const persistent = (readMode = 'APPLICATION_SNAPSHOT', stack = 'SHARED') => ({ moment: 'PERSISTENT', valueReadMode: readMode, stackValueMode: stack, reapplicationValueMode: readMode === 'MOMENT_EVALUATION' || stack === 'PER_STACK' ? null : 'REPLACE', periodicExecutionMode: null });
const statusBehavior = { moment: 'PERSISTENT', valueReadMode: null, stackValueMode: null, reapplicationValueMode: null, periodicExecutionMode: null };
const result = (key, name, type, target, value, detail, behavior = null, block = null, description = null) => ({ resultKey: key, name, resultType: type, target, description, sortOrder: 0, lifecycleBehavior: behavior, spellShieldBlockScope: block, valueRule: value === null ? null : ruleValue(value), detail });
const effect = (key, name, lifecycle, results, description = null) => ({ effectKey: key, name, description, sortOrder: 0, lifecycle, results });
const damage = (key, name, val, type, crit = null, block = null) => result(key, name, 'DAMAGE', 'TARGET', val, { damageTypeKey: type, deliveryKind: 'SKILL', originKind: 'DIRECT', critical: { mode: crit ? 'SOURCE_CRIT_CHANCE' : 'DISALLOWED', multiplierValue: crit }, vampRules: [] }, null, block, '吸血结构暂不逐技能复制；须由游戏级吸血规则及确有必要的例外补齐，空列表不表示该伤害不吸血。');
const attribute = (key, name, val, attrKey, operation = 'INCREASE', behavior = persistent(), zone = 'attribute_flat_add', target = 'SOURCE') => result(key, name, 'ATTRIBUTE_CHANGE', target, val, { attributeKey: attrKey, operation, modifierZoneKey: zone }, behavior);
const moment = (momentType, stepKey = null) => ({ momentType, stepKey });
const binding = (key, effectKey, m) => ({ bindingKey: key, effectKey, moment: m, sortOrder: 0 });
const step = (key, name, stepType, detail, description = null) => ({ stepKey: key, name, description, sortOrder: 0, stepType, detail });
const process = (key, name, cooldown, steps, bindings, description, start = moment('PROCESS_START')) => ({ processKey: key, name, activationType: 'ACTIVE', description, sortOrder: 0, cooldown: cooldown ? { durationValue: cooldown, startMoment: start } : null, steps, effectBindings: bindings, stateOperations: [] });
const execute = (key, effectKey) => ({ actionKey: key, name: '执行效果', actionType: 'EXECUTE_EFFECT', sortOrder: 0, targetContext: 'CURRENT_TARGET', detail: { effectKey }, runtimeInputBindings: [], resultModifiers: [] });
const trigger = (key, name, eventSource, actions, description, conditionGroups = []) => ({ ruleKey: key, name, description, sortOrder: 0, eventSource, conditionGroups, actions, perTargetCooldown: null, maxTriggersPerProcess: null });
const categoryGroup = categories => [{ groupKey: 'allowed_target', name: '允许的命中目标', sortOrder: 0, conditions: [{ conditionKey: 'category', conditionType: 'TARGET_CATEGORY_CHECK', sortOrder: 0, detail: { categories } }] }];
const skill = (slot, i) => ({ skillKey: `garen_${slot.toLowerCase()}`, name: `盖伦·${slot === 'P' ? zh.passive.name : zh.spells[i - 1].name}`, description: '召唤师峡谷 16.17 候选。具体已核数值及未表达机制见盖伦技能候选资料；尚未完成页面录入和运行验证。', maxLevel: slot === 'P' ? 1 : slot === 'R' ? 3 : 5, status: 'ENABLED', sortOrder: i, skillCategoryKeys: [] });
const candidate = (slot, i) => ({ slot, skill: skill(slot, i), completeness: '部分可录入；不等于机制完成', imageSource: `https://ddragon.leagueoflegends.com/cdn/16.17.1/img/${slot === 'P' ? 'passive/' + zh.passive.image.full : 'spell/' + zh.spells[i - 1].image.full}`, parameters: [], formulas: [], effects: [], internalStates: [], processes: [], triggerRules: [], componentNotes: [], blockedRecipes: [], gaps: [] });
const P = candidate('P', 0);
const curve = spell('P').mSpellCalculations.RegenCalc.mFormulaParts[0];
const regen = [];
let amount = curve.mLevel1Value;
for (let level = 1; level <= 18; level++) {
  if (level > 1) {
    let inc = curve.mInitialBonusPerLevel;
    for (const point of curve.mBreakpoints) if (level >= point.mLevel) inc = point.mBonusPerLevelAtAndAfter;
    amount += inc;
  }
  regen.push(clean(amount / 100));
}
P.parameters = [parameter('regen_ratio_per_5s', '每 5 秒最大生命回复比例', regen, '当前客户端 RegenCalc 分段曲线；每 5 秒单位由官方 9.20 说明与 Wiki 补证。1–18 级。', 'CHARACTER_LEVEL'), parameter('damage_pause_ms', '受影响后暂停回复时长（毫秒）', ms(value('P', 'DamageTimer')), '客户端 DamageTimer；仅召唤师峡谷，不取竞技场覆盖值。')];
P.formulas = [formulaEntry('regen_per_5s', '被动提供的每 5 秒生命回复', mul(attr('SOURCE', 'hp'), pnode('regen_ratio_per_5s')), '总生命值 × 等级回复比例；此值不是每秒治疗，也不是瞬时直接治疗。')];
P.effects = [effect('perseverance_regen', '坚韧持续生命回复', life(null), [attribute('regen', '提高生命回复', formula('regen_per_5s'), 'hp_regen', 'INCREASE', persistent('MOMENT_EVALUATION'))], '只有处于被动生效期才挂载；该效果自身不判断受击、出生和暂停后的重新启动。')];
P.componentNotes = ['参数和公式可录；hp_regen 效果必须确认该属性按每 5 秒计量，且全局基础回复百分比不会错误放大本被动。', '被动不是永久无条件启用；缺少自动规则时只保存数值和效果候选，不能标记角色机制已完成。'];
P.blockedRecipes = [{ name: '被动自动恢复与暂停', desired: ['出生/获得技能时按真实初始条件启用回复。', '受到敌方英雄、史诗野怪或防御塔有效伤害，或敌方技能/召唤师技能影响时，停止回复并重置 8 秒暂停。', '暂停自然结束后重新施加持续回复。'], currentContractBlock: 'DAMAGE_TAKEN 不提供伤害来源类别；TARGET_CATEGORY_CHECK 只适用于 SKILL_HIT/BASIC_ATTACK_HIT；没有通用“受到敌方技能影响”事件及出生启动入口。不能将所有受伤均当作中断条件。' }];
P.gaps = ['完全被护盾挡住的伤害是否中断、无伤害技能与免疫事件边界，当前版本脚本证据不足；旧 Wiki 表示全护盾/无敌不刷新，不能直接升级为已核当前行为。', '回复周期 0.5 秒来自非同版本 Wiki；现有生命回复属性能否独立实现该周期和回复增益规则待核。', '19–20 级：当前客户端曲线外推为 10.5%/10.9%，不在本批 1–18 级参数表内；须与全局等级范围一起处理。'];

const Q = candidate('Q', 1);
Q.parameters = [parameter('base_damage', '强化普攻额外基础伤害', ranks('Q', 'BaseDamage'), '客户端 BaseDamage。'), parameter('bonus_ad_ratio', '额外伤害总攻击力系数', clean(value('Q', 'tADRatio') - 1), '客户端完整攻击系数 1.5 减去普通攻击自带的 1.0；不要再叠加 1.5。'), parameter('move_speed_ratio', '移速提升比例', value('Q', 'MovementSpeedAmount'), '比例 0.35=35%。'), parameter('move_duration_ms', '移速持续时间（毫秒）', ranks('Q', 'MovementSpeedDuration').map(ms), '客户端当前值；官方 26.5 交叉核对。'), parameter('silence_duration_ms', '沉默基础时长（毫秒）', ms(value('Q', 'SilenceDuration')), '目标韧性是否缩短状态时长属于全局控制规则。'), parameter('attack_window_ms', '强化普攻保留时间（毫秒）', ms(value('Q', 'AttackWindow')), '客户端 AttackWindow。'), parameter('cooldown_ms', '基础冷却（毫秒）', ms(spell('Q').cooldownTime[1]), '施放 Q 时开始。')];
Q.formulas = [formulaEntry('bonus_damage', 'Q 额外伤害', add(pnode('base_damage'), mul(attr('SOURCE', 'attack_damage'), pnode('bonus_ad_ratio'))), '普通攻击由普通攻击流程结算；这里只增加不暴击的额外部分。')];
Q.effects = [effect('move_speed', 'Q 加速', life(param('move_duration_ms')), [attribute('move_speed', '提升百分比移速', param('move_speed_ratio'), 'move_speed_percent')]), effect('remove_slow', '解除当前减速', null, [result('cleanse', '移除减速', 'STATUS_OPERATION', 'SOURCE', null, { statusKey: '$减速状态键', operation: 'REMOVE' })], '仅在所有减速共同使用该状态语义且移除覆盖各来源实例时成立；无重施免疫。'), effect('bonus_damage', 'Q 强化普攻额外伤害', null, [damage('damage', '额外物理伤害', formula('bonus_damage'), '$物理伤害键')]), effect('silence', 'Q 沉默', life(param('silence_duration_ms'), 'SOURCE_TARGET'), [result('silence', '沉默目标', 'STATUS_OPERATION', 'TARGET', null, { statusKey: '$沉默状态键', operation: 'APPLY' }, statusBehavior, 'RESULT')], '法术护盾只拦沉默结果，额外伤害不设拦截；由旧 Wiki 机制补证，当前交互需再核。')];
Q.processes = [process('cast_and_attack', '施放并等待强化普攻命中', param('cooldown_ms'), [step('attack_window', '等待强化普攻', 'EMPOWERED_BASIC_ATTACK', { windowValue: param('attack_window_ms'), consumeMoment: 'ATTACK_HIT' }, '命中消费时点为候选；致盲/闪避/被格挡是否消费待实际机制核对。')], [binding('speed', 'move_speed', moment('PROCESS_START')), binding('cleanse', 'remove_slow', moment('PROCESS_START')), binding('damage', 'bonus_damage', moment('STEP_EXECUTION', 'attack_window')), binding('silence', 'silence', moment('STEP_EXECUTION', 'attack_window'))], '有界普通命中路径候选；不覆盖重置普攻计时器、强化攻击突进、结构目标的沉默免疫及丢失目标。')];
Q.componentNotes = ['数值、公式、加速及额外伤害可先录；沉默/解除减速效果须先映射真实状态目录。', 'cast_and_attack 是有条件候选，不应标记为完整已验收；绑定在 STEP_EXECUTION，不在施放 Q 时直接造成伤害。', '不要另加 SKILL_USED→START_PROCESS，除非确认主动过程并非由主动施放入口启动，避免双启动。'];
Q.gaps = ['没有普攻计时器重置结果。', '状态只有名称和描述；缺少控制分类、韧性适用与免疫规则，不能靠创建 silence 名称让运行时自动理解沉默。', '解除全部减速与多来源状态实例移除语义未冻结。', '强化普攻保留/消费的致盲、闪避、攻击取消、法术护盾交互待核；建议先录组件，暂不勾完整。', '普通攻击部分可暴击、额外部分不暴击；额外伤害具有生命偷取例外。当前吸血契约未冻结，暂不在每个技能复制比例。', '额外攻击距离、突进与攻击不可取消由攻击/空间执行表达，本候选未伪造数值。'];

const W = candidate('W', 2);
W.parameters = [parameter('resist_per_kill', '每次击杀提供双抗', value('W', 'ResistGainOnKill'), '客户端值。'), parameter('resist_max', '最大额外双抗', value('W', 'ResistMax'), '当前 30。'), parameter('max_stacks', '被动最大层数', clean(value('W', 'ResistMax') / value('W', 'ResistGainOnKill')), '30/0.2=150；每单位 1 层。'), parameter('reduction_ratio', '承受伤害减少比例', ranks('W', 'DRPercent'), '当前 25/29/33/37/41%，不是所有等级 30%。'), parameter('reduction_duration_ms', '减伤持续时间（毫秒）', ms(value('W', 'DRDuration')), '固定 4 秒。'), parameter('tenacity_ratio', '韧性提升比例', value('W', 'UpfrontTenacity'), '0.6=60%；全局不同来源韧性组合仍需核对。'), parameter('upfront_duration_ms', '护盾及韧性时长（毫秒）', ms(value('W', 'UpfrontDuration')), '固定 750 毫秒。'), parameter('base_shield', '基础护盾', ranks('W', 'BaseShield'), '当前 65/85/105/125/145。'), parameter('bonus_hp_ratio', '护盾额外生命系数', value('W', 'ShieldHealthRatio'), '18%额外生命，不是最大生命。'), parameter('cooldown_ms', '基础冷却（毫秒）', spell('W').cooldownTime.slice(1, 6).map(ms), '客户端与 Data Dragon 相同。')];
W.formulas = [formulaEntry('shield', 'W 护盾量', add(pnode('base_shield'), mul(attr('SOURCE', 'hp', 'BONUS'), pnode('bonus_hp_ratio'))), '基础护盾 + 0.18×额外生命；基础生命成长不重复计入。')];
const resistance = effect('kill_resists', '勇气永久击杀双抗', life(null, 'SOURCE', param('max_stacks'), 'INCREASE'), [attribute('armor', '每层护甲', param('resist_per_kill'), 'armor', 'INCREASE', persistent('APPLICATION_SNAPSHOT', 'PER_STACK')), attribute('mr', '每层魔抗', param('resist_per_kill'), 'magic_resistance', 'INCREASE', persistent('APPLICATION_SNAPSHOT', 'PER_STACK'))], '每次真实击杀增加 1 层，最多 150 层；无自然到期。跨死亡保留仍取决于全局实例清理规则。');
const reductions = ['$物理伤害键', '$魔法伤害键'].map((type, i) => result(i === 0 ? 'physical_reduction' : 'magic_reduction', i === 0 ? '减少承受物理伤害' : '减少承受魔法伤害', 'DAMAGE_MODIFIER', 'SOURCE', param('reduction_ratio'), { modifierZoneKey: '$承受伤害比例乘区键', direction: 'TAKEN', operation: 'DECREASE', damageTypeKey: type, deliveryKind: 'ANY', originKind: 'ANY', criticalFilter: 'ANY' }, persistent()));
W.effects = [resistance, effect('damage_reduction', '勇气减伤', life(param('reduction_duration_ms')), reductions, '只选物理/魔法，避免将普通减伤误用于真实伤害。与其他减伤来源的乘区顺序需要游戏级规则。'), effect('upfront_shield', '勇气短时护盾', life(param('upfront_duration_ms')), [result('shield', '获得全伤害护盾', 'NORMAL_SHIELD', 'SOURCE', formula('shield'), { absorbedDamageTypeKey: null, decayMode: 'NONE' }, persistent())], '护盾耗尽按现有契约提前结束本效果；韧性放在独立效果，避免随护盾耗尽消失。'), effect('upfront_tenacity', '勇气短时韧性', life(param('upfront_duration_ms')), [attribute('tenacity', '提高韧性', param('tenacity_ratio'), 'tenacity_percent')], '与护盾共用750毫秒参数，但生命周期独立，护盾耗尽不结束本效果。')];
W.processes = [process('cast', '施放勇气', param('cooldown_ms'), [step('activate', '立即生效', 'IMMEDIATE', {})], [binding('damage_reduction', 'damage_reduction', moment('PROCESS_START')), binding('upfront_shield', 'upfront_shield', moment('PROCESS_START')), binding('upfront_tenacity', 'upfront_tenacity', moment('PROCESS_START'))], '主动施放立即开始 4 秒减伤和各自独立的 0.75 秒护盾、韧性；没有额外施法延迟。')];
W.triggerRules = [trigger('kill_stack', '击杀单位增加永久双抗', { eventType: 'KILL', detail: {} }, [execute('add_resist_stack', 'kill_resists')], '仅由拥有者真实击杀事件触发；助攻不加层。KILL 是否排除建筑/守卫等非计数单位需要全局事件边界核对。')];
W.componentNotes = ['被动以同一来源永久效果的层数表达，无需再造第二份内部计数器。', '按现有普通护盾契约，耗尽会结束所属生命周期；主动护盾与韧性必须拆成两个效果，共用750毫秒参数，在同一施法开始时分别挂接。', '当前 W 满层后不再额外提高 10% 双抗；官方 25.11 已删除。', '乘区映射、不同韧性来源组合、永久实例跨死亡保留未核前，不把完整执行行为标记通过。'];
W.gaps = ['KILL 事件没有可用的目标类别条件；先明确它是否只表示可为 W 加层的单位击杀，不能用 SKILL_HIT 类别条件硬套。', 'tenacity_percent 直接增加 0.6 可存储，但不同来源韧性按何种方式组合属于尚未核对的游戏级规则。', 'W 被动在未学习 W 时是否记录击杀以及解锁后如何结转未由当前技能脚本核实。'];

const E = candidate('E', 3);
E.parameters = [parameter('base_damage_per_spin', '每圈基础伤害', ranks('E', 'BaseDamagePerTick'), '当前客户端；已不带旧的随英雄等级额外伤害。'), parameter('ad_ratio_per_spin', '每圈总攻击力系数', ranks('E', 'ADRatioPerTick'), '官方 26.5 与客户端一致。'), parameter('base_spins', '基础圈数', value('E', 'NumTicks'), '只作为基础项，不能把整次技能固定为 7 圈。'), parameter('as_per_spin', '每增加一圈所需有效额外攻速', value('E', 'ASPerTick'), '0.25=25%；仅装备及自然等级来源的额外攻速。'), parameter('duration_ms', '旋转总时长（毫秒）', ms(value('E', 'Duration')), '固定 3000。'), parameter('shred_hits', '同一英雄触发削甲所需命中', value('E', 'StacksToShred'), '第 6 圈命中触发，逐目标累计。'), parameter('shred_ratio', '削甲比例', value('E', 'ShredAmount'), '目标护甲减少 25%。'), parameter('shred_duration_ms', '削甲持续时间（毫秒）', ms(value('E', 'ShredDuration')), '6000。'), parameter('nearest_bonus', '最近敌人额外伤害比例', value('E', 'NearestEnemyBonus'), '最近目标 ×1.25；不是只有单个目标时才增伤。'), parameter('crit_bonus_ratio', '额外暴击伤害折算系数', value('E', 'CritMod'), '官方 26.1：只取普通攻击额外暴击伤害的 30%。'), parameter('one', '单位倍率常数', 1, '公式常数。'), parameter('cooldown_ms', '旋转结束后基础冷却（毫秒）', spell('E').cooldownTime.slice(1, 6).map(ms), '9/8.25/7.5/6.75/6 秒；不返还提前结束的剩余旋转时间。'), parameter('radius', '范围半径', en.spells[2].range[0], '官方 Data Dragon 为 325；客户端 castRange 不能当实际伤害半径。')];
const eBase = () => add(pnode('base_damage_per_spin'), mul(attr('SOURCE', 'attack_damage'), pnode('ad_ratio_per_spin')));
E.formulas = [formulaEntry('damage_per_spin', '每圈普通目标伤害', eBase(), '基础伤害 + 总攻击力×技能等级系数。'), formulaEntry('nearest_damage_per_spin', '每圈最近目标伤害', mul(eBase(), add(pnode('one'), pnode('nearest_bonus'))), '只供“当前命中目标是最近敌人”时使用；现有事件不能自动识别该条件。'), formulaEntry('critical_multiplier', 'E 暴击伤害倍率', add(pnode('one'), mul(pnode('crit_bonus_ratio'), add(pnode('one'), attr('SOURCE', 'critical_strike_damage_bonus_percent')))), '盖伦普通攻击基础暴击倍率 2。E=1+0.3×(2+额外暴伤百分点−1)=1.3+0.3×额外暴伤；无尽额外0.3时为1.39。')];
E.effects = [effect('spin_damage', 'E 一圈普通目标伤害', null, [damage('damage', '每圈物理伤害', formula('damage_per_spin'), '$物理伤害键', formula('critical_multiplier'))]), effect('nearest_spin_damage', 'E 一圈最近目标伤害', null, [damage('damage', '最近目标每圈物理伤害', formula('nearest_damage_per_spin'), '$物理伤害键', formula('critical_multiplier'))], '与普通目标效果二选一，不可同一次命中同时结算两份。'), effect('armor_shred', 'E 英雄护甲削减', life(param('shred_duration_ms'), 'SOURCE_TARGET'), [attribute('armor_shred', '削减目标护甲', param('shred_ratio'), 'armor', 'DECREASE', persistent(), '$护甲比例乘区键', 'TARGET')], '必须用护甲比例乘区；不要把目标当前护甲×25%转成自引用的动态平减。')];
E.internalStates = [{ stateKey: 'target_spin_hits', name: '本次旋转对当前英雄的命中次数', scope: 'TARGET', stateType: 'COUNTER', description: '计数结构候选；必须能在新一次旋转开始时清空所有旧目标的计数，当前批量清空入口不足。', sortOrder: 0, detail: { initialValue: fixed(0), maxValue: param('shred_hits') } }];
E.componentNotes = ['每圈伤害和暴击倍率公式可先录。两个伤害效果互斥，不提供会误伤全部目标的通用 SKILL_HIT 规则。', '削甲效果可先录，命中计数和刷新规则待补；内部计数器仅为候选，未接成完整触发链。', '吸血列表为空不代表 E 无全能吸血；当前全局规则缺少范围伤害对小兵效率描述，见统一缺口。'];
E.blockedRecipes = [{ name: '完整旋转次数及节奏', desired: 'N = 7 + floor(装备和自然等级提供的额外攻速 / 0.25)，在 3 秒内安排 N 次有效命中；冷却在正常或提前结束时开始。', currentContractBlock: '公式只有二元加减乘除/最小/最大，无向下取整；属性不区分攻速来源；首次伤害时间及 N 次间隔的实际脚本未抽出。不能填 RUNTIME_INPUT 并不给来源，不能固定 7 次。' }, { name: '最近目标与削甲', desired: '每次范围命中辨认最近敌人；对每名英雄单独累计，首次第 6 次命中后施加 6 秒削甲；后续刷新时点需补证。', currentContractBlock: '没有最近目标、距离或攻击范围筛选事件值；计数器不能在施放时批量重置所有旧目标实例。只知道第 6 次触发，当前源码不能证明后续每次命中都刷新。' }, { name: '移动、取消与冷却', desired: '旋转期间可移动、忽略单位碰撞、限制普通攻击；允许提前结束，结束才开始冷却。', currentContractBlock: '不能用普通 CHANNEL 冒充，否则改变受控中断语义。现有 RECAST 是步骤，缺少旋转并行重施入口；冷却启动仅选单个时点，正常结束及主动取消统一处理待设计。' }];
E.gaps = ['缺向下取整及装备/自然等级攻速来源口径。', '缺最近目标选择及多目标范围。', '逐次暴击的随机判定范围（按圈或按目标）未核。', '削甲首次生效在第 6 次伤害前后、后续刷新及新一轮旋转计数重置待当前脚本/实际证据。', '重施最短锁定时间常见资料为 1 秒，但当前冻结数据未找到直接证据，未录入确定参数。', '不得沿用已删除的等级附加伤害、150%野怪伤害、剩余旋转时间冷却返还。'];

const R = candidate('R', 4);
R.parameters = [parameter('base_damage', '基础真实伤害', ranks('R', 'BaseDamage'), '官方 26.14 与当前客户端确认 125/200/275。'), parameter('missing_hp_ratio', '目标已损失生命系数', ranks('R', 'ExecuteDamage'), '25/30/35%，名称含 Execute 不表示无条件处决。'), parameter('cooldown_ms', '基础冷却（毫秒）', spell('R').cooldownTime.slice(1, 4).map(ms), '120/100/80 秒。'), parameter('cast_time_ms', '施法时间（毫秒）', 435, '客户端 spellCastTime≈0.435，Wiki 常规施法时间补证；失败/无敌交互另列。'), parameter('reveal_duration_ms', '提供视野时长（毫秒）', ms(value('R', 'RevealDuration')), '官方 9.20 及当前客户端 RevealDuration。'), parameter('cast_range', '施法距离', en.spells[3].range[0], '官方 Data Dragon 400。')];
R.formulas = [formulaEntry('damage', '德玛西亚正义真实伤害', add(pnode('base_damage'), mul(attr('TARGET', 'hp', 'MISSING'), pnode('missing_hp_ratio'))), '命中时目标已损失生命；不用施法时快照替代命中时生命。')];
R.effects = [effect('justice_damage', '德玛西亚正义命中伤害', null, [damage('damage', '真实伤害', formula('damage'), '$真实伤害键', null, 'RESULT')], '普通伤害结果；仍服从护盾、免疫和生命下限。不使用 EXECUTE。')];
R.triggerRules = [trigger('on_hit', '德玛西亚正义实际命中', { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'garen_r' } }, [execute('damage', 'justice_damage')], '以实际 SKILL_HIT 为输入；施法与目标有效性由宿主确认，此规则本身不产生命中。', categoryGroup(['CHAMPION']))];
R.componentNotes = ['数值、公式、伤害效果与英雄实际命中规则可录；先映射真实伤害目录键。', '不在 SKILL_USED 事件直接结算伤害；只保存 435 毫秒参数不等于已经实现施法过程。', '不添加纯 DELAY 空过程：当前保存校验要求至少效果绑定或内部状态操作；也不为过校验制造没有业务含义的状态。'];
R.blockedRecipes = [{ name: '指定英雄施法与视野', desired: '目标为敌方英雄，400 距离；施法开始提供 1 秒视野，约 435 毫秒后对仍满足实际命中规则的目标结算伤害。', currentContractBlock: '状态目录只有名称/描述，没有真正视野能力。过程不支持无效果无状态的独立施法段；强绑定延迟结束伤害又缺少目标有效性和实际命中事件的完整关联。' }];
R.gaps = ['施法期间目标死亡/不可选中、取消时是否消耗冷却的精确条件待核；不写未经证实的失败退款规则。', '可见性不是普通状态名称能自动执行的功能；当前只保存参数与来源。'];

const skills = [P, Q, W, E, R];
for (const s of skills) for (const field of ['parameters', 'formulas', 'effects', 'internalStates', 'processes', 'triggerRules']) s[field].forEach((v, i) => v.sortOrder = i);
// 主负责人通过真实页面回读的目录键；这里只更新资料，不写应用。
const knownCatalog = { '$物理伤害键': 'physics', '$魔法伤害键': 'magic', '$真实伤害键': 'real', '$护甲比例乘区键': 'attribute_percent_bonus' };
const resolveCatalog = value => Array.isArray(value) ? value.map(resolveCatalog) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveCatalog(v)])) : knownCatalog[value] ?? value;
const files = [rawPath, zhPath, enPath].map(p => ({ path: path.relative(dir, p).replaceAll('\\', '/'), bytes: fs.statSync(p).size, sha256: hash(fs.readFileSync(p)) }));
const output = {
  schemaVersion: 1,
  preparedAt: '2026-09-06',
  scope: '英雄联盟召唤师峡谷，Data Dragon 16.17.1，客户端提取数据 16.17。常规英雄等级 1–18；不包含斗魂竞技场/海克斯大乱斗覆盖。',
  purpose: '人工通过管理页面逐项录入的候选；本脚本不调用任何业务接口。各对象采用当前前端请求字段，但目录占位键须由页面实读映射；可保存不等于游戏运行机制已完成。',
  clientBuild: '16.17.8104348+branch.releases-16-17.content.release',
  sourceFiles: files,
  catalogMappings: { evidence: '主负责人本轮真实页面回读：physics/real/magic 与 attribute_percent_bonus。后者目录为属性/比例加算/属性百分比，削甲与其他来源组合的最终顺序仍待统一规则。', values: knownCatalog },
  catalogPlaceholders: {
    '$减速状态键': { type: '状态', status: '待目录建立及语义核对', meaning: '所有可被 Q 解除的移速减慢，须确认跨来源清除' },
    '$沉默状态键': { type: '状态', status: '待目录建立及语义核对', meaning: '沉默；基础时长受韧性等全局控制规则影响' },
    '$承受伤害比例乘区键': { type: '乘区', status: '主负责人确认目录尚无，待建并核对组合规则', required: { domain: 'DAMAGE', calculationMode: 'RATIO_ADD', applicationStage: 'DAMAGE_POST_DEFENSE' } }
  },
  commonGaps: ['当前百分比属性统一使用 1=100%，但“可相加存储”与游戏不同来源的最终乘法叠加并不等价；移速、韧性、减伤与削甲组合需要统一规则。', '技能伤害的 vampRules 当前只是暂存结构，前端类型注明应迁往来源吸血属性与游戏级结算；本批不为每个技能复制普通吸血。', '官方 26.1 全能吸血：一般效率 100%，范围/持续/宠物伤害对小兵效率 33%；当前效果过滤缺少范围伤害类别与目标类别效率组合。Q 额外伤害生命偷取例外待全局规则落地。', '客户端二进制 JSON 的数据值与公式不足以证明完整技能脚本；不能凭 raw spellCastTime/castRange 或空 effect 数组推断业务行为。'],
  skills: resolveCatalog(skills)
};
fs.writeFileSync(path.join(dir, '盖伦技能录入候选.json'), JSON.stringify(output, null, 2) + '\n');
const selected = Object.fromEntries(Object.entries(bin).filter(([key, v]) => v.__type === 'SpellObject' && (key.includes('/GarenPassiveAbility/') || /\/Garen[QWER]Ability\//.test(key))));
fs.writeFileSync(path.join(dir, '客户端技能原字段.json'), JSON.stringify({ sourceUrl: 'https://raw.communitydragon.org/16.17/game/data/characters/garen/garen.bin.json', sourceFetchedAt: '2026-09-06T14:20:10.546Z', rawSha256: hash(rawBytes), rawBytes: rawBytes.length, clientBuild: output.clientBuild, note: '从已有完整原始响应逐对象复制，保留浮点精度；由 CommunityDragon 提取，非 Riot 官方发布接口。数据仅覆盖客户端公开对象，不包含完整服务端技能脚本。', objects: selected }, null, 2) + '\n');
console.log(JSON.stringify({ skills: skills.length, parameters: skills.reduce((n, s) => n + s.parameters.length, 0), formulas: skills.reduce((n, s) => n + s.formulas.length, 0), effects: skills.reduce((n, s) => n + s.effects.length, 0), processes: skills.reduce((n, s) => n + s.processes.length, 0), triggerRules: skills.reduce((n, s) => n + s.triggerRules.length, 0), sourceHash: hash(rawBytes) }));
