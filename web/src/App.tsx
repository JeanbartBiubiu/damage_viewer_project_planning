import { useEffect, useState } from 'react';
import { Alert, Button, Input, Layout, Select, Tag, Typography } from '@arco-design/web-react';
import { IconDown, IconMenu } from '@arco-design/web-react/icon';
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
  readCombatDataLocation,
  type FilterFieldPair
} from './pages/admin/combatDataNav';
import { planInvalidCombatDataFilterSync, splitCombatDataHash } from './pages/admin/combat-data/resourceRelations';
import { AbilitySetupPage } from './pages/admin/ability-setup/AbilitySetupPage';
import { DirectDamageAbilityPage } from './pages/admin/direct-damage-ability/DirectDamageAbilityPage';
import { EffectSequenceSetupPage } from './pages/admin/effect-sequence-setup/EffectSequenceSetupPage';
import { EffectStepSetupPage } from './pages/admin/effect-step-setup/EffectStepSetupPage';
import { EntityGrowthPage } from './pages/admin/entity-growth/EntityGrowthPage';
import { EntityProviderMountPage } from './pages/admin/entity-provider-mount/EntityProviderMountPage';
import { EntitySetupPage } from './pages/admin/entity-setup/EntitySetupPage';
import { ProviderSetupPage } from './pages/admin/provider-setup/ProviderSetupPage';
import { ImagesPage } from './pages/ImagesPage';
import { OverviewPage } from './pages/OverviewPage';
import { VersionPublishPage } from './pages/VersionPublishPage';
import { WasmValidationGenericPage } from './pages/WasmValidationGenericPage';
import { getErrorMessage, listGames, resolveApiBaseUrl } from './services/apiClient';
import type { GameSummary, LoadState } from './types/api';

const API_BASE_STORAGE_KEY = 'damage-viewer.web.api-base-url';
const ADMIN_TOKEN_STORAGE_KEY = 'damage-viewer.web.admin-token';
const PREFERRED_DEFAULT_GAME_ID = 'lol';
const MOBILE_NAV_MEDIA_QUERY = '(max-width: 1240px)';
const MOBILE_PRIMARY_NAVIGATION_ID = 'mobile-primary-navigation';

const STATIC_ROUTE_IDS = new Set<string>([
  'overview',
  'workspace',
  'wasm-validation-generic',
  'images',
  'entity-setup',
  'provider-setup',
  'entity-provider-mount',
  'entity-growth',
  'ability-setup',
  'effect-sequence-setup',
  'effect-step-setup',
  'direct-damage-ability'
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

function readRouteFromHash(): RouteId {
  if (typeof window === 'undefined') {
    return 'overview';
  }

  const combat = readCombatDataLocation(window.location.hash);
  if (combat.isCombatDataRoute) {
    if (combat.resourceId) {
      return combatDataHashSegment(combat.resourceId) as RouteId;
    }
    return 'combat-data';
  }

  const { segments } = splitCombatDataHash(window.location.hash);
  const [routeSegment] = segments;

  if (routeSegment === 'versions' || routeSegment === 'version-publish') {
    return 'workspace';
  }

  if (routeSegment && STATIC_ROUTE_IDS.has(routeSegment)) {
    return routeSegment as StaticRouteId;
  }

  return 'overview';
}

function readFilterPairsFromHash(): FilterFieldPair[] {
  if (typeof window === 'undefined') {
    return [];
  }
  const location = readCombatDataLocation(window.location.hash);
  if (!location.isCombatDataRoute || !location.resourceId) {
    return [];
  }
  if (!location.filterOk) {
    return [];
  }
  return location.filterPairs;
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
  const [filterPairs, setFilterPairs] = useState<FilterFieldPair[]>(() => readFilterPairsFromHash());
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const syncFromHash = () => {
      const location = readCombatDataLocation(window.location.hash);
      if (location.isCombatDataRoute && location.resourceId && !location.filterOk) {
        const plan = planInvalidCombatDataFilterSync(window.location.hash, location.resourceId);
        if (plan.replace) {
          const { pathname, search } = window.location;
          window.history.replaceState(null, '', `${pathname}${search}${plan.nextHash}`);
        }
        // Update React route/filter state immediately (replaceState does not fire hashchange).
        setRoute(combatDataHashSegment(location.resourceId) as RouteId);
        setFilterPairs(plan.filterPairs);
        setMobileNavOpen(false);
        return;
      }
      setRoute(readRouteFromHash());
      setFilterPairs(readFilterPairsFromHash());
      setMobileNavOpen(false);
    };

    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => {
      window.removeEventListener('hashchange', syncFromHash);
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

  // Deep-link / in-app route changes: expand the owning combat-data group; keep others as-is.
  useEffect(() => {
    setCollapsedNavigationGroups((current) =>
      ensureActiveCombatDataNavigationGroupExpanded(current, route)
    );
  }, [route]);

  // Route selection (including replaceState paths that skip hashchange) closes mobile nav.
  useEffect(() => {
    setMobileNavOpen(false);
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
  } else if (route === 'entity-setup') {
    pageContent = (
      <EntitySetupPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        gamesReachable={gamesReachable}
      />
    );
  } else if (route === 'provider-setup') {
    pageContent = (
      <ProviderSetupPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        gamesReachable={gamesReachable}
      />
    );
  } else if (route === 'entity-provider-mount') {
    pageContent = (
      <EntityProviderMountPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        gamesReachable={gamesReachable}
      />
    );
  } else if (route === 'entity-growth') {
    pageContent = (
      <EntityGrowthPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        gamesReachable={gamesReachable}
      />
    );
  } else if (route === 'ability-setup') {
    pageContent = (
      <AbilitySetupPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        gamesReachable={gamesReachable}
      />
    );
  } else if (route === 'effect-sequence-setup') {
    pageContent = (
      <EffectSequenceSetupPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        gamesReachable={gamesReachable}
      />
    );
  } else if (route === 'effect-step-setup') {
    pageContent = (
      <EffectStepSetupPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        gamesReachable={gamesReachable}
      />
    );
  } else if (route === 'direct-damage-ability') {
    pageContent = (
      <DirectDamageAbilityPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        gamesReachable={gamesReachable}
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
    pageContent = (
      <ImagesPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        selectedGameName={selectedGameName}
        adminToken={adminToken}
      />
    );
  } else if (isCombatDataRouteId(route) && combatDataResourceId) {
    pageContent = (
      <CombatDataPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        resourceId={combatDataResourceId}
        gamesReachable={gamesReachable}
        filterPairs={filterPairs}
      />
    );
  } else if (route === 'combat-data') {
    pageContent = (
      <Alert type="info" content={`正在进入 ${DEFAULT_COMBAT_DATA_RESOURCE_ID}…`} className="workspace-alert" />
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
              combat-data 分表编辑、版本发布、图片同步与 Wasm 验证。
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
                            onClick={() => setMobileNavOpen(false)}
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
