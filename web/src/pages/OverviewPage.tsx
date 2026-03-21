import { useEffect, useState } from 'react';
import { DataTable } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import { publicSurfaceEndpoints } from '../config/navigation';
import { getCurrentVersion, getErrorMessage, getOwnerCategories } from '../services/apiClient';
import type { CurrentVersion, GameSummary, LoadState, OwnerCategory } from '../types/api';

type OverviewPageProps = {
  apiBaseUrl: string;
  games: GameSummary[];
  gamesStatus: LoadState;
  gamesError: string | null;
  gamesEtag: string | null;
  selectedGameId: string | null;
  onSelectGameId: (gameId: string | null) => void;
};

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
  gamesStatus,
  gamesError,
  gamesEtag,
  selectedGameId,
  onSelectGameId
}: OverviewPageProps) {
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [currentVersion, setCurrentVersion] = useState<CurrentVersion | null>(null);
  const [ownerCategories, setOwnerCategories] = useState<OwnerCategory[]>([]);
  const [snapshotState, setSnapshotState] = useState<LoadState>('idle');
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [ownerCategoriesEtag, setOwnerCategoriesEtag] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedGameId) {
      setCurrentVersion(null);
      setOwnerCategories([]);
      setSnapshotState('idle');
      setSnapshotError(null);
      setOwnerCategoriesEtag(null);
      return;
    }

    const gameId = selectedGameId;
    let cancelled = false;

    async function loadSnapshot() {
      setSnapshotState('loading');
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
        setOwnerCategoriesEtag(ownerResult.value.etag);
      } else {
        setOwnerCategories([]);
        setOwnerCategoriesEtag(null);
        errors.push(getErrorMessage(ownerResult.reason));
      }

      if (errors.length > 0) {
        setSnapshotState('error');
        setSnapshotError(errors.join('；'));
      } else {
        setSnapshotState('success');
      }
    }

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, refreshSeed, selectedGameId]);

  return (
    <div className="page-grid">
      <Panel title="产品取向" kicker="Architecture">
        <div className="metric-grid">
          <MetricCard label="客户端定位" value="Rich Client" hint="Bundle + IndexDB + WASM" />
          <MetricCard label="读路径" value="ETag 驱动" hint="games -> current -> bundle" />
          <MetricCard label="图片策略" value="手动增量同步" hint="按 gameId 进入本地图片仓" />
          <MetricCard label="扩展位" value="Formula 已预留" hint="对齐后端已存在的公式控制器" />
        </div>
      </Panel>

      <Panel title="游戏入口" kicker="Discovery">
        {games.length === 0 ? (
          <EmptyState title="还没有可选游戏" description="先确认后端的 /api/games 是否返回数据。" />
        ) : (
          <>
            <div className="chip-row">
              {games.map((game) => (
                <button
                  key={game.gameId}
                  className={`chip-button${selectedGameId === game.gameId ? ' active' : ''}`}
                  type="button"
                  onClick={() => onSelectGameId(game.gameId)}
                >
                  {game.gameId} / {game.gameName}
                </button>
              ))}
            </div>
            <div className="metric-grid compact">
              <MetricCard label="Games 总数" value={String(games.length)} hint={`状态：${gamesStatus}`} />
              <MetricCard label="选中 gameId" value={selectedGameId ?? '未选择'} hint="全局上下文会被所有页面复用" />
              <MetricCard label="Games ETag" value={gamesEtag ?? '无'} hint="后续可继续接前端强缓存" />
              <MetricCard label="错误提示" value={gamesError ? '有' : '无'} hint={gamesError ?? '当前接口正常'} />
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="当前游戏快照"
        kicker="Live Snapshot"
        actions={
          <button className="button secondary" type="button" onClick={() => setRefreshSeed((value) => value + 1)}>
            刷新快照
          </button>
        }
      >
        {!selectedGameId ? (
          <EmptyState title="还没选中 gameId" description="先从顶部或本页按钮切一个游戏，再看当前版本和 ownerType 字典。" />
        ) : (
          <div className="split-grid">
            <div className="stack-block">
              <div className="metric-grid compact">
                <MetricCard label="快照状态" value={snapshotState} hint={snapshotError ?? '当前接口已对齐'} />
                <MetricCard
                  label="当前版本"
                  value={currentVersion?.versionCode ?? '未发布'}
                  hint={currentVersion ? `versionId=${currentVersion.versionId}` : '后端可能还没有 current'}
                />
                <MetricCard
                  label="更新时间"
                  value={formatDate(currentVersion?.updatedAt)}
                  hint={`Owner Categories ETag：${ownerCategoriesEtag ?? '无'}`}
                />
                <MetricCard
                  label="ownerType 数"
                  value={String(ownerCategories.length)}
                  hint="技能编辑器、归属筛选都能直接复用"
                />
              </div>

              {snapshotError ? <div className="notice notice-error">{snapshotError}</div> : null}

              <DataTable
                columns={['ownerType', '名称', '描述', 'updatedAt']}
                rows={ownerCategories.map((category) => [
                  <span className="mono" key={`${category.ownerType}-type`}>
                    {category.ownerType}
                  </span>,
                  category.name ?? '—',
                  category.description ?? '—',
                  formatDate(category.updatedAt)
                ])}
                emptyMessage="当前没有 ownerType 字典。"
              />
            </div>

            <div className="stack-block">
              <JsonBlock value={currentVersion ?? { message: '当前 gameId 还没有已发布版本。' }} />
            </div>
          </div>
        )}
      </Panel>

      <Panel title="公共接口面" kicker="Public Surface">
        <div className="endpoint-grid">
          {publicSurfaceEndpoints.map((endpoint) => (
            <article className="endpoint-card" key={endpoint.path}>
              <div className="endpoint-header">
                <span className="endpoint-method">{endpoint.method}</span>
                <h3 className="endpoint-title">{endpoint.title}</h3>
              </div>
              <p className="endpoint-path">{endpoint.path}</p>
              <p className="endpoint-description">{endpoint.description}</p>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
