import { stringifyJson } from '../shared/json';
import type {
  ControlStateProfileFormData,
  CreateFormDataContext,
  StatusAttributeModifierFormData,
  StatusDefinitionFormData,
  StatusModifierGroupFormData,
  StatusPeriodicHpEffectFormData,
  StatusResourceId,
  StatusSnapshot
} from './types';

export const EMPTY_STATUS_SNAPSHOT: StatusSnapshot = {
  statusDefinitions: [],
  controlStateProfiles: [],
  statusModifierGroups: [],
  statusAttributeModifiers: [],
  statusPeriodicHpEffects: []
};

export const RESOURCE_LABELS: Record<StatusResourceId, string> = {
  statusDefinitions: '状态定义',
  controlStateProfiles: '控制语义',
  statusModifierGroups: '效果组',
  statusAttributeModifiers: '属性修饰',
  statusPeriodicHpEffects: '周期生命效果'
};

export const RESOURCE_ORDER: StatusResourceId[] = [
  'statusDefinitions',
  'controlStateProfiles',
  'statusModifierGroups',
  'statusAttributeModifiers',
  'statusPeriodicHpEffects'
];

export const STATUS_KIND_OPTIONS = toOptions(['buff', 'debuff', 'control', 'dot', 'hot', 'shield', 'special']);
export const STATUS_SOURCE_SCOPE_OPTIONS = toOptions(['any_source', 'same_source', 'same_target_source']);
export const STATUS_STACK_MODE_OPTIONS = toOptions([
  'refresh',
  'replace',
  'stack',
  'independent',
  'take_max_duration',
  'take_max_magnitude'
]);
export const STATUS_DURATION_MODE_OPTIONS = toOptions(['timed', 'permanent']);
export const STATUS_SNAPSHOT_POLICY_OPTIONS = toOptions(['on_apply', 'dynamic']);
export const STATUS_GROUP_PHASE_OPTIONS = toOptions(['while_active', 'on_apply', 'on_expire', 'on_interval']);
export const STATUS_GROUP_SNAPSHOT_POLICY_OPTIONS = toOptions(['on_apply', 'dynamic', 'per_tick']);
export const STATUS_MODIFIER_MODE_OPTIONS = toOptions(['flat', 'percent', 'bucket_add', 'bucket_mul', 'set_final']);
export const PERIODIC_EFFECT_KIND_OPTIONS = toOptions(['damage', 'heal']);
export const DAMAGE_TYPE_OPTIONS = toOptions(['physical', 'magic', 'true']);
export const CRIT_CHANCE_SOURCE_OPTIONS = toOptions(['none', 'attacker_crit_chance', 'fixed']);
export const CONTROL_KIND_OPTIONS = toOptions([
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
export const MOVEMENT_LOCK_MODE_OPTIONS = toOptions(['none', 'forbid_move', 'force_move', 'forbid_turn']);
export const CAST_LOCK_MODE_OPTIONS = toOptions(['none', 'forbid_cast', 'interrupt_cast', 'forbid_channel', 'interrupt_and_forbid']);
export const ATTACK_LOCK_MODE_OPTIONS = toOptions(['none', 'forbid_attack', 'interrupt_attack', 'interrupt_and_forbid']);
export const INPUT_OVERRIDE_MODE_OPTIONS = toOptions([
  'none',
  'force_to_source',
  'force_from_source',
  'force_to_target',
  'force_along_path',
  'force_stop'
]);
export const DISPLACEMENT_KIND_OPTIONS = toOptions(['none', 'knockup', 'knockback', 'pull', 'forced_dash']);

function toOptions(values: string[]) {
  return values.map((value) => ({ label: value, value }));
}

export function createStatusDefinitionFormData(ctx: CreateFormDataContext): StatusDefinitionFormData {
  const statusId = ctx.statusFilter ?? '';
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

export function createControlStateProfileFormData(): ControlStateProfileFormData {
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

export function createStatusModifierGroupFormData(ctx: CreateFormDataContext): StatusModifierGroupFormData {
  return {
    statusId: ctx.statusFilter ?? '',
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

export function createStatusAttributeModifierFormData(ctx: CreateFormDataContext): StatusAttributeModifierFormData {
  const statusId = ctx.statusFilter ?? ctx.selectedGroup?.statusId ?? '';
  const groupKey = ctx.selectedGroup?.groupKey ?? '';
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

export function createStatusPeriodicHpEffectFormData(ctx: CreateFormDataContext): StatusPeriodicHpEffectFormData {
  const statusId = ctx.statusFilter ?? ctx.selectedGroup?.statusId ?? '';
  const groupKey = ctx.selectedGroup?.groupKey ?? '';
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
