import type { BasicAttackPlan, RunRequest } from '../types/genericEngine';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import { simulationAbility, type assembleSimulation } from './simulationAdapter';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import { simulationHash } from './simulationHash';
import { executableEquipmentRelations } from './simulationNaturalSkillSources';

export const CONTINUOUS_DURATION_INITIAL_MS = 30_000;
export type ContinuousAttackInputs = { durationMs: number; attackSpeedInputMax?: number; recordTimeSeries?: boolean };
export type AttackSpeedAdmission = { attributeKey: string; inputMax: number; source: 'attribute_range' | 'scenario_input' };
export type PreparedContinuousAttack = { runRequest: RunRequest; runInputHash: string; attackSpeedAdmission: AttackSpeedAdmission };

function fail(path: string, message: string): never { throw new Error(`${path}: ${message}`); }

/** 本阶段只准入静态完整普攻；没有目录上界时必须明确提供场景上界。 */
export async function continuousAttackRequest(
  prepared: ReturnType<typeof assembleSimulation>, snapshot: SimulationSnapshot,
  inputs: ContinuousAttackInputs, sessionId = ''
): Promise<PreparedContinuousAttack> {
  const input = prepared.compileRequest;
  if (inputs.recordTimeSeries !== undefined && typeof inputs.recordTimeSeries !== 'boolean') {
    fail('continuous.recordTimeSeries', '记录时间序列必须为明确布尔值。');
  }
  if (!Number.isSafeInteger(inputs.durationMs) || inputs.durationMs < 1 || inputs.durationMs > 600_000) {
    fail('continuous.durationMs', '观察时长必须为1～600000的整数毫秒。');
  }
  const source = input.combatants.find(actor => actor.key === 'source');
  const target = input.combatants.find(actor => actor.key === 'target');
  if (!source || !target || input.combatants.length !== 2) {
    fail('compileRequest.combatants', '连续普攻需要唯一攻击方与目标。');
  }
  const binding = prepared.basicAttackBinding;
  const startBinding = simulationAbility(input, binding.startAbilityRef);
  const hitBinding = simulationAbility(input, binding.hitAbilityRef);
  const controlBinding = simulationAbility(input, binding.initialControlAbilityRef);
  if (!startBinding || !hitBinding || !controlBinding || binding.source !== 'source' || binding.target !== 'target'
    || !binding.startAbilityRef.startsWith('source.provider[')
    || hitBinding.mount !== startBinding.mount || controlBinding.mount !== startBinding.mount) {
    fail('continuous.basicAttack', '开始、命中与首次控制引用必须来自攻击方同一完整普攻挂载。');
  }
  for (const actor of [source, target]) {
    const expected = prepared.equipmentOrigins.filter(row => row.side === actor.key).map(({ providerRef, definitionRef }) => ({ providerRef, definitionRef }));
    for (const origin of prepared.equipmentOrigins.filter(row => row.side === actor.key
      && executableEquipmentRelations(snapshot, actor.key as 'source' | 'target', row.equipmentKey).length > 0)) {
      const providerRef = `${actor.key}_${origin.equipmentKey}_passive`;
      expected.push({ providerRef, definitionRef: `${providerRef}_definition` });
    }
    for (const origin of prepared.skillOrigins.filter(row => row.side === actor.key && row.providerRef && row.definitionRef)) {
      expected.push({ providerRef: origin.providerRef!, definitionRef: origin.definitionRef! });
    }
    if (actor === source) expected.push({ providerRef: startBinding.mount.providerRef, definitionRef: startBinding.mount.definitionRef });
    if (actor.providers.length !== expected.length || new Set(actor.providers.map(row => row.providerRef)).size !== expected.length
      || actor.providers.some(row => !expected.some(mount => mount.providerRef === row.providerRef && mount.definitionRef === row.definitionRef))) {
      fail(`compileRequest.combatants.${actor.key}.providers`, `${actor === target ? '目标挂载' : '攻击方挂载'}必须逐项等于本次所选普攻、固定装备属性与核定常驻初始化完整集。`);
    }
    for (const origin of prepared.equipmentOrigins.filter(row => row.side === actor.key)) {
      const definitions = input.sharedProviders?.filter(row => row.providerKey === origin.definitionRef);
      const item = definitions?.[0];
      if (definitions?.length !== 1 || item?.kind !== 'item' || item.abilities?.length || item.listeners?.length
        || item.processes?.length || item.lifecycle || item.initialStateSchema || item.statusContributions?.length) {
        fail(origin.authorPath, '阶段4A装备只允许已核定的固定属性来源，不能夹带被动或过程。');
      }
    }
    const hp = actor.attributes.hp?.current;
    if (typeof hp !== 'number' || !Number.isFinite(hp) || hp <= 0) {
      fail(`initialHealth.${actor.key}`, '连续运行要求双方初始当前生命为有限正数。');
    }
  }
  const provider = startBinding.provider;
  const start = startBinding.ability;
  const hit = hitBinding.ability;
  const control = controlBinding.ability;
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
  const derivedSpeed = input.rules.attributeDerivations?.some(row => row.combatantKey === 'source' && row.attributeKey === attributeKey);
  const initializes = input.typeCatalog.types.some(row => row.key === 'event/source_initialized');
  if (typeof speed !== 'number' || !Number.isFinite(speed) || (!derivedSpeed && !initializes && (speed <= 0 || speed > inputMax))) {
    fail(`continuous.${attributeKey}`, '有效攻速必须为有限正数且不超过输入上界，不会自动夹取。');
  }
  const attackSpeedAdmission: AttackSpeedAdmission = { attributeKey, inputMax, source: range === null ? 'scenario_input' : 'attribute_range' };
  const basicAttack: BasicAttackPlan = { ...binding, planKey: 'selected_basic_attack_plan', attackSpeedInputMax: inputMax };
  const runRequest: RunRequest = {
    runtimeOptions: { equipmentAssumptions: prepared.equipmentAssumptions, skillOrigins: prepared.skillOrigins },
    sessionId, expectedRulesHash: input.rulesHash, schemaVersion: input.schemaVersion,
    schemaHash: input.schemaHash, rulesHash: input.rulesHash,
    initialSnapshot: simulationInitialSnapshot(input),
    driverPlan: { conditionRecheckIntervalMs: 100, entries: [], basicAttack },
    stopPolicy: { durationMs: inputs.durationMs, stopOnTargetDeath: true, stopWhenNoEvents: true },
    sampling: { disabled: inputs.recordTimeSeries === false, sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5000 },
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
