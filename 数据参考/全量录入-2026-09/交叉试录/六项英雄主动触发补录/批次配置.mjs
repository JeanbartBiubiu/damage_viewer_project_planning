export const expectedCurrent = {
  skillCount: 1062,
  ruleCount: 108,
  sourceInitializedCount: 24,
  finalRuleCount: 114
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

export const targetConfigs = [
  {
    id: 'tristana', name: '崔丝塔娜 Q', directoryName: 'LunaMax/麦林炮手Q触发补录',
    ownerKind: 'character', ownerKey: 'champion_tristana', skillKey: 'tristana_q', ruleKey: 'active',
    eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'tristana_q', useKind: 'ACTIVE' }, conditionKind: 'NONE',
    actions: startProcess('启动急速射击施放过程'),
    processCheck: {
      processKey: 'cast', activationType: 'ACTIVE', cooldownParameterKey: 'cooldown_ms',
      steps: [{ stepKey: 'activate', stepType: 'IMMEDIATE', sortOrder: 10 }],
      effectBindings: [
        { bindingKey: 'mana_cost', effectKey: 'mana_cost', momentType: 'PROCESS_START', stepKey: null, sortOrder: 10 },
        { bindingKey: 'rapid_fire', effectKey: 'rapid_fire', momentType: 'STEP_EXECUTION', stepKey: 'activate', sortOrder: 20 }
      ]
    },
    effectChecks: [{ effectKey: 'rapid_fire', resultKey: 'attribute', resultType: 'ATTRIBUTE_CHANGE', resultTarget: 'SOURCE', valueKind: 'PARAMETER', valueKey: 'bonus_attack_speed_ratio', durationParameterKey: 'buff_duration_ms' }]
  },
  {
    id: 'twitch', name: '图奇 R', directoryName: 'LunaMax/瘟疫之源R触发补录',
    ownerKind: 'character', ownerKey: 'champion_twitch', skillKey: 'twitch_r', ruleKey: 'on_used',
    eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'twitch_r', useKind: 'ACTIVE' }, conditionKind: 'NONE',
    actions: startProcess('启动火力全开施放过程'),
    processCheck: {
      processKey: 'cast', activationType: 'ACTIVE', cooldownParameterKey: 'cooldown_ms',
      steps: [{ stepKey: 'activate', stepType: 'IMMEDIATE', sortOrder: 10 }],
      effectBindings: [
        { bindingKey: 'mana_cost', effectKey: 'mana_cost', momentType: 'PROCESS_START', stepKey: null, sortOrder: 10 },
        { bindingKey: 'bonus_ad', effectKey: 'bonus_ad', momentType: 'STEP_EXECUTION', stepKey: 'activate', sortOrder: 20 },
        { bindingKey: 'bonus_range', effectKey: 'bonus_range', momentType: 'STEP_EXECUTION', stepKey: 'activate', sortOrder: 30 }
      ]
    },
    effectChecks: [
      { effectKey: 'bonus_ad', resultKey: 'attribute', resultType: 'ATTRIBUTE_CHANGE', resultTarget: 'SOURCE', valueKind: 'PARAMETER', valueKey: 'bonus_attack_damage', durationParameterKey: 'buff_duration_ms' },
      { effectKey: 'bonus_range', resultKey: 'attribute', resultType: 'ATTRIBUTE_CHANGE', resultTarget: 'SOURCE', valueKind: 'PARAMETER', valueKey: 'bonus_attack_range', durationParameterKey: 'buff_duration_ms' }
    ]
  },
  {
    id: 'vayne', name: '薇恩 R', directoryName: 'LunaMax/暗夜猎手R触发补录',
    ownerKind: 'character', ownerKey: 'champion_vayne', skillKey: 'vayne_r', ruleKey: 'on_used',
    eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'vayne_r', useKind: 'ACTIVE' }, conditionKind: 'NONE',
    actions: startProcess('启动终极时刻施放过程'),
    processCheck: {
      processKey: 'cast', activationType: 'ACTIVE', cooldownParameterKey: 'cooldown_ms',
      steps: [{ stepKey: 'start', stepType: 'IMMEDIATE', sortOrder: 10 }],
      effectBindings: [
        { bindingKey: 'mana_cost', effectKey: 'mana_cost', momentType: 'PROCESS_START', stepKey: null, sortOrder: 10 },
        { bindingKey: 'bonus_attack_damage', effectKey: 'bonus_attack_damage', momentType: 'STEP_COMPLETE', stepKey: 'start', sortOrder: 20 }
      ]
    },
    effectChecks: [{ effectKey: 'bonus_attack_damage', resultKey: 'attribute', resultType: 'ATTRIBUTE_CHANGE', resultTarget: 'SOURCE', valueKind: 'PARAMETER', valueKey: 'bonus_attack_damage', durationParameterKey: 'base_duration_ms' }]
  },
  {
    id: 'masteryi', name: '易 R', directoryName: 'LunaMax/无极剑圣R触发补录',
    ownerKind: 'character', ownerKey: 'champion_masteryi', skillKey: 'masteryi_r', ruleKey: 'on_used',
    eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'masteryi_r', useKind: 'ACTIVE' }, conditionKind: 'NONE',
    actions: [
      effectAction('execute_attack_speed', '执行高原血统额外攻击速度', 'attack_speed', 10),
      effectAction('execute_move_speed', '执行高原血统额外移动速度', 'move_speed', 20)
    ],
    effectChecks: [
      { effectKey: 'attack_speed', resultKey: 'attribute', resultType: 'ATTRIBUTE_CHANGE', resultTarget: 'SOURCE', valueKind: 'PARAMETER', valueKey: 'attack_speed_ratio', durationParameterKey: 'duration_ms' },
      { effectKey: 'move_speed', resultKey: 'attribute', resultType: 'ATTRIBUTE_CHANGE', resultTarget: 'SOURCE', valueKind: 'PARAMETER', valueKey: 'move_speed_ratio', durationParameterKey: 'duration_ms' }
    ]
  },
  {
    id: 'skarner', name: '斯卡纳 W', directoryName: 'LunaMax/斯卡纳W触发补录',
    ownerKind: 'character', ownerKey: 'champion_skarner', skillKey: 'skarner_w', ruleKey: 'on_used',
    eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'skarner_w', useKind: 'ACTIVE' }, conditionKind: 'NONE',
    actions: [effectAction('execute_self_shield', '执行震地壁垒自身护盾', 'self_shield', 10)],
    effectChecks: [{ effectKey: 'self_shield', resultKey: 'shield', resultType: 'NORMAL_SHIELD', resultTarget: 'SOURCE', valueKind: 'FORMULA', valueKey: 'shield_value', durationParameterKey: 'shield_duration_ms' }]
  },
  {
    id: 'diana', name: '黛安娜 W', directoryName: 'LunaMax/皎月女神W触发补录',
    ownerKind: 'character', ownerKey: 'champion_diana', skillKey: 'diana_w', ruleKey: 'on_used',
    eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'diana_w', useKind: 'ACTIVE' }, conditionKind: 'NONE',
    actions: startProcess('启动苍白之瀑施放过程'),
    processCheck: {
      processKey: 'cast', activationType: 'ACTIVE', cooldownParameterKey: 'cooldown_ms',
      steps: [{ stepKey: 'cast_time', stepType: 'DELAY', sortOrder: 10 }],
      effectBindings: [
        { bindingKey: 'mana_cost', effectKey: 'mana_cost', momentType: 'PROCESS_START', stepKey: null, sortOrder: 10 },
        { bindingKey: 'pale_cascade_shield', effectKey: 'pale_cascade_shield', momentType: 'STEP_COMPLETE', stepKey: 'cast_time', sortOrder: 20 }
      ]
    },
    effectChecks: [{ effectKey: 'pale_cascade_shield', resultKey: 'shield', resultType: 'NORMAL_SHIELD', resultTarget: 'SOURCE', valueKind: 'FORMULA', valueKey: 'shield', durationParameterKey: 'shield_duration_ms' }]
  }
];

export const deferredConfigs = [
  { id: 'sion', directoryName: 'LunaMax/亡灵战神W触发补录', skillKey: 'sion_w', ruleKey: 'on_used', reason: '首次施放与三秒后重施无法由当前技能使用事件区分；无条件挂护盾会在重施引爆时错误刷新六秒护盾。' },
  { id: 'vi', directoryName: null, skillKey: 'vi_p', ruleKey: null, reason: '被动冷却的等级断点、内部冷却状态及Q/E/R命中事件生产尚未冻结。' }
];
