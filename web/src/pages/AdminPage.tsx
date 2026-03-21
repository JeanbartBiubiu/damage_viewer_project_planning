import { useEffect, useState } from 'react';
import { DataTable } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import { adminEndpoints } from '../config/navigation';
import {
  getCoefficientBuckets,
  getErrorMessage,
  getFormulaBindings,
  getFormulaProfiles,
  getStatusActionControlRules
} from '../services/apiClient';
import type {
  CoefficientBucket,
  FormulaBinding,
  FormulaProfile,
  LoadState,
  StatusActionControlRule
} from '../types/api';

type AdminPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
  adminToken: string;
  onAdminTokenChange: (value: string) => void;
};

type AdminSnapshot = {
  coefficientBuckets: CoefficientBucket[];
  statusActionControlRules: StatusActionControlRule[];
  formulaProfiles: FormulaProfile[];
  formulaBindings: FormulaBinding[];
};

function applyGameId(path: string, selectedGameId: string | null): string {
  return selectedGameId ? path.replaceAll('{gameId}', selectedGameId) : path;
}

export function AdminPage({
  apiBaseUrl,
  selectedGameId,
  selectedGameName,
  adminToken,
  onAdminTokenChange
}: AdminPageProps) {
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [snapshotState, setSnapshotState] = useState<LoadState>('idle');
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AdminSnapshot>({
    coefficientBuckets: [],
    statusActionControlRules: [],
    formulaProfiles: [],
    formulaBindings: []
  });

  useEffect(() => {
    const token = adminToken.trim();

    if (!selectedGameId || !token) {
      setSnapshotState('idle');
      setSnapshotError(null);
      setSnapshot({
        coefficientBuckets: [],
        statusActionControlRules: [],
        formulaProfiles: [],
        formulaBindings: []
      });
      return;
    }

    const gameId = selectedGameId;
    let cancelled = false;

    async function loadSnapshot() {
      setSnapshotState('loading');
      setSnapshotError(null);

      try {
        const [bucketsResult, rulesResult, profilesResult, bindingsResult] = await Promise.all([
          getCoefficientBuckets(apiBaseUrl, gameId, token),
          getStatusActionControlRules(apiBaseUrl, gameId, token),
          getFormulaProfiles(apiBaseUrl, gameId, token),
          getFormulaBindings(apiBaseUrl, gameId, token)
        ]);

        if (cancelled) {
          return;
        }

        setSnapshot({
          coefficientBuckets: bucketsResult.data.coefficientBuckets,
          statusActionControlRules: rulesResult.data.statusActionControlRules,
          formulaProfiles: profilesResult.data.formulaProfiles,
          formulaBindings: bindingsResult.data.formulaBindings
        });
        setSnapshotState('success');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setSnapshotState('error');
        setSnapshotError(getErrorMessage(error));
      }
    }

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [adminToken, apiBaseUrl, refreshSeed, selectedGameId]);

  const sampleBodies = adminEndpoints.filter((endpoint) => endpoint.sampleBody).slice(0, 4);

  return (
    <div className="page-grid">
      <Panel
        title="JWT 与访问"
        kicker="Admin Access"
        actions={
          <button className="button secondary" type="button" onClick={() => setRefreshSeed((value) => value + 1)}>
            刷新后台快照
          </button>
        }
      >
        <div className="split-grid">
          <div className="stack-block">
            <label className="field">
              <span className="field-label">Admin JWT</span>
              <textarea
                className="text-area"
                rows={8}
                value={adminToken}
                onChange={(event) => onAdminTokenChange(event.target.value)}
                placeholder="把 Bearer Token 粘过来，实时后台快照会自动开始拉取。"
              />
            </label>

            <div className="metric-grid compact">
              <MetricCard label="当前游戏" value={selectedGameName} hint={selectedGameId ?? '未选择 gameId'} />
              <MetricCard label="JWT 状态" value={adminToken.trim() ? '已配置' : '未配置'} hint="保存在浏览器 localStorage" />
              <MetricCard label="后台快照" value={snapshotState} hint={snapshotError ?? '四个已实现 GET 接口'} />
              <MetricCard label="只读快照范围" value="4 组" hint="formula / binding / bucket / rule" />
            </div>

            {snapshotError ? <div className="notice notice-error">{snapshotError}</div> : null}
          </div>

          <div className="stack-block">
            <JsonBlock
              value={{
                gameId: selectedGameId,
                apiBaseUrl,
                liveResources: [
                  '/api/admin/games/{gameId}/coefficient-buckets',
                  '/api/admin/games/{gameId}/status-action-control-rules',
                  '/api/admin/games/{gameId}/formula-profiles',
                  '/api/admin/games/{gameId}/formula-bindings'
                ]
              }}
            />
          </div>
        </div>
      </Panel>

      <Panel title="后台实时快照" kicker="Admin Snapshot">
        {!selectedGameId ? (
          <EmptyState title="还没选 gameId" description="后台页会围绕当前游戏拉取可读的 Admin 资源快照。" />
        ) : !adminToken.trim() ? (
          <EmptyState title="还没填 JWT" description="把可编辑用户的 Bearer Token 放进上面的输入框，就能看到后台只读快照。" />
        ) : (
          <>
            <div className="metric-grid">
              <MetricCard
                label="乘区桶"
                value={String(snapshot.coefficientBuckets.length)}
                hint="coefficient-buckets"
              />
              <MetricCard
                label="状态规则"
                value={String(snapshot.statusActionControlRules.length)}
                hint="status-action-control-rules"
              />
              <MetricCard label="公式档案" value={String(snapshot.formulaProfiles.length)} hint="formula-profiles" />
              <MetricCard label="公式绑定" value={String(snapshot.formulaBindings.length)} hint="formula-bindings" />
            </div>

            <div className="split-grid">
              <div className="stack-block">
                <h3 className="subheading">乘区桶</h3>
                <DataTable
                  columns={['bucketKey', 'domain', 'stageKey', 'aggregation']}
                  rows={snapshot.coefficientBuckets.slice(0, 6).map((bucket) => [
                    <span className="mono" key={`${bucket.bucketKey}-bucket`}>
                      {bucket.bucketKey}
                    </span>,
                    bucket.resolutionDomain,
                    bucket.stageKey,
                    bucket.aggregationMode
                  ])}
                  emptyMessage="当前没有乘区桶数据。"
                />

                <h3 className="subheading">状态动作控制</h3>
                <DataTable
                  columns={['ruleId', 'ruleKind', 'statusTypeId', 'priority']}
                  rows={snapshot.statusActionControlRules.slice(0, 6).map((rule) => [
                    <span className="mono" key={`${rule.ruleId}-rule`}>
                      {rule.ruleId}
                    </span>,
                    rule.ruleKind,
                    rule.statusTypeId,
                    rule.priority ?? '—'
                  ])}
                  emptyMessage="当前没有状态规则数据。"
                />
              </div>

              <div className="stack-block">
                <h3 className="subheading">公式档案</h3>
                <DataTable
                  columns={['formulaId', 'formulaType', 'formulaKind', '描述']}
                  rows={snapshot.formulaProfiles.slice(0, 6).map((profile) => [
                    <span className="mono" key={`${profile.formulaId}-profile`}>
                      {profile.formulaId}
                    </span>,
                    profile.formulaType ?? '—',
                    profile.formulaKind ?? '—',
                    profile.description ?? '—'
                  ])}
                  emptyMessage="当前没有公式档案数据。"
                />

                <h3 className="subheading">公式绑定</h3>
                <DataTable
                  columns={['bindingKey', 'target', 'formulaId', 'override']}
                  rows={snapshot.formulaBindings.slice(0, 6).map((binding) => [
                    <span className="mono" key={`${binding.bindingKey}-binding`}>
                      {binding.bindingKey}
                    </span>,
                    `${binding.targetCategory}:${binding.targetId}`,
                    binding.formulaId,
                    binding.overrideParams ? '有' : '无'
                  ])}
                  emptyMessage="当前没有公式绑定数据。"
                />
              </div>
            </div>
          </>
        )}
      </Panel>

      <Panel title="接口矩阵" kicker="Admin Surface">
        <div className="endpoint-grid">
          {adminEndpoints.map((endpoint) => (
            <article className="endpoint-card" key={endpoint.title}>
              <div className="endpoint-header">
                <span className="endpoint-method">{endpoint.method}</span>
                <h3 className="endpoint-title">{endpoint.title}</h3>
              </div>
              <p className="endpoint-path">{applyGameId(endpoint.path, selectedGameId)}</p>
              <p className="endpoint-description">{endpoint.description}</p>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="请求体样例" kicker="Payload Examples">
        <div className="split-grid">
          {sampleBodies.map((endpoint) => (
            <div className="stack-block" key={endpoint.title}>
              <h3 className="subheading">{endpoint.title}</h3>
              <p className="field-note">{applyGameId(endpoint.path, selectedGameId)}</p>
              <JsonBlock value={endpoint.sampleBody} />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
