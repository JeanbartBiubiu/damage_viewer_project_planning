import { Alert, Button, Table, Typography } from '@arco-design/web-react';
import type { ContinuousAttackAssessment } from '../../engine/continuousAttackResult';
import type { WarningItem } from '../../types/genericEngine';

const stops: Record<string, string> = {
  duration_reached: '已观察到指定终点', target_dead: '目标生命归零', budget_exceeded: '执行预算停止',
  source_dead: '攻击方死亡', both_dead: '双方死亡', no_events: '没有后续事件'
};
const budgets: Record<string, string> = {
  max_events: '战斗事件', max_commands_per_event: '同刀命令', max_chain_depth: '同步调用深度',
  max_queue_events: '待处理事件', max_process_instances: '过程实例', max_skill_hits: '原生命中',
  max_basic_attacks: '普攻次数', max_use_trigger_ledger: '同次使用触发账本'
};
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 6 });

export function ContinuousAttackResult({ assessment, cleanupLabel, released, warnings, onDownload }: {
  assessment: ContinuousAttackAssessment | null; cleanupLabel: string; released: boolean;
  warnings: WarningItem[]; onDownload: () => void;
}) {
  const result = assessment;
  const title = !result ? '引擎或结果校验错误，尚无有效结果' : !result.complete ? '计算未完整验证'
    : result.execution.targetKilled ? '已完整击杀目标' : '已完整观察，目标未被击杀';
  const values = result ? [
    ['completed-count', '完整完成刀数', result.completedCount], ['started-count', '真实开始次数', result.startedCount],
    ['hit-count', '真实命中次数', result.hitCount], ['damage-dealt', '造成伤害', result.damageDealt],
    ['hp-loss', '目标实际扣血', result.hpLoss], ['source-final-hp', '攻击方最终生命', result.sourceFinalHp],
    ['target-final-hp', '目标最终生命', result.targetFinalHp], ['requested-duration', '指定观察时长（毫秒）', result.execution.requestedDurationMs],
    ['duration', '实际停止时刻（毫秒）', result.durationMs]
  ].map(([key, label, value]) => ({ key: String(key), label: String(label), value: value as number })) : [];
  return <section aria-label="连续普攻结果">
    <Typography.Title heading={5}>连续普攻结果</Typography.Title>
    <Alert type={result?.complete && released ? 'success' : 'warning'} content={title} />
    {result ? <>
      <Table data={values} rowKey="key" pagination={false} columns={[
        { title: '指标', dataIndex: 'label' },
        { title: '本次数值', render: (_, row) => <span data-testid={`continuous-attack-${row.key}`}>{number(row.value)}</span> }
      ]} />
      <Typography.Paragraph style={{ marginTop: 12 }}>
        击杀事实：{result.execution.targetKilled ? '已击杀' : '未击杀'}；
        击杀时刻：<span data-testid="continuous-attack-killed-at">{result.execution.targetKilledAtMs === null ? '未发生' : `${result.execution.targetKilledAtMs} 毫秒`}</span>；
        停止原因：{stops[result.stopReason] ?? result.stopReason}。计算完整性：{result.complete ? '完整' : '未完整验证'}。
        {result.execution.incompleteReason ? `未完成原因：${result.execution.incompleteReason === 'unfinished_tail' ? '同步尾部未完成' : '达成目标前预算耗尽'}。` : ''}
        {result.execution.budgetCause ? `预算原因：${budgets[result.execution.budgetCause] ?? result.execution.budgetCause}。` : ''}
      </Typography.Paragraph>
      {result.issues.length ? <Alert type="warning" content={result.issues.join('；')} /> : null}
      {result.recording.attackRecordsTruncated || result.recording.damageRecordsTruncated ? <Alert type="warning"
        content={`明细不完整：攻击记录丢弃${result.recording.droppedAttackRecords}条，伤害记录丢弃${result.recording.droppedDamageRecords}条；完整汇总独立于记录预算。`} /> : null}
      <details style={{ marginTop: 12 }}>
        <summary>逐刀事实（保留{result.recording.returnedAttackRecords}／{result.recording.attackRecordCount}条）</summary>
        <Table data={result.attackRecords} rowKey="attackIndex" pagination={{ pageSize: 10, sizeCanChange: false }} scroll={{ x: 1000 }} columns={[
          { title: '刀数', dataIndex: 'attackIndex' }, { title: '使用身份', dataIndex: 'useRef' },
          { title: '开始（毫秒）', dataIndex: 'startAtMs' },
          { title: '命中（毫秒）', render: (_, row) => row.hitAtMs ?? '未发生' },
          { title: '冷却就绪（毫秒）', render: (_, row) => row.readyAtMs ?? '未提交' },
          { title: '造成伤害', render: (_, row) => number(row.postDefenseDamage) },
          { title: '实际扣血', render: (_, row) => number(row.actualHpLoss) },
          { title: '目标剩余生命', render: (_, row) => number(row.targetHpAfter) },
          { title: '尾部完成', render: (_, row) => row.completed ? '是' : '否' }
        ]} />
      </details>
      <details style={{ marginTop: 12 }}>
        <summary>伤害事实（保留{result.recording.returnedDamageRecords}／{result.recording.damageRecordCount}条）</summary>
        <Table data={result.damageRecords} rowKey="damageId" pagination={{ pageSize: 10, sizeCanChange: false }} scroll={{ x: 1100 }} columns={[
          { title: '刀数', dataIndex: 'attackIndex' }, { title: '时刻（毫秒）', dataIndex: 'timeMs' },
          { title: '作者结果', dataIndex: 'operationRef' }, { title: '伤害类型', dataIndex: 'damageType' },
          { title: '造成伤害', render: (_, row) => number(row.postDefenseDamage) },
          { title: '实际扣血', render: (_, row) => number(row.actualHpLoss) },
          { title: '过量伤害', render: (_, row) => number(row.overkillDamage) }
        ]} />
      </details>
    </> : <Typography.Paragraph>没有可解释的运行结果，错误不会显示为0伤害。</Typography.Paragraph>}
    <Typography.Paragraph style={{ marginTop: 12 }}>清理状态：{cleanupLabel}。</Typography.Paragraph>
    {!released && result ? <Alert type="warning" content="运行事实已保留；会话未正常释放，整体任务未成功。" /> : null}
    {warnings.length ? <Alert type="warning" content={warnings.map(row => `${row.code}：${row.message}`).join('；')} /> : null}
    <Typography.Paragraph type="secondary">造成伤害为防御后、护盾前金额；实际扣血由原生结算独立累计。击杀时刻采用期望单击模型。</Typography.Paragraph>
    <Button onClick={onDownload}>下载连续运行档案</Button>
  </section>;
}
