import { Form, InputNumber, Typography } from '@arco-design/web-react';
import type { SimulationMechanicRequirement } from '../../engine/simulationPrimaryAttack';
import { mechanicStateIdentity } from '../../engine/simulationPrimaryAttack';
import { mechanicDraftValue, type SimulationMechanicDrafts } from './simulationMechanicDrafts';

export function SimulationMechanicInputs({ requirements, drafts, disabled, onChange }: {
  requirements: SimulationMechanicRequirement[]; drafts: SimulationMechanicDrafts; disabled: boolean;
  onChange: (identity: string, value: number | undefined) => void;
}) {
  if (!requirements.length) return null;
  return <section aria-label="机制初值">
    <Typography.Title heading={5}>机制初值</Typography.Title>
    <Typography.Paragraph>只设置实际开启普攻主体的弹药。未覆盖时使用保存的声明初值；0表示空弹，清空后必须重新填写，不自动补满。</Typography.Paragraph>
    <Form layout="vertical">
      {requirements.map(requirement => <Form.Item key={mechanicStateIdentity(requirement)} label={`${requirement.skillName}／${requirement.name}初值`} required>
        <InputNumber aria-label={`${requirement.skillName}／${requirement.name}初值`} value={mechanicDraftValue(requirement, drafts)} disabled={disabled}
          onChange={value => onChange(mechanicStateIdentity(requirement), value)} />
        <Typography.Text type="secondary">整数0～{requirement.maxValue}；保存的初值：{requirement.initialValue}。恢复和消费由原生执行。</Typography.Text>
      </Form.Item>)}
    </Form>
  </section>;
}
