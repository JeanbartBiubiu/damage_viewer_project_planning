import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Alert, Button, Input, Layout, Select, Tag, Typography } from '@arco-design/web-react';
import { IconDown, IconMenu } from '@arco-design/web-react/icon';
import {
  createDefaultCollapsedNavigationGroups,
  defaultRouteForMode,
  hashForRoute,
  modeForRoute,
  navigationGroupsForMode,
  routeFromHash,
  type RouteId,
  type WorkspaceMode
} from './config/navigation';
import { AttributeManagementPage } from './pages/admin/attributes/AttributeManagementPage';
import { CharacterManagementPage } from './pages/admin/characters/CharacterManagementPage';
import { DamageTypeManagementPage } from './pages/admin/damage-types/DamageTypeManagementPage';
import { EquipmentManagementPage } from './pages/admin/equipment/EquipmentManagementPage';
import { GameSettingsPage } from './pages/admin/game-settings/GameSettingsPage';
import { ModifierZoneManagementPage } from './pages/admin/modifier-zones/ModifierZoneManagementPage';
import { SkillCategoryManagementPage } from './pages/admin/skill-categories/SkillCategoryManagementPage';
import { SkillManagementPage } from './pages/admin/skills/SkillManagementPage';
import { StatusManagementPage } from './pages/admin/statuses/StatusManagementPage';
import { ImageManagementPage } from './pages/admin/images/ImageManagementPage';
import { BuildManagementPage } from './pages/admin/builds/BuildManagementPage';
import { BasicAttackSimulationPage } from './pages/simulation/BasicAttackSimulationPage';
import { CombatAnalysisPage } from './pages/simulation/CombatAnalysisPage';
import { getErrorMessage, listGames, resolveApiBaseUrl } from './services/apiClient';
import type { GameSummary, LoadState } from './types/api';

const API_BASE_STORAGE_KEY = 'damage-viewer.web.api-base-url';
const ADMIN_TOKEN_STORAGE_KEY = 'damage-viewer.web.admin-token';
const PREFERRED_DEFAULT_GAME_ID = 'lol';
const MOBILE_NAV_MEDIA_QUERY = '(max-width: 1240px)';
const MOBILE_PRIMARY_NAVIGATION_ID = 'mobile-primary-navigation';
const HASH_HISTORY_INDEX_KEY = 'damage-viewer.route-index';

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
    return routeFromHash('');
  }
  return routeFromHash(window.location.hash);
}

function readHashHistoryIndex(): number | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const index = window.history.state?.[HASH_HISTORY_INDEX_KEY];
  return typeof index === 'number' && Number.isSafeInteger(index) ? index : null;
}

function replaceLocationHash(hash: string, historyIndex: number): void {
  if (typeof window === 'undefined') {
    return;
  }
  const { pathname, search } = window.location;
  window.history.replaceState(
    { ...window.history.state, [HASH_HISTORY_INDEX_KEY]: historyIndex },
    '',
    `${pathname}${search}${hash}`
  );
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
  // 先默认一个就行了
  const [adminToken, setAdminToken] = useState(() => readStoredValue(ADMIN_TOKEN_STORAGE_KEY, 'test').trim());
  const [games, setGames] = useState<GameSummary[]>([]);
  const [gamesStatus, setGamesStatus] = useState<LoadState>('loading');
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [gamesEtag, setGamesEtag] = useState<string | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [reloadSeed, setReloadSeed] = useState(0);
  const [pageReloadSeed, setPageReloadSeed] = useState(0);
  const [collapsedNavigationGroups, setCollapsedNavigationGroups] = useState(() =>
    createDefaultCollapsedNavigationGroups()
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const attributeEditorDirtyRef = useRef(false);
  const simulationBusyRef = useRef(false);
  const selectedGameIdRef = useRef(selectedGameId);
  selectedGameIdRef.current = selectedGameId;
  const acceptedHashRef = useRef(hashForRoute(readRouteFromHash()));
  const acceptedHistoryIndexRef = useRef(readHashHistoryIndex() ?? 0);
  const restoringAcceptedHashRef = useRef(false);
  const mode = modeForRoute(route);

  const handleAttributeDirtyChange = useCallback((dirty: boolean) => {
    attributeEditorDirtyRef.current = dirty;
    simulationBusyRef.current = false;
  }, []);

  const handleSimulationDirtyChange = useCallback((busy: boolean) => {
    attributeEditorDirtyRef.current = busy;
    simulationBusyRef.current = busy;
  }, []);

  const confirmLeavingPage = useCallback((managementMessage: string) => window.confirm(
    simulationBusyRef.current
      ? '当前计算尚未完成，离开将终止本次计算，确定要离开吗？'
      : managementMessage
  ), []);

  useEffect(() => {
    const applyRouteFromLocation = (historyIndex: number) => {
      const nextRoute = readRouteFromHash();
      const canonicalHash = hashForRoute(nextRoute);
      replaceLocationHash(canonicalHash, historyIndex);
      acceptedHashRef.current = canonicalHash;
      acceptedHistoryIndexRef.current = historyIndex;
      setRoute(nextRoute);
      setMobileNavOpen(false);
    };

    const syncFromHash = () => {
      const nextHash = window.location.hash;
      if (restoringAcceptedHashRef.current) {
        restoringAcceptedHashRef.current = false;
        if (nextHash === acceptedHashRef.current) {
          return;
        }
      }
      const historyIndex = readHashHistoryIndex() ?? acceptedHistoryIndexRef.current + 1;
      if (
        attributeEditorDirtyRef.current &&
        nextHash !== acceptedHashRef.current &&
        !confirmLeavingPage('当前修改尚未保存，确定要离开吗？')
      ) {
        // 回到原历史项，保留这次被取消的目标，供之后前进或后退使用。
        replaceLocationHash(nextHash, historyIndex);
        const distance = acceptedHistoryIndexRef.current - historyIndex;
        if (distance !== 0) {
          restoringAcceptedHashRef.current = true;
          window.history.go(distance);
        } else {
          replaceLocationHash(acceptedHashRef.current, acceptedHistoryIndexRef.current);
        }
        return;
      }

      if (attributeEditorDirtyRef.current && nextHash !== acceptedHashRef.current) {
        handleAttributeDirtyChange(false);
      }
      applyRouteFromLocation(historyIndex);
    };

    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => {
      window.removeEventListener('hashchange', syncFromHash);
    };
  }, [confirmLeavingPage, handleAttributeDirtyChange]);

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

        const nextGameId = resolveSelectedGameId(selectedGameIdRef.current, result.data);
        if (nextGameId !== selectedGameIdRef.current && attributeEditorDirtyRef.current) {
          setGamesStatus('error');
          setGamesError('当前游戏已不在最新游戏列表中，请先保存或放弃页面修改后再刷新。');
          return;
        }
        setGames(result.data);
        setGamesEtag(result.etag);
        setGamesStatus('success');
        setSelectedGameId(nextGameId);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setGamesStatus('error');
        setGamesError(getErrorMessage(error));
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
    if (nextValue !== apiBaseUrl && attributeEditorDirtyRef.current
      && !confirmLeavingPage('当前修改尚未保存，确定放弃修改并切换连接吗？')) return;
    setApiBaseDraft(nextValue);
    if (nextValue === apiBaseUrl) return;
    handleAttributeDirtyChange(false);
    setGames([]);
    setGamesEtag(null);
    setSelectedGameId(null);
    setApiBaseUrl(nextValue);
  };

  const changeGame = (value: string) => {
    const nextGameId = value || null;
    if (nextGameId === selectedGameId) return;
    if (attributeEditorDirtyRef.current
      && !confirmLeavingPage('当前修改尚未保存，确定放弃修改并切换游戏吗？')) return;
    handleAttributeDirtyChange(false);
    setSelectedGameId(nextGameId);
  };

  const changeAdminToken = (value: string) => {
    const nextToken = value.trim();
    if (nextToken === adminToken) return;
    if (attributeEditorDirtyRef.current
      && !confirmLeavingPage('当前修改尚未保存，确定放弃修改并更换 Admin Token 吗？')) return;
    handleAttributeDirtyChange(false);
    setAdminToken(nextToken);
  };

  const refreshGames = () => {
    if (attributeEditorDirtyRef.current) {
      if (!confirmLeavingPage('当前修改尚未保存，确定放弃修改并刷新吗？')) return;
      handleAttributeDirtyChange(false);
      setPageReloadSeed((value) => value + 1);
    }
    setReloadSeed((value) => value + 1);
  };

  const navigateToHash = (targetHash: string) => {
    if (window.location.hash === targetHash) {
      setMobileNavOpen(false);
      return;
    }
    if (attributeEditorDirtyRef.current && !confirmLeavingPage('当前修改尚未保存，确定要离开吗？')) {
      return;
    }
    if (attributeEditorDirtyRef.current) {
      handleAttributeDirtyChange(false);
    }
    window.location.hash = targetHash;
    setMobileNavOpen(false);
  };

  const handleNavigationClick = (event: MouseEvent<HTMLAnchorElement>, targetHash: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigateToHash(targetHash);
  };

  const changeMode = (nextMode: WorkspaceMode) => {
    if (nextMode === mode) {
      return;
    }
    navigateToHash(hashForRoute(defaultRouteForMode(nextMode)));
  };

  let pageContent = (
    <AttributeManagementPage
      apiBaseUrl={apiBaseUrl}
      selectedGameId={selectedGameId}
      adminToken={adminToken}
      onDirtyChange={handleAttributeDirtyChange}
    />
  );

  if (route === 'simulation/basic-attack') {
    pageContent = (
      <BasicAttackSimulationPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onDirtyChange={handleSimulationDirtyChange}
      />
    );
  } else if (route === 'simulation/combat-analysis') {
    pageContent = (
      <CombatAnalysisPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onDirtyChange={handleSimulationDirtyChange}
      />
    );
  } else if (route === 'characters') {
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
  } else if (route === 'builds') {
    pageContent = <BuildManagementPage apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} onDirtyChange={handleAttributeDirtyChange} />;
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
  } else if (route === 'modifier-zones') {
    pageContent = (
      <ModifierZoneManagementPage
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
        selectedGameName={selectedGameName}
        onDirtyChange={handleAttributeDirtyChange}
        onGameImageSaved={() => setReloadSeed((value) => value + 1)}
      />
    );
  } else if (route === 'images') {
    pageContent = (
      <ImageManagementPage
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        selectedGameName={selectedGameName}
        adminToken={adminToken}
        onDirtyChange={handleAttributeDirtyChange}
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
              {mode === 'management' ? '属性、角色、装备、技能与图片管理。' : '游戏数据计算与模拟。'}
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

        <div className="workspace-mode-switch" role="group" aria-label="工作模式">
          <button
            type="button"
            className={`workspace-mode-option${mode === 'management' ? ' is-active' : ''}`}
            aria-label="切换到数据管理"
            aria-pressed={mode === 'management'}
            onClick={() => changeMode('management')}
          >
            数据管理
          </button>
          <button
            type="button"
            className={`workspace-mode-option${mode === 'simulation' ? ' is-active' : ''}`}
            aria-label="切换到计算模拟"
            aria-pressed={mode === 'simulation'}
            onClick={() => changeMode('simulation')}
          >
            计算模拟
          </button>
        </div>

        <div
          id={MOBILE_PRIMARY_NAVIGATION_ID}
          className="mobile-primary-navigation"
          role="region"
          aria-label="主导航"
        >
          <nav className="nav-stack" aria-label="Primary">
            {navigationGroupsForMode(mode).map((group) => {
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
                              handleNavigationClick(event, hashForRoute(item.id))
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
                onChange={changeGame}
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
                onChange={changeAdminToken}
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
              <Button size="small" onClick={refreshGames}>
                刷新
              </Button>
            </div>
          </div>

          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            当前 API 基址：{apiBaseUrl}
          </Typography.Text>

          {gamesError ? <Alert type="error" content={gamesError} className="workspace-alert" /> : null}

          <div className="page-stack" key={JSON.stringify([apiBaseUrl, selectedGameId, adminToken.trim(), pageReloadSeed])}>
            {pageContent}
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
