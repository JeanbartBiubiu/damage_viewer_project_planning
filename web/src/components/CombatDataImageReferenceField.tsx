import { Alert, Button, Input, Select, Space, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { getErrorMessage, getImages, putImage } from '../services/apiClient';
import {
  clearImageReference,
  displayImageUri,
  isImageReferenceTouched,
  revertImageReference,
  setExactImageReference,
  type ImageReferenceEditState
} from '../services/combatDataImageReference';
import {
  getCachedImage,
  listCachedImages,
  toRemoteUri,
  upsertRemoteImage,
  upsertRemoteImages,
  type CachedImageRecord
} from '../services/imageCache';
import {
  imageAssetUriValidationMessage,
  normalizeImageAssetUri,
  prepareResourceImageAssetUpload
} from '../services/resourceImage';
import { ResourceImageThumb } from './ResourceImageThumb';
import { ResourceImageUploadField } from './ResourceImageUploadField';

export type CombatDataImageReferenceFieldProps = {
  value: ImageReferenceEditState;
  onChange?: (next: ImageReferenceEditState) => void;
  apiBaseUrl: string;
  gameId: string | null;
  adminToken?: string;
  readOnly?: boolean;
  disabled?: boolean;
  /** Field-level error (e.g. 400 details.path=/imageUri). */
  error?: string | null;
  size?: number;
  id?: string;
  /** Compact read-only preview for list/select rows. */
  compact?: boolean;
};

function cachedSrc(record: CachedImageRecord | null | undefined): string | null {
  return record?.image ?? null;
}

export function CombatDataImageReferenceField({
  value,
  onChange,
  apiBaseUrl,
  gameId,
  adminToken = '',
  readOnly = false,
  disabled = false,
  error = null,
  size = 64,
  id,
  compact = false
}: CombatDataImageReferenceFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `combat-image-ref-${reactId}`;
  const statusId = `${fieldId}-status`;

  const bindingUri = displayImageUri(value);
  const touched = isImageReferenceTouched(value);
  const editsLocked = readOnly || disabled || !onChange;

  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'hit' | 'miss'>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [assetOptions, setAssetOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [customDraft, setCustomDraft] = useState(bindingUri ?? '');
  const [uploadUriDraft, setUploadUriDraft] = useState('');
  const [uploadUriError, setUploadUriError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const normalizedUploadUri = normalizeImageAssetUri(uploadUriDraft);
  const token = adminToken.trim();

  const loadPreview = useCallback(
    async (uri: string | null) => {
      if (!gameId || !uri) {
        setPreviewSrc(null);
        setPreviewStatus('idle');
        return;
      }
      setPreviewStatus('loading');
      try {
        const cached = await getCachedImage(gameId, uri);
        if (cached) {
          setPreviewSrc(cachedSrc(cached));
          setPreviewStatus('hit');
        } else {
          setPreviewSrc(null);
          setPreviewStatus('miss');
        }
      } catch {
        setPreviewSrc(null);
        setPreviewStatus('miss');
      }
    },
    [gameId]
  );

  const refreshAssetOptions = useCallback(async () => {
    if (!gameId) {
      setAssetOptions([]);
      return;
    }
    try {
      const rows = await listCachedImages(gameId);
      const options = rows
        .map((row) => {
          const remote = toRemoteUri(gameId, row.uri);
          return { value: remote, label: remote };
        })
        .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
      setAssetOptions(options);
    } catch {
      setAssetOptions([]);
    }
  }, [gameId]);

  useEffect(() => {
    setCustomDraft(bindingUri ?? '');
  }, [bindingUri]);

  useEffect(() => {
    void loadPreview(bindingUri);
  }, [bindingUri, loadPreview]);

  useEffect(() => {
    void refreshAssetOptions();
  }, [refreshAssetOptions]);

  const handleCacheRefresh = async () => {
    if (!gameId) {
      return;
    }
    setRefreshing(true);
    setLocalError(null);
    setStatusMessage('正在刷新图片缓存…');
    try {
      const response = await getImages(apiBaseUrl, gameId);
      await upsertRemoteImages(gameId, response.data.images);
      await refreshAssetOptions();
      if (bindingUri) {
        const cached = await getCachedImage(gameId, bindingUri);
        setPreviewSrc(cachedSrc(cached));
        setPreviewStatus(cached ? 'hit' : 'miss');
      }
      setStatusMessage(`缓存已刷新（${response.data.images.length} 张）。仅更新本地预览，不会改写战斗数据关联。`);
    } catch (err) {
      setLocalError(getErrorMessage(err));
      setStatusMessage(null);
    } finally {
      setRefreshing(false);
    }
  };

  const emit = (next: ImageReferenceEditState) => {
    onChange?.(next);
    setLocalError(null);
  };

  const handleSelectExisting = (next: string | undefined) => {
    if (editsLocked) {
      return;
    }
    if (!next) {
      emit(clearImageReference(value));
      return;
    }
    emit(setExactImageReference(value, next));
  };

  const handleCustomCommit = () => {
    if (editsLocked) {
      return;
    }
    emit(setExactImageReference(value, customDraft));
  };

  const handleUploadAsset = async (file: File) => {
    if (!gameId || editsLocked) {
      return;
    }
    if (!token) {
      setLocalError('上传图片资产需要 Admin Token。');
      return;
    }
    setUploading(true);
    setLocalError(null);
    setStatusMessage('正在上传图片资产…');
    try {
      const prepared = await prepareResourceImageAssetUpload(uploadUriDraft, file);
      const result = await putImage(apiBaseUrl, gameId, prepared.uri, token, prepared.imageBase64);
      await upsertRemoteImage(gameId, result.data);
      await refreshAssetOptions();
      setStatusMessage(
        `已上传资产「${prepared.uri}」。上传不会保存战斗数据关联；请在本字段选择该 URI 后保存资源表单。`
      );
      setUploadUriDraft(prepared.uri);
      setUploadUriError(null);
      // Offer the new asset as the binding draft without forcing save.
      emit(setExactImageReference(value, prepared.uri));
    } catch (err) {
      setLocalError(getErrorMessage(err));
      setStatusMessage(null);
    } finally {
      setUploading(false);
    }
  };

  const previewLabel =
    previewStatus === 'loading'
      ? '预览加载中'
      : previewStatus === 'miss'
        ? '缓存未命中'
        : previewStatus === 'hit'
          ? '缓存预览'
          : '无关联';

  if (compact || (readOnly && !onChange)) {
    return (
      <div className="combat-image-ref combat-image-ref--compact" id={fieldId}>
        <ResourceImageThumb
          src={previewSrc}
          alt={bindingUri ?? '图片关联'}
          size={Math.min(size, 32)}
          emptyLabel={previewStatus === 'miss' ? '无缓存' : '无'}
        />
        <span className="combat-image-ref-uri" title={bindingUri ?? undefined}>
          {bindingUri ?? '（无关联）'}
        </span>
        {previewStatus === 'miss' && bindingUri ? (
          <Typography.Text type="secondary" className="combat-image-ref-miss">
            缓存未命中
          </Typography.Text>
        ) : null}
      </div>
    );
  }

  return (
    <div className="combat-image-ref" id={fieldId} data-combat-field="imageUri">
      <div className="combat-image-ref-preview" aria-label={previewLabel}>
        <ResourceImageThumb
          src={previewSrc}
          alt={bindingUri ?? '图片关联预览'}
          size={size}
          emptyLabel={
            !bindingUri ? '未关联' : previewStatus === 'miss' ? '无缓存' : previewStatus === 'loading' ? '…' : '未关联'
          }
        />
        <div className="combat-image-ref-preview-copy">
          <Typography.Text>
            当前关联：{bindingUri ?? '（无）'}
            {touched ? ' · 已修改' : ' · 保留既有'}
          </Typography.Text>
          <Typography.Text type="secondary">
            {value.original ? `已加载原值：${value.original}` : '无已加载原值（新行默认为空）'}
          </Typography.Text>
          {previewStatus === 'miss' && bindingUri ? (
            <Typography.Text type="secondary">本地缓存未命中；可刷新缓存后重试预览。</Typography.Text>
          ) : null}
        </div>
      </div>

      {!editsLocked ? (
        <div className="combat-image-ref-controls">
          <label className="combat-image-ref-control" htmlFor={`${fieldId}-select`}>
            <span>选择已有同游戏图片</span>
            <Select
              id={`${fieldId}-select`}
              showSearch
              allowClear
              placeholder={gameId ? '搜索本地缓存中的 URI' : '请先选择游戏'}
              value={bindingUri ?? undefined}
              disabled={!gameId || refreshing}
              options={assetOptions}
              filterOption={(input, option) => {
                const optionValue =
                  option && typeof option === 'object' && 'value' in option
                    ? String((option as { value?: unknown }).value ?? '')
                    : '';
                return optionValue.toLowerCase().includes(input.trim().toLowerCase());
              }}
              onChange={(next) => handleSelectExisting(next as string | undefined)}
            />
          </label>

          <label className="combat-image-ref-control" htmlFor={`${fieldId}-custom`}>
            <span>精确绑定文本（不做上传 URI 校验）</span>
            <Space wrap>
              <Input
                id={`${fieldId}-custom`}
                value={customDraft}
                placeholder="原样提交；空白则清除关联"
                onChange={setCustomDraft}
                onPressEnter={handleCustomCommit}
                style={{ minWidth: 220 }}
              />
              <Button type="secondary" onClick={handleCustomCommit}>
                应用精确值
              </Button>
            </Space>
          </label>

          <div className="combat-image-ref-actions">
            <Button
              type="secondary"
              disabled={!gameId || refreshing}
              loading={refreshing}
              onClick={() => void handleCacheRefresh()}
            >
              刷新缓存预览
            </Button>
            <Button type="secondary" onClick={() => emit(clearImageReference(value))}>
              清除关联
            </Button>
            <Button
              type="outline"
              disabled={!touched}
              onClick={() => emit(revertImageReference(value))}
            >
              恢复为保留既有
            </Button>
          </div>

          <div className="combat-image-ref-upload">
            <Typography.Text bold>上传新资产（可选）</Typography.Text>
            <Typography.Text type="secondary">
              使用路由 URI 规则校验并上传到 images；成功后仅写入缓存，需保存资源表单才会持久化关联。
            </Typography.Text>
            <label className="combat-image-ref-control" htmlFor={`${fieldId}-upload-uri`}>
              <span>资产 URI</span>
              <Input
                id={`${fieldId}-upload-uri`}
                value={uploadUriDraft}
                placeholder="例如 character_vayne"
                status={uploadUriError ? 'error' : undefined}
                disabled={uploading || !gameId}
                onChange={(next) => {
                  setUploadUriDraft(next);
                  setUploadUriError(imageAssetUriValidationMessage(next));
                }}
              />
              {uploadUriError ? (
                <Typography.Text type="error">{uploadUriError}</Typography.Text>
              ) : (
                <Typography.Text type="secondary">
                  仅接受稳定单段标识（与图片管理页相同）。
                </Typography.Text>
              )}
            </label>
            <ResourceImageUploadField
              src={null}
              alt={normalizedUploadUri ?? '新图片资产'}
              imageUri={normalizedUploadUri}
              uriPlaceholder="先填写有效的资产 URI"
              uploading={uploading}
              error={null}
              emptyLabel="待上传"
              size={56}
              buttonText={uploading ? '正在上传…' : '选择并上传资产'}
              helperText="上传前居中裁切为 64×64；不会单独保存战斗数据关联。"
              onUpload={handleUploadAsset}
            />
          </div>
        </div>
      ) : null}

      <div id={statusId} className="combat-image-ref-live" role="status" aria-live="polite">
        {statusMessage}
      </div>
      {localError || error ? (
        <Alert type="error" content={localError ?? error} style={{ marginTop: 8 }} />
      ) : null}
      {!gameId ? <Alert type="warning" content="未选择游戏，无法预览或选择同游戏图片。" /> : null}
    </div>
  );
}

/** Lightweight cache-backed thumb + URI for selectors and static context. */
export function CombatDataImageReferencePreview({
  apiBaseUrl: _apiBaseUrl,
  gameId,
  imageUri,
  size = 22,
  emptyLabel = ''
}: {
  apiBaseUrl?: string;
  gameId: string | null;
  imageUri?: string | null;
  size?: number;
  emptyLabel?: string;
}) {
  const uri = typeof imageUri === 'string' && imageUri.trim() !== '' ? imageUri : null;
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!gameId || !uri) {
      setSrc(null);
      return;
    }
    void getCachedImage(gameId, uri).then((row) => {
      if (!cancelled) {
        setSrc(row?.image ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [gameId, uri]);

  return (
    <span className="combat-image-ref combat-image-ref--compact">
      <ResourceImageThumb src={src} alt={uri ?? '图片'} size={size} emptyLabel={emptyLabel} />
      {uri ? <span className="combat-image-ref-uri">{uri}</span> : null}
    </span>
  );
}
