import {
  Alert,
  Button,
  Input,
  Select,
  Space,
  Tag,
  Typography
} from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { CombatDataImageReferencePreview } from '../../../components/CombatDataImageReferenceField';
import {
  createEntitySelectOption,
  filterEntitySelectOption
} from '../../../components/EntitySelectOption';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import {
  formatCombatDataError,
  getAttributeDefinitions,
  getEntities,
  getEntityAttributes,
  getEntityAttributeStages,
  getEntityResources,
  getEntityResourceStages,
  getProgressionSchema,
  getResourceDefinitions,
  putEntityBatch
} from '../../../services/combatDataClient';
import { getCachedImage } from '../../../services/imageCache';
import type {
  AttributeDefinition,
  CombatEntity,
  EntityAttribute,
  EntityAttributeStage,
  EntityResource,
  EntityResourceStage,
  ProgressionSchema,
  ResourceDefinition
} from '../../../types/combatData';
import {
  buildAttributeCurveBatchBody,
  buildLabelledOptions,
  buildResourceCurveBatchBody,
  countFilledAttributeStages,
  countFilledResourceStages,
  ENTITY_GROWTH_STAGE_COUNT,
  evaluateEntityGrowthSchema,
  formatStableLabel,
  isAttributeCurveComplete,
  isResourceCurveComplete,
  materializeAttributeCurve,
  materializeResourceCurve,
  parseNumericInput,
  type AttributeCurveDraft,
  type ResourceCurveDraft
} from './entityGrowthModel';

export type EntityGrowthPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  gamesReachable: boolean;
};

type SaveTarget =
  | { kind: 'attribute'; attrKey: string }
  | { kind: 'resource'; resourceKey: string }
  | null;

function numberToInput(value: number | null): string {
  return value === null ? '' : String(value);
}

async function loadThumbMap(
  gameId: string,
  rows: Array<{ key: string; imageUri?: string | null }>
): Promise<Record<string, string | null>> {
  const thumbs: Record<string, string | null> = {};
  await Promise.all(
    rows.map(async (row) => {
      const uri =
        typeof row.imageUri === 'string' && row.imageUri.trim() !== '' ? row.imageUri : null;
      if (!uri) {
        thumbs[row.key] = null;
        return;
      }
      try {
        const cached = await getCachedImage(gameId, uri);
        thumbs[row.key] = cached?.image ?? null;
      } catch {
        thumbs[row.key] = null;
      }
    })
  );
  return thumbs;
}

export function EntityGrowthPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  gamesReachable
}: EntityGrowthPageProps) {
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [schema, setSchema] = useState<ProgressionSchema | null>(null);
  const [entities, setEntities] = useState<CombatEntity[]>([]);
  const [attrDefs, setAttrDefs] = useState<AttributeDefinition[]>([]);
  const [resourceDefs, setResourceDefs] = useState<ResourceDefinition[]>([]);
  const [entityThumbById, setEntityThumbById] = useState<Record<string, string | null>>({});
  const [attrThumbByKey, setAttrThumbByKey] = useState<Record<string, string | null>>({});

  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [scopedLoading, setScopedLoading] = useState(false);
  const [scopedError, setScopedError] = useState<string | null>(null);
  const [currentRevision, setCurrentRevision] = useState<number | null>(null);

  const [attributeCurves, setAttributeCurves] = useState<AttributeCurveDraft[]>([]);
  const [resourceCurves, setResourceCurves] = useState<ResourceCurveDraft[]>([]);
  const [addAttrKey, setAddAttrKey] = useState<string | undefined>(undefined);
  const [addResourceKey, setAddResourceKey] = useState<string | undefined>(undefined);

  const [saving, setSaving] = useState<SaveTarget>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [revisionConflict, setRevisionConflict] = useState<string | null>(null);
  const [scopedTick, setScopedTick] = useState(0);

  const schemaGate = useMemo(() => evaluateEntityGrowthSchema(schema), [schema]);
  const schemaAllowsEdit = schemaGate.ok && Boolean(selectedGameId);
  const canWrite = schemaAllowsEdit && Boolean(adminToken.trim());

  const selectedEntity = useMemo(
    () => entities.find((item) => item.entityId === selectedEntityId) ?? null,
    [entities, selectedEntityId]
  );

  const entityOptions = useMemo(
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

  const attrDefByKey = useMemo(() => {
    const map = new Map<string, AttributeDefinition>();
    for (const def of attrDefs) {
      map.set(def.attrKey, def);
    }
    return map;
  }, [attrDefs]);

  const resourceDefByKey = useMemo(() => {
    const map = new Map<string, ResourceDefinition>();
    for (const def of resourceDefs) {
      map.set(def.resourceKey, def);
    }
    return map;
  }, [resourceDefs]);

  const attrAddOptions = useMemo(() => {
    const open = new Set(attributeCurves.map((curve) => curve.attrKey));
    return attrDefs
      .filter((def) => !open.has(def.attrKey))
      .map((def) =>
        createEntitySelectOption({
          value: def.attrKey,
          primary: def.attrName?.trim() || def.attrKey,
          secondary: def.attrKey,
          meta: def.imageUri ?? null,
          imageSrc: attrThumbByKey[def.attrKey] ?? null,
          showImage: true,
          imageAlt: def.imageUri ?? def.attrKey
        })
      );
  }, [attrDefs, attributeCurves, attrThumbByKey]);

  const resourceAddOptions = useMemo(() => {
    const open = new Set(resourceCurves.map((curve) => curve.resourceKey));
    return buildLabelledOptions(
      resourceDefs
        .filter((def) => !open.has(def.resourceKey))
        .map((def) => ({ id: def.resourceKey, displayName: def.displayName }))
    );
  }, [resourceDefs, resourceCurves]);

  const loadCatalog = useCallback(async () => {
    if (!selectedGameId) {
      setSchema(null);
      setEntities([]);
      setAttrDefs([]);
      setResourceDefs([]);
      setCatalogError(null);
      return;
    }

    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const [schemaResult, entitiesResult, attrsResult, resourcesResult] = await Promise.all([
        getProgressionSchema(apiBaseUrl, selectedGameId),
        getEntities(apiBaseUrl, selectedGameId),
        getAttributeDefinitions(apiBaseUrl, selectedGameId),
        getResourceDefinitions(apiBaseUrl, selectedGameId)
      ]);
      setSchema(schemaResult.data.data);
      setEntities(entitiesResult.data.data);
      setAttrDefs(attrsResult.data.data);
      setResourceDefs(resourcesResult.data.data);
      setCurrentRevision(schemaResult.data.currentRevision);
      const [entityThumbs, attrThumbs] = await Promise.all([
        loadThumbMap(
          selectedGameId,
          entitiesResult.data.data.map((row) => ({
            key: row.entityId,
            imageUri: row.imageUri
          }))
        ),
        loadThumbMap(
          selectedGameId,
          attrsResult.data.data.map((row) => ({
            key: row.attrKey,
            imageUri: row.imageUri
          }))
        )
      ]);
      setEntityThumbById(entityThumbs);
      setAttrThumbByKey(attrThumbs);
    } catch (error) {
      setSchema(null);
      setEntities([]);
      setAttrDefs([]);
      setResourceDefs([]);
      setEntityThumbById({});
      setAttrThumbByKey({});
      setCatalogError(
        formatCombatDataError(error, 'contract-entry', { apiBaseUrl, gamesReachable })
      );
    } finally {
      setCatalogLoading(false);
    }
  }, [apiBaseUrl, gamesReachable, selectedGameId]);

  const loadScopedEntity = useCallback(async () => {
    if (!selectedGameId || !selectedEntityId || !schemaGate.ok) {
      setAttributeCurves([]);
      setResourceCurves([]);
      setScopedError(null);
      return;
    }

    setScopedLoading(true);
    setScopedError(null);
    try {
      const query = { entityId: selectedEntityId };
      const [attrs, attrStages, resources, resourceStages] = await Promise.all([
        getEntityAttributes(apiBaseUrl, selectedGameId, query),
        getEntityAttributeStages(apiBaseUrl, selectedGameId, query),
        getEntityResources(apiBaseUrl, selectedGameId, query),
        getEntityResourceStages(apiBaseUrl, selectedGameId, query)
      ]);

      setCurrentRevision(attrs.data.currentRevision);

      const attrRows = attrs.data.data as EntityAttribute[];
      const attrStageRows = attrStages.data.data as EntityAttributeStage[];
      const resourceRows = resources.data.data as EntityResource[];
      const resourceStageRows = resourceStages.data.data as EntityResourceStage[];

      const attrKeys = [...new Set(attrRows.map((row) => row.attrKey))].sort();
      setAttributeCurves(
        attrKeys.map((attrKey) =>
          materializeAttributeCurve(
            attrKey,
            attrRows.find((row) => row.attrKey === attrKey),
            attrStageRows.filter((row) => row.attrKey === attrKey)
          )
        )
      );

      const resourceKeys = [...new Set(resourceRows.map((row) => row.resourceKey))].sort();
      setResourceCurves(
        resourceKeys.map((resourceKey) =>
          materializeResourceCurve(
            resourceKey,
            resourceRows.find((row) => row.resourceKey === resourceKey),
            resourceStageRows.filter((row) => row.resourceKey === resourceKey)
          )
        )
      );
    } catch (error) {
      setAttributeCurves([]);
      setResourceCurves([]);
      setScopedError(
        formatCombatDataError(error, 'resource-detail', { apiBaseUrl, gamesReachable })
      );
    } finally {
      setScopedLoading(false);
    }
  }, [apiBaseUrl, gamesReachable, schemaGate.ok, selectedEntityId, selectedGameId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    void loadScopedEntity();
  }, [loadScopedEntity, scopedTick]);

  useEffect(() => {
    setSelectedEntityId(null);
    setAttributeCurves([]);
    setResourceCurves([]);
    setSaveError(null);
    setSaveNotice(null);
    setRevisionConflict(null);
  }, [selectedGameId, apiBaseUrl]);

  const refreshScoped = () => {
    setRevisionConflict(null);
    setSaveError(null);
    setSaveNotice(null);
    setScopedTick((value) => value + 1);
  };

  const updateAttributeCurve = (attrKey: string, next: AttributeCurveDraft) => {
    setAttributeCurves((current) =>
      current.map((curve) => (curve.attrKey === attrKey ? next : curve))
    );
  };

  const updateResourceCurve = (resourceKey: string, next: ResourceCurveDraft) => {
    setResourceCurves((current) =>
      current.map((curve) => (curve.resourceKey === resourceKey ? next : curve))
    );
  };

  const addAttributeCurve = (attrKey: string) => {
    if (!attrKey || attributeCurves.some((curve) => curve.attrKey === attrKey)) {
      return;
    }
    setAttributeCurves((current) => [...current, materializeAttributeCurve(attrKey, undefined, [])]);
    setAddAttrKey(undefined);
  };

  const addResourceCurve = (resourceKey: string) => {
    if (!resourceKey || resourceCurves.some((curve) => curve.resourceKey === resourceKey)) {
      return;
    }
    setResourceCurves((current) => [
      ...current,
      materializeResourceCurve(resourceKey, undefined, [])
    ]);
    setAddResourceKey(undefined);
  };

  const saveAttributeCurve = async (curve: AttributeCurveDraft) => {
    if (!selectedGameId || !selectedEntity || currentRevision === null) {
      return;
    }
    const token = adminToken.trim();
    if (!token) {
      setSaveError('写入需要 Admin Token。');
      return;
    }
    if (!schemaGate.ok) {
      return;
    }

    const body = buildAttributeCurveBatchBody(
      currentRevision,
      {
        displayName: selectedEntity.displayName,
        description: selectedEntity.description,
        imageUri: selectedEntity.imageUri
      },
      curve
    );
    if (!body) {
      setSaveError(`属性 ${formatStableLabel(curve.attrKey, attrDefByKey.get(curve.attrKey)?.attrName)} 曲线不完整：需要 base 与等级 1..18 全部为有效数字。`);
      return;
    }

    setSaving({ kind: 'attribute', attrKey: curve.attrKey });
    setSaveError(null);
    setSaveNotice(null);
    setRevisionConflict(null);
    try {
      const result = await putEntityBatch(apiBaseUrl, selectedGameId, selectedEntity.entityId, token, body);
      setCurrentRevision(result.data.currentRevision);
      setSaveNotice(
        `已保存属性曲线 ${formatStableLabel(curve.attrKey, attrDefByKey.get(curve.attrKey)?.attrName)}（revision ${result.data.currentRevision}）。`
      );
      setScopedTick((value) => value + 1);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409 && error.code === '409.REVISION_CONFLICT') {
        const expected = error.details?.expectedCurrentRevision;
        const actual = error.details?.actualCurrentRevision;
        setRevisionConflict(
          `修订冲突（409.REVISION_CONFLICT）：提交期望 revision=${expected ?? currentRevision}，服务端实际=${actual ?? '未知'}。未写入。请先「刷新实体曲线」同步最新 revision，再重试保存；本地未保存输入已保留。`
        );
      } else {
        setSaveError(getErrorMessage(error));
      }
    } finally {
      setSaving(null);
    }
  };

  const saveResourceCurve = async (curve: ResourceCurveDraft) => {
    if (!selectedGameId || !selectedEntity || currentRevision === null) {
      return;
    }
    const token = adminToken.trim();
    if (!token) {
      setSaveError('写入需要 Admin Token。');
      return;
    }
    if (!schemaGate.ok) {
      return;
    }

    const body = buildResourceCurveBatchBody(
      currentRevision,
      {
        displayName: selectedEntity.displayName,
        description: selectedEntity.description,
        imageUri: selectedEntity.imageUri
      },
      curve
    );
    if (!body) {
      setSaveError(
        `资源 ${formatStableLabel(curve.resourceKey, resourceDefByKey.get(curve.resourceKey)?.displayName)} 曲线不完整：需要 base initial/max 与等级 1..18 全部为有效数字。`
      );
      return;
    }

    setSaving({ kind: 'resource', resourceKey: curve.resourceKey });
    setSaveError(null);
    setSaveNotice(null);
    setRevisionConflict(null);
    try {
      const result = await putEntityBatch(apiBaseUrl, selectedGameId, selectedEntity.entityId, token, body);
      setCurrentRevision(result.data.currentRevision);
      setSaveNotice(
        `已保存资源曲线 ${formatStableLabel(curve.resourceKey, resourceDefByKey.get(curve.resourceKey)?.displayName)}（revision ${result.data.currentRevision}）。`
      );
      setScopedTick((value) => value + 1);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409 && error.code === '409.REVISION_CONFLICT') {
        const expected = error.details?.expectedCurrentRevision;
        const actual = error.details?.actualCurrentRevision;
        setRevisionConflict(
          `修订冲突（409.REVISION_CONFLICT）：提交期望 revision=${expected ?? currentRevision}，服务端实际=${actual ?? '未知'}。未写入。请先「刷新实体曲线」同步最新 revision，再重试保存；本地未保存输入已保留。`
        );
      } else {
        setSaveError(getErrorMessage(error));
      }
    } finally {
      setSaving(null);
    }
  };

  const editsDisabled = !schemaAllowsEdit || scopedLoading || catalogLoading || saving !== null;

  return (
    <div className="page-stack entity-growth-page">
      <Panel
        title="实体等级成长"
        kicker="Entity Level Setup"
        actions={
          <Space>
            <Button loading={catalogLoading} onClick={() => void loadCatalog()} disabled={!selectedGameId}>
              刷新目录
            </Button>
            <Button
              loading={scopedLoading}
              onClick={refreshScoped}
              disabled={!selectedGameId || !selectedEntityId || !schemaGate.ok}
            >
              刷新实体曲线
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          className="resource-warning-alert"
          content={`当前 API：${apiBaseUrl}。本页将整条 LEVEL 1..18 曲线一次提交到 entities/{entityId}:batch；分表页仍可作诊断入口。`}
          style={{ marginBottom: 12 }}
        />

        {!selectedGameId ? (
          <Alert type="warning" content="请先选择游戏。" className="resource-warning-alert" />
        ) : null}
        {!adminToken.trim() ? (
          <Alert
            type="warning"
            content="写入需要 Admin Token（顶部工具栏）。浏览与校验仍可进行。"
            className="resource-warning-alert"
            style={{ marginTop: 8 }}
          />
        ) : null}
        {catalogError ? (
          <Alert type="error" content={catalogError} className="resource-warning-alert" style={{ marginTop: 8 }} />
        ) : null}

        {schemaGate.ok === false ? (
          <Alert
            type="error"
            className="resource-warning-alert"
            style={{ marginTop: 8 }}
            content={
              <span>
                {schemaGate.reason}{' '}
                <a href="#/combat-data/progression-schema">打开成长 Schema（#/combat-data/progression-schema）</a>
              </span>
            }
          />
        ) : (
          <Space wrap size={12} style={{ marginTop: 8 }}>
            <Tag color="arcoblue">LEVEL 1..18</Tag>
            <Tag color="green">currentRevision: {currentRevision ?? '—'}</Tag>
            {selectedEntity ? (
              <Typography.Text type="secondary">
                实体 {formatStableLabel(selectedEntity.entityId, selectedEntity.displayName)}
              </Typography.Text>
            ) : null}
          </Space>
        )}
      </Panel>

      <Panel title="选择实体" kicker="Entity">
        <label className="entity-growth-field" htmlFor="entity-growth-entity">
          <span className="entity-growth-field-label">实体</span>
          <Select
            id="entity-growth-entity"
            showSearch
            allowClear
            placeholder={catalogLoading ? '加载中…' : '按名称或 ID 搜索实体'}
            value={selectedEntityId ?? undefined}
            disabled={!selectedGameId || !schemaGate.ok || catalogLoading}
            options={entityOptions}
            filterOption={filterEntitySelectOption}
            onChange={(value) => {
              setSelectedEntityId(value || null);
              setSaveError(null);
              setSaveNotice(null);
              setRevisionConflict(null);
            }}
            style={{ width: '100%', maxWidth: 480 }}
          />
        </label>
        {selectedEntity ? (
          <div style={{ marginTop: 10 }}>
            <CombatDataImageReferencePreview
              gameId={selectedGameId}
              imageUri={selectedEntity.imageUri}
              size={40}
            />
          </div>
        ) : null}
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          若列表中没有目标实体，请先到 <a href="#/entity-setup">#/entity-setup</a> 创建或更新实体主行。本页不编辑 imageUri；绑定请到实体创建或通用实体表。
        </Typography.Paragraph>
        {scopedError ? (          <Alert type="error" content={scopedError} className="resource-warning-alert" style={{ marginTop: 12 }} />
        ) : null}
        {revisionConflict ? (
          <Alert type="warning" content={revisionConflict} className="resource-warning-alert" style={{ marginTop: 12 }} />
        ) : null}
        {saveError ? (
          <Alert type="error" content={saveError} className="resource-warning-alert" style={{ marginTop: 12 }} />
        ) : null}
        {saveNotice ? (
          <Alert type="success" content={saveNotice} className="resource-warning-alert" style={{ marginTop: 12 }} />
        ) : null}
      </Panel>

      {selectedEntityId && schemaGate.ok ? (
        <>
          <Panel title="属性曲线" kicker="Attributes">
            <div className="entity-growth-add-row">
              <label className="entity-growth-field" htmlFor="entity-growth-add-attr">
                <span className="entity-growth-field-label">添加属性</span>
                <Select
                  id="entity-growth-add-attr"
                  showSearch
                  allowClear
                  placeholder="按名称或 attrKey 搜索"
                  value={addAttrKey}
                  disabled={editsDisabled || attrAddOptions.length === 0}
                  options={attrAddOptions}
                  filterOption={filterEntitySelectOption}
                  onChange={(value) => setAddAttrKey(value || undefined)}
                  style={{ width: '100%', maxWidth: 420 }}
                />
              </label>
              <Button
                type="secondary"
                disabled={editsDisabled || !addAttrKey}
                onClick={() => addAttrKey && addAttributeCurve(addAttrKey)}
              >
                加入工作区
              </Button>
            </div>

            {attributeCurves.length === 0 ? (
              <Typography.Text type="secondary">该实体尚无属性曲线；可通过上方下拉添加。</Typography.Text>
            ) : (
              <div className="entity-growth-curve-list">
                {attributeCurves.map((curve) => {
                  const complete = isAttributeCurveComplete(curve);
                  const filled = countFilledAttributeStages(curve);
                  const label = formatStableLabel(curve.attrKey, attrDefByKey.get(curve.attrKey)?.attrName);
                  const isSaving =
                    saving?.kind === 'attribute' && saving.attrKey === curve.attrKey;
                  return (
                    <section key={curve.attrKey} className="entity-growth-curve" aria-label={`属性 ${label}`}>
                      <header className="entity-growth-curve-head">
                        <div>
                          <Typography.Text bold>{label}</Typography.Text>
                          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                            {complete
                              ? `已完整 ${ENTITY_GROWTH_STAGE_COUNT}/${ENTITY_GROWTH_STAGE_COUNT}`
                              : `缺级 ${filled}/${ENTITY_GROWTH_STAGE_COUNT}`}
                          </Typography.Text>
                        </div>
                        <Button
                          type="primary"
                          size="small"
                          loading={isSaving}
                          disabled={editsDisabled || !complete || !canWrite}
                          onClick={() => void saveAttributeCurve(curve)}
                        >
                          保存曲线
                        </Button>
                      </header>
                      <div className="entity-growth-table-scroll">
                        <table className="entity-growth-table">
                          <thead>
                            <tr>
                              <th scope="col">base</th>
                              {curve.stages.map((cell) => (
                                <th key={cell.stage} scope="col">
                                  L{cell.stage}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>
                                <Input
                                  size="mini"
                                  aria-label={`${label} base`}
                                  value={numberToInput(curve.baseValue)}
                                  disabled={editsDisabled}
                                  onChange={(raw) =>
                                    updateAttributeCurve(curve.attrKey, {
                                      ...curve,
                                      baseValue: parseNumericInput(raw)
                                    })
                                  }
                                />
                              </td>
                              {curve.stages.map((cell, index) => (
                                <td key={cell.stage} className={cell.value === null ? 'is-missing' : 'is-filled'}>
                                  <Input
                                    size="mini"
                                    aria-label={`${label} level ${cell.stage}`}
                                    value={numberToInput(cell.value)}
                                    disabled={editsDisabled}
                                    onChange={(raw) => {
                                      const stages = curve.stages.map((item, i) =>
                                        i === index ? { ...item, value: parseNumericInput(raw) } : item
                                      );
                                      updateAttributeCurve(curve.attrKey, { ...curve, stages });
                                    }}
                                  />
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title="资源曲线" kicker="Resources">
            <div className="entity-growth-add-row">
              <label className="entity-growth-field" htmlFor="entity-growth-add-resource">
                <span className="entity-growth-field-label">添加资源</span>
                <Select
                  id="entity-growth-add-resource"
                  showSearch
                  allowClear
                  placeholder="按名称或 resourceKey 搜索"
                  value={addResourceKey}
                  disabled={editsDisabled || resourceAddOptions.length === 0}
                  options={resourceAddOptions}
                  filterOption={filterEntitySelectOption}
                  onChange={(value) => setAddResourceKey(value || undefined)}
                  style={{ width: '100%', maxWidth: 420 }}
                />
              </label>
              <Button
                type="secondary"
                disabled={editsDisabled || !addResourceKey}
                onClick={() => addResourceKey && addResourceCurve(addResourceKey)}
              >
                加入工作区
              </Button>
            </div>

            {resourceCurves.length === 0 ? (
              <Typography.Text type="secondary">该实体尚无资源曲线；可通过上方下拉添加。</Typography.Text>
            ) : (
              <div className="entity-growth-curve-list">
                {resourceCurves.map((curve) => {
                  const complete = isResourceCurveComplete(curve);
                  const filled = countFilledResourceStages(curve);
                  const label = formatStableLabel(
                    curve.resourceKey,
                    resourceDefByKey.get(curve.resourceKey)?.displayName
                  );
                  const isSaving =
                    saving?.kind === 'resource' && saving.resourceKey === curve.resourceKey;
                  return (
                    <section key={curve.resourceKey} className="entity-growth-curve" aria-label={`资源 ${label}`}>
                      <header className="entity-growth-curve-head">
                        <div>
                          <Typography.Text bold>{label}</Typography.Text>
                          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                            {complete
                              ? `已完整 ${ENTITY_GROWTH_STAGE_COUNT}/${ENTITY_GROWTH_STAGE_COUNT}`
                              : `缺级 ${filled}/${ENTITY_GROWTH_STAGE_COUNT}`}
                          </Typography.Text>
                        </div>
                        <Button
                          type="primary"
                          size="small"
                          loading={isSaving}
                          disabled={editsDisabled || !complete || !canWrite}
                          onClick={() => void saveResourceCurve(curve)}
                        >
                          保存曲线
                        </Button>
                      </header>
                      <div className="entity-growth-table-scroll">
                        <table className="entity-growth-table entity-growth-table--resource">
                          <thead>
                            <tr>
                              <th scope="col">base initial</th>
                              <th scope="col">base max</th>
                              {curve.stages.map((cell) => (
                                <th key={`${cell.stage}-h`} scope="col" colSpan={2}>
                                  L{cell.stage}
                                </th>
                              ))}
                            </tr>
                            <tr>
                              <th scope="col" />
                              <th scope="col" />
                              {curve.stages.flatMap((cell) => [
                                <th key={`${cell.stage}-init`} scope="col" className="entity-growth-subhead">
                                  init
                                </th>,
                                <th key={`${cell.stage}-max`} scope="col" className="entity-growth-subhead">
                                  max
                                </th>
                              ])}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>
                                <Input
                                  size="mini"
                                  aria-label={`${label} base initial`}
                                  value={numberToInput(curve.initialValue)}
                                  disabled={editsDisabled}
                                  onChange={(raw) =>
                                    updateResourceCurve(curve.resourceKey, {
                                      ...curve,
                                      initialValue: parseNumericInput(raw)
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <Input
                                  size="mini"
                                  aria-label={`${label} base max`}
                                  value={numberToInput(curve.maxValue)}
                                  disabled={editsDisabled}
                                  onChange={(raw) =>
                                    updateResourceCurve(curve.resourceKey, {
                                      ...curve,
                                      maxValue: parseNumericInput(raw)
                                    })
                                  }
                                />
                              </td>
                              {curve.stages.flatMap((cell, index) => {
                                const missing = cell.initialValue === null || cell.maxValue === null;
                                return [
                                  <td
                                    key={`${cell.stage}-init-cell`}
                                    className={missing ? 'is-missing' : 'is-filled'}
                                  >
                                    <Input
                                      size="mini"
                                      aria-label={`${label} level ${cell.stage} initial`}
                                      value={numberToInput(cell.initialValue)}
                                      disabled={editsDisabled}
                                      onChange={(raw) => {
                                        const stages = curve.stages.map((item, i) =>
                                          i === index
                                            ? { ...item, initialValue: parseNumericInput(raw) }
                                            : item
                                        );
                                        updateResourceCurve(curve.resourceKey, { ...curve, stages });
                                      }}
                                    />
                                  </td>,
                                  <td
                                    key={`${cell.stage}-max-cell`}
                                    className={missing ? 'is-missing' : 'is-filled'}
                                  >
                                    <Input
                                      size="mini"
                                      aria-label={`${label} level ${cell.stage} max`}
                                      value={numberToInput(cell.maxValue)}
                                      disabled={editsDisabled}
                                      onChange={(raw) => {
                                        const stages = curve.stages.map((item, i) =>
                                          i === index
                                            ? { ...item, maxValue: parseNumericInput(raw) }
                                            : item
                                        );
                                        updateResourceCurve(curve.resourceKey, { ...curve, stages });
                                      }}
                                    />
                                  </td>
                                ];
                              })}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
