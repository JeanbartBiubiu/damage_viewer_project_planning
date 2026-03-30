/**
 * KillThresholdPanel — 斩杀线场景的 ExtraConfigPanel
 *
 * 允许用户配置 HP 搜索范围（minHp / maxHp）和采样数。
 */

import { useCallback } from 'react';
import {
  Card,
  Form,
  Grid,
  InputNumber,
  Tag,
  Typography,
} from '@arco-design/web-react';
import type { ExtraConfigPanelProps } from '../types';

const { Row, Col } = Grid;

export function KillThresholdPanel({ draft, onDraftChange }: ExtraConfigPanelProps) {
  const range = draft.killThresholdRange ?? { minHp: 500, maxHp: 3000 };

  const update = useCallback(
    (patch: Partial<{ minHp: number; maxHp: number }>) => {
      onDraftChange({ killThresholdRange: { ...range, ...patch } });
    },
    [range, onDraftChange],
  );

  const step = (range.maxHp - range.minHp) / 10;

  return (
    <Card
      size="small"
      title={
        <span>
          <Typography.Text bold>斩杀线搜索范围</Typography.Text>{' '}
          <Tag color="orangered" size="small">实验性</Tag>
        </span>
      }
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          11 个采样点，步长 ≈ {Math.round(step)} HP
        </Typography.Text>
      }
    >
      <Form layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item label="最低 HP">
              <InputNumber
                min={1}
                max={range.maxHp - 1}
                step={100}
                value={range.minHp}
                onChange={(val) => update({ minHp: val ?? 500 })}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="最高 HP">
              <InputNumber
                min={range.minHp + 1}
                max={99999}
                step={100}
                value={range.maxHp}
                onChange={(val) => update({ maxHp: val ?? 3000 })}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="采样数">
              <Typography.Text>
                固定 11 点（含首尾）
              </Typography.Text>
            </Form.Item>
          </Col>
        </Row>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          引擎将在 [{range.minHp}, {range.maxHp}] 范围内均匀取 11 个敌方 HP 值运行模拟，
          找到"可击杀"与"不可击杀"的边界。
        </Typography.Text>
      </Form>
    </Card>
  );
}
