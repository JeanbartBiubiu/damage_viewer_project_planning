import { preflightSkillFormulas, snapshotFormulaProofIdentity } from '../../engine/skillFormulaPreflight';
import { clearFormulaProofScope, validateConsumedFormulaValues, validateApprovedFormulaValues } from '../../engine/approvedFormulaValues';
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
import { getSimulationSnapshot, normalizeEquipmentKeys, normalizeSimulationSelection } from '../../services/simulationSnapshotClient';
import { simulationSkillSourceIdentity } from '../../services/simulationSkillSourceIdentity';
import { equipmentContribution, simulationHealthLimit } from '../../engine/simulationEquipment';
import { equipmentRangeRequirements } from '../../engine/simulationEquipmentPassives';
import type { CompileResult, DoneResult, GenericReleaseDonePayload, RunRequest } from '../../types/genericEngine';
import type { BuildConfiguration, BuildDefinition, SimulationAttributeInputs, SimulationEquipmentAssumption, SimulationInitialHealth,
  SimulationSelection, SimulationSkillOrigin, SimulationSkillSetting, SimulationSkillSource, SimulationSnapshot } from '../../types/simulationSnapshot';
import { SimulationEntitySelect } from './SimulationEntitySelect';
import { SimulationEquipmentSelect } from './SimulationEquipmentSelect';
import { useSimulationSelectionOptions } from './useSimulationSelectionOptions';
import { assessSingleAttackResult, type SingleAttackAssessment } from '../../engine/singleAttackResult';
import { continuousAttackRequest, CONTINUOUS_DURATION_INITIAL_MS, type PreparedContinuousAttack } from '../../engine/continuousAttackRequest';
import { assessContinuousAttackResult, type ContinuousAttackAssessment } from '../../engine/continuousAttackResult';
import { ContinuousAttackResult } from './ContinuousAttackResult';
import { buildContinuousAttackArchive } from '../../engine/continuousAttackArchive';
import { SimulationBuildConfigurationEditor } from './SimulationBuildConfigurationEditor';
import { SimulationSkillSources } from './SimulationSkillSources';
import { fillSimulationSkillLevelDefaults } from './simulationSkillLevelDefaults';
import { SimulationMechanicInputs } from './SimulationMechanicInputs';
import { mechanicDraftIssues, mechanicInputsFromDrafts, type SimulationMechanicDrafts } from './simulationMechanicDrafts';
import './SimulationSkillSources.css';
import { skillActionRequest, type PreparedSkillAction, type SkillActionInputs, type SkillActionInput } from '../../engine/skillActionRequest';
import { assessSkillActionResult, type SkillActionAssessment } from '../../engine/skillActionResult';
import { SkillActionResult } from './SkillActionResult';
import { simulationCastCostCandidates, type SimulationCastCostRef } from '../../engine/simulationActiveSkills';
import { plannedSkillsFromActions, removeSkillActionDraft, skillActionParentCandidates, skillActionPhases } from './simulationSkillActionDrafts';

export type BasicAttackCompilePanelProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onDirtyChange: (busy: boolean) => void;
};

type SelectionDraft = Omit<SimulationSelection, 'sourceLevel' | 'targetLevel' | 'basicAttackLevel' | 'basicAttackSkillKey'> & {
  sourceLevel: number | undefined;
  targetLevel: number | undefined;
  basicAttackLevel: number | undefined;
  basicAttackSkillKey: string;
};
type Inspection = ReturnType<typeof inspectSimulationSnapshot>;
type PreparedSimulation = Awaited<ReturnType<typeof prepareSimulation>>;
type AttributeDrafts = { source: Record<string, number | undefined>; target: Record<string, number | undefined> };
type InitialHealthDraft = { source: number | undefined; target: number | undefined };
type TaskPhase = 'idle' | 'reading' | 'preparing' | 'compiling' | 'running' | 'releasing';
type TaskKind = 'snapshot' | 'compile' | 'single_attack' | 'continuous_attack' | 'skill_action';
type Cleanup = 'not_needed' | 'released' | 'worker_destroyed' | 'release_failed';
type Task = {
  kind: TaskKind;
  phase: Exclude<TaskPhase, 'idle'>;
  failurePhase: Exclude<TaskPhase, 'idle'> | null;
  cancelled: boolean;
  controller: AbortController;
  client: GenericEngineClient | null;
  formulaPreflight?: { compileCount: number; released: boolean; formulaCount: number };
  formulaProofIdentity?: string;
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
  skillPrepared: PreparedSkillAction | null;
  skillAssessment: SkillActionAssessment | null;
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
  mechanicStateInputs: PreparedSimulation['mechanicStateInputs'];
  ignoredCastCosts: SimulationCastCostRef[];
  compileRequest: PreparedSimulation['compileRequest'];
  coverage: SimulationCoverage[];
  operationOrigins: PreparedSimulation['operationOrigins'];
  equipmentOrigins: PreparedSimulation['equipmentOrigins'];
  skillOrigins: PreparedSimulation['skillOrigins'];
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
export type SkillActionArchive = Omit<SingleAttackArchive, 'taskKind' | 'assessment'> & {
  taskKind: 'skill_action'; assessment: SkillActionAssessment | null; runInputHash: string | null;
  attackSpeedAdmission: PreparedSkillAction['attackSpeedAdmission'];
};
type SimulationArchive = CompileArchive | SingleAttackArchive | ContinuousAttackArchive | SkillActionArchive;

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
    basicAttackSkillKey: '', basicAttackLevel: undefined, plannedSkills: [], sourceEquipmentKeys: [], targetEquipmentKeys: [],
    sourceBuildConfigurations: [], targetBuildConfigurations: [], sourceSkillSettings: [], targetSkillSettings: []
  };
}

function emptyAttributeDrafts(): AttributeDrafts { return { source: {}, target: {} }; }
function emptyInitialHealth(): InitialHealthDraft { return { source: undefined, target: undefined }; }

function selectionFromDraft(draft: SelectionDraft, characterLevels: number[], skillLevels: number[], skillMode: boolean, backgroundAttack: boolean): SimulationSelection {
  const keys = [
    ['sourceCharacterKey', '攻击方角色标识'], ['targetCharacterKey', '目标角色标识'],
    ['basicAttackSkillKey', '普攻技能标识']
  ] as const;
  for (const [field, label] of keys) {
    if (!(skillMode && !backgroundAttack && field === 'basicAttackSkillKey') && !stableKeyPattern.test(draft[field].trim())) {
      throw new Error(`selection.${field}: ${label}需填写合法的稳定标识。`);
    }
  }
  const levels = [
    ['sourceLevel', '攻击方等级', characterLevels], ['targetLevel', '目标等级', characterLevels],
    ['basicAttackLevel', '普攻技能等级', skillLevels]
  ] as const;
  for (const [field, label, options] of levels) {
    const value = draft[field];
    if (!(skillMode && !backgroundAttack && field === 'basicAttackLevel') && (value === undefined || !options.includes(value))) {
      throw new Error(`selection.${field}: ${label}需在当前合法等级范围内明确选择。`);
    }
  }
  if (skillMode && (!draft.plannedSkills.length || draft.plannedSkills.length > 16)) throw new Error('plannedSkills: 请明确选择1～16份已开启、已学的攻击方主动来源');
  return normalizeSimulationSelection({
    sourceCharacterKey: draft.sourceCharacterKey.trim(), sourceLevel: draft.sourceLevel!,
    targetCharacterKey: draft.targetCharacterKey.trim(), targetLevel: draft.targetLevel!,
    basicAttackSkillKey: skillMode && !backgroundAttack ? null : draft.basicAttackSkillKey.trim(), basicAttackLevel: skillMode && !backgroundAttack ? null : draft.basicAttackLevel!,
    plannedSkills: skillMode ? draft.plannedSkills : [],
    sourceEquipmentKeys: normalizeEquipmentKeys(draft.sourceEquipmentKeys, 'selection.sourceEquipmentKeys'),
    targetEquipmentKeys: normalizeEquipmentKeys(draft.targetEquipmentKeys, 'selection.targetEquipmentKeys'),
    sourceBuildConfigurations: draft.sourceBuildConfigurations, targetBuildConfigurations: draft.targetBuildConfigurations,
    sourceSkillSettings: draft.sourceSkillSettings, targetSkillSettings: draft.targetSkillSettings
  });
}

function selectedOrigin(origin: SimulationSkillOrigin, selection: SelectionDraft, side: 'source' | 'target'): boolean {
  if (origin.kind === 'CHARACTER') return origin.characterKey === selection[`${side}CharacterKey`];
  if (origin.kind === 'EQUIPMENT') return selection[`${side}EquipmentKeys`].includes(origin.equipmentKey);
  return selection[`${side}BuildConfigurations`].some(build => build.systemKey === origin.systemKey && build.selections.some(item =>
    item.roleKey === origin.roleKey && item.groupKey === origin.groupKey && item.slotKey === origin.slotKey && item.optionKey === origin.optionKey));
}

function retainSourceSettings(selection: SelectionDraft): SelectionDraft {
  const next = { ...selection };
  for (const side of ['source', 'target'] as const) {
    next[`${side}SkillSettings`] = selection[`${side}SkillSettings`].filter(setting => selectedOrigin(setting.origin, selection, side)).map(setting => {
      if (side !== 'source' || setting.origin.kind !== 'CHARACTER' || setting.skillKey !== selection.basicAttackSkillKey) return setting;
      const copy = { ...setting };
      delete copy.skillLevel;
      return copy;
    });
  }
  return next;
}

function skillDigests(snapshot: SimulationSnapshot): Record<string, string> {
  return Object.fromEntries(snapshot.skillConfigurations.map(configuration => [configuration.skill.skillKey, configuration.baseDigest]).sort(([left], [right]) => left!.localeCompare(right!)));
}

function sameSkillDigests(snapshot: SimulationSnapshot, confirmed: Record<string, string> | null): boolean {
  return confirmed !== null && JSON.stringify(skillDigests(snapshot)) === JSON.stringify(confirmed);
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
    mechanicStateInputs: task.prepared.mechanicStateInputs,
    ignoredCastCosts: task.prepared.ignoredCastCosts,
    compileRequest: task.prepared.compileRequest, coverage: task.prepared.coverage,
    operationOrigins: task.prepared.operationOrigins, equipmentOrigins: task.prepared.equipmentOrigins, skillOrigins: task.prepared.skillOrigins,
    formulaPreflight: task.formulaPreflight ?? null, compileResult: task.result, releaseResult: task.release, error
  };
  if (task.kind === 'skill_action') return { ...common, taskKind: 'skill_action', runRequest: task.runRequest,
    runResult: task.runResult, assessment: task.skillAssessment, cleanup: task.cleanup, failurePhase: task.failurePhase,
    runInputHash: task.skillPrepared?.runInputHash ?? null, attackSpeedAdmission: task.skillPrepared?.attackSpeedAdmission ?? null };
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
  const [formulaPreflight, setFormulaPreflight] = useState<{ compileCount: number; released: boolean; formulaCount: number } | null>(null);
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);
  const [sourcesSnapshot, setSourcesSnapshot] = useState<SimulationSnapshot | null>(null);
  const [confirmedDigests, setConfirmedDigests] = useState<Record<string, string> | null>(null);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [buildsReady, setBuildsReady] = useState({ source: true, target: true });
  const [buildSourceIdentities, setBuildSourceIdentities] = useState<{ source: string[]; target: string[] }>({ source: [], target: [] });
  const [clearedSkillLevels, setClearedSkillLevels] = useState<Record<string, boolean>>({});
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [attributeDrafts, setAttributeDrafts] = useState(emptyAttributeDrafts);
  const [initialHealth, setInitialHealth] = useState(emptyInitialHealth);
  const [mechanicDrafts, setMechanicDrafts] = useState<SimulationMechanicDrafts>({});
  const [auraConfirmed, setAuraConfirmed] = useState<Record<string, boolean>>({});
  const [durationMs, setDurationMs] = useState<number | undefined>(CONTINUOUS_DURATION_INITIAL_MS);
  const [attackSpeedInputMax, setAttackSpeedInputMax] = useState<number | undefined>();
  const [prepared, setPrepared] = useState<PreparedSimulation | null>(null);
  const [archive, setArchive] = useState<SimulationArchive | null>(null);
  const [recordTimeSeries, setRecordTimeSeries] = useState(true);
  const [skillMode, setSkillMode] = useState(false);
  const [backgroundAttack, setBackgroundAttack] = useState(false);
  const [activeSkillKey, setActiveSkillKey] = useState('');
  const nextInstruction = useRef(1);
  const [ignoredCastCosts, setIgnoredCastCosts] = useState<SimulationCastCostRef[]>([]);
  const [skillInputs, setSkillInputs] = useState<Omit<SkillActionInputs, 'durationMs' | 'recordTimeSeries'>>({
    actions: [],
    maxSkillActionRecords: 32, maxSkillUseRecords: 128, maxHealingRecords: 256
  });
  const [resultStale, setResultStale] = useState(false);
  const [phase, setPhase] = useState<TaskPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = useRef(true);
  const formulaProofIdentityRef = useRef<string | null>(null);
  const taskRef = useRef<Task | null>(null);
  const token = adminToken.trim();
  const busy = phase !== 'idle';
  const candidateUnconfirmed = snapshot !== null && (confirmationRequired || !sameSkillDigests(snapshot, confirmedDigests));
  const { characters, skills, activeSkills, equipment, levels, imageLoader } = useSimulationSelectionOptions(apiBaseUrl, selectedGameId, token, selection.sourceCharacterKey);
  const selectedSkill = skills.items.find(row => row.key === selection.basicAttackSkillKey);
  const skillLevels = useMemo(() => selectedSkill?.kind === 'skill'
    ? Array.from({ length: selectedSkill.maxLevel }, (_, index) => index + 1) : [], [selectedSkill]);
  const levelsSelected = levels.items.includes(selection.sourceLevel!) && levels.items.includes(selection.targetLevel!)
    && (!skillMode || backgroundAttack ? skillLevels.includes(selection.basicAttackLevel!) : true)
    && (!skillMode || selection.plannedSkills.length > 0);
  const objectsSelected = characters.items.some(row => row.key === selection.sourceCharacterKey)
    && characters.items.some(row => row.key === selection.targetCharacterKey)
    && (!skillMode || selection.plannedSkills.every(plan => activeSkills.items.some(row => row.key === plan.skillKey)))
    && (skillMode && !backgroundAttack || skills.items.some(row => row.key === selection.basicAttackSkillKey))
    && [...selection.sourceEquipmentKeys, ...selection.targetEquipmentKeys].every(key => equipment.items.some(row => row.key === key));
  const requirements = inspection?.requirements ?? [];
  const missing = requirements.filter(row => row.storedValue === undefined);
  const unfilled = missing.filter(row => attributeDrafts[row.side][row.attribute.attributeKey] === undefined);
  const coverage = prepared?.coverage ?? inspection?.coverage ?? [];
  const healthUnfilled = initialHealth.source === undefined || initialHealth.target === undefined;
  const mechanicRequirements = inspection?.mechanicRequirements ?? [];
  const mechanicIssues = mechanicDraftIssues(mechanicRequirements, mechanicDrafts);
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
  const rangeRequirements = useMemo(() => {
    if (!snapshot) return [];
    try { return equipmentRangeRequirements(snapshot); } catch { return []; }
  }, [snapshot]);

  const clearOwnedFormulaProof = (identity: string | null | undefined) => {
    if (!identity) return;
    clearFormulaProofScope(identity);
    if (formulaProofIdentityRef.current === identity) formulaProofIdentityRef.current = null;
  };
  const trackFormulaProof = (task: Task, next: SimulationSnapshot) => {
    task.formulaProofIdentity = snapshotFormulaProofIdentity(next);
    formulaProofIdentityRef.current = task.formulaProofIdentity;
  };

  useEffect(() => {
    active.current = true;
    setSelection(emptySelection());
    setSkillInputs(current => ({ ...current, actions: [] }));
    setActiveSkillKey('');
    setIgnoredCastCosts([]);
    setSnapshot(null);
    setFormulaPreflight(null);
    setSourcesSnapshot(null);
    setConfirmedDigests(null);
    setConfirmationRequired(false);
    setBuildsReady({ source: true, target: true });
    setBuildSourceIdentities({ source: [], target: [] });
    setClearedSkillLevels({});
    setInspection(null);
    setAttributeDrafts(emptyAttributeDrafts());
    setInitialHealth(emptyInitialHealth());
    setMechanicDrafts({});
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
        clearOwnedFormulaProof(task.formulaProofIdentity);
      }
      clearOwnedFormulaProof(formulaProofIdentityRef.current);
      onDirtyChange(false);
    };
  }, [apiBaseUrl, selectedGameId, token, onDirtyChange]);

  const isCurrent = (task: Task) => active.current && taskRef.current === task && !task.cancelled;

  const beginTask = (nextPhase: Exclude<TaskPhase, 'idle'>, kind: TaskKind = nextPhase === 'reading' ? 'snapshot' : 'compile'): Task | null => {
    if (taskRef.current) return null;
    const task: Task = {
      kind, phase: nextPhase, failurePhase: null, cancelled: false, controller: new AbortController(), client: null,
      snapshot: null, prepared: null, result: null, release: null, sessionId: null,
      runRequest: null, runResult: null, assessment: null, continuousPrepared: null, continuousAssessment: null,
      skillPrepared: null, skillAssessment: null, cleanup: 'not_needed'
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
    clearOwnedFormulaProof(task.formulaProofIdentity ?? formulaProofIdentityRef.current);
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
    setArchive(current => preserveSingleResult || current?.taskKind === 'continuous_attack' || current?.taskKind === 'skill_action' ? current : null);
    setResultStale(true);
  };

  const clearArtifacts = () => {
    clearOwnedFormulaProof(formulaProofIdentityRef.current);
    setFormulaPreflight(null);
    setAuraConfirmed({});
    setSnapshot(null);
    setInspection(null);
    setPrepared(null);
    invalidateRunResult(true);
    setError(null);
    setNotice(null);
  };

  const patchSelection = <K extends keyof SelectionDraft>(key: K, value: SelectionDraft[K]) => {
    if (taskRef.current) return;
    if (key === 'sourceCharacterKey') { setSkillInputs(current => ({ ...current, actions: [] })); setActiveSkillKey(''); }
    setSelection(current => retainSourceSettings({ ...current, [key]: value,
      ...(key === 'sourceCharacterKey' ? { basicAttackSkillKey: '', basicAttackLevel: undefined, plannedSkills: [] }
        : key === 'basicAttackSkillKey' ? { basicAttackLevel: undefined } : {}) }));
    clearArtifacts();
  };

  const patchEquipment = (side: 'source' | 'target', values: string[]) => {
    if (taskRef.current) return;
    try {
      const keys = normalizeEquipmentKeys(values, `selection.${side}EquipmentKeys`);
      setSelection(current => retainSourceSettings({ ...current, [`${side}EquipmentKeys`]: keys }));
      clearArtifacts();
    } catch (cause) { setError(taskError(cause)); }
  };

  const editBuilds = (side: 'source' | 'target', systemKeys: string[]) => {
    if (taskRef.current) return;
    setBuildsReady(current => ({ ...current, [side]: false }));
    setSelection(current => retainSourceSettings({ ...current,
      [`${side}BuildConfigurations`]: current[`${side}BuildConfigurations`].filter(build => systemKeys.includes(build.systemKey)) }));
    clearArtifacts();
  };

  const confirmBuilds = (side: 'source' | 'target', configurations: BuildConfiguration[], definitions: BuildDefinition[]) => {
    if (taskRef.current) return;
    const identities = configurations.flatMap(configuration => configuration.selections.flatMap(selection =>
      definitions.find(definition => definition.system.systemKey === configuration.systemKey)!.skillRelations
        .filter(relation => relation.optionKey === selection.optionKey && relation.activationRank <= selection.rank)
        .map(relation => simulationSkillSourceIdentity({ kind: 'BUILD_OPTION', systemKey: configuration.systemKey, roleKey: selection.roleKey,
          groupKey: selection.groupKey, slotKey: selection.slotKey, optionKey: selection.optionKey }, relation.skillKey))));
    setBuildSourceIdentities(current => ({ ...current, [side]: identities }));
    setSelection(current => retainSourceSettings({ ...current, [`${side}BuildConfigurations`]: configurations,
      [`${side}SkillSettings`]: current[`${side}SkillSettings`].filter(setting => setting.origin.kind !== 'BUILD_OPTION'
        || identities.includes(simulationSkillSourceIdentity(setting.origin, setting.skillKey))) }));
    setBuildsReady(current => ({ ...current, [side]: true }));
    clearArtifacts();
  };

  const patchSkillSource = (side: 'source' | 'target', source: SimulationSkillSource, patch: { enabled?: boolean; skillLevel?: number }) => {
    if (taskRef.current || source.skillStatus === 'DISABLED') return;
    const identity = simulationSkillSourceIdentity(source.origin, source.skillKey);
    if (side === 'source') setSkillInputs(current => ({ ...current, actions: current.actions.flatMap(action => {
      if (simulationSkillSourceIdentity(action.origin, action.skillKey) !== identity) return [action];
      if (patch.enabled === false || patch.skillLevel === 0 || 'skillLevel' in patch && patch.skillLevel === undefined) return [];
      return [{ ...action, skillLevel: patch.skillLevel ?? action.skillLevel }];
    }) }));
    setSelection(current => {
      const settings = current[`${side}SkillSettings`];
      const existing = settings.find(setting => simulationSkillSourceIdentity(setting.origin, setting.skillKey) === identity);
      const setting: SimulationSkillSetting = { origin: source.origin, skillKey: source.skillKey, enabled: snapshot ? source.enabled : true, ...existing, ...patch };
      if (setting.skillLevel === undefined) delete setting.skillLevel;
      const plannedSkills = current.plannedSkills.flatMap(plan => {
        if (side !== 'source' || simulationSkillSourceIdentity(plan.origin, plan.skillKey) !== identity) return [plan];
        if (!setting.enabled || setting.skillLevel === 0 || 'skillLevel' in patch && patch.skillLevel === undefined) return [];
        return [{ ...plan, skillLevel: setting.skillLevel ?? plan.skillLevel }];
      });
      return retainSourceSettings({ ...current, plannedSkills, [`${side}SkillSettings`]: [...settings.filter(item => simulationSkillSourceIdentity(item.origin, item.skillKey) !== identity), setting] });
    });
    if ('skillLevel' in patch) setClearedSkillLevels(current => ({ ...current, [`${side}:${identity}`]: patch.skillLevel === undefined }));
    clearArtifacts();
  };

  const acceptSnapshot = async (next: SimulationSnapshot, task: NonNullable<typeof taskRef.current>) => {
    trackFormulaProof(task, next);
    task.client = new GenericEngineClient();
    const evidence = await preflightSkillFormulas(next, task.client, () => isCurrent(task));
    if (!isCurrent(task)) return false;
    task.formulaPreflight = evidence;
    setFormulaPreflight(evidence);
    setSnapshot(next);
    setSourcesSnapshot(next);
    setBuildSourceIdentities({
      source: next.source.skillSources.filter(source => source.origin.kind === 'BUILD_OPTION').map(source => simulationSkillSourceIdentity(source.origin, source.skillKey)),
      target: next.target.skillSources.filter(source => source.origin.kind === 'BUILD_OPTION').map(source => simulationSkillSourceIdentity(source.origin, source.skillKey))
    });
    setInspection(null);
    try {
      setInspection(inspectSimulationSnapshot(next, ignoredCastCosts));
      return true;
    } catch (cause) {
      clearOwnedFormulaProof(task.formulaProofIdentity);
      setError(`快照已读取，但编译准入检查未通过：${taskError(cause)}。可在默认来源表关闭非必需来源后重新读取。`);
      return false;
    }
  };

  const confirmLatestConfiguration = () => {
    if (taskRef.current || !snapshot) return;
    setConfirmedDigests(skillDigests(snapshot));
    setConfirmationRequired(false);
    setPrepared(null);
    invalidateRunResult(true);
    setNotice('已明确确认本次完整技能配置摘要；执行前仍重新读取并逐项核对。');
  };

  const readSnapshot = async () => {
    if (taskRef.current || !selectedGameId || !token || !objectsSelected || !buildsReady.source || !buildsReady.target) return;
    let requested: SimulationSelection;
    try { requested = selectionFromDraft(selection, levels.items, skillLevels, skillMode, backgroundAttack); }
    catch (cause) { setError(taskError(cause)); return; }
    const task = beginTask('reading');
    if (!task) return;
    setPrepared(null);
    invalidateRunResult(true);
    try {
      let result = await getSimulationSnapshot(apiBaseUrl, selectedGameId, requested, token, task.controller.signal);
      if (!isCurrent(task)) return;
      const defaults = fillSimulationSkillLevelDefaults(result.data.selection, result.data, clearedSkillLevels);
      if (defaults.changed) {
        clearOwnedFormulaProof(formulaProofIdentityRef.current);
        setSnapshot(null);
        setInspection(null);
        setSourcesSnapshot(result.data);
        setSelection(current => ({ ...defaults.selection, basicAttackSkillKey: current.basicAttackSkillKey, basicAttackLevel: current.basicAttackLevel }));
        result = await getSimulationSnapshot(apiBaseUrl, selectedGameId, defaults.selection, token, task.controller.signal);
        if (!isCurrent(task)) return;
      }
      task.snapshot = result.data;
      const admitted = await acceptSnapshot(result.data, task);
      setNotice(admitted ? '场景快照已读取，未设置的角色来源技能默认最高等级；请核对技能配置及必要的场景补充值。'
        : '原始默认来源与完整关系已保留；准入失败不妨碍关闭来源、供等级或修改构筑。');
    } catch (cause) {
      if (isCurrent(task)) {
        clearOwnedFormulaProof(task.formulaProofIdentity ?? formulaProofIdentityRef.current);
        setError(taskError(cause));
      }
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

  const updateMechanic = (identity: string, value: number | undefined) => {
    if (taskRef.current) return;
    setMechanicDrafts(current => ({ ...current, [identity]: value }));
    setPrepared(null);
    invalidateRunResult(true);
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

  const selectActiveSkill = (skillKey: string, replaceInstructionKey?: string) => {
    if (taskRef.current) return;
    const option = activeSkills.items.find(row => row.key === skillKey);
    if (option?.kind !== 'skill') return;
    const origin = { kind: 'CHARACTER' as const, characterKey: selection.sourceCharacterKey };
    const identity = simulationSkillSourceIdentity(origin, skillKey);
    const setting = selection.sourceSkillSettings.find(row => simulationSkillSourceIdentity(row.origin, row.skillKey) === identity);
    if (setting?.enabled === false || setting?.skillLevel === 0 || clearedSkillLevels[`source:${identity}`]) {
      setError('来源关闭、0级未学或等级草稿已清空，不能列入主动计划；请先明确修改来源。');
      return;
    }
    const skillLevel = setting?.skillLevel ?? option.maxLevel;
    if (!replaceInstructionKey && skillInputs.actions.length >= 64) { setError('本次最多64条明确技能指令'); return; }
    const previous = skillInputs.actions.find(row => row.instructionKey === replaceInstructionKey);
    const action: SkillActionInput = { origin, skillKey, skillLevel, instructionKey: previous?.instructionKey ?? `skill_instruction_${nextInstruction.current++}`,
      atMs: previous?.atMs ?? 0, sortOrder: previous?.sortOrder ?? 0, targetSide: previous?.targetSide ?? 'target',
      phaseKind: 'INITIAL', parentInstructionKey: null, hitPreset: null };
    const actions = previous ? skillInputs.actions.map(row => row.instructionKey === previous.instructionKey ? action : row) : [...skillInputs.actions, action];
    let plans: SimulationSelection['plannedSkills'];
    try { plans = plannedSkillsFromActions(actions); } catch (cause) { setError(taskError(cause)); return; }
    setSkillInputs(current => ({ ...current, actions }));
    setActiveSkillKey(skillKey);
    setSelection(current => ({ ...current, plannedSkills: plans,
      sourceSkillSettings: [...current.sourceSkillSettings.filter(row => simulationSkillSourceIdentity(row.origin, row.skillKey) !== identity),
        { origin, skillKey, enabled: true, skillLevel }] }));
    if (JSON.stringify(plans) !== JSON.stringify(selection.plannedSkills)) { setIgnoredCastCosts([]); clearArtifacts(); }
    else { invalidateRunResult(true); setError(null); setNotice(null); }
  };

  const editSkillAction = (instructionKey: string, patch: Partial<SkillActionInput>) => {
    if (taskRef.current) return;
    const actions = skillInputs.actions.map(row => row.instructionKey === instructionKey ? { ...row, ...patch } : row);
    let plans: SimulationSelection['plannedSkills'];
    try { plans = plannedSkillsFromActions(actions); } catch (cause) { setError(taskError(cause)); return; }
    setSkillInputs(current => ({ ...current, actions }));
    setSelection(current => ({ ...current, plannedSkills: plans }));
    if (JSON.stringify(plans) !== JSON.stringify(selection.plannedSkills)) { setIgnoredCastCosts([]); clearArtifacts(); }
    else { invalidateRunResult(true); setError(null); setNotice(null); }
  };

  const removeSkillAction = (instructionKey: string) => {
    if (taskRef.current) return;
    const actions = removeSkillActionDraft(skillInputs.actions, instructionKey);
    const plans = plannedSkillsFromActions(actions);
    setSkillInputs(current => ({ ...current, actions }));
    setSelection(current => ({ ...current, plannedSkills: plans }));
    if (JSON.stringify(plans) !== JSON.stringify(selection.plannedSkills)) { setIgnoredCastCosts([]); clearArtifacts(); }
    else { invalidateRunResult(true); setError(null); setNotice(null); }
  };

  const editSkillInput = <Key extends keyof typeof skillInputs>(key: Key, value: typeof skillInputs[Key]) => {
    if (taskRef.current) return;
    setSkillInputs(current => ({ ...current, [key]: value }));
    invalidateRunResult(true); setError(null); setNotice(null);
  };

  const execute = async (kind: 'compile' | 'single_attack' | 'continuous_attack' | 'skill_action') => {
    if (taskRef.current || !snapshot || !inspection || candidateUnconfirmed || !selectedGameId) return;
    if (mechanicIssues.length) { setError(mechanicIssues.join('；')); return; }
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
    const task = beginTask('reading', kind);
    if (!task) return;
    const continuousInputs = { durationMs: durationMs as number, attackSpeedInputMax, recordTimeSeries };
    setPrepared(null);
    invalidateRunResult();
    let failure: string | null = null;
    try {
      const latest = await getSimulationSnapshot(apiBaseUrl, selectedGameId, snapshot.selection, token, task.controller.signal);
      if (!isCurrent(task)) return;
      if (!sameSkillDigests(latest.data, confirmedDigests) || latest.data.snapshotDigest !== snapshot.snapshotDigest) {
        await acceptSnapshot(latest.data, task);
        setConfirmationRequired(true);
        setNotice('技能作者配置、来源或构筑已变化，草稿已保留。最新配置已完成共同公式预检，请核对并明确确认后重新执行本次场景。');
        finishTask(task);
        return;
      }
      task.snapshot = structuredClone(latest.data);
      trackFormulaProof(task, task.snapshot);
      task.client = new GenericEngineClient();
      const preflight = await preflightSkillFormulas(task.snapshot, task.client, () => isCurrent(task));
      if (!isCurrent(task)) return;
      task.formulaPreflight = preflight;
      setFormulaPreflight(preflight);
      task.phase = 'preparing';
      setPhase('preparing');
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
      task.prepared = await prepareSimulation(task.snapshot, inputs, { source: initialHealth.source, target: initialHealth.target }, assumptions,
        mechanicInputsFromDrafts(mechanicRequirements, mechanicDrafts), ignoredCastCosts);
      if (!isCurrent(task)) return;
      if (kind === 'continuous_attack') {
        task.continuousPrepared = await continuousAttackRequest(task.prepared, task.snapshot, continuousInputs);
        if (!isCurrent(task)) return;
      }
      if (kind === 'skill_action') {
        task.skillPrepared = await skillActionRequest(task.prepared, task.snapshot,
          { ...skillInputs, durationMs: durationMs as number, recordTimeSeries, attackSpeedInputMax });
        if (!isCurrent(task)) return;
      }
      setPrepared(task.prepared);
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
      if (!failure) {
        validateConsumedFormulaValues(task.prepared.approvedFormulaValues, task.prepared.compileRequest.formulas ?? [], task.result.metadata?.approvedStaticValues ?? {});
        validateApprovedFormulaValues(task.prepared.compileRequest.formulas ?? [], task.result.metadata?.approvedStaticValues ?? {});
      }
      if (failure) task.failurePhase = 'compiling';
      if (!failure && kind !== 'compile') {
        task.runRequest = kind === 'single_attack' ? singleAttackRequest(task.prepared.compileRequest, task.sessionId!)
          : kind === 'skill_action' ? { ...task.skillPrepared!.runRequest, sessionId: task.sessionId! }
          : { ...task.continuousPrepared!.runRequest, sessionId: task.sessionId! };
        task.runRequest.runtimeOptions = { ...task.runRequest.runtimeOptions, equipmentAssumptions: task.prepared.equipmentAssumptions,
          skillOrigins: task.prepared.skillOrigins, mechanicStateInputs: task.prepared.mechanicStateInputs };
        task.phase = 'running';
        setPhase('running');
        task.runResult = await task.client.run(task.runRequest);
        if (!isCurrent(task)) return;
        if (kind === 'single_attack') {
          task.assessment = assessSingleAttackResult(task.prepared.compileRequest, task.runRequest, task.runResult);
          if (!task.assessment.complete) failure = `单次执行未完整验证：${task.assessment.issues.join('；')}`;
        } else if (kind === 'skill_action') {
          task.skillAssessment = assessSkillActionResult(task.prepared.compileRequest, task.runRequest, task.runResult, task.prepared.operationOrigins);
          if (!task.skillAssessment.complete) failure = `指定技能结果未完整核对：${task.skillAssessment.issues.join('；') || '公共执行明确不完整'}`;
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
          && task.cleanup === 'released' && (kind === 'compile' || task.assessment?.complete === true || task.continuousAssessment?.complete === true || task.skillAssessment?.complete === true);
        if (!passed) clearOwnedFormulaProof(task.formulaProofIdentity ?? formulaProofIdentityRef.current);
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
          : kind === 'skill_action' ? '指定技能计划观察完成，会话已释放；各段与控制只以真实返回事实为准。'
          : '仅编译验证通过，不代表单次/连续计算通过。' : null);
        finishTask(task);
      }
    }
  };

  // Space 会过滤空子节点；固定区域标识，避免提示增减时重挂载输入框。
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {formulaPreflight ? <Typography.Text type="secondary">共同公式原生预检：编译{formulaPreflight.compileCount}次，完整程序{formulaPreflight.formulaCount}份，预检会话已释放。最终场景编译仍独立校验。</Typography.Text> : null}
      {!selectedGameId ? <Alert key="missing-game" type="warning" content="请先在顶部选择游戏。" /> : null}
      {selectedGameId && !token ? <Alert key="missing-token" type="warning" content="请先在顶部配置 Admin Token。" /> : null}
      {notice ? <Alert key="task-notice" type={archive?.outcome === 'passed' ? 'success' : 'info'} content={notice} /> : null}
      {busy ? <Alert key="task-progress" type="info" content={phase === 'running' && taskRef.current?.kind === 'continuous_attack'
        ? '正在执行连续普攻' : phaseLabels[phase as Exclude<TaskPhase, 'idle'>]} /> : null}
      {characters.error ? <Alert key="character-options-error" type="error" content={`角色列表读取失败：${characters.error}`}
        action={<Button disabled={busy} onClick={characters.retry}>重试角色列表</Button>} /> : null}
      {skills.error ? <Alert key="skill-options-error" type="error" content={`普攻列表读取失败：${skills.error}`}
        action={<Button disabled={busy} onClick={skills.retry}>重试普攻列表</Button>} /> : null}
      {skillMode && activeSkills.error ? <Alert key="active-options-error" type="error" content={`角色技能候选读取失败：${activeSkills.error}`}
        action={<Button disabled={busy} onClick={activeSkills.retry}>重试角色技能候选</Button>} /> : null}
      {levels.error ? <Alert key="level-options-error" type="error" content={`角色等级范围读取失败：${levels.error}`}
        action={<Button disabled={busy} onClick={levels.retry}>重试等级范围</Button>} /> : null}
      {equipment.error ? <Alert key="equipment-options-error" type="error" content={`装备列表读取失败：${equipment.error}`}
        action={<Button disabled={busy} onClick={equipment.retry}>重试装备列表</Button>} /> : null}
      {healthIssues.length ? <Alert key="health-limit-error" type="error" content={healthIssues.join('\n')} /> : null}
      {archive && resultStale && archive.taskKind !== 'continuous_attack' ? <Alert key="previous-result-stale" type="warning"
        content="输入已改变；上一份冻结结果已过期，不代表当前场景。" /> : null}

      <Form key="scene-selection" layout="vertical" aria-label="普攻场景选择">
        <Form.Item label="执行范围">
          <Checkbox aria-label="指定技能行动计划" checked={skillMode} disabled={busy} onChange={checked => {
            setSkillMode(checked); setIgnoredCastCosts([]); clearArtifacts();
          }}>指定技能行动计划（1～64条明确指令；关闭后保留原普攻模式）</Checkbox>
          {skillMode ? <Checkbox aria-label="开启背景普攻" checked={backgroundAttack} disabled={busy} onChange={checked => {
            setBackgroundAttack(checked); clearArtifacts();
          }}>明确开启背景持续普攻（共用原生时钟和唯一下一刀）</Checkbox> : null}
        </Form.Item>
        <div className="simulation-combatants-grid">
          <section className="simulation-combatant-config" aria-labelledby="simulation-source-config-title">
            <Typography.Title heading={5} id="simulation-source-config-title" style={{ margin: '0 0 16px' }}>攻击方配置</Typography.Title>
            {skillMode ? <>
              <Form.Item label="攻击方主动技能候选" required>
                <SimulationEntitySelect label="攻击方主动技能候选" value={activeSkillKey}
                  options={activeSkills.items} loading={activeSkills.loading} disabled={busy || activeSkills.loading || Boolean(activeSkills.error)}
                  loadImage={imageLoader} onChange={setActiveSkillKey} placeholder="选择攻击方真实绑定技能，完整主动程序另行准入" />
                <Button disabled={busy || !activeSkillKey || skillInputs.actions.length >= 64} onClick={() => selectActiveSkill(activeSkillKey)}>添加首次尝试</Button>
              </Form.Item>
              <Typography.Paragraph type="secondary">不同来源{selection.plannedSkills.length}／16，明确指令{skillInputs.actions.length}／64。首次选择使用真实最高等级；来源表中的低等级、0、关闭或清空不会自动覆盖。阶段按真实作者入口选择；释放、重施和取消必须明确关联原首次，不补控制时刻。</Typography.Paragraph>
            </> : null}
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
                loading={skills.loading} disabled={busy || skillMode && !backgroundAttack || !characters.items.some(row => row.key === selection.sourceCharacterKey)
                  || skills.loading || Boolean(skills.error) || !selectedGameId || !token}
                loadImage={imageLoader} onChange={value => patchSelection('basicAttackSkillKey', value)}
                placeholder={!selection.sourceCharacterKey ? '先选择攻击方角色' : skills.loading ? '正在读取挂载的普攻…'
                  : skills.error ? '普攻读取失败，请重试'
                  : skills.items.length ? '搜索普攻名称或标识' : '此角色没有启用的普攻技能'} />
            </Form.Item>
            <Form.Item label="普攻技能等级" required>
              <Select aria-label="普攻技能等级" className="simulation-level-select" value={selection.basicAttackLevel} allowClear
                loading={skills.loading} disabled={busy || skillMode && !backgroundAttack || skills.loading || !skillLevels.length || Boolean(skills.error)}
                options={skillLevels.map(value => ({ value, label: String(value) }))}
                placeholder={!selectedSkill ? '先选择普攻技能' : '请选择技能等级'}
                onChange={(value: number | undefined) => patchSelection('basicAttackLevel', value)} />
            </Form.Item>
            <Form.Item label="攻击方装备（最多6件）">
              <SimulationEquipmentSelect label="攻击方装备" value={selection.sourceEquipmentKeys} options={equipment.items} loading={equipment.loading}
                disabled={busy || !selectedGameId || !token || equipment.loading || Boolean(equipment.error)}
                loadImage={imageLoader} onChange={values => patchEquipment('source', values)} />
            </Form.Item>
            <SimulationBuildConfigurationEditor apiBaseUrl={apiBaseUrl} gameId={selectedGameId} token={token} side="source" disabled={busy}
              selectedBuilds={sourcesSnapshot?.source.selectedBuilds}
              onEdit={keys => editBuilds('source', keys)} onConfirm={(configurations, definitions) => confirmBuilds('source', configurations, definitions)} />
            <SimulationSkillSources side="source" snapshot={sourcesSnapshot}
              sources={sourcesSnapshot?.source.skillSources.filter(source => selectedOrigin(source.origin, selection, 'source')
                && (source.origin.kind !== 'BUILD_OPTION' || buildSourceIdentities.source.includes(simulationSkillSourceIdentity(source.origin, source.skillKey)))) ?? []}
              settings={selection.sourceSkillSettings} basicAttackSkillKey={skillMode && !backgroundAttack ? '' : selection.basicAttackSkillKey} basicAttackLevel={skillMode && !backgroundAttack ? undefined : selection.basicAttackLevel}
              stale={!snapshot} clearedLevels={clearedSkillLevels} disabled={busy} onChange={(source, patch) => patchSkillSource('source', source, patch)} />
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
              <SimulationEquipmentSelect label="目标装备" value={selection.targetEquipmentKeys} options={equipment.items} loading={equipment.loading}
                disabled={busy || !selectedGameId || !token || equipment.loading || Boolean(equipment.error)}
                loadImage={imageLoader} onChange={values => patchEquipment('target', values)} />
            </Form.Item>
            <SimulationBuildConfigurationEditor apiBaseUrl={apiBaseUrl} gameId={selectedGameId} token={token} side="target" disabled={busy}
              selectedBuilds={sourcesSnapshot?.target.selectedBuilds}
              onEdit={keys => editBuilds('target', keys)} onConfirm={(configurations, definitions) => confirmBuilds('target', configurations, definitions)} />
            <SimulationSkillSources side="target" snapshot={sourcesSnapshot}
              sources={sourcesSnapshot?.target.skillSources.filter(source => selectedOrigin(source.origin, selection, 'target')
                && (source.origin.kind !== 'BUILD_OPTION' || buildSourceIdentities.target.includes(simulationSkillSourceIdentity(source.origin, source.skillKey)))) ?? []}
              settings={selection.targetSkillSettings} basicAttackSkillKey={skillMode && !backgroundAttack ? '' : selection.basicAttackSkillKey} basicAttackLevel={skillMode && !backgroundAttack ? undefined : selection.basicAttackLevel}
              stale={!snapshot} clearedLevels={clearedSkillLevels} disabled={busy} onChange={(source, patch) => patchSkillSource('target', source, patch)} />
          </section>
        </div>
        <Typography.Paragraph type="secondary">
          装备固定属性按真实目录装配，不按装备编号限制。被动按本场可触发的完整分支执行，未触发分支保留配置与审计说明；可触发但未接入的节点仍明确报错。鬼索、荆棘、日炎部分时序使用项目暂定配置，后续可校准。
          同一装备可由双方各选一次。来源开关、技能等级和构筑均按侧别独立；改变选择保留当前生命及属性草稿，必须重新读取快照。
        </Typography.Paragraph>
        <Space wrap>
          <Button type="primary" disabled={busy || !selectedGameId || !token || !objectsSelected || !levelsSelected || !buildsReady.source || !buildsReady.target} onClick={() => void readSnapshot()}>
            读取场景快照
          </Button>
          {busy ? <Button status="danger" onClick={cancelTask}>取消当前请求</Button> : null}
        </Space>
      </Form>

      {skillMode ? <section key="skill-action-plan" aria-label="指定技能计划">
        <Typography.Title heading={5}>指定技能计划：1～64条明确技能指令</Typography.Title>
        <Typography.Paragraph>背景普攻{backgroundAttack ? '明确开启' : '关闭'}，指定技能不自动延期、重试或补放。按时刻、同刻顺序、稳定指令标识执行；重复同技能不重复挂载。释放、重施或取消必须明确填写时刻并关联排序更早的同来源、同目标、同技能和同等级首次，不默认满蓄力。阶段来自真实作者控制；变更阶段集合须重新读取确认，编辑时刻、顺序仅令结果过期。</Typography.Paragraph>
        <Table<SkillActionInput> data={skillInputs.actions} rowKey="instructionKey" pagination={false} scroll={{ x: 1200 }} columns={[
          { title: '稳定指令标识', dataIndex: 'instructionKey' },
          { title: '技能／阶段／等级', render: (_, row) => <Space direction="vertical">
            <Select aria-label={`计划技能 ${row.instructionKey}`} value={row.skillKey} disabled={busy}
              options={activeSkills.items.map(option => ({ value: option.key, label: `${option.name}（${option.key}）` }))}
              onChange={value => selectActiveSkill(value, row.instructionKey)} />
            <Select aria-label={`技能阶段 ${row.instructionKey}`} value={row.phaseKind} disabled={busy}
              options={skillActionPhases(sourcesSnapshot?.skillConfigurations.find(configuration => configuration.skill.skillKey === row.skillKey))
                .map(value => ({ value, label: { INITIAL: '首次使用', CHARGE_RELEASE: '蓄力释放', RECAST: '重施', CANCEL: '主动取消' }[value] }))}
              onChange={value => editSkillAction(row.instructionKey, { phaseKind: value, parentInstructionKey: null, hitPreset: null,
                ...(row.phaseKind === 'INITIAL' && value !== 'INITIAL' ? { atMs: NaN } : {}) })} />
            <Typography.Text>等级{row.skillLevel}</Typography.Text>
          </Space> },
          { title: '关联原首次指令', render: (_, row) => row.phaseKind === 'INITIAL' ? <Typography.Text>不关联</Typography.Text>
            : <Select aria-label={`关联首次指令 ${row.instructionKey}`} value={row.parentInstructionKey ?? undefined} disabled={busy} allowClear
              placeholder="明确选择排序更早的原首次" onChange={value => editSkillAction(row.instructionKey, { parentInstructionKey: value ?? null })}
              options={skillActionParentCandidates(skillInputs.actions, row).map(parent => ({ value: parent.instructionKey,
                label: `${parent.instructionKey} · ${parent.atMs}毫秒 · 顺序${parent.sortOrder}` }))} /> },
          { title: '尝试时刻（毫秒）', render: (_, row) => <InputNumber aria-label={`技能尝试时刻 ${row.instructionKey}`}
            value={Number.isFinite(row.atMs) ? row.atMs : undefined} min={0} precision={0} disabled={busy}
            onChange={value => editSkillAction(row.instructionKey, { atMs: value ?? NaN })} /> },
          { title: '同刻顺序', render: (_, row) => <InputNumber aria-label={`技能同刻顺序 ${row.instructionKey}`}
            value={Number.isFinite(row.sortOrder) ? row.sortOrder : undefined} min={0} precision={0} disabled={busy}
            onChange={value => editSkillAction(row.instructionKey, { sortOrder: value ?? NaN })} /> },
          { title: '目标', render: (_, row) => <Select aria-label={`技能目标 ${row.instructionKey}`} value={row.targetSide} disabled={busy}
            onChange={value => editSkillAction(row.instructionKey, { targetSide: value })}
            options={[{ label: '唯一目标B', value: 'target' }, { label: '攻击方A自身', value: 'source' }]} /> },
          { title: '明确命中预设', render: (_, row) => <Select aria-label={`技能命中预设 ${row.instructionKey}`} value={row.hitPreset ?? undefined}
            allowClear disabled={busy || row.phaseKind !== 'INITIAL'} placeholder={row.phaseKind === 'INITIAL' ? '明确填写' : '继承原首次预设'}
            onChange={value => editSkillAction(row.instructionKey, { hitPreset: value ?? null })}
            options={[{ label: '释放后对唯一目标尝试命中', value: 'TARGET_HIT' }, { label: '本次明确未命中', value: 'MISS' }]} /> },
          { title: '编辑', render: (_, row) => <Button aria-label={`删除指令 ${row.instructionKey}`} disabled={busy} onClick={() => removeSkillAction(row.instructionKey)}>删除</Button> }
        ]} />
        <Typography.Text type="secondary">自身治疗保持空命中预设、目标为A；伤害首次必须明确选择目标B与命中预设。控制不重新填写命中，继承原使用；同刻到期先于控制。有限多段及引导由原生求绝对段时点，不模拟弹道。</Typography.Text>
        <Typography.Paragraph type="secondary">主动冷却只读取作者表达式，原值必须为正；原生正数四舍五入且最小1毫秒。装备与固有急速沿实际属性来源合并，不在页面重复折扣；普攻只沿攻速冷却。</Typography.Paragraph>
        <Form layout="vertical">
          {(['maxSkillActionRecords', 'maxSkillUseRecords', 'maxHealingRecords'] as const).map(field => <Form.Item key={field}
            label={{ maxSkillActionRecords: '技能行动记录上限', maxSkillUseRecords: '技能使用记录上限', maxHealingRecords: '治疗记录上限' }[field]} required>
            <InputNumber aria-label={field} value={Number.isFinite(skillInputs[field]) ? skillInputs[field] : undefined} min={0}
              max={field === 'maxSkillActionRecords' ? 4096 : 10000} precision={0} disabled={busy}
              onChange={value => editSkillInput(field, value ?? NaN)} />
          </Form.Item>)}
        </Form>
        {snapshot ? simulationCastCostCandidates(snapshot).map(cost => <Checkbox key={JSON.stringify(cost)}
          aria-label={`声明施法成本 ${cost.effectKey}.${cost.resultKey}`} disabled={busy}
          checked={ignoredCastCosts.some(row => JSON.stringify(row) === JSON.stringify(cost))} onChange={checked => {
            const next = ignoredCastCosts.filter(row => JSON.stringify(row) !== JSON.stringify(cost));
            if (checked) next.push(cost);
            setIgnoredCastCosts(next); setPrepared(null); invalidateRunResult(true);
            try { setInspection(inspectSimulationSnapshot(snapshot, next)); setError(null); }
            catch (cause) { setInspection(null); setError(taskError(cause)); }
          }}>明确声明{cost.effectKey}.{cost.resultKey}（挂接{cost.bindingKey}）是施法成本，本期忽略门槛、扣除与退款；其它消费不忽略。</Checkbox>) : null}
        <Typography.Paragraph type="secondary">记录上限可显式为0；各类预算独立，不改变完整累计或结算。</Typography.Paragraph>
      </section> : null}

      {error ? <Alert key="task-error" type="error" content={<span style={{ whiteSpace: 'pre-wrap' }}>{error}</span>} /> : null}

      {snapshot ? <section key="configuration-confirmation" aria-label="技能配置确认">
        <Typography.Title heading={5}>技能配置确认</Typography.Title>
        <Typography.Paragraph>逐项保存完整作者配置摘要；同一入口下动作或数值变化也须重新确认，不因场景快照更新而自动执行。</Typography.Paragraph>
        {snapshot.skillConfigurations.map(configuration => <Typography.Paragraph key={configuration.skill.skillKey} style={{ overflowWrap: 'anywhere' }}>
          {configuration.skill.name}（{configuration.skill.skillKey}）：<Typography.Text code>{configuration.baseDigest}</Typography.Text>
          {confirmedDigests?.[configuration.skill.skillKey] === configuration.baseDigest ? ' · 已核对' : ' · 尚未确认此配置'}
        </Typography.Paragraph>)}
        {candidateUnconfirmed ? <Alert type="warning" content="当前候选与前次确认缺失或不一致。请核对最新来源、构筑与技能配置；生命和属性草稿不会丢失。" /> : null}
        <Button disabled={busy || !candidateUnconfirmed} onClick={confirmLatestConfiguration}>确认最新技能配置</Button>
      </section> : null}

      {snapshot ? (
        <section key="scene-snapshot" aria-label="场景快照">
          {rangeRequirements.map(({ owner, equipmentKey, equipmentName }) => (
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

      {inspection ? <SimulationMechanicInputs requirements={mechanicRequirements} drafts={mechanicDrafts} disabled={busy} onChange={updateMechanic} /> : null}
      {mechanicIssues.length ? <Alert type="error" content={mechanicIssues.join('；')} /> : null}

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
              {(!skillMode || backgroundAttack) && speedAttribute?.maxValue === null ? <Form.Item label="攻速输入上界" required>
                <InputNumber aria-label="攻速输入上界" value={attackSpeedInputMax} disabled={busy}
                  onChange={value => updateContinuousInput('speed', value)} placeholder="明确填写不小于本场景攻速的正上界" />
                <Typography.Text type="secondary">真实属性目录未设上界，请显式填写；仅作输入准入，不是游戏攻速封顶。</Typography.Text>
              </Form.Item> : <Typography.Paragraph>攻速输入上界：{speedAttribute?.maxValue ?? '目录缺失'}（来自真实属性范围）。</Typography.Paragraph>}
            </div>
            <Typography.Paragraph type="secondary">连续场景按完整装备技能配置执行，计数、联动、受击、周期及攻速改期由原生处理；无前摇或弹道。项目暂定时序不等于游戏机制已核实。模拟观察时长与30秒真实运行超时分别计时。</Typography.Paragraph>
          </Form>
          <Space wrap style={{ marginTop: 16 }}>
            <Button disabled={busy || unfilled.length === 0} onClick={fillMissingWithZero}>将缺失属性填写为0</Button>
            {!skillMode ? <Button type="primary" disabled={busy || candidateUnconfirmed || unfilled.length > 0 || healthUnfilled || healthIssues.length > 0 || mechanicIssues.length > 0 || mechanicRequirements.length > 0} onClick={() => void execute('single_attack')}>执行一次普攻</Button> : null}
            {!skillMode ? <Button type="primary" disabled={busy || candidateUnconfirmed || unfilled.length > 0 || healthUnfilled || healthIssues.length > 0 || mechanicIssues.length > 0} onClick={() => void execute('continuous_attack')}>连续普攻</Button> : null}
            {skillMode ? <Button type="primary" disabled={busy || candidateUnconfirmed || unfilled.length > 0 || healthUnfilled || healthIssues.length > 0 || mechanicIssues.length > 0}
              onClick={() => void execute('skill_action')}>执行指定技能计划</Button> : null}
            <Button disabled={busy || candidateUnconfirmed || unfilled.length > 0 || healthUnfilled || healthIssues.length > 0 || mechanicIssues.length > 0} onClick={() => void execute('compile')}>编译验证</Button>
          </Space>
          {mechanicRequirements.length ? <Typography.Paragraph type="secondary">弹药主体使用连续普攻，由原生统一核对攻击许可、冻结开始库存及安排恢复；单次外部事件入口不支持此闭环。</Typography.Paragraph> : null}
          <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
            补零按钮只填写仍为空的缺失项，保留已填数值；攻速收益系数不补零，须明确填写正值；违反原属性范围的0仍会被拒绝。
          </Typography.Paragraph>
        </section>
      ) : null}

      {archive?.taskKind === 'single_attack' ? <SingleAttackResult key="single-attack-result" archive={archive} /> : null}
      {archive?.taskKind === 'skill_action' ? <SkillActionResult key={archive.runInputHash ?? 'skill-action-result'} archive={archive} stale={resultStale} /> : null}
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
