import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Grid, Input, Space, Typography } from '@arco-design/web-react';
import { DetailGrid, type DetailGridItem } from '../components/DataTable';
import { Panel } from '../components/Panel';
import { getCurrentVersion, getErrorMessage } from '../services/apiClient';
import { getCombatDataState } from '../services/combatDataClient';
import type { CurrentVersion } from '../types/api';
import type { CombatDataState } from '../types/combatData';
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
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<CurrentVersion | null>(null);
  const [combatDataState, setCombatDataState] = useState<CombatDataState | null>(null);

  const {
    versionCodeDraft,
    releaseDateDraft,
    versionState,
    versionError,
    versionSuccess,
    publishedVersion,
    publishedCurrentVersion,
    publishedCombatDataState,
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
      setInspectError(null);
      setCurrentVersion(null);
      setCombatDataState(null);
      return;
    }

    let cancelled = false;
    const gameId = selectedGameId;

    async function inspectCurrentPublishState() {
      setInspectError(null);

      try {
        const [versionResult, combatStateResult] = await Promise.all([
          getCurrentVersion(apiBaseUrl, gameId),
          getCombatDataState(apiBaseUrl, gameId)
        ]);
        if (cancelled) {
          return;
        }

        setCurrentVersion(versionResult.data);
        setCombatDataState(combatStateResult.data.data);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setCurrentVersion(null);
        setCombatDataState(null);
        setInspectError(getErrorMessage(error));
      }
    }

    void inspectCurrentPublishState();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, inspectSeed, selectedGameId]);

  const displayedCurrentVersion = publishedCurrentVersion ?? currentVersion;
  const displayedCombatDataState = publishedCombatDataState ?? combatDataState;
  const publishSummaryItems: DetailGridItem[] = [
    {
      label: '当前版本',
      value: displayedCurrentVersion?.versionCode ? (
        <Typography.Text code>{displayedCurrentVersion.versionCode}</Typography.Text>
      ) : (
        '--'
      ),
      hint: displayedCurrentVersion?.publishedAt ?? displayedCurrentVersion?.releaseDate ?? '尚未读取到 current version'
    },
    {
      label: 'releaseDate',
      value: displayedCurrentVersion?.releaseDate ?? '--',
      hint: '当前版本发布日期'
    },
    {
      label: 'changeRevision',
      value:
        displayedCurrentVersion?.changeRevision != null ? (
          <Typography.Text code>{String(displayedCurrentVersion.changeRevision)}</Typography.Text>
        ) : (
          '--'
        ),
      hint: '版本侧变更修订'
    },
    {
      label: 'combat-data current',
      value:
        displayedCombatDataState != null ? (
          <Typography.Text code>{String(displayedCombatDataState.currentRevision)}</Typography.Text>
        ) : (
          '--'
        ),
      hint: '工作区最新修订'
    },
    {
      label: 'combat-data published',
      value:
        displayedCombatDataState != null ? (
          <Typography.Text code>{String(displayedCombatDataState.publishedRevision)}</Typography.Text>
        ) : (
          '--'
        ),
      hint: '已发布修订'
    },
    {
      label: '最近发布结果',
      value: publishedVersion?.versionCode ? <Typography.Text code>{publishedVersion.versionCode}</Typography.Text> : '本次未发布',
      hint:
        publishedVersion?.changeRevision != null
          ? `changeRevision=${publishedVersion.changeRevision} / ${publishedVersion.publishedAt ?? publishedVersion.releaseDate ?? ''}`
          : publishedVersion?.publishedAt ?? publishedVersion?.releaseDate ?? '还没有新的发布回执'
    },
    {
      label: 'combat-data 更新时间',
      value: formatDate(displayedCombatDataState?.updatedAt),
      hint: '发布后应与线上 state 一致'
    }
  ];

  return (
    <div className="page-workspace page-stack version-publish-page">
      <Panel
        title="版本发布"
        kicker="独立操作页面"
        actions={
          <Space wrap>
            <Button onClick={() => setInspectSeed((value) => value + 1)}>刷新当前状态</Button>
          </Space>
        }
      >
        <Row gutter={[16, 16]} align="stretch">
          <Col xs={24} lg={14}>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
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

      <Panel title="发布操作" kicker="Publish Version">
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
                    发布摘要
                  </Typography.Title>
                  <DetailGrid items={publishSummaryItems} />
                </Space>
              </Card>
            </Space>
          </Col>
        </Row>
      </Panel>
    </div>
  );
}
