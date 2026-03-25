import { Button, Form, Input, Modal, Space } from '@arco-design/web-react';
import type { HeroesFormData } from './types';

type HeroesModalProps = {
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: HeroesFormData;
  saving: boolean;
  onClose: () => void;
  onFieldChange: <K extends keyof HeroesFormData>(field: K, value: HeroesFormData[K]) => void;
  onSubmit: () => Promise<void>;
};

export function HeroesModal({ visible, mode, formData, saving, onClose, onFieldChange, onSubmit }: HeroesModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';

  return (
    <Modal
      title={mode === 'create' ? '新增英雄' : mode === 'edit' ? '编辑英雄' : '查看英雄'}
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
        <Form.Item label="heroId">
          <Input
            value={formData.heroId}
            disabled={readOnly || editingExisting}
            onChange={(value) => onFieldChange('heroId', value)}
            placeholder="请输入 heroId"
          />
        </Form.Item>

        <div className="crud-form-grid">
          <Form.Item label="名称">
            <Input value={formData.name} disabled={readOnly} onChange={(value) => onFieldChange('name', value)} placeholder="请输入名称" />
          </Form.Item>

          <Form.Item label="称号">
            <Input value={formData.title} disabled={readOnly} onChange={(value) => onFieldChange('title', value)} placeholder="请输入称号" />
          </Form.Item>
        </div>

        <Form.Item label="avatarUrl">
          <Input
            value={formData.avatarUrl}
            disabled={readOnly}
            onChange={(value) => onFieldChange('avatarUrl', value)}
            placeholder="可选"
          />
        </Form.Item>

        <Form.Item label="baseStats">
          <Input.TextArea
            value={formData.baseStatsText}
            disabled={readOnly}
            autoSize={{ minRows: 8, maxRows: 14 }}
            onChange={(value) => onFieldChange('baseStatsText', value)}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Form.Item>

        <Form.Item label="statsByLevel">
          <Input.TextArea
            value={formData.statsByLevelText}
            disabled={readOnly}
            autoSize={{ minRows: 8, maxRows: 14 }}
            onChange={(value) => onFieldChange('statsByLevelText', value)}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
