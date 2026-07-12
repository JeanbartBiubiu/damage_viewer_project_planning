import { Alert, Button, Space, Tag, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { formatCombatDataError, getCombatDataState } from '../../../services/combatDataClient';
import type { CombatDataState } from '../../../types/combatData';
import {
  combatDataHref,
  getAdjacentCombatDataResources
} from '../combatDataNav';
import { CombatDataResourcePage } from './CombatDataResourcePage';
import { getCombatDataResource } from './resourceRegistry';

type CombatDataPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  resourceId: string;
  /** True when GET /api/games already succeeded for this API base. */
  gamesReachable: boolean;
};

/**
 * Single-resource combat-data page (one hash route → one editor).
 * Replaces the retired dual-Tabs workbench; does not re-embed all editors.
 */
export function CombatDataPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  resourceId,
  gamesReachable
}: CombatDataPageProps) {
  const config = getCombatDataResource(resourceId);
  const adjacent = getAdjacentCombatDataResources(resourceId);

  const [state, setState] = useState<CombatDataState | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [stateTick, setStateTick] = useState(0);

  const refreshState = useCallback(async () => {
    if (!selectedGameId) {
      setState(null);
      setStateError(null);
      return;
    }

    try {
      setStateLoading(true);
      setStateError(null);
      const result = await getCombatDataState(apiBaseUrl, selectedGameId);
      setState(result.data.data);
    } catch (error) {
      setState(null);
      setStateError(
        formatCombatDataError(error, 'contract-entry', {
          apiBaseUrl,
          gamesReachable
        })
      );
    } finally {
      setStateLoading(false);
    }
  }, [apiBaseUrl, gamesReachable, selectedGameId]);

  useEffect(() => {
    void refreshState();
  }, [refreshState, stateTick]);

  if (!config) {
    return <Alert type="error" content={`未知 combat-data 资源：${resourceId}`} />;
  }

  return (
    <div className="page-admin-resource page-stack">
      <Panel
        title={config.label}
        kicker={`Combat Data · ${adjacent.group?.label ?? '资源'}`}
        actions={
          <Button
            onClick={() => {
              void refreshState();
              setStateTick((value) => value + 1);
            }}
            loading={stateLoading}
            disabled={!selectedGameId}
          >
            刷新状态
          </Button>
        }
      >
        <Alert
          type="info"
          content={`当前 API：${apiBaseUrl}`}
          className="resource-warning-alert"
          style={{ marginBottom: 12 }}
        />

        {!selectedGameId ? (
          <Alert type="warning" content="请先选择当前 gameId。" className="resource-warning-alert" />
        ) : null}
        {stateError ? <Alert type="error" content={stateError} className="resource-warning-alert" /> : null}

        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          {config.summary}
        </Typography.Paragraph>

        <Space wrap size={12} style={{ marginBottom: 12 }}>
          <Tag color="arcoblue">currentRevision: {state?.currentRevision ?? '--'}</Tag>
          <Tag color="green">publishedRevision: {state?.publishedRevision ?? '--'}</Tag>
          <Typography.Text type="secondary">
            {state?.updatedAt ? `updatedAt: ${state.updatedAt}` : '尚未加载 combat-data state'}
          </Typography.Text>
        </Space>

        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          后端基础约束（结构/非空） vs 当前 Wasm 能力校验（组装时）
        </Typography.Text>

        {(adjacent.previous || adjacent.next) && (
          <Space wrap size={8} style={{ marginBottom: 4 }}>
            <Typography.Text type="secondary">同组：</Typography.Text>
            {adjacent.previous ? (
              <Button type="text" size="mini" href={combatDataHref(adjacent.previous.id)}>
                ← {adjacent.previous.label}
              </Button>
            ) : null}
            {adjacent.next ? (
              <Button type="text" size="mini" href={combatDataHref(adjacent.next.id)}>
                {adjacent.next.label} →
              </Button>
            ) : null}
          </Space>
        )}
      </Panel>

      <CombatDataResourcePage
        key={`${resourceId}-${stateTick}`}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        resourceId={resourceId}
        gamesReachable={gamesReachable}
        hideHeaderSummary
      />
    </div>
  );
}
