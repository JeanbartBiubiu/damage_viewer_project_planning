import type { JsonObject } from './api';

/** Public combat-data envelope: list endpoints use T[], object endpoints use T. */
export type CombatDataEnvelope<T> = {
  gameId: string;
  currentRevision: number;
  data: T;
};

export type CombatDataRowMeta = {
  gameId: string;
  changeRevision: number;
  updatedAt: string;
};

export type CombatDataState = {
  gameId: string;
  currentRevision: number;
  publishedRevision: number;
  updatedAt: string;
};

export type ProgressionSchema = CombatDataRowMeta & {
  progressionKind: 'LEVEL' | 'STAR' | string;
  stageMin: number;
  stageMax: number;
  stageLabel: string;
  requireAllStages: boolean;
};

export type AttributeDefinition = CombatDataRowMeta & {
  attrKey: string;
  sortOrder: number;
  attrName?: string;
  attrType?: string;
  defaultValue?: number;
  valueKind: string;
  rateTargetAttrKey?: string;
  minValue?: number;
  maxValue?: number;
  /** Optional same-game images.uri association; null when cleared/absent. */
  imageUri?: string | null;
};

export type ResourceDefinition = CombatDataRowMeta & {
  resourceKey: string;
  displayName: string;
  defaultInitialValue: number;
  defaultMaxValue: number;
};

export type TypeDefinition = CombatDataRowMeta & {
  typeId: number;
  typeKey: string;
  name?: string;
  description?: string;
  reservedTypeId?: number;
};

export const COMBAT_TYPE_RELATION_TARGET_CATEGORIES = [
  'entity',
  'attribute',
  'resource',
  'provider',
  'ability',
  'ability_phase',
  'modifier',
  'listener',
  'effect_step',
  'type'
] as const;

export type CombatTypeRelationTargetCategory = (typeof COMBAT_TYPE_RELATION_TARGET_CATEGORIES)[number];

export type TypeRelation = CombatDataRowMeta & {
  typeId: number;
  targetCategory: string;
  targetId: string;
  extend?: JsonObject;
};

export type CombatEntity = CombatDataRowMeta & {
  entityId: string;
  displayName: string;
  description?: string;
  /** Optional same-game images.uri association; null when cleared/absent. */
  imageUri?: string | null;
};

export type EntityAttribute = CombatDataRowMeta & {
  entityId: string;
  attrKey: string;
  baseValue: number;
};

export type EntityAttributeStage = CombatDataRowMeta & {
  entityId: string;
  attrKey: string;
  stage: number;
  value: number;
};

export type EntityResource = CombatDataRowMeta & {
  entityId: string;
  resourceKey: string;
  initialValue: number;
  maxValue: number;
};

export type EntityResourceStage = CombatDataRowMeta & {
  entityId: string;
  resourceKey: string;
  stage: number;
  initialValue: number;
  maxValue: number;
};

export type EntityProviderMount = CombatDataRowMeta & {
  entityId: string;
  providerId: string;
};

export type Provider = CombatDataRowMeta & {
  providerId: string;
  providerKindTypeId: number;
  displayName: string;
};

export type ProviderLifecycle = CombatDataRowMeta & {
  providerId: string;
  durationFormulaKey?: string;
  maxStacks: number;
  refreshPolicyTypeId?: number;
  tickIntervalMs?: number;
  startDelayMs?: number;
};

export type ProviderStateField = CombatDataRowMeta & {
  providerId: string;
  stateKey: string;
  valueTypeId: number;
  maxValue?: number;
  durationMs?: number;
  refreshPolicyTypeId?: number;
};

export type ProviderFormula = CombatDataRowMeta & {
  providerId: string;
  formulaKey: string;
  expression: JsonObject;
};

export type ProviderModifier = CombatDataRowMeta & {
  providerId: string;
  modifierId: string;
  modifierKey: string;
  modifierTypeId?: number;
  targetSelectorTypeId: number;
  targetAttrKey: string;
  commandTypeId?: number;
  channelTypeId?: number;
  bucketTypeId?: number;
  stageTypeId?: number;
  priority: number;
  valuePolicyTypeId: number;
  valueFormulaKey: string;
  conditionFormulaKey?: string;
};

export type ProviderListener = CombatDataRowMeta & {
  providerId: string;
  listenerId: string;
  listenerKey: string;
  eventTypeId: number;
  abilityId?: string;
  maxTriggersPerEvent?: number;
  chainLimitKey?: string;
  /** Optional non-negative per-cast listener throttle (ms); null/missing = unset. */
  perCastThrottleMs?: number | null;
};

export type ListenerMatchType = CombatDataRowMeta & {
  listenerId: string;
  matchModeTypeId: number;
  typeId: number;
};

export type ProviderTickSequence = CombatDataRowMeta & {
  providerId: string;
  sequenceId: string;
};

/** Ability cast provenance enum from Backend (nullable/optional on rows). */
export type AbilityCastOrigin = 'champion' | 'item' | 'pet' | 'innate';

export type Ability = CombatDataRowMeta & {
  abilityId: string;
  providerId: string;
  abilityKey: string;
  abilityKindTypeId: number;
  displayName: string;
  /** Optional provider-local formula key for ability cast precondition. */
  castConditionFormulaKey?: string;
  /** Optional cast provenance; null/missing = unset (omit in CompileRequest). */
  castOrigin?: AbilityCastOrigin | null;
};

export type AbilityParameter = CombatDataRowMeta & {
  abilityId: string;
  paramKey: string;
  numericValue: number;
};

export type AbilityStateField = CombatDataRowMeta & {
  abilityId: string;
  stateKey: string;
  valueTypeId: number;
};

export type AbilityPhase = CombatDataRowMeta & {
  phaseId: string;
  abilityId: string;
  phaseOrder: number;
  phaseTypeId: number;
  durationFormulaKey?: string;
  interruptible: boolean;
};

export type AbilityCost = CombatDataRowMeta & {
  costId: string;
  abilityId: string;
  phaseId?: string;
  resourceKey: string;
  amountFormulaKey: string;
  allowPartial: boolean;
};

export type AbilityCooldown = CombatDataRowMeta & {
  cooldownId: string;
  abilityId: string;
  durationFormulaKey: string;
  startsOnPhaseId?: string;
  groupKey?: string;
};

export type EffectSequence = CombatDataRowMeta & {
  sequenceId: string;
  providerId: string;
  sequenceKey: string;
  displayName?: string;
};

export type AbilityPhaseEffectSequence = CombatDataRowMeta & {
  phaseId: string;
  triggerTypeId: number;
  sequenceId: string;
};

export type ListenerEffectSequence = CombatDataRowMeta & {
  listenerId: string;
  sequenceId: string;
};

export const EFFECT_STEP_DETAIL_KEYS = [
  'damageDetail',
  'healDetail',
  'resourceDetail',
  'attributeDetail',
  'shieldDetail',
  'providerDetail',
  'eventDetail',
  'abilityControlDetail',
  'stateDetail',
  'repeatDetail',
  'executeDetail'
] as const;

export type EffectStepDetailKey = (typeof EFFECT_STEP_DETAIL_KEYS)[number];

export type DamageDetail = {
  amountFormulaKey: string;
  damageTypeId: number;
  valuePolicyTypeId: number;
  /** Backend defaults omitted writes to false; emit on Wasm only when true. */
  copyableOnHit?: boolean;
  /** Backend defaults omitted writes to false; emit on Wasm only when true. */
  critEligible?: boolean;
};

export type HealDetail = {
  amountFormulaKey: string;
  valuePolicyTypeId: number;
};

export type ResourceDetail = {
  resourceKey: string;
  amountFormulaKey: string;
  valuePolicyTypeId: number;
};

export type AttributeDetail = {
  attrKey: string;
  amountFormulaKey: string;
  valuePolicyTypeId: number;
};

export type ShieldDetail = {
  shieldRef: string;
  amountFormulaKey: string;
  durationFormulaKey?: string;
  valuePolicyTypeId: number;
};

export type ProviderDetail = {
  actionTypeId: number;
  targetProviderId: string;
  stacksFormulaKey?: string;
  durationFormulaKey?: string;
};

export type EventDetail = {
  eventTypeId: number;
  eventRef?: string;
  payload?: JsonObject;
};

export type AbilityControlDetail = {
  actionTypeId: number;
  targetAbilityId: string;
  amountFormulaKey?: string;
  valuePolicyTypeId?: number;
};

export type StateDetail = {
  stateScopeTypeId: number;
  stateKey: string;
  amountFormulaKey: string;
  valuePolicyTypeId: number;
};

export type RepeatDetail = {
  repeatScopeTypeId: number;
  repeatCount: number;
  repeatTag: string;
  triggerStateKey: string;
  threshold: number;
  /** Optional non-negative repeat delay (ms); omitted/missing is semantically 0. */
  delayMs?: number;
};

export type ExecuteDetail = {
  threshold: number;
};

export type ExecuteEffectDetail = CombatDataRowMeta & {
  stepId: string;
  threshold: number;
};

export type EffectStepCommon = CombatDataRowMeta & {
  stepId: string;
  sequenceId: string;
  stepOrder: number;
  operationTypeId: number;
  targetSelectorTypeId: number;
  conditionFormulaKey?: string;
};

export type EffectStep =
  | (EffectStepCommon & { damageDetail: DamageDetail } & Partial<Record<Exclude<EffectStepDetailKey, 'damageDetail'>, never>>)
  | (EffectStepCommon & { healDetail: HealDetail } & Partial<Record<Exclude<EffectStepDetailKey, 'healDetail'>, never>>)
  | (EffectStepCommon & { resourceDetail: ResourceDetail } & Partial<Record<Exclude<EffectStepDetailKey, 'resourceDetail'>, never>>)
  | (EffectStepCommon & { attributeDetail: AttributeDetail } & Partial<Record<Exclude<EffectStepDetailKey, 'attributeDetail'>, never>>)
  | (EffectStepCommon & { shieldDetail: ShieldDetail } & Partial<Record<Exclude<EffectStepDetailKey, 'shieldDetail'>, never>>)
  | (EffectStepCommon & { providerDetail: ProviderDetail } & Partial<Record<Exclude<EffectStepDetailKey, 'providerDetail'>, never>>)
  | (EffectStepCommon & { eventDetail: EventDetail } & Partial<Record<Exclude<EffectStepDetailKey, 'eventDetail'>, never>>)
  | (EffectStepCommon & {
      abilityControlDetail: AbilityControlDetail;
    } & Partial<Record<Exclude<EffectStepDetailKey, 'abilityControlDetail'>, never>>)
  | (EffectStepCommon & { stateDetail: StateDetail } & Partial<Record<Exclude<EffectStepDetailKey, 'stateDetail'>, never>>)
  | (EffectStepCommon & { repeatDetail: RepeatDetail } & Partial<Record<Exclude<EffectStepDetailKey, 'repeatDetail'>, never>>)
  | (EffectStepCommon & { executeDetail: ExecuteDetail } & Partial<Record<Exclude<EffectStepDetailKey, 'executeDetail'>, never>>);

export type EffectStepPutBody = {
  sequenceId: string;
  stepOrder: number;
  operationTypeId: number;
  targetSelectorTypeId: number;
  conditionFormulaKey?: string;
} & (
  | { damageDetail: DamageDetail }
  | { healDetail: HealDetail }
  | { resourceDetail: ResourceDetail }
  | { attributeDetail: AttributeDetail }
  | { shieldDetail: ShieldDetail }
  | { providerDetail: ProviderDetail }
  | { eventDetail: EventDetail }
  | { abilityControlDetail: AbilityControlDetail }
  | { stateDetail: StateDetail }
  | { repeatDetail: RepeatDetail }
  | { executeDetail: ExecuteDetail }
);

/** Admin PUT response = written row fields + top-level currentRevision. */
export type AdminWriteResponse<T> = T & {
  currentRevision: number;
};

/** Attribute stage entry for PUT entities/{entityId}:batch. */
export type EntityBatchAttributeStageInput = {
  stage: number;
  value: number;
};

/** Attribute entry for entity aggregate batch PUT. */
export type EntityBatchAttributeInput = {
  attrKey: string;
  baseValue: number;
  stages: EntityBatchAttributeStageInput[];
};

/** Resource stage entry for PUT entities/{entityId}:batch. */
export type EntityBatchResourceStageInput = {
  stage: number;
  initialValue: number;
  maxValue: number;
};

/** Resource entry for entity aggregate batch PUT. */
export type EntityBatchResourceInput = {
  resourceKey: string;
  initialValue: number;
  maxValue: number;
  stages: EntityBatchResourceStageInput[];
};

/** Provider mount entry for entity aggregate batch PUT (additive upsert). */
export type EntityBatchProviderMountInput = {
  providerId: string;
};

/**
 * Body for PUT /api/admin/games/{gameId}/combat-data/entities/{entityId}:batch.
 * Omitted attributes/resources/providerMounts are left untouched (no delete/replace).
 */
export type EntityBatchPutBody = {
  expectedCurrentRevision: number;
  displayName: string;
  description?: string;
  /**
   * Optional image association (same semantics as entity PUT).
   * Omitted preserves existing; null/blank clears; nonblank must exist in same-game images.
   * Entity Growth builders must omit this field unless a future page owns the binding editor.
   */
  imageUri?: string | null;
  attributes?: EntityBatchAttributeInput[];
  resources?: EntityBatchResourceInput[];
  providerMounts?: EntityBatchProviderMountInput[];
};

/** Nested attribute row returned by entity aggregate batch PUT. */
export type EntityBatchAttributeResult = EntityAttribute & {
  stages: EntityAttributeStage[];
};

/** Nested resource row returned by entity aggregate batch PUT. */
export type EntityBatchResourceResult = EntityResource & {
  stages: EntityResourceStage[];
};

/**
 * Authoritative entity aggregate from PUT entities/{entityId}:batch.
 * Includes top-level currentRevision (same revision for the whole write).
 */
export type EntityBatchWriteResult = AdminWriteResponse<{
  gameId: string;
  entityId: string;
  displayName: string;
  description?: string;
  imageUri?: string | null;
  changeRevision?: number;
  updatedAt?: string;
  attributes: EntityBatchAttributeResult[];
  resources: EntityBatchResourceResult[];
  providerMounts: EntityProviderMount[];
}>;

/** Ability node for PUT .../abilities/{abilityId}:direct-damage-setup. */
export type DirectDamageAbilitySetupAbilityInput = {
  abilityId: string;
  providerId: string;
  abilityKey: string;
  abilityKindTypeId: number;
  displayName: string;
  castConditionFormulaKey?: string;
  castOrigin?: AbilityCastOrigin | null;
};

/** Phase node for direct-damage ability aggregate PUT. */
export type DirectDamageAbilitySetupPhaseInput = {
  phaseId: string;
  abilityId: string;
  phaseOrder: number;
  phaseTypeId: number;
  durationFormulaKey?: string;
  interruptible: boolean;
};

/** Effect-sequence node for direct-damage ability aggregate PUT. */
export type DirectDamageAbilitySetupEffectSequenceInput = {
  sequenceId: string;
  providerId: string;
  sequenceKey: string;
  displayName: string;
};

/** Effect-step node (exactly damageDetail) for direct-damage ability aggregate PUT. */
export type DirectDamageAbilitySetupEffectStepInput = {
  stepId: string;
  sequenceId: string;
  stepOrder: number;
  operationTypeId: number;
  targetSelectorTypeId: number;
  conditionFormulaKey?: string;
  damageDetail: DamageDetail;
};

/** Phase ↔ effect-sequence binding for direct-damage ability aggregate PUT. */
export type DirectDamageAbilitySetupBindingInput = {
  phaseId: string;
  triggerTypeId: number;
  sequenceId: string;
};

/**
 * Body for PUT .../providers/{providerId}/abilities/{abilityId}:direct-damage-setup.
 * Exactly six top-level keys; all *TypeId fields are JSON integers.
 */
export type DirectDamageAbilitySetupPutBody = {
  expectedCurrentRevision: number;
  ability: DirectDamageAbilitySetupAbilityInput;
  phase: DirectDamageAbilitySetupPhaseInput;
  effectSequence: DirectDamageAbilitySetupEffectSequenceInput;
  effectStep: DirectDamageAbilitySetupEffectStepInput;
  phaseEffectSequenceBinding: DirectDamageAbilitySetupBindingInput;
};

/**
 * Authoritative aggregate from PUT .../abilities/{abilityId}:direct-damage-setup.
 * Includes top-level currentRevision (same revision for the whole write).
 */
export type DirectDamageAbilitySetupWriteResult = AdminWriteResponse<{
  gameId: string;
  providerId: string;
  abilityId: string;
  ability: DirectDamageAbilitySetupAbilityInput;
  phase: DirectDamageAbilitySetupPhaseInput;
  effectSequence: DirectDamageAbilitySetupEffectSequenceInput;
  effectStep: DirectDamageAbilitySetupEffectStepInput;
  phaseEffectSequenceBinding: DirectDamageAbilitySetupBindingInput;
}>;

/** Snapshot used by Web→Wasm assembly and revision-safe cache. */
export type CombatDataGraph = {
  gameId: string;
  currentRevision: number;
  state: CombatDataState;
  progressionSchema: ProgressionSchema | null;
  attributeDefinitions: AttributeDefinition[];
  resourceDefinitions: ResourceDefinition[];
  types: TypeDefinition[];
  typeRelations: TypeRelation[];
  entities: CombatEntity[];
  entityAttributes: EntityAttribute[];
  entityAttributeStages: EntityAttributeStage[];
  entityResources: EntityResource[];
  entityResourceStages: EntityResourceStage[];
  entityProviderMounts: EntityProviderMount[];
  providers: Provider[];
  providerLifecycles: ProviderLifecycle[];
  providerStateFields: ProviderStateField[];
  providerFormulas: ProviderFormula[];
  providerModifiers: ProviderModifier[];
  providerListeners: ProviderListener[];
  listenerMatchTypes: ListenerMatchType[];
  providerTickSequences: ProviderTickSequence[];
  abilities: Ability[];
  abilityParameters: AbilityParameter[];
  abilityStateFields: AbilityStateField[];
  abilityPhases: AbilityPhase[];
  abilityCosts: AbilityCost[];
  abilityCooldowns: AbilityCooldown[];
  effectSequences: EffectSequence[];
  effectSteps: EffectStep[];
  abilityPhaseEffectSequences: AbilityPhaseEffectSequence[];
  listenerEffectSequences: ListenerEffectSequence[];
  executeEffectDetails: ExecuteEffectDetail[];
};
