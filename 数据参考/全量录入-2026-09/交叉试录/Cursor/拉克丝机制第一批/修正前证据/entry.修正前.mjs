import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

throw new Error('这是修正前冻结脚本，禁止重跑。请使用上一级 entry.mjs。');

const here = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = 'http://127.0.0.1:8080';
const GAME_ID = 'lol';
const TOKEN = 'local-entry';
const dumpOnly = process.argv.includes('--dump');

function lv(values) {
  const levelValues = {};
  values.forEach((value, index) => {
    levelValues[String(index + 1)] = value;
  });
  return levelValues;
}

function charLevels(values) {
  const levelValues = {};
  values.forEach((value, index) => {
    levelValues[String(index + 1)] = value;
  });
  return levelValues;
}

function apAdd(baseKey, ratioKey) {
  return {
    nodeType: 'OPERATION',
    operation: 'ADD',
    operands: [
      { nodeType: 'PARAMETER', parameterKey: baseKey },
      {
        nodeType: 'OPERATION',
        operation: 'MULTIPLY',
        operands: [
          { nodeType: 'PARAMETER', parameterKey: ratioKey },
          {
            nodeType: 'ATTRIBUTE',
            attributeOwner: 'SOURCE',
            attributeKey: 'ability_power',
            attributeValueKind: 'TOTAL'
          }
        ]
      }
    ]
  };
}

function param(body) {
  return body;
}

function magicHit(effectKey, name, description, formulaKey, sortOrder = 20) {
  return {
    effectKey,
    name,
    description,
    sortOrder,
    lifecycle: null,
    results: [
      {
        resultKey: 'magic_damage',
        name: '魔法伤害',
        resultType: 'DAMAGE',
        target: 'TARGET',
        description: null,
        sortOrder: 10,
        lifecycleBehavior: null,
        spellShieldBlockScope: 'RESULT',
        valueRule: {
          value: { kind: 'FORMULA', formulaKey },
          fixedMultiplier: 1,
          fixedMinValue: 0,
          fixedMaxValue: null
        },
        detail: {
          damageTypeKey: 'magic',
          deliveryKind: 'SKILL',
          originKind: 'DIRECT',
          critical: { mode: 'DISALLOWED', multiplierValue: null },
          vampRules: []
        }
      }
    ]
  };
}

function manaCost() {
  return {
    effectKey: 'mana_cost',
    name: '施放法力消耗',
    description: '施放时消耗对应技能等级的法力。',
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
          fixedMaxValue: null
        },
        detail: { attributeKey: 'mana', operation: 'CONSUME' }
      }
    ]
  };
}

function castProcess(name, description) {
  return {
    processKey: 'cast',
    name,
    activationType: 'ACTIVE',
    description,
    sortOrder: 10,
    cooldown: {
      durationValue: { kind: 'PARAMETER', parameterKey: 'cooldown_ms' },
      startMoment: { momentType: 'PROCESS_START', stepKey: null }
    },
    steps: [
      {
        stepKey: 'cast_time',
        name: '施法时间',
        description: '主技能 spellCastTime，按毫秒录入。',
        sortOrder: 10,
        stepType: 'DELAY',
        detail: { delayValue: { kind: 'PARAMETER', parameterKey: 'cast_time_ms' } }
      }
    ],
    effectBindings: [
      {
        bindingKey: 'mana_cost',
        effectKey: 'mana_cost',
        moment: { momentType: 'PROCESS_START', stepKey: null },
        sortOrder: 10
      }
    ],
    stateOperations: []
  };
}

function hitRule(ruleKey, name, description, skillKey, effectKey) {
  return {
    ruleKey,
    name,
    description,
    sortOrder: 10,
    eventSource: {
      eventType: 'SKILL_HIT',
      detail: { sourceSkillKey: skillKey }
    },
    conditionGroups: [],
    actions: [
      {
        actionKey: 'resolve_hit',
        name: '结算命中伤害',
        actionType: 'EXECUTE_EFFECT',
        sortOrder: 10,
        targetContext: 'CURRENT_TARGET',
        detail: { effectKey },
        runtimeInputBindings: [],
        resultModifiers: []
      }
    ],
    perTargetCooldown: null,
    maxTriggersPerProcess: null
  };
}

const pBaseDamage = [];
for (let level = 1; level <= 18; level += 1) {
  pBaseDamage.push(10 + 10 * level);
}

export const plan = {
  meta: {
    executor: 'Cursor',
    gameId: GAME_ID,
    exclusiveSkillKeys: ['lux_p', 'lux_q', 'lux_w', 'lux_e', 'lux_r'],
    sources: {
      client: 'CommunityDragon 16.17 客户端提取（社区提取，不称 Riot 官方 API）',
      ddragon: 'DDragon 16.17.1 中文英雄资料',
      note: '客户端与 DDragon 微版本不混称精确相同。mSpell 数组含 rank0，按有效等级与 DDragon 交叉后取 rank1..maxLevel。cherry/竞技场覆盖不写入召唤师峡谷。浮点 32 位按设计值归一。'
    },
    rankAlignment: {
      dataValuesAndCooldown: 'index0=rank0，写入时取 [1..maxLevel]',
      mana: '无 rank0 重复，写入时取 [0..maxLevel-1]',
      characterLevel: 'ByCharLevel 31 槽取游戏等级 1..18 对应前 18 项 20..190'
    }
  },
  skills: {
    lux_q: {
      name: '光之束缚',
      maxLevel: 5,
      write: {
        parameters: [
          param({
            parameterKey: 'base_damage',
            name: '基础魔法伤害',
            valueType: 'INTEGER',
            valueMode: 'SKILL_LEVEL',
            fixedValue: null,
            levelValues: lv([80, 120, 160, 200, 240]),
            description: '客户端 LuxLightBinding.DataValues.BaseDamage 含 rank0=40；跳过 rank0 后 rank1-5=80/120/160/200/240。来源：社区提取 16.17 mSpell。',
            sortOrder: 10
          }),
          param({
            parameterKey: 'ap_ratio',
            name: '法术强度倍率',
            valueType: 'DECIMAL',
            valueMode: 'FIXED',
            fixedValue: 0.75,
            levelValues: null,
            description: '客户端 APRatio=0.75；mSpellCalculations.TotalDamageTT = BaseDamage + AP×APRatio。比例 1=100%。',
            sortOrder: 20
          }),
          param({
            parameterKey: 'root_duration_ms',
            name: '束缚持续时间（毫秒）',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 2000,
            levelValues: null,
            description: '客户端 RootDuration=2 秒。当前状态目录仅有 vertigo/眩晕，不等于束缚，本批只录时长不声称控制已成立。',
            sortOrder: 30
          }),
          param({
            parameterKey: 'cooldown_ms',
            name: '冷却时间（毫秒）',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 10000,
            levelValues: null,
            description: '主技能 mSpell 无 Cooldown。DDragon 16.17.1 主动冷却 10 秒。弹体 LuxLightBindingMis 冷却 12 秒与主动资料冲突，不采用弹体值。',
            sortOrder: 40
          }),
          param({
            parameterKey: 'mana_cost',
            name: '法力消耗',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 50,
            levelValues: null,
            description: '客户端 mana 与 DDragon 16.17.1 cost 均为 50。',
            sortOrder: 50
          }),
          param({
            parameterKey: 'cast_time_ms',
            name: '施法时间（毫秒）',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 250,
            levelValues: null,
            description: '客户端主技能 spellCastTime=0.25 秒。',
            sortOrder: 60
          }),
          param({
            parameterKey: 'target_range',
            name: '技能指示范围',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 1175,
            levelValues: null,
            description: '采用 castRangeDisplayOverride 与 DDragon range=1175。主技能 castRange=10000 为引擎值，不写入。',
            sortOrder: 70
          }),
          param({
            parameterKey: 'projectile_speed',
            name: '弹体速度',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 1200,
            levelValues: null,
            description: '主技能与 LuxLightBindingMis 的 missileSpeed 均为 1200。',
            sortOrder: 80
          })
        ],
        formulas: [
          {
            formulaKey: 'damage',
            name: '光之束缚魔法伤害',
            description: 'BaseDamage + 法术强度×0.75。来源：客户端 TotalDamageTT。不另造中转公式。',
            sortOrder: 10,
            expression: apAdd('base_damage', 'ap_ratio')
          }
        ],
        effects: [
          manaCost(),
          magicHit(
            'light_binding_hit',
            '光球命中',
            '独立魔法伤害结果。最多命中两名敌人、碰撞宽度与落空仍待运行层；束缚控制因缺少束缚状态未写入。',
            'damage'
          )
        ],
        processes: [
          castProcess(
            '施放光之束缚',
            '过程只负责法力、施法延迟和冷却；伤害由实际命中事件触发。弹体碰撞与双目标上限未表达。'
          )
        ],
        triggerRules: [
          hitRule(
            'resolve_on_q_hit',
            '光之束缚实际命中结算',
            '监听 lux_q 实际命中后结算独立魔法伤害。不把命中事件写成束缚控制，也不表达第二目标筛选。',
            'lux_q',
            'light_binding_hit'
          )
        ]
      },
      skipped: [
        { kind: 'parameter', key: 'projectile_width', reason: '主技能 mLineWidth=80，弹体=70，数值冲突，不猜测。' },
        { kind: 'effect', key: 'root', reason: '状态目录仅 vertigo/眩晕，不能用该状态冒充束缚。' },
        { kind: 'parameter', key: 'engine_cast_range', reason: 'castRange=10000 非业务指示范围。' }
      ]
    },
    lux_w: {
      name: '曲光屏障',
      maxLevel: 5,
      write: {
        parameters: [
          param({
            parameterKey: 'base_shield',
            name: '基础护盾值',
            valueType: 'INTEGER',
            valueMode: 'SKILL_LEVEL',
            fixedValue: null,
            levelValues: lv([40, 55, 70, 85, 100]),
            description: '客户端 BaseShieldAmount 含 rank0=25；跳过 rank0 后 rank1-5=40/55/70/85/100。来源：社区提取 16.17 mSpell。',
            sortOrder: 10
          }),
          param({
            parameterKey: 'ap_ratio',
            name: '法术强度倍率',
            valueType: 'DECIMAL',
            valueMode: 'FIXED',
            fixedValue: 0.4,
            levelValues: null,
            description: '客户端 APRatio=0.4000000059604645，按设计值归一为 0.4。TotalShieldTT=BaseShieldAmount+AP×APRatio。未叠加治疗护盾强度。',
            sortOrder: 20
          }),
          param({
            parameterKey: 'shield_duration_ms',
            name: '护盾持续时间（毫秒）',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 2500,
            levelValues: null,
            description: '客户端 ShieldDuration=2.5 秒。',
            sortOrder: 30
          }),
          param({
            parameterKey: 'cooldown_ms',
            name: '冷却时间（毫秒）',
            valueType: 'INTEGER',
            valueMode: 'SKILL_LEVEL',
            fixedValue: null,
            levelValues: lv([12000, 11500, 11000, 10500, 10000]),
            description: '客户端 cooldownTime 含 rank0 重复 12；跳过 rank0 后与 DDragon 12/11.5/11/10.5/10 秒一致，按毫秒写入。',
            sortOrder: 40
          }),
          param({
            parameterKey: 'mana_cost',
            name: '法力消耗',
            valueType: 'INTEGER',
            valueMode: 'SKILL_LEVEL',
            fixedValue: null,
            levelValues: lv([60, 65, 70, 75, 80]),
            description: '客户端 mana 无 rank0 重复，前 5 项与 DDragon 一致。',
            sortOrder: 50
          }),
          param({
            parameterKey: 'cast_time_ms',
            name: '施法时间（毫秒）',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 250,
            levelValues: null,
            description: '客户端主技能 spellCastTime=0.25 秒。',
            sortOrder: 60
          }),
          param({
            parameterKey: 'target_range',
            name: '技能指示范围',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 1150,
            levelValues: null,
            description: '采用 castRangeDisplayOverride 与 DDragon range=1150。主技能 castRange=10000、返回弹体 25000 不写入。',
            sortOrder: 70
          })
        ],
        formulas: [
          {
            formulaKey: 'shield',
            name: '曲光屏障护盾值',
            description: 'BaseShieldAmount + 法术强度×0.4。来源：客户端 TotalShieldTT。去程与回程各提供等额护盾的叠加方式待确认，公式只表达单次护盾量。',
            sortOrder: 10,
            expression: apAdd('base_shield', 'ap_ratio')
          }
        ],
        effects: [
          manaCost(),
          {
            effectKey: 'prismatic_shield',
            name: '曲光屏障护盾',
            description: '独立普通护盾结果，持续 2.5 秒。未挂接弹体去程/回程命中，因为友军筛选与回程叠加缺少可表达且无歧义的触发。',
            sortOrder: 20,
            lifecycle: {
              durationValue: { kind: 'PARAMETER', parameterKey: 'shield_duration_ms' },
              maxStacksValue: { kind: 'FIXED', value: 1 },
              applicationStacksValue: { kind: 'FIXED', value: 1 },
              instanceScope: 'TARGET',
              reapplicationStackMode: 'KEEP',
              reapplicationDurationMode: 'REFRESH_ALL',
              expiryMode: 'ALL_AT_ONCE',
              periodicIntervalValue: null,
              firstPeriodicExecution: null
            },
            results: [
              {
                resultKey: 'shield',
                name: '曲光护盾',
                resultType: 'NORMAL_SHIELD',
                target: 'TARGET',
                description: '单次护盾量；回程是否再叠一层待确认，本批不猜测。',
                sortOrder: 10,
                lifecycleBehavior: {
                  moment: 'PERSISTENT',
                  valueReadMode: 'APPLICATION_SNAPSHOT',
                  stackValueMode: 'SHARED',
                  reapplicationValueMode: 'REPLACE',
                  periodicExecutionMode: null
                },
                spellShieldBlockScope: null,
                valueRule: {
                  value: { kind: 'FORMULA', formulaKey: 'shield' },
                  fixedMultiplier: 1,
                  fixedMinValue: 0,
                  fixedMaxValue: null
                },
                detail: { absorbedDamageTypeKey: null, decayMode: 'NONE' }
              }
            ]
          }
        ],
        processes: [
          castProcess(
            '施放曲光屏障',
            '过程只负责法力、施法延迟和冷却。护盾不在施放瞬间套给自己，避免把弹体途经友军误写成自我护盾。'
          )
        ],
        triggerRules: []
      },
      skipped: [
        { kind: 'trigger', key: 'shield_on_missile_hit', reason: '去程/回程友军命中与回程等额护盾叠加存在上下文歧义，不猜测挂接。' },
        { kind: 'parameter', key: 'projectile_speed', reason: '主技能 1200、去程弹体 2200、回程 50，冲突且回程 25000 射程已排除。' }
      ]
    },
    lux_e: {
      name: '透光奇点',
      maxLevel: 5,
      write: {
        parameters: [
          param({
            parameterKey: 'base_damage',
            name: '基础魔法伤害',
            valueType: 'INTEGER',
            valueMode: 'SKILL_LEVEL',
            fixedValue: null,
            levelValues: lv([65, 115, 165, 215, 265]),
            description: '客户端 BaseDamage 含 rank0=20；跳过 rank0 后与 DDragon effect[2]=65/115/165/215/265 一致。',
            sortOrder: 10
          }),
          param({
            parameterKey: 'ap_ratio',
            name: '法术强度倍率',
            valueType: 'DECIMAL',
            valueMode: 'FIXED',
            fixedValue: 0.8,
            levelValues: null,
            description: '客户端 TotalDamageTT 使用 StatByCoefficientCalculationPart mCoefficient=0.800000011920929，归一为 0.8。无具名 APRatio 字段，系数默认法术强度。',
            sortOrder: 20
          }),
          param({
            parameterKey: 'slow_ratio',
            name: '区域内减速比例',
            valueType: 'DECIMAL',
            valueMode: 'SKILL_LEVEL',
            fixedValue: null,
            levelValues: lv([0.25, 0.3, 0.35, 0.4, 0.45]),
            description: '客户端 SlowPercent 为百分数 20/25/30/35/40/45/50；跳过 rank0 后与 DDragon effect[1] 一致。按系统比例 1=100% 写成 0.25..0.45。当前无减速状态，只录数值。',
            sortOrder: 30
          }),
          param({
            parameterKey: 'slow_linger_ms',
            name: '爆炸后减速残留（毫秒）',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 1000,
            levelValues: null,
            description: '客户端 SlowLingerDuration=1 秒。',
            sortOrder: 31
          }),
          param({
            parameterKey: 'slow_zone_ms',
            name: '光区持续时间（毫秒）',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 5000,
            levelValues: null,
            description: '客户端 SlowZoneDuration=5 秒，到期或再次施放后爆炸。区域命中未写入过程。',
            sortOrder: 32
          }),
          param({
            parameterKey: 'vision_radius',
            name: '光区视野半径',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 650,
            levelValues: null,
            description: '客户端 VisionRadius=650。不声称战争迷雾运行已验证。',
            sortOrder: 33
          }),
          param({
            parameterKey: 'cooldown_ms',
            name: '冷却时间（毫秒）',
            valueType: 'INTEGER',
            valueMode: 'SKILL_LEVEL',
            fixedValue: null,
            levelValues: lv([10000, 9500, 9000, 8500, 8000]),
            description: '客户端 cooldownTime 跳过 rank0 后与 DDragon 10/9.5/9/8.5/8 秒一致。',
            sortOrder: 40
          }),
          param({
            parameterKey: 'mana_cost',
            name: '法力消耗',
            valueType: 'INTEGER',
            valueMode: 'SKILL_LEVEL',
            fixedValue: null,
            levelValues: lv([70, 80, 90, 100, 110]),
            description: '客户端 mana 无 rank0 重复，前 5 项与 DDragon 一致。',
            sortOrder: 50
          }),
          param({
            parameterKey: 'cast_time_ms',
            name: '施法时间（毫秒）',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 250,
            levelValues: null,
            description: '客户端主技能 spellCastTime=0.25 秒。再次施放/开关技能 0.425 秒不混入首次施放。',
            sortOrder: 60
          }),
          param({
            parameterKey: 'target_range',
            name: '技能指示范围',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 1100,
            levelValues: null,
            description: '客户端 castRange 与 DDragon range 均为 1100。',
            sortOrder: 70
          }),
          param({
            parameterKey: 'projectile_speed',
            name: '弹体速度',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 1300,
            levelValues: null,
            description: '客户端主技能 missileSpeed=1300。',
            sortOrder: 80
          })
        ],
        formulas: [
          {
            formulaKey: 'damage',
            name: '透光奇点爆炸魔法伤害',
            description: 'BaseDamage + 法术强度×0.8。来源：客户端 TotalDamageTT。',
            sortOrder: 10,
            expression: apAdd('base_damage', 'ap_ratio')
          }
        ],
        effects: [
          manaCost(),
          magicHit(
            'singularity_detonate',
            '奇点爆炸',
            '独立爆炸魔法伤害。光区减速、区域筛选、到期自动爆炸与再次施放引爆未写成过程或触发，因为区域命中表达不足。',
            'damage'
          )
        ],
        processes: [
          castProcess(
            '施放透光奇点',
            '过程只负责法力、施法延迟和冷却。再次施放引爆与 5 秒后自动爆炸未写入，避免把区域命中猜成立即伤害。'
          )
        ],
        triggerRules: []
      },
      skipped: [
        { kind: 'effect', key: 'slow', reason: '无减速状态可挂 STATUS_OPERATION；只保留 slow_ratio 等参数。' },
        { kind: 'process', key: 'recast_detonate', reason: '再次施放与到期爆炸的目标筛选、区域半径在当前过程模型中无法准确表达。' },
        { kind: 'trigger', key: 'explode_on_recast', reason: '爆炸时点存在再次施放/到期两种路径，挂触发会猜测。' }
      ]
    },
    lux_r: {
      name: '终极闪光',
      maxLevel: 3,
      write: {
        parameters: [
          param({
            parameterKey: 'base_damage',
            name: '基础魔法伤害',
            valueType: 'INTEGER',
            valueMode: 'SKILL_LEVEL',
            fixedValue: null,
            levelValues: lv([300, 400, 500]),
            description: '客户端 Damage 含 rank0=200；maxLevel=3，跳过 rank0 取 300/400/500。来源：社区提取 16.17 mSpell。',
            sortOrder: 10
          }),
          param({
            parameterKey: 'ap_ratio',
            name: '法术强度倍率',
            valueType: 'DECIMAL',
            valueMode: 'FIXED',
            fixedValue: 1.2,
            levelValues: null,
            description: '客户端 TotalDamage 使用 mCoefficient=1.2000000476837158，归一为 1.2。',
            sortOrder: 20
          }),
          param({
            parameterKey: 'reset_ratio',
            name: '击杀助攻冷却返还比例',
            valueType: 'DECIMAL',
            valueMode: 'SKILL_LEVEL',
            fixedValue: null,
            levelValues: lv([0.3, 0.4, 0.5]),
            description: '客户端 ResetPercent 跳过 rank0 后 0.3/0.4/0.5。未挂击杀/助攻触发，因为助攻窗口与刷新对象存在歧义。',
            sortOrder: 30
          }),
          param({
            parameterKey: 'reset_assist_window_ms',
            name: '助攻返还窗口（毫秒）',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 1750,
            levelValues: null,
            description: '客户端 ResetAssistWindow=1.75 秒。只录窗口，不猜测触发。',
            sortOrder: 31
          }),
          param({
            parameterKey: 'cooldown_ms',
            name: '冷却时间（毫秒）',
            valueType: 'INTEGER',
            valueMode: 'SKILL_LEVEL',
            fixedValue: null,
            levelValues: lv([60000, 50000, 40000]),
            description: '客户端 cooldownTime 跳过 rank0 后前 3 项与 DDragon 60/50/40 秒一致。',
            sortOrder: 40
          }),
          param({
            parameterKey: 'mana_cost',
            name: '法力消耗',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 100,
            levelValues: null,
            description: '客户端 mana 与 DDragon cost 均为 100。',
            sortOrder: 50
          }),
          param({
            parameterKey: 'cast_time_ms',
            name: '蓄力时间（毫秒）',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 1375,
            levelValues: null,
            description: '客户端 spellCastTime=1.375 秒。按延迟步骤录入，不把通道打断/不可取消写成完整通道机制。',
            sortOrder: 60
          }),
          param({
            parameterKey: 'target_range',
            name: '技能指示范围',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 3340,
            levelValues: null,
            description: '采用 castRangeDisplayOverride 与 DDragon range=3340。castRange=25000 不写入。',
            sortOrder: 70
          }),
          param({
            parameterKey: 'line_width',
            name: '光束宽度',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 190,
            levelValues: null,
            description: '客户端主技能 mLineWidth=190，仅单来源，未与独立弹体交叉。',
            sortOrder: 80
          }),
          param({
            parameterKey: 'projectile_speed',
            name: '光束速度',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 3000,
            levelValues: null,
            description: '客户端主技能 missileSpeed=3000。',
            sortOrder: 81
          })
        ],
        formulas: [
          {
            formulaKey: 'damage',
            name: '终极闪光魔法伤害',
            description: 'Damage + 法术强度×1.2。来源：客户端 TotalDamage。',
            sortOrder: 10,
            expression: apAdd('base_damage', 'ap_ratio')
          }
        ],
        effects: [
          manaCost(),
          magicHit(
            'final_spark_hit',
            '终极闪光命中',
            '独立直线魔法伤害。被动引爆/刷新启明、冷却返还未挂接。',
            'damage'
          )
        ],
        processes: [
          castProcess(
            '施放终极闪光',
            '过程只负责法力、1.375 秒蓄力延迟和冷却。通道取消与直线区域命中未完整表达。'
          )
        ],
        triggerRules: [
          hitRule(
            'resolve_on_r_hit',
            '终极闪光实际命中结算',
            '监听 lux_r 实际命中后结算独立魔法伤害。不在此触发上猜测启明引爆或冷却返还。',
            'lux_r',
            'final_spark_hit'
          )
        ]
      },
      skipped: [
        { kind: 'trigger', key: 'reset_on_takedown', reason: 'ResetPercent 与 ResetAssistWindow 已录参数；击杀/助攻/窗口对象有歧义，不猜测挂触发。' },
        { kind: 'trigger', key: 'refresh_illumination', reason: 'R 触发并刷新被动减益的顺序（先引爆再刷新或只刷新）资料未在本批交叉确证。' },
        { kind: 'parameter', key: 'engine_cast_range', reason: 'castRange=25000 不写入。' }
      ]
    },
    lux_p: {
      name: '光芒四射',
      maxLevel: 1,
      write: {
        parameters: [
          param({
            parameterKey: 'base_damage',
            name: '基础魔法伤害',
            valueType: 'INTEGER',
            valueMode: 'CHARACTER_LEVEL',
            fixedValue: null,
            levelValues: charLevels(pBaseDamage),
            description: '客户端 TotalDamage 的 ByCharLevel 从 20 起每级 +10，共 31 槽；按游戏等级 1..18 取前 18 项 20..190。不可照抄 DDragon 主动冷却/消耗/范围（旧 P 候选混入 Q）。',
            sortOrder: 10
          }),
          param({
            parameterKey: 'ap_ratio',
            name: '法术强度倍率',
            valueType: 'DECIMAL',
            valueMode: 'FIXED',
            fixedValue: 0.35,
            levelValues: null,
            description: '客户端 APRatio=0.3499999940395355，按设计值归一为 0.35。cherry 覆盖 0.5 不写入召唤师峡谷。',
            sortOrder: 20
          }),
          param({
            parameterKey: 'mark_duration_ms',
            name: '启明持续时间（毫秒）',
            valueType: 'INTEGER',
            valueMode: 'FIXED',
            fixedValue: 6000,
            levelValues: null,
            description: '客户端 DebuffDuration=6 秒。不是控制状态。',
            sortOrder: 30
          })
        ],
        formulas: [
          {
            formulaKey: 'damage',
            name: '启明额外魔法伤害',
            description: '角色等级基础伤害 + 法术强度×0.35。来源：客户端 TotalDamage = ByCharLevel + StatByNamedDataValue(APRatio)。',
            sortOrder: 10,
            expression: apAdd('base_damage', 'ap_ratio')
          }
        ],
        effects: [
          {
            effectKey: 'illumination_mark',
            name: '启明印记',
            description: '独立生命周期印记：持续 6 秒，提前移除时结算魔法伤害，自然到期不结算。施加/普攻消耗/R 刷新触发因上下文歧义未挂接，不把该效果称为控制。',
            sortOrder: 10,
            lifecycle: {
              durationValue: { kind: 'PARAMETER', parameterKey: 'mark_duration_ms' },
              maxStacksValue: { kind: 'FIXED', value: 1 },
              applicationStacksValue: { kind: 'FIXED', value: 1 },
              instanceScope: 'SOURCE_TARGET',
              reapplicationStackMode: 'KEEP',
              reapplicationDurationMode: 'REFRESH_ALL',
              expiryMode: 'ALL_AT_ONCE',
              periodicIntervalValue: null,
              firstPeriodicExecution: null
            },
            results: [
              {
                resultKey: 'magic_damage',
                name: '启明引爆魔法伤害',
                resultType: 'DAMAGE',
                target: 'TARGET',
                description: '提前移除时结算；自然到期不结算。',
                sortOrder: 10,
                lifecycleBehavior: {
                  moment: 'EARLY_REMOVE',
                  valueReadMode: 'APPLICATION_SNAPSHOT',
                  stackValueMode: null,
                  reapplicationValueMode: null,
                  periodicExecutionMode: null
                },
                spellShieldBlockScope: 'DAMAGE_INSTANCE',
                valueRule: {
                  value: { kind: 'FORMULA', formulaKey: 'damage' },
                  fixedMultiplier: 1,
                  fixedMinValue: 0,
                  fixedMaxValue: null
                },
                detail: {
                  damageTypeKey: 'magic',
                  deliveryKind: 'SKILL',
                  originKind: 'DIRECT',
                  critical: { mode: 'DISALLOWED', multiplierValue: null },
                  vampRules: []
                }
              }
            ]
          }
        ],
        processes: [],
        triggerRules: []
      },
      skipped: [
        { kind: 'parameter', key: 'cooldown_ms', reason: 'P 客户端冷却为 0；旧候选混入 Q 的 10/50/1175，不写入。' },
        { kind: 'trigger', key: 'apply_on_damaging_skill', reason: '“伤害类技能”范围（是否含装备/召唤师技能/仅 QER）未无歧义交叉。' },
        { kind: 'trigger', key: 'consume_on_attack', reason: '下一次攻击消耗与 R 同时触发并刷新的顺序未在本批确证。' },
        { kind: 'parameter', key: 'cherry_ap_ratio', reason: 'DataValuesModeOverride.cherry APRatio=0.5 属模式覆盖，不写入。' }
      ]
    }
  }
};

const routes = {
  parameters: { list: 'parameters', item: (key) => `parameters/${key}`, id: 'parameterKey' },
  formulas: { list: 'formulas', item: (key) => `formulas/${key}`, id: 'formulaKey' },
  effects: { list: 'effects', item: (key) => `effects/${key}`, id: 'effectKey' },
  processes: { list: 'processes', item: (key) => `processes/${key}`, id: 'processKey' },
  triggerRules: { list: 'trigger-rules', item: (key) => `trigger-rules/${key}`, id: 'ruleKey' }
};

const evidence = {
  executor: 'Cursor',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  apiBase: API_BASE,
  gameId: GAME_ID,
  tokenPlaceholder: 'local-entry',
  counts: {},
  writes: [],
  readbacks: [],
  occupiedConflicts: [],
  skippedExisting: [],
  failures: [],
  perSkill: {}
};

function skillPath(skillKey, suffix) {
  return `/api/admin/games/${GAME_ID}/skills/${encodeURIComponent(skillKey)}/${suffix}`;
}

async function request(method, pathname, body) {
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${TOKEN}`
  };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(`${API_BASE}${pathname}`, init);
  } catch (error) {
    return { ok: false, status: 0, data: null, networkError: String(error) };
  }
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: response.ok, status: response.status, data };
}

function plannedId(kind, body) {
  return body[routes[kind].id];
}

function stripMeta(value) {
  if (Array.isArray(value)) return value.map(stripMeta);
  if (value && typeof value === 'object') {
    const next = {};
    for (const key of Object.keys(value)) {
      if (key === 'createdAt' || key === 'updatedAt' || key === 'gameId' || key === 'skillKey' || key === 'resultCount' || key === 'lifecycleEnabled' || key === 'stepCount' || key === 'effectBindingCount' || key === 'stateOperationCount' || key === 'conditionGroupCount' || key === 'actionCount' || key === 'perTargetCooldownEnabled' || key === 'maxTriggersPerProcessEnabled' || key === 'eventType') {
        continue;
      }
      next[key] = stripMeta(value[key]);
    }
    return next;
  }
  return value;
}

function differs(planned, actual, pathParts = []) {
  if (planned === actual) return null;
  if (typeof planned !== 'object' || planned === null) {
    if (planned !== actual) return { path: pathParts.join('.'), planned, actual };
    return null;
  }
  if (Array.isArray(planned)) {
    if (!Array.isArray(actual) || actual.length !== planned.length) {
      return { path: pathParts.join('.'), planned, actual };
    }
    for (let i = 0; i < planned.length; i += 1) {
      const found = differs(planned[i], actual[i], pathParts.concat(String(i)));
      if (found) return found;
    }
    return null;
  }
  if (typeof actual !== 'object' || actual === null) {
    return { path: pathParts.join('.'), planned, actual };
  }
  for (const key of Object.keys(planned)) {
    const found = differs(planned[key], actual[key], pathParts.concat(key));
    if (found) return found;
  }
  return null;
}

function fieldReadback(planned, actual) {
  const fields = {};
  for (const key of Object.keys(planned)) {
    const diff = differs(planned[key], actual?.[key]);
    fields[key] = {
      match: !diff,
      planned: planned[key],
      actual: actual?.[key] ?? null,
      diff
    };
  }
  return fields;
}

async function listKind(skillKey, kind) {
  return request('GET', skillPath(skillKey, routes[kind].list));
}

async function getItem(skillKey, kind, id) {
  return request('GET', skillPath(skillKey, routes[kind].item(id)));
}

async function ensureItem(skillKey, kind, body) {
  const id = plannedId(kind, body);
  const listed = await listKind(skillKey, kind);
  if (!listed.ok) {
    evidence.failures.push({ skillKey, kind, id, step: 'list', status: listed.status, networkError: listed.networkError || null });
    const landed = await getItem(skillKey, kind, id);
    if (landed.ok) {
      return finishReadback(skillKey, kind, body, landed, 'list-failed-then-get');
    }
    return false;
  }
  const items = Array.isArray(listed.data) ? listed.data : [];
  const existed = items.some((item) => item[routes[kind].id] === id);
  if (existed) {
    const current = await getItem(skillKey, kind, id);
    if (!current.ok) {
      evidence.failures.push({ skillKey, kind, id, step: 'get-existing', status: current.status });
      return false;
    }
    const actual = stripMeta(current.data);
    const planned = stripMeta(body);
    const diff = differs(planned, actual);
    if (diff) {
      evidence.occupiedConflicts.push({ skillKey, kind, id, diff, note: '已占用且值不同，未覆盖' });
      return false;
    }
    evidence.skippedExisting.push({ skillKey, kind, id, reason: '已存在且字段一致' });
    evidence.readbacks.push({ skillKey, kind, id, action: 'skip-same', fields: fieldReadback(planned, actual) });
    return true;
  }
  const created = await request('POST', skillPath(skillKey, routes[kind].list), body);
  if (!created.ok) {
    const landed = await getItem(skillKey, kind, id);
    if (landed.ok) {
      evidence.writes.push({ skillKey, kind, id, action: 'post-failed-but-landed', status: created.status });
      return finishReadback(skillKey, kind, body, landed, 'post-failed-then-get');
    }
    evidence.failures.push({
      skillKey,
      kind,
      id,
      step: 'post',
      status: created.status,
      error: created.data && created.data.error ? created.data.error : created.data
    });
    return false;
  }
  evidence.writes.push({ skillKey, kind, id, action: 'created', status: created.status });
  const read = await getItem(skillKey, kind, id);
  if (!read.ok) {
    evidence.failures.push({ skillKey, kind, id, step: 'get-readback', status: read.status });
    return false;
  }
  return finishReadback(skillKey, kind, body, read, 'created');
}

function finishReadback(skillKey, kind, body, read, action) {
  const actual = stripMeta(read.data);
  const planned = stripMeta(body);
  const diff = differs(planned, actual);
  const fields = fieldReadback(planned, actual);
  evidence.readbacks.push({
    skillKey,
    kind,
    id: plannedId(kind, body),
    action,
    match: !diff,
    diff,
    fields
  });
  if (diff) {
    evidence.failures.push({ skillKey, kind, id: plannedId(kind, body), step: 'readback-mismatch', diff });
    return false;
  }
  return true;
}

function countOf(skillPlan) {
  return {
    parameters: skillPlan.write.parameters.length,
    formulas: skillPlan.write.formulas.length,
    effects: skillPlan.write.effects.length,
    processes: skillPlan.write.processes.length,
    triggerRules: skillPlan.write.triggerRules.length,
    skipped: skillPlan.skipped.length
  };
}

async function enterSkill(skillKey) {
  const skillPlan = plan.skills[skillKey];
  const kinds = ['parameters', 'formulas', 'effects', 'processes', 'triggerRules'];
  const result = {
    skillKey,
    name: skillPlan.name,
    planned: countOf(skillPlan),
    created: { parameters: 0, formulas: 0, effects: 0, processes: 0, triggerRules: 0 },
    skippedSame: 0,
    occupiedConflicts: 0,
    failures: 0
  };
  for (const kind of kinds) {
    for (const body of skillPlan.write[kind]) {
      const beforeWrites = evidence.writes.length;
      const beforeSkip = evidence.skippedExisting.length;
      const beforeConflict = evidence.occupiedConflicts.length;
      const beforeFail = evidence.failures.length;
      const ok = await ensureItem(skillKey, kind, body);
      if (evidence.writes.length > beforeWrites) result.created[kind] += 1;
      if (evidence.skippedExisting.length > beforeSkip) result.skippedSame += 1;
      if (evidence.occupiedConflicts.length > beforeConflict) result.occupiedConflicts += 1;
      if (!ok || evidence.failures.length > beforeFail) result.failures += 1;
    }
  }
  evidence.perSkill[skillKey] = result;
  await writeFile(
    path.join(here, `回读-${skillKey}.json`),
    `${JSON.stringify({
      skillKey,
      finishedAt: new Date().toISOString(),
      planned: result.planned,
      skipped: skillPlan.skipped,
      readbacks: evidence.readbacks.filter((item) => item.skillKey === skillKey),
      occupiedConflicts: evidence.occupiedConflicts.filter((item) => item.skillKey === skillKey),
      failures: evidence.failures.filter((item) => item.skillKey === skillKey)
    }, null, 2)}\n`,
    'utf8'
  );
}

async function dumpCandidates() {
  await mkdir(here, { recursive: true });
  await writeFile(path.join(here, '候选.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
}

async function main() {
  await dumpCandidates();
  if (dumpOnly) return;
  for (const skillKey of plan.meta.exclusiveSkillKeys) {
    await enterSkill(skillKey);
  }
  evidence.finishedAt = new Date().toISOString();
  evidence.counts = Object.fromEntries(
    plan.meta.exclusiveSkillKeys.map((skillKey) => [skillKey, evidence.perSkill[skillKey]])
  );
  await writeFile(path.join(here, '逐对象回读.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

await main();
