import type { GenericFormulaExpr, NamedFormula, ProviderDefinition, StaticNumericValue } from '../types/genericEngine';
import type { NumericValue } from '../types/numericValue';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SimulationSkillSource, SimulationSnapshot } from '../types/simulationSnapshot';
import type { SimulationSkillOriginTrace } from './simulation/model';
import { constExpr, createNumericCompileState, NumericAdaptationError, tryFoldConstant } from './numericAdapter';
import { staticEffectValue } from './staticEffectValue';

/** 仅装配方提供的实际自然来源；不扩展公开编译或运行协议。 */
export type SiblingTargetCounterContext = {
  origins: readonly SimulationSkillOriginTrace[];
  providers: readonly ProviderDefinition[];
  mounts: ReadonlyArray<{ side: 'source' | 'target'; providerRef: string; definitionRef: string }>;
};

export type SiblingTargetCounterRead = {
  value: GenericFormulaExpr;
  participationProviderRef?: string;
  definitionRef?: string;
  stateKey: string;
  stateSkillKey: string;
  formulas: NamedFormula[];
  inactive: boolean;
};

export type SiblingTargetCounterReadResolver = (
  requesterSkillKey: string, stateSkillKey: string, stateKey: string, path: string
) => SiblingTargetCounterRead;

const fail = (path: string, message: string): never => { throw new NumericAdaptationError(path, message); };
const keyPattern = /^[a-z][a-z0-9_]{0,63}$/;

function sameSource(left: SimulationSkillSource, right: SimulationSkillSource): boolean {
  return left.origin.kind === 'CHARACTER' && right.origin.kind === 'CHARACTER'
    && left.origin.characterKey === right.origin.characterKey && left.skillKey === right.skillKey
    && left.enabled === right.enabled && left.skillStatus === right.skillStatus && left.skillLevel === right.skillLevel
    && left.inactiveReason === right.inactiveReason
    && JSON.stringify(left.enabledRuleKeys) === JSON.stringify(right.enabledRuleKeys);
}

/** 外部只读条件只能使用已存在的同角色定义和挂载，不为引用补建来源。 */
export function createSiblingTargetCounterReadResolver(snapshot: SimulationSnapshot,
  natural: SiblingTargetCounterContext): SiblingTargetCounterReadResolver {
  const configuration = (skillKey: string, path: string): SkillConfiguration => {
    const matches = snapshot.skillConfigurations.filter(row => row.skill.skillKey === skillKey);
    if (matches.length !== 1 || matches[0]!.skill.gameId !== snapshot.gameId) return fail(path, '只读计数缺少同游戏唯一技能定义');
    return matches[0]!;
  };
  const ownedSource = (skillKey: string, path: string) => {
    const characterKey = snapshot.selection.sourceCharacterKey;
    if (snapshot.source.character.characterKey !== characterKey) fail(path, '只读计数的实际来源角色不一致');
    const relations = snapshot.source.attachedSkills.filter(row => row.skillKey === skillKey);
    const sources = snapshot.source.skillSources.filter(row => row.skillKey === skillKey && row.origin.kind === 'CHARACTER');
    if (relations.length !== 1 || relations[0]!.gameId !== snapshot.gameId || relations[0]!.characterKey !== characterKey
      || sources.length !== 1 || sources[0]!.origin.kind !== 'CHARACTER' || sources[0]!.origin.characterKey !== characterKey) {
      fail(path, '只读计数必须来自当前角色的唯一真实技能关系');
    }
    const source = sources[0]!, complete = configuration(skillKey, path);
    if (!['ENABLED', 'DISABLED'].includes(source.skillStatus) || typeof source.enabled !== 'boolean') fail(path, '只读计数的来源开关或全局状态未知');
    if (relations[0]!.skillStatus !== source.skillStatus || complete.skill.status !== source.skillStatus) fail(path, '只读计数的来源状态与真实定义不一致');
    if (source.skillLevel !== null && (!Number.isSafeInteger(source.skillLevel) || source.skillLevel < 0
      || source.skillLevel > complete.skill.maxLevel)) fail(path, '只读计数来源等级不合法');
    return { source, configuration: complete };
  };

  return (requesterSkillKey, stateSkillKey, stateKey, path) => {
    if (![requesterSkillKey, stateSkillKey, stateKey].every(key => keyPattern.test(key)) || requesterSkillKey === stateSkillKey) {
      return fail(path, '兄弟目标计数需要明确且不同的所属技能及合法状态标识');
    }
    const requester = ownedSource(requesterSkillKey, path);
    const plans = snapshot.selection.plannedSkills.filter(plan => plan.skillKey === requesterSkillKey
      && plan.origin.kind === 'CHARACTER' && plan.origin.characterKey === snapshot.selection.sourceCharacterKey);
    const starts = requester.configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_USED'
      && rule.eventSource.detail.sourceSkillKey === requesterSkillKey && rule.eventSource.detail.useKind === 'ACTIVE'
      && rule.eventSource.detail.castPhase === 'INITIAL')
      .flatMap(rule => rule.actions.filter(action => action.actionType === 'START_PROCESS').map(action => action.detail.processKey));
    const processes = requester.configuration.processes.filter(process => starts.includes(process.processKey) && process.activationType === 'ACTIVE');
    if (!requester.source.enabled || requester.source.skillStatus !== 'ENABLED' || !requester.source.skillLevel
      || requester.source.inactiveReason !== null || plans.length !== 1 || !plans[0]!.phaseKinds.includes('INITIAL')
      || plans[0]!.skillLevel !== requester.source.skillLevel || new Set(starts).size !== 1 || processes.length !== 1
      || requesterSkillKey === snapshot.selection.basicAttackSkillKey) {
      fail(path, '跨技能计数仅供本场真实已计划且已学的自身主动命中读取');
    }

    const owner = ownedSource(stateSkillKey, path), complete = owner.configuration, source = owner.source;
    const definitions = complete.internalStates.filter(row => row.stateKey === stateKey), state = definitions[0];
    if (definitions.length !== 1 || !state || state.gameId !== snapshot.gameId || state.skillKey !== stateSkillKey
      || state.stateType !== 'COUNTER' || state.scope !== 'TARGET'
      || !state.detail.durationValue || Object.keys(state.detail).some(key => !['initialValue', 'maxValue', 'durationValue'].includes(key))) {
      return fail(path, '跨技能只读取明确零初值、有期限的普通目标计数，不能读取计时锚或动态初值');
    }
    const numeric = createNumericCompileState({ gameId: snapshot.gameId, skillKey: stateSkillKey,
      skillLevel: source.skillLevel ?? 0, characterLevel: snapshot.selection.sourceLevel,
      parameters: complete.parameters, formulas: complete.formulas, formulaNamespace: `sibling_target_counter/${stateSkillKey}/${stateKey}`,
      bindParameters: false, allowAttributeReads: false, runtimeInputMessage: '只读目标计数的定义必须静态确定，不提供运行输入默认值' });
    const scalar = (value: NumericValue, where: string, minimum: number) => {
      const result = staticEffectValue(value, where, numeric);
      if (!Number.isSafeInteger(result) || result < minimum) return fail(where, '只读目标计数需要明确的有限安全整数');
      return result;
    };
    const initial = scalar(state.detail.initialValue, `${path}.initialValue`, 0);
    const maximum = scalar(state.detail.maxValue, `${path}.maxValue`, 0);
    const duration = scalar(state.detail.durationValue!, `${path}.durationValue`, 1);
    if (initial !== 0) fail(path, '跨技能目标计数必须明确零默认值');
    const origins = natural.origins.filter(origin => origin.side === 'source' && origin.skillKey === stateSkillKey
      && origin.origin.kind === 'CHARACTER' && origin.origin.characterKey === snapshot.selection.sourceCharacterKey);
    const origin = origins[0];
    if (origins.length !== 1 || !origin || !sameSource(origin, source)) fail(path, '目标计数缺少本场一致的同拥有者自然来源记录');
    const inactive = source.skillStatus !== 'ENABLED' || !source.enabled || source.skillLevel === 0;
    if (inactive) {
      const reason = source.skillStatus !== 'ENABLED' ? 'GLOBAL_DISABLED' : !source.enabled ? 'SCENE_DISABLED' : 'UNLEARNED';
      if (source.inactiveReason !== reason || natural.mounts.some(mount => mount.side === 'source'
        && (mount.providerRef === origin.providerRef || mount.definitionRef === origin.definitionRef))) {
        fail(path, '关闭或未学来源必须明确未挂载，未知或不完整来源不能当作零');
      }
      return { value: constExpr(0), stateKey, stateSkillKey, formulas: [...numeric.namedFormulas.values()], inactive: true };
    }
    if (source.inactiveReason !== null || !source.skillLevel || !source.enabledRuleKeys.length
      || !origin.providerRef || !origin.definitionRef) fail(path, '启用的只读计数来源缺少合法已学自然挂载');
    const mounts = natural.mounts.filter(mount => mount.side === 'source'
      && (mount.providerRef === origin.providerRef || mount.definitionRef === origin.definitionRef));
    const providers = natural.providers.filter(provider => provider.providerKey === origin.definitionRef), provider = providers[0];
    if (mounts.length !== 1 || mounts[0]!.providerRef !== origin.providerRef || mounts[0]!.definitionRef !== origin.definitionRef
      || providers.length !== 1 || !provider || provider.kind !== 'character' || provider.skillKey !== stateSkillKey
      || provider.stableId !== origin.definitionRef || provider.lifecycle !== undefined) {
      fail(path, '只读计数必须绑定同拥有者唯一永久原始角色挂载');
    }
    const field = provider.initialStateSchema?.[stateKey];
    const compiledScalar = (value: StaticNumericValue | undefined): number | null => typeof value === 'number' ? value
      : value && value.op === 'ref' ? tryFoldConstant(value) : null;
    if (!field || typeof field === 'number' || field.valueType !== 'integer' || field.stateKind !== undefined
      || field.ammoRecovery !== undefined || field.onExpire !== undefined || field.refreshPolicy !== 'refresh_on_write'
      || compiledScalar(field.defaultValue) !== initial || compiledScalar(field.maxValue) !== maximum
      || compiledScalar(field.durationMs) !== duration) {
      fail(path, '普通目标计数的实际编译字段与作者默认值、容量或期限不一致');
    }
    return { value: { op: 'read', path: `provider.target_state.${stateKey}` }, participationProviderRef: origin.providerRef,
      definitionRef: origin.definitionRef, stateKey, stateSkillKey, formulas: [...numeric.namedFormulas.values()], inactive: false };
  };
}
