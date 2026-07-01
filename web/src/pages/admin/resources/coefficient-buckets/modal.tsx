import { Button, Form, Input, Modal, Select, Space, Typography } from '@arco-design/web-react';
import { useEffect } from 'react';
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
  const targetAttrDisabled = readOnly || formData.resolutionDomain === 'hp_change';

  useEffect(() => {
    if (readOnly) {
      return;
    }
    if (formData.resolutionDomain === 'hp_change' && formData.targetAttrKey.trim()) {
      onFieldChange('targetAttrKey', '');
    }
  }, [formData.resolutionDomain, formData.targetAttrKey, onFieldChange, readOnly]);

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
      style={{ width: '90vw', maxWidth: 1280 }}
    >
      <Form layout="vertical">
        <Form.Item label="桶键">
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
              onChange={(value) => onFieldChange('resolutionDomain', String(value ?? ''))}
              placeholder="选择作用域"
              options={COEFFICIENT_BUCKET_RESOLUTION_DOMAIN_OPTIONS}
            />
          </Form.Item>

          <Form.Item label="聚合方式">
            <Select
              disabled={readOnly}
              value={formData.aggregationMode || undefined}
              onChange={(value) => onFieldChange('aggregationMode', String(value ?? ''))}
              placeholder="选择聚合方式"
              options={COEFFICIENT_BUCKET_AGGREGATION_MODE_OPTIONS}
            />
          </Form.Item>
        </div>

        <div className="crud-form-grid">
          <Form.Item label="阶段键">
            <Input
              value={formData.stageKey}
              disabled={readOnly}
              onChange={(value) => onFieldChange('stageKey', value)}
              placeholder="例如 percent_bonus"
            />
          </Form.Item>

          <Form.Item label="目标属性">
            <div>
              <AttributeKeySelector
                apiBaseUrl={apiBaseUrl}
                gameId={selectedGameId}
                token={adminToken}
                mode="single"
                valueMode="attrKey"
                value={formData.targetAttrKey}
                disabled={targetAttrDisabled}
                onChange={(value) => onFieldChange('targetAttrKey', typeof value === 'string' ? value : '')}
                placeholder={formData.resolutionDomain === 'hp_change' ? '生命变化模式下不使用该字段' : '选择目标属性'}
              />
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
                {formData.resolutionDomain === 'attribute'
                  ? '属性模式下必须指定目标属性。'
                  : '生命变化模式下不会使用目标属性，切换时会自动清空该字段。'}
              </Typography.Text>
            </div>
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

        <Form.Item label="编辑提示">
          <Input.TextArea
            value={formData.editorHintText}
            disabled={readOnly}
            autoSize={{ minRows: 6, maxRows: 12 }}
            onChange={(value) => onFieldChange('editorHintText', value)}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Form.Item>

        <Form.Item label="桶配置">
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
