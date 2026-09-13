import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['readback', 'integrate', 'check-stage'].includes(mode)) throw new Error('用法：node 核对装备清单.mjs readback|integrate|check-stage');
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const stagePath = path.join(here, '..', '阶段进度.json');
const outputPath = path.join(here, '装备清单当前回读证据.json');
const sourcePath = path.join(repoRoot, '数据参考', '全量录入-2026-09', '装备符文', '装备全量处置清单.json');
const purePath = path.join(repoRoot, '数据参考', '全量录入-2026-09', '装备符文', '纯属性装备可录清单.json');
const reviewPath = path.join(repoRoot, '数据参考', '全量录入-2026-09', '装备效果候选', '逐件审阅.json');
const reviewCoveragePath = path.join(repoRoot, '数据参考', '全量录入-2026-09', '装备效果候选', '来源与覆盖.json');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const shaBytes = value => crypto.createHash('sha256').update(value).digest('hex');
const fileSha = file => shaBytes(fs.readFileSync(file));
const excludedCategories = new Set(['地图11以外', '非玩家或系统占位', '饰品与视野']);

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

function buildSource() {
  const source = readJson(sourcePath);
  assert.equal(source.version, '16.17.1');
  assert.equal(source.items.length, 868);
  const records = source.items.map(item => ({
    itemId: item.itemId,
    sourceEquipmentKey: item.proposedKey,
    currentEquipmentKey: item.existingEquipmentKey || item.proposedKey,
    name: item.name,
    scopeCategory: item.scopeCategory,
    entryStatus: item.entryStatus,
    reason: item.reason
  })).sort((left, right) => Number(left.itemId) - Number(right.itemId));
  assert.equal(new Set(records.map(item => item.itemId)).size, 868);
  assert.equal(new Set(records.map(item => item.sourceEquipmentKey)).size, 868);
  assert.equal(new Set(records.map(item => item.currentEquipmentKey)).size, 868);
  return records;
}

function buildBasis(records) {
  const pure = readJson(purePath);
  const review = readJson(reviewPath);
  const reviewCoverage = readJson(reviewCoveragePath);
  const stage = readJson(stagePath);
  const pureById = new Map(pure.items.map(item => [item.itemId, item]));
  const completeScopeIds = new Set(stage.mechanismBatches.equipmentEleventhBatch.equipment.map(key => key.replace(/^item_/, '')));
  assert.equal(pureById.size, 47);
  assert.equal(Object.keys(review.items).length, 134);
  assert.equal(reviewCoverage.counts.itemsRequiringMoreEvidence, 104);
  assert.equal(reviewCoverage.counts.itemsWithoutExplicitMissingValues, 30);
  assert.equal(completeScopeIds.size, 5);
  assert.equal([...completeScopeIds].some(id => pureById.has(id)), false, '纯属性与完整范围批次不应重叠');
  const result = new Map();
  for (const record of records) {
    if (excludedCategories.has(record.scopeCategory)) {
      result.set(record.itemId, {
        explicitScopeExclusion: true,
        configurationComplete: false,
        sourcePending: [],
        systemPending: [],
        pureExpectedAttributes: null,
        samples: [record.reason]
      });
      continue;
    }
    if (pureById.has(record.itemId)) {
      const item = pureById.get(record.itemId);
      assert.equal(item.requiredSkills.length, 0);
      result.set(record.itemId, {
        explicitScopeExclusion: false,
        configurationComplete: true,
        sourcePending: [],
        systemPending: [],
        pureExpectedAttributes: Object.fromEntries(item.attributes.map(attribute => [
          attribute.existingAttributeKey || attribute.suggestedNewAttributeKey,
          attribute.valueFraction ?? attribute.value
        ])),
        samples: ['固定16.17.1说明只有直接属性，当前值可逐项精确回读']
      });
      continue;
    }
    if (completeScopeIds.has(record.itemId)) {
      result.set(record.itemId, {
        explicitScopeExclusion: false,
        configurationComplete: true,
        sourcePending: [],
        systemPending: [],
        pureExpectedAttributes: null,
        samples: ['第十一批已对范围内直接属性和全部额外效果逐项保存或排除，并完成独立回读与页面核对']
      });
      continue;
    }
    const reviewed = review.items[record.itemId];
    if (reviewed) {
      assert.equal(reviewed.length, 2);
      const sourcePending = reviewed[0] ? [reviewed[0]] : [];
      const systemPending = reviewed[1] ? [reviewed[1]] : [];
      result.set(record.itemId, {
        explicitScopeExclusion: false,
        configurationComplete: false,
        sourcePending,
        systemPending,
        pureExpectedAttributes: null,
        samples: [...sourcePending, ...systemPending].slice(0, 3)
      });
      continue;
    }
    result.set(record.itemId, {
      explicitScopeExclusion: false,
      configurationComplete: false,
      sourcePending: [record.reason],
      systemPending: [],
      pureExpectedAttributes: null,
      samples: [record.reason]
    });
  }
  return { result, completeScopeIds };
}

function conclusionFor(item) {
  if (item.basis.explicitScopeExclusion) return '明确排除';
  if (item.basis.configurationComplete) return '已录入';
  if (item.basis.sourcePending.length > 0) return '资料待核';
  return '系统暂缓';
}

function reasonFor(item, conclusion) {
  if (conclusion === '明确排除') return `当前固定范围明确排除“${item.scopeCategory}”：${item.sourceReason}`;
  if (conclusion === '已录入' && item.basis.pureExpectedAttributes) return '固定来源确认只有直接属性；当前主体、全部属性、零技能挂载和启用代表图一致。';
  if (conclusion === '已录入') return '第十一批已把当前1V1范围内直接属性及额外效果逐项保存或排除；当前主体、零技能挂载和启用代表图仍一致。';
  if (conclusion === '资料待核') return `仍有${item.basis.sourcePending.length}项来源数值、范围、模式、取得方式或机制事实待核，不能猜值或直接排除。`;
  return `来源数值没有明确缺口；仍有${Math.max(1, item.basis.systemPending.length)}项事件、状态、时序或正确结算能力未完成。`;
}

function distribution(entries) {
  return Object.fromEntries(['已录入', '明确排除', '资料待核', '系统暂缓'].map(key => [key, entries.filter(item => item.conclusion === key).length]));
}

async function runReadback() {
  if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');
  if (fs.existsSync(outputPath)) throw new Error('装备清单当前回读证据.json 已存在，拒绝覆盖。');
  const records = buildSource();
  const { result: basis } = buildBasis(records);
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

  const equipmentDocument = await get('/equipment');
  const skillDocument = await get('/skills');
  assert.equal(equipmentDocument.total, 198);
  assert.equal(equipmentDocument.items.length, 198);
  assert.equal(skillDocument.total, 1062);
  assert.equal(skillDocument.items.length, 1062);
  const currentEquipment = new Map(equipmentDocument.items.map(item => [item.equipmentKey, item]));
  const currentSkills = new Set(skillDocument.items.map(item => item.skillKey));
  const sourceByCurrentKey = new Map(records.map(item => [item.currentEquipmentKey, item]));
  assert.deepEqual([...currentEquipment.keys()].filter(key => !sourceByCurrentKey.has(key)), []);
  const currentRecords = records.filter(record => currentEquipment.has(record.currentEquipmentKey));
  assert.equal(currentRecords.length, 198);

  const currentMappings = await mapLimit(currentRecords, 8, async record => {
    const current = currentEquipment.get(record.currentEquipmentKey);
    assert.equal(current.name, record.name, '装备名称不符：' + record.currentEquipmentKey);
    const attributes = await get('/equipment/' + encodeURIComponent(record.currentEquipmentKey) + '/attributes');
    const relations = await get('/equipment-skill-relations?equipmentKey=' + encodeURIComponent(record.currentEquipmentKey));
    const image = await get('/equipment/' + encodeURIComponent(record.currentEquipmentKey) + '/representative-image');
    assert.equal(attributes.equipmentKey, record.currentEquipmentKey);
    assert.equal(relations.total, relations.items.length);
    assert.equal(new Set(relations.items.map(item => item.skillKey)).size, relations.items.length);
    for (const relation of relations.items) {
      assert.equal(relation.equipmentKey, record.currentEquipmentKey);
      assert.equal(relation.skillStatus, 'ENABLED');
      assert(currentSkills.has(relation.skillKey), '技能目录缺少：' + relation.skillKey);
    }
    assert.equal(typeof image.image?.imageKey, 'string', '装备代表图键缺失：' + record.currentEquipmentKey);
    assert(image.image.imageKey.trim(), '装备代表图键为空：' + record.currentEquipmentKey);
    assert.equal(image.image.enabled, true, '装备代表图未启用：' + record.currentEquipmentKey);
    const itemBasis = basis.get(record.itemId);
    if (itemBasis.configurationComplete) assert.equal(relations.total, 0, '已录入整件装备不应残留未核技能挂载：' + record.currentEquipmentKey);
    if (itemBasis.pureExpectedAttributes) assert.deepEqual(attributes.attributeValues, itemBasis.pureExpectedAttributes, '纯属性装备值不符：' + record.currentEquipmentKey);
    return {
      itemId: record.itemId,
      currentEquipmentKey: record.currentEquipmentKey,
      current: { name: current.name, attributeValues: attributes.attributeValues },
      relations: relations.items.map(item => ({ skillKey: item.skillKey, skillStatus: item.skillStatus, sortOrder: item.sortOrder })),
      imageKey: image.image.imageKey
    };
  });

  const currentByItemId = new Map(currentMappings.map(item => [item.itemId, item]));
  const mappings = records.map(record => ({
    itemId: record.itemId,
    sourceEquipmentKey: record.sourceEquipmentKey,
    currentEquipmentKey: currentByItemId.get(record.itemId)?.currentEquipmentKey || null,
    name: record.name,
    scopeCategory: record.scopeCategory,
    entryStatus: record.entryStatus,
    sourceReason: record.reason,
    current: currentByItemId.get(record.itemId)?.current || null,
    relations: currentByItemId.get(record.itemId)?.relations || [],
    imageKey: currentByItemId.get(record.itemId)?.imageKey || null,
    basis: basis.get(record.itemId)
  }));
  const provisionalEntries = mappings.map(item => ({ ...item, conclusion: conclusionFor(item) }));
  const conclusions = distribution(provisionalEntries);
  assert.deepEqual(conclusions, { '已录入': 52, '明确排除': 581, '资料待核': 208, '系统暂缓': 27 });
  assert.equal(requestLog.length, 596);
  assert(requestLog.every(item => item.method === 'GET' && item.status === 200));
  const relationCount = currentMappings.reduce((sum, item) => sum + item.relations.length, 0);
  const evidence = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    methodPolicy: 'GET_ONLY',
    authorizationValueRecorded: false,
    businessWrites: 0,
    getCount: requestLog.length,
    statusCounts: { 200: requestLog.length },
    priorExploration: {
      getCount: 57,
      equipmentListGETs: 4,
      equipmentAttributeGETs: 48,
      equipmentRelationGETs: 5,
      businessWrites: 0,
      purpose: '确认当前总数、历史别名、纯属性值映射和第十一批零挂载；规范回读不复用这些过程内结果。'
    },
    source: {
      version: '16.17.1',
      inventorySha256: fileSha(sourcePath),
      pureAttributeSha256: fileSha(purePath),
      effectReviewSha256: fileSha(reviewPath),
      effectReviewCoverageSha256: fileSha(reviewCoveragePath),
      completeScopeEvidence: '数据参考/全量录入-2026-09/装备技能实录/第十一批范围与轻灵鞋/独立最终回读.json'
    },
    current: {
      sourceItems: records.length,
      equipmentSubjects: equipmentDocument.total,
      matchedSourceSubjects: currentRecords.length,
      skillCount: skillDocument.total,
      equipmentSkillRelations: relationCount,
      equipmentImages: currentMappings.length,
      exactPureAttributeItems: 47,
      completeScopeItems: 5
    },
    expectedDistribution: conclusions,
    mappings,
    requestAudit: {
      methods: { GET: requestLog.length },
      statuses: { 200: requestLog.length },
      pathsSha256: shaBytes(JSON.stringify(requestLog.map(item => item.path)))
    },
    boundary: '868个固定来源条目均有唯一映射依据；52件达到当前1V1数据范围完整，581项有明确范围排除，208项资料待核和27项系统暂缓仍是开放队列。未执行业务写入、Wasm、宿主或真实战斗。'
  };
  fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: evidence.status, getCount: evidence.getCount, current: evidence.current, conclusions: evidence.expectedDistribution, priorExploration: evidence.priorExploration, businessWrites: 0 }, null, 2));
}

function entriesFromEvidence(evidence) {
  return evidence.mappings.map(item => {
    const conclusion = conclusionFor(item);
    return {
      sourceItemId: item.itemId,
      sourceEquipmentKey: item.sourceEquipmentKey,
      currentEquipmentKey: item.currentEquipmentKey,
      name: item.name,
      scopeCategory: item.scopeCategory,
      conclusion,
      conclusionScope: '装备当前1V1数据与机制',
      reason: reasonFor(item, conclusion),
      sourcePendingCount: item.basis.sourcePending.length,
      systemPendingCount: item.basis.systemPending.length,
      evidenceRefs: ['equipmentCurrentReadback', 'equipmentSourceInventory', 'equipmentEffectReview']
    };
  }).sort((left, right) => Number(left.sourceItemId) - Number(right.sourceItemId));
}

function runIntegrate() {
  const evidence = readJson(outputPath);
  const stage = readJson(stagePath);
  assert(stage.inventoryConclusions);
  assert(!stage.inventoryConclusions.equipment, '装备逐项结论已存在，拒绝覆盖。');
  const entries = entriesFromEvidence(evidence);
  assert.equal(entries.length, 868);
  assert.equal(new Set(entries.map(item => item.sourceItemId)).size, 868);
  assert.equal(new Set(entries.map(item => item.sourceEquipmentKey)).size, 868);
  const conclusions = distribution(entries);
  assert.deepEqual(conclusions, evidence.expectedDistribution);
  stage.generatedAt = evidence.capturedAt;
  stage.inventoryConclusions.status = '进行中：角色、英雄技能、装备和符文清单均已逐项覆盖；各类资料待核与系统暂缓队列仍需继续处理。';
  stage.inventoryConclusions.evidence.equipmentCurrentReadback = {
    relativePath: '数据参考/全量录入-2026-09/全量清单收敛/装备清单当前回读证据.json',
    sha256: fileSha(outputPath),
    getCount: evidence.getCount,
    businessWrites: evidence.businessWrites
  };
  stage.inventoryConclusions.evidence.equipmentSourceInventory = {
    relativePath: '数据参考/全量录入-2026-09/装备符文/装备全量处置清单.json',
    sha256: evidence.source.inventorySha256
  };
  stage.inventoryConclusions.evidence.equipmentEffectReview = {
    relativePath: '数据参考/全量录入-2026-09/装备效果候选/逐件审阅.json',
    sha256: evidence.source.effectReviewSha256
  };
  stage.inventoryConclusions.coverage.equipment = {
    sourceItems: 868,
    concludedItems: 868,
    conclusions,
    currentSubjects: evidence.current.equipmentSubjects,
    currentSkillRelations: evidence.current.equipmentSkillRelations,
    explicitExclusions: conclusions['明确排除'],
    remainingInScopeItems: 0,
    openQueueItems: conclusions['资料待核'] + conclusions['系统暂缓'],
    status: 'FULL_COVERAGE_WITH_OPEN_QUEUE'
  };
  stage.inventoryConclusions.equipment = entries;
  fs.writeFileSync(stagePath, JSON.stringify(stage, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({ status: stage.inventoryConclusions.status, generatedAt: stage.generatedAt, equipmentCoverage: stage.inventoryConclusions.coverage.equipment }, null, 2));
}

function runCheckStage() {
  const evidence = readJson(outputPath);
  const stage = readJson(stagePath);
  const ledger = stage.inventoryConclusions;
  assert.equal(ledger.equipment.length, 868);
  assert.equal(new Set(ledger.equipment.map(item => item.sourceItemId)).size, 868);
  assert.equal(new Set(ledger.equipment.map(item => item.sourceEquipmentKey)).size, 868);
  assert.deepEqual(ledger.equipment, entriesFromEvidence(evidence));
  assert.equal(ledger.coverage.equipment.sourceItems, 868);
  assert.equal(ledger.coverage.equipment.concludedItems, 868);
  assert.equal(ledger.coverage.equipment.remainingInScopeItems, 0);
  assert.equal(ledger.coverage.equipment.openQueueItems, 235);
  assert.equal(ledger.coverage.equipment.status, 'FULL_COVERAGE_WITH_OPEN_QUEUE');
  assert.deepEqual(ledger.coverage.equipment.conclusions, distribution(ledger.equipment));
  assert.equal(ledger.evidence.equipmentCurrentReadback.sha256, fileSha(outputPath));
  assert.equal(ledger.evidence.equipmentSourceInventory.sha256, fileSha(sourcePath));
  assert.equal(ledger.evidence.equipmentEffectReview.sha256, fileSha(reviewPath));
  process.stdout.write(JSON.stringify({ status: 'PASS', equipmentItems: ledger.equipment.length, conclusions: ledger.coverage.equipment.conclusions, openQueueItems: ledger.coverage.equipment.openQueueItems, evidenceSha256: fileSha(outputPath) }, null, 2));
}

if (mode === 'readback') await runReadback();
else if (mode === 'integrate') runIntegrate();
else runCheckStage();
