export const expectedCurrent = {
  skillCount: 1062,
  ruleCount: 135,
  sourceInitializedCount: 25,
  finalRuleCount: 139,
  finalSourceInitializedCount: 26
};

const source40 = '数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十批/最终验收/候选过程/修订一/完整候选.json';
const source38 = '数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第三十八批/完整候选.json';
const source33 = '数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第三十三批/修订二/完整候选.json';
const source43 = '数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十三批/最终验收/候选过程/修订二/完整候选.json';

export const targetConfigs = [
  {
    id: 'twistedfate_e_permanent_attack_speed',
    ownerKey: 'champion_twistedfate',
    skillKey: 'twistedfate_e',
    skillName: '崔斯特·卡牌骗术',
    sourceFile: source40,
    sourceCandidateSha256: '84b2ca1c5cadd804a569482d71b1ba262b95335d71ee9f89b127523574367023',
    ruleKey: 'initialize_permanent_attack_speed',
    ruleName: '初始化卡牌骗术永久攻击速度',
    description: '来源对象初始化完成时执行已有 permanent_attack_speed，建立技能等级对应的单层永久自身攻击速度；第四次攻击计数、额外伤害、建筑物分支和实际攻击事件继续暂缓。',
    eventKind: 'SOURCE_INITIALIZED',
    actions: [
      {
        effectKey: 'permanent_attack_speed',
        actionKey: 'execute_permanent_attack_speed',
        actionName: '执行卡牌骗术永久攻击速度',
        actionTarget: 'EVENT_SOURCE'
      }
    ]
  },
  {
    id: 'skarner_r_champion_hit_move_speed',
    ownerKey: 'champion_skarner',
    skillKey: 'skarner_r',
    skillName: '斯卡纳·毒刺贯体',
    sourceFile: source38,
    sourceCandidateSha256: '2f03daad0fc690bb96164e1a92da5c62977a842dcb59c85cf45484e88d9587eb',
    ruleKey: 'actual_champion_hit',
    ruleName: '命中英雄触发毒刺贯体移速',
    description: '仅消费宿主确认的 skarner_r 实际英雄命中并执行已有 self_move_speed；伤害、压制、拖行、多目标、撼地联动、法力消耗和冷却继续暂缓。管理保存不证明宿主已生产该事件。',
    eventKind: 'SKILL_HIT',
    actions: [
      {
        effectKey: 'self_move_speed',
        actionKey: 'execute_self_move_speed',
        actionName: '执行毒刺贯体命中英雄自身移速',
        actionTarget: 'CURRENT_TARGET'
      }
    ]
  },
  {
    id: 'seraphine_w_self_shield',
    ownerKey: 'champion_seraphine',
    skillKey: 'seraphine_w',
    skillName: '萨勒芬妮·聚和心声',
    sourceFile: source33,
    sourceCandidateSha256: '841a100c48f51a135dbb6d4457ec5523af2030611cbbac1f2212b388be5a8b4e',
    ruleKey: 'on_used',
    ruleName: '聚和心声主动自身护盾',
    description: '接收 seraphine_w 主动使用并执行已有 self_shield；友方护盾与移速、自身衰减移速、已有护盾资格、延时治疗、回响重复和法力消耗继续暂缓。管理保存不证明宿主已生产该事件。',
    eventKind: 'SKILL_USED',
    actions: [
      {
        effectKey: 'self_shield',
        actionKey: 'execute_self_shield',
        actionName: '执行聚和心声自身护盾',
        actionTarget: 'CURRENT_TARGET'
      }
    ]
  },
  {
    id: 'naafiri_w_self_buffs',
    ownerKey: 'champion_naafiri',
    skillKey: 'naafiri_w',
    skillName: '纳亚菲利·暴吼',
    sourceFile: source43,
    sourceCandidateSha256: '236893b5c78b978396c454075554616b29060bbb8f9d2fe733846f0407faea51',
    ruleKey: 'on_used',
    ruleName: '暴吼主动自身攻击力与移速',
    description: '接收当前根绑定的 naafiri_w 主动使用，依次执行已有 self_attack_damage 与 self_move_speed；不可选取、额外犬群、召回、法力消耗和冷却继续暂缓。管理保存不证明宿主已生产该事件。',
    eventKind: 'SKILL_USED',
    actions: [
      {
        effectKey: 'self_attack_damage',
        actionKey: 'execute_self_attack_damage',
        actionName: '执行暴吼自身攻击力增益',
        actionTarget: 'CURRENT_TARGET'
      },
      {
        effectKey: 'self_move_speed',
        actionKey: 'execute_self_move_speed',
        actionName: '执行暴吼自身移动速度增益',
        actionTarget: 'CURRENT_TARGET'
      }
    ]
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
    actions: config.actions.map((action, index) => ({
      actionKey: action.actionKey,
      name: action.actionName,
      actionType: 'EXECUTE_EFFECT',
      sortOrder: (index + 1) * 10,
      targetContext: action.actionTarget,
      detail: { effectKey: action.effectKey },
      runtimeInputBindings: [],
      resultModifiers: []
    })),
    perTargetCooldown: null,
    maxTriggersPerProcess: null
  };
}
