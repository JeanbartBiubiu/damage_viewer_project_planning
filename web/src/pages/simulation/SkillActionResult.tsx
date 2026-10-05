import { Alert, Button, InputNumber, Space, Table, Typography } from '@arco-design/web-react';
import { useState } from 'react';
import { buildSkillActionArchive, buildSkillActionCsv, type SkillActionCsvKind } from '../../engine/continuousAttackArchive';
import type { SkillActionArchive } from './BasicAttackCompilePanel';

const fieldLabels: Record<string, string> = {
  instructionKey: '指令标识', requestedAtMs: '请求时刻', actualAtMs: '实际时刻', outcome: '尝试结果', reason: '原因', useRef: '使用身份',
  timeMs: '实际时刻', kind: '使用事实', processKey: '过程标识', hitRef: '命中身份', source: '来源方', target: '作用方', operationRef: '作者结果',
  rawAmount: '原始治疗', healingAfterDone: '给予治疗修正后', healingAfterModifiers: '收到治疗修正后', actualHealing: '有效治疗',
  overheal: '溢出', hpBefore: '之前生命', hpAfter: '之后生命', attackIndex: '普攻刀号', postDefenseDamage: '造成伤害', actualHpLoss: '实际扣血'
};
const useLabels = { STARTED: '成功首次', RELEASED: '原过程释放', HIT: '实际命中', COMPLETED: '过程完成', FAILED: '过程失败' };

function download(name: string, value: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}

export function SkillActionResult({ archive, stale }: { archive: SkillActionArchive; stale: boolean }) {
  const done = archive.runResult;
  const [range, setRange] = useState<[number, number]>([0, done?.summary.durationMs ?? 0]);
  if (!done) return <Alert type="warning" content="本次尚无实际主动结果；冻结档案保留失败及清理状态。" />;
  const within = (time: number) => time >= range[0] && time <= range[1];
  const actions = (done.skillActionRecords ?? []).filter(row => within(row.actualAtMs));
  const uses = (done.skillUseRecords ?? []).filter(row => within(row.timeMs));
  const healing = (done.healingRecords ?? []).filter(row => within(row.timeMs));
  const damage = (done.damageRecords ?? []).filter(row => within(row.timeMs));
  const summary = done.summary;
  const tables = [
    { kind: 'skillAction', title: '指令尝试', rows: actions, fields: ['instructionKey', 'requestedAtMs', 'actualAtMs', 'outcome', 'reason', 'useRef'] },
    { kind: 'skillUse', title: '实际使用与过程', rows: uses, fields: ['instructionKey', 'timeMs', 'kind', 'processKey', 'useRef', 'hitRef', 'reason'] },
    { kind: 'healing', title: '直接治疗', rows: healing, fields: ['timeMs', 'source', 'target', 'operationRef', 'rawAmount', 'healingAfterDone', 'healingAfterModifiers', 'actualHealing', 'overheal', 'hpBefore', 'hpAfter'] },
    { kind: 'damage', title: '逐笔伤害', rows: damage, fields: ['timeMs', 'source', 'target', 'operationRef', 'instructionKey', 'useRef', 'hitRef', 'attackIndex', 'postDefenseDamage', 'actualHpLoss'] }
  ] as const;
  return <section aria-label="指定技能结果">
    <Typography.Title heading={4}>6A单次主动观察结果</Typography.Title>
    <Typography.Paragraph>冻结场景：A {archive.snapshot.source.character.name}（等级{archive.snapshot.selection.sourceLevel}），
      B {archive.snapshot.target.character.name}（等级{archive.snapshot.selection.targetLevel}）；
      主动技能{archive.snapshot.selection.plannedSkills[0]?.skillKey}，等级{archive.snapshot.selection.plannedSkills[0]?.skillLevel}。
      初始生命A：{archive.initialHealth.source}，B：{archive.initialHealth.target}；运行条件摘要：{archive.runInputHash ?? '尚未准备'}。</Typography.Paragraph>
    <Alert type={archive.assessment?.complete && archive.cleanup === 'released' ? 'success' : 'warning'} content={
      `观察${summary.execution?.complete ? '完整' : '不完整'}；${archive.cleanup === 'released' ? '会话已释放' : '会话未正常释放'}。
      ${summary.skillUses?.inFlightCount ? '观察已结束但技能仍在途，不代表施法完成。' : ''}${stale ? '输入已变化，当前显示冻结旧结果。' : ''}`} />
    <Typography.Paragraph>计划{summary.skillActions?.plannedCount ?? '缺失'}；到达{summary.skillActions?.reachedCount ?? '缺失'}；接受{summary.skillActions?.acceptedCount ?? '缺失'}；
      拒绝{summary.skillActions?.rejectedCount ?? '缺失'}；接受前中止{summary.skillActions?.abortedBeforeAcceptCount ?? '缺失'}；未到达{summary.skillActions?.unreachedCount ?? '缺失'}。
      成功使用{summary.skillUses?.startedCount ?? '缺失'}，释放{summary.skillUses?.releasedCount ?? '缺失'}，真实命中{summary.skillUses?.hitCount ?? '缺失'}，
      完成{summary.skillUses?.completedCount ?? '缺失'}，失败{summary.skillUses?.failedCount ?? '缺失'}，在途{summary.skillUses?.inFlightCount ?? '缺失'}。</Typography.Paragraph>
    <Typography.Paragraph>造成伤害A：{summary.sourceDamageDealt}，B：{summary.targetDamageDealt}；实际扣血A：{summary.sourceHpLoss ?? '缺失'}，B：{summary.targetHpLoss ?? '缺失'}。
      直接治疗A：{summary.sourceDirectHealing ?? '缺失'}，B：{summary.targetDirectHealing ?? '缺失'}；吸血A：{summary.sourceVampHealing ?? '缺失'}，B：{summary.targetVampHealing ?? '缺失'}。
      最终生命A：{summary.sourceFinalHp}，B：{summary.targetFinalHp}。完整累计不随缩放、零记录或截断改变。</Typography.Paragraph>
    {archive.assessment?.issues.length ? <Alert type="error" content={archive.assessment.issues.join('；')} /> : null}
    <Typography.Paragraph>独立记录：{JSON.stringify(done.recording)}。仅展示与导出原生已返回事实，不通过调试证据还原丢弃记录。</Typography.Paragraph>
    <Space wrap>
      <InputNumber aria-label="主动时间轴起点" value={range[0]} min={0} max={range[1]} onChange={value => value !== undefined && setRange([value, range[1]])} />
      <InputNumber aria-label="主动时间轴终点" value={range[1]} min={range[0]} max={summary.durationMs} onChange={value => value !== undefined && setRange([range[0], value])} />
      <Button onClick={() => download('single-active-skill-archive.json', JSON.stringify(buildSkillActionArchive(archive, range), null, 2), 'application/json')}>下载主动冻结档案</Button>
    </Space>
    <svg role="img" aria-label="实际主动使用时间轴" viewBox="0 0 900 90" style={{ width: '100%', maxHeight: 120 }}>
      <line x1="30" x2="870" y1="35" y2="35" stroke="currentColor" />
      {uses.map((row, index) => {
        const horizontal = 30 + 840 * (row.timeMs - range[0]) / Math.max(1, range[1] - range[0]);
        return <g key={`${row.useRef}:${row.kind}:${row.hitRef}:${index}`}>
          <circle cx={horizontal} cy="35" r="5" fill={row.kind === 'FAILED' ? '#e5484d' : '#165dff'}><title>{`${row.timeMs}毫秒 ${row.kind} ${row.useRef}`}</title></circle>
          <text x={horizontal} y={55 + index % 2 * 15} fontSize="12" textAnchor="middle">{useLabels[row.kind]}</text>
        </g>;
      })}
      {actions.filter(row => row.outcome !== 'ACCEPTED').map(row => {
        const horizontal = 30 + 840 * (row.actualAtMs - range[0]) / Math.max(1, range[1] - range[0]);
        return <g key={row.instructionKey}><circle cx={horizontal} cy="35" r="7" fill="#e5484d"><title>{row.reason ?? '无原因'}</title></circle>
          <text x={horizontal} y="55" fontSize="12" textAnchor="middle">{row.outcome === 'REJECTED' ? '普通拒绝' : '接受前中止'}</text></g>;
      })}
      <text x="30" y="18" fontSize="12">{range[0]}毫秒</text><text x="870" y="18" fontSize="12" textAnchor="end">{range[1]}毫秒</text>
    </svg>
    {tables.map(table => <section key={table.kind} aria-label={table.title}>
      <Typography.Title heading={5}>{table.title}（当前已返回{table.rows.length}条）</Typography.Title>
      <Button onClick={() => download(`single-active-${table.kind}.csv`, buildSkillActionCsv(table.kind as SkillActionCsvKind,
        table.rows, archive.runInputHash, range, done.recording), 'text/csv;charset=utf-8')}>导出{table.title}CSV</Button>
      <Table data={table.rows.map((row, index) => ({ ...row, recordKey: index }))} rowKey="recordKey" pagination={false} scroll={{ x: 1200, y: 280 }}
        columns={table.fields.map(field => ({ title: fieldLabels[field] ?? field, render: (_value: unknown, row: object) => String((row as Record<string, unknown>)[field] ?? '—') }))} />
    </section>)}
  </section>;
}
