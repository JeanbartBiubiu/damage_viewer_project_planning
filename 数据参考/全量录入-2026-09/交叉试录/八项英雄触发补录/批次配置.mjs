export const expectedCurrent = {
  skillCount: 1062,
  ruleCount: 104,
  sourceInitializedCount: 24,
  finalRuleCount: 108
};

export const targetConfigs = [
  {
    id: 'garen', name: '盖伦 W', directoryName: '盖伦W触发补录',
    ownerKind: 'character', ownerKey: 'champion_garen', skillKey: 'garen_w', ruleKey: 'on_used',
    eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'garen_w', useKind: 'ACTIVE' },
    conditionKind: 'NONE', actionEffectKeys: ['upfront_shield', 'upfront_tenacity'],
    effectChecks: [
      { effectKey: 'upfront_shield', resultKey: 'shield', resultTarget: 'SOURCE', valueKind: 'FORMULA', valueKey: 'shield', durationParameterKey: 'upfront_duration_ms' },
      { effectKey: 'upfront_tenacity', resultKey: 'tenacity', resultTarget: 'SOURCE', valueKind: 'PARAMETER', valueKey: 'tenacity_ratio', durationParameterKey: 'upfront_duration_ms' }
    ]
  },
  {
    id: 'vex', name: '愁云使者 W', directoryName: '愁云使者W触发补录',
    ownerKind: 'character', ownerKey: 'champion_vex', skillKey: 'vex_w', ruleKey: 'on_used',
    eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'vex_w', useKind: 'ACTIVE' },
    conditionKind: 'NONE', actionEffectKeys: ['self_shield'],
    effectChecks: [{ effectKey: 'self_shield', resultKey: 'shield', resultTarget: 'SOURCE', valueKind: 'FORMULA', valueKey: 'shield_value' }]
  },
  {
    id: 'kassadin', name: '虚空行者 Q', directoryName: '虚空行者Q护盾触发补录',
    ownerKind: 'character', ownerKey: 'champion_kassadin', skillKey: 'kassadin_q', ruleKey: 'on_used',
    eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'kassadin_q', useKind: 'ACTIVE' },
    conditionKind: 'NONE', actionEffectKeys: ['magic_shield'],
    effectChecks: [{ effectKey: 'magic_shield', resultKey: 'shield', resultTarget: 'SOURCE', valueKind: 'FORMULA', valueKey: 'magic_shield_amount', absorbedDamageTypeKey: 'magic' }]
  },
  {
    id: 'ivern', name: '艾翁 Q', directoryName: '艾翁Q触发补录',
    ownerKind: 'character', ownerKey: 'champion_ivern', skillKey: 'ivern_q', ruleKey: 'actual_hit',
    eventType: 'SKILL_HIT', eventDetail: { sourceSkillKey: 'ivern_q' },
    conditionKind: 'CHAMPION', actionEffectKeys: ['damage'],
    effectChecks: [{ effectKey: 'damage', resultKey: 'damage', resultTarget: 'TARGET', valueKind: 'FORMULA', valueKey: 'magic_damage' }]
  }
];
