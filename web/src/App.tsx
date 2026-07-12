import { useEffect, useState } from 'react';
import { Alert, Button, Input, Layout, Select, Tag, Typography } from '@arco-design/web-react';
import { IconDown } from '@arco-design/web-react/icon';
import {
  combatDataResourceIdFromRoute,
  createDefaultCollapsedNavigationGroups,
  ensureActiveCombatDataNavigationGroupExpanded,
  isCombatDataRouteId,
  navigationGroups,
  type RouteId,
  type StaticRouteId
} from './config/navigation';
import { CombatDataPage } from './pages/admin/combat-data';
import {
  COMBAT_DATA_HASH_PREFIX,
  DEFAULT_COMBAT_DATA_RESOURCE_ID,
  combatDataHashSegment,
  parseCombatDataRoute
} from './pages/admin/combatDataNav';
import { ImagesPage } from './pages/ImagesPage';
import { OverviewPage } from './pages/OverviewPage';
import { VersionPublishPage } from './pages/VersionPublishPage';
import { WasmValidationGenericPage } from './pages/WasmValidationGenericPage';
import { getErrorMessage, listGames, resolveApiBaseUrl } from './services/apiClient';
import type { GameSummary, LoadState } from './types/api';

const API_BASE_STORAGE_KEY = 'damage-viewer.web.api-base-url';
const ADMIN_TOKEN_STORAGE_KEY = 'damage-viewer.web.admin-token';
const PREFERRED_DEFAULT_GAME_ID = 'lol';

const STATIC_ROUTE_IDS = new Set<string>(['overview', 'workspace', 'wasm-validation-generic', 'images']);

function resolveSelectedGameId(current: string | null, games: GameSummary[]): string | null {
  if (current && games.some((game) => game.gameId === current)) {
    return current;
  }

  const preferredGame = games.find((game) => game.gameId === PREFERRED_DEFAULT_GAME_ID);
  if (preferredGame) {
    return preferredGame.gameId;
  }

  return games[0]?.gameId ?? null;
}

const { Sider, Content } = Layout;

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

  const segments = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const combat = parseCombatDataRoute(segments);
  if (combat.isCombatDataRoute) {
    if (combat.resourceId) {
      return combatDataHashSegment(combat.resourceId) as RouteId;
    }
    return 'combat-data';
  }

  const [routeSegment] = segments;

  if (routeSegment === 'versions' || routeSegment === 'version-publish') {
    return 'workspace';
  }

  if (routeSegment && STATIC_ROUTE_IDS.has(routeSegment)) {
    return routeSegment as StaticRouteId;
  }

  return 'overview';
}

function getGamesStatusLabel(status: LoadState): string {
  if (status === 'loading') {
    return '连接中';
  }
  if (status === 'success') {
    return '就绪';
  }
  if (status === 'error') {
    return '错误';
  }
  return '空闲';
}

function getGamesStatusColor(status: LoadState): string {
  if (status === 'loading') {
    return 'orange';
  }
  if (status === 'success') {
    return 'green';
  }
  if (status === 'error') {
    return 'red';
  }
  return 'gray';
}

function isNavItemActive(itemHashSegment: string, route: RouteId): boolean {
  return itemHashSegment === route;
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
  const [combatDataRefreshSeed, setCombatDataRefreshSeed] = useState(0);
  const [collapsedNavigationGroups, setCollapsedNavigationGroups] = useState(() =>
    createDefaultCollapsedNavigationGroups(readRouteFromHash())
  );

  useEffect(() => {
    const onHashChange = () => {
      setRoute(readRouteFromHash());
    };

    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  // Deep-link / in-app route changes: expand the owning combat-data group; keep others as-is.
  useEffect(() => {
    setCollapsedNavigationGroups((current) =>
      ensureActiveCombatDataNavigationGroupExpanded(current, route)
    );
  }, [route]);

  // `#/combat-data` (and unknown resource ids) → first registry resource page.
  useEffect(() => {
    if (route !== 'combat-data') {
      return;
    }
    const target = `#/${COMBAT_DATA_HASH_PREFIX}/${DEFAULT_COMBAT_DATA_RESOURCE_ID}`;
    if (window.location.hash !== target) {
      window.location.hash = target;
    }
  }, [route]);

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
        setSelectedGameId((current) => resolveSelectedGameId(current, result.data));
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
  const gamesReachable = gamesStatus === 'success';
  const combatDataResourceId = combatDataResourceIdFromRoute(route);

  const applyApiBase = () => {
    const nextValue = resolveApiBaseUrl(apiBaseDraft);
    setApiBaseDraft(nextValue);
    setApiBaseUrl(nextValue);
  };

  let pageContent = (
    <OverviewPage
      apiBaseUrl={apiBaseUrl}
      games={games}
      selectedGameId={selectedGameId}
      onSelectGameId={setSelectedGameId}
    />
  );

  if (route === 'workspace') {
    pageContent = (
      <VersionPublishPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        selectedGameName={selectedGameName}
        adminToken={adminToken}
        onAdminTokenChange={setAdminToken}
        onDataPublished={() => setCombatDataRefreshSeed((value) => value + 1)}
      />
    );
  } else if (route === 'wasm-validation-generic') {
    pageContent = (
      <WasmValidationGenericPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        selectedGameName={selectedGameName}
        externalRefreshSeed={combatDataRefreshSeed}
      />
    );
  } else if (route === 'images') {
    pageContent = <ImagesPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} selectedGameName={selectedGameName} />;
  } else if (isCombatDataRouteId(route) && combatDataResourceId) {
    pageContent = (
      <CombatDataPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        resourceId={combatDataResourceId}
        gamesReachable={gamesReachable}
      />
    );
  } else if (route === 'combat-data') {
    pageContent = (
      <Alert type="info" content={`正在进入 ${DEFAULT_COMBAT_DATA_RESOURCE_ID}…`} className="workspace-alert" />
    );
  }

  return (
    <Layout className="app-shell">
      <Sider className="app-sidebar" width={330}>
        <div className="brand-lockup">
          <Tag color="arcoblue" size="small">
            Damage Viewer
          </Tag>
          <Typography.Title heading={3} className="brand-title">
            Web 控制台
          </Typography.Title>
          <Typography.Text className="brand-copy">
            combat-data 分表编辑、版本发布、图片同步与 Wasm 验证。
          </Typography.Text>
        </div>

        <nav className="nav-stack" aria-label="Primary">
          {navigationGroups.map((group) => {
            const groupActive = group.items.some((item) => isNavItemActive(item.hashSegment, route));
            const isGroupExpanded = !collapsedNavigationGroups[group.id];
            const navSubstackId = `nav-section-${group.id}`;

            return (
              <section key={group.id} className={`nav-section${groupActive ? ' is-active' : ''}`} aria-label={group.label}>
                <button
                  type="button"
                  className="nav-section-trigger"
                  aria-expanded={isGroupExpanded}
                  aria-controls={navSubstackId}
                  onClick={() =>
                    setCollapsedNavigationGroups((current) => ({
                      ...current,
                      [group.id]: !current[group.id]
                    }))
                  }
                >
                  <span className="nav-section-label">{group.label}</span>
                  <IconDown className={`nav-section-caret${isGroupExpanded ? ' is-expanded' : ''}`} aria-hidden="true" />
                </button>
                {isGroupExpanded ? (
                  <div id={navSubstackId} className="nav-substack">
                    {group.items.map((item) => {
                      const active = isNavItemActive(item.hashSegment, route);
                      return (
                        <a
                          key={item.hashSegment}
                          className={`nav-item nav-item-secondary${active ? ' is-active' : ''}`}
                          href={`#/${item.hashSegment}`}
                          aria-current={active ? 'page' : undefined}
                        >
                          <span className="nav-item-label">{item.label}</span>
                          <span className="nav-item-summary">{item.summary}</span>
                        </a>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </nav>

        <section className="sidebar-status">
          <div className="sidebar-status-head">
            <Typography.Text className="sidebar-status-kicker">会话</Typography.Text>
            <Tag color={getGamesStatusColor(gamesStatus)}>{getGamesStatusLabel(gamesStatus)}</Tag>
          </div>
          <Typography.Title heading={5} className="sidebar-status-title">
            {selectedGameName}
          </Typography.Title>
          <Typography.Text className="sidebar-status-line">API {apiBaseUrl}</Typography.Text>
          <Typography.Text className="sidebar-status-line">GameId {selectedGame?.gameId ?? '未选择'}</Typography.Text>
          <Typography.Text className="sidebar-status-line">Token {adminToken.trim() ? '已本地保存' : '未配置'}</Typography.Text>
          <Typography.Text className="sidebar-status-line">ETag {gamesEtag ?? '无'}</Typography.Text>
        </section>
      </Sider>

      <Layout className="app-content">
        <Content className="app-main">
          <div className="app-toolbar">
            <div className="app-toolbar-field app-toolbar-field--api">
              <span className="app-toolbar-label">API</span>
              <Input
                value={apiBaseDraft}
                onChange={setApiBaseDraft}
                placeholder="http://localhost:8080"
                size="small"
                onPressEnter={applyApiBase}
              />
            </div>
            <div className="app-toolbar-field app-toolbar-field--game">
              <span className="app-toolbar-label">游戏</span>
              <Select
                value={selectedGameId ?? ''}
                onChange={(value) => setSelectedGameId(value || null)}
                disabled={games.length === 0}
                placeholder="选择游戏"
                size="small"
                options={[
                  { label: '未选择', value: '' },
                  ...games.map((game) => ({ label: `${game.gameId} / ${game.gameName}`, value: game.gameId }))
                ]}
              />
            </div>
            <div className="app-toolbar-field app-toolbar-field--token">
              <span className="app-toolbar-label">Token</span>
              <Input.Password
                value={adminToken}
                onChange={setAdminToken}
                placeholder="粘贴 Admin JWT"
                autoComplete="off"
                size="small"
              />
            </div>
            <div className="app-toolbar-actions">
              <Tag color={getGamesStatusColor(gamesStatus)}>{getGamesStatusLabel(gamesStatus)}</Tag>
              <Button type="primary" size="small" onClick={applyApiBase}>
                应用
              </Button>
              <Button size="small" onClick={() => setReloadSeed((value) => value + 1)}>
                刷新
              </Button>
            </div>
          </div>

          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            当前 API 基址：{apiBaseUrl}
          </Typography.Text>

          {gamesError ? <Alert type="error" content={gamesError} className="workspace-alert" /> : null}

          <div className="page-stack">{pageContent}</div>
        </Content>
      </Layout>
    </Layout>
  );
}
