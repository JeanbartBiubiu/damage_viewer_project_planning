import { Button, Form, Input, Modal, Space } from '@arco-design/web-react';
import type { SkillsFormData } from './types';

type SkillsModalProps = {
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: SkillsFormData;
  saving: boolean;
  onClose: () => void;
  onFieldChange: <K extends keyof SkillsFormData>(field: K, value: SkillsFormData[K]) => void;
  onSubmit: () => Promise<void>;
};

export function SkillsModal({ visible, mode, formData, saving, onClose, onFieldChange, onSubmit }: SkillsModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';

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
      style={{ width: 860 }}
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

        <div className="crud-form-grid">
          <Form.Item label="ownerType">
            <Input
              value={formData.ownerType}
              disabled={readOnly}
              onChange={(value) => onFieldChange('ownerType', value)}
              placeholder="请输入 ownerType"
            />
          </Form.Item>

          <Form.Item label="ownerId">
            <Input value={formData.ownerId} disabled={readOnly} onChange={(value) => onFieldChange('ownerId', value)} placeholder="请输入 ownerId" />
          </Form.Item>
        </div>

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

        <Form.Item label="resourceCosts">
          <Input.TextArea
            value={formData.resourceCostsText}
            disabled={readOnly}
            autoSize={{ minRows: 4, maxRows: 8 }}
            onChange={(value) => onFieldChange('resourceCostsText', value)}
            placeholder="[\n  \n]"
            className="admin-json-input"
          />
        </Form.Item>

        <Form.Item label="cooldowns">
          <Input.TextArea
            value={formData.cooldownsText}
            disabled={readOnly}
            autoSize={{ minRows: 4, maxRows: 8 }}
            onChange={(value) => onFieldChange('cooldownsText', value)}
            placeholder="[\n  \n]"
            className="admin-json-input"
          />
        </Form.Item>

        <Form.Item label="params">
          <Input.TextArea
            value={formData.paramsText}
            disabled={readOnly}
            autoSize={{ minRows: 6, maxRows: 10 }}
            onChange={(value) => onFieldChange('paramsText', value)}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Form.Item>

        <Form.Item label="timingProfile">
          <Input.TextArea
            value={formData.timingProfileText}
            disabled={readOnly}
            autoSize={{ minRows: 6, maxRows: 10 }}
            onChange={(value) => onFieldChange('timingProfileText', value)}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Form.Item>

        <Form.Item label="mechanicsConfig">
          <Input.TextArea
            value={formData.mechanicsConfigText}
            disabled={readOnly}
            autoSize={{ minRows: 8, maxRows: 14 }}
            onChange={(value) => onFieldChange('mechanicsConfigText', value)}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
