import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Grid,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography
} from '@arco-design/web-react';
import { IconRefresh } from '@arco-design/web-react/icon';
import * as echarts from 'echarts';
import { EmptyState } from '../components/EmptyState';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import {
  assembleGenericRunRequest,
  materializeGenericScenario,
  type MaterializedGenericScenario
} from '../engine/genericCatalogMaterializer';
import {
  GenericEngineClientError,
  getGenericEngineClient
} from '../engine/genericEngineClient';
import { getErrorMessage } from '../services/apiClient';
import {
  isWasmCatalogEmptyError,
  loadPublishedWasmCatalogSnapshot
} from '../services/wasmCatalogSnapshot';
import type {
  CompileResult,
  DoneResult,
  DriverEntry,
  DriverPlan,
  EngineError,
  SafetyBudget,
  SamplingConfig,
  SeriesPoint,
  StopPolicy
} from '../types/genericEngine';
import {
  DEFAULT_CONDITION_RECHECK_INTERVAL_MS,
  DEFAULT_SAMPLING,
  DEFAULT_STOP_POLICY
} from '../types/genericEngine';
import type {
  GenericAbilityOption,
  GenericScenarioOverrides,
  WasmCatalogV1
} from '../types/wasmCatalog';

const { Row, Col } = Grid;

type WasmValidationGenericPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
  externalRefreshSeed: number;
};

type CatalogLoadKind = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

type DriverEntryDraft = {
  entryKey: string;
  abilityRef: string;
  priority: number;
  firstAtMs: number;
  repeatIntervalMs?: number;
  repeatMaxAttempts?: number;
  whileReady: boolean;
};

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function buildSeriesChartOption(
  result: DoneResult | null,
  title: string,
  seriesDefs: Array<{ name: string; key: keyof SeriesPoint }>
): echarts.EChartsOption {
  if (!result?.series?.length) {
    return {
      title: { text: title, left: 'center', textStyle: { fontSize: 14 } },
      xAxis: { type: 'category', data: [] },
      yAxis: { type: 'value' },
      series: []
    };
  }
  const times = result.series.map((point) => String(point.timeMs));
  return {
    title: { text: title, left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    legend: { data: seriesDefs.map((item) => item.name), top: 28 },
    grid: { left: 48, right: 24, top: 64, bottom: 32 },
    xAxis: { type: 'category', data: times, name: '时间（毫秒）' },
    yAxis: { type: 'value' },
    series: seriesDefs.map((item) => ({
      name: item.name,
      type: 'line',
      smooth: true,
      data: result.series.map((point) => point[item.key] as number)
    }))
  };
}

function createDefaultDriverEntry(abilityRef = ''): DriverEntryDraft {
  return {
    entryKey: 'entry_0',
    abilityRef,
    priority: 0,
    firstAtMs: 0,
    whileReady: false
  };
}

export function WasmValidationGenericPage({
  apiBaseUrl,
  selectedGameId,
  selectedGameName,
  externalRefreshSeed
}: WasmValidationGenericPageProps) {
  const clientRef = useRef(getGenericEngineClient());
  const sessionIdRef = useRef<string | null>(null);
  const sessionRulesHashRef = useRef<string | null>(null);
  const hpChartRef = useRef<HTMLDivElement | null>(null);
  const damageChartRef = useRef<HTMLDivElement | null>(null);
  const dpsChartRef = useRef<HTMLDivElement | null>(null);
  const windowDpsChartRef = useRef<HTMLDivElement | null>(null);
  const chartsRef = useRef<echarts.ECharts[]>([]);

  const [catalogState, setCatalogState] = useState<CatalogLoadKind>('idle');
  const [catalog, setCatalog] = useState<WasmCatalogV1 | null>(null);
  const [versionCode, setVersionCode] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manualReloadSeed, setManualReloadSeed] = useState(0);

  const [sourceTemplateKey, setSourceTemplateKey] = useState<string>('');
  const [targetTemplateKey, setTargetTemplateKey] = useState<string>('');
  const [attributeOverridesJson, setAttributeOverridesJson] = useState('{"source":{},"target":{}}');
  const [resourceOverridesJson, setResourceOverridesJson] = useState('{"source":{},"target":{}}');
  const [driverEntry, setDriverEntry] = useState<DriverEntryDraft>(createDefaultDriverEntry());
  const [conditionRecheckIntervalMs, setConditionRecheckIntervalMs] = useState(
    DEFAULT_CONDITION_RECHECK_INTERVAL_MS
  );
  const [stopPolicy, setStopPolicy] = useState<StopPolicy>({ ...DEFAULT_STOP_POLICY });
  const [sampling, setSampling] = useState<SamplingConfig>({ ...DEFAULT_SAMPLING });
  const [safetyBudgetEnabled, setSafetyBudgetEnabled] = useState(false);
  const [safetyBudget, setSafetyBudget] = useState<SafetyBudget>({
    maxChainDepth: 32,
    maxCommandsPerEvent: 256,
    maxEvents: 100000
  });

  const [materialized, setMaterialized] = useState<MaterializedGenericScenario | null>(null);
  const [materializeError, setMaterializeError] = useState<string | null>(null);
  const [availableAbilities, setAvailableAbilities] = useState<GenericAbilityOption[]>([]);

  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionSignature, setSessionSignature] = useState<string | null>(null);
  const [sessionRulesHash, setSessionRulesHash] = useState<string | null>(null);
  const [engineError, setEngineError] = useState<EngineError | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'compile' | 'run' | 'release' | null>(null);

  sessionIdRef.current = sessionId;
  sessionRulesHashRef.current = sessionRulesHash;

  const clearSessionState = useCallback(() => {
    setCompileResult(null);
    setDoneResult(null);
    setSessionId(null);
    setSessionSignature(null);
    setSessionRulesHash(null);
    setEngineError(null);
  }, []);

  const releaseSessionQuietly = useCallback(async () => {
    const currentSessionId = sessionIdRef.current;
    const rulesHash = sessionRulesHashRef.current;
    if (!currentSessionId) {
      clearSessionState();
      return;
    }
    try {
      await clientRef.current.release(currentSessionId, rulesHash ?? undefined);
    } catch {
      // release failure still invalidates local session
    } finally {
      clearSessionState();
    }
  }, [clearSessionState]);

  const reloadCatalog = useCallback(async () => {
    await releaseSessionQuietly();
    setMaterialized(null);
    setMaterializeError(null);
    setAvailableAbilities([]);
    setStatusMessage(null);
    setLoadError(null);

    if (!selectedGameId) {
      setCatalog(null);
      setVersionCode(null);
      setCatalogState('idle');
      return;
    }

    setCatalogState('loading');
    try {
      const snapshot = await loadPublishedWasmCatalogSnapshot(apiBaseUrl, selectedGameId);
      setCatalog(snapshot.catalog);
      setVersionCode(snapshot.currentVersion.versionCode);
      setCatalogState('ready');

      const templates = snapshot.catalog.combatantTemplates;
      const firstKey = templates[0]?.templateKey ?? '';
      const secondKey = templates[1]?.templateKey ?? firstKey;
      setSourceTemplateKey(firstKey);
      setTargetTemplateKey(secondKey);
    } catch (error) {
      setCatalog(null);
      if (isWasmCatalogEmptyError(error)) {
        setVersionCode(String(error.details.versionCode));
        setCatalogState('empty');
        setLoadError(error.message);
        return;
      }
      setVersionCode(null);
      setCatalogState('error');
      setLoadError(getErrorMessage(error));
    }
  }, [apiBaseUrl, releaseSessionQuietly, selectedGameId]);

  useEffect(() => {
    void reloadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- release before reload on seed/api/game change
  }, [apiBaseUrl, selectedGameId, externalRefreshSeed, manualReloadSeed]);

  useEffect(
    () => () => {
      void (async () => {
        const currentSessionId = sessionIdRef.current;
        const rulesHash = sessionRulesHashRef.current;
        if (currentSessionId) {
          try {
            await clientRef.current.release(currentSessionId, rulesHash ?? undefined);
          } catch {
            // ignore unload release errors
          }
        }
        clientRef.current.terminate();
      })();
      chartsRef.current.forEach((chart) => chart.dispose());
      chartsRef.current = [];
    },
    []
  );

  const rematerialize = useCallback(async () => {
    if (!catalog || !sourceTemplateKey || !targetTemplateKey) {
      setMaterialized(null);
      setAvailableAbilities([]);
      return;
    }

    await releaseSessionQuietly();
    setDoneResult(null);
    setStatusMessage(null);

    let normalized: GenericScenarioOverrides;
    try {
      normalized = {
        source: {
          attributes: normalizeAttrMap(attributeOverridesJson, 'source'),
          resources: normalizeResMap(resourceOverridesJson, 'source')
        },
        target: {
          attributes: normalizeAttrMap(attributeOverridesJson, 'target'),
          resources: normalizeResMap(resourceOverridesJson, 'target')
        }
      };
    } catch (error) {
      setMaterialized(null);
      setMaterializeError(error instanceof Error ? error.message : '覆盖配置 JSON 解析失败');
      return;
    }

    try {
      const next = materializeGenericScenario(
        catalog,
        { sourceTemplateKey, targetTemplateKey },
        normalized
      );
      setMaterialized(next);
      setAvailableAbilities(next.availableSourceAbilities);
      setMaterializeError(null);

      const selectable = next.availableSourceAbilities.filter((item) => item.selectable);
      setDriverEntry((prev) => {
        if (selectable.some((item) => item.abilityRef === prev.abilityRef)) {
          return prev;
        }
        return {
          ...prev,
          abilityRef: selectable[0]?.abilityRef ?? ''
        };
      });
    } catch (error) {
      setMaterialized(null);
      setAvailableAbilities([]);
      setMaterializeError(error instanceof Error ? error.message : '物化失败');
    }
  }, [
    attributeOverridesJson,
    catalog,
    releaseSessionQuietly,
    resourceOverridesJson,
    sourceTemplateKey,
    targetTemplateKey
  ]);

  useEffect(() => {
    void rematerialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    catalog,
    sourceTemplateKey,
    targetTemplateKey,
    attributeOverridesJson,
    resourceOverridesJson
  ]);

  useEffect(() => {
    void releaseSessionQuietly();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverEntry, conditionRecheckIntervalMs, stopPolicy, sampling, safetyBudgetEnabled, safetyBudget]);

  useEffect(() => {
    const bindings: Array<{ el: HTMLDivElement | null; option: echarts.EChartsOption }> = [
      {
        el: hpChartRef.current,
        option: buildSeriesChartOption(doneResult, '生命值', [
          { name: '攻击方生命值', key: 'sourceHp' },
          { name: '目标生命值', key: 'targetHp' }
        ])
      },
      {
        el: damageChartRef.current,
        option: buildSeriesChartOption(doneResult, '累计伤害', [
          { name: '攻击方造成伤害', key: 'sourceDamageDealt' },
          { name: '目标造成伤害', key: 'targetDamageDealt' }
        ])
      },
      {
        el: dpsChartRef.current,
        option: buildSeriesChartOption(doneResult, '累计 DPS', [
          { name: '攻击方累计 DPS', key: 'sourceCumulativeDps' },
          { name: '目标累计 DPS', key: 'targetCumulativeDps' }
        ])
      },
      {
        el: windowDpsChartRef.current,
        option: buildSeriesChartOption(doneResult, '窗口 DPS', [
          { name: '攻击方窗口 DPS', key: 'sourceWindowDps' },
          { name: '目标窗口 DPS', key: 'targetWindowDps' }
        ])
      }
    ];

    chartsRef.current.forEach((chart) => chart.dispose());
    chartsRef.current = [];
    for (const binding of bindings) {
      if (!binding.el) {
        continue;
      }
      const chart = echarts.init(binding.el);
      chart.setOption(binding.option, true);
      chartsRef.current.push(chart);
    }

    const handleResize = () => chartsRef.current.forEach((chart) => chart.resize());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [doneResult]);

  const selectableAbilities = useMemo(
    () => availableAbilities.filter((item) => item.selectable),
    [availableAbilities]
  );

  const buildDriverPlan = useCallback((): DriverPlan | null => {
    if (!driverEntry.abilityRef) {
      setStatusMessage('请选择已挂载的主动技能');
      return null;
    }
    if (!selectableAbilities.some((item) => item.abilityRef === driverEntry.abilityRef)) {
      setStatusMessage('驱动计划只能选择攻击方（source）已挂载的主动技能');
      return null;
    }

    const entry: DriverEntry = {
      entryKey: driverEntry.entryKey || 'entry_0',
      abilityRef: driverEntry.abilityRef,
      source: 'source',
      target: 'target',
      priority: driverEntry.priority,
      firstAtMs: driverEntry.firstAtMs
    };
    if (driverEntry.repeatIntervalMs !== undefined && Number.isFinite(driverEntry.repeatIntervalMs)) {
      entry.repeat = {
        intervalMs: driverEntry.repeatIntervalMs,
        ...(driverEntry.repeatMaxAttempts !== undefined
          ? { maxAttempts: driverEntry.repeatMaxAttempts }
          : {})
      };
    }
    if (driverEntry.whileReady) {
      entry.whileReady = true;
    }

    return {
      conditionRecheckIntervalMs,
      entries: [entry]
    };
  }, [conditionRecheckIntervalMs, driverEntry, selectableAbilities]);

  const handleCompile = useCallback(async () => {
    if (!catalog || !materialized) {
      setStatusMessage('请先加载目录并完成物化');
      return;
    }

    setBusyAction('compile');
    setEngineError(null);
    setStatusMessage(null);
    setDoneResult(null);

    try {
      await releaseSessionQuietly();
      const result = await clientRef.current.compile(materialized.compileRequest);
      setCompileResult(result);
      if (!result.ok) {
        setSessionId(null);
        setSessionSignature(null);
        setSessionRulesHash(null);
        setStatusMessage(`编译失败：${result.errors?.length ?? 0} 个错误`);
        return;
      }
      setSessionId(result.sessionId ?? null);
      setSessionSignature(materialized.sessionSignature);
      setSessionRulesHash(result.rulesHash ?? catalog.meta.rulesHash);
      setStatusMessage(result.sessionId ? `编译成功，会话 ID（sessionId）=${result.sessionId}` : '编译成功');
    } catch (error) {
      if (error instanceof GenericEngineClientError) {
        setEngineError(error.engineError ?? null);
        setStatusMessage(error.message);
      } else {
        setStatusMessage(error instanceof Error ? error.message : '编译失败');
      }
    } finally {
      setBusyAction(null);
    }
  }, [catalog, materialized, releaseSessionQuietly]);

  const handleRun = useCallback(async () => {
    if (!catalog || !materialized || !sessionId) {
      setStatusMessage('请先编译以获取会话 ID（sessionId）');
      return;
    }
    const driverPlan = buildDriverPlan();
    if (!driverPlan) {
      return;
    }

    setBusyAction('run');
    setEngineError(null);
    setStatusMessage(null);
    setDoneResult(null);

    try {
      const runRequest = assembleGenericRunRequest({
        sessionId,
        catalog,
        materialized,
        driverPlan,
        stopPolicy,
        sampling,
        safetyBudget: safetyBudgetEnabled ? safetyBudget : undefined
      });
      const result = await clientRef.current.run(runRequest);
      setDoneResult(result);
      setStatusMessage(`运行成功：${result.summary.stopReason}`);
    } catch (error) {
      if (error instanceof GenericEngineClientError) {
        setEngineError(error.engineError ?? null);
        setStatusMessage(error.message);
        if (error.message.includes('运行超时')) {
          clearSessionState();
        }
      } else {
        setStatusMessage(error instanceof Error ? error.message : '运行失败');
      }
    } finally {
      setBusyAction(null);
    }
  }, [
    buildDriverPlan,
    catalog,
    clearSessionState,
    materialized,
    safetyBudget,
    safetyBudgetEnabled,
    sampling,
    sessionId,
    stopPolicy
  ]);

  const handleRelease = useCallback(async () => {
    if (!sessionId) {
      setStatusMessage('没有可释放的会话 ID（sessionId）');
      return;
    }
    setBusyAction('release');
    setEngineError(null);
    setStatusMessage(null);
    try {
      const result = await clientRef.current.release(sessionId, sessionRulesHash ?? undefined);
      clearSessionState();
      setStatusMessage(`释放成功：${result.sessionId}`);
    } catch (error) {
      clearSessionState();
      if (error instanceof GenericEngineClientError) {
        setEngineError(error.engineError ?? null);
        setStatusMessage(error.message);
      } else {
        setStatusMessage(error instanceof Error ? error.message : '释放失败');
      }
    } finally {
      setBusyAction(null);
    }
  }, [clearSessionState, sessionId, sessionRulesHash]);

  const canCompile = catalogState === 'ready' && !!materialized && !materializeError && busyAction === null;
  const canRun = !!sessionId && !!compileResult?.ok && busyAction === null;

  if (!selectedGameId) {
    return <EmptyState title="请先选择游戏" description="通用 Wasm 目录验证需要已选择的游戏与当前发布版本。" />;
  }

  if (catalogState === 'loading' || catalogState === 'idle') {
    return <EmptyState title="正在加载通用 Wasm 目录…" description={`${selectedGameName} / ${selectedGameId}`} />;
  }

  if (catalogState === 'empty') {
    return (
      <div className="page-stack">
        <Panel
          title="通用引擎验证"
          kicker="WasmCatalogV1"
          actions={
            <Button icon={<IconRefresh />} onClick={() => setManualReloadSeed((value) => value + 1)}>
              重新加载
            </Button>
          }
        >
          <Alert
            type="warning"
            title="该发布版本尚未配置通用 Wasm 目录"
            content={`游戏 ID（gameId）=${selectedGameId}，版本号（versionCode）=${versionCode ?? '--'}。编译/运行已禁用。`}
          />
        </Panel>
      </div>
    );
  }

  if (catalogState === 'error') {
    return (
      <div className="page-stack">
        <Panel
          title="通用引擎验证"
          actions={
            <Button icon={<IconRefresh />} onClick={() => setManualReloadSeed((value) => value + 1)}>
              重新加载
            </Button>
          }
        >
          <Alert type="error" title="目录读取失败" content={loadError ?? '未知错误'} />
        </Panel>
      </div>
    );
  }

  const seriesColumns = [
    { title: '时间（毫秒）', dataIndex: 'timeMs' },
    { title: '攻击方生命值', dataIndex: 'sourceHp', render: (value: number) => formatNumber(value) },
    { title: '目标生命值', dataIndex: 'targetHp', render: (value: number) => formatNumber(value) },
    { title: '攻击方造成伤害', dataIndex: 'sourceDamageDealt', render: (value: number) => formatNumber(value) },
    { title: '目标造成伤害', dataIndex: 'targetDamageDealt', render: (value: number) => formatNumber(value) },
    { title: '攻击方累计 DPS', dataIndex: 'sourceCumulativeDps', render: (value: number) => formatNumber(value) },
    { title: '目标累计 DPS', dataIndex: 'targetCumulativeDps', render: (value: number) => formatNumber(value) },
    { title: '攻击方窗口 DPS', dataIndex: 'sourceWindowDps', render: (value: number) => formatNumber(value) },
    { title: '目标窗口 DPS', dataIndex: 'targetWindowDps', render: (value: number) => formatNumber(value) }
  ];

  const evidenceColumns = [
    { title: '时间（毫秒）', dataIndex: 'timeMs', width: 100 },
    { title: '类型', dataIndex: 'kind', width: 160 },
    { title: '引用', dataIndex: 'ref', width: 220 },
    { title: '路径', dataIndex: 'path', width: 180 },
    { title: '说明', dataIndex: 'message' },
    {
      title: '附加数据',
      dataIndex: 'data',
      render: (value: Record<string, unknown> | undefined) => (value ? JSON.stringify(value) : '--')
    }
  ];

  const compileErrorColumns = [
    { title: '错误码', dataIndex: 'code', width: 160 },
    { title: '路径', dataIndex: 'path', width: 200 },
    { title: '引用', dataIndex: 'ref', width: 200 },
    { title: '说明', dataIndex: 'message' }
  ];

  return (
    <div className="page-stack">
      <Panel
        title="通用引擎验证"
        kicker="当前版本 → 通用目录 → 物化 → 编译 / 运行 / 释放"
        actions={
          <Space>
            <Button icon={<IconRefresh />} onClick={() => setManualReloadSeed((value) => value + 1)}>
              重新加载目录
            </Button>
            <Button type="primary" loading={busyAction === 'compile'} disabled={!canCompile} onClick={() => void handleCompile()}>
              编译
            </Button>
            <Button loading={busyAction === 'run'} disabled={!canRun} onClick={() => void handleRun()}>
              运行
            </Button>
            <Button loading={busyAction === 'release'} disabled={!sessionId} onClick={() => void handleRelease()}>
              释放
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Typography.Text>
            游戏 <Tag color="arcoblue">{selectedGameName}</Tag>
            {' '}版本 <Tag>{versionCode}</Tag>
            {' '}协议版本 <Tag>{catalog?.meta.schemaVersion}</Tag>
            {' '}规则哈希（rulesHash） <Tag>{catalog?.meta.rulesHash}</Tag>
          </Typography.Text>

          {statusMessage ? <Alert type="info" content={statusMessage} /> : null}
          {materializeError ? <Alert type="error" title="物化错误" content={materializeError} /> : null}
          {engineError ? (
            <Alert
              type="error"
              title={`${engineError.phase} / ${engineError.code}`}
              content={`${engineError.message}${engineError.path ? ` @ ${engineError.path}` : ''}${engineError.ref ? ` 引用=${engineError.ref}` : ''}`}
            />
          ) : null}

          <Row gutter={16}>
            <Col span={6}><MetricCard label="会话 ID（sessionId）" value={sessionId ?? '--'} /></Col>
            <Col span={6}><MetricCard label="会话签名" value={sessionSignature ? `${sessionSignature.slice(0, 18)}…` : '--'} /></Col>
            <Col span={6}><MetricCard label="停止原因" value={doneResult?.summary.stopReason ?? '--'} /></Col>
            <Col span={6}><MetricCard label="警告数量" value={formatNumber(doneResult?.summary.warningCount)} /></Col>
          </Row>
        </Space>
      </Panel>

      <Panel title="目录 / 模板选择">
        <Form layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="攻击方模板（source）">
                <Select
                  value={sourceTemplateKey}
                  onChange={setSourceTemplateKey}
                  options={(catalog?.combatantTemplates ?? []).map((item) => ({
                    label: item.displayName ? `${item.templateKey} (${item.displayName})` : item.templateKey,
                    value: item.templateKey
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="目标模板（target）">
                <Select
                  value={targetTemplateKey}
                  onChange={setTargetTemplateKey}
                  options={(catalog?.combatantTemplates ?? []).map((item) => ({
                    label: item.displayName ? `${item.templateKey} (${item.displayName})` : item.templateKey,
                    value: item.templateKey
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="属性覆盖 JSON"
                extra='形状：{"source":{"ad":{"base":1,"current":1,"max":1}},"target":{...}}；提交时 resolved=current'
              >
                <Input.TextArea
                  autoSize={{ minRows: 4, maxRows: 10 }}
                  value={attributeOverridesJson}
                  onChange={setAttributeOverridesJson}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="资源覆盖 JSON"
                extra='形状：{"source":{"mana":{"current":50,"max":100}},"target":{...}}'
              >
                <Input.TextArea
                  autoSize={{ minRows: 4, maxRows: 10 }}
                  value={resourceOverridesJson}
                  onChange={setResourceOverridesJson}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Panel>

      <Panel title="驱动计划 / 停止条件 / 采样">
        <Form layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="主动技能（仅攻击方已挂载的主动技能）">
                <Select
                  value={driverEntry.abilityRef || undefined}
                  placeholder="选择技能"
                  onChange={(value) => setDriverEntry((prev) => ({ ...prev, abilityRef: value }))}
                  options={selectableAbilities.map((item) => ({
                    label: item.displayName,
                    value: item.abilityRef
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="条目键（entryKey）">
                <Input
                  value={driverEntry.entryKey}
                  onChange={(value) => setDriverEntry((prev) => ({ ...prev, entryKey: value }))}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="条件复查间隔（毫秒）">
                <InputNumber
                  min={10}
                  max={1000}
                  value={conditionRecheckIntervalMs}
                  onChange={(value) => setConditionRecheckIntervalMs(Number(value) || DEFAULT_CONDITION_RECHECK_INTERVAL_MS)}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item label="首次触发时间（毫秒）">
                <InputNumber
                  min={0}
                  value={driverEntry.firstAtMs}
                  onChange={(value) => setDriverEntry((prev) => ({ ...prev, firstAtMs: Number(value) || 0 }))}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="优先级">
                <InputNumber
                  value={driverEntry.priority}
                  onChange={(value) => setDriverEntry((prev) => ({ ...prev, priority: Number(value) || 0 }))}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="重复间隔（毫秒，可选）">
                <InputNumber
                  min={1}
                  value={driverEntry.repeatIntervalMs}
                  onChange={(value) =>
                    setDriverEntry((prev) => ({
                      ...prev,
                      repeatIntervalMs: value === undefined || value === null ? undefined : Number(value)
                    }))
                  }
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="最大重复次数（可选）">
                <InputNumber
                  min={1}
                  value={driverEntry.repeatMaxAttempts}
                  onChange={(value) =>
                    setDriverEntry((prev) => ({
                      ...prev,
                      repeatMaxAttempts: value === undefined || value === null ? undefined : Number(value)
                    }))
                  }
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item label="就绪即施放（whileReady）">
                <Switch
                  checked={driverEntry.whileReady}
                  onChange={(checked) => setDriverEntry((prev) => ({ ...prev, whileReady: checked }))}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="持续时长（毫秒）">
                <InputNumber
                  min={1}
                  value={stopPolicy.durationMs}
                  onChange={(value) =>
                    setStopPolicy((prev) => ({ ...prev, durationMs: Number(value) || DEFAULT_STOP_POLICY.durationMs }))
                  }
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="目标死亡即停止">
                <Switch
                  checked={stopPolicy.stopOnTargetDeath}
                  onChange={(checked) => setStopPolicy((prev) => ({ ...prev, stopOnTargetDeath: checked }))}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="无事件即停止">
                <Switch
                  checked={stopPolicy.stopWhenNoEvents}
                  onChange={(checked) => setStopPolicy((prev) => ({ ...prev, stopWhenNoEvents: checked }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item label="采样间隔（毫秒）">
                <InputNumber
                  min={1}
                  value={sampling.sampleEveryMs}
                  onChange={(value) =>
                    setSampling((prev) => ({ ...prev, sampleEveryMs: Number(value) || DEFAULT_SAMPLING.sampleEveryMs }))
                  }
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="DPS 窗口（毫秒）">
                <InputNumber
                  min={1}
                  value={sampling.dpsWindowMs}
                  onChange={(value) =>
                    setSampling((prev) => ({ ...prev, dpsWindowMs: Number(value) || DEFAULT_SAMPLING.dpsWindowMs }))
                  }
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="最大序列点数">
                <InputNumber
                  min={1}
                  value={sampling.maxSeriesPoints}
                  onChange={(value) =>
                    setSampling((prev) => ({
                      ...prev,
                      maxSeriesPoints: Number(value) || DEFAULT_SAMPLING.maxSeriesPoints
                    }))
                  }
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="写入安全预算">
                <Switch checked={safetyBudgetEnabled} onChange={setSafetyBudgetEnabled} />
              </Form.Item>
            </Col>
          </Row>
          {safetyBudgetEnabled ? (
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item label="最大链路深度">
                  <InputNumber
                    min={1}
                    value={safetyBudget.maxChainDepth}
                    onChange={(value) =>
                      setSafetyBudget((prev) => ({ ...prev, maxChainDepth: Number(value) || 32 }))
                    }
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="每事件最大命令数">
                  <InputNumber
                    min={1}
                    value={safetyBudget.maxCommandsPerEvent}
                    onChange={(value) =>
                      setSafetyBudget((prev) => ({ ...prev, maxCommandsPerEvent: Number(value) || 256 }))
                    }
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="最大事件数">
                  <InputNumber
                    min={1}
                    value={safetyBudget.maxEvents}
                    onChange={(value) =>
                      setSafetyBudget((prev) => ({ ...prev, maxEvents: Number(value) || 100000 }))
                    }
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : null}
          <Typography.Text type="secondary">
            引擎内部默认只读：最大证据条数=1000，最大警告数=100（不写入请求 JSON）
          </Typography.Text>
          {availableAbilities.some((item) => !item.selectable) ? (
            <Alert
              type="info"
              content={`非主动技能仅展示说明，不可写入驱动计划：${availableAbilities
                .filter((item) => !item.selectable)
                .map((item) => item.displayName)
                .join(', ')}`}
            />
          ) : null}
        </Form>
      </Panel>

      {compileResult ? (
        <Panel title="编译结果">
          <Row gutter={16} style={{ marginBottom: 12 }}>
            <Col span={6}><MetricCard label="是否成功" value={String(compileResult.ok)} /></Col>
            <Col span={6}><MetricCard label="会话 ID（sessionId）" value={compileResult.sessionId ?? '--'} /></Col>
            <Col span={6}><MetricCard label="规则哈希（rulesHash）" value={compileResult.rulesHash ?? '--'} /></Col>
            <Col span={6}>
              <MetricCard
                label="元数据"
                value={
                  compileResult.metadata
                    ? `${compileResult.metadata.combatantCount} 战斗单位 / ${compileResult.metadata.providerCount} 提供者`
                    : '--'
                }
              />
            </Col>
          </Row>
          {!compileResult.ok && compileResult.errors?.length ? (
            <Table
              rowKey={(record) => `${record.code}-${record.path ?? ''}-${record.ref ?? ''}-${record.message}`}
              columns={compileErrorColumns}
              data={compileResult.errors}
              pagination={false}
              size="small"
            />
          ) : (
            <JsonBlock value={compileResult} />
          )}
        </Panel>
      ) : null}

      {doneResult ? (
        <>
          <Panel title="运行摘要">
            <Row gutter={16}>
              <Col span={6}><MetricCard label="攻击方最终生命值" value={formatNumber(doneResult.summary.sourceFinalHp)} /></Col>
              <Col span={6}><MetricCard label="目标最终生命值" value={formatNumber(doneResult.summary.targetFinalHp)} /></Col>
              <Col span={6}><MetricCard label="攻击方造成伤害" value={formatNumber(doneResult.summary.sourceDamageDealt)} /></Col>
              <Col span={6}><MetricCard label="目标造成伤害" value={formatNumber(doneResult.summary.targetDamageDealt)} /></Col>
              <Col span={6}><MetricCard label="攻击方承受伤害" value={formatNumber(doneResult.summary.sourceDamageTaken)} /></Col>
              <Col span={6}><MetricCard label="目标承受伤害" value={formatNumber(doneResult.summary.targetDamageTaken)} /></Col>
              <Col span={6}><MetricCard label="技能尝试次数" value={formatNumber(doneResult.summary.abilityAttemptCount)} /></Col>
              <Col span={6}><MetricCard label="技能施放次数" value={formatNumber(doneResult.summary.abilityCastCount)} /></Col>
              <Col span={6}><MetricCard label="跳过尝试次数" value={formatNumber(doneResult.summary.attemptSkippedCount)} /></Col>
              <Col span={6}><MetricCard label="持续时长（毫秒）" value={formatNumber(doneResult.summary.durationMs)} /></Col>
              <Col span={6}><MetricCard label="证据已截断" value={String(doneResult.summary.evidenceTruncated)} /></Col>
              <Col span={6}><MetricCard label="序列已降采样" value={String(doneResult.summary.seriesDownsampled)} /></Col>
            </Row>
            {doneResult.summary.abilityStats?.length ? (
              <JsonBlock value={doneResult.summary.abilityStats} />
            ) : null}
          </Panel>

          <Panel title="序列图表">
            <Row gutter={16}>
              <Col span={12}><div ref={hpChartRef} style={{ width: '100%', height: 280 }} /></Col>
              <Col span={12}><div ref={damageChartRef} style={{ width: '100%', height: 280 }} /></Col>
              <Col span={12}><div ref={dpsChartRef} style={{ width: '100%', height: 280 }} /></Col>
              <Col span={12}><div ref={windowDpsChartRef} style={{ width: '100%', height: 280 }} /></Col>
            </Row>
            <Table
              rowKey={(record) => String(record.timeMs)}
              columns={seriesColumns}
              data={doneResult.series}
              pagination={{ pageSize: 10 }}
              size="small"
              style={{ marginTop: 16 }}
            />
          </Panel>

          <Panel title="证据">
            <Typography.Paragraph>
              已截断={String(doneResult.evidence.truncated)}，
              截断证据数={doneResult.evidence.truncatedEvidenceCount}，
              条目数={doneResult.evidence.items.length}
            </Typography.Paragraph>
            <JsonBlock value={doneResult.evidence.countsByKind} />
            <Table
              rowKey={(record) => `${record.timeMs}-${record.kind}-${record.ref ?? ''}-${record.path ?? ''}`}
              columns={evidenceColumns}
              data={doneResult.evidence.items}
              pagination={{ pageSize: 10 }}
              size="small"
            />
          </Panel>

          {doneResult.warnings.length ? (
            <Panel title="警告">
              <JsonBlock value={doneResult.warnings} />
            </Panel>
          ) : null}

          <Panel title="序列采样证据">
            <JsonBlock value={doneResult.seriesSamplingEvidence} />
          </Panel>
        </>
      ) : null}

      {materialized ? (
        <Panel title="物化后的编译请求（CompileRequest）/ 初始快照（InitialSnapshot）">
          <JsonBlock
            value={{
              sessionSignature: materialized.sessionSignature,
              compileRequest: materialized.compileRequest,
              initialSnapshot: materialized.initialSnapshot,
              availableSourceAbilities: materialized.availableSourceAbilities
            }}
          />
        </Panel>
      ) : null}
    </div>
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertOptionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} 必须是有限数字`);
  }
  return value;
}

function normalizeAttrMap(
  rawJson: string,
  slot: 'source' | 'target'
): Record<string, { base?: number; current?: number; max?: number }> | undefined {
  const root = JSON.parse(rawJson) as unknown;
  if (!isPlainObject(root)) {
    throw new Error('属性覆盖 JSON 必须是对象');
  }
  if (!(slot in root)) {
    return undefined;
  }
  const slotValue = root[slot];
  if (!isPlainObject(slotValue)) {
    throw new Error(`属性覆盖.${slot} 必须是对象`);
  }
  const record = slotValue;
  let entries: Record<string, unknown>;
  if ('attributes' in record) {
    if (!isPlainObject(record.attributes)) {
      throw new Error(`属性覆盖.${slot}.attributes 必须是对象`);
    }
    entries = record.attributes;
  } else {
    const keys = Object.keys(record);
    if (keys.length === 0) {
      return undefined;
    }
    entries = record;
  }

  const normalized: Record<string, { base?: number; current?: number; max?: number }> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (!isPlainObject(value)) {
      throw new Error(`属性覆盖 ${slot}.${key} 必须是对象`);
    }
    normalized[key] = {
      base: assertOptionalFiniteNumber(value.base, `attribute.${key}.base`),
      current: assertOptionalFiniteNumber(value.current, `attribute.${key}.current`),
      max: assertOptionalFiniteNumber(value.max, `attribute.${key}.max`)
    };
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeResMap(
  rawJson: string,
  slot: 'source' | 'target'
): Record<string, { current?: number; max?: number }> | undefined {
  const root = JSON.parse(rawJson) as unknown;
  if (!isPlainObject(root)) {
    throw new Error('资源覆盖 JSON 必须是对象');
  }
  if (!(slot in root)) {
    return undefined;
  }
  const slotValue = root[slot];
  if (!isPlainObject(slotValue)) {
    throw new Error(`资源覆盖.${slot} 必须是对象`);
  }
  const record = slotValue;
  let entries: Record<string, unknown>;
  if ('resources' in record) {
    if (!isPlainObject(record.resources)) {
      throw new Error(`资源覆盖.${slot}.resources 必须是对象`);
    }
    entries = record.resources;
  } else {
    const keys = Object.keys(record);
    if (keys.length === 0) {
      return undefined;
    }
    entries = record;
  }

  const normalized: Record<string, { current?: number; max?: number }> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (!isPlainObject(value)) {
      throw new Error(`资源覆盖 ${slot}.${key} 必须是对象`);
    }
    normalized[key] = {
      current: assertOptionalFiniteNumber(value.current, `resource.${key}.current`),
      max: assertOptionalFiniteNumber(value.max, `resource.${key}.max`)
    };
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}
