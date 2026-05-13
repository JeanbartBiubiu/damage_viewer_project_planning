import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Grid,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from '@arco-design/web-react';
import { IconCopy, IconRefresh } from '@arco-design/web-react/icon';
import { EmptyState } from '../components/EmptyState';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import { ResourceImageThumb } from '../components/ResourceImageThumb';
import {
  compileTinyGoV2ValidationInput,
  createDefaultWasmValidationSelection,
  detectMaxLevel,
  listWasmValidationSkills,
  type ActorInputSummary,
  type TinyGoV2ValidationInput,
  type WasmValidationSelection,
  type WasmValidationSkillOption
} from '../engine/tinygoV2BundleAdapter';
import { TinyGoV2Bridge, decodeFramePayload, type TinyGoV2Frame } from '../engine/tinygoV2Bridge';
import { getErrorMessage } from '../services/apiClient';
import { buildAttributeImageUri } from '../services/resourceImage';
import { loadPublishedBundleSnapshot } from '../services/bundleSnapshot';
import { useResourceImageCache } from './admin/resources/shared/useResourceImageCache';
import type { CurrentVersion, GameDataBundle, LoadState } from '../types/api';

type WasmValidationM2PageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
  externalRefreshSeed: number;
};

type ReadyPayload = {
  schemaVersion: number;
  actorCount: number;
  actionCount: number;
  statusCount: number;
  formulaCount: number;
  triggerCount: number;
  attributeCount?: number;
  resourceCount?: number;
};

type AttributeSnapshot = {
  base: number;
  current: number;
  max: number;
  resolved: number;
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
  attributes?: Record<string, AttributeSnapshot>;
  resources?: Record<string, ResourceSnapshot>;
};

type InitialSnapshotPayload = {
  timeMs: number;
  actors: ActorSnapshot[];
};

type ActionCostSnapshot = {
  resourceId?: string;
  formulaId?: string;
  amount: number;
  source?: string;
  baseAmount?: number;
  finalAmount?: number;
  breakdown?: ActionValueBreakdownStep[];
};

type ActionValueBreakdownStep = {
  formulaId?: string;
  op: string;
  ref?: string;
  value: number;
};

type ActionEffectSnapshot = {
  effectIndex: number;
  kind: string;
  label?: string;
  formulaId?: string;
  damageType?: string;
  statusId?: string;
  attrId?: string;
  markId?: string;
  sourceRole?: string;
  targetRole?: string;
  resolvedAmount?: number;
  hasResolvedAmount?: boolean;
  source?: string;
  baseAmount?: number;
  finalAmount?: number;
  breakdown?: ActionValueBreakdownStep[];
};

type ActionInitialState = {
  actionId: string;
  label: string;
  skillLevel?: number;
  panelInputs?: Record<string, number>;
  cooldownMs: number;
  cooldownFormulaId?: string;
  cooldownBreakdown?: ActionValueBreakdownStep[];
  readyAtMs: number;
  canCast: boolean;
  blockedReason: string;
  resourceCosts?: ActionCostSnapshot[];
  effectRows?: ActionEffectSnapshot[];
};

type ActorActionSnapshot = {
  actorId: string;
  actions: ActionInitialState[];
};

type ActionSnapshotPayload = {
  timeMs: number;
  actors: ActorActionSnapshot[];
};

type DecodedFrame = {
  key: string;
  kind: number;
  kindLabel: string;
  payload: unknown;
};

type AttributeRow = AttributeSnapshot & {
  key: string;
  actorId: string;
  attrId: string;
  baseline: number | null;
  diff: number | null;
};

type ActorRow = ActorSnapshot & {
  key: string;
  attributeCount: number;
  resourceCount: number;
};

type ActorInputRow = ActorInputSummary & {
  key: string;
  itemText: string;
};

type SkillOptionRow = WasmValidationSkillOption & {
  key: string;
};

type ActionRow = ActionInitialState & {
  key: string;
  actorId: string;
  baselineState: 'none' | 'match' | 'diff';
  baselineComparable: string | null;
};

type ActionEvidenceRow = {
  key: string;
  actorId: string;
  actionId: string;
  field: string;
  wasmValue: string;
  evidenceRef: string;
  note: string;
};

type ManualBaseline = Record<string, unknown>;

const { Row, Col } = Grid;
const { TextArea } = Input;

const TINYGO_V2_WASM_URL = new URL('../engine/wasm/tinygo_engine_v2.wasm', import.meta.url);
const WASM_ASSET_LABEL = 'src/engine/wasm/tinygo_engine_v2.wasm';
const SNAPSHOT_FRAME_KIND = 16;
const ACTION_SNAPSHOT_FRAME_KIND = 17;
const M2_ABILITY_HASTE_CASE_BONUS = 20;
const ABILITY_HASTE_ATTR_KEY = 'ability_haste';

const FRAME_KIND_LABELS: Record<number, string> = {
  10: 'tick',
  11: 'log',
  12: 'sample',
  13: 'done',
  14: 'error',
  15: 'ready',
  16: 'snapshot',
  17: 'action_snapshot'
};

function formatNumber(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function formatLoadState(status: LoadState): string {
  if (status === 'loading') {
    return '加载中';
  }
  if (status === 'success') {
    return '就绪';
  }
  if (status === 'error') {
    return '错误';
  }
  return '空闲';
}

function decodeFrames(frames: TinyGoV2Frame[], prefix: string): DecodedFrame[] {
  return frames.map((frame, index) => ({
    key: `${prefix}-${index}`,
    kind: frame.kind,
    kindLabel: FRAME_KIND_LABELS[frame.kind] ?? `kind ${frame.kind}`,
    payload: decodeFramePayload<unknown>(frame)
  }));
}

function getPayload<T>(frames: DecodedFrame[], kind: number): T | null {
  return (frames.find((frame) => frame.kind === kind)?.payload as T | undefined) ?? null;
}

function parseBaseline(text: string): { baseline: ManualBaseline | null; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { baseline: null, error: null };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { baseline: null, error: '人工基线必须是 JSON 对象。' };
    }
    return { baseline: parsed as ManualBaseline, error: null };
  } catch (error) {
    return { baseline: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function readBaselineValue(baseline: ManualBaseline | null, actorId: string, attrId: string): number | null {
  if (!baseline) {
    return null;
  }

  const actorValue = baseline[actorId];
  if (!actorValue || typeof actorValue !== 'object' || Array.isArray(actorValue)) {
    return null;
  }

  const actorRecord = actorValue as Record<string, unknown>;
  const directValue = actorRecord[attrId];
  const nestedAttributes = actorRecord.attributes;
  const nestedValue =
    nestedAttributes && typeof nestedAttributes === 'object' && !Array.isArray(nestedAttributes)
      ? (nestedAttributes as Record<string, unknown>)[attrId]
      : undefined;
  const value = directValue ?? nestedValue;

  if (typeof value === 'number') {
    return value;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const resolved = (value as Record<string, unknown>).resolved;
    return typeof resolved === 'number' ? resolved : null;
  }
  return null;
}

function buildAttributeRows(snapshot: InitialSnapshotPayload | null, baseline: ManualBaseline | null): AttributeRow[] {
  return (
    snapshot?.actors.flatMap((actor) =>
      Object.entries(actor.attributes ?? {}).map(([attrId, values]) => {
        const baselineValue = readBaselineValue(baseline, actor.actorId, attrId);
        const diff = baselineValue === null ? null : values.resolved - baselineValue;
        return {
          key: `${actor.actorId}-${attrId}`,
          actorId: actor.actorId,
          attrId,
          baseline: baselineValue,
          diff,
          ...values
        };
      })
    ) ?? []
  );
}

function buildActorRows(snapshot: InitialSnapshotPayload | null): ActorRow[] {
  return (
    snapshot?.actors.map((actor) => ({
      ...actor,
      key: actor.actorId,
      attributeCount: Object.keys(actor.attributes ?? {}).length,
      resourceCount: Object.keys(actor.resources ?? {}).length
    })) ?? []
  );
}

function buildActorInputRows(input: TinyGoV2ValidationInput | null): ActorInputRow[] {
  return (
    input?.summaries.map((summary) => ({
      ...summary,
      key: summary.actorId,
      itemText: summary.itemNames.length > 0 ? summary.itemNames.join(', ') : '--'
    })) ?? []
  );
}

function buildSkillRows(options: WasmValidationSkillOption[]): SkillOptionRow[] {
  return options.map((option) => ({
    ...option,
    key: option.actionId
  }));
}

function normalizeActionState(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const resourceCosts = Array.isArray(record.resourceCosts)
    ? record.resourceCosts.map((row) => normalizeActionCost(row)).filter(Boolean)
    : [];
  const effectRows = Array.isArray(record.effectRows)
    ? record.effectRows.map((row) => normalizeActionEffect(row)).filter(Boolean)
    : [];
  const cooldownBreakdown = Array.isArray(record.cooldownBreakdown)
    ? record.cooldownBreakdown.map((row) => normalizeBreakdownStep(row)).filter(Boolean)
    : [];
  const panelInputs = normalizeNumberMap(record.panelInputs);
  return {
    skillLevel: toFiniteOptional(record.skillLevel),
    panelInputs,
    cooldownMs: toFiniteNumber(record.cooldownMs),
    cooldownFormulaId: typeof record.cooldownFormulaId === 'string' ? record.cooldownFormulaId : '',
    cooldownBreakdown,
    readyAtMs: toFiniteNumber(record.readyAtMs),
    canCast: Boolean(record.canCast),
    blockedReason: typeof record.blockedReason === 'string' ? record.blockedReason : '',
    resourceCosts,
    effectRows
  };
}

function normalizeActionCost(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    resourceId: typeof record.resourceId === 'string' ? record.resourceId : '',
    formulaId: typeof record.formulaId === 'string' ? record.formulaId : '',
    amount: roundComparable(toFiniteNumber(record.amount)),
    source: typeof record.source === 'string' ? record.source : '',
    baseAmount: roundComparableOptional(record.baseAmount),
    finalAmount: roundComparableOptional(record.finalAmount),
    breakdown: Array.isArray(record.breakdown) ? record.breakdown.map((row) => normalizeBreakdownStep(row)).filter(Boolean) : []
  };
}

function normalizeActionEffect(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    effectIndex: toFiniteNumber(record.effectIndex),
    kind: typeof record.kind === 'string' ? record.kind : '',
    label: typeof record.label === 'string' ? record.label : '',
    formulaId: typeof record.formulaId === 'string' ? record.formulaId : '',
    damageType: typeof record.damageType === 'string' ? record.damageType : '',
    statusId: typeof record.statusId === 'string' ? record.statusId : '',
    attrId: typeof record.attrId === 'string' ? record.attrId : '',
    markId: typeof record.markId === 'string' ? record.markId : '',
    sourceRole: typeof record.sourceRole === 'string' ? record.sourceRole : '',
    targetRole: typeof record.targetRole === 'string' ? record.targetRole : '',
    resolvedAmount: roundComparableOptional(record.resolvedAmount),
    hasResolvedAmount: Boolean(record.hasResolvedAmount),
    source: typeof record.source === 'string' ? record.source : '',
    baseAmount: roundComparableOptional(record.baseAmount),
    finalAmount: roundComparableOptional(record.finalAmount),
    breakdown: Array.isArray(record.breakdown) ? record.breakdown.map((row) => normalizeBreakdownStep(row)).filter(Boolean) : []
  };
}

function normalizeBreakdownStep(value: unknown): ActionValueBreakdownStep | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    formulaId: typeof record.formulaId === 'string' ? record.formulaId : '',
    op: typeof record.op === 'string' ? record.op : '',
    ref: typeof record.ref === 'string' ? record.ref : '',
    value: roundComparable(toFiniteNumber(record.value))
  };
}

function normalizeNumberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, raw]) => [key, roundComparable(toFiniteNumber(raw))] as const)
      .filter(([, raw]) => Number.isFinite(raw))
  );
}

function createDefaultM2Selection(bundle: GameDataBundle): WasmValidationSelection {
  const fallback = createDefaultWasmValidationSelection(bundle);
  const ahri = bundle.heroes.find((hero) => hero.heroId === 'hero_ahri');
  if (bundle.meta.gameId !== 'lol' || !ahri) {
    return fallback;
  }

  const candidate: WasmValidationSelection = {
    ...fallback,
    selfHeroId: ahri.heroId,
    enemyHeroId: fallback.enemyHeroId || ahri.heroId,
    selfLevel: 1,
    enemyLevel: 1,
    selfItemIds: [],
    enemyItemIds: [],
    selfSkillLevels: {},
    enemySkillLevels: {},
    selfAttributeBonuses: {
      ...(fallback.selfAttributeBonuses ?? {}),
      [ABILITY_HASTE_ATTR_KEY]: M2_ABILITY_HASTE_CASE_BONUS
    },
    enemyAttributeBonuses: fallback.enemyAttributeBonuses ?? {},
    selfAttributeOverrides: {},
    enemyAttributeOverrides: {}
  };
  const selfSkills = listWasmValidationSkills(bundle, candidate, 'self');
  const ahriQ = selfSkills.find((skill) => skill.skillKey === 'Q');
  return {
    ...candidate,
    selfSkillLevels: ahriQ ? { [ahriQ.skillId]: 1 } : {}
  };
}

function formatAttributeModifiers(record: ActorInputRow): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(record.attributeBonuses ?? {})) {
    lines.push(`bonus.${key}=${formatNumber(value)}`);
  }
  for (const [key, value] of Object.entries(record.attributeOverrides ?? {})) {
    lines.push(`override.${key}=${formatNumber(value)}`);
  }
  return lines;
}

function readActionBaselineValue(baseline: ManualBaseline | null, actorId: string, actionId: string): string | null {
  if (!baseline) {
    return null;
  }

  const actionsNode = baseline.actions;
  if (actionsNode && typeof actionsNode === 'object' && !Array.isArray(actionsNode)) {
    const actionGroup = (actionsNode as Record<string, unknown>)[actorId];
    const normalized = normalizeActionState(
      readActionBaselineFromActorValue(actionGroup, actionId)
    );
    return normalized ? JSON.stringify(normalized) : null;
  }

  const actorsNode = baseline.actors;
  if (Array.isArray(actorsNode)) {
    for (const actor of actorsNode) {
      if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
        continue;
      }
      const actorRecord = actor as Record<string, unknown>;
      if (actorRecord.actorId !== actorId) {
        continue;
      }
      const normalized = normalizeActionState(readActionBaselineFromActorValue(actorRecord, actionId));
      return normalized ? JSON.stringify(normalized) : null;
    }
  }

  const topLevelActor = baseline[actorId];
  const normalized = normalizeActionState(readActionBaselineFromActorValue(topLevelActor, actionId));
  return normalized ? JSON.stringify(normalized) : null;
}

function readActionBaselineFromActorValue(actorValue: unknown, actionId: string): unknown {
  if (!actorValue || typeof actorValue !== 'object' || Array.isArray(actorValue)) {
    return null;
  }
  const actorRecord = actorValue as Record<string, unknown>;
  const directValue = actorRecord[actionId];
  if (directValue) {
    return directValue;
  }
  const nestedActions = actorRecord.actions;
  if (Array.isArray(nestedActions)) {
    return nestedActions.find((action) => {
      if (!action || typeof action !== 'object' || Array.isArray(action)) {
        return false;
      }
      return (action as Record<string, unknown>).actionId === actionId;
    }) ?? null;
  }
  if (nestedActions && typeof nestedActions === 'object' && !Array.isArray(nestedActions)) {
    return (nestedActions as Record<string, unknown>)[actionId] ?? null;
  }
  return null;
}

function buildActionRows(snapshot: ActionSnapshotPayload | null, baseline: ManualBaseline | null): ActionRow[] {
  return (
    snapshot?.actors.flatMap((actor) =>
      actor.actions.map((action) => {
        const currentComparable = JSON.stringify(normalizeActionState(action));
        const baselineComparable = readActionBaselineValue(baseline, actor.actorId, action.actionId);
        return {
          ...action,
          key: `${actor.actorId}-${action.actionId}`,
          actorId: actor.actorId,
          baselineComparable,
          baselineState:
            baselineComparable === null
              ? 'none'
              : baselineComparable === currentComparable
                ? 'match'
                : 'diff'
        };
      })
    ) ?? []
  );
}

function buildActionEvidenceRows(actionRows: ActionRow[]): ActionEvidenceRow[] {
  return actionRows.flatMap((action) => {
    const rows: ActionEvidenceRow[] = [
      actionEvidenceRow(action, 'skillLevel', formatNumber(action.skillLevel ?? 1, 0), 'action.skillLevel', 'run input 或 bundle 默认技能等级'),
      actionEvidenceRow(action, 'cooldownMs', formatNumber(action.cooldownMs, 0), 'action.cooldownMs', action.cooldownFormulaId || 'static cooldown')
    ];
    for (const cost of action.resourceCosts ?? []) {
      const resource = cost.resourceId || 'resource';
      rows.push(
        actionEvidenceRow(
          action,
          `cost.${resource}`,
          formatNumber(cost.finalAmount ?? cost.amount),
          `action.resourceCosts.${resource}`,
          cost.formulaId || cost.source || 'resourceCost fallback'
        )
      );
    }
    for (const effect of action.effectRows ?? []) {
      rows.push(
        actionEvidenceRow(
          action,
          `effect.${effect.effectIndex}.${effect.kind}`,
          effect.hasResolvedAmount ? formatNumber(effect.finalAmount ?? effect.resolvedAmount) : '',
          `action.effectRows.${effect.effectIndex}`,
          effect.formulaId || effect.source || 'effect fallback'
        )
      );
    }
    return rows;
  });
}

function actionEvidenceRow(action: ActionRow, field: string, wasmValue: string, evidenceRef: string, note: string): ActionEvidenceRow {
  return {
    key: `${action.actorId}-${action.actionId}-${field}`,
    actorId: action.actorId,
    actionId: action.actionId,
    field,
    wasmValue,
    evidenceRef,
    note
  };
}

function renderDiffTag(diff: number | null) {
  if (diff === null) {
    return <Tag color="gray">--</Tag>;
  }
  if (Math.abs(diff) < 0.0001) {
    return <Tag color="green">0</Tag>;
  }
  return <Tag color="red">{formatNumber(diff)}</Tag>;
}

function renderActionDiffTag(state: ActionRow['baselineState']) {
  if (state === 'none') {
    return <Tag color="gray">--</Tag>;
  }
  if (state === 'match') {
    return <Tag color="green">一致</Tag>;
  }
  return <Tag color="red">差异</Tag>;
}

function renderLines(lines: string[]) {
  if (lines.length === 0) {
    return '--';
  }
  return (
    <Space direction="vertical" size={2}>
      {lines.map((line, index) => (
        <Typography.Text key={`${line}-${index}`} className="wasm-code-token">
          {line}
        </Typography.Text>
      ))}
    </Space>
  );
}

function formatActionCosts(rows: ActionCostSnapshot[] | undefined): string[] {
  if (!rows || rows.length === 0) {
    return [];
  }
  return rows.map((row) => {
    const label = row.resourceId || 'resource';
    const formula = row.formulaId ? ` (${row.formulaId})` : '';
    const source = row.source ? `[${row.source}] ` : '';
    const breakdown = formatBreakdown(row.breakdown);
    return `${source}${label}=${formatNumber(row.finalAmount ?? row.amount)}${formula}${breakdown ? ` | ${breakdown}` : ''}`;
  });
}

function formatActionEffects(rows: ActionEffectSnapshot[] | undefined): string[] {
  if (!rows || rows.length === 0) {
    return [];
  }
  return rows.map((row) => {
    const meta = [row.damageType, row.attrId, row.statusId, row.markId].filter(Boolean).join('/');
    const roles = [row.sourceRole, row.targetRole].filter(Boolean).join('->');
    const amount = row.hasResolvedAmount ? ` ${formatNumber(row.finalAmount ?? row.resolvedAmount)}` : '';
    const formula = row.formulaId ? ` (${row.formulaId})` : '';
    const source = row.source ? `[${row.source}] ` : '';
    const suffix = [meta, roles].filter(Boolean).join(' ');
    const breakdown = formatBreakdown(row.breakdown);
    return `${source}#${row.effectIndex} ${row.kind}${amount}${suffix ? ` ${suffix}` : ''}${formula}${breakdown ? ` | ${breakdown}` : ''}`;
  });
}

function formatBreakdown(rows: ActionValueBreakdownStep[] | undefined): string {
  if (!rows || rows.length === 0) {
    return '';
  }
  return rows
    .map((row) => {
      const ref = row.ref ? `:${row.ref}` : '';
      return `${row.op}${ref}=${formatNumber(row.value)}`;
    })
    .join(' -> ');
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function clampLevelInput(value: unknown, maxLevel: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.min(maxLevel, Math.round(parsed)));
}

function toFiniteNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toFiniteOptional(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function roundComparable(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundComparableOptional(value: unknown): number | undefined {
  const numeric = toFiniteOptional(value);
  return numeric === undefined ? undefined : roundComparable(numeric);
}

export function WasmValidationM2Page({
  apiBaseUrl,
  selectedGameId,
  selectedGameName,
  externalRefreshSeed
}: WasmValidationM2PageProps) {
  const runIdRef = useRef(0);
  const [bundleStatus, setBundleStatus] = useState<LoadState>('idle');
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<GameDataBundle | null>(null);
  const [currentVersion, setCurrentVersion] = useState<CurrentVersion | null>(null);
  const [cacheStatus, setCacheStatus] = useState<'hit' | 'miss' | null>(null);
  const [manualRefreshSeed, setManualRefreshSeed] = useState(0);
  const [selection, setSelection] = useState<WasmValidationSelection | null>(null);
  const [status, setStatus] = useState<LoadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [frames, setFrames] = useState<DecodedFrame[]>([]);
  const [baselineText, setBaselineText] = useState('');
  const [actionBaselineText, setActionBaselineText] = useState('');
  const [collapsedAttributeSides, setCollapsedAttributeSides] = useState({ self: false, enemy: false });
  const { imageSrcByUri } = useResourceImageCache(selectedGameId);

  useEffect(() => {
    let cancelled = false;
    setBundle(null);
    setCurrentVersion(null);
    setCacheStatus(null);
    setSelection(null);
    setFrames([]);
    setStatus('idle');
    setErrorMessage(null);
    setDurationMs(null);

    if (!selectedGameId) {
      setBundleStatus('idle');
      setBundleError(null);
      return () => {
        cancelled = true;
      };
    }
    const gameId = selectedGameId;

    async function loadBundle() {
      setBundleStatus('loading');
      setBundleError(null);

      try {
        const snapshot = await loadPublishedBundleSnapshot(apiBaseUrl, gameId);
        if (cancelled) {
          return;
        }
        setBundle(snapshot.bundle);
        setCurrentVersion(snapshot.currentVersion);
        setCacheStatus(snapshot.cacheStatus);
        setSelection(createDefaultM2Selection(snapshot.bundle));
        setBundleStatus('success');
      } catch (error) {
        if (cancelled) {
          return;
        }
        setBundleStatus('error');
        setBundleError(getErrorMessage(error));
      }
    }

    void loadBundle();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, selectedGameId, externalRefreshSeed, manualRefreshSeed]);

  const maxLevel = useMemo(() => (bundle ? detectMaxLevel(bundle) : 18), [bundle]);
  const inputPreview = useMemo(() => {
    if (!bundle || !selection) {
      return { value: null, error: null };
    }

    try {
      return {
        value: compileTinyGoV2ValidationInput(bundle, selection),
        error: null
      };
    } catch (error) {
      return {
        value: null,
        error: getErrorMessage(error)
      };
    }
  }, [bundle, selection]);

  const selfSkills = useMemo(
    () => (bundle && selection ? buildSkillRows(listWasmValidationSkills(bundle, selection, 'self')) : []),
    [bundle, selection]
  );
  const enemySkills = useMemo(
    () => (bundle && selection ? buildSkillRows(listWasmValidationSkills(bundle, selection, 'enemy')) : []),
    [bundle, selection]
  );

  const { baseline, error: baselineError } = useMemo(() => parseBaseline(baselineText), [baselineText]);
  const { baseline: actionBaseline, error: actionBaselineError } = useMemo(
    () => parseBaseline(actionBaselineText),
    [actionBaselineText]
  );
  const readyPayload = useMemo(() => getPayload<ReadyPayload>(frames, 15), [frames]);
  const snapshotPayload = useMemo(() => getPayload<InitialSnapshotPayload>(frames, SNAPSHOT_FRAME_KIND), [frames]);
  const actionSnapshotPayload = useMemo(() => getPayload<ActionSnapshotPayload>(frames, ACTION_SNAPSHOT_FRAME_KIND), [frames]);
  const actorRows = useMemo(() => buildActorRows(snapshotPayload), [snapshotPayload]);
  const attributeRows = useMemo(() => buildAttributeRows(snapshotPayload, baseline), [snapshotPayload, baseline]);
  const actorInputRows = useMemo(() => buildActorInputRows(inputPreview.value), [inputPreview.value]);
  const actionRows = useMemo(() => buildActionRows(actionSnapshotPayload, actionBaseline), [actionSnapshotPayload, actionBaseline]);
  const actionEvidenceRows = useMemo(() => buildActionEvidenceRows(actionRows), [actionRows]);
  const matchedRows = attributeRows.filter((row) => row.baseline !== null);
  const diffRows = matchedRows.filter((row) => row.diff !== null && Math.abs(row.diff) >= 0.0001);
  const matchedActionRows = actionRows.filter((row) => row.baselineState !== 'none');
  const diffActionRows = actionRows.filter((row) => row.baselineState === 'diff');
  const attributeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const definition of bundle?.attributeDefinitions ?? []) {
      const displayName = definition.attrName?.trim() ?? '';
      if (displayName) {
        map.set(definition.attrKey, displayName);
      }
    }
    return map;
  }, [bundle]);
  const sideActorIds = useMemo(() => {
    const normalize = (value: string) => value.trim().toLowerCase();
    const selfActor = actorRows.find((row) => normalize(row.actorId) === 'self');
    const enemyActor = actorRows.find((row) => normalize(row.actorId) === 'enemy');
    const fallbackIds = actorRows.map((row) => row.actorId);
    const selfId = selfActor?.actorId ?? fallbackIds[0] ?? 'self';
    const enemyId = enemyActor?.actorId ?? fallbackIds.find((id) => id !== selfId) ?? 'enemy';

    return {
      selfId,
      enemyId
    };
  }, [actorRows]);
  const selfActorRows = useMemo(
    () => actorRows.filter((row) => row.actorId === sideActorIds.selfId),
    [actorRows, sideActorIds.selfId]
  );
  const enemyActorRows = useMemo(
    () => actorRows.filter((row) => row.actorId === sideActorIds.enemyId),
    [actorRows, sideActorIds.enemyId]
  );
  const selfAttributeRows = useMemo(
    () => attributeRows.filter((row) => row.actorId === sideActorIds.selfId),
    [attributeRows, sideActorIds.selfId]
  );
  const enemyAttributeRows = useMemo(
    () => attributeRows.filter((row) => row.actorId === sideActorIds.enemyId),
    [attributeRows, sideActorIds.enemyId]
  );

  const updateSelection = useCallback((patch: Partial<WasmValidationSelection>) => {
    setSelection((current) => (current ? { ...current, ...patch } : current));
    setFrames([]);
    setStatus('idle');
    setErrorMessage(null);
    setDurationMs(null);
  }, []);

  const updateSkillLevel = useCallback((side: 'self' | 'enemy', skillId: string, value: unknown, maxSkillLevel: number) => {
    setSelection((current) => {
      if (!current) {
        return current;
      }
      const field = side === 'self' ? 'selfSkillLevels' : 'enemySkillLevels';
      return {
        ...current,
        [field]: {
          ...current[field],
          [skillId]: clampLevelInput(value, maxSkillLevel)
        }
      };
    });
    setFrames([]);
    setStatus('idle');
    setErrorMessage(null);
    setDurationMs(null);
  }, []);

  const updateAttributeBonus = useCallback((side: 'self' | 'enemy', attrKey: string, value: unknown) => {
    const parsed = Number(value);
    const nextValue = Number.isFinite(parsed) ? parsed : 0;
    setSelection((current) => {
      if (!current) {
        return current;
      }
      const field = side === 'self' ? 'selfAttributeBonuses' : 'enemyAttributeBonuses';
      return {
        ...current,
        [field]: {
          ...(current[field] ?? {}),
          [attrKey]: nextValue
        }
      };
    });
    setFrames([]);
    setStatus('idle');
    setErrorMessage(null);
    setDurationMs(null);
  }, []);

  const applyAbilityHasteCase = useCallback(() => {
    if (!bundle) {
      return;
    }
    setSelection(createDefaultM2Selection(bundle));
    setFrames([]);
    setStatus('idle');
    setErrorMessage(null);
    setDurationMs(null);
  }, [bundle]);

  const toggleAttributeSide = useCallback((side: 'self' | 'enemy') => {
    setCollapsedAttributeSides((current) => ({
      ...current,
      [side]: !current[side]
    }));
  }, []);

  const runSnapshot = useCallback(async () => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setStatus('loading');
    setErrorMessage(null);
    setDurationMs(null);

    try {
      if (!inputPreview.value) {
        throw new Error(inputPreview.error ?? 'Bundle 输入尚未准备好。');
      }

      const startedAt = performance.now();
      const bridge = await TinyGoV2Bridge.create({ wasmUrl: TINYGO_V2_WASM_URL });
      const initFrames = decodeFrames(bridge.init(inputPreview.value.engineBundle), 'init');
      const snapshotFrames = decodeFrames(bridge.snapshotInitial(inputPreview.value.runInput), 'snapshot');
      const actionFrames = decodeFrames(bridge.snapshotActionsInitial(inputPreview.value.runInput), 'action');
      const completedAt = performance.now();
      if (runIdRef.current !== runId) {
        return;
      }
      setFrames([...initFrames, ...snapshotFrames, ...actionFrames]);
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

  const handleCopySnapshot = useCallback(async () => {
    if (!snapshotPayload || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(snapshotPayload, null, 2));
  }, [snapshotPayload]);

  const handleCopyActionSnapshot = useCallback(async () => {
    if (!actionSnapshotPayload || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(actionSnapshotPayload, null, 2));
  }, [actionSnapshotPayload]);
  const resolveAttributeImageSrc = useCallback(
    (attrId: string) => {
      const imageUri = buildAttributeImageUri(attrId);
      return imageUri ? imageSrcByUri[imageUri] ?? null : null;
    },
    [imageSrcByUri]
  );
  const resolveAttributeDisplayName = useCallback(
    (attrId: string) => attributeNameById.get(attrId) ?? attrId,
    [attributeNameById]
  );

  const actorInputColumns = [
    {
      title: '阵营',
      render: (_: unknown, record: ActorInputRow) => <Typography.Text className="wasm-code-token">{record.actorId}</Typography.Text>
    },
    {
      title: '英雄',
      render: (_: unknown, record: ActorInputRow) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{record.heroName}</Typography.Text>
          <Typography.Text type="secondary" className="wasm-code-token">
            {record.heroId}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: '等级',
      render: (_: unknown, record: ActorInputRow) => String(record.level)
    },
    {
      title: '装备',
      render: (_: unknown, record: ActorInputRow) => record.itemText
    },
    {
      title: '修正',
      render: (_: unknown, record: ActorInputRow) => renderLines(formatAttributeModifiers(record))
    },
    {
      title: '最大生命',
      render: (_: unknown, record: ActorInputRow) => formatNumber(record.maxHp)
    },
    {
      title: '属性数',
      render: (_: unknown, record: ActorInputRow) => String(record.attrCount)
    },
    {
      title: '动作数',
      render: (_: unknown, record: ActorInputRow) => String(record.actionCount)
    }
  ];

  const skillColumns = (side: 'self' | 'enemy') => [
    {
      title: '技能',
      render: (_: unknown, record: SkillOptionRow) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{record.label}</Typography.Text>
          <Typography.Text type="secondary" className="wasm-code-token">
            {record.skillId}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: '来源',
      render: (_: unknown, record: SkillOptionRow) => (
        <Tag color={record.sourceKind === 'hero' ? 'arcoblue' : 'gold'}>
          {record.sourceKind === 'hero' ? '英雄' : '装备'}:{record.sourceLabel}
        </Tag>
      )
    },
    {
      title: '等级',
      render: (_: unknown, record: SkillOptionRow) =>
        record.editableLevel ? (
          <InputNumber
            min={1}
            max={record.maxLevel}
            value={record.level}
            onChange={(value) => updateSkillLevel(side, record.skillId, value, record.maxLevel)}
            style={{ width: '100%' }}
          />
        ) : (
          <Tag>{record.level}</Tag>
        )
    }
  ];

  const actorColumns = [
    {
      title: 'actorId',
      render: (_: unknown, record: ActorRow) => <Typography.Text className="wasm-code-token">{record.actorId}</Typography.Text>
    },
    {
      title: 'HP',
      render: (_: unknown, record: ActorRow) => `${formatNumber(record.currentHp)} / ${formatNumber(record.maxHp)}`
    },
    {
      title: '护盾',
      render: (_: unknown, record: ActorRow) => formatNumber(record.shieldAmount)
    },
    {
      title: '属性数',
      render: (_: unknown, record: ActorRow) => String(record.attributeCount)
    },
    {
      title: '资源数',
      render: (_: unknown, record: ActorRow) => String(record.resourceCount)
    }
  ];

  const attributeColumns = [
    {
      title: '角色',
      render: (_: unknown, record: AttributeRow) => <Typography.Text className="wasm-code-token">{record.actorId}</Typography.Text>
    },
    {
      title: '属性',
      render: (_: unknown, record: AttributeRow) => <Typography.Text className="wasm-code-token">{record.attrId}</Typography.Text>
    },
    {
      title: '基础',
      render: (_: unknown, record: AttributeRow) => formatNumber(record.base)
    },
    {
      title: '当前',
      render: (_: unknown, record: AttributeRow) => formatNumber(record.current)
    },
    {
      title: '上限',
      render: (_: unknown, record: AttributeRow) => formatNumber(record.max)
    },
    {
      title: '解析值',
      render: (_: unknown, record: AttributeRow) => formatNumber(record.resolved)
    },
    {
      title: '人工',
      render: (_: unknown, record: AttributeRow) => formatNumber(record.baseline)
    },
    {
      title: '差异',
      render: (_: unknown, record: AttributeRow) => renderDiffTag(record.diff)
    }
  ];

  void actorColumns;
  void attributeColumns;

  const actorHudColumns = [
    {
      title: <span className="wasm-hud-col-title">actorId</span>,
      render: (_: unknown, record: ActorRow) => (
        <Typography.Text className="wasm-code-token wasm-hud-label">{record.actorId}</Typography.Text>
      )
    },
    {
      title: <span className="wasm-hud-col-title">HP</span>,
      align: 'right' as const,
      render: (_: unknown, record: ActorRow) => (
        <span className="wasm-hud-value wasm-hud-value--gold">
          {formatNumber(record.currentHp)} / {formatNumber(record.maxHp)}
        </span>
      )
    },
    {
      title: <span className="wasm-hud-col-title">Shield</span>,
      align: 'right' as const,
      render: (_: unknown, record: ActorRow) => <span className="wasm-hud-value">{formatNumber(record.shieldAmount)}</span>
    },
    {
      title: <span className="wasm-hud-col-title">Attributes</span>,
      align: 'right' as const,
      render: (_: unknown, record: ActorRow) => <span className="wasm-hud-value">{record.attributeCount}</span>
    },
    {
      title: <span className="wasm-hud-col-title">Resources</span>,
      align: 'right' as const,
      render: (_: unknown, record: ActorRow) => <span className="wasm-hud-value">{record.resourceCount}</span>
    }
  ];

  const attributeHudColumns = [
    {
      title: <span className="wasm-hud-col-title">Actor</span>,
      render: (_: unknown, record: AttributeRow) => (
        <Typography.Text className="wasm-code-token wasm-hud-label">{record.actorId}</Typography.Text>
      )
    },
    {
      title: <span className="wasm-hud-col-title">Attribute</span>,
      render: (_: unknown, record: AttributeRow) => {
        const displayName = resolveAttributeDisplayName(record.attrId);
        const showId = displayName !== record.attrId;
        return (
          <span className="wasm-attr-cell">
            <ResourceImageThumb
              src={resolveAttributeImageSrc(record.attrId)}
              alt={displayName}
              size={20}
              emptyLabel=""
            />
            <span className="wasm-attr-copy">
              <Typography.Text className="wasm-hud-label">{displayName}</Typography.Text>
              {showId ? <Typography.Text className="wasm-code-token wasm-hud-sub-label">{record.attrId}</Typography.Text> : null}
            </span>
          </span>
        );
      }
    },
    {
      title: <span className="wasm-hud-col-title">Base</span>,
      align: 'right' as const,
      render: (_: unknown, record: AttributeRow) => <span className="wasm-hud-value">{formatNumber(record.base)}</span>
    },
    {
      title: <span className="wasm-hud-col-title">Current</span>,
      align: 'right' as const,
      render: (_: unknown, record: AttributeRow) => <span className="wasm-hud-value">{formatNumber(record.current)}</span>
    },
    {
      title: <span className="wasm-hud-col-title">Max</span>,
      align: 'right' as const,
      render: (_: unknown, record: AttributeRow) => <span className="wasm-hud-value">{formatNumber(record.max)}</span>
    },
    {
      title: <span className="wasm-hud-col-title">Resolved</span>,
      align: 'right' as const,
      render: (_: unknown, record: AttributeRow) => (
        <span className="wasm-hud-value wasm-hud-value--gold">{formatNumber(record.resolved)}</span>
      )
    },
    {
      title: <span className="wasm-hud-col-title">Manual</span>,
      align: 'right' as const,
      render: (_: unknown, record: AttributeRow) => <span className="wasm-hud-value">{formatNumber(record.baseline)}</span>
    },
    {
      title: <span className="wasm-hud-col-title">Diff</span>,
      align: 'right' as const,
      render: (_: unknown, record: AttributeRow) => renderDiffTag(record.diff)
    }
  ];
  const actorHudColumnsBySide = actorHudColumns.slice(1);
  const attributeHudColumnsBySide = attributeHudColumns.slice(1);

  const actionColumns = [
    {
      title: '动作',
      render: (_: unknown, record: ActionRow) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{record.label || record.actionId}</Typography.Text>
          <Typography.Text type="secondary" className="wasm-code-token">
            {record.actionId}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: '输入',
      render: (_: unknown, record: ActionRow) => {
        const inputs = Object.entries(record.panelInputs ?? {}).map(([key, value]) => `${key}=${formatNumber(value)}`);
        return renderLines([`skillLevel=${formatNumber(record.skillLevel ?? 1, 0)}`, ...inputs]);
      }
    },
    {
      title: '冷却',
      render: (_: unknown, record: ActionRow) => {
        const formula = record.cooldownFormulaId ? ` (${record.cooldownFormulaId})` : '';
        const breakdown = formatBreakdown(record.cooldownBreakdown);
        return renderLines([
          `${formatNumber(record.cooldownMs, 0)} / ${formatNumber(record.readyAtMs, 0)} ms${formula}`,
          ...(breakdown ? [breakdown] : [])
        ]);
      }
    },
    {
      title: '释放',
      render: (_: unknown, record: ActionRow) =>
        record.canCast ? <Tag color="green">可释放</Tag> : <Tag color="red">{record.blockedReason || '受阻'}</Tag>
    },
    {
      title: '消耗',
      render: (_: unknown, record: ActionRow) => renderLines(formatActionCosts(record.resourceCosts))
    },
    {
      title: '效果',
      render: (_: unknown, record: ActionRow) => renderLines(formatActionEffects(record.effectRows))
    },
    {
      title: '差异',
      render: (_: unknown, record: ActionRow) => renderActionDiffTag(record.baselineState)
    }
  ];

  const actionEvidenceColumns = [
    {
      title: 'actor',
      dataIndex: 'actorId'
    },
    {
      title: 'action',
      dataIndex: 'actionId'
    },
    {
      title: 'field',
      dataIndex: 'field'
    },
    {
      title: 'wasmValue',
      dataIndex: 'wasmValue'
    },
    {
      title: 'evidenceRef',
      dataIndex: 'evidenceRef'
    },
    {
      title: 'note',
      dataIndex: 'note'
    }
  ];

  const heroOptions = bundle?.heroes ?? [];
  const itemOptions = bundle?.items ?? [];
  const attributeOptions = bundle?.attributeDefinitions ?? [];
  const canRun = bundleStatus === 'success' && Boolean(inputPreview.value) && status !== 'loading';
  const versionHint = currentVersion
    ? `${currentVersion.versionCode} / 缓存 ${cacheStatus ?? 'n/a'}`
    : selectedGameId ?? '未选游戏';

  return (
    <div className="wasm-validation-page page-stack">
      <section className="sim-page-header">
        <Space align="center" size={10} wrap>
          <Tag color="arcoblue">TinyGo V2</Tag>
          <Typography.Text className="workspace-rail">Wasm 验证 M2 / {selectedGameName}</Typography.Text>
        </Space>
        <Typography.Title heading={3} style={{ marginTop: 4, marginBottom: 8 }}>
          M2 动作初始状态快照验证
        </Typography.Title>
      </section>

      <Row gutter={[16, 16]} className="wasm-validation-metrics">
        <Col xs={24} sm={12} lg={6}>
          <MetricCard label="发布包" value={selectedGameId ? formatLoadState(bundleStatus) : '未选游戏'} hint={versionHint} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <MetricCard label="Wasm" value={formatLoadState(status)} hint={WASM_ASSET_LABEL} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            label="就绪"
            value={readyPayload ? `${readyPayload.actorCount} 角色` : '--'}
            hint={readyPayload ? `${readyPayload.actionCount} 动作 / ${readyPayload.formulaCount} 公式` : '等待中'}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            label="差异"
            value={`M1 ${diffRows.length}/${matchedRows.length || 0} | M2 ${diffActionRows.length}/${matchedActionRows.length || 0}`}
            hint={durationMs === null ? '未测量' : `${durationMs} ms`}
          />
        </Col>
      </Row>

      {bundleError ? <Alert type="error" content={bundleError} /> : null}
      {errorMessage ? <Alert type="error" content={errorMessage} /> : null}
      {inputPreview.error ? <Alert type="warning" content={`Bundle 输入: ${inputPreview.error}`} /> : null}
      {baselineError ? <Alert type="warning" content={`M1 基线 JSON: ${baselineError}`} /> : null}
      {actionBaselineError ? <Alert type="warning" content={`M2 基线 JSON: ${actionBaselineError}`} /> : null}

      <Panel
        title="发布包选择"
        kicker="已发布 Bundle"
        actions={
          <Space wrap>
            <Button icon={<IconRefresh />} loading={bundleStatus === 'loading'} onClick={() => setManualRefreshSeed((value) => value + 1)}>
              刷新发布包
            </Button>
            <Button disabled={!bundle} onClick={applyAbilityHasteCase}>
              M2 AH +20
            </Button>
            <Button type="primary" icon={<IconRefresh />} loading={status === 'loading'} disabled={!canRun} onClick={() => void runSnapshot()}>
              运行快照
            </Button>
          </Space>
        }
      >
        {!selectedGameId ? <EmptyState title="还没有选择游戏" description="先在左侧会话中选择一个 gameId，再加载已发布 bundle。" /> : null}
        {selectedGameId && bundleStatus === 'loading' ? <Alert type="info" content="正在加载当前已发布 bundle。" /> : null}
        {bundle && selection ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={[16, 16]} className="wasm-selection-grid">
              <Col xs={24} lg={8}>
                <section className="wasm-selector-pane">
                  <Typography.Title heading={5}>己方角色</Typography.Title>
                  <Form layout="vertical">
                    <Form.Item label="英雄">
                      <Select
                        value={selection.selfHeroId}
                        showSearch
                        disabled={heroOptions.length === 0}
                        onChange={(value) => updateSelection({ selfHeroId: String(value ?? '') })}
                      >
                        {heroOptions.map((hero) => (
                          <Select.Option key={hero.heroId} value={hero.heroId}>
                            {hero.heroId} / {hero.name ?? hero.heroId}
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                    <Form.Item label="等级">
                      <InputNumber
                        min={1}
                        max={maxLevel}
                        value={selection.selfLevel}
                        onChange={(value) => updateSelection({ selfLevel: clampLevelInput(value, maxLevel) })}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                    <Form.Item label="装备">
                      <Select
                        mode="multiple"
                        value={selection.selfItemIds}
                        showSearch
                        allowClear
                        maxTagCount={3}
                        disabled={itemOptions.length === 0}
                        onChange={(value) => updateSelection({ selfItemIds: toStringArray(value) })}
                      >
                        {itemOptions.map((item) => (
                          <Select.Option key={item.itemId} value={item.itemId}>
                            {item.itemId} / {item.name ?? item.itemId}
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                    <Form.Item label="技能急速修正">
                      <InputNumber
                        min={0}
                        value={selection.selfAttributeBonuses?.[ABILITY_HASTE_ATTR_KEY] ?? 0}
                        onChange={(value) => updateAttributeBonus('self', ABILITY_HASTE_ATTR_KEY, value)}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </Form>
                </section>
              </Col>

              <Col xs={24} lg={8}>
                <section className="wasm-selector-pane">
                  <Typography.Title heading={5}>敌方角色</Typography.Title>
                  <Form layout="vertical">
                    <Form.Item label="英雄">
                      <Select
                        value={selection.enemyHeroId}
                        showSearch
                        disabled={heroOptions.length === 0}
                        onChange={(value) => updateSelection({ enemyHeroId: String(value ?? '') })}
                      >
                        {heroOptions.map((hero) => (
                          <Select.Option key={hero.heroId} value={hero.heroId}>
                            {hero.heroId} / {hero.name ?? hero.heroId}
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                    <Form.Item label="等级">
                      <InputNumber
                        min={1}
                        max={maxLevel}
                        value={selection.enemyLevel}
                        onChange={(value) => updateSelection({ enemyLevel: clampLevelInput(value, maxLevel) })}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                    <Form.Item label="装备">
                      <Select
                        mode="multiple"
                        value={selection.enemyItemIds}
                        showSearch
                        allowClear
                        maxTagCount={3}
                        disabled={itemOptions.length === 0}
                        onChange={(value) => updateSelection({ enemyItemIds: toStringArray(value) })}
                      >
                        {itemOptions.map((item) => (
                          <Select.Option key={item.itemId} value={item.itemId}>
                            {item.itemId} / {item.name ?? item.itemId}
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                  </Form>
                </section>
              </Col>

              <Col xs={24} lg={8}>
                <section className="wasm-selector-pane">
                  <Typography.Title heading={5}>输入口径</Typography.Title>
                  <Form layout="vertical">
                    <Form.Item label="HP 属性">
                      <Select
                        value={selection.hpAttrKey}
                        showSearch
                        disabled={attributeOptions.length === 0}
                        onChange={(value) => updateSelection({ hpAttrKey: String(value ?? '') })}
                      >
                        {attributeOptions.map((definition) => (
                          <Select.Option key={definition.attrKey} value={definition.attrKey}>
                            {definition.attrKey} / {definition.attrName ?? definition.attrKey}
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                    <Form.Item label="等级上限">
                      <InputNumber value={maxLevel} disabled style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item label="发布包概览">
                      <Space wrap>
                        <Tag>{heroOptions.length} 英雄</Tag>
                        <Tag>{itemOptions.length} 装备</Tag>
                        <Tag>{attributeOptions.length} 属性</Tag>
                      </Space>
                    </Form.Item>
                  </Form>
                </section>
              </Col>
            </Row>

            <Row gutter={[16, 16]}>
              <Col xs={24} lg={12}>
                <Card size="small" title="己方技能等级">
                  <Table
                    className="data-table-shell"
                    columns={skillColumns('self')}
                    data={selfSkills}
                    pagination={false}
                    rowKey="key"
                    size="small"
                    scroll={{ x: '100%' }}
                  />
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card size="small" title="敌方技能等级">
                  <Table
                    className="data-table-shell"
                    columns={skillColumns('enemy')}
                    data={enemySkills}
                    pagination={false}
                    rowKey="key"
                    size="small"
                    scroll={{ x: '100%' }}
                  />
                </Card>
              </Col>
            </Row>

            <Table
              className="data-table-shell"
              columns={actorInputColumns}
              data={actorInputRows}
              pagination={false}
              rowKey="key"
              size="small"
              scroll={{ x: '100%' }}
            />
          </Space>
        ) : null}
      </Panel>

      <Panel
        title="初始属性快照"
        kicker="M1 快照"
        actions={
          <Button icon={<IconCopy />} onClick={() => void handleCopySnapshot()} disabled={!snapshotPayload}>
            复制快照
          </Button>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {snapshotPayload ? null : <EmptyState title="还没有运行结果" description="先运行一次 Wasm 快照，再查看当前角色的初始属性。" />}
          <Row gutter={[16, 16]} className="wasm-side-grid">
            <Col xs={24} xl={12}>
              <section className="wasm-side-panel">
                <div className="wasm-side-header">
                  <Typography.Text className="wasm-side-title">己方 / {sideActorIds.selfId}</Typography.Text>
                  <Button
                    type="text"
                    size="mini"
                    className="wasm-side-toggle"
                    onClick={() => toggleAttributeSide('self')}
                  >
                    {collapsedAttributeSides.self ? '展开属性' : '收起属性'}
                  </Button>
                </div>
                <Table
                  className="data-table-shell wasm-hud-table wasm-hud-table--actors"
                  columns={actorHudColumnsBySide}
                  data={selfActorRows}
                  pagination={false}
                  rowKey="key"
                  size="small"
                  scroll={{ x: '100%' }}
                />
                {collapsedAttributeSides.self ? null : (
                  <Table
                    className="data-table-shell wasm-hud-table wasm-hud-table--attributes"
                    columns={attributeHudColumnsBySide}
                    data={selfAttributeRows}
                    pagination={false}
                    rowKey="key"
                    size="small"
                    scroll={{ x: '100%' }}
                  />
                )}
              </section>
            </Col>
            <Col xs={24} xl={12}>
              <section className="wasm-side-panel">
                <div className="wasm-side-header">
                  <Typography.Text className="wasm-side-title">敌方 / {sideActorIds.enemyId}</Typography.Text>
                  <Button
                    type="text"
                    size="mini"
                    className="wasm-side-toggle"
                    onClick={() => toggleAttributeSide('enemy')}
                  >
                    {collapsedAttributeSides.enemy ? '展开属性' : '收起属性'}
                  </Button>
                </div>
                <Table
                  className="data-table-shell wasm-hud-table wasm-hud-table--actors"
                  columns={actorHudColumnsBySide}
                  data={enemyActorRows}
                  pagination={false}
                  rowKey="key"
                  size="small"
                  scroll={{ x: '100%' }}
                />
                {collapsedAttributeSides.enemy ? null : (
                  <Table
                    className="data-table-shell wasm-hud-table wasm-hud-table--attributes"
                    columns={attributeHudColumnsBySide}
                    data={enemyAttributeRows}
                    pagination={false}
                    rowKey="key"
                    size="small"
                    scroll={{ x: '100%' }}
                  />
                )}
              </section>
            </Col>
          </Row>
        </Space>
      </Panel>

      <Panel
        title="动作初始状态"
        kicker="M2 动作快照"
        actions={
          <Button icon={<IconCopy />} onClick={() => void handleCopyActionSnapshot()} disabled={!actionSnapshotPayload}>
            复制动作快照
          </Button>
        }
      >
        {actionSnapshotPayload ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={[16, 16]}>
              {actionSnapshotPayload.actors.map((actor) => (
                <Col key={actor.actorId} xs={24} lg={12}>
                  <Card size="small" title={`${actor.actorId} / ${actor.actions.length} actions`}>
                    <Table
                      className="data-table-shell"
                      columns={actionColumns}
                      data={actionRows.filter((row) => row.actorId === actor.actorId)}
                      pagination={false}
                      rowKey="key"
                      size="small"
                      scroll={{ x: '100%' }}
                    />
                  </Card>
                </Col>
              ))}
            </Row>
            <Table
              className="data-table-shell"
              columns={actionEvidenceColumns}
              data={actionEvidenceRows}
              pagination={false}
              rowKey="key"
              size="small"
              scroll={{ x: '100%' }}
            />
          </Space>
        ) : (
          <EmptyState title="还没有动作快照" description="运行一次快照后，这里会展示 self/enemy 当前 run 的全部动作初始状态。" />
        )}
      </Panel>

      <Row gutter={[16, 16]} className="wasm-validation-grid">
        <Col xs={24} lg={8}>
          <Panel title="人工基线" kicker="人工对照">
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <section>
                <Typography.Title heading={6} style={{ marginTop: 0 }}>
                  M1 属性基线
                </Typography.Title>
                <TextArea
                  className="baseline-textarea"
                  value={baselineText}
                  onChange={setBaselineText}
                  placeholder="粘贴 M1 actor snapshot JSON"
                  autoSize={{ minRows: 8, maxRows: 14 }}
                />
              </section>

              <section>
                <Typography.Title heading={6} style={{ marginTop: 0 }}>
                  M2 动作基线
                </Typography.Title>
                <TextArea
                  className="baseline-textarea"
                  value={actionBaselineText}
                  onChange={setActionBaselineText}
                  placeholder="粘贴 M2 action snapshot JSON"
                  autoSize={{ minRows: 8, maxRows: 14 }}
                />
              </section>

              <Button
                onClick={() => {
                  setBaselineText('');
                  setActionBaselineText('');
                }}
              >
                清空
              </Button>
            </Space>
          </Panel>
        </Col>

        <Col xs={24} lg={16}>
          <Panel title="Wasm 输入与输出" kicker="ABI 跟踪">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {inputPreview.value ? (
                <>
                  <Card size="small" title="EngineBundleV2">
                    <JsonBlock value={inputPreview.value.engineBundle} />
                  </Card>
                  <Card size="small" title="EngineRunInputV2">
                    <JsonBlock value={inputPreview.value.runInput} />
                  </Card>
                </>
              ) : (
                <EmptyState title="还没有可用输入" description="发布 bundle 加载完成后，这里会显示当前选择组装出的 Wasm 输入。" />
              )}

              {frames.map((frame) => (
                <Card
                  key={frame.key}
                  size="small"
                  title={
                    <Space size={8}>
                      <Tag color={frame.kind === SNAPSHOT_FRAME_KIND || frame.kind === ACTION_SNAPSHOT_FRAME_KIND ? 'green' : 'arcoblue'}>
                        {frame.kindLabel}
                      </Tag>
                      <Typography.Text type="secondary">kind={frame.kind}</Typography.Text>
                    </Space>
                  }
                >
                  <JsonBlock value={frame.payload} />
                </Card>
              ))}
            </Space>
          </Panel>
        </Col>
      </Row>
    </div>
  );
}
