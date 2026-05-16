import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Grid, Input, InputNumber, Select, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { IconCopy, IconRefresh } from '@arco-design/web-react/icon';
import { EmptyState } from '../components/EmptyState';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import {
  compileTinyGoV2ValidationInput,
  createDefaultWasmValidationSelection,
  listWasmValidationSkills,
  type TinyGoV2ActionRequest,
  type TinyGoV2ValidationInput,
  type WasmValidationSelection,
  type WasmValidationSkillOption
} from '../engine/tinygoV2BundleAdapter';
import { TinyGoV2Bridge, decodeFramePayload, type TinyGoV2Frame } from '../engine/tinygoV2Bridge';
import { getErrorMessage } from '../services/apiClient';
import { loadPublishedBundleSnapshot } from '../services/bundleSnapshot';
import type { CurrentVersion, GameDataBundle, LoadState } from '../types/api';

type WasmValidationM3PageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
  externalRefreshSeed: number;
};

type ReadyPayload = {
  schemaVersion: number;
  actorCount: number;
  actionCount: number;
  formulaCount: number;
  resourceCount?: number;
};

type ResourceSnapshot = {
  current: number;
  max: number;
};

type ActorSnapshot = {
  actorId: string;
  currentHp: number;
  maxHp: number;
  shieldAmount: number;
  resources?: Record<string, ResourceSnapshot>;
};

type ActionValueBreakdownStep = {
  formulaId?: string;
  op: string;
  ref?: string;
  value: number;
};

type ActionCooldownRunState = {
  cooldownMs: number;
  cooldownFormulaId?: string;
  cooldownBreakdown?: ActionValueBreakdownStep[];
  readyAtMs: number;
};

type ActionResourceDelta = {
  resourceId: string;
  before: number;
  after: number;
  delta: number;
};

type ActionEffectRunResult = {
  effectIndex: number;
  kind: string;
  formulaId?: string;
  formulaBreakdown?: ActionValueBreakdownStep[];
  rawAmount?: number;
  hasRawAmount?: boolean;
  damageType?: string;
  statusId?: string;
  finalDamage?: number;
  hasFinalDamage?: boolean;
  markId?: string;
  markActive?: boolean;
  hasMarkState?: boolean;
  markCount?: number;
  critRoll?: number;
  hasCritRoll?: boolean;
  critResult?: boolean;
  hasCritResult?: boolean;
  critMultiplier?: number;
  hasCritMultiplier?: boolean;
  interruptedActionId?: string;
  hasInterrupt?: boolean;
  historyWindowMs?: number;
  hasHistoryWindow?: boolean;
  counterKey?: string;
  counterBefore?: number;
  counterAfter?: number;
  hasCounterState?: boolean;
  modeAugmentId?: string;
  modeActive?: boolean;
  modeMultiplier?: number;
  hasModeState?: boolean;
  healApplied?: number;
  hasHealApplied?: boolean;
  overhealAmount?: number;
  hasOverheal?: boolean;
  shieldBefore?: number;
  hasShieldBefore?: boolean;
  shieldAfter?: number;
  hasShieldAfter?: boolean;
  shieldGranted?: number;
  hasShieldGranted?: boolean;
  shieldAbsorbed?: number;
  hasShieldAbsorbed?: boolean;
  targetHpBefore?: number;
  targetHpAfter?: number;
  sourceActorId?: string;
  targetActorId?: string;
};

type ActionRunResult = {
  timeMs: number;
  actionId: string;
  sourceActorId: string;
  targetActorId: string;
  accepted: boolean;
  blockedReason?: string;
  blockedRuleId?: string;
  blockedStatusId?: string;
  conditionKind?: string;
  conditionId?: string;
  conditionPassed?: boolean;
  hasCondition?: boolean;
  executionStarted?: boolean;
  executionCompleted?: boolean;
  interrupted?: boolean;
  executionCompleteAtMs?: number;
  resourceDeltas?: ActionResourceDelta[];
  cooldownBefore?: ActionCooldownRunState;
  cooldownAfter?: ActionCooldownRunState;
  effects?: ActionEffectRunResult[];
};

type StatusTickRunResult = {
  timeMs: number;
  statusId: string;
  tickIndex: number;
  tickCount: number;
  kind: string;
  formulaId?: string;
  rawAmount?: number;
  hasRawAmount?: boolean;
  damageType?: string;
  finalDamage?: number;
  hasFinalDamage?: boolean;
  healApplied?: number;
  hasHealApplied?: boolean;
  overhealAmount?: number;
  hasOverheal?: boolean;
  targetHpBefore?: number;
  targetHpAfter?: number;
  sourceActorId?: string;
  targetActorId?: string;
};

type RNGDraw = {
  stream: string;
  index: number;
  use: string;
  value: number;
};

type TriggerRunResult = {
  timeMs: number;
  triggerId: string;
  event: string;
  sourceActorId?: string;
  targetActorId?: string;
  effectCount: number;
  chainDepth: number;
};

type DonePayload = {
  stopReason: string;
  finalTimeMs: number;
  processedEvents: number;
  queuePeak: number;
  chainDepthPeak: number;
  actors: ActorSnapshot[];
  logs?: Array<Record<string, unknown>>;
  actionResults?: ActionRunResult[];
  tickResults?: StatusTickRunResult[];
  triggerResults?: TriggerRunResult[];
  rng?: RNGDraw[];
};

type DecodedFrame = {
  stage: string;
  kind: number;
  kindLabel: string;
  payload: unknown;
};

type BaselineInput = Record<string, unknown>;

type EvidenceStatus = 'match' | 'diff' | 'low_confidence' | 'missing_evidence';

type EvidenceRow = {
  field: string;
  wasmValue: unknown;
  baselineValue: unknown;
  tolerance: string;
  status: EvidenceStatus;
  evidenceRef: string;
  note: string;
};

type ActionOptionRow = WasmValidationSkillOption & {
  displayLabel: string;
};

type ValidationCasePresetId =
  | 'm3_single_skill'
  | 'm4_direct_damage_regression'
  | 'm4_insufficient_resource_gate'
  | 'm4_cooldown_gate'
  | 'm4_shield_min'
  | 'm4_heal_min'
  | 'm4_mark_apply'
  | 'm4_conditional_hit'
  | 'm4_dot_min'
  | 'm4_hot_min'
  | 'm4_multi_hit_damage'
  | 'm4_crit_min'
  | 'm4_rng_seed'
  | 'm4_control_min'
  | 'm4_interrupt_min'
  | 'm4_trigger_chain_min'
  | 'm4_history_window_min'
  | 'm4_counter_min'
  | 'm4_mode_augment_min'
  | 'm4_action_gate';

type ValidationCaseRunMode = 'single' | 'self_target' | 'repeat_same_tick' | 'self_then_enemy_unowned';

type ValidationCasePreset = {
  id: ValidationCasePresetId;
  label: string;
  milestone: 'M3' | 'M4';
  caseId: string;
  runMode?: ValidationCaseRunMode;
  expectedBlockedReason?: string;
  selfResourceOverride?: {
    resourceId: string;
    current: number;
    max: number;
  };
};

const TINYGO_V2_WASM_URL = new URL('../engine/wasm/tinygo_engine_v2.wasm', import.meta.url);
const DONE_FRAME_KIND = 13;

const CASE_PRESETS: ValidationCasePreset[] = [
  {
    id: 'm4_direct_damage_regression',
    label: 'M4.1 直伤回归',
    milestone: 'M4',
    caseId: 'M4.1-direct-damage-regression-001'
  },
  {
    id: 'm4_insufficient_resource_gate',
    label: 'M4.2 资源不足',
    milestone: 'M4',
    caseId: 'M4.2-insufficient-resource-gate-001',
    expectedBlockedReason: 'insufficient resource',
    selfResourceOverride: {
      resourceId: 'mana',
      current: 50,
      max: 843
    }
  },
  {
    id: 'm4_cooldown_gate',
    label: 'M4.3 冷却 gate',
    milestone: 'M4',
    caseId: 'M4.3-cooldown-gate-001',
    runMode: 'repeat_same_tick',
    expectedBlockedReason: 'cooldown'
  },
  {
    id: 'm4_shield_min',
    label: 'M4.4 护盾',
    milestone: 'M4',
    caseId: 'M4.4-shield-min-001',
    runMode: 'self_target'
  },
  {
    id: 'm4_heal_min',
    label: 'M4.5 治疗',
    milestone: 'M4',
    caseId: 'M4.5-heal-min-001',
    runMode: 'self_target'
  },
  {
    id: 'm4_mark_apply',
    label: 'M4.6 标记施加',
    milestone: 'M4',
    caseId: 'M4.6-mark-apply-001'
  },
  {
    id: 'm4_conditional_hit',
    label: 'M4.7 条件命中',
    milestone: 'M4',
    caseId: 'M4.7-conditional-hit-001'
  },
  {
    id: 'm4_dot_min',
    label: 'M4.8 DoT',
    milestone: 'M4',
    caseId: 'M4.8-dot-min-001'
  },
  {
    id: 'm4_hot_min',
    label: 'M4.9 HoT',
    milestone: 'M4',
    caseId: 'M4.9-hot-min-001',
    runMode: 'self_target'
  },
  {
    id: 'm4_multi_hit_damage',
    label: 'M4.10 多段伤害',
    milestone: 'M4',
    caseId: 'M4.10-multi-hit-damage-001'
  },
  {
    id: 'm4_crit_min',
    label: 'M4.11 暴击',
    milestone: 'M4',
    caseId: 'M4.11-crit-min-001'
  },
  {
    id: 'm4_rng_seed',
    label: 'M4.12 随机数',
    milestone: 'M4',
    caseId: 'M4.12-rng-seed-001'
  },
  {
    id: 'm4_control_min',
    label: 'M4.13 控制',
    milestone: 'M4',
    caseId: 'M4.13-control-min-001'
  },
  {
    id: 'm4_interrupt_min',
    label: 'M4.14 打断',
    milestone: 'M4',
    caseId: 'M4.14-interrupt-min-001'
  },
  {
    id: 'm4_trigger_chain_min',
    label: 'M4.16 触发链',
    milestone: 'M4',
    caseId: 'M4.16-trigger-chain-min-001'
  },
  {
    id: 'm4_history_window_min',
    label: 'M4.17 历史窗口',
    milestone: 'M4',
    caseId: 'M4.17-history-window-min-001'
  },
  {
    id: 'm4_counter_min',
    label: 'M4.18 计数器',
    milestone: 'M4',
    caseId: 'M4.18-counter-min-001'
  },
  {
    id: 'm4_mode_augment_min',
    label: 'M4.19 模式强化',
    milestone: 'M4',
    caseId: 'M4.19-mode-augment-min-001'
  },
  {
    id: 'm4_action_gate',
    label: 'M4.15 动作 gate',
    milestone: 'M4',
    caseId: 'M4.15-action-gate-001',
    runMode: 'self_then_enemy_unowned',
    expectedBlockedReason: 'action_not_owned'
  },
  {
    id: 'm3_single_skill',
    label: 'M3 单技能',
    milestone: 'M3',
    caseId: 'M3-single-skill-dummy-canonical-001'
  }
];

const FRAME_KIND_LABELS: Record<number, string> = {
  11: 'log',
  12: 'sample',
  13: 'done',
  14: 'error',
  15: 'ready',
  16: 'snapshot',
  17: 'action_snapshot'
};

const { Row, Col } = Grid;

function decodeFrames(frames: TinyGoV2Frame[], stage: string): DecodedFrame[] {
  return frames.map((frame) => ({
    stage,
    kind: frame.kind,
    kindLabel: FRAME_KIND_LABELS[frame.kind] ?? `kind ${frame.kind}`,
    payload: decodeFramePayload<unknown>(frame)
  }));
}

function getPayload<T>(frames: DecodedFrame[], kind: number): T | null {
  const frame = [...frames].reverse().find((candidate) => candidate.kind === kind);
  return frame ? (frame.payload as T) : null;
}

function parseBaseline(text: string): { baseline: BaselineInput | null; error: string | null } {
  if (!text.trim()) {
    return { baseline: null, error: null };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { baseline: null, error: '人工基线必须是 JSON 对象。' };
    }
    return { baseline: parsed as BaselineInput, error: null };
  } catch (error) {
    return { baseline: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function readBaselineValue(baseline: BaselineInput | null, field: string): unknown {
  if (!baseline) {
    return undefined;
  }
  const fields = baseline.fields;
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    const nested = (fields as Record<string, unknown>)[field];
    if (nested && typeof nested === 'object' && !Array.isArray(nested) && 'baselineValue' in nested) {
      return (nested as Record<string, unknown>).baselineValue;
    }
    if (nested !== undefined) {
      return nested;
    }
  }
  return baseline[field];
}

function buildEvidenceRow(
  baseline: BaselineInput | null,
  field: string,
  wasmValue: unknown,
  evidenceRef: string,
  note = '',
  tolerance = '0'
): EvidenceRow {
  const baselineValue = readBaselineValue(baseline, field);
  let status: EvidenceStatus = 'missing_evidence';
  if (baselineValue !== undefined) {
    status = JSON.stringify(baselineValue) === JSON.stringify(wasmValue) ? 'match' : 'diff';
  }
  return { field, wasmValue, baselineValue: baselineValue ?? '', tolerance, status, evidenceRef, note };
}

function findActorSnapshot(done: DonePayload, actorId: string): ActorSnapshot | null {
  return done.actors.find((actor) => actor.actorId === actorId) ?? null;
}

function appendActorOutcomeRows(rows: EvidenceRow[], baseline: BaselineInput | null, done: DonePayload): void {
  for (const actorId of ['self', 'enemy']) {
    const actor = findActorSnapshot(done, actorId);
    if (!actor) {
      continue;
    }
    rows.push(buildEvidenceRow(baseline, `actor.${actorId}.hp.after`, actor.currentHp, `done.actors.${actorId}.currentHp`));
    rows.push(buildEvidenceRow(baseline, `actor.${actorId}.shield.after`, actor.shieldAmount, `done.actors.${actorId}.shieldAmount`));
    for (const [resourceId, resource] of Object.entries(actor.resources ?? {})) {
      rows.push(buildEvidenceRow(baseline, `actor.${actorId}.resource.${resourceId}.current`, resource.current, `done.actors.${actorId}.resources.${resourceId}.current`));
      rows.push(buildEvidenceRow(baseline, `actor.${actorId}.resource.${resourceId}.max`, resource.max, `done.actors.${actorId}.resources.${resourceId}.max`));
    }
  }
}

function appendActionResultRows(
  rows: EvidenceRow[],
  baseline: BaselineInput | null,
  result: ActionRunResult,
  prefixes: {
    action: string;
    resource: string;
    cooldown: string;
    effect: string;
    evidence: string;
  }
): void {
  rows.push(buildEvidenceRow(baseline, `${prefixes.action}.timeMs`, result.timeMs, `${prefixes.evidence}.timeMs`));
  rows.push(buildEvidenceRow(baseline, `${prefixes.action}.accepted`, result.accepted, `${prefixes.evidence}.accepted`));
  rows.push(
    buildEvidenceRow(baseline, `${prefixes.action}.blockedReason`, result.blockedReason ?? '', `${prefixes.evidence}.blockedReason`, '空字符串表示未阻塞')
  );
  rows.push(buildEvidenceRow(baseline, `${prefixes.action}.blockedRuleId`, result.blockedRuleId ?? '', `${prefixes.evidence}.blockedRuleId`));
  rows.push(buildEvidenceRow(baseline, `${prefixes.action}.blockedStatusId`, result.blockedStatusId ?? '', `${prefixes.evidence}.blockedStatusId`));
  if (result.hasCondition) {
    rows.push(buildEvidenceRow(baseline, `${prefixes.action}.condition.kind`, result.conditionKind ?? '', `${prefixes.evidence}.conditionKind`));
    rows.push(buildEvidenceRow(baseline, `${prefixes.action}.condition.id`, result.conditionId ?? '', `${prefixes.evidence}.conditionId`));
    rows.push(buildEvidenceRow(baseline, `${prefixes.action}.condition.passed`, Boolean(result.conditionPassed), `${prefixes.evidence}.conditionPassed`));
  }
  if (result.executionStarted || result.executionCompleted || result.interrupted) {
    rows.push(buildEvidenceRow(baseline, `${prefixes.action}.executionStarted`, Boolean(result.executionStarted), `${prefixes.evidence}.executionStarted`));
    rows.push(buildEvidenceRow(baseline, `${prefixes.action}.executionCompleted`, Boolean(result.executionCompleted), `${prefixes.evidence}.executionCompleted`));
    rows.push(buildEvidenceRow(baseline, `${prefixes.action}.interrupted`, Boolean(result.interrupted), `${prefixes.evidence}.interrupted`));
    rows.push(buildEvidenceRow(baseline, `${prefixes.action}.executionCompleteAtMs`, result.executionCompleteAtMs ?? '', `${prefixes.evidence}.executionCompleteAtMs`));
  }

  for (const delta of result.resourceDeltas ?? []) {
    rows.push(buildEvidenceRow(baseline, `${prefixes.resource}.${delta.resourceId}.before`, delta.before, `${prefixes.evidence}.resourceDeltas.${delta.resourceId}.before`));
    rows.push(buildEvidenceRow(baseline, `${prefixes.resource}.${delta.resourceId}.after`, delta.after, `${prefixes.evidence}.resourceDeltas.${delta.resourceId}.after`));
    rows.push(buildEvidenceRow(baseline, `${prefixes.resource}.${delta.resourceId}.delta`, delta.delta, `${prefixes.evidence}.resourceDeltas.${delta.resourceId}.delta`));
  }

  if (result.cooldownBefore) {
    rows.push(buildEvidenceRow(baseline, `${prefixes.cooldown}.before.cooldownMs`, result.cooldownBefore.cooldownMs, `${prefixes.evidence}.cooldownBefore.cooldownMs`));
    rows.push(buildEvidenceRow(baseline, `${prefixes.cooldown}.before.readyAtMs`, result.cooldownBefore.readyAtMs, `${prefixes.evidence}.cooldownBefore.readyAtMs`));
  }
  if (result.cooldownAfter) {
    rows.push(buildEvidenceRow(baseline, `${prefixes.cooldown}.after.cooldownMs`, result.cooldownAfter.cooldownMs, `${prefixes.evidence}.cooldownAfter.cooldownMs`));
    rows.push(buildEvidenceRow(baseline, `${prefixes.cooldown}.after.readyAtMs`, result.cooldownAfter.readyAtMs, `${prefixes.evidence}.cooldownAfter.readyAtMs`));
  }

  for (const effect of result.effects ?? []) {
    const prefix = `${prefixes.effect}.${effect.effectIndex}`;
    rows.push(buildEvidenceRow(baseline, `${prefix}.kind`, effect.kind, `${prefixes.evidence}.effects[${effect.effectIndex}].kind`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.formulaId`, effect.formulaId ?? '', `${prefixes.evidence}.effects[${effect.effectIndex}].formulaId`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.statusId`, effect.statusId ?? '', `${prefixes.evidence}.effects[${effect.effectIndex}].statusId`));
    if (effect.hasRawAmount) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.rawAmount`, effect.rawAmount ?? 0, `${prefixes.evidence}.effects[${effect.effectIndex}].rawAmount`));
    }
    if (effect.hasFinalDamage) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.finalDamage`, effect.finalDamage ?? 0, `${prefixes.evidence}.effects[${effect.effectIndex}].finalDamage`));
    }
    if (effect.hasMarkState) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.markId`, effect.markId ?? '', `${prefixes.evidence}.effects[${effect.effectIndex}].markId`));
      rows.push(buildEvidenceRow(baseline, `${prefix}.markActive`, Boolean(effect.markActive), `${prefixes.evidence}.effects[${effect.effectIndex}].markActive`));
      rows.push(buildEvidenceRow(baseline, `${prefix}.markCount`, effect.markCount ?? 0, `${prefixes.evidence}.effects[${effect.effectIndex}].markCount`));
    }
    if (effect.hasCritRoll) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.critRoll`, effect.critRoll ?? 0, `${prefixes.evidence}.effects[${effect.effectIndex}].critRoll`));
    }
    if (effect.hasCritResult) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.critResult`, Boolean(effect.critResult), `${prefixes.evidence}.effects[${effect.effectIndex}].critResult`));
    }
    if (effect.hasCritMultiplier) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.critMultiplier`, effect.critMultiplier ?? 0, `${prefixes.evidence}.effects[${effect.effectIndex}].critMultiplier`));
    }
    if (effect.hasInterrupt) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.interruptedActionId`, effect.interruptedActionId ?? '', `${prefixes.evidence}.effects[${effect.effectIndex}].interruptedActionId`));
    }
    if (effect.hasHistoryWindow) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.historyWindowMs`, effect.historyWindowMs ?? 0, `${prefixes.evidence}.effects[${effect.effectIndex}].historyWindowMs`));
    }
    if (effect.hasCounterState) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.counterKey`, effect.counterKey ?? '', `${prefixes.evidence}.effects[${effect.effectIndex}].counterKey`));
      rows.push(buildEvidenceRow(baseline, `${prefix}.counterBefore`, effect.counterBefore ?? 0, `${prefixes.evidence}.effects[${effect.effectIndex}].counterBefore`));
      rows.push(buildEvidenceRow(baseline, `${prefix}.counterAfter`, effect.counterAfter ?? 0, `${prefixes.evidence}.effects[${effect.effectIndex}].counterAfter`));
    }
    if (effect.hasModeState) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.modeAugmentId`, effect.modeAugmentId ?? '', `${prefixes.evidence}.effects[${effect.effectIndex}].modeAugmentId`));
      rows.push(buildEvidenceRow(baseline, `${prefix}.modeActive`, Boolean(effect.modeActive), `${prefixes.evidence}.effects[${effect.effectIndex}].modeActive`));
      rows.push(buildEvidenceRow(baseline, `${prefix}.modeMultiplier`, effect.modeMultiplier ?? 0, `${prefixes.evidence}.effects[${effect.effectIndex}].modeMultiplier`));
    }
    if (effect.hasHealApplied) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.healApplied`, effect.healApplied ?? 0, `${prefixes.evidence}.effects[${effect.effectIndex}].healApplied`));
    }
    if (effect.hasOverheal) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.overhealAmount`, effect.overhealAmount ?? 0, `${prefixes.evidence}.effects[${effect.effectIndex}].overhealAmount`));
    }
    if (effect.hasShieldBefore) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.shieldBefore`, effect.shieldBefore ?? 0, `${prefixes.evidence}.effects[${effect.effectIndex}].shieldBefore`));
    }
    if (effect.hasShieldAfter) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.shieldAfter`, effect.shieldAfter ?? 0, `${prefixes.evidence}.effects[${effect.effectIndex}].shieldAfter`));
    }
    if (effect.hasShieldGranted) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.shieldGranted`, effect.shieldGranted ?? 0, `${prefixes.evidence}.effects[${effect.effectIndex}].shieldGranted`));
    }
    if (effect.hasShieldAbsorbed) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.shieldAbsorbed`, effect.shieldAbsorbed ?? 0, `${prefixes.evidence}.effects[${effect.effectIndex}].shieldAbsorbed`));
    }
    rows.push(buildEvidenceRow(baseline, `${prefix}.damageType`, effect.damageType ?? '', `${prefixes.evidence}.effects[${effect.effectIndex}].damageType`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.targetHpBefore`, effect.targetHpBefore ?? '', `${prefixes.evidence}.effects[${effect.effectIndex}].targetHpBefore`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.targetHpAfter`, effect.targetHpAfter ?? '', `${prefixes.evidence}.effects[${effect.effectIndex}].targetHpAfter`));
  }
}

function appendTickResultRows(rows: EvidenceRow[], baseline: BaselineInput | null, done: DonePayload): void {
  for (const [index, tick] of (done.tickResults ?? []).entries()) {
    const prefix = `tickResults.${index}`;
    const evidence = `done.tickResults[${index}]`;
    rows.push(buildEvidenceRow(baseline, `${prefix}.timeMs`, tick.timeMs, `${evidence}.timeMs`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.statusId`, tick.statusId, `${evidence}.statusId`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.tickIndex`, tick.tickIndex, `${evidence}.tickIndex`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.tickCount`, tick.tickCount, `${evidence}.tickCount`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.kind`, tick.kind, `${evidence}.kind`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.formulaId`, tick.formulaId ?? '', `${evidence}.formulaId`));
    if (tick.hasRawAmount) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.rawAmount`, tick.rawAmount ?? 0, `${evidence}.rawAmount`));
    }
    if (tick.hasFinalDamage) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.finalDamage`, tick.finalDamage ?? 0, `${evidence}.finalDamage`));
    }
    if (tick.hasHealApplied) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.healApplied`, tick.healApplied ?? 0, `${evidence}.healApplied`));
    }
    if (tick.hasOverheal) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.overhealAmount`, tick.overhealAmount ?? 0, `${evidence}.overhealAmount`));
    }
    rows.push(buildEvidenceRow(baseline, `${prefix}.damageType`, tick.damageType ?? '', `${evidence}.damageType`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.targetHpBefore`, tick.targetHpBefore ?? '', `${evidence}.targetHpBefore`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.targetHpAfter`, tick.targetHpAfter ?? '', `${evidence}.targetHpAfter`));
  }
}

function appendTriggerRows(rows: EvidenceRow[], baseline: BaselineInput | null, done: DonePayload): void {
  for (const [index, trigger] of (done.triggerResults ?? []).entries()) {
    const prefix = `triggerResults.${index}`;
    const evidence = `done.triggerResults[${index}]`;
    rows.push(buildEvidenceRow(baseline, `${prefix}.timeMs`, trigger.timeMs, `${evidence}.timeMs`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.triggerId`, trigger.triggerId, `${evidence}.triggerId`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.event`, trigger.event, `${evidence}.event`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.effectCount`, trigger.effectCount, `${evidence}.effectCount`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.chainDepth`, trigger.chainDepth, `${evidence}.chainDepth`));
  }
}

function appendRngRows(rows: EvidenceRow[], baseline: BaselineInput | null, done: DonePayload): void {
  for (const [index, draw] of (done.rng ?? []).entries()) {
    const prefix = `rng.${index}`;
    const evidence = `done.rng[${index}]`;
    rows.push(buildEvidenceRow(baseline, `${prefix}.stream`, draw.stream, `${evidence}.stream`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.index`, draw.index, `${evidence}.index`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.use`, draw.use, `${evidence}.use`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.value`, draw.value, `${evidence}.value`));
  }
}

function buildEvidenceRows(done: DonePayload | null, baseline: BaselineInput | null): EvidenceRow[] {
  if (!done) {
    return [];
  }
  const rows: EvidenceRow[] = [
    buildEvidenceRow(baseline, 'run.stopReason', done.stopReason, 'done.stopReason', ''),
    buildEvidenceRow(baseline, 'run.processedEvents', done.processedEvents, 'done.processedEvents', '')
  ];

  appendActorOutcomeRows(rows, baseline, done);
  const results = done.actionResults ?? [];
  const first = results[0];

  if (first) {
    appendActionResultRows(rows, baseline, first, {
      action: 'action',
      resource: 'resource',
      cooldown: 'cooldown',
      effect: 'effect',
      evidence: 'done.actionResults[0]'
    });
  }

  results.forEach((result, index) =>
    appendActionResultRows(rows, baseline, result, {
      action: `actionResults.${index}.action`,
      resource: `actionResults.${index}.resource`,
      cooldown: `actionResults.${index}.cooldown`,
      effect: `actionResults.${index}.effect`,
      evidence: `done.actionResults[${index}]`
    })
  );

  appendTickResultRows(rows, baseline, done);
  appendTriggerRows(rows, baseline, done);
  appendRngRows(rows, baseline, done);

  return rows;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '待人工填写';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function buildActionRows(options: WasmValidationSkillOption[]): ActionOptionRow[] {
  return options.map((option) => ({
    ...option,
    displayLabel: `${option.label} / ${option.actionId}`
  }));
}

function filterSelectOption(inputValue: string, option: unknown): boolean {
  const optionData = option as
    | {
        value?: unknown;
        label?: unknown;
        props?: { value?: unknown; label?: unknown; children?: unknown };
      }
    | undefined;
  const searchText = [
    optionData?.value,
    optionData?.label,
    optionData?.props?.value,
    optionData?.props?.label,
    optionData?.props?.children,
  ]
    .map((value) => String(value ?? ''))
    .join(' ')
    .toLowerCase();
  return searchText.includes(inputValue.trim().toLowerCase());
}

function findCasePreset(id: ValidationCasePresetId): ValidationCasePreset {
  return CASE_PRESETS.find((preset) => preset.id === id) ?? CASE_PRESETS[0];
}

function applyCasePresetToSelection(selection: WasmValidationSelection, preset: ValidationCasePreset): WasmValidationSelection {
  if (!preset.selfResourceOverride) {
    return selection;
  }
  const { resourceId, current, max } = preset.selfResourceOverride;
  return {
    ...selection,
    selfResourceOverrides: {
      ...(selection.selfResourceOverrides ?? {}),
      [resourceId]: { current, max }
    }
  };
}

function createDefaultM3Selection(bundle: GameDataBundle): WasmValidationSelection {
  const fallback = createDefaultWasmValidationSelection(bundle);
  const ahri = bundle.heroes.find((hero) => hero.heroId === 'hero_ahri');
  if (bundle.meta.gameId === 'lol' && ahri) {
    const candidate: WasmValidationSelection = {
      ...fallback,
      selfHeroId: ahri.heroId,
      enemyHeroId: ahri.heroId,
      selfLevel: fallback.selfLevel,
      enemyLevel: 1,
      selfSkillLevels: {},
      enemySkillLevels: {},
      enemyAttributeBonuses: {},
      enemyAttributeOverrides: {
        [fallback.hpAttrKey]: 1000,
        armor: 0,
        magic_resist: 0
      }
    };
    if (listWasmValidationSkills(bundle, candidate, 'self').length > 0) {
      return candidate;
    }
  }
  for (const hero of bundle.heroes) {
    const candidate = { ...fallback, selfHeroId: hero.heroId };
    if (listWasmValidationSkills(bundle, candidate, 'self').length > 0) {
      return candidate;
    }
  }
  return fallback;
}

function buildPresetActionRequests(selectedActionId: string, preset: ValidationCasePreset): TinyGoV2ActionRequest[] {
  const primary: TinyGoV2ActionRequest = {
    triggerAtMs: 0,
    sourceActorId: 'self',
    targetActorId: 'enemy',
    actionId: selectedActionId
  };
  if (preset.runMode === 'repeat_same_tick') {
    return [primary, { ...primary }];
  }
  if (preset.runMode === 'self_target') {
    return [{ ...primary, targetActorId: 'self' }];
  }
  if (preset.runMode === 'self_then_enemy_unowned') {
    return [
      primary,
      {
        triggerAtMs: 1,
        sourceActorId: 'enemy',
        targetActorId: 'self',
        actionId: selectedActionId
      }
    ];
  }
  return [primary];
}

function cloneValidationInputWithPreset(input: TinyGoV2ValidationInput, selectedActionId: string, preset: ValidationCasePreset): TinyGoV2ValidationInput {
  const initialActions = buildPresetActionRequests(selectedActionId, preset);
  return {
    ...input,
    runInput: {
      ...input.runInput,
      initialActions,
      stopCondition: {
        maxEvents: Math.max(input.runInput.stopCondition.maxEvents, initialActions.length + 16)
      },
      trace: {
        ...input.runInput.trace,
        enableLogs: true,
        valueTrace: true
      }
    }
  };
}

export function WasmValidationM3Page({
  apiBaseUrl,
  selectedGameId,
  selectedGameName,
  externalRefreshSeed
}: WasmValidationM3PageProps) {
  const [bundle, setBundle] = useState<GameDataBundle | null>(null);
  const [currentVersion, setCurrentVersion] = useState<CurrentVersion | null>(null);
  const [cacheStatus, setCacheStatus] = useState<string>('idle');
  const [bundleStatus, setBundleStatus] = useState<LoadState>('idle');
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [selectedCasePresetId, setSelectedCasePresetId] = useState<ValidationCasePresetId>('m4_direct_damage_regression');
  const [selection, setSelection] = useState<WasmValidationSelection | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string>('');
  const [baselineText, setBaselineText] = useState('');
  const [frames, setFrames] = useState<DecodedFrame[]>([]);
  const [status, setStatus] = useState<LoadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function loadBundle() {
      if (!selectedGameId) {
        setBundle(null);
        setCurrentVersion(null);
        setSelection(null);
        setBundleStatus('idle');
        return;
      }
      setBundleStatus('loading');
      setBundleError(null);
      try {
        const snapshot = await loadPublishedBundleSnapshot(apiBaseUrl, selectedGameId);
        if (cancelled) {
          return;
        }
        setBundle(snapshot.bundle);
        setCurrentVersion(snapshot.currentVersion);
        setCacheStatus(snapshot.cacheStatus);
        setSelection(createDefaultM3Selection(snapshot.bundle));
        setBundleStatus('success');
      } catch (error) {
        if (cancelled) {
          return;
        }
        setBundle(null);
        setCurrentVersion(null);
        setSelection(null);
        setBundleStatus('error');
        setBundleError(getErrorMessage(error));
      }
    }
    void loadBundle();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, selectedGameId, externalRefreshSeed]);

  const selectedCasePreset = useMemo(() => findCasePreset(selectedCasePresetId), [selectedCasePresetId]);
  const effectiveSelection = useMemo(
    () => (selection ? applyCasePresetToSelection(selection, selectedCasePreset) : null),
    [selectedCasePreset, selection]
  );

  const selfActionOptions = useMemo(
    () => (bundle && effectiveSelection ? buildActionRows(listWasmValidationSkills(bundle, effectiveSelection, 'self')) : []),
    [bundle, effectiveSelection]
  );

  useEffect(() => {
    if (selfActionOptions.length === 0) {
      setSelectedActionId('');
      return;
    }
    setSelectedActionId((current) => (selfActionOptions.some((option) => option.actionId === current) ? current : selfActionOptions[0].actionId));
  }, [selfActionOptions]);

  const inputPreview = useMemo((): { value: TinyGoV2ValidationInput | null; error: string | null } => {
    if (!bundle || !effectiveSelection) {
      return { value: null, error: null };
    }
    if (!selectedActionId) {
      return { value: null, error: '请选择一个 self 技能作为单次施法。' };
    }
    try {
      const compiled = compileTinyGoV2ValidationInput(bundle, effectiveSelection);
      return {
        value: cloneValidationInputWithPreset(compiled, selectedActionId, selectedCasePreset),
        error: null
      };
    } catch (error) {
      return { value: null, error: getErrorMessage(error) };
    }
  }, [bundle, effectiveSelection, selectedActionId, selectedCasePreset]);

  const { baseline, error: baselineError } = useMemo(() => parseBaseline(baselineText), [baselineText]);
  const readyPayload = useMemo(() => getPayload<ReadyPayload>(frames, 15), [frames]);
  const donePayload = useMemo(() => getPayload<DonePayload>(frames, DONE_FRAME_KIND), [frames]);
  const evidenceRows = useMemo(() => buildEvidenceRows(donePayload, baseline), [baseline, donePayload]);
  const selectedAction = selfActionOptions.find((option) => option.actionId === selectedActionId) ?? null;

  const updateSelection = useCallback((patch: Partial<WasmValidationSelection>) => {
    setSelection((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const updateSelfSkillLevel = useCallback(
    (skillId: string, level: number) => {
      if (!selection) {
        return;
      }
      updateSelection({
        selfSkillLevels: {
          ...selection.selfSkillLevels,
          [skillId]: level
        }
      });
    },
    [selection, updateSelection]
  );

  const runM3 = useCallback(async () => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setStatus('loading');
    setErrorMessage(null);
    setDurationMs(null);
    try {
      if (!inputPreview.value) {
        throw new Error(inputPreview.error ?? '单技能输入尚未准备好。');
      }
      const startedAt = performance.now();
      const bridge = await TinyGoV2Bridge.create({ wasmUrl: TINYGO_V2_WASM_URL });
      const nextFrames: DecodedFrame[] = [];
      nextFrames.push(...decodeFrames(bridge.init(inputPreview.value.engineBundle), 'init'));
      nextFrames.push(...decodeFrames(bridge.beginRun(inputPreview.value.runInput), 'begin'));
      let stepStatus = 1;
      let guard = 0;
      while (stepStatus === 1 && guard < 16) {
        const step = bridge.step(16);
        stepStatus = step.status;
        nextFrames.push(...decodeFrames(step.frames, `step ${guard + 1}`));
        guard += 1;
      }
      if (stepStatus < 0) {
        throw new Error('engine_step failed');
      }
      if (stepStatus === 1) {
        throw new Error('engine_step guard exceeded');
      }
      const completedAt = performance.now();
      if (runIdRef.current !== runId) {
        return;
      }
      setFrames(nextFrames);
      setDurationMs(Math.round((completedAt - startedAt) * 10) / 10);
      setStatus('success');
    } catch (error) {
      if (runIdRef.current !== runId) {
        return;
      }
      setFrames([]);
      setErrorMessage(getErrorMessage(error));
      setStatus('error');
    }
  }, [inputPreview.error, inputPreview.value]);

  const handleCopyPackage = useCallback(async () => {
    if (!navigator.clipboard || !inputPreview.value) {
      return;
    }
    const payload = {
      case_meta: {
        milestone: selectedCasePreset.milestone,
        caseId: selectedCasePreset.caseId,
        gameId: selectedGameId,
        versionCode: currentVersion?.versionCode ?? '',
        dataHash: currentVersion?.dataHash ?? '',
        sourceActorId: inputPreview.value.runInput.initialActions[0]?.sourceActorId ?? 'self',
        targetActorId: inputPreview.value.runInput.initialActions[0]?.targetActorId ?? 'enemy',
        actionId: selectedActionId,
        skillId: selectedAction?.skillId ?? '',
        skillLevel: selectedAction?.level ?? 1,
        seed: inputPreview.value.runInput.seed,
        runMode: selectedCasePreset.runMode ?? 'single',
        initialActionCount: inputPreview.value.runInput.initialActions.length,
        expectedBlockedReason: selectedCasePreset.expectedBlockedReason ?? '',
        selfResourceOverride: selectedCasePreset.selfResourceOverride ?? null
      },
      runInput: inputPreview.value.runInput,
      wasm_output: donePayload,
      evidenceRows
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  }, [currentVersion, donePayload, evidenceRows, inputPreview.value, selectedAction, selectedActionId, selectedCasePreset, selectedGameId]);

  const heroOptions = (bundle?.heroes ?? []).map((hero) => ({ label: `${hero.heroId} / ${hero.name ?? hero.heroId}`, value: hero.heroId }));
  const itemOptions = (bundle?.items ?? []).map((item) => ({ label: `${item.itemId} / ${item.name ?? item.itemId}`, value: item.itemId }));
  const actionOptions = selfActionOptions.map((option) => ({ label: option.displayLabel, value: option.actionId }));
  const selectedSkillLevel = selectedAction ? selection?.selfSkillLevels[selectedAction.skillId] ?? selectedAction.level : 1;

  const evidenceColumns = [
    { title: 'field', dataIndex: 'field' },
    { title: 'wasmValue', render: (_: unknown, record: EvidenceRow) => <Typography.Text>{formatValue(record.wasmValue)}</Typography.Text> },
    { title: 'baselineValue', render: (_: unknown, record: EvidenceRow) => <Typography.Text>{formatValue(record.baselineValue)}</Typography.Text> },
    { title: 'tolerance', dataIndex: 'tolerance' },
    {
      title: 'status',
      render: (_: unknown, record: EvidenceRow) => (
        <Tag color={record.status === 'match' ? 'green' : record.status === 'diff' ? 'red' : 'orange'}>{record.status}</Tag>
      )
    },
    { title: 'evidenceRef', dataIndex: 'evidenceRef' },
    { title: 'note', dataIndex: 'note' }
  ];

  return (
    <div className="wasm-validation-page">
      <section className="workspace-hero">
        <Space direction="vertical" size={8}>
          <Typography.Text className="workspace-rail">Wasm 验证 M3/M4 / {selectedGameName}</Typography.Text>
          <Typography.Title heading={2}>单技能证据验证</Typography.Title>
        </Space>
        <Space>
          <Button icon={<IconRefresh />} onClick={() => void runM3()} loading={status === 'loading'} disabled={!inputPreview.value}>
            运行单技能
          </Button>
          <Button icon={<IconCopy />} onClick={() => void handleCopyPackage()} disabled={!donePayload}>
            复制验收包
          </Button>
        </Space>
      </section>

      <Row gutter={[16, 16]}>
        <Col span={6}>
          <MetricCard label="Bundle" value={currentVersion?.versionCode ?? '未加载'} hint={`cache ${cacheStatus}`} />
        </Col>
        <Col span={6}>
          <MetricCard label="Wasm" value={readyPayload ? `schema ${readyPayload.schemaVersion}` : '未运行'} hint={`actions ${readyPayload?.actionCount ?? 0}`} />
        </Col>
        <Col span={6}>
          <MetricCard label="Action" value={selectedAction?.label ?? '未选择'} hint={selectedActionId || 'no action'} />
        </Col>
        <Col span={6}>
          <MetricCard label="耗时" value={durationMs === null ? '-' : `${durationMs} ms`} hint={status} />
        </Col>
      </Row>

      {bundleError ? <Alert type="error" content={bundleError} /> : null}
      {errorMessage ? <Alert type="error" content={errorMessage} /> : null}
      {inputPreview.error ? <Alert type="warning" content={`M3 输入: ${inputPreview.error}`} /> : null}
      {baselineError ? <Alert type="warning" content={`人工基线 JSON: ${baselineError}`} /> : null}
      {!selectedGameId ? <Alert type="warning" content="请先选择游戏。" /> : null}

      <Panel title="单技能输入" kicker="case meta">
        {bundleStatus === 'loading' ? <EmptyState title="正在加载发布 Bundle" description="等待当前游戏的已发布快照返回。" /> : null}
        {bundle && selection ? (
          <Row gutter={[12, 12]}>
            <Col span={8}>
              <Select
                value={selectedCasePresetId}
                options={CASE_PRESETS.map((preset) => ({ label: preset.label, value: preset.id }))}
                showSearch
                filterOption={filterSelectOption}
                onChange={(value) => setSelectedCasePresetId(String(value) as ValidationCasePresetId)}
              />
            </Col>
            <Col span={6}>
              <Select
                value={selection.selfHeroId}
                options={heroOptions}
                showSearch
                filterOption={filterSelectOption}
                onChange={(value) => updateSelection({ selfHeroId: String(value) })}
              />
            </Col>
            <Col span={4}>
              <InputNumber min={1} value={selection.selfLevel} onChange={(value) => updateSelection({ selfLevel: Number(value ?? 1) })} />
            </Col>
            <Col span={6}>
              <Select
                value={selection.enemyHeroId}
                options={heroOptions}
                showSearch
                filterOption={filterSelectOption}
                onChange={(value) => updateSelection({ enemyHeroId: String(value) })}
              />
            </Col>
            <Col span={4}>
              <InputNumber min={1} value={selection.enemyLevel} onChange={(value) => updateSelection({ enemyLevel: Number(value ?? 1) })} />
            </Col>
            <Col span={8}>
              <Select
                mode="multiple"
                value={selection.selfItemIds}
                options={itemOptions}
                showSearch
                filterOption={filterSelectOption}
                placeholder="攻击方装备"
                onChange={(value) => updateSelection({ selfItemIds: Array.isArray(value) ? value.map(String) : [] })}
              />
            </Col>
            <Col span={8}>
              <Select
                value={selectedActionId}
                options={actionOptions}
                showSearch
                filterOption={filterSelectOption}
                onChange={(value) => setSelectedActionId(String(value))}
              />
            </Col>
            <Col span={4}>
              <InputNumber
                min={1}
                max={selectedAction?.maxLevel ?? 5}
                value={selectedSkillLevel}
                onChange={(value) => selectedAction && updateSelfSkillLevel(selectedAction.skillId, Number(value ?? selectedAction.defaultLevel))}
              />
            </Col>
          </Row>
        ) : null}
      </Panel>

      <Panel title="字段级证据" kicker="done.actionResults" actions={<Tag color={donePayload ? 'green' : 'gray'}>{donePayload ? 'ready' : 'empty'}</Tag>}>
        {evidenceRows.length > 0 ? (
          <Table rowKey="field" columns={evidenceColumns} data={evidenceRows} pagination={false} size="small" />
        ) : (
          <EmptyState title="还没有运行结果" description="选择技能后运行一次单次施法。" />
        )}
      </Panel>

      <Panel title="人工基线" kicker="baseline_input">
        <Input.TextArea
          value={baselineText}
          onChange={setBaselineText}
          autoSize={{ minRows: 5, maxRows: 12 }}
          placeholder='{"effect.0.finalDamage": 40, "resource.mana.delta": -55}'
        />
      </Panel>

      <Panel title="Wasm 输出" kicker="decoded frames">
        {donePayload ? <JsonBlock value={donePayload} /> : <EmptyState title="done payload 为空" description="运行 M3 后这里会展示 done frame。" />}
      </Panel>
    </div>
  );
}
