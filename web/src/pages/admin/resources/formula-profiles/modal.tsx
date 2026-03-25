import { Button, Form, Input, Modal, Select, Space } from '@arco-design/web-react';
import { FORMULA_PROFILE_KIND_OPTIONS, FORMULA_PROFILE_TYPE_OPTIONS } from './constants';
import type { FormulaProfilesFormData } from './types';

type FormulaProfilesModalProps = {
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: FormulaProfilesFormData;
  saving: boolean;
  onClose: () => void;
  onFieldChange: <K extends keyof FormulaProfilesFormData>(field: K, value: FormulaProfilesFormData[K]) => void;
  onSubmit: () => Promise<void>;
};

export function FormulaProfilesModal({
  visible,
  mode,
  formData,
  saving,
  onClose,
  onFieldChange,
  onSubmit
}: FormulaProfilesModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';

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
      style={{ width: 760 }}
    >
      <Form layout="vertical">
        <Form.Item label="公式 ID">
          <Input
            value={formData.formulaId}
            disabled={editingExisting}
            onChange={(value) => onFieldChange('formulaId', value)}
            placeholder="例如 damage.skill.katarina.r.base"
          />
        </Form.Item>

        <div className="crud-form-grid">
          <Form.Item label="公式类型">
            <Select
              disabled={readOnly}
              value={formData.formulaType || undefined}
              onChange={(value) => onFieldChange('formulaType', value ?? '')}
              placeholder="请选择"
            >
              {FORMULA_PROFILE_TYPE_OPTIONS.map((option) => (
                <Select.Option key={option.value} value={option.value}>
                  {option.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item label="公式种类">
            <Select
              disabled={readOnly}
              value={formData.formulaKind || undefined}
              onChange={(value) => onFieldChange('formulaKind', value ?? '')}
              placeholder="请选择"
            >
              {FORMULA_PROFILE_KIND_OPTIONS.map((option) => (
                <Select.Option key={option.value} value={option.value}>
                  {option.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </div>

        <Form.Item label="说明">
          <Input.TextArea
            value={formData.description}
            disabled={readOnly}
            autoSize={{ minRows: 3, maxRows: 5 }}
            onChange={(value) => onFieldChange('description', value)}
            placeholder="可选说明"
          />
        </Form.Item>

        <Form.Item label="params">
          <Input.TextArea
            value={formData.paramsText}
            disabled={readOnly}
            autoSize={{ minRows: 10, maxRows: 18 }}
            onChange={(value) => onFieldChange('paramsText', value)}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
