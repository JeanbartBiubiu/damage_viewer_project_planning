import {
  Alert,
  Button,
  Form,
  Input,
  Message,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography
} from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { Panel } from '../../../../components/Panel';
import {
  getControlStateProfiles,
  getErrorMessage,
  getStatusAttributeModifiers,
  getStatusDefinitions,
  getStatusModifierGroups,
  getStatusPeriodicHpEffects,
  putControlStateProfile,
  putStatusAttributeModifier,
  putStatusDefinition,
  putStatusModifierGroup,
  putStatusPeriodicHpEffect
} from '../../../../services/apiClient';
import type {
  ControlStateProfile,
  JsonObject,
  LoadState,
  StatusAttributeModifier,
  StatusDefinition,
  StatusModifierGroup,
  StatusPeriodicHpEffect
} from '../../../../types/api';
import { parseJsonObjectText, stringifyJson } from '../shared/json';

type StatusManagementPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

type StatusResourceId =
  | 'statusDefinitions'
  | 'controlStateProfiles'
  | 'statusModifierGroups'
  | 'statusAttributeModifiers'
  | 'statusPeriodicHpEffects';

type ModalMode = 'create' | 'view' | 'edit';

type StatusSnapshot = {
  statusDefinitions: StatusDefinition[];
  controlStateProfiles: ControlStateProfile[];
  statusModifierGroups: StatusModifierGroup[];
  statusAttributeModifiers: StatusAttributeModifier[];
  statusPeriodicHpEffects: StatusPeriodicHpEffect[];
};

type StatusDefinitionFormData = {
  statusId: string;
  name: string;
  description: string;
  statusKind: string;
  statusTypeId: string;
  controlProfileId: string;
  stackGroupKey: string;
  sourceScope: string;
  stackMode: string;
  maxStacks: string;
  maxInstances: string;
  durationMode: string;
  durationMs: string;
  durationFormulaId: string;
  defaultMagnitudeFormulaId: string;
  snapshotPolicy: string;
  isDispellable: boolean;
  cleansePriority: string;
  extendText: string;
};

type ControlStateProfileFormData = {
  controlProfileId: string;
  name: string;
  description: string;
  controlKind: string;
  movementLockMode: string;
  castLockMode: string;
  attackLockMode: string;
  inputOverrideMode: string;
  displacementKind: string;
  blocksControlInput: boolean;
  grantsUnstoppable: boolean;
  breaksOnDamage: boolean;
  tenacityReducible: boolean;
  priority: string;
  extendText: string;
};

type StatusModifierGroupFormData = {
  statusId: string;
  groupKey: string;
  groupName: string;
  phaseKey: string;
  snapshotPolicy: string;
  intervalMs: string;
  maxTicks: string;
  priority: string;
  extendText: string;
};

type StatusAttributeModifierFormData = {
  statusId: string;
  groupKey: string;
  modifierId: string;
  attrKey: string;
  modifierMode: string;
  value: string;
  formulaId: string;
  bucketKey: string;
  perStack: boolean;
  priority: string;
  extendText: string;
};

type StatusPeriodicHpEffectFormData = {
  statusId: string;
  groupKey: string;
  effectId: string;
  effectKind: string;
  tickFormulaId: string;
  damageType: string;
  canCrit: boolean;
  critChanceSource: 'none' | 'attacker_crit_chance' | 'fixed';
  critChance: string;
  critMultiplier: string;
  affectedByHealModifier: boolean;
  perStack: boolean;
  extendText: string;
};

type StatusModalState =
  | { resourceId: 'statusDefinitions'; mode: ModalMode; formData: StatusDefinitionFormData }
  | { resourceId: 'controlStateProfiles'; mode: ModalMode; formData: ControlStateProfileFormData }
  | { resourceId: 'statusModifierGroups'; mode: ModalMode; formData: StatusModifierGroupFormData }
  | { resourceId: 'statusAttributeModifiers'; mode: ModalMode; formData: StatusAttributeModifierFormData }
  | { resourceId: 'statusPeriodicHpEffects'; mode: ModalMode; formData: StatusPeriodicHpEffectFormData };

const EMPTY_STATUS_SNAPSHOT: StatusSnapshot = {
  statusDefinitions: [],
  controlStateProfiles: [],
  statusModifierGroups: [],
  statusAttributeModifiers: [],
  statusPeriodicHpEffects: []
};

const RESOURCE_LABELS: Record<StatusResourceId, string> = {
  statusDefinitions: '状态定义',
  controlStateProfiles: '控制语义',
  statusModifierGroups: '效果组',
  statusAttributeModifiers: '属性修饰',
  statusPeriodicHpEffects: '周期生命效果'
};

const RESOURCE_ORDER: StatusResourceId[] = [
  'statusDefinitions',
  'controlStateProfiles',
  'statusModifierGroups',
  'statusAttributeModifiers',
  'statusPeriodicHpEffects'
];

const STATUS_KIND_OPTIONS = toOptions(['buff', 'debuff', 'control', 'dot', 'hot', 'shield', 'special']);
const STATUS_SOURCE_SCOPE_OPTIONS = toOptions(['any_source', 'same_source', 'same_target_source']);
const STATUS_STACK_MODE_OPTIONS = toOptions([
  'refresh',
  'replace',
  'stack',
  'independent',
  'take_max_duration',
  'take_max_magnitude'
]);
const STATUS_DURATION_MODE_OPTIONS = toOptions(['timed', 'permanent']);
const STATUS_SNAPSHOT_POLICY_OPTIONS = toOptions(['on_apply', 'dynamic']);
const STATUS_GROUP_PHASE_OPTIONS = toOptions(['while_active', 'on_apply', 'on_expire', 'on_interval']);
const STATUS_GROUP_SNAPSHOT_POLICY_OPTIONS = toOptions(['on_apply', 'dynamic', 'per_tick']);
const STATUS_MODIFIER_MODE_OPTIONS = toOptions(['flat', 'percent', 'bucket_add', 'bucket_mul', 'set_final']);
const PERIODIC_EFFECT_KIND_OPTIONS = toOptions(['damage', 'heal']);
const DAMAGE_TYPE_OPTIONS = toOptions(['physical', 'magic', 'true']);
const CRIT_CHANCE_SOURCE_OPTIONS = toOptions(['none', 'attacker_crit_chance', 'fixed']);
const CONTROL_KIND_OPTIONS = toOptions([
  'stun',
  'root',
  'silence',
  'disarm',
  'taunt',
  'fear',
  'charm',
  'airborne',
  'grounded',
  'knockback',
  'pull',
  'suppress',
  'special'
]);
const MOVEMENT_LOCK_MODE_OPTIONS = toOptions(['none', 'forbid_move', 'force_move', 'forbid_turn']);
const CAST_LOCK_MODE_OPTIONS = toOptions(['none', 'forbid_cast', 'interrupt_cast', 'forbid_channel', 'interrupt_and_forbid']);
const ATTACK_LOCK_MODE_OPTIONS = toOptions(['none', 'forbid_attack', 'interrupt_attack', 'interrupt_and_forbid']);
const INPUT_OVERRIDE_MODE_OPTIONS = toOptions([
  'none',
  'force_to_source',
  'force_from_source',
  'force_to_target',
  'force_along_path',
  'force_stop'
]);
const DISPLACEMENT_KIND_OPTIONS = toOptions(['none', 'knockup', 'knockback', 'pull', 'forced_dash']);

function toOptions(values: string[]) {
  return values.map((value) => ({ label: value, value }));
}

function createStatusDefinitionFormData(statusId = ''): StatusDefinitionFormData {
  return {
    statusId,
    name: '',
    description: '',
    statusKind: 'buff',
    statusTypeId: '',
    controlProfileId: '',
    stackGroupKey: statusId,
    sourceScope: 'any_source',
    stackMode: 'refresh',
    maxStacks: '1',
    maxInstances: '',
    durationMode: 'timed',
    durationMs: '',
    durationFormulaId: '',
    defaultMagnitudeFormulaId: '',
    snapshotPolicy: 'on_apply',
    isDispellable: true,
    cleansePriority: '0',
    extendText: stringifyJson({})
  };
}

function createControlStateProfileFormData(): ControlStateProfileFormData {
  return {
    controlProfileId: '',
    name: '',
    description: '',
    controlKind: 'stun',
    movementLockMode: 'none',
    castLockMode: 'none',
    attackLockMode: 'none',
    inputOverrideMode: 'none',
    displacementKind: 'none',
    blocksControlInput: false,
    grantsUnstoppable: false,
    breaksOnDamage: false,
    tenacityReducible: true,
    priority: '0',
    extendText: stringifyJson({})
  };
}

function createStatusModifierGroupFormData(statusId = ''): StatusModifierGroupFormData {
  return {
    statusId,
    groupKey: '',
    groupName: '',
    phaseKey: 'while_active',
    snapshotPolicy: 'on_apply',
    intervalMs: '',
    maxTicks: '',
    priority: '0',
    extendText: stringifyJson({})
  };
}

function createStatusAttributeModifierFormData(statusId = '', groupKey = ''): StatusAttributeModifierFormData {
  return {
    statusId,
    groupKey,
    modifierId: '',
    attrKey: '',
    modifierMode: 'flat',
    value: '',
    formulaId: '',
    bucketKey: '',
    perStack: false,
    priority: '0',
    extendText: stringifyJson({})
  };
}

function createStatusPeriodicHpEffectFormData(statusId = '', groupKey = ''): StatusPeriodicHpEffectFormData {
  return {
    statusId,
    groupKey,
    effectId: '',
    effectKind: 'damage',
    tickFormulaId: '',
    damageType: 'physical',
    canCrit: false,
    critChanceSource: 'none',
    critChance: '',
    critMultiplier: '',
    affectedByHealModifier: true,
    perStack: false,
    extendText: stringifyJson({})
  };
}

function toStatusDefinitionFormData(record: StatusDefinition): StatusDefinitionFormData {
  return {
    statusId: record.statusId,
    name: record.name ?? '',
    description: record.description ?? '',
    statusKind: record.statusKind ?? 'buff',
    statusTypeId: record.statusTypeId !== undefined ? String(record.statusTypeId) : '',
    controlProfileId: record.controlProfileId ?? '',
    stackGroupKey: record.stackGroupKey ?? '',
    sourceScope: record.sourceScope ?? 'any_source',
    stackMode: record.stackMode ?? 'refresh',
    maxStacks: record.maxStacks !== undefined ? String(record.maxStacks) : '1',
    maxInstances: record.maxInstances !== undefined ? String(record.maxInstances) : '',
    durationMode: record.durationMode ?? 'timed',
    durationMs: record.durationMs !== undefined ? String(record.durationMs) : '',
    durationFormulaId: record.durationFormulaId ?? '',
    defaultMagnitudeFormulaId: record.defaultMagnitudeFormulaId ?? '',
    snapshotPolicy: record.snapshotPolicy ?? 'on_apply',
    isDispellable: record.isDispellable ?? true,
    cleansePriority: record.cleansePriority !== undefined ? String(record.cleansePriority) : '0',
    extendText: stringifyJson(record.extend ?? {})
  };
}

function toControlStateProfileFormData(record: ControlStateProfile): ControlStateProfileFormData {
  return {
    controlProfileId: record.controlProfileId,
    name: record.name ?? '',
    description: record.description ?? '',
    controlKind: record.controlKind ?? 'stun',
    movementLockMode: record.movementLockMode ?? 'none',
    castLockMode: record.castLockMode ?? 'none',
    attackLockMode: record.attackLockMode ?? 'none',
    inputOverrideMode: record.inputOverrideMode ?? 'none',
    displacementKind: record.displacementKind ?? 'none',
    blocksControlInput: record.blocksControlInput ?? false,
    grantsUnstoppable: record.grantsUnstoppable ?? false,
    breaksOnDamage: record.breaksOnDamage ?? false,
    tenacityReducible: record.tenacityReducible ?? true,
    priority: record.priority !== undefined ? String(record.priority) : '0',
    extendText: stringifyJson(record.extend ?? {})
  };
}

function toStatusModifierGroupFormData(record: StatusModifierGroup): StatusModifierGroupFormData {
  return {
    statusId: record.statusId,
    groupKey: record.groupKey,
    groupName: record.groupName ?? '',
    phaseKey: record.phaseKey ?? 'while_active',
    snapshotPolicy: record.snapshotPolicy ?? 'on_apply',
    intervalMs: record.intervalMs !== undefined ? String(record.intervalMs) : '',
    maxTicks: record.maxTicks !== undefined ? String(record.maxTicks) : '',
    priority: record.priority !== undefined ? String(record.priority) : '0',
    extendText: stringifyJson(record.extend ?? {})
  };
}

function toStatusAttributeModifierFormData(record: StatusAttributeModifier): StatusAttributeModifierFormData {
  return {
    statusId: record.statusId,
    groupKey: record.groupKey,
    modifierId: record.modifierId,
    attrKey: record.attrKey ?? '',
    modifierMode: record.modifierMode ?? 'flat',
    value: record.value !== undefined ? String(record.value) : '',
    formulaId: record.formulaId ?? '',
    bucketKey: record.bucketKey ?? '',
    perStack: record.perStack ?? false,
    priority: record.priority !== undefined ? String(record.priority) : '0',
    extendText: stringifyJson(record.extend ?? {})
  };
}

function toStatusPeriodicHpEffectFormData(record: StatusPeriodicHpEffect): StatusPeriodicHpEffectFormData {
  return {
    statusId: record.statusId,
    groupKey: record.groupKey,
    effectId: record.effectId,
    effectKind: record.effectKind ?? 'damage',
    tickFormulaId: record.tickFormulaId ?? '',
    damageType: record.damageType ?? 'physical',
    canCrit: record.canCrit ?? false,
    critChanceSource: record.critChanceSource ?? (record.canCrit ? 'attacker_crit_chance' : 'none'),
    critChance: record.critChance !== undefined ? String(record.critChance) : '',
    critMultiplier: record.critMultiplier !== undefined ? String(record.critMultiplier) : '',
    affectedByHealModifier: record.affectedByHealModifier ?? true,
    perStack: record.perStack ?? false,
    extendText: stringifyJson(record.extend ?? {})
  };
}

function recordContains(record: unknown, searchText: string): boolean {
  const normalizedSearch = searchText.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }
  return JSON.stringify(record).toLowerCase().includes(normalizedSearch);
}

function putText(payload: JsonObject, field: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) {
    payload[field] = trimmed;
  }
}

function putNumber(payload: JsonObject, field: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) {
    payload[field] = Number(trimmed);
  }
}

function putExtend(payload: JsonObject, text: string) {
  const extend = parseJsonObjectText(text, 'extend');
  if (Object.keys(extend).length > 0) {
    payload.extend = extend;
  }
}

function statusModifierGroupKey(record: Pick<StatusModifierGroup, 'statusId' | 'groupKey'>): string {
  return `${record.statusId}|${record.groupKey}`;
}

function statusAttributeModifierKey(record: Pick<StatusAttributeModifier, 'statusId' | 'groupKey' | 'modifierId'>): string {
  return `${record.statusId}|${record.groupKey}|${record.modifierId}`;
}

function statusPeriodicHpEffectKey(record: Pick<StatusPeriodicHpEffect, 'statusId' | 'groupKey' | 'effectId'>): string {
  return `${record.statusId}|${record.groupKey}|${record.effectId}`;
}

function formatStatusPeriodicHpEffectCrit(record: StatusPeriodicHpEffect): string {
  if (!record.canCrit) {
    return 'disabled';
  }
  const source = record.critChanceSource ?? 'attacker_crit_chance';
  const chance = source === 'fixed' && record.critChance !== undefined ? ` / ${record.critChance}` : '';
  const multiplier = record.critMultiplier !== undefined ? ` / x${record.critMultiplier}` : '';
  return `${source}${chance}${multiplier}`;
}

function buildStatusDefinitionPayload(formData: StatusDefinitionFormData): JsonObject {
  const payload: JsonObject = {
    statusId: formData.statusId.trim(),
    name: formData.name.trim(),
    statusKind: formData.statusKind,
    stackGroupKey: formData.stackGroupKey.trim(),
    sourceScope: formData.sourceScope,
    stackMode: formData.stackMode,
    maxStacks: Number(formData.maxStacks || 1),
    durationMode: formData.durationMode,
    snapshotPolicy: formData.snapshotPolicy,
    isDispellable: formData.isDispellable,
    cleansePriority: Number(formData.cleansePriority || 0)
  };

  putText(payload, 'description', formData.description);
  putNumber(payload, 'statusTypeId', formData.statusTypeId);
  putText(payload, 'controlProfileId', formData.controlProfileId);
  putNumber(payload, 'maxInstances', formData.maxInstances);
  if (formData.durationMode === 'timed') {
    putNumber(payload, 'durationMs', formData.durationMs);
    putText(payload, 'durationFormulaId', formData.durationFormulaId);
  }
  putText(payload, 'defaultMagnitudeFormulaId', formData.defaultMagnitudeFormulaId);
  putExtend(payload, formData.extendText);
  return payload;
}

function buildControlStateProfilePayload(formData: ControlStateProfileFormData): JsonObject {
  const payload: JsonObject = {
    controlProfileId: formData.controlProfileId.trim(),
    name: formData.name.trim(),
    controlKind: formData.controlKind,
    movementLockMode: formData.movementLockMode,
    castLockMode: formData.castLockMode,
    attackLockMode: formData.attackLockMode,
    inputOverrideMode: formData.inputOverrideMode,
    displacementKind: formData.displacementKind,
    blocksControlInput: formData.blocksControlInput,
    grantsUnstoppable: formData.grantsUnstoppable,
    breaksOnDamage: formData.breaksOnDamage,
    tenacityReducible: formData.tenacityReducible,
    priority: Number(formData.priority || 0)
  };

  putText(payload, 'description', formData.description);
  putExtend(payload, formData.extendText);
  return payload;
}

function buildStatusModifierGroupPayload(formData: StatusModifierGroupFormData): JsonObject {
  const payload: JsonObject = {
    statusId: formData.statusId.trim(),
    groupKey: formData.groupKey.trim(),
    phaseKey: formData.phaseKey,
    snapshotPolicy: formData.snapshotPolicy,
    priority: Number(formData.priority || 0)
  };

  putText(payload, 'groupName', formData.groupName);
  if (formData.phaseKey === 'on_interval') {
    putNumber(payload, 'intervalMs', formData.intervalMs);
    putNumber(payload, 'maxTicks', formData.maxTicks);
  }
  putExtend(payload, formData.extendText);
  return payload;
}

function buildStatusAttributeModifierPayload(formData: StatusAttributeModifierFormData): JsonObject {
  const payload: JsonObject = {
    statusId: formData.statusId.trim(),
    groupKey: formData.groupKey.trim(),
    modifierId: formData.modifierId.trim(),
    attrKey: formData.attrKey.trim(),
    modifierMode: formData.modifierMode,
    perStack: formData.perStack,
    priority: Number(formData.priority || 0)
  };

  putNumber(payload, 'value', formData.value);
  putText(payload, 'formulaId', formData.formulaId);
  putText(payload, 'bucketKey', formData.bucketKey);
  putExtend(payload, formData.extendText);
  return payload;
}

function buildStatusPeriodicHpEffectPayload(formData: StatusPeriodicHpEffectFormData): JsonObject {
  const payload: JsonObject = {
    statusId: formData.statusId.trim(),
    groupKey: formData.groupKey.trim(),
    effectId: formData.effectId.trim(),
    effectKind: formData.effectKind,
    tickFormulaId: formData.tickFormulaId.trim(),
    canCrit: formData.canCrit,
    perStack: formData.perStack
  };

  if (formData.effectKind === 'damage') {
    payload.damageType = formData.damageType;
  } else {
    payload.affectedByHealModifier = formData.affectedByHealModifier;
  }
  if (!formData.canCrit) {
    payload.critChanceSource = 'none';
  } else {
    if (formData.critChanceSource === 'none') {
      throw new Error('canCrit=true 时必须选择 critChanceSource。');
    }
    payload.critChanceSource = formData.critChanceSource;
    if (formData.critChanceSource === 'fixed') {
      const critChance = Number(formData.critChance);
      if (!Number.isFinite(critChance) || critChance < 0 || critChance > 1) {
        throw new Error('critChanceSource=fixed 时，critChance 必须是 0 到 1 之间的数字。');
      }
      payload.critChance = critChance;
    }
    const critMultiplier = Number(formData.critMultiplier);
    if (!Number.isFinite(critMultiplier) || critMultiplier <= 0) {
      throw new Error('canCrit=true 时，critMultiplier 必须大于 0。');
    }
    payload.critMultiplier = critMultiplier;
  }
  putExtend(payload, formData.extendText);
  return payload;
}

export function StatusManagementPage({ apiBaseUrl, selectedGameId, adminToken }: StatusManagementPageProps) {
  const token = adminToken.trim();
  const actionsDisabled = !selectedGameId || !token;
  const blockerMessage = !selectedGameId
    ? '请先选择当前 gameId。'
    : !token
      ? '请先在顶部会话区域填写 Admin Token。'
      : null;

  const [snapshot, setSnapshot] = useState<StatusSnapshot>(EMPTY_STATUS_SNAPSHOT);
  const [recordsState, setRecordsState] = useState<LoadState>('idle');
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [activeResource, setActiveResource] = useState<StatusResourceId>('statusDefinitions');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');
  const [modal, setModal] = useState<StatusModalState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedGameId || !token) {
      setSnapshot(EMPTY_STATUS_SNAPSHOT);
      setRecordsState('idle');
      setRecordsError(null);
      return;
    }

    let cancelled = false;
    const gameId = selectedGameId;
    setRecordsState('loading');
    setRecordsError(null);

    Promise.all([
      getStatusDefinitions(apiBaseUrl, gameId, token),
      getControlStateProfiles(apiBaseUrl, gameId, token),
      getStatusModifierGroups(apiBaseUrl, gameId, token),
      getStatusAttributeModifiers(apiBaseUrl, gameId, token),
      getStatusPeriodicHpEffects(apiBaseUrl, gameId, token)
    ])
      .then(([definitions, controlProfiles, groups, attributeModifiers, periodicHpEffects]) => {
        if (cancelled) {
          return;
        }
        setSnapshot({
          statusDefinitions: definitions.data.statusDefinitions,
          controlStateProfiles: controlProfiles.data.controlStateProfiles,
          statusModifierGroups: groups.data.statusModifierGroups,
          statusAttributeModifiers: attributeModifiers.data.statusAttributeModifiers,
          statusPeriodicHpEffects: periodicHpEffects.data.statusPeriodicHpEffects
        });
        setRecordsState('success');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setSnapshot(EMPTY_STATUS_SNAPSHOT);
        setRecordsState('error');
        setRecordsError(getErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, refreshSeed, selectedGameId, token]);

  const statusOptions = useMemo(
    () =>
      snapshot.statusDefinitions.map((status) => ({
        label: `${status.statusId}${status.name ? ` / ${status.name}` : ''}`,
        value: status.statusId
      })),
    [snapshot.statusDefinitions]
  );

  const groupOptions = useMemo(() => {
    const groups = statusFilter
      ? snapshot.statusModifierGroups.filter((group) => group.statusId === statusFilter)
      : snapshot.statusModifierGroups;
    return groups.map((group) => ({
      label: `${group.statusId} / ${group.groupKey}${group.groupName ? ` / ${group.groupName}` : ''}`,
      value: statusModifierGroupKey(group)
    }));
  }, [snapshot.statusModifierGroups, statusFilter]);

  const selectedStatus = useMemo(
    () => snapshot.statusDefinitions.find((status) => status.statusId === statusFilter),
    [snapshot.statusDefinitions, statusFilter]
  );

  function refreshAll() {
    setRefreshSeed((value) => value + 1);
  }

  function updateModalField(field: string, value: string | boolean) {
    setModal((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        formData: {
          ...current.formData,
          [field]: value
        }
      } as StatusModalState;
    });
  }

  function openCreateModal(resourceId: StatusResourceId) {
    const selectedGroup = statusFilter
      ? snapshot.statusModifierGroups.find((group) => group.statusId === statusFilter)
      : snapshot.statusModifierGroups[0];

    if (resourceId === 'statusDefinitions') {
      setModal({ resourceId, mode: 'create', formData: createStatusDefinitionFormData(statusFilter ?? '') });
    } else if (resourceId === 'controlStateProfiles') {
      setModal({ resourceId, mode: 'create', formData: createControlStateProfileFormData() });
    } else if (resourceId === 'statusModifierGroups') {
      setModal({ resourceId, mode: 'create', formData: createStatusModifierGroupFormData(statusFilter ?? '') });
    } else if (resourceId === 'statusAttributeModifiers') {
      setModal({
        resourceId,
        mode: 'create',
        formData: createStatusAttributeModifierFormData(statusFilter ?? selectedGroup?.statusId ?? '', selectedGroup?.groupKey ?? '')
      });
    } else {
      setModal({
        resourceId,
        mode: 'create',
        formData: createStatusPeriodicHpEffectFormData(statusFilter ?? selectedGroup?.statusId ?? '', selectedGroup?.groupKey ?? '')
      });
    }
  }

  function openRecordModal(resourceId: StatusResourceId, mode: ModalMode, record: unknown) {
    if (resourceId === 'statusDefinitions') {
      setModal({ resourceId, mode, formData: toStatusDefinitionFormData(record as StatusDefinition) });
    } else if (resourceId === 'controlStateProfiles') {
      setModal({ resourceId, mode, formData: toControlStateProfileFormData(record as ControlStateProfile) });
    } else if (resourceId === 'statusModifierGroups') {
      setModal({ resourceId, mode, formData: toStatusModifierGroupFormData(record as StatusModifierGroup) });
    } else if (resourceId === 'statusAttributeModifiers') {
      setModal({ resourceId, mode, formData: toStatusAttributeModifierFormData(record as StatusAttributeModifier) });
    } else {
      setModal({ resourceId, mode, formData: toStatusPeriodicHpEffectFormData(record as StatusPeriodicHpEffect) });
    }
  }

  async function submitModal() {
    if (!modal || !selectedGameId || !token || modal.mode === 'view') {
      return;
    }

    setSaving(true);
    try {
      if (modal.resourceId === 'statusDefinitions') {
        const formData = modal.formData;
        await putStatusDefinition(apiBaseUrl, selectedGameId, formData.statusId.trim(), token, buildStatusDefinitionPayload(formData));
      } else if (modal.resourceId === 'controlStateProfiles') {
        const formData = modal.formData;
        await putControlStateProfile(
          apiBaseUrl,
          selectedGameId,
          formData.controlProfileId.trim(),
          token,
          buildControlStateProfilePayload(formData)
        );
      } else if (modal.resourceId === 'statusModifierGroups') {
        const formData = modal.formData;
        await putStatusModifierGroup(
          apiBaseUrl,
          selectedGameId,
          formData.statusId.trim(),
          formData.groupKey.trim(),
          token,
          buildStatusModifierGroupPayload(formData)
        );
      } else if (modal.resourceId === 'statusAttributeModifiers') {
        const formData = modal.formData;
        await putStatusAttributeModifier(
          apiBaseUrl,
          selectedGameId,
          formData.statusId.trim(),
          formData.groupKey.trim(),
          formData.modifierId.trim(),
          token,
          buildStatusAttributeModifierPayload(formData)
        );
      } else {
        const formData = modal.formData;
        await putStatusPeriodicHpEffect(
          apiBaseUrl,
          selectedGameId,
          formData.statusId.trim(),
          formData.groupKey.trim(),
          formData.effectId.trim(),
          token,
          buildStatusPeriodicHpEffectPayload(formData)
        );
      }

      Message.success(`${RESOURCE_LABELS[modal.resourceId]}保存成功`);
      setModal(null);
      refreshAll();
    } catch (error) {
      Message.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}

      <Panel title="状态管理" kicker="Status">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div className="crud-toolbar">
            <div className="crud-toolbar-copy">
              <Typography.Title heading={6} style={{ margin: 0 }}>
                统一状态资源工作台
              </Typography.Title>
              <Typography.Text type="secondary">
                写入仍调用拆分后的后端接口；页面按状态、控制语义、效果组和效果明细组合查看。
              </Typography.Text>
            </div>
            <Space>
              <Button onClick={refreshAll} disabled={actionsDisabled} loading={recordsState === 'loading'}>
                刷新
              </Button>
            </Space>
          </div>

          <Space wrap size={12}>
            {RESOURCE_ORDER.map((resourceId) => (
              <Tag key={resourceId} color={activeResource === resourceId ? 'arcoblue' : 'gray'}>
                {RESOURCE_LABELS[resourceId]} {snapshot[resourceId].length}
              </Tag>
            ))}
          </Space>

          <div className="crud-search-form">
            <Form.Item label="状态上下文">
              <Select
                allowClear
                showSearch
                value={statusFilter}
                disabled={actionsDisabled}
                options={statusOptions}
                placeholder="按 statusId 聚焦相关资源"
                onChange={(value) => setStatusFilter(value ? String(value) : undefined)}
                filterOption={(inputValue, option) => {
                  const optionData = option as { value?: unknown; label?: unknown } | undefined;
                  return `${String(optionData?.value ?? '')} ${String(optionData?.label ?? '')}`
                    .toLowerCase()
                    .includes(inputValue.trim().toLowerCase());
                }}
                style={{ width: 360 }}
              />
            </Form.Item>
            <Form.Item label="快速搜索">
              <Input
                value={searchText}
                onChange={setSearchText}
                placeholder="搜索当前 Tab 的任意字段"
                style={{ width: 320 }}
              />
            </Form.Item>
          </div>
        </Space>
      </Panel>

      <Panel title={RESOURCE_LABELS[activeResource]} kicker="Resources">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <Tabs activeTab={activeResource} onChange={(key) => setActiveResource(key as StatusResourceId)}>
          <Tabs.TabPane key="statusDefinitions" title="状态定义">
            {renderStatusDefinitionsTable(snapshot, statusFilter, searchText, recordsState, actionsDisabled, openCreateModal, openRecordModal)}
          </Tabs.TabPane>
          <Tabs.TabPane key="controlStateProfiles" title="控制语义">
            {renderControlStateProfilesTable(
              snapshot,
              selectedStatus,
              searchText,
              recordsState,
              actionsDisabled,
              openCreateModal,
              openRecordModal
            )}
          </Tabs.TabPane>
          <Tabs.TabPane key="statusModifierGroups" title="效果组">
            {renderStatusModifierGroupsTable(snapshot, statusFilter, searchText, recordsState, actionsDisabled, openCreateModal, openRecordModal)}
          </Tabs.TabPane>
          <Tabs.TabPane key="statusAttributeModifiers" title="属性修饰">
            {renderStatusAttributeModifiersTable(snapshot, statusFilter, searchText, recordsState, actionsDisabled, openCreateModal, openRecordModal)}
          </Tabs.TabPane>
          <Tabs.TabPane key="statusPeriodicHpEffects" title="周期生命效果">
            {renderStatusPeriodicHpEffectsTable(snapshot, statusFilter, searchText, recordsState, actionsDisabled, openCreateModal, openRecordModal)}
          </Tabs.TabPane>
        </Tabs>
      </Panel>

      <StatusResourceModal
        snapshot={snapshot}
        groupOptions={groupOptions}
        modal={modal}
        saving={saving}
        onClose={() => setModal(null)}
        onFieldChange={updateModalField}
        onSubmit={submitModal}
      />
    </div>
  );
}

function renderActions(resourceId: StatusResourceId, record: unknown, openRecordModal: (resourceId: StatusResourceId, mode: ModalMode, record: unknown) => void) {
  return (
    <Space>
      <Button size="mini" onClick={() => openRecordModal(resourceId, 'view', record)}>
        查看
      </Button>
      <Button type="primary" size="mini" onClick={() => openRecordModal(resourceId, 'edit', record)}>
        编辑
      </Button>
    </Space>
  );
}

function renderTableToolbar(resourceId: StatusResourceId, actionsDisabled: boolean, onCreate: (resourceId: StatusResourceId) => void) {
  return (
    <div className="crud-toolbar">
      <div className="crud-toolbar-copy">
        <Typography.Title heading={6} style={{ margin: 0 }}>
          {RESOURCE_LABELS[resourceId]}列表
        </Typography.Title>
        <Typography.Text type="secondary">当前接口不提供删除能力；保存会覆盖同主键资源。</Typography.Text>
      </div>
      <Button type="primary" disabled={actionsDisabled} onClick={() => onCreate(resourceId)}>
        新增
      </Button>
    </div>
  );
}

function renderStatusDefinitionsTable(
  snapshot: StatusSnapshot,
  statusFilter: string | undefined,
  searchText: string,
  recordsState: LoadState,
  actionsDisabled: boolean,
  onCreate: (resourceId: StatusResourceId) => void,
  openRecordModal: (resourceId: StatusResourceId, mode: ModalMode, record: unknown) => void
) {
  const records = snapshot.statusDefinitions.filter(
    (record) => (!statusFilter || record.statusId === statusFilter) && recordContains(record, searchText)
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {renderTableToolbar('statusDefinitions', actionsDisabled, onCreate)}
      <Table
        className="data-table-shell"
        loading={recordsState === 'loading'}
        pagination={false}
        rowKey="statusId"
        data={records}
        scroll={{ x: 1460 }}
        columns={[
          {
            title: 'statusId',
            dataIndex: 'statusId',
            width: 220,
            render: (_: unknown, record: StatusDefinition) => <Typography.Text code>{record.statusId}</Typography.Text>
          },
          { title: '名称', dataIndex: 'name', width: 180 },
          {
            title: '类别',
            dataIndex: 'statusKind',
            width: 120,
            render: (_: unknown, record: StatusDefinition) => <Tag>{record.statusKind}</Tag>
          },
          { title: '状态类型', dataIndex: 'statusTypeId', width: 120, render: (_: unknown, record: StatusDefinition) => record.statusTypeId ?? '--' },
          {
            title: '控制语义',
            dataIndex: 'controlProfileId',
            width: 180,
            render: (_: unknown, record: StatusDefinition) => record.controlProfileId ?? '--'
          },
          { title: '叠层组', dataIndex: 'stackGroupKey', width: 180 },
          { title: '叠层策略', dataIndex: 'stackMode', width: 160 },
          {
            title: '时长',
            dataIndex: 'durationMode',
            width: 180,
            render: (_: unknown, record: StatusDefinition) =>
              record.durationMode === 'permanent' ? 'permanent' : record.durationMs ? `${record.durationMs}ms` : record.durationFormulaId ?? '--'
          },
          {
            title: '操作',
            fixed: 'right' as const,
            width: 160,
            align: 'center' as const,
            render: (_: unknown, record: StatusDefinition) => renderActions('statusDefinitions', record, openRecordModal)
          }
        ]}
      />
    </Space>
  );
}

function renderControlStateProfilesTable(
  snapshot: StatusSnapshot,
  selectedStatus: StatusDefinition | undefined,
  searchText: string,
  recordsState: LoadState,
  actionsDisabled: boolean,
  onCreate: (resourceId: StatusResourceId) => void,
  openRecordModal: (resourceId: StatusResourceId, mode: ModalMode, record: unknown) => void
) {
  const records = snapshot.controlStateProfiles.filter((record) => {
    if (selectedStatus?.controlProfileId && record.controlProfileId !== selectedStatus.controlProfileId) {
      return false;
    }
    return recordContains(record, searchText);
  });

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {renderTableToolbar('controlStateProfiles', actionsDisabled, onCreate)}
      <Table
        className="data-table-shell"
        loading={recordsState === 'loading'}
        pagination={false}
        rowKey="controlProfileId"
        data={records}
        scroll={{ x: 1320 }}
        columns={[
          {
            title: 'controlProfileId',
            dataIndex: 'controlProfileId',
            width: 220,
            render: (_: unknown, record: ControlStateProfile) => <Typography.Text code>{record.controlProfileId}</Typography.Text>
          },
          { title: '名称', dataIndex: 'name', width: 180 },
          {
            title: '控制类型',
            dataIndex: 'controlKind',
            width: 140,
            render: (_: unknown, record: ControlStateProfile) => <Tag>{record.controlKind}</Tag>
          },
          { title: '移动', dataIndex: 'movementLockMode', width: 150 },
          { title: '施法', dataIndex: 'castLockMode', width: 170 },
          { title: '普攻', dataIndex: 'attackLockMode', width: 170 },
          { title: '输入接管', dataIndex: 'inputOverrideMode', width: 170 },
          { title: '优先级', dataIndex: 'priority', width: 100 },
          {
            title: '操作',
            fixed: 'right' as const,
            width: 160,
            align: 'center' as const,
            render: (_: unknown, record: ControlStateProfile) => renderActions('controlStateProfiles', record, openRecordModal)
          }
        ]}
      />
    </Space>
  );
}

function renderStatusModifierGroupsTable(
  snapshot: StatusSnapshot,
  statusFilter: string | undefined,
  searchText: string,
  recordsState: LoadState,
  actionsDisabled: boolean,
  onCreate: (resourceId: StatusResourceId) => void,
  openRecordModal: (resourceId: StatusResourceId, mode: ModalMode, record: unknown) => void
) {
  const records = snapshot.statusModifierGroups.filter(
    (record) => (!statusFilter || record.statusId === statusFilter) && recordContains(record, searchText)
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {renderTableToolbar('statusModifierGroups', actionsDisabled, onCreate)}
      <Table
        className="data-table-shell"
        loading={recordsState === 'loading'}
        pagination={false}
        rowKey={statusModifierGroupKey}
        data={records}
        scroll={{ x: 1160 }}
        columns={[
          { title: 'statusId', dataIndex: 'statusId', width: 220, render: (_: unknown, record: StatusModifierGroup) => <Typography.Text code>{record.statusId}</Typography.Text> },
          { title: 'groupKey', dataIndex: 'groupKey', width: 180 },
          { title: '名称', dataIndex: 'groupName', width: 180, render: (_: unknown, record: StatusModifierGroup) => record.groupName ?? '--' },
          { title: '阶段', dataIndex: 'phaseKey', width: 140, render: (_: unknown, record: StatusModifierGroup) => <Tag>{record.phaseKey}</Tag> },
          { title: '快照策略', dataIndex: 'snapshotPolicy', width: 140 },
          {
            title: '间隔',
            dataIndex: 'intervalMs',
            width: 120,
            render: (_: unknown, record: StatusModifierGroup) => (record.intervalMs ? `${record.intervalMs}ms` : '--')
          },
          { title: '优先级', dataIndex: 'priority', width: 100 },
          {
            title: '操作',
            fixed: 'right' as const,
            width: 160,
            align: 'center' as const,
            render: (_: unknown, record: StatusModifierGroup) => renderActions('statusModifierGroups', record, openRecordModal)
          }
        ]}
      />
    </Space>
  );
}

function renderStatusAttributeModifiersTable(
  snapshot: StatusSnapshot,
  statusFilter: string | undefined,
  searchText: string,
  recordsState: LoadState,
  actionsDisabled: boolean,
  onCreate: (resourceId: StatusResourceId) => void,
  openRecordModal: (resourceId: StatusResourceId, mode: ModalMode, record: unknown) => void
) {
  const records = snapshot.statusAttributeModifiers.filter(
    (record) => (!statusFilter || record.statusId === statusFilter) && recordContains(record, searchText)
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {renderTableToolbar('statusAttributeModifiers', actionsDisabled, onCreate)}
      <Table
        className="data-table-shell"
        loading={recordsState === 'loading'}
        pagination={false}
        rowKey={statusAttributeModifierKey}
        data={records}
        scroll={{ x: 1280 }}
        columns={[
          { title: 'statusId', dataIndex: 'statusId', width: 200, render: (_: unknown, record: StatusAttributeModifier) => <Typography.Text code>{record.statusId}</Typography.Text> },
          { title: 'groupKey', dataIndex: 'groupKey', width: 160 },
          { title: 'modifierId', dataIndex: 'modifierId', width: 180 },
          { title: 'attrKey', dataIndex: 'attrKey', width: 160 },
          { title: '模式', dataIndex: 'modifierMode', width: 130, render: (_: unknown, record: StatusAttributeModifier) => <Tag>{record.modifierMode}</Tag> },
          {
            title: '值/公式',
            dataIndex: 'value',
            width: 180,
            render: (_: unknown, record: StatusAttributeModifier) => record.value ?? record.formulaId ?? '--'
          },
          { title: 'bucketKey', dataIndex: 'bucketKey', width: 180, render: (_: unknown, record: StatusAttributeModifier) => record.bucketKey ?? '--' },
          { title: '优先级', dataIndex: 'priority', width: 100 },
          {
            title: '操作',
            fixed: 'right' as const,
            width: 160,
            align: 'center' as const,
            render: (_: unknown, record: StatusAttributeModifier) => renderActions('statusAttributeModifiers', record, openRecordModal)
          }
        ]}
      />
    </Space>
  );
}

function renderStatusPeriodicHpEffectsTable(
  snapshot: StatusSnapshot,
  statusFilter: string | undefined,
  searchText: string,
  recordsState: LoadState,
  actionsDisabled: boolean,
  onCreate: (resourceId: StatusResourceId) => void,
  openRecordModal: (resourceId: StatusResourceId, mode: ModalMode, record: unknown) => void
) {
  const records = snapshot.statusPeriodicHpEffects.filter(
    (record) => (!statusFilter || record.statusId === statusFilter) && recordContains(record, searchText)
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {renderTableToolbar('statusPeriodicHpEffects', actionsDisabled, onCreate)}
      <Table
        className="data-table-shell"
        loading={recordsState === 'loading'}
        pagination={false}
        rowKey={statusPeriodicHpEffectKey}
        data={records}
        scroll={{ x: 1380 }}
        columns={[
          { title: 'statusId', dataIndex: 'statusId', width: 200, render: (_: unknown, record: StatusPeriodicHpEffect) => <Typography.Text code>{record.statusId}</Typography.Text> },
          { title: 'groupKey', dataIndex: 'groupKey', width: 160 },
          { title: 'effectId', dataIndex: 'effectId', width: 180 },
          { title: '类型', dataIndex: 'effectKind', width: 120, render: (_: unknown, record: StatusPeriodicHpEffect) => <Tag>{record.effectKind}</Tag> },
          { title: 'tickFormulaId', dataIndex: 'tickFormulaId', width: 220 },
          {
            title: '伤害/治疗',
            dataIndex: 'damageType',
            width: 160,
            render: (_: unknown, record: StatusPeriodicHpEffect) =>
              record.effectKind === 'damage' ? record.damageType ?? '--' : record.affectedByHealModifier ? 'heal modified' : 'heal raw'
          },
          {
            title: 'crit',
            width: 220,
            render: (_: unknown, record: StatusPeriodicHpEffect) => formatStatusPeriodicHpEffectCrit(record)
          },
          {
            title: '操作',
            fixed: 'right' as const,
            width: 160,
            align: 'center' as const,
            render: (_: unknown, record: StatusPeriodicHpEffect) => renderActions('statusPeriodicHpEffects', record, openRecordModal)
          }
        ]}
      />
    </Space>
  );
}

function StatusResourceModal({
  snapshot,
  groupOptions,
  modal,
  saving,
  onClose,
  onFieldChange,
  onSubmit
}: {
  snapshot: StatusSnapshot;
  groupOptions: { label: string; value: string }[];
  modal: StatusModalState | null;
  saving: boolean;
  onClose: () => void;
  onFieldChange: (field: string, value: string | boolean) => void;
  onSubmit: () => Promise<void>;
}) {
  const readOnly = modal?.mode === 'view';
  const editingExisting = modal?.mode !== 'create';
  const title = modal ? `${modal.mode === 'create' ? '新增' : modal.mode === 'edit' ? '编辑' : '查看'}${RESOURCE_LABELS[modal.resourceId]}` : '';

  return (
    <Modal
      title={title}
      visible={!!modal}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>{readOnly ? '关闭' : '取消'}</Button>
          {!readOnly ? (
            <Button type="primary" loading={saving} onClick={() => void onSubmit()}>
              保存
            </Button>
          ) : null}
        </Space>
      }
      autoFocus={false}
      focusLock
      style={{ width: 980 }}
    >
      {modal ? renderModalForm(snapshot, groupOptions, modal, readOnly, editingExisting, onFieldChange) : null}
    </Modal>
  );
}

function renderModalForm(
  snapshot: StatusSnapshot,
  groupOptions: { label: string; value: string }[],
  modal: StatusModalState,
  readOnly: boolean,
  editingExisting: boolean,
  onFieldChange: (field: string, value: string | boolean) => void
) {
  if (modal.resourceId === 'statusDefinitions') {
    return renderStatusDefinitionForm(snapshot, modal.formData, readOnly, editingExisting, onFieldChange);
  }
  if (modal.resourceId === 'controlStateProfiles') {
    return renderControlStateProfileForm(modal.formData, readOnly, editingExisting, onFieldChange);
  }
  if (modal.resourceId === 'statusModifierGroups') {
    return renderStatusModifierGroupForm(snapshot, modal.formData, readOnly, editingExisting, onFieldChange);
  }
  if (modal.resourceId === 'statusAttributeModifiers') {
    return renderStatusAttributeModifierForm(snapshot, groupOptions, modal.formData, readOnly, editingExisting, onFieldChange);
  }
  return renderStatusPeriodicHpEffectForm(snapshot, groupOptions, modal.formData, readOnly, editingExisting, onFieldChange);
}

function renderStatusDefinitionForm(
  snapshot: StatusSnapshot,
  formData: StatusDefinitionFormData,
  readOnly: boolean,
  editingExisting: boolean,
  onFieldChange: (field: string, value: string | boolean) => void
) {
  return (
    <Form layout="vertical">
      <div className="crud-form-grid">
        <Form.Item label="statusId">
          <Input value={formData.statusId} disabled={readOnly || editingExisting} onChange={(value) => onFieldChange('statusId', value)} />
        </Form.Item>
        <Form.Item label="名称">
          <Input value={formData.name} disabled={readOnly} onChange={(value) => onFieldChange('name', value)} />
        </Form.Item>
      </div>

      <Form.Item label="说明">
        <Input.TextArea value={formData.description} disabled={readOnly} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(value) => onFieldChange('description', value)} />
      </Form.Item>

      <div className="crud-form-grid">
        <Form.Item label="statusKind">
          <Select value={formData.statusKind} disabled={readOnly} options={STATUS_KIND_OPTIONS} onChange={(value) => onFieldChange('statusKind', String(value ?? ''))} />
        </Form.Item>
        <Form.Item label="statusTypeId">
          <Input value={formData.statusTypeId} disabled={readOnly} onChange={(value) => onFieldChange('statusTypeId', value)} placeholder="可选 types.typeId" />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="controlProfileId">
          <Select
            allowClear
            showSearch
            value={formData.controlProfileId || undefined}
            disabled={readOnly}
            options={snapshot.controlStateProfiles.map((profile) => ({
              label: `${profile.controlProfileId}${profile.name ? ` / ${profile.name}` : ''}`,
              value: profile.controlProfileId
            }))}
            onChange={(value) => onFieldChange('controlProfileId', value ? String(value) : '')}
          />
        </Form.Item>
        <Form.Item label="stackGroupKey">
          <Input value={formData.stackGroupKey} disabled={readOnly} onChange={(value) => onFieldChange('stackGroupKey', value)} />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="sourceScope">
          <Select value={formData.sourceScope} disabled={readOnly} options={STATUS_SOURCE_SCOPE_OPTIONS} onChange={(value) => onFieldChange('sourceScope', String(value ?? ''))} />
        </Form.Item>
        <Form.Item label="stackMode">
          <Select value={formData.stackMode} disabled={readOnly} options={STATUS_STACK_MODE_OPTIONS} onChange={(value) => onFieldChange('stackMode', String(value ?? ''))} />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="maxStacks">
          <Input value={formData.maxStacks} disabled={readOnly} onChange={(value) => onFieldChange('maxStacks', value)} />
        </Form.Item>
        <Form.Item label="maxInstances">
          <Input value={formData.maxInstances} disabled={readOnly} onChange={(value) => onFieldChange('maxInstances', value)} placeholder="可选" />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="durationMode">
          <Select
            value={formData.durationMode}
            disabled={readOnly}
            options={STATUS_DURATION_MODE_OPTIONS}
            onChange={(value) => onFieldChange('durationMode', String(value ?? ''))}
          />
        </Form.Item>
        <Form.Item label="snapshotPolicy">
          <Select
            value={formData.snapshotPolicy}
            disabled={readOnly}
            options={STATUS_SNAPSHOT_POLICY_OPTIONS}
            onChange={(value) => onFieldChange('snapshotPolicy', String(value ?? ''))}
          />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="durationMs">
          <Input
            value={formData.durationMs}
            disabled={readOnly || formData.durationMode === 'permanent'}
            onChange={(value) => onFieldChange('durationMs', value)}
            placeholder="timed 模式至少填 durationMs 或 durationFormulaId"
          />
        </Form.Item>
        <Form.Item label="durationFormulaId">
          <Input
            value={formData.durationFormulaId}
            disabled={readOnly || formData.durationMode === 'permanent'}
            onChange={(value) => onFieldChange('durationFormulaId', value)}
          />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="defaultMagnitudeFormulaId">
          <Input value={formData.defaultMagnitudeFormulaId} disabled={readOnly} onChange={(value) => onFieldChange('defaultMagnitudeFormulaId', value)} />
        </Form.Item>
        <Form.Item label="cleansePriority">
          <Input value={formData.cleansePriority} disabled={readOnly} onChange={(value) => onFieldChange('cleansePriority', value)} />
        </Form.Item>
      </div>

      <Form.Item label="isDispellable">
        <Switch checked={formData.isDispellable} disabled={readOnly} onChange={(checked) => onFieldChange('isDispellable', Boolean(checked))} />
      </Form.Item>

      {renderExtendField(formData.extendText, readOnly, onFieldChange)}
    </Form>
  );
}

function renderControlStateProfileForm(
  formData: ControlStateProfileFormData,
  readOnly: boolean,
  editingExisting: boolean,
  onFieldChange: (field: string, value: string | boolean) => void
) {
  return (
    <Form layout="vertical">
      <div className="crud-form-grid">
        <Form.Item label="controlProfileId">
          <Input value={formData.controlProfileId} disabled={readOnly || editingExisting} onChange={(value) => onFieldChange('controlProfileId', value)} />
        </Form.Item>
        <Form.Item label="名称">
          <Input value={formData.name} disabled={readOnly} onChange={(value) => onFieldChange('name', value)} />
        </Form.Item>
      </div>

      <Form.Item label="说明">
        <Input.TextArea value={formData.description} disabled={readOnly} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(value) => onFieldChange('description', value)} />
      </Form.Item>

      <div className="crud-form-grid">
        <Form.Item label="controlKind">
          <Select value={formData.controlKind} disabled={readOnly} options={CONTROL_KIND_OPTIONS} onChange={(value) => onFieldChange('controlKind', String(value ?? ''))} />
        </Form.Item>
        <Form.Item label="displacementKind">
          <Select value={formData.displacementKind} disabled={readOnly} options={DISPLACEMENT_KIND_OPTIONS} onChange={(value) => onFieldChange('displacementKind', String(value ?? ''))} />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="movementLockMode">
          <Select value={formData.movementLockMode} disabled={readOnly} options={MOVEMENT_LOCK_MODE_OPTIONS} onChange={(value) => onFieldChange('movementLockMode', String(value ?? ''))} />
        </Form.Item>
        <Form.Item label="castLockMode">
          <Select value={formData.castLockMode} disabled={readOnly} options={CAST_LOCK_MODE_OPTIONS} onChange={(value) => onFieldChange('castLockMode', String(value ?? ''))} />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="attackLockMode">
          <Select value={formData.attackLockMode} disabled={readOnly} options={ATTACK_LOCK_MODE_OPTIONS} onChange={(value) => onFieldChange('attackLockMode', String(value ?? ''))} />
        </Form.Item>
        <Form.Item label="inputOverrideMode">
          <Select value={formData.inputOverrideMode} disabled={readOnly} options={INPUT_OVERRIDE_MODE_OPTIONS} onChange={(value) => onFieldChange('inputOverrideMode', String(value ?? ''))} />
        </Form.Item>
      </div>

      <Form.Item label="priority">
        <Input value={formData.priority} disabled={readOnly} onChange={(value) => onFieldChange('priority', value)} />
      </Form.Item>

      <Space wrap size={24}>
        {renderSwitch('blocksControlInput', formData.blocksControlInput, readOnly, onFieldChange)}
        {renderSwitch('grantsUnstoppable', formData.grantsUnstoppable, readOnly, onFieldChange)}
        {renderSwitch('breaksOnDamage', formData.breaksOnDamage, readOnly, onFieldChange)}
        {renderSwitch('tenacityReducible', formData.tenacityReducible, readOnly, onFieldChange)}
      </Space>

      {renderExtendField(formData.extendText, readOnly, onFieldChange)}
    </Form>
  );
}

function renderStatusModifierGroupForm(
  snapshot: StatusSnapshot,
  formData: StatusModifierGroupFormData,
  readOnly: boolean,
  editingExisting: boolean,
  onFieldChange: (field: string, value: string | boolean) => void
) {
  return (
    <Form layout="vertical">
      <div className="crud-form-grid">
        <Form.Item label="statusId">
          <Select
            showSearch
            value={formData.statusId || undefined}
            disabled={readOnly || editingExisting}
            options={snapshot.statusDefinitions.map((status) => ({
              label: `${status.statusId}${status.name ? ` / ${status.name}` : ''}`,
              value: status.statusId
            }))}
            onChange={(value) => onFieldChange('statusId', String(value ?? ''))}
          />
        </Form.Item>
        <Form.Item label="groupKey">
          <Input value={formData.groupKey} disabled={readOnly || editingExisting} onChange={(value) => onFieldChange('groupKey', value)} />
        </Form.Item>
      </div>

      <Form.Item label="groupName">
        <Input value={formData.groupName} disabled={readOnly} onChange={(value) => onFieldChange('groupName', value)} />
      </Form.Item>

      <div className="crud-form-grid">
        <Form.Item label="phaseKey">
          <Select value={formData.phaseKey} disabled={readOnly} options={STATUS_GROUP_PHASE_OPTIONS} onChange={(value) => onFieldChange('phaseKey', String(value ?? ''))} />
        </Form.Item>
        <Form.Item label="snapshotPolicy">
          <Select
            value={formData.snapshotPolicy}
            disabled={readOnly}
            options={STATUS_GROUP_SNAPSHOT_POLICY_OPTIONS}
            onChange={(value) => onFieldChange('snapshotPolicy', String(value ?? ''))}
          />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="intervalMs">
          <Input value={formData.intervalMs} disabled={readOnly || formData.phaseKey !== 'on_interval'} onChange={(value) => onFieldChange('intervalMs', value)} />
        </Form.Item>
        <Form.Item label="maxTicks">
          <Input value={formData.maxTicks} disabled={readOnly || formData.phaseKey !== 'on_interval'} onChange={(value) => onFieldChange('maxTicks', value)} />
        </Form.Item>
      </div>

      <Form.Item label="priority">
        <Input value={formData.priority} disabled={readOnly} onChange={(value) => onFieldChange('priority', value)} />
      </Form.Item>

      {renderExtendField(formData.extendText, readOnly, onFieldChange)}
    </Form>
  );
}

function renderStatusAttributeModifierForm(
  snapshot: StatusSnapshot,
  groupOptions: { label: string; value: string }[],
  formData: StatusAttributeModifierFormData,
  readOnly: boolean,
  editingExisting: boolean,
  onFieldChange: (field: string, value: string | boolean) => void
) {
  return (
    <Form layout="vertical">
      {renderGroupIdentityFields(snapshot, groupOptions, formData.statusId, formData.groupKey, readOnly || editingExisting, onFieldChange)}

      <div className="crud-form-grid">
        <Form.Item label="modifierId">
          <Input value={formData.modifierId} disabled={readOnly || editingExisting} onChange={(value) => onFieldChange('modifierId', value)} />
        </Form.Item>
        <Form.Item label="attrKey">
          <Input value={formData.attrKey} disabled={readOnly} onChange={(value) => onFieldChange('attrKey', value)} placeholder="attributeDefinitions.attrKey" />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="modifierMode">
          <Select value={formData.modifierMode} disabled={readOnly} options={STATUS_MODIFIER_MODE_OPTIONS} onChange={(value) => onFieldChange('modifierMode', String(value ?? ''))} />
        </Form.Item>
        <Form.Item label="priority">
          <Input value={formData.priority} disabled={readOnly} onChange={(value) => onFieldChange('priority', value)} />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="value">
          <Input value={formData.value} disabled={readOnly} onChange={(value) => onFieldChange('value', value)} placeholder="value 或 formulaId 至少填一个" />
        </Form.Item>
        <Form.Item label="formulaId">
          <Input value={formData.formulaId} disabled={readOnly} onChange={(value) => onFieldChange('formulaId', value)} />
        </Form.Item>
      </div>

      <Form.Item label="bucketKey">
        <Input value={formData.bucketKey} disabled={readOnly} onChange={(value) => onFieldChange('bucketKey', value)} placeholder="bucket_add / bucket_mul 必填" />
      </Form.Item>

      {renderSwitch('perStack', formData.perStack, readOnly, onFieldChange)}
      {renderExtendField(formData.extendText, readOnly, onFieldChange)}
    </Form>
  );
}

function renderStatusPeriodicHpEffectForm(
  snapshot: StatusSnapshot,
  groupOptions: { label: string; value: string }[],
  formData: StatusPeriodicHpEffectFormData,
  readOnly: boolean,
  editingExisting: boolean,
  onFieldChange: (field: string, value: string | boolean) => void
) {
  return (
    <Form layout="vertical">
      {renderGroupIdentityFields(snapshot, groupOptions, formData.statusId, formData.groupKey, readOnly || editingExisting, onFieldChange)}

      <div className="crud-form-grid">
        <Form.Item label="effectId">
          <Input value={formData.effectId} disabled={readOnly || editingExisting} onChange={(value) => onFieldChange('effectId', value)} />
        </Form.Item>
        <Form.Item label="effectKind">
          <Select value={formData.effectKind} disabled={readOnly} options={PERIODIC_EFFECT_KIND_OPTIONS} onChange={(value) => onFieldChange('effectKind', String(value ?? ''))} />
        </Form.Item>
      </div>

      <Form.Item label="tickFormulaId">
        <Input value={formData.tickFormulaId} disabled={readOnly} onChange={(value) => onFieldChange('tickFormulaId', value)} />
      </Form.Item>

      <div className="crud-form-grid">
        <Form.Item label="damageType">
          <Select
            value={formData.damageType}
            disabled={readOnly || formData.effectKind !== 'damage'}
            options={DAMAGE_TYPE_OPTIONS}
            onChange={(value) => onFieldChange('damageType', String(value ?? ''))}
          />
        </Form.Item>
        <Form.Item label="affectedByHealModifier">
          <Switch
            checked={formData.affectedByHealModifier}
            disabled={readOnly || formData.effectKind !== 'heal'}
            onChange={(checked) => onFieldChange('affectedByHealModifier', Boolean(checked))}
          />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="critChanceSource">
          <Select
            value={formData.critChanceSource}
            disabled={readOnly || !formData.canCrit}
            options={CRIT_CHANCE_SOURCE_OPTIONS}
            onChange={(value) => onFieldChange('critChanceSource', String(value ?? 'none'))}
          />
        </Form.Item>
        <Form.Item label="critMultiplier">
          <Input
            value={formData.critMultiplier}
            disabled={readOnly || !formData.canCrit}
            onChange={(value) => onFieldChange('critMultiplier', value)}
            placeholder="canCrit=true 时必填"
          />
        </Form.Item>
      </div>

      <Form.Item label="critChance">
        <Input
          value={formData.critChance}
          disabled={readOnly || !formData.canCrit || formData.critChanceSource !== 'fixed'}
          onChange={(value) => onFieldChange('critChance', value)}
          placeholder="仅 critChanceSource=fixed 时填写，范围 0~1"
        />
      </Form.Item>

      <Space wrap size={24}>
        {renderSwitch('canCrit', formData.canCrit, readOnly, onFieldChange)}
        {renderSwitch('perStack', formData.perStack, readOnly, onFieldChange)}
      </Space>
      {renderExtendField(formData.extendText, readOnly, onFieldChange)}
    </Form>
  );
}

function renderGroupIdentityFields(
  snapshot: StatusSnapshot,
  groupOptions: { label: string; value: string }[],
  statusId: string,
  groupKey: string,
  disabled: boolean,
  onFieldChange: (field: string, value: string | boolean) => void
) {
  const selectedGroupKey = statusId && groupKey ? `${statusId}|${groupKey}` : undefined;
  return (
    <div className="crud-form-grid">
      <Form.Item label="statusId">
        <Select
          showSearch
          value={statusId || undefined}
          disabled={disabled}
          options={snapshot.statusDefinitions.map((status) => ({
            label: `${status.statusId}${status.name ? ` / ${status.name}` : ''}`,
            value: status.statusId
          }))}
          onChange={(value) => {
            onFieldChange('statusId', String(value ?? ''));
            onFieldChange('groupKey', '');
          }}
        />
      </Form.Item>
      <Form.Item label="groupKey">
        <Select
          showSearch
          value={selectedGroupKey}
          disabled={disabled}
          options={groupOptions.filter((option) => !statusId || option.value.startsWith(`${statusId}|`))}
          onChange={(value) => {
            const [nextStatusId = '', nextGroupKey = ''] = String(value ?? '').split('|');
            onFieldChange('statusId', nextStatusId);
            onFieldChange('groupKey', nextGroupKey);
          }}
        />
      </Form.Item>
    </div>
  );
}

function renderSwitch(
  field: string,
  checked: boolean,
  disabled: boolean,
  onFieldChange: (field: string, value: string | boolean) => void
) {
  return (
    <Form.Item label={field}>
      <Switch checked={checked} disabled={disabled} onChange={(value) => onFieldChange(field, Boolean(value))} />
    </Form.Item>
  );
}

function renderExtendField(
  extendText: string,
  readOnly: boolean,
  onFieldChange: (field: string, value: string | boolean) => void
) {
  return (
    <Form.Item label="extend">
      <Input.TextArea
        value={extendText}
        disabled={readOnly}
        autoSize={{ minRows: 6, maxRows: 12 }}
        onChange={(value) => onFieldChange('extendText', value)}
        className="admin-json-input"
        placeholder="{\n  \n}"
      />
    </Form.Item>
  );
}
