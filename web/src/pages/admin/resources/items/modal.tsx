import { Alert, Button, Collapse, Form, Input, Modal, Space } from '@arco-design/web-react';
import { useMemo } from 'react';
import { ResourceImageUploadField } from '../../../../components/ResourceImageUploadField';
import { TypeTagEditor } from '../../../../components/TypeTagEditor';
import { BaseStatsEditor } from '../../../../components/hero-editor/BaseStatsEditor';
import { parseBaseStatsRows, stringifyBaseStatsRows } from '../../../../components/hero-editor/heroStats';
import { ItemRecipeSelector } from '../../../../components/item-editor/ItemRecipeSelector';
import { SkillRefSelector } from '../../../../components/item-editor/SkillRefSelector';
import type { TypeDefinition } from '../../../../types/api';
import type { ItemsFormData } from './types';

type ItemsModalProps = {
  typeDefinitions: TypeDefinition[];
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: ItemsFormData;
  saving: boolean;
  imageUri: string | null;
  imageSrc: string | null;
  imageUploading: boolean;
  imageError?: string | null;
  onClose: () => void;
  onFieldChange: <K extends keyof ItemsFormData>(field: K, value: ItemsFormData[K]) => void;
  onUploadImage: (file: File) => Promise<void>;
  onSubmit: () => Promise<void>;
};

export function ItemsModal({
  typeDefinitions,
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
  imageError = null,
  onClose,
  onFieldChange,
  onUploadImage,
  onSubmit
}: ItemsModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';

  const statsModifierState = useMemo(() => {
    try {
      return { rows: parseBaseStatsRows(formData.statsModifierText), error: null as string | null };
    } catch (error) {
      return { rows: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [formData.statsModifierText]);

  const skillRefsState = useMemo(() => {
    try {
      const parsed = JSON.parse(formData.skillRefsText.trim() || '[]') as unknown;
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
        throw new Error('skillRefs 必须是字符串数组。');
      }
      return { value: parsed as string[], error: null as string | null };
    } catch (error) {
      return { value: [] as string[], error: error instanceof Error ? error.message : String(error) };
    }
  }, [formData.skillRefsText]);

  const recipeIdsState = useMemo(() => {
    try {
      const parsed = JSON.parse(formData.recipeIdsText.trim() || '[]') as unknown;
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
        throw new Error('recipeIds 必须是字符串数组。');
      }
      return { value: parsed as string[], error: null as string | null };
    } catch (error) {
      return { value: [] as string[], error: error instanceof Error ? error.message : String(error) };
    }
  }, [formData.recipeIdsText]);

  return (
    <Modal
      title={mode === 'create' ? '新增装备' : mode === 'edit' ? '编辑装备' : '查看装备'}
      visible={visible}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>{readOnly ? '关闭' : '取消'}</Button>
          {!readOnly ? (
            <Button type="primary" loading={saving || imageUploading} onClick={() => void onSubmit()}>
              保存
            </Button>
          ) : null}
        </Space>
      }
      autoFocus={false}
      focusLock
      style={{ width: 1180 }}
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

        <Form.Item label="装备图片">
          <ResourceImageUploadField
            src={imageSrc}
            alt={formData.name || formData.itemId || '装备图片'}
            imageUri={imageUri}
            uriPlaceholder="请先填写 itemId 以生成图片标识。"
            readOnly={readOnly}
            uploading={imageUploading}
            error={imageError}
            emptyLabel="未上传"
            helperText="缓存未命中时仅显示占位图。上传时会先居中裁切，再转成 64x64 后同步写入服务端和本地 IndexedDB。"
            onUpload={onUploadImage}
          />
        </Form.Item>

        <Form.Item label="类型标签">
          <TypeTagEditor
            definitions={typeDefinitions}
            persistedTypeIds={formData.persistedTypeIds}
            value={formData.selectedTypeIds}
            onChange={(value) => onFieldChange('selectedTypeIds', value)}
            disabled={readOnly || (mode === 'create' && !formData.itemId.trim())}
          />
        </Form.Item>

        <Form.Item label="statsModifier 结构化编辑">
          {statsModifierState.error ? <Alert type="error" content={`statsModifier 解析失败：${statsModifierState.error}`} style={{ marginBottom: 12 }} /> : null}
          <BaseStatsEditor
            apiBaseUrl={apiBaseUrl}
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            rows={statsModifierState.rows}
            disabled={readOnly || !!statsModifierState.error}
            onChange={(rows) => onFieldChange('statsModifierText', stringifyBaseStatsRows(rows))}
          />
        </Form.Item>

        <Form.Item label="skillRefs 结构化编辑">
          {skillRefsState.error ? <Alert type="error" content={`skillRefs 解析失败：${skillRefsState.error}`} style={{ marginBottom: 12 }} /> : null}
          <SkillRefSelector
            apiBaseUrl={apiBaseUrl}
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            value={skillRefsState.value}
            disabled={readOnly || !!skillRefsState.error}
            onChange={(value) => onFieldChange('skillRefsText', JSON.stringify(value, null, 2))}
          />
        </Form.Item>

        <Form.Item label="recipeIds 结构化编辑">
          {recipeIdsState.error ? <Alert type="error" content={`recipeIds 解析失败：${recipeIdsState.error}`} style={{ marginBottom: 12 }} /> : null}
          <ItemRecipeSelector
            apiBaseUrl={apiBaseUrl}
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            currentItemId={formData.itemId}
            value={recipeIdsState.value}
            disabled={readOnly || !!recipeIdsState.error}
            onChange={(value) => onFieldChange('recipeIdsText', JSON.stringify(value, null, 2))}
          />
        </Form.Item>

        <Collapse defaultActiveKey={[]} style={{ marginTop: 8 }}>
          <Collapse.Item name="advanced-json" header="高级 JSON 编辑（双向同步）">
            <Form.Item label="statsModifier JSON">
              <Input.TextArea
                value={formData.statsModifierText}
                disabled={readOnly}
                autoSize={{ minRows: 8, maxRows: 14 }}
                onChange={(value) => onFieldChange('statsModifierText', value)}
                placeholder="{\n  \n}"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="skillRefs JSON">
              <Input.TextArea
                value={formData.skillRefsText}
                disabled={readOnly}
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(value) => onFieldChange('skillRefsText', value)}
                placeholder="[\n  \n]"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="recipeIds JSON">
              <Input.TextArea
                value={formData.recipeIdsText}
                disabled={readOnly}
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(value) => onFieldChange('recipeIdsText', value)}
                placeholder="[\n  \n]"
                className="admin-json-input"
              />
            </Form.Item>
          </Collapse.Item>
        </Collapse>
      </Form>
    </Modal>
  );
}
