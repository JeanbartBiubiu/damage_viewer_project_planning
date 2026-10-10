// 独立技能专项构造，可注入真实HTTP共同定义和已选参数目录。
// 不读取、复制或改写通用基准样例。
import { createFormulaPhase3Definition, createFormulaPhase3Input } from './formula-phase3-input.mjs';

export function createFormulaPhase3BDefinition({ skillKey = 'formula_phase3b_probe', parameterKey = 'basis', stages = 2 } = {}) {
  const inputs = [{ key: 'basis', binding: { kind: 'parameter', skillKey, parameterKey } }];
  const local = [
    { key: 'scaled', name: '等级数值', expression: { op: 'mul', args: [{ op: 'read', inputKey: 'basis' }, { op: 'const', value: '1.200' }] } },
    { key: 'output', name: '输出', expression: { op: 'ref', stageKey: 'scaled' } }
  ];
  if (stages === 6) local.push(
    { key: 'unused_zero', name: '未用动态结果', expression: { op: 'div', args: [{ op: 'read', inputKey: 'basis' }, { op: 'const', value: '0' }] } },
    { key: 'zero', name: '明确零', expression: { op: 'const', value: '0' } },
    { key: 'unused_ref', name: '未用引用', expression: { op: 'ref', stageKey: 'unused_zero' } },
    { key: 'unused_if', name: '未用条件', expression: { op: 'if', args: [{ op: 'const', value: '0' }, { op: 'ref', stageKey: 'unused_zero' }, { op: 'ref', stageKey: 'zero' }] } }
  );
  else if (stages !== 2) throw new Error('stages只接受2或6');
  return { inputs, stages: local, outputStageKey: 'output' };
}

export function createFormulaPhase3BInput({
  skillKey = 'formula_phase3b_probe', parameterKey = 'basis', programKey = 'probe/grade1/instance1',
  expression = createFormulaPhase3BDefinition({ skillKey, parameterKey }),
  parameters = [{ parameterKey, valueMode: 'SKILL_LEVEL', valueType: 'DECIMAL', value: 100 }],
  damageType = 'heat', damageFormula = createFormulaPhase3Definition(), attributeKey = 'armor'
} = {}) {
  const input = createFormulaPhase3Input({ damageType, attributeKey, formula: damageFormula });
  input.name = 'formula_phase3b_skill';
  input.compileRequest.formulas = [{ key: programKey, scope: 'skill', skillKey, expression: structuredClone(expression), parameters: structuredClone(parameters) }];
  const provider = input.compileRequest.sharedProviders[0];
  provider.skillKey = skillKey;
  provider.abilities[0].skillKey = skillKey;
  provider.abilities[0].operations[0].amount = { op: 'ref', ref: programKey };
  input.skillExpression = input.compileRequest.formulas[0].expression;
  input.programKey = programKey;
  return input;
}

export const createFormulaPhase3bInput = createFormulaPhase3BInput;
export const createFormulaPhase3bDefinition = createFormulaPhase3BDefinition;

export function createFormulaPhase3BTwoInstances(options = {}) {
  const input = createFormulaPhase3BInput(options);
  const first = input.compileRequest.formulas[0];
  const secondKey = `${first.key}/grade2/instance2`;
  input.compileRequest.formulas.push({ ...structuredClone(first), key: secondKey, parameters: first.parameters.map(parameter => ({ ...structuredClone(parameter), ...(parameter.valueMode === 'SKILL_LEVEL' ? { value: 200 } : {}) })) });
  const second = structuredClone(input.compileRequest.sharedProviders[0]);
  second.providerKey = 'formula_heat_second';
  second.abilities[0].operations[0].amount.ref = secondKey;
  input.compileRequest.sharedProviders.push(second);
  input.compileRequest.combatants[1].providers.push({ providerRef: 'second', definitionRef: second.providerKey });
  Object.assign(input.compileRequest.combatants[0].attributes, { hp: { base: 1000, current: 1000, max: 1000, resolved: 1000 }, [options.attributeKey ?? 'armor']: { base: 50, current: 50, max: 50, resolved: 50 } });
  Object.assign(input.runRequest.initialSnapshot.combatants[0].attributes, structuredClone(input.compileRequest.combatants[0].attributes));
  input.runRequest.initialSnapshot.combatants[0].shields = [{ shieldRef: 'first_shield', source: 'source', owner: 'source', remaining: 30, expireAt: null, state: {} }];
  input.runRequest.initialSnapshot.combatants[1].providers.push({ providerRef: 'second', definitionRef: second.providerKey, source: 'target', owner: 'target', stacks: 1, expireAt: null, state: {} });
  input.runRequest.driverPlan.entries.push({ entryKey: 'second_use', abilityRef: 'target.provider[second].ability[heat_hit]', source: 'target', target: 'source', firstAtMs: 25 });
  input.secondProgramKey = secondKey;
  return input;
}

export function createFormulaPhase3BDerivationInput() {
  const input = createFormulaPhase3BInput();
  const skillKey = input.compileRequest.formulas[0].skillKey;
  input.compileRequest.typeCatalog.types.push(...['hp', 'attack_damage', 'attack_speed'].map(key => ({ key, domain: 'attribute' })));
  const slot = (base, current = base, max = base) => ({ base, current, max, resolved: current });
  input.compileRequest.combatants[0].attributes = { armor: slot(10, 10, 1000), hp: slot(1000, 800, 1000), attack_damage: slot(100), attack_speed: slot(1) };
  input.compileRequest.combatants[1].attributes = { armor: slot(30, 30, 1000), hp: slot(1000, 600, 1000), attack_damage: slot(50), attack_speed: slot(2) };
  input.runRequest.initialSnapshot.combatants.forEach((actor, index) => { actor.attributes = structuredClone(input.compileRequest.combatants[index].attributes); });
  const commonConst = value => ({ op: 'const', value: String(value) });
  const read = inputKey => ({ op: 'read', inputKey });
  const binary = (op, left, right) => ({ op, args: [left, right] });
  input.compileRequest.formulas.push({ key: 'owner_dynamic', scope: 'skill', skillKey, parameters: [], expression: {
    inputs: [
      { key: 'owner_defense', binding: { kind: 'attribute', object: 'source', attributeKey: 'armor', valueKind: 'TOTAL', view: 'current_frame' } },
      { key: 'opponent_health', binding: { kind: 'attribute', object: 'target', attributeKey: 'hp', valueKind: 'CURRENT', view: 'current_frame' } }
    ], stages: [{ key: 'factor', name: '拥有方防御与对手生命', expression: binary('div', binary('add', read('owner_defense'), binary('div', read('opponent_health'), commonConst(100))), commonConst(10)) }], outputStageKey: 'factor'
  } }, { key: 'read_damage', scope: 'skill', skillKey, parameters: [], expression: {
    inputs: [{ key: 'damage', binding: { kind: 'attribute', object: 'source', attributeKey: 'attack_damage', valueKind: 'TOTAL', view: 'current_frame' } }],
    stages: [{ key: 'output', name: '本次派生后攻击力', expression: read('damage') }], outputStageKey: 'output'
  } });
  input.compileRequest.rules.attributeDerivations = ['source', 'target'].map(combatantKey => ({
    skillKey, combatantKey, attributeKey: 'attack_damage', valuePolicy: 'multiply', valueType: 'DECIMAL', value: {
      op: 'add', args: [{ op: 'ref', ref: 'owner_dynamic' }, { op: 'div', args: [
        { op: 'read', path: `${combatantKey === 'source' ? 'target' : 'source'}.attr.armor.base` }, { op: 'const', value: 100 }
      ] }]
    }
  }));
  input.compileRequest.sharedProviders[0].abilities[0].operations = [
    { operation: 'attribute_change', target: 'source', attributeKey: 'armor', valuePolicy: 'add', amount: { op: 'const', value: 10 } },
    { operation: 'attribute_change', target: 'target', attributeKey: 'armor', valuePolicy: 'add', amount: { op: 'const', value: 5 } },
    { operation: 'damage', target: 'target', damageType: 'heat', amount: { op: 'ref', ref: 'read_damage' } }
  ];
  return input;
}
