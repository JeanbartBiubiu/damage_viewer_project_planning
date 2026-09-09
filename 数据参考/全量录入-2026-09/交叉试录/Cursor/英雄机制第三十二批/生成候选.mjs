import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.dirname(__filename);
const INPUT = path.join(ROOT, '输入包');
const BATCH = '英雄机制第三十二批';
const API_BASE = 'http://127.0.0.1:8080/api/admin/games/lol';
const GENERATED_AT = new Date().toISOString();

const json = (relative) => JSON.parse(fs.readFileSync(path.join(INPUT, relative), 'utf8'));
const inputVersion = json('输入版本.json');
const binding = json('来源绑定与当前文本.json');
const snapshot = json('参考资料/当前20槽保护快照.json');
const reuseList = json('参考资料/公共参数复用清单.json');
const official = {};
for (const heroId of ['Corki', 'Kaisa', 'Xayah', 'Zeri']) {
  const file = json(`参考资料/官方英文/${heroId}.json`);
  official[heroId] = file.data?.[heroId] || file[heroId] || file;
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sha256File = (relative) => sha256(fs.readFileSync(path.join(INPUT, relative)));
const writeJson = (relative, value) => fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const slash = (value) => value.split(path.sep).join('/');

const sourceFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else sourceFiles.push(absolute);
  }
}
walk(INPUT);
sourceFiles.sort();
const sourceManifestFiles = sourceFiles.map((absolute) => {
  const relative = slash(path.relative(INPUT, absolute));
  return { path: relative, sha256: sha256File(relative), byteSize: fs.statSync(absolute).size };
});
const declaredByPath = new Map((inputVersion.sourceFiles || []).map((item) => [item.path, item]));
const inputIntegrity = sourceManifestFiles.map((file) => {
  const declared = declaredByPath.get(file.path);
  return {
    path: file.path,
    actualSha256: file.sha256,
    actualByteSize: file.byteSize,
    declaredSha256: declared?.sha256 ?? null,
    declaredByteSize: declared?.byteSize ?? null,
    declaredMatch: declared ? declared.sha256 === file.sha256 && declared.byteSize === file.byteSize : null,
  };
});
if (inputIntegrity.some((item) => item.declaredMatch === false)) {
  throw new Error(`输入包散列或字节数与声明不一致: ${JSON.stringify(inputIntegrity.filter((item) => item.declaredMatch === false))}`);
}

const clientBuild = '16.17.8104348+branch.releases-16-17.content.release';
const sourceVersion = {
  clientVersion: inputVersion.clientVersion || '16.17',
  officialVersion: inputVersion.officialVersion || '16.17.1',
  build: clientBuild,
};
const sourceIndexSha256 = inputVersion.sourceIndexSha256;
const currentSnapshotSha256 = sha256File('参考资料/当前20槽保护快照.json');
const order = [
  'corki_p', 'corki_q', 'corki_w', 'corki_e', 'corki_r',
  'kaisa_p', 'kaisa_q', 'kaisa_w', 'kaisa_e', 'kaisa_r',
  'xayah_p', 'xayah_q', 'xayah_w', 'xayah_e', 'xayah_r',
  'zeri_p', 'zeri_q', 'zeri_w', 'zeri_e', 'zeri_r',
];
const heroFor = (heroId) => binding.heroes.find((hero) => hero.id === heroId);
const skillFor = (heroId, slot) => {
  const skill = heroFor(heroId)?.skills.find((item) => item.slot === slot);
  if (!skill) throw new Error(`找不到来源绑定 ${heroId}/${slot}`);
  return skill;
};
const skillKeyParts = (skillKey) => {
  const [hero, slot] = skillKey.split('_');
  return { heroId: hero === 'kaisa' ? 'Kaisa' : hero[0].toUpperCase() + hero.slice(1), slot: slot.toUpperCase() };
};
const rawFor = (skillKey) => {
  const { heroId, slot } = skillKeyParts(skillKey);
  return skillFor(heroId, slot).object.mSpell;
};
const dataValue = (skillKey, name) => {
  const value = (rawFor(skillKey).DataValues || []).find((item) => item.name === name)?.values;
  if (!value) throw new Error(`缺少DataValues ${skillKey}/${name}`);
  return value;
};
const levelsFrom = (skillKey, name, levelCount, transform = (value) => value) => dataValue(skillKey, name)
  .slice(1, levelCount + 1).map(transform);
const atLevel = (skillKey, name, level = 1, transform = (value) => value) => transform(dataValue(skillKey, name)[level]);
const effectValue = (skillKey, index, levelCount, transform = (value) => value) => {
  const value = rawFor(skillKey).mEffectAmount?.[index]?.value;
  if (!value) throw new Error(`缺少mEffectAmount ${skillKey}/${index}`);
  return value.slice(1, levelCount + 1).map(transform);
};
const effectAt = (skillKey, index, level = 1, transform = (value) => value) => {
  const value = rawFor(skillKey).mEffectAmount?.[index]?.value;
  if (!value) throw new Error(`缺少mEffectAmount ${skillKey}/${index}`);
  return transform(value[level]);
};
const toMs = (seconds) => Math.round(Number(seconds) * 1000);
const secLevelsMs = (skillKey, name, levelCount) => levelsFrom(skillKey, name, levelCount, toMs);
const secAtMs = (skillKey, name, level = 1) => toMs(atLevel(skillKey, name, level));
const effectSecLevelsMs = (skillKey, index, levelCount) => effectValue(skillKey, index, levelCount, toMs);
const effectSecAtMs = (skillKey, index, level = 1) => toMs(effectAt(skillKey, index, level));

const selectedDataValues = (rawSpell) => Object.fromEntries((rawSpell.DataValues || []).map((item) => [item.name, item.values ? item.values.slice() : null]));
const selectedCalculations = (rawSpell) => rawSpell.mSpellCalculations || {};
const officialEvidenceFor = (heroId, slot) => {
  const hero = official[heroId];
  if (!hero) return { path: null, name: null, description: null, tooltip: null };
  if (slot === 'P') {
    return {
      path: `data.${heroId}.passive`,
      name: hero.passive?.name || null,
      description: hero.passive?.description || null,
      tooltip: hero.passive?.tooltip || null,
      relevantEnemyTips: hero.enemytips || [],
    };
  }
  const spellIndex = { Q: 0, W: 1, E: 2, R: 3 }[slot];
  const spell = hero.spells?.[spellIndex];
  return {
    path: `data.${heroId}.spells[${spellIndex}]`,
    name: spell?.name || null,
    description: spell?.description || null,
    tooltip: spell?.tooltip || null,
  };
};
const sourceFor = (heroId, slot) => {
  const hero = heroFor(heroId);
  const skill = skillFor(heroId, slot);
  const raw = skill.object.mSpell;
  const clientFile = `参考资料/客户端原文/${heroId}.json.gz`;
  const officialZhFile = `参考资料/官方中文/${heroId}.json`;
  const officialEnFile = `参考资料/官方英文/${heroId}.json`;
  const sourceMeta = hero.source;
  return {
    hero: heroId,
    heroName: hero.name,
    heroKey: hero.key,
    slot,
    resourceType: sourceMeta.resourceType,
    rootPath: hero.rootPath,
    spellPath: skill.binding,
    bindingAvailable: true,
    clientFile,
    clientSha256: sourceMeta.client.sha256,
    clientCompressedSha256: sha256File(clientFile),
    clientBuild: sourceMeta.client.contentVersion || clientBuild,
    officialZhFile,
    officialZhSha256: sha256File(officialZhFile),
    officialEnFile,
    officialEnSha256: sha256File(officialEnFile),
    currentBoundText: skill.currentTexts,
    raw: {
      dataValues: selectedDataValues(raw),
      calculations: selectedCalculations(raw),
      spellCastTime: raw.spellCastTime ?? null,
      mCastTime: raw.mCastTime ?? null,
      cooldownTime: raw.cooldownTime ?? null,
      mMaxAmmo: raw.mMaxAmmo ?? null,
      mAmmoRechargeTime: raw.mAmmoRechargeTime ?? null,
      mDoesNotConsumeMana: raw.mDoesNotConsumeMana ?? null,
      mDoesNotConsumeCooldown: raw.mDoesNotConsumeCooldown ?? null,
    },
    officialEvidence: officialEvidenceFor(heroId, slot),
    currentTextPath: `来源绑定与当前文本.json -> ${heroId}/${slot}/currentTexts`,
  };
};

const parameter = (parameterKey, name, valueType, valueMode, fixedValue, levelValues, description, sortOrder) => ({
  parameterKey,
  name,
  valueType,
  valueMode,
  fixedValue: fixedValue ?? null,
  levelValues: levelValues ? Object.fromEntries(levelValues.map((value, index) => [String(index + 1), value])) : null,
  description,
  sortOrder,
});
const fixed = (key, name, type, value, description, sortOrder) => parameter(key, name, type, 'FIXED', value, null, description, sortOrder);
const levels = (key, name, type, values, description, sortOrder) => parameter(key, name, type, 'SKILL_LEVEL', null, values, description, sortOrder);
const runtime = (key, name, type, description, sortOrder) => parameter(key, name, type, 'RUNTIME_INPUT', null, null, description, sortOrder);
const P = (parameterKey) => ({ nodeType: 'PARAMETER', parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: 'ATTRIBUTE', attributeOwner, attributeKey, attributeValueKind });
const O = (operation, left, right) => ({ nodeType: 'OPERATION', operation, operands: [left, right] });
const add = (left, right) => O('ADD', left, right);
const sub = (left, right) => O('SUBTRACT', left, right);
const mul = (left, right) => O('MULTIPLY', left, right);
const min = (left, right) => O('MIN', left, right);
const max = (left, right) => O('MAX', left, right);
const attr = (owner, key, kind) => A(owner, key, kind);
const formula = (formulaKey, name, expression, description, sortOrder) => ({ formulaKey, name, expression, description, sortOrder });
const sourceADTotal = attr('SOURCE', 'attack_damage', 'TOTAL');
const sourceADBonus = attr('SOURCE', 'attack_damage', 'BONUS');
const sourceAPTotal = attr('SOURCE', 'ability_power', 'TOTAL');
const sourceMoveSpeed = attr('SOURCE', 'move_speed', 'TOTAL');
const targetHPTotal = attr('TARGET', 'hp', 'TOTAL');
const targetHPMissing = attr('TARGET', 'hp', 'MISSING');
const add3 = (a, b, c) => add(add(a, b), c);

const normalShieldEffect = (effectKey, name, durationKey, valueFormulaKey, description, sortOrder) => ({
  effectKey,
  name,
  description,
  sortOrder,
  lifecycle: {
    durationValue: { kind: 'PARAMETER', parameterKey: durationKey },
    maxStacksValue: { kind: 'FIXED', value: 1 },
    applicationStacksValue: { kind: 'FIXED', value: 1 },
    instanceScope: 'SOURCE',
    reapplicationStackMode: 'KEEP',
    reapplicationDurationMode: 'REFRESH_ALL',
    expiryMode: 'ALL_AT_ONCE',
    periodicIntervalValue: null,
    firstPeriodicExecution: null,
  },
  results: [{
    resultKey: 'shield',
    name: '自身护盾',
    resultType: 'NORMAL_SHIELD',
    target: 'SOURCE',
    description: '护盾数值来自当前猎手本能计算树；跃迁和有电浆英雄资格由事件层接线。',
    sortOrder: 10,
    lifecycleBehavior: {
      moment: 'PERSISTENT',
      valueReadMode: 'APPLICATION_SNAPSHOT',
      stackValueMode: 'SHARED',
      reapplicationValueMode: 'REPLACE',
      periodicExecutionMode: null,
    },
    spellShieldBlockScope: null,
    valueRule: {
      value: { kind: 'FORMULA', formulaKey: valueFormulaKey },
      fixedMultiplier: 1,
      fixedMinValue: 0,
      fixedMaxValue: null,
    },
    detail: { absorbedDamageTypeKey: null, decayMode: 'NONE' },
  }],
});

const writes = {};
const excluded = {};
const pending = {};
const proofNotes = {};
function put(skillKey, parameters, formulas, effects, excludedItems, pendingItems, proofNote) {
  writes[skillKey] = { parameters, formulas, effects, processes: [], internalStates: [], triggerRules: [] };
  excluded[skillKey] = excludedItems;
  pending[skillKey] = pendingItems;
  proofNotes[skillKey] = proofNote;
}

const castMs = (skillKey) => fixed('cast_time_ms', '基础施法时间（毫秒）', 'INTEGER', Math.round((rawFor(skillKey).spellCastTime || 0) * 1000), '当前根spellCastTime；仅保存来源字段，不代表命中、位移或效果事件已接线。', 1000);

put('corki_p', [
  fixed('attack_conversion_ratio', '攻击额外真实伤害比例', 'DECIMAL', 0.2, '当前根DataValues.AttackConversion约0.2，正文按 @AttackConversion*100@% 显示；比例1代表100%。这是额外真实伤害比例，不是把完整普攻转换成真实伤害。', 10),
  runtime('actual_critical_damage_ratio', '实际暴击伤害倍率', 'DECIMAL', '当前CriticalStrikeTOOLTIP以mStat9乘基础额外真实伤害；实际暴击倍率选择器和阶段没有窄证，运行时外供且不设默认。', 20),
], [
  formula('basic_attack_extra_true_damage', '普攻额外真实伤害', mul(P('attack_conversion_ratio'), sourceADTotal), '当前BasicAttackTOOLTIP是0.2×来源总攻击力的额外真实伤害；咒刃资格和完整普攻其他组成由事件层处理。', 10),
  formula('critical_extra_true_damage', '暴击额外真实伤害', mul(mul(P('attack_conversion_ratio'), sourceADTotal), P('actual_critical_damage_ratio')), '当前CriticalStrikeTOOLTIP只把实际暴击伤害倍率作用于额外真实伤害树；不把完整物理普攻重复纳入。', 20),
], [], [
  { item: '炸药包InitialCD、PackageDuration、BonusMS、SubsequentCD', reason: '当前正文和实际消费树没有炸药包字段，旧摘要不能替代当前组成。' },
  { item: '完整普攻物理伤害、咒刃额外伤害资格', reason: '本轮只录当前额外真实伤害树；完整普攻与咒刃事件资格待运行层接线。' },
], [
  { item: 'mStat9暴击倍率应用阶段', reason: '实际暴击倍率无窄证，不设固定1.75或其他默认。' },
], '沿当前P正文和BasicAttackTOOLTIP/CriticalStrikeTOOLTIP保留20%额外真实伤害，避免把转化描述误作整次普攻。');

put('corki_q', [
  levels('base_damage', '基础魔法伤害', 'INTEGER', levelsFrom('corki_q', 'BaseDamage', 5), '客户端BaseDamage取技能等级1至5，当前TotalDamage树消费60/105/150/195/240。', 10),
  fixed('bonus_attack_damage_ratio', '额外攻击力比例', 'DECIMAL', 1.25, '当前TotalDamage树ADRatio带mStat2/mStatFormula2，按同版窄口径取来源额外攻击力；比例1代表100%。', 20),
  fixed('ability_power_ratio', '法术强度比例', 'DECIMAL', 1, '当前TotalDamage树APRatio省略统计选择器，按同版具名节点窄口径取来源总法强；比例1代表100%。', 30),
  castMs('corki_q'),
], [
  formula('magic_damage', '磷光炸弹单一敌方魔法伤害', add3(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus), mul(P('ability_power_ratio'), sourceAPTotal)), '当前TotalDamage=基础值+1.25×额外攻击力+1×法强；单一敌人范围保留，显形只作视野说明。', 10),
], [], [
  { item: 'RevealDuration=6秒显形', reason: '纯视野结果，本轮不创建视野效果。' },
  { item: '范围和命中顺序', reason: '区域几何及命中事件没有成熟结果结构。' },
], [], 'Q保留当前TotalDamage三项组成并把APRatio的省略统计选择器按同版窄口径映射为法强。');

put('corki_w', [
  levels('maximum_damage_base', '路径完整最大基础魔法伤害', 'INTEGER', levelsFrom('corki_w', 'BaseDamage', 5), '客户端MaximumDamage树BaseDamage取技能等级1至5；当前正文说明是路径整个驻留期间至多总量，不是每跳伤害。', 10),
  fixed('ability_power_ratio', '路径法强比例', 'DECIMAL', 1.5, '当前MaximumDamage树APRatio=1.5，比例1代表100%。', 20),
  fixed('bonus_attack_damage_ratio', '路径额外攻击力比例', 'DECIMAL', 2, '当前MaximumDamage树ADRatio带mStat2/mStatFormula2，取来源额外攻击力，比例1代表100%。', 30),
  fixed('trail_duration_ms', '路径持续时间（毫秒）', 'INTEGER', secAtMs('corki_w', 'TrailDuration'), '当前正文和DataValues.TrailDuration=2.5秒，转换为2500毫秒。', 40),
  fixed('ticks_per_second', '每秒过程次数', 'INTEGER', atLevel('corki_w', 'TicksPerSecond'), '当前DataValues.TicksPerSecond=2；仅保留来源过程参数，不将完整最大量拆成每跳。', 50),
  fixed('maximum_ticks', '最大过程次数', 'INTEGER', atLevel('corki_w', 'MaximumTicks'), '当前DataValues.MaximumTicks=5；不据此推断每跳均分或首末跳时序。', 60),
  fixed('dash_speed_base', '基础飞行速度', 'INTEGER', atLevel('corki_w', 'DashSpeedBase'), '当前DashSpeed树基础值为650；属于位移来源参数。', 70),
  fixed('dash_speed_move_speed_ratio', '移动速度加成系数', 'DECIMAL', atLevel('corki_w', 'DashSpeedRatio'), '当前DashSpeed树使用来源移动速度，系数为1。', 80),
], [
  formula('maximum_magic_damage', '路径驻留期间最大魔法伤害', add3(P('maximum_damage_base'), mul(P('ability_power_ratio'), sourceAPTotal), mul(P('bonus_attack_damage_ratio'), sourceADBonus)), '当前MaximumDamage是整个路径期间的完整最大量；不再乘MaximumTicks或5。', 10),
  formula('dash_speed', '飞行速度', add(P('dash_speed_base'), mul(P('dash_speed_move_speed_ratio'), sourceMoveSpeed)), '当前DashSpeed=650+来源移动速度；位移过程本身仍待事件层接线。', 20),
], [], [
  { item: 'MaximumTicks×每跳均分', reason: '正文直接给出期间至多受到完整MaximumDamage，没有每跳均分证据。' },
  { item: 'DamageRadius、MinimumRange、MaximumRange', reason: '几何范围字段不建立无消费者公式。' },
], [
  { item: '路径命中、首末跳和位移事件', reason: '只保存总量和来源过程次数，实际驻留与命中时序待接。' },
], 'W严格把MaximumDamage当路径完整总量，另保留明确的持续时间和过程次数；DashSpeed沿实际计算树保存。');

put('corki_e', [
  levels('base_damage', '基础物理伤害', 'INTEGER', levelsFrom('corki_e', 'BaseDamage', 5), '客户端BaseDamage取技能等级1至5。', 10),
  fixed('bonus_attack_damage_ratio', '额外攻击力比例', 'DECIMAL', 2.4, '当前TotalDamage树ADRatio=2.4，取来源额外攻击力，比例1代表100%。', 20),
  fixed('spray_duration_ms', '扫射持续时间（毫秒）', 'INTEGER', secAtMs('corki_e', 'SprayDuration'), '当前正文显示4秒持续总伤害，转换为4000毫秒。', 30),
  fixed('ticks_per_second', '每秒命中次数', 'INTEGER', atLevel('corki_e', 'TicksPerSecond'), '当前DataValues.TicksPerSecond=4；不据此把总伤害拆成每次结果。', 40),
  levels('shred_max_amount', '最大护甲和魔抗削减量', 'INTEGER', levelsFrom('corki_e', 'ShredMax', 5, (value) => Math.abs(value)), '原始ShredMax为负的-12/-14/-16/-18/-20，当前正文通过乘-1显示正的削减量；这里保存正点数。', 50),
  fixed('shred_stack_cap', '削减层数上限', 'INTEGER', atLevel('corki_e', 'ShredCap'), '当前DataValues.ShredCap=4；层数作用与刷新事件待接。', 60),
  fixed('shred_duration_ms', '削减存留时间（毫秒）', 'INTEGER', secAtMs('corki_e', 'ShredDuration'), '当前正文说明命中后的削减存留2秒，转换为2000毫秒。', 70),
  castMs('corki_e'),
], [
  formula('physical_damage', '格林机枪单一敌方完整物理伤害', add(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus)), '当前TotalDamage=基础值+2.4×额外攻击力；正文的4秒和每秒4次不重复乘入。', 10),
], [], [
  { item: '历史物理魔法各半混合伤害', reason: '当前根TotalDamage和正文明确为完整物理伤害，不采用旧混合口径。' },
  { item: '护甲魔抗削减自动效果', reason: '本轮只保存削减数值、层数和存留时间，不创建自动减益事件。' },
], [
  { item: '4层叠加、刷新和每次命中时序', reason: '当前正文给出关系，事件接线尚未形成。' },
], 'E沿当前物理TotalDamage树，ShredMax只做一次符号转换并保留正文4层/2秒边界。');

put('corki_r', [
  levels('base_damage', '小导弹基础物理伤害', 'INTEGER', levelsFrom('corki_r', 'BaseDamage', 3), '客户端RSmallMissileDamage树BaseDamage取技能等级1至3，为90/170/250。', 10),
  fixed('bonus_attack_damage_ratio', '额外攻击力比例', 'DECIMAL', atLevel('corki_r', 'ADRatio'), '当前RSmallMissileDamage树ADRatio带mStat2/mStatFormula2，取来源额外攻击力。', 20),
  fixed('big_missile_multiplier', '超级导弹倍率', 'DECIMAL', atLevel('corki_r', 'RBigOneMultiplier'), '当前RBigMissileDamage是小导弹完整树乘2。', 30),
  fixed('cooldown_ms', '单发公共冷却（毫秒）', 'INTEGER', 2000, '当前同版公共单发冷却为2秒；与充能20秒分别保存。', 40),
  fixed('ammo_recharge_ms', '弹药充能时间（毫秒）', 'INTEGER', toMs(rawFor('corki_r').mAmmoRechargeTime?.[1] ?? 20), '当前mAmmoRechargeTime数组为20秒；该字段来自根原始字段，候选固定为20000毫秒。', 50),
  fixed('max_ammo', '最大弹药数', 'INTEGER', rawFor('corki_r').mMaxAmmo?.[1] ?? atLevel('corki_r', 'MaxAmmoTOOLTIP'), '当前根mMaxAmmo和正文消费均为4；不采用主体旧摘要7。', 60),
  fixed('ammo_when_learned', '学习时弹药数', 'INTEGER', atLevel('corki_r', 'AmmoWhenLearned'), '当前DataValues.AmmoWhenLearned=2。', 70),
  fixed('attack_refund_base_seconds', '命中普攻基础回充缩短（秒）', 'DECIMAL', atLevel('corki_r', 'CDReductionOnHit'), '当前AttackRefund的mMultiplier来自CDReductionOnHit=2秒；不将它误作固定最终值。', 80),
  fixed('attack_refund_mstat8_coefficient', '回充公式mStat8系数', 'DECIMAL', 2, '当前AttackRefund树为2×(1+2×mStat8)；2是树中mCoefficient，不是显示精度。', 90),
  runtime('attack_refund_mstat8_value', '回充公式mStat8实际值', 'DECIMAL', '当前AttackRefund使用mStat8，属性编号和应用阶段未窄证；真实值由运行输入提供，不默认为0。', 100),
  fixed('attack_refund_unit', '回充公式单位常数', 'DECIMAL', 1, '当前AttackRefund树的NumberCalculationPart=1。', 110),
  castMs('corki_r'),
], [
  formula('small_missile_damage', '小导弹单一敌方物理伤害', add(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus)), '当前RSmallMissileDamage=基础值+0.85×来源额外攻击力。', 10),
  formula('big_missile_damage', '超级导弹单一敌方物理伤害', mul(add(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus)), P('big_missile_multiplier')), '当前RBigMissileDamage是完整小导弹树乘2；每第三颗的序列由事件层处理。', 20),
  formula('attack_refund_seconds', '命中普攻回充缩短（秒）', mul(P('attack_refund_base_seconds'), add(P('attack_refund_unit'), mul(P('attack_refund_mstat8_coefficient'), P('attack_refund_mstat8_value')))), '当前树实际为CDReductionOnHit×(1+2×mStat8)；mStat8真实值无默认，mPrecision=1仅显示精度。', 30),
], [], [
  { item: 'RBaseMissileRadius、RBigOneMissileRadius', reason: '爆炸几何和额外目标分配不进入本轮唯一敌人伤害组成。' },
  { item: '旧主体最多7发', reason: '当前根mMaxAmmo和正文MaxAmmoTOOLTIP均为4，保留当前4发。' },
], [
  { item: '充能队列、每第三颗替换和英雄普攻回充事件', reason: '数值和公式已保存，序列与命中时序待接。' },
  { item: 'mPrecision=1', reason: '只是显示精度字段，不作为四舍五入规则。' },
], 'R保存当前4发弹药和2秒单发冷却；回充公式的mStat8保持无默认，独立数学会用明确的1+2×mStat8期望校核。');

put('kaisa_p', [
  runtime('base_damage_by_character_level', '等级基础电浆伤害实际值', 'DECIMAL', '当前PBaseDamage是4至30的角色等级插值，输入包没有完整求值函数；以实际等级值外供，不猜中间曲线。', 10),
  fixed('base_ability_power_ratio', '基础电浆法强比例', 'DECIMAL', atLevel('kaisa_p', 'PAPRatioBase'), '当前PBaseDamage树PAPRatioBase约0.12，比例1代表100%。', 20),
  runtime('per_stack_damage_by_character_level', '每层基础电浆伤害实际值', 'DECIMAL', '当前PCurrentPerStackDamage是1至8的角色等级插值；实际等级值外供，不猜中间曲线。', 30),
  fixed('per_stack_ability_power_ratio', '每层电浆法强比例', 'DECIMAL', atLevel('kaisa_p', 'PAPRatioPerStack'), '当前PCurrentPerStackDamage树PAPRatioPerStack约0.03。', 40),
  fixed('max_stack_count', '电浆最大层数', 'INTEGER', atLevel('kaisa_p', 'PMaxStacks'), '当前正文和DataValues.PMaxStacks=4。', 50),
  fixed('plasma_duration_ms', '电浆持续时间（毫秒）', 'INTEGER', secAtMs('kaisa_p', 'PDuration'), '当前正文和DataValues.PDuration=4秒，转换为4000毫秒。', 60),
  fixed('execute_missing_health_ratio', '电浆引爆已损生命比例', 'DECIMAL', atLevel('kaisa_p', 'PExecuteRatio'), '当前PExecutePercentage树PExecuteRatio约0.15；比例1代表100%，目标缺失生命由实际输入提供。', 70),
  fixed('execute_ability_power_ratio', '电浆引爆法强比例', 'DECIMAL', atLevel('kaisa_p', 'PExecuteAPRatio'), '当前PExecutePercentage树PExecuteAPRatio约0.0006。', 80),
  fixed('mode_damage_multiplier', '模式伤害乘数', 'DECIMAL', atLevel('kaisa_p', 'PTotalDamageMultiplier_ForModesBalance'), '当前PBaseDamage和PCurrentPerStackDamage都消费该模式乘数，当前值为1。', 90),
  runtime('current_stack_count', '当前电浆层数', 'INTEGER', '当前攻击时实际电浆层数由事件顺序提供；范围为0至4，不能默认满层。', 100),
], [
  formula('base_plasma_damage', '基础电浆额外魔法伤害', mul(add(P('base_damage_by_character_level'), mul(P('base_ability_power_ratio'), sourceAPTotal)), P('mode_damage_multiplier')), '当前PBaseDamage=(等级基础值+0.12×法强)×模式乘数。', 10),
  formula('per_stack_plasma_damage', '每层电浆额外魔法伤害', mul(add(P('per_stack_damage_by_character_level'), mul(P('per_stack_ability_power_ratio'), sourceAPTotal)), P('mode_damage_multiplier')), '当前PCurrentPerStackDamage=(等级每层基础值+0.03×法强)×模式乘数。', 20),
  formula('plasma_attack_damage', '当前层数电浆额外魔法伤害', add(mul(add(P('base_damage_by_character_level'), mul(P('base_ability_power_ratio'), sourceAPTotal)), P('mode_damage_multiplier')), mul(mul(add(P('per_stack_damage_by_character_level'), mul(P('per_stack_ability_power_ratio'), sourceAPTotal)), P('mode_damage_multiplier')), P('current_stack_count'))), '当前正文是基础电浆加每层电浆乘实际层数；0至4层由输入提供。', 30),
  formula('execute_percentage', '电浆引爆已损生命比例', add(P('execute_missing_health_ratio'), mul(P('execute_ability_power_ratio'), sourceAPTotal)), '当前PExecutePercentage=PExecuteRatio+PExecuteAPRatio×法强；显示百分号但参数按比例保存。', 40),
  formula('execute_missing_health_damage', '电浆引爆额外魔法伤害', mul(add(P('execute_missing_health_ratio'), mul(P('execute_ability_power_ratio'), sourceAPTotal)), targetHPMissing), '当前引爆伤害取该比例乘目标实际已损生命；缺失生命没有默认值，野怪上限和友军定身触发排除。', 50),
], [], [
  { item: '附近友军定身施加电浆', reason: '第三友军收益超出本轮范围，保留来源而不创建友方事件。' },
  { item: '对野怪400伤害上限', reason: '兵野专用上限，本轮单一敌方英雄范围排除。' },
  { item: '完整角色技能进化替换', reason: '只在Q/W/E分别保存明确进化阈值，不创建整套角色替换状态。' },
], [
  { item: '层数叠加、4秒刷新、引爆取值和技能附加层数', reason: '当前正文明确关系，事件时序与实际存量待接。' },
  { item: '角色等级插值', reason: '原树只有起止值，真实等级输入由运行层提供。' },
], 'P分别保存两段等级外供基础值、每层值、引爆比例和实际层数，未把第三友军或野怪支路混入。');

put('kaisa_q', [
  levels('base_damage', '单发基础物理伤害', 'INTEGER', effectValue('kaisa_q', 0, 5), '客户端mEffectAmount[0]从等级1取40/55/70/85/100。', 10),
  fixed('bonus_attack_damage_ratio', '额外攻击力比例', 'DECIMAL', atLevel('kaisa_q', 'BonusADRatio'), '当前Q单发树ADRatio带mStat2/mStatFormula2，取来源额外攻击力。', 20),
  fixed('ability_power_ratio', '法术强度比例', 'DECIMAL', atLevel('kaisa_q', 'APRatio'), '当前Q单发树APRatio约0.2。', 30),
  fixed('normal_missile_count', '普通弹体数量', 'INTEGER', effectAt('kaisa_q', 1), '当前mEffectAmount[1]为6发普通弹体。', 40),
  fixed('evolved_missile_count', '进化弹体数量', 'INTEGER', effectAt('kaisa_q', 6), '当前mEffectAmount[6]为12发进化弹体。', 50),
  fixed('subsequent_missile_ratio', '后续弹体伤害比例', 'DECIMAL', atLevel('kaisa_q', 'ExtraHitReduction'), '当前正文和ExtraHitReduction=25%；后续每发是完整单发的25%，不是保留75%。', 60),
  fixed('normal_max_damage_multiplier', '普通最大总量倍率', 'DECIMAL', 2.25, '当前MaxDamageTotal树=1+5×0.25，表示首发全量加5发后续25%。', 70),
  fixed('evolved_max_damage_multiplier', '进化最大总量倍率', 'DECIMAL', 3.75, '当前匿名进化树=1+11×0.25，表示首发全量加11发后续25%。', 80),
  fixed('evolution_bonus_attack_damage_threshold', 'Q进化额外攻击力阈值', 'INTEGER', effectAt('kaisa_q', 5), '当前P技能正文引用Q的Effect6Amount=100额外攻击力；只作为进化资格参数。', 90),
  castMs('kaisa_q'),
], [
  formula('individual_missile_damage', '艾卡西亚暴雨单发物理伤害', add3(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus), mul(P('ability_power_ratio'), sourceAPTotal)), '当前单发树=基础值+0.55×额外攻击力+0.2×法强。', 10),
  formula('subsequent_missile_damage', '后续弹体单发物理伤害', mul(add3(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus), mul(P('ability_power_ratio'), sourceAPTotal)), P('subsequent_missile_ratio')), '当前每发额外弹体按25%完整单发计算；同一英雄命中数和分配由事件层提供。', 20),
  formula('normal_max_damage', '普通六发最大物理伤害', mul(add3(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus), mul(P('ability_power_ratio'), sourceAPTotal)), P('normal_max_damage_multiplier')), '当前MaxDamageTotal树给出2.25倍整式；不把该式误作为每颗再乘6。', 30),
  formula('evolved_max_damage', '进化十二发最大物理伤害', mul(add3(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus), mul(P('ability_power_ratio'), sourceAPTotal)), P('evolved_max_damage_multiplier')), '当前匿名进化树给出3.75倍整式；进化条件仍待事件接线。', 40),
], [], [
  { item: '小兵低生命增伤', reason: '低于35%生命的小兵支路，兵线专用不进入本轮。' },
  { item: 'MaxDamageDisplay的匿名原树本体', reason: '已将实际消费的普通/进化最大总量折算为明确倍率参数和公式，未复制无语义匿名节点。' },
  { item: '命中所有目标和弹体集中假设', reason: '只保存单发、后续比例和最大量，实际命中数不默认。' },
], [
  { item: '普通/进化资格、首目标和后续命中数', reason: '正文关系明确，但弹体事件与实际目标分配待接。' },
], 'Q保留实际消费的单发树、25%后续和匿名进化最大量，普通6发与进化12发只作为明确计数，不把整式误乘每颗。');

put('kaisa_w', [
  levels('base_damage', '虚空震波基础魔法伤害', 'INTEGER', effectValue('kaisa_w', 0, 5), '客户端mEffectAmount[0]从等级1取30/55/80/105/130。', 10),
  fixed('total_attack_damage_ratio', '总攻击力比例', 'DECIMAL', 1.3, '当前TotalDamage树mStat2、系数1.3；按当前树取来源总攻击力。', 20),
  fixed('ability_power_ratio', '法术强度比例', 'DECIMAL', 0.45, '当前TotalDamage树mCoefficient约0.45，取来源总法强。', 30),
  fixed('normal_plasma_stacks', '普通命中施加电浆层数', 'INTEGER', effectAt('kaisa_w', 3), '当前正文普通W施加2层电浆。', 40),
  fixed('evolved_plasma_stacks', '进化命中施加电浆层数', 'INTEGER', effectAt('kaisa_w', 4), '当前正文进化W施加3层电浆。', 50),
  fixed('evolved_cooldown_reduction_ratio', '进化命中英雄冷却缩短比例', 'DECIMAL', effectAt('kaisa_w', 2) / 100, '当前正文进化W命中英雄使冷却缩短75%，保存为0.75比例；比例1代表100%。', 60),
], [
  formula('magic_damage', '虚空索敌首个敌方魔法伤害', add3(P('base_damage'), mul(P('total_attack_damage_ratio'), sourceADTotal), mul(P('ability_power_ratio'), sourceAPTotal)), '当前TotalDamage由mEffectAmount[0]+1.3×总攻击力+0.45×法强组成；两层/三层电浆另作资格参数。', 10),
], [], [
  { item: '真实视野4秒', reason: '纯视野结果，本轮不创建视野效果。' },
  { item: '远程几何和额外目标', reason: '只保留首个敌人伤害，空间过程待接。' },
], [
  { item: '命中英雄缩短冷却、施加电浆与电浆后续伤害', reason: '参数已保存，命中时序和P联动由事件层接线。' },
], 'W使用当前mEffectAmount[0]的等级基础值，区别于旧冷却数组冲突；总AD、法强和进化层数分别保存。');

put('kaisa_e', [
  levels('move_speed_base_ratio', '基础移动速度比例', 'DECIMAL', effectValue('kaisa_e', 0, 5), '当前mEffectAmount[0]等级1至5为55/60/65/70/75%，转为0.55至0.75比例。', 10),
  fixed('move_speed_clamp_lower', '移动速度倍率下限', 'DECIMAL', 1, '当前TotalMovespeed树Clamp下限为1，比例1代表100%。', 20),
  fixed('move_speed_clamp_upper', '移动速度倍率上限', 'DECIMAL', 2, '当前TotalMovespeed树Clamp上限为2，比例2代表200%。', 30),
  runtime('actual_bonus_attack_speed_ratio', '实际额外攻击速度比例', 'DECIMAL', '当前TotalMovespeed树mStat4/mStatFormula2的运行阶段尚未窄证；真实额外攻击速度无默认。', 40),
  fixed('attack_speed_duration_ms', '超载攻击速度持续时间（毫秒）', 'INTEGER', effectSecAtMs('kaisa_e', 1), '当前mEffectAmount[1]=4秒，转换为4000毫秒。', 50),
  levels('attack_speed_bonus_ratio', '超载攻击速度比例', 'DECIMAL', effectValue('kaisa_e', 4, 5), '当前mEffectAmount[4]等级1至5为40/50/60/70/80%，转为比例。', 60),
  fixed('evolution_bonus_attack_speed_threshold_ratio', 'E进化额外攻击速度阈值', 'DECIMAL', effectAt('kaisa_e', 5) / 100, '当前P技能正文引用E的Effect6Amount=100%额外攻击速度；系统比例1代表100%。', 70),
  fixed('cooldown_reduction_per_attack_ms', '每次攻击冷却缩短（毫秒）', 'INTEGER', toMs(effectAt('kaisa_e', 3)), '当前mEffectAmount[3]=0.5秒，转换为500毫秒。', 80),
  fixed('evolved_stealth_duration_ms', '进化隐形持续时间（毫秒）', 'INTEGER', effectSecAtMs('kaisa_e', 6), '当前mEffectAmount[6]=0.5秒，转换为500毫秒。', 90),
  fixed('cast_time_base_ms', '超载基础时长（毫秒）', 'INTEGER', toMs(effectAt('kaisa_e', 2)), '当前TotalCastTime树mEffectIndex=3对应1.2秒，转换为1200毫秒；这里不使用mPrecision进行舍入。', 100),
  fixed('cast_time_min_ms', '超载时长下限（毫秒）', 'INTEGER', toMs(0.6), '当前TotalCastTime树下限为0.6秒，转换为600毫秒。', 110),
  fixed('cast_time_attack_speed_coefficient_ms', '攻击速度缩短系数（毫秒）', 'INTEGER', toMs(0.4), '当前TotalCastTime树为1.2-0.4×mStat4，转换系数为400毫秒。', 120),
  runtime('actual_attack_speed_stat', '施法时长实际攻击速度值', 'DECIMAL', '当前TotalCastTime使用mStat4但未证具体属性单位；真实值外供，不与TotalMovespeed的mStatFormula2强行共用。', 130),
], [
  formula('total_move_speed_ratio', '极限超载移动速度比例', mul(P('move_speed_base_ratio'), max(P('move_speed_clamp_lower'), min(P('move_speed_clamp_upper'), add(P('move_speed_clamp_lower'), P('actual_bonus_attack_speed_ratio'))))), '当前TotalMovespeed=基础移动速度×CLAMP(1+实际额外攻击速度,1,2)，保留无默认运行输入。', 10),
  formula('total_cast_time_ms', '极限超载实际持续时长（毫秒）', max(P('cast_time_min_ms'), sub(P('cast_time_base_ms'), mul(P('cast_time_attack_speed_coefficient_ms'), P('actual_attack_speed_stat')))), '当前TotalCastTime=MAX(600,1200-400×mStat4)毫秒；与移动速度树的mStatFormula2不混用。', 20),
], [], [
  { item: 'spellCastTime=0与mCastTime=1.5秒', reason: '来源字段冲突，候选保留实际动态TotalCastTime关系，不任选固定施法时间。' },
  { item: '幽灵状态作为独立碰撞结果', reason: '本轮只保存正文明确的自身加速和进化隐形持续时间，幽灵碰撞资格待接。' },
], [
  { item: '攻击速度动态求值与隐形触发', reason: '两个计算树使用的mStat4阶段未窄证，事件和属性输入待接。' },
  { item: 'mDoesNotConsumeMana=true与公共法力', reason: '来源标志和已有公共法力并存，扣费阶段不自动改零或创建扣费。' },
], 'E分别保存移动速度树和持续时长树，两个mStat4使用实际运行输入但不互相假定，所有毫秒值显式转换为整数。');

put('kaisa_r', [
  levels('shield_base_value', '基础护盾值', 'INTEGER', levelsFrom('kaisa_r', 'RBaseValue', 3), '客户端RCalculatedShieldValue树RBaseValue取等级1至3，为100/150/200。', 10),
  levels('total_attack_damage_ratio', '总攻击力比例', 'DECIMAL', levelsFrom('kaisa_r', 'RTotalADRatio', 3), '当前RCalculatedShieldValue树RTotalADRatio取等级1至3，为0.9/1.35/1.8，取来源总攻击力。', 20),
  fixed('ability_power_ratio', '法术强度比例', 'DECIMAL', atLevel('kaisa_r', 'RAPRatio'), '当前RCalculatedShieldValue树RAPRatio约1.2。', 30),
  fixed('shield_duration_ms', '护盾持续时间（毫秒）', 'INTEGER', secAtMs('kaisa_r', 'RShieldDuration'), '当前正文和RShieldDuration=2秒，转换为2000毫秒。', 40),
  castMs('kaisa_r'),
], [
  formula('shield_value', '猎手本能自身护盾值', add3(P('shield_base_value'), mul(P('total_attack_damage_ratio'), sourceADTotal), mul(P('ability_power_ratio'), sourceAPTotal)), '当前RCalculatedShieldValue=基础值+总攻击力比例+1.2×法强；只用于自身护盾结果。', 10),
], [normalShieldEffect('self_shield', '猎手本能自身护盾', 'shield_duration_ms', 'shield_value', '只定义当前护盾值和2000毫秒生命周期；有电浆敌方英雄附近的跃迁资格与施放时点待接。', 10)], [
  { item: 'RRange', reason: '位移几何范围不建立无消费者公式。' },
  { item: '他人护盾', reason: '当前正文明确护盾归卡莎自身，不能当作友军结果。' },
], [
  { item: '有电浆敌方英雄资格、附近判定与位移时点', reason: '正文关系明确，事件接线待后续运行层。' },
], 'R保留当前三段护盾树和自身NORMAL_SHIELD成熟结构，不创建第三方护盾。');

put('xayah_p', [
  fixed('feather_duration_ms', '羽毛持续时间（毫秒）', 'INTEGER', secAtMs('xayah_p', 'PFeatherDuration'), '当前正文和PFeatherDuration=6秒，转换为6000毫秒。', 10),
  fixed('empowered_attack_count_per_cast', '每次施法强化攻击次数', 'INTEGER', atLevel('xayah_p', 'PStacksPerCast'), '当前PStacksPerCast=3；次数为整数。', 20),
  fixed('empowered_attack_max_stacks', '强化攻击累计层数上限', 'INTEGER', atLevel('xayah_p', 'PStackMax'), '当前PStackMax=5；不自动创建普攻状态。', 30),
  fixed('empowered_attack_window_ms', '强化攻击窗口（毫秒）', 'INTEGER', secAtMs('xayah_p', 'PEmpoweredDuration'), '当前PEmpoweredDuration=8秒，转换为8000毫秒。', 40),
], [], [], [
  { item: 'PDamageFalloffMax、PDamageFalloffMid、PDamageFalloffMin', reason: '这些是沿途其他目标的穿透/衰减分配，本轮主要目标照常全额，不将35/45/55%套到主要目标。' },
  { item: 'PFeatherSpacingMin、PFeatherSpacingMax', reason: '羽毛空间几何，不建立无消费者公式。' },
  { item: '与洛联合回城', reason: '第三方联合回城不属于本轮单一英雄组成。' },
], [
  { item: '强化攻击触发、羽毛生成和累计层数事件', reason: '参数已保存，实际攻击顺序和载体接线待后续运行层。' },
], 'P只保存强化攻击次数、窗口、层数和羽毛持续时间；主要目标全额规则作为范围说明保留。');

put('xayah_q', [
  levels('base_damage', '单把匕首基础物理伤害', 'INTEGER', levelsFrom('xayah_q', 'BaseDamage', 5), '客户端TotalDamage树BaseDamage取等级1至5，为45/60/75/90/105。', 10),
  fixed('bonus_attack_damage_ratio', '额外攻击力比例', 'DECIMAL', 0.5, '当前TotalDamage树mStat2/mStatFormula2的系数为0.5，取来源额外攻击力；比例1代表100%。', 20),
  fixed('dagger_count', '匕首数量', 'INTEGER', 2, '当前正文明确一次投出两把匕首；两把对同一首个目标均按完整单把伤害。', 30),
  fixed('starting_cast_time_ms', '起始施法时间（毫秒）', 'INTEGER', secAtMs('xayah_q', 'StartingCastTime'), '当前StartingCastTime=0.25秒，转换为250毫秒。', 40),
  levels('min_cast_time_ms', '最低施法时间（毫秒）', 'INTEGER', secLevelsMs('xayah_q', 'MinCastTime', 5), '当前MinCastTime技能等级1为0、等级2至5为0.1秒；保留原数组，不猜攻击速度求值。', 50),
  levels('attack_speed_cast_time_scalar', '攻击速度施法缩短系数', 'DECIMAL', levelsFrom('xayah_q', 'ASpeedCastTimeScalarPerHundrethSecond', 5), '当前数组等级1为0、后续为0.07；完整攻击速度动态式待接。', 60),
  fixed('missile_one_delay_ms', '第一把匕首来源延时（毫秒）', 'INTEGER', toMs(atLevel('xayah_q', 'Missile1DelayTime')), '当前Missile1DelayTime约0.334秒，按来源转换为334毫秒。', 70),
  fixed('missile_two_delay_ms', '第二把匕首来源延时（毫秒）', 'INTEGER', toMs(atLevel('xayah_q', 'Missile2DelayTime')), '当前Missile2DelayTime约0.584秒，按来源转换为584毫秒。', 80),
], [
  formula('single_dagger_damage', '双刃单把匕首物理伤害', add(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus)), '当前TotalDamage=基础值+0.5×额外攻击力。', 10),
  formula('two_dagger_damage', '双刃两把匕首对首个目标物理伤害', mul(add(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus)), P('dagger_count')), '当前唯一首个目标可同时受到两把匕首的完整单把伤害；后续目标50%支路不替代第二把。', 20),
], [], [
  { item: 'MultiHitDamage后续目标50%', reason: '这是额外目标分配，本轮只保留首个唯一目标；不能把第二把对同一目标减半。' },
  { item: '匕首速度和空间几何', reason: 'Missile1/2DelaySpeed及宽度仅作时序/几何来源，完整事件待接。' },
], [
  { item: '施法起点、攻击速度动态和羽毛落点', reason: '多个来源延时已保留，不能假定施法结束后再顺序加两次固定延时。' },
], 'Q使用当前0.5额外攻击力树并显式乘两把匕首；独立数学覆盖两把全额和后续目标不误套第二把。');

put('xayah_w', [
  levels('attack_speed_bonus_ratio', '致死羽衣攻击速度比例', 'DECIMAL', levelsFrom('xayah_w', 'WAttackSpeedAmount', 5, (value) => value / 100), '当前WAttackSpeedAmount技能等级1至5为35/40/45/50/55%，转为比例。', 10),
  fixed('attack_speed_duration_ms', '刀刃风暴持续时间（毫秒）', 'INTEGER', secAtMs('xayah_w', 'WAttackSpeedDuration'), '当前WAttackSpeedDuration=4秒，转换为4000毫秒。', 20),
  fixed('secondary_feather_damage_ratio', '次级羽刃伤害比例', 'DECIMAL', atLevel('xayah_w', 'BonusDamagePercent') / 100, '当前正文消费BonusDamagePercent=25%，转为0.25比例；实际攻击基准和特效资格待接。', 30),
  fixed('move_speed_bonus_ratio', '命中英雄自身移动速度比例', 'DECIMAL', atLevel('xayah_w', 'WMoveSpeedAmount') / 100, '当前WMoveSpeedAmount=30%，转为0.3比例。', 40),
  fixed('move_speed_duration_ms', '命中英雄移动速度持续时间（毫秒）', 'INTEGER', secAtMs('xayah_w', 'WMoveSpeedDuration'), '当前WMoveSpeedDuration=1.5秒，转换为1500毫秒。', 50),
  castMs('xayah_w'),
], [], [], [
  { item: '洛获得同效果', reason: '第三友军收益不进入本轮；只保留霞自身明确数值。' },
  { item: 'WRakanSeekDistance', reason: '伙伴搜索几何不建立无消费者公式。' },
  { item: '次级羽刃实际攻击基准、暴击和额外效果类型', reason: '正文只给25%数值，未给完整伤害类型和攻击特效分派。' },
], [
  { item: '施放、命中英雄和自身加速触发', reason: '数值已保存，攻击事件和自身效果时点待接。' },
], 'W保留霞自身的攻击速度、次级羽刃25%和命中英雄移动速度，排除洛的第三友军分支。');

put('xayah_e', [
  levels('base_damage', '每根羽毛基础物理伤害', 'INTEGER', levelsFrom('xayah_e', 'BaseDamage', 5), '客户端FeatherDamage树BaseDamage取等级1至5，为50/65/80/95/110。', 10),
  fixed('bonus_attack_damage_ratio', '额外攻击力比例', 'DECIMAL', atLevel('xayah_e', 'bADRatio'), '当前FeatherDamage树bADRatio约0.4，取来源额外攻击力。', 20),
  fixed('critical_effectiveness_ratio', '暴击效能比例', 'DECIMAL', atLevel('xayah_e', 'CritRatio'), '当前FeatherDamage树CritRatio=0.5；只作用于暴击几率×（暴击倍率-1）部分。', 30),
  runtime('actual_critical_chance_ratio', '实际暴击几率', 'DECIMAL', '当前FeatherDamage的mStat8阶段未窄证；实际暴击几率无默认。', 40),
  runtime('actual_critical_damage_ratio', '实际暴击伤害倍率', 'DECIMAL', '当前FeatherDamage的mStat9阶段未窄证；实际暴击伤害倍率无默认。', 50),
  fixed('feather_falloff_ratio', '每根后续衰减比例', 'DECIMAL', atLevel('xayah_e', 'FeatherFalloff'), '当前扩展正文明确每根额外羽毛使后续伤害降低5%，比例0.05。', 60),
  fixed('feather_minimum_multiplier', '羽毛伤害最低倍率', 'DECIMAL', 0.1, '当前扩展正文明确最低降至10%；这是逐根倍率下限，不是总根数上限。', 70),
  fixed('feather_root_threshold', '禁锢所需羽毛根数', 'INTEGER', atLevel('xayah_e', 'FeatherThreshold'), '当前正文明确至少3根命中才禁锢。', 80),
  fixed('root_duration_ms', '禁锢持续时间（毫秒）', 'INTEGER', secAtMs('xayah_e', 'RootDuration'), '当前RootDuration=1.25秒，转换为1250毫秒。', 90),
  fixed('feather_return_delay_ms', '羽毛回收来源延时（毫秒）', 'INTEGER', secAtMs('xayah_e', 'FeatherReturnDelay'), '当前FeatherReturnDelay=0.25秒，转换为250毫秒。', 100),
  runtime('feather_sequence_index', '同一敌人羽毛序号', 'INTEGER', '逐根计算的1起序号，由实际命中顺序提供；不默认满羽毛、不设置19根上限。', 110),
  fixed('one_ratio', '单位倍率常数', 'DECIMAL', 1, '当前FeatherDamage树中的常数1，供二元公式显式表示。', 120),
], [
  formula('base_feather_damage', '单根羽毛未计暴击物理伤害', add(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus)), '当前FeatherDamage基础树=基础值+0.4×额外攻击力。', 10),
  formula('critical_multiplier', '羽毛暴击效能倍率', add(P('one_ratio'), mul(mul(P('critical_effectiveness_ratio'), P('actual_critical_chance_ratio')), sub(P('actual_critical_damage_ratio'), P('one_ratio')))), '当前树为1+0.5×实际暴击几率×（实际暴击倍率-1）；暴击输入无默认。', 20),
  formula('feather_damage_before_falloff', '单根羽毛暴击后未计序号伤害', mul(add(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus)), add(P('one_ratio'), mul(mul(P('critical_effectiveness_ratio'), P('actual_critical_chance_ratio')), sub(P('actual_critical_damage_ratio'), P('one_ratio'))))), '先把暴击效能乘完整单根基础，尚未应用同一敌人的逐根衰减。', 30),
  formula('feather_falloff_multiplier', '同一敌人逐根伤害倍率', max(P('feather_minimum_multiplier'), sub(P('one_ratio'), mul(P('feather_falloff_ratio'), sub(P('feather_sequence_index'), P('one_ratio'))))), '按序号k计算MAX(0.1,1-0.05×(k-1))；0.1是下限，19根触底不代表19根封顶。', 40),
  formula('feather_damage', '同一敌人单根最终物理伤害', mul(mul(add(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus)), add(P('one_ratio'), mul(mul(P('critical_effectiveness_ratio'), P('actual_critical_chance_ratio')), sub(P('actual_critical_damage_ratio'), P('one_ratio'))))), max(P('feather_minimum_multiplier'), sub(P('one_ratio'), mul(P('feather_falloff_ratio'), sub(P('feather_sequence_index'), P('one_ratio')))))), '当前正文的完整单根伤害乘暴击效能和同敌人逐根衰减；实际根数聚合由事件层处理。', 50),
], [], [
  { item: 'MinionDamage=50%', reason: '小兵专用伤害支路，本轮单一敌方英雄范围排除。' },
  { item: '羽毛总量固定上限', reason: '当前只给逐根最低10%，没有总根数上限；19根触底不是上限。' },
], [
  { item: '回收根数、禁锢命中和逐根事件', reason: '逐根序号输入已保留，实际0/1/3/19/20根聚合和禁锢时序待接。' },
  { item: 'mStat8/mStat9实际暴击阶段', reason: '暴击几率和倍率均无默认。' },
], 'E将暴击效能、逐根衰减和10%下限分开，明确19根只是倍率触底；没有伪造有限总根数公式。');

put('xayah_r', [
  levels('base_damage', '暴风羽刃基础物理伤害', 'INTEGER', levelsFrom('xayah_r', 'RBaseDamage', 3), '客户端Damage树RBaseDamage取等级1至3，为200/300/400。', 10),
  fixed('bonus_attack_damage_ratio', '额外攻击力比例', 'DECIMAL', 1, '当前Damage树mStat2/mStatFormula2系数为1，取来源额外攻击力。', 20),
  fixed('attack_delay_ms', '匕首雨来源延时（毫秒）', 'INTEGER', secAtMs('xayah_r', 'RAttackDelay'), '当前RAttackDelay=1秒，转换为1000毫秒；不代表完整事件时序。', 30),
  fixed('untargetable_duration_ms', '不可被选取持续时间（毫秒）', 'INTEGER', 1500, '当前绑定正文明确持续1.5秒，转换为1500毫秒；原RUntargetable=1.25秒冲突仅作来源记录。', 40),
], [
  formula('physical_damage', '暴风羽刃唯一敌方物理伤害', add(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus)), '当前Damage=基础值+额外攻击力；不可选取期间进入前已影响效果的规则另待事件层。', 10),
], [], [
  { item: 'RUntargetable=1.25秒', reason: '与当前正文1.5秒冲突，保留来源冲突，不用旧字段覆盖正文。' },
  { item: '羽毛具体数量', reason: '当前根消费未给出可审数量，不凭记忆填5或其他值。' },
  { item: 'RMovementSlow、位移几何', reason: '无明确当前消费或纯空间过程。' },
], [
  { item: '空中移动、匕首落点和回收载体', reason: '当前只保存唯一敌人伤害与持续时间，动作时序待接。' },
], 'R按当前中文正文采用1500毫秒不可选取并记录1.25秒客户端冲突；不把不可选取误作全伤害免疫。');

put('zeri_p', [
  runtime('q_min_damage_level_base', '跨Q未充能基础伤害实际等级值', 'DECIMAL', 'P正文跨技能引用Q.MinDamage；Q树为10至25的角色等级插值，当前没有完整等级求值，实际值外供。', 10),
  fixed('q_min_damage_ability_power_ratio', '跨Q未充能法强比例', 'DECIMAL', 0.03, '当前Q.MinDamage树StatByCoefficient约0.03；P沿跨Q引用保留该比例。', 20),
  runtime('q_passive_execute_threshold_level_base', '跨Q处决阈值基础实际等级值', 'DECIMAL', 'P正文跨技能引用Q.PassiveExecuteThreshold；Q树为70至160的角色等级插值，实际值外供，不猜曲线。', 30),
  fixed('q_passive_execute_threshold_ability_power_ratio', '跨Q处决阈值法强比例', 'DECIMAL', 0.2, '当前Q.PassiveExecuteThreshold树系数约0.2；这是处决资格阈值，不是普通伤害。', 40),
  runtime('q_passive_max_damage_level_base', '跨Q满充能基础伤害实际等级值', 'DECIMAL', 'P正文跨技能引用Q.PassiveMaxDamage；Q树为75至160的角色等级插值，实际值外供。', 50),
  fixed('q_passive_max_damage_ability_power_ratio', '跨Q满充能法强比例', 'DECIMAL', 1.1, '当前Q.PassiveMaxDamage树StatByCoefficient约1.1。', 60),
  runtime('q_passive_max_charge_hp_ratio', '跨Q满充能最大生命比例实际值', 'DECIMAL', 'P正文跨技能引用Q.PassiveMaxChargePercentHealth；Q树为1%至11%的角色等级插值，实际比例无默认。', 70),
  fixed('one_ratio', '单位倍率常数', 'DECIMAL', 1, '为跨技能被动的二元公式提供显式单位比例；不改变来源数值。', 80),
], [
  formula('unenergized_magic_damage', '泽丽未充能攻击魔法伤害', add(P('q_min_damage_level_base'), mul(P('q_min_damage_ability_power_ratio'), sourceAPTotal)), '当前P正文跨Q引用MinDamage；基础等级值由实际等级输入，另加0.03×法强。', 10),
  formula('execute_threshold', '泽丽处决生命阈值', add(P('q_passive_execute_threshold_level_base'), mul(P('q_passive_execute_threshold_ability_power_ratio'), sourceAPTotal)), '当前P正文跨Q引用PassiveExecuteThreshold；这是低于阈值的资格判断，不创建自动处决结果。', 20),
  formula('passive_max_damage', '泽丽满充能基础魔法伤害', add(P('q_passive_max_damage_level_base'), mul(P('q_passive_max_damage_ability_power_ratio'), sourceAPTotal)), '当前P正文跨Q引用PassiveMaxDamage；基础等级值由实际等级输入。', 30),
  formula('full_charge_magic_damage', '泽丽满充能攻击总魔法伤害', add(add(P('q_passive_max_damage_level_base'), mul(P('q_passive_max_damage_ability_power_ratio'), sourceAPTotal)), mul(P('q_passive_max_charge_hp_ratio'), targetHPTotal)), '当前P正文跨Q引用PassiveMaxDamage并加PassiveMaxChargePercentHealth×目标最大生命；野怪300上限支路排除。', 40),
], [], [
  { item: '被动护盾偷取、加速和旧PassiveAttackSpeed断点树', reason: '当前正文没有消费这些旧字段，不按字段名补入被动效果。' },
  { item: '野怪百分比伤害300上限', reason: '兵野专用支路，本轮单一敌方英雄范围排除。' },
], [
  { item: '充能存量、未充能/满充能选择和处决事件', reason: '跨Q数值已保留，真实充能状态与处决时序待接。' },
  { item: '角色等级插值', reason: '三段等级曲线均只有端点，禁止线性展开或默认等级。' },
], 'P把当前正文跨技能引用的Q四组组成全部显式保存，区别处决阈值与伤害，并保留无默认等级和充能输入。');

put('zeri_q', [
  levels('base_damage', '电火迸射基础物理伤害', 'INTEGER', levelsFrom('zeri_q', 'BaseDamage', 5), '当前ActiveDamageThatCanCrit树BaseDamage取等级1至5，为22/26/30/34/38；原数组索引0的18不作为技能等级1。', 10),
  levels('total_attack_damage_ratio', '电火迸射总攻击力比例', 'DECIMAL', levelsFrom('zeri_q', 'ActiveADRatio', 5), '当前ActiveDamageThatCanCrit树ActiveADRatio取等级1至5，为1.02/1.04/1.06/1.08/1.1。', 20),
  fixed('missile_count', '子弹数量', 'INTEGER', atLevel('zeri_q', 'NumberOfMissiles'), '当前正文明确一次发射7颗；整次攻击公式只计算一次，不能把整式逐颗再乘7。', 30),
  fixed('min_cooldown_ms', '最小冷却时间（毫秒）', 'INTEGER', toMs(atLevel('zeri_q', 'MinCooldown')), '当前MinCooldown=0.5秒，转换为500毫秒。', 40),
  fixed('attack_speed_cap', '最大攻击速度（每秒攻击次数）', 'DECIMAL', atLevel('zeri_q', 'AttackSpeedCap'), '当前正文和DataValues.AttackSpeedCap=1.5；只是上限来源，不构造完整攻速求值。', 50),
  fixed('excess_attack_speed_to_ad_ratio', '溢出攻击速度转攻击力比例', 'DECIMAL', atLevel('zeri_q', 'ExcessAttackSpeedToADMult'), '当前正文和DataValues为60%，转为0.6比例；不自行定义溢出基数和应用阶段。', 60),
  fixed('charge_per_attack', '每次攻击充能值', 'INTEGER', atLevel('zeri_q', 'ChargePerAttack'), '当前DataValues.ChargePerAttack=10；实际充能存量由事件层提供。', 70),
  fixed('charge_distance_multiplier', '移动充能距离系数', 'DECIMAL', atLevel('zeri_q', 'ChargeDistanceMultiplier'), '当前DataValues.ChargeDistanceMultiplier约0.025；只保存来源系数。', 80),
  castMs('zeri_q'),
], [
  formula('active_physical_damage', '电火迸射整次攻击物理伤害', add(P('base_damage'), mul(P('total_attack_damage_ratio'), sourceADTotal)), '当前ActiveDamageThatCanCrit=基础值+总攻击力比例；七颗子弹作为一次攻击，不能把完整公式重复乘7。', 10),
], [], [
  { item: 'SlowPercent、ActivePercentDamageToTowers和野怪300上限', reason: '当前Q正文不消费这些效果或属于防御物/野怪专用支路。' },
  { item: '完整攻击速度缩短公式', reason: '只保存上限和溢出系数，当前没有可审的完整求值式。' },
], [
  { item: '七颗弹体的命中顺序和一次攻击特效', reason: '正文标签已保留，实际弹体命中事件待接。' },
], 'Q明确保存七颗总量、一次攻击标签和当前暴击入口；独立数学检查不会把整次伤害乘7。');

put('zeri_w', [
  levels('base_damage', '强穿激光基础物理伤害', 'INTEGER', levelsFrom('zeri_w', 'Damage', 5), '当前TotalDamage树Damage取技能等级1至5，为30/70/110/150/190；原数组索引0的-10为哨兵值。', 10),
  fixed('total_attack_damage_ratio', '总攻击力比例', 'DECIMAL', atLevel('zeri_w', 'ADRatio'), '当前TotalDamage树ADRatio约1.2，取来源总攻击力。', 20),
  fixed('ability_power_ratio', '法术强度比例', 'DECIMAL', atLevel('zeri_w', 'APRatio'), '当前TotalDamage树APRatio约0.5。', 30),
  fixed('critical_effectiveness_ratio', '过墙暴击效能比例', 'DECIMAL', atLevel('zeri_w', 'CriticalEffectiveness'), '当前WallDamage树使用CriticalEffectiveness=0.5；只作用于实际暴击倍率增量。', 40),
  runtime('actual_critical_damage_ratio', '实际暴击伤害倍率', 'DECIMAL', '当前WallDamage树mStat9阶段无窄证，不能默认暴击倍率。', 50),
  levels('slow_ratio', '减速比例', 'DECIMAL', levelsFrom('zeri_w', 'SlowPercent', 5), '当前SlowPercent正文直接乘100显示，保存0.3至0.5比例。', 60),
  fixed('slow_duration_ms', '减速持续时间（毫秒）', 'INTEGER', secAtMs('zeri_w', 'SlowDuration'), '当前SlowDuration=2秒，转换为2000毫秒。', 70),
  fixed('beam_cast_time_ms', '过墙激光来源延时（毫秒）', 'INTEGER', toMs(atLevel('zeri_w', 'BeamCastTime')), '当前BeamCastTime约0.85秒，转换为850毫秒。', 80),
  fixed('min_cast_time_ms', '动态施法最低时间（毫秒）', 'INTEGER', toMs(atLevel('zeri_w', 'MinCastTime')), '当前MinCastTime约0.3秒，转换为300毫秒。', 90),
  fixed('attack_speed_cast_time_scalar', '攻击速度施法缩短系数', 'DECIMAL', atLevel('zeri_w', 'ASpeedCastTimeScalarPerHundrethSecond'), '当前攻击速度施法缩短系数约0.09；不建立未证完整动态式。', 100),
  fixed('base_cast_time_ms', '动态施法基础时间（毫秒）', 'INTEGER', toMs(atLevel('zeri_w', 'BaseCastTime')), '当前BaseCastTime约0.55秒，转换为550毫秒。', 110),
  fixed('one_ratio', '单位倍率常数', 'DECIMAL', 1, '为过墙暴击树提供显式单位倍率；不改变当前树数值。', 120),
], [
  formula('normal_physical_damage', '强穿激光普通物理伤害', add3(P('base_damage'), mul(P('total_attack_damage_ratio'), sourceADTotal), mul(P('ability_power_ratio'), sourceAPTotal)), '当前TotalDamage=基础值+1.2×总攻击力+0.5×法强。', 10),
  formula('wall_physical_damage', '过墙激光物理伤害', mul(add3(P('base_damage'), mul(P('total_attack_damage_ratio'), sourceADTotal), mul(P('ability_power_ratio'), sourceAPTotal)), add(P('one_ratio'), mul(P('critical_effectiveness_ratio'), sub(P('actual_critical_damage_ratio'), P('one_ratio'))))), '当前WallDamage=普通完整伤害×[1+0.5×(实际暴击倍率-1)]；树中没有暴击几率项。', 20),
], [], [
  { item: '过墙区域额外目标和几何宽度', reason: '单一首个敌人伤害保留，BeamWidth和区域额外命中不建立结果。' },
  { item: '暴击几率项', reason: '当前WallDamage树只消费暴击伤害倍率，不能因扩展文字自行添加暴击几率。' },
], [
  { item: '施法时长随攻击速度动态求值', reason: '来源字段和mStat阶段尚未窄证，保留基础/下限/系数。' },
], 'W沿当前普通与过墙树分开，过墙只使用树内暴击伤害倍率增量，不引入未消费暴击几率。');

put('zeri_e', [
  fixed('buff_duration_ms', '灿丽花火增益持续时间（毫秒）', 'INTEGER', secAtMs('zeri_e', 'BuffDuration'), '当前正文BuffDuration=5秒，转换为5000毫秒。', 10),
  levels('penetration_damage_ratio', '穿刺后续目标伤害比例', 'DECIMAL', levelsFrom('zeri_e', 'PenDamagePercent', 5), '当前正文PenDamagePercent从等级1取80/85/90/95/100%，保存0.8至1比例；额外目标分配事件排除。', 20),
  fixed('cooldown_reduction_per_hit_ms', '普通命中英雄冷却缩短（毫秒）', 'INTEGER', toMs(atLevel('zeri_e', 'CDReductionPerHit')), '当前正文每次攻击或技能命中英雄缩短0.5秒，转换为500毫秒。', 30),
  fixed('critical_cooldown_reduction_ms', '暴击命中英雄冷却缩短（毫秒）', 'INTEGER', toMs(atLevel('zeri_e', 'CritCDReductionPerHit')), '当前正文暴击转为1.5秒缩短，转换为1500毫秒，不与普通0.5秒相加。', 40),
  levels('bonus_damage_base', '首个目标额外魔法伤害基础值', 'INTEGER', levelsFrom('zeri_e', 'BonusDamageBase', 5), '当前BonusDamageTotal树基础值取等级1至5，为22/24/26/28/30。', 50),
  fixed('bonus_ability_power_ratio', '首个目标额外魔法伤害法强比例', 'DECIMAL', atLevel('zeri_e', 'BonusAPRatio'), '当前BonusDamageTotal树BonusAPRatio约0.2。', 60),
  fixed('critical_scaling_ratio', '额外伤害暴击效能比例', 'DECIMAL', atLevel('zeri_e', 'CritScalingMod'), '当前树CritScalingMod=1；额外伤害按暴击几率×(暴击倍率-1)提升。', 70),
  runtime('actual_critical_chance_ratio', '实际暴击几率', 'DECIMAL', '当前BonusDamageTotal树mStat8阶段无窄证，实际暴击几率无默认。', 80),
  runtime('actual_critical_damage_ratio', '实际暴击伤害倍率', 'DECIMAL', '当前BonusDamageTotal树mStat9阶段无窄证，实际暴击伤害倍率无默认。', 90),
  fixed('dash_speed_base', '冲刺基础速度', 'INTEGER', 600, '当前DashSpeed和匿名{93e3e1a0}树均为600+来源移动速度。', 100),
  fixed('dash_speed_move_speed_ratio', '冲刺移动速度系数', 'DECIMAL', 1, '当前DashSpeed树移动速度系数为1。', 110),
  fixed('one_ratio', '单位倍率常数', 'DECIMAL', 1, '为额外伤害暴击树提供显式单位倍率。', 120),
], [
  formula('bonus_magic_damage', '灿丽花火首个目标额外魔法伤害', mul(add(P('bonus_damage_base'), mul(P('bonus_ability_power_ratio'), sourceAPTotal)), add(P('one_ratio'), mul(mul(P('critical_scaling_ratio'), P('actual_critical_chance_ratio')), sub(P('actual_critical_damage_ratio'), P('one_ratio'))))), '当前BonusDamageTotal=(基础值+0.2×法强)×[1+暴击效能×暴击几率×(暴击倍率-1)]。', 10),
  formula('dash_speed', '灿丽花火冲刺速度', add(P('dash_speed_base'), mul(P('dash_speed_move_speed_ratio'), sourceMoveSpeed)), '当前DashSpeed=600+来源移动速度；位移和穿刺目标事件待接。', 20),
], [], [
  { item: 'NumberOfPierceShots=3', reason: '当前5秒正文只保证穿刺状态，没有消费仅3次的限制；不把旧内部数值强制写成次数上限。' },
  { item: '后续目标穿刺比例和野怪分支', reason: '额外目标及兵野专用分配排除；首个目标额外魔法伤害保留。' },
  { item: 'MaxDistance、RevealRangeOverWalls和动画截断', reason: '位移/视野几何和纯动画字段不建立无消费者公式。' },
], [
  { item: '攻击或技能命中英雄的冷却事件', reason: '普通和暴击两种明确数值已分开，事件接线待后续运行层。' },
], 'E保留首个目标额外伤害的暴击树和冲刺速度树，分开记录普通/暴击冷却缩短，不使用3次旧字段限制。');

put('zeri_r', [
  levels('active_damage_base', '超限爆闪基础魔法伤害', 'INTEGER', levelsFrom('zeri_r', 'ActiveDamage', 3), '当前TotalActiveDamage树ActiveDamage取等级1至3，为150/250/350。', 10),
  fixed('ability_power_ratio', '法术强度比例', 'DECIMAL', 1.1, '当前TotalActiveDamage树mCoefficient约1.1，取来源总法强。', 20),
  fixed('bonus_attack_damage_ratio', '额外攻击力比例', 'DECIMAL', 0.6, '当前TotalActiveDamage树mStat2/mStatFormula2系数约0.6，取来源额外攻击力。', 30),
  fixed('initial_duration_ms', '初始超负荷持续时间（毫秒）', 'INTEGER', secAtMs('zeri_r', 'RDuration'), '当前正文RDuration=5秒，转换为5000毫秒。', 40),
  fixed('remaining_duration_cap_ms', '延长后剩余时间上限（毫秒）', 'INTEGER', secAtMs('zeri_r', 'RDuration'), '当前正文明确延长不能超出初始5秒；这是剩余时间上限，不是每次延长量。', 50),
  fixed('base_attack_speed_bonus_ratio', '命中英雄攻击速度比例', 'DECIMAL', atLevel('zeri_r', 'BaseASPercent'), '当前正文命中英雄后提供30%攻击速度，转为0.3比例。', 60),
  fixed('base_move_speed_bonus_ratio', '命中英雄基础移动速度比例', 'DECIMAL', atLevel('zeri_r', 'BaseBonusMS'), '当前正文命中英雄后提供15%移动速度，转为0.15比例。', 70),
  fixed('hypercharge_stack_duration_ms', '超负荷层持续时间（毫秒）', 'INTEGER', secAtMs('zeri_r', 'MaxHyperchargeDuration'), '当前正文MaxHyperchargeDuration=2.5秒，转换为2500毫秒。', 80),
  fixed('move_speed_per_stack_ratio', '每层超负荷移动速度比例', 'DECIMAL', atLevel('zeri_r', 'MSPercent'), '当前正文每层提供1.5%移动速度，转为0.015比例。', 90),
  fixed('q_hypercharge_missile_count', '超负荷期间Q连发数量', 'INTEGER', 3, '当前正文明确超负荷期间Q变为快速3连发；链向额外目标另行排除。', 100),
  runtime('current_hypercharge_stack_count', '当前超负荷层数', 'INTEGER', '层数由真实英雄命中事件提供；原始MaxStacks=100000只是实现界限，不作为实际推荐上限或默认值。', 110),
], [
  formula('active_magic_damage', '超限爆闪唯一敌方魔法伤害', add3(P('active_damage_base'), mul(P('ability_power_ratio'), sourceAPTotal), mul(P('bonus_attack_damage_ratio'), sourceADBonus)), '当前TotalActiveDamage=基础值+1.1×法强+0.6×额外攻击力；扩散额外目标不进入本轮。', 10),
  formula('hypercharge_move_speed_ratio', '超负荷层移动速度比例', mul(P('move_speed_per_stack_ratio'), P('current_hypercharge_stack_count')), '当前正文每层提供1.5%移动速度；层数实际输入无默认，状态效果和刷新事件待接。', 20),
], [], [
  { item: 'TotalBonusDamage=5/10/15+0.15AP', reason: '当前正文未消费该旧树，不能把字段名当作R主动额外伤害。' },
  { item: 'DurationIncreasePerHit、StackDuration旧量化', reason: '当前正文只明确延长且不超过初始5秒，没有证明这些旧数值就是延长量；只保留上限和层持续时间。' },
  { item: 'ChainPhysicalDamage与MaxChainTargets', reason: '连锁属于额外敌人分配，本轮单一敌人范围排除。' },
  { item: '原始MaxStacks=100000作为实际上限', reason: '这是实现界限，不是实际机制上限。' },
], [
  { item: '命中英雄刷新、延长剩余时间和Q三连发事件', reason: '初始5秒上限与层持续时间已保存，真实延长量和命中时序待接。' },
  { item: 'mDoesNotConsumeCooldown=true', reason: '来源标志与已有公共冷却并存，不能据此自动改变公共冷却或扣除规则。' },
], 'R保留当前主动新星伤害、自身5秒增益、每层移动速度和Q三连发；延长只记录初始剩余时间上限，避免把未消费旧树当成延长量。');

const sourceBySkill = Object.fromEntries(order.map((skillKey) => {
  const { heroId, slot } = skillKeyParts(skillKey);
  return [skillKey, sourceFor(heroId, slot)];
}));
const currentSummary = snapshot.summary;
const skillObjects = Object.fromEntries(order.map((skillKey) => {
  const current = currentSummary[skillKey];
  if (!current) throw new Error(`保护快照缺少${skillKey}`);
  const source = sourceBySkill[skillKey];
  return [skillKey, {
    skillKey,
    name: current.subject.name,
    maxLevel: current.subject.maxLevel,
    source,
    write: writes[skillKey],
    protectedExisting: {
      subject: current.subject,
      components: current.components,
      publicOnly: current.publicOnly,
      source: '输入包/参考资料/当前20槽保护快照.json',
    },
    excluded: excluded[skillKey],
    pending: pending[skillKey],
    proofs: [{
      binding: source,
      currentBoundText: source.currentBoundText,
      sourceFacts: source.raw,
      officialEvidence: source.officialEvidence,
      sourceNote: `固定客户端16.17、官方16.17.1；根绑定 ${source.rootPath} -> ${source.spellPath}。`,
    }],
    proofNote: proofNotes[skillKey],
  }];
}));

const kinds = ['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'];
const counts = Object.fromEntries(kinds.map((kind) => [kind, order.reduce((sum, skillKey) => sum + skillObjects[skillKey].write[kind].length, 0)]));
const requestCount = Object.values(counts).reduce((sum, value) => sum + value, 0);
const reuseEntries = Array.isArray(reuseList) ? reuseList : (reuseList.parameters || reuseList.reusedParameters || []);
const reusedPublicParameters = reuseEntries.map((item) => ({
  skillKey: item.skillKey,
  parameterKey: item.parameterKey,
  source: '输入包/参考资料/公共参数复用清单.json',
  post: false,
}));
const reusedExistingParameters = reusedPublicParameters.map(({ skillKey, parameterKey, post }) => ({ skillKey, parameterKey, post }));
const protectedSubjects = order.map((skillKey) => ({ skillKey, subject: currentSummary[skillKey].subject, source: '输入包/参考资料/当前20槽保护快照.json' }));
const protectedCompositionLists = Object.fromEntries(order.map((skillKey) => [skillKey, currentSummary[skillKey].components]));
const protectedRoutes = snapshot.requests.map((request) => request.route);
const protectedObjects = {
  subjects: protectedSubjects,
  currentCompositionLists: protectedCompositionLists,
  reusedPublicParameters: reusedPublicParameters.map((item) => ({
    skillKey: item.skillKey,
    parameterKey: item.parameterKey,
    current: currentSummary[item.skillKey].components.parameters.find((parameter) => parameter.parameterKey === item.parameterKey) || null,
    source: '输入包/参考资料/当前20槽保护快照.json',
  })),
  protectedReferenceRequests: snapshot.requests,
  protectedReferenceRoutes: protectedRoutes,
  protectedReferenceCounts: {
    GETs: snapshot.GETs,
    subjects: protectedSubjects.length,
    currentCompositionSkillSlots: order.length,
    currentCompositionLists: order.length * 6,
    reusedPublicParameters: reusedPublicParameters.length,
    images: order.length,
    characters: binding.heroes.length,
    characterSkillRelations: binding.heroes.length,
    dictionaries: 4,
  },
  scope: '完整保留输入快照中的20个主体、120个六类组成列表、29项已有公共参数、四个字典、4个角色、4组角色关系和20张代表图；新增请求只能POST候选组成，不能更新、删除或覆盖。',
  snapshotFile: '输入包/参考资料/当前20槽保护快照.json',
  snapshotSha256: currentSnapshotSha256,
};

const meta = {
  generatedAt: GENERATED_AT,
  batch: BATCH,
  status: '候选已生成，等待主负责人审查；未调用业务接口',
  gameId: 'lol',
  apiBase: API_BASE,
  sourceVersion,
  scope: '库奇、卡莎、霞、泽丽20个技能槽；只新增来源明确参数、实际二元公式和卡莎R自身护盾效果。已有主体、六类组成、29项公共参数、四个角色及关系、代表图和字典全部保护；不写业务接口，不创建自动触发、伤害结果、直接治疗、瞬时求值或周期过程。',
  sourcePolicy: '固定客户端16.17、官方16.17.1和构建16.17.8104348；沿当前根绑定正文和当前计算树；未知等级曲线、暴击阶段、施法时序、事件资格和运行输入不猜、不设默认。',
  inputPackage: '输入包/',
  currentSnapshot: '输入包/参考资料/当前20槽保护快照.json',
  currentSnapshotSha256,
  sourceIndexSha256,
  businessWrites: 0,
  apiCalls: 0,
  tokenStored: false,
  candidateSha256: null,
};
const candidate = {
  meta,
  skills: skillObjects,
  order,
  reusedPublicParameters,
  reusedExistingParameters,
  counts,
  apiWrites: 0,
  sourceFiles: sourceManifestFiles,
  sourceNotes: {
    corki: 'P保留20%额外真实伤害，Q/E为当前单一敌人伤害，W使用完整最大总量，R使用当前4发和树内回充公式。',
    kaisa: 'P保留跨技能电浆和引爆组成，Q按6/12发与后续25%，W按总AD和法强，E分离两棵攻击速度树，R只定义自身护盾。',
    xayah: 'P保留强化攻击与羽毛时间，Q两把匕首对首目标全量，E按暴击效能和逐根5%衰减至10%下限，R使用当前正文1.5秒不可选取。',
    zeri: 'P完整保存跨Q引用，Q七颗作为整次攻击，W过墙树不加暴击几率，E保留首个目标附加伤害，R延长不超过5秒。',
    ratios: '比例字段按1代表100%；正文百分数只转换一次。',
    runtimeInputs: '实际暴击倍率、暴击几率、角色等级曲线、充能层数、命中根数、移动/攻击速度和目标生命均无默认。',
  },
  protectedObjects,
  revision: 'hero32-source-v1-candidate',
};
writeJson('完整候选.json', candidate);

const requests = [];
let sequence = 0;
const routeKind = (kind) => kind.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`);
for (const skillKey of order) {
  for (const kind of kinds) {
    for (const body of skillObjects[skillKey].write[kind]) {
      sequence += 1;
      const stableKey = body.parameterKey || body.formulaKey || body.effectKey || body.processKey || body.stateKey || body.ruleKey;
      const route = routeKind(kind);
      requests.push({ sequence, method: 'POST', route: `/skills/${skillKey}/${route}`, detailRoute: `/skills/${skillKey}/${route}/${stableKey}`, skillKey, kind, stableKey, status: '仅意图，未调用', body });
    }
  }
}
if (requests.length !== requestCount) throw new Error(`请求计数不一致 ${requests.length}/${requestCount}`);
const plan = {
  generatedAt: GENERATED_AT,
  status: '仅写入意图，未调用业务接口',
  batch: BATCH,
  apiBase: API_BASE,
  sourceVersion,
  candidateSha256: null,
  currentSnapshotSha256,
  requestCount,
  requestCounts: counts,
  currentTotalComponents: requestCount + reusedPublicParameters.length,
  reusedPublicParameters,
  protectedSkills: order,
  protectedCounts: protectedObjects.protectedReferenceCounts,
  protectedRoutes,
  requests,
  noApiCalls: true,
};
writeJson('写前请求计划.json', plan);

const sourceValues = {
  generatedAt: GENERATED_AT,
  status: '独立源值摘要，未调用业务接口',
  batch: BATCH,
  sourceVersion,
  sourceIndexSha256,
  selectedValues: Object.fromEntries(order.map((skillKey) => [skillKey, {
    source: sourceBySkill[skillKey].spellPath,
    dataValues: sourceBySkill[skillKey].raw.dataValues,
    calculations: sourceBySkill[skillKey].raw.calculations,
    rawFields: {
      spellCastTime: sourceBySkill[skillKey].raw.spellCastTime,
      mCastTime: sourceBySkill[skillKey].raw.mCastTime,
      cooldownTime: sourceBySkill[skillKey].raw.cooldownTime,
      mMaxAmmo: sourceBySkill[skillKey].raw.mMaxAmmo,
      mAmmoRechargeTime: sourceBySkill[skillKey].raw.mAmmoRechargeTime,
      mDoesNotConsumeMana: sourceBySkill[skillKey].raw.mDoesNotConsumeMana,
      mDoesNotConsumeCooldown: sourceBySkill[skillKey].raw.mDoesNotConsumeCooldown,
    },
    officialEvidence: sourceBySkill[skillKey].officialEvidence,
    candidateParameters: skillObjects[skillKey].write.parameters.map((p) => ({ parameterKey: p.parameterKey, valueType: p.valueType, valueMode: p.valueMode, fixedValue: p.fixedValue, levelValues: p.levelValues })),
    candidateFormulas: skillObjects[skillKey].write.formulas.map((f) => ({ formulaKey: f.formulaKey, name: f.name, description: f.description })),
  }])),
  scopeAndPending: Object.fromEntries(order.map((skillKey) => [skillKey, { excluded: excluded[skillKey], pending: pending[skillKey] }])),
  noWrites: true,
};
writeJson('源值解析.json', sourceValues);
const sourceManifest = {
  generatedAt: GENERATED_AT,
  status: '固定输入散列已核对，未调用业务接口',
  batch: BATCH,
  sourceVersion,
  inputPackage: '输入包/',
  sourceIndexSha256,
  currentSnapshotSha256,
  files: sourceManifestFiles,
  inputIntegrity,
  sourceManifestSha256: null,
  noApiCalls: true,
};
writeJson('来源哈希汇总.json', sourceManifest);

const sourceScope = {
  batch: BATCH,
  status: '候选已生成，严格数学脚本随后运行；未调用业务接口',
  sourceVersion,
  sourceIndexSha256,
  sourcePolicy: meta.sourcePolicy,
  included: [
    '库奇：P额外真实伤害、Q/E单一敌人伤害、W路径完整最大伤害、R小/大导弹与当前4发回充组成。',
    '卡莎：P跨Q电浆与引爆、Q普通/进化最大量、W伤害和电浆层数、E两棵攻击速度树、R自身护盾。',
    '霞：P时间与强化攻击、Q两把匕首全量、W自身强化、E逐根羽毛伤害、R单一敌人伤害。',
    '泽丽：P跨Q四项、Q七颗整次攻击、W普通/过墙、E首个目标附加伤害、R主动伤害和5秒上限组成。',
  ],
  excludedOrPending: [
    '额外敌人/友军/兵野专用分支、纯视野、纯几何、独立召唤、完整角色替换、自动触发、伤害结果、直接治疗、瞬时求值和周期过程。',
    '未知等级插值、实际暴击阶段、攻击速度完整缩短、弹体/羽毛命中时序、充能和公共资源扣费均保持待接。',
  ],
  perSkillExcluded: Object.fromEntries(order.map((skillKey) => [skillKey, excluded[skillKey]])),
  perSkillPending: Object.fromEntries(order.map((skillKey) => [skillKey, pending[skillKey]])),
  counts: { ...counts, requestCount, currentTotalComponents: requestCount + reusedPublicParameters.length, reusedPublicParameters: reusedPublicParameters.length, protectedSubjects: protectedSubjects.length, protectedCompositionLists: order.length * 6, protectedReferenceGETs: snapshot.GETs },
  hashes: { currentSnapshotSha256, sourceManifestSha256: null, candidateSha256: null, planSha256: null, sourceValuesSha256: null, strictMathSha256: null },
  noApiCalls: true,
};
writeJson('来源与范围.json', sourceScope);

const candidateSha256 = sha256(fs.readFileSync(path.join(ROOT, '完整候选.json')));
const planSha256 = sha256(fs.readFileSync(path.join(ROOT, '写前请求计划.json')));
const sourceValuesSha256 = sha256(fs.readFileSync(path.join(ROOT, '源值解析.json')));
const sourceManifestSha256 = sha256(fs.readFileSync(path.join(ROOT, '来源哈希汇总.json')));
writeJson('候选版本.json', {
  generatedAt: GENERATED_AT,
  status: '候选已生成，等待主负责人审查；未调用业务接口',
  batch: BATCH,
  sourceRevision: 'hero32-source-v1-candidate',
  candidateSha256,
  requestPlanSha256: planSha256,
  sourceValuesSha256,
  sourceManifestSha256,
  currentSnapshotSha256,
  sourceIndexSha256,
  counts,
  requestCount,
  currentTotalComponents: requestCount + reusedPublicParameters.length,
  reusedPublicParameters: reusedPublicParameters.length,
  businessWrites: 0,
  strictMathSha256: null,
  noApiCalls: true,
});
writeJson('冻结候选锁.json', {
  generatedAt: GENERATED_AT,
  status: '候选已生成，等待主负责人审查；未授权业务写入',
  batch: BATCH,
  candidateSha256,
  requestPlanSha256: planSha256,
  sourceValuesSha256,
  sourceManifestSha256,
  currentSnapshotSha256,
  requestCount,
  counts,
  currentTotalComponents: requestCount + reusedPublicParameters.length,
  protectedExisting: { subjects: protectedSubjects.length, compositionLists: order.length * 6, reusedPublicParameters: reusedPublicParameters.length, protectedReferenceGETs: snapshot.GETs },
  noApiCalls: true,
  applyAuthorized: false,
  strictMathSha256: null,
});
writeJson('候选交付索引.json', {
  batch: BATCH,
  status: '候选已生成，严格数学脚本随后运行，未调用业务接口',
  candidate: '完整候选.json',
  plan: '写前请求计划.json',
  sourceValues: '源值解析.json',
  sourceManifest: '来源哈希汇总.json',
  version: '候选版本.json',
  lock: '冻结候选锁.json',
  source: '输入包/来源绑定与当前文本.json',
  protected: '输入包/参考资料/当前20槽保护快照.json',
  reused: '输入包/参考资料/公共参数复用清单.json',
  counts,
  requestCount,
  currentTotalComponents: requestCount + reusedPublicParameters.length,
  reusedParameters: reusedPublicParameters.length,
  protectedSubjects: protectedSubjects.length,
  protectedCompositionLists: order.length * 6,
  protectedReferenceGETs: snapshot.GETs,
  noApiCalls: true,
  strictMath: '严格数学.json',
  strictMathSha256: null,
  finalStatus: '候选已生成，严格数学脚本随后运行，未调用业务接口',
});

const readmeText = `# 第三十二批候选

本目录整理库奇、卡莎、霞、泽丽20个技能槽，来源固定为客户端16.17、官方16.17.1和构建 ${clientBuild}。候选沿根绑定的当前中文正文、计算树和同版官方数组整理，输入包是主负责人提供的只读副本。

本批新增 ${requestCount} 个组成，其中参数 ${counts.parameters} 个、二元公式 ${counts.formulas} 个、自身护盾效果 ${counts.effects} 个；另有 ${reusedPublicParameters.length} 个已有公共参数复用，不放入新增请求。当前总组成口径为新增 ${requestCount} 加既有复用 ${reusedPublicParameters.length}，当前20个技能主体及 ${order.length * 6} 个六类列表由 ${snapshot.GETs} 次只读快照完整保护。

候选保留唯一敌人伤害、同一目标的完整组成、自身强化、跨技能引用、战前充能和资源上限等已证内容；额外目标、第三友军、兵野专用分支、纯视野与纯几何留在逐技能排除记录。未知等级曲线、暴击阶段、命中顺序、充能状态、资源扣费和完整攻击速度求值均不设默认。

执行顺序为先运行生成脚本，再运行独立源值数学，最后运行收口冻结。三个脚本只读取输入包或候选文件，不调用业务接口；本批业务接口写入为0。
`;
fs.writeFileSync(path.join(ROOT, 'README.md'), readmeText, 'utf8');
const experienceText = `# 第三十二批候选体验记录

## 可审查内容

- 库奇W把路径期间的MaximumDamage作为完整总量，库奇R采用当前4发弹药并把回充树的mStat8作为无默认实际输入。
- 卡莎P保留跨Q的四项被动组成，Q区分普通6发、进化12发和后续25%，E把移动速度与施法时长两棵树分开。
- 霞Q对唯一首个目标按两把匕首全量，霞E逐根采用MAX(10%，1-5%×(序号-1))，19根触底不作为根数上限。
- 泽丽P不漏Q的跨技能引用，Q七颗子弹只求一次整次攻击，W过墙树不添加未消费的暴击几率，R延长上限固定为初始5秒。

## 当前缺口

候选阶段没有实时数据库、运行时战斗或浏览器证据。弹体、羽毛、充能、技能进化、资源扣费、攻击速度、暴击选择器和效果触发仍需后续运行层接线；数据数组索引、百分数转换和毫秒整数转换已在源值与严格数学材料中记录。

独立数学应直接读取候选表达式和输入包原始数组，逐公式覆盖两组不同属性/等级/输入、缺失输入、二元节点、整数毫秒、比例、跨技能引用以及0/1/3/19/20边界。它是候选静态证据，不代表业务入库或页面验收。

本批业务接口写入为0。`;
fs.writeFileSync(path.join(ROOT, '体验报告.md'), experienceText, 'utf8');

console.log(JSON.stringify({ candidateSha256, planSha256, sourceValuesSha256, sourceManifestSha256, requestCount, counts, currentTotalComponents: requestCount + reusedPublicParameters.length, reusedPublicParameters: reusedPublicParameters.length, protectedSubjects: protectedSubjects.length, protectedCompositionLists: order.length * 6, protectedReferenceGETs: snapshot.GETs, apiWrites: 0 }, null, 2));
