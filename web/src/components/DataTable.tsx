import type { ReactNode } from 'react';

type DataTableProps = {
  columns: string[];
  rows: ReactNode[][];
  emptyMessage?: string;
};

export function DataTable({ columns, rows, emptyMessage = '暂无数据。' }: DataTableProps) {
  if (rows.length === 0) {
    return <div className="empty-inline">{emptyMessage}</div>;
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
