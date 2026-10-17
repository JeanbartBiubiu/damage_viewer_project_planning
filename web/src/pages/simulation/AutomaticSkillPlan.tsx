import { Button, Form, InputNumber, Select, Space, Typography } from '@arco-design/web-react';
import type { AutomaticSkillInput, AutomaticSkillInputs } from '../../engine/automaticSkillRequest';
import type { SimulationEntityOption } from './simulationSelectionOptions';

type Draft = Omit<AutomaticSkillInputs, 'durationMs' | 'recordTimeSeries'>;
export function AutomaticSkillPlan({ inputs, options, disabled, backgroundAttack, onEdit, onMove, onOptions }: {
  inputs: Draft; options: SimulationEntityOption[]; disabled: boolean; backgroundAttack: boolean;
  onEdit: (ruleKey: string, patch: Partial<AutomaticSkillInput>) => void;
  onMove: (ruleKey: string, direction: -1 | 1) => void;
  onOptions: <Key extends keyof Draft>(key: Key, value: Draft[Key]) => void;
}) {
  const rules = [...inputs.rules].sort((left, right) => left.sortOrder - right.sortOrder);
  const name = (rule: AutomaticSkillInput) => options.find(option => option.key === rule.skillKey)?.name ?? rule.skillKey;
  return <section aria-label="主动技能自动循环计划">
    <Typography.Paragraph type="secondary">按顺序优先施放已就绪技能，等待中的技能不会阻塞其它独立技能。普通攻击{backgroundAttack ? '已开启' : '已关闭'}。</Typography.Paragraph>
    <div className="combat-rule-list">
      {rules.map((row, index) => <section key={row.ruleKey} className="combat-rule" aria-label={`施放规则 ${row.ruleKey}`}>
        <header className="combat-rule-heading"><strong>{index + 1}. {name(row)}</strong><Space>
          <Button size="mini" aria-label={`上移自动规则 ${row.ruleKey}`} disabled={disabled || index === 0} onClick={() => onMove(row.ruleKey, -1)}>上移</Button>
          <Button size="mini" aria-label={`下移自动规则 ${row.ruleKey}`} disabled={disabled || index === rules.length - 1} onClick={() => onMove(row.ruleKey, 1)}>下移</Button>
        </Space></header>
        <Form layout="vertical" className="combat-rule-fields">
          <Form.Item label="施放目标"><Select aria-label={`自动技能目标 ${row.ruleKey}`} value={row.targetSide} disabled={disabled}
            options={[{ value: 'target', label: '目标方' }, { value: 'source', label: '攻击方自身' }]} onChange={value => onEdit(row.ruleKey, { targetSide: value })} /></Form.Item>
          <Form.Item label="命中方式"><Select aria-label={`自动技能命中预设 ${row.ruleKey}`} value={row.hitPreset ?? undefined} allowClear disabled={disabled}
            placeholder="自身治疗无需命中" options={[{ value: 'TARGET_HIT', label: '尝试命中目标' }, { value: 'MISS', label: '明确未命中' }]}
            onChange={value => onEdit(row.ruleKey, { hitPreset: value ?? null })} /></Form.Item>
          <Form.Item label="等待其它技能冷却"><Select aria-label={`关联冷却 ${row.ruleKey}`} mode="multiple" value={row.waitForCooldowns} disabled={disabled}
            placeholder="不额外等待" options={rules.filter(rule => rule.ruleKey !== row.ruleKey).map(rule => ({ value: rule.ruleKey, label: name(rule) }))}
            onChange={value => onEdit(row.ruleKey, { waitForCooldowns: value })} /></Form.Item>
          <Form.Item label="前置释放资格"><Select aria-label={`前置资格 ${row.ruleKey}`} value={row.releaseAfterRuleKey ?? undefined} allowClear disabled={disabled}
            placeholder="独立施放" options={rules.filter(rule => rule.ruleKey !== row.ruleKey).map(rule => ({ value: rule.ruleKey, label: name(rule),
              disabled: rules.some(other => other.ruleKey !== row.ruleKey && other.releaseAfterRuleKey === rule.ruleKey) }))}
            onChange={value => onEdit(row.ruleKey, { releaseAfterRuleKey: value ?? null })} /></Form.Item>
        </Form>
      </section>)}
      {!rules.length ? <Typography.Paragraph type="secondary">未启用主动技能，将按普通攻击计算。</Typography.Paragraph> : null}
    </div>
    <Typography.Paragraph type="secondary">前置技能完整释放后提供一次资格，后继开始时消费。关闭被引用技能后，需修改关联或重新启用。</Typography.Paragraph>
    {rules.length ? <Form layout="vertical" className="combat-record-options"><div className="combat-rule-fields">
      <Form.Item label="自动记录上限"><InputNumber aria-label="maxAutomaticSkillRecords" min={0} max={4096} precision={0} disabled={disabled}
        value={Number.isFinite(inputs.maxAutomaticSkillRecords) ? inputs.maxAutomaticSkillRecords : undefined} onChange={value => onOptions('maxAutomaticSkillRecords', value ?? NaN)} /></Form.Item>
      <Form.Item label="治疗记录上限"><InputNumber aria-label="自动治疗记录上限" min={0} max={10000} precision={0} disabled={disabled}
        value={Number.isFinite(inputs.maxHealingRecords) ? inputs.maxHealingRecords : undefined} onChange={value => onOptions('maxHealingRecords', value ?? NaN)} /></Form.Item>
      <Form.Item label="结果明细"><Select aria-label="自动结果明细" value={inputs.outputMode} disabled={disabled}
        options={[{ value: 'detailed', label: '详细记录' }, { value: 'summary', label: '只返回汇总' }]} onChange={value => onOptions('outputMode', value)} /></Form.Item>
    </div></Form> : <Typography.Paragraph type="secondary">仅普通攻击时使用详细记录；曲线记录可在计算条件中调整。</Typography.Paragraph>}
  </section>;
}
