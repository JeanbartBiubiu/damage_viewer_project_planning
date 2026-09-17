import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const output = path.join(here, '角色收敛证据清单.json');
if (fs.existsSync(output)) throw new Error('角色收敛证据清单.json 已存在，拒绝覆盖。');
const stagePath = path.join(here, '..', '阶段进度.json');
const evidencePath = path.join(here, '角色清单当前回读证据.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const stage = read(stagePath);
const evidence = read(evidencePath);
const ledger = stage.inventoryConclusions;
assert.equal(evidence.status, 'PASS');
assert.equal(evidence.getCount, 685);
assert.equal(evidence.businessWrites, 0);
assert.equal(ledger.characters.length, 173);
assert.deepEqual(ledger.coverage.characters.conclusions, { '已录入': 171, '明确排除': 2, '资料待核': 0, '系统暂缓': 0 });
assert.equal(ledger.evidence.characterCurrentReadback.sha256, sha(evidencePath));
assert.deepEqual(['skills', 'equipment', 'runes'].map(key => ledger.coverage[key].status), ['NOT_RECONCILED', 'NOT_RECONCILED', 'NOT_RECONCILED']);

const files = [
  ['数据参考/全量录入-2026-09/全量清单收敛/README.md', '收敛边界与执行顺序'],
  ['数据参考/全量录入-2026-09/全量清单收敛/核对角色清单.mjs', '可重复回读、集成和检查脚本'],
  ['数据参考/全量录入-2026-09/全量清单收敛/角色清单当前回读证据.json', '当前685次GET回读证据'],
  ['数据参考/全量录入-2026-09/阶段进度.json', '唯一逐项结论真源'],
  ['文档记录/详细设计/项目/系统精简实施说明.md', '系统与完成边界'],
  ['文档记录/详细设计/项目/英雄装备符文全量实录.md', '全量实录现状'],
  ['文档记录/详细设计/项目/角色技能数据录入标准流程.md', '逐项结论标准流程'],
  ['数据参考/全量录入-2026-09/全量清单收敛/生成角色收敛证据清单.mjs', '本证据清单生成器']
];
for (const [relativePath] of files) assert(fs.existsSync(path.join(repoRoot, ...relativePath.split('/'))), '缺少文件：' + relativePath);
const manifest = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  status: 'PASS',
  scope: '角色主体与基础等级属性逐项结论',
  sourceItems: 173,
  conclusions: ledger.coverage.characters.conclusions,
  currentReadback: {
    getCount: evidence.getCount,
    status200: evidence.statusCounts['200'],
    businessWrites: evidence.businessWrites,
    mappedCharacters: evidence.current.uniqueMappingCount,
    completeLevelRanges: evidence.current.completeLevelRangeCount,
    skillRelations: evidence.current.relationCount,
    enabledRepresentativeImages: evidence.current.enabledRepresentativeImageCount,
    differences: evidence.differences.length
  },
  remainingGroups: ['skills', 'equipment', 'runes'],
  files: files.map(([relativePath, role]) => ({ relativePath, role, sha256: sha(path.join(repoRoot, ...relativePath.split('/'))) })),
  boundary: '角色主体层已收敛；技能、装备与符文尚未逐项收敛，Wasm、宿主和战斗运行未执行，整体Goal仍不能标记完成。'
};
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ status: manifest.status, scope: manifest.scope, sourceItems: manifest.sourceItems, conclusions: manifest.conclusions, getCount: manifest.currentReadback.getCount, remainingGroups: manifest.remainingGroups, fileCount: manifest.files.length }, null, 2));
