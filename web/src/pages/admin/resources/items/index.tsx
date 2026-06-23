import { Alert, Message } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import { Panel } from '../../../../components/Panel';
import { getErrorMessage, getItems, putImage, putItem, replaceTypeRelationsForTarget } from '../../../../services/apiClient';
import { buildItemImageUri, readImageFileAsDataUrl } from '../../../../services/resourceImage';
import type { JsonObject } from '../../../../types/api';
import { useTypeCatalog } from '../shared/useTypeCatalog';
import { parseJsonStringArrayText, stringifyJson } from '../shared/json';
import { buildTypeRelationReplacePayloadFromIds } from '../shared/typeRelations';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
import { useResourceImageCache } from '../shared/useResourceImageCache';
import { createItemsFormData, createItemsSearchData } from './constants';
import { ItemsModal } from './modal';
import { ItemsSearch } from './search';
import { ItemsTable } from './table';
import { parseStatModifiersStrict } from './statModifiers';
import type { ItemsFormData, ItemsRecord, ItemsSearchData } from './types';

type ItemsPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

function toItemsFormData(record: ItemsRecord): ItemsFormData {
  return {
    itemId: record.itemId,
    name: record.name ?? '',
    goldCost: record.goldCost !== undefined ? String(record.goldCost) : '',
    statModifiersText: stringifyJson(record.statModifiers ?? []),
    skillRefsText: stringifyJson(record.skillRefs ?? []),
    recipeIdsText: stringifyJson(record.recipeIds ?? []),
    selectedTypeIds: [],
    persistedTypeIds: []
  };
}

function filterItems(records: ItemsRecord[], searchData: ItemsSearchData, targetTypeIdsByKey: Map<string, number[]>): ItemsRecord[] {
  const itemId = searchData.itemId.trim().toLowerCase();
  const name = searchData.name.trim().toLowerCase();
  const goldCostText = searchData.goldCost.trim();
  const goldCostValue = goldCostText === '' ? null : Number(goldCostText);

  return records.filter((record) => {
    if (itemId && !record.itemId.toLowerCase().includes(itemId)) {
      return false;
    }
    if (name && !(record.name ?? '').toLowerCase().includes(name)) {
      return false;
    }
    if (goldCostValue !== null) {
      if (!Number.isFinite(goldCostValue)) {
        return false;
      }
      if (Number(record.goldCost ?? NaN) !== goldCostValue) {
        return false;
      }
    }
    if (searchData.typeIds.length > 0) {
      const relatedTypeIds = targetTypeIdsByKey.get(`equipment:${record.itemId}`) ?? [];
      if (!searchData.typeIds.some((typeId) => relatedTypeIds.includes(typeId))) {
        return false;
      }
    }
    return true;
  });
}

async function listItemsRecords(apiBaseUrl: string, gameId: string, token: string): Promise<ItemsRecord[]> {
  return (await getItems(apiBaseUrl, gameId, token)).data.items;
}

async function saveItemsRecord(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  formData: ItemsFormData
): Promise<ItemsRecord> {
  const payload: JsonObject = {
    itemId: formData.itemId.trim()
  };

  if (formData.name.trim()) {
    payload.name = formData.name.trim();
  }
  if (formData.goldCost.trim()) {
    const goldCostNumber = Number(formData.goldCost);
    if (!Number.isFinite(goldCostNumber)) {
      throw new Error('金币成本必须是数字。');
    }
    if (goldCostNumber < 0) {
      throw new Error('金币成本不能为负数。');
    }
    payload.goldCost = goldCostNumber;
  }

  const statModifiers = parseStatModifiersStrict(formData.statModifiersText);
  payload.statModifiers = statModifiers;

  const skillRefs = parseJsonStringArrayText(formData.skillRefsText, 'skillRefs');
  payload.skillRefs = skillRefs;

  const recipeIds = parseJsonStringArrayText(formData.recipeIdsText, 'recipeIds');
  payload.recipeIds = recipeIds;

  const savedItem = (await putItem(apiBaseUrl, gameId, formData.itemId.trim(), token, payload)).data;
  await replaceTypeRelationsForTarget(
    apiBaseUrl,
    gameId,
    'equipment',
    formData.itemId.trim(),
    token,
    buildTypeRelationReplacePayloadFromIds(formData.selectedTypeIds)
  );

  return savedItem;
}

export function ItemsPage({ apiBaseUrl, selectedGameId, adminToken }: ItemsPageProps) {
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
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);

  const {
    records,
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
  } = useCrudResourcePage<ItemsRecord, ItemsSearchData, ItemsFormData>({
    apiBaseUrl,
    selectedGameId,
    adminToken,
    createSearchData: createItemsSearchData,
    createFormData: createItemsFormData,
    listRecords: listItemsRecords,
    saveRecord: saveItemsRecord,
    filterRecords: (recordsToFilter, currentSearchData) => filterItems(recordsToFilter, currentSearchData, targetTypeIdsByKey),
    toFormData: toItemsFormData,
    getSuccessMessage: (mode) => (mode === 'create' ? '装备新增成功' : '装备保存成功'),
    afterSaveRecord: () => {
      refreshTypeCatalog();
    }
  });

  // modal 显隐切换时统一重置图片上传错误，避免散落在各 open/close 入口里。
  useEffect(() => {
    setImageUploadError(null);
  }, [modalVisible]);

  const currentImageUri = buildItemImageUri(formData.itemId);
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
      setImageUploadError('请先填写装备 ID，再上传图片。');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setImageUploadError('仅支持图片文件。');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setImageUploadError('图片大小不能超过 2MB。');
      return;
    }

    try {
      setImageUploading(true);
      setImageUploadError(null);
      const imageBase64 = await readImageFileAsDataUrl(file);
      const response = await putImage(apiBaseUrl, selectedGameId, currentImageUri, adminToken.trim(), imageBase64);
      await upsertImageAsset(response.data);
      Message.success('装备图片上传成功');
    } catch (error) {
      const message = getErrorMessage(error);
      setImageUploadError(message);
      Message.error(message);
    } finally {
      setImageUploading(false);
    }
  };

  const buildTypeFormOverride = (itemId: string): Pick<ItemsFormData, 'persistedTypeIds' | 'selectedTypeIds'> => {
    const persistedTypeIds = targetTypeIdsByKey.get(`equipment:${itemId}`) ?? [];
    return { persistedTypeIds, selectedTypeIds: persistedTypeIds };
  };

  const openViewModalWithTypes = (record: ItemsRecord) => {
    openViewModal(record, buildTypeFormOverride(record.itemId));
  };

  const openEditModalWithTypes = (record: ItemsRecord) => {
    openEditModal(record, buildTypeFormOverride(record.itemId));
  };

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}
      {typeCatalogError ? <Alert type="error" content={typeCatalogError} className="resource-warning-alert" /> : null}
      {imageCacheError ? <Alert type="warning" content={`图片缓存读取失败：${imageCacheError}`} className="resource-warning-alert" /> : null}

      <Panel title="查询条件" kicker="Search">
        <ItemsSearch
          typeDefinitions={types}
          searchData={searchData}
          onFieldChange={updateSearchData}
          onSearch={handleSearch}
          onReset={handleResetSearch}
        />
      </Panel>

      <Panel title="装备" kicker="Table">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <ItemsTable
          loading={recordsState === 'loading'}
          records={filteredRecords}
          actionsDisabled={actionsDisabled}
          onView={openViewModalWithTypes}
          onEdit={openEditModalWithTypes}
          resolveImageSrc={(record) => {
            const imageUri = buildItemImageUri(record.itemId);
            return imageUri ? imageSrcByUri[imageUri] ?? null : null;
          }}
          onCreate={openCreateModal}
          onRefresh={() => {
            refreshRecords();
            refreshTypeCatalog();
            void refreshImageCache();
          }}
        />
      </Panel>

      <ItemsModal
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
        availableItems={records}
        availableItemsLoading={recordsState === 'loading'}
        availableItemsError={recordsError}
        onClose={closeModal}
        onFieldChange={updateFormData}
        onUploadImage={handleUploadImage}
        onSubmit={submitModal}
      />
    </div>
  );
}
