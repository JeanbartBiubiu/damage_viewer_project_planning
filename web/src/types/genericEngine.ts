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
  approvedStaticValues?: Record<string, number>;
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

type NamedFormulaBase = {
  key: string;
  expression: import('./formulaContract.generated').FormulaDefinition;
};
export type NamedFormula = NamedFormulaBase & ({ scope: 'game'; skillKey?: never; parameters: [] } | {
  scope: 'skill'; skillKey: string;
  parameters: Array<{ parameterKey: string; valueMode: import('./skillParameter').SkillParameter['valueMode'];
    valueType: 'DECIMAL' | 'INTEGER'; value?: number;
    runtimeSource?: { kind: 'use_charge_duration' } | { kind: 'process_actual_cost'; resourceKey: string } | { kind: 'ability_parameter' }
      | { kind: 'scene_parameter'; value: number } }>;
});
export type StaticNumericValue = number | { op: 'ref'; ref: string };

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
  /** 普通盾的显式生命周期关联；shieldRef 在此作为静态盾定义身份。 */
  shieldLifecycleProviderDefinitionRef?: string;
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
  /** 当前结果自己的期望暴击概率与倍率；必须成对，不改写全局属性。 */
  critChance?: GenericFormulaExpr;
  critMultiplier?: GenericFormulaExpr;
  critMultiplierMin?: number;
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
  | 'HEALTH_FLOOR'
  | 'HIT_LINK_APPLICATION'
  | 'ATTACK_LINK_APPLICATION';
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
  /** 候选条件的同拥有者静态供值器挂载，仅切换条件状态读取上下文。 */
  participationProviderRef?: string;
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
  defaultValue: StaticNumericValue;
  maxValue?: StaticNumericValue;
  durationMs?: StaticNumericValue;
  refreshPolicy?: string;
  stateKind?: 'ammo' | 'cooldown';
  ammoRecovery?: { intervalMs: GenericFormulaExpr; mode: 'all_at_once' | 'one_by_one'; startCondition: 'when_empty' | 'after_consume'; initialRemainingMs?: StaticNumericValue };
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
  skillKey?: string;
  kind: string;
  stableId: string;
  /** 关联动态效果明确声明的静态盾定义，查询声明本身不施加盾。 */
  linkedShieldDefinitionRef?: string;
  types?: string[];
  tags?: string[];
  abilities?: AbilityDefinition[];
  modifiers?: ModifierDefinition[];
  listeners?: ListenerDefinition[];
  lifecycle?: {
    durationMs?: GenericFormulaExpr;
    maxStacks?: StaticNumericValue;
    refreshPolicy?: string;
    tickIntervalMs?: StaticNumericValue;
    instanceScope?: ProviderInstanceScope;
  };
  statusContributions?: StatusContributionDefinition[];
  /** TinyGo V2: bare `number` (legacy default 0) or structured timed/capped state. */
  initialStateSchema?: Record<string, number | ProviderStateFieldSchema>;
  /** 主动过程定义。旧请求省略时表示空集合；新过程对象使用完整字段。 */
  processes?: ProcessDefinition[];
};

export type GenericRules = {
  skillActionBindings?: SkillActionBinding[];
  operations?: OperationDefinition[];
  modifiers?: ModifierDefinition[];
  listeners?: ListenerDefinition[];
  triggerRules?: unknown[];
  vampRules?: GenericVampRule[];
  damageTypeFormulas?: GenericDamageTypeFormula[];
  attributeDerivations?: Array<{
    combatantKey: 'source' | 'target';
    skillKey?: string;
    attributeKey: string;
    value: GenericFormulaExpr;
    valuePolicy: 'set' | 'multiply';
    valueType: 'DECIMAL' | 'INTEGER';
  }>;
};

export type GenericDamageTypeFormula = {
  damageType: string;
  formula: import('./formulaContract.generated').FormulaDefinition;
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
  /** 仅依赖实例时间的有期供值器必须提供；0 是合法施加时间。 */
  appliedAtMs?: number | null;
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
  basicAttack?: BasicAttackPlan;
  skillActions?: SkillActionPlan[];
  automaticSkills?: AutomaticSkillPlan;
};

export type AutomaticSkillRule = {
  ruleKey: string; bindingKey: string; sortOrder: number; target: 'source' | 'target';
  hitBindings: Array<{ hitBindingKey: string; preset: 'TARGET_HIT' | 'MISS' }>;
  waitForCooldowns: string[]; releaseAfterRuleKey: string | null;
};
export type AutomaticSkillPlan = { rules: AutomaticSkillRule[] };
export type AutomaticSkillWaitingReason = import('./skillSystemEnums.generated').AutomaticSkillWaitReason;
export type AutomaticSkillRecordKind = import('./skillSystemEnums.generated').AutomaticSkillRecordKind;
export type AutomaticSkillWaiting = {
  reason: AutomaticSkillWaitingReason; relatedRuleKeys: string[]; nextCheckAtMs: number | null;
};
export type AutomaticSkillCounts = {
  attemptCount: number; startedCount: number; rejectedCount: number; abortedBeforeStartCount: number;
  completedCount: number; failedCount: number; inFlightCount: number;
};
export type AutomaticSkillSummary = AutomaticSkillCounts & {
  ruleCount: number;
  rules: Array<AutomaticSkillCounts & { ruleKey: string; waiting: AutomaticSkillWaiting | null }>;
  qualifications: Array<{
    grantorRuleKey: string; consumerRuleKey: string; grantedCount: number; consumedCount: number; remainingCount: number;
    lastGrantUseRef: string | null; lastConsumeUseRef: string | null;
  }>;
};
export type AutomaticSkillRecord = {
  sequence: number; timeMs: number; kind: AutomaticSkillRecordKind; ruleKey: string;
  useRef: string | null; relatedRuleKey: string | null; relatedUseRef: string | null;
  reason: string | null; nextCheckAtMs: number | null;
};
export type AutomaticSkillRecording = {
  totalCount: number; returnedCount: number; omittedCount: number; droppedCount: number; truncated: boolean;
};

export type SkillActionBinding = {
  bindingKey: string; source: 'source'; providerRef: string; providerDefinitionRef: string; skillKey: string;
  controls: Array<{ action: SkillActionPhase; processKey: string; abilityRef: string }>;
  hitBindings: Array<{ hitBindingKey: string; processKey: string; moment: ProcessMomentDefinition; hitAbilityRef: string }>;
};

export type SkillActionPlan = {
  instructionKey: string; firstAtMs: number; sortOrder: number; source: 'source'; target: 'source' | 'target';
  skillKey: string; bindingKey: string; action: SkillActionPhase; abilityRef: string; parentInstructionKey?: string | null;
  hitBindings: Array<{ hitBindingKey: string; preset: 'TARGET_HIT' | 'MISS' }>;
};

export type BasicAttackPlan = {
  planKey: string;
  source: 'source';
  target: 'target';
  skillKey: string;
  startAbilityRef: string;
  hitAbilityRef: string;
  initialControlAbilityRef: string;
  attackSpeedAttributeKey: string;
  attackSpeedInputMax: number;
};

export type StopPolicy = {
  durationMs: number;
  stopOnTargetDeath: boolean;
  stopWhenNoEvents: boolean;
};

export type SamplingConfig = {
  disabled?: boolean;
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
  maxBasicAttacks?: number;
};

export type RecordBudget = { maxAttackRecords?: number; maxDamageRecords?: number; maxMechanicRecords?: number;
  maxSkillActionRecords?: number; maxSkillUseRecords?: number; maxHealingRecords?: number; maxAutomaticSkillRecords?: number };

export type ProcessControlAction = 'INITIAL' | 'RECAST' | 'CHARGE_RELEASE' | 'CANCEL' | 'INTERRUPT';
export type SkillActionPhase = Exclude<ProcessControlAction, 'INTERRUPT'>;

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
  /** 仅普攻开始监听器的首次过程控制可复用原生使用身份。 */
  useRefFromEvent?: boolean;
  /** 仅首次入口；要求原始目标明确指向真实来源，空目标不能回退满足。 */
  requireExplicitSelfTarget?: true;
};

export type ProcessStepType = 'IMMEDIATE' | 'DELAY' | 'CHARGE' | 'RECAST' | 'MULTI_HIT' | 'CHANNEL' | 'EMPOWERED_BASIC_ATTACK';

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
  occupiesAction?: boolean | null;
  repeatCount?: GenericFormulaExpr;
  intervalMs?: GenericFormulaExpr | null;
  durationMs?: GenericFormulaExpr;
  executionCount?: GenericFormulaExpr;
  firstExecution?: 'IMMEDIATE' | 'AFTER_INTERVAL' | 'CUSTOM_WINDOW';
  firstExecutionOffsetMs?: GenericFormulaExpr;
  lastExecutionOffsetMs?: GenericFormulaExpr;
  stepType: ProcessStepType;
  delayMs?: GenericFormulaExpr;
  minimumChargeMs?: GenericFormulaExpr;
  maximumChargeMs?: GenericFormulaExpr;
  releaseAtMaximum?: boolean;
  windowMs?: GenericFormulaExpr;
  consumeMoment?: 'ATTACK_HIT';
};

export type ProcessCostDefinition = {
  resourceKey: string;
  amount: GenericFormulaExpr;
};

export type ProcessCooldownDefinition = {
  durationMs: GenericFormulaExpr;
  startMoment: ProcessMomentDefinition;
  roundPositiveMs?: boolean;
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

export type ProcessRepeatSnapshot = {
  executionCount: number;
  executionIndex: number;
  intervalMs: number;
  firstExecutionOffsetMs: number;
  lastExecutionOffsetMs: number;
  nextExecutionAtMs: number | null;
};

export type ProcessActionOccupancy = {
  stepKey: string;
  stepVersion: number;
  startedAtMs: number;
  expectedEndAtMs: number;
  finishedAtMs: number | null;
};

export type EmpoweredAttackConsumption = { useRef: string; hitRef: string; target: string };

export type ProcessInstanceSnapshot = {
  owner: 'source' | 'target';
  providerRef: string;
  processKey: string;
  skillKey: string;
  useKey: string;
  target: 'source' | 'target';
  stepKey: string;
  stepVersion: number;
  stepExecutionIndex: number;
  lastExecutionAtMs: number | null;
  stepCompletedAtMs: number | null;
  startedAtMs: number;
  stepStartedAtMs: number;
  advanceAtMs: number;
  expiresAtMs: number | null;
  actualCosts: Record<string, number>;
  cooldownStarted: boolean;
  status: ProcessInstanceStatus;
  failureReason: ProcessFailureReason | null;
  finishedAtMs: number | null;
  repeat: ProcessRepeatSnapshot | null;
  actionOccupancies: ProcessActionOccupancy[];
  empoweredAttack?: EmpoweredAttackConsumption;
  /** 自动资格成功消费的真实直接前项；只运输含强化消费的因果链。 */
  empoweredPredecessorUseRef?: string;
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
  /** 省略返回完整明细；summary仅省略记录，采样仍独立控制。 */
  outputMode?: 'detailed' | 'summary';
  runtimeOptions?: {
    equipmentAssumptions: import('./simulationSnapshot').SimulationEquipmentAssumption[];
    skillOrigins?: Array<import('./simulationSnapshot').SimulationSkillSource & {
      side: 'source' | 'target'; providerRef?: string; definitionRef?: string;
    }>;
    mechanicStateInputs?: import('./simulationSnapshot').SimulationMechanicStateInput[];
  };
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
  recordBudget?: RecordBudget;
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
  basicAttack?: BasicAttackSummary;
  skillActions?: SkillActionSummary;
  skillUses?: SkillUseSummary;
  execution?: ExecutionSummary;
  sourceHpLoss?: number;
  targetHpLoss?: number;
  sourceVampHealing?: number;
  targetVampHealing?: number;
  sourceDirectHealing?: number;
  targetDirectHealing?: number;
  damageBreakdown?: DamageBreakdown[];
  abilityStats: Array<{
    abilityRef: string;
    attemptCount: number;
    castCount: number;
    skipCount: number;
    damageDealt?: number;
    healingDone?: number;
  }>;
};

export type BasicAttackSummary = { planKey: string; startedCount: number; hitCount: number; completedCount: number;
  initialMechanicReadyAtMs?: number | null; initialActionReadyAtMs: number | null };
export type SkillActionSummary = { plannedCount: number; reachedCount: number; acceptedCount: number; rejectedCount: number;
  abortedBeforeAcceptCount: number; unreachedCount: number };
export type SkillUseSummary = { startedCount: number; releasedCount: number; hitCount: number; completedCount: number;
  failedCount: number; inFlightCount: number; stepEnteredCount: number; stepExecutedCount: number; stepCompletedCount: number };
export type SkillActionRecord = {
  instructionKey: string; requestedAtMs: number; actualAtMs: number; action: SkillActionPhase; source: string; target: string;
  parentInstructionKey: string | null;
  skillKey: string; bindingKey: string; providerRef: string; providerDefinitionRef: string;
  outcome: 'ACCEPTED' | 'REJECTED' | 'ABORTED_BEFORE_ACCEPT'; reason: string | null; useRef: string | null;
};
export type SkillUseRecordKind = 'STARTED' | 'RELEASED' | 'HIT' | 'COMPLETED' | 'FAILED' | 'STEP_ENTERED' | 'STEP_EXECUTED' | 'STEP_COMPLETED';
export type SkillUseRecord = {
  instructionKey: string; timeMs: number; kind: SkillUseRecordKind;
  empoweredAttack?: EmpoweredAttackConsumption;
  source: string; target: string; skillKey: string; providerRef: string; processKey: string; useRef: string;
  hitRef: string | null; reason: string | null;
  stepKey: string; stepVersion: number; executionIndex: number;
};
export type HealingRecord = {
  timeMs: number; source: string; target: string; abilityRef: string; operationRef: string; useRef: string | null;
  instructionKey: string | null; rawAmount: number; healingAfterDone: number; healingAfterModifiers: number;
  actualHealing: number; overheal: number; hpBefore: number; hpAfter: number;
};
export type BudgetCause = 'max_events' | 'max_commands_per_event' | 'max_chain_depth' | 'max_queue_events'
  | 'max_process_instances' | 'max_skill_hits' | 'max_basic_attacks' | 'max_use_trigger_ledger';
export type ExecutionSummary = {
  requestedDurationMs: number;
  complete: boolean;
  incompleteReason: 'budget_exceeded' | 'unfinished_tail' | null;
  budgetCause: BudgetCause | null;
  targetKilled: boolean;
  targetKilledAtMs: number | null;
};
export type AttackRecord = {
  planKey: string; attackIndex: number; useRef: string; source: string; target: string; skillKey: string;
  startAtMs: number; hitAtMs: number | null; readyAtMs: number | null; finalReadyAtMs: number | null; nextStartAtMs: number | null;
  mechanicReadyAtMs: number | null;
  actionReadyAtMs: number | null;
  attackSpeed: number; postDefenseDamage: number; actualHpLoss: number;
  sourceHpAfter: number; targetHpAfter: number; completed: boolean;
};
export type DamageBreakdown = {
  providerDefinitionRef?: string;
  owner: string; source: string; target: string; abilityRef: string; operationRef: string; damageType: string;
  damageCount: number; postDefenseDamage: number; shieldAbsorbed: number; actualHpLoss: number; overkillDamage: number;
};
export type DamageRecord = Omit<DamageBreakdown, 'damageCount'> & {
  empoweredAttack?: EmpoweredAttackConsumption;
  providerActivatedAtMs?: number;
  damageId: number; attackIndex: number | null; useRef: string; instructionKey?: string | null; hitRef?: string | null;
  timeMs: number; castInstanceId: number; operationPath: string;
  rawAmount: number; hpBefore: number; hpAfter: number;
  sourceHpBefore: number | null; sourceHpAfter: number | null;
  eligible?: boolean; policy?: string; baseRawAmount?: number; originalCritChance?: number;
  effectiveCritChance?: number; multiplier?: number; normalPart?: number; critPart?: number;
  critAdjustedRawAmount?: number; normalPartPostResistance?: number; critPartPostResistance?: number;
  resistanceFactor?: number; modifiers?: Record<string, unknown>[];
};
export type RecordingSummary = {
  skillActionRecordCount?: number; returnedSkillActionRecords?: number; droppedSkillActionRecords?: number; skillActionRecordsTruncated?: boolean;
  skillUseRecordCount?: number; returnedSkillUseRecords?: number; droppedSkillUseRecords?: number; skillUseRecordsTruncated?: boolean;
  healingRecordCount?: number; returnedHealingRecords?: number; droppedHealingRecords?: number; healingRecordsTruncated?: boolean;
  attackRecordCount: number; returnedAttackRecords: number; droppedAttackRecords: number; attackRecordsTruncated: boolean;
  damageRecordCount: number; returnedDamageRecords: number; droppedDamageRecords: number; damageRecordsTruncated: boolean;
  mechanicRecordCount: number; returnedMechanicRecords: number; droppedMechanicRecords: number; mechanicRecordsTruncated: boolean;
};

export type MechanicRecord = {
  timeMs: number; kind: 'STATE_CHANGED' | 'WAIT_STARTED' | 'WAIT_ENDED'; owner: 'source' | 'target';
  providerRef: string; providerDefinitionRef: string; skillKey: string; stateKey: string;
  beforeValue: number; afterValue: number; operationRef: string; useRef: string | null; readyAtMs: number | null;
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
  requestedSampleEveryMs: number;
  effectiveSampleEveryMs: number;
  requestedPointCount: number;
  finalPointCount: number;
  maxSeriesPoints: number;
  downsampled: boolean;
  method: 'disabled' | 'uniform_time';
};

export type DoneResult = {
  /** summary表示未请求明细；预算丢弃量仍按原记录预算核对。 */
  outputMode?: 'summary';
  ok: boolean;
  summary: RunSummary;
  finalSnapshot: InitialSnapshot;
  series: SeriesPoint[];
  warnings: WarningItem[];
  evidence: EvidenceCollection;
  seriesSamplingEvidence: SeriesSamplingEvidence;
  attackRecords?: AttackRecord[];
  damageRecords?: DamageRecord[];
  mechanicRecords?: MechanicRecord[];
  skillActionRecords?: SkillActionRecord[];
  skillUseRecords?: SkillUseRecord[];
  healingRecords?: HealingRecord[];
  recording?: RecordingSummary;
  automaticSkillSummary?: AutomaticSkillSummary;
  automaticSkillRecords?: AutomaticSkillRecord[];
  automaticSkillRecording?: AutomaticSkillRecording;
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
