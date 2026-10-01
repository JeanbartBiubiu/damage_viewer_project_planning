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
    <section className="panel-shell" aria-labelledby="basic-attack-simulation-title">
      <Typography.Title heading={3} id="basic-attack-simulation-title" className="panel-title">
        普攻模拟
      </Typography.Title>
      <Typography.Paragraph>
        当前游戏：{selectedGameId ?? '未选择'}
      </Typography.Paragraph>
      <Alert type="info" content="当前提供真实配置读取与编译验证；单次和连续计算尚未接入。" style={{ marginBottom: 16 }} />
      <BasicAttackCompilePanel apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId}
        adminToken={adminToken} onDirtyChange={onDirtyChange} />
    </section>
  );
}
