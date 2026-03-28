import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Grid, Space, Table, Typography } from '@arco-design/web-react';
import { DataTable } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import { MvpEngineClient } from '../engine/client';
import type { EngineDamageComponent, EngineDamageEvent, EngineRunInput, EngineRunOutput } from '../engine/types';
import { getErrorMessage } from '../services/apiClient';
import { loadPublishedBundleSnapshot } from '../services/bundleSnapshot';
import type { CurrentVersion, GameDataBundle, LoadState } from '../types/api';

type KatarinaMvpPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
  externalRefreshSeed?: number;
};

const { Row, Col } = Grid;

type ScenarioDefinition = {
  id: 's0_basic_attack_10' | 's1_full_r';
  title: string;
  summary: string;
  buildInput: (itemIds: string[]) => EngineRunInput;
};

type DamageEventRow = {
  key: string;
  sequence: number;
  tMs: number;
  label: string;
  totalRawDamage: number;
  totalDealtDamage: number;
  enemyHpBefore: number;
  enemyHpAfter: number;
  components: EngineDamageComponent[];
};

type DamageComponentRow = EngineDamageComponent & {
  key: string;
};

const KATARINA_ID = 'hero_katarina';
const DUMMY_ID = 'hero_dummy_10000hp_100ar_100mr';
const BASIC_ATTACK_SKILL_ID = 'skill_katarina_basic_attack';
const DEATH_LOTUS_SKILL_ID = 'skill_katarina_r';
const ITEM_IDS = ['item_blade_of_the_ruined_king', 'item_nashors_tooth'] as const;

const scenarios: ScenarioDefinition[] = [
  {
    id: 's0_basic_attack_10',
    title: 'S0 平A 10 下',
    summary: '卡特对训练假人连续普攻 10 次。',
    buildInput: (itemIds) => ({
      stop: { maxSeconds: 10 },
      initial: {
        self: { heroId: KATARINA_ID, level: 18, itemIds },
        enemy: { heroId: DUMMY_ID, level: 1 }
      },
      plan: {
        type: 'basic_attack',
        count: 10,
        skillId: BASIC_ATTACK_SKILL_ID
      }
    })
  },
  {
    id: 's1_full_r',
    title: 'S1 完整 R',
    summary: '卡特释放一次完整死亡莲华。',
    buildInput: (itemIds) => ({
      stop: { maxSeconds: 10 },
      initial: {
        self: { heroId: KATARINA_ID, level: 18, itemIds },
        enemy: { heroId: DUMMY_ID, level: 1 }
      },
      plan: {
        type: 'cast_skill',
        skillId: DEATH_LOTUS_SKILL_ID,
        skillLevel: 3
      }
    })
  }
];

function formatDate(value?: string | null): string {
  if (!value) {
    return '--';
  }

  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatNumber(value: number | undefined, digits = 2): string {
  if (value === undefined || Number.isNaN(value)) {
    return '--';
  }

  return value.toFixed(digits);
}

function formatDamageType(value: 'physical' | 'magic' | 'true'): string {
  if (value === 'physical') {
    return '物理';
  }
  if (value === 'magic') {
    return '魔法';
  }
  return '真实';
}

function formatDamageSourceKind(value: EngineDamageComponent['sourceKind']): string {
  if (value === 'basic_attack') {
    return '平A';
  }
  if (value === 'skill') {
    return '技能';
  }
  return '装备';
}

function describeBundleGap(bundle: GameDataBundle): string | null {
  const missing = [
    bundle.heroes.some((hero) => hero.heroId === KATARINA_ID) ? null : KATARINA_ID,
    bundle.heroes.some((hero) => hero.heroId === DUMMY_ID) ? null : DUMMY_ID,
    bundle.skills.some((skill) => skill.skillId === BASIC_ATTACK_SKILL_ID) ? null : BASIC_ATTACK_SKILL_ID,
    bundle.skills.some((skill) => skill.skillId === DEATH_LOTUS_SKILL_ID) ? null : DEATH_LOTUS_SKILL_ID,
    ...ITEM_IDS.map((itemId) => (bundle.items.some((item) => item.itemId === itemId) ? null : itemId))
  ].filter(Boolean);

  return missing.length > 0 ? `Bundle 缺少 MVP 资源: ${missing.join(', ')}` : null;
}

export function KatarinaMvpPage({
  apiBaseUrl,
  selectedGameId,
  selectedGameName,
  externalRefreshSeed = 0
}: KatarinaMvpPageProps) {
  const engineRef = useRef<MvpEngineClient | null>(null);
  const replayAfterRefreshRef = useRef<EngineRunInput | null>(null);
  const lastHandledRefreshRef = useRef(externalRefreshSeed);
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [bundleState, setBundleState] = useState<LoadState>('idle');
  const [engineState, setEngineState] = useState<LoadState>('idle');
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<CurrentVersion | null>(null);
  const [bundle, setBundle] = useState<GameDataBundle | null>(null);
  const [bundleEtag, setBundleEtag] = useState<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<ScenarioDefinition['id']>('s0_basic_attack_10');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [lastInput, setLastInput] = useState<EngineRunInput | null>(null);
  const [lastOutput, setLastOutput] = useState<EngineRunOutput | null>(null);
  const [runState, setRunState] = useState<LoadState>('idle');

  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? scenarios[0];

  useEffect(() => {
    if (externalRefreshSeed === lastHandledRefreshRef.current) {
      return;
    }

    lastHandledRefreshRef.current = externalRefreshSeed;
    if (lastInput) {
      replayAfterRefreshRef.current = lastInput;
    }
  }, [externalRefreshSeed, lastInput]);

  useEffect(() => {
    if (!selectedGameId) {
      setBundleState('idle');
      setEngineState('idle');
      setBundleError(null);
      setRunError(null);
      setCurrentVersion(null);
      setBundle(null);
      setBundleEtag(null);
      setSelectedItemIds([]);
      setLastInput(null);
      setLastOutput(null);
      engineRef.current?.dispose();
      engineRef.current = null;
      return;
    }

    let cancelled = false;
    const gameId = selectedGameId;

    async function loadAndInit() {
      setBundleState('loading');
      setEngineState('loading');
      setBundleError(null);
      setRunError(null);

      try {
        const snapshot = await loadPublishedBundleSnapshot(apiBaseUrl, gameId);
        if (cancelled) {
          return;
        }

        const missingMessage = describeBundleGap(snapshot.bundle);
        if (missingMessage) {
          throw new Error(missingMessage);
        }

        const client = new MvpEngineClient();
        await client.init(
          {
            gameId: snapshot.bundle.meta.gameId,
            versionId: snapshot.bundle.meta.versionId,
            dataHash: snapshot.bundle.meta.dataHash
          },
          snapshot.bundle
        );

        if (cancelled) {
          client.dispose();
          return;
        }

        engineRef.current?.dispose();
        engineRef.current = client;
        setCurrentVersion(snapshot.currentVersion);
        setBundle(snapshot.bundle);
        setBundleEtag(snapshot.bundleEtag);
        setBundleState('success');
        setEngineState('success');
      } catch (error) {
        if (cancelled) {
          return;
        }

        engineRef.current?.dispose();
        engineRef.current = null;
        setCurrentVersion(null);
        setBundle(null);
        setBundleEtag(null);
        setBundleState('error');
        setEngineState('error');
        setBundleError(getErrorMessage(error));
      }
    }

    void loadAndInit();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, externalRefreshSeed, refreshSeed, selectedGameId]);

  useEffect(() => {
    if (engineState !== 'success' || !engineRef.current || !replayAfterRefreshRef.current) {
      return;
    }

    const replayInput = replayAfterRefreshRef.current;
    replayAfterRefreshRef.current = null;

    async function rerunLastScenario() {
      setRunState('loading');
      setRunError(null);

      try {
        const output = await engineRef.current!.run(replayInput);
        setLastInput(replayInput);
        setLastOutput(output);
        setRunState('success');
      } catch (error) {
        setLastOutput(null);
        setRunState('error');
        setRunError(getErrorMessage(error));
      }
    }

    void rerunLastScenario();
  }, [engineState]);

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const selectedItems = useMemo(
    () => bundle?.items.filter((item) => selectedItemIds.includes(item.itemId)) ?? [],
    [bundle, selectedItemIds]
  );
  const damageEventRows = useMemo<DamageEventRow[]>(
    () =>
      lastOutput?.events.map((event: EngineDamageEvent) => ({
        key: `event-${event.sequence}`,
        sequence: event.sequence,
        tMs: event.tMs,
        label: event.label,
        totalRawDamage: event.totalRawDamage,
        totalDealtDamage: event.totalDealtDamage,
        enemyHpBefore: event.enemyHpBefore,
        enemyHpAfter: event.enemyHpAfter,
        components: event.components
      })) ?? [],
    [lastOutput]
  );

  async function handleRunScenario() {
    if (!engineRef.current || !bundle) {
      return;
    }

    const input = selectedScenario.buildInput(selectedItemIds);
    setLastInput(input);
    setRunState('loading');
    setRunError(null);

    try {
      const output = await engineRef.current.run(input);
      setLastOutput(output);
      setRunState('success');
    } catch (error) {
      setLastOutput(null);
      setRunState('error');
      setRunError(getErrorMessage(error));
    }
  }

  const latestSample = lastOutput?.samples[lastOutput.samples.length - 1];
  const availableItems = bundle?.items.filter((item) => ITEM_IDS.includes(item.itemId as (typeof ITEM_IDS)[number])) ?? [];
  const damageEventColumns = [
    {
      title: 'tMs',
      render: (_: unknown, record: DamageEventRow) => `${record.tMs}`
    },
    {
      title: '命中',
      render: (_: unknown, record: DamageEventRow) => `${record.sequence}`
    },
    {
      title: '事件',
      render: (_: unknown, record: DamageEventRow) => record.label
    },
    {
      title: '总原始伤害',
      render: (_: unknown, record: DamageEventRow) => formatNumber(record.totalRawDamage, 3)
    },
    {
      title: '总结算伤害',
      render: (_: unknown, record: DamageEventRow) => formatNumber(record.totalDealtDamage, 3)
    },
    {
      title: '敌方 HP 变化',
      render: (_: unknown, record: DamageEventRow) =>
        `${formatNumber(record.enemyHpBefore, 3)} -> ${formatNumber(record.enemyHpAfter, 3)}`
    }
  ];
  const damageComponentColumns = [
    {
      title: '来源',
      render: (_: unknown, record: DamageComponentRow) => record.label
    },
    {
      title: '类型',
      render: (_: unknown, record: DamageComponentRow) => formatDamageSourceKind(record.sourceKind)
    },
    {
      title: '伤害类型',
      render: (_: unknown, record: DamageComponentRow) => formatDamageType(record.damageType)
    },
    {
      title: '原始值',
      render: (_: unknown, record: DamageComponentRow) => formatNumber(record.rawDamage, 3)
    },
    {
      title: '结算值',
      render: (_: unknown, record: DamageComponentRow) => formatNumber(record.dealtDamage, 3)
    }
  ];

  return (
    <div className="page-mvp mvp-page page-stack">
      <Panel
        title="卡特琳娜 MVP 闭环"
        kicker="Katarina MVP"
        actions={
          <Button onClick={() => setRefreshSeed((value) => value + 1)} type="primary">
            刷新 current + bundle
          </Button>
        }
      >
        {!selectedGameId ? (
          <EmptyState title="还没有选择游戏" description="先在顶部工具栏选择一个 gameId，再进入卡特 MVP 页面。" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="当前游戏" value={selectedGameName} hint={selectedGameId} />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard
                  label="版本"
                  value={currentVersion?.versionCode ?? '未发布'}
                  hint={currentVersion ? `versionId=${currentVersion.versionId}` : '当前没有已发布版本'}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="Bundle 状态" value={bundleState} hint={bundleError ?? 'current + bundle 已接通'} />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="Runner 状态" value={engineState} hint={bundleEtag ?? '等待初始化'} />
              </Col>
            </Row>

            {bundleError ? <Alert type="error" content={bundleError} /> : null}
          </Space>
        )}
      </Panel>

      <Panel title="场景与装备" kicker="Scenario Builder">
        {!bundle ? (
          <EmptyState
            title="等待 MVP Bundle"
            description="需要先拿到 current + bundle，并确认卡特、假人、技能和装备都在数据包里。"
          />
        ) : (
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Typography.Title heading={5} style={{ margin: 0 }}>
                  场景选择
                </Typography.Title>
                <Row gutter={[16, 16]}>
                  {scenarios.map((scenario) => (
                    <Col xs={24} sm={12} key={scenario.id}>
                      <Card
                        size="small"
                        hoverable
                        className={selectedScenarioId === scenario.id ? 'scenario-card is-active' : 'scenario-card'}
                      >
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                          <Space direction="vertical" size={4}>
                            <Typography.Title heading={6} style={{ margin: 0 }}>
                              {scenario.title}
                            </Typography.Title>
                            <Typography.Text type="secondary">{scenario.summary}</Typography.Text>
                          </Space>
                          <Button
                            long
                            type={selectedScenarioId === scenario.id ? 'primary' : 'secondary'}
                            onClick={() => setSelectedScenarioId(scenario.id)}
                          >
                            {selectedScenarioId === scenario.id ? '当前场景' : '切换到此场景'}
                          </Button>
                        </Space>
                      </Card>
                    </Col>
                  ))}
                </Row>

                <Typography.Title heading={5} style={{ margin: 0 }}>
                  装备开关
                </Typography.Title>
                <Space wrap>
                  {availableItems.map((item) => {
                    const active = selectedItemIds.includes(item.itemId);

                    return (
                      <Button
                        key={item.itemId}
                        type={active ? 'primary' : 'secondary'}
                        onClick={() => {
                          setSelectedItemIds((current) =>
                            current.includes(item.itemId)
                              ? current.filter((itemId) => itemId !== item.itemId)
                              : [...current, item.itemId]
                          );
                        }}
                      >
                        {item.name ?? item.itemId}
                      </Button>
                    );
                  })}
                </Space>
              </Space>
            </Col>

            <Col xs={24} lg={10}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Row gutter={[16, 16]}>
                  <Col xs={24} sm={12}>
                    <MetricCard label="动作" value={selectedScenario.title} hint={selectedScenario.summary} />
                  </Col>
                  <Col xs={24} sm={12}>
                    <MetricCard
                      label="装备数"
                      value={String(selectedItemIds.length)}
                      hint={selectedItems.map((item) => item.name ?? item.itemId).join(' / ') || '当前无装备'}
                    />
                  </Col>
                  <Col xs={24} sm={12}>
                    <MetricCard label="运行状态" value={runState} hint={runError ?? '点击下方按钮执行'} />
                  </Col>
                  <Col xs={24} sm={12}>
                    <MetricCard label="ETag" value={bundleEtag ?? '--'} hint={`更新时间 ${formatDate(currentVersion?.updatedAt)}`} />
                  </Col>
                </Row>

                <Button type="primary" onClick={() => void handleRunScenario()} disabled={engineState !== 'success'}>
                  运行场景
                </Button>

                <Card size="small">
                  <JsonBlock
                    value={{
                      currentVersion,
                      selectedScenario: selectedScenario.id,
                      selectedItemIds
                    }}
                  />
                </Card>
              </Space>
            </Col>
          </Row>
        )}

        {runError ? <Alert type="error" content={runError} style={{ marginTop: 16 }} /> : null}
      </Panel>

      <Panel title="运行结果" kicker="Run Output">
        {!lastOutput ? (
          <EmptyState title="还没有运行结果" description="先选择 S0 或 S1，然后执行一次最小场景。" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="动作" value={lastOutput.result.actionLabel} hint={`stopReason=${lastOutput.result.stopReason}`} />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard
                  label="总伤害"
                  value={formatNumber(lastOutput.result.totalDamageToEnemy)}
                  hint={`命中次数 ${lastOutput.result.executedHits}`}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="敌方剩余 HP" value={formatNumber(latestSample?.enemyHp)} hint={`初始目标 ${DUMMY_ID}`} />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard
                  label="持续时间"
                  value={`${lastOutput.result.actionDurationMs} ms`}
                  hint={lastOutput.result.timeToKillEnemyMs ? `TTK=${lastOutput.result.timeToKillEnemyMs}ms` : '目标未被击杀'}
                />
              </Col>
            </Row>

            <Row gutter={[16, 16]}>
              <Col xs={24} lg={14}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Typography.Title heading={5} style={{ margin: 0 }}>
                    伤害分项
                  </Typography.Title>
                  {damageEventRows.length === 0 ? (
                    <div className="table-empty">当前动作没有产出伤害分项。</div>
                  ) : (
                    <Table
                      className="data-table-shell damage-event-table"
                      columns={damageEventColumns}
                      data={damageEventRows}
                      expandedRowRender={(record: DamageEventRow) => {
                        const componentRows: DamageComponentRow[] = record.components.map((component, componentIndex) => ({
                          ...component,
                          key: `${record.key}-component-${componentIndex}`
                        }));

                        return (
                          <div style={{ padding: '0 0 0 24px' }}>
                            <Table
                              className="data-table-shell damage-component-table"
                              columns={damageComponentColumns}
                              data={componentRows}
                              pagination={false}
                              rowKey="key"
                              size="small"
                              scroll={{ x: '100%' }}
                            />
                          </div>
                        );
                      }}
                      pagination={false}
                      rowKey="key"
                      size="small"
                      scroll={{ x: '100%' }}
                    />
                  )}

                  <Typography.Title heading={5} style={{ margin: 0 }}>
                    样本点
                  </Typography.Title>
                  <DataTable
                    columns={['tMs', 'enemyHp', '累计伤害', 'selfHp']}
                    rows={lastOutput.samples.map((sample) => [
                      `${sample.tMs}`,
                      formatNumber(sample.enemyHp, 3),
                      formatNumber(sample.cumulativeDamageToEnemy, 3),
                      formatNumber(sample.selfHp, 3)
                    ])}
                    emptyMessage="当前动作没有产出样本点。"
                  />
                </Space>
              </Col>

              <Col xs={24} lg={10}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Typography.Title heading={5} style={{ margin: 0 }}>
                    输入 / 输出快照
                  </Typography.Title>
                  <Card size="small">
                    <JsonBlock
                      value={{
                        input: lastInput,
                        result: lastOutput.result
                      }}
                    />
                  </Card>
                </Space>
              </Col>
            </Row>
          </Space>
        )}
      </Panel>
    </div>
  );
}
