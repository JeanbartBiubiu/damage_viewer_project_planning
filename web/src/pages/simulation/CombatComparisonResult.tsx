import { Alert, Button, Typography } from '@arco-design/web-react';
import { useId, useState, type ReactNode } from 'react';
import type { CombatComparisonAssessment } from '../../engine/combatComparison';
import { formatContinuousAmount as number } from '../../engine/continuousAttackPresentation';
import type { SimulationSelectedEquipment } from '../../types/simulationSnapshot';
import { CombatComparisonCharts, comparisonStopLabels } from './CombatComparisonCharts';
import type { AutomaticSkillArchive, ContinuousAttackArchive } from './SimulationScenarioPanel';
import './CombatComparison.css';

type ComparisonArchive = AutomaticSkillArchive | ContinuousAttackArchive;
type Metric = CombatComparisonAssessment['metrics'][number];
type Source = CombatComparisonAssessment['sources'][number];
type Props = {
  a: ComparisonArchive;
  b: ComparisonArchive;
  assessment: CombatComparisonAssessment;
  onDownload: () => void;
  renderDetails: (archive: ComparisonArchive) => ReactNode;
};

const phaseLabels: Record<NonNullable<ComparisonArchive['failurePhase']>, string> = {
  reading: '读取场景资料', preparing: '准备计算', compiling: '编译配置', running: '执行计算', releasing: '释放会话'
};
const cleanupLabels: Record<ComparisonArchive['cleanup'], string> = {
  not_needed: '尚未产生可释放会话', released: '会话已正常释放',
  worker_destroyed: '计算线程已销毁', release_failed: '会话释放失败'
};
const sourceLabels: Record<Source['kind'], string> = {
  paired: '已配对', only_a: '仅方案 A 结算', only_b: '仅方案 B 结算', unpaired: '未配对'
};

function signed(value: number, unit = '') {
  return `${value > 0 ? '+' : ''}${number(value)}${unit}`;
}

function amount(value: number | null) {
  return value === null ? '—' : number(value);
}

function relativeChange(baseline: number | null, delta: number | null, relativeDelta: number | null) {
  if (relativeDelta !== null) return signed(relativeDelta * 100, '%');
  return baseline === 0 && delta !== null ? '不适用（基准为 0）' : '—';
}

function ComparisonTable({ label, columns, children }: { label: string; columns: string[]; children: ReactNode }) {
  return <div className="combat-comparison-table-scroll" role="region" aria-label={label} tabIndex={0}>
    <table aria-label={label}>
      <thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}

function equipmentNames(items: SimulationSelectedEquipment[]) {
  return items.map(({ equipment }) => equipment.name).join('、') || '无';
}

function ComparisonConditions({ a, b }: Pick<Props, 'a' | 'b'>) {
  const { source, target, selection, catalogs } = a.snapshot;
  const keysA = new Set(selection.sourceEquipmentKeys);
  const keysB = new Set(b.snapshot.selection.sourceEquipmentKeys);
  const shared = source.selectedEquipment.filter(({ equipment }) => keysB.has(equipment.equipmentKey));
  const itemA = source.selectedEquipment.find(({ equipment }) => !keysB.has(equipment.equipmentKey));
  const itemB = b.snapshot.source.selectedEquipment.find(({ equipment }) => !keysA.has(equipment.equipmentKey));
  const changes = itemA && itemB ? '替换一件装备' : itemA ? '卸下一件装备' : itemB ? '增补一件装备' : '攻击方装备相同';
  const attributesA = itemA?.attributes.attributeValues ?? {};
  const attributesB = itemB?.attributes.attributeValues ?? {};
  const attributeNames = new Map(catalogs.attributes.map(attribute => [attribute.attributeKey, attribute.name]));
  const attributeKeys = [...new Set([...Object.keys(attributesA), ...Object.keys(attributesB)])];
  const request = a.runRequest ?? b.runRequest;

  return <section className="combat-comparison-section" aria-label="共同条件和装备差异">
    <Typography.Title heading={5}>共同条件与装备差异</Typography.Title>
    <dl className="combat-comparison-facts">
      <dt>攻击方</dt><dd>{source.character.name}（等级 {selection.sourceLevel}）</dd>
      <dt>目标</dt><dd>{target.character.name}（等级 {selection.targetLevel}）</dd>
      <dt>攻击方共有装备</dt><dd>{equipmentNames(shared)}</dd>
      <dt>目标装备</dt><dd>{equipmentNames(target.selectedEquipment)}</dd>
      {request ? <><dt>观察时长</dt><dd>{number(request.stopPolicy.durationMs)} 毫秒</dd>
        <dt>背景普攻</dt><dd>{request.driverPlan.basicAttack ? '开启' : '关闭'}</dd></> : null}
    </dl>
    <p><strong>{changes}</strong>{itemA || itemB ? ` · 方案 A ${itemA?.equipment.name ?? '空槽'} → 方案 B ${itemB?.equipment.name ?? '空槽'}` : ''}</p>
    {attributeKeys.length ? <ComparisonTable label="变动装备的直接属性" columns={['装备直接属性', '方案 A', '方案 B', '差值（B − A）']}>
      {attributeKeys.map(key => {
        const left = attributesA[key] ?? 0;
        const right = attributesB[key] ?? 0;
        return <tr key={key}><th scope="row">{attributeNames.get(key) ?? key}</th>
          <td>{number(left)}</td><td>{number(right)}</td><td>{signed(right - left)}</td></tr>;
      })}
    </ComparisonTable> : itemA || itemB ? <p>变动装备无直接属性。</p> : null}
  </section>;
}

function ComparisonMetrics({ metrics, durationA, durationB }: { metrics: Metric[]; durationA: number; durationB: number }) {
  const differentTimes = durationA !== durationB;
  return <section className="combat-comparison-section" aria-label="核心指标">
    <Typography.Title heading={5}>核心指标</Typography.Title>
    <ComparisonTable label="核心指标对比" columns={[differentTimes ? '指标（截至各自实际停止时刻）' : '指标', '方案 A', '方案 B', '差值（B − A）', '变化比例']}>
      {metrics.map(metric => {
        const { key, label, a, b, delta, relativeDelta, reason } = metric;
        const killTime = key === 'targetKilledAtMs';
        const averageDps = key === 'averageDps';
        const valueText = (value: number | null, duration: number) => {
          if (killTime) return value === null ? '观察期内未击杀' : `${number(value)} 毫秒`;
          if (averageDps && duration === 0) return '不适用（0 毫秒停止）';
          return amount(value);
        };
        let deltaText = delta === null ? '—' : signed(delta);
        if (killTime && delta !== null) {
          deltaText = delta === 0 ? '同刻击杀（0 毫秒）' : `${delta < 0 ? '提前' : '延后'} ${number(Math.abs(delta))} 毫秒`;
        } else if (averageDps && delta === null && reason) {
          deltaText = reason;
        }
        return <tr key={key}><th scope="row">{label}</th>
          <td>{valueText(a, durationA)}</td><td>{valueText(b, durationB)}</td>
          <td className={averageDps && delta === null ? 'combat-comparison-note' : undefined}>{deltaText}</td>
          <td>{killTime ? '—' : relativeChange(a, delta, relativeDelta)}</td></tr>;
      })}
    </ComparisonTable>
  </section>;
}

function SourceDifferences({ sources }: { sources: Source[] }) {
  const comparable = sources.filter(source => source.kind !== 'unpaired');
  const unpaired = sources.filter(source => source.kind === 'unpaired');
  return <section className="combat-comparison-section" aria-label="伤害来源贡献">
    <Typography.Title heading={5}>伤害来源贡献</Typography.Title>
    <p>贡献差值分解两套方案的结算结果。属性面板、冷却急速和停止时刻都可能影响各来源的伤害。</p>
    {comparable.length ? <ComparisonTable label="已配对与单方结算来源" columns={['来源', '结算情况', '方案 A 伤害', '方案 B 伤害', '差值（B − A）', '变化比例', '方案 A 次数', '方案 B 次数']}>
      {comparable.map(source => <tr key={source.key}>
        <th scope="row">{source.label}</th><td>{sourceLabels[source.kind]}</td>
        <td>{amount(source.amountA)}</td><td>{amount(source.amountB)}</td>
        <td>{source.delta === null ? '—' : signed(source.delta)}</td>
        <td>{relativeChange(source.amountA, source.delta, source.relativeDelta)}</td>
        <td>{amount(source.countA)}</td><td>{amount(source.countB)}</td>
      </tr>)}
    </ComparisonTable> : <p>{unpaired.length ? '当前没有可配对或已证实只在单方结算的来源。' : '两套方案均无伤害结算来源。'}</p>}
    {unpaired.length ? <>
      <Typography.Title heading={6}>未配对来源</Typography.Title>
      <p>来源身份未能唯一配对，按方案分别列出已记录的伤害与次数。</p>
      <ComparisonTable label="未配对来源" columns={['来源', '方案', '伤害', '结算次数']}>
        {unpaired.flatMap(source => ([['A', source.amountA, source.countA], ['B', source.amountB, source.countB]] as const)
          .filter(([, value]) => value !== null).map(([plan, value, count]) => <tr key={`${plan}-${source.key}`}>
            <th scope="row">{source.label}{source.reason ? <small>{source.reason}</small> : null}</th>
            <td>方案 {plan}</td><td>{amount(value)}</td><td>{amount(count)}</td>
          </tr>))}
      </ComparisonTable>
    </> : null}
  </section>;
}

function IncompletePlan({ archive, plan }: { archive: ComparisonArchive; plan: 'A' | 'B' }) {
  const { error, failurePhase, outcome, cleanup, assessment, runResult } = archive;
  const summary = runResult?.summary;
  const issues = assessment?.issues ?? [];
  const reasons = [
    failurePhase ? `失败阶段为${phaseLabels[failurePhase]}` : null,
    outcome === 'cancelled' ? '计算已取消' : null,
    error,
    cleanup === 'worker_destroyed' || cleanup === 'release_failed' ? cleanupLabels[cleanup] : null,
    summary?.stopReason === 'budget_exceeded' ? comparisonStopLabels.budget_exceeded : null,
    summary?.execution?.incompleteReason === 'unfinished_tail' ? '同步尾部未完成' : null
  ].filter(Boolean);
  if (!reasons.length && !issues.length) {
    if (outcome === 'passed' && assessment?.complete && assessment.factsValid && cleanup === 'released') return null;
    reasons.push('缺少完整的运行结果或核对记录');
  }
  return <div className="combat-comparison-diagnostics">
    <strong>方案 {plan}</strong>
    <ul>{[...reasons, ...issues].map((issue, index) => <li key={index}>{issue}</li>)}</ul>
  </div>;
}

function OriginalDetails({ a, b, renderDetails, detailsTruncated }: Pick<Props, 'a' | 'b' | 'renderDetails'> & { detailsTruncated: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<'A' | 'B'>('A');
  const name = useId();
  return <details className="combat-comparison-fold" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>各方案完整明细</summary>
    {expanded ? <>
      <fieldset className="combat-comparison-detail-switch">
        <legend>查看方案</legend>
        {(['A', 'B'] as const).map(plan => <label key={plan}>
          <input type="radio" name={name} checked={selected === plan} onChange={() => setSelected(plan)} />方案 {plan}
        </label>)}
      </fieldset>
      {detailsTruncated ? <p>至少一套方案仅保存汇总或明细已截断。下方显示所选方案已记录的明细。</p> : null}
      <div key={selected}>{renderDetails(selected === 'A' ? a : b)}</div>
    </> : null}
  </details>;
}

export function CombatComparisonResult({ a, b, assessment, onDownload, renderDetails }: Props) {
  const { stopCategory, metrics, sources, detailsTruncated } = assessment;
  const runA = a.runResult;
  const runB = b.runResult;
  const complete = stopCategory !== 'incomplete' && runA && runB;
  return <section className="combat-comparison" aria-label="出装比较结果">
    <header className="combat-comparison-header">
      <Typography.Title heading={4}>出装比较结果</Typography.Title>
      <Button onClick={onDownload}>下载出装比较档案</Button>
    </header>
    {complete ? <>
      <ComparisonConditions a={a} b={b} />
      {stopCategory === 'early_stop_non_kill' ? <Alert type="info" content="有方案提前停止。累计指标统计至各自实际停止时刻。" /> : null}
      <div className="combat-comparison-stops">
        {[runA, runB].map(({ summary }, index) => <div key={index}>
          <strong>方案 {index === 0 ? 'A' : 'B'}</strong>
          <span>{number(summary.durationMs)} 毫秒停止 · {comparisonStopLabels[summary.stopReason]}</span>
        </div>)}
      </div>
      <ComparisonMetrics metrics={metrics} durationA={runA.summary.durationMs} durationB={runB.summary.durationMs} />
      <section className="combat-comparison-section" aria-label="时间序列对比">
        <Typography.Title heading={5}>时间序列对比</Typography.Title>
        {detailsTruncated ? <Alert type="warning" content="至少一套方案仅保存汇总或明细已截断。汇总指标、来源贡献及时间序列各自独立记录。" /> : null}
        <CombatComparisonCharts a={runA} b={runB} />
      </section>
      <SourceDifferences sources={sources} />
    </> : <>
      <Alert type="warning" content="计算未完整完成或结果核对未通过。已记录的结果可在各方案明细中用于排错。" />
      <IncompletePlan archive={a} plan="A" />
      <IncompletePlan archive={b} plan="B" />
    </>}
    <OriginalDetails a={a} b={b} renderDetails={renderDetails} detailsTruncated={Boolean(complete) && detailsTruncated} />
    <details className="combat-comparison-fold">
      <summary>技术与调试详情</summary>
      {[a, b].map((archive, index) => <section key={index} className="combat-comparison-diagnostics" aria-label={`方案 ${index === 0 ? 'A' : 'B'}技术信息`}>
        <strong>方案 {index === 0 ? 'A' : 'B'}</strong>
        <dl className="combat-comparison-facts">
          <dt>会话状态</dt><dd>{cleanupLabels[archive.cleanup]}</dd>
          <dt>场景资料摘要</dt><dd><code>{archive.snapshotDigest}</code></dd>
          <dt>运行输入摘要</dt><dd><code>{archive.runInputHash ?? '未生成'}</code></dd>
          <dt>编译规则摘要</dt><dd><code>{archive.compileRequest.rulesHash}</code></dd>
          <dt>引擎摘要</dt><dd><code>{archive.wasm.sha256}</code></dd>
          {archive.runResult?.summary.execution?.budgetCause ? <><dt>预算项</dt><dd><code>{archive.runResult.summary.execution.budgetCause}</code></dd></> : null}
        </dl>
      </section>)}
    </details>
  </section>;
}
