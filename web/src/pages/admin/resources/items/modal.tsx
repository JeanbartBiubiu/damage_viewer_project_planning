import { Alert, Button, Collapse, Form, Input, Modal, Space, Tag, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ResourceImageUploadField } from '../../../../components/ResourceImageUploadField';
import { TypeTagEditor } from '../../../../components/TypeTagEditor';
import { BaseStatsEditor } from '../../../../components/hero-editor/BaseStatsEditor';
import { ItemRecipeSelector } from '../../../../components/item-editor/ItemRecipeSelector';
import { SkillRefSelector, type SkillRefSelectorLoadState } from '../../../../components/item-editor/SkillRefSelector';
import { loadAttributeDefinitions } from '../../../../services/attributeDefinitions';
import { getErrorMessage } from '../../../../services/apiClient';
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
