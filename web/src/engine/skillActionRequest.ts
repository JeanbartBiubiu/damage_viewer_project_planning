import type { RunRequest, SkillActionPlan } from '../types/genericEngine';
import type { SimulationPlannedSkill, SimulationSkillPhase, SimulationSnapshot } from '../types/simulationSnapshot';
import type { assembleSimulation } from './simulationAdapter';
import { simulationAbility } from './simulationAdapter';
import { simulationHash } from './simulationHash';
import { empoweredAttackBinding, requireEmpoweredBasicAttack } from './empoweredAttackContract';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';
import { continuousAttackRequest, type AttackSpeedAdmission } from './continuousAttackRequest';
import { drivenActiveAmmo } from './simulationAmmoMechanics';

export type SkillActionInput = Pick<SimulationPlannedSkill, 'origin' | 'skillKey' | 'skillLevel'> & {
  instructionKey: string; atMs: number; sortOrder: number; targetSide: 'source' | 'target';
  phaseKind: SimulationSkillPhase; parentInstructionKey: string | null; hitPreset: 'TARGET_HIT' | 'MISS' | null;
};
export type SkillActionInputs = {
  actions: SkillActionInput[]; durationMs: number; recordTimeSeries: boolean; attackSpeedInputMax?: number;
  maxSkillActionRecords: number; maxSkillUseRecords: number; maxHealingRecords: number;
};
export type PreparedSkillAction = { runRequest: RunRequest; runInputHash: string; attackSpeedAdmission: AttackSpeedAdmission | null };

function integer(value: number, maximum: number, path: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${path}: 需要0～${maximum}的明确整数`);
}

export async function skillActionRequest(prepared: ReturnType<typeof assembleSimulation>, snapshot: SimulationSnapshot,
  inputs: SkillActionInputs, sessionId = ''): Promise<PreparedSkillAction> {
  const compile = prepared.compileRequest;
  const bindings = compile.rules.skillActionBindings;
  if (!bindings?.length || bindings.length !== snapshot.selection.plannedSkills.length || bindings.length > 16
    || !Array.isArray(inputs.actions) || !inputs.actions.length || inputs.actions.length > 64) {
    throw new Error('skillActions: 需要1～64条明确技能指令，1～16份真实来源');
  }
  integer(inputs.durationMs, 600000, 'durationMs');
  if (!inputs.durationMs) throw new Error('durationMs: 观察时长必须大于0');
  if (typeof inputs.recordTimeSeries !== 'boolean') throw new Error('recordTimeSeries: 采样开关必须明确');
  for (const side of ['source', 'target']) {
    const hp = compile.combatants.find(actor => actor.key === side)?.attributes.hp?.current;
    if (typeof hp !== 'number' || !Number.isFinite(hp) || hp < 0) throw new Error(`initialHealth.${side}: 实际运行要求明确非负生命`);
  }
  const instructionKeys = new Set<string>();
  const skillActions: SkillActionPlan[] = inputs.actions.map((input, index) => {
    const path = `skillActions[${index}]`;
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(input.instructionKey) || instructionKeys.has(input.instructionKey)) {
      throw new Error(`${path}.instructionKey: 需要稳定且唯一的指令标识`);
    }
    instructionKeys.add(input.instructionKey);
    integer(input.atMs, inputs.durationMs, `${path}.atMs`);
    integer(input.sortOrder, 2147483647, `${path}.sortOrder`);
    if (!['INITIAL', 'CHARGE_RELEASE', 'RECAST', 'CANCEL'].includes(input.phaseKind)
      || (input.phaseKind === 'INITIAL' ? input.parentInstructionKey !== null
        : typeof input.parentInstructionKey !== 'string' || !input.parentInstructionKey)) throw new Error(`${path}: 首次不得关联父指令，控制必须明确关联原首次`);
    if (!['source', 'target'].includes(input.targetSide)) throw new Error(`${path}.targetSide: 目标必须明确`);
    const identity = simulationSkillSourceIdentity(input.origin, input.skillKey);
    const plan = snapshot.selection.plannedSkills.find(row => simulationSkillSourceIdentity(row.origin, row.skillKey) === identity);
    const source = snapshot.source.skillSources.find(row => simulationSkillSourceIdentity(row.origin, row.skillKey) === identity);
    const binding = bindings.find(row => row.skillKey === input.skillKey);
    const control = binding?.controls.find(control => control.action === input.phaseKind);
    const ability = control && simulationAbility(compile, control.abilityRef);
    if (input.origin.kind !== 'CHARACTER' || input.origin.characterKey !== snapshot.selection.sourceCharacterKey
      || !plan || !plan.phaseKinds.includes('INITIAL') || !plan.phaseKinds.includes(input.phaseKind) || plan.skillLevel !== input.skillLevel
      || !source?.enabled || source.skillStatus !== 'ENABLED' || source.skillLevel !== input.skillLevel
      || !binding || binding.source !== 'source' || binding.controls.length !== plan.phaseKinds.length
      || plan.phaseKinds.some(phase => binding.controls.filter(control => control.action === phase).length !== 1) || !control || !ability
      || ability.mount.providerRef !== binding.providerRef || ability.mount.definitionRef !== binding.providerDefinitionRef
      || ability.ability.skillKey !== input.skillKey || ability.ability.processControl?.processKey !== control.processKey
      || ability.ability.processControl.action !== input.phaseKind) throw new Error(`${path}: 编译绑定、真实来源、已学等级或实际阶段控制不一致`);
    const empowered = empoweredAttackBinding(compile, binding);
    if (empowered) requireEmpoweredBasicAttack(compile, prepared.basicAttackBinding);
    if (input.phaseKind !== 'INITIAL' && input.hitPreset !== null) throw new Error(`${path}.hitPreset: 控制继承原首次预设，不允许重新填写命中`);
    if (input.phaseKind === 'INITIAL' && !empowered && binding.hitBindings.length && (!['TARGET_HIT', 'MISS'].includes(input.hitPreset ?? '') || input.targetSide !== 'target')) {
      throw new Error(`${path}.hitPreset: 伤害释放仅允许唯一目标B且必须明确命中或未命中`);
    }
    if (input.phaseKind === 'INITIAL' && (empowered || !binding.hitBindings.length) && (input.hitPreset !== null || input.targetSide !== 'source')) {
      throw new Error(`${path}.hitPreset: 自身治疗不造命中，只允许自身目标`);
    }
    return { instructionKey: input.instructionKey, firstAtMs: input.atMs, sortOrder: input.sortOrder, source: 'source', target: input.targetSide,
      skillKey: binding.skillKey, bindingKey: binding.bindingKey, action: input.phaseKind, abilityRef: control.abilityRef, parentInstructionKey: input.parentInstructionKey,
      hitBindings: input.phaseKind === 'INITIAL' && !empowered ? binding.hitBindings.map(hit => ({ hitBindingKey: hit.hitBindingKey, preset: input.hitPreset! })) : [] };
  });
  skillActions.sort((left, right) => left.firstAtMs - right.firstAtMs || left.sortOrder - right.sortOrder
    || (left.instructionKey < right.instructionKey ? -1 : left.instructionKey > right.instructionKey ? 1 : 0));
  const earlier = new Map<string, SkillActionPlan>();
  for (const action of skillActions) {
    if (action.action !== 'INITIAL') {
      const parent = earlier.get(action.parentInstructionKey!);
      if (!parent || parent.action !== 'INITIAL' || parent.source !== action.source || parent.target !== action.target
        || parent.skillKey !== action.skillKey || parent.bindingKey !== action.bindingKey) {
        throw new Error(`skillActions.${action.instructionKey}.parentInstructionKey: 父必须是完整排序中更早的同来源、同目标、同技能、同绑定和同等级首次，禁止前向关联`);
      }
    }
    earlier.set(action.instructionKey, action);
  }
  const background = prepared.basicAttackBinding ? await continuousAttackRequest(prepared, snapshot, inputs, sessionId) : null;
  integer(inputs.maxSkillActionRecords, 4096, 'maxSkillActionRecords');
  integer(inputs.maxSkillUseRecords, 10000, 'maxSkillUseRecords');
  integer(inputs.maxHealingRecords, 10000, 'maxHealingRecords');
  const runRequest: RunRequest = {
    sessionId, expectedRulesHash: compile.rulesHash, schemaVersion: compile.schemaVersion, schemaHash: compile.schemaHash, rulesHash: compile.rulesHash,
    initialSnapshot: simulationInitialSnapshot(compile),
    runtimeOptions: { equipmentAssumptions: prepared.equipmentAssumptions, skillOrigins: prepared.skillOrigins, mechanicStateInputs: prepared.mechanicStateInputs },
    driverPlan: { conditionRecheckIntervalMs: 100, entries: [], ...(background ? { basicAttack: background.runRequest.driverPlan.basicAttack } : {}), skillActions },
    skillUses: [], skillHitFacts: [], attackStartFacts: [], processCommandFacts: [],
    stopPolicy: { durationMs: inputs.durationMs, stopOnTargetDeath: true, stopWhenNoEvents: false },
    sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5000, disabled: !inputs.recordTimeSeries },
    ...(background ? { safetyBudget: background.runRequest.safetyBudget } : {}),
    recordBudget: { maxAttackRecords: background ? 1000 : 0, maxDamageRecords: 2000, maxMechanicRecords: background ? 2000 : 0,
      maxSkillActionRecords: inputs.maxSkillActionRecords, maxSkillUseRecords: inputs.maxSkillUseRecords, maxHealingRecords: inputs.maxHealingRecords }
  };
  if (!background && drivenActiveAmmo(compile, runRequest.driverPlan).length) runRequest.recordBudget!.maxMechanicRecords = 2000;
  return { runRequest, attackSpeedAdmission: background?.attackSpeedAdmission ?? null,
    runInputHash: await simulationHash({ snapshotDigest: prepared.snapshotDigest, ignoredCastCosts: prepared.ignoredCastCosts,
      attackSpeedAdmission: background?.attackSpeedAdmission ?? null, runRequest: { ...runRequest, sessionId: '' } }) };
}
