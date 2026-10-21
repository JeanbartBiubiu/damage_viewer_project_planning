import type { ProcessDefinition, ProcessInstanceSnapshot, SkillActionBinding, SkillActionPlan } from '../types/genericEngine';

type Hit = SkillActionBinding['hitBindings'][number];
export type SkillHitStageFact = NonNullable<ProcessInstanceSnapshot['skillHitStages']>[number];

export function hasProcessSkillHitStages(binding: SkillActionBinding, process: ProcessDefinition): boolean {
  return process.steps.every(step => ['IMMEDIATE', 'DELAY'].includes(step.stepType))
    && binding.hitBindings.some(hit => hit.moment.momentType === 'STEP_EXECUTION');
}

/** 使用不可截断的原生提交事实，不由详细记录或初始属性重算动态步骤时刻。 */
export function inspectProcessSkillHitStages(binding: SkillActionBinding, definition: ProcessDefinition, process: ProcessInstanceSnapshot,
  presets: SkillActionPlan['hitBindings'], observationEndMs: number): SkillHitStageFact[] | undefined {
  if (!hasProcessSkillHitStages(binding, definition)) return undefined;
  function fail(message: string): never { throw new Error(`processInstances.skillHitStages: ${message}`); }
  if (process.owner !== binding.source || process.providerRef !== binding.providerRef || process.skillKey !== binding.skillKey
    || process.processKey !== definition.processKey || definition.skillKey !== binding.skillKey) fail('阶段过程没有同一实际拥有者、挂载和技能身份');
  const facts = process.skillHitStages;
  if (!Array.isArray(facts) || facts.length > 64 || binding.hitBindings.length > 64) fail('缺少完整有限阶段事实');
  const byKey = new Map<string, Hit>();
  const indices = new Map(definition.steps.map((step, index) => [step.stepKey, index]));
  for (const hit of binding.hitBindings) {
    if (byKey.has(hit.hitBindingKey) || hit.processKey !== definition.processKey || hit.moment.momentType !== 'STEP_EXECUTION'
      || !indices.has(hit.moment.stepKey ?? '')) fail('绑定缺少唯一真实过程执行时点');
    byKey.set(hit.hitBindingKey, hit);
  }
  const byFact = new Map<string, SkillHitStageFact>();
  let previousIndex = -1, previousAt = process.startedAtMs;
  for (const fact of facts) {
    const hit = byKey.get(fact.hitBindingKey);
    const index = indices.get(fact.stepKey) ?? -1;
    if (Object.keys(fact).length !== 6 || Object.keys(fact).some(key => !['hitBindingKey', 'stepKey', 'timeMs', 'released', 'contact', 'completed'].includes(key))
      || !hit || hit.moment.stepKey !== fact.stepKey || byFact.has(fact.hitBindingKey) || index <= previousIndex
      || !Number.isSafeInteger(fact.timeMs) || fact.timeMs < previousAt || fact.timeMs > observationEndMs
      || typeof fact.released !== 'boolean' || typeof fact.contact !== 'boolean' || typeof fact.completed !== 'boolean') fail('阶段身份、顺序或真实执行时刻不合法');
    const priorKey = hit.requiresPriorHitBindingKey;
    const prior = priorKey ? byFact.get(priorKey) : undefined;
    if (priorKey && (!byKey.has(priorKey) || (indices.get(byKey.get(priorKey)!.moment.stepKey ?? '') ?? Infinity) >= index)) fail('前置不是同过程更早命中绑定');
    const eligible = !priorKey || prior?.contact === true && prior.completed === true;
    const preset = presets.find(row => row.hitBindingKey === hit.hitBindingKey);
    if (!preset || !['MISS', 'TARGET_HIT'].includes(preset.preset) || fact.released !== eligible
      || fact.contact && (!fact.released || preset.preset !== 'TARGET_HIT')
      || !fact.completed && (!eligible || preset.preset === 'MISS' || process.status === 'complete')) fail('释放、接触与本使用的实际前置资格或命中预设不一致');
    byFact.set(fact.hitBindingKey, fact); previousIndex = index; previousAt = fact.timeMs;
  }
  for (const hit of binding.hitBindings) {
    const index = indices.get(hit.moment.stepKey!)!;
    const executed = index + 1 < process.stepVersion || index + 1 === process.stepVersion && process.stepExecutionIndex > 0;
    if (executed !== byFact.has(hit.hitBindingKey)) fail('阶段事实与真实已提交步骤进度不一致');
  }
  return facts;
}

export function processSkillHitTimes(process: ProcessInstanceSnapshot, hit: Hit): number[] | undefined {
  if (!process.skillHitStages) return undefined;
  return process.skillHitStages.filter(fact => fact.hitBindingKey === hit.hitBindingKey && fact.contact).map(fact => fact.timeMs);
}
