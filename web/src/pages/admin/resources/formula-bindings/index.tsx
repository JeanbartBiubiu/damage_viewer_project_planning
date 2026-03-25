import { Alert } from '@arco-design/web-react';
import { Panel } from '../../../../components/Panel';
import { getFormulaBindings, putFormulaBinding } from '../../../../services/apiClient';
import type { JsonObject } from '../../../../types/api';
import { parseJsonObjectText, stringifyJson } from '../shared/json';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
import { createFormulaBindingsFormData, createFormulaBindingsSearchData } from './constants';
import { FormulaBindingsModal } from './modal';
import { FormulaBindingsSearch } from './search';
import { FormulaBindingsTable } from './table';
import type { FormulaBindingsFormData, FormulaBindingsRecord, FormulaBindingsSearchData } from './types';

type FormulaBindingsPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

function toFormulaBindingsFormData(record: FormulaBindingsRecord): FormulaBindingsFormData {
  return {
    targetCategory: record.targetCategory,
    targetId: record.targetId,
    bindingKey: record.bindingKey,
    formulaId: record.formulaId,
    overrideParamsText: stringifyJson(record.overrideParams ?? {})
  };
}

function filterFormulaBindings(records: FormulaBindingsRecord[], searchData: FormulaBindingsSearchData): FormulaBindingsRecord[] {
  const targetCategory = searchData.targetCategory.trim().toLowerCase();
  const targetId = searchData.targetId.trim().toLowerCase();
  const bindingKey = searchData.bindingKey.trim().toLowerCase();
  const formulaId = searchData.formulaId.trim().toLowerCase();

  return records.filter((record) => {
    if (targetCategory && !record.targetCategory.toLowerCase().includes(targetCategory)) {
      return false;
    }
    if (targetId && !record.targetId.toLowerCase().includes(targetId)) {
      return false;
    }
    if (bindingKey && !record.bindingKey.toLowerCase().includes(bindingKey)) {
      return false;
    }
    if (formulaId && !record.formulaId.toLowerCase().includes(formulaId)) {
      return false;
    }
    return true;
  });
}

async function listFormulaBindingRecords(apiBaseUrl: string, gameId: string, token: string): Promise<FormulaBindingsRecord[]> {
  return (await getFormulaBindings(apiBaseUrl, gameId, token)).data.formulaBindings;
}

async function saveFormulaBindingRecord(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  formData: FormulaBindingsFormData
): Promise<FormulaBindingsRecord> {
  const payload: JsonObject = {
    targetCategory: formData.targetCategory.trim(),
    targetId: formData.targetId.trim(),
    bindingKey: formData.bindingKey.trim(),
    formulaId: formData.formulaId.trim(),
    overrideParams: parseJsonObjectText(formData.overrideParamsText, 'overrideParams')
  };

  return (
    await putFormulaBinding(
      apiBaseUrl,
      gameId,
      formData.targetCategory.trim(),
      formData.targetId.trim(),
      formData.bindingKey.trim(),
      token,
      payload
    )
  ).data;
}

export function FormulaBindingsPage({ apiBaseUrl, selectedGameId, adminToken }: FormulaBindingsPageProps) {
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
  } = useCrudResourcePage<FormulaBindingsRecord, FormulaBindingsSearchData, FormulaBindingsFormData>({
    apiBaseUrl,
    selectedGameId,
    adminToken,
    createSearchData: createFormulaBindingsSearchData,
    createFormData: createFormulaBindingsFormData,
    listRecords: listFormulaBindingRecords,
    saveRecord: saveFormulaBindingRecord,
    filterRecords: filterFormulaBindings,
    toFormData: toFormulaBindingsFormData,
    getSuccessMessage: (mode) => (mode === 'create' ? '公式绑定新增成功' : '公式绑定保存成功')
  });

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}

      <Panel title="查询条件" kicker="Search">
        <FormulaBindingsSearch
          searchData={searchData}
          onFieldChange={updateSearchData}
          onSearch={handleSearch}
          onReset={handleResetSearch}
        />
      </Panel>

      <Panel title="公式绑定" kicker="Table">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <FormulaBindingsTable
          loading={recordsState === 'loading'}
          records={filteredRecords}
          actionsDisabled={actionsDisabled}
          onView={openViewModal}
          onEdit={openEditModal}
          onCreate={openCreateModal}
          onRefresh={refreshRecords}
        />
      </Panel>

      <FormulaBindingsModal
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
