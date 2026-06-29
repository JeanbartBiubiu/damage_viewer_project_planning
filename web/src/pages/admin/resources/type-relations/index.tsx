import { Alert, Message } from '@arco-design/web-react';
import { Panel } from '../../../../components/Panel';
import { getErrorMessage, getTypeRelations, putTypeRelation, replaceTypeRelationsForTarget } from '../../../../services/apiClient';
import { clearTypeCatalogCache } from '../../../../services/typeCatalog';
import type { JsonObject } from '../../../../types/api';
import { parseJsonObjectText, stringifyJson } from '../shared/json';
import { buildTypeRelationReplacePayload } from '../shared/typeRelations';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
import { createTypeRelationsFormData, createTypeRelationsSearchData } from './constants';
import { TypeRelationsModal } from './modal';
import { TypeRelationsSearch } from './search';
import { TypeRelationsTable } from './table';
import type { TypeRelationsFormData, TypeRelationsRecord, TypeRelationsSearchData } from './types';

type TypeRelationsPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

function toTypeRelationsFormData(record: TypeRelationsRecord): TypeRelationsFormData {
  return {
    typeId: String(record.typeId),
    targetCategory: record.targetCategory,
    targetId: record.targetId,
    extendText: stringifyJson(record.extend ?? {})
  };
}

function filterTypeRelations(records: TypeRelationsRecord[], searchData: TypeRelationsSearchData): TypeRelationsRecord[] {
  const typeId = searchData.typeId.trim();
  const targetCategory = searchData.targetCategory.trim().toLowerCase();
  const targetId = searchData.targetId.trim().toLowerCase();

  return records.filter((record) => {
    if (typeId && !String(record.typeId).includes(typeId)) {
      return false;
    }
    if (targetCategory && !record.targetCategory.toLowerCase().includes(targetCategory)) {
      return false;
    }
    if (targetId && !record.targetId.toLowerCase().includes(targetId)) {
      return false;
    }
    return true;
  });
}

async function listTypeRelationsRecords(apiBaseUrl: string, gameId: string, token: string): Promise<TypeRelationsRecord[]> {
  return (await getTypeRelations(apiBaseUrl, gameId, token)).data.typeRelations;
}

async function saveTypeRelationsRecord(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  formData: TypeRelationsFormData
): Promise<TypeRelationsRecord> {
  const payload: JsonObject = {
    typeId: Number(formData.typeId),
    targetCategory: formData.targetCategory.trim(),
    targetId: formData.targetId.trim()
  };

  const extend = parseJsonObjectText(formData.extendText, 'extend');
  if (Object.keys(extend).length > 0) {
    payload.extend = extend;
  }

  return (
    await putTypeRelation(
      apiBaseUrl,
      gameId,
      Number(formData.typeId),
      formData.targetCategory.trim(),
      formData.targetId.trim(),
      token,
      payload
    )
  ).data;
}

export function TypeRelationsPage({ apiBaseUrl, selectedGameId, adminToken }: TypeRelationsPageProps) {
  const actionsDisabled = !selectedGameId || !adminToken.trim();
  const blockerMessage = !selectedGameId
    ? '请先选择当前 gameId。'
    : !adminToken.trim()
      ? '请先在顶部会话区域填写 Admin Token。'
      : null;

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
  } = useCrudResourcePage<TypeRelationsRecord, TypeRelationsSearchData, TypeRelationsFormData>({
    apiBaseUrl,
    selectedGameId,
    adminToken,
    createSearchData: createTypeRelationsSearchData,
    createFormData: createTypeRelationsFormData,
    listRecords: listTypeRelationsRecords,
    saveRecord: saveTypeRelationsRecord,
    filterRecords: filterTypeRelations,
    toFormData: toTypeRelationsFormData,
    getSuccessMessage: (mode) => (mode === 'create' ? '类型挂载新增成功' : '类型挂载保存成功'),
    afterSaveRecord: () => {
      if (selectedGameId) {
        clearTypeCatalogCache(selectedGameId);
      }
    }
  });

  const handleDelete = async (record: TypeRelationsRecord) => {
    if (!selectedGameId || !adminToken.trim()) {
      return;
    }

    const remainingRelationsForTarget = records
      .filter(
        (current) =>
          current.targetCategory === record.targetCategory &&
          current.targetId === record.targetId &&
          current.typeId !== record.typeId
      )
      .map((current) => ({
        typeId: current.typeId,
        extend: current.extend
      }));

    try {
      await replaceTypeRelationsForTarget(
        apiBaseUrl,
        selectedGameId,
        record.targetCategory,
        record.targetId,
        adminToken.trim(),
        buildTypeRelationReplacePayload(remainingRelationsForTarget)
      );
      clearTypeCatalogCache(selectedGameId);
      Message.success('类型挂载删除成功');
      refreshRecords();
    } catch (error) {
      Message.error(getErrorMessage(error));
    }
  };

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}

      <Panel title="查询条件" kicker="Search">
        <TypeRelationsSearch
          searchData={searchData}
          onFieldChange={updateSearchData}
          onSearch={handleSearch}
          onReset={handleResetSearch}
        />
      </Panel>

      <Panel title="类型挂载" kicker="Table">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <TypeRelationsTable
          loading={recordsState === 'loading'}
          records={filteredRecords}
          actionsDisabled={actionsDisabled || saving}
          onView={openViewModal}
          onEdit={openEditModal}
          onDelete={(record) => {
            void handleDelete(record);
          }}
          onCreate={openCreateModal}
          onRefresh={refreshRecords}
        />
      </Panel>

      <TypeRelationsModal
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
