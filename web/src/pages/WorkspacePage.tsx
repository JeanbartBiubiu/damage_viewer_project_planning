import { useEffect, useState } from 'react';
import { Alert, Button, Card, Grid, Space, Typography } from '@arco-design/web-react';
import { DataTable } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import { getErrorMessage } from '../services/apiClient';
import { loadPublishedBundleSnapshot } from '../services/bundleSnapshot';
import type { CurrentVersion, GameDataBundle, LoadState } from '../types/api';

type WorkspacePageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
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
        const snapshot = await loadPublishedBundleSnapshot(apiBaseUrl, gameId);
        if (cancelled) {
          return;
        }

        setCurrentVersion(snapshot.currentVersion);
        setBundle(snapshot.bundle);
        setBundleEtag(snapshot.bundleEtag);
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
    <div className="page-workspace page-stack">
      <Panel
        title="当前发布版本"
        kicker="Bundle Entry"
        actions={
          <Button onClick={() => setRefreshSeed((value) => value + 1)} type="primary">
            重新拉取
          </Button>
        }
      >
        {!selectedGameId ? (
          <EmptyState title="还没有选择游戏" description="工作台会围绕当前 gameId 拉取 current version 和 bundle。" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="游戏" value={selectedGameName} hint={selectedGameId} />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard
                  label="版本号"
                  value={currentVersion?.versionCode ?? '未发布'}
                  hint={currentVersion ? `versionId=${currentVersion.versionId}` : '还没有拿到 current version'}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="Bundle 状态" value={bundleState} hint={bundleError ?? '已经对接 /versions/{id}/bundle'} />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="Bundle ETag" value={bundleEtag ?? '暂无'} hint={`updatedAt: ${formatDate(currentVersion?.updatedAt)}`} />
              </Col>
            </Row>

            {bundleError ? <Alert type="error" content={bundleError} /> : null}
          </Space>
        )}
      </Panel>

      <Panel title="数据规模" kicker="Bundle Stats">
        {!bundle ? (
          <EmptyState title="Bundle 还没有就绪" description="拿到 current version 和 bundle 之后，这里会展示各实体规模。" />
        ) : (
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} lg={6}>
              <MetricCard label="属性定义" value={String(bundle.attributeDefinitions.length)} hint="attributeDefinitions" />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricCard label="乘区桶" value={String(bundle.coefficientBuckets.length)} hint="coefficientBuckets" />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricCard label="类型" value={String(bundle.types.length)} hint="types + typeRelations" />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricCard label="控制规则" value={String(bundle.statusActionControlRules.length)} hint="statusActionControlRules" />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricCard label="英雄" value={String(bundle.heroes.length)} hint="heroes" />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricCard label="技能" value={String(bundle.skills.length)} hint="skills" />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricCard label="装备" value={String(bundle.items.length)} hint="items" />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricCard
                label="公式扩展"
                value={`${formulaProfiles.length}/${formulaBindings.length}`}
                hint="formulaProfiles / formulaBindings"
              />
            </Col>
          </Row>
        )}
      </Panel>

      <Panel title="Bundle 元信息" kicker="Bundle Meta">
        {!bundle ? (
          <EmptyState title="等待 Bundle" description="这里会先展示版本元信息、字典和顶层字段。" />
        ) : (
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Row gutter={[16, 16]}>
                  <Col xs={24} sm={12}>
                    <MetricCard label="versionCode" value={bundle.meta.versionCode} hint={`versionId=${bundle.meta.versionId}`} />
                  </Col>
                  <Col xs={24} sm={12}>
                    <MetricCard label="generatedAt" value={formatDate(bundle.meta.generatedAt)} hint="Bundle 生成时刻" />
                  </Col>
                  <Col xs={24} sm={12}>
                    <MetricCard label="dataHash" value={bundle.meta.dataHash.slice(0, 12)} hint="可用作 ETag" />
                  </Col>
                  <Col xs={24} sm={12}>
                    <MetricCard label="顶层键" value={String(Object.keys(bundle).length)} hint={Object.keys(bundle).join(', ')} />
                  </Col>
                </Row>
              </Space>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small">
                <JsonBlock value={{ meta: bundle.meta, dictionaries: bundle.dictionaries ?? {} }} />
              </Card>
            </Col>
          </Row>
        )}
      </Panel>

      <Panel title="实体预览" kicker="Entity Preview">
        {!bundle ? (
          <EmptyState title="还没有实体数据" description="拿到 Bundle 后，这里会给出只读预览表，方便继续接编辑器。" />
        ) : (
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Typography.Title heading={5} style={{ margin: 0 }}>
                  英雄
                </Typography.Title>
                <DataTable
                  columns={['heroId', '名称', '称号', '基础属性']}
                  rows={bundle.heroes.slice(0, 6).map((hero) => [
                    <Typography.Text code key={`${hero.heroId}-id`}>
                      {hero.heroId}
                    </Typography.Text>,
                    hero.name ?? '—',
                    hero.title ?? '—',
                    formatPreview(hero.baseStats)
                  ])}
                  emptyMessage="当前 Bundle 没有英雄。"
                />

                <Typography.Title heading={5} style={{ margin: 0 }}>
                  技能
                </Typography.Title>
                <DataTable
                  columns={['skillId', '归属', 'skillKey', '名称']}
                  rows={bundle.skills.slice(0, 6).map((skill) => [
                    <Typography.Text code key={`${skill.skillId}-id`}>
                      {skill.skillId}
                    </Typography.Text>,
                    `${skill.ownerType}:${skill.ownerId}`,
                    skill.skillKey ?? '—',
                    skill.name ?? '—'
                  ])}
                  emptyMessage="当前 Bundle 没有技能。"
                />
              </Space>
            </Col>

            <Col xs={24} lg={12}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Typography.Title heading={5} style={{ margin: 0 }}>
                  装备
                </Typography.Title>
                <DataTable
                  columns={['itemId', '名称', '价格', '技能引用']}
                  rows={bundle.items.slice(0, 6).map((item) => [
                    <Typography.Text code key={`${item.itemId}-id`}>
                      {item.itemId}
                    </Typography.Text>,
                    item.name ?? '—',
                    item.goldCost ?? '—',
                    formatPreview(item.skillRefs)
                  ])}
                  emptyMessage="当前 Bundle 没有装备。"
                />

                <Typography.Title heading={5} style={{ margin: 0 }}>
                  公式扩展
                </Typography.Title>
                <DataTable
                  columns={['formulaId/bindingKey', '类型', '目标', '描述']}
                  rows={[
                    ...formulaProfiles.slice(0, 3).map((profile) => [
                      <Typography.Text code key={`${profile.formulaId}-formula`}>
                        {profile.formulaId}
                      </Typography.Text>,
                      profile.formulaType ?? 'profile',
                      profile.formulaKind ?? '—',
                      profile.description ?? '—'
                    ]),
                    ...formulaBindings.slice(0, 3).map((binding) => [
                      <Typography.Text code key={`${binding.bindingKey}-binding`}>
                        {binding.bindingKey}
                      </Typography.Text>,
                      'binding',
                      `${binding.targetCategory}:${binding.targetId}`,
                      binding.formulaId
                    ])
                  ]}
                  emptyMessage="当前 Bundle 里还没有公式扩展数据。"
                />
              </Space>
            </Col>
          </Row>
        )}
      </Panel>
    </div>
  );
}
