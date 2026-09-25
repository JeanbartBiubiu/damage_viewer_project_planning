import { describe, expect, it } from 'vitest';
import { fixedValue, formulaValue, parameterValue } from '../../../../types/numericValue';
import { createEmptyResultDraft } from './effectForm';
import {
  CATALOG_FAILED_TEXT,
  CATALOG_LOADING_TEXT,
  CATALOG_MISSING_TEXT
} from '../../shared/referenceListModel';
import {
  MILLISECONDS_UNIT,
  NO_VALUE_TEXT,
  RATIO_UNIT,
  SLOW_RATIO_LABEL,
  STACKS_UNIT,
  UNCONFIGURED_TEXT,
  attachDisplayUnit,
  authoredNumericSummary,
  buildResultReferenceSummary,
  damageModifierFilterSummary,
  formatDamageModifierCondition,
  formatCatalogKey,
  isUnitSafeNumericText,
  parameterCatalogEntries
} from './resultReferenceSummary';

describe('结果引用摘要数值', () => {
  it('固定 0 显示 0，未配置不补 0，状态文字后不加毫秒', () => {
    expect(authoredNumericSummary(fixedValue(0), { unit: MILLISECONDS_UNIT })).toBe(`0 ${MILLISECONDS_UNIT}`);
    expect(authoredNumericSummary(null, { unit: MILLISECONDS_UNIT })).toBe(UNCONFIGURED_TEXT);
    expect(authoredNumericSummary(null)).toBe(UNCONFIGURED_TEXT);
    expect(isUnitSafeNumericText(UNCONFIGURED_TEXT)).toBe(false);
    expect(isUnitSafeNumericText(CATALOG_FAILED_TEXT)).toBe(false);
    expect(isUnitSafeNumericText(`${CATALOG_MISSING_TEXT}（cd）`)).toBe(false);
    expect(attachDisplayUnit(CATALOG_FAILED_TEXT, MILLISECONDS_UNIT)).toBe(CATALOG_FAILED_TEXT);
    expect(attachDisplayUnit(UNCONFIGURED_TEXT, MILLISECONDS_UNIT)).toBe(UNCONFIGURED_TEXT);
  });

  it('参数和公式显示名称与稳定键及已有倍率上下界，不把失败或键当成名称', () => {
    const parameters = parameterCatalogEntries([
      {
        gameId: 'g', skillKey: 'q', parameterKey: 'cooldown_ms', name: '冷却量',
        valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 100, levelValues: null,
        description: null, sortOrder: 0, createdAt: '', updatedAt: ''
      }
    ]);
    expect(authoredNumericSummary(parameterValue('cooldown_ms'), {
      parametersLoadState: 'ready',
      parameterNames: parameters,
      multiplier: '2',
      min: '0',
      max: '4000',
      unit: MILLISECONDS_UNIT
    })).toBe(`冷却量（cooldown_ms） × 2 下界 0 上界 4000 ${MILLISECONDS_UNIT}`);
    expect(authoredNumericSummary(formulaValue('reduce_ms'), {
      formulasLoadState: 'ready',
      formulaNames: new Map([['reduce_ms', { name: '减少量' }]]),
      multiplier: '1',
      unit: MILLISECONDS_UNIT
    })).toBe(`减少量（reduce_ms） × 1 ${MILLISECONDS_UNIT}`);
    expect(authoredNumericSummary(parameterValue('cooldown_ms'), {
      parametersLoadState: undefined,
      unit: MILLISECONDS_UNIT
    })).toBe(CATALOG_LOADING_TEXT);
    expect(authoredNumericSummary(parameterValue('cooldown_ms'), {
      parametersLoadState: 'failed',
      unit: MILLISECONDS_UNIT
    })).toBe(CATALOG_FAILED_TEXT);
    expect(authoredNumericSummary(parameterValue('missing_cd'), {
      parametersLoadState: 'ready',
      parameterNames: parameters,
      unit: MILLISECONDS_UNIT
    })).toBe(`${CATALOG_MISSING_TEXT}（missing_cd）`);
    expect(formatCatalogKey('atk', 'ready', new Map([['atk', { name: '攻击', status: 'DISABLED' }]])))
      .toBe('攻击（atk）（已停用）');
  });
});

describe('结果引用摘要语义', () => {
  it('伤害摘要保留数值及参数来源，不给伤害量猜单位', () => {
    const damage = createEmptyResultDraft('DAMAGE');
    damage.damageTypeKey = 'physical';
    damage.value = fixedValue(0);
    damage.fixedMultiplier = '1';
    expect(buildResultReferenceSummary(damage).segments).toEqual(['physical', '0 × 1']);
    damage.value = parameterValue('base_damage');
    expect(buildResultReferenceSummary(damage, {
      parametersLoadState: 'ready', parameters: new Map([['base_damage', { name: '基础伤害' }]])
    }).segments).toEqual(['physical', '基础伤害（base_damage） × 1']);
  });
  it('冷却毫秒、比例、重置和真实零互不混用', () => {
    const reduce = createEmptyResultDraft('COOLDOWN_CHANGE');
    reduce.cooldownOperation = 'REDUCE';
    reduce.value = fixedValue(0);
    reduce.fixedMultiplier = '1';
    expect(buildResultReferenceSummary(reduce).segments).toEqual(['减少', `0 × 1 ${MILLISECONDS_UNIT}`]);
    expect(buildResultReferenceSummary(reduce).scope?.all).toBe(true);

    const ratio = createEmptyResultDraft('COOLDOWN_CHANGE');
    ratio.cooldownOperation = 'REDUCE_REMAINING_RATIO';
    ratio.value = fixedValue(0.7);
    ratio.fixedMultiplier = '1';
    expect(buildResultReferenceSummary(ratio).segments.join(' · ')).toContain(`0.7 × 1 ${RATIO_UNIT}`);
    expect(buildResultReferenceSummary(ratio).segments.join(' · ')).not.toContain(MILLISECONDS_UNIT);

    const reset = createEmptyResultDraft('COOLDOWN_CHANGE');
    reset.cooldownOperation = 'RESET';
    reset.value = null;
    expect(buildResultReferenceSummary(reset).segments).toEqual(['重置为可用', NO_VALUE_TEXT]);

    const remaining = createEmptyResultDraft('COOLDOWN_CHANGE');
    remaining.cooldownOperation = 'SET_REMAINING';
    remaining.value = fixedValue(0);
    remaining.fixedMultiplier = '1';
    expect(buildResultReferenceSummary(remaining).segments[1]).toBe(`0 × 1 ${MILLISECONDS_UNIT}`);
  });

  it('生命周期延长用毫秒，层数用层标签；减速比例仅限普通减速施加', () => {
    const extend = createEmptyResultDraft('LIFECYCLE_OPERATION');
    extend.lifecycleOperation = 'EXTEND_DURATION';
    extend.value = fixedValue(1000);
    extend.fixedMultiplier = '1';
    extend.targetEffectKey = 'buff';
    const extendSummary = buildResultReferenceSummary(extend, {
      effectsLoadState: 'ready',
      effects: new Map([['buff', { name: '增益' }]])
    });
    expect(extendSummary.segments).toEqual(['延长剩余时长', `1000 × 1 ${MILLISECONDS_UNIT}`, '增益（buff）']);

    const stacks = createEmptyResultDraft('LIFECYCLE_OPERATION');
    stacks.lifecycleOperation = 'INCREASE';
    stacks.value = fixedValue(2);
    stacks.fixedMultiplier = '1';
    stacks.targetEffectKey = 'buff';
    expect(buildResultReferenceSummary(stacks, {
      effectsLoadState: 'ready',
      effects: new Map([['buff', { name: '增益' }]])
    }).segments[1]).toBe(`2 × 1 ${STACKS_UNIT}`);

    const slow = createEmptyResultDraft('STATUS_OPERATION');
    slow.statusKey = 'slow';
    slow.statusKind = 'MOVEMENT_SLOW';
    slow.statusOperation = 'APPLY';
    slow.value = fixedValue(0);
    slow.fixedMultiplier = '1';
    const slowText = buildResultReferenceSummary(slow, {
      statusesLoadState: 'ready',
      statuses: new Map([['slow', { name: '寒冰', statusKind: 'MOVEMENT_SLOW' }]])
    }).segments.join(' · ');
    expect(slowText).toContain(SLOW_RATIO_LABEL);
    expect(slowText).toContain(`0 × 1 ${RATIO_UNIT}`);

    const stun = createEmptyResultDraft('STATUS_OPERATION');
    stun.statusKey = 'stun';
    stun.statusKind = 'STUN';
    stun.statusOperation = 'APPLY';
    stun.value = fixedValue(0.3);
    const stunText = buildResultReferenceSummary(stun, {
      statusesLoadState: 'ready',
      statuses: new Map([['stun', { name: '眩晕', statusKind: 'STUN' }]])
    }).segments.join(' · ');
    expect(stunText).not.toContain(SLOW_RATIO_LABEL);
    expect(stunText).toContain('眩晕（stun）');
  });

  it('作用对象保留，缺目录不会变成全部技能，失败与缺失分开', () => {
    const haste = createEmptyResultDraft('SKILL_HASTE_MODIFIER');
    haste.target = 'SOURCE';
    haste.skillHasteOperation = 'INCREASE';
    haste.value = fixedValue(8);
    haste.fixedMultiplier = '1';
    haste.affectedSkillScope = {
      mode: 'SKILLS',
      skillKeys: ['a', 'b', 'c', 'd'],
      skillCategoryKeys: []
    };
    const failed = buildResultReferenceSummary(haste, { skillsLoadState: 'failed' });
    expect(failed.target).toBe('施法者');
    expect(failed.scope?.all).toBe(false);
    expect(failed.scope?.modeLabel).toBe('指定技能');
    expect(catalogStatusTextFor(failed.scope?.loadState)).toBe(CATALOG_FAILED_TEXT);

    const missing = buildResultReferenceSummary(haste, {
      skillsLoadState: 'ready',
      skills: new Map([['a', { name: '甲' }]])
    });
    expect(missing.scope?.items.some((item) => item.key === 'd' && item.missing)).toBe(true);
    expect(missing.scope?.all).toBe(false);

    const all = createEmptyResultDraft('COOLDOWN_CHANGE');
    all.cooldownOperation = 'REDUCE';
    all.value = null;
    all.affectedSkillScope = { mode: 'ALL', skillKeys: [], skillCategoryKeys: [] };
    expect(buildResultReferenceSummary(all, { skillsLoadState: 'failed' }).scope?.all).toBe(true);
    expect(buildResultReferenceSummary(all).segments).toContain(UNCONFIGURED_TEXT);

    const modifier = createEmptyResultDraft('DAMAGE_MODIFIER');
    modifier.modifierOperation = 'DECREASE';
    modifier.value = fixedValue(0.25);
    modifier.fixedMultiplier = '1';
    expect(buildResultReferenceSummary(modifier).segments.join(' · ')).toContain(`0.25 × 1 ${RATIO_UNIT}`);
    expect(buildResultReferenceSummary(modifier).target).toBe('当前目标');
  });

  it('伤害修正摘要用实际生命属性、严格比较和门槛来源，不靠作者说明', () => {
    const modifier = createEmptyResultDraft('DAMAGE_MODIFIER');
    modifier.target = 'SOURCE';
    modifier.modifierDirection = 'DEALT';
    modifier.modifierOperation = 'INCREASE';
    modifier.value = parameterValue('damage_bonus');
    modifier.damageModifierCondition = {
      attributeKey: 'hp', comparator: 'LT', comparisonValue: parameterValue('health_threshold'),
      originalAttributeKey: 'hp'
    };
    const catalogs = {
      attributesLoadState: 'ready' as const,
      attributes: new Map([['hp', { name: '生命值' }]]),
      parametersLoadState: 'ready' as const,
      parameters: new Map([
        ['damage_bonus', { name: '增幅' }],
        ['health_threshold', { name: '生命门槛比例' }]
      ])
    };
    const summary = buildResultReferenceSummary(modifier, catalogs);
    expect(summary.target).toBe('施法者');
    expect(summary.segments.join(' · '))
      .toContain('仅本笔敌方英雄承受者 · 扣血前生命值（hp）当前比例严格低于生命门槛比例（health_threshold）');
    modifier.damageModifierCondition = {
      ...modifier.damageModifierCondition, comparator: 'GT', comparisonValue: fixedValue(0.6)
    };
    expect(buildResultReferenceSummary(modifier, catalogs).segments.join(' · '))
      .toContain('严格高于0.6');
    modifier.damageModifierCondition = null;
    expect(buildResultReferenceSummary(modifier, catalogs).segments.join(' · '))
      .not.toContain('本笔敌方英雄');
  });

  it('伤害修正过滤在全量和具体限定时均保留字段身份，门槛按目录状态显示', () => {
    const modifier = createEmptyResultDraft('DAMAGE_MODIFIER');
    expect(damageModifierFilterSummary({
      damageTypeKey: null,
      deliveryKind: modifier.damageFilterDeliveryKind,
      originKind: modifier.damageFilterOriginKind,
      criticalFilter: modifier.criticalFilter
    })).toEqual(['伤害类型：全部', '产生方式：全部', '来源性质：全部', '暴击筛选：全部']);

    modifier.damageTypeKey = 'physics';
    modifier.damageFilterDeliveryKind = 'BASIC_ATTACK';
    modifier.damageFilterOriginKind = 'DIRECT';
    modifier.criticalFilter = 'CRITICAL_ONLY';
    expect(damageModifierFilterSummary({
      damageTypeKey: modifier.damageTypeKey,
      deliveryKind: modifier.damageFilterDeliveryKind,
      originKind: modifier.damageFilterOriginKind,
      criticalFilter: modifier.criticalFilter
    })).toEqual(['伤害类型：physics', '产生方式：普通攻击', '来源性质：直接伤害', '暴击筛选：仅暴击']);

    modifier.damageModifierCondition = {
      attributeKey: 'hp', comparator: 'LT', comparisonValue: parameterValue('threshold_ratio'),
      originalAttributeKey: 'hp'
    };
    expect(formatDamageModifierCondition(modifier.damageModifierCondition))
      .toBe('仅本笔敌方英雄承受者 · 扣血前hp当前比例严格低于参数 threshold_ratio');
    expect(formatDamageModifierCondition(modifier.damageModifierCondition, {}))
      .toContain(CATALOG_LOADING_TEXT);
    expect(formatDamageModifierCondition(modifier.damageModifierCondition, {
      attributesLoadState: 'failed', parametersLoadState: 'failed'
    })).toContain(CATALOG_FAILED_TEXT);
    expect(formatDamageModifierCondition(null)).toBeNull();
  });
});

function catalogStatusTextFor(loadState: 'ready' | 'failed' | undefined) {
  if (loadState === undefined) return CATALOG_LOADING_TEXT;
  if (loadState === 'failed') return CATALOG_FAILED_TEXT;
  return null;
}
