import type { CompileRequest, NamedFormula } from '../types/genericEngine';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import { GenericEngineClient } from './genericEngineClient';
import { createNumericCompileState, registerCommonFormula } from './numericAdapter';
import { rememberApprovedFormulaValues, selectFormulaProofScope, matchesFormulaProofScope, clearFormulaProofScope } from './approvedFormulaValues';
import { calculationConfiguration, gameDerivationFormula } from './simulationCalculationRules';
import { normalizeSceneInitialParameterInputs, sceneInitialParameterRequirements, sceneInitialValuesForSource,
  type SceneInitialParameterInput } from './sceneInitialParameterInput';

/** 完整场景来源、等级及绑定共同组成预检身份，任何相关快照变更都重新编译。 */
export function snapshotFormulaProofIdentity(snapshot: SimulationSnapshot, sceneInputs: readonly SceneInitialParameterInput[] = []) {
  return JSON.stringify([snapshot, normalizeSceneInitialParameterInputs(snapshot, sceneInputs)]);
}
export function skillFormulaPreflightRequest(snapshot: SimulationSnapshot, sceneInputs: readonly SceneInitialParameterInput[] = []): CompileRequest {
  const normalized = normalizeSceneInitialParameterInputs(snapshot, sceneInputs);
  const requirements = sceneInitialParameterRequirements(snapshot);
  const formulas: NamedFormula[] = [];
  for (const side of ['source', 'target'] as const) for (const rule of calculationConfiguration(snapshot)?.attributeDerivations ?? []) {
    formulas.push(gameDerivationFormula(snapshot, rule, side));
  }
  for (const side of ['source', 'target'] as const) for (const [sourceIndex, source] of snapshot[side].skillSources.entries()) {
    if (!source.enabled || source.inactiveReason !== null || source.skillLevel === null || source.skillLevel < 1) continue;
    const config = snapshot.skillConfigurations.find(row => row.skill.skillKey === source.skillKey);
    if (!config) throw new Error('公式预检缺少真实来源技能配置。');
    const state = createNumericCompileState({ gameId: snapshot.gameId, skillKey: source.skillKey, skillLevel: source.skillLevel,
      characterLevel: snapshot.selection[`${side}Level`], parameters: config.parameters, formulas: config.formulas,
      formulaNamespace: 'preflight/' + side + '/' + sourceIndex + '/' + source.skillKey,
      bindParameters: false, allowAttributeReads: true, runtimeInputMessage: '预检不运行技能或供给计算时输入',
      sceneParameterValues: sceneInitialValuesForSource(requirements, normalized, side, source) });
    for (const formula of config.formulas) formulas.push(registerCommonFormula(formula, 'formulas.' + formula.formulaKey, state));
  }
  return { schemaVersion: 'generic-p0', schemaHash: 'generic-basic-attack-input-v4', rulesHash: 'skill-formula-preflight',
    typeCatalog: { types: [{ key: 'combatant/champion', domain: 'combatant' }, ...snapshot.catalogs.attributes.map(row => ({ key: row.attributeKey, domain: 'attribute' }))], relations: [] },
    combatants: (['source', 'target'] as const).map(key => ({ key, types: ['combatant/champion'], attributes: {}, resources: {}, providers: [] })),
    sharedProviders: [], rules: {}, formulas };
}
export async function preflightSkillFormulas(snapshot: SimulationSnapshot, client: GenericEngineClient,
  isCurrent: () => boolean = () => true, sceneInputs: readonly SceneInitialParameterInput[] = []) {
  let identity: string | undefined;
  let revision: number | undefined;
  let request: CompileRequest | undefined;
  let sessionId: string | null = null;
  let confirmed = false;
  try {
    identity = snapshotFormulaProofIdentity(snapshot, sceneInputs);
    revision = selectFormulaProofScope(identity, true);
    request = skillFormulaPreflightRequest(snapshot, sceneInputs);
    if (!isCurrent() || !matchesFormulaProofScope(identity, revision)) throw new Error('公式预检已取消或场景已经改变。');
    if (!request.formulas?.length) return { compileCount: 0, released: true, formulaCount: 0 };
    const result = await client.compile(request);
    sessionId = result.sessionId ?? null;
    if (!isCurrent() || !matchesFormulaProofScope(identity, revision)) throw new Error('公式预检已取消或场景已经改变。');
    if (!result.ok || !sessionId) throw new Error(result.errors?.map(row => `${row.code} ${row.path ?? ''} ${row.message}`).join('；') || '公式原生预检未通过。');
    const values = result.metadata?.approvedStaticValues ?? {};
    const released = await client.release(sessionId, request.rulesHash);
    if (released.sessionId !== sessionId) throw new Error('公式预检释放响应的会话身份不一致。');
    sessionId = null;
    if (!isCurrent() || !matchesFormulaProofScope(identity, revision)) throw new Error('公式预检已取消或场景已经改变。');
    rememberApprovedFormulaValues(request.formulas, values);
    confirmed = true;
    return { compileCount: 1, released: true, formulaCount: request.formulas.length };
  } finally {
    if (!confirmed && identity !== undefined) clearFormulaProofScope(identity, revision);
    if (sessionId && client.hasLiveWorker) await client.release(sessionId, request?.rulesHash);
  }
}
