import { Alert, Button, Space, Tag, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { getErrorMessage } from '../../../services/apiClient';
import { getRepresentativeImage } from '../../../services/imageRelationClient';
import { CachedImagePreview } from './CachedImagePreview';
import { RepresentativeImageModal } from './RepresentativeImageModal';

type Props = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
  adminToken: string;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
};

export function GameRepresentativeImagePanel({ apiBaseUrl, selectedGameId, selectedGameName, adminToken, onDirtyChange, onSaved }: Props) {
  const [image, setImage] = useState<{ imageKey: string; name: string; enabled: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const serial = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++serial.current;
    setError(null);
    if (!selectedGameId || !adminToken.trim()) { setImage(null); setLoading(false); return; }
    setLoading(true);
    try {
      const result = await getRepresentativeImage(apiBaseUrl, selectedGameId,
        { kind: 'game', key: selectedGameId, name: selectedGameName }, adminToken.trim());
      if (serial.current === ticket) setImage(result.data.image);
    } catch (e) { if (serial.current === ticket) { setImage(null); setError(getErrorMessage(e)); } }
    finally { if (serial.current === ticket) setLoading(false); }
  }, [apiBaseUrl, selectedGameId, selectedGameName, adminToken]);
  useEffect(() => {
    setVisible(false); setImage(null); void load();
    return () => { serial.current += 1; };
  }, [load]);
  return <Panel title="代表图片" actions={<Space>
    <Button loading={loading} disabled={!selectedGameId || !adminToken.trim()} onClick={() => void load()}>刷新代表图片</Button>
    <Button type="primary" disabled={!selectedGameId || !adminToken.trim()} onClick={() => setVisible(true)}>设置代表图片</Button>
  </Space>}>
    {error ? <Alert type="error" content={error} /> : null}
    <Space>
      <CachedImagePreview gameId={selectedGameId} imageKey={image?.imageKey ?? null} enabled={image?.enabled} name={image?.name} />
      {image ? <>
        <Typography.Text>{image.name} / {image.imageKey}</Typography.Text>
        {!image.enabled ? <Tag color="gray">图片不可用</Tag> : null}
      </> : <Typography.Text type="secondary">{loading ? '正在读取代表图片…' : '尚未设置代表图片'}</Typography.Text>}
    </Space>
    {visible && selectedGameId ? <RepresentativeImageModal visible
      target={{ kind: 'game', key: selectedGameId, name: selectedGameName }} apiBaseUrl={apiBaseUrl}
      selectedGameId={selectedGameId} adminToken={adminToken} onDirtyChange={onDirtyChange}
      onClose={() => { setVisible(false); onDirtyChange(false); }}
      onSaved={() => { void load(); onSaved(); }} /> : null}
  </Panel>;
}
