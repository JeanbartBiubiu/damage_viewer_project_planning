import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['readback', 'integrate', 'check-stage'].includes(mode)) throw new Error('用法：node 核对技能清单第一阶段.mjs readback|integrate|check-stage');
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const stagePath = path.join(here, '..', '阶段进度.json');
const heroInventoryPath = path.join(repoRoot, '数据参考', '全量录入-2026-09', '英雄', '英雄资料清单.json');
const characterEvidencePath = path.join(here, '角色清单当前回读证据.json');
const outputPath = path.join(here, '技能清单第一阶段当前证据.json');
const webRoot = String(process.env.DAMAGE_WEB_ROOT || '').trim();
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const shaBytes = value => crypto.createHash('sha256').update(value).digest('hex');
const fileSha = file => shaBytes(fs.readFileSync(file));
const slotOrder = ['P', 'Q', 'W', 'E', 'R'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function walkCandidateFiles(root) {
  const result = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(child);
      else if (entry.isFile() && entry.name === '完整候选.json') result.push(child);
    }
  }
  return result.sort();
}

function candidateHashForBatch(batch) {
  if (batch.candidateSha256) return batch.candidateSha256;
  const relativePath = batch.evidence?.relativePath;
  if (!relativePath) return null;
  const evidenceFile = path.join(webRoot, ...relativePath.split('/'));
  if (!fs.existsSync(evidenceFile)) return null;
  try {
    const document = readJson(evidenceFile);
    return document.candidateFileSha256 || document.candidateSha256 || null;
  } catch {
    return null;
  }
}

function pendingKind(value) {
  if (value && typeof value === 'object' && typeof value.kind === 'string') {
    if (value.kind === '来源') return 'source';
    if (value.kind === '系统') return 'system';
    if (value.kind === '配置') return 'configuration';
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (/来源|资料|待核|未知|未证|冲突|缺值|插值|算法/.test(text)) return 'source';
  if (/系统|事件|状态|时序|运行|宿主|条件|目标|接线|过程/.test(text)) return 'system';
  return 'other';
}

function pendingText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return String(value);
  return [value.component, value.reason].filter(Boolean).join('：') || JSON.stringify(value);
}

function writeCounts(skill) {
  return Object.fromEntries(['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'].map(key => [key, Array.isArray(skill.write?.[key]) ? skill.write[key].length : 0]));
}

function sourceSlotMap(characterEvidence) {
  const result = new Map();
  for (const mapping of characterEvidence.mappings) {
    assert.equal(mapping.skillKeys.length, 5, mapping.sourceChampionId + ' 技能关系不是5项');
    mapping.skillKeys.forEach((skillKey, index) => {
      assert(!result.has(skillKey), '技能映射重复：' + skillKey);
      result.set(skillKey, { sourceChampionId: mapping.sourceChampionId, sourceNumericId: mapping.sourceNumericId, championName: mapping.name, slot: slotOrder[index] });
    });
  }
  return result;
}

async function runReadback() {
  if (!webRoot) throw new Error('缺少 DAMAGE_WEB_ROOT');
  if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');
  if (fs.existsSync(outputPath)) throw new Error('技能清单第一阶段当前证据.json 已存在，拒绝覆盖。');
  const stage = readJson(stagePath);
  const heroInventory = readJson(heroInventoryPath);
  const characterEvidence = readJson(characterEvidencePath);
  assert.equal(characterEvidence.status, 'PASS');
  const slotMap = sourceSlotMap(characterEvidence);
  const candidateRoot = path.join(webRoot, '数据参考', '全量录入-2026-09', '交叉试录');
  const candidateFiles = walkCandidateFiles(candidateRoot);
  const filesBySha = new Map();
  for (const file of candidateFiles) {
    const hash = fileSha(file);
    if (!filesBySha.has(hash)) filesBySha.set(hash, []);
    filesBySha.get(hash).push(file);
  }

  const matchedBatches = [];
  const unmatchedBatches = [];
  const skillEvidence = [];
  for (const [batchKey, batch] of Object.entries(stage.mechanismBatches)) {
    if (!/^hero.*Batch$/i.test(batchKey) || !Array.isArray(batch.skills)) continue;
    const candidateSha256 = candidateHashForBatch(batch);
    const candidates = candidateSha256 ? filesBySha.get(candidateSha256) || [] : [];
    if (candidates.length === 0) {
      unmatchedBatches.push({ batchKey, skillCount: batch.skills.length, candidateSha256 });
      continue;
    }
    const candidateFile = candidates[0];
    const candidate = readJson(candidateFile);
    const relativeCandidatePath = path.relative(webRoot, candidateFile).split(path.sep).join('/');
    matchedBatches.push({ batchKey, skillCount: batch.skills.length, candidateSha256, relativeCandidatePath, duplicateByteCopies: candidates.length });
    for (const skillKey of batch.skills) {
      const skill = candidate.skills?.[skillKey];
      assert(skill, batchKey + ' 候选缺少 ' + skillKey);
      const slot = slotMap.get(skillKey);
      assert(slot, '角色来源槽位映射缺少 ' + skillKey);
      const pending = Array.isArray(skill.pending) ? skill.pending : [];
      const excluded = Array.isArray(skill.excluded) ? skill.excluded : [];
      const counts = { source: 0, system: 0, configuration: 0, other: 0 };
      for (const item of pending) counts[pendingKind(item)] += 1;
      const writes = writeCounts(skill);
      skillEvidence.push({
        ...slot,
        skillKey,
        candidateName: skill.name || null,
        batchKey,
        candidatePath: relativeCandidatePath,
        candidateSha256,
        writeCounts: writes,
        pendingCounts: counts,
        pendingCount: pending.length,
        pendingSamples: pending.slice(0, 3).map(pendingText),
        excludedCount: excluded.length,
        excludedSamples: excluded.slice(0, 3).map(pendingText),
        fullExclusionCandidate: pending.length === 0 && Object.values(writes).every(value => value === 0) && excluded.length > 0
      });
    }
  }
  assert.equal(matchedBatches.length, 31, '已唯一定位候选批次数变化');
  assert.equal(unmatchedBatches.length, 17, '未定位候选批次数变化');
  assert.equal(skillEvidence.length, 550, '第一阶段技能证据数不符');
  assert.equal(new Set(skillEvidence.map(item => item.skillKey)).size, 550, '第一阶段技能键重复');

  let getCount = 0;
  const response = await fetch(baseUrl + '/skills', {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000)
  });
  getCount += 1;
  assert.equal(response.status, 200, '技能目录GET非200');
  const skillDocument = await response.json();
  const currentSkills = Array.isArray(skillDocument) ? skillDocument : skillDocument.items;
  assert.equal(currentSkills.length, 1062, '当前技能总数不符');
  if (typeof skillDocument.total === 'number') assert.equal(skillDocument.total, 1062, '技能目录 total 不符');
  const currentByKey = new Map(currentSkills.map(item => [item.skillKey, item]));
  for (const item of skillEvidence) {
    const current = currentByKey.get(item.skillKey);
    assert(current, '当前技能目录缺少 ' + item.skillKey);
    item.current = {
      name: current.name,
      status: current.status,
      maxLevel: current.maxLevel,
      skillCategoryKeys: current.skillCategoryKeys
    };
  }

  const excludedChampions = heroInventory.champions.filter(item => item.entryStatus === '约定排除');
  const evidence = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    methodPolicy: 'GET_ONLY',
    authorizationValueRecorded: false,
    businessWrites: 0,
    getCount,
    statusCounts: { 200: 1 },
    source: {
      heroInventorySha256: fileSha(heroInventoryPath),
      characterEvidenceSha256: fileSha(characterEvidencePath),
      sourceSkillSlots: heroInventory.statistics.sourceSkillSlotCount,
      inScopeSkillSlots: heroInventory.statistics.inScopeSkillSlotCount,
      excludedChampionSkillSlots: excludedChampions.reduce((sum, item) => sum + item.skills.length, 0)
    },
    current: {
      skillCount: currentSkills.length,
      candidateFilesScanned: candidateFiles.length,
      matchedBatches: matchedBatches.length,
      unmatchedBatches: unmatchedBatches.length,
      matchedSkills: skillEvidence.length,
      matchedCurrentSkills: skillEvidence.filter(item => item.current).length
    },
    matchedBatches,
    unmatchedBatches,
    excludedChampionSlots: excludedChampions.flatMap(champion => champion.skills.map(skill => ({
      sourceChampionId: champion.sourceChampionId,
      sourceNumericId: champion.sourceNumericId,
      championName: champion.chineseChampionName || champion.title,
      slot: skill.slot,
      name: skill.name,
      exclusionReason: champion.exclusionReason
    }))),
    skills: skillEvidence.sort((left, right) => left.sourceChampionId.localeCompare(right.sourceChampionId) || slotOrder.indexOf(left.slot) - slotOrder.indexOf(right.slot)),
    differences: [],
    boundary: '第一阶段只收敛31个可用批准候选散列定位的批次和两个排除角色技能槽；其余305个范围内技能仍未收敛。当前单次技能目录GET不代替各批既有组成详情回读，也不证明Wasm、宿主或战斗运行。'
  };
  assert.equal(evidence.excludedChampionSlots.length, 10);
  fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: evidence.status, getCount, currentSkills: evidence.current.skillCount, candidateFiles: evidence.current.candidateFilesScanned, matchedBatches: evidence.current.matchedBatches, matchedSkills: evidence.current.matchedSkills, excludedChampionSlots: evidence.excludedChampionSlots.length, remainingInScopeSkills: 855 - evidence.current.matchedSkills, businessWrites: 0 }, null, 2));
}

function conclusionForEvidence(item) {
  if (item.fullExclusionCandidate) return '明确排除';
  if (item.pendingCounts.source > 0) return '资料待核';
  return '系统暂缓';
}

function reasonForEvidence(item, conclusion) {
  if (conclusion === '明确排除') return '当前候选没有范围内保存组成或待处理分支，全部已识别内容均有具体范围排除依据：' + item.excludedSamples.join('；');
  if (conclusion === '资料待核') return `已保存明确组成；仍有${item.pendingCount}个待处理分支，其中来源或资料缺口${item.pendingCounts.source}个、系统缺口${item.pendingCounts.system}个、配置缺口${item.pendingCounts.configuration}个。`;
  if (item.pendingCount > 0) return `已保存明确组成；仍有${item.pendingCount}个待处理分支，主要属于事件、状态、时序或配置接线，不能用近似规则补齐。`;
  return '候选已保存参数、公式或效果，但没有完整可执行入口；继续按系统接线缺口处理，不能把组成存在等同于技能完成。';
}

function buildSkillEntries(evidence) {
  const entries = evidence.skills.map(item => {
    const conclusion = conclusionForEvidence(item);
    return {
      sourceChampionId: item.sourceChampionId,
      sourceNumericId: item.sourceNumericId,
      championName: item.championName,
      slot: item.slot,
      skillKey: item.skillKey,
      name: item.current.name,
      conclusion,
      conclusionScope: '技能范围内数据与机制',
      reason: reasonForEvidence(item, conclusion),
      pendingCounts: item.pendingCounts,
      batchKey: item.batchKey,
      candidateSha256: item.candidateSha256,
      evidenceRefs: ['skillFirstStageCurrentReadback', 'heroSourceInventory']
    };
  });
  for (const item of evidence.excludedChampionSlots) {
    entries.push({
      sourceChampionId: item.sourceChampionId,
      sourceNumericId: item.sourceNumericId,
      championName: item.championName,
      slot: item.slot,
      skillKey: null,
      name: item.name,
      conclusion: '明确排除',
      conclusionScope: '完整技能槽',
      reason: item.exclusionReason,
      pendingCounts: { source: 0, system: 0, configuration: 0, other: 0 },
      batchKey: null,
      candidateSha256: null,
      evidenceRefs: ['heroSourceInventory']
    });
  }
  return entries.sort((left, right) => left.sourceChampionId.localeCompare(right.sourceChampionId) || slotOrder.indexOf(left.slot) - slotOrder.indexOf(right.slot));
}

function distribution(entries) {
  return Object.fromEntries(['已录入', '明确排除', '资料待核', '系统暂缓'].map(key => [key, entries.filter(item => item.conclusion === key).length]));
}

function runIntegrate() {
  const evidence = readJson(outputPath);
  const stage = readJson(stagePath);
  assert.equal(evidence.status, 'PASS');
  assert.equal(evidence.businessWrites, 0);
  assert.equal(evidence.current.matchedSkills, 550);
  assert.equal(stage.inventoryConclusions.coverage.characters.concludedItems, 173, '角色收敛结果缺失');
  const entries = buildSkillEntries(evidence);
  assert.equal(entries.length, 560);
  assert.equal(new Set(entries.map(item => item.sourceChampionId + '/' + item.slot)).size, 560);
  const conclusions = distribution(entries);
  stage.generatedAt = evidence.capturedAt;
  stage.inventoryConclusions.status = '进行中：角色主体层173项完成；技能第一阶段已收敛560/865项，仍有305个范围内技能及全部装备、符文待收敛。';
  stage.inventoryConclusions.evidence.skillFirstStageCurrentReadback = {
    relativePath: '数据参考/全量录入-2026-09/全量清单收敛/技能清单第一阶段当前证据.json',
    sha256: fileSha(outputPath),
    getCount: evidence.getCount,
    businessWrites: evidence.businessWrites,
    matchedCandidateBatches: evidence.current.matchedBatches
  };
  stage.inventoryConclusions.coverage.skills = {
    sourceItems: 865,
    concludedItems: entries.length,
    conclusions,
    matchedInScopeItems: evidence.current.matchedSkills,
    excludedChampionSlots: evidence.excludedChampionSlots.length,
    remainingInScopeItems: 855 - evidence.current.matchedSkills,
    status: 'PARTIAL_RECONCILIATION'
  };
  stage.inventoryConclusions.skills = entries;
  fs.writeFileSync(stagePath, JSON.stringify(stage, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({ status: stage.inventoryConclusions.status, generatedAt: stage.generatedAt, skillCoverage: stage.inventoryConclusions.coverage.skills }, null, 2));
}

function runCheckStage() {
  const evidence = readJson(outputPath);
  const stage = readJson(stagePath);
  const ledger = stage.inventoryConclusions;
  const expectedEntries = buildSkillEntries(evidence);
  assert(ledger.skills.length >= 560, '阶段进度技能结论少于第一阶段覆盖');
  assert.equal(new Set(ledger.skills.map(item => item.sourceChampionId + '/' + item.slot)).size, ledger.skills.length);
  const currentById = new Map(ledger.skills.map(item => [item.sourceChampionId + '/' + item.slot, item]));
  for (const expected of expectedEntries) {
    const id = expected.sourceChampionId + '/' + expected.slot;
    const actual = currentById.get(id);
    assert(actual, '第一阶段技能结论缺失：' + id);
    for (const field of ['sourceChampionId', 'sourceNumericId', 'championName', 'slot', 'skillKey', 'name', 'conclusionScope', 'batchKey', 'candidateSha256']) {
      assert.deepEqual(actual[field], expected[field], '第一阶段稳定字段不一致：' + id + '/' + field);
    }
    for (const evidenceRef of expected.evidenceRefs) assert(actual.evidenceRefs.includes(evidenceRef), '第一阶段证据引用丢失：' + id + '/' + evidenceRef);
  }
  assert.equal(ledger.coverage.skills.sourceItems, 865);
  assert(ledger.coverage.skills.concludedItems >= 560);
  assert(ledger.coverage.skills.remainingInScopeItems <= 305);
  assert.equal(
    ledger.coverage.skills.status,
    ledger.coverage.skills.remainingInScopeItems === 0 ? 'FULL_COVERAGE_WITH_OPEN_QUEUE' : 'PARTIAL_RECONCILIATION'
  );
  assert.equal(ledger.evidence.skillFirstStageCurrentReadback.sha256, fileSha(outputPath));
  assert(ledger.skills.every(item => ledger.allowedConclusions.includes(item.conclusion)), '技能结论含非法枚举');
  process.stdout.write(JSON.stringify({ status: 'PASS', phaseItemsVerified: expectedEntries.length, currentSkillItems: ledger.skills.length, currentConclusions: ledger.coverage.skills.conclusions, remainingInScopeItems: ledger.coverage.skills.remainingInScopeItems, evidenceSha256: fileSha(outputPath) }, null, 2));
}

if (mode === 'readback') await runReadback();
else if (mode === 'integrate') runIntegrate();
else runCheckStage();
