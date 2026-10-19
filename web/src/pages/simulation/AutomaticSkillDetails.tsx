import { Alert, Button, Space, Typography } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import type { AutomaticSkillArchive } from './SimulationScenarioPanel';
import { JsonBlock } from '../../components/JsonBlock';
import { amountLabels, amountMetrics, formatContinuousAmount as number } from '../../engine/continuousAttackPresentation';
import { automaticDamageMatches, automaticOrigin, automaticUseOrigin, automaticWithinRange, resolveAutomaticSelection,
  type AutomaticPresentationIndex, type AutomaticSelection, type AutomaticSkillView } from '../../engine/automaticSkillPresentation';

function frozenPath(input: unknown, path: string) {
  let value = input;
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) return null;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
function show(value: unknown) {
  return value === null || value === undefined || value === '' ? '未提供／不适用'
    : typeof value === 'number' ? number(value) : typeof value === 'boolean' ? value ? '是' : '否' : String(value);
}
function Values({ values }: { values: [string, unknown][] }) {
  return <dl>{values.map(([label, value]) => <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{show(value)}</dd></div>)}</dl>;
}
export function AutomaticSkillDetails({ archive, index, view, onSelect }: {
  archive: AutomaticSkillArchive; index: AutomaticPresentationIndex; view: AutomaticSkillView; onSelect: (selection: AutomaticSelection | null) => void;
}) {
  const selected = resolveAutomaticSelection(index, view.selection);
  const [showOrigin, setShowOrigin] = useState(false);
  const [showUseOrigin, setShowUseOrigin] = useState(false);
  useEffect(() => { setShowOrigin(false); setShowUseOrigin(false); }, [view.selection, archive.runResult]);
  if (!view.selection) return null;
  const done = archive.runResult!;
  const settlement = selected.damage ?? selected.healing?.row;
  const origin = settlement ? automaticOrigin(archive.operationOrigins, settlement) : null;
  const automatic = selected.automatic;
  const context = selected.context;
  const showUseSource = !!selected.useRef && (view.selection.kind === 'use' || !!context?.automatic.length
    || !!context?.processes.length && !context?.attacks.length);
  const useSource = showUseSource ? automaticUseOrigin(archive.compileRequest, archive.runRequest, index, selected.useRef) : null;
  const frozenSkills = useSource?.origin ? archive.snapshot.skillConfigurations.filter(row => row.skill.skillKey === useSource.origin!.instance.skillKey) : [];
  const hiddenDamage = (row: typeof index.damage[number]) => !automaticWithinRange(row.timeMs, view) || !automaticDamageMatches(row, view);
  return <section className="automatic-analysis-detail" aria-label="自动选中项详情" onKeyDown={event => event.key === 'Escape' && onSelect(null)}>
    <Space wrap><Typography.Title heading={5}>选中项详情</Typography.Title><Button onClick={() => onSelect(null)}>关闭详情</Button></Space>
    <Typography.Paragraph className="automatic-analysis-path">实际使用身份：{selected.useRef ?? '原记录未提供；不按时刻猜归属'}。</Typography.Paragraph>
    {automatic ? <>
      <Typography.Paragraph>自动事实序号{automatic.sequence}仅表示自动记录内部顺序。当前规则：{automatic.ruleKey}；相关规则：{automatic.relatedRuleKey ?? '无'}。</Typography.Paragraph>
      {automatic.kind === 'QUALIFICATION_CONSUMED' ? <Typography.Paragraph>消费者使用：{automatic.useRef ?? '未提供'}；授予者相关使用：{automatic.relatedUseRef ?? '未提供'}。以下只列消费者本次使用，不合并授予者。</Typography.Paragraph>
        : automatic.relatedUseRef ? <Typography.Paragraph>原记录明确提供的相关使用：{automatic.relatedUseRef}，与当前使用分别展示。</Typography.Paragraph> : null}
      {automatic.relatedUseRef ? <Button onClick={() => onSelect({ kind: 'use', useRef: automatic.relatedUseRef! })}>查看相关使用{automatic.relatedUseRef}</Button> : null}
      <JsonBlock value={automatic} />
    </> : null}
    {selected.attack ? <>
      <Typography.Title heading={6}>第{selected.attack.attackIndex}刀真实事实</Typography.Title>
      <Typography.Paragraph className="automatic-analysis-path">计划{selected.attack.planKey}；使用{selected.attack.useRef}。</Typography.Paragraph>
      <Values values={[
        ['开始（毫秒）', selected.attack.startAtMs], ['命中（毫秒）', selected.attack.hitAtMs], ['最终普攻就绪（毫秒）', selected.attack.finalReadyAtMs],
        ['机制就绪（毫秒）', selected.attack.mechanicReadyAtMs], ['行动就绪贡献（毫秒）', selected.attack.actionReadyAtMs],
        ['真实攻速', selected.attack.attackSpeed], ['造成伤害', selected.attack.postDefenseDamage], ['实际扣血', selected.attack.actualHpLoss], ['尾部完成', selected.attack.completed]
      ]} /><JsonBlock value={selected.attack} />
    </> : null}
    {selected.damage ? <section aria-label="自动伤害结算详情">
      <Typography.Title heading={6}>伤害编号{selected.damage.damageId}</Typography.Title>
      <Values values={[
        ['实际时刻（毫秒）', selected.damage.timeMs], ['普攻刀号', selected.damage.attackIndex], ['使用身份', selected.damage.useRef],
        ['命中身份', selected.damage.hitRef], ['原生指令身份', selected.damage.instructionKey], ['真实拥有者', selected.damage.owner],
        ['伤害方', selected.damage.source], ['受伤方', selected.damage.target], ['伤害类型', selected.damage.damageType],
        ['防御前输入金额', selected.damage.rawAmount], ...amountMetrics.map(key => [amountLabels[key], selected.damage![key]] as [string, unknown]),
        ['生命之前', selected.damage.hpBefore], ['生命之后', selected.damage.hpAfter]
      ]} /><JsonBlock value={selected.damage} />
    </section> : null}
    {selected.healing ? <section aria-label="自动直接治疗详情"><Typography.Title heading={6}>直接治疗{selected.healing.recordIndex + 1}</Typography.Title>
      <Typography.Paragraph>冻结原数组位置{selected.healing.recordIndex}仅作为展示键；直接治疗明细不代表全部吸血。</Typography.Paragraph>
      <Values values={[
        ['实际时刻（毫秒）', selected.healing.row.timeMs], ['治疗方', selected.healing.row.source], ['受治疗方', selected.healing.row.target],
        ['原生指令身份', selected.healing.row.instructionKey], ['有效治疗', selected.healing.row.actualHealing], ['溢出治疗', selected.healing.row.overheal],
        ['生命之前', selected.healing.row.hpBefore], ['生命之后', selected.healing.row.hpAfter]
      ]} /><JsonBlock value={selected.healing.row} />
    </section> : null}
    {selected.resource ? <section aria-label="自动资源生命详情"><Typography.Title heading={6}>资源生命变化{selected.resource.healthOrder}</Typography.Title>
      <Typography.Paragraph>这是一批实际可见的上限与当前生命变化，不计入治疗。各贡献保留自身来源及已知使用归属。</Typography.Paragraph>
      <JsonBlock value={selected.resource} />
    </section> : null}
    {context ? <section aria-label="自动同次使用上下文">
      <Typography.Title heading={6}>同次使用上下文的已返回结算</Typography.Title>
      <Typography.Paragraph>自动事实{context.automatic.length}条，背景普攻{context.attacks.length}条，伤害{context.damage.length}笔，直接治疗{context.healing.length}笔。
        这些是已返回记录，不等于该技能完整总额。无显式使用身份的周期、被动或其他结算不强行归入。</Typography.Paragraph>
      <Space wrap>{context.damage.map(row => <Button key={row.damageId} onClick={() => onSelect({ kind: 'damage', damageId: row.damageId })}>
        结算编号{row.damageId}{hiddenDamage(row) ? '（主表已隐藏）' : ''}</Button>)}
        {context.healing.map(({ row, recordIndex }) => <Button key={recordIndex} onClick={() => onSelect({ kind: 'healing', recordIndex })}>
          直接治疗{recordIndex + 1}{automaticWithinRange(row.timeMs, view) ? '' : '（主表已隐藏）'}</Button>)}
        {context.attacks.map(row => <Button key={JSON.stringify([row.planKey, row.attackIndex, row.useRef])} onClick={() => onSelect({ kind: 'attack', planKey: row.planKey, attackIndex: row.attackIndex, useRef: row.useRef })}>
          背景普攻第{row.attackIndex}刀{automaticWithinRange(row.startAtMs, view) ? '' : '（主表已隐藏）'}</Button>)}</Space>
      {!context.damage.length && !context.healing.length ? <Typography.Paragraph>没有返回该使用的结算记录，不能据此判断为零伤害或没有治疗。</Typography.Paragraph> : null}
      {context.processes.length ? <><Typography.Paragraph>以下为本次冻结的真实过程事实。</Typography.Paragraph>{context.processes.map(row => <JsonBlock key={JSON.stringify([row.owner, row.providerRef, row.useKey])} value={row} />)}</> : null}
    </section> : <Alert type="info" content={selected.useRef ? '未保留该使用的上下文记录，不恢复缺失历史。' : '原记录未提供使用身份，保留独立事实，不制造一次施法或零伤害详情。'} />}
    {done.outputMode === 'summary' ? <Alert type="info" content="汇总模式未请求事实明细，完整累计和最后状态独立保留。" /> : <>
      {done.automaticSkillRecording?.truncated ? <Alert type="warning" content="自动事实不完整，当前使用可能缺少部分开始、终结或资格记录。" /> : null}
      {done.recording?.damageRecordsTruncated ? <Alert type="warning" content="伤害明细不完整，当前使用的已返回结算不能视为完整伤害。" /> : null}
      {done.recording?.healingRecordsTruncated ? <Alert type="warning" content="直接治疗明细不完整，不能把缺失记录解释为没有治疗。" /> : null}
      {done.recording?.attackRecordsTruncated ? <Alert type="warning" content="普攻明细不完整，未返回的普攻事实不按间隔外推。" /> : null}
    </>}
    {useSource ? <section aria-label="自动使用作者来源">
      <Typography.Title heading={6}>使用级冻结作者与编译过程</Typography.Title>
      <Typography.Paragraph>使用级来源不要求返回伤害或治疗，不把未命中、零明细预算或缺失结算解释为零伤害；以下不构造结果操作。</Typography.Paragraph>
      {useSource.issue ? <Alert type="warning" content={useSource.issue} /> : null}
      {useSource.origin ? <>
        <Values values={[
          ['实际技能标识', useSource.origin.instance.skillKey], ['实际提供者', useSource.origin.instance.providerRef],
          ['实际过程标识', useSource.origin.instance.processKey], ['自动规则标识', useSource.origin.rule.ruleKey],
          ['冻结绑定标识', useSource.origin.binding.bindingKey], ['首次控制能力', useSource.origin.control.abilityRef]
        ]} />
        <Typography.Paragraph className="automatic-analysis-path">编译绑定路径：{useSource.origin.bindingPath}；
          编译控制路径：{useSource.origin.abilityPath}；编译过程路径：{useSource.origin.processPath}；冻结请求规则路径：{useSource.origin.rulePath}。</Typography.Paragraph>
        {frozenSkills.length !== 1 ? <Alert type="warning" content="冻结技能详情缺失或同标识重复；保留实际标识，不按名称选择作者配置。" /> : null}
        <Button onClick={() => setShowUseOrigin(current => !current)}>定位冻结技能与编译过程</Button>
        {showUseOrigin ? <><Typography.Paragraph>以下仅来自本次冻结档案，不读取最新管理数据；编译过程是使用定义，不代表已执行其中所有操作。</Typography.Paragraph>
          {frozenSkills.length === 1 ? <JsonBlock value={frozenSkills[0]} /> : null}
          <JsonBlock value={useSource.origin.instance} /><JsonBlock value={useSource.origin.rule} />
          <JsonBlock value={useSource.origin.binding} /><JsonBlock value={useSource.origin.ability} /><JsonBlock value={useSource.origin.process} />
        </> : null}
      </> : null}
    </section> : null}
    {settlement ? <section aria-label="自动冻结作者来源">
      <Typography.Paragraph className="automatic-analysis-path">能力：{settlement.abilityRef}；作者结果：{settlement.operationRef}。
        {selected.damage ? `编译路径：${selected.damage.operationPath}。` : ''}</Typography.Paragraph>
      {origin?.issue ? <Alert type="warning" content={origin.issue} /> : null}
      <Button onClick={() => setShowOrigin(current => !current)}>定位冻结作者与编译节点</Button>
      {showOrigin ? <><Typography.Paragraph>以下仅来自本次冻结档案，不读取最新管理数据。</Typography.Paragraph>
        {origin?.origin ? <><JsonBlock value={origin.origin} /><JsonBlock value={archive.snapshot.skillConfigurations.find(row => row.skill.skillKey === origin.origin!.skillKey)} /></> : null}
        {selected.damage ? <JsonBlock value={frozenPath(archive.compileRequest, selected.damage.operationPath)} />
          : origin?.origin ? origin.origin.compiledPaths.map(path => <div key={path}><Typography.Text className="automatic-analysis-path">{path}</Typography.Text><JsonBlock value={frozenPath(archive.compileRequest, path)} /></div>) : null}
      </> : null}
    </section> : null}
  </section>;
}
