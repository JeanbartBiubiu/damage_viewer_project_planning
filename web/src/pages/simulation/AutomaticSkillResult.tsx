import { Alert, Button, InputNumber, Space, Table, Typography } from '@arco-design/web-react';
import { useState } from 'react';
import type { AutomaticSkillRecord, AutomaticSkillRecordKind, AutomaticSkillWaitingReason } from '../../types/genericEngine';
import type { AutomaticSkillArchive } from './BasicAttackCompilePanel';
import { buildAutomaticSkillArchive } from '../../engine/continuousAttackArchive';
import { AUTOMATIC_SKILL_RECORD_KIND_LABELS, AUTOMATIC_SKILL_WAIT_REASON_LABELS } from '../../types/skillSystemEnums.generated';

const waitingLabels: Record<AutomaticSkillWaitingReason, string> = AUTOMATIC_SKILL_WAIT_REASON_LABELS;
const recordLabels: Record<AutomaticSkillRecordKind, string> = AUTOMATIC_SKILL_RECORD_KIND_LABELS;
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}
export function AutomaticSkillResult({ archive, stale }: { archive: AutomaticSkillArchive; stale: boolean }) {
  const done = archive.runResult;
  const [range, setRange] = useState<[number, number]>([0, done?.summary.durationMs ?? 0]);
  const automatic = done?.automaticSkillSummary;
  if (!done || !automatic) return <section aria-label="自动技能结果"><Alert type="warning" content="尚无完整自动结果；冻结档案保留失败及会话清理状态。" />
    {archive.assessment?.issues.length ? <Alert type="error" content={archive.assessment.issues.join('；')} /> : null}
    <Button onClick={() => download('automatic-skill-archive.json', buildAutomaticSkillArchive(archive, range))}>下载自动冻结档案</Button></section>;
  if (!archive.assessment?.factsValid) return <section aria-label="自动技能结果">
    <Alert type="error" content={`自动结果协议或真实事实未通过核对：${archive.assessment?.issues.join('；') ?? '缺少结果核对'}。不能作为当前场景结果。`} />
    <Typography.Paragraph>会话{archive.cleanup === 'released' ? '已正常释放' : '未正常释放'}；失败请求与输入草稿保留。</Typography.Paragraph>
    <Button onClick={() => download('automatic-skill-archive.json', buildAutomaticSkillArchive(archive, range))}>下载自动冻结档案</Button>
  </section>;
  const summary = done.summary;
  const rules = archive.runRequest?.driverPlan.automaticSkills?.rules ?? [];
  const name = (ruleKey: string) => {
    const rule = rules.find(rule => rule.ruleKey === ruleKey);
    const binding = archive.compileRequest.rules.skillActionBindings?.find(binding => binding.bindingKey === rule?.bindingKey);
    return archive.snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === binding?.skillKey)?.skill.name ?? ruleKey;
  };
  const within = (time: number) => time >= range[0] && time <= range[1];
  const records = (Array.isArray(done.automaticSkillRecords) ? done.automaticSkillRecords : []).filter(record => within(record.timeMs));
  const recording = done.automaticSkillRecording;
  const mixed = !!archive.runRequest?.driverPlan.basicAttack;
  const timeline = ['STARTED', 'COMPLETED', 'FAILED', 'QUALIFICATION_GRANTED', 'QUALIFICATION_CONSUMED', 'WAIT_CHANGED'] as const;
  const quantities = [
    ['配置技能', automatic.ruleCount], ['真实尝试', automatic.attemptCount], ['成功开始', automatic.startedCount], ['普通拒绝', automatic.rejectedCount],
    ['开始前中止', automatic.abortedBeforeStartCount], ['完整释放', automatic.completedCount], ['开始后失败', automatic.failedCount], ['仍在途', automatic.inFlightCount]
  ];
  return <section aria-label="自动技能结果">
    <Typography.Title heading={4}>主动技能自动循环观察结果</Typography.Title>
    <Typography.Paragraph>冻结场景：{archive.snapshot.source.character.name}（等级{archive.snapshot.selection.sourceLevel}）→
      {archive.snapshot.target.character.name}（等级{archive.snapshot.selection.targetLevel}）；背景普攻{mixed ? '开启' : '关闭'}。
      观察至{summary.durationMs}毫秒，停止原因：{({ duration_reached: '到达观察终点', target_dead: '目标死亡', source_dead: '攻击方死亡', both_dead: '双方死亡', no_events: '没有后续真实事件', budget_exceeded: '执行预算耗尽' })[summary.stopReason]}。
      冻结条件摘要：{archive.runInputHash ?? '尚未准备'}。</Typography.Paragraph>
    <Alert type={archive.assessment?.complete && archive.cleanup === 'released' && !stale ? 'success' : 'warning'} content={
      `观察${archive.assessment?.complete ? '完整核对' : '尚未完整核对'}；${archive.cleanup === 'released' ? '会话已释放' : '会话未正常释放'}。
      ${automatic.inFlightCount ? '观察结束仍有在途使用，不代表释放完成。' : ''}${stale ? '输入已变化，当前是已过期的冻结结果。' : ''}`} />
    <Typography.Paragraph data-testid="automatic-skill-totals">{quantities.map(([label, value]) => `${label}${value}`).join('；')}。
      配置项数与实际循环次数分别累计，真实命中{summary.skillUses?.hitCount ?? '缺失'}。</Typography.Paragraph>
    <Typography.Paragraph>攻击方造成伤害{summary.sourceDamageDealt}，目标实际扣血{summary.targetHpLoss ?? '缺失'}；
      攻击方直接治疗{summary.sourceDirectHealing ?? '缺失'}、吸血{summary.sourceVampHealing ?? '缺失'}；
      最终生命：攻击方{summary.sourceFinalHp}，目标{summary.targetFinalHp}。
      完整累计及资格不随采样、明细预算或时间轴筛选改变。</Typography.Paragraph>
    {mixed ? <Typography.Paragraph>背景普攻实际开始{summary.basicAttack?.startedCount ?? '缺失'}，命中{summary.basicAttack?.hitCount ?? '缺失'}，完整{summary.basicAttack?.completedCount ?? '缺失'}。</Typography.Paragraph> : null}
    <Table data={Array.isArray(automatic.rules) ? automatic.rules : []} rowKey="ruleKey" pagination={false} scroll={{ x: 1100 }} columns={[
      { title: '优先级／技能', render: (_, row) => `${(rules.find(rule => rule.ruleKey === row.ruleKey)?.sortOrder ?? -1) + 1} · ${name(row.ruleKey)}` },
      ...(['attemptCount', 'startedCount', 'rejectedCount', 'abortedBeforeStartCount', 'completedCount', 'failedCount', 'inFlightCount'] as const).map(field => ({
        title: ({ attemptCount: '真实尝试', startedCount: '成功开始', rejectedCount: '拒绝', abortedBeforeStartCount: '开始前中止', completedCount: '完整释放', failedCount: '失败', inFlightCount: '在途' })[field], dataIndex: field })),
      { title: '最后等待状态', render: (_, row) => row.waiting ? <Space direction="vertical"><Typography.Text>{waitingLabels[row.waiting.reason] ?? row.waiting.reason}
        {row.waiting.relatedRuleKeys?.length ? `：${row.waiting.relatedRuleKeys.map(name).join('、')}` : ''}</Typography.Text>
        <Typography.Text type="secondary">{row.waiting.nextCheckAtMs === null ? '下一检查时刻尚未知' : `下一检查${row.waiting.nextCheckAtMs}毫秒`}；检查不承诺施放</Typography.Text></Space> : '当前无等待' }
    ]} />
    <Typography.Title heading={5}>一次释放资格账本</Typography.Title>
    <Table data={Array.isArray(automatic.qualifications) ? automatic.qualifications : []} rowKey={row => `${row.grantorRuleKey}/${row.consumerRuleKey}`} pagination={false} scroll={{ x: 1000 }} columns={[
      { title: '资格关系', render: (_, row) => `${name(row.grantorRuleKey)} → ${name(row.consumerRuleKey)}` },
      { title: '真实授予', dataIndex: 'grantedCount' }, { title: '开始时消费', dataIndex: 'consumedCount' }, { title: '未消费（最多1份）', dataIndex: 'remainingCount' },
      { title: '最后授予使用', render: (_, row) => row.lastGrantUseRef ?? '尚未授予' }, { title: '最后消费使用', render: (_, row) => row.lastConsumeUseRef ?? '尚未消费' }
    ]} />
    {archive.assessment?.issues.length ? <Alert type="error" content={archive.assessment.issues.join('；')} /> : null}
    {archive.assessment?.identityGaps.length ? <Alert type="info" content={archive.assessment.identityGaps.join('；')} /> : null}
    <Typography.Paragraph>自动事实总计{recording?.totalCount ?? '缺失'}，返回{recording?.returnedCount ?? '缺失'}，
      未请求{recording?.omittedCount ?? '缺失'}，预算丢弃{recording?.droppedCount ?? '缺失'}；
      {done.outputMode === 'summary' ? '汇总模式不返回明细，完整累计与最后等待仍保留。' : recording?.truncated ? '明细仅保留前缀，未通过记录重建完整资格。' : '已返回请求范围内全部自动明细。'}</Typography.Paragraph>
    <Space wrap><InputNumber aria-label="自动时间轴起点" value={range[0]} min={0} max={range[1]} onChange={value => value !== undefined && setRange([value, range[1]])} />
      <InputNumber aria-label="自动时间轴终点" value={range[1]} min={range[0]} max={summary.durationMs} onChange={value => value !== undefined && setRange([range[0], value])} />
      <Button onClick={() => download('automatic-skill-archive.json', buildAutomaticSkillArchive(archive, range))}>下载自动冻结档案</Button></Space>
    {done.outputMode !== 'summary' ? <svg role="img" aria-label="实际自动技能时间轴" viewBox="0 0 1000 190" style={{ width: '100%', maxHeight: 230 }}>
      {timeline.map((kind, index) => <g key={kind}><text x="5" y={42 + index * 25} fontSize="12">{recordLabels[kind]}</text>
        <line x1="120" x2="965" y1={38 + index * 25} y2={38 + index * 25} stroke="currentColor" opacity=".25" /></g>)}
      {records.filter(row => timeline.includes(row.kind as typeof timeline[number])).map(row => <circle key={row.sequence}
        cx={120 + 845 * (row.timeMs - range[0]) / Math.max(1, range[1] - range[0])} cy={38 + timeline.indexOf(row.kind as typeof timeline[number]) * 25}
        r="5" fill={row.kind === 'FAILED' ? '#e5484d' : '#165dff'}><title>{`${row.sequence} · ${row.timeMs}毫秒 ${name(row.ruleKey)} ${recordLabels[row.kind]} ${row.useRef ?? ''}`}</title></circle>)}
      <text x="120" y="18" fontSize="12">{range[0]}毫秒</text><text x="965" y="18" fontSize="12" textAnchor="end">{range[1]}毫秒</text>
    </svg> : null}
    <Table<AutomaticSkillRecord> data={records} rowKey="sequence" pagination={false} scroll={{ x: 1150, y: 280 }} columns={[
      { title: '同刻序号', dataIndex: 'sequence' }, { title: '实际时刻', dataIndex: 'timeMs' }, { title: '技能', render: (_, row) => name(row.ruleKey) },
      { title: '真实事实', render: (_, row) => recordLabels[row.kind] ?? row.kind }, { title: '使用身份', render: (_, row) => row.useRef ?? '无使用' },
      { title: '关联技能／使用', render: (_, row) => row.relatedRuleKey ? `${name(row.relatedRuleKey)} · ${row.relatedUseRef ?? '尚无使用'}` : '无关联' },
      { title: '原因', render: (_, row) => row.reason ? waitingLabels[row.reason as AutomaticSkillWaitingReason] ?? row.reason : row.kind === 'WAIT_CHANGED' ? '等待已清空' : '无' },
      { title: '下一检查', render: (_, row) => row.nextCheckAtMs === null ? '未知或不适用' : `${row.nextCheckAtMs}毫秒` }
    ]} />
    {(['damageRecords', 'healingRecords', 'attackRecords'] as const).map(field => {
      const fields = field === 'damageRecords' ? ['timeMs', 'owner', 'target', 'operationRef', 'useRef', 'postDefenseDamage', 'actualHpLoss']
        : field === 'healingRecords' ? ['timeMs', 'source', 'target', 'useRef', 'actualHealing', 'overheal'] : ['startAtMs', 'attackIndex', 'useRef', 'postDefenseDamage', 'actualHpLoss'];
      const labels: Record<string, string> = { timeMs: '实际时刻', owner: '真实拥有者', source: '来源方', target: '作用方', operationRef: '作者结果', useRef: '实际使用',
        postDefenseDamage: '造成伤害', actualHpLoss: '实际扣血', actualHealing: '有效治疗', overheal: '溢出治疗', startAtMs: '普攻开始', attackIndex: '刀号' };
      const rows = Array.isArray(done[field]) ? done[field]!.filter(row => within('timeMs' in row ? row.timeMs : row.startAtMs)) : [];
      return <section key={field}><Typography.Title heading={5}>{({ damageRecords: '逐笔伤害', healingRecords: '直接治疗', attackRecords: '背景普攻事实' })[field]}（已返回{rows.length}条）</Typography.Title>
        <Table data={rows.map((row, index) => ({ ...row, recordKey: index }))} rowKey="recordKey" pagination={false} scroll={{ x: 1000, y: 240 }}
          columns={fields.map(field => ({ title: labels[field], render: (_: unknown, row: object) => String((row as Record<string, unknown>)[field] ?? '—') }))} /></section>;
    })}
  </section>;
}
