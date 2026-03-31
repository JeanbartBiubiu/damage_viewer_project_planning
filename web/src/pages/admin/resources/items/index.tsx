import { Alert } from '@arco-design/web-react';
import { Panel } from '../../../../components/Panel';
import { getItems, putItem, putTypeRelation } from '../../../../services/apiClient';
import type { JsonObject } from '../../../../types/api';
import { useTypeCatalog } from '../shared/useTypeCatalog';
import { parseJsonObjectText, parseJsonStringArrayText, stringifyJson } from '../shared/json';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
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

function toItemsFormData(record: ItemsRecord): ItemsFormData {
  return {
    itemId: record.itemId,
    name: record.name ?? '',
    goldCost: record.goldCost !== undefined ? String(record.goldCost) : '',
    iconUrl: record.iconUrl ?? '',
    statsModifierText: stringifyJson(record.statsModifier ?? {}),
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
  if (formData.iconUrl.trim()) {
    payload.iconUrl = formData.iconUrl.trim();
  }

  const statsModifier = parseJsonObjectText(formData.statsModifierText, 'statsModifier');
  payload.statsModifier = statsModifier;

  const skillRefs = parseJsonStringArrayText(formData.skillRefsText, 'skillRefs');
  payload.skillRefs = skillRefs;

  const recipeIds = parseJsonStringArrayText(formData.recipeIdsText, 'recipeIds');
  payload.recipeIds = recipeIds;

  const savedItem = (await putItem(apiBaseUrl, gameId, formData.itemId.trim(), token, payload)).data;
  const pendingTypeIds = formData.selectedTypeIds.filter((typeId) => !formData.persistedTypeIds.includes(typeId));
  await Promise.all(
    pendingTypeIds.map((typeId) =>
      putTypeRelation(apiBaseUrl, gameId, typeId, 'equipment', formData.itemId.trim(), token, {
        typeId,
        targetCategory: 'equipment',
        targetId: formData.itemId.trim()
      })
    )
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

  const applyItemTypesToForm = (itemId: string) => {
    const persistedTypeIds = targetTypeIdsByKey.get(`equipment:${itemId}`) ?? [];
    updateFormData('persistedTypeIds', persistedTypeIds);
    updateFormData('selectedTypeIds', persistedTypeIds);
  };

  const openViewModalWithTypes = (record: ItemsRecord) => {
    openViewModal(record);
    applyItemTypesToForm(record.itemId);
  };

  const openEditModalWithTypes = (record: ItemsRecord) => {
    openEditModal(record);
    applyItemTypesToForm(record.itemId);
  };

  const openCreateModalWithTypes = () => {
    openCreateModal();
    updateFormData('persistedTypeIds', []);
    updateFormData('selectedTypeIds', []);
  };

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}
      {typeCatalogError ? <Alert type="error" content={typeCatalogError} className="resource-warning-alert" /> : null}

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
          onCreate={openCreateModalWithTypes}
          onRefresh={() => {
            refreshRecords();
            refreshTypeCatalog();
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
        onClose={closeModal}
        onFieldChange={updateFormData}
        onSubmit={submitModal}
      />
    </div>
  );
}
