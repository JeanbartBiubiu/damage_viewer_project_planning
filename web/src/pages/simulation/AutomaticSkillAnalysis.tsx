import { Alert, Button, InputNumber, Select, Space, Table, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AutomaticSkillArchive } from './SimulationScenarioPanel';
import type { AutomaticSkillRecord, AutomaticSkillWaitingReason, DamageBreakdown, HealingRecord, SeriesPoint } from '../../types/genericEngine';
import { amountLabels, amountMetrics, continuousBreakdownKey, continuousContributions, continuousCurves, continuousSourceKey,
  formatContinuousAmount as number, type AmountMetric } from '../../engine/continuousAttackPresentation';
import { automaticAttackKey, automaticOrigin, filterAutomaticPresentation, indexAutomaticPresentation, resolveAutomaticSelection,
  type AutomaticSelection, type AutomaticSkillView } from '../../engine/automaticSkillPresentation';
import { AUTOMATIC_SKILL_RECORD_KIND_LABELS, AUTOMATIC_SKILL_WAIT_REASON_LABELS } from '../../types/skillSystemEnums.generated';
import { ContinuousAttackCharts, type ContinuousChartMarker } from './ContinuousAttackCharts';
import { AutomaticSkillDetails } from './AutomaticSkillDetails';
import { ResourceChangeFacts } from './ResourceChangeFacts';

const curves: Record<string, string> = { sourceHp: 'A剩余生命', targetHp: 'B剩余生命', sourceDamageDealt: 'A累计造成伤害',
  targetDamageDealt: 'B累计造成伤害', sourceDps: 'A伤害率', targetDps: 'B伤害率' };
const sides: Record<string, string> = { source: 'A', target: 'B' };
const recordLabels = AUTOMATIC_SKILL_RECORD_KIND_LABELS;
const waitingLabels = AUTOMATIC_SKILL_WAIT_REASON_LABELS;
type Marker = ContinuousChartMarker & { lane: number; selection: AutomaticSelection };

export function AutomaticSkillAnalysis({ archive, view, onChange, ruleName, children }: {
  archive: AutomaticSkillArchive; view: AutomaticSkillView; onChange: (view: AutomaticSkillView) => void;
  ruleName: (key: string) => string; children: ReactNode;
}) {
  const done = archive.runResult!;
  const index = useMemo(() => indexAutomaticPresentation(done), [done]);
  const filtered = useMemo(() => filterAutomaticPresentation(done, index, view), [done, index, view]);
  const [hovered, setHovered] = useState<SeriesPoint | null>(null);
  useEffect(() => setHovered(null), [done]);
  const patch = (change: Partial<AutomaticSkillView>) => onChange({ ...view, ...change });
  const select = (selection: AutomaticSelection | null) => patch({ selection });
  const selected = resolveAutomaticSelection(index, view.selection);
  const rangeChange = (range: [number, number]) => {
    const lower = Math.max(0, Math.min(done.summary.durationMs, Math.round(range[0])));
    const upper = Math.max(lower, Math.min(done.summary.durationMs, Math.round(range[1])));
    if (lower !== view.timeRangeMs[0] || upper !== view.timeRangeMs[1]) patch({ timeRangeMs: [lower, upper] });
  };
  const sourceLabel = (row: DamageBreakdown) => {
    const { origin } = automaticOrigin(archive.operationOrigins, row);
    const skill = archive.snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === origin?.skillKey);
    return `${skill?.skill.name ?? row.abilityRef} / ${origin ? `${origin.effectKey}.${origin.resultKey}` : row.operationRef}（拥有者${sides[row.owner] ?? row.owner}，${sides[row.source] ?? row.source}→${sides[row.target] ?? row.target}）`;
  };
  const typeLabel = useCallback((key: string) => archive.snapshot.catalogs.damageTypes.find(row => row.type.damageTypeKey === key)?.type.name ?? key, [archive.snapshot]);
  const allBreakdown = done.summary.damageBreakdown ?? [];
  const sourceRows = [...new Map(allBreakdown.map(row => [continuousSourceKey(row), row])).entries()];
  const contributions = continuousContributions(allBreakdown, filtered.breakdown, view.breakdownMode, view.amountMetric);
  const markers = useMemo<Marker[]>(() => [
    ...filtered.automatic.map(row => ({ key: `automatic:${row.sequence}`, timeMs: row.timeMs, label: `${ruleName(row.ruleKey)} ${recordLabels[row.kind]}（自动序号${row.sequence}）`,
      color: row.kind === 'FAILED' ? '#e5484d' : '#165dff', selected: selected.automatic?.sequence === row.sequence, lane: 0,
      selection: { kind: 'automatic', sequence: row.sequence } as AutomaticSelection })),
    ...filtered.attacks.map(row => ({ key: `attack:${automaticAttackKey(row)}`, timeMs: row.startAtMs, label: `背景普攻第${row.attackIndex}刀开始`,
      color: '#86909c', selected: selected.attack === row, lane: 1,
      selection: { kind: 'attack', planKey: row.planKey, attackIndex: row.attackIndex, useRef: row.useRef } as AutomaticSelection })),
    ...filtered.damage.map(row => ({ key: `damage:${row.damageId}`, timeMs: row.timeMs, label: `伤害编号${row.damageId}：${typeLabel(row.damageType)}`,
      color: '#f53f3f', selected: selected.damage === row, lane: 2, selection: { kind: 'damage', damageId: row.damageId } as AutomaticSelection })),
    ...filtered.healing.map(({ row, recordIndex }) => ({ key: `healing:${recordIndex}`, timeMs: row.timeMs, label: `直接治疗${recordIndex + 1}`,
      color: '#00b42a', selected: selected.healing?.recordIndex === recordIndex, lane: 3, selection: { kind: 'healing', recordIndex } as AutomaticSelection })),
    ...filtered.resources.map(row => ({ key: `resource:${row.healthOrder}`, timeMs: row.timeMs, label: `资源生命变化${row.healthOrder}`,
      color: '#722ed1', selected: selected.resource === row, lane: 4, selection: { kind: 'resource', healthOrder: row.healthOrder } as AutomaticSelection }))
  ], [filtered, ruleName, selected.automatic, selected.attack, selected.damage, selected.healing, selected.resource, typeLabel]);
  const chartView = useMemo(() => ({ ...view, selectedAttack: selected.attack ?? null }), [view, selected.attack]);
  const chartMarkers = useMemo(() => markers.filter(marker => marker.lane !== 1), [markers]);
  const automaticStats = done.automaticSkillRecording;
  const retention = [
    { label: '背景普攻', total: done.recording?.attackRecordCount, returned: done.recording?.returnedAttackRecords, dropped: done.recording?.droppedAttackRecords,
      truncated: done.recording?.attackRecordsTruncated, budget: archive.runRequest?.recordBudget?.maxAttackRecords },
    { label: '伤害', total: done.recording?.damageRecordCount, returned: done.recording?.returnedDamageRecords, dropped: done.recording?.droppedDamageRecords,
      truncated: done.recording?.damageRecordsTruncated, budget: archive.runRequest?.recordBudget?.maxDamageRecords },
    { label: '直接治疗', total: done.recording?.healingRecordCount, returned: done.recording?.returnedHealingRecords, dropped: done.recording?.droppedHealingRecords,
      truncated: done.recording?.healingRecordsTruncated, budget: archive.runRequest?.recordBudget?.maxHealingRecords }
  ];
  const healingOriginLabel = (row: HealingRecord) => {
    const found = automaticOrigin(archive.operationOrigins, row).origin;
    const skill = archive.snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === found?.skillKey);
    return `${skill?.skill.name ?? row.abilityRef} / ${found ? `${found.effectKey}.${found.resultKey}` : row.operationRef}`;
  };
  return <>
    <section className="automatic-analysis-section" aria-label="混合战斗曲线">
      <Typography.Title heading={5}>时间范围与只读采样</Typography.Title>
      <Space wrap>
        <label>起点（毫秒）<InputNumber aria-label="自动时间轴起点" value={view.timeRangeMs[0]} min={0} max={view.timeRangeMs[1]} precision={0}
          onChange={value => value !== undefined && rangeChange([value, view.timeRangeMs[1]])} /></label>
        <label>终点（毫秒）<InputNumber aria-label="自动时间轴终点" value={view.timeRangeMs[1]} min={view.timeRangeMs[0]} max={done.summary.durationMs} precision={0}
          onChange={value => value !== undefined && rangeChange([view.timeRangeMs[0], value])} /></label>
        <Button onClick={() => rangeChange([0, done.summary.durationMs])}>恢复完整时间范围</Button>
        <Select aria-label="自动伤害率模式" value={view.dpsMode} style={{ width: 210 }}
          options={[{ value: 'cumulative', label: '累计平均伤害率' }, { value: 'window', label: '滚动窗口伤害率' }] satisfies { value: AutomaticSkillView['dpsMode']; label: string }[]}
          onChange={(value: AutomaticSkillView['dpsMode']) => patch({ dpsMode: value })} />
      </Space>
      {done.series.length ? <>
        <Typography.Paragraph data-testid="automatic-sampling-evidence">请求间隔{done.seriesSamplingEvidence.requestedSampleEveryMs}毫秒；有效间隔{done.seriesSamplingEvidence.effectiveSampleEveryMs}毫秒；
          返回{done.seriesSamplingEvidence.finalPointCount}／候选{done.seriesSamplingEvidence.requestedPointCount}点；上限{done.seriesSamplingEvidence.maxSeriesPoints}点；
          {done.seriesSamplingEvidence.downsampled ? '已降采样' : '未降采样'}。保留真实起点与停止点，不插值或补点。</Typography.Paragraph>
        <div className="automatic-analysis-chart-key">{continuousCurves.map(key => <label key={key}><input type="checkbox" aria-label={curves[key]}
          checked={view.visibleCurves.includes(key)} onChange={event => patch({ visibleCurves: event.target.checked
            ? [...view.visibleCurves, key] : view.visibleCurves.filter(curve => curve !== key) })} />{curves[key]}</label>)}</div>
        <ContinuousAttackCharts points={done.series} attacks={index.attacks} view={chartView} durationMs={done.summary.durationMs}
          killedAtMs={done.summary.execution?.targetKilledAtMs ?? null} dpsWindowMs={archive.runRequest!.sampling.dpsWindowMs}
          onSelectAttack={row => select({ kind: 'attack', planKey: row.planKey, attackIndex: row.attackIndex, useRef: row.useRef })}
          markers={chartMarkers} onSelectMarker={key => { const marker = markers.find(row => row.key === key); if (marker) select(marker.selection); }}
          onRangeChange={rangeChange} onHover={setHovered} />
        <Typography.Paragraph role="status" aria-label="自动采样悬停详情">{hovered
          ? `真实采样${hovered.timeMs}毫秒：A生命${number(hovered.sourceHp)}，B生命${number(hovered.targetHp)}；A累计造成伤害${number(hovered.sourceDamageDealt)}，B累计造成伤害${number(hovered.targetDamageDealt)}`
          : '悬停只定位实际返回的采样点；精确施法、普攻及结算时刻见标记和下方表格。'}</Typography.Paragraph>
        <Typography.Paragraph type="secondary">双方总量曲线不按来源、类型或选中使用重算。零毫秒点可能已包含同刻提交伤害，起点伤害率不适用。窗口为闭区间；阶梯线只表示采样观察。</Typography.Paragraph>
      </> : <Alert type="info" content="未记录时间序列；完整累计、规则资格和已返回明细仍可查看。" />}
    </section>
    <section className="automatic-analysis-section" aria-label="自动完整来源分类">
      <Typography.Title heading={5}>完整来源与伤害类型贡献</Typography.Title>
      <Space wrap>
        <Select aria-label="自动伤害来源筛选" placeholder="全部来源" mode="multiple" allowClear value={view.sourceKeys} style={{ minWidth: 260, maxWidth: 600 }}
          options={sourceRows.map(([value, row]) => ({ value, label: sourceLabel(row) }))} onChange={(value: AutomaticSkillView['sourceKeys']) => patch({ sourceKeys: value })} />
        <Select aria-label="自动伤害类型筛选" placeholder="全部伤害类型" mode="multiple" allowClear value={view.damageTypes} style={{ minWidth: 190 }}
          options={[...new Set(allBreakdown.map(row => row.damageType))].map(value => ({ value, label: typeLabel(value) }))} onChange={(value: AutomaticSkillView['damageTypes']) => patch({ damageTypes: value })} />
        <Button onClick={() => patch({ sourceKeys: [], damageTypes: [] })}>清除来源与类型筛选</Button>
        <Select aria-label="自动来源拆分方式" value={view.breakdownMode} style={{ width: 170 }}
          options={[{ value: 'source', label: '按来源拆分' }, { value: 'type', label: '按伤害类型拆分' }] satisfies { value: AutomaticSkillView['breakdownMode']; label: string }[]}
          onChange={(value: AutomaticSkillView['breakdownMode']) => patch({ breakdownMode: value })} />
        <Select aria-label="自动来源金额指标" value={view.amountMetric} style={{ width: 160 }}
          options={amountMetrics.map(value => ({ value, label: amountLabels[value] }))} onChange={(value: AmountMetric) => patch({ amountMetric: value })} />
      </Space>
      <Typography.Paragraph>分类小计（整次运行{amountLabels[view.amountMetric]}）：<span data-testid="automatic-breakdown-subtotal">{number(filtered.breakdownSubtotal)}</span>。
        完整分类来自汇总，不按时间范围裁剪；四种金额分别观察，不能相加为总额。</Typography.Paragraph>
      <div className="automatic-analysis-contributions">{contributions.map(row => <button type="button" className="automatic-analysis-contribution" key={row.key}
        onClick={() => row.sourceKey ? patch({ sourceKeys: [row.sourceKey] }) : patch({ damageTypes: row.damageType ? [row.damageType] : [] })}>
        {row.sourceKey ? sourceLabel(sourceRows.find(([key]) => key === row.sourceKey)![1]) : `${typeLabel(row.labelKey)}（拥有者${sides[row.owner] ?? row.owner}，${sides[row.source] ?? row.source}→${sides[row.target] ?? row.target}）`}：
        {number(row.amount)}；{row.damageCount}笔；{row.proportion === null ? '无贡献比例' : `${number(row.proportion * 100)}%（同伤害方向全场分母）`}
        <span style={{ width: `${Math.min(100, (row.proportion ?? 0) * 100)}%` }} />
      </button>)}</div>
      <Table data={filtered.breakdown} rowKey={continuousBreakdownKey} pagination={{ pageSize: 10 }} scroll={{ x: 1100 }} columns={[
        { title: '真实来源', render: (_, row) => sourceLabel(row) }, { title: '伤害类型', render: (_, row) => typeLabel(row.damageType) }, { title: '全场结算笔数', dataIndex: 'damageCount' },
        ...amountMetrics.map(key => ({ title: amountLabels[key], render: (_: unknown, row: DamageBreakdown) => number(row[key]) }))
      ]} />
    </section>
    {children}
    <section className="automatic-analysis-section" aria-label="自动事实明细">
      <Typography.Title heading={5}>事实时间轴与已返回明细</Typography.Title>
      <Typography.Paragraph>时间范围按实际发生时刻筛选，普攻按开始时刻。来源与类型只筛选伤害及完整分类；完整累计、资格及总量曲线保持全场口径。</Typography.Paragraph>
      <Alert type={automaticStats?.truncated ? 'warning' : 'info'} content={done.outputMode === 'summary'
        ? `汇总模式未请求自动事实明细（未请求${automaticStats?.omittedCount ?? '未输出'}条）；完整累计与最后等待仍保留。`
        : `自动事实总计${automaticStats?.totalCount ?? '未输出'}，返回${automaticStats?.returnedCount ?? '未输出'}，预算丢弃${automaticStats?.droppedCount ?? '未输出'}；${archive.runRequest?.recordBudget?.maxAutomaticSkillRecords === 0 ? '自动记录预算为0；' : ''}${automaticStats?.truncated ? '明细不完整，不重建缺失资格历史。' : '按请求预算保留。'}`} />
      {retention.map(row => <Alert key={row.label} type={row.truncated ? 'warning' : 'info'} content={done.outputMode === 'summary'
        ? `汇总模式未请求${row.label}明细；空数组不表示未发生。`
        : `${row.label}记录返回${row.returned ?? '未输出'}／总计${row.total ?? '未输出'}，预算丢弃${row.dropped ?? '未输出'}；${row.budget === 0 ? '本类记录预算为0；' : ''}${row.truncated ? '本类明细不完整。' : '本类记录按预算保留。'}完整累计独立保留。`} />)}
      {done.outputMode !== 'summary' ? <svg role="img" aria-label="实际混合战斗时间轴" viewBox={done.resourceChangeSummary ? '0 0 1000 220' : '0 0 1000 180'} className="automatic-analysis-timeline">
        {['自动技能事实', '背景普攻开始', '逐笔伤害结算', '直接治疗结算', ...(done.resourceChangeSummary ? ['资源生命变化'] : [])].map((label, lane) => <g key={label}>
          <text x="5" y={46 + lane * 35} fontSize="12">{label}</text><line x1="125" x2="965" y1={42 + lane * 35} y2={42 + lane * 35} stroke="currentColor" opacity=".25" /></g>)}
        {markers.map(marker => <circle key={marker.key} cx={125 + 840 * (marker.timeMs - view.timeRangeMs[0]) / Math.max(1, view.timeRangeMs[1] - view.timeRangeMs[0])}
          cy={42 + marker.lane * 35} r={marker.selected ? 8 : 5} fill={marker.color} role="button" tabIndex={0} aria-label={`${marker.label}，${marker.timeMs}毫秒`}
          onClick={() => select(marker.selection)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(marker.selection); } }}>
          <title>{marker.label} · {marker.timeMs}毫秒</title></circle>)}
        <text x="125" y="18" fontSize="12">{view.timeRangeMs[0]}毫秒</text><text x="965" y="18" fontSize="12" textAnchor="end">{view.timeRangeMs[1]}毫秒</text>
      </svg> : null}
      <Typography.Paragraph type="secondary">各类记录保留各自原序；{done.resourceChangeSummary ? '伤害、直接治疗和资源变化由生命事实顺序连接。' : '同刻事实不推断跨类先后。'}历史等待只携带首个相关规则，完整等待集合以规则最后状态为准。</Typography.Paragraph>
      <ResourceChangeFacts done={done} range={view.timeRangeMs} onSelect={row => select({ kind: 'resource', healthOrder: row.healthOrder })} />
      <Typography.Title heading={6}>自动技能事实（当前返回{filtered.automatic.length}条）</Typography.Title>
      <Table<AutomaticSkillRecord> data={filtered.automatic} rowKey="sequence" pagination={{ pageSize: 10 }} scroll={{ x: 1200 }} columns={[
        { title: '自动内部序号', dataIndex: 'sequence' }, { title: '实际时刻', dataIndex: 'timeMs' }, { title: '技能', render: (_, row) => ruleName(row.ruleKey) },
        { title: '真实事实', render: (_, row) => recordLabels[row.kind] }, { title: '使用身份', render: (_, row) => row.useRef ?? '无使用' },
        { title: '相关技能／使用', render: (_, row) => row.relatedRuleKey ? `${ruleName(row.relatedRuleKey)} · ${row.relatedUseRef ?? '尚无使用'}` : '无关联' },
        { title: '原因', render: (_, row) => row.reason ? waitingLabels[row.reason as AutomaticSkillWaitingReason] ?? row.reason : row.kind === 'WAIT_CHANGED' ? '等待已清空' : '无' },
        { title: '下一检查', render: (_, row) => row.nextCheckAtMs === null ? '未知或不适用' : `${row.nextCheckAtMs}毫秒` },
        { title: '查看', render: (_, row) => <Button size="small" onClick={() => select({ kind: 'automatic', sequence: row.sequence })}>查看自动事实{row.sequence}</Button> }
      ]} />
      <Typography.Title heading={6}>背景普攻事实（当前返回{filtered.attacks.length}条）</Typography.Title>
      <Table data={filtered.attacks} rowKey={automaticAttackKey} pagination={{ pageSize: 10 }} scroll={{ x: 1000 }} columns={[
        { title: '计划', dataIndex: 'planKey' }, { title: '刀号', dataIndex: 'attackIndex' }, { title: '开始（毫秒）', dataIndex: 'startAtMs' },
        { title: '命中（毫秒）', dataIndex: 'hitAtMs' }, { title: '真实使用', dataIndex: 'useRef' },
        { title: '造成伤害', render: (_, row) => number(row.postDefenseDamage) }, { title: '实际扣血', render: (_, row) => number(row.actualHpLoss) },
        { title: '查看', render: (_, row) => <Button size="small" onClick={() => select({ kind: 'attack', planKey: row.planKey, attackIndex: row.attackIndex, useRef: row.useRef })}>查看第{row.attackIndex}刀</Button> }
      ]} />
      <Typography.Title heading={6}>逐笔伤害（当前返回{filtered.damage.length}条）</Typography.Title>
      <Typography.Paragraph>当前已返回记录的小计（{amountLabels[view.amountMetric]}）：<span data-testid="automatic-record-subtotal">{number(filtered.damageSubtotal)}</span>；只针对当前筛选，不能代替全场总额。</Typography.Paragraph>
      <Table data={filtered.damage} rowKey="damageId" pagination={{ pageSize: 10 }} scroll={{ x: 1200 }} columns={[
        { title: '伤害编号', dataIndex: 'damageId' }, { title: '实际时刻', dataIndex: 'timeMs' }, { title: '刀号', render: (_, row) => row.attackIndex ?? '无普攻刀号' },
        { title: '实际使用', render: (_, row) => row.useRef || '未提供使用关联' }, { title: '真实来源', render: (_, row) => sourceLabel({ ...row, damageCount: 1 }) },
        { title: '伤害类型', render: (_, row) => typeLabel(row.damageType) },
        ...amountMetrics.map(key => ({ title: amountLabels[key], render: (_: unknown, row: typeof index.damage[number]) => number(row[key]) })),
        { title: '查看', render: (_, row) => <Button size="small" onClick={() => select({ kind: 'damage', damageId: row.damageId })}>查看伤害{row.damageId}</Button> }
      ]} />
      <Typography.Title heading={6}>直接治疗（当前返回{filtered.healing.length}条）</Typography.Title>
      <Typography.Paragraph type="secondary">直接治疗数组不含全部吸血。展示编号始终保留冻结原数组位置，不随筛选重新编号。</Typography.Paragraph>
      <Table data={filtered.healing} rowKey="recordIndex" pagination={{ pageSize: 10 }} scroll={{ x: 1000 }} columns={[
        { title: '本档案展示编号', render: (_, item) => item.recordIndex + 1 }, { title: '实际时刻', render: (_, item) => item.row.timeMs },
        { title: '真实来源', render: (_, item) => healingOriginLabel(item.row) }, { title: '治疗方向', render: (_, item) => `${sides[item.row.source] ?? item.row.source}→${sides[item.row.target] ?? item.row.target}` },
        { title: '实际使用', render: (_, item) => item.row.useRef || '未提供使用关联' }, { title: '有效治疗', render: (_, item) => number(item.row.actualHealing) },
        { title: '溢出治疗', render: (_, item) => number(item.row.overheal) },
        { title: '查看', render: (_, item) => <Button size="small" onClick={() => select({ kind: 'healing', recordIndex: item.recordIndex })}>查看治疗{item.recordIndex + 1}</Button> }
      ]} />
    </section>
    <AutomaticSkillDetails archive={archive} index={index} view={view} onSelect={select} />
  </>;
}
