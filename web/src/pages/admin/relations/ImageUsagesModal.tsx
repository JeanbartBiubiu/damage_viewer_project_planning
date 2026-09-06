import { Alert, Button, Form, Modal, Select, Space, Spin, Table, Tag, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getErrorMessage, listGames } from '../../../services/apiClient';
import { listCharacters } from '../../../services/characterClient';
import { listAttributes } from '../../../services/attributeClient';
import { listEquipment } from '../../../services/equipmentClient';
import { listSkills } from '../../../services/skillClient';
import { listSkillEffects } from '../../../services/skillEffectClient';
import { listStatuses } from '../../../services/statusClient';
import { getImage } from '../../../services/imageClient';
import { getImageUsages, getRepresentativeImage, removeRepresentativeImage, setRepresentativeImage } from '../../../services/imageRelationClient';
import type { ImageRelationTarget, ImageUsages, RepresentativeImage } from '../../../types/imageRelation';
import { CachedImagePreview } from './CachedImagePreview';
import { IMAGE_SOURCE_KINDS, imageSourceLabel, imageTargetIdentity, imageUsageGroups, representativeImageReplacementMessage, type ImageSourceOption } from './imageRelationForm';

type ImageUsagesModalProps = {
  visible: boolean;
  imageKey: string | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

export function ImageUsagesModal(props: ImageUsagesModalProps) {
  if (!props.visible || !props.imageKey || !props.selectedGameId) return null;
  return <ImageUsagesForm key={JSON.stringify([props.apiBaseUrl, props.selectedGameId, props.imageKey, props.adminToken])} {...props} imageKey={props.imageKey} selectedGameId={props.selectedGameId} />;
}

async function sourceOptions(apiBaseUrl: string, gameId: string, token: string, kind: ImageRelationTarget['kind'], skillKey: string | null): Promise<ImageSourceOption[]> {
  switch (kind) {
    case 'game': return (await listGames(apiBaseUrl)).data.filter((game) => game.gameId === gameId)
      .map((game) => ({ target: { kind, key: game.gameId, name: game.gameName } }));
    case 'character': return (await listCharacters(apiBaseUrl, gameId, token)).data.items
      .map((row) => ({ target: { kind, key: row.characterKey, name: row.name } }));
    case 'attribute': return (await listAttributes(apiBaseUrl, gameId, token)).data.items
      .map((row) => ({ target: { kind, key: row.attributeKey, name: row.name }, status: row.status }));
    case 'equipment': return (await listEquipment(apiBaseUrl, gameId, token)).data.items
      .map((row) => ({ target: { kind, key: row.equipmentKey, name: row.name } }));
    case 'skill': return (await listSkills(apiBaseUrl, gameId, token)).data.items
      .map((row) => ({ target: { kind, key: row.skillKey, name: row.name }, status: row.status }));
    case 'skillEffect': return skillKey ? (await listSkillEffects(apiBaseUrl, gameId, skillKey, token)).data
      .map((row) => ({ target: { kind, key: row.effectKey, name: row.name, skillKey: row.skillKey } })) : [];
    case 'status': return (await listStatuses(apiBaseUrl, gameId, token)).data.items
      .map((row) => ({ target: { kind, key: row.statusKey, name: row.name }, status: row.status }));
  }
}

function ImageUsagesForm({ imageKey, selectedGameId, apiBaseUrl, adminToken, onClose, onDirtyChange }: ImageUsagesModalProps & { imageKey: string; selectedGameId: string }) {
  const [image, setImage] = useState<RepresentativeImage | null>(null);
  const [usages, setUsages] = useState<ImageUsages | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<ImageRelationTarget['kind']>('character');
  const [skillKey, setSkillKey] = useState<string | null>(null);
  const [skills, setSkills] = useState<ImageSourceOption[]>([]);
  const [options, setOptions] = useState<ImageSourceOption[]>([]);
  const [selection, setSelection] = useState<ImageSourceOption | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsRevision, setOptionsRevision] = useState(0);
  const active = useRef(true);
  const readRequest = useRef(0);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const dirty = selection !== null || skillKey !== null;
  const groups = useMemo(() => usages ? imageUsageGroups(usages) : [], [usages]);
  const existing = useMemo(() => new Set(groups.flatMap((group) => group.items.map((item) => imageTargetIdentity(item.target)))), [groups]);

  const load = async () => {
    const request = ++readRequest.current;
    setLoading(true);
    setLoaded(false);
    setError(null);
    try {
      const [usageResult, imageResult] = await Promise.all([
        getImageUsages(apiBaseUrl, selectedGameId, imageKey, adminToken.trim()),
        getImage(apiBaseUrl, selectedGameId, imageKey, adminToken.trim())
      ]);
      if (!active.current || request !== readRequest.current) return;
      setUsages(usageResult.data);
      setImage({ imageKey: imageResult.data.imageKey, name: imageResult.data.name, enabled: imageResult.data.enabled });
      setLoaded(true);
    } catch (cause) {
      if (active.current && request === readRequest.current) setError(getErrorMessage(cause));
    } finally {
      if (active.current && request === readRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    active.current = true;
    void load();
    return () => { active.current = false; readRequest.current += 1; dirtyCallback.current?.(false); };
  }, []);

  useEffect(() => { dirtyCallback.current?.(dirty); }, [dirty]);

  useEffect(() => {
    let current = true;
    setOptions([]);
    setOptionsError(null);
    setOptionsLoading(true);
    const query = sourceKind === 'skillEffect' && !skillKey
      ? sourceOptions(apiBaseUrl, selectedGameId, adminToken.trim(), 'skill', null)
      : sourceOptions(apiBaseUrl, selectedGameId, adminToken.trim(), sourceKind, skillKey);
    void query.then((items) => {
      if (!current) return;
      if (sourceKind === 'skillEffect' && !skillKey) setSkills(items);
      else setOptions(items);
    }).catch((cause) => {
      if (current) setOptionsError(getErrorMessage(cause));
    }).finally(() => {
      if (current) setOptionsLoading(false);
    });
    return () => { current = false; };
  }, [apiBaseUrl, selectedGameId, adminToken, sourceKind, skillKey, optionsRevision]);

  const add = async () => {
    if (!selection || !image?.enabled || !loaded || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const latest = await getRepresentativeImage(apiBaseUrl, selectedGameId, selection.target, adminToken.trim());
      if (!active.current) return;
      const replacement = representativeImageReplacementMessage(latest.data.image, imageKey, selection.target.name);
      if (replacement && !window.confirm(replacement)) return;
      await setRepresentativeImage(apiBaseUrl, selectedGameId, selection.target, adminToken.trim(), imageKey);
      if (!active.current) return;
      setSelection(null);
      setSkillKey(null);
      dirtyCallback.current?.(false);
      await load();
      if (active.current) setSuccess('图片用途关系已保存。');
    } catch (cause) {
      if (active.current) setError(getErrorMessage(cause));
    } finally {
      if (active.current) setSaving(false);
    }
  };

  const remove = async (source: ImageSourceOption) => {
    if (!loaded || saving) return;
    if (!window.confirm(`确定移除“${source.target.name}”与当前图片的关系吗？`)) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      // 再读来源，避免旧用途列表误删其他维护者刚替换的图片关系。
      const latest = await getRepresentativeImage(apiBaseUrl, selectedGameId, source.target, adminToken.trim());
      if (!active.current) return;
      if (latest.data.image?.imageKey !== imageKey) {
        await load();
        if (active.current) setError('该来源的代表图片已经变更，用途列表已刷新，请重新核对。');
        return;
      }
      await removeRepresentativeImage(apiBaseUrl, selectedGameId, source.target, adminToken.trim());
      if (!active.current) return;
      await load();
      if (active.current) setSuccess('图片用途关系已移除。');
    } catch (cause) {
      if (active.current) setError(getErrorMessage(cause));
    } finally {
      if (active.current) setSaving(false);
    }
  };

  const close = () => {
    if (saving || (dirty && !window.confirm('图片用途选择尚未保存，确定关闭吗？'))) return;
    dirtyCallback.current?.(false);
    onClose();
  };
  const editable = loaded && Boolean(image?.enabled) && Boolean(adminToken.trim()) && !saving;

  return <Modal title="图片用途关系" visible onCancel={close} style={{ width: 940 }} footer={<Button disabled={saving} onClick={close}>关闭</Button>}>
    <Space direction="vertical" size="medium" style={{ width: '100%' }}>
      {error ? <Alert type="error" content={error} /> : null}
      {success ? <Alert type="success" content={success} /> : null}
      {!adminToken.trim() ? <Alert type="warning" content="请先配置 Admin Token。" /> : null}
      <Space>
        <CachedImagePreview gameId={selectedGameId} imageKey={imageKey} enabled={loaded && Boolean(image?.enabled)} name={image?.name ?? imageKey} />
        <Typography.Text>{image ? `${image.name}（${imageKey}）` : imageKey}</Typography.Text>
        {image && loaded ? <Tag color={image.enabled ? 'green' : 'gray'}>{image.enabled ? '已启用' : '已停用'}</Tag> : null}
      </Space>
      {loaded && image && !image.enabled ? <Alert type="warning" content="当前图片已停用，只能查看和移除已有用途，不能新建关联。" /> : null}
      {loading ? <Spin tip="正在读取图片用途" /> : !loaded ? <Button onClick={() => void load()}>重新读取</Button> : null}
      <Form layout="vertical">
        <Form.Item label="来源类别">
          <Select aria-label="图片来源类别" value={sourceKind} options={IMAGE_SOURCE_KINDS} disabled={!editable} onChange={(value: ImageRelationTarget['kind']) => {
            setSourceKind(value); setSkillKey(null); setSelection(null); setSkills([]); setOptions([]); setSuccess(null);
          }} />
        </Form.Item>
        {sourceKind === 'skillEffect' ? <Form.Item label="所属技能">
          <Select aria-label="来源技能" placeholder="先选择所属技能" value={skillKey ?? undefined} loading={optionsLoading && !skillKey} showSearch allowClear disabled={!editable}
            filterOption={(input, option) => String(option.props.children).toLowerCase().includes(input.trim().toLowerCase())}
            options={skills.map((row) => ({ value: row.target.key, label: imageSourceLabel(row) }))}
            onChange={(value: string | undefined) => { setSkillKey(value ?? null); setSelection(null); setOptions([]); }} />
        </Form.Item> : null}
        <Form.Item label={sourceKind === 'skillEffect' ? '技能效果' : '来源对象'}>
          <Select aria-label="图片来源对象" placeholder={sourceKind === 'skillEffect' && !skillKey ? '请先选择所属技能' : '按名称或标识选择来源对象'} value={selection ? imageTargetIdentity(selection.target) : undefined}
            showSearch allowClear loading={optionsLoading} disabled={!editable || (sourceKind === 'skillEffect' && !skillKey)}
            filterOption={(input, option) => String(option.props.children).toLowerCase().includes(input.trim().toLowerCase())}
            options={options.map((row) => ({
              value: imageTargetIdentity(row.target),
              label: `${imageSourceLabel(row)}${existing.has(imageTargetIdentity(row.target)) ? ' · 已关联此图片' : ''}`,
              disabled: existing.has(imageTargetIdentity(row.target))
            }))}
            onChange={(value: string | undefined) => { setSelection(options.find((row) => imageTargetIdentity(row.target) === value) ?? null); setError(null); setSuccess(null); }} />
        </Form.Item>
        {optionsError ? <Space direction="vertical"><Alert type="error" content={optionsError} /><Button disabled={saving} onClick={() => setOptionsRevision((value) => value + 1)}>重新读取候选</Button></Space> : null}
        <Button type="primary" loading={saving} disabled={!editable || !selection} onClick={() => void add()}>设置此图片</Button>
      </Form>
      {loaded ? groups.map((group) => <section key={group.kind} aria-label={`${group.label}图片用途`}>
        <Typography.Title heading={6} style={{ marginTop: 8 }}>{group.label}（{group.items.length}）</Typography.Title>
        <Table<ImageSourceOption> size="small" pagination={false} rowKey={(row) => imageTargetIdentity(row.target)} data={group.items} noDataElement="暂无用途关系" columns={[
          { title: '名称与标识', render: (_, row) => <Space direction="vertical" size="mini"><Typography.Text>{row.target.name}（{row.target.key}）</Typography.Text>{row.target.skillKey ? <Typography.Text type="secondary">所属技能：{row.skillName}（{row.target.skillKey}）</Typography.Text> : null}</Space> },
          { title: '状态', width: 100, render: (_, row) => row.status ? <Tag color={row.status === 'ENABLED' ? 'green' : 'gray'}>{row.status === 'ENABLED' ? '已启用' : '已停用'}</Tag> : <Typography.Text type="secondary">无启停状态</Typography.Text> },
          { title: '操作', width: 120, render: (_, row) => <Button type="text" status="danger" disabled={saving || !adminToken.trim()} onClick={() => void remove(row)}>移除关系</Button> }
        ]} />
      </section>) : null}
    </Space>
  </Modal>;
}
