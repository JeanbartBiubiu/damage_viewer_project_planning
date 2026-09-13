import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProtectedTriggerBatch } from '../共享受保护触发批次/受保护触发批次-v1.mjs';
import { batchConfig } from './批次配置.mjs';

const batchDirectory = path.dirname(fileURLToPath(import.meta.url));
const adapterPath = path.join(batchDirectory, '旧版规范化来源候选.json');
const nasusOriginalPath = path.resolve(batchDirectory, '..', '..', '..', '..', '..', 'damage_viewer_project_planning', '数据参考', '全量录入-2026-09', '内瑟斯技能实录第一批', '录入候选.json');
const luxOriginalPath = path.resolve(batchDirectory, '..', 'Cursor', '拉克丝机制第一批', '候选.json');
const adapter = JSON.parse(fs.readFileSync(adapterPath, 'utf8'));
const nasusOriginalBytes = fs.readFileSync(nasusOriginalPath);
const luxOriginalBytes = fs.readFileSync(luxOriginalPath);
assert.equal(crypto.createHash('sha256').update(nasusOriginalBytes).digest('hex'), adapter.originalSources.nasus.sha256, '内瑟斯原始来源散列漂移');
assert.equal(crypto.createHash('sha256').update(luxOriginalBytes).digest('hex'), adapter.originalSources.lux.sha256, '拉克丝原始来源散列漂移');
const nasusOriginal = JSON.parse(nasusOriginalBytes);
const luxOriginal = JSON.parse(luxOriginalBytes);
for (const skillKey of ['nasus_w', 'nasus_r']) {
  const sourceSkill = nasusOriginal.skills.find(item => item.skillKey === skillKey);
  assert(sourceSkill, '内瑟斯原始来源缺少技能：' + skillKey);
  assert.equal(adapter.skills[skillKey].maxLevel, sourceSkill.maxLevel);
  assert.deepEqual(adapter.skills[skillKey].write.processes, sourceSkill.processes, '内瑟斯规范化过程与原数组不一致：' + skillKey);
}
assert.equal(adapter.skills.lux_w.maxLevel, luxOriginal.skills.lux_w.maxLevel);
assert.deepEqual(adapter.skills.lux_w.write.processes, luxOriginal.skills.lux_w.write.processes, '拉克丝规范化过程与原对象不一致：lux_w');
await runProtectedTriggerBatch({ batchDirectory, config: batchConfig, mode: process.argv[2] });
