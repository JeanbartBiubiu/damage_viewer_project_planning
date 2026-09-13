import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['readback', 'integrate', 'check-stage'].includes(mode)) throw new Error('用法：node 核对技能清单第三阶段.mjs readback|integrate|check-stage');
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const stagePath = path.join(here, '..', '阶段进度.json');
const characterEvidencePath = path.join(here, '角色清单当前回读证据.json');
const outputPath = path.join(here, '技能清单第三阶段当前证据.json');
const webRoot = String(process.env.DAMAGE_WEB_ROOT || '').trim();
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const slotOrder = ['P', 'Q', 'W', 'E', 'R'];
const shaBytes = value => crypto.createHash('sha256').update(value).digest('hex');
const fileSha = file => shaBytes(fs.readFileSync(file));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

const sourceGroups = [
  { groupKey: 'heroSecondBatch', stageBatchKey: 'heroSecondBatch', type: 'object', root: 'web', paths: ['数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第二批/回读摘要.json'] },
  { groupKey: 'heroThirdBatch', stageBatchKey: 'heroThirdBatch', type: 'object', root: 'web', paths: ['数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第三批/护盾消费纠错/批次回读摘要.json'] },
  { groupKey: 'heroFourthBatch', stageBatchKey: 'heroFourthBatch', type: 'object', root: 'web', paths: ['数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第四批/最终回读摘要.json'] },
  { groupKey: 'heroFifthBatch', stageBatchKey: 'heroFifthBatch', type: 'object', root: 'web', paths: ['数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第五批/完整候选.json'] },
  { groupKey: 'heroSixthBatch', stageBatchKey: 'heroSixthBatch', type: 'object', root: 'web', paths: ['数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第六批/完整候选.json'] },
  { groupKey: 'heroSeventhBatch', stageBatchKey: 'heroSeventhBatch', type: 'object', root: 'web', paths: ['数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第七批/完整候选.json'] },
  { groupKey: 'heroEighthBatch', stageBatchKey: 'heroEighthBatch', type: 'object', root: 'web', paths: ['数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第八批/前十技能候选.json', '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第八批/后十技能候选.json'] },
  { groupKey: 'heroEleventhBatch', stageBatchKey: 'heroEleventhBatch', type: 'object', root: 'web', paths: ['数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第十一批/完整候选.json'] },
  { groupKey: 'luxFirstBatch', stageBatchKey: 'luxFirstBatch', type: 'lux', root: 'web', paths: ['数据参考/全量录入-2026-09/交叉试录/Cursor/拉克丝机制第一批/候选.json'] },
  { groupKey: 'nasusFirstBatch', stageBatchKey: 'nasusFirstBatch', type: 'nasus', root: 'planning', paths: ['数据参考/全量录入-2026-09/内瑟斯技能实录第一批/录入候选.json'] }
];

function absolutePath(group, relativePath) {
  const root = group.root === 'web' ? webRoot : repoRoot;
  return path.join(root, ...relativePath.split('/'));
}

function sourceSlotMap(characterEvidence) {
  const result = new Map();
  for (const mapping of characterEvidence.mappings) mapping.skillKeys.forEach((skillKey, index) => result.set(skillKey, { sourceChampionId: mapping.sourceChampionId, sourceNumericId: mapping.sourceNumericId, championName: mapping.name, slot: slotOrder[index] }));
  return result;
}

function pendingKind(value) {
  if (value && typeof value === 'object' && typeof value.kind === 'string') {
    if (value.kind === '来源' || value.kind === '资料') return 'source';
    if (value.kind === '系统') return 'system';
    if (value.kind === '配置' || value.kind === '未接线') return 'configuration';
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (/来源|资料|待核|未知|未证|补证|冲突|缺值|插值|算法|取整/.test(text)) return 'source';
  if (/系统|事件|状态|时序|运行|宿主|条件|目标|接线|过程/.test(text)) return 'system';
  return 'other';
}

function itemText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return String(value);
  return [value.component, value.key, value.item, value.reason].filter(Boolean).join('：') || JSON.stringify(value);
}

function countsFor(skill) {
  if (skill.counts) return Object.fromEntries(['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'].map(key => [key, Number(skill.counts[key] || 0)]));
  const write = skill.write || skill;
  return Object.fromEntries(['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'].map(key => [key, Array.isArray(write[key]) ? write[key].length : 0]));
}

function normalizeSkill(group, skillKey, skill) {
  let pending = Array.isArray(skill.pending) ? skill.pending : [];
  const excluded = Array.isArray(skill.excluded) ? skill.excluded : [];
  if (group.type === 'lux') pending = (skill.skipped || []).filter(item => item.kind !== 'note');
  if (group.type === 'nasus') pending = skill.gaps || [];
  const pendingCounts = { source: 0, system: 0, configuration: 0, other: 0 };
  for (const item of pending) pendingCounts[pendingKind(item)] += 1;
  const writeCounts = countsFor(skill);
  return {
    skillKey,
    candidateName: skill.name || null,
    writeCounts,
    pendingCounts,
    pendingCount: pending.length,
    pendingSamples: pending.slice(0, 3).map(itemText),
    excludedCount: excluded.length,
    excludedSamples: excluded.slice(0, 3).map(itemText),
    fullExclusionCandidate: pending.length === 0 && Object.values(writeCounts).every(value => value === 0) && excluded.length > 0
  };
}

function loadGroupSkills(group) {
  const result = new Map();
  const files = [];
  for (const relativePath of group.paths) {
    const file = absolutePath(group, relativePath);
    assert(fs.existsSync(file), '缺少第三阶段来源：' + relativePath);
    const document = readJson(file);
    files.push({ relativePath, sha256: fileSha(file) });
    if (group.type === 'nasus') {
      assert(Array.isArray(document.skills), '内瑟斯候选 skills 不是数组');
      for (const skill of document.skills) result.set(skill.skillKey, skill);
    } else {
      assert(document.skills && typeof document.skills === 'object', relativePath + ' 缺少技能对象');
      for (const [skillKey, skill] of Object.entries(document.skills)) result.set(skillKey, skill);
    }
  }
  return { result, files };
}

async function runReadback() {
  if (!webRoot) throw new Error('缺少 DAMAGE_WEB_ROOT');
  if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');
  if (fs.existsSync(outputPath)) throw new Error('技能清单第三阶段当前证据.json 已存在，拒绝覆盖。');
  const stage = readJson(stagePath);
  const ledger = stage.inventoryConclusions;
  assert.equal(ledger.skills.length, 700, '第二阶段技能结论数不符');
  const existingSkillKeys = new Set(ledger.skills.map(item => item.skillKey).filter(Boolean));
  const slotMap = sourceSlotMap(readJson(characterEvidencePath));
  const groups = [];
  const rawSkillRefs = [];
  const additions = [];
  const skippedExisting = [];
  for (const group of sourceGroups) {
    const stageBatch = stage.mechanismBatches[group.stageBatchKey];
    assert(stageBatch && Array.isArray(stageBatch.skills), '阶段进度缺少批次：' + group.stageBatchKey);
    const loaded = loadGroupSkills(group);
    const stageSkillSet = new Set(stageBatch.skills);
    assert.equal(stageSkillSet.size, stageBatch.skills.length, group.groupKey + ' 批次技能重复');
    for (const skillKey of stageBatch.skills) assert(loaded.result.has(skillKey), group.groupKey + ' 来源缺少 ' + skillKey);
    groups.push({ groupKey: group.groupKey, stageBatchKey: group.stageBatchKey, rawSkillCount: stageBatch.skills.length, files: loaded.files });
    for (const skillKey of stageBatch.skills) {
      rawSkillRefs.push(skillKey);
      if (existingSkillKeys.has(skillKey)) {
        skippedExisting.push({ groupKey: group.groupKey, skillKey, reason: '较新或已散列定位证据已经进入前两阶段' });
        continue;
      }
      const slot = slotMap.get(skillKey);
      assert(slot, '来源槽位映射缺少 ' + skillKey);
      additions.push({ ...slot, groupKey: group.groupKey, ...normalizeSkill(group, skillKey, loaded.result.get(skillKey)), sourceFiles: loaded.files.map(item => item.relativePath) });
    }
  }
  assert.equal(rawSkillRefs.length, 170, '第三阶段原始批次引用数不符');
  assert.equal(skippedExisting.length, 5, '预期只跳过特朗德尔五槽');
  assert.deepEqual(skippedExisting.map(item => item.skillKey).sort(), ['trundle_e', 'trundle_p', 'trundle_q', 'trundle_r', 'trundle_w']);
  assert.equal(additions.length, 165, '第三阶段新增技能数不符');
  assert.equal(new Set(additions.map(item => item.skillKey)).size, 165, '第三阶段新增技能键重复');

  const response = await fetch(baseUrl + '/skills', { method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, '技能目录GET非200');
  const currentDocument = await response.json();
  const currentSkills = Array.isArray(currentDocument) ? currentDocument : currentDocument.items;
  assert.equal(currentSkills.length, 1062, '当前技能总数不符');
  const currentByKey = new Map(currentSkills.map(item => [item.skillKey, item]));
  for (const item of additions) {
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
    current: {
      skillCount: currentSkills.length,
      sourceGroups: groups.length,
      rawSkillRefs: rawSkillRefs.length,
      skippedExisting: skippedExisting.length,
      additions: additions.length,
      finalSourceSlotCoverage: ledger.skills.length + additions.length
    },
    groups,
    skippedExisting,
    skills: additions.sort((left, right) => left.sourceChampionId.localeCompare(right.sourceChampionId) || slotOrder.indexOf(left.slot) - slotOrder.indexOf(right.slot)),
    differences: [],
    boundary: '第三阶段新增165项后覆盖全部865个来源技能槽；每个资料待核或系统暂缓仍是开放工作，完整覆盖不等于完整机制完成。候选与逐技能摘要沿各批已有回读使用，本次只新增一次当前技能目录GET。'
  };
  fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: evidence.status, getCount: evidence.getCount, sourceGroups: evidence.current.sourceGroups, rawSkillRefs: evidence.current.rawSkillRefs, skippedExisting: evidence.current.skippedExisting, additions: evidence.current.additions, finalSourceSlotCoverage: evidence.current.finalSourceSlotCoverage, businessWrites: 0 }, null, 2));
}

function conclusionFor(item) {
  if (item.fullExclusionCandidate) return '明确排除';
  if (item.pendingCounts.source > 0) return '资料待核';
  return '系统暂缓';
}

function reasonFor(item, conclusion) {
  if (conclusion === '明确排除') return '当前有效证据没有范围内保存组成或待处理分支，全部已识别内容均有具体范围排除依据：' + item.excludedSamples.join('；');
  if (conclusion === '资料待核') return `已保存明确组成；仍有${item.pendingCount}个待处理分支，其中来源或资料缺口${item.pendingCounts.source}个、系统缺口${item.pendingCounts.system}个、配置缺口${item.pendingCounts.configuration}个。`;
  if (item.pendingCount > 0) return `已保存明确组成；仍有${item.pendingCount}个待处理分支，主要属于事件、状态、时序或配置接线，不能用近似规则补齐。`;
  return '当前证据只有已保存组成或批次级部分录入结论，没有整个技能范围内机制完成证据；按系统暂缓保留。';
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
      batchKey: item.groupKey,
      candidateSha256: null,
      evidenceRefs: ['skillThirdStageCurrentReadback', 'heroSourceInventory']
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
  assert.equal(stage.inventoryConclusions.skills.length, 700);
  const additions = entriesFromEvidence(evidence);
  const ids = new Set(stage.inventoryConclusions.skills.map(item => item.sourceChampionId + '/' + item.slot));
  assert.equal(additions.some(item => ids.has(item.sourceChampionId + '/' + item.slot)), false, '第三阶段与现有条目重叠');
  const entries = sortEntries([...stage.inventoryConclusions.skills, ...additions]);
  assert.equal(entries.length, 865);
  assert.equal(new Set(entries.map(item => item.sourceChampionId + '/' + item.slot)).size, 865);
  const conclusions = distribution(entries);
  stage.generatedAt = evidence.capturedAt;
  stage.inventoryConclusions.status = '进行中：角色主体173项与技能865项均已逐项覆盖；技能开放结论及全部装备、符文仍需继续处理。';
  stage.inventoryConclusions.evidence.skillThirdStageCurrentReadback = {
    relativePath: '数据参考/全量录入-2026-09/全量清单收敛/技能清单第三阶段当前证据.json',
    sha256: fileSha(outputPath),
    getCount: evidence.getCount,
    businessWrites: evidence.businessWrites,
    sourceGroups: evidence.current.sourceGroups
  };
  stage.inventoryConclusions.coverage.skills = {
    sourceItems: 865,
    concludedItems: 865,
    conclusions,
    matchedInScopeItems: 855,
    excludedChampionSlots: 10,
    remainingInScopeItems: 0,
    status: 'FULL_COVERAGE_WITH_OPEN_QUEUE'
  };
  stage.inventoryConclusions.skills = entries;
  fs.writeFileSync(stagePath, JSON.stringify(stage, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({ status: stage.inventoryConclusions.status, generatedAt: stage.generatedAt, skillCoverage: stage.inventoryConclusions.coverage.skills }, null, 2));
}

function runCheckStage() {
  const evidence = readJson(outputPath);
  const stage = readJson(stagePath);
  const ledger = stage.inventoryConclusions;
  assert.equal(ledger.skills.length, 865);
  assert.equal(new Set(ledger.skills.map(item => item.sourceChampionId + '/' + item.slot)).size, 865);
  assert.equal(ledger.coverage.skills.sourceItems, 865);
  assert.equal(ledger.coverage.skills.concludedItems, 865);
  assert.equal(ledger.coverage.skills.remainingInScopeItems, 0);
  assert.equal(ledger.coverage.skills.status, 'FULL_COVERAGE_WITH_OPEN_QUEUE');
  assert.deepEqual(ledger.coverage.skills.conclusions, distribution(ledger.skills));
  assert.equal(ledger.evidence.skillThirdStageCurrentReadback.sha256, fileSha(outputPath));
  const expected = new Map(entriesFromEvidence(evidence).map(item => [item.sourceChampionId + '/' + item.slot, item]));
  for (const [id, item] of expected) assert.deepEqual(ledger.skills.find(value => value.sourceChampionId + '/' + value.slot === id), item, '第三阶段结论不符：' + id);
  process.stdout.write(JSON.stringify({ status: 'PASS', skillItems: ledger.skills.length, conclusions: ledger.coverage.skills.conclusions, remainingInScopeItems: 0, evidenceSha256: fileSha(outputPath) }, null, 2));
}

if (mode === 'readback') await runReadback();
else if (mode === 'integrate') runIntegrate();
else runCheckStage();
