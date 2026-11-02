import { validateStoredSkillFormula } from '../../../services/skillFormulaContract';
import type { SkillConfiguration } from '../../../types/skillConfiguration';
import type { FormulaExpressionNode } from '../../../types/skillFormula';
import { METADATA, fail, exact, array, uniqueRows } from './validation';

function validateFormulaNode(node: FormulaExpressionNode, path: string, skillKey: string) {
  const problem = validateStoredSkillFormula(node, skillKey);
  if (problem) fail(path + problem.path, problem.code);
}
export function validateConfiguration(configuration: SkillConfiguration, gameId: string, root: string, item: boolean, skillLevel: number, equipmentPassiveCategoryKey: string | null) {
  exact(configuration, ['skill', 'parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules', 'baseDigest'], root);
  exact(configuration.skill, ['gameId', 'skillKey', 'maxLevel', 'status', 'skillCategoryKeys', ...METADATA], `${root}.skill`);
  const categories = array(configuration.skill.skillCategoryKeys, `${root}.skill.skillCategoryKeys`);
  if (item && equipmentPassiveCategoryKey === null) fail('catalogs.calculationRules.configuration.equipmentPassiveCategoryKey', '实际启用且可达的装备技能需要明确配置被动分类用途绑定');
  if (configuration.skill.gameId !== gameId || configuration.skill.status !== 'ENABLED'
    || !Number.isSafeInteger(configuration.skill.maxLevel) || configuration.skill.maxLevel < 1
    || !Number.isSafeInteger(skillLevel) || skillLevel < 1 || skillLevel > configuration.skill.maxLevel
    || item && (configuration.skill.maxLevel !== 1 || skillLevel !== 1 || !categories.includes(equipmentPassiveCategoryKey!))
    || new Set(categories).size !== categories.length) {
    fail(root, item ? '装备关系需要完整单级、已启用的被动技能' : '自然来源需要真实启用技能与明确合法已学等级');
  }
  uniqueRows(configuration.parameters, row => row.parameterKey, `${root}.parameters`);
  uniqueRows(configuration.formulas, row => row.formulaKey, `${root}.formulas`);
  uniqueRows(configuration.effects, row => row.effectKey, `${root}.effects`);
  uniqueRows(configuration.processes, row => row.processKey, `${root}.processes`);
  uniqueRows(configuration.internalStates, row => row.stateKey, `${root}.internalStates`);
  uniqueRows(configuration.triggerRules, row => row.ruleKey, `${root}.triggerRules`);
  if (!configuration.triggerRules.length || !configuration.effects.length && (item || !configuration.processes.length && !configuration.internalStates.length)) fail(root, '缺少完整效果或触发规则，不能仅取直接属性');
  for (const parameter of configuration.parameters) {
    const path = `${root}.parameters.${parameter.parameterKey}`;
    exact(parameter, ['gameId', 'skillKey', 'parameterKey', 'valueType', 'valueMode', 'fixedValue', 'levelValues', ...METADATA], path);
    if (parameter.gameId !== gameId || parameter.skillKey !== configuration.skill.skillKey
      || !['INTEGER', 'DECIMAL'].includes(parameter.valueType)
      || !['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL', 'RUNTIME_INPUT'].includes(parameter.valueMode)) fail(path, '参数归属或取值方式未核定');
    if (parameter.valueMode === 'FIXED' && parameter.levelValues !== null
      || parameter.valueMode !== 'FIXED' && parameter.fixedValue !== null
      || parameter.valueMode === 'RUNTIME_INPUT' && parameter.levelValues !== null) fail(path, '参数必须符合声明的取值方式，不能忽略另一组数值');
  }
  for (const formula of configuration.formulas) {
    const path = `${root}.formulas.${formula.formulaKey}`;
    exact(formula, ['gameId', 'skillKey', 'formulaKey', 'expression', ...METADATA], path);
    if (formula.gameId !== gameId || formula.skillKey !== configuration.skill.skillKey) fail(path, '公式归属不一致');
    validateFormulaNode(formula.expression, `${path}.expression`, configuration.skill.skillKey);
  }
}
