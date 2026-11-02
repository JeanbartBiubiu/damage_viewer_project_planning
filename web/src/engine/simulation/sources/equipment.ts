import { calculationConfiguration } from '../../simulationCalculationRules';
import type { SimulationSnapshot } from '../../../types/simulationSnapshot';
import { executableEquipmentRelations, validateSimulationSkillSourceManifest } from './description';
import { selectSimulationSkillSourceClosure } from './closure';
import type { SimulationCoverage, TriggeredSourceAssembly, TriggeredSourceDescription } from '../model';
import { permanentModifier, validatePermanentEffect } from '../../simulationPermanentResults';
import { normalizeSceneInitialParameterInputs, sceneInitialParameterRequirements, sceneInitialValuesForSource, type SceneInitialParameterInput } from '../../sceneInitialParameterInput';
import { fail, exact, array, stableKey, uniqueRows, ordered } from '../compile/validation';
import { validateConfiguration } from '../compile/configuration';
import { assembleTriggeredSkillSources } from '../compile/triggered';


export function assembleTriggeredEquipment(snapshot: SimulationSnapshot, sceneInputs: readonly SceneInitialParameterInput[] = []): TriggeredSourceAssembly {
  const normalized = normalizeSceneInitialParameterInputs(snapshot, sceneInputs);
  const sceneRequirements = sceneInitialParameterRequirements(snapshot);
  validateSimulationSkillSourceManifest(snapshot);
  const descriptions: TriggeredSourceDescription[] = [];
  const excludedCoverage: SimulationCoverage[] = [];
  for (const side of ['source', 'target'] as const) {
    const keys = array(snapshot.selection[`${side}EquipmentKeys`], `selection.${side}EquipmentKeys`);
    const items = array(snapshot[side].selectedEquipment, `${side}.selectedEquipment`);
    if (new Set(keys).size !== keys.length || keys.length > 6) fail(`selection.${side}EquipmentKeys`, '装备选择不能重复或超过6件');
    if (keys.length !== items.length
      || new Set(items.map(item => item.equipment.equipmentKey)).size !== items.length
      || items.some(item => !keys.includes(item.equipment.equipmentKey))) fail(`${side}.selectedEquipment`, '所选装备完整集缺失或重复');
    for (const equipmentKey of [...keys].sort()) {
      stableKey(equipmentKey, `selection.${side}EquipmentKeys`);
      const path = `${side}.selectedEquipment[${equipmentKey}]`;
      const item = items.find(row => row.equipment.equipmentKey === equipmentKey)!;
      if (item.equipment.gameId !== snapshot.gameId || item.attributes.equipmentKey !== equipmentKey) fail(path, '装备归属不一致');
      const allRelations = array(item.attachedSkills, `${path}.attachedSkills`);
      const relations = executableEquipmentRelations(snapshot, side, equipmentKey);
      uniqueRows(allRelations, row => row.skillKey, `${path}.attachedSkills`);
      uniqueRows(relations, row => row.skillKey, `${path}.attachedSkills`);
      for (const relation of relations) {
        const relationPath = `${path}.attachedSkills[${relations.indexOf(relation)}]`;
        exact(relation, ['gameId', 'skillKey', 'skillName', 'skillStatus', 'sortOrder', 'equipmentKey', 'equipmentName'], relationPath);
        if (relation.gameId !== snapshot.gameId || relation.equipmentKey !== equipmentKey || relation.skillStatus !== 'ENABLED') {
          fail(relationPath, '必须保留完整启用被动关系，整件装备拒绝，不能过滤后只取直接属性');
        }
      }
      if (!relations.length) continue;
      if (!Number.isInteger(snapshot.selection[`${side}Level`]) || snapshot.selection[`${side}Level`] < 1) fail(`selection.${side}Level`, '装备拥有方等级必须明确且有效');
      const providerRef = `${side}_${equipmentKey}_passive`;
      const definitionRef = `${providerRef}_definition`;
      descriptions.push({ side, kind: 'item', stableId: `${side}_equipment_${equipmentKey}_definition`,
        providerRef, definitionRef, path, equipmentKey, skills: ordered(relations, `${path}.attachedSkills`).map(relation => {
          const configurations = snapshot.skillConfigurations.filter(row => row.skill.skillKey === relation.skillKey);
          if (configurations.length !== 1) fail(`${path}.attachedSkills`, '完整被动配置缺失或重复，整件装备拒绝');
          const complete = configurations[0]!;
          validateConfiguration(complete, snapshot.gameId, `skills.${relation.skillKey}`, true, 1, calculationConfiguration(snapshot)?.equipmentPassiveCategoryKey ?? null);
          const source = snapshot[side].skillSources.find(source => source.origin.kind === 'EQUIPMENT'
            && source.origin.equipmentKey === equipmentKey && source.skillKey === relation.skillKey)!;
          const rootKeys = source.enabledRuleKeys;
          const { configuration } = selectSimulationSkillSourceClosure(complete, rootKeys);
          // 作者说明公式与参数继续完整校验、保留，不把未挂接的值冒充实际效果。
          configuration.parameters = complete.parameters;
          configuration.formulas = complete.formulas;
          for (const [collection, key] of [
            ['effects', 'effectKey'], ['processes', 'processKey'], ['internalStates', 'stateKey'], ['triggerRules', 'ruleKey']
          ] as const) for (const authored of complete[collection]) {
            const stableKey = (authored as unknown as Record<string, unknown>)[key];
            if (!configuration[collection].some(row => (row as unknown as Record<string, unknown>)[key] === stableKey)) {
              excludedCoverage.push({ authorPath: `skills.${relation.skillKey}.${collection}.${stableKey}`,
                compiledPath: 'runtimeOptions.skillOrigins', note: '完整作者配置保留；本场没有可达入口，不生成执行程序' });
            }
          }
          return { skillKey: relation.skillKey, skillLevel: 1,
            path: `${path}.attachedSkills[${relations.indexOf(relation)}]`, configuration, allowedRootKeys: rootKeys,
            sceneInitialValues: sceneInitialValuesForSource(sceneRequirements, normalized, side, source),
            permanentModifier: (result, resultPath, onNumericConsumed) => {
              const effect = configuration.effects.find(row => row.results.includes(result))!;
              const context = { snapshot, configuration, source, side, formulaNamespace: `${providerRef}/${relation.skillKey}/permanent`, onNumericConsumed };
              validatePermanentEffect(effect, `skills.${relation.skillKey}.effects.${effect.effectKey}`, context);
              const modifier = permanentModifier(context, result, resultPath);
              if ('combatantKey' in modifier) fail(resultPath, '装备常驻只接入明确静态修正，动态转换尚未开放');
              return modifier;
            } };
        }) });
    }
  }
  const assembled = assembleTriggeredSkillSources(snapshot, descriptions);
  const expected = descriptions.flatMap(description => description.skills.map(skill =>
    JSON.stringify([description.side, description.providerRef, description.definitionRef, skill.skillKey])));
  const actual = assembled.compiledSources.map(source => JSON.stringify([source.side, source.providerRef, source.definitionRef, source.skillKey]));
  if (new Set(expected).size !== expected.length || new Set(actual).size !== actual.length
    || expected.length !== actual.length || expected.some(source => !actual.includes(source))) {
    fail('skillSources', '开启装备来源与实编拥有方、挂载及技能身份不一致，不能漏编或覆盖兄弟技能');
  }
  assembled.coverage.push(...excludedCoverage);
  return assembled;
}
