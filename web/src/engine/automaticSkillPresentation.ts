import type { AbilityDefinition, AttackRecord, AutomaticSkillRecord, AutomaticSkillRule, CompileRequest, DamageBreakdown, DamageRecord,
  DoneResult, HealingRecord, ResourceChangeRecord, ProcessDefinition, ProcessInstanceSnapshot, RunRequest, SkillActionBinding } from '../types/genericEngine';
import type { OperationOrigin } from './simulation/model';
import { simulationAbility } from './simulationAdapter';
import { finiteRecastControls, processForSkillUse, recastUseOrdinal } from './finiteRecast';
import { continuousCurves, continuousSourceKey, type AmountMetric, type AttackSelection } from './continuousAttackPresentation';

/** 身份只在当前冻结档案内解释；治疗数组位置不是跨表身份。 */
export type AutomaticSelection = { kind: 'automatic'; sequence: number } | { kind: 'use'; useRef: string }
  | ({ kind: 'attack' } & AttackSelection) | { kind: 'damage'; damageId: number } | { kind: 'healing'; recordIndex: number } | { kind: 'resource'; healthOrder: number };
export type AutomaticSkillView = {
  timeRangeMs: [number, number]; dpsMode: 'cumulative' | 'window'; visibleCurves: string[];
  breakdownMode: 'source' | 'type'; amountMetric: AmountMetric; sourceKeys: string[]; damageTypes: string[];
  selection: AutomaticSelection | null;
};
export function initialAutomaticSkillView(durationMs: number): AutomaticSkillView {
  return { timeRangeMs: [0, durationMs], dpsMode: 'cumulative', visibleCurves: [...continuousCurves],
    breakdownMode: 'source', amountMetric: 'postDefenseDamage', sourceKeys: [], damageTypes: [], selection: null };
}
export type IndexedHealing = { recordIndex: number; row: HealingRecord };
export type AutomaticUseContext = {
  automatic: AutomaticSkillRecord[]; attacks: AttackRecord[]; damage: DamageRecord[];
  healing: IndexedHealing[]; resources: ResourceChangeRecord[]; processes: ProcessInstanceSnapshot[];
};
export type AutomaticPresentationIndex = {
  automatic: AutomaticSkillRecord[]; attacks: AttackRecord[]; damage: DamageRecord[]; healing: IndexedHealing[]; resources: ResourceChangeRecord[];
  byUse: Map<string, AutomaticUseContext>; automaticBySequence: Map<number, AutomaticSkillRecord>;
  damageById: Map<number, DamageRecord>; attackByIdentity: Map<string, AttackRecord>;
};
export function automaticAttackKey(row: AttackSelection) {
  return JSON.stringify([row.planKey, row.attackIndex, row.useRef]);
}
/** 随冻结输出建立一次索引，筛选不改写原数组或来源映射。 */
export function indexAutomaticPresentation(done: DoneResult): AutomaticPresentationIndex {
  const automatic = done.automaticSkillRecords ?? []; const attacks = done.attackRecords ?? []; const damage = done.damageRecords ?? [];
  const healing = (done.healingRecords ?? []).map((row, recordIndex) => ({ recordIndex, row }));
  const resources = done.resourceChangeRecords ?? [];
  const byUse = new Map<string, AutomaticUseContext>();
  const context = (useRef: string | null) => {
    if (!useRef) return null;
    let found = byUse.get(useRef);
    if (!found) { found = { automatic: [], attacks: [], damage: [], healing: [], resources: [], processes: [] }; byUse.set(useRef, found); }
    return found;
  };
  for (const row of automatic) context(row.useRef)?.automatic.push(row);
  for (const row of attacks) context(row.useRef)?.attacks.push(row);
  for (const row of damage) context(row.useRef)?.damage.push(row);
  for (const row of healing) context(row.row.useRef)?.healing.push(row);
  for (const row of resources) for (const useRef of new Set(row.contributors.map(contributor => contributor.useRef).filter((value): value is string => !!value))) context(useRef)?.resources.push(row);
  for (const row of done.finalSnapshot.processInstances ?? []) context(row.useKey)?.processes.push(row);
  return { automatic, attacks, damage, healing, resources, byUse,
    automaticBySequence: new Map(automatic.map(row => [row.sequence, row])), damageById: new Map(damage.map(row => [row.damageId, row])),
    attackByIdentity: new Map(attacks.map(row => [automaticAttackKey(row), row])) };
}
export function automaticDamageMatches(row: DamageBreakdown | DamageRecord, view: AutomaticSkillView) {
  return (!view.sourceKeys.length || view.sourceKeys.includes(continuousSourceKey(row)))
    && (!view.damageTypes.length || view.damageTypes.includes(row.damageType));
}
export function automaticWithinRange(timeMs: number, view: AutomaticSkillView) {
  return timeMs >= view.timeRangeMs[0] && timeMs <= view.timeRangeMs[1];
}
export function filterAutomaticPresentation(done: DoneResult, index: AutomaticPresentationIndex, view: AutomaticSkillView) {
  const automatic = index.automatic.filter(row => automaticWithinRange(row.timeMs, view));
  const attacks = index.attacks.filter(row => automaticWithinRange(row.startAtMs, view));
  const damage = index.damage.filter(row => automaticWithinRange(row.timeMs, view) && automaticDamageMatches(row, view));
  const healing = index.healing.filter(({ row }) => automaticWithinRange(row.timeMs, view));
  const resources = index.resources.filter(row => automaticWithinRange(row.timeMs, view));
  const breakdown = (done.summary.damageBreakdown ?? []).filter(row => automaticDamageMatches(row, view));
  return { automatic, attacks, damage, healing, resources, breakdown,
    breakdownSubtotal: breakdown.reduce((sum, row) => sum + row[view.amountMetric], 0),
    damageSubtotal: damage.reduce((sum, row) => sum + row[view.amountMetric], 0) };
}
export function resolveAutomaticSelection(index: AutomaticPresentationIndex, selection: AutomaticSelection | null) {
  const automatic = selection?.kind === 'automatic' ? index.automaticBySequence.get(selection.sequence) : undefined;
  const attack = selection?.kind === 'attack' ? index.attackByIdentity.get(automaticAttackKey(selection)) : undefined;
  const damage = selection?.kind === 'damage' ? index.damageById.get(selection.damageId) : undefined;
  const healing = selection?.kind === 'healing' ? index.healing.find(row => row.recordIndex === selection.recordIndex) : undefined;
  const resource = selection?.kind === 'resource' ? index.resources.find(row => row.healthOrder === selection.healthOrder) : undefined;
  const useRef = selection?.kind === 'use' ? selection.useRef : automatic?.useRef ?? attack?.useRef ?? damage?.useRef ?? healing?.row.useRef ?? null;
  return { automatic, attack, damage, healing, resource, useRef: useRef || null, context: useRef ? index.byUse.get(useRef) ?? null : null };
}
type OriginReference = Pick<HealingRecord, 'abilityRef' | 'operationRef' | 'source'>
  & { owner?: string; providerDefinitionRef?: string; operationPath?: string };
/** 只核对冻结映射；同名但无法唯一对应的节点不选一个来猜。 */
export function automaticOrigin(origins: OperationOrigin[], row: OriginReference) {
  const candidates = origins.filter(origin => origin.operationRef === row.operationRef
    && (origin.abilityRef === row.abilityRef || !!row.providerDefinitionRef && origin.providerDefinitionRef === row.providerDefinitionRef
      && origin.abilityRef.startsWith(`${row.owner ?? row.source}.provider[`))
    && (!row.operationPath || origin.compiledPaths.includes(row.operationPath)));
  return { origin: candidates.length === 1 ? candidates[0]! : null,
    issue: candidates.length === 1 ? null : candidates.length ? '冻结作者映射不唯一，保留原始引用与路径。' : '未能唯一核对冻结作者映射，保留原始引用与路径。' };
}

export type AutomaticUseOrigin = {
  rule: AutomaticSkillRule; binding: SkillActionBinding; control: SkillActionBinding['controls'][number];
  instance: ProcessInstanceSnapshot; ability: AbilityDefinition; process: ProcessDefinition;
  rulePath: string; bindingPath: string; abilityPath: string; processPath: string;
};
/** 使用来源由真实窗口、完整阶段和冻结绑定核对，字面引用不单独授予来源资格。 */
export function automaticUseOrigin(compile: CompileRequest, request: RunRequest | null, index: AutomaticPresentationIndex, useRef: string | null): {
  origin: AutomaticUseOrigin | null; issue: string | null;
} {
  const failure = (issue: string) => ({ origin: null, issue });
  const context = useRef ? index.byUse.get(useRef) : null;
  const definitions = compile.sharedProviders?.flatMap(p => p.processes ?? []) ?? [];
  const found = useRef && processForSkillUse([...index.byUse.values()].flatMap(c => c.processes), definitions, useRef);
  if (!context || !found) return failure('未能唯一核对该使用的真实过程，保留原记录，不推断作者来源。');
  const instance = found;
  const rules = request?.driverPlan.automaticSkills?.rules ?? [];
  const bindingRows = compile.rules.skillActionBindings ?? [];
  const candidates = rules.flatMap((rule, ruleIndex) => {
    const bindings = bindingRows.filter(row => row.bindingKey === rule.bindingKey);
    if (bindings.length !== 1) return [];
    const binding = bindings[0]!;
    const control = binding.controls.find(row => row.action === 'INITIAL');
    if (!control || control.action !== 'INITIAL' || binding.source !== instance.owner || binding.providerRef !== instance.providerRef
      || binding.skillKey !== instance.skillKey || control.processKey !== instance.processKey || rule.target !== instance.target
      || context.automatic.some(row => row.ruleKey !== rule.ruleKey)) return [];
    return [{ rule, ruleIndex, binding, control }];
  });
  if (candidates.length !== 1) return failure('该真实过程未唯一对应冻结自动规则与绑定；不按技能名称或使用字符串猜来源。');
  const { rule, ruleIndex, binding, control } = candidates[0]!;
  const actual = simulationAbility(compile, control.abilityRef);
  if (!actual || !control.abilityRef.startsWith(`${instance.owner}.provider[${instance.providerRef}].ability[`)
    || actual.mount.providerRef !== instance.providerRef || actual.mount.definitionRef !== binding.providerDefinitionRef
    || actual.ability.skillKey !== instance.skillKey || actual.ability.processControl?.action !== 'INITIAL'
    || actual.ability.processControl.processKey !== instance.processKey) return failure('冻结首次控制与真实提供者、技能或过程不一致，无法定位使用来源。');
  const processes = actual.provider.processes?.filter(row => row.processKey === instance.processKey) ?? [];
  if (processes.length !== 1 || processes[0]!.skillKey !== instance.skillKey) return failure('冻结编译过程缺失、重复或技能归属不一致，无法唯一定位。');
  const process = processes[0]!;
  if (binding.controls.length !== 1 && !finiteRecastControls(binding, process)) return failure('自动来源的控制集合不是唯一首次或明确有限重施。');
  const ordinal = useRef ? recastUseOrdinal(instance, process, useRef) : null;
  const actualControl = ordinal !== null && ordinal > 0 ? binding.controls.find(c => c.action === 'RECAST') : control;
  const resolved = actualControl && simulationAbility(compile, actualControl.abilityRef);
  if (!actualControl || !resolved || resolved.provider !== actual.provider || resolved.ability.processControl?.action !== actualControl.action
    || resolved.ability.processControl.processKey !== process.processKey) return failure('当前施放缺少同窗口真实控制。');
  const providerIndex = compile.sharedProviders!.indexOf(actual.provider);
  const abilityIndex = actual.provider.abilities!.indexOf(resolved.ability);
  const processIndex = actual.provider.processes!.indexOf(process);
  return { issue: null, origin: { rule, binding, control: actualControl, instance, ability: resolved.ability, process,
    rulePath: `driverPlan.automaticSkills.rules[${ruleIndex}]`, bindingPath: `rules.skillActionBindings[${bindingRows.indexOf(binding)}]`,
    abilityPath: `sharedProviders[${providerIndex}].abilities[${abilityIndex}]`, processPath: `sharedProviders[${providerIndex}].processes[${processIndex}]` } };
}
