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

export type CompileRequest = {
  schemaVersion: string;
  schemaHash: string;
  rulesHash: string;
  typeCatalog: {
    types: Array<{ key: string; domain: string; group?: string }>;
    relations: Array<{ parent: string; child: string }>;
  };
  combatants: unknown[];
  sharedProviders?: unknown[];
  rules: Record<string, unknown>;
  formulas?: unknown[];
  settings?: Record<string, unknown>;
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

export type RunRequest = {
  sessionId: string;
  expectedRulesHash?: string;
  schemaVersion?: string;
  schemaHash?: string;
  rulesHash?: string;
  initialSnapshot: Record<string, unknown>;
  driverPlan: Record<string, unknown>;
  stopPolicy: Record<string, unknown>;
  sampling?: Record<string, unknown>;
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

export type DoneResult = {
  ok: boolean;
  summary: RunSummary;
  finalSnapshot: Record<string, unknown>;
  series: SeriesPoint[];
  warnings: WarningItem[];
  evidence: EvidenceCollection;
  seriesSamplingEvidence: Record<string, unknown>;
};

export type GenericReleaseDonePayload = {
  ok: boolean;
  sessionId: string;
  released: boolean;
};
