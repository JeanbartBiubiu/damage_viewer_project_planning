import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import type { FormulaProfilesRecord } from './types';

type FormulaProfilesTableActions = {
  onView: (record: FormulaProfilesRecord) => void;
  onEdit: (record: FormulaProfilesRecord) => void;
};

export function getFormulaProfilesColumns({ onView, onEdit }: FormulaProfilesTableActions) {
  return [
    {
      title: '公式 ID',
      dataIndex: 'formulaId',
      width: 280,
      render: (_: unknown, record: FormulaProfilesRecord) => <Typography.Text code>{record.formulaId}</Typography.Text>
    },
    {
      title: '公式类型',
      dataIndex: 'formulaType',
      width: 140,
      render: (_: unknown, record: FormulaProfilesRecord) => <Tag>{record.formulaType ?? '--'}</Tag>
    },
    {
      title: '公式种类',
      dataIndex: 'formulaKind',
      width: 140,
      render: (_: unknown, record: FormulaProfilesRecord) => record.formulaKind ?? '--'
    },
    {
      title: '说明',
      dataIndex: 'description',
      ellipsis: true,
      render: (_: unknown, record: FormulaProfilesRecord) => record.description ?? '--'
    },
    {
      title: '操作',
      fixed: 'right' as const,
      width: 160,
      align: 'center' as const,
      render: (_: unknown, record: FormulaProfilesRecord) => (
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
