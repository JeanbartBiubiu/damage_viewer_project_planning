import { Button, Card, Form, Input, Space, Tag, Typography } from '@arco-design/web-react';
import { MetricCard } from '../../components/MetricCard';
import type { LoadState } from '../../types/api';
import { AdminWriteResult } from './AdminWriteResult';

type AdminPublishRailProps = {
  selectedGameId: string | null;
  versionCodeDraft: string;
  releaseDateDraft: string;
  publishVersionIdDraft: string;
  versionState: LoadState;
  versionError: string | null;
  versionSuccess: string | null;
  createdVersion: { versionId: number; versionCode: string } | null;
  publishedVersion: { versionCode: string; dataHash: string } | null;
  publishedCurrentVersion: { versionId: number; versionCode: string } | null;
  publishedBundleMeta: { versionCode: string; dataHash: string } | null;
  onVersionCodeDraftChange: (value: string) => void;
  onReleaseDateDraftChange: (value: string) => void;
  onPublishVersionIdDraftChange: (value: string) => void;
  onCreateVersion: () => Promise<void>;
  onPublishVersion: () => Promise<void>;
};

export function AdminPublishRail({
  selectedGameId,
  versionCodeDraft,
  releaseDateDraft,
  publishVersionIdDraft,
  versionState,
  versionError,
  versionSuccess,
  createdVersion,
  publishedVersion,
  publishedCurrentVersion,
  publishedBundleMeta,
  onVersionCodeDraftChange,
  onReleaseDateDraftChange,
  onPublishVersionIdDraftChange,
  onCreateVersion,
  onPublishVersion
}: AdminPublishRailProps) {
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
          在独立页面里完成版本创建、版本发布和结果核对，资源编辑页不再直接承载发布动作。
        </Typography.Text>

        <Form layout="vertical">
          <Form.Item label="versionCode">
            <Input value={versionCodeDraft} onChange={onVersionCodeDraftChange} placeholder="14.1" />
          </Form.Item>
          <Form.Item label="releaseDate">
            <Input value={releaseDateDraft} onChange={onReleaseDateDraftChange} placeholder="2026-03-23" />
          </Form.Item>
          <Button type="primary" onClick={() => void onCreateVersion()} loading={versionState === 'loading'} long>
            创建版本
          </Button>
        </Form>

        <Form layout="vertical">
          <Form.Item label="versionId">
            <Input
              value={publishVersionIdDraft}
              onChange={onPublishVersionIdDraftChange}
              placeholder="使用刚创建的 versionId，或手动输入一个已有版本"
            />
          </Form.Item>
          <Space wrap>
            <Button type="primary" status="warning" onClick={() => void onPublishVersion()} loading={versionState === 'loading'}>
              发布版本
            </Button>
            <Button href="#/katarina-mvp">打开 Katarina MVP</Button>
          </Space>
        </Form>

        <AdminWriteResult title="版本结果" state={versionState} error={versionError} success={versionSuccess} />

        <div className="admin-publish-metrics">
          <MetricCard
            label="已创建"
            value={createdVersion?.versionCode ?? '--'}
            hint={createdVersion ? `versionId=${createdVersion.versionId}` : '还没有创建版本'}
          />
          <MetricCard
            label="已发布"
            value={publishedVersion?.versionCode ?? '--'}
            hint={publishedVersion ? `hash=${publishedVersion.dataHash}` : '还没有发布版本'}
          />
          <MetricCard
            label="当前版本"
            value={publishedCurrentVersion?.versionCode ?? '--'}
            hint={publishedCurrentVersion ? `versionId=${publishedCurrentVersion.versionId}` : '等待发布后刷新'}
          />
          <MetricCard
            label="Bundle"
            value={publishedBundleMeta?.versionCode ?? '--'}
            hint={publishedBundleMeta?.dataHash ?? '当前 bundle 尚未刷新'}
          />
        </div>

        {publishedBundleMeta ? (
          <Card size="small" className="admin-publish-summary">
            <Typography.Text type="secondary">最近一次发布摘要</Typography.Text>
            <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 8 }}>
              <Typography.Text>发布版本：{publishedVersion?.versionCode ?? '--'}</Typography.Text>
              <Typography.Text>当前版本：{publishedCurrentVersion?.versionCode ?? '--'}</Typography.Text>
              <Typography.Text>Bundle Hash：{publishedBundleMeta.dataHash}</Typography.Text>
            </Space>
          </Card>
        ) : null}
      </Space>
    </Card>
  );
}
