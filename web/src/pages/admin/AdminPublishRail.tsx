import { Button, Card, Form, Input, Space, Table, Tag, Typography } from '@arco-design/web-react';
import type { PublishedContractDiagnostic } from '../../engine/tinygoV2DpsAdapter';
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
  publishedContractDiagnostics?: PublishedContractDiagnostic[];
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
  publishedVersion: _publishedVersion,
  publishedCurrentVersion: _publishedCurrentVersion,
  publishedBundleMeta: _publishedBundleMeta,
  publishedContractDiagnostics = [],
  onVersionCodeDraftChange,
  onReleaseDateDraftChange,
  onPublishVersion
}: AdminPublishRailProps) {
  const diagnosticCounts = {
    error: publishedContractDiagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
    warning: publishedContractDiagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
    info: publishedContractDiagnostics.filter((diagnostic) => diagnostic.severity === 'info').length
  };

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
            <Button href="#/wasm-validation">打开 Wasm 验证</Button>
          </Space>
        </Form>

        {publishedContractDiagnostics.length > 0 ? (
          <Card size="small" className="admin-publish-preflight">
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <div className="admin-publish-head">
                <Typography.Text bold>发布前契约检查</Typography.Text>
                <Space wrap>
                  <Tag color="red">error {diagnosticCounts.error}</Tag>
                  <Tag color="orangered">warning {diagnosticCounts.warning}</Tag>
                  <Tag color="arcoblue">info {diagnosticCounts.info}</Tag>
                </Space>
              </div>
              <Typography.Text type="secondary">
                基于当前 Admin draft items/skills 的 DPS equipment skillRefs 诊断；error 会阻止发布。
              </Typography.Text>
              <Table
                rowKey={(record) => `${record.severity}-${record.code}-${record.itemId ?? ''}-${record.skillId ?? ''}-${record.message}`}
                size="small"
                pagination={false}
                data={publishedContractDiagnostics}
                columns={publishedContractDiagnosticColumns}
              />
            </Space>
          </Card>
        ) : null}

        <AdminWriteResult title="版本结果" state={versionState} error={versionError} success={versionSuccess} />
      </Space>
    </Card>
  );
}

const publishedContractDiagnosticColumns = [
  {
    title: 'severity',
    width: 88,
    render: (_: unknown, record: PublishedContractDiagnostic) => (
      <Tag color={record.severity === 'error' ? 'red' : record.severity === 'warning' ? 'orangered' : 'arcoblue'}>
        {record.severity}
      </Tag>
    )
  },
  {
    title: 'code',
    render: (_: unknown, record: PublishedContractDiagnostic) => <Typography.Text code>{record.code}</Typography.Text>
  },
  {
    title: 'itemId',
    render: (_: unknown, record: PublishedContractDiagnostic) => (
      <Typography.Text code>{record.itemId ?? '—'}</Typography.Text>
    )
  },
  {
    title: 'itemName',
    render: (_: unknown, record: PublishedContractDiagnostic) => (
      <Typography.Text>{record.itemName?.trim() || '—'}</Typography.Text>
    )
  },
  {
    title: 'skillId',
    render: (_: unknown, record: PublishedContractDiagnostic) => (
      <Typography.Text code>{record.skillId ?? '—'}</Typography.Text>
    )
  },
  {
    title: 'skillName',
    render: (_: unknown, record: PublishedContractDiagnostic) => (
      <Typography.Text>{record.skillName?.trim() || '—'}</Typography.Text>
    )
  },
  {
    title: 'message',
    render: (_: unknown, record: PublishedContractDiagnostic) => record.message
  }
];
