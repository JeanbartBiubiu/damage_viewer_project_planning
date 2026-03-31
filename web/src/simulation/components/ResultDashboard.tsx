/**
 * ResultDashboard — 结果展示区
 *
 * 包含：结论卡片、图表区、对比表、事件明细表、输入快照。
 * 图表使用 ECharts。
 */

import { Card, Descriptions, Space, Table, Tag, Typography } from '@arco-design/web-react';
import type {
  ComparisonRow,
  InterpretedResult,
  SimulationResult,
  SummaryCard,
} from '../types';
import type { EngineDamageEvent } from '../../engine/types';
import { SimChart } from './SimChart';
import { DamageBreakdown } from './DamageBreakdown';

type ResultDashboardProps = {
  result: SimulationResult | null;
  interpreted: InterpretedResult | null;
};

// ═══════════════════════════════════════════════════════════════
// 结论卡片
// ═══════════════════════════════════════════════════════════════

function SummaryCardsView({ cards }: { cards: SummaryCard[] }) {
  if (cards.length === 0) return null;

  return (
    <div className="sim-summary-cards">
      <Space size={8} wrap>
        {cards.map((c, i) => (
          <Card key={i} size="small" style={{ minWidth: 120 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {c.label}
            </Typography.Text>
            <div>
              <Typography.Text
                bold
                style={{ fontSize: 18 }}
                type={
                  c.highlight === 'positive'
                    ? 'success'
                    : c.highlight === 'negative'
                      ? 'error'
                      : undefined
                }
              >
                {c.value}
              </Typography.Text>
              {c.unit && (
                <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 2 }}>
                  {c.unit}
                </Typography.Text>
              )}
            </div>
          </Card>
        ))}
      </Space>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 对比表
// ═══════════════════════════════════════════════════════════════

const comparisonColumns = [
  { title: '变体', dataIndex: 'variantLabel', key: 'variantLabel' },
  { title: '总伤害', dataIndex: 'totalDamage', key: 'totalDamage' },
  { title: 'DPS', dataIndex: 'dps', key: 'dps' },
  {
    title: '击杀耗时',
    dataIndex: 'timeToKillMs',
    key: 'timeToKillMs',
    render: (val: number | undefined) => (val != null ? `${(val / 1000).toFixed(2)}s` : '—'),
  },
  {
    title: '停止原因',
    dataIndex: 'stopReason',
    key: 'stopReason',
    render: (val: string) => (
      <Tag size="small" color={val === 'enemyDead' ? 'green' : val === 'selfDead' ? 'red' : 'gray'}>
        {val}
      </Tag>
    ),
  },
];

function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card size="small" title="对比结果" style={{ marginTop: 12 }}>
      <Table
        size="small"
        columns={comparisonColumns}
        data={rows.map((r) => ({ ...r, key: r.variantKey }))}
        pagination={false}
        border={false}
      />
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// 事件明细表
// ═══════════════════════════════════════════════════════════════

const eventColumns = [
  { title: '#', dataIndex: 'sequence', key: 'sequence', width: 50 },
  {
    title: '时间(ms)',
    dataIndex: 'tMs',
    key: 'tMs',
    width: 80,
    render: (val: number) => val.toFixed(0),
  },
  { title: '事件', dataIndex: 'label', key: 'label' },
  {
    title: '原始伤害',
    dataIndex: 'totalRawDamage',
    key: 'totalRawDamage',
    width: 90,
    render: (val: number) => Math.round(val),
  },
  {
    title: '实际伤害',
    dataIndex: 'totalDealtDamage',
    key: 'totalDealtDamage',
    width: 90,
    render: (val: number) => Math.round(val),
  },
  {
    title: '目标HP',
    dataIndex: 'enemyHpAfter',
    key: 'enemyHpAfter',
    width: 90,
    render: (val: number) => Math.round(val),
  },
];

function EventTable({ events }: { events: EngineDamageEvent[] }) {
  if (events.length === 0) return null;
  return (
    <Card size="small" title="事件明细" style={{ marginTop: 12 }}>
      <Table
        size="small"
        columns={eventColumns}
        data={events.map((e) => ({ ...e, key: e.sequence }))}
        pagination={events.length > 50 ? { pageSize: 50 } : false}
        border={false}
        scroll={{ y: 400 }}
      />
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// 运行快照
// ═══════════════════════════════════════════════════════════════

function SnapshotView({ result }: { result: SimulationResult }) {
  return (
    <Card size="small" title="运行快照" style={{ marginTop: 12 }}>
      <Descriptions
        size="small"
        column={2}
        data={[
          { label: '场景', value: result.scenarioId },
          { label: '变体数', value: result.variants.length },
          { label: '总耗时', value: `${result.totalDurationMs}ms` },
          { label: '开始', value: result.startedAt },
          { label: '完成', value: result.completedAt },
          { label: 'GameId', value: result.bundleMeta.gameId },
          { label: 'Version', value: result.bundleMeta.versionId },
          { label: 'Hash', value: result.bundleMeta.dataHash.slice(0, 12) },
        ]}
      />
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════

export function ResultDashboard({ result, interpreted }: ResultDashboardProps) {
  if (!result || !interpreted) {
    return (
      <div className="sim-result-empty">
        <Typography.Text type="secondary">运行模拟后，结果将显示在此处。</Typography.Text>
      </div>
    );
  }

  const firstVariant = result.variants[0] ?? null;
  const events = firstVariant?.output.events ?? [];

  return (
    <div className="sim-result-dashboard">
      <SummaryCardsView cards={interpreted.summaryCards} />

      {interpreted.chartSeries.length > 0 && (
        <Card size="small" title="图表" style={{ marginTop: 12 }}>
          <SimChart series={interpreted.chartSeries} height={320} />
        </Card>
      )}

      <ComparisonTable rows={interpreted.comparisonRows} />
      <DamageBreakdown events={events} />
      <EventTable events={events} />
      <SnapshotView result={result} />
    </div>
  );
}
