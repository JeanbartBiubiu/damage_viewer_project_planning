import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['readback', 'integrate', 'check-stage'].includes(mode)) throw new Error('用法：node 核对符文清单.mjs readback|integrate|check-stage');
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const stagePath = path.join(here, '..', '阶段进度.json');
const outputPath = path.join(here, '符文清单当前回读证据.json');
const sourcePath = path.join(repoRoot, '数据参考', '全量录入-2026-09', '装备符文', '符文待录清单.json');
const mechanismPath = path.join(repoRoot, '数据参考', '全量录入-2026-09', 'API实录', '符文机制盘点', '逐项机器清单.json');
const finalCoveragePath = path.join(repoRoot, '数据参考', '全量录入-2026-09', 'API实录', '符文效果第六批', '当前实录状态.json');
const firstShardPath = path.join(repoRoot, '数据参考', '全量录入-2026-09', 'API实录', '符文效果第一批', '候选与边界.json');
const lastShardPath = path.join(repoRoot, '数据参考', '全量录入-2026-09', 'API实录', '符文效果第六批', '最终候选.json');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const shaBytes = value => crypto.createHash('sha256').update(value).digest('hex');
const fileSha = file => shaBytes(fs.readFileSync(file));
const completeShardIds = new Set([5005, 5007, 5011]);

function sourceRecords() {
  const source = readJson(sourcePath);
  assert.equal(source.version, '16.17.1');
  assert.equal(source.runes.length, 62);
  assert.equal(source.shards.records.length, 7);
  const records = [
    ...source.runes.map(item => ({
      runeId: item.runeId,
      runeKey: item.proposedKey,
      name: item.name,
      category: item.slotIndex === 0 ? 'KEYSTONE' : 'MINOR',
      sourceKind: 'ordinary'
    })),
    ...source.shards.records.map(item => ({
      runeId: item.runeId,
      runeKey: 'rune_' + item.runeId,
      name: item.name,
      category: 'SHARD',
      sourceKind: 'shard'
    }))
  ].sort((left, right) => left.runeId - right.runeId);
  assert.equal(records.length, 69);
  assert.equal(new Set(records.map(item => item.runeKey)).size, 69);
  return records;
}

async function mapLimit(values, limit, worker) {
  const result = new Array(values.length);
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run));
  return result;
}

function sourceBasis(records) {
  const ordinary = new Map(readJson(mechanismPath).entries.map(item => [item.runeKey, item]));
  const coverage = readJson(finalCoveragePath);
  const excluded = new Set(coverage.coverage.excluded);
  assert.equal(excluded.size, 9);
  const firstShards = new Map(readJson(firstShardPath).entries.map(item => [item.id, item]));
  const lastShards = new Map(readJson(lastShardPath).proposals.map(item => [item.id, item]));
  assert.equal(ordinary.size, 62);
  assert.equal(firstShards.size, 5);
  const result = new Map();
  for (const record of records) {
    if (record.sourceKind === 'ordinary') {
      const item = ordinary.get(record.runeKey);
      assert(item, '缺少普通符文盘点：' + record.runeKey);
      result.set(record.runeKey, {
        explicitScopeExclusion: excluded.has(record.runeKey),
        sourcePending: item.missingSourceValueFacts || [],
        systemPending: item.missingFacts || [],
        configurationComplete: false,
        samples: [...(item.missingSourceValueFacts || []), ...(item.missingFacts || [])].slice(0, 3)
      });
      continue;
    }
    if (completeShardIds.has(record.runeId)) {
      const item = firstShards.get(record.runeId);
      assert.equal(item?.status, '固定自身属性配置候选', '完整碎片候选不符：' + record.runeKey);
      result.set(record.runeKey, {
        explicitScopeExclusion: false,
        sourcePending: [],
        systemPending: [],
        configurationComplete: true,
        samples: ['固定自身属性已保存、独立回读并完成代表页面核对']
      });
      continue;
    }
    if (record.runeId === 5010 || record.runeId === 5013) {
      const item = firstShards.get(record.runeId);
      assert.equal(item?.status, '仅参数候选', '仅参数碎片候选不符：' + record.runeKey);
      result.set(record.runeKey, {
        explicitScopeExclusion: false,
        sourcePending: [],
        systemPending: ['固定参数已保存，但持续属性效果、选择应用或多来源组合尚未完成'],
        configurationComplete: false,
        samples: ['当前只保存参数，不能当作完整常驻属性机制']
      });
      continue;
    }
    const item = lastShards.get(record.runeId);
    assert(item, '缺少剩余碎片候选：' + record.runeKey);
    const sourcePending = (item.pending || []).filter(value => value.type === '来源' || value.type === '资料').map(value => value.reason);
    const systemPending = (item.pending || []).filter(value => value.type !== '来源' && value.type !== '资料').map(value => value.reason);
    result.set(record.runeKey, {
      explicitScopeExclusion: false,
      sourcePending,
      systemPending,
      configurationComplete: false,
      samples: [...sourcePending, ...systemPending].slice(0, 3)
    });
  }
  return result;
}

function conclusionFor(item) {
  if (item.basis.explicitScopeExclusion) return '明确排除';
  if (item.basis.configurationComplete) return '已录入';
  if (item.basis.sourcePending.length > 0) return '资料待核';
  return '系统暂缓';
}

function reasonFor(item, conclusion) {
  if (conclusion === '明确排除') return '第六批最终范围清单已有具体1V1范围排除依据；当前主体保留，但不创建符文技能挂载。';
  if (conclusion === '已录入') return '固定自身属性的完整参数、常驻效果和来源初始化规则已保存；当前详情、挂载和代表图与已验收候选一致。';
  if (conclusion === '资料待核') return `仍有${item.basis.sourcePending.length}项来源数值、等级算法、适应选择或版本事实缺口，不能猜值补齐。`;
  return `来源确定组成已保存或可表达；仍有${Math.max(1, item.basis.systemPending.length)}项事件、条件、状态、选择或作用范围缺口。`;
}

function distribution(entries) {
  return Object.fromEntries(['已录入', '明确排除', '资料待核', '系统暂缓'].map(key => [key, entries.filter(item => item.conclusion === key).length]));
}

async function runReadback() {
  if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');
  if (fs.existsSync(outputPath)) throw new Error('符文清单当前回读证据.json 已存在，拒绝覆盖。');
  const records = sourceRecords();
  const basis = sourceBasis(records);
  const requestLog = [];
  async function get(relativePath) {
    const response = await fetch(baseUrl + relativePath, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000)
    });
    requestLog.push({ method: 'GET', path: relativePath, status: response.status });
    assert.equal(response.status, 200, relativePath + ' 非200');
    return response.json();
  }

  const runeDocument = await get('/runes');
  const skillDocument = await get('/skills');
  assert.equal(runeDocument.total, 69);
  assert.equal(runeDocument.items.length, 69);
  assert.equal(skillDocument.total, 1062);
  assert.equal(skillDocument.items.length, 1062);
  const currentRunes = new Map(runeDocument.items.map(item => [item.runeKey, item]));
  const currentSkills = new Map(skillDocument.items.map(item => [item.skillKey, item]));

  const mappings = await mapLimit(records, 8, async record => {
    const rune = currentRunes.get(record.runeKey);
    assert(rune, '当前符文缺失：' + record.runeKey);
    assert.equal(rune.name, record.name, '当前符文名称不符：' + record.runeKey);
    assert.equal(rune.category, record.category, '当前符文类别不符：' + record.runeKey);
    const relationDocument = await get('/rune-skill-relations?runeKey=' + encodeURIComponent(record.runeKey));
    const runeImage = await get('/runes/' + encodeURIComponent(record.runeKey) + '/representative-image');
    assert.equal(typeof runeImage.image?.imageKey, 'string', '符文代表图键缺失：' + record.runeKey);
    assert(runeImage.image.imageKey.trim(), '符文代表图键为空：' + record.runeKey);
    assert.equal(runeImage.image?.enabled, true, '符文代表图未启用：' + record.runeKey);
    const itemBasis = basis.get(record.runeKey);
    const expectedRelations = itemBasis.explicitScopeExclusion ? 0 : 1;
    assert.equal(relationDocument.total, expectedRelations, '符文挂载数不符：' + record.runeKey);
    assert.equal(relationDocument.items.length, expectedRelations, '符文挂载数组不符：' + record.runeKey);
    let relation = null;
    let skillImage = null;
    if (expectedRelations === 1) {
      relation = relationDocument.items[0];
      const expectedSkillKey = record.runeKey + '_passive';
      assert.equal(relation.skillKey, expectedSkillKey, '符文技能键不符：' + record.runeKey);
      assert.equal(relation.skillStatus, 'ENABLED', '符文技能未启用：' + record.runeKey);
      assert(currentSkills.has(expectedSkillKey), '技能目录缺少：' + expectedSkillKey);
      const imageDocument = await get('/skills/' + encodeURIComponent(expectedSkillKey) + '/representative-image');
      assert.equal(imageDocument.image?.imageKey, runeImage.image.imageKey, '符文与技能未复用同一代表图：' + expectedSkillKey);
      assert.equal(imageDocument.image?.enabled, true, '符文技能代表图未启用：' + expectedSkillKey);
      skillImage = imageDocument.image.imageKey;
    }
    return {
      ...record,
      current: { name: rune.name, category: rune.category },
      relation: relation ? { skillKey: relation.skillKey, skillStatus: relation.skillStatus, sortOrder: relation.sortOrder } : null,
      images: { rune: runeImage.image.imageKey, skill: skillImage },
      basis: itemBasis
    };
  });

  const completeChecks = [
    { runeId: 5005, parameterKey: 'bonus_attack_speed_ratio', value: 0.1, attributeKey: 'bonus_attack_speed_percent' },
    { runeId: 5007, parameterKey: 'ability_haste_bonus', value: 8, attributeKey: 'ability_haste' },
    { runeId: 5011, parameterKey: 'health_bonus', value: 65, attributeKey: 'hp' }
  ];
  for (const check of completeChecks) {
    const skillKey = 'rune_' + check.runeId + '_passive';
    const parameter = await get('/skills/' + skillKey + '/parameters/' + check.parameterKey);
    const effect = await get('/skills/' + skillKey + '/effects/stat_bonus');
    const rule = await get('/skills/' + skillKey + '/trigger-rules/initialize_stat_bonus');
    assert.equal(parameter.valueMode, 'FIXED');
    assert.equal(parameter.fixedValue, check.value);
    assert.equal(effect.results.length, 1);
    assert.equal(effect.results[0].resultType, 'ATTRIBUTE_CHANGE');
    assert.equal(effect.results[0].target, 'SOURCE');
    assert.equal(effect.results[0].detail.attributeKey, check.attributeKey);
    assert.equal(effect.results[0].detail.modifierZoneKey, 'attribute_flat_add');
    assert.equal(rule.eventSource.eventType, 'SOURCE_INITIALIZED');
    assert.equal(rule.actions.length, 1);
    assert.equal(rule.actions[0].detail.effectKey, 'stat_bonus');
  }

  assert.equal(mappings.filter(item => item.relation).length, 60);
  assert.equal(mappings.filter(item => !item.relation).length, 9);
  assert.equal(requestLog.length, 209);
  assert(requestLog.every(item => item.method === 'GET' && item.status === 200));
  const provisionalEntries = mappings.map(item => ({ ...item, conclusion: conclusionFor(item) }));
  assert.deepEqual(distribution(provisionalEntries), { '已录入': 3, '明确排除': 9, '资料待核': 34, '系统暂缓': 23 });
  const evidence = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    methodPolicy: 'GET_ONLY',
    authorizationValueRecorded: false,
    businessWrites: 0,
    getCount: requestLog.length,
    statusCounts: { 200: requestLog.length },
    source: {
      version: '16.17.1',
      inventorySha256: fileSha(sourcePath),
      mechanismSha256: fileSha(mechanismPath),
      finalCoverageSha256: fileSha(finalCoveragePath),
      firstShardCandidateSha256: fileSha(firstShardPath),
      lastShardCandidateSha256: fileSha(lastShardPath)
    },
    current: {
      runeCount: runeDocument.total,
      skillCount: skillDocument.total,
      mountedRuneSkills: 60,
      explicitExclusions: 9,
      runeImages: 69,
      skillImages: 60,
      completeStaticShardDetails: 9
    },
    expectedDistribution: distribution(provisionalEntries),
    priorFailedReadOnlyAttempt: {
      outcome: '在图片键同名假设处停止；未生成证据文件',
      correction: '改为核对符文与其技能复用同一张启用图片，不要求图片资源键等于符文键',
      businessWrites: 0,
      evidenceFileWritten: false,
      exactCompletedGetCountRecorded: false
    },
    mappings,
    requestAudit: {
      methods: { GET: requestLog.length },
      statuses: { 200: requestLog.length },
      pathsSha256: shaBytes(JSON.stringify(requestLog.map(item => item.path)))
    },
    boundary: '69项均有当前主体、挂载或具体排除及代表图证据；3项固定属性碎片达到完整静态配置，34项资料待核和23项系统暂缓仍是开放队列。未执行业务写入、Wasm、宿主或真实战斗。'
  };
  fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: evidence.status, getCount: evidence.getCount, current: evidence.current, conclusions: evidence.expectedDistribution, businessWrites: 0 }, null, 2));
}

function entriesFromEvidence(evidence) {
  return evidence.mappings.map(item => {
    const conclusion = conclusionFor(item);
    return {
      sourceRuneId: item.runeId,
      runeKey: item.runeKey,
      name: item.name,
      category: item.category,
      conclusion,
      conclusionScope: '符文范围内数据与机制',
      reason: reasonFor(item, conclusion),
      sourcePendingCount: item.basis.sourcePending.length,
      systemPendingCount: item.basis.systemPending.length,
      evidenceRefs: ['runeCurrentReadback', 'runeMechanismInventory', 'runeFinalCoverage']
    };
  }).sort((left, right) => left.sourceRuneId - right.sourceRuneId);
}

function runIntegrate() {
  const evidence = readJson(outputPath);
  const stage = readJson(stagePath);
  assert(stage.inventoryConclusions);
  assert(!stage.inventoryConclusions.runes, '符文逐项结论已存在，拒绝覆盖。');
  const entries = entriesFromEvidence(evidence);
  assert.equal(entries.length, 69);
  assert.equal(new Set(entries.map(item => item.runeKey)).size, 69);
  const conclusions = distribution(entries);
  assert.deepEqual(conclusions, evidence.expectedDistribution);
  stage.generatedAt = evidence.capturedAt;
  stage.inventoryConclusions.status = '进行中：角色主体、英雄技能和符文均已逐项覆盖；技能与符文开放结论及全部装备仍需继续处理。';
  stage.inventoryConclusions.evidence.runeCurrentReadback = {
    relativePath: '数据参考/全量录入-2026-09/全量清单收敛/符文清单当前回读证据.json',
    sha256: fileSha(outputPath),
    getCount: evidence.getCount,
    businessWrites: evidence.businessWrites
  };
  stage.inventoryConclusions.evidence.runeMechanismInventory = {
    relativePath: '数据参考/全量录入-2026-09/API实录/符文机制盘点/逐项机器清单.json',
    sha256: evidence.source.mechanismSha256
  };
  stage.inventoryConclusions.evidence.runeFinalCoverage = {
    relativePath: '数据参考/全量录入-2026-09/API实录/符文效果第六批/当前实录状态.json',
    sha256: evidence.source.finalCoverageSha256
  };
  stage.inventoryConclusions.coverage.runes = {
    sourceItems: 69,
    concludedItems: 69,
    conclusions,
    mountedInScopeItems: 60,
    explicitExclusions: 9,
    remainingInScopeItems: 0,
    openQueueItems: conclusions['资料待核'] + conclusions['系统暂缓'],
    status: 'FULL_COVERAGE_WITH_OPEN_QUEUE'
  };
  stage.inventoryConclusions.runes = entries;
  fs.writeFileSync(stagePath, JSON.stringify(stage, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({ status: stage.inventoryConclusions.status, generatedAt: stage.generatedAt, runeCoverage: stage.inventoryConclusions.coverage.runes }, null, 2));
}

function runCheckStage() {
  const evidence = readJson(outputPath);
  const stage = readJson(stagePath);
  const ledger = stage.inventoryConclusions;
  assert.equal(ledger.runes.length, 69);
  assert.equal(new Set(ledger.runes.map(item => item.runeKey)).size, 69);
  assert.deepEqual(ledger.runes, entriesFromEvidence(evidence));
  assert.equal(ledger.coverage.runes.sourceItems, 69);
  assert.equal(ledger.coverage.runes.concludedItems, 69);
  assert.equal(ledger.coverage.runes.remainingInScopeItems, 0);
  assert.equal(ledger.coverage.runes.openQueueItems, 57);
  assert.equal(ledger.coverage.runes.status, 'FULL_COVERAGE_WITH_OPEN_QUEUE');
  assert.deepEqual(ledger.coverage.runes.conclusions, distribution(ledger.runes));
  assert.equal(ledger.evidence.runeCurrentReadback.sha256, fileSha(outputPath));
  assert.equal(ledger.evidence.runeMechanismInventory.sha256, fileSha(mechanismPath));
  assert.equal(ledger.evidence.runeFinalCoverage.sha256, fileSha(finalCoveragePath));
  process.stdout.write(JSON.stringify({ status: 'PASS', runeItems: ledger.runes.length, conclusions: ledger.coverage.runes.conclusions, openQueueItems: ledger.coverage.runes.openQueueItems, evidenceSha256: fileSha(outputPath) }, null, 2));
}

if (mode === 'readback') await runReadback();
else if (mode === 'integrate') runIntegrate();
else runCheckStage();
