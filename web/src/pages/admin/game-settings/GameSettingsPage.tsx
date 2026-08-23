import { Alert, Button, Form, InputNumber, Space } from '@arco-design/web-react';
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = adminToken.trim();
    if (!selectedGameId || !token) {
      setMinLevel(undefined);
      setMaxLevel(undefined);
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
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && loadError.code === '409.LEVEL_CONFIG_REQUIRED') {
        setMinLevel(1);
        setMaxLevel(1);
      } else {
        setError(getErrorMessage(loadError));
      }
    } finally {
      setLoading(false);
    }
  }, [adminToken, apiBaseUrl, selectedGameId]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!selectedGameId) {
      setError('请先选择游戏。');
      return;
    }
    const token = adminToken.trim();
    if (!token) {
      setError('请先配置 Admin Token。');
      return;
    }
    if (minLevel === undefined || maxLevel === undefined) {
      setError('等级范围不能为空。');
      return;
    }
    if (minLevel < 1 || maxLevel > 100 || maxLevel < minLevel) {
      setError('等级范围必须在1到100之间，且最大等级不能小于最小等级。');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await updateLevelConfig(apiBaseUrl, selectedGameId, token, {
        minLevel,
        maxLevel
      });
      setMinLevel(result.data.minLevel);
      setMaxLevel(result.data.maxLevel);
      setNotice('等级范围已保存。');
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
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
