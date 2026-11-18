import type { CompileRequest, SkillHitCandidate } from '../types/genericEngine';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import type { SkillEffectDamageDetail, SkillEffectResult } from '../types/skillEffect';
import type { OperationOrigin, SimulationCoverage } from './simulation/model';
import { NumericAdaptationError } from './numericAdapter';

type ResultRef = NonNullable<SkillEffectDamageDetail['spellShieldFollowResult']>;
const identity = (ref: ResultRef) => JSON.stringify([ref.skillKey, ref.effectKey, ref.resultKey]);

/** 最终父计划形成后解析作者引用；缺省不生成原生字段，也不挂载被引用来源。 */
export function bindSpellShieldFollowResults(snapshot: SimulationSnapshot, request: CompileRequest,
  origins: readonly OperationOrigin[], coverage: SimulationCoverage[]): void {
  const resultFor = (ref: ResultRef, path: string): SkillEffectResult => {
    const configurations = snapshot.skillConfigurations.filter(row => row.skill.skillKey === ref.skillKey);
    const effects = configurations[0]?.effects.filter(row => row.effectKey === ref.effectKey) ?? [];
    const results = effects[0]?.results.filter(row => row.resultKey === ref.resultKey) ?? [];
    if (configurations.length !== 1 || effects.length !== 1 || results.length !== 1) {
      throw new NumericAdaptationError(path, '法盾跟随结果定义缺失或重复，不能当作关闭来源');
    }
    return results[0]!;
  };
  for (const [providerIndex, provider] of (request.sharedProviders ?? []).entries()) {
    for (const [abilityIndex, ability] of (provider.abilities ?? []).entries()) {
      for (const [operationIndex, operation] of (ability.operations ?? []).entries()) {
        if (operation.operation !== 'resolve_skill_hit' || !operation.skillHit) continue;
        const path = `sharedProviders[${providerIndex}].abilities[${abilityIndex}].operations[${operationIndex}].skillHit`;
        const refs = operation.skillHit.candidates.map((candidate, index) => {
          const candidatePath = `${path}.candidates[${index}]`;
          const matches = origins.filter(origin => origin.effectKey === candidate.effectKey && origin.resultKey === candidate.resultKey
            && origin.compiledPaths.some(compiled => compiled.startsWith(candidatePath + '.operations[')));
          const distinct = new Map(matches.map(origin => [identity(origin), origin]));
          return distinct.size === 1 ? [...distinct.values()][0]! : null;
        });
        operation.skillHit.candidates.forEach((candidate, index) => {
          const ref = refs[index];
          if (!ref) return;
          const result = resultFor(ref, path);
          if (result.resultType !== 'DAMAGE' || result.detail.spellShieldFollowResult === undefined) return;
          const follow = result.detail.spellShieldFollowResult;
          const authorPath = `skills.${ref.skillKey}.effects.${ref.effectKey}.results.${ref.resultKey}.detail.spellShieldFollowResult`;
          const fail = (message: string): never => { throw new NumericAdaptationError(authorPath, message); };
          if (!follow || Object.keys(follow).length !== 3 || !['skillKey', 'effectKey', 'resultKey'].every(key =>
            typeof follow[key as keyof ResultRef] === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(follow[key as keyof ResultRef]))) fail('法盾跟随必须保留完整唯一的结果引用');
          if (candidate.spellShieldBlockScope !== null || candidate.attackDamageRole !== undefined
            || candidate.semantic.resultType !== 'DAMAGE' || candidate.semantic.target !== 'TARGET'
            || candidate.semantic.moment !== 'INSTANT' || candidate.operations.length !== 1) fail('跟随者只接无独立判盾的即时目标附伤');
          const producerResult = resultFor(follow, authorPath);
          if (identity(ref) === identity(follow) || producerResult.resultType !== 'DAMAGE' || producerResult.target !== 'TARGET'
            || producerResult.lifecycleBehavior !== null || producerResult.spellShieldBlockScope === null
            || producerResult.detail.attackDamageRole !== undefined || producerResult.detail.spellShieldFollowResult !== undefined) fail('生产者须为独立可判盾的即时目标附伤，不能自指或形成跟随链');
          const owner = request.combatants.find(actor => actor.providers.some(mount => mount.definitionRef === provider.providerKey));
          const actor = owner?.key === 'source' ? snapshot.source : owner?.key === 'target' ? snapshot.target : null;
          const sourceMatches = actor?.skillSources.filter(source => source.skillKey === follow.skillKey && source.origin.kind === 'CHARACTER'
            && source.origin.characterKey === actor.character.characterKey) ?? [];
          if (!owner || sourceMatches.length !== 1) fail('法盾跟随只读取同一真实角色技能关系中的结果');
          const matches = refs.flatMap((item, producerIndex) => item && identity(item) === identity(follow) ? [producerIndex] : []);
          if (matches.length > 1) fail('同次命中中的生产候选存在歧义');
          if (!matches.length) {
            const source = sourceMatches[0]!;
            const planned = snapshot.selection.plannedSkills.some(plan => plan.skillKey === follow.skillKey);
            const producerConfiguration = snapshot.skillConfigurations.find(row => row.skill.skillKey === follow.skillKey)!;
            const relevant = producerConfiguration.triggerRules.some(rule => rule.actions.some(action => action.actionType === 'EXECUTE_EFFECT'
              && action.detail.effectKey === follow.effectKey) && (rule.eventSource.eventType === 'BASIC_ATTACK_HIT'
                && operation.skillHit!.skillKey === snapshot.selection.basicAttackSkillKey || rule.eventSource.eventType === 'SKILL_HIT'
                && rule.eventSource.detail.sourceSkillKey === operation.skillHit!.skillKey));
            if (source.enabled && source.skillLevel !== 0 && source.inactiveReason === null && planned && relevant) fail('已启用且应贡献本次命中的结果缺少真实候选');
            coverage.push({ authorPath, compiledPath: 'runtimeOptions.skillOrigins', note: '本次没有该来源的生产候选，跟随者保持正常，不隐式启用来源' });
            return;
          }
          const producer: SkillHitCandidate = operation.skillHit!.candidates[matches[0]!]!;
          if (producer.spellShieldBlockScope === null || producer.spellShieldFollowCandidateKey !== undefined) fail('本次生产候选没有合法独立法盾资格');
          candidate.spellShieldFollowCandidateKey = producer.candidateKey;
          coverage.push({ authorPath, compiledPath: `${path}.candidates[${index}].spellShieldFollowCandidateKey` });
        });
      }
    }
  }
}
