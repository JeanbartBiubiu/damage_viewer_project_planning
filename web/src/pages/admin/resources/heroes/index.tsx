import { Alert } from '@arco-design/web-react';
import { Panel } from '../../../../components/Panel';
import { getHeroes, putHero } from '../../../../services/apiClient';
import type { JsonObject } from '../../../../types/api';
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
    statsByLevelText: stringifyJson(record.statsByLevel ?? {})
  };
}

function filterHeroes(records: HeroesRecord[], searchData: HeroesSearchData): HeroesRecord[] {
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
  if (Object.keys(baseStats).length > 0) {
    payload.baseStats = baseStats;
  }

  const statsByLevel = parseJsonObjectText(formData.statsByLevelText, 'statsByLevel');
  if (Object.keys(statsByLevel).length > 0) {
    payload.statsByLevel = statsByLevel;
  }

  return (await putHero(apiBaseUrl, gameId, formData.heroId.trim(), token, payload)).data;
}

export function HeroesPage({ apiBaseUrl, selectedGameId, adminToken }: HeroesPageProps) {
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
  } = useCrudResourcePage<HeroesRecord, HeroesSearchData, HeroesFormData>({
    apiBaseUrl,
    selectedGameId,
    adminToken,
    createSearchData: createHeroesSearchData,
    createFormData: createHeroesFormData,
    listRecords: listHeroesRecords,
    saveRecord: saveHeroesRecord,
    filterRecords: filterHeroes,
    toFormData: toHeroesFormData,
    getSuccessMessage: (mode) => (mode === 'create' ? '英雄新增成功' : '英雄保存成功')
  });

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}

      <Panel title="查询条件" kicker="Search">
        <HeroesSearch searchData={searchData} onFieldChange={updateSearchData} onSearch={handleSearch} onReset={handleResetSearch} />
      </Panel>

      <Panel title="英雄" kicker="Table">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <HeroesTable
          loading={recordsState === 'loading'}
          records={filteredRecords}
          actionsDisabled={actionsDisabled}
          onView={openViewModal}
          onEdit={openEditModal}
          onCreate={openCreateModal}
          onRefresh={refreshRecords}
        />
      </Panel>

      <HeroesModal
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
