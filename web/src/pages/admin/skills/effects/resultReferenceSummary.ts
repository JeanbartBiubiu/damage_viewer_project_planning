import { type NumericValue } from '../../../../types/numericValue';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { StatusKind } from '../../../../types/status';
import {
  AFFECTED_SKILL_SCOPE_MODE_LABELS,
  ATTRIBUTE_CHANGE_OPERATION_LABELS,
  COOLDOWN_CHANGE_OPERATION_LABELS,
  RESOURCE_CHANGE_OPERATION_LABELS,
  SKILL_EFFECT_LIFECYCLE_OPERATION_LABELS,
  SKILL_EFFECT_MODIFIER_OPERATION_LABELS,
  SKILL_EFFECT_TARGET_LABELS,
  SKILL_HASTE_MODIFIER_OPERATION_LABELS,
  STATUS_OPERATION_LABELS,
  isMovementSlowApply,
  type SkillEffectResultDraft
} from './effectForm';
import {
  CATALOG_FAILED_TEXT,
  CATALOG_LOADING_TEXT,
  CATALOG_MISSING_TEXT,
  catalogReferenceItems,
  catalogStatusText,
  type CatalogEntry,
  type CatalogLoadState,
  type ReferenceItem
} from '../../shared/referenceListModel';

export const UNCONFIGURED_TEXT = '未配置';
export const NO_VALUE_TEXT = '无数值';
export const MILLISECONDS_UNIT = '毫秒';
export const RATIO_UNIT = '比例';
export const STACKS_UNIT = '层';
export const COUNTS_UNIT = '次';
export const SLOW_RATIO_LABEL = '减速比例';

export type ResultReferenceCatalogs = {
  parametersLoadState?: CatalogLoadState;
  formulasLoadState?: CatalogLoadState;
  attributesLoadState?: CatalogLoadState;
  statusesLoadState?: CatalogLoadState;
  effectsLoadState?: CatalogLoadState;
  skillsLoadState?: CatalogLoadState;
  skillCategoriesLoadState?: CatalogLoadState;
  parameters?: ReadonlyMap<string, CatalogEntry>;
  formulas?: ReadonlyMap<string, CatalogEntry>;
  attributes?: ReadonlyMap<string, CatalogEntry>;
  statuses?: ReadonlyMap<string, CatalogEntry & { statusKind?: StatusKind | null }>;
  effects?: ReadonlyMap<string, CatalogEntry>;
  skills?: ReadonlyMap<string, CatalogEntry>;
  skillCategories?: ReadonlyMap<string, CatalogEntry>;
};

export type ResultReferenceScope = {
  all: boolean;
  modeLabel: string;
  loadState: CatalogLoadState;
  items: ReferenceItem[];
};

export type ResultReferenceSummaryModel = {
  target: string;
  segments: string[];
  scope?: ResultReferenceScope;
};

const STATUS_TEXTS = new Set([
  UNCONFIGURED_TEXT,
  CATALOG_LOADING_TEXT,
  CATALOG_FAILED_TEXT,
  '待填写',
  '待选择',
  '—'
]);

export function isUnitSafeNumericText(text: string): boolean {
  if (!text || STATUS_TEXTS.has(text) || text.startsWith(`${CATALOG_MISSING_TEXT}（`)) return false;
  return true;
}

export function attachDisplayUnit(text: string, unit: string | null | undefined): string {
  if (!unit || !isUnitSafeNumericText(text)) return text;
  return `${text} ${unit}`;
}

export function formatCatalogKey(
  key: string,
  loadState: CatalogLoadState,
  entries?: ReadonlyMap<string, CatalogEntry>
): string {
  if (!key) return '—';
  const status = catalogStatusText(loadState);
  if (status) return status;
  const items = catalogReferenceItems([key], 'ready', entries);
  const item = items[0];
  if (!item) return `${CATALOG_MISSING_TEXT}（${key}）`;
  if (item.missing || !item.name) return `${CATALOG_MISSING_TEXT}（${key}）`;
  return `${item.name}（${item.key}）${item.disabled ? '（已停用）' : ''}`;
}

function configuredBound(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function authoredNumericSummary(
  value: NumericValue | null | undefined,
  options: {
    parametersLoadState?: CatalogLoadState;
    formulasLoadState?: CatalogLoadState;
    parameterNames?: ReadonlyMap<string, CatalogEntry>;
    formulaNames?: ReadonlyMap<string, CatalogEntry>;
    multiplier?: string;
    min?: string;
    max?: string;
    unit?: string | null;
  } = {}
): string {
  if (!value) return UNCONFIGURED_TEXT;
  const extras: string[] = [];
  const multiplier = configuredBound(options.multiplier ?? '');
  if (multiplier !== null) extras.push(`× ${multiplier}`);
  const min = configuredBound(options.min ?? '');
  const max = configuredBound(options.max ?? '');
  if (min !== null) extras.push(`下界 ${min}`);
  if (max !== null) extras.push(`上界 ${max}`);
  const extraText = extras.length ? ` ${extras.join(' ')}` : '';
  if (value.kind === 'FIXED') {
    if (!Number.isFinite(value.value)) return '待填写';
    return attachDisplayUnit(`${value.value}${extraText}`, options.unit);
  }
  const isParameter = value.kind === 'PARAMETER';
  const key = isParameter ? value.parameterKey : value.formulaKey;
  const source = formatCatalogKey(
    key,
    isParameter ? options.parametersLoadState : options.formulasLoadState,
    isParameter ? options.parameterNames : options.formulaNames
  );
  if (!isUnitSafeNumericText(source)) return source;
  return attachDisplayUnit(`${source}${extraText}`, options.unit);
}

export function parameterCatalogEntries(parameters: readonly SkillParameter[]): Map<string, CatalogEntry> {
  const names = new Map<string, CatalogEntry>();
  for (const item of parameters) {
    names.set(item.parameterKey, { name: item.name });
  }
  return names;
}

function numericOptions(result: SkillEffectResultDraft, catalogs: ResultReferenceCatalogs, unit?: string | null) {
  return {
    parametersLoadState: catalogs.parametersLoadState,
    formulasLoadState: catalogs.formulasLoadState,
    parameterNames: catalogs.parameters,
    formulaNames: catalogs.formulas,
    multiplier: result.fixedMultiplier,
    min: result.fixedMinValue,
    max: result.fixedMaxValue,
    unit
  };
}

function scopeFor(result: SkillEffectResultDraft, catalogs: ResultReferenceCatalogs): ResultReferenceScope {
  const scope = result.affectedSkillScope;
  if (scope.mode === 'ALL') {
    return {
      all: true,
      modeLabel: AFFECTED_SKILL_SCOPE_MODE_LABELS.ALL,
      loadState: 'ready',
      items: []
    };
  }
  if (scope.mode === 'SKILLS') {
    return {
      all: false,
      modeLabel: AFFECTED_SKILL_SCOPE_MODE_LABELS.SKILLS,
      loadState: catalogs.skillsLoadState,
      items: catalogReferenceItems(scope.skillKeys, catalogs.skillsLoadState, catalogs.skills)
    };
  }
  return {
    all: false,
    modeLabel: AFFECTED_SKILL_SCOPE_MODE_LABELS.CATEGORIES,
    loadState: catalogs.skillCategoriesLoadState,
    items: catalogReferenceItems(scope.skillCategoryKeys, catalogs.skillCategoriesLoadState, catalogs.skillCategories)
  };
}

function resolvedStatusKind(result: SkillEffectResultDraft, catalogs: ResultReferenceCatalogs): StatusKind | null {
  if (result.statusKind) return result.statusKind;
  if (catalogs.statusesLoadState !== 'ready' || !result.statusKey) return null;
  return catalogs.statuses?.get(result.statusKey)?.statusKind ?? null;
}

export function buildResultReferenceSummary(
  result: SkillEffectResultDraft,
  catalogs: ResultReferenceCatalogs = {}
): ResultReferenceSummaryModel {
  const target = SKILL_EFFECT_TARGET_LABELS[result.target];
  const numeric = (unit?: string | null) => authoredNumericSummary(result.value, numericOptions(result, catalogs, unit));
  switch (result.resultType) {
    case 'DAMAGE':
      return { target, segments: [result.damageTypeKey || '—', numeric()] };
    case 'DIRECT_HEAL':
    case 'NORMAL_SHIELD':
      return { target, segments: [numeric()] };
    case 'ATTRIBUTE_CHANGE':
      return {
        target,
        segments: [
          result.attributeOperation ? ATTRIBUTE_CHANGE_OPERATION_LABELS[result.attributeOperation] : '—',
          formatCatalogKey(result.attributeKey, catalogs.attributesLoadState, catalogs.attributes),
          numeric()
        ]
      };
    case 'RESOURCE_CHANGE':
      return {
        target,
        segments: [
          result.resourceOperation ? RESOURCE_CHANGE_OPERATION_LABELS[result.resourceOperation] : '—',
          formatCatalogKey(result.attributeKey, catalogs.attributesLoadState, catalogs.attributes),
          numeric()
        ]
      };
    case 'COOLDOWN_CHANGE': {
      const operation = result.cooldownOperation
        ? COOLDOWN_CHANGE_OPERATION_LABELS[result.cooldownOperation]
        : '—';
      if (result.cooldownOperation === 'RESET') {
        return { target, segments: [operation, NO_VALUE_TEXT], scope: scopeFor(result, catalogs) };
      }
      const unit = result.cooldownOperation === 'REDUCE_REMAINING_RATIO'
        ? RATIO_UNIT
        : (result.cooldownOperation === 'REDUCE'
          || result.cooldownOperation === 'INCREASE'
          || result.cooldownOperation === 'SET_REMAINING')
          ? MILLISECONDS_UNIT
          : null;
      return { target, segments: [operation, numeric(unit)], scope: scopeFor(result, catalogs) };
    }
    case 'SKILL_HASTE_MODIFIER': {
      const operation = result.skillHasteOperation
        ? SKILL_HASTE_MODIFIER_OPERATION_LABELS[result.skillHasteOperation]
        : '—';
      return { target, segments: [operation, numeric()], scope: scopeFor(result, catalogs) };
    }
    case 'STATUS_OPERATION': {
      const statusKind = resolvedStatusKind(result, catalogs);
      const slowApply = isMovementSlowApply({ ...result, statusKind });
      const operation = result.statusOperation ? STATUS_OPERATION_LABELS[result.statusOperation] : '—';
      const status = formatCatalogKey(result.statusKey, catalogs.statusesLoadState, catalogs.statuses);
      if (slowApply) {
        return { target, segments: [operation, status, SLOW_RATIO_LABEL, numeric(RATIO_UNIT)] };
      }
      return { target, segments: [operation, status] };
    }
    case 'LIFECYCLE_OPERATION': {
      const operation = result.lifecycleOperation
        ? SKILL_EFFECT_LIFECYCLE_OPERATION_LABELS[result.lifecycleOperation]
        : '—';
      const effect = formatCatalogKey(result.targetEffectKey, catalogs.effectsLoadState, catalogs.effects);
      if (result.lifecycleOperation === 'REFRESH' || result.lifecycleOperation === 'REMOVE' || !result.lifecycleOperation) {
        return { target, segments: [operation, result.lifecycleOperation ? NO_VALUE_TEXT : '—', effect] };
      }
      const unit = result.lifecycleOperation === 'EXTEND_DURATION' ? MILLISECONDS_UNIT : STACKS_UNIT;
      return { target, segments: [operation, numeric(unit), effect] };
    }
    case 'DAMAGE_MODIFIER':
    case 'HEALING_MODIFIER':
    case 'SHIELD_RECEIVED_MODIFIER': {
      const operation = result.modifierOperation
        ? SKILL_EFFECT_MODIFIER_OPERATION_LABELS[result.modifierOperation]
        : '—';
      return { target, segments: [operation, numeric(RATIO_UNIT)] };
    }
    case 'DAMAGE_IMMUNITY':
      return { target, segments: [result.damageTypeKey || '—'] };
    case 'HEALTH_FLOOR':
      return {
        target,
        segments: [
          formatCatalogKey(result.attributeKey, catalogs.attributesLoadState, catalogs.attributes),
          numeric()
        ]
      };
    case 'EXECUTE':
      return {
        target,
        segments: [
          formatCatalogKey(result.attributeKey, catalogs.attributesLoadState, catalogs.attributes),
          numeric()
        ]
      };
    case 'HIT_LINK_APPLICATION':
    case 'ATTACK_LINK_APPLICATION':
      return { target, segments: [numeric(COUNTS_UNIT)] };
    case 'SPELL_SHIELD':
      return { target, segments: ['—'] };
    case 'ATTACK_TIMER_RESET':
      return { target, segments: ['清零普通攻击间隔的剩余等待'] };
    default: {
      const unexpected: never = result.resultType;
      return { target, segments: [unexpected] };
    }
  }
}
