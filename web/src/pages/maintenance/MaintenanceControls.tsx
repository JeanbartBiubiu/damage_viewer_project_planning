import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Button, Input, Space, Typography } from '@arco-design/web-react';
import { getErrorMessage } from '../../services/apiClient';
import { logoutMaintenance, restoreMaintenanceSession } from '../../services/maintenanceClient';
import { getMaintenanceBatch, getMaintenanceCandidate, getMaintenanceSession, MAINTENANCE_CHANGE_STORAGE_KEY, setMaintenanceBatch, setMaintenanceCaptureOnly, setMaintenanceSession, subscribeMaintenanceState } from '../../services/maintenanceState';

export function MaintenanceControls({ apiBaseUrl }: { apiBaseUrl: string }) {
  const session = useSyncExternalStore(subscribeMaintenanceState, getMaintenanceSession);
  const candidate = useSyncExternalStore(subscribeMaintenanceState, getMaintenanceCandidate);
  const batch = useSyncExternalStore(subscribeMaintenanceState, getMaintenanceBatch);
  const [draftBatch, setDraftBatch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { setError(null); void restoreMaintenanceSession(apiBaseUrl).catch(cause => setError(getErrorMessage(cause))); };
  useEffect(() => {
    setMaintenanceCaptureOnly(true);
    const refreshCurrent = () => { void restoreMaintenanceSession(apiBaseUrl).catch(cause => setError(getErrorMessage(cause))); };
    const visible = () => { if (document.visibilityState === 'visible') refreshCurrent(); };
    const changed = (event: StorageEvent) => {
      if (event.key !== MAINTENANCE_CHANGE_STORAGE_KEY) return;
      setMaintenanceSession(null); refreshCurrent();
    };
    refreshCurrent();
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('storage', changed);
    return () => { document.removeEventListener('visibilitychange', visible); window.removeEventListener('storage', changed); };
  }, [apiBaseUrl]);
  const exportCandidate = () => {
    if (!candidate) return;
    const blob = new Blob([JSON.stringify({ format: 'damage-maintenance-request-v1', exportedAt: new Date().toISOString(), operations: [candidate] }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'maintenance-candidate-request.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return <section aria-label="私有维护会话" style={{ width: '100%' }}>
    <Space wrap>
      <Typography.Text>{session ? `维护身份：${session.displayName}` : '由受控宿主建立维护会话后刷新。玩家账号没有维护资格。'}</Typography.Text>
      <Button size="small" onClick={refresh}>刷新维护会话</Button>
      {session ? <Button size="small" onClick={() => { void logoutMaintenance(apiBaseUrl).catch(cause => setError(getErrorMessage(cause))); }}>退出维护</Button> : null}
      <Input aria-label="已验证维护批次" value={draftBatch} onChange={setDraftBatch} placeholder="已验证维护批次编号" style={{ width: 300 }} />
      <Button size="small" disabled={!session} onClick={() => { try { setMaintenanceBatch(draftBatch); setError(null); } catch (cause) { setError(getErrorMessage(cause)); } }}>选择批次</Button>
      <Button size="small" onClick={() => { setMaintenanceBatch(''); setDraftBatch(''); }}>仅编辑候选</Button>
      <Button size="small" disabled={!candidate} onClick={exportCandidate}>下载候选请求</Button>
    </Space>
    <Typography.Paragraph type="secondary">{batch ? `当前批次：${batch}。保存请求必须与后端已验证批次完全一致。` : '候选模式：保存操作只记录请求并保留草稿，不向生产库提交。验证后选择批次才能正式保存。'}</Typography.Paragraph>
    {error ? <Alert type="error" content={error} /> : null}
  </section>;
}
