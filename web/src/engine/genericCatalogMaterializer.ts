import type {
  AbilityDefinition,
  AttributeSlot,
  CombatantDefinition,
  CombatantProviderMount,
  CombatantSnapshot,
  CompileRequest,
  DriverEntry,
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
  StopPolicy
} from '../types/genericEngine';
import {
  DEFAULT_CONDITION_RECHECK_INTERVAL_MS,
  DEFAULT_SAMPLING,
  DEFAULT_STOP_POLICY
} from '../types/genericEngine';
import type {
  CombatantNumericOverrides,
  GenericAbilityOption,
  GenericScenarioOverrides,
  GenericScenarioSelection,
  WasmCatalogV1
} from '../types/wasmCatalog';

export type CombatantSlot = 'source' | 'target';

export type MaterializedGenericScenario = {
  compileRequest: CompileRequest;
  initialSnapshot: InitialSnapshot;
  availableSourceAbilities: GenericAbilityOption[];
  sessionSignature: string;
};

export type AssembleRunRequestInput = {
  sessionId: string;
  catalog: WasmCatalogV1;
  materialized: MaterializedGenericScenario;
  driverPlan: DriverPlan;
  stopPolicy?: Partial<StopPolicy>;
  sampling?: Partial<SamplingConfig>;
  safetyBudget?: SafetyBudget;
};

export class GenericCatalogMaterializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenericCatalogMaterializeError';
  }
}

const EMPTY_P0_RULES: EmptyP0Rules = {
  operations: [],
  modifiers: [],
  listeners: [],
  triggerRules: []
};

export function materializeGenericScenario(
  catalog: WasmCatalogV1,
  selection: GenericScenarioSelection,
  overrides: GenericScenarioOverrides = {}
): MaterializedGenericScenario {
  assertEmptyP0Rules(catalog.rules);

  const sourceTemplate = findTemplate(catalog, selection.sourceTemplateKey);
  const targetTemplate = findTemplate(catalog, selection.targetTemplateKey);

  const sharedProviders: ProviderDefinition[] = [];
  const formulas: NamedFormula[] = [];

  for (const provider of catalog.sharedProviders) {
    sharedProviders.push(cloneProviderForSlot(provider, 'source'));
    sharedProviders.push(cloneProviderForSlot(provider, 'target'));
  }

  for (const formula of catalog.formulas ?? []) {
    formulas.push(cloneFormulaForSlot(formula, 'source'));
    formulas.push(cloneFormulaForSlot(formula, 'target'));
  }

  const sourceCombatant = materializeCombatant(sourceTemplate, 'source', overrides.source);
  const targetCombatant = materializeCombatant(targetTemplate, 'target', overrides.target);

  const compileRequest: CompileRequest = {
    schemaVersion: catalog.meta.schemaVersion,
    schemaHash: catalog.meta.schemaHash,
    rulesHash: catalog.meta.rulesHash,
    typeCatalog: deepClone(catalog.typeCatalog),
    combatants: [sourceCombatant, targetCombatant],
    sharedProviders,
    rules: deepClone(EMPTY_P0_RULES),
    formulas,
    settings: deepClone(catalog.settings ?? {})
  };

  const initialSnapshot = buildInitialSnapshot(compileRequest, sourceCombatant, targetCombatant);
  const availableSourceAbilities = listAvailableSourceAbilities(sourceCombatant, sharedProviders);
  const sessionSignature = computeSessionSignature(compileRequest);

  return {
    compileRequest,
    initialSnapshot,
    availableSourceAbilities,
    sessionSignature
  };
}

export function assembleGenericRunRequest(input: AssembleRunRequestInput): RunRequest {
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

  const driverPlan = normalizeDriverPlan(input.driverPlan);
  const initialSnapshot: InitialSnapshot = {
    ...deepClone(input.materialized.initialSnapshot),
    schemaHash: input.catalog.meta.schemaHash,
    rulesHash: input.catalog.meta.rulesHash
  };

  const request: RunRequest = {
    sessionId: input.sessionId,
    expectedRulesHash: input.catalog.meta.rulesHash,
    schemaVersion: input.catalog.meta.schemaVersion,
    schemaHash: input.catalog.meta.schemaHash,
    rulesHash: input.catalog.meta.rulesHash,
    initialSnapshot,
    driverPlan,
    stopPolicy,
    sampling
  };

  if (input.safetyBudget) {
    request.safetyBudget = pickSafetyBudget(input.safetyBudget);
  }

  return request;
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
    throw new GenericCatalogMaterializeError(
      'driverPlan.conditionRecheckIntervalMs must be a finite number in 10..1000'
    );
  }

  const entries: DriverEntry[] = plan.entries.map((entry) => {
    if (!entry.abilityRef || !entry.entryKey) {
      throw new GenericCatalogMaterializeError('driverPlan entries require entryKey and abilityRef');
    }
    if (entry.source !== 'source' || entry.target !== 'target') {
      throw new GenericCatalogMaterializeError('P0 driverPlan entries must use source="source" and target="target"');
    }
    const normalized: DriverEntry = {
      entryKey: entry.entryKey,
      abilityRef: entry.abilityRef,
      source: 'source',
      target: 'target',
      priority: entry.priority ?? 0,
      firstAtMs: entry.firstAtMs
    };
    if (entry.repeat) {
      normalized.repeat = { ...entry.repeat };
    }
    if (entry.whileReady !== undefined) {
      normalized.whileReady = entry.whileReady;
    }
    if (entry.condition) {
      normalized.condition = deepClone(entry.condition);
    }
    return normalized;
  });

  return { conditionRecheckIntervalMs, entries };
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

function assertEmptyP0Rules(rules: EmptyP0Rules): void {
  const keys: Array<keyof EmptyP0Rules> = ['operations', 'modifiers', 'listeners', 'triggerRules'];
  for (const key of keys) {
    const value = rules?.[key];
    if (!Array.isArray(value) || value.length !== 0) {
      throw new GenericCatalogMaterializeError(`P0 catalog.rules.${key} must be an empty array`);
    }
  }
}

function findTemplate(catalog: WasmCatalogV1, templateKey: string) {
  const template = catalog.combatantTemplates.find((item) => item.templateKey === templateKey);
  if (!template) {
    throw new GenericCatalogMaterializeError(`combatant template not found: ${templateKey}`);
  }
  return template;
}

function materializeCombatant(
  template: ReturnType<typeof findTemplate>,
  slot: CombatantSlot,
  overrides?: CombatantNumericOverrides
): CombatantDefinition {
  const attributes = applyAttributeOverrides(deepClone(template.attributes), overrides?.attributes);
  const resources = applyResourceOverrides(deepClone(template.resources), overrides?.resources);
  const providers: CombatantProviderMount[] = (template.providers ?? []).map((mount) => ({
    providerRef: mount.providerRef,
    definitionRef: `${slot}::${mount.definitionRef}`,
    ...(mount.initialState ? { initialState: deepClone(mount.initialState) } : {}),
    ...(mount.initialAbilityState ? { initialAbilityState: deepClone(mount.initialAbilityState) } : {})
  }));

  return {
    key: slot,
    ...(template.displayName !== undefined ? { displayName: template.displayName } : {}),
    types: deepClone(template.types ?? []),
    tags: deepClone(template.tags ?? []),
    attributes,
    resources,
    providers
  };
}

function applyAttributeOverrides(
  attributes: Record<string, AttributeSlot>,
  overrides?: Record<string, { base?: number; current?: number; max?: number }>
): Record<string, AttributeSlot> {
  if (!overrides) {
    return attributes;
  }
  for (const [key, override] of Object.entries(overrides)) {
    const slot = attributes[key];
    if (!slot) {
      throw new GenericCatalogMaterializeError(`attribute override targets unknown key: ${key}`);
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
  return attributes;
}

function applyResourceOverrides(
  resources: Record<string, ResourceSlot>,
  overrides?: Record<string, { current?: number; max?: number }>
): Record<string, ResourceSlot> {
  if (!overrides) {
    return resources;
  }
  for (const [key, override] of Object.entries(overrides)) {
    const slot = resources[key];
    if (!slot) {
      throw new GenericCatalogMaterializeError(`resource override targets unknown key: ${key}`);
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
  return resources;
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

function listAvailableSourceAbilities(
  sourceCombatant: CombatantDefinition,
  sharedProviders: ProviderDefinition[]
): GenericAbilityOption[] {
  const providerByKey = new Map(sharedProviders.map((provider) => [provider.providerKey, provider]));
  const options: GenericAbilityOption[] = [];

  for (const mount of sourceCombatant.providers) {
    const provider = providerByKey.get(mount.definitionRef);
    if (!provider) {
      continue;
    }
    for (const ability of provider.abilities ?? []) {
      const selectable = ability.kind === 'active';
      options.push({
        abilityKey: ability.abilityKey,
        abilityRef: `source.provider[${mount.providerRef}].ability[${ability.abilityKey}]`,
        providerRef: mount.providerRef,
        definitionRef: mount.definitionRef,
        providerKey: stripSlotPrefix(mount.definitionRef),
        displayName: `${mount.providerRef} / ${ability.abilityKey}`,
        kind: ability.kind,
        selectable
      });
    }
  }

  return options;
}

function cloneProviderForSlot(provider: ProviderDefinition, slot: CombatantSlot): ProviderDefinition {
  const catalogProviderKey = provider.providerKey;
  const cloned = deepClone(provider);
  cloned.providerKey = `${slot}::${catalogProviderKey}`;

  cloned.abilities = (cloned.abilities ?? []).map((ability) => rewriteAbility(ability, slot));
  cloned.modifiers = (cloned.modifiers ?? []).map((modifier) => rewriteModifier(modifier, slot));
  cloned.listeners = (cloned.listeners ?? []).map((listener) => rewriteListener(listener, slot));
  if (cloned.lifecycle?.durationMs) {
    cloned.lifecycle.durationMs = rewriteFormulaExpr(cloned.lifecycle.durationMs, slot);
  }

  return cloned;
}

function cloneFormulaForSlot(formula: NamedFormula, slot: CombatantSlot): NamedFormula {
  return {
    key: `${slot}::${formula.key}`,
    expression: rewriteFormulaExpr(deepClone(formula.expression), slot)
  };
}

function rewriteAbility(ability: AbilityDefinition, slot: CombatantSlot): AbilityDefinition {
  const next = deepClone(ability);
  if (next.cost?.amount) {
    next.cost.amount = rewriteFormulaExpr(next.cost.amount, slot);
  }
  if (next.cooldown?.durationMs) {
    next.cooldown.durationMs = rewriteFormulaExpr(next.cooldown.durationMs, slot);
  }
  next.operations = (next.operations ?? []).map((operation) => rewriteOperation(operation, slot));
  if (next.listenerSpec) {
    next.listenerSpec = rewriteListener(next.listenerSpec, slot);
  }
  if (next.tickSpec) {
    next.tickSpec = {
      ...next.tickSpec,
      onTick: next.tickSpec.onTick.map((operation) => rewriteOperation(operation, slot))
    };
  }
  return next;
}

function rewriteListener(listener: ListenerDefinition, slot: CombatantSlot): ListenerDefinition {
  const next = deepClone(listener);
  if (next.abilityRef) {
    next.abilityRef = rewriteAbilityRef(next.abilityRef, slot);
  }
  next.operations = (next.operations ?? []).map((operation) => rewriteOperation(operation, slot));
  return next;
}

function rewriteModifier(modifier: ModifierDefinition, slot: CombatantSlot): ModifierDefinition {
  const next = deepClone(modifier);
  if (next.target) {
    next.target = rewriteOwnerOpponentPath(next.target, slot);
  }
  next.value = rewriteFormulaExpr(next.value, slot);
  if (next.condition) {
    next.condition = rewriteFormulaExpr(next.condition, slot);
  }
  return next;
}

function rewriteOperation(operation: OperationDefinition, slot: CombatantSlot): OperationDefinition {
  const next = deepClone(operation);
  if (next.amount) {
    next.amount = rewriteFormulaExpr(next.amount, slot);
  }
  if (next.abilityRef) {
    next.abilityRef = rewriteAbilityRef(next.abilityRef, slot);
  }

  if (next.operation === 'apply_provider' && next.providerDefinitionRef) {
    next.providerDefinitionRef = mapApplyProviderDefinitionRef(
      next.providerDefinitionRef,
      slot,
      next.target
    );
  }
  // refresh_provider / expire_provider: preserve providerRef without slot prefix

  return next;
}

function mapApplyProviderDefinitionRef(
  catalogProviderKey: string,
  slot: CombatantSlot,
  operationTarget: string
): string {
  if (operationTarget !== 'self' && operationTarget !== 'opponent') {
    throw new GenericCatalogMaterializeError(
      `apply_provider.target must be self|opponent, got: ${operationTarget}`
    );
  }
  const targetSlot: CombatantSlot =
    (slot === 'source' && operationTarget === 'self') ||
    (slot === 'target' && operationTarget === 'opponent')
      ? 'source'
      : 'target';
  const bareKey = stripSlotPrefix(catalogProviderKey);
  return `${targetSlot}::${bareKey}`;
}

function rewriteFormulaExpr(expr: GenericFormulaExpr, slot: CombatantSlot): GenericFormulaExpr {
  const next = deepClone(expr);
  if (next.path) {
    next.path = rewriteOwnerOpponentPath(next.path, slot);
  }
  if (next.op === 'ref' && typeof next.ref === 'string' && next.ref.length > 0) {
    if (!next.ref.includes('::') && !next.ref.startsWith('ability.')) {
      next.ref = `${slot}::${next.ref}`;
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

function rewriteAbilityRef(abilityRef: string, slot: CombatantSlot): string {
  if (abilityRef.startsWith('$owner.')) {
    return `${slot}.${abilityRef.slice('$owner.'.length)}`;
  }
  if (abilityRef.startsWith('$opponent.')) {
    return `${opponentOf(slot)}.${abilityRef.slice('$opponent.'.length)}`;
  }
  throw new GenericCatalogMaterializeError(
    `abilityRef must use $owner/$opponent prefix, got: ${abilityRef}`
  );
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
  if (path.startsWith('source.') || path.startsWith('target.') || path.startsWith('self.') || path.startsWith('opponent.')) {
    throw new GenericCatalogMaterializeError(`illegal catalog path (already runtime-shaped): ${path}`);
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

function assertFiniteNumber(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new GenericCatalogMaterializeError(`${label} must be a finite number`);
  }
}

function assertFinitePositive(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (value <= 0) {
    throw new GenericCatalogMaterializeError(`${label} must be a positive finite number`);
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
