export const expectedCurrent = {
  skillCount: 1062,
  ruleCount: 120,
  sourceInitializedCount: 24,
  finalRuleCount: 126
};

const effectAction = (actionKey, name, effectKey, sortOrder = 10) => ({
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

const activeEffect = ({
  id,
  name,
  directory,
  ownerKey,
  skillKey,
  sourceFiles,
  ruleName,
  description,
  actionKey,
  actionName,
  effectKey,
  resultKey,
  resultType = 'ATTRIBUTE_CHANGE',
  valueKind = 'PARAMETER',
  valueKey,
  durationParameterKey,
  omitted
}) => {
  const action = effectAction(actionKey, actionName, effectKey);
  return {
    id,
    name,
    directoryName: '十项英雄主动触发评审与六项补录/候选/' + directory,
    ownerKind: 'character',
    ownerKey,
    skillKey,
    ruleKey: 'on_used',
    sourceFiles,
    body: rule('on_used', ruleName, description, [action]),
    eventType: 'SKILL_USED',
    eventDetail: { sourceSkillKey: skillKey, useKind: 'ACTIVE' },
    conditionKind: 'NONE',
    actions: [action],
    effectChecks: [{
      effectKey,
      resultKey,
      resultType,
      resultTarget: 'SOURCE',
      valueKind,
      valueKey,
      durationParameterKey
    }],
    omitted
  };
};

export const targetConfigs = [
  activeEffect({
    id: 'blitzcrank',
    name: '布里茨 W',
    directory: '布里茨W',
    ownerKey: 'champion_blitzcrank',
    skillKey: 'blitzcrank_w',
    sourceFiles: ['数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第二十六批/修订一/完整候选.json'],
    ruleName: '过载运转主动使用',
    description: '接收 blitzcrank_w 主动使用；执行已有 attack_speed_boost。移动速度及衰减、结束后的自身减速、法力消耗和战斗冷却留待后续接线。',
    actionKey: 'execute_attack_speed_boost',
    actionName: '执行过载运转攻击速度',
    effectKey: 'attack_speed_boost',
    resultKey: 'attribute',
    valueKey: 'attack_speed_ratio',
    durationParameterKey: 'duration_ms',
    omitted: ['移动速度及衰减', '结束后的自身减速', '法力消耗和战斗冷却']
  }),
  activeEffect({
    id: 'draven',
    name: '德莱文 W',
    directory: '德莱文W',
    ownerKey: 'champion_draven',
    skillKey: 'draven_w',
    sourceFiles: ['数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第八批/后十技能候选.json'],
    ruleName: '血性冲刺主动使用',
    description: '接收 draven_w 主动使用；执行已有 attack_speed_gain。移动速度及衰减、接斧刷新冷却、法力消耗和战斗冷却留待后续接线。',
    actionKey: 'execute_attack_speed_gain',
    actionName: '执行血性冲刺攻击速度',
    effectKey: 'attack_speed_gain',
    resultKey: 'attribute',
    valueKey: 'attack_speed_gain_ratio',
    durationParameterKey: 'attack_speed_duration_ms',
    omitted: ['移动速度及衰减', '接斧刷新冷却', '法力消耗和战斗冷却']
  }),
  activeEffect({
    id: 'garen',
    name: '盖伦 Q',
    directory: '盖伦Q',
    ownerKey: 'champion_garen',
    skillKey: 'garen_q',
    sourceFiles: ['数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第六批/完整候选.json'],
    ruleName: '致命打击主动使用',
    description: '接收 garen_q 主动使用；执行已有 move_speed。强化普攻伤害与沉默、移除减速、法力消耗和战斗冷却留待后续接线。',
    actionKey: 'execute_move_speed',
    actionName: '执行致命打击移动速度',
    effectKey: 'move_speed',
    resultKey: 'move_speed',
    valueKey: 'move_speed_ratio',
    durationParameterKey: 'move_duration_ms',
    omitted: ['强化普攻伤害与沉默', '移除减速', '战斗冷却']
  }),
  activeEffect({
    id: 'kogmaw',
    name: '克格莫 W',
    directory: '克格莫W',
    ownerKey: 'champion_kogmaw',
    skillKey: 'kogmaw_w',
    sourceFiles: ['数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第十批/完整候选.json'],
    ruleName: '生化弹幕主动使用',
    description: '接收 kogmaw_w 主动使用；执行已有 attack_range。攻击附带目标最大生命魔法伤害、法力消耗和战斗冷却留待后续接线。',
    actionKey: 'execute_attack_range',
    actionName: '执行生化弹幕攻击距离',
    effectKey: 'attack_range',
    resultKey: 'attribute',
    valueKey: 'bonus_attack_range',
    durationParameterKey: 'duration_ms',
    omitted: ['攻击附带目标最大生命魔法伤害', '法力消耗和战斗冷却']
  }),
  activeEffect({
    id: 'monkeyking',
    name: '孙悟空 E',
    directory: '孙悟空E',
    ownerKey: 'champion_monkeyking',
    skillKey: 'monkeyking_e',
    sourceFiles: ['数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十四批/最终验收/候选过程/修订三/完整候选.json'],
    ruleName: '腾云突击主动使用',
    description: '接收 monkeyking_e 已接受的主动施放；执行已有 self_attack_speed。分身与额外目标、突进伤害、法力消耗和战斗冷却留待后续接线。',
    actionKey: 'execute_self_attack_speed',
    actionName: '执行腾云突击自身攻击速度',
    effectKey: 'self_attack_speed',
    resultKey: 'attribute',
    valueKind: 'FORMULA',
    valueKey: 'attack_speed_ratio',
    durationParameterKey: 'attack_speed_duration_ms',
    omitted: ['分身与额外目标攻击速度', '突进伤害', '法力消耗和战斗冷却']
  }),
  activeEffect({
    id: 'drmundo',
    name: '蒙多医生 R',
    directory: '蒙多医生R',
    ownerKey: 'champion_drmundo',
    skillKey: 'drmundo_r',
    sourceFiles: ['数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第二十五批/修订一/完整候选.json'],
    ruleName: '极限剂量主动使用',
    description: '接收 drmundo_r 主动使用；执行已有 speed_boost。当前生命消耗或回复、最大生命提升、持续治疗及高等级强化留待后续接线。',
    actionKey: 'execute_speed_boost',
    actionName: '执行极限剂量移动速度',
    effectKey: 'speed_boost',
    resultKey: 'attribute',
    valueKey: 'speed_boost_ratio',
    durationParameterKey: 'duration_ms',
    omitted: ['当前生命消耗或回复', '最大生命提升与持续治疗', '高等级强化和战斗冷却']
  })
];

export const deferredConfigs = [
  {
    id: 'ashe',
    skillKey: 'ashe_q',
    ruleKey: 'on_used',
    reason: '射手的专注必须先满足四层全神贯注；当前 SKILL_USED 没有层数资格，不能证明该事件只代表合法激活，直接执行攻速会绕过门槛。'
  },
  {
    id: 'teemo',
    skillKey: 'teemo_w',
    ruleKey: 'on_used',
    reason: 'active_move_speed 保存的是主动期间完整移速；当前规则不能移除被动移速、在三秒后按受击资格恢复，直接执行会在被动接线后产生重复叠加。'
  },
  {
    id: 'volibear',
    skillKey: 'volibear_e',
    ruleKey: 'on_used',
    reason: 'shield 在延时雷云落地且沃利贝尔处于区域内才获得；当前 SKILL_USED 没有落地时点与站位资格，直接执行会错误地无条件加盾。'
  },
  {
    id: 'rumble',
    skillKey: 'rumble_w',
    ruleKey: 'on_used',
    reason: '普通与危险温度效果必须互斥；当前事件没有热量快照，护盾还依赖 source_health_for_shield 动态输入，单条无条件规则不能完整且稳定地表达。'
  }
];

for (const config of targetConfigs) {
  config.body.eventSource.detail.sourceSkillKey = config.skillKey;
}
