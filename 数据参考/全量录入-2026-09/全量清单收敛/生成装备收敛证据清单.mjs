import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const output = path.join(here, '装备收敛证据清单.json');
if (fs.existsSync(output)) throw new Error('装备收敛证据清单.json 已存在，拒绝覆盖。');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const evidencePath = path.join(here, '装备清单当前回读证据.json');
const stagePath = path.join(here, '..', '阶段进度.json');
const evidence = read(evidencePath);
const stage = read(stagePath);
const coverage = stage.inventoryConclusions.coverage.equipment;

assert.equal(evidence.status, 'PASS');
assert.equal(evidence.getCount, 596);
assert.equal(evidence.businessWrites, 0);
assert.deepEqual(evidence.current, {
  sourceItems: 868,
  equipmentSubjects: 198,
  matchedSourceSubjects: 198,
  skillCount: 1062,
  equipmentSkillRelations: 146,
  equipmentImages: 198,
  exactPureAttributeItems: 47,
  completeScopeItems: 5
});
assert.deepEqual(evidence.expectedDistribution, { '已录入': 52, '明确排除': 581, '资料待核': 208, '系统暂缓': 27 });
assert.deepEqual(evidence.priorExploration, {
  getCount: 57,
  equipmentListGETs: 4,
  equipmentAttributeGETs: 48,
  equipmentRelationGETs: 5,
  businessWrites: 0,
  purpose: '确认当前总数、历史别名、纯属性值映射和第十一批零挂载；规范回读不复用这些过程内结果。'
});
assert.equal(stage.inventoryConclusions.equipment.length, 868);
assert.equal(new Set(stage.inventoryConclusions.equipment.map(item => item.sourceItemId)).size, 868);
assert.equal(coverage.concludedItems, 868);
assert.deepEqual(coverage.conclusions, evidence.expectedDistribution);
assert.equal(coverage.remainingInScopeItems, 0);
assert.equal(coverage.openQueueItems, 235);
assert.equal(coverage.status, 'FULL_COVERAGE_WITH_OPEN_QUEUE');
assert.equal(stage.inventoryConclusions.evidence.equipmentCurrentReadback.sha256, sha(evidencePath));
const groupCoverage = stage.inventoryConclusions.coverage;
for (const value of Object.values(groupCoverage)) assert.equal(value.concludedItems, value.sourceItems, '仍有清单未覆盖');
const overall = {
  sourceItems: Object.values(groupCoverage).reduce((sum, value) => sum + value.sourceItems, 0),
  concludedItems: Object.values(groupCoverage).reduce((sum, value) => sum + value.concludedItems, 0),
  conclusions: Object.fromEntries(['已录入', '明确排除', '资料待核', '系统暂缓'].map(key => [
    key,
    Object.values(groupCoverage).reduce((sum, value) => sum + (value.conclusions?.[key] || 0), 0)
  ]))
};
overall.openQueueItems = overall.conclusions['资料待核'] + overall.conclusions['系统暂缓'];
assert.deepEqual(overall, {
  sourceItems: 1975,
  concludedItems: 1975,
  conclusions: { '已录入': 226, '明确排除': 618, '资料待核': 627, '系统暂缓': 504 },
  openQueueItems: 1131
});

const files = [
  ['数据参考/全量录入-2026-09/装备符文/装备全量处置清单.json', '固定16.17.1装备来源清单'],
  ['数据参考/全量录入-2026-09/装备符文/纯属性装备可录清单.json', '47件纯属性来源与期望值'],
  ['数据参考/全量录入-2026-09/装备效果候选/逐件审阅.json', '134件普通效果装备逐项缺口'],
  ['数据参考/全量录入-2026-09/装备效果候选/来源与覆盖.json', '134件逐项审阅覆盖证明'],
  ['数据参考/全量录入-2026-09/装备技能实录/第十一批范围与轻灵鞋/独立最终回读.json', '5件当前1V1范围完整证据'],
  ['数据参考/全量录入-2026-09/全量清单收敛/核对装备清单.mjs', '装备当前回读、集成和检查脚本'],
  ['数据参考/全量录入-2026-09/全量清单收敛/装备清单当前回读证据.json', '596次当前GET回读证据'],
  ['数据参考/全量录入-2026-09/阶段进度.json', '唯一逐项结论真源'],
  ['数据参考/全量录入-2026-09/全量清单收敛/README.md', '执行顺序、调查和代理降级记录'],
  ['文档记录/详细设计/项目/系统精简实施说明.md', '装备映射边界与总覆盖'],
  ['文档记录/详细设计/项目/英雄装备符文全量实录.md', '装备实录与总开放队列'],
  ['文档记录/详细设计/项目/角色技能数据录入标准流程.md', '装备逐项结论规则'],
  ['数据参考/全量录入-2026-09/全量清单收敛/生成装备收敛证据清单.mjs', '本证据清单生成器']
];
for (const [relativePath] of files) assert(fs.existsSync(path.join(repoRoot, ...relativePath.split('/'))), '缺少文件：' + relativePath);
assert.equal(evidence.source.inventorySha256, sha(path.join(repoRoot, ...files[0][0].split('/'))));
assert.equal(evidence.source.pureAttributeSha256, sha(path.join(repoRoot, ...files[1][0].split('/'))));
assert.equal(evidence.source.effectReviewSha256, sha(path.join(repoRoot, ...files[2][0].split('/'))));
assert.equal(evidence.source.effectReviewCoverageSha256, sha(path.join(repoRoot, ...files[3][0].split('/'))));

const manifest = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  status: 'PASS',
  scope: '装备868项逐项唯一结论',
  currentReadback: {
    getCount: evidence.getCount,
    businessWrites: evidence.businessWrites,
    sourceItems: evidence.current.sourceItems,
    equipmentSubjects: evidence.current.equipmentSubjects,
    matchedSourceSubjects: evidence.current.matchedSourceSubjects,
    equipmentSkillRelations: evidence.current.equipmentSkillRelations,
    equipmentImages: evidence.current.equipmentImages,
    exactPureAttributeItems: evidence.current.exactPureAttributeItems,
    completeScopeItems: evidence.current.completeScopeItems
  },
  conclusions: coverage.conclusions,
  openQueueItems: coverage.openQueueItems,
  overall,
  priorExploration: evidence.priorExploration,
  allGroups: Object.fromEntries(Object.entries(stage.inventoryConclusions.coverage).map(([key, value]) => [key, value.status])),
  files: files.map(([relativePath, role]) => ({ relativePath, role, sha256: sha(path.join(repoRoot, ...relativePath.split('/'))) })),
  boundary: '装备868项已全部形成唯一结论；208项资料待核和27项系统暂缓仍需继续处理。四类清单均已覆盖，但合计1131项开放队列使整体Goal不能完成。'
};

fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ status: manifest.status, currentReadback: manifest.currentReadback, conclusions: manifest.conclusions, openQueueItems: manifest.openQueueItems, overall: manifest.overall, allGroups: manifest.allGroups, fileCount: manifest.files.length }, null, 2));
