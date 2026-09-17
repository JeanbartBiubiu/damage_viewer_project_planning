export const expectedCurrent = {
  skillCount: 1062,
  ruleCount: 131,
  sourceInitializedCount: 24,
  finalRuleCount: 135,
  finalSourceInitializedCount: 25
};

const source41 = '数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十一批/最终验收/候选过程/修订二/完整候选.json';
const source24 = '数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第二十四批/完整候选.json';
const source37 = '数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第三十七批/修订二/完整候选.json';
const source38 = '数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第三十八批/完整候选.json';

export const targetConfigs = [
  {
    id: 'rakan_r_initial_move_speed',
    ownerKey: 'champion_rakan',
    skillKey: 'rakan_r',
    skillName: '洛·惊鸿过隙',
    sourceFile: source41,
    sourceCandidateSha256: 'd0e2ecf93dce78d41da7e01190a8092704120a198c255625086c9cb1513017a5',
    ruleKey: 'on_used',
    ruleName: '惊鸿过隙主动初始移速',
    description: '接收 rakan_r 主动使用并执行已有 self_initial_move_speed；触敌伤害、魅惑、首次触敌衰减移速、法力消耗与冷却继续暂缓。管理保存不证明宿主已生产该事件。',
    eventKind: 'SKILL_USED',
    effectKey: 'self_initial_move_speed',
    actionKey: 'execute_self_initial_move_speed',
    actionName: '执行惊鸿过隙初始移动速度',
    actionTarget: 'CURRENT_TARGET'
  },
  {
    id: 'volibear_r_attack_range',
    ownerKey: 'champion_volibear',
    skillKey: 'volibear_r',
    skillName: '沃利贝尔·天声震落',
    sourceFile: source24,
    sourceCandidateSha256: '82909b66781b24fba50b7777cc01d7a511479eb0bb20e25a340b789014c3cf8b',
    ruleKey: 'on_used',
    ruleName: '天声震落主动攻击距离',
    description: '接收 volibear_r 主动使用并执行已有 attack_range；跳跃落点、直接压中伤害、减速、生命值增益、建筑物、法力消耗与冷却继续暂缓。管理保存不证明宿主已生产该事件。',
    eventKind: 'SKILL_USED',
    effectKey: 'attack_range',
    actionKey: 'execute_attack_range',
    actionName: '执行天声震落额外攻击距离',
    actionTarget: 'CURRENT_TARGET'
  },
  {
    id: 'akshan_q_champion_hit_move_speed',
    ownerKey: 'champion_akshan',
    skillKey: 'akshan_q',
    skillName: '阿克尚·去而复还',
    sourceFile: source37,
    sourceCandidateSha256: 'a701138c64980aca63185467c43152196519c035365faea161f8ea0123b273b5',
    ruleKey: 'actual_champion_hit',
    ruleName: '命中英雄触发去而复还移速',
    description: '仅消费宿主确认的 akshan_q 实际英雄命中，并执行已有 champion_hit_move_speed；去返程次数、投射物距离、显形、伤害结果与衰减函数继续暂缓。管理保存不证明宿主已生产该事件。',
    eventKind: 'SKILL_HIT',
    effectKey: 'champion_hit_move_speed',
    actionKey: 'execute_champion_hit_move_speed',
    actionName: '执行去而复还命中英雄自身移速',
    actionTarget: 'CURRENT_TARGET'
  },
  {
    id: 'jarvaniv_e_self_attack_speed',
    ownerKey: 'champion_jarvaniv',
    skillKey: 'jarvaniv_e',
    skillName: '嘉文四世·德邦军旗',
    sourceFile: source38,
    sourceCandidateSha256: '2f03daad0fc690bb96164e1a92da5c62977a842dcb59c85cf45484e88d9587eb',
    ruleKey: 'initialize_self_attack_speed',
    ruleName: '初始化德邦军旗被动攻击速度',
    description: '来源对象初始化完成时执行已有 self_attack_speed，建立嘉文E技能等级对应的单层自身被动攻击速度；军旗落点伤害、附近友军光环、旗帜连接和控制继续暂缓。',
    eventKind: 'SOURCE_INITIALIZED',
    effectKey: 'self_attack_speed',
    actionKey: 'execute_self_attack_speed',
    actionName: '执行德邦军旗自身被动攻击速度',
    actionTarget: 'EVENT_SOURCE'
  }
];

export function buildRule(config) {
  const eventSource = config.eventKind === 'SKILL_USED'
    ? { eventType: 'SKILL_USED', detail: { sourceSkillKey: config.skillKey, useKind: 'ACTIVE' } }
    : config.eventKind === 'SKILL_HIT'
      ? { eventType: 'SKILL_HIT', detail: { sourceSkillKey: config.skillKey } }
      : { eventType: 'SOURCE_INITIALIZED', detail: {} };
  const conditionGroups = config.eventKind === 'SKILL_HIT' ? [{
    groupKey: 'champion_target',
    name: '命中对象为英雄',
    sortOrder: 10,
    conditions: [{
      conditionKey: 'champion_target',
      conditionType: 'TARGET_CATEGORY_CHECK',
      sortOrder: 10,
      detail: { categories: ['CHAMPION'] }
    }]
  }] : [];
  return {
    ruleKey: config.ruleKey,
    name: config.ruleName,
    description: config.description,
    sortOrder: 10,
    eventSource,
    conditionGroups,
    actions: [{
      actionKey: config.actionKey,
      name: config.actionName,
      actionType: 'EXECUTE_EFFECT',
      sortOrder: 10,
      targetContext: config.actionTarget,
      detail: { effectKey: config.effectKey },
      runtimeInputBindings: [],
      resultModifiers: []
    }],
    perTargetCooldown: null,
    maxTriggersPerProcess: null
  };
}
