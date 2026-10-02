import { Alert, Button, InputNumber, Select, Space, Table, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import type { AttackRecord, DamageBreakdown, DamageRecord, SeriesPoint, WarningItem } from '../../types/genericEngine';
import type { ContinuousAttackArchive } from './BasicAttackCompilePanel';
import { JsonBlock } from '../../components/JsonBlock';
import { buildContinuousCsv, type ContinuousCsvKind } from '../../engine/continuousAttackArchive';
import { amountLabels, amountMetrics, continuousBreakdownKey, continuousContributions, continuousCurves, continuousSourceKey,
  damageMatchesSource, filterContinuousPresentation, formatContinuousAmount as number, initialContinuousView,
  type AmountMetric, type ContinuousAttackView } from '../../engine/continuousAttackPresentation';
import { ContinuousAttackCharts } from './ContinuousAttackCharts';
import './ContinuousAttackResult.css';

const stops: Record<string, string> = { no_events: '没有后续事件', duration_reached: '到达观察终点', target_dead: '目标生命归零',
  source_dead: '攻击方死亡', both_dead: '双方死亡', budget_exceeded: '执行预算停止' };
const budgets: Record<string, string> = { max_events: '战斗事件', max_commands_per_event: '同刀命令', max_chain_depth: '同步调用深度',
  max_queue_events: '待处理事件', max_process_instances: '过程实例', max_skill_hits: '原生命中',
  max_basic_attacks: '普攻次数', max_use_trigger_ledger: '同次使用触发账本' };
const sides: Record<string, string> = { source: 'A', target: 'B' };
const curveLabels: Record<string, string> = { sourceHp: 'A剩余生命', targetHp: 'B剩余生命', sourceDamageDealt: 'A累计造成伤害',
  targetDamageDealt: 'B累计造成伤害', sourceDps: 'A伤害率', targetDps: 'B伤害率' };
function showValue(value: unknown) {
  if (value === null || value === undefined) return '未发生／未输出';
  if (typeof value === 'number') return number(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
function frozenPath(input: unknown, path: string) {
  let value = input;
  for (const segment of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, segment)) return null;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

export function ContinuousAttackResult({ archive, cleanupLabel, released, warnings, stale, onDownload }: {
  archive: ContinuousAttackArchive; cleanupLabel: string; released: boolean; stale: boolean;
  warnings: WarningItem[]; onDownload: (view: ContinuousAttackView) => void;
}) {
  const result = archive.assessment;
  const usable = result?.factsValid ? result : null;
  const [view, setView] = useState(() => initialContinuousView(result?.durationMs ?? 0));
  const [hovered, setHovered] = useState<SeriesPoint | null>(null);
  const [attackPage, setAttackPage] = useState(1);
  const [damagePage, setDamagePage] = useState(1);
  const [showOrigin, setShowOrigin] = useState(false);
  useEffect(() => { setView(initialContinuousView(result?.durationMs ?? 0)); setHovered(null); setShowOrigin(false); }, [result]);
  useEffect(() => { setAttackPage(1); setDamagePage(1); }, [view.timeRangeMs, view.sourceKeys, view.damageTypes, view.attackIndex]);
  const data = useMemo(() => usable ? filterContinuousPresentation(usable, view) : null, [usable, view]);
  const patchView = (patch: Partial<ContinuousAttackView>) => setView(current => ({ ...current, ...patch }));
  const rangeChange = (range: [number, number]) => {
    const maximum = usable?.durationMs ?? 0;
    const lower = Math.max(0, Math.min(maximum, Math.round(range[0])));
    const upper = Math.max(lower, Math.min(maximum, Math.round(range[1])));
    setView(current => current.timeRangeMs[0] === lower && current.timeRangeMs[1] === upper ? current : { ...current, timeRangeMs: [lower, upper] });
  };
  const selectAttack = (row: AttackRecord) => {
    patchView({ selectedAttack: { planKey: row.planKey, attackIndex: row.attackIndex, useRef: row.useRef }, selectedDamageId: null });
    if (row.startAtMs < view.timeRangeMs[0] || row.startAtMs > view.timeRangeMs[1]) rangeChange([0, usable?.durationMs ?? 0]);
    setShowOrigin(false);
  };
  const selectDamage = (row: DamageRecord) => {
    const planKey = archive.runRequest?.driverPlan.basicAttack?.planKey;
    if (!planKey) return;
    patchView({ selectedAttack: { planKey, attackIndex: row.attackIndex, useRef: row.useRef }, selectedDamageId: row.damageId });
    setShowOrigin(false);
  };
  const selectedAttack = usable?.attackRecords.find(row => row.planKey === view.selectedAttack?.planKey
    && row.attackIndex === view.selectedAttack.attackIndex && row.useRef === view.selectedAttack.useRef);
  const selectedDamages = usable?.damageRecords.filter(row => row.attackIndex === view.selectedAttack?.attackIndex && row.useRef === view.selectedAttack.useRef) ?? [];
  const selectedDamage = usable?.damageRecords.find(row => row.damageId === view.selectedDamageId);
  const originFor = (row: DamageBreakdown | DamageRecord) => archive.operationOrigins.find(origin => origin.abilityRef === row.abilityRef && origin.operationRef === row.operationRef);
  const sourceLabel = (row: DamageBreakdown | DamageRecord) => {
    const origin = originFor(row);
    const skill = archive.snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === origin?.skillKey);
    return (skill?.skill.name ?? origin?.skillKey ?? row.abilityRef) + ' / ' + (origin ? origin.effectKey + '.' + origin.resultKey : row.operationRef)
      + '（拥有者' + (sides[row.owner] ?? row.owner) + '，' + (sides[row.source] ?? row.source) + '→' + (sides[row.target] ?? row.target) + '）';
  };
  const damageTypeLabel = (key: string) => archive.snapshot.catalogs.damageTypes.find(row => 'damage/' + row.type.damageTypeKey === key)?.type.name ?? key;
  const sourceRows = [...new Map((usable?.damageBreakdown ?? []).map(row => [continuousSourceKey(row), row])).entries()];
  const contributionRows = usable && data ? continuousContributions(usable.damageBreakdown, data.breakdownRows, view.breakdownMode, view.amountMetric) : [];
  const contributionLabel = (key: string, sourceKey: string | null) => sourceKey ? sourceLabel(sourceRows.find(([value]) => value === sourceKey)![1]) : damageTypeLabel(key);
  const summary = archive.runResult?.summary;
  const values = usable && summary ? [
    ['started-count', '攻击开始次数', usable.startedCount], ['hit-count', '攻击命中次数', usable.hitCount],
    ['completed-count', '完整完成刀数', usable.completedCount], ['damage-dealt', 'A造成伤害', usable.damageDealt],
    ['hp-loss', 'B实际扣血', usable.hpLoss], ['source-final-hp', 'A最终生命', usable.sourceFinalHp],
    ['target-final-hp', 'B最终生命', usable.targetFinalHp], ['requested-duration', '指定观察时长（毫秒）', usable.execution.requestedDurationMs],
    ['duration', '实际停止时刻（毫秒）', usable.durationMs], ['target-damage-dealt', 'B造成伤害', summary.targetDamageDealt],
    ['source-damage-taken', 'A承受伤害', summary.sourceDamageTaken], ['target-damage-taken', 'B承受伤害', summary.targetDamageTaken],
    ['source-hp-loss', 'A实际扣血', summary.sourceHpLoss!]
  ].map(([key, label, value]) => ({ key: String(key), label: String(label), value: value as number })) : [];
  const title = !result ? '没有可解释的运行结果' : !result.factsValid ? '可靠事实核对失败，不显示可信业务图表'
    : !result.execution.complete ? '部分结果：截至停止时刻的已提交累计，请求未完整完成'
    : result.seriesIssues.length ? '运行事实已核对，但曲线数据未通过核对'
    : result.execution.targetKilled ? '完整连续击杀' : '完整观察，目标未被击杀';
  const csv = (kind: ContinuousCsvKind) => {
    if (!usable || !data) return;
    const rows = { breakdown: data.breakdownRows, attack: data.attackRows, damage: data.damageRows, series: data.seriesRows }[kind];
    const text = buildContinuousCsv(kind, rows.map(row => ({ ...row })), { runInputHash: archive.runInputHash, view,
      executionComplete: usable.execution.complete, attackRecordsTruncated: usable.recording.attackRecordsTruncated,
      damageRecordsTruncated: usable.recording.damageRecordsTruncated, seriesDownsampled: usable.seriesSamplingEvidence?.downsampled ?? false });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'basic-attack-' + kind + '.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const selectedOrigin = selectedDamage ? originFor(selectedDamage) : null;
  return <section className="continuous-result" aria-label="连续普攻结果">
    <Typography.Title heading={4}>连续普攻结果</Typography.Title>
    {stale ? <Alert className="continuous-stale" type="info" content="输入已修改或正在重新计算；当前显示上一份冻结输入的结果。" /> : null}
    <Alert type={result?.complete && released ? 'success' : 'warning'} content={title} />
    <Typography.Paragraph style={{ marginTop: 12 }}>
      冻结场景：{archive.snapshot.source.character.name}（等级{archive.snapshot.selection.sourceLevel}）→{archive.snapshot.target.character.name}（等级{archive.snapshot.selection.targetLevel}）；
      普攻{archive.snapshot.selection.basicAttackSkillKey}（等级{archive.snapshot.selection.basicAttackLevel}）。初始生命A：{number(archive.initialHealth.source)}，B：{number(archive.initialHealth.target)}。
    </Typography.Paragraph>
    <Typography.Paragraph type="secondary">启用所选完整共享普攻；装备、其他英雄技能、构筑与B挂载未选入。此说明不表示角色没有这些能力。</Typography.Paragraph>
    {result?.issues.length ? <Alert type="warning" content={result.issues.join('；')} /> : null}
    {usable && data ? <>
      <Typography.Paragraph>{usable.execution.complete ? '整次运行的完整已提交累计' : '截至停止时刻的已提交累计'}；不受图表缩放或明细筛选改变。</Typography.Paragraph>
      <div className="continuous-metrics">{values.map(row => <div className="continuous-metric" key={row.key}>
        <div className="continuous-metric-label">{row.label}</div><div className="continuous-metric-value" data-testid={'continuous-attack-' + row.key}>{number(row.value)}</div>
      </div>)}</div>
      <Typography.Paragraph>
        击杀事实：{usable.execution.targetKilled ? '已击杀' : '未击杀'}；击杀时刻：<span data-testid="continuous-attack-killed-at">{usable.execution.targetKilledAtMs === null ? '未发生' : usable.execution.targetKilledAtMs + ' 毫秒'}</span>；
        停止原因：{stops[usable.stopReason] ?? usable.stopReason}。计算完整性：{usable.execution.complete ? '请求完整' : '请求未完整'}；展示核对：{usable.complete ? '通过' : '未通过'}。
        {usable.execution.incompleteReason ? '未完成原因：' + (usable.execution.incompleteReason === 'unfinished_tail' ? '同步尾部未完成' : '预算停止') + '。' : ''}
        {usable.execution.budgetCause ? '预算原因：' + (budgets[usable.execution.budgetCause] ?? usable.execution.budgetCause) + '。' : ''}
      </Typography.Paragraph>
      {usable.recording.attackRecordsTruncated || usable.recording.damageRecordsTruncated ? <Alert type="warning"
        content={'明细不完整：攻击记录丢弃' + usable.recording.droppedAttackRecords + '条，伤害记录丢弃' + usable.recording.droppedDamageRecords + '条；完整汇总独立于记录预算。'} /> : null}
      <div className="continuous-section">
        <Typography.Title heading={5}>时间轴与只读采样</Typography.Title>
        <Space wrap>
          <span>可见起点（毫秒）</span><InputNumber aria-label="可见起点（毫秒）" min={0} max={usable.durationMs} precision={0} value={view.timeRangeMs[0]}
            onChange={value => rangeChange([value ?? 0, view.timeRangeMs[1]])} style={{ width: 130 }} />
          <span>可见终点（毫秒）</span><InputNumber aria-label="可见终点（毫秒）" min={view.timeRangeMs[0]} max={usable.durationMs} precision={0} value={view.timeRangeMs[1]}
            onChange={value => rangeChange([view.timeRangeMs[0], value ?? usable.durationMs])} style={{ width: 130 }} />
          <Button onClick={() => rangeChange([0, usable.durationMs])}>恢复完整时间范围</Button>
          <Select aria-label="伤害率模式" value={view.dpsMode} style={{ width: 210 }} options={[{ label: '累计平均伤害率', value: 'cumulative' }, { label: '滚动窗口伤害率', value: 'window' }]}
            onChange={value => patchView({ dpsMode: value })} />
        </Space>
        {usable.series.length ? <>
          <Typography.Paragraph data-testid="continuous-sampling-evidence" style={{ marginTop: 12 }}>请求间隔{usable.seriesSamplingEvidence!.requestedSampleEveryMs}毫秒；有效间隔{usable.seriesSamplingEvidence!.effectiveSampleEveryMs}毫秒；
            返回{usable.seriesSamplingEvidence!.finalPointCount}／候选{usable.seriesSamplingEvidence!.requestedPointCount}点；上限{usable.seriesSamplingEvidence!.maxSeriesPoints}点；
            {usable.seriesSamplingEvidence!.downsampled ? '已降采样' : '未降采样'}。0毫秒为首刀提交后的观察，采样点不是全部攻击。</Typography.Paragraph>
          <div className="continuous-chart-key">{continuousCurves.map(key => <label key={key}><input type="checkbox" aria-label={curveLabels[key]} checked={view.visibleCurves.includes(key)}
            onChange={event => patchView({ visibleCurves: event.target.checked ? [...view.visibleCurves, key] : view.visibleCurves.filter(curve => curve !== key) })} />{curveLabels[key]}</label>)}</div>
          <ContinuousAttackCharts points={usable.series} attacks={usable.attackRecords} view={view} durationMs={usable.durationMs} killedAtMs={usable.execution.targetKilledAtMs}
            dpsWindowMs={archive.runRequest!.sampling.dpsWindowMs} onSelectAttack={selectAttack} onRangeChange={rangeChange} onHover={setHovered} />
          <Typography.Paragraph role="status" aria-label="采样悬停详情">{hovered ? '真实采样' + hovered.timeMs + '毫秒：A生命' + number(hovered.sourceHp) + '，B生命' + number(hovered.targetHp)
            + '；A累计造成伤害' + number(hovered.sourceDamageDealt) + '，B累计造成伤害' + number(hovered.targetDamageDealt) : '悬停吸附真实采样点，不插值；精确攻击时刻见标记与表格。'}</Typography.Paragraph>
          <Typography.Paragraph type="secondary">阶梯变化只表示相邻采样观察，不宣称精确扣血时刻。窗口为闭区间，左边界命中也计入；0毫秒伤害率不适用。</Typography.Paragraph>
          <Button disabled={!data.seriesRows.length} onClick={() => csv('series')}>导出当前采样表CSV</Button>
        </> : <Alert style={{ marginTop: 12 }} type="info" content={usable.seriesIssues.length ? '曲线数据未通过核对，已停用曲线；独立核对的运行事实保留。' : '本次未记录时间序列；完整汇总、来源分类和已返回明细仍可查看。'} />}
      </div>
      <div className="continuous-section">
        <Typography.Title heading={5}>来源拆分与筛选</Typography.Title>
        <Space wrap>
          <Select aria-label="伤害来源筛选" placeholder="全部来源" mode="multiple" allowClear value={view.sourceKeys} style={{ minWidth: 260, maxWidth: 600 }}
            options={sourceRows.map(([key, row]) => ({ value: key, label: sourceLabel(row) }))} onChange={value => patchView({ sourceKeys: value })} />
          <Select aria-label="伤害类型筛选" placeholder="全部伤害类型" mode="multiple" allowClear value={view.damageTypes} style={{ minWidth: 190 }}
            options={[...new Set(usable.damageBreakdown.map(row => row.damageType))].map(key => ({ value: key, label: damageTypeLabel(key) }))} onChange={value => patchView({ damageTypes: value })} />
          <InputNumber aria-label="攻击序号筛选" placeholder="全部刀号" min={1} max={Math.max(1, usable.startedCount)} precision={0} value={view.attackIndex ?? undefined}
            onChange={value => patchView({ attackIndex: value ?? null })} style={{ width: 150 }} />
          <Button onClick={() => patchView({ sourceKeys: [], damageTypes: [], attackIndex: null })}>清除来源与明细筛选</Button>
        </Space>
        <Space wrap style={{ marginTop: 12 }}>
          <Select aria-label="来源拆分方式" value={view.breakdownMode} style={{ width: 150 }} options={[{ label: '按来源拆分', value: 'source' }, { label: '按伤害类型拆分', value: 'type' }]}
            onChange={value => patchView({ breakdownMode: value })} />
          <Select aria-label="来源金额指标" value={view.amountMetric} style={{ width: 170 }} options={amountMetrics.map(key => ({ value: key, label: amountLabels[key] }))}
            onChange={value => patchView({ amountMetric: value as AmountMetric })} />
        </Space>
        <Typography.Paragraph style={{ marginTop: 12 }}>分类筛选小计（整次运行造成伤害）：<span data-testid="continuous-breakdown-subtotal">{number(data.breakdownSubtotal)}</span>。来源／类型只筛选完整分类和伤害表，不改变顶部卡片或A/B总量曲线。</Typography.Paragraph>
        <div className="continuous-source-bars">{contributionRows.map(row => <button className="continuous-source-bar" key={row.key} type="button"
          onClick={() => row.sourceKey ? patchView({ sourceKeys: [row.sourceKey] }) : patchView({ damageTypes: row.damageType ? [row.damageType] : [] })}>
          {contributionLabel(row.labelKey, row.sourceKey)}：{number(row.amount)}；{row.damageCount}笔；{row.proportion === null ? '无贡献比例' : number(row.proportion * 100) + '%（同伤害方向全场分母）'}
          <span className="continuous-source-bar-fill" style={{ width: Math.min(100, (row.proportion ?? 0) * 100) + '%' }} />
        </button>)}</div>
        <Table data={data.breakdownRows} rowKey={continuousBreakdownKey} pagination={{ pageSize: 10 }} scroll={{ x: 1000 }} columns={[
          { title: '拥有者／方向／来源', render: (_, row) => sourceLabel(row) }, { title: '伤害类型', render: (_, row) => damageTypeLabel(row.damageType) },
          { title: '结算笔数', dataIndex: 'damageCount' }, ...amountMetrics.map(key => ({ title: amountLabels[key], render: (_: unknown, row: DamageBreakdown) => number(row[key]) }))
        ]} />
        <Button disabled={!data.breakdownRows.length} onClick={() => csv('breakdown')}>导出当前完整分类表CSV</Button>
      </div>
      <div className="continuous-section" aria-label="逐刀事实">
        <Typography.Title heading={5}>逐刀事实（保留{usable.recording.returnedAttackRecords}／{usable.recording.attackRecordCount}条）</Typography.Title>
        <Typography.Paragraph type="secondary">按时间和刀号筛选，不用有限伤害行反推来源归属。没有记录不等于0刀；当前筛选{data.attackRows.length}条。</Typography.Paragraph>
        <Table data={data.attackRows} rowKey="useRef" pagination={{ pageSize: 10, current: attackPage, onChange: setAttackPage }} scroll={{ x: 1000 }} columns={[
          { title: '刀号', dataIndex: 'attackIndex' }, { title: '开始（毫秒）', dataIndex: 'startAtMs' }, { title: '命中（毫秒）', render: (_, row) => row.hitAtMs ?? '未发生' },
          { title: '造成伤害', render: (_, row) => number(row.postDefenseDamage) }, { title: '实际扣血', render: (_, row) => number(row.actualHpLoss) },
          { title: '目标尾部生命', render: (_, row) => number(row.targetHpAfter) }, { title: '尾部完成', render: (_, row) => row.completed ? '是' : '否' },
          { title: '查看', render: (_, row) => <Button size="small" onClick={() => selectAttack(row)}>查看第{row.attackIndex}刀</Button> }
        ]} />
        <Button disabled={!data.attackRows.length} onClick={() => csv('attack')}>导出当前攻击表CSV</Button>
      </div>
      <div className="continuous-section" aria-label="伤害事实">
        <Typography.Title heading={5}>伤害事实（保留{usable.recording.returnedDamageRecords}／{usable.recording.damageRecordCount}条）</Typography.Title>
        <Typography.Paragraph>当前已返回伤害记录小计：<span data-testid="continuous-record-subtotal">{number(data.damageSubtotal)}</span>；只针对当前时间／来源／类型／刀号筛选，不能替代全场总额。</Typography.Paragraph>
        <Table data={data.damageRows} rowKey="damageId" pagination={{ pageSize: 10, current: damagePage, onChange: setDamagePage }} scroll={{ x: 1150 }} columns={[
          { title: '编号', dataIndex: 'damageId' }, { title: '刀号', dataIndex: 'attackIndex' }, { title: '时刻（毫秒）', dataIndex: 'timeMs' },
          { title: '来源', render: (_, row) => sourceLabel(row) }, { title: '伤害类型', render: (_, row) => damageTypeLabel(row.damageType) },
          ...amountMetrics.map(key => ({ title: amountLabels[key], render: (_: unknown, row: DamageRecord) => number(row[key]) })),
          { title: '查看', render: (_, row) => <Button size="small" onClick={() => selectDamage(row)}>查看伤害{row.damageId}</Button> }
        ]} />
        <Button disabled={!data.damageRows.length} onClick={() => csv('damage')}>导出当前伤害表CSV</Button>
      </div>
      {view.selectedAttack ? <section className="continuous-detail" aria-label="逐刀详情" onKeyDown={event => {
        if (event.key === 'Escape') patchView({ selectedAttack: null, selectedDamageId: null });
      }}>
        <Space wrap><Typography.Title heading={5}>第{view.selectedAttack.attackIndex}刀详情</Typography.Title>
          <Button onClick={() => patchView({ selectedAttack: null, selectedDamageId: null })}>关闭详情</Button></Space>
        <Typography.Paragraph className="continuous-path">计划：{view.selectedAttack.planKey}；使用身份：{view.selectedAttack.useRef}</Typography.Paragraph>
        {selectedAttack ? <dl>{[['开始（毫秒）', selectedAttack.startAtMs], ['命中（毫秒）', selectedAttack.hitAtMs], ['就绪（毫秒）', selectedAttack.readyAtMs],
          ['下一刀（毫秒）', selectedAttack.nextStartAtMs], ['真实攻速', selectedAttack.attackSpeed], ['尾部完成', selectedAttack.completed],
          ['该刀造成伤害', selectedAttack.postDefenseDamage], ['该刀实际扣血', selectedAttack.actualHpLoss], ['A尾部生命', selectedAttack.sourceHpAfter], ['B尾部生命', selectedAttack.targetHpAfter]]
          .map(([label, value]) => <div key={String(label)} style={{ display: 'contents' }}><dt>{label}</dt><dd>{showValue(value)}</dd></div>)}</dl>
          : <Alert type="info" content="该刀攻击记录未保留：时刻、攻速及尾部生命未保留，不从静态间隔外推。" />}
        {!selectedAttack?.completed && selectedAttack ? <Alert type="warning" content="本刀同步尾部未完整完成；只展示实际已提交事实。" /> : null}
        {usable.recording.damageRecordsTruncated ? <Alert type="warning" content="全场伤害明细不全；只展示已返回伤害记录，不能保证本刀笔数完整。" /> : null}
        <Typography.Paragraph>该刀已返回{selectedDamages.length}笔，不受主表来源／时间筛选删减。</Typography.Paragraph>
        {selectedDamages.length ? <Space wrap>{selectedDamages.map(row => <Button key={row.damageId} type={selectedDamage?.damageId === row.damageId ? 'primary' : 'secondary'}
          onClick={() => selectDamage(row)}>结算编号{row.damageId}{damageMatchesSource(row, view) && row.timeMs >= view.timeRangeMs[0] && row.timeMs <= view.timeRangeMs[1] ? '' : '（主表已筛除）'}</Button>)}</Space>
          : <Typography.Paragraph>没有返回该刀伤害事实，不能据此判断为0伤害。</Typography.Paragraph>}
        {selectedDamage ? <section aria-label="伤害结算详情">
          <Typography.Title heading={6}>伤害编号{selectedDamage.damageId}：{sourceLabel(selectedDamage)}</Typography.Title>
          <dl>{[['实际结算时刻（毫秒）', selectedDamage.timeMs], ['施放实例', selectedDamage.castInstanceId], ['伤害类型', damageTypeLabel(selectedDamage.damageType)],
            ['防御前输入金额', selectedDamage.rawAmount], ...amountMetrics.map(key => [amountLabels[key], selectedDamage[key]]),
            ['受伤方生命之前', selectedDamage.hpBefore], ['受伤方生命之后', selectedDamage.hpAfter], ['暴击资格', selectedDamage.eligible],
            ['暴击策略', selectedDamage.policy], ['基础金额', selectedDamage.baseRawAmount], ['原暴击率', selectedDamage.originalCritChance],
            ['有效暴击率', selectedDamage.effectiveCritChance], ['暴击倍率', selectedDamage.multiplier], ['正常部分', selectedDamage.normalPart], ['暴击部分', selectedDamage.critPart],
            ['出伤修正前暴击调整金额', selectedDamage.critAdjustedRawAmount], ['穿透前抗性', selectedDamage.resistanceBeforePenetration], ['百分比穿透', selectedDamage.penetrationPercent],
            ['固定穿透', selectedDamage.penetrationFlat], ['有效抗性', selectedDamage.effectiveResistance], ['抗性系数', selectedDamage.resistanceFactor],
            ['防御后正常部分', selectedDamage.normalPartPostResistance], ['防御后暴击部分', selectedDamage.critPartPostResistance]]
            .map(([label, value]) => <div key={String(label)} style={{ display: 'contents' }}><dt>{label}</dt><dd>{showValue(value)}</dd></div>)}</dl>
          <Typography.Paragraph className="continuous-path">作者路径：{selectedDamage.operationRef}；编译路径：{selectedDamage.operationPath}</Typography.Paragraph>
          {selectedDamage.modifiers?.length ? <JsonBlock value={selectedDamage.modifiers} /> : null}
          <Button onClick={() => setShowOrigin(current => !current)}>定位冻结作者与编译节点</Button>
          {showOrigin && selectedOrigin ? <div><Typography.Paragraph>以下内容来自本次冻结档案，不读取最新管理数据。</Typography.Paragraph>
            <JsonBlock value={archive.snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === selectedOrigin.skillKey)} />
            <JsonBlock value={selectedOrigin} /><JsonBlock value={frozenPath(archive.compileRequest, selectedDamage.operationPath)} /></div> : null}
        </section> : null}
      </section> : null}
    </> : <Typography.Paragraph>没有通过可靠事实核对的运行结果，错误不会显示为0伤害。</Typography.Paragraph>}
    <div className="continuous-section">
      <Typography.Paragraph>清理状态：{cleanupLabel}。</Typography.Paragraph>
      {!released && result ? <Alert type="warning" content="运行事实已保留；会话未正常释放，整体任务未成功。" /> : null}
      {warnings.length ? <Alert type="warning" content={warnings.map(row => row.code + '：' + row.message).join('；')} /> : null}
      <Typography.Paragraph type="secondary">造成伤害为防御后、护盾前金额；实际扣血由原生结算独立累计。击杀时刻采用期望单击模型。完整档案不受筛选改变，CSV不只导出当前分页。</Typography.Paragraph>
      <Button onClick={() => onDownload(view)}>下载连续运行档案</Button>
    </div>
  </section>;
}
