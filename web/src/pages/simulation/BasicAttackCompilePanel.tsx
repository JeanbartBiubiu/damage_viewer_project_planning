import { Alert, Button, Checkbox, Form, InputNumber, Select, Space, Table, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { JsonBlock } from '../../components/JsonBlock';
import { GenericEngineClient, GenericEngineClientError } from '../../engine/genericEngineClient';
import { WASM_IDENTITY } from '../../engine/wasmIdentity';
import {
  inspectSimulationSnapshot,
  prepareSimulation,
  singleAttackRequest,
  SIMULATION_ADAPTER_VERSION,
  type SimulationAttributeRequirement,
  type SimulationCoverage
} from '../../engine/simulationAdapter';
import { getErrorMessage } from '../../services/apiClient';
import { getSimulationSnapshot, normalizeEquipmentKeys } from '../../services/simulationSnapshotClient';
import { equipmentContribution, PURE_EQUIPMENT_KEYS, simulationHealthLimit } from '../../engine/simulationEquipment';
import { equipmentRangeRequirements } from '../../engine/simulationEquipmentPassives';
import type { CompileResult, DoneResult, GenericReleaseDonePayload, RunRequest } from '../../types/genericEngine';
import type { SimulationAttributeInputs, SimulationEquipmentAssumption, SimulationInitialHealth, SimulationSelection, SimulationSnapshot } from '../../types/simulationSnapshot';
import { SimulationEntitySelect } from './SimulationEntitySelect';
import { useSimulationSelectionOptions } from './useSimulationSelectionOptions';
import { assessSingleAttackResult, type SingleAttackAssessment } from '../../engine/singleAttackResult';
import { continuousAttackRequest, CONTINUOUS_DURATION_INITIAL_MS, type PreparedContinuousAttack } from '../../engine/continuousAttackRequest';
import { assessContinuousAttackResult, type ContinuousAttackAssessment } from '../../engine/continuousAttackResult';
import { ContinuousAttackResult } from './ContinuousAttackResult';
import { buildContinuousAttackArchive } from '../../engine/continuousAttackArchive';

export type BasicAttackCompilePanelProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onDirtyChange: (busy: boolean) => void;
};

type SelectionDraft = Omit<SimulationSelection, 'sourceLevel' | 'targetLevel' | 'basicAttackLevel'> & {
  sourceLevel: number | undefined;
  targetLevel: number | undefined;
  basicAttackLevel: number | undefined;
};
type Inspection = ReturnType<typeof inspectSimulationSnapshot>;
type PreparedSimulation = Awaited<ReturnType<typeof prepareSimulation>>;
type AttributeDrafts = { source: Record<string, number | undefined>; target: Record<string, number | undefined> };
type InitialHealthDraft = { source: number | undefined; target: number | undefined };
type TaskPhase = 'idle' | 'reading' | 'preparing' | 'compiling' | 'running' | 'releasing';
type TaskKind = 'snapshot' | 'compile' | 'single_attack' | 'continuous_attack';
type Cleanup = 'not_needed' | 'released' | 'worker_destroyed' | 'release_failed';
type Task = {
  kind: TaskKind;
  phase: Exclude<TaskPhase, 'idle'>;
  failurePhase: Exclude<TaskPhase, 'idle'> | null;
  cancelled: boolean;
  controller: AbortController;
  client: GenericEngineClient | null;
  snapshot: SimulationSnapshot | null;
  prepared: PreparedSimulation | null;
  result: CompileResult | null;
  release: GenericReleaseDonePayload | null;
  sessionId: string | null;
  runRequest: RunRequest | null;
  runResult: DoneResult | null;
  assessment: SingleAttackAssessment | null;
  continuousPrepared: PreparedContinuousAttack | null;
  continuousAssessment: ContinuousAttackAssessment | null;
  cleanup: Cleanup;
};
type CompileArchive = {
  taskKind: 'compile';
  outcome: 'passed' | 'failed' | 'cancelled';
  adapterVersion: string;
  wasm: typeof WASM_IDENTITY;
  snapshot: SimulationSnapshot;
  snapshotDigest: string;
  attributeInputs: SimulationAttributeInputs;
  initialHealth: SimulationInitialHealth;
  equipmentAssumptions: SimulationEquipmentAssumption[];
  compileRequest: PreparedSimulation['compileRequest'];
  coverage: SimulationCoverage[];
  operationOrigins: PreparedSimulation['operationOrigins'];
  equipmentOrigins: PreparedSimulation['equipmentOrigins'];
  compileResult: CompileResult | null;
  releaseResult: GenericReleaseDonePayload | null;
  error: string | null;
};
type SingleAttackArchive = Omit<CompileArchive, 'taskKind'> & {
  taskKind: 'single_attack';
  runRequest: RunRequest | null;
  runResult: DoneResult | null;
  assessment: SingleAttackAssessment | null;
  cleanup: Cleanup;
  failurePhase: Exclude<TaskPhase, 'idle'> | null;
};
export type ContinuousAttackArchive = Omit<SingleAttackArchive, 'taskKind' | 'assessment'> & {
  taskKind: 'continuous_attack'; assessment: ContinuousAttackAssessment | null;
  runInputHash: string | null; attackSpeedAdmission: PreparedContinuousAttack['attackSpeedAdmission'] | null;
};
type SimulationArchive = CompileArchive | SingleAttackArchive | ContinuousAttackArchive;

const phaseLabels: Record<Exclude<TaskPhase, 'idle'>, string> = {
  reading: '正在读取场景快照', preparing: '正在准备编译请求',
  compiling: '正在编译配置', running: '正在执行一次普攻', releasing: '正在释放会话'
};
const cleanupLabels: Record<Cleanup, string> = {
  not_needed: '尚未产生可释放会话', released: '会话已正常释放，线程已结束',
  worker_destroyed: '线程已销毁，未进行正常会话释放', release_failed: '会话释放失败，线程已结束'
};
const stopLabels: Record<string, string> = {
  no_events: '没有后续事件', duration_reached: '到达单次观察上限', target_dead: '目标生命归零',
  source_dead: '攻击方死亡', both_dead: '双方死亡', budget_exceeded: '事件预算耗尽'
};
const sideLabels = { source: '攻击方', target: '目标' };
const stableKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;

function emptySelection(): SelectionDraft {
  return {
    sourceCharacterKey: '', sourceLevel: undefined, targetCharacterKey: '', targetLevel: undefined,
    basicAttackSkillKey: '', basicAttackLevel: undefined, sourceEquipmentKeys: [], targetEquipmentKeys: []
  };
}

function emptyAttributeDrafts(): AttributeDrafts { return { source: {}, target: {} }; }
function emptyInitialHealth(): InitialHealthDraft { return { source: undefined, target: undefined }; }

function selectionFromDraft(draft: SelectionDraft, characterLevels: number[], skillLevels: number[]): SimulationSelection {
  const keys = [
    ['sourceCharacterKey', '攻击方角色标识'], ['targetCharacterKey', '目标角色标识'],
    ['basicAttackSkillKey', '普攻技能标识']
  ] as const;
  for (const [field, label] of keys) {
    if (!stableKeyPattern.test(draft[field].trim())) {
      throw new Error(`selection.${field}: ${label}需填写合法的稳定标识。`);
    }
  }
  const levels = [
    ['sourceLevel', '攻击方等级', characterLevels], ['targetLevel', '目标等级', characterLevels],
    ['basicAttackLevel', '普攻技能等级', skillLevels]
  ] as const;
  for (const [field, label, options] of levels) {
    const value = draft[field];
    if (value === undefined || !options.includes(value)) {
      throw new Error(`selection.${field}: ${label}需在当前合法等级范围内明确选择。`);
    }
  }
  return {
    sourceCharacterKey: draft.sourceCharacterKey.trim(), sourceLevel: draft.sourceLevel!,
    targetCharacterKey: draft.targetCharacterKey.trim(), targetLevel: draft.targetLevel!,
    basicAttackSkillKey: draft.basicAttackSkillKey.trim(), basicAttackLevel: draft.basicAttackLevel!,
    sourceEquipmentKeys: normalizeEquipmentKeys(draft.sourceEquipmentKeys, 'selection.sourceEquipmentKeys'),
    targetEquipmentKeys: normalizeEquipmentKeys(draft.targetEquipmentKeys, 'selection.targetEquipmentKeys')
  };
}

function taskError(error: unknown): string {
  if (error instanceof GenericEngineClientError && error.engineError) {
    const item = error.engineError;
    return `${item.path ? `${item.path}: ` : ''}${item.code} ${item.message}`;
  }
  return getErrorMessage(error);
}

function archiveFor(task: Task, outcome: CompileArchive['outcome'], error: string | null): SimulationArchive | null {
  if (!task.snapshot || !task.prepared) return null;
  const common = {
    outcome, adapterVersion: SIMULATION_ADAPTER_VERSION, wasm: WASM_IDENTITY, snapshot: task.snapshot,
    snapshotDigest: task.prepared.snapshotDigest, attributeInputs: task.prepared.attributeInputs,
    initialHealth: task.prepared.initialHealth,
    equipmentAssumptions: task.prepared.equipmentAssumptions,
    compileRequest: task.prepared.compileRequest, coverage: task.prepared.coverage,
    operationOrigins: task.prepared.operationOrigins, equipmentOrigins: task.prepared.equipmentOrigins,
    compileResult: task.result, releaseResult: task.release, error
  };
  if (task.kind === 'continuous_attack') return {
    ...common, taskKind: 'continuous_attack', runRequest: task.runRequest, runResult: task.runResult,
    assessment: task.continuousAssessment, cleanup: task.cleanup, failurePhase: task.failurePhase,
    runInputHash: task.continuousPrepared?.runInputHash ?? null,
    attackSpeedAdmission: task.continuousPrepared?.attackSpeedAdmission ?? null
  };
  return task.kind === 'single_attack' ? {
    ...common, taskKind: 'single_attack', runRequest: task.runRequest, runResult: task.runResult,
    assessment: task.assessment, cleanup: task.cleanup, failurePhase: task.failurePhase
  } : { ...common, taskKind: 'compile' };
}

function SingleAttackResult({ archive }: { archive: SingleAttackArchive }) {
  const result = archive.assessment;
  const values = result ? [
    { key: 'damage-dealt', label: '本次造成伤害', value: result.damageDealt },
    { key: 'hp-loss', label: '目标实际扣血', value: result.hpLoss },
    { key: 'target-initial-hp', label: '目标运行前生命', value: result.targetInitialHp },
    { key: 'target-final-hp', label: '目标运行后生命', value: result.targetFinalHp },
    { key: 'source-initial-hp', label: '攻击方运行前生命', value: result.sourceInitialHp },
    { key: 'source-final-hp', label: '攻击方运行后生命', value: result.sourceFinalHp }
  ] : [];
  return (
    <section aria-label="单次普攻结果">
      <Typography.Title heading={5}>单次普攻结果</Typography.Title>
      <Typography.Paragraph>
        {archive.snapshot.source.character.name}（等级{archive.snapshot.selection.sourceLevel}）→
        {archive.snapshot.target.character.name}（等级{archive.snapshot.selection.targetLevel}）；
        {archive.snapshot.selection.basicAttackSkillKey}，技能等级{archive.snapshot.selection.basicAttackLevel}。
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        冻结装备来源：{archive.equipmentOrigins.length ? archive.equipmentOrigins.map(origin => `${sideLabels[origin.side]} ${origin.equipmentName}（${origin.equipmentKey}）`).join('；') : '双方未选装备'}；
        固定属性不创建独立装备伤害事件。
      </Typography.Paragraph>
      {result ? <>
        <Table data={values} rowKey="key" pagination={false} columns={[
          { title: '指标', dataIndex: 'label' },
          { title: '本次数值', render: (_, row) => <Typography.Text data-testid={`single-attack-${row.key}`}>
            {row.value.toLocaleString('zh-CN', { maximumFractionDigits: 6 })}
          </Typography.Text> }
        ]} />
        <Typography.Paragraph style={{ marginTop: 12 }}>
          执行状态：{result.complete ? '单次执行完整' : '单次执行未完整验证'}；
          停止原因：{stopLabels[result.stopReason] ?? result.stopReason}。
        </Typography.Paragraph>
        {result.issues.length ? <Alert type="warning" content={<span style={{ whiteSpace: 'pre-wrap' }}>{result.issues.join('\n')}</span>} /> : null}
      </> : <Alert type="warning" content="尚无有效运行结果；编译或运行错误不能当成0伤害。" />}
      <Typography.Paragraph>清理状态：{cleanupLabels[archive.cleanup]}。</Typography.Paragraph>
      {archive.failurePhase ? <Typography.Paragraph>失败阶段：{phaseLabels[archive.failurePhase].replace('正在', '')}。</Typography.Paragraph> : null}
      <Typography.Paragraph type="secondary">
        造成伤害为防御后、护盾前金额，实际扣血由生命变化核对。本页只验证一刀，不代表连续攻击通过。
      </Typography.Paragraph>
      {result && archive.runResult?.warnings.length ? <Alert type="warning" content={archive.runResult.warnings.map(row => `${row.code}：${row.message}`).join('；')} /> : null}
      <Button onClick={() => downloadJson('basic-attack-single-run.json', archive)}>下载单次运行档案</Button>
    </section>
  );
}

function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function BasicAttackCompilePanel({ apiBaseUrl, selectedGameId, adminToken, onDirtyChange }: BasicAttackCompilePanelProps) {
  const [selection, setSelection] = useState(emptySelection);
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [attributeDrafts, setAttributeDrafts] = useState(emptyAttributeDrafts);
  const [initialHealth, setInitialHealth] = useState(emptyInitialHealth);
  const [auraConfirmed, setAuraConfirmed] = useState<Record<string, boolean>>({});
  const [durationMs, setDurationMs] = useState<number | undefined>(CONTINUOUS_DURATION_INITIAL_MS);
  const [attackSpeedInputMax, setAttackSpeedInputMax] = useState<number | undefined>();
  const [prepared, setPrepared] = useState<PreparedSimulation | null>(null);
  const [archive, setArchive] = useState<SimulationArchive | null>(null);
  const [recordTimeSeries, setRecordTimeSeries] = useState(true);
  const [resultStale, setResultStale] = useState(false);
  const [phase, setPhase] = useState<TaskPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = useRef(true);
  const taskRef = useRef<Task | null>(null);
  const token = adminToken.trim();
  const busy = phase !== 'idle';
  const { characters, skills, equipment, levels, imageLoader } = useSimulationSelectionOptions(apiBaseUrl, selectedGameId, token, selection.sourceCharacterKey);
  const selectedSkill = skills.items.find(row => row.key === selection.basicAttackSkillKey);
  const skillLevels = useMemo(() => selectedSkill?.kind === 'skill'
    ? Array.from({ length: selectedSkill.maxLevel }, (_, index) => index + 1) : [], [selectedSkill]);
  const levelsSelected = levels.items.includes(selection.sourceLevel!) && levels.items.includes(selection.targetLevel!)
    && skillLevels.includes(selection.basicAttackLevel!);
  const objectsSelected = characters.items.some(row => row.key === selection.sourceCharacterKey)
    && characters.items.some(row => row.key === selection.targetCharacterKey)
    && skills.items.some(row => row.key === selection.basicAttackSkillKey)
    && [...selection.sourceEquipmentKeys, ...selection.targetEquipmentKeys].every(key => equipment.items.some(row => row.key === key));
  const requirements = inspection?.requirements ?? [];
  const missing = requirements.filter(row => row.storedValue === undefined);
  const unfilled = missing.filter(row => attributeDrafts[row.side][row.attribute.attributeKey] === undefined);
  const coverage = prepared?.coverage ?? inspection?.coverage ?? [];
  const healthUnfilled = initialHealth.source === undefined || initialHealth.target === undefined;
  const sourceHealthLimit = snapshot ? simulationHealthLimit(snapshot, 'source', attributeDrafts.source.hp) : undefined;
  const targetHealthLimit = snapshot ? simulationHealthLimit(snapshot, 'target', attributeDrafts.target.hp) : undefined;
  const healthIssues = (['source', 'target'] as const).flatMap(side => {
    const current = initialHealth[side];
    const limit = side === 'source' ? sourceHealthLimit : targetHealthLimit;
    return current !== undefined && (!Number.isFinite(current) || current < 0 || (limit !== undefined && current > limit))
      ? [`initialHealth.${side}: ${sideLabels[side]}当前生命草稿${current}超出0～${limit ?? '待补全'}的含装备上限，请重新填写；不会自动满血或夹取。`] : [];
  });
  const speedAttribute = snapshot?.catalogs.attributes.find(row => row.attributeKey === 'attack_speed');
  const fullHealthAvailable = typeof sourceHealthLimit === 'number' && Number.isFinite(sourceHealthLimit) && sourceHealthLimit > 0
    && typeof targetHealthLimit === 'number' && Number.isFinite(targetHealthLimit) && targetHealthLimit > 0;

  useEffect(() => {
    active.current = true;
    setSelection(emptySelection());
    setSnapshot(null);
    setInspection(null);
    setAttributeDrafts(emptyAttributeDrafts());
    setInitialHealth(emptyInitialHealth());
    setAuraConfirmed({});
    setDurationMs(CONTINUOUS_DURATION_INITIAL_MS);
    setRecordTimeSeries(true);
    setResultStale(false);
    setAttackSpeedInputMax(undefined);
    setPrepared(null);
    setArchive(null);
    setPhase('idle');
    setError(null);
    setNotice(null);
    return () => {
      active.current = false;
      const task = taskRef.current;
      taskRef.current = null;
      if (task) {
        task.cancelled = true;
        task.controller.abort();
        task.client?.terminate();
      }
      onDirtyChange(false);
    };
  }, [apiBaseUrl, selectedGameId, token, onDirtyChange]);

  const isCurrent = (task: Task) => active.current && taskRef.current === task && !task.cancelled;

  const beginTask = (nextPhase: Exclude<TaskPhase, 'idle'>, kind: TaskKind = nextPhase === 'reading' ? 'snapshot' : 'compile'): Task | null => {
    if (taskRef.current) return null;
    const task: Task = {
      kind, phase: nextPhase, failurePhase: null, cancelled: false, controller: new AbortController(), client: null,
      snapshot: null, prepared: null, result: null, release: null, sessionId: null,
      runRequest: null, runResult: null, assessment: null, continuousPrepared: null, continuousAssessment: null, cleanup: 'not_needed'
    };
    taskRef.current = task;
    setPhase(nextPhase);
    setError(null);
    setNotice(null);
    onDirtyChange(true);
    return task;
  };

  const finishTask = (task: Task) => {
    if (!isCurrent(task)) return;
    taskRef.current = null;
    setPhase('idle');
    onDirtyChange(false);
  };

  const cancelTask = () => {
    const task = taskRef.current;
    if (!task) return;
    task.cancelled = true;
    task.controller.abort();
    task.client?.terminate();
    task.cleanup = task.client ? 'worker_destroyed' : 'not_needed';
    taskRef.current = null;
    const cancelledArchive = archiveFor(task, 'cancelled', null);
    setArchive(current => cancelledArchive ?? current);
    setResultStale(cancelledArchive === null);
    setPhase('idle');
    setError(null);
    setNotice(task.kind === 'snapshot' ? '当前场景读取已取消，保留已有输入。'
      : task.kind === 'single_attack' ? '当前任务已取消，未完成单次运行验证。'
        : task.kind === 'continuous_attack' ? '当前任务已取消，未完成连续运行验证。' : '当前任务已取消，未完成编译验证。');
    onDirtyChange(false);
  };

  const invalidateRunResult = (preserveSingleResult = false) => {
    setArchive(current => preserveSingleResult || current?.taskKind === 'continuous_attack' ? current : null);
    setResultStale(true);
  };

  const clearArtifacts = (preserveDrafts = false) => {
    setAuraConfirmed({});
    setSnapshot(null);
    setInspection(null);
    if (!preserveDrafts) {
      setAttributeDrafts(emptyAttributeDrafts());
      setInitialHealth(emptyInitialHealth());
      setAttackSpeedInputMax(undefined);
    }
    setPrepared(null);
    invalidateRunResult(true);
    setError(null);
    setNotice(null);
  };

  const patchSelection = <K extends keyof SelectionDraft>(key: K, value: SelectionDraft[K]) => {
    if (taskRef.current) return;
    setSelection(current => ({ ...current, [key]: value,
      ...(key === 'sourceCharacterKey' ? { basicAttackSkillKey: '', basicAttackLevel: undefined }
        : key === 'basicAttackSkillKey' ? { basicAttackLevel: undefined } : {}) }));
    clearArtifacts();
  };

  const patchEquipment = (side: 'source' | 'target', values: string[]) => {
    if (taskRef.current) return;
    try {
      const keys = normalizeEquipmentKeys(values, `selection.${side}EquipmentKeys`);
      setSelection(current => ({ ...current, [`${side}EquipmentKeys`]: keys }));
      clearArtifacts(true);
    } catch (cause) { setError(taskError(cause)); }
  };

  const readSnapshot = async () => {
    if (taskRef.current || !selectedGameId || !token || !objectsSelected) return;
    let requested: SimulationSelection;
    try { requested = selectionFromDraft(selection, levels.items, skillLevels); }
    catch (cause) { setError(taskError(cause)); return; }
    const task = beginTask('reading');
    if (!task) return;
    setPrepared(null);
    invalidateRunResult(true);
    try {
      const result = await getSimulationSnapshot(apiBaseUrl, selectedGameId, requested, token, task.controller.signal);
      if (!isCurrent(task)) return;
      const nextInspection = inspectSimulationSnapshot(result.data);
      task.snapshot = result.data;
      setSnapshot(result.data);
      setInspection(nextInspection);
      setAttackSpeedInputMax(undefined);
      setNotice('场景快照已读取，请核对已录属性并明确填写必要的场景补充值。');
    } catch (cause) {
      if (isCurrent(task)) setError(taskError(cause));
    } finally {
      finishTask(task);
    }
  };

  const updateAttribute = (row: SimulationAttributeRequirement, value: number | undefined) => {
    if (taskRef.current || row.storedValue !== undefined) return;
    setAttributeDrafts(current => ({
      ...current, [row.side]: { ...current[row.side], [row.attribute.attributeKey]: value }
    }));
    setPrepared(null);
    invalidateRunResult(row.attribute.attributeKey === 'attack_speed_ratio');
    setError(null);
    setNotice(null);
  };

  const fillMissingWithZero = () => {
    if (taskRef.current) return;
    setAttributeDrafts(current => {
      const next = { source: { ...current.source }, target: { ...current.target } };
      for (const row of missing) {
        const key = row.attribute.attributeKey;
        if (key !== 'attack_speed_ratio' && next[row.side][key] === undefined) next[row.side][key] = 0;
      }
      return next;
    });
    setPrepared(null);
    invalidateRunResult();
    setError(null);
    setNotice(null);
  };

  const updateInitialHealth = (side: 'source' | 'target', value: number | undefined) => {
    if (taskRef.current) return;
    setInitialHealth(current => ({ ...current, [side]: value }));
    setPrepared(null);
    invalidateRunResult();
    setError(null);
    setNotice(null);
  };

  const startAtFullHealth = () => {
    if (taskRef.current || !fullHealthAvailable) return;
    setInitialHealth({ source: sourceHealthLimit, target: targetHealthLimit });
    setPrepared(null);
    invalidateRunResult();
    setError(null);
    setNotice(null);
  };

  const updateContinuousInput = (field: 'duration' | 'speed', value: number | undefined) => {
    if (taskRef.current) return;
    if (field === 'duration') setDurationMs(value); else setAttackSpeedInputMax(value);
    setPrepared(null); invalidateRunResult(); setError(null); setNotice(null);
  };

  const execute = async (kind: 'compile' | 'single_attack' | 'continuous_attack') => {
    if (taskRef.current || !snapshot || !inspection) return;
    if (kind !== 'compile') {
      for (const side of ['source', 'target'] as const) {
        const hp = initialHealth[side];
        if (hp === undefined || !Number.isFinite(hp) || hp <= 0) {
          setError(`initialHealth.${side}: ${hp === 0 ? `${sideLabels[side]}初始已死亡，不能执行本阶段${kind === 'single_attack' ? '单次' : '连续'}普攻。`
            : `请明确填写${sideLabels[side]}的有限正生命值。`}`);
          setNotice(null);
          return;
        }
      }
    }
    const task = beginTask('preparing', kind);
    if (!task) return;
    task.snapshot = structuredClone(snapshot);
    const continuousInputs = { durationMs: durationMs as number, attackSpeedInputMax, recordTimeSeries };
    setPrepared(null);
    invalidateRunResult();
    let failure: string | null = null;
    try {
      const inputs: SimulationAttributeInputs = { source: {}, target: {} };
      for (const row of missing) {
        const key = row.attribute.attributeKey;
        const value = attributeDrafts[row.side][key];
        if (value === undefined) throw new Error(`attributeInputs.${row.side}.${key}: 尚未填写场景补充值。`);
        inputs[row.side][key] = value;
      }
      if (initialHealth.source === undefined) throw new Error('initialHealth.source: 请明确填写攻击方初始当前生命。');
      if (initialHealth.target === undefined) throw new Error('initialHealth.target: 请明确填写目标初始当前生命。');
      const assumptions: SimulationEquipmentAssumption[] = equipmentRangeRequirements(task.snapshot)
        .map(({ owner, equipmentKey }) => ({ owner, equipmentKey, target: owner === 'source' ? 'target' : 'source', inRange: auraConfirmed[`${owner}:${equipmentKey}`] === true }));
      task.prepared = await prepareSimulation(task.snapshot, inputs, { source: initialHealth.source, target: initialHealth.target }, assumptions);
      if (!isCurrent(task)) return;
      if (kind === 'continuous_attack') {
        task.continuousPrepared = await continuousAttackRequest(task.prepared, task.snapshot, continuousInputs);
        if (!isCurrent(task)) return;
      }
      setPrepared(task.prepared);
      task.client = new GenericEngineClient();
      task.phase = 'compiling';
      setPhase('compiling');
      task.result = await task.client.compile(task.prepared.compileRequest);
      task.sessionId = task.result.sessionId ?? null;
      if (!isCurrent(task)) return;
      if (!task.result.ok) {
        failure = task.result.errors?.map(item => `${item.path ? `${item.path}: ` : ''}${item.code} ${item.message}`).join('\n')
          || '编译返回未通过。';
      } else if (!task.sessionId) {
        failure = '编译响应缺少会话标识，无法完成编译验证。';
      } else if (task.result.rulesHash !== task.prepared.compileRequest.rulesHash
        || task.result.schemaHash !== task.prepared.compileRequest.schemaHash) {
        failure = '编译响应的结构或规则摘要与本次请求不一致。';
      }
      if (failure) task.failurePhase = 'compiling';
      if (!failure && kind !== 'compile') {
        task.runRequest = kind === 'single_attack' ? singleAttackRequest(task.prepared.compileRequest, task.sessionId!)
          : { ...task.continuousPrepared!.runRequest, sessionId: task.sessionId! };
        task.runRequest.runtimeOptions = { equipmentAssumptions: task.prepared.equipmentAssumptions };
        task.phase = 'running';
        setPhase('running');
        task.runResult = await task.client.run(task.runRequest);
        if (!isCurrent(task)) return;
        if (kind === 'single_attack') {
          task.assessment = assessSingleAttackResult(task.prepared.compileRequest, task.runRequest, task.runResult);
          if (!task.assessment.complete) failure = `单次执行未完整验证：${task.assessment.issues.join('；')}`;
        } else {
          task.continuousAssessment = assessContinuousAttackResult(task.prepared.compileRequest, task.runRequest, task.runResult, task.prepared.operationOrigins);
          if (!task.continuousAssessment.complete) failure = `连续计算未完整完成：${task.continuousAssessment.issues.join('；')
            || (task.continuousAssessment.execution.incompleteReason === 'unfinished_tail' ? '同步尾部未完成' : '执行预算停止')}`;
        }
        if (failure) task.failurePhase = 'running';
      }
    } catch (cause) {
      if (cause instanceof GenericEngineClientError) task.sessionId = cause.engineError?.sessionId ?? task.sessionId;
      if (isCurrent(task)) { failure = taskError(cause); task.failurePhase = task.phase; }
    } finally {
      if (task.client) {
        try {
          if (!task.cancelled && task.sessionId && task.client.hasLiveWorker) {
            task.phase = 'releasing';
            if (isCurrent(task)) setPhase('releasing');
            task.release = await task.client.release(task.sessionId, task.prepared?.compileRequest.rulesHash);
            if (task.release.sessionId !== task.sessionId) throw new Error('释放响应不属于本次会话。');
            task.cleanup = 'released';
          } else if (!task.client.hasLiveWorker) {
            task.cleanup = 'worker_destroyed';
          }
        } catch (cause) {
          task.cleanup = 'release_failed';
          if (isCurrent(task)) {
            task.failurePhase ??= 'releasing';
            failure = `${failure ? `${failure}\n` : ''}会话释放失败：${taskError(cause)}`;
          }
        } finally {
          task.client.terminate();
        }
      }
      if (isCurrent(task)) {
        const passed = failure === null && task.result?.ok === true && task.release?.released === true
          && task.cleanup === 'released' && (kind === 'compile' || task.assessment?.complete === true || task.continuousAssessment?.complete === true);
        if (!passed && failure === null) failure = kind === 'single_attack'
          ? '未完成完整单次运行与会话释放，不能标记运行通过。'
          : kind === 'continuous_attack' ? '未完成完整连续运行与会话释放，不能标记运行通过。' : '未完成编译与会话释放，不能标记验证通过。';
        const nextArchive = archiveFor(task, passed ? 'passed' : 'failed', failure);
        setArchive(current => nextArchive ?? current);
        setResultStale(nextArchive === null);
        setError(failure);
        setNotice(passed ? kind === 'single_attack' ? '单次普攻运行通过，不代表连续攻击通过。'
          : kind === 'continuous_attack' ? task.continuousAssessment?.execution.targetKilled ? '连续普攻已完成击杀，会话正常释放。'
            : '连续普攻已完成观察，目标未被击杀，会话正常释放。'
          : '仅编译验证通过，不代表单次/连续计算通过。' : null);
        finishTask(task);
      }
    }
  };

  // Space 会过滤空子节点；固定区域标识，避免提示增减时重挂载输入框。
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {!selectedGameId ? <Alert key="missing-game" type="warning" content="请先在顶部选择游戏。" /> : null}
      {selectedGameId && !token ? <Alert key="missing-token" type="warning" content="请先在顶部配置 Admin Token。" /> : null}
      {error ? <Alert key="task-error" type="error" content={<span style={{ whiteSpace: 'pre-wrap' }}>{error}</span>} /> : null}
      {notice ? <Alert key="task-notice" type={archive?.outcome === 'passed' ? 'success' : 'info'} content={notice} /> : null}
      {busy ? <Alert key="task-progress" type="info" content={phase === 'running' && taskRef.current?.kind === 'continuous_attack'
        ? '正在执行连续普攻' : phaseLabels[phase as Exclude<TaskPhase, 'idle'>]} /> : null}
      {characters.error ? <Alert key="character-options-error" type="error" content={`角色列表读取失败：${characters.error}`}
        action={<Button disabled={busy} onClick={characters.retry}>重试角色列表</Button>} /> : null}
      {skills.error ? <Alert key="skill-options-error" type="error" content={`普攻列表读取失败：${skills.error}`}
        action={<Button disabled={busy} onClick={skills.retry}>重试普攻列表</Button>} /> : null}
      {levels.error ? <Alert key="level-options-error" type="error" content={`角色等级范围读取失败：${levels.error}`}
        action={<Button disabled={busy} onClick={levels.retry}>重试等级范围</Button>} /> : null}
      {equipment.error ? <Alert key="equipment-options-error" type="error" content={`装备列表读取失败：${equipment.error}`}
        action={<Button disabled={busy} onClick={equipment.retry}>重试装备列表</Button>} /> : null}
      {healthIssues.length ? <Alert key="health-limit-error" type="error" content={healthIssues.join('\n')} /> : null}
      {archive && resultStale && archive.taskKind !== 'continuous_attack' ? <Alert key="previous-result-stale" type="warning"
        content="输入已改变；上一份冻结结果已过期，不代表当前场景。" /> : null}

      <Form key="scene-selection" layout="vertical" aria-label="普攻场景选择">
        <div className="simulation-combatants-grid">
          <section className="simulation-combatant-config" aria-labelledby="simulation-source-config-title">
            <Typography.Title heading={5} id="simulation-source-config-title" style={{ margin: '0 0 16px' }}>攻击方配置</Typography.Title>
            <Form.Item label="攻击方角色" required>
              <SimulationEntitySelect label="攻击方角色" value={selection.sourceCharacterKey} options={characters.items}
                loading={characters.loading} disabled={busy || !selectedGameId || !token || characters.loading || Boolean(characters.error)}
                loadImage={imageLoader} onChange={value => patchSelection('sourceCharacterKey', value)} placeholder="搜索角色名称或标识" />
            </Form.Item>
            <Form.Item label="攻击方等级" required>
              <Select aria-label="攻击方等级" className="simulation-level-select" value={selection.sourceLevel} allowClear
                loading={levels.loading} disabled={busy || levels.loading || !levels.items.length || Boolean(levels.error)}
                options={levels.items.map(value => ({ value, label: String(value) }))}
                placeholder={levels.loading ? '正在读取等级范围…' : '请选择等级'}
                onChange={(value: number | undefined) => patchSelection('sourceLevel', value)} />
            </Form.Item>
            <Form.Item label="普攻技能" required>
              <SimulationEntitySelect label="普攻技能" value={selection.basicAttackSkillKey} options={skills.items}
                loading={skills.loading} disabled={busy || !characters.items.some(row => row.key === selection.sourceCharacterKey)
                  || skills.loading || Boolean(skills.error) || !selectedGameId || !token}
                loadImage={imageLoader} onChange={value => patchSelection('basicAttackSkillKey', value)}
                placeholder={!selection.sourceCharacterKey ? '先选择攻击方角色' : skills.loading ? '正在读取挂载的普攻…'
                  : skills.error ? '普攻读取失败，请重试'
                  : skills.items.length ? '搜索普攻名称或标识' : '此角色没有启用的普攻技能'} />
            </Form.Item>
            <Form.Item label="普攻技能等级" required>
              <Select aria-label="普攻技能等级" className="simulation-level-select" value={selection.basicAttackLevel} allowClear
                loading={skills.loading} disabled={busy || skills.loading || !skillLevels.length || Boolean(skills.error)}
                options={skillLevels.map(value => ({ value, label: String(value) }))}
                placeholder={!selectedSkill ? '先选择普攻技能' : '请选择技能等级'}
                onChange={(value: number | undefined) => patchSelection('basicAttackLevel', value)} />
            </Form.Item>
            <Form.Item label="攻击方装备（最多6件）">
              <Select aria-label="攻击方装备" className="simulation-equipment-select" mode="multiple" allowClear showSearch
                value={selection.sourceEquipmentKeys} loading={equipment.loading}
                disabled={busy || !selectedGameId || !token || equipment.loading || Boolean(equipment.error)}
                filterOption={(input, option) => String(option.props.children)
                  .toLowerCase().includes(input.trim().toLowerCase())}
                options={equipment.items.map(item => ({ value: item.key, label: `${item.name}（${item.key}）`,
                  disabled: selection.sourceEquipmentKeys.length >= 6 && !selection.sourceEquipmentKeys.includes(item.key) }))}
                placeholder="可留空；搜索真实装备名称或标识" onChange={(values: string[]) => patchEquipment('source', values)} />
            </Form.Item>
          </section>
          <section className="simulation-combatant-config" aria-labelledby="simulation-target-config-title">
            <Typography.Title heading={5} id="simulation-target-config-title" style={{ margin: '0 0 16px' }}>目标方配置</Typography.Title>
            <Form.Item label="目标角色" required>
              <SimulationEntitySelect label="目标角色" value={selection.targetCharacterKey} options={characters.items}
                loading={characters.loading} disabled={busy || !selectedGameId || !token || characters.loading || Boolean(characters.error)}
                loadImage={imageLoader} onChange={value => patchSelection('targetCharacterKey', value)} placeholder="搜索角色名称或标识" />
            </Form.Item>
            <Form.Item label="目标等级" required>
              <Select aria-label="目标等级" className="simulation-level-select" value={selection.targetLevel} allowClear
                loading={levels.loading} disabled={busy || levels.loading || !levels.items.length || Boolean(levels.error)}
                options={levels.items.map(value => ({ value, label: String(value) }))}
                placeholder={levels.loading ? '正在读取等级范围…' : '请选择等级'}
                onChange={(value: number | undefined) => patchSelection('targetLevel', value)} />
            </Form.Item>
            <Form.Item label="目标装备（最多6件）">
              <Select aria-label="目标装备" className="simulation-equipment-select" mode="multiple" allowClear showSearch
                value={selection.targetEquipmentKeys} loading={equipment.loading}
                disabled={busy || !selectedGameId || !token || equipment.loading || Boolean(equipment.error)}
                filterOption={(input, option) => String(option.props.children)
                  .toLowerCase().includes(input.trim().toLowerCase())}
                options={equipment.items.map(item => ({ value: item.key, label: `${item.name}（${item.key}）`,
                  disabled: selection.targetEquipmentKeys.length >= 6 && !selection.targetEquipmentKeys.includes(item.key) }))}
                placeholder="可留空；搜索真实装备名称或标识" onChange={(values: string[]) => patchEquipment('target', values)} />
            </Form.Item>
          </section>
        </div>
        <Typography.Paragraph type="secondary">
          纯属性样本：{PURE_EQUIPMENT_KEYS.join('、')}。被动按完整技能配置激活命中、计数、额外联动、受击及周期；未接入的节点整件拒绝。鬼索、荆棘、日炎部分时序使用项目暂定配置，后续可校准。
          同一装备可由双方各选一次，换装保留当前生命草稿，必须重新读取快照。
        </Typography.Paragraph>
        <Space wrap>
          <Button type="primary" disabled={busy || !selectedGameId || !token || !objectsSelected || !levelsSelected} onClick={() => void readSnapshot()}>
            读取场景快照
          </Button>
          {busy ? <Button status="danger" onClick={cancelTask}>取消当前请求</Button> : null}
        </Space>
      </Form>

      {snapshot ? (
        <section key="scene-snapshot" aria-label="场景快照">
          {equipmentRangeRequirements(snapshot).map(({ owner, equipmentKey, equipmentName }) => (
            <Checkbox key={`${owner}:${equipmentKey}`} aria-label={equipmentKey === 'item_3110' ? `${sideLabels[owner]}冰心全程在范围内` : `${sideLabels[owner]}${equipmentName}全程在范围内`} checked={auraConfirmed[`${owner}:${equipmentKey}`] === true} disabled={busy}
              onChange={checked => {
                setAuraConfirmed(current => ({ ...current, [`${owner}:${equipmentKey}`]: checked }));
                setPrepared(null); invalidateRunResult(); setError(null); setNotice(null);
              }}>
              明确确认：{sideLabels[owner]}{equipmentName}的唯一对手全程在作用范围内（不模拟进出范围或多来源叠加）
            </Checkbox>
          ))}
          <Typography.Paragraph>
            攻击方：{snapshot.source.character.name}（{snapshot.selection.sourceCharacterKey}，等级{snapshot.selection.sourceLevel}）；
            目标：{snapshot.target.character.name}（{snapshot.selection.targetCharacterKey}，等级{snapshot.selection.targetLevel}）。
          </Typography.Paragraph>
          <Typography.Paragraph style={{ overflowWrap: 'anywhere' }}>
            原快照摘要：<Typography.Text code id="simulation-snapshot-digest">{snapshot.snapshotDigest}</Typography.Text>
          </Typography.Paragraph>
          <Button disabled={busy} onClick={() => downloadJson('basic-attack-snapshot.json', snapshot)}>下载场景快照</Button>
          <Table data={inspection?.equipmentOrigins ?? []} rowKey={row => `${row.side}:${row.equipmentKey}`} pagination={false} columns={[
            { title: '拥有方', render: (_, row) => sideLabels[row.side] },
            { title: '装备', render: (_, row) => `${row.equipmentName}（${row.equipmentKey}）` },
            { title: '固定属性增量', render: (_, row) => Object.entries(row.attributeValues).map(([key, value]) => `${key}: ${value}`).join('；') },
            { title: '独立来源标识', dataIndex: 'providerRef' }
          ]} />
          {(['source', 'target'] as const).filter(side => snapshot[side].selectedEquipment.some(item => 'bonus_attack_speed_percent' in item.attributes.attributeValues)).map(side => (
            <Typography.Paragraph key={`${side}-speed-chain`}>
              {sideLabels[side]}攻速来源链：固有每秒攻击次数 → 加上收益系数（attack_speed_ratio，需明确正值）×
              （额外攻速总比例 − 固有额外比例）；装备额外比例平加为{equipmentContribution(snapshot, side, 'bonus_attack_speed_percent')}。
              派生由原生引擎执行，不另建攻击时钟。
            </Typography.Paragraph>
          ))}
        </section>
      ) : null}

      {inspection && snapshot ? (
        <section key="initial-health" aria-label="初始当前生命">
          <Typography.Title heading={5}>初始当前生命</Typography.Title>
          <Typography.Paragraph>
            双方当前生命必须明确填写且不能超过固有生命加本次装备贡献的上限，未填写不会默认满生命。
            0可用于编译检查；单次和连续运行均要求双方当前生命大于0。
          </Typography.Paragraph>
          <Form layout="vertical">
            <div className="simulation-selection-grid">
              <Form.Item label="攻击方初始当前生命" required>
                <InputNumber aria-label="攻击方初始当前生命" value={initialHealth.source} disabled={busy}
                  onChange={value => updateInitialHealth('source', value)} />
                <Typography.Text type="secondary">含装备生命上限：{sourceHealthLimit ?? '固有生命未录入，请补全'}</Typography.Text>
              </Form.Item>
              <Form.Item label="目标初始当前生命" required>
                <InputNumber aria-label="目标初始当前生命" value={initialHealth.target} disabled={busy}
                  onChange={value => updateInitialHealth('target', value)} />
                <Typography.Text type="secondary">含装备生命上限：{targetHealthLimit ?? '固有生命未录入，请补全'}</Typography.Text>
              </Form.Item>
            </div>
          </Form>
          <Button disabled={busy || !fullHealthAvailable} onClick={startAtFullHealth}>双方以满生命开始</Button>
        </section>
      ) : null}

      {inspection ? (
        <section key="required-attributes" aria-label="必要属性">
          <Typography.Title heading={5}>必要属性与场景补充值</Typography.Title>
          <Typography.Paragraph>
            已录固有属性直接使用且不可覆盖；空白表示未填写，明确的0与未填写不同。
            缺失项只补本次场景，不写入角色或数据库。还需填写{unfilled.length}项。
          </Typography.Paragraph>
          <Table<SimulationAttributeRequirement>
            rowKey={row => `${row.side}.${row.attribute.attributeKey}`}
            data={requirements} pagination={false} scroll={{ x: 900 }}
            columns={[
              { title: '对象', render: (_, row) => sideLabels[row.side] },
              { title: '属性', render: (_, row) => `${row.attribute.name}（${row.attribute.attributeKey}）` },
              { title: '类型', render: (_, row) => row.attribute.valueType === 'INTEGER' ? '整数' : '小数' },
              { title: '已录固有值', render: (_, row) => row.storedValue === undefined ? '未录入' : String(row.storedValue) },
              { title: '场景补充值', render: (_, row) => row.storedValue === undefined ? (
                <InputNumber aria-label={`${sideLabels[row.side]}补充属性 ${row.attribute.attributeKey}`}
                  value={attributeDrafts[row.side][row.attribute.attributeKey]} disabled={busy}
                  min={row.attribute.minValue ?? undefined} max={row.attribute.maxValue ?? undefined}
                  precision={row.attribute.valueType === 'INTEGER' ? 0 : undefined}
                  onChange={value => updateAttribute(row, value)} placeholder="明确填写本次场景值" />
              ) : '直接使用已录值' }
            ]}
          />
          <Form layout="vertical" style={{ marginTop: 16 }} aria-label="连续普攻运行输入">
            <div className="simulation-selection-grid">
              <Form.Item label="曲线记录">
                <Checkbox aria-label="记录时间序列" checked={recordTimeSeries} disabled={busy} onChange={value => {
                  setRecordTimeSeries(value); setPrepared(null); invalidateRunResult();
                }}>记录时间序列（100毫秒请求间隔，1000毫秒窗口，最多5000点）</Checkbox>
              </Form.Item>
              <Form.Item label="观察时长（毫秒）" required>
                <InputNumber aria-label="观察时长（毫秒）" value={durationMs} disabled={busy}
                  min={1} max={600000} precision={0} onChange={value => updateContinuousInput('duration', value)} />
                <Typography.Text type="secondary">30000毫秒为技术运行初值，可以修改。</Typography.Text>
              </Form.Item>
              {speedAttribute?.maxValue === null ? <Form.Item label="攻速输入上界" required>
                <InputNumber aria-label="攻速输入上界" value={attackSpeedInputMax} disabled={busy}
                  onChange={value => updateContinuousInput('speed', value)} placeholder="明确填写不小于本场景攻速的正上界" />
                <Typography.Text type="secondary">真实属性目录未设上界，请显式填写；仅作输入准入，不是游戏攻速封顶。</Typography.Text>
              </Form.Item> : <Typography.Paragraph>攻速输入上界：{speedAttribute?.maxValue ?? '目录缺失'}（来自真实属性范围）。</Typography.Paragraph>}
            </div>
            <Typography.Paragraph type="secondary">连续场景按完整装备技能配置执行，计数、联动、受击、周期及攻速改期由原生处理；无前摇或弹道。项目暂定时序不等于游戏机制已核实。模拟观察时长与30秒真实运行超时分别计时。</Typography.Paragraph>
          </Form>
          <Space wrap style={{ marginTop: 16 }}>
            <Button disabled={busy || unfilled.length === 0} onClick={fillMissingWithZero}>将缺失属性填写为0</Button>
            <Button type="primary" disabled={busy || unfilled.length > 0 || healthUnfilled || healthIssues.length > 0} onClick={() => void execute('single_attack')}>执行一次普攻</Button>
            <Button type="primary" disabled={busy || unfilled.length > 0 || healthUnfilled || healthIssues.length > 0} onClick={() => void execute('continuous_attack')}>连续普攻</Button>
            <Button disabled={busy || unfilled.length > 0 || healthUnfilled || healthIssues.length > 0} onClick={() => void execute('compile')}>编译验证</Button>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
            补零按钮只填写仍为空的缺失项，保留已填数值；攻速收益系数不补零，须明确填写正值；违反原属性范围的0仍会被拒绝。
          </Typography.Paragraph>
        </section>
      ) : null}

      {archive?.taskKind === 'single_attack' ? <SingleAttackResult key="single-attack-result" archive={archive} /> : null}
      {archive?.taskKind === 'continuous_attack' ? <ContinuousAttackResult key="continuous-attack-result" archive={archive} stale={resultStale}
        cleanupLabel={cleanupLabels[archive.cleanup]} released={archive.cleanup === 'released'} warnings={archive.runResult?.warnings ?? []}
        onDownload={view => downloadJson('basic-attack-continuous-run.json', buildContinuousAttackArchive(archive, view))} /> : null}

      <details key="debug-details">
        <summary>调试详情：编译请求、原始结果与引用覆盖</summary>
      {prepared ? (
        <section aria-label="编译请求与档案">
          <Typography.Paragraph style={{ overflowWrap: 'anywhere' }}>
            请求规则摘要：<Typography.Text code id="simulation-rules-hash">{prepared.compileRequest.rulesHash}</Typography.Text>
          </Typography.Paragraph>
          <Space wrap>
            <Button disabled={busy} onClick={() => downloadJson('basic-attack-compile-request.json', prepared.compileRequest)}>下载编译请求</Button>
            <Button disabled={busy || archive?.taskKind !== 'compile'} onClick={() => archive?.taskKind === 'compile' && downloadJson('basic-attack-compile-archive.json', archive)}>下载编译档案</Button>
          </Space>
          {archive?.compileResult?.metadata ? <JsonBlock value={archive.compileResult.metadata} /> : null}
          {archive?.compileResult?.errors?.length ? <JsonBlock value={archive.compileResult.errors} /> : null}
          {archive?.compileResult?.warnings?.length ? <JsonBlock value={archive.compileResult.warnings} /> : null}
          {archive && archive.taskKind !== 'compile' && archive.runResult ? <JsonBlock value={archive.runResult} /> : null}
          {archive?.taskKind === 'continuous_attack' ? <Typography.Paragraph>冻结运行条件摘要：{archive.runInputHash ?? '尚未完成准备'}</Typography.Paragraph> : null}
        </section>
      ) : null}

      {inspection ? (
        <section aria-label="引用覆盖清单">
          <Typography.Title heading={5}>引用覆盖清单</Typography.Title>
          <Typography.Paragraph>共{coverage.length}项作者引用对应编译节点；该清单不表示这些节点已经运行。</Typography.Paragraph>
          <Table<SimulationCoverage> data={coverage} rowKey={row => `${row.authorPath}:${row.compiledPath}`}
            pagination={false} scroll={{ x: 1000, y: 320 }} columns={[
              { title: '作者配置路径', dataIndex: 'authorPath' }, { title: '编译节点路径', dataIndex: 'compiledPath' }
            ]} />
        </section>
      ) : null}
      </details>
    </Space>
  );
}
