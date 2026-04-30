import { Button, Card, Form, Input, Space, Tag, Typography } from '@arco-design/web-react';
import { MetricCard } from '../../components/MetricCard';
import type { LoadState } from '../../types/api';
import { AdminWriteResult } from './AdminWriteResult';

type AdminPublishRailProps = {
  selectedGameId: string | null;
  versionCodeDraft: string;
  releaseDateDraft: string;
  versionState: LoadState;
  versionError: string | null;
  versionSuccess: string | null;
  publishedVersion: { versionCode: string; releaseDate?: string; publishedAt?: string } | null;
  publishedCurrentVersion: { versionCode: string; releaseDate?: string; publishedAt?: string; updatedAt: string } | null;
  publishedBundleMeta: { versionCode: string; releaseDate?: string; publishedAt?: string; generatedAt: string } | null;
  onVersionCodeDraftChange: (value: string) => void;
  onReleaseDateDraftChange: (value: string) => void;
  onPublishVersion: () => Promise<void>;
};

export function AdminPublishRail({
  selectedGameId,
  versionCodeDraft,
  releaseDateDraft,
  versionState,
  versionError,
  versionSuccess,
  publishedVersion,
  publishedCurrentVersion,
  publishedBundleMeta,
  onVersionCodeDraftChange,
  onReleaseDateDraftChange,
  onPublishVersion
}: AdminPublishRailProps) {
  const pendingVersionCode = versionCodeDraft.trim() || '--';

  return (
    <Card size="small" className="admin-publish-rail">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div className="admin-publish-head">
          <Typography.Title heading={5} style={{ margin: 0 }}>
            版本发布操作
          </Typography.Title>
          <Tag color={selectedGameId ? 'arcoblue' : 'gray'}>{selectedGameId ?? '未选择游戏'}</Tag>
        </div>

        <Typography.Text type="secondary">
          在独立页面里直接发布当前工作区为已发布快照，再回读 `current` 与 bundle 做核对。
        </Typography.Text>

        <Form layout="vertical">
          <Form.Item label="versionCode">
            <Input value={versionCodeDraft} onChange={onVersionCodeDraftChange} placeholder="14.1" />
          </Form.Item>
          <Form.Item label="releaseDate">
            <Input value={releaseDateDraft} onChange={onReleaseDateDraftChange} placeholder="2026-03-23" />
          </Form.Item>
          <Space wrap>
            <Button type="primary" status="warning" onClick={() => void onPublishVersion()} loading={versionState === 'loading'} long>
              发布版本
            </Button>
            <Button href="#/wasm-validation">打开 Wasm 验证</Button>
          </Space>
        </Form>

        <AdminWriteResult title="版本结果" state={versionState} error={versionError} success={versionSuccess} />

        <div className="admin-publish-metrics">
          <MetricCard
            label="发布请求"
            value={publishedVersion?.versionCode ?? pendingVersionCode}
            hint={publishedVersion?.releaseDate ?? '填写 versionCode 后直接发布'}
          />
          <MetricCard
            label="已发布"
            value={publishedVersion?.versionCode ?? '--'}
            hint={publishedVersion?.publishedAt ?? '还没有发布版本'}
          />
          <MetricCard
            label="当前版本"
            value={publishedCurrentVersion?.versionCode ?? '--'}
            hint={publishedCurrentVersion?.publishedAt ?? '等待发布后刷新'}
          />
          <MetricCard
            label="Bundle"
            value={publishedBundleMeta?.versionCode ?? '--'}
            hint={publishedBundleMeta?.generatedAt ?? '当前 bundle 尚未刷新'}
          />
        </div>

        {publishedBundleMeta ? (
          <Card size="small" className="admin-publish-summary">
            <Typography.Text type="secondary">最近一次发布摘要</Typography.Text>
            <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 8 }}>
              <Typography.Text>发布版本：{publishedVersion?.versionCode ?? '--'}</Typography.Text>
              <Typography.Text>当前版本：{publishedCurrentVersion?.versionCode ?? '--'}</Typography.Text>
              <Typography.Text>发布日期：{publishedBundleMeta.releaseDate ?? '--'}</Typography.Text>
              <Typography.Text>发布时间：{publishedBundleMeta.publishedAt ?? '--'}</Typography.Text>
            </Space>
          </Card>
        ) : null}
      </Space>
    </Card>
  );
}
