import type { AutomaticSkillRule, RunRequest } from '../types/genericEngine';
import type { SimulationPlannedSkill, SimulationSnapshot } from '../types/simulationSnapshot';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';
import type { assembleSimulation } from './simulationAdapter';
import { simulationAbility } from './simulationAdapter';
import { finitePeriodicTargetsOpponent } from './finiteImmediatePeriodicContract';
import { continuousAttackRequest, type AttackSpeedAdmission } from './continuousAttackRequest';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import { simulationHash } from './simulationHash';
import { empoweredAttackBinding, requireEmpoweredBasicAttack } from './empoweredAttackContract';
import { tryFoldConstant } from './numericAdapter';
import { automaticProcessStepsAllowed } from './processSkillHitStages';
import { drivenActiveAmmo } from './simulationAmmoMechanics';
import type { SkillConfiguration } from '../types/skillConfiguration';
import { automaticSkillPhases, finiteRecastControls } from './finiteRecast';

export type AutomaticSkillInput = Pick<SimulationPlannedSkill, 'origin' | 'skillKey' | 'skillLevel'> & {
  ruleKey: string; sortOrder: number; targetSide: 'source' | 'target'; hitPreset: 'TARGET_HIT' | 'MISS' | null;
  waitForCooldowns: string[]; releaseAfterRuleKey: string | null;
};
export type AutomaticSkillInputs = {
  rules: AutomaticSkillInput[]; durationMs: number; recordTimeSeries: boolean; attackSpeedInputMax?: number;
  maxAutomaticSkillRecords: number; maxHealingRecords: number; maxResourceChangeRecords?: number; outputMode: 'detailed' | 'summary';
};
export type PreparedAutomaticSkill = { runRequest: RunRequest; runInputHash: string; attackSpeedAdmission: AttackSpeedAdmission | null };
const keyPattern = /^[a-z][a-z0-9_]{0,63}$/;
function integer(value: number, maximum: number, path: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${path}: 需要0～${maximum}的明确整数`);
}

/** 资格图与关联冷却图分别核对，冷却相互等待不属于资格环。 */
export function validateAutomaticSkillRelations(rules: readonly Pick<AutomaticSkillInput, 'ruleKey' | 'sortOrder' | 'waitForCooldowns' | 'releaseAfterRuleKey'>[]) {
  if (!Array.isArray(rules) || !rules.length || rules.length > 16) throw new Error('automaticSkills.rules: 需要1～16项明确规则');
  const keys = new Set<string>();
  const priorities = new Set<number>();
  for (const [index, rule] of rules.entries()) {
    const path = `automaticSkills.rules[${index}]`;
    if (!rule || !keyPattern.test(rule.ruleKey) || keys.has(rule.ruleKey)) throw new Error(`${path}.ruleKey: 规则标识需要合法且唯一`);
    integer(rule.sortOrder, 15, `${path}.sortOrder`);
    if (priorities.has(rule.sortOrder)) throw new Error(`${path}.sortOrder: 优先级不能重复`);
    keys.add(rule.ruleKey); priorities.add(rule.sortOrder);
  }
  const successors = new Set<string>();
  for (const [index, rule] of rules.entries()) {
    const path = `automaticSkills.rules[${index}]`;
    if (!Array.isArray(rule.waitForCooldowns)) throw new Error(`${path}.waitForCooldowns: 必须明确提供关联数组`);
    const refs = new Set<string>();
    for (const [position, ref] of rule.waitForCooldowns.entries()) {
      if (!keys.has(ref) || ref === rule.ruleKey || refs.has(ref)) throw new Error(`${path}.waitForCooldowns[${position}]: 引用未选规则、自己或重复规则`);
      refs.add(ref);
    }
    if (rule.releaseAfterRuleKey !== null) {
      const ref = rule.releaseAfterRuleKey;
      if (typeof ref !== 'string' || !keys.has(ref) || ref === rule.ruleKey) throw new Error(`${path}.releaseAfterRuleKey: 前置规则未选或引用自己`);
      if (successors.has(ref)) throw new Error(`${path}.releaseAfterRuleKey: 同一规则至多授予一项后继技能`);
      successors.add(ref);
    }
  }
  const byKey = new Map(rules.map(rule => [rule.ruleKey, rule]));
  for (const rule of rules) {
    const visited = new Set<string>();
    let current: string | null = rule.ruleKey;
    while (current !== null) {
      if (visited.has(current)) throw new Error(`automaticSkills.rules.${rule.ruleKey}.releaseAfterRuleKey: 资格环没有首次授予来源`);
      visited.add(current); current = byKey.get(current)!.releaseAfterRuleKey;
    }
  }
}

/** 直接运输自动规则的真实首次闭包，不生成手动动作。 */
export function plannedSkillsFromAutomaticRules(rules: readonly AutomaticSkillInput[], configurations: readonly SkillConfiguration[]): SimulationPlannedSkill[] {
  if (rules.length > 16) throw new Error('automaticSkills.rules: 本次最多16份真实来源');
  const plans = new Map<string, SimulationPlannedSkill>();
  rules.forEach((rule, index) => {
    const path = `automaticSkills.rules[${index}]`;
    if (rule.origin.kind !== 'CHARACTER' || !keyPattern.test(rule.origin.characterKey) || !keyPattern.test(rule.skillKey)) throw new Error(`${path}: 必须来自实际角色绑定`);
    if (!Number.isSafeInteger(rule.skillLevel) || rule.skillLevel < 1) throw new Error(`${path}.skillLevel: 技能必须已学且等级明确`);
    const identity = simulationSkillSourceIdentity(rule.origin, rule.skillKey);
    if (plans.has(identity)) throw new Error(`${path}.skillKey: 每份真实来源只能配置一项自动规则`);
    const configuration = configurations.find(c => c.skill.skillKey === rule.skillKey);
    if (!configuration) throw new Error(`${path}: 自动闭包缺少真实作者配置`);
    plans.set(identity, { origin: rule.origin, skillKey: rule.skillKey, skillLevel: rule.skillLevel, phaseKinds: automaticSkillPhases(configuration) });
  });
  return [...plans].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, plan]) => plan);
}

export async function automaticSkillRequest(prepared: ReturnType<typeof assembleSimulation>, snapshot: SimulationSnapshot,
  inputs: AutomaticSkillInputs, sessionId = ''): Promise<PreparedAutomaticSkill> {
  validateAutomaticSkillRelations(inputs.rules);
  const plans = plannedSkillsFromAutomaticRules(inputs.rules, snapshot.skillConfigurations);
  const compile = prepared.compileRequest;
  const bindings = compile.rules.skillActionBindings;
  if (!bindings || bindings.length !== plans.length || snapshot.selection.plannedSkills.length !== plans.length) throw new Error('automaticSkills.rules: 编译绑定与真实首次闭包不一致');
  integer(inputs.durationMs, 600000, 'durationMs');
  if (!inputs.durationMs) throw new Error('durationMs: 观察时长必须大于0');
  if (typeof inputs.recordTimeSeries !== 'boolean') throw new Error('recordTimeSeries: 采样开关必须明确');
  if (!['detailed', 'summary'].includes(inputs.outputMode)) throw new Error('outputMode: 必须明确选择详细或汇总模式');
  integer(inputs.maxAutomaticSkillRecords, 4096, 'maxAutomaticSkillRecords');
  integer(inputs.maxHealingRecords, 10000, 'maxHealingRecords');
  if (Object.prototype.hasOwnProperty.call(inputs, 'maxResourceChangeRecords')) integer(inputs.maxResourceChangeRecords!, 10000, 'maxResourceChangeRecords');
  for (const side of ['source', 'target']) {
    const hp = compile.combatants.find(actor => actor.key === side)?.attributes.hp?.current;
    if (typeof hp !== 'number' || !Number.isFinite(hp) || hp <= 0) throw new Error(`initialHealth.${side}: 实际运行要求明确正生命`);
  }
  const selectedBindings = new Set<string>();
  const rules: AutomaticSkillRule[] = inputs.rules.map((input, index) => {
    const path = `automaticSkills.rules[${index}]`;
    const identity = simulationSkillSourceIdentity(input.origin, input.skillKey);
    const plan = snapshot.selection.plannedSkills.find(row => simulationSkillSourceIdentity(row.origin, row.skillKey) === identity);
    const source = snapshot.source.skillSources.find(row => simulationSkillSourceIdentity(row.origin, row.skillKey) === identity);
    const matches = bindings.filter(binding => binding.skillKey === input.skillKey);
    const binding = matches[0];
    const control = binding?.controls.find(control => control.action === 'INITIAL');
    const ability = control && simulationAbility(compile, control.abilityRef);
    const process = ability?.provider.processes?.find(process => process.processKey === control?.processKey);
    if (input.origin.kind !== 'CHARACTER' || input.origin.characterKey !== snapshot.selection.sourceCharacterKey
      || !plan || JSON.stringify(plan.phaseKinds) !== JSON.stringify(plans.find(p => p.skillKey === input.skillKey)?.phaseKinds) || plan.skillLevel !== input.skillLevel
      || !source?.enabled || source.skillStatus !== 'ENABLED' || source.skillLevel !== input.skillLevel || source.skillLevel <= 0
      || matches.length !== 1 || !binding || binding.source !== 'source' || !control || !ability
      || binding.controls.length !== 1 && (!process || !finiteRecastControls(binding, process))
      || selectedBindings.has(binding.bindingKey) || ability.mount.providerRef !== binding.providerRef || ability.mount.definitionRef !== binding.providerDefinitionRef
      || ability.ability.skillKey !== input.skillKey || ability.ability.processControl?.action !== 'INITIAL'
      || ability.ability.processControl.processKey !== control.processKey || !process || !automaticProcessStepsAllowed(process)) {
      throw new Error(`${path}: 真实来源、等级、首次绑定或有限普通步骤链不一致；复杂过程仍需满足原单步骤范围`);
    }
    const empowered = empoweredAttackBinding(compile, binding);
    if (empowered) {
      requireEmpoweredBasicAttack(compile, prepared.basicAttackBinding);
      const cooldown = process.cooldown && tryFoldConstant(process.cooldown.durationMs);
      if (typeof cooldown !== 'number' || !Number.isFinite(cooldown) || cooldown <= 0) throw new Error(`${path}: 自动强化待击需要真实可绑定的正数普通冷却`);
    }
    selectedBindings.add(binding.bindingKey);
    if (!empowered && binding.hitBindings.length ? input.targetSide !== 'target' || !['TARGET_HIT', 'MISS'].includes(input.hitPreset ?? '')
      : input.targetSide !== (finitePeriodicTargetsOpponent(compile, binding) ? 'target' : 'source') || input.hitPreset !== null) throw new Error(`${path}.hitPreset: 命中目标必须与完整作者绑定一致，独立区域保持对手与空预设，自身治疗保持自身与空预设`);
    return { ruleKey: input.ruleKey, bindingKey: binding.bindingKey, sortOrder: input.sortOrder, target: input.targetSide,
      hitBindings: empowered ? [] : binding.hitBindings.map(hit => ({ hitBindingKey: hit.hitBindingKey, preset: input.hitPreset! })),
      waitForCooldowns: [...input.waitForCooldowns], releaseAfterRuleKey: input.releaseAfterRuleKey };
  }).sort((left, right) => left.sortOrder - right.sortOrder);
  const background = prepared.basicAttackBinding ? await continuousAttackRequest(prepared, snapshot, inputs, sessionId) : null;
  const runRequest: RunRequest = {
    sessionId, expectedRulesHash: compile.rulesHash, schemaVersion: compile.schemaVersion, schemaHash: compile.schemaHash, rulesHash: compile.rulesHash,
    outputMode: inputs.outputMode, initialSnapshot: simulationInitialSnapshot(compile),
    runtimeOptions: { equipmentAssumptions: prepared.equipmentAssumptions, skillOrigins: prepared.skillOrigins, mechanicStateInputs: prepared.mechanicStateInputs },
    driverPlan: { conditionRecheckIntervalMs: 100, entries: [], skillActions: [], automaticSkills: { rules },
      ...(background ? { basicAttack: background.runRequest.driverPlan.basicAttack } : {}) },
    skillUses: [], skillHitFacts: [], attackStartFacts: [], processCommandFacts: [],
    stopPolicy: { durationMs: inputs.durationMs, stopOnTargetDeath: true, stopWhenNoEvents: false },
    sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5000, disabled: !inputs.recordTimeSeries },
    ...(background ? { safetyBudget: background.runRequest.safetyBudget } : {}),
    recordBudget: { maxAttackRecords: background ? 1000 : 0, maxDamageRecords: 2000, maxMechanicRecords: background ? 2000 : 0,
      maxAutomaticSkillRecords: inputs.maxAutomaticSkillRecords, maxHealingRecords: inputs.maxHealingRecords,
      ...(Object.prototype.hasOwnProperty.call(inputs, 'maxResourceChangeRecords') ? { maxResourceChangeRecords: inputs.maxResourceChangeRecords } : {}) }
  };
  if (!background && inputs.outputMode === 'detailed' && drivenActiveAmmo(compile, runRequest.driverPlan).length) runRequest.recordBudget!.maxMechanicRecords = 2000;
  return { runRequest, attackSpeedAdmission: background?.attackSpeedAdmission ?? null,
    runInputHash: await simulationHash({ snapshotDigest: prepared.snapshotDigest, ignoredCastCosts: prepared.ignoredCastCosts,
      attackSpeedAdmission: background?.attackSpeedAdmission ?? null, runRequest: { ...runRequest, sessionId: '' } }) };
}
