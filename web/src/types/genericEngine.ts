export type GenericErrorPhase = 'parse' | 'compile' | 'run' | 'abi';

export type GenericErrorSeverity = 'error' | 'fatal';

export type WarningSeverity = 'warning';

export type StopReason =
  | 'duration_reached'
  | 'target_dead'
  | 'source_dead'
  | 'both_dead'
  | 'no_events'
  | 'budget_exceeded';

export type WarningItem = {
  code: string;
  message: string;
  severity: WarningSeverity;
  refs?: string[];
  evidenceRefs?: string[];
  count?: number;
};

export type EngineError = {
  ok: false;
  phase: GenericErrorPhase;
  code: string;
  message: string;
  path?: string;
  ref?: string;
  severity: GenericErrorSeverity;
  recoverable: boolean;
  details?: Record<string, unknown>;
  schemaHash?: string;
  rulesHash?: string;
  sessionId?: string;
};

export type CompileResultMetadata = {
  combatantCount: number;
  providerCount: number;
  abilityCount: number;
  typeCount: number;
  formulaCount: number;
};

export type TypeCatalog = {
  types: Array<{ key: string; domain: string; group?: string }>;
  relations: Array<{ parent: string; child: string }>;
};

export type AttributeSlot = {
  base: number;
  current: number;
  max: number;
  resolved: number;
};

export type ResourceSlot = {
  current: number;
  max: number;
};

export type CombatantProviderMount = {
  providerRef: string;
  definitionRef: string;
  initialState?: Record<string, unknown>;
  initialAbilityState?: Record<string, unknown>;
};

export type CombatantDefinition = {
  key: 'source' | 'target';
  displayName?: string;
  types?: string[];
  tags?: string[];
  attributes: Record<string, AttributeSlot>;
  resources: Record<string, ResourceSlot>;
  providers: CombatantProviderMount[];
};

export type GenericFormulaExpr = {
  op: string;
  value?: number;
  path?: string;
  ref?: string;
  args?: GenericFormulaExpr[];
  decimals?: number;
  min?: GenericFormulaExpr;
  max?: GenericFormulaExpr;
  expr?: GenericFormulaExpr;
};

export type NamedFormula = {
  key: string;
  expression: GenericFormulaExpr;
};

export type OperationDefinition = {
  operation: string;
  target: string;
  amount?: GenericFormulaExpr;
  valuePolicy?: string;
  damageType?: string;
  resourceKey?: string;
  attributeKey?: string;
  abilityRef?: string;
  shieldRef?: string;
  providerDefinitionRef?: string;
  providerRef?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
  types?: string[];
  tags?: string[];
  ref?: string;
  condition?: GenericFormulaExpr;
  copyableOnHit?: boolean;
  critEligible?: boolean;
  repeatScope?: string;
  repeatCount?: number;
  repeatTag?: string;
  triggerStateKey?: string;
  threshold?: number;
};

export type ModifierDefinition = {
  modifierKey: string;
  kind: string;
  target?: string;
  command?: string;
  channel?: string;
  bucket?: string;
  stage?: string;
  priority?: number;
  valuePolicy: string;
  value: GenericFormulaExpr;
  condition?: GenericFormulaExpr;
};

export type ListenerDefinition = {
  listenerKey: string;
  eventMatcher: { any?: string[]; all?: string[]; none?: string[] };
  abilityRef?: string;
  operations?: OperationDefinition[];
  maxTriggersPerEvent?: number;
  chainLimitKey?: string;
};

export type AbilityDefinition = {
  abilityKey: string;
  kind: 'active' | 'passive_listener' | 'aura_modifier' | 'tick' | 'stateful' | string;
  types?: string[];
  tags?: string[];
  params?: Record<string, number>;
  cost?: { resourceKey: string; amount: GenericFormulaExpr; allowPartial?: boolean };
  cooldown?: { durationMs: GenericFormulaExpr; startsOn?: string; groupKey?: string };
  operations?: OperationDefinition[];
  listenerSpec?: ListenerDefinition;
  tickSpec?: { intervalMs: number; onTick: OperationDefinition[]; startDelayMs?: number };
  stateSchema?: Record<string, unknown>;
};

/** Structured provider initialStateSchema field (Guinsoo H+K / Gate H1). */
export type ProviderStateFieldSchema = {
  valueType: string;
  defaultValue: number;
  maxValue?: number;
  durationMs?: number;
  refreshPolicy?: string;
};

export type ProviderDefinition = {
  providerKey: string;
  kind: string;
  stableId: string;
  types?: string[];
  tags?: string[];
  abilities?: AbilityDefinition[];
  modifiers?: ModifierDefinition[];
  listeners?: ListenerDefinition[];
  lifecycle?: {
    durationMs?: GenericFormulaExpr;
    maxStacks?: number;
    refreshPolicy?: string;
    tickIntervalMs?: number;
  };
  /** TinyGo V2: bare `number` (legacy default 0) or structured timed/capped state. */
  initialStateSchema?: Record<string, number | ProviderStateFieldSchema>;
};

export type EmptyP0Rules = {
  operations: [];
  modifiers: [];
  listeners: [];
  triggerRules: [];
};

export type CompileSettings = {
  maxEvents?: number;
  maxCommandsPerEvent?: number;
  maxQueueEvents?: number;
  maxChainDepth?: number;
};

export type CompileRequest = {
  schemaVersion: string;
  schemaHash: string;
  rulesHash: string;
  typeCatalog: TypeCatalog;
  combatants: CombatantDefinition[];
  sharedProviders?: ProviderDefinition[];
  rules: EmptyP0Rules;
  formulas?: NamedFormula[];
  settings?: CompileSettings;
};

export type CompileResult = {
  ok: boolean;
  sessionId?: string;
  schemaVersion?: string;
  schemaHash?: string;
  rulesHash?: string;
  metadata?: CompileResultMetadata;
  warnings?: WarningItem[];
  errors?: EngineError[];
};

export type CombatantProviderSnapshot = {
  providerRef: string;
  definitionRef: string;
  source: 'source' | 'target';
  owner: 'source' | 'target';
  stacks: number;
  expireAt: number | null;
  state: Record<string, unknown>;
};

export type CombatantSnapshot = {
  key: 'source' | 'target';
  attributes: Record<string, AttributeSlot>;
  resources: Record<string, ResourceSlot>;
  cooldowns: Record<string, unknown>;
  providers: CombatantProviderSnapshot[];
  shields: unknown[];
  abilityState: Record<string, unknown>;
  providerState: Record<string, unknown>;
  vars: Record<string, unknown>;
};

export type InitialSnapshot = {
  schemaHash: string;
  rulesHash: string;
  timeMs: number;
  combatants: CombatantSnapshot[];
};

/** TinyGo V2 DriverRepeat: fixed interval XOR formula cadence (never both). */
export type DriverEntryRepeat =
  | { intervalMs: number; intervalFormula?: never; maxAttempts?: number }
  | { intervalMs?: never; intervalFormula: GenericFormulaExpr; maxAttempts?: number };

export type DriverEntry = {
  entryKey: string;
  abilityRef: string;
  source: 'source' | 'target';
  target: 'source' | 'target';
  priority?: number;
  firstAtMs: number;
  repeat?: DriverEntryRepeat;
  whileReady?: boolean | Record<string, unknown>;
  condition?: GenericFormulaExpr;
};

export type DriverPlan = {
  entries: DriverEntry[];
  conditionRecheckIntervalMs: number;
};

export type StopPolicy = {
  durationMs: number;
  stopOnTargetDeath: boolean;
  stopWhenNoEvents: boolean;
};

export type SamplingConfig = {
  sampleEveryMs: number;
  dpsWindowMs: number;
  maxSeriesPoints: number;
};

export type SafetyBudget = {
  maxChainDepth?: number;
  maxCommandsPerEvent?: number;
  maxEvents?: number;
};

export type RunRequest = {
  sessionId: string;
  expectedRulesHash: string;
  schemaVersion: string;
  schemaHash: string;
  rulesHash: string;
  initialSnapshot: InitialSnapshot;
  driverPlan: DriverPlan;
  stopPolicy: StopPolicy;
  sampling: SamplingConfig;
  safetyBudget?: SafetyBudget;
};

export type RunSummary = {
  durationMs: number;
  stopReason: StopReason;
  sourceFinalHp: number;
  targetFinalHp: number;
  sourceDamageDealt: number;
  sourceDamageTaken: number;
  targetDamageDealt: number;
  targetDamageTaken: number;
  abilityAttemptCount: number;
  abilityCastCount: number;
  attemptSkippedCount: number;
  warningCount: number;
  evidenceTruncated: boolean;
  seriesDownsampled: boolean;
  abilityStats: Array<{
    abilityRef: string;
    attemptCount: number;
    castCount: number;
    skipCount: number;
    damageDealt?: number;
    healingDone?: number;
  }>;
};

export type SeriesPoint = {
  timeMs: number;
  sourceHp: number;
  targetHp: number;
  sourceDamageDealt: number;
  targetDamageDealt: number;
  sourceCumulativeDps: number;
  targetCumulativeDps: number;
  sourceWindowDps: number;
  targetWindowDps: number;
};

export type EvidenceItem = {
  timeMs: number;
  kind: string;
  ref?: string;
  path?: string;
  message?: string;
  data?: Record<string, unknown>;
};

export type EvidenceCollection = {
  items: EvidenceItem[];
  truncated: boolean;
  truncatedEvidenceCount: number;
  countsByKind: Record<string, number>;
};

export type SeriesSamplingEvidence = {
  requestedSampleEveryMs?: number;
  actualSampleEveryMs?: number;
  theoreticalPoints?: number;
  actualPoints?: number;
  maxSeriesPoints?: number;
  downsampled?: boolean;
  method?: string;
  [key: string]: unknown;
};

export type DoneResult = {
  ok: boolean;
  summary: RunSummary;
  finalSnapshot: Record<string, unknown>;
  series: SeriesPoint[];
  warnings: WarningItem[];
  evidence: EvidenceCollection;
  seriesSamplingEvidence: SeriesSamplingEvidence;
};

export type GenericReleaseDonePayload = {
  ok: boolean;
  sessionId: string;
  released: boolean;
};

export const DEFAULT_STOP_POLICY: StopPolicy = {
  durationMs: 10_000,
  stopOnTargetDeath: true,
  stopWhenNoEvents: true
};

export const DEFAULT_SAMPLING: SamplingConfig = {
  sampleEveryMs: 100,
  dpsWindowMs: 1000,
  maxSeriesPoints: 5000
};

export const DEFAULT_CONDITION_RECHECK_INTERVAL_MS = 100;

/** Ability option listed after combat-data assembly for driver plan UI. */
export type GenericAbilityOption = {
  abilityRef: string;
  abilityKey: string;
  providerRef: string;
  definitionRef: string;
  providerKey: string;
  displayName?: string;
  kind?: string;
  selectable?: boolean;
  /** Projected from AbilityDefinition.types (type_relations target_category=ability). */
  types?: string[];
};
