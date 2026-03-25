import { Button, Form, Input, Modal, Select, Space } from '@arco-design/web-react';
import { FORMULA_BINDING_TARGET_CATEGORY_OPTIONS } from './constants';
import type { FormulaBindingsFormData } from './types';

type FormulaBindingsModalProps = {
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: FormulaBindingsFormData;
  saving: boolean;
  onClose: () => void;
  onFieldChange: <K extends keyof FormulaBindingsFormData>(field: K, value: FormulaBindingsFormData[K]) => void;
  onSubmit: () => Promise<void>;
};

export function FormulaBindingsModal({
  visible,
  mode,
  formData,
  saving,
  onClose,
  onFieldChange,
  onSubmit
}: FormulaBindingsModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';

  return (
    <Modal
      title={mode === 'create' ? '新增公式绑定' : mode === 'edit' ? '编辑公式绑定' : '查看公式绑定'}
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
        <div className="crud-form-grid">
          <Form.Item label="目标分类">
            <Select
              disabled={readOnly || editingExisting}
              value={formData.targetCategory || undefined}
              onChange={(value) => onFieldChange('targetCategory', value ?? '')}
              placeholder="请选择"
            >
              {FORMULA_BINDING_TARGET_CATEGORY_OPTIONS.map((option) => (
                <Select.Option key={option.value} value={option.value}>
                  {option.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item label="目标 ID">
            <Input
              value={formData.targetId}
              disabled={readOnly || editingExisting}
              onChange={(value) => onFieldChange('targetId', value)}
              placeholder="请输入 targetId"
            />
          </Form.Item>
        </div>

        <div className="crud-form-grid">
          <Form.Item label="bindingKey">
            <Input
              value={formData.bindingKey}
              disabled={readOnly || editingExisting}
              onChange={(value) => onFieldChange('bindingKey', value)}
              placeholder="请输入 bindingKey"
            />
          </Form.Item>

          <Form.Item label="公式 ID">
            <Input
              value={formData.formulaId}
              disabled={readOnly}
              onChange={(value) => onFieldChange('formulaId', value)}
              placeholder="请输入 formulaId"
            />
          </Form.Item>
        </div>

        <Form.Item label="overrideParams">
          <Input.TextArea
            value={formData.overrideParamsText}
            disabled={readOnly}
            autoSize={{ minRows: 10, maxRows: 18 }}
            onChange={(value) => onFieldChange('overrideParamsText', value)}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
