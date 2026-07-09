import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Grid,
  Space,
  Table,
  Tag,
  Typography
} from '@arco-design/web-react';
import * as echarts from 'echarts';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import {
  GenericEngineClientError,
  getGenericEngineClient
} from '../engine/genericEngineClient';
import type {
  CompileRequest,
  CompileResult,
  DoneResult,
  EngineError,
  RunRequest
} from '../types/genericEngine';

const { Row, Col } = Grid;

const GENERIC_P0_BASIC_DAMAGE_FIXTURE = {
  name: 'generic_p0_basic_damage',
  compileRequest: {
    schemaVersion: 'generic-p0',
    schemaHash: 'schema.generic-p0.example',
    rulesHash: 'rules.generic_p0_basic_damage',
    typeCatalog: {
      types: [
        { key: 'ability/basic_attack', domain: 'ability' },
        { key: 'damage/physical', domain: 'damage' }
      ],
      relations: []
    },
    combatants: [
      {
        key: 'source',
        displayName: 'Source',
        types: [],
        tags: [],
        attributes: {
          attack_damage: { base: 100, current: 100, max: 100, resolved: 100 }
        },
        resources: {},
        providers: [{ providerRef: 'champion:source_demo', definitionRef: 'champion:source_demo' }]
      },
      {
        key: 'target',
        displayName: 'Target',
        types: [],
        tags: [],
        attributes: {
          hp: { base: 1000, current: 1000, max: 1000, resolved: 1000 }
        },
        resources: {},
        providers: []
      }
    ],
    sharedProviders: [
      {
        providerKey: 'champion:source_demo',
        kind: 'champion',
        stableId: 'source_demo',
        types: [],
        tags: [],
        abilities: [
          {
            abilityKey: 'basic_attack',
            kind: 'active',
            types: ['ability/basic_attack'],
            params: { baseDamage: 100 },
            operations: [
              {
                operation: 'damage',
                target: 'target',
                amount: { op: 'read', path: 'ability.param.baseDamage' },
                damageType: 'damage/physical'
              }
            ]
          }
        ]
      }
    ],
    rules: { operations: [], modifiers: [], listeners: [], triggerRules: [] },
    formulas: [],
    settings: {}
  } satisfies CompileRequest,
  runRequest: {
    expectedRulesHash: 'rules.generic_p0_basic_damage',
    initialSnapshot: {
      schemaHash: 'schema.generic-p0.example',
      rulesHash: 'rules.generic_p0_basic_damage',
      timeMs: 0,
      combatants: [
        {
          key: 'source',
          attributes: { attack_damage: { base: 100, current: 100, max: 100, resolved: 100 } },
          resources: {},
          cooldowns: {},
          providers: [
            {
              providerRef: 'champion:source_demo',
              definitionRef: 'champion:source_demo',
              stacks: 1,
              state: {}
            }
          ],
          shields: [],
          abilityState: {},
          providerState: {},
          vars: {}
        },
        {
          key: 'target',
          attributes: { hp: { base: 1000, current: 1000, max: 1000, resolved: 1000 } },
          resources: {},
          cooldowns: {},
          providers: [],
          shields: [],
          abilityState: {},
          providerState: {},
          vars: {}
        }
      ]
    },
    driverPlan: {
      conditionRecheckIntervalMs: 100,
      entries: [
        {
          entryKey: 'basic_attack_once',
          abilityRef: 'source.provider[champion:source_demo].ability[basic_attack]',
          source: 'source',
          target: 'target',
          priority: 0,
          firstAtMs: 0
        }
      ]
    },
    stopPolicy: { durationMs: 100, stopOnTargetDeath: true, stopWhenNoEvents: true },
    sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5000 }
  },
  expectedSummarySubset: {
    targetFinalHp: 900,
    abilityAttemptCount: 1,
    abilityCastCount: 1,
    attemptSkippedCount: 0
  }
};

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function buildHpChartOption(result: DoneResult | null): echarts.EChartsOption {
  if (!result?.series?.length) {
    return {
      title: { text: 'HP 时序', left: 'center', textStyle: { fontSize: 14 } },
      xAxis: { type: 'category', data: [] },
      yAxis: { type: 'value' },
      series: []
    };
  }

  const times = result.series.map((point) => String(point.timeMs));
  return {
    title: { text: 'HP 时序', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    legend: { data: ['sourceHp', 'targetHp'], top: 28 },
    grid: { left: 48, right: 24, top: 64, bottom: 32 },
    xAxis: { type: 'category', data: times, name: 'timeMs' },
    yAxis: { type: 'value', name: 'HP' },
    series: [
      {
        name: 'sourceHp',
        type: 'line',
        smooth: true,
        data: result.series.map((point) => point.sourceHp)
      },
      {
        name: 'targetHp',
        type: 'line',
        smooth: true,
        data: result.series.map((point) => point.targetHp)
      }
    ]
  };
}

export function WasmValidationGenericPage() {
  const clientRef = useRef(getGenericEngineClient());
  const chartElementRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [engineError, setEngineError] = useState<EngineError | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'compile' | 'run' | 'release' | null>(null);

  const compileRequest = GENERIC_P0_BASIC_DAMAGE_FIXTURE.compileRequest;
  const expected = GENERIC_P0_BASIC_DAMAGE_FIXTURE.expectedSummarySubset;

  const runRequest = useMemo<RunRequest | null>(() => {
    if (!sessionId) {
      return null;
    }
    return {
      sessionId,
      expectedRulesHash: GENERIC_P0_BASIC_DAMAGE_FIXTURE.runRequest.expectedRulesHash,
      initialSnapshot: GENERIC_P0_BASIC_DAMAGE_FIXTURE.runRequest.initialSnapshot,
      driverPlan: GENERIC_P0_BASIC_DAMAGE_FIXTURE.runRequest.driverPlan,
      stopPolicy: GENERIC_P0_BASIC_DAMAGE_FIXTURE.runRequest.stopPolicy,
      sampling: GENERIC_P0_BASIC_DAMAGE_FIXTURE.runRequest.sampling
    };
  }, [sessionId]);

  const targetHpMatches = doneResult?.summary.targetFinalHp === expected.targetFinalHp;

  useEffect(() => {
    if (!chartElementRef.current) {
      return;
    }
    const chart = chartRef.current ?? echarts.init(chartElementRef.current);
    chartRef.current = chart;
    chart.setOption(buildHpChartOption(doneResult), true);

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [doneResult]);

  useEffect(
    () => () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    },
    []
  );

  const handleCompile = useCallback(async () => {
    setBusyAction('compile');
    setEngineError(null);
    setStatusMessage(null);
    setDoneResult(null);
    setCompileResult(null);
    setSessionId(null);

    try {
      const result = await clientRef.current.compile(compileRequest);
      setCompileResult(result);
      setSessionId(result.sessionId ?? null);
      setStatusMessage(result.sessionId ? `Compile 成功，sessionId=${result.sessionId}` : 'Compile 成功');
    } catch (error) {
      if (error instanceof GenericEngineClientError) {
        setEngineError(error.engineError ?? null);
        setStatusMessage(error.message);
      } else {
        setStatusMessage(error instanceof Error ? error.message : 'Compile 失败');
      }
    } finally {
      setBusyAction(null);
    }
  }, [compileRequest]);

  const handleRun = useCallback(async () => {
    if (!runRequest) {
      setStatusMessage('请先 Compile 获取 sessionId');
      return;
    }

    setBusyAction('run');
    setEngineError(null);
    setStatusMessage(null);
    setDoneResult(null);

    try {
      const result = await clientRef.current.run(runRequest);
      setDoneResult(result);
      setStatusMessage('Run 成功');
    } catch (error) {
      if (error instanceof GenericEngineClientError) {
        setEngineError(error.engineError ?? null);
        setStatusMessage(error.message);
      } else {
        setStatusMessage(error instanceof Error ? error.message : 'Run 失败');
      }
    } finally {
      setBusyAction(null);
    }
  }, [runRequest]);

  const handleRelease = useCallback(async () => {
    if (!sessionId) {
      setStatusMessage('没有可释放的 sessionId');
      return;
    }

    setBusyAction('release');
    setEngineError(null);
    setStatusMessage(null);

    try {
      const result = await clientRef.current.release(sessionId, compileRequest.rulesHash);
      setSessionId(null);
      setCompileResult(null);
      setDoneResult(null);
      setStatusMessage(`Release 成功：${result.sessionId}`);
    } catch (error) {
      if (error instanceof GenericEngineClientError) {
        setEngineError(error.engineError ?? null);
        setStatusMessage(error.message);
      } else {
        setStatusMessage(error instanceof Error ? error.message : 'Release 失败');
      }
    } finally {
      setBusyAction(null);
    }
  }, [compileRequest.rulesHash, sessionId]);

  const seriesColumns = [
    { title: 'timeMs', dataIndex: 'timeMs' },
    { title: 'sourceHp', dataIndex: 'sourceHp', render: (value: number) => formatNumber(value) },
    { title: 'targetHp', dataIndex: 'targetHp', render: (value: number) => formatNumber(value) },
    { title: 'sourceDps', dataIndex: 'sourceCumulativeDps', render: (value: number) => formatNumber(value) },
    { title: 'targetDps', dataIndex: 'targetCumulativeDps', render: (value: number) => formatNumber(value) }
  ];

  const evidenceColumns = [
    { title: 'timeMs', dataIndex: 'timeMs', width: 100 },
    { title: 'kind', dataIndex: 'kind', width: 160 },
    { title: 'ref', dataIndex: 'ref', width: 220 },
    { title: 'message', dataIndex: 'message' }
  ];

  return (
    <div className="page-stack">
      <Panel
        title="Generic 引擎验证"
        kicker="目标 ABI compile / run / release"
        actions={
          <Space>
            <Button type="primary" loading={busyAction === 'compile'} onClick={() => void handleCompile()}>
              Compile
            </Button>
            <Button loading={busyAction === 'run'} disabled={!sessionId} onClick={() => void handleRun()}>
              Run
            </Button>
            <Button loading={busyAction === 'release'} disabled={!sessionId} onClick={() => void handleRelease()}>
              Release
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Typography.Text>
            Fixture：<Tag color="arcoblue">{GENERIC_P0_BASIC_DAMAGE_FIXTURE.name}</Tag>
            {' '}期望 targetFinalHp={expected.targetFinalHp}
          </Typography.Text>

          {statusMessage ? <Alert type="info" content={statusMessage} /> : null}
          {engineError ? (
            <Alert
              type="error"
              title={`${engineError.phase} / ${engineError.code}`}
              content={engineError.message}
            />
          ) : null}

          <Row gutter={16}>
            <Col span={6}>
              <MetricCard label="SessionId" value={sessionId ?? '--'} />
            </Col>
            <Col span={6}>
              <MetricCard
                label="targetFinalHp"
                value={formatNumber(doneResult?.summary.targetFinalHp)}
                hint={doneResult ? (targetHpMatches ? '符合 fixture 期望' : `期望 ${expected.targetFinalHp}`) : undefined}
              />
            </Col>
            <Col span={6}>
              <MetricCard label="abilityCastCount" value={formatNumber(doneResult?.summary.abilityCastCount)} />
            </Col>
            <Col span={6}>
              <MetricCard label="stopReason" value={doneResult?.summary.stopReason ?? '--'} />
            </Col>
          </Row>
        </Space>
      </Panel>

      {compileResult ? (
        <Panel title="Compile 结果">
          <JsonBlock value={compileResult} />
        </Panel>
      ) : null}

      {doneResult ? (
        <>
          <Panel title="Run Summary">
            <Row gutter={16}>
              <Col span={6}><MetricCard label="stopReason" value={doneResult.summary.stopReason} /></Col>
              <Col span={6}><MetricCard label="sourceFinalHp" value={formatNumber(doneResult.summary.sourceFinalHp)} /></Col>
              <Col span={6}><MetricCard label="targetFinalHp" value={formatNumber(doneResult.summary.targetFinalHp)} /></Col>
              <Col span={6}><MetricCard label="abilityAttemptCount" value={formatNumber(doneResult.summary.abilityAttemptCount)} /></Col>
              <Col span={6}><MetricCard label="abilityCastCount" value={formatNumber(doneResult.summary.abilityCastCount)} /></Col>
              <Col span={6}><MetricCard label="attemptSkippedCount" value={formatNumber(doneResult.summary.attemptSkippedCount)} /></Col>
              <Col span={6}><MetricCard label="durationMs" value={formatNumber(doneResult.summary.durationMs)} /></Col>
              <Col span={6}>
                <MetricCard
                  label="校验"
                  value={targetHpMatches ? 'PASS' : 'FAIL'}
                  hint={`期望 targetFinalHp=${expected.targetFinalHp}`}
                />
              </Col>
            </Row>
          </Panel>

          <Panel title="Series">
            <div ref={chartElementRef} style={{ width: '100%', height: 320, marginBottom: 16 }} />
            <Table
              rowKey={(record) => String(record.timeMs)}
              columns={seriesColumns}
              data={doneResult.series}
              pagination={{ pageSize: 10 }}
              size="small"
            />
          </Panel>

          <Panel title="Evidence">
            <Typography.Paragraph>
              truncated={String(doneResult.evidence.truncated)}，items={doneResult.evidence.items.length}
            </Typography.Paragraph>
            <Table
              rowKey={(record) => `${record.timeMs}-${record.kind}-${record.ref ?? ''}`}
              columns={evidenceColumns}
              data={doneResult.evidence.items}
              pagination={{ pageSize: 10 }}
              size="small"
            />
          </Panel>

          {doneResult.warnings.length ? (
            <Panel title="Warnings">
              <JsonBlock value={doneResult.warnings} />
            </Panel>
          ) : null}

          <Panel title="Final Snapshot 摘要">
            <JsonBlock value={doneResult.finalSnapshot} />
          </Panel>
        </>
      ) : null}

      <Panel title="Fixture 输入">
        <JsonBlock value={GENERIC_P0_BASIC_DAMAGE_FIXTURE} />
      </Panel>
    </div>
  );
}
