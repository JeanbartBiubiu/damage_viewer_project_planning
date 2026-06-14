import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Alert, Button, Collapse, Form, Grid, Input, InputNumber, Select, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { IconCopy, IconDelete, IconPlayArrow, IconPlus, IconRefresh } from '@arco-design/web-react/icon';
import { EntitySelectOptionLabel, filterEntitySelectOption } from '../components/EntitySelectOption';
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
  resolveV2DpsEnabledScenarioStateIds,
  formatV2DpsMultiHeroCurveLabel,
  getDefaultV2DpsPassiveIdsForHero,
  getDefaultV2DpsScenarioIdsForHero,
  inspectV2DpsEnergizedBundle,
  inspectV2DpsStackingPassiveBundle,
  listV2DpsAttackers,
  listV2DpsEquipmentOptions,
  listV2DpsTargetEquipmentOptions,
  listV2DpsPassiveOptionsForHero,
  listV2DpsScenarioOptions,
  listV2DpsScenarioOptionsForHero,
  listV2DpsTargetDummyGroups,
  prepareV2DpsInput,
  STRICT_DPS_SKILL_REF_OPTIONS,
  buildExecuteEvidenceByCurve,
  buildExecuteEvidenceFromCurveResult,
  buildPassiveCooldownEvidenceFromCurveResult,
  V2_DPS_CASE_ID,
  V2_DPS_INVALID_TARGET_REASON,
  V2_DPS_MISSING_BASIC_ATTACK_REASON,
  V2_DPS_TARGET_PASSIVE_MISSING_TARGET_OWNER_ROLE_REASON,
  V2_DPS_TARGET_PASSIVE_OWNER_ROLE_MISMATCH_REASON,
  V2_DPS_ENERGIZED_DAMAGE_SOURCE,
  V2_DPS_ENERGIZED_ITEM_ID,
  V2_DPS_ENERGIZED_SCENARIO_STATE_ID,
  V2_DPS_ENERGIZED_SKILL_ID,
  V2_DPS_STACKING_PASSIVE_CASE_ID,
  V2_DPS_STACKING_PASSIVE_ITEM_ID,
  V2_DPS_STACKING_PASSIVE_SKILL_ID,
  type V2DpsBasicAttackAction,
  type V2DpsCurveResult,
  type V2DpsCurveSelection,
  type V2DpsCritContext,
  type V2DpsNumericBoundEvidence,
  type V2DpsOutput,
  type V2DpsPassiveEffect,
  type V2DpsPreparedInput,
  type V2DpsSelection,
  type V2DpsEnergizedBundleCheck,
  type V2DpsStackingPassiveBundleCheck,
  type V2DpsExecuteEvidence,
  type V2DpsPassiveCooldownEvidence,
  type V2DpsPassiveCooldownEvidenceSummary,
  type EquipmentSkillRefDiagnostic
} from '../engine/tinygoV2DpsAdapter';
import { summarizeCompiledStatusEvidence } from '../engine/tinygoV2BundleAdapter';
import { TinyGoV2Bridge, TinyGoV2InvocationError, decodeFramePayload, type TinyGoV2Frame } from '../engine/tinygoV2Bridge';
import { getErrorMessage } from '../services/apiClient';
import { loadPublishedBundleSnapshot } from '../services/bundleSnapshot';
import { buildHeroImageUri, buildItemImageUri } from '../services/resourceImage';
import { useResourceImageCache } from './admin/resources/shared/useResourceImageCache';
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
  phantomEvidencePass: boolean;
  stackHint: string;
  capHint: string;
  expiryHint: string;
  invalidHint: string;
  phantomHint: string;
};

type EnergizedEvidence = {
  naturalStatusOk: boolean;
  naturalChargeKinds: boolean;
  naturalGainReady: boolean;
  naturalProcDamage: boolean;
  fullChargeImmediateProc: boolean;
  itemPassiveTriggersPresent: boolean;
  naturalStatusHint: string;
  naturalChargeKindsHint: string;
  naturalGainReadyHint: string;
  naturalProcDamageHint: string;
  fullChargeImmediateProcHint: string;
  itemPassiveTriggersHint: string;
};

type ChartMode = 'damage' | 'hp';

type EventTimelineIconHints = {
  curveLabel: string;
  heroIconSrc: string | null;
  itemIconSrc: string | null;
};

type EventTimelineLane = {
  id: 'attack' | 'damage' | 'itemPassive' | 'skillPassive' | 'effect' | 'hp';
  label: string;
};

type EventTimelinePoint = {
  id: string;
  timeMs: number;
  laneIndex: number;
  laneLabel: string;
  y: number;
  category: string;
  label: string;
  source?: string;
  detailRows: string[];
  symbol: string;
  symbolSize: number;
  color: string;
};

type EventTimelineConnector = {
  from: [number, number];
  to: [number, number];
};

type BasicAttackEvidenceRow = V2DpsBasicAttackAction & {
  key: string;
  curveId: string;
  curveLabel: string;
};

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
  const isSingleHero = mode === 'singleHero';
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
  const eventTimelineElementRef = useRef<HTMLDivElement | null>(null);
  const eventTimelineChartRef = useRef<echarts.ECharts | null>(null);
  const { imageSrcByUri } = useResourceImageCache(selectedGameId);

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

  const resolveHeroImageSrc = useCallback(
    (heroId: string) => {
      const imageUri = buildHeroImageUri(heroId);
      return imageUri ? imageSrcByUri[imageUri] ?? null : null;
    },
    [imageSrcByUri]
  );
  const resolveItemImageSrc = useCallback(
    (itemId: string) => {
      const imageUri = buildItemImageUri(itemId);
      return imageUri ? imageSrcByUri[imageUri] ?? null : null;
    },
    [imageSrcByUri]
  );
  const renderHeroOptionLabel = useCallback(
    (heroId: string, label: string) => (
      <EntitySelectOptionLabel
        primary={stripActorIdPrefix(label)}
        secondary={heroId}
        imageSrc={resolveHeroImageSrc(heroId)}
        showImage
        imageAlt={stripActorIdPrefix(label)}
      />
    ),
    [resolveHeroImageSrc]
  );
  const renderItemOptionLabel = useCallback(
    (itemId: string, label: string, statsLabel?: string) => (
      <EntitySelectOptionLabel
        primary={stripItemIdPrefix(label)}
        secondary={itemId}
        meta={statsLabel}
        imageSrc={resolveItemImageSrc(itemId)}
        showImage
        imageAlt={stripItemIdPrefix(label)}
      />
    ),
    [resolveItemImageSrc]
  );

  const attackerOptions = useMemo(() => (bundle ? listV2DpsAttackers(bundle) : []), [bundle]);
  const targetDummyGroups = useMemo(() => (bundle ? listV2DpsTargetDummyGroups(bundle) : []), [bundle]);
  const targetDummyActorIds = useMemo(
    () => new Set(targetDummyGroups.flatMap((group) => group.actors.map((actor) => actor.actorId))),
    [targetDummyGroups]
  );
  const equipmentOptions = useMemo(() => (bundle ? listV2DpsEquipmentOptions(bundle) : []), [bundle]);
  const targetEquipmentOptions = useMemo(() => (bundle ? listV2DpsTargetEquipmentOptions(bundle) : []), [bundle]);
  const equipmentLabelById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const option of equipmentOptions) {
      labels.set(option.itemId, stripItemIdPrefix(option.label));
    }
    for (const option of targetEquipmentOptions) {
      if (!labels.has(option.itemId)) {
        labels.set(option.itemId, stripItemIdPrefix(option.label));
      }
    }
    return labels;
  }, [equipmentOptions, targetEquipmentOptions]);
  const targetEquipmentStatsLabelById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const option of targetEquipmentOptions) {
      labels.set(option.itemId, option.statsLabel);
    }
    return labels;
  }, [targetEquipmentOptions]);
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
    if (!bundle || !selection) {
      return [];
    }
    const options = new Map<string, { id: string; label: string }>();
    for (const curve of selection.curves) {
      const heroId = getCurveHeroId(selection, curve);
      const heroLabel = heroLabelById.get(heroId) ?? heroId;
      for (const option of listV2DpsScenarioOptions(bundle, heroId, multiHeroGlobalEquipmentItemIds)) {
        if (!options.has(option.id)) {
          const prefix = option.itemId ? '' : `${heroLabel} / `;
          options.set(option.id, { id: option.id, label: `${prefix}${option.label}` });
        }
      }
    }
    return Array.from(options.values());
  }, [bundle, heroLabelById, multiHeroGlobalEquipmentItemIds, selection]);
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
  const energizedBundleCheck = useMemo<V2DpsEnergizedBundleCheck | null>(
    () => (bundle && isSingleHero ? inspectV2DpsEnergizedBundle(bundle) : null),
    [bundle, isSingleHero]
  );
  const hasBatchNCurveSelection = useMemo(
    () => selection?.curves.some((curve) => isBatchNCurveId(curve.curveId)) ?? false,
    [selection]
  );
  const hasBatchNCurveOutput = useMemo(
    () => wasmOutput?.curveResults.some((result) => isBatchNCurveId(result.curveId)) ?? false,
    [wasmOutput]
  );
  const showBatchNAssertions = isSingleHero && (
    energizedBundleCheck?.itemFound === true
    || hasBatchNCurveSelection
    || hasBatchNCurveOutput
  );

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
  const energizedEvidence = useMemo<EnergizedEvidence | null>(
    () => (showBatchNAssertions && wasmOutput ? buildEnergizedEvidence(wasmOutput.curveResults) : null),
    [showBatchNAssertions, wasmOutput]
  );
  const dpsInputPreview = useMemo(() => {
    if (!bundle || !selection || !currentVersion) {
      return null;
    }
    return prepareV2DpsInput(bundle, selection, currentVersion.versionCode, '', STRICT_DPS_SKILL_REF_OPTIONS);
  }, [bundle, currentVersion, selection]);
  const preflightBlockedReasons = dpsInputPreview?.preflightBlockedReasons ?? [];
  const canRun = Boolean(
    bundle
    && currentVersion
    && selection
    && selectedGameId
    && selection.curves.length > 0
    && selection.targetActorId
    && targetDummyActorIds.has(selection.targetActorId)
  )
    && preflightBlockedReasons.length === 0
    && runStatus !== 'loading';
  const curveEvidenceInput = preparedInput ?? dpsInputPreview;
  const preparedCurveById = useMemo(() => {
    const map = new Map(curveEvidenceInput?.runInput.curves.map((curve) => [curve.curveId, curve]) ?? []);
    return map;
  }, [curveEvidenceInput]);
  const resolvedActiveCurveId = useMemo(() => {
    if (activeCurveResult?.curveId) {
      return activeCurveResult.curveId;
    }
    if (activeCurveId) {
      return activeCurveId;
    }
    return curveEvidenceInput?.runInput.curves[0]?.curveId ?? null;
  }, [activeCurveId, activeCurveResult, curveEvidenceInput]);
  const activeCurvePrepared = useMemo(
    () => (resolvedActiveCurveId ? preparedCurveById.get(resolvedActiveCurveId) : undefined),
    [preparedCurveById, resolvedActiveCurveId]
  );
  const basicAttackEvidenceRows = useMemo<BasicAttackEvidenceRow[]>(() => {
    if (!curveEvidenceInput) {
      return [];
    }
    return curveEvidenceInput.runInput.curves.flatMap((curve) => (
      curve.resolvedSnapshot.basicAttackActions.map((action, index) => ({
        ...action,
        key: `${curve.curveId}-${action.actionId}-${action.skillId}-${index}`,
        curveId: curve.curveId,
        curveLabel: curve.label
      }))
    ));
  }, [curveEvidenceInput]);
  const activeBasicAttackActions = activeCurvePrepared?.resolvedSnapshot.basicAttackActions ?? [];
  const activePassiveEffectsByOwnerRole = useMemo(
    () => groupPassiveEffectsByOwnerRole(activeCurvePrepared?.resolvedSnapshot.passiveEffects ?? []),
    [activeCurvePrepared]
  );
  const selectedTargetEquipmentSummary = useMemo(() => {
    const itemIds = selection?.targetEquipmentItemIds ?? [];
    if (itemIds.length === 0) {
      return { labels: '无目标装备', statsLabel: '—' };
    }
    const labels = itemIds.map((itemId) => `${itemId} / ${equipmentLabelById.get(itemId) ?? itemId}`).join(' + ');
    const statsLabel = formatEquipmentStatsRecord(activeCurvePrepared?.resolvedSnapshot.targetEquipmentStats ?? {});
    return { labels, statsLabel: statsLabel || 'no stats' };
  }, [activeCurvePrepared, equipmentLabelById, selection?.targetEquipmentItemIds]);
  const activeBasicAttackActionsForDisplay = useMemo(() => {
    if (activeBasicAttackActions.length > 0) {
      return activeBasicAttackActions;
    }
    return basicAttackEvidenceRows
      .filter((row) => row.curveId === resolvedActiveCurveId)
      .map(({ key: _key, curveId: _curveId, curveLabel: _curveLabel, ...action }) => action);
  }, [activeBasicAttackActions, basicAttackEvidenceRows, resolvedActiveCurveId]);
  const activeCurveLabel = activeCurveResult
    ? curveLabelById.get(activeCurveResult.curveId) ?? activeCurveResult.curveId
    : activeCurveConfig?.label ?? '';
  const activeHeroIconSrc = activeCurveResult?.selection.heroId
    ? resolveHeroImageSrc(activeCurveResult.selection.heroId)
    : null;
  const activeItemIconSrc = activeCurveResult?.selection.equipmentSet[0]
    ? resolveItemImageSrc(activeCurveResult.selection.equipmentSet[0])
    : null;
  const compiledStatusEvidence = useMemo(
    () => summarizeCompiledStatusEvidence(preparedInput?.engineBundle.statuses),
    [preparedInput]
  );
  const executeEvidenceByCurve = useMemo(
    () => buildExecuteEvidenceByCurve(wasmOutput?.curveResults ?? [], activeCurveResult?.curveId),
    [activeCurveResult?.curveId, wasmOutput?.curveResults]
  );
  const activeExecuteEvidence = useMemo<V2DpsExecuteEvidence | null>(() => {
    if (!activeCurveResult) {
      return null;
    }
    return buildExecuteEvidenceFromCurveResult(activeCurveResult);
  }, [activeCurveResult]);
  const activePassiveCooldownEvidence = useMemo<V2DpsPassiveCooldownEvidenceSummary | null>(() => {
    if (!activeCurveResult) {
      return null;
    }
    return buildPassiveCooldownEvidenceFromCurveResult(activeCurveResult);
  }, [activeCurveResult]);
  const exportPayload = useMemo(() => {
    if (!wasmOutput || !preparedInput) {
      return null;
    }
    return {
      caseId: wasmOutput.caseId,
      versionCode: wasmOutput.versionCode,
      wasmSha256: wasmOutput.wasmSha256,
      activeCurveId: activeCurveResult?.curveId ?? wasmOutput.curveResults[0]?.curveId,
      preflightBlockedReasons: preparedInput.preflightBlockedReasons,
      selection: buildExportSelection(preparedInput),
      resolvedSnapshot: buildExportResolvedSnapshot(preparedInput),
      compileEvidence: {
        basicAttackCritByCurve: preparedInput.runInput.curves.map((curve) => ({
          curveId: curve.curveId,
          label: curve.label,
          basicAttackActions: curve.resolvedSnapshot.basicAttackActions.map((action) => ({
            actionId: action.actionId,
            skillId: action.skillId,
            critPolicy: action.critPolicy,
            critChanceSource: action.critChanceSource,
            critChance: action.critChance,
            critMultiplierSource: action.critMultiplierSource,
            critMultiplier: action.critMultiplier
          }))
        })),
        compiledStatusEvidence
      },
      simulationRules: wasmOutput.simulationRules,
      targetSnapshot: wasmOutput.targetSnapshot,
      runInput: preparedInput.runInput,
      curveResults: wasmOutput.curveResults,
      executeEvidence: executeEvidenceByCurve,
      wasmOutput
    };
  }, [activeCurveResult, compiledStatusEvidence, executeEvidenceByCurve, preparedInput, wasmOutput]);

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

  useEffect(() => {
    if (!eventTimelineElementRef.current) {
      return;
    }
    const chart = eventTimelineChartRef.current ?? echarts.init(eventTimelineElementRef.current);
    eventTimelineChartRef.current = chart;
    chart.setOption(buildEventTimelineOption(activeCurveResult, {
      curveLabel: activeCurveLabel,
      heroIconSrc: activeHeroIconSrc,
      itemIconSrc: activeItemIconSrc
    }), true);

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [activeCurveLabel, activeCurveResult, activeHeroIconSrc, activeItemIconSrc]);

  useEffect(() => () => {
    chartRef.current?.dispose();
    chartRef.current = null;
    eventTimelineChartRef.current?.dispose();
    eventTimelineChartRef.current = null;
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
      const prepared = prepareV2DpsInput(bundle, committedSelection, currentVersion.versionCode, nextWasmSha256, STRICT_DPS_SKILL_REF_OPTIONS);
      if (prepared.preflightBlockedReasons.length > 0) {
        setPreparedInput(prepared);
        setRunStatus('error');
        setRunError(formatPreflightBlockedMessage(prepared.preflightBlockedReasons));
        return;
      }
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
      curves: current.curves.map((curve) => {
        const heroId = getCurveHeroId(current, curve);
        const enabledScenarioStateIds = bundle
          ? resolveV2DpsEnabledScenarioStateIds(bundle, heroId, equipmentItemIds, curve.enabledScenarioStateIds)
          : curve.enabledScenarioStateIds;
        return {
          ...curve,
          equipmentItemIds,
          enabledScenarioStateIds,
          label: bundle ? formatV2DpsMultiHeroCurveLabel(bundle, heroId, equipmentItemIds) : curve.label
        };
      })
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
      curves: current.curves.map((curve) => {
        if (curve.curveId !== curveId) {
          return curve;
        }
        const enabledScenarioStateIds = bundle
          ? resolveV2DpsEnabledScenarioStateIds(bundle, attackerHeroId, curve.equipmentItemIds, curve.enabledScenarioStateIds)
          : curve.enabledScenarioStateIds;
        return {
          ...curve,
          attackerHeroId,
          label: bundle ? formatV2DpsMultiHeroCurveLabel(bundle, attackerHeroId, curve.equipmentItemIds) : curve.label,
          enabledPassiveEffectIds: getDefaultV2DpsPassiveIdsForHero(attackerHeroId),
          enabledScenarioStateIds
        };
      })
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
      title: <span className="wasm-hud-col-title">source</span>,
      render: (_: unknown, record: DamageRow) => <Typography.Text className="wasm-code-token">{record.source}</Typography.Text>
    },
    {
      title: <span className="wasm-hud-col-title">evidence</span>,
      render: (_: unknown, record: DamageRow) => formatDamageEvidenceTags(record)
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
    ? 'V2 DPS Batch K Stacking Passive'
    : isMultiHero ? 'V2 DPS 多英雄同装备' : 'V2 DPS 单英雄多曲线';
  const pageKicker = isStackingPassive
    ? 'single_attacker_dps / v2_batch_k_guinsoo_phantom_hit'
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
        {curveEvidenceInput && curveEvidenceInput.preflightBlockedReasons.length > 0 ? (
          <Alert
            type="warning"
            content={formatPreflightBlockedMessage(curveEvidenceInput.preflightBlockedReasons)}
          />
        ) : null}
        {isStackingPassive && syntheticFallbackReason ? (
          <Alert
            type="warning"
            content={`Published bundle load failed; Batch H/K synthetic runtime preset is active. ${syntheticFallbackReason}`}
          />
        ) : null}
        {isStackingPassive && stackingPassiveCheck ? (
          <Alert
            type={stackingPassiveCheck.ready ? 'success' : 'warning'}
            content={formatStackingPassiveCheckMessage(stackingPassiveCheck)}
          />
        ) : null}
        {showBatchNAssertions && energizedBundleCheck ? (
          <Alert
            type={energizedBundleCheck.ready ? 'success' : 'warning'}
            content={formatEnergizedCheckMessage(energizedBundleCheck)}
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
                    filterOption={filterEntitySelectOption}
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
                      <Select.Option
                        key={option.actorId}
                        value={option.actorId}
                      >
                        {renderHeroOptionLabel(option.actorId, option.label)}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            ) : null}
            <Col span={8}>
              <Form.Item label="目标 actor (target_dummy)">
                <Select
                  value={selection?.targetActorId ?? ''}
                  showSearch
                  filterOption={filterEntitySelectOption}
                  onChange={(value) => updateSelection((current) => ({ ...current, targetActorId: String(value) }))}
                  disabled={!selection || targetDummyGroups.length === 0}
                  placeholder={targetDummyGroups.length === 0 ? 'published bundle 缺少 target_dummy' : '选择 target_dummy'}
                >
                  {targetDummyGroups.map((group) => (
                    <Select.OptGroup key={group.typeKey} label={group.label}>
                      {group.actors.map((option) => (
                        <Select.Option
                          key={option.actorId}
                          value={option.actorId}
                        >
                          {renderHeroOptionLabel(option.actorId, option.label)}
                        </Select.Option>
                      ))}
                    </Select.OptGroup>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item label="目标装备 (全局)">
                <Select
                  mode="multiple"
                  value={selection?.targetEquipmentItemIds ?? []}
                  showSearch
                  filterOption={filterEntitySelectOption}
                  onChange={(value) => updateSelection((current) => ({
                    ...current,
                    targetEquipmentItemIds: normalizeSelectValues(value)
                  }))}
                  disabled={!selection || targetEquipmentOptions.length === 0}
                  placeholder="选择目标侧防御装备；反甲/兰顿等需 published bundle 含 ownerRole=target 被动"
                >
                  {targetEquipmentOptions.map((option) => (
                    <Select.Option
                      key={option.itemId}
                      value={option.itemId}
                    >
                      {renderItemOptionLabel(option.itemId, option.label, option.statsLabel)}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label="目标装备摘要">
                <Space direction="vertical" size={4}>
                  <Typography.Text>{selectedTargetEquipmentSummary.labels}</Typography.Text>
                  <Typography.Text type="secondary">
                    装备属性合并: {selectedTargetEquipmentSummary.statsLabel}
                  </Typography.Text>
                  {(selection?.targetEquipmentItemIds ?? []).map((itemId) => (
                    <Typography.Text key={itemId} type="secondary" className="wasm-code-token">
                      {itemId}: {targetEquipmentStatsLabelById.get(itemId) ?? 'no stats'}
                    </Typography.Text>
                  ))}
                </Space>
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
                    filterOption={filterEntitySelectOption}
                    onChange={(value) => updateMultiHeroGlobalEquipment(normalizeSelectValues(value))}
                    disabled={!selection || equipmentOptions.length === 0}
                    placeholder="选择同一套装备"
                  >
                    {equipmentOptions.map((option) => (
                      <Select.Option
                        key={option.itemId}
                        value={option.itemId}
                      >
                        {renderItemOptionLabel(option.itemId, option.label, option.statsLabel)}
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
                    filterOption={filterEntitySelectOption}
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
              const curveScenarioOptions = bundle
                ? listV2DpsScenarioOptions(bundle, curveHeroId, curve.equipmentItemIds)
                : listV2DpsScenarioOptionsForHero(curveHeroId);
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
                        <Tag color={getCurveBasicAttackCount(preparedCurveById.get(curve.curveId)) > 0 ? 'green' : 'orange'}>
                          普攻 {formatCurveBasicAttackSummary(preparedCurveById.get(curve.curveId))}
                        </Tag>
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
                            filterOption={filterEntitySelectOption}
                            onChange={(value) => updateMultiHeroCurveHero(curve.curveId, String(value))}
                          >
                            {attackerOptions.map((option) => (
                              <Select.Option
                                key={option.actorId}
                                value={option.actorId}
                              >
                                {renderHeroOptionLabel(option.actorId, option.label)}
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
                          filterOption={filterEntitySelectOption}
                          onChange={(value) => {
                            const equipmentItemIds = normalizeSelectValues(value);
                            const enabledScenarioStateIds = bundle
                              ? resolveV2DpsEnabledScenarioStateIds(bundle, curveHeroId, equipmentItemIds, curve.enabledScenarioStateIds)
                              : curve.enabledScenarioStateIds;
                            updateCurve(curve.curveId, { equipmentItemIds, enabledScenarioStateIds });
                          }}
                          disabled={equipmentOptions.length === 0}
                          placeholder="选择 ADC 成装；缺失 published bundle 数据时该 curve 会 blocked"
                        >
                          {equipmentOptions.map((option) => (
                            <Select.Option
                              key={option.itemId}
                              value={option.itemId}
                            >
                              {renderItemOptionLabel(option.itemId, option.label, option.statsLabel)}
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

        {activeExecuteEvidence && (activeExecuteEvidence.count > 0 || activeExecuteEvidence.stopReason) ? (
          <Panel title="Execute Threshold 证据" kicker="effectBreakdown kind=execute_threshold">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text>
                当前曲线 execute 证据：count={activeExecuteEvidence.count}，triggered={activeExecuteEvidence.triggeredCount}
                {activeExecuteEvidence.sources.length > 0 ? `，sources=${activeExecuteEvidence.sources.join(', ')}` : ''}
              </Typography.Text>
              {activeExecuteEvidence.stopReason ? (
                <Typography.Text type="warning">
                  stopReason={activeExecuteEvidence.stopReason}
                </Typography.Text>
              ) : null}
              {activeExecuteEvidence.entries.length > 0 ? (
                <JsonBlock value={activeExecuteEvidence.entries} />
              ) : null}
            </Space>
          </Panel>
        ) : null}

        {activePassiveCooldownEvidence && activePassiveCooldownEvidence.count > 0 ? (
          <Panel title="Passive Cooldown 证据" kicker="effectBreakdown kind=passive_cooldown">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text>
                当前曲线 passive cooldown 证据：count={activePassiveCooldownEvidence.count}
                ，triggered={activePassiveCooldownEvidence.triggeredCount}
                ，skipped={activePassiveCooldownEvidence.skippedCount}
                {activePassiveCooldownEvidence.sources.length > 0
                  ? `，sources=${activePassiveCooldownEvidence.sources.join(', ')}`
                  : ''}
              </Typography.Text>
              {activePassiveCooldownEvidence.entries.length > 0 ? (
                <JsonBlock value={activePassiveCooldownEvidence.entries} />
              ) : null}
            </Space>
          </Panel>
        ) : null}

        <Panel title="DPS Passive 摘要" kicker="resolvedSnapshot.passiveEffects grouped by ownerRole">
          {curveEvidenceInput && activeCurvePrepared ? (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {(['attacker', 'target', 'other'] as const).map((ownerRole) => {
                const passives = activePassiveEffectsByOwnerRole.get(ownerRole) ?? [];
                if (passives.length === 0) {
                  return null;
                }
                return (
                  <div key={ownerRole}>
                    <Typography.Text bold>{formatPassiveOwnerRoleLabel(ownerRole)} ({passives.length})</Typography.Text>
                    <JsonBlock value={passives.map(formatPassiveEffectSummary)} />
                  </div>
                );
              })}
              {activePassiveEffectsByOwnerRole.size === 0 ? (
                <Typography.Text type="secondary">当前曲线没有解析到 passiveEffects。</Typography.Text>
              ) : null}
              {activeCurvePrepared.resolvedSnapshot.targetEnabledPassiveEffects?.length ? (
                <Typography.Text type="secondary">
                  targetEnabledPassiveEffects: {activeCurvePrepared.resolvedSnapshot.targetEnabledPassiveEffects.join(', ')}
                </Typography.Text>
              ) : null}
              {curveEvidenceInput.equipmentSkillRefDiagnostics.length > 0 ? (
                <div>
                  <Typography.Text bold>
                    equipmentSkillRefDiagnostics ({curveEvidenceInput.equipmentSkillRefDiagnostics.length})
                  </Typography.Text>
                  <Table
                    rowKey={(record) => `${record.audience}-${record.itemId}-${record.skillId ?? ''}-${record.code}`}
                    size="small"
                    pagination={false}
                    className="data-table-shell"
                    style={{ marginTop: 8 }}
                    data={curveEvidenceInput.equipmentSkillRefDiagnostics}
                    columns={equipmentSkillRefDiagnosticColumns}
                  />
                </div>
              ) : (
                <Typography.Text type="secondary">equipmentSkillRefDiagnostics: 无</Typography.Text>
              )}
            </Space>
          ) : (
            <EmptyState
              title="尚未解析 passive"
              description="配置目标/攻击者装备后，adapter 会把 bundle dpsPassiveEffects 投影进 resolvedSnapshot.passiveEffects。"
            />
          )}
        </Panel>

        <Panel title="普攻 Skill 解析" kicker="bundle.skillMounts -> skill -> action classifier -> basicAttackActions">
          {curveEvidenceInput ? (
            <>
              {activeBasicAttackActionsForDisplay.length > 0 ? (
                <JsonBlock value={activeBasicAttackActionsForDisplay} />
              ) : (
                <Alert
                  type="warning"
                  content={formatMissingBasicAttackMessage(activeCurvePrepared?.resolvedSnapshot.preflightBlockedReasons)}
                />
              )}
              {basicAttackEvidenceRows.length > 0 ? (
                <Table
                  rowKey="key"
                  size="small"
                  pagination={false}
                  className="data-table-shell"
                  style={{ marginTop: 12 }}
                  data={basicAttackEvidenceRows}
                  columns={basicAttackEvidenceColumns}
                />
              ) : null}
            </>
          ) : (
            <EmptyState
              title="尚未解析普攻 skill"
              description="运行后将根据 published bundle.skillMounts 与 typeRelations 展示当前曲线解析到的 action/basic_attack。"
            />
          )}
        </Panel>

        {energizedEvidence ? (
          <Panel title="Batch N Assertions" kicker="published 6699 Voltaic energized charge wasm evidence">
            <Row gutter={[16, 16]} className="wasm-validation-grid">
              <Col span={6}>
                <MetricCard
                  label="Natural Status"
                  value={formatPassStatus(energizedEvidence.naturalStatusOk)}
                  hint={energizedEvidence.naturalStatusHint}
                />
              </Col>
              <Col span={6}>
                <MetricCard
                  label="Charge Breakdown"
                  value={formatPassStatus(energizedEvidence.naturalChargeKinds)}
                  hint={energizedEvidence.naturalChargeKindsHint}
                />
              </Col>
              <Col span={6}>
                <MetricCard
                  label="Gain Ready"
                  value={formatPassStatus(energizedEvidence.naturalGainReady)}
                  hint={energizedEvidence.naturalGainReadyHint}
                />
              </Col>
              <Col span={6}>
                <MetricCard
                  label="Natural Proc"
                  value={formatPassStatus(energizedEvidence.naturalProcDamage)}
                  hint={energizedEvidence.naturalProcDamageHint}
                />
              </Col>
            </Row>
            <Row gutter={[16, 16]} className="wasm-validation-grid">
              <Col span={6}>
                <MetricCard
                  label="Full Charge t=0"
                  value={formatPassStatus(energizedEvidence.fullChargeImmediateProc)}
                  hint={energizedEvidence.fullChargeImmediateProcHint}
                />
              </Col>
              <Col span={6}>
                <MetricCard
                  label="Item Passive Triggers"
                  value={formatPassStatus(energizedEvidence.itemPassiveTriggersPresent)}
                  hint={energizedEvidence.itemPassiveTriggersHint}
                />
              </Col>
            </Row>
          </Panel>
        ) : null}

        {stackingPassiveEvidence ? (
          <Panel title="Batch K Assertions" kicker="Batch H synthetic presets + published 3124 phantom-hit wasm evidence">
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
            <Row gutter={[16, 16]} className="wasm-validation-grid">
              <Col span={6}>
                <MetricCard
                  label="Phantom Hit (3124)"
                  value={formatPassStatus(stackingPassiveEvidence.phantomEvidencePass)}
                  hint={stackingPassiveEvidence.phantomHint}
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

        <Panel
          title="事件时间线"
          kicker="attack -> passive -> damage -> hp"
          actions={<Tag color={activeCurveResult ? 'green' : 'gray'}>{activeCurveResult ? 'hover for details' : 'not run'}</Tag>}
        >
          {activeCurveResult ? (
            <>
              <div ref={eventTimelineElementRef} className="v2-dps-event-timeline" data-testid="v2-dps-event-timeline" />
              <Typography.Text type="secondary" className="v2-dps-event-timeline-note">
                虚线连接表示按同一 timeMs 或最近上一普攻推断出的触发关系；完整字段仍保留在下方调试明细。
              </Typography.Text>
            </>
          ) : (
            <EmptyState title="还没有事件时间线" description="运行后将把普攻、伤害、被动触发、效果拆解和 HP 汇总到同一张时间图。" />
          )}
        </Panel>
      </div>

      <Panel title="调试明细" kicker="raw timelines / JSON" actions={<Tag color="gray">默认收起</Tag>}>
        <Collapse defaultActiveKey={[]} className="v2-dps-debug-collapse">
          <Collapse.Item
            name="raw-v2-dps-timelines"
            header={`原始明细：attack ${attackRows.length} / damage ${damageRows.length} / itemPassive ${activeCurveResult?.itemPassiveTriggers.length ?? 0} / effect ${activeCurveResult?.effectBreakdown.length ?? 0}`}
          >
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
          <Panel title="攻击间隔证据" kicker="attackIntervalTimeline">
            {activeCurveResult ? (
              <JsonBlock value={activeCurveResult.attackIntervalTimeline} />
            ) : (
              <EmptyState title="还没有攻击间隔证据" description="运行后展示 wasm 返回的 attackIntervalTimeline。" />
            )}
          </Panel>
        </Col>
        <Col span={12}>
          <Panel title="目标 HP 时间线" kicker="targetHpTimeline">
            {activeCurveResult ? (
              <JsonBlock value={activeCurveResult.targetHpTimeline} />
            ) : (
              <EmptyState title="还没有目标 HP 时间线" description="运行后展示 wasm 返回的 targetHpTimeline。" />
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
          </Collapse.Item>
        </Collapse>
      </Panel>
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
  const prefix = `Batch K real-data contract: item ${V2_DPS_STACKING_PASSIVE_ITEM_ID}, skill ${V2_DPS_STACKING_PASSIVE_SKILL_ID}, skillKey ${check.skillKey}.`;
  if (check.ready) {
    return `${prefix} Published bundle is ready for stacking, copyable on-hit damage, and phantom-hit repeat; synthetic presets can run independently and all mechanics are executed by Wasm.`;
  }
  return `${prefix} Published real-data gate is not ready: ${check.missingReasons.join(' / ')}. Synthetic presets can still run for Batch H runtime evidence; phantom-hit requires published bundle + Wasm output.`;
}

function formatEnergizedCheckMessage(check: V2DpsEnergizedBundleCheck): string {
  const prefix = `Batch N real-data contract: item ${V2_DPS_ENERGIZED_ITEM_ID}, skill ${V2_DPS_ENERGIZED_SKILL_ID}, scenario ${V2_DPS_ENERGIZED_SCENARIO_STATE_ID}, skillKey ${check.skillKey}.`;
  if (check.ready) {
    return `${prefix} Published bundle is ready for energized charge gain/consume and ${V2_DPS_ENERGIZED_DAMAGE_SOURCE} proc evidence; mechanics are executed by Wasm.`;
  }
  return `${prefix} Published real-data gate is not ready: ${check.missingReasons.join(' / ')}. Batch N wasm evidence requires published bundle + Wasm output.`;
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

function isBatchNCurveId(curveId: string): boolean {
  return curveId.includes('batch-n-voltaic-6699');
}

function isBatchNNaturalCurveId(curveId: string): boolean {
  return curveId.includes('batch-n-voltaic-6699') && !curveId.includes('full-charge');
}

function isBatchNFullChargeCurveId(curveId: string): boolean {
  return curveId.includes('batch-n-voltaic-6699-full-charge');
}

function findBatchNNaturalCurveResult(results: V2DpsCurveResult[]): V2DpsCurveResult | undefined {
  return results.find((result) => isBatchNNaturalCurveId(result.curveId));
}

function findBatchNFullChargeCurveResult(results: V2DpsCurveResult[]): V2DpsCurveResult | undefined {
  return results.find((result) => isBatchNFullChargeCurveId(result.curveId));
}

function energizedMessageContains(message: string | undefined, fragment: string): boolean {
  return (message ?? '').includes(fragment);
}

function countEffectBreakdownByKind(result: V2DpsCurveResult | undefined, kind: string): number {
  return result?.effectBreakdown.filter((entry) => entry.kind === kind).length ?? 0;
}

function buildEnergizedEvidence(results: V2DpsCurveResult[]): EnergizedEvidence {
  const natural = findBatchNNaturalCurveResult(results);
  const fullCharge = findBatchNFullChargeCurveResult(results);
  const energizedCurves = results.filter((result) => isBatchNCurveId(result.curveId));

  const naturalStatusOk = natural?.status === 'ok';
  const checkCount = countEffectBreakdownByKind(natural, 'energized_charge_check');
  const gainCount = countEffectBreakdownByKind(natural, 'energized_charge_gain');
  const consumeCount = countEffectBreakdownByKind(natural, 'energized_charge_consume');
  const naturalChargeKinds = checkCount > 0 && gainCount > 0 && consumeCount > 0;

  const gainReadyEntries = natural?.effectBreakdown.filter((entry) => (
    entry.kind === 'energized_charge_gain'
    && energizedMessageContains(entry.message, 'postCharge=100')
    && energizedMessageContains(entry.message, 'readyAfterHit=true')
    && energizedMessageContains(entry.message, 'triggered=false')
  )) ?? [];
  const naturalGainReady = gainReadyEntries.length > 0;

  const naturalProcHits = natural?.damageTimeline.filter((row) => (
    row.source === V2_DPS_ENERGIZED_DAMAGE_SOURCE
    && row.timeMs > 0
  )) ?? [];
  const naturalProcDamage = naturalProcHits.length > 0;

  const fullChargeImmediateHits = fullCharge?.damageTimeline.filter((row) => (
    row.source === V2_DPS_ENERGIZED_DAMAGE_SOURCE
    && row.timeMs === 0
  )) ?? [];
  const fullChargeImmediateProc = fullChargeImmediateHits.length > 0;

  const triggerCounts = energizedCurves.map((curve) => curve.itemPassiveTriggers.length);
  const itemPassiveTriggersPresent = energizedCurves.length > 0 && energizedCurves.every((curve) => curve.itemPassiveTriggers.length > 0);

  const naturalMissing: string[] = [];
  if (!natural) {
    naturalMissing.push('natural curve missing');
  } else if (!naturalStatusOk) {
    naturalMissing.push(`status=${natural.status}`);
  }
  if (!naturalChargeKinds) {
    naturalMissing.push(`check=${checkCount}, gain=${gainCount}, consume=${consumeCount}`);
  }
  if (!naturalGainReady) {
    naturalMissing.push(`gainReady=${gainReadyEntries.length}`);
  }
  if (!naturalProcDamage) {
    naturalMissing.push(`procHits=${naturalProcHits.length}`);
  }

  const fullChargeMissing: string[] = [];
  if (!fullCharge) {
    fullChargeMissing.push('full-charge curve missing');
  } else if (!fullChargeImmediateProc) {
    fullChargeMissing.push(`t0Hits=${fullChargeImmediateHits.length}`);
  }

  const triggerMissing: string[] = [];
  if (energizedCurves.length === 0) {
    triggerMissing.push('no batch-n curves');
  } else if (!itemPassiveTriggersPresent) {
    triggerMissing.push(`triggers=${triggerCounts.join('+')}`);
  }

  return {
    naturalStatusOk,
    naturalChargeKinds,
    naturalGainReady,
    naturalProcDamage,
    fullChargeImmediateProc,
    itemPassiveTriggersPresent,
    naturalStatusHint: naturalMissing.length === 0 ? `status=ok, attacks=${natural?.attackCount ?? 0}` : naturalMissing.join(' / '),
    naturalChargeKindsHint: `check=${checkCount}, gain=${gainCount}, consume=${consumeCount}`,
    naturalGainReadyHint: naturalGainReady
      ? `gainReady=${gainReadyEntries.length}`
      : `missing postCharge=100 readyAfterHit=true triggered=false (${gainReadyEntries.length})`,
    naturalProcDamageHint: naturalProcDamage
      ? `procHits=${naturalProcHits.length}, firstAt=${naturalProcHits[0]?.timeMs ?? 'n/a'}ms`
      : `missing ${V2_DPS_ENERGIZED_DAMAGE_SOURCE} after threshold`,
    fullChargeImmediateProcHint: fullChargeMissing.length === 0
      ? `t0Hits=${fullChargeImmediateHits.length}`
      : fullChargeMissing.join(' / '),
    itemPassiveTriggersHint: triggerMissing.length === 0
      ? `curves=${energizedCurves.length}, triggers=${triggerCounts.join('+')}`
      : triggerMissing.join(' / ')
  };
}

function buildStackingPassiveEvidence(results: V2DpsCurveResult[]): StackingPassiveEvidence {
  const cap = results.find((result) => result.curveId.includes('synthetic-cap'));
  const expiry = results.find((result) => result.curveId.includes('synthetic-expiry'));
  const invalid = results.find((result) => result.curveId.includes('synthetic-invalid'));
  const phantom = buildGuinsooPhantomEvidence(results);

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
    phantomEvidencePass: phantom.pass,
    stackHint: `add_stack=${capAddStack.length}, stat_modifier=${capStatModifier.length}, rawAS=${formatEvidenceRange(capMinSpeed, capMaxSpeed)}`,
    capHint: `max after=${capMaxAfter}, max modifier stacks=${capMaxStatStacks}`,
    expiryHint: `resets=${expiryAddStack.length}, max modifier stacks=${expiryMaxStatStacks}`,
    invalidHint: invalidReasons.join(' / ') || 'not blocked',
    phantomHint: phantom.hint
  };
}

function findGuinsoo3124CurveResult(results: V2DpsCurveResult[]): V2DpsCurveResult | undefined {
  return results.find((result) => result.curveId.includes('guinsoo-3124'));
}

function buildGuinsooPhantomEvidence(results: V2DpsCurveResult[]): { pass: boolean; hint: string } {
  const guinsoo = findGuinsoo3124CurveResult(results);
  if (!guinsoo) {
    return { pass: false, hint: 'guinsoo 3124 curve not found in curveResults' };
  }
  if (guinsoo.status !== 'ok') {
    return { pass: false, hint: `guinsoo 3124 curve status=${guinsoo.status}` };
  }

  const damageTimelineMatch = guinsoo.damageTimeline.some((row) => (
    row.source === 'guinsoos_wrath_on_hit'
    && row.phantomHit === true
    && row.repeatTag === 'phantom_hit'
  ));
  const itemPassiveTriggerMatch = guinsoo.itemPassiveTriggers.some((entry) => hasPhantomHitEvidence(entry));
  const effectBreakdownMatch = guinsoo.effectBreakdown.some((entry) => (
    entry.source === 'guinsoos_wrath_on_hit'
    && entry.phantomHit === true
    && entry.repeatTag === 'phantom_hit'
  ));

  const missing: string[] = [];
  if (!damageTimelineMatch) {
    missing.push('damageTimeline guinsoos_wrath_on_hit phantom_hit');
  }
  if (!itemPassiveTriggerMatch) {
    missing.push('itemPassiveTriggers phantom_hit');
  }
  if (!effectBreakdownMatch) {
    missing.push('effectBreakdown guinsoos_wrath_on_hit phantom_hit');
  }

  if (missing.length === 0) {
    return { pass: true, hint: 'damageTimeline + itemPassiveTriggers + effectBreakdown observed from Wasm' };
  }
  return { pass: false, hint: `missing: ${missing.join(' / ')}` };
}

function hasPhantomHitEvidence(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const record = entry as Record<string, unknown>;
  return record.phantomHit === true && record.repeatTag === 'phantom_hit';
}

function formatDamageEvidenceTags(record: DamageRow) {
  const tags: string[] = [];
  if (record.phantomHit === true) {
    tags.push('phantom');
  }
  if (record.repeatTag) {
    tags.push(record.repeatTag);
  }

  const critTag = formatCritChanceEvidenceTag(record.critContext);
  if (critTag) {
    tags.push(critTag);
  }

  const boundTag = formatNumericBoundEvidenceTag(record.critContext?.boundEvidence);
  if (boundTag) {
    tags.push(boundTag);
  }

  if (tags.length === 0) {
    return <Typography.Text type="secondary">—</Typography.Text>;
  }
  return (
    <Space size={4} wrap>
      {tags.map((tag) => (
        <Tag
          key={tag}
          color={tag.includes('CLAMP') ? 'orangered' : tag.startsWith('crit ') ? 'gold' : tag === 'phantom_hit' ? 'purple' : 'gray'}
        >
          {tag}
        </Tag>
      ))}
    </Space>
  );
}

function formatCritChanceEvidenceTag(critContext?: V2DpsCritContext): string | null {
  if (!critContext?.hasContext) {
    return null;
  }
  if (critContext.chanceRaw === undefined || critContext.chanceEffective === undefined) {
    return null;
  }
  const raw = formatNumber(critContext.chanceRaw);
  const effective = formatNumber(critContext.chanceEffective);
  if (raw === effective) {
    return `crit ${effective}`;
  }
  return `crit ${raw}→${effective}`;
}

function formatNumericBoundEvidenceTag(bound?: V2DpsNumericBoundEvidence): string | null {
  if (!bound) {
    return null;
  }
  if (bound.rawValue === undefined || bound.boundedValue === undefined) {
    return bound.wasClamped ? 'CLAMP' : null;
  }
  const raw = formatNumber(bound.rawValue);
  const bounded = formatNumber(bound.boundedValue);
  const label = bound.key ? `${bound.key} ` : '';
  if (raw === bounded) {
    return bound.wasClamped ? `${label}${bounded} CLAMP` : null;
  }
  return bound.wasClamped ? `${label}${raw}→${bounded} CLAMP` : `${label}${raw}→${bounded}`;
}

function formatCritContextDetailRows(critContext?: V2DpsCritContext): string[] {
  if (!critContext?.hasContext) {
    return [];
  }
  const rows = [
    `critPolicy=${critContext.policy ?? '-'}`,
    `critChanceRaw=${formatNumber(critContext.chanceRaw)}`,
    `critChanceEffective=${formatNumber(critContext.chanceEffective)}`,
    `critMultiplier=${formatNumber(critContext.multiplier)}`
  ];
  if (critContext.expectedNormalPart !== undefined) {
    rows.push(`expectedNormalPart=${formatNumber(critContext.expectedNormalPart)}`);
  }
  if (critContext.expectedCritPart !== undefined) {
    rows.push(`expectedCritPart=${formatNumber(critContext.expectedCritPart)}`);
  }
  if (critContext.hasActualResult) {
    rows.push(`hasActualResult=true isCrit=${critContext.isCrit === true}`);
  }
  return rows;
}

function formatNumericBoundDetailRows(bound?: V2DpsNumericBoundEvidence): string[] {
  if (!bound) {
    return [];
  }
  const rows = [
    `boundKey=${bound.key ?? '-'}`,
    `boundSource=${bound.source ?? '-'}`,
    `boundMode=${bound.mode ?? '-'}`,
    `boundRaw=${formatNumber(bound.rawValue)}`,
    `boundEffective=${formatNumber(bound.boundedValue)}`
  ];
  if (bound.hasMin) {
    rows.push(`boundMin=${formatNumber(bound.min)}`);
  }
  if (bound.hasMax) {
    rows.push(`boundMax=${formatNumber(bound.max)}`);
  }
  if (bound.wasClamped) {
    rows.push('wasClamped=true');
  }
  return rows;
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

const EVENT_TIMELINE_LANES: EventTimelineLane[] = [
  { id: 'attack', label: '普攻/主动' },
  { id: 'damage', label: '伤害' },
  { id: 'itemPassive', label: '装备被动' },
  { id: 'skillPassive', label: '技能被动' },
  { id: 'effect', label: '效果/叠层' },
  { id: 'hp', label: 'HP' }
];

const EVENT_TIMELINE_LANE_INDEX = new Map(EVENT_TIMELINE_LANES.map((lane, index) => [lane.id, index]));

function buildEventTimelineOption(result: V2DpsCurveResult | null, icons: EventTimelineIconHints): echarts.EChartsOption {
  if (!result) {
    return {
      animation: false,
      xAxis: { type: 'value', min: 0 },
      yAxis: { type: 'value', show: false },
      series: []
    };
  }

  const points = spreadEventTimelinePoints(buildEventTimelinePoints(result, icons));
  const connectors = buildEventTimelineConnectors(points);
  const durationMs = Math.max(result.durationMs, ...points.map((point) => point.timeMs), 0);

  return {
    animation: false,
    tooltip: {
      trigger: 'item',
      confine: true,
      borderWidth: 0,
      backgroundColor: 'rgba(17, 24, 39, 0.94)',
      textStyle: { color: '#f8fafc' },
      formatter: (params) => {
        const data = (params as { data?: unknown }).data as Partial<EventTimelinePoint> | undefined;
        if (!data?.detailRows) {
          return '';
        }
        return formatEventTimelineTooltip(data as EventTimelinePoint);
      }
    },
    grid: {
      left: 92,
      right: 28,
      top: 28,
      bottom: 60
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
      { type: 'slider', xAxisIndex: 0, height: 18, bottom: 14, filterMode: 'none' }
    ],
    xAxis: {
      type: 'value',
      name: 'timeMs',
      min: 0,
      max: durationMs,
      axisLabel: {
        formatter: (value: number) => `${formatCompactNumber(value)}ms`
      },
      splitLine: {
        lineStyle: { color: '#e5e7eb', type: 'dashed' }
      }
    },
    yAxis: {
      type: 'value',
      min: -0.6,
      max: EVENT_TIMELINE_LANES.length - 0.4,
      interval: 1,
      inverse: true,
      axisTick: { show: false },
      splitLine: { show: false },
      axisLine: { show: false },
      axisLabel: {
        formatter: (value: number) => EVENT_TIMELINE_LANES[Math.round(value)]?.label ?? ''
      }
    },
    series: [
      {
        name: 'trigger links',
        type: 'lines',
        coordinateSystem: 'cartesian2d',
        silent: true,
        symbol: ['none', 'none'],
        lineStyle: {
          color: '#94a3b8',
          width: 1,
          opacity: 0.56,
          type: 'dashed'
        },
        data: connectors.map((connector) => ({
          coords: [connector.from, connector.to]
        })),
        z: 1
      },
      {
        name: icons.curveLabel || result.curveId,
        type: 'scatter',
        data: points.map((point) => ({
          ...point,
          value: [point.timeMs, point.y],
          itemStyle: {
            color: point.color,
            borderColor: point.category === 'attack' ? '#0f172a' : '#ffffff',
            borderWidth: point.category === 'attack' ? 2 : 1,
            shadowColor: 'rgba(15, 23, 42, 0.2)',
            shadowBlur: point.category === 'attack' ? 8 : 4
          }
        })),
        symbol: (_value: unknown, params: { data?: Partial<EventTimelinePoint> }) => params.data?.symbol ?? 'circle',
        symbolSize: (_value: unknown, params: { data?: Partial<EventTimelinePoint> }) => params.data?.symbolSize ?? 14,
        emphasis: {
          scale: 1.28,
          focus: 'self'
        },
        z: 2
      }
    ]
  } as echarts.EChartsOption;
}

function buildEventTimelinePoints(result: V2DpsCurveResult, icons: EventTimelineIconHints): EventTimelinePoint[] {
  const points: EventTimelinePoint[] = [];
  const heroSymbol = icons.heroIconSrc ? `image://${icons.heroIconSrc}` : 'circle';
  const itemSymbol = icons.itemIconSrc ? `image://${icons.itemIconSrc}` : 'roundRect';

  result.attackTimeline.forEach((event, index) => {
    points.push(createEventTimelinePoint({
      id: `attack-${index}`,
      timeMs: event.timeMs,
      laneId: 'attack',
      category: 'attack',
      label: 'AA',
      source: event.actionId,
      detailRows: [
        `curve=${icons.curveLabel || result.curveId}`,
        `actionId=${event.actionId}`,
        `sourceActorId=${event.sourceActorId}`,
        `targetActorId=${event.targetActorId}`
      ],
      symbol: heroSymbol,
      symbolSize: heroSymbol.startsWith('image://') ? 30 : 24,
      color: '#0f172a'
    }));
  });

  result.damageTimeline.forEach((event, index) => {
    const isPhantom = event.phantomHit === true;
    const isItemDamage = event.source.includes('guinsoo') || event.source.includes('item_');
    points.push(createEventTimelinePoint({
      id: `damage-${index}`,
      timeMs: event.timeMs,
      laneId: 'damage',
      category: isPhantom ? 'phantom damage' : 'damage',
      label: isPhantom ? 'PH' : formatDamageTypeLabel(event.damageType),
      source: event.source,
      detailRows: [
        `source=${event.source}`,
        `damageType=${event.damageType}`,
        `rawDamage=${formatNumber(event.rawDamage)}`,
        `finalDamage=${formatNumber(event.finalDamage)}`,
        `HP=${formatNumber(event.targetHpBefore)} -> ${formatNumber(event.targetHpAfter)}`,
        ...(event.phantomHit ? ['phantomHit=true'] : []),
        ...(event.repeatTag ? [`repeatTag=${event.repeatTag}`] : []),
        ...formatCritContextDetailRows(event.critContext),
        ...formatNumericBoundDetailRows(event.critContext?.boundEvidence)
      ],
      symbol: isItemDamage ? itemSymbol : 'circle',
      symbolSize: isPhantom ? 18 : 15,
      color: isPhantom ? '#db2777' : event.damageType === 'magic' ? '#3b82f6' : '#f97316'
    }));
  });

  result.itemPassiveTriggers.forEach((entry, index) => {
    const record = readTimelineRecord(entry);
    const timeMs = readTimelineNumber(record, 'timeMs');
    if (timeMs === null) {
      return;
    }
    const triggerId = readTimelineString(record, 'triggerId') ?? 'item passive';
    points.push(createEventTimelinePoint({
      id: `item-passive-${index}`,
      timeMs,
      laneId: 'itemPassive',
      category: readTimelineBoolean(record, 'phantomHit') ? 'phantom passive' : 'item passive',
      label: readTimelineBoolean(record, 'phantomHit') ? 'PH' : 'ITEM',
      source: readTimelineString(record, 'sourceId') ?? triggerId,
      detailRows: summarizeTimelineRecord(record, ['timeMs', 'sourceId', 'sourceType', 'triggerId', 'phantomHit', 'repeatTag']),
      symbol: itemSymbol,
      symbolSize: readTimelineBoolean(record, 'phantomHit') ? 17 : 15,
      color: readTimelineBoolean(record, 'phantomHit') ? '#db2777' : '#0ea5e9'
    }));
  });

  result.skillPassiveTriggers.forEach((entry, index) => {
    const record = readTimelineRecord(entry);
    const timeMs = readTimelineNumber(record, 'timeMs');
    if (timeMs === null) {
      return;
    }
    const triggerId = readTimelineString(record, 'triggerId') ?? 'skill passive';
    points.push(createEventTimelinePoint({
      id: `skill-passive-${index}`,
      timeMs,
      laneId: 'skillPassive',
      category: 'skill passive',
      label: 'SK',
      source: readTimelineString(record, 'sourceId') ?? triggerId,
      detailRows: summarizeTimelineRecord(record, ['timeMs', 'sourceId', 'sourceType', 'triggerId', 'phantomHit', 'repeatTag']),
      symbol: 'diamond',
      symbolSize: 14,
      color: '#10b981'
    }));
  });

  result.effectBreakdown.forEach((event, index) => {
    if (typeof event.timeMs !== 'number') {
      return;
    }
    const isPhantom = event.phantomHit === true;
    points.push(createEventTimelinePoint({
      id: `effect-${index}`,
      timeMs: event.timeMs,
      laneId: 'effect',
      category: isPhantom ? 'phantom effect' : 'effect',
      label: event.kind ?? 'FX',
      source: event.source,
      detailRows: [
        `kind=${event.kind ?? '-'}`,
        `source=${event.source ?? '-'}`,
        `amount=${formatNumber(event.amount)}`,
        ...(event.message ? [`message=${event.message}`] : []),
        ...(event.phantomHit ? ['phantomHit=true'] : []),
        ...(event.repeatTag ? [`repeatTag=${event.repeatTag}`] : []),
        ...formatCritContextDetailRows(event.critContext),
        ...formatNumericBoundDetailRows(event.numericBound),
        ...formatNumericBoundDetailRows(event.critContext?.boundEvidence),
        ...formatPassiveCooldownDetailRows(event.passiveCooldown)
      ],
      symbol: isPhantom ? 'pin' : 'rect',
      symbolSize: isPhantom ? 15 : 10,
      color: isPhantom ? '#db2777' : '#64748b'
    }));
  });

  const hpEvents = result.targetHpTimeline.length > 0
    ? result.targetHpTimeline
    : result.damageTimeline.map((event) => ({ timeMs: event.timeMs, currentHp: event.targetHpAfter, maxHp: result.resolvedSnapshot.targetSnapshot.maxHp }));
  hpEvents.forEach((event, index) => {
    points.push(createEventTimelinePoint({
      id: `hp-${index}`,
      timeMs: event.timeMs,
      laneId: 'hp',
      category: 'hp',
      label: 'HP',
      detailRows: [
        `currentHp=${formatNumber(event.currentHp)}`,
        `maxHp=${formatNumber(event.maxHp)}`
      ],
      symbol: 'triangle',
      symbolSize: 9,
      color: '#14b8a6'
    }));
  });

  return points.sort((left, right) => left.timeMs - right.timeMs || left.laneIndex - right.laneIndex);
}

function createEventTimelinePoint(input: Omit<EventTimelinePoint, 'laneIndex' | 'laneLabel' | 'y'> & { laneId: EventTimelineLane['id'] }): EventTimelinePoint {
  const laneIndex = EVENT_TIMELINE_LANE_INDEX.get(input.laneId) ?? 0;
  return {
    ...input,
    laneIndex,
    laneLabel: EVENT_TIMELINE_LANES[laneIndex]?.label ?? input.laneId,
    y: laneIndex
  };
}

function spreadEventTimelinePoints(points: EventTimelinePoint[]): EventTimelinePoint[] {
  const groups = new Map<string, EventTimelinePoint[]>();
  for (const point of points) {
    const key = `${point.timeMs}:${point.laneIndex}`;
    groups.set(key, [...groups.get(key) ?? [], point]);
  }
  for (const group of groups.values()) {
    const step = group.length > 5 ? 0.09 : 0.14;
    group.forEach((point, index) => {
      point.y = point.laneIndex + (index - (group.length - 1) / 2) * step;
    });
  }
  return points;
}

function buildEventTimelineConnectors(points: EventTimelinePoint[]): EventTimelineConnector[] {
  const attacks = points
    .filter((point) => point.category === 'attack')
    .sort((left, right) => left.timeMs - right.timeMs);
  if (attacks.length === 0) {
    return [];
  }
  return points
    .filter((point) => point.category !== 'attack' && point.category !== 'hp')
    .map((point) => {
      const attack = findInferredTriggerAttack(attacks, point.timeMs);
      return attack ? { from: [attack.timeMs, attack.y] as [number, number], to: [point.timeMs, point.y] as [number, number] } : null;
    })
    .filter((connector): connector is EventTimelineConnector => connector !== null);
}

function findInferredTriggerAttack(attacks: EventTimelinePoint[], timeMs: number): EventTimelinePoint | null {
  const exact = attacks.find((attack) => attack.timeMs === timeMs);
  if (exact) {
    return exact;
  }
  let previous: EventTimelinePoint | null = null;
  for (const attack of attacks) {
    if (attack.timeMs > timeMs) {
      break;
    }
    previous = attack;
  }
  return previous;
}

function formatEventTimelineTooltip(point: EventTimelinePoint): string {
  const rows = [
    `<strong>${escapeHtml(point.laneLabel)} · ${escapeHtml(point.category)}</strong>`,
    `${formatCompactNumber(point.timeMs)}ms · ${escapeHtml(point.label)}`,
    ...point.detailRows.map((row) => escapeHtml(row))
  ];
  return rows.join('<br/>');
}

function readTimelineRecord(entry: unknown): Record<string, unknown> {
  return entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
}

function readTimelineString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readTimelineNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readTimelineBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function summarizeTimelineRecord(record: Record<string, unknown>, preferredKeys: string[]): string[] {
  const rows: string[] = [];
  for (const key of preferredKeys) {
    if (record[key] !== undefined) {
      rows.push(`${key}=${formatTimelineValue(record[key])}`);
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (!preferredKeys.includes(key) && rows.length < 12) {
      rows.push(`${key}=${formatTimelineValue(value)}`);
    }
  }
  return rows;
}

function formatTimelineValue(value: unknown): string {
  if (typeof value === 'number') {
    return formatNumber(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || value === undefined) {
    return '-';
  }
  return JSON.stringify(value);
}

function formatDamageTypeLabel(damageType: string): string {
  if (!damageType) {
    return 'DMG';
  }
  return damageType.length <= 4 ? damageType.toUpperCase() : damageType.slice(0, 4).toUpperCase();
}

function buildChartOption(results: V2DpsCurveResult[], curveLabelById: Map<string, string>, chartMode: ChartMode): echarts.EChartsOption {
  const rawSeries = results.map((result) => ({
    result,
    points: chartMode === 'damage' ? buildDamageSeries(result) : buildHpSeries(result)
  }));
  const series = rawSeries.map(({ result, points }) => ({
    name: curveLabelById.get(result.curveId) ?? result.curveId,
    type: 'line' as const,
    showSymbol: false,
    smooth: false,
    data: points
  }));
  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      formatter: (params) => formatChartTooltip(params, rawSeries, curveLabelById)
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

function formatChartTooltip(
  params: unknown,
  rawSeries: Array<{ result: V2DpsCurveResult, points: Array<[number, number]> }>,
  curveLabelById: Map<string, string>
): string {
  const entries = Array.isArray(params) ? params : [params];
  const firstEntry = entries[0] as { axisValue?: unknown } | undefined;
  const axisValue = Number(firstEntry?.axisValue);
  if (!Number.isFinite(axisValue)) {
    return '';
  }
  const markerByName = new Map<string, string>();
  for (const entry of entries as Array<{ seriesName?: unknown, marker?: unknown }>) {
    if (typeof entry.seriesName === 'string' && typeof entry.marker === 'string') {
      markerByName.set(entry.seriesName, entry.marker);
    }
  }
  const rows = rawSeries.map(({ result, points }) => {
    const label = curveLabelById.get(result.curveId) ?? result.curveId;
    const value = findChartValueAtTime(points, axisValue);
    const marker = markerByName.get(label) ?? '&#9679;';
    return `${marker} ${escapeHtml(label)}&nbsp;&nbsp;<strong>${formatNumber(value)}</strong>`;
  });
  return [`${formatCompactNumber(axisValue)}`, ...rows].join('<br/>');
}

function findChartValueAtTime(points: Array<[number, number]>, timeMs: number): number | null {
  if (points.length === 0) {
    return null;
  }
  let currentValue = points[0][1];
  for (const [pointTimeMs, value] of points) {
    if (pointTimeMs > timeMs) {
      break;
    }
    currentValue = value;
  }
  return currentValue;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function collapseChartPoints(points: Array<[number, number]>): Array<[number, number]> {
  const collapsed: Array<[number, number]> = [];
  for (const [timeMs, value] of [...points].sort((left, right) => left[0] - right[0])) {
    const last = collapsed[collapsed.length - 1];
    if (last && last[0] === timeMs) {
      last[1] = value;
      continue;
    }
    collapsed.push([timeMs, value]);
  }
  return collapsed;
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
  const collapsedPoints = collapseChartPoints(points);
  if (collapsedPoints[collapsedPoints.length - 1]?.[0] !== result.durationMs) {
    collapsedPoints.push([result.durationMs, Number(total.toFixed(6))]);
  }
  return collapsedPoints;
}

function buildHpSeries(result: V2DpsCurveResult): Array<[number, number]> {
  if (result.status !== 'ok') {
    return [];
  }
  const hpPoints = result.targetHpTimeline.length > 0
    ? result.targetHpTimeline.map((event) => [event.timeMs, event.currentHp] as [number, number])
    : result.damageTimeline.map((event) => [event.timeMs, event.targetHpAfter] as [number, number]);
  const points = collapseChartPoints(
    [[0, result.resolvedSnapshot.targetSnapshot.currentHp], ...hpPoints] as Array<[number, number]>
  );
  const last = points[points.length - 1];
  if (last && last[0] !== result.durationMs) {
    points.push([result.durationMs, last[1]]);
  }
  return points;
}

const basicAttackEvidenceColumns = [
  {
    title: 'Curve',
    render: (_: unknown, record: BasicAttackEvidenceRow) => record.curveLabel
  },
  {
    title: 'skillId',
    render: (_: unknown, record: BasicAttackEvidenceRow) => <Typography.Text code>{record.skillId}</Typography.Text>
  },
  {
    title: 'sourceKind',
    render: (_: unknown, record: BasicAttackEvidenceRow) => (
      <Typography.Text code>{record.sourceKind ?? '—'}</Typography.Text>
    )
  },
  {
    title: 'actionId',
    render: (_: unknown, record: BasicAttackEvidenceRow) => <Typography.Text code>{record.actionId}</Typography.Text>
  },
  {
    title: 'classifier',
    render: (_: unknown, record: BasicAttackEvidenceRow) => (
      <Typography.Text className="wasm-code-token">{formatClassifierSummary(record.classifier)}</Typography.Text>
    )
  },
  {
    title: 'critPolicy',
    render: (_: unknown, record: BasicAttackEvidenceRow) => (
      <Typography.Text code>{record.critPolicy ?? '—'}</Typography.Text>
    )
  },
  {
    title: 'critMultiplierSource',
    render: (_: unknown, record: BasicAttackEvidenceRow) => (
      <Typography.Text code>{record.critMultiplierSource ?? '—'}</Typography.Text>
    )
  },
  {
    title: 'critMultiplier',
    render: (_: unknown, record: BasicAttackEvidenceRow) => (
      <Typography.Text code>{record.critMultiplier !== undefined ? String(record.critMultiplier) : '—'}</Typography.Text>
    )
  }
];

const equipmentSkillRefDiagnosticColumns = [
  {
    title: 'severity',
    width: 88,
    render: (_: unknown, record: EquipmentSkillRefDiagnostic) => (
      <Tag color={record.severity === 'error' ? 'red' : record.severity === 'warning' ? 'orangered' : 'arcoblue'}>
        {record.severity}
      </Tag>
    )
  },
  {
    title: 'code',
    render: (_: unknown, record: EquipmentSkillRefDiagnostic) => <Typography.Text code>{record.code}</Typography.Text>
  },
  {
    title: 'audience',
    width: 88,
    render: (_: unknown, record: EquipmentSkillRefDiagnostic) => <Typography.Text code>{record.audience}</Typography.Text>
  },
  {
    title: 'itemId',
    render: (_: unknown, record: EquipmentSkillRefDiagnostic) => <Typography.Text code>{record.itemId}</Typography.Text>
  },
  {
    title: 'itemName',
    render: (_: unknown, record: EquipmentSkillRefDiagnostic) => (
      <Typography.Text>{record.itemName?.trim() || '—'}</Typography.Text>
    )
  },
  {
    title: 'skillId',
    render: (_: unknown, record: EquipmentSkillRefDiagnostic) => (
      <Typography.Text code>{record.skillId ?? '—'}</Typography.Text>
    )
  },
  {
    title: 'skillName',
    render: (_: unknown, record: EquipmentSkillRefDiagnostic) => (
      <Typography.Text>{record.skillName?.trim() || '—'}</Typography.Text>
    )
  },
  {
    title: 'message',
    render: (_: unknown, record: EquipmentSkillRefDiagnostic) => record.message
  }
];

function buildExportSelection(preparedInput: V2DpsPreparedInput) {
  const firstCurve = preparedInput.runInput.curves[0];
  return {
    attackerHeroId: firstCurve?.selection.heroId ?? '',
    targetActorId: preparedInput.runInput.targetSnapshot.actorId,
    targetEquipmentItemIds: firstCurve?.selection.targetEquipmentSet ?? [],
    durationMs: preparedInput.runInput.simulationRules.durationMs,
    attackSpeedCap: preparedInput.runInput.simulationRules.attackSpeedCap,
    critPolicy: preparedInput.runInput.simulationRules.critPolicy,
    equipmentSet: firstCurve?.selection.equipmentSet ?? [],
    targetEquipmentSet: firstCurve?.selection.targetEquipmentSet ?? [],
    targetEnabledPassiveEffects: firstCurve?.selection.targetEnabledPassiveEffects ?? [],
    preflightBlockedReasons: preparedInput.preflightBlockedReasons,
    curves: preparedInput.runInput.curves.map((curve) => ({
      curveId: curve.curveId,
      label: curve.label,
      basicAttackActions: curve.resolvedSnapshot.basicAttackActions,
      preflightBlockedReasons: curve.resolvedSnapshot.preflightBlockedReasons,
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
      resolvedSnapshot: curve.resolvedSnapshot,
      basicAttackActions: curve.resolvedSnapshot.basicAttackActions
    }))
  };
}

function getCurveBasicAttackCount(curve: V2DpsPreparedInput['runInput']['curves'][number] | undefined): number {
  return curve?.resolvedSnapshot.basicAttackActions.length ?? 0;
}

function formatCurveBasicAttackSummary(curve: V2DpsPreparedInput['runInput']['curves'][number] | undefined): string {
  const actions = curve?.resolvedSnapshot.basicAttackActions ?? [];
  if (actions.length === 0) {
    return '缺失';
  }
  return `${actions.length} 条`;
}

function formatClassifierSummary(classifier: V2DpsBasicAttackAction['classifier']): string {
  const types = classifier?.types ?? [];
  return types.length > 0 ? types.join(', ') : '—';
}

function formatPreflightBlockedMessage(reasons: string[]): string {
  const details = reasons.map((reason) => {
    if (reason === V2_DPS_INVALID_TARGET_REASON) {
      return `${reason}：DPS target 必须是 typeRelations 标记为 target_dummy 的 actor；普通 hero 不能作为 target 运行。`;
    }
    if (reason === V2_DPS_MISSING_BASIC_ATTACK_REASON) {
      return `${reason}：未从 bundle.skillMounts 解析到 action/basic_attack skill；不会 fallback 到硬编码 basic_attack。`;
    }
    if (reason.startsWith(V2_DPS_TARGET_PASSIVE_OWNER_ROLE_MISMATCH_REASON)) {
      return `${reason}：目标装备技能存在 dpsPassiveEffects，但 ownerRole 不是 target；不会当作攻击者被动执行。`;
    }
    if (reason.startsWith(V2_DPS_TARGET_PASSIVE_MISSING_TARGET_OWNER_ROLE_REASON)) {
      return `${reason}：目标装备技能有 dpsPassiveEffects，但缺少 ownerRole=target 的被动；请通过 seed/publish 补齐真实配置。`;
    }
    return reason;
  });
  return `Preflight blocked：${details.join(' / ')}`;
}

function groupPassiveEffectsByOwnerRole(passives: V2DpsPassiveEffect[]): Map<string, V2DpsPassiveEffect[]> {
  const groups = new Map<string, V2DpsPassiveEffect[]>();
  for (const passive of passives) {
    const normalizedRole = (passive.ownerRole ?? '').trim().toLowerCase();
    const ownerRole = normalizedRole === 'target'
      ? 'target'
      : normalizedRole === 'attacker' || normalizedRole === ''
        ? 'attacker'
        : 'other';
    const bucket = groups.get(ownerRole) ?? [];
    bucket.push(passive);
    groups.set(ownerRole, bucket);
  }
  return groups;
}

function formatPassiveOwnerRoleLabel(ownerRole: string): string {
  if (ownerRole === 'target') {
    return 'target passives';
  }
  if (ownerRole === 'attacker') {
    return 'attacker passives';
  }
  return `${ownerRole} passives`;
}

function formatPassiveEffectSummary(passive: V2DpsPassiveEffect) {
  return {
    passiveId: passive.passiveId ?? passive.effectId ?? passive.sourceId,
    ownerRole: passive.ownerRole ?? 'attacker',
    sourceType: passive.sourceType,
    sourceId: passive.sourceId,
    internalCooldownMs: passive.internalCooldownMs,
    triggerEvent: passive.trigger?.event ?? passive.triggerKind,
    operationKinds: (passive.operations ?? []).map((operation) => operation.kind),
    operations: passive.operations
  };
}

function formatPassiveCooldownDetailRows(evidence: V2DpsPassiveCooldownEvidence | undefined): string[] {
  if (!evidence) {
    return [];
  }
  const rows: string[] = [];
  if (evidence.passiveKey) {
    rows.push(`passiveKey=${evidence.passiveKey}`);
  }
  if (typeof evidence.internalCooldownMs === 'number' && Number.isFinite(evidence.internalCooldownMs)) {
    rows.push(`internalCooldownMs=${evidence.internalCooldownMs}`);
  }
  if (typeof evidence.readyAtMs === 'number' && Number.isFinite(evidence.readyAtMs)) {
    rows.push(`readyAtMs=${evidence.readyAtMs}`);
  }
  if (typeof evidence.nextReadyAtMs === 'number' && Number.isFinite(evidence.nextReadyAtMs)) {
    rows.push(`nextReadyAtMs=${evidence.nextReadyAtMs}`);
  }
  if (evidence.triggered === true) {
    rows.push('triggered=true');
  }
  if (evidence.skipped === true) {
    rows.push('skipped=true');
  }
  return rows;
}

function formatEquipmentStatsRecord(stats: Record<string, number>): string {
  const entries = Object.entries(stats).filter(([, value]) => Number.isFinite(value) && value !== 0);
  if (entries.length === 0) {
    return '';
  }
  return entries.map(([attrKey, value]) => `${attrKey}+${formatCompactNumber(value)}`).join(' / ');
}

function formatMissingBasicAttackMessage(reasons: string[] | undefined): string {
  const normalized = reasons && reasons.length > 0 ? reasons : [V2_DPS_MISSING_BASIC_ATTACK_REASON];
  return `${normalized.join(' / ')}：未从 bundle.skillMounts 解析到 action/basic_attack skill；不会 fallback 到硬编码 basic_attack。`;
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
