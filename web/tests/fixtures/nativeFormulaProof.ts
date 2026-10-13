import { beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { TinyGoV2Bridge } from '../../src/engine/tinygoV2Bridge';
import { parseCompileResult, parseReleaseResult } from '../../src/engine/genericEngineClient';
import { createNumericCompileState, registerCommonFormula } from '../../src/engine/numericAdapter';
import { rememberApprovedFormulaValues, selectFormulaProofScope } from '../../src/engine/approvedFormulaValues';
import { skillFormulaPreflightRequest, snapshotFormulaProofIdentity } from '../../src/engine/skillFormulaPreflight';
import { validateStoredSkillFormula } from '../../src/services/skillFormulaContract';
import type { CompileRequest } from '../../src/types/genericEngine';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import type { SkillFormula } from '../../src/types/skillFormula';
import type { SkillParameter } from '../../src/types/skillParameter';

let bridge: TinyGoV2Bridge;
beforeAll(async () => {
  const bytes = readFileSync(process.env.PHASE3B_WASM_PATH || new URL('../../src/engine/wasm/tinygo_engine_v2.wasm', import.meta.url));
  bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
});
export function compileFixtureWithNative(request: CompileRequest) {
  const result = parseCompileResult(bridge.compile(request));
  if (result.sessionId) parseReleaseResult(bridge.releaseSession(result.sessionId, request.rulesHash));
  return result;
}
function approve(request: CompileRequest) {
  if (!request.formulas?.length) return;
  const result = parseCompileResult(bridge.compile(request));
  try {
    if (!result.ok || !result.sessionId) throw new Error(result.errors?.map(error => `${error.code} ${error.message}`).join('；') || '原生公式预检失败');
    rememberApprovedFormulaValues(request.formulas, result.metadata?.approvedStaticValues ?? {});
  } finally { if (result.sessionId) parseReleaseResult(bridge.releaseSession(result.sessionId, request.rulesHash)); }
}
export function approveSnapshotFixture(snapshot: SimulationSnapshot) {
  selectFormulaProofScope(snapshotFormulaProofIdentity(snapshot));
  const request = skillFormulaPreflightRequest(snapshot);
  approve(request);
}
export function approveAuthoredFixture(authored: { gameId: string; skillKey: string; skillLevel: number; characterLevel: number;
  formulas?: readonly SkillFormula[]; parameters?: readonly SkillParameter[] }) {
  if (!Array.isArray(authored?.formulas) || authored.formulas.some(row => validateStoredSkillFormula(row.expression, authored.skillKey))) return;
  selectFormulaProofScope(JSON.stringify(authored));
  const state = createNumericCompileState({ ...authored, formulaNamespace: 'fixture/preflight', bindParameters: false,
    allowAttributeReads: true, runtimeInputMessage: '单测预检不提供计算时输入' });
  const formulas = authored.formulas.filter(row => row.skillKey === authored.skillKey && row.gameId === authored.gameId)
    .map(row => registerCommonFormula(row, 'formulas.' + row.formulaKey, state));
  approve({ schemaVersion: 'generic-p0', schemaHash: 'fixture-formula-preflight', rulesHash: 'fixture-formula-preflight',
    typeCatalog: { types: [...new Set(formulas.flatMap(row => row.expression.inputs.flatMap(input => input.binding.kind === 'attribute' ? [input.binding.attributeKey] : [])))].map(key => ({ key, domain: 'attribute' })), relations: [] },
    combatants: (['source', 'target'] as const).map(key => ({ key, attributes: {}, resources: {}, providers: [] })),
    sharedProviders: [], rules: {}, formulas });
}
