import { Alert } from '@arco-design/web-react';
import { Panel } from '../../../../components/Panel';
import { getItems, putItem } from '../../../../services/apiClient';
import type { JsonObject } from '../../../../types/api';
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
    recipeIdsText: stringifyJson(record.recipeIds ?? [])
  };
}

function filterItems(records: ItemsRecord[], searchData: ItemsSearchData): ItemsRecord[] {
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
  if (Object.keys(statsModifier).length > 0) {
    payload.statsModifier = statsModifier;
  }

  const skillRefs = parseJsonStringArrayText(formData.skillRefsText, 'skillRefs');
  if (skillRefs.length > 0) {
    payload.skillRefs = skillRefs;
  }

  const recipeIds = parseJsonStringArrayText(formData.recipeIdsText, 'recipeIds');
  if (recipeIds.length > 0) {
    payload.recipeIds = recipeIds;
  }

  return (await putItem(apiBaseUrl, gameId, formData.itemId.trim(), token, payload)).data;
}

export function ItemsPage({ apiBaseUrl, selectedGameId, adminToken }: ItemsPageProps) {
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
  } = useCrudResourcePage<ItemsRecord, ItemsSearchData, ItemsFormData>({
    apiBaseUrl,
    selectedGameId,
    adminToken,
    createSearchData: createItemsSearchData,
    createFormData: createItemsFormData,
    listRecords: listItemsRecords,
    saveRecord: saveItemsRecord,
    filterRecords: filterItems,
    toFormData: toItemsFormData,
    getSuccessMessage: (mode) => (mode === 'create' ? '装备新增成功' : '装备保存成功')
  });

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}

      <Panel title="查询条件" kicker="Search">
        <ItemsSearch searchData={searchData} onFieldChange={updateSearchData} onSearch={handleSearch} onReset={handleResetSearch} />
      </Panel>

      <Panel title="装备" kicker="Table">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <ItemsTable
          loading={recordsState === 'loading'}
          records={filteredRecords}
          actionsDisabled={actionsDisabled}
          onView={openViewModal}
          onEdit={openEditModal}
          onCreate={openCreateModal}
          onRefresh={refreshRecords}
        />
      </Panel>

      <ItemsModal
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
