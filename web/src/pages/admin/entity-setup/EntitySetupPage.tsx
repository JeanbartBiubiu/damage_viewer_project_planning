import { Alert, Button, Input, Select, Space, Tag, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CombatDataImageReferenceField } from '../../../components/CombatDataImageReferenceField';
import {
  createEntitySelectOption,
  filterEntitySelectOption
} from '../../../components/EntitySelectOption';
import { Panel } from '../../../components/Panel';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import {
  formatCombatDataError,
  getCombatDataState,
  getEntities,
  putEntity
} from '../../../services/combatDataClient';
import type { ImageReferenceEditState } from '../../../services/combatDataImageReference';
import { getCachedImage } from '../../../services/imageCache';
import type { CombatEntity } from '../../../types/combatData';
import {
  buildEntityPutBody,
  createDefaultFormDraft,
  populateDraftFromEntity,
  resolveEntityPresence,
  validateFormDraft,
  willClearExistingDescription,
  willClearExistingImageUri,
  type EntitySetupFormDraft
} from './entitySetupModel';

export type EntitySetupPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  gamesReachable: boolean;
};

type SaveResultSummary = {
  entityId: string;
  displayName: string;
  description: string;
  imageUri: string | null;
  currentRevision: number;
};

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

function imageUriFieldError(error: unknown): string | null {
  if (!(error instanceof ApiRequestError) || error.status !== 400) {
    return null;
  }
  const path = error.details?.path;
  if (path === '/imageUri' || path === 'imageUri') {
    return formatApiErrorWithDetails(error);
  }
  return null;
}

export function EntitySetupPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  gamesReachable
}: EntitySetupPageProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentRevision, setCurrentRevision] = useState<number | null>(null);
  const [entities, setEntities] = useState<CombatEntity[]>([]);
  const [entitiesLoaded, setEntitiesLoaded] = useState(false);

  const [draft, setDraft] = useState<EntitySetupFormDraft>(createDefaultFormDraft);
  const [loadSelectId, setLoadSelectId] = useState<string | undefined>(undefined);
  const [entityThumbById, setEntityThumbById] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [imageFieldError, setImageFieldError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SaveResultSummary | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const formValidation = useMemo(() => validateFormDraft(draft), [draft]);
  const trimmedEntityId = formValidation.ok
    ? formValidation.trimmed.entityId
    : draft.entityId.trim() || null;
  const presence = useMemo(
    () => resolveEntityPresence(entities, trimmedEntityId),
    [entities, trimmedEntityId]
  );
  const clearingDescription =
    formValidation.ok &&
    willClearExistingDescription(presence, formValidation.trimmed.description);
  const clearingImage =
    formValidation.ok && willClearExistingImageUri(presence, formValidation.trimmed.imageReference);

  const clearLoadedData = () => {
    setCurrentRevision(null);
    setEntities([]);
    setEntitiesLoaded(false);
    setEntityThumbById({});
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
    try {
      const [stateResult, entitiesResult] = await Promise.all([
        getCombatDataState(apiBaseUrl, selectedGameId),
        getEntities(apiBaseUrl, selectedGameId)
      ]);

      const rows = entitiesResult.data.data;
      setCurrentRevision(stateResult.data.currentRevision);
      setEntities(rows);
      setEntitiesLoaded(true);

      const thumbs: Record<string, string | null> = {};
      await Promise.all(
        rows.map(async (row) => {
          const uri =
            typeof row.imageUri === 'string' && row.imageUri.trim() !== '' ? row.imageUri : null;
          if (!uri) {
            thumbs[row.entityId] = null;
            return;
          }
          try {
            const cached = await getCachedImage(selectedGameId, uri);
            thumbs[row.entityId] = cached?.image ?? null;
          } catch {
            thumbs[row.entityId] = null;
          }
        })
      );
      setEntityThumbById(thumbs);
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
    setLoadSelectId(undefined);
    setLastResult(null);
    setSaveError(null);
    setImageFieldError(null);
    setSaveNotice(null);
    setLoadError(null);
  }, [selectedGameId]);

  const patchDraft = <K extends keyof EntitySetupFormDraft>(
    key: K,
    value: EntitySetupFormDraft[K]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveError(null);
    setImageFieldError(null);
    setSaveNotice(null);
  };

  const entitySelectOptions = useMemo(
    () =>
      entities.map((entity) =>
        createEntitySelectOption({
          value: entity.entityId,
          primary: entity.displayName,
          secondary: entity.entityId,
          meta: entity.imageUri ?? null,
          imageSrc: entityThumbById[entity.entityId] ?? null,
          showImage: true,
          imageAlt: entity.imageUri ?? entity.displayName
        })
      ),
    [entities, entityThumbById]
  );

  const handleLoadExisting = () => {
    if (!loadSelectId) {
      return;
    }
    const entity = entities.find((item) => item.entityId === loadSelectId);
    if (!entity) {
      setSaveError(`未找到实体「${loadSelectId}」。`);
      return;
    }
    setDraft(populateDraftFromEntity(entity));
    setSaveError(null);
    setImageFieldError(null);
    setSaveNotice(`已加载实体「${entity.entityId}」。图片关联为保留既有（未标记修改）。`);
  };

  const canSave =
    Boolean(selectedGameId) &&
    gamesReachable === true &&
    !loading &&
    !loadError &&
    currentRevision !== null &&
    entitiesLoaded &&
    formValidation.ok &&
    Boolean(adminToken.trim()) &&
    !saving;

  const handleSave = async () => {
    if (!canSave || !selectedGameId || !formValidation.ok) {
      return;
    }

    const token = adminToken.trim();
    if (!token) {
      setSaveError('写入需要 Admin Token。');
      return;
    }

    const body = buildEntityPutBody(formValidation.trimmed);

    setSaving(true);
    setSaveError(null);
    setImageFieldError(null);
    setSaveNotice(null);
    setLastResult(null);
    try {
      const result = await putEntity(
        apiBaseUrl,
        selectedGameId,
        formValidation.trimmed.entityId,
        token,
        body
      );
      const resultImageUri =
        typeof result.data.imageUri === 'string' && result.data.imageUri.trim() !== ''
          ? result.data.imageUri
          : null;
      setCurrentRevision(result.data.currentRevision);
      setLastResult({
        entityId: result.data.entityId,
        displayName: result.data.displayName,
        description:
          typeof result.data.description === 'string' ? result.data.description : '',
        imageUri: resultImageUri,
        currentRevision: result.data.currentRevision
      });
      setSaveNotice(
        `已${presence.mode === 'update' ? '更新' : '创建'}实体「${result.data.entityId}」（revision ${result.data.currentRevision}）。`
      );
      // Keep draft inputs; refresh list for presence / receipt links.
      setReloadTick((value) => value + 1);
    } catch (error) {
      const fieldError = imageUriFieldError(error);
      if (fieldError) {
        setImageFieldError(fieldError);
      }
      setSaveError(formatApiErrorWithDetails(error));
      // 400 /imageUri and 409 keep the whole draft (no reset).
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
    if (!entitiesLoaded) {
      return '实体列表尚未完成读取，保存已禁用。';
    }
    if (!formValidation.ok) {
      return formValidation.reason;
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
        title="实体创建"
        kicker="Entity Setup"
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
          创建或有意更新实体主行（普通单行 PUT：
          <code>{'{ displayName, description }'}</code>
          ，以及可选的 <code>imageUri</code> 三态补丁）。稳定 entityId 由运营手输（如{' '}
          <code>hero_vayne</code> / <code>item_2510</code>
          ），不强制前缀。仅输入已有 ID 不会静默覆盖未加载字段——请用下方「加载已有实体」。图片资产上传见{' '}
          <a href="#/images">#/images</a>；本页保存才会写入战斗数据关联。
        </Typography.Paragraph>

        {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : null}
        {loading ? <Alert type="info" content="正在并发加载 combat-data state 与 entities…" /> : null}
        {loadError ? <Alert type="error" content={loadError} /> : null}

        {selectedGameId && !loading && !loadError ? (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Typography.Text bold>当前 revision：</Typography.Text>{' '}
              <Tag color="arcoblue">{currentRevision ?? '—'}</Tag>
              <Tag color={entitiesLoaded ? 'green' : 'orangered'} style={{ marginLeft: 8 }}>
                entitiesLoaded={String(entitiesLoaded)}
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

            <div className="entity-setup-load-row">
              <label className="entity-setup-load-field" htmlFor="entity-setup-load-select">
                <span>加载已有实体</span>
                <Select
                  id="entity-setup-load-select"
                  showSearch
                  allowClear
                  placeholder="搜索显示名或 entityId"
                  value={loadSelectId}
                  disabled={editsDisabled || entities.length === 0}
                  options={entitySelectOptions}
                  filterOption={filterEntitySelectOption}
                  onChange={(value) => setLoadSelectId(value || undefined)}
                  style={{ width: '100%', maxWidth: 420 }}
                />
              </label>
              <Button
                type="secondary"
                disabled={editsDisabled || !loadSelectId}
                onClick={handleLoadExisting}
              >
                加载到表单
              </Button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>实体 ID</span>
                <Input
                  value={draft.entityId}
                  disabled={editsDisabled}
                  placeholder="例：hero_vayne 或 item_2510"
                  onChange={(value) => patchDraft('entityId', value)}
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
                <span>描述（可选；空白将清空）</span>
                <Input
                  value={draft.description}
                  disabled={editsDisabled}
                  placeholder="描述；留空可清空已有描述"
                  onChange={(value) => patchDraft('description', value)}
                />
              </label>
            </div>

            <div>
              <Typography.Text bold>图片关联（imageUri）</Typography.Text>
              <div style={{ marginTop: 8 }}>
                <CombatDataImageReferenceField
                  value={draft.imageReference}
                  onChange={(next: ImageReferenceEditState) => patchDraft('imageReference', next)}
                  apiBaseUrl={apiBaseUrl}
                  gameId={selectedGameId}
                  adminToken={adminToken}
                  disabled={editsDisabled}
                  error={imageFieldError}
                />
              </div>
            </div>

            {trimmedEntityId && presence.mode === 'update' ? (
              <Alert
                type="info"
                content={`将更新已有实体「${presence.summary.entityId}」。当前 displayName=${presence.summary.displayName}；description=${presence.summary.description || '（空）'}；imageUri=${presence.summary.imageUri || '（空）'}。仅输入 ID 不会覆盖上方未加载字段。`}
              />
            ) : null}
            {trimmedEntityId && presence.mode === 'create' ? (
              <Alert type="success" content={`将创建新实体「${trimmedEntityId}」。`} />
            ) : null}
            {clearingDescription ? (
              <Alert
                type="warning"
                content="当前描述留空：保存后将清空该实体已有 description（后端把空白映射为 null）。若要保留原描述，请先填回。"
              />
            ) : null}
            {clearingImage ? (
              <Alert
                type="warning"
                content="当前图片关联为清除：保存后将清空 imageUri（不会删除 images 资产）。若要保留，请点「恢复为保留既有」。"
              />
            ) : null}

            {!formValidation.ok &&
            (draft.entityId || draft.displayName || draft.description) ? (
              <Alert type="warning" content={formValidation.reason} />
            ) : null}

            {disableReason && !canSave ? (
              <Alert type="info" content={disableReason} />
            ) : null}

            {saveError ? <Alert type="error" content={saveError} /> : null}
            {saveNotice ? <Alert type="success" content={saveNotice} /> : null}

            {lastResult ? (
              <section aria-label="保存结果">
                <Typography.Title heading={6}>保存结果</Typography.Title>
                <Typography.Paragraph style={{ marginTop: 0 }}>
                  entityId={lastResult.entityId} · displayName={lastResult.displayName} ·
                  description={lastResult.description || '（空）'} · imageUri=
                  {lastResult.imageUri || '（空）'} · revision={lastResult.currentRevision}
                </Typography.Paragraph>
                <Typography.Paragraph type="secondary">
                  下一步：
                  <a href="#/images">图片管理</a>
                  {' · '}
                  <a href="#/provider-setup">Provider 创建</a>
                </Typography.Paragraph>
              </section>
            ) : null}

            <Alert
              type="info"
              content={
                <span>
                  下一步：到 <a href="#/provider-setup">#/provider-setup</a> →{' '}
                  <a href="#/entity-provider-mount">#/entity-provider-mount</a> →{' '}
                  <a href="#/ability-setup">#/ability-setup</a> /{' '}
                  <a href="#/direct-damage-ability">#/direct-damage-ability</a>
                  ；实体图片可到 <a href="#/images">#/images</a> 上传后回到本页绑定。
                </span>
              }
            />
          </Space>
        ) : null}
      </Panel>
    </div>
  );
}
