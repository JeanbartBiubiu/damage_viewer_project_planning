import { Alert } from '@arco-design/web-react';
import { Panel } from '../../../../components/Panel';
import { getTypes, putType } from '../../../../services/apiClient';
import type { JsonObject } from '../../../../types/api';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
import { createTypesFormData, createTypesSearchData } from './constants';
import { TypesModal } from './modal';
import { TypesSearch } from './search';
import { TypesTable } from './table';
import type { TypesFormData, TypesRecord, TypesSearchData } from './types';

type TypesPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

function toTypesFormData(record: TypesRecord): TypesFormData {
  return {
    typeId: String(record.typeId),
    name: record.name ?? '',
    description: record.description ?? '',
    reservedTypeId: record.reservedTypeId !== undefined ? String(record.reservedTypeId) : ''
  };
}

function filterTypes(records: TypesRecord[], searchData: TypesSearchData): TypesRecord[] {
  const typeId = searchData.typeId.trim();
  const name = searchData.name.trim().toLowerCase();

  return records.filter((record) => {
    if (typeId && String(record.typeId) !== typeId) {
      return false;
    }
    if (name && !(record.name ?? '').toLowerCase().includes(name)) {
      return false;
    }
    return true;
  });
}

async function listTypesRecords(apiBaseUrl: string, gameId: string, token: string): Promise<TypesRecord[]> {
  return (await getTypes(apiBaseUrl, gameId, token)).data.types;
}

async function saveTypesRecord(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  formData: TypesFormData
): Promise<TypesRecord> {
  const payload: JsonObject = {
    typeId: Number(formData.typeId),
    name: formData.name.trim()
  };

  if (formData.description.trim()) {
    payload.description = formData.description.trim();
  }

  if (formData.reservedTypeId.trim()) {
    payload.reservedTypeId = Number(formData.reservedTypeId);
  }

  return (await putType(apiBaseUrl, gameId, Number(formData.typeId), token, payload)).data;
}

export function TypesPage({ apiBaseUrl, selectedGameId, adminToken }: TypesPageProps) {
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
  } = useCrudResourcePage<TypesRecord, TypesSearchData, TypesFormData>({
    apiBaseUrl,
    selectedGameId,
    adminToken,
    createSearchData: createTypesSearchData,
    createFormData: createTypesFormData,
    listRecords: listTypesRecords,
    saveRecord: saveTypesRecord,
    filterRecords: filterTypes,
    toFormData: toTypesFormData,
    getSuccessMessage: (mode) => (mode === 'create' ? '类型定义新增成功' : '类型定义保存成功')
  });

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}

      <Panel title="查询条件" kicker="Search">
        <TypesSearch searchData={searchData} onFieldChange={updateSearchData} onSearch={handleSearch} onReset={handleResetSearch} />
      </Panel>

      <Panel title="类型定义" kicker="Table">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <TypesTable
          loading={recordsState === 'loading'}
          records={filteredRecords}
          actionsDisabled={actionsDisabled}
          onView={openViewModal}
          onEdit={openEditModal}
          onCreate={openCreateModal}
          onRefresh={refreshRecords}
        />
      </Panel>

      <TypesModal
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
