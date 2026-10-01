import { Alert, Button, Form, InputNumber, Space, Table, Typography } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { JsonBlock } from '../../components/JsonBlock';
import { GenericEngineClient, GenericEngineClientError } from '../../engine/genericEngineClient';
import { WASM_IDENTITY } from '../../engine/wasmIdentity';
import {
  inspectSimulationSnapshot,
  prepareSimulation,
  SIMULATION_ADAPTER_VERSION,
  type SimulationAttributeRequirement,
  type SimulationCoverage
} from '../../engine/simulationAdapter';
import { getErrorMessage } from '../../services/apiClient';
import { getSimulationSnapshot } from '../../services/simulationSnapshotClient';
import type { CompileResult, GenericReleaseDonePayload } from '../../types/genericEngine';
import type { SimulationAttributeInputs, SimulationInitialHealth, SimulationSelection, SimulationSnapshot } from '../../types/simulationSnapshot';
import { SimulationEntitySelect } from './SimulationEntitySelect';
import { useSimulationSelectionOptions } from './useSimulationSelectionOptions';

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
type TaskPhase = 'idle' | 'reading' | 'preparing' | 'compiling' | 'releasing';
type Task = {
  cancelled: boolean;
  controller: AbortController;
  client: GenericEngineClient | null;
  snapshot: SimulationSnapshot | null;
  prepared: PreparedSimulation | null;
  result: CompileResult | null;
  release: GenericReleaseDonePayload | null;
  sessionId: string | null;
};
type CompileArchive = {
  outcome: 'passed' | 'failed' | 'cancelled';
  adapterVersion: string;
  wasm: typeof WASM_IDENTITY;
  snapshot: SimulationSnapshot;
  snapshotDigest: string;
  attributeInputs: SimulationAttributeInputs;
  initialHealth: SimulationInitialHealth;
  compileRequest: PreparedSimulation['compileRequest'];
  coverage: SimulationCoverage[];
  compileResult: CompileResult | null;
  releaseResult: GenericReleaseDonePayload | null;
  error: string | null;
};

const phaseLabels: Record<Exclude<TaskPhase, 'idle'>, string> = {
  reading: '正在读取场景快照', preparing: '正在准备编译请求',
  compiling: '正在编译配置', releasing: '正在释放编译会话'
};
const sideLabels = { source: '攻击方', target: '目标' };
const stableKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;

function emptySelection(): SelectionDraft {
  return {
    sourceCharacterKey: '', sourceLevel: undefined, targetCharacterKey: '', targetLevel: undefined,
    basicAttackSkillKey: '', basicAttackLevel: undefined
  };
}

function emptyAttributeDrafts(): AttributeDrafts { return { source: {}, target: {} }; }
function emptyInitialHealth(): InitialHealthDraft { return { source: undefined, target: undefined }; }

function selectionFromDraft(draft: SelectionDraft): SimulationSelection {
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
    ['sourceLevel', '攻击方等级'], ['targetLevel', '目标等级'], ['basicAttackLevel', '普攻技能等级']
  ] as const;
  for (const [field, label] of levels) {
    const value = draft[field];
    if (value === undefined || !Number.isInteger(value) || value < 1) {
      throw new Error(`selection.${field}: ${label}需明确填写正整数。`);
    }
  }
  return {
    sourceCharacterKey: draft.sourceCharacterKey.trim(), sourceLevel: draft.sourceLevel!,
    targetCharacterKey: draft.targetCharacterKey.trim(), targetLevel: draft.targetLevel!,
    basicAttackSkillKey: draft.basicAttackSkillKey.trim(), basicAttackLevel: draft.basicAttackLevel!
  };
}

function taskError(error: unknown): string {
  if (error instanceof GenericEngineClientError && error.engineError) {
    const item = error.engineError;
    return `${item.path ? `${item.path}: ` : ''}${item.code} ${item.message}`;
  }
  return getErrorMessage(error);
}

function archiveFor(task: Task, outcome: CompileArchive['outcome'], error: string | null): CompileArchive | null {
  if (!task.snapshot || !task.prepared) return null;
  return {
    outcome, adapterVersion: SIMULATION_ADAPTER_VERSION, wasm: WASM_IDENTITY, snapshot: task.snapshot,
    snapshotDigest: task.prepared.snapshotDigest, attributeInputs: task.prepared.attributeInputs,
    initialHealth: task.prepared.initialHealth,
    compileRequest: task.prepared.compileRequest, coverage: task.prepared.coverage,
    compileResult: task.result, releaseResult: task.release, error
  };
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
  const [prepared, setPrepared] = useState<PreparedSimulation | null>(null);
  const [archive, setArchive] = useState<CompileArchive | null>(null);
  const [phase, setPhase] = useState<TaskPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = useRef(true);
  const taskRef = useRef<Task | null>(null);
  const token = adminToken.trim();
  const busy = phase !== 'idle';
  const { characters, skills, imageLoader } = useSimulationSelectionOptions(apiBaseUrl, selectedGameId, token, selection.sourceCharacterKey);
  const objectsSelected = characters.items.some(row => row.key === selection.sourceCharacterKey)
    && characters.items.some(row => row.key === selection.targetCharacterKey)
    && skills.items.some(row => row.key === selection.basicAttackSkillKey);
  const requirements = inspection?.requirements ?? [];
  const missing = requirements.filter(row => row.storedValue === undefined);
  const unfilled = missing.filter(row => attributeDrafts[row.side][row.attribute.attributeKey] === undefined);
  const coverage = prepared?.coverage ?? inspection?.coverage ?? [];
  const healthUnfilled = initialHealth.source === undefined || initialHealth.target === undefined;
  const sourceHealthLimit = snapshot?.source.selectedLevelValues.hp;
  const targetHealthLimit = snapshot?.target.selectedLevelValues.hp;
  const fullHealthAvailable = typeof sourceHealthLimit === 'number' && Number.isFinite(sourceHealthLimit) && sourceHealthLimit > 0
    && typeof targetHealthLimit === 'number' && Number.isFinite(targetHealthLimit) && targetHealthLimit > 0;

  useEffect(() => {
    active.current = true;
    setSelection(emptySelection());
    setSnapshot(null);
    setInspection(null);
    setAttributeDrafts(emptyAttributeDrafts());
    setInitialHealth(emptyInitialHealth());
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

  const beginTask = (nextPhase: Exclude<TaskPhase, 'idle'>): Task | null => {
    if (taskRef.current) return null;
    const task: Task = {
      cancelled: false, controller: new AbortController(), client: null,
      snapshot: null, prepared: null, result: null, release: null, sessionId: null
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
    taskRef.current = null;
    setArchive(archiveFor(task, 'cancelled', null));
    setPhase('idle');
    setError(null);
    setNotice('当前任务已取消，未完成编译验证。');
    onDirtyChange(false);
  };

  const clearArtifacts = () => {
    setSnapshot(null);
    setInspection(null);
    setAttributeDrafts(emptyAttributeDrafts());
    setInitialHealth(emptyInitialHealth());
    setPrepared(null);
    setArchive(null);
    setError(null);
    setNotice(null);
  };

  const patchSelection = <K extends keyof SelectionDraft>(key: K, value: SelectionDraft[K]) => {
    if (taskRef.current) return;
    setSelection(current => ({ ...current, [key]: value,
      ...(key === 'sourceCharacterKey' ? { basicAttackSkillKey: '', basicAttackLevel: undefined } : {}) }));
    clearArtifacts();
  };

  const readSnapshot = async () => {
    if (taskRef.current || !selectedGameId || !token || !objectsSelected) return;
    let requested: SimulationSelection;
    try { requested = selectionFromDraft(selection); }
    catch (cause) { setError(taskError(cause)); return; }
    const task = beginTask('reading');
    if (!task) return;
    clearArtifacts();
    try {
      const result = await getSimulationSnapshot(apiBaseUrl, selectedGameId, requested, token, task.controller.signal);
      if (!isCurrent(task)) return;
      task.snapshot = result.data;
      setSnapshot(result.data);
      setInspection(inspectSimulationSnapshot(result.data));
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
    setArchive(null);
    setError(null);
    setNotice(null);
  };

  const fillMissingWithZero = () => {
    if (taskRef.current) return;
    setAttributeDrafts(current => {
      const next = { source: { ...current.source }, target: { ...current.target } };
      for (const row of missing) {
        const key = row.attribute.attributeKey;
        if (next[row.side][key] === undefined) next[row.side][key] = 0;
      }
      return next;
    });
    setPrepared(null);
    setArchive(null);
    setError(null);
    setNotice(null);
  };

  const updateInitialHealth = (side: 'source' | 'target', value: number | undefined) => {
    if (taskRef.current) return;
    setInitialHealth(current => ({ ...current, [side]: value }));
    setPrepared(null);
    setArchive(null);
    setError(null);
    setNotice(null);
  };

  const startAtFullHealth = () => {
    if (taskRef.current || !fullHealthAvailable) return;
    setInitialHealth({ source: sourceHealthLimit, target: targetHealthLimit });
    setPrepared(null);
    setArchive(null);
    setError(null);
    setNotice(null);
  };

  const compile = async () => {
    if (taskRef.current || !snapshot || !inspection) return;
    const task = beginTask('preparing');
    if (!task) return;
    task.snapshot = snapshot;
    setPrepared(null);
    setArchive(null);
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
      task.prepared = await prepareSimulation(snapshot, inputs, { source: initialHealth.source, target: initialHealth.target });
      if (!isCurrent(task)) return;
      setPrepared(task.prepared);
      task.client = new GenericEngineClient();
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
    } catch (cause) {
      if (cause instanceof GenericEngineClientError) task.sessionId = cause.engineError?.sessionId ?? task.sessionId;
      if (isCurrent(task)) failure = taskError(cause);
    } finally {
      if (task.client) {
        try {
          if (!task.cancelled && task.sessionId) {
            if (isCurrent(task)) setPhase('releasing');
            task.release = await task.client.release(task.sessionId, task.prepared?.compileRequest.rulesHash);
          }
        } catch (cause) {
          if (isCurrent(task)) failure = `${failure ? `${failure}\n` : ''}编译会话释放失败：${taskError(cause)}`;
        } finally {
          task.client.terminate();
        }
      }
      if (isCurrent(task)) {
        const passed = failure === null && task.result?.ok === true && task.release?.released === true;
        if (!passed && failure === null) failure = '未完成编译与会话释放，不能标记验证通过。';
        setArchive(archiveFor(task, passed ? 'passed' : 'failed', failure));
        setError(failure);
        setNotice(passed ? '仅编译验证通过，不代表单次/连续计算通过。' : null);
        finishTask(task);
      }
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : null}
      {selectedGameId && !token ? <Alert type="warning" content="请先在顶部配置 Admin Token。" /> : null}
      {error ? <Alert type="error" content={<span style={{ whiteSpace: 'pre-wrap' }}>{error}</span>} /> : null}
      {notice ? <Alert type={archive?.outcome === 'passed' ? 'success' : 'info'} content={notice} /> : null}
      {busy ? <Alert type="info" content={phaseLabels[phase as Exclude<TaskPhase, 'idle'>]} /> : null}
      {characters.error ? <Alert type="error" content={`角色列表读取失败：${characters.error}`}
        action={<Button disabled={busy} onClick={characters.retry}>重试角色列表</Button>} /> : null}
      {skills.error ? <Alert type="error" content={`普攻列表读取失败：${skills.error}`}
        action={<Button disabled={busy} onClick={skills.retry}>重试普攻列表</Button>} /> : null}

      <Form layout="vertical" aria-label="普攻场景选择">
        <div className="simulation-selection-grid">
          <Form.Item label="攻击方角色" required>
            <SimulationEntitySelect label="攻击方角色" value={selection.sourceCharacterKey} options={characters.items}
              loading={characters.loading} disabled={busy || !selectedGameId || !token || characters.loading || Boolean(characters.error)}
              loadImage={imageLoader} onChange={value => patchSelection('sourceCharacterKey', value)} placeholder="搜索角色名称或标识" />
          </Form.Item>
          <Form.Item label="攻击方等级" required>
            <InputNumber aria-label="攻击方等级" value={selection.sourceLevel} disabled={busy} min={1} precision={0}
              onChange={value => patchSelection('sourceLevel', value)} />
          </Form.Item>
          <Form.Item label="目标角色" required>
            <SimulationEntitySelect label="目标角色" value={selection.targetCharacterKey} options={characters.items}
              loading={characters.loading} disabled={busy || !selectedGameId || !token || characters.loading || Boolean(characters.error)}
              loadImage={imageLoader} onChange={value => patchSelection('targetCharacterKey', value)} placeholder="搜索角色名称或标识" />
          </Form.Item>
          <Form.Item label="目标等级" required>
            <InputNumber aria-label="目标等级" value={selection.targetLevel} disabled={busy} min={1} precision={0}
              onChange={value => patchSelection('targetLevel', value)} />
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
            <InputNumber aria-label="普攻技能等级" value={selection.basicAttackLevel} disabled={busy} min={1} precision={0}
              onChange={value => patchSelection('basicAttackLevel', value)} />
          </Form.Item>
        </div>
        <Space wrap>
          <Button type="primary" disabled={busy || !selectedGameId || !token || !objectsSelected} onClick={() => void readSnapshot()}>
            读取场景快照
          </Button>
          {busy ? <Button status="danger" onClick={cancelTask}>取消当前请求</Button> : null}
        </Space>
      </Form>

      {snapshot ? (
        <section aria-label="场景快照">
          <Typography.Paragraph>
            攻击方：{snapshot.source.character.name}（{snapshot.selection.sourceCharacterKey}，等级{snapshot.selection.sourceLevel}）；
            目标：{snapshot.target.character.name}（{snapshot.selection.targetCharacterKey}，等级{snapshot.selection.targetLevel}）。
          </Typography.Paragraph>
          <Typography.Paragraph style={{ overflowWrap: 'anywhere' }}>
            原快照摘要：<Typography.Text code id="simulation-snapshot-digest">{snapshot.snapshotDigest}</Typography.Text>
          </Typography.Paragraph>
          <Button disabled={busy} onClick={() => downloadJson('basic-attack-snapshot.json', snapshot)}>下载场景快照</Button>
        </section>
      ) : null}

      {inspection && snapshot ? (
        <section aria-label="初始当前生命">
          <Typography.Title heading={5}>初始当前生命</Typography.Title>
          <Typography.Paragraph>
            双方当前生命必须明确填写，0合法，未填写不会默认满生命；不能超过各自真实等级的生命上限。
          </Typography.Paragraph>
          <Form layout="vertical">
            <div className="simulation-selection-grid">
              <Form.Item label="攻击方初始当前生命" required>
                <InputNumber aria-label="攻击方初始当前生命" value={initialHealth.source} disabled={busy}
                  min={0} max={sourceHealthLimit} onChange={value => updateInitialHealth('source', value)} />
                <Typography.Text type="secondary">已录生命上限：{sourceHealthLimit ?? '未录入'}</Typography.Text>
              </Form.Item>
              <Form.Item label="目标初始当前生命" required>
                <InputNumber aria-label="目标初始当前生命" value={initialHealth.target} disabled={busy}
                  min={0} max={targetHealthLimit} onChange={value => updateInitialHealth('target', value)} />
                <Typography.Text type="secondary">已录生命上限：{targetHealthLimit ?? '未录入'}</Typography.Text>
              </Form.Item>
            </div>
          </Form>
          <Button disabled={busy || !fullHealthAvailable} onClick={startAtFullHealth}>双方以满生命开始</Button>
        </section>
      ) : null}

      {inspection ? (
        <section aria-label="必要属性">
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
          <Space wrap style={{ marginTop: 16 }}>
            <Button disabled={busy || unfilled.length === 0} onClick={fillMissingWithZero}>将缺失属性填写为0</Button>
            <Button type="primary" disabled={busy || unfilled.length > 0 || healthUnfilled} onClick={() => void compile()}>编译验证</Button>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
            补零按钮只填写仍为空的缺失项，保留已填数值；违反原属性范围的0仍会被拒绝。
          </Typography.Paragraph>
        </section>
      ) : null}

      {prepared ? (
        <section aria-label="编译请求与档案">
          <Typography.Paragraph style={{ overflowWrap: 'anywhere' }}>
            请求规则摘要：<Typography.Text code id="simulation-rules-hash">{prepared.compileRequest.rulesHash}</Typography.Text>
          </Typography.Paragraph>
          <Space wrap>
            <Button disabled={busy} onClick={() => downloadJson('basic-attack-compile-request.json', prepared.compileRequest)}>下载编译请求</Button>
            <Button disabled={busy || !archive} onClick={() => archive && downloadJson('basic-attack-compile-archive.json', archive)}>下载编译档案</Button>
          </Space>
          {archive?.compileResult?.metadata ? <JsonBlock value={archive.compileResult.metadata} /> : null}
          {archive?.compileResult?.errors?.length ? <JsonBlock value={archive.compileResult.errors} /> : null}
          {archive?.compileResult?.warnings?.length ? <JsonBlock value={archive.compileResult.warnings} /> : null}
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
    </Space>
  );
}
