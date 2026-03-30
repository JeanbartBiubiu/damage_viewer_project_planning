/**
 * ItemComparePanel — 装备对比场景的 ExtraConfigPanel
 *
 * 允许用户管理多个装备变体方案：添加、编辑标签、选择装备、删除。
 * 至少保留一个"基线"方案（当前装备）。
 */

import { useCallback } from 'react';
import {
  Button,
  Card,
  Grid,
  Input,
  Select,
  Space,
  Tag,
  Typography,
} from '@arco-design/web-react';
import { IconPlus, IconDelete, IconCopy } from '@arco-design/web-react/icon';
import type { ExtraConfigPanelProps, ItemVariant } from '../types';
import type { Item } from '../../types/api';

const { Row, Col } = Grid;

let variantSeq = 0;

function nextKey(): string {
  return `variant_${++variantSeq}_${Date.now()}`;
}

export function ItemComparePanel({ draft, onDraftChange, bundle }: ExtraConfigPanelProps) {
  const variants: ItemVariant[] = draft.itemVariants ?? [];

  const itemOptions = bundle.items.map((i: Item) => ({
    label: i.name ?? i.itemId,
    value: i.itemId,
  }));

  const updateVariants = useCallback(
    (next: ItemVariant[]) => onDraftChange({ itemVariants: next }),
    [onDraftChange],
  );

  const addVariant = useCallback(() => {
    updateVariants([
      ...variants,
      {
        key: nextKey(),
        label: `方案 ${variants.length + 1}`,
        itemIds: [...draft.self.itemIds],
      },
    ]);
  }, [variants, draft.self.itemIds, updateVariants]);

  const duplicateVariant = useCallback(
    (idx: number) => {
      const src = variants[idx];
      const copy: ItemVariant = {
        key: nextKey(),
        label: `${src.label} (复制)`,
        itemIds: [...src.itemIds],
      };
      const next = [...variants];
      next.splice(idx + 1, 0, copy);
      updateVariants(next);
    },
    [variants, updateVariants],
  );

  const removeVariant = useCallback(
    (idx: number) => {
      if (variants.length <= 1) return;
      updateVariants(variants.filter((_, i) => i !== idx));
    },
    [variants, updateVariants],
  );

  const updateLabel = useCallback(
    (idx: number, label: string) => {
      const next = variants.map((v, i) => (i === idx ? { ...v, label } : v));
      updateVariants(next);
    },
    [variants, updateVariants],
  );

  const updateItemIds = useCallback(
    (idx: number, itemIds: string[]) => {
      const next = variants.map((v, i) => (i === idx ? { ...v, itemIds } : v));
      updateVariants(next);
    },
    [variants, updateVariants],
  );

  // 确保启动时至少有一个方案
  if (variants.length === 0) {
    // 自动初始化：基线=当前装备
    const init: ItemVariant[] = [
      { key: 'baseline', label: '基线（当前装备）', itemIds: [...draft.self.itemIds] },
    ];
    // 延迟更新避免 render 中直接 setState
    setTimeout(() => updateVariants(init), 0);
  }

  return (
    <Card
      size="small"
      title={
        <Space>
          <Typography.Text bold>装备变体方案</Typography.Text>
          <Tag color="arcoblue" size="small">
            {variants.length} 个方案
          </Tag>
        </Space>
      }
      extra={
        <Button type="primary" size="mini" icon={<IconPlus />} onClick={addVariant}>
          添加方案
        </Button>
      }
    >
      {variants.map((v, idx) => (
        <div
          key={v.key}
          style={{
            padding: '8px 0',
            borderBottom: idx < variants.length - 1 ? '1px solid var(--color-border)' : undefined,
          }}
        >
          <Row gutter={8} align="center">
            <Col flex="120px">
              <Input
                size="small"
                value={v.label}
                onChange={(val) => updateLabel(idx, val)}
                placeholder="方案名称"
              />
            </Col>
            <Col flex="auto">
              <Select
                mode="multiple"
                size="small"
                placeholder="选择装备"
                value={v.itemIds}
                onChange={(val) => updateItemIds(idx, val ?? [])}
                options={itemOptions}
                allowClear
                maxTagCount={4}
                style={{ width: '100%' }}
              />
            </Col>
            <Col flex="64px">
              <Space size={2}>
                <Button
                  size="mini"
                  type="text"
                  icon={<IconCopy />}
                  onClick={() => duplicateVariant(idx)}
                />
                <Button
                  size="mini"
                  type="text"
                  status="danger"
                  icon={<IconDelete />}
                  disabled={variants.length <= 1}
                  onClick={() => removeVariant(idx)}
                />
              </Space>
            </Col>
          </Row>
        </div>
      ))}

      {variants.length === 0 && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          点击"添加方案"创建第一个装备变体。
        </Typography.Text>
      )}
    </Card>
  );
}
