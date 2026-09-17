import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const output = path.join(here, '技能第二阶段收敛证据清单.json');
if (fs.existsSync(output)) throw new Error('技能第二阶段收敛证据清单.json 已存在，拒绝覆盖。');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const evidencePath = path.join(here, '技能清单第二阶段当前证据.json');
const stagePath = path.join(here, '..', '阶段进度.json');
const evidence = read(evidencePath);
const stage = read(stagePath);
const coverage = stage.inventoryConclusions.coverage.skills;
assert.equal(evidence.status, 'PASS');
assert.equal(evidence.getCount, 1);
assert.equal(evidence.businessWrites, 0);
assert.equal(evidence.current.matchedBatches, 9);
assert.equal(evidence.current.matchedSkills, 140);
assert.equal(coverage.concludedItems, 700);
assert.deepEqual(coverage.conclusions, { '已录入': 0, '明确排除': 24, '资料待核': 308, '系统暂缓': 368 });
assert.equal(coverage.remainingInScopeItems, 165);
assert.equal(stage.inventoryConclusions.evidence.skillSecondStageCurrentReadback.sha256, sha(evidencePath));

const files = [
  ['数据参考/全量录入-2026-09/全量清单收敛/核对技能清单第二阶段.mjs', '技能第二阶段回读、集成和检查脚本'],
  ['数据参考/全量录入-2026-09/全量清单收敛/技能清单第二阶段当前证据.json', '9批140技能当前证据'],
  ['数据参考/全量录入-2026-09/阶段进度.json', '唯一逐项结论真源'],
  ['文档记录/详细设计/项目/系统精简实施说明.md', '系统边界与累计覆盖'],
  ['文档记录/详细设计/项目/英雄装备符文全量实录.md', '全量实录累计覆盖'],
  ['文档记录/详细设计/项目/角色技能数据录入标准流程.md', '分阶段验证规则'],
  ['数据参考/全量录入-2026-09/全量清单收敛/生成技能第二阶段证据清单.mjs', '本证据清单生成器']
];
for (const [relativePath] of files) assert(fs.existsSync(path.join(repoRoot, ...relativePath.split('/'))), '缺少文件：' + relativePath);
const manifest = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  status: 'PASS',
  scope: '技能全量清单第二阶段逐项结论',
  phase: {
    matchedBatches: evidence.current.matchedBatches,
    matchedSkills: evidence.current.matchedSkills,
    getCount: evidence.getCount,
    businessWrites: evidence.businessWrites
  },
  cumulative: {
    sourceSkillSlots: coverage.sourceItems,
    reconciledItems: coverage.concludedItems,
    conclusions: coverage.conclusions,
    remainingInScopeItems: coverage.remainingInScopeItems
  },
  remainingBreakdown: {
    earlyBatchUniqueSkills: 155,
    luxAndNasusSkills: 10,
    total: 165
  },
  files: files.map(([relativePath, role]) => ({ relativePath, role, sha256: sha(path.join(repoRoot, ...relativePath.split('/'))) })),
  boundary: '当前累计700/865项；剩余165项尚未形成唯一结论，368项系统暂缓也仍是待处理队列，整体Goal不能完成。'
};
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ status: manifest.status, phase: manifest.phase, cumulative: manifest.cumulative, remainingBreakdown: manifest.remainingBreakdown, fileCount: manifest.files.length }, null, 2));
