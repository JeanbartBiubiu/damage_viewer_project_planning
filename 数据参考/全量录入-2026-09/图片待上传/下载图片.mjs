// 仅准备官方图标作为用户授权的页面上传输入；不写业务服务或其他目录。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const dir = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(dir, '..');
const version = '16.17.1';
const cdn = `https://ddragon.leagueoflegends.com/cdn/${version}/img`;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const rel = p => path.relative(dir, p).replaceAll('\\', '/');
const safe = text => text.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
const heroes = ['Ezreal', 'Garen', 'Ashe', 'Lux', 'Ahri', 'Caitlyn', 'Darius', 'Draven', 'Jinx', 'Leona', 'Lucian', 'Morgana', 'Tristana', 'Varus', 'Malphite', 'MissFortune'];
const heroRoot = path.join(base, '英雄');
const heroManifest = read(path.join(heroRoot, '来源清单.json'));
const itemRoot = path.join(base, '装备符文');
const itemManifest = read(path.join(itemRoot, '资料清单.json'));
const pureFile = path.join(itemRoot, '纯属性装备可录清单.json');
const pure = read(pureFile);
assert.equal(pure.version, version);
assert.equal(pure.items.length, 47);
const sources = [];
function frozen(file, metadata) {
  const bytes = fs.readFileSync(file);
  assert.equal(hash(bytes), metadata.sha256, `冻结资料摘要变化：${file}`);
  assert.equal(bytes.length, metadata.byteSize);
  const source = { file: rel(file), url: metadata.url, sourceFetchedAt: metadata.fetchedAt ?? metadata.retrievedAt, bytes: bytes.length, sha256: hash(bytes) };
  sources.push(source);
  return { json: JSON.parse(bytes), source };
}
const rawItemMetadata = itemManifest.sources.find(s => s.file === '官方原始资料/item-16.17.1-zh_CN.json');
const rawItems = frozen(path.join(itemRoot, rawItemMetadata.file), rawItemMetadata);
assert.equal(rawItems.json.version, version);
const items = [];
function add({ useKey, purpose, objectId, objectName, slot = null, suggestedBusinessKey = null, file, image, source, pointer, claimedUrl = null }) {
  assert(image && ['champion', 'spell', 'passive', 'item'].includes(image.group));
  assert(/^[A-Za-z0-9_.-]+\.png$/.test(image.full), `非法或缺失的来源图片名：${objectId}`);
  const url = `${cdn}/${image.group}/${image.full}`;
  if (claimedUrl) assert.equal(claimedUrl, url, `来源清单图片URL和原字段不符：${objectId}`);
  const absolutePath = path.resolve(dir, file);
  assert(absolutePath.startsWith(dir + path.sep));
  items.push({ useKey, purpose, objectId, objectName, slot, suggestedBusinessKey, file: file.replaceAll('\\', '/'), absolutePath, sourceUrl: url, sourceImageFull: image.full, sourceImageGroup: image.group, sourceReference: { file: source.file, sha256: source.sha256, url: source.url, pointer }, downloadStatus: '待下载', uploadStatus: '待页面上传，尚未操作业务' });
}
for (const id of heroes) {
  const p = `原始资料/zh_CN/champion/${id}.json`;
  const metadata = heroManifest.sourceFiles.find(s => s.path === p);
  assert(metadata, `没有已冻结英雄资料：${id}`);
  const { json, source } = frozen(path.join(heroRoot, p), metadata);
  assert.equal(json.version, version);
  const c = json.data[id];
  assert.equal(c.id, id);
  add({ useKey: `角色:${id}`, purpose: '角色代表图片', objectId: id, objectName: c.title, suggestedBusinessKey: id === 'Garen' ? 'champion_garen' : null, file: `01_角色/${id}.png`, image: c.image, source, pointer: `/data/${id}/image` });
  if (['Ezreal', 'Garen'].includes(id)) {
    add({ useKey: `技能:${id}:P`, purpose: '技能图标', objectId: id, objectName: `${c.title}·${c.passive.name}`, slot: 'P', file: `02_技能/${id}/P_${c.passive.image.full}`, image: c.passive.image, source, pointer: `/data/${id}/passive/image` });
    assert.equal(c.spells.length, 4);
    for (let i = 0; i < 4; i++) {
      const s = c.spells[i], slot = 'QWER'[i];
      add({ useKey: `技能:${id}:${slot}`, purpose: '技能图标', objectId: id, objectName: `${c.title}·${s.name}`, slot, file: `02_技能/${id}/${slot}_${s.image.full}`, image: s.image, source, pointer: `/data/${id}/spells/${i}/image` });
    }
  }
}
for (const p of pure.items) {
  const item = rawItems.json.data[p.itemId];
  assert(item, `原始装备缺失：${p.itemId}`);
  assert.equal(item.name, p.name);
  add({ useKey: `装备:${p.itemId}`, purpose: '纯属性装备图标', objectId: p.itemId, objectName: item.name, suggestedBusinessKey: p.existingEquipmentKey ?? p.proposedKey, file: `03_装备/${p.itemId}_${safe(item.name)}.png`, image: item.image, source: rawItems.source, pointer: `/data/${p.itemId}/image`, claimedUrl: p.imageUrl });
}
assert.equal(items.length, 73);
for (const key of ['useKey', 'file', 'sourceUrl']) assert.equal(new Set(items.map(i => i[key])).size, items.length, `用途/文件/来源重复：${key}`);
const manifestFile = path.join(dir, '上传用途与来源清单.json');
const old = fs.existsSync(manifestFile) ? read(manifestFile) : null;
const oldItems = new Map(old?.items?.map(i => [i.useKey, i]) ?? []);
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function checkPNG(bytes) {
  assert(bytes.length > 32 && bytes.length < 2 * 1024 * 1024, '不是预期大小的图标响应');
  assert(bytes.subarray(0, 8).equals(signature), '不是PNG，不保存404或HTML正文');
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert(width > 0 && height > 0 && width <= 4096 && height <= 4096);
  return { width, height };
}
async function download(item) {
  const previous = oldItems.get(item.useKey);
  if (previous?.sourceUrl === item.sourceUrl && previous.downloadStatus === '下载成功' && fs.existsSync(item.absolutePath)) {
    const bytes = fs.readFileSync(item.absolutePath);
    if (hash(bytes) === previous.sha256) {
      checkPNG(bytes);
      Object.assign(item, { downloadStatus: '下载成功', fetchedAt: previous.fetchedAt, httpStatus: previous.httpStatus, contentType: previous.contentType, bytes: bytes.length, sha256: previous.sha256, pngHeader: previous.pngHeader, responseEtag: previous.responseEtag ?? null, responseLastModified: previous.responseLastModified ?? null, reusedVerifiedBytes: true });
      return;
    }
    throw Error(`已有图片摘要不符，保留文件并停止：${item.file}`);
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(item.sourceUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      assert.equal(contentType, 'image/png', '响应类型不是PNG');
      const bytes = Buffer.from(await response.arrayBuffer());
      const pngHeader = checkPNG(bytes);
      fs.mkdirSync(path.dirname(item.absolutePath), { recursive: true });
      // 已存在却无对应有效清单时不覆盖，防止改掉其他人的上传输入。
      fs.writeFileSync(item.absolutePath, bytes, { flag: 'wx' });
      Object.assign(item, { downloadStatus: '下载成功', fetchedAt: new Date().toISOString(), httpStatus: response.status, contentType, bytes: bytes.length, sha256: hash(bytes), pngHeader, responseEtag: response.headers.get('etag'), responseLastModified: response.headers.get('last-modified'), reusedVerifiedBytes: false });
      console.log(`已下载 ${item.useKey}`);
      return;
    } catch (error) {
      if (error.code === 'EEXIST') { item.downloadStatus = '失败'; item.error = '目标文件已存在但没有对应可复用摘要，保留文件未覆盖'; return; }
      if (attempt === 3) { item.downloadStatus = '失败'; item.error = String(error.message); item.lastAttemptAt = new Date().toISOString(); return; }
    }
  }
}
let index = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (index < items.length) await download(items[index++]); }));
const manifest = { schemaVersion: 1, preparedAt: new Date().toISOString(), version, purpose: '用户授权的管理页面图片上传输入。未执行上传或写业务API/SQL。', scope: { champions: heroes, skillChampions: ['Ezreal', 'Garen'], skillSlots: ['P', 'Q', 'W', 'E', 'R'], pureAttributeEquipmentCount: 47 }, sourceFiles: sources, equipmentSelectionSource: { file: rel(pureFile), sha256: hash(fs.readFileSync(pureFile)), selectedIds: pure.items.map(i => i.itemId) }, namingRule: '角色用官方英雄ID；技能在官方完整图片名前加槽位；装备用编号+中文名。全部文件都是官方原字节，没有裁剪/重画/替换。', identityNotes: 'suggestedBusinessKey 只是来源清单里的已有/建议业务键；角色和技能应以管理页面名称与槽位核对，不按未经回读的业务键盲目上传。', items };
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, '核对图片解码.ps1'), '-ManifestPath', manifestFile], { encoding: 'utf8', stdio: 'inherit' });
const decoded = read(manifestFile);
const summary = { expected: 73, downloaded: decoded.items.filter(i => i.downloadStatus === '下载成功').length, decoded: decoded.items.filter(i => i.decode?.status === '成功').length, failed: decoded.items.filter(i => i.downloadStatus !== '下载成功' || i.decode?.status !== '成功').map(i => ({ useKey: i.useKey, error: i.error ?? i.decode?.error })), totalBytes: decoded.items.reduce((n, i) => n + (i.bytes ?? 0), 0), duplicateByteGroups: [] };
const sameBytes = new Map();
for (const i of decoded.items) if (i.sha256) { const a = sameBytes.get(i.sha256) ?? []; a.push({ useKey: i.useKey, sourceUrl: i.sourceUrl }); sameBytes.set(i.sha256, a); }
summary.duplicateByteGroups = [...sameBytes.entries()].filter(([, a]) => a.length > 1).map(([sha256, uses]) => ({ sha256, uses, note: '若不同官方URL返回相同原字节，保留各自用途和来源，不推断为错配。' }));
decoded.verification = summary;
fs.writeFileSync(manifestFile, JSON.stringify(decoded, null, 2) + '\n');
const cell = s => String(s ?? '').replaceAll('\t', ' ').replaceAll('\n', ' ');
fs.writeFileSync(path.join(dir, '文件选择器路径.tsv'), '\ufeff' + ['用途\t对象\t槽位\t本机绝对路径\t状态\t来源', ...decoded.items.map(i => [i.purpose, i.objectName, i.slot, i.absolutePath, i.decode?.status === '成功' ? '可选择上传' : '不可上传：缺失或解码失败', i.sourceUrl].map(cell).join('\t'))].join('\n') + '\n');
console.log(JSON.stringify(summary));
if (summary.failed.length) process.exitCode = 1;
