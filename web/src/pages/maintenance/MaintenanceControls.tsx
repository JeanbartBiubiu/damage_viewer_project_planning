import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Button, Input, Space, Typography } from '@arco-design/web-react';
import { getErrorMessage } from '../../services/apiClient';
import { refreshMaintenancePrincipal } from '../../services/maintenanceClient';
import { getMaintenanceBatch, getMaintenanceCandidate, getMaintenancePrincipal, setMaintenanceBatch, subscribeMaintenanceState } from '../../services/maintenanceState';

export function MaintenanceControls({ apiBaseUrl }: { apiBaseUrl: string }) {
  const principal = useSyncExternalStore(subscribeMaintenanceState, getMaintenancePrincipal);
  const candidate = useSyncExternalStore(subscribeMaintenanceState, getMaintenanceCandidate);
  const batch = useSyncExternalStore(subscribeMaintenanceState, getMaintenanceBatch);
  const [draftBatch, setDraftBatch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    setError(null);
    void refreshMaintenancePrincipal(apiBaseUrl).catch(cause => setError(getErrorMessage(cause)));
  }, [apiBaseUrl]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [refresh]);
  const exportCandidate = () => {
    if (!candidate) return;
    const blob = new Blob([JSON.stringify({ format: 'damage-maintenance-request-v1', exportedAt: new Date().toISOString(), operations: [candidate] }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'maintenance-candidate-request.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return <section aria-label="私有维护" style={{ width: '100%' }}>
    <Space wrap>
      <Typography.Text>{principal ? `维护身份：${principal.displayName}` : '维护身份待确认'}</Typography.Text>
      <Button size="small" onClick={refresh}>刷新维护身份</Button>
      <Input aria-label="已验证维护批次" value={draftBatch} onChange={setDraftBatch} placeholder="已验证维护批次编号" style={{ width: 300 }} />
      <Button size="small" disabled={!principal} onClick={() => { try { setMaintenanceBatch(draftBatch); setError(null); } catch (cause) { setError(getErrorMessage(cause)); } }}>选择批次</Button>
      <Button size="small" onClick={() => { setMaintenanceBatch(''); setDraftBatch(''); }}>仅编辑候选</Button>
      <Button size="small" disabled={!candidate} onClick={exportCandidate}>下载候选请求</Button>
    </Space>
    <Typography.Paragraph type="secondary">{batch ? `当前批次：${batch}。保存请求必须与后端已验证批次完全一致。` : '候选模式：保存操作只记录请求并保留草稿，不向生产库提交。验证后选择批次才能正式保存。'}</Typography.Paragraph>
    {error ? <Alert type="error" content={error} /> : null}
  </section>;
}
