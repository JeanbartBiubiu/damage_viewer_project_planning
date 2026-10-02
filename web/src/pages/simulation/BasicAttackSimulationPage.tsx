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
      <Alert type="info" content="读取真实配置后可执行单次或连续普攻。连续结果提供只读采样图、逐刀与伤害明细；完整汇总、有限记录和采样观察分别展示。" style={{ marginBottom: 16 }} />
      <BasicAttackCompilePanel apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId}
        adminToken={adminToken} onDirtyChange={onDirtyChange} />
    </section>
  );
}
