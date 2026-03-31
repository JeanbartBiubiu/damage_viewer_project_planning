/**
 * DamageBreakdown — 分项伤害聚合表
 *
 * 从事件的 components 中按 damageType (物理/魔法/真实) 和
 * sourceKind (平A/技能/装备) 两个维度聚合伤害数据，
 * 展示为总表和饼图式卡片。
 */

import { Card, Grid, Space, Table, Tag, Typography } from '@arco-design/web-react';
import type { EngineDamageEvent, DamageType } from '../../engine/types';

const { Row, Col } = Grid;

type DamageBreakdownProps = {
  events: EngineDamageEvent[];
};

// ── 聚合结构 ──

type BreakdownByType = {
  damageType: DamageType;
  rawTotal: number;
  dealtTotal: number;
  hitCount: number;
};

type BreakdownBySource = {
  sourceKind: string;
  sourceId: string;
  label: string;
  damageType: DamageType;
  rawTotal: number;
  dealtTotal: number;
  hitCount: number;
};

function aggregateByType(events: EngineDamageEvent[]): BreakdownByType[] {
  const map = new Map<DamageType, BreakdownByType>();

  for (const evt of events) {
    for (const comp of evt.components) {
      let entry = map.get(comp.damageType);
      if (!entry) {
        entry = { damageType: comp.damageType, rawTotal: 0, dealtTotal: 0, hitCount: 0 };
        map.set(comp.damageType, entry);
      }
      entry.rawTotal += comp.rawDamage;
      entry.dealtTotal += comp.dealtDamage;
      entry.hitCount += 1;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.dealtTotal - a.dealtTotal);
}

function aggregateBySource(events: EngineDamageEvent[]): BreakdownBySource[] {
  const map = new Map<string, BreakdownBySource>();

  for (const evt of events) {
    for (const comp of evt.components) {
      const key = `${comp.sourceKind}:${comp.sourceId}:${comp.damageType}`;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          sourceKind: comp.sourceKind,
          sourceId: comp.sourceId,
          label: comp.label,
          damageType: comp.damageType,
          rawTotal: 0,
          dealtTotal: 0,
          hitCount: 0,
        };
        map.set(key, entry);
      }
      entry.rawTotal += comp.rawDamage;
      entry.dealtTotal += comp.dealtDamage;
      entry.hitCount += 1;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.dealtTotal - a.dealtTotal);
}

// ── 类型色 ──

const TYPE_COLOR: Record<DamageType, string> = {
  physical: 'orangered',
  magic: 'purple',
  true: 'gray',
};

const TYPE_LABEL: Record<DamageType, string> = {
  physical: '物理',
  magic: '魔法',
  true: '真实',
};

const SOURCE_KIND_LABEL: Record<string, string> = {
  basic_attack: '平A',
  skill: '技能',
  item: '装备',
};

// ── 按类型表 ──

const typeColumns = [
  {
    title: '伤害类型',
    dataIndex: 'damageType',
    key: 'damageType',
    render: (val: DamageType) => (
      <Tag size="small" color={TYPE_COLOR[val]}>
        {TYPE_LABEL[val] ?? val}
      </Tag>
    ),
  },
  {
    title: '原始伤害',
    dataIndex: 'rawTotal',
    key: 'rawTotal',
    render: (val: number) => Math.round(val),
  },
  {
    title: '实际伤害',
    dataIndex: 'dealtTotal',
    key: 'dealtTotal',
    render: (val: number) => Math.round(val),
  },
  {
    title: '减伤率',
    key: 'mitigation',
    render: (_: unknown, row: BreakdownByType) =>
      row.rawTotal > 0
        ? `${((1 - row.dealtTotal / row.rawTotal) * 100).toFixed(1)}%`
        : '—',
  },
  {
    title: '命中数',
    dataIndex: 'hitCount',
    key: 'hitCount',
  },
];

// ── 按来源表 ──

const sourceColumns = [
  {
    title: '来源',
    key: 'source',
    render: (_: unknown, row: BreakdownBySource) => (
      <Space size={4}>
        <Tag size="small">{SOURCE_KIND_LABEL[row.sourceKind] ?? row.sourceKind}</Tag>
        <Typography.Text style={{ fontSize: 12 }}>{row.label}</Typography.Text>
      </Space>
    ),
  },
  {
    title: '类型',
    dataIndex: 'damageType',
    key: 'damageType',
    width: 60,
    render: (val: DamageType) => (
      <Tag size="small" color={TYPE_COLOR[val]}>
        {TYPE_LABEL[val] ?? val}
      </Tag>
    ),
  },
  {
    title: '原始伤害',
    dataIndex: 'rawTotal',
    key: 'rawTotal',
    width: 90,
    render: (val: number) => Math.round(val),
  },
  {
    title: '实际伤害',
    dataIndex: 'dealtTotal',
    key: 'dealtTotal',
    width: 90,
    render: (val: number) => Math.round(val),
  },
  {
    title: '占比',
    key: 'percent',
    width: 70,
  },
  {
    title: '命中',
    dataIndex: 'hitCount',
    key: 'hitCount',
    width: 50,
  },
];

// ── 主组件 ──

export function DamageBreakdown({ events }: DamageBreakdownProps) {
  if (events.length === 0) return null;

  const byType = aggregateByType(events);
  const bySource = aggregateBySource(events);
  const grandTotal = byType.reduce((s, t) => s + t.dealtTotal, 0);

  // 给 sourceColumns 的"占比"列注入 grandTotal
  const enrichedSourceColumns = sourceColumns.map((col) =>
    col.key === 'percent'
      ? {
          ...col,
          render: (_: unknown, row: BreakdownBySource) =>
            grandTotal > 0
              ? `${((row.dealtTotal / grandTotal) * 100).toFixed(1)}%`
              : '—',
        }
      : col,
  );

  return (
    <Card size="small" title="分项伤害" style={{ marginTop: 12 }}>
      <Row gutter={12}>
        {/* 按类型汇总 — 紧凑卡片 */}
        <Col span={24} style={{ marginBottom: 8 }}>
          <Space size={8} wrap>
            {byType.map((t) => (
              <Card key={t.damageType} size="small" style={{ minWidth: 130 }}>
                <Tag size="small" color={TYPE_COLOR[t.damageType]} style={{ marginBottom: 4 }}>
                  {TYPE_LABEL[t.damageType]}
                </Tag>
                <div>
                  <Typography.Text bold style={{ fontSize: 16 }}>
                    {Math.round(t.dealtTotal)}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                    / {Math.round(t.rawTotal)} 原始
                  </Typography.Text>
                </div>
                {grandTotal > 0 && (
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    占比 {((t.dealtTotal / grandTotal) * 100).toFixed(1)}%
                  </Typography.Text>
                )}
              </Card>
            ))}
          </Space>
        </Col>

        {/* 按类型明细表 */}
        <Col span={24} style={{ marginBottom: 8 }}>
          <Typography.Text bold style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
            按伤害类型
          </Typography.Text>
          <Table
            size="small"
            columns={typeColumns}
            data={byType.map((t) => ({ ...t, key: t.damageType }))}
            pagination={false}
            border={false}
          />
        </Col>

        {/* 按来源明细表 */}
        <Col span={24}>
          <Typography.Text bold style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
            按伤害来源
          </Typography.Text>
          <Table
            size="small"
            columns={enrichedSourceColumns}
            data={bySource.map((s, i) => ({ ...s, key: `${s.sourceKind}_${s.sourceId}_${s.damageType}_${i}` }))}
            pagination={bySource.length > 20 ? { pageSize: 20 } : false}
            border={false}
          />
        </Col>
      </Row>
    </Card>
  );
}
