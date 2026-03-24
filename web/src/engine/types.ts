import type { GameDataBundle } from '../types/api';

export type EngineMeta = {
  gameId: string;
  versionId: number;
  dataHash: string;
};

export type EngineBundle = GameDataBundle;

export type EngineError = {
  code: 'INVALID_INPUT' | 'SEMANTIC_ERROR' | 'RUNTIME_ERROR';
  message: string;
  details?: unknown;
};

export type CombatantInit = {
  heroId: string;
  level?: number;
  itemIds?: string[];
};

export type CombatantOverride = {
  baseStats?: Record<string, number>;
  addItemIds?: string[];
  removeItemIds?: string[];
};

export type BasicAttackPlan = {
  type: 'basic_attack';
  count: number;
  skillId?: string;
};

export type CastSkillPlan = {
  type: 'cast_skill';
  skillId: string;
  skillLevel?: number;
  castCount?: number;
};

export type EngineActionPlan = BasicAttackPlan | CastSkillPlan;

export type DamageType = 'physical' | 'magic' | 'true';

export type EngineDamageComponent = {
  sourceKind: 'basic_attack' | 'skill' | 'item';
  sourceId: string;
  label: string;
  damageType: DamageType;
  rawDamage: number;
  dealtDamage: number;
};

export type EngineDamageEvent = {
  sequence: number;
  tMs: number;
  label: string;
  enemyHpBefore: number;
  enemyHpAfter: number;
  totalRawDamage: number;
  totalDealtDamage: number;
  components: EngineDamageComponent[];
};

export type EngineRunInput = {
  seed?: number;
  stop: {
    maxSeconds: number;
  };
  initial: {
    self: CombatantInit;
    enemy: CombatantInit;
  };
  overrides?: {
    self?: CombatantOverride;
    enemy?: CombatantOverride;
  };
  plan: EngineActionPlan;
};

export type EngineSamplePoint = {
  tMs: number;
  selfHp: number;
  enemyHp: number;
  cumulativeDamageToEnemy: number;
  cumulativeDamageToSelf: number;
};

export type EngineRunResult = {
  stopReason: 'enemyDead' | 'selfDead' | 'maxSeconds' | 'cancelled' | 'error' | 'completed';
  timeToKillEnemyMs?: number;
  timeToDieMs?: number;
  totalDamageToEnemy: number;
  totalDamageToSelf: number;
  executedHits: number;
  actionDurationMs: number;
  actionLabel: string;
  lastSample?: EngineSamplePoint;
};

export type EngineInitMessage = {
  type: 'init';
  meta: EngineMeta;
  bundle: EngineBundle;
  engineConfig?: {
    hpAttrKey?: string;
  };
};

export type EngineRunMessage = {
  type: 'run';
  runId: string;
  input: EngineRunInput;
};

export type EngineCancelMessage = {
  type: 'cancel';
  runId: string;
};

export type WasmToEngineMessage = EngineInitMessage | EngineRunMessage | EngineCancelMessage;

export type EngineReadyMessage = {
  type: 'ready';
  meta: EngineMeta;
};

export type EngineTickMessage = {
  type: 'tick';
  runId: string;
  seq: number;
  emittedAt: string;
  progress: {
    simulatedMs: number;
  };
  samples: EngineSamplePoint[];
};

export type EngineDoneMessage = {
  type: 'done';
  runId: string;
  emittedAt: string;
  result: EngineRunResult;
  events: EngineDamageEvent[];
};

export type EngineErrorMessage = {
  type: 'error';
  runId?: string;
  emittedAt: string;
  error: EngineError;
};

export type EngineToWasmMessage =
  | EngineReadyMessage
  | EngineTickMessage
  | EngineDoneMessage
  | EngineErrorMessage;

export type EngineRunOutput = {
  result: EngineRunResult;
  samples: EngineSamplePoint[];
  events: EngineDamageEvent[];
};
