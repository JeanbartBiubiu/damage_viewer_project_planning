import { Button, Form, Input, Modal, Select, Space } from '@arco-design/web-react';
import type { TypeRelationsFormData } from './types';

const TARGET_CATEGORY_OPTIONS = [
  { label: '英雄', value: 'character' },
  { label: '技能', value: 'skill' },
  { label: '装备', value: 'equipment' },
  { label: '属性', value: 'attribute' },
  { label: '类型', value: 'type' }
];

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
      style={{ width: 760 }}
    >
      <Form layout="vertical">
        <div className="crud-form-grid">
          <Form.Item label="typeId">
            <Input
              value={formData.typeId}
              disabled={readOnly || editingExisting}
              onChange={(value) => onFieldChange('typeId', value)}
              placeholder="请输入 typeId"
            />
          </Form.Item>

          <Form.Item label="targetCategory">
            <Select
              value={formData.targetCategory || undefined}
              disabled={readOnly || editingExisting}
              onChange={(value) => onFieldChange('targetCategory', value ?? '')}
              placeholder="请选择 targetCategory"
              options={TARGET_CATEGORY_OPTIONS}
            />
          </Form.Item>
        </div>

        <Form.Item label="targetId">
          <Input
            value={formData.targetId}
            disabled={readOnly || editingExisting}
            onChange={(value) => onFieldChange('targetId', value)}
            placeholder="请输入 targetId"
          />
        </Form.Item>

        <Form.Item label="extend">
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
