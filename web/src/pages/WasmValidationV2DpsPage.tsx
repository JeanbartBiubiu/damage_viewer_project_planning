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
  createDefaultV2DpsMultiHeroSelection,
  createDefaultV2DpsSelection,
  createDefaultV2DpsStackingPassiveSelection,
  createV2DpsMultiHeroCurveSelection,
  createV2DpsCurveSelection,
  createV2DpsStackingPassiveCurveSelections,
  createV2DpsStackingPassiveSyntheticBundle,
  formatV2DpsMultiHeroCurveLabel,
  getDefaultV2DpsPassiveIdsForHero,
  getDefaultV2DpsScenarioIdsForHero,
  inspectV2DpsStackingPassiveBundle,
  listV2DpsAttackers,
  listV2DpsEquipmentOptions,
  listV2DpsPassiveOptionsForHero,
  listV2DpsScenarioOptionsForHero,
  listV2DpsTargetGroups,
  prepareV2DpsInput,
  V2_DPS_CASE_ID,
  V2_DPS_STACKING_PASSIVE_CASE_ID,
  V2_DPS_STACKING_PASSIVE_ITEM_ID,
  V2_DPS_STACKING_PASSIVE_SKILL_ID,
  type V2DpsCurveResult,
  type V2DpsCurveSelection,
  type V2DpsOutput,
  type V2DpsPreparedInput,
  type V2DpsSelection,
  type V2DpsStackingPassiveBundleCheck
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

type V2DpsPageMode = 'singleHero' | 'multiHero' | 'stackingPassive';

type WasmValidationV2DpsWorkbenchProps = WasmValidationV2DpsPageProps & {
  mode: V2DpsPageMode;
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

type StackingPassiveEvidence = {
  stackApplied: boolean;
  capReached: boolean;
  expiryObserved: boolean;
  invalidBlocked: boolean;
  stackHint: string;
  capHint: string;
  expiryHint: string;
  invalidHint: string;
};

type ChartMode = 'damage' | 'hp';

const frameKindLabel: Record<number, string> = {
  [READY_FRAME_KIND]: 'ready',
  [DONE_FRAME_KIND]: 'done',
  [ERROR_FRAME_KIND]: 'error'
};

export function WasmValidationV2DpsPage(props: WasmValidationV2DpsPageProps) {
  return <WasmValidationV2DpsWorkbench {...props} mode="singleHero" />;
}

export function WasmValidationV2DpsMultiHeroPage(props: WasmValidationV2DpsPageProps) {
  return <WasmValidationV2DpsWorkbench {...props} mode="multiHero" />;
}

export function WasmValidationV2DpsStackingPassivePage(props: WasmValidationV2DpsPageProps) {
  return <WasmValidationV2DpsWorkbench {...props} mode="stackingPassive" />;
}

function WasmValidationV2DpsWorkbench({
  apiBaseUrl,
  selectedGameId,
  selectedGameName,
  externalRefreshSeed,
  mode
}: WasmValidationV2DpsWorkbenchProps) {
  const isMultiHero = mode === 'multiHero';
  const isStackingPassive = mode === 'stackingPassive';
  const [bundleStatus, setBundleStatus] = useState<LoadState>('idle');
  const [runStatus, setRunStatus] = useState<LoadState>('idle');
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [syntheticFallbackReason, setSyntheticFallbackReason] = useState<string | null>(null);
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
        setSyntheticFallbackReason(null);
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
        const defaultSelection = createDefaultSelectionForMode(snapshot.bundle, mode);
        setBundle(snapshot.bundle);
        setCurrentVersion(snapshot.currentVersion);
        setCacheStatus(snapshot.cacheStatus);
        setSyntheticFallbackReason(null);
        setSelection(defaultSelection);
        setRuneDraftByCurveId(createRuneDrafts(defaultSelection.curves));
        setExpandedCurveIds([]);
        setActiveCurveId(defaultSelection.curves[0]?.curveId ?? null);
        setBundleStatus('success');
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (isStackingPassive) {
          const fallbackBundle = createV2DpsStackingPassiveSyntheticBundle(selectedGameId);
          const fallbackSelection = createDefaultV2DpsStackingPassiveSelection(fallbackBundle);
          setBundle(fallbackBundle);
          setCurrentVersion(createSyntheticCurrentVersion(fallbackBundle));
          setCacheStatus(null);
          setSelection(fallbackSelection);
          setRuneDraftByCurveId(createRuneDrafts(fallbackSelection.curves));
          setExpandedCurveIds([]);
          setActiveCurveId(fallbackSelection.curves[0]?.curveId ?? null);
          setBundleStatus('success');
          setBundleError(null);
          setSyntheticFallbackReason(getErrorMessage(error));
          return;
        }
        setBundle(null);
        setCurrentVersion(null);
        setSelection(null);
        setRuneDraftByCurveId({});
        setExpandedCurveIds([]);
        setBundleStatus('error');
        setBundleError(getErrorMessage(error));
        setSyntheticFallbackReason(null);
      }
    }

    void loadBundle();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, externalRefreshSeed, isStackingPassive, mode, resetRunArtifacts, selectedGameId]);

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
  const heroLabelById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const option of attackerOptions) {
      labels.set(option.actorId, stripActorIdPrefix(option.label));
    }
    return labels;
  }, [attackerOptions]);
  const multiHeroGlobalEquipmentItemIds = selection?.curves[0]?.equipmentItemIds ?? [];
  const multiHeroGlobalRuneDraft = selection?.curves[0]
    ? runeDraftByCurveId[selection.curves[0].curveId] ?? formatRuneAdjustments(selection.curves[0].runeStatAdjustments)
    : '';
  const multiHeroGlobalScenarioStateIds = selection?.curves[0]?.enabledScenarioStateIds ?? [];
  const multiHeroScenarioOptions = useMemo(() => {
    const options = new Map<string, { id: string; label: string }>();
    for (const curve of selection?.curves ?? []) {
      const heroId = selection ? getCurveHeroId(selection, curve) : curve.attackerHeroId ?? '';
      const heroLabel = heroLabelById.get(heroId) ?? heroId;
      for (const option of listV2DpsScenarioOptionsForHero(heroId)) {
        if (!options.has(option.id)) {
          options.set(option.id, { id: option.id, label: `${heroLabel} / ${option.label}` });
        }
      }
    }
    return Array.from(options.values());
  }, [heroLabelById, selection]);
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
  const stackingPassiveCheck = useMemo<V2DpsStackingPassiveBundleCheck | null>(
    () => (bundle && isStackingPassive ? inspectV2DpsStackingPassiveBundle(bundle) : null),
    [bundle, isStackingPassive]
  );
  const canRun = Boolean(bundle && currentVersion && selection && selectedGameId && selection.curves.length > 0)
    && runStatus !== 'loading';

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
  const stackingPassiveEvidence = useMemo<StackingPassiveEvidence | null>(
    () => (isStackingPassive && wasmOutput ? buildStackingPassiveEvidence(wasmOutput.curveResults) : null),
    [isStackingPassive, wasmOutput]
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
      const defaultSelection = createDefaultSelectionForMode(snapshot.bundle, mode);
      setBundle(snapshot.bundle);
      setCurrentVersion(snapshot.currentVersion);
      setCacheStatus(snapshot.cacheStatus);
      setSyntheticFallbackReason(null);
      setSelection(defaultSelection);
      setRuneDraftByCurveId(createRuneDrafts(defaultSelection.curves));
      setExpandedCurveIds([]);
      setActiveCurveId(defaultSelection.curves[0]?.curveId ?? null);
      setBundleStatus('success');
    } catch (error) {
      if (isStackingPassive) {
        const fallbackBundle = createV2DpsStackingPassiveSyntheticBundle(selectedGameId);
        const fallbackSelection = createDefaultV2DpsStackingPassiveSelection(fallbackBundle);
        setBundle(fallbackBundle);
        setCurrentVersion(createSyntheticCurrentVersion(fallbackBundle));
        setCacheStatus(null);
        setSelection(fallbackSelection);
        setRuneDraftByCurveId(createRuneDrafts(fallbackSelection.curves));
        setExpandedCurveIds([]);
        setActiveCurveId(fallbackSelection.curves[0]?.curveId ?? null);
        setBundleStatus('success');
        setBundleError(null);
        setSyntheticFallbackReason(getErrorMessage(error));
        return;
      }
      setBundleStatus('error');
      setBundleError(getErrorMessage(error));
      setSyntheticFallbackReason(null);
    }
  }, [apiBaseUrl, isStackingPassive, mode, resetRunArtifacts, selectedGameId]);

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
      if (isMultiHero) {
        const existingHeroIds = new Set(current.curves.map((curve) => getCurveHeroId(current, curve)));
        const nextHeroId = attackerOptions.find((option) => !existingHeroIds.has(option.actorId))?.actorId
          ?? attackerOptions[0]?.actorId
          ?? current.attackerHeroId;
        const equipmentItemIds = current.curves[0]?.equipmentItemIds ?? [];
        const enabledScenarioStateIds = current.curves[0]?.enabledScenarioStateIds ?? [];
        const runeStatAdjustments = current.curves[0]?.runeStatAdjustments ?? {};
        const curve = createV2DpsMultiHeroCurveSelection(
          bundle ?? emptyGameDataBundle(),
          nextHeroId,
          equipmentItemIds,
          current.curves.length,
          enabledScenarioStateIds,
          runeStatAdjustments
        );
        setActiveCurveId(curve.curveId);
        setExpandedCurveIds((currentExpanded) => [...currentExpanded, curve.curveId]);
        return { ...current, curves: [...current.curves, curve] };
      }
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
  }, [attackerOptions, bundle, isMultiHero, updateSelection]);

  const updateMultiHeroGlobalEquipment = useCallback((equipmentItemIds: string[]) => {
    updateSelection((current) => ({
      ...current,
      curves: current.curves.map((curve) => ({
        ...curve,
        equipmentItemIds,
        label: bundle ? formatV2DpsMultiHeroCurveLabel(bundle, getCurveHeroId(current, curve), equipmentItemIds) : curve.label
      }))
    }));
  }, [bundle, updateSelection]);

  const updateMultiHeroGlobalScenarioStates = useCallback((enabledScenarioStateIds: string[]) => {
    updateSelection((current) => ({
      ...current,
      curves: current.curves.map((curve) => ({
        ...curve,
        enabledScenarioStateIds
      }))
    }));
  }, [updateSelection]);

  const handleMultiHeroRuneDraftChange = useCallback((value: string) => {
    setRuneDraftByCurveId((current) => {
      const next = { ...current };
      for (const curve of selection?.curves ?? []) {
        next[curve.curveId] = value;
      }
      return next;
    });
    resetRunArtifacts();
  }, [resetRunArtifacts, selection?.curves]);

  const handleMultiHeroRuneDraftBlur = useCallback(() => {
    const parsed = parseRuneAdjustments(multiHeroGlobalRuneDraft);
    const formatted = formatRuneAdjustments(parsed);
    setRuneDraftByCurveId((current) => {
      const next = { ...current };
      for (const curve of selection?.curves ?? []) {
        next[curve.curveId] = formatted;
      }
      return next;
    });
    updateSelection((current) => ({
      ...current,
      curves: current.curves.map((curve) => ({
        ...curve,
        runeStatAdjustments: parsed
      }))
    }));
  }, [multiHeroGlobalRuneDraft, selection?.curves, updateSelection]);

  const updateMultiHeroCurveHero = useCallback((curveId: string, attackerHeroId: string) => {
    updateSelection((current) => ({
      ...current,
      attackerHeroId: current.curves[0]?.curveId === curveId ? attackerHeroId : current.attackerHeroId,
      curves: current.curves.map((curve) => curve.curveId === curveId ? {
        ...curve,
        attackerHeroId,
        label: bundle ? formatV2DpsMultiHeroCurveLabel(bundle, attackerHeroId, curve.equipmentItemIds) : curve.label,
        enabledPassiveEffectIds: getDefaultV2DpsPassiveIdsForHero(attackerHeroId),
        enabledScenarioStateIds: current.curves[0]?.enabledScenarioStateIds ?? []
      } : curve)
    }));
  }, [bundle, updateSelection]);

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
      return {
        ...current,
        attackerHeroId: isMultiHero ? getCurveHeroId(current, nextCurves[0]) : current.attackerHeroId,
        curves: nextCurves
      };
    });
    setExpandedCurveIds((current) => current.filter((expandedCurveId) => expandedCurveId !== curveId));
  }, [isMultiHero, updateSelection]);

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

  const displayCaseId = selection?.caseId ?? (isStackingPassive ? V2_DPS_STACKING_PASSIVE_CASE_ID : V2_DPS_CASE_ID);
  const pageTitle = isStackingPassive
    ? 'V2 DPS Batch H Stacking Passive'
    : isMultiHero ? 'V2 DPS 多英雄同装备' : 'V2 DPS 单英雄多曲线';
  const pageKicker = isStackingPassive
    ? 'single_attacker_dps / v2_batch_h_stacking_stat_passives_001'
    : isMultiHero ? 'single_attacker_dps / Batch E-B' : 'single_attacker_dps / Batch E-1';
  const curvePanelTitle = isMultiHero ? '英雄行配置' : 'Curve 配置';
  const curvePanelKicker = isStackingPassive
    ? 'synthetic presets + published bundle item passive -> Wasm output'
    : isMultiHero ? 'same equipment -> per-hero curves' : 'published bundle -> resolvedSnapshot';

  return (
    <div className="wasm-validation-page">
      <Panel
        title={pageTitle}
        kicker={pageKicker}
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
        {isStackingPassive && syntheticFallbackReason ? (
          <Alert
            type="warning"
            content={`Published bundle load failed; Batch H synthetic runtime preset is active. ${syntheticFallbackReason}`}
          />
        ) : null}
        {isStackingPassive && stackingPassiveCheck ? (
          <Alert
            type={stackingPassiveCheck.ready ? 'success' : 'warning'}
            content={formatStackingPassiveCheckMessage(stackingPassiveCheck)}
          />
        ) : null}

        <Row gutter={[16, 16]} className="wasm-selection-grid">
          <Col span={6}>
            <MetricCard label="Game" value={selectedGameId ?? 'none'} hint={selectedGameName} />
          </Col>
          <Col span={6}>
            <MetricCard label="Version" value={currentVersion?.versionCode ?? 'N/A'} hint={cacheStatus ? `bundle cache ${cacheStatus}` : 'bundle'} />
          </Col>
          <Col span={6}>
            <MetricCard label="Case" value={displayCaseId} hint={`${selection?.curves.length ?? 0} curves`} />
          </Col>
          <Col span={6}>
            <MetricCard label="Wasm" value={wasmSha256 ? wasmSha256.slice(0, 12) : formatLoadState(runStatus)} hint={WASM_ASSET_LABEL} />
          </Col>
        </Row>

        <Form layout="vertical">
          <Row gutter={[16, 16]}>
            {!isMultiHero ? (
              <Col span={8}>
                <Form.Item label="英雄">
                  <Select
                    value={selection?.attackerHeroId ?? ''}
                    showSearch
                    filterOption={filterSelectOption}
                    onChange={(value) => {
                      const attackerHeroId = String(value);
                      const curves = createCurveSelectionsForMode(bundle ?? undefined, mode, attackerHeroId);
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
            ) : null}
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
          {isMultiHero ? (
            <Row gutter={[16, 16]} className="v2-dps-global-row">
              <Col span={10}>
                <Form.Item label="全局装备">
                  <Select
                    mode="multiple"
                    value={multiHeroGlobalEquipmentItemIds}
                    showSearch
                    filterOption={filterSelectOption}
                    onChange={(value) => updateMultiHeroGlobalEquipment(normalizeSelectValues(value))}
                    disabled={!selection || equipmentOptions.length === 0}
                    placeholder="选择同一套装备"
                  >
                    {equipmentOptions.map((option) => (
                      <Select.Option key={option.itemId} value={option.itemId}>
                        {option.label} / {option.statsLabel}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={7}>
                <Form.Item label="全局场景预设">
                  <Select
                    mode="multiple"
                    value={multiHeroGlobalScenarioStateIds}
                    showSearch
                    filterOption={filterSelectOption}
                    onChange={(value) => updateMultiHeroGlobalScenarioStates(normalizeSelectValues(value))}
                    disabled={!selection || multiHeroScenarioOptions.length === 0}
                    placeholder="可选；仅匹配对应英雄/装备来源"
                  >
                    {multiHeroScenarioOptions.map((option) => (
                      <Select.Option key={option.id} value={option.id}>
                        {option.label}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={7}>
                <Form.Item label="符文/属性调整">
                  <Input
                    value={multiHeroGlobalRuneDraft}
                    onChange={handleMultiHeroRuneDraftChange}
                    onBlur={handleMultiHeroRuneDraftBlur}
                    placeholder="ad=10, attack_speed=0.1"
                    disabled={!selection}
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : null}
        </Form>
      </Panel>

      <Panel
        title={curvePanelTitle}
        kicker={curvePanelKicker}
        actions={
          <Space wrap>
            <Button icon={<IconPlus />} onClick={handleAddCurve} disabled={!selection}>
              {isMultiHero ? '添加英雄行' : '添加 curve'}
            </Button>
            <Button onClick={() => selection && updateSelection((current) => {
              if (!bundle) {
                return current;
              }
              const nextSelection = createDefaultSelectionForMode(bundle, mode);
              setRuneDraftByCurveId(createRuneDrafts(nextSelection.curves));
              setExpandedCurveIds([]);
              setActiveCurveId(nextSelection.curves[0]?.curveId ?? null);
              return nextSelection;
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
              const curveHeroId = getCurveHeroId(selection, curve);
              const curveHeroLabel = heroLabelById.get(curveHeroId) ?? curveHeroId;
              const curvePassiveOptions = listV2DpsPassiveOptionsForHero(curveHeroId);
              const curveScenarioOptions = listV2DpsScenarioOptionsForHero(curveHeroId);
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
                        {isMultiHero ? <Tag>{curveHeroLabel}</Tag> : null}
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
                    <Col span={isMultiHero ? 8 : 6}>
                      {isMultiHero ? (
                        <Form.Item label="英雄">
                          <Select
                            value={curveHeroId}
                            showSearch
                            filterOption={filterSelectOption}
                            onChange={(value) => updateMultiHeroCurveHero(curve.curveId, String(value))}
                          >
                            {attackerOptions.map((option) => (
                              <Select.Option key={option.actorId} value={option.actorId}>
                                {option.label}
                              </Select.Option>
                            ))}
                          </Select>
                        </Form.Item>
                      ) : (
                        <Form.Item label="curve 名称">
                          <Input value={curve.label} onChange={(value) => updateCurve(curve.curveId, { label: value })} />
                        </Form.Item>
                      )}
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
                    <Col span={isMultiHero ? 12 : 14}>
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
                    {!isMultiHero ? (
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
                    ) : null}
                    <Col span={isMultiHero ? 24 : 12}>
                      <Form.Item label="启用技能被动">
                        <Select
                          mode="multiple"
                          value={curve.enabledPassiveEffectIds}
                          onChange={(value) => updateCurve(curve.curveId, { enabledPassiveEffectIds: normalizeSelectValues(value) })}
                          disabled={curvePassiveOptions.length === 0}
                          placeholder="当前英雄没有可选技能被动"
                        >
                          {curvePassiveOptions.map((option) => (
                            <Select.Option key={option.id} value={option.id}>
                              {option.label}
                            </Select.Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                    {!isMultiHero ? (
                    <Col span={12}>
                      <Form.Item label="场景预设">
                        <Select
                          mode="multiple"
                          value={curve.enabledScenarioStateIds}
                          onChange={(value) => updateCurve(curve.curveId, { enabledScenarioStateIds: normalizeSelectValues(value) })}
                          disabled={curveScenarioOptions.length === 0}
                          placeholder="无预设状态"
                        >
                          {curveScenarioOptions.map((option) => (
                            <Select.Option key={option.id} value={option.id}>
                              {option.label}
                            </Select.Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                    ) : null}
                    {!isMultiHero ? (
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
                    ) : null}
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

        {stackingPassiveEvidence ? (
          <Panel title="Batch H Assertions" kicker="wasm output evidence">
            <Row gutter={[16, 16]} className="wasm-validation-grid">
              <Col span={6}>
                <MetricCard
                  label="Stack Applies"
                  value={formatPassStatus(stackingPassiveEvidence.stackApplied)}
                  hint={stackingPassiveEvidence.stackHint}
                />
              </Col>
              <Col span={6}>
                <MetricCard
                  label="Cap"
                  value={formatPassStatus(stackingPassiveEvidence.capReached)}
                  hint={stackingPassiveEvidence.capHint}
                />
              </Col>
              <Col span={6}>
                <MetricCard
                  label="Expiry"
                  value={formatPassStatus(stackingPassiveEvidence.expiryObserved)}
                  hint={stackingPassiveEvidence.expiryHint}
                />
              </Col>
              <Col span={6}>
                <MetricCard
                  label="Invalid Contract"
                  value={formatPassStatus(stackingPassiveEvidence.invalidBlocked)}
                  hint={stackingPassiveEvidence.invalidHint}
                />
              </Col>
            </Row>
          </Panel>
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

function createDefaultSelectionForMode(bundle: GameDataBundle, mode: V2DpsPageMode): V2DpsSelection {
  if (mode === 'multiHero') {
    return createDefaultV2DpsMultiHeroSelection(bundle);
  }
  if (mode === 'stackingPassive') {
    return createDefaultV2DpsStackingPassiveSelection(bundle);
  }
  return createDefaultV2DpsSelection(bundle);
}

function createCurveSelectionsForMode(bundle: GameDataBundle | undefined, mode: V2DpsPageMode, attackerHeroId: string): V2DpsCurveSelection[] {
  if (mode === 'stackingPassive') {
    return createV2DpsStackingPassiveCurveSelections(attackerHeroId);
  }
  return createDefaultV2DpsCurveSelections(attackerHeroId, bundle);
}

function formatStackingPassiveCheckMessage(check: V2DpsStackingPassiveBundleCheck): string {
  const prefix = `Batch H real-data contract: item ${V2_DPS_STACKING_PASSIVE_ITEM_ID}, skill ${V2_DPS_STACKING_PASSIVE_SKILL_ID}, skillKey ${check.skillKey}.`;
  if (check.ready) {
    return `${prefix} Published bundle is ready for the 3124 sub-mechanism; synthetic presets can run independently and all mechanics are executed by Wasm.`;
  }
  return `${prefix} Published real-data gate is not ready: ${check.missingReasons.join(' / ')}. Synthetic presets can still run for runtime evidence.`;
}

function createSyntheticCurrentVersion(bundle: GameDataBundle): CurrentVersion {
  return {
    gameId: bundle.meta.gameId,
    versionCode: bundle.meta.versionCode,
    updatedAt: bundle.meta.generatedAt,
    publishedAt: bundle.meta.generatedAt,
    versionId: bundle.meta.versionId,
    dataHash: bundle.meta.dataHash
  };
}

function buildStackingPassiveEvidence(results: V2DpsCurveResult[]): StackingPassiveEvidence {
  const cap = results.find((result) => result.curveId.includes('synthetic-cap'));
  const expiry = results.find((result) => result.curveId.includes('synthetic-expiry'));
  const invalid = results.find((result) => result.curveId.includes('synthetic-invalid'));

  const capAddStack = parseStackMessages(filterEffectBreakdown(cap, 'add_stack', 'synthetic_batch_h_cap'));
  const capStatModifier = parseStackMessages(filterEffectBreakdown(cap, 'stat_modifier', 'synthetic_batch_h_cap'));
  const capSpeeds = cap?.attackIntervalTimeline.map((row) => row.rawAttackSpeed).filter(Number.isFinite) ?? [];
  const capMaxAfter = maxObserved(capAddStack.map((entry) => entry.after));
  const capMaxStatStacks = maxObserved(capStatModifier.map((entry) => entry.stacks));
  const capMinSpeed = minObserved(capSpeeds);
  const capMaxSpeed = maxObserved(capSpeeds);

  const expiryAddStack = parseStackMessages(filterEffectBreakdown(expiry, 'add_stack', 'synthetic_batch_h_expiry'));
  const expiryStatModifier = parseStackMessages(filterEffectBreakdown(expiry, 'stat_modifier', 'synthetic_batch_h_expiry'));
  const expiryMaxStatStacks = maxObserved(expiryStatModifier.map((entry) => entry.stacks));

  const invalidReasons = invalid?.blockedReasons ?? [];
  const stackApplied = cap?.status === 'ok'
    && capAddStack.length > 0
    && capStatModifier.length > 0
    && capMaxSpeed > capMinSpeed;
  const capReached = cap?.status === 'ok'
    && capMaxAfter === 4
    && capMaxStatStacks === 4
    && capAddStack.every((entry) => entry.after <= 4);
  const expiryObserved = expiry?.status === 'ok'
    && expiryAddStack.length > 1
    && expiryAddStack.every((entry) => entry.before === 0 && entry.after === 1)
    && expiryMaxStatStacks === 1;
  const invalidBlocked = invalid?.status === 'blocked'
    && invalidReasons.some((reason) => reason.includes('requires matching add_stack'));

  return {
    stackApplied,
    capReached,
    expiryObserved,
    invalidBlocked,
    stackHint: `add_stack=${capAddStack.length}, stat_modifier=${capStatModifier.length}, rawAS=${formatEvidenceRange(capMinSpeed, capMaxSpeed)}`,
    capHint: `max after=${capMaxAfter}, max modifier stacks=${capMaxStatStacks}`,
    expiryHint: `resets=${expiryAddStack.length}, max modifier stacks=${expiryMaxStatStacks}`,
    invalidHint: invalidReasons.join(' / ') || 'not blocked'
  };
}

function filterEffectBreakdown(result: V2DpsCurveResult | undefined, kind: string, sourceToken: string): V2DpsCurveResult['effectBreakdown'] {
  return result?.effectBreakdown.filter((entry) => entry.kind === kind && String(entry.source ?? '').includes(sourceToken)) ?? [];
}

function parseStackMessages(entries: V2DpsCurveResult['effectBreakdown']): Array<{ before: number; after: number; stacks: number }> {
  return entries.map((entry) => ({
    before: readMessageInt(entry.message, 'before'),
    after: readMessageInt(entry.message, 'after'),
    stacks: readMessageInt(entry.message, 'stacks')
  }));
}

function readMessageInt(message: string | undefined, key: string): number {
  const match = (message ?? '').match(new RegExp(`${key}=(\\d+)`));
  const value = Number(match?.[1] ?? NaN);
  return Number.isFinite(value) ? value : 0;
}

function maxObserved(values: number[]): number {
  return values.length > 0 ? Math.max(...values) : 0;
}

function minObserved(values: number[]): number {
  return values.length > 0 ? Math.min(...values) : 0;
}

function formatEvidenceRange(min: number, max: number): string {
  return `${formatCompactNumber(min)} -> ${formatCompactNumber(max)}`;
}

function formatPassStatus(passed: boolean): string {
  return passed ? 'pass' : 'missing';
}

function getCurveHeroId(selection: V2DpsSelection, curve: V2DpsCurveSelection): string {
  return curve.attackerHeroId ?? selection.attackerHeroId;
}

function stripActorIdPrefix(label: string): string {
  return label.replace(/^hero_[^/]+\s*\/\s*/, '').trim() || label;
}

function emptyGameDataBundle(): GameDataBundle {
  return {
    meta: {
      gameId: '',
      versionCode: '',
      generatedAt: '',
      versionId: 0,
      dataHash: ''
    },
    attributeDefinitions: [],
    coefficientBuckets: [],
    types: [],
    typeRelations: [],
    statusActionControlRules: [],
    heroes: [],
    skills: [],
    items: []
  };
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
    equipmentSet: firstCurve?.selection.equipmentSet ?? [],
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
