import { Alert, Button, Collapse, Form, Input, Modal, Space, Tag } from '@arco-design/web-react';
import { useMemo } from 'react';
import { SkillFlatParamsEditor } from '../../../../components/skill-editor/SkillFlatParamsEditor';
import { SkillMechanicsConfigEditor } from '../../../../components/skill-editor/SkillMechanicsConfigEditor';
import { SkillOwnerBindingFields } from '../../../../components/skill-editor/SkillOwnerBindingFields';
import { SkillSeriesEditor } from '../../../../components/skill-editor/SkillSeriesEditor';
import { SkillTimingProfileEditor } from '../../../../components/skill-editor/SkillTimingProfileEditor';
import {
  inferSkillShapeSummary,
  parseFlatSkillParams,
  parseMechanicsConfig,
  parseSkillSeriesRows,
  parseTimingProfile,
  stringifyFlatSkillParams,
  stringifyMechanicsConfig,
  stringifySkillSeriesRows,
  stringifyTimingProfile
} from '../../../../components/skill-editor/skillModels';
import { TypeTagEditor } from '../../../../components/TypeTagEditor';
import type { TypeDefinition } from '../../../../types/api';
import type { SkillsFormData } from './types';

type SkillsModalProps = {
  typeDefinitions: TypeDefinition[];
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
      return { rows: parseSkillSeriesRows(formData.resourceCostsText, 'resourceCosts'), error: null as string | null };
    } catch (error) {
      return { rows: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [formData.resourceCostsText]);

  const cooldownsState = useMemo(() => {
    try {
      return { rows: parseSkillSeriesRows(formData.cooldownsText, 'cooldowns'), error: null as string | null };
    } catch (error) {
      return { rows: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [formData.cooldownsText]);

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
      return { root: {}, version: 1, rows: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [formData.mechanicsConfigText]);

  const shapeSummary = useMemo(
    () => inferSkillShapeSummary(flatParamsState.root, mechanicsConfigState.root),
    [flatParamsState.root, mechanicsConfigState.root]
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
            <Button type="primary" loading={saving} onClick={() => void onSubmit()}>
              保存
            </Button>
          ) : null}
        </Space>
      }
      autoFocus={false}
      focusLock
      style={{ width: 1280 }}
    >
      <Form layout="vertical">
        <Form.Item label="skillId">
          <Input
            value={formData.skillId}
            disabled={readOnly || editingExisting}
            onChange={(value) => onFieldChange('skillId', value)}
            placeholder="请输入 skillId"
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
          <Form.Item label="skillKey">
            <Input
              value={formData.skillKey}
              disabled={readOnly}
              onChange={(value) => onFieldChange('skillKey', value)}
              placeholder="请输入 skillKey"
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
          <Tag color={shapeSummary === 'Mixed' ? 'orangered' : shapeSummary === 'DSL' ? 'arcoblue' : shapeSummary === 'Flat' ? 'purple' : 'gray'}>
            {shapeSummary}
          </Tag>
        </Form.Item>

        <Form.Item label="resourceCosts 结构化编辑">
          {resourceCostsState.error ? <Alert type="error" content={`resourceCosts 解析失败：${resourceCostsState.error}`} style={{ marginBottom: 12 }} /> : null}
          <SkillSeriesEditor
            title="Resource Costs"
            description="支持 const / table 两种常见形态。"
            rows={resourceCostsState.rows}
            disabled={readOnly || !!resourceCostsState.error}
            onChange={(rows) => onFieldChange('resourceCostsText', stringifySkillSeriesRows(rows))}
          />
        </Form.Item>

        <Form.Item label="cooldowns 结构化编辑">
          {cooldownsState.error ? <Alert type="error" content={`cooldowns 解析失败：${cooldownsState.error}`} style={{ marginBottom: 12 }} /> : null}
          <SkillSeriesEditor
            title="Cooldowns"
            description="支持 const / table 两种常见形态。"
            rows={cooldownsState.rows}
            disabled={readOnly || !!cooldownsState.error}
            onChange={(rows) => onFieldChange('cooldownsText', stringifySkillSeriesRows(rows))}
          />
        </Form.Item>

        <Form.Item label="旧 Flat 快速编辑">
          {flatParamsState.error ? <Alert type="error" content={`params 解析失败：${flatParamsState.error}`} style={{ marginBottom: 12 }} /> : null}
          <SkillFlatParamsEditor
            form={flatParamsState.form}
            disabled={readOnly || !!flatParamsState.error}
            onChange={(form) => onFieldChange('paramsText', stringifyFlatSkillParams(flatParamsState.root, form))}
          />
        </Form.Item>

        <Form.Item label="Timing Profile 结构化编辑">
          {timingProfileState.error ? <Alert type="error" content={`timingProfile 解析失败：${timingProfileState.error}`} style={{ marginBottom: 12 }} /> : null}
          <SkillTimingProfileEditor
            rows={timingProfileState.rows}
            disabled={readOnly || !!timingProfileState.error}
            onChange={(rows) => onFieldChange('timingProfileText', stringifyTimingProfile(timingProfileState.root, rows))}
          />
        </Form.Item>

        <Form.Item label="新 DSL 结构化编辑">
          {mechanicsConfigState.error ? <Alert type="error" content={`mechanicsConfig 解析失败：${mechanicsConfigState.error}`} style={{ marginBottom: 12 }} /> : null}
          <SkillMechanicsConfigEditor
            version={mechanicsConfigState.version}
            rows={mechanicsConfigState.rows}
            disabled={readOnly || !!mechanicsConfigState.error}
            onVersionChange={(version) =>
              onFieldChange('mechanicsConfigText', stringifyMechanicsConfig(mechanicsConfigState.root, version, mechanicsConfigState.rows))
            }
            onChange={(rows) => onFieldChange('mechanicsConfigText', stringifyMechanicsConfig(mechanicsConfigState.root, mechanicsConfigState.version, rows))}
          />
        </Form.Item>

        <Collapse defaultActiveKey={[]} style={{ marginTop: 8 }}>
          <Collapse.Item name="advanced-json" header="高级 JSON 编辑（分段回退）">
            <Form.Item label="resourceCosts JSON">
              <Input.TextArea
                value={formData.resourceCostsText}
                disabled={readOnly}
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(value) => onFieldChange('resourceCostsText', value)}
                placeholder="[\n  \n]"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="cooldowns JSON">
              <Input.TextArea
                value={formData.cooldownsText}
                disabled={readOnly}
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(value) => onFieldChange('cooldownsText', value)}
                placeholder="[\n  \n]"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="params JSON">
              <Input.TextArea
                value={formData.paramsText}
                disabled={readOnly}
                autoSize={{ minRows: 6, maxRows: 10 }}
                onChange={(value) => onFieldChange('paramsText', value)}
                placeholder="{\n  \n}"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="timingProfile JSON">
              <Input.TextArea
                value={formData.timingProfileText}
                disabled={readOnly}
                autoSize={{ minRows: 6, maxRows: 10 }}
                onChange={(value) => onFieldChange('timingProfileText', value)}
                placeholder="{\n  \n}"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="mechanicsConfig JSON">
              <Input.TextArea
                value={formData.mechanicsConfigText}
                disabled={readOnly}
                autoSize={{ minRows: 8, maxRows: 16 }}
                onChange={(value) => onFieldChange('mechanicsConfigText', value)}
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
