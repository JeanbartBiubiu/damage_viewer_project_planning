import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const output = path.join(here, '技能第三阶段收敛证据清单.json');
if (fs.existsSync(output)) throw new Error('技能第三阶段收敛证据清单.json 已存在，拒绝覆盖。');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const evidencePath = path.join(here, '技能清单第三阶段当前证据.json');
const stagePath = path.join(here, '..', '阶段进度.json');
const evidence = read(evidencePath);
const stage = read(stagePath);
const ledger = stage.inventoryConclusions;
const coverage = ledger.coverage.skills;

assert.equal(evidence.status, 'PASS');
assert.equal(evidence.getCount, 1);
assert.equal(evidence.businessWrites, 0);
assert.equal(evidence.current.sourceGroups, 10);
assert.equal(evidence.current.rawSkillRefs, 170);
assert.equal(evidence.current.skippedExisting, 5);
assert.equal(evidence.current.additions, 165);
assert.equal(evidence.current.finalSourceSlotCoverage, 865);
assert.equal(ledger.skills.length, 865);
assert.equal(new Set(ledger.skills.map(item => item.sourceChampionId + '/' + item.slot)).size, 865);
assert.equal(coverage.sourceItems, 865);
assert.equal(coverage.concludedItems, 865);
assert.deepEqual(coverage.conclusions, { '已录入': 0, '明确排除': 26, '资料待核': 385, '系统暂缓': 454 });
assert.equal(coverage.remainingInScopeItems, 0);
assert.equal(coverage.status, 'FULL_COVERAGE_WITH_OPEN_QUEUE');
assert.equal(ledger.evidence.skillThirdStageCurrentReadback.sha256, sha(evidencePath));

const files = [
  ['数据参考/全量录入-2026-09/全量清单收敛/核对技能清单第一阶段.mjs', '第一阶段来源子集回归检查器'],
  ['数据参考/全量录入-2026-09/全量清单收敛/核对技能清单第二阶段.mjs', '第二阶段来源子集回归检查器'],
  ['数据参考/全量录入-2026-09/全量清单收敛/核对技能清单第三阶段.mjs', '第三阶段回读、集成和全量检查脚本'],
  ['数据参考/全量录入-2026-09/全量清单收敛/技能清单第三阶段当前证据.json', '十组来源和165项新增技能当前证据'],
  ['数据参考/全量录入-2026-09/阶段进度.json', '唯一逐项结论真源'],
  ['数据参考/全量录入-2026-09/全量清单收敛/README.md', '执行顺序与边界说明'],
  ['文档记录/详细设计/项目/系统精简实施说明.md', '系统边界与最终技能覆盖'],
  ['文档记录/详细设计/项目/英雄装备符文全量实录.md', '全量实录与开放队列'],
  ['文档记录/详细设计/项目/角色技能数据录入标准流程.md', '分阶段检查规则'],
  ['数据参考/全量录入-2026-09/全量清单收敛/生成技能第三阶段证据清单.mjs', '本证据清单生成器']
];
for (const [relativePath] of files) assert(fs.existsSync(path.join(repoRoot, ...relativePath.split('/'))), '缺少文件：' + relativePath);

const manifest = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  status: 'PASS',
  scope: '技能全量清单第三阶段逐项结论',
  phase: {
    sourceGroups: evidence.current.sourceGroups,
    rawSkillRefs: evidence.current.rawSkillRefs,
    skippedExisting: evidence.current.skippedExisting,
    addedSkills: evidence.current.additions,
    getCount: evidence.getCount,
    businessWrites: evidence.businessWrites
  },
  cumulative: {
    sourceSkillSlots: coverage.sourceItems,
    reconciledItems: coverage.concludedItems,
    conclusions: coverage.conclusions,
    remainingUncoveredItems: coverage.remainingInScopeItems,
    status: coverage.status
  },
  openQueue: {
    sourcePending: coverage.conclusions['资料待核'],
    systemDeferred: coverage.conclusions['系统暂缓'],
    total: coverage.conclusions['资料待核'] + coverage.conclusions['系统暂缓']
  },
  remainingGroups: {
    equipment: ledger.coverage.equipment.status,
    runes: ledger.coverage.runes.status
  },
  files: files.map(([relativePath, role]) => ({ relativePath, role, sha256: sha(path.join(repoRoot, ...relativePath.split('/'))) })),
  boundary: '技能865个来源槽已全部获得唯一结论；385项资料待核和454项系统暂缓仍是开放工作，装备与符文尚未收敛，整体Goal不能完成。'
};

fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ status: manifest.status, phase: manifest.phase, cumulative: manifest.cumulative, openQueue: manifest.openQueue, remainingGroups: manifest.remainingGroups, fileCount: manifest.files.length }, null, 2));
