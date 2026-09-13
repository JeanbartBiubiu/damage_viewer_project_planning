import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['readback', 'integrate', 'check-stage'].includes(mode)) throw new Error('用法：node 核对角色清单.mjs readback|integrate|check-stage');
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const inventoryPath = path.join(repoRoot, '数据参考', '全量录入-2026-09', '英雄', '英雄资料清单.json');
const stagePath = path.join(here, '..', '阶段进度.json');
const evidencePath = path.join(here, '角色清单当前回读证据.json');
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
const shaBytes = value => crypto.createHash('sha256').update(value).digest('hex');
const stable = value => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
    : value;
const shaValue = value => shaBytes(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
const fileSha = file => shaBytes(fs.readFileSync(file));

function sourceName(champion) {
  return champion.chineseChampionName || champion.title;
}

async function runReadback() {
  if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');
  if (fs.existsSync(evidencePath)) throw new Error('角色清单当前回读证据.json 已存在，拒绝覆盖。');
  let getCount = 0;
  const statusCounts = {};
  async function get(route) {
    getCount += 1;
    const response = await fetch(baseUrl + route, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000)
    });
    statusCounts[response.status] = (statusCounts[response.status] || 0) + 1;
    const raw = await response.text();
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch { data = { parseError: true, responseBytes: Buffer.byteLength(raw) }; }
    }
    assert.equal(response.status, 200, route + ' 预期200，实际' + response.status);
    return data;
  }
  async function mapConcurrent(values, callback, concurrency = 16) {
    const results = new Array(values.length);
    let cursor = 0;
    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= values.length) return;
        results[index] = await callback(values[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length || 1) }, () => worker()));
    return results;
  }

  const inventoryDocument = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const inventory = inventoryDocument.champions;
  assert.equal(inventory.length, 173, '来源角色数不符');
  const inScope = inventory.filter(item => item.entryStatus !== '约定排除');
  const excluded = inventory.filter(item => item.entryStatus === '约定排除');
  assert.equal(inScope.length, 171, '范围内角色数不符');
  assert.deepEqual(excluded.map(item => item.sourceChampionId).sort(), ['Aphelios', 'Sylas']);

  const listResponse = await get('/characters');
  const liveList = Array.isArray(listResponse) ? listResponse : listResponse.items;
  assert.equal(liveList.length, 171, '当前角色目录数不符');
  if (typeof listResponse.total === 'number') assert.equal(listResponse.total, 171, '角色目录 total 不符');
  const liveByName = new Map();
  for (const item of liveList) {
    assert(!liveByName.has(item.name), '当前角色名称重复：' + item.name);
    liveByName.set(item.name, item);
  }

  const levelKeys = Array.from({ length: 18 }, (_, index) => String(index + 1));
  const mappings = await mapConcurrent(inScope, async source => {
    const name = sourceName(source);
    const summary = liveByName.get(name);
    assert(summary, '当前角色目录缺少：' + name);
    const key = summary.characterKey;
    const encodedKey = encodeURIComponent(key);
    const [detail, attributes, representativeImage, relationResponse] = await Promise.all([
      get('/characters/' + encodedKey),
      get('/characters/' + encodedKey + '/attributes'),
      get('/characters/' + encodedKey + '/representative-image'),
      get('/character-skill-relations?characterKey=' + encodedKey)
    ]);
    assert.equal(detail.characterKey, key, name + ' 详情标识不符');
    assert.equal(detail.name, name, name + ' 详情名称不符');
    assert.equal(attributes.characterKey, key, name + ' 属性标识不符');
    assert.equal(attributes.minLevel, 1, name + ' 最低等级不符');
    assert.equal(attributes.maxLevel, 18, name + ' 最高等级不符');
    assert.deepEqual(Object.keys(attributes.levelValues).sort((a, b) => Number(a) - Number(b)), levelKeys, name + ' 等级键不完整');
    const attributeKeys = new Set();
    for (const level of levelKeys) {
      const values = attributes.levelValues[level];
      assert(values && typeof values === 'object' && !Array.isArray(values), name + ' 等级属性不是对象：' + level);
      assert(Object.keys(values).length > 0, name + ' 等级属性为空：' + level);
      for (const [attributeKey, value] of Object.entries(values)) {
        assert.equal(typeof value, 'number', name + ' 属性不是数值：' + attributeKey);
        assert(Number.isFinite(value), name + ' 属性不是有限数：' + attributeKey);
        attributeKeys.add(attributeKey);
      }
    }
    assert.equal(representativeImage?.image?.enabled, true, name + ' 代表图未启用');
    const relations = Array.isArray(relationResponse) ? relationResponse : relationResponse.items;
    assert.equal(relations.length, 5, name + ' 角色技能关系不是5项');
    if (typeof relationResponse.total === 'number') assert.equal(relationResponse.total, 5, name + ' 关系 total 不符');
    const skillKeys = relations.map(item => item.skillKey);
    assert.equal(new Set(skillKeys).size, 5, name + ' 技能关系标识重复');
    const sortOrders = relations.map(item => item.sortOrder);
    assert(sortOrders.every(value => Number.isInteger(value)), name + ' 技能关系顺序不是整数');
    assert.equal(new Set(sortOrders).size, 5, name + ' 技能关系顺序重复');
    assert(sortOrders.every((value, index) => index === 0 || sortOrders[index - 1] < value), name + ' 技能关系未严格递增');
    assert(relations.every(item => item.characterKey === key && item.skillStatus === 'ENABLED'), name + ' 技能关系主体或状态不符');
    return {
      sourceChampionId: source.sourceChampionId,
      sourceNumericId: source.sourceNumericId,
      name,
      characterKey: key,
      levelCount: levelKeys.length,
      attributeKeys: [...attributeKeys].sort(),
      skillKeys,
      representativeImageKey: representativeImage.image.imageKey,
      hashes: {
        detail: shaValue(detail),
        attributes: shaValue(attributes),
        relations: shaValue(relations),
        representativeImage: shaValue(representativeImage)
      }
    };
  });
  assert.equal(new Set(mappings.map(item => item.characterKey)).size, 171, '来源角色映射到重复当前角色');
  assert.equal(mappings.every(item => liveByName.has(item.name)), true, '来源与当前角色映射不完整');
  const evidence = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    methodPolicy: 'GET_ONLY',
    authorizationValueRecorded: false,
    businessWrites: 0,
    getCount,
    statusCounts,
    source: {
      relativePath: '数据参考/全量录入-2026-09/英雄/英雄资料清单.json',
      sha256: fileSha(inventoryPath),
      championCount: inventory.length,
      inScopeCount: inScope.length,
      excludedCount: excluded.length,
      sourceSkillSlotCount: inventoryDocument.statistics.sourceSkillSlotCount,
      inScopeSkillSlotCount: inventoryDocument.statistics.inScopeSkillSlotCount
    },
    current: {
      characterCount: liveList.length,
      uniqueMappingCount: mappings.length,
      characterDetailGETs: mappings.length,
      attributeGETs: mappings.length,
      representativeImageGETs: mappings.length,
      characterSkillRelationGETs: mappings.length,
      relationCount: mappings.reduce((sum, item) => sum + item.skillKeys.length, 0),
      enabledRepresentativeImageCount: mappings.length,
      completeLevelRangeCount: mappings.length
    },
    excluded: excluded.map(item => ({
      sourceChampionId: item.sourceChampionId,
      sourceNumericId: item.sourceNumericId,
      name: sourceName(item),
      entryStatus: item.entryStatus,
      exclusionReason: item.exclusionReason
    })),
    mappings,
    differences: [],
    readbackAttemptHistory: [
      {
        attempt: 1,
        status: 'GET_ONLY_CHECK_FAILED_BEFORE_OUTPUT',
        reason: '初版错误要求所有角色关系排序必须为0至4；伊泽瑞尔当前合法排序为10、20、30、40、50。修订为五项有限整数、唯一且严格递增。',
        businessWrites: 0,
        exactGetCountPersisted: false
      },
      {
        attempt: 2,
        status: 'PASS',
        getCount,
        businessWrites: 0
      }
    ],
    boundary: '本证据证明角色主体、1至18级属性、五项技能关系和代表图当前可读；技能数据与机制完成度在技能逐项结论中另行收敛，未执行Wasm、宿主或战斗验证。'
  };
  assert.equal(getCount, 685, 'GET 数应为1+171×4');
  assert.deepEqual(statusCounts, { 200: 685 });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: evidence.status, getCount, sourceCharacters: inventory.length, currentCharacters: liveList.length, mapped: mappings.length, excluded: evidence.excluded.map(item => item.sourceChampionId), relations: evidence.current.relationCount, businessWrites: 0 }, null, 2));
}

function runIntegrate() {
  assert(fs.existsSync(evidencePath), '缺少角色清单当前回读证据.json');
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.status, 'PASS', '角色回读证据未通过');
  assert.equal(evidence.businessWrites, 0, '角色回读证据含业务写入');
  assert.equal(evidence.getCount, 685, '角色回读 GET 数不符');
  assert.equal(evidence.mappings.length, 171, '角色映射数不符');
  assert.equal(evidence.excluded.length, 2, '角色排除数不符');
  const stage = JSON.parse(fs.readFileSync(stagePath, 'utf8'));
  const existing = stage.inventoryConclusions || {};
  const characterEntries = [
    ...evidence.mappings.map(item => ({
      sourceChampionId: item.sourceChampionId,
      sourceNumericId: item.sourceNumericId,
      name: item.name,
      characterKey: item.characterKey,
      conclusion: '已录入',
      conclusionScope: '角色主体与基础等级属性',
      reason: '当前主体、完整1至18级属性、五项直接技能关系和启用代表图回读一致；技能组成与机制按技能清单另行结论。',
      evidenceRefs: ['heroSourceInventory', 'characterCurrentReadback']
    })),
    ...evidence.excluded.map(item => ({
      sourceChampionId: item.sourceChampionId,
      sourceNumericId: item.sourceNumericId,
      name: item.name,
      characterKey: null,
      conclusion: '明确排除',
      conclusionScope: '角色主体与完整技能集合',
      reason: item.exclusionReason,
      evidenceRefs: ['heroSourceInventory']
    }))
  ].sort((left, right) => left.sourceChampionId.localeCompare(right.sourceChampionId));
  assert.equal(characterEntries.length, 173);
  assert.equal(new Set(characterEntries.map(item => item.sourceChampionId)).size, 173);
  assert.equal(characterEntries.filter(item => item.conclusion === '已录入').length, 171);
  assert.equal(characterEntries.filter(item => item.conclusion === '明确排除').length, 2);

  stage.generatedAt = evidence.capturedAt;
  stage.inventoryConclusions = {
    schemaVersion: 1,
    status: '进行中：角色主体层已逐项收敛；技能、装备与符文仍需按当前批次证据生成唯一结论。',
    allowedConclusions: ['已录入', '明确排除', '资料待核', '系统暂缓'],
    evidence: {
      ...(existing.evidence || {}),
      heroSourceInventory: {
        relativePath: evidence.source.relativePath,
        sha256: evidence.source.sha256
      },
      characterCurrentReadback: {
        relativePath: '数据参考/全量录入-2026-09/全量清单收敛/角色清单当前回读证据.json',
        sha256: fileSha(evidencePath),
        getCount: evidence.getCount,
        businessWrites: evidence.businessWrites
      }
    },
    coverage: {
      characters: {
        sourceItems: 173,
        concludedItems: 173,
        conclusions: { '已录入': 171, '明确排除': 2, '资料待核': 0, '系统暂缓': 0 },
        status: 'COMPLETE_FOR_CHARACTER_SUBJECT_SCOPE'
      },
      skills: existing.coverage?.skills || { sourceItems: 865, concludedItems: 0, status: 'NOT_RECONCILED' },
      equipment: existing.coverage?.equipment || { sourceItems: 868, concludedItems: 0, status: 'NOT_RECONCILED' },
      runes: existing.coverage?.runes || { sourceItems: 69, concludedItems: 0, status: 'NOT_RECONCILED' }
    },
    characters: characterEntries,
    ...(existing.skills ? { skills: existing.skills } : {}),
    ...(existing.equipment ? { equipment: existing.equipment } : {}),
    ...(existing.runes ? { runes: existing.runes } : {}),
    boundary: '逐项结论按对象层分开；角色主体已录入不等于其五项技能机制完成。只有四类清单全部收敛且未完成队列处理完毕，才能用于整体完成判定。'
  };
  fs.writeFileSync(stagePath, JSON.stringify(stage, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({ status: stage.inventoryConclusions.status, generatedAt: stage.generatedAt, characterCoverage: stage.inventoryConclusions.coverage.characters, remainingGroups: ['skills', 'equipment', 'runes'].filter(key => stage.inventoryConclusions.coverage[key].status === 'NOT_RECONCILED') }, null, 2));
}

function runCheckStage() {
  const inventoryDocument = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const stage = JSON.parse(fs.readFileSync(stagePath, 'utf8'));
  const ledger = stage.inventoryConclusions;
  assert(ledger, '阶段进度缺少 inventoryConclusions');
  assert.deepEqual(ledger.allowedConclusions, ['已录入', '明确排除', '资料待核', '系统暂缓']);
  assert.equal(ledger.coverage.characters.sourceItems, 173);
  assert.equal(ledger.coverage.characters.concludedItems, 173);
  assert.deepEqual(ledger.coverage.characters.conclusions, { '已录入': 171, '明确排除': 2, '资料待核': 0, '系统暂缓': 0 });
  assert.equal(ledger.characters.length, 173);
  assert.equal(new Set(ledger.characters.map(item => item.sourceChampionId)).size, 173, '角色结论来源键重复');
  const bySource = new Map(ledger.characters.map(item => [item.sourceChampionId, item]));
  const mappingBySource = new Map(evidence.mappings.map(item => [item.sourceChampionId, item]));
  for (const source of inventoryDocument.champions) {
    const item = bySource.get(source.sourceChampionId);
    assert(item, '角色结论缺少：' + source.sourceChampionId);
    assert(ledger.allowedConclusions.includes(item.conclusion), '非法结论：' + item.conclusion);
    if (source.entryStatus === '约定排除') {
      assert.equal(item.conclusion, '明确排除', source.sourceChampionId + ' 排除结论不符');
      assert.equal(item.characterKey, null, source.sourceChampionId + ' 排除项不应有当前角色键');
      assert.equal(item.reason, source.exclusionReason, source.sourceChampionId + ' 排除依据不符');
    } else {
      const mapping = mappingBySource.get(source.sourceChampionId);
      assert(mapping, '回读映射缺少：' + source.sourceChampionId);
      assert.equal(item.conclusion, '已录入', source.sourceChampionId + ' 主体结论不符');
      assert.equal(item.characterKey, mapping.characterKey, source.sourceChampionId + ' 当前角色键不符');
      assert.equal(item.name, mapping.name, source.sourceChampionId + ' 名称不符');
    }
  }
  assert.equal(ledger.evidence.heroSourceInventory.sha256, fileSha(inventoryPath), '角色来源清单散列不符');
  assert.equal(ledger.evidence.characterCurrentReadback.sha256, fileSha(evidencePath), '角色回读证据散列不符');
  assert.deepEqual(
    ['skills', 'equipment', 'runes'].map(key => ledger.coverage[key].status),
    ['NOT_RECONCILED', 'NOT_RECONCILED', 'NOT_RECONCILED'],
    '尚未收敛分组状态被提前改变'
  );
  process.stdout.write(JSON.stringify({
    status: 'PASS',
    characterItems: ledger.characters.length,
    conclusions: ledger.coverage.characters.conclusions,
    evidenceSha256: fileSha(evidencePath),
    remainingGroups: ['skills', 'equipment', 'runes']
  }, null, 2));
}

if (mode === 'readback') await runReadback();
else if (mode === 'integrate') runIntegrate();
else runCheckStage();
