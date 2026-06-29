import { Button, Form, Input, InputNumber, Modal, Select, Space } from '@arco-design/web-react';
import { TARGET_CATEGORY_OPTIONS } from './constants';
import type { TypeRelationsFormData } from './types';

type TypeRelationsModalProps = {
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: TypeRelationsFormData;
  saving: boolean;
  onClose: () => void;
  onFieldChange: <K extends keyof TypeRelationsFormData>(field: K, value: TypeRelationsFormData[K]) => void;
  onSubmit: () => Promise<void>;
};

export function TypeRelationsModal({
  visible,
  mode,
  formData,
  saving,
  onClose,
  onFieldChange,
  onSubmit
}: TypeRelationsModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';

  return (
    <Modal
      title={mode === 'create' ? '新增类型挂载' : mode === 'edit' ? '编辑类型挂载' : '查看类型挂载'}
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
      style={{ width: '90vw', maxWidth: 1280 }}
    >
      <Form layout="vertical">
        <div className="crud-form-grid">
          <Form.Item label="类型 ID">
            <InputNumber
              value={formData.typeId.trim() === '' ? undefined : Number(formData.typeId)}
              min={0}
              disabled={readOnly || editingExisting}
              onChange={(value) => onFieldChange('typeId', value !== undefined && value !== null ? String(value) : '')}
              placeholder="请输入类型 ID"
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item label="目标类别">
            <Select
              value={formData.targetCategory || undefined}
              disabled={readOnly || editingExisting}
              onChange={(value) => onFieldChange('targetCategory', value ?? '')}
              placeholder="请选择目标类别"
              options={TARGET_CATEGORY_OPTIONS}
            />
          </Form.Item>
        </div>

        <Form.Item label="目标 ID">
          <Input
            value={formData.targetId}
            disabled={readOnly || editingExisting}
            onChange={(value) => onFieldChange('targetId', value)}
            placeholder="请输入目标 ID"
          />
        </Form.Item>

        <Form.Item label="扩展字段">
          <Input.TextArea
            value={formData.extendText}
            disabled={readOnly}
            autoSize={{ minRows: 8, maxRows: 14 }}
            onChange={(value) => onFieldChange('extendText', value)}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
