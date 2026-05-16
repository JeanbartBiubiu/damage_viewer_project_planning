import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Grid, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { IconCopy, IconRefresh } from '@arco-design/web-react/icon';
import { EmptyState } from '../components/EmptyState';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import {
  compileTinyGoV2ValidationInput,
  createDefaultWasmValidationSelection,
  type TinyGoV2ActionRequest,
  type TinyGoV2ValidationInput,
  type WasmValidationSelection
} from '../engine/tinygoV2BundleAdapter';
import { TinyGoV2Bridge, decodeFramePayload, type TinyGoV2Frame } from '../engine/tinygoV2Bridge';
import { getErrorMessage } from '../services/apiClient';
import { loadPublishedBundleSnapshot } from '../services/bundleSnapshot';
import { bundleCacheDescriptor } from '../services/bundleCache';
import type { CurrentVersion, GameDataBundle, LoadState, Skill } from '../types/api';

type WasmValidationM4ClosurePageProps = {
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
  op?: string;
  ref?: string;
  counter?: string;
  key?: string;
  value?: number;
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
  conditionKind?: string;
  conditionId?: string;
  conditionPassed?: boolean;
  hasCondition?: boolean;
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
  rawAmount?: number;
  hasRawAmount?: boolean;
  finalDamage?: number;
  hasFinalDamage?: boolean;
  healApplied?: number;
  hasHealApplied?: boolean;
  overhealAmount?: number;
  hasOverheal?: boolean;
  targetHpBefore?: number;
  targetHpAfter?: number;
};

type RNGDraw = {
  stream: string;
  index: number;
  use: string;
  value: number;
};

type DonePayload = {
  stopReason: string;
  finalTimeMs: number;
  processedEvents: number;
  queuePeak: number;
  chainDepthPeak: number;
  actors: ActorSnapshot[];
  actionResults?: ActionRunResult[];
  tickResults?: StatusTickRunResult[];
  rng?: RNGDraw[];
};

type DecodedFrame = {
  stage: string;
  kind: number;
  kindLabel: string;
  payload: unknown;
};

type ClosurePresetGroup =
  | 'M4.4 shield absorb'
  | 'M4.5 effective heal'
  | 'M4.9 effective HoT'
  | 'M4.7 mark consume true'
  | 'M4.12 seed branch'
  | 'M4.17 history window'
  | 'M4.18 counter read'
  | 'M4.19 mode augment';

type RunStatus = 'idle' | 'running' | 'passed' | 'failed' | 'blocked' | 'error';

type AssertionRow = {
  field: string;
  actual: unknown;
  expected: string;
  passed: boolean;
  evidenceRef: string;
};

type EvidenceRow = {
  key: string;
  caseId: string;
  group: string;
  field: string;
  value: unknown;
  evidenceRef: string;
};

type PreparedCase = {
  key: string;
  group: ClosurePresetGroup;
  label: string;
  caseId: string;
  input: TinyGoV2ValidationInput | null;
  blockedReasons: string[];
  actionIds: string[];
  expected: {
    kind: 'shield_absorb' | 'heal' | 'hot' | 'mark_consume' | 'seed' | 'history' | 'counter' | 'mode';
    critResult?: boolean;
    historyInside?: boolean;
    modeActive?: boolean;
  };
};

type CaseRunResult = {
  key: string;
  status: RunStatus;
  durationMs: number | null;
  ready: ReadyPayload | null;
  done: DonePayload | null;
  frames: DecodedFrame[];
  assertions: AssertionRow[];
  evidenceRows: EvidenceRow[];
  summary: string;
  error: string | null;
};

type DamageSkillRef = {
  heroId: string;
  skillId: string;
};

const TINYGO_V2_WASM_URL = new URL('../engine/wasm/tinygo_engine_v2.wasm', import.meta.url);
const DONE_FRAME_KIND = 13;
const READY_FRAME_KIND = 15;
const FRAME_KIND_LABELS: Record<number, string> = {
  11: 'log',
  12: 'sample',
  13: 'done',
  14: 'error',
  15: 'ready'
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

function cloneInput<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function actionId(side: 'self' | 'enemy', skillId: string): string {
  return `${side}::${skillId}`;
}

function hasHero(bundle: GameDataBundle, heroId: string): boolean {
  return bundle.heroes.some((hero) => hero.heroId === heroId);
}

function findSkill(bundle: GameDataBundle, skillId: string): Skill | null {
  return bundle.skills.find((skill) => skill.skillId === skillId) ?? null;
}

function fallbackEnemyHero(bundle: GameDataBundle, selfHeroId: string): string {
  const ahri = bundle.heroes.find((hero) => hero.heroId === 'hero_ahri' && hero.heroId !== selfHeroId);
  return ahri?.heroId ?? bundle.heroes.find((hero) => hero.heroId !== selfHeroId)?.heroId ?? bundle.heroes[0]?.heroId ?? '';
}

function skillHasDamageAction(skill: Skill): boolean {
  return JSON.stringify(skill.mechanicsConfig ?? {}).includes('"deal_damage"');
}

function findPublishedDamageSkill(bundle: GameDataBundle, excludedHeroId?: string): DamageSkillRef | null {
  const preferredSkillIds = ['skill_ahri_q', 'skill_gangplank_q', 'skill_ksante_r_all_out'];
  for (const skillId of preferredSkillIds) {
    const skill = findSkill(bundle, skillId);
    if (skill?.ownerType === 'hero' && skill.ownerId !== excludedHeroId && hasHero(bundle, skill.ownerId)) {
      return { heroId: skill.ownerId, skillId };
    }
  }
  const fallback = bundle.skills.find((skill) => {
    const skillKey = (skill.skillKey ?? '').trim().toUpperCase();
    return (
      skill.ownerType === 'hero' &&
      skill.ownerId !== excludedHeroId &&
      hasHero(bundle, skill.ownerId) &&
      skillKey !== 'P' &&
      skillKey !== 'PASSIVE' &&
      skillHasDamageAction(skill)
    );
  });
  return fallback ? { heroId: fallback.ownerId, skillId: fallback.skillId } : null;
}

function makeSelection(
  bundle: GameDataBundle,
  options: {
    selfHeroId: string;
    enemyHeroId: string;
    selfLevel?: number;
    enemyLevel?: number;
    selfSkillLevels?: Record<string, number>;
    enemySkillLevels?: Record<string, number>;
  }
): WasmValidationSelection {
  const base = createDefaultWasmValidationSelection(bundle);
  return {
    ...base,
    selfHeroId: options.selfHeroId,
    enemyHeroId: options.enemyHeroId,
    selfLevel: options.selfLevel ?? 18,
    enemyLevel: options.enemyLevel ?? 1,
    selfSkillLevels: options.selfSkillLevels ?? {},
    enemySkillLevels: options.enemySkillLevels ?? {},
    enemyAttributeOverrides: {
      ...(base.enemyAttributeOverrides ?? {}),
      [base.hpAttrKey]: 1000,
      armor: 0,
      magic_resist: 0
    }
  };
}

function setInitialHp(input: TinyGoV2ValidationInput, side: 'self' | 'enemy', missingHp: number): void {
  const templateId = side === 'self' ? input.runInput.self.templateId : input.runInput.enemy.templateId;
  const actor = input.engineBundle.actors.find((candidate) => candidate.id === templateId);
  if (!actor) {
    return;
  }
  actor.initialHp = Math.max(1, Math.min(actor.maxHp, actor.maxHp - missingHp));
}

function buildInput(
  bundle: GameDataBundle,
  options: {
    selfHeroId: string;
    enemyHeroId: string;
    selfSkillLevels?: Record<string, number>;
    enemySkillLevels?: Record<string, number>;
    actions: TinyGoV2ActionRequest[];
    seed?: number;
    modeAugments?: string[];
    selfMissingHp?: number;
    maxEvents?: number;
  }
): { input: TinyGoV2ValidationInput | null; issues: string[] } {
  const issues: string[] = [];
  if (!hasHero(bundle, options.selfHeroId)) {
    issues.push(`missing hero ${options.selfHeroId}`);
  }
  if (!hasHero(bundle, options.enemyHeroId)) {
    issues.push(`missing hero ${options.enemyHeroId}`);
  }
  for (const request of options.actions) {
    const skillId = request.actionId.replace(/^(self|enemy)::/, '');
    if (!findSkill(bundle, skillId)) {
      issues.push(`missing skill ${skillId}`);
    }
  }
  if (issues.length > 0) {
    return { input: null, issues };
  }

  try {
    const selection = makeSelection(bundle, options);
    const compiled = compileTinyGoV2ValidationInput(bundle, selection);
    const input = cloneInput(compiled);
    const compiledActions = new Set(input.engineBundle.actions.map((action) => action.id));
    for (const request of options.actions) {
      if (!compiledActions.has(request.actionId)) {
        issues.push(`published skill is not compiled as action ${request.actionId}`);
      }
    }
    if (issues.length > 0) {
      return { input: null, issues };
    }
    if (options.selfMissingHp) {
      setInitialHp(input, 'self', options.selfMissingHp);
    }
    input.runInput = {
      ...input.runInput,
      seed: options.seed ?? input.runInput.seed,
      modeAugments: options.modeAugments,
      initialActions: options.actions,
      stopCondition: {
        maxEvents: options.maxEvents ?? Math.max(32, options.actions.length + 16)
      },
      trace: {
        ...input.runInput.trace,
        enableLogs: true,
        valueTrace: true
      }
    };
    return { input, issues: [] };
  } catch (error) {
    return { input: null, issues: [getErrorMessage(error)] };
  }
}

function makeCase(
  config: Omit<PreparedCase, 'input' | 'blockedReasons' | 'actionIds'> & {
    build: () => { input: TinyGoV2ValidationInput | null; issues: string[]; actionIds: string[] };
  }
): PreparedCase {
  const built = config.build();
  return {
    key: config.key,
    group: config.group,
    label: config.label,
    caseId: config.caseId,
    expected: config.expected,
    input: built.input,
    blockedReasons: built.issues,
    actionIds: built.actionIds
  };
}

function buildPreparedCases(bundle: GameDataBundle): PreparedCase[] {
  const enemyDamage = findPublishedDamageSkill(bundle, 'hero_lux') ?? findPublishedDamageSkill(bundle);
  const historyDamage = findPublishedDamageSkill(bundle, 'hero_zed') ?? enemyDamage;

  return [
    makeCase({
      key: 'm4_4_shield_absorb',
      group: 'M4.4 shield absorb',
      label: 'Lux W -> enemy damage',
      caseId: 'M4.4-shield-absorb-closure-001',
      expected: { kind: 'shield_absorb' },
      build: () => {
        if (!enemyDamage) {
          return { input: null, issues: ['missing published enemy damage skill'], actionIds: [] };
        }
        const actions = [
          { triggerAtMs: 0, sourceActorId: 'self', targetActorId: 'self', actionId: actionId('self', 'skill_lux_w') },
          { triggerAtMs: 1, sourceActorId: 'enemy', targetActorId: 'self', actionId: actionId('enemy', enemyDamage.skillId) }
        ] satisfies TinyGoV2ActionRequest[];
        const built = buildInput(bundle, {
          selfHeroId: 'hero_lux',
          enemyHeroId: enemyDamage.heroId,
          selfSkillLevels: { skill_lux_w: 5 },
          enemySkillLevels: { [enemyDamage.skillId]: 1 },
          actions,
          maxEvents: 32
        });
        return { ...built, actionIds: actions.map((action) => action.actionId) };
      }
    }),
    makeCase({
      key: 'm4_5_effective_heal',
      group: 'M4.5 effective heal',
      label: 'Taric Q with damaged self',
      caseId: 'M4.5-effective-heal-closure-001',
      expected: { kind: 'heal' },
      build: () => {
        const actions = [{ triggerAtMs: 0, sourceActorId: 'self', targetActorId: 'self', actionId: actionId('self', 'skill_taric_q') }] satisfies TinyGoV2ActionRequest[];
        const built = buildInput(bundle, {
          selfHeroId: 'hero_taric',
          enemyHeroId: fallbackEnemyHero(bundle, 'hero_taric'),
          selfSkillLevels: { skill_taric_q: 5 },
          actions,
          selfMissingHp: 200,
          maxEvents: 24
        });
        return { ...built, actionIds: actions.map((action) => action.actionId) };
      }
    }),
    makeCase({
      key: 'm4_9_effective_hot',
      group: 'M4.9 effective HoT',
      label: 'Mundo R ticks with damaged self',
      caseId: 'M4.9-effective-hot-closure-001',
      expected: { kind: 'hot' },
      build: () => {
        const actions = [{ triggerAtMs: 0, sourceActorId: 'self', targetActorId: 'self', actionId: actionId('self', 'skill_drmundo_r') }] satisfies TinyGoV2ActionRequest[];
        const built = buildInput(bundle, {
          selfHeroId: 'hero_drmundo',
          enemyHeroId: fallbackEnemyHero(bundle, 'hero_drmundo'),
          selfSkillLevels: { skill_drmundo_r: 3 },
          actions,
          selfMissingHp: 200,
          maxEvents: 64
        });
        return { ...built, actionIds: actions.map((action) => action.actionId) };
      }
    }),
    makeCase({
      key: 'm4_7_mark_consume_true',
      group: 'M4.7 mark consume true',
      label: 'Quinn E -> Harrier Hit',
      caseId: 'M4.7-mark-consume-true-closure-001',
      expected: { kind: 'mark_consume' },
      build: () => {
        const actions = [
          { triggerAtMs: 0, sourceActorId: 'self', targetActorId: 'enemy', actionId: actionId('self', 'skill_quinn_e') },
          { triggerAtMs: 1, sourceActorId: 'self', targetActorId: 'enemy', actionId: actionId('self', 'skill_quinn_harrier_hit') }
        ] satisfies TinyGoV2ActionRequest[];
        const built = buildInput(bundle, {
          selfHeroId: 'hero_quinn',
          enemyHeroId: fallbackEnemyHero(bundle, 'hero_quinn'),
          selfSkillLevels: { skill_quinn_e: 5, skill_quinn_harrier_hit: 1 },
          actions,
          maxEvents: 32
        });
        return { ...built, actionIds: actions.map((action) => action.actionId) };
      }
    }),
    ...[1, 2].map((seed) =>
      makeCase({
        key: `m4_12_seed_${seed}`,
        group: 'M4.12 seed branch',
        label: seed === 1 ? 'Gangplank Q seed=1 crit' : 'Gangplank Q seed=2 non-crit',
        caseId: seed === 1 ? 'M4.12-seed-branch-closure-crit' : 'M4.12-seed-branch-closure-noncrit',
        expected: { kind: 'seed', critResult: seed === 1 },
        build: () => {
          const actions = [{ triggerAtMs: 0, sourceActorId: 'self', targetActorId: 'enemy', actionId: actionId('self', 'skill_gangplank_q') }] satisfies TinyGoV2ActionRequest[];
          const built = buildInput(bundle, {
            selfHeroId: 'hero_gangplank',
            enemyHeroId: fallbackEnemyHero(bundle, 'hero_gangplank'),
            selfSkillLevels: { skill_gangplank_q: 1 },
            actions,
            seed,
            maxEvents: 24
          });
          return { ...built, actionIds: actions.map((action) => action.actionId) };
        }
      })
    ),
    ...[
      { key: 'inside', triggerAtMs: 4000, inside: true },
      { key: 'outside', triggerAtMs: 5001, inside: false }
    ].map((variant) =>
      makeCase({
        key: `m4_17_history_${variant.key}`,
        group: 'M4.17 history window',
        label: variant.inside ? 'Zed R within 4000ms' : 'Zed R after 5001ms',
        caseId: variant.inside ? 'M4.17-history-window-closure-inside' : 'M4.17-history-window-closure-outside',
        expected: { kind: 'history', historyInside: variant.inside },
        build: () => {
          if (!historyDamage) {
            return { input: null, issues: ['missing published enemy damage skill'], actionIds: [] };
          }
          const actions = [
            { triggerAtMs: 0, sourceActorId: 'enemy', targetActorId: 'self', actionId: actionId('enemy', historyDamage.skillId) },
            { triggerAtMs: variant.triggerAtMs, sourceActorId: 'self', targetActorId: 'enemy', actionId: actionId('self', 'skill_zed_r_death_mark') }
          ] satisfies TinyGoV2ActionRequest[];
          const built = buildInput(bundle, {
            selfHeroId: 'hero_zed',
            enemyHeroId: historyDamage.heroId,
            selfSkillLevels: { skill_zed_r_death_mark: 3 },
            enemySkillLevels: { [historyDamage.skillId]: 1 },
            actions,
            maxEvents: 48
          });
          return { ...built, actionIds: actions.map((action) => action.actionId) };
        }
      })
    ),
    makeCase({
      key: 'm4_18_counter_read',
      group: 'M4.18 counter read',
      label: 'Vayne W increments -> counter read',
      caseId: 'M4.18-counter-read-closure-001',
      expected: { kind: 'counter' },
      build: () => {
        if (!findSkill(bundle, 'skill_vayne_w_counter_read')) {
          return {
            input: null,
            issues: ['missing skill_vayne_w_counter_read; 需要先补 DB/发布 current bundle，页面不私造本地 action'],
            actionIds: [actionId('self', 'skill_vayne_w_silver_bolts'), actionId('self', 'skill_vayne_w_counter_read')]
          };
        }
        const actions = [
          { triggerAtMs: 0, sourceActorId: 'self', targetActorId: 'enemy', actionId: actionId('self', 'skill_vayne_w_silver_bolts') },
          { triggerAtMs: 1, sourceActorId: 'self', targetActorId: 'enemy', actionId: actionId('self', 'skill_vayne_w_silver_bolts') },
          { triggerAtMs: 2, sourceActorId: 'self', targetActorId: 'enemy', actionId: actionId('self', 'skill_vayne_w_silver_bolts') },
          { triggerAtMs: 3, sourceActorId: 'self', targetActorId: 'enemy', actionId: actionId('self', 'skill_vayne_w_counter_read') }
        ] satisfies TinyGoV2ActionRequest[];
        const built = buildInput(bundle, {
          selfHeroId: 'hero_vayne',
          enemyHeroId: fallbackEnemyHero(bundle, 'hero_vayne'),
          selfSkillLevels: { skill_vayne_w_silver_bolts: 5, skill_vayne_w_counter_read: 1 },
          actions,
          maxEvents: 48
        });
        return { ...built, actionIds: actions.map((action) => action.actionId) };
      }
    }),
    ...[
      { key: 'normal', active: false, modeAugments: undefined },
      { key: 'allout', active: true, modeAugments: ['ksante_all_out'] }
    ].map((variant) =>
      makeCase({
        key: `m4_19_mode_${variant.key}`,
        group: 'M4.19 mode augment',
        label: variant.active ? 'KSante R modeAugments=All Out' : 'KSante R normal',
        caseId: variant.active ? 'M4.19-mode-augment-closure-allout' : 'M4.19-mode-augment-closure-normal',
        expected: { kind: 'mode', modeActive: variant.active },
        build: () => {
          const actions = [{ triggerAtMs: 0, sourceActorId: 'self', targetActorId: 'enemy', actionId: actionId('self', 'skill_ksante_r_all_out') }] satisfies TinyGoV2ActionRequest[];
          const built = buildInput(bundle, {
            selfHeroId: 'hero_ksante',
            enemyHeroId: fallbackEnemyHero(bundle, 'hero_ksante'),
            selfSkillLevels: { skill_ksante_r_all_out: 3 },
            actions,
            modeAugments: variant.modeAugments,
            maxEvents: 24
          });
          return { ...built, actionIds: actions.map((action) => action.actionId) };
        }
      })
    )
  ];
}

function findAction(done: DonePayload, actionIdValue: string): ActionRunResult | null {
  return (done.actionResults ?? []).find((result) => result.actionId === actionIdValue) ?? null;
}

function allAccepted(done: DonePayload): boolean {
  const results = done.actionResults ?? [];
  return results.length > 0 && results.every((result) => result.accepted);
}

function findEffect(done: DonePayload, predicate: (effect: ActionEffectRunResult, action: ActionRunResult) => boolean): ActionEffectRunResult | null {
  for (const action of done.actionResults ?? []) {
    for (const effect of action.effects ?? []) {
      if (predicate(effect, action)) {
        return effect;
      }
    }
  }
  return null;
}

function boolState(hasState: boolean | undefined, value: boolean | undefined): boolean {
  return Boolean(hasState && value === true);
}

function normalizedModeActive(effect: ActionEffectRunResult | null | undefined): boolean | undefined {
  return effect?.hasModeState ? boolState(effect.hasModeState, effect.modeActive) : undefined;
}

function addAssertion(rows: AssertionRow[], field: string, actual: unknown, expected: string, passed: boolean, evidenceRef: string): void {
  rows.push({ field, actual, expected, passed, evidenceRef });
}

function isNear(actual: number | undefined, expected: number, tolerance = 0.001): boolean {
  return typeof actual === 'number' && Math.abs(actual - expected) <= tolerance;
}

function firstDamageEffect(done: DonePayload | null): ActionEffectRunResult | null {
  if (!done) {
    return null;
  }
  return findEffect(done, (effect) => Boolean(effect.hasFinalDamage));
}

function modeDamageEffect(done: DonePayload | null): ActionEffectRunResult | null {
  if (!done) {
    return null;
  }
  return findEffect(done, (effect) => Boolean(effect.hasModeState && effect.hasFinalDamage));
}

function counterStepKey(step: ActionValueBreakdownStep | undefined): string {
  return step?.ref ?? step?.counter ?? step?.key ?? '';
}

function findCounterBreakdownStep(effect: ActionEffectRunResult | null | undefined, counterKey: string): ActionValueBreakdownStep | null {
  return effect?.formulaBreakdown?.find((step) => step.op === 'counter' && counterStepKey(step) === counterKey) ?? null;
}

function evaluateCase(testCase: PreparedCase, done: DonePayload): AssertionRow[] {
  const rows: AssertionRow[] = [];
  addAssertion(rows, 'actions.accepted', (done.actionResults ?? []).map((result) => result.accepted), 'all actionResults accepted=true', allAccepted(done), 'done.actionResults[*].accepted');

  if (testCase.expected.kind === 'shield_absorb') {
    const damageActionId = testCase.actionIds[1] ?? '';
    const damageAction = findAction(done, damageActionId);
    const absorbed = damageAction?.effects?.find((effect) => Boolean(effect.hasShieldAbsorbed && (effect.shieldAbsorbed ?? 0) > 0)) ?? null;
    const shieldDelta = (absorbed?.shieldBefore ?? 0) - (absorbed?.shieldAfter ?? 0);
    const actionHpDelta = (absorbed?.targetHpBefore ?? 0) - (absorbed?.targetHpAfter ?? 0);
    const hpTick = (done.tickResults ?? []).find((tick) => Boolean(tick.hasFinalDamage && (tick.finalDamage ?? 0) > 0 && (tick.targetHpBefore ?? 0) > (tick.targetHpAfter ?? 0))) ?? null;
    const tickHpDelta = (hpTick?.targetHpBefore ?? 0) - (hpTick?.targetHpAfter ?? 0);
    addAssertion(rows, 'shield.actionEffect', absorbed?.effectIndex ?? '', 'shielded damage effect on enemy damage action', Boolean(absorbed), `done.actionResults[actionId=${damageActionId}].effects[*]`);
    addAssertion(rows, 'shield.shieldAbsorbed', absorbed?.shieldAbsorbed ?? 0, '> 0', Boolean(absorbed && (absorbed.shieldAbsorbed ?? 0) > 0), `done.actionResults[actionId=${damageActionId}].effects[*].shieldAbsorbed`);
    addAssertion(rows, 'shield.beforeAfterDelta', `${formatValue(absorbed?.shieldBefore)} -> ${formatValue(absorbed?.shieldAfter)}`, 'shieldBefore > shieldAfter', Boolean(absorbed?.hasShieldBefore && absorbed.hasShieldAfter && shieldDelta > 0), `done.actionResults[actionId=${damageActionId}].effects[*].shieldBefore/After`);
    addAssertion(rows, 'shield.deltaMatchesAbsorb', shieldDelta, 'equals shieldAbsorbed', Boolean(absorbed && isNear(shieldDelta, absorbed.shieldAbsorbed ?? Number.NaN)), `done.actionResults[actionId=${damageActionId}].effects[*].shield*`);
    addAssertion(rows, 'hp.actionShieldedSegment', actionHpDelta, '= 0 for fully shielded action damage', Boolean(absorbed && isNear(actionHpDelta, 0)), `done.actionResults[actionId=${damageActionId}].effects[*].targetHpBefore/After`);
    addAssertion(rows, 'hp.tickDamageSegment', tickHpDelta, '> 0 from follow-up tick', Boolean(hpTick && tickHpDelta > 0), 'done.tickResults[*].targetHpBefore/After');
  }

  if (testCase.expected.kind === 'heal') {
    const heal = findEffect(done, (effect) => Boolean(effect.hasHealApplied && (effect.healApplied ?? 0) > 0));
    addAssertion(rows, 'effect.healApplied', heal?.healApplied ?? 0, '> 0', Boolean(heal), 'done.actionResults[*].effects[*].healApplied');
    addAssertion(rows, 'effect.hpDelta', (heal?.targetHpAfter ?? 0) - (heal?.targetHpBefore ?? 0), '> 0', Boolean(heal && (heal.targetHpAfter ?? 0) > (heal.targetHpBefore ?? 0)), 'done.actionResults[*].effects[*].targetHpBefore/After');
  }

  if (testCase.expected.kind === 'hot') {
    const tick = (done.tickResults ?? []).find((candidate) => Boolean(candidate.hasHealApplied && (candidate.healApplied ?? 0) > 0));
    addAssertion(rows, 'tick.healApplied', tick?.healApplied ?? 0, '> 0', Boolean(tick), 'done.tickResults[*].healApplied');
    addAssertion(rows, 'tick.hpDelta', (tick?.targetHpAfter ?? 0) - (tick?.targetHpBefore ?? 0), '> 0', Boolean(tick && (tick.targetHpAfter ?? 0) > (tick.targetHpBefore ?? 0)), 'done.tickResults[*].targetHpBefore/After');
  }

  if (testCase.expected.kind === 'mark_consume') {
    const secondActionId = testCase.actionIds[1] ?? '';
    const second = findAction(done, secondActionId);
    const damageEffect = second?.effects?.find((effect) => Boolean(effect.hasFinalDamage && (effect.finalDamage ?? 0) > 0)) ?? null;
    addAssertion(rows, 'mark.secondAccepted', second?.accepted ?? false, 'true', Boolean(second?.accepted), `done.actionResults[actionId=${secondActionId}].accepted`);
    addAssertion(rows, 'mark.conditionPassed', second?.conditionPassed ?? false, 'true', Boolean(second?.hasCondition && second.conditionPassed), `done.actionResults[actionId=${secondActionId}].conditionPassed`);
    addAssertion(rows, 'mark.damageEffect', damageEffect?.finalDamage ?? 0, '> 0', Boolean(damageEffect), `done.actionResults[actionId=${secondActionId}].effects[*].finalDamage`);
  }

  if (testCase.expected.kind === 'seed') {
    const effect = findEffect(done, (candidate) => Boolean(candidate.hasCritResult));
    const critResult = boolState(effect?.hasCritResult, effect?.critResult);
    addAssertion(rows, 'rng.firstDraw', done.rng?.[0]?.value ?? '', 'draw exists', Boolean(done.rng?.length), 'done.rng[0]');
    addAssertion(rows, 'crit.result', critResult, String(testCase.expected.critResult), Boolean(effect?.hasCritResult && critResult === testCase.expected.critResult), 'done.actionResults[*].effects[*].critResult');
  }

  if (testCase.expected.kind === 'history') {
    const effect = findEffect(done, (candidate) => candidate.kind === 'damage_from_recent');
    const finalDamage = effect?.finalDamage ?? 0;
    addAssertion(rows, 'history.windowMs', effect?.historyWindowMs ?? 0, '4000', Boolean(effect?.hasHistoryWindow && effect.historyWindowMs === 4000), 'done.actionResults[*].effects[*].historyWindowMs');
    addAssertion(rows, 'history.finalDamage', finalDamage, testCase.expected.historyInside ? '> 0' : '= 0', testCase.expected.historyInside ? finalDamage > 0 : finalDamage === 0, 'done.actionResults[*].effects[*].finalDamage');
  }

  if (testCase.expected.kind === 'counter') {
    const readActionId = actionId('self', 'skill_vayne_w_counter_read');
    const readAction = findAction(done, readActionId);
    const damageEffect = readAction?.effects?.find((effect) => effect.kind === 'deal_damage' && Boolean(effect.hasFinalDamage)) ?? null;
    const counterStep = findCounterBreakdownStep(damageEffect, 'vayne_silver_bolts_stack');
    addAssertion(rows, 'counter.readAccepted', readAction?.accepted ?? false, 'true', Boolean(readAction?.accepted), `done.actionResults[actionId=${readActionId}].accepted`);
    addAssertion(rows, 'counter.damageEffect', damageEffect?.kind ?? '', 'deal_damage on counter-read action', Boolean(damageEffect), `done.actionResults[actionId=${readActionId}].effects[*].kind`);
    addAssertion(rows, 'counter.breakdownKey', counterStep ? `${counterStep.op}:${counterStepKey(counterStep)}` : '', 'counter:vayne_silver_bolts_stack', Boolean(counterStep), `done.actionResults[actionId=${readActionId}].effects[*].formulaBreakdown[op=counter]`);
    addAssertion(rows, 'counter.readValue', counterStep?.value ?? '', '3', isNear(counterStep?.value, 3), `done.actionResults[actionId=${readActionId}].effects[*].formulaBreakdown[op=counter].value`);
    addAssertion(rows, 'counter.finalDamage', damageEffect?.finalDamage ?? 0, '30', isNear(damageEffect?.finalDamage, 30), `done.actionResults[actionId=${readActionId}].effects[*].finalDamage`);
    addAssertion(rows, 'counter.damageType', damageEffect?.damageType ?? '', 'true', damageEffect?.damageType === 'true', `done.actionResults[actionId=${readActionId}].effects[*].damageType`);
  }

  if (testCase.expected.kind === 'mode') {
    const effect = modeDamageEffect(done);
    const modeActive = normalizedModeActive(effect);
    addAssertion(rows, 'mode.modeActive', modeActive, String(testCase.expected.modeActive), Boolean(effect?.hasModeState && modeActive === testCase.expected.modeActive), 'done.actionResults[*].effects[*].modeActive');
    addAssertion(rows, 'mode.finalDamage', effect?.finalDamage ?? 0, '> 0', Boolean(effect && (effect.finalDamage ?? 0) > 0), 'done.actionResults[*].effects[*].finalDamage');
  }

  return rows;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

function buildCaseSummary(done: DonePayload, assertions: AssertionRow[]): string {
  const accepted = (done.actionResults ?? []).map((result) => `${result.actionId}:${result.accepted ? 'accepted' : result.blockedReason ?? 'blocked'}`).join(' | ');
  const firstEffect = firstDamageEffect(done) ?? findEffect(done, () => true);
  const effectSummary = firstEffect
    ? `${firstEffect.kind} fd=${formatValue(firstEffect.finalDamage)} dmg=${formatValue(firstEffect.damageType)} counter=${formatValue(findCounterBreakdownStep(firstEffect, 'vayne_silver_bolts_stack')?.value)} heal=${formatValue(firstEffect.healApplied)} shieldAbs=${formatValue(firstEffect.shieldAbsorbed)} mode=${formatValue(normalizedModeActive(firstEffect))}`
    : 'no effect';
  const hp = done.actors.map((actor) => `${actor.actorId} hp=${formatValue(actor.currentHp)} shield=${formatValue(actor.shieldAmount)}`).join(' | ');
  const rng = done.rng?.[0] ? `rng=${formatValue(done.rng[0].value)}` : 'rng=-';
  const failed = assertions.filter((assertion) => !assertion.passed).length;
  return `${accepted || 'no actions'} | ${effectSummary} | ${hp} | ${rng} | failed=${failed}`;
}

function resultWithAssertions(result: CaseRunResult, assertions: AssertionRow[]): CaseRunResult {
  if (!result.done || result.status === 'blocked' || result.status === 'error') {
    return result;
  }
  return {
    ...result,
    assertions,
    status: assertions.every((assertion) => assertion.passed) ? 'passed' : 'failed',
    summary: buildCaseSummary(result.done, assertions)
  };
}

function applyModePairAssertions(results: Record<string, CaseRunResult>): Record<string, CaseRunResult> {
  const normal = results.m4_19_mode_normal;
  const allout = results.m4_19_mode_allout;
  if (!normal?.done || !allout?.done) {
    return results;
  }

  const normalEffect = modeDamageEffect(normal.done);
  const alloutEffect = modeDamageEffect(allout.done);
  const normalModeActive = normalizedModeActive(normalEffect);
  const alloutModeActive = normalizedModeActive(alloutEffect);
  const pairAssertions: AssertionRow[] = [];
  addAssertion(
    pairAssertions,
    'modePair.normalModeActive',
    normalModeActive ?? '',
    'false',
    Boolean(normalEffect?.hasModeState && normalModeActive === false),
    'normal.done.actionResults[*].effects[*].modeActive'
  );
  addAssertion(
    pairAssertions,
    'modePair.alloutModeActive',
    alloutModeActive ?? '',
    'true',
    Boolean(alloutEffect?.hasModeState && alloutModeActive === true),
    'allout.done.actionResults[*].effects[*].modeActive'
  );
  addAssertion(
    pairAssertions,
    'modePair.damageCompare',
    `${formatValue(normalEffect?.finalDamage)} -> ${formatValue(alloutEffect?.finalDamage)}`,
    'allout > normal',
    typeof normalEffect?.finalDamage === 'number' && typeof alloutEffect?.finalDamage === 'number' && alloutEffect.finalDamage > normalEffect.finalDamage,
    'normal/allout.done.actionResults[*].effects[*].finalDamage'
  );
  addAssertion(
    pairAssertions,
    'modePair.normalDamageBaseline',
    normalEffect?.finalDamage ?? '',
    '~191.6',
    isNear(normalEffect?.finalDamage, 191.6, 0.5),
    'normal.done.actionResults[*].effects[*].finalDamage'
  );
  addAssertion(
    pairAssertions,
    'modePair.alloutDamageBaseline',
    alloutEffect?.finalDamage ?? '',
    '~383.2',
    isNear(alloutEffect?.finalDamage, 383.2, 0.5),
    'allout.done.actionResults[*].effects[*].finalDamage'
  );

  const stripPair = (assertions: AssertionRow[]) => assertions.filter((assertion) => !assertion.field.startsWith('modePair.'));
  return {
    ...results,
    m4_19_mode_normal: resultWithAssertions(normal, [...stripPair(normal.assertions), ...pairAssertions]),
    m4_19_mode_allout: resultWithAssertions(allout, [...stripPair(allout.assertions), ...pairAssertions])
  };
}

function appendEvidence(rows: EvidenceRow[], testCase: PreparedCase, field: string, value: unknown, evidenceRef: string): void {
  rows.push({
    key: `${testCase.caseId}:${field}:${rows.length}`,
    caseId: testCase.caseId,
    group: testCase.group,
    field,
    value,
    evidenceRef
  });
}

function buildEvidenceRows(testCase: PreparedCase, done: DonePayload): EvidenceRow[] {
  const rows: EvidenceRow[] = [];
  appendEvidence(rows, testCase, 'run.stopReason', done.stopReason, 'done.stopReason');
  appendEvidence(rows, testCase, 'run.processedEvents', done.processedEvents, 'done.processedEvents');
  for (const actor of done.actors) {
    appendEvidence(rows, testCase, `actor.${actor.actorId}.hp`, `${formatValue(actor.currentHp)} / ${formatValue(actor.maxHp)}`, `done.actors[${actor.actorId}].currentHp`);
    appendEvidence(rows, testCase, `actor.${actor.actorId}.shield`, actor.shieldAmount, `done.actors[${actor.actorId}].shieldAmount`);
    for (const [resourceId, resource] of Object.entries(actor.resources ?? {})) {
      appendEvidence(rows, testCase, `actor.${actor.actorId}.resource.${resourceId}`, `${formatValue(resource.current)} / ${formatValue(resource.max)}`, `done.actors[${actor.actorId}].resources.${resourceId}`);
    }
  }
  for (const [actionIndex, action] of (done.actionResults ?? []).entries()) {
    appendEvidence(rows, testCase, `action.${actionIndex}.id`, action.actionId, `done.actionResults[${actionIndex}].actionId`);
    appendEvidence(rows, testCase, `action.${actionIndex}.accepted`, action.accepted, `done.actionResults[${actionIndex}].accepted`);
    appendEvidence(rows, testCase, `action.${actionIndex}.blockedReason`, action.blockedReason ?? '', `done.actionResults[${actionIndex}].blockedReason`);
    appendEvidence(rows, testCase, `action.${actionIndex}.condition`, action.hasCondition ? `${action.conditionKind}:${action.conditionId}:${action.conditionPassed}` : '', `done.actionResults[${actionIndex}].condition*`);
    for (const delta of action.resourceDeltas ?? []) {
      appendEvidence(rows, testCase, `action.${actionIndex}.resource.${delta.resourceId}`, `${formatValue(delta.before)} -> ${formatValue(delta.after)} (${formatValue(delta.delta)})`, `done.actionResults[${actionIndex}].resourceDeltas.${delta.resourceId}`);
    }
    appendEvidence(rows, testCase, `action.${actionIndex}.cooldown`, `${formatValue(action.cooldownBefore?.readyAtMs)} -> ${formatValue(action.cooldownAfter?.readyAtMs)}`, `done.actionResults[${actionIndex}].cooldownBefore/After.readyAtMs`);
    for (const effect of action.effects ?? []) {
      const effectRef = `done.actionResults[${actionIndex}].effects[${effect.effectIndex}]`;
      appendEvidence(rows, testCase, `action.${actionIndex}.effect.${effect.effectIndex}.kind`, effect.kind, `${effectRef}.kind`);
      appendEvidence(rows, testCase, `action.${actionIndex}.effect.${effect.effectIndex}.damage`, `${formatValue(effect.rawAmount)} -> ${formatValue(effect.finalDamage)} ${effect.damageType ?? ''}`, `${effectRef}.rawAmount/finalDamage`);
      appendEvidence(rows, testCase, `action.${actionIndex}.effect.${effect.effectIndex}.heal`, `${formatValue(effect.healApplied)} / overheal ${formatValue(effect.overhealAmount)}`, `${effectRef}.healApplied`);
      appendEvidence(rows, testCase, `action.${actionIndex}.effect.${effect.effectIndex}.shield`, `grant ${formatValue(effect.shieldGranted)} absorb ${formatValue(effect.shieldAbsorbed)} after ${formatValue(effect.shieldAfter)}`, `${effectRef}.shield*`);
      appendEvidence(rows, testCase, `action.${actionIndex}.effect.${effect.effectIndex}.mark`, `${effect.markId ?? ''} active=${formatValue(effect.markActive)} count=${formatValue(effect.markCount)}`, `${effectRef}.mark*`);
      appendEvidence(rows, testCase, `action.${actionIndex}.effect.${effect.effectIndex}.crit`, `roll=${formatValue(effect.critRoll)} result=${formatValue(effect.critResult)} x${formatValue(effect.critMultiplier)}`, `${effectRef}.crit*`);
      appendEvidence(rows, testCase, `action.${actionIndex}.effect.${effect.effectIndex}.history`, effect.historyWindowMs ?? '', `${effectRef}.historyWindowMs`);
      appendEvidence(rows, testCase, `action.${actionIndex}.effect.${effect.effectIndex}.counter`, `${effect.counterKey ?? ''} ${formatValue(effect.counterBefore)} -> ${formatValue(effect.counterAfter)}`, `${effectRef}.counter*`);
      appendEvidence(rows, testCase, `action.${actionIndex}.effect.${effect.effectIndex}.mode`, `${effect.modeAugmentId ?? ''} active=${formatValue(normalizedModeActive(effect))} x${formatValue(effect.modeMultiplier)}`, `${effectRef}.mode*`);
    }
  }
  for (const [tickIndex, tick] of (done.tickResults ?? []).entries()) {
    appendEvidence(rows, testCase, `tick.${tickIndex}.heal`, `${formatValue(tick.healApplied)} / overheal ${formatValue(tick.overhealAmount)}`, `done.tickResults[${tickIndex}].healApplied`);
    appendEvidence(rows, testCase, `tick.${tickIndex}.hp`, `${formatValue(tick.targetHpBefore)} -> ${formatValue(tick.targetHpAfter)}`, `done.tickResults[${tickIndex}].targetHpBefore/After`);
  }
  for (const [rngIndex, draw] of (done.rng ?? []).entries()) {
    appendEvidence(rows, testCase, `rng.${rngIndex}`, `${draw.stream}/${draw.index}/${draw.use}=${formatValue(draw.value)}`, `done.rng[${rngIndex}]`);
  }
  return rows;
}

function createBlockedResult(testCase: PreparedCase): CaseRunResult {
  return {
    key: testCase.key,
    status: 'blocked',
    durationMs: null,
    ready: null,
    done: null,
    frames: [],
    assertions: [],
    evidenceRows: [],
    summary: testCase.blockedReasons.join('; '),
    error: null
  };
}

function statusColor(status: RunStatus): string {
  if (status === 'passed') {
    return 'green';
  }
  if (status === 'failed' || status === 'error') {
    return 'red';
  }
  if (status === 'blocked') {
    return 'orange';
  }
  if (status === 'running') {
    return 'arcoblue';
  }
  return 'gray';
}

function summarizeRunInput(testCase: PreparedCase): Record<string, unknown> {
  return {
    caseId: testCase.caseId,
    group: testCase.group,
    actions: testCase.input?.runInput.initialActions ?? [],
    seed: testCase.input?.runInput.seed ?? '',
    modeAugments: testCase.input?.runInput.modeAugments ?? [],
    actors: testCase.input?.engineBundle.actors.map((actor) => ({
      id: actor.id,
      maxHp: actor.maxHp,
      initialHp: actor.initialHp,
      actions: actor.actions
    })) ?? []
  };
}

export function WasmValidationM4ClosurePage({
  apiBaseUrl,
  selectedGameId,
  selectedGameName,
  externalRefreshSeed
}: WasmValidationM4ClosurePageProps) {
  const [bundle, setBundle] = useState<GameDataBundle | null>(null);
  const [currentVersion, setCurrentVersion] = useState<CurrentVersion | null>(null);
  const [cacheStatus, setCacheStatus] = useState<string>('idle');
  const [bundleStatus, setBundleStatus] = useState<LoadState>('idle');
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [localRefreshSeed, setLocalRefreshSeed] = useState(0);
  const [results, setResults] = useState<Record<string, CaseRunResult>>({});
  const [selectedCaseKey, setSelectedCaseKey] = useState<string>('');
  const [runAllStatus, setRunAllStatus] = useState<LoadState>('idle');
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function loadBundle() {
      if (!selectedGameId) {
        setBundle(null);
        setCurrentVersion(null);
        setBundleStatus('idle');
        return;
      }
      setBundleStatus('loading');
      setBundleError(null);
      setCacheMessage(null);
      try {
        const snapshot = await loadPublishedBundleSnapshot(apiBaseUrl, selectedGameId);
        if (cancelled) {
          return;
        }
        setBundle(snapshot.bundle);
        setCurrentVersion(snapshot.currentVersion);
        setCacheStatus(snapshot.cacheStatus);
        setResults({});
        setSelectedCaseKey('');
        setBundleStatus('success');
      } catch (error) {
        if (cancelled) {
          return;
        }
        setBundle(null);
        setCurrentVersion(null);
        setBundleStatus('error');
        setBundleError(getErrorMessage(error));
      }
    }
    void loadBundle();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, selectedGameId, externalRefreshSeed, localRefreshSeed]);

  const preparedCases = useMemo(() => (bundle ? buildPreparedCases(bundle) : []), [bundle]);
  const selectedCase = preparedCases.find((testCase) => testCase.key === selectedCaseKey) ?? preparedCases[0] ?? null;
  const selectedResult = selectedCase ? results[selectedCase.key] ?? (selectedCase.blockedReasons.length > 0 ? createBlockedResult(selectedCase) : null) : null;

  const counters = useMemo(() => {
    const blocked = preparedCases.filter((testCase) => testCase.blockedReasons.length > 0).length;
    const passed = Object.values(results).filter((result) => result.status === 'passed').length;
    const failed = Object.values(results).filter((result) => result.status === 'failed' || result.status === 'error').length;
    return {
      total: preparedCases.length,
      runnable: preparedCases.length - blocked,
      blocked,
      passed,
      failed
    };
  }, [preparedCases, results]);

  const runCase = useCallback(async (testCase: PreparedCase): Promise<CaseRunResult> => {
    if (!testCase.input) {
      return createBlockedResult(testCase);
    }

    setResults((current) => ({
      ...current,
      [testCase.key]: {
        key: testCase.key,
        status: 'running',
        durationMs: null,
        ready: null,
        done: null,
        frames: [],
        assertions: [],
        evidenceRows: [],
        summary: 'running',
        error: null
      }
    }));

    const startedAt = performance.now();
    try {
      const bridge = await TinyGoV2Bridge.create({ wasmUrl: TINYGO_V2_WASM_URL });
      const nextFrames: DecodedFrame[] = [];
      nextFrames.push(...decodeFrames(bridge.init(testCase.input.engineBundle), 'init'));
      nextFrames.push(...decodeFrames(bridge.beginRun(testCase.input.runInput), 'begin'));
      let stepStatus = 1;
      let guard = 0;
      while (stepStatus === 1 && guard < 64) {
        const step = bridge.step(32);
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
      const ready = getPayload<ReadyPayload>(nextFrames, READY_FRAME_KIND);
      const done = getPayload<DonePayload>(nextFrames, DONE_FRAME_KIND);
      if (!done) {
        throw new Error('done frame is missing');
      }
      const assertions = evaluateCase(testCase, done);
      const evidenceRows = buildEvidenceRows(testCase, done);
      const result: CaseRunResult = {
        key: testCase.key,
        status: assertions.every((assertion) => assertion.passed) ? 'passed' : 'failed',
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        ready,
        done,
        frames: nextFrames,
        assertions,
        evidenceRows,
        summary: buildCaseSummary(done, assertions),
        error: null
      };
      setResults((current) => ({ ...current, [testCase.key]: result }));
      return result;
    } catch (error) {
      const result: CaseRunResult = {
        key: testCase.key,
        status: 'error',
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        ready: null,
        done: null,
        frames: [],
        assertions: [],
        evidenceRows: [],
        summary: getErrorMessage(error),
        error: getErrorMessage(error)
      };
      setResults((current) => ({ ...current, [testCase.key]: result }));
      return result;
    }
  }, []);

  const runAll = useCallback(async () => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setRunAllStatus('loading');
    const nextBlocked = Object.fromEntries(preparedCases.filter((testCase) => testCase.blockedReasons.length > 0).map((testCase) => [testCase.key, createBlockedResult(testCase)]));
    const nextResults: Record<string, CaseRunResult> = { ...nextBlocked };
    setResults(nextBlocked);
    for (const testCase of preparedCases) {
      if (runIdRef.current !== runId) {
        return;
      }
      if (testCase.blockedReasons.length > 0) {
        continue;
      }
      nextResults[testCase.key] = await runCase(testCase);
    }
    if (runIdRef.current === runId) {
      setResults(applyModePairAssertions(nextResults));
      setRunAllStatus('success');
    }
  }, [preparedCases, runCase]);

  const runCaseFromButton = useCallback(async (testCase: PreparedCase) => {
    setSelectedCaseKey(testCase.key);
    if (testCase.group !== 'M4.19 mode augment') {
      await runCase(testCase);
      return;
    }

    const normal = preparedCases.find((candidate) => candidate.key === 'm4_19_mode_normal');
    const allout = preparedCases.find((candidate) => candidate.key === 'm4_19_mode_allout');
    if (!normal?.input || !allout?.input) {
      await runCase(testCase);
      return;
    }

    const normalResult = await runCase(normal);
    const alloutResult = await runCase(allout);
    setResults((current) =>
      applyModePairAssertions({
        ...current,
        [normal.key]: normalResult,
        [allout.key]: alloutResult
      })
    );
  }, [preparedCases, runCase]);

  const clearBundleCache = useCallback(async () => {
    if (typeof indexedDB === 'undefined') {
      setCacheMessage('当前环境不支持 IndexedDB。');
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(bundleCacheDescriptor.dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'));
      request.onblocked = () => reject(new Error('bundle_db delete blocked by an open connection'));
    }).catch((error) => {
      setCacheMessage(getErrorMessage(error));
      return null;
    });
    setCacheMessage(`已请求清理 ${bundleCacheDescriptor.dbName}，刷新后重新读取 current version。`);
    setLocalRefreshSeed((value) => value + 1);
  }, []);

  const copyPackage = useCallback(async () => {
    if (!navigator.clipboard) {
      return;
    }
    const payload = {
      generatedAt: new Date().toISOString(),
      gameId: selectedGameId,
      versionCode: currentVersion?.versionCode ?? '',
      cacheStatus,
      cases: preparedCases.map((testCase) => ({
        case_meta: {
          caseId: testCase.caseId,
          group: testCase.group,
          label: testCase.label,
          status: results[testCase.key]?.status ?? (testCase.blockedReasons.length > 0 ? 'blocked' : 'idle'),
          blockedReasons: testCase.blockedReasons
        },
        runInput: testCase.input?.runInput ?? null,
        wasm_output: results[testCase.key]?.done ?? null,
        assertions: results[testCase.key]?.assertions ?? [],
        evidenceRows: results[testCase.key]?.evidenceRows ?? []
      }))
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  }, [cacheStatus, currentVersion?.versionCode, preparedCases, results, selectedGameId]);

  const caseRows = preparedCases.map((testCase) => {
    const result = results[testCase.key] ?? (testCase.blockedReasons.length > 0 ? createBlockedResult(testCase) : null);
    return {
      ...testCase,
      status: result?.status ?? 'idle',
      summary: result?.summary ?? summarizeRunInput(testCase),
      durationMs: result?.durationMs
    };
  });

  const caseColumns = [
    {
      title: 'Preset',
      render: (_: unknown, record: (typeof caseRows)[number]) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>{record.group}</Typography.Text>
          <Typography.Text type="secondary">{record.label}</Typography.Text>
        </Space>
      )
    },
    { title: 'caseId', dataIndex: 'caseId' },
    {
      title: 'status',
      render: (_: unknown, record: (typeof caseRows)[number]) => <Tag color={statusColor(record.status)}>{record.status}</Tag>
    },
    {
      title: 'summary',
      render: (_: unknown, record: (typeof caseRows)[number]) => <Typography.Text>{typeof record.summary === 'string' ? record.summary : JSON.stringify(record.summary)}</Typography.Text>
    },
    {
      title: 'actions',
      render: (_: unknown, record: (typeof caseRows)[number]) => (
        <Space direction="vertical" size={2}>
          {record.actionIds.map((id, index) => (
            <Typography.Text key={`${id}:${index}`} code>
              {id}
            </Typography.Text>
          ))}
        </Space>
      )
    },
    {
      title: '',
      render: (_: unknown, record: (typeof caseRows)[number]) => (
        <Button
          size="small"
          onClick={() => {
            void runCaseFromButton(record);
          }}
          disabled={!record.input}
          loading={results[record.key]?.status === 'running'}
        >
          Run
        </Button>
      )
    }
  ];

  const assertionColumns = [
    { title: 'field', dataIndex: 'field' },
    { title: 'actual', render: (_: unknown, record: AssertionRow) => <Typography.Text>{formatValue(record.actual)}</Typography.Text> },
    { title: 'expected', dataIndex: 'expected' },
    {
      title: 'status',
      render: (_: unknown, record: AssertionRow) => <Tag color={record.passed ? 'green' : 'red'}>{record.passed ? 'pass' : 'fail'}</Tag>
    },
    { title: 'evidenceRef', dataIndex: 'evidenceRef' }
  ];

  const evidenceColumns = [
    { title: 'caseId', dataIndex: 'caseId' },
    { title: 'field', dataIndex: 'field' },
    { title: 'value', render: (_: unknown, record: EvidenceRow) => <Typography.Text>{formatValue(record.value)}</Typography.Text> },
    { title: 'evidenceRef', dataIndex: 'evidenceRef' }
  ];

  return (
    <div className="wasm-validation-page">
      <section className="workspace-hero">
        <Space direction="vertical" size={8}>
          <Typography.Text className="workspace-rail">Wasm 验证 M4 闭环 / {selectedGameName}</Typography.Text>
          <Typography.Title heading={2}>M4 closure presets</Typography.Title>
        </Space>
        <Space wrap>
          <Button icon={<IconRefresh />} onClick={() => void runAll()} loading={runAllStatus === 'loading'} disabled={preparedCases.length === 0}>
            运行全部
          </Button>
          <Button icon={<IconRefresh />} onClick={() => setLocalRefreshSeed((value) => value + 1)} loading={bundleStatus === 'loading'}>
            刷新 Bundle
          </Button>
          <Button onClick={() => void clearBundleCache()}>清理 bundle_db</Button>
          <Button icon={<IconCopy />} onClick={() => void copyPackage()} disabled={preparedCases.length === 0}>
            复制验收包
          </Button>
        </Space>
      </section>

      <Row gutter={[16, 16]}>
        <Col span={5}>
          <MetricCard label="Bundle" value={currentVersion?.versionCode ?? '未加载'} hint={`cache ${cacheStatus}`} />
        </Col>
        <Col span={5}>
          <MetricCard label="Cases" value={`${counters.runnable}/${counters.total}`} hint={`blocked ${counters.blocked}`} />
        </Col>
        <Col span={5}>
          <MetricCard label="Passed" value={String(counters.passed)} hint={`failed ${counters.failed}`} />
        </Col>
        <Col span={5}>
          <MetricCard label="Game" value={selectedGameId ?? 'none'} hint={selectedGameName} />
        </Col>
        <Col span={4}>
          <MetricCard label="Status" value={bundleStatus} hint={runAllStatus} />
        </Col>
      </Row>

      {bundleError ? <Alert type="error" content={bundleError} /> : null}
      {cacheMessage ? <Alert type={cacheMessage.startsWith('已') ? 'success' : 'warning'} content={cacheMessage} /> : null}
      {!selectedGameId ? <Alert type="warning" content="请先选择游戏。" /> : null}

      <Panel title="Preset 运行表" kicker="published bundle only">
        {bundleStatus === 'loading' ? <EmptyState title="正在加载 published bundle" description="等待 current version 和 bundle snapshot 返回。" /> : null}
        {preparedCases.length > 0 ? (
          <Table rowKey="key" columns={caseColumns} data={caseRows} pagination={false} size="small" onRow={(record) => ({ onClick: () => setSelectedCaseKey(record.key) })} />
        ) : (
          <EmptyState title="没有可运行 preset" description="选择游戏并加载 published bundle 后生成固定 preset。" />
        )}
      </Panel>

      <Panel
        title="断言"
        kicker={selectedCase?.caseId ?? 'case'}
        actions={selectedResult ? <Tag color={statusColor(selectedResult.status)}>{selectedResult.status}</Tag> : null}
      >
        {selectedResult?.assertions.length ? (
          <Table rowKey="field" columns={assertionColumns} data={selectedResult.assertions} pagination={false} size="small" />
        ) : (
          <EmptyState title="还没有断言结果" description={selectedResult?.summary ?? '运行一个非 blocked preset。'} />
        )}
      </Panel>

      <Panel title="字段汇总" kicker="accepted / effect / hp / resource / cooldown / rng / mode">
        {selectedResult?.evidenceRows.length ? (
          <Table rowKey="key" columns={evidenceColumns} data={selectedResult.evidenceRows} pagination={false} size="small" />
        ) : (
          <EmptyState title="还没有字段汇总" description="运行后这里会显示闭环字段。" />
        )}
      </Panel>

      <Panel title="Run Input" kicker="compiled and patched">
        {selectedCase ? <JsonBlock value={summarizeRunInput(selectedCase)} /> : <EmptyState title="没有选中 case" description="先加载 bundle。" />}
      </Panel>

      <Panel title="Wasm 输出" kicker="done payload">
        {selectedResult?.done ? <JsonBlock value={selectedResult.done} /> : <EmptyState title="done payload 为空" description="运行后展示 decoded done frame。" />}
      </Panel>
    </div>
  );
}
