import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
if (process.argv.length !== 2) throw new Error('独立回读仅允许GET，不接受写入参数');
const here = path.dirname(fileURLToPath(import.meta.url));
const batch = path.resolve(here, '..');
const sources = path.resolve(batch, '../../装备符文');
const root = path.resolve(batch, '../../../..');
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hashBytes = value => createHash('sha256').update(value).digest('hex');
const hash = file => hashBytes(fs.readFileSync(file));
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
const evidenceFile = `独立最终回读-${stamp}.json`, summaryFile = `独立核对汇总-${stamp}.json`;
const frozen = read(path.join(batch, '候选与来源.json'));
const freeze = read(path.join(batch, '冻结来源.json'));
const imagePlans = read(path.join(batch, '图片候选.json'));
const prepared = new Map(read(path.join(batch, '页面图片记录.json')).items.map(x => [x.key, x]));
const accepted = new Map([['rune_8005', 'image_bba88a8f-14ef-492a-a6ef-44c6e8be886f'], ['rune_path_8000', 'image_6a4b2d5e-4ed9-4a41-bfa1-a90a9c86c034']]);
assert.equal(hash(path.join(batch, '候选与来源.json')), '3998e7f3dd49dcbbb29fd257f022202139d077c11c8131f50f63362874f6895d');
assert.deepEqual(read(path.join(batch, '符文请求.json')), frozen.runes.map(x => x.body));
assert.deepEqual(read(path.join(batch, '分组请求.json')), frozen.paths.map(x => x.body));
const sourceChecks = [...freeze.verifiedSources, ...freeze.derivedSources].map(item => { const actual = hash(path.join(sources, item.file)); assert.equal(actual, item.sha256); return { file: item.file, sha256: actual, matched: true }; });
for (const plan of imagePlans) { const record = prepared.get(plan.key); assert.equal(hash(path.join(batch, record.preparedFile)), record.sha256); assert.equal(hash(path.join(batch, record.rawFile)), record.rawSha256); }
const report = { mode: 'GET_ONLY', startedAt: new Date().toISOString(), frozenCandidateSha256: freeze.candidateSha256, sourceChecks, records: [], checks: [], differences: [], summary: null };
const checkpoint = () => fs.writeFileSync(path.join(here, evidenceFile), JSON.stringify(report, null, 2) + '\n');
const byRoute = new Map();
async function get(route) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let record;
    try {
      const response = await fetch(base + route, { method: 'GET', headers: { Authorization: 'Bearer local-entry' }, signal: AbortSignal.timeout(20000) });
      const raw = await response.text(); let data; try { data = JSON.parse(raw); } catch { data = { unreadableBody: true }; }
      record = { route, attempt, readAt: new Date().toISOString(), status: response.status, data };
    } catch (error) { record = { route, attempt, readAt: new Date().toISOString(), status: null, error: error.message }; }
    report.records.push(record);
    if (record.status !== null && record.status < 500 || attempt === 3) { byRoute.set(route, record); return record; }
    // 只重读现值；任何失败都不会转为业务写入。
  }
}
async function parallel(routes) {
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (cursor < routes.length) await get(routes[cursor++]); }));
  checkpoint();
}
function check(label, expected, actual, target) {
  const matched = isDeepStrictEqual(expected, actual);
  const entry = { target, label, expected, actual, matched };
  report.checks.push(entry); if (!matched) report.differences.push(entry);
  return matched;
}
function data(route) { const row = byRoute.get(route); check('HTTP状态', 200, row?.status ?? null, route); return row?.status === 200 ? row.data : null; }
const relationRoute = plan => `${plan.kind === 'rune' ? '/runes' : '/rune-paths'}/${plan.key}/representative-image`;
await parallel(['/runes', '/rune-paths', ...frozen.runes.map(x => `/runes/${x.body.runeKey}`), ...frozen.paths.map(x => `/rune-paths/${x.body.pathKey}`), ...imagePlans.map(relationRoute), '/rune-paths/rune_shards/representative-image', '/rune-skill-relations?runeKey=rune_5007']);
const actualRunes = data('/runes'), actualPaths = data('/rune-paths');
for (const [label, actual, expected, key] of [['符文', actualRunes, frozen.runes, 'runeKey'], ['分组', actualPaths, frozen.paths, 'pathKey']]) {
  check(`${label}列表总数`, expected.length, actual?.total, label);
  check(`${label}列表长度`, expected.length, actual?.items?.length, label);
  check(`${label}稳定键集合`, expected.map(x => x.body[key]).sort(), actual?.items?.map(x => x[key]).sort(), label);
  for (const item of expected) {
    const objectKey = item.body[key], detail = data(`${key === 'runeKey' ? '/runes' : '/rune-paths'}/${objectKey}`);
    check('详情所属游戏', 'lol', detail?.gameId, objectKey);
    for (const [field, value] of Object.entries(item.body)) check(`详情字段 ${field}`, value, detail?.[field], objectKey);
    const listed = actual?.items?.find(x => x[key] === objectKey);
    // 分组列表只返回槽位数量等概要；完整布局以独立详情为准。
    for (const [field, value] of Object.entries(item.body).filter(([field]) => field !== 'slots')) check(`列表字段 ${field}`, value, listed?.[field], objectKey);
    check('无额外启停字段', false, detail ? ('enabled' in detail || 'status' in detail) : undefined, objectKey);
  }
}
const fullPaths = frozen.paths.map(x => byRoute.get(`/rune-paths/${x.body.pathKey}`)?.data);
const slots = fullPaths.flatMap(x => Array.isArray(x?.slots) ? x.slots : []);
check('完整布局槽数', 23, slots.length, '布局');
check('完整布局位置数', 71, slots.flatMap(x => x.runeKeys ?? []).length, '布局');
check('独立碎片身份数', 7, actualRunes?.items?.filter(x => x.category === 'SHARD').length, '符文');
check('基石身份数', 17, actualRunes?.items?.filter(x => x.category === 'KEYSTONE').length, '符文');
check('小符文身份数', 45, actualRunes?.items?.filter(x => x.category === 'MINOR').length, '符文');
const shardImage = data('/rune-paths/rune_shards/representative-image');
check('碎片组无虚构代表图', null, shardImage?.image, 'rune_shards');
const imageTargets = [];
for (const plan of imagePlans) {
  const relation = data(relationRoute(plan));
  const key = relation?.image?.imageKey;
  check('代表图已存在', true, typeof key === 'string' && key.length > 0, plan.key);
  if (key) imageTargets.push({ plan, relation: relation.image, imageKey: key });
}
const imageKeys = [...new Set(imageTargets.map(x => x.imageKey))];
check('代表图关系总数', 74, imageTargets.length, '图片');
check('实际独立图片总数', 74, imageKeys.length, '图片');
await parallel(imageKeys.flatMap(key => [`/images/${encodeURIComponent(key)}`, `/images/${encodeURIComponent(key)}/usages`]));
const imageResults = [];
const usageKinds = ['games','characters','attributes','equipment','runes','runePaths','skills','skillEffects','statuses'];
for (const { plan, imageKey, relation } of imageTargets) {
  const image = data(`/images/${encodeURIComponent(imageKey)}`), usages = data(`/images/${encodeURIComponent(imageKey)}/usages`), expected = prepared.get(plan.key);
  if (!image) continue;
  check('图片所属游戏', 'lol', image.gameId, plan.key);
  check('实际代表图键', accepted.get(plan.key) ?? plan.proposedImageKey, imageKey, plan.key);
  check('图片详情键', imageKey, image.imageKey, plan.key);
  check('图片启用', true, image.enabled, plan.key);
  check('关系启用', true, relation.enabled, plan.key);
  check('代表图名称与详情一致', image.name, relation.name, plan.key);
  if (!accepted.has(plan.key)) { check('新建图片名称', plan.proposedImageName, image.name, plan.key); check('新建图片说明', null, image.description, plan.key); }
  check('图片类型', 'image/png', image.mimeType, plan.key);
  let bytes;
  try { bytes = Buffer.from(image.imageBase64.replace(/^data:image\/png;base64,/, ''), 'base64'); } catch { bytes = Buffer.alloc(0); }
  const digest = hashBytes(bytes);
  check('图片内容SHA256', expected.sha256, digest, plan.key);
  check('实际字节数', expected.byteSize, bytes.length, plan.key);
  check('接口字节数', bytes.length, image.byteSize, plan.key);
  check('PNG文件头', '89504e470d0a1a0a', bytes.subarray(0,8).toString('hex'), plan.key);
  const width = bytes.length >= 24 ? bytes.readUInt32BE(16) : null, height = bytes.length >= 24 ? bytes.readUInt32BE(20) : null;
  check('PNG宽度', expected.width, width, plan.key); check('PNG高度', expected.height, height, plan.key);
  check('接口宽度', width, image.width, plan.key); check('接口高度', height, image.height, plan.key);
  check('不超过64像素', true, width > 0 && height > 0 && width <= 64 && height <= 64, plan.key);
  check('用途所属图片', imageKey, usages?.imageKey, plan.key);
  const ownerKind = plan.kind === 'rune' ? 'runes' : 'runePaths';
  const expectedUsage = plan.kind === 'rune' ? { runeKey: plan.key, runeName: plan.name } : { pathKey: plan.key, pathName: plan.name };
  for (const kind of usageKinds) check(`实际用途 ${kind}`, kind === ownerKind ? [expectedUsage] : [], usages?.[kind], plan.key);
  imageResults.push({ targetKind: plan.kind, targetKey: plan.key, targetName: plan.name, imageKey, name: image.name, description: image.description, enabled: image.enabled, mimeType: image.mimeType, width, height, byteSize: bytes.length, sha256: digest, expectedSha256: expected.sha256, primarySourceUrl: plan.primaryUrl, rawSha256: expected.rawSha256, usages });
}
const percentPath = path.join(root, '%E6%95%B0%E6%8D%AE%E5%8F%82%E8%80%83/%E5%85%A8%E9%87%8F%E5%BD%95%E5%85%A5-2026-09/API%E5%AE%9E%E5%BD%95/%E7%AC%A6%E6%96%87%E5%9F%BA%E7%A1%80%E8%B5%84%E6%96%99%E7%AC%AC%E4%B8%80%E6%89%B9/%E6%8E%A5%E5%8F%A3%E5%BD%95%E5%85%A5');
report.pathCheck = { checkedAt: new Date().toISOString(), literalPath: percentPath, exists: fs.existsSync(percentPath), encodedTopExists: fs.existsSync(path.join(root, '%E6%95%B0%E6%8D%AE%E5%8F%82%E8%80%83')), boundary: '只证明当前定点不存在；未取得历史清理动作记录，本次未删除任何文件。' };
check('错误编码目录当前不存在', false, report.pathCheck.exists, '文件路径');
report.skillRelationObservation = byRoute.get('/rune-skill-relations?runeKey=rune_5007');
report.skillRelationBoundary = '仅记录主负责人当前挂载，未写入且不据此改变身份/图片验收，不固定断言技能目录总数。';
report.images = imageResults;
report.summary = { completedAt: new Date().toISOString(), mode: 'GET_ONLY', logicalReads: byRoute.size, httpAttempts: report.records.length, retriedReads: report.records.filter(x => x.attempt > 1).length, checks: report.checks.length, differenceCount: report.differences.length, expectedRunes: 69, actualRunes: actualRunes?.total, expectedPaths: 6, actualPaths: actualPaths?.total, slots: slots.length, positions: slots.flatMap(x => x.runeKeys ?? []).length, images: imageResults.length, imageRelations: imageTargets.length, matchingImageHashes: imageResults.filter(x => x.sha256 === x.expectedSha256).length, businessWrites: 0, evidenceFile };
checkpoint();
fs.writeFileSync(path.join(here, summaryFile), JSON.stringify({ ...report.summary, differences: report.differences, pathCheck: report.pathCheck, frozenCandidateSha256: report.frozenCandidateSha256, imageResults, skillRelationObservation: report.skillRelationObservation, boundary: '独立API与图片内容回读，不代表浏览器缓存同步或战斗计算通过。' }, null, 2) + '\n');
console.log(JSON.stringify({ ...report.summary, summaryFile, differences: report.differences }, null, 2));
