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
  type ActorInputSummary,
  type TinyGoV2ValidationInput,
  type WasmValidationSelection
} from '../engine/tinygoV2BundleAdapter';
import { TinyGoV2Bridge, decodeFramePayload, type TinyGoV2Frame } from '../engine/tinygoV2Bridge';
import { getErrorMessage } from '../services/apiClient';
import { useResourceImageCache } from './admin/resources/shared/useResourceImageCache';
import { loadPublishedBundleSnapshot } from '../services/bundleSnapshot';
import { buildAttributeImageUri } from '../services/resourceImage';
import type { CurrentVersion, GameDataBundle, LoadState } from '../types/api';

type WasmValidationPageProps = {
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

type ManualBaseline = Record<string, unknown>;

const { Row, Col } = Grid;
const { TextArea } = Input;

const TINYGO_V2_WASM_URL = new URL('../engine/wasm/tinygo_engine_v2.wasm', import.meta.url);
const WASM_ASSET_LABEL = 'src/engine/wasm/tinygo_engine_v2.wasm';
const SNAPSHOT_FRAME_KIND = 16;

const FRAME_KIND_LABELS: Record<number, string> = {
  10: 'tick',
  11: 'log',
  12: 'sample',
  13: 'done',
  14: 'error',
  15: 'ready',
  16: 'snapshot'
};

function formatNumber(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function formatLoadState(status: LoadState): string {
  if (status === 'loading') {
    return 'Loading';
  }
  if (status === 'success') {
    return 'Ready';
  }
  if (status === 'error') {
    return 'Error';
  }
  return 'Idle';
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
      return { baseline: null, error: '人工基线必须是 JSON object。' };
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

function renderDiffTag(diff: number | null) {
  if (diff === null) {
    return (
      <Tag className="wasm-hud-diff-tag" color="gray">
        --
      </Tag>
    );
  }
  if (Math.abs(diff) < 0.0001) {
    return (
      <Tag className="wasm-hud-diff-tag" color="green">
        0
      </Tag>
    );
  }
  return (
    <Tag className="wasm-hud-diff-tag" color="red">
      {formatNumber(diff)}
    </Tag>
  );
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

export function WasmValidationPage({
  apiBaseUrl,
  selectedGameId,
  selectedGameName,
  externalRefreshSeed
}: WasmValidationPageProps) {
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
        setSelection(createDefaultWasmValidationSelection(snapshot.bundle));
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

  const { baseline, error: baselineError } = useMemo(() => parseBaseline(baselineText), [baselineText]);
  const readyPayload = useMemo(() => getPayload<ReadyPayload>(frames, 15), [frames]);
  const snapshotPayload = useMemo(() => getPayload<InitialSnapshotPayload>(frames, SNAPSHOT_FRAME_KIND), [frames]);
  const actorRows = useMemo(() => buildActorRows(snapshotPayload), [snapshotPayload]);
  const attributeRows = useMemo(() => buildAttributeRows(snapshotPayload, baseline), [snapshotPayload, baseline]);
  const actorInputRows = useMemo(() => buildActorInputRows(inputPreview.value), [inputPreview.value]);
  const matchedRows = attributeRows.filter((row) => row.baseline !== null);
  const diffRows = matchedRows.filter((row) => row.diff !== null && Math.abs(row.diff) >= 0.0001);
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

  const runSnapshot = useCallback(async () => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setStatus('loading');
    setErrorMessage(null);
    setDurationMs(null);

    try {
      if (!inputPreview.value) {
        throw new Error(inputPreview.error ?? 'Bundle 输入还没有准备好。');
      }

      const startedAt = performance.now();
      const bridge = await TinyGoV2Bridge.create({ wasmUrl: TINYGO_V2_WASM_URL });
      const initFrames = decodeFrames(bridge.init(inputPreview.value.engineBundle), 'init');
      const snapshotFrames = decodeFrames(bridge.snapshotInitial(inputPreview.value.runInput), 'snapshot');
      const completedAt = performance.now();
      if (runIdRef.current !== runId) {
        return;
      }
      setFrames([...initFrames, ...snapshotFrames]);
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
      title: <span className="wasm-hud-col-title">Side</span>,
      render: (_: unknown, record: ActorInputRow) => (
        <Typography.Text className="wasm-code-token wasm-hud-label">{record.actorId}</Typography.Text>
      )
    },
    {
      title: <span className="wasm-hud-col-title">Hero</span>,
      render: (_: unknown, record: ActorInputRow) => (
        <Space direction="vertical" size={0}>
          <Typography.Text className="wasm-hud-label">{record.heroName}</Typography.Text>
          <Typography.Text type="secondary" className="wasm-code-token wasm-hud-sub-label">
            {record.heroId}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: <span className="wasm-hud-col-title">Level</span>,
      align: 'right' as const,
      render: (_: unknown, record: ActorInputRow) => <span className="wasm-hud-value">{record.level}</span>
    },
    {
      title: <span className="wasm-hud-col-title">Items</span>,
      render: (_: unknown, record: ActorInputRow) => <span className="wasm-hud-label">{record.itemText}</span>
    },
    {
      title: <span className="wasm-hud-col-title">Max HP</span>,
      align: 'right' as const,
      render: (_: unknown, record: ActorInputRow) => (
        <span className="wasm-hud-value wasm-hud-value--gold">{formatNumber(record.maxHp)}</span>
      )
    },
    {
      title: <span className="wasm-hud-col-title">Attrs</span>,
      align: 'right' as const,
      render: (_: unknown, record: ActorInputRow) => <span className="wasm-hud-value">{record.attrCount}</span>
    }
  ];

  const actorColumns = [
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

  const attributeColumns = [
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
  const actorColumnsBySide = actorColumns.slice(1);
  const attributeColumnsBySide = attributeColumns.slice(1);

  const heroOptions = bundle?.heroes ?? [];
  const itemOptions = bundle?.items ?? [];
  const attributeOptions = bundle?.attributeDefinitions ?? [];
  const canRun = bundleStatus === 'success' && Boolean(inputPreview.value) && status !== 'loading';
  const versionHint = currentVersion
    ? `${currentVersion.versionCode} / cache ${cacheStatus ?? 'n/a'}`
    : selectedGameId ?? 'no game';

  return (
    <div className="wasm-validation-page page-stack">
      <section className="sim-page-header">
        <Space align="center" size={10} wrap>
          <Tag color="arcoblue">TinyGo V2</Tag>
          <Typography.Text className="workspace-rail">Wasm validation / {selectedGameName}</Typography.Text>
        </Space>
        <Typography.Title heading={3} style={{ marginTop: 4, marginBottom: 8 }}>
          M1 Actor 初始属性对齐
        </Typography.Title>
      </section>

      <Row gutter={[16, 16]} className="wasm-validation-metrics">
        <Col xs={24} sm={12} lg={6}>
          <MetricCard label="Bundle" value={selectedGameId ? formatLoadState(bundleStatus) : 'No game'} hint={versionHint} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <MetricCard label="Wasm" value={formatLoadState(status)} hint={WASM_ASSET_LABEL} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            label="Ready"
            value={readyPayload ? `${readyPayload.actorCount} actors` : '--'}
            hint={readyPayload ? `${readyPayload.actionCount} actions / ${readyPayload.formulaCount} formulas` : 'waiting'}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            label="Diff"
            value={matchedRows.length > 0 ? `${diffRows.length}/${matchedRows.length}` : '--'}
            hint={durationMs === null ? 'not measured' : `${durationMs} ms`}
          />
        </Col>
      </Row>

      {bundleError ? <Alert type="error" content={bundleError} /> : null}
      {errorMessage ? <Alert type="error" content={errorMessage} /> : null}
      {inputPreview.error ? <Alert type="warning" content={`Bundle 输入: ${inputPreview.error}`} /> : null}
      {baselineError ? <Alert type="warning" content={`人工基线 JSON: ${baselineError}`} /> : null}

      <Panel
        title="Bundle 选择"
        kicker="Published Bundle"
        actions={
          <Space wrap>
            <Button icon={<IconRefresh />} loading={bundleStatus === 'loading'} onClick={() => setManualRefreshSeed((value) => value + 1)}>
              刷新 bundle
            </Button>
            <Button type="primary" icon={<IconRefresh />} loading={status === 'loading'} disabled={!canRun} onClick={() => void runSnapshot()}>
              运行快照
            </Button>
          </Space>
        }
      >
        {!selectedGameId ? <EmptyState title="还没有选择游戏" description="先在左侧会话中选择一个 gameId，再加载发布 bundle。" /> : null}
        {selectedGameId && bundleStatus === 'loading' ? <Alert type="info" content="正在加载当前发布 bundle。" /> : null}
        {bundle && selection ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={[16, 16]} className="wasm-selection-grid">
              <Col xs={24} lg={8}>
                <section className="wasm-selector-pane">
                  <Typography.Title heading={5}>己方 Actor</Typography.Title>
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
                  </Form>
                </section>
              </Col>

              <Col xs={24} lg={8}>
                <section className="wasm-selector-pane">
                  <Typography.Title heading={5}>敌方 Actor</Typography.Title>
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
                    <Form.Item label="Bundle 实体">
                      <Space wrap>
                        <Tag>{heroOptions.length} heroes</Tag>
                        <Tag>{itemOptions.length} items</Tag>
                        <Tag>{attributeOptions.length} attrs</Tag>
                      </Space>
                    </Form.Item>
                  </Form>
                </section>
              </Col>
            </Row>

            <Table
              className="data-table-shell wasm-hud-table wasm-hud-table--input"
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
        title="初始化快照"
        kicker="M1 Snapshot"
        actions={
          <Space wrap>
            <Button icon={<IconCopy />} onClick={() => void handleCopySnapshot()} disabled={!snapshotPayload}>
              复制快照
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {snapshotPayload ? null : <EmptyState title="还没有运行结果" description="选择人物和装备后运行一次 Wasm 快照。" />}
          <Row gutter={[16, 16]} className="wasm-side-grid">
            <Col xs={24} xl={12}>
              <section className="wasm-side-panel">
                <Typography.Text className="wasm-side-title">己方 / {sideActorIds.selfId}</Typography.Text>
                <Table
                  className="data-table-shell wasm-hud-table wasm-hud-table--actors"
                  columns={actorColumnsBySide}
                  data={selfActorRows}
                  pagination={false}
                  rowKey="key"
                  size="small"
                  scroll={{ x: '100%' }}
                />
                <Table
                  className="data-table-shell wasm-hud-table wasm-hud-table--attributes"
                  columns={attributeColumnsBySide}
                  data={selfAttributeRows}
                  pagination={false}
                  rowKey="key"
                  size="small"
                  scroll={{ x: '100%' }}
                />
              </section>
            </Col>
            <Col xs={24} xl={12}>
              <section className="wasm-side-panel">
                <Typography.Text className="wasm-side-title">敌方 / {sideActorIds.enemyId}</Typography.Text>
                <Table
                  className="data-table-shell wasm-hud-table wasm-hud-table--actors"
                  columns={actorColumnsBySide}
                  data={enemyActorRows}
                  pagination={false}
                  rowKey="key"
                  size="small"
                  scroll={{ x: '100%' }}
                />
                <Table
                  className="data-table-shell wasm-hud-table wasm-hud-table--attributes"
                  columns={attributeColumnsBySide}
                  data={enemyAttributeRows}
                  pagination={false}
                  rowKey="key"
                  size="small"
                  scroll={{ x: '100%' }}
                />
              </section>
            </Col>
          </Row>
        </Space>
      </Panel>

      <Row gutter={[16, 16]} className="wasm-validation-grid">
        <Col xs={24} lg={8}>
          <Panel title="人工基线" kicker="Manual Baseline">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <TextArea
                className="baseline-textarea"
                value={baselineText}
                onChange={setBaselineText}
                placeholder="粘贴人工基线 JSON"
                autoSize={{ minRows: 12, maxRows: 18 }}
              />
              <Button onClick={() => setBaselineText('')}>清空</Button>
            </Space>
          </Panel>
        </Col>

        <Col xs={24} lg={16}>
          <Panel title="Wasm 输入与输出" kicker="ABI Trace">
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
                <EmptyState title="还没有可用输入" description="发布 bundle 加载完成后会显示当前选择组装出的 Wasm 输入。" />
              )}

              {frames.map((frame) => (
                <Card
                  key={frame.key}
                  size="small"
                  title={
                    <Space size={8}>
                      <Tag color={frame.kind === SNAPSHOT_FRAME_KIND ? 'green' : 'arcoblue'}>{frame.kindLabel}</Tag>
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
