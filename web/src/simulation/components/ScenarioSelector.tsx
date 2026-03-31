/**
 * ScenarioSelector — 场景模板选择区
 *
 * 展示所有场景模板卡片，支持点击切换。
 */

import { Card, Space, Tag, Typography } from '@arco-design/web-react';
import type { ScenarioId, ScenarioStatus } from '../types';
import { getAllTemplates } from '../scenarios';

type ScenarioSelectorProps = {
  selectedId: ScenarioId;
  onSelect: (id: ScenarioId) => void;
};

function statusTag(status: ScenarioStatus) {
  switch (status) {
    case 'stable':
      return (
        <Tag size="small" color="green">
          稳定
        </Tag>
      );
    case 'experimental':
      return (
        <Tag size="small" color="orange">
          实验性
        </Tag>
      );
    case 'disabled':
      return (
        <Tag size="small" color="gray">
          未开放
        </Tag>
      );
  }
}

export function ScenarioSelector({ selectedId, onSelect }: ScenarioSelectorProps) {
  const templates = getAllTemplates();

  return (
    <div className="sim-scenario-selector">
      <Typography.Title heading={6} style={{ marginBottom: 8 }}>
        场景模板
      </Typography.Title>
      <Space wrap size={8}>
        {templates.map((t) => (
          <Card
            key={t.id}
            hoverable
            size="small"
            className={`sim-scenario-card${t.id === selectedId ? ' is-active' : ''}${t.status === 'disabled' ? ' is-disabled' : ''}`}
            style={{
              width: 180,
              cursor: t.status === 'disabled' ? 'not-allowed' : 'pointer',
              borderColor: t.id === selectedId ? 'var(--color-primary-6, #165dff)' : undefined,
            }}
            onClick={() => {
              if (t.status !== 'disabled') {
                onSelect(t.id);
              }
            }}
          >
            <Space direction="vertical" size={4}>
              <Space size={6} align="center">
                <Typography.Text bold>{t.title}</Typography.Text>
                {statusTag(t.status)}
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t.description}
              </Typography.Text>
            </Space>
          </Card>
        ))}
      </Space>
    </div>
  );
}
