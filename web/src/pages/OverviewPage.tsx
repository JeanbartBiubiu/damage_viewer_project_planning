import { useEffect, useState } from 'react';
import { Alert, Button, Card, Grid, Space, Typography } from '@arco-design/web-react';
import { DataTable, DetailGrid, type DetailGridItem } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import { getCurrentVersion, getErrorMessage, getOwnerCategories } from '../services/apiClient';
import type { CurrentVersion, GameSummary, OwnerCategory } from '../types/api';

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
  const [ownerCategories, setOwnerCategories] = useState<OwnerCategory[]>([]);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedGameId) {
      setCurrentVersion(null);
      setOwnerCategories([]);
      setSnapshotError(null);
      return;
    }

    const gameId = selectedGameId;
    let cancelled = false;

    async function loadSnapshot() {
      setSnapshotError(null);

      const [versionResult, ownerResult] = await Promise.allSettled([
        getCurrentVersion(apiBaseUrl, gameId),
        getOwnerCategories(apiBaseUrl, gameId)
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

      if (ownerResult.status === 'fulfilled') {
        setOwnerCategories(ownerResult.value.data.ownerCategories);
      } else {
        setOwnerCategories([]);
        errors.push(getErrorMessage(ownerResult.reason));
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
          label: '发布时间',
          value: currentVersion.publishedAt ?? currentVersion.releaseDate ?? '未记录',
          hint: 'publishedAt 优先，其次 releaseDate'
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
        kicker="实时快照"
        actions={
          <Button onClick={() => setRefreshSeed((value) => value + 1)} type="primary">
            刷新快照
          </Button>
        }
      >
        {!selectedGameId ? (
          <EmptyState title="还没有选择 gameId" description="先在顶部或本页切换一个游戏，再查看当前版本和 ownerType 字典。" />
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
                  label="更新时间"
                  value={formatDate(currentVersion?.updatedAt)}
                  hint={currentVersion?.releaseDate ?? currentVersion?.publishedAt ?? '后端可能还没有 current version'}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="ownerType 数量" value={String(ownerCategories.length)} hint="编辑器和归类筛选会复用这份数据" />
              </Col>
            </Row>

            {snapshotError ? <Alert type="error" content={snapshotError} /> : null}

            <Row gutter={[16, 16]}>
              <Col xs={24} lg={14}>
                <DataTable
                  columns={['ownerType', '名称', '描述', 'updatedAt']}
                  rows={ownerCategories.map((category) => [
                    <Typography.Text code key={`${category.ownerType}-type`}>
                      {category.ownerType}
                    </Typography.Text>,
                    category.name ?? '—',
                    category.description ?? '—',
                    formatDate(category.updatedAt)
                  ])}
                  emptyMessage="当前没有 ownerType 字典。"
                />
              </Col>
              <Col xs={24} lg={10}>
                <Card size="small">
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <Typography.Title heading={5} style={{ margin: 0 }}>
                      当前版本详情
                    </Typography.Title>
                    <DetailGrid items={currentVersionDetails} />
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
