import type { BasicAttackPlan, RunRequest } from '../types/genericEngine';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import type { assembleSimulation } from './simulationAdapter';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import { simulationHash } from './simulationHash';

export const CONTINUOUS_DURATION_INITIAL_MS = 30_000;
export type ContinuousAttackInputs = { durationMs: number; attackSpeedInputMax?: number };
export type AttackSpeedAdmission = { attributeKey: string; inputMax: number; source: 'attribute_range' | 'scenario_input' };
export type PreparedContinuousAttack = { runRequest: RunRequest; runInputHash: string; attackSpeedAdmission: AttackSpeedAdmission };

function fail(path: string, message: string): never { throw new Error(`${path}: ${message}`); }

/** 本阶段只准入静态完整普攻；没有目录上界时必须明确提供场景上界。 */
export async function continuousAttackRequest(
  prepared: ReturnType<typeof assembleSimulation>, snapshot: SimulationSnapshot,
  inputs: ContinuousAttackInputs, sessionId = ''
): Promise<PreparedContinuousAttack> {
  const input = prepared.compileRequest;
  if (!Number.isSafeInteger(inputs.durationMs) || inputs.durationMs < 1 || inputs.durationMs > 600_000) {
    fail('continuous.durationMs', '观察时长必须为1～600000的整数毫秒。');
  }
  const source = input.combatants.find(actor => actor.key === 'source');
  const target = input.combatants.find(actor => actor.key === 'target');
  if (!source || !target || input.combatants.length !== 2 || source.providers.length !== 1 || target.providers.length !== 0) {
    fail('compileRequest.combatants', '连续普攻只允许攻击方的一份所选普攻挂载，目标挂载必须为空。');
  }
  for (const actor of [source, target]) {
    const hp = actor.attributes.hp?.current;
    if (typeof hp !== 'number' || !Number.isFinite(hp) || hp <= 0) {
      fail(`initialHealth.${actor.key}`, '连续运行要求双方初始当前生命为有限正数。');
    }
  }
  const binding = prepared.basicAttackBinding;
  const provider = input.sharedProviders?.find(row => row.providerKey === source.providers[0]!.definitionRef);
  const reference = (key: string) => `source.provider[${source.providers[0]!.providerRef}].ability[${key}]`;
  const start = provider?.abilities?.find(row => reference(row.abilityKey) === binding.startAbilityRef);
  const hit = provider?.abilities?.find(row => reference(row.abilityKey) === binding.hitAbilityRef);
  const control = provider?.abilities?.find(row => reference(row.abilityKey) === binding.initialControlAbilityRef);
  const process = provider?.processes?.find(row => row.processKey === control?.processControl?.processKey);
  if (!start || !hit || !control || [start, hit, control].some(row => row.skillKey !== binding.skillKey)
    || control.processControl?.action !== 'INITIAL' || !control.processControl.useRefFromEvent
    || !process || process.skillKey !== binding.skillKey || provider?.processes?.length !== 1
    || process.cooldown?.roundPositiveMs !== true || process.cooldown.startMoment.momentType !== 'PROCESS_START') {
    fail('continuous.basicAttack', '开始、命中、首次控制及过程冷却必须来自同次完整装配。');
  }
  if (process.costs.length || process.steps.some(row => row.stepType !== 'IMMEDIATE')
    || start.operations?.length || control.operations?.length
    || process.momentOperations.some(row => row.operations.some(operation => !['apply_attack_link', 'apply_hit_link'].includes(operation.operation)))) {
    fail('continuous.basicAttack', '连续普攻不接受费用、延时或命中前扣血；必须整体保留作者配置。');
  }
  const attributeKey = binding.attackSpeedAttributeKey;
  const attributes = snapshot.catalogs.attributes.filter(row => row.attributeKey === attributeKey && row.status === 'ENABLED');
  if (attributes.length !== 1) fail(`catalogs.attributes.${attributeKey}`, '缺少唯一的真实攻速属性目录。');
  const range = attributes[0]!.maxValue;
  const inputMax = range === null ? inputs.attackSpeedInputMax : range;
  if (typeof inputMax !== 'number' || !Number.isFinite(inputMax) || inputMax <= 0) {
    fail('continuous.attackSpeedInputMax', range === null ? '属性目录未提供上界，请明确填写有限正攻速输入上界。' : '真实属性范围的上界必须为有限正数。');
  }
  const speed = source.attributes[attributeKey]?.resolved;
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0 || speed > inputMax) {
    fail(`continuous.${attributeKey}`, '有效攻速必须为有限正数且不超过输入上界，不会自动夹取。');
  }
  const attackSpeedAdmission: AttackSpeedAdmission = { attributeKey, inputMax, source: range === null ? 'scenario_input' : 'attribute_range' };
  const basicAttack: BasicAttackPlan = { ...binding, planKey: 'selected_basic_attack_plan', attackSpeedInputMax: inputMax };
  const runRequest: RunRequest = {
    sessionId, expectedRulesHash: input.rulesHash, schemaVersion: input.schemaVersion,
    schemaHash: input.schemaHash, rulesHash: input.rulesHash,
    initialSnapshot: simulationInitialSnapshot(input),
    driverPlan: { conditionRecheckIntervalMs: 100, entries: [], basicAttack },
    stopPolicy: { durationMs: inputs.durationMs, stopOnTargetDeath: true, stopWhenNoEvents: true },
    sampling: { disabled: true, sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5000 },
    safetyBudget: { maxEvents: 10000, maxCommandsPerEvent: 256, maxChainDepth: 32, maxProcessInstances: 10000, maxBasicAttacks: 4096 },
    recordBudget: { maxAttackRecords: 1000, maxDamageRecords: 2000 }
  };
  const runInputHash = await continuousAttackRunInputHash(runRequest, attackSpeedAdmission);
  return { runRequest, runInputHash, attackSpeedAdmission };
}

export function continuousAttackRunInputHash(runRequest: RunRequest, attackSpeedAdmission: AttackSpeedAdmission) {
  const { sessionId: _sessionId, ...conditions } = runRequest;
  return simulationHash({ compileRulesHash: runRequest.rulesHash, ...conditions, attackSpeedAdmission });
}
