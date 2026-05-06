import { Button, Collapse, Form, Input, Modal, Select, Space } from '@arco-design/web-react';
import { FormulaParamsEditor } from '../../../../components/formula-editor/FormulaParamsEditor';
import { appendCurrentDamageTypeOption, type DamageTypeOption } from '../shared/damageTypes';
import { FORMULA_PROFILE_KIND_OPTIONS, FORMULA_PROFILE_TYPE_OPTIONS } from './constants';
import type { FormulaProfilesFormData } from './types';

type FormulaProfilesModalProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: FormulaProfilesFormData;
  damageTypeOptions: DamageTypeOption[];
  saving: boolean;
  onClose: () => void;
  onFieldChange: <K extends keyof FormulaProfilesFormData>(field: K, value: FormulaProfilesFormData[K]) => void;
  onSubmit: () => Promise<void>;
};

export function FormulaProfilesModal({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  visible,
  mode,
  formData,
  damageTypeOptions,
  saving,
  onClose,
  onFieldChange,
  onSubmit
}: FormulaProfilesModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';
  const formulaTypeOptions = appendCurrentOption(FORMULA_PROFILE_TYPE_OPTIONS, formData.formulaType);
  const formulaKindOptions = appendCurrentOption(FORMULA_PROFILE_KIND_OPTIONS, formData.formulaKind);
  const mergedDamageTypeOptions = appendCurrentDamageTypeOption(damageTypeOptions, formData.damageTypeId);

  return (
    <Modal
      title={mode === 'create' ? '新增公式档案' : mode === 'edit' ? '编辑公式档案' : '查看公式档案'}
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
      style={{ width: 1160 }}
    >
      <Form layout="vertical">
        <Form.Item label="公式 ID">
          <Input
            value={formData.formulaId}
            disabled={readOnly || editingExisting}
            onChange={(value) => onFieldChange('formulaId', value)}
            placeholder="例如 damage.skill.katarina.r.base"
          />
        </Form.Item>

        <div className="crud-form-grid">
          <Form.Item label="公式类型">
            <Select
              disabled={readOnly}
              value={formData.formulaType || undefined}
              onChange={(value) => {
                const nextFormulaType = String(value ?? '');
                onFieldChange('formulaType', nextFormulaType);
                if (nextFormulaType !== 'damage' && formData.damageTypeId) {
                  onFieldChange('damageTypeId', '');
                }
              }}
              placeholder="请选择"
              options={formulaTypeOptions}
            />
          </Form.Item>

          <Form.Item label="公式种类">
            <Select
              disabled={readOnly}
              value={formData.formulaKind || undefined}
              onChange={(value) => onFieldChange('formulaKind', String(value ?? ''))}
              placeholder="请选择"
              options={formulaKindOptions}
            />
          </Form.Item>
        </div>

        {formData.formulaType === 'damage' ? (
          <Form.Item
            label="伤害类型"
            required
            validateStatus={!readOnly && !formData.damageTypeId ? 'error' : undefined}
            help={!readOnly && !formData.damageTypeId ? '请选择 10001 伤害类型根节点下的一个类型。' : undefined}
          >
            <Select
              disabled={readOnly}
              value={formData.damageTypeId || undefined}
              onChange={(value) => onFieldChange('damageTypeId', String(value ?? ''))}
              placeholder="请选择伤害类型"
              options={mergedDamageTypeOptions}
            />
          </Form.Item>
        ) : null}

        <Form.Item label="说明">
          <Input.TextArea
            value={formData.description}
            disabled={readOnly}
            autoSize={{ minRows: 3, maxRows: 5 }}
            onChange={(value) => onFieldChange('description', value)}
            placeholder="可选说明"
          />
        </Form.Item>

        <Form.Item label="参数结构化编辑">
          <FormulaParamsEditor
            title="公式参数"
            apiBaseUrl={apiBaseUrl}
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            value={formData.paramsText}
            disabled={readOnly}
            onChange={(nextValue) => onFieldChange('paramsText', nextValue)}
          />
        </Form.Item>

        <Collapse defaultActiveKey={[]} style={{ marginTop: 8 }}>
          <Collapse.Item name="extra-fields" header="额外顶层字段">
            <Input.TextArea
              value={formData.extraFieldsText}
              disabled={readOnly}
              autoSize={{ minRows: 6, maxRows: 12 }}
              onChange={(value) => onFieldChange('extraFieldsText', value)}
              placeholder="{\n  \n}"
              className="admin-json-input"
            />
          </Collapse.Item>
        </Collapse>
      </Form>
    </Modal>
  );
}

function appendCurrentOption(options: Array<{ label: string; value: string }>, currentValue: string) {
  const trimmed = currentValue.trim();
  if (!trimmed || options.some((option) => option.value === trimmed)) {
    return options;
  }
  return [...options, { label: `${trimmed}（当前值）`, value: trimmed }];
}
