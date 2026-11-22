import type { GameCalculationConfiguration, GameCalculationRulesResponse } from '../../types/gameCalculationRules';
import { ApiRequestError, type ApiResult } from '../apiClient';
import { sameFormulaPayload } from '../skillFormulaContract';
import { fail, getGameCalculationRules, parseGameCalculationRules, path } from '../gameCalculationRulesClient';
import { requestMaintenanceJson } from '../maintenanceApiRequest';

export class UnconfirmedCalculationRulesWriteError extends Error {}

export async function updateGameCalculationRules(api: string, gameId: string, body: { baseDigest: string; configuration: GameCalculationConfiguration }): Promise<ApiResult<GameCalculationRulesResponse>> {
  if (body.configuration === null) fail('configuration');
  const candidate = parseGameCalculationRules({ gameId, ...body });
  const frozenBody = { baseDigest: candidate.baseDigest, configuration: candidate.configuration! };
  let written: ApiResult<GameCalculationRulesResponse>;
  try {
    const result = await requestMaintenanceJson<unknown>(api, path(gameId), { method: 'PUT', body: JSON.stringify(frozenBody) });
    written = { ...result, data: parseGameCalculationRules(result.data, gameId) };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) throw error;
    throw new UnconfirmedCalculationRulesWriteError('计算配置保存响应未确认，请保留草稿并重新读取确认。');
  }
  try {
    const read = await getGameCalculationRules(api, gameId);
    if (read.data.baseDigest !== written.data.baseDigest || !sameFormulaPayload(read.data.configuration, frozenBody.configuration)
      || !sameFormulaPayload(written.data.configuration, frozenBody.configuration)) throw new Error('读回不一致');
    return read;
  } catch { throw new UnconfirmedCalculationRulesWriteError('计算配置已发送，独立读回未确认，请保留草稿并重新读取确认。'); }
}
