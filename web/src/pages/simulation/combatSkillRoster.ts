import type { AutomaticSkillInput } from '../../engine/automaticSkillRequest';
import { selectSimulationSkillSourceClosure } from '../../engine/simulationSkillSourceClosure';
import { simulationSkillSourceIdentity } from '../../services/simulationSkillSourceIdentity';
import type { SkillConfiguration } from '../../types/skillConfiguration';
import type { SimulationSkillSetting } from '../../types/simulationSnapshot';
import type { SkillTriggerRuleDetail } from '../../types/skillTriggerRule';
import { automaticSkillDraftIssues } from './simulationAutomaticSkillDrafts';
import type { SimulationCharacterSkillOption } from './simulationSelectionOptions';

type CombatSkill = NonNullable<SimulationCharacterSkillOption['combat']>;

function initialActiveRules(configuration: SkillConfiguration) {
  return configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_USED'
    && rule.eventSource.detail.sourceSkillKey === configuration.skill.skillKey
    && rule.eventSource.detail.useKind === 'ACTIVE' && rule.eventSource.detail.castPhase === 'INITIAL');
}

function hasSelfTargetCondition(rules: readonly SkillTriggerRuleDetail[]) {
  return rules.some(rule => rule.conditionGroups.some(group => group.conditions.some(condition => condition.conditionType === 'EXPLICIT_TARGET_IS_SOURCE')));
}

/** 只描述作者已经声明的入口及目标，不替代最终场景适配与原生准入。 */
export function describeCombatSkill(configuration: SkillConfiguration, basicAttack: boolean): CombatSkill {
  if (basicAttack) return { kind: 'basic', configuration, targetSide: 'target', hitPreset: 'TARGET_HIT', issue: null };
  const initialRules = initialActiveRules(configuration);
  if (!initialRules.length) return { kind: 'passive', configuration, targetSide: 'source', hitPreset: null, issue: null };
  const ownHitRules = configuration.triggerRules.filter(rule => rule.actions.length && rule.eventSource.eventType === 'SKILL_HIT'
    && rule.eventSource.detail.sourceSkillKey === configuration.skill.skillKey);
  const description: CombatSkill = { kind: 'active', configuration,
    targetSide: ownHitRules.length ? 'target' : 'source', hitPreset: ownHitRules.length ? 'TARGET_HIT' : null, issue: null };
  const issues: string[] = [];
  try {
    const roots = [...initialRules, ...ownHitRules].filter(rule => rule.actions.length).map(rule => rule.ruleKey);
    const closure = selectSimulationSkillSourceClosure(configuration, roots).configuration;
    const starts = initialRules.flatMap(rule => rule.actions.filter(action => action.actionType === 'START_PROCESS'));
    const process = starts.length === 1 ? closure.processes.find(row => row.processKey === starts[0]!.detail.processKey) : undefined;
    const empowered = process?.steps.length === 1 && process.steps[0]?.stepType === 'EMPOWERED_BASIC_ATTACK'
      && process.steps[0].detail.consumeMoment === 'ATTACK_HIT' && process.steps[0].occupiesAction === false;
    if (empowered) { description.targetSide = 'source'; description.hitPreset = null; }
    if (starts.length !== 1 || !process || closure.processes.length !== 1 || process.activationType !== 'ACTIVE') {
      issues.push('首次施放需要唯一的真实主动过程');
    } else if (process.steps.length !== 1 || process.steps.some(step => !['IMMEDIATE', 'DELAY', 'CHANNEL'].includes(step.stepType)) && !empowered) {
      issues.push('自动循环支持单步骤即时、有限延时或有限引导，当前过程请使用固定时刻计划');
    } else if (process.steps.some(step => typeof step.occupiesAction !== 'boolean')) {
      issues.push('作者尚未明确步骤是否占用行动');
    }
    if (starts.some(action => action.targetContext !== 'CURRENT_TARGET')) issues.push('首次过程目标上下文不明确，请在高级设置核对');
    const results = closure.effects.flatMap(effect => effect.results);
    if (empowered) {
      if (ownHitRules.length || !hasSelfTargetCondition(initialRules)
        || !process?.effectBindings.some(binding => binding.moment.momentType === 'STEP_EXECUTION' && binding.moment.stepKey === process.steps[0]!.stepKey)) {
        issues.push('强化下一次普通攻击需要明确自身激活及真实命中步骤挂接，不预设下一刀命中');
      }
    } else if (ownHitRules.length) {
      if (hasSelfTargetCondition(initialRules) || !results.some(result => result.target === 'TARGET')
        || ownHitRules.some(rule => rule.actions.some(action => action.targetContext !== 'CURRENT_TARGET'))) {
        issues.push('命中入口与自身目标或结果目标不明确，请在高级设置核对');
      }
    } else if (results.some(result => result.target === 'TARGET')) {
      issues.push('存在目标结果但没有真实命中入口，请在高级设置核对');
    }
  } catch (cause) {
    issues.push(cause instanceof Error ? cause.message : String(cause));
  }
  description.issue = issues.length ? issues.join('；') : null;
  return description;
}

/** 保留每份真实主动来源的草稿；停用只影响本次执行，不能偷偷移除连招引用。 */
export function reconcileCombatRules(options: readonly SimulationCharacterSkillOption[], characterKey: string,
  previousRules: readonly AutomaticSkillInput[], settings: readonly SimulationSkillSetting[],
  clearedLevels: Readonly<Record<string, boolean>>): {
    drafts: AutomaticSkillInput[]; enabledRules: AutomaticSkillInput[]; basicAttack: SimulationCharacterSkillOption | null;
    basicAttackIssue: string | null; issues: string[];
  } {
  const basicOptions = options.filter(option => option.combat?.kind === 'basic');
  const basicAttack = basicOptions.length === 1 ? basicOptions[0]! : null;
  const basicAttackIssue = basicOptions.length === 1 ? null : basicOptions.length === 0
    ? '当前角色没有真实已启用的普通攻击绑定，请检查角色挂载与普通攻击分类用途绑定。'
    : `当前角色有${basicOptions.length}份普通攻击绑定，无法自动确定唯一主体，请先修正真实绑定。`;
  const activeOptions = options.filter(option => option.combat?.kind === 'active');
  const usedRuleKeys = new Set(previousRules.map(rule => rule.ruleKey));
  const ownPrevious = previousRules.filter(rule => rule.origin.kind === 'CHARACTER' && rule.origin.characterKey === characterKey);
  let nextRuleNumber = 1;
  let nextSortOrder = Math.max(-1, ...ownPrevious.filter(rule => Number.isSafeInteger(rule.sortOrder)).map(rule => rule.sortOrder)) + 1;
  const allocateRuleKey = () => {
    while (usedRuleKeys.has(`auto_rule_${nextRuleNumber}`)) nextRuleNumber += 1;
    const key = `auto_rule_${nextRuleNumber++}`;
    usedRuleKeys.add(key);
    return key;
  };
  const drafts = activeOptions.map(option => {
    const origin = { kind: 'CHARACTER' as const, characterKey };
    const identity = simulationSkillSourceIdentity(origin, option.key);
    const previous = ownPrevious.find(rule => simulationSkillSourceIdentity(rule.origin, rule.skillKey) === identity);
    const setting = settings.find(setting => simulationSkillSourceIdentity(setting.origin, setting.skillKey) === identity);
    const skillLevel = clearedLevels[`source:${identity}`] ? NaN
      : setting?.skillLevel !== undefined ? setting.skillLevel : previous?.skillLevel ?? option.maxLevel;
    return { origin, skillKey: option.key, skillLevel, ruleKey: previous?.ruleKey ?? allocateRuleKey(),
      sortOrder: previous?.sortOrder ?? nextSortOrder++, targetSide: previous?.targetSide ?? option.combat!.targetSide,
      hitPreset: previous ? previous.hitPreset : option.combat!.hitPreset,
      waitForCooldowns: [...previous?.waitForCooldowns ?? []], releaseAfterRuleKey: previous?.releaseAfterRuleKey ?? null };
  }).sort((left, right) => left.sortOrder - right.sortOrder);
  const enabledRules = drafts.filter(rule => {
    const identity = simulationSkillSourceIdentity(rule.origin, rule.skillKey);
    const setting = settings.find(setting => simulationSkillSourceIdentity(setting.origin, setting.skillKey) === identity);
    return setting?.enabled !== false && setting?.skillLevel !== 0 && rule.skillLevel !== 0;
  }).map((rule, index) => ({ ...rule, sortOrder: index, waitForCooldowns: [...rule.waitForCooldowns] }));
  const issues = enabledRules.length
    ? automaticSkillDraftIssues(enabledRules, characterKey, activeOptions, settings, clearedLevels) : [];
  // 作者结构的提示供界面解释，执行准入只沿真实场景检查；这里不能另建更严格的适配门禁。
  return { drafts, enabledRules, basicAttack, basicAttackIssue, issues };
}
