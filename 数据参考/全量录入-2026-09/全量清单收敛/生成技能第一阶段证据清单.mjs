import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const output = path.join(here, '技能第一阶段收敛证据清单.json');
if (fs.existsSync(output)) throw new Error('技能第一阶段收敛证据清单.json 已存在，拒绝覆盖。');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const evidencePath = path.join(here, '技能清单第一阶段当前证据.json');
const stagePath = path.join(here, '..', '阶段进度.json');
const evidence = read(evidencePath);
const stage = read(stagePath);
const ledger = stage.inventoryConclusions;
assert.equal(evidence.status, 'PASS');
assert.equal(evidence.getCount, 1);
assert.equal(evidence.businessWrites, 0);
assert.equal(evidence.current.matchedBatches, 31);
assert.equal(evidence.current.matchedSkills, 550);
assert.equal(ledger.skills.length, 560);
assert.deepEqual(ledger.coverage.skills.conclusions, { '已录入': 0, '明确排除': 21, '资料待核': 210, '系统暂缓': 329 });
assert.equal(ledger.coverage.skills.remainingInScopeItems, 305);
assert.equal(ledger.evidence.skillFirstStageCurrentReadback.sha256, sha(evidencePath));

const files = [
  ['数据参考/全量录入-2026-09/全量清单收敛/核对技能清单第一阶段.mjs', '技能第一阶段回读、集成和检查脚本'],
  ['数据参考/全量录入-2026-09/全量清单收敛/技能清单第一阶段当前证据.json', '31批550技能及10排除槽的当前证据'],
  ['数据参考/全量录入-2026-09/阶段进度.json', '唯一逐项结论真源'],
  ['文档记录/详细设计/项目/系统精简实施说明.md', '系统边界与未完成说明'],
  ['文档记录/详细设计/项目/英雄装备符文全量实录.md', '全量实录当前覆盖'],
  ['文档记录/详细设计/项目/角色技能数据录入标准流程.md', '逐项分类优先级'],
  ['数据参考/全量录入-2026-09/全量清单收敛/生成技能第一阶段证据清单.mjs', '本证据清单生成器']
];
for (const [relativePath] of files) assert(fs.existsSync(path.join(repoRoot, ...relativePath.split('/'))), '缺少文件：' + relativePath);
const manifest = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  status: 'PASS',
  scope: '技能全量清单第一阶段逐项结论',
  sourceSkillSlots: 865,
  reconciledItems: ledger.coverage.skills.concludedItems,
  conclusions: ledger.coverage.skills.conclusions,
  candidateEvidence: {
    candidateFilesScanned: evidence.current.candidateFilesScanned,
    matchedBatches: evidence.current.matchedBatches,
    unmatchedBatches: evidence.current.unmatchedBatches,
    matchedInScopeSkills: evidence.current.matchedSkills,
    excludedChampionSlots: evidence.excludedChampionSlots.length,
    currentSkillDirectoryCount: evidence.current.skillCount,
    getCount: evidence.getCount,
    businessWrites: evidence.businessWrites
  },
  remainingInScopeItems: ledger.coverage.skills.remainingInScopeItems,
  files: files.map(([relativePath, role]) => ({ relativePath, role, sha256: sha(path.join(repoRoot, ...relativePath.split('/'))) })),
  boundary: '当前只完成560/865项技能结论；305个范围内技能尚未收敛，329项系统暂缓仍需通用修正或返回补录。该分布不构成整体完成证据。'
};
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ status: manifest.status, reconciledItems: manifest.reconciledItems, conclusions: manifest.conclusions, remainingInScopeItems: manifest.remainingInScopeItems, fileCount: manifest.files.length }, null, 2));
