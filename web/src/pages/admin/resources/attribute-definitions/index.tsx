import { Alert, Message } from '@arco-design/web-react';
import { useState } from 'react';
import { Panel } from '../../../../components/Panel';
import { getAttributeDefinitions, getErrorMessage, putAttributeDefinition, putImage } from '../../../../services/apiClient';
import { buildAttributeImageUri, readImageFileAsDataUrl } from '../../../../services/resourceImage';
import type { JsonObject } from '../../../../types/api';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
import { useResourceImageCache } from '../shared/useResourceImageCache';
import { createAttributeDefinitionsFormData, createAttributeDefinitionsSearchData } from './constants';
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
  return {
    attrKey: record.attrKey,
    attrName: record.attrName ?? '',
    attrType: record.attrType ?? 'number',
    defaultValue: record.defaultValue !== undefined ? String(record.defaultValue) : '',
    valueKind: record.valueKind ?? 'scalar',
    rateTargetAttrKey: record.rateTargetAttrKey ?? ''
  };
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
  const payload: JsonObject = {
    attrKey: formData.attrKey.trim(),
    attrName: formData.attrName.trim(),
    attrType: 'number',
    valueKind: formData.valueKind.trim()
  };

  if (formData.defaultValue.trim()) {
    payload.defaultValue = Number(formData.defaultValue);
  }

  if (formData.rateTargetAttrKey.trim()) {
    payload.rateTargetAttrKey = formData.rateTargetAttrKey.trim();
  }

  return (await putAttributeDefinition(apiBaseUrl, gameId, formData.attrKey.trim(), token, payload)).data;
}

export function AttributeDefinitionsPage({ apiBaseUrl, selectedGameId, adminToken }: AttributeDefinitionsPageProps) {
  const actionsDisabled = !selectedGameId || !adminToken.trim();
  const blockerMessage = !selectedGameId
    ? '请先选择当前 gameId。'
    : !adminToken.trim()
      ? '请先在顶部会话区域填写 Admin Token。'
      : null;

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

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}
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
          resolveImageSrc={(record) => {
            const imageUri = buildAttributeImageUri(record.attrKey);
            return imageUri ? imageSrcByUri[imageUri] ?? null : null;
          }}
          onCreate={openCreateModalWithImageState}
          onRefresh={() => {
            refreshRecords();
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
