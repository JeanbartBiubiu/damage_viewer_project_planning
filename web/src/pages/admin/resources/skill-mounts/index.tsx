import { Alert } from '@arco-design/web-react';
import { Panel } from '../../../../components/Panel';
import { getSkillMounts, putSkillMount } from '../../../../services/apiClient';
import type { JsonObject } from '../../../../types/api';
import { parseJsonObjectText, stringifyJson } from '../shared/json';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
import { createSkillMountsFormData, createSkillMountsSearchData } from './constants';
import { SkillMountsModal } from './modal';
import { SkillMountsSearch } from './search';
import { SkillMountsTable } from './table';
import type { SkillMountsFormData, SkillMountsRecord, SkillMountsSearchData } from './types';

type SkillMountsPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

function toSkillMountsFormData(record: SkillMountsRecord): SkillMountsFormData {
  return {
    targetCategory: record.targetCategory,
    targetId: record.targetId,
    skillId: record.skillId,
    enabled: record.enabled !== false,
    extendText: stringifyJson(record.extend ?? {})
  };
}

function filterSkillMounts(records: SkillMountsRecord[], searchData: SkillMountsSearchData): SkillMountsRecord[] {
  const targetCategory = searchData.targetCategory.trim().toLowerCase();
  const targetId = searchData.targetId.trim().toLowerCase();
  const skillId = searchData.skillId.trim().toLowerCase();

  return records.filter((record) => {
    if (targetCategory && !record.targetCategory.toLowerCase().includes(targetCategory)) {
      return false;
    }
    if (targetId && !record.targetId.toLowerCase().includes(targetId)) {
      return false;
    }
    if (skillId && !record.skillId.toLowerCase().includes(skillId)) {
      return false;
    }
    return true;
  });
}

async function listSkillMountsRecords(apiBaseUrl: string, gameId: string, token: string): Promise<SkillMountsRecord[]> {
  return (await getSkillMounts(apiBaseUrl, gameId, token)).data.skillMounts;
}

async function saveSkillMountRecord(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  formData: SkillMountsFormData
): Promise<SkillMountsRecord> {
  const targetCategory = formData.targetCategory.trim();
  const targetId = formData.targetId.trim();
  const skillId = formData.skillId.trim();
  const payload: JsonObject = {
    targetCategory,
    targetId,
    skillId,
    enabled: formData.enabled,
    extend: parseJsonObjectText(formData.extendText, 'extend')
  };

  return (await putSkillMount(apiBaseUrl, gameId, targetCategory, targetId, skillId, token, payload)).data;
}

export function SkillMountsPage({ apiBaseUrl, selectedGameId, adminToken }: SkillMountsPageProps) {
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
  } = useCrudResourcePage<SkillMountsRecord, SkillMountsSearchData, SkillMountsFormData>({
    apiBaseUrl,
    selectedGameId,
    adminToken,
    createSearchData: createSkillMountsSearchData,
    createFormData: createSkillMountsFormData,
    listRecords: listSkillMountsRecords,
    saveRecord: saveSkillMountRecord,
    filterRecords: filterSkillMounts,
    toFormData: toSkillMountsFormData,
    getSuccessMessage: (mode) => (mode === 'create' ? '技能挂载新增成功' : '技能挂载保存成功')
  });

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}

      <Panel title="查询条件" kicker="Search">
        <SkillMountsSearch
          searchData={searchData}
          onFieldChange={updateSearchData}
          onSearch={handleSearch}
          onReset={handleResetSearch}
        />
      </Panel>

      <Panel title="技能挂载" kicker="Table">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <SkillMountsTable
          loading={recordsState === 'loading'}
          records={filteredRecords}
          actionsDisabled={actionsDisabled}
          onView={openViewModal}
          onEdit={openEditModal}
          onCreate={openCreateModal}
          onRefresh={refreshRecords}
        />
      </Panel>

      <SkillMountsModal
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
