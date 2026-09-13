import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['readback', 'integrate', 'check-stage'].includes(mode)) throw new Error('用法：node 核对技能清单第二阶段.mjs readback|integrate|check-stage');
const here = path.dirname(fileURLToPath(import.meta.url));
const stagePath = path.join(here, '..', '阶段进度.json');
const characterEvidencePath = path.join(here, '角色清单当前回读证据.json');
const firstEvidencePath = path.join(here, '技能清单第一阶段当前证据.json');
const outputPath = path.join(here, '技能清单第二阶段当前证据.json');
const webRoot = String(process.env.DAMAGE_WEB_ROOT || '').trim();
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const slotOrder = ['P', 'Q', 'W', 'E', 'R'];
const shaBytes = value => crypto.createHash('sha256').update(value).digest('hex');
const fileSha = file => shaBytes(fs.readFileSync(file));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function walkNamedCandidates(root) {
  const result = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(child);
      else if (entry.isFile() && entry.name.includes('候选') && entry.name.endsWith('.json')) {
        try {
          const document = readJson(child);
          if (document.skills && !Array.isArray(document.skills) && typeof document.skills === 'object') result.push(child);
        } catch {
          // 非结构化或中断产物不进入候选集合。
        }
      }
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

function itemText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return String(value);
  return [value.component, value.item, value.reason].filter(Boolean).join('：') || JSON.stringify(value);
}

function writeCounts(skill) {
  return Object.fromEntries(['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'].map(key => [key, Array.isArray(skill.write?.[key]) ? skill.write[key].length : 0]));
}

function sourceSlotMap(characterEvidence) {
  const result = new Map();
  for (const mapping of characterEvidence.mappings) {
    mapping.skillKeys.forEach((skillKey, index) => result.set(skillKey, { sourceChampionId: mapping.sourceChampionId, sourceNumericId: mapping.sourceNumericId, championName: mapping.name, slot: slotOrder[index] }));
  }
  return result;
}

function evidenceItem(skillKey, skill, slot, batchKey, candidatePath, candidateSha256) {
  const pending = Array.isArray(skill.pending) ? skill.pending : [];
  const excluded = Array.isArray(skill.excluded) ? skill.excluded : [];
  const pendingCounts = { source: 0, system: 0, configuration: 0, other: 0 };
  for (const item of pending) pendingCounts[pendingKind(item)] += 1;
  const writes = writeCounts(skill);
  return {
    ...slot,
    skillKey,
    candidateName: skill.name || null,
    batchKey,
    candidatePath,
    candidateSha256,
    writeCounts: writes,
    pendingCounts,
    pendingCount: pending.length,
    pendingSamples: pending.slice(0, 3).map(itemText),
    excludedCount: excluded.length,
    excludedSamples: excluded.slice(0, 3).map(itemText),
    fullExclusionCandidate: pending.length === 0 && Object.values(writes).every(value => value === 0) && excluded.length > 0
  };
}

async function runReadback() {
  if (!webRoot) throw new Error('缺少 DAMAGE_WEB_ROOT');
  if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');
  if (fs.existsSync(outputPath)) throw new Error('技能清单第二阶段当前证据.json 已存在，拒绝覆盖。');
  const stage = readJson(stagePath);
  const first = readJson(firstEvidencePath);
  const slotMap = sourceSlotMap(readJson(characterEvidencePath));
  const alreadyMatched = new Set(first.matchedBatches.map(item => item.batchKey));
  const candidateRoot = path.join(webRoot, '数据参考', '全量录入-2026-09', '交叉试录');
  const candidateFiles = walkNamedCandidates(candidateRoot);
  const filesBySha = new Map();
  for (const file of candidateFiles) {
    const hash = fileSha(file);
    if (!filesBySha.has(hash)) filesBySha.set(hash, []);
    filesBySha.get(hash).push(file);
  }
  const matchedBatches = [];
  const stillUnmatchedBatches = [];
  const skills = [];
  for (const [batchKey, batch] of Object.entries(stage.mechanismBatches)) {
    if (!/^hero.*Batch$/i.test(batchKey) || !Array.isArray(batch.skills) || alreadyMatched.has(batchKey)) continue;
    const candidateSha256 = candidateHashForBatch(batch);
    const matches = candidateSha256 ? filesBySha.get(candidateSha256) || [] : [];
    if (matches.length === 0) {
      stillUnmatchedBatches.push({ batchKey, skillCount: batch.skills.length, candidateSha256 });
      continue;
    }
    const candidateFile = matches[0];
    const document = readJson(candidateFile);
    const relativeCandidatePath = path.relative(webRoot, candidateFile).split(path.sep).join('/');
    matchedBatches.push({ batchKey, skillCount: batch.skills.length, candidateSha256, relativeCandidatePath, duplicateByteCopies: matches.length });
    for (const skillKey of batch.skills) {
      const skill = document.skills?.[skillKey];
      assert(skill, batchKey + ' 候选缺少 ' + skillKey);
      const slot = slotMap.get(skillKey);
      assert(slot, '角色来源槽位映射缺少 ' + skillKey);
      skills.push(evidenceItem(skillKey, skill, slot, batchKey, relativeCandidatePath, candidateSha256));
    }
  }
  assert.equal(matchedBatches.length, 9, '第二阶段命中批次数变化');
  assert.equal(stillUnmatchedBatches.length, 8, '第二阶段剩余早期批次数变化');
  assert.equal(skills.length, 140, '第二阶段技能证据数不符');
  assert.equal(new Set(skills.map(item => item.skillKey)).size, 140, '第二阶段技能键重复');
  const firstSkillKeys = new Set(first.skills.map(item => item.skillKey));
  assert.equal(skills.some(item => firstSkillKeys.has(item.skillKey)), false, '第二阶段与第一阶段技能重叠');

  const response = await fetch(baseUrl + '/skills', { method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, '技能目录GET非200');
  const currentDocument = await response.json();
  const currentSkills = Array.isArray(currentDocument) ? currentDocument : currentDocument.items;
  assert.equal(currentSkills.length, 1062, '当前技能总数不符');
  const currentByKey = new Map(currentSkills.map(item => [item.skillKey, item]));
  for (const item of skills) {
    const current = currentByKey.get(item.skillKey);
    assert(current, '当前技能目录缺少 ' + item.skillKey);
    item.current = { name: current.name, status: current.status, maxLevel: current.maxLevel, skillCategoryKeys: current.skillCategoryKeys };
  }
  const evidence = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    methodPolicy: 'GET_ONLY',
    authorizationValueRecorded: false,
    businessWrites: 0,
    getCount: 1,
    statusCounts: { 200: 1 },
    source: {
      characterEvidenceSha256: fileSha(characterEvidencePath),
      firstStageEvidenceSha256: fileSha(firstEvidencePath)
    },
    current: {
      skillCount: currentSkills.length,
      namedCandidateFilesScanned: candidateFiles.length,
      matchedBatches: matchedBatches.length,
      matchedSkills: skills.length,
      stillUnmatchedBatches: stillUnmatchedBatches.length
    },
    matchedBatches,
    stillUnmatchedBatches,
    skills: skills.sort((left, right) => left.sourceChampionId.localeCompare(right.sourceChampionId) || slotOrder.indexOf(left.slot) - slotOrder.indexOf(right.slot)),
    differences: [],
    boundary: '第二阶段新增收敛9批140技能；加上第一阶段与排除槽后为700/865。剩余8个早期批次的155个唯一范围内技能及Lux、Nasus十槽仍待处理。单次目录GET不替代既有详情回读。'
  };
  fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: evidence.status, getCount: evidence.getCount, namedCandidateFiles: evidence.current.namedCandidateFilesScanned, matchedBatches: evidence.current.matchedBatches, matchedSkills: evidence.current.matchedSkills, stillUnmatchedBatches: evidence.current.stillUnmatchedBatches, totalReconciledAfterIntegrate: 700, businessWrites: 0 }, null, 2));
}

function conclusionFor(item) {
  if (item.fullExclusionCandidate) return '明确排除';
  if (item.pendingCounts.source > 0) return '资料待核';
  return '系统暂缓';
}

function reasonFor(item, conclusion) {
  if (conclusion === '明确排除') return '当前候选没有范围内保存组成或待处理分支，全部已识别内容均有具体范围排除依据：' + item.excludedSamples.join('；');
  if (conclusion === '资料待核') return `已保存明确组成；仍有${item.pendingCount}个待处理分支，其中来源或资料缺口${item.pendingCounts.source}个、系统缺口${item.pendingCounts.system}个、配置缺口${item.pendingCounts.configuration}个。`;
  if (item.pendingCount > 0) return `已保存明确组成；仍有${item.pendingCount}个待处理分支，主要属于事件、状态、时序或配置接线，不能用近似规则补齐。`;
  return '候选已保存参数、公式或效果，但没有完整可执行入口；继续按系统接线缺口处理。';
}

function entriesFromEvidence(evidence) {
  return evidence.skills.map(item => {
    const conclusion = conclusionFor(item);
    return {
      sourceChampionId: item.sourceChampionId,
      sourceNumericId: item.sourceNumericId,
      championName: item.championName,
      slot: item.slot,
      skillKey: item.skillKey,
      name: item.current.name,
      conclusion,
      conclusionScope: '技能范围内数据与机制',
      reason: reasonFor(item, conclusion),
      pendingCounts: item.pendingCounts,
      batchKey: item.batchKey,
      candidateSha256: item.candidateSha256,
      evidenceRefs: ['skillSecondStageCurrentReadback', 'heroSourceInventory']
    };
  });
}

function distribution(entries) {
  return Object.fromEntries(['已录入', '明确排除', '资料待核', '系统暂缓'].map(key => [key, entries.filter(item => item.conclusion === key).length]));
}

function sortEntries(entries) {
  return entries.sort((left, right) => left.sourceChampionId.localeCompare(right.sourceChampionId) || slotOrder.indexOf(left.slot) - slotOrder.indexOf(right.slot));
}

function runIntegrate() {
  const evidence = readJson(outputPath);
  const stage = readJson(stagePath);
  assert.equal(evidence.status, 'PASS');
  assert.equal(stage.inventoryConclusions.skills.length, 560, '第一阶段技能结论数不符');
  const additions = entriesFromEvidence(evidence);
  const existingIds = new Set(stage.inventoryConclusions.skills.map(item => item.sourceChampionId + '/' + item.slot));
  assert.equal(additions.some(item => existingIds.has(item.sourceChampionId + '/' + item.slot)), false, '第二阶段条目与现有结论重叠');
  const entries = sortEntries([...stage.inventoryConclusions.skills, ...additions]);
  assert.equal(entries.length, 700);
  const conclusions = distribution(entries);
  stage.generatedAt = evidence.capturedAt;
  stage.inventoryConclusions.status = '进行中：角色主体层173项完成；技能第二阶段已收敛700/865项，仍有165个范围内技能及全部装备、符文待收敛。';
  stage.inventoryConclusions.evidence.skillSecondStageCurrentReadback = {
    relativePath: '数据参考/全量录入-2026-09/全量清单收敛/技能清单第二阶段当前证据.json',
    sha256: fileSha(outputPath),
    getCount: evidence.getCount,
    businessWrites: evidence.businessWrites,
    matchedCandidateBatches: evidence.current.matchedBatches
  };
  stage.inventoryConclusions.coverage.skills = {
    sourceItems: 865,
    concludedItems: entries.length,
    conclusions,
    matchedInScopeItems: 690,
    excludedChampionSlots: 10,
    remainingInScopeItems: 165,
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
  assert(ledger.skills.length >= 700, '技能结论不能少于第二阶段已收敛的700项');
  assert.equal(new Set(ledger.skills.map(item => item.sourceChampionId + '/' + item.slot)).size, ledger.skills.length);
  assert.equal(ledger.coverage.skills.sourceItems, 865);
  assert.equal(ledger.coverage.skills.concludedItems, ledger.skills.length);
  assert(ledger.coverage.skills.remainingInScopeItems <= 165, '后续阶段不能增加未收敛技能数');
  assert(ledger.coverage.skills.matchedInScopeItems >= 690, '后续阶段不能减少已匹配范围内技能数');
  assert.deepEqual(ledger.coverage.skills.conclusions, distribution(ledger.skills));
  assert.equal(ledger.evidence.skillSecondStageCurrentReadback.sha256, fileSha(outputPath));
  const expected = new Map(entriesFromEvidence(evidence).map(item => [item.sourceChampionId + '/' + item.slot, item]));
  for (const [id, item] of expected) {
    const actual = ledger.skills.find(value => value.sourceChampionId + '/' + value.slot === id);
    assert(actual, '第二阶段技能结论缺失：' + id);
    for (const field of ['sourceChampionId', 'sourceNumericId', 'championName', 'slot', 'skillKey', 'name', 'conclusionScope', 'batchKey', 'candidateSha256']) {
      assert.deepEqual(actual[field], item[field], '第二阶段稳定字段不一致：' + id + '/' + field);
    }
    for (const evidenceRef of item.evidenceRefs) assert(actual.evidenceRefs.includes(evidenceRef), '第二阶段证据引用丢失：' + id + '/' + evidenceRef);
  }
  process.stdout.write(JSON.stringify({ status: 'PASS', skillItems: ledger.skills.length, conclusions: ledger.coverage.skills.conclusions, remainingInScopeItems: ledger.coverage.skills.remainingInScopeItems, evidenceSha256: fileSha(outputPath) }, null, 2));
}

if (mode === 'readback') await runReadback();
else if (mode === 'integrate') runIntegrate();
else runCheckStage();
