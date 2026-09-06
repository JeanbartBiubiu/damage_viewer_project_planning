#!/usr/bin/env node
/*
 * 图片上传脚本草案。默认只做本地转换与 GET 盘点；只有显式 --execute 才会 POST/PUT。
 * 运行时：使用 Codex 捆绑 Node.js 与 sharp，不安装依赖。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

function loadSharp() {
  try { return require('sharp'); } catch (error) {
    const bundledModules = process.env.CODEX_NODE_MODULES ||
      'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
    const runtimeRequire = createRequire(path.join(bundledModules, '_entry.cjs'));
    try { return runtimeRequire('sharp'); } catch { throw error; }
  }
}
const sharp = loadSharp();

const ROOT = __dirname;
const PROJECT = 'C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09';
const MANIFEST = path.join(PROJECT, '英雄技能全量页面输入/图片待上传清单.json');
const OUT = path.join(ROOT, 'prepared');
const LOG = path.join(ROOT, 'upload-log.jsonl');
const API = 'http://127.0.0.1:8080/api/admin/games/lol';
const AUTH = 'Bearer local-entry';
const MAX = 262144;
const TARGET_SIZE = 64;
const allowedMime = new Set(['image/png', 'image/jpeg']);

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function encode(key) { return encodeURIComponent(key); }
function stableImageKey(target) {
  const key = `entry_16171_${target}`;
  if (key.length > 64) throw new Error(`图片标识超过64字符: ${key}`);
  return key;
}
function log(entry) {
  fs.appendFileSync(LOG, `${JSON.stringify({time: new Date().toISOString(), ...entry})}\n`, 'utf8');
}
function itemPath(item) { return path.resolve(PROJECT, '英雄技能全量页面输入', item.file); }
function relationPath(item) {
  return item.purpose === '角色代表图片'
    ? `/characters/${encode(item.targetKey)}/representative-image`
    : `/skills/${encode(item.targetKey)}/representative-image`;
}

async function prepare(item) {
  const source = itemPath(item);
  if (!fs.existsSync(source)) throw new Error(`源图片不存在: ${source}`);
  const sourceMeta = await sharp(source).metadata();
  if (!allowedMime.has(sourceMeta.format === 'jpeg' ? 'image/jpeg' : `image/${sourceMeta.format}`)) {
    throw new Error(`仅支持 PNG/JPEG: ${source}`);
  }
  const sourceBuffer = fs.readFileSync(source);
  const sourceSha256 = sha256(sourceBuffer);
  if (item.sha256 && item.sha256 !== sourceSha256) {
    throw new Error(`源图片 sha256 与输入清单不一致: ${source}`);
  }
  const sourceWidth = sourceMeta.width;
  const sourceHeight = sourceMeta.height;
  if (!sourceWidth || !sourceHeight || sourceWidth > 4096 || sourceHeight > 4096) {
    throw new Error(`源图片尺寸不符合页面规则: ${source}`);
  }
  const direct = sourceWidth <= TARGET_SIZE && sourceHeight <= TARGET_SIZE && sourceWidth === sourceHeight;
  const format = sourceMeta.format === 'jpeg' ? 'jpeg' : 'png';
  let output = sourceBuffer;
  let transformed = false;
  if (!direct) {
    const image = sharp(source).resize({ width: TARGET_SIZE, height: TARGET_SIZE, fit: 'cover', position: 'centre' });
    output = format === 'jpeg' ? await image.jpeg({ quality: 92 }).toBuffer() : await image.png().toBuffer();
    transformed = true;
  }
  if (!output.length || output.length > MAX) throw new Error(`输出图片超过262144字节: ${source}`);
  const ext = format === 'jpeg' ? '.jpg' : '.png';
  const outputFile = path.join(OUT, `${item.targetKey}${ext}`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(outputFile, output);
  const meta = await sharp(output).metadata();
  return {
    ...item,
    imageKey: stableImageKey(item.targetKey),
    sourceFile: source,
    preparedFile: outputFile,
    mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    sourceWidth, sourceHeight, sourceSha256,
    width: meta.width, height: meta.height,
    bytes: output.length, sha256: sha256(output), transformed,
  };
}

async function request(url, options = {}) {
  const { allow404 = false, timeoutMs = 15000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${API}${url}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: { Authorization: AUTH, ...(fetchOptions.headers || {}) },
    });
  } catch (error) {
    throw new Error(`${fetchOptions.method || 'GET'} ${url} network error: ${error.name === 'AbortError' ? `timeout ${timeoutMs}ms` : error.message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (response.status === 404 && allow404) return null;
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${url} -> ${response.status}: ${text.slice(0, 300)}`);
  return body;
}

function imageObject(record) { return record && record.image && typeof record.image === 'object' ? record.image : record; }
function summarizeImage(record) {
  const image = imageObject(record);
  if (!image || typeof image !== 'object') return image ?? null;
  const summary = {};
  for (const key of ['imageKey', 'name', 'description', 'enabled', 'mimeType', 'contentType', 'width', 'height', 'bytes', 'size', 'sha256', 'hash']) {
    if (Object.hasOwn(image, key)) summary[key] = image[key];
  }
  for (const key of ['imageBase64', 'dataUrl', 'data']) {
    if (typeof image[key] === 'string') {
      const match = image[key].match(/^data:([^;]+);base64,(.*)$/s);
      if (match) {
        const buffer = Buffer.from(match[2], 'base64');
        summary[`${key}Bytes`] = buffer.length;
        summary[`${key}Sha256`] = sha256(buffer);
      } else summary[`${key}Present`] = true;
    }
  }
  return summary;
}
function summarizeRelation(record) {
  if (!record || typeof record !== 'object') return record ?? null;
  return { image: summarizeImage(record.image) };
}
function validateImageRecord(record, item) {
  if (!record) throw new Error(`图片 ${item.imageKey} 回读为空`);
  const image = imageObject(record);
  if (!image || image.imageKey !== item.imageKey) throw new Error(`图片标识不匹配: expected=${item.imageKey}, actual=${image && image.imageKey}`);
  for (const key of ['imageBase64', 'byteSize', 'width', 'height', 'enabled']) {
    if (!Object.hasOwn(image, key)) throw new Error(`托管图片缺少必填字段 ${key}: ${item.imageKey}`);
  }
  if (typeof image.enabled !== 'boolean') throw new Error(`托管图片 enabled 类型错误: ${item.imageKey}`);
  if (image.name && image.name !== item.targetKey) throw new Error(`图片归属名称不匹配: expected=${item.targetKey}, actual=${image.name}`);
  if (typeof image.imageBase64 !== 'string') throw new Error(`托管图片 imageBase64 类型错误: ${item.imageKey}`);
  const match = image.imageBase64.match(/^data:([^;]+);base64,(.*)$/s);
  if (!match) throw new Error(`托管图片 imageBase64 不是完整 dataURL: ${item.imageKey}`);
  const buffer = Buffer.from(match[2], 'base64');
  const actual = sha256(buffer);
  if (actual !== item.sha256) throw new Error(`图片内容 sha256 不匹配: expected=${item.sha256}, actual=${actual}`);
  if (image.byteSize !== buffer.length) throw new Error(`图片 byteSize 不匹配: expected=${buffer.length}, actual=${image.byteSize}`);
  if (image.width !== item.width || image.height !== item.height) throw new Error(`图片尺寸不匹配: expected=${item.width}x${item.height}, actual=${image.width}x${image.height}`);
}
function validateExistingRelation(relation, item) {
  if (!relation || !relation.image) return false;
  if (!Object.hasOwn(relation.image, 'enabled')) throw new Error(`已有代表图缺少 enabled: ${item.targetKey}`);
  if (!relation.image.imageKey) throw new Error(`已有代表图缺少 imageKey: ${item.targetKey}`);
  return true;
}

async function getSample(items) {
  const sample = items.filter((item) => item.targetKey === 'champion_aatrox' || item.targetKey === 'aatrox_q');
  const results = [];
  for (const item of sample) {
    try {
      const relation = await request(relationPath(item));
      results.push({ targetKey: item.targetKey, relation });
      log({ action: 'GET-representative-image', targetKey: item.targetKey, result: summarizeRelation(relation) });
    } catch (error) {
      results.push({ targetKey: item.targetKey, error: error.message });
      log({ action: 'GET-representative-image-error', targetKey: item.targetKey, error: error.message });
    }
  }
  const imageKey = stableImageKey('champion_aatrox');
  try {
    const image = await request(`/images/${encode(imageKey)}`);
    results.push({ imageKey, image });
    log({ action: 'GET-image', imageKey, result: summarizeImage(image) });
  } catch (error) {
    results.push({ imageKey, error: error.message });
    log({ action: 'GET-image-error', imageKey, error: error.message });
  }
  return results;
}

async function uploadOne(item) {
  const existingRelation = await request(relationPath(item));
  log({ action: 'GET-representative-image-before-write', targetKey: item.targetKey, result: summarizeRelation(existingRelation) });
  if (validateExistingRelation(existingRelation, item)) {
    log({ action: 'skip-existing-relation', targetKey: item.targetKey, imageKey: existingRelation.image.imageKey, enabled: existingRelation.image.enabled });
    return { status: 'skipped-existing-relation', targetKey: item.targetKey, imageKey: existingRelation.image.imageKey, enabled: existingRelation.image.enabled };
  }
  const existing = await request(`/images/${encode(item.imageKey)}`, { allow404: true });
  if (existing) validateImageRecord(existing, item);
  log({ action: 'GET-image-before-write', imageKey: item.imageKey, result: summarizeImage(existing) });
  if (!existing) {
    const data = fs.readFileSync(item.preparedFile).toString('base64');
    const imageBase64 = `data:${item.mimeType};base64,${data}`;
    await request('/images', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
      imageKey: item.imageKey, name: item.targetKey, description: `16.17.1 ${item.purpose}`, imageBase64,
    }) });
    log({ action: 'POST-image', imageKey: item.imageKey, bytes: item.bytes, sha256: item.sha256 });
    const created = await request(`/images/${encode(item.imageKey)}`);
    validateImageRecord(created, item);
    log({ action: 'GET-image-after-post', imageKey: item.imageKey, result: summarizeImage(created) });
  }
  await request(relationPath(item), { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ imageKey: item.imageKey }) });
  log({ action: 'PUT-representative-image', targetKey: item.targetKey, imageKey: item.imageKey });
  const verified = await request(relationPath(item));
  if (!verified || !verified.image || verified.image.imageKey !== item.imageKey) {
    throw new Error(`代表图关系回读不匹配: expected=${item.imageKey}, actual=${verified && verified.image && verified.image.imageKey}`);
  }
  log({ action: 'GET-representative-image-after-write', targetKey: item.targetKey, result: summarizeRelation(verified) });
  return { status: 'written', targetKey: item.targetKey, imageKey: item.imageKey };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : null;
  if (limitArg && (!Number.isInteger(limit) || limit < 1)) throw new Error('--limit 必须是正整数');
  const manifest = readJson(MANIFEST);
  const prepared = [];
  for (const item of manifest.items) prepared.push(await prepare(item));
  fs.writeFileSync(path.join(ROOT, 'prepared-manifest.json'), JSON.stringify({source: MANIFEST, count: prepared.length, items: prepared}, null, 2), 'utf8');
  if (args.has('--sample')) console.log(JSON.stringify(await getSample(prepared), null, 2));
  if (!args.has('--execute')) {
    console.log(JSON.stringify({mode: 'dry-run', count: prepared.length, preparedDirectory: OUT}, null, 2));
    return;
  }
  const selected = limit === null ? prepared : prepared.slice(0, limit);
  const summary = { attempted: 0, written: 0, skippedExistingRelation: 0, failed: 0 };
  for (const item of selected) {
    summary.attempted += 1;
    try {
      const result = await uploadOne(item);
      if (result.status === 'written') summary.written += 1;
      if (result.status === 'skipped-existing-relation') summary.skippedExistingRelation += 1;
      log({ action: 'item-result', ...result });
    } catch (error) {
      summary.failed += 1;
      log({ action: 'item-result', status: 'failed', targetKey: item.targetKey, imageKey: item.imageKey, error: error.message });
      console.error(`失败 ${item.targetKey}: ${error.message}`);
    }
  }
  fs.writeFileSync(path.join(ROOT, 'execute-summary.json'), JSON.stringify({ ...summary, limit }, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
