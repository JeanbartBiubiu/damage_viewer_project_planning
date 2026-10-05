import type { RecordBudget, RunRequest } from '../types/genericEngine';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import type { assembleSimulation } from './simulationAdapter';
import { simulationAbility } from './simulationAdapter';
import { simulationHash } from './simulationHash';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';

export type SkillActionInputs = {
  instructionKey: string; atMs: number; sortOrder: number; targetSide: 'source' | 'target';
  hitPreset: 'TARGET_HIT' | 'MISS' | null; durationMs: number; recordTimeSeries: boolean;
  maxSkillActionRecords: number; maxSkillUseRecords: number; maxHealingRecords: number;
};
export type PreparedSkillAction = { runRequest: RunRequest; runInputHash: string };

function integer(value: number, maximum: number, path: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${path}: 需要0～${maximum}的明确整数`);
}

export async function skillActionRequest(prepared: ReturnType<typeof assembleSimulation>, snapshot: SimulationSnapshot,
  inputs: SkillActionInputs, sessionId = ''): Promise<PreparedSkillAction> {
  const compile = prepared.compileRequest;
  const bindings = compile.rules.skillActionBindings;
  if (prepared.basicAttackBinding || snapshot.selection.basicAttackSkillKey !== null || snapshot.selection.plannedSkills.length !== 1
    || bindings?.length !== 1 || bindings[0]!.controls.length !== 1 || bindings[0]!.controls[0]!.action !== 'INITIAL') {
    throw new Error('skillActions: 6A严格只支持单条首次主动尝试，无背景普攻');
  }
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(inputs.instructionKey)) throw new Error('instructionKey: 需要稳定指令标识');
  integer(inputs.durationMs, 600000, 'durationMs');
  if (!inputs.durationMs) throw new Error('durationMs: 观察时长必须大于0');
  integer(inputs.atMs, inputs.durationMs, 'atMs');
  integer(inputs.sortOrder, 2147483647, 'sortOrder');
  if (!['source', 'target'].includes(inputs.targetSide) || typeof inputs.recordTimeSeries !== 'boolean') throw new Error('skillActions: 目标与采样开关必须明确');
  const binding = bindings[0]!;
  const control = binding.controls[0]!;
  const ability = simulationAbility(compile, control.abilityRef);
  const plan = snapshot.selection.plannedSkills[0]!;
  const source = snapshot.source.skillSources.find(row => row.origin.kind === 'CHARACTER'
    && row.origin.characterKey === plan.origin.characterKey && row.skillKey === plan.skillKey);
  if (!source?.enabled || source.skillStatus !== 'ENABLED' || source.skillLevel !== plan.skillLevel
    || binding.skillKey !== plan.skillKey || !ability || ability.mount.providerRef !== binding.providerRef
    || ability.mount.definitionRef !== binding.providerDefinitionRef || ability.ability.skillKey !== plan.skillKey
    || ability.ability.processControl?.processKey !== control.processKey || ability.ability.processControl.action !== 'INITIAL') {
    throw new Error('skillActions: 本次绑定、真实开启来源、等级和首次控制不一致');
  }
  if (binding.hitBindings.length && !['TARGET_HIT', 'MISS'].includes(inputs.hitPreset ?? '')) throw new Error('hitPreset: 必须明确命中或未命中');
  if (binding.hitBindings.length && inputs.targetSide !== 'target') throw new Error('targetSide: 6A伤害释放仅允许唯一目标B');
  if (!binding.hitBindings.length && (inputs.hitPreset !== null || inputs.targetSide !== 'source')) throw new Error('hitPreset: 自身治疗不造命中，只允许自身目标');
  const recordBudget: RecordBudget = { maxAttackRecords: 0, maxDamageRecords: 2000, maxMechanicRecords: 0,
    maxSkillActionRecords: inputs.maxSkillActionRecords, maxSkillUseRecords: inputs.maxSkillUseRecords, maxHealingRecords: inputs.maxHealingRecords };
  integer(inputs.maxSkillActionRecords, 4096, 'maxSkillActionRecords');
  integer(inputs.maxSkillUseRecords, 10000, 'maxSkillUseRecords');
  integer(inputs.maxHealingRecords, 10000, 'maxHealingRecords');
  const runRequest: RunRequest = {
    sessionId, expectedRulesHash: compile.rulesHash, schemaVersion: compile.schemaVersion, schemaHash: compile.schemaHash, rulesHash: compile.rulesHash,
    initialSnapshot: simulationInitialSnapshot(compile),
    runtimeOptions: { equipmentAssumptions: prepared.equipmentAssumptions, skillOrigins: prepared.skillOrigins },
    driverPlan: { conditionRecheckIntervalMs: 100, entries: [], skillActions: [{ instructionKey: inputs.instructionKey,
      firstAtMs: inputs.atMs, sortOrder: inputs.sortOrder, source: 'source', target: inputs.targetSide,
      skillKey: binding.skillKey, bindingKey: binding.bindingKey, action: 'INITIAL', abilityRef: control.abilityRef, parentInstructionKey: null,
      hitBindings: binding.hitBindings.map(hit => ({ hitBindingKey: hit.hitBindingKey, preset: inputs.hitPreset! })) }] },
    skillUses: [], skillHitFacts: [], attackStartFacts: [], processCommandFacts: [],
    stopPolicy: { durationMs: inputs.durationMs, stopOnTargetDeath: true, stopWhenNoEvents: false },
    sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5000, disabled: !inputs.recordTimeSeries }, recordBudget
  };
  return { runRequest, runInputHash: await simulationHash({ snapshotDigest: prepared.snapshotDigest, ignoredCastCosts: prepared.ignoredCastCosts,
    runRequest: { ...runRequest, sessionId: '' } }) };
}
