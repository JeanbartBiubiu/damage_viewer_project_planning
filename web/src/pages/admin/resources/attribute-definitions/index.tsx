import { Alert } from '@arco-design/web-react';
import { Panel } from '../../../../components/Panel';
import { getAttributeDefinitions, putAttributeDefinition } from '../../../../services/apiClient';
import type { JsonObject } from '../../../../types/api';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
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
    attrType: record.attrType ?? '',
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
    attrType: formData.attrType.trim(),
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

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}

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
          onView={openViewModal}
          onEdit={openEditModal}
          onCreate={openCreateModal}
          onRefresh={refreshRecords}
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
        onClose={closeModal}
        onFieldChange={updateFormData}
        onSubmit={submitModal}
      />
    </div>
  );
}
