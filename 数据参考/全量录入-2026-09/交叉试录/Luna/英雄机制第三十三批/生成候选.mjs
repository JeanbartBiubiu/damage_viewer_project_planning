import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const __filename = fileURLToPath(import.meta.url);
const ROOT = path.dirname(__filename);
const INPUT = path.join(ROOT, '输入包');
const BATCH = '英雄机制第三十三批';
const API_BASE = 'http://127.0.0.1:8080/api/admin/games/lol';
const now = new Date().toISOString();
const read = (p) => JSON.parse(fs.readFileSync(path.join(INPUT, p), 'utf8'));
const inputVersion = read('输入版本.json');
const binding = read('来源绑定与当前文本.json');
const snapshot = read('参考资料/当前20槽保护快照.json');
const reuse = read('参考资料/公共参数复用清单.json');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const fileSha = (p) => sha(fs.readFileSync(path.join(INPUT, p)));
const writeJson = (p, value) => fs.writeFileSync(path.join(ROOT, p), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const clientBuild = '16.17.8104348+branch.releases-16-17.content.release';
const sourceVersion = { clientVersion: inputVersion.clientVersion || '16.17', officialVersion: inputVersion.officialVersion || '16.17.1', build: clientBuild };
const order = [
  'sona_p','sona_q','sona_w','sona_e','sona_r',
  'soraka_p','soraka_q','soraka_w','soraka_e','soraka_r',
  'karma_p','karma_q','karma_w','karma_e','karma_r',
  'seraphine_p','seraphine_q','seraphine_w','seraphine_e','seraphine_r',
];
const heroById = (id) => binding.heroes.find((h) => h.id === id);
const heroIdOf = (key) => ({ sona: 'Sona', soraka: 'Soraka', karma: 'Karma', seraphine: 'Seraphine' })[key.split('_')[0]];
const slotOf = (key) => key.split('_')[1].toUpperCase();
const boundSkill = (key) => {
  const h = heroById(heroIdOf(key));
  const s = h?.skills.find((x) => x.skillKey === key || x.slot === slotOf(key));
  if (!s) throw new Error(`缺少来源绑定 ${key}`);
  return { h, s, raw: s.object?.mSpell || {} };
};
const selectedDataValues = (raw) => Object.fromEntries((raw.DataValues || []).map((x) => [x.name, x.values ? x.values.slice() : null]));
const selectedCalculations = (raw) => raw.mSpellCalculations || {};
const officialEvidence = (heroId, slot) => {
  const p = `参考资料/官方英文/${heroId}.json`;
  const x = read(p);
  const h = x.data?.[heroId] || x[heroId] || x;
  if (slot === 'P') return { path: `data.${heroId}.passive`, name: h.passive?.name || null, description: h.passive?.description || null, tooltip: h.passive?.tooltip || null, relevantEnemyTips: h.enemytips || [] };
  const i = { Q: 0, W: 1, E: 2, R: 3 }[slot];
  const s = h.spells?.[i];
  return { path: `data.${heroId}.spells[${i}]`, name: s?.name || null, description: s?.description || null, tooltip: s?.tooltip || null };
};
const sourceFor = (key) => {
  const { h, s, raw } = boundSkill(key);
  const clientFile = `参考资料/客户端原文/${h.id}.json.gz`;
  const zhFile = `参考资料/官方中文/${h.id}.json`;
  const enFile = `参考资料/官方英文/${h.id}.json`;
  return {
    hero: h.id, heroName: h.name, heroKey: h.key, slot: slotOf(key), resourceType: h.source.resourceType,
    rootPath: h.source.rootPath, spellPath: s.binding, bindingAvailable: true,
    clientFile, clientSha256: h.source.client.sha256, clientCompressedSha256: fileSha(clientFile), clientBuild: h.source.client.contentVersion || clientBuild,
    officialZhFile: zhFile, officialZhSha256: fileSha(zhFile), officialEnFile: enFile, officialEnSha256: fileSha(enFile),
    currentBoundText: s.currentTexts, raw: { dataValues: selectedDataValues(raw), calculations: selectedCalculations(raw), spellCastTime: raw.spellCastTime ?? null, mCastTime: raw.mCastTime ?? null, cooldownTime: raw.cooldownTime ?? null, mMaxAmmo: raw.mMaxAmmo ?? null, mAmmoRechargeTime: raw.mAmmoRechargeTime ?? null, mDoesNotConsumeMana: raw.mDoesNotConsumeMana ?? null, mDoesNotConsumeCooldown: raw.mDoesNotConsumeCooldown ?? null },
    officialEvidence: officialEvidence(h.id, slotOf(key)), currentTextPath: `来源绑定与当前文本.json -> ${h.id}/${slotOf(key)}/currentTexts`,
  };
};
const param = (parameterKey, name, valueType, valueMode, fixedValue, levelValues, description, sortOrder) => ({ parameterKey, name, valueType, valueMode, fixedValue: fixedValue ?? null, levelValues: levelValues ? Object.fromEntries(levelValues.map((v, i) => [String(i + 1), v])) : null, description, sortOrder });
const fixed = (k, n, t, v, d, o) => param(k, n, t, 'FIXED', v, null, d, o);
const levels = (k, n, t, v, d, o) => param(k, n, t, 'SKILL_LEVEL', null, v, d, o);
const runtime = (k, n, t, d, o) => param(k, n, t, 'RUNTIME_INPUT', null, null, d, o);
const P = (parameterKey) => ({ nodeType: 'PARAMETER', parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: 'ATTRIBUTE', attributeOwner, attributeKey, attributeValueKind });
const O = (operation, left, right) => ({ nodeType: 'OPERATION', operation, operands: [left, right] });
const add = (a, b) => O('ADD', a, b);
const mul = (a, b) => O('MULTIPLY', a, b);
const min = (a, b) => O('MIN', a, b);
const formula = (formulaKey, name, expression, description, sortOrder) => ({ formulaKey, name, expression, description, sortOrder });
const AP = () => A('SOURCE', 'ability_power', 'TOTAL');
const HP = () => A('SOURCE', 'hp', 'TOTAL');
const addAP = (base, ratio) => add(P(base), mul(P(ratio), AP()));
const normalShield = (effectKey, durationKey, formulaKey, name, description, sortOrder) => ({ effectKey, name, description, sortOrder, lifecycle: { durationValue: { kind: 'PARAMETER', parameterKey: durationKey }, maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 }, instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null, firstPeriodicExecution: null }, results: [{ resultKey: 'self_shield', name: '自身护盾', resultType: 'NORMAL_SHIELD', target: 'SOURCE', description: '只定义施法后自身护盾的成熟生命周期，触发资格由事件层接线。', sortOrder: 10, lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE', periodicExecutionMode: null }, valueRule: { value: { kind: 'FORMULA', formulaKey }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }, detail: { absorbedDamageTypeKey: null, decayMode: 'NONE' } }] });
const writes = {}, excluded = {}, pending = {}, notes = {};
const put = (key, params, formulas, effects, ex, pe, note) => { writes[key] = { parameters: params, formulas, effects, processes: [], internalStates: [], triggerRules: [] }; excluded[key] = ex; pending[key] = pe; notes[key] = note; };

// 娑娜：被动与基础技能的数值组成，触发与乐曲资格留给后续事件层。
put('sona_p', [
  fixed('power_chord_basic_casts','能量和弦基础技能次数','INTEGER',3,'当前正文@PowerChordPassiveCountMax@为3；只保存计数。',10),
  fixed('accelerando_ability_haste_per_stack','渐入佳音每层基础技能急速','DECIMAL',0.5,'当前AccelerandoAHPerStack=0.5；每层数值不是技能急速百分比。',20),
  fixed('accelerando_ability_haste_cap','渐入佳音基础技能急速上限','DECIMAL',60,'当前AccelerandoCap=60；达到上限后不再继续加层。',30),
  fixed('accelerando_stack_cap','渐入佳音层数上限','INTEGER',120,'由60/0.5得出的整数层数上限，供边界核对，不展开成长曲线。',40),
  fixed('accelerando_ult_cooldown_refund_ms','满层终极技能冷却缩短','INTEGER',1500,'当前AccelerandoUltCDR=1.5秒，转换为1500毫秒。',50),
  runtime('accelerando_current_stacks','当前渐入佳音层数','INTEGER','实际战斗层数由运行输入提供，范围0至120，不默认满层。',60),
  runtime('power_chord_character_level_base_damage','能量和弦等级基础伤害','DECIMAL','PowerChordDamage有等级1/9断点原值，但完整等级算法未证，按实际等级值外供。',70),
  fixed('power_chord_ap_ratio','能量和弦法强比例','DECIMAL',0.2,'当前PowerChordDamage树的AP比例为0.2。',80),
], [
  formula('accelerando_current_ability_haste','当前渐入佳音基础技能急速',min(P('accelerando_ability_haste_cap'),mul(P('accelerando_ability_haste_per_stack'),P('accelerando_current_stacks'))),'MIN(60,0.5×当前层数)，上限进入最终公式。',10),
  formula('power_chord_bonus_magic_damage','能量和弦额外魔法伤害',add(P('power_chord_character_level_base_damage'),mul(P('power_chord_ap_ratio'),AP())),'等级基础值由运行输入提供，再加0.2×来源总法强。',20),
], [], [{ item:'第三友军收益', reason:'本轮1v1不建立第三友军效果；Q/W/E自身或单一敌人的附加数值仍按各技能保留。' }], [{ item:'三次基础技能、满层转终极技能冷却和最新乐曲选择', reason:'当前正文明确关系，实际计数与时序尚未接线。' }], '被动只保留有证计数、上限、冷却缩短和当前消费树；未知等级曲线不做线性猜测。');

put('sona_q', [
  levels('base_damage','英勇赞美诗基础魔法伤害','INTEGER',[50,85,120,155,190],'当前BaseDamage技能等级1至5。',10),
  fixed('ability_power_ratio','基础魔法伤害法强比例','DECIMAL',0.4,'当前TotalDamage树使用0.4×来源总法强。',20),
  levels('melody_attack_base_damage','乐曲强化普攻基础魔法伤害','INTEGER',[10,15,20,25,30],'当前BaseOnHitDamage技能等级1至5；是下次攻击额外组成。',30),
  fixed('melody_attack_ap_ratio','乐曲强化普攻法强比例','DECIMAL',0.1,'当前TotalOnHitDamage树使用0.1×来源总法强。',40),
  fixed('melody_aura_duration_ms','英勇赞美诗乐曲持续时间','INTEGER',3000,'当前AuraDuration=3秒，转换为3000毫秒。',50),
  fixed('melody_attack_window_ms','强化普攻窗口','INTEGER',5000,'当前OnHitDuration=5秒，转换为5000毫秒。',60),
  fixed('melody_interval_ms','基础技能公共间隔','INTEGER',500,'当前BaseGlobalCD=0.5秒，区别于8秒公共冷却。',70),
  runtime('chord_character_level_base_damage','Q能量和弦等级基础伤害','DECIMAL','TotalStaccatoDamage有等级断点，完整等级曲线未证，按当前等级值外供。',80),
  fixed('chord_ap_ratio','Q能量和弦法强比例','DECIMAL',0.3,'当前TotalStaccatoDamage树AP比例为0.3。',90),
  fixed('cast_time_ms','基础施法时间','INTEGER',250,'当前spellCastTime=0.25秒，转换为250毫秒。',100),
], [
  formula('magic_damage','英勇赞美诗单一敌方魔法伤害',addAP('base_damage','ability_power_ratio'),'只保留唯一敌方命中，未把第二目标或命中顺序建成结果。',10),
  formula('melody_attack_magic_damage','乐曲强化普攻额外魔法伤害',addAP('melody_attack_base_damage','melody_attack_ap_ratio'),'强化普攻窗口内的额外组成，不等于自动普攻事件。',20),
  formula('chord_magic_damage','Q能量和弦魔法伤害',add(P('chord_character_level_base_damage'),mul(P('chord_ap_ratio'),AP())),'TotalStaccatoDamage等级基础值外供，再加0.3×法强。',30),
], [], [{ item:'第二个敌方目标', reason:'范围型第二目标不进入本轮唯一敌人组成。' }], [{ item:'乐曲强化普攻资格与能量和弦切换', reason:'需要基础技能计数和当前乐曲事件，不能自动触发。' }], 'Q基础伤害、下一次攻击额外伤害和Q强化和弦分开保存；公共间隔不当作伤害周期。');

put('sona_w', [
  fixed('cooldown_ms','坚毅咏叹调冷却时间','INTEGER',10000,'客户端当前槽缺少可用冷却值；官方16.17.1明确为10秒，新增为正式候选。',10),
  levels('base_heal','自身治疗基础值','INTEGER',[30,45,60,75,90],'当前BaseHeal技能等级1至5。',20),
  fixed('heal_ap_ratio','自身治疗法强比例','DECIMAL',0.3,'当前TotalHeal树AP比例为0.3。',30),
  levels('base_shield','护盾基础值','INTEGER',[25,45,65,85,105],'当前BaseShield技能等级1至5。',40),
  fixed('shield_ap_ratio','护盾法强比例','DECIMAL',0.25,'当前TotalShield树AP比例为0.25。',50),
  fixed('shield_duration_ms','护盾持续时间','INTEGER',1500,'当前ShieldDuration=1.5秒，转换为1500毫秒。',60),
  fixed('aura_duration_ms','光环持续时间','INTEGER',3000,'当前AuraDuration=3秒，转换为3000毫秒。',70),
  fixed('diminuendo_duration_ms','减伤持续时间','INTEGER',3000,'当前DiminuendoDuration=3秒，转换为3000毫秒。',80),
  fixed('melody_interval_ms','基础技能公共间隔','INTEGER',500,'当前BaseGlobalCD=0.5秒，保存为独立间隔。',100),
  fixed('diminuendo_base_ratio','减伤基础比例','DECIMAL',0.25,'当前TotalDiminuendoWeakenPercent树以0.25为基础比例；正文按百分比显示。',110),
  fixed('diminuendo_ap_ratio','减伤法强比例','DECIMAL',0.0004,'当前TotalDiminuendoWeakenPercent树法强系数为0.0004。',120),
  fixed('cast_time_ms','基础施法时间','INTEGER',250,'当前spellCastTime=0.25秒，转换为250毫秒。',130),
], [
  formula('self_heal','坚毅咏叹调自身治疗',addAP('base_heal','heal_ap_ratio'),'自身治疗数值；友方治疗资格和事件待接。',10),
  formula('shield_value','坚毅咏叹调护盾值',addAP('base_shield','shield_ap_ratio'),'护盾数值保留供后续符合资格的自身护盾事件引用。',20),
  formula('diminuendo_damage_reduction_ratio','坚毅咏叹调减伤比例',add(P('diminuendo_base_ratio'),mul(P('diminuendo_ap_ratio'),AP())),'减伤比例只保存公式，不创建自动减伤状态；结果为比例而非百分数点。',30),
], [], [{ item:'第三友方治疗、友方护盾和友方光环', reason:'当前正文为其他友方英雄方向，本轮1v1不录其收益。' }], [{ item:'自身光环资格与护盾施放事件', reason:'数值已明确，但自身资格和施放时点未证，不创建无条件效果。' }], 'W补入官方10秒冷却；治疗、护盾、减伤分别成式，减伤比例保留正值并进入最终公式。');

put('sona_e', [
  fixed('self_move_speed_ratio','自身移动速度比例','DECIMAL',0.2,'当前SelfBaseMovementSpeed=0.2。',10),
  fixed('self_move_speed_ap_ratio','自身移动速度法强比例','DECIMAL',0.0002,'当前自身加速树法强系数为0.0002。',30),
  fixed('self_move_speed_duration_min_ms','自身加速最短时间','INTEGER',3000,'当前无受伤延长的最短3秒。',50),
  fixed('self_move_speed_duration_max_ms','自身加速最长时间','INTEGER',7000,'当前无受伤延长的最长7秒。',60),
  fixed('aura_duration_ms','迅捷奏鸣曲光环持续时间','INTEGER',3000,'当前AuraDuration=3秒。',80),
  fixed('melody_interval_ms','基础技能公共间隔','INTEGER',500,'当前BaseGlobalCD=0.5秒。',90),
  fixed('tempo_slow_base_ratio','节奏减速基础比例','DECIMAL',0.5,'当前TotalTempoMoveSpeedSlow以0.5比例显示为50%。',100),
  fixed('tempo_slow_ap_ratio','节奏减速法强比例','DECIMAL',0.0004,'当前TotalTempoMoveSpeedSlow法强系数为0.0004。',110),
  fixed('tempo_duration_ms','节奏减速持续时间','INTEGER',2000,'当前TempoDuration=2秒。',120),
  fixed('cast_time_ms','基础施法时间','INTEGER',250,'当前spellCastTime=0.25秒。',130),
], [
  formula('self_move_speed_ratio_value','自身移动速度加成比例',add(P('self_move_speed_ratio'),mul(P('self_move_speed_ap_ratio'),AP())),'自身加速按比例保存，未映射为move_speed_percent属性效果。',10),
  formula('tempo_slow_ratio','节奏减速比例',add(P('tempo_slow_base_ratio'),mul(P('tempo_slow_ap_ratio'),AP())),'减速比例是数值组成，不自动创建减速事件。',20),
], [], [{ item:'第三友方加速效果', reason:'纯第三友方收益超出本轮，整支不录。' }], [{ item:'自身加速无伤延长、乐曲切换和减速触发', reason:'时序和事件资格待接，不把持续时间当伤害周期。' }], 'E只保留自身移动速度、减速及时间参数，第三友方加速整支排除。');

put('sona_r', [
  levels('base_damage','狂舞终乐章基础魔法伤害','INTEGER',[150,250,350],'当前BaseDamage技能等级1至3。',10),
  fixed('ability_power_ratio','终极技能法强比例','DECIMAL',0.5,'当前TotalDamage树AP比例为0.5。',20),
  fixed('stun_duration_ms','眩晕持续时间','INTEGER',1500,'当前StunDuration=1.5秒。',30),
  fixed('cast_time_ms','基础施法时间','INTEGER',250,'当前spellCastTime=0.25秒。',40),
], [formula('magic_damage','狂舞终乐章单一敌方魔法伤害',addAP('base_damage','ability_power_ratio'),'只保留单一敌方命中。',10)], [], [{ item:'多名敌人额外命中', reason:'本轮按唯一敌人，额外目标不建结果。' }], [{ item:'眩晕命中事件', reason:'只保存持续时间，实际命中和控制事件待接。' }], 'R按终极技能自身三段等级数组保存，控制持续时间为独立整数毫秒参数。');

// 索拉卡：第三友方被动与W外部治疗排除；Q/E/R保留单一敌人和自身收益。
put('soraka_p', [], [], [], [
  { item:'低于40%生命值的另一名友方英雄与自身加速', reason:'明确依赖另一名友方英雄，本轮1v1不录自益效果。' },
], [], 'P为另一名友方英雄条件分支，整支排除而非把自益速度当无条件效果。');

put('soraka_q', [
  levels('base_damage','流星坠落基础魔法伤害','INTEGER',[85,120,155,190,225],'当前BaseDamage技能等级1至5。',10),
  fixed('ability_power_ratio','流星坠落法强比例','DECIMAL',0.35,'当前TotalDamage树AP比例为0.35。',20),
  fixed('slow_ratio','流星坠落减速比例','DECIMAL',0.3,'当前MoveSpeedSlow正文显示30%，保存为0.3比例。',30),
  fixed('slow_duration_ms','流星坠落减速持续时间','INTEGER',1500,'当前SlowDuration=1.5秒。',40),
  levels('self_heal_base','流星坠落自身持续治疗基础值','INTEGER',[60,75,90,105,120],'当前BaseHoT技能等级1至5；是2.5秒总量。',50),
  fixed('self_heal_ap_ratio','流星坠落自身持续治疗法强比例','DECIMAL',0.3,'当前TotalHot树AP比例为0.3。',60),
  fixed('self_heal_duration_ms','流星坠落自身治疗持续时间','INTEGER',2500,'当前HotDuration=2.5秒；不按每次跳数拆分。',70),
  levels('self_move_speed_ratio','流星坠落自身移动速度比例','DECIMAL',[0.2,0.225,0.25,0.275,0.3],'当前MoveSpeedHaste技能等级1至5。',80),
  fixed('self_move_speed_duration_ms','流星坠落自身加速持续时间','INTEGER',2500,'当前MoveSpeedDuration=2.5秒。',90),
  fixed('cast_time_ms','基础施法时间','INTEGER',250,'当前spellCastTime=0.25秒。',100),
], [
  formula('magic_damage','流星坠落单一敌方魔法伤害',addAP('base_damage','ability_power_ratio'),'单一敌方命中，减速为独立数值参数。',10),
  formula('self_heal_total','流星坠落自身持续治疗总量',addAP('self_heal_base','self_heal_ap_ratio'),'TotalHot是2.5秒期间总治疗量，不默认每次周期治疗。',20),
], [], [{ item:'敌方范围外目标', reason:'本轮仅保留一个敌方目标。' }], [{ item:'Q命中、返身和持续治疗触发', reason:'数值与持续时间已明确，命中及治疗事件待接。' }], 'Q保留唯一敌人伤害和自身治疗；BaseHoT与HotDuration分开，不把持续时间误作伤害或治疗次数。');

put('soraka_w', [], [], [], [
  { item:'对另一名友方英雄治疗及其法力代价', reason:'W正文明确another ally，本轮没有友方目标，不录外部治疗结果。' },
], [], 'W整槽的外部友方收益明确排除，已有公共参数只保护不重复新增。');

put('soraka_e', [
  levels('base_damage','星界结界基础魔法伤害','INTEGER',[70,95,120,145,170],'当前BaseDamage技能等级1至5。',10),
  fixed('ability_power_ratio','星界结界法强比例','DECIMAL',0.4,'当前TotalDamage树AP比例为0.4。',20),
  fixed('field_duration_ms','星界结界场持续时间','INTEGER',1500,'当前RootDelay=1.5秒，作为同一敌人的场持续时间。',30),
  levels('root_duration_ms','星界结界禁锢持续时间','INTEGER',[1000,1250,1500,1750,2000],'当前RootDuration技能等级1至5，秒值转换为整数毫秒。',40),
  fixed('cast_time_ms','基础施法时间','INTEGER',250,'当前mCastTime=0.25秒，转换为250毫秒；spellCastTime未提供。',50),
], [formula('magic_damage','星界结界单一敌方单次魔法伤害',addAP('base_damage','ability_power_ratio'),'同一敌人第一次命中和满足留场条件的第二次命中各自引用该单次伤害式，不建周期tick。',10)], [], [{ item:'纯视野、额外目标和小兵专用支路', reason:'本轮仅单一敌方英雄命中，视野/兵线分支不录。' }], [{ item:'1.5秒后第二次命中与禁锢', reason:'触发取决于敌人仍在场，保存场时长和禁锢时长但不自动接线。' }], 'E把RootDelay/场时长、根持续时间和单次伤害分开，冷却或场时长不当作伤害tick。');

put('soraka_r', [
  levels('base_heal','祈愿自身基础治疗值','INTEGER',[150,250,350],'当前BaseHeal技能等级1至3。',10),
  fixed('ability_power_ratio','祈愿法强比例','DECIMAL',0.5,'当前HealingCalc树AP比例为0.5。',20),
  fixed('low_health_threshold_ratio','祈愿低生命阈值','DECIMAL',0.4,'当前低于40%生命值分支。',30),
  fixed('low_health_multiplier','祈愿低生命治疗倍率','DECIMAL',1.5,'当前AmpedHealing为完整治疗的1.5倍。',40),
  fixed('cast_time_ms','基础施法时间','INTEGER',250,'当前mCastTime=0.25秒，转换为250毫秒；spellCastTime未提供。',50),
], [
  formula('self_heal','祈愿自身治疗',addAP('base_heal','ability_power_ratio'),'自身目标的正常治疗式。',10),
  formula('self_low_health_heal','祈愿自身低生命治疗',mul(addAP('base_heal','ability_power_ratio'),P('low_health_multiplier')),'目标低于40%生命时按完整治疗式乘1.5；不能把两个阶段同时叠加。',20),
], [], [{ item:'全体其他友方英雄治疗', reason:'第三友方收益本轮不建立，保留自身治疗分支。' }], [{ item:'施放前生命资格与阶段选择', reason:'低生命阈值需要实际施放前输入；不能默认低生命或自动叠加两式。' }], 'R只保留自身正常/低生命两种候选公式，阶段输入互斥。');

// 卡尔玛：R为四级终极槽，Q/W/E各自五级；强化技能仍是分支而非完整变形。
put('karma_p', [
  fixed('mantra_cooldown_refund_ms','技能命中缩短梵咒冷却时间','INTEGER',4000,'当前SpellMantraRefund=4秒，转换为4000毫秒。',10),
], [], [], [
  { item:'普通攻击梵咒缩短、根节点法力和冷却', reason:'BasicAttackMantraRefund为空或未消费，根字段不证明主动扣费。' },
], [{ item:'伤害技能命中英雄后缩短R冷却', reason:'命中资格和次数由事件层接线，数值只保存一次缩短量。' }], 'P不填空的BasicAttackMantraRefund，保留有消费的SpellMantraRefund整数毫秒值。');

put('karma_q', [
  levels('base_damage','心灵烈焰基础魔法伤害','INTEGER',[60,110,160,210,260],'Q技能等级1至5的BaseDamage。',10),
  fixed('ability_power_ratio','心灵烈焰法强比例','DECIMAL',0.7,'当前Q TotalDamage树AP比例为0.7。',20),
  fixed('slow_ratio','心灵烈焰减速比例','DECIMAL',0.4,'原始SlowAmount为-0.4，正文按负百分比显示；候选保存正向减速幅度0.4。',30),
  fixed('slow_duration_ms','心灵烈焰减速持续时间','INTEGER',1500,'当前SlowDuration=1.5秒。',40),
  fixed('cast_time_ms','基础施法时间','INTEGER',250,'当前spellCastTime=0.25秒。',50),
], [formula('magic_damage','心灵烈焰单一敌方魔法伤害',addAP('base_damage','ability_power_ratio'),'只保留单一敌方伤害；是否强化由R/事件资格决定。',10)], [], [{ item:'周围额外敌人', reason:'本轮只保留唯一敌方命中。' }], [{ item:'梵咒强化资格与减速事件', reason:'IsEmpowered为条件分支，不能无条件触发强化技能。' }], 'Q的减速原值为负百分数表示，统一成正比例幅度并保留原文说明。');

put('karma_w', [
  levels('base_damage','坚定不移基础魔法伤害','INTEGER',[40,65,90,115,140],'W技能等级1至5的BaseDamage。',10),
  fixed('ability_power_ratio','坚定不移法强比例','DECIMAL',0.45,'当前InitialDamage/TotalDamage树AP比例为0.45。',20),
  fixed('tether_duration_ms','坚定不移连接持续时间','INTEGER',2000,'当前TetherDuration=2秒；不当作周期伤害间隔。',30),
  levels('root_duration_ms','坚定不移禁锢持续时间','INTEGER',[1600,1700,1800,1900,2000],'当前RootDuration技能等级1至5。',40),
  fixed('cast_time_ms','基础施法时间','INTEGER',250,'当前spellCastTime=0.25秒。',50),
], [formula('initial_magic_damage','坚定不移首次单一敌方魔法伤害',addAP('base_damage','ability_power_ratio'),'只保存首次命中伤害；2秒后再次伤害依赖同一敌人连接事件。',10)], [], [{ item:'LeashBreakRange与纯显形', reason:'连接断开几何/显形不是本轮组成。' }], [{ item:'首次命中后2秒第二次伤害和禁锢', reason:'事件需确认同一目标仍在连接中，不展开为周期tick。' }], 'W采用首次和后续同值机制说明，但只建立首次伤害公式。');

put('karma_e', [
  levels('base_shield','鼓舞基础护盾值','INTEGER',[80,130,180,230,280],'E技能等级1至5的BaseShield。',10),
  fixed('shield_ap_ratio','鼓舞法强比例','DECIMAL',0.6,'当前TotalShield树AP比例为0.6。',20),
  fixed('shield_duration_ms','鼓舞护盾持续时间','INTEGER',2500,'当前ShieldDuration=2.5秒。',30),
  fixed('move_speed_ratio','鼓舞自身移动速度比例','DECIMAL',0.4,'当前MoveSpeed=0.4；自身资格仍待补。',40),
  fixed('move_speed_duration_ms','鼓舞移动速度持续时间','INTEGER',2000,'当前MoveSpeedDuration=2秒。',50),
  fixed('cast_time_ms','基础施法时间','INTEGER',250,'当前spellCastTime=0.25秒。',60),
], [formula('shield_value','鼓舞自身护盾值',addAP('base_shield','shield_ap_ratio'),'护盾公式仅供符合资格的自身效果引用，不自动创建效果。',10)], [], [{ item:'附近友军护盾和移动速度', reason:'第三友军纯收益超出本轮；不创建友方效果。' }], [{ item:'自身目标资格和施放事件', reason:'自身光环资格未证，数值保留但不无条件自动应用。' }], 'E保留自身可用的护盾数值公式，第三友军分支和资格待接。');

put('karma_r', [
  fixed('mantra_window_ms','梵咒强化窗口','INTEGER',8000,'当前R窗口8秒，R是四级槽而非五级。',10),
  levels('rq_bonus_damage','梵咒Q冲击额外基础魔法伤害','INTEGER',[40,100,160,220],'RQBonusDamage按R技能等级1至4。',20),
  fixed('rq_bonus_ap_ratio','梵咒Q冲击额外法强比例','DECIMAL',0.3,'当前QBonusAPRatio=0.3。',30),
  levels('rq_field_damage','梵咒Q爆炸基础魔法伤害','INTEGER',[40,130,220,310],'RQDetonationDamage按R技能等级1至4。',40),
  fixed('rq_field_ap_ratio','梵咒Q爆炸法强比例','DECIMAL',0.5,'当前QDetonationAPRatio=0.5。',50),
  fixed('rq_slow_ratio','梵咒Q减速比例','DECIMAL',0.5,'原始RQSlow=-0.5，按正文显示转为正减速比例。',60),
  fixed('rq_slow_duration_ms','梵咒Q减速持续时间','INTEGER',1500,'当前RQSlowDuration=1.5秒。',70),
  levels('rw_bonus_root_ms','梵咒W额外禁锢时间','INTEGER',[500,750,1000,1250],'RWBonusRoot原值0.5/0.75/1/1.25秒，按R等级1至4转毫秒。',80),
  fixed('rw_base_heal_percent_points','梵咒W治疗基础百分数点','DECIMAL',17,'当前RWBaseHeal=17，公式先按百分数点再乘0.01。',90),
  fixed('rw_heal_percent_points_per_ap','梵咒W每点法强治疗百分数点','DECIMAL',0.01,'当前RWHealRatio=0.01百分数点/法强。',100),
  fixed('rw_percent_points_to_ratio','百分数点转比例','DECIMAL',0.01,'17百分数点需乘0.01才得到0.17比例。',110),
  runtime('rw_open_missing_health','梵咒W起始阶段已损生命','DECIMAL','起始治疗阶段的实际已损生命由运行输入提供，无默认且独立于结束阶段。',120),
  runtime('rw_close_missing_health','梵咒W结束阶段已损生命','DECIMAL','结束治疗阶段的实际已损生命由运行输入提供，无默认且独立于起始阶段。',130),
  levels('re_bonus_shield','梵咒E主目标额外护盾基础值','INTEGER',[45,85,125,165],'EBonusShield按R技能等级1至4。',140),
  fixed('re_bonus_shield_ap_ratio','梵咒E额外护盾法强比例','DECIMAL',0.45,'当前EBonusShieldRatio=0.45。',150),
  fixed('cast_time_ms','基础施法时间','INTEGER',250,'当前spellCastTime=0.25秒。',160),
], [
  formula('rq_impact_magic_damage','梵咒Q冲击额外魔法伤害',addAP('rq_bonus_damage','rq_bonus_ap_ratio'),'只表示RQ额外冲击段，不重算基础Q。',10),
  formula('rq_field_magic_damage','梵咒Q爆炸魔法伤害',addAP('rq_field_damage','rq_field_ap_ratio'),'爆炸段与冲击段分开；额外目标分配不在本轮。',20),
  formula('rw_heal_ratio','梵咒W治疗比例',mul(P('rw_percent_points_to_ratio'),add(P('rw_base_heal_percent_points'),mul(P('rw_heal_percent_points_per_ap'),AP()))),'按0.01×(17+0.01×法强)计算，避免把17直接当比例。',30),
  formula('rw_open_heal','梵咒W起始阶段治疗',mul(P('rw_open_missing_health'),mul(P('rw_percent_points_to_ratio'),add(P('rw_base_heal_percent_points'),mul(P('rw_heal_percent_points_per_ap'),AP())))),'起始阶段使用独立已损生命输入。',40),
  formula('rw_close_heal','梵咒W结束阶段治疗',mul(P('rw_close_missing_health'),mul(P('rw_percent_points_to_ratio'),add(P('rw_base_heal_percent_points'),mul(P('rw_heal_percent_points_per_ap'),AP())))),'结束阶段使用独立已损生命输入，不重复使用起始快照。',50),
  formula('re_bonus_shield_value','梵咒E主目标额外护盾值',addAP('re_bonus_shield','re_bonus_shield_ap_ratio'),'主目标额外护盾值；附近友方范围不录。',60),
], [], [{ item:'RQ额外敌人、RE附近友军护盾与移动速度', reason:'额外目标和第三友军收益本轮排除。' }], [{ item:'RQ强化条件、RW起始/结束事件、RE主目标资格', reason:'阶段与目标事件待接；两次RW使用各自实际已损生命输入。' }], 'R严格按四级独立数组保存，RW将起始/结束已损生命拆成两个运行输入，公式不隐含两倍。');

// 萨勒芬妮：被动第三个基础技能回响；只保留自身可证护盾和唯一敌人组成。
put('seraphine_p', [
  fixed('echo_basic_skill_count','回响所需基础技能次数','INTEGER',3,'当前正文每第三个基础技能回响一次。',10),
  fixed('note_max_count','音符目标层数上限','INTEGER',4,'当前MaxNotes=4；是计数边界而非默认当前层数。',20),
  fixed('note_duration_ms','音符持续时间','INTEGER',6000,'当前NoteDuration=6秒。',30),
  fixed('note_attack_range_bonus','音符攻击距离加成','INTEGER',25,'当前BonusAARange=25，点数而非百分比。',40),
  fixed('echo_cast_delay_ms','回响施法延迟','INTEGER',10,'当前EchoCastDelay=0.01秒，转换为10毫秒。',50),
  fixed('adjacent_note_delay_ms','相邻音符来源延迟','INTEGER',75,'当前DelayBetweenNoteCasts=0.075秒，保留为来源时序参数。',60),
  fixed('adjacent_note_delay_decay_ratio','相邻音符延迟衰减比例','DECIMAL',0.95,'当前Decay=0.95；未把它猜作固定命中间隔。',70),
  fixed('note_ap_ratio','音符法强比例','DECIMAL',0.04,'当前AutoDamage实际消费NoteAPRatio=0.04，不使用未消费AutoAPRatio。',80),
  runtime('note_character_level_base_damage','音符等级基础伤害','DECIMAL','AutoDamage有等级曲线起止值，完整中间等级未证，按实际等级值外供。',90),
  runtime('current_note_count','当前音符层数','INTEGER','实际音符层数由运行输入提供，范围0至4，不默认满层。',100),
], [
  formula('note_magic_damage','单个音符额外魔法伤害',add(P('note_character_level_base_damage'),mul(P('note_ap_ratio'),AP())),'AutoDamage=等级基础值+0.04×来源总法强。',10),
  formula('total_note_magic_damage','当前音符总额外魔法伤害',mul(P('current_note_count'),add(P('note_character_level_base_damage'),mul(P('note_ap_ratio'),AP()))),'只计算实际音符计数；0至4由运行输入提供。',20),
], [], [{ item:'友方音符折扣、第三友军收益与小兵专用分支', reason:'本轮只保留自身/单一敌人方向，第三友军和兵线专用支路排除。' }], [{ item:'第三个基础技能回响、音符生成与等级曲线', reason:'触发和完整等级插值未接；相邻延迟仅作来源参数。' }], 'P不把回响当作自动伤害事件，保留实际消费的0.04法强比例与0至4音符输入。');

put('seraphine_q', [
  levels('base_damage','清籁基础魔法伤害','INTEGER',[60,85,110,135,160],'当前BaseDamage技能等级1至5。',10),
  fixed('ability_power_ratio','清籁法强比例','DECIMAL',0.4,'当前TotalEmpoweredDamage/基础伤害树AP比例为0.4。',20),
  fixed('execute_threshold_ratio','清籁低生命阈值','DECIMAL',0.25,'当前低于25%生命值分支。',30),
  fixed('execute_max_multiplier','清籁低生命最大倍率','DECIMAL',1.75,'当前DamageAmp75，最大明确倍率1.75；中间生命曲线不猜。',40),
  fixed('cast_time_ms','基础施法时间','INTEGER',0,'当前清籁原始spellCastTime=0；本槽没有冲突的mCastTime字段，保留原始零值，不解释为缺省。',50),
  runtime('target_health_ratio','目标当前生命比例','DECIMAL','低生命资格由施法/命中时实际生命输入提供，不能默认25%以下。',60),
], [
  formula('magic_damage','清籁单一敌方魔法伤害',addAP('base_damage','ability_power_ratio'),'正常单一敌人伤害，不自动触发回响。',10),
  formula('low_health_max_magic_damage','清籁低生命最大魔法伤害',mul(addAP('base_damage','ability_power_ratio'),P('execute_max_multiplier')),'仅记录明确的25%以下最大倍率，未把中间生命变化拟合成线性。',20),
], [], [{ item:'第二目标、额外目标和小兵伤害支路', reason:'本轮单一敌方英雄范围；兵野专用与额外目标不录。' }], [{ item:'生命比例判定与回响第二次命中', reason:'Q第二次命中可面对变化后的生命值，需事件层分开读取，不能总量直接乘2。' }], 'Q保留正常式和明确低生命最大倍率，mCastTime冲突原样进入来源证据，不造固定施法参数。');

put('seraphine_w', [
  levels('shield_strength','护盾基础值','INTEGER',[60,80,100,120,140],'当前ShieldStrength技能等级1至5。',10),
  fixed('shield_ap_ratio','护盾法强比例','DECIMAL',0.2,'当前ShieldStrengthAPRatio=0.2。',20),
  fixed('shield_duration_ms','护盾持续时间','INTEGER',2500,'当前ShieldDuration=2.5秒。',30),
  fixed('self_move_speed_ratio','自身移动速度比例','DECIMAL',0.2,'当前WMSBonus=0.2。',40),
  fixed('self_move_speed_ap_ratio','自身移动速度法强比例','DECIMAL',0.0002,'当前WMSBonusAPRatio=0.0002。',50),
  levels('missing_health_heal_ratio','护盾后自身已损生命治疗比例','DECIMAL',[0.08,0.10,0.12,0.14,0.16],'当前WMissingHPBase技能等级1至5，正文按百分比显示。',60),
  fixed('heal_delay_ms','护盾后治疗延迟','INTEGER',2500,'当前WHealSplitDelay=2.5秒，治疗只发生一次。',70),
  fixed('shield_amp_for_seraphine','自身护盾倍率','DECIMAL',1,'当前ShieldAmpForSeraphine=1；保留成熟自身护盾式。',80),
  runtime('self_missing_health','护盾后自身已损生命','DECIMAL','实际治疗阶段已损生命由运行输入提供，无默认。',90),
], [
  formula('shield_value','护盾自身护盾值',mul(P('shield_amp_for_seraphine'),addAP('shield_strength','shield_ap_ratio')),'自身护盾数值供合法NORMAL_SHIELD效果引用。',10),
  formula('self_move_speed_ratio_value','自身移动速度比例',add(P('self_move_speed_ratio'),mul(P('self_move_speed_ap_ratio'),AP())),'自益加速数值不转为无证属性效果。',20),
  formula('self_missing_health_heal','护盾后自身已损生命治疗',mul(P('missing_health_heal_ratio'),P('self_missing_health')),'当前护盾后治疗为一次性已损生命比例；重复施放不直接把治疗乘2。',30),
], [normalShield('self_shield','shield_duration_ms','shield_value','萨勒芬妮自身护盾','只建立明确自身护盾生命周期；施放与已有护盾资格由事件层接线。',10)], [{ item:'第三友方护盾、治疗和加速', reason:'第三友方收益超出本轮，不创建友方效果。' }], [{ item:'已有护盾判定、治疗一次性时点和移动速度衰减', reason:'数值已明确但事件时序未接；不自动重复治疗或创建加速状态。' }], 'W是本批唯一成熟自身护盾效果；治疗与护盾分开，护盾生命周期使用PARAMETER型时长引用。');

put('seraphine_e', [
  levels('base_damage','增幅节拍基础魔法伤害','INTEGER',[70,100,130,160,190],'当前BaseDamage技能等级1至5。',10),
  fixed('ability_power_ratio','增幅节拍法强比例','DECIMAL',0.5,'当前FinalDamage树AP比例为0.5。',20),
  fixed('slow_percent_points','减速百分数点','INTEGER',99,'当前SlowValue=99且正文按@SlowValue@%显示；这是99百分数点，不是0.99比例。',30),
  levels('slow_duration_ms','减速持续时间','INTEGER',[1100,1200,1300,1400,1500],'当前SlowDuration技能等级1至5的秒值转换为毫秒。',40),
  fixed('cast_time_ms','基础施法时间','INTEGER',0,'当前spellCastTime=0；仅保存明确原始字段，实际施法事件仍待接。',50),
  runtime('status_replacement_stage','状态替换阶段','INTEGER','减速目标才可转禁锢、禁锢目标才可转晕眩，阶段由事件层提供，不默认任一状态。',60),
], [formula('magic_damage','增幅节拍单一敌方魔法伤害',addAP('base_damage','ability_power_ratio'),'当前FinalDamage单一敌方基础式；状态升级不构成三次伤害。',10)], [], [{ item:'小兵70%伤害', reason:'兵线专用减伤支路，本轮不录。' }], [{ item:'减速到禁锢到晕眩替换、回响命中', reason:'状态资格与事件时序待接，不创建无条件三种状态。' }], 'E把SlowValue保留为99整数百分数点，避免把显示单位误作比例。');

put('seraphine_r', [
  levels('base_damage','舞台魅影基础魔法伤害','INTEGER',[150,200,250],'当前R1BaseDamage技能等级1至3。',10),
  fixed('ability_power_ratio','舞台魅影法强比例','DECIMAL',0.4,'当前R1TotalDamage树AP比例为0.4。',20),
  levels('charm_duration_ms','魅惑持续时间','INTEGER',[1250,1500,1750],'当前RChannelDuration技能等级1至3对应1.25/1.5/1.75秒。',30),
], [formula('magic_damage','舞台魅影单一敌方魔法伤害',addAP('base_damage','ability_power_ratio'),'只保存单一敌方伤害；范围延伸和友方音符不录。',10)], [], [{ item:'范围延伸、友方音符和额外目标', reason:'第三友军及额外目标分支本轮排除。' }], [{ item:'mCastTime与spellCastTime冲突、魅惑命中', reason:'原始字段0与0.5秒冲突，不生成施法时间参数；命中事件待接。' }], 'R只保存三级伤害和魅惑持续时间，明确记录施法字段冲突，不擅自选值。');

const skills = {};
for (const key of order) {
  const hero = heroIdOf(key);
  const maxLevel = key.endsWith('_p') ? 1 : key === 'sona_r' || key === 'soraka_r' || key === 'seraphine_r' ? 3 : key === 'karma_r' ? 4 : 5;
  const sourceSkill = heroById(hero).source.skills?.find((x) => x.slot === slotOf(key));
  skills[key] = { skillKey: key, name: sourceSkill?.name || boundSkill(key).s.object?.mSpell?.mClientData?.mTooltipData?.mObjectName || hero, maxLevel, source: sourceFor(key), write: writes[key], protectedExisting: { subject: true, compositionLists: true }, excluded: excluded[key], pending: pending[key], proofs: [{ type: 'root-bound-source', path: `输入包/来源绑定与当前文本.json -> ${hero}/${slotOf(key)}` }, { type: 'fixed-source-version', client: '16.17', official: '16.17.1', build: clientBuild }], proofNote: notes[key] };
}

const walk = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; };
const sourceManifest = walk(INPUT).sort().map((p) => { const rel = path.relative(INPUT, p).split(path.sep).join('/'); return { path: rel, sha256: fileSha(rel), byteSize: fs.statSync(p).size }; });
const inputIntegrity = sourceManifest.map((x) => { const d = (inputVersion.sourceFiles || []).find((v) => v.path === x.path); return { path: x.path, actualSha256: x.sha256, actualByteSize: x.byteSize, declaredSha256: d?.sha256 ?? null, declaredByteSize: d?.byteSize ?? null, declaredMatch: d ? d.sha256 === x.sha256 && d.byteSize === x.byteSize : null }; });
if (inputIntegrity.some((x) => x.declaredMatch === false)) throw new Error(`输入包完整性失败: ${JSON.stringify(inputIntegrity.filter((x) => x.declaredMatch === false))}`);
const currentSnapshotSha256 = fileSha('参考资料/当前20槽保护快照.json');
const sourceIndexSha256 = inputVersion.sourceIndexSha256;
const currentCompositionLists = Object.fromEntries(order.map((key) => [key, snapshot.summary?.[key]?.components || null]));
const protectedSubjects = order.map((key) => { const r = snapshot.requests?.find((x) => x.route === `/skills/${key}`); return { skillKey: key, subject: r?.data || null, source: '输入包/参考资料/当前20槽保护快照.json' }; });
const protectedObjects = { subjects: protectedSubjects, currentCompositionLists, reusedPublicParameters: reuse, protectedReferenceRequests: snapshot.requests || [], protectedReferenceRoutes: [...new Set((snapshot.requests || []).map((r) => r.route))], protectedReferenceCounts: { GETs: snapshot.GETs, subjects: 20, currentCompositionSkillSlots: 20, currentCompositionLists: 120, reusedPublicParameters: reuse.length, images: 20, characters: 4, characterSkillRelations: 4, dictionaries: 4 }, scope: '只保护既有主体、20技能槽六类组成、28公共参数、角色关系、图片与字典，不更新既有对象。', snapshotFile: '输入包/参考资料/当前20槽保护快照.json', snapshotSha256: currentSnapshotSha256 };
const allWrites = order.flatMap((key) => Object.entries(writes[key]).flatMap(([kind, items]) => items.map((body) => ({ skillKey: key, kind, body }))));
const requestCounts = Object.fromEntries(['parameters','formulas','effects','processes','internalStates','triggerRules'].map((k) => [k, allWrites.filter((x) => x.kind === k).length]));
const newTotal = Object.values(requestCounts).reduce((a, b) => a + b, 0);
const reusedPublicParameters = reuse.map((x) => ({ ...x, source: '输入包/参考资料/公共参数复用清单.json', post: false }));
const meta = { generatedAt: now, batch: BATCH, status: '候选已生成，等待主负责人审查；未调用业务接口', gameId: 'lol', apiBase: API_BASE, sourceVersion, scope: '娑娜、索拉卡、卡尔玛、萨勒芬妮20个技能槽；只新增来源明确参数、实际二元公式和萨勒芬妮自身护盾效果。已有主体、六类组成、28项公共参数、四个角色及关系、代表图和字典全部保护；不调用业务接口，不创建自动触发、伤害结果、直接治疗、瞬时求值或周期过程。', sourcePolicy: '固定客户端16.17、官方16.17.1和构建16.17.8104348；沿当前根绑定正文和当前计算树；未知等级曲线、状态资格、施法时序和运行输入不猜、不设默认。', inputPackage: '输入包/', currentSnapshot: '输入包/参考资料/当前20槽保护快照.json', currentSnapshotSha256, sourceIndexSha256, businessWrites: 0, apiCalls: 0, tokenStored: false, candidateSha256: null };
const candidate = { meta, skills, order, reusedPublicParameters, reusedExistingParameters: reusedPublicParameters, counts: { newParameters: requestCounts.parameters, newFormulas: requestCounts.formulas, newEffects: requestCounts.effects, newProcesses: requestCounts.processes, newInternalStates: requestCounts.internalStates, newTriggerRules: requestCounts.triggerRules, newTotal, reusedPublicParameters: reuse.length, protectedCurrentCompositionLists: 120, plannedTotalIncludingReused: newTotal + reuse.length }, apiWrites: 0, sourceFiles: sourceManifest, sourceNotes: { frozenInput: '输入包由根负责人冻结并按字节复制；源值来自根绑定当前正文和客户端计算树。', officialCooldownCorrection: 'Sona W cooldown_ms=10000来自官方16.17.1，客户端槽缺失该可用字段。', noBusinessWrites: true }, protectedObjects, revision: 'hero33-source-v2' };
const candidateHash = sha(JSON.stringify({ ...candidate, meta: { ...candidate.meta, candidateSha256: null } }, null, 2));
candidate.meta.candidateSha256 = candidateHash;
writeJson('完整候选.json', candidate);

const kindRoute = (kind) => ({ parameters: 'parameters', formulas: 'formulas', effects: 'effects', processes: 'processes', internalStates: 'internal-states', triggerRules: 'trigger-rules' })[kind];
const requests = allWrites.map((x, i) => ({ sequence: i + 1, method: 'POST', route: `/skills/${x.skillKey}/${kindRoute(x.kind)}`, detailRoute: `/skills/${x.skillKey}/${kindRoute(x.kind)}/${x.body.parameterKey || x.body.formulaKey || x.body.effectKey || x.body.processKey || x.body.internalStateKey || x.body.triggerRuleKey}`, skillKey: x.skillKey, kind: x.kind, stableKey: x.body.parameterKey || x.body.formulaKey || x.body.effectKey || x.body.processKey || x.body.internalStateKey || x.body.triggerRuleKey, status: '仅意图，未调用', body: x.body }));
const plan = { generatedAt: now, status: '仅写入意图，未调用业务接口；候选等待审查', batch: BATCH, apiBase: API_BASE, sourceVersion, candidateSha256: candidateHash, currentSnapshotSha256, requestCount: requests.length, requestCounts, currentTotalComponents: newTotal + reuse.length + 120, reusedPublicParameters, protectedSkills: order, protectedCounts: protectedObjects.protectedReferenceCounts, protectedRoutes: protectedObjects.protectedReferenceRoutes, requests, noApiCalls: true };
writeJson('写前请求计划.json', plan);
const sourceValues = { generatedAt: now, batch: BATCH, sourceVersion, sourceIndexSha256, sourcePackageSha256: sha(JSON.stringify(sourceManifest)), skills: Object.fromEntries(order.map((key) => { const s = sourceFor(key); return [key, { source: s, intendedValues: writes[key].parameters.map((p) => ({ parameterKey: p.parameterKey, valueType: p.valueType, valueMode: p.valueMode, fixedValue: p.fixedValue, levelValues: p.levelValues })), formulaKeys: writes[key].formulas.map((f) => f.formulaKey), excluded: excluded[key], pending: pending[key] }]; })) };
writeJson('源值解析.json', sourceValues);
writeJson('来源哈希汇总.json', { generatedAt: now, batch: BATCH, sourceVersion, sourceIndexSha256, inputFiles: sourceManifest, inputIntegrity, currentSnapshotSha256, candidateSha256: candidateHash });
writeJson('来源与范围.json', { batch: BATCH, status: '候选阶段，未调用业务接口', sourceVersion, included: ['娑娜：被动层数/上限、Q/W/E/R单一敌人及自身数值组成、官方W 10秒冷却。', '索拉卡：Q自身治疗和单一敌人、E单一敌人两次实例共用单次式、R自身正常/低生命治疗。', '卡尔玛：P冷却缩短、Q/W/E基础组成、R四级强化Q/W/E数值分支。', '萨勒芬妮：P音符计数/伤害、Q低生命最大倍率、W自身护盾/治疗、E/R单一敌人。'], excludedOrPending: ['第三友军、额外敌人、兵野专用伤害/治疗、纯视野、纯几何、独立召唤、完整变形、自动触发、伤害结果、直接治疗结果、瞬时求值和周期过程。', '未知等级曲线、状态资格、强化技能触发、施法时序冲突、资源扣费和实际运行输入保持待接。'], perSkillExcluded: excluded, perSkillPending: pending });
writeJson('候选版本.json', { batch: BATCH, revision: candidate.revision, generatedAt: now, status: 'candidate', candidateSha256: candidateHash, planSha256: sha(JSON.stringify(plan, null, 2)), sourceIndexSha256, currentSnapshotSha256, counts: candidate.counts, requestCounts, apiWrites: 0 });
writeJson('冻结候选锁.json', { batch: BATCH, revision: candidate.revision, status: '候选已冻结，等待主负责人审查；未调用业务接口', candidateSha256: candidateHash, sourceIndexSha256, currentSnapshotSha256, requestCount: requests.length, requestCounts, protectedCounts: protectedObjects.protectedReferenceCounts, apiWrites: 0, noApiCalls: true, lockType: '静态哈希锁；不代表业务数据库已写入' });
writeJson('候选交付索引.json', { batch: BATCH, revision: candidate.revision, status: '候选交付，未录入业务数据', files: ['完整候选.json','写前请求计划.json','源值解析.json','来源哈希汇总.json','来源与范围.json','候选版本.json','冻结候选锁.json'], candidateSha256: candidateHash, counts: candidate.counts, requestCount: requests.length, apiWrites: 0, protectedCounts: protectedObjects.protectedReferenceCounts });
console.log(JSON.stringify({ candidateSha256: candidateHash, requestCount: requests.length, requestCounts, counts: candidate.counts, protectedCounts: protectedObjects.protectedReferenceCounts }, null, 2));
