import type { GenericEngineClient } from '../../src/engine/genericEngineClient';
import type { TypeCatalog } from '../../src/types/genericEngine';
import type { SkillFormula } from '../../src/types/skillFormula';
import type { SkillParameter } from '../../src/types/skillParameter';
import { createNumericCompileState, registerCommonFormula } from '../../src/engine/numericAdapter';
import { rememberApprovedFormulaValues, selectFormulaProofScope } from '../../src/engine/approvedFormulaValues';

/** 手工作者场景使用同一实际Worker完成3B预检；不增加数值解释器或属性授权。 */
export async function approveAuthoredFormulaProof(authored: { gameId: string; skillKey: string; skillLevel: number;
  characterLevel: number; formulas?: readonly SkillFormula[]; parameters?: readonly SkillParameter[] },
client: GenericEngineClient, catalog: TypeCatalog) {
  selectFormulaProofScope(JSON.stringify(authored));
  const state = createNumericCompileState({ ...authored, formulaNamespace: 'fixture/preflight', bindParameters: false,
    allowAttributeReads: true, runtimeInputMessage: '作者预检不提供计算时输入' });
  const formulas = (authored.formulas ?? []).filter(row => row.skillKey === authored.skillKey && row.gameId === authored.gameId)
    .map(row => registerCommonFormula(row, 'formulas.' + row.formulaKey, state));
  if (!formulas.length) return { compileCount: 0, released: true, values: {} as Record<string, number> };
  const rulesHash = 'phase4.authored-formula-proof';
  const compiled = await client.compile({ schemaVersion: 'generic-p0', schemaHash: rulesHash, rulesHash,
    typeCatalog: catalog, combatants: (['source', 'target'] as const).map(key => ({ key, attributes: {}, resources: {}, providers: [] })),
    sharedProviders: [], rules: {}, formulas });
  if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
  try { rememberApprovedFormulaValues(formulas, compiled.metadata?.approvedStaticValues ?? {}); }
  finally {
    const released = await client.release(compiled.sessionId, rulesHash);
    if (!released.released) throw new Error('作者公式预检会话未释放');
  }
  return { compileCount: 1, released: true, values: compiled.metadata?.approvedStaticValues ?? {} };
}
