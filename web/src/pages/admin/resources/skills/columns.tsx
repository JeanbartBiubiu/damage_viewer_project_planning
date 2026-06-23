import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { inferSkillShapeSummary } from '../../../../components/skill-editor/skillModels';
import type { SkillsRecord } from './types';

type SkillsTableActions = {
  onView: (record: SkillsRecord) => void;
  onEdit: (record: SkillsRecord) => void;
};

const SHAPE_LABELS: Record<string, string> = {
  Mixed: '混合',
  DSL: 'DSL',
  Flat: '平铺'
};

export function formatShapeLabel(summary: string): string {
  return SHAPE_LABELS[summary] ?? summary;
}

export function shapeTagColor(summary: string): string {
  return summary === 'Mixed' ? 'orangered' : summary === 'DSL' ? 'arcoblue' : summary === 'Flat' ? 'purple' : 'gray';
}

export function getSkillsColumns({ onView, onEdit }: SkillsTableActions): TableColumnProps<SkillsRecord>[] {
  return [
    {
      title: '技能 ID',
      dataIndex: 'skillId',
      width: 220,
      render: (_, record) => <Typography.Text code>{record.skillId}</Typography.Text>
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: 180,
      ellipsis: true,
      render: (_, record) => record.name ?? '—'
    },
    {
      title: '所有者类型',
      dataIndex: 'ownerType',
      width: 140,
      render: (_, record) => record.ownerType ?? '—'
    },
    {
      title: '所有者 ID',
      dataIndex: 'ownerId',
      width: 220,
      render: (_, record) => record.ownerId ?? '—'
    },
    {
      title: '技能 Key',
      dataIndex: 'skillKey',
      width: 120,
      render: (_, record) => record.skillKey ?? '—'
    },
    {
      title: '模型',
      key: 'shape',
      width: 100,
      render: (_, record) => {
        // 列表摘要；modal 内会基于实时 formData 重新推断，两处用途独立，不共享缓存。
        const summary = inferSkillShapeSummary(record.params, record.mechanicsConfig);
        return <Tag color={shapeTagColor(summary)}>{formatShapeLabel(summary)}</Tag>;
      }
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 160,
      align: 'center',
      render: (_, record) => (
        <Space>
          <Button size="mini" onClick={() => onView(record)}>
            查看
          </Button>
          <Button type="primary" size="mini" onClick={() => onEdit(record)}>
            编辑
          </Button>
        </Space>
      )
    }
  ];
}
