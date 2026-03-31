import { Alert, Tabs } from '@arco-design/web-react';
import { useMemo, useState } from 'react';
import { Panel } from '../../../../components/Panel';
import { TypesTreeView } from '../../../../components/TypesTreeView';
import { getTypes, putType, putTypeRelation } from '../../../../services/apiClient';
import { useTypeCatalog } from '../shared/useTypeCatalog';
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
    reservedTypeId: record.reservedTypeId !== undefined ? String(record.reservedTypeId) : '',
    parentTypeId: ''
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

  const savedType = (await putType(apiBaseUrl, gameId, Number(formData.typeId), token, payload)).data;

  if (formData.parentTypeId.trim()) {
    await putTypeRelation(apiBaseUrl, gameId, Number(formData.typeId), 'type', formData.parentTypeId.trim(), token, {
      typeId: Number(formData.typeId),
      targetCategory: 'type',
      targetId: formData.parentTypeId.trim()
    });
  }

  return savedType;
}

export function TypesPage({ apiBaseUrl, selectedGameId, adminToken }: TypesPageProps) {
  const [viewMode, setViewMode] = useState<'table' | 'tree'>('table');
  const actionsDisabled = !selectedGameId || !adminToken.trim();
  const blockerMessage = !selectedGameId
    ? '请先选择当前 gameId。'
    : !adminToken.trim()
      ? '请先在顶部会话区域填写 Admin Token。'
      : null;

  const { types, treeRoots, parentTypeIdByChildId, loading: typeCatalogLoading, error: typeCatalogError, refresh: refreshTypeCatalog } =
    useTypeCatalog(apiBaseUrl, selectedGameId, adminToken);

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
    getSuccessMessage: (mode) => (mode === 'create' ? '类型定义新增成功' : '类型定义保存成功'),
    afterSaveRecord: () => {
      refreshTypeCatalog();
    }
  });

  const availableParentTypes = useMemo(
    () => types.filter((type) => !parentTypeIdByChildId.has(type.typeId)),
    [parentTypeIdByChildId, types]
  );

  const openEditModalWithParent = (record: TypesRecord) => {
    openEditModal(record);
    const parentTypeId = parentTypeIdByChildId.get(record.typeId);
    if (parentTypeId) {
      updateFormData('parentTypeId', String(parentTypeId));
    }
  };

  const openViewModalWithParent = (record: TypesRecord) => {
    openViewModal(record);
    const parentTypeId = parentTypeIdByChildId.get(record.typeId);
    if (parentTypeId) {
      updateFormData('parentTypeId', String(parentTypeId));
    }
  };

  const refreshAll = () => {
    refreshRecords();
    refreshTypeCatalog();
  };

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}
      {typeCatalogError ? <Alert type="error" content={typeCatalogError} /> : null}

      <Panel title="查询条件" kicker="Search">
        <TypesSearch searchData={searchData} onFieldChange={updateSearchData} onSearch={handleSearch} onReset={handleResetSearch} />
      </Panel>

      <Panel title="类型定义" kicker="Table">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <Tabs activeTab={viewMode} onChange={(key) => setViewMode(key as 'table' | 'tree')}>
          <Tabs.TabPane key="table" title="表格视图">
            <TypesTable
              loading={recordsState === 'loading'}
              records={filteredRecords}
              actionsDisabled={actionsDisabled}
              onView={openViewModalWithParent}
              onEdit={openEditModalWithParent}
              onCreate={openCreateModal}
              onRefresh={refreshAll}
            />
          </Tabs.TabPane>
          <Tabs.TabPane key="tree" title="树形视图">
            <TypesTreeView
              roots={treeRoots}
              onView={openViewModalWithParent}
              onEdit={openEditModalWithParent}
              emptyText={typeCatalogLoading ? '类型树加载中…' : '暂无类型数据。'}
            />
          </Tabs.TabPane>
        </Tabs>
      </Panel>

      <TypesModal
        availableParentTypes={availableParentTypes.filter((type) => String(type.typeId) !== formData.typeId)}
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
