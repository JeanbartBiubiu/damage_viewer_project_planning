import { Alert, Button, Collapse, Form, Input, Modal, Space, Tag } from '@arco-design/web-react';
import { useCallback, useMemo } from 'react';
import { SkillFlatParamsEditor } from '../../../../components/skill-editor/SkillFlatParamsEditor';
import { SkillMechanicsConfigEditor } from '../../../../components/skill-editor/SkillMechanicsConfigEditor';
import { SkillOwnerBindingFields } from '../../../../components/skill-editor/SkillOwnerBindingFields';
import { SkillParamsVarsEditor } from '../../../../components/skill-editor/SkillParamsVarsEditor';
import { SkillSeriesEditor } from '../../../../components/skill-editor/SkillSeriesEditor';
import { SkillTimingProfileEditor } from '../../../../components/skill-editor/SkillTimingProfileEditor';
import {
  hasDpsPassiveValidationErrors,
  inferSkillShapeSummary,
  parseFlatSkillParams,
  parseSkillParams,
  parseMechanicsConfig,
  parseSkillValueRows,
  parseTimingProfile,
  stringifyFlatSkillParams,
  stringifyMechanicsConfig,
  stringifySkillParams,
  stringifySkillValueRows,
  stringifyTimingProfile,
  validateDpsPassiveEffects
} from '../../../../components/skill-editor/skillModels';
import { TypeTagEditor } from '../../../../components/TypeTagEditor';
import { formatShapeLabel, shapeTagColor } from './columns';
import type { TypeDefinition } from '../../../../types/api';
import type { DamageTypeOption } from '../shared/damageTypes';
import type { SkillsFormData } from './types';

type SkillsModalProps = {
  typeDefinitions: TypeDefinition[];
  damageTypeOptions: DamageTypeOption[];
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: SkillsFormData;
  saving: boolean;
  onClose: () => void;
  onFieldChange: <K extends keyof SkillsFormData>(field: K, value: SkillsFormData[K]) => void;
  onSubmit: () => Promise<void>;
};

export function SkillsModal({
  typeDefinitions,
  damageTypeOptions,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  visible,
  mode,
  formData,
  saving,
  onClose,
  onFieldChange,
  onSubmit
}: SkillsModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';

  const resourceCostsState = useMemo(() => {
    try {
      return { rows: parseSkillValueRows(formData.resourceCostsText, 'resourceCosts'), error: null as string | null };
    } catch (error) {
      return { rows: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [formData.resourceCostsText]);

  const cooldownsState = useMemo(() => {
    try {
      return { rows: parseSkillValueRows(formData.cooldownsText, 'cooldowns'), error: null as string | null };
    } catch (error) {
      return { rows: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [formData.cooldownsText]);

  const paramsState = useMemo(() => {
    try {
      return { ...parseSkillParams(formData.paramsText), error: null as string | null };
    } catch (error) {
      return { root: {}, rows: [], hasLegacyFlatParams: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, [formData.paramsText]);

  const flatParamsState = useMemo(() => {
    try {
      return { ...parseFlatSkillParams(formData.paramsText), error: null as string | null };
    } catch (error) {
      return { root: {}, form: parseFlatSkillParams('{\n  \n}').form, error: error instanceof Error ? error.message : String(error) };
    }
  }, [formData.paramsText]);

  const timingProfileState = useMemo(() => {
    try {
      return { ...parseTimingProfile(formData.timingProfileText), error: null as string | null };
    } catch (error) {
      return { root: {}, rows: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [formData.timingProfileText]);

  const mechanicsConfigState = useMemo(() => {
    try {
      return { ...parseMechanicsConfig(formData.mechanicsConfigText), error: null as string | null };
    } catch (error) {
      return { root: {}, version: 1, stacks: [], rows: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [formData.mechanicsConfigText]);

  // 编辑器内实时反馈的模型摘要；列表 columns.tsx 也会基于 record 单独推断一次，两处用途独立，不共享缓存。
  const shapeSummary = useMemo(
    () => inferSkillShapeSummary(paramsState.root, mechanicsConfigState.root),
    [paramsState.root, mechanicsConfigState.root]
  );

  const dpsPassiveIssues = useMemo(() => {
    if (mechanicsConfigState.error) {
      return [];
    }
    return validateDpsPassiveEffects(mechanicsConfigState.root);
  }, [mechanicsConfigState.error, mechanicsConfigState.root]);

  const hasBlockingDpsPassiveErrors = hasDpsPassiveValidationErrors(dpsPassiveIssues);
  const saveBlocked =
    !!resourceCostsState.error ||
    !!cooldownsState.error ||
    !!paramsState.error ||
    !!timingProfileState.error ||
    !!mechanicsConfigState.error ||
    hasBlockingDpsPassiveErrors;

  // 统一 mechanicsConfig 局部更新入口，避免 4 个回调各自重复展开 stringifyMechanicsConfig。
  const updateMechanicsConfig = useCallback(
    (
      partial: Partial<{
        root: typeof mechanicsConfigState.root;
        version: number;
        stacks: typeof mechanicsConfigState.stacks;
        rows: typeof mechanicsConfigState.rows;
      }>
    ) => {
      const nextRoot = partial.root ?? mechanicsConfigState.root;
      const nextVersion = partial.version ?? mechanicsConfigState.version;
      const nextStacks = partial.stacks ?? mechanicsConfigState.stacks;
      const nextRows = partial.rows ?? mechanicsConfigState.rows;
      onFieldChange(
        'mechanicsConfigText',
        stringifyMechanicsConfig(nextRoot, nextVersion, nextStacks, nextRows)
      );
    },
    [mechanicsConfigState.root, mechanicsConfigState.rows, mechanicsConfigState.stacks, mechanicsConfigState.version, onFieldChange]
  );

  return (
    <Modal
      title={mode === 'create' ? '新增技能' : mode === 'edit' ? '编辑技能' : '查看技能'}
      visible={visible}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>{readOnly ? '关闭' : '取消'}</Button>
          {!readOnly ? (
            <Button type="primary" loading={saving} disabled={saveBlocked} onClick={() => void onSubmit()}>
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
        <Form.Item label="技能 ID">
          <Input
            value={formData.skillId}
            disabled={readOnly || editingExisting}
            onChange={(value) => onFieldChange('skillId', value)}
            placeholder="请输入技能 ID"
          />
        </Form.Item>

        <Form.Item label="归属绑定">
          <SkillOwnerBindingFields
            apiBaseUrl={apiBaseUrl}
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            ownerType={formData.ownerType}
            ownerId={formData.ownerId}
            disabled={readOnly}
            onOwnerTypeChange={(value) => onFieldChange('ownerType', value)}
            onOwnerIdChange={(value) => onFieldChange('ownerId', value)}
          />
        </Form.Item>

        <div className="crud-form-grid">
          <Form.Item label="技能 Key">
            <Input
              value={formData.skillKey}
              disabled={readOnly}
              onChange={(value) => onFieldChange('skillKey', value)}
              placeholder="请输入技能 Key"
            />
          </Form.Item>

          <Form.Item label="名称">
            <Input value={formData.name} disabled={readOnly} onChange={(value) => onFieldChange('name', value)} placeholder="请输入名称" />
          </Form.Item>
        </div>

        <Form.Item label="描述">
          <Input.TextArea
            value={formData.description}
            disabled={readOnly}
            autoSize={{ minRows: 3, maxRows: 5 }}
            onChange={(value) => onFieldChange('description', value)}
            placeholder="可选说明"
          />
        </Form.Item>

        <Form.Item label="类型标签">
          <TypeTagEditor
            definitions={typeDefinitions}
            persistedTypeIds={formData.persistedTypeIds}
            value={formData.selectedTypeIds}
            onChange={(value) => onFieldChange('selectedTypeIds', value)}
            disabled={readOnly || (mode === 'create' && !formData.skillId.trim())}
          />
        </Form.Item>

        <Form.Item label="当前模型">
          <Tag color={shapeTagColor(shapeSummary)}>{formatShapeLabel(shapeSummary)}</Tag>
        </Form.Item>

        <Form.Item label="资源消耗结构化编辑">
          {resourceCostsState.error ? <Alert type="error" content={`resourceCosts 解析失败：${resourceCostsState.error}`} style={{ marginBottom: 12 }} /> : null}
          <SkillSeriesEditor
            title="资源消耗"
            description="支持固定值、等级表和公式，并保留额外字段 passthrough。"
            rows={resourceCostsState.rows}
            disabled={readOnly || !!resourceCostsState.error}
            onChange={(rows) => onFieldChange('resourceCostsText', stringifySkillValueRows(rows))}
          />
        </Form.Item>

        <Form.Item label="冷却结构化编辑">
          {cooldownsState.error ? <Alert type="error" content={`cooldowns 解析失败：${cooldownsState.error}`} style={{ marginBottom: 12 }} /> : null}
          <SkillSeriesEditor
            title="冷却"
            description="支持固定值、等级表和公式，并保留额外字段 passthrough。"
            rows={cooldownsState.rows}
            disabled={readOnly || !!cooldownsState.error}
            onChange={(rows) => onFieldChange('cooldownsText', stringifySkillValueRows(rows))}
          />
        </Form.Item>

        <Form.Item label="参数与等级表">
          {paramsState.error ? <Alert type="error" content={`params 解析失败：${paramsState.error}`} style={{ marginBottom: 12 }} /> : null}
          <SkillParamsVarsEditor
            apiBaseUrl={apiBaseUrl}
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            rows={paramsState.rows}
            disabled={readOnly || !!paramsState.error}
            onChange={(rows) => onFieldChange('paramsText', stringifySkillParams(paramsState.root, rows))}
          />
        </Form.Item>

        <Form.Item label="时序结构化编辑">
          {timingProfileState.error ? <Alert type="error" content={`timingProfile 解析失败：${timingProfileState.error}`} style={{ marginBottom: 12 }} /> : null}
          <SkillTimingProfileEditor
            rows={timingProfileState.rows}
            disabled={readOnly || !!timingProfileState.error}
            onChange={(rows) => onFieldChange('timingProfileText', stringifyTimingProfile(timingProfileState.root, rows))}
          />
        </Form.Item>

        <Form.Item label="机制结构化编辑">
          {mechanicsConfigState.error ? <Alert type="error" content={`mechanicsConfig 解析失败：${mechanicsConfigState.error}`} style={{ marginBottom: 12 }} /> : null}
          <SkillMechanicsConfigEditor
            apiBaseUrl={apiBaseUrl}
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            damageTypeOptions={damageTypeOptions}
            root={mechanicsConfigState.root}
            version={mechanicsConfigState.version}
            stacks={mechanicsConfigState.stacks}
            rows={mechanicsConfigState.rows}
            skillId={formData.skillId}
            ownerId={formData.ownerId}
            ownerType={formData.ownerType}
            disabled={readOnly || !!mechanicsConfigState.error}
            onVersionChange={(version) => updateMechanicsConfig({ version })}
            onStacksChange={(stacks) => updateMechanicsConfig({ stacks })}
            onChange={(rows) => updateMechanicsConfig({ rows })}
            onDpsPassiveEffectsChange={(passives) =>
              updateMechanicsConfig({ root: { ...mechanicsConfigState.root, dpsPassiveEffects: passives } })
            }
          />
        </Form.Item>

        <Collapse defaultActiveKey={[]} style={{ marginTop: 8 }}>
          {paramsState.hasLegacyFlatParams ? (
            <Collapse.Item name="legacy-flat" header="旧格式兼容（平铺参数）">
              {flatParamsState.error ? <Alert type="error" content={`legacy params 解析失败：${flatParamsState.error}`} style={{ marginBottom: 12 }} /> : null}
              <SkillFlatParamsEditor
                form={flatParamsState.form}
                damageTypeOptions={damageTypeOptions}
                disabled={readOnly || !!flatParamsState.error}
                onChange={(form) => onFieldChange('paramsText', stringifyFlatSkillParams(flatParamsState.root, form))}
              />
            </Collapse.Item>
          ) : null}

          <Collapse.Item name="advanced-json" header="高级 JSON 编辑（分段回退）">
            <Form.Item label="资源消耗 JSON">
              <Input.TextArea
                value={formData.resourceCostsText}
                disabled={readOnly}
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(value) => onFieldChange('resourceCostsText', value)}
                placeholder="[\n  \n]"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="冷却 JSON">
              <Input.TextArea
                value={formData.cooldownsText}
                disabled={readOnly}
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(value) => onFieldChange('cooldownsText', value)}
                placeholder="[\n  \n]"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="参数 JSON">
              <Input.TextArea
                value={formData.paramsText}
                disabled={readOnly}
                autoSize={{ minRows: 6, maxRows: 10 }}
                onChange={(value) => onFieldChange('paramsText', value)}
                placeholder="{\n  \n}"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="时序 JSON">
              <Input.TextArea
                value={formData.timingProfileText}
                disabled={readOnly}
                autoSize={{ minRows: 6, maxRows: 10 }}
                onChange={(value) => onFieldChange('timingProfileText', value)}
                placeholder="{\n  \n}"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="机制 JSON">
              <Input.TextArea
                value={formData.mechanicsConfigText}
                disabled={readOnly}
                autoSize={{ minRows: 8, maxRows: 16 }}
                onChange={(value) => onFieldChange('mechanicsConfigText', value)}
                placeholder="{\n  \n}"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="MVP 扩展 JSON">
              <Input.TextArea
                value={formData.mvpExtensionsText}
                disabled={readOnly}
                autoSize={{ minRows: 6, maxRows: 12 }}
                onChange={(value) => onFieldChange('mvpExtensionsText', value)}
                placeholder="{\n  \n}"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="备注 JSON">
              <Input.TextArea
                value={formData.notesText}
                disabled={readOnly}
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(value) => onFieldChange('notesText', value)}
                placeholder="[\n  \n]"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="其它顶层字段 JSON">
              <Input.TextArea
                value={formData.extraFieldsText}
                disabled={readOnly}
                autoSize={{ minRows: 6, maxRows: 12 }}
                onChange={(value) => onFieldChange('extraFieldsText', value)}
                placeholder="{\n  \n}"
                className="admin-json-input"
              />
            </Form.Item>
          </Collapse.Item>
        </Collapse>
      </Form>
    </Modal>
  );
}
