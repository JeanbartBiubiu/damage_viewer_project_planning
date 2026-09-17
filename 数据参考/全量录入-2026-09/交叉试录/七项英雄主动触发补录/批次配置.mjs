export const expectedCurrent = {
  skillCount: 1062,
  ruleCount: 114,
  sourceInitializedCount: 24,
  finalRuleCount: 120
};

const startProcess = (name) => [{
  actionKey: 'start_cast',
  name,
  actionType: 'START_PROCESS',
  sortOrder: 10,
  targetContext: 'CURRENT_TARGET',
  detail: { processKey: 'cast' },
  runtimeInputBindings: [],
  resultModifiers: []
}];

const effectAction = (actionKey, name, effectKey, sortOrder) => ({
  actionKey,
  name,
  actionType: 'EXECUTE_EFFECT',
  sortOrder,
  targetContext: 'CURRENT_TARGET',
  detail: { effectKey },
  runtimeInputBindings: [],
  resultModifiers: []
});

const rule = (ruleKey, name, description, actions) => ({
  ruleKey,
  name,
  description,
  sortOrder: 10,
  eventSource: { eventType: 'SKILL_USED', detail: { useKind: 'ACTIVE' } },
  conditionGroups: [],
  actions,
  perTargetCooldown: null,
  maxTriggersPerProcess: null
});

export const targetConfigs = [
  {
    id: 'nautilus',
    name: '诺提勒斯 W',
    directoryName: '七项英雄主动触发补录/候选/诺提勒斯W',
    ownerKind: 'character',
    ownerKey: 'champion_nautilus',
    skillKey: 'nautilus_w',
    ruleKey: 'on_used',
    sourceFiles: ['数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第二十二批/最终候选.json'],
    body: rule('on_used', '泰坦之怒主动使用', '接收 nautilus_w 主动使用；无条件执行已有 shield 自身护盾。护盾存在期间攻击附伤、基础法力消耗、冷却与战斗施放资格留待后续接线。', [
      effectAction('execute_shield', '执行泰坦之怒自身护盾', 'shield', 10)
    ]),
    eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'nautilus_w', useKind: 'ACTIVE' }, conditionKind: 'NONE',
    actions: [effectAction('execute_shield', '执行泰坦之怒自身护盾', 'shield', 10)],
    effectChecks: [{ effectKey: 'shield', resultKey: 'shield', resultType: 'NORMAL_SHIELD', resultTarget: 'SOURCE', valueKind: 'FORMULA', valueKey: 'shield_value', durationParameterKey: 'shield_duration_ms' }],
    omitted: ['护盾存在期间普通攻击附伤及周围目标', '法力消耗、冷却和战斗施放资格']
  },
  {
    id: 'missfortune',
    name: '厄运小姐 W',
    directoryName: '七项英雄主动触发补录/候选/厄运小姐W',
    ownerKind: 'character',
    ownerKey: 'champion_missfortune',
    skillKey: 'missfortune_w',
    ruleKey: 'on_used',
    sourceFiles: ['数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第二批/录入候选.json'],
    body: rule('on_used', '大步流星主动使用', '接收 missfortune_w 主动使用；无条件执行已有 active_attack_speed。被动移速、主动满额移速状态、受击清除、冷却返还、法力消耗与基础冷却留待后续接线。', [
      effectAction('execute_attack_speed', '执行大步流星主动攻击速度', 'active_attack_speed', 10)
    ]),
    eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'missfortune_w', useKind: 'ACTIVE' }, conditionKind: 'NONE',
    actions: [effectAction('execute_attack_speed', '执行大步流星主动攻击速度', 'active_attack_speed', 10)],
    effectChecks: [{ effectKey: 'active_attack_speed', resultKey: 'attribute', resultType: 'ATTRIBUTE_CHANGE', resultTarget: 'SOURCE', valueKind: 'PARAMETER', valueKey: 'bonus_attack_speed_ratio', durationParameterKey: 'active_duration_ms' }],
    omitted: ['被动与主动移速状态切换及受击清除', '厄运的眷顾冷却返还', '法力消耗与基础冷却']
  },
  {
    id: 'aatrox',
    name: '亚托克斯 R',
    directoryName: '七项英雄主动触发补录/候选/亚托克斯R',
    ownerKind: 'character',
    ownerKey: 'champion_aatrox',
    skillKey: 'aatrox_r',
    ruleKey: 'on_used',
    sourceFiles: [
      '数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第十九批/完整候选.json',
      '数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第十九批/修订一候选.json'
    ],
    body: rule('on_used', '大灭主动使用', '接收 aatrox_r 主动使用；无条件执行已有 attack_damage_amp。移动速度衰减、自我治疗提升、参与击杀续时与刷新、小兵恐惧及施法时长冲突留待后续接线。', [
      effectAction('execute_attack_damage_amp', '执行大灭自身攻击力提升', 'attack_damage_amp', 10)
    ]),
    eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'aatrox_r', useKind: 'ACTIVE' }, conditionKind: 'NONE',
    actions: [effectAction('execute_attack_damage_amp', '执行大灭自身攻击力提升', 'attack_damage_amp', 10)],
    effectChecks: [{ effectKey: 'attack_damage_amp', resultKey: 'attribute', resultType: 'ATTRIBUTE_CHANGE', resultTarget: 'SOURCE', valueKind: 'PARAMETER', valueKey: 'attack_damage_amp_ratio', durationParameterKey: 'form_duration_ms' }],
    omitted: ['移动速度衰减与自我治疗提升', '参与击杀续时及刷新', '小兵恐惧与施法时长冲突']
  },
  {
    id: 'kennen',
    name: '凯南 R',
    directoryName: '七项英雄主动触发补录/候选/凯南R',
    ownerKind: 'character',
    ownerKey: 'champion_kennen',
    skillKey: 'kennen_r',
    ruleKey: 'on_used',
    sourceFiles: ['数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第十四批/最终候选.json'],
    body: rule('on_used', '万雷天牢引主动使用', '接收 kennen_r 主动使用；依次执行已有 armor 与 magic_resistance。周期伤害、后续命中增幅、雷缚印层数、实际首末跳和战斗施放资格留待后续接线。', [
      effectAction('execute_armor', '执行万雷天牢引自身护甲', 'armor', 10),
      effectAction('execute_magic_resistance', '执行万雷天牢引自身魔法抗性', 'magic_resistance', 20)
    ]),
    eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'kennen_r', useKind: 'ACTIVE' }, conditionKind: 'NONE',
    actions: [
      effectAction('execute_armor', '执行万雷天牢引自身护甲', 'armor', 10),
      effectAction('execute_magic_resistance', '执行万雷天牢引自身魔法抗性', 'magic_resistance', 20)
    ],
    effectChecks: [
      { effectKey: 'armor', resultKey: 'attribute', resultType: 'ATTRIBUTE_CHANGE', resultTarget: 'SOURCE', valueKind: 'PARAMETER', valueKey: 'bonus_resistances', durationParameterKey: 'duration_ms' },
      { effectKey: 'magic_resistance', resultKey: 'attribute', resultType: 'ATTRIBUTE_CHANGE', resultTarget: 'SOURCE', valueKind: 'PARAMETER', valueKey: 'bonus_resistances', durationParameterKey: 'duration_ms' }
    ],
    omitted: ['周期伤害及后续命中增幅', '雷缚印层数与首末跳时点']
  },
  {
    id: 'sivir',
    name: '希维尔 W',
    directoryName: '七项英雄主动触发补录/候选/希维尔W',
    ownerKind: 'character',
    ownerKey: 'champion_sivir',
    skillKey: 'sivir_w',
    ruleKey: 'on_used',
    sourceFiles: ['数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第三批/录入候选.json'],
    body: rule('on_used', '弹射主动使用', '接收 sivir_w 主动使用，在 CURRENT_TARGET 上启动已有 cast 过程；过程统一处理法力、冷却和 ricochet_attack_speed。后续攻击次数、弹射目标、伤害与同次暴击沿用留待后续接线。', startProcess('启动弹射施放过程')),
    eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'sivir_w', useKind: 'ACTIVE' }, conditionKind: 'NONE',
    actions: startProcess('启动弹射施放过程'),
    processCheck: {
      processKey: 'cast', activationType: 'ACTIVE', cooldownParameterKey: 'cooldown_ms',
      steps: [{ stepKey: 'activate', stepType: 'IMMEDIATE', sortOrder: 10 }],
      effectBindings: [
        { bindingKey: 'mana_cost', effectKey: 'mana_cost', momentType: 'PROCESS_START', stepKey: null, sortOrder: 10 },
        { bindingKey: 'ricochet_attack_speed', effectKey: 'ricochet_attack_speed', momentType: 'STEP_EXECUTION', stepKey: 'activate', sortOrder: 20 }
      ]
    },
    effectChecks: [{ effectKey: 'ricochet_attack_speed', resultKey: 'attribute', resultType: 'ATTRIBUTE_CHANGE', resultTarget: 'SOURCE', valueKind: 'PARAMETER', valueKey: 'bonus_attack_speed_ratio', durationParameterKey: 'buff_duration_ms' }],
    omitted: ['强化普攻次数及弹射目标', '弹射伤害与同次暴击沿用']
  },
  {
    id: 'renekton',
    name: '雷克顿 R',
    directoryName: '七项英雄主动触发补录/候选/雷克顿R',
    ownerKind: 'character',
    ownerKey: 'champion_renekton',
    skillKey: 'renekton_r',
    ruleKey: 'on_used',
    sourceFiles: ['数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第六批/完整候选.json'],
    body: rule('on_used', '终极统治主动使用', '接收 renekton_r 主动使用，在 CURRENT_TARGET 上启动已有 cast 过程；过程统一处理基础冷却和 dominance_health。当前生命随最大生命变更、施放怒气、周期怒气与范围伤害留待后续接线。', startProcess('启动终极统治施放过程')),
    eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'renekton_r', useKind: 'ACTIVE' }, conditionKind: 'NONE',
    actions: startProcess('启动终极统治施放过程'),
    processCheck: {
      processKey: 'cast', activationType: 'ACTIVE', cooldownParameterKey: 'cooldown_ms',
      steps: [{ stepKey: 'start', stepType: 'IMMEDIATE', sortOrder: 10 }],
      effectBindings: [{ bindingKey: 'dominance_health', effectKey: 'dominance_health', momentType: 'STEP_COMPLETE', stepKey: 'start', sortOrder: 20 }]
    },
    effectChecks: [{ effectKey: 'dominance_health', resultKey: 'attribute', resultType: 'ATTRIBUTE_CHANGE', resultTarget: 'SOURCE', valueKind: 'PARAMETER', valueKey: 'maximum_health_gain', durationParameterKey: 'duration_ms' }],
    omitted: ['当前生命随最大生命变更', '施放及周期怒气', '周期范围伤害']
  }
];

for (const config of targetConfigs) {
  config.body.eventSource.detail.sourceSkillKey = config.skillKey;
}

export const deferredConfigs = [
  {
    id: 'ambessa',
    directoryName: '七项英雄主动触发补录/候选/安蓓萨W',
    skillKey: 'ambessa_w',
    ruleKey: 'on_used',
    reason: 'self_shield 可达公式依赖 RUNTIME_INPUT 参数 shield_base_at_character_level；当前 SKILL_USED 事件、内部状态和已支持来源均不能提供角色等级，空绑定会被后端拒绝。'
  }
];
