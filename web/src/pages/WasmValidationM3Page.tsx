import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Grid, Input, InputNumber, Select, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { IconCopy, IconRefresh } from '@arco-design/web-react/icon';
import { EmptyState } from '../components/EmptyState';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import {
  buildTinyGoV2SingleActionRunInput,
  compileTinyGoV2ValidationInput,
  createDefaultWasmValidationSelection,
  listWasmValidationSkills,
  type TinyGoV2ActionRequest,
  type TinyGoV2ValidationInput,
  type WasmValidationSelection,
  type WasmValidationSkillOption
} from '../engine/tinygoV2BundleAdapter';
import { TinyGoV2Bridge, decodeFramePayload, type TinyGoV2Frame } from '../engine/tinygoV2Bridge';
import { getErrorMessage } from '../services/apiClient';
import { loadPublishedBundleSnapshot } from '../services/bundleSnapshot';
import type { CurrentVersion, GameDataBundle, LoadState } from '../types/api';

type WasmValidationM3PageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
  externalRefreshSeed: number;
};

type ReadyPayload = {
  schemaVersion: number;
  actorCount: number;
  actionCount: number;
  formulaCount: number;
  resourceCount?: number;
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
  resources?: Record<string, ResourceSnapshot>;
};

type ActionValueBreakdownStep = {
  formulaId?: string;
  op: string;
  ref?: string;
  value: number;
};

type ActionCooldownRunState = {
  cooldownMs: number;
  cooldownFormulaId?: string;
  cooldownBreakdown?: ActionValueBreakdownStep[];
  readyAtMs: number;
};

type ActionResourceDelta = {
  resourceId: string;
  before: number;
  after: number;
  delta: number;
};

type ActionEffectRunResult = {
  effectIndex: number;
  kind: string;
  formulaId?: string;
  formulaBreakdown?: ActionValueBreakdownStep[];
  rawAmount?: number;
  hasRawAmount?: boolean;
  damageType?: string;
  finalDamage?: number;
  hasFinalDamage?: boolean;
  targetHpBefore?: number;
  targetHpAfter?: number;
  sourceActorId?: string;
  targetActorId?: string;
};

type ActionRunResult = {
  timeMs: number;
  actionId: string;
  sourceActorId: string;
  targetActorId: string;
  accepted: boolean;
  blockedReason?: string;
  resourceDeltas?: ActionResourceDelta[];
  cooldownBefore?: ActionCooldownRunState;
  cooldownAfter?: ActionCooldownRunState;
  effects?: ActionEffectRunResult[];
};

type DonePayload = {
  stopReason: string;
  finalTimeMs: number;
  processedEvents: number;
  queuePeak: number;
  chainDepthPeak: number;
  actors: ActorSnapshot[];
  logs?: Array<Record<string, unknown>>;
  actionResults?: ActionRunResult[];
};

type DecodedFrame = {
  stage: string;
  kind: number;
  kindLabel: string;
  payload: unknown;
};

type BaselineInput = Record<string, unknown>;

type EvidenceStatus = 'match' | 'diff' | 'low_confidence' | 'missing_evidence';

type EvidenceRow = {
  field: string;
  wasmValue: unknown;
  baselineValue: unknown;
  tolerance: string;
  status: EvidenceStatus;
  evidenceRef: string;
  note: string;
};

type ActionOptionRow = WasmValidationSkillOption & {
  displayLabel: string;
};

const TINYGO_V2_WASM_URL = new URL('../engine/wasm/tinygo_engine_v2.wasm', import.meta.url);
const DONE_FRAME_KIND = 13;

const FRAME_KIND_LABELS: Record<number, string> = {
  11: 'log',
  12: 'sample',
  13: 'done',
  14: 'error',
  15: 'ready',
  16: 'snapshot',
  17: 'action_snapshot'
};

const { Row, Col } = Grid;

function decodeFrames(frames: TinyGoV2Frame[], stage: string): DecodedFrame[] {
  return frames.map((frame) => ({
    stage,
    kind: frame.kind,
    kindLabel: FRAME_KIND_LABELS[frame.kind] ?? `kind ${frame.kind}`,
    payload: decodeFramePayload<unknown>(frame)
  }));
}

function getPayload<T>(frames: DecodedFrame[], kind: number): T | null {
  const frame = [...frames].reverse().find((candidate) => candidate.kind === kind);
  return frame ? (frame.payload as T) : null;
}

function parseBaseline(text: string): { baseline: BaselineInput | null; error: string | null } {
  if (!text.trim()) {
    return { baseline: null, error: null };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { baseline: null, error: '人工基线必须是 JSON 对象。' };
    }
    return { baseline: parsed as BaselineInput, error: null };
  } catch (error) {
    return { baseline: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function readBaselineValue(baseline: BaselineInput | null, field: string): unknown {
  if (!baseline) {
    return undefined;
  }
  const fields = baseline.fields;
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    const nested = (fields as Record<string, unknown>)[field];
    if (nested && typeof nested === 'object' && !Array.isArray(nested) && 'baselineValue' in nested) {
      return (nested as Record<string, unknown>).baselineValue;
    }
    if (nested !== undefined) {
      return nested;
    }
  }
  return baseline[field];
}

function buildEvidenceRow(
  baseline: BaselineInput | null,
  field: string,
  wasmValue: unknown,
  evidenceRef: string,
  note = '',
  tolerance = '0'
): EvidenceRow {
  const baselineValue = readBaselineValue(baseline, field);
  let status: EvidenceStatus = 'missing_evidence';
  if (baselineValue !== undefined) {
    status = JSON.stringify(baselineValue) === JSON.stringify(wasmValue) ? 'match' : 'diff';
  }
  return { field, wasmValue, baselineValue: baselineValue ?? '', tolerance, status, evidenceRef, note };
}

function buildEvidenceRows(done: DonePayload | null, baseline: BaselineInput | null): EvidenceRow[] {
  const result = done?.actionResults?.[0];
  if (!done || !result) {
    return [];
  }
  const rows: EvidenceRow[] = [
    buildEvidenceRow(baseline, 'run.stopReason', done.stopReason, 'done.stopReason', ''),
    buildEvidenceRow(baseline, 'run.processedEvents', done.processedEvents, 'done.processedEvents', ''),
    buildEvidenceRow(baseline, 'action.accepted', result.accepted, 'done.actionResults[0].accepted', ''),
    buildEvidenceRow(baseline, 'action.blockedReason', result.blockedReason ?? '', 'done.actionResults[0].blockedReason', '空字符串表示未阻塞')
  ];

  for (const delta of result.resourceDeltas ?? []) {
    rows.push(buildEvidenceRow(baseline, `resource.${delta.resourceId}.before`, delta.before, `resourceDeltas.${delta.resourceId}.before`));
    rows.push(buildEvidenceRow(baseline, `resource.${delta.resourceId}.after`, delta.after, `resourceDeltas.${delta.resourceId}.after`));
    rows.push(buildEvidenceRow(baseline, `resource.${delta.resourceId}.delta`, delta.delta, `resourceDeltas.${delta.resourceId}.delta`));
  }

  if (result.cooldownBefore) {
    rows.push(buildEvidenceRow(baseline, 'cooldown.before.readyAtMs', result.cooldownBefore.readyAtMs, 'cooldownBefore.readyAtMs'));
  }
  if (result.cooldownAfter) {
    rows.push(buildEvidenceRow(baseline, 'cooldown.after.cooldownMs', result.cooldownAfter.cooldownMs, 'cooldownAfter.cooldownMs'));
    rows.push(buildEvidenceRow(baseline, 'cooldown.after.readyAtMs', result.cooldownAfter.readyAtMs, 'cooldownAfter.readyAtMs'));
  }

  for (const effect of result.effects ?? []) {
    const prefix = `effect.${effect.effectIndex}`;
    rows.push(buildEvidenceRow(baseline, `${prefix}.kind`, effect.kind, `effects[${effect.effectIndex}].kind`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.formulaId`, effect.formulaId ?? '', `effects[${effect.effectIndex}].formulaId`));
    if (effect.hasRawAmount) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.rawAmount`, effect.rawAmount ?? 0, `effects[${effect.effectIndex}].rawAmount`));
    }
    if (effect.hasFinalDamage) {
      rows.push(buildEvidenceRow(baseline, `${prefix}.finalDamage`, effect.finalDamage ?? 0, `effects[${effect.effectIndex}].finalDamage`));
    }
    rows.push(buildEvidenceRow(baseline, `${prefix}.damageType`, effect.damageType ?? '', `effects[${effect.effectIndex}].damageType`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.targetHpBefore`, effect.targetHpBefore ?? '', `effects[${effect.effectIndex}].targetHpBefore`));
    rows.push(buildEvidenceRow(baseline, `${prefix}.targetHpAfter`, effect.targetHpAfter ?? '', `effects[${effect.effectIndex}].targetHpAfter`));
  }

  return rows;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '待人工填写';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function buildActionRows(options: WasmValidationSkillOption[]): ActionOptionRow[] {
  return options.map((option) => ({
    ...option,
    displayLabel: `${option.label} / ${option.actionId}`
  }));
}

function createDefaultM3Selection(bundle: GameDataBundle): WasmValidationSelection {
  const fallback = createDefaultWasmValidationSelection(bundle);
  for (const hero of bundle.heroes) {
    const candidate = { ...fallback, selfHeroId: hero.heroId };
    if (listWasmValidationSkills(bundle, candidate, 'self').length > 0) {
      return candidate;
    }
  }
  return fallback;
}

function cloneValidationInputWithSingleAction(input: TinyGoV2ValidationInput, action: TinyGoV2ActionRequest): TinyGoV2ValidationInput {
  return {
    ...input,
    runInput: buildTinyGoV2SingleActionRunInput(input.runInput, action, {
      maxEvents: 8,
      enableLogs: true,
      valueTrace: true
    })
  };
}

export function WasmValidationM3Page({
  apiBaseUrl,
  selectedGameId,
  selectedGameName,
  externalRefreshSeed
}: WasmValidationM3PageProps) {
  const [bundle, setBundle] = useState<GameDataBundle | null>(null);
  const [currentVersion, setCurrentVersion] = useState<CurrentVersion | null>(null);
  const [cacheStatus, setCacheStatus] = useState<string>('idle');
  const [bundleStatus, setBundleStatus] = useState<LoadState>('idle');
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [selection, setSelection] = useState<WasmValidationSelection | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string>('');
  const [baselineText, setBaselineText] = useState('');
  const [frames, setFrames] = useState<DecodedFrame[]>([]);
  const [status, setStatus] = useState<LoadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function loadBundle() {
      if (!selectedGameId) {
        setBundle(null);
        setCurrentVersion(null);
        setSelection(null);
        setBundleStatus('idle');
        return;
      }
      setBundleStatus('loading');
      setBundleError(null);
      try {
        const snapshot = await loadPublishedBundleSnapshot(apiBaseUrl, selectedGameId);
        if (cancelled) {
          return;
        }
        setBundle(snapshot.bundle);
        setCurrentVersion(snapshot.currentVersion);
        setCacheStatus(snapshot.cacheStatus);
        setSelection(createDefaultM3Selection(snapshot.bundle));
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

  const selfActionOptions = useMemo(
    () => (bundle && selection ? buildActionRows(listWasmValidationSkills(bundle, selection, 'self')) : []),
    [bundle, selection]
  );

  useEffect(() => {
    if (selfActionOptions.length === 0) {
      setSelectedActionId('');
      return;
    }
    setSelectedActionId((current) => (selfActionOptions.some((option) => option.actionId === current) ? current : selfActionOptions[0].actionId));
  }, [selfActionOptions]);

  const inputPreview = useMemo((): { value: TinyGoV2ValidationInput | null; error: string | null } => {
    if (!bundle || !selection) {
      return { value: null, error: null };
    }
    if (!selectedActionId) {
      return { value: null, error: '请选择一个 self 技能作为 M3 单次施法。' };
    }
    try {
      const compiled = compileTinyGoV2ValidationInput(bundle, selection);
      return {
        value: cloneValidationInputWithSingleAction(compiled, {
          triggerAtMs: 0,
          sourceActorId: 'self',
          targetActorId: 'enemy',
          actionId: selectedActionId
        }),
        error: null
      };
    } catch (error) {
      return { value: null, error: getErrorMessage(error) };
    }
  }, [bundle, selectedActionId, selection]);

  const { baseline, error: baselineError } = useMemo(() => parseBaseline(baselineText), [baselineText]);
  const readyPayload = useMemo(() => getPayload<ReadyPayload>(frames, 15), [frames]);
  const donePayload = useMemo(() => getPayload<DonePayload>(frames, DONE_FRAME_KIND), [frames]);
  const evidenceRows = useMemo(() => buildEvidenceRows(donePayload, baseline), [baseline, donePayload]);
  const selectedAction = selfActionOptions.find((option) => option.actionId === selectedActionId) ?? null;

  const updateSelection = useCallback((patch: Partial<WasmValidationSelection>) => {
    setSelection((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const updateSelfSkillLevel = useCallback(
    (skillId: string, level: number) => {
      if (!selection) {
        return;
      }
      updateSelection({
        selfSkillLevels: {
          ...selection.selfSkillLevels,
          [skillId]: level
        }
      });
    },
    [selection, updateSelection]
  );

  const runM3 = useCallback(async () => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setStatus('loading');
    setErrorMessage(null);
    setDurationMs(null);
    try {
      if (!inputPreview.value) {
        throw new Error(inputPreview.error ?? 'M3 输入尚未准备好。');
      }
      const startedAt = performance.now();
      const bridge = await TinyGoV2Bridge.create({ wasmUrl: TINYGO_V2_WASM_URL });
      const nextFrames: DecodedFrame[] = [];
      nextFrames.push(...decodeFrames(bridge.init(inputPreview.value.engineBundle), 'init'));
      nextFrames.push(...decodeFrames(bridge.beginRun(inputPreview.value.runInput), 'begin'));
      let stepStatus = 1;
      let guard = 0;
      while (stepStatus === 1 && guard < 16) {
        const step = bridge.step(16);
        stepStatus = step.status;
        nextFrames.push(...decodeFrames(step.frames, `step ${guard + 1}`));
        guard += 1;
      }
      if (stepStatus < 0) {
        throw new Error('engine_step failed');
      }
      if (stepStatus === 1) {
        throw new Error('engine_step guard exceeded');
      }
      const completedAt = performance.now();
      if (runIdRef.current !== runId) {
        return;
      }
      setFrames(nextFrames);
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

  const handleCopyPackage = useCallback(async () => {
    if (!navigator.clipboard || !inputPreview.value) {
      return;
    }
    const payload = {
      case_meta: {
        milestone: 'M3',
        caseId: 'M3-single-skill-dummy-canonical',
        gameId: selectedGameId,
        versionCode: currentVersion?.versionCode ?? '',
        dataHash: currentVersion?.dataHash ?? '',
        sourceActorId: 'self',
        targetActorId: 'enemy',
        actionId: selectedActionId,
        skillId: selectedAction?.skillId ?? '',
        skillLevel: selectedAction?.level ?? 1,
        seed: inputPreview.value.runInput.seed
      },
      runInput: inputPreview.value.runInput,
      wasm_output: donePayload,
      evidenceRows
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  }, [currentVersion, donePayload, evidenceRows, inputPreview.value, selectedAction, selectedActionId, selectedGameId]);

  const heroOptions = (bundle?.heroes ?? []).map((hero) => ({ label: hero.name ?? hero.heroId, value: hero.heroId }));
  const itemOptions = (bundle?.items ?? []).map((item) => ({ label: item.name ?? item.itemId, value: item.itemId }));
  const selectedSkillLevel = selectedAction ? selection?.selfSkillLevels[selectedAction.skillId] ?? selectedAction.level : 1;

  const evidenceColumns = [
    { title: 'field', dataIndex: 'field' },
    { title: 'wasmValue', render: (_: unknown, record: EvidenceRow) => <Typography.Text>{formatValue(record.wasmValue)}</Typography.Text> },
    { title: 'baselineValue', render: (_: unknown, record: EvidenceRow) => <Typography.Text>{formatValue(record.baselineValue)}</Typography.Text> },
    { title: 'tolerance', dataIndex: 'tolerance' },
    {
      title: 'status',
      render: (_: unknown, record: EvidenceRow) => (
        <Tag color={record.status === 'match' ? 'green' : record.status === 'diff' ? 'red' : 'orange'}>{record.status}</Tag>
      )
    },
    { title: 'evidenceRef', dataIndex: 'evidenceRef' },
    { title: 'note', dataIndex: 'note' }
  ];

  return (
    <div className="wasm-validation-page">
      <section className="workspace-hero">
        <Space direction="vertical" size={8}>
          <Typography.Text className="workspace-rail">Wasm 验证 M3 / {selectedGameName}</Typography.Text>
          <Typography.Title heading={2}>M3 单技能 1v 假人验证</Typography.Title>
        </Space>
        <Space>
          <Button icon={<IconRefresh />} onClick={() => void runM3()} loading={status === 'loading'} disabled={!inputPreview.value}>
            运行 M3
          </Button>
          <Button icon={<IconCopy />} onClick={() => void handleCopyPackage()} disabled={!donePayload}>
            复制验收包
          </Button>
        </Space>
      </section>

      <Row gutter={[16, 16]}>
        <Col span={6}>
          <MetricCard label="Bundle" value={currentVersion?.versionCode ?? '未加载'} hint={`cache ${cacheStatus}`} />
        </Col>
        <Col span={6}>
          <MetricCard label="Wasm" value={readyPayload ? `schema ${readyPayload.schemaVersion}` : '未运行'} hint={`actions ${readyPayload?.actionCount ?? 0}`} />
        </Col>
        <Col span={6}>
          <MetricCard label="Action" value={selectedAction?.label ?? '未选择'} hint={selectedActionId || 'no action'} />
        </Col>
        <Col span={6}>
          <MetricCard label="耗时" value={durationMs === null ? '-' : `${durationMs} ms`} hint={status} />
        </Col>
      </Row>

      {bundleError ? <Alert type="error" content={bundleError} /> : null}
      {errorMessage ? <Alert type="error" content={errorMessage} /> : null}
      {inputPreview.error ? <Alert type="warning" content={`M3 输入: ${inputPreview.error}`} /> : null}
      {baselineError ? <Alert type="warning" content={`人工基线 JSON: ${baselineError}`} /> : null}
      {!selectedGameId ? <Alert type="warning" content="请先选择游戏。" /> : null}

      <Panel title="M3 输入" kicker="case meta">
        {bundleStatus === 'loading' ? <EmptyState title="正在加载发布 Bundle" description="等待当前游戏的已发布快照返回。" /> : null}
        {bundle && selection ? (
          <Row gutter={[12, 12]}>
            <Col span={6}>
              <Select value={selection.selfHeroId} options={heroOptions} onChange={(value) => updateSelection({ selfHeroId: String(value) })} />
            </Col>
            <Col span={4}>
              <InputNumber min={1} value={selection.selfLevel} onChange={(value) => updateSelection({ selfLevel: Number(value ?? 1) })} />
            </Col>
            <Col span={6}>
              <Select value={selection.enemyHeroId} options={heroOptions} onChange={(value) => updateSelection({ enemyHeroId: String(value) })} />
            </Col>
            <Col span={4}>
              <InputNumber min={1} value={selection.enemyLevel} onChange={(value) => updateSelection({ enemyLevel: Number(value ?? 1) })} />
            </Col>
            <Col span={8}>
              <Select
                mode="multiple"
                value={selection.selfItemIds}
                options={itemOptions}
                placeholder="攻击方装备"
                onChange={(value) => updateSelection({ selfItemIds: Array.isArray(value) ? value.map(String) : [] })}
              />
            </Col>
            <Col span={8}>
              <Select value={selectedActionId} options={selfActionOptions.map((option) => ({ label: option.displayLabel, value: option.actionId }))} onChange={(value) => setSelectedActionId(String(value))} />
            </Col>
            <Col span={4}>
              <InputNumber
                min={1}
                max={selectedAction?.maxLevel ?? 5}
                value={selectedSkillLevel}
                onChange={(value) => selectedAction && updateSelfSkillLevel(selectedAction.skillId, Number(value ?? selectedAction.defaultLevel))}
              />
            </Col>
          </Row>
        ) : null}
      </Panel>

      <Panel title="字段级证据" kicker="done.actionResults" actions={<Tag color={donePayload ? 'green' : 'gray'}>{donePayload ? 'ready' : 'empty'}</Tag>}>
        {evidenceRows.length > 0 ? (
          <Table rowKey="field" columns={evidenceColumns} data={evidenceRows} pagination={false} size="small" />
        ) : (
          <EmptyState title="还没有 M3 运行结果" description="选择技能后运行一次 M3 单次施法。" />
        )}
      </Panel>

      <Panel title="人工基线" kicker="baseline_input">
        <Input.TextArea
          value={baselineText}
          onChange={setBaselineText}
          autoSize={{ minRows: 5, maxRows: 12 }}
          placeholder='{"effect.0.finalDamage": 40, "resource.mana.delta": -55}'
        />
      </Panel>

      <Panel title="Wasm 输出" kicker="decoded frames">
        {donePayload ? <JsonBlock value={donePayload} /> : <EmptyState title="done payload 为空" description="运行 M3 后这里会展示 done frame。" />}
      </Panel>
    </div>
  );
}
