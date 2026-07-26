import { Alert, Button, Input, Select, Space, Tag, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import {
  formatCombatDataError,
  getCombatDataState,
  getProviders,
  getTypes,
  putProvider
} from '../../../services/combatDataClient';
import type { Provider, TypeDefinition } from '../../../types/combatData';
import {
  buildProviderIdFromKey,
  buildProviderPutBody,
  createDefaultFormDraft,
  listProviderKindOptions,
  providerKindBlockingMessage,
  resolveProviderPresence,
  validateFormDraft,
  type ProviderSetupFormDraft
} from './providerSetupModel';

export type ProviderSetupPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  gamesReachable: boolean;
};

type SaveResultSummary = {
  providerId: string;
  displayName: string;
  providerKindTypeId: number;
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

export function ProviderSetupPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  gamesReachable
}: ProviderSetupPageProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentRevision, setCurrentRevision] = useState<number | null>(null);
  const [types, setTypes] = useState<TypeDefinition[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [typesLoaded, setTypesLoaded] = useState(false);
  const [providersLoaded, setProvidersLoaded] = useState(false);

  const [draft, setDraft] = useState<ProviderSetupFormDraft>(createDefaultFormDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SaveResultSummary | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const kindOptions = useMemo(() => listProviderKindOptions(types), [types]);
  const kindBlockMessage = useMemo(
    () => providerKindBlockingMessage(kindOptions),
    [kindOptions]
  );
  const formValidation = useMemo(
    () => validateFormDraft(draft, kindOptions),
    [draft, kindOptions]
  );
  const generatedProviderId = useMemo(
    () => buildProviderIdFromKey(draft.providerKey),
    [draft.providerKey]
  );
  const presence = useMemo(
    () => resolveProviderPresence(providers, generatedProviderId),
    [providers, generatedProviderId]
  );

  const kindSelectOptions = useMemo(
    () =>
      kindOptions.map((item) => ({
        value: item.typeKey,
        label: item.label
      })),
    [kindOptions]
  );

  const loadAll = useCallback(async () => {
    if (!selectedGameId) {
      setCurrentRevision(null);
      setTypes([]);
      setProviders([]);
      setTypesLoaded(false);
      setProvidersLoaded(false);
      setLoadError(null);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const [stateResult, typesResult, providersResult] = await Promise.all([
        getCombatDataState(apiBaseUrl, selectedGameId),
        getTypes(apiBaseUrl, selectedGameId),
        getProviders(apiBaseUrl, selectedGameId)
      ]);

      setCurrentRevision(stateResult.data.currentRevision);
      setTypes(typesResult.data.data);
      setProviders(providersResult.data.data);
      setTypesLoaded(true);
      setProvidersLoaded(true);
    } catch (error) {
      setCurrentRevision(null);
      setTypes([]);
      setProviders([]);
      setTypesLoaded(false);
      setProvidersLoaded(false);
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
  }, [selectedGameId]);

  const patchDraft = <K extends keyof ProviderSetupFormDraft>(
    key: K,
    value: ProviderSetupFormDraft[K]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveError(null);
    setSaveNotice(null);
  };

  const canSave =
    Boolean(selectedGameId) &&
    gamesReachable === true &&
    !loading &&
    !loadError &&
    currentRevision !== null &&
    typesLoaded &&
    providersLoaded &&
    kindOptions.length > 0 &&
    formValidation.ok &&
    Boolean(adminToken.trim()) &&
    !saving;

  const handleSave = async () => {
    if (!selectedGameId || !formValidation.ok) {
      return;
    }

    const token = adminToken.trim();
    if (!token) {
      setSaveError('写入需要 Admin Token。');
      return;
    }

    const body = buildProviderPutBody(formValidation.trimmed);

    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    setLastResult(null);
    try {
      const result = await putProvider(
        apiBaseUrl,
        selectedGameId,
        formValidation.trimmed.providerId,
        token,
        body
      );
      setCurrentRevision(result.data.currentRevision);
      setLastResult({
        providerId: result.data.providerId,
        displayName: result.data.displayName,
        providerKindTypeId: result.data.providerKindTypeId,
        currentRevision: result.data.currentRevision
      });
      setSaveNotice(
        `已${presence.mode === 'update' ? '更新' : '创建'} Provider「${result.data.providerId}」（revision ${result.data.currentRevision}）。`
      );
      setReloadTick((value) => value + 1);
    } catch (error) {
      setSaveError(formatApiErrorWithDetails(error));
    } finally {
      setSaving(false);
    }
  };

  const editsDisabled = !selectedGameId || loading || saving;

  return (
    <div className="page-stack">
      <Panel
        title="Provider 创建"
        kicker="Provider Setup"
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
          按语义类型创建或更新 Provider 主档（单行 PUT）。不进入分表编辑器、不填写数值 typeId。保存后请到{' '}
          <a href="#/entity-provider-mount">#/entity-provider-mount</a>{' '}
          挂载到实体，再在 <a href="#/ability-setup">#/ability-setup</a> 创建普通 Ability 主档，或到{' '}
          <a href="#/direct-damage-ability">#/direct-damage-ability</a> 配置直伤技能图。
        </Typography.Paragraph>

        {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : null}
        {loading ? <Alert type="info" content="正在加载 combat-data 依赖…" /> : null}
        {loadError ? <Alert type="error" content={loadError} /> : null}

        {selectedGameId && !loading && !loadError ? (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Typography.Text bold>当前 revision：</Typography.Text>{' '}
              <Tag color="arcoblue">{currentRevision ?? '—'}</Tag>
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

            {kindBlockMessage ? <Alert type="error" content={kindBlockMessage} /> : null}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>Provider Key</span>
                <Input
                  value={draft.providerKey}
                  disabled={editsDisabled}
                  placeholder="例：ashe_q（不要写 provider_ 前缀）"
                  onChange={(value) => patchDraft('providerKey', value)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>显示名</span>
                <Input
                  value={draft.displayName}
                  disabled={editsDisabled}
                  placeholder="显示名"
                  onChange={(value) => patchDraft('displayName', value)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>Provider 种类</span>
                <Select
                  showSearch
                  allowClear
                  placeholder="选择 provider_kind/*"
                  value={draft.providerKindTypeKey || undefined}
                  options={kindSelectOptions}
                  filterOption={filterSelectOption}
                  disabled={editsDisabled || kindOptions.length === 0}
                  onChange={(value) =>
                    patchDraft('providerKindTypeKey', typeof value === 'string' ? value : '')
                  }
                />
              </label>
            </div>

            <div>
              <Typography.Text bold>生成的 Provider ID（只读）：</Typography.Text>{' '}
              <code>{generatedProviderId ?? '—'}</code>
            </div>

            {generatedProviderId && presence.mode === 'update' ? (
              <Alert
                type="info"
                content={`将更新已有 Provider「${presence.summary.providerId}」。当前 displayName=${presence.summary.displayName}；providerKindTypeId=${presence.summary.providerKindTypeId}。`}
              />
            ) : null}
            {generatedProviderId && presence.mode === 'create' ? (
              <Alert type="success" content={`将创建新 Provider「${generatedProviderId}」。`} />
            ) : null}

            {!formValidation.ok && (draft.providerKey || draft.displayName || draft.providerKindTypeKey) ? (
              <Alert type="warning" content={formValidation.reason} />
            ) : null}

            {saveError ? <Alert type="error" content={saveError} /> : null}
            {saveNotice ? <Alert type="success" content={saveNotice} /> : null}

            {lastResult ? (
              <section aria-label="保存结果">
                <Typography.Title heading={6}>保存结果</Typography.Title>
                <Typography.Paragraph style={{ marginTop: 0 }}>
                  providerId={lastResult.providerId} · displayName={lastResult.displayName} ·
                  providerKindTypeId={lastResult.providerKindTypeId} · revision=
                  {lastResult.currentRevision}
                </Typography.Paragraph>
              </section>
            ) : null}

            <Alert
              type="info"
              content={
                <span>
                  下一步：在{' '}
                  <a href="#/entity-provider-mount">#/entity-provider-mount</a>{' '}
                  将 Provider 挂载到实体，然后到{' '}
                  <a href="#/ability-setup">#/ability-setup</a> 创建普通 Ability，或到{' '}
                  <a href="#/direct-damage-ability">#/direct-damage-ability</a> 配置直伤技能图。
                </span>
              }
            />
          </Space>
        ) : null}
      </Panel>
    </div>
  );
}
