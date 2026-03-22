import { useEffect, useState } from 'react';
import { navigationItems, type RouteId } from './config/navigation';
import { AdminPage } from './pages/AdminPage';
import { ImagesPage } from './pages/ImagesPage';
import { KatarinaMvpPage } from './pages/KatarinaMvpPage';
import { OverviewPage } from './pages/OverviewPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { getErrorMessage, listGames, resolveApiBaseUrl } from './services/apiClient';
import type { GameSummary, LoadState } from './types/api';

const API_BASE_STORAGE_KEY = 'damage-viewer.web.api-base-url';
const ADMIN_TOKEN_STORAGE_KEY = 'damage-viewer.web.admin-token';

function readStoredValue(key: string, fallback: string): string {
  if (typeof window === 'undefined') {
    return fallback;
  }
  return window.localStorage.getItem(key) ?? fallback;
}

function readRouteFromHash(): RouteId {
  if (typeof window === 'undefined') {
    return 'overview';
  }
  const fragment = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  const match = navigationItems.find((item) => item.id === fragment);
  return match?.id ?? 'overview';
}

function getGamesStatusLabel(status: LoadState): string {
  if (status === 'loading') {
    return '连接中';
  }
  if (status === 'success') {
    return '已连通';
  }
  if (status === 'error') {
    return '失败';
  }
  return '待命';
}

export default function App() {
  const initialApiBaseUrl = readStoredValue(API_BASE_STORAGE_KEY, resolveApiBaseUrl());
  const [route, setRoute] = useState<RouteId>(() => readRouteFromHash());
  const [apiBaseDraft, setApiBaseDraft] = useState(initialApiBaseUrl);
  const [apiBaseUrl, setApiBaseUrl] = useState(initialApiBaseUrl);
  const [adminToken, setAdminToken] = useState(() => readStoredValue(ADMIN_TOKEN_STORAGE_KEY, ''));
  const [games, setGames] = useState<GameSummary[]>([]);
  const [gamesStatus, setGamesStatus] = useState<LoadState>('loading');
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [gamesEtag, setGamesEtag] = useState<string | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [reloadSeed, setReloadSeed] = useState(0);

  useEffect(() => {
    const onHashChange = () => {
      setRoute(readRouteFromHash());
    };

    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, apiBaseUrl);
  }, [apiBaseUrl]);

  useEffect(() => {
    window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, adminToken);
  }, [adminToken]);

  useEffect(() => {
    let cancelled = false;

    async function loadGames() {
      setGamesStatus('loading');
      setGamesError(null);

      try {
        const result = await listGames(apiBaseUrl);
        if (cancelled) {
          return;
        }

        setGames(result.data);
        setGamesEtag(result.etag);
        setGamesStatus('success');
        setSelectedGameId((current) => {
          if (current && result.data.some((game) => game.gameId === current)) {
            return current;
          }
          return result.data[0]?.gameId ?? null;
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setGames([]);
        setGamesStatus('error');
        setGamesError(getErrorMessage(error));
        setGamesEtag(null);
        setSelectedGameId(null);
      }
    }

    void loadGames();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, reloadSeed]);

  const selectedGame = games.find((game) => game.gameId === selectedGameId) ?? null;
  const selectedGameName = selectedGame?.gameName ?? '未选择游戏';
  const activeRoute = navigationItems.find((item) => item.id === route) ?? navigationItems[0];

  let pageContent = (
    <OverviewPage
      apiBaseUrl={apiBaseUrl}
      games={games}
      gamesStatus={gamesStatus}
      gamesError={gamesError}
      gamesEtag={gamesEtag}
      selectedGameId={selectedGameId}
      onSelectGameId={setSelectedGameId}
    />
  );

  switch (route) {
    case 'workspace':
      pageContent = <WorkspacePage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} selectedGameName={selectedGameName} />;
      break;
    case 'katarina-mvp':
      pageContent = <KatarinaMvpPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} selectedGameName={selectedGameName} />;
      break;
    case 'images':
      pageContent = <ImagesPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} selectedGameName={selectedGameName} />;
      break;
    case 'admin':
      pageContent = (
        <AdminPage
          apiBaseUrl={apiBaseUrl}
          selectedGameId={selectedGameId}
          selectedGameName={selectedGameName}
          adminToken={adminToken}
          onAdminTokenChange={setAdminToken}
        />
      );
      break;
    default:
      break;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">DV</div>
          <div>
            <p className="brand-eyebrow">Damage Viewer</p>
            <h1 className="brand-title">Web Skeleton</h1>
          </div>
        </div>

        <p className="sidebar-copy">
          先把发布 bundle、最小运行层和 MVP 场景页接起来，再继续向通用编辑器和真实 Wasm 二进制推进。
        </p>

        <nav className="nav-list" aria-label="Primary">
          {navigationItems.map((item) => (
            <a key={item.id} className={`nav-link${item.id === route ? ' active' : ''}`} href={`#/${item.id}`}>
              <span className="nav-label">{item.label}</span>
              <span className="nav-summary">{item.summary}</span>
            </a>
          ))}
        </nav>

        <div className="sidebar-card">
          <p className="sidebar-card-title">当前连接</p>
          <div className="sidebar-row">
            <span className={`status-chip ${gamesStatus}`}>{getGamesStatusLabel(gamesStatus)}</span>
            <span className="sidebar-value">{selectedGameName}</span>
          </div>
          <p className="field-note">API: {apiBaseUrl}</p>
          <p className="field-note">JWT: {adminToken.trim() ? '已保存到本地浏览器' : '未配置'}</p>
          <p className="field-note">Games ETag: {gamesEtag ?? '尚未返回'}</p>
        </div>
      </aside>

      <main className="app-main">
        <section className="hero-banner">
          <div className="hero-header">
            <p className="hero-eyebrow">{activeRoute.label}</p>
            <h2 className="hero-title">先把卡特琳娜最小闭环跑通，再往平台化扩展</h2>
            <p className="hero-copy">{activeRoute.summary}</p>
          </div>
          <div className="hero-facts">
            <span className="fact-chip">Games {games.length}</span>
            <span className="fact-chip">当前 gameId {selectedGame?.gameId ?? 'none'}</span>
            <span className="fact-chip">后台 JWT {adminToken.trim() ? 'ready' : 'empty'}</span>
          </div>
        </section>

        <section className="toolbar">
          <div className="toolbar-grid">
            <label className="field field-wide">
              <span className="field-label">API 基址</span>
              <input
                className="text-input"
                value={apiBaseDraft}
                onChange={(event) => setApiBaseDraft(event.target.value)}
                placeholder="http://localhost:8080"
              />
            </label>

            <label className="field">
              <span className="field-label">当前 gameId</span>
              <select
                className="select-input"
                value={selectedGameId ?? ''}
                onChange={(event) => setSelectedGameId(event.target.value || null)}
                disabled={games.length === 0}
              >
                <option value="">未选择</option>
                {games.map((game) => (
                  <option key={game.gameId} value={game.gameId}>
                    {game.gameId} / {game.gameName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="toolbar-actions">
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                const nextValue = resolveApiBaseUrl(apiBaseDraft);
                setApiBaseDraft(nextValue);
                setApiBaseUrl(nextValue);
              }}
            >
              应用地址
            </button>
            <button className="button" type="button" onClick={() => setReloadSeed((value) => value + 1)}>
              刷新游戏列表
            </button>
          </div>
        </section>

        {gamesError ? <div className="notice notice-error">{gamesError}</div> : null}

        <div className="page-stack">{pageContent}</div>
      </main>
    </div>
  );
}
