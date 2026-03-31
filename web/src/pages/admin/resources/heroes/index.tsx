import { Alert } from '@arco-design/web-react';
import { Panel } from '../../../../components/Panel';
import { getHeroes, putHero, putTypeRelation } from '../../../../services/apiClient';
import type { JsonObject } from '../../../../types/api';
import { useTypeCatalog } from '../shared/useTypeCatalog';
import { parseJsonObjectText, stringifyJson } from '../shared/json';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
import { createHeroesFormData, createHeroesSearchData } from './constants';
import { HeroesModal } from './modal';
import { HeroesSearch } from './search';
import { HeroesTable } from './table';
import type { HeroesFormData, HeroesRecord, HeroesSearchData } from './types';

type HeroesPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

function toHeroesFormData(record: HeroesRecord): HeroesFormData {
  return {
    heroId: record.heroId,
    name: record.name ?? '',
    title: record.title ?? '',
    avatarUrl: record.avatarUrl ?? '',
    baseStatsText: stringifyJson(record.baseStats ?? {}),
    statsByLevelText: stringifyJson(record.statsByLevel ?? {}),
    selectedTypeIds: [],
    persistedTypeIds: []
  };
}

function filterHeroes(records: HeroesRecord[], searchData: HeroesSearchData, targetTypeIdsByKey: Map<string, number[]>): HeroesRecord[] {
  const heroId = searchData.heroId.trim().toLowerCase();
  const name = searchData.name.trim().toLowerCase();
  const title = searchData.title.trim().toLowerCase();

  return records.filter((record) => {
    if (heroId && !record.heroId.toLowerCase().includes(heroId)) {
      return false;
    }
    if (name && !(record.name ?? '').toLowerCase().includes(name)) {
      return false;
    }
    if (title && !(record.title ?? '').toLowerCase().includes(title)) {
      return false;
    }
    if (searchData.typeIds.length > 0) {
      const relatedTypeIds = targetTypeIdsByKey.get(`character:${record.heroId}`) ?? [];
      if (!searchData.typeIds.some((typeId) => relatedTypeIds.includes(typeId))) {
        return false;
      }
    }
    return true;
  });
}

async function listHeroesRecords(apiBaseUrl: string, gameId: string, token: string): Promise<HeroesRecord[]> {
  return (await getHeroes(apiBaseUrl, gameId, token)).data.heroes;
}

async function saveHeroesRecord(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  formData: HeroesFormData
): Promise<HeroesRecord> {
  const payload: JsonObject = {
    heroId: formData.heroId.trim()
  };

  if (formData.name.trim()) {
    payload.name = formData.name.trim();
  }
  if (formData.title.trim()) {
    payload.title = formData.title.trim();
  }
  if (formData.avatarUrl.trim()) {
    payload.avatarUrl = formData.avatarUrl.trim();
  }

  const baseStats = parseJsonObjectText(formData.baseStatsText, 'baseStats');
  payload.baseStats = baseStats;

  const statsByLevel = parseJsonObjectText(formData.statsByLevelText, 'statsByLevel');
  payload.statsByLevel = statsByLevel;

  const savedHero = (await putHero(apiBaseUrl, gameId, formData.heroId.trim(), token, payload)).data;
  const pendingTypeIds = formData.selectedTypeIds.filter((typeId) => !formData.persistedTypeIds.includes(typeId));
  await Promise.all(
    pendingTypeIds.map((typeId) =>
      putTypeRelation(apiBaseUrl, gameId, typeId, 'character', formData.heroId.trim(), token, {
        typeId,
        targetCategory: 'character',
        targetId: formData.heroId.trim()
      })
    )
  );

  return savedHero;
}

export function HeroesPage({ apiBaseUrl, selectedGameId, adminToken }: HeroesPageProps) {
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
  } = useCrudResourcePage<HeroesRecord, HeroesSearchData, HeroesFormData>({
    apiBaseUrl,
    selectedGameId,
    adminToken,
    createSearchData: createHeroesSearchData,
    createFormData: createHeroesFormData,
    listRecords: listHeroesRecords,
    saveRecord: saveHeroesRecord,
    filterRecords: (recordsToFilter, currentSearchData) => filterHeroes(recordsToFilter, currentSearchData, targetTypeIdsByKey),
    toFormData: toHeroesFormData,
    getSuccessMessage: (mode) => (mode === 'create' ? '英雄新增成功' : '英雄保存成功'),
    afterSaveRecord: () => {
      refreshTypeCatalog();
    }
  });

  const applyHeroTypesToForm = (heroId: string) => {
    const persistedTypeIds = targetTypeIdsByKey.get(`character:${heroId}`) ?? [];
    updateFormData('persistedTypeIds', persistedTypeIds);
    updateFormData('selectedTypeIds', persistedTypeIds);
  };

  const openViewModalWithTypes = (record: HeroesRecord) => {
    openViewModal(record);
    applyHeroTypesToForm(record.heroId);
  };

  const openEditModalWithTypes = (record: HeroesRecord) => {
    openEditModal(record);
    applyHeroTypesToForm(record.heroId);
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
        <HeroesSearch
          typeDefinitions={types}
          searchData={searchData}
          onFieldChange={updateSearchData}
          onSearch={handleSearch}
          onReset={handleResetSearch}
        />
      </Panel>

      <Panel title="英雄" kicker="Table">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <HeroesTable
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

      <HeroesModal
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
