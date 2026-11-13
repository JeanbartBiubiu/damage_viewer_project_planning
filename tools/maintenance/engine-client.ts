import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TinyGoV2Bridge } from '../../web/src/engine/tinygoV2Bridge';
import { parseCompileResult, parseDoneResult, parseReleaseResult } from '../../web/src/engine/genericEngineClient';
import { registerFormulaForApprovedReads } from '../../web/src/engine/approvedFormulaValues';
import { assertResourceRecordBudget } from '../../web/src/engine/resourceChangeContract';
import { WASM_IDENTITY } from '../../web/src/engine/wasmIdentity';
import type { CompileRequest, RunRequest } from '../../web/src/types/genericEngine';

function maintenanceGrant(file: string, expectedPrincipal?: string): { grant: string; principalId: string } {
  let input: unknown;
  let claims: unknown;
  try {
    input = JSON.parse(readFileSync(file, 'utf8'));
    if (!input || typeof input !== 'object' || !('grant' in input) || typeof input.grant !== 'string') throw new Error();
    const parts = input.grant.split('.');
    if (parts.length !== 3) throw new Error();
    claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
  } catch { throw new Error('维护计算票据文件缺失或格式错误。'); }
  if (!claims || typeof claims !== 'object' || !('sub' in claims) || typeof claims.sub !== 'string'
    || !('subjectType' in claims) || claims.subjectType !== 'MAINTENANCE'
    || !('authorizationVersion' in claims) || claims.authorizationVersion !== 2
    || !('exp' in claims) || typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)
    || expectedPrincipal !== undefined && claims.sub !== expectedPrincipal) {
    throw new Error('维护计算票据已过期、类别错误或主体不符。');
  }
  // 此处只约束调用身份；正式 Wasm 仍独立验证全部字段、签名和期限。
  return { grant: (input as { grant: string }).grant, principalId: claims.sub };
}

/** 真实维护计算只消费后端签发的短期票据，不读取签名私钥或使用固定测试主体。 */
export async function createMaintenanceEngine(grantFile: string, expectedPrincipal?: string) {
  if (!grantFile) throw new Error('真实维护计算需要 --grant-file 指定后端签发的票据文件。');
  const { principalId } = maintenanceGrant(grantFile, expectedPrincipal);
  const bytes = readFileSync(new URL('../../web/src/engine/wasm/tinygo_engine_v2.wasm', import.meta.url));
  const wasmSha256 = createHash('sha256').update(bytes).digest('hex');
  if (!WASM_IDENTITY.authorizationRequired || WASM_IDENTITY.authorizationVersion !== 2
    || bytes.length !== WASM_IDENTITY.bytes || wasmSha256 !== WASM_IDENTITY.sha256) {
    throw new Error('维护计算需要身份一致且启用第2版验签的正式分发产物。');
  }
  const bridge = await TinyGoV2Bridge.create({ wasmUrl: `data:application/wasm;base64,${bytes.toString('base64')}` });
  const client = {
    hasLiveWorker: true,
    async compile(request: CompileRequest) {
      const authorization = maintenanceGrant(grantFile, principalId).grant;
      const result = parseCompileResult(bridge.compile({ ...request, authorization }));
      if (result.ok) for (const formula of request.formulas ?? []) registerFormulaForApprovedReads(formula);
      return result;
    },
    async run(request: RunRequest) {
      assertResourceRecordBudget(request);
      const authorization = maintenanceGrant(grantFile, principalId).grant;
      return parseDoneResult(bridge.run({ ...request, authorization }));
    },
    async release(sessionId: string, expectedRulesHash?: string) {
      const result = parseReleaseResult(bridge.releaseSession(sessionId, expectedRulesHash));
      if (result.sessionId !== sessionId) throw new Error('释放响应与维护计算会话不符。');
      return result;
    }
  };
  return { client, principalId, wasmSha256, wasmBytes: bytes.length };
}
