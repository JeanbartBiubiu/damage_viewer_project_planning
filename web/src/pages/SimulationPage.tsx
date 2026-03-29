/**
 * SimulationPage — 场景模拟工作台主页面
 *
 * 集成：StatusBar + ScenarioSelector + DraftEditor + ExecutionBar + ResultDashboard
 * 引擎生命周期：懒加载 — 首次 run 时 init，缓存到页面卸载。
 * 草稿持久化：localStorage debounce auto-save。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Space, Tag, Typography } from '@arco-design/web-react';
import type { GameDataBundle } from '../types/api';
import type {
  BundleIndex,
  InterpretedResult,
  RunPhase,
  ScenarioId,
  SimulationDraft,
  SimulationResult,
  VariantResult,
} from '../simulation/types';
import type { CompileScenarioInput } from '../engine/bundleCompiler';
import { loadPublishedBundleSnapshot } from '../services/bundleSnapshot';
import { getScenarioModule } from '../simulation/scenarios';
import { buildBundleIndex, buildSkillPriorities, buildDefaultSkillLevels } from '../simulation/bundleIndex';
import { useSimulationEngine } from '../simulation/useSimulationEngine';
import { useDraftPersistence } from '../simulation/useDraftPersistence';
import {
  StatusBar,
  ScenarioSelector,
  DraftEditor,
  ExecutionBar,
  ResultDashboard,
} from '../simulation/components';

type SimulationPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
  externalRefreshSeed: number;
};

export function SimulationPage({
  apiBaseUrl,
  selectedGameId,
  selectedGameName,
  externalRefreshSeed,
}: SimulationPageProps) {
  // ── Bundle 加载 ──
  const [bundle, setBundle] = useState<GameDataBundle | null>(null);
  const [bundleStatus, setBundleStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [bundleError, setBundleError] = useState<string | null>(null);

  // ── 引擎 ──
  const engine = useSimulationEngine();

  // ── 草稿 ──
  const { draft, updateDraft, resetDraft } = useDraftPersistence();

  // ── 运行状态 ──
  const [runPhase, setRunPhase] = useState<RunPhase>('idle');
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [interpreted, setInterpreted] = useState<InterpretedResult | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [variantCount, setVariantCount] = useState(0);
  const cancelRef = useRef(false);

  // ── Bundle index ──
  const bundleIndex: BundleIndex | null = useMemo(() => {
    return bundle ? buildBundleIndex(bundle) : null;
  }, [bundle]);

  // ── 加载 Bundle ──
  useEffect(() => {
    if (!selectedGameId) {
      setBundle(null);
      setBundleStatus('idle');
      return;
    }

    let cancelled = false;
    setBundleStatus('loading');
    setBundleError(null);

    loadPublishedBundleSnapshot(apiBaseUrl, selectedGameId)
      .then((snap) => {
        if (cancelled) return;
        setBundle(snap.bundle);
        setBundleStatus('ready');

        // 如果草稿里英雄为空，尝试填入第一个英雄
        if (!draft.self.heroId && snap.bundle.heroes.length > 0) {
          const firstHero = snap.bundle.heroes[0];
          updateDraft({
            self: { ...draft.self, heroId: firstHero.heroId },
          });
        }
        if (!draft.enemy.heroId && snap.bundle.heroes.length > 1) {
          const secondHero = snap.bundle.heroes[1] ?? snap.bundle.heroes[0];
          updateDraft({
            enemy: { ...draft.enemy, heroId: secondHero.heroId },
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setBundleStatus('error');
        setBundleError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, selectedGameId, externalRefreshSeed]);

  // ── 场景切换 ──
  const handleScenarioChange = useCallback(
    (id: ScenarioId) => {
      updateDraft({ scenarioId: id });
    },
    [updateDraft]
  );

  // ── 构建 CompileScenarioInput ──
  const buildCompileInput = useCallback(
    (b: GameDataBundle, d: SimulationDraft): CompileScenarioInput => {
      const idx = buildBundleIndex(b);

      // 自动推导技能等级：用户设置优先，缺失的用默认值补充
      const selfDefaultLevels = buildDefaultSkillLevels(idx, d.self.heroId);
      const enemyDefaultLevels = buildDefaultSkillLevels(idx, d.enemy.heroId);
      const selfSkillLevels = { ...selfDefaultLevels, ...d.self.skillLevels };
      const enemySkillLevels = { ...enemyDefaultLevels, ...d.enemy.skillLevels };

      // 自动推导优先级列表
      const selfPriorities = buildSkillPriorities(idx, d.self.heroId);
      const enemyPriorities = buildSkillPriorities(idx, d.enemy.heroId);

      return {
        bundle: b,
        selfHeroId: d.self.heroId,
        selfItemIds: d.self.itemIds,
        selfLevel: d.self.level,
        selfSkillLevels,
        selfPriorities,
        enemyHeroId: d.enemy.heroId,
        enemyItemIds: d.enemy.itemIds,
        enemyLevel: d.enemy.level,
        enemySkillLevels,
        enemyPriorities,
      };
    },
    []
  );

  // ── 运行 ──
  const handleRun = useCallback(async () => {
    if (!bundle) {
      setRunError('Bundle 未加载');
      return;
    }

    const scenarioModule = getScenarioModule(draft.scenarioId);
    if (!scenarioModule) {
      setRunError(`未知场景: ${draft.scenarioId}`);
      return;
    }

    // 检查基本配置
    if (!draft.self.heroId) {
      setRunError('请选择我方英雄');
      return;
    }
    if (!draft.enemy.heroId) {
      setRunError('请选择敌方英雄');
      return;
    }

    cancelRef.current = false;
    setRunPhase('compiling');
    setRunError(null);
    setResult(null);
    setInterpreted(null);
    setCompletedCount(0);

    try {
      // 确保引擎就绪
      const compileInput = buildCompileInput(bundle, draft);
      const engineReady = await engine.ensureReady(bundle, compileInput);
      if (!engineReady) {
        setRunPhase('error');
        setRunError(engine.errorMessage ?? '引擎初始化失败');
        return;
      }

      // 展开变体
      const variants = scenarioModule.buildVariants(draft);
      setVariantCount(variants.length);
      setRunPhase('running');

      const startedAt = new Date().toISOString();
      const t0 = performance.now();
      const variantResults: VariantResult[] = [];

      for (const variant of variants) {
        if (cancelRef.current) break;

        const input = scenarioModule.buildRunInput(draft, variant, bundle);
        const vt0 = performance.now();
        const output = await engine.run(input);
        const vt1 = performance.now();

        variantResults.push({
          variant,
          input,
          output,
          durationMs: Math.round(vt1 - vt0),
        });

        setCompletedCount((c) => c + 1);
      }

      const t1 = performance.now();
      const simResult: SimulationResult = {
        scenarioId: draft.scenarioId,
        startedAt,
        completedAt: new Date().toISOString(),
        totalDurationMs: Math.round(t1 - t0),
        variants: variantResults,
        bundleMeta: {
          gameId: bundle.meta.gameId,
          versionId: bundle.meta.versionId,
          dataHash: bundle.meta.dataHash,
        },
      };

      const interpretedResult = scenarioModule.interpretResults(variantResults);

      setResult(simResult);
      setInterpreted(interpretedResult);
      setRunPhase('done');
    } catch (err) {
      setRunPhase('error');
      setRunError(err instanceof Error ? err.message : String(err));
    }
  }, [bundle, draft, engine, buildCompileInput]);

  const handleStop = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const handleResetEngine = useCallback(() => {
    engine.reset();
  }, [engine]);

  const handleResetDraft = useCallback(() => {
    resetDraft();
  }, [resetDraft]);

  // ── 当前场景模块 ──
  const currentModule = getScenarioModule(draft.scenarioId);

  return (
    <div className="sim-page">
      <section className="sim-page-header">
        <Space align="center" size={10}>
          <Tag color="arcoblue">场景模拟</Tag>
          <Typography.Text className="workspace-rail">
            Simulation / {selectedGameName}
          </Typography.Text>
        </Space>
        <Typography.Title heading={3} style={{ marginTop: 4, marginBottom: 8 }}>
          场景模拟工作台
        </Typography.Title>
      </section>

      <StatusBar
        bundleMeta={bundle?.meta ?? null}
        bundleStatus={bundleStatus}
        engineStatus={engine.status}
        runPhase={runPhase}
      />

      {bundleError && (
        <Alert type="error" content={bundleError} style={{ marginBottom: 12 }} closable />
      )}

      {runError && (
        <Alert type="error" content={runError} style={{ marginBottom: 12 }} closable onClose={() => setRunError(null)} />
      )}

      {engine.errorMessage && runPhase !== 'error' && (
        <Alert type="warning" content={`引擎: ${engine.errorMessage}`} style={{ marginBottom: 12 }} closable />
      )}

      <ScenarioSelector
        selectedId={draft.scenarioId}
        onSelect={handleScenarioChange}
      />

      <div style={{ marginTop: 16 }}>
        <DraftEditor
          draft={draft}
          onDraftChange={updateDraft}
          bundleIndex={bundleIndex}
        />
      </div>

      {/* 场景特有配置面板 */}
      {currentModule?.ExtraConfigPanel && bundle && (
        <div style={{ marginTop: 12 }}>
          <currentModule.ExtraConfigPanel
            draft={draft}
            onDraftChange={updateDraft}
            bundle={bundle}
          />
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <ExecutionBar
          runPhase={runPhase}
          variantCount={variantCount}
          completedCount={completedCount}
          onRun={handleRun}
          onStop={handleStop}
          onResetEngine={handleResetEngine}
          onResetDraft={handleResetDraft}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <ResultDashboard result={result} interpreted={interpreted} />
      </div>
    </div>
  );
}
