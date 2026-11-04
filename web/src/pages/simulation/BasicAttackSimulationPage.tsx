import { Alert, Button, Typography } from '@arco-design/web-react';
import { COMBAT_ANALYSIS_ROUTE, hashForRoute } from '../../config/navigation';
import { SimulationScenarioPanel, type SimulationScenarioPanelProps } from './SimulationScenarioPanel';

export type BasicAttackSimulationPageProps = Omit<SimulationScenarioPanelProps, 'mode'>;

export function BasicAttackSimulationPage({ apiBaseUrl, selectedGameId, onDirtyChange }: BasicAttackSimulationPageProps) {
  return (
    <section className="panel-shell" style={{ minWidth: 0 }} aria-labelledby="basic-attack-simulation-title">
      <Typography.Title heading={3} id="basic-attack-simulation-title" className="panel-title">
        普攻模拟
      </Typography.Title>
      <Typography.Paragraph>
        当前游戏：{selectedGameId ?? '未选择'}
      </Typography.Paragraph>
      <Alert type="info" content="单次／连续普攻及固定时刻技能计划，可独立开启背景普攻。自动连招、采样曲线及使用与结算联动请进入混合战斗分析。" style={{ marginBottom: 16 }} />
      <Button href={hashForRoute(COMBAT_ANALYSIS_ROUTE)} style={{ marginBottom: 16 }}>进入混合战斗分析（自动循环）</Button>
      <SimulationScenarioPanel key="basic-scenario" mode="basic" apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId}
         onDirtyChange={onDirtyChange} />
    </section>
  );
}
