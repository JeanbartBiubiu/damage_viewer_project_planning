import { Button, Form, Input, Modal, Select, Space } from '@arco-design/web-react';
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
        <Form.Item label="attrKey">
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

          <Form.Item label="属性类型">
            <Input
              value="number"
              disabled
              placeholder="固定为 number"
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

          <Form.Item label="valueKind">
            <Select
              disabled={readOnly}
              value={formData.valueKind || undefined}
              onChange={(value) => onFieldChange('valueKind', value ?? '')}
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

        <Form.Item label="rateTargetAttrKey">
          <AttributeKeySelector
            apiBaseUrl={apiBaseUrl}
            gameId={selectedGameId}
            token={adminToken}
            mode="single"
            valueMode="attrKey"
            value={formData.rateTargetAttrKey}
            disabled={readOnly || formData.valueKind !== 'rate'}
            onChange={(value) => onFieldChange('rateTargetAttrKey', typeof value === 'string' ? value : '')}
            placeholder={formData.valueKind === 'rate' ? '请选择比率目标属性' : '仅 valueKind=rate 时可设置'}
            helperText={formData.valueKind === 'rate' ? undefined : '当 valueKind 为 rate 时，再选择关联目标属性。'}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
