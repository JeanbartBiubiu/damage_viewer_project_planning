import type {
  CombatDataGraph,
  EffectStep,
  EffectStepDetailKey,
  Provider,
  ProviderFormula,
  ProviderLifecycle,
  ProviderListener,
  ProviderModifier
} from '../types/combatData';
import { EFFECT_STEP_DETAIL_KEYS } from '../types/combatData';
import type {
  AbilityDefinition,
  AttributeSlot,
  CombatantDefinition,
  CombatantProviderMount,
  CombatantSnapshot,
  CompileRequest,
  DriverPlan,
  EmptyP0Rules,
  GenericFormulaExpr,
  InitialSnapshot,
  ListenerDefinition,
  ModifierDefinition,
  NamedFormula,
  OperationDefinition,
  ProviderDefinition,
  ResourceSlot,
  RunRequest,
  SafetyBudget,
  SamplingConfig,
  StopPolicy,
  TypeCatalog
} from '../types/genericEngine';
import {
  DEFAULT_CONDITION_RECHECK_INTERVAL_MS,
  DEFAULT_SAMPLING,
  DEFAULT_STOP_POLICY
} from '../types/genericEngine';
import type { GenericAbilityOption } from '../types/genericEngine';

export type CombatantSlot = 'source' | 'target';

export type CombatDataAssembleSelection = {
  sourceEntityId: string;
  targetEntityId: string;
  sourceStage?: number;
  targetStage?: number;
};

export type CombatantNumericOverrides = {
  attributes?: Record<string, { base?: number; current?: number; max?: number }>;
  resources?: Record<string, { current?: number; max?: number }>;
};

export type CombatDataAssembleOverrides = {
  source?: CombatantNumericOverrides;
  target?: CombatantNumericOverrides;
  schemaVersion?: string;
  schemaHash?: string;
  rulesHash?: string;
};

export type MaterializedCombatScenario = {
  compileRequest: CompileRequest;
  initialSnapshot: InitialSnapshot;
  availableSourceAbilities: GenericAbilityOption[];
  sessionSignature: string;
};

export type AssembleCombatRunRequestInput = {
  sessionId: string;
  materialized: MaterializedCombatScenario;
  driverPlan: DriverPlan;
  stopPolicy?: Partial<StopPolicy>;
  sampling?: Partial<SamplingConfig>;
  safetyBudget?: SafetyBudget;
};

export class CombatDataAssembleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CombatDataAssembleError';
  }
}

/** TinyGo V2 generic ABI CompileRequest.schemaVersion（见 wasm model.GenericSchemaVersion）。 */
export const DEFAULT_GENERIC_SCHEMA_VERSION = 'generic-p0';

const EMPTY_P0_RULES: EmptyP0Rules = {
  operations: [],
  modifiers: [],
  listeners: [],
  triggerRules: []
};

const DETAIL_KEYS = EFFECT_STEP_DETAIL_KEYS as readonly EffectStepDetailKey[];

type TypeIndex = {
  byId: Map<number, { typeKey: string; reservedTypeId?: number }>;
  byKey: Map<string, { typeId: number; reservedTypeId?: number }>;
};

type GraphIndexes = {
  types: TypeIndex;
  providersById: Map<string, Provider>;
  formulasByProvider: Map<string, ProviderFormula[]>;
  modifiersByProvider: Map<string, ProviderModifier[]>;
  listenersByProvider: Map<string, ProviderListener[]>;
  lifecyclesByProvider: Map<string, ProviderLifecycle>;
  matchTypesByListener: Map<string, Array<{ matchModeTypeId: number; typeId: number }>>;
  tickSequenceIdsByProvider: Map<string, string[]>;
  stepsBySequence: Map<string, EffectStep[]>;
  phaseSeqByPhase: Map<string, string[]>;
  listenerSeqByListener: Map<string, string[]>;
  abilitiesByProvider: Map<string, CombatDataGraph['abilities']>;
  phasesByAbility: Map<string, CombatDataGraph['abilityPhases']>;
  costsByAbility: Map<string, CombatDataGraph['abilityCosts']>;
  cooldownsByAbility: Map<string, CombatDataGraph['abilityCooldowns']>;
  paramsByAbility: Map<string, CombatDataGraph['abilityParameters']>;
  abilitiesById: Map<string, CombatDataGraph['abilities'][number]>;
  stateFieldsByProvider: Map<string, CombatDataGraph['providerStateFields']>;
};

export function assembleCompileRequest(
  graph: CombatDataGraph,
  selection: CombatDataAssembleSelection,
  overrides: CombatDataAssembleOverrides = {}
): CompileRequest {
  const sourceEntity = findEntity(graph, selection.sourceEntityId);
  const targetEntity = findEntity(graph, selection.targetEntityId);
  const indexes = buildIndexes(graph);
  const typeCatalog = buildTypeCatalog(graph, indexes.types);

  const sourceMountIds = graph.entityProviderMounts
    .filter((m) => m.entityId === sourceEntity.entityId)
    .map((m) => m.providerId);
  const targetMountIds = graph.entityProviderMounts
    .filter((m) => m.entityId === targetEntity.entityId)
    .map((m) => m.providerId);
  const providerIds = unique([...sourceMountIds, ...targetMountIds]);

  const sharedProviders: ProviderDefinition[] = [];
  const formulas: NamedFormula[] = [];

  for (const providerId of providerIds) {
    for (const slot of ['source', 'target'] as CombatantSlot[]) {
      const { provider, formulas: slotFormulas } = cloneProviderForSlot(
        graph,
        indexes,
        providerId,
        slot
      );
      sharedProviders.push(provider);
      formulas.push(...slotFormulas);
    }
  }

  const sourceCombatant = buildCombatant(
    graph,
    indexes,
    sourceEntity,
    'source',
    selection.sourceStage,
    overrides.source,
    sourceMountIds
  );
  const targetCombatant = buildCombatant(
    graph,
    indexes,
    targetEntity,
    'target',
    selection.targetStage,
    overrides.target,
    targetMountIds
  );

  const revisionTag = `rev:${graph.currentRevision}`;
  return {
    schemaVersion: overrides.schemaVersion ?? DEFAULT_GENERIC_SCHEMA_VERSION,
    schemaHash: overrides.schemaHash ?? revisionTag,
    rulesHash: overrides.rulesHash ?? revisionTag,
    typeCatalog,
    combatants: [sourceCombatant, targetCombatant],
    sharedProviders,
    rules: deepClone(EMPTY_P0_RULES),
    formulas,
    settings: {}
  };
}

export function assembleCombatScenario(
  graph: CombatDataGraph,
  selection: CombatDataAssembleSelection,
  overrides: CombatDataAssembleOverrides = {}
): MaterializedCombatScenario {
  const compileRequest = assembleCompileRequest(graph, selection, overrides);
  const [sourceCombatant, targetCombatant] = compileRequest.combatants;
  const initialSnapshot = buildInitialSnapshot(compileRequest, sourceCombatant, targetCombatant);
  const availableSourceAbilities = listAvailableSourceAbilities(
    sourceCombatant,
    compileRequest.sharedProviders ?? []
  );
  return {
    compileRequest,
    initialSnapshot,
    availableSourceAbilities,
    sessionSignature: computeSessionSignature(compileRequest)
  };
}

export function assembleRunRequest(input: AssembleCombatRunRequestInput): RunRequest {
  const { compileRequest, initialSnapshot } = input.materialized;
  const stopPolicy: StopPolicy = {
    durationMs: input.stopPolicy?.durationMs ?? DEFAULT_STOP_POLICY.durationMs,
    stopOnTargetDeath: input.stopPolicy?.stopOnTargetDeath ?? DEFAULT_STOP_POLICY.stopOnTargetDeath,
    stopWhenNoEvents: input.stopPolicy?.stopWhenNoEvents ?? DEFAULT_STOP_POLICY.stopWhenNoEvents
  };
  assertFinitePositive(stopPolicy.durationMs, 'stopPolicy.durationMs');

  const sampling: SamplingConfig = {
    sampleEveryMs: input.sampling?.sampleEveryMs ?? DEFAULT_SAMPLING.sampleEveryMs,
    dpsWindowMs: input.sampling?.dpsWindowMs ?? DEFAULT_SAMPLING.dpsWindowMs,
    maxSeriesPoints: input.sampling?.maxSeriesPoints ?? DEFAULT_SAMPLING.maxSeriesPoints
  };

  const request: RunRequest = {
    sessionId: input.sessionId,
    expectedRulesHash: compileRequest.rulesHash,
    schemaVersion: compileRequest.schemaVersion,
    schemaHash: compileRequest.schemaHash,
    rulesHash: compileRequest.rulesHash,
    initialSnapshot: {
      ...deepClone(initialSnapshot),
      schemaHash: compileRequest.schemaHash,
      rulesHash: compileRequest.rulesHash
    },
    driverPlan: normalizeDriverPlan(input.driverPlan),
    stopPolicy,
    sampling
  };

  if (input.safetyBudget) {
    request.safetyBudget = pickSafetyBudget(input.safetyBudget);
  }

  return request;
}

export function listAvailableSourceAbilities(
  sourceCombatant: CombatantDefinition,
  sharedProviders: ProviderDefinition[]
): GenericAbilityOption[] {
  const providerByKey = new Map(sharedProviders.map((p) => [p.providerKey, p]));
  const options: GenericAbilityOption[] = [];

  for (const mount of sourceCombatant.providers) {
    const provider = providerByKey.get(mount.definitionRef);
    if (!provider) {
      continue;
    }
    for (const ability of provider.abilities ?? []) {
      options.push({
        abilityKey: ability.abilityKey,
        abilityRef: `source.provider[${mount.providerRef}].ability[${ability.abilityKey}]`,
        providerRef: mount.providerRef,
        definitionRef: mount.definitionRef,
        providerKey: stripSlotPrefix(mount.definitionRef),
        displayName: `${mount.providerRef} / ${ability.abilityKey}`,
        kind: ability.kind,
        selectable: ability.kind === 'active'
      });
    }
  }

  return options;
}

export function computeSessionSignature(compileRequest: CompileRequest): string {
  return stableStringify(compileRequest);
}

export function normalizeDriverPlan(plan: DriverPlan): DriverPlan {
  const conditionRecheckIntervalMs =
    plan.conditionRecheckIntervalMs ?? DEFAULT_CONDITION_RECHECK_INTERVAL_MS;
  if (
    !Number.isFinite(conditionRecheckIntervalMs) ||
    conditionRecheckIntervalMs < 10 ||
    conditionRecheckIntervalMs > 1000
  ) {
    throw new CombatDataAssembleError(
      'driverPlan.conditionRecheckIntervalMs must be a finite number in 10..1000'
    );
  }

  const entries = plan.entries.map((entry) => {
    if (!entry.abilityRef || !entry.entryKey) {
      throw new CombatDataAssembleError('driverPlan entries require entryKey and abilityRef');
    }
    if (entry.source !== 'source' || entry.target !== 'target') {
      throw new CombatDataAssembleError('P0 driverPlan entries must use source="source" and target="target"');
    }
    const normalized = {
      entryKey: entry.entryKey,
      abilityRef: entry.abilityRef,
      source: 'source' as const,
      target: 'target' as const,
      priority: entry.priority ?? 0,
      firstAtMs: entry.firstAtMs,
      ...(entry.repeat ? { repeat: { ...entry.repeat } } : {}),
      ...(entry.whileReady !== undefined ? { whileReady: entry.whileReady } : {}),
      ...(entry.condition ? { condition: deepClone(entry.condition) } : {})
    };
    return normalized;
  });

  return { conditionRecheckIntervalMs, entries };
}

function findEntity(graph: CombatDataGraph, entityId: string) {
  const entity = graph.entities.find((item) => item.entityId === entityId);
  if (!entity) {
    throw new CombatDataAssembleError(`entity not found: ${entityId}`);
  }
  return entity;
}

function buildIndexes(graph: CombatDataGraph): GraphIndexes {
  const types: TypeIndex = { byId: new Map(), byKey: new Map() };
  for (const t of graph.types) {
    types.byId.set(t.typeId, { typeKey: t.typeKey, reservedTypeId: t.reservedTypeId });
    types.byKey.set(t.typeKey, { typeId: t.typeId, reservedTypeId: t.reservedTypeId });
  }

  const providersById = new Map(graph.providers.map((p) => [p.providerId, p]));
  const formulasByProvider = groupBy(graph.providerFormulas, (f) => f.providerId);
  const modifiersByProvider = groupBy(graph.providerModifiers, (m) => m.providerId);
  const listenersByProvider = groupBy(graph.providerListeners, (l) => l.providerId);
  const lifecyclesByProvider = new Map(graph.providerLifecycles.map((l) => [l.providerId, l]));
  const matchTypesByListener = groupBy(graph.listenerMatchTypes, (m) => m.listenerId);
  const tickSequenceIdsByProvider = groupBy(
    graph.providerTickSequences,
    (t) => t.providerId,
    (t) => t.sequenceId
  );

  const stepsBySequence = new Map<string, EffectStep[]>();
  for (const step of graph.effectSteps) {
    const list = stepsBySequence.get(step.sequenceId) ?? [];
    list.push(step);
    stepsBySequence.set(step.sequenceId, list);
  }
  for (const [, steps] of stepsBySequence) {
    steps.sort((a, b) => a.stepOrder - b.stepOrder);
  }

  const phaseSeqByPhase = groupBy(
    graph.abilityPhaseEffectSequences,
    (r) => r.phaseId,
    (r) => r.sequenceId
  );
  const listenerSeqByListener = groupBy(
    graph.listenerEffectSequences,
    (r) => r.listenerId,
    (r) => r.sequenceId
  );
  const abilitiesByProvider = groupBy(graph.abilities, (a) => a.providerId);
  const phasesByAbility = groupBy(graph.abilityPhases, (p) => p.abilityId);
  const costsByAbility = groupBy(graph.abilityCosts, (c) => c.abilityId);
  const cooldownsByAbility = groupBy(graph.abilityCooldowns, (c) => c.abilityId);
  const paramsByAbility = groupBy(graph.abilityParameters, (p) => p.abilityId);
  const abilitiesById = new Map(graph.abilities.map((a) => [a.abilityId, a]));
  const stateFieldsByProvider = groupBy(graph.providerStateFields, (s) => s.providerId);

  return {
    types,
    providersById,
    formulasByProvider,
    modifiersByProvider,
    listenersByProvider,
    lifecyclesByProvider,
    matchTypesByListener,
    tickSequenceIdsByProvider,
    stepsBySequence,
    phaseSeqByPhase,
    listenerSeqByListener,
    abilitiesByProvider,
    phasesByAbility,
    costsByAbility,
    cooldownsByAbility,
    paramsByAbility,
    abilitiesById,
    stateFieldsByProvider
  };
}

function buildTypeCatalog(graph: CombatDataGraph, types: TypeIndex): TypeCatalog {
  const catalogTypes = graph.types.map((t) => ({
    key: t.typeKey,
    domain: domainFromTypeKey(t.typeKey)
  }));

  const relations: Array<{ parent: string; child: string }> = [];
  for (const rel of graph.typeRelations) {
    if (rel.targetCategory !== 'type') {
      continue;
    }
    const parentKey = requireTypeKey(types, rel.typeId, `typeRelations.parent typeId=${rel.typeId}`);
    const childTypeId = Number(rel.targetId);
    if (!Number.isFinite(childTypeId)) {
      throw new CombatDataAssembleError(
        `typeRelations targetId must be numeric type id when targetCategory=type, got: ${rel.targetId}`
      );
    }
    const childKey = requireTypeKey(types, childTypeId, `typeRelations.child typeId=${childTypeId}`);
    relations.push({ parent: parentKey, child: childKey });
  }

  return { types: catalogTypes, relations };
}

/**
 * ABI: domain must equal typeKey.split('/', 1)[0].
 * Do not invent reserved/game domains from reservedTypeId.
 */
export function domainFromTypeKey(typeKey: string): string {
  const slash = typeKey.indexOf('/');
  if (slash <= 0 || slash === typeKey.length - 1) {
    throw new CombatDataAssembleError(
      `typeKey must be "domain/name" with a non-empty domain prefix, got: ${JSON.stringify(typeKey)}`
    );
  }
  return typeKey.slice(0, slash);
}

function buildCombatant(
  graph: CombatDataGraph,
  indexes: GraphIndexes,
  entity: CombatDataGraph['entities'][number],
  slot: CombatantSlot,
  stage: number | undefined,
  overrides: CombatantNumericOverrides | undefined,
  mountProviderIds: string[]
): CombatantDefinition {
  const types = resolveEntityTypeKeys(graph, indexes.types, entity.entityId);
  const attributes = buildAttributeSlots(graph, entity.entityId, stage);
  const resources = buildResourceSlots(graph, entity.entityId, stage);
  applyAttributeOverrides(attributes, overrides?.attributes);
  applyResourceOverrides(resources, overrides?.resources);

  const providers: CombatantProviderMount[] = mountProviderIds.map((providerId) => {
    const provider = indexes.providersById.get(providerId);
    if (!provider) {
      throw new CombatDataAssembleError(`mounted provider not found: ${providerId}`);
    }
    const kindKey = requireTypeKey(
      indexes.types,
      provider.providerKindTypeId,
      `provider ${providerId} kind`
    );
    const kindToken = abiToken(kindKey);
    return {
      providerRef: `${kindToken}:${providerId}`,
      definitionRef: namespacedProviderKey(slot, providerId)
    };
  });

  return {
    key: slot,
    displayName: entity.displayName,
    types,
    attributes,
    resources,
    providers
  };
}

function resolveEntityTypeKeys(
  graph: CombatDataGraph,
  types: TypeIndex,
  entityId: string
): string[] {
  const keys: string[] = [];
  for (const rel of graph.typeRelations) {
    if (rel.targetCategory !== 'entity' || rel.targetId !== entityId) {
      continue;
    }
    keys.push(requireTypeKey(types, rel.typeId, `entity ${entityId} type`));
  }
  return keys;
}

function buildAttributeSlots(
  graph: CombatDataGraph,
  entityId: string,
  stage: number | undefined
): Record<string, AttributeSlot> {
  const slots: Record<string, AttributeSlot> = {};
  for (const row of graph.entityAttributes) {
    if (row.entityId !== entityId) {
      continue;
    }
    let value = row.baseValue;
    if (stage !== undefined) {
      const stageRow = graph.entityAttributeStages.find(
        (s) => s.entityId === entityId && s.attrKey === row.attrKey && s.stage === stage
      );
      if (stageRow) {
        value = stageRow.value;
      }
    }
    slots[row.attrKey] = { base: value, current: value, max: value, resolved: value };
  }
  return slots;
}

function buildResourceSlots(
  graph: CombatDataGraph,
  entityId: string,
  stage: number | undefined
): Record<string, ResourceSlot> {
  const slots: Record<string, ResourceSlot> = {};
  for (const row of graph.entityResources) {
    if (row.entityId !== entityId) {
      continue;
    }
    let current = row.initialValue;
    let max = row.maxValue;
    if (stage !== undefined) {
      const stageRow = graph.entityResourceStages.find(
        (s) => s.entityId === entityId && s.resourceKey === row.resourceKey && s.stage === stage
      );
      if (stageRow) {
        current = stageRow.initialValue;
        max = stageRow.maxValue;
      }
    }
    slots[row.resourceKey] = { current, max };
  }
  return slots;
}

function cloneProviderForSlot(
  _graph: CombatDataGraph,
  indexes: GraphIndexes,
  providerId: string,
  slot: CombatantSlot
): { provider: ProviderDefinition; formulas: NamedFormula[] } {
  const raw = indexes.providersById.get(providerId);
  if (!raw) {
    throw new CombatDataAssembleError(`provider not found: ${providerId}`);
  }

  const kindKey = requireTypeKey(indexes.types, raw.providerKindTypeId, `provider ${providerId} kind`);
  const kindToken = abiToken(kindKey);
  const providerRef = `${kindToken}:${providerId}`;
  const namespacedKey = namespacedProviderKey(slot, providerId);

  const formulas: NamedFormula[] = [];
  for (const formula of indexes.formulasByProvider.get(providerId) ?? []) {
    const key = namespacedFormulaKey(slot, formula.formulaKey);
    formulas.push({
      key,
      expression: rewriteFormulaExpr(asFormulaExpr(formula.expression), slot)
    });
  }

  const modifiers = (indexes.modifiersByProvider.get(providerId) ?? []).map((mod) =>
    mapModifier(mod, indexes, slot)
  );

  const abilities = (indexes.abilitiesByProvider.get(providerId) ?? []).map((ability) =>
    mapAbility(ability, indexes, slot)
  );

  const listeners = (indexes.listenersByProvider.get(providerId) ?? []).map((listener) =>
    mapListener(listener, indexes, slot, providerRef)
  );

  const lifecycle = mapLifecycle(indexes.lifecyclesByProvider.get(providerId), indexes, slot);
  const tickOps = collectTickOperations(indexes, providerId, slot);
  if (tickOps.length > 0) {
    const intervalMs = lifecycle?.tickIntervalMs;
    if (intervalMs === undefined || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new CombatDataAssembleError(
        `provider ${providerId} has tick sequences but missing positive tickIntervalMs`
      );
    }
    const startDelayMs = indexes.lifecyclesByProvider.get(providerId)?.startDelayMs;
    abilities.push({
      abilityKey: '__tick__',
      kind: 'tick',
      tickSpec: {
        intervalMs,
        onTick: tickOps,
        ...(startDelayMs !== undefined ? { startDelayMs } : {})
      }
    });
  }

  const stateFields = indexes.stateFieldsByProvider.get(providerId) ?? [];
  const initialStateSchema =
    stateFields.length > 0
      ? Object.fromEntries(
          stateFields.map((field) => [
            field.stateKey,
            { valueType: abiToken(requireTypeKey(indexes.types, field.valueTypeId, `state ${field.stateKey}`)) }
          ])
        )
      : undefined;

  const provider: ProviderDefinition = {
    providerKey: namespacedKey,
    kind: kindToken,
    stableId: providerId,
    abilities,
    modifiers,
    listeners,
    ...(lifecycle ? { lifecycle } : {}),
    ...(initialStateSchema ? { initialStateSchema } : {})
  };

  return { provider, formulas };
}

function mapModifier(
  mod: ProviderModifier,
  indexes: GraphIndexes,
  slot: CombatantSlot
): ModifierDefinition {
  const selectorKey = requireTypeKey(
    indexes.types,
    mod.targetSelectorTypeId,
    `modifier ${mod.modifierKey} targetSelector`
  );
  const selectorToken = abiToken(selectorKey);
  const ownerPath = selectorToOwnerPath(selectorToken);
  const target = rewriteOwnerOpponentPath(`${ownerPath}.attr.${mod.targetAttrKey}`, slot);

  const valuePolicy = abiToken(
    requireTypeKey(indexes.types, mod.valuePolicyTypeId, `modifier ${mod.modifierKey} valuePolicy`)
  );
  const kind = mod.modifierTypeId
    ? abiToken(requireTypeKey(indexes.types, mod.modifierTypeId, `modifier ${mod.modifierKey} kind`))
    : 'attribute';

  const result: ModifierDefinition = {
    modifierKey: mod.modifierKey,
    kind,
    target,
    priority: mod.priority,
    valuePolicy,
    value: formulaRef(slot, mod.valueFormulaKey)
  };

  if (mod.commandTypeId !== undefined) {
    result.command = abiToken(
      requireTypeKey(indexes.types, mod.commandTypeId, `modifier ${mod.modifierKey} command`)
    );
  }
  if (mod.channelTypeId !== undefined) {
    result.channel = abiToken(
      requireTypeKey(indexes.types, mod.channelTypeId, `modifier ${mod.modifierKey} channel`)
    );
  }
  if (mod.bucketTypeId !== undefined) {
    result.bucket = abiToken(
      requireTypeKey(indexes.types, mod.bucketTypeId, `modifier ${mod.modifierKey} bucket`)
    );
  }
  if (mod.stageTypeId !== undefined) {
    result.stage = abiToken(
      requireTypeKey(indexes.types, mod.stageTypeId, `modifier ${mod.modifierKey} stage`)
    );
  }
  if (mod.conditionFormulaKey) {
    result.condition = formulaRef(slot, mod.conditionFormulaKey);
  }

  return result;
}

function mapAbility(
  ability: CombatDataGraph['abilities'][number],
  indexes: GraphIndexes,
  slot: CombatantSlot
): AbilityDefinition {
  const kindKey = requireTypeKey(
    indexes.types,
    ability.abilityKindTypeId,
    `ability ${ability.abilityId} kind`
  );
  const kind = mapAbilityKind(abiToken(kindKey));

  const phases = [...(indexes.phasesByAbility.get(ability.abilityId) ?? [])].sort(
    (a, b) => a.phaseOrder - b.phaseOrder
  );
  const operations: OperationDefinition[] = [];
  for (const phase of phases) {
    const sequenceIds = indexes.phaseSeqByPhase.get(phase.phaseId) ?? [];
    for (const sequenceId of sequenceIds) {
      operations.push(...mapSequenceOperations(indexes, sequenceId, slot));
    }
  }

  const paramsRows = indexes.paramsByAbility.get(ability.abilityId) ?? [];
  const params =
    paramsRows.length > 0
      ? Object.fromEntries(paramsRows.map((p) => [p.paramKey, p.numericValue]))
      : undefined;

  const costRow = (indexes.costsByAbility.get(ability.abilityId) ?? [])[0];
  const cooldownRow = (indexes.cooldownsByAbility.get(ability.abilityId) ?? [])[0];

  const result: AbilityDefinition = {
    abilityKey: ability.abilityKey,
    kind,
    ...(params ? { params } : {}),
    ...(operations.length > 0 ? { operations } : {})
  };

  if (costRow) {
    result.cost = {
      resourceKey: costRow.resourceKey,
      amount: formulaRef(slot, costRow.amountFormulaKey),
      allowPartial: costRow.allowPartial
    };
  }
  if (cooldownRow) {
    result.cooldown = {
      durationMs: formulaRef(slot, cooldownRow.durationFormulaKey),
      ...(cooldownRow.groupKey ? { groupKey: cooldownRow.groupKey } : {}),
      ...(cooldownRow.startsOnPhaseId
        ? {
            startsOn: resolvePhaseStartsOn(
              indexes,
              ability.abilityId,
              cooldownRow.startsOnPhaseId
            )
          }
        : {})
    };
  }

  return result;
}

function resolvePhaseStartsOn(
  indexes: GraphIndexes,
  abilityId: string,
  phaseId: string
): string {
  const phase = (indexes.phasesByAbility.get(abilityId) ?? []).find((p) => p.phaseId === phaseId);
  if (!phase) {
    return phaseId;
  }
  return abiToken(
    requireTypeKey(indexes.types, phase.phaseTypeId, `phase ${phaseId} type`)
  );
}

function mapListener(
  listener: ProviderListener,
  indexes: GraphIndexes,
  slot: CombatantSlot,
  providerRef: string
): ListenerDefinition {
  const eventMatcher: ListenerDefinition['eventMatcher'] = {};
  const matchRows = indexes.matchTypesByListener.get(listener.listenerId) ?? [];
  for (const row of matchRows) {
    const modeKey = requireTypeKey(
      indexes.types,
      row.matchModeTypeId,
      `listener ${listener.listenerKey} matchMode`
    );
    const mode = abiToken(modeKey);
    if (mode !== 'any' && mode !== 'all' && mode !== 'none') {
      throw new CombatDataAssembleError(
        `listener ${listener.listenerKey} matchMode must resolve to any|all|none, got: ${modeKey}`
      );
    }
    const typeKey = requireTypeKey(
      indexes.types,
      row.typeId,
      `listener ${listener.listenerKey} match type`
    );
    const bucket = eventMatcher[mode] ?? [];
    bucket.push(typeKey);
    eventMatcher[mode] = bucket;
  }

  if (Object.keys(eventMatcher).length === 0) {
    const eventTypeKey = requireTypeKey(
      indexes.types,
      listener.eventTypeId,
      `listener ${listener.listenerKey} eventType`
    );
    eventMatcher.any = [eventTypeKey];
  }

  const operations: OperationDefinition[] = [];
  for (const sequenceId of indexes.listenerSeqByListener.get(listener.listenerId) ?? []) {
    operations.push(...mapSequenceOperations(indexes, sequenceId, slot));
  }

  let abilityRef: string | undefined;
  if (listener.abilityId) {
    const ability = indexes.abilitiesById.get(listener.abilityId);
    if (!ability) {
      throw new CombatDataAssembleError(
        `listener ${listener.listenerKey} ability not found: ${listener.abilityId}`
      );
    }
    abilityRef = `${slot}.provider[${providerRef}].ability[${ability.abilityKey}]`;
  }

  return {
    listenerKey: listener.listenerKey,
    eventMatcher,
    ...(abilityRef ? { abilityRef } : {}),
    ...(operations.length > 0 ? { operations } : {}),
    ...(listener.maxTriggersPerEvent !== undefined
      ? { maxTriggersPerEvent: listener.maxTriggersPerEvent }
      : {}),
    ...(listener.chainLimitKey ? { chainLimitKey: listener.chainLimitKey } : {})
  };
}

function mapLifecycle(
  lifecycle: ProviderLifecycle | undefined,
  indexes: GraphIndexes,
  slot: CombatantSlot
): ProviderDefinition['lifecycle'] | undefined {
  if (!lifecycle) {
    return undefined;
  }
  const result: NonNullable<ProviderDefinition['lifecycle']> = {
    maxStacks: lifecycle.maxStacks
  };
  if (lifecycle.durationFormulaKey) {
    result.durationMs = formulaRef(slot, lifecycle.durationFormulaKey);
  }
  if (lifecycle.refreshPolicyTypeId !== undefined) {
    result.refreshPolicy = abiToken(
      requireTypeKey(
        indexes.types,
        lifecycle.refreshPolicyTypeId,
        `provider ${lifecycle.providerId} refreshPolicy`
      )
    );
  }
  if (lifecycle.tickIntervalMs !== undefined) {
    result.tickIntervalMs = lifecycle.tickIntervalMs;
  }
  return result;
}

function collectTickOperations(
  indexes: GraphIndexes,
  providerId: string,
  slot: CombatantSlot
): OperationDefinition[] {
  const ops: OperationDefinition[] = [];
  for (const sequenceId of indexes.tickSequenceIdsByProvider.get(providerId) ?? []) {
    ops.push(...mapSequenceOperations(indexes, sequenceId, slot));
  }
  return ops;
}

function mapSequenceOperations(
  indexes: GraphIndexes,
  sequenceId: string,
  slot: CombatantSlot
): OperationDefinition[] {
  const steps = indexes.stepsBySequence.get(sequenceId) ?? [];
  return steps.map((step) => mapEffectStep(step, indexes, slot));
}

function mapEffectStep(
  step: EffectStep,
  indexes: GraphIndexes,
  slot: CombatantSlot
): OperationDefinition {
  const operationKey = requireTypeKey(
    indexes.types,
    step.operationTypeId,
    `effect step ${step.stepId} operation`
  );
  const targetKey = requireTypeKey(
    indexes.types,
    step.targetSelectorTypeId,
    `effect step ${step.stepId} target`
  );
  const operation = abiToken(operationKey);
  const target = abiToken(targetKey);

  const detailKey = detectDetailKey(step);
  const base: OperationDefinition = {
    operation,
    target,
    ...(step.conditionFormulaKey
      ? { condition: formulaRef(slot, step.conditionFormulaKey) }
      : {})
  };

  switch (detailKey) {
    case 'damageDetail': {
      const d = step.damageDetail!;
      return {
        ...base,
        amount: formulaRef(slot, d.amountFormulaKey),
        damageType: requireTypeKey(indexes.types, d.damageTypeId, `step ${step.stepId} damageType`),
        valuePolicy: abiToken(
          requireTypeKey(indexes.types, d.valuePolicyTypeId, `step ${step.stepId} valuePolicy`)
        )
      };
    }
    case 'healDetail': {
      const d = step.healDetail!;
      return {
        ...base,
        amount: formulaRef(slot, d.amountFormulaKey),
        valuePolicy: abiToken(
          requireTypeKey(indexes.types, d.valuePolicyTypeId, `step ${step.stepId} valuePolicy`)
        )
      };
    }
    case 'resourceDetail': {
      const d = step.resourceDetail!;
      return {
        ...base,
        resourceKey: d.resourceKey,
        amount: formulaRef(slot, d.amountFormulaKey),
        valuePolicy: abiToken(
          requireTypeKey(indexes.types, d.valuePolicyTypeId, `step ${step.stepId} valuePolicy`)
        )
      };
    }
    case 'attributeDetail': {
      const d = step.attributeDetail!;
      return {
        ...base,
        attributeKey: d.attrKey,
        amount: formulaRef(slot, d.amountFormulaKey),
        valuePolicy: abiToken(
          requireTypeKey(indexes.types, d.valuePolicyTypeId, `step ${step.stepId} valuePolicy`)
        )
      };
    }
    case 'shieldDetail': {
      const d = step.shieldDetail!;
      return {
        ...base,
        shieldRef: d.shieldRef,
        amount: formulaRef(slot, d.amountFormulaKey),
        valuePolicy: abiToken(
          requireTypeKey(indexes.types, d.valuePolicyTypeId, `step ${step.stepId} valuePolicy`)
        )
      };
    }
    case 'providerDetail': {
      const d = step.providerDetail!;
      return mapProviderDetailOperation(base, d, indexes, slot, step.stepId);
    }
    case 'eventDetail': {
      const d = step.eventDetail!;
      return {
        ...base,
        eventType: requireTypeKey(indexes.types, d.eventTypeId, `step ${step.stepId} eventType`),
        ...(d.eventRef ? { ref: d.eventRef } : {}),
        ...(d.payload ? { payload: deepClone(d.payload) } : {})
      };
    }
    case 'abilityControlDetail': {
      const d = step.abilityControlDetail!;
      const targetAbility = indexes.abilitiesById.get(d.targetAbilityId);
      if (!targetAbility) {
        throw new CombatDataAssembleError(
          `effect step ${step.stepId} abilityControl targetAbility not found: ${d.targetAbilityId}`
        );
      }
      const targetProvider = indexes.providersById.get(targetAbility.providerId);
      if (!targetProvider) {
        throw new CombatDataAssembleError(
          `effect step ${step.stepId} abilityControl provider not found: ${targetAbility.providerId}`
        );
      }
      const kindToken = abiToken(
        requireTypeKey(
          indexes.types,
          targetProvider.providerKindTypeId,
          `abilityControl provider kind`
        )
      );
      const abilityProviderRef = `${kindToken}:${targetAbility.providerId}`;
      const result: OperationDefinition = {
        ...base,
        abilityRef: `${slot}.provider[${abilityProviderRef}].ability[${targetAbility.abilityKey}]`
      };
      if (d.amountFormulaKey) {
        result.amount = formulaRef(slot, d.amountFormulaKey);
      }
      if (d.valuePolicyTypeId !== undefined) {
        result.valuePolicy = abiToken(
          requireTypeKey(indexes.types, d.valuePolicyTypeId, `step ${step.stepId} valuePolicy`)
        );
      }
      return result;
    }
    case 'stateDetail': {
      const d = step.stateDetail!;
      return {
        ...base,
        amount: formulaRef(slot, d.amountFormulaKey),
        valuePolicy: abiToken(
          requireTypeKey(indexes.types, d.valuePolicyTypeId, `step ${step.stepId} valuePolicy`)
        ),
        ref: d.stateKey,
        types: [
          requireTypeKey(indexes.types, d.stateScopeTypeId, `step ${step.stepId} stateScope`)
        ]
      };
    }
    default:
      throw new CombatDataAssembleError(
        `effect step ${step.stepId} missing recognized detail key`
      );
  }
}

function mapProviderDetailOperation(
  base: OperationDefinition,
  detail: NonNullable<EffectStep['providerDetail']>,
  indexes: GraphIndexes,
  slot: CombatantSlot,
  stepId: string
): OperationDefinition {
  const actionKey = requireTypeKey(
    indexes.types,
    detail.actionTypeId,
    `step ${stepId} provider action`
  );
  const action = abiToken(actionKey);
  const namespacedDef = namespacedProviderKey(slot, detail.targetProviderId);

  if (action === 'apply' || base.operation === 'apply_provider') {
    return {
      ...base,
      operation: 'apply_provider',
      providerDefinitionRef: mapApplyProviderDefinitionRef(namespacedDef, slot, base.target),
      ...(detail.stacksFormulaKey ? { amount: formulaRef(slot, detail.stacksFormulaKey) } : {})
    };
  }
  if (action === 'refresh' || base.operation === 'refresh_provider') {
    const targetProvider = indexes.providersById.get(detail.targetProviderId);
    if (!targetProvider) {
      throw new CombatDataAssembleError(
        `step ${stepId} refresh target provider not found: ${detail.targetProviderId}`
      );
    }
    const kindToken = abiToken(
      requireTypeKey(indexes.types, targetProvider.providerKindTypeId, `refresh provider kind`)
    );
    return {
      ...base,
      operation: 'refresh_provider',
      providerRef: `${kindToken}:${detail.targetProviderId}`
    };
  }
  if (action === 'expire' || base.operation === 'expire_provider') {
    const targetProvider = indexes.providersById.get(detail.targetProviderId);
    if (!targetProvider) {
      throw new CombatDataAssembleError(
        `step ${stepId} expire target provider not found: ${detail.targetProviderId}`
      );
    }
    const kindToken = abiToken(
      requireTypeKey(indexes.types, targetProvider.providerKindTypeId, `expire provider kind`)
    );
    return {
      ...base,
      operation: 'expire_provider',
      providerRef: `${kindToken}:${detail.targetProviderId}`
    };
  }

  throw new CombatDataAssembleError(
    `step ${stepId} unknown provider action typeKey: ${actionKey}`
  );
}

function detectDetailKey(step: EffectStep): EffectStepDetailKey {
  const present = DETAIL_KEYS.filter((key) => {
    const value = (step as Record<string, unknown>)[key];
    return value !== undefined && value !== null;
  });
  if (present.length !== 1) {
    throw new CombatDataAssembleError(
      `effect step ${step.stepId} requires exactly one detail key; found ${present.length}`
    );
  }
  return present[0];
}

function mapApplyProviderDefinitionRef(
  namespacedOrBare: string,
  slot: CombatantSlot,
  operationTarget: string
): string {
  if (operationTarget !== 'self' && operationTarget !== 'opponent') {
    throw new CombatDataAssembleError(
      `apply_provider.target must be self|opponent, got: ${operationTarget}`
    );
  }
  const targetSlot: CombatantSlot =
    (slot === 'source' && operationTarget === 'self') ||
    (slot === 'target' && operationTarget === 'opponent')
      ? 'source'
      : 'target';
  const bareKey = stripSlotPrefix(namespacedOrBare);
  return namespacedProviderKey(targetSlot, bareKey);
}

function buildInitialSnapshot(
  compileRequest: CompileRequest,
  source: CombatantDefinition,
  target: CombatantDefinition
): InitialSnapshot {
  return {
    schemaHash: compileRequest.schemaHash,
    rulesHash: compileRequest.rulesHash,
    timeMs: 0,
    combatants: [toCombatantSnapshot(source), toCombatantSnapshot(target)]
  };
}

function toCombatantSnapshot(combatant: CombatantDefinition): CombatantSnapshot {
  return {
    key: combatant.key,
    attributes: deepClone(combatant.attributes),
    resources: deepClone(combatant.resources),
    cooldowns: {},
    providers: combatant.providers.map((mount) => ({
      providerRef: mount.providerRef,
      definitionRef: mount.definitionRef,
      source: combatant.key,
      owner: combatant.key,
      stacks: 1,
      expireAt: null,
      state: deepClone(mount.initialState ?? {})
    })),
    shields: [],
    abilityState: {},
    providerState: {},
    vars: {}
  };
}

function applyAttributeOverrides(
  attributes: Record<string, AttributeSlot>,
  overrides?: Record<string, { base?: number; current?: number; max?: number }>
): void {
  if (!overrides) {
    return;
  }
  for (const [key, override] of Object.entries(overrides)) {
    const slot = attributes[key];
    if (!slot) {
      throw new CombatDataAssembleError(`attribute override targets unknown key: ${key}`);
    }
    if (override.base !== undefined) {
      assertFiniteNumber(override.base, `attribute.${key}.base`);
      slot.base = override.base;
    }
    if (override.current !== undefined) {
      assertFiniteNumber(override.current, `attribute.${key}.current`);
      slot.current = override.current;
    }
    if (override.max !== undefined) {
      assertFiniteNumber(override.max, `attribute.${key}.max`);
      slot.max = override.max;
    }
    slot.resolved = slot.current;
  }
}

function applyResourceOverrides(
  resources: Record<string, ResourceSlot>,
  overrides?: Record<string, { current?: number; max?: number }>
): void {
  if (!overrides) {
    return;
  }
  for (const [key, override] of Object.entries(overrides)) {
    const slot = resources[key];
    if (!slot) {
      throw new CombatDataAssembleError(`resource override targets unknown key: ${key}`);
    }
    if (override.current !== undefined) {
      assertFiniteNumber(override.current, `resource.${key}.current`);
      slot.current = override.current;
    }
    if (override.max !== undefined) {
      assertFiniteNumber(override.max, `resource.${key}.max`);
      slot.max = override.max;
    }
  }
}

function formulaRef(slot: CombatantSlot, formulaKey: string): GenericFormulaExpr {
  return { op: 'ref', ref: namespacedFormulaKey(slot, formulaKey) };
}

function namespacedProviderKey(slot: CombatantSlot, providerId: string): string {
  return `${slot}::${providerId}`;
}

function namespacedFormulaKey(slot: CombatantSlot, formulaKey: string): string {
  return `${slot}::${formulaKey}`;
}

function requireTypeKey(types: TypeIndex, typeId: number, label: string): string {
  const entry = types.byId.get(typeId);
  if (!entry?.typeKey) {
    throw new CombatDataAssembleError(`missing typeKey for typeId=${typeId} (${label})`);
  }
  return entry.typeKey;
}

/** Strip vocabulary prefix: `operation/damage` → `damage`, `selector/self` → `self`. */
function abiToken(typeKey: string): string {
  const idx = typeKey.indexOf('/');
  return idx >= 0 ? typeKey.slice(idx + 1) : typeKey;
}

function mapAbilityKind(token: string): AbilityDefinition['kind'] {
  if (token === 'passive') {
    return 'passive_listener';
  }
  return token;
}

function selectorToOwnerPath(selectorToken: string): string {
  if (selectorToken === 'self' || selectorToken === 'source') {
    return '$owner';
  }
  if (selectorToken === 'opponent' || selectorToken === 'target') {
    return '$opponent';
  }
  throw new CombatDataAssembleError(`unsupported modifier target selector: ${selectorToken}`);
}

function rewriteFormulaExpr(expr: GenericFormulaExpr, slot: CombatantSlot): GenericFormulaExpr {
  const next = deepClone(expr);
  if (next.path) {
    next.path = rewriteOwnerOpponentPath(next.path, slot);
  }
  if (next.op === 'ref' && typeof next.ref === 'string' && next.ref.length > 0) {
    if (!next.ref.includes('::') && !next.ref.startsWith('ability.')) {
      next.ref = namespacedFormulaKey(slot, next.ref);
    }
  }
  if (next.args) {
    next.args = next.args.map((child) => rewriteFormulaExpr(child, slot));
  }
  if (next.min) {
    next.min = rewriteFormulaExpr(next.min, slot);
  }
  if (next.max) {
    next.max = rewriteFormulaExpr(next.max, slot);
  }
  if (next.expr) {
    next.expr = rewriteFormulaExpr(next.expr, slot);
  }
  return next;
}

function rewriteOwnerOpponentPath(path: string, slot: CombatantSlot): string {
  if (path.startsWith('ability.param.')) {
    return path;
  }
  if (path.startsWith('$owner.')) {
    return `${slot}.${path.slice('$owner.'.length)}`;
  }
  if (path.startsWith('$opponent.')) {
    return `${opponentOf(slot)}.${path.slice('$opponent.'.length)}`;
  }
  if (
    path.startsWith('source.') ||
    path.startsWith('target.') ||
    path.startsWith('self.') ||
    path.startsWith('opponent.')
  ) {
    return path;
  }
  return path;
}

function opponentOf(slot: CombatantSlot): CombatantSlot {
  return slot === 'source' ? 'target' : 'source';
}

function stripSlotPrefix(value: string): string {
  const match = /^(?:source|target)::(.+)$/.exec(value);
  return match ? match[1] : value;
}

function asFormulaExpr(expression: unknown): GenericFormulaExpr {
  if (!expression || typeof expression !== 'object') {
    throw new CombatDataAssembleError('formula expression must be an object');
  }
  return expression as GenericFormulaExpr;
}

function pickSafetyBudget(budget: SafetyBudget): SafetyBudget {
  const next: SafetyBudget = {};
  if (budget.maxChainDepth !== undefined) {
    next.maxChainDepth = budget.maxChainDepth;
  }
  if (budget.maxCommandsPerEvent !== undefined) {
    next.maxCommandsPerEvent = budget.maxCommandsPerEvent;
  }
  if (budget.maxEvents !== undefined) {
    next.maxEvents = budget.maxEvents;
  }
  return next;
}

function assertFiniteNumber(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CombatDataAssembleError(`${label} must be a finite number`);
  }
}

function assertFinitePositive(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (value <= 0) {
    throw new CombatDataAssembleError(`${label} must be a positive finite number`);
  }
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function groupBy<T, K extends string>(
  items: T[],
  keyFn: (item: T) => K
): Map<K, T[]>;
function groupBy<T, K extends string, V>(
  items: T[],
  keyFn: (item: T) => K,
  mapFn: (item: T) => V
): Map<K, V[]>;
function groupBy<T, K extends string, V>(
  items: T[],
  keyFn: (item: T) => K,
  mapFn?: (item: T) => V
): Map<K, Array<T | V>> {
  const map = new Map<K, Array<T | V>>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) ?? [];
    list.push(mapFn ? mapFn(item) : item);
    map.set(key, list);
  }
  return map;
}
