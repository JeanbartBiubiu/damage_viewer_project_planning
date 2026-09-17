import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const output = path.join(here, '符文收敛证据清单.json');
if (fs.existsSync(output)) throw new Error('符文收敛证据清单.json 已存在，拒绝覆盖。');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const evidencePath = path.join(here, '符文清单当前回读证据.json');
const stagePath = path.join(here, '..', '阶段进度.json');
const evidence = read(evidencePath);
const stage = read(stagePath);
const coverage = stage.inventoryConclusions.coverage.runes;

assert.equal(evidence.status, 'PASS');
assert.equal(evidence.getCount, 209);
assert.equal(evidence.businessWrites, 0);
assert.deepEqual(evidence.current, {
  runeCount: 69,
  skillCount: 1062,
  mountedRuneSkills: 60,
  explicitExclusions: 9,
  runeImages: 69,
  skillImages: 60,
  completeStaticShardDetails: 9
});
assert.deepEqual(evidence.expectedDistribution, { '已录入': 3, '明确排除': 9, '资料待核': 34, '系统暂缓': 23 });
assert.equal(evidence.priorFailedReadOnlyAttempt.businessWrites, 0);
assert.equal(evidence.priorFailedReadOnlyAttempt.evidenceFileWritten, false);
assert.equal(stage.inventoryConclusions.runes.length, 69);
assert.equal(new Set(stage.inventoryConclusions.runes.map(item => item.runeKey)).size, 69);
assert.equal(coverage.concludedItems, 69);
assert.deepEqual(coverage.conclusions, evidence.expectedDistribution);
assert.equal(coverage.remainingInScopeItems, 0);
assert.equal(coverage.openQueueItems, 57);
assert.equal(coverage.status, 'FULL_COVERAGE_WITH_OPEN_QUEUE');
assert.equal(stage.inventoryConclusions.evidence.runeCurrentReadback.sha256, sha(evidencePath));

const files = [
  ['数据参考/全量录入-2026-09/装备符文/符文待录清单.json', '固定16.17.1符文与碎片身份清单'],
  ['数据参考/全量录入-2026-09/API实录/符文机制盘点/逐项机器清单.json', '62项普通符文范围与缺口盘点'],
  ['数据参考/全量录入-2026-09/API实录/符文效果第一批/候选与边界.json', '五项首批碎片完整或仅参数边界'],
  ['数据参考/全量录入-2026-09/API实录/符文效果第六批/最终候选.json', '剩余碎片来源与缺口'],
  ['数据参考/全量录入-2026-09/API实录/符文效果第六批/当前实录状态.json', '69项最终挂载与范围排除证据'],
  ['数据参考/全量录入-2026-09/全量清单收敛/核对符文清单.mjs', '符文当前回读、集成和检查脚本'],
  ['数据参考/全量录入-2026-09/全量清单收敛/符文清单当前回读证据.json', '209次当前GET回读证据'],
  ['数据参考/全量录入-2026-09/阶段进度.json', '唯一逐项结论真源'],
  ['数据参考/全量录入-2026-09/全量清单收敛/README.md', '执行顺序与失败恢复记录'],
  ['文档记录/详细设计/项目/系统精简实施说明.md', '系统边界与符文覆盖'],
  ['文档记录/详细设计/项目/英雄装备符文全量实录.md', '符文实录与开放队列'],
  ['文档记录/详细设计/项目/角色技能数据录入标准流程.md', '符文逐项结论规则'],
  ['数据参考/全量录入-2026-09/全量清单收敛/生成符文收敛证据清单.mjs', '本证据清单生成器']
];
for (const [relativePath] of files) assert(fs.existsSync(path.join(repoRoot, ...relativePath.split('/'))), '缺少文件：' + relativePath);
assert.equal(evidence.source.inventorySha256, sha(path.join(repoRoot, ...files[0][0].split('/'))));
assert.equal(evidence.source.mechanismSha256, sha(path.join(repoRoot, ...files[1][0].split('/'))));
assert.equal(evidence.source.firstShardCandidateSha256, sha(path.join(repoRoot, ...files[2][0].split('/'))));
assert.equal(evidence.source.lastShardCandidateSha256, sha(path.join(repoRoot, ...files[3][0].split('/'))));
assert.equal(evidence.source.finalCoverageSha256, sha(path.join(repoRoot, ...files[4][0].split('/'))));

const manifest = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  status: 'PASS',
  scope: '符文69项逐项唯一结论',
  currentReadback: {
    getCount: evidence.getCount,
    businessWrites: evidence.businessWrites,
    runeSubjects: evidence.current.runeCount,
    mountedSkills: evidence.current.mountedRuneSkills,
    explicitExclusions: evidence.current.explicitExclusions,
    runeImages: evidence.current.runeImages,
    skillImages: evidence.current.skillImages,
    completeStaticShardDetails: evidence.current.completeStaticShardDetails
  },
  conclusions: coverage.conclusions,
  openQueueItems: coverage.openQueueItems,
  priorFailedReadOnlyAttempt: evidence.priorFailedReadOnlyAttempt,
  otherGroupStatus: {
    equipment: stage.inventoryConclusions.coverage.equipment.status
  },
  files: files.map(([relativePath, role]) => ({ relativePath, role, sha256: sha(path.join(repoRoot, ...relativePath.split('/'))) })),
  boundary: '符文69项已全部形成唯一结论；34项资料待核和23项系统暂缓仍需继续处理。四类清单均已覆盖，但合计1131项开放队列使整体Goal不能完成。'
};

fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ status: manifest.status, currentReadback: manifest.currentReadback, conclusions: manifest.conclusions, openQueueItems: manifest.openQueueItems, otherGroupStatus: manifest.otherGroupStatus, fileCount: manifest.files.length }, null, 2));
