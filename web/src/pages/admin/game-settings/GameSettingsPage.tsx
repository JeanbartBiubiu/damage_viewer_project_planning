import { Alert, Button, Form, InputNumber, Modal, Space } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import { getLevelConfig, updateLevelConfig } from '../../../services/characterClient';
import { GameRepresentativeImagePanel } from '../relations/GameRepresentativeImagePanel';
import { GameVampRulesPanel } from './GameVampRulesPanel';

export type GameSettingsPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  selectedGameName: string;
  onDirtyChange: (dirty: boolean) => void;
  onGameImageSaved: () => void;
};

export function GameSettingsPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  selectedGameName,
  onDirtyChange,
  onGameImageSaved
}: GameSettingsPageProps) {
  const [minLevel, setMinLevel] = useState<number | undefined>();
  const [maxLevel, setMaxLevel] = useState<number | undefined>();
  const [loadedMinLevel, setLoadedMinLevel] = useState<number | undefined>();
  const [loadedMaxLevel, setLoadedMaxLevel] = useState<number | undefined>();
  const [configExists, setConfigExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [imageDirty, setImageDirty] = useState(false);
  const [vampDirty, setVampDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const token = adminToken.trim();
  const context = useMemo(() => ({ apiBaseUrl, gameId: selectedGameId, token }), [apiBaseUrl, selectedGameId, token]);
  const [loadedContext, setLoadedContext] = useState<typeof context | null>(null);
  const currentContext = useRef(context);
  currentContext.current = context;
  const active = useRef(true);
  const requestSerial = useRef(0);
  const busy = useRef(false);
  const cancelConfirmation = useRef<(() => void) | null>(null);
  const ready = loadedContext === context;
  const levelDirty = ready && (minLevel !== loadedMinLevel || maxLevel !== loadedMaxLevel);

  const isCurrent = useCallback((request: number, requestContext: typeof context) => (
    active.current && requestSerial.current === request && currentContext.current === requestContext
  ), []);

  useEffect(() => {
    onDirtyChange(levelDirty || imageDirty || vampDirty);
  }, [imageDirty, levelDirty, vampDirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const load = useCallback(async () => {
    const request = ++requestSerial.current;
    setMinLevel(undefined);
    setMaxLevel(undefined);
    setLoadedMinLevel(undefined);
    setLoadedMaxLevel(undefined);
    setLoadedContext(null);
    setConfigExists(false);
    setError(null);
    setNotice(null);
    setLoading(Boolean(context.gameId && context.token));
    if (!context.gameId || !context.token) return;
    try {
      const result = await getLevelConfig(context.apiBaseUrl, context.gameId, context.token);
      if (!isCurrent(request, context)) return;
      if (result.data.gameId !== context.gameId) throw new Error('返回的等级配置不属于当前游戏，请刷新后重试。');
      setMinLevel(result.data.minLevel);
      setMaxLevel(result.data.maxLevel);
      setLoadedMinLevel(result.data.minLevel);
      setLoadedMaxLevel(result.data.maxLevel);
      setConfigExists(true);
      setLoadedContext(context);
    } catch (loadError) {
      if (!isCurrent(request, context)) return;
      if (loadError instanceof ApiRequestError && loadError.code === '409.LEVEL_CONFIG_REQUIRED') {
        setMinLevel(1);
        setMaxLevel(1);
        setLoadedMinLevel(1);
        setLoadedMaxLevel(1);
        setLoadedContext(context);
      } else {
        setError(getErrorMessage(loadError));
      }
    } finally {
      if (isCurrent(request, context)) setLoading(false);
    }
  }, [context, isCurrent]);

  useEffect(() => {
    active.current = true;
    busy.current = false;
    setSaving(false);
    setConfirming(false);
    setImageDirty(false);
    setVampDirty(false);
    void load();
    return () => {
      active.current = false;
      requestSerial.current += 1;
      cancelConfirmation.current?.();
    };
  }, [load]);

  const refresh = () => {
    if (busy.current || loading) return;
    if (levelDirty && !window.confirm('等级范围修改尚未保存，确定放弃修改并刷新吗？')) return;
    void load();
  };

  const save = async () => {
    if (!ready || busy.current || loading || !context.gameId || !context.token) return;
    if (minLevel === undefined || maxLevel === undefined) {
      setError('等级范围不能为空。');
      return;
    }
    if (!Number.isInteger(minLevel) || !Number.isInteger(maxLevel) || minLevel < 1 || maxLevel > 100 || maxLevel < minLevel) {
      setError('等级范围必须为1到100之间的整数，且最大等级不能小于最小等级。');
      return;
    }

    const shrinking = (
      configExists && loadedMinLevel !== undefined
      && loadedMaxLevel !== undefined
      && (minLevel > loadedMinLevel || maxLevel < loadedMaxLevel)
    );
    const addedRanges: string[] = [];
    const addRange = (first: number, last: number) => {
      addedRanges.push(first === last ? `第 ${first} 级` : `第 ${first}～${last} 级`);
    };
    if (configExists && loadedMinLevel !== undefined && loadedMaxLevel !== undefined) {
      if (minLevel < loadedMinLevel) addRange(minLevel, Math.min(maxLevel, loadedMinLevel - 1));
      if (maxLevel > loadedMaxLevel) addRange(Math.max(minLevel, loadedMaxLevel + 1), maxLevel);
    }
    const expansionNotice = addedRanges.length
      ? `新增等级：${addedRanges.join('、')}。服务端将为新增等级的角色属性和角色等级参数补 0，保存后请逐项核对实际数值。`
      : '';
    const request = ++requestSerial.current;
    busy.current = true;
    setError(null);
    setNotice(null);
    try {
      if (shrinking || expansionNotice) {
        setConfirming(true);
        const confirmed = await new Promise<boolean>((resolve) => {
          const settle = (value: boolean) => {
            cancelConfirmation.current = null;
            resolve(value);
          };
          const modal = Modal.confirm({
            title: '确认调整等级范围',
            content: `${shrinking ? '超出新范围的角色属性和角色等级参数将被删除。' : ''}${expansionNotice}`,
            okText: '确认保存',
            cancelText: '取消',
            onOk: () => settle(true),
            onCancel: () => settle(false)
          });
          cancelConfirmation.current = () => { modal.close(); settle(false); };
        });
        if (!confirmed || !isCurrent(request, context)) return;
      }
      if (!isCurrent(request, context)) return;
      setConfirming(false);
      setSaving(true);
      const result = await updateLevelConfig(context.apiBaseUrl, context.gameId, context.token, {
        minLevel,
        maxLevel
      });
      if (!isCurrent(request, context)) return;
      if (result.data.gameId !== context.gameId) throw new Error('保存返回的等级配置不属于当前游戏，请刷新核对。');
      setMinLevel(result.data.minLevel);
      setMaxLevel(result.data.maxLevel);
      setLoadedMinLevel(result.data.minLevel);
      setLoadedMaxLevel(result.data.maxLevel);
      setConfigExists(true);
      setNotice(`等级范围已保存。${expansionNotice}`);
    } catch (saveError) {
      if (isCurrent(request, context)) setError(getErrorMessage(saveError));
    } finally {
      if (isCurrent(request, context)) {
        busy.current = false;
        setConfirming(false);
        setSaving(false);
      }
    }
  };

  return (
    <div className="page-stack">
      <Panel
        title="游戏配置"
        actions={
          <Button loading={loading} disabled={saving || confirming || !selectedGameId || !token} onClick={refresh}>
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
                value={ready ? minLevel : undefined}
                min={1}
                max={100}
                precision={0}
                disabled={!ready || loading || saving || confirming}
                onChange={setMinLevel}
              />
            </Form.Item>
            <Form.Item label="最大等级" required>
              <InputNumber
                aria-label="最大等级"
                value={ready ? maxLevel : undefined}
                min={1}
                max={100}
                precision={0}
                disabled={!ready || loading || saving || confirming}
                onChange={setMaxLevel}
              />
            </Form.Item>
          </Space>
          <Button
            type="primary"
            loading={saving}
            disabled={!ready || loading || confirming || !selectedGameId || !token}
            onClick={() => void save()}
          >
            保存等级范围
          </Button>
        </Form>
      </Panel>
      <GameVampRulesPanel apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} onDirtyChange={setVampDirty} />
      <GameRepresentativeImagePanel apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId}
        selectedGameName={selectedGameName} adminToken={adminToken}
        onDirtyChange={setImageDirty} onSaved={onGameImageSaved} />
    </div>
  );
}
