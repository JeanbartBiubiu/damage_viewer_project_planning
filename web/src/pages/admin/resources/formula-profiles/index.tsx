import { Alert } from '@arco-design/web-react';
import { Panel } from '../../../../components/Panel';
import { getFormulaProfiles, putFormulaProfile } from '../../../../services/apiClient';
import type { JsonObject } from '../../../../types/api';
import { parseJsonObjectText, stringifyJson } from '../shared/json';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
import { createFormulaProfilesFormData, createFormulaProfilesSearchData } from './constants';
import { FormulaProfilesModal } from './modal';
import { FormulaProfilesSearch } from './search';
import { FormulaProfilesTable } from './table';
import type { FormulaProfilesFormData, FormulaProfilesRecord, FormulaProfilesSearchData } from './types';

type FormulaProfilesPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

function toFormulaProfilesFormData(record: FormulaProfilesRecord): FormulaProfilesFormData {
  return {
    formulaId: record.formulaId,
    formulaType: record.formulaType ?? '',
    formulaKind: record.formulaKind ?? '',
    description: record.description ?? '',
    paramsText: stringifyJson(record.params ?? {})
  };
}

function filterFormulaProfiles(records: FormulaProfilesRecord[], searchData: FormulaProfilesSearchData): FormulaProfilesRecord[] {
  const formulaId = searchData.formulaId.trim().toLowerCase();
  const formulaType = searchData.formulaType.trim().toLowerCase();
  const formulaKind = searchData.formulaKind.trim().toLowerCase();

  return records.filter((record) => {
    if (formulaId && !record.formulaId.toLowerCase().includes(formulaId)) {
      return false;
    }
    if (formulaType && !(record.formulaType ?? '').toLowerCase().includes(formulaType)) {
      return false;
    }
    if (formulaKind && !(record.formulaKind ?? '').toLowerCase().includes(formulaKind)) {
      return false;
    }
    return true;
  });
}

async function listFormulaProfileRecords(apiBaseUrl: string, gameId: string, token: string): Promise<FormulaProfilesRecord[]> {
  return (await getFormulaProfiles(apiBaseUrl, gameId, token)).data.formulaProfiles;
}

async function saveFormulaProfileRecord(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  formData: FormulaProfilesFormData
): Promise<FormulaProfilesRecord> {
  const payload: JsonObject = {
    formulaId: formData.formulaId.trim(),
    formulaType: formData.formulaType.trim(),
    formulaKind: formData.formulaKind.trim(),
    params: parseJsonObjectText(formData.paramsText, 'params')
  };

  if (formData.description.trim()) {
    payload.description = formData.description.trim();
  }

  return (await putFormulaProfile(apiBaseUrl, gameId, formData.formulaId.trim(), token, payload)).data;
}

export function FormulaProfilesPage({ apiBaseUrl, selectedGameId, adminToken }: FormulaProfilesPageProps) {
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
  } = useCrudResourcePage<FormulaProfilesRecord, FormulaProfilesSearchData, FormulaProfilesFormData>({
    apiBaseUrl,
    selectedGameId,
    adminToken,
    createSearchData: createFormulaProfilesSearchData,
    createFormData: createFormulaProfilesFormData,
    listRecords: listFormulaProfileRecords,
    saveRecord: saveFormulaProfileRecord,
    filterRecords: filterFormulaProfiles,
    toFormData: toFormulaProfilesFormData,
    getSuccessMessage: (mode) => (mode === 'create' ? '公式档案新增成功' : '公式档案保存成功')
  });

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}

      <Panel title="查询条件" kicker="Search">
        <FormulaProfilesSearch
          searchData={searchData}
          onFieldChange={updateSearchData}
          onSearch={handleSearch}
          onReset={handleResetSearch}
        />
      </Panel>

      <Panel title="公式档案" kicker="Table">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <FormulaProfilesTable
          loading={recordsState === 'loading'}
          records={filteredRecords}
          actionsDisabled={actionsDisabled}
          onView={openViewModal}
          onEdit={openEditModal}
          onCreate={openCreateModal}
          onRefresh={refreshRecords}
        />
      </Panel>

      <FormulaProfilesModal
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
