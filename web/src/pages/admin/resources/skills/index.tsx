import { Alert } from '@arco-design/web-react';
import { useMemo } from 'react';
import {
  createEmptyMechanicsConfig,
  hasDpsPassiveValidationErrors,
  validateDpsPassiveEffects
} from '../../../../components/skill-editor/skillModels';
import { Panel } from '../../../../components/Panel';
import { getSkills, putSkill, replaceTypeRelationsForTarget } from '../../../../services/apiClient';
import type { JsonObject, JsonValue } from '../../../../types/api';
import { buildDamageTypeOptions } from '../shared/damageTypes';
import { useTypeCatalog } from '../shared/useTypeCatalog';
import { parseJsonArrayText, parseJsonObjectText, parseJsonStringArrayText, stringifyJson } from '../shared/json';
import { buildTypeRelationReplacePayloadFromIds } from '../shared/typeRelations';
import { useCrudResourcePage } from '../shared/useCrudResourcePage';
import { createSkillsFormData, createSkillsSearchData } from './constants';
import { SkillsModal } from './modal';
import { SkillsSearch } from './search';
import { SkillsTable } from './table';
import type { SkillsFormData, SkillsRecord, SkillsSearchData } from './types';

type SkillsPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

// 已知的 Skill 顶层字段。新增顶层字段时需同步加入此 Set，否则会被归入 extraFields 透传。
const KNOWN_SKILL_FIELDS = new Set([
  'skillId',
  'ownerType',
  'ownerId',
  'skillKey',
  'name',
  'description',
  'resourceCosts',
  'cooldowns',
  'params',
  'timingProfile',
  'mechanicsConfig',
  'mvpExtensions',
  'notes'
]);

function extractExtraSkillFields(record: SkillsRecord): JsonObject {
  const result: JsonObject = {};
  Object.entries(record).forEach(([key, value]) => {
    if (!KNOWN_SKILL_FIELDS.has(key)) {
      result[key] = value as JsonValue;
    }
  });
  return result;
}

function toSkillsFormData(record: SkillsRecord): SkillsFormData {
  return {
    skillId: record.skillId,
    ownerType: record.ownerType ?? '',
    ownerId: record.ownerId ?? '',
    skillKey: record.skillKey ?? '',
    name: record.name ?? '',
    description: record.description ?? '',
    resourceCostsText: stringifyJson(record.resourceCosts ?? []),
    cooldownsText: stringifyJson(record.cooldowns ?? []),
    paramsText: stringifyJson(record.params ?? {}),
    timingProfileText: stringifyJson(record.timingProfile ?? {}),
    mechanicsConfigText: stringifyJson(record.mechanicsConfig ?? { version: 1, triggers: [] }),
    mvpExtensionsText: stringifyJson((record as JsonObject).mvpExtensions ?? {}),
    notesText: stringifyJson((record as JsonObject).notes ?? []),
    extraFieldsText: stringifyJson(extractExtraSkillFields(record)),
    selectedTypeIds: [],
    persistedTypeIds: []
  };
}

function filterSkills(records: SkillsRecord[], searchData: SkillsSearchData, targetTypeIdsByKey: Map<string, number[]>): SkillsRecord[] {
  const skillId = searchData.skillId.trim().toLowerCase();
  const ownerType = searchData.ownerType.trim().toLowerCase();
  const ownerId = searchData.ownerId.trim().toLowerCase();
  const skillKey = searchData.skillKey.trim().toLowerCase();
  const name = searchData.name.trim().toLowerCase();

  return records.filter((record) => {
    if (skillId && !record.skillId.toLowerCase().includes(skillId)) {
      return false;
    }
    if (ownerType && !(record.ownerType ?? '').toLowerCase().includes(ownerType)) {
      return false;
    }
    if (ownerId && !(record.ownerId ?? '').toLowerCase().includes(ownerId)) {
      return false;
    }
    if (skillKey && !(record.skillKey ?? '').toLowerCase().includes(skillKey)) {
      return false;
    }
    if (name && !(record.name ?? '').toLowerCase().includes(name)) {
      return false;
    }
    if (searchData.typeIds.length > 0) {
      const relatedTypeIds = targetTypeIdsByKey.get(`skill:${record.skillId}`) ?? [];
      if (!searchData.typeIds.some((typeId) => relatedTypeIds.includes(typeId))) {
        return false;
      }
    }
    return true;
  });
}

async function listSkillsRecords(apiBaseUrl: string, gameId: string, token: string): Promise<SkillsRecord[]> {
  return (await getSkills(apiBaseUrl, gameId, token)).data.skills;
}

async function saveSkillsRecord(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  formData: SkillsFormData
): Promise<SkillsRecord> {
  const payload: JsonObject = {
    ...parseJsonObjectText(formData.extraFieldsText, 'extraFields'),
    skillId: formData.skillId.trim(),
    ownerType: formData.ownerType.trim(),
    ownerId: formData.ownerId.trim()
  };

  if (formData.skillKey.trim()) {
    payload.skillKey = formData.skillKey.trim();
  }
  if (formData.name.trim()) {
    payload.name = formData.name.trim();
  }
  if (formData.description.trim()) {
    payload.description = formData.description.trim();
  }

  const resourceCosts = parseJsonArrayText(formData.resourceCostsText, 'resourceCosts');
  payload.resourceCosts = resourceCosts;

  const cooldowns = parseJsonArrayText(formData.cooldownsText, 'cooldowns');
  payload.cooldowns = cooldowns;

  const params = parseJsonObjectText(formData.paramsText, 'params');
  payload.params = params;

  const timingProfile = parseJsonObjectText(formData.timingProfileText, 'timingProfile');
  payload.timingProfile = timingProfile;

  const mechanicsConfigText = formData.mechanicsConfigText.trim() ? formData.mechanicsConfigText : createEmptyMechanicsConfig();
  const mechanicsConfig = parseJsonObjectText(mechanicsConfigText, 'mechanicsConfig');
  const dpsPassiveIssues = validateDpsPassiveEffects(mechanicsConfig);
  if (hasDpsPassiveValidationErrors(dpsPassiveIssues)) {
    const messages = dpsPassiveIssues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('；');
    throw new Error(`mechanicsConfig 校验失败：${messages}`);
  }
  payload.mechanicsConfig = mechanicsConfig;

  const mvpExtensions = parseJsonObjectText(formData.mvpExtensionsText, 'mvpExtensions');
  if (formData.mvpExtensionsText.trim() || Object.keys(mvpExtensions).length > 0) {
    payload.mvpExtensions = mvpExtensions;
  }

  const notes = parseJsonStringArrayText(formData.notesText, 'notes');
  if (formData.notesText.trim() || notes.length > 0) {
    payload.notes = notes;
  }

  const savedSkill = (await putSkill(apiBaseUrl, gameId, formData.skillId.trim(), token, payload)).data;
  await replaceTypeRelationsForTarget(
    apiBaseUrl,
    gameId,
    'skill',
    formData.skillId.trim(),
    token,
    buildTypeRelationReplacePayloadFromIds(formData.selectedTypeIds)
  );

  return savedSkill;
}

export function SkillsPage({ apiBaseUrl, selectedGameId, adminToken }: SkillsPageProps) {
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
    parentTypeIdsByChildId,
    targetTypeIdsByKey,
    refresh: refreshTypeCatalog
  } = useTypeCatalog(
    apiBaseUrl,
    selectedGameId,
    adminToken
  );
  const damageTypeOptions = useMemo(
    () => buildDamageTypeOptions(types, parentTypeIdsByChildId),
    [parentTypeIdsByChildId, types]
  );
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
  } = useCrudResourcePage<SkillsRecord, SkillsSearchData, SkillsFormData>({
    apiBaseUrl,
    selectedGameId,
    adminToken,
    createSearchData: createSkillsSearchData,
    createFormData: createSkillsFormData,
    listRecords: listSkillsRecords,
    saveRecord: saveSkillsRecord,
    filterRecords: (recordsToFilter, currentSearchData) => filterSkills(recordsToFilter, currentSearchData, targetTypeIdsByKey),
    toFormData: toSkillsFormData,
    getSuccessMessage: (mode) => (mode === 'create' ? '技能新增成功' : '技能保存成功'),
    afterSaveRecord: () => {
      refreshTypeCatalog();
    }
  });

  const buildTypeFormOverride = (skillId: string): Pick<SkillsFormData, 'persistedTypeIds' | 'selectedTypeIds'> => {
    const persistedTypeIds = targetTypeIdsByKey.get(`skill:${skillId}`) ?? [];
    return { persistedTypeIds, selectedTypeIds: persistedTypeIds };
  };

  const openViewModalWithTypes = (record: SkillsRecord) => {
    openViewModal(record, buildTypeFormOverride(record.skillId));
  };

  const openEditModalWithTypes = (record: SkillsRecord) => {
    openEditModal(record, buildTypeFormOverride(record.skillId));
  };

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}
      {typeCatalogError ? <Alert type="error" content={typeCatalogError} className="resource-warning-alert" /> : null}
      {showDamageTypeWarning ? (
        <Alert
          type="warning"
          content="未在保留类型 10001 下找到伤害类型。请先添加游戏本地伤害类型，再编辑技能伤害字段。"
          className="resource-warning-alert"
        />
      ) : null}

      <Panel title="查询条件" kicker="Search">
        <SkillsSearch
          typeDefinitions={types}
          searchData={searchData}
          onFieldChange={updateSearchData}
          onSearch={handleSearch}
          onReset={handleResetSearch}
        />
      </Panel>

      <Panel title="技能" kicker="Table">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <SkillsTable
          loading={recordsState === 'loading'}
          records={filteredRecords}
          actionsDisabled={actionsDisabled}
          onView={openViewModalWithTypes}
          onEdit={openEditModalWithTypes}
          onCreate={openCreateModal}
          onRefresh={() => {
            refreshRecords();
            refreshTypeCatalog();
          }}
        />
      </Panel>

      <SkillsModal
        typeDefinitions={types}
        damageTypeOptions={damageTypeOptions}
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
