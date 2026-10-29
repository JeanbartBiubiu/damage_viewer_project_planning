import type { SimulationSnapshot } from '../types/simulationSnapshot';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillTriggerSceneAttributeSnapshotBinding, SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { SkillParameter } from '../types/skillParameter';
import { NumericAdaptationError, type NumericCompileState } from './numericAdapter';

type Detail = SkillTriggerSceneAttributeSnapshotBinding['detail'];
export type SceneAttributeParameterInput = Detail & {
  ruleKey: string; actionKey: string; bindingKey: string; parameterKey: string; value: number; sourcePaths: string[];
};
const sourceOrder = ['CHARACTER_LEVEL', 'EQUIPMENT_DIRECT'] as const;
const keyPattern = /^[a-z][a-z0-9_]{0,63}$/;
function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function exact(value: object, keys: readonly string[], path: string) {
  if (Object.keys(value).some(key => !keys.includes(key))) fail(path, '场景属性快照含未知字段');
}
function detailOf(binding: SkillTriggerSceneAttributeSnapshotBinding, path: string): Detail {
  exact(binding, ['bindingKey', 'parameterKey', 'sourceType', 'detail'], path);
  if (!keyPattern.test(binding.bindingKey) || !keyPattern.test(binding.parameterKey)
    || !binding.detail || typeof binding.detail !== 'object') fail(path, '场景属性快照引用不完整');
  const detail = binding.detail;
  exact(detail, ['subject', 'attributeKey', 'sources'], `${path}.detail`);
  if (!['SOURCE', 'TARGET'].includes(detail.subject) || !keyPattern.test(detail.attributeKey)
    || !Array.isArray(detail.sources) || !detail.sources.length || new Set(detail.sources).size !== detail.sources.length
    || detail.sources.some(source => !sourceOrder.includes(source))) fail(path, '场景属性快照对象、属性或来源集合无效');
  return { ...detail, sources: sourceOrder.filter(source => detail.sources.includes(source)) };
}
function parameterOf(parameters: readonly SkillParameter[], skillKey: string, parameterKey: string, path: string) {
  const rows = parameters.filter(parameter => parameter.skillKey === skillKey && parameter.parameterKey === parameterKey);
  const parameter = rows[0];
  if (rows.length !== 1 || !parameter || parameter.valueMode !== 'RUNTIME_INPUT'
    || !['INTEGER', 'DECIMAL'].includes(parameter.valueType)) fail(path, '场景属性快照只能绑定本技能已有的计算时数值参数');
  return parameter;
}
function checkedValue(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, '场景属性快照缺少真实有限值');
  return value;
}
function checkInitial(rule: SkillTriggerRuleDetail, action: SkillTriggerRuleDetail['actions'][number], skillKey: string, processKey: string, path: string) {
  if (rule.eventSource.eventType !== 'SKILL_USED' || rule.eventSource.detail.sourceSkillKey !== skillKey
    || rule.eventSource.detail.useKind !== 'ACTIVE' || rule.eventSource.detail.castPhase !== 'INITIAL'
    || action.actionType !== 'START_PROCESS' || action.detail.processKey !== processKey) {
    fail(path, '场景属性快照仅用于本技能明确的首次主动过程');
  }
}

/** 只采集作者显式指定的场景来源，不读取临时属性或给缺失等级值补0。 */
export function sceneAttributeParameterInputs(snapshot: SimulationSnapshot, configuration: SkillConfiguration, processKey: string): SceneAttributeParameterInput[] {
  const inputs: SceneAttributeParameterInput[] = [];
  for (const rule of configuration.triggerRules) for (const action of rule.actions) for (const binding of action.runtimeInputBindings) {
    if (binding.sourceType !== 'SCENE_ATTRIBUTE_SNAPSHOT') continue;
    const path = `skills.${configuration.skill.skillKey}.triggerRules.${rule.ruleKey}.actions.${action.actionKey}.runtimeInputBindings.${binding.bindingKey}`;
    checkInitial(rule, action, configuration.skill.skillKey, processKey, path);
    const detail = detailOf(binding, path);
    const parameter = parameterOf(configuration.parameters, configuration.skill.skillKey, binding.parameterKey, path);
    const attributes = snapshot.catalogs.attributes.filter(attribute => attribute.attributeKey === detail.attributeKey && attribute.status === 'ENABLED');
    if (attributes.length !== 1) fail(path, '场景属性快照缺少唯一已启用的属性目录');
    const side = detail.subject === 'SOURCE' ? 'source' : 'target';
    const actor = snapshot[side];
    const sourcePaths: string[] = [];
    let value = 0;
    for (const source of detail.sources) {
      if (source === 'CHARACTER_LEVEL') {
        const sourcePath = `${side}.selectedLevelValues.${detail.attributeKey}`;
        value += checkedValue(actor.selectedLevelValues[detail.attributeKey], sourcePath);
        sourcePaths.push(sourcePath);
      } else {
        if (!Array.isArray(actor.selectedEquipment)) fail(path, '场景属性快照缺少完整装备集合');
        for (const [index, item] of actor.selectedEquipment.entries()) {
          if (!item.attributes || !item.attributes.attributeValues) fail(path, '场景属性快照缺少完整装备直接属性');
          const sourcePath = `${side}.selectedEquipment[${index}].attributes.attributeValues.${detail.attributeKey}`;
          const raw = item.attributes.attributeValues[detail.attributeKey];
          value += raw === undefined ? 0 : checkedValue(raw, sourcePath);
          sourcePaths.push(sourcePath);
        }
      }
    }
    checkedValue(value, path);
    if (parameter.valueType === 'INTEGER' && !Number.isSafeInteger(value)) fail(path, '场景属性快照不满足计算时整数参数约束');
    inputs.push({ ...detail, ruleKey: rule.ruleKey, actionKey: action.actionKey, bindingKey: binding.bindingKey,
      parameterKey: binding.parameterKey, value, sourcePaths });
  }
  return inputs;
}

/** 校验采集结果与当前真实首次绑定逐项相同，再写入实际控制能力参数。 */
export function bindSceneAttributeParameters(authored: {
  gameId: string; skillKey: string; process: { processKey: string }; rules: readonly SkillTriggerRuleDetail[];
  parameters?: readonly SkillParameter[]; sceneAttributeInputs?: readonly SceneAttributeParameterInput[];
}, state: NumericCompileState): void {
  const inputs = authored.sceneAttributeInputs ?? [];
  if (!Array.isArray(inputs)) fail('sceneAttributeInputs', '场景属性快照输入必须是数组');
  const consumed = new Set<SceneAttributeParameterInput>();
  const reads = { ...state.runtimeInputReads };
  for (const rule of authored.rules) for (const action of rule.actions) for (const binding of action.runtimeInputBindings) {
    if (binding.sourceType !== 'SCENE_ATTRIBUTE_SNAPSHOT') continue;
    const path = `skills.${authored.skillKey}.runtimeInputBindings.${binding.bindingKey}`;
    checkInitial(rule, action, authored.skillKey, authored.process.processKey, path);
    const detail = detailOf(binding, path);
    const parameter = parameterOf(authored.parameters ?? [], authored.skillKey, binding.parameterKey, path);
    if (parameter.gameId !== authored.gameId) fail(path, '场景属性快照参数不属于当前游戏');
    const matches: SceneAttributeParameterInput[] = inputs.filter((input: SceneAttributeParameterInput) => input.ruleKey === rule.ruleKey && input.actionKey === action.actionKey
      && input.bindingKey === binding.bindingKey && input.parameterKey === binding.parameterKey);
    const input = matches[0];
    if (matches.length !== 1 || !input || input.subject !== detail.subject || input.attributeKey !== detail.attributeKey
      || JSON.stringify(input.sources) !== JSON.stringify(detail.sources) || consumed.has(input)
      || Object.prototype.hasOwnProperty.call(reads, binding.parameterKey)) fail(path, '场景属性快照缺失、重复或不属于当前首次绑定');
    const value = checkedValue(input.value, path);
    if (parameter.valueType === 'INTEGER' && !Number.isSafeInteger(value)) fail(path, '场景属性快照不满足计算时整数参数约束');
    consumed.add(input);
    state.params[binding.parameterKey] = value;
    reads[binding.parameterKey] = { op: 'read', path: `ability.param.${binding.parameterKey}` };
  }
  if (consumed.size !== inputs.length) fail('sceneAttributeInputs', '不能提供当前首次绑定没有声明的场景参数');
  if (consumed.size) state.runtimeInputReads = reads;
}
