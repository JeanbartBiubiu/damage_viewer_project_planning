import { Alert, Button, Form, Input, Modal, Radio, Space, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { ResourceImageThumb } from '../../../components/ResourceImageThumb';
import { ResourceImageUploadField } from '../../../components/ResourceImageUploadField';
import { getErrorMessage } from '../../../services/apiClient';
import { createImage, updateImage } from '../../../services/imageClient';
import { normalizeImageKey, prepareResourceImage, type PreparedResourceImage } from '../../../services/resourceImage';
import type { ManagedImage } from '../../../types/image';
import { mapImageDraftErrors, validateImageDraft, type ImageDraft, type ImageDraftErrors } from './imageForm';

export type ImageEditorMode = 'create' | 'view' | 'edit';

type ImageEditorModalProps = {
  visible: boolean;
  mode: ImageEditorMode;
  image: ManagedImage | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onSaved: (image: ManagedImage) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
};

const EMPTY_DRAFT: ImageDraft = {
  imageKey: '',
  name: '',
  description: '',
  enabled: true
};

function titleFor(mode: ImageEditorMode): string {
  if (mode === 'create') return '新建图片';
  if (mode === 'edit') return '编辑图片';
  return '查看图片';
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function preparedMetadata(image: PreparedResourceImage): string {
  const result = `${image.mimeType === 'image/png' ? 'PNG' : 'JPEG'}，${image.width} × ${image.height}，${formatBytes(image.byteSize)}`;
  return image.transformed
    ? `原图 ${image.sourceWidth} × ${image.sourceHeight}；已在浏览器处理为 ${result}`
    : `小图保持原内容：${result}`;
}

export function ImageEditorModal({
  visible,
  mode,
  image,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSaved,
  onDirtyChange
}: ImageEditorModalProps) {
  const initial = useMemo<ImageDraft>(() => image ? {
    imageKey: image.imageKey,
    name: image.name,
    description: image.description ?? '',
    enabled: image.enabled
  } : EMPTY_DRAFT, [image]);
  const [draft, setDraft] = useState<ImageDraft>(initial);
  const [errors, setErrors] = useState<ImageDraftErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedResourceImage | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const readOnly = mode === 'view';

  useEffect(() => {
    if (!visible) return;
    setDraft(initial);
    setErrors({});
    setSaveError(null);
    setPrepared(null);
    setFileName(null);
    setSelectionError(null);
    setProcessing(false);
    setSaving(false);
    setDirty(false);
    onDirtyChange(false);
  }, [initial, onDirtyChange, visible]);

  const markDirty = (nextDraft: ImageDraft, hasPrepared = prepared !== null) => {
    const nextDirty = JSON.stringify(nextDraft) !== JSON.stringify(initial) || hasPrepared;
    setDirty(nextDirty);
    onDirtyChange(nextDirty);
  };

  const patchDraft = <K extends keyof ImageDraft>(field: K, value: ImageDraft[K]) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaveError(null);
    markDirty(next);
  };

  const selectFile = async (file: File) => {
    setProcessing(true);
    setSelectionError(null);
    setErrors((current) => ({ ...current, image: undefined }));
    setPrepared(null);
    setFileName(file.name);
    try {
      const next = await prepareResourceImage(file);
      setPrepared(next);
      markDirty(draft, true);
    } catch (error) {
      const message = getErrorMessage(error);
      setSelectionError(message);
      setErrors((current) => ({ ...current, image: message }));
      markDirty(draft, false);
    } finally {
      setProcessing(false);
    }
  };

  const close = () => {
    if (saving || processing) return;
    if (dirty && !window.confirm('当前图片修改尚未保存，确定关闭吗？')) return;
    onDirtyChange(false);
    onClose();
  };

  const save = async () => {
    if (selectionError) {
      setErrors((current) => ({ ...current, image: selectionError }));
      return;
    }
    const nextErrors = validateImageDraft(draft, mode === 'create', mode === 'create', prepared !== null);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    if (!selectedGameId) {
      setSaveError('请先选择游戏。');
      return;
    }
    const token = adminToken.trim();
    if (!token) {
      setSaveError('请先配置 Admin Token。');
      return;
    }
    if (image?.enabled && !draft.enabled && !window.confirm(`确定停用图片“${image.name}”吗？`)) {
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const result = mode === 'create'
        ? await createImage(apiBaseUrl, selectedGameId, token, {
            imageKey: normalizeImageKey(draft.imageKey)!,
            name: draft.name.trim(),
            description: draft.description.trim() || null,
            imageBase64: prepared!.imageBase64
          })
        : await updateImage(apiBaseUrl, selectedGameId, image!.imageKey, token, {
            name: draft.name.trim(),
            description: draft.description.trim() || null,
            enabled: draft.enabled,
            ...(prepared ? { imageBase64: prepared.imageBase64 } : {})
          });
      setDirty(false);
      onDirtyChange(false);
      await onSaved(result.data);
    } catch (error) {
      setErrors(mapImageDraftErrors(error));
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const currentMetadata = image
    ? `${image.mimeType === 'image/png' ? 'PNG' : 'JPEG'}，${image.width} × ${image.height}，${formatBytes(image.byteSize)}`
    : null;

  return (
    <Modal
      title={titleFor(mode)}
      visible={visible}
      maskClosable
      onCancel={close}
      style={{ width: 720 }}
      footer={
        <Space>
          <Button onClick={close} disabled={saving || processing}>{readOnly ? '关闭' : '取消'}</Button>
          {!readOnly ? (
            <Button type="primary" loading={saving} disabled={processing} onClick={() => void save()}>保存</Button>
          ) : null}
        </Space>
      }
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        {saveError ? <Alert type="error" content={saveError} /> : null}
        <Form layout="vertical">
          <Form.Item
            label="图片标识"
            required
            validateStatus={errors.imageKey ? 'error' : undefined}
            help={errors.imageKey}
          >
            <Input
              aria-label="图片标识"
              value={draft.imageKey}
              disabled={readOnly || mode === 'edit' || saving}
              maxLength={128}
              onChange={(value) => patchDraft('imageKey', value)}
            />
          </Form.Item>
          <Form.Item
            label="图片名称"
            required
            validateStatus={errors.name ? 'error' : undefined}
            help={errors.name}
          >
            <Input
              aria-label="图片名称"
              value={draft.name}
              disabled={readOnly || saving}
              maxLength={100}
              onChange={(value) => patchDraft('name', value)}
            />
          </Form.Item>
          <Form.Item
            label="图片说明"
            validateStatus={errors.description ? 'error' : undefined}
            help={errors.description}
          >
            <Input.TextArea
              aria-label="图片说明"
              value={draft.description}
              disabled={readOnly || saving}
              maxLength={2000}
              showWordLimit
              autoSize={{ minRows: 3, maxRows: 8 }}
              onChange={(value) => patchDraft('description', value)}
            />
          </Form.Item>
          {mode !== 'create' ? (
            <Form.Item label="状态" validateStatus={errors.enabled ? 'error' : undefined} help={errors.enabled}>
              <Radio.Group
                aria-label="图片状态"
                type="button"
                value={draft.enabled ? 'enabled' : 'disabled'}
                disabled={readOnly || saving}
                onChange={(value) => patchDraft('enabled', value === 'enabled')}
              >
                <Radio value="enabled">启用</Radio>
                <Radio value="disabled">停用</Radio>
              </Radio.Group>
            </Form.Item>
          ) : null}
          <Form.Item
            label={mode === 'create' ? '图片文件' : '图片内容'}
            required={mode === 'create'}
            validateStatus={errors.image ? 'error' : undefined}
          >
            {readOnly ? (
              <ResourceImageUploadField
                src={image?.imageBase64 ?? null}
                alt={image?.name ?? '图片'}
                readOnly
                metadataText={currentMetadata}
                onSelect={() => undefined}
              />
            ) : prepared && image ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
                <div className="detail-grid-item">
                  <Typography.Text type="secondary">当前图片</Typography.Text>
                  <ResourceImageThumb src={image.imageBase64} alt={`${image.name} 当前图片`} size={96} />
                  <Typography.Text>{currentMetadata}</Typography.Text>
                </div>
                <ResourceImageUploadField
                  src={prepared.imageBase64}
                  alt={`${draft.name || '图片'} 待提交内容`}
                  processing={processing}
                  error={errors.image}
                  metadataText={`${fileName ?? '新图片'}；${preparedMetadata(prepared)}；将替换图片内容`}
                  onSelect={selectFile}
                />
              </div>
            ) : (
              <ResourceImageUploadField
                src={prepared?.imageBase64 ?? image?.imageBase64 ?? null}
                alt={draft.name || '图片待提交内容'}
                processing={processing}
                error={errors.image}
                buttonText={mode === 'edit' ? '选择替换图片' : undefined}
                metadataText={prepared ? `${fileName ?? '图片'}；${preparedMetadata(prepared)}` : currentMetadata}
                onSelect={selectFile}
              />
            )}
          </Form.Item>
        </Form>
        {image ? (
          <div className="detail-grid">
            <div className="detail-grid-item">
              <span className="detail-grid-label">创建时间</span>
              <span className="detail-grid-value">{formatDate(image.createdAt)}</span>
            </div>
            <div className="detail-grid-item">
              <span className="detail-grid-label">更新时间</span>
              <span className="detail-grid-value">{formatDate(image.updatedAt)}</span>
            </div>
          </div>
        ) : null}
      </Space>
    </Modal>
  );
}
