import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = here;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const writeJson = (name, value) => {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(path.join(outDir, name), text);
  return { bytes: Buffer.byteLength(text), sha256: sha256(text) };
};

const binding = readJson(path.join(root, '来源绑定与当前mLocKeys.json'));
const snapshot = readJson(path.join(root, '参考资料', '当前10槽保护快照.json'));
const composition = readJson(path.join(root, '参考资料', '现状组成报告.json'));
const inputVersion = readJson(path.join(root, '输入版本.json'));
const zoeOfficial = readJson(path.join(root, '参考资料', '官方原始资料', 'zh_CN', 'Zoe.json'));
const zoeHero = binding.heroes.find(item => item.id === 'Zoe');
const luxHero = binding.heroes.find(item => item.id === 'Lux');
const zoeSpell = slot => zoeHero.skills.find(item => item.slot === slot);
const snapshotGet = route => snapshot.requests.find(item => item.route === route && item.method === 'GET');

const SNAPSHOT_SHA = 'e7aaac29e37ad539300a538c8385e392d0d62dc97178654a4832a54a62e12b7e';
if (composition.sourceSha256 !== SNAPSHOT_SHA) throw Error('现状组成报告与冻结快照摘要不一致');

function add(...operands) {
  return operands.reduce((left, right) => ({ nodeType: 'OPERATION', operation: 'ADD', operands: [left, right] }));
}
function mul(left, right) {
  return { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [left, right] };
}
function param(parameterKey) {
  return { nodeType: 'PARAMETER', parameterKey };
}
function sourceTotalAp() {
  return {
    nodeType: 'ATTRIBUTE',
    attributeOwner: 'SOURCE',
    attributeKey: 'ability_power',
    attributeValueKind: 'TOTAL',
  };
}

const manaCostEffect = {
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

const reusedPublicParameters = [
  {
    skillKey: 'zoe_q',
    parameterKey: 'cooldown_ms',
    route: '/skills/zoe_q/parameters/cooldown_ms',
    action: '完整复用冻结实值，不发更新或重建',
    value: snapshotGet('/skills/zoe_q/parameters').data.find(item => item.parameterKey === 'cooldown_ms'),
  },
  {
    skillKey: 'zoe_q',
    parameterKey: 'mana_cost',
    route: '/skills/zoe_q/parameters/mana_cost',
    action: '完整复用冻结实值，不发更新或重建',
    value: snapshotGet('/skills/zoe_q/parameters').data.find(item => item.parameterKey === 'mana_cost'),
  },
  {
    skillKey: 'zoe_e',
    parameterKey: 'cooldown_ms',
    route: '/skills/zoe_e/parameters/cooldown_ms',
    action: '完整复用冻结实值，不发更新或重建',
    value: snapshotGet('/skills/zoe_e/parameters').data.find(item => item.parameterKey === 'cooldown_ms'),
  },
  {
    skillKey: 'zoe_e',
    parameterKey: 'mana_cost',
    route: '/skills/zoe_e/parameters/mana_cost',
    action: '完整复用冻结实值，不发更新或重建',
    value: snapshotGet('/skills/zoe_e/parameters').data.find(item => item.parameterKey === 'mana_cost'),
  },
  {
    skillKey: 'zoe_r',
    parameterKey: 'cooldown_ms',
    route: '/skills/zoe_r/parameters/cooldown_ms',
    action: '完整复用冻结实值，不发更新或重建',
    value: snapshotGet('/skills/zoe_r/parameters').data.find(item => item.parameterKey === 'cooldown_ms'),
  },
  {
    skillKey: 'zoe_r',
    parameterKey: 'mana_cost',
    route: '/skills/zoe_r/parameters/mana_cost',
    action: '完整复用冻结实值，不发更新或重建',
    value: snapshotGet('/skills/zoe_r/parameters').data.find(item => item.parameterKey === 'mana_cost'),
  },
];

function publicWrite(item) {
  const value = item.value;
  return {
    parameterKey: value.parameterKey,
    name: value.name,
    valueType: value.valueType,
    valueMode: value.valueMode,
    fixedValue: value.fixedValue,
    levelValues: value.levelValues,
    description: value.description,
    sortOrder: value.sortOrder,
    reuse: true,
  };
}

const qPublicCooldown = publicWrite(reusedPublicParameters[0]);
const qPublicMana = publicWrite(reusedPublicParameters[1]);
const ePublicCooldown = publicWrite(reusedPublicParameters[2]);
const ePublicMana = publicWrite(reusedPublicParameters[3]);
const rPublicCooldown = publicWrite(reusedPublicParameters[4]);
const rPublicMana = publicWrite(reusedPublicParameters[5]);

const skills = {
  zoe_p: {
    skillKey: 'zoe_p',
    slot: 'P',
    classification: '尚无组成',
    write: {
      parameters: [
        {
          parameterKey: 'char_level_base_damage',
          name: '角色等级基础魔法伤害（实际值外供）',
          valueType: 'DECIMAL',
          valueMode: 'RUNTIME_INPUT',
          fixedValue: null,
          levelValues: null,
          description: '来源 Characters/Zoe/Spells/ZoePassiveAbility/ZoePassive 的 PassiveDamage.ByCharLevelBreakpointsCalculationPart。当前包只证明 mLevel1Value=16、mInitialBonusPerLevel=4 及 7/12/15 级斜率字段，求值循环与断点当级计入时点未证，不把 1 至 18 级曲线猜展开，也不默认 0。',
          sortOrder: 10,
          unit: '点',
          levelSemantics: '角色等级断点，外供实际已求值结果；不是技能等级',
          sourcePath: 'Characters/Zoe/Spells/ZoePassiveAbility/ZoePassive.mSpellCalculations.PassiveDamage.mFormulaParts[0]',
          pendingNote: '缺独立求值器证明前，不能把断点字段写成 CHARACTER_LEVEL 表。',
        },
        {
          parameterKey: 'ap_ratio',
          name: '法术强度倍率',
          valueType: 'DECIMAL',
          valueMode: 'FIXED',
          fixedValue: 0.2,
          levelValues: null,
          description: '客户端当前根绑定 DataValues.APRatio 原始 0.20000000298023224，按设计值归一为 0.2。PassiveDamage 的 StatByNamedDataValueCalculationPart 省略 mStat/mStatFormula，按同版本窄口径映射来源总法强。',
          sortOrder: 20,
          unit: '倍率，1=100%',
          levelSemantics: '固定，与被动 1 级上限无关',
          sourcePath: 'Characters/Zoe/Spells/ZoePassiveAbility/ZoePassive.DataValues.APRatio',
          pendingNote: '未接线强化普攻触发，公式只表达数值。',
        },
      ],
      formulas: [
        {
          formulaKey: 'damage',
          name: '烟火四射额外魔法伤害',
          expression: add(param('char_level_base_damage'), mul(param('ap_ratio'), sourceTotalAp())),
          description: 'PassiveDamage = 角色等级断点外供值 + APRatio×来源总法强。不把施放技能后的下次普攻写成已有运行事件。',
          sortOrder: 10,
        },
      ],
      effects: [],
      processes: [],
      internalStates: [],
      triggerRules: [],
    },
    unknownInputs: ['char_level_base_damage', 'SOURCE:ability_power:TOTAL'],
    pending: [
      '被动触发、强化普攻命中时点与目标资格未证，不创建效果、过程或触发规则。',
      'WPickupDurationMinion/Champion 挂在被动根对象，但当前被动正文未绑定，不写入本槽。',
    ],
  },
  zoe_q: {
    skillKey: 'zoe_q',
    slot: 'Q',
    classification: '仅已有公共参数',
    write: {
      parameters: [
        qPublicCooldown,
        qPublicMana,
        {
          parameterKey: 'base_damage',
          name: '基础魔法伤害',
          valueType: 'INTEGER',
          valueMode: 'SKILL_LEVEL',
          fixedValue: null,
          levelValues: { 1: 50, 2: 80, 3: 110, 4: 140, 5: 170 },
          description: '客户端当前根绑定 DataValues.BaseDamage 取索引 1 至 5，跳过 rank0=20。',
          sortOrder: 10,
          unit: '点',
          levelSemantics: '技能等级 1 至 5，对应 DataValues 索引 1 至 5',
          sourcePath: 'Characters/Zoe/Spells/ZoeQAbility/ZoeQ.DataValues.BaseDamage',
          pendingNote: '实际命中对象与弹道资格未接线。',
        },
        {
          parameterKey: 'char_level_bonus_damage',
          name: '角色等级附加魔法伤害（实际值外供）',
          valueType: 'DECIMAL',
          valueMode: 'RUNTIME_INPUT',
          fixedValue: null,
          levelValues: null,
          description: 'TotalDamageTooltip 第二项 ByCharLevelBreakpointsCalculationPart：mLevel1Value=2、mInitialBonusPerLevel=2，断点 10 级斜率 3、14 级斜率 4。求值循环未证，不展开 1 至 18 级，不默认 0。',
          sortOrder: 20,
          unit: '点',
          levelSemantics: '角色等级断点外供，不是技能等级',
          sourcePath: 'Characters/Zoe/Spells/ZoeQAbility/ZoeQ.mSpellCalculations.TotalDamageTooltip.mFormulaParts[1]',
          pendingNote: '飞行距离插值未出现在当前根计算树，不能用该断点冒充距离增伤。',
        },
        {
          parameterKey: 'ap_ratio',
          name: '法术强度倍率',
          valueType: 'DECIMAL',
          valueMode: 'FIXED',
          fixedValue: 0.6,
          levelValues: null,
          description: '客户端当前根绑定 DataValues.APRatio 原始 0.6000000238418579，按设计值归一为 0.6。StatByNamedDataValue 省略统计选择器，按窄口径映射来源总法强。',
          sortOrder: 30,
          unit: '倍率，1=100%',
          levelSemantics: '固定',
          sourcePath: 'Characters/Zoe/Spells/ZoeQAbility/ZoeQ.DataValues.APRatio',
          pendingNote: '仅进入提示伤害树，不表示弹体已命中。',
        },
        {
          parameterKey: 'distance_damage_cap_multiplier',
          name: '飞行距离伤害上限倍率',
          valueType: 'DECIMAL',
          valueMode: 'FIXED',
          fixedValue: 2.5,
          levelValues: null,
          description: 'MaxDamageTooltip 为 GameCalculationModified，mModifiedGameCalculation=TotalDamageTooltip，mMultiplier.mNumber=2.5。上限写进公式，不只写在说明。',
          sortOrder: 40,
          unit: '倍率',
          levelSemantics: '固定',
          sourcePath: 'Characters/Zoe/Spells/ZoeQAbility/ZoeQ.mSpellCalculations.MaxDamageTooltip.mMultiplier',
          pendingNote: '最短到最长之间的距离插值、飞行距离输入和再导向事件仍待补。',
        },
        {
          parameterKey: 'cast_time_ms',
          name: '施法时间（毫秒）',
          valueType: 'INTEGER',
          valueMode: 'FIXED',
          fixedValue: 250,
          levelValues: null,
          description: '当前根 spellCastTime=0.25 秒，按毫秒保存。只保存根字段，不表示命中发生在施法结束。',
          sortOrder: 50,
          unit: '毫秒',
          levelSemantics: '固定',
          sourcePath: 'Characters/Zoe/Spells/ZoeQAbility/ZoeQ.spellCastTime',
          pendingNote: '再施放转向没有统一已证技能事件，不创建过程。',
        },
      ],
      formulas: [
        {
          formulaKey: 'damage',
          name: '飞星最短提示魔法伤害',
          expression: add(param('base_damage'), param('char_level_bonus_damage'), mul(param('ap_ratio'), sourceTotalAp())),
          description: 'TotalDamageTooltip = BaseDamage + 角色等级断点外供值 + APRatio×来源总法强。对应正文最短伤害，不是已飞行距离后的实伤。',
          sortOrder: 10,
        },
        {
          formulaKey: 'max_damage',
          name: '飞星最长提示魔法伤害上限',
          expression: mul(param('distance_damage_cap_multiplier'), add(param('base_damage'), param('char_level_bonus_damage'), mul(param('ap_ratio'), sourceTotalAp()))),
          description: 'MaxDamageTooltip = 2.5 × TotalDamageTooltip。2.5 在表达式内，作为当前根绑定给出的距离增伤上限。',
          sortOrder: 20,
        },
      ],
      effects: [manaCostEffect],
      processes: [],
      internalStates: [],
      triggerRules: [],
    },
    unknownInputs: ['char_level_bonus_damage', 'SOURCE:ability_power:TOTAL', '飞行距离', '再施放转向事件'],
    pending: [
      '飞行距离未给默认值；根计算树只有最短与 2.5 倍上限，没有插值函数。',
      '再次施放重新导向不能写成已有运行事件。',
      'MinionDamageMod=1 与 UnnamedEffectAmount1 当前无正文绑定，不写入。',
    ],
  },
  zoe_w: {
    skillKey: 'zoe_w',
    slot: 'W',
    classification: '尚无组成',
    write: {
      parameters: [
        {
          parameterKey: 'cooldown_ms',
          name: '基础冷却时间（毫秒）',
          valueType: 'INTEGER',
          valueMode: 'FIXED',
          fixedValue: 250,
          levelValues: null,
          description: 'DDragon16.17.1 Zoe.spells[1].cooldown 与客户端根 cooldownTime 均为 0.25 秒，转换为毫秒。官方资源为无消耗。仅基础间隔，拾取后替代技能的实际起算时点另配。',
          sortOrder: 10,
          unit: '毫秒',
          levelSemantics: '固定，技能 1 至 5 级相同',
          sourcePath: 'Characters/Zoe/Spells/ZoeWAbility/ZoeW.cooldownTime 与官方 ZoeW.cooldown',
          pendingNote: '该值不是已证的拾取替代技能事件，也不能借用召唤师技能冷却。',
        },
        {
          parameterKey: 'missile_base_damage',
          name: '单颗飞弹基础魔法伤害',
          valueType: 'INTEGER',
          valueMode: 'SKILL_LEVEL',
          fixedValue: null,
          levelValues: { 1: 15, 2: 25, 3: 35, 4: 45, 5: 55 },
          description: '客户端当前根绑定 DataValues.TotalBaseDamage 取索引 1 至 5，跳过 rank0=5。MissileDamageTooltip 按单颗计算，不把官方升级提示的 ×3 写进本公式。',
          sortOrder: 20,
          unit: '点',
          levelSemantics: '技能等级 1 至 5，对应 DataValues 索引 1 至 5',
          sourcePath: 'Characters/Zoe/Spells/ZoeWAbility/ZoeW.DataValues.TotalBaseDamage',
          pendingNote: '三颗飞弹的发射、寻的和命中事件未证。',
        },
        {
          parameterKey: 'ap_ratio',
          name: '单颗飞弹法术强度倍率',
          valueType: 'DECIMAL',
          valueMode: 'FIXED',
          fixedValue: 0.1,
          levelValues: null,
          description: '客户端当前根绑定 DataValues.TotalAPRatio 原始 0.10000000149011612，按设计值归一为 0.1。StatByNamedDataValue 省略统计选择器，按窄口径映射来源总法强。',
          sortOrder: 30,
          unit: '倍率，1=100%',
          levelSemantics: '固定',
          sourcePath: 'Characters/Zoe/Spells/ZoeWAbility/ZoeW.DataValues.TotalAPRatio',
          pendingNote: '只进入单颗飞弹提示伤害，不创建 DAMAGE 结果。',
        },
        {
          parameterKey: 'missile_count',
          name: '飞弹数量',
          valueType: 'INTEGER',
          valueMode: 'FIXED',
          fixedValue: 3,
          levelValues: null,
          description: '当前根 mLocKeys 正文与官方说明均写 3 颗/3 个飞弹。层数为实际层数，用 INTEGER。不把 3 乘进 MissileDamageTooltip。',
          sortOrder: 40,
          unit: '个',
          levelSemantics: '固定',
          sourcePath: '来源绑定 zoe_w.currentLocTexts.keyTooltip / 官方 ZoeW.description',
          pendingNote: '数量只作静态记录，发射过程未证。',
        },
        {
          parameterKey: 'movement_speed_ratio',
          name: '移动速度加成比例',
          valueType: 'DECIMAL',
          valueMode: 'SKILL_LEVEL',
          fixedValue: null,
          levelValues: { 1: 0.3, 2: 0.4, 3: 0.5, 4: 0.6, 5: 0.7 },
          description: '客户端当前根绑定 DataValues.MovementSpeed 取索引 1 至 5；正文 @MovementSpeed*100@%，来源已是 0 至 1 比例，不再乘 0.01。',
          sortOrder: 50,
          unit: '比例，1=100%',
          levelSemantics: '技能等级 1 至 5，对应 DataValues 索引 1 至 5',
          sourcePath: 'Characters/Zoe/Spells/ZoeWAbility/ZoeW.DataValues.MovementSpeed',
          pendingNote: '移速效果、状态和施加时点未接线。MoveSpeedMod 仅 rank0 不同，正文绑定的是 MovementSpeed。',
        },
        {
          parameterKey: 'movement_speed_duration_ms',
          name: '移动速度持续（毫秒）',
          valueType: 'INTEGER',
          valueMode: 'SKILL_LEVEL',
          fixedValue: null,
          levelValues: { 1: 2000, 2: 2250, 3: 2500, 4: 2750, 5: 3000 },
          description: '客户端当前根绑定 DataValues.MSDuration 取索引 1 至 5；单位秒转毫秒。',
          sortOrder: 60,
          unit: '毫秒',
          levelSemantics: '技能等级 1 至 5，对应 DataValues 索引 1 至 5',
          sourcePath: 'Characters/Zoe/Spells/ZoeWAbility/ZoeW.DataValues.MSDuration',
          pendingNote: '持续效果过程未证。',
        },
      ],
      formulas: [
        {
          formulaKey: 'missile_damage',
          name: '窃法巧手单颗飞弹提示魔法伤害',
          expression: add(param('missile_base_damage'), mul(param('ap_ratio'), sourceTotalAp())),
          description: 'MissileDamageTooltip = TotalBaseDamage + TotalAPRatio×来源总法强。只表达单颗提示伤害，不创建飞弹命中事件或 DAMAGE 结果。',
          sortOrder: 10,
        },
      ],
      effects: [],
      processes: [],
      internalStates: [],
      triggerRules: [],
    },
    unknownInputs: ['SOURCE:ability_power:TOTAL', '拾取替代技能事件', '碎片掉落与目标资格'],
    pending: [
      '拾取替代技能部分没有统一已证的技能事件，必须保留为缺口，不能无限借用其他技能或召唤师技能事件。',
      '主动施放已拾取碎片、被动掉落、地上持续、召唤师技能同步飞弹均未写成运行事件。',
      'DurationOfSummonerCanCast=60 与 MoveSpeedMod/MoveSpeedDuration 未进入当前正文绑定，不写入。',
      '官方资源为无消耗，不创建法力 RESOURCE_CHANGE。',
    ],
  },
  zoe_e: {
    skillKey: 'zoe_e',
    slot: 'E',
    classification: '仅已有公共参数',
    write: {
      parameters: [
        ePublicCooldown,
        ePublicMana,
        {
          parameterKey: 'base_damage',
          name: '气泡基础魔法伤害',
          valueType: 'INTEGER',
          valueMode: 'SKILL_LEVEL',
          fixedValue: null,
          levelValues: { 1: 70, 2: 110, 3: 150, 4: 190, 5: 230 },
          description: '客户端当前根绑定 DataValues.BaseDamage 取索引 1 至 5，跳过 rank0=30；与官方 16.17.1 ZoeE.effect 第一组 70/110/150/190/230 一致。',
          sortOrder: 10,
          unit: '点',
          levelSemantics: '技能等级 1 至 5，对应 DataValues 索引 1 至 5',
          sourcePath: 'Characters/Zoe/Spells/ZoeEAbility/ZoeE.DataValues.BaseDamage',
          pendingNote: '气泡、陷阱命中与墙体延长未接线。',
        },
        {
          parameterKey: 'ap_ratio',
          name: '法术强度倍率',
          valueType: 'DECIMAL',
          valueMode: 'FIXED',
          fixedValue: 0.45,
          levelValues: null,
          description: 'TotalDamageTooltip 与 BreakDamageTooltip 均使用 StatByCoefficientCalculationPart mCoefficient=0.44999998807907104，归一为 0.45。无具名 APRatio 字段，省略 mStat 按窄口径映射来源总法强。',
          sortOrder: 20,
          unit: '倍率，1=100%',
          levelSemantics: '固定',
          sourcePath: 'Characters/Zoe/Spells/ZoeEAbility/ZoeE.mSpellCalculations.TotalDamageTooltip.mFormulaParts[1]',
          pendingNote: '唤醒真实伤害上限用同一系数，但不把双倍命中写成已有事件。',
        },
        {
          parameterKey: 'magic_resist_shred_ratio',
          name: '昏睡期魔法抗性降低比例',
          valueType: 'DECIMAL',
          valueMode: 'FIXED',
          fixedValue: 0.3,
          levelValues: null,
          description: '客户端当前根绑定 DataValues.PercentPen 原始 0.30000001192092896，按设计值归一为 0.3；正文 @PercentPen*100@%。只录比例，不创建抗性结果。',
          sortOrder: 30,
          unit: '比例，1=100%',
          levelSemantics: '固定',
          sourcePath: 'Characters/Zoe/Spells/ZoeEAbility/ZoeE.DataValues.PercentPen',
          pendingNote: '降低魔抗的状态过程未证。',
        },
        {
          parameterKey: 'cooldown_refresh_ratio',
          name: '命中英雄刷新冷却比例',
          valueType: 'DECIMAL',
          valueMode: 'SKILL_LEVEL',
          fixedValue: null,
          levelValues: { 1: 0.16, 2: 0.195, 3: 0.23, 4: 0.265, 5: 0.3 },
          description: '客户端当前根绑定 DataValues.CooldownRefresh 取索引 1 至 5；正文 @CooldownRefresh*100@%。来源已是比例，不乘 0.01。',
          sortOrder: 40,
          unit: '比例，1=100%',
          levelSemantics: '技能等级 1 至 5，对应 DataValues 索引 1 至 5',
          sourcePath: 'Characters/Zoe/Spells/ZoeEAbility/ZoeE.DataValues.CooldownRefresh',
          pendingNote: '刷新冷却的命中事件未证，不创建触发规则。',
        },
        {
          parameterKey: 'trap_duration_ms',
          name: '未命中陷阱持续（毫秒）',
          valueType: 'INTEGER',
          valueMode: 'FIXED',
          fixedValue: 5000,
          levelValues: null,
          description: '客户端当前根绑定 DataValues.TrapLife 取索引 1 至 5 均为 5 秒，按毫秒保存。',
          sortOrder: 50,
          unit: '毫秒',
          levelSemantics: '固定',
          sourcePath: 'Characters/Zoe/Spells/ZoeEAbility/ZoeE.DataValues.TrapLife',
          pendingNote: '陷阱实体与触发资格未证。',
        },
        {
          parameterKey: 'drowsy_slow_ratio',
          name: '困倦最大减速比例',
          valueType: 'DECIMAL',
          valueMode: 'SKILL_LEVEL',
          fixedValue: null,
          levelValues: { 1: 0.1, 2: 0.15, 3: 0.2, 4: 0.25, 5: 0.3 },
          description: '客户端当前根绑定 DataValues.DrowsySlow 取索引 1 至 5；扩展正文 @DrowsySlow*100@%。来源已是比例。',
          sortOrder: 60,
          unit: '比例，1=100%',
          levelSemantics: '技能等级 1 至 5，对应 DataValues 索引 1 至 5',
          sourcePath: 'Characters/Zoe/Spells/ZoeEAbility/ZoeE.DataValues.DrowsySlow',
          pendingNote: '困倦递增减速过程未证，只保留数据值。',
        },
        {
          parameterKey: 'drowsy_duration_ms',
          name: '困倦持续（毫秒）',
          valueType: 'INTEGER',
          valueMode: 'FIXED',
          fixedValue: 1400,
          levelValues: null,
          description: '客户端当前根绑定 DataValues.DrowsyDuration 原始 1.399999976158142 秒，按设计值 1.4 秒转毫秒。',
          sortOrder: 70,
          unit: '毫秒',
          levelSemantics: '固定',
          sourcePath: 'Characters/Zoe/Spells/ZoeEAbility/ZoeE.DataValues.DrowsyDuration',
          pendingNote: '困倦状态未创建。',
        },
        {
          parameterKey: 'sleep_duration_ms',
          name: '昏睡数据值持续（毫秒）',
          valueType: 'INTEGER',
          valueMode: 'FIXED',
          fixedValue: 2250,
          levelValues: null,
          description: '客户端当前根绑定 DataValues.SleepDuration=2.25 秒转毫秒。当前正文写“持续2秒”，与数据值不一致，本参数只保存根数据值，不把 2 秒或 2.25 秒写成已接线状态。',
          sortOrder: 80,
          unit: '毫秒',
          levelSemantics: '固定',
          sourcePath: 'Characters/Zoe/Spells/ZoeEAbility/ZoeE.DataValues.SleepDuration',
          pendingNote: '正文 2 秒与数据值 2.25 秒冲突，状态过程留缺口。',
        },
        {
          parameterKey: 'brittle_linger_ms',
          name: '易碎残留（毫秒）',
          valueType: 'INTEGER',
          valueMode: 'FIXED',
          fixedValue: 1000,
          levelValues: null,
          description: '客户端当前根绑定 DataValues.BrittleLinger=1 秒转毫秒。当前正文未直接绑定该占位符，只作为根数据值保存。',
          sortOrder: 90,
          unit: '毫秒',
          levelSemantics: '固定',
          sourcePath: 'Characters/Zoe/Spells/ZoeEAbility/ZoeE.DataValues.BrittleLinger',
          pendingNote: '易碎/唤醒窗口事件未证。',
        },
        {
          parameterKey: 'cast_time_ms',
          name: '施法时间（毫秒）',
          valueType: 'INTEGER',
          valueMode: 'FIXED',
          fixedValue: 300,
          levelValues: null,
          description: '当前根 spellCastTime=0，mCastTime=0.30000001192092896 秒，按 300 毫秒保存。只保存根字段。',
          sortOrder: 95,
          unit: '毫秒',
          levelSemantics: '固定',
          sourcePath: 'Characters/Zoe/Spells/ZoeEAbility/ZoeE.mCastTime',
          pendingNote: '不表示气泡在施法结束时命中。',
        },
      ],
      formulas: [
        {
          formulaKey: 'damage',
          name: '催眠气泡提示魔法伤害',
          expression: add(param('base_damage'), mul(param('ap_ratio'), sourceTotalAp())),
          description: 'TotalDamageTooltip = BaseDamage + 0.45×来源总法强。只表达气泡提示伤害，不创建 DAMAGE 结果或命中事件。',
          sortOrder: 10,
        },
        {
          formulaKey: 'wake_true_damage_cap',
          name: '惊醒额外真实伤害上限',
          expression: add(param('base_damage'), mul(param('ap_ratio'), sourceTotalAp())),
          description: 'BreakDamageTooltip 与气泡伤害同树：BaseDamage + 0.45×来源总法强。该公式结果本身就是正文上限值。双倍伤害的施加、MIN(来伤×2, 上限) 和睡眠唤醒事件都不在当前根计算树，不另造。',
          sortOrder: 20,
        },
      ],
      effects: [manaCostEffect],
      processes: [],
      internalStates: [],
      triggerRules: [],
    },
    unknownInputs: ['SOURCE:ability_power:TOTAL', '唤醒来伤', '目标资格', '困倦到昏睡时点'],
    pending: [
      '睡眠唤醒、双倍伤害应用不能写成已经存在的运行事件。',
      '正文“双倍伤害，最多造成 BreakDamageTooltip 真实伤害”没有对应 MIN 计算节点；上限只以 BreakDamageTooltip 公式结果保存。',
      '困倦、昏睡、魔抗降低、冷却刷新均无已证过程。',
    ],
  },
  zoe_r: {
    skillKey: 'zoe_r',
    slot: 'R',
    classification: '仅已有公共参数',
    write: {
      parameters: [
        rPublicCooldown,
        rPublicMana,
        {
          parameterKey: 'cast_time_ms',
          name: '施法时间（毫秒）',
          valueType: 'INTEGER',
          valueMode: 'FIXED',
          fixedValue: 250,
          levelValues: null,
          description: '当前根 spellCastTime=0，mCastTime=0.25 秒，按 250 毫秒保存。只保存根字段，不表示位移发生在施法结束。',
          sortOrder: 10,
          unit: '毫秒',
          levelSemantics: '固定，与大招 3 级无关',
          sourcePath: 'Characters/Zoe/Spells/ZoeRAbility/ZoeR.mCastTime',
          pendingNote: '位移与返回过程未证。',
        },
        {
          parameterKey: 'portal_duration_ms',
          name: '传送停留（毫秒）',
          valueType: 'INTEGER',
          valueMode: 'FIXED',
          fixedValue: 1000,
          levelValues: null,
          description: '当前根 DataValues 与 calculations 均为空。正文与官方说明均写传送到附近位置 1 秒后返回，按字面 1000 毫秒保存。不是具名数据值。',
          sortOrder: 20,
          unit: '毫秒',
          levelSemantics: '固定',
          sourcePath: '来源绑定 zoe_r.currentLocTexts.keyTooltip / 官方 ZoeR.description',
          pendingNote: '无法移动、可攻击和越墙视野均无已证状态过程；不造伤害或虚构触发。',
        },
      ],
      formulas: [],
      effects: [manaCostEffect],
      processes: [],
      internalStates: [],
      triggerRules: [],
    },
    unknownInputs: ['位移落点', '返回时点', '传送期间攻击/技能资格'],
    pending: [
      'R 主要是位移与返回。当前根没有伤害计算树，不创建伤害公式、DAMAGE 结果或触发规则。',
      '闪现、停留、返回没有已证过程。',
    ],
  },
};

function apiParameter(item) {
  const out = {
    parameterKey: item.parameterKey,
    name: item.name,
    valueType: item.valueType,
    valueMode: item.valueMode,
    fixedValue: item.fixedValue,
    levelValues: item.levelValues,
    description: item.description,
    sortOrder: item.sortOrder,
  };
  if (item.reuse) out.reuse = true;
  return out;
}

function writeForPost(skill) {
  return {
    parameters: skill.write.parameters.map(apiParameter),
    formulas: skill.write.formulas,
    effects: skill.write.effects,
    processes: skill.write.processes,
    internalStates: skill.write.internalStates,
    triggerRules: skill.write.triggerRules,
  };
}

const postIntents = [];
for (const skill of Object.values(skills)) {
  for (const item of skill.write.parameters) {
    if (item.reuse) continue;
    postIntents.push({
      method: 'POST',
      route: `/skills/${skill.skillKey}/parameters`,
      skillKey: skill.skillKey,
      kind: 'parameters',
      stableKey: item.parameterKey,
      status: '仅意图，未调用',
      body: apiParameter(item),
    });
  }
  for (const item of skill.write.formulas) {
    postIntents.push({
      method: 'POST',
      route: `/skills/${skill.skillKey}/formulas`,
      skillKey: skill.skillKey,
      kind: 'formulas',
      stableKey: item.formulaKey,
      status: '仅意图，未调用',
      body: item,
    });
  }
  for (const item of skill.write.effects) {
    postIntents.push({
      method: 'POST',
      route: `/skills/${skill.skillKey}/effects`,
      skillKey: skill.skillKey,
      kind: 'effects',
      stableKey: item.effectKey,
      status: '仅意图，未调用',
      body: item,
    });
  }
}

const luxWShield = snapshotGet('/skills/lux_w/effects/prismatic_shield').data;
const luxEDetonate = snapshotGet('/skills/lux_e/effects/singularity_detonate').data;
const luxWFormula = snapshotGet('/skills/lux_w/formulas/shield').data;
const luxEFormula = snapshotGet('/skills/lux_e/formulas/damage').data;

const candidate = {
  meta: {
    executor: '第十八批 Cursor 候选代理；只读来源与静态候选，未业务写入',
    gameId: 'lol',
    batch: '第十八批拉克丝与佐伊',
    clientVersion: '16.17',
    officialVersion: '16.17.1',
    snapshotSha256: SNAPSHOT_SHA,
    bindingSha256: inputVersion.bindingEvidence.sha256,
    generatedAt: new Date().toISOString(),
    apiWrites: 0,
    note: '完整候选以 skills[zoe_*].write 记录佐伊五槽最终组成。六个已有公共参数按冻结实值列入 write 并标记 reusedPublicParameters。只生成其余缺项的 POST 意图。不为拉克丝生成 write。候选和数学核算都不是已录入。',
  },
  luxProtection: {
    action: '排除，不重录，不生成 write',
    reason: '五个技能均已有非公共参数和/或公式、效果、过程、触发规则。W 自身护盾与 E 唯一敌方范围伤害只作为保护核对对象。',
    snapshotSha256: SNAPSHOT_SHA,
    skills: {
      lux_p: { classification: composition.heroDisposition.Lux.skills[0].classification, write: null },
      lux_q: { classification: composition.heroDisposition.Lux.skills[1].classification, write: null },
      lux_w: {
        classification: composition.heroDisposition.Lux.skills[2].classification,
        write: null,
        protectionCheck: {
          route: '/skills/lux_w/effects/prismatic_shield',
          effectKey: luxWShield.effectKey,
          name: luxWShield.name,
          resultType: luxWShield.results[0].resultType,
          target: luxWShield.results[0].target,
          instanceScope: luxWShield.lifecycle.instanceScope,
          formulaKey: luxWFormula.formulaKey,
          formulaName: luxWFormula.name,
          note: '冻结 GET：普通自我护盾，目标与实例范围均为施法者。本批不复制、覆盖或创建重复护盾组成。',
        },
      },
      lux_e: {
        classification: composition.heroDisposition.Lux.skills[3].classification,
        write: null,
        protectionCheck: {
          route: '/skills/lux_e/effects/singularity_detonate',
          effectKey: luxEDetonate.effectKey,
          name: luxEDetonate.name,
          resultType: luxEDetonate.results[0].resultType,
          target: luxEDetonate.results[0].target,
          formulaKey: luxEFormula.formulaKey,
          formulaName: luxEFormula.name,
          note: '冻结 GET：唯一敌方目标上的爆炸魔法伤害，作为范围伤害的 1v1 实录。本批不复制、覆盖或创建重复伤害组成。',
        },
      },
      lux_r: { classification: composition.heroDisposition.Lux.skills[4].classification, write: null },
    },
  },
  reusedPublicParameters: reusedPublicParameters.map(item => ({
    skillKey: item.skillKey,
    parameterKey: item.parameterKey,
    route: item.route,
    action: item.action,
    valueType: item.value.valueType,
    valueMode: item.value.valueMode,
    fixedValue: item.value.fixedValue,
    levelValues: item.value.levelValues,
    name: item.value.name,
    sortOrder: item.value.sortOrder,
    description: item.value.description,
  })),
  wPickupGap: {
    skillKey: 'zoe_w',
    status: '当前仍待补',
    statement: 'W 的拾取替代技能部分没有统一已证的技能事件，必须保留为缺口，不能无限借用其他技能或召唤师技能事件。',
    excluded: [
      '碎片掉落',
      '地上拾取',
      '一次性替代技能施放',
      '召唤师技能或主动装备事件转写',
      '飞弹寻的与命中运行事件',
    ],
  },
  skills: Object.fromEntries(Object.values(skills).map(skill => [skill.skillKey, {
    skillKey: skill.skillKey,
    slot: skill.slot,
    name: zoeSpell(skill.slot).name,
    binding: zoeSpell(skill.slot).binding,
    classification: skill.classification,
    currentLocKeys: zoeSpell(skill.slot).currentLocKeys,
    write: writeForPost(skill),
    parameterMeta: Object.fromEntries(skill.write.parameters.filter(item => !item.reuse).map(item => [item.parameterKey, {
      unit: item.unit,
      levelSemantics: item.levelSemantics,
      sourcePath: item.sourcePath,
      pendingNote: item.pendingNote,
    }])),
    unknownInputs: skill.unknownInputs,
    pending: skill.pending,
  }])),
  postIntents,
  forbiddenCreated: ['DAMAGE', 'DIRECT_HEAL', 'MOMENT_EVALUATION', 'processes', 'internalStates', 'triggerRules'],
  evidenceLayers: {
    sourceEvidence: '客户端 16.17 角色根绑定、官方 16.17.1、当前 mLocKeys',
    staticCandidate: '本文件 skills[zoe_*].write 与 postIntents',
    businessGet: '参考资料/当前10槽保护快照.json 的只读 GET，摘要 e7aaac29…',
    writesNotOccurred: '没有任何 POST/PUT/PATCH/DELETE，也未更新页面、数据库或战斗运行',
  },
};

const sourceScope = {
  generatedAt: candidate.meta.generatedAt,
  snapshotSha256: SNAPSHOT_SHA,
  versions: {
    client: '16.17',
    official: '16.17.1',
    content: zoeHero.rootPath,
  },
  bindings: {
    lux: luxHero.rootBindings,
    zoe: zoeHero.rootBindings,
  },
  locKeysUsed: Object.fromEntries(zoeHero.skills.map(skill => [skill.skillKey, skill.currentLocKeys])),
  locTextsUsed: Object.fromEntries(zoeHero.skills.map(skill => [skill.skillKey, Object.fromEntries(Object.entries(skill.currentLocTexts).map(([key, value]) => [key, value.text]))])),
  officialUsed: {
    version: zoeOfficial.version,
    spells: zoeOfficial.data.Zoe.spells.map(spell => ({
      id: spell.id,
      name: spell.name,
      cooldown: spell.cooldown,
      cost: spell.cost,
      resource: spell.resource,
    })),
    passive: zoeOfficial.data.Zoe.passive,
  },
  calculationTrees: Object.fromEntries(zoeHero.skills.map(skill => [skill.skillKey, {
    dataValues: skill.dataValues,
    calculations: skill.calculations,
    rootSpellFields: skill.rootSpellFields,
  }])),
  unusedOrPendingSource: {
    zoe_p: ['WPickupDurationMinion', 'WPickupDurationChampion'],
    zoe_q: ['MinionDamageMod', 'UnnamedEffectAmount1', '飞行距离插值', '再施放转向'],
    zoe_w: ['DurationOfSummonerCanCast', 'MoveSpeedMod', 'MoveSpeedDuration', '拾取替代技能事件'],
    zoe_e: ['双倍伤害应用', 'MIN(来伤×2, 上限) 计算节点不存在', '正文2秒与 SleepDuration=2.25 冲突'],
    zoe_r: ['空 DataValues', '空 calculations', '位移/返回过程'],
  },
  unknownInputs: Object.fromEntries(Object.values(skills).map(skill => [skill.skillKey, skill.unknownInputs])),
  luxExcluded: true,
  reusedPublicParameterCount: 6,
  postIntentCount: postIntents.length,
  layers: candidate.evidenceLayers,
};

function close(left, right, tolerance = 1e-6) {
  return Math.abs(Number(left) - Number(right)) <= tolerance;
}

function dataValue(spell, name) {
  const item = (spell.dataValues || []).find(entry => entry.name === name);
  if (!item) throw Error(`${spell.skillKey} 缺少 DataValues.${name}`);
  return item.values;
}

function skillSlice(values, maxRank) {
  return Object.fromEntries(Array.from({ length: maxRank }, (_, index) => [String(index + 1), values[index + 1]]));
}

function normalizeRatio(value) {
  return Number(value.toFixed(4));
}

function evaluate(node, ctx, missing) {
  if (!node || typeof node !== 'object') throw Error('非法节点');
  if (node.nodeType === 'PARAMETER') {
    if (!Object.hasOwn(ctx.parameters, node.parameterKey)) {
      missing.add(`PARAMETER:${node.parameterKey}`);
      return null;
    }
    const value = ctx.parameters[node.parameterKey];
    if (value == null || Number.isNaN(Number(value))) {
      missing.add(`PARAMETER:${node.parameterKey}`);
      return null;
    }
    return Number(value);
  }
  if (node.nodeType === 'ATTRIBUTE') {
    if (node.attributeOwner !== 'SOURCE' && node.attributeOwner !== 'TARGET') throw Error('非法 attributeOwner');
    if (!['TOTAL', 'BASE', 'BONUS'].includes(node.attributeValueKind)) throw Error('非法 attributeValueKind');
    if (node.attributeOwner === 'CURRENT') throw Error('禁止 CURRENT 作为 attributeOwner');
    const key = `${node.attributeOwner}:${node.attributeKey}:${node.attributeValueKind}`;
    if (!Object.hasOwn(ctx.attributes, key)) {
      missing.add(`ATTRIBUTE:${key}`);
      return null;
    }
    return Number(ctx.attributes[key]);
  }
  if (node.nodeType !== 'OPERATION') throw Error(`未知 nodeType ${node.nodeType}`);
  if (!Array.isArray(node.operands) || node.operands.length !== 2) throw Error('运算必须是二元');
  const left = evaluate(node.operands[0], ctx, missing);
  const right = evaluate(node.operands[1], ctx, missing);
  if (left == null || right == null) return null;
  if (node.operation === 'ADD') return left + right;
  if (node.operation === 'SUBTRACT') return left - right;
  if (node.operation === 'MULTIPLY') return left * right;
  if (node.operation === 'DIVIDE') {
    if (right === 0) throw Error('除数为 0');
    return left / right;
  }
  if (node.operation === 'MIN') return Math.min(left, right);
  if (node.operation === 'MAX') return Math.max(left, right);
  throw Error(`未知 operation ${node.operation}`);
}

function runCase(name, formula, ctx, expected, expectReject = false) {
  const missing = new Set();
  let actual = null;
  let error = null;
  try {
    actual = evaluate(formula.expression, ctx, missing);
  } catch (err) {
    error = String(err.message || err);
  }
  const rejected = actual == null || missing.size > 0 || error != null;
  const ok = expectReject
    ? rejected
    : !rejected && close(actual, expected);
  return {
    name,
    formulaKey: formula.formulaKey,
    ok,
    expectReject,
    expected: expectReject ? 'REJECT' : expected,
    actual: rejected ? 'REJECT' : actual,
    missing: [...missing],
    error,
    inputs: ctx,
  };
}

const qSpell = zoeSpell('Q');
const pSpell = zoeSpell('P');
const wSpell = zoeSpell('W');
const eSpell = zoeSpell('E');
const rSpell = zoeSpell('R');

const checks = [];
const record = (name, ok, detail = null) => {
  checks.push({ name, ok, detail });
};

record('快照摘要一致', composition.sourceSha256 === SNAPSHOT_SHA, composition.sourceSha256);
record('不为拉克丝生成 write', Object.keys(candidate.skills).every(key => key.startsWith('zoe_')) && candidate.luxProtection.action.includes('不生成 write'));
record('复用六个公共参数', candidate.reusedPublicParameters.length === 6);
record('POST 意图不含复用公共参数', postIntents.every(item => !(item.kind === 'parameters' && ['cooldown_ms', 'mana_cost'].includes(item.stableKey) && ['zoe_q', 'zoe_e', 'zoe_r'].includes(item.skillKey))));
record('禁止 DAMAGE/治疗/瞬时评估/过程/状态/触发', postIntents.every(item => {
  const raw = JSON.stringify(item.body);
  return item.kind !== 'processes' && item.kind !== 'internal-states' && item.kind !== 'trigger-rules'
    && !raw.includes('"DAMAGE"') && !raw.includes('DIRECT_HEAL') && !raw.includes('MOMENT_EVALUATION');
}));
record('属性节点主人仅 SOURCE/TARGET', !JSON.stringify(candidate.skills).includes('"attributeOwner": "CURRENT"'));

record('P APRatio 来源', close(dataValue(pSpell, 'APRatio')[1], 0.2));
record('Q BaseDamage 跳过 rank0', JSON.stringify(skillSlice(dataValue(qSpell, 'BaseDamage'), 5)) === JSON.stringify({ 1: 50, 2: 80, 3: 110, 4: 140, 5: 170 }));
record('Q APRatio 来源', close(dataValue(qSpell, 'APRatio')[1], 0.6));
record('Q 上限倍率来源', qSpell.calculations.MaxDamageTooltip.mMultiplier.mNumber === 2.5);
record('Q 冷却复用与官方/客户端一致', JSON.stringify(qPublicCooldown.levelValues) === JSON.stringify({ 1: 8500, 2: 8000, 3: 7500, 4: 7000, 5: 6500 }));
record('Q 法力复用与官方/客户端一致', JSON.stringify(qPublicMana.levelValues) === JSON.stringify({ 1: 40, 2: 45, 3: 50, 4: 55, 5: 60 }));
record('W TotalBaseDamage 跳过 rank0', JSON.stringify(skillSlice(dataValue(wSpell, 'TotalBaseDamage'), 5)) === JSON.stringify({ 1: 15, 2: 25, 3: 35, 4: 45, 5: 55 }));
record('W MovementSpeed 跳过 rank0', JSON.stringify(Object.fromEntries(Object.entries(skillSlice(dataValue(wSpell, 'MovementSpeed'), 5)).map(([k, v]) => [k, normalizeRatio(v)]))) === JSON.stringify({ 1: 0.3, 2: 0.4, 3: 0.5, 4: 0.6, 5: 0.7 }));
record('E BaseDamage 与官方 effect 第一组一致', JSON.stringify(skillSlice(dataValue(eSpell, 'BaseDamage'), 5)) === JSON.stringify({ 1: 70, 2: 110, 3: 150, 4: 190, 5: 230 }) && JSON.stringify(zoeOfficial.data.Zoe.spells[2].effect[1]) === JSON.stringify([70, 110, 150, 190, 230]));
record('E 系数来源', close(eSpell.calculations.TotalDamageTooltip.mFormulaParts[1].mCoefficient, 0.45));
record('E 法力三方一致', ePublicMana.fixedValue === 80 && eSpell.rootSpellFields.mana[0] === 80 && zoeOfficial.data.Zoe.spells[2].cost[0] === 80);
record('R 非法力伤害树', Object.keys(rSpell.calculations || {}).length === 0 && (rSpell.dataValues || []).length === 0);
record('R 法力三方一致', rPublicMana.fixedValue === 40 && rSpell.rootSpellFields.mana[0] === 40 && zoeOfficial.data.Zoe.spells[3].cost[0] === 40);
record('W 无消耗不造法力效果', skills.zoe_w.write.effects.length === 0 && zoeOfficial.data.Zoe.spells[1].resource === '无消耗');
record('拉克丝 W 自我护盾仍在', luxWShield.results[0].resultType === 'NORMAL_SHIELD' && luxWShield.results[0].target === 'SOURCE' && luxWShield.lifecycle.instanceScope === 'SOURCE');
record('拉克丝 E 唯一敌方伤害仍在', luxEDetonate.results[0].resultType === 'DAMAGE' && luxEDetonate.results[0].target === 'TARGET');

const formulaCases = [];
const pDamage = skills.zoe_p.write.formulas[0];
formulaCases.push(runCase('zoe_p/damage 正例 断点1级值16 法强100', pDamage, {
  parameters: { char_level_base_damage: pSpell.calculations.PassiveDamage.mFormulaParts[0].mLevel1Value, ap_ratio: 0.2 },
  attributes: { 'SOURCE:ability_power:TOTAL': 100 },
}, 16 + 0.2 * 100));
formulaCases.push(runCase('zoe_p/damage 不同来源 外供42 法强50', pDamage, {
  parameters: { char_level_base_damage: 42, ap_ratio: 0.2 },
  attributes: { 'SOURCE:ability_power:TOTAL': 50 },
}, 42 + 0.2 * 50));
formulaCases.push(runCase('zoe_p/damage 缺值拒绝 无法强', pDamage, {
  parameters: { char_level_base_damage: 16, ap_ratio: 0.2 },
  attributes: {},
}, null, true));
formulaCases.push(runCase('zoe_p/damage 缺值拒绝 无等级基础', pDamage, {
  parameters: { ap_ratio: 0.2 },
  attributes: { 'SOURCE:ability_power:TOTAL': 100 },
}, null, true));
formulaCases.push(runCase('zoe_p/damage 边界 法强0', pDamage, {
  parameters: { char_level_base_damage: 16, ap_ratio: 0.2 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, 16));

const qDamage = skills.zoe_q.write.formulas[0];
const qMax = skills.zoe_q.write.formulas[1];
const qLevel1Base = dataValue(qSpell, 'BaseDamage')[1];
const qLevel5Base = dataValue(qSpell, 'BaseDamage')[5];
const qLevel1Bonus = qSpell.calculations.TotalDamageTooltip.mFormulaParts[1].mLevel1Value;
formulaCases.push(runCase('zoe_q/damage 正例 1级基础+断点1级值+法强100', qDamage, {
  parameters: { base_damage: qLevel1Base, char_level_bonus_damage: qLevel1Bonus, ap_ratio: 0.6 },
  attributes: { 'SOURCE:ability_power:TOTAL': 100 },
}, qLevel1Base + qLevel1Bonus + 0.6 * 100));
formulaCases.push(runCase('zoe_q/damage 不同来源 5级基础 法强0 外供8', qDamage, {
  parameters: { base_damage: qLevel5Base, char_level_bonus_damage: 8, ap_ratio: 0.6 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, qLevel5Base + 8));
formulaCases.push(runCase('zoe_q/damage 缺值拒绝 无飞行无关的等级附加', qDamage, {
  parameters: { base_damage: qLevel1Base, ap_ratio: 0.6 },
  attributes: { 'SOURCE:ability_power:TOTAL': 100 },
}, null, true));
formulaCases.push(runCase('zoe_q/damage 边界 法强0 断点1级值', qDamage, {
  parameters: { base_damage: qLevel1Base, char_level_bonus_damage: qLevel1Bonus, ap_ratio: 0.6 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, qLevel1Base + qLevel1Bonus));

const qMinIndependent = qLevel1Base + qLevel1Bonus + 0.6 * 80;
const qCapIndependent = qSpell.calculations.MaxDamageTooltip.mMultiplier.mNumber * qMinIndependent;
formulaCases.push(runCase('zoe_q/max_damage 正例 上限=2.5×最短', qMax, {
  parameters: { base_damage: qLevel1Base, char_level_bonus_damage: qLevel1Bonus, ap_ratio: 0.6, distance_damage_cap_multiplier: 2.5 },
  attributes: { 'SOURCE:ability_power:TOTAL': 80 },
}, qCapIndependent));
formulaCases.push(runCase('zoe_q/max_damage 不同来源 5级 法强20 外供4', qMax, {
  parameters: { base_damage: qLevel5Base, char_level_bonus_damage: 4, ap_ratio: 0.6, distance_damage_cap_multiplier: 2.5 },
  attributes: { 'SOURCE:ability_power:TOTAL': 20 },
}, 2.5 * (qLevel5Base + 4 + 0.6 * 20)));
formulaCases.push(runCase('zoe_q/max_damage 缺值拒绝 无倍率', qMax, {
  parameters: { base_damage: qLevel1Base, char_level_bonus_damage: qLevel1Bonus, ap_ratio: 0.6 },
  attributes: { 'SOURCE:ability_power:TOTAL': 80 },
}, null, true));
formulaCases.push(runCase('zoe_q/max_damage 边界 法强0 仍保持2.5倍', qMax, {
  parameters: { base_damage: qLevel1Base, char_level_bonus_damage: qLevel1Bonus, ap_ratio: 0.6, distance_damage_cap_multiplier: 2.5 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, 2.5 * (qLevel1Base + qLevel1Bonus)));

const wDamage = skills.zoe_w.write.formulas[0];
const wLevel1 = dataValue(wSpell, 'TotalBaseDamage')[1];
const wLevel5 = dataValue(wSpell, 'TotalBaseDamage')[5];
formulaCases.push(runCase('zoe_w/missile_damage 正例 1级 法强100', wDamage, {
  parameters: { missile_base_damage: wLevel1, ap_ratio: 0.1 },
  attributes: { 'SOURCE:ability_power:TOTAL': 100 },
}, wLevel1 + 0.1 * 100));
formulaCases.push(runCase('zoe_w/missile_damage 不同来源 5级 法强0', wDamage, {
  parameters: { missile_base_damage: wLevel5, ap_ratio: 0.1 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, wLevel5));
formulaCases.push(runCase('zoe_w/missile_damage 缺值拒绝 无法强', wDamage, {
  parameters: { missile_base_damage: wLevel1, ap_ratio: 0.1 },
  attributes: {},
}, null, true));
formulaCases.push(runCase('zoe_w/missile_damage 边界 法强0', wDamage, {
  parameters: { missile_base_damage: wLevel1, ap_ratio: 0.1 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, wLevel1));

const eDamage = skills.zoe_e.write.formulas[0];
const eCap = skills.zoe_e.write.formulas[1];
const eLevel1 = dataValue(eSpell, 'BaseDamage')[1];
const eLevel5 = dataValue(eSpell, 'BaseDamage')[5];
const eCoef = Number(eSpell.calculations.BreakDamageTooltip.mFormulaParts[1].mCoefficient.toFixed(4));
formulaCases.push(runCase('zoe_e/damage 正例 1级 法强100', eDamage, {
  parameters: { base_damage: eLevel1, ap_ratio: 0.45 },
  attributes: { 'SOURCE:ability_power:TOTAL': 100 },
}, eLevel1 + eCoef * 100));
formulaCases.push(runCase('zoe_e/damage 不同来源 5级 法强40', eDamage, {
  parameters: { base_damage: eLevel5, ap_ratio: 0.45 },
  attributes: { 'SOURCE:ability_power:TOTAL': 40 },
}, eLevel5 + eCoef * 40));
formulaCases.push(runCase('zoe_e/damage 缺值拒绝 无基础', eDamage, {
  parameters: { ap_ratio: 0.45 },
  attributes: { 'SOURCE:ability_power:TOTAL': 100 },
}, null, true));
formulaCases.push(runCase('zoe_e/damage 边界 法强0', eDamage, {
  parameters: { base_damage: eLevel1, ap_ratio: 0.45 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, eLevel1));
formulaCases.push(runCase('zoe_e/wake_true_damage_cap 正例 与气泡同树', eCap, {
  parameters: { base_damage: eLevel1, ap_ratio: 0.45 },
  attributes: { 'SOURCE:ability_power:TOTAL': 100 },
}, eLevel1 + eCoef * 100));
formulaCases.push(runCase('zoe_e/wake_true_damage_cap 不同来源 5级 法强0', eCap, {
  parameters: { base_damage: eLevel5, ap_ratio: 0.45 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, eLevel5));
formulaCases.push(runCase('zoe_e/wake_true_damage_cap 缺值拒绝 无法强', eCap, {
  parameters: { base_damage: eLevel1, ap_ratio: 0.45 },
  attributes: {},
}, null, true));
formulaCases.push(runCase('zoe_e/wake_true_damage_cap 边界 上限即公式结果而非说明数字', eCap, {
  parameters: { base_damage: eLevel1, ap_ratio: 0.45 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, eLevel1));

const qMaxHasMultiplier = JSON.stringify(qMax.expression).includes('"parameterKey":"distance_damage_cap_multiplier"');
record('Q 上限写进表达式', qMaxHasMultiplier && qMax.expression.operation === 'MULTIPLY');
record('E 上限公式存在且无虚构 MIN', eCap.formulaKey === 'wake_true_damage_cap' && JSON.stringify(eCap.expression).includes('base_damage') && !JSON.stringify(eCap.expression).includes('"MIN"'));
record('未展开角色等级断点', skills.zoe_p.write.parameters[0].valueMode === 'RUNTIME_INPUT' && skills.zoe_q.write.parameters.find(item => item.parameterKey === 'char_level_bonus_damage').valueMode === 'RUNTIME_INPUT');

for (const item of formulaCases) record(item.name, item.ok, { expected: item.expected, actual: item.actual, missing: item.missing });

const failed = checks.filter(item => !item.ok);
const mathResult = {
  generatedAt: candidate.meta.generatedAt,
  script: '产物/生成候选与核算.mjs',
  independent: true,
  parsedWriteTrees: true,
  parsedSourceTrees: true,
  notHandCopied: true,
  apiWrites: 0,
  summary: {
    total: checks.length,
    passed: checks.filter(item => item.ok).length,
    failed: failed.length,
    formulaCases: formulaCases.length,
    postIntents: postIntents.length,
  },
  sourceAnchors: {
    pLevel1Breakpoint: pSpell.calculations.PassiveDamage.mFormulaParts[0].mLevel1Value,
    qLevel1Base,
    qLevel1Breakpoint: qLevel1Bonus,
    qCapMultiplier: qSpell.calculations.MaxDamageTooltip.mMultiplier.mNumber,
    wLevel1,
    eLevel1,
    eCoefficientRaw: eSpell.calculations.TotalDamageTooltip.mFormulaParts[1].mCoefficient,
  },
  formulaCases,
  checks,
  failed,
};

const candidateFile = writeJson('完整候选.json', candidate);
const sourceFile = writeJson('来源与范围.json', sourceScope);
const mathFile = writeJson('独立数学核算结果.json', mathResult);
const version = {
  generatedAt: candidate.meta.generatedAt,
  batch: '第十八批拉克丝与佐伊',
  clientVersion: '16.17',
  officialVersion: '16.17.1',
  snapshotSha256: SNAPSHOT_SHA,
  files: {
    '完整候选.json': candidateFile,
    '来源与范围.json': sourceFile,
    '独立数学核算结果.json': mathFile,
  },
  luxWrite: false,
  reusedPublicParameters: 6,
  postIntents: postIntents.length,
  formulaCount: Object.values(skills).reduce((sum, skill) => sum + skill.write.formulas.length, 0),
  mathPassed: failed.length === 0,
  apiWrites: 0,
  note: '哈希在写出后计算。数学核算解析 write 表达式树并用根绑定源值独立求期望，不是手写与答案相同的数字。',
};
writeJson('候选版本.json', version);

if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  throw Error(`数学核算失败 ${failed.length} 项`);
}

console.log(JSON.stringify({
  candidateSha256: candidateFile.sha256,
  sourceSha256: sourceFile.sha256,
  mathSha256: mathFile.sha256,
  postIntents: postIntents.length,
  checks: checks.length,
  formulaCases: formulaCases.length,
}, null, 2));
