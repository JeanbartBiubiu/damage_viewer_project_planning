import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Grid, Input, Space, Typography } from '@arco-design/web-react';
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

const { Row, Col } = Grid;

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
    <div className="page-admin page-stack">
      <Panel
        title="JWT 与访问"
        kicker="Admin Access"
        actions={
          <Button onClick={() => setRefreshSeed((value) => value + 1)} type="primary">
            刷新后台快照
          </Button>
        }
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={14}>
            <Form layout="vertical">
              <Form.Item label="Admin JWT">
                <Input.TextArea
                  autoSize={{ minRows: 8 }}
                  value={adminToken}
                  onChange={onAdminTokenChange}
                  placeholder="把 Bearer Token 粘贴到这里，页面会自动读取后台只读接口。"
                />
              </Form.Item>
            </Form>

            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="当前游戏" value={selectedGameName} hint={selectedGameId ?? '未选择 gameId'} />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard
                  label="JWT 状态"
                  value={adminToken.trim() ? '已配置' : '未配置'}
                  hint="保存在浏览器 localStorage"
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="后台快照" value={snapshotState} hint={snapshotError ?? '四个只读 GET 接口已接通'} />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="只读范围" value="4 组" hint="formula / binding / bucket / rule" />
              </Col>
            </Row>

            {snapshotError ? <Alert type="error" content={snapshotError} /> : null}
          </Col>

          <Col xs={24} lg={10}>
            <Card size="small">
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
            </Card>
          </Col>
        </Row>
      </Panel>

      <Panel title="后台实时快照" kicker="Admin Snapshot">
        {!selectedGameId ? (
          <EmptyState title="还没有选择 gameId" description="后台页会围绕当前游戏拉取可读的 Admin 资源快照。" />
        ) : !adminToken.trim() ? (
          <EmptyState title="还没有填写 JWT" description="把可编辑用户的 Bearer Token 放到上面的输入框，就能看到后台只读数据。" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="乘区桶" value={String(snapshot.coefficientBuckets.length)} hint="coefficient-buckets" />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="状态规则" value={String(snapshot.statusActionControlRules.length)} hint="status-action-control-rules" />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="公式档案" value={String(snapshot.formulaProfiles.length)} hint="formula-profiles" />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="公式绑定" value={String(snapshot.formulaBindings.length)} hint="formula-bindings" />
              </Col>
            </Row>

            <Row gutter={[16, 16]}>
              <Col xs={24} lg={12}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Typography.Title heading={5} style={{ margin: 0 }}>
                    乘区桶
                  </Typography.Title>
                  <DataTable
                    columns={['bucketKey', 'domain', 'stageKey', 'aggregation']}
                    rows={snapshot.coefficientBuckets.slice(0, 6).map((bucket) => [
                      <Typography.Text code key={`${bucket.bucketKey}-bucket`}>
                        {bucket.bucketKey}
                      </Typography.Text>,
                      bucket.resolutionDomain,
                      bucket.stageKey,
                      bucket.aggregationMode
                    ])}
                    emptyMessage="当前没有乘区桶数据。"
                  />

                  <Typography.Title heading={5} style={{ margin: 0 }}>
                    状态动作控制
                  </Typography.Title>
                  <DataTable
                    columns={['ruleId', 'ruleKind', 'statusTypeId', 'priority']}
                    rows={snapshot.statusActionControlRules.slice(0, 6).map((rule) => [
                      <Typography.Text code key={`${rule.ruleId}-rule`}>
                        {rule.ruleId}
                      </Typography.Text>,
                      rule.ruleKind,
                      rule.statusTypeId,
                      rule.priority ?? '—'
                    ])}
                    emptyMessage="当前没有状态规则数据。"
                  />
                </Space>
              </Col>

              <Col xs={24} lg={12}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Typography.Title heading={5} style={{ margin: 0 }}>
                    公式档案
                  </Typography.Title>
                  <DataTable
                    columns={['formulaId', 'formulaType', 'formulaKind', '描述']}
                    rows={snapshot.formulaProfiles.slice(0, 6).map((profile) => [
                      <Typography.Text code key={`${profile.formulaId}-profile`}>
                        {profile.formulaId}
                      </Typography.Text>,
                      profile.formulaType ?? '—',
                      profile.formulaKind ?? '—',
                      profile.description ?? '—'
                    ])}
                    emptyMessage="当前没有公式档案数据。"
                  />

                  <Typography.Title heading={5} style={{ margin: 0 }}>
                    公式绑定
                  </Typography.Title>
                  <DataTable
                    columns={['bindingKey', 'target', 'formulaId', 'override']}
                    rows={snapshot.formulaBindings.slice(0, 6).map((binding) => [
                      <Typography.Text code key={`${binding.bindingKey}-binding`}>
                        {binding.bindingKey}
                      </Typography.Text>,
                      `${binding.targetCategory}:${binding.targetId}`,
                      binding.formulaId,
                      binding.overrideParams ? 'yes' : 'no'
                    ])}
                    emptyMessage="当前没有公式绑定数据。"
                  />
                </Space>
              </Col>
            </Row>
          </Space>
        )}
      </Panel>

      <Panel title="接口矩阵" kicker="Admin Surface">
        <Row gutter={[16, 16]}>
          {adminEndpoints.map((endpoint) => (
            <Col xs={24} sm={12} lg={8} key={endpoint.title}>
              <Card size="small">
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Space wrap>
                    <Typography.Title heading={5} style={{ margin: 0 }}>
                      {endpoint.title}
                    </Typography.Title>
                  </Space>
                  <Typography.Text code>{applyGameId(endpoint.path, selectedGameId)}</Typography.Text>
                  <Typography.Text type="secondary">{endpoint.description}</Typography.Text>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Panel>

      <Panel title="请求体样例" kicker="Payload Examples">
        <Row gutter={[16, 16]}>
          {sampleBodies.map((endpoint) => (
            <Col xs={24} lg={12} key={endpoint.title}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Typography.Title heading={5} style={{ margin: 0 }}>
                  {endpoint.title}
                </Typography.Title>
                <Typography.Text type="secondary">{applyGameId(endpoint.path, selectedGameId)}</Typography.Text>
                <Card size="small">
                  <JsonBlock value={endpoint.sampleBody} />
                </Card>
              </Space>
            </Col>
          ))}
        </Row>
      </Panel>
    </div>
  );
}
