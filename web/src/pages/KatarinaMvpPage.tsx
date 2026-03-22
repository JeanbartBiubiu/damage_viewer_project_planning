import { useEffect, useMemo, useRef, useState } from 'react';
import { DataTable } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import { MvpEngineClient } from '../engine/client';
import type { EngineRunInput, EngineRunOutput } from '../engine/types';
import { getBundle, getCurrentVersion, getErrorMessage } from '../services/apiClient';
import type { CurrentVersion, GameDataBundle, LoadState } from '../types/api';

type KatarinaMvpPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
};

type ScenarioDefinition = {
  id: 's0_basic_attack_10' | 's1_full_r';
  title: string;
  summary: string;
  buildInput: (itemIds: string[]) => EngineRunInput;
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

export function KatarinaMvpPage({ apiBaseUrl, selectedGameId, selectedGameName }: KatarinaMvpPageProps) {
  const engineRef = useRef<MvpEngineClient | null>(null);
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
    if (!selectedGameId) {
      setBundleState('idle');
      setEngineState('idle');
      setBundleError(null);
      setRunError(null);
      setCurrentVersion(null);
      setBundle(null);
      setBundleEtag(null);
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
        const versionResult = await getCurrentVersion(apiBaseUrl, gameId);
        if (cancelled) {
          return;
        }

        const bundleResult = await getBundle(apiBaseUrl, gameId, versionResult.data.versionId);
        if (cancelled) {
          return;
        }

        const missingMessage = describeBundleGap(bundleResult.data);
        if (missingMessage) {
          throw new Error(missingMessage);
        }

        const client = new MvpEngineClient();
        await client.init(
          {
            gameId: bundleResult.data.meta.gameId,
            versionId: bundleResult.data.meta.versionId,
            dataHash: bundleResult.data.meta.dataHash
          },
          bundleResult.data
        );

        if (cancelled) {
          client.dispose();
          return;
        }

        engineRef.current?.dispose();
        engineRef.current = client;
        setCurrentVersion(versionResult.data);
        setBundle(bundleResult.data);
        setBundleEtag(bundleResult.etag);
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
  }, [apiBaseUrl, refreshSeed, selectedGameId]);

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

  const latestSample = lastOutput && lastOutput.samples.length > 0 ? lastOutput.samples[lastOutput.samples.length - 1] : undefined;

  return (
    <div className="page-grid mvp-page">
      <Panel
        title="卡特琳娜 MVP 闭环"
        kicker="Katarina MVP"
        actions={
          <button className="button secondary" type="button" onClick={() => setRefreshSeed((value) => value + 1)}>
            刷新 current + bundle
          </button>
        }
      >
        {!selectedGameId ? (
          <EmptyState title="还没有选择游戏" description="先在顶部工具栏选择一个 gameId，再进入卡特 MVP 页面。" />
        ) : (
          <div className="metric-grid">
            <MetricCard label="当前游戏" value={selectedGameName} hint={selectedGameId} />
            <MetricCard
              label="版本"
              value={currentVersion?.versionCode ?? '未发布'}
              hint={currentVersion ? `versionId=${currentVersion.versionId}` : '当前没有 published version'}
            />
            <MetricCard label="Bundle 状态" value={bundleState} hint={bundleError ?? 'current + bundle 已接通'} />
            <MetricCard label="Runner 状态" value={engineState} hint={bundleEtag ?? '等待初始化'} />
          </div>
        )}
        {bundleError ? <div className="notice notice-error">{bundleError}</div> : null}
      </Panel>

      <Panel title="场景与装备" kicker="Scenario Builder">
        {!bundle ? (
          <EmptyState
            title="等待 MVP Bundle"
            description="需要先拿到 current + bundle，并确认卡特、假人、2 技能和 2 装备都在包里。"
          />
        ) : (
          <div className="mvp-grid">
            <div className="stack-block">
              <div className="scenario-list">
                {scenarios.map((scenario) => (
                  <button
                    key={scenario.id}
                    className={`scenario-card${selectedScenarioId === scenario.id ? ' active' : ''}`}
                    type="button"
                    onClick={() => setSelectedScenarioId(scenario.id)}
                  >
                    <strong>{scenario.title}</strong>
                    <span>{scenario.summary}</span>
                  </button>
                ))}
              </div>

              <div className="mvp-item-grid">
                {bundle.items
                  .filter((item) => ITEM_IDS.includes(item.itemId as (typeof ITEM_IDS)[number]))
                  .map((item) => {
                    const active = selectedItemIds.includes(item.itemId);
                    return (
                      <button
                        key={item.itemId}
                        className={`scenario-card${active ? ' active' : ''}`}
                        type="button"
                        onClick={() => {
                          setSelectedItemIds((current) =>
                            current.includes(item.itemId)
                              ? current.filter((itemId) => itemId !== item.itemId)
                              : [...current, item.itemId]
                          );
                        }}
                      >
                        <strong>{item.name ?? item.itemId}</strong>
                        <span>{item.itemId}</span>
                      </button>
                    );
                  })}
              </div>
            </div>

            <div className="stack-block">
              <div className="metric-grid compact">
                <MetricCard label="动作" value={selectedScenario.title} hint={selectedScenario.summary} />
                <MetricCard
                  label="装备数"
                  value={String(selectedItemIds.length)}
                  hint={selectedItems.map((item) => item.name ?? item.itemId).join(' / ') || '当前无装备'}
                />
                <MetricCard label="运行状态" value={runState} hint={runError ?? '点击下方按钮执行'} />
                <MetricCard
                  label="ETag"
                  value={bundleEtag ?? '--'}
                  hint={`更新时间 ${formatDate(currentVersion?.updatedAt)}`}
                />
              </div>

              <div className="toolbar-actions">
                <button className="button" type="button" onClick={() => void handleRunScenario()} disabled={engineState !== 'success'}>
                  运行场景
                </button>
              </div>

              <JsonBlock
                value={{
                  currentVersion,
                  selectedScenario: selectedScenario.id,
                  selectedItemIds
                }}
              />
            </div>
          </div>
        )}
        {runError ? <div className="notice notice-error">{runError}</div> : null}
      </Panel>

      <Panel title="运行结果" kicker="Run Output">
        {!lastOutput ? (
          <EmptyState title="还没有运行结果" description="先选择 S0 或 S1，然后执行一次最小场景。" />
        ) : (
          <div className="page-grid">
            <div className="metric-grid">
              <MetricCard label="动作" value={lastOutput.result.actionLabel} hint={`stopReason=${lastOutput.result.stopReason}`} />
              <MetricCard
                label="总伤害"
                value={formatNumber(lastOutput.result.totalDamageToEnemy)}
                hint={`命中次数 ${lastOutput.result.executedHits}`}
              />
              <MetricCard
                label="敌方剩余 HP"
                value={formatNumber(latestSample?.enemyHp)}
                hint={`初始目标 ${DUMMY_ID}`}
              />
              <MetricCard
                label="持续时间"
                value={`${lastOutput.result.actionDurationMs} ms`}
                hint={lastOutput.result.timeToKillEnemyMs ? `TTK=${lastOutput.result.timeToKillEnemyMs}ms` : '目标未被击杀'}
              />
            </div>

            <div className="split-grid">
              <div className="stack-block">
                <h3 className="subheading">样本点</h3>
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
              </div>

              <div className="stack-block">
                <h3 className="subheading">输入 / 输出快照</h3>
                <JsonBlock
                  value={{
                    input: lastInput,
                    result: lastOutput.result
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
