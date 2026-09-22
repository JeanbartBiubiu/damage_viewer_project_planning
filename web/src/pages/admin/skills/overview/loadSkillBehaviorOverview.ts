import { getErrorMessage } from '../../../../services/apiClient';
import { getSkillEffect, listSkillEffects } from '../../../../services/skillEffectClient';
import { listSkillFormulas } from '../../../../services/skillFormulaClient';
import { getSkillInternalState, listSkillInternalStates } from '../../../../services/skillInternalStateClient';
import { listSkillParameters } from '../../../../services/skillParameterClient';
import { getSkillProcess, listSkillProcesses } from '../../../../services/skillProcessClient';
import { getSkillTriggerRule, listSkillTriggerRules } from '../../../../services/skillTriggerRuleClient';
import type { SkillEffect, SkillEffectSummary } from '../../../../types/skillEffect';
import type { SkillFormulaSummary } from '../../../../types/skillFormula';
import type { SkillInternalState, SkillInternalStateSummary } from '../../../../types/skillInternalState';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { SkillProcess, SkillProcessSummary } from '../../../../types/skillProcess';
import type { SkillTriggerRuleDetail, SkillTriggerRuleSummary } from '../../../../types/skillTriggerRule';
import { mapWithConcurrency } from './mapWithConcurrency';

export const SKILL_BEHAVIOR_DETAIL_CONCURRENCY = 4;

export type CatalogLoadResult<T> = {
  items: T[];
  error: string | null;
};

export type DetailLoadResult<TSummary, TDetail> = {
  summaries: TSummary[];
  details: TDetail[];
  failedKeys: string[];
  listError: string | null;
};

export type SkillBehaviorOverviewBundle = {
  skillKey: string;
  generation: number;
  parameters: CatalogLoadResult<SkillParameter>;
  formulas: CatalogLoadResult<SkillFormulaSummary>;
  effects: DetailLoadResult<SkillEffectSummary, SkillEffect>;
  processes: DetailLoadResult<SkillProcessSummary, SkillProcess>;
  internalStates: DetailLoadResult<SkillInternalStateSummary, SkillInternalState>;
  rules: DetailLoadResult<SkillTriggerRuleSummary, SkillTriggerRuleDetail>;
  complete: boolean;
};

export type SkillBehaviorOverviewRequest = {
  apiBaseUrl: string;
  gameId: string;
  skillKey: string;
  token: string;
  generation: number;
};

async function loadCatalog<T>(loader: () => Promise<{ data: T[] }>): Promise<CatalogLoadResult<T>> {
  try {
    const result = await loader();
    return { items: result.data, error: null };
  } catch (error) {
    return { items: [], error: getErrorMessage(error) };
  }
}

async function loadDetails<TSummary, TDetail>(
  summaries: TSummary[],
  keyOf: (item: TSummary) => string,
  loader: (key: string) => Promise<{ data: TDetail }>,
  isCurrent: () => boolean
): Promise<{ details: TDetail[]; failedKeys: string[] }> {
  const keys = summaries.map(keyOf);
  const settled = await mapWithConcurrency(keys, SKILL_BEHAVIOR_DETAIL_CONCURRENCY, async (key) => {
    if (!isCurrent()) throw new Error('stale');
    return (await loader(key)).data;
  });
  const details: TDetail[] = [];
  const failedKeys: string[] = [];
  settled.forEach((result, index) => {
    const key = keys[index] as string;
    if (result.status === 'fulfilled') details.push(result.value);
    else if (isCurrent()) failedKeys.push(key);
  });
  return { details, failedKeys };
}

export async function loadSkillBehaviorOverview(
  request: SkillBehaviorOverviewRequest,
  isCurrent: (generation: number) => boolean = () => true
): Promise<SkillBehaviorOverviewBundle | null> {
  const current = () => isCurrent(request.generation);
  const { apiBaseUrl, gameId, skillKey, token } = request;
  const [parameters, formulas, effectList, processList, stateList, ruleList] = await Promise.all([
    loadCatalog(() => listSkillParameters(apiBaseUrl, gameId, skillKey, token)),
    loadCatalog(() => listSkillFormulas(apiBaseUrl, gameId, skillKey, token)),
    loadCatalog(() => listSkillEffects(apiBaseUrl, gameId, skillKey, token)),
    loadCatalog(() => listSkillProcesses(apiBaseUrl, gameId, skillKey, token)),
    loadCatalog(() => listSkillInternalStates(apiBaseUrl, gameId, skillKey, token)),
    loadCatalog(() => listSkillTriggerRules(apiBaseUrl, gameId, skillKey, token))
  ]);
  if (!current()) return null;

  const effects = effectList.error ? { details: [] as SkillEffect[], failedKeys: [] as string[] }
    : await loadDetails(effectList.items, (item) => item.effectKey, (key) => getSkillEffect(apiBaseUrl, gameId, skillKey, key, token), current);
  if (!current()) return null;
  const processes = processList.error ? { details: [] as SkillProcess[], failedKeys: [] as string[] }
    : await loadDetails(processList.items, (item) => item.processKey, (key) => getSkillProcess(apiBaseUrl, gameId, skillKey, key, token), current);
  if (!current()) return null;
  const internalStates = stateList.error ? { details: [] as SkillInternalState[], failedKeys: [] as string[] }
    : await loadDetails(stateList.items, (item) => item.stateKey, (key) => getSkillInternalState(apiBaseUrl, gameId, skillKey, key, token), current);
  if (!current()) return null;
  const rules = ruleList.error ? { details: [] as SkillTriggerRuleDetail[], failedKeys: [] as string[] }
    : await loadDetails(ruleList.items, (item) => item.ruleKey, (key) => getSkillTriggerRule(apiBaseUrl, gameId, skillKey, key, token), current);
  if (!current()) return null;

  const bundle: SkillBehaviorOverviewBundle = {
    skillKey,
    generation: request.generation,
    parameters,
    formulas,
    effects: { summaries: effectList.items, details: effects.details, failedKeys: effects.failedKeys, listError: effectList.error },
    processes: { summaries: processList.items, details: processes.details, failedKeys: processes.failedKeys, listError: processList.error },
    internalStates: { summaries: stateList.items, details: internalStates.details, failedKeys: internalStates.failedKeys, listError: stateList.error },
    rules: { summaries: ruleList.items, details: rules.details, failedKeys: rules.failedKeys, listError: ruleList.error },
    complete: !parameters.error && !formulas.error && !effectList.error && !processList.error && !stateList.error && !ruleList.error
      && effects.failedKeys.length === 0 && processes.failedKeys.length === 0
      && internalStates.failedKeys.length === 0 && rules.failedKeys.length === 0
  };
  return bundle;
}

export function overviewIncompleteReasons(bundle: SkillBehaviorOverviewBundle): string[] {
  const reasons: string[] = [];
  const named = [
    ['参数', bundle.parameters.error],
    ['公式', bundle.formulas.error],
    ['效果列表', bundle.effects.listError],
    ['过程列表', bundle.processes.listError],
    ['内部状态列表', bundle.internalStates.listError],
    ['规则列表', bundle.rules.listError]
  ] as const;
  for (const [label, error] of named) {
    if (error) reasons.push(`${label}读取失败：${error}`);
  }
  if (bundle.effects.failedKeys.length) reasons.push(`效果详情未完整：${bundle.effects.failedKeys.join('、')}`);
  if (bundle.processes.failedKeys.length) reasons.push(`过程详情未完整：${bundle.processes.failedKeys.join('、')}`);
  if (bundle.internalStates.failedKeys.length) reasons.push(`内部状态详情未完整：${bundle.internalStates.failedKeys.join('、')}`);
  if (bundle.rules.failedKeys.length) reasons.push(`规则详情未完整：${bundle.rules.failedKeys.join('、')}`);
  return reasons;
}
