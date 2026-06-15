import { Alert, Button, Checkbox, Collapse, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildItemCreatorOperationPatch,
  buildItemOwnedDpsPassiveSkillPayload,
  getDpsPassiveTemplateOptions,
  suggestItemOwnedDpsSkillMeta,
  templateRequiresItemCreatorParams,
  type DpsPassiveTemplateId
} from '../../../../components/skill-editor/dpsPassiveTemplates';
import { hasDpsPassiveValidationErrors, validateDpsPassiveEffects } from '../../../../components/skill-editor/skillModels';
import { ResourceImageUploadField } from '../../../../components/ResourceImageUploadField';
import { TypeTagEditor } from '../../../../components/TypeTagEditor';
import { BaseStatsEditor } from '../../../../components/hero-editor/BaseStatsEditor';
import { ItemRecipeSelector } from '../../../../components/item-editor/ItemRecipeSelector';
import { SkillRefSelector, type SkillRefSelectorLoadState } from '../../../../components/item-editor/SkillRefSelector';
import { loadAttributeDefinitions } from '../../../../services/attributeDefinitions';
import { getErrorMessage, putSkill } from '../../../../services/apiClient';
import type { AttributeDefinition, JsonObject, TypeDefinition } from '../../../../types/api';
import { parseJsonArrayText, stringifyJson } from '../shared/json';
import {
  formatItemSkillRefSummaryStatus,
  validateItemSkillRefs
} from './itemSkillRefsValidation';
import type { ItemsFormData } from './types';

type ItemsModalProps = {
  typeDefinitions: TypeDefinition[];
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: ItemsFormData;
  saving: boolean;
  imageUri: string | null;
  imageSrc: string | null;
  imageUploading: boolean;
  imageError?: string | null;
  onClose: () => void;
  onFieldChange: <K extends keyof ItemsFormData>(field: K, value: ItemsFormData[K]) => void;
  onUploadImage: (file: File) => Promise<void>;
  onSubmit: () => Promise<void>;
};

type StatModifierRow = {
  attrKey: string;
  value: number;
};

function parseStatModifierRows(text: string): StatModifierRow[] {
  const parsed = parseJsonArrayText(text, 'statModifiers');
  return parsed
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`statModifiers[${index}] must be object`);
      }
      const attrKey = typeof (entry as JsonObject).attrKey === 'string'
        ? ((entry as JsonObject).attrKey as string).trim()
        : '';
      if (!attrKey) {
        throw new Error(`statModifiers[${index}].attrKey is required`);
      }
      const value = Number((entry as JsonObject).value);
      if (!Number.isFinite(value)) {
        throw new Error(`statModifiers[${index}].value must be number`);
      }
      return { attrKey, value };
    })
    .sort((left, right) => left.attrKey.localeCompare(right.attrKey, 'zh-CN'));
}

function stringifyStatModifierRows(rows: StatModifierRow[]): string {
  const normalized = rows
    .map((row) => ({
      attrKey: row.attrKey.trim(),
      value: Number.isFinite(row.value) ? row.value : 0
    }))
    .filter((row) => row.attrKey.length > 0);
  return stringifyJson(normalized);
}

function parseStringArrayText(text: string, label: string): { value: string[]; error: string | null } {
  try {
    const parsed = JSON.parse(text.trim() || '[]') as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw new Error(`${label} must be string[]`);
    }
    return { value: parsed as string[], error: null };
  } catch (error) {
    return { value: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function ItemDpsPassiveSkillCreator({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  itemId,
  itemName,
  currentSkillRefs,
  readOnly,
  onAppendSkillRef
}: {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  itemId: string;
  itemName: string;
  currentSkillRefs: string[];
  readOnly: boolean;
  onAppendSkillRef: (skillId: string) => void;
}) {
  const templateOptions = useMemo(() => getDpsPassiveTemplateOptions(), []);
  const [selectedTemplateId, setSelectedTemplateId] = useState<DpsPassiveTemplateId>('attacker_on_hit_damage');
  const [skillId, setSkillId] = useState('');
  const [skillKey, setSkillKey] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [thresholdValueText, setThresholdValueText] = useState('');
  const [forceCrit, setForceCrit] = useState(false);
  const [critMultiplierOverrideText, setCritMultiplierOverrideText] = useState('');
  const [critMultiplierScaleText, setCritMultiplierScaleText] = useState('');
  const [bucketKey, setBucketKey] = useState('');

  const canCreate = Boolean(itemId.trim() && selectedGameId && adminToken.trim() && !readOnly);
  const showTemplateParams = templateRequiresItemCreatorParams(selectedTemplateId);

  const creatorParamState = useMemo(
    () => ({
      thresholdValueText,
      forceCrit,
      critMultiplierOverrideText,
      critMultiplierScaleText,
      bucketKey
    }),
    [thresholdValueText, forceCrit, critMultiplierOverrideText, critMultiplierScaleText, bucketKey]
  );

  const operationPatch = useMemo(
    () => buildItemCreatorOperationPatch(selectedTemplateId, creatorParamState),
    [selectedTemplateId, creatorParamState]
  );

  const draftPayload = useMemo(() => {
    const normalizedSkillId = skillId.trim();
    if (!itemId.trim() || !normalizedSkillId) {
      return null;
    }
    return buildItemOwnedDpsPassiveSkillPayload({
      itemId: itemId.trim(),
      skillId: normalizedSkillId,
      skillKey: skillKey.trim() || normalizedSkillId,
      name: name.trim() || normalizedSkillId,
      templateId: selectedTemplateId,
      operationPatch
    });
  }, [itemId, skillId, skillKey, name, selectedTemplateId, operationPatch]);

  const draftValidationIssues = useMemo(() => {
    const mechanicsConfig = draftPayload?.mechanicsConfig;
    if (!mechanicsConfig || typeof mechanicsConfig !== 'object' || Array.isArray(mechanicsConfig)) {
      return [];
    }
    return validateDpsPassiveEffects(mechanicsConfig as JsonObject);
  }, [draftPayload]);

  const draftValidationErrors = useMemo(
    () => draftValidationIssues.filter((issue) => issue.severity === 'error'),
    [draftValidationIssues]
  );
  const draftValidationWarnings = useMemo(
    () => draftValidationIssues.filter((issue) => issue.severity === 'warning'),
    [draftValidationIssues]
  );
  const createBlockedByValidation = draftValidationErrors.length > 0;

  useEffect(() => {
    const suggested = suggestItemOwnedDpsSkillMeta(itemId, selectedTemplateId, itemName);
    setSkillId(suggested.skillId);
    setSkillKey(suggested.skillKey);
    setName(suggested.name);
    setThresholdValueText('');
    setForceCrit(false);
    setCritMultiplierOverrideText('');
    setCritMultiplierScaleText('');
    setBucketKey('');
    setError(null);
    setSuccess(null);
  }, [itemId, itemName, selectedTemplateId]);

  const handleCreate = async () => {
    if (!canCreate || !selectedGameId || createBlockedByValidation) {
      return;
    }
    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      const normalizedSkillId = skillId.trim();
      if (!normalizedSkillId) {
        throw new Error('skillId 不能为空。');
      }
      const payload = buildItemOwnedDpsPassiveSkillPayload({
        itemId: itemId.trim(),
        skillId: normalizedSkillId,
        skillKey: skillKey.trim() || normalizedSkillId,
        name: name.trim() || normalizedSkillId,
        templateId: selectedTemplateId,
        operationPatch
      });
      const mechanicsConfig = payload.mechanicsConfig;
      if (!mechanicsConfig || typeof mechanicsConfig !== 'object' || Array.isArray(mechanicsConfig)) {
        throw new Error('生成的 mechanicsConfig 无效。');
      }
      const validationIssues = validateDpsPassiveEffects(mechanicsConfig as JsonObject);
      if (hasDpsPassiveValidationErrors(validationIssues)) {
        const messages = validationIssues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('；');
        throw new Error(`DPS passive 校验失败：${messages}`);
      }
      await putSkill(apiBaseUrl, selectedGameId, normalizedSkillId, adminToken.trim(), payload);
      onAppendSkillRef(normalizedSkillId);
      setSuccess(`已创建 skill ${normalizedSkillId} 并加入 skillRefs 草稿；请点击 Save 保存 item。`);
    } catch (createError) {
      setError(getErrorMessage(createError));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ border: '1px dashed var(--color-border-3)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Typography.Text bold style={{ fontSize: 12 }}>
          从 DPS 模板创建 item-owned skill
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          仅创建 skill 并回填 skillRefs 草稿，不会自动保存 item。数值字段为模板草稿，需在 skill 页确认。
        </Typography.Text>
        {!itemId.trim() ? (
          <Alert type="warning" content="请先填写 itemId。" />
        ) : null}
        {!selectedGameId || !adminToken.trim() ? (
          <Alert type="warning" content="需要 selectedGameId 与 admin token。" />
        ) : null}
        <div className="crud-form-grid">
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
              DPS passive 模板
            </Typography.Text>
            <Select
              value={selectedTemplateId}
              disabled={!canCreate}
              options={templateOptions}
              onChange={(value) => setSelectedTemplateId(String(value) as DpsPassiveTemplateId)}
            />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
              skillId
            </Typography.Text>
            <Input value={skillId} disabled={!canCreate} onChange={setSkillId} />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
              skillKey
            </Typography.Text>
            <Input value={skillKey} disabled={!canCreate} onChange={setSkillKey} />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
              name
            </Typography.Text>
            <Input value={name} disabled={!canCreate} onChange={setName} />
          </div>
        </div>
        {showTemplateParams ? (
          <div style={{ border: '1px solid var(--color-border-2)', borderRadius: 6, padding: 10 }}>
            <Typography.Text bold style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
              模板必填参数
            </Typography.Text>
            {selectedTemplateId === 'attacker_execute_threshold' ? (
              <div>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                  thresholdValue（必填，无默认值）
                </Typography.Text>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  value={thresholdValueText.trim() ? Number(thresholdValueText) : undefined}
                  disabled={!canCreate}
                  placeholder="例如 0.05"
                  onChange={(value) => setThresholdValueText(value === undefined || value === null ? '' : String(value))}
                />
              </div>
            ) : null}
            {selectedTemplateId === 'attacker_crit_context_modifier' ? (
              <div className="crud-form-grid">
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <Checkbox checked={forceCrit} disabled={!canCreate} onChange={setForceCrit}>
                    forceCrit
                  </Checkbox>
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    critMultiplierOverride
                  </Typography.Text>
                  <InputNumber
                    style={{ width: '100%' }}
                    value={critMultiplierOverrideText.trim() ? Number(critMultiplierOverrideText) : undefined}
                    disabled={!canCreate}
                    placeholder="未设置"
                    onChange={(value) => {
                      setCritMultiplierOverrideText(value === undefined || value === null ? '' : String(value));
                      if (value !== undefined && value !== null) {
                        setCritMultiplierScaleText('');
                      }
                    }}
                  />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    critMultiplierScale
                  </Typography.Text>
                  <InputNumber
                    style={{ width: '100%' }}
                    value={critMultiplierScaleText.trim() ? Number(critMultiplierScaleText) : undefined}
                    disabled={!canCreate}
                    placeholder="未设置"
                    onChange={(value) => {
                      setCritMultiplierScaleText(value === undefined || value === null ? '' : String(value));
                      if (value !== undefined && value !== null) {
                        setCritMultiplierOverrideText('');
                      }
                    }}
                  />
                </div>
              </div>
            ) : null}
            {selectedTemplateId === 'bucket_damage_modifier' ? (
              <div>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                  bucketKey（必填，无默认值）
                </Typography.Text>
                <Input
                  value={bucketKey}
                  disabled={!canCreate}
                  placeholder="填写乘区 bucketKey"
                  onChange={setBucketKey}
                />
              </div>
            ) : null}
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              {selectedTemplateId === 'attacker_execute_threshold'
                ? 'thresholdValue 必须由数据来源确认后填写；未填时无法创建。'
                : selectedTemplateId === 'attacker_crit_context_modifier'
                  ? 'forceCrit、critMultiplierOverride、critMultiplierScale 至少填写一项有效值后方可创建；override 与 scale 不可同时填写。'
                  : 'bucketKey 必须显式填写；未填时无法创建。'}
            </Typography.Text>
          </div>
        ) : null}
        {draftValidationErrors.map((issue, issueIndex) => (
          <Alert
            key={`draft-error:${issueIndex}:${issue.path}:${issue.message}`}
            type="error"
            content={`${issue.path}: ${issue.message}`}
          />
        ))}
        {draftValidationWarnings.map((issue, issueIndex) => (
          <Alert
            key={`draft-warning:${issueIndex}:${issue.path}:${issue.message}`}
            type="warning"
            content={`${issue.path}: ${issue.message}`}
          />
        ))}
        {currentSkillRefs.includes(skillId.trim()) && skillId.trim() ? (
          <Alert type="warning" content={`skillRefs 已包含 ${skillId.trim()}；创建成功后将不会重复追加。`} />
        ) : null}
        {error ? <Alert type="error" content={error} /> : null}
        {success ? <Alert type="success" content={success} /> : null}
        <Button
          type="primary"
          size="small"
          loading={creating}
          disabled={!canCreate || createBlockedByValidation}
          onClick={() => void handleCreate()}
        >
          创建 skill 并加入 skillRefs
        </Button>
      </Space>
    </div>
  );
}

export function ItemsModal({
  typeDefinitions,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  visible,
  mode,
  formData,
  saving,
  imageUri,
  imageSrc,
  imageUploading,
  imageError = null,
  onClose,
  onFieldChange,
  onUploadImage,
  onSubmit
}: ItemsModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';
  const [attributeDefinitions, setAttributeDefinitions] = useState<AttributeDefinition[]>([]);
  const [attributeDefinitionsError, setAttributeDefinitionsError] = useState<string | null>(null);
  const [skillSelectorLoadState, setSkillSelectorLoadState] = useState<SkillRefSelectorLoadState>({
    skills: [],
    loading: false,
    error: null,
    loaded: false
  });

  useEffect(() => {
    if (!visible || !selectedGameId || !adminToken.trim()) {
      setAttributeDefinitions([]);
      setAttributeDefinitionsError(null);
      return;
    }

    let cancelled = false;
    loadAttributeDefinitions({
      apiBaseUrl,
      gameId: selectedGameId,
      token: adminToken.trim()
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setAttributeDefinitions(result.definitions);
        setAttributeDefinitionsError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setAttributeDefinitions([]);
        setAttributeDefinitionsError(getErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [adminToken, apiBaseUrl, selectedGameId, visible]);

  const statModifiersState = useMemo(() => {
    try {
      return { rows: parseStatModifierRows(formData.statModifiersText), error: null as string | null };
    } catch (error) {
      return { rows: [] as StatModifierRow[], error: error instanceof Error ? error.message : String(error) };
    }
  }, [formData.statModifiersText]);

  const skillRefsState = useMemo(() => parseStringArrayText(formData.skillRefsText, 'skillRefs'), [formData.skillRefsText]);
  const recipeIdsState = useMemo(() => parseStringArrayText(formData.recipeIdsText, 'recipeIds'), [formData.recipeIdsText]);
  const handleSkillSelectorLoadStateChange = useCallback((next: SkillRefSelectorLoadState) => {
    setSkillSelectorLoadState((prev) => {
      if (
        prev.skills === next.skills
        && prev.loading === next.loading
        && prev.loaded === next.loaded
        && prev.error === next.error
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const skillRefsValidation = useMemo(
    () =>
      validateItemSkillRefs({
        currentItemId: formData.itemId,
        skillRefs: skillRefsState.value,
        skills: skillSelectorLoadState.skills,
        skillsLoaded: skillSelectorLoadState.loaded && !skillSelectorLoadState.error,
        skillsLoading: skillSelectorLoadState.loading,
        skillsLoadError: skillSelectorLoadState.error
      }),
    [
      formData.itemId,
      skillRefsState.value,
      skillSelectorLoadState.skills,
      skillSelectorLoadState.loaded,
      skillSelectorLoadState.error,
      skillSelectorLoadState.loading
    ]
  );
  const skillRefsSaveBlocked = !!skillRefsState.error || skillRefsValidation.hasBlockingErrors;

  return (
    <Modal
      title={mode === 'create' ? 'Create Item' : mode === 'edit' ? 'Edit Item' : 'View Item'}
      visible={visible}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly ? (
            <Button
              type="primary"
              loading={saving || imageUploading}
              disabled={skillRefsSaveBlocked}
              onClick={() => void onSubmit()}
            >
              Save
            </Button>
          ) : null}
        </Space>
      }
      autoFocus={false}
      focusLock
      style={{ width: 1180 }}
    >
      <Form layout="vertical">
        <Form.Item label="itemId">
          <Input
            value={formData.itemId}
            disabled={readOnly || editingExisting}
            onChange={(value) => onFieldChange('itemId', value)}
            placeholder="Input itemId"
          />
        </Form.Item>

        <div className="crud-form-grid">
          <Form.Item label="name">
            <Input value={formData.name} disabled={readOnly} onChange={(value) => onFieldChange('name', value)} placeholder="Input name" />
          </Form.Item>

          <Form.Item label="goldCost">
            <Input
              value={formData.goldCost}
              disabled={readOnly}
              onChange={(value) => onFieldChange('goldCost', value)}
              placeholder="Input goldCost"
            />
          </Form.Item>
        </div>

        <Form.Item label="item image">
          <ResourceImageUploadField
            src={imageSrc}
            alt={formData.name || formData.itemId || 'item image'}
            imageUri={imageUri}
            uriPlaceholder="Fill itemId first to generate uri"
            readOnly={readOnly}
            uploading={imageUploading}
            error={imageError}
            emptyLabel="No image"
            helperText="Upload will center-crop and normalize to 64x64 before saving."
            onUpload={onUploadImage}
          />
        </Form.Item>

        <Form.Item label="type tags">
          <TypeTagEditor
            definitions={typeDefinitions}
            persistedTypeIds={formData.persistedTypeIds}
            value={formData.selectedTypeIds}
            onChange={(value) => onFieldChange('selectedTypeIds', value)}
            disabled={readOnly || (mode === 'create' && !formData.itemId.trim())}
          />
        </Form.Item>

        <Form.Item label="statModifiers structured">
          {statModifiersState.error ? <Alert type="error" content={`statModifiers parse failed: ${statModifiersState.error}`} style={{ marginBottom: 12 }} /> : null}
          {attributeDefinitionsError ? (
            <Alert type="warning" content={`attribute definitions load failed: ${attributeDefinitionsError}`} style={{ marginBottom: 12 }} />
          ) : null}
          <BaseStatsEditor
            apiBaseUrl={apiBaseUrl}
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            definitions={attributeDefinitions}
            rows={statModifiersState.rows}
            disabled={readOnly || !!statModifiersState.error}
            onChange={(rows) => onFieldChange('statModifiersText', stringifyStatModifierRows(rows))}
          />
        </Form.Item>

        <Form.Item label="skillRefs structured">
          {skillRefsState.error ? <Alert type="error" content={`skillRefs parse failed: ${skillRefsState.error}`} style={{ marginBottom: 12 }} /> : null}
          {skillRefsValidation.errors.map((issue, issueIndex) => (
            <Alert key={`error:${issueIndex}:${issue.code}:${issue.skillId ?? ''}`} type="error" content={issue.message} style={{ marginBottom: 8 }} />
          ))}
          {skillRefsValidation.warnings.map((issue, issueIndex) => (
            <Alert key={`warning:${issueIndex}:${issue.code}:${issue.skillId ?? ''}`} type="warning" content={issue.message} style={{ marginBottom: 8 }} />
          ))}
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            空 skillRefs 表示不接入装备被动，不表示自动匹配该 item 下所有 skill。
          </Typography.Text>
          <ItemDpsPassiveSkillCreator
            apiBaseUrl={apiBaseUrl}
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            itemId={formData.itemId}
            itemName={formData.name}
            currentSkillRefs={skillRefsState.value}
            readOnly={readOnly}
            onAppendSkillRef={(skillId) => {
              if (skillRefsState.value.includes(skillId)) {
                return;
              }
              const nextRefs = [...skillRefsState.value, skillId];
              onFieldChange('skillRefsText', JSON.stringify(nextRefs, null, 2));
            }}
          />
          <SkillRefSelector
            apiBaseUrl={apiBaseUrl}
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            currentItemId={formData.itemId}
            value={skillRefsState.value}
            disabled={readOnly || !!skillRefsState.error}
            onSkillsLoadStateChange={handleSkillSelectorLoadStateChange}
            onChange={(value) => onFieldChange('skillRefsText', JSON.stringify(value, null, 2))}
          />
          {skillRefsValidation.summaries.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <Typography.Text bold style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                已选 skillRefs 摘要
              </Typography.Text>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {skillRefsValidation.summaries.map((summary) => {
                  const statusColor =
                    summary.status === 'ok'
                      ? 'green'
                      : summary.status === 'unchecked'
                        ? 'gray'
                        : summary.status === 'blank' || summary.status === 'missing'
                          ? 'red'
                          : 'orangered';
                  const ownerRoleEntries = Object.entries(summary.ownerRoleDistribution);
                  return (
                    <div
                      key={`${summary.index}:${summary.skillId}`}
                      style={{ border: '1px solid var(--color-border-2)', borderRadius: 6, padding: '8px 10px' }}
                    >
                      <Space wrap size={6}>
                        <Typography.Text style={{ fontSize: 12 }}>
                          [{summary.index}] {summary.skillId}
                          {summary.name ? ` · ${summary.name}` : ''}
                        </Typography.Text>
                        <Tag size="small" color={statusColor}>
                          {formatItemSkillRefSummaryStatus(summary.status)}
                        </Tag>
                        <Tag size="small" color="gray">
                          {summary.ownerType ?? '?'} / {summary.ownerId ?? '?'}
                        </Tag>
                        <Tag size="small" color="arcoblue">
                          passive {summary.passiveCount}
                        </Tag>
                      </Space>
                      {ownerRoleEntries.length > 0 ? (
                        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                          ownerRole: {ownerRoleEntries.map(([role, count]) => `${role}×${count}`).join(', ')}
                        </Typography.Text>
                      ) : null}
                      {summary.triggerCategorySummary.length > 0 ? (
                        <Space wrap size={4} style={{ marginTop: 4 }}>
                          {summary.triggerCategorySummary.map((category) => (
                            <Tag key={`${summary.skillId}:${category}`} size="small" color="purple">
                              {category}
                            </Tag>
                          ))}
                        </Space>
                      ) : null}
                      {summary.operationKindSummary.length > 0 ? (
                        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                          operations: {summary.operationKindSummary.join(', ')}
                        </Typography.Text>
                      ) : null}
                    </div>
                  );
                })}
              </Space>
            </div>
          ) : null}
        </Form.Item>

        <Form.Item label="recipeIds structured">
          {recipeIdsState.error ? <Alert type="error" content={`recipeIds parse failed: ${recipeIdsState.error}`} style={{ marginBottom: 12 }} /> : null}
          <ItemRecipeSelector
            apiBaseUrl={apiBaseUrl}
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            currentItemId={formData.itemId}
            value={recipeIdsState.value}
            disabled={readOnly || !!recipeIdsState.error}
            onChange={(value) => onFieldChange('recipeIdsText', JSON.stringify(value, null, 2))}
          />
        </Form.Item>

        <Collapse defaultActiveKey={[]} style={{ marginTop: 8 }}>
          <Collapse.Item name="advanced-json" header="Advanced JSON (two-way sync)">
            <Form.Item label="statModifiers JSON">
              <Input.TextArea
                value={formData.statModifiersText}
                disabled={readOnly}
                autoSize={{ minRows: 8, maxRows: 14 }}
                onChange={(value) => onFieldChange('statModifiersText', value)}
                placeholder={'[\n  {\n    "attrKey": "",\n    "value": 0\n  }\n]'}
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="skillRefs JSON">
              <Input.TextArea
                value={formData.skillRefsText}
                disabled={readOnly}
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(value) => onFieldChange('skillRefsText', value)}
                placeholder={'[\n  \n]'}
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="recipeIds JSON">
              <Input.TextArea
                value={formData.recipeIdsText}
                disabled={readOnly}
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(value) => onFieldChange('recipeIdsText', value)}
                placeholder={'[\n  \n]'}
                className="admin-json-input"
              />
            </Form.Item>
          </Collapse.Item>
        </Collapse>
      </Form>
    </Modal>
  );
}
