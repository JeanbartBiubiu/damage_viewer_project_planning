export const expectedCurrent = {
  skillCount: 1062,
  ruleCount: 126,
  sourceInitializedCount: 24,
  finalRuleCount: 130
};

const source48 = '数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十八批/最终验收/候选过程/修订二/完整候选.json';
const source50 = '数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第五十批/最终验收/候选过程/修订二/完整候选.json';

export const targetConfigs = [
  {
    id: 'azir_r',
    name: '阿兹尔 R',
    ownerKey: 'champion_azir',
    skillKey: 'azir_r',
    skillName: '阿兹尔·禁军之墙',
    ruleKey: 'actual_hit',
    ruleName: '命中英雄触发禁军之墙伤害',
    description: '仅消费宿主确认的 azir_r 实际英雄命中，并在当前目标上执行已有的 charge_damage；击退、碰撞、墙体构建、法力消耗和冷却不在本条规则中。管理保存不证明宿主已经生产该事件。',
    actionKey: 'execute_charge_damage',
    actionName: '执行禁军之墙命中伤害',
    effectKey: 'charge_damage',
    formulaKey: 'magic_damage',
    resultKey: 'damage',
    sourceFile: source50,
    formulaRowTexts: ['禁军之墙一次冲锋魔法伤害', 'magic_damage'],
    formulaTexts: ['base_damage', 'ap_ratio', '乘', '加'],
    effectRowTexts: ['禁军之墙一次冲锋魔法伤害', 'charge_damage'],
    resultRowTexts: ['禁军之墙一次冲锋魔法伤害', 'damage', 'magic', '当前目标'],
    resultTexts: ['魔法伤害', '技能', '直接伤害', '施法者', '当前目标', 'magic_damage']
  },
  {
    id: 'azir_e',
    name: '阿兹尔 E',
    ownerKey: 'champion_azir',
    skillKey: 'azir_e',
    skillName: '阿兹尔·流沙移形',
    ruleKey: 'actual_hit',
    ruleName: '命中英雄触发流沙移形伤害',
    description: '仅消费宿主在已有合资格士兵突进后确认的 azir_e 实际英雄命中，并在当前目标上执行已有的 dash_damage；士兵资格、突进、中断、护盾、法力消耗和冷却不在本条规则中。管理保存不证明宿主已经生产该事件。',
    actionKey: 'execute_dash_damage',
    actionName: '执行流沙移形命中伤害',
    effectKey: 'dash_damage',
    formulaKey: 'magic_damage',
    resultKey: 'damage',
    sourceFile: source50,
    formulaRowTexts: ['流沙移形突进魔法伤害', 'magic_damage'],
    formulaTexts: ['base_damage', 'damage_ap_ratio', '乘', '加'],
    effectRowTexts: ['流沙移形突进魔法伤害', 'dash_damage'],
    resultRowTexts: ['流沙移形突进魔法伤害', 'damage', 'magic', '当前目标'],
    resultTexts: ['魔法伤害', '技能', '直接伤害', '施法者', '当前目标', 'magic_damage']
  },
  {
    id: 'yorick_e',
    name: '约里克 E',
    ownerKey: 'champion_yorick',
    skillKey: 'yorick_e',
    skillName: '约里克·哀伤之雾',
    ruleKey: 'actual_hit',
    ruleName: '命中英雄触发哀伤之雾伤害',
    description: '仅消费宿主确认的 yorick_e 实际英雄命中，并在当前目标上执行已有的 max_health_damage；减速、标记、护甲削减、召唤物、兵野分支、法力消耗和冷却不在本条规则中。管理保存不证明宿主已经生产该事件。',
    actionKey: 'execute_max_health_damage',
    actionName: '执行哀伤之雾命中伤害',
    effectKey: 'max_health_damage',
    formulaKey: 'max_health_magic_damage',
    resultKey: 'damage',
    sourceFile: source48,
    formulaRowTexts: ['哀伤之雾目标最大生命魔法伤害', 'max_health_magic_damage'],
    formulaTexts: ['percent_point_ratio', 'health_damage_percent_points', 'health_ap_ratio', '乘', '加'],
    effectRowTexts: ['哀伤之雾目标最大生命魔法伤害', 'max_health_damage'],
    resultRowTexts: ['哀伤之雾目标最大生命魔法伤害', 'damage', 'magic', '当前目标'],
    resultTexts: ['魔法伤害', '技能', '直接伤害', '施法者', '当前目标', 'max_health_magic_damage']
  },
  {
    id: 'viego_w',
    name: '佛耶戈 W',
    ownerKey: 'champion_viego',
    skillKey: 'viego_w',
    skillName: '佛耶戈·千载幽咽',
    ruleKey: 'actual_hit',
    ruleName: '命中英雄触发千载幽咽伤害',
    description: '仅消费宿主确认的 viego_w 第一个实际英雄命中，并在当前目标上执行已有的 damage；蓄力、冲刺、晕眩、自身减速、法力消耗和冷却不在本条规则中。管理保存不证明宿主已经生产该事件。',
    actionKey: 'execute_damage',
    actionName: '执行千载幽咽命中伤害',
    effectKey: 'damage',
    formulaKey: 'magic_damage',
    resultKey: 'damage',
    sourceFile: source48,
    formulaRowTexts: ['千载幽咽魔法伤害', 'magic_damage'],
    formulaTexts: ['base_damage', 'ap_ratio', '乘', '加'],
    effectRowTexts: ['千载幽咽魔法伤害', 'damage'],
    resultRowTexts: ['千载幽咽魔法伤害', 'damage', 'magic', '当前目标'],
    resultTexts: ['魔法伤害', '技能', '直接伤害', '施法者', '当前目标', 'magic_damage']
  }
];

export function buildRule(config) {
  return {
    ruleKey: config.ruleKey,
    name: config.ruleName,
    description: config.description,
    sortOrder: 10,
    eventSource: {
      eventType: 'SKILL_HIT',
      detail: { sourceSkillKey: config.skillKey }
    },
    conditionGroups: [{
      groupKey: 'champion_target',
      name: '命中对象为英雄',
      sortOrder: 10,
      conditions: [{
        conditionKey: 'champion_target',
        conditionType: 'TARGET_CATEGORY_CHECK',
        sortOrder: 10,
        detail: { categories: ['CHAMPION'] }
      }]
    }],
    actions: [{
      actionKey: config.actionKey,
      name: config.actionName,
      actionType: 'EXECUTE_EFFECT',
      sortOrder: 10,
      targetContext: 'CURRENT_TARGET',
      detail: { effectKey: config.effectKey },
      runtimeInputBindings: [],
      resultModifiers: []
    }],
    perTargetCooldown: null,
    maxTriggersPerProcess: null
  };
}

export const deferredConfigs = [
  { skillKey: 'kayn_w', reason: '当前事件无法区分暗裔与影流形态。' },
  { skillKey: 'udyr_r', reason: '持续时间、节拍、跟踪、觉醒分支和运行输入尚不完整。' }
];
