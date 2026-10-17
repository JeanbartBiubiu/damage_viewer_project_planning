import { Typography } from '@arco-design/web-react';
import { SimulationScenarioPanel, type SimulationScenarioPanelProps } from './SimulationScenarioPanel';
import './CombatAnalysisPage.css';

export function CombatAnalysisPage(props: Omit<SimulationScenarioPanelProps, 'mode'>) {
  return <section className="panel-shell combat-analysis-page" aria-labelledby="combat-analysis-title">
    <header className="combat-analysis-heading">
      <Typography.Title heading={3} id="combat-analysis-title" className="panel-title">混合战斗分析</Typography.Title>
      <Typography.Paragraph>选择双方角色与装备，调整技能开关和等级，查看整场伤害与生命变化。</Typography.Paragraph>
    </header>
    <SimulationScenarioPanel key="automatic-scenario" mode="automatic" {...props} />
  </section>;
}
