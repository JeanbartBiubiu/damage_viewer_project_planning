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
const cleanupLabels: Record<AutomaticSkillArchive['cleanup'], string> = {
  released: '会话已正常释放', not_needed: '尚未产生可释放会话',
  worker_destroyed: '计算线程已销毁', release_failed: '会话释放失败'
};

function TechnicalDetails({ archive, ruleName }: { archive: AutomaticSkillArchive; ruleName?: (key: string) => string }) {
  const done = archive.runResult;
  const budgetCause = done?.summary.execution?.budgetCause;
  const qualifications = done?.automaticSkillSummary?.qualifications.filter(row => row.lastGrantUseRef || row.lastConsumeUseRef) ?? [];
  return <details className="automatic-analysis-section">
    <summary><Typography.Text bold>技术与调试详情</Typography.Text></summary>
    <Typography.Paragraph>{cleanupLabels[archive.cleanup]}。</Typography.Paragraph>
    <ul>
      <li>场景资料摘要 <code>{archive.snapshotDigest}</code></li>
      <li>运行输入摘要 <code>{archive.runInputHash ?? '未生成'}</code></li>
      <li>编译规则摘要 <code>{archive.compileRequest.rulesHash}</code></li>
      <li>引擎摘要 <code>{archive.wasm.sha256}</code></li>
      {budgetCause ? <li>预算项 <code>{budgetCause}</code></li> : null}
    </ul>
    {qualifications.length ? <>
      <Typography.Title heading={6}>资格记录标识</Typography.Title>
      <ul>{qualifications.map(row => <li key={`${row.grantorRuleKey}/${row.consumerRuleKey}`}>
        {ruleName?.(row.grantorRuleKey) ?? row.grantorRuleKey} → {ruleName?.(row.consumerRuleKey) ?? row.consumerRuleKey}
        {row.lastGrantUseRef ? <> · 最后授予使用 <code>{row.lastGrantUseRef}</code></> : null}
        {row.lastConsumeUseRef ? <> · 最后消费使用 <code>{row.lastConsumeUseRef}</code></> : null}
      </li>)}</ul>
    </> : null}
    {archive.assessment?.issues.length ? <Alert type="error" content={archive.assessment.issues.join('；')} /> : null}
    {archive.assessment?.identityGaps.length ? <Alert type="info" content={archive.assessment.identityGaps.join('；')} /> : null}
    {done?.warnings.length ? <Alert type="warning" content={done.warnings.map(row => `${row.code}：${row.message}`).join('；')} /> : null}
  </details>;
}

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
  const cleanupIssue = archive.cleanup === 'released' ? '' : cleanupLabels[archive.cleanup] + '。';
  if (!done || !automatic) return <section className="automatic-analysis-result" aria-label="自动技能结果">
    <Alert type="warning" content={`尚无完整自动结果。${cleanupIssue}冻结档案保留失败及会话清理状态。`} />
    <Button onClick={downloadArchive}>下载自动冻结档案</Button>
    <TechnicalDetails archive={archive} />
  </section>;
  if (!archive.assessment?.factsValid) return <section className="automatic-analysis-result" aria-label="自动技能结果">
    <Alert type="error" content="自动结果未通过核对。具体问题可在技术与调试详情中查看。" />
    <Typography.Paragraph>{cleanupIssue}失败请求与输入草稿保留。</Typography.Paragraph>
    <Button onClick={downloadArchive}>下载自动冻结档案</Button>
    <TechnicalDetails archive={archive} />
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
      观察至{summary.durationMs}毫秒，停止原因：{({ duration_reached: '到达观察终点', target_dead: '目标死亡', source_dead: '攻击方死亡', both_dead: '双方死亡', no_events: '没有后续真实事件', budget_exceeded: '执行预算耗尽' })[summary.stopReason]}。</Typography.Paragraph>
    <Alert type={archive.assessment.complete && archive.cleanup === 'released' && !stale ? 'success' : 'warning'} content={
      `观察${archive.assessment.complete ? '完整核对' : '尚未完整完成'}。${cleanupIssue}
      ${automatic.inFlightCount ? '观察结束仍有在途使用，不代表释放完成。' : ''}${stale ? '输入已变化，当前是已过期的冻结结果。' : ''}`} />
    {summary.execution?.complete === false ? <Alert type="warning" content={`本次请求未完整完成，只显示截至${summary.durationMs}毫秒的已提交累计；原因：${summary.execution.incompleteReason === 'budget_exceeded' ? '执行预算耗尽' : '同步尾部未完成'}。`} /> : null}
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
        <Table data={automatic.qualifications} rowKey={row => `${row.grantorRuleKey}/${row.consumerRuleKey}`} pagination={false} columns={[
          { title: '资格关系', render: (_, row) => `${name(row.grantorRuleKey)} → ${name(row.consumerRuleKey)}` },
          { title: '真实授予', dataIndex: 'grantedCount' }, { title: '开始时消费', dataIndex: 'consumedCount' }, { title: '未消费（最多1份）', dataIndex: 'remainingCount' }
        ]} />
      </section>
    </AutomaticSkillAnalysis>
    <section className="automatic-analysis-section"><Typography.Paragraph>档案包含完整冻结输入、原始输出与当前视图设置。</Typography.Paragraph>
      {done.warnings.length ? <Alert type="warning" content={`本次计算记录了 ${done.warnings.length} 项警告，可在技术与调试详情中查看。`} /> : null}
      <Button onClick={downloadArchive}>下载自动冻结档案</Button></section>
    <TechnicalDetails archive={archive} ruleName={name} />
  </section>;
}
