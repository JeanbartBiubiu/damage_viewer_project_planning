import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(here);
const batchDir = path.resolve(outputDir, '..');
const dataRoot = path.resolve(batchDir, '..', '..');
const sourceRoot = path.join(dataRoot, '装备符文');

const files = {
  freeze: path.join(batchDir, '冻结来源.json'),
  groups: path.join(batchDir, '分组请求.json'),
  runeRequests: path.join(batchDir, '符文请求.json'),
  candidate: path.join(batchDir, '候选与来源.json'),
  imageCandidates: path.join(batchDir, '图片候选.json'),
  imageRecords: path.join(batchDir, '页面图片记录.json'),
  pageSeed: path.join(batchDir, '页面种子.json')
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function bytesOf(file) {
  return fs.readFileSync(file);
}

function fail(message) {
  throw new Error(`冻结资料校验失败：${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function posixRelative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function sourcePath(file) {
  const resolved = path.resolve(sourceRoot, file);
  assert(resolved.startsWith(`${sourceRoot}${path.sep}`), `来源路径越界：${file}`);
  return resolved;
}

fs.mkdirSync(outputDir, { recursive: true });

const freeze = readJson(files.freeze);
const groups = readJson(files.groups);
const runeRequests = readJson(files.runeRequests);
const frozenCandidate = readJson(files.candidate);
const imageCandidates = readJson(files.imageCandidates);
const imageRecords = readJson(files.imageRecords);
const pageSeed = readJson(files.pageSeed);

const expectedCandidateSha256 = '3998e7f3dd49dcbbb29fd257f022202139d077c11c8131f50f63362874f6895d';
const actualCandidateSha256 = sha256File(files.candidate);
assert(actualCandidateSha256 === expectedCandidateSha256, `候选与来源.json SHA256=${actualCandidateSha256}，期望 ${expectedCandidateSha256}`);
assert(Array.isArray(runeRequests) && runeRequests.length === 69, '符文请求数量不是69');
assert(Array.isArray(groups) && groups.length === 6, '分组请求数量不是6');
assert(Array.isArray(frozenCandidate.runes) && frozenCandidate.runes.length === 69, '候选中的符文数量不是69');
assert(Array.isArray(frozenCandidate.paths) && frozenCandidate.paths.length === 6, '候选中的路径数量不是6');
assert(Array.isArray(imageCandidates) && imageCandidates.length === 74, '图片候选数量不是74');
assert(Array.isArray(imageRecords.items) && imageRecords.items.length === 74, '页面图片记录数量不是74');

const frozenRunes = new Map(frozenCandidate.runes.map((row) => [row.body.runeKey, row]));
const frozenPaths = new Map(frozenCandidate.paths.map((row) => [row.body.pathKey, row]));
const recordByKey = new Map(imageRecords.items.map((row) => [row.key, row]));
assert(frozenRunes.size === 69, '候选符文键重复');
assert(frozenPaths.size === 6, '候选路径键重复');
assert(recordByKey.size === 74, '页面图片键重复');

const runes = runeRequests.map((body, index) => {
  const frozen = frozenRunes.get(body.runeKey);
  assert(frozen, `符文请求没有对应冻结来源：${body.runeKey}`);
  assert(sameJson(body, frozen.body), `符文请求与候选正文不一致：${body.runeKey}`);
  const keys = Object.keys(body).sort();
  assert(sameJson(keys, ['category', 'description', 'name', 'runeKey']), `符文字段不符合接口白名单：${body.runeKey}`);
  return { order: index, body, source: frozen.source };
});
assert(new Set(runes.map((row) => row.body.runeKey)).size === 69, '符文请求键重复');

const paths = groups.map((body, index) => {
  const frozen = frozenPaths.get(body.pathKey);
  assert(frozen, `分组请求没有对应冻结来源：${body.pathKey}`);
  assert(sameJson(body, frozen.body), `分组请求与候选正文不一致：${body.pathKey}`);
  const keys = Object.keys(body).sort();
  assert(sameJson(keys, ['description', 'kind', 'name', 'pathKey', 'slots', 'sortOrder']), `路径字段不符合接口白名单：${body.pathKey}`);
  assert(body.slots.every((slot) => {
    const slotKeys = Object.keys(slot).sort();
    return sameJson(slotKeys, ['category', 'name', 'runeKeys']) && Array.isArray(slot.runeKeys);
  }), `路径槽位字段不符合接口白名单：${body.pathKey}`);
  return { order: index, body, source: frozen.source };
});

const pathKeySet = new Set(paths.map((row) => row.body.pathKey));
const runeKeySet = new Set(runes.map((row) => row.body.runeKey));
for (const pathRow of paths) {
  for (const slot of pathRow.body.slots) {
    assert(slot.runeKeys.length === new Set(slot.runeKeys).size, `槽位中出现重复符文：${pathRow.body.pathKey}/${slot.name}`);
    for (const runeKey of slot.runeKeys) assert(runeKeySet.has(runeKey), `路径引用未知符文：${pathRow.body.pathKey}/${runeKey}`);
  }
}
assert(pathKeySet.has('rune_shards'), '缺少属性碎片组');

const verifiedSourceHashes = freeze.verifiedSources.map((entry) => {
  const file = sourcePath(entry.file);
  const actualSha256 = sha256File(file);
  const actualByteSize = fs.statSync(file).size;
  assert(actualSha256 === entry.sha256, `原始来源哈希不一致：${entry.file}`);
  assert(actualByteSize === entry.byteSize, `原始来源字节数不一致：${entry.file}`);
  return { ...entry, actualSha256, actualByteSize, resolvedFile: posixRelative(dataRoot, file) };
});

const derivedSourceHashes = freeze.derivedSources.map((entry) => {
  const file = sourcePath(entry.file);
  const actualSha256 = sha256File(file);
  assert(actualSha256 === entry.sha256, `派生来源哈希不一致：${entry.file}`);
  return { ...entry, actualSha256, actualByteSize: fs.statSync(file).size, resolvedFile: posixRelative(dataRoot, file) };
});

const imagePlans = imageCandidates.map((candidate, index) => {
  const record = recordByKey.get(candidate.key);
  assert(record, `图片候选缺少页面记录：${candidate.key}`);
  assert(candidate.preparedFile === record.preparedFile, `图片候选与页面记录路径不一致：${candidate.key}`);
  const preparedPath = path.resolve(batchDir, candidate.preparedFile);
  const rawPath = path.resolve(batchDir, candidate.rawFile);
  assert(preparedPath.startsWith(`${batchDir}${path.sep}`), `页面图片路径越界：${candidate.key}`);
  assert(rawPath.startsWith(`${batchDir}${path.sep}`), `原始图片路径越界：${candidate.key}`);
  assert(fs.existsSync(preparedPath), `页面图片不存在：${candidate.key}`);
  assert(fs.existsSync(rawPath), `原始图片不存在：${candidate.key}`);
  const preparedBuffer = bytesOf(preparedPath);
  const rawSha256 = sha256File(rawPath);
  const preparedSha256 = sha256Buffer(preparedBuffer);
  const size = pngSize(preparedBuffer);
  assert(preparedSha256 === record.sha256, `页面图片哈希不一致：${candidate.key}`);
  assert(preparedBuffer.length === record.byteSize, `页面图片字节数不一致：${candidate.key}`);
  assert(rawSha256 === record.rawSha256, `原始图片哈希不一致：${candidate.key}`);
  assert(size && size.width === record.width && size.height === record.height, `页面图片尺寸不一致：${candidate.key}`);
  assert(candidate.kind === 'rune' || candidate.kind === 'runePath', `图片目标类型不合法：${candidate.key}`);
  assert(candidate.key !== 'rune_shards', '属性碎片组不得配置图片');
  assert(candidate.proposedImageKey && candidate.proposedImageName, `图片目标缺少拟用键/名称：${candidate.key}`);
  return {
    order: index,
    kind: candidate.kind,
    targetKey: candidate.key,
    targetName: candidate.name,
    proposedImageKey: candidate.proposedImageKey,
    proposedImageName: candidate.proposedImageName,
    preparedFile: candidate.preparedFile,
    rawFile: candidate.rawFile,
    preparedSha256,
    rawSha256,
    byteSize: record.byteSize,
    width: record.width,
    height: record.height,
    mimeType: 'image/png',
    source: candidate.source,
    primaryUrl: candidate.primaryUrl,
    fallbackUrl: candidate.fallbackUrl
  };
});
assert(new Set(imagePlans.map((row) => `${row.kind}:${row.targetKey}`)).size === 74, '图片目标重复');
assert(imagePlans.filter((row) => row.kind === 'rune').length === 69, '符文图片数量不是69');
assert(imagePlans.filter((row) => row.kind === 'runePath').length === 5, '路径图片数量不是5');
assert(!imagePlans.some((row) => row.targetKey === 'rune_shards'), '属性碎片组出现在图片目标中');

const runeCategoryCounts = Object.fromEntries(['KEYSTONE', 'MINOR', 'SHARD'].map((category) => [category, runes.filter((row) => row.body.category === category).length]));
assert(sameJson(runeCategoryCounts, { KEYSTONE: 17, MINOR: 45, SHARD: 7 }), `符文分类数量不符：${JSON.stringify(runeCategoryCounts)}`);
const slotCount = paths.reduce((sum, row) => sum + row.body.slots.length, 0);
const positionCount = paths.reduce((sum, row) => sum + row.body.slots.reduce((slotSum, slot) => slotSum + slot.runeKeys.length, 0), 0);
assert(slotCount === 23 && positionCount === 71, `布局数量不符：${slotCount}槽/${positionCount}位置`);

const inputHashes = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, { file: posixRelative(dataRoot, file), sha256: sha256File(file), byteSize: fs.statSync(file).size }]));
const sourceReport = {
  schema: '符文基础资料第一批/接口录入/来源图片哈希',
  generatedAt: new Date().toISOString(),
  frozenCandidateSha256: expectedCandidateSha256,
  inputHashes,
  verifiedSources: verifiedSourceHashes,
  derivedSources: derivedSourceHashes,
  imageCount: imagePlans.length,
  images: imagePlans.map((row) => ({
    order: row.order,
    kind: row.kind,
    targetKey: row.targetKey,
    preparedFile: row.preparedFile,
    rawFile: row.rawFile,
    preparedSha256: row.preparedSha256,
    rawSha256: row.rawSha256,
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    mimeType: row.mimeType
  }))
};

const interfaceCandidate = {
  schema: '符文基础资料第一批/接口录入候选',
  version: 1,
  status: 'FROZEN_CANDIDATE',
  gameId: 'lol',
  frozenCandidateSha256: expectedCandidateSha256,
  inputHashes,
  counts: {
    runes: runes.length,
    keystones: runeCategoryCounts.KEYSTONE,
    minors: runeCategoryCounts.MINOR,
    uniqueShards: runeCategoryCounts.SHARD,
    paths: paths.length,
    slots: slotCount,
    positions: positionCount,
    requestedImages: imagePlans.length
  },
  runes,
  paths,
  images: imagePlans,
  acceptedImageReuse: [
    { kind: 'rune', targetKey: 'rune_8005', imageKey: 'image_bba88a8f-14ef-492a-a6ef-44c6e8be886f', rule: '当前代表图已由页面验收确认，执行前仍须独立核对字节、启用状态和元数据' },
    { kind: 'runePath', targetKey: 'rune_path_8000', imageKey: 'image_6a4b2d5e-4ed9-4a41-bfa1-a90a9c86c034', rule: '当前代表图已由页面验收确认，执行前仍须独立核对字节、启用状态和元数据' }
  ],
  rules: [
    '只允许写入本文件列出的69个符文键、6个路径键和74个图片目标。',
    '普通符文只允许跨布局出现一次；属性碎片可在多个属性行共享，同一行不得重复。',
    '属性碎片组不配置图片。',
    '现有对象同值复用，异值停止当前对象；缺项才允许补写。',
    '接口写入前由安全入口重新读取冻结输入并逐字段校验。'
  ]
};

fs.writeFileSync(path.join(outputDir, '来源图片哈希.json'), `${JSON.stringify(sourceReport, null, 2)}\n`, 'utf8');
fs.writeFileSync(path.join(outputDir, '接口候选.json'), `${JSON.stringify(interfaceCandidate, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  outputDir,
  candidateSha256: expectedCandidateSha256,
  counts: interfaceCandidate.counts,
  sourceFiles: verifiedSourceHashes.length,
  derivedFiles: derivedSourceHashes.length,
  imageFiles: imagePlans.length
}, null, 2));
