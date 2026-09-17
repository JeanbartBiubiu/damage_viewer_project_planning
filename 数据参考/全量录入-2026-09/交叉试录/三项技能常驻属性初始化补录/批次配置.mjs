export const expectedCurrent = {
  skillCount: 1062,
  ruleCount: 139,
  sourceInitializedCount: 26,
  finalRuleCount: 142,
  finalSourceInitializedCount: 29
};

const source10 = '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第十批/完整候选.json';
const source7 = '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第七批/完整候选.json';
const source46 = '数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十六批/最终验收/候选过程/修订一/完整候选.json';

export const targetConfigs = [
  {
    id: 'kogmaw_q_passive_attack_speed',
    ownerKey: 'champion_kogmaw',
    skillKey: 'kogmaw_q',
    skillName: '克格莫·腐蚀唾液',
    sourceFile: source10,
    sourceCandidateSha256: 'c08257b3fbd500d448b87d250e2a23c51d416a212e3d0398f29f9ce12b709cae',
    ruleKey: 'initialize_passive_attack_speed',
    ruleName: '初始化腐蚀唾液被动攻速',
    description: '来源对象的基础属性、技能与装备挂载及初始状态准备完成后，执行已有 passive_attack_speed，建立按当前技能等级取值的单层常驻自身攻速；来源初始化不表示后续技能升级，主动伤害、双抗削减、法力消耗、命中与法术护盾分支继续暂缓。',
    actions: [
      {
        effectKey: 'passive_attack_speed',
        parameterKey: 'passive_attack_speed_ratio',
        attributeKey: 'bonus_attack_speed_percent',
        actionKey: 'execute_passive_attack_speed',
        actionName: '执行腐蚀唾液被动攻速'
      }
    ]
  },
  {
    id: 'olaf_r_passive_resists',
    ownerKey: 'champion_olaf',
    skillKey: 'olaf_r',
    skillName: '奥拉夫·诸神黄昏',
    sourceFile: source7,
    sourceCandidateSha256: 'b3908f6740ea02c32828e52044b78f4c6ed080fea7d7a3e6188641fcf3766b35',
    ruleKey: 'initialize_passive_resists',
    ruleName: '初始化诸神黄昏被动双抗',
    description: '来源对象的基础属性、技能与装备挂载及初始状态准备完成后，按固定顺序执行已有 passive_armor 与 passive_magic_resistance，建立当前技能等级对应的单层常驻自身双抗；来源初始化不表示后续技能升级，主动攻击力、净化免控、持续延长、朝向加速和战斗命中继续暂缓。',
    actions: [
      {
        effectKey: 'passive_armor',
        parameterKey: 'passive_resist',
        attributeKey: 'armor',
        actionKey: 'execute_passive_armor',
        actionName: '执行诸神黄昏被动护甲'
      },
      {
        effectKey: 'passive_magic_resistance',
        parameterKey: 'passive_resist',
        attributeKey: 'magic_resistance',
        actionKey: 'execute_passive_magic_resistance',
        actionName: '执行诸神黄昏被动魔抗'
      }
    ]
  },
  {
    id: 'zaahen_r_armor_penetration',
    ownerKey: 'champion_zaahen',
    skillKey: 'zaahen_r',
    skillName: '亚恒·大赦',
    sourceFile: source46,
    sourceCandidateSha256: 'a5852733badb218a4a25a85bea06480657682d80ca34d4bfcff5691611cd76de',
    ruleKey: 'initialize_armor_penetration',
    ruleName: '初始化大赦常驻护甲穿透',
    description: '来源对象的基础属性、技能与装备挂载及初始状态准备完成后，执行已有 armor_penetration，建立当前技能等级对应的单层常驻自身护甲穿透；来源初始化不表示后续技能升级，主动伤害、实际伤害治疗、施放减伤、位移和生存链继续暂缓。',
    actions: [
      {
        effectKey: 'armor_penetration',
        parameterKey: 'armor_penetration_ratio',
        attributeKey: 'armor_pen_percent',
        actionKey: 'execute_armor_penetration',
        actionName: '执行大赦常驻护甲穿透'
      }
    ]
  }
];

export function buildRule(config) {
  return {
    ruleKey: config.ruleKey,
    name: config.ruleName,
    description: config.description,
    sortOrder: 10,
    eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} },
    conditionGroups: [],
    actions: config.actions.map((action, index) => ({
      actionKey: action.actionKey,
      name: action.actionName,
      actionType: 'EXECUTE_EFFECT',
      sortOrder: (index + 1) * 10,
      targetContext: 'EVENT_SOURCE',
      detail: { effectKey: action.effectKey },
      runtimeInputBindings: [],
      resultModifiers: []
    })),
    perTargetCooldown: null,
    maxTriggersPerProcess: null
  };
}
