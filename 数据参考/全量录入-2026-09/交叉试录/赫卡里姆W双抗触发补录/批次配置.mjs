export const expectedCurrent = {
  skillCount: 1062,
  ruleCount: 130,
  sourceInitializedCount: 24,
  finalRuleCount: 131
};

export const sourceFiles = [
  '数据参考/全量录入-2026-09/交叉试录/主负责人/英雄机制第二十七批/完整候选.json',
  '数据参考/全量录入-2026-09/交叉试录/主负责人/英雄机制第二十七批/输入包/参考资料/客户端原文/Hecarim.json.gz',
  '数据参考/全量录入-2026-09/交叉试录/主负责人/英雄机制第二十七批/输入包/参考资料/官方中文/Hecarim.json',
  '数据参考/全量录入-2026-09/交叉试录/主负责人/英雄机制第二十七批/输入包/参考资料/官方英文/Hecarim.json'
];

export const target = {
  id: 'hecarim_w',
  name: '赫卡里姆 W',
  ownerKey: 'champion_hecarim',
  ownerName: '赫卡里姆',
  skillKey: 'hecarim_w',
  skillName: '赫卡里姆·恐惧之灵',
  ruleKey: 'on_used',
  sourceFile: sourceFiles[0],
  parameterChecks: ['resistance_gain', 'duration_ms'],
  formulaChecks: ['magic_damage_total', 'self_healing_from_damage'],
  effectChecks: [
    {
      effectKey: 'armor_gain',
      resultKey: 'armor_gain',
      resultType: 'ATTRIBUTE_CHANGE',
      resultTarget: 'SOURCE',
      attributeKey: 'armor',
      valueParameterKey: 'resistance_gain',
      durationParameterKey: 'duration_ms'
    },
    {
      effectKey: 'magic_resistance_gain',
      resultKey: 'magic_resistance_gain',
      resultType: 'ATTRIBUTE_CHANGE',
      resultTarget: 'SOURCE',
      attributeKey: 'magic_resistance',
      valueParameterKey: 'resistance_gain',
      durationParameterKey: 'duration_ms'
    }
  ],
  omitted: [
    '四秒持续魔法伤害、周期节拍与附近目标枚举',
    '基于实际伤害的自身治疗、友军治疗与兵野治疗上限',
    '法力消耗、冷却、施法时间与战斗施放资格'
  ]
};

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

export function buildRule() {
  return {
    ruleKey: target.ruleKey,
    name: '恐惧之灵主动使用',
    description: '接收 hecarim_w 主动使用；依次执行已有 armor_gain 与 magic_resistance_gain 自身双抗效果。持续伤害、实际伤害治疗、周期节拍、附近目标、法力消耗、冷却和施法资格继续暂缓。管理保存不证明宿主已生产该事件。',
    sortOrder: 10,
    eventSource: {
      eventType: 'SKILL_USED',
      detail: {
        sourceSkillKey: target.skillKey,
        useKind: 'ACTIVE'
      }
    },
    conditionGroups: [],
    actions: [
      effectAction('execute_armor_gain', '执行恐惧之灵自身护甲', 'armor_gain', 10),
      effectAction('execute_magic_resistance_gain', '执行恐惧之灵自身魔抗', 'magic_resistance_gain', 20)
    ],
    perTargetCooldown: null,
    maxTriggersPerProcess: null
  };
}
