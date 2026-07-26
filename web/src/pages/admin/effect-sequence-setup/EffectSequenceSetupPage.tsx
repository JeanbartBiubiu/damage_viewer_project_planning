import { Alert, Button, Input, Select, Space, Tag, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import {
  formatCombatDataError,
  getCombatDataState,
  getEffectSequences,
  getProviders,
  putEffectSequence
} from '../../../services/combatDataClient';
import type { EffectSequence, Provider } from '../../../types/combatData';
import {
  buildEffectSequencePutBody,
  createDefaultFormDraft,
  createUnavailableReason,
  draftFromExistingSequence,
  formatStableLabel,
  listSequencesForProvider,
  validateEffectSequenceSetup,
  type EffectSequenceSetupFormDraft
} from './effectSequenceSetupModel';

export type EffectSequenceSetupPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  gamesReachable: boolean;
};

type SaveResultSummary = {
  sequenceId: string;
  providerId: string;
  sequenceKey: string;
  displayName: string;
  currentRevision: number;
};

function filterSelectOption(inputValue: string, option: unknown): boolean {
  const needle = inputValue.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  if (!option || typeof option !== 'object') {
    return false;
  }
  const record = option as {
    value?: unknown;
    children?: unknown;
    label?: unknown;
    props?: { value?: unknown; children?: unknown; label?: unknown };
  };
  const candidates = [
    record.value,
    record.label,
    record.children,
    record.props?.value,
    record.props?.label,
    record.props?.children
  ];
  return candidates.some((item) => String(item ?? '').toLowerCase().includes(needle));
}

function formatApiErrorWithDetails(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const base = error.code ? `${error.code}: ${error.message}` : error.message;
    if (error.details && Object.keys(error.details).length > 0) {
      return `${base} details=${JSON.stringify(error.details)}`;
    }
    return base;
  }
  return getErrorMessage(error);
}

export function EffectSequenceSetupPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  gamesReachable
}: EffectSequenceSetupPageProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentRevision, setCurrentRevision] = useState<number | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [sequences, setSequences] = useState<EffectSequence[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [sequencesLoaded, setSequencesLoaded] = useState(false);

  const [draft, setDraft] = useState<EffectSequenceSetupFormDraft>(createDefaultFormDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SaveResultSummary | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const validation = useMemo(
    () => validateEffectSequenceSetup(draft, sequences),
    [draft, sequences]
  );
  const createBlockReason = useMemo(
    () =>
      draft.selectedExistingSequenceId.trim()
        ? null
        : createUnavailableReason(draft.providerId),
    [draft.providerId, draft.selectedExistingSequenceId]
  );

  const providerOptions = useMemo(
    () =>
      providers
        .map((item) => ({
          value: item.providerId,
          label: formatStableLabel(item.providerId, item.displayName)
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
    [providers]
  );

  const sequenceOptions = useMemo(() => {
    const rows = listSequencesForProvider(sequences, draft.providerId);
    return rows.map((item) => ({
      value: item.sequenceId,
      label: formatStableLabel(item.sequenceId, item.displayName)
    }));
  }, [sequences, draft.providerId]);

  const loadAll = useCallback(async () => {
    if (!selectedGameId) {
      setCurrentRevision(null);
      setProviders([]);
      setSequences([]);
      setProvidersLoaded(false);
      setSequencesLoaded(false);
      setLoadError(null);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const [stateResult, providersResult, sequencesResult] = await Promise.all([
        getCombatDataState(apiBaseUrl, selectedGameId),
        getProviders(apiBaseUrl, selectedGameId),
        getEffectSequences(apiBaseUrl, selectedGameId)
      ]);

      setCurrentRevision(stateResult.data.currentRevision);
      setProviders(providersResult.data.data);
      setSequences(sequencesResult.data.data);
      setProvidersLoaded(true);
      setSequencesLoaded(true);
    } catch (error) {
      setCurrentRevision(null);
      setProviders([]);
      setSequences([]);
      setProvidersLoaded(false);
      setSequencesLoaded(false);
      setLoadError(
        formatCombatDataError(error, 'contract-entry', {
          apiBaseUrl,
          gamesReachable
        })
      );
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, gamesReachable, selectedGameId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll, reloadTick]);

  useEffect(() => {
    setDraft(createDefaultFormDraft());
    setLastResult(null);
    setSaveError(null);
    setSaveNotice(null);
    setProvidersLoaded(false);
    setSequencesLoaded(false);
  }, [selectedGameId]);

  const patchDraft = <K extends keyof EffectSequenceSetupFormDraft>(
    key: K,
    value: EffectSequenceSetupFormDraft[K]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveError(null);
    setSaveNotice(null);
  };

  const handleProviderChange = (value: unknown) => {
    const providerId = typeof value === 'string' ? value : '';
    setDraft({
      ...createDefaultFormDraft(),
      providerId
    });
    setSaveError(null);
    setSaveNotice(null);
  };

  const handleExistingSequenceChange = (value: unknown) => {
    const sequenceId = typeof value === 'string' ? value : '';
    if (!sequenceId) {
      setDraft((current) => ({
        ...createDefaultFormDraft(),
        providerId: current.providerId
      }));
      setSaveError(null);
      setSaveNotice(null);
      return;
    }
    const existing = sequences.find((item) => item.sequenceId === sequenceId);
    if (!existing) {
      return;
    }
    setDraft(draftFromExistingSequence(existing));
    setSaveError(null);
    setSaveNotice(null);
  };

  const providerLocked = Boolean(draft.selectedExistingSequenceId.trim());

  const canSave =
    Boolean(selectedGameId) &&
    gamesReachable === true &&
    !loading &&
    !loadError &&
    currentRevision !== null &&
    providersLoaded &&
    sequencesLoaded &&
    validation.ok &&
    Boolean(adminToken.trim()) &&
    !saving;

  const handleSave = async () => {
    if (!selectedGameId || !validation.ok) {
      return;
    }
    if (validation.target.mode === 'unavailable') {
      return;
    }

    const token = adminToken.trim();
    if (!token) {
      setSaveError('写入需要 Admin Token。');
      return;
    }

    const body = buildEffectSequencePutBody(validation.trimmed);
    const targetSequenceId = validation.target.sequenceId;

    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    setLastResult(null);
    try {
      const result = await putEffectSequence(
        apiBaseUrl,
        selectedGameId,
        targetSequenceId,
        token,
        body
      );
      setCurrentRevision(result.data.currentRevision);
      setLastResult({
        sequenceId: result.data.sequenceId,
        providerId: result.data.providerId,
        sequenceKey: result.data.sequenceKey,
        displayName:
          typeof result.data.displayName === 'string' ? result.data.displayName : '',
        currentRevision: result.data.currentRevision
      });
      setSaveNotice(
        `已${validation.target.mode === 'update' ? '更新' : '创建'} Effect Sequence「${result.data.sequenceId}」（revision ${result.data.currentRevision}）。`
      );
      setReloadTick((value) => value + 1);
    } catch (error) {
      setSaveError(formatApiErrorWithDetails(error));
    } finally {
      setSaving(false);
    }
  };

  const editsDisabled = !selectedGameId || loading || saving;
  const target = validation.target;

  return (
    <div className="page-stack">
      <Panel
        title="Effect Sequence 创建"
        kicker="Effect Sequence Setup"
        actions={
          <Space>
            <Button loading={loading} onClick={() => void loadAll()} disabled={!selectedGameId}>
              刷新
            </Button>
            <Button type="primary" loading={saving} disabled={!canSave} onClick={() => void handleSave()}>
              保存
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          普通 Effect Sequence 主档创建或有意更新（单行 PUT：
          <code>{'{ providerId, sequenceKey, displayName }'}</code>
          ；displayName 可为空字符串以清空）。本页只写序列主行，不是效果图构建器；步骤工作台见{' '}
          <a href="#/effect-step-setup">#/effect-step-setup</a>
          （非标准 Sequence ID 在该页仅可更新已有 Step），直伤图聚合入口见{' '}
          <a href="#/direct-damage-ability">#/direct-damage-ability</a>
          。高级分表仍可用{' '}
          <a href="#/combat-data/effect-sequences">#/combat-data/effect-sequences</a>。
        </Typography.Paragraph>

        {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : null}
        {loading ? (
          <Alert type="info" content="正在并发加载 combat-data state / providers / effect-sequences…" />
        ) : null}
        {loadError ? <Alert type="error" content={loadError} /> : null}

        {selectedGameId && !loading && !loadError ? (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Typography.Text bold>当前 revision：</Typography.Text>{' '}
              <Tag color="arcoblue">{currentRevision ?? '—'}</Tag>
              <Tag color={providersLoaded ? 'green' : 'orangered'} style={{ marginLeft: 8 }}>
                providersLoaded={String(providersLoaded)}
              </Tag>
              <Tag color={sequencesLoaded ? 'green' : 'orangered'} style={{ marginLeft: 8 }}>
                sequencesLoaded={String(sequencesLoaded)}
              </Tag>
              {!adminToken.trim() ? (
                <Tag color="orangered" style={{ marginLeft: 8 }}>
                  缺少 Admin Token，保存已禁用
                </Tag>
              ) : null}
              {!gamesReachable ? (
                <Tag color="orangered" style={{ marginLeft: 8 }}>
                  游戏列表不可达，保存已禁用
                </Tag>
              ) : null}
            </div>

            {providers.length === 0 ? (
              <Alert
                type="warning"
                content={
                  <span>
                    当前游戏没有可用 Provider，请先到{' '}
                    <a href="#/provider-setup">#/provider-setup</a> 创建。
                  </span>
                }
              />
            ) : null}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>已有 Provider</span>
                <Select
                  showSearch
                  allowClear
                  placeholder="先选择 Provider"
                  value={draft.providerId || undefined}
                  options={providerOptions}
                  filterOption={filterSelectOption}
                  disabled={editsDisabled || providerLocked || providers.length === 0}
                  onChange={handleProviderChange}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>已有 Effect Sequence（可选；用于有意更新）</span>
                <Select
                  showSearch
                  allowClear
                  placeholder={
                    draft.providerId
                      ? '留空=新建；选择则更新该 Sequence'
                      : '请先选择 Provider'
                  }
                  value={draft.selectedExistingSequenceId || undefined}
                  options={sequenceOptions}
                  filterOption={filterSelectOption}
                  disabled={editsDisabled || !draft.providerId}
                  onChange={handleExistingSequenceChange}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>sequenceKey</span>
                <Input
                  value={draft.sequenceKey}
                  disabled={editsDisabled || !draft.providerId}
                  placeholder="例：impact（小写字母、数字、下划线）"
                  onChange={(value) => patchDraft('sequenceKey', value)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>显示名（可选；空白=清空）</span>
                <Input
                  value={draft.displayName}
                  disabled={editsDisabled || !draft.providerId}
                  placeholder="可选显示名；留空将清空已有值"
                  onChange={(value) => patchDraft('displayName', value)}
                />
              </label>
            </div>

            {providerLocked ? (
              <Alert
                type="info"
                content="已选择既有 Effect Sequence：Provider 选择已锁定。清除「已有 Effect Sequence」后可更换 Provider 或改为新建。"
              />
            ) : null}

            {createBlockReason ? <Alert type="warning" content={createBlockReason} /> : null}

            <div>
              <Typography.Text bold>目标 Sequence ID（只读）：</Typography.Text>{' '}
              <code>
                {target.mode === 'create' || target.mode === 'update' ? target.sequenceId : '—'}
              </code>
              {target.mode === 'create' ? (
                <Tag color="green" style={{ marginLeft: 8 }}>
                  新建
                </Tag>
              ) : null}
              {target.mode === 'update' ? (
                <Tag color="arcoblue" style={{ marginLeft: 8 }}>
                  更新（保留遗留 ID）
                </Tag>
              ) : null}
            </div>

            {target.mode === 'update' ? (
              <Alert
                type="info"
                content={`将更新已有 Effect Sequence「${target.summary.sequenceId}」。sequenceId 固定不变（不是 ID 重命名）；可改 sequenceKey / displayName。当前 sequenceKey=${target.summary.sequenceKey}；displayName=${target.summary.displayName || '（空）'}。`}
              />
            ) : null}
            {target.mode === 'create' ? (
              <Alert type="success" content={`将创建新 Effect Sequence「${target.sequenceId}」。`} />
            ) : null}

            {!validation.ok &&
            (draft.providerId ||
              draft.sequenceKey ||
              draft.displayName ||
              draft.selectedExistingSequenceId) ? (
              <Alert type="warning" content={validation.reason} />
            ) : null}

            {saveError ? <Alert type="error" content={saveError} /> : null}
            {saveNotice ? <Alert type="success" content={saveNotice} /> : null}

            {lastResult ? (
              <section aria-label="保存结果">
                <Typography.Title heading={6}>保存结果</Typography.Title>
                <Typography.Paragraph style={{ marginTop: 0 }}>
                  sequenceId={lastResult.sequenceId} · providerId={lastResult.providerId} ·
                  sequenceKey={lastResult.sequenceKey} · displayName=
                  {lastResult.displayName || '（空）'} · revision={lastResult.currentRevision}
                </Typography.Paragraph>
              </section>
            ) : null}

            <Alert
              type="info"
              content={
                <span>
                  下一步（不同路径）：普通步骤工作台见{' '}
                  <a href="#/effect-step-setup">#/effect-step-setup</a>
                  （标准 <code>sequence_&lt;stem&gt;</code> 可新建；非标准 Sequence ID 仅可更新已有
                  Step）；直伤图聚合入口见{' '}
                  <a href="#/direct-damage-ability">#/direct-damage-ability</a>
                  。推荐闭环：
                  <a href="#/provider-setup">#/provider-setup</a> →{' '}
                  <a href="#/ability-setup">#/ability-setup</a> → 本页 →{' '}
                  <a href="#/effect-step-setup">#/effect-step-setup</a>。
                </span>
              }
            />
          </Space>
        ) : null}
      </Panel>
    </div>
  );
}
