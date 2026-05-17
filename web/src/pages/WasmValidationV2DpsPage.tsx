import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Grid, InputNumber, Select, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { IconCopy, IconPlayArrow, IconRefresh } from '@arco-design/web-react/icon';
import { EmptyState } from '../components/EmptyState';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import {
  createDefaultV2DpsSelection,
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

  useEffect(() => {
    let cancelled = false;

    async function loadBundle() {
      if (!selectedGameId) {
        setBundle(null);
        setCurrentVersion(null);
        setSelection(null);
        setBundleStatus('idle');
        setBundleError(null);
        return;
      }

      setBundleStatus('loading');
      setBundleError(null);
        setWasmOutput(null);
        setDecodedFrames([]);
        setActiveCurveId(null);

      try {
        const snapshot = await loadPublishedBundleSnapshot(apiBaseUrl, selectedGameId);
        if (cancelled) {
          return;
        }
        setBundle(snapshot.bundle);
        setCurrentVersion(snapshot.currentVersion);
        setCacheStatus(snapshot.cacheStatus);
        setSelection(createDefaultV2DpsSelection(snapshot.bundle));
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

  const attackerOptions = useMemo(() => (bundle ? listV2DpsAttackers(bundle) : []), [bundle]);
  const targetGroups = useMemo(() => (bundle ? listV2DpsTargetGroups(bundle) : []), [bundle]);
  const equipmentOptions = useMemo(() => (bundle ? listV2DpsEquipmentOptions(bundle) : []), [bundle]);
  const passiveOptions = useMemo(() => listV2DpsPassiveOptionsForHero(selection?.attackerHeroId ?? ''), [selection?.attackerHeroId]);
  const scenarioOptions = useMemo(() => listV2DpsScenarioOptionsForHero(selection?.attackerHeroId ?? ''), [selection?.attackerHeroId]);
  const curveResults = wasmOutput?.curveResults ?? [];
  const curveResult = useMemo(() => {
    if (curveResults.length === 0) {
      return null;
    }
    if (activeCurveId) {
      return curveResults.find((result) => result.curveId === activeCurveId) ?? curveResults[0];
    }
    return curveResults.find((result) => result.curveId.endsWith('-selected-passives')) ?? curveResults[0];
  }, [activeCurveId, curveResults]);
  const canRun = Boolean(bundle && currentVersion && selection && selectedGameId) && runStatus !== 'loading';

  const attackRows = useMemo<AttackRow[]>(
    () => curveResult?.attackTimeline.map((row, index) => ({ ...row, key: `${index}-${row.timeMs}` })) ?? [],
    [curveResult]
  );
  const damageRows = useMemo<DamageRow[]>(
    () => curveResult?.damageTimeline.map((row, index) => ({ ...row, key: `${index}-${row.timeMs}` })) ?? [],
    [curveResult]
  );

  const exportPayload = useMemo(() => {
    if (!wasmOutput || !preparedInput) {
      return null;
    }
    const activeCurve = curveResult ?? wasmOutput.curveResults[0];
    return {
      caseId: wasmOutput.caseId,
      versionCode: wasmOutput.versionCode,
      wasmSha256: wasmOutput.wasmSha256,
      activeCurveId: activeCurve?.curveId,
      selection: activeCurve?.selection ?? preparedInput.runInput.curves[0]?.selection,
      resolvedSnapshot: activeCurve?.resolvedSnapshot ?? preparedInput.runInput.curves[0]?.resolvedSnapshot,
      skillPassiveTriggers: activeCurve?.skillPassiveTriggers ?? [],
      itemPassiveTriggers: activeCurve?.itemPassiveTriggers ?? [],
      effectBreakdown: activeCurve?.effectBreakdown ?? [],
      runInput: preparedInput.runInput,
      wasmOutput
    };
  }, [curveResult, preparedInput, wasmOutput]);

  const updateSelection = useCallback((patch: Partial<V2DpsSelection>) => {
    setSelection((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const handleReloadBundle = useCallback(async () => {
    if (!selectedGameId) {
      return;
    }
    setBundleStatus('loading');
    setBundleError(null);
      setWasmOutput(null);
      setDecodedFrames([]);
      setActiveCurveId(null);
    try {
      const snapshot = await loadPublishedBundleSnapshot(apiBaseUrl, selectedGameId);
      setBundle(snapshot.bundle);
      setCurrentVersion(snapshot.currentVersion);
      setCacheStatus(snapshot.cacheStatus);
      setSelection(createDefaultV2DpsSelection(snapshot.bundle));
      setBundleStatus('success');
    } catch (error) {
      setBundleStatus('error');
      setBundleError(getErrorMessage(error));
    }
  }, [apiBaseUrl, selectedGameId]);

  const handleRun = useCallback(async () => {
    if (!bundle || !currentVersion || !selection) {
      return;
    }
    setRunStatus('loading');
    setRunError(null);
      setWasmOutput(null);
      setDecodedFrames([]);
      setActiveCurveId(null);
    let nextDecodedFrames: DecodedFrame[] = [];

    try {
      const nextWasmSha256 = await computeWasmSha256(TINYGO_V2_WASM_URL);
      const prepared = prepareV2DpsInput(bundle, selection, currentVersion.versionCode, nextWasmSha256);
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

      setWasmSha256(nextWasmSha256);
      setPreparedInput(prepared);
      setWasmOutput(donePayload);
      setActiveCurveId(donePayload.curveResults.find((result) => result.curveId.endsWith('-selected-passives'))?.curveId ?? donePayload.curveResults[0]?.curveId ?? null);
      setDecodedFrames(nextDecodedFrames);
      setRunStatus('success');
    } catch (error) {
      if (error instanceof TinyGoV2InvocationError) {
        setDecodedFrames([...nextDecodedFrames, ...decodeFrames(error.frames, error.fnName)]);
      }
      setRunStatus('error');
      setRunError(getErrorMessage(error));
    }
  }, [bundle, currentVersion, selection]);

  const handleCopyExport = useCallback(async () => {
    if (!exportPayload || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2));
  }, [exportPayload]);

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

  return (
    <div className="wasm-validation-page">
      <Panel
        title="V2 DPS 验证"
        kicker="single_attacker_dps"
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
            <MetricCard label="Case" value={V2_DPS_CASE_ID} hint="Batch D" />
          </Col>
          <Col span={6}>
            <MetricCard label="Wasm" value={wasmSha256 ? wasmSha256.slice(0, 12) : formatLoadState(runStatus)} hint={WASM_ASSET_LABEL} />
          </Col>
        </Row>

        <Form layout="vertical">
          <Row gutter={[16, 16]}>
            <Col span={8}>
              <Form.Item label="攻击方">
                <Select
                  value={selection?.attackerHeroId ?? ''}
                  showSearch
                  filterOption={filterSelectOption}
                  onChange={(value) => {
                    const attackerHeroId = String(value);
                    updateSelection({
                      attackerHeroId,
                      equipmentItemIds: selection?.equipmentItemIds ?? [],
                      enabledPassiveEffectIds: getDefaultV2DpsPassiveIdsForHero(attackerHeroId),
                      enabledScenarioStateIds: getDefaultV2DpsScenarioIdsForHero(attackerHeroId)
                    });
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
              <Form.Item label="标靶">
                <Select
                  value={selection?.targetActorId ?? ''}
                  showSearch
                  filterOption={filterSelectOption}
                  onChange={(value) => updateSelection({ targetActorId: String(value) })}
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
                  onChange={(value) => updateSelection({ durationMs: Number(value ?? 10000) })}
                  disabled={!selection}
                />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item label="attackSpeedCap">
                <InputNumber value={3.0} disabled />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label="ADC 成装">
                <Select
                  mode="multiple"
                  value={selection?.equipmentItemIds ?? []}
                  showSearch
                  filterOption={filterSelectOption}
                  onChange={(value) => updateSelection({ equipmentItemIds: normalizeSelectValues(value) })}
                  disabled={!selection || equipmentOptions.length === 0}
                  placeholder="选择要合并到本次 DPS 的成装"
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
              <Form.Item label="Batch B 被动">
                <Select
                  mode="multiple"
                  value={selection?.enabledPassiveEffectIds ?? []}
                  onChange={(value) => updateSelection({ enabledPassiveEffectIds: normalizeSelectValues(value) })}
                  disabled={!selection || passiveOptions.length === 0}
                  placeholder="当前英雄没有 Batch B 被动配置"
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
              <Form.Item label="scenarioStates">
                <Select
                  mode="multiple"
                  value={selection?.enabledScenarioStateIds ?? []}
                  onChange={(value) => updateSelection({ enabledScenarioStateIds: normalizeSelectValues(value) })}
                  disabled={!selection || scenarioOptions.length === 0}
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
          </Row>
        </Form>
      </Panel>

      <Row gutter={[16, 16]} className="wasm-validation-grid">
        <Col span={6}>
          <MetricCard label="Status" value={curveResult?.status ?? 'N/A'} hint={curveResult?.stopReason ?? 'not run'} />
        </Col>
        <Col span={6}>
          <MetricCard label="Total Damage" value={formatNumber(curveResult?.totalDamage)} hint={`${curveResult?.attackCount ?? 0} attacks`} />
        </Col>
        <Col span={6}>
          <MetricCard label="Time Window DPS" value={formatNumber(curveResult?.timeWindowDps)} hint={`${curveResult?.durationMs ?? 0}ms`} />
        </Col>
        <Col span={6}>
          <MetricCard label="Kill DPS" value={curveResult?.killDps == null ? 'N/A' : formatNumber(curveResult.killDps)} hint={formatKillTime(curveResult)} />
        </Col>
      </Row>

      {curveResult?.status === 'blocked' ? (
        <Alert type="warning" content={curveResult.blockedReasons.join(' / ') || 'blocked'} />
      ) : null}

      {curveResults.length > 1 ? (
        <Panel title="Curve 选择" kicker="curveResults">
          <Select value={curveResult?.curveId} onChange={(value) => setActiveCurveId(String(value))}>
            {curveResults.map((result) => (
              <Select.Option key={result.curveId} value={result.curveId}>
                {result.curveId} / {result.status}
              </Select.Option>
            ))}
          </Select>
        </Panel>
      ) : null}

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
          <Panel title="导出预览" kicker="selection + resolvedSnapshot">
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
        <Col span={12}>
          <Panel title="技能被动触发" kicker="skillPassiveTriggers">
            {curveResult ? <JsonBlock value={curveResult.skillPassiveTriggers} /> : <EmptyState title="还没有触发明细" description="运行后展示 wasm 返回的 skillPassiveTriggers。" />}
          </Panel>
        </Col>
        <Col span={12}>
          <Panel title="装备被动触发" kicker="itemPassiveTriggers">
            {curveResult ? <JsonBlock value={curveResult.itemPassiveTriggers} /> : <EmptyState title="还没有装备触发明细" description="运行后展示 wasm 返回的 itemPassiveTriggers。" />}
          </Panel>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="wasm-validation-grid">
        <Col span={24}>
          <Panel title="效果拆解" kicker="effectBreakdown">
            {curveResult ? <JsonBlock value={curveResult.effectBreakdown} /> : <EmptyState title="还没有效果拆解" description="运行后展示 wasm 返回的 effectBreakdown。" />}
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

function formatKillTime(result: V2DpsCurveResult | null): string {
  if (!result || result.killTimeMs == null) {
    return 'not killed';
  }
  return `${result.killTimeMs}ms`;
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
