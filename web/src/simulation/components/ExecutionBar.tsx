/**
 * ExecutionBar — 执行控制条
 *
 * 提供：运行、停止、重置引擎等按钮。
 */

import { Button, Space, Typography } from '@arco-design/web-react';
import type { RunPhase } from '../types';

type ExecutionBarProps = {
  runPhase: RunPhase;
  variantCount: number;
  completedCount: number;
  onRun: () => void;
  onStop: () => void;
  onResetEngine: () => void;
  onResetDraft: () => void;
};

export function ExecutionBar({
  runPhase,
  variantCount,
  completedCount,
  onRun,
  onStop,
  onResetEngine,
  onResetDraft,
}: ExecutionBarProps) {
  const isRunning = runPhase === 'running' || runPhase === 'compiling';
  const progressText =
    isRunning && variantCount > 1
      ? `${completedCount} / ${variantCount}`
      : '';

  return (
    <div className="sim-execution-bar">
      <Space size={8}>
        <Button
          type="primary"
          loading={isRunning}
          disabled={isRunning}
          onClick={onRun}
        >
          {isRunning ? '运行中…' : '运行模拟'}
        </Button>

        {isRunning && (
          <Button status="warning" onClick={onStop}>
            停止后续
          </Button>
        )}

        <Button onClick={onResetDraft}>重置配置</Button>
        <Button onClick={onResetEngine} type="secondary">
          重置引擎
        </Button>

        {progressText && (
          <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
            进度: {progressText}
          </Typography.Text>
        )}

        {runPhase === 'error' && (
          <Typography.Text type="error" style={{ fontSize: 12 }}>
            运行出错
          </Typography.Text>
        )}
      </Space>
    </div>
  );
}
