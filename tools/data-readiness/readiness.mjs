import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const PATHS = Object.freeze({
  ledger: '数据参考/全量录入-2026-09/阶段进度.json',
  wikiRoot: '数据参考/lol-wiki-champions-full',
  proof: 'server/data_manage/src/main/resources/simulation-verification/lol/combat-analysis.json',
  runtimeScope: 'server/data_manage/src/main/resources/simulation-scope/lol/combat-analysis.json',
  reviewCards: '数据参考/全量录入-2026-09/资料准备-2026-10-28/review-cards.json',
  output: 'output/maintenance-20261028',
});
const SLOTS = ['P', 'Q', 'W', 'E', 'R'];
const CONCLUSIONS = ['已录入', '明确排除', '资料待核', '系统暂缓'];
const SHA = /^[a-f0-9]{64}$/;
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = value => `${JSON.stringify(value, null, 2)}\n`;

export class ReadinessError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReadinessError';
    this.code = code;
    this.details = details;
  }
}
function requireThat(ok, code, message, details) {
  if (!ok) throw new ReadinessError(code, message, details);
}
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.trim().length > 0;
const key = x => typeof x === 'string' && KEY.test(x);
const strings = x => Array.isArray(x) && x.every(text);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const within = (base, target) => {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
};

function relativePath(value) {
  requireThat(text(value) && !path.isAbsolute(value) && !/[:\\\0]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..'),
  'UNSAFE_PATH', '资料路径必须是根目录内不含回退段的相对路径。', { path: value });
  return value;
}

function readFile(root, relative) {
  relativePath(relative);
  const target = path.resolve(root, relative);
  requireThat(within(root, target), 'UNSAFE_PATH', '资料路径越出仓库。', { path: relative });
  let real;
  try {
    real = fs.realpathSync(target);
  } catch (error) {
    throw new ReadinessError('INPUT_NOT_FOUND', '引用的资料文件不存在或无法读取。', { path: relative, errorCode: error.code });
  }
  requireThat(within(root, real), 'UNSAFE_PATH', '资料链接指向仓库外。', { path: relative });
  requireThat(fs.statSync(real).isFile(), 'INPUT_NOT_FILE', '引用的资料路径不是文件。', { path: relative });
  try {
    const bytes = fs.readFileSync(real);
    return { bytes, path: relative, sha256: sha256(bytes), byteSize: bytes.length };
  } catch (error) {
    throw new ReadinessError('INPUT_READ_FAILED', '资料文件无法读取。', { path: relative, errorCode: error.code });
  }
}
function readJson(root, relative, inputs) {
  const file = readFile(root, relative);
  inputs.set(relative, { path: relative, sha256: file.sha256, byteSize: file.byteSize });
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes));
  } catch {
    throw new ReadinessError('INVALID_JSON', '资料必须是有效的 UTF-8 JSON。', { path: relative });
  }
}

function validateLedger(ledger) {
  requireThat(object(ledger) && ledger.gameId === 'lol' && text(ledger.sourceVersion)
    && object(ledger.heroes?.priorityScope) && Array.isArray(ledger.heroes.priorityScope.batches)
    && ledger.heroes.priorityScope.batches.length > 0
    && Array.isArray(ledger.inventoryConclusions?.skills) && Array.isArray(ledger.inventoryConclusions?.characters),
  'INVALID_LEDGER', '账本缺少当前工作集或逐项结论。');
  const heroes = [];
  const seenHeroes = new Set();
  const seenCharacters = new Set();
  const orders = new Set();
  for (const batch of ledger.heroes.priorityScope.batches) {
    requireThat(object(batch) && integer(batch.order) && !orders.has(batch.order)
      && Array.isArray(batch.heroes) && batch.heroes.length > 0,
    'INVALID_SCOPE', '当前批次顺序或英雄列表无效。');
    orders.add(batch.order);
    for (const hero of batch.heroes) {
      requireThat(object(hero) && text(hero.sourceChampionId) && key(hero.characterKey) && text(hero.name)
        && !seenHeroes.has(hero.sourceChampionId) && !seenCharacters.has(hero.characterKey)
        && strings(hero.skillKeys) && hero.skillKeys.length === 5 && new Set(hero.skillKeys).size === 5,
      'INVALID_SCOPE', '当前工作集存在缺少稳定标识、重复英雄或无效技能列表。', { sourceChampionId: hero?.sourceChampionId });
      seenHeroes.add(hero.sourceChampionId);
      seenCharacters.add(hero.characterKey);
      heroes.push({ ...hero, batchOrder: batch.order, batchName: batch.name ?? null });
    }
  }
  heroes.sort((a, b) => a.batchOrder - b.batchOrder); // 同批保留账本英雄顺序。
  const selected = new Set(heroes.map(hero => hero.sourceChampionId));
  const rows = ledger.inventoryConclusions.skills.filter(row => selected.has(row?.sourceChampionId));
  const seenSlots = new Set();
  const seenKeys = new Set();
  for (const row of rows) {
    const identity = `${row.sourceChampionId}/${row.slot}`;
    requireThat(SLOTS.includes(row.slot) && key(row.skillKey) && CONCLUSIONS.includes(row.conclusion)
      && !seenSlots.has(identity) && !seenKeys.has(row.skillKey),
    'INVALID_SKILL_ROWS', '范围内技能存在无效结论、槽位或重复标识。', { skillKey: row.skillKey, identity });
    if (row.pendingCounts !== undefined) {
      requireThat(object(row.pendingCounts) && Object.values(row.pendingCounts).every(integer),
        'INVALID_PENDING_COUNTS', '技能待处理分支计数必须是非负整数。', { skillKey: row.skillKey });
    }
    seenSlots.add(identity);
    seenKeys.add(row.skillKey);
  }
  for (const hero of heroes) {
    const heroRows = rows.filter(row => row.sourceChampionId === hero.sourceChampionId);
    requireThat(heroRows.length === 5 && SLOTS.every(slot => heroRows.some(row => row.slot === slot))
      && heroRows.every(row => hero.skillKeys.includes(row.skillKey)),
    'INCOMPLETE_SCOPE_SKILLS', '当前英雄必须恰好对应账本 P/Q/W/E/R 五个来源槽。', { sourceChampionId: hero.sourceChampionId });
    const subjects = ledger.inventoryConclusions.characters.filter(row => row?.sourceChampionId === hero.sourceChampionId);
    requireThat(subjects.length === 1 && subjects[0].characterKey === hero.characterKey && CONCLUSIONS.includes(subjects[0].conclusion),
      'INVALID_CHARACTER_ROWS', '当前英雄主体的稳定标识或逐项结论无效。', { sourceChampionId: hero.sourceChampionId });
  }
  const heroOrder = new Map(heroes.map((hero, i) => [hero.sourceChampionId, i]));
  rows.sort((a, b) => heroOrder.get(a.sourceChampionId) - heroOrder.get(b.sourceChampionId)
    || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
  const conclusions = Object.fromEntries(CONCLUSIONS.map(conclusion => [conclusion, rows.filter(row => row.conclusion === conclusion).length]));
  const completeHeroes = heroes.filter(hero => {
    const active = rows.filter(row => row.sourceChampionId === hero.sourceChampionId && row.conclusion !== '明确排除');
    return active.length > 0 && active.every(row => row.conclusion === '已录入');
  });
  return { heroes, rows, conclusions, counts: {
    heroCount: heroes.length,
    sourceSkillSlots: rows.length,
    excludedSkillSlots: conclusions.明确排除,
    managementDenominator: rows.length - conclusions.明确排除,
    managementCompleteSkillSlots: conclusions.已录入,
    sourcePendingConclusionSkillSlots: conclusions.资料待核,
    systemDeferredSkillSlots: conclusions.系统暂缓,
    openSkillSlots: conclusions.资料待核 + conclusions.系统暂缓,
    wholeHeroManagementComplete: completeHeroes.length,
    characterSubjectsComplete: ledger.inventoryConclusions.characters
      .filter(row => selected.has(row.sourceChampionId) && row.conclusion === '已录入').length,
  } };
}

function pageMetadata(page, wikiRoot) {
  requireThat(object(page) && text(page.title) && Number.isSafeInteger(page.pageId) && page.pageId > 0
    && Number.isSafeInteger(page.revisionId) && page.revisionId > 0
    && text(page.revisionTimestamp) && Number.isFinite(Date.parse(page.revisionTimestamp))
    && text(page.contentModel) && text(page.sourceUrl) && SHA.test(page.contentSha256) && integer(page.rawByteSize) && page.rawByteSize > 0,
  'INVALID_SOURCE_METADATA', '页面修订、时间、来源链接、字节数或摘要无效。', { title: page?.title });
  let url;
  try { url = new URL(page.sourceUrl); } catch { /* 下方统一报告。 */ }
  requireThat(url?.protocol === 'https:' && url.hostname === 'wiki.leagueoflegends.com' && !url.username && !url.password,
    'INVALID_SOURCE_URL', '页面来源必须指向本地清单声明的 Wiki 站点。', { title: page.title });
  relativePath(page.rawRelPath);
  return {
    title: page.title,
    pageId: page.pageId,
    revisionId: page.revisionId,
    revisionTimestamp: page.revisionTimestamp,
    contentModel: page.contentModel,
    sourceUrl: page.sourceUrl,
    revisionUrl: `${page.sourceUrl}${url.search ? '&' : '?'}oldid=${page.revisionId}`,
    rawPath: `${wikiRoot}/${page.rawRelPath}`,
    rawByteSize: page.rawByteSize,
    sha256: page.contentSha256,
  };
}

function loadWiki(root, inputs) {
  const manifestPath = `${PATHS.wikiRoot}/manifest.json`;
  const manifest = readJson(root, manifestPath, inputs);
  requireThat(object(manifest) && manifest.schemaVersion === 'lol-wiki-full-champion-source-v1'
    && Array.isArray(manifest.champions) && manifest.champions.length > 0
    && manifest.championCount === manifest.champions.length
    && integer(manifest.abilityPageCount) && Array.isArray(manifest.dependencies),
  'INVALID_WIKI_MANIFEST', 'Wiki 清单格式或英雄计数无效。');
  const pages = new Map();
  const content = new Map();
  function loadPage(page) {
    const metadata = pageMetadata(page, PATHS.wikiRoot);
    const previous = pages.get(metadata.rawPath);
    requireThat(!previous || json(previous) === json(metadata), 'SOURCE_REVISION_MISMATCH',
      '同一原文路径被不同页面或修订重复引用。', { path: metadata.rawPath });
    if (previous) return previous;
    const file = readFile(root, metadata.rawPath);
    requireThat(file.byteSize === metadata.rawByteSize, 'SOURCE_BYTES_MISMATCH', '原文字节数与页面清单不符。', {
      path: metadata.rawPath, expected: metadata.rawByteSize, actual: file.byteSize,
    });
    requireThat(file.sha256 === metadata.sha256, 'SOURCE_SHA256_MISMATCH', '原文 SHA-256 摘要与页面清单不符。', {
      path: metadata.rawPath, expected: metadata.sha256, actual: file.sha256,
    });
    let original;
    try { original = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes); }
    catch { throw new ReadinessError('INVALID_SOURCE_UTF8', '原文不是有效的 UTF-8。', { path: metadata.rawPath }); }
    pages.set(metadata.rawPath, metadata);
    content.set(metadata.rawPath, original);
    return metadata;
  }
  loadPage(manifest.championList);
  const dependencies = manifest.dependencies.map(loadPage).sort((a, b) => cmp(a.title, b.title));
  requireThat(new Set(dependencies.map(page => page.title)).size === dependencies.length,
    'DUPLICATE_DEPENDENCY', 'Wiki 依赖页标题重复。');
  const champions = new Map();
  let abilities = 0;
  for (const row of manifest.champions) {
    requireThat(object(row) && text(row.title) && text(row.resolvedTitle) && integer(row.abilityPageCount),
      'INVALID_WIKI_CHAMPION', 'Wiki 英雄索引无效。');
    relativePath(row.metadataRelPath);
    const metadataPath = `${PATHS.wikiRoot}/${row.metadataRelPath}`;
    const hero = readJson(root, metadataPath, inputs);
    requireThat(object(hero) && hero.wikiChampionTitle === row.title && hero.resolvedTitle === row.resolvedTitle
      && Array.isArray(hero.abilities) && hero.abilities.length === row.abilityPageCount
      && object(hero.slots) && Object.keys(hero.slots).length === 5 && SLOTS.every(slot => strings(hero.slots[slot]) && hero.slots[slot].length > 0),
    'INVALID_WIKI_CHAMPION', '英雄元信息与清单、五槽入口或技能正文数量不符。', { path: metadataPath });
    const normalized = normalizeChampion(row.title);
    requireThat(!champions.has(normalized), 'AMBIGUOUS_CHAMPION', 'Wiki 英雄标题去除空格标点后重名。', { title: row.title });
    loadPage(hero.page);
    if (hero.dataPage) loadPage(hero.dataPage);
    const abilityPages = hero.abilities.map(loadPage);
    requireThat(new Set(abilityPages.map(page => page.title)).size === abilityPages.length,
      'DUPLICATE_ABILITY', '英雄技能正文标题重复。', { title: row.title });
    const byTitle = new Map(abilityPages.map(page => [page.title, page]));
    for (const slot of SLOTS) {
      requireThat(new Set(hero.slots[slot]).size === hero.slots[slot].length && hero.slots[slot].every(title => byTitle.has(title)),
        'MISSING_SLOT_SOURCE', '技能槽引用缺少、重复或未收录的正文。', { title: row.title, slot });
    }
    champions.set(normalized, { row, metadataPath, slots: hero.slots, byTitle, abilityPages });
    abilities += abilityPages.length;
  }
  requireThat(abilities === manifest.abilityPageCount, 'ABILITY_COUNT_MISMATCH', '技能正文总数与 Wiki 清单不符。', {
    expected: manifest.abilityPageCount, actual: abilities,
  });
  return { manifest, manifestSha256: inputs.get(manifestPath).sha256, champions, pages, content, dependencies, abilities };
}
function normalizeChampion(id) { return id.replace(/[^a-z0-9]/gi, '').toLowerCase(); }

function validateProof(proof, gameId) {
  requireThat(object(proof) && proof.schemaVersion === 'simulation-verification-v1' && proof.gameId === gameId
    && proof.profile === 'combat-analysis-v1' && proof.digestVersion === 'simulation-availability-v1'
    && ['scopeDigest', 'sharedDigest', 'wasmSha256'].every(key => SHA.test(proof[key]))
    && text(proof.adapterVersion) && Array.isArray(proof.entries),
  'INVALID_PROOF_MANIFEST', '正式证明清单结构或身份无效。');
  const ids = new Set();
  for (const entry of proof.entries) {
    const id = `${entry?.kind}:${entry?.key}`;
    requireThat(object(entry) && ['CHARACTER', 'EQUIPMENT'].includes(entry.kind) && key(entry.key)
      && !ids.has(id) && SHA.test(entry.contentDigest) && SHA.test(entry.externalDigest)
      && ['PASSED', 'ENGINE_UNSUPPORTED'].includes(entry.outcome) && object(entry.coverage)
      && strings(entry.evidenceRefs) && entry.evidenceRefs.length > 0 && Array.isArray(entry.issues)
      && (entry.outcome === 'PASSED' ? entry.issues.length === 0 : entry.issues.length > 0),
    'INVALID_PROOF_ENTRY', '正式证明条目重复或缺少有效的身份、覆盖和证据。', { identity: id });
    ids.add(id);
  }
}

function compareRuntimeScope(runtimeScope, ledgerScope) {
  requireThat(object(runtimeScope) && runtimeScope.schemaVersion === 'simulation-priority-scope-v1'
    && runtimeScope.gameId === 'lol' && runtimeScope.profile === 'combat-analysis-v1'
    && Array.isArray(runtimeScope.characters) && Array.isArray(runtimeScope.equipment),
  'INVALID_RUNTIME_SCOPE', '正式范围声明格式无效。');
  const differences = [];
  const seen = new Set();
  for (const hero of runtimeScope.characters) {
    requireThat(object(hero) && key(hero.key) && !seen.has(hero.key) && text(hero.sourceChampionId)
      && Array.isArray(hero.expectedSkills) && hero.expectedSkills.length === 5,
    'INVALID_RUNTIME_SCOPE', '正式范围存在重复英雄或无效技能槽。', { characterKey: hero?.key });
    seen.add(hero.key);
    const slotSet = new Set();
    for (const skill of hero.expectedSkills) {
      requireThat(object(skill) && SLOTS.includes(skill.slot) && !slotSet.has(skill.slot) && key(skill.key)
        && typeof skill.excluded === 'boolean'
        && (skill.currentSkillKeys === undefined || (strings(skill.currentSkillKeys) && skill.currentSkillKeys.length > 0
          && skill.currentSkillKeys.every(key) && new Set(skill.currentSkillKeys).size === skill.currentSkillKeys.length)),
      'INVALID_RUNTIME_SCOPE', '正式范围的技能标识、排除声明或当前挂载标识无效。', { characterKey: hero.key });
      slotSet.add(skill.slot);
    }
    const selected = ledgerScope.heroes.find(row => row.characterKey === hero.key);
    if (!selected || selected.sourceChampionId !== hero.sourceChampionId) {
      differences.push({ code: 'RUNTIME_SCOPE_HERO_DIFFERENCE', characterKey: hero.key, sourceChampionId: hero.sourceChampionId });
      continue;
    }
    for (const expected of hero.expectedSkills) {
      const row = ledgerScope.rows.find(row => row.sourceChampionId === selected.sourceChampionId && row.slot === expected.slot);
      if (row.skillKey !== expected.key || (row.conclusion === '明确排除') !== expected.excluded) {
        differences.push({ code: 'RUNTIME_SCOPE_SLOT_DIFFERENCE', characterKey: hero.key, slot: expected.slot,
          ledger: { skillKey: row.skillKey, excluded: row.conclusion === '明确排除' },
          runtimeScope: { skillKey: expected.key, excluded: expected.excluded } });
      }
    }
  }
  for (const hero of ledgerScope.heroes) {
    if (!seen.has(hero.characterKey)) differences.push({ code: 'RUNTIME_SCOPE_HERO_MISSING', characterKey: hero.characterKey });
  }
  return { heroCount: runtimeScope.characters.length,
    sourceSkillSlots: runtimeScope.characters.reduce((sum, hero) => sum + hero.expectedSkills.length, 0),
    excludedSkillSlots: runtimeScope.characters.reduce((sum, hero) => sum + hero.expectedSkills.filter(skill => skill.excluded).length, 0),
    differences };
}

function buildReconciliation(ledger, scope, proof, runtimeScope, proofPath) {
  const formalScope = compareRuntimeScope(runtimeScope, scope);
  const proofCounts = Object.fromEntries(['CHARACTER', 'EQUIPMENT'].map(kind => [kind, {
    entries: proof.entries.filter(entry => entry.kind === kind).length,
    passed: proof.entries.filter(entry => entry.kind === kind && entry.outcome === 'PASSED').length,
  }]));
  const hints = [];
  const confirmation = ledger.heroes.priorityScope.scopeConfirmation;
  if (object(confirmation)) {
    for (const key of ['heroCount', 'sourceSkillSlots']) {
      if (confirmation[key] !== scope.counts[key]) hints.push({ code: 'DECLARED_SCOPE_COUNT_DIFFERENCE', field: key,
        declared: confirmation[key] ?? null, calculated: scope.counts[key] });
    }
  }
  const heroComparisons = scope.heroes.map(hero => {
    const rows = scope.rows.filter(row => row.sourceChampionId === hero.sourceChampionId);
    const proofIndex = proof.entries.findIndex(entry => entry.kind === 'CHARACTER' && entry.key === hero.characterKey);
    const entry = proof.entries[proofIndex];
    const active = rows.filter(row => row.conclusion !== '明确排除');
    const open = active.filter(row => row.conclusion !== '已录入');
    if (entry?.outcome === 'PASSED' && open.length > 0) {
      hints.push({ code: 'PASSED_PROOF_WITH_OPEN_MANAGEMENT', characterKey: hero.characterKey,
        ledgerOpenSkillKeys: open.map(row => row.skillKey), proofIndex,
        meaning: '正式证明覆盖已声明的运行范围，台账仍保留管理未完成结论；需要核对两者口径、日期与范围，不能据此自动改状态或断言冲突。' });
    }
    if (active.length > 0 && open.length === 0 && entry?.outcome !== 'PASSED') {
      hints.push({ code: 'MANAGEMENT_COMPLETE_WITHOUT_PASSED_PROOF', characterKey: hero.characterKey,
        meaning: '管理配置完成与整英雄运行证明分别记账；此提示不自动新增准入。' });
    }
    return {
      sourceChampionId: hero.sourceChampionId, characterKey: hero.characterKey, name: hero.name,
      ledger: rows.map(row => ({ slot: row.slot, skillKey: row.skillKey, conclusion: row.conclusion,
        conclusionScope: row.conclusionScope ?? null, reason: row.reason ?? null,
        runtimeStatus: row.currentRuntimeValidation?.status ?? null,
        runtimeVerifiedAt: row.currentRuntimeValidation?.verifiedAt ?? null })),
      formalProof: entry ? { path: proofPath, entryIndex: proofIndex, outcome: entry.outcome,
        contentDigest: entry.contentDigest, externalDigest: entry.externalDigest, coverage: entry.coverage } : null,
    };
  });
  const selected = new Set(scope.heroes.map(hero => hero.characterKey));
  return {
    schemaVersion: 'data-readiness-reconciliation-v1',
    boundary: '只比较当前仓库台账、正式范围与证明文件的声明。管理配置、来源核对和运行证明分别记账；未连接服务、数据库或浏览器，未重新计算共享摘要、业务摘要或执行 Wasm，不确认现场可选状态。',
    ledgerCounts: scope.counts, ledgerConclusions: scope.conclusions,
    declaredScopeConfirmation: object(confirmation) ? { heroCount: confirmation.heroCount, sourceSkillSlots: confirmation.sourceSkillSlots } : null,
    formalScope,
    formalProof: { path: proofPath, schemaVersion: proof.schemaVersion, gameId: proof.gameId, profile: proof.profile,
      scopeDigest: proof.scopeDigest, sharedDigest: proof.sharedDigest, wasmSha256: proof.wasmSha256,
      adapterVersion: proof.adapterVersion, counts: proofCounts,
      characterEntriesOutsideLedgerScope: proof.entries.filter(entry => entry.kind === 'CHARACTER' && !selected.has(entry.key)).map(entry => entry.key) },
    reviewHints: hints, heroes: heroComparisons,
  };
}

function verifyReviewCards(root, inputs, wiki, sourceCards, ledger) {
  const target = path.resolve(root, PATHS.reviewCards);
  if (!fs.existsSync(target)) return { path: PATHS.reviewCards, status: '未建立审核来源卡', cardCount: 0 };
  const pinned = readJson(root, PATHS.reviewCards, inputs);
  requireThat(object(pinned) && pinned.schemaVersion === 'data-readiness-reviewed-source-cards-v1'
    && Array.isArray(pinned.cards) && pinned.cards.length > 0,
  'INVALID_REVIEW_CARDS', '审核来源卡格式无效。', { path: PATHS.reviewCards });
  requireThat(pinned.wikiManifestSha256 === wiki.manifestSha256 && pinned.ledgerSourceVersion === ledger.sourceVersion,
    'REVIEW_SOURCE_VERSION_MISMATCH', '审核来源卡的 Wiki 清单摘要或账本固定版本已变化，需人工复核。', { path: PATHS.reviewCards });
  const seen = new Set();
  for (const card of pinned.cards) {
    requireThat(object(card) && object(card.sourceCard) && key(card.sourceCard.skillKey)
      && !seen.has(card.sourceCard.skillKey) && strings(card.fieldsToReview) && card.fieldsToReview.length > 0,
    'INVALID_REVIEW_CARDS', '审核来源卡技能重复、来源缺失或缺少待核对字段。', { path: PATHS.reviewCards });
    seen.add(card.sourceCard.skillKey);
    const current = sourceCards.find(row => row.skillKey === card.sourceCard.skillKey);
    requireThat(current && json(current) === json(card.sourceCard), 'REVIEW_CARD_SOURCE_MISMATCH',
      '审核来源卡的原文、修订、范围或账本结论与当前资料不符，需保留旧卡并人工复核。', { skillKey: card.sourceCard.skillKey });
  }
  return { path: PATHS.reviewCards, status: '来源、修订与账本逐卡一致；尚未转为可写配置', cardCount: pinned.cards.length };
}

export function prepareReports({ repoRoot, proofManifest = PATHS.proof } = {}) {
  let root;
  try { root = fs.realpathSync(repoRoot); } catch { throw new ReadinessError('INVALID_REPO_ROOT', '仓库根目录不存在。'); }
  requireThat(fs.statSync(root).isDirectory(), 'INVALID_REPO_ROOT', '仓库根路径不是目录。');
  relativePath(proofManifest);
  const inputs = new Map();
  const ledger = readJson(root, PATHS.ledger, inputs);
  const scope = validateLedger(ledger);
  const wiki = loadWiki(root, inputs);
  // 每个当前英雄都必须能精确映射；只忽略空格、撇号等标点，不做相似名称猜测。
  for (const hero of scope.heroes) requireThat(wiki.champions.has(normalizeChampion(hero.sourceChampionId)),
    'WIKI_CHAMPION_NOT_FOUND', '当前工作集英雄未在全英雄 Wiki 清单中找到唯一对应。', { sourceChampionId: hero.sourceChampionId });
  const proof = readJson(root, proofManifest, inputs);
  validateProof(proof, ledger.gameId);
  const runtimeScope = readJson(root, PATHS.runtimeScope, inputs);
  const queue = scope.rows.filter(row => row.conclusion !== '明确排除' && row.conclusion !== '已录入'
    && (row.conclusion === '资料待核' || (row.pendingCounts?.source ?? 0) > 0)).map((row, index) => {
    const hero = scope.heroes.find(hero => hero.sourceChampionId === row.sourceChampionId);
    const source = wiki.champions.get(normalizeChampion(row.sourceChampionId));
    return {
      order: index + 1, batchOrder: hero.batchOrder, batchName: hero.batchName,
      sourceChampionId: row.sourceChampionId, characterKey: hero.characterKey, championName: hero.name,
      slot: row.slot, skillKey: row.skillKey, name: row.name ?? null,
      conclusion: row.conclusion, reason: row.reason ?? null,
      pendingCounts: row.pendingCounts ?? null, remainingBranches: row.remainingBranches ?? null,
      queueReason: row.conclusion === '资料待核' ? '台账结论为资料待核' : '系统暂缓条目仍列有资料缺口',
      sourceMetadataPath: source.metadataPath,
      sourcePages: source.slots[row.slot].map(title => source.byTitle.get(title)),
    };
  });
  const cards = queue.map(row => ({
    skillKey: row.skillKey, sourceChampionId: row.sourceChampionId, characterKey: row.characterKey,
    championName: row.championName, slot: row.slot, name: row.name,
    ledgerConclusion: row.conclusion, ledgerReason: row.reason, ledgerSourceVersion: ledger.sourceVersion,
    reviewStatus: '保留原文的待核对来源卡；不是数值提取结果或可录入机制，不改变配置、完成状态或运行证明。',
    versionBoundary: 'Wiki 页面修订时间与账本固定游戏版本分别记录；页面日期不证明数值适用于账本版本，采用值需人工核对。',
    sourceMetadataPath: row.sourceMetadataPath,
    pages: row.sourcePages.map(page => {
      const original = wiki.content.get(page.rawPath);
      return { ...page, excerpt: { selection: '完整技能正文，保留等级模板、公式、触发条件、时序和全部注记；不自动求值。',
        startLine: 1, endLine: original.split('\n').length - (original.endsWith('\n') ? 1 : 0), text: original } };
    }),
  }));
  const reviewCards = verifyReviewCards(root, inputs, wiki, cards, ledger);
  const reconciliation = buildReconciliation(ledger, scope, proof, runtimeScope, proofManifest);
  const counts = { ...scope.counts, sourceReviewQueue: queue.length };
  const inputFiles = [...inputs.values()].sort((a, b) => cmp(a.path, b.path));
  const sourceIndex = {
    schemaVersion: 'data-readiness-source-index-v1',
    boundary: '每次运行都按原始字节校验所引用文件；未抓取网络资料。摘要一致仅证明资料完整，不证明业务数值或运行机制正确。',
    inputFiles,
    wiki: { manifestPath: `${PATHS.wikiRoot}/manifest.json`, manifestSha256: wiki.manifestSha256,
      fetchedAt: wiki.manifest.fetchedAt, sourceUrl: wiki.manifest.sourceUrl,
      license: wiki.manifest.license, championCount: wiki.champions.size, abilityPageCount: wiki.abilities,
      dependencyPageCount: wiki.dependencies.length, verifiedRawPageCount: wiki.pages.size },
    verifiedRawPages: [...wiki.pages.values()].sort((a, b) => cmp(a.rawPath, b.rawPath)),
    reviewedCards: reviewCards,
  };
  const hints = reconciliation.reviewHints.filter(hint => hint.code === 'PASSED_PROOF_WITH_OPEN_MANAGEMENT');
  const summary = [
    '# 资料准备与只读对账', '',
    `本次只读使用账本 ${ledger.generatedAt ?? '未标记日期'} 与 Wiki 清单 ${wiki.manifest.fetchedAt ?? '未标记日期'}。`, '',
    `当前工作集 ${counts.heroCount} 名英雄、${counts.sourceSkillSlots} 个来源槽；明确排除 ${counts.excludedSkillSlots} 槽，管理分母 ${counts.managementDenominator}。管理完成 ${counts.managementCompleteSkillSlots} 槽，资料待核 ${counts.sourcePendingConclusionSkillSlots} 槽，系统暂缓 ${counts.systemDeferredSkillSlots} 槽；开放 ${counts.openSkillSlots} 槽。角色主体完成 ${counts.characterSubjectsComplete} 名，整英雄管理完成 ${counts.wholeHeroManagementComplete} 名。`, '',
    `资料核对队列 ${queue.length} 槽：结论为资料待核，或仍显式列有资料缺口的系统暂缓条目；保留批次、英雄、P/Q/W/E/R 顺序。明确排除与已录入条目不进入该队列。`, '',
    `全量原文校验：${wiki.champions.size} 名英雄、${wiki.abilities} 份技能正文、${wiki.dependencies.length} 份依赖，合计 ${wiki.pages.size} 份原文均通过字节数和 SHA-256 摘要检查。此项仅证明原文落盘完整。`, '',
    `仓库正式证明列出 ${reconciliation.formalProof.counts.CHARACTER.passed} 名英雄与 ${reconciliation.formalProof.counts.EQUIPMENT.passed} 件装备 PASSED（通过）；${hints.length} 名已有通过证明的英雄仍保留管理开放结论，详见 reconciliation.json。此类差异只提示口径需复核，不自动修改状态或断言冲突。`, '',
    `正式范围与账本逐槽差异 ${reconciliation.formalScope.differences.length} 项；独立审核来源卡 ${reviewCards.cardCount} 张。`, '',
    '来源卡保留完整原文与修订，尚未确定可写数值。未调用真实数据库、管理接口、浏览器或 Wasm；未核对现场业务摘要及部署身份，不确认现场可选状态。', '',
  ].join('\n');
  return { root, counts, queue, cards, reconciliation, sourceIndex, files: new Map([
    ['queue.json', json({ schemaVersion: 'data-readiness-source-queue-v1', counts,
      rule: '按当前 heroes.priorityScope.batches[].heroes.sourceChampionId 筛选；保留批次和英雄顺序，再按 P/Q/W/E/R；不采用历史 selectionSnapshot 或全局覆盖数作为分母。', items: queue })],
    ['source-cards.json', json({ schemaVersion: 'data-readiness-source-cards-v1', cards,
      dependencyBoundary: '以下是全量清单保留的计算及展示依赖，只核对原文身份，不据此展开公式或默认等级。',
      retainedDependencies: wiki.dependencies })],
    ['source-index.json', json(sourceIndex)],
    ['reconciliation.json', json(reconciliation)],
    ['摘要.md', summary],
  ]) };
}

export function outputDirectory(root, value = PATHS.output) {
  requireThat(text(value), 'UNSAFE_OUTPUT_PATH', '必须指定独立报告输出目录。');
  const base = path.resolve(root, 'output');
  const target = path.resolve(root, value);
  requireThat(within(base, target) && path.relative(base, target) !== '', 'UNSAFE_OUTPUT_PATH',
    '报告只允许写入仓库 output 下的独立子目录，避免覆盖原始资料。');
  // 拒绝现有链接或联接点，避免 output 或子目录被重定向到资料目录。
  let cursor = root;
  for (const segment of path.relative(root, target).split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      requireThat(!stat.isSymbolicLink() && stat.isDirectory() && within(base, fs.realpathSync(cursor)),
        'UNSAFE_OUTPUT_PATH', '输出目录中存在链接、联接点或非目录路径。');
    }
  }
  return target;
}

export function writeOrCheckReports(prepared, { output = PATHS.output, check = false } = {}) {
  const directory = outputDirectory(prepared.root, output);
  // 在创建目录或文件前先核对所有目标。相同产物可重复核对，不覆盖不同内容。
  const pending = [];
  for (const [name, expected] of prepared.files) {
    const target = path.join(directory, name);
    if (fs.existsSync(target)) {
      requireThat(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink(),
        'UNSAFE_OUTPUT_FILE', '报告目标必须是普通文件。', { file: name });
      const actual = fs.readFileSync(target);
      requireThat(actual.equals(Buffer.from(expected)), check ? 'REPORT_DRIFT' : 'OUTPUT_EXISTS_DIFFERENT',
        check ? '已有报告与当前输入不一致；可能包含来源修订、账本、正式证明或审核卡变化。' : '输出文件已有不同内容，请使用新的 output 子目录保留历史报告。',
        { file: name, expectedSha256: sha256(expected), actualSha256: sha256(actual) });
    } else {
      requireThat(!check, 'REPORT_NOT_FOUND', '待检查报告不存在；请先生成到独立输出目录。', { file: name });
      pending.push([target, expected]);
    }
  }
  if (!check && pending.length > 0) {
    fs.mkdirSync(directory, { recursive: true });
    for (const [target, expected] of pending) fs.writeFileSync(target, expected, { flag: 'wx', encoding: 'utf8' });
  }
  return { mode: check ? 'check' : 'prepare', output: path.relative(prepared.root, directory).split(path.sep).join('/'),
    reportFiles: prepared.files.size, filesWritten: check ? 0 : pending.length, counts: prepared.counts,
    sourceValidation: prepared.sourceIndex.wiki, reviewedCards: prepared.sourceIndex.reviewedCards,
    reviewHints: prepared.reconciliation.reviewHints.length,
    runtimeScopeDifferences: prepared.reconciliation.formalScope.differences.length };
}
