import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PATHS, prepareReports, writeOrCheckReports, outputDirectory, sha256, json } from './readiness.mjs';

const SLOTS = ['P', 'Q', 'W', 'E', 'R'];
const HASH = 'a'.repeat(64);
const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));

function fixture(t) {
  const tempParent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempParent, 'damage-readiness-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), tempParent);
    assert.ok(path.basename(root).startsWith('damage-readiness-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const put = (relative, data) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof data === 'string' ? data : json(data));
  };
  const edit = (relative, mutate) => {
    const data = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
    mutate(data);
    put(relative, data);
  };
  let pageId = 0;
  const originals = new Map();
  function page(title, relative, body) {
    put(`${PATHS.wikiRoot}/${relative}`, body);
    originals.set(`${PATHS.wikiRoot}/${relative}`, body);
    return { title, pageId: ++pageId, revisionId: 10 + pageId, revisionTimestamp: '2026-10-03T20:00:57Z',
      contentModel: 'wikitext', sourceUrl: `https://wiki.leagueoflegends.com/en-us/${encodeURIComponent(title)}`,
      rawRelPath: relative, contentSha256: sha256(body), rawByteSize: Buffer.byteLength(body) };
  }
  const heroes = ['Annie', 'Akali', 'Garen'];
  const manifestRows = [];
  let abilityCount = 0;
  for (const name of heroes) {
    const slug = name.toLowerCase();
    const abilities = SLOTS.map(slot => page(`Template:Data ${name}/${slot}`, `raw/${slug}/${slot.toLowerCase()}.wikitext`,
      `|champion = ${name}\n|skill = ${slot}\n|description = trigger before attack, after 2.5 seconds, only once.\n`
      + '|leveling = {{pplevel|35 to 53 for 7; then + 9*x for 6; then + 15*x|formula=+3 per level until lvl 7}}\n'
      + '|notes = 等级原文；not a numeric extraction.\n'));
    const slots = Object.fromEntries(SLOTS.map((slot, index) => [slot, [abilities[index].title]]));
    if (name === 'Akali') {
      const second = page('Template:Data Akali/Q second', 'raw/akali/q-second.wikitext', '|leveling3 = {{ap|70*0.7 to 350*0.7}}\n');
      abilities.push(second);
      slots.Q.push(second.title);
    }
    const metadataRelPath = `champions/${slug}.json`;
    put(`${PATHS.wikiRoot}/${metadataRelPath}`, { wikiChampionTitle: name, resolvedTitle: name, slots,
      page: page(name, `raw/${slug}/champion.wikitext`, `Champion ${name}\n`), abilities });
    manifestRows.push({ title: name, resolvedTitle: name, metadataRelPath, abilityPageCount: abilities.length });
    abilityCount += abilities.length;
  }
  put(`${PATHS.wikiRoot}/manifest.json`, {
    schemaVersion: 'lol-wiki-full-champion-source-v1', fetchedAt: '2026-10-20T17:00:07Z',
    sourceUrl: 'https://wiki.leagueoflegends.com/en-us/List_of_champions', license: 'CC BY-SA 3.0',
    championCount: heroes.length, abilityPageCount: abilityCount,
    championList: page('List of champions', 'list-of-champions.wikitext', heroes.join('\n')),
    dependencies: [page('Template:Pplevel', 'dependencies/template-pplevel.wikitext', '{{#invoke:Ability progression|pplevel}}\n')],
    champions: manifestRows,
  });
  const rows = heroes.flatMap(name => SLOTS.map(slot => ({ sourceChampionId: name, slot,
    skillKey: `${name.toLowerCase()}_${slot.toLowerCase()}`, name: `${name} ${slot}`, conclusionScope: '技能范围内数据与机制',
    conclusion: name === 'Annie' ? '系统暂缓' : name === 'Akali' && slot === 'W' ? '明确排除' : '资料待核',
    reason: '固定合成测试资料，不对应真实游戏配置。', pendingCounts: { source: name === 'Annie' ? 0 : 1, system: 0, configuration: 1 },
  })));
  const selectedHeroes = heroes.slice(0, 2).map(name => ({ sourceChampionId: name, characterKey: `champion_${name.toLowerCase()}`,
    name, skillKeys: rows.filter(row => row.sourceChampionId === name).map(row => row.skillKey) }));
  put(PATHS.ledger, { generatedAt: '2026-10-23T16:40:24Z', sourceVersion: '16.17.1', gameId: 'lol',
    heroes: { priorityScope: { batches: [{ order: 1, name: '测试批次', heroes: selectedHeroes }],
      selectionSnapshot: { heroCount: 50, sourceSkillSlots: 250 }, scopeConfirmation: { heroCount: 2, sourceSkillSlots: 10 } } },
    inventoryConclusions: { characters: heroes.map(name => ({ sourceChampionId: name, characterKey: `champion_${name.toLowerCase()}`, conclusion: '已录入' })),
      skills: rows, coverage: { skills: { sourceItems: 865, managementCompleteItems: 999 } } },
  });
  put(PATHS.proof, { schemaVersion: 'simulation-verification-v1', gameId: 'lol', profile: 'combat-analysis-v1',
    digestVersion: 'simulation-availability-v1', scopeDigest: HASH, sharedDigest: HASH, wasmSha256: HASH, adapterVersion: 'v1-fixture',
    entries: [{ kind: 'CHARACTER', key: 'champion_annie', contentDigest: HASH, externalDigest: HASH, outcome: 'PASSED',
      coverage: { scenario: 'one-way-combat-analysis-v1', skills: SLOTS.map(slot => ({ skillKey: `annie_${slot.toLowerCase()}`, levels: [1] })) },
      evidenceRefs: ['fixture/independent-review.json'], issues: [] }],
  });
  put(PATHS.runtimeScope, { schemaVersion: 'simulation-priority-scope-v1', gameId: 'lol', profile: 'combat-analysis-v1', equipment: [],
    characters: selectedHeroes.map(hero => ({ key: hero.characterKey, sourceChampionId: hero.sourceChampionId,
      expectedSkills: SLOTS.map(slot => ({ slot, key: `${hero.sourceChampionId.toLowerCase()}_${slot.toLowerCase()}`,
        excluded: hero.sourceChampionId === 'Akali' && slot === 'W' })) })),
  });
  return { root, put, edit, originals, prepare: () => prepareReports({ repoRoot: root }) };
}
const code = expected => error => error.code === expected;
function hashes(root, prefix = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    if (relative === 'output') continue;
    if (entry.isDirectory()) result.push(...hashes(root, relative));
    else result.push([relative, sha256(fs.readFileSync(path.join(root, relative)))]);
  }
  return result;
}

test('先筛当前稳定英雄标识再计算分母，忽略50名历史快照与全局计数', t => {
  const f = fixture(t);
  const prepared = f.prepare();
  assert.deepEqual(prepared.counts, { heroCount: 2, sourceSkillSlots: 10, excludedSkillSlots: 1, managementDenominator: 9,
    managementCompleteSkillSlots: 0, sourcePendingConclusionSkillSlots: 4, systemDeferredSkillSlots: 5,
    openSkillSlots: 9, wholeHeroManagementComplete: 0, characterSubjectsComplete: 2, sourceReviewQueue: 4 });
  assert.deepEqual(prepared.queue.map(row => row.skillKey), ['akali_p', 'akali_q', 'akali_e', 'akali_r']);
  assert.equal(prepared.reconciliation.formalScope.differences.length, 0);
  assert.equal(prepared.reconciliation.reviewHints[0].code, 'PASSED_PROOF_WITH_OPEN_MANAGEMENT');
  assert.equal(prepared.reconciliation.reviewHints[0].characterKey, 'champion_annie');
  assert.equal(prepared.reconciliation.heroes[0].ledger[0].conclusion, '系统暂缓');
});

test('整页原文与多份槽位正文原样保留，不将正则数字变为配置', t => {
  const f = fixture(t);
  const first = f.prepare();
  const second = f.prepare();
  assert.deepEqual([...first.files], [...second.files]);
  const q = first.cards.find(card => card.skillKey === 'akali_q');
  assert.equal(q.pages.length, 2);
  for (const card of first.cards) for (const page of card.pages) {
    assert.equal(page.excerpt.text, f.originals.get(page.rawPath));
    assert.equal(page.sha256, sha256(page.excerpt.text));
    assert.match(page.revisionUrl, /oldid=\d+$/);
    assert.equal(page.excerpt.startLine, 1);
    assert.equal(page.excerpt.endLine, page.excerpt.text.trimEnd().split('\n').length);
  }
  assert.match(q.pages[0].excerpt.text, /then \+ 9\*x for 6/);
  assert.equal(q.formula, undefined);
});

test('原文有UTF-8字节顺序标记时，来源卡仍保留完整字节对应正文', t => {
  const f = fixture(t);
  const relative = `${PATHS.wikiRoot}/raw/akali/p.wikitext`;
  const original = `\uFEFF${f.originals.get(relative)}`;
  f.put(relative, original);
  f.edit(`${PATHS.wikiRoot}/champions/akali.json`, x => {
    x.abilities[0].rawByteSize = Buffer.byteLength(original);
    x.abilities[0].contentSha256 = sha256(original);
  });
  const page = f.prepare().cards.find(card => card.skillKey === 'akali_p').pages[0];
  assert.equal(page.excerpt.text, original);
  assert.equal(sha256(page.excerpt.text), page.sha256);
});

test('生成与 --check 均不修改输入，重复生成同字节不写盘', t => {
  const f = fixture(t);
  const before = hashes(f.root);
  const result = writeOrCheckReports(f.prepare());
  assert.equal(result.filesWritten, 5);
  const output = path.join(f.root, PATHS.output);
  const stats = fs.readdirSync(output).map(name => [name, fs.statSync(path.join(output, name)).mtimeMs]);
  assert.equal(writeOrCheckReports(f.prepare()).filesWritten, 0);
  const cli = spawnSync(process.execPath, [CLI, '--repo-root', f.root, '--check'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).filesWritten, 0);
  assert.deepEqual(hashes(f.root), before);
  assert.deepEqual(fs.readdirSync(output).map(name => [name, fs.statSync(path.join(output, name)).mtimeMs]), stats);
});

test('畸形JSON与缺少稳定标识不会被接受', async t => {
  await t.test('无效 JSON', t => {
    const f = fixture(t); f.put(PATHS.ledger, '{');
    assert.throws(f.prepare, code('INVALID_JSON'));
  });
  await t.test('缺少角色标识', t => {
    const f = fixture(t); f.edit(PATHS.ledger, x => { delete x.heroes.priorityScope.batches[0].heroes[0].characterKey; });
    assert.throws(f.prepare, code('INVALID_SCOPE'));
  });
  await t.test('重复英雄', t => {
    const f = fixture(t); f.edit(PATHS.ledger, x => x.heroes.priorityScope.batches[0].heroes.push(x.heroes.priorityScope.batches[0].heroes[0]));
    assert.throws(f.prepare, code('INVALID_SCOPE'));
  });
  await t.test('缺槽', t => {
    const f = fixture(t); f.edit(PATHS.ledger, x => x.inventoryConclusions.skills.shift());
    assert.throws(f.prepare, code('INCOMPLETE_SCOPE_SKILLS'));
  });
  await t.test('负分支计数', t => {
    const f = fixture(t); f.edit(PATHS.ledger, x => { x.inventoryConclusions.skills[0].pendingCounts.source = -1; });
    assert.throws(f.prepare, code('INVALID_PENDING_COUNTS'));
  });
});

test('原文缺失、等长摘要变化和字节数变化分别报告', async t => {
  const relative = `${PATHS.wikiRoot}/raw/akali/p.wikitext`;
  await t.test('缺原文', t => {
    const f = fixture(t); fs.unlinkSync(path.join(f.root, relative));
    assert.throws(f.prepare, error => error.code === 'INPUT_NOT_FOUND' && error.details.path === relative);
  });
  await t.test('摘要变化', t => {
    const f = fixture(t); f.put(relative, f.originals.get(relative).replace('trigger', 'Trigger'));
    assert.throws(f.prepare, error => error.code === 'SOURCE_SHA256_MISMATCH' && error.details.path === relative);
  });
  await t.test('字节数变化', t => {
    const f = fixture(t); f.put(relative, `${f.originals.get(relative)}extra`);
    assert.throws(f.prepare, code('SOURCE_BYTES_MISMATCH'));
  });
});

test('清单总数、错误路径和缺少槽位正文均拒绝', async t => {
  await t.test('总数不符', t => {
    const f = fixture(t); f.edit(`${PATHS.wikiRoot}/manifest.json`, x => { x.abilityPageCount += 1; });
    assert.throws(f.prepare, code('ABILITY_COUNT_MISMATCH'));
  });
  await t.test('原文路径回退', t => {
    const f = fixture(t); f.edit(`${PATHS.wikiRoot}/champions/akali.json`, x => { x.abilities[0].rawRelPath = '../阶段进度.json'; });
    assert.throws(f.prepare, code('UNSAFE_PATH'));
  });
  await t.test('槽位未收录', t => {
    const f = fixture(t); f.edit(`${PATHS.wikiRoot}/champions/akali.json`, x => { x.slots.Q = ['missing']; });
    assert.throws(f.prepare, code('MISSING_SLOT_SOURCE'));
  });
});

test('固定审核卡核对修订与完整原文，页面变更不能沿用旧卡', async t => {
  await t.test('旧修订', t => {
    const f = fixture(t);
    const before = f.prepare();
    f.put(PATHS.reviewCards, { schemaVersion: 'data-readiness-reviewed-source-cards-v1', ledgerSourceVersion: '16.17.1',
      wikiManifestSha256: before.sourceIndex.wiki.manifestSha256,
      cards: before.cards.map(sourceCard => ({ sourceCard, fieldsToReview: ['核对等级与施放时序'] })) });
    assert.equal(f.prepare().sourceIndex.reviewedCards.cardCount, 4);
    f.edit(`${PATHS.wikiRoot}/champions/akali.json`, x => { x.abilities[0].revisionId += 1; });
    assert.throws(f.prepare, code('REVIEW_CARD_SOURCE_MISMATCH'));
  });
  await t.test('固定版本变化', t => {
    const f = fixture(t);
    const before = f.prepare();
    f.put(PATHS.reviewCards, { schemaVersion: 'data-readiness-reviewed-source-cards-v1', ledgerSourceVersion: '16.18.1',
      wikiManifestSha256: before.sourceIndex.wiki.manifestSha256,
      cards: before.cards.map(sourceCard => ({ sourceCard, fieldsToReview: ['核对固定游戏版本'] })) });
    assert.throws(f.prepare, code('REVIEW_SOURCE_VERSION_MISMATCH'));
  });
});

test('正式证明重复或无效条目不会被计数', t => {
  const f = fixture(t); f.edit(PATHS.proof, x => x.entries.push(x.entries[0]));
  assert.throws(f.prepare, code('INVALID_PROOF_ENTRY'));
});

test('正式证明改变时 --check 明确报漂移，保留所有已有报告', t => {
  const f = fixture(t); writeOrCheckReports(f.prepare());
  const target = path.join(f.root, PATHS.output, 'reconciliation.json');
  const before = fs.readFileSync(target);
  f.edit(PATHS.proof, x => { x.adapterVersion = 'v2-fixture'; });
  assert.throws(() => writeOrCheckReports(f.prepare(), { check: true }), code('REPORT_DRIFT'));
  assert.deepEqual(fs.readFileSync(target), before);
});

test('拒绝输出到资料、仓库根或仓库外，输出目录联接点也拒绝', t => {
  const f = fixture(t);
  for (const output of ['.', '数据参考/新报告', '../outside', 'output']) {
    assert.throws(() => outputDirectory(f.root, output), code('UNSAFE_OUTPUT_PATH'));
  }
  fs.symlinkSync(path.join(f.root, '数据参考'), path.join(f.root, 'output'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => outputDirectory(f.root), code('UNSAFE_OUTPUT_PATH'));
});

test('大小写变体也不能写入 output 根，按当前平台路径语义检查', t => {
  const f = fixture(t);
  // Windows 三种拼法都指同一目录；其他平台的大写目录也不在允许的 output 内。
  for (const output of ['output', 'OUTPUT', 'Output', path.join(f.root, 'OUTPUT')]) {
    assert.throws(() => outputDirectory(f.root, output), code('UNSAFE_OUTPUT_PATH'));
  }
  if (process.platform === 'win32') {
    assert.equal(path.relative(path.join(f.root, 'output'), path.join(f.root, 'OUTPUT')), '');
    assert.equal(outputDirectory(f.root, 'OUTPUT/child'), path.join(f.root, 'OUTPUT/child'));
  } else {
    assert.throws(() => outputDirectory(f.root, 'OUTPUT/child'), code('UNSAFE_OUTPUT_PATH'));
    assert.equal(outputDirectory(f.root, 'output/child'), path.join(f.root, 'output/child'));
  }
});

test('检测到任一不同报告前不创建其他文件，--check 缺报告不建目录', t => {
  const f = fixture(t);
  const prepared = f.prepare();
  assert.throws(() => writeOrCheckReports(prepared, { check: true }), code('REPORT_NOT_FOUND'));
  assert.equal(fs.existsSync(path.join(f.root, PATHS.output)), false);
  f.put(`${PATHS.output}/source-index.json`, '{}');
  assert.throws(() => writeOrCheckReports(prepared), code('OUTPUT_EXISTS_DIFFERENT'));
  assert.equal(fs.existsSync(path.join(f.root, PATHS.output, 'queue.json')), false);
  assert.equal(fs.readFileSync(path.join(f.root, PATHS.output, 'source-index.json'), 'utf8'), '{}');
});

test('系统暂缓中显式资料缺口仍进队列，计数差异只提示不改状态', t => {
  const f = fixture(t);
  f.edit(PATHS.ledger, x => {
    x.inventoryConclusions.skills.find(row => row.skillKey === 'annie_q').pendingCounts.source = 1;
    x.heroes.priorityScope.scopeConfirmation = { heroCount: 50, sourceSkillSlots: 250 };
  });
  const prepared = f.prepare();
  assert.equal(prepared.counts.sourceReviewQueue, 5);
  assert.equal(prepared.queue[0].skillKey, 'annie_q');
  assert.equal(prepared.queue[0].conclusion, '系统暂缓');
  assert.equal(prepared.counts.managementDenominator, 9);
  assert.equal(prepared.reconciliation.reviewHints.filter(hint => hint.code === 'DECLARED_SCOPE_COUNT_DIFFERENCE').length, 2);
});
