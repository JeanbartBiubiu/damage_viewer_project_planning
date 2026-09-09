import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = here;
const read = file => fs.readFileSync(file);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const writeJson = (name, value) => {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(path.join(outDir, name), text);
  return { bytes: Buffer.byteLength(text), sha256: sha256(text) };
};

const binding = readJson(path.join(root, '来源绑定与当前文本.json'));
const snapshot = readJson(path.join(root, '参考资料', '当前10槽保护快照.json'));
const publicList = readJson(path.join(root, '参考资料', '公共参数复用清单.json'));
const ekkoOfficial = readJson(path.join(root, '参考资料', '官方中文', 'Ekko.json'));
const fizzOfficial = readJson(path.join(root, '参考资料', '官方中文', 'Fizz.json'));
const ekkoClient = JSON.parse(zlib.gunzipSync(read(path.join(root, '参考资料', '客户端原文', 'Ekko.json.gz'))).toString('utf8'));
const fizzClient = JSON.parse(zlib.gunzipSync(read(path.join(root, '参考资料', '客户端原文', 'Fizz.json.gz'))).toString('utf8'));

const SNAPSHOT_SHA = sha256(fs.readFileSync(path.join(root, '参考资料', '当前10槽保护快照.json')));
const BINDING_SHA = sha256(fs.readFileSync(path.join(root, '来源绑定与当前文本.json')));
const EKKO_GZ_SHA = sha256(read(path.join(root, '参考资料', '客户端原文', 'Ekko.json.gz')));
const FIZZ_GZ_SHA = sha256(read(path.join(root, '参考资料', '客户端原文', 'Fizz.json.gz')));

const snapshotGet = route => snapshot.requests.find(item => item.route === route);
const heroOf = id => binding.heroes.find(item => item.id === id);
const spellOf = (id, slot) => heroOf(id).skills.find(item => item.slot === slot);
const clientSpell = (client, bindingPath) => client[bindingPath];
const dataValues = spell => (spell.mSpell?.DataValues || []).reduce((acc, item) => {
  acc[item.name] = item.values || null;
  return acc;
}, {});
const ranks = (values, maxLevel) => {
  const levelValues = {};
  for (let i = 1; i <= maxLevel; i += 1) levelValues[String(i)] = values[i];
  return levelValues;
};
const intRanks = (values, maxLevel) => {
  const levelValues = {};
  for (let i = 1; i <= maxLevel; i += 1) {
    const raw = values[i];
    const n = Number(raw);
    if (!Number.isInteger(n)) throw Error(`非整数等级值 ${raw}`);
    levelValues[String(i)] = n;
  }
  return levelValues;
};
const msRanks = (seconds, maxLevel) => {
  const levelValues = {};
  for (let i = 1; i <= maxLevel; i += 1) {
    const ms = Number(seconds[i]) * 1000;
    if (!Number.isInteger(ms)) throw Error(`毫秒非整数 ${seconds[i]}`);
    levelValues[String(i)] = ms;
  }
  return levelValues;
};

function P(parameterKey) {
  return { nodeType: 'PARAMETER', parameterKey };
}
function sourceAttr(attributeKey, attributeValueKind) {
  return { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey, attributeValueKind };
}
function op(operation, left, right) {
  return { nodeType: 'OPERATION', operation, operands: [left, right] };
}
const add = (a, b) => op('ADD', a, b);
const mul = (a, b) => op('MULTIPLY', a, b);
const sourceAp = () => sourceAttr('ability_power', 'TOTAL');
const sourceTotalAd = () => sourceAttr('attack_damage', 'TOTAL');

function apiParam(item) {
  return {
    parameterKey: item.parameterKey,
    name: item.name,
    valueType: item.valueType,
    valueMode: item.valueMode,
    fixedValue: item.fixedValue ?? null,
    levelValues: item.levelValues ?? null,
    description: item.description,
    sortOrder: item.sortOrder,
  };
}

function manaEffect() {
  return {
    effectKey: 'mana_cost',
    name: '施放法力消耗',
    description: '仅保留官方基础法力消耗；实际扣除时点与施放资格尚未接线。',
    sortOrder: 10,
    lifecycle: null,
    results: [
      {
        resultKey: 'consume_mana',
        name: '消耗法力',
        resultType: 'RESOURCE_CHANGE',
        target: 'SOURCE',
        description: null,
        sortOrder: 10,
        lifecycleBehavior: null,
        spellShieldBlockScope: null,
        valueRule: {
          value: { kind: 'PARAMETER', parameterKey: 'mana_cost' },
          fixedMultiplier: 1,
          fixedMinValue: 0,
          fixedMaxValue: null,
        },
        detail: { attributeKey: 'mana', operation: 'CONSUME' },
      },
    ],
  };
}

function snapshotParam(skillKey, parameterKey) {
  const list = snapshotGet(`/skills/${skillKey}/parameters`).data;
  const found = list.find(item => item.parameterKey === parameterKey);
  if (!found) throw Error(`快照缺少 ${skillKey}.${parameterKey}`);
  return {
    parameterKey: found.parameterKey,
    name: found.name,
    valueType: found.valueType,
    valueMode: found.valueMode,
    fixedValue: found.fixedValue,
    levelValues: found.levelValues,
    description: found.description,
    sortOrder: found.sortOrder,
  };
}

if (publicList.length !== 15) throw Error(`公共参数应为 15，实际 ${publicList.length}`);
for (const item of publicList) {
  const found = snapshotParam(item.skillKey, item.parameterKey);
  if (!found) throw Error('复用清单与快照不一致');
}

const reusedPublicParameters = publicList.map(item => {
  const value = snapshotParam(item.skillKey, item.parameterKey);
  return {
    skillKey: item.skillKey,
    parameterKey: item.parameterKey,
    route: `/skills/${item.skillKey}/parameters/${item.parameterKey}`,
    action: '完整复用冻结实值，不发更新或重建',
    ...value,
  };
});

const reusedOf = skillKey => reusedPublicParameters.filter(item => item.skillKey === skillKey).map(item => apiParam(item));

const ekkoP = spellOf('Ekko', 'P');
const ekkoQ = spellOf('Ekko', 'Q');
const ekkoW = spellOf('Ekko', 'W');
const ekkoE = spellOf('Ekko', 'E');
const ekkoR = spellOf('Ekko', 'R');
const fizzP = spellOf('Fizz', 'P');
const fizzQ = spellOf('Fizz', 'Q');
const fizzW = spellOf('Fizz', 'W');
const fizzE = spellOf('Fizz', 'E');
const fizzR = spellOf('Fizz', 'R');
const ekkoPClient = clientSpell(ekkoClient, ekkoP.binding);
const ekkoQClient = clientSpell(ekkoClient, ekkoQ.binding);
const ekkoWClient = clientSpell(ekkoClient, ekkoW.binding);
const ekkoEClient = clientSpell(ekkoClient, ekkoE.binding);
const ekkoRClient = clientSpell(ekkoClient, ekkoR.binding);
const fizzPClient = clientSpell(fizzClient, fizzP.binding);
const fizzQClient = clientSpell(fizzClient, fizzQ.binding);
const fizzWClient = clientSpell(fizzClient, fizzW.binding);
const fizzEClient = clientSpell(fizzClient, fizzE.binding);
const fizzRClient = clientSpell(fizzClient, fizzR.binding);
const ekkoPDv = dataValues(ekkoPClient);
const ekkoQDv = dataValues(ekkoQClient);
const ekkoWDv = dataValues(ekkoWClient);
const ekkoEDv = dataValues(ekkoEClient);
const ekkoRDv = dataValues(ekkoRClient);
const fizzPDv = dataValues(fizzPClient);
const fizzWDv = dataValues(fizzWClient);
const fizzEDv = dataValues(fizzEClient);
const fizzRDv = dataValues(fizzRClient);
const fizzQEffect1 = fizzQClient.mSpell.mEffectAmount[0].value;

function loc(skill) {
  return {
    mLocKeys: skill.object.mSpell.mClientData.mTooltipData.mLocKeys,
    currentTexts: Object.fromEntries(Object.entries(skill.currentTexts).map(([k, v]) => [k, { sourceKey: v.sourceKey, text: v.text }])),
  };
}

function sourceBlock(heroId, skill, clientFile, gzSha) {
  const hero = heroOf(heroId);
  return {
    hero: heroId,
    rootPath: hero.rootPath,
    spellPath: skill.binding,
    clientFile,
    compressedSha256: gzSha,
    ...loc(skill),
  };
}

const emptyWriteTail = { processes: [], internalStates: [], triggerRules: [] };

const skills = {};

skills.ekko_p = {
  skillKey: 'ekko_p',
  name: '艾克·Z型驱动共振',
  maxLevel: 1,
  source: sourceBlock('Ekko', ekkoP, '参考资料/客户端原文/Ekko.json.gz', EKKO_GZ_SHA),
  write: {
    parameters: [
      {
        parameterKey: 'hit_count_to_trigger',
        name: '触发所需同目标命中次数',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 3,
        levelValues: null,
        description: '当前根绑定正文 Spell_EkkoPassive_Tooltip「每第三次攻击或伤害型技能」。次数用整数。不是运行中的叠层事件。',
        sortOrder: 10,
      },
      {
        parameterKey: 'lockout_ms',
        name: '同目标锁定间隔（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 4000,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.LockoutTime 取索引1，原值4秒转毫秒。仅基础间隔，未接线实际锁定。',
        sortOrder: 20,
      },
      {
        parameterKey: 'modes_multiplier',
        name: '召唤师峡谷模式倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 1,
        levelValues: null,
        description: 'ThreeHitDamage.mMultiplier 绑定 DataValues.ModesMultiplier 索引1至1，召唤师峡谷为1。樱桃模式覆盖1.1不进入本1v1候选。',
        sortOrder: 30,
      },
      {
        parameterKey: 'char_level_base_damage',
        name: '角色等级基础魔法伤害（实际值外供）',
        valueType: 'DECIMAL',
        valueMode: 'RUNTIME_INPUT',
        fixedValue: null,
        levelValues: null,
        description: 'ThreeHitDamage 第一项 ByCharLevelBreakpointsCalculationPart：mLevel1Value=30、mInitialBonusPerLevel=10，7级起 mBonusPerLevelAtAndAfter=5。求值循环未证，不展开1至18级，不默认0。',
        sortOrder: 40,
      },
      {
        parameterKey: 'ap_ratio',
        name: '三次命中法强倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.8,
        levelValues: null,
        description: 'ThreeHitDamage 第二项 StatByCoefficientCalculationPart mCoefficient 原始 0.800000011920929，按明确设计值归一为0.8。省略 mStat/mStatFormula，按同版本窄口径映射来源总法强。',
        sortOrder: 50,
      },
      {
        parameterKey: 'bonus_move_speed_ratio',
        name: '对英雄爆发移动速度比例（实际值外供）',
        valueType: 'DECIMAL',
        valueMode: 'RUNTIME_INPUT',
        fixedValue: null,
        levelValues: null,
        description: 'BonusMS 为角色等级断点，mDisplayAsPercent。mLevel1Value=0.5，6/11/16级各 mAdditionalBonusAtThisLevel=0.1。求值循环未证，不猜线性，不默认0。单位：1=100%。',
        sortOrder: 60,
      },
      {
        parameterKey: 'bonus_move_speed_duration_seconds',
        name: '爆发移动速度持续（秒，实际值外供）',
        valueType: 'DECIMAL',
        valueMode: 'RUNTIME_INPUT',
        fixedValue: null,
        levelValues: null,
        description: 'SpeedDuration 为角色等级断点：mLevel1Value=2，6/11级各 mAdditionalBonusAtThisLevel=0.5。求值循环未证，不换算成毫秒表，不默认0。',
        sortOrder: 70,
      },
    ],
    formulas: [
      {
        formulaKey: 'three_hit_damage',
        name: '三次命中额外魔法伤害',
        expression: mul(P('modes_multiplier'), add(P('char_level_base_damage'), mul(P('ap_ratio'), sourceAp()))),
        description: 'ThreeHitDamage = ModesMultiplier ×（角色等级断点外供 + 0.8×来源总法强）。含 mMultiplier。不是减伤后实伤，也不把第三次命中写成可运行触发。',
        sortOrder: 10,
      },
    ],
    effects: [],
    ...emptyWriteTail,
  },
  pending: [
    { kind: '事件', item: '同目标第三次命中', reason: '叠层、清空和锁定未实现为过程或触发规则。' },
    { kind: '曲线', item: 'BonusMS/SpeedDuration/三次伤害基础', reason: 'ByCharLevelBreakpoints 只证明字段，不展开等级表。' },
  ],
  excluded: [
    { kind: '兵野专用', item: 'MonsterMod', reason: '当前正文扩展行写对野怪造成 MonsterMod*100% 伤害，1v1 英雄目标跳过。' },
    { kind: '模式覆盖', item: 'DataValuesModeOverride.cherry', reason: '樱桃模式 ModesMultiplier=1.1，不进入召唤师峡谷 1v1。' },
  ],
  reusedPublicParameters: [],
};

skills.ekko_q = {
  skillKey: 'ekko_q',
  name: '艾克·时间卷曲器',
  maxLevel: 5,
  source: sourceBlock('Ekko', ekkoQ, '参考资料/客户端原文/Ekko.json.gz', EKKO_GZ_SHA),
  write: {
    parameters: [
      ...reusedOf('ekko_q'),
      {
        parameterKey: 'cast_time_ms',
        name: '施法时间（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 250,
        levelValues: null,
        description: '当前根 spellCastTime=0.25，无冲突的 mCastTime。仅保存根字段，不表示往程或返程命中发生在施法结束。',
        sortOrder: 20,
      },
      {
        parameterKey: 'outgoing_base_damage',
        name: '往程基础魔法伤害',
        valueType: 'INTEGER',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: intRanks(ekkoQDv.OutgoingDamage, 5),
        description: '客户端当前根绑定 DataValues.OutgoingDamage 取索引1至5。官方 effect[1] 为70起旧数组，不覆盖当前树。',
        sortOrder: 30,
      },
      {
        parameterKey: 'outgoing_ap_ratio',
        name: '往程法强倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.3,
        levelValues: null,
        description: 'InitialDamage 第二项 StatByCoefficient mCoefficient 原始 0.30000001192092896，归一为0.3。省略选择器，窄口径来源总法强。',
        sortOrder: 40,
      },
      {
        parameterKey: 'return_base_damage',
        name: '返程基础魔法伤害',
        valueType: 'INTEGER',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: intRanks(ekkoQDv.ReturnDamage, 5),
        description: '客户端当前根绑定 DataValues.ReturnDamage 取索引1至5。与往程分开，不把两次命中加成总伤害。',
        sortOrder: 50,
      },
      {
        parameterKey: 'return_ap_ratio',
        name: '返程法强倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.6,
        levelValues: null,
        description: 'RecallDamage 第二项 StatByCoefficient mCoefficient 原始 0.6000000238418579，归一为0.6。省略选择器，窄口径来源总法强。',
        sortOrder: 60,
      },
      {
        parameterKey: 'slow_percent_points',
        name: '时间扭曲力场减速百分数点',
        valueType: 'DECIMAL',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: {
          1: 40,
          2: 45,
          3: 50,
          4: 55,
          5: 60,
        },
        description: '客户端当前根绑定 DataValues.SlowPercent 索引1至5原始为负移速修正；当前正文 @SlowPercent*-100@%，转为正的40至60百分数点。不把负哨兵当持续时间。',
        sortOrder: 70,
      },
      {
        parameterKey: 'expand_duration_ms',
        name: '力场展开持续（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 1750,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.ExpandDuration 取索引1至5，原值1.75秒转毫秒。',
        sortOrder: 80,
      },
      {
        parameterKey: 'slow_zone_radius',
        name: '减速力场半径',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 165,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.SlowZoneRadius 取索引1至5。1v1 下唯一敌人可处于该范围。',
        sortOrder: 90,
      },
    ],
    formulas: [
      {
        formulaKey: 'initial_damage',
        name: '往程魔法伤害',
        expression: add(P('outgoing_base_damage'), mul(P('outgoing_ap_ratio'), sourceAp())),
        description: 'InitialDamage = OutgoingDamage + 0.3×来源总法强。tooltipOnly。同目标可再吃返程，不在此相加。',
        sortOrder: 10,
      },
      {
        formulaKey: 'recall_damage',
        name: '返程魔法伤害',
        expression: add(P('return_base_damage'), mul(P('return_ap_ratio'), sourceAp())),
        description: 'RecallDamage = ReturnDamage + 0.6×来源总法强。tooltipOnly。不是往返合计。',
        sortOrder: 20,
      },
    ],
    effects: [manaEffect()],
    ...emptyWriteTail,
  },
  pending: [
    { kind: '事件', item: '往程命中/召回/二次命中', reason: '弹道、命中资格和返回尚未实现，不创建 DAMAGE 结果。' },
    { kind: '数据值', item: 'SlowAPRatio', reason: '根 DataValues 有名无值，不默认0。' },
  ],
  excluded: [],
  reusedPublicParameters: ['cooldown_ms', 'mana_cost'],
};

skills.ekko_w = {
  skillKey: 'ekko_w',
  name: '艾克·时光交错',
  maxLevel: 5,
  source: sourceBlock('Ekko', ekkoW, '参考资料/客户端原文/Ekko.json.gz', EKKO_GZ_SHA),
  write: {
    parameters: [
      ...reusedOf('ekko_w'),
      {
        parameterKey: 'cast_time_ms',
        name: '施法时间（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 250,
        levelValues: null,
        description: '当前根 spellCastTime=0.25，无冲突的 mCastTime。仅保存根字段。',
        sortOrder: 20,
      },
      {
        parameterKey: 'below_health_threshold_ratio',
        name: '额外伤害生命阈值比例',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.3,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.BelowHealthThreshold 原始 0.30000001192092896，归一为0.3。正文 @BelowHealthThreshold*100@%。单位：1=100%。',
        sortOrder: 30,
      },
      {
        parameterKey: 'on_hit_base',
        name: '已损失生命伤害基础点数',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 3,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.BaseOnHitDamage 取索引1至5。进入 MissingHealthPercent 后再乘 0.01。',
        sortOrder: 40,
      },
      {
        parameterKey: 'on_hit_ap_ratio',
        name: '已损失生命伤害法强倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.03,
        levelValues: null,
        description: 'MissingHealthPercent 第二项 StatByCoefficient mCoefficient 原始 0.029999999329447746，归一为0.03。省略选择器，窄口径来源总法强。',
        sortOrder: 50,
      },
      {
        parameterKey: 'missing_health_ratio_multiplier',
        name: '已损失生命比例换算',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.01,
        levelValues: null,
        description: 'MissingHealthPercent.mMultiplier NumberCalculationPart 原始 0.009999999776482582，归一为0.01。mDisplayAsPercent。该公式是已损失生命比例，不是实际造成伤害。',
        sortOrder: 60,
      },
      {
        parameterKey: 'shield_base',
        name: '自身护盾基础值',
        valueType: 'INTEGER',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: intRanks(ekkoWDv.ShieldBase, 5),
        description: '客户端当前根绑定 DataValues.ShieldBase 取索引1至5。',
        sortOrder: 70,
      },
      {
        parameterKey: 'shield_ap_ratio',
        name: '护盾法强倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 1.5,
        levelValues: null,
        description: 'TotalShield 第二项 StatByCoefficient mCoefficient=1.5。省略选择器，窄口径来源总法强。',
        sortOrder: 80,
      },
      {
        parameterKey: 'slow_percent_points',
        name: '球体减速百分数点',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 40,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.SlowPercent 取索引1至5，正文直接显示 @SlowPercent@%，已是百分数点，不乘0.01。',
        sortOrder: 90,
      },
      {
        parameterKey: 'slow_zone_duration_ms',
        name: '减速球体持续（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 1500,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.SlowZoneDuration 取索引1至5，原值1.5秒转毫秒。',
        sortOrder: 120,
      },
      {
        parameterKey: 'stun_duration_ms',
        name: '引爆晕眩持续（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 2250,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.StunDuration 取索引1至5，原值2.25秒转毫秒。',
        sortOrder: 130,
      },
      {
        parameterKey: 'detonation_delay_ms',
        name: '引爆前延迟（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 3000,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.DelayBeforeDetonation 取索引1至5，原值3秒转毫秒。',
        sortOrder: 140,
      },
      {
        parameterKey: 'aoe_radius',
        name: '球体半径',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 375,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.AoERadius 取索引1至5。1v1 下唯一敌人可处于该范围。',
        sortOrder: 150,
      },
    ],
    formulas: [
      {
        formulaKey: 'missing_health_damage_ratio',
        name: '已损失生命魔法伤害比例',
        expression: mul(P('missing_health_ratio_multiplier'), add(P('on_hit_base'), mul(P('on_hit_ap_ratio'), sourceAp()))),
        description: 'MissingHealthPercent = 0.01×(BaseOnHitDamage + 0.03×来源总法强)。这是已损失生命比例，不是实际造成伤害；目标已损失生命仍待外供。',
        sortOrder: 10,
      },
      {
        formulaKey: 'total_shield',
        name: '自身护盾值',
        expression: add(P('shield_base'), mul(P('shield_ap_ratio'), sourceAp())),
        description: 'TotalShield = ShieldBase + 1.5×来源总法强。护盾持续未出现在 DataValues，不创建可运行护盾效果。',
        sortOrder: 20,
      },
    ],
    effects: [manaEffect()],
    ...emptyWriteTail,
  },
  pending: [
    { kind: '修饰', item: '{79b6144b}', reason: 'GameCalculationModified 的 mMultiplier 使用 mStat=15，当前窄口径未证，不伪造属性枚举。' },
    { kind: '效果', item: '自身护盾', reason: '护盾数值明确，但持续未在根 DataValues 出现，不把 NORMAL_SHIELD 写成可运行。' },
    { kind: '输入', item: '目标已损失生命', reason: '比例公式已录；实际伤害需要外供，无默认。' },
    { kind: '影像', item: '布置幻象', reason: '施法影像是本技能表现，不是独立召唤；引爆与进入球体事件未接线。' },
  ],
  excluded: [
    { kind: '兵野专用', item: 'OnHitMinMinionDamage/OnHitMaxMinionDamage', reason: '当前扩展行只约束小兵野怪最小最大伤害。' },
    { kind: '纯视野', item: 'DelayBeforeEnemyCanSee', reason: '敌方可见球体的延迟属视野，不进入 1v1 战斗组成。' },
  ],
  reusedPublicParameters: ['cooldown_ms', 'mana_cost'],
};

skills.ekko_e = {
  skillKey: 'ekko_e',
  name: '艾克·相位俯冲',
  maxLevel: 5,
  source: sourceBlock('Ekko', ekkoE, '参考资料/客户端原文/Ekko.json.gz', EKKO_GZ_SHA),
  write: {
    parameters: [
      ...reusedOf('ekko_e'),
      {
        parameterKey: 'cast_time_ms',
        name: '施法时间（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 250,
        levelValues: null,
        description: '当前根仅有 mCastTime=0.25，无 spellCastTime。子节点 EkkoEAttack 同时有 spellCastTime=0.39 与 mCastTime=0.25，冲突字段不选，不用于本根参数。',
        sortOrder: 20,
      },
      {
        parameterKey: 'base_damage',
        name: '强化攻击基础魔法伤害',
        valueType: 'INTEGER',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: intRanks(ekkoEDv.BaseDamage, 5),
        description: '客户端当前根绑定 DataValues.BaseDamage 取索引1至5。',
        sortOrder: 30,
      },
      {
        parameterKey: 'ap_ratio',
        name: '强化攻击法强倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.4,
        levelValues: null,
        description: 'TotalDamage 第二项 StatByCoefficient mCoefficient 原始 0.4000000059604645，归一为0.4。省略选择器，窄口径来源总法强。',
        sortOrder: 40,
      },
      {
        parameterKey: 'dash_distance',
        name: '突进距离',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 350,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.DashDistance 取索引1至5。位移过程未接线。',
        sortOrder: 50,
      },
      {
        parameterKey: 'buff_duration_ms',
        name: '强化攻击持续（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 3000,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.BuffDuration 取索引1至5，原值3秒转毫秒。',
        sortOrder: 60,
      },
      {
        parameterKey: 'attack_range_increase',
        name: '攻击距离增加',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 300,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.AttackRangeIncrease 取索引1至5。',
        sortOrder: 70,
      },
    ],
    formulas: [
      {
        formulaKey: 'damage',
        name: '相位俯冲额外魔法伤害',
        expression: add(P('base_damage'), mul(P('ap_ratio'), sourceAp())),
        description: 'TotalDamage = BaseDamage + 0.4×来源总法强。tooltipOnly。不把传送到目标旁写成可运行位移。',
        sortOrder: 10,
      },
    ],
    effects: [manaEffect()],
    ...emptyWriteTail,
  },
  pending: [
    { kind: '事件', item: '突进与强化普攻命中', reason: '攻击重置、传送和命中未实现。' },
    { kind: '施法时间', item: 'EkkoEAttack', reason: '子节点两个施法时间字段冲突，不任选其一。' },
  ],
  excluded: [],
  reusedPublicParameters: ['cooldown_ms', 'mana_cost'],
};

skills.ekko_r = {
  skillKey: 'ekko_r',
  name: '艾克·时空断裂',
  maxLevel: 3,
  source: sourceBlock('Ekko', ekkoR, '参考资料/客户端原文/Ekko.json.gz', EKKO_GZ_SHA),
  write: {
    parameters: [
      ...reusedOf('ekko_r'),
      {
        parameterKey: 'cast_time_ms',
        name: '施法时间（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 250,
        levelValues: null,
        description: '当前根仅有 mCastTime=0.25，无 spellCastTime。仅保存根字段。',
        sortOrder: 20,
      },
      {
        parameterKey: 'base_damage',
        name: '到达基础魔法伤害',
        valueType: 'INTEGER',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: intRanks(ekkoRDv.Damage, 3),
        description: '客户端当前根绑定 DataValues.Damage 取索引1至3。',
        sortOrder: 30,
      },
      {
        parameterKey: 'ap_ratio',
        name: '到达伤害法强倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 1.75,
        levelValues: null,
        description: 'TotalDamage 第二项 StatByCoefficient mCoefficient=1.75。省略选择器，窄口径来源总法强。',
        sortOrder: 40,
      },
      {
        parameterKey: 'flat_heal',
        name: '基础治疗固定值',
        valueType: 'INTEGER',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: intRanks(ekkoRDv.FlatHeal, 3),
        description: '客户端当前根绑定 DataValues.FlatHeal 取索引1至3。这是 TotalBaseHeal 基础项，不是已放大后的实际治疗。',
        sortOrder: 50,
      },
      {
        parameterKey: 'heal_ap_ratio',
        name: '基础治疗法强倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.6,
        levelValues: null,
        description: 'TotalBaseHeal 第二项 StatByCoefficient mCoefficient 原始 0.6000000238418579，归一为0.6。省略选择器，窄口径来源总法强。',
        sortOrder: 60,
      },
      {
        parameterKey: 'heal_amp_percent_per_missing_percent',
        name: '每损失生命百分数点提升治疗百分数点',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 3,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.PercentHealAmpPerPercentMissingHealth 取索引1至3。正文写每损失1%生命提升该值%。不把它与 BotData 里乘20的机器人占位合成完整治疗函数。',
        sortOrder: 70,
      },
      {
        parameterKey: 'rewind_window_ms',
        name: '回溯时间窗（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 4000,
        levelValues: null,
        description: '当前根正文写「4秒前」和「最近4秒」，不是 DataValues。只记录时间窗长度。',
        sortOrder: 80,
      },
      {
        parameterKey: 'past_missing_health_percent_points',
        name: '最近时间窗已损失生命百分数点（实际值外供）',
        valueType: 'DECIMAL',
        valueMode: 'RUNTIME_INPUT',
        fixedValue: null,
        levelValues: null,
        description: '历史位置和实际过去受伤量不能伪造。无默认。不把该输入填进可运行治疗结果。',
        sortOrder: 90,
      },
      {
        parameterKey: 'aoe_radius',
        name: '到达范围半径',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 375,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.AoERadius 取索引1至3。1v1 下唯一敌人可承受该范围伤害。',
        sortOrder: 120,
      },
    ],
    formulas: [
      {
        formulaKey: 'damage',
        name: '到达范围魔法伤害',
        expression: add(P('base_damage'), mul(P('ap_ratio'), sourceAp())),
        description: 'TotalDamage = Damage + 1.75×来源总法强。到达事件未接线。',
        sortOrder: 10,
      },
      {
        formulaKey: 'total_base_heal',
        name: '基础治疗量',
        expression: add(P('flat_heal'), mul(P('heal_ap_ratio'), sourceAp())),
        description: 'TotalBaseHeal = FlatHeal + 0.6×来源总法强。这是基础治疗，不是按过去受伤放大后的实际治疗，也不创建直接治疗结果。',
        sortOrder: 20,
      },
    ],
    effects: [manaEffect()],
    ...emptyWriteTail,
  },
  pending: [
    { kind: '回溯', item: '历史位置', reason: '无默认外供，不伪造回溯事件。' },
    { kind: '输入', item: '实际过去受伤量', reason: '时间窗已损失生命为 RUNTIME_INPUT；正文百分号加成未形成当前玩家计算树，不冒充完整治疗函数。' },
    { kind: '机器人树', item: 'BotData 治疗占位', reason: 'BotData 把治疗加成与数字20相乘，不是当前玩家公式。' },
  ],
  excluded: [],
  reusedPublicParameters: ['cooldown_ms', 'mana_cost'],
};

skills.fizz_p = {
  skillKey: 'fizz_p',
  name: '菲兹·伶俐斗士',
  maxLevel: 1,
  source: sourceBlock('Fizz', fizzP, '参考资料/客户端原文/Fizz.json.gz', FIZZ_GZ_SHA),
  write: {
    parameters: [
      {
        parameterKey: 'damage_reduction_flat',
        name: '固定伤害减免',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 4,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.DamageReduction 取索引1至1。单位：伤害点数，不是减伤后实伤。',
        sortOrder: 10,
      },
      {
        parameterKey: 'ap_ratio',
        name: '伤害减免法强倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.01,
        levelValues: null,
        description: 'DamageReductionCalc 的 StatByNamedDataValue 绑定 APRatio，原始 0.009999999776482582，归一为0.01。省略 mStat/mStatFormula，窄口径来源总法强。',
        sortOrder: 20,
      },
      {
        parameterKey: 'damage_reduction_max_ratio',
        name: '减免占比上限比例',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.5,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.DamageReductionMax 取索引1至1。当前扩展行写占比不能超过该值×100%。上限未进入 DamageReductionCalc 树，不把 MIN(当次伤害×0.5) 写成完整函数。单位：1=100%。',
        sortOrder: 30,
      },
    ],
    formulas: [
      {
        formulaKey: 'damage_reduction',
        name: '固定伤害减免',
        expression: add(P('damage_reduction_flat'), mul(P('ap_ratio'), sourceAp())),
        description: 'DamageReductionCalc = DamageReduction + APRatio×来源总法强。这是固定减免点数，不是减伤后实际受到伤害，也不含占比上限。',
        sortOrder: 10,
      },
    ],
    effects: [],
    ...emptyWriteTail,
  },
  pending: [
    { kind: '上限', item: 'DamageReductionMax', reason: '占比上限需要当次所受伤害外供；当前树没有 MIN 节点。' },
    { kind: '残留字段', item: 'spellCastTime/mana', reason: '被动对象残留施法时间0.25和法力40，正文无消耗，不录入。' },
  ],
  excluded: [
    { kind: '兵野专用', item: 'MonsterDamageReductionCalc', reason: '扩展行写对抗野怪修正，1v1 英雄跳过。' },
    { kind: '纯碰撞', item: '幽灵穿单位', reason: '正文幽灵状态无视碰撞体积，属纯碰撞。' },
  ],
  reusedPublicParameters: [],
};

const fizzQMagicBase = {
  1: fizzQEffect1[1],
  2: fizzQEffect1[2],
  3: fizzQEffect1[3],
  4: fizzQEffect1[4],
  5: fizzQEffect1[5],
};

skills.fizz_q = {
  skillKey: 'fizz_q',
  name: '菲兹·淘气打击',
  maxLevel: 5,
  source: sourceBlock('Fizz', fizzQ, '参考资料/客户端原文/Fizz.json.gz', FIZZ_GZ_SHA),
  write: {
    parameters: [
      ...reusedOf('fizz_q'),
      {
        parameterKey: 'cast_time_ms',
        name: '施法时间（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 250,
        levelValues: null,
        description: '当前根 spellCastTime=0.25，无冲突的 mCastTime。',
        sortOrder: 20,
      },
      {
        parameterKey: 'magic_base_damage',
        name: '额外基础魔法伤害',
        valueType: 'INTEGER',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: fizzQMagicBase,
        description: 'QDamage 使用 EffectValueCalculationPart mEffectIndex=1，对应 mEffectAmount[0] 取索引1至5。根无 DataValues。',
        sortOrder: 30,
      },
      {
        parameterKey: 'magic_ap_ratio',
        name: '额外魔法伤害法强倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.55,
        levelValues: null,
        description: 'QDamage 第二项 StatByCoefficient mCoefficient 原始 0.550000011920929，归一为0.55。省略选择器，窄口径来源总法强。',
        sortOrder: 40,
      },
      {
        parameterKey: 'physical_ad_ratio',
        name: '物理伤害总攻击力倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 1,
        levelValues: null,
        description: 'TotalDamage tooltipOnly：StatByCoefficient 显式 mStat=2、mCoefficient=1，mStatFormula 省略按构造为0。同版本 mStat2 省略公式对应来源总攻击力，不能套额外攻击力。',
        sortOrder: 50,
      },
    ],
    formulas: [
      {
        formulaKey: 'magic_damage',
        name: '淘气打击额外魔法伤害',
        expression: add(P('magic_base_damage'), mul(P('magic_ap_ratio'), sourceAp())),
        description: 'QDamage = Effect1 + 0.55×来源总法强。与物理部分分开。',
        sortOrder: 10,
      },
      {
        formulaKey: 'physical_damage',
        name: '淘气打击物理伤害',
        expression: mul(P('physical_ad_ratio'), sourceTotalAd()),
        description: 'TotalDamage = 1×来源总攻击力。显式 mStat=2。总攻击力200、额外攻击力100时该项为200，误用额外攻击力会得到100。',
        sortOrder: 20,
      },
    ],
    effects: [manaEffect()],
    ...emptyWriteTail,
  },
  pending: [
    { kind: '事件', item: '穿身与攻击特效', reason: '命中和攻击特效施加未实现，扩展行只说明会施加，不写成可运行触发。' },
  ],
  excluded: [],
  reusedPublicParameters: ['cooldown_ms', 'mana_cost'],
};

skills.fizz_w = {
  skillKey: 'fizz_w',
  name: '菲兹·海石三叉戟',
  maxLevel: 5,
  source: sourceBlock('Fizz', fizzW, '参考资料/客户端原文/Fizz.json.gz', FIZZ_GZ_SHA),
  write: {
    parameters: [
      ...reusedOf('fizz_w'),
      {
        parameterKey: 'cast_time_ms',
        name: '施法时间（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 250,
        levelValues: null,
        description: '当前根 spellCastTime=0.25，无冲突的 mCastTime。',
        sortOrder: 20,
      },
      {
        parameterKey: 'dot_base_damage',
        name: '流血总基础魔法伤害',
        valueType: 'INTEGER',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: intRanks(fizzWDv.DoTBaseDamage, 5),
        description: '客户端当前根绑定 DataValues.DoTBaseDamage 取索引1至5。正文写持续时间内共造成，是总量不是每次跳数。',
        sortOrder: 30,
      },
      {
        parameterKey: 'dot_ap_ratio',
        name: '流血总量法强倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.25,
        levelValues: null,
        description: 'DoTDamage 的 StatByNamedDataValue 绑定 DoTRatio 索引1至5。省略选择器，窄口径来源总法强。',
        sortOrder: 40,
      },
      {
        parameterKey: 'bleed_duration_ms',
        name: '流血持续（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 3000,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.BleedDuration 取索引1至5，原值3秒转毫秒。与 PassiveDoTDuration 同为3，不另造每次伤害。',
        sortOrder: 50,
      },
      {
        parameterKey: 'dot_ticks_per_second',
        name: '流血每秒跳数',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 2,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.DoTTicksPerSecond 取索引1至5。次数用整数。不把总量除以跳数冒充每次伤害公式。',
        sortOrder: 60,
      },
      {
        parameterKey: 'active_base_damage',
        name: '强化攻击基础魔法伤害',
        valueType: 'INTEGER',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: intRanks(fizzWDv.ActiveBaseDamage, 5),
        description: '客户端当前根绑定 DataValues.ActiveBaseDamage 取索引1至5。',
        sortOrder: 70,
      },
      {
        parameterKey: 'active_ap_ratio',
        name: '强化攻击法强倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.45,
        levelValues: null,
        description: 'ActiveDamage 的 StatByNamedDataValue 绑定 ActiveRatio 原始 0.44999998807907104，归一为0.45。省略选择器，窄口径来源总法强。',
        sortOrder: 80,
      },
      {
        parameterKey: 'active_duration_ms',
        name: '强化攻击窗口（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 4000,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.ActiveDuration 取索引1至5，原值4秒转毫秒。',
        sortOrder: 90,
      },
      {
        parameterKey: 'on_hit_buff_base_damage',
        name: '后续攻击基础魔法伤害',
        valueType: 'INTEGER',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: intRanks(fizzWDv.OnHitBuffBaseDamage, 5),
        description: '客户端当前根绑定 DataValues.OnHitBuffBaseDamage 取索引1至5。',
        sortOrder: 120,
      },
      {
        parameterKey: 'on_hit_ap_ratio',
        name: '后续攻击法强倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.3,
        levelValues: null,
        description: 'OnHitBuffDamage 的 StatByNamedDataValue 绑定 OnHitRatio 原始 0.30000001192092896，归一为0.3。省略选择器，窄口径来源总法强。',
        sortOrder: 130,
      },
      {
        parameterKey: 'on_hit_buff_duration_ms',
        name: '后续强化持续（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 5000,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.OnHitBuffDuration 取索引1至5，原值5秒转毫秒。',
        sortOrder: 140,
      },
      {
        parameterKey: 'on_kill_mana_refund',
        name: '击杀返还法力',
        valueType: 'INTEGER',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: intRanks(fizzWDv.OnKillManaRefund, 5),
        description: '客户端当前根绑定 DataValues.OnKillManaRefund 取索引1至5。击杀事件未接线，只保存数值。',
        sortOrder: 150,
      },
      {
        parameterKey: 'on_kill_new_cooldown_ms',
        name: '击杀后冷却（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 1000,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.OnKillNewCooldown 取索引1至5，原值1秒转毫秒。缩短冷却事件未接线。',
        sortOrder: 160,
      },
    ],
    formulas: [
      {
        formulaKey: 'dot_damage',
        name: '流血期间总魔法伤害',
        expression: add(P('dot_base_damage'), mul(P('dot_ap_ratio'), sourceAp())),
        description: 'DoTDamage = DoTBaseDamage + DoTRatio×来源总法强。正文为持续时间内共造成的总量，不是每秒或每次跳数。',
        sortOrder: 10,
      },
      {
        formulaKey: 'active_damage',
        name: '强化攻击额外魔法伤害',
        expression: add(P('active_base_damage'), mul(P('active_ap_ratio'), sourceAp())),
        description: 'ActiveDamage = ActiveBaseDamage + ActiveRatio×来源总法强。',
        sortOrder: 20,
      },
      {
        formulaKey: 'on_hit_buff_damage',
        name: '后续攻击额外魔法伤害',
        expression: add(P('on_hit_buff_base_damage'), mul(P('on_hit_ap_ratio'), sourceAp())),
        description: 'OnHitBuffDamage = OnHitBuffBaseDamage + OnHitRatio×来源总法强。',
        sortOrder: 30,
      },
    ],
    effects: [manaEffect()],
    ...emptyWriteTail,
  },
  pending: [
    { kind: '事件', item: '流血跳数/强化命中/击杀返还', reason: '命中、击杀缩短冷却和法力返还未实现，不创建可运行触发。' },
  ],
  excluded: [
    { kind: '兵野专用', item: 'BonusMonsterDamage', reason: '扩展行对野怪额外伤害。' },
    { kind: '非英雄', item: 'TurretMod', reason: '扩展行对建筑物 50% 伤害，不是唯一敌方英雄。' },
  ],
  reusedPublicParameters: ['cooldown_ms', 'mana_cost'],
};

const fizzECd = {
  1: 16000,
  2: 14000,
  3: 12000,
  4: 10000,
  5: 8000,
};

skills.fizz_e = {
  skillKey: 'fizz_e',
  name: '菲兹·古灵/精怪',
  maxLevel: 5,
  source: sourceBlock('Fizz', fizzE, '参考资料/客户端原文/Fizz.json.gz', FIZZ_GZ_SHA),
  write: {
    parameters: [
      ...reusedOf('fizz_e'),
      {
        parameterKey: 'cooldown_ms',
        name: '基础冷却时间（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: fizzECd,
        description: 'DDragon16.17.1 Fizz.spells[2].cooldown，等级1起索引0；与冻结客户端根绑定字段索引1起逐级一致。秒转换为毫秒。仅基础参数，未计急速或其他技能修正；不表示过程与机制完成。当前快照无该公共参数，属新增缺项。',
        sortOrder: 100,
      },
      {
        parameterKey: 'cast_time_ms',
        name: '施法时间（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 250,
        levelValues: null,
        description: '当前根 spellCastTime=0.25，无冲突的 mCastTime。再次施放子节点冷却不同，不把子节点冷却写进本根。',
        sortOrder: 20,
      },
      {
        parameterKey: 'base_damage',
        name: '落地基础魔法伤害',
        valueType: 'INTEGER',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: intRanks(fizzEDv.BaseDamage, 5),
        description: '客户端当前根绑定 DataValues.BaseDamage 取索引1至5。再次施放使用同一 EDamage 树，不另造伤害。',
        sortOrder: 30,
      },
      {
        parameterKey: 'ap_ratio',
        name: '落地法强倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.95,
        levelValues: null,
        description: 'EDamage 第二项 StatByCoefficient mCoefficient 原始 0.949999988079071，归一为0.95。省略选择器，窄口径来源总法强。',
        sortOrder: 40,
      },
      {
        parameterKey: 'slow_ratio',
        name: '首次落地减速比例',
        valueType: 'DECIMAL',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: {
          1: 0.4,
          2: 0.45,
          3: 0.5,
          4: 0.55,
          5: 0.6,
        },
        description: '客户端当前根绑定 DataValues.SlowAmount 索引1至5原始约0.40至0.60，按明确百分数点归一。正文 @SlowAmount*100@%。再次施放不减速。单位：1=100%。',
        sortOrder: 50,
      },
      {
        parameterKey: 'slow_duration_ms',
        name: '减速持续（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 2000,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.SlowDuration 取索引1至5，原值2秒转毫秒。',
        sortOrder: 60,
      },
      {
        parameterKey: 'large_aoe_radius',
        name: '首次落地半径',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 375,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.LargeAoESize 取索引1至5。1v1 下唯一敌人可处于该范围。',
        sortOrder: 70,
      },
      {
        parameterKey: 'small_aoe_radius',
        name: '再次施放落地半径',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 225,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.SmallAoESize 取索引1至5。再次施放事件未接线。',
        sortOrder: 80,
      },
    ],
    formulas: [
      {
        formulaKey: 'damage',
        name: '古灵精怪魔法伤害',
        expression: add(P('base_damage'), mul(P('ap_ratio'), sourceAp())),
        description: 'EDamage = BaseDamage + 0.95×来源总法强。首次与再次施放共用该树；再次施放无减速。',
        sortOrder: 10,
      },
    ],
    effects: [manaEffect()],
    ...emptyWriteTail,
  },
  pending: [
    { kind: '正文', item: '不可被选取0.75秒', reason: '当前正文有字面0.75秒，根 DataValues 无对应项，不猜参数。' },
    { kind: '事件', item: '再次施放', reason: '不可选取、落地和二次位移未实现。FizzETwo 冷却数组与根不一致，不任选覆盖根冷却。' },
  ],
  excluded: [],
  reusedPublicParameters: ['mana_cost'],
};

skills.fizz_r = {
  skillKey: 'fizz_r',
  name: '菲兹·巨鲨强袭',
  maxLevel: 3,
  source: sourceBlock('Fizz', fizzR, '参考资料/客户端原文/Fizz.json.gz', FIZZ_GZ_SHA),
  write: {
    parameters: [
      ...reusedOf('fizz_r'),
      {
        parameterKey: 'cast_time_ms',
        name: '施法时间（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 250,
        levelValues: null,
        description: '当前根 spellCastTime 与 mCastTime 均为0.25，同值。子节点 FizzRMissile/FizzRHop 为0.25与约0.251，不把子节点差用于本根。',
        sortOrder: 20,
      },
      {
        parameterKey: 'small_base_damage',
        name: '小鲨鱼基础魔法伤害',
        valueType: 'INTEGER',
        valueMode: 'SKILL_LEVEL',
        fixedValue: null,
        levelValues: intRanks(fizzRDv.SmallDamage, 3),
        description: '客户端当前根绑定 DataValues.SmallDamage 取索引1至3。',
        sortOrder: 30,
      },
      {
        parameterKey: 'small_ap_ratio',
        name: '小鲨鱼法强倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.6,
        levelValues: null,
        description: 'SmallSharkDamage 的 StatByNamedDataValue 绑定 SmallAPRatio 原始 0.6000000238418579，归一为0.6。省略选择器，窄口径来源总法强。',
        sortOrder: 40,
      },
      {
        parameterKey: 'mid_damage_multiplier',
        name: '中鲨鱼伤害倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 1.25,
        levelValues: null,
        description: '匿名计算 {262c3c02} 为 GameCalculationModified，mModifiedGameCalculation=SmallSharkDamage，mMultiplier 绑定 MidDamageMulti=1.25。不能跳过中分支。',
        sortOrder: 50,
      },
      {
        parameterKey: 'large_damage_multiplier',
        name: '大鲨鱼伤害倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 1.5,
        levelValues: null,
        description: 'BigSharkDamage 为 GameCalculationModified，mModifiedGameCalculation=SmallSharkDamage，mMultiplier 绑定 LargeDamageMulti=1.5。不能无条件默认最大。',
        sortOrder: 60,
      },
      {
        parameterKey: 'detonation_time_ms',
        name: '引爆延迟（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 2000,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.DetonationTime 取索引1至3，原值2秒转毫秒。',
        sortOrder: 70,
      },
      {
        parameterKey: 'slow_duration_ms',
        name: '减速持续（毫秒）',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 2000,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.SlowDuration 取索引1至3，原值2秒转毫秒。',
        sortOrder: 80,
      },
      {
        parameterKey: 'max_distance',
        name: '小鱼最大飞行距离',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 1300,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.MaxDistance 取索引1至3。飞行距离本身不是伤害默认最大。',
        sortOrder: 90,
      },
      {
        parameterKey: 'small_fish_radius',
        name: '小鲨鱼范围半径',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 200,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.SmallFishSize 取索引1至3。',
        sortOrder: 120,
      },
      {
        parameterKey: 'mid_fish_radius',
        name: '中鲨鱼范围半径',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 325,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.MidFishSize 取索引1至3。',
        sortOrder: 130,
      },
      {
        parameterKey: 'big_fish_radius',
        name: '大鲨鱼范围半径',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 450,
        levelValues: null,
        description: '客户端当前根绑定 DataValues.BigFishSize 取索引1至3。',
        sortOrder: 140,
      },
    ],
    formulas: [
      {
        formulaKey: 'small_shark_damage',
        name: '小鲨鱼魔法伤害',
        expression: add(P('small_base_damage'), mul(P('small_ap_ratio'), sourceAp())),
        description: 'SmallSharkDamage = SmallDamage + SmallAPRatio×来源总法强。短距分支，不是最大。',
        sortOrder: 10,
      },
      {
        formulaKey: 'mid_shark_damage',
        name: '中鲨鱼魔法伤害',
        expression: mul(P('mid_damage_multiplier'), add(P('small_base_damage'), mul(P('small_ap_ratio'), sourceAp()))),
        description: '匿名 {262c3c02} = MidDamageMulti × SmallSharkDamage。中距分支单独核对。',
        sortOrder: 20,
      },
      {
        formulaKey: 'big_shark_damage',
        name: '大鲨鱼魔法伤害',
        expression: mul(P('large_damage_multiplier'), add(P('small_base_damage'), mul(P('small_ap_ratio'), sourceAp()))),
        description: 'BigSharkDamage = LargeDamageMulti × SmallSharkDamage。长距分支；上限倍率在表达式内，不冒充飞行距离插值函数。',
        sortOrder: 30,
      },
    ],
    effects: [manaEffect()],
    ...emptyWriteTail,
  },
  pending: [
    { kind: '分支', item: '飞行距离选择', reason: '当前树只有小/中/大三个端点，没有最短到最长的插值。距离为外供，无默认最大。' },
    { kind: '减速', item: '40%到80%', reason: '当前正文按位移距离40%到80%；根 SlowAmount 全级60，不能把60当作最小、最大或中距。' },
    { kind: '事件', item: '吸附/引爆/击飞', reason: '鲨鱼是本技能效果不是独立召唤；事件未接线。击飞1秒只在正文，无 DataValues。' },
  ],
  excluded: [
    { kind: '纯视野', item: '真实视野', reason: '当前正文 keywordStealth 真实视野，1v1 跳过纯视野。' },
    { kind: '第三人', item: '击退其它单位', reason: '带着鱼的唯一敌人可吃范围伤害；击退其它单位超出 1v1。' },
  ],
  reusedPublicParameters: ['cooldown_ms', 'mana_cost'],
};

function writeBody(kind, item) {
  if (kind === 'parameters') return apiParam(item);
  if (kind === 'formulas') {
    return {
      formulaKey: item.formulaKey,
      name: item.name,
      expression: item.expression,
      description: item.description,
      sortOrder: item.sortOrder,
    };
  }
  if (kind === 'effects') {
    return {
      effectKey: item.effectKey,
      name: item.name,
      description: item.description,
      sortOrder: item.sortOrder,
      lifecycle: item.lifecycle,
      results: item.results,
    };
  }
  throw Error(kind);
}

const postIntents = [];
const skillOrder = ['ekko_p', 'ekko_q', 'ekko_w', 'ekko_e', 'ekko_r', 'fizz_p', 'fizz_q', 'fizz_w', 'fizz_e', 'fizz_r'];
const reusedSet = new Set(reusedPublicParameters.map(item => `${item.skillKey}:${item.parameterKey}`));
for (const skillKey of skillOrder) {
  const skill = skills[skillKey];
  for (const item of skill.write.parameters) {
    if (reusedSet.has(`${skillKey}:${item.parameterKey}`)) continue;
    postIntents.push({
      method: 'POST',
      route: `/skills/${skillKey}/parameters`,
      skillKey,
      kind: 'parameters',
      stableKey: item.parameterKey,
      status: '仅意图，未调用',
      body: writeBody('parameters', item),
    });
  }
  for (const item of skill.write.formulas) {
    postIntents.push({
      method: 'POST',
      route: `/skills/${skillKey}/formulas`,
      skillKey,
      kind: 'formulas',
      stableKey: item.formulaKey,
      status: '仅意图，未调用',
      body: writeBody('formulas', item),
    });
  }
  for (const item of skill.write.effects) {
    postIntents.push({
      method: 'POST',
      route: `/skills/${skillKey}/effects`,
      skillKey,
      kind: 'effects',
      stableKey: item.effectKey,
      status: '仅意图，未调用',
      body: writeBody('effects', item),
    });
  }
}

const generatedAt = new Date().toISOString();
const candidate = {
  meta: {
    executor: '第二十一批 Cursor 候选代理；只读来源与静态候选，未业务写入',
    gameId: 'lol',
    batch: '第二十一批艾克与菲兹',
    clientVersion: '16.17',
    officialVersion: '16.17.1',
    snapshotSha256: SNAPSHOT_SHA,
    bindingSha256: BINDING_SHA,
    generatedAt,
    apiWrites: 0,
    note: '完整候选以 skills[skillKey].write 记录十槽最终组成。15个已有公共参数按冻结实值列入 write 并单独列入 reusedPublicParameters。只生成其余缺项的 POST 意图。候选和数学核算都不是已录入。',
  },
  reusedPublicParameters,
  skills,
  postIntents,
};

const locKeysUsed = {};
const locTextsUsed = {};
for (const skillKey of skillOrder) {
  locKeysUsed[skillKey] = skills[skillKey].source.mLocKeys;
  locTextsUsed[skillKey] = Object.fromEntries(Object.entries(skills[skillKey].source.currentTexts).map(([k, v]) => [k, v.text]));
}

const scope = {
  generatedAt,
  snapshotSha256: SNAPSHOT_SHA,
  bindingSha256: BINDING_SHA,
  versions: {
    client: '16.17',
    official: '16.17.1',
    content: ['Characters/Ekko/CharacterRecords/Root', 'Characters/Fizz/CharacterRecords/Root'],
  },
  bindings: {
    ekko: heroOf('Ekko').rootBindings,
    fizz: heroOf('Fizz').rootBindings,
  },
  locKeysUsed,
  locTextsUsed,
  scope: {
    combat: '1v1 唯一敌人',
    keep: ['唯一敌人可承受的范围伤害', '同目标多次命中', '自身收益', '战前叠层次数'],
    skip: ['金币经验', '纯视野', '纯碰撞', '第三友军', '兵野专用伤害治疗', '独立可操控或自主作战召唤物', '完整替换形态'],
    imagesAndSharks: '艾克布置影像与菲兹鲨鱼视为本技能效果，不自动当独立召唤；不明确处留缺口。',
    fizzR: '小/中/大鲨鱼各自按当前树核对，不默认最大。',
    ekkoR: '历史位置与实际过去受伤量无默认外供，不伪造回溯事件。',
    writes: '禁止更新主体、旧参数、角色关系或图片。',
  },
  attributePolicy: {
    owners: ['SOURCE', 'TARGET'],
    valueKinds: ['TOTAL', 'BASE', 'BONUS'],
    used: {
      omittedStatByCoefficientOrNamed: '来源总法强',
      explicitMStat2OmittedFormula: '来源总攻击力',
      rejected: ['CURRENT', 'mStat=15 未证'],
    },
  },
  clientFiles: {
    ekko: { path: '参考资料/客户端原文/Ekko.json.gz', compressedSha256: EKKO_GZ_SHA },
    fizz: { path: '参考资料/客户端原文/Fizz.json.gz', compressedSha256: FIZZ_GZ_SHA },
  },
  officialCheck: {
    ekkoQOutgoingMismatch: {
      officialEffect1: ekkoOfficial.data.Ekko.spells[0].effect[1],
      clientOutgoingIndex1to5: intRanks(ekkoQDv.OutgoingDamage, 5),
      policy: '正文与计算树用当前客户端 DataValues，不用官方旧 effect 数组覆盖。',
    },
    fizzECooldown: {
      official: fizzOfficial.data.Fizz.spells[2].cooldown,
      clientIndex1to5: [fizzEClient.mSpell.cooldownTime[1], fizzEClient.mSpell.cooldownTime[2], fizzEClient.mSpell.cooldownTime[3], fizzEClient.mSpell.cooldownTime[4], fizzEClient.mSpell.cooldownTime[5]],
    },
  },
};

const candidateFile = writeJson('完整候选.json', candidate);
const planFile = writeJson('按顺序缺项POST意图计划.json', {
  generatedAt,
  note: '只含缺项 POST。已有15个公共参数完整复用，不发更新或重建。status 均为仅意图，未调用。',
  apiWrites: 0,
  order: skillOrder,
  count: postIntents.length,
  intents: postIntents,
});
const scopeFile = writeJson('来源与范围.json', scope);

const version = {
  generatedAt,
  batch: '第二十一批艾克与菲兹',
  clientVersion: '16.17',
  officialVersion: '16.17.1',
  snapshotSha256: SNAPSHOT_SHA,
  bindingSha256: BINDING_SHA,
  files: {
    '完整候选.json': candidateFile,
    '按顺序缺项POST意图计划.json': planFile,
    '来源与范围.json': scopeFile,
  },
  reusedPublicParameters: reusedPublicParameters.length,
  postIntents: postIntents.length,
  formulaCount: skillOrder.reduce((n, key) => n + skills[key].write.formulas.length, 0),
  apiWrites: 0,
  note: '哈希在独立核算后重算。数学核算解析 write 表达式树并用根绑定源值独立求期望，不是手写与答案相同的数字。候选不是已录入。',
};
writeJson('候选版本.json', version);

if (EKKO_GZ_SHA !== 'e50f8ab582c64f907e11794984e71739696c30488a36226c88e3d3e19b3b50bc') throw Error('Ekko.gz 散列不符');
if (FIZZ_GZ_SHA !== '64b63f2a474a6831e5e2790f84153ebe46f2ae7967ee2907514eb97c3873b84b') throw Error('Fizz.gz 散列不符');
if (JSON.stringify(candidate.postIntents).includes('"DAMAGE"')) throw Error('禁止 DAMAGE');
if (JSON.stringify(candidate.postIntents).includes('DIRECT_HEAL')) throw Error('禁止 DIRECT_HEAL');
if (JSON.stringify(candidate.postIntents).includes('MOMENT_EVALUATION')) throw Error('禁止 MOMENT_EVALUATION');
if (candidate.postIntents.some(item => ['processes', 'internal-states', 'trigger-rules'].includes(item.kind))) throw Error('禁止过程状态触发');
if (candidate.postIntents.some(item => reusedSet.has(`${item.skillKey}:${item.stableKey}`))) throw Error('POST 含复用公共参数');
if (Object.values(skills).some(skill => JSON.stringify(skill.write.parameters).includes('"reuse"'))) throw Error('write 含 reuse 记账');

console.log(JSON.stringify({
  generatedAt,
  snapshotSha256: SNAPSHOT_SHA,
  formulas: version.formulaCount,
  postIntents: postIntents.length,
  reused: reusedPublicParameters.length,
}, null, 2));
