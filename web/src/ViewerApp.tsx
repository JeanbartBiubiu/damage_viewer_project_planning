import { lazy, useCallback, useEffect, useState } from 'react';
import { Alert, Button, Layout, Select, Space, Typography } from '@arco-design/web-react';
import { PageContent, SkipToContent } from './components/PageContent';
import { AccountControls } from './pages/auth/AccountControls';
import { getErrorMessage, listGames, resolveApiBaseUrl } from './services/apiClient';
import { viewerRouteFromHash } from './config/viewerRoutes';
import type { GameSummary } from './types/api';

const CombatAnalysisPage = lazy(() => import('./pages/simulation/CombatAnalysisPage').then(module => ({ default: module.CombatAnalysisPage })));
const BasicAttackSimulationPage = lazy(() => import('./pages/simulation/BasicAttackSimulationPage').then(module => ({ default: module.BasicAttackSimulationPage })));

export default function ViewerApp() {
  const apiBaseUrl = resolveApiBaseUrl();
  const [route, setRoute] = useState(() => viewerRouteFromHash(window.location.hash));
  const [games, setGames] = useState<GameSummary[]>([]);
  const [gameId, setGameId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const onBusy = useCallback((value: boolean) => setBusy(value), []);

  useEffect(() => {
    document.title = `${route === 'simulation/basic-attack' ? '普攻模拟' : '混合战斗分析'} | Damage Viewer`;
  }, [route]);

  useEffect(() => {
    let current = true;
    setError(null);
    void listGames(apiBaseUrl).then(result => {
      if (!current) return;
      setGames(result.data);
      setGameId(existing => result.data.some(game => game.gameId === existing) ? existing
        : result.data.find(game => game.gameId === 'lol')?.gameId ?? result.data[0]?.gameId ?? null);
    }).catch(cause => { if (current) setError(getErrorMessage(cause)); });
    return () => { current = false; };
  }, [apiBaseUrl, reload]);

  useEffect(() => {
    const changed = () => {
      const next = viewerRouteFromHash(window.location.hash);
      if (busy && next !== route) { window.history.replaceState(null, '', `#/${route}`); return; }
      setRoute(next);
      if (window.location.hash !== `#/${next}`) window.history.replaceState(null, '', `#/${next}`);
    };
    changed();
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [busy, route]);

  useEffect(() => {
    if (!busy) return;
    const leaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', leaving);
    return () => window.removeEventListener('beforeunload', leaving);
  }, [busy]);

  return <Layout className="app-shell">
    <SkipToContent />
    <Layout className="app-content">
      <Layout.Content className="app-main">
        <div className="app-toolbar">
          <Space wrap>
            <Typography.Title heading={4} style={{ margin: 0 }}>Damage Viewer</Typography.Title>
            <Select aria-label="游戏" value={gameId ?? undefined} disabled={busy || !games.length} style={{ minWidth: 180 }}
              onChange={setGameId} options={games.map(game => ({ label: game.gameName, value: game.gameId }))} />
            <nav className="viewer-navigation" aria-label="计算">
              <Button className="viewer-route" disabled={busy} href="#/simulation/combat-analysis" aria-current={route === 'simulation/combat-analysis' ? 'page' : undefined} type={route === 'simulation/combat-analysis' ? 'primary' : 'secondary'}>混合战斗分析</Button>
              <Button className="viewer-route" disabled={busy} href="#/simulation/basic-attack" aria-current={route === 'simulation/basic-attack' ? 'page' : undefined} type={route === 'simulation/basic-attack' ? 'primary' : 'secondary'}>普攻模拟</Button>
            </nav>
            <Button disabled={busy} onClick={() => setReload(value => value + 1)}>刷新游戏目录</Button>
          </Space>
          <AccountControls apiBaseUrl={apiBaseUrl} />
        </div>
        <Typography.Paragraph type="secondary">选择本场条件进行计算。公共游戏资料由维护流程统一更新；发现问题可下载复现材料并反馈。</Typography.Paragraph>
        {error ? <Alert type="error" content={error} /> : null}
        <PageContent key={route}>
          {route === 'simulation/basic-attack'
            ? <BasicAttackSimulationPage apiBaseUrl={apiBaseUrl} selectedGameId={gameId} onDirtyChange={onBusy} />
            : <CombatAnalysisPage apiBaseUrl={apiBaseUrl} selectedGameId={gameId} onDirtyChange={onBusy} />}
        </PageContent>
      </Layout.Content>
    </Layout>
  </Layout>;
}
