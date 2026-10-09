import type { SkillConfiguration, SkillConfigurationChange } from '../../../types/skillConfiguration';
import type { SkillParameter, UpdateSkillParameterRequest } from '../../../types/skillParameter';
import type { SkillFormula, UpdateSkillFormulaRequest } from '../../../types/skillFormula';
import type { SkillInternalState, CreateSkillInternalStateRequest, UpdateSkillInternalStateRequest } from '../../../types/skillInternalState';
import type { SkillEffect, CreateSkillEffectRequest, UpdateSkillEffectRequest } from '../../../types/skillEffect';
import type { SkillProcess, CreateSkillProcessRequest, UpdateSkillProcessRequest } from '../../../types/skillProcess';
import type { SkillTriggerRuleDetail, CreateSkillTriggerRuleRequest, UpdateSkillTriggerRuleRequest } from '../../../types/skillTriggerRule';
import type { Attribute } from '../../../types/attribute';
import type { UpdateSkillRequest } from '../../../types/skill';
import {
  buildUpdateSkillRequest,
  createEmptySkillDraft,
  skillToDraft,
  validateSkillDraft,
  type SkillDraft,
  type SkillDraftErrors
} from './skillForm';
import {
  buildCreateParameterRequest,
  buildUpdateParameterRequest,
  createEmptyParameterDraft,
  parameterToDraft,
  validateParameterDraft,
  type LevelRange,
  type SkillParameterDraft,
  type SkillParameterDraftErrors
} from './parameterForm';
import {
  buildCreateFormulaRequest,
  buildUpdateFormulaRequest,
  createEmptyFormulaDraft,
  formulaToDraft,
  validateFormulaDraft,
  type FormulaNodeIssue,
  type SkillFormulaDraft,
  type SkillFormulaDraftErrors
} from './formulaExpression';
import { buildUpdateSkillInternalStateRequest, createEmptyInternalStateDraft, skillInternalStateToDraft,
  type SkillInternalStateDraft } from './processes/internalStateForm';
import { buildUpdateSkillEffectRequest, createEmptyEffectDraft, normalizeEffectDraftForDirtyComparison,
  skillEffectToDraft, type SkillEffectDraft } from './effects/effectForm';
import { buildUpdateSkillProcessRequest, createEmptyProcessDraft, skillProcessToDraft,
  type SkillProcessDraft } from './processes/processForm';
import { createEmptyRuleDraft, fromDetail, isTriggerRuleDraftDirty, toUpdateRequest,
  type SkillTriggerRuleDraft } from './triggers/triggerRuleForm';

export type ParameterDraftEntry = {
  id: string;
  baselineKey: string | null;
  draft: SkillParameterDraft;
};

export type FormulaDraftEntry = {
  id: string;
  baselineKey: string | null;
  draft: SkillFormulaDraft;
};

export type InternalStateDraftEntry = {
  id: string;
  baselineKey: string | null;
  draft: SkillInternalStateDraft;
  value: CreateSkillInternalStateRequest | null;
};

export type EffectDraftEntry = {
  id: string;
  baselineKey: string | null;
  draft: SkillEffectDraft;
  value: CreateSkillEffectRequest | null;
};

export type ProcessDraftEntry = {
  id: string;
  baselineKey: string | null;
  draft: SkillProcessDraft;
  value: CreateSkillProcessRequest | null;
};

export type TriggerRuleDraftEntry = {
  id: string;
  baselineKey: string | null;
  draft: SkillTriggerRuleDraft;
  value: CreateSkillTriggerRuleRequest | null;
};

export type SkillConfigurationDraft = {
  skill: SkillDraft;
  parameters: ParameterDraftEntry[];
  formulas: FormulaDraftEntry[];
  internalStates: InternalStateDraftEntry[];
  effects: EffectDraftEntry[];
  processes: ProcessDraftEntry[];
  triggerRules: TriggerRuleDraftEntry[];
};

export type ConfigurationBuildResult =
  | { ok: true; skill: UpdateSkillRequest; skillChanged: boolean; changes: SkillConfigurationChange[] }
  | { ok: false; skillErrors: SkillDraftErrors; parameterErrors: Record<string, SkillParameterDraftErrors>;
    formulaErrors: Record<string, SkillFormulaDraftErrors>; formulaNodeIssues: Record<string, FormulaNodeIssue[]>;
    stateErrors?: Record<string, string>; effectErrors?: Record<string, string>;
    processErrors?: Record<string, string>; ruleErrors?: Record<string, string>; message: string };

function canonicalFields(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalFields(item));
    return key === 'skillCategoryKeys' ? [...items].sort() : items;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = 'momentType' in record && 'stepKey' in record && !('failureReason' in record)
      ? { ...record, failureReason: null } : record;
    return Object.fromEntries(Object.entries(fields).sort(([left], [right]) => left.localeCompare(right))
      .map(([field, nested]) => [field, canonicalFields(nested, field)]));
  }
  return value;
}

function sameFields(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalFields(left)) === JSON.stringify(canonicalFields(right));
}

export function createEmptyConfigurationDraft(): SkillConfigurationDraft {
  return { skill: createEmptySkillDraft(), parameters: [], formulas: [], internalStates: [], effects: [],
    processes: [], triggerRules: [] };
}

export function configurationToDraft(configuration: SkillConfiguration): SkillConfigurationDraft {
  return {
    skill: skillToDraft(configuration.skill),
    parameters: configuration.parameters.map((parameter) => ({
      id: parameter.parameterKey,
      baselineKey: parameter.parameterKey,
      draft: parameterToDraft(parameter)
    })),
    formulas: configuration.formulas.map((formula) => ({
      id: formula.formulaKey,
      baselineKey: formula.formulaKey,
      draft: formulaToDraft(formula)
    })),
    internalStates: configuration.internalStates.map((state) => ({
      id: state.stateKey, baselineKey: state.stateKey, draft: skillInternalStateToDraft(state), value: null
    })),
    effects: configuration.effects.map((effect) => ({
      id: effect.effectKey, baselineKey: effect.effectKey, draft: skillEffectToDraft(effect), value: null
    })),
    processes: configuration.processes.map((process) => ({
      id: process.processKey, baselineKey: process.processKey, draft: skillProcessToDraft(process), value: null
    })),
    triggerRules: configuration.triggerRules.map((rule) => ({
      id: rule.ruleKey, baselineKey: rule.ruleKey, draft: fromDetail(rule, configuration.skill.skillKey), value: null
    }))
  };
}

export function createNewParameterEntry(id: string, maxLevel: number): ParameterDraftEntry {
  return {
    id,
    baselineKey: null,
    draft: createEmptyParameterDraft('FIXED', { minLevel: 1, maxLevel })
  };
}

export function createNewFormulaEntry(id: string): FormulaDraftEntry {
  return { id, baselineKey: null, draft: createEmptyFormulaDraft() };
}

export function createNewInternalStateEntry(id: string): InternalStateDraftEntry {
  return { id, baselineKey: null, draft: createEmptyInternalStateDraft(), value: null };
}

export function createNewEffectEntry(id: string): EffectDraftEntry {
  return { id, baselineKey: null, draft: createEmptyEffectDraft(), value: null };
}

export function createNewProcessEntry(id: string): ProcessDraftEntry {
  return { id, baselineKey: null, draft: createEmptyProcessDraft(), value: null };
}

export function createNewRuleEntry(id: string): TriggerRuleDraftEntry {
  return { id, baselineKey: null, draft: createEmptyRuleDraft(), value: null };
}

export function configurationDraftDirty(
  baseline: SkillConfiguration | null,
  draft: SkillConfigurationDraft
): boolean {
  const original = baseline ? configurationToDraft(baseline) : createEmptyConfigurationDraft();
  const withoutConfirmedValues = (value: SkillConfigurationDraft) => ({
    ...value,
    internalStates: value.internalStates.map(({ value: _confirmed, ...entry }) => entry),
    effects: value.effects.map(({ value: _confirmed, ...entry }) => ({
      ...entry, draft: normalizeEffectDraftForDirtyComparison(entry.draft)
    })),
    processes: value.processes.map(({ value: _confirmed, ...entry }) => entry),
    triggerRules: value.triggerRules.map(({ value: _confirmed, ...entry }) => ({ ...entry,
      draft: { ...entry.draft, conditionGroups: entry.draft.conditionGroups.map(({ draftId: _id, ...group }) => group) }
    }))
  });
  return !sameFields(withoutConfirmedValues(draft), withoutConfirmedValues(original));
}

export function skillLevelImpact(
  baseline: SkillConfiguration | null,
  draft: SkillConfigurationDraft
): { previous: number; next: number; keys: string[] } | null {
  if (!baseline) return null;
  const next = Number(draft.skill.maxLevel);
  const previous = baseline.skill.maxLevel;
  if (!Number.isInteger(next) || next < 1 || next === previous) return null;
  const keys = baseline.parameters
    .filter((item) => item.valueMode === 'SKILL_LEVEL')
    .map((item) => item.parameterKey);
  return { previous, next, keys };
}

function projectLevelValues(draft: SkillParameterDraft, range: LevelRange): SkillParameterDraft {
  const levelValues: Record<string, string> = {};
  for (let level = range.minLevel; level <= range.maxLevel; level += 1) {
    levelValues[String(level)] = draft.levelValues[String(level)] ?? '';
  }
  return { ...draft, levelValues };
}

export function visibleParameterDraft(
  draft: SkillParameterDraft,
  skillMaxLevel: number,
  characterLevelRange: LevelRange | null
): SkillParameterDraft {
  if (draft.valueMode === 'SKILL_LEVEL') {
    return projectLevelValues(draft, { minLevel: 1, maxLevel: skillMaxLevel });
  }
  if (draft.valueMode === 'CHARACTER_LEVEL' && characterLevelRange) {
    return projectLevelValues(draft, characterLevelRange);
  }
  return draft;
}

function writableParameter(parameter: SkillParameter): UpdateSkillParameterRequest {
  return {
    name: parameter.name,
    valueType: parameter.valueType,
    valueMode: parameter.valueMode,
    fixedValue: parameter.fixedValue,
    levelValues: parameter.levelValues,
    description: parameter.description,
    sortOrder: parameter.sortOrder
  };
}

export function buildConfigurationChanges(
  baseline: SkillConfiguration | null,
  draft: SkillConfigurationDraft,
  characterLevelRange: LevelRange | null,
  attributes: Attribute[] = []
): ConfigurationBuildResult {
  const skillResult = validateSkillDraft(draft.skill, baseline === null);
  if (!skillResult.ok) {
    return { ok: false, skillErrors: skillResult.fieldErrors, parameterErrors: {},
      formulaErrors: {}, formulaNodeIssues: {}, message: '请先修正技能主体。' };
  }
  const skill = buildUpdateSkillRequest(skillResult.normalized);
  const skillChanged = baseline === null
    || !sameFields(skill, buildUpdateSkillRequest(validateExistingSkill(baseline)));
  const baselineMap = new Map(baseline?.parameters.map((item) => [item.parameterKey, item]) ?? []);
  const seen = new Set<string>();
  const parameterErrors: Record<string, SkillParameterDraftErrors> = {};
  const changes: SkillConfigurationChange[] = [];
  for (const entry of draft.parameters) {
    const key = entry.draft.parameterKey.trim();
    if (seen.has(key)) {
      parameterErrors[entry.id] = { parameterKey: '参数标识重复。' };
      continue;
    }
    seen.add(key);
    const original = entry.baselineKey ? baselineMap.get(entry.baselineKey) : undefined;
    const forceLevelUpdate = Boolean(original && skillResult.normalized.maxLevel !== baseline?.skill.maxLevel
      && original.valueMode === 'SKILL_LEVEL');
    const originalDraft = original ? parameterToDraft(original) : null;
    if (original && !forceLevelUpdate && JSON.stringify(entry.draft) === JSON.stringify(originalDraft)) {
      continue;
    }
    const projected = visibleParameterDraft(entry.draft, skillResult.normalized.maxLevel, characterLevelRange);
    const range = projected.valueMode === 'SKILL_LEVEL'
      ? { minLevel: 1, maxLevel: skillResult.normalized.maxLevel }
      : projected.valueMode === 'CHARACTER_LEVEL' ? characterLevelRange : null;
    const validation = validateParameterDraft(projected, !original, range);
    if (!validation.ok) {
      parameterErrors[entry.id] = validation.fieldErrors;
      continue;
    }
    if (original && key !== original.parameterKey) {
      parameterErrors[entry.id] = { parameterKey: '已保存参数的标识不能修改。' };
      continue;
    }
    if (!original) {
      if (baselineMap.has(key)) {
        parameterErrors[entry.id] = { parameterKey: '该参数标识已存在。' };
      } else {
        changes.push({
          objectType: 'PARAMETER', operation: 'CREATE', key,
          value: buildCreateParameterRequest(validation.normalized)
        });
      }
      continue;
    }
    const value = buildUpdateParameterRequest(validation.normalized);
    if (forceLevelUpdate || !sameFields(value, writableParameter(original))) {
      changes.push({ objectType: 'PARAMETER', operation: 'UPDATE', key, value });
    }
  }
  for (const original of baseline?.parameters ?? []) {
    if (!draft.parameters.some((entry) => entry.baselineKey === original.parameterKey)) {
      changes.push({ objectType: 'PARAMETER', operation: 'DELETE', key: original.parameterKey });
    }
  }
  if (Object.keys(parameterErrors).length) {
    return { ok: false, skillErrors: {}, parameterErrors,
      formulaErrors: {}, formulaNodeIssues: {}, message: '请先修正参数。' };
  }

  const finalParameterKeys = new Set(draft.parameters.map((entry) => entry.draft.parameterKey.trim()));
  const baselineFormulas = new Map(baseline?.formulas.map((item) => [item.formulaKey, item]) ?? []);
  const seenFormulaKeys = new Set<string>();
  const formulaErrors: Record<string, SkillFormulaDraftErrors> = {};
  const formulaNodeIssues: Record<string, FormulaNodeIssue[]> = {};
  const previewParameters = draft.parameters.map((entry) => ({
    skillKey: baseline?.skill.skillKey ?? draft.skill.skillKey.trim(), parameterKey: entry.draft.parameterKey.trim(), name: entry.draft.name,
    valueMode: entry.draft.valueMode
  }));
  for (const entry of draft.formulas) {
    const key = entry.draft.formulaKey.trim();
    if (seenFormulaKeys.has(key)) {
      formulaErrors[entry.id] = { formulaKey: '公式标识重复。' };
      continue;
    }
    seenFormulaKeys.add(key);
    const original = entry.baselineKey ? baselineFormulas.get(entry.baselineKey) : undefined;
    const originalDraft = original ? formulaToDraft(original) : null;
    const draftChanged = !original || !sameFields(entry.draft, originalDraft);
    const referencesRemovedParameter = original && formulaReferencesRemovedParameter(original, finalParameterKeys);
    if (!draftChanged && !referencesRemovedParameter) continue;
    const validation = validateFormulaDraft(entry.draft, !original, {
      parameters: previewParameters, attributes
    });
    if (!validation.ok) {
      formulaErrors[entry.id] = validation.fieldErrors;
      formulaNodeIssues[entry.id] = validation.nodeIssues;
      continue;
    }
    if (original && key !== original.formulaKey) {
      formulaErrors[entry.id] = { formulaKey: '已保存公式的标识不能修改。' };
      continue;
    }
    if (!original) {
      if (baselineFormulas.has(key)) formulaErrors[entry.id] = { formulaKey: '该公式标识已存在。' };
      else changes.push({ objectType: 'FORMULA', operation: 'CREATE', key,
        value: buildCreateFormulaRequest(validation.normalized) });
      continue;
    }
    const value = buildUpdateFormulaRequest(validation.normalized);
    if (draftChanged && !sameFields(value, writableFormula(original))) {
      changes.push({ objectType: 'FORMULA', operation: 'UPDATE', key, value });
    }
  }
  for (const original of baseline?.formulas ?? []) {
    if (!draft.formulas.some((entry) => entry.baselineKey === original.formulaKey)) {
      changes.push({ objectType: 'FORMULA', operation: 'DELETE', key: original.formulaKey });
    }
  }
  if (Object.keys(formulaErrors).length || Object.keys(formulaNodeIssues).length) {
    return { ok: false, skillErrors: {}, parameterErrors: {}, formulaErrors, formulaNodeIssues,
      message: '请先修正公式及其参数引用。' };
  }
  const stateErrors: Record<string, string> = {};
  const baselineStates = new Map(baseline?.internalStates.map((item) => [item.stateKey, item]) ?? []);
  const seenStates = new Set<string>();
  for (const entry of draft.internalStates) {
    const key = entry.draft.stateKey.trim();
    const original = entry.baselineKey ? baselineStates.get(entry.baselineKey) : undefined;
    if (!key || seenStates.has(key) || (!original && baselineStates.has(key))) {
      stateErrors[entry.id] = '内部状态标识为空或重复。';
      continue;
    }
    seenStates.add(key);
    if (original && key !== original.stateKey) {
      stateErrors[entry.id] = '已保存内部状态的标识不能修改。';
      continue;
    }
    if (original && sameFields(entry.draft, skillInternalStateToDraft(original))) continue;
    if (!entry.value || entry.value.stateKey !== key) {
      stateErrors[entry.id] = '请重新打开并确认完整内部状态草稿。';
      continue;
    }
    if (original) {
      const value = buildUpdateSkillInternalStateRequest(entry.value);
      if (!sameFields(value, writableState(original))) {
        changes.push({ objectType: 'INTERNAL_STATE', operation: 'UPDATE', key, value });
      }
    } else {
      changes.push({ objectType: 'INTERNAL_STATE', operation: 'CREATE', key, value: entry.value });
    }
  }
  for (const original of baseline?.internalStates ?? []) {
    if (!draft.internalStates.some((entry) => entry.baselineKey === original.stateKey)) {
      changes.push({ objectType: 'INTERNAL_STATE', operation: 'DELETE', key: original.stateKey });
    }
  }

  const effectErrors: Record<string, string> = {};
  const baselineEffects = new Map(baseline?.effects.map((item) => [item.effectKey, item]) ?? []);
  const seenEffects = new Set<string>();
  for (const entry of draft.effects) {
    const key = entry.draft.effectKey.trim();
    const original = entry.baselineKey ? baselineEffects.get(entry.baselineKey) : undefined;
    if (!key || seenEffects.has(key) || (!original && baselineEffects.has(key))) {
      effectErrors[entry.id] = '效果标识为空或重复。';
      continue;
    }
    seenEffects.add(key);
    if (original && key !== original.effectKey) {
      effectErrors[entry.id] = '已保存效果的标识不能修改。';
      continue;
    }
    if (original && sameFields(normalizeEffectDraftForDirtyComparison(entry.draft),
      normalizeEffectDraftForDirtyComparison(skillEffectToDraft(original)))) continue;
    if (!entry.value || entry.value.effectKey !== key) {
      effectErrors[entry.id] = '请重新打开并确认完整效果草稿。';
      continue;
    }
    if (original) {
      const value = buildUpdateSkillEffectRequest(entry.value);
      if (!sameFields(value, writableEffect(original))) {
        changes.push({ objectType: 'EFFECT', operation: 'UPDATE', key, value });
      }
    } else {
      changes.push({ objectType: 'EFFECT', operation: 'CREATE', key, value: entry.value });
    }
  }
  for (const original of baseline?.effects ?? []) {
    if (!draft.effects.some((entry) => entry.baselineKey === original.effectKey)) {
      changes.push({ objectType: 'EFFECT', operation: 'DELETE', key: original.effectKey });
    }
  }
  const processErrors: Record<string, string> = {};
  const baselineProcesses = new Map(baseline?.processes.map((item) => [item.processKey, item]) ?? []);
  const seenProcesses = new Set<string>();
  for (const entry of draft.processes) {
    const key = entry.draft.processKey.trim();
    const original = entry.baselineKey ? baselineProcesses.get(entry.baselineKey) : undefined;
    if (!key || seenProcesses.has(key) || (!original && baselineProcesses.has(key))) {
      processErrors[entry.id] = '过程标识为空或重复。';
      continue;
    }
    seenProcesses.add(key);
    if (original && key !== original.processKey) {
      processErrors[entry.id] = '已保存过程的标识不能修改。';
      continue;
    }
    if (original && sameFields(entry.draft, skillProcessToDraft(original))) continue;
    if (!entry.value || entry.value.processKey !== key) {
      processErrors[entry.id] = '请重新打开并确认完整过程草稿。';
      continue;
    }
    if (original) {
      const value = buildUpdateSkillProcessRequest(entry.value);
      if (!sameFields(value, writableProcess(original))) {
        changes.push({ objectType: 'PROCESS', operation: 'UPDATE', key, value });
      }
    } else {
      changes.push({ objectType: 'PROCESS', operation: 'CREATE', key, value: entry.value });
    }
  }
  for (const original of baseline?.processes ?? []) {
    if (!draft.processes.some((entry) => entry.baselineKey === original.processKey)) {
      changes.push({ objectType: 'PROCESS', operation: 'DELETE', key: original.processKey });
    }
  }
  const ruleErrors: Record<string, string> = {};
  const baselineRules = new Map(baseline?.triggerRules.map((item) => [item.ruleKey, item]) ?? []);
  const seenRules = new Set<string>();
  for (const entry of draft.triggerRules) {
    const key = entry.draft.ruleKey.trim();
    const original = entry.baselineKey ? baselineRules.get(entry.baselineKey) : undefined;
    if (!key || seenRules.has(key) || (!original && baselineRules.has(key))) {
      ruleErrors[entry.id] = '规则标识为空或重复。';
      continue;
    }
    seenRules.add(key);
    if (original && key !== original.ruleKey) {
      ruleErrors[entry.id] = '已保存规则的标识不能修改。';
      continue;
    }
    if (original && !isTriggerRuleDraftDirty(entry.draft, fromDetail(original, baseline!.skill.skillKey))) continue;
    if (!entry.value || entry.value.ruleKey !== key) {
      ruleErrors[entry.id] = '请重新打开并确认完整规则草稿。';
      continue;
    }
    if (original) {
      const value = toUpdateRequest(entry.draft);
      if (!sameFields(value, writableRule(original))) {
        changes.push({ objectType: 'TRIGGER_RULE', operation: 'UPDATE', key, value });
      }
    } else {
      changes.push({ objectType: 'TRIGGER_RULE', operation: 'CREATE', key, value: entry.value });
    }
  }
  for (const original of baseline?.triggerRules ?? []) {
    if (!draft.triggerRules.some((entry) => entry.baselineKey === original.ruleKey)) {
      changes.push({ objectType: 'TRIGGER_RULE', operation: 'DELETE', key: original.ruleKey });
    }
  }
  if (Object.keys(stateErrors).length || Object.keys(effectErrors).length
    || Object.keys(processErrors).length || Object.keys(ruleErrors).length) {
    return { ok: false, skillErrors: {}, parameterErrors: {}, formulaErrors: {}, formulaNodeIssues: {},
      stateErrors, effectErrors, processErrors, ruleErrors, message: '请先修正组成草稿。' };
  }
  const removedParameters = new Set(changes.filter((item) => item.objectType === 'PARAMETER' && item.operation === 'DELETE')
    .map((item) => item.key));
  const removedFormulas = new Set(changes.filter((item) => item.objectType === 'FORMULA' && item.operation === 'DELETE')
    .map((item) => item.key));
  for (const entry of draft.internalStates) {
    const value = entry.value ?? (entry.baselineKey ? baselineStates.get(entry.baselineKey) : null);
    if (referencesRemovedNumber(value, removedParameters, removedFormulas)) {
      stateErrors[entry.id] = '内部状态仍引用本次待删除的参数或公式。';
    }
  }
  for (const entry of draft.effects) {
    const value = entry.value ?? (entry.baselineKey ? baselineEffects.get(entry.baselineKey) : null);
    if (referencesRemovedNumber(value, removedParameters, removedFormulas)) {
      effectErrors[entry.id] = '效果仍引用本次待删除的参数或公式。';
    }
  }
  for (const entry of draft.processes) {
    const value = entry.value ?? (entry.baselineKey ? baselineProcesses.get(entry.baselineKey) : null);
    if (referencesRemovedNumber(value, removedParameters, removedFormulas)) {
      processErrors[entry.id] = '过程仍引用本次待删除的参数或公式。';
    }
  }
  for (const entry of draft.triggerRules) {
    const value = entry.value ?? (entry.baselineKey ? baselineRules.get(entry.baselineKey) : null);
    if (referencesRemovedNumber(value, removedParameters, removedFormulas)) {
      ruleErrors[entry.id] = '规则仍引用本次待删除的参数或公式。';
    }
  }
  if (Object.keys(stateErrors).length || Object.keys(effectErrors).length
    || Object.keys(processErrors).length || Object.keys(ruleErrors).length) {
    return { ok: false, skillErrors: {}, parameterErrors: {}, formulaErrors: {}, formulaNodeIssues: {},
      stateErrors, effectErrors, processErrors, ruleErrors, message: '仍有组成引用待删除的数值定义。' };
  }
  return { ok: true, skill, skillChanged, changes };
}

function writableState(state: SkillInternalState): UpdateSkillInternalStateRequest {
  return { name: state.name, stateType: state.stateType, scope: state.scope,
    description: state.description, sortOrder: state.sortOrder, detail: state.detail } as UpdateSkillInternalStateRequest;
}

function writableEffect(effect: SkillEffect): UpdateSkillEffectRequest {
  return { name: effect.name, description: effect.description, sortOrder: effect.sortOrder,
    lifecycle: effect.lifecycle ? { ...effect.lifecycle,
      endWhenShieldEndsResultKey: effect.lifecycle.endWhenShieldEndsResultKey ?? null } : null,
    results: effect.results };
}

function writableProcess(process: SkillProcess): UpdateSkillProcessRequest {
  return { name: process.name, activationType: process.activationType,
    description: process.description, sortOrder: process.sortOrder, cooldown: process.cooldown,
    steps: process.steps, effectBindings: process.effectBindings, stateOperations: process.stateOperations };
}

function writableRule(rule: SkillTriggerRuleDetail): UpdateSkillTriggerRuleRequest {
  return { name: rule.name, description: rule.description, sortOrder: rule.sortOrder,
    eventSource: rule.eventSource, conditionGroups: rule.conditionGroups, actions: rule.actions,
    perTargetCooldown: rule.perTargetCooldown, maxTriggersPerProcess: rule.maxTriggersPerProcess,
    oncePerUse: rule.oncePerUse };
}

function referencesRemovedNumber(value: unknown, parameters: ReadonlySet<string>, formulas: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) return value.some((item) => referencesRemovedNumber(item, parameters, formulas));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([field, nested]) => (
    (field === 'parameterKey' && typeof nested === 'string' && parameters.has(nested))
    || (field === 'formulaKey' && typeof nested === 'string' && formulas.has(nested))
    || referencesRemovedNumber(nested, parameters, formulas)
  ));
}

function writableFormula(formula: SkillFormula): UpdateSkillFormulaRequest {
  return {
    name: formula.name, description: formula.description, sortOrder: formula.sortOrder,
    expression: formula.expression
  };
}

function formulaReferencesRemovedParameter(formula: SkillFormula, keys: ReadonlySet<string>): boolean {
  return formula.expression.inputs.some(input => input.binding.kind === 'parameter' && !keys.has(input.binding.parameterKey));
}

function validateExistingSkill(baseline: SkillConfiguration): {
  skillKey: string;
  name: string;
  description: string | null;
  maxLevel: number;
  status: 'ENABLED' | 'DISABLED';
  sortOrder: number;
  skillCategoryKeys: string[];
} {
  const skill = baseline.skill;
  return {
    skillKey: skill.skillKey, name: skill.name, description: skill.description,
    maxLevel: skill.maxLevel, status: skill.status, sortOrder: skill.sortOrder,
    skillCategoryKeys: skill.skillCategoryKeys
  };
}

export function configurationMatchesRequest(
  current: SkillConfiguration,
  requestedSkill: UpdateSkillRequest | undefined,
  changes: SkillConfigurationChange[],
  baseline?: SkillConfiguration | null
): boolean {
  if ((requestedSkill || baseline) && !sameFields(buildUpdateSkillRequest(validateExistingSkill(current)),
    requestedSkill ?? buildUpdateSkillRequest(validateExistingSkill(baseline!)))) {
    return false;
  }
  const parameters = new Map(current.parameters.map((item) => [item.parameterKey, item]));
  const formulas = new Map(current.formulas.map((item) => [item.formulaKey, item]));
  const states = new Map(current.internalStates.map((item) => [item.stateKey, item]));
  const effects = new Map(current.effects.map((item) => [item.effectKey, item]));
  const processes = new Map(current.processes.map((item) => [item.processKey, item]));
  const rules = new Map(current.triggerRules.map((item) => [item.ruleKey, item]));
  const changedMatches = changes.every((change) => {
    if (change.objectType === 'PROCESS') {
      const item = processes.get(change.key);
      if (change.operation === 'DELETE') return !item;
      if (!item) return false;
      const expected = change.operation === 'CREATE'
        ? buildUpdateSkillProcessRequest(change.value) : change.value;
      return sameFields(writableProcess(item), expected);
    }
    if (change.objectType === 'TRIGGER_RULE') {
      const item = rules.get(change.key);
      if (change.operation === 'DELETE') return !item;
      if (!item) return false;
      const { ruleKey: _key, ...expected } = change.operation === 'CREATE' ? change.value : { ruleKey: change.key, ...change.value };
      void _key;
      return sameFields(writableRule(item), expected);
    }
    if (change.objectType === 'INTERNAL_STATE') {
      const item = states.get(change.key);
      if (change.operation === 'DELETE') return !item;
      if (!item) return false;
      const expected = change.operation === 'CREATE'
        ? buildUpdateSkillInternalStateRequest(change.value) : change.value;
      return sameFields(writableState(item), expected);
    }
    if (change.objectType === 'EFFECT') {
      const item = effects.get(change.key);
      if (change.operation === 'DELETE') return !item;
      if (!item) return false;
      const expected = change.operation === 'CREATE'
        ? buildUpdateSkillEffectRequest(change.value) : change.value;
      return sameFields(writableEffect(item), expected);
    }
    if (change.objectType === 'FORMULA') {
      const item = formulas.get(change.key);
      if (change.operation === 'DELETE') return !item;
      if (!item) return false;
      const expected = change.operation === 'CREATE'
        ? buildUpdateFormulaRequest(change.value)
        : change.value;
      return sameFields(writableFormula(item), expected);
    }
    const item = parameters.get(change.key);
    if (change.operation === 'DELETE') return !item;
    if (!item) return false;
    const expected = change.operation === 'CREATE'
      ? buildUpdateParameterRequest(change.value)
      : change.value;
    return sameFields(writableParameter(item), expected);
  });
  if (!changedMatches || baseline === undefined) return changedMatches;
  const matchesCollection = <T>(objectType: SkillConfigurationChange['objectType'],
    before: readonly T[], after: readonly T[], keyOf: (item: T) => string,
    writable: (item: T) => unknown): boolean => {
    const relevant = changes.filter((change) => change.objectType === objectType);
    const changed = new Set(relevant.map((change) => change.key));
    const expected = new Set(before.map(keyOf));
    for (const change of relevant) {
      if (change.operation === 'DELETE') expected.delete(change.key);
      else expected.add(change.key);
    }
    const actual = new Set(after.map(keyOf));
    if (actual.size !== expected.size || [...actual].some((key) => !expected.has(key))) return false;
    const previous = new Map(before.map((item) => [keyOf(item), item]));
    return after.every((item) => {
      const key = keyOf(item);
      const original = previous.get(key);
      return changed.has(key) || !original || sameFields(writable(item), writable(original));
    });
  };
  return matchesCollection('PARAMETER', baseline?.parameters ?? [], current.parameters,
    (item) => item.parameterKey, writableParameter)
    && matchesCollection('FORMULA', baseline?.formulas ?? [], current.formulas,
      (item) => item.formulaKey, writableFormula)
    && matchesCollection('INTERNAL_STATE', baseline?.internalStates ?? [], current.internalStates,
      (item) => item.stateKey, writableState)
    && matchesCollection('EFFECT', baseline?.effects ?? [], current.effects,
      (item) => item.effectKey, writableEffect)
    && matchesCollection('PROCESS', baseline?.processes ?? [], current.processes,
      (item) => item.processKey, writableProcess)
    && matchesCollection('TRIGGER_RULE', baseline?.triggerRules ?? [], current.triggerRules,
      (item) => item.ruleKey, writableRule);
}
