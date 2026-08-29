import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Alert, Button, Input, Layout, Select, Tag, Typography } from '@arco-design/web-react';
import { IconDown, IconMenu } from '@arco-design/web-react/icon';
import {
  createDefaultCollapsedNavigationGroups,
  navigationGroups,
  type RouteId,
  type StaticRouteId
} from './config/navigation';
import { AttributeManagementPage } from './pages/admin/attributes/AttributeManagementPage';
import { CharacterManagementPage } from './pages/admin/characters/CharacterManagementPage';
import { DamageTypeManagementPage } from './pages/admin/damage-types/DamageTypeManagementPage';
import { EquipmentManagementPage } from './pages/admin/equipment/EquipmentManagementPage';
import { GameSettingsPage } from './pages/admin/game-settings/GameSettingsPage';
import { SkillCategoryManagementPage } from './pages/admin/skill-categories/SkillCategoryManagementPage';
import { SkillManagementPage } from './pages/admin/skills/SkillManagementPage';
import { StatusManagementPage } from './pages/admin/statuses/StatusManagementPage';
import { ImagesPage } from './pages/ImagesPage';
import { getErrorMessage, listGames, resolveApiBaseUrl } from './services/apiClient';
import type { GameSummary, LoadState } from './types/api';

const API_BASE_STORAGE_KEY = 'damage-viewer.web.api-base-url';
const ADMIN_TOKEN_STORAGE_KEY = 'damage-viewer.web.admin-token';
const PREFERRED_DEFAULT_GAME_ID = 'lol';
const MOBILE_NAV_MEDIA_QUERY = '(max-width: 1240px)';
const MOBILE_PRIMARY_NAVIGATION_ID = 'mobile-primary-navigation';
const DEFAULT_ROUTE: StaticRouteId = 'attributes';
const DEFAULT_HASH = '#/attributes';

const STATIC_ROUTE_IDS = new Set<string>([
  'images',
  'attributes',
  'characters',
  'equipment',
  'skill-categories',
  'damage-types',
  'skills',
  'statuses',
  'game-settings'
]);

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

function canonicalHashForRoute(route: RouteId): string {
  return `#/${route}`;
}

function readRouteFromHash(): RouteId {
  if (typeof window === 'undefined') {
    return DEFAULT_ROUTE;
  }

  const hashPath = window.location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  const [routeSegment] = hashPath.split('/').filter(Boolean);

  if (routeSegment && STATIC_ROUTE_IDS.has(routeSegment)) {
    return routeSegment as StaticRouteId;
  }

  return DEFAULT_ROUTE;
}

function replaceLocationHash(hash: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const { pathname, search } = window.location;
  window.history.replaceState(null, '', `${pathname}${search}${hash}`);
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
  const [collapsedNavigationGroups, setCollapsedNavigationGroups] = useState(() =>
    createDefaultCollapsedNavigationGroups()
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [attributeEditorDirty, setAttributeEditorDirty] = useState(false);
  const attributeEditorDirtyRef = useRef(false);
  const acceptedHashRef = useRef(
    typeof window === 'undefined' ? DEFAULT_HASH : window.location.hash || DEFAULT_HASH
  );

  const handleAttributeDirtyChange = useCallback((dirty: boolean) => {
    attributeEditorDirtyRef.current = dirty;
    setAttributeEditorDirty(dirty);
  }, []);

  useEffect(() => {
    const applyRouteFromLocation = () => {
      const nextRoute = readRouteFromHash();
      const canonicalHash = canonicalHashForRoute(nextRoute);
      if (window.location.hash !== canonicalHash) {
        replaceLocationHash(canonicalHash);
      }
      acceptedHashRef.current = canonicalHash;
      setRoute(nextRoute);
      setMobileNavOpen(false);
    };

    const syncFromHash = () => {
      const nextHash = window.location.hash;
      if (
        attributeEditorDirtyRef.current &&
        nextHash !== acceptedHashRef.current &&
        !window.confirm('当前修改尚未保存，确定要离开吗？')
      ) {
        replaceLocationHash(acceptedHashRef.current);
        return;
      }

      if (attributeEditorDirtyRef.current && nextHash !== acceptedHashRef.current) {
        handleAttributeDirtyChange(false);
      }
      applyRouteFromLocation();
    };

    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => {
      window.removeEventListener('hashchange', syncFromHash);
    };
  }, [handleAttributeDirtyChange]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!attributeEditorDirtyRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
    };
  }, []);

  // Narrow-screen media query: close mobile navigation when returning to desktop.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia(MOBILE_NAV_MEDIA_QUERY);
    const syncMobileBreakpoint = () => {
      if (!mediaQuery.matches) {
        setMobileNavOpen(false);
      }
    };

    syncMobileBreakpoint();
    mediaQuery.addEventListener('change', syncMobileBreakpoint);
    return () => {
      mediaQuery.removeEventListener('change', syncMobileBreakpoint);
    };
  }, []);

  // Route selection (including replaceState paths that skip hashchange) closes mobile nav.
  useEffect(() => {
    setMobileNavOpen(false);
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

  const applyApiBase = () => {
    const nextValue = resolveApiBaseUrl(apiBaseDraft);
    setApiBaseDraft(nextValue);
    setApiBaseUrl(nextValue);
  };

  const handleNavigationClick = (
    event: MouseEvent<HTMLAnchorElement>,
    targetHash: string
  ) => {
    setMobileNavOpen(false);
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      !attributeEditorDirty ||
      window.location.hash === targetHash
    ) {
      return;
    }

    event.preventDefault();
    if (!window.confirm('当前修改尚未保存，确定要离开吗？')) {
      return;
    }
    handleAttributeDirtyChange(false);
    window.location.hash = targetHash;
  };

  let pageContent = (
    <AttributeManagementPage
      apiBaseUrl={apiBaseUrl}
      selectedGameId={selectedGameId}
      adminToken={adminToken}
      onDirtyChange={handleAttributeDirtyChange}
    />
  );

  if (route === 'characters') {
    pageContent = (
      <CharacterManagementPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onDirtyChange={handleAttributeDirtyChange}
      />
    );
  } else if (route === 'equipment') {
    pageContent = (
      <EquipmentManagementPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onDirtyChange={handleAttributeDirtyChange}
      />
    );
  } else if (route === 'skill-categories') {
    pageContent = (
      <SkillCategoryManagementPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onDirtyChange={handleAttributeDirtyChange}
      />
    );
  } else if (route === 'damage-types') {
    pageContent = (
      <DamageTypeManagementPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onDirtyChange={handleAttributeDirtyChange}
      />
    );
  } else if (route === 'skills') {
    pageContent = (
      <SkillManagementPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onDirtyChange={handleAttributeDirtyChange}
      />
    );
  } else if (route === 'statuses') {
    pageContent = (
      <StatusManagementPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onDirtyChange={handleAttributeDirtyChange}
      />
    );
  } else if (route === 'game-settings') {
    pageContent = (
      <GameSettingsPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
      />
    );
  } else if (route === 'images') {
    pageContent = (
      <ImagesPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        selectedGameName={selectedGameName}
        adminToken={adminToken}
      />
    );
  }

  return (
    <Layout className="app-shell">
      <Sider
        className={`app-sidebar${mobileNavOpen ? ' is-mobile-nav-open' : ''}`}
        width={330}
      >
        <div className="app-sidebar-head">
          <div className="brand-lockup">
            <Tag color="arcoblue" size="small">
              Damage Viewer
            </Tag>
            <Typography.Title heading={3} className="brand-title">
              Web 控制台
            </Typography.Title>
            <Typography.Text className="brand-copy">
              属性、角色、装备、技能与图片管理。
            </Typography.Text>
          </div>
          <button
            type="button"
            className="mobile-nav-toggle"
            aria-label="主导航"
            aria-expanded={mobileNavOpen}
            aria-controls={MOBILE_PRIMARY_NAVIGATION_ID}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <IconMenu aria-hidden="true" />
          </button>
        </div>

        <div
          id={MOBILE_PRIMARY_NAVIGATION_ID}
          className="mobile-primary-navigation"
          role="region"
          aria-label="主导航"
        >
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
                            onClick={(event) =>
                              handleNavigationClick(event, `#/${item.hashSegment}`)
                            }
                          >
                            <span className="nav-item-label">{item.label}</span>
                            {item.summary ? <span className="nav-item-summary">{item.summary}</span> : null}
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
        </div>
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
