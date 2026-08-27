import { Alert, Button, Form, InputNumber, Modal, Space } from '@arco-design/web-react';
import { useCallback, useEffect, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import { getLevelConfig, updateLevelConfig } from '../../../services/characterClient';

export type GameSettingsPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

export function GameSettingsPage({
  apiBaseUrl,
  selectedGameId,
  adminToken
}: GameSettingsPageProps) {
  const [minLevel, setMinLevel] = useState<number | undefined>();
  const [maxLevel, setMaxLevel] = useState<number | undefined>();
  const [loadedMinLevel, setLoadedMinLevel] = useState<number | undefined>();
  const [loadedMaxLevel, setLoadedMaxLevel] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = adminToken.trim();
    if (!selectedGameId || !token) {
      setMinLevel(undefined);
      setMaxLevel(undefined);
      setLoadedMinLevel(undefined);
      setLoadedMaxLevel(undefined);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await getLevelConfig(apiBaseUrl, selectedGameId, token);
      setMinLevel(result.data.minLevel);
      setMaxLevel(result.data.maxLevel);
      setLoadedMinLevel(result.data.minLevel);
      setLoadedMaxLevel(result.data.maxLevel);
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && loadError.code === '409.LEVEL_CONFIG_REQUIRED') {
        setMinLevel(1);
        setMaxLevel(1);
        setLoadedMinLevel(undefined);
        setLoadedMaxLevel(undefined);
      } else {
        setError(getErrorMessage(loadError));
      }
    } finally {
      setLoading(false);
    }
  }, [adminToken, apiBaseUrl, selectedGameId]);

  useEffect(() => { void load(); }, [load]);

  const persist = async (nextMin: number, nextMax: number) => {
    if (!selectedGameId) {
      setError('请先选择游戏。');
      return;
    }
    const token = adminToken.trim();
    if (!token) {
      setError('请先配置 Admin Token。');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await updateLevelConfig(apiBaseUrl, selectedGameId, token, {
        minLevel: nextMin,
        maxLevel: nextMax
      });
      setMinLevel(result.data.minLevel);
      setMaxLevel(result.data.maxLevel);
      setLoadedMinLevel(result.data.minLevel);
      setLoadedMaxLevel(result.data.maxLevel);
      setNotice('等级范围已保存。');
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (minLevel === undefined || maxLevel === undefined) {
      setError('等级范围不能为空。');
      return;
    }
    if (minLevel < 1 || maxLevel > 100 || maxLevel < minLevel) {
      setError('等级范围必须在1到100之间，且最大等级不能小于最小等级。');
      return;
    }

    const unchanged = loadedMinLevel === minLevel && loadedMaxLevel === maxLevel;
    if (unchanged) {
      await persist(minLevel, maxLevel);
      return;
    }

    const shrinking = (
      loadedMinLevel !== undefined
      && loadedMaxLevel !== undefined
      && (minLevel > loadedMinLevel || maxLevel < loadedMaxLevel)
    );
    const expanding = (
      loadedMinLevel !== undefined
      && loadedMaxLevel !== undefined
      && (minLevel < loadedMinLevel || maxLevel > loadedMaxLevel)
    );

    if (shrinking || expanding) {
      const confirmContent = shrinking && expanding
        ? '超出新范围的角色属性和角色等级参数将被删除，新增等级的角色属性和角色等级参数将补 0。'
        : shrinking
          ? '超出新范围的角色属性和角色等级参数将被删除。'
          : '新增等级的角色属性和角色等级参数将补 0。';
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '确认调整等级范围',
          content: confirmContent,
          okText: '确认保存',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false)
        });
      });
      if (!confirmed) return;
    }

    await persist(minLevel, maxLevel);
  };

  return (
    <div className="page-stack">
      <Panel
        title="游戏配置"
        actions={
          <Button loading={loading} disabled={!selectedGameId || !adminToken.trim()} onClick={() => void load()}>
            刷新
          </Button>
        }
      >
        {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : null}
        {selectedGameId && !adminToken.trim() ? <Alert type="warning" content="请先在顶部配置 Admin Token。" /> : null}
        {error ? <Alert type="error" content={error} className="workspace-alert" /> : null}
        {notice ? <Alert type="success" content={notice} className="workspace-alert" /> : null}

        <Form layout="vertical" style={{ maxWidth: 520 }}>
          <Space size="large" align="start">
            <Form.Item label="最小等级" required>
              <InputNumber
                aria-label="最小等级"
                value={minLevel}
                min={1}
                max={100}
                precision={0}
                disabled={loading || saving}
                onChange={setMinLevel}
              />
            </Form.Item>
            <Form.Item label="最大等级" required>
              <InputNumber
                aria-label="最大等级"
                value={maxLevel}
                min={1}
                max={100}
                precision={0}
                disabled={loading || saving}
                onChange={setMaxLevel}
              />
            </Form.Item>
          </Space>
          <Button
            type="primary"
            loading={saving}
            disabled={loading || !selectedGameId || !adminToken.trim()}
            onClick={() => void save()}
          >
            保存等级范围
          </Button>
        </Form>
      </Panel>
    </div>
  );
}
