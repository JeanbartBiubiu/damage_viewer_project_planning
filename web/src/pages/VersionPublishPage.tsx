import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Grid, Input, Space, Typography } from '@arco-design/web-react';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import { getErrorMessage } from '../services/apiClient';
import { loadPublishedBundleSnapshot } from '../services/bundleSnapshot';
import type { BundleMeta, CurrentVersion, LoadState } from '../types/api';
import { AdminPublishRail } from './admin/AdminPublishRail';
import { usePublishFlow } from './admin/usePublishFlow';

type VersionPublishPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
  adminToken: string;
  onAdminTokenChange: (value: string) => void;
  onDataPublished?: () => void;
};

const { Row, Col } = Grid;

function formatDate(value?: string | null): string {
  if (!value) {
    return '--';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function VersionPublishPage({
  apiBaseUrl,
  selectedGameId,
  selectedGameName,
  adminToken,
  onAdminTokenChange,
  onDataPublished
}: VersionPublishPageProps) {
  const [inspectSeed, setInspectSeed] = useState(0);
  const [inspectState, setInspectState] = useState<LoadState>('idle');
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<CurrentVersion | null>(null);
  const [bundleMeta, setBundleMeta] = useState<BundleMeta | null>(null);

  const {
    versionCodeDraft,
    releaseDateDraft,
    versionState,
    versionError,
    versionSuccess,
    publishedVersion,
    publishedCurrentVersion,
    publishedBundleMeta,
    setVersionCodeDraft,
    setReleaseDateDraft,
    handlePublishVersion
  } = usePublishFlow({
    apiBaseUrl,
    selectedGameId,
    adminToken,
    onDataPublished: () => {
      setInspectSeed((value) => value + 1);
      onDataPublished?.();
    }
  });

  useEffect(() => {
    if (!selectedGameId) {
      setInspectState('idle');
      setInspectError(null);
      setCurrentVersion(null);
      setBundleMeta(null);
      return;
    }

    let cancelled = false;
    const gameId = selectedGameId;

    async function inspectCurrentPublishState() {
      setInspectState('loading');
      setInspectError(null);

      try {
        const snapshot = await loadPublishedBundleSnapshot(apiBaseUrl, gameId);
        if (cancelled) {
          return;
        }

        setCurrentVersion(snapshot.currentVersion);
        setBundleMeta(snapshot.bundle.meta);
        setInspectState('success');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setCurrentVersion(null);
        setBundleMeta(null);
        setInspectState('error');
        setInspectError(getErrorMessage(error));
      }
    }

    void inspectCurrentPublishState();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, inspectSeed, selectedGameId]);

  const displayedCurrentVersion = publishedCurrentVersion ?? currentVersion;
  const displayedBundleMeta = publishedBundleMeta ?? bundleMeta;

  return (
    <div className="page-workspace page-stack version-publish-page">
      <Panel
        title="版本发布"
        kicker="独立操作页面"
        actions={
          <Space wrap>
            <Button onClick={() => setInspectSeed((value) => value + 1)}>刷新当前版本</Button>
            <Button href="#/katarina-mvp">前往 Katarina MVP</Button>
          </Space>
        }
      >
        <Row gutter={[16, 16]} align="stretch">
          <Col xs={24} lg={14}>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Typography.Text type="secondary">
                版本发布集中在这一页处理：提交 `versionCode`，发布后立即回读 `current` 与 bundle 快照。
              </Typography.Text>
              <div className="admin-resource-summary">
                <div className="admin-summary-item">
                  <span className="admin-summary-label">当前游戏</span>
                  <strong className="admin-summary-value">{selectedGameName}</strong>
                  <span className="admin-summary-note">{selectedGameId ?? '未选择 gameId'}</span>
                </div>
                <div className="admin-summary-item">
                  <span className="admin-summary-label">当前版本</span>
                  <strong className="admin-summary-value">{displayedCurrentVersion?.versionCode ?? '--'}</strong>
                  <span className="admin-summary-note">
                    {displayedCurrentVersion?.publishedAt ?? displayedCurrentVersion?.releaseDate ?? '尚未读取到 current version'}
                  </span>
                </div>
                <div className="admin-summary-item">
                  <span className="admin-summary-label">检查状态</span>
                  <strong className="admin-summary-value">{inspectState}</strong>
                  <span className="admin-summary-note">
                    {displayedBundleMeta ? `generatedAt ${formatDate(displayedBundleMeta.generatedAt)}` : '等待读取 bundle meta'}
                  </span>
                </div>
              </div>
            </Space>
          </Col>

          <Col xs={24} lg={10}>
            <Form layout="vertical">
              <Form.Item label="Admin Token">
                <Input.TextArea
                  autoSize={{ minRows: 4, maxRows: 6 }}
                  value={adminToken}
                  onChange={onAdminTokenChange}
                  placeholder="在这里粘贴 Admin JWT"
                />
              </Form.Item>
            </Form>
          </Col>
        </Row>

        {inspectError ? <Alert type="error" content={inspectError} style={{ marginTop: 16 }} /> : null}
      </Panel>

      <Panel title="发布操作" kicker="Publish Snapshot">
        <Row gutter={[16, 16]} align="stretch">
          <Col xs={24} xl={13}>
            <AdminPublishRail
              selectedGameId={selectedGameId}
              versionCodeDraft={versionCodeDraft}
              releaseDateDraft={releaseDateDraft}
              versionState={versionState}
              versionError={versionError}
              versionSuccess={versionSuccess}
              publishedVersion={publishedVersion}
              publishedCurrentVersion={displayedCurrentVersion}
              publishedBundleMeta={displayedBundleMeta}
              onVersionCodeDraftChange={setVersionCodeDraft}
              onReleaseDateDraftChange={setReleaseDateDraft}
              onPublishVersion={handlePublishVersion}
            />
          </Col>

          <Col xs={24} xl={11}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Card size="small">
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Typography.Title heading={5} style={{ margin: 0 }}>
                    当前线上快照
                  </Typography.Title>
                  <Row gutter={[12, 12]}>
                    <Col xs={24} sm={12}>
                      <MetricCard
                        label="current version"
                        value={displayedCurrentVersion?.versionCode ?? '--'}
                        hint={displayedCurrentVersion?.releaseDate ?? displayedCurrentVersion?.publishedAt ?? '等待读取'}
                      />
                    </Col>
                    <Col xs={24} sm={12}>
                      <MetricCard
                        label="bundle version"
                        value={displayedBundleMeta?.versionCode ?? '--'}
                        hint={displayedBundleMeta ? `generatedAt ${formatDate(displayedBundleMeta.generatedAt)}` : '等待读取'}
                      />
                    </Col>
                  </Row>
                </Space>
              </Card>

              <Card size="small">
                <Typography.Title heading={5} style={{ marginTop: 0 }}>
                  发布摘要
                </Typography.Title>
                <JsonBlock
                  value={{
                    currentVersion: displayedCurrentVersion,
                    bundleMeta: displayedBundleMeta,
                    publishedVersion
                  }}
                />
              </Card>
            </Space>
          </Col>
        </Row>
      </Panel>
    </div>
  );
}
