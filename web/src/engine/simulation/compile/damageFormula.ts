import { damageTypeFormulaAllowedBindings } from '../../../types/damageTypeFormula';
import { parseDamageTypeFormulaDefinition } from '../../../services/damageTypeClient';
import type { GenericDamageTypeFormula } from '../../../types/genericEngine';
import type { SimulationSnapshot } from '../../../types/simulationSnapshot';
import { METADATA, fail, exact, stableKey } from './validation';

export function compileSimulationDamageFormula(snapshot: SimulationSnapshot, damageKey: string): GenericDamageTypeFormula {
  stableKey(damageKey, `catalogs.damageTypes.${damageKey}`);
  const entries = snapshot.catalogs.damageTypes.filter(row => row.type.damageTypeKey === damageKey);
  const authored = entries[0];
  if (entries.length !== 1 || !authored || authored.type.gameId !== snapshot.gameId || authored.type.status !== 'ENABLED'
    || authored.type.formulaConfigured !== true) fail(`catalogs.damageTypes.${damageKey}`, '缺少唯一已启用的真实共同防御公式');
  exact(authored.type, ['gameId', 'damageTypeKey', 'status', 'formulaConfigured', ...METADATA], `catalogs.damageTypes.${damageKey}.type`);
  exact(authored.formula, ['gameId', 'damageTypeKey', 'formula', 'updatedAt'], `catalogs.damageTypes.${damageKey}.formula`);
  if (authored.formula.gameId !== snapshot.gameId || authored.formula.damageTypeKey !== damageKey) fail(`catalogs.damageTypes.${damageKey}.formula`, '防御公式归属不一致');
  const formula = parseDamageTypeFormulaDefinition(authored.formula.formula,
    damageTypeFormulaAllowedBindings(snapshot.catalogs.attributes.filter(attribute => attribute.gameId === snapshot.gameId)));
  return { damageType: damageKey, formula };
}
