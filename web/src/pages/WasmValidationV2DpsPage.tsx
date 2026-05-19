import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Alert, Button, Form, Grid, Input, InputNumber, Select, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { IconCopy, IconDelete, IconPlayArrow, IconPlus, IconRefresh } from '@arco-design/web-react/icon';
import { EmptyState } from '../components/EmptyState';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import {
  createDefaultV2DpsCurveSelections,
  createDefaultV2DpsSelection,
  createV2DpsCurveSelection,
  getDefaultV2DpsPassiveIdsForHero,
  getDefaultV2DpsScenarioIdsForHero,
  listV2DpsAttackers,
  listV2DpsEquipmentOptions,
  listV2DpsPassiveOptionsForHero,
  listV2DpsScenarioOptionsForHero,
  listV2DpsTargetGroups,
  prepareV2DpsInput,
  V2_DPS_CASE_ID,
  type V2DpsCurveResult,
  type V2DpsCurveSelection,
  type V2DpsOutput,
  type V2DpsPreparedInput,
  type V2DpsSelection
} from '../engine/tinygoV2DpsAdapter';
import { TinyGoV2Bridge, TinyGoV2InvocationError, decodeFramePayload, type TinyGoV2Frame } from '../engine/tinygoV2Bridge';
import { getErrorMessage } from '../services/apiClient';
import { loadPublishedBundleSnapshot } from '../services/bundleSnapshot';
import type { CurrentVersion, GameDataBundle, LoadState } from '../types/api';

const { Row, Col } = Grid;

const TINYGO_V2_WASM_URL = new URL('../engine/wasm/tinygo_engine_v2.wasm', import.meta.url);
const WASM_ASSET_LABEL = 'src/engine/wasm/tinygo_engine_v2.wasm';
const READY_FRAME_KIND = 15;
const DONE_FRAME_KIND = 13;
const ERROR_FRAME_KIND = 14;
const SKILL_KEYS = ['P', 'Q', 'W', 'E', 'R'] as const;

type WasmValidationV2DpsPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
  externalRefreshSeed: number;
};

type DecodedFrame = {
  stage: string;
  kind: number;
  label: string;
  payload: unknown;
};

type AttackRow = V2DpsCurveResult['attackTimeline'][number] & {
  key: string;
};

type DamageRow = V2DpsCurveResult['damageTimeline'][number] & {
  key: string;
};

type SummaryRow = {
  key: string;
  curveId: string;
  label: string;
  status: string;
  totalDamage: number | null;
  timeWindowDps: number | null;
  killTimeMs: number | null;
  attackCount: number | null;
  damageByType: Record<string, number>;
  damageBySource: Record<string, number>;
  blockedReasons: string[];
};

type ChartMode = 'damage' | 'hp';

const frameKindLabel: Record<number, string> = {
  [READY_FRAME_KIND]: 'ready',
  [DONE_FRAME_KIND]: 'done',
  [ERROR_FRAME_KIND]: 'error'
};

export function WasmValidationV2DpsPage({
  apiBaseUrl,
  selectedGameId,
  selectedGameName,
  externalRefreshSeed
}: WasmValidationV2DpsPageProps) {
  const [bundleStatus, setBundleStatus] = useState<LoadState>('idle');
  const [runStatus, setRunStatus] = useState<LoadState>('idle');
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<GameDataBundle | null>(null);
  const [currentVersion, setCurrentVersion] = useState<CurrentVersion | null>(null);
  const [cacheStatus, setCacheStatus] = useState<'hit' | 'miss' | null>(null);
  const [selection, setSelection] = useState<V2DpsSelection | null>(null);
  const [preparedInput, setPreparedInput] = useState<V2DpsPreparedInput | null>(null);
  const [wasmOutput, setWasmOutput] = useState<V2DpsOutput | null>(null);
  const [decodedFrames, setDecodedFrames] = useState<DecodedFrame[]>([]);
  const [wasmSha256, setWasmSha256] = useState('');
  const [activeCurveId, setActiveCurveId] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>('damage');
  const [runeDraftByCurveId, setRuneDraftByCurveId] = useState<Record<string, string>>({});
  const [expandedCurveIds, setExpandedCurveIds] = useState<string[]>([]);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const chartElementRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  const resetRunArtifacts = useCallback(() => {
    setPreparedInput(null);
    setWasmOutput(null);
    setDecodedFrames([]);
    setRunStatus('idle');
    setRunError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadBundle() {
      if (!selectedGameId) {
        setBundle(null);
        setCurrentVersion(null);
        setSelection(null);
        setBundleStatus('idle');
        setBundleError(null);
        resetRunArtifacts();
        return;
      }

      setBundleStatus('loading');
      setBundleError(null);
      resetRunArtifacts();
      setActiveCurveId(null);

      try {
        const snapshot = await loadPublishedBundleSnapshot(apiBaseUrl, selectedGameId);
        if (cancelled) {
          return;
        }
        const defaultSelection = createDefaultV2DpsSelection(snapshot.bundle);
        setBundle(snapshot.bundle);
        setCurrentVersion(snapshot.currentVersion);
        setCacheStatus(snapshot.cacheStatus);
        setSelection(defaultSelection);
        setRuneDraftByCurveId(createRuneDrafts(defaultSelection.curves));
        setExpandedCurveIds([]);
        setActiveCurveId(defaultSelection.curves[0]?.curveId ?? null);
        setBundleStatus('success');
      } catch (error) {
        if (cancelled) {
          return;
        }
        setBundle(null);
        setCurrentVersion(null);
        setSelection(null);
        setRuneDraftByCurveId({});
        setExpandedCurveIds([]);
        setBundleStatus('error');
        setBundleError(getErrorMessage(error));
      }
    }

    void loadBundle();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, externalRefreshSeed, resetRunArtifacts, selectedGameId]);

  const attackerOptions = useMemo(() => (bundle ? listV2DpsAttackers(bundle) : []), [bundle]);
  const targetGroups = useMemo(() => (bundle ? listV2DpsTargetGroups(bundle) : []), [bundle]);
  const equipmentOptions = useMemo(() => (bundle ? listV2DpsEquipmentOptions(bundle) : []), [bundle]);
  const equipmentLabelById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const option of equipmentOptions) {
      labels.set(option.itemId, stripItemIdPrefix(option.label));
    }
    return labels;
  }, [equipmentOptions]);
  const passiveOptions = useMemo(() => listV2DpsPassiveOptionsForHero(selection?.attackerHeroId ?? ''), [selection?.attackerHeroId]);
  const scenarioOptions = useMemo(() => listV2DpsScenarioOptionsForHero(selection?.attackerHeroId ?? ''), [selection?.attackerHeroId]);
  const curveResults = wasmOutput?.curveResults ?? [];
  const curveLabelById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const curve of preparedInput?.runInput.curves ?? []) {
      labels.set(curve.curveId, curve.label);
    }
    for (const curve of selection?.curves ?? []) {
      if (!labels.has(curve.curveId)) {
        labels.set(curve.curveId, curve.label);
      }
    }
    return labels;
  }, [preparedInput, selection]);
  const activeCurveResult = useMemo(() => {
    if (curveResults.length === 0) {
      return null;
    }
    if (activeCurveId) {
      return curveResults.find((result) => result.curveId === activeCurveId) ?? curveResults[0];
    }
    return curveResults[0];
  }, [activeCurveId, curveResults]);
  const activeCurveConfig = useMemo(() => {
    if (!selection || selection.curves.length === 0) {
      return null;
    }
    if (activeCurveId) {
      return selection.curves.find((curve) => curve.curveId === activeCurveId) ?? selection.curves[0];
    }
    return selection.curves[0];
  }, [activeCurveId, selection]);
  const canRun = Boolean(bundle && currentVersion && selection && selectedGameId && selection.curves.length > 0) && runStatus !== 'loading';

  const attackRows = useMemo<AttackRow[]>(
    () => activeCurveResult?.attackTimeline.map((row, index) => ({ ...row, key: `${index}-${row.timeMs}` })) ?? [],
    [activeCurveResult]
  );
  const damageRows = useMemo<DamageRow[]>(
    () => activeCurveResult?.damageTimeline.map((row, index) => ({ ...row, key: `${index}-${row.timeMs}` })) ?? [],
    [activeCurveResult]
  );
  const summaryRows = useMemo<SummaryRow[]>(
    () => buildSummaryRows(curveResults, curveLabelById),
    [curveLabelById, curveResults]
  );
  const exportPayload = useMemo(() => {
    if (!wasmOutput || !preparedInput) {
      return null;
    }
    return {
      caseId: wasmOutput.caseId,
      versionCode: wasmOutput.versionCode,
      wasmSha256: wasmOutput.wasmSha256,
      activeCurveId: activeCurveResult?.curveId ?? wasmOutput.curveResults[0]?.curveId,
      selection: buildExportSelection(preparedInput),
      resolvedSnapshot: buildExportResolvedSnapshot(preparedInput),
      simulationRules: wasmOutput.simulationRules,
      targetSnapshot: wasmOutput.targetSnapshot,
      runInput: preparedInput.runInput,
      wasmOutput
    };
  }, [activeCurveResult, preparedInput, wasmOutput]);

  useEffect(() => {
    if (!chartElementRef.current) {
      return;
    }
    const chart = chartRef.current ?? echarts.init(chartElementRef.current);
    chartRef.current = chart;
    chart.setOption(buildChartOption(curveResults, curveLabelById, chartMode), true);

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [chartMode, curveLabelById, curveResults]);

  useEffect(() => () => {
    chartRef.current?.dispose();
    chartRef.current = null;
  }, []);

  useEffect(() => {
    setRuneDraftByCurveId((current) => syncRuneDrafts(current, selection?.curves ?? []));
  }, [selection?.curves]);

  useEffect(() => {
    const curveIds = new Set((selection?.curves ?? []).map((curve) => curve.curveId));
    setExpandedCurveIds((current) => current.filter((curveId) => curveIds.has(curveId)));
  }, [selection?.curves]);

  const updateSelection = useCallback((updater: (current: V2DpsSelection) => V2DpsSelection) => {
    setSelection((current) => {
      if (!current) {
        return current;
      }
      const next = updater(current);
      if (next.curves.length > 0 && !next.curves.some((curve) => curve.curveId === activeCurveId)) {
        setActiveCurveId(next.curves[0].curveId);
      }
      return next;
    });
    resetRunArtifacts();
  }, [activeCurveId, resetRunArtifacts]);

  const updateCurve = useCallback((curveId: string, patch: Partial<V2DpsCurveSelection>) => {
    updateSelection((current) => ({
      ...current,
      curves: current.curves.map((curve) => curve.curveId === curveId ? { ...curve, ...patch } : curve)
    }));
  }, [updateSelection]);

  const handleReloadBundle = useCallback(async () => {
    if (!selectedGameId) {
      return;
    }
    setBundleStatus('loading');
    setBundleError(null);
    resetRunArtifacts();
    setActiveCurveId(null);
    try {
      const snapshot = await loadPublishedBundleSnapshot(apiBaseUrl, selectedGameId);
      const defaultSelection = createDefaultV2DpsSelection(snapshot.bundle);
      setBundle(snapshot.bundle);
      setCurrentVersion(snapshot.currentVersion);
      setCacheStatus(snapshot.cacheStatus);
      setSelection(defaultSelection);
      setRuneDraftByCurveId(createRuneDrafts(defaultSelection.curves));
      setExpandedCurveIds([]);
      setActiveCurveId(defaultSelection.curves[0]?.curveId ?? null);
      setBundleStatus('success');
    } catch (error) {
      setBundleStatus('error');
      setBundleError(getErrorMessage(error));
    }
  }, [apiBaseUrl, resetRunArtifacts, selectedGameId]);

  const handleRun = useCallback(async () => {
    if (!bundle || !currentVersion || !selection) {
      return;
    }
    const committedSelection = commitRuneDrafts(selection, runeDraftByCurveId);
    if (committedSelection !== selection) {
      setSelection(committedSelection);
    }
    setRunStatus('loading');
    setRunError(null);
    setWasmOutput(null);
    setPreparedInput(null);
    setDecodedFrames([]);
    let nextDecodedFrames: DecodedFrame[] = [];

    try {
      const nextWasmSha256 = await computeWasmSha256(TINYGO_V2_WASM_URL);
      const prepared = prepareV2DpsInput(bundle, committedSelection, currentVersion.versionCode, nextWasmSha256);
      const bridge = await TinyGoV2Bridge.create({ wasmUrl: TINYGO_V2_WASM_URL });
      const initFrames = decodeFrames(bridge.init(prepared.engineBundle), 'init');
      nextDecodedFrames = [...nextDecodedFrames, ...initFrames];
      const runFrames = decodeFrames(bridge.beginRun(prepared.runInput), 'single_attacker_dps');
      nextDecodedFrames = [...nextDecodedFrames, ...runFrames];
      const donePayload = findDonePayload(runFrames);
      const errorFrame = [...initFrames, ...runFrames].find((frame) => frame.kind === ERROR_FRAME_KIND);

      if (!donePayload) {
        throw new Error(errorFrame ? JSON.stringify(errorFrame.payload) : 'single_attacker_dps did not return a done frame.');
      }

      const nextActiveCurveId = activeCurveId && donePayload.curveResults.some((result) => result.curveId === activeCurveId)
        ? activeCurveId
        : donePayload.curveResults[0]?.curveId ?? null;
      setWasmSha256(nextWasmSha256);
      setPreparedInput(prepared);
      setWasmOutput(donePayload);
      setActiveCurveId(nextActiveCurveId);
      setDecodedFrames(nextDecodedFrames);
      setRunStatus('success');
      window.requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    } catch (error) {
      if (error instanceof TinyGoV2InvocationError) {
        setDecodedFrames([...nextDecodedFrames, ...decodeFrames(error.frames, error.fnName)]);
      }
      setRunStatus('error');
      setRunError(getErrorMessage(error));
    }
  }, [activeCurveId, bundle, currentVersion, runeDraftByCurveId, selection]);

  const handleCopyExport = useCallback(async () => {
    if (!exportPayload || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2));
  }, [exportPayload]);

  const handleAddCurve = useCallback(() => {
    updateSelection((current) => {
      const { curveId, label } = createUniqueCurveIdentity(current.attackerHeroId, current.curves);
      const curve = createV2DpsCurveSelection(
        curveId,
        label,
        [],
        current.attackerHeroId,
        getDefaultV2DpsPassiveIdsForHero(current.attackerHeroId),
        getDefaultV2DpsScenarioIdsForHero(current.attackerHeroId)
      );
      setActiveCurveId(curve.curveId);
      setExpandedCurveIds((currentExpanded) => [...currentExpanded, curve.curveId]);
      return { ...current, curves: [...current.curves, curve] };
    });
  }, [updateSelection]);

  const handleRuneDraftChange = useCallback((curveId: string, value: string) => {
    setRuneDraftByCurveId((current) => ({ ...current, [curveId]: value }));
    resetRunArtifacts();
  }, [resetRunArtifacts]);

  const handleRuneDraftBlur = useCallback((curveId: string) => {
    const rawValue = runeDraftByCurveId[curveId];
    if (rawValue === undefined) {
      return;
    }
    const parsed = parseRuneAdjustments(rawValue);
    setRuneDraftByCurveId((current) => ({ ...current, [curveId]: formatRuneAdjustments(parsed) }));
    updateCurve(curveId, { runeStatAdjustments: parsed });
  }, [runeDraftByCurveId, updateCurve]);

  const handleRemoveCurve = useCallback((curveId: string) => {
    updateSelection((current) => {
      if (current.curves.length <= 1) {
        return current;
      }
      const nextCurves = current.curves.filter((curve) => curve.curveId !== curveId);
      return { ...current, curves: nextCurves };
    });
    setExpandedCurveIds((current) => current.filter((expandedCurveId) => expandedCurveId !== curveId));
  }, [updateSelection]);

  const handleToggleCurveExpanded = useCallback((curveId: string) => {
    setActiveCurveId(curveId);
    setExpandedCurveIds((current) => (
      current.includes(curveId)
        ? current.filter((expandedCurveId) => expandedCurveId !== curveId)
        : [...current, curveId]
    ));
  }, []);

  const handleViewCurveResult = useCallback((curveId: string) => {
    setActiveCurveId(curveId);
    resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  const attackColumns = [
    {
      title: <span className="wasm-hud-col-title">timeMs</span>,
      align: 'right' as const,
      render: (_: unknown, record: AttackRow) => <span className="wasm-hud-value">{record.timeMs}</span>
    },
    {
      title: <span className="wasm-hud-col-title">action</span>,
      render: (_: unknown, record: AttackRow) => <Typography.Text className="wasm-code-token">{record.actionId}</Typography.Text>
    },
    {
      title: <span className="wasm-hud-col-title">source</span>,
      render: (_: unknown, record: AttackRow) => <Typography.Text className="wasm-code-token">{record.sourceActorId}</Typography.Text>
    },
    {
      title: <span className="wasm-hud-col-title">target</span>,
      render: (_: unknown, record: AttackRow) => <Typography.Text className="wasm-code-token">{record.targetActorId}</Typography.Text>
    }
  ];

  const damageColumns = [
    {
      title: <span className="wasm-hud-col-title">timeMs</span>,
      align: 'right' as const,
      render: (_: unknown, record: DamageRow) => <span className="wasm-hud-value">{record.timeMs}</span>
    },
    {
      title: <span className="wasm-hud-col-title">type</span>,
      render: (_: unknown, record: DamageRow) => <Tag color="arcoblue">{record.damageType}</Tag>
    },
    {
      title: <span className="wasm-hud-col-title">raw</span>,
      align: 'right' as const,
      render: (_: unknown, record: DamageRow) => <span className="wasm-hud-value">{formatNumber(record.rawDamage)}</span>
    },
    {
      title: <span className="wasm-hud-col-title">final</span>,
      align: 'right' as const,
      render: (_: unknown, record: DamageRow) => <span className="wasm-hud-value">{formatNumber(record.finalDamage)}</span>
    },
    {
      title: <span className="wasm-hud-col-title">HP</span>,
      align: 'right' as const,
      render: (_: unknown, record: DamageRow) => (
        <span className="wasm-hud-value">
          {formatNumber(record.targetHpBefore)}
          {' -> '}
          {formatNumber(record.targetHpAfter)}
        </span>
      )
    }
  ];

  const summaryColumns = [
    {
      title: 'Curve',
      render: (_: unknown, record: SummaryRow) => (
        <Space direction="vertical" size={2}>
          <Typography.Text className="wasm-code-token">{record.label}</Typography.Text>
          <Typography.Text type="secondary" className="wasm-code-token">{record.curveId}</Typography.Text>
        </Space>
      )
    },
    {
      title: 'Status',
      render: (_: unknown, record: SummaryRow) => <Tag color={record.status === 'ok' ? 'green' : record.status === 'blocked' ? 'orange' : 'gray'}>{record.status}</Tag>
    },
    {
      title: 'Blocked Reasons',
      render: (_: unknown, record: SummaryRow) => (
        record.blockedReasons.length > 0
          ? <Typography.Text className="wasm-code-token">{record.blockedReasons.join(' / ')}</Typography.Text>
          : <Typography.Text type="secondary">N/A</Typography.Text>
      )
    },
    {
      title: 'Total',
      align: 'right' as const,
      render: (_: unknown, record: SummaryRow) => <span className="wasm-hud-value">{formatNumber(record.totalDamage)}</span>
    },
    {
      title: 'DPS',
      align: 'right' as const,
      render: (_: unknown, record: SummaryRow) => <span className="wasm-hud-value">{formatNumber(record.timeWindowDps)}</span>
    },
    {
      title: 'Kill',
      align: 'right' as const,
      render: (_: unknown, record: SummaryRow) => <span className="wasm-hud-value">{record.killTimeMs == null ? 'N/A' : `${record.killTimeMs}ms`}</span>
    },
    {
      title: 'Attacks',
      align: 'right' as const,
      render: (_: unknown, record: SummaryRow) => <span className="wasm-hud-value">{record.attackCount ?? 'N/A'}</span>
    },
    {
      title: 'Damage By Type',
      render: (_: unknown, record: SummaryRow) => <Typography.Text className="wasm-code-token">{formatNumberRecord(record.damageByType)}</Typography.Text>
    },
    {
      title: 'Damage By Source',
      render: (_: unknown, record: SummaryRow) => <Typography.Text className="wasm-code-token">{formatNumberRecord(record.damageBySource)}</Typography.Text>
    }
  ];

  return (
    <div className="wasm-validation-page">
      <Panel
        title="V2 DPS 单英雄多曲线"
        kicker="single_attacker_dps / Batch E-1"
        actions={
          <Space wrap>
            <Tag color={bundleStatus === 'success' ? 'green' : bundleStatus === 'error' ? 'red' : 'gray'}>{bundleStatus}</Tag>
            <Button icon={<IconRefresh />} onClick={() => void handleReloadBundle()} disabled={!selectedGameId || bundleStatus === 'loading'}>
              重新加载
            </Button>
            <Button type="primary" icon={<IconPlayArrow />} onClick={() => void handleRun()} disabled={!canRun} loading={runStatus === 'loading'}>
              运行
            </Button>
            <Button icon={<IconCopy />} onClick={() => void handleCopyExport()} disabled={!exportPayload}>
              导出 JSON
            </Button>
          </Space>
        }
      >
        {!selectedGameId ? <Alert type="warning" content="当前没有选中的 gameId。" /> : null}
        {bundleError ? <Alert type="error" content={bundleError} /> : null}
        {runError ? <Alert type="error" content={runError} /> : null}

        <Row gutter={[16, 16]} className="wasm-selection-grid">
          <Col span={6}>
            <MetricCard label="Game" value={selectedGameId ?? 'none'} hint={selectedGameName} />
          </Col>
          <Col span={6}>
            <MetricCard label="Version" value={currentVersion?.versionCode ?? 'N/A'} hint={cacheStatus ? `bundle cache ${cacheStatus}` : 'bundle'} />
          </Col>
          <Col span={6}>
            <MetricCard label="Case" value={V2_DPS_CASE_ID} hint={`${selection?.curves.length ?? 0} curves`} />
          </Col>
          <Col span={6}>
            <MetricCard label="Wasm" value={wasmSha256 ? wasmSha256.slice(0, 12) : formatLoadState(runStatus)} hint={WASM_ASSET_LABEL} />
          </Col>
        </Row>

        <Form layout="vertical">
          <Row gutter={[16, 16]}>
            <Col span={8}>
              <Form.Item label="英雄">
                <Select
                  value={selection?.attackerHeroId ?? ''}
                  showSearch
                  filterOption={filterSelectOption}
                  onChange={(value) => {
                    const attackerHeroId = String(value);
                    const curves = createDefaultV2DpsCurveSelections(attackerHeroId, bundle ?? undefined);
                    setRuneDraftByCurveId(createRuneDrafts(curves));
                    setExpandedCurveIds([]);
                    updateSelection((current) => ({
                      ...current,
                      attackerHeroId,
                      curves
                    }));
                    setActiveCurveId(curves[0]?.curveId ?? null);
                  }}
                  disabled={!selection}
                >
                  {attackerOptions.map((option) => (
                    <Select.Option key={option.actorId} value={option.actorId}>
                      {option.label}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="目标 actor">
                <Select
                  value={selection?.targetActorId ?? ''}
                  showSearch
                  filterOption={filterSelectOption}
                  onChange={(value) => updateSelection((current) => ({ ...current, targetActorId: String(value) }))}
                  disabled={!selection}
                >
                  {targetGroups.map((group) => (
                    <Select.OptGroup key={group.typeKey} label={group.label}>
                      {group.actors.map((option) => (
                        <Select.Option key={option.actorId} value={option.actorId}>
                          {option.label}
                        </Select.Option>
                      ))}
                    </Select.OptGroup>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item label="durationMs">
                <InputNumber
                  min={1}
                  value={selection?.durationMs ?? 10000}
                  onChange={(value) => updateSelection((current) => ({ ...current, durationMs: Number(value ?? 10000) }))}
                  disabled={!selection}
                />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item label="attackSpeedCap">
                <InputNumber value={selection?.attackSpeedCap ?? 3.0} disabled />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item label="critPolicy">
                <Select value={selection?.critPolicy ?? 'expected'} disabled>
                  <Select.Option value="expected">expected</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Panel>

      <Panel
        title="Curve 配置"
        kicker="published bundle -> resolvedSnapshot"
        actions={
          <Space wrap>
            <Button icon={<IconPlus />} onClick={handleAddCurve} disabled={!selection}>
              添加 curve
            </Button>
            <Button onClick={() => selection && updateSelection((current) => {
              const curves = createDefaultV2DpsCurveSelections(current.attackerHeroId, bundle ?? undefined);
              setRuneDraftByCurveId(createRuneDrafts(curves));
              setExpandedCurveIds([]);
              return {
                ...current,
                curves
              };
            })} disabled={!selection}>
              重置默认
            </Button>
          </Space>
        }
      >
        {!selection ? (
          <EmptyState title="未加载 bundle" description="选择 gameId 并加载 published bundle 后配置 curve。" />
        ) : (
          <div className="v2-dps-curve-list">
            {selection.curves.map((curve) => {
              const isExpanded = expandedCurveIds.includes(curve.curveId);
              const equipmentSummary = formatCurveEquipmentLabel(curve, equipmentLabelById);
              return (
                <section
                  key={curve.curveId}
                  className={`v2-dps-curve-editor${curve.curveId === activeCurveId ? ' is-active' : ''}`}
                  onFocus={() => setActiveCurveId(curve.curveId)}
                >
                  <div className="v2-dps-curve-editor-head">
                    <Space direction="vertical" size={4}>
                      <Typography.Text className="panel-kicker">{formatCurveLevelSummary(curve)}</Typography.Text>
                      <Typography.Title heading={5} className="v2-dps-curve-title">{curve.label || equipmentSummary}</Typography.Title>
                      <div className="v2-dps-curve-tags">
                        <Tag>{equipmentSummary}</Tag>
                        <Tag>技能 {formatSkillLevelSummary(curve.skillLevels)}</Tag>
                      </div>
                    </Space>
                    <Space wrap>
                      <Button size="mini" onClick={() => handleViewCurveResult(curve.curveId)}>
                        查看结果
                      </Button>
                      <Button size="mini" onClick={() => handleToggleCurveExpanded(curve.curveId)}>
                        {isExpanded ? '收起配置' : '编辑配置'}
                      </Button>
                      <Button
                        size="mini"
                        status="danger"
                        icon={<IconDelete />}
                        onClick={() => handleRemoveCurve(curve.curveId)}
                        disabled={selection.curves.length <= 1}
                      />
                    </Space>
                  </div>
                  {isExpanded ? (
                    <Form layout="vertical">
                  <Row gutter={[12, 12]}>
                    <Col span={6}>
                      <Form.Item label="curve 名称">
                        <Input value={curve.label} onChange={(value) => updateCurve(curve.curveId, { label: value })} />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item label="英雄等级">
                        <InputNumber
                          min={1}
                          max={18}
                          value={curve.heroLevel}
                          onChange={(value) => updateCurve(curve.curveId, { heroLevel: Number(value ?? 1) })}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={14}>
                      <Form.Item label="技能等级">
                        <Space wrap className="v2-dps-skill-levels">
                          {SKILL_KEYS.map((skillKey) => (
                            <InputNumber
                              key={skillKey}
                              prefix={skillKey}
                              min={skillKey === 'P' ? 0 : 1}
                              max={skillKey === 'P' ? 1 : 5}
                              value={curve.skillLevels[skillKey] ?? (skillKey === 'P' ? 1 : 1)}
                              onChange={(value) => updateCurve(curve.curveId, {
                                skillLevels: {
                                  ...curve.skillLevels,
                                  [skillKey]: Number(value ?? (skillKey === 'P' ? 1 : 1))
                                }
                              })}
                            />
                          ))}
                        </Space>
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Form.Item label="装备">
                        <Select
                          mode="multiple"
                          value={curve.equipmentItemIds}
                          showSearch
                          filterOption={filterSelectOption}
                          onChange={(value) => updateCurve(curve.curveId, { equipmentItemIds: normalizeSelectValues(value) })}
                          disabled={equipmentOptions.length === 0}
                          placeholder="选择 ADC 成装；缺失 published bundle 数据时该 curve 会 blocked"
                        >
                          {equipmentOptions.map((option) => (
                            <Select.Option key={option.itemId} value={option.itemId}>
                              {option.label} / {option.statsLabel}
                            </Select.Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="启用技能被动">
                        <Select
                          mode="multiple"
                          value={curve.enabledPassiveEffectIds}
                          onChange={(value) => updateCurve(curve.curveId, { enabledPassiveEffectIds: normalizeSelectValues(value) })}
                          disabled={passiveOptions.length === 0}
                          placeholder="当前英雄没有可选技能被动"
                        >
                          {passiveOptions.map((option) => (
                            <Select.Option key={option.id} value={option.id}>
                              {option.label}
                            </Select.Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="场景预设">
                        <Select
                          mode="multiple"
                          value={curve.enabledScenarioStateIds}
                          onChange={(value) => updateCurve(curve.curveId, { enabledScenarioStateIds: normalizeSelectValues(value) })}
                          disabled={scenarioOptions.length === 0}
                          placeholder="无预设状态"
                        >
                          {scenarioOptions.map((option) => (
                            <Select.Option key={option.id} value={option.id}>
                              {option.label}
                            </Select.Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Form.Item label="符文/属性调整">
                        <Input
                          value={runeDraftByCurveId[curve.curveId] ?? formatRuneAdjustments(curve.runeStatAdjustments)}
                          onChange={(value) => handleRuneDraftChange(curve.curveId, value)}
                          onBlur={() => handleRuneDraftBlur(curve.curveId)}
                          placeholder="ad=10, attack_speed=0.1"
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                    </Form>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </Panel>

      <div ref={resultsRef} className="v2-dps-results-stack">
        <Row gutter={[16, 16]} className="wasm-validation-grid">
          <Col span={6}>
            <MetricCard label="Active Status" value={activeCurveResult?.status ?? 'N/A'} hint={activeCurveResult?.stopReason ?? 'not run'} />
          </Col>
          <Col span={6}>
            <MetricCard label="Total Damage" value={formatNumber(activeCurveResult?.totalDamage)} hint={`${activeCurveResult?.attackCount ?? 0} attacks`} />
          </Col>
          <Col span={6}>
            <MetricCard label="Time Window DPS" value={formatNumber(activeCurveResult?.timeWindowDps)} hint={`${activeCurveResult?.durationMs ?? 0}ms`} />
          </Col>
          <Col span={6}>
            <MetricCard label="Kill DPS" value={activeCurveResult?.killDps == null ? 'N/A' : formatNumber(activeCurveResult.killDps)} hint={formatKillTime(activeCurveResult)} />
          </Col>
        </Row>

        {activeCurveResult?.status === 'blocked' ? (
          <Alert type="warning" content={activeCurveResult.blockedReasons.join(' / ') || 'blocked'} />
        ) : null}

        <Panel
          title={chartMode === 'damage' ? '累计伤害对比' : '目标 HP 对比'}
          kicker="曲线按装备方案命名"
          actions={
            <Select value={chartMode} onChange={(value) => setChartMode(value as ChartMode)} style={{ width: 160 }}>
              <Select.Option value="damage">累计伤害</Select.Option>
              <Select.Option value="hp">目标 HP</Select.Option>
            </Select>
          }
        >
          <div ref={chartElementRef} className="v2-dps-chart" data-testid="v2-dps-chart" />
        </Panel>

        <Panel title="结果汇总" kicker="curveResults">
          {summaryRows.length > 0 ? (
            <Table rowKey="key" columns={summaryColumns} data={summaryRows} pagination={false} size="small" className="data-table-shell" />
          ) : (
            <EmptyState title="还没有结果" description="运行后展示每条 curve 的总伤害、DPS、击杀时间和伤害构成。" />
          )}
        </Panel>

        <Panel title="Curve 详情" kicker="active curve">
          <Select value={activeCurveResult?.curveId ?? activeCurveConfig?.curveId} onChange={(value) => setActiveCurveId(String(value))}>
            {(curveResults.length > 0 ? curveResults : selection?.curves ?? []).map((curve) => {
              const curveId = 'curveId' in curve ? curve.curveId : '';
              const status = 'status' in curve ? ` / ${curve.status}` : '';
              return (
                <Select.Option key={curveId} value={curveId}>
                  {curveLabelById.get(curveId) ?? curveId}{status}
                </Select.Option>
              );
            })}
          </Select>
        </Panel>
      </div>

      <Row gutter={[16, 16]} className="wasm-validation-grid">
        <Col span={12}>
          <Panel title="普攻时间线" kicker="attackTimeline">
            {attackRows.length > 0 ? (
              <Table rowKey="key" columns={attackColumns} data={attackRows} pagination={false} size="small" />
            ) : (
              <EmptyState title="还没有普攻事件" description="运行后展示 wasm 返回的 attackTimeline。" />
            )}
          </Panel>
        </Col>
        <Col span={12}>
          <Panel title="伤害时间线" kicker="damageTimeline">
            {damageRows.length > 0 ? (
              <Table rowKey="key" columns={damageColumns} data={damageRows} pagination={false} size="small" />
            ) : (
              <EmptyState title="还没有伤害事件" description="运行后展示 wasm 返回的 damageTimeline。" />
            )}
          </Panel>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="wasm-validation-grid">
        <Col span={12}>
          <Panel title="导出预览" kicker="selection + resolvedSnapshot + wasmOutput">
            {exportPayload ? <JsonBlock value={exportPayload} /> : <EmptyState title="导出为空" description="运行后生成 V2 DPS JSON。" />}
          </Panel>
        </Col>
        <Col span={12}>
          <Panel title="Wasm Frames" kicker="decoded outbox">
            {decodedFrames.length > 0 ? <JsonBlock value={decodedFrames} /> : <EmptyState title="还没有 frame" description="运行后展示 decoded outbox。" />}
          </Panel>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="wasm-validation-grid">
        <Col span={8}>
          <Panel title="技能被动触发" kicker="skillPassiveTriggers">
            {activeCurveResult ? <JsonBlock value={activeCurveResult.skillPassiveTriggers} /> : <EmptyState title="还没有触发明细" description="运行后展示 wasm 返回的 skillPassiveTriggers。" />}
          </Panel>
        </Col>
        <Col span={8}>
          <Panel title="装备被动触发" kicker="itemPassiveTriggers">
            {activeCurveResult ? <JsonBlock value={activeCurveResult.itemPassiveTriggers} /> : <EmptyState title="还没有装备触发明细" description="运行后展示 wasm 返回的 itemPassiveTriggers。" />}
          </Panel>
        </Col>
        <Col span={8}>
          <Panel title="效果拆解" kicker="effectBreakdown">
            {activeCurveResult ? <JsonBlock value={activeCurveResult.effectBreakdown} /> : <EmptyState title="还没有效果拆解" description="运行后展示 wasm 返回的 effectBreakdown。" />}
          </Panel>
        </Col>
      </Row>
    </div>
  );
}

function decodeFrames(frames: TinyGoV2Frame[], stage: string): DecodedFrame[] {
  return frames.map((frame) => ({
    stage,
    kind: frame.kind,
    label: frameKindLabel[frame.kind] ?? `kind_${frame.kind}`,
    payload: decodeFramePayload<unknown>(frame)
  }));
}

function findDonePayload(frames: DecodedFrame[]): V2DpsOutput | null {
  const doneFrame = frames.find((frame) => frame.kind === DONE_FRAME_KIND);
  return doneFrame ? doneFrame.payload as V2DpsOutput : null;
}

function buildSummaryRows(results: V2DpsCurveResult[], curveLabelById: Map<string, string>): SummaryRow[] {
  return results.map((result) => ({
    key: result.curveId,
    curveId: result.curveId,
    label: curveLabelById.get(result.curveId) ?? result.curveId,
    status: result.status,
    totalDamage: result.totalDamage,
    timeWindowDps: result.timeWindowDps,
    killTimeMs: result.killTimeMs,
    attackCount: result.attackCount,
    damageByType: result.damageByType,
    damageBySource: result.damageBySource,
    blockedReasons: result.blockedReasons
  }));
}

function buildChartOption(results: V2DpsCurveResult[], curveLabelById: Map<string, string>, chartMode: ChartMode): echarts.EChartsOption {
  const series = results.map((result) => ({
    name: curveLabelById.get(result.curveId) ?? result.curveId,
    type: 'line' as const,
    showSymbol: false,
    smooth: false,
    data: chartMode === 'damage' ? buildDamageSeries(result) : buildHpSeries(result)
  }));
  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) => formatNumber(typeof value === 'number' ? value : Number(value))
    },
    legend: {
      type: 'scroll',
      top: 0
    },
    grid: {
      left: 56,
      right: 24,
      top: 54,
      bottom: 42
    },
    xAxis: {
      type: 'value',
      name: 'timeMs',
      min: 0
    },
    yAxis: {
      type: 'value',
      name: chartMode === 'damage' ? 'damage' : 'HP',
      min: 0
    },
    series
  };
}

function buildDamageSeries(result: V2DpsCurveResult): Array<[number, number]> {
  if (result.status !== 'ok') {
    return [];
  }
  const points: Array<[number, number]> = [[0, 0]];
  let total = 0;
  for (const event of [...result.damageTimeline].sort((left, right) => left.timeMs - right.timeMs)) {
    total += event.finalDamage;
    points.push([event.timeMs, Number(total.toFixed(6))]);
  }
  if (points[points.length - 1]?.[0] !== result.durationMs) {
    points.push([result.durationMs, Number(total.toFixed(6))]);
  }
  return points;
}

function buildHpSeries(result: V2DpsCurveResult): Array<[number, number]> {
  if (result.status !== 'ok') {
    return [];
  }
  const hpPoints = result.targetHpTimeline.length > 0
    ? result.targetHpTimeline.map((event) => [event.timeMs, event.currentHp] as [number, number])
    : result.damageTimeline.map((event) => [event.timeMs, event.targetHpAfter] as [number, number]);
  const points = hpPoints.length > 0 ? hpPoints : [[0, result.resolvedSnapshot.targetSnapshot.currentHp]] as Array<[number, number]>;
  const last = points[points.length - 1];
  if (last && last[0] !== result.durationMs) {
    points.push([result.durationMs, last[1]]);
  }
  return points;
}

function buildExportSelection(preparedInput: V2DpsPreparedInput) {
  const firstCurve = preparedInput.runInput.curves[0];
  return {
    attackerHeroId: firstCurve?.selection.heroId ?? '',
    targetActorId: preparedInput.runInput.targetSnapshot.actorId,
    durationMs: preparedInput.runInput.simulationRules.durationMs,
    attackSpeedCap: preparedInput.runInput.simulationRules.attackSpeedCap,
    critPolicy: preparedInput.runInput.simulationRules.critPolicy,
    curves: preparedInput.runInput.curves.map((curve) => ({
      curveId: curve.curveId,
      label: curve.label,
      ...curve.selection
    }))
  };
}

function buildExportResolvedSnapshot(preparedInput: V2DpsPreparedInput) {
  return {
    targetSnapshot: preparedInput.runInput.targetSnapshot,
    curves: preparedInput.runInput.curves.map((curve) => ({
      curveId: curve.curveId,
      label: curve.label,
      resolvedSnapshot: curve.resolvedSnapshot
    }))
  };
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
    optionData?.props?.children
  ]
    .map((value) => String(value ?? ''))
    .join(' ')
    .toLowerCase();
  return searchText.includes(inputValue.trim().toLowerCase());
}

function normalizeSelectValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (value == null || value === '') {
    return [];
  }
  return [String(value)];
}

function stripItemIdPrefix(label: string): string {
  return label.replace(/^\d+\s*\/\s*/, '').trim() || label;
}

function formatCurveEquipmentLabel(curve: V2DpsCurveSelection, equipmentLabelById: Map<string, string>): string {
  if (curve.equipmentItemIds.length === 0) {
    return '无装备';
  }
  return curve.equipmentItemIds
    .map((itemId) => equipmentLabelById.get(itemId) ?? itemId)
    .join(' + ');
}

function formatSkillLevelSummary(skillLevels: Record<string, number>): string {
  return SKILL_KEYS.map((skillKey) => `${skillKey}${skillLevels[skillKey] ?? 1}`).join(' / ');
}

function formatCurveLevelSummary(curve: V2DpsCurveSelection): string {
  return `英雄 ${curve.heroLevel} 级 / ${formatSkillLevelSummary(curve.skillLevels)}`;
}

function parseRuneAdjustments(value: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const token of value.split(/[,\n;]/)) {
    const [rawKey, rawValue] = token.split('=');
    const key = rawKey?.trim();
    const numericValue = Number(rawValue);
    if (key && Number.isFinite(numericValue) && numericValue !== 0) {
      result[key] = numericValue;
    }
  }
  return result;
}

function createRuneDrafts(curves: V2DpsCurveSelection[]): Record<string, string> {
  return Object.fromEntries(curves.map((curve) => [curve.curveId, formatRuneAdjustments(curve.runeStatAdjustments)]));
}

function syncRuneDrafts(current: Record<string, string>, curves: V2DpsCurveSelection[]): Record<string, string> {
  const next: Record<string, string> = {};
  let changed = Object.keys(current).length !== curves.length;
  for (const curve of curves) {
    const value = current[curve.curveId] ?? formatRuneAdjustments(curve.runeStatAdjustments);
    next[curve.curveId] = value;
    changed = changed || current[curve.curveId] !== value;
  }
  return changed ? next : current;
}

function commitRuneDrafts(selection: V2DpsSelection, drafts: Record<string, string>): V2DpsSelection {
  let changed = false;
  const curves = selection.curves.map((curve) => {
    const draft = drafts[curve.curveId];
    if (draft === undefined) {
      return curve;
    }
    const parsed = parseRuneAdjustments(draft);
    if (numberRecordsEqual(parsed, curve.runeStatAdjustments)) {
      return curve;
    }
    changed = true;
    return { ...curve, runeStatAdjustments: parsed };
  });
  return changed ? { ...selection, curves } : selection;
}

function numberRecordsEqual(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left);
  const rightKeys = new Set(Object.keys(right));
  if (leftEntries.length !== rightKeys.size) {
    return false;
  }
  return leftEntries.every(([key, value]) => rightKeys.has(key) && right[key] === value);
}

function formatRuneAdjustments(value: Record<string, number>): string {
  return Object.entries(value)
    .map(([key, numberValue]) => `${key}=${formatCompactNumber(numberValue)}`)
    .join(', ');
}

function formatLoadState(status: LoadState): string {
  if (status === 'loading') {
    return 'loading';
  }
  if (status === 'success') {
    return 'ready';
  }
  if (status === 'error') {
    return 'error';
  }
  return 'idle';
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A';
  }
  return value.toFixed(2);
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(4)).toString();
}

function formatNumberRecord(value: Record<string, number>): string {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return 'N/A';
  }
  return entries.map(([key, numberValue]) => `${key}:${formatNumber(numberValue)}`).join(' / ');
}

function formatKillTime(result: V2DpsCurveResult | null): string {
  if (!result || result.killTimeMs == null) {
    return 'not killed';
  }
  return `${result.killTimeMs}ms`;
}

function normalizeDomId(value: string): string {
  return value
    .toLowerCase()
    .replace(/^hero_/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'hero';
}

function createUniqueCurveIdentity(attackerHeroId: string, curves: V2DpsCurveSelection[]): { curveId: string; label: string } {
  const prefix = normalizeDomId(attackerHeroId || 'hero');
  const usedIds = new Set(curves.map((curve) => curve.curveId));
  let nextIndex = 1;
  while (usedIds.has(`${prefix}-curve-${nextIndex}`)) {
    nextIndex += 1;
  }
  return {
    curveId: `${prefix}-curve-${nextIndex}`,
    label: `自定义 ${nextIndex}`
  };
}

async function computeWasmSha256(wasmUrl: URL): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return '';
  }
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(`Failed to load wasm for hashing: ${response.status} ${response.statusText}`);
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await response.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
