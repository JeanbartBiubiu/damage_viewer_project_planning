import type {
  ControlStateProfile,
  LoadState,
  StatusAttributeModifier,
  StatusDefinition,
  StatusModifierGroup,
  StatusPeriodicHpEffect
} from '../../../../types/api';

export type StatusResourceId =
  | 'statusDefinitions'
  | 'controlStateProfiles'
  | 'statusModifierGroups'
  | 'statusAttributeModifiers'
  | 'statusPeriodicHpEffects';

export type ModalMode = 'create' | 'view' | 'edit';

export type StatusSnapshot = {
  statusDefinitions: StatusDefinition[];
  controlStateProfiles: ControlStateProfile[];
  statusModifierGroups: StatusModifierGroup[];
  statusAttributeModifiers: StatusAttributeModifier[];
  statusPeriodicHpEffects: StatusPeriodicHpEffect[];
};

export type StatusDefinitionFormData = {
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

export type ControlStateProfileFormData = {
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

export type StatusModifierGroupFormData = {
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

export type StatusAttributeModifierFormData = {
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

export type StatusPeriodicHpEffectFormData = {
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

export type StatusModalState =
  | { resourceId: 'statusDefinitions'; mode: ModalMode; formData: StatusDefinitionFormData }
  | { resourceId: 'controlStateProfiles'; mode: ModalMode; formData: ControlStateProfileFormData }
  | { resourceId: 'statusModifierGroups'; mode: ModalMode; formData: StatusModifierGroupFormData }
  | { resourceId: 'statusAttributeModifiers'; mode: ModalMode; formData: StatusAttributeModifierFormData }
  | { resourceId: 'statusPeriodicHpEffects'; mode: ModalMode; formData: StatusPeriodicHpEffectFormData };

// 新增弹窗时用于派生 form 默认值的上下文：当前选中的状态过滤器与首选效果组。
export type CreateFormDataContext = {
  statusFilter?: string;
  selectedGroup?: StatusModifierGroup;
};

// 资源配置表条目：把 create/toForm/save 三类数据派发逻辑统一为同一种签名，
// 消除 index.tsx 里的 5 分支 if-else 分发链。save 内部自行调用 buildXxxPayload 构建 payload。
export type ResourceConfig<R, F> = {
  createFormData: (ctx: CreateFormDataContext) => F;
  toFormData: (record: R) => F;
  save: (apiBaseUrl: string, gameId: string, token: string, formData: F) => Promise<unknown>;
};

export type StatusRecordState = LoadState;

export type OpenRecordModal = (resourceId: StatusResourceId, mode: ModalMode, record: unknown) => void;

export type CreateResource = (resourceId: StatusResourceId) => void;

export type ModalFieldChange = (field: string, value: string | boolean) => void;
