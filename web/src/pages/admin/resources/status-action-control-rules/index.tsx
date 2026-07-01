import { Alert } from '@arco-design/web-react';
import { Panel } from '../../../../components/Panel';
import { getStatusActionControlRules, putStatusActionControlRule } from '../../../../services/apiClient';
import type { JsonObject } from '../../../../types/api';
import { parseJsonNumberArrayText, parseJsonObjectText, stringifyJson } from '../shared/json';
import { useTypeCatalog } from '../shared/useTypeCatalog';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
import { createStatusActionControlRulesFormData, createStatusActionControlRulesSearchData } from './constants';
import { StatusActionControlRulesModal } from './modal';
import { StatusActionControlRulesSearch } from './search';
import { StatusActionControlRulesTable } from './table';
import type {
  StatusActionControlRulesFormData,
  StatusActionControlRulesRecord,
  StatusActionControlRulesSearchData
} from './types';

type StatusActionControlRulesPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

function toStatusActionControlRulesFormData(record: StatusActionControlRulesRecord): StatusActionControlRulesFormData {
  return {
    ruleId: record.ruleId,
    statusTypeId: String(record.statusTypeId ?? ''),
    ruleKind: record.ruleKind ?? '',
    actionTypeIdsText: stringifyJson(record.actionTypeIds ?? []),
    actionMatchTypeIdsText: stringifyJson(record.actionMatchTypeIds ?? []),
    interruptPhaseTypeIdsText: stringifyJson(record.interruptPhaseTypeIds ?? []),
    priority: String(record.priority ?? ''),
    description: record.description ?? '',
    extendText: stringifyJson(record.extend ?? {})
  };
}

function filterStatusActionControlRules(
  records: StatusActionControlRulesRecord[],
  searchData: StatusActionControlRulesSearchData
): StatusActionControlRulesRecord[] {
  const ruleId = searchData.ruleId.trim().toLowerCase();
  const statusTypeId = searchData.statusTypeId.trim();
  const ruleKind = searchData.ruleKind.trim().toLowerCase();

  return records.filter((record) => {
    if (ruleId && !record.ruleId.toLowerCase().includes(ruleId)) {
      return false;
    }
    if (statusTypeId && !String(record.statusTypeId).includes(statusTypeId)) {
      return false;
    }
    if (ruleKind && !record.ruleKind.toLowerCase().includes(ruleKind)) {
      return false;
    }
    return true;
  });
}

async function listStatusActionControlRulesRecords(
  apiBaseUrl: string,
  gameId: string,
  token: string
): Promise<StatusActionControlRulesRecord[]> {
  return (await getStatusActionControlRules(apiBaseUrl, gameId, token)).data.statusActionControlRules;
}

async function saveStatusActionControlRulesRecord(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  formData: StatusActionControlRulesFormData
): Promise<StatusActionControlRulesRecord> {
  const payload: JsonObject = {
    ruleId: formData.ruleId.trim(),
    statusTypeId: Number(formData.statusTypeId),
    ruleKind: formData.ruleKind.trim(),
    actionTypeIds: parseJsonNumberArrayText(formData.actionTypeIdsText, 'actionTypeIds'),
    actionMatchTypeIds: parseJsonNumberArrayText(formData.actionMatchTypeIdsText, 'actionMatchTypeIds'),
    interruptPhaseTypeIds: parseJsonNumberArrayText(formData.interruptPhaseTypeIdsText, 'interruptPhaseTypeIds')
  };

  if (formData.priority.trim()) {
    payload.priority = Number(formData.priority);
  }

  if (formData.description.trim()) {
    payload.description = formData.description.trim();
  }

  const extend = parseJsonObjectText(formData.extendText, 'extend');
  if (Object.keys(extend).length > 0) {
    payload.extend = extend;
  }

  return (await putStatusActionControlRule(apiBaseUrl, gameId, formData.ruleId.trim(), token, payload)).data;
}

export function StatusActionControlRulesPage({
  apiBaseUrl,
  selectedGameId,
  adminToken
}: StatusActionControlRulesPageProps) {
  const actionsDisabled = !selectedGameId || !adminToken.trim();
  const blockerMessage = !selectedGameId
    ? '请先选择当前 gameId。'
    : !adminToken.trim()
      ? '请先在顶部会话区域填写 Admin Token。'
      : null;

  const { types, error: typeCatalogError, refresh: refreshTypeCatalog } = useTypeCatalog(
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
  } = useCrudResourcePage<
    StatusActionControlRulesRecord,
    StatusActionControlRulesSearchData,
    StatusActionControlRulesFormData
  >({
    apiBaseUrl,
    selectedGameId,
    adminToken,
    createSearchData: createStatusActionControlRulesSearchData,
    createFormData: createStatusActionControlRulesFormData,
    listRecords: listStatusActionControlRulesRecords,
    saveRecord: saveStatusActionControlRulesRecord,
    filterRecords: filterStatusActionControlRules,
    toFormData: toStatusActionControlRulesFormData,
    getSuccessMessage: (mode) => (mode === 'create' ? '状态动作控制规则新增成功' : '状态动作控制规则保存成功')
  });

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}
      {typeCatalogError ? <Alert type="error" content={typeCatalogError} className="resource-warning-alert" /> : null}

      <Panel title="查询条件" kicker="Search">
        <StatusActionControlRulesSearch
          searchData={searchData}
          onFieldChange={updateSearchData}
          onSearch={handleSearch}
          onReset={handleResetSearch}
        />
      </Panel>

      <Panel title="状态动作控制规则" kicker="Table">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <StatusActionControlRulesTable
          loading={recordsState === 'loading'}
          records={filteredRecords}
          actionsDisabled={actionsDisabled}
          onView={openViewModal}
          onEdit={openEditModal}
          onCreate={openCreateModal}
          onRefresh={() => {
            refreshRecords();
            refreshTypeCatalog();
          }}
        />
      </Panel>

      <StatusActionControlRulesModal
        typeDefinitions={types}
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
