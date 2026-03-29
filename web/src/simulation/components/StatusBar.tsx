/**
 * StatusBar — 顶部状态条
 *
 * 显示当前 gameId、versionId、dataHash、bundle 状态、引擎状态。
 */

import { Space, Tag, Typography } from '@arco-design/web-react';
import type { EngineStatus } from '../types';
import type { BundleMeta } from '../../types/api';

type StatusBarProps = {
  bundleMeta: BundleMeta | null;
  bundleStatus: 'idle' | 'loading' | 'ready' | 'error';
  engineStatus: EngineStatus;
  runPhase: string;
};

function statusColor(s: string): string {
  switch (s) {
    case 'ready':
    case 'done':
      return 'green';
    case 'loading':
    case 'compiling':
    case 'running':
      return 'orange';
    case 'error':
      return 'red';
    default:
      return 'gray';
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case 'not-loaded':
      return '未加载';
    case 'loading':
      return '加载中';
    case 'ready':
      return '就绪';
    case 'error':
      return '错误';
    case 'idle':
      return '空闲';
    case 'compiling':
      return '编译中';
    case 'running':
      return '运行中';
    case 'done':
      return '完成';
    default:
      return s;
  }
}

export function StatusBar({ bundleMeta, bundleStatus, engineStatus, runPhase }: StatusBarProps) {
  return (
    <div className="sim-status-bar">
      <Space size={16} wrap>
        <Space size={4}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Game
          </Typography.Text>
          <Typography.Text bold style={{ fontSize: 12 }}>
            {bundleMeta?.gameId ?? '—'}
          </Typography.Text>
        </Space>
        <Space size={4}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Version
          </Typography.Text>
          <Typography.Text bold style={{ fontSize: 12 }}>
            {bundleMeta ? `v${bundleMeta.versionId}` : '—'}
          </Typography.Text>
        </Space>
        <Space size={4}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Hash
          </Typography.Text>
          <Typography.Text style={{ fontSize: 12, fontFamily: 'monospace' }}>
            {bundleMeta?.dataHash?.slice(0, 8) ?? '—'}
          </Typography.Text>
        </Space>
        <Space size={4}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Bundle
          </Typography.Text>
          <Tag size="small" color={statusColor(bundleStatus)}>
            {statusLabel(bundleStatus)}
          </Tag>
        </Space>
        <Space size={4}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            引擎
          </Typography.Text>
          <Tag size="small" color={statusColor(engineStatus)}>
            {statusLabel(engineStatus)}
          </Tag>
        </Space>
        <Space size={4}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            运行
          </Typography.Text>
          <Tag size="small" color={statusColor(runPhase)}>
            {statusLabel(runPhase)}
          </Tag>
        </Space>
      </Space>
    </div>
  );
}
