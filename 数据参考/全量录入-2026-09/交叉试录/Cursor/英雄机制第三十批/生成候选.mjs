import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = __dirname;
const INPUT = path.join(ROOT, '输入包');
const OUT = ROOT;
const BATCH = '英雄机制第三十批';
const API_BASE = 'http://127.0.0.1:8080/api/admin/games/lol';
const GENERATED_AT = new Date().toISOString();

const json = (relative) => JSON.parse(fs.readFileSync(path.join(INPUT, relative), 'utf8'));
const inputVersion = json('输入版本.json');
const binding = json('来源绑定与当前文本.json');
const snapshot = json('参考资料/当前10槽保护快照.json');
const reuseList = json('参考资料/公共参数复用清单.json');
const attributes = json('参考资料/属性默认与边界.json');
const official = {
  Yasuo: json('参考资料/官方英文/Yasuo.json').data.Yasuo,
  Yone: json('参考资料/官方英文/Yone.json').data.Yone,
};

const sha256Buffer = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sha256File = (relative) => sha256Buffer(fs.readFileSync(path.join(INPUT, relative)));
const slash = (value) => value.split(path.sep).join('/');
const writeJson = (relative, value) => {
  fs.writeFileSync(path.join(OUT, relative), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const sourceFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else sourceFiles.push(absolute);
  }
};
walk(INPUT);
sourceFiles.sort();
const sourceManifestFiles = sourceFiles.map((absolute) => {
  const relative = slash(path.relative(INPUT, absolute));
  return {
    path: relative,
    sha256: sha256File(relative),
    byteSize: fs.statSync(absolute).size,
  };
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

const sourceIndexSha256 = inputVersion.sourceIndexSha256;
const currentSnapshotSha256 = sha256File('参考资料/当前10槽保护快照.json');
const clientBuild = '16.17.8104348+branch.releases-16-17.content.release';
const sourceVersion = {
  clientVersion: inputVersion.clientVersion || '16.17',
  officialVersion: inputVersion.officialVersion || '16.17.1',
  build: clientBuild,
};

const heroFor = (heroId) => binding.heroes.find((hero) => hero.id === heroId);
const skillFor = (heroId, slot) => {
  const skill = heroFor(heroId)?.skills.find((item) => item.slot === slot);
  if (!skill) throw new Error(`找不到来源绑定 ${heroId}/${slot}`);
  return skill;
};
const spellIndexFor = { Q: 0, W: 1, E: 2, R: 3 };
const selectedDataValues = (rawSpell, names) => Object.fromEntries(
  (rawSpell.DataValues || [])
    .filter((item) => names.includes(item.name))
    .map((item) => [item.name, item.values ? item.values.slice() : null]),
);
const selectedCalculations = (rawSpell, names) => Object.fromEntries(
  names.filter((name) => rawSpell.mSpellCalculations?.[name]).map((name) => [name, rawSpell.mSpellCalculations[name]]),
);
const rawSourceFacts = (heroId, slot) => {
  const hero = heroFor(heroId);
  const skill = skillFor(heroId, slot);
  const rawSpell = skill.object.mSpell;
  const names = hero.source.skills.find((item) => item.slot === slot)?.dataValueNames || [];
  const calculationNames = hero.source.skills.find((item) => item.slot === slot)?.calculationNames || [];
  return {
    dataValues: selectedDataValues(rawSpell, names),
    calculations: selectedCalculations(rawSpell, calculationNames),
    spellCastTime: rawSpell.spellCastTime ?? null,
    mCastTime: rawSpell.mCastTime ?? null,
    cooldownTime: rawSpell.cooldownTime ?? null,
    mDoesNotConsumeCooldown: rawSpell.mDoesNotConsumeCooldown ?? null,
    mCooldownNotAffectedByCDR: rawSpell.mCooldownNotAffectedByCDR ?? null,
  };
};
const officialEvidenceFor = (heroId, slot) => {
  const hero = official[heroId];
  if (slot === 'P') {
    return {
      path: `data.${heroId}.passive.description`,
      text: hero.passive?.description || null,
      relevantEnemyTip: hero.enemytips?.[3] || null,
      relevantEnemyTipPath: hero.enemytips?.[3] ? `data.${heroId}.enemytips[3]` : null,
    };
  }
  const spell = hero.spells[spellIndexFor[slot]];
  return {
    path: `data.${heroId}.spells[${spellIndexFor[slot]}]`,
    name: spell?.name || null,
    description: spell?.description || null,
    tooltip: spell?.tooltip || null,
  };
};
const sourceFor = (heroId, slot) => {
  const hero = heroFor(heroId);
  const skill = skillFor(heroId, slot);
  const sourceMeta = hero.source;
  const clientRelative = `参考资料/客户端原文/${heroId}.json.gz`;
  const officialZhRelative = `参考资料/官方中文/${heroId}.json`;
  const officialEnRelative = `参考资料/官方英文/${heroId}.json`;
  const raw = rawSourceFacts(heroId, slot);
  const currentBoundText = skill.currentTexts;
  const sourceFacts = {
    dataValues: raw.dataValues,
    calculations: raw.calculations,
    rawFields: {
      spellCastTime: raw.spellCastTime,
      mCastTime: raw.mCastTime,
      cooldownTime: raw.cooldownTime,
      mDoesNotConsumeCooldown: raw.mDoesNotConsumeCooldown,
      mCooldownNotAffectedByCDR: raw.mCooldownNotAffectedByCDR,
    },
    currentTextPath: `来源绑定与当前文本.json -> ${heroId}/${slot}/currentTexts`,
  };
  const bindingMeta = {
    hero: heroId,
    heroName: hero.name,
    heroKey: hero.key,
    resourceType: sourceMeta.resourceType,
    rootPath: hero.rootPath,
    spellPath: skill.binding,
    bindingAvailable: true,
    clientFile: clientRelative,
    clientSha256: sourceMeta.client.sha256,
    clientCompressedSha256: sha256File(clientRelative),
    clientBuild: sourceMeta.client.contentVersion || clientBuild,
    officialZhFile: officialZhRelative,
    officialZhSha256: sha256File(officialZhRelative),
    officialEnFile: officialEnRelative,
    officialEnSha256: sha256File(officialEnRelative),
  };
  return {
    hero: heroId,
    heroName: hero.name,
    heroKey: hero.key,
    slot,
    resourceType: sourceMeta.resourceType,
    rootPath: hero.rootPath,
    spellPath: skill.binding,
    bindingAvailable: true,
    clientFile: clientRelative,
    clientSha256: sourceMeta.client.sha256,
    clientCompressedSha256: sha256File(clientRelative),
    clientBuild: sourceMeta.client.contentVersion || clientBuild,
    officialZhFile: officialZhRelative,
    officialZhSha256: sha256File(officialZhRelative),
    officialEnFile: officialEnRelative,
    officialEnSha256: sha256File(officialEnRelative),
    currentBoundText,
    raw: {
      dataValues: raw.dataValues,
      calculations: raw.calculations,
      spellCastTime: raw.spellCastTime,
      mCastTime: raw.mCastTime,
      cooldownTime: raw.cooldownTime,
      mDoesNotConsumeCooldown: raw.mDoesNotConsumeCooldown,
      mCooldownNotAffectedByCDR: raw.mCooldownNotAffectedByCDR,
    },
    officialEvidence: officialEvidenceFor(heroId, slot),
    bindingMeta,
    sourceFacts,
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
const targetHPTotal = attr('TARGET', 'hp', 'TOTAL');

const normalShieldEffect = (effectKey, name, durationParameterKey, valueKey, description, sortOrder, valueKind = 'FORMULA') => ({
  effectKey,
  name,
  description,
  sortOrder,
  lifecycle: {
    durationValue: { kind: 'PARAMETER', parameterKey: durationParameterKey },
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
    name,
    resultType: 'NORMAL_SHIELD',
    target: 'SOURCE',
    description: null,
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
        value: valueKind === 'PARAMETER' ? { kind: 'PARAMETER', parameterKey: valueKey } : { kind: 'FORMULA', formulaKey: valueKey },
      fixedMultiplier: 1,
      fixedMinValue: 0,
      fixedMaxValue: null,
    },
    detail: { absorbedDamageTypeKey: null, decayMode: 'NONE' },
  }],
});

const baseCritParameters = (prefix) => [
  fixed('crit_chance_multiplier', '暴击几率提升比例', 'DECIMAL', 1, '当前正文显示CritChanceMultiplier*100%，即在其它暴击几率修正后把应用前实际暴击几率再增加100%；比例1代表100%。', 10),
  fixed('crit_damage_modifier_ratio', '暴击伤害调节比例', 'DECIMAL', 0.95, '客户端CritDamageMod约0.95；这是减伤/保留来源参数，当前暴击实际倍率由CurrentCritDamage读取，不能把0.95当完整暴击倍率。', 20),
  fixed('crit_to_bonus_ad_per_ratio', '超额暴击转额外攻击力系数', 'DECIMAL', 50, '客户端YasuoCritToAD或YoneCritToAD=50，正文按每1%超出部分乘0.01；这里保留每1比例单位的额外攻击力系数。', 30),
  runtime('crit_chance_before_self_modifier_ratio', '自身提升前实际暴击几率', 'DECIMAL', '正文扩展说明自身暴击提升在其它暴击几率修正之后计算；具体实际选择器阶段由运行输入提供，不设默认。', 40),
  fixed('crit_chance_cap_ratio', '暴击几率封顶比例', 'DECIMAL', 1, '正文以100%为超额转换起点；比例1代表100%。', 50),
  fixed('zero_ratio', '零比例边界', 'DECIMAL', 0, '为超额转换的MAX下界提供显式二元叶子；不是运行输入，也不改变来源机制。', 60),
];

const critAfter = () => add(P('crit_chance_before_self_modifier_ratio'), mul(P('crit_chance_before_self_modifier_ratio'), P('crit_chance_multiplier')));
const critOvercap = () => mul(
  max(sub(critAfter(), P('crit_chance_cap_ratio')), P('zero_ratio')),
  P('crit_to_bonus_ad_per_ratio'),
);
const qNormal = (baseKey, ratioKey) => add(P(baseKey), mul(P(ratioKey), sourceADTotal));
const qCrit = (baseKey, ratioKey) => add(
  P(baseKey),
  mul(mul(P(ratioKey), sourceADTotal), P('actual_critical_damage_ratio')),
);
const yasuoEBase = () => add(
  add(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus)),
  mul(P('ability_power_ratio'), sourceAPTotal),
);
const yasuoEStacked = () => add(
  yasuoEBase(),
  mul(yasuoEBase(), mul(min(P('current_stack_count'), P('max_stacks')), P('bonus_damage_per_stack_ratio'))),
);
const yoneWBase = () => add(P('base_damage'), mul(P('target_max_health_ratio'), targetHPTotal));
const yoneWShield = () => add(P('shield_level_base_value'), mul(P('shield_bonus_attack_damage_ratio'), sourceADBonus));
const yoneWFirstShield = () => add(yoneWShield(), mul(yoneWShield(), P('first_champion_shield_increase_ratio')));
const yoneRBase = () => add(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus));

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

put('yasuo_p', [
  ...baseCritParameters('yasuo'),
  runtime('shield_value', '实际等级护盾值', 'DECIMAL', '客户端ShieldValue为125至600且带mScaleByStatProgressionMultiplier=true；没有可证的18级中间表，使用实际等级护盾值，无默认。', 70),
  fixed('shield_duration_ms', '护盾持续时间（毫秒）', 'INTEGER', 2000, '同版官方英文data.Yasuo.enemytips[3]明确护盾持续2秒，转换为2000毫秒；触发条件和施放时点待接。', 80),
], [
  formula('crit_chance_after_self_modifier_ratio', '自身提升后暴击几率', critAfter(), '先读取其它暴击修正后的实际暴击几率，再增加同值100%；不重复乘已经含自身提升的最终值。', 10),
  formula('crit_overcap_bonus_attack_damage', '超额暴击转额外攻击力', critOvercap(), 'MAX(自身提升后暴击几率-1,0)×50；仅计算超过100%的比例部分。', 20),
], [normalShieldEffect(
  'self_shield',
  '亚索自身护盾',
  'shield_duration_ms',
  'shield_value',
  '只定义已证的自身护盾数值与2000毫秒生命周期；移动积攒、满剑意以及受到英雄或野怪伤害时的触发条件待接，不创建自动触发。',
  10,
  'PARAMETER',
)], [
  { item: '匿名{74ce5438}等级断点计算', reason: '当前正文没有消费该匿名55起及7/13/19/25级断点对象，未知求值不写。' },
  { item: '被动spellCastTime=0.25秒', reason: '被动来源字段不证明存在主动施法过程，本轮只保留机制参数和护盾效果。' },
], [
  { item: '移动积攒剑意、满槽和受英雄或野怪伤害触发护盾', reason: '正文已明确，但触发条件、层数时间和接线时点未进入本轮组成。' },
  { item: 'CritDamageMod与CurrentCritDamage的应用阶段', reason: '减伤参数已作为来源参数保留；实际暴击倍率选择器阶段无窄证。' },
], '暴击翻倍、超额转换、护盾持续时间分别取当前中文正文、客户端DataValues/计算树和同版官方英文补充。'),

put('yasuo_q', [
  levels('base_damage', '基础物理伤害', 'INTEGER', [20, 45, 70, 95, 120], '客户端BaseDamage等级1至5为20/45/70/95/120；正文Damage树消费该基础值。', 10),
  fixed('total_attack_damage_ratio', '总攻击力比例', 'DECIMAL', 1.05, '客户端ADRatio约1.05；当前Damage树使用来源总攻击力，比例1代表100%。', 20),
  runtime('actual_critical_damage_ratio', '实际暴击伤害倍率', 'DECIMAL', '暴击计算树的mStat9选择器和应用阶段未形成窄证；暴击倍率无默认，直接由实际输入提供。', 30),
  fixed('stack_duration_ms', '旋风烈斩层数持续时间（毫秒）', 'INTEGER', 6000, '客户端GatheringStormDuration=6秒，当前中文正文显示层数持续时间，转换为6000毫秒。', 40),
  fixed('stack_threshold', '旋风烈斩触发层数', 'INTEGER', 2, '当前正文明确积攒2层后下一次形成旋风；次数为整数。', 50),
  fixed('knockup_duration_ms', '击飞持续时间（毫秒）', 'INTEGER', 1000, '客户端KnockUpDurationTOOLTIPONLY=1秒且官方文字用于击飞持续，转换为1000毫秒。', 60),
  fixed('cast_time_ms', '基础施法时间（毫秒）', 'INTEGER', 125, '客户端spellCastTime=0.125秒；正文还说明攻击速度会缩短施法时间，因此该值只代表基础字段，不代表所有攻击速度下最终时长。', 70),
], [
  formula('physical_damage', '斩钢闪单一敌方物理伤害', qNormal('base_damage', 'total_attack_damage_ratio'), '当前TotalDamage树=基础伤害+1.05×来源总攻击力；唯一敌人范围保留，结果事件待接。', 10),
  formula('critical_physical_damage', '斩钢闪暴击物理伤害', qCrit('base_damage', 'total_attack_damage_ratio'), '当前TotalDamageCrit树=基础伤害+总攻击力×(1.05×实际暴击伤害倍率)；暴击倍率只作用于攻击力项，不乘基础值。', 20),
], [], [
  { item: 'StabRange/TornadoRange/StabWidth/SpinWidth等几何字段', reason: '只影响范围或展示，本轮单一敌人伤害不需要建立几何公式。' },
  { item: '客户端Cooldown与已有公共cooldown_ms', reason: '公共冷却已在快照中复用，不新增或更新。' },
  { item: '攻击速度缩短冷却和施法时间的完整求值', reason: '正文只给出关系，未给出可审的完整执行式，保留基础字段并待接。' },
], [
  { item: '2层后下一次旋风、首个命中目标攻击特效及E中Q圆形分支', reason: '资格和顺序待事件层接线；同一伤害不重复计为多目标。' },
], '普通与暴击树均沿客户端当前计算树，暴击倍率只包住AD项。'),

put('yasuo_w', [
  fixed('wall_duration_ms', '风墙持续时间（毫秒）', 'INTEGER', 4000, '同版官方英文当前技能文字明确阻挡敌方飞行道具4秒，转换为4000毫秒；不是普通护盾或全伤害免疫。', 10),
], [], [], [
  { item: 'WallLife/Width/TravelRange/BubbleRadius/Thickness等几何字段', reason: '本轮只保留已证持续时间，几何碰撞未形成可复用计算。' },
  { item: 'spellCastTime=0与mCastTime约13毫秒', reason: '两个来源字段冲突，不能任选固定施法时长。' },
], [
  { item: '飞行道具类型、碰撞和资格', reason: '正文明确塔弹和光束不能阻挡，具体对象枚举与接线仍待补。' },
], '官方英文同版描述补齐4000毫秒；当前候选不把风墙伪装成普通护盾。'),

put('yasuo_e', [
  fixed('cast_time_ms', '施法时间（毫秒）', 'INTEGER', 250, '客户端spellCastTime=0.25秒，转换为250毫秒；不表示命中和层数事件已接线。', 10),
  levels('base_damage', '基础魔法伤害', 'INTEGER', [70, 85, 100, 115, 130], '客户端BaseDamage等级1至5为70/85/100/115/130。', 20),
  fixed('bonus_attack_damage_ratio', '额外攻击力比例', 'DECIMAL', 0.2, '客户端ADRatio约0.2；当前TotalDamage树使用来源额外攻击力，比例1代表100%。', 30),
  fixed('ability_power_ratio', '法术强度比例', 'DECIMAL', 0.6, '客户端APRatio约0.6；当前TotalDamage树使用来源总法术强度，比例1代表100%。', 40),
  fixed('max_stacks', '最大叠层数', 'INTEGER', 4, '客户端MaxStacks=4，当前正文明确最多叠加4次；次数为整数。', 50),
  fixed('stack_duration_ms', '伤害层数持续时间（毫秒）', 'INTEGER', 5000, '客户端StackDuration=5秒，转换为5000毫秒。', 60),
  levels('per_target_cooldown_ms', '单目标锁定冷却（毫秒）', 'INTEGER', [10000, 9000, 8000, 7000, 6000], '客户端PerTargetCooldown索引1至5为10/9/8/7/6秒，转换为10000/9000/8000/7000/6000毫秒；与公共技能冷却分开。', 70),
  runtime('current_stack_count', '本次计算已有层数', 'INTEGER', '已有层数由运行输入提供，必须是0至4的非负整数；本次新命中不自动加入，也不设默认。', 80),
  fixed('bonus_damage_per_stack_ratio', '每层追加完整伤害比例', 'DECIMAL', 0.25, '客户端BonusDamagePerStack为完整TotalDamage×0.25；当前公式按完整基数乘(1+层数×0.25)，比例1代表100%。', 90),
], [
  formula('magic_damage', '踏前斩基础单一敌方魔法伤害', yasuoEBase(), '当前TotalDamage树=基础值+0.2×来源额外攻击力+0.6×来源总法术强度。', 10),
  formula('stacked_magic_damage', '踏前斩叠层后单一敌方魔法伤害', yasuoEStacked(), 'BonusDamagePerStack作用于完整TotalDamage；最终为完整基数×(1+MIN(已有层数,4)×0.25)，不把本次新层提前计入。', 20),
], [], [
  { item: 'BaseDashSpeed与位移几何', reason: '只描述位移速度或空间过程，本轮没有成熟的位移结果组成。' },
  { item: '公共cooldown_ms', reason: '已有公共参数复用；客户端mDoesNotConsumeCooldown不证明公共冷却真实起算。' },
], [
  { item: 'Q联动、每目标锁定、层数先后和命中事件', reason: '数值与资格已保存，事件时序待接。' },
], 'E同时保留无层基础式与封顶叠层式，层数是无默认整数输入。'),

put('yasuo_r', [
  fixed('cast_time_ms', '施法时间（毫秒）', 'INTEGER', 250, '客户端spellCastTime=0.25秒，转换为250毫秒。', 10),
  levels('base_damage', '基础物理伤害', 'INTEGER', [200, 350, 500], '客户端R计算使用RBaseDamage等级1至3的200/350/500。', 20),
  fixed('bonus_attack_damage_ratio', '额外攻击力比例', 'DECIMAL', 1.5, '客户端Damage树使用1.5×来源额外攻击力，比例1代表100%。', 30),
  fixed('bonus_armor_penetration_ratio', '额外护甲穿透比例', 'DECIMAL', 0.6, '客户端RPercentArmorPen=60，正文限定暴击无视60%额外护甲；转换为0.6，不能泛化为所有伤害的总护甲穿透。', 40),
  fixed('armor_penetration_duration_ms', '额外护甲穿透持续时间（毫秒）', 'INTEGER', 15000, '客户端RBuffDuration=15秒，转换为15000毫秒。', 50),
  fixed('knockup_duration_ms', '浮空维持时间（毫秒）', 'INTEGER', 1000, '客户端RKnockupDuration=1秒，转换为1000毫秒；唯一目标控制条件仍待事件接线。', 60),
], [formula('physical_damage', '狂风绝息斩单一敌方物理伤害', add(P('base_damage'), mul(P('bonus_attack_damage_ratio'), sourceADBonus)), '当前Damage树=基础值+1.5×来源额外攻击力；只保留满足浮空资格的唯一敌人伤害。', 10)], [], [
  { item: 'RRadius/RCastSearchRadius与额外敌人分配', reason: '几何和额外目标不进入本轮单一敌人公式。' },
], [
  { item: '浮空资格、满剑意、清空Q层数和暴击额外护甲阶段', reason: '正文条件明确，触发和状态接线待后续运行层。' },
], 'R伤害和暴击额外护甲期间分开保存；额外敌方目标分配不录。'),

put('yone_p', [
  fixed('magic_damage_split_ratio', '第二次攻击魔法伤害比例', 'DECIMAL', 0.5, '客户端MagicDamageSplit=0.5，正文明确每第二次攻击有50%攻击伤害为魔法伤害；比例1代表100%。', 10),
  fixed('physical_damage_split_ratio', '第二次攻击物理伤害比例', 'DECIMAL', 0.5, '正文明确剩余50%攻击伤害仍为物理；与魔法分量合计一个完整攻击基数。', 20),
  fixed('crit_chance_multiplier', '暴击几率提升比例', 'DECIMAL', 1, '当前正文显示CritChanceMultiplier*100%，在其它暴击修正后提升100%；比例1代表100%。', 30),
  fixed('crit_damage_modifier_ratio', '暴击伤害调节比例', 'DECIMAL', 0.95, '客户端CritDamageMod约0.95；实际暴击倍率由CurrentCritDamage读取，本值不作为完整倍率。', 40),
  fixed('crit_to_bonus_ad_per_ratio', '超额暴击转额外攻击力系数', 'DECIMAL', 50, '客户端YoneCritToAD=50，正文按每1%超出部分乘0.01。', 50),
  runtime('crit_chance_before_self_modifier_ratio', '自身提升前实际暴击几率', 'DECIMAL', '正文扩展说明自身暴击提升在其它修正之后计算；实际阶段无默认输入。', 60),
  fixed('crit_chance_cap_ratio', '暴击几率封顶比例', 'DECIMAL', 1, '正文以100%为超额转换起点；比例1代表100%。', 70),
  fixed('zero_ratio', '零比例边界', 'DECIMAL', 0, '为超额转换的MAX下界提供显式二元叶子。', 80),
], [
  formula('second_attack_physical_damage', '第二次攻击物理伤害分量', mul(sourceADTotal, P('physical_damage_split_ratio')), '每第二次攻击只把同一个实际攻击基数拆分为物理分量，不再叠加一笔完整物理攻击；攻击特效是否纳入待接。', 10),
  formula('second_attack_magic_damage', '第二次攻击魔法伤害分量', mul(sourceADTotal, P('magic_damage_split_ratio')), '每第二次攻击把同一个实际攻击基数拆分为魔法分量；与物理分量合计完整攻击伤害。', 20),
  formula('crit_chance_after_self_modifier_ratio', '自身提升后暴击几率', critAfter(), '先读取其它暴击修正后的实际暴击几率，再增加同值100%；不重复乘已经含自身提升的最终值。', 30),
  formula('crit_overcap_bonus_attack_damage', '超额暴击转额外攻击力', critOvercap(), 'MAX(自身提升后暴击几率-1,0)×50；仅计算超过100%的比例部分。', 40),
], [], [
  { item: '被动spellCastTime=0.25秒', reason: '被动字段不证明独立主动施法过程。' },
  { item: '暴击和攻击特效的全部拆分资格', reason: '当前正文只明确攻击伤害分拆，未自动把所有攻击特效分半。' },
], [
  { item: '攻击交替状态与第二次攻击触发', reason: '同一角色的交替状态保留为待接事件，不创建两个角色或召唤物。' },
  { item: 'CritDamageMod与CurrentCritDamage应用阶段', reason: '来源参数已保留，实际选择器阶段待窄证。' },
], '永恩被动用同一攻击基数拆出物理和魔法分量，避免在完整物理攻击上重复追加魔法伤害。'),

put('yone_q', [
  levels('base_damage', '基础物理伤害', 'INTEGER', [25, 50, 75, 100, 125], '客户端BaseDamage等级1至5为25/50/75/100/125。', 10),
  fixed('total_attack_damage_ratio', '总攻击力比例', 'DECIMAL', 1.1, '客户端ADRatio约1.1；当前QDamage树使用来源总攻击力，比例1代表100%。', 20),
  runtime('actual_critical_damage_ratio', '实际暴击伤害倍率', 'DECIMAL', 'TotalDamageCrit树的mStat9选择器和阶段未形成窄证；无默认输入。', 30),
  fixed('stack_duration_ms', '旋风烈斩层数持续时间（毫秒）', 'INTEGER', 6000, '客户端BuffDuration=6秒，转换为6000毫秒。', 40),
  fixed('stack_threshold', '旋风烈斩触发层数', 'INTEGER', 2, '当前正文明确积攒2层后第三次带旋风；次数为整数。', 50),
  fixed('knockup_duration_ms', '击飞持续时间（毫秒）', 'INTEGER', 750, '客户端Q3KnockupDuration=0.75秒，转换为750毫秒。', 60),
  fixed('cast_time_ms', '基础施法时间（毫秒）', 'INTEGER', 350, '客户端spellCastTime和mCastTime约0.35秒，转换为350毫秒；正文明确攻击速度会缩短施法时间。', 70),
], [
  formula('physical_damage', '错玉切单一敌方物理伤害', qNormal('base_damage', 'total_attack_damage_ratio'), '当前QDamage树=基础伤害+1.1×来源总攻击力；第三次旋风同一伤害不重复计算。', 10),
  formula('critical_physical_damage', '错玉切暴击物理伤害', qCrit('base_damage', 'total_attack_damage_ratio'), '当前TotalDamageCrit树=基础伤害+总攻击力×(1.1×实际暴击伤害倍率)，固定基础值不乘暴击倍率。', 20),
], [], [
  { item: 'Width/Q3DashSpeed/Q3AoESize等几何和位移字段', reason: '本轮只保留单一敌人伤害与击飞时长，空间过程不建无消费者公式。' },
  { item: 'QAttackSpeedCDPercent/QAttackSpeedCastReduction及其端点', reason: '只证明系数和上限，缺执行关系不造完整攻速公式。' },
  { item: '已有公共cooldown_ms与mCooldownNotAffectedByCDR', reason: '公共参数复用；不能用普通急速公式覆盖该技能冷却。' },
], [
  { item: '两层、第三次旋风、位移和首个命中攻击特效', reason: '事件顺序待接；同次不重复计伤害。' },
], '普通与暴击公式按客户端树拆分，击飞和层数只保存已证整数时长与门槛。'),

put('yone_w', [
  levels('base_damage', '基础伤害基数', 'INTEGER', [10, 20, 30, 40, 50], '客户端BaseDamage索引1至5为10/20/30/40/50；两种伤害共同使用一个基数。', 10),
  levels('target_max_health_ratio', '目标最大生命比例', 'DECIMAL', [0.08, 0.09, 0.1, 0.11, 0.12], '客户端MaxHealthDamage索引1至5为8%/9%/10%/11%/12%；当前中文正文显示各类型均为基数和目标最大生命值比例的一半。', 20),
  fixed('damage_split_ratio', '伤害分拆比例', 'DECIMAL', 0.5, '当前正文和官方英文均明确物理、魔法各为同一个完整基数的一半；比例1代表100%。', 30),
  runtime('shield_level_base_value', '实际等级护盾基础值', 'DECIMAL', '客户端WShield的ByCharLevelInterpolation为40至90，未给可证18级中间表；使用实际等级基础值，无默认。', 40),
  fixed('shield_bonus_attack_damage_ratio', '护盾额外攻击力比例', 'DECIMAL', 0.65, '客户端ShieldbADRatio约0.65，WShield树为实际等级基础值+0.65×来源额外攻击力。', 50),
  fixed('first_champion_shield_increase_ratio', '首个敌方英雄护盾提升比例', 'DECIMAL', 1, '客户端FirstChampShieldMultiplier=1，官方扩展正文显示首个敌方英雄使护盾提升100%；比例1代表100%。', 60),
  fixed('shield_duration_ms', '护盾持续时间（毫秒）', 'INTEGER', 1500, '客户端ShieldDuration=1.5秒，转换为1500毫秒。', 70),
  fixed('cast_time_ms', '基础施法时间（毫秒）', 'INTEGER', 500, '客户端mCastTime=0.5秒且与WBaseCastTime一致，转换为500毫秒；攻击速度缩短关系待接。', 80),
], [
  formula('physical_damage', '凛神斩单一敌方物理伤害', mul(yoneWBase(), P('damage_split_ratio')), '物理分量=0.5×(基础值+目标最大生命值比例×目标最大生命)；不是完整基数。', 10),
  formula('magic_damage', '凛神斩单一敌方魔法伤害', mul(yoneWBase(), P('damage_split_ratio')), '魔法分量与物理分量各占同一个完整基数的一半；两者合计一个完整基数。', 20),
  formula('shield_value', '凛神斩完整护盾值', yoneWShield(), 'WShield树=实际等级护盾基础值+0.65×来源额外攻击力；命中单位才进入自身护盾效果。', 30),
  formula('first_champion_shield_value', '命中首个敌方英雄的完整护盾值', yoneWFirstShield(), '首个敌方英雄使完整护盾额外提升100%，即完整护盾×2；不把提升只施加在基础值上。', 40),
], [normalShieldEffect(
  'first_champion_self_shield',
  '永恩命中首个敌方英雄后的自身护盾',
  'shield_duration_ms',
  'first_champion_shield_value',
  '只定义唯一敌人场景下首个敌方英雄护盾的数值与1500毫秒生命周期；命中、护盾应用和后续英雄额外目标分配待接。',
  10,
)], [
  { item: 'WDamage及匿名{8dfeb810}计算树', reason: '当前正文未消费其中的总攻击力/匿名系数，不能混入当前两种伤害。' },
  { item: 'MinionMod、MinimumDamageMinions与MonsterDamageCap', reason: '小兵最低伤害和野怪上限是兵野专用支路，本轮单一敌方英雄范围排除。' },
  { item: 'BaseShield与SecondChampShieldMultiplier', reason: 'BaseShield不是当前WShield实际等级基础值；后续英雄额外50%属于额外目标分配。' },
  { item: 'BaseHealing、HealthStealMultiplier与WCritMultiplier', reason: '当前技能正文没有对应可写的单一敌人效果或当前伤害树消费者。' },
  { item: '攻击速度缩短冷却/施法的完整求值', reason: '当前只保存基础施法字段和已复用公共冷却，不猜执行曲线。' },
], [
  { item: '命中单位后获得护盾的事件', reason: '自身护盾效果已定义，施放/命中时序待接；未命中不默认产生护盾。' },
  { item: '锥形范围与额外敌人护盾分配', reason: '本轮保留唯一敌人，额外英雄每人50%不录。' },
], 'W物理和魔法各取一个完整基数的一半；护盾先算完整值，再对首个英雄整体翻倍。'),

put('yone_e', [
  fixed('return_duration_ms', '灵体窗口时间（毫秒）', 'INTEGER', 5000, '客户端ReturnTimer=5秒，转换为5000毫秒。', 10),
  fixed('movement_speed_start_ratio', '灵体初始移速加成比例', 'DECIMAL', 0.1, '客户端StartingMS=0.1，当前正文显示移速从10%开始逐渐提升；比例1代表100%。', 20),
  fixed('movement_speed_end_ratio', '灵体最高移速加成比例', 'DECIMAL', 0.3, '客户端MovementSpeed=0.3，当前正文显示最高30%；不把逐渐提升伪装成全程固定效果。', 30),
  levels('return_damage_ratio', '返回追加伤害比例', 'DECIMAL', [0.25, 0.275, 0.3, 0.325, 0.35], '客户端DeathmarkPercent索引1至5为25%/27.5%/30%/32.5%/35%，与同版官方英文正文一致；比例1代表100%。', 40),
  runtime('return_damage_stored', '灵体期间对英雄实际造成的攻击与技能伤害', 'DECIMAL', '同版官方英文Yone.spells[2].tooltip明确只统计灵体期间对英雄造成的攻击与技能伤害；伤害存储阶段和附带效果资格无默认。', 50),
  fixed('recast_lockout_ms', '重施锁定时间（毫秒）', 'INTEGER', 500, '客户端RecastLockout=0.5秒，转换为500毫秒；硬控延迟返回待接。', 60),
], [formula('return_additional_damage', '破障之锋返回追加伤害量', mul(P('return_damage_ratio'), P('return_damage_stored')), '返回追加伤害=官方限定范围内实际储存的攻击与技能伤害×技能等级比例；伤害类型正文未指定，不标注物理或真实。', 10)], [], [
  { item: 'DeathmarkBase与匿名{df232269}树', reason: '当前正文消费的是对英雄实际造成伤害的存量，不是匿名基础加总AD树。' },
  { item: 'MissingHealthPercent', reason: '虽然数组相同，但当前正文没有把缺失生命作为返回伤害基数。' },
  { item: '灵体位移几何、完整移速过程和自动返回效果', reason: '本轮只记录窗口、起末比例、重施锁定和追加伤害公式，不造自动状态过程。' },
], [
  { item: '硬控期间无法返回、自动到期和重施时序', reason: '官方文本已明确条件，事件和状态接线待后续运行层。' },
], 'E返回比例按同版官方英文限定为对英雄的攻击与技能实际伤害，不泛化为全部伤害或缺失生命。'),

put('yone_r', [
  levels('base_damage', '完整伤害基数', 'INTEGER', [200, 400, 600], '客户端Damage树BaseDamage索引1至3为200/400/600；TooltipDamage再取一半。', 10),
  fixed('bonus_attack_damage_ratio', '额外攻击力比例', 'DECIMAL', 0.8, '客户端ADRatio约0.8，完整Damage树使用来源额外攻击力。', 20),
  fixed('damage_split_ratio', '物理魔法分拆比例', 'DECIMAL', 0.5, '客户端TooltipDamage为完整Damage×0.5，当前正文同时显示物理与魔法各半。', 30),
  fixed('knockup_duration_ms', '击飞持续时间（毫秒）', 'INTEGER', 750, '客户端RKnockupDuration=0.75秒，转换为750毫秒；当前正文未显示具体持续数值，作为来源参数待接，不自动创建控制结果。', 40),
], [
  formula('physical_damage', '封尘绝念斩单一敌方物理伤害', mul(yoneRBase(), P('damage_split_ratio')), '物理伤害=完整Damage的一半，即100/200/300+0.4×来源额外攻击力；唯一敌人保留。', 10),
  formula('magic_damage', '封尘绝念斩单一敌方魔法伤害', mul(yoneRBase(), P('damage_split_ratio')), '魔法伤害与物理伤害各为完整Damage的一半，不把两种都写成完整值。', 20),
], [], [
  { item: 'BlinkDistanceBehindTarget/Width/最大距离闪烁几何', reason: '空间与未命中位移分支不改变当前单一敌人伤害公式。' },
  { item: 'spellCastTime=125毫秒与mCastTime=750毫秒', reason: '两个来源字段冲突，不任选固定施法时间。' },
], [
  { item: '击飞/拉向和唯一敌人命中事件', reason: '唯一敌人资格保留，控制与命中时序待接；RKnockupDuration只作来源参数。' },
], 'R按TooltipDamage的一半分别建立物理和魔法公式，严格避免双倍完整伤害。');

const order = ['yasuo_p', 'yasuo_q', 'yasuo_w', 'yasuo_e', 'yasuo_r', 'yone_p', 'yone_q', 'yone_w', 'yone_e', 'yone_r'];
const sourceBySkill = Object.fromEntries(order.map((skillKey) => {
  const heroId = skillKey.startsWith('yasuo_') ? 'Yasuo' : 'Yone';
  const slot = skillKey.slice(-1).toUpperCase();
  return [skillKey, sourceFor(heroId, slot)];
}));
const currentSummary = snapshot.summary;
const skillObjects = Object.fromEntries(order.map((skillKey) => {
  const current = currentSummary[skillKey];
  const source = sourceBySkill[skillKey];
  const subject = current.subject;
  return [skillKey, {
    skillKey,
    name: subject.name,
    maxLevel: subject.maxLevel,
    source,
    write: writes[skillKey],
    protectedExisting: {
      subject: current.subject,
      components: current.components,
      publicOnly: current.publicOnly,
      source: '输入包/参考资料/当前10槽保护快照.json',
    },
    excluded: excluded[skillKey],
    pending: pending[skillKey],
    proofs: [{
      binding: source.bindingMeta,
      currentBoundText: source.currentBoundText,
      sourceFacts: source.sourceFacts,
      officialEvidence: source.officialEvidence,
      sourceNote: `固定客户端16.17、官方16.17.1；根绑定 ${source.rootPath} -> ${source.spellPath}。`,
    }],
    proofNote: proofNotes[skillKey],
  }];
}));

const allCounts = { parameters: 0, formulas: 0, effects: 0, processes: 0, internalStates: 0, triggerRules: 0 };
for (const skillKey of order) {
  for (const kind of Object.keys(allCounts)) allCounts[kind] += skillObjects[skillKey].write[kind].length;
}
const requestCount = Object.values(allCounts).reduce((sum, count) => sum + count, 0);
const reuseEntries = Array.isArray(reuseList) ? reuseList : (reuseList.parameters || reuseList.reusedParameters || []);
const reusedPublicParameters = reuseEntries.map((item) => ({
  skillKey: item.skillKey,
  parameterKey: item.parameterKey,
  source: '输入包/参考资料/公共参数复用清单.json',
  post: false,
}));
const reusedExistingParameters = reusedPublicParameters.map(({ skillKey, parameterKey, post }) => ({ skillKey, parameterKey, post }));

const protectedSubjects = order.map((skillKey) => ({
  skillKey,
  subject: currentSummary[skillKey].subject,
  source: '输入包/参考资料/当前10槽保护快照.json',
}));
const protectedCompositionLists = Object.fromEntries(order.map((skillKey) => [skillKey, currentSummary[skillKey].components]));
const protectedRoutes = snapshot.requests.map((request) => request.route);
const protectedObjects = {
  subjects: protectedSubjects,
  currentCompositionLists: protectedCompositionLists,
  reusedPublicParameters: reusedPublicParameters.map((item) => ({
    skillKey: item.skillKey,
    parameterKey: item.parameterKey,
    current: currentSummary[item.skillKey].components.parameters.find((parameter) => parameter.parameterKey === item.parameterKey) || null,
    source: '输入包/参考资料/当前10槽保护快照.json',
  })),
  protectedReferenceRoutes: protectedRoutes,
  protectedReferenceCounts: {
    GETs: snapshot.GETs,
    subjects: protectedSubjects.length,
    currentCompositionSkillSlots: order.length,
    currentCompositionLists: order.length * 6,
    reusedPublicParameters: reusedPublicParameters.length,
    images: order.length,
    characters: 2,
    characterSkillRelations: 2,
  },
  scope: '完整保留输入快照中的主体、六类组成、8项已有公共冷却参数、属性/分类/乘区/伤害类型字典、2个角色、2组角色关系和10张代表图；新增请求只能POST候选组成，不能更新、删除或覆盖。',
  snapshotFile: '输入包/参考资料/当前10槽保护快照.json',
  snapshotSha256: currentSnapshotSha256,
};

const meta = {
  generatedAt: GENERATED_AT,
  batch: BATCH,
  status: '候选已生成，等待主负责人审查；未调用业务接口',
  gameId: 'lol',
  apiBase: API_BASE,
  sourceVersion,
  scope: '亚索、永恩10个技能槽；只新增来源明确参数、实际二元公式和成熟自身护盾效果。已有主体、六类组成、公共冷却、角色关系、代表图和字典全部保护；不写业务接口，不创建自动触发、伤害结果、直接治疗、瞬时求值或周期过程。',
  sourcePolicy: '固定客户端16.17、官方16.17.1和构建16.17.8104348；沿当前根绑定正文和当前计算树；未知等级曲线、暴击阶段、施法时序、事件资格和运行输入不猜、不设默认。',
  inputPackage: '输入包/',
  currentSnapshot: '输入包/参考资料/当前10槽保护快照.json',
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
  counts: allCounts,
  apiWrites: 0,
  sourceFiles: sourceManifestFiles,
  sourceNotes: {
    yasuo: '亚索P/Q/E/R按当前树保留暴击阶段、唯一敌人、完整基数叠层和额外护甲来源；W只保留4000毫秒飞行道具阻挡时长。',
    yone: '永恩P拆同一攻击基数的物理/魔法分量；Q只放大AD项；W两类伤害各半且首个敌方英雄护盾整体翻倍；E只累计对英雄攻击与技能实际伤害；R两类伤害各半。',
    ratios: '所有比例字段按1代表100%保存；百分数文本只在来源说明中转换一次。',
    runtimeInputs: '当前暴击倍率、等级护盾基础值、已有层数和永恩E实际伤害存量均无默认。',
  },
  protectedObjects,
  revision: 'hero30-source-v1-candidate',
};
writeJson('完整候选.json', candidate);

const requestKinds = ['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'];
const requests = [];
let sequence = 0;
for (const skillKey of order) {
  for (const kind of requestKinds) {
    for (const body of skillObjects[skillKey].write[kind]) {
      sequence += 1;
      const stableKey = body.parameterKey || body.formulaKey || body.effectKey;
      requests.push({
        sequence,
        method: 'POST',
        route: `/skills/${skillKey}/${kind}`,
        detailRoute: `/skills/${skillKey}/${kind}/${stableKey}`,
        skillKey,
        kind,
        stableKey,
        status: '仅意图，未调用',
        body,
      });
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
  requestCounts: allCounts,
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
  inputIntegrity,
  selectedValues: Object.fromEntries(order.map((skillKey) => [skillKey, {
    source: sourceBySkill[skillKey].spellPath,
    dataValues: sourceBySkill[skillKey].raw.dataValues,
    calculations: sourceBySkill[skillKey].raw.calculations,
    officialEvidence: sourceBySkill[skillKey].officialEvidence,
    candidateParameters: skillObjects[skillKey].write.parameters.map((p) => ({
      parameterKey: p.parameterKey,
      valueType: p.valueType,
      valueMode: p.valueMode,
      fixedValue: p.fixedValue,
      levelValues: p.levelValues,
    })),
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

const countsWithProtection = {
  ...allCounts,
  requestCount,
  reusedPublicParameters: reusedPublicParameters.length,
  protectedSubjects: protectedSubjects.length,
  protectedCompositionLists: order.length * 6,
  protectedReferenceGETs: snapshot.GETs,
};
const included = [
  '亚索：P暴击几率翻倍与超额转换、P同版官方护盾持续时间、Q普通/暴击物理伤害、W飞行道具阻挡时长、E完整基数叠层魔法伤害、R唯一浮空敌人伤害与额外护甲来源参数。',
  '永恩：P同一攻击基数的物理/魔法拆分与暴击转换、Q普通/暴击物理伤害、W两类半基数伤害和首个敌方英雄完整护盾、E限定对英雄攻击与技能实际伤害的返回比例、R两类半基数伤害。',
  '比例按1代表100%，毫秒和次数使用整数；所有真实运行输入不设默认，所有未证曲线和事件保持待接。',
];
const excludedSummary = [
  '额外目标分配、纯几何/展示换算、独立召唤或完整变形假设、自动触发、伤害/直接治疗结果、瞬时求值和周期过程。',
  '匿名未消费树、未证的攻击速度完整缩短式、暴击mStat9阶段、Yasuo W施法冲突、Yone R施法冲突和各技能事件时序。',
  'Yone W兵野最低/上限、未消费WDamage/BaseShield/匿名树；Yone E匿名DeathmarkBase、缺失生命数组和全来源伤害替代。',
];
const sourceScope = {
  batch: BATCH,
  status: '候选已冻结前的收口材料，严格数学脚本随后生成；未调用业务接口',
  sourceVersion,
  sourceIndexSha256,
  sourcePolicy: meta.sourcePolicy,
  included,
  excludedOrPending: excludedSummary,
  perSkillExcluded: Object.fromEntries(order.map((skillKey) => [skillKey, excluded[skillKey]])),
  perSkillPending: Object.fromEntries(order.map((skillKey) => [skillKey, pending[skillKey]])),
  counts: countsWithProtection,
  hashes: {
    currentSnapshotSha256,
    sourceManifestSha256: null,
    candidateSha256: null,
    planSha256: null,
    sourceValuesSha256: null,
    strictMathSha256: null,
  },
  noApiCalls: true,
};
writeJson('来源与范围.json', sourceScope);

const readHash = (relative) => sha256Buffer(fs.readFileSync(path.join(OUT, relative)));
const candidateSha256 = readHash('完整候选.json');
const planSha256 = readHash('写前请求计划.json');
const sourceValuesSha256 = readHash('源值解析.json');
const sourceManifestSha256 = readHash('来源哈希汇总.json');
const candidateVersion = {
  generatedAt: GENERATED_AT,
  status: '候选已生成，等待主负责人审查；未调用业务接口',
  batch: BATCH,
  sourceRevision: 'hero30-source-v1-candidate',
  candidateSha256,
  requestPlanSha256: planSha256,
  sourceValuesSha256,
  sourceManifestSha256,
  currentSnapshotSha256,
  sourceIndexSha256,
  counts: allCounts,
  requestCount,
  businessWrites: 0,
  strictMathSha256: null,
  noApiCalls: true,
};
writeJson('候选版本.json', candidateVersion);

const lock = {
  generatedAt: GENERATED_AT,
  status: '候选已冻结，等待主负责人审查；未授权业务写入',
  batch: BATCH,
  candidateSha256,
  requestPlanSha256: planSha256,
  sourceValuesSha256,
  sourceManifestSha256,
  currentSnapshotSha256,
  requestCount,
  counts: allCounts,
  protectedExisting: {
    subjects: protectedSubjects.length,
    compositionLists: order.length * 6,
    reusedPublicParameters: reusedPublicParameters.length,
    protectedReferenceGETs: snapshot.GETs,
  },
  noApiCalls: true,
  applyAuthorized: false,
  strictMathSha256: null,
};
writeJson('冻结候选锁.json', lock);

const index = {
  batch: BATCH,
  status: '候选待主负责人审查，未调用业务接口',
  candidate: '完整候选.json',
  plan: '写前请求计划.json',
  sourceValues: '源值解析.json',
  sourceManifest: '来源哈希汇总.json',
  version: '候选版本.json',
  lock: '冻结候选锁.json',
  source: '输入包/来源绑定与当前文本.json',
  protected: '输入包/参考资料/当前10槽保护快照.json',
  reused: '输入包/参考资料/公共参数复用清单.json',
  counts: allCounts,
  requestCount,
  exactNewObjects: requestCount,
  reusedParameters: reusedPublicParameters.length,
  protectedSubjects: protectedSubjects.length,
  protectedCompositionLists: order.length * 6,
  protectedReferenceGETs: snapshot.GETs,
  noApiCalls: true,
  strictMath: '严格数学.json',
  strictMathSha256: null,
  finalStatus: '候选已生成，严格数学脚本随后运行，未调用业务接口',
};
writeJson('候选交付索引.json', index);

console.log(JSON.stringify({
  candidateSha256,
  planSha256,
  sourceValuesSha256,
  sourceManifestSha256,
  requestCount,
  counts: allCounts,
  reusedPublicParameters: reusedPublicParameters.length,
  protectedSubjects: protectedSubjects.length,
  protectedCompositionLists: order.length * 6,
  protectedReferenceGETs: snapshot.GETs,
  inputIntegrityFailures: inputIntegrity.filter((item) => item.declaredMatch === false),
}, null, 2));
