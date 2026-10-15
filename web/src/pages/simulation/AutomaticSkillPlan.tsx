import { Button, Form, InputNumber, Select, Space, Table, Typography } from '@arco-design/web-react';
import type { AutomaticSkillInput, AutomaticSkillInputs } from '../../engine/automaticSkillRequest';
import type { SimulationEntityOption } from './simulationSelectionOptions';

type Draft = Omit<AutomaticSkillInputs, 'durationMs' | 'recordTimeSeries'>;
export function AutomaticSkillPlan({ inputs, options, disabled, backgroundAttack, onSelectSkill, onEdit, onMove, onRemove, onOptions }: {
  inputs: Draft; options: SimulationEntityOption[]; disabled: boolean; backgroundAttack: boolean;
  onSelectSkill: (skillKey: string, ruleKey: string) => void;
  onEdit: (ruleKey: string, patch: Partial<AutomaticSkillInput>) => void;
  onMove: (ruleKey: string, direction: -1 | 1) => void; onRemove: (ruleKey: string) => void;
  onOptions: <Key extends keyof Draft>(key: Key, value: Draft[Key]) => void;
}) {
  const rules = [...inputs.rules].sort((left, right) => left.sortOrder - right.sortOrder);
  const label = (rule: AutomaticSkillInput) => `${options.find(option => option.key === rule.skillKey)?.name ?? rule.skillKey}（${rule.ruleKey}）`;
  return <section aria-label="主动技能自动循环计划">
    <Typography.Title heading={5}>自动循环：最多16项真实主动技能</Typography.Title>
    <Typography.Paragraph>背景普攻{backgroundAttack ? '明确开启' : '关闭'}。从前往后选择已经就绪的技能，前项等待不阻塞独立后项。
      关联只等待实际冷却；来源完整释放后授予后继一份资格，后继成功开始就消费，开始后的失败不退还。
      已有资格最多保留1份，来源仍可依自身条件继续施放。单步骤即时或有限延时首次过程由原生运行。</Typography.Paragraph>
    <Table<AutomaticSkillInput> data={rules} rowKey="ruleKey" pagination={false} scroll={{ x: 1350 }} columns={[
      { title: '优先顺序', render: (_, row) => <Space direction="vertical"><Typography.Text>{row.sortOrder + 1} · {row.ruleKey}</Typography.Text>
        <Space><Button aria-label={`上移自动规则 ${row.ruleKey}`} disabled={disabled || rules[0]?.ruleKey === row.ruleKey} onClick={() => onMove(row.ruleKey, -1)}>上移</Button>
          <Button aria-label={`下移自动规则 ${row.ruleKey}`} disabled={disabled || rules[rules.length - 1]?.ruleKey === row.ruleKey} onClick={() => onMove(row.ruleKey, 1)}>下移</Button></Space></Space> },
      { title: '技能／等级', render: (_, row) => {
        const option = options.find(option => option.key === row.skillKey);
        return <Space direction="vertical"><Select aria-label={`自动技能 ${row.ruleKey}`} value={row.skillKey} disabled={disabled}
          options={options.map(option => ({ value: option.key, label: `${option.name}（${option.key}）`, disabled: rules.some(rule => rule.ruleKey !== row.ruleKey && rule.skillKey === option.key) }))}
          onChange={value => onSelectSkill(value, row.ruleKey)} />
          <Select aria-label={`自动技能等级 ${row.ruleKey}`} value={Number.isFinite(row.skillLevel) ? row.skillLevel : undefined} allowClear disabled={disabled}
            options={option?.kind === 'skill' ? Array.from({ length: option.maxLevel }, (_, index) => ({ value: index + 1, label: `等级${index + 1}` })) : []}
            onChange={value => onEdit(row.ruleKey, { skillLevel: value ?? NaN })} /></Space>;
      } },
      { title: '目标', render: (_, row) => <Select aria-label={`自动技能目标 ${row.ruleKey}`} value={row.targetSide} disabled={disabled}
        options={[{ value: 'target', label: '唯一目标' }, { value: 'source', label: '攻击方自身' }]} onChange={value => onEdit(row.ruleKey, { targetSide: value })} /> },
      { title: '明确命中预设', render: (_, row) => <Select aria-label={`自动技能命中预设 ${row.ruleKey}`} value={row.hitPreset ?? undefined} allowClear disabled={disabled}
        placeholder="自身治疗保持空值" options={[{ value: 'TARGET_HIT', label: '释放后尝试命中唯一目标' }, { value: 'MISS', label: '明确未命中' }]}
        onChange={value => onEdit(row.ruleKey, { hitPreset: value ?? null })} /> },
      { title: '等待其它技能冷却', render: (_, row) => <Select aria-label={`关联冷却 ${row.ruleKey}`} mode="multiple" value={row.waitForCooldowns} disabled={disabled}
        placeholder="全部冷却就绪才施放" options={rules.filter(rule => rule.ruleKey !== row.ruleKey).map(rule => ({ value: rule.ruleKey, label: label(rule) }))}
        onChange={value => onEdit(row.ruleKey, { waitForCooldowns: value })} /> },
      { title: '释放资格来源', render: (_, row) => <Select aria-label={`前置资格 ${row.ruleKey}`} value={row.releaseAfterRuleKey ?? undefined} allowClear disabled={disabled}
        placeholder="独立技能，无前置资格" options={rules.filter(rule => rule.ruleKey !== row.ruleKey).map(rule => ({ value: rule.ruleKey, label: label(rule),
          disabled: rules.some(other => other.ruleKey !== row.ruleKey && other.releaseAfterRuleKey === rule.ruleKey) }))}
        onChange={value => onEdit(row.ruleKey, { releaseAfterRuleKey: value ?? null })} /> },
      { title: '编辑', render: (_, row) => <Button aria-label={`删除自动规则 ${row.ruleKey}`} disabled={disabled} onClick={() => onRemove(row.ruleKey)}>删除</Button> }
    ]} />
    <Typography.Paragraph type="secondary">自身冷却始终检查。关联冷却不会继承对方资格；多项关联都须明确选择。每项至多一份前置与一项后继，支持多条独立链及最长16项的连续链。删除、关闭或清空被引用来源后须明确修正关系，失败草稿保留。</Typography.Paragraph>
    <Form layout="vertical"><div className="simulation-selection-grid">
      <Form.Item label="自动记录上限" required><InputNumber aria-label="maxAutomaticSkillRecords" min={0} max={4096} precision={0} disabled={disabled}
        value={Number.isFinite(inputs.maxAutomaticSkillRecords) ? inputs.maxAutomaticSkillRecords : undefined} onChange={value => onOptions('maxAutomaticSkillRecords', value ?? NaN)} /></Form.Item>
      <Form.Item label="治疗记录上限" required><InputNumber aria-label="自动治疗记录上限" min={0} max={10000} precision={0} disabled={disabled}
        value={Number.isFinite(inputs.maxHealingRecords) ? inputs.maxHealingRecords : undefined} onChange={value => onOptions('maxHealingRecords', value ?? NaN)} /></Form.Item>
      <Form.Item label="结果明细"><Select aria-label="自动结果明细" value={inputs.outputMode} disabled={disabled}
        options={[{ value: 'detailed', label: '详细记录（有界保留）' }, { value: 'summary', label: '只返回完整汇总' }]} onChange={value => onOptions('outputMode', value)} /></Form.Item>
    </div></Form>
    <Typography.Text type="secondary">自动记录只保留事实与等待状态变化；设为0或选择汇总仍保留完整累计、最后等待状态和资格账本。曲线采样独立。</Typography.Text>
  </section>;
}
