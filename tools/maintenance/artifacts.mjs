import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { relative, resolve, isAbsolute } from 'node:path';

export function requireValue(value, message) { if (!value) throw new Error(message); }
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const isUuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  requireValue(value === null || ['string', 'number', 'boolean'].includes(typeof value), '档案含不可序列化字段。');
  requireValue(typeof value !== 'number' || Number.isFinite(value), '档案含非有限数值。');
  return JSON.stringify(value);
}
export const digestJson = value => sha256(canonical(value));
export function exactKeys(value, required, optional = []) {
  requireValue(record(value), '需要对象。');
  requireValue(required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), '字段缺失或包含未知字段。');
}
export function readJson(path, limit = 32 * 1024 * 1024) {
  const bytes = readFileSync(path);
  requireValue(bytes.length <= limit, '输入档案过大。');
  return JSON.parse(bytes.toString('utf8'));
}
export function writeNew(path, value, mode = 0o600) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode });
}
export function containedFile(directory, filename) {
  const root = realpathSync(directory), actual = realpathSync(resolve(root, filename));
  const part = relative(root, actual);
  requireValue(part !== '' && !part.startsWith('..') && !isAbsolute(part), '档案引用超出其所属目录。');
  return actual;
}
export function options(args, allowed, required = allowed) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    requireValue(allowed.includes(key) && !Object.hasOwn(result, key) && value && !value.startsWith('--'), '参数未知、重复或缺少值。');
    result[key] = value;
  }
  requireValue(required.every(key => Object.hasOwn(result, key)), `需要参数：${required.join('、')}`);
  return result;
}
