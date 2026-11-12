import { TinyGoV2Bridge as RawBridge, type TinyGoV2BridgeOptions } from '../../src/engine/tinygoV2Bridge';
import { mechanismAuthorization } from '../mechanisms/testAuthorization';
export { TinyGoV2InvocationError, OUTBOX_GENERIC_DONE } from '../../src/engine/tinygoV2Bridge';

/** 数值与适配集成测试的宿主；显式非法授权字段仍原样交给正式引擎。 */
export class TinyGoV2Bridge {
  private constructor(private readonly bridge: RawBridge) {}
  static async create(options: TinyGoV2BridgeOptions): Promise<TinyGoV2Bridge> {
    return new TinyGoV2Bridge(await RawBridge.create(options));
  }
  private request(request: unknown): unknown {
    if (request === null || typeof request !== 'object' || Array.isArray(request) || Object.hasOwn(request, 'authorization')) return request;
    const authorization = mechanismAuthorization();
    return authorization ? { ...request, authorization } : request;
  }
  compile(request: unknown) { return this.bridge.compile(this.request(request)); }
  run(request: unknown) { return this.bridge.run(this.request(request)); }
  releaseSession(sessionId: string, expectedRulesHash?: string) { return this.bridge.releaseSession(sessionId, expectedRulesHash); }
}
