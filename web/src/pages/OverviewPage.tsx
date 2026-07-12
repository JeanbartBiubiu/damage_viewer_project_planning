import { useEffect, useState } from 'react';
import { Alert, Button, Card, Grid, Space, Typography } from '@arco-design/web-react';
import { DetailGrid, type DetailGridItem } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import { getCurrentVersion, getErrorMessage } from '../services/apiClient';
import { getCombatDataState } from '../services/combatDataClient';
import type { CurrentVersion, GameSummary } from '../types/api';
import type { CombatDataState } from '../types/combatData';

type OverviewPageProps = {
  apiBaseUrl: string;
  games: GameSummary[];
  selectedGameId: string | null;
  onSelectGameId: (gameId: string | null) => void;
};

const { Row, Col } = Grid;

function formatDate(value?: string | null): string {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function OverviewPage({
  apiBaseUrl,
  games,
  selectedGameId,
  onSelectGameId
}: OverviewPageProps) {
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [currentVersion, setCurrentVersion] = useState<CurrentVersion | null>(null);
  const [combatDataState, setCombatDataState] = useState<CombatDataState | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedGameId) {
      setCurrentVersion(null);
      setCombatDataState(null);
      setSnapshotError(null);
      return;
    }

    const gameId = selectedGameId;
    let cancelled = false;

    async function loadSnapshot() {
      setSnapshotError(null);

      const [versionResult, combatStateResult] = await Promise.allSettled([
        getCurrentVersion(apiBaseUrl, gameId),
        getCombatDataState(apiBaseUrl, gameId)
      ]);

      if (cancelled) {
        return;
      }

      const errors: string[] = [];

      if (versionResult.status === 'fulfilled') {
        setCurrentVersion(versionResult.value.data);
      } else {
        setCurrentVersion(null);
        errors.push(getErrorMessage(versionResult.reason));
      }

      if (combatStateResult.status === 'fulfilled') {
        setCombatDataState(combatStateResult.value.data.data);
      } else {
        setCombatDataState(null);
        errors.push(getErrorMessage(combatStateResult.reason));
      }

      if (errors.length > 0) {
        setSnapshotError(errors.join('；'));
      }
    }

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, refreshSeed, selectedGameId]);

  const currentVersionDetails: DetailGridItem[] = currentVersion
    ? [
        {
          label: '版本代码',
          value: <Typography.Text code>{currentVersion.versionCode}</Typography.Text>,
          hint: '当前线上版本标识'
        },
        {
          label: '发布日期',
          value: currentVersion.releaseDate ?? '未记录',
          hint: 'releaseDate'
        },
        {
          label: 'changeRevision',
          value: currentVersion.changeRevision != null ? String(currentVersion.changeRevision) : '—',
          hint: '版本发布对应的变更修订'
        },
        {
          label: '发布时间',
          value: currentVersion.publishedAt ?? '未记录',
          hint: 'publishedAt'
        },
        {
          label: '最近更新',
          value: formatDate(currentVersion.updatedAt),
          hint: '最近一次后端更新时间'
        }
      ]
    : [
        {
          label: '当前版本',
          value: '未发布',
          hint: '当前 gameId 还没有 current version。'
        }
      ];

  const combatDataDetails: DetailGridItem[] = combatDataState
    ? [
        {
          label: 'currentRevision',
          value: <Typography.Text code>{String(combatDataState.currentRevision)}</Typography.Text>,
          hint: '工作区最新修订'
        },
        {
          label: 'publishedRevision',
          value: <Typography.Text code>{String(combatDataState.publishedRevision)}</Typography.Text>,
          hint: '已发布修订'
        },
        {
          label: '更新时间',
          value: formatDate(combatDataState.updatedAt),
          hint: 'combat-data/state.updatedAt'
        }
      ]
    : [
        {
          label: 'combat-data',
          value: '未读取',
          hint: '尚未拿到 combat-data/state。'
        }
      ];

  return (
    <div className="page-overview page-stack">
      <Panel title="游戏入口" kicker="发现">
        {games.length === 0 ? (
          <EmptyState title="还没有可选游戏" description="先确认后端 /api/games 是否返回了数据。" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space wrap>
              {games.map((game) => (
                <Button
                  key={game.gameId}
                  type={selectedGameId === game.gameId ? 'primary' : 'secondary'}
                  shape="round"
                  size="small"
                  onClick={() => onSelectGameId(game.gameId)}
                >
                  {game.gameId} / {game.gameName}
                </Button>
              ))}
            </Space>

            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="Games 总数" value={String(games.length)} hint="后端已返回的游戏数量" />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="当前 gameId" value={selectedGameId ?? '未选择'} hint="会同步到所有页面上下文" />
              </Col>
            </Row>
          </Space>
        )}
      </Panel>

      <Panel
        title="当前游戏快照"
        kicker="版本 + combat-data"
        actions={
          <Button onClick={() => setRefreshSeed((value) => value + 1)} type="primary">
            刷新快照
          </Button>
        }
      >
        {!selectedGameId ? (
          <EmptyState
            title="还没有选择 gameId"
            description="先在顶部或本页切换一个游戏，再查看当前版本与 combat-data 修订。"
          />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard
                  label="当前版本"
                  value={currentVersion?.versionCode ?? '未发布'}
                  hint={currentVersion?.releaseDate ?? currentVersion?.publishedAt ?? '后端可能还没有 current version'}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard
                  label="版本 changeRevision"
                  value={currentVersion?.changeRevision != null ? String(currentVersion.changeRevision) : '—'}
                  hint="来自 versions/current"
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard
                  label="combat-data current"
                  value={combatDataState != null ? String(combatDataState.currentRevision) : '—'}
                  hint="工作区最新修订"
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard
                  label="combat-data published"
                  value={combatDataState != null ? String(combatDataState.publishedRevision) : '—'}
                  hint="已发布修订"
                />
              </Col>
            </Row>

            {snapshotError ? <Alert type="error" content={snapshotError} /> : null}

            <Row gutter={[16, 16]}>
              <Col xs={24} lg={12}>
                <Card size="small">
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <Typography.Title heading={5} style={{ margin: 0 }}>
                      当前版本详情
                    </Typography.Title>
                    <DetailGrid items={currentVersionDetails} />
                  </Space>
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card size="small">
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <Typography.Title heading={5} style={{ margin: 0 }}>
                      Combat-data 状态
                    </Typography.Title>
                    <Typography.Text type="secondary">
                      资源编辑请使用「战斗数据工作台」；发布后 publishedRevision 会推进。
                    </Typography.Text>
                    <DetailGrid items={combatDataDetails} />
                  </Space>
                </Card>
              </Col>
            </Row>
          </Space>
        )}
      </Panel>
    </div>
  );
}
