import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Layout, Select, Space, Tag, Typography } from '@arco-design/web-react';
import { IconDown } from '@arco-design/web-react/icon';
import {
  adminResourceRouteMap,
  navigationGroups,
  navigationItems,
  type NavigationGroupId,
  type RouteId
} from './config/navigation';
import { AttributeDefinitionsPage } from './pages/admin/resources/attribute-definitions';
import { CoefficientBucketsPage } from './pages/admin/resources/coefficient-buckets';
import { FormulaBindingsPage } from './pages/admin/resources/formula-bindings';
import { FormulaProfilesPage } from './pages/admin/resources/formula-profiles';
import { HeroesPage } from './pages/admin/resources/heroes';
import { ItemsPage } from './pages/admin/resources/items';
import { SkillsPage } from './pages/admin/resources/skills';
import { StatusActionControlRulesPage } from './pages/admin/resources/status-action-control-rules';
import { StatusManagementPage } from './pages/admin/resources/status-management';
import { TypeRelationsPage } from './pages/admin/resources/type-relations';
import { TypesPage } from './pages/admin/resources/types';
import { ImagesPage } from './pages/ImagesPage';
import { OverviewPage } from './pages/OverviewPage';
import { VersionPublishPage } from './pages/VersionPublishPage';
import { WasmValidationM2Page } from './pages/WasmValidationM2Page';
import { WasmValidationM3Page } from './pages/WasmValidationM3Page';
import { WasmValidationM4ClosurePage } from './pages/WasmValidationM4ClosurePage';
import { WasmValidationV2DpsMultiHeroPage, WasmValidationV2DpsPage } from './pages/WasmValidationV2DpsPage';
import { WasmValidationPage } from './pages/WasmValidationPage';
import { getErrorMessage, listGames, resolveApiBaseUrl } from './services/apiClient';
import type { GameSummary, LoadState } from './types/api';

const API_BASE_STORAGE_KEY = 'damage-viewer.web.api-base-url';
const ADMIN_TOKEN_STORAGE_KEY = 'damage-viewer.web.admin-token';

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

  const [routeSegment, resourceSegment] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (routeSegment === 'admin') {
    if (resourceSegment && resourceSegment in adminResourceRouteMap) {
      return resourceSegment as RouteId;
    }
    return 'formula-profiles';
  }

  if (routeSegment === 'versions' || routeSegment === 'version-publish') {
    return 'workspace';
  }

  const match = navigationItems.find((item) => item.id === routeSegment);
  return match?.id ?? 'overview';
}

function getGamesStatusLabel(status: LoadState): string {
  if (status === 'loading') {
    return 'Connecting';
  }
  if (status === 'success') {
    return 'Ready';
  }
  if (status === 'error') {
    return 'Error';
  }
  return 'Idle';
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
  const [bundleRefreshSeed, setBundleRefreshSeed] = useState(0);
  const [collapsedNavigationGroups, setCollapsedNavigationGroups] = useState<Partial<Record<NavigationGroupId, boolean>>>({});

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
  const selectedGameName = selectedGame?.gameName ?? 'No game selected';
  const activeRoute = navigationItems.find((item) => item.id === route) ?? navigationItems[0];
  const isOverviewRoute = route === 'overview';

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
      pageContent = (
        <VersionPublishPage
          apiBaseUrl={apiBaseUrl}
          selectedGameId={selectedGameId}
          selectedGameName={selectedGameName}
          adminToken={adminToken}
          onAdminTokenChange={setAdminToken}
          onDataPublished={() => setBundleRefreshSeed((value) => value + 1)}
        />
      );
      break;
    case 'wasm-validation':
      pageContent = (
        <WasmValidationPage
          apiBaseUrl={apiBaseUrl}
          selectedGameId={selectedGameId}
          selectedGameName={selectedGameName}
          externalRefreshSeed={bundleRefreshSeed}
        />
      );
      break;
    case 'wasm-validation-m2':
      pageContent = (
        <WasmValidationM2Page
          apiBaseUrl={apiBaseUrl}
          selectedGameId={selectedGameId}
          selectedGameName={selectedGameName}
          externalRefreshSeed={bundleRefreshSeed}
        />
      );
      break;
    case 'wasm-validation-m3':
      pageContent = (
        <WasmValidationM3Page
          apiBaseUrl={apiBaseUrl}
          selectedGameId={selectedGameId}
          selectedGameName={selectedGameName}
          externalRefreshSeed={bundleRefreshSeed}
        />
      );
      break;
    case 'wasm-validation-m4-closure':
      pageContent = (
        <WasmValidationM4ClosurePage
          apiBaseUrl={apiBaseUrl}
          selectedGameId={selectedGameId}
          selectedGameName={selectedGameName}
          externalRefreshSeed={bundleRefreshSeed}
        />
      );
      break;
    case 'wasm-validation-v2-dps':
      pageContent = (
        <WasmValidationV2DpsPage
          apiBaseUrl={apiBaseUrl}
          selectedGameId={selectedGameId}
          selectedGameName={selectedGameName}
          externalRefreshSeed={bundleRefreshSeed}
        />
      );
      break;
    case 'wasm-validation-v2-dps-multi-hero':
      pageContent = (
        <WasmValidationV2DpsMultiHeroPage
          apiBaseUrl={apiBaseUrl}
          selectedGameId={selectedGameId}
          selectedGameName={selectedGameName}
          externalRefreshSeed={bundleRefreshSeed}
        />
      );
      break;
    case 'images':
      pageContent = <ImagesPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} selectedGameName={selectedGameName} />;
      break;
    case 'heroes':
      pageContent = <HeroesPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} />;
      break;
    case 'skills':
      pageContent = <SkillsPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} />;
      break;
    case 'items':
      pageContent = <ItemsPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} />;
      break;
    case 'attribute-definitions':
      pageContent = <AttributeDefinitionsPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} />;
      break;
    case 'status-management':
      pageContent = <StatusManagementPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} />;
      break;
    case 'types':
      pageContent = <TypesPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} />;
      break;
    case 'type-relations':
      pageContent = <TypeRelationsPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} />;
      break;
    case 'formula-profiles':
      pageContent = <FormulaProfilesPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} />;
      break;
    case 'formula-bindings':
      pageContent = <FormulaBindingsPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} />;
      break;
    case 'coefficient-buckets':
      pageContent = <CoefficientBucketsPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} />;
      break;
    case 'status-action-control-rules':
      pageContent = (
        <StatusActionControlRulesPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} />
      );
      break;
    default:
      break;
  }

  return (
    <Layout className="app-shell">
      <Sider className="app-sidebar" width={330}>
        <div className="brand-lockup">
          <Tag color="arcoblue" size="small">
            Damage Viewer
          </Tag>
          <Typography.Title heading={3} className="brand-title">
            Web Console
          </Typography.Title>
          <Typography.Text className="brand-copy">
            A focused web surface for resource editing, publishing, image sync, and Wasm validation.
          </Typography.Text>
        </div>

        <nav className="nav-stack" aria-label="Primary">
          {navigationGroups.map((group) => {
            const isGroupActive = group.items.some((item) => item.id === route);
            const isGroupExpanded = !collapsedNavigationGroups[group.id];
            const navSubstackId = `nav-section-${group.id}`;

            return (
              <section key={group.id} className={`nav-section${isGroupActive ? ' is-active' : ''}`} aria-label={group.label}>
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
                    {group.items.map((item) => (
                      <a
                        key={item.id}
                        className={`nav-item nav-item-secondary${item.id === route ? ' is-active' : ''}`}
                        href={`#/${item.id}`}
                        aria-current={item.id === route ? 'page' : undefined}
                      >
                        <span className="nav-item-label">{item.label}</span>
                        <span className="nav-item-summary">{item.summary}</span>
                      </a>
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </nav>

        <section className="sidebar-status">
          <div className="sidebar-status-head">
            <Typography.Text className="sidebar-status-kicker">Session</Typography.Text>
            <Tag color={getGamesStatusColor(gamesStatus)}>{getGamesStatusLabel(gamesStatus)}</Tag>
          </div>
          <Typography.Title heading={5} className="sidebar-status-title">
            {selectedGameName}
          </Typography.Title>
          <Typography.Text className="sidebar-status-line">API {apiBaseUrl}</Typography.Text>
          <Typography.Text className="sidebar-status-line">GameId {selectedGame?.gameId ?? 'None'}</Typography.Text>
          <Typography.Text className="sidebar-status-line">JWT {adminToken.trim() ? 'Stored locally' : 'Not configured'}</Typography.Text>
          <Typography.Text className="sidebar-status-line">ETag {gamesEtag ?? 'N/A'}</Typography.Text>
        </section>
      </Sider>

      <Layout className="app-content">
        <Content className="app-main">
          {isOverviewRoute ? (
            <>
              <section className="workspace-hero">
                <div className="workspace-hero-copy">
                  <Space align="center" size={10} wrap>
                    <Tag color="arcoblue">{activeRoute.label}</Tag>
                    <Typography.Text className="workspace-rail">Current module / {activeRoute.label}</Typography.Text>
                  </Space>
                  <Typography.Title heading={2} className="workspace-title">
                    Damage Viewer Frontend
                  </Typography.Title>
                  <Typography.Text className="workspace-summary">{activeRoute.summary}</Typography.Text>
                </div>

                <div className="workspace-hero-stats" aria-label="Workspace summary">
                  <div className="workspace-stat">
                    <span className="workspace-stat-label">Games</span>
                    <strong className="workspace-stat-value">{games.length}</strong>
                    <span className="workspace-stat-hint">Available game list</span>
                  </div>
                  <div className="workspace-stat">
                    <span className="workspace-stat-label">Selected</span>
                    <strong className="workspace-stat-value">{selectedGame?.gameId ?? 'none'}</strong>
                    <span className="workspace-stat-hint">Current page context</span>
                  </div>
                  <div className="workspace-stat">
                    <span className="workspace-stat-label">Status</span>
                    <strong className="workspace-stat-value">{getGamesStatusLabel(gamesStatus)}</strong>
                    <span className="workspace-stat-hint">API / games</span>
                  </div>
                </div>
              </section>

              <section className="workspace-controls">
                <Form layout="vertical" className="toolbar-form">
                  <div className="toolbar-grid">
                    <Form.Item label="API Base URL" className="toolbar-field">
                      <Input value={apiBaseDraft} onChange={setApiBaseDraft} placeholder="http://localhost:8080" />
                    </Form.Item>
                    <Form.Item label="Current gameId" className="toolbar-field">
                      <Select
                        value={selectedGameId ?? ''}
                        onChange={(value) => setSelectedGameId(value || null)}
                        disabled={games.length === 0}
                        placeholder="Select a game"
                      >
                        <Select.Option value="">None</Select.Option>
                        {games.map((game) => (
                          <Select.Option key={game.gameId} value={game.gameId}>
                            {game.gameId} / {game.gameName}
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                    <Form.Item label="Admin Token" className="toolbar-field">
                      <Input.Password
                        value={adminToken}
                        onChange={setAdminToken}
                        placeholder="Paste admin JWT here"
                        autoComplete="off"
                      />
                    </Form.Item>
                  </div>

                  <Space className="toolbar-actions" wrap>
                    <Button
                      type="primary"
                      onClick={() => {
                        const nextValue = resolveApiBaseUrl(apiBaseDraft);
                        setApiBaseDraft(nextValue);
                        setApiBaseUrl(nextValue);
                      }}
                    >
                      Apply API base
                    </Button>
                    <Button onClick={() => setReloadSeed((value) => value + 1)}>Reload games</Button>
                  </Space>
                </Form>
              </section>
            </>
          ) : null}

          {gamesError ? <Alert type="error" content={gamesError} className="workspace-alert" /> : null}

          <div className="page-stack">{pageContent}</div>
        </Content>
      </Layout>
    </Layout>
  );
}
