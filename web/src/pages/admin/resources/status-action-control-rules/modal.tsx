import { Button, Form, Input, Modal, Select, Space } from '@arco-design/web-react';
import { STATUS_ACTION_CONTROL_RULE_KIND_OPTIONS } from './constants';
import type { StatusActionControlRulesFormData } from './types';

type StatusActionControlRulesModalProps = {
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: StatusActionControlRulesFormData;
  saving: boolean;
  onClose: () => void;
  onFieldChange: <K extends keyof StatusActionControlRulesFormData>(
    field: K,
    value: StatusActionControlRulesFormData[K]
  ) => void;
  onSubmit: () => Promise<void>;
};

export function StatusActionControlRulesModal({
  visible,
  mode,
  formData,
  saving,
  onClose,
  onFieldChange,
  onSubmit
}: StatusActionControlRulesModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';

  return (
    <Modal
      title={mode === 'create' ? '新增状态动作规则' : mode === 'edit' ? '编辑状态动作规则' : '查看状态动作规则'}
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
        <div className="crud-form-grid">
          <Form.Item label="ruleId">
            <Input
              value={formData.ruleId}
              disabled={readOnly || editingExisting}
              onChange={(value) => onFieldChange('ruleId', value)}
              placeholder="例如 status_stun_forbid_cast"
            />
          </Form.Item>

          <Form.Item label="statusTypeId">
            <Input
              value={formData.statusTypeId}
              disabled={readOnly}
              onChange={(value) => onFieldChange('statusTypeId', value)}
              placeholder="请输入 statusTypeId"
            />
          </Form.Item>
        </div>

        <div className="crud-form-grid">
          <Form.Item label="ruleKind">
            <Select
              disabled={readOnly}
              value={formData.ruleKind || undefined}
              onChange={(value) => onFieldChange('ruleKind', value ?? '')}
              placeholder="请选择"
            >
              {STATUS_ACTION_CONTROL_RULE_KIND_OPTIONS.map((option) => (
                <Select.Option key={option.value} value={option.value}>
                  {option.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item label="priority">
            <Input
              value={formData.priority}
              disabled={readOnly}
              onChange={(value) => onFieldChange('priority', value)}
              placeholder="请输入 priority"
            />
          </Form.Item>
        </div>

        <Form.Item label="actionTypeIds">
          <Input.TextArea
            value={formData.actionTypeIdsText}
            disabled={readOnly}
            autoSize={{ minRows: 4, maxRows: 8 }}
            onChange={(value) => onFieldChange('actionTypeIdsText', value)}
            placeholder="[\n  50101\n]"
            className="admin-json-input"
          />
        </Form.Item>

        <Form.Item label="actionMatchTypeIds">
          <Input.TextArea
            value={formData.actionMatchTypeIdsText}
            disabled={readOnly}
            autoSize={{ minRows: 4, maxRows: 8 }}
            onChange={(value) => onFieldChange('actionMatchTypeIdsText', value)}
            placeholder="[\n  \n]"
            className="admin-json-input"
          />
        </Form.Item>

        <Form.Item label="interruptPhaseTypeIds">
          <Input.TextArea
            value={formData.interruptPhaseTypeIdsText}
            disabled={readOnly}
            autoSize={{ minRows: 4, maxRows: 8 }}
            onChange={(value) => onFieldChange('interruptPhaseTypeIdsText', value)}
            placeholder="[\n  \n]"
            className="admin-json-input"
          />
        </Form.Item>

        <Form.Item label="说明">
          <Input.TextArea
            value={formData.description}
            disabled={readOnly}
            autoSize={{ minRows: 3, maxRows: 5 }}
            onChange={(value) => onFieldChange('description', value)}
            placeholder="可选说明"
          />
        </Form.Item>

        <Form.Item label="extend">
          <Input.TextArea
            value={formData.extendText}
            disabled={readOnly}
            autoSize={{ minRows: 6, maxRows: 12 }}
            onChange={(value) => onFieldChange('extendText', value)}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
