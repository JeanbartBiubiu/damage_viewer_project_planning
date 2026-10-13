import type { CompileRequest, GenericFormulaExpr, OperationDefinition, NamedFormula, RunRequest } from '../types/genericEngine';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import { parseGameCalculationRules } from '../services/gameCalculationRulesClient';
import { skillFormulaReachableInputs } from '../services/skillFormulaContract';
import { registerFormulaForApprovedReads } from './approvedFormulaValues';
import { NumericAdaptationError } from './numericAdapter';
import type { SimulationAttributeDerivation } from './simulationAttributeConversion';
import { reachableAttributeChanges } from './simulationReachableAttributeChanges';

export type ChangedAttributes = Record<'source' | 'target', Set<string>>;
export function changedAttributes(): ChangedAttributes { return { source: new Set(), target: new Set() }; }
export function calculationConfiguration(snapshot: SimulationSnapshot) {
  return parseGameCalculationRules(snapshot.catalogs.calculationRules, snapshot.gameId, snapshot.catalogs.attributes, snapshot.catalogs.skillCategories).configuration;
}
export function gameDerivationFormula(snapshot: SimulationSnapshot, rule: NonNullable<ReturnType<typeof calculationConfiguration>>['attributeDerivations'][number], side: 'source' | 'target'): NamedFormula {
  return { key: `game/${snapshot.gameId}/${rule.ruleKey}/${side}/attribute_derivation`, scope: 'game', parameters: [], expression: structuredClone(rule.formula) };
}
export function simulationCriticalBinding(snapshot: SimulationSnapshot, forced: boolean, path: string): Pick<OperationDefinition, 'critChance' | 'critMultiplierMin'> {
  const configuration = calculationConfiguration(snapshot);
  const key = configuration?.criticalChanceAttributeKey;
  if (!forced && !key) throw new NumericAdaptationError(path, '按来源概率暴击必须明确配置游戏概率属性绑定');
  return { critChance: forced ? { op: 'const', value: 1 } : { op: 'read', path: `source.attr.${key}.resolved` },
    ...(configuration?.criticalMultiplierMin !== null && configuration?.criticalMultiplierMin !== undefined
      ? { critMultiplierMin: configuration.criticalMultiplierMin } : {}) };
}
export function assembleGameAttributeDerivations(snapshot: SimulationSnapshot, changed: ChangedAttributes,
  sourceDerivations: readonly SimulationAttributeDerivation[]) {
  const configuration = calculationConfiguration(snapshot);
  const derivations: SimulationAttributeDerivation[] = [];
  const formulas: NamedFormula[] = [];
  const required = changedAttributes();
  const coverage: Array<{ authorPath: string; compiledPath: string }> = [];
  for (const side of ['source', 'target'] as const) for (const [index, rule] of (configuration?.attributeDerivations ?? []).entries()) {
    if (!rule.activationAttributeKeys.some(key => changed[side].has(key))
      || sourceDerivations.some(row => row.combatantKey === side && row.attributeKey === rule.attributeKey)) continue;
    const output = snapshot.catalogs.attributes.find(row => row.attributeKey === rule.attributeKey)!;
    const formula = gameDerivationFormula(snapshot, rule, side);
    const key = formula.key;
    registerFormulaForApprovedReads(formula);
    formulas.push(formula);
    const compiledIndex = derivations.length;
    derivations.push({ combatantKey: side, attributeKey: rule.attributeKey, valuePolicy: rule.valuePolicy,
      valueType: output.valueType, value: { op: 'ref', ref: key } });
    required[side].add(rule.attributeKey);
    for (const input of skillFormulaReachableInputs(rule.formula)) if (input.binding.kind === 'attribute') required[side].add(input.binding.attributeKey);
    coverage.push({ authorPath: `catalogs.calculationRules.configuration.attributeDerivations[${index}]`, compiledPath: `rules.attributeDerivations[game_${compiledIndex}]` },
      { authorPath: `catalogs.calculationRules.configuration.attributeDerivations[${index}].formula`, compiledPath: `formulas[${key}].expression` });
  }
  return { derivations, formulas, required, coverage };
}

/** 只收真实公式依赖和可能改变它们的运行来源，不解释公式运算。 */
export function hasDynamicSpeedDependency(input: CompileRequest, side: 'source' | 'target', speedKey: string, request?: RunRequest) {
  const dependencies = new Set([`${side}.${speedKey}`]);
  const read = (value: GenericFormulaExpr, owner: 'source' | 'target') => {
    if (value.op === 'ref') {
      const formula = input.formulas?.find(row => row.key === value.ref);
      if (formula) for (const row of skillFormulaReachableInputs(formula.expression)) if (row.binding.kind === 'attribute' && row.binding.valueKind !== 'BASE') {
        const reader = row.binding.object === 'source' ? owner : owner === 'source' ? 'target' : 'source';
        dependencies.add(`${reader}.${row.binding.attributeKey}`);
      }
    }
    if (value.op === 'read') {
      const match = /^(source|target)\.attr\.([a-z][a-z0-9_]*)\.(\w+)$/.exec(value.path ?? '');
      if (match && match[3] !== 'base') dependencies.add(`${match[1]}.${match[2]}`);
    }
    value.args?.forEach(child => read(child, owner));
    for (const child of [value.min, value.max, value.expr]) if (child) read(child, owner);
  };
  input.rules.attributeDerivations?.filter(row => row.combatantKey === side && row.attributeKey === speedKey).forEach(row => read(row.value, row.combatantKey));
  if (Array.from(reachableAttributeChanges(input, request)).some(key => dependencies.has(key))) return true;
  return input.sharedProviders?.some(provider => (provider.initialStateSchema || provider.lifecycle)
    && provider.modifiers?.some(modifier => {
      const match = /^(self|opponent)\.attr\.([a-z][a-z0-9_]*)$/.exec(modifier.target ?? '');
      if (modifier.kind !== 'attribute' || !match) return false;
      const owners = input.combatants.filter(actor => actor.providers.some(mount => mount.definitionRef === provider.providerKey
        || input.sharedProviders?.some(root => root.providerKey === mount.definitionRef && root.stableId === provider.stableId)));
      return owners.some(owner => dependencies.has(`${match[1] === 'self' ? owner.key : owner.key === 'source' ? 'target' : 'source'}.${match[2]}`));
    })) ?? false;
}
