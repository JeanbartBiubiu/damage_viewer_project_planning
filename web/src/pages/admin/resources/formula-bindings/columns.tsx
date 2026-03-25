import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import type { FormulaBindingsRecord } from './types';

type FormulaBindingsTableActions = {
  onView: (record: FormulaBindingsRecord) => void;
  onEdit: (record: FormulaBindingsRecord) => void;
};

export function getFormulaBindingsColumns({ onView, onEdit }: FormulaBindingsTableActions) {
  return [
    {
      title: 'bindingKey',
      dataIndex: 'bindingKey',
      width: 220,
      render: (_: unknown, record: FormulaBindingsRecord) => <Typography.Text code>{record.bindingKey}</Typography.Text>
    },
    {
      title: '目标分类',
      dataIndex: 'targetCategory',
      width: 140,
      render: (_: unknown, record: FormulaBindingsRecord) => <Tag>{record.targetCategory}</Tag>
    },
    {
      title: '目标 ID',
      dataIndex: 'targetId',
      width: 220,
      render: (_: unknown, record: FormulaBindingsRecord) => record.targetId
    },
    {
      title: '公式 ID',
      dataIndex: 'formulaId',
      width: 260,
      render: (_: unknown, record: FormulaBindingsRecord) => record.formulaId
    },
    {
      title: '操作',
      fixed: 'right' as const,
      width: 160,
      align: 'center' as const,
      render: (_: unknown, record: FormulaBindingsRecord) => (
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
