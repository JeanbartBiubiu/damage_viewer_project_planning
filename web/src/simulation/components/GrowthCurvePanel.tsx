/**
 * GrowthCurvePanel — 受限成长曲线场景的 ExtraConfigPanel
 *
 * 允许用户配置扫描维度（等级/装备数量/属性值）、起止范围和步长。
 */

import { useCallback } from 'react';
import {
  Card,
  Form,
  Grid,
  Input,
  InputNumber,
  Select,
  Typography,
} from '@arco-design/web-react';
import type { ExtraConfigPanelProps, SweepDimension } from '../types';

const { Row, Col } = Grid;

const AXIS_OPTIONS = [
  { label: '等级 (Level)', value: 'level' },
  { label: '装备件数 (Item Count)', value: 'item-count' },
  { label: '自定义属性 (Attribute)', value: 'attribute' },
];

/** 各维度的合理默认范围 */
const AXIS_DEFAULTS: Record<string, Omit<SweepDimension, 'axis'>> = {
  level: { from: 1, to: 18, step: 1 },
  'item-count': { from: 0, to: 6, step: 1 },
  attribute: { from: 0, to: 200, step: 20, attrKey: 'ad' },
};

const COMMON_ATTRS = [
  'ad', 'ap', 'armor', 'magic_resist', 'hp', 'attack_speed',
  'crit_chance', 'crit_damage', 'ability_haste', 'lethality',
  'magic_penetration_flat', 'armor_pen_percent',
];

export function GrowthCurvePanel({ draft, onDraftChange }: ExtraConfigPanelProps) {
  const dim: SweepDimension = draft.sweepDimension ?? { axis: 'level', from: 1, to: 18, step: 1 };

  const update = useCallback(
    (patch: Partial<SweepDimension>) => {
      onDraftChange({ sweepDimension: { ...dim, ...patch } });
    },
    [dim, onDraftChange],
  );

  const handleAxisChange = useCallback(
    (axis: string) => {
      const defaults = AXIS_DEFAULTS[axis] ?? AXIS_DEFAULTS['level'];
      onDraftChange({
        sweepDimension: { axis: axis as SweepDimension['axis'], ...defaults },
      });
    },
    [onDraftChange],
  );

  // 计算预览
  const pointCount = dim.step > 0 ? Math.floor((dim.to - dim.from) / dim.step) + 1 : 0;

  return (
    <Card
      size="small"
      title={
        <Typography.Text bold>扫描维度配置</Typography.Text>
      }
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          将生成 {pointCount} 个采样点
        </Typography.Text>
      }
    >
      <Form layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item label="扫描维度">
              <Select
                value={dim.axis}
                onChange={handleAxisChange}
                options={AXIS_OPTIONS}
              />
            </Form.Item>
          </Col>

          {dim.axis === 'attribute' && (
            <Col span={8}>
              <Form.Item label="属性键">
                <Select
                  showSearch
                  allowCreate
                  value={dim.attrKey ?? 'ad'}
                  onChange={(val) => update({ attrKey: val })}
                  placeholder="输入属性键"
                >
                  {COMMON_ATTRS.map((a) => (
                    <Select.Option key={a} value={a}>
                      {a}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          )}
        </Row>

        <Row gutter={12}>
          <Col span={8}>
            <Form.Item label="起始值">
              <InputNumber
                value={dim.from}
                onChange={(val) => update({ from: val ?? 0 })}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="终止值">
              <InputNumber
                value={dim.to}
                onChange={(val) => update({ to: val ?? dim.from + 1 })}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="步长">
              <InputNumber
                min={dim.axis === 'level' || dim.axis === 'item-count' ? 1 : 0.1}
                step={dim.axis === 'attribute' ? 10 : 1}
                value={dim.step}
                onChange={(val) => update({ step: val ?? 1 })}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
        </Row>

        {pointCount > 50 && (
          <Typography.Text type="warning" style={{ fontSize: 12 }}>
            采样点较多（{pointCount}），批量运行可能需要较长时间。
          </Typography.Text>
        )}
      </Form>
    </Card>
  );
}
