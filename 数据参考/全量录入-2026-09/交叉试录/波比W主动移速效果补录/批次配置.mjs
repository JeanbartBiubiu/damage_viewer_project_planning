export const expectedCurrent = {
  skillCount: 1062,
  ruleCount: 131,
  sourceInitializedCount: 24,
  effectCountBefore: 1,
  effectCountAfter: 2
};

export const sourceFiles = [
  '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第二十八批/完整候选.json',
  '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第二十八批/输入包/参考资料/客户端原文/Poppy.json.gz',
  '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第二十八批/输入包/参考资料/官方中文/Poppy.json',
  '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第二十八批/输入包/参考资料/官方英文/Poppy.json',
  '数据参考/全量录入-2026-09/交叉试录/赫卡里姆W双抗触发补录/07-独立GET回读.json'
];

export const target = {
  ownerKey: 'champion_poppy',
  ownerName: '波比',
  skillKey: 'poppy_w',
  skillName: '波比·坚定风采',
  effectKey: 'active_move_speed',
  resultKey: 'move_speed_gain',
  existingEffectKey: 'mana_cost',
  valueParameterKey: 'active_haste_percent_points',
  durationParameterKey: 'active_duration_ms',
  analogSkillKey: 'rakan_r',
  analogEffectKey: 'self_initial_move_speed',
  sourceFile: sourceFiles[0]
};

export function buildEffect() {
  return {
    effectKey: target.effectKey,
    name: '坚定风采主动移动速度',
    description: '主动使用后自身获得40%移动速度，持续2000毫秒；这里只保存效果定义，主动施法事件与反突进领域仍未接线。',
    sortOrder: 20,
    lifecycle: {
      durationValue: { kind: 'PARAMETER', parameterKey: target.durationParameterKey },
      maxStacksValue: { kind: 'FIXED', value: 1 },
      applicationStacksValue: { kind: 'FIXED', value: 1 },
      instanceScope: 'SOURCE',
      reapplicationStackMode: 'KEEP',
      reapplicationDurationMode: 'REFRESH_ALL',
      expiryMode: 'ALL_AT_ONCE',
      periodicIntervalValue: null,
      firstPeriodicExecution: null
    },
    results: [
      {
        resultKey: target.resultKey,
        name: '坚定风采主动移动速度',
        resultType: 'ATTRIBUTE_CHANGE',
        target: 'SOURCE',
        description: '将40个百分数点乘0.01后固定增加到来源对象的移动速度比例。',
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
          value: { kind: 'PARAMETER', parameterKey: target.valueParameterKey },
          fixedMultiplier: 0.01,
          fixedMinValue: 0,
          fixedMaxValue: null
        },
        detail: {
          attributeKey: 'move_speed_percent',
          operation: 'INCREASE',
          modifierZoneKey: 'attribute_flat_add'
        }
      }
    ]
  };
}
