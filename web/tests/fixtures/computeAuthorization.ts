import { createPrivateKey, createPublicKey, randomUUID, sign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Route } from '@playwright/test';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';

// 签发材料仅在测试进程内读取，不写源文件、终端或运行档案；只签发计算用途。
let signer: KeyObject | undefined;
export const FIXTURE_MAINTENANCE_PRINCIPAL = 'e3e2a480-9bf4-49bb-a036-fef46b341da4';
function signingKey(): KeyObject {
  if (signer) return signer;
  const configured = process.env.DAMAGE_TEST_GRANT_PRIVATE_KEY_PATH?.trim();
  const path = configured || fileURLToPath(new URL('../../../config/auth/grant-private.pk8', import.meta.url));
  const key = createPrivateKey({ key: readFileSync(path), format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(key).export({ format: 'jwk' });
  if (publicKey.x !== String(WASM_IDENTITY.authorizationPublicKey)) throw new Error('浏览器计算测试签发方与正式引擎信任的公钥不符。');
  signer = key;
  return key;
}

export async function fulfillComputeAuthorization(route: Route): Promise<boolean> {
  const path = new URL(route.request().url()).pathname;
  const subjectType = path === '/api/auth/wasm-grant' ? 'PLAYER' : path === '/internal/maintenance/wasm-grant' ? 'MAINTENANCE' : null;
  if (!subjectType || route.request().method() !== 'POST') return false;
  const iat = Math.floor(Date.now() / 1000) - 1;
  const exp = iat + (subjectType === 'PLAYER' ? 86400 : 300);
  const header = Buffer.from(JSON.stringify({ alg: 'Ed25519', typ: 'dv-wasm-grant+jwt', kid: WASM_IDENTITY.authorizationKeyId })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: 'damage-viewer', aud: 'damage-viewer-wasm', sub: subjectType === 'PLAYER'
    ? '9a9d2314-00cc-43bb-898d-ebbec56cf14d' : FIXTURE_MAINTENANCE_PRINCIPAL, subjectType,
    ...(subjectType === 'PLAYER' ? { canLogin: 1 } : {}), scope: ['engine:compute'], iat, nbf: iat, exp, authorizationVersion: 2, jti: randomUUID() })).toString('base64url');
  const input = `${header}.${body}`;
  const signature = sign(null, Buffer.from(input), signingKey()).toString('base64url');
  await route.fulfill({ json: { grant: `${input}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() }, headers: { 'Cache-Control': 'no-store' } });
  return true;
}
