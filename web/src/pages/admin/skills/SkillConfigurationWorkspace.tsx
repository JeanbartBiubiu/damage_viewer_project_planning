import { Alert, Button, Form, Input, InputNumber, Radio, Select, Space, Tag, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthoringLocation } from '../../../types/authoringLocation';
import type { Skill, SkillStatus, UpdateSkillRequest } from '../../../types/skill';
import type { SkillCategory } from '../../../types/skillCategory';
import type { SkillConfiguration, SkillConfigurationChange } from '../../../types/skillConfiguration';
import type { SkillParameter } from '../../../types/skillParameter';
import type { SkillFormula } from '../../../types/skillFormula';
import type { SkillInternalState, SkillInternalStateSummary } from '../../../types/skillInternalState';
import type { SkillEffect, SkillEffectSummary } from '../../../types/skillEffect';
import type { SkillProcess, SkillProcessSummary } from '../../../types/skillProcess';
import type { SkillTriggerRuleDetail, SkillTriggerRuleSummary } from '../../../types/skillTriggerRule';
import type { Attribute } from '../../../types/attribute';
import { getLevelConfig } from '../../../services/characterClient';
import { listAttributes } from '../../../services/attributeClient';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import {
  createSkillConfiguration,
  getSkillConfiguration,
  updateSkillConfiguration
} from '../../../services/skillConfigurationClient';
import { AuthoringFieldAnchor } from './AuthoringFieldAnchor';
import { SkillParameterDraftDialog } from './SkillParameterDraftDialog';
import { SkillFormulaDraftDialog } from './SkillFormulaDraftDialog';
import { SkillInternalStateEditorModal } from './processes/SkillInternalStateEditorModal';
import { SkillProcessEditorModal } from './processes/SkillProcessEditorModal';
import { SkillTriggerRuleEditorModal } from './triggers/SkillTriggerRuleEditorModal';
import { fromDetail, isTriggerRuleDraftDirty } from './triggers/triggerRuleForm';
import { SkillEffectEditorModal } from './effects/SkillEffectEditorModal';
import { ObjectRelationActions } from '../relations/ObjectRelationActions';
import {
  ReadonlyEffects,
  ReadonlyFormulas,
  ReadonlyProcesses,
  ReadonlyRules,
  ReadonlyStates
} from './ReadonlySkillConfiguration';
import {
  authoringLocateMessage,
  lastFieldName,
  shouldDegradeUnsupportedAnchor
} from './authoringFocus';
import { resolveAuthoringLocation } from './authoringLocation';
import { mapSkillFieldIssues, type SkillDraftErrors } from './skillForm';
import { type LevelRange, type SkillParameterDraftErrors } from './parameterForm';
import {
  buildConfigurationChanges,
  configurationDraftDirty,
  configurationMatchesRequest,
  configurationToDraft,
  createEmptyConfigurationDraft,
  createNewFormulaEntry,
  createNewParameterEntry,
  createNewInternalStateEntry,
  createNewEffectEntry,
  createNewProcessEntry,
  createNewRuleEntry,
  skillLevelImpact,
  type FormulaDraftEntry,
  type ParameterDraftEntry,
  type InternalStateDraftEntry,
  type EffectDraftEntry,
  type ProcessDraftEntry,
  type TriggerRuleDraftEntry,
  type SkillConfigurationDraft
} from './skillConfigurationDraft';
import {
  formulaToDraft,
  previewFormulaExpression,
  validateFormulaDraft,
  type FormulaNodeIssue,
  type SkillFormulaDraftErrors
} from './formulaExpression';
import { skillEffectToCopyDraft } from './effects/effectForm';
import {
  SKILL_BEHAVIOR_AUXILIARY_LABEL,
  SKILL_BEHAVIOR_GROUP_IDS,
  SKILL_BEHAVIOR_GROUP_LABELS,
  SKILL_BEHAVIOR_SUPPLEMENT_LABEL,
  buildSkillBehaviorOverview,
  type SkillBehaviorEntry
} from './overview/skillBehaviorOverview';

export const SKILL_WORKSPACE_MODULES = [
  { id: 'overview', label: '配置总览' },
  { id: 'basic', label: '主体与分类' },
  { id: 'numbers', label: '参数与公式' },
  { id: 'effects', label: '效果与生命周期' },
  { id: 'processes', label: '施放过程' },
  { id: 'states', label: '内部状态' },
  { id: 'rules', label: '条件与触发' }
] as const;

export type SkillWorkspaceModule = typeof SKILL_WORKSPACE_MODULES[number]['id'];

export function moduleForAuthoringLocation(location: AuthoringLocation | null | undefined): SkillWorkspaceModule {
  switch (location?.editor) {
    case 'SKILL_BASIC': return 'basic';
    case 'PARAMETER':
    case 'FORMULA': return 'numbers';
    case 'EFFECT': return 'effects';
    case 'PROCESS': return 'processes';
    case 'INTERNAL_STATE': return 'states';
    case 'TRIGGER_RULE': return 'rules';
    default: return 'overview';
  }
}

type Source = { kind: 'character' | 'equipment' | 'rune'; name: string; key: string } | null;
type PendingSave = {
  skillKey: string;
  baseline: SkillConfiguration | null;
  originalDigest: string | null;
  expectedSkill: UpdateSkillRequest | undefined;
  changes: SkillConfigurationChange[];
  responseDigest: string | null;
  responseConfirmed: boolean;
};
type SaveStatus = 'editing' | 'saving' | 'pending' | 'verified' | 'notObserved' | 'conflict';
type ParameterEditor = { entry: ParameterDraftEntry; original: SkillParameter | null; focus?: AuthoringLocation | null };
type FormulaEditor = { entry: FormulaDraftEntry; original: SkillFormula | null; focus?: AuthoringLocation | null };
type InternalStateEditor = { entry: InternalStateDraftEntry; original: SkillInternalState | null;
  focus?: AuthoringLocation | null };
type EffectEditor = { entry: EffectDraftEntry; original: SkillEffect | null;
  mode: 'create' | 'edit' | 'copy'; focus?: AuthoringLocation | null };
type ProcessEditor = { entry: ProcessDraftEntry; original: SkillProcess | null; focus?: AuthoringLocation | null };
type RuleEditor = { entry: TriggerRuleDraftEntry; original: SkillTriggerRuleDetail | null;
  focus?: AuthoringLocation | null };
type LocatedIssue = {
  message: string;
  module: SkillWorkspaceModule;
  key: string | null;
  field: string | null;
  externalSource: string | null;
};

type Props = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  skillKey: string | null;
  initialModule: SkillWorkspaceModule;
  initialStatus?: SkillStatus;
  source?: Source;
  categories: SkillCategory[];
  categoryDirectoryReady: boolean;
  authoringLocation?: AuthoringLocation | null;
  backLabel?: string;
  onBack: () => void;
  onSaved: (skill: Skill) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
};

const ignoreWorkspaceCallback = () => {};

function issueFromError(error: unknown, currentSkillKey: string): LocatedIssue[] {
  if (!(error instanceof ApiRequestError) || !error.details) return [];
  const raw = error.details.fieldIssues;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value): LocatedIssue[] => {
    if (!value || typeof value !== 'object') return [];
    const issue = value as Record<string, unknown>;
    const sourceSkillKey = typeof issue.sourceSkillKey === 'string' ? issue.sourceSkillKey
      : typeof error.details?.sourceSkillKey === 'string' ? error.details.sourceSkillKey : null;
    const externalSource = sourceSkillKey && sourceSkillKey !== currentSkillKey ? sourceSkillKey : null;
    const objectType = String(externalSource
      ? issue.sourceType ?? error.details?.sourceType ?? issue.module ?? issue.objectType ?? 'SKILL'
      : issue.module ?? issue.objectType ?? issue.sourceType
        ?? error.details?.module ?? error.details?.objectType ?? error.details?.sourceType ?? 'SKILL').toUpperCase();
    const module: SkillWorkspaceModule = objectType === 'PARAMETER' || objectType === 'FORMULA'
      ? 'numbers'
      : objectType === 'EFFECT' ? 'effects'
        : objectType === 'PROCESS' ? 'processes'
          : objectType === 'INTERNAL_STATE' || objectType === 'STATE' ? 'states'
            : objectType === 'TRIGGER_RULE' || objectType === 'TRIGGER' ? 'rules' : 'basic';
    return [{
      message: typeof issue.message === 'string' ? issue.message : '字段值不合法。',
      module,
      key: externalSource
        ? typeof issue.sourceKey === 'string' ? issue.sourceKey
          : typeof issue.key === 'string' ? issue.key : null
        : typeof issue.key === 'string' ? issue.key
          : typeof issue.objectKey === 'string' ? issue.objectKey
            : typeof issue.sourceKey === 'string' ? issue.sourceKey : null,
      field: typeof issue.field === 'string' ? issue.field : null,
      externalSource
    }];
  });
}

function hasParameterReference(value: unknown, parameterKey: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasParameterReference(item, parameterKey));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => (
    (key === 'parameterKey' && nested === parameterKey) || hasParameterReference(nested, parameterKey)
  ));
}

function parameterReferences(
  configuration: SkillConfiguration | null,
  parameterKey: string,
  formulaDrafts?: FormulaDraftEntry[],
  states?: SkillInternalState[],
  effects?: SkillEffect[],
  processes?: SkillProcess[],
  rules?: SkillTriggerRuleDetail[]
): string[] {
  const collections = [
    ['效果', effects ?? configuration?.effects ?? [], 'effectKey'],
    ['过程', processes ?? configuration?.processes ?? [], 'processKey'],
    ['内部状态', states ?? configuration?.internalStates ?? [], 'stateKey'],
    ['规则', rules ?? configuration?.triggerRules ?? [], 'ruleKey']
  ] as const;
  const refs: string[] = [];
  for (const formula of formulaDrafts ?? configuration?.formulas.map((item) => ({ draft: formulaToDraft(item) })) ?? []) {
    if (hasParameterReference(formula.draft.expression, parameterKey)) {
      refs.push(`公式「${formula.draft.name}」（${formula.draft.formulaKey}）`);
    }
  }
  for (const [label, items, key] of collections) {
    for (const item of items) {
      if (hasParameterReference(item, parameterKey)) {
        const record = item as unknown as Record<string, unknown>;
        refs.push(`${label}「${String(record.name ?? record[key])}」（${String(record[key])}）`);
      }
    }
  }
  return refs;
}

function formulaReferences(configuration: SkillConfiguration | null, formulaKey: string,
  states?: SkillInternalState[], effects?: SkillEffect[], processes?: SkillProcess[],
  rules?: SkillTriggerRuleDetail[]): string[] {
  const collections = [
    ['效果', effects ?? configuration?.effects ?? [], 'effectKey'],
    ['过程', processes ?? configuration?.processes ?? [], 'processKey'],
    ['内部状态', states ?? configuration?.internalStates ?? [], 'stateKey'],
    ['规则', rules ?? configuration?.triggerRules ?? [], 'ruleKey']
  ] as const;
  const refs: string[] = [];
  for (const [label, items, key] of collections) {
    for (const item of items) {
      if (hasReferenceField(item, 'formulaKey', formulaKey)) {
        const record = item as unknown as Record<string, unknown>;
        refs.push(`${label}「${String(record.name ?? record[key])}」（${String(record[key])}）`);
      }
    }
  }
  return refs;
}

function hasReferenceField(value: unknown, field: string, target: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasReferenceField(item, field, target));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => (
    (key === field && nested === target) || hasReferenceField(nested, field, target)
  ));
}

function hasOwnedReference(value: unknown, field: string, key: string, ownerField: string,
  skillKey: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasOwnedReference(item, field, key, ownerField, skillKey));
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record[field] === key && (record[ownerField] === undefined || record[ownerField] === skillKey)) return true;
  return Object.values(record).some((nested) => hasOwnedReference(nested, field, key, ownerField, skillKey));
}

function overviewParameters(draft: SkillConfigurationDraft, baseline: SkillConfiguration | null): SkillParameter[] {
  const saved = new Map(baseline?.parameters.map((item) => [item.parameterKey, item]) ?? []);
  return draft.parameters.flatMap((entry): SkillParameter[] => {
    const key = entry.draft.parameterKey.trim();
    if (!key) return [];
    const original = saved.get(key);
    const levelValues: Record<string, number> = {};
    for (const [level, raw] of Object.entries(entry.draft.levelValues)) {
      if (raw.trim() && Number.isFinite(Number(raw))) levelValues[level] = Number(raw);
    }
    return [{
      gameId: baseline?.skill.gameId ?? '', skillKey: draft.skill.skillKey,
      parameterKey: key, name: entry.draft.name, valueType: entry.draft.valueType,
      valueMode: entry.draft.valueMode,
      fixedValue: entry.draft.fixedValue.trim() && Number.isFinite(Number(entry.draft.fixedValue))
        ? Number(entry.draft.fixedValue) : null,
      levelValues: entry.draft.valueMode === 'SKILL_LEVEL' || entry.draft.valueMode === 'CHARACTER_LEVEL'
        ? levelValues : null,
      description: entry.draft.description || null,
      sortOrder: Number(entry.draft.sortOrder) || 0,
      createdAt: original?.createdAt ?? '', updatedAt: original?.updatedAt ?? ''
    }];
  });
}

function overviewFormulas(draft: SkillConfigurationDraft, baseline: SkillConfiguration | null) {
  const saved = new Map(baseline?.formulas.map((item) => [item.formulaKey, item]) ?? []);
  return draft.formulas.flatMap((entry) => {
    const key = entry.draft.formulaKey.trim();
    if (!key) return [];
    const original = saved.get(key);
    return [{
      gameId: baseline?.skill.gameId ?? '', skillKey: draft.skill.skillKey,
      formulaKey: key, name: entry.draft.name, description: entry.draft.description || null,
      sortOrder: Number(entry.draft.sortOrder) || 0,
      createdAt: original?.createdAt ?? '', updatedAt: original?.updatedAt ?? ''
    }];
  });
}

function workspaceFormulas(draft: SkillConfigurationDraft, baseline: SkillConfiguration | null,
  parameters: SkillParameter[], attributes: Attribute[]): SkillFormula[] {
  const saved = new Map(baseline?.formulas.map((item) => [item.formulaKey, item]) ?? []);
  const options = draft.parameters.map((entry) => ({ parameterKey: entry.draft.parameterKey.trim(),
    name: entry.draft.name, valueMode: entry.draft.valueMode }));
  return draft.formulas.flatMap((entry): SkillFormula[] => {
    const key = entry.draft.formulaKey.trim();
    if (!key) return [];
    const original = saved.get(entry.baselineKey ?? key);
    if (original && JSON.stringify(entry.draft) === JSON.stringify(formulaToDraft(original))) {
      return [original];
    }
    const validation = validateFormulaDraft(entry.draft, !entry.baselineKey, {
      parameters: options, attributes
    });
    if (!validation.ok) return [];
    return [{ gameId: baseline?.skill.gameId ?? parameters[0]?.gameId ?? '',
      skillKey: draft.skill.skillKey, ...validation.normalized,
      createdAt: original?.createdAt ?? '', updatedAt: original?.updatedAt ?? '' }];
  });
}

function workspaceStates(draft: SkillConfigurationDraft, baseline: SkillConfiguration | null,
  gameId: string): SkillInternalState[] {
  return draft.internalStates.flatMap((entry): SkillInternalState[] => {
    const original = baseline?.internalStates.find((item) => item.stateKey === entry.baselineKey);
    if (!entry.value && !original) return [];
    return [{ ...(original ?? {}), ...(entry.value ?? {}), gameId, skillKey: draft.skill.skillKey,
      stateKey: entry.draft.stateKey.trim(), createdAt: original?.createdAt ?? '',
      updatedAt: original?.updatedAt ?? '' } as SkillInternalState];
  });
}

function workspaceEffects(draft: SkillConfigurationDraft, baseline: SkillConfiguration | null,
  gameId: string): SkillEffect[] {
  return draft.effects.flatMap((entry): SkillEffect[] => {
    const original = baseline?.effects.find((item) => item.effectKey === entry.baselineKey);
    if (!entry.value && !original) return [];
    return [{ ...(original ?? {}), ...(entry.value ?? {}), gameId, skillKey: draft.skill.skillKey,
      effectKey: entry.draft.effectKey.trim(), createdAt: original?.createdAt ?? '',
      updatedAt: original?.updatedAt ?? '' } as SkillEffect];
  });
}

function effectSummaries(effects: SkillEffect[]): SkillEffectSummary[] {
  return effects.map((item) => ({
    gameId: item.gameId, skillKey: item.skillKey, effectKey: item.effectKey,
    name: item.name, description: item.description, sortOrder: item.sortOrder,
    resultCount: item.results.length, lifecycleEnabled: item.lifecycle !== null,
    createdAt: item.createdAt, updatedAt: item.updatedAt
  }));
}

function workspaceProcesses(draft: SkillConfigurationDraft, baseline: SkillConfiguration | null,
  gameId: string): SkillProcess[] {
  return draft.processes.flatMap((entry): SkillProcess[] => {
    const original = baseline?.processes.find((item) => item.processKey === entry.baselineKey);
    if (!entry.value && !original) return [];
    return [{ ...(original ?? {}), ...(entry.value ?? {}), gameId, skillKey: draft.skill.skillKey,
      processKey: entry.draft.processKey.trim(), createdAt: original?.createdAt ?? '',
      updatedAt: original?.updatedAt ?? '' } as SkillProcess];
  });
}

function processSummaries(processes: SkillProcess[]): SkillProcessSummary[] {
  return processes.map((item) => ({ gameId: item.gameId, skillKey: item.skillKey,
    processKey: item.processKey, name: item.name, activationType: item.activationType,
    description: item.description, sortOrder: item.sortOrder,
    stepCount: item.steps.length, effectBindingCount: item.effectBindings.length,
    stateOperationCount: item.stateOperations.length,
    createdAt: item.createdAt, updatedAt: item.updatedAt }));
}

function stateSummaries(states: SkillInternalState[]): SkillInternalStateSummary[] {
  return states.map(({ detail: _detail, ...summary }) => { void _detail; return summary; });
}

function workspaceRules(draft: SkillConfigurationDraft, baseline: SkillConfiguration | null): SkillTriggerRuleDetail[] {
  return draft.triggerRules.flatMap((entry): SkillTriggerRuleDetail[] => {
    const original = baseline?.triggerRules.find((item) => item.ruleKey === entry.baselineKey);
    if (!entry.value && !original) return [];
    return [{ ...(original ?? {}), ...(entry.value ?? {}), ruleKey: entry.draft.ruleKey.trim() } as SkillTriggerRuleDetail];
  });
}

function ruleSummaries(rules: SkillTriggerRuleDetail[]): SkillTriggerRuleSummary[] {
  return rules.map((item) => ({ ruleKey: item.ruleKey, name: item.name,
    description: item.description, eventType: item.eventSource.eventType,
    conditionGroupCount: item.conditionGroups.length, actionCount: item.actions.length,
    perTargetCooldownEnabled: item.perTargetCooldown !== null,
    maxTriggersPerProcessEnabled: item.maxTriggersPerProcess !== null,
    oncePerUseEnabled: item.oncePerUse !== null, sortOrder: item.sortOrder, updatedAt: '' }));
}

export function SkillConfigurationWorkspace({
  apiBaseUrl, selectedGameId, adminToken, skillKey, initialModule, initialStatus,
  source = null, categories, categoryDirectoryReady, authoringLocation, backLabel = '返回',
  onBack, onSaved, onDirtyChange
}: Props) {
  const [module, setModule] = useState<SkillWorkspaceModule>(initialModule);
  const [currentSkillKey, setCurrentSkillKey] = useState(skillKey);
  const [baseline, setBaseline] = useState<SkillConfiguration | null>(null);
  const [draft, setDraft] = useState<SkillConfigurationDraft>(createEmptyConfigurationDraft);
  const [loading, setLoading] = useState(Boolean(skillKey));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>('editing');
  const [pending, setPending] = useState<PendingSave | null>(null);
  const [skillErrors, setSkillErrors] = useState<SkillDraftErrors>({});
  const [parameterErrors, setParameterErrors] = useState<Record<string, SkillParameterDraftErrors>>({});
  const [formulaErrors, setFormulaErrors] = useState<Record<string, SkillFormulaDraftErrors>>({});
  const [formulaNodeIssues, setFormulaNodeIssues] = useState<Record<string, FormulaNodeIssue[]>>({});
  const [stateErrors, setStateErrors] = useState<Record<string, string>>({});
  const [effectErrors, setEffectErrors] = useState<Record<string, string>>({});
  const [processErrors, setProcessErrors] = useState<Record<string, string>>({});
  const [ruleErrors, setRuleErrors] = useState<Record<string, string>>({});
  const [locatedIssues, setLocatedIssues] = useState<LocatedIssue[]>([]);
  const [locateNotice, setLocateNotice] = useState<string | null>(null);
  const [parameterEditor, setParameterEditor] = useState<ParameterEditor | null>(null);
  const [formulaEditor, setFormulaEditor] = useState<FormulaEditor | null>(null);
  const [internalStateEditor, setInternalStateEditor] = useState<InternalStateEditor | null>(null);
  const [effectEditor, setEffectEditor] = useState<EffectEditor | null>(null);
  const [processEditor, setProcessEditor] = useState<ProcessEditor | null>(null);
  const [ruleEditor, setRuleEditor] = useState<RuleEditor | null>(null);
  const [parameterModalDirty, setParameterModalDirty] = useState(false);
  const [formulaModalDirty, setFormulaModalDirty] = useState(false);
  const [stateModalDirty, setStateModalDirty] = useState(false);
  const [effectModalDirty, setEffectModalDirty] = useState(false);
  const [processModalDirty, setProcessModalDirty] = useState(false);
  const [ruleModalDirty, setRuleModalDirty] = useState(false);
  const [relationDirty, setRelationDirty] = useState(false);
  const [characterLevelRange, setCharacterLevelRange] = useState<LevelRange | null>(null);
  const [characterLevelError, setCharacterLevelError] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [attributesReady, setAttributesReady] = useState(false);
  const [attributeError, setAttributeError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const attributeGeneration = useRef(0);
  const nextParameterId = useRef(0);
  const nextFormulaId = useRef(0);
  const nextStateId = useRef(0);
  const nextEffectId = useRef(0);
  const nextProcessId = useRef(0);
  const nextRuleId = useRef(0);
  const queuedStatus = useRef(initialStatus);
  const contextAtOpen = useRef(JSON.stringify([apiBaseUrl, selectedGameId, adminToken]));
  const contextChanged = contextAtOpen.current !== JSON.stringify([apiBaseUrl, selectedGameId, adminToken]);
  const frozen = status === 'saving' || status === 'pending';
  const dirty = configurationDraftDirty(baseline, draft) || parameterModalDirty || formulaModalDirty
    || stateModalDirty || effectModalDirty || processModalDirty || ruleModalDirty || relationDirty;
  const modalOpen = Boolean(parameterEditor || formulaEditor || internalStateEditor || effectEditor || processEditor || ruleEditor);
  const ready = !loading && !loadError && (baseline !== null || skillKey === null);
  const maxLevel = Number(draft.skill.maxLevel);
  const validMaxLevel = Number.isInteger(maxLevel) && maxLevel >= 1 ? maxLevel : 1;
  const impact = skillLevelImpact(baseline, draft);
  const draftParameters = useMemo(() => overviewParameters(draft, baseline), [draft, baseline]);
  const draftFormulas = useMemo(() => workspaceFormulas(draft, baseline, draftParameters, attributes),
    [draft, baseline, draftParameters, attributes]);
  const draftStates = useMemo(() => workspaceStates(draft, baseline, selectedGameId ?? ''),
    [draft, baseline, selectedGameId]);
  const draftEffects = useMemo(() => workspaceEffects(draft, baseline, selectedGameId ?? ''),
    [draft, baseline, selectedGameId]);
  const draftEffectSummaries = useMemo(() => effectSummaries(draftEffects), [draftEffects]);
  const draftProcesses = useMemo(() => workspaceProcesses(draft, baseline, selectedGameId ?? ''),
    [draft, baseline, selectedGameId]);
  const draftProcessSummaries = useMemo(() => processSummaries(draftProcesses), [draftProcesses]);
  const draftStateSummaries = useMemo(() => stateSummaries(draftStates), [draftStates]);
  const draftModeOptions = useMemo(() => Object.fromEntries(draftStates.filter((item) => item.stateType === 'MODE')
    .map((item) => [item.stateKey, item.detail.options.map((option) => ({
      optionKey: option.optionKey, name: option.name
    }))])), [draftStates]);
  const draftRules = useMemo(() => workspaceRules(draft, baseline), [draft, baseline]);
  const draftRuleSummaries = useMemo(() => ruleSummaries(draftRules), [draftRules]);
  const workingSkill: Skill = {
    gameId: selectedGameId ?? '', skillKey: draft.skill.skillKey, name: draft.skill.name,
    description: draft.skill.description.trim() || null,
    maxLevel: validMaxLevel, status: draft.skill.status,
    sortOrder: Number(draft.skill.sortOrder) || 0,
    skillCategoryKeys: draft.skill.skillCategoryKeys,
    createdAt: baseline?.skill.createdAt ?? '', updatedAt: baseline?.skill.updatedAt ?? ''
  };

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { setRelationDirty(false); }, [apiBaseUrl, selectedGameId, adminToken, currentSkillKey]);
  useEffect(() => () => { requestGeneration.current += 1; attributeGeneration.current += 1; }, []);
  useEffect(() => { if (contextChanged) { requestGeneration.current += 1; attributeGeneration.current += 1; } }, [contextChanged]);

  const readConfiguration = useCallback(async (key: string) => {
    const generation = ++requestGeneration.current;
    if (!selectedGameId || !adminToken.trim() || contextChanged) {
      setLoadError('当前连接、游戏或令牌不可用；旧技能草稿不能用于新上下文。');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const result = await getSkillConfiguration(apiBaseUrl, selectedGameId, key, adminToken.trim());
      if (generation !== requestGeneration.current) return;
      setBaseline(result.data);
      const next = configurationToDraft(result.data);
      if (queuedStatus.current && next.skill.status !== queuedStatus.current) next.skill.status = queuedStatus.current;
      queuedStatus.current = undefined;
      setDraft(next);
      setStatus('editing');
      setSaveError(null);
      setPending(null);
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setLoadError(getErrorMessage(error));
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [adminToken, apiBaseUrl, contextChanged, selectedGameId]);

  useEffect(() => {
    if (skillKey) void readConfiguration(skillKey);
    else setLoading(false);
    // The workspace owns a single opening context. A changed context never starts a new read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedGameId || !adminToken.trim() || contextChanged) return;
    let active = true;
    void getLevelConfig(apiBaseUrl, selectedGameId, adminToken.trim())
      .then((result) => {
        if (!active) return;
        setCharacterLevelRange({ minLevel: result.data.minLevel, maxLevel: result.data.maxLevel });
        setCharacterLevelError(null);
      })
      .catch((error) => {
        if (!active) return;
        setCharacterLevelRange(null);
        setCharacterLevelError(getErrorMessage(error));
      });
    return () => { active = false; };
  }, [adminToken, apiBaseUrl, contextChanged, selectedGameId]);

  const loadAttributes = useCallback(async () => {
    const generation = ++attributeGeneration.current;
    if (!selectedGameId || !adminToken.trim() || contextChanged) return;
    setAttributesReady(false);
    setAttributeError(null);
    try {
      const result = await listAttributes(apiBaseUrl, selectedGameId, adminToken.trim());
      if (generation !== attributeGeneration.current) return;
      setAttributes(result.data.items);
      setAttributesReady(true);
    } catch (error) {
      if (generation !== attributeGeneration.current) return;
      setAttributes([]);
      setAttributesReady(false);
      setAttributeError(getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, contextChanged, selectedGameId]);
  useEffect(() => { void loadAttributes(); }, [loadAttributes]);

  useEffect(() => {
    if (!authoringLocation || !baseline || authoringLocation.skillKey !== baseline.skill.skillKey) return;
    setModule(moduleForAuthoringLocation(authoringLocation));
    if (authoringLocation.editor === 'PARAMETER') {
      const entry = draft.parameters.find((item) => item.draft.parameterKey === authoringLocation.objectKey);
      const original = baseline.parameters.find((item) => item.parameterKey === authoringLocation.objectKey) ?? null;
      if (entry && original) setParameterEditor({ entry, original, focus: authoringLocation });
      else setLocateNotice(authoringLocateMessage({ originalFieldPath: authoringLocation.fieldPath, reason: 'OBJECT_MISSING' }));
      return;
    }
    if (authoringLocation.editor === 'FORMULA') {
      const entry = draft.formulas.find((item) => item.draft.formulaKey === authoringLocation.objectKey);
      const original = baseline.formulas.find((item) => item.formulaKey === authoringLocation.objectKey) ?? null;
      if (entry && original) setFormulaEditor({ entry, original, focus: authoringLocation });
      else setLocateNotice(authoringLocateMessage({ originalFieldPath: authoringLocation.fieldPath, reason: 'OBJECT_MISSING' }));
      return;
    }
    if (authoringLocation.editor === 'INTERNAL_STATE') {
      const entry = draft.internalStates.find((item) => item.draft.stateKey === authoringLocation.objectKey);
      const original = baseline.internalStates.find((item) => item.stateKey === authoringLocation.objectKey) ?? null;
      if (entry && original) setInternalStateEditor({ entry, original, focus: authoringLocation });
      else setLocateNotice(authoringLocateMessage({ originalFieldPath: authoringLocation.fieldPath, reason: 'OBJECT_MISSING' }));
      return;
    }
    if (authoringLocation.editor === 'EFFECT') {
      const entry = draft.effects.find((item) => item.draft.effectKey === authoringLocation.objectKey);
      const original = baseline.effects.find((item) => item.effectKey === authoringLocation.objectKey) ?? null;
      if (entry && original) setEffectEditor({ entry, original, mode: 'edit', focus: authoringLocation });
      else setLocateNotice(authoringLocateMessage({ originalFieldPath: authoringLocation.fieldPath, reason: 'OBJECT_MISSING' }));
      return;
    }
    if (authoringLocation.editor === 'PROCESS') {
      const entry = draft.processes.find((item) => item.draft.processKey === authoringLocation.objectKey);
      const original = baseline.processes.find((item) => item.processKey === authoringLocation.objectKey) ?? null;
      if (entry && original) setProcessEditor({ entry, original, focus: authoringLocation });
      else setLocateNotice(authoringLocateMessage({ originalFieldPath: authoringLocation.fieldPath, reason: 'OBJECT_MISSING' }));
      return;
    }
    if (authoringLocation.editor === 'TRIGGER_RULE') {
      const entry = draft.triggerRules.find((item) => item.draft.ruleKey === authoringLocation.objectKey);
      const original = baseline.triggerRules.find((item) => item.ruleKey === authoringLocation.objectKey) ?? null;
      if (entry && original) setRuleEditor({ entry, original, focus: authoringLocation });
      else setLocateNotice(authoringLocateMessage({ originalFieldPath: authoringLocation.fieldPath, reason: 'OBJECT_MISSING' }));
      return;
    }
    if (authoringLocation.editor === 'SKILL_BASIC') {
      const resolved = resolveAuthoringLocation(authoringLocation, baseline.skill);
      const unsupported = shouldDegradeUnsupportedAnchor(authoringLocation.editor, resolved.matchedSegments, resolved.precision);
      if (resolved.precision !== 'FIELD' || resolved.reason || unsupported) {
        setLocateNotice(authoringLocateMessage({
          originalFieldPath: resolved.originalFieldPath, reason: resolved.reason,
          unsupportedAnchor: unsupported, reportChanged: resolved.reportChanged
        }));
      }
      return;
    }
    setLocateNotice('已定位到对应模块；请核对对象稳定标识后继续编辑。');
    // Initial authoring navigation is consumed once after the configuration is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline, authoringLocation]);

  const activeLocation = authoringLocation?.editor === 'SKILL_BASIC' && baseline
    ? resolveAuthoringLocation(authoringLocation, baseline.skill) : null;
  const activeSkillField = activeLocation?.precision === 'FIELD' && !activeLocation.reason
    ? lastFieldName(activeLocation.matchedSegments) : null;
  const categoryOptions = useMemo(() => {
    const existing = new Set(baseline?.skill.skillCategoryKeys ?? []);
    return categories.filter((item) => item.status === 'ENABLED' || existing.has(item.skillCategoryKey))
      .map((item) => ({
        label: item.status === 'DISABLED' ? `${item.name}（已停用）` : item.name,
        value: item.skillCategoryKey, disabled: item.status === 'DISABLED'
      }));
  }, [baseline, categories]);
  const changeSkill = <K extends keyof SkillConfigurationDraft['skill']>(field: K, value: SkillConfigurationDraft['skill'][K]) => {
    setDraft((current) => ({ ...current, skill: { ...current.skill, [field]: value } }));
    setSkillErrors((current) => ({ ...current, [field]: undefined }));
    setSaveError(null);
    setLocatedIssues([]);
    if (status !== 'editing') setStatus('editing');
  };

  const selectModule = (next: SkillWorkspaceModule) => {
    if (modalOpen) return;
    setModule(next);
    setLocateNotice(null);
  };
  const openParameter = (entry: ParameterDraftEntry, focus?: AuthoringLocation | null) => {
    const original = baseline?.parameters.find((item) => item.parameterKey === entry.baselineKey) ?? null;
    setParameterEditor({ entry, original, focus });
    setParameterModalDirty(false);
  };
  const addParameter = () => {
    const entry = createNewParameterEntry(`new-${++nextParameterId.current}`, validMaxLevel);
    setParameterEditor({ entry, original: null });
    setParameterModalDirty(false);
  };
  const applyParameter = (entry: ParameterDraftEntry, nextDraft: ParameterDraftEntry['draft']): string | null => {
    const key = nextDraft.parameterKey.trim();
    if (draft.parameters.some((item) => item.id !== entry.id && item.draft.parameterKey.trim() === key)) {
      return `参数标识「${key}」已在技能草稿中使用。`;
    }
    setDraft((current) => {
      const nextEntry = { ...entry, draft: nextDraft };
      const exists = current.parameters.some((item) => item.id === entry.id);
      return {
        ...current,
        parameters: exists
          ? current.parameters.map((item) => item.id === entry.id ? nextEntry : item)
          : [...current.parameters, nextEntry]
      };
    });
    setParameterErrors((current) => ({ ...current, [entry.id]: {} }));
    setParameterEditor(null);
    setSaveError(null);
    setStatus('editing');
    return null;
  };
  const removeParameter = (entry: ParameterDraftEntry) => {
    const key = entry.draft.parameterKey;
    const refs = parameterReferences(baseline, key, draft.formulas, draftStates, draftEffects,
      draftProcesses, draftRules);
    if (refs.length) {
      setLocateNotice(`参数「${key}」仍被技能草稿引用：${refs.join('、')}。请先处理引用。`);
      return;
    }
    if (!window.confirm(`确定将参数「${entry.draft.name || key}」记为待删除吗？保存更改后才会生效。`)) return;
    setDraft((current) => ({ ...current, parameters: current.parameters.filter((item) => item.id !== entry.id) }));
    setStatus('editing');
  };
  const openFormula = (entry: FormulaDraftEntry, focus?: AuthoringLocation | null) => {
    const original = baseline?.formulas.find((item) => item.formulaKey === entry.baselineKey) ?? null;
    setFormulaEditor({ entry, original, focus });
    setFormulaModalDirty(false);
  };
  const addFormula = () => {
    const entry = createNewFormulaEntry(`formula-${++nextFormulaId.current}`);
    setFormulaEditor({ entry, original: null });
    setFormulaModalDirty(false);
  };
  const applyFormula = (entry: FormulaDraftEntry, nextDraft: FormulaDraftEntry['draft']): string | null => {
    const key = nextDraft.formulaKey.trim();
    if (draft.formulas.some((item) => item.id !== entry.id && item.draft.formulaKey.trim() === key)) {
      return `公式标识「${key}」已在技能草稿中使用。`;
    }
    setDraft((current) => {
      const nextEntry = { ...entry, draft: nextDraft };
      const exists = current.formulas.some((item) => item.id === entry.id);
      return {
        ...current,
        formulas: exists
          ? current.formulas.map((item) => item.id === entry.id ? nextEntry : item)
          : [...current.formulas, nextEntry]
      };
    });
    setFormulaErrors((current) => ({ ...current, [entry.id]: {} }));
    setFormulaNodeIssues((current) => ({ ...current, [entry.id]: [] }));
    setFormulaEditor(null);
    setSaveError(null);
    setStatus('editing');
    return null;
  };
  const removeFormula = (entry: FormulaDraftEntry) => {
    const key = entry.draft.formulaKey;
    const refs = formulaReferences(baseline, key, draftStates, draftEffects, draftProcesses, draftRules);
    if (refs.length) {
      setLocateNotice(`公式「${key}」仍被技能草稿引用：${refs.join('、')}。请先处理引用。`);
      return;
    }
    if (!window.confirm(`确定将公式「${entry.draft.name || key}」记为待删除吗？保存更改后才会生效。`)) return;
    setDraft((current) => ({ ...current, formulas: current.formulas.filter((item) => item.id !== entry.id) }));
    setStatus('editing');
  };
  const openInternalState = (entry: InternalStateDraftEntry, focus?: AuthoringLocation | null) => {
    const original = baseline?.internalStates.find((item) => item.stateKey === entry.baselineKey) ?? null;
    setInternalStateEditor({ entry, original, focus });
    setStateModalDirty(false);
  };
  const addInternalState = () => {
    const entry = createNewInternalStateEntry(`state-${++nextStateId.current}`);
    setInternalStateEditor({ entry, original: null });
    setStateModalDirty(false);
  };
  const applyInternalState = (entry: InternalStateDraftEntry,
    nextDraft: InternalStateDraftEntry['draft'], value: NonNullable<InternalStateDraftEntry['value']>): string | null => {
    const key = nextDraft.stateKey.trim();
    if (draft.internalStates.some((item) => item.id !== entry.id && item.draft.stateKey.trim() === key)) {
      return `内部状态标识「${key}」已在技能草稿中使用。`;
    }
    const nextEntry = { ...entry, draft: nextDraft, value };
    setDraft((current) => ({ ...current, internalStates: current.internalStates.some((item) => item.id === entry.id)
      ? current.internalStates.map((item) => item.id === entry.id ? nextEntry : item)
      : [...current.internalStates, nextEntry] }));
    setStateErrors((current) => {
      const next = { ...current };
      delete next[entry.id];
      return next;
    });
    setInternalStateEditor(null);
    setStateModalDirty(false);
    setSaveError(null);
    setStatus('editing');
    return null;
  };
  const removeInternalState = (entry: InternalStateDraftEntry) => {
    const key = entry.draft.stateKey.trim();
    const references = [
      ...draftProcesses, ...draftRules, ...draftEffects
    ].filter((item) => hasOwnedReference(item, 'stateKey', key, 'stateSkillKey', draft.skill.skillKey));
    if (references.length) {
      setLocateNotice(`内部状态「${key}」仍被本技能过程、规则或效果引用；请先处理引用。`);
      return;
    }
    if (!window.confirm(`确定将内部状态「${entry.draft.name || key}」记为待删除吗？保存后才生效。`)) return;
    setDraft((current) => ({ ...current,
      internalStates: current.internalStates.filter((item) => item.id !== entry.id) }));
    setStatus('editing');
  };
  const openEffect = (entry: EffectDraftEntry, focus?: AuthoringLocation | null) => {
    const original = baseline?.effects.find((item) => item.effectKey === entry.baselineKey) ?? null;
    setEffectEditor({ entry, original, mode: original ? 'edit' : 'create', focus });
    setEffectModalDirty(false);
  };
  const addEffect = () => {
    const entry = createNewEffectEntry(`effect-${++nextEffectId.current}`);
    setEffectEditor({ entry, original: null, mode: 'create' });
    setEffectModalDirty(false);
  };
  const copyEffect = (entry: EffectDraftEntry) => {
    const source = draftEffects.find((item) => item.effectKey === entry.draft.effectKey);
    if (!source) return;
    const copy = { ...createNewEffectEntry(`effect-${++nextEffectId.current}`),
      draft: skillEffectToCopyDraft(source) };
    setEffectEditor({ entry: copy, original: null, mode: 'copy' });
    setEffectModalDirty(false);
  };
  const applyEffect = (entry: EffectDraftEntry,
    nextDraft: EffectDraftEntry['draft'], value: NonNullable<EffectDraftEntry['value']>): string | null => {
    const key = nextDraft.effectKey.trim();
    if (draft.effects.some((item) => item.id !== entry.id && item.draft.effectKey.trim() === key)) {
      return `效果标识「${key}」已在技能草稿中使用。`;
    }
    const nextEntry = { ...entry, draft: nextDraft, value };
    setDraft((current) => ({ ...current, effects: current.effects.some((item) => item.id === entry.id)
      ? current.effects.map((item) => item.id === entry.id ? nextEntry : item)
      : [...current.effects, nextEntry] }));
    setEffectErrors((current) => {
      const next = { ...current };
      delete next[entry.id];
      return next;
    });
    setEffectEditor(null);
    setEffectModalDirty(false);
    setSaveError(null);
    setStatus('editing');
    return null;
  };
  const removeEffect = (entry: EffectDraftEntry) => {
    const key = entry.draft.effectKey.trim();
    const references = [...draftProcesses, ...draftRules]
      .filter((item) => hasOwnedReference(item, 'effectKey', key, 'effectSkillKey', draft.skill.skillKey));
    const linkedEffects = draftEffects.filter((item) => item.effectKey !== key
      && hasReferenceField(item, 'targetEffectKey', key));
    if (references.length || linkedEffects.length) {
      setLocateNotice(`效果「${key}」仍被过程、规则或其他效果引用；请先处理引用。`);
      return;
    }
    if (!window.confirm(`确定将效果「${entry.draft.name || key}」记为待删除吗？保存后才生效。`)) return;
    setDraft((current) => ({ ...current, effects: current.effects.filter((item) => item.id !== entry.id) }));
    setStatus('editing');
  };
  const openProcess = (entry: ProcessDraftEntry, focus?: AuthoringLocation | null) => {
    const original = baseline?.processes.find((item) => item.processKey === entry.baselineKey) ?? null;
    setProcessEditor({ entry, original, focus });
    setProcessModalDirty(false);
  };
  const addProcess = () => {
    const entry = createNewProcessEntry(`process-${++nextProcessId.current}`);
    setProcessEditor({ entry, original: null });
    setProcessModalDirty(false);
  };
  const applyProcess = (entry: ProcessDraftEntry,
    nextDraft: ProcessDraftEntry['draft'], value: NonNullable<ProcessDraftEntry['value']>): string | null => {
    const key = nextDraft.processKey.trim();
    if (draft.processes.some((item) => item.id !== entry.id && item.draft.processKey.trim() === key)) {
      return `过程标识「${key}」已在技能草稿中使用。`;
    }
    const nextEntry = { ...entry, draft: nextDraft, value };
    setDraft((current) => ({ ...current, processes: current.processes.some((item) => item.id === entry.id)
      ? current.processes.map((item) => item.id === entry.id ? nextEntry : item)
      : [...current.processes, nextEntry] }));
    setProcessErrors((current) => { const next = { ...current }; delete next[entry.id]; return next; });
    setProcessEditor(null);
    setProcessModalDirty(false);
    setSaveError(null);
    setStatus('editing');
    return null;
  };
  const removeProcess = (entry: ProcessDraftEntry) => {
    const key = entry.draft.processKey.trim();
    const references = draftRules.filter((item) => hasReferenceField(item, 'processKey', key));
    if (references.length) {
      setLocateNotice(`过程「${key}」仍被规则引用；请先处理引用。`);
      return;
    }
    if (!window.confirm(`确定将过程「${entry.draft.name || key}」记为待删除吗？保存后才生效。`)) return;
    setDraft((current) => ({ ...current, processes: current.processes.filter((item) => item.id !== entry.id) }));
    setStatus('editing');
  };
  const openRule = (entry: TriggerRuleDraftEntry, focus?: AuthoringLocation | null) => {
    const original = baseline?.triggerRules.find((item) => item.ruleKey === entry.baselineKey) ?? null;
    setRuleEditor({ entry, original, focus });
    setRuleModalDirty(false);
  };
  const addRule = () => {
    const entry = createNewRuleEntry(`rule-${++nextRuleId.current}`);
    setRuleEditor({ entry, original: null });
    setRuleModalDirty(false);
  };
  const applyRule = (entry: TriggerRuleDraftEntry,
    nextDraft: TriggerRuleDraftEntry['draft'], value: NonNullable<TriggerRuleDraftEntry['value']>): string | null => {
    const key = nextDraft.ruleKey.trim();
    if (draft.triggerRules.some((item) => item.id !== entry.id && item.draft.ruleKey.trim() === key)) {
      return `规则标识「${key}」已在技能草稿中使用。`;
    }
    const nextEntry = { ...entry, draft: nextDraft, value };
    setDraft((current) => ({ ...current, triggerRules: current.triggerRules.some((item) => item.id === entry.id)
      ? current.triggerRules.map((item) => item.id === entry.id ? nextEntry : item)
      : [...current.triggerRules, nextEntry] }));
    setRuleErrors((current) => { const next = { ...current }; delete next[entry.id]; return next; });
    setRuleEditor(null);
    setRuleModalDirty(false);
    setSaveError(null);
    setStatus('editing');
    return null;
  };
  const removeRule = (entry: TriggerRuleDraftEntry) => {
    if (!window.confirm(`确定将规则「${entry.draft.name || entry.draft.ruleKey}」记为待删除吗？保存后才生效。`)) return;
    setDraft((current) => ({ ...current, triggerRules: current.triggerRules.filter((item) => item.id !== entry.id) }));
    setStatus('editing');
  };
  const reload = () => {
    if (frozen || modalOpen || contextChanged) return;
    if (dirty && !window.confirm('当前技能草稿尚未保存，确定放弃并重新读取吗？')) return;
    setSkillErrors({});
    setParameterErrors({});
    setFormulaErrors({});
    setFormulaNodeIssues({});
    setStateErrors({});
    setEffectErrors({});
    setProcessErrors({});
    setRuleErrors({});
    setLocatedIssues([]);
    setLocateNotice(null);
    setSaveError(null);
    setPending(null);
    if (!currentSkillKey) {
      setDraft(createEmptyConfigurationDraft());
      setStatus('editing');
      return;
    }
    void readConfiguration(currentSkillKey);
  };

  const verifySave = async (frozenSave: PendingSave) => {
    const generation = ++requestGeneration.current;
    if (!selectedGameId || !adminToken.trim() || contextChanged) return;
    setStatus('pending');
    setSaveError(null);
    try {
      const result = await getSkillConfiguration(apiBaseUrl, selectedGameId, frozenSave.skillKey, adminToken.trim());
      if (generation !== requestGeneration.current) return;
      const current = result.data;
      const matches = configurationMatchesRequest(current, frozenSave.expectedSkill,
        frozenSave.changes, frozenSave.baseline);
      const digestMatchesResponse = !frozenSave.responseDigest || current.baseDigest === frozenSave.responseDigest;
      if (matches && digestMatchesResponse) {
        setBaseline(current);
        setDraft(configurationToDraft(current));
        setCurrentSkillKey(current.skill.skillKey);
        setPending(null);
        setStatus('verified');
        setSaveError(null);
        await onSaved(current.skill);
      } else if (frozenSave.originalDigest && current.baseDigest === frozenSave.originalDigest) {
        setStatus('notObserved');
        setPending(null);
        setSaveError('只读核对仍看到原基线，本次修改未观察到。草稿已保留；如需重试，请再次明确点击保存更改。');
      } else {
        setStatus('conflict');
        setPending(null);
        setSaveError('只读核对得到不同的技能配置，草稿已保留。请核对其他页面的修改后再决定是否重新读取。');
      }
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      if (error instanceof ApiRequestError && error.status === 404 && !frozenSave.responseConfirmed) {
        setStatus(frozenSave.originalDigest ? 'conflict' : 'notObserved');
        setPending(null);
        setSaveError(frozenSave.originalDigest
          ? '技能在只读核对时已不存在，草稿已保留。'
          : '只读核对未发现新技能；如需重试，请再次明确点击保存更改。');
      } else {
        setStatus('pending');
        setSaveError(`保存结果待核对：${getErrorMessage(error)}。可再次只读核对，页面不会自动重发写入。`);
      }
    }
  };

  const save = async () => {
    if (!ready || frozen || modalOpen || contextChanged || !selectedGameId || !adminToken.trim()) return;
    if (!attributesReady && draft.formulas.some((entry) => {
      const original = baseline?.formulas.find((item) => item.formulaKey === entry.baselineKey);
      return !original || JSON.stringify(entry.draft) !== JSON.stringify(formulaToDraft(original));
    })) {
      setSaveError(attributeError ?? '请先读取属性目录，再提交公式修改。');
      setModule('numbers');
      return;
    }
    const built = buildConfigurationChanges(baseline, draft, characterLevelRange, attributes);
    if (!built.ok) {
      setSkillErrors(built.skillErrors);
      setParameterErrors(built.parameterErrors);
      setFormulaErrors(built.formulaErrors);
      setFormulaNodeIssues(built.formulaNodeIssues);
      setStateErrors(built.stateErrors ?? {});
      setEffectErrors(built.effectErrors ?? {});
      setProcessErrors(built.processErrors ?? {});
      setRuleErrors(built.ruleErrors ?? {});
      setSaveError(built.message);
      setModule(Object.keys(built.ruleErrors ?? {}).length ? 'rules'
        : Object.keys(built.processErrors ?? {}).length ? 'processes'
        : Object.keys(built.stateErrors ?? {}).length ? 'states'
        : Object.keys(built.effectErrors ?? {}).length ? 'effects'
          : Object.keys(built.parameterErrors).length || Object.keys(built.formulaErrors).length
            || Object.keys(built.formulaNodeIssues).length ? 'numbers' : 'basic');
      return;
    }
    if (!built.skillChanged && built.changes.length === 0) {
      setDraft(baseline ? configurationToDraft(baseline) : createEmptyConfigurationDraft());
      setSaveError(null);
      setStatus('editing');
      return;
    }
    const key = baseline?.skill.skillKey ?? draft.skill.skillKey.trim();
    if (impact) {
      const affected = impact.keys.length ? `受影响参数：${impact.keys.join('、')}。` : '当前没有按技能等级取值的参数。';
      const range = impact.next > impact.previous
        ? `新增 Lv${impact.previous + 1}～Lv${impact.next} 必须逐项明确填写，不会补 0。`
        : `Lv${impact.next + 1}～Lv${impact.previous} 的原值将被移除。`;
      if (!window.confirm(`最高等级将从 Lv${impact.previous} 调整为 Lv${impact.next}。${range}${affected}确定提交吗？`)) return;
    }
    const frozenSave: PendingSave = {
      skillKey: key,
      baseline,
      originalDigest: baseline?.baseDigest ?? null,
      expectedSkill: built.skillChanged ? built.skill : undefined,
      changes: built.changes,
      responseDigest: null,
      responseConfirmed: false
    };
    const generation = ++requestGeneration.current;
    setStatus('saving');
    setSaveError(null);
    setSkillErrors({});
    setParameterErrors({});
    setFormulaErrors({});
    setFormulaNodeIssues({});
    setStateErrors({});
    setEffectErrors({});
    setProcessErrors({});
    setRuleErrors({});
    setLocatedIssues([]);
    try {
      const result = baseline
        ? await updateSkillConfiguration(apiBaseUrl, selectedGameId, key, adminToken.trim(), {
          baseDigest: baseline.baseDigest,
          ...(built.skillChanged ? { skill: built.skill } : {}),
          changes: built.changes
        })
        : await createSkillConfiguration(apiBaseUrl, selectedGameId, key, adminToken.trim(), {
          skill: built.skill, changes: built.changes
        });
      if (generation !== requestGeneration.current) return;
      const confirmed = { ...frozenSave, responseDigest: result.data.baseDigest, responseConfirmed: true };
      setPending(confirmed);
      await verifySave(confirmed);
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500 && error.status !== 408) {
        const mapped = mapSkillFieldIssues(error);
        setSkillErrors(mapped.fieldErrors);
        const issues = issueFromError(error, key);
        setLocatedIssues(issues);
        const parameterIssues: Record<string, SkillParameterDraftErrors> = {};
        const formulaIssues: Record<string, SkillFormulaDraftErrors> = {};
        for (const issue of issues) {
          if (issue.externalSource || issue.module !== 'numbers' || !issue.key || !issue.field) continue;
          const parameter = draft.parameters.find((item) => item.draft.parameterKey === issue.key);
          if (parameter) parameterIssues[parameter.id] = { ...parameterIssues[parameter.id], [issue.field]: issue.message };
          const formula = draft.formulas.find((item) => item.draft.formulaKey === issue.key);
          if (formula) formulaIssues[formula.id] = { ...formulaIssues[formula.id], [issue.field]: issue.message };
        }
        setParameterErrors(parameterIssues);
        setFormulaErrors(formulaIssues);
        setStateErrors(Object.fromEntries(issues.filter((issue) => !issue.externalSource && issue.module === 'states')
          .flatMap((issue) => {
            const entry = draft.internalStates.find((item) => item.draft.stateKey === issue.key);
            return entry ? [[entry.id, issue.message]] : [];
          })));
        setEffectErrors(Object.fromEntries(issues.filter((issue) => !issue.externalSource && issue.module === 'effects')
          .flatMap((issue) => {
            const entry = draft.effects.find((item) => item.draft.effectKey === issue.key);
            return entry ? [[entry.id, issue.message]] : [];
          })));
        setProcessErrors(Object.fromEntries(issues.filter((issue) => !issue.externalSource && issue.module === 'processes')
          .flatMap((issue) => {
            const entry = draft.processes.find((item) => item.draft.processKey === issue.key);
            return entry ? [[entry.id, issue.message]] : [];
          })));
        setRuleErrors(Object.fromEntries(issues.filter((issue) => !issue.externalSource && issue.module === 'rules')
          .flatMap((issue) => {
            const entry = draft.triggerRules.find((item) => item.draft.ruleKey === issue.key);
            return entry ? [[entry.id, issue.message]] : [];
          })));
        setSaveError([getErrorMessage(error), ...mapped.unmappedMessages].join('；'));
        setStatus(error.status === 409 ? 'conflict' : 'editing');
      } else {
        setPending(frozenSave);
        setSaveError(`写入响应不明：${getErrorMessage(error)}。正在只读核对；不会自动重发写入。`);
        await verifySave(frozenSave);
      }
    }
  };

  const navigateToLocation = (location: AuthoringLocation) => {
    if (modalOpen) return;
    const next = moduleForAuthoringLocation(location);
    setModule(next);
    if (location.editor === 'PARAMETER') {
      const entry = draft.parameters.find((item) => item.draft.parameterKey === location.objectKey);
      if (entry) openParameter(entry, location);
      else setLocateNotice(authoringLocateMessage({ originalFieldPath: location.fieldPath, reason: 'OBJECT_MISSING' }));
    } else if (location.editor === 'FORMULA') {
      const entry = draft.formulas.find((item) => item.draft.formulaKey === location.objectKey);
      if (entry) openFormula(entry, location);
      else setLocateNotice(authoringLocateMessage({ originalFieldPath: location.fieldPath, reason: 'OBJECT_MISSING' }));
    } else if (location.editor === 'INTERNAL_STATE') {
      const entry = draft.internalStates.find((item) => item.draft.stateKey === location.objectKey);
      if (entry) openInternalState(entry, location);
      else setLocateNotice(authoringLocateMessage({ originalFieldPath: location.fieldPath, reason: 'OBJECT_MISSING' }));
    } else if (location.editor === 'EFFECT') {
      const entry = draft.effects.find((item) => item.draft.effectKey === location.objectKey);
      if (entry) openEffect(entry, location);
      else setLocateNotice(authoringLocateMessage({ originalFieldPath: location.fieldPath, reason: 'OBJECT_MISSING' }));
    } else if (location.editor === 'PROCESS') {
      const entry = draft.processes.find((item) => item.draft.processKey === location.objectKey);
      if (entry) openProcess(entry, location);
      else setLocateNotice(authoringLocateMessage({ originalFieldPath: location.fieldPath, reason: 'OBJECT_MISSING' }));
    } else if (location.editor === 'TRIGGER_RULE') {
      const entry = draft.triggerRules.find((item) => item.draft.ruleKey === location.objectKey);
      if (entry) openRule(entry, location);
      else setLocateNotice(authoringLocateMessage({ originalFieldPath: location.fieldPath, reason: 'OBJECT_MISSING' }));
    } else if (next !== 'basic' && next !== 'numbers' && next !== 'effects' && next !== 'states') {
      setLocateNotice('已定位到对应模块；请核对对象稳定标识后继续编辑。');
    }
  };

  const overview = useMemo(() => buildSkillBehaviorOverview({
    skillKey: currentSkillKey ?? draft.skill.skillKey,
    skillName: draft.skill.name || currentSkillKey || '新技能',
    parameters: draftParameters,
    formulas: overviewFormulas(draft, baseline), effects: draftEffects,
    processes: draftProcesses, internalStates: draftStates,
    rules: draftRules, detailsComplete: baseline !== null
  }), [baseline, currentSkillKey, draft, draftParameters, draftEffects, draftStates, draftProcesses, draftRules]);
  const deletedKeys = baseline?.parameters.filter((item) => !draft.parameters.some((entry) => entry.baselineKey === item.parameterKey))
    .map((item) => item.parameterKey) ?? [];
  const deletedFormulaKeys = baseline?.formulas.filter((item) => !draft.formulas.some((entry) => entry.baselineKey === item.formulaKey))
    .map((item) => item.formulaKey) ?? [];
  const changedParameterCount = draft.parameters.filter((entry) => {
    const original = baseline?.parameters.find((item) => item.parameterKey === entry.baselineKey);
    return !original || JSON.stringify(entry.draft) !== JSON.stringify(configurationToDraft(baseline!).parameters.find((item) => item.id === entry.id)?.draft);
  }).length + deletedKeys.length + (impact?.keys.length ?? 0);
  const changedFormulaCount = draft.formulas.filter((entry) => {
    const original = baseline?.formulas.find((item) => item.formulaKey === entry.baselineKey);
    return !original || JSON.stringify(entry.draft) !== JSON.stringify(formulaToDraft(original));
  }).length + deletedFormulaKeys.length;
  const deletedStateKeys = baseline?.internalStates.filter((item) =>
    !draft.internalStates.some((entry) => entry.baselineKey === item.stateKey)).map((item) => item.stateKey) ?? [];
  const deletedEffectKeys = baseline?.effects.filter((item) =>
    !draft.effects.some((entry) => entry.baselineKey === item.effectKey)).map((item) => item.effectKey) ?? [];
  const deletedProcessKeys = baseline?.processes.filter((item) =>
    !draft.processes.some((entry) => entry.baselineKey === item.processKey)).map((item) => item.processKey) ?? [];
  const deletedRuleKeys = baseline?.triggerRules.filter((item) =>
    !draft.triggerRules.some((entry) => entry.baselineKey === item.ruleKey)).map((item) => item.ruleKey) ?? [];
  const changedStateCount = draft.internalStates.filter((entry) => {
    const original = baseline?.internalStates.find((item) => item.stateKey === entry.baselineKey);
    return !original || JSON.stringify(entry.draft) !== JSON.stringify(configurationToDraft(baseline!).internalStates
      .find((item) => item.id === entry.id)?.draft);
  }).length + deletedStateKeys.length;
  const changedEffectCount = draft.effects.filter((entry) => {
    const original = baseline?.effects.find((item) => item.effectKey === entry.baselineKey);
    return !original || JSON.stringify(entry.draft) !== JSON.stringify(configurationToDraft(baseline!).effects
      .find((item) => item.id === entry.id)?.draft);
  }).length + deletedEffectKeys.length;
  const changedProcessCount = draft.processes.filter((entry) => {
    const original = baseline?.processes.find((item) => item.processKey === entry.baselineKey);
    return !original || JSON.stringify(entry.draft) !== JSON.stringify(configurationToDraft(baseline!).processes
      .find((item) => item.id === entry.id)?.draft);
  }).length + deletedProcessKeys.length;
  const changedRuleCount = draft.triggerRules.filter((entry) => {
    const original = baseline?.triggerRules.find((item) => item.ruleKey === entry.baselineKey);
    return !original || isTriggerRuleDraftDirty(entry.draft, fromDetail(original, baseline!.skill.skillKey));
  }).length + deletedRuleKeys.length;
  const changedModules = [
    (baseline ? JSON.stringify(draft.skill) !== JSON.stringify(configurationToDraft(baseline).skill)
      : JSON.stringify(draft.skill) !== JSON.stringify(createEmptyConfigurationDraft().skill)) ? '主体与分类' : null,
    changedParameterCount || changedFormulaCount ? '参数与公式' : null,
    changedStateCount ? '内部状态' : null,
    changedEffectCount ? '效果与生命周期' : null,
    changedProcessCount ? '施放过程' : null,
    changedRuleCount ? '条件与触发' : null
  ].filter((item): item is string => Boolean(item));
  const statusLabel: Record<SaveStatus, string> = {
    editing: dirty ? '未保存' : '已读取',
    saving: '保存中', pending: '保存结果待核对', verified: '已保存并核对',
    notObserved: '本次修改未观察到', conflict: '配置冲突'
  };
  const entryRow = (entry: SkillBehaviorEntry) => <div key={entry.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border-2)' }}>
    <Space wrap>
      <Typography.Text>{entry.sourceKindLabel}：{entry.sourceName}（{entry.sourceKey}）</Typography.Text>
      {entry.momentLabel ? <Tag>{entry.momentLabel}</Tag> : null}
      {entry.targetLabel ? <Typography.Text type="secondary">{entry.targetLabel}</Typography.Text> : null}
      {entry.valueSourceLabel ? <Typography.Text type="secondary">{entry.valueSourceLabel}</Typography.Text> : null}
      <Button size="mini" onClick={() => navigateToLocation(entry.location)}>查看位置</Button>
    </Space>
    {entry.notes.length ? <div><Typography.Text type="secondary">{entry.notes.join('；')}</Typography.Text></div> : null}
  </div>;

  return <div className="page-stack" aria-label="技能统一编辑工作区">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <Typography.Title heading={4} style={{ margin: 0 }}>
          {draft.skill.name || baseline?.skill.name || (skillKey ? '技能配置' : '新增技能')}
        </Typography.Title>
        <Typography.Text type="secondary">稳定标识：{currentSkillKey ?? (draft.skill.skillKey || '待填写')}</Typography.Text>
        {source ? <div><Typography.Text type="secondary">来自{source.kind === 'character' ? '角色' : source.kind === 'equipment' ? '装备' : '符文'}：{source.name}（{source.key}）</Typography.Text></div> : null}
      </div>
      <Space wrap>
        <Button onClick={onBack} disabled={frozen}>{backLabel}</Button>
        <Button onClick={reload} disabled={frozen || modalOpen || contextChanged} loading={loading}>重新读取</Button>
        {pending ? <Button type="outline" onClick={() => void verifySave(pending)}>只读核对</Button> : null}
        <Button type="primary" loading={status === 'saving'}
          disabled={!ready || !dirty || frozen || modalOpen || contextChanged}
          onClick={() => void save()}>保存更改</Button>
      </Space>
    </div>

    <Space wrap>
      <Tag color={status === 'verified' ? 'green' : status === 'pending' || status === 'saving' ? 'orange' : dirty ? 'red' : 'gray'}>{statusLabel[status]}</Tag>
      <Typography.Text type="secondary">
        {changedModules.length ? `变化模块：${changedModules.join('、')}；参数约 ${changedParameterCount} 项，公式约 ${changedFormulaCount} 项，内部状态约 ${changedStateCount} 项，效果约 ${changedEffectCount} 项，过程约 ${changedProcessCount} 项，规则约 ${changedRuleCount} 项。` : '当前没有待提交的对象变化。'}
      </Typography.Text>
    </Space>
    {contextChanged ? <Alert type="error" content="连接、游戏或令牌已变化。当前草稿属于原上下文，不能向新上下文保存；旧请求已失效。" /> : null}
    {loading ? <Alert type="info" content="正在完整读取技能配置…" /> : null}
    {loadError ? <Alert type="error" content={loadError}
      action={<Button size="mini" onClick={() => currentSkillKey && void readConfiguration(currentSkillKey)}>重试读取</Button>} /> : null}
    {saveError ? <Alert type={status === 'pending' ? 'warning' : 'error'} content={saveError} /> : null}
    {locateNotice ? <Alert type="warning" content={locateNotice} /> : null}
    {locatedIssues.length ? <Alert type="warning" content={<Space direction="vertical">
      {locatedIssues.map((issue, index) => <Button key={`${index}-${issue.message}`} size="mini" onClick={() => {
        if (issue.externalSource) {
          setLocateNotice(`此问题来自其他技能「${issue.externalSource}」的对象「${issue.key ?? '未给出标识'}」，请到来源技能核对；当前草稿已保留。`);
          return;
        }
        setModule(issue.module);
        if (issue.module === 'numbers' && issue.key) {
          const parameter = draft.parameters.find((item) => item.draft.parameterKey === issue.key);
          const formula = draft.formulas.find((item) => item.draft.formulaKey === issue.key);
          if (parameter) openParameter(parameter);
          else if (formula) openFormula(formula);
          else setLocateNotice(`对象「${issue.key}」当前不在草稿中，不能按旧位置打开。`);
        } else if (issue.module === 'states' && issue.key) {
          const entry = draft.internalStates.find((item) => item.draft.stateKey === issue.key);
          if (entry) openInternalState(entry);
          else setLocateNotice(`内部状态「${issue.key}」当前不在草稿中，不能按旧位置打开。`);
        } else if (issue.module === 'effects' && issue.key) {
          const entry = draft.effects.find((item) => item.draft.effectKey === issue.key);
          if (entry) openEffect(entry);
          else setLocateNotice(`效果「${issue.key}」当前不在草稿中，不能按旧位置打开。`);
        } else if (issue.module === 'processes' && issue.key) {
          const entry = draft.processes.find((item) => item.draft.processKey === issue.key);
          if (entry) openProcess(entry);
          else setLocateNotice(`过程「${issue.key}」当前不在草稿中，不能按旧位置打开。`);
        } else if (issue.module === 'rules' && issue.key) {
          const entry = draft.triggerRules.find((item) => item.draft.ruleKey === issue.key);
          if (entry) openRule(entry);
          else setLocateNotice(`规则「${issue.key}」当前不在草稿中，不能按旧位置打开。`);
        } else if (issue.module !== 'basic') {
          setLocateNotice('已定位到对应模块；请核对问题对象和字段。');
        }
      }}>{issue.message} · {issue.externalSource
        ? `外部技能 ${issue.externalSource} / ${issue.key ?? '未给出标识'}`
        : `定位到${SKILL_WORKSPACE_MODULES.find((item) => item.id === issue.module)?.label}`}</Button>)}
    </Space>} /> : null}

    {ready ? <div style={{ display: 'grid', gridTemplateColumns: '190px minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
      <nav aria-label="技能配置模块" style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'sticky', top: 12 }}>
        {SKILL_WORKSPACE_MODULES.map((item) => <Button key={item.id} type={module === item.id ? 'primary' : 'secondary'}
          disabled={modalOpen} onClick={() => selectModule(item.id)}
          style={{ textAlign: 'left' }}>{item.label}</Button>)}
      </nav>
      <section style={{ minWidth: 0 }} aria-label={SKILL_WORKSPACE_MODULES.find((item) => item.id === module)?.label}>
        {module === 'overview' ? <Space direction="vertical" style={{ width: '100%' }} size="medium">
          <Alert type={dirty ? 'warning' : 'info'} content={dirty
            ? '以下总览来自当前未保存草稿；只解释配置，不表示技能可运行或战斗已验证。'
            : '以下总览来自已读取配置；只解释配置，不表示技能可运行或战斗已验证。'} />
          {SKILL_BEHAVIOR_GROUP_IDS.map((group) => <div key={group}>
            <Typography.Title heading={6}>{SKILL_BEHAVIOR_GROUP_LABELS[group]}</Typography.Title>
            {overview.groups[group].length ? overview.groups[group].map(entryRow) : <Typography.Text type="secondary">当前没有归入此组的配置。</Typography.Text>}
          </div>)}
          <div><Typography.Title heading={6}>{SKILL_BEHAVIOR_SUPPLEMENT_LABEL}</Typography.Title>
            {overview.supplement.length ? overview.supplement.map(entryRow) : <Typography.Text type="secondary">当前没有补充项。</Typography.Text>}
          </div>
          <div><Typography.Title heading={6}>{SKILL_BEHAVIOR_AUXILIARY_LABEL}</Typography.Title>
            {overview.auxiliary.length ? overview.auxiliary.map(entryRow) : <Typography.Text type="secondary">当前没有辅助配置。</Typography.Text>}
          </div>
        </Space> : null}

        {module === 'basic' ? <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Title heading={5}>主体与分类</Typography.Title>
          {impact ? <Alert type="warning" content={impact.next > impact.previous
            ? `最高等级扩大：新增 Lv${impact.previous + 1}～Lv${impact.next}。${impact.keys.length ? `受影响参数：${impact.keys.join('、')}。` : '没有等级参数。'}新增值须明确填写，不补 0。`
            : `最高等级缩小：Lv${impact.next + 1}～Lv${impact.previous} 的数值将移除。${impact.keys.length ? `受影响参数：${impact.keys.join('、')}。` : '没有等级参数。'}`} /> : null}
          <Form layout="vertical">
            <AuthoringFieldAnchor field="skillKey" active={activeSkillField === 'skillKey'}>
              <Form.Item label="技能标识" required validateStatus={skillErrors.skillKey ? 'error' : undefined} help={skillErrors.skillKey}>
                <Input aria-label="技能标识" value={draft.skill.skillKey} disabled={Boolean(baseline) || frozen} maxLength={64}
                  onChange={(value) => changeSkill('skillKey', value)} />
              </Form.Item>
            </AuthoringFieldAnchor>
            <AuthoringFieldAnchor field="name" active={activeSkillField === 'name'}>
              <Form.Item label="技能名称" required validateStatus={skillErrors.name ? 'error' : undefined} help={skillErrors.name}>
                <Input aria-label="技能名称" value={draft.skill.name} disabled={frozen} maxLength={100}
                  onChange={(value) => changeSkill('name', value)} />
              </Form.Item>
            </AuthoringFieldAnchor>
            <AuthoringFieldAnchor field="maxLevel" active={activeSkillField === 'maxLevel'}>
              <Form.Item label="最高等级" required validateStatus={skillErrors.maxLevel ? 'error' : undefined} help={skillErrors.maxLevel}>
                <InputNumber aria-label="最高等级" value={draft.skill.maxLevel.trim() ? Number(draft.skill.maxLevel) : undefined}
                  disabled={frozen} min={1} precision={0} style={{ width: '100%' }}
                  onChange={(value) => changeSkill('maxLevel', value === undefined ? '' : String(value))} />
              </Form.Item>
            </AuthoringFieldAnchor>
            <AuthoringFieldAnchor field="skillCategoryKeys" active={activeSkillField === 'skillCategoryKeys'}>
              <Form.Item label="技能分类" validateStatus={skillErrors.skillCategoryKeys ? 'error' : undefined} help={skillErrors.skillCategoryKeys}>
                <Select aria-label="技能分类" mode="multiple" value={draft.skill.skillCategoryKeys}
                  disabled={frozen || !categoryDirectoryReady} options={categoryOptions} placeholder="请选择技能分类"
                  renderTag={({ label, onClose }) => <Tag closable={!frozen} onClose={onClose}>{label}</Tag>}
                  onChange={(value) => changeSkill('skillCategoryKeys', Array.isArray(value) ? value : [])} />
              </Form.Item>
            </AuthoringFieldAnchor>
            <AuthoringFieldAnchor field="description" active={activeSkillField === 'description'}>
              <Form.Item label="说明" validateStatus={skillErrors.description ? 'error' : undefined} help={skillErrors.description}>
                <Input.TextArea aria-label="技能说明" value={draft.skill.description} disabled={frozen}
                  maxLength={2000} showWordLimit autoSize={{ minRows: 3, maxRows: 7 }}
                  onChange={(value) => changeSkill('description', value)} />
              </Form.Item>
            </AuthoringFieldAnchor>
            <AuthoringFieldAnchor field="status" active={activeSkillField === 'status'}>
              <Form.Item label="状态" required validateStatus={skillErrors.status ? 'error' : undefined} help={skillErrors.status}>
                <Radio.Group aria-label="技能状态" value={draft.skill.status} disabled={frozen}
                  onChange={(value) => changeSkill('status', value as SkillStatus)}>
                  <Radio value="ENABLED">启用</Radio><Radio value="DISABLED">停用</Radio>
                </Radio.Group>
              </Form.Item>
            </AuthoringFieldAnchor>
            <AuthoringFieldAnchor field="sortOrder" active={activeSkillField === 'sortOrder'}>
              <Form.Item label="排序" required validateStatus={skillErrors.sortOrder ? 'error' : undefined} help={skillErrors.sortOrder}>
                <InputNumber aria-label="技能排序" value={draft.skill.sortOrder.trim() ? Number(draft.skill.sortOrder) : undefined}
                  disabled={frozen} min={0} precision={0} style={{ width: '100%' }}
                  onChange={(value) => changeSkill('sortOrder', value === undefined ? '' : String(value))} />
              </Form.Item>
            </AuthoringFieldAnchor>
          </Form>
        </Space> : null}

        {module === 'numbers' ? <Space direction="vertical" style={{ width: '100%' }} size="medium">
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Title heading={5} style={{ margin: 0 }}>参数与公式</Typography.Title>
            <Button type="primary" disabled={frozen || Boolean(parameterEditor)} onClick={addParameter}>新增参数</Button>
          </Space>
          {impact?.keys.length ? <Alert type="warning" content={impact.next > impact.previous
            ? `等级已扩大，以下 ${impact.keys.length} 个按技能等级参数都要明确填写新增数值并随主体一起提交。`
            : `等级已缩小，以下 ${impact.keys.length} 个按技能等级参数会一并删除范围外数值。`} /> : null}
          {deletedKeys.length ? <Alert type="warning" content={`待删除参数：${deletedKeys.join('、')}。保存后才生效。`} /> : null}
          {draft.parameters.length ? draft.parameters.map((entry) => {
            const value = entry.draft.valueMode === 'FIXED' ? `固定值 ${entry.draft.fixedValue || '待填写'}`
              : entry.draft.valueMode === 'RUNTIME_INPUT' ? '计算时传入'
                : entry.draft.valueMode === 'SKILL_LEVEL' ? '按技能等级' : '按角色等级';
            const refs = parameterReferences(baseline, entry.draft.parameterKey, draft.formulas,
              draftStates, draftEffects, draftProcesses, draftRules);
            return <div key={entry.id} style={{ border: '1px solid var(--color-border-2)', borderRadius: 6, padding: 12 }}>
              <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                <div><Typography.Text bold>{entry.draft.name || '未命名参数'}</Typography.Text>
                  <Typography.Text type="secondary">（{entry.draft.parameterKey || '待填写标识'}） · {value}</Typography.Text>
                  {parameterErrors[entry.id] && Object.keys(parameterErrors[entry.id]).length
                    ? <Tag color="red">待修正</Tag> : null}</div>
                <Space><Button size="mini" onClick={() => openParameter(entry)} disabled={frozen}>编辑</Button>
                  <Button size="mini" status="danger" onClick={() => removeParameter(entry)} disabled={frozen}>删除</Button></Space>
              </Space>
              {refs.length ? <Typography.Text type="secondary">引用：{refs.join('、')}</Typography.Text> : null}
            </div>;
          }) : <Typography.Text type="secondary">当前没有参数。</Typography.Text>}
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Title heading={6} style={{ margin: 0 }}>公式</Typography.Title>
            <Space>
              {attributeError ? <Button size="mini" onClick={() => void loadAttributes()}>重试属性目录</Button> : null}
              <Button type="primary" disabled={frozen || Boolean(parameterEditor) || Boolean(formulaEditor) || !attributesReady}
                onClick={addFormula}>新增公式</Button>
            </Space>
          </Space>
          {attributeError ? <Alert type="warning" content={`属性目录读取失败：${attributeError}。公式编辑暂不可确认；技能草稿已保留。`} /> : null}
          {deletedFormulaKeys.length ? <Alert type="warning" content={`待删除公式：${deletedFormulaKeys.join('、')}。保存后才生效。`} /> : null}
          {draft.formulas.length ? draft.formulas.map((entry) => {
            const preview = previewFormulaExpression(entry.draft.expression, {
              parameters: overviewParameters(draft, baseline), attributes
            }).map((part) => part.text).join('');
            const refs = formulaReferences(baseline, entry.draft.formulaKey, draftStates,
              draftEffects, draftProcesses, draftRules);
            return <div key={entry.id} style={{ border: '1px solid var(--color-border-2)', borderRadius: 6, padding: 12 }}>
              <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                <div><Typography.Text bold>{entry.draft.name || '未命名公式'}</Typography.Text>
                  <Typography.Text type="secondary">（{entry.draft.formulaKey || '待填写标识'}）</Typography.Text>
                  {formulaErrors[entry.id] && Object.keys(formulaErrors[entry.id]).length
                    ? <Tag color="red">待修正</Tag> : null}</div>
                <Space><Button size="mini" onClick={() => openFormula(entry)} disabled={frozen}>编辑</Button>
                  <Button size="mini" status="danger" onClick={() => removeFormula(entry)} disabled={frozen}>删除</Button></Space>
              </Space>
              <Typography.Text>中文预览：{preview}</Typography.Text>
              {refs.length ? <div><Typography.Text type="secondary">引用：{refs.join('、')}</Typography.Text></div> : null}
              <details><summary style={{ cursor: 'pointer' }}>查看已读取的完整字段</summary>
                {baseline?.formulas.find((item) => item.formulaKey === entry.baselineKey)
                  ? <ReadonlyFormulas formulas={[baseline.formulas.find((item) => item.formulaKey === entry.baselineKey)!]}
                    parameters={overviewParameters(draft, baseline)}
                    notice="这里保留保存时读取的完整字段；当前草稿以本行预览和编辑弹窗为准。" />
                  : <Typography.Text type="secondary">新增公式尚未保存，完整草稿在编辑弹窗中查看。</Typography.Text>}
              </details>
            </div>;
          }) : <Typography.Text type="secondary">当前没有公式。</Typography.Text>}
        </Space> : null}

        {module === 'effects' ? <Space direction="vertical" style={{ width: '100%' }} size="medium">
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Title heading={5} style={{ margin: 0 }}>效果与生命周期</Typography.Title>
            <Button type="primary" disabled={frozen || modalOpen} onClick={addEffect}>新增效果</Button>
          </Space>
          {deletedEffectKeys.length ? <Alert type="warning"
            content={`待删除效果：${deletedEffectKeys.join('、')}。保存后才生效。`} /> : null}
          <ReadonlyEffects effects={draftEffects} parameters={draftParameters} formulas={draftFormulas}
            notice="效果、结果与生命周期先确认到当前技能草稿，再点击顶部保存更改。"
            actions={(effect) => {
              const entry = draft.effects.find((item) => item.draft.effectKey === effect.effectKey);
              return entry ? <Space>
                {effectErrors[entry.id] ? <Tag color="red">{effectErrors[entry.id]}</Tag> : null}
                {entry.baselineKey ? <ObjectRelationActions
                  key={`${apiBaseUrl}:${selectedGameId}:${workingSkill.skillKey}:${effect.effectKey}`}
                  target={{ kind: 'skillEffect', key: effect.effectKey, name: effect.name,
                    skillKey: workingSkill.skillKey }}
                  apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken}
                  onDirtyChange={setRelationDirty}
                /> : null}
                <Button size="mini" disabled={frozen} onClick={() => openEffect(entry)}>编辑</Button>
                <Button size="mini" disabled={frozen} onClick={() => copyEffect(entry)}>复制</Button>
                <Button size="mini" status="danger" disabled={frozen} onClick={() => removeEffect(entry)}>删除</Button>
              </Space> : null;
            }} />
        </Space> : null}
        {module === 'processes' ? <Space direction="vertical" style={{ width: '100%' }} size="medium">
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Title heading={5} style={{ margin: 0 }}>施放过程</Typography.Title>
            <Button type="primary" disabled={frozen || modalOpen} onClick={addProcess}>新增过程</Button>
          </Space>
          {deletedProcessKeys.length ? <Alert type="warning"
            content={`待删除过程：${deletedProcessKeys.join('、')}。保存后才生效。`} /> : null}
          <ReadonlyProcesses processes={draftProcesses}
            notice="过程与步骤先确认到当前技能草稿，再点击顶部保存更改。"
            actions={(process) => {
              const entry = draft.processes.find((item) => item.draft.processKey === process.processKey);
              return entry ? <Space>
                {processErrors[entry.id] ? <Tag color="red">{processErrors[entry.id]}</Tag> : null}
                <Button size="mini" disabled={frozen} onClick={() => openProcess(entry)}>编辑</Button>
                <Button size="mini" status="danger" disabled={frozen} onClick={() => removeProcess(entry)}>删除</Button>
              </Space> : null;
            }} />
        </Space> : null}
        {module === 'states' ? <Space direction="vertical" style={{ width: '100%' }} size="medium">
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Title heading={5} style={{ margin: 0 }}>内部状态</Typography.Title>
            <Button type="primary" disabled={frozen || modalOpen} onClick={addInternalState}>新增内部状态</Button>
          </Space>
          {deletedStateKeys.length ? <Alert type="warning"
            content={`待删除内部状态：${deletedStateKeys.join('、')}。保存后才生效。`} /> : null}
          <ReadonlyStates states={draftStates}
            notice="内部状态先确认到当前技能草稿，再点击顶部保存更改；弹药恢复启动条件须按来源明确选择。"
            actions={(state) => {
              const entry = draft.internalStates.find((item) => item.draft.stateKey === state.stateKey);
              return entry ? <Space>
                {stateErrors[entry.id] ? <Tag color="red">{stateErrors[entry.id]}</Tag> : null}
                <Button size="mini" disabled={frozen} onClick={() => openInternalState(entry)}>编辑</Button>
                <Button size="mini" status="danger" disabled={frozen}
                  onClick={() => removeInternalState(entry)}>删除</Button>
              </Space> : null;
            }} />
        </Space> : null}
        {module === 'rules' ? <Space direction="vertical" style={{ width: '100%' }} size="medium">
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Title heading={5} style={{ margin: 0 }}>条件与触发</Typography.Title>
            <Button type="primary" disabled={frozen || modalOpen} onClick={addRule}>新增规则</Button>
          </Space>
          {deletedRuleKeys.length ? <Alert type="warning"
            content={`待删除规则：${deletedRuleKeys.join('、')}。保存后才生效。`} /> : null}
          <ReadonlyRules rules={draftRules}
            notice="规则、条件和动作先确认到当前技能草稿，再点击顶部保存更改。"
            actions={(rule) => {
              const entry = draft.triggerRules.find((item) => item.draft.ruleKey === rule.ruleKey);
              return entry ? <Space>
                {ruleErrors[entry.id] ? <Tag color="red">{ruleErrors[entry.id]}</Tag> : null}
                <Button size="mini" disabled={frozen} onClick={() => openRule(entry)}>编辑</Button>
                <Button size="mini" status="danger" disabled={frozen} onClick={() => removeRule(entry)}>删除</Button>
              </Space> : null;
            }} />
        </Space> : null}
      </section>
    </div> : null}

    {parameterEditor ? <SkillParameterDraftDialog
      key={parameterEditor.entry.id}
      initial={parameterEditor.entry.draft}
      original={parameterEditor.original}
      skillMaxLevel={validMaxLevel}
      characterLevelRange={characterLevelRange}
      characterLevelError={characterLevelError}
      initialErrors={parameterErrors[parameterEditor.entry.id]}
      authoringLocation={parameterEditor.focus}
      onApply={(next) => applyParameter(parameterEditor.entry, next)}
      onClose={() => { setParameterEditor(null); setParameterModalDirty(false); }}
      onDirtyChange={setParameterModalDirty}
    /> : null}
    {formulaEditor ? <SkillFormulaDraftDialog
      key={formulaEditor.entry.id}
      initial={formulaEditor.entry.draft}
      original={formulaEditor.original}
      parameters={overviewParameters(draft, baseline)}
      attributes={attributes}
      attributesReady={attributesReady}
      attributeError={attributeError}
      initialErrors={formulaErrors[formulaEditor.entry.id]}
      initialNodeIssues={formulaNodeIssues[formulaEditor.entry.id]}
      authoringLocation={formulaEditor.focus}
      onApply={(next) => applyFormula(formulaEditor.entry, next)}
      onClose={() => { setFormulaEditor(null); setFormulaModalDirty(false); }}
      onDirtyChange={setFormulaModalDirty}
    /> : null}
    {internalStateEditor && selectedGameId ? <SkillInternalStateEditorModal
      key={internalStateEditor.entry.id}
      visible mode={internalStateEditor.original ? 'edit' : 'create'}
      skill={workingSkill} internalState={internalStateEditor.original}
      apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken}
      onClose={() => { setInternalStateEditor(null); setStateModalDirty(false); }}
      onSaved={ignoreWorkspaceCallback} onSkillMissing={ignoreWorkspaceCallback} onDirtyChange={setStateModalDirty}
      catalogRevision={0} authoringLocation={internalStateEditor.focus}
      workspaceDraft={{ initial: internalStateEditor.entry.draft, original: internalStateEditor.original,
        parameters: draftParameters, formulas: draftFormulas,
        onApply: (next, value) => applyInternalState(internalStateEditor.entry, next, value) }}
    /> : null}
    {effectEditor && selectedGameId ? <SkillEffectEditorModal
      key={effectEditor.entry.id}
      visible mode={effectEditor.mode} skill={workingSkill}
      effect={effectEditor.original ? draftEffectSummaries.find((item) =>
        item.effectKey === effectEditor.original?.effectKey) ?? null : null}
      apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken}
      onClose={() => { setEffectEditor(null); setEffectModalDirty(false); }}
      onSaved={ignoreWorkspaceCallback} onSkillMissing={ignoreWorkspaceCallback} onDirtyChange={setEffectModalDirty}
      authoringLocation={effectEditor.focus}
      workspaceDraft={{ initial: effectEditor.entry.draft, original: effectEditor.original,
        parameters: draftParameters, formulas: draftFormulas, effects: draftEffectSummaries,
        onApply: (next, value) => applyEffect(effectEditor.entry, next, value) }}
    /> : null}
    {processEditor && selectedGameId ? <SkillProcessEditorModal
      key={processEditor.entry.id}
      visible mode={processEditor.original ? 'edit' : 'create'} skill={workingSkill}
      process={processEditor.original ? draftProcessSummaries.find((item) =>
        item.processKey === processEditor.original?.processKey) ?? null : null}
      apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken}
      onClose={() => { setProcessEditor(null); setProcessModalDirty(false); }}
      onSaved={ignoreWorkspaceCallback} onSkillMissing={ignoreWorkspaceCallback}
      onDirtyChange={setProcessModalDirty} catalogRevision={0}
      authoringLocation={processEditor.focus}
      workspaceDraft={{ initial: processEditor.entry.draft, original: processEditor.original,
        parameters: draftParameters, formulas: draftFormulas, effects: draftEffectSummaries,
        internalStates: draftStateSummaries,
        modeOptionsByStateKey: draftModeOptions,
        onApply: (next, value) => applyProcess(processEditor.entry, next, value) }}
    /> : null}
    {ruleEditor && selectedGameId ? <SkillTriggerRuleEditorModal
      key={ruleEditor.entry.id}
      visible mode={ruleEditor.original ? 'edit' : 'create'} skill={workingSkill}
      rule={ruleEditor.original ? draftRuleSummaries.find((item) =>
        item.ruleKey === ruleEditor.original?.ruleKey) ?? null : null}
      apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken}
      onClose={() => { setRuleEditor(null); setRuleModalDirty(false); }}
      onSaved={ignoreWorkspaceCallback} onSkillMissing={ignoreWorkspaceCallback}
      onRuleMissing={ignoreWorkspaceCallback} onDirtyChange={setRuleModalDirty}
      authoringLocation={ruleEditor.focus}
      workspaceDraft={{ initial: ruleEditor.entry.draft, original: ruleEditor.original,
        parameters: draftParameters, formulas: draftFormulas, effects: draftEffects,
        processes: draftProcesses, internalStates: draftStates, rules: draftRules,
        onApply: (next, value) => applyRule(ruleEditor.entry, next, value) }}
    /> : null}
  </div>;
}
