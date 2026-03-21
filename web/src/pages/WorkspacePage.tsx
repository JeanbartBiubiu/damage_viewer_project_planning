import { useEffect, useState } from 'react';
import { DataTable } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import { getBundle, getCurrentVersion, getErrorMessage } from '../services/apiClient';
import type { CurrentVersion, GameDataBundle, LoadState } from '../types/api';

type WorkspacePageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
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

function formatPreview(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : value.join(', ');
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

export function WorkspacePage({ apiBaseUrl, selectedGameId, selectedGameName }: WorkspacePageProps) {
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [currentVersion, setCurrentVersion] = useState<CurrentVersion | null>(null);
  const [bundle, setBundle] = useState<GameDataBundle | null>(null);
  const [bundleEtag, setBundleEtag] = useState<string | null>(null);
  const [bundleState, setBundleState] = useState<LoadState>('idle');
  const [bundleError, setBundleError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedGameId) {
      setCurrentVersion(null);
      setBundle(null);
      setBundleEtag(null);
      setBundleState('idle');
      setBundleError(null);
      return;
    }

    const gameId = selectedGameId;
    let cancelled = false;

    async function loadBundle() {
      setBundleState('loading');
      setBundleError(null);

      try {
        const currentResult = await getCurrentVersion(apiBaseUrl, gameId);
        if (cancelled) {
          return;
        }

        setCurrentVersion(currentResult.data);

        const bundleResult = await getBundle(apiBaseUrl, gameId, currentResult.data.versionId);
        if (cancelled) {
          return;
        }

        setBundle(bundleResult.data);
        setBundleEtag(bundleResult.etag);
        setBundleState('success');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setCurrentVersion(null);
        setBundle(null);
        setBundleEtag(null);
        setBundleState('error');
        setBundleError(getErrorMessage(error));
      }
    }

    void loadBundle();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, refreshSeed, selectedGameId]);

  const formulaProfiles = bundle?.formulaProfiles ?? [];
  const formulaBindings = bundle?.formulaBindings ?? [];

  return (
    <div className="page-grid">
      <Panel
        title="当前发布版本"
        kicker="Bundle Entry"
        actions={
          <button className="button secondary" type="button" onClick={() => setRefreshSeed((value) => value + 1)}>
            重新拉取
          </button>
        }
      >
        {!selectedGameId ? (
          <EmptyState title="还没选游戏" description="工作台会围绕当前 gameId 拉取 current version 和 bundle。" />
        ) : (
          <>
            <div className="metric-grid">
              <MetricCard label="游戏" value={selectedGameName} hint={selectedGameId} />
              <MetricCard
                label="版本号"
                value={currentVersion?.versionCode ?? '未发布'}
                hint={currentVersion ? `versionId=${currentVersion.versionId}` : '还没拿到 current version'}
              />
              <MetricCard
                label="Bundle 状态"
                value={bundleState}
                hint={bundleError ?? '已接到 /versions/{id}/bundle'}
              />
              <MetricCard
                label="Bundle ETag"
                value={bundleEtag ?? '尚未返回'}
                hint={`updatedAt：${formatDate(currentVersion?.updatedAt)}`}
              />
            </div>

            {bundleError ? <div className="notice notice-error">{bundleError}</div> : null}
          </>
        )}
      </Panel>

      <Panel title="数据规模" kicker="Bundle Stats">
        {!bundle ? (
          <EmptyState title="Bundle 还没就绪" description="一旦 current version 和 bundle 都能返回，这里会自动展示各实体规模。" />
        ) : (
          <div className="metric-grid">
            <MetricCard label="属性定义" value={String(bundle.attributeDefinitions.length)} hint="attributeDefinitions" />
            <MetricCard label="乘区桶" value={String(bundle.coefficientBuckets.length)} hint="coefficientBuckets" />
            <MetricCard label="类型" value={String(bundle.types.length)} hint="types + typeRelations" />
            <MetricCard
              label="控制规则"
              value={String(bundle.statusActionControlRules.length)}
              hint="statusActionControlRules"
            />
            <MetricCard label="英雄" value={String(bundle.heroes.length)} hint="heroes" />
            <MetricCard label="技能" value={String(bundle.skills.length)} hint="skills" />
            <MetricCard label="装备" value={String(bundle.items.length)} hint="items" />
            <MetricCard
              label="公式扩展"
              value={`${formulaProfiles.length}/${formulaBindings.length}`}
              hint="formulaProfiles / formulaBindings"
            />
          </div>
        )}
      </Panel>

      <Panel title="Bundle 元信息" kicker="Bundle Meta">
        {!bundle ? (
          <EmptyState title="等待 Bundle" description="当前页会把版本元信息、字典和顶层键先展示出来。" />
        ) : (
          <div className="split-grid">
            <div className="stack-block">
              <div className="metric-grid compact">
                <MetricCard label="versionCode" value={bundle.meta.versionCode} hint={`versionId=${bundle.meta.versionId}`} />
                <MetricCard label="generatedAt" value={formatDate(bundle.meta.generatedAt)} hint="Bundle 生成时刻" />
                <MetricCard label="dataHash" value={bundle.meta.dataHash.slice(0, 12)} hint="可用于 ETag" />
                <MetricCard
                  label="顶层键"
                  value={String(Object.keys(bundle).length)}
                  hint={Object.keys(bundle).join(', ')}
                />
              </div>
            </div>
            <div className="stack-block">
              <JsonBlock value={{ meta: bundle.meta, dictionaries: bundle.dictionaries ?? {} }} />
            </div>
          </div>
        )}
      </Panel>

      <Panel title="实体预览" kicker="Entity Preview">
        {!bundle ? (
          <EmptyState title="还没有实体数据" description="拿到 Bundle 后，这里会先给出一版只读预览表，方便后面继续接编辑器。" />
        ) : (
          <div className="split-grid">
            <div className="stack-block">
              <h3 className="subheading">英雄</h3>
              <DataTable
                columns={['heroId', '名称', '称号', '基础属性']}
                rows={bundle.heroes.slice(0, 6).map((hero) => [
                  <span className="mono" key={`${hero.heroId}-id`}>
                    {hero.heroId}
                  </span>,
                  hero.name ?? '—',
                  hero.title ?? '—',
                  formatPreview(hero.baseStats)
                ])}
                emptyMessage="当前 Bundle 没有英雄。"
              />

              <h3 className="subheading">技能</h3>
              <DataTable
                columns={['skillId', '归属', 'skillKey', '名称']}
                rows={bundle.skills.slice(0, 6).map((skill) => [
                  <span className="mono" key={`${skill.skillId}-id`}>
                    {skill.skillId}
                  </span>,
                  `${skill.ownerType}:${skill.ownerId}`,
                  skill.skillKey ?? '—',
                  skill.name ?? '—'
                ])}
                emptyMessage="当前 Bundle 没有技能。"
              />
            </div>

            <div className="stack-block">
              <h3 className="subheading">装备</h3>
              <DataTable
                columns={['itemId', '名称', '价格', '技能引用']}
                rows={bundle.items.slice(0, 6).map((item) => [
                  <span className="mono" key={`${item.itemId}-id`}>
                    {item.itemId}
                  </span>,
                  item.name ?? '—',
                  item.goldCost ?? '—',
                  formatPreview(item.skillRefs)
                ])}
                emptyMessage="当前 Bundle 没有装备。"
              />

              <h3 className="subheading">公式扩展</h3>
              <DataTable
                columns={['formulaId/bindingKey', '类型', '目标', '描述']}
                rows={[
                  ...formulaProfiles.slice(0, 3).map((profile) => [
                    <span className="mono" key={`${profile.formulaId}-formula`}>
                      {profile.formulaId}
                    </span>,
                    profile.formulaType ?? 'profile',
                    profile.formulaKind ?? '—',
                    profile.description ?? '—'
                  ]),
                  ...formulaBindings.slice(0, 3).map((binding) => [
                    <span className="mono" key={`${binding.bindingKey}-binding`}>
                      {binding.bindingKey}
                    </span>,
                    'binding',
                    `${binding.targetCategory}:${binding.targetId}`,
                    binding.formulaId
                  ])
                ]}
                emptyMessage="当前 Bundle 里还没有公式扩展数据。"
              />
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
