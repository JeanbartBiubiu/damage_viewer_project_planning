import { Alert, Button, Select, Space, Tag, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import {
  formatCombatDataError,
  getCombatDataState,
  getEntities,
  getEntityProviderMounts,
  getProviders,
  putEntityProviderMount
} from '../../../services/combatDataClient';
import type { CombatEntity, EntityProviderMount, Provider } from '../../../types/combatData';
import {
  buildMountPutBody,
  createDefaultFormDraft,
  isDraftComplete,
  listEntityOptions,
  listProviderOptions,
  resolveMountRelationStatus,
  type EntityProviderMountFormDraft
} from './entityProviderMountModel';

export type EntityProviderMountPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  gamesReachable: boolean;
};

type SaveResultSummary = {
  entityId: string;
  providerId: string;
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

export function EntityProviderMountPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  gamesReachable
}: EntityProviderMountPageProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentRevision, setCurrentRevision] = useState<number | null>(null);
  const [entities, setEntities] = useState<CombatEntity[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [mounts, setMounts] = useState<EntityProviderMount[]>([]);
  const [entitiesLoaded, setEntitiesLoaded] = useState(false);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [mountsLoaded, setMountsLoaded] = useState(false);

  const [draft, setDraft] = useState<EntityProviderMountFormDraft>(createDefaultFormDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SaveResultSummary | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const entityOptions = useMemo(() => listEntityOptions(entities), [entities]);
  const providerOptions = useMemo(() => listProviderOptions(providers), [providers]);
  const relationStatus = useMemo(
    () => resolveMountRelationStatus(draft, mounts),
    [draft, mounts]
  );
  const draftComplete = useMemo(() => isDraftComplete(draft), [draft]);

  const clearLoadedData = () => {
    setCurrentRevision(null);
    setEntities([]);
    setProviders([]);
    setMounts([]);
    setEntitiesLoaded(false);
    setProvidersLoaded(false);
    setMountsLoaded(false);
  };

  const loadAll = useCallback(async () => {
    if (!selectedGameId) {
      clearLoadedData();
      setLoadError(null);
      return;
    }

    setLoading(true);
    setLoadError(null);
    setEntitiesLoaded(false);
    setProvidersLoaded(false);
    setMountsLoaded(false);
    try {
      const [stateResult, entitiesResult, providersResult, mountsResult] = await Promise.all([
        getCombatDataState(apiBaseUrl, selectedGameId),
        getEntities(apiBaseUrl, selectedGameId),
        getProviders(apiBaseUrl, selectedGameId),
        getEntityProviderMounts(apiBaseUrl, selectedGameId)
      ]);

      setCurrentRevision(stateResult.data.currentRevision);
      setEntities(entitiesResult.data.data);
      setProviders(providersResult.data.data);
      setMounts(mountsResult.data.data);
      setEntitiesLoaded(true);
      setProvidersLoaded(true);
      setMountsLoaded(true);
    } catch (error) {
      clearLoadedData();
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
    clearLoadedData();
    setDraft(createDefaultFormDraft());
    setLastResult(null);
    setSaveError(null);
    setSaveNotice(null);
    setLoadError(null);
  }, [selectedGameId]);

  const patchDraft = <K extends keyof EntityProviderMountFormDraft>(
    key: K,
    value: EntityProviderMountFormDraft[K]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveError(null);
    setSaveNotice(null);
  };

  const alreadyMounted = relationStatus.status === 'existing';

  const canSave =
    Boolean(selectedGameId) &&
    gamesReachable === true &&
    !loading &&
    !loadError &&
    currentRevision !== null &&
    entitiesLoaded &&
    providersLoaded &&
    mountsLoaded &&
    entities.length > 0 &&
    providers.length > 0 &&
    draftComplete &&
    relationStatus.status === 'new' &&
    Boolean(adminToken.trim()) &&
    !saving;

  const handleSave = async () => {
    if (!selectedGameId || relationStatus.status !== 'new' || !canSave) {
      return;
    }

    const token = adminToken.trim();
    if (!token) {
      setSaveError('写入需要 Admin Token。');
      return;
    }

    const body = buildMountPutBody();

    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    setLastResult(null);
    try {
      const result = await putEntityProviderMount(
        apiBaseUrl,
        selectedGameId,
        relationStatus.entityId,
        relationStatus.providerId,
        token,
        body
      );
      setCurrentRevision(result.data.currentRevision);
      setLastResult({
        entityId: result.data.entityId,
        providerId: result.data.providerId,
        currentRevision: result.data.currentRevision
      });
      setSaveNotice(
        `已挂载 Provider「${result.data.providerId}」到实体「${result.data.entityId}」（revision ${result.data.currentRevision}）。`
      );
      setReloadTick((value) => value + 1);
    } catch (error) {
      setSaveError(formatApiErrorWithDetails(error));
    } finally {
      setSaving(false);
    }
  };

  const editsDisabled = !selectedGameId || loading || saving;

  const disableReason = (() => {
    if (!selectedGameId) {
      return '请先在顶部选择游戏。';
    }
    if (!gamesReachable) {
      return '游戏列表不可达，保存已禁用。';
    }
    if (loading) {
      return '正在加载依赖数据，保存已禁用。';
    }
    if (loadError) {
      return '依赖加载失败，保存已禁用。';
    }
    if (currentRevision === null) {
      return '当前 revision 未知，保存已禁用。';
    }
    if (!entitiesLoaded || !providersLoaded || !mountsLoaded) {
      return '实体 / Provider / 挂载列表尚未完成读取，保存已禁用。';
    }
    if (entities.length === 0) {
      return '当前游戏没有可用实体，请先到 #/entity-setup 创建 Entity 主行。';
    }
    if (providers.length === 0) {
      return '当前游戏没有可用 Provider，请先到 #/provider-setup 创建。';
    }
    if (!draftComplete) {
      return '请同时选择实体与 Provider。';
    }
    if (alreadyMounted) {
      return '该实体与 Provider 已挂载，无需再保存（重复 PUT 会推进 revision）。';
    }
    if (!adminToken.trim()) {
      return '缺少 Admin Token，保存已禁用。';
    }
    if (saving) {
      return '正在保存…';
    }
    return null;
  })();

  return (
    <div className="page-stack">
      <Panel
        title="实体 Provider 挂载"
        kicker="Entity Provider Mount"
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
          从已有实体与 Provider 中选择一对，仅创建挂载关系（单行 PUT，body 为{' '}
          <code>{'{}'}</code>
          ）。推荐闭环：
          <a href="#/provider-setup">#/provider-setup</a> → 本页 →{' '}
          <a href="#/ability-setup">#/ability-setup</a>（普通 Ability 主档）或{' '}
          <a href="#/direct-damage-ability">#/direct-damage-ability</a>（直伤图快捷入口）
          。高级/诊断分表仍可用{' '}
          <a href="#/combat-data/entity-provider-mounts">#/combat-data/entity-provider-mounts</a>。
        </Typography.Paragraph>

        {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : null}
        {loading ? <Alert type="info" content="正在并发加载 state / entities / providers / mounts…" /> : null}
        {loadError ? <Alert type="error" content={loadError} /> : null}

        {selectedGameId && !loading && !loadError ? (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Typography.Text bold>当前 revision：</Typography.Text>{' '}
              <Tag color="arcoblue">{currentRevision ?? '—'}</Tag>
              <Tag color={entitiesLoaded ? 'green' : 'orangered'} style={{ marginLeft: 8 }}>
                entitiesLoaded={String(entitiesLoaded)}
              </Tag>
              <Tag color={providersLoaded ? 'green' : 'orangered'} style={{ marginLeft: 8 }}>
                providersLoaded={String(providersLoaded)}
              </Tag>
              <Tag color={mountsLoaded ? 'green' : 'orangered'} style={{ marginLeft: 8 }}>
                mountsLoaded={String(mountsLoaded)}
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

            {entities.length === 0 ? (
              <Alert
                type="warning"
                content={
                  <span>
                    当前游戏没有可用实体。请先到{' '}
                    <a href="#/entity-setup">#/entity-setup</a>{' '}
                    创建 Entity 主行，然后再回来挂载。
                  </span>
                }
              />
            ) : null}
            {providers.length === 0 ? (
              <Alert
                type="warning"
                content={
                  <span>
                    当前游戏没有可用 Provider。请先到{' '}
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
                <span>实体</span>
                <Select
                  showSearch
                  allowClear
                  placeholder="选择已有实体"
                  value={draft.entityId || undefined}
                  options={entityOptions}
                  filterOption={filterSelectOption}
                  disabled={editsDisabled || entities.length === 0}
                  onChange={(value) => patchDraft('entityId', typeof value === 'string' ? value : '')}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>Provider</span>
                <Select
                  showSearch
                  allowClear
                  placeholder="选择已有 Provider"
                  value={draft.providerId || undefined}
                  options={providerOptions}
                  filterOption={filterSelectOption}
                  disabled={editsDisabled || providers.length === 0}
                  onChange={(value) =>
                    patchDraft('providerId', typeof value === 'string' ? value : '')
                  }
                />
              </label>
            </div>

            {alreadyMounted ? (
              <Alert
                type="warning"
                content={`该对已挂载：entityId=${relationStatus.entityId} · providerId=${relationStatus.providerId}。无需再保存（重复 PUT 会推进 revision）。`}
              />
            ) : null}
            {relationStatus.status === 'new' ? (
              <Alert
                type="success"
                content={`将新建挂载：entityId=${relationStatus.entityId} · providerId=${relationStatus.providerId}（body={}）。`}
              />
            ) : null}

            {!canSave && disableReason ? <Alert type="info" content={disableReason} /> : null}

            {saveError ? <Alert type="error" content={saveError} /> : null}
            {saveNotice ? <Alert type="success" content={saveNotice} /> : null}

            {lastResult ? (
              <section aria-label="保存结果">
                <Typography.Title heading={6}>保存结果</Typography.Title>
                <Typography.Paragraph style={{ marginTop: 0 }}>
                  entityId={lastResult.entityId} · providerId={lastResult.providerId} ·
                  currentRevision={lastResult.currentRevision}
                </Typography.Paragraph>
              </section>
            ) : null}

            <Alert
              type="info"
              content={
                <span>
                  上一步：在 <a href="#/provider-setup">#/provider-setup</a> 创建 Provider。下一步：到{' '}
                  <a href="#/ability-setup">#/ability-setup</a> 创建普通 Ability 主档，或到{' '}
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
