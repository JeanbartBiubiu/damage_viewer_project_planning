import { Button, Empty, InputNumber, Space, Typography } from '@arco-design/web-react';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import type { HeroStatsMatrixRow } from './heroStats';

type HeroStatsMatrixEditorProps = {
  rows: HeroStatsMatrixRow[];
  stageMin?: number;
  stageMax?: number;
  stageLabel?: string;
  disabled?: boolean;
  onChange: (rows: HeroStatsMatrixRow[]) => void;
};

export function HeroStatsMatrixEditor({
  rows,
  stageMin = 1,
  stageMax = 18,
  stageLabel = 'Lv',
  disabled = false,
  onChange
}: HeroStatsMatrixEditorProps) {
  const normalizedStageMin = Number.isFinite(stageMin) ? Math.max(1, Math.floor(stageMin)) : 1;
  const normalizedStageMax = Number.isFinite(stageMax)
    ? Math.max(normalizedStageMin, Math.floor(stageMax))
    : 18;
  const stageCount = normalizedStageMax - normalizedStageMin + 1;
  const stages = useMemo(
    () => Array.from({ length: stageCount }, (_, index) => normalizedStageMin + index),
    [normalizedStageMin, stageCount]
  );

  const updateBaseValue = (rowIndex: number, value: number) => {
    onChange(rows.map((row, index) => (index === rowIndex ? { ...row, baseValue: value } : row)));
  };

  const updateStageValue = (rowIndex: number, stageIndex: number, value: number) => {
    onChange(
      rows.map((row, index) => {
        if (index !== rowIndex) {
          return row;
        }
        const nextValues = Array.from({ length: stageCount }, (_, current) => Number(row.levelValues[current] ?? 0));
        nextValues[stageIndex] = value;
        return { ...row, levelValues: nextValues };
      })
    );
  };

  const fillAllRowsBySecondStage = () => {
    if (stageCount < 2) {
      return;
    }
    onChange(
      rows.map((row) => {
        const level1Value = Number(row.levelValues[0] ?? 0);
        const level2Value = Number(row.levelValues[1] ?? 0);
        const delta = level2Value - level1Value;
        const nextValues = Array.from({ length: stageCount }, (_, index) =>
          normalizeProgressionValue(level1Value + delta * index)
        );
        return { ...row, levelValues: nextValues };
      })
    );
  };

  if (rows.length === 0) {
    return <Empty description="暂无属性定义，无法生成矩阵行。" />;
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          每行一个属性，列为 base + {stageLabel}
          {normalizedStageMin}~{stageLabel}
          {normalizedStageMax}。属性行由当前游戏的 attribute definitions 自动展开。
        </Typography.Text>
        <Button
          size="small"
          type="primary"
          disabled={disabled || stageCount < 2}
          onClick={fillAllRowsBySecondStage}
        >
          按{stageLabel}
          {stages[0] ?? normalizedStageMin}
          /{stageLabel}
          {stages[1] ?? normalizedStageMin + 1}
          批量填充全表
        </Button>
      </Space>

      <div style={{ border: '1px solid var(--color-border-2)', borderRadius: 8, overflow: 'auto', maxHeight: 520 }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 320 + stageCount * 120 }}>
          <thead>
            <tr>
              <th style={stickyHeaderCellStyle}>属性</th>
              <th style={headerCellStyle}>base</th>
              {stages.map((stage) => (
                <th key={stage} style={headerCellStyle}>
                  {stageLabel}
                  {stage}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.attrKey}>
                <td style={stickyBodyCellStyle}>
                  <Typography.Text>{row.attrName}</Typography.Text>
                  <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                    {row.attrKey}
                  </Typography.Text>
                </td>
                <td style={bodyCellStyle}>
                  <InputNumber
                    style={{ width: 108 }}
                    value={row.baseValue}
                    disabled={disabled}
                    onChange={(value) => updateBaseValue(rowIndex, Number(value ?? 0))}
                  />
                </td>
                {stages.map((_, stageIndex) => (
                  <td key={stageIndex} style={bodyCellStyle}>
                    <InputNumber
                      style={{ width: 108 }}
                      value={row.levelValues[stageIndex] ?? 0}
                      disabled={disabled}
                      onChange={(value) => updateStageValue(rowIndex, stageIndex, Number(value ?? 0))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Space>
  );
}

const stickyHeaderCellStyle: CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 3,
  background: 'var(--color-fill-2)',
  borderBottom: '1px solid var(--color-border-2)',
  padding: '10px 12px',
  textAlign: 'left',
  minWidth: 260
};

const headerCellStyle: CSSProperties = {
  background: 'var(--color-fill-2)',
  borderBottom: '1px solid var(--color-border-2)',
  padding: '10px 12px',
  textAlign: 'left',
  minWidth: 120
};

const stickyBodyCellStyle: CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  background: 'var(--color-bg-2)',
  borderBottom: '1px solid var(--color-border-2)',
  padding: '8px 12px',
  minWidth: 260
};

const bodyCellStyle: CSSProperties = {
  borderBottom: '1px solid var(--color-border-2)',
  padding: '8px 12px',
  minWidth: 120
};

function normalizeProgressionValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(6));
}
