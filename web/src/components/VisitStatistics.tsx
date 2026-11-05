import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Button, Modal, Space, Statistic, Table, Typography } from '@arco-design/web-react';
import { getErrorMessage } from '../services/apiClient';
import { getAuthSession, subscribeAuthState, type SessionView } from '../services/authState';
import { listVisitStatistics, type VisitStatisticsDay } from '../services/visitStatisticsClient';

export function VisitStatistics({ apiBaseUrl }: { apiBaseUrl: string }) {
  const session = useSyncExternalStore(subscribeAuthState, getAuthSession, () => null);
  const [openedSession, setOpenedSession] = useState<SessionView | null>(null);
  if (!session?.canEdit) return null;
  return <>
    <Button size="small" onClick={() => setOpenedSession(session)}>访问统计</Button>
    {openedSession === session ? <VisitStatisticsDialog apiBaseUrl={apiBaseUrl} onClose={() => setOpenedSession(null)} /> : null}
  </>;
}

function VisitStatisticsDialog({ apiBaseUrl, onClose }: { apiBaseUrl: string; onClose: () => void }) {
  const [days, setDays] = useState<VisitStatisticsDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setDays([]); setError(null); setLoading(true);
    void listVisitStatistics(apiBaseUrl, controller.signal).then(result => {
      if (!controller.signal.aborted) setDays(result);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(getErrorMessage(cause));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => { controller.abort(); };
  }, [apiBaseUrl]);
  const today = days[days.length - 1];
  return <Modal title="访问统计" visible onCancel={onClose} style={{ width: 680, maxWidth: 'calc(100vw - 32px)' }}
    footer={<Button onClick={onClose}>关闭</Button>}>
    <Typography.Paragraph type="secondary">北京时间近 30 天；整页加载计一次访问，同一浏览器当天去重。</Typography.Paragraph>
    {error ? <Alert type="error" content={error} /> : null}
    {today ? <Space size="large" style={{ marginBottom: 20 }}>
      <Statistic title="今日 PV（访问量）" value={today.pv} />
      <Statistic title="今日 UV（独立访客）" value={today.uv} />
    </Space> : null}
    <Table<VisitStatisticsDay> rowKey="date" data={days} loading={loading} pagination={false} scroll={{ y: 360 }}
      columns={[
        { title: '日期', dataIndex: 'date' },
        { title: 'PV（访问量）', dataIndex: 'pv' },
        { title: 'UV（独立访客）', dataIndex: 'uv' }
      ]} />
  </Modal>;
}
