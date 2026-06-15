import type { JsonObject } from '../../types/api';

export type DpsPassiveTemplateId =
  | 'attacker_on_hit_damage'
  | 'attacker_every_n_damage'
  | 'attacker_stack_trigger_damage'
  | 'target_incoming_damage_modifier'
  | 'target_incoming_crit_only_modifier'
  | 'attacker_execute_threshold'
  | 'attacker_crit_context_modifier'
  | 'bucket_damage_modifier'
  | 'attacker_energized_damage'
  | 'attacker_phantom_hit_repeat'
  | 'target_retaliation_damage'
  | 'apply_dot'
  | 'stat_modifier_always_on';

export type DpsPassiveTemplateContext = {
  itemId?: string;
  skillId?: string;
  passiveIdPrefix?: string;
  sourceId?: string;
  sourceCategory?: string;
  sourceType?: string;
  ownerRole?: 'attacker' | 'target';
};

export type DpsPassiveTemplate = {
  id: DpsPassiveTemplateId;
  label: string;
  description: string;
  ownerRole: 'attacker' | 'target';
  supported: 'runtime' | 'authoring_only';
  requiresRealData: boolean;
  keyFields: string[];
  create: (context: DpsPassiveTemplateContext) => JsonObject;
};

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveSourceId(context: DpsPassiveTemplateContext): string {
  return asText(context.sourceId) || asText(context.itemId) || asText(context.skillId) || 'draft_item';
}

function resolveIdBase(context: DpsPassiveTemplateContext, suffix: string): string {
  const prefix = asText(context.passiveIdPrefix) || resolveSourceId(context);
  return `${prefix}_${suffix}`;
}

function buildBasePassive(
  context: DpsPassiveTemplateContext,
  suffix: string,
  ownerRole: 'attacker' | 'target'
): JsonObject {
  const sourceId = resolveSourceId(context);
  const passiveId = resolveIdBase(context, suffix);
  return {
    passiveId,
    effectId: passiveId,
    sourceCategory: asText(context.sourceCategory) || 'item',
    sourceType: asText(context.sourceType) || 'item',
    sourceId,
    ownerRole: context.ownerRole ?? ownerRole
  };
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return { ...value };
}

function clonePassivePreserveUnknown(passive: JsonObject): JsonObject {
  const next = cloneJsonObject(passive);
  if (Array.isArray(passive.operations)) {
    next.operations = passive.operations.map((operation) => (isPlainObject(operation) ? { ...operation } : operation));
  }
  return next;
}

function suggestUniquePassiveId(baseId: string, existingIds: ReadonlySet<string>): string {
  if (!existingIds.has(baseId)) {
    return baseId;
  }
  let next = 2;
  while (existingIds.has(`${baseId}_${next}`)) {
    next += 1;
  }
  return `${baseId}_${next}`;
}

export const DPS_PASSIVE_TEMPLATES: DpsPassiveTemplate[] = [
  {
    id: 'attacker_on_hit_damage',
    label: '攻击方 · 普攻命中伤害',
    description: '普攻命中附带额外伤害（on_basic_attack_hit + damage）。',
    ownerRole: 'attacker',
    supported: 'runtime',
    requiresRealData: true,
    keyFields: ['trigger.event', 'operations[].amount', 'operations[].damageType'],
    create: (context) => {
      const base = buildBasePassive(context, 'on_hit_damage', 'attacker');
      const evidenceKey = asText(base.passiveId);
      return {
        ...base,
        trigger: {
          event: 'on_basic_attack_hit',
          matcher: {
            sourceRole: 'attacker',
            targetRole: 'target'
          }
        },
        operations: [
          {
            kind: 'damage',
            source: evidenceKey,
            targetRole: 'target',
            damageType: 'physical',
            amount: 0,
            evidenceKey
          }
        ]
      };
    }
  },
  {
    id: 'attacker_every_n_damage',
    label: '攻击方 · 每 N 次普攻伤害',
    description: '每 N 次普攻触发额外伤害（every_n_basic_attack_hit）。',
    ownerRole: 'attacker',
    supported: 'runtime',
    requiresRealData: true,
    keyFields: ['everyN', 'operations[].amount', 'operations[].damageType'],
    create: (context) => {
      const base = buildBasePassive(context, 'every_3_damage', 'attacker');
      const evidenceKey = asText(base.passiveId);
      return {
        ...base,
        triggerKind: 'every_n_basic_attack_hit',
        everyN: 3,
        operations: [
          {
            kind: 'damage',
            source: evidenceKey,
            targetRole: 'target',
            damageType: 'physical',
            amount: 0,
            evidenceKey
          }
        ]
      };
    }
  },
  {
    id: 'attacker_stack_trigger_damage',
    label: '攻击方 · 叠层触发伤害',
    description: '普攻叠层，达到阈值时造成伤害（add_stack + trigger_damage_at_stacks）。',
    ownerRole: 'attacker',
    supported: 'runtime',
    requiresRealData: true,
    keyFields: ['operations[].stackKey', 'operations[].triggerStacks', 'operations[].amount'],
    create: (context) => {
      const base = buildBasePassive(context, 'stack_trigger', 'attacker');
      const evidenceKey = asText(base.passiveId);
      const stackKey = `${resolveSourceId(context)}_stack`;
      return {
        ...base,
        trigger: {
          event: 'on_basic_attack_hit',
          matcher: {
            sourceRole: 'attacker',
            targetRole: 'target'
          }
        },
        operations: [
          {
            kind: 'add_stack',
            stackKey,
            maxStacks: 3
          },
          {
            kind: 'trigger_damage_at_stacks',
            source: evidenceKey,
            stackKey,
            triggerStacks: 3,
            resetStacks: true,
            targetRole: 'target',
            damageType: 'true',
            amount: 0,
            evidenceKey
          }
        ]
      };
    }
  },
  {
    id: 'target_incoming_damage_modifier',
    label: '目标方 · 受击伤害修正',
    description: '目标侧受击增减伤（on_damage_taken + damage_modifier incoming）。',
    ownerRole: 'target',
    supported: 'runtime',
    requiresRealData: true,
    keyFields: ['ownerRole', 'operations[].value', 'operations[].valuePhase'],
    create: (context) => {
      const base = buildBasePassive(context, 'incoming_modifier', 'target');
      const evidenceKey = asText(base.passiveId);
      return {
        ...base,
        trigger: {
          event: 'on_damage_taken',
          matcher: {
            sourceRole: 'attacker',
            targetRole: 'target'
          }
        },
        operations: [
          {
            kind: 'damage_modifier',
            source: evidenceKey,
            targetRole: 'target',
            valuePhase: 'incoming',
            modifierMode: 'percent',
            value: 0,
            critOnly: false,
            evidenceKey
          }
        ]
      };
    }
  },
  {
    id: 'target_incoming_crit_only_modifier',
    label: '目标方 · 暴击限定受击修正',
    description: '目标侧仅暴击受击增减伤（critOnly=true，如兰顿类结构）。',
    ownerRole: 'target',
    supported: 'runtime',
    requiresRealData: true,
    keyFields: ['ownerRole', 'operations[].critOnly', 'operations[].value'],
    create: (context) => {
      const base = buildBasePassive(context, 'incoming_crit_modifier', 'target');
      const evidenceKey = asText(base.passiveId);
      return {
        ...base,
        trigger: {
          event: 'on_damage_taken',
          matcher: {
            sourceRole: 'attacker',
            targetRole: 'target'
          }
        },
        operations: [
          {
            kind: 'damage_modifier',
            source: evidenceKey,
            targetRole: 'target',
            valuePhase: 'incoming',
            modifierMode: 'percent',
            value: 0,
            critOnly: true,
            evidenceKey
          }
        ]
      };
    }
  },
  {
    id: 'attacker_execute_threshold',
    label: '攻击方 · 斩杀阈值',
    description: '低血量斩杀（execute_threshold；thresholdValue 需手动填写）。',
    ownerRole: 'attacker',
    supported: 'runtime',
    requiresRealData: true,
    keyFields: ['operations[].thresholdType', 'operations[].thresholdValue', 'operations[].checkTiming'],
    create: (context) => {
      const base = buildBasePassive(context, 'execute_threshold', 'attacker');
      const evidenceKey = asText(base.passiveId);
      return {
        ...base,
        trigger: {
          event: 'on_damage_dealt',
          matcher: {
            sourceRole: 'attacker',
            targetRole: 'target'
          }
        },
        operations: [
          {
            kind: 'execute_threshold',
            source: evidenceKey,
            targetRole: 'target',
            thresholdType: 'current_hp_ratio',
            checkTiming: 'after_damage',
            evidenceKey
          }
        ]
      };
    }
  },
  {
    id: 'attacker_crit_context_modifier',
    label: '攻击方 · 暴击上下文修正',
    description: '强制暴击或调整暴击倍率（crit_context_modifier）。',
    ownerRole: 'attacker',
    supported: 'runtime',
    requiresRealData: true,
    keyFields: ['operations[].forceCrit', 'operations[].critMultiplierOverride', 'operations[].critMultiplierScale'],
    create: (context) => {
      const base = buildBasePassive(context, 'crit_context', 'attacker');
      const evidenceKey = asText(base.passiveId);
      return {
        ...base,
        trigger: {
          event: 'on_basic_attack_hit',
          matcher: {
            sourceRole: 'attacker',
            targetRole: 'target'
          }
        },
        operations: [
          {
            kind: 'crit_context_modifier',
            source: evidenceKey,
            evidenceKey
          }
        ]
      };
    }
  },
  {
    id: 'bucket_damage_modifier',
    label: '攻击方 · 乘区伤害修正',
    description: 'Batch R 乘区平台伤害增减（bucketKey + valueSpec）。',
    ownerRole: 'attacker',
    supported: 'runtime',
    requiresRealData: true,
    keyFields: ['operations[].bucketKey', 'operations[].valueSpec'],
    create: (context) => {
      const base = buildBasePassive(context, 'bucket_modifier', 'attacker');
      const evidenceKey = asText(base.passiveId);
      return {
        ...base,
        trigger: {
          event: 'on_damage_dealt',
          matcher: {
            sourceRole: 'attacker',
            targetRole: 'target'
          }
        },
        operations: [
          {
            kind: 'damage_modifier',
            source: evidenceKey,
            targetRole: 'target',
            bucketKey: '',
            valueSpec: {
              kind: 'literal',
              value: 0
            },
            conditions: [],
            evidenceKey
          }
        ]
      };
    }
  },
  {
    id: 'attacker_energized_damage',
    label: '攻击方 · 充能触发伤害',
    description: '普攻充能，就绪后触发伤害（energized_charge_and_consume + charge 字段）。',
    ownerRole: 'attacker',
    supported: 'runtime',
    requiresRealData: true,
    keyFields: [
      'chargeKey',
      'chargeGainPerBasicAttack',
      'chargeThreshold',
      'chargeCap',
      'chargeReadyPolicy',
      'consumeChargeOnTrigger',
      'procScope',
      'operations[].amount'
    ],
    create: (context) => {
      const base = buildBasePassive(context, 'energized_damage', 'attacker');
      const evidenceKey = asText(base.passiveId);
      const sourceId = resolveSourceId(context);
      const chargeKey = `${sourceId}_charge`;
      return {
        ...base,
        triggerKind: 'energized_charge_and_consume',
        chargeKey,
        chargeGainPerBasicAttack: 1,
        chargeThreshold: 3,
        chargeCap: 3,
        chargeReadyPolicy: 'next_basic_attack_after_threshold_reached',
        consumeChargeOnTrigger: true,
        procScope: 'real_basic_attack_only',
        operations: [
          {
            kind: 'damage',
            source: evidenceKey,
            targetRole: 'target',
            damageType: 'physical',
            amount: 0,
            evidenceKey
          }
        ]
      };
    }
  },
  {
    id: 'attacker_phantom_hit_repeat',
    label: '攻击方 · 幻影命中重复',
    description: '叠层后在幻影命中时重复 copyable 伤害（add_stack + damage + phantom_hit_on_hit_repeat）。',
    ownerRole: 'attacker',
    supported: 'runtime',
    requiresRealData: true,
    keyFields: [
      'operations[].stackKey',
      'operations[].phantomHitCopyable',
      'operations[].triggerStacks',
      'operations[].repeatTag',
      'operations[].repeatScope'
    ],
    create: (context) => {
      const base = buildBasePassive(context, 'phantom_hit_repeat', 'attacker');
      const evidenceKey = asText(base.passiveId);
      const stackKey = `${resolveSourceId(context)}_phantom_stack`;
      return {
        ...base,
        trigger: {
          event: 'on_basic_attack_hit',
          matcher: {
            sourceRole: 'attacker',
            targetRole: 'target'
          }
        },
        operations: [
          {
            kind: 'add_stack',
            stackKey,
            maxStacks: 4,
            refreshMode: 'refresh'
          },
          {
            kind: 'damage',
            source: evidenceKey,
            targetRole: 'target',
            damageType: 'physical',
            amount: 0,
            phantomHitCopyable: true,
            evidenceKey
          },
          {
            kind: 'phantom_hit_on_hit_repeat',
            source: `${evidenceKey}_phantom`,
            stackKey,
            triggerStacks: 4,
            repeatCount: 1,
            repeatTag: 'phantom_hit',
            repeatScope: 'copyable_on_hit',
            evidenceKey: `${evidenceKey}_phantom`
          }
        ]
      };
    }
  },
  {
    id: 'target_retaliation_damage',
    label: '目标方 · 受击反击伤害',
    description: '目标侧受击后对攻击方造成伤害（on_damage_taken + damage targetRole=attacker）。',
    ownerRole: 'target',
    supported: 'runtime',
    requiresRealData: true,
    keyFields: ['ownerRole', 'trigger.event', 'operations[].targetRole', 'operations[].amount'],
    create: (context) => {
      const base = buildBasePassive(context, 'retaliation_damage', 'target');
      const evidenceKey = asText(base.passiveId);
      return {
        ...base,
        trigger: {
          event: 'on_damage_taken',
          matcher: {
            sourceRole: 'attacker',
            targetRole: 'target'
          }
        },
        operations: [
          {
            kind: 'damage',
            source: evidenceKey,
            targetRole: 'attacker',
            damageType: 'physical',
            amount: 0,
            evidenceKey
          }
        ]
      };
    }
  },
  {
    id: 'apply_dot',
    label: '攻击方 · 施加 DoT',
    description: '命中后施加持续伤害（apply_dot + durationMs/tickIntervalMs）。',
    ownerRole: 'attacker',
    supported: 'runtime',
    requiresRealData: true,
    keyFields: [
      'operations[].damageType',
      'operations[].amount',
      'operations[].durationMs',
      'operations[].tickIntervalMs',
      'operations[].refreshMode'
    ],
    create: (context) => {
      const base = buildBasePassive(context, 'apply_dot', 'attacker');
      const evidenceKey = asText(base.passiveId);
      return {
        ...base,
        trigger: {
          event: 'on_basic_attack_hit',
          matcher: {
            sourceRole: 'attacker',
            targetRole: 'target'
          }
        },
        operations: [
          {
            kind: 'apply_dot',
            source: evidenceKey,
            targetRole: 'target',
            damageType: 'magic',
            amount: 0,
            durationMs: 3000,
            tickIntervalMs: 1000,
            refreshMode: 'refresh',
            evidenceKey
          }
        ]
      };
    }
  },
  {
    id: 'stat_modifier_always_on',
    label: '攻击方 · 常驻属性修正',
    description: '战斗开始时生效的属性修正（triggerKind=stat_modifier_always_on + stat_modifier）。',
    ownerRole: 'attacker',
    supported: 'runtime',
    requiresRealData: true,
    keyFields: ['triggerKind', 'operations[].attrKey', 'operations[].modifierMode', 'operations[].value'],
    create: (context) => {
      const base = buildBasePassive(context, 'stat_modifier_always_on', 'attacker');
      const evidenceKey = asText(base.passiveId);
      return {
        ...base,
        triggerKind: 'stat_modifier_always_on',
        operations: [
          {
            kind: 'stat_modifier',
            source: evidenceKey,
            attrKey: 'attack_speed',
            modifierMode: 'percent',
            value: 0,
            evidenceKey
          }
        ]
      };
    }
  }
];

const TEMPLATE_BY_ID = new Map<DpsPassiveTemplateId, DpsPassiveTemplate>(
  DPS_PASSIVE_TEMPLATES.map((template) => [template.id, template])
);

export function getDpsPassiveTemplateOptions(): Array<{ label: string; value: DpsPassiveTemplateId }> {
  return DPS_PASSIVE_TEMPLATES.map((template) => ({
    label: template.label,
    value: template.id
  }));
}

export function getDpsPassiveTemplate(templateId: DpsPassiveTemplateId): DpsPassiveTemplate | undefined {
  return TEMPLATE_BY_ID.get(templateId);
}

export function createDpsPassiveFromTemplate(
  templateId: DpsPassiveTemplateId,
  context: DpsPassiveTemplateContext = {}
): JsonObject {
  const template = TEMPLATE_BY_ID.get(templateId);
  if (!template) {
    throw new Error(`未知 DPS passive 模板：${templateId}`);
  }
  return clonePassivePreserveUnknown(template.create(context));
}

export function createDpsPassiveTemplateOperations(
  templateId: DpsPassiveTemplateId,
  context: DpsPassiveTemplateContext = {}
): JsonObject[] {
  const passive = createDpsPassiveFromTemplate(templateId, context);
  const operations = passive.operations;
  if (!Array.isArray(operations)) {
    return [];
  }
  return operations.map((operation) => (isPlainObject(operation) ? { ...operation } : operation)).filter(isPlainObject);
}

export function buildDpsPassiveTemplateContext(input: {
  skillId?: string;
  ownerId?: string;
  ownerType?: string;
}): DpsPassiveTemplateContext {
  const skillId = asText(input.skillId);
  const ownerId = asText(input.ownerId);
  const sourceId = input.ownerType === 'item' && ownerId ? ownerId : skillId || ownerId;
  return {
    skillId: skillId || undefined,
    itemId: input.ownerType === 'item' ? ownerId || undefined : undefined,
    sourceId: sourceId || undefined,
    passiveIdPrefix: sourceId || skillId || undefined
  };
}

export function duplicateDpsPassive(passive: JsonObject, existingPassives: JsonObject[]): JsonObject {
  const existingIds = new Set(
    existingPassives.flatMap((entry) => {
      if (!isPlainObject(entry)) {
        return [];
      }
      return [asText(entry.passiveId), asText(entry.effectId)].filter(Boolean);
    })
  );
  const clone = clonePassivePreserveUnknown(passive);
  const baseId = asText(passive.passiveId) || asText(passive.effectId) || 'passive';
  const nextId = suggestUniquePassiveId(baseId, existingIds);
  clone.passiveId = nextId;
  if ('effectId' in passive) {
    clone.effectId = nextId;
  }
  if (Array.isArray(clone.operations)) {
    clone.operations = clone.operations.map((operation) => {
      if (!isPlainObject(operation)) {
        return operation;
      }
      const nextOperation = { ...operation };
      if (asText(operation.evidenceKey) === baseId) {
        nextOperation.evidenceKey = nextId;
      }
      if (asText(operation.source) === baseId) {
        nextOperation.source = nextId;
      }
      return nextOperation;
    });
  }
  return clone;
}

export function appendOperationsToPassive(passive: JsonObject, operations: JsonObject[]): JsonObject {
  const next = clonePassivePreserveUnknown(passive);
  const existingOperations = Array.isArray(next.operations) ? next.operations : [];
  next.operations = [...existingOperations, ...operations.map((operation) => ({ ...operation }))];
  return next;
}

const DPS_PASSIVE_TEMPLATE_SKILL_SUFFIX: Record<DpsPassiveTemplateId, string> = {
  attacker_on_hit_damage: 'on_hit_damage',
  attacker_every_n_damage: 'every_n_damage',
  attacker_stack_trigger_damage: 'stack_trigger',
  target_incoming_damage_modifier: 'incoming_modifier',
  target_incoming_crit_only_modifier: 'incoming_crit_modifier',
  attacker_execute_threshold: 'execute_threshold',
  attacker_crit_context_modifier: 'crit_context',
  bucket_damage_modifier: 'bucket_modifier',
  attacker_energized_damage: 'energized_damage',
  attacker_phantom_hit_repeat: 'phantom_hit_repeat',
  target_retaliation_damage: 'retaliation_damage',
  apply_dot: 'apply_dot',
  stat_modifier_always_on: 'stat_modifier_always_on'
};

export type ItemOwnedDpsSkillMeta = {
  skillId: string;
  skillKey: string;
  name: string;
};

export function suggestItemOwnedDpsSkillMeta(
  itemId: string,
  templateId: DpsPassiveTemplateId,
  itemName?: string
): ItemOwnedDpsSkillMeta {
  const normalizedItemId = asText(itemId) || 'draft_item';
  const suffix = DPS_PASSIVE_TEMPLATE_SKILL_SUFFIX[templateId] ?? 'passive';
  const template = getDpsPassiveTemplate(templateId);
  const skillId = `${normalizedItemId}_${suffix}`;
  const skillKey = skillId;
  const templateLabel = template?.label ?? templateId;
  const displayItemName = asText(itemName);
  const name = displayItemName ? `${displayItemName} · ${templateLabel}` : `${normalizedItemId} · ${templateLabel}`;
  return { skillId, skillKey, name };
}

export type ItemOwnedDpsPassiveOperationPatch = {
  thresholdValue?: number;
  forceCrit?: boolean;
  critMultiplierOverride?: number;
  critMultiplierScale?: number;
  clearCritMultiplierOverride?: boolean;
  clearCritMultiplierScale?: boolean;
  bucketKey?: string;
};

const ITEM_CREATOR_PARAM_TEMPLATE_IDS = new Set<DpsPassiveTemplateId>([
  'attacker_execute_threshold',
  'attacker_crit_context_modifier',
  'bucket_damage_modifier'
]);

export function templateRequiresItemCreatorParams(templateId: DpsPassiveTemplateId): boolean {
  return ITEM_CREATOR_PARAM_TEMPLATE_IDS.has(templateId);
}

export function buildItemCreatorOperationPatch(
  templateId: DpsPassiveTemplateId,
  params: {
    thresholdValueText?: string;
    forceCrit?: boolean;
    critMultiplierOverrideText?: string;
    critMultiplierScaleText?: string;
    bucketKey?: string;
  }
): ItemOwnedDpsPassiveOperationPatch | undefined {
  switch (templateId) {
    case 'attacker_execute_threshold': {
      const text = asText(params.thresholdValueText);
      if (!text) {
        return {};
      }
      const thresholdValue = Number(text);
      return Number.isFinite(thresholdValue) ? { thresholdValue } : {};
    }
    case 'attacker_crit_context_modifier': {
      const patch: ItemOwnedDpsPassiveOperationPatch = {};
      if (params.forceCrit === true) {
        patch.forceCrit = true;
      }
      const overrideText = asText(params.critMultiplierOverrideText);
      const scaleText = asText(params.critMultiplierScaleText);
      if (overrideText) {
        const critMultiplierOverride = Number(overrideText);
        if (Number.isFinite(critMultiplierOverride) && critMultiplierOverride > 0) {
          patch.critMultiplierOverride = critMultiplierOverride;
          patch.clearCritMultiplierScale = true;
        }
      } else if (scaleText) {
        const critMultiplierScale = Number(scaleText);
        if (Number.isFinite(critMultiplierScale) && critMultiplierScale > 0) {
          patch.critMultiplierScale = critMultiplierScale;
          patch.clearCritMultiplierOverride = true;
        }
      }
      return patch;
    }
    case 'bucket_damage_modifier':
      return { bucketKey: asText(params.bucketKey) };
    default:
      return undefined;
  }
}

function applyItemCreatorOperationPatch(
  passive: JsonObject,
  patch: ItemOwnedDpsPassiveOperationPatch | undefined
): JsonObject {
  if (!patch) {
    return passive;
  }
  const next = clonePassivePreserveUnknown(passive);
  if (!Array.isArray(next.operations) || next.operations.length === 0) {
    return next;
  }
  const firstOperation = next.operations[0];
  if (!isPlainObject(firstOperation)) {
    return next;
  }
  const patchedOperation = { ...firstOperation };
  if ('thresholdValue' in patch) {
    patchedOperation.thresholdValue = patch.thresholdValue;
  }
  if ('forceCrit' in patch) {
    patchedOperation.forceCrit = patch.forceCrit;
  }
  if (patch.clearCritMultiplierOverride) {
    delete patchedOperation.critMultiplierOverride;
    delete patchedOperation.hasCritMultiplierOverride;
  }
  if (patch.clearCritMultiplierScale) {
    delete patchedOperation.critMultiplierScale;
    delete patchedOperation.hasCritMultiplierScale;
  }
  if ('critMultiplierOverride' in patch) {
    patchedOperation.critMultiplierOverride = patch.critMultiplierOverride;
  }
  if ('critMultiplierScale' in patch) {
    patchedOperation.critMultiplierScale = patch.critMultiplierScale;
  }
  if ('bucketKey' in patch) {
    patchedOperation.bucketKey = patch.bucketKey;
  }
  next.operations = [patchedOperation, ...next.operations.slice(1)];
  return next;
}

export function buildItemOwnedDpsPassiveSkillPayload(input: {
  itemId: string;
  skillId: string;
  skillKey: string;
  name: string;
  templateId: DpsPassiveTemplateId;
  operationPatch?: ItemOwnedDpsPassiveOperationPatch;
}): JsonObject {
  const itemId = asText(input.itemId);
  const skillId = asText(input.skillId);
  const passive = applyItemCreatorOperationPatch(
    createDpsPassiveFromTemplate(input.templateId, {
      itemId,
      skillId,
      sourceId: itemId,
      passiveIdPrefix: itemId,
      sourceCategory: 'item',
      sourceType: 'item'
    }),
    input.operationPatch
  );
  return {
    skillId,
    ownerType: 'item',
    ownerId: itemId,
    skillKey: asText(input.skillKey) || skillId,
    name: asText(input.name) || skillId,
    resourceCosts: [],
    cooldowns: [],
    params: {},
    timingProfile: {},
    mechanicsConfig: {
      version: 1,
      triggers: [],
      dpsPassiveEffects: [passive]
    }
  };
}
