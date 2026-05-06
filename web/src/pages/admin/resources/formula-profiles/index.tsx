import { Alert } from '@arco-design/web-react';
import { useMemo } from 'react';
import { Panel } from '../../../../components/Panel';
import { getFormulaProfiles, putFormulaProfile } from '../../../../services/apiClient';
import type { JsonObject } from '../../../../types/api';
import {
  buildDamageTypeLabelMap,
  buildDamageTypeOptions,
  normalizeDamageTypeValue
} from '../shared/damageTypes';
import { parseJsonObjectText, stringifyJson } from '../shared/json';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
import { useTypeCatalog } from '../shared/useTypeCatalog';
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

const KNOWN_FORMULA_PROFILE_FIELDS = new Set(['formulaId', 'formulaType', 'formulaKind', 'params', 'description', 'updatedAt']);

function extractExtraFormulaProfileFields(record: FormulaProfilesRecord): JsonObject {
  const result: JsonObject = {};
  Object.entries(record).forEach(([key, value]) => {
    if (!KNOWN_FORMULA_PROFILE_FIELDS.has(key)) {
      result[key] = value as JsonObject[string];
    }
  });
  return result;
}

function toFormulaProfilesFormData(record: FormulaProfilesRecord): FormulaProfilesFormData {
  return {
    formulaId: record.formulaId,
    formulaType: record.formulaType ?? '',
    formulaKind: record.formulaKind ?? '',
    damageTypeId: normalizeDamageTypeValue(record.params?.damageTypeId),
    description: record.description ?? '',
    paramsText: stringifyJson(record.params ?? {}),
    extraFieldsText: stringifyJson(extractExtraFormulaProfileFields(record))
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
  const formulaType = formData.formulaType.trim();
  const params = parseJsonObjectText(formData.paramsText, 'params');
  const payload: JsonObject = {
    ...parseJsonObjectText(formData.extraFieldsText, 'extraFields'),
    formulaId: formData.formulaId.trim(),
    formulaType,
    formulaKind: formData.formulaKind.trim(),
    params
  };

  if (formulaType === 'damage') {
    const damageTypeId = Number(formData.damageTypeId);
    if (!Number.isInteger(damageTypeId) || damageTypeId <= 0) {
      throw new Error('damage formulas require a valid damage type');
    }
    params.damageTypeId = damageTypeId;
  } else {
    delete params.damageTypeId;
  }

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
    types,
    loading: typeCatalogLoading,
    error: typeCatalogError,
    parentTypeIdsByChildId
  } = useTypeCatalog(apiBaseUrl, selectedGameId, adminToken);
  const damageTypeOptions = useMemo(
    () => buildDamageTypeOptions(types, parentTypeIdsByChildId),
    [parentTypeIdsByChildId, types]
  );
  const damageTypeLabelMap = useMemo(() => buildDamageTypeLabelMap(damageTypeOptions), [damageTypeOptions]);
  const showDamageTypeWarning =
    Boolean(selectedGameId) &&
    Boolean(adminToken.trim()) &&
    !typeCatalogLoading &&
    !typeCatalogError &&
    damageTypeOptions.length === 0;

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
      {typeCatalogError ? <Alert type="error" content={typeCatalogError} className="resource-warning-alert" /> : null}
      {showDamageTypeWarning ? (
        <Alert
          type="warning"
          content="No damage types found under reserved type 10001. Add game-local damage types there before configuring damage formulas."
          className="resource-warning-alert"
        />
      ) : null}

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
          damageTypeLabelMap={damageTypeLabelMap}
          actionsDisabled={actionsDisabled}
          onView={openViewModal}
          onEdit={openEditModal}
          onCreate={openCreateModal}
          onRefresh={refreshRecords}
        />
      </Panel>

      <FormulaProfilesModal
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        visible={modalVisible}
        mode={modalMode}
        formData={formData}
        damageTypeOptions={damageTypeOptions}
        saving={saving}
        onClose={closeModal}
        onFieldChange={updateFormData}
        onSubmit={submitModal}
      />
    </div>
  );
}
