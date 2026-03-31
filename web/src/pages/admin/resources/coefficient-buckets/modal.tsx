import { Button, Form, Input, Modal, Select, Space } from '@arco-design/web-react';
import { AttributeKeySelector } from '../../../../components/AttributeKeySelector';
import {
  COEFFICIENT_BUCKET_AGGREGATION_MODE_OPTIONS,
  COEFFICIENT_BUCKET_RESOLUTION_DOMAIN_OPTIONS
} from './constants';
import type { CoefficientBucketsFormData } from './types';

type CoefficientBucketsModalProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: CoefficientBucketsFormData;
  saving: boolean;
  onClose: () => void;
  onFieldChange: <K extends keyof CoefficientBucketsFormData>(field: K, value: CoefficientBucketsFormData[K]) => void;
  onSubmit: () => Promise<void>;
};

export function CoefficientBucketsModal({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  visible,
  mode,
  formData,
  saving,
  onClose,
  onFieldChange,
  onSubmit
}: CoefficientBucketsModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';

  return (
    <Modal
      title={mode === 'create' ? '新增乘区桶' : mode === 'edit' ? '编辑乘区桶' : '查看乘区桶'}
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
        <Form.Item label="bucketKey">
          <Input
            value={formData.bucketKey}
            disabled={readOnly || editingExisting}
            onChange={(value) => onFieldChange('bucketKey', value)}
            placeholder="例如 magic_damage.percent_bonus"
          />
        </Form.Item>

        <div className="crud-form-grid">
          <Form.Item label="作用域">
            <Select
              disabled={readOnly}
              value={formData.resolutionDomain || undefined}
              onChange={(value) => onFieldChange('resolutionDomain', value ?? '')}
              placeholder="请选择"
            >
              {COEFFICIENT_BUCKET_RESOLUTION_DOMAIN_OPTIONS.map((option) => (
                <Select.Option key={option.value} value={option.value}>
                  {option.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item label="聚合方式">
            <Select
              disabled={readOnly}
              value={formData.aggregationMode || undefined}
              onChange={(value) => onFieldChange('aggregationMode', value ?? '')}
              placeholder="请选择"
            >
              {COEFFICIENT_BUCKET_AGGREGATION_MODE_OPTIONS.map((option) => (
                <Select.Option key={option.value} value={option.value}>
                  {option.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </div>

        <div className="crud-form-grid">
          <Form.Item label="stageKey">
            <Input
              value={formData.stageKey}
              disabled={readOnly}
              onChange={(value) => onFieldChange('stageKey', value)}
              placeholder="请输入 stageKey"
            />
          </Form.Item>

          <Form.Item label="targetAttrKey">
            <AttributeKeySelector
              apiBaseUrl={apiBaseUrl}
              gameId={selectedGameId}
              token={adminToken}
              mode="single"
              valueMode="attrKey"
              value={formData.targetAttrKey}
              disabled={readOnly}
              onChange={(value) => onFieldChange('targetAttrKey', typeof value === 'string' ? value : '')}
              placeholder="可选，选择目标属性"
            />
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

        <Form.Item label="editorHint">
          <Input.TextArea
            value={formData.editorHintText}
            disabled={readOnly}
            autoSize={{ minRows: 6, maxRows: 12 }}
            onChange={(value) => onFieldChange('editorHintText', value)}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Form.Item>

        <Form.Item label="bucketConfig">
          <Input.TextArea
            value={formData.bucketConfigText}
            disabled={readOnly}
            autoSize={{ minRows: 8, maxRows: 14 }}
            onChange={(value) => onFieldChange('bucketConfigText', value)}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
