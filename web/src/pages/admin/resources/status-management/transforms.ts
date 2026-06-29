import { parseJsonObjectText, stringifyJson } from '../shared/json';
import type {
  ControlStateProfile,
  JsonObject,
  StatusAttributeModifier,
  StatusDefinition,
  StatusModifierGroup,
  StatusPeriodicHpEffect
} from '../../../../types/api';
import type {
  ControlStateProfileFormData,
  StatusAttributeModifierFormData,
  StatusDefinitionFormData,
  StatusModifierGroupFormData,
  StatusPeriodicHpEffectFormData
} from './types';

export function toStatusDefinitionFormData(record: StatusDefinition): StatusDefinitionFormData {
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

export function toControlStateProfileFormData(record: ControlStateProfile): ControlStateProfileFormData {
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

export function toStatusModifierGroupFormData(record: StatusModifierGroup): StatusModifierGroupFormData {
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

export function toStatusAttributeModifierFormData(record: StatusAttributeModifier): StatusAttributeModifierFormData {
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

export function toStatusPeriodicHpEffectFormData(record: StatusPeriodicHpEffect): StatusPeriodicHpEffectFormData {
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

export function recordContains(record: unknown, searchText: string): boolean {
  const normalizedSearch = searchText.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }
  return JSON.stringify(record).toLowerCase().includes(normalizedSearch);
}

export function putText(payload: JsonObject, field: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) {
    payload[field] = trimmed;
  }
}

export function putNumber(payload: JsonObject, field: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) {
    payload[field] = Number(trimmed);
  }
}

export function putExtend(payload: JsonObject, text: string) {
  const extend = parseJsonObjectText(text, 'extend');
  if (Object.keys(extend).length > 0) {
    payload.extend = extend;
  }
}

export function statusModifierGroupKey(record: Pick<StatusModifierGroup, 'statusId' | 'groupKey'>): string {
  return `${record.statusId}|${record.groupKey}`;
}

export function statusAttributeModifierKey(record: Pick<StatusAttributeModifier, 'statusId' | 'groupKey' | 'modifierId'>): string {
  return `${record.statusId}|${record.groupKey}|${record.modifierId}`;
}

export function statusPeriodicHpEffectKey(record: Pick<StatusPeriodicHpEffect, 'statusId' | 'groupKey' | 'effectId'>): string {
  return `${record.statusId}|${record.groupKey}|${record.effectId}`;
}

export function formatStatusPeriodicHpEffectCrit(record: StatusPeriodicHpEffect): string {
  if (!record.canCrit) {
    return '未启用';
  }
  const source = record.critChanceSource ?? 'attacker_crit_chance';
  const chance = source === 'fixed' && record.critChance !== undefined ? ` / ${record.critChance}` : '';
  const multiplier = record.critMultiplier !== undefined ? ` / x${record.critMultiplier}` : '';
  return `${source}${chance}${multiplier}`;
}

export function buildStatusDefinitionPayload(formData: StatusDefinitionFormData): JsonObject {
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

export function buildControlStateProfilePayload(formData: ControlStateProfileFormData): JsonObject {
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

export function buildStatusModifierGroupPayload(formData: StatusModifierGroupFormData): JsonObject {
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

export function buildStatusAttributeModifierPayload(formData: StatusAttributeModifierFormData): JsonObject {
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

export function buildStatusPeriodicHpEffectPayload(formData: StatusPeriodicHpEffectFormData): JsonObject {
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
