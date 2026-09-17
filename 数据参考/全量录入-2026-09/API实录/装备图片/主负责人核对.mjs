import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const batch = read('汇总.json');
const relations = read('代表图关系最终核对.json');
assert.equal(batch.results.length, 134);
assert.equal(relations.linked, 134);
assert.equal(relations.disabled, 0);
const rows = [];
fs.mkdirSync(path.join(dir, 'source-images'), { recursive: true });
for (const record of batch.results) {
  const relative = `source-images/${record.itemId}.png`;
  const file = path.join(dir, relative);
  const source = record.imageBase64
    ? Buffer.from(record.imageBase64.split(',')[1], 'base64') : fs.readFileSync(file);
  assert.equal(sha(source), record.sourceSha256);
  if (!fs.existsSync(file)) fs.writeFileSync(file, source);
  const relation = relations.items.find(x => x.equipmentKey === record.equipmentKey);
  assert.equal(relation.enabled, true);
  const response = await fetch(`http://127.0.0.1:8080/api/admin/games/lol/images/${encodeURIComponent(relation.imageKey)}`, {
    headers: { Authorization: 'Bearer local-entry' }, signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200);
  const image = await response.json();
  assert.equal(image.imageKey, relation.imageKey);
  const returned = Buffer.from(image.imageBase64.split(',')[1], 'base64');
  assert.equal(sha(returned), record.sourceSha256, record.equipmentKey);
  assert.equal(image.byteSize, source.length);
  assert.equal(image.width, 64);
  assert.equal(image.height, 64);
  assert.equal(image.enabled, true);
  rows.push({ equipmentKey: record.equipmentKey, imageKey: image.imageKey, sourceFile: relative,
    sourceSha256: record.sourceSha256, returnedSha256: sha(returned), bytes: image.byteSize,
    width: image.width, height: image.height, enabled: image.enabled, checkedAt: new Date().toISOString() });
}
fs.writeFileSync(path.join(dir, '主负责人独立核对.json'), JSON.stringify({ checked: rows.length, failures: 0, rows }, null, 2) + '\n');
// Preserve downloaded source bytes as PNG files instead of duplicating Base64 in every evidence JSON.
function compact(value) {
  if (!value || typeof value !== 'object') return;
  if (value.itemId && value.imageBase64) {
    value.sourceFile = `source-images/${value.itemId}.png`;
    delete value.imageBase64;
  }
  for (const nested of Object.values(value)) compact(nested);
}
for (const name of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
  const value = read(name);
  compact(value);
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n');
}
console.log(JSON.stringify({ sourceImages: rows.length, independentlyVerifiedImages: rows.length, failures: 0 }));
