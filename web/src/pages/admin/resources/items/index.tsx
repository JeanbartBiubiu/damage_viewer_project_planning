import { Alert, Message } from '@arco-design/web-react';
import { useState } from 'react';
import { Panel } from '../../../../components/Panel';
import { getErrorMessage, getItems, putImage, putItem, replaceTypeRelationsForTarget } from '../../../../services/apiClient';
import { buildItemImageUri, readImageFileAsDataUrl } from '../../../../services/resourceImage';
import type { JsonObject } from '../../../../types/api';
import { useTypeCatalog } from '../shared/useTypeCatalog';
import { parseJsonArrayText, parseJsonStringArrayText, stringifyJson } from '../shared/json';
import { buildTypeRelationReplacePayloadFromIds } from '../shared/typeRelations';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
import { useResourceImageCache } from '../shared/useResourceImageCache';
import { createItemsFormData, createItemsSearchData } from './constants';
import { ItemsModal } from './modal';
import { ItemsSearch } from './search';
import { ItemsTable } from './table';
import type { ItemsFormData, ItemsRecord, ItemsSearchData } from './types';

type ItemsPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

function parseStatModifiersText(text: string): Array<{ attrKey: string; value: number }> {
  const parsed = parseJsonArrayText(text, 'statModifiers');
  const seenAttrKeys = new Set<string>();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`statModifiers[${index}] must be object`);
    }
    const attrKeyRaw = (entry as JsonObject).attrKey;
    const attrKey = typeof attrKeyRaw === 'string' ? attrKeyRaw.trim() : '';
    if (!attrKey) {
      throw new Error(`statModifiers[${index}].attrKey is required`);
    }
    if (seenAttrKeys.has(attrKey)) {
      throw new Error(`statModifiers[${index}].attrKey duplicated: ${attrKey}`);
    }
    seenAttrKeys.add(attrKey);
    const value = Number((entry as JsonObject).value);
    if (!Number.isFinite(value)) {
      throw new Error(`statModifiers[${index}].value must be number`);
    }
    return {
      attrKey,
      value
    };
  });
}

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
  const goldCost = searchData.goldCost.trim();

  return records.filter((record) => {
    if (itemId && !record.itemId.toLowerCase().includes(itemId)) {
      return false;
    }
    if (name && !(record.name ?? '').toLowerCase().includes(name)) {
      return false;
    }
    if (goldCost && String(record.goldCost ?? '') !== goldCost) {
      return false;
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
    payload.goldCost = Number(formData.goldCost);
  }

  const statModifiers = parseStatModifiersText(formData.statModifiersText);
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
      setImageUploadError('请先填写 itemId，再上传图片。');
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

  const applyItemTypesToForm = (itemId: string) => {
    const persistedTypeIds = targetTypeIdsByKey.get(`equipment:${itemId}`) ?? [];
    updateFormData('persistedTypeIds', persistedTypeIds);
    updateFormData('selectedTypeIds', persistedTypeIds);
  };

  const openViewModalWithTypes = (record: ItemsRecord) => {
    setImageUploadError(null);
    openViewModal(record);
    applyItemTypesToForm(record.itemId);
  };

  const openEditModalWithTypes = (record: ItemsRecord) => {
    setImageUploadError(null);
    openEditModal(record);
    applyItemTypesToForm(record.itemId);
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
          onCreate={openCreateModalWithTypes}
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
        onClose={closeModalWithImageState}
        onFieldChange={updateFormData}
        onUploadImage={handleUploadImage}
        onSubmit={submitModal}
      />
    </div>
  );
}
