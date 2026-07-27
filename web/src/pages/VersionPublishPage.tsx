import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Grid, Input, Space, Typography } from '@arco-design/web-react';
import { DetailGrid, type DetailGridItem } from '../components/DataTable';
import { Panel } from '../components/Panel';
import { getCurrentVersion } from '../services/apiClient';
import { getCombatDataState } from '../services/combatDataClient';
import type { CurrentVersion } from '../types/api';
import type { CombatDataState } from '../types/combatData';
import { AdminPublishRail } from './admin/AdminPublishRail';
import { usePublishFlow } from './admin/usePublishFlow';
import {
  classifyCombatDataSettled,
  classifyCurrentVersionSettled,
  inspectStatusMessage,
  resolveInspectPageStatus,
  type CurrentVersionObservation
} from './admin/versionPublishModel';

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
  const [inspectLoading, setInspectLoading] = useState(false);
  const [currentObservation, setCurrentObservation] = useState<CurrentVersionObservation | null>(null);
  const [combatDataState, setCombatDataState] = useState<CombatDataState | null>(null);
  const [combatInspectError, setCombatInspectError] = useState<string | null>(null);

  const {
    versionCodeDraft,
    releaseDateDraft,
    versionState,
    versionError,
    versionSuccess,
    verificationWarning,
    publishDisabled,
    publishDisabledReason,
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
      setInspectLoading(false);
      setCurrentObservation(null);
      setCombatDataState(null);
      setCombatInspectError(null);
      return;
    }

    let cancelled = false;
    const gameId = selectedGameId;

    async function inspectCurrentPublishState() {
      setInspectLoading(true);
      setCurrentObservation(null);
      setCombatDataState(null);
      setCombatInspectError(null);

      const [versionResult, combatStateResult] = await Promise.allSettled([
        getCurrentVersion(apiBaseUrl, gameId),
        getCombatDataState(apiBaseUrl, gameId)
      ]);

      if (cancelled) {
        return;
      }

      // Apply each observation independently so one failure cannot erase the other.
      setCurrentObservation(classifyCurrentVersionSettled(versionResult));

      const combatObservation = classifyCombatDataSettled(combatStateResult);
      if (combatObservation.status === 'available') {
        setCombatDataState(combatObservation.state);
        setCombatInspectError(null);
      } else {
        setCombatDataState(null);
        setCombatInspectError(combatObservation.message);
      }

      setInspectLoading(false);
    }

    void inspectCurrentPublishState();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, inspectSeed, selectedGameId]);

  const inspectStatus = resolveInspectPageStatus({
    selectedGameId,
    loading: inspectLoading,
    currentObservation
  });

  const inspectedCurrentVersion: CurrentVersion | null =
    currentObservation?.status === 'available' ? currentObservation.version : null;
  const displayedCurrentVersion = publishedCurrentVersion ?? inspectedCurrentVersion;
  const displayedCombatDataState = publishedCombatDataState ?? combatDataState;

  const currentFailureMessage =
    currentObservation?.status === 'failure' ? currentObservation.message : null;
  const statusMessage = inspectStatusMessage(inspectStatus, currentFailureMessage);

  const publishSummaryItems: DetailGridItem[] = [
    {
      label: '当前版本',
      value: displayedCurrentVersion?.versionCode ? (
        <Typography.Text code>{displayedCurrentVersion.versionCode}</Typography.Text>
      ) : (
        '--'
      ),
      hint:
        inspectStatus === 'no-current'
          ? '尚无 current version（404）'
          : (displayedCurrentVersion?.publishedAt ??
            displayedCurrentVersion?.releaseDate ??
            '尚未读取到 current version')
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
      hint: combatInspectError ? `读取失败：${combatInspectError}` : '工作区最新修订'
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
            <Button onClick={() => setInspectSeed((value) => value + 1)} disabled={!selectedGameId}>
              刷新当前状态
            </Button>
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
                    {inspectStatus === 'no-current'
                      ? '尚无 current version'
                      : (displayedCurrentVersion?.publishedAt ??
                        displayedCurrentVersion?.releaseDate ??
                        '尚未读取到 current version')}
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

        {statusMessage ? (
          <Alert
            type={
              inspectStatus === 'inspect-failure'
                ? 'error'
                : inspectStatus === 'loading'
                  ? 'info'
                  : inspectStatus === 'no-current' || inspectStatus === 'no-game'
                    ? 'warning'
                    : 'info'
            }
            content={statusMessage}
            style={{ marginTop: 16 }}
          />
        ) : null}

        {combatInspectError && inspectStatus !== 'no-game' && inspectStatus !== 'loading' ? (
          <Alert
            type="warning"
            content={`combat-data state 读取失败（不影响 current version 观察）：${combatInspectError}`}
            style={{ marginTop: 12 }}
          />
        ) : null}
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
              verificationWarning={verificationWarning}
              publishDisabled={publishDisabled}
              publishDisabledReason={publishDisabledReason}
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
