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

export type TypeMatcher = { any?: string[]; all?: string[]; none?: string[] };
export type GenericVampType = 'LIFE_STEAL' | 'OMNIVAMP' | 'PHYSICAL_VAMP' | 'SPELL_VAMP';
export type GenericVampBasis = 'POST_DEFENSE_DAMAGE' | 'ACTUAL_HP_LOSS';

export type GenericVampRule = {
  vampType: GenericVampType;
  sourceAttributeKey: string;
  basisOutputKind: GenericVampBasis;
  defaultEfficiency: number;
  targetMatcher: TypeMatcher;
  abilityMatcher: TypeMatcher;
  damageMatcher: TypeMatcher;
};

export type GenericVampOverride =
  | { vampType: GenericVampType; mode: 'DISABLED'; basisOutputKind?: never; efficiency?: never }
  | { vampType: GenericVampType; mode: 'OVERRIDE'; basisOutputKind: GenericVampBasis; efficiency: GenericFormulaExpr };

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
  shieldDurationMs?: GenericFormulaExpr;
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
  /** Optional non-negative repeat delay (ms); omit when unset/0 for legacy payloads. */
  repeatDelayMs?: number;
  triggerStateKey?: string;
  threshold?: number;
  vampQualification?: 'RESOLVED' | 'UNRESOLVED';
  vampOverrides?: GenericVampOverride[];
  skillHit?: SkillHitDefinition;
  providerRefFromEvent?: boolean;
  /** Same-frame damage export key; later ops read operation.output.<outputRef>.<kind>. */
  outputRef?: string;
};

export type SkillHitHistoryState = 'complete' | 'unknown';
export type SkillHitValueKey = 'first_contact' | 'blocked';
export type SkillHitComparator = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
export type SpellShieldBlockScope = 'SKILL' | 'EFFECT' | 'RESULT' | 'DAMAGE_INSTANCE';
export type SkillHitResultType =
  | 'DAMAGE'
  | 'ATTRIBUTE_CHANGE'
  | 'RESOURCE_CHANGE'
  | 'COOLDOWN_CHANGE'
  | 'STATUS_OPERATION'
  | 'LIFECYCLE_OPERATION'
  | 'SPELL_SHIELD'
  | 'DAMAGE_MODIFIER'
  | 'HEALING_MODIFIER'
  | 'DAMAGE_IMMUNITY'
  | 'HEALTH_FLOOR';
export type SkillHitSemanticTarget = 'TARGET' | 'SOURCE' | 'SELF';
export type SkillHitMoment = 'INSTANT' | 'PERSISTENT';
export type SkillHitStatusKind = 'stun' | 'root' | 'silence' | 'charm' | 'airborne' | 'movement_slow';

export type SkillUseFact = {
  useKey: string;
  source: string;
  skillKey: string;
  historyState: SkillHitHistoryState;
  priorQualifiedContacts?: string[];
};

export type SkillHitFact = {
  driverEntryKey: string;
  useRef: string | null;
  sequence: number | null;
};

export type SkillHitEventValueCondition = {
  key: SkillHitValueKey;
  comparator: SkillHitComparator;
  value: GenericFormulaExpr;
};

export type SkillHitSemantic = {
  resultType: SkillHitResultType;
  target: SkillHitSemanticTarget;
  moment: SkillHitMoment;
  statusOperation?: 'APPLY' | 'REMOVE';
  statusKey?: string;
  statusKind?: SkillHitStatusKind;
};

export type SkillHitCandidate = {
  candidateKey: string;
  effectOccurrenceKey: string;
  effectKey: string;
  resultKey: string;
  semantic: SkillHitSemantic;
  spellShieldBlockScope: SpellShieldBlockScope | null;
  participationCondition?: GenericFormulaExpr | null;
  eventValueConditions?: SkillHitEventValueCondition[];
  operations: OperationDefinition[];
};

export type SkillHitDefinition = {
  skillKey: string;
  candidates: SkillHitCandidate[];
};

export type HealGroupCalculationMode = 'ratio_add' | 'ratio_max';

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
  healDirection?: 'DONE' | 'RECEIVED';
  healCategory?: 'ANY' | 'VAMP' | 'DIRECT';
  healGroupKey?: string;
  healGroupCalculationMode?: HealGroupCalculationMode;
};

export type OncePerUseScope = 'provider' | 'provider_target';

export type OncePerUseLimit = {
  groupKey: string;
  scope: OncePerUseScope;
};

export type ListenerDefinition = {
  listenerKey: string;
  eventMatcher: { any?: string[]; all?: string[]; none?: string[] };
  abilityRef?: string;
  operations?: OperationDefinition[];
  maxTriggersPerEvent?: number;
  chainLimitKey?: string;
  /** Optional non-negative per-cast throttle (ms); omit when unset for legacy payloads. */
  perCastThrottleMs?: number;
  /** Frozen 0/1 predicate evaluated before any listener action. */
  condition?: GenericFormulaExpr;
  oncePerUse?: OncePerUseLimit;
};

export type AbilityDefinition = {
  abilityKey: string;
  kind: 'active' | 'passive_listener' | 'aura_modifier' | 'tick' | 'stateful' | string;
  types?: string[];
  tags?: string[];
  params?: Record<string, number>;
  /** Attack-start / resolve identity; must equal skillUses.skillKey when present. */
  skillKey?: string;
  cost?: { resourceKey: string; amount: GenericFormulaExpr; allowPartial?: boolean };
  cooldown?: { durationMs: GenericFormulaExpr; startsOn?: string; groupKey?: string };
  /** Optional cast precondition formula (provider-local ref). */
  castCondition?: GenericFormulaExpr;
  /** Optional cast provenance (champion|item|pet|innate); omit when unset. */
  castOrigin?: 'champion' | 'item' | 'pet' | 'innate';
  operations?: OperationDefinition[];
  listenerSpec?: ListenerDefinition;
  tickSpec?: {
    intervalMs: number;
    onTick: OperationDefinition[];
    startDelayMs?: number;
    /** Resolved type key for tick state anchor scope (paired with anchorStateKey). */
    anchorScope?: string;
    /** Trimmed state key for tick state anchor (paired with anchorScope). */
    anchorStateKey?: string;
  };
  stateSchema?: Record<string, unknown>;
  /** 主动过程控制入口。有该字段时不得再配普通 cost、cooldown 或独立 operations。 */
  processControl?: ProcessControlDefinition;
};

/** Structured provider initialStateSchema field (Guinsoo H+K / Gate H1). */
export type ProviderStateFieldSchema = {
  valueType: string;
  defaultValue: number;
  maxValue?: number;
  durationMs?: number;
  refreshPolicy?: string;
};

export type ProviderInstanceScope = 'source_target';
export type MovementSlowStatusKind = 'movement_slow';

export type StatusContributionDefinition = {
  resultRef: string;
  statusKey: string;
  statusKind: MovementSlowStatusKind;
  strength: GenericFormulaExpr;
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
    instanceScope?: ProviderInstanceScope;
  };
  statusContributions?: StatusContributionDefinition[];
  /** TinyGo V2: bare `number` (legacy default 0) or structured timed/capped state. */
  initialStateSchema?: Record<string, number | ProviderStateFieldSchema>;
  /** 主动过程定义。旧请求省略时表示空集合；新过程对象使用完整字段。 */
  processes?: ProcessDefinition[];
};

export type GenericRules = {
  operations?: OperationDefinition[];
  modifiers?: ModifierDefinition[];
  listeners?: ListenerDefinition[];
  triggerRules?: unknown[];
  vampRules?: GenericVampRule[];
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
  rules: GenericRules;
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

export type ProviderStatusContributionSnapshot = {
  resultRef: string;
  statusKey: string;
  statusKind: MovementSlowStatusKind;
  strength: number;
};

export type CombatantProviderSnapshot = {
  providerRef: string;
  definitionRef: string;
  source: 'source' | 'target';
  owner: 'source' | 'target';
  stacks: number;
  expireAt: number | null;
  state: Record<string, unknown>;
  statusContributions?: ProviderStatusContributionSnapshot[];
};

export type EffectiveStatusContribution = {
  providerRef: string;
  resultRef: string;
  statusKey: string;
  source: 'source' | 'target';
  expireAt: number;
  strength: number;
};

export type EffectiveStatusSnapshot = {
  statusKind: MovementSlowStatusKind;
  strength: number;
  contributions: EffectiveStatusContribution[];
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
  effectiveStatuses?: EffectiveStatusSnapshot[];
};

export type UseTriggerLedgerEntry = {
  owner: string;
  providerRef: string;
  groupKey: string;
  scope: OncePerUseScope;
  useSource: string;
  useSkillKey: string;
  useKey: string;
  target: string | null;
};

export type InitialSnapshot = {
  schemaHash: string;
  rulesHash: string;
  timeMs: number;
  combatants: CombatantSnapshot[];
  useTriggerLedger?: UseTriggerLedgerEntry[];
  /** 省略表示无过程实例。活动与终结行都占实例预算。 */
  processInstances?: ProcessInstanceSnapshot[];
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
  /** 过程实例预算，含已终结行。缺省由原生取 10000，上限 100000。 */
  maxProcessInstances?: number;
};

export type ProcessControlAction = 'INITIAL' | 'RECAST' | 'CHARGE_RELEASE' | 'CANCEL' | 'INTERRUPT';

export type ProcessFailureReason =
  | 'CONTROLLED'
  | 'SOURCE_DIED'
  | 'TARGET_UNTARGETABLE'
  | 'ACTIVE_CANCELLED'
  | 'EVENT_ABORTED';

export type ProcessControlDefinition = {
  processKey: string;
  action: ProcessControlAction;
  stepKey?: string;
  failureReason?: ProcessFailureReason;
};

export type ProcessStepType = 'IMMEDIATE' | 'DELAY' | 'CHARGE' | 'RECAST';

export type ProcessMomentType =
  | 'PROCESS_START'
  | 'PROCESS_COMPLETE'
  | 'PROCESS_FAILURE'
  | 'STEP_START'
  | 'STEP_EXECUTION'
  | 'STEP_COMPLETE'
  | 'STEP_TIMEOUT';

export type ProcessMomentDefinition = {
  momentType: ProcessMomentType;
  stepKey: string | null;
  failureReason: ProcessFailureReason | null;
};

export type ProcessStepDefinition = {
  stepKey: string;
  stepType: ProcessStepType;
  delayMs?: GenericFormulaExpr;
  minimumChargeMs?: GenericFormulaExpr;
  maximumChargeMs?: GenericFormulaExpr;
  releaseAtMaximum?: boolean;
  windowMs?: GenericFormulaExpr;
};

export type ProcessCostDefinition = {
  resourceKey: string;
  amount: GenericFormulaExpr;
};

export type ProcessCooldownDefinition = {
  durationMs: GenericFormulaExpr;
  startMoment: ProcessMomentDefinition;
};

export type ProcessMomentOperations = {
  moment: ProcessMomentDefinition;
  operations: OperationDefinition[];
};

export type ProcessDefinition = {
  processKey: string;
  skillKey: string;
  steps: ProcessStepDefinition[];
  costs: ProcessCostDefinition[];
  cooldown: ProcessCooldownDefinition | null;
  momentOperations: ProcessMomentOperations[];
};

export type ProcessInstanceStatus = 'active' | 'complete' | 'failed';

export type ProcessInstanceSnapshot = {
  owner: 'source' | 'target';
  providerRef: string;
  processKey: string;
  skillKey: string;
  useKey: string;
  target: 'source' | 'target';
  stepKey: string;
  stepVersion: number;
  startedAtMs: number;
  stepStartedAtMs: number;
  advanceAtMs: number;
  expiresAtMs: number | null;
  actualCosts: Record<string, number>;
  cooldownStarted: boolean;
  status: ProcessInstanceStatus;
  failureReason: ProcessFailureReason | null;
  finishedAtMs: number | null;
};

export type ProcessCommandFact = {
  driverEntryKey: string;
  useRef: string;
};

export type AttackStartFact = {
  driverEntryKey: string;
  useRef: string;
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
  skillUses?: SkillUseFact[];
  skillHitFacts?: SkillHitFact[];
  attackStartFacts?: AttackStartFact[];
  /** 单次驱动条目绑定到已有 skillUses.useKey。省略表示无过程驱动事实。 */
  processCommandFacts?: ProcessCommandFact[];
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
  finalSnapshot: InitialSnapshot;
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
