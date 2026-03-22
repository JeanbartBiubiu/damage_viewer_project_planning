import type { ReactNode } from 'react';
import { Table } from '@arco-design/web-react';

type DataTableProps = {
  columns: string[];
  rows: ReactNode[][];
  emptyMessage?: string;
};

type DataRow = {
  key: string;
  cells: ReactNode[];
};

export function DataTable({ columns, rows, emptyMessage = '暂无数据' }: DataTableProps) {
  if (rows.length === 0) {
    return <div className="table-empty">{emptyMessage}</div>;
  }

  const data: DataRow[] = rows.map((cells, rowIndex) => ({
    key: `row-${rowIndex}`,
    cells
  }));

  const tableColumns = columns.map((title, columnIndex) => ({
    title,
    render: (_: unknown, record: DataRow) => record.cells[columnIndex]
  }));

  return (
    <Table
      className="data-table-shell"
      columns={tableColumns}
      data={data}
      pagination={false}
      rowKey="key"
      scroll={{ x: '100%' }}
    />
  );
}
