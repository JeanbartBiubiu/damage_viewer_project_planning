import { Alert } from '@arco-design/web-react';
import { Panel } from '../../../../components/Panel';
import { getCoefficientBuckets, putCoefficientBucket } from '../../../../services/apiClient';
import type { JsonObject } from '../../../../types/api';
import { parseJsonObjectText, stringifyJson } from '../shared/json';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
import { createCoefficientBucketsFormData, createCoefficientBucketsSearchData } from './constants';
import { CoefficientBucketsModal } from './modal';
import { CoefficientBucketsSearch } from './search';
import { CoefficientBucketsTable } from './table';
import type { CoefficientBucketsFormData, CoefficientBucketsRecord, CoefficientBucketsSearchData } from './types';

type CoefficientBucketsPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

function toCoefficientBucketsFormData(record: CoefficientBucketsRecord): CoefficientBucketsFormData {
  return {
    bucketKey: record.bucketKey,
    resolutionDomain: record.resolutionDomain ?? '',
    stageKey: record.stageKey ?? '',
    targetAttrKey: record.targetAttrKey ?? '',
    aggregationMode: record.aggregationMode ?? '',
    description: record.description ?? '',
    editorHintText: stringifyJson(record.editorHint ?? {}),
    bucketConfigText: stringifyJson(record.bucketConfig ?? {})
  };
}

function filterCoefficientBuckets(
  records: CoefficientBucketsRecord[],
  searchData: CoefficientBucketsSearchData
): CoefficientBucketsRecord[] {
  const bucketKey = searchData.bucketKey.trim().toLowerCase();
  const resolutionDomain = searchData.resolutionDomain.trim().toLowerCase();
  const stageKey = searchData.stageKey.trim().toLowerCase();
  const aggregationMode = searchData.aggregationMode.trim().toLowerCase();

  return records.filter((record) => {
    if (bucketKey && !record.bucketKey.toLowerCase().includes(bucketKey)) {
      return false;
    }
    if (resolutionDomain && !record.resolutionDomain.toLowerCase().includes(resolutionDomain)) {
      return false;
    }
    if (stageKey && !record.stageKey.toLowerCase().includes(stageKey)) {
      return false;
    }
    if (aggregationMode && !record.aggregationMode.toLowerCase().includes(aggregationMode)) {
      return false;
    }
    return true;
  });
}

async function listCoefficientBucketsRecords(apiBaseUrl: string, gameId: string, token: string): Promise<CoefficientBucketsRecord[]> {
  return (await getCoefficientBuckets(apiBaseUrl, gameId, token)).data.coefficientBuckets;
}

async function saveCoefficientBucketsRecord(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  formData: CoefficientBucketsFormData
): Promise<CoefficientBucketsRecord> {
  const payload: JsonObject = {
    bucketKey: formData.bucketKey.trim(),
    resolutionDomain: formData.resolutionDomain.trim(),
    stageKey: formData.stageKey.trim(),
    aggregationMode: formData.aggregationMode.trim()
  };

  if (formData.targetAttrKey.trim()) {
    payload.targetAttrKey = formData.targetAttrKey.trim();
  }

  if (formData.description.trim()) {
    payload.description = formData.description.trim();
  }

  const editorHint = parseJsonObjectText(formData.editorHintText, 'editorHint');
  if (Object.keys(editorHint).length > 0) {
    payload.editorHint = editorHint;
  }

  const bucketConfig = parseJsonObjectText(formData.bucketConfigText, 'bucketConfig');
  if (Object.keys(bucketConfig).length > 0) {
    payload.bucketConfig = bucketConfig;
  }

  return (await putCoefficientBucket(apiBaseUrl, gameId, formData.bucketKey.trim(), token, payload)).data;
}

export function CoefficientBucketsPage({ apiBaseUrl, selectedGameId, adminToken }: CoefficientBucketsPageProps) {
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
  } = useCrudResourcePage<CoefficientBucketsRecord, CoefficientBucketsSearchData, CoefficientBucketsFormData>({
    apiBaseUrl,
    selectedGameId,
    adminToken,
    createSearchData: createCoefficientBucketsSearchData,
    createFormData: createCoefficientBucketsFormData,
    listRecords: listCoefficientBucketsRecords,
    saveRecord: saveCoefficientBucketsRecord,
    filterRecords: filterCoefficientBuckets,
    toFormData: toCoefficientBucketsFormData,
    getSuccessMessage: (mode) => (mode === 'create' ? '乘区桶新增成功' : '乘区桶保存成功')
  });

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}

      <Panel title="查询条件" kicker="Search">
        <CoefficientBucketsSearch
          searchData={searchData}
          onFieldChange={updateSearchData}
          onSearch={handleSearch}
          onReset={handleResetSearch}
        />
      </Panel>

      <Panel title="乘区桶" kicker="Table">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <CoefficientBucketsTable
          loading={recordsState === 'loading'}
          records={filteredRecords}
          actionsDisabled={actionsDisabled}
          onView={openViewModal}
          onEdit={openEditModal}
          onCreate={openCreateModal}
          onRefresh={refreshRecords}
        />
      </Panel>

      <CoefficientBucketsModal
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
