import { describe, expect, it } from 'vitest';
import { fixedValue, formulaValue, parameterValue, type NumericValue } from '../../../../types/numericValue';
import type { SkillEffect } from '../../../../types/skillEffect';
import type { SkillParameter } from '../../../../types/skillParameter';
import {
  applyStatusSelection, buildCreateSkillEffectRequest, buildUpdateSkillEffectRequest,
  clearHiddenResultFields, createEmptyResultDraft, isValueRuleVisible,
  listSpellShieldBlockScopeOptions, resolveResultStatusKind, skillEffectToCopyDraft,
  skillEffectToDraft, validateSkillEffectDraft, normalizeEffectDraftForDirtyComparison, type EffectFormCatalog
} from './effectForm';

const catalog: EffectFormCatalog = {
  parentSkillKey: 'ice_skill', formulas: [{ formulaKey: 'strength_formula' }], effects: [],
  attributes: [], damageTypes: [], skills: [], skillCategories: [], statuses: [
    { statusKey: 'arbitrary_control_key', statusKind: 'MOVEMENT_SLOW', status: 'ENABLED' },
    { statusKey: 'slow_named_stun', statusKind: 'STUN', status: 'ENABLED' },
    { statusKey: 'root_control', statusKind: 'ROOT', status: 'ENABLED' }
  ]
};
const parameter: SkillParameter = {
  gameId: 'lol', skillKey: 'ice_skill', parameterKey: 'strength_percent', name: '减速百分数',
  valueType: 'DECIMAL', valueMode: 'SKILL_LEVEL', fixedValue: null,
  levelValues: { '1': 45, '2': 50, '3': 55, '4': 60, '5': 65 }, description: null,
  sortOrder: 0, createdAt: '', updatedAt: ''
};

function effect(value: NumericValue = fixedValue(0.3), multiplier = 1): SkillEffect {
  return {
    gameId: 'lol', skillKey: 'ice_skill', effectKey: 'slow_effect', name: '普通减速',
    description: null, sortOrder: 0, createdAt: '', updatedAt: '',
    lifecycle: {
      durationValue: fixedValue(1000), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
      instanceScope: 'SOURCE_TARGET', reapplicationStackMode: 'KEEP',
      reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE',
      periodicIntervalValue: null, firstPeriodicExecution: null
    },
    results: [{
      resultKey: 'slow', name: '普通减速', resultType: 'STATUS_OPERATION', target: 'TARGET',
      description: null, sortOrder: 0, spellShieldBlockScope: 'RESULT',
      detail: { statusKey: 'arbitrary_control_key', operation: 'APPLY' },
      valueRule: { value, fixedMultiplier: multiplier, fixedMinValue: 0, fixedMaxValue: 1 },
      lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT',
        stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE', periodicExecutionMode: null }
    }]
  };
}
const options = { includeEffectKey: false, catalog, parameters: [parameter],
  parametersLoadState: 'ready' as const, catalogLoadState: { statuses: 'ready' as const, formulas: 'ready' as const } };

describe('普通移动减速往返与状态目录', () => {
  it.each([
    [fixedValue(0), 1], [fixedValue(0.3), 1], [parameterValue('strength_percent'), 0.01],
    [formulaValue('strength_formula'), 1]
  ] as const)('保留数值来源 %j 和倍率 %s，构建与复制均不丢失', (value, multiplier) => {
    const source = effect(value, multiplier);
    const draft = skillEffectToDraft(source);
    expect(draft.results[0].statusKind).toBeNull();
    expect(draft.results[0].value).toEqual(value);
    expect(isValueRuleVisible(draft.results[0])).toBe(true);
    const validation = validateSkillEffectDraft(draft, options);
    if (!validation.ok) throw new Error(JSON.stringify(validation));
    const saved = buildUpdateSkillEffectRequest(validation.normalized);
    expect(saved.results).toEqual(source.results);
    expect(saved.lifecycle).toEqual(source.lifecycle);
    expect(Object.keys(saved.results[0].detail).sort()).toEqual(['operation', 'statusKey']);
    const copy = skillEffectToCopyDraft(source);
    copy.effectKey = 'copy_slow';
    const copied = validateSkillEffectDraft(copy, { ...options, includeEffectKey: true });
    if (!copied.ok) throw new Error(JSON.stringify(copied));
    expect(buildCreateSkillEffectRequest(copied.normalized).results).toEqual(source.results);
    expect(saved.results[0].valueRule?.value).not.toBe(validation.normalized.results[0].valueRule?.value);
  });

  it('未知、缺失或加载失败保留数值与生命周期草稿并禁止保存', () => {
    const draft = skillEffectToDraft(effect());
    const before = structuredClone(draft);
    for (const state of ['failed', 'ready'] as const) {
      const validation = validateSkillEffectDraft(draft, { ...options,
        catalog: { ...catalog, statuses: [] }, catalogLoadState: { statuses: state } });
      expect(validation.ok).toBe(false);
      if (!validation.ok) expect(validation.resultErrors[0].fieldErrors.statusKey).toBeTruthy();
      expect(draft).toEqual(before);
      expect(clearHiddenResultFields(draft.results[0])).toEqual(draft.results[0]);
    }
    const ready = resolveResultStatusKind(draft.results[0], catalog.statuses);
    expect(ready.statusKind).toBe('MOVEMENT_SLOW');
    expect(ready.value).toEqual(fixedValue(0.3));
    expect(normalizeEffectDraftForDirtyComparison({ ...draft, results: [ready] }))
      .toEqual(normalizeEffectDraftForDirtyComparison(draft));
    expect(validateSkillEffectDraft(draft, options).ok).toBe(true);
  });

  it('重读时旧目录与已确认种类都不能绕过加载中阻断，加载完成后原草稿可保存', () => {
    const draft = skillEffectToDraft(effect());
    draft.results[0] = resolveResultStatusKind(draft.results[0], catalog.statuses);
    const before = structuredClone(draft);
    const loading = validateSkillEffectDraft(draft, {
      ...options, catalogLoadState: { statuses: undefined, formulas: 'ready' }
    });
    expect(catalog.statuses.length).toBeGreaterThan(0);
    expect(loading.ok).toBe(false);
    if (!loading.ok) expect(loading.resultErrors[0].fieldErrors.statusKey).toBe('状态目录尚未加载完成，请等待或重试。');
    expect(draft).toEqual(before);
    expect(validateSkillEffectDraft(draft, options).ok).toBe(true);
  });

  it('目录决定种类，切换减速施加初始化固定行为，切换眩晕、禁锢或移除清空数值', () => {
    const slow = applyStatusSelection(createEmptyResultDraft('STATUS_OPERATION'), 'arbitrary_control_key', 'MOVEMENT_SLOW');
    expect(slow).toMatchObject({ fixedMinValue: '0', fixedMaxValue: '1', fixedMultiplier: '1',
      lifecycleBehavior: { moment: 'PERSISTENT', stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE' } });
    expect(isValueRuleVisible(slow)).toBe(true);
    const configured = { ...slow, value: fixedValue(0.7) };
    for (const next of [
      applyStatusSelection(configured, 'slow_named_stun', 'STUN'),
      applyStatusSelection(configured, 'root_control', 'ROOT'),
      applyStatusSelection(configured, 'arbitrary_control_key', 'MOVEMENT_SLOW', 'REMOVE')
    ]) {
      expect(isValueRuleVisible(next)).toBe(false);
      expect(next).toMatchObject({ value: null, fixedMultiplier: '', fixedMinValue: '', fixedMaxValue: '' });
    }
    expect(listSpellShieldBlockScopeOptions(configured)).toEqual(['RESULT']);
    expect(clearHiddenResultFields({ ...configured, target: 'SOURCE', spellShieldBlockScope: 'RESULT' })
      .spellShieldBlockScope).toBe('');
    expect(applyStatusSelection({ ...createEmptyResultDraft('STATUS_OPERATION'), spellShieldBlockScope: 'EFFECT' },
      'arbitrary_control_key', 'MOVEMENT_SLOW').spellShieldBlockScope).toBe('');
  });

  it('禁锢复用无强度持续状态，保存和复制保留期限与当前结果法术护盾粒度', () => {
    const source = effect();
    source.results[0] = {
      ...source.results[0],
      name: '禁锢', detail: { statusKey: 'root_control', operation: 'APPLY' }, valueRule: null,
      lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: null, stackValueMode: null,
        reapplicationValueMode: null, periodicExecutionMode: null }
    };
    const draft = skillEffectToDraft(source);
    const resolved = resolveResultStatusKind(draft.results[0], catalog.statuses);
    expect(resolved.statusKind).toBe('ROOT');
    expect(isValueRuleVisible(resolved)).toBe(false);
    const validation = validateSkillEffectDraft(draft, options);
    if (!validation.ok) throw new Error(JSON.stringify(validation));
    const saved = buildUpdateSkillEffectRequest(validation.normalized);
    expect(saved.results).toEqual(source.results);
    expect(saved.lifecycle).toEqual(source.lifecycle);
    const copy = skillEffectToCopyDraft(source);
    copy.effectKey = 'copy_root';
    const copied = validateSkillEffectDraft(copy, { ...options, includeEffectKey: true });
    if (!copied.ok) throw new Error(JSON.stringify(copied));
    expect(buildCreateSkillEffectRequest(copied.normalized).results).toEqual(source.results);
    expect(listSpellShieldBlockScopeOptions(resolved)).toEqual(['RESULT']);
    draft.results[0].spellShieldBlockScope = 'SKILL';
    const cleared = validateSkillEffectDraft(draft, options);
    if (!cleared.ok) throw new Error(JSON.stringify(cleared));
    expect(buildUpdateSkillEffectRequest(cleared.normalized).results[0].spellShieldBlockScope).toBeNull();
  });

  it('保留停用状态的合法旧引用，新复制不可引入停用状态', () => {
    const disabled = { ...catalog, statuses: catalog.statuses.map((row) => ({ ...row, status: 'DISABLED' as const })) };
    expect(validateSkillEffectDraft(skillEffectToDraft(effect()), { ...options, catalog: disabled }).ok).toBe(true);
    const copy = skillEffectToCopyDraft(effect());
    copy.effectKey = 'copy_slow';
    expect(validateSkillEffectDraft(copy, { ...options, catalog: disabled }).ok).toBe(false);
  });

  it.each(['fixedMinValue', 'fixedMaxValue', 'value', 'duration', 'lifecycle', 'moment', 'valueReadMode',
    'stackValueMode', 'reapplicationValueMode', 'periodicExecutionMode', 'spellShieldBlockScope'])(
    '拒绝不合法的 %s', (field) => {
      const draft = skillEffectToDraft(effect());
      const result = draft.results[0];
      if (field === 'fixedMinValue') result.fixedMinValue = '';
      if (field === 'fixedMaxValue') result.fixedMaxValue = '2';
      if (field === 'value') result.value = null;
      if (field === 'duration') draft.lifecycle.durationValue = null;
      if (field === 'lifecycle') draft.lifecycleEnabled = false;
      if (field === 'moment') result.lifecycleBehavior.moment = 'APPLICATION';
      if (field === 'valueReadMode') result.lifecycleBehavior.valueReadMode = 'MOMENT_EVALUATION';
      if (field === 'stackValueMode') result.lifecycleBehavior.stackValueMode = 'PER_STACK';
      if (field === 'reapplicationValueMode') result.lifecycleBehavior.reapplicationValueMode = 'KEEP';
      if (field === 'periodicExecutionMode') result.lifecycleBehavior.periodicExecutionMode = 'ONCE_PER_INSTANCE';
      if (field === 'spellShieldBlockScope') result.spellShieldBlockScope = 'EFFECT';
      expect(validateSkillEffectDraft(draft, options).ok).toBe(false);
    }
  );
});
