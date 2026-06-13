import { Alert, Message } from '@arco-design/web-react';
import { useState } from 'react';
import { Panel } from '../../../../components/Panel';
import { findTypeIdByReservedTypeId, RESERVED_TYPE_IDS } from '../../../../config/reservedTypes';
import {
  getAttributeDefinitions,
  getErrorMessage,
  putAttributeDefinition,
  putImage,
  replaceTypeRelationsForTarget
} from '../../../../services/apiClient';
import { buildAttributeImageUri, readImageFileAsDataUrl } from '../../../../services/resourceImage';
import type { JsonObject } from '../../../../types/api';
import { buildTypeRelationReplacePayloadFromIds } from '../shared/typeRelations';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
import { useResourceImageCache } from '../shared/useResourceImageCache';
import { useTypeCatalog } from '../shared/useTypeCatalog';
import {
  collectAttributeBoundsWarnings,
  createAttributeDefinitionsFormData,
  createAttributeDefinitionsSearchData,
  resolveAttributeOrder,
  validateAttributeBoundsForm
} from './constants';
import { AttributeDefinitionsModal } from './modal';
import { AttributeDefinitionsSearch } from './search';
import { AttributeDefinitionsTable } from './table';
import type {
  AttributeDefinitionsFormData,
  AttributeDefinitionsRecord,
  AttributeDefinitionsSearchData
} from './types';

type AttributeDefinitionsPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

function toAttributeDefinitionsFormData(record: AttributeDefinitionsRecord): AttributeDefinitionsFormData {
  const resolvedOrder = resolveAttributeOrder(record);
  const resolvedMinValue = resolveRecordMinValue(record);
  const resolvedMaxValue = resolveRecordMaxValue(record);
  return {
    attrKey: record.attrKey,
    attrName: record.attrName ?? '',
    attrType: record.attrType ?? 'number',
    defaultValue: record.defaultValue !== undefined ? String(record.defaultValue) : '',
    order: resolvedOrder !== undefined ? String(resolvedOrder) : '',
    valueKind: record.valueKind ?? 'scalar',
    rateTargetAttrKey: record.rateTargetAttrKey ?? '',
    hasMinValue: resolvedMinValue !== undefined,
    minValue: resolvedMinValue !== undefined ? String(resolvedMinValue) : '0',
    hasMaxValue: resolvedMaxValue !== undefined,
    maxValue: resolvedMaxValue !== undefined ? String(resolvedMaxValue) : '1'
  };
}

function resolveRecordMinValue(record: AttributeDefinitionsRecord): number | undefined {
  if (record.minValue !== undefined && Number.isFinite(record.minValue)) {
    return record.minValue;
  }
  if (record.hasClampMin === true && record.clampMin !== undefined && Number.isFinite(record.clampMin)) {
    return record.clampMin;
  }
  return undefined;
}

function resolveRecordMaxValue(record: AttributeDefinitionsRecord): number | undefined {
  if (record.maxValue !== undefined && Number.isFinite(record.maxValue)) {
    return record.maxValue;
  }
  if (record.hasClampMax === true && record.clampMax !== undefined && Number.isFinite(record.clampMax)) {
    return record.clampMax;
  }
  return undefined;
}

function filterAttributeDefinitions(
  records: AttributeDefinitionsRecord[],
  searchData: AttributeDefinitionsSearchData
): AttributeDefinitionsRecord[] {
  const attrKey = searchData.attrKey.trim().toLowerCase();
  const attrName = searchData.attrName.trim().toLowerCase();
  const attrType = searchData.attrType.trim().toLowerCase();
  const valueKind = searchData.valueKind.trim().toLowerCase();

  return records.filter((record) => {
    if (attrKey && !record.attrKey.toLowerCase().includes(attrKey)) {
      return false;
    }
    if (attrName && !(record.attrName ?? '').toLowerCase().includes(attrName)) {
      return false;
    }
    if (attrType && !(record.attrType ?? '').toLowerCase().includes(attrType)) {
      return false;
    }
    if (valueKind && !(record.valueKind ?? '').toLowerCase().includes(valueKind)) {
      return false;
    }
    return true;
  });
}

async function listAttributeDefinitionsRecords(
  apiBaseUrl: string,
  gameId: string,
  token: string
): Promise<AttributeDefinitionsRecord[]> {
  return (await getAttributeDefinitions(apiBaseUrl, gameId, token)).data.attributeDefinitions;
}

async function saveAttributeDefinitionsRecord(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  formData: AttributeDefinitionsFormData
): Promise<AttributeDefinitionsRecord> {
  validateAttributeBoundsForm(formData);
  for (const warning of collectAttributeBoundsWarnings(formData)) {
    Message.warning(warning);
  }

  const payload: JsonObject = {
    attrKey: formData.attrKey.trim(),
    attrName: formData.attrName.trim(),
    attrType: 'number',
    valueKind: formData.valueKind.trim(),
    sortOrder: 0
  };

  const parsedOrder = Number(formData.order.trim());
  payload.sortOrder = Number.isFinite(parsedOrder) ? parsedOrder : 0;

  if (formData.defaultValue.trim()) {
    payload.defaultValue = Number(formData.defaultValue);
  }

  if (formData.rateTargetAttrKey.trim()) {
    payload.rateTargetAttrKey = formData.rateTargetAttrKey.trim();
  }

  if (formData.hasMinValue) {
    payload.minValue = Number(formData.minValue.trim());
  }

  if (formData.hasMaxValue) {
    payload.maxValue = Number(formData.maxValue.trim());
  }

  return (await putAttributeDefinition(apiBaseUrl, gameId, formData.attrKey.trim(), token, payload)).data;
}

export function AttributeDefinitionsPage({ apiBaseUrl, selectedGameId, adminToken }: AttributeDefinitionsPageProps) {
  const actionsDisabled = !selectedGameId || !adminToken.trim();
  const token = adminToken.trim();
  const blockerMessage = !selectedGameId
    ? '请先选择当前 gameId。'
    : !token
      ? '请先在顶部会话区域填写 Admin Token。'
      : null;

  const {
    types,
    targetTypeIdsByKey,
    loading: typeCatalogLoading,
    error: typeCatalogError,
    refresh: refreshTypeCatalog
  } = useTypeCatalog(apiBaseUrl, selectedGameId, adminToken);
  const { imageSrcByUri, cacheError: imageCacheError, refreshImageCache, upsertImageAsset } = useResourceImageCache(selectedGameId);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [togglingAttrKey, setTogglingAttrKey] = useState<string | null>(null);
  const growthTypeId = findTypeIdByReservedTypeId(types, RESERVED_TYPE_IDS.ATTRIBUTE_HERO_PROGRESSION);
  const growthTypeMissing = !!selectedGameId && !!token && !typeCatalogLoading && !typeCatalogError && growthTypeId === undefined;

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
  } = useCrudResourcePage<AttributeDefinitionsRecord, AttributeDefinitionsSearchData, AttributeDefinitionsFormData>({
    apiBaseUrl,
    selectedGameId,
    adminToken,
    createSearchData: createAttributeDefinitionsSearchData,
    createFormData: createAttributeDefinitionsFormData,
    listRecords: listAttributeDefinitionsRecords,
    saveRecord: saveAttributeDefinitionsRecord,
    filterRecords: filterAttributeDefinitions,
    toFormData: toAttributeDefinitionsFormData,
    getSuccessMessage: (mode) => (mode === 'create' ? '属性定义新增成功' : '属性定义保存成功')
  });

  const currentImageUri = buildAttributeImageUri(formData.attrKey);
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
      setImageUploadError('请先填写 attrKey，再上传图片。');
      return;
    }

    try {
      setImageUploading(true);
      setImageUploadError(null);
      const imageBase64 = await readImageFileAsDataUrl(file);
      const response = await putImage(apiBaseUrl, selectedGameId, currentImageUri, adminToken.trim(), imageBase64);
      await upsertImageAsset(response.data);
      Message.success('属性图片上传成功');
    } catch (error) {
      const message = getErrorMessage(error);
      setImageUploadError(message);
      Message.error(message);
    } finally {
      setImageUploading(false);
    }
  };

  const openCreateModalWithImageState = () => {
    setImageUploadError(null);
    openCreateModal();
  };

  const openViewModalWithImageState = (record: AttributeDefinitionsRecord) => {
    setImageUploadError(null);
    openViewModal(record);
  };

  const openEditModalWithImageState = (record: AttributeDefinitionsRecord) => {
    setImageUploadError(null);
    openEditModal(record);
  };

  const closeModalWithImageState = () => {
    setImageUploadError(null);
    closeModal();
  };

  const isGrowthAttribute = (record: AttributeDefinitionsRecord): boolean => {
    if (growthTypeId === undefined) {
      return false;
    }
    const typeIds = targetTypeIdsByKey.get(`attribute:${record.attrKey}`) ?? [];
    return typeIds.includes(growthTypeId);
  };

  const handleToggleGrowth = async (record: AttributeDefinitionsRecord) => {
    if (!selectedGameId || !token || growthTypeId === undefined) {
      return;
    }

    const targetKey = `attribute:${record.attrKey}`;
    const currentTypeIds = targetTypeIdsByKey.get(targetKey) ?? [];
    const currentlyGrowth = currentTypeIds.includes(growthTypeId);
    const nextTypeIds = currentlyGrowth
      ? currentTypeIds.filter((typeId) => typeId !== growthTypeId)
      : Array.from(new Set([...currentTypeIds, growthTypeId])).sort((left, right) => left - right);

    try {
      setTogglingAttrKey(record.attrKey);
      await replaceTypeRelationsForTarget(
        apiBaseUrl,
        selectedGameId,
        'attribute',
        record.attrKey,
        token,
        buildTypeRelationReplacePayloadFromIds(nextTypeIds)
      );
      Message.success(currentlyGrowth ? '已切换为非成长属性' : '已切换为成长属性');
      refreshTypeCatalog();
    } catch (error) {
      Message.error(getErrorMessage(error));
    } finally {
      setTogglingAttrKey(null);
    }
  };

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}
      {typeCatalogError ? <Alert type="error" content={typeCatalogError} className="resource-warning-alert" /> : null}
      {growthTypeMissing ? (
        <Alert
          type="warning"
          content="未找到保留类型“人物成长属性”（reservedTypeId=20000），请先在类型定义页完成配置。"
          className="resource-warning-alert"
        />
      ) : null}
      {imageCacheError ? <Alert type="warning" content={`图片缓存读取失败：${imageCacheError}`} className="resource-warning-alert" /> : null}

      <Panel title="查询条件" kicker="Search">
        <AttributeDefinitionsSearch
          searchData={searchData}
          onFieldChange={updateSearchData}
          onSearch={handleSearch}
          onReset={handleResetSearch}
        />
      </Panel>

      <Panel title="属性定义" kicker="Table">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <AttributeDefinitionsTable
          loading={recordsState === 'loading'}
          records={filteredRecords}
          actionsDisabled={actionsDisabled}
          onView={openViewModalWithImageState}
          onEdit={openEditModalWithImageState}
          onToggleGrowth={(record) => void handleToggleGrowth(record)}
          isGrowthAttribute={isGrowthAttribute}
          growthTypeAvailable={growthTypeId !== undefined}
          togglingAttrKey={togglingAttrKey}
          resolveImageSrc={(record) => {
            const imageUri = buildAttributeImageUri(record.attrKey);
            return imageUri ? imageSrcByUri[imageUri] ?? null : null;
          }}
          onCreate={openCreateModalWithImageState}
          onRefresh={() => {
            refreshRecords();
            refreshTypeCatalog();
            void refreshImageCache();
          }}
        />
      </Panel>

      <AttributeDefinitionsModal
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
