import { Button, Card, Form, Input, Space, Tag, Typography } from '@arco-design/web-react';
import type { LoadState } from '../../types/api';
import { AdminWriteResult } from './AdminWriteResult';

type AdminPublishRailProps = {
  selectedGameId: string | null;
  versionCodeDraft: string;
  releaseDateDraft: string;
  versionState: LoadState;
  versionError: string | null;
  versionSuccess: string | null;
  publishedVersion: {
    versionCode: string;
    releaseDate?: string;
    publishedAt?: string;
    changeRevision?: number;
  } | null;
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
  onVersionCodeDraftChange,
  onReleaseDateDraftChange,
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

        <Form layout="vertical">
          <Form.Item label="versionCode">
            <Input value={versionCodeDraft} onChange={onVersionCodeDraftChange} placeholder="14.1" />
          </Form.Item>
          <Form.Item label="releaseDate">
            <Input value={releaseDateDraft} onChange={onReleaseDateDraftChange} placeholder="2026-03-23" />
          </Form.Item>
          <Space wrap>
            <Button
              type="primary"
              status="warning"
              onClick={() => void onPublishVersion()}
              loading={versionState === 'loading'}
              long
            >
              发布版本
            </Button>
            <Button href="#/wasm-validation-generic">打开 Wasm 验证</Button>
            <Button href="#/combat-data">打开战斗数据工作台</Button>
          </Space>
        </Form>

        {publishedVersion ? (
          <Typography.Text type="secondary">
            最近发布：{publishedVersion.versionCode}
            {publishedVersion.changeRevision != null ? ` / changeRevision=${publishedVersion.changeRevision}` : ''}
            {publishedVersion.publishedAt ? ` / ${publishedVersion.publishedAt}` : ''}
          </Typography.Text>
        ) : null}

        <AdminWriteResult title="版本结果" state={versionState} error={versionError} success={versionSuccess} />
      </Space>
    </Card>
  );
}
