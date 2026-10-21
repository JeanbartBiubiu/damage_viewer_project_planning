import { describe, expect, it } from 'vitest';
import type { SkillHitCandidate, SkillHitRuleGroup } from '../types/genericEngine';
import { compileSkillOncePerUse, validateHitRuleGroups, validateProviderOncePerUseScopes } from './skillOncePerUse';

const fail = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
const candidate = (key: string): SkillHitCandidate => ({ candidateKey: key, effectOccurrenceKey: 'rule:action',
  effectKey: 'effect', resultKey: key.split(':').at(-1)!, semantic: { resultType: 'DAMAGE', target: 'TARGET', moment: 'INSTANT' },
  spellShieldBlockScope: 'SKILL', operations: [{ operation: 'damage', target: 'target', amount: { op: 'const', value: 10 } }] });
const first = candidate('rule:a:first'), second = candidate('rule:b:second');
const group: SkillHitRuleGroup = { ruleKey: 'rule', candidateKeys: [first.candidateKey, second.candidateKey],
  oncePerUse: { groupKey: 'quota', scope: 'provider_target' } };

describe('同次使用额度完整规则组', () => {
  it('与自然监听共用单技能原键、多技能命名空间；未声明不造限制', () => {
    expect(compileSkillOncePerUse(null, 'limit', fail)).toBeUndefined();
    expect(compileSkillOncePerUse(undefined, 'limit', fail)).toBeUndefined();
    expect(compileSkillOncePerUse({ groupKey: 'quota', scope: 'TARGET' }, 'limit', fail)).toEqual(group.oncePerUse);
    expect(compileSkillOncePerUse({ groupKey: 'quota', scope: 'SKILL' }, 'limit', fail, key => `skill_${key}`))
      .toEqual({ groupKey: 'skill_quota', scope: 'provider' });
    expect(() => compileSkillOncePerUse({ groupKey: 'a'.repeat(64), scope: 'SKILL' }, 'limit', fail, key => `skill_${key}`)).toThrow('稳定标识');
  });
  it('完整连续候选保留各自operation输出边界，不合并其operations', () => {
    const before = structuredClone([first, second]);
    validateHitRuleGroups([first, second], [group], 'groups', fail);
    expect([first, second]).toEqual(before);
  });
  it.each([
    { ...group, candidateKeys: [] }, { ...group, candidateKeys: [first.candidateKey] },
    { ...group, candidateKeys: [first.candidateKey, first.candidateKey] },
    { ...group, candidateKeys: [second.candidateKey, first.candidateKey] },
    { ...group, candidateKeys: [first.candidateKey, 'rule:b:missing'] },
    { ...group, ruleKey: 'foreign' }
  ])('不接受缺失、乱序、重复及外来成员 %j', changed => {
    expect(() => validateHitRuleGroups([first, second], [changed], 'groups', fail)).toThrow();
  });
  it.each(['condition', 'repeat', 'resolve_skill_hit', 'abilityRef'])('额度直接执行门继续拒绝%s', kind => {
    const changed = structuredClone(second);
    if (kind === 'condition') changed.operations[0]!.condition = { op: 'const', value: 1 };
    else if (kind === 'abilityRef') changed.operations[0]!.abilityRef = 'source.provider[parent].ability[other]';
    else changed.operations[0]!.operation = kind;
    expect(() => validateHitRuleGroups([first, changed], [group], 'groups', fail)).toThrow('直接操作');
  });
  it.each(['participationCondition', 'eventValueConditions', 'participationProviderRef'])('不接受组内%s差异', key => {
    const changed = structuredClone(second);
    Object.assign(changed, key === 'participationCondition' ? { participationCondition: { op: 'const', value: 0 } }
      : key === 'eventValueConditions' ? { eventValueConditions: [{ key: 'blocked', comparator: 'eq', value: { op: 'const', value: 0 } }] }
        : { participationProviderRef: 'other_mount' });
    expect(() => validateHitRuleGroups([first, changed], [group], 'groups', fail)).toThrow('必须一致');
  });
  it('交叉组和同规则重复不能获得独立额度', () => {
    expect(() => validateHitRuleGroups([first, second], [group, group], 'groups', fail)).toThrow('重复');
  });
  it('最终实际父定义统一检查不同phase和普通listener的共享范围，不改变旧无组路径', () => {
    const provider = { providerKey: 'parent', kind: 'character', abilities: [
      { abilityKey: 'first', kind: 'active', operations: [{ operation: 'resolve_skill_hit', target: 'target', skillHit: {
        skillKey: 'skill', candidates: [first, second], ruleGroups: [group]
      } }] },
      { abilityKey: 'listener', kind: 'passive_listener', listenerSpec: { listenerKey: 'natural', eventMatcher: { all: ['event/skill_hit'] },
        oncePerUse: { groupKey: 'quota', scope: 'provider_target' as const } } }
    ] };
    expect(() => validateProviderOncePerUseScopes(provider, 'parent', fail)).not.toThrow();
    const conflict = structuredClone(provider);
    conflict.abilities[1]!.listenerSpec!.oncePerUse.scope = 'provider' as never;
    expect(() => validateProviderOncePerUseScopes(conflict, 'parent', fail)).toThrow('范围冲突');
    const phase = structuredClone(provider.abilities[0]!);
    phase.abilityKey = 'later'; phase.operations![0]!.skillHit.ruleGroups[0]!.oncePerUse.scope = 'provider';
    expect(() => validateProviderOncePerUseScopes({ ...provider, abilities: [...provider.abilities, phase] }, 'parent', fail)).toThrow('范围冲突');
    expect(() => validateProviderOncePerUseScopes({ ...provider, kind: 'status' }, 'parent', fail)).toThrow('静态父来源');
    expect(() => validateProviderOncePerUseScopes({ ...provider, abilities: provider.abilities.slice(1), kind: 'status' }, 'old', fail)).not.toThrow();
  });
});
