import { Alert, Button, Table, Typography } from '@arco-design/web-react';
import type { DoneResult, ResourceChangeRecord } from '../../types/genericEngine';
import { formatContinuousAmount as number } from '../../engine/continuousAttackPresentation';
const reasons = { apply: '施加', refresh: '刷新', remove: '移除', expire: '到期' };

/** 资源增减与治疗分开；曲线直接采用原生当前生命，不重算或插值。 */
export function ResourceChangeFacts({ done, range, onSelect }: { done: DoneResult; range: [number, number]; onSelect?: (row: ResourceChangeRecord) => void }) {
  if (!done.resourceChangeSummary) return null;
  const summary = done.resourceChangeSummary;
  const rows = (done.resourceChangeRecords ?? []).filter(row => row.timeMs >= range[0] && row.timeMs <= range[1]);
  return <section aria-label="资源生命变化">
    <Typography.Title heading={6}>生命上限与当前生命的独立变化</Typography.Title>
    {(['source', 'target'] as const).map(side => <Typography.Paragraph key={side}>{side === 'source' ? 'A' : 'B'}：
      当前生命增加{number(summary[side].currentIncrease)}、减少{number(summary[side].currentDecrease)}；
      上限增加{number(summary[side].maxIncrease)}、减少{number(summary[side].maxDecrease)}；最终上限{number(summary[side].finalMax)}。
    </Typography.Paragraph>)}
    <Alert type={done.recording?.resourceChangeRecordsTruncated ? 'warning' : 'info'} content={done.outputMode === 'summary'
      ? `汇总模式未请求资源明细；完整变更${summary.changeCount}次，累计仍保留。`
      : `资源变更返回${done.recording?.returnedResourceChangeRecords}／总计${summary.changeCount}，预算丢弃${done.recording?.droppedResourceChangeRecords}。这些变化不计作治疗或伤害。`} />
    <Table data={rows} rowKey="healthOrder" pagination={{ pageSize: 10 }} scroll={{ x: 1000 }} columns={[
      { title: '生命事实顺序', dataIndex: 'healthOrder' }, { title: '实际时刻', dataIndex: 'timeMs' }, { title: '对象', render: (_, row) => row.target === 'source' ? 'A' : 'B' },
      { title: '当前生命变化', render: (_, row) => `${number(row.currentBefore)} → ${number(row.currentAfter)}（${number(row.currentDelta)}）` },
      { title: '生命上限变化', render: (_, row) => `${number(row.maxBefore)} → ${number(row.maxAfter)}（${number(row.maxDelta)}）` },
      { title: '真实贡献', render: (_, row) => row.contributors.map(contributor => `${contributor.definitionRef}/${contributor.modifierKey} · ${reasons[contributor.reason]}`).join('；') },
      ...(onSelect ? [{ title: '查看', render: (_: unknown, row: ResourceChangeRecord) => <Button size="small" onClick={() => onSelect(row)}>查看资源变化{row.healthOrder}</Button> }] : [])
    ]} />
  </section>;
}
