import { describe, expect, it } from 'vitest';
import type { SkillEffect, SkillEffectLifecycleMoment } from '../../../../types/skillEffect';
import { parseSkillEffect } from '../../../../services/skillEffectClient';
import {
  applyResultTypeChange, buildCreateSkillEffectRequest, createEmptyResultDraft,
  skillEffectToDraft, validateSkillEffectDraft, type EffectFormCatalog
} from './effectForm';
import { canModifyResultValue, listAvailablePriorResultOutputs } from '../triggers/triggerRuleForm';

const effect: SkillEffect = {
  gameId: 'lol', skillKey: 'talon_q', effectKey: 'attack_timer_reset',
  name: '普攻计时重置', description: null, sortOrder: 10, lifecycle: null,
  createdAt: '2026-09-19T00:00:00Z', updatedAt: '2026-09-19T00:00:00Z',
  results: [{
    resultKey: 'reset', name: '普攻计时重置', resultType: 'ATTACK_TIMER_RESET',
    target: 'SOURCE', description: null, sortOrder: 10, detail: {},
    valueRule: null, lifecycleBehavior: null, spellShieldBlockScope: null
  }]
};
const catalog: EffectFormCatalog = {
  parentSkillKey: 'talon_q', formulas: [], effects: [], damageTypes: [], attributes: [],
  skills: [], skillCategories: [], statuses: [], modifierZones: []
};

function lifecycleEffect(moment: SkillEffectLifecycleMoment): SkillEffect {
  const result = structuredClone(effect);
  result.lifecycle = {
    durationValue: { kind: 'FIXED', value: 1000 },
    maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 },
    instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL',
    expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: moment === 'PERIODIC' ? { kind: 'FIXED', value: 100 } : null,
    firstPeriodicExecution: moment === 'PERIODIC' ? 'AFTER_INTERVAL' : null
  };
  result.results[0].lifecycleBehavior = {
    moment, valueReadMode: null, stackValueMode: null, reapplicationValueMode: null,
    periodicExecutionMode: moment === 'PERIODIC' ? 'ONCE_PER_INSTANCE' : null
  };
  return result;
}

describe('普攻计时重置管理契约', () => {
  it.each(['SOURCE', 'TARGET'] as const)('round trips the selected subject %s without a fabricated numeric value', (target) => {
    const source = structuredClone(effect); source.results[0].target = target;
    const parsed = parseSkillEffect(source);
    const validated = validateSkillEffectDraft(skillEffectToDraft(parsed), { includeEffectKey: true, catalog });
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error(JSON.stringify(validated));
    expect(buildCreateSkillEffectRequest(validated.normalized).results).toEqual(source.results);
    expect(listAvailablePriorResultOutputs(parsed.results[0])).toEqual([]);
    expect(canModifyResultValue(parsed.results[0])).toBe(false);
  });

  it.each(['APPLICATION', 'FULL_STACKS', 'PERIODIC', 'NATURAL_END', 'EARLY_REMOVE'] as const)(
    'preserves existing discrete lifecycle timing %s', (moment) => {
      const source = lifecycleEffect(moment);
      const validated = validateSkillEffectDraft(skillEffectToDraft(parseSkillEffect(source)), { includeEffectKey: true, catalog });
      expect(validated.ok).toBe(true);
      if (!validated.ok) throw new Error(JSON.stringify(validated));
      expect(buildCreateSkillEffectRequest(validated.normalized).results).toEqual(source.results);
    }
  );

  it('clears numeric, modifier, block and persistent fields when changing result type', () => {
    const previous = createEmptyResultDraft('SHIELD_RECEIVED_MODIFIER');
    previous.modifierZoneKey = 'shield_ratio'; previous.value = { kind: 'FIXED', value: 0.25 };
    previous.spellShieldBlockScope = 'RESULT';
    const reset = applyResultTypeChange(previous, 'ATTACK_TIMER_RESET');
    expect(reset.value).toBeNull(); expect(reset.fixedMultiplier).toBe('');
    expect(reset.modifierZoneKey).toBe(''); expect(reset.modifierOperation).toBe('');
    expect(reset.spellShieldBlockScope).toBe(''); expect(reset.lifecycleBehavior.moment).toBe('');
  });

  it.each(['operation', 'affectedSkillScope', 'modifierZoneKey', 'ratio'])(
    'rejects any unrelated detail including %s', (field) => {
      const bad = structuredClone(effect); Object.assign(bad.results[0].detail, { [field]: null });
      expect(() => parseSkillEffect(bad)).toThrow();
    }
  );

  it('rejects numeric values, spell blocking, persistent timing and detached lifecycle behavior', () => {
    const numeric = structuredClone(effect);
    Object.assign(numeric.results[0], { valueRule: { value: { kind: 'FIXED', value: 1 }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null } });
    expect(() => parseSkillEffect(numeric)).toThrow();
    const blocking = structuredClone(effect); blocking.results[0].target = 'TARGET'; blocking.results[0].spellShieldBlockScope = 'RESULT';
    expect(() => parseSkillEffect(blocking)).toThrow();
    expect(() => parseSkillEffect(lifecycleEffect('PERSISTENT'))).toThrow();
    const detached = lifecycleEffect('APPLICATION'); detached.lifecycle = null;
    expect(() => parseSkillEffect(detached)).toThrow();
    const absent = lifecycleEffect('APPLICATION'); absent.results[0].lifecycleBehavior = null;
    expect(() => parseSkillEffect(absent)).toThrow();
    const noDuration = lifecycleEffect('NATURAL_END'); noDuration.lifecycle!.durationValue = null;
    expect(() => parseSkillEffect(noDuration)).toThrow();
    const noPeriod = lifecycleEffect('PERIODIC'); noPeriod.lifecycle!.periodicIntervalValue = null;
    expect(() => parseSkillEffect(noPeriod)).toThrow();
  });

  it.each([
    { valueReadMode: 'APPLICATION_SNAPSHOT' }, { stackValueMode: 'SHARED' },
    { reapplicationValueMode: 'KEEP' }, { periodicExecutionMode: 'ONCE_PER_INSTANCE' }
  ])('rejects an invalid discrete behavior %j', (fields) => {
    const bad = lifecycleEffect('APPLICATION'); Object.assign(bad.results[0].lifecycleBehavior!, fields);
    expect(() => parseSkillEffect(bad)).toThrow();
  });

  it.each([
    { moment: 'UNKNOWN' }, { moment: undefined }, { extra: null }
  ])('rejects malformed lifecycle behavior %j', (fields) => {
    const bad = lifecycleEffect('APPLICATION');
    Object.assign(bad.results[0].lifecycleBehavior!, fields);
    expect(() => parseSkillEffect(JSON.parse(JSON.stringify(bad)))).toThrow();
  });

  it.each(['UNKNOWN', null, undefined])('rejects invalid periodic execution mode %s', (mode) => {
    const bad = lifecycleEffect('PERIODIC');
    Object.assign(bad.results[0].lifecycleBehavior!, { periodicExecutionMode: mode });
    expect(() => parseSkillEffect(JSON.parse(JSON.stringify(bad)))).toThrow();
  });

  it('accepts per-stack periodic execution and rejects an unknown first execution mode', () => {
    const source = lifecycleEffect('PERIODIC');
    source.results[0].lifecycleBehavior!.periodicExecutionMode = 'ONCE_PER_ACTIVE_STACK';
    expect(parseSkillEffect(source)).toEqual(source);
    Object.assign(source.lifecycle!, { firstPeriodicExecution: 'UNKNOWN' });
    expect(() => parseSkillEffect(source)).toThrow();
  });
});
