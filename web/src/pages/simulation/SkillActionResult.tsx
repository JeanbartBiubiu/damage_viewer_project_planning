import { Alert, Button, InputNumber, Space, Table, Typography } from '@arco-design/web-react';
import { useState } from 'react';
import { buildContinuousAttackArchive, buildSkillActionArchive, buildSkillActionCsv, type SkillActionCsvKind } from '../../engine/continuousAttackArchive';
import type { SkillActionArchive } from './SimulationScenarioPanel';
import { ContinuousAttackResult } from './ContinuousAttackResult';
import { assessContinuousAttackResult } from '../../engine/continuousAttackResult';

const fieldLabels: Record<string, string> = {
  instructionKey: '指令标识', requestedAtMs: '请求时刻', actualAtMs: '实际时刻', outcome: '尝试结果', reason: '原因', useRef: '使用身份',
  timeMs: '实际时刻', kind: '使用事实', processKey: '过程标识', hitRef: '命中身份', source: '来源方', target: '作用方', operationRef: '作者结果',
  rawAmount: '原始治疗', healingAfterDone: '给予治疗修正后', healingAfterModifiers: '收到治疗修正后', actualHealing: '有效治疗',
  overheal: '溢出', hpBefore: '之前生命', hpAfter: '之后生命', attackIndex: '普攻刀号', postDefenseDamage: '造成伤害', actualHpLoss: '实际扣血',
  skillKey: '技能标识', owner: '真实拥有者', startAtMs: '普攻开始', hitAtMs: '普攻命中', finalReadyAtMs: '普通冷却就绪',
  mechanicReadyAtMs: '弹药就绪', actionReadyAtMs: '行动就绪贡献', nextStartAtMs: '实际唯一下一刀', providerRef: '来源挂载',
  stateKey: '机制状态', beforeValue: '原库存', afterValue: '新库存', readyAtMs: '实际就绪', stepKey: '实际步骤', stepVersion: '步骤版本',
  executionIndex: '已提交段号', parentInstructionKey: '关联原首次指令', action: '实际控制阶段', startedAtMs: '实际进入时刻',
  expectedEndAtMs: '声明完整结束期限', finishedAtMs: '实际退出时刻', actualEndAtMs: '实际许可结束期限'
};
const useLabels = { STARTED: '成功首次', RELEASED: '原过程释放', HIT: '实际命中', COMPLETED: '过程完成', FAILED: '过程失败',
  STEP_ENTERED: '进入步骤', STEP_EXECUTED: '实际段执行', STEP_COMPLETED: '步骤完成' };

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
  const attacks = (done.attackRecords ?? []).filter(row => within(row.startAtMs));
  const mechanics = (done.mechanicRecords ?? []).filter(row => within(row.timeMs));
  const mixed = !!archive.runRequest?.driverPlan.basicAttack;
  const summary = done.summary;
  const timelineKinds = ['STARTED', 'STEP_ENTERED', 'STEP_EXECUTED', 'RELEASED', 'HIT', 'STEP_COMPLETED', 'FAILED', 'COMPLETED'] as const;
  const occupancies = (done.finalSnapshot.processInstances ?? []).filter(process => archive.compileRequest?.rules.skillActionBindings?.some(binding =>
    binding.providerRef === process.providerRef && binding.source === process.owner && binding.skillKey === process.skillKey))
    .flatMap(process => (process.actionOccupancies ?? []).map(occupancy => ({ ...occupancy, useRef: process.useKey, processKey: process.processKey,
      skillKey: process.skillKey, source: process.owner, actualEndAtMs: occupancy.finishedAtMs ?? occupancy.expectedEndAtMs,
      recordKey: `${process.useKey}/${occupancy.stepVersion}` })));
  const tables = [
    { kind: 'skillAction', title: '指令尝试', rows: actions, fields: ['instructionKey', 'parentInstructionKey', 'action', 'skillKey', 'source', 'target', 'requestedAtMs', 'actualAtMs', 'outcome', 'reason', 'useRef'] },
    { kind: 'skillUse', title: '实际使用与过程', rows: uses, fields: ['instructionKey', 'timeMs', 'kind', 'processKey', 'stepKey', 'stepVersion', 'executionIndex', 'useRef', 'hitRef', 'reason'] },
    { kind: 'healing', title: '直接治疗', rows: healing, fields: ['timeMs', 'source', 'target', 'instructionKey', 'useRef', 'operationRef', 'rawAmount', 'healingAfterDone', 'healingAfterModifiers', 'actualHealing', 'overheal', 'hpBefore', 'hpAfter'] },
    { kind: 'damage', title: '逐笔伤害', rows: damage, fields: ['timeMs', 'owner', 'source', 'target', 'operationRef', 'instructionKey', 'useRef', 'hitRef', 'attackIndex', 'postDefenseDamage', 'actualHpLoss'] },
    { kind: 'attack', title: '背景普攻事实', rows: attacks, fields: ['attackIndex', 'useRef', 'startAtMs', 'hitAtMs', 'finalReadyAtMs', 'mechanicReadyAtMs', 'actionReadyAtMs', 'nextStartAtMs', 'postDefenseDamage', 'actualHpLoss'] },
    { kind: 'mechanic', title: '弹药与机制事实', rows: mechanics, fields: ['timeMs', 'kind', 'owner', 'providerRef', 'stateKey', 'beforeValue', 'afterValue', 'readyAtMs'] }
  ] as const;
  return <section aria-label="指定技能结果">
    <Typography.Title heading={4}>{mixed ? '技能与背景普攻混合观察结果' : '指定主动技能观察结果'}</Typography.Title>
    <Typography.Paragraph>冻结场景：A {archive.snapshot.source.character.name}（等级{archive.snapshot.selection.sourceLevel}），
      B {archive.snapshot.target.character.name}（等级{archive.snapshot.selection.targetLevel}）；
      计划来源：{archive.snapshot.selection.plannedSkills.map(plan => `${plan.skillKey} 等级${plan.skillLevel}`).join('；')}。
      初始生命A：{archive.initialHealth.source}，B：{archive.initialHealth.target}；运行条件摘要：{archive.runInputHash ?? '尚未准备'}。</Typography.Paragraph>
    <Alert type={archive.assessment?.complete && archive.cleanup === 'released' ? 'success' : 'warning'} content={
      `观察${summary.execution?.complete ? '完整' : '不完整'}；${archive.cleanup === 'released' ? '会话已释放' : '会话未正常释放'}。
      ${summary.skillUses?.inFlightCount ? '观察已结束但技能仍在途，不代表施法完成。' : ''}${stale ? '输入已变化，当前显示冻结旧结果。' : ''}`} />
    <Typography.Paragraph>计划{summary.skillActions?.plannedCount ?? '缺失'}；到达{summary.skillActions?.reachedCount ?? '缺失'}；接受{summary.skillActions?.acceptedCount ?? '缺失'}；
      拒绝{summary.skillActions?.rejectedCount ?? '缺失'}；接受前中止{summary.skillActions?.abortedBeforeAcceptCount ?? '缺失'}；未到达{summary.skillActions?.unreachedCount ?? '缺失'}。
      成功使用{summary.skillUses?.startedCount ?? '缺失'}，释放{summary.skillUses?.releasedCount ?? '缺失'}，真实命中{summary.skillUses?.hitCount ?? '缺失'}，
      完成{summary.skillUses?.completedCount ?? '缺失'}，失败{summary.skillUses?.failedCount ?? '缺失'}，在途{summary.skillUses?.inFlightCount ?? '缺失'}。
      进入步骤{summary.skillUses?.stepEnteredCount ?? '缺失'}，实际段执行{summary.skillUses?.stepExecutedCount ?? '缺失'}，步骤完成{summary.skillUses?.stepCompletedCount ?? '缺失'}。</Typography.Paragraph>
    <Typography.Paragraph>造成伤害A：{summary.sourceDamageDealt}，B：{summary.targetDamageDealt}；实际扣血A：{summary.sourceHpLoss ?? '缺失'}，B：{summary.targetHpLoss ?? '缺失'}。
      直接治疗A：{summary.sourceDirectHealing ?? '缺失'}，B：{summary.targetDirectHealing ?? '缺失'}；吸血A：{summary.sourceVampHealing ?? '缺失'}，B：{summary.targetVampHealing ?? '缺失'}。
      最终生命A：{summary.sourceFinalHp}，B：{summary.targetFinalHp}。完整累计不随缩放、零记录或截断改变。</Typography.Paragraph>
    {mixed ? <Typography.Paragraph>背景普攻开始{summary.basicAttack?.startedCount}，命中{summary.basicAttack?.hitCount}，完成{summary.basicAttack?.completedCount}；
      首刀前行动就绪贡献：{summary.basicAttack?.initialActionReadyAtMs ?? '无贡献'}毫秒；初始弹药就绪：{summary.basicAttack?.initialMechanicReadyAtMs ?? '无需等待'}。
      下一刀只取普通冷却、弹药和真实行动贡献的最大值，不累加等待、不从有限记录推导。</Typography.Paragraph> : null}
    <Table data={archive.runRequest?.driverPlan.skillActions ?? []} rowKey="instructionKey" pagination={false}
      columns={['instructionKey', 'parentInstructionKey', 'skillKey', 'firstAtMs', 'sortOrder', 'target', 'action', 'hitBindings'].map(field => ({
        title: ({ firstAtMs: '请求时刻', sortOrder: '同刻顺序', hitBindings: '首次明确命中输入' } as Record<string, string>)[field] ?? fieldLabels[field],
        render: (_value: unknown, row: object) => JSON.stringify((row as Record<string, unknown>)[field]) }))} />
    {archive.assessment?.issues.length ? <Alert type="error" content={archive.assessment.issues.join('；')} /> : null}
    {archive.assessment?.identityGaps.length ? <Alert type="warning" content={`完整累计与观察状态独立核对；明细身份仅部分核实：${archive.assessment.identityGaps.join('；')}。不通过金额、最近刀号或调试证据补造关联。`} /> : null}
    <Typography.Paragraph>独立记录：{JSON.stringify(done.recording)}。仅展示与导出原生已返回事实，不通过调试证据还原丢弃记录。</Typography.Paragraph>
    <Space wrap>
      <InputNumber aria-label="主动时间轴起点" value={range[0]} min={0} max={range[1]} onChange={value => value !== undefined && setRange([value, range[1]])} />
      <InputNumber aria-label="主动时间轴终点" value={range[1]} min={range[0]} max={summary.durationMs} onChange={value => value !== undefined && setRange([range[0], value])} />
      <Button onClick={() => download('skill-plan-archive.json', JSON.stringify(buildSkillActionArchive(archive, range), null, 2), 'application/json')}>下载主动冻结档案</Button>
    </Space>
    <svg role="img" aria-label="实际主动使用时间轴" viewBox="0 0 1000 270" style={{ width: '100%', maxHeight: 290 }}>
      {timelineKinds.map((kind, index) => <g key={kind}><text x="5" y={42 + index * 25} fontSize="12">{useLabels[kind]}</text>
        <line x1="100" x2="965" y1={38 + index * 25} y2={38 + index * 25} stroke="currentColor" opacity=".25" /></g>)}
      {attacks.map(row => <circle key={row.useRef} cx={100 + 865 * (row.startAtMs - range[0]) / Math.max(1, range[1] - range[0])}
        cy="245" r="4" fill="#16a34a"><title>{`${row.startAtMs}毫秒 普攻${row.attackIndex} ${row.useRef}`}</title></circle>)}
      {uses.map((row, index) => {
        const horizontal = 100 + 865 * (row.timeMs - range[0]) / Math.max(1, range[1] - range[0]);
        const vertical = 38 + timelineKinds.indexOf(row.kind) * 25;
        return <g key={`${row.useRef}:${row.kind}:${row.hitRef}:${index}`}>
          <circle cx={horizontal} cy={vertical} r="5" fill={row.kind === 'FAILED' ? '#e5484d' : '#165dff'}>
            <title>{`${row.timeMs}毫秒 ${useLabels[row.kind]} ${row.useRef} ${row.stepKey} 版本${row.stepVersion} 段${row.executionIndex}`}</title></circle>
        </g>;
      })}
      {actions.filter(row => row.outcome !== 'ACCEPTED').map(row => {
        const horizontal = 100 + 865 * (row.actualAtMs - range[0]) / Math.max(1, range[1] - range[0]);
        return <circle key={row.instructionKey} cx={horizontal} cy="245" r="5" fill="#e5484d">
          <title>{`${row.actualAtMs}毫秒 ${row.instructionKey} ${row.outcome === 'REJECTED' ? '普通拒绝' : '接受前中止'} ${row.reason ?? '缺失原因'}`}</title></circle>;
      })}
      <text x="5" y="249" fontSize="12">普攻／拒绝</text>
      <text x="100" y="18" fontSize="12">{range[0]}毫秒</text><text x="965" y="18" fontSize="12" textAnchor="end">{range[1]}毫秒</text>
    </svg>
    <section aria-label="完整行动占用历史">
      <Typography.Title heading={5}>完整行动占用历史（{occupancies.length}项，不受明细预算影响）</Typography.Title>
      <Table data={occupancies} rowKey="recordKey" pagination={false} scroll={{ x: 1200 }} columns={[
        'skillKey', 'useRef', 'processKey', 'stepKey', 'stepVersion', 'startedAtMs', 'expectedEndAtMs', 'finishedAtMs', 'actualEndAtMs'
      ].map(field => ({ title: fieldLabels[field], render: (_value: unknown, row: object) => String((row as Record<string, unknown>)[field] ?? '仍占用') }))} />
    </section>
    {tables.map(table => <section key={table.kind} aria-label={table.title}>
      <Typography.Title heading={5}>{table.title}（当前已返回{table.rows.length}条）</Typography.Title>
      <Button onClick={() => download(`skill-plan-${table.kind}.csv`, buildSkillActionCsv(table.kind as SkillActionCsvKind,
        table.rows, archive.runInputHash, range, done.recording), 'text/csv;charset=utf-8')}>导出{table.title}CSV</Button>
      <Table data={table.rows.map((row, index) => ({ ...row, recordKey: index }))} rowKey="recordKey" pagination={false} scroll={{ x: 1200, y: 280 }}
        columns={table.fields.map(field => ({ title: fieldLabels[field] ?? field, render: (_value: unknown, row: object) => String((row as Record<string, unknown>)[field] ?? '—') }))} />
    </section>)}
    {mixed && archive.runRequest ? <ContinuousAttackResult archive={{ ...archive, taskKind: 'continuous_attack',
      assessment: assessContinuousAttackResult(archive.compileRequest, archive.runRequest, done, archive.operationOrigins) }} stale={stale}
      cleanupLabel={archive.cleanup === 'released' ? '会话已正常释放' : '会话未正常释放'} released={archive.cleanup === 'released'} warnings={done.warnings}
      onDownload={view => download('mixed-timeline-archive.json', JSON.stringify(buildContinuousAttackArchive(archive, view), null, 2), 'application/json')} /> : null}
  </section>;
}
