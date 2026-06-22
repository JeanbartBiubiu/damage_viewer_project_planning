import { Button, Checkbox, Form, Input, Modal, Select, Space } from '@arco-design/web-react';
import { AttributeKeySelector } from '../../../../components/AttributeKeySelector';
import { ResourceImageUploadField } from '../../../../components/ResourceImageUploadField';
import { ATTRIBUTE_VALUE_KIND_OPTIONS } from './constants';
import type { AttributeDefinitionsFormData } from './types';

type AttributeDefinitionsModalProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: AttributeDefinitionsFormData;
  saving: boolean;
  imageUri: string | null;
  imageSrc: string | null;
  imageUploading: boolean;
  imageError: string | null;
  onClose: () => void;
  onFieldChange: <K extends keyof AttributeDefinitionsFormData>(field: K, value: AttributeDefinitionsFormData[K]) => void;
  onUploadImage: (file: File) => Promise<void> | void;
  onSubmit: () => Promise<void>;
};

export function AttributeDefinitionsModal({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  visible,
  mode,
  formData,
  saving,
  imageUri,
  imageSrc,
  imageUploading,
  imageError,
  onClose,
  onFieldChange,
  onUploadImage,
  onSubmit
}: AttributeDefinitionsModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';

  return (
    <Modal
      title={mode === 'create' ? '新增属性定义' : mode === 'edit' ? '编辑属性定义' : '查看属性定义'}
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
        <Form.Item label="属性 Key">
          <Input
            value={formData.attrKey}
            disabled={readOnly || editingExisting}
            onChange={(value) => onFieldChange('attrKey', value)}
            placeholder="请输入 attrKey"
          />
        </Form.Item>

        <Form.Item label="属性图片">
          <ResourceImageUploadField
            src={imageSrc}
            alt={formData.attrName || formData.attrKey || '属性图片'}
            imageUri={imageUri}
            uriPlaceholder="请先填写 attrKey 以生成图片标识。"
            readOnly={readOnly}
            uploading={imageUploading}
            error={imageError}
            emptyLabel="未上传"
            helperText="上传时会先居中裁切为 64x64 图标，再同步写入服务端和本地 IndexedDB。"
            onUpload={onUploadImage}
          />
        </Form.Item>

        <div className="crud-form-grid">
          <Form.Item label="属性名称">
            <Input
              value={formData.attrName}
              disabled={readOnly}
              onChange={(value) => onFieldChange('attrName', value)}
              placeholder="请输入属性名称"
            />
          </Form.Item>
        </div>

        <div className="crud-form-grid">
          <Form.Item label="默认值">
            <Input
              value={formData.defaultValue}
              disabled={readOnly}
              onChange={(value) => onFieldChange('defaultValue', value)}
              placeholder="请输入默认值"
            />
          </Form.Item>

          <Form.Item label="排序">
            <Input
              value={formData.order}
              disabled={readOnly}
              onChange={(value) => onFieldChange('order', value)}
              placeholder="请输入排序值"
            />
          </Form.Item>

        </div>

        <div className="crud-form-grid">
          <Form.Item label="取值语义">
            <Select
              disabled={readOnly}
              value={formData.valueKind || undefined}
              onChange={(value) => {
                onFieldChange('valueKind', value ?? '');
                if (value !== 'rate') {
                  onFieldChange('rateTargetAttrKey', '');
                }
              }}
              placeholder="请选择"
            >
              {ATTRIBUTE_VALUE_KIND_OPTIONS.map((option) => (
                <Select.Option key={option.value} value={option.value}>
                  {option.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </div>

        {formData.valueKind === 'rate' ? (
          <Form.Item label="比率目标属性 Key">
            <AttributeKeySelector
              apiBaseUrl={apiBaseUrl}
              gameId={selectedGameId}
              token={adminToken}
              mode="single"
              valueMode="attrKey"
              value={formData.rateTargetAttrKey}
              disabled={readOnly}
              onChange={(value) => onFieldChange('rateTargetAttrKey', typeof value === 'string' ? value : '')}
              placeholder="请选择比率目标属性"
            />
          </Form.Item>
        ) : null}

        <Form.Item label="数值边界（minValue / maxValue）">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div className="crud-form-grid">
              <Checkbox
                checked={formData.hasMinValue}
                disabled={readOnly}
                onChange={(checked) => onFieldChange('hasMinValue', checked)}
              >
                启用下界 minValue
              </Checkbox>
              <Input
                value={formData.minValue}
                disabled={readOnly || !formData.hasMinValue}
                onChange={(value) => onFieldChange('minValue', value)}
                placeholder="minValue"
              />
            </div>
            <div className="crud-form-grid">
              <Checkbox
                checked={formData.hasMaxValue}
                disabled={readOnly}
                onChange={(checked) => onFieldChange('hasMaxValue', checked)}
              >
                启用上界 maxValue
              </Checkbox>
              <Input
                value={formData.maxValue}
                disabled={readOnly || !formData.hasMaxValue}
                onChange={(value) => onFieldChange('maxValue', value)}
                placeholder="maxValue"
              />
            </div>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
}
