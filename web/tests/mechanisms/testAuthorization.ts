import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';

let cached: { grant: string; expiresAt: number } | undefined;

/** 固定机制宿主也使用真实票据；私钥只在本机进程内读取，不进入证据。 */
export function mechanismAuthorization(): string | undefined {
  if (!WASM_IDENTITY.authorizationRequired) return undefined;
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 5) return cached.grant;
  let key;
  try {
    key = createPrivateKey({ key: readFileSync(process.env.DAMAGE_TEST_GRANT_PRIVATE_KEY_PATH
      ?? new URL('../../../config/auth/grant-private.pk8', import.meta.url)), type: 'pkcs8', format: 'der' });
  } catch { throw new Error('固定机制回归需要与正式产物匹配的本机签名材料。'); }
  const actual = key.export({ format: 'jwk' }).x;
  if (key.asymmetricKeyType !== 'ed25519' || actual !== WASM_IDENTITY.authorizationPublicKey) {
    throw new Error('固定机制签名材料不匹配正式产物受信公钥。');
  }
  const header = Buffer.from(JSON.stringify({ alg: 'Ed25519', typ: 'dv-wasm-grant+jwt', kid: WASM_IDENTITY.authorizationKeyId })).toString('base64url');
  const expiresAt = now + 1800;
  const body = Buffer.from(JSON.stringify({ iss: 'damage-viewer', aud: 'damage-viewer-wasm', subjectType: 'MAINTENANCE',
    sub: '8b9efc5a-de08-45b7-8be5-04e557fef8e6', scope: ['engine:compute'], iat: now, nbf: now,
    exp: expiresAt, authorizationVersion: 2, jti: randomUUID() })).toString('base64url');
  const input = `${header}.${body}`;
  cached = { grant: `${input}.${sign(null, Buffer.from(input), key).toString('base64url')}`, expiresAt };
  return cached.grant;
}
