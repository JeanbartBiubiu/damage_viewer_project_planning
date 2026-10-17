import { Alert, Button, Space, Table, Typography } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import type { AutomaticSkillWaitingReason } from '../../types/genericEngine';
import type { AutomaticSkillArchive } from './SimulationScenarioPanel';
import { buildAutomaticSkillArchive } from '../../engine/continuousAttackArchive';
import { initialAutomaticSkillView } from '../../engine/automaticSkillPresentation';
import { formatContinuousAmount as number } from '../../engine/continuousAttackPresentation';
import { AUTOMATIC_SKILL_WAIT_REASON_LABELS } from '../../types/skillSystemEnums.generated';
import { AutomaticSkillAnalysis } from './AutomaticSkillAnalysis';
import './AutomaticSkillAnalysis.css';

const waitingLabels: Record<AutomaticSkillWaitingReason, string> = AUTOMATIC_SKILL_WAIT_REASON_LABELS;
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
export function AutomaticSkillResult({ archive, stale }: { archive: AutomaticSkillArchive; stale: boolean }) {
  const done = archive.runResult;
  const [view, setView] = useState(() => initialAutomaticSkillView(done?.summary.durationMs ?? 0));
  useEffect(() => { setView(initialAutomaticSkillView(done?.summary.durationMs ?? 0)); }, [done]);
  const automatic = done?.automaticSkillSummary;
  const downloadArchive = () => download('automatic-skill-archive.json', buildAutomaticSkillArchive(archive, view));
  if (!done || !automatic) return <section aria-label="自动技能结果"><Alert type="warning" content="尚无完整自动结果；冻结档案保留失败及会话清理状态。" />
    {archive.assessment?.issues.length ? <Alert type="error" content={archive.assessment.issues.join('；')} /> : null}
    <Button onClick={downloadArchive}>下载自动冻结档案</Button></section>;
  if (!archive.assessment?.factsValid) return <section aria-label="自动技能结果">
    <Alert type="error" content={`自动结果协议或真实事实未通过核对：${archive.assessment?.issues.join('；') ?? '缺少结果核对'}。不能作为当前场景结果。`} />
    <Typography.Paragraph>会话{archive.cleanup === 'released' ? '已正常释放' : '未正常释放'}；失败请求与输入草稿保留。</Typography.Paragraph>
    <Button onClick={downloadArchive}>下载自动冻结档案</Button>
  </section>;
  const summary = done.summary;
  const rules = archive.runRequest?.driverPlan.automaticSkills?.rules ?? [];
  const name = (ruleKey: string) => {
    const rule = rules.find(rule => rule.ruleKey === ruleKey);
    const binding = archive.compileRequest.rules.skillActionBindings?.find(binding => binding.bindingKey === rule?.bindingKey);
    return archive.snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === binding?.skillKey)?.skill.name ?? ruleKey;
  };
  const mixed = !!archive.runRequest?.driverPlan.basicAttack;
  const quantities = [
    ['配置技能', automatic.ruleCount], ['真实尝试', automatic.attemptCount], ['成功开始', automatic.startedCount], ['普通拒绝', automatic.rejectedCount],
    ['开始前中止', automatic.abortedBeforeStartCount], ['完整释放', automatic.completedCount], ['开始后失败', automatic.failedCount], ['仍在途', automatic.inFlightCount]
  ];
  const totals = [['A造成伤害', summary.sourceDamageDealt], ['B造成伤害', summary.targetDamageDealt], ['A实际扣血', summary.sourceHpLoss],
    ['B实际扣血', summary.targetHpLoss], ['A最终生命', summary.sourceFinalHp], ['B最终生命', summary.targetFinalHp],
    ['A直接治疗', summary.sourceDirectHealing], ['B直接治疗', summary.targetDirectHealing], ['A实际吸血', summary.sourceVampHealing], ['B实际吸血', summary.targetVampHealing]];
  return <section className="automatic-analysis-result" aria-label="自动技能结果">
    <Typography.Title heading={4}>混合战斗分析结果</Typography.Title>
    <Typography.Paragraph>冻结场景：{archive.snapshot.source.character.name}（等级{archive.snapshot.selection.sourceLevel}）→
      {archive.snapshot.target.character.name}（等级{archive.snapshot.selection.targetLevel}）；背景普攻{mixed ? '开启' : '关闭'}。
      观察至{summary.durationMs}毫秒，停止原因：{({ duration_reached: '到达观察终点', target_dead: '目标死亡', source_dead: '攻击方死亡', both_dead: '双方死亡', no_events: '没有后续真实事件', budget_exceeded: '执行预算耗尽' })[summary.stopReason]}。
      冻结条件摘要：{archive.runInputHash ?? '尚未准备'}。</Typography.Paragraph>
    <Alert type={archive.assessment.complete && archive.cleanup === 'released' && !stale ? 'success' : 'warning'} content={
      `观察${archive.assessment.complete ? '完整核对' : '尚未完整完成'}；${archive.cleanup === 'released' ? '会话已释放' : '会话未正常释放'}。
      ${automatic.inFlightCount ? '观察结束仍有在途使用，不代表释放完成。' : ''}${stale ? '输入已变化，当前是已过期的冻结结果。' : ''}`} />
    {summary.execution?.complete === false ? <Alert type="warning" content={`本次请求未完整完成，只显示截至${summary.durationMs}毫秒的已提交累计；原因：${summary.execution.incompleteReason === 'budget_exceeded' ? '执行预算耗尽' : '同步尾部未完成'}${summary.execution.budgetCause ? `（${summary.execution.budgetCause}）` : ''}。`} /> : null}
    <Typography.Paragraph data-testid="automatic-skill-totals">{quantities.map(([label, value]) => `${label}${value}`).join('；')}。
      配置项数与实际循环次数分别累计，真实命中{summary.skillUses?.hitCount ?? '缺失'}。</Typography.Paragraph>
    <div className="automatic-analysis-metrics">{totals.map(([label, value]) => <div className="automatic-analysis-metric" key={label}>
      <span>{label}</span><strong>{typeof value === 'number' ? number(value) : '未输出'}</strong></div>)}</div>
    <Typography.Paragraph>完整累计及资格不随采样、明细预算或筛选改变。造成伤害为防御后、护盾前金额，包含护盾吸收和过量部分，与实际扣血分别观察。</Typography.Paragraph>
    {mixed ? <Typography.Paragraph>背景普攻实际开始{summary.basicAttack?.startedCount ?? '缺失'}，命中{summary.basicAttack?.hitCount ?? '缺失'}，完整{summary.basicAttack?.completedCount ?? '缺失'}。</Typography.Paragraph> : null}
    <AutomaticSkillAnalysis archive={archive} view={view} onChange={setView} ruleName={name}>
      <section className="automatic-analysis-section" aria-label="自动规则与资格账本">
        <Typography.Title heading={5}>自动规则与最后等待</Typography.Title>
        <Table data={automatic.rules} rowKey="ruleKey" pagination={false} scroll={{ x: 1100 }} columns={[
          { title: '优先级／技能', render: (_, row) => `${(rules.find(rule => rule.ruleKey === row.ruleKey)?.sortOrder ?? -1) + 1} · ${name(row.ruleKey)}` },
          ...(['attemptCount', 'startedCount', 'rejectedCount', 'abortedBeforeStartCount', 'completedCount', 'failedCount', 'inFlightCount'] as const).map(field => ({
            title: ({ attemptCount: '真实尝试', startedCount: '成功开始', rejectedCount: '拒绝', abortedBeforeStartCount: '开始前中止', completedCount: '完整释放', failedCount: '失败', inFlightCount: '在途' })[field], dataIndex: field })),
          { title: '最后等待状态', render: (_, row) => row.waiting ? <Space direction="vertical"><Typography.Text>{waitingLabels[row.waiting.reason] ?? row.waiting.reason}
            {row.waiting.relatedRuleKeys.length ? `：${row.waiting.relatedRuleKeys.map(name).join('、')}` : ''}</Typography.Text>
            <Typography.Text type="secondary">{row.waiting.nextCheckAtMs === null ? '下一检查时刻尚未知' : `下一检查${row.waiting.nextCheckAtMs}毫秒`}；检查不承诺施放</Typography.Text></Space> : '当前无等待' }
        ]} />
        <Typography.Title heading={5}>一次释放资格账本</Typography.Title>
        <Table data={automatic.qualifications} rowKey={row => `${row.grantorRuleKey}/${row.consumerRuleKey}`} pagination={false} scroll={{ x: 1000 }} columns={[
          { title: '资格关系', render: (_, row) => `${name(row.grantorRuleKey)} → ${name(row.consumerRuleKey)}` },
          { title: '真实授予', dataIndex: 'grantedCount' }, { title: '开始时消费', dataIndex: 'consumedCount' }, { title: '未消费（最多1份）', dataIndex: 'remainingCount' },
          { title: '最后授予使用', render: (_, row) => row.lastGrantUseRef ?? '尚未授予' }, { title: '最后消费使用', render: (_, row) => row.lastConsumeUseRef ?? '尚未消费' }
        ]} />
        {archive.assessment.identityGaps.length ? <Alert type="info" content={archive.assessment.identityGaps.join('；')} /> : null}
      </section>
    </AutomaticSkillAnalysis>
    <section className="automatic-analysis-section"><Typography.Paragraph>清理状态：{archive.cleanup === 'released' ? '会话已正常释放' : '会话未正常释放'}。
      档案保存完整冻结输入、原始输出和当前视图；筛选不会裁剪下载内容。</Typography.Paragraph>
      {done.warnings.length ? <Alert type="warning" content={done.warnings.map(row => `${row.code}：${row.message}`).join('；')} /> : null}
      <Button onClick={downloadArchive}>下载自动冻结档案</Button></section>
  </section>;
}
