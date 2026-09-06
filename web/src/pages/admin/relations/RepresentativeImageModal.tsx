import { Alert, Button, Form, Input, Modal, Radio, Select, Space, Spin, Tag, Typography } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { ResourceImageThumb } from '../../../components/ResourceImageThumb';
import { ResourceImageUploadField } from '../../../components/ResourceImageUploadField';
import { getErrorMessage } from '../../../services/apiClient';
import { getRepresentativeImage, listImageOptions, removeRepresentativeImage, setRepresentativeImage } from '../../../services/imageRelationClient';
import { prepareResourceImage } from '../../../services/resourceImage';
import { createRepresentativeImageUploadDraft, RepresentativeImageUploadFailure, uploadAndUseRepresentativeImage, type RepresentativeImageUploadDraft } from '../../../services/representativeImageUpload';
import type { ManagedImage } from '../../../types/image';
import type { ImageOption, ImageRelationTarget, RepresentativeImage } from '../../../types/imageRelation';
import { CachedImagePreview } from './CachedImagePreview';
import { imageTargetIdentity } from './imageRelationForm';

type RepresentativeImageModalProps = {
  visible: boolean;
  target: ImageRelationTarget | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

export function RepresentativeImageModal(props: RepresentativeImageModalProps) {
  if (!props.visible || !props.target || !props.selectedGameId) return null;
  const contextKey = JSON.stringify([props.apiBaseUrl, props.selectedGameId, imageTargetIdentity(props.target), props.adminToken]);
  return <RepresentativeImageForm key={contextKey} {...props} target={props.target} selectedGameId={props.selectedGameId} />;
}

function RepresentativeImageForm({ target, selectedGameId, apiBaseUrl, adminToken, onClose, onSaved, onDirtyChange }: RepresentativeImageModalProps & { target: ImageRelationTarget; selectedGameId: string }) {
  const [current, setCurrent] = useState<RepresentativeImage | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [options, setOptions] = useState<ImageOption[]>([]);
  const [selection, setSelection] = useState<ImageOption | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mode, setMode] = useState<'upload' | 'existing'>('upload');
  const [uploadDraft, setUploadDraft] = useState<RepresentativeImageUploadDraft | null>(null);
  const [processing, setProcessing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [cacheWarning, setCacheWarning] = useState<string | null>(null);
  const [savedPreview, setSavedPreview] = useState<ManagedImage | null>(null);
  const active = useRef(true);
  const readRequest = useRef(0);
  const searchRequest = useRef(0);
  const fileRequest = useRef(0);
  const busy = useRef(false);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const existingDirty = selection !== null && selection.imageKey !== current?.imageKey;
  const dirty = processing || uploadDraft !== null || existingDirty;

  const load = async () => {
    const request = ++readRequest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await getRepresentativeImage(apiBaseUrl, selectedGameId, target, adminToken.trim());
      if (!active.current || request !== readRequest.current) return;
      setCurrent(result.data.image);
      setLoaded(true);
    } catch (cause) {
      if (active.current && request === readRequest.current) { setError(getErrorMessage(cause)); setLoaded(false); }
    } finally {
      if (active.current && request === readRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    active.current = true;
    void load();
    return () => { active.current = false; readRequest.current += 1; searchRequest.current += 1; fileRequest.current += 1; dirtyCallback.current?.(false); };
  }, []);

  useEffect(() => { dirtyCallback.current?.(dirty); }, [dirty]);

  const selectFile = async (file: File) => {
    if (busy.current || !loaded) return;
    const request = ++fileRequest.current;
    busy.current = true;
    setProcessing(true);
    setFileError(null);
    setError(null);
    setSuccess(null);
    try {
      const prepared = await prepareResourceImage(file);
      if (!active.current || request !== fileRequest.current) return;
      setUploadDraft(createRepresentativeImageUploadDraft(target.name, file.name, prepared));
      setSelection(null);
    } catch (cause) {
      if (active.current && request === fileRequest.current) setFileError(getErrorMessage(cause));
    } finally {
      if (active.current && request === fileRequest.current) {
        busy.current = false;
        setProcessing(false);
      }
    }
  };

  const upload = async () => {
    if (!uploadDraft || !loaded || busy.current || fileError) return;
    busy.current = true;
    const request = ++fileRequest.current;
    setSaving(true);
    setError(null);
    setSuccess(null);
    setCacheWarning(null);
    try {
      const result = await uploadAndUseRepresentativeImage({ apiBaseUrl, gameId: selectedGameId, target, token: adminToken.trim() },
        uploadDraft, () => active.current && request === fileRequest.current);
      if (!result || !active.current) return;
      setCurrent(result.image);
      setSavedPreview(result.uploaded);
      setUploadDraft(null);
      setSelection(null);
      setFileError(null);
      setCacheWarning(result.cacheWarning);
      setSuccess('代表图片已上传并保存。');
      dirtyCallback.current?.(false);
      onSaved?.();
    } catch (cause) {
      if (!active.current) return;
      if (cause instanceof RepresentativeImageUploadFailure) setUploadDraft(cause.draft);
      setError(getErrorMessage(cause));
    } finally {
      if (active.current) { busy.current = false; setSaving(false); }
    }
  };

  const search = async () => {
    if (busy.current || !loaded) return;
    const request = ++searchRequest.current;
    setSearchError(null);
    setSearching(true);
    setSearched(false);
    try {
      const result = await listImageOptions(apiBaseUrl, selectedGameId, adminToken.trim(), keyword);
      if (!active.current || request !== searchRequest.current) return;
      setOptions(result.data.items);
      setSearched(true);
    } catch (cause) {
      if (active.current && request === searchRequest.current) { setOptions([]); setSearchError(getErrorMessage(cause)); }
    } finally {
      if (active.current && request === searchRequest.current) setSearching(false);
    }
  };

  const save = async () => {
    if (!selection || !loaded || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await setRepresentativeImage(apiBaseUrl, selectedGameId, target, adminToken.trim(), selection.imageKey);
      if (!active.current) return;
      setCurrent(result.data.image);
      setSelection(null);
      setUploadDraft(null);
      setFileError(null);
      setSavedPreview(null);
      setCacheWarning(null);
      dirtyCallback.current?.(false);
      setSuccess('代表图片已保存。');
      onSaved?.();
    } catch (cause) {
      if (active.current) setError(getErrorMessage(cause));
    } finally {
      if (active.current) { busy.current = false; setSaving(false); }
    }
  };

  const remove = async () => {
    if (!current || !loaded || busy.current) return;
    if (!window.confirm(`确定移除“${target.name}”的代表图片关联吗？图片本身会保留。`)) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await removeRepresentativeImage(apiBaseUrl, selectedGameId, target, adminToken.trim());
      if (!active.current) return;
      setCurrent(null);
      setSelection(null);
      setSavedPreview(null);
      setCacheWarning(null);
      dirtyCallback.current?.(uploadDraft !== null);
      setSuccess('代表图片关联已移除。');
      onSaved?.();
    } catch (cause) {
      if (active.current) setError(getErrorMessage(cause));
    } finally {
      if (active.current) { busy.current = false; setSaving(false); }
    }
  };

  const close = () => {
    if (busy.current) return;
    const closeMessage = uploadDraft?.uploaded
      ? '图片已上传并会保留，但尚未确认代表图片设置成功。关闭后可在图片管理同步查看。确定关闭吗？'
      : uploadDraft?.uploadUncertain
        ? '图片上传结果尚未确认，关闭后可在图片管理同步核对。确定关闭吗？'
        : '代表图片修改尚未保存，确定关闭吗？';
    if (dirty && !window.confirm(closeMessage)) return;
    dirtyCallback.current?.(false);
    onClose();
  };

  return <Modal title={`${target.name} · 代表图片`} visible onCancel={close} style={{ width: 720 }} footer={
    <Space>
      <Button onClick={close} disabled={saving || processing}>关闭</Button>
      <Button status="danger" disabled={!loaded || !current || saving || processing || !adminToken.trim()} onClick={() => void remove()}>移除代表图片</Button>
      {mode === 'upload' ? <Button type="primary" loading={saving} disabled={!loaded || !uploadDraft || processing || Boolean(fileError) || !adminToken.trim()} onClick={() => void upload()}>上传并使用</Button>
        : <Button type="primary" loading={saving} disabled={!loaded || !existingDirty || processing || !adminToken.trim()} onClick={() => void save()}>保存代表图片</Button>}
    </Space>
  }>
    <Space direction="vertical" size="medium" style={{ width: '100%' }}>
      <Typography.Text type="secondary">{target.name}（{target.key}）{target.skillKey ? ` · 所属技能：${target.skillKey}` : ''}</Typography.Text>
      {error ? <Alert type="error" content={error} /> : null}
      {success ? <Alert type="success" content={success} /> : null}
      {cacheWarning ? <Alert type="warning" content={cacheWarning} /> : null}
      {!adminToken.trim() ? <Alert type="warning" content="请先配置 Admin Token。" /> : null}
      {loading ? <Spin tip="正在读取代表图片" /> : !loaded ? <Button onClick={() => void load()}>重新读取</Button> : (
        <Space align="center">
          {savedPreview && current?.imageKey === savedPreview.imageKey && current.enabled
            ? <ResourceImageThumb src={savedPreview.imageBase64} alt={`${target.name}代表图片`} size={64} />
            : <CachedImagePreview gameId={selectedGameId} imageKey={current?.imageKey ?? null} enabled={current?.enabled ?? true} name={`${target.name}代表图片`} />}
          {current ? <Space direction="vertical" size="mini">
            <Typography.Text>{mode === 'upload' ? `${target.name}代表图片` : `${current.name}（${current.imageKey}）`}</Typography.Text>
            <Tag color={current.enabled ? 'green' : 'gray'}>{current.enabled ? '已启用' : '已停用'}</Tag>
          </Space> : <Typography.Text type="secondary">尚未设置代表图片</Typography.Text>}
        </Space>
      )}
      {loaded && current && !current.enabled ? <Alert type="warning" content="当前图片已停用，原有关联可以保留或移除。也可以选择启用图片替换。" /> : null}
      <Radio.Group aria-label="代表图片来源" type="button" value={mode} disabled={saving || processing} onChange={(value: 'upload' | 'existing') => setMode(value)}>
        <Radio value="upload">上传新图片</Radio>
        <Radio value="existing">选择已有图片</Radio>
      </Radio.Group>
      {mode === 'upload' ? <ResourceImageUploadField
        src={uploadDraft?.prepared.imageBase64 ?? null}
        alt={`${target.name}待上传代表图片`}
        readOnly={!loaded || saving}
        processing={processing}
        error={fileError}
        buttonText={uploadDraft ? '重新选择图片' : '选择图片'}
        helperText="选择本地 PNG/JPEG，保存后自动设为当前对象的代表图片。大图会在浏览器居中裁切到最大 64×64，小图保持原尺寸。"
        metadataText={uploadDraft ? `${uploadDraft.fileName} · ${uploadDraft.prepared.width} × ${uploadDraft.prepared.height} · ${(uploadDraft.prepared.byteSize / 1024).toFixed(1)} KB` : null}
        onSelect={selectFile}
      /> : <Form layout="vertical">
        <Form.Item label="搜索启用图片" help="按名称或标识搜索，每次最多显示 50 项。图片未缓存时显示占位。" validateStatus={searchError ? 'error' : undefined}>
          <Space style={{ width: '100%' }}>
            <Input aria-label="搜索代表图片" placeholder="输入图片名称或标识" maxLength={100} value={keyword} disabled={!loaded || saving} onChange={(value) => {
              setKeyword(value); searchRequest.current += 1; setOptions([]); setSearching(false); setSearched(false); setSearchError(null);
            }} onPressEnter={() => void search()} style={{ width: 440 }} />
            <Button loading={searching} disabled={!loaded || saving || !keyword.trim() || !adminToken.trim()} onClick={() => void search()}>搜索图片</Button>
          </Space>
          {searchError ? <Typography.Text type="error">{searchError}</Typography.Text> : null}
        </Form.Item>
        <Form.Item label="选择代表图片">
          <Select aria-label="选择代表图片" placeholder="先搜索，再选择图片" disabled={!loaded || saving} value={selection?.imageKey} allowClear
            options={[...(selection && !options.some((row) => row.imageKey === selection.imageKey) ? [selection] : []), ...options]
              .map((row) => ({ value: row.imageKey, label: `${row.name}（${row.imageKey}）· 已启用` }))}
            onChange={(value: string | undefined) => {
              setSelection(options.find((row) => row.imageKey === value) ?? (selection?.imageKey === value ? selection : null));
              setError(null); setSuccess(null);
            }} />
          {searched ? <Typography.Text type="secondary">{options.length === 50 ? '已显示前 50 项，可缩小搜索范围。' : `找到 ${options.length} 张启用图片。`}</Typography.Text> : null}
        </Form.Item>
      </Form>}
      {mode === 'existing' && selection ? <Space><CachedImagePreview gameId={selectedGameId} imageKey={selection.imageKey} name={selection.name} /><Typography.Text>待保存：{selection.name}（{selection.imageKey}）</Typography.Text></Space> : null}
    </Space>
  </Modal>;
}
