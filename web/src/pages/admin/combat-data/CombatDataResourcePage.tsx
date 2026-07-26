import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Message,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Typography
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../../../components/EmptyState';
import {
  CombatDataImageReferenceField,
  CombatDataImageReferencePreview
} from '../../../components/CombatDataImageReferenceField';
import { Panel } from '../../../components/Panel';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import {
  createUntouchedImageReference
} from '../../../services/combatDataImageReference';
import {
  formatCombatDataError,
  getEffectSequences,
  getProviderFormulas,
  getTypes,
  putEffectStep
} from '../../../services/combatDataClient';
import type {
  EffectSequence,
  ProviderFormula,
  TypeDefinition
} from '../../../types/combatData';
import { combatDataHref, type FilterFieldPair } from '../combatDataNav';
import {
  buildSemanticTypeOptions,
  formatStableLabel,
  listProviderFormulasForSelectedSequence,
  listSortedSequences
} from '../effect-step-setup/effectStepSetupModel';
import {
  EffectStepEditor,
  buildEffectStepPutFromEditor,
  createEmptyEffectStepEditorState,
  recordToEffectStepEditorState,
  recordToSemanticEffectStepEditorState,
  type EffectStepEditorState,
  type EffectStepSemanticTypeOptions
} from './EffectStepEditor';
import {
  MAX_CONCURRENT_DOWNSTREAM_REQUESTS,
  applyMultiHopTargetFilter,
  buildCreateChildPrefill,
  buildDownstreamFilterPairs,
  buildFilterPairsForEdge,
  buildSavedRecordFilterPairs,
  classifyNeighborState,
  filterRecordsByPairs,
  getMultiHopChainForResource,
  listDownstreamEdges,
  listUpstreamEdges,
  mapWithConcurrency,
  matchRecordByFilterPairs,
  neighborStateLabel,
  resolveReferenceLabel,
  searchRecords,
  type NeighborRelationState,
  type RelationEdge
} from './resourceRelations';
import {
  buildReferenceOptions,
  buildResourceCopyForm,
  classifyReferenceAssistance,
  combatDataFieldDomId,
  createEmptyForm,
  decodeImageReferenceFormValue,
  encodeImageReferenceFormValue,
  filterReferenceRecords,
  getCombatDataResource,
  getFirstInvalidResourceFieldName,
  getRecordRowKey,
  listDependentFieldsToClear,
  listDistinctNonSelfReferenceResourceIds,
  listScopedReferenceFieldsToClear,
  pickDisplayColumns,
  recordToForm,
  resolveActiveReferences,
  validateResourceForm,
  type FieldDef,
  type FieldOption,
  type ReferenceDef,
  type ResourceFormValues
} from './resourceRegistry';

type WorkspaceMode = 'guided' | 'advanced';
type ModalMode = 'create' | 'edit' | 'view';

type CombatDataResourcePageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  resourceId: string;
  /** True when GET /api/games already succeeded for this API base. */
  gamesReachable?: boolean;
  /**
   * When true, skip the outer Panel title/summary (parent CombatDataPage already shows them).
   * Table actions and modal still render.
   */
  hideHeaderSummary?: boolean;
  filterPairs?: FilterFieldPair[];
  onCommitted?: (revision: number) => void;
};

type ReferenceLoadEntry =
  | { status: 'ready'; records: Record<string, unknown>[] }
  | { status: 'failed'; message: string }
  | { status: 'loading' };

type DownstreamLoadEntry =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; records: Record<string, unknown>[] }
  | { status: 'failed'; message: string };

type SuccessPanelState = {
  currentRevision: number;
  savedLabel: string;
  /** Exact path-key filter pairs for the record that was saved (includes stepId). */
  savedPairs: FilterFieldPair[];
  /** True when post-refresh readback could not locate the saved row. */
  readbackMissing: boolean;
};

const CREATE_PREFILL_STORAGE_KEY = 'damage-viewer.web.combat-data-create-prefill';

function filterSelectOption(inputValue: string, option: unknown): boolean {
  const needle = inputValue.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  if (!option || typeof option !== 'object') {
    return false;
  }
  const record = option as {
    value?: unknown;
    children?: unknown;
    label?: unknown;
    props?: { value?: unknown; children?: unknown; label?: unknown };
  };
  const candidates = [
    record.value,
    record.label,
    record.children,
    record.props?.value,
    record.props?.label,
    record.props?.children
  ];
  return candidates.some((item) => String(item ?? '').toLowerCase().includes(needle));
}

function formatCellValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '--';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function edgeKey(edge: RelationEdge): string {
  return [
    edge.fromResourceId,
    edge.toResourceId,
    edge.kind,
    edge.dependsOn ?? '',
    edge.dependsOnValue ?? '',
    edge.fieldPairs.map((pair) => `${pair.fromField}->${pair.toField}`).join('|')
  ].join('::');
}

function recordPrimaryLabel(
  record: Record<string, unknown>,
  pathKeys: string[],
  fields: FieldDef[]
): { primary: string; secondary?: string } {
  const pathParts = pathKeys.map((key) => String(record[key] ?? '')).filter(Boolean);
  const pathLabel = pathParts.join(' / ') || '--';
  const nameField = fields.find(
    (field) =>
      field.name === 'displayName' ||
      field.name === 'attrName' ||
      field.name === 'name' ||
      field.name === 'stageLabel'
  );
  if (nameField) {
    const name = String(record[nameField.name] ?? '').trim();
    if (name && name !== pathLabel) {
      return { primary: name, secondary: pathLabel };
    }
  }
  return { primary: pathLabel };
}

function stashCreatePrefill(resourceId: string, form: ResourceFormValues): void {
  try {
    sessionStorage.setItem(CREATE_PREFILL_STORAGE_KEY, JSON.stringify({ resourceId, form }));
  } catch {
    // ignore quota / private mode
  }
}

function takeCreatePrefill(resourceId: string): ResourceFormValues | null {
  try {
    const raw = sessionStorage.getItem(CREATE_PREFILL_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { resourceId?: string; form?: ResourceFormValues };
    if (parsed.resourceId !== resourceId || !parsed.form || typeof parsed.form !== 'object') {
      return null;
    }
    sessionStorage.removeItem(CREATE_PREFILL_STORAGE_KEY);
    return parsed.form;
  } catch {
    return null;
  }
}

function ResourceFieldInput({
  field,
  value,
  disabled,
  onChange,
  referenceOptions,
  inputId,
  apiBaseUrl,
  gameId,
  adminToken,
  fieldError
}: {
  field: FieldDef;
  value: string | number | boolean;
  disabled: boolean;
  onChange: (next: string | number | boolean) => void;
  /** When set, render searchable Select assistance instead of the FieldDef control. */
  referenceOptions?: FieldOption[];
  /** Stable id for validation focus; kept on locked/read-only controls. */
  inputId?: string;
  apiBaseUrl: string;
  gameId: string | null;
  adminToken: string;
  fieldError?: string | null;
}) {
  if (field.kind === 'image-reference') {
    const imageValue = decodeImageReferenceFormValue(value);
    return (
      <CombatDataImageReferenceField
        id={inputId}
        value={imageValue}
        onChange={
          disabled
            ? undefined
            : (next) => onChange(encodeImageReferenceFormValue(next))
        }
        apiBaseUrl={apiBaseUrl}
        gameId={gameId}
        adminToken={adminToken}
        readOnly={disabled}
        error={fieldError}
      />
    );
  }

  if (referenceOptions) {
    return (
      <Select
        id={inputId}
        showSearch
        value={value === '' ? undefined : String(value)}
        disabled={disabled}
        placeholder={field.placeholder}
        options={referenceOptions}
        allowClear={!field.required}
        filterOption={filterSelectOption}
        onChange={(next) => onChange(next ?? '')}
      />
    );
  }

  if (field.kind === 'boolean') {
    return (
      <Switch id={inputId} checked={Boolean(value)} disabled={disabled} onChange={(checked) => onChange(checked)} />
    );
  }

  if (field.kind === 'number') {
    return (
      <InputNumber
        id={inputId}
        value={value === '' || value === undefined ? undefined : Number(value)}
        disabled={disabled}
        placeholder={field.placeholder}
        onChange={(next) => onChange(next ?? '')}
        style={{ width: '100%' }}
      />
    );
  }

  if (field.kind === 'select') {
    return (
      <Select
        id={inputId}
        value={value === '' ? undefined : String(value)}
        disabled={disabled}
        placeholder={field.placeholder}
        options={field.options}
        allowClear={!field.required}
        onChange={(next) => onChange(next ?? '')}
      />
    );
  }

  if (field.kind === 'json' || field.kind === 'textarea') {
    return (
      <Input.TextArea
        id={inputId}
        value={String(value ?? '')}
        disabled={disabled}
        placeholder={field.placeholder}
        autoSize={{ minRows: field.kind === 'json' ? 4 : 3, maxRows: 10 }}
        onChange={(next) => onChange(next)}
      />
    );
  }

  return (
    <Input
      id={inputId}
      value={String(value ?? '')}
      disabled={disabled}
      placeholder={field.placeholder}
      onChange={(next) => onChange(next)}
    />
  );
}

function focusCombatDataField(fieldName: string): void {
  const id = combatDataFieldDomId(fieldName);
  const byId = document.getElementById(id);
  if (byId && typeof byId.focus === 'function') {
    byId.focus();
    return;
  }
  const wrapper = document.querySelector(`[data-combat-field="${fieldName}"]`);
  const focusable = wrapper?.querySelector(
    'input:not([disabled]), textarea:not([disabled]), button:not([disabled]), .arco-select-view'
  ) as HTMLElement | null | undefined;
  focusable?.focus();
}

function NeighborStatusText({ state }: { state: NeighborRelationState }) {
  const label = neighborStateLabel(state);
  return (
    <span className={`combat-data-gux-neighbor-status is-${state.status}`} role="status">
      {label}
    </span>
  );
}

export function CombatDataResourcePage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  resourceId,
  gamesReachable = false,
  hideHeaderSummary = false,
  filterPairs = [],
  onCommitted
}: CombatDataResourcePageProps) {
  const config = getCombatDataResource(resourceId);
  const token = adminToken.trim();
  const saveDisabled = !selectedGameId || !token;
  const listDisabled = !selectedGameId;
  const isEffectStep = config?.kind === 'effect-step';
  const isSingleton = config?.kind === 'singleton';

  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('guided');
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [listRevision, setListRevision] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [form, setForm] = useState<ResourceFormValues>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [effectState, setEffectState] = useState<EffectStepEditorState>(createEmptyEffectStepEditorState());
  const [saving, setSaving] = useState(false);
  const [referenceLoads, setReferenceLoads] = useState<Record<string, ReferenceLoadEntry>>({});
  const [referenceWarning, setReferenceWarning] = useState<string | null>(null);
  const [relationCacheTick, setRelationCacheTick] = useState(0);

  const [downstreamLoads, setDownstreamLoads] = useState<Record<string, DownstreamLoadEntry>>({});
  const [expandedDownstreamKeys, setExpandedDownstreamKeys] = useState<string[]>([]);
  const downstreamGenerationRef = useRef(0);
  const pendingSavedSelectRef = useRef<FilterFieldPair[] | null>(null);

  const [successPanel, setSuccessPanel] = useState<SuccessPanelState | null>(null);

  const [types, setTypes] = useState<TypeDefinition[]>([]);
  const [sequences, setSequences] = useState<EffectSequence[]>([]);
  const [providerFormulas, setProviderFormulas] = useState<ProviderFormula[]>([]);
  const [effectAssistLoaded, setEffectAssistLoaded] = useState(false);
  const [effectAssistWarning, setEffectAssistWarning] = useState<string | null>(null);

  const upstreamEdges = useMemo(() => (config ? listUpstreamEdges(config.id) : []), [config]);
  const downstreamEdges = useMemo(() => (config ? listDownstreamEdges(config.id) : []), [config]);
  const multiHopChain = useMemo(
    () => (config ? getMultiHopChainForResource(config.id) : undefined),
    [config]
  );

  const activeReferences = useMemo(() => {
    if (!config) {
      return [] as ReferenceDef[];
    }
    return resolveActiveReferences(config, form);
  }, [config, form]);

  const referenceByField = useMemo(() => {
    const map = new Map<string, ReferenceDef>();
    for (const reference of activeReferences) {
      map.set(reference.field, reference);
    }
    return map;
  }, [activeReferences]);

  const activeReferenceResourceIds = useMemo(
    () => (config ? listDistinctNonSelfReferenceResourceIds(activeReferences, config.id) : []),
    [activeReferences, config]
  );

  const upstreamResourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of upstreamEdges) {
      if (edge.kind !== 'semantic') {
        ids.add(edge.toResourceId);
      }
    }
    for (const id of activeReferenceResourceIds) {
      ids.add(id);
    }
    if (multiHopChain) {
      for (const hop of multiHopChain.hops) {
        ids.add(hop.resourceId);
      }
      ids.add(multiHopChain.targetFilter.resourceId);
    }
    return [...ids];
  }, [upstreamEdges, activeReferenceResourceIds, multiHopChain]);

  const upstreamResourceIdsKey = upstreamResourceIds.join('|');

  const filteredRecords = useMemo(() => {
    const byFilter = filterRecordsByPairs(records, filterPairs);
    return searchRecords(byFilter, searchQuery);
  }, [records, filterPairs, searchQuery]);

  const selectedRecord = useMemo(() => {
    if (!selectedRowKey || !config) {
      return null;
    }
    return (
      filteredRecords.find(
        (record, index) => getRecordRowKey(record, config.pathKeys, index) === selectedRowKey
      ) ?? null
    );
  }, [selectedRowKey, filteredRecords, config]);

  const savedReceiptRecord = useMemo(() => {
    if (!successPanel || !config) {
      return null;
    }
    if (successPanel.savedPairs.length === 0) {
      // Singleton / empty pathKeys: only accept a single unambiguous row.
      if (config.pathKeys.length > 0) {
        return null;
      }
      return records.length === 1 ? records[0]! : null;
    }
    return records.find((record) => matchRecordByFilterPairs(record, successPanel.savedPairs)) ?? null;
  }, [successPanel, records, config]);

  const semanticTypeOptions = useMemo<EffectStepSemanticTypeOptions | undefined>(() => {
    if (!isEffectStep || workspaceMode !== 'guided' || !effectAssistLoaded) {
      return undefined;
    }
    return buildSemanticTypeOptions(types);
  }, [isEffectStep, workspaceMode, effectAssistLoaded, types]);

  const sequenceOptions = useMemo(() => {
    if (!isEffectStep || workspaceMode !== 'guided' || !effectAssistLoaded) {
      return undefined;
    }
    return listSortedSequences(sequences).map((item) => ({
      value: item.sequenceId,
      label: formatStableLabel(item.sequenceId, item.displayName)
    }));
  }, [isEffectStep, workspaceMode, effectAssistLoaded, sequences]);

  const providerFormulaRecords = useMemo(() => {
    if (!isEffectStep || workspaceMode !== 'guided' || !effectAssistLoaded) {
      return undefined;
    }
    return listProviderFormulasForSelectedSequence(
      sequences,
      providerFormulas,
      String(effectState.common.sequenceId ?? '')
    );
  }, [
    isEffectStep,
    workspaceMode,
    effectAssistLoaded,
    sequences,
    providerFormulas,
    effectState.common.sequenceId
  ]);

  const refreshList = useCallback(async () => {
    if (!config || !selectedGameId) {
      setRecords([]);
      setListRevision(undefined);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = await config.list(apiBaseUrl, selectedGameId);
      setRecords(Array.isArray(result.records) ? result.records : []);
      setListRevision(result.currentRevision);
    } catch (err) {
      setRecords([]);
      setError(
        formatCombatDataError(err, 'contract-entry', {
          apiBaseUrl,
          gamesReachable
        })
      );
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, config, gamesReachable, selectedGameId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    const pairs = pendingSavedSelectRef.current;
    if (!pairs || !config || loading) {
      return;
    }
    pendingSavedSelectRef.current = null;
    const index = records.findIndex((record) => matchRecordByFilterPairs(record, pairs));
    if (index < 0) {
      setSuccessPanel((prev) => (prev ? { ...prev, readbackMissing: true } : null));
      return;
    }
    const record = records[index]!;
    // Prefer filtered list index so guided row keys stay consistent when filters apply.
    const filteredIndex = filteredRecords.findIndex((item) =>
      matchRecordByFilterPairs(item, pairs)
    );
    if (filteredIndex >= 0) {
      setSelectedRowKey(
        getRecordRowKey(filteredRecords[filteredIndex]!, config.pathKeys, filteredIndex)
      );
    } else {
      setSelectedRowKey(getRecordRowKey(record, config.pathKeys, index));
    }
    setSuccessPanel((prev) => (prev ? { ...prev, readbackMissing: false } : null));
  }, [records, filteredRecords, loading, config]);

  useEffect(() => {
    setSelectedRowKey(null);
    setSearchQuery('');
    downstreamGenerationRef.current += 1;
    setExpandedDownstreamKeys([]);
    setDownstreamLoads({});
    setSuccessPanel(null);
    pendingSavedSelectRef.current = null;
  }, [resourceId]);

  useEffect(() => {
    setSelectedRowKey(null);
  }, [filterPairs]);

  useEffect(() => {
    downstreamGenerationRef.current += 1;
    setExpandedDownstreamKeys([]);
    setDownstreamLoads({});
  }, [selectedRowKey, selectedGameId, relationCacheTick]);

  // Load direct upstreams needed for editing / guided labels (never all 30).
  useEffect(() => {
    if (!config || !selectedGameId) {
      setReferenceLoads({});
      setReferenceWarning(null);
      return;
    }

    const resourceIds = upstreamResourceIdsKey ? upstreamResourceIdsKey.split('|') : [];
    if (resourceIds.length === 0) {
      setReferenceLoads({});
      setReferenceWarning(null);
      return;
    }

    let cancelled = false;
    setReferenceLoads((prev) => {
      const next: Record<string, ReferenceLoadEntry> = {};
      for (const id of resourceIds) {
        next[id] = prev[id]?.status === 'ready' ? prev[id]! : { status: 'loading' };
      }
      return next;
    });

    void (async () => {
      const nextLoads: Record<string, ReferenceLoadEntry> = {};
      const warnings: string[] = [];

      await mapWithConcurrency(resourceIds, MAX_CONCURRENT_DOWNSTREAM_REQUESTS, async (refResourceId) => {
        const refConfig = getCombatDataResource(refResourceId);
        if (!refConfig) {
          nextLoads[refResourceId] = {
            status: 'failed',
            message: `未知引用资源：${refResourceId}`
          };
          warnings.push(`引用 ${refResourceId} 加载失败：未知资源`);
          return;
        }

        try {
          const result = await refConfig.list(apiBaseUrl, selectedGameId);
          nextLoads[refResourceId] = {
            status: 'ready',
            records: Array.isArray(result.records) ? result.records : []
          };
        } catch (err) {
          const message = getErrorMessage(err);
          nextLoads[refResourceId] = { status: 'failed', message };
          warnings.push(`引用 ${refConfig.label}（${refResourceId}）加载失败：${message}`);
        }
      });

      if (cancelled) {
        return;
      }

      setReferenceLoads(nextLoads);
      setReferenceWarning(warnings.length > 0 ? warnings.join('；') : null);
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, config, selectedGameId, upstreamResourceIdsKey, relationCacheTick]);

  // Guided effect-steps: reuse setup catalogs (types / sequences / provider formulas).
  useEffect(() => {
    if (!isEffectStep || workspaceMode !== 'guided' || !selectedGameId) {
      setEffectAssistLoaded(false);
      setEffectAssistWarning(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      setEffectAssistLoaded(false);
      setEffectAssistWarning(null);
      const warnings: string[] = [];

      try {
        const [typesResult, sequencesResult] = await Promise.all([
          getTypes(apiBaseUrl, selectedGameId),
          getEffectSequences(apiBaseUrl, selectedGameId)
        ]);
        if (cancelled) {
          return;
        }
        setTypes(typesResult.data.data);
        setSequences(sequencesResult.data.data);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setTypes([]);
        setSequences([]);
        warnings.push(`语义目录加载失败：${getErrorMessage(err)}`);
      }

      try {
        const formulasResult = await getProviderFormulas(apiBaseUrl, selectedGameId);
        if (cancelled) {
          return;
        }
        setProviderFormulas(formulasResult.data.data);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setProviderFormulas([]);
        warnings.push(`Provider 公式加载失败：${getErrorMessage(err)}`);
      }

      if (cancelled) {
        return;
      }
      setEffectAssistLoaded(true);
      setEffectAssistWarning(warnings.length > 0 ? warnings.join('；') : null);
    })();

    return () => {
      cancelled = true;
    };
  }, [isEffectStep, workspaceMode, selectedGameId, apiBaseUrl, relationCacheTick]);

  const loadDownstreamEdge = useCallback(
    async (edge: RelationEdge) => {
      if (!selectedGameId || !selectedRecord || !selectedRowKey) {
        return;
      }
      const generation = downstreamGenerationRef.current;
      const contextRowKey = selectedRowKey;
      const key = edgeKey(edge);
      setDownstreamLoads((prev) => {
        if (downstreamGenerationRef.current !== generation) {
          return prev;
        }
        return { ...prev, [key]: { status: 'loading' } };
      });

      const childConfig = getCombatDataResource(edge.fromResourceId);
      if (!childConfig) {
        if (downstreamGenerationRef.current !== generation || selectedRowKey !== contextRowKey) {
          return;
        }
        setDownstreamLoads((prev) => ({
          ...prev,
          [key]: { status: 'failed', message: `未知资源：${edge.fromResourceId}` }
        }));
        return;
      }

      try {
        const result = await childConfig.list(apiBaseUrl, selectedGameId);
        if (downstreamGenerationRef.current !== generation) {
          return;
        }
        const all = Array.isArray(result.records) ? result.records : [];
        const pairs = buildDownstreamFilterPairs(edge, selectedRecord);
        const matched = pairs ? filterRecordsByPairs(all, pairs) : [];
        setDownstreamLoads((prev) => ({
          ...prev,
          [key]: { status: 'ready', records: matched }
        }));
      } catch (err) {
        if (downstreamGenerationRef.current !== generation) {
          return;
        }
        setDownstreamLoads((prev) => ({
          ...prev,
          [key]: { status: 'failed', message: getErrorMessage(err) }
        }));
      }
    },
    [apiBaseUrl, selectedGameId, selectedRecord, selectedRowKey]
  );

  useEffect(() => {
    if (!selectedRecord || expandedDownstreamKeys.length === 0) {
      return;
    }
    const pending = downstreamEdges.filter((edge) => {
      const key = edgeKey(edge);
      if (!expandedDownstreamKeys.includes(key)) {
        return false;
      }
      const load = downstreamLoads[key];
      return !load || load.status === 'idle';
    });
    if (pending.length === 0) {
      return;
    }
    void mapWithConcurrency(pending, MAX_CONCURRENT_DOWNSTREAM_REQUESTS, async (edge) => {
      await loadDownstreamEdge(edge);
    });
  }, [
    selectedRecord,
    expandedDownstreamKeys,
    downstreamEdges,
    downstreamLoads,
    loadDownstreamEdge
  ]);

  const openCreate = useCallback(
    (prefill?: ResourceFormValues | null) => {
      if (!config) {
        return;
      }
      setModalMode('create');
      setSuccessPanel(null);

      const stored = prefill ?? takeCreatePrefill(config.id);
      if (config.kind === 'effect-step') {
        if (stored) {
          const asRecord = { ...stored } as Record<string, unknown>;
          setEffectState(
            semanticTypeOptions
              ? recordToSemanticEffectStepEditorState(asRecord, semanticTypeOptions)
              : recordToEffectStepEditorState(asRecord)
          );
        } else {
          setEffectState(createEmptyEffectStepEditorState());
        }
      } else if (config.kind === 'singleton' && records[0]) {
        setForm(recordToForm(records[0], config.fields));
      } else if (stored) {
        setForm({ ...createEmptyForm(config.fields), ...stored });
      } else {
        const empty = createEmptyForm(config.fields);
        // When filterPairs target editable reference/path fields, seed create draft.
        for (const pair of filterPairs) {
          if (config.fields.some((field) => field.name === pair.field)) {
            empty[pair.field] = pair.value;
          }
        }
        setForm(empty);
      }
      setFieldErrors({});
      setModalVisible(true);
    },
    [config, records, filterPairs, semanticTypeOptions]
  );

  const openCopy = useCallback(() => {
    if (!config || !selectedRecord) {
      return;
    }
    setModalMode('create');
    setSuccessPanel(null);
    if (config.kind === 'effect-step') {
      const copied = semanticTypeOptions
        ? recordToSemanticEffectStepEditorState(selectedRecord, semanticTypeOptions)
        : recordToEffectStepEditorState(selectedRecord);
      setEffectState({
        ...copied,
        common: {
          ...copied.common,
          stepId: ''
        }
      });
    } else {
      setForm(buildResourceCopyForm(config, selectedRecord));
    }
    setFieldErrors({});
    setModalVisible(true);
  }, [config, selectedRecord, semanticTypeOptions]);

  const openEdit = useCallback(
    (record: Record<string, unknown>) => {
      if (!config) {
        return;
      }
      setModalMode('edit');
      if (config.kind === 'effect-step') {
        setEffectState(
          semanticTypeOptions
            ? recordToSemanticEffectStepEditorState(record, semanticTypeOptions)
            : recordToEffectStepEditorState(record)
        );
      } else {
        setForm(recordToForm(record, config.fields));
      }
      setFieldErrors({});
      setModalVisible(true);
    },
    [config, semanticTypeOptions]
  );

  const openView = useCallback(
    (record: Record<string, unknown>) => {
      if (!config) {
        return;
      }
      setModalMode('view');
      if (config.kind === 'effect-step') {
        setEffectState(
          semanticTypeOptions
            ? recordToSemanticEffectStepEditorState(record, semanticTypeOptions)
            : recordToEffectStepEditorState(record)
        );
      } else {
        setForm(recordToForm(record, config.fields));
      }
      setFieldErrors({});
      setModalVisible(true);
    },
    [config, semanticTypeOptions]
  );

  useEffect(() => {
    const pending = takeCreatePrefill(resourceId);
    if (pending) {
      openCreate(pending);
    }
    // Only consume stashed prefill on resource mount / navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId]);

  const columns = useMemo<TableColumnProps[]>(() => {
    if (!config) {
      return [];
    }
    const displayFields = pickDisplayColumns(config.fields, config.pathKeys);
    const cols: TableColumnProps[] = displayFields.map((field) => ({
      title: field.label,
      dataIndex: field.name,
      width: 160,
      render: (value: unknown) => formatCellValue(value)
    }));
    cols.push({
      title: '操作',
      width: 160,
      fixed: 'right',
      render: (_: unknown, record: Record<string, unknown>) => (
        <Space>
          <Button size="mini" onClick={() => openView(record)}>
            查看
          </Button>
          <Button size="mini" type="primary" disabled={saveDisabled} onClick={() => openEdit(record)}>
            编辑
          </Button>
        </Space>
      )
    });
    return cols;
  }, [config, openEdit, openView, saveDisabled]);

  const resolveFieldReferenceOptions = useCallback(
    (field: FieldDef, fieldValue: string | number | boolean): FieldOption[] | undefined => {
      if (!config) {
        return undefined;
      }
      const reference = referenceByField.get(field.name);
      if (!reference) {
        return undefined;
      }

      // Multi-hop same-Provider assistance for sequenceId Select.
      if (
        multiHopChain &&
        multiHopChain.assistanceField === field.name &&
        reference.resourceId === multiHopChain.targetFilter.resourceId
      ) {
        const targetLoad = referenceLoads[multiHopChain.targetFilter.resourceId];
        if (targetLoad?.status !== 'ready') {
          return undefined;
        }
        const recordsByResource: Record<string, Record<string, unknown>[] | undefined> = {};
        let hopFailed = false;
        for (const hop of multiHopChain.hops) {
          const hopLoad = referenceLoads[hop.resourceId];
          if (hopLoad?.status === 'failed') {
            hopFailed = true;
            break;
          }
          recordsByResource[hop.resourceId] =
            hopLoad?.status === 'ready' ? hopLoad.records : undefined;
        }
        if (hopFailed) {
          return undefined;
        }
        const filtered = applyMultiHopTargetFilter(
          multiHopChain,
          form[multiHopChain.sourceField],
          recordsByResource,
          targetLoad.records
        );
        if (!filtered.ok) {
          return undefined;
        }
        return buildReferenceOptions(
          filtered.records,
          reference.valueKey,
          reference.labelKey,
          fieldValue
        );
      }

      const ownerLookup = reference.scope?.ownerLookup;
      const targetLoad = referenceLoads[reference.resourceId];
      const ownerLoad = ownerLookup ? referenceLoads[ownerLookup.resourceId] : undefined;
      const loadFailed =
        targetLoad?.status === 'failed' ||
        (ownerLookup !== undefined && ownerLoad?.status === 'failed');
      const assistanceStatus = classifyReferenceAssistance(reference, config.id, loadFailed);
      if (assistanceStatus === 'available' && targetLoad?.status === 'ready') {
        if (ownerLookup) {
          if (ownerLoad?.status === 'ready') {
            return buildReferenceOptions(
              filterReferenceRecords(targetLoad.records, reference, form, {
                [ownerLookup.resourceId]: ownerLoad.records
              }),
              reference.valueKey,
              reference.labelKey,
              fieldValue
            );
          }
        } else {
          return buildReferenceOptions(
            filterReferenceRecords(targetLoad.records, reference, form),
            reference.valueKey,
            reference.labelKey,
            fieldValue
          );
        }
      }
      return undefined;
    },
    [config, referenceByField, referenceLoads, form, multiHopChain]
  );

  const submitModal = async () => {
    if (!config) {
      return;
    }
    if (!selectedGameId) {
      Message.warning('请先选择当前 gameId。');
      return;
    }
    if (!token) {
      Message.warning('请先在顶部会话区域填写 Admin Token。');
      return;
    }

    try {
      setSaving(true);
      let currentRevision = 0;
      let savedLabel = config.label;
      let savedPairs: FilterFieldPair[] = [];

      if (config.kind === 'effect-step') {
        const body = buildEffectStepPutFromEditor(
          effectState,
          workspaceMode === 'guided' ? semanticTypeOptions : undefined
        );
        const stepId = String(effectState.common.stepId ?? '').trim();
        const result = await putEffectStep(apiBaseUrl, selectedGameId, stepId, token, body);
        currentRevision = result.data.currentRevision;
        savedLabel = stepId || config.label;
        savedPairs = buildSavedRecordFilterPairs(config.pathKeys, { stepId });
      } else {
        const validationError = validateResourceForm(config, form);
        if (validationError) {
          Message.error(validationError);
          const invalidField = getFirstInvalidResourceFieldName(config, form);
          if (invalidField) {
            window.requestAnimationFrame(() => focusCombatDataField(invalidField));
          }
          return;
        }
        const result = await config.put(apiBaseUrl, selectedGameId, token, form);
        currentRevision = result.currentRevision;
        const pathParts = config.pathKeys.map((key) => String(form[key] ?? '')).filter(Boolean);
        savedLabel = pathParts.join(' / ') || config.label;
        savedPairs = buildSavedRecordFilterPairs(config.pathKeys, form);
      }

      setModalVisible(false);
      pendingSavedSelectRef.current = savedPairs;
      setSuccessPanel({
        currentRevision,
        savedLabel,
        savedPairs,
        readbackMissing: false
      });
      await refreshList();
      setRelationCacheTick((value) => value + 1);
      onCommitted?.(currentRevision);
      Message.success(`保存成功，currentRevision=${currentRevision}`);
    } catch (err) {
      // Preserve draft on 409 / any failure — modal stays open.
      const status = err instanceof ApiRequestError ? err.status : undefined;
      const detailsPath =
        err instanceof ApiRequestError && err.details && typeof err.details.path === 'string'
          ? err.details.path
          : null;
      if (status === 400 && (detailsPath === '/imageUri' || detailsPath === 'imageUri')) {
        setFieldErrors({ imageUri: getErrorMessage(err) });
        window.requestAnimationFrame(() => focusCombatDataField('imageUri'));
      }
      const suffix = status === 409 ? '（版本冲突 409，草稿已保留）' : '';
      Message.error(`${getErrorMessage(err)}${suffix}`);
    } finally {
      setSaving(false);
    }
  };

  const selectRecordByOffset = (delta: number) => {
    if (!config || filteredRecords.length === 0) {
      return;
    }
    const keys = filteredRecords.map((record, index) =>
      getRecordRowKey(record, config.pathKeys, index)
    );
    const currentIndex = selectedRowKey ? keys.indexOf(selectedRowKey) : -1;
    const nextIndex =
      currentIndex < 0
        ? delta > 0
          ? 0
          : keys.length - 1
        : Math.max(0, Math.min(keys.length - 1, currentIndex + delta));
    setSelectedRowKey(keys[nextIndex] ?? null);
  };

  if (!config) {
    return <Alert type="error" content={`未知资源：${resourceId}`} />;
  }

  const readOnly = modalMode === 'view';
  const lockPathKeys = modalMode !== 'create';
  const blockerMessage = !selectedGameId
    ? '请先选择当前 gameId。'
    : !token
      ? '填写 Admin Token 后可保存；列表可在无 Token 时通过公开 GET 加载。'
      : null;

  const listActions = (
    <Space wrap>
      <Radio.Group
        type="button"
        size="small"
        value={workspaceMode}
        onChange={(value) => setWorkspaceMode(value as WorkspaceMode)}
        className="combat-data-gux-mode"
      >
        <Radio value="guided">关系引导</Radio>
        <Radio value="advanced">高级逐表</Radio>
      </Radio.Group>
      <Button onClick={() => void refreshList()} disabled={listDisabled} loading={loading}>
        刷新
      </Button>
      <Button type="primary" onClick={() => openCreate()} disabled={saveDisabled}>
        {isSingleton ? '写入 / 覆盖' : '新增'}
      </Button>
      {!isSingleton ? (
        <Button onClick={openCopy} disabled={saveDisabled || !selectedRecord}>
          复制所选
        </Button>
      ) : null}
    </Space>
  );

  const table = (
    <Table
      className="data-table-shell"
      loading={loading}
      columns={columns}
      data={filteredRecords}
      pagination={false}
      rowKey={(record: Record<string, unknown>) => getRecordRowKey(record, config.pathKeys, 0)}
      scroll={{ x: Math.max(960, columns.length * 160) }}
      noDataElement={
        <EmptyState title={`暂无${config.label}`} description="列表为空时可直接新增；公开 GET 无数据时不会崩溃。" />
      }
    />
  );

  const renderUpstreamEdge = (edge: RelationEdge) => {
    const targetConfig = getCombatDataResource(edge.toResourceId);
    const title = targetConfig?.label ?? edge.toResourceId;
    const key = edgeKey(edge);

    if (edge.kind === 'semantic') {
      return (
        <div key={key} className="combat-data-gux-neighbor">
          <div className="combat-data-gux-neighbor-head">
            <Typography.Text bold>{title}</Typography.Text>
            <Typography.Text type="secondary">{edge.label ?? '语义上下文'}</Typography.Text>
          </div>
          <Typography.Text type="secondary">
            语义上下文（非外键筛选）：{edge.label ?? targetConfig?.workflow.purpose ?? '--'}
          </Typography.Text>
          <Button size="mini" type="text" href={combatDataHref(edge.toResourceId)}>
            打开上游
          </Button>
        </div>
      );
    }

    const load = referenceLoads[edge.toResourceId];
    const loadingState = !load || load.status === 'loading';
    const failed = load?.status === 'failed';
    const upstreamEmpty = load?.status === 'ready' && load.records.length === 0;
    const pairs = selectedRecord ? buildFilterPairsForEdge(edge, selectedRecord) : null;
    const rawValue =
      edge.fieldPairs.length === 1 && selectedRecord
        ? selectedRecord[edge.fieldPairs[0]!.fromField]
        : pairs?.map((pair) => pair.value).join(', ');

    let matched: Record<string, unknown>[] | null = null;
    if (load?.status === 'ready' && pairs) {
      matched = filterRecordsByPairs(load.records, pairs);
    } else if (load?.status === 'ready' && !pairs && selectedRecord) {
      matched = [];
    }

    const state = classifyNeighborState({
      loading: loadingState,
      failed,
      upstreamEmpty,
      rawValue,
      matchedRecords: matched
    });

    const href =
      pairs && pairs.length > 0
        ? combatDataHref(edge.toResourceId, pairs)
        : combatDataHref(edge.toResourceId);

    return (
      <div key={key} className="combat-data-gux-neighbor">
        <div className="combat-data-gux-neighbor-head">
          <Typography.Text bold>{edge.label ? `${edge.label} → ${title}` : title}</Typography.Text>
          <NeighborStatusText state={state} />
        </div>
        {state.status === 'ready' && load?.status === 'ready'
          ? state.records.slice(0, 5).map((record, index) => {
              const label = resolveReferenceLabel(
                load.records,
                edge.fieldPairs[0]?.toField ?? config.pathKeys[0] ?? 'id',
                targetConfig?.fields.find((field) => field.name === 'displayName')?.name ??
                  targetConfig?.fields.find((field) => field.name === 'name')?.name,
                record[edge.fieldPairs[0]?.toField ?? '']
              );
              return (
                <div key={getRecordRowKey(record, targetConfig?.pathKeys ?? [], index)} className="combat-data-gux-neighbor-row">
                  <span>{label.primary}</span>
                  {label.secondary ? (
                    <Typography.Text type="secondary" className="combat-data-gux-secondary-id">
                      {label.secondary}
                    </Typography.Text>
                  ) : null}
                </div>
              );
            })
          : null}
        {state.status === 'empty-upstream' ? (
          <Space size={8}>
            <Button size="mini" type="text" href={combatDataHref(edge.toResourceId)}>
              打开上游
            </Button>
            <Button
              size="mini"
              type="text"
              onClick={() => {
                stashCreatePrefill(edge.toResourceId, {});
                window.location.hash = combatDataHref(edge.toResourceId);
              }}
            >
              创建上游
            </Button>
          </Space>
        ) : (
          <Button size="mini" type="text" href={href}>
            查看上游
          </Button>
        )}
      </div>
    );
  };

  const renderDownstreamEdge = (edge: RelationEdge) => {
    const childConfig = getCombatDataResource(edge.fromResourceId);
    const title = childConfig?.label ?? edge.fromResourceId;
    const key = edgeKey(edge);
    const expanded = expandedDownstreamKeys.includes(key);
    const load = downstreamLoads[key] ?? { status: 'idle' as const };

    let state: NeighborRelationState;
    if (!expanded) {
      state = { status: 'loading' };
    } else if (load.status === 'loading' || load.status === 'idle') {
      state = { status: 'loading' };
    } else if (load.status === 'failed') {
      state = { status: 'unknown' };
    } else {
      const pairs = selectedRecord ? buildDownstreamFilterPairs(edge, selectedRecord) : null;
      if (!pairs) {
        state = classifyNeighborState({
          failed: false,
          rawValue: '',
          matchedRecords: []
        });
      } else {
        state = classifyNeighborState({
          failed: false,
          matchedRecords: load.records
        });
      }
    }

    const filterPairsForChild =
      selectedRecord ? buildDownstreamFilterPairs(edge, selectedRecord) : null;

    return (
      <div key={key} className="combat-data-gux-neighbor">
        <div className="combat-data-gux-neighbor-head">
          <Typography.Text bold>{edge.label ? `${title} · ${edge.label}` : title}</Typography.Text>
          {expanded ? <NeighborStatusText state={state} /> : <span className="combat-data-gux-neighbor-status">未展开</span>}
        </div>
        <Space size={8} wrap>
          <Button
            size="mini"
            type="outline"
            onClick={() => {
              setExpandedDownstreamKeys((prev) =>
                prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
              );
            }}
          >
            {expanded ? '收起' : '展开并加载'}
          </Button>
          {filterPairsForChild ? (
            <Button size="mini" type="text" href={combatDataHref(edge.fromResourceId, filterPairsForChild)}>
              过滤查看
            </Button>
          ) : (
            <Button size="mini" type="text" href={combatDataHref(edge.fromResourceId)}>
              打开下游
            </Button>
          )}
          <Button
            size="mini"
            type="text"
            disabled={!selectedRecord || saveDisabled}
            onClick={() => {
              if (!selectedRecord) {
                return;
              }
              const prefill = buildCreateChildPrefill(edge, selectedRecord);
              if (!prefill) {
                Message.warning('无法从当前记录预填下游字段。');
                return;
              }
              stashCreatePrefill(edge.fromResourceId, prefill);
              window.location.hash = combatDataHref(edge.fromResourceId);
            }}
          >
            创建下游
          </Button>
        </Space>
        {expanded && load.status === 'ready' && state.status === 'ready'
          ? state.records.slice(0, 8).map((record, index) => {
              const label = recordPrimaryLabel(
                record,
                childConfig?.pathKeys ?? [],
                childConfig?.fields ?? []
              );
              return (
                <div
                  key={getRecordRowKey(record, childConfig?.pathKeys ?? [], index)}
                  className="combat-data-gux-neighbor-row"
                >
                  <span>{label.primary}</span>
                  {label.secondary ? (
                    <Typography.Text type="secondary" className="combat-data-gux-secondary-id">
                      {label.secondary}
                    </Typography.Text>
                  ) : null}
                </div>
              );
            })
          : null}
        {expanded && load.status === 'failed' ? (
          <Typography.Text type="secondary">关系未知：{load.message}</Typography.Text>
        ) : null}
      </div>
    );
  };

  const guidedWorkspace = (
    <div className="combat-data-gux">
      <div className="combat-data-gux-toolbar">
        <Input.Search
          allowClear
          placeholder="本地搜索当前列表…"
          value={searchQuery}
          onChange={setSearchQuery}
          style={{ maxWidth: 320 }}
        />
        <Typography.Text type="secondary" role="status" aria-live="polite">
          可见 {filteredRecords.length} / 全部 {records.length}
          {filterPairs.length > 0 ? ` · 过滤 ${filterPairs.length} 组` : ''}
        </Typography.Text>
      </div>

      <div className="combat-data-gux-layout">
        <div
          className="combat-data-gux-record-list"
          aria-label={`${config.label} 记录`}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              selectRecordByOffset(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              selectRecordByOffset(-1);
            } else if (event.key === 'Enter' && selectedRecord) {
              event.preventDefault();
              openEdit(selectedRecord);
            }
          }}
        >
          {loading ? (
            <div className="combat-data-gux-skeleton" aria-busy="true" role="status">
              加载记录中…
            </div>
          ) : filteredRecords.length === 0 ? (
            <EmptyState
              title={`暂无${config.label}`}
              description={
                filterPairs.length > 0
                  ? '当前过滤条件下无匹配记录。'
                  : '列表为空时可直接新增；公开 GET 无数据时不会崩溃。'
              }
            />
          ) : (
            filteredRecords.map((record, index) => {
              const rowKey = getRecordRowKey(record, config.pathKeys, index);
              const selected = rowKey === selectedRowKey;
              const label = recordPrimaryLabel(record, config.pathKeys, config.fields);
              const imageUri =
                typeof record.imageUri === 'string' && record.imageUri.trim() !== ''
                  ? record.imageUri
                  : null;
              const showImageThumb = config.fields.some((field) => field.kind === 'image-reference');
              const refSnippets = (config.references ?? []).slice(0, 2).map((reference) => {
                const load = referenceLoads[reference.resourceId];
                const resolved = resolveReferenceLabel(
                  load?.status === 'ready' ? load.records : undefined,
                  reference.valueKey,
                  reference.labelKey,
                  record[reference.field]
                );
                return (
                  <span key={reference.field} className="combat-data-gux-ref-chip">
                    <span>{reference.field}: {resolved.primary}</span>
                    {resolved.secondary && resolved.secondary !== resolved.primary ? (
                      <Typography.Text type="secondary" className="combat-data-gux-secondary-id">
                        {resolved.secondary}
                      </Typography.Text>
                    ) : null}
                  </span>
                );
              });

              return (
                <div
                  key={rowKey}
                  className={`combat-data-gux-record${selected ? ' is-selected' : ''}`}
                >
                  <button
                    type="button"
                    className="combat-data-gux-record-select"
                    aria-pressed={selected}
                    onClick={() => setSelectedRowKey(rowKey)}
                    onDoubleClick={() => openEdit(record)}
                  >
                    {showImageThumb ? (
                      <span className="combat-data-gux-record-thumb">
                        <CombatDataImageReferencePreview
                          gameId={selectedGameId}
                          imageUri={imageUri}
                          size={28}
                          emptyLabel=""
                        />
                      </span>
                    ) : null}
                    <span className="combat-data-gux-record-primary">{label.primary}</span>
                    {label.secondary ? (
                      <Typography.Text type="secondary" className="combat-data-gux-secondary-id">
                        {label.secondary}
                      </Typography.Text>
                    ) : null}
                    {imageUri && showImageThumb ? (
                      <Typography.Text type="secondary" className="combat-data-gux-secondary-id">
                        {imageUri}
                      </Typography.Text>
                    ) : null}
                    {refSnippets.length > 0 ? (
                      <div className="combat-data-gux-record-refs">{refSnippets}</div>
                    ) : null}
                  </button>
                  <div className="combat-data-gux-record-actions">
                    <Button size="mini" onClick={() => openView(record)}>
                      查看
                    </Button>
                    <Button
                      size="mini"
                      type="primary"
                      disabled={saveDisabled}
                      onClick={() => openEdit(record)}
                    >
                      编辑
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="combat-data-gux-context" aria-label="关系上下文">
          {!selectedRecord ? (
            <div className="combat-data-gux-context-empty" role="status">
              选择左侧记录以查看「依赖于」与「被引用于」。
            </div>
          ) : (
            <>
              <nav className="combat-data-gux-context-panel" aria-label="依赖于">
                <Typography.Title heading={6} className="combat-data-gux-context-title">
                  依赖于
                </Typography.Title>
                {upstreamEdges.length === 0 ? (
                  <Typography.Text type="secondary">无声明的上游依赖。</Typography.Text>
                ) : (
                  upstreamEdges.map((edge) => renderUpstreamEdge(edge))
                )}
              </nav>
              <nav className="combat-data-gux-context-panel" aria-label="被引用于">
                <Typography.Title heading={6} className="combat-data-gux-context-title">
                  被引用于
                </Typography.Title>
                {downstreamEdges.length === 0 ? (
                  <Typography.Text type="secondary">无声明的下游引用。</Typography.Text>
                ) : (
                  downstreamEdges.map((edge) => renderDownstreamEdge(edge))
                )}
              </nav>
            </>
          )}
        </div>
      </div>
    </div>
  );

  const successActions = successPanel ? (
    <div className="combat-data-gux-success" role="status" aria-live="polite">
      <Typography.Text>
        已保存 <strong>{successPanel.savedLabel}</strong> · currentRevision=
        {successPanel.currentRevision}
      </Typography.Text>
      {successPanel.readbackMissing ? (
        <Alert
          type="warning"
          content="保存后未能在列表中回读到该记录；创建下游等后续操作已禁用，请刷新后手动定位。"
          className="resource-warning-alert"
        />
      ) : null}
      <Space wrap size={8}>
        <Button
          size="small"
          onClick={() => {
            setSuccessPanel(null);
          }}
        >
          留在此处
        </Button>
        <Button
          size="small"
          type="primary"
          disabled={saveDisabled}
          onClick={() => openCreate()}
        >
          继续新增同类
        </Button>
        {downstreamEdges.slice(0, 4).map((edge) => {
          const child = getCombatDataResource(edge.fromResourceId);
          const canCreateDownstream = !!savedReceiptRecord && !successPanel.readbackMissing;
          return (
            <Button
              key={edgeKey(edge)}
              size="small"
              disabled={!canCreateDownstream || saveDisabled}
              onClick={() => {
                if (!savedReceiptRecord) {
                  Message.warning('未能定位刚保存的记录，无法创建下游。');
                  return;
                }
                const prefill = buildCreateChildPrefill(edge, savedReceiptRecord);
                if (!prefill) {
                  Message.warning('无法预填下游字段。');
                  return;
                }
                stashCreatePrefill(edge.fromResourceId, prefill);
                window.location.hash = combatDataHref(edge.fromResourceId);
              }}
            >
              创建下游：{child?.label ?? edge.fromResourceId}
            </Button>
          );
        })}
        <Button
          size="small"
          type="text"
          onClick={() => {
            const listEl = document.querySelector('.combat-data-gux-context');
            listEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }}
        >
          查看引用关系
        </Button>
      </Space>
    </div>
  ) : null;

  return (
    <div className="page-admin-resource page-stack combat-data-gux-page">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}
      {error ? <Alert type="error" content={error} className="resource-warning-alert" /> : null}
      {referenceWarning ? (
        <Alert
          type="warning"
          content={`跨资源引用辅助加载失败（不影响主列表与保存，失败字段回退为原文本输入）：${referenceWarning}`}
          className="resource-warning-alert"
        />
      ) : null}
      {effectAssistWarning ? (
        <Alert
          type="warning"
          content={`效果步骤辅助目录部分失败（失败项回退为原输入）：${effectAssistWarning}`}
          className="resource-warning-alert"
        />
      ) : null}

      {successActions}

      {hideHeaderSummary ? (
        <Panel title="资源列表" kicker="Public GET / Admin PUT" actions={listActions}>
          {listRevision !== undefined ? (
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              列表 envelope currentRevision={listRevision}
            </Typography.Text>
          ) : null}
          {workspaceMode === 'guided' ? guidedWorkspace : table}
        </Panel>
      ) : (
        <Panel title={config.label} kicker="Combat Data" actions={listActions}>
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            {config.summary}
            {listRevision !== undefined ? ` · 列表 envelope currentRevision=${listRevision}` : null}
          </Typography.Paragraph>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
            后端基础约束（结构/非空） vs 当前 Wasm 能力校验（组装时）
          </Typography.Text>
          {workspaceMode === 'guided' ? guidedWorkspace : table}
        </Panel>
      )}

      <Modal
        title={
          modalMode === 'create'
            ? `新增 ${config.label}`
            : modalMode === 'edit'
              ? `编辑 ${config.label}`
              : `查看 ${config.label}`
        }
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={
          <Space>
            <Button onClick={() => setModalVisible(false)}>{readOnly ? '关闭' : '取消'}</Button>
            {!readOnly ? (
              <Button type="primary" loading={saving} disabled={saveDisabled} onClick={() => void submitModal()}>
                保存
              </Button>
            ) : null}
          </Space>
        }
        autoFocus={false}
        focusLock
        className="combat-data-gux-modal"
        style={{ width: '90vw', maxWidth: 880 }}
      >
        <div className="combat-data-gux-modal-body">
          {isEffectStep ? (
            <EffectStepEditor
              value={effectState}
              readOnly={readOnly}
              lockPathKeys={lockPathKeys}
              onChange={setEffectState}
              sequenceOptions={workspaceMode === 'guided' ? sequenceOptions : undefined}
              semanticTypeOptions={workspaceMode === 'guided' ? semanticTypeOptions : undefined}
              providerFormulaRecords={workspaceMode === 'guided' ? providerFormulaRecords : undefined}
            />
          ) : (
            <Form layout="vertical">
              {config.fields.map((field) => {
                const locked = lockPathKeys && (field.lockedOnEdit || config.pathKeys.includes(field.name));
                const fieldValue =
                  form[field.name] ??
                  (field.kind === 'boolean'
                    ? false
                    : field.kind === 'image-reference'
                      ? encodeImageReferenceFormValue(createUntouchedImageReference(null))
                      : '');
                const reference = referenceByField.get(field.name);
                const referenceOptions =
                  field.kind === 'image-reference'
                    ? undefined
                    : resolveFieldReferenceOptions(field, fieldValue);
                const targetLoad = reference ? referenceLoads[reference.resourceId] : undefined;
                const emptyUpstream =
                  reference &&
                  targetLoad?.status === 'ready' &&
                  targetLoad.records.length === 0 &&
                  !referenceOptions;

                return (
                  <Form.Item
                    key={field.name}
                    label={field.label}
                    required={field.required}
                    validateStatus={fieldErrors[field.name] ? 'error' : undefined}
                    help={fieldErrors[field.name]}
                    extra={
                      emptyUpstream ? (
                        <span>
                          上游为空。
                          <a href={combatDataHref(reference!.resourceId)}>打开上游</a>
                          {' · '}
                          <a
                            href={combatDataHref(reference!.resourceId)}
                            onClick={() => stashCreatePrefill(reference!.resourceId, {})}
                          >
                            创建上游
                          </a>
                        </span>
                      ) : (
                        field.helper
                      )
                    }
                  >
                    <div data-combat-field={field.name}>
                      <ResourceFieldInput
                        field={field}
                        value={fieldValue}
                        disabled={readOnly || locked}
                        inputId={combatDataFieldDomId(field.name)}
                        referenceOptions={referenceOptions}
                        apiBaseUrl={apiBaseUrl}
                        gameId={selectedGameId}
                        adminToken={adminToken}
                        fieldError={fieldErrors[field.name] ?? null}
                        onChange={(next) =>
                          setForm((prev) => {
                            const updated: ResourceFormValues = { ...prev, [field.name]: next };
                            setFieldErrors((errors) => {
                              if (!errors[field.name]) {
                                return errors;
                              }
                              const { [field.name]: _removed, ...rest } = errors;
                              return rest;
                            });
                            if (modalMode === 'create') {
                              for (const clearField of listDependentFieldsToClear(
                                config.dependentReferences,
                                field.name,
                                prev[field.name],
                                next
                              )) {
                                updated[clearField] = '';
                              }
                            }
                            for (const clearField of listScopedReferenceFieldsToClear(
                              resolveActiveReferences(config, prev),
                              field.name,
                              prev[field.name],
                              next
                            )) {
                              updated[clearField] = '';
                            }
                            return updated;
                          })
                        }
                      />
                    </div>
                  </Form.Item>
                );
              })}
            </Form>
          )}
        </div>
      </Modal>
    </div>
  );
}
