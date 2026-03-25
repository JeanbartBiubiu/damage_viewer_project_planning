import { Button, Form, Input, Modal, Space } from '@arco-design/web-react';
import type { ItemsFormData } from './types';

type ItemsModalProps = {
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: ItemsFormData;
  saving: boolean;
  onClose: () => void;
  onFieldChange: <K extends keyof ItemsFormData>(field: K, value: ItemsFormData[K]) => void;
  onSubmit: () => Promise<void>;
};

export function ItemsModal({ visible, mode, formData, saving, onClose, onFieldChange, onSubmit }: ItemsModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';

  return (
    <Modal
      title={mode === 'create' ? '新增装备' : mode === 'edit' ? '编辑装备' : '查看装备'}
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
      style={{ width: 820 }}
    >
      <Form layout="vertical">
        <Form.Item label="itemId">
          <Input
            value={formData.itemId}
            disabled={readOnly || editingExisting}
            onChange={(value) => onFieldChange('itemId', value)}
            placeholder="请输入 itemId"
          />
        </Form.Item>

        <div className="crud-form-grid">
          <Form.Item label="名称">
            <Input value={formData.name} disabled={readOnly} onChange={(value) => onFieldChange('name', value)} placeholder="请输入名称" />
          </Form.Item>

          <Form.Item label="goldCost">
            <Input
              value={formData.goldCost}
              disabled={readOnly}
              onChange={(value) => onFieldChange('goldCost', value)}
              placeholder="请输入 goldCost"
            />
          </Form.Item>
        </div>

        <Form.Item label="iconUrl">
          <Input
            value={formData.iconUrl}
            disabled={readOnly}
            onChange={(value) => onFieldChange('iconUrl', value)}
            placeholder="可选"
          />
        </Form.Item>

        <Form.Item label="statsModifier">
          <Input.TextArea
            value={formData.statsModifierText}
            disabled={readOnly}
            autoSize={{ minRows: 8, maxRows: 14 }}
            onChange={(value) => onFieldChange('statsModifierText', value)}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Form.Item>

        <Form.Item label="skillRefs">
          <Input.TextArea
            value={formData.skillRefsText}
            disabled={readOnly}
            autoSize={{ minRows: 4, maxRows: 8 }}
            onChange={(value) => onFieldChange('skillRefsText', value)}
            placeholder="[\n  \n]"
            className="admin-json-input"
          />
        </Form.Item>

        <Form.Item label="recipeIds">
          <Input.TextArea
            value={formData.recipeIdsText}
            disabled={readOnly}
            autoSize={{ minRows: 4, maxRows: 8 }}
            onChange={(value) => onFieldChange('recipeIdsText', value)}
            placeholder="[\n  \n]"
            className="admin-json-input"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
