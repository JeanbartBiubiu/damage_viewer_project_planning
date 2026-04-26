import { Alert, Button, Form, Input, InputNumber, Message, Modal, Select, Space, Typography } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import { Panel } from '../../../../components/Panel';
import {
  getAdminProgressionSchema,
  getErrorMessage,
  getHeroes,
  putImage,
  putAdminProgressionSchema,
  putHero,
  replaceTypeRelationsForTarget
} from '../../../../services/apiClient';
import { buildHeroImageUri, readImageFileAsDataUrl } from '../../../../services/resourceImage';
import type { GameProgressionSchema, JsonObject } from '../../../../types/api';
import { useTypeCatalog } from '../shared/useTypeCatalog';
import { parseJsonObjectText, stringifyJson } from '../shared/json';
import { buildTypeRelationReplacePayloadFromIds } from '../shared/typeRelations';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
import { useResourceImageCache } from '../shared/useResourceImageCache';
import { createHeroesFormData, createHeroesSearchData } from './constants';
import { HeroesModal } from './modal';
import { HeroesSearch } from './search';
import { HeroesTable } from './table';
import type { HeroesFormData, HeroesRecord, HeroesSearchData } from './types';

type HeroesPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

const DEFAULT_PROGRESSION_SCHEMA: GameProgressionSchema = {
  progressionKind: 'LEVEL',
  stageMin: 1,
  stageMax: 18,
  stageLabel: 'Lv',
  requireAllStages: true
};

function toHeroesFormData(record: HeroesRecord): HeroesFormData {
  return {
    heroId: record.heroId,
    name: record.name ?? '',
    title: record.title ?? '',
    baseStatsText: stringifyJson(record.baseStats ?? {}),
    statsByLevelText: stringifyJson(record.statsByLevel ?? {}),
    selectedTypeIds: [],
    persistedTypeIds: []
  };
}

function filterHeroes(records: HeroesRecord[], searchData: HeroesSearchData, targetTypeIdsByKey: Map<string, number[]>): HeroesRecord[] {
  const heroId = searchData.heroId.trim().toLowerCase();
  const name = searchData.name.trim().toLowerCase();
  const title = searchData.title.trim().toLowerCase();

  return records.filter((record) => {
    if (heroId && !record.heroId.toLowerCase().includes(heroId)) {
      return false;
    }
    if (name && !(record.name ?? '').toLowerCase().includes(name)) {
      return false;
    }
    if (title && !(record.title ?? '').toLowerCase().includes(title)) {
      return false;
    }
    if (searchData.typeIds.length > 0) {
      const relatedTypeIds = targetTypeIdsByKey.get(`character:${record.heroId}`) ?? [];
      if (!searchData.typeIds.some((typeId) => relatedTypeIds.includes(typeId))) {
        return false;
      }
    }
    return true;
  });
}

async function listHeroesRecords(apiBaseUrl: string, gameId: string, token: string): Promise<HeroesRecord[]> {
  return (await getHeroes(apiBaseUrl, gameId, token)).data.heroes;
}

async function saveHeroesRecord(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  formData: HeroesFormData
): Promise<HeroesRecord> {
  const payload: JsonObject = {
    heroId: formData.heroId.trim()
  };

  if (formData.name.trim()) {
    payload.name = formData.name.trim();
  }
  if (formData.title.trim()) {
    payload.title = formData.title.trim();
  }

  const baseStats = parseJsonObjectText(formData.baseStatsText, 'baseStats');
  payload.baseStats = baseStats;

  const statsByLevel = parseJsonObjectText(formData.statsByLevelText, 'statsByLevel');
  payload.statsByLevel = statsByLevel;

  const savedHero = (await putHero(apiBaseUrl, gameId, formData.heroId.trim(), token, payload)).data;
  await replaceTypeRelationsForTarget(
    apiBaseUrl,
    gameId,
    'character',
    formData.heroId.trim(),
    token,
    buildTypeRelationReplacePayloadFromIds(formData.selectedTypeIds)
  );

  return savedHero;
}

export function HeroesPage({ apiBaseUrl, selectedGameId, adminToken }: HeroesPageProps) {
  const actionsDisabled = !selectedGameId || !adminToken.trim();
  const blockerMessage = !selectedGameId
    ? '请先选择当前 gameId。'
    : !adminToken.trim()
      ? '请先在顶部会话区域填写 Admin Token。'
      : null;

  const { types, targetTypeIdsByKey, error: typeCatalogError, refresh: refreshTypeCatalog } = useTypeCatalog(
    apiBaseUrl,
    selectedGameId,
    adminToken
  );
  const { imageSrcByUri, cacheError: imageCacheError, refreshImageCache, upsertImageAsset } = useResourceImageCache(selectedGameId);
  const [progressionSchema, setProgressionSchema] = useState<GameProgressionSchema>(DEFAULT_PROGRESSION_SCHEMA);
  const [progressionSchemaError, setProgressionSchemaError] = useState<string | null>(null);
  const [progressionSchemaLoading, setProgressionSchemaLoading] = useState(false);
  const [progressionModalVisible, setProgressionModalVisible] = useState(false);
  const [progressionSaving, setProgressionSaving] = useState(false);
  const [progressionFormData, setProgressionFormData] = useState<GameProgressionSchema>(DEFAULT_PROGRESSION_SCHEMA);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);

  const {
    filteredRecords,
    recordsState,
    recordsError,
    searchData,
    modalVisible,
    modalMode,
    formData,
    saving,
    refreshRecords,
    updateSearchData,
    handleSearch,
    handleResetSearch,
    openCreateModal,
    openViewModal,
    openEditModal,
    closeModal,
    updateFormData,
    submitModal
  } = useCrudResourcePage<HeroesRecord, HeroesSearchData, HeroesFormData>({
    apiBaseUrl,
    selectedGameId,
    adminToken,
    createSearchData: createHeroesSearchData,
    createFormData: createHeroesFormData,
    listRecords: listHeroesRecords,
    saveRecord: saveHeroesRecord,
    filterRecords: (recordsToFilter, currentSearchData) => filterHeroes(recordsToFilter, currentSearchData, targetTypeIdsByKey),
    toFormData: toHeroesFormData,
    getSuccessMessage: (mode) => (mode === 'create' ? '英雄新增成功' : '英雄保存成功'),
    afterSaveRecord: () => {
      refreshTypeCatalog();
    }
  });

  const currentImageUri = buildHeroImageUri(formData.heroId);
  const currentImageSrc = currentImageUri ? imageSrcByUri[currentImageUri] ?? null : null;

  const handleUploadImage = async (file: File) => {
    if (!selectedGameId) {
      setImageUploadError('请先选择当前 gameId。');
      return;
    }
    if (!adminToken.trim()) {
      setImageUploadError('请先填写 Admin Token。');
      return;
    }
    if (!currentImageUri) {
      setImageUploadError('请先填写 heroId，再上传图片。');
      return;
    }

    try {
      setImageUploading(true);
      setImageUploadError(null);
      const imageBase64 = await readImageFileAsDataUrl(file);
      const response = await putImage(apiBaseUrl, selectedGameId, currentImageUri, adminToken.trim(), imageBase64);
      await upsertImageAsset(response.data);
      Message.success('英雄图片上传成功');
    } catch (error) {
      const message = getErrorMessage(error);
      setImageUploadError(message);
      Message.error(message);
    } finally {
      setImageUploading(false);
    }
  };

  const refreshProgressionSchema = async () => {
    if (!selectedGameId || !adminToken.trim()) {
      setProgressionSchema(DEFAULT_PROGRESSION_SCHEMA);
      setProgressionSchemaError(null);
      return;
    }
    try {
      setProgressionSchemaLoading(true);
      const response = await getAdminProgressionSchema(apiBaseUrl, selectedGameId, adminToken.trim());
      setProgressionSchema(response.data);
      setProgressionSchemaError(null);
    } catch (error) {
      setProgressionSchema(DEFAULT_PROGRESSION_SCHEMA);
      setProgressionSchemaError(getErrorMessage(error));
    } finally {
      setProgressionSchemaLoading(false);
    }
  };

  useEffect(() => {
    void refreshProgressionSchema();
  }, [apiBaseUrl, selectedGameId, adminToken]);

  const applyHeroTypesToForm = (heroId: string) => {
    const persistedTypeIds = targetTypeIdsByKey.get(`character:${heroId}`) ?? [];
    updateFormData('persistedTypeIds', persistedTypeIds);
    updateFormData('selectedTypeIds', persistedTypeIds);
  };

  const openViewModalWithTypes = (record: HeroesRecord) => {
    setImageUploadError(null);
    openViewModal(record);
    applyHeroTypesToForm(record.heroId);
  };

  const openEditModalWithTypes = (record: HeroesRecord) => {
    setImageUploadError(null);
    openEditModal(record);
    applyHeroTypesToForm(record.heroId);
  };

  const openCreateModalWithTypes = () => {
    setImageUploadError(null);
    openCreateModal();
    updateFormData('persistedTypeIds', []);
    updateFormData('selectedTypeIds', []);
  };

  const closeModalWithImageState = () => {
    setImageUploadError(null);
    closeModal();
  };

  const progressionSummary = `${progressionSchema.progressionKind === 'LEVEL' ? '等级制' : '星级制'} · ${
    progressionSchema.stageLabel
  }${progressionSchema.stageMin} ~ ${progressionSchema.stageLabel}${progressionSchema.stageMax} · ${
    progressionSchema.requireAllStages ? '要求填满全部阶段' : '允许部分阶段'
  }`;

  const openProgressionModal = () => {
    setProgressionFormData(progressionSchema);
    setProgressionModalVisible(true);
  };

  const submitProgressionModal = async () => {
    if (!selectedGameId || !adminToken.trim()) {
      return;
    }
    try {
      setProgressionSaving(true);
      const response = await putAdminProgressionSchema(apiBaseUrl, selectedGameId, adminToken.trim(), progressionFormData);
      setProgressionSchema(response.data);
      setProgressionSchemaError(null);
      setProgressionModalVisible(false);
    } catch (error) {
      setProgressionSchemaError(getErrorMessage(error));
    } finally {
      setProgressionSaving(false);
    }
  };

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}
      {typeCatalogError ? <Alert type="error" content={typeCatalogError} className="resource-warning-alert" /> : null}
      {imageCacheError ? <Alert type="warning" content={`图片缓存读取失败：${imageCacheError}`} className="resource-warning-alert" /> : null}

      <Panel title="阶段配置" kicker="Schema">
        {progressionSchemaError ? <Alert type="warning" content={progressionSchemaError} style={{ marginBottom: 12 }} /> : null}
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text>{progressionSummary}</Typography.Text>
          <Space>
            <Button type="primary" onClick={openProgressionModal} disabled={actionsDisabled || progressionSchemaLoading}>
              编辑阶段配置
            </Button>
            <Button onClick={() => void refreshProgressionSchema()} loading={progressionSchemaLoading} disabled={actionsDisabled}>
              刷新
            </Button>
          </Space>
        </Space>
      </Panel>

      <Panel title="查询条件" kicker="Search">
        <HeroesSearch
          typeDefinitions={types}
          searchData={searchData}
          onFieldChange={updateSearchData}
          onSearch={handleSearch}
          onReset={handleResetSearch}
        />
      </Panel>

      <Panel title="英雄" kicker="Table">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <HeroesTable
          loading={recordsState === 'loading'}
          records={filteredRecords}
          actionsDisabled={actionsDisabled}
          onView={openViewModalWithTypes}
          onEdit={openEditModalWithTypes}
          resolveImageSrc={(record) => {
            const imageUri = buildHeroImageUri(record.heroId);
            return imageUri ? imageSrcByUri[imageUri] ?? null : null;
          }}
          onCreate={openCreateModalWithTypes}
          onRefresh={() => {
            refreshRecords();
            refreshTypeCatalog();
            void refreshImageCache();
          }}
        />
      </Panel>

      <HeroesModal
        typeDefinitions={types}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        visible={modalVisible}
        mode={modalMode}
        formData={formData}
        saving={saving}
        imageUri={currentImageUri}
        imageSrc={currentImageSrc}
        imageUploading={imageUploading}
        imageError={imageUploadError}
        progressionSchema={progressionSchema}
        progressionSchemaError={progressionSchemaError}
        onClose={closeModalWithImageState}
        onFieldChange={updateFormData}
        onUploadImage={handleUploadImage}
        onSubmit={submitModal}
      />

      <Modal
        title="编辑阶段配置"
        visible={progressionModalVisible}
        onCancel={() => setProgressionModalVisible(false)}
        autoFocus={false}
        focusLock
        footer={
          <Space>
            <Button onClick={() => setProgressionModalVisible(false)}>取消</Button>
            <Button type="primary" loading={progressionSaving} onClick={() => void submitProgressionModal()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form layout="vertical">
          <Form.Item label="progressionKind">
            <Select
              value={progressionFormData.progressionKind}
              onChange={(value) =>
                setProgressionFormData((prev) => ({
                  ...prev,
                  progressionKind: value === 'STAR' ? 'STAR' : 'LEVEL'
                }))
              }
            >
              <Select.Option value="LEVEL">LEVEL</Select.Option>
              <Select.Option value="STAR">STAR</Select.Option>
            </Select>
          </Form.Item>
          <div className="crud-form-grid">
            <Form.Item label="stageMin">
              <InputNumber
                style={{ width: '100%' }}
                value={progressionFormData.stageMin}
                onChange={(value) =>
                  setProgressionFormData((prev) => ({
                    ...prev,
                    stageMin: Math.max(1, Number(value ?? 1))
                  }))
                }
              />
            </Form.Item>
            <Form.Item label="stageMax">
              <InputNumber
                style={{ width: '100%' }}
                value={progressionFormData.stageMax}
                onChange={(value) =>
                  setProgressionFormData((prev) => ({
                    ...prev,
                    stageMax: Math.max(prev.stageMin, Number(value ?? prev.stageMin))
                  }))
                }
              />
            </Form.Item>
          </div>
          <Form.Item label="stageLabel">
            <Input
              value={progressionFormData.stageLabel}
              onChange={(value) =>
                setProgressionFormData((prev) => ({
                  ...prev,
                  stageLabel: value
                }))
              }
            />
          </Form.Item>
          <Form.Item label="requireAllStages">
            <Select
              value={progressionFormData.requireAllStages ? 'true' : 'false'}
              onChange={(value) =>
                setProgressionFormData((prev) => ({
                  ...prev,
                  requireAllStages: value === 'true'
                }))
              }
            >
              <Select.Option value="true">是</Select.Option>
              <Select.Option value="false">否</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
