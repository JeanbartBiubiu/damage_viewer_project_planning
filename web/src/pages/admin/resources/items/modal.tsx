import { Alert, Button, Collapse, Form, Input, InputNumber, Modal, Space, Tag, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ResourceImageUploadField } from '../../../../components/ResourceImageUploadField';
import { TypeTagEditor } from '../../../../components/TypeTagEditor';
import { BaseStatsEditor } from '../../../../components/hero-editor/BaseStatsEditor';
import { ItemRecipeSelector } from '../../../../components/item-editor/ItemRecipeSelector';
import { SkillRefSelector, type SkillRefSelectorLoadState } from '../../../../components/item-editor/SkillRefSelector';
import { loadAttributeDefinitions } from '../../../../services/attributeDefinitions';
import { getErrorMessage } from '../../../../services/apiClient';
import type { AttributeDefinition, Item, TypeDefinition } from '../../../../types/api';
import { stringifyJson } from '../shared/json';
import { ItemDpsPassiveSkillCreator } from './ItemDpsPassiveSkillCreator';
import {
  formatItemSkillRefSummaryStatus,
  validateItemSkillRefs
} from './itemSkillRefsValidation';
import { parseStatModifierRowsSorted, stringifyStatModifierRows, type StatModifierRow } from './statModifiers';
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
  availableItems: Item[];
  availableItemsLoading?: boolean;
  availableItemsError?: string | null;
  onClose: () => void;
  onFieldChange: <K extends keyof ItemsFormData>(field: K, value: ItemsFormData[K]) => void;
  onUploadImage: (file: File) => Promise<void>;
  onSubmit: () => Promise<void>;
};

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
  availableItems,
  availableItemsLoading = false,
  availableItemsError = null,
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

  const statModifiersState = useMemo<{ rows: StatModifierRow[]; error: string | null }>(() => {
    try {
      return { rows: parseStatModifierRowsSorted(formData.statModifiersText), error: null };
    } catch (error) {
      return { rows: [], error: error instanceof Error ? error.message : String(error) };
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

  const goldCostNumber = formData.goldCost.trim() === '' ? undefined : Number(formData.goldCost);

  return (
    <Modal
      title={mode === 'create' ? '新增装备' : mode === 'edit' ? '编辑装备' : '查看装备'}
      visible={visible}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>{readOnly ? '关闭' : '取消'}</Button>
          {!readOnly ? (
            <Button
              type="primary"
              loading={saving || imageUploading}
              disabled={skillRefsSaveBlocked}
              onClick={() => void onSubmit()}
            >
              保存
            </Button>
          ) : null}
        </Space>
      }
      autoFocus={false}
      focusLock
      style={{ width: '90vw', maxWidth: 1280 }}
    >
      <Form layout="vertical">
        <Form.Item label="装备 ID">
          <Input
            value={formData.itemId}
            disabled={readOnly || editingExisting}
            onChange={(value) => onFieldChange('itemId', value)}
            placeholder="请输入装备 ID"
          />
        </Form.Item>

        <div className="crud-form-grid">
          <Form.Item label="名称">
            <Input value={formData.name} disabled={readOnly} onChange={(value) => onFieldChange('name', value)} placeholder="请输入名称" />
          </Form.Item>

          <Form.Item label="金币成本">
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              value={Number.isFinite(goldCostNumber) ? goldCostNumber : undefined}
              disabled={readOnly}
              onChange={(value) => onFieldChange('goldCost', value === undefined || value === null ? '' : String(value))}
              placeholder="请输入金币成本"
            />
          </Form.Item>
        </div>

        <Form.Item label="装备图片">
          <ResourceImageUploadField
            src={imageSrc}
            alt={formData.name || formData.itemId || '装备图片'}
            imageUri={imageUri}
            uriPlaceholder="请先填写装备 ID 以生成图片标识"
            readOnly={readOnly}
            uploading={imageUploading}
            error={imageError}
            emptyLabel="未上传"
            helperText="上传时会先居中裁切为 64x64，再同步写入服务端和本地 IndexedDB。"
            onUpload={onUploadImage}
          />
        </Form.Item>

        <Form.Item label="类型标签">
          <TypeTagEditor
            definitions={typeDefinitions}
            persistedTypeIds={formData.persistedTypeIds}
            value={formData.selectedTypeIds}
            onChange={(value) => onFieldChange('selectedTypeIds', value)}
            disabled={readOnly || (mode === 'create' && !formData.itemId.trim())}
          />
        </Form.Item>

        <Form.Item label="属性修正（结构化）">
          {statModifiersState.error ? <Alert type="error" content={`属性修正解析失败：${statModifiersState.error}`} style={{ marginBottom: 12 }} /> : null}
          {attributeDefinitionsError ? (
            <Alert type="warning" content={`属性定义加载失败：${attributeDefinitionsError}`} style={{ marginBottom: 12 }} />
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

        <Form.Item label="技能引用（结构化）">
          {skillRefsState.error ? <Alert type="error" content={`技能引用解析失败：${skillRefsState.error}`} style={{ marginBottom: 12 }} /> : null}
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
              onFieldChange('skillRefsText', stringifyJson(nextRefs));
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
            onChange={(value) => onFieldChange('skillRefsText', stringifyJson(value))}
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

        <Form.Item label="合成配方（结构化）">
          {recipeIdsState.error ? <Alert type="error" content={`合成配方解析失败：${recipeIdsState.error}`} style={{ marginBottom: 12 }} /> : null}
          <ItemRecipeSelector
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            items={availableItems}
            itemsLoading={availableItemsLoading}
            itemsError={availableItemsError ?? null}
            currentItemId={formData.itemId}
            value={recipeIdsState.value}
            disabled={readOnly || !!recipeIdsState.error || !!availableItemsError}
            onChange={(value) => onFieldChange('recipeIdsText', stringifyJson(value))}
          />
        </Form.Item>

        <Collapse defaultActiveKey={[]} style={{ marginTop: 8 }}>
          <Collapse.Item name="advanced-json" header="高级 JSON 编辑（双向同步）">
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              结构化编辑与下方 JSON 文本双向同步。若手动修改 JSON 导致解析失败，结构化区会暂时禁用并显示错误。
            </Typography.Text>

            <Form.Item label="属性修正 JSON">
              <Input.TextArea
                value={formData.statModifiersText}
                disabled={readOnly}
                autoSize={{ minRows: 8, maxRows: 14 }}
                onChange={(value) => onFieldChange('statModifiersText', value)}
                placeholder={'[\n  {\n    "attrKey": "",\n    "value": 0\n  }\n]'}
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="技能引用 JSON">
              <Input.TextArea
                value={formData.skillRefsText}
                disabled={readOnly}
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(value) => onFieldChange('skillRefsText', value)}
                placeholder={'[\n  \n]'}
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="合成配方 JSON">
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
