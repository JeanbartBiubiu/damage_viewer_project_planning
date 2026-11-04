import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const AUTHORIZATION_FIELDS = ['authorizationRequired', 'authorizationVersion', 'authorizationKeyId', 'authorizationPublicKey'];

export function validateWasmAuthorizationIdentity(identity) {
  if (typeof identity?.authorizationRequired !== 'boolean' || identity.authorizationVersion !== 1) {
    throw new Error('Wasm身份缺少有效的计算授权构建元信息');
  }
  if (!identity.authorizationRequired) {
    if (identity.authorizationKeyId !== null || identity.authorizationPublicKey !== null) {
      throw new Error('关闭授权的构建不能声明生效密钥');
    }
  } else if (typeof identity.authorizationKeyId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(identity.authorizationKeyId)
    || typeof identity.authorizationPublicKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(identity.authorizationPublicKey)
    || Buffer.from(identity.authorizationPublicKey, 'base64url').length !== 32
    || Buffer.from(identity.authorizationPublicKey, 'base64url').toString('base64url') !== identity.authorizationPublicKey) {
    throw new Error('启用授权的构建必须声明固定密钥编号与32字节公钥');
  }
  return identity;
}

export function readDeclaredWasmIdentity(source) {
  const match = /bytes:\s*(\d+),\s*sha256:\s*'([0-9a-f]{64})'/.exec(source);
  if (!match) throw new Error('Wasm身份缺少字节数或摘要');
  const required = /\bauthorizationRequired:\s*(true|false)\b/.exec(source);
  const version = /\bauthorizationVersion:\s*(\d+)\b/.exec(source);
  const stringOrNull = name => {
    const field = new RegExp(`\\b${name}:\\s*(null|'[^']*'|"[^"]*")`).exec(source);
    if (!field) throw new Error(`Wasm身份缺少${name}`);
    return field[1] === 'null' ? null : field[1].slice(1, -1);
  };
  return validateWasmAuthorizationIdentity({ bytes: Number(match[1]), sha256: match[2],
    authorizationRequired: required ? required[1] === 'true' : undefined,
    authorizationVersion: version ? Number(version[1]) : undefined,
    authorizationKeyId: stringOrNull('authorizationKeyId'), authorizationPublicKey: stringOrNull('authorizationPublicKey') });
}

export function wasmAuthorizationBuildEnvironment(identity) {
  validateWasmAuthorizationIdentity(identity);
  return { WASM_AUTH_REQUIRED: String(identity.authorizationRequired),
    WASM_AUTH_KEY_ID: identity.authorizationKeyId ?? '', WASM_AUTH_PUBLIC_KEY: identity.authorizationPublicKey ?? '' };
}

export function assertWasmBuildMetadataMatches(rebuilt, declared) {
  validateWasmAuthorizationIdentity(rebuilt);
  validateWasmAuthorizationIdentity(declared);
  if (rebuilt.bytes !== declared.bytes || rebuilt.sha256 !== declared.sha256
    || AUTHORIZATION_FIELDS.some(field => rebuilt[field] !== declared[field])) {
    throw new Error('重建Wasm的授权构建元信息与分发声明不一致');
  }
}

export function assertWasmBuildMatches(rebuiltPath, distributedPath, declared) {
  const rebuilt = readFileSync(rebuiltPath);
  const distributed = readFileSync(distributedPath);
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  if (!declared || declared.bytes !== distributed.length || declared.sha256 !== sha256(distributed)) {
    throw new Error('分发Wasm与wasmIdentity声明不一致，拒绝确认构建');
  }
  if (!rebuilt.equals(distributed)) {
    throw new Error(`当前源码重建Wasm与分发产物不同，拒绝使用旧引擎生成证明；重建 ${sha256(rebuilt)}，分发 ${sha256(distributed)}`);
  }
  return { bytes: rebuilt.length, sha256: sha256(rebuilt) };
}
