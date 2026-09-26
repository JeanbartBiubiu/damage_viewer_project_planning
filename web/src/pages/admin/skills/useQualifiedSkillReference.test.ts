import { describe, expect, it } from 'vitest';
import { matchingOwnedReference } from './useQualifiedSkillReference';

describe('跨技能引用目录', () => {
  const states = [
    { skillKey: 'current', stateKey: 'shared', stateType: 'FLAG' },
    { skillKey: 'foreign', stateKey: 'shared', stateType: 'MODE' }
  ];
  const effects = [
    { skillKey: 'current', effectKey: 'mark', scope: 'SOURCE' },
    { skillKey: 'foreign', effectKey: 'mark', scope: 'TARGET' }
  ];

  it('过程操作、规则条件、动态绑定和状态事件按所属技能与状态键共同定位', () => {
    expect(matchingOwnedReference(states, 'foreign', 'shared', 'stateKey')?.stateType).toBe('MODE');
    expect(matchingOwnedReference(states, 'current', 'shared', 'stateKey')?.stateType).toBe('FLAG');
    expect(matchingOwnedReference(states, 'foreign', 'missing', 'stateKey')).toBeNull();
  });

  it('外部生命周期和战斗状态读取不借用本技能同名效果', () => {
    expect(matchingOwnedReference(effects, 'foreign', 'mark', 'effectKey')?.scope).toBe('TARGET');
    expect(matchingOwnedReference(effects, 'current', 'mark', 'effectKey')?.scope).toBe('SOURCE');
  });
});
