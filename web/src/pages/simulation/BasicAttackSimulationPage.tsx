import { Alert, Typography } from '@arco-design/web-react';
import { BasicAttackCompilePanel } from './BasicAttackCompilePanel';

export type BasicAttackSimulationPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onDirtyChange: (busy: boolean) => void;
};

export function BasicAttackSimulationPage({ apiBaseUrl, selectedGameId, adminToken, onDirtyChange }: BasicAttackSimulationPageProps) {
  return (
    <section className="panel-shell" style={{ minWidth: 0 }} aria-labelledby="basic-attack-simulation-title">
      <Typography.Title heading={3} id="basic-attack-simulation-title" className="panel-title">
        普攻模拟
      </Typography.Title>
      <Typography.Paragraph>
        当前游戏：{selectedGameId ?? '未选择'}
      </Typography.Paragraph>
      <Alert type="info" content="保留单次／连续普攻；6A新增单条首次主动尝试，固定关闭背景普攻，混合列表及6B／6C尚未开放。完整汇总、有限记录和观察终点分别展示。" style={{ marginBottom: 16 }} />
      <BasicAttackCompilePanel apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId}
        adminToken={adminToken} onDirtyChange={onDirtyChange} />
    </section>
  );
}
