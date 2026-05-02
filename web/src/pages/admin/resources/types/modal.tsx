import { Button, Form, Input, Modal, Select, Space, Typography } from '@arco-design/web-react';
import type { TypeDefinition } from '../../../../types/api';
import type { TypesFormData } from './types';

type TypesModalProps = {
  availableParentTypes: TypeDefinition[];
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: TypesFormData;
  saving: boolean;
  onClose: () => void;
  onFieldChange: <K extends keyof TypesFormData>(field: K, value: TypesFormData[K]) => void;
  onSubmit: () => Promise<void>;
};

export function TypesModal({
  availableParentTypes,
  visible,
  mode,
  formData,
  saving,
  onClose,
  onFieldChange,
  onSubmit
}: TypesModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';

  return (
    <Modal
      title={mode === 'create' ? '新增类型定义' : mode === 'edit' ? '编辑类型定义' : '查看类型定义'}
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
      style={{ width: 720 }}
    >
      <Form layout="vertical">
        <Form.Item label="typeId">
          <Input
            value={formData.typeId}
            disabled={readOnly || editingExisting}
            onChange={(value) => onFieldChange('typeId', value)}
            placeholder="普通类型从 30000 起"
          />
        </Form.Item>

        <Form.Item label="名称">
          <Input
            value={formData.name}
            disabled={readOnly}
            onChange={(value) => onFieldChange('name', value)}
            placeholder="请输入名称"
          />
        </Form.Item>

        <Form.Item label="描述">
          <Input.TextArea
            value={formData.description}
            disabled={readOnly}
            autoSize={{ minRows: 3, maxRows: 5 }}
            onChange={(value) => onFieldChange('description', value)}
            placeholder="可选说明"
          />
        </Form.Item>

        <Form.Item label="reservedTypeId">
          <Input
            value={formData.reservedTypeId}
            disabled={readOnly}
            onChange={(value) => onFieldChange('reservedTypeId', value)}
            placeholder="可选"
          />
        </Form.Item>

        <Form.Item label="父类型（最多一层，可多选）">
          <Select
            mode="multiple"
            allowClear
            showSearch
            value={formData.parentTypeIds}
            disabled={readOnly}
            placeholder="可选，选择父类型"
            onChange={(value) =>
              onFieldChange(
                'parentTypeIds',
                Array.isArray(value) ? value.map((item) => String(item)).filter((item) => item.trim().length > 0) : []
              )
            }
            options={availableParentTypes.map((type) => ({
              label: `${type.name ?? '未命名类型'} / ${type.typeId}`,
              value: String(type.typeId)
            }))}
          />
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
            保存时会同步各父类型的挂载集合，同时维持“最多一层”约束。
          </Typography.Text>
        </Form.Item>
      </Form>
    </Modal>
  );
}
