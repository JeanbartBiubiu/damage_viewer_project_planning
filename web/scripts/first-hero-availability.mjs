/**
 * 首完整英雄的真实只读浏览器采集。所有业务标识只在本验收夹具中使用。
 * 默认仅输出计划；收到最终数据和正式产物就绪通知后：
 * node scripts/first-hero-availability.mjs --read-plan --mode all （只读GET生成真实计划）
 * SIMULATION_EXPECTED_WASM_SHA256=... node scripts/first-hero-availability.mjs --execute --mode pilot
 * SIMULATION_EXPECTED_WASM_SHA256=... node scripts/first-hero-availability.mjs --execute --mode all
 * 不启动服务、不修改业务数据、不安装正式可用性证明。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiBase = process.env.SIMULATION_LIVE_API_BASE_URL ?? 'http://127.0.0.1:8080';
const webBase = process.env.SIMULATION_WEB_BASE_URL ?? 'http://127.0.0.1:5173';
const token = process.env.SIMULATION_LIVE_ADMIN_TOKEN ?? 'local-readonly-check';
const keyIndex = process.argv.indexOf('--character');
const characterKey = keyIndex < 0 ? 'champion_annie' : process.argv[keyIndex + 1];
assert(/^[a-z][a-z0-9_]{0,63}$/.test(characterKey), '角色键不合法');
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex < 0 ? 'pilot' : process.argv[modeIndex + 1];
assert(['pilot', 'all'].includes(mode), '--mode 只接受 pilot 或 all');
const readPlan = process.argv.includes('--read-plan');
const execute = process.argv.includes('--execute');
assert(!(readPlan && execute), '--read-plan 与 --execute 不能同时使用');
const stressIndex = process.argv.indexOf('--stress-iterations');
const stressIterations = stressIndex < 0 ? 100 : Number(process.argv[stressIndex + 1]);
assert(Number.isSafeInteger(stressIterations) && stressIterations >= 2 && stressIterations <= 1000, '同会话压力重复数应为2..1000');
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const outIndex = process.argv.indexOf('--output');
const outputRoot = outIndex < 0 ? resolve(webRoot, `output/first-hero-2026-10-17/${stamp}-${mode}`)
  : resolve(webRoot, process.argv[outIndex + 1]);
assert(outputRoot.startsWith(resolve(webRoot, 'output/first-hero-2026-10-17') + '\\')
  || outputRoot.startsWith(resolve(webRoot, 'output/first-hero-2026-10-17') + '/'), '输出必须位于本专项目录');
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (left, right, label) => assert.deepEqual(canonical(left), canonical(right), label);
const save = (name, value) => {
  const path = resolve(outputRoot, name);
  mkdirSync(dirname(path), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); writeFileSync(path, bytes);
  return { path: relative(webRoot, path).replaceAll('\\', '/'), sha256: hash(bytes), bytes: bytes.length };
};
const raw = (name, value) => {
  const path = resolve(outputRoot, `${name}.json.gz`);
  mkdirSync(dirname(path), { recursive: true });
  const bytes = gzipSync(Buffer.from(JSON.stringify(value)), { level: 6 }); writeFileSync(path, bytes);
  return { path: relative(webRoot, path).replaceAll('\\', '/'), sha256: hash(bytes), bytes: bytes.length };
};
if (!execute && !readPlan) {
  console.log(JSON.stringify({ mode: 'plan-only', characterKey, liveRequests: 0, businessWrites: 0,
    coverage: '读取后端requiredCoverage；双方每个角色等级；每个必需技能各级与主动0级另验；全部必需来源启用，背景普攻保留',
    execution: '--read-plan只读GET构造真实页面顺序计划；设置SIMULATION_EXPECTED_WASM_SHA256后加 --execute；--mode pilot先运行首末等级，再 --mode all；all另含30秒页面顺序及反序',
    limitation: '真实矩阵不自动签发PASSED；相关被动及机制专项由独立核对后决定' }, null, 2));
  process.exit(0);
}
if (execute) assert(/^[a-f0-9]{64}$/.test(process.env.SIMULATION_EXPECTED_WASM_SHA256 ?? ''), '必须显式设置最终正式Wasm摘要');
const requests = { get: 0, snapshotPost: 0, businessWrites: [] };
const browserErrors = [];
let computeWorkers = 0;
const results = [];
const files = [];
let identity, before, after;
let plannedCaseCount = 0;
const sourceFiles = ['scripts/first-hero-availability.mjs', 'tests/fixtures/firstHeroWorker.ts'];
mkdirSync(outputRoot, { recursive: true });
const sources = sourceFiles.map(path => {
  const bytes = readFileSync(resolve(webRoot, path));
  writeFileSync(resolve(outputRoot, path.replaceAll('/', '-')), bytes);
  return { path, sha256: hash(bytes), bytes: bytes.length };
});
const productionSourcePaths = ['src/engine', 'src/services', 'src/types'].flatMap(directory => readdirSync(resolve(webRoot, directory), { recursive: true })
  .filter(path => typeof path === 'string' && path.endsWith('.ts') && !path.endsWith('.test.ts'))
  .map(path => directory + '/' + path.replaceAll('\\', '/')));
const productionSources = [...productionSourcePaths, 'src/pages/simulation/combatSkillRoster.ts',
  'src/pages/simulation/simulationAutomaticSkillDrafts.ts'].map(file => {
    const bytes = readFileSync(resolve(webRoot, file));
    return { path: file, sha256: hash(bytes), bytes: bytes.length };
  }).sort((a, b) => a.path.localeCompare(b.path));
files.push(save('production-source-manifest.json', productionSources));
let explicitInputs = null;
if (process.env.SIMULATION_ATTRIBUTE_INPUTS_FILE) {
  const path = resolve(webRoot, process.env.SIMULATION_ATTRIBUTE_INPUTS_FILE), bytes = readFileSync(path);
  explicitInputs = JSON.parse(bytes.toString('utf8'));
  assert(explicitInputs.source && explicitInputs.target && Array.isArray(explicitInputs.evidence) && explicitInputs.evidence.length,
    '明确场景属性必须提供source、target和非空evidence');
  for (const side of ['source', 'target']) assert(Object.values(explicitInputs[side]).every(Number.isFinite), '明确属性必须全部有限数值');
  files.push(save('explicit-attribute-inputs.json', { path, sha256: hash(bytes), ...explicitInputs }));
}
async function api(suffix, body) {
  assert(body === undefined || suffix === 'simulation-snapshot', '禁止业务写请求');
  if (body === undefined) requests.get++; else requests.snapshotPost++;
  const response = await fetch(`${apiBase}/api/admin/games/lol/${suffix}`, { method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store', headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (response.status !== 200) {
    const text = await response.text();
    files.push(save(`http-failures/${requests.get}-${requests.snapshotPost}.json`, {
      method: body === undefined ? 'GET' : 'POST', path: suffix, status: response.status, request: body, response: text
    }));
    throw new Error(`${suffix.split('?')[0]} HTTP ${response.status}: ${text}`);
  }
  return response.json();
}
const observedProofIdentity = (directory, entry) => ({ gameId: directory.gameId, profile: directory.profile,
  digestVersion: directory.digestVersion, scopeDigest: directory.scopeDigest, sharedDigest: directory.sharedDigest,
  key: entry.key, contentDigest: entry.contentDigest, externalDigest: entry.verification.externalDigest,
  coverage: entry.verification.requiredCoverage, ...identity });
function numericalAssertions(result) {
  const checks = [];
  const close = (actual, expected, label) => {
    assert(typeof actual === 'number' && Number.isFinite(actual)
      && Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(actual), Math.abs(expected)), `${label}: ${actual} != ${expected}`);
    checks.push({ label, actual, expected });
  };
  const { snapshot, prepared, done } = result;
  const baseValue = (side, key) => {
    const base = snapshot[side].selectedLevelValues[key] ?? result.attributes[side][key];
    if (!Number.isFinite(base)) return base;
    return base + snapshot[side].selectedEquipment.reduce((total, item) => total + (item.attributes.attributeValues[key] ?? 0), 0);
  };
  for (const side of ['source', 'target']) assert(snapshot[side].selectedEquipment.every(item => item.attachedSkills.length === 0),
    '组合专项只覆盖已核纯属性装备，不把未核装备技能当作已执行');
  const final = side => done.finalSnapshot.combatants.find(row => row.key === side);
  const executionFacts = result.actualSkillExecutionFacts ?? (done.automaticSkillRecords ?? []).map(row => {
    const rule = result.runRequest.driverPlan.automaticSkills.rules.find(rule => rule.ruleKey === row.ruleKey);
    const binding = prepared.compileRequest.rules.skillActionBindings.find(binding => binding.bindingKey === rule.bindingKey);
    return { ...row, side: binding.source, skillKey: binding.skillKey };
  });
  const parameter = (skillKey, parameterKey, side) => {
    const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === skillKey);
    const row = configuration?.parameters.find(row => row.parameterKey === parameterKey);
    assert(row, `缺少真实参数 ${skillKey}.${parameterKey}`);
    const rank = snapshot[side].skillSources.find(source => source.skillKey === skillKey && source.origin.kind === 'CHARACTER')?.skillLevel;
    const value = row.valueMode === 'FIXED' ? row.fixedValue
      : row.levelValues[row.valueMode === 'CHARACTER_LEVEL' ? snapshot.selection[`${side}Level`] : rank];
    assert(Number.isFinite(value), `参数不是明确数值 ${skillKey}.${parameterKey}`); return value;
  };
  for (const side of ['source', 'target']) {
    const rank = snapshot[side].skillSources.find(row => row.skillKey === 'annie_r')?.skillLevel;
    const basePen = baseValue(side, 'magic_pen_percent');
    assert(Number.isFinite(basePen), '法穿固有值必须真实存在');
    const ratio = rank > 0 ? parameter('annie_r', 'magic_penetration_ratio', side) : 0;
    close(final(side).attributes.magic_pen_percent.resolved, 1 - (1 - basePen) * (1 - ratio), `${side} R已学常驻法穿`);
    const starts = executionFacts.filter(row => row.kind === 'STARTED' && row.skillKey === 'annie_r' && row.side === side);
    if (side === 'target') assert.equal(starts.length, 0, '目标方不自主施法，R常驻属性仍应生效');
  }
  const originByDefinition = new Map(prepared.skillOrigins.filter(row => row.side === 'source' && row.definitionRef)
    .map(row => [row.definitionRef, row.skillKey]));
  for (const row of done.damageRecords) {
    assert.equal(row.source, 'source', '正常矩阵目标没有已施护盾，不应产生反伤'); assert.equal(row.target, 'target');
    const ability = /^(source|target)\.provider\[([^\]]+)\]\.ability\[[^\]]+\]$/.exec(row.abilityRef);
    const mount = ability && prepared.compileRequest.combatants.find(actor => actor.key === ability[1])?.providers
      .find(provider => provider.providerRef === ability[2]);
    const skillKey = originByDefinition.get(row.providerDefinitionRef ?? mount?.definitionRef);
    if (['annie_q', 'annie_w', 'annie_r'].includes(skillKey)) {
      const expected = parameter(skillKey, 'base_damage', 'source')
        + parameter(skillKey, 'ap_ratio', 'source') * baseValue('source', 'ability_power');
      close(row.rawAmount, expected, `${skillKey} 真实技能等级与法强伤害`);
      assert.equal(row.damageType, 'magic');
    }
    const resistance = row.damageType === 'magic' ? final('target').attributes.magic_resistance.resolved
      : final('target').attributes.armor.resolved;
    const percent = row.damageType === 'magic' ? final('source').attributes.magic_pen_percent.resolved
      : final('source').attributes.armor_pen_percent.resolved;
    const flat = row.damageType === 'magic' ? final('source').attributes.magic_pen_flat.resolved
      : final('source').attributes.armor_pen_flat.resolved;
    assert(Number.isFinite(resistance) && Number.isFinite(percent) && Number.isFinite(flat), '抗性/穿透必须真实存在');
    const effective = Math.min(resistance, Math.max(0, resistance * (1 - Math.min(1, Math.max(0, percent))) - Math.max(0, flat)));
    const factor = 100 / (100 + Math.max(effective, 0)) - Math.min(effective, 0) / (100 - Math.min(effective, 0));
    close(row.resistanceFactor, factor, '真实抗性与法穿被伤害消费');
    close(row.postDefenseDamage, row.rawAmount * factor, '逐笔后防御伤害');
  }
  assert.equal(done.summary.targetDamageDealt, 0, '目标不自主攻击');
  close(done.summary.targetFinalHp, result.initialHealth.target - done.summary.targetHpLoss, '真实目标生命账');
  return checks;
}
const browser = await chromium.launch({ headless: true });
const pages = [];
let fatal = null;
try {
  async function pageClient() {
    const page = await browser.newPage(); pages.push(page);
    page.on('worker', () => { computeWorkers++; });
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (['PUT', 'PATCH', 'DELETE', 'POST'].includes(request.method()) && !url.pathname.endsWith('/simulation-snapshot')) {
        requests.businessWrites.push({ method: request.method(), path: url.pathname });
      }
    });
    await page.goto(webBase + '/');
    const loaded = await page.evaluate(async () => {
      const { SIMULATION_AVAILABILITY_IDENTITY } = await import('/src/services/simulationAvailabilityClient.ts');
      const response = await fetch('/src/engine/wasm/tinygo_engine_v2.wasm');
      if (!response.ok) throw new Error(`Wasm读取HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      return { identity: SIMULATION_AVAILABILITY_IDENTITY, bytes: bytes.byteLength,
        sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('') };
    });
    assert.equal(loaded.sha256, loaded.identity.wasmSha256);
    if (execute) assert.equal(loaded.sha256, process.env.SIMULATION_EXPECTED_WASM_SHA256);
    const local = readFileSync(resolve(webRoot, 'src/engine/wasm/tinygo_engine_v2.wasm'));
    assert.equal(hash(local), loaded.sha256); assert.equal(local.length, loaded.bytes);
    if (identity) equal(identity, loaded.identity, '独立浏览器页身份不一致');
    else identity = loaded.identity;
    return page;
  }
  const page = await pageClient();
  before = await api('simulation-availability?' + new URLSearchParams(identity));
  files.push(save('directory-before.json', before));
  const entry = before.characters.find(row => row.key === characterKey);
  assert(entry, '目录中缺少待验英雄');
  assert.equal(entry.excludedSkillSources.length, 0, '本入口未实现部分技能排除，不隐式关闭来源');
  if (execute) assert(!['CONFIGURATION_INCOMPLETE', 'OUT_OF_SCOPE', 'ENGINE_UNSUPPORTED'].includes(entry.status),
    `配置/引擎尚未就绪：${JSON.stringify(entry.issues)}`);
  const required = entry.verification.requiredCoverage;
  assert(required && required.equipmentMode === 'none' && required.allRequiredSourcesEnabled === true);
  equal(required.sides, ['source', 'target'], '必须双侧覆盖');
  const [relations, levelConfig, calculationRules] = await Promise.all([api('character-skill-relations?characterKey=' + characterKey),
    api('level-config'), api('calculation-rules')]);
  const levels = Array.from({ length: levelConfig.maxLevel - levelConfig.minLevel + 1 }, (_, index) => levelConfig.minLevel + index);
  equal(required.characterLevels, levels, '后端所需角色等级发生变化');
  const configs = new Map();
  for (const skill of required.skills) configs.set(skill.skillKey, await api('skills/' + skill.skillKey + '/configuration'));
  files.push(save('author-configurations.json', [...configs.values()]));
  files.push(save('relations.json', relations));
  assert(calculationRules.configuration?.basicAttackCategoryKey, '真实游戏未绑定普攻用途分类');
  const basics = [...configs.values()].filter(row => row.skill.skillCategoryKeys.includes(calculationRules.configuration.basicAttackCategoryKey));
  assert.equal(basics.length, 1, '测试入口需要按当前目录唯一普攻');
  const basic = basics[0].skill.skillKey;
  const maxRanks = Object.fromEntries(required.skills.map(skill => [skill.skillKey, skill.levels.at(-1)]));
  for (const skill of required.skills) assert.equal(configs.get(skill.skillKey).skill.maxLevel, skill.levels.at(-1));
  const minRanks = Object.fromEntries(required.skills.map(skill => [skill.skillKey, 1]));
  const settings = ranks => relations.items.filter(row => row.skillStatus === 'ENABLED').map(row => {
    assert(Object.hasOwn(ranks, row.skillKey), `真实已启用关系 ${row.skillKey} 不在完整coverage中`);
    return { origin: { kind: 'CHARACTER', characterKey }, skillKey: row.skillKey, enabled: true, skillLevel: ranks[row.skillKey] };
  });
  const active = await page.evaluate(async input => {
    const { firstHeroCombatRules } = await import('/tests/fixtures/firstHeroWorker.ts');
    return firstHeroCombatRules(input).rules.map(rule => rule.skillKey);
  }, { characterKey, relations: relations.items, configurations: [...configs.values()],
    basicAttackCategoryKey: calculationRules.configuration.basicAttackCategoryKey, settings: settings(maxRanks) });
  assert(active.length, '没有真实首次主动入口');
  const cases = [];
  const maxLevel = levels.at(-1), minLevel = levels[0];
  function addCase(id, owner, level, sourceRanks, targetRanks, checkRecordVariants = false, equipmentKeys = [],
    { durationMs = 2500, ruleOrder = 'ui' } = {}) {
    const sourcePlans = active.filter(key => sourceRanks[key] > 0).map(skillKey => ({ origin: { kind: 'CHARACTER', characterKey },
      skillKey, skillLevel: sourceRanks[skillKey], phaseKinds: ['INITIAL'] }));
    const selection = { sourceCharacterKey: characterKey, targetCharacterKey: characterKey,
      sourceLevel: owner === 'source' ? level : minLevel, targetLevel: owner === 'target' ? level : maxLevel,
      basicAttackSkillKey: basic, basicAttackLevel: sourceRanks[basic], plannedSkills: sourcePlans,
      sourceEquipmentKeys: owner === 'source' ? equipmentKeys : [], targetEquipmentKeys: owner === 'target' ? equipmentKeys : [],
      sourceBuildConfigurations: [], targetBuildConfigurations: [],
      sourceSkillSettings: settings(sourceRanks), targetSkillSettings: settings(targetRanks) };
    cases.push({ id, owner, level, sourceRanks, targetRanks, selection, options: { mode: sourcePlans.length ? 'automatic' : 'continuous',
      durationMs, ruleOrder, iterations: checkRecordVariants ? stressIterations : 2,
      expectedStartedSkillKeys: (ruleOrder === 'reverse' ? [...sourcePlans].reverse() : sourcePlans).map(row => row.skillKey), checkRecordVariants } });
  }
  for (const level of (mode === 'pilot' ? [minLevel, maxLevel] : levels)) {
    addCase(`source-level-${level}`, 'source', level, maxRanks, maxRanks, level === minLevel);
    addCase(`target-level-${level}`, 'target', level, minRanks, maxRanks, false);
  }
  if (mode === 'all') for (const owner of required.sides) for (const skill of required.skills) {
    const ranks = active.includes(skill.skillKey) ? [0, ...skill.levels.slice(0, -1)] : skill.levels.slice(0, -1);
    for (const rank of ranks) addCase(`${owner}-${skill.skillKey}-rank-${rank}`, owner, maxLevel,
      owner === 'source' ? { ...maxRanks, [skill.skillKey]: rank } : minRanks,
      owner === 'target' ? { ...maxRanks, [skill.skillKey]: rank } : maxRanks);
  }
  if (mode === 'all') for (const ruleOrder of ['ui', 'reverse']) {
    addCase(`source-level-${maxLevel}-${ruleOrder}-order-30s`, 'source', maxLevel, maxRanks, maxRanks, false, [], { durationMs: 30000, ruleOrder });
  }
  const gearIndex = process.argv.indexOf('--equipment-keys');
  const gearKeys = gearIndex < 0 ? [] : process.argv[gearIndex + 1].split(',');
  assert(gearKeys.length <= 6 && new Set(gearKeys).size === gearKeys.length);
  for (const key of gearKeys) {
    assert(/^[a-z][a-z0-9_]{0,63}$/.test(key), '装备键不合法');
    const equipment = before.equipment.find(row => row.key === key);
    assert(equipment?.status === 'READY' && equipment.verification.matched === true,
      `${key}尚未在当前正式身份取得独立装备证明，不能按历史READY混入代表组合`);
  }
  if (mode === 'all' && gearKeys.length) for (const side of required.sides) {
    addCase(`${side}-reviewed-equipment-combination`, side, maxLevel, side === 'source' ? maxRanks : minRanks, maxRanks, true, gearKeys);
  }
  plannedCaseCount = cases.length;
  files.push(save('case-plan.json', { characterKey, mode, identity, readiness: { status: entry.status, issues: entry.issues },
    required, activeSkillKeys: active, plannedCaseCount, cases,
    boundary: '全部真实来源启用；技能0级仅独立未学案例；target不自主施法；双方均使用同一完整真实英雄；背景普攻保留' }));
  if (readPlan) {
    assert.equal(computeWorkers, 0, '只读计划不能创建计算Worker');
    assert.equal(requests.snapshotPost, 0, '只读计划不能请求计算快照');
    assert.equal(requests.businessWrites.length, 0);
    console.log(JSON.stringify({ mode: 'read-plan', plannedCaseCount, activeSkillKeys: active,
      longCases: cases.filter(row => row.options.durationMs === 30000).map(row => ({ id: row.id, options: row.options })),
      requests, computeWorkers, outputRoot }, null, 2));
  }
  if (!readPlan) {
  const workers = [page];
  if (mode === 'all') workers.push(await pageClient());
  let next = 0;
  await Promise.all(workers.map(async worker => {
    while (next < cases.length && !fatal) {
      const testCase = cases[next++];
      let snapshot;
      try {
        snapshot = await api('simulation-snapshot', testCase.selection);
        for (const side of required.sides) {
          for (const skill of required.skills) {
            const source = snapshot[side].skillSources.find(row => row.skillKey === skill.skillKey && row.origin.kind === 'CHARACTER');
            assert(source?.enabled && source.skillStatus === 'ENABLED', `${side}.${skill.skillKey} 未保留启用`);
            assert.equal(source.skillLevel, testCase[`${side}Ranks`][skill.skillKey]);
          }
        }
        const result = await worker.evaluate(async ({ snapshot, selection, options }) => {
          const { runFirstHeroCase } = await import('/tests/fixtures/firstHeroWorker.ts');
          return runFirstHeroCase(snapshot, selection, options);
        }, { snapshot, selection: testCase.selection, options: { ...testCase.options,
          ...(explicitInputs ? { attributeInputs: { source: explicitInputs.source, target: explicitInputs.target } } : {}) } });
        const artifact = raw('raw/' + testCase.id, result); files.push(artifact);
        const checks = numericalAssertions(result);
        results.push({ id: testCase.id, owner: testCase.owner, level: testCase.level, passed: true, raw: artifact,
          sourceRanks: testCase.sourceRanks, targetRanks: testCase.targetRanks, snapshotDigest: snapshot.snapshotDigest,
          ruleOrder: testCase.options.ruleOrder,
          automaticRuleOrder: result.automaticRules.map(row => ({ skillKey: row.skillKey, ruleKey: row.ruleKey, sortOrder: row.sortOrder })),
          rulesHash: result.prepared.compileRequest.rulesHash, startedSkills: [...new Set(result.actualSkillExecutionFacts
            .filter(row => row.kind === 'STARTED').map(row => row.skillKey))], summary: result.done.summary,
          checks, actualRuns: result.iterations + result.variants.length, repeatedIdentical: true, released: result.release.released });
        console.log(`${testCase.id}: 真实快照/正式Worker/重复/释放通过`);
      } catch (error) {
        const diagnostics = await worker.evaluate(async () => {
          const { firstHeroFailure } = await import('/tests/fixtures/firstHeroWorker.ts'); return firstHeroFailure();
        }).catch(() => null);
        const artifact = raw('failures/' + testCase.id, { testCase, snapshot, error: error.message, diagnostics }); files.push(artifact);
        fatal = error; results.push({ id: testCase.id, passed: false, message: error.message, raw: artifact });
        console.error(`${testCase.id}: ${error.message}`);
      }
      save('progress.json', { identity, mode, results, requests });
    }
  }));
  after = await api('simulation-availability?' + new URLSearchParams(identity));
  files.push(save('directory-after.json', after));
  equal(observedProofIdentity(before, entry), observedProofIdentity(after, after.characters.find(row => row.key === characterKey)),
    '采集期间作者配置、共享定义或正式身份改变');
  for (const key of gearKeys) equal(observedProofIdentity(before, before.equipment.find(row => row.key === key)),
    observedProofIdentity(after, after.equipment.find(row => row.key === key)), '代表组合的装备身份在采集期间发生变化');
  for (const file of sources) assert.equal(hash(readFileSync(resolve(webRoot, file.path))), file.sha256, '采集脚本在运行时变化');
  for (const file of productionSources) assert.equal(hash(readFileSync(resolve(webRoot, file.path))), file.sha256,
    `采集期间宿主源码发生变化：${file.path}；本轮证据不得签发`);
  assert.equal(hash(readFileSync(resolve(webRoot, 'src/engine/wasm/tinygo_engine_v2.wasm'))), identity.wasmSha256);
  assert.equal(requests.businessWrites.length, 0); assert.equal(browserErrors.length, 0);
  if (fatal) throw fatal;
  assert.equal(results.length, cases.length);
  files.push(save('coverage-evidence-candidate.json', { identity: observedProofIdentity(before, entry), passedExecutionCases: results,
    actualCoverage: { sides: [...new Set(results.map(row => row.owner))],
      characterLevels: [...new Set(results.map(row => row.level))].sort((a, b) => a - b),
      skills: required.skills.map(skill => ({ skillKey: skill.skillKey, sides: required.sides.map(side => ({ side,
        levels: [...new Set(results.map(row => row[`${side}Ranks`]?.[skill.skillKey]).filter(value => value > 0))].sort((a, b) => a - b) })) })) },
    formalProofOutcome: 'NOT_ISSUED',
    reason: '矩阵执行仅为候选证据；须独立核对相关被动、数值公式、生命周期、阻挡/空放/正常目标死亡终止和实际属性消费后才可生成PASSED',
    limitations: ['不证明独立召唤物、友军及完整控制行动限制',
      gearKeys.length ? '明确代表装备组合通过不证明任意六件组合，也不替代单件装备新身份复核' : '本次未添加装备组合，不替代装备新身份复核',
      '不把Node或静态检查计入浏览器运行数'] }));
  }
} catch (error) { fatal ??= error; }
finally {
  for (const page of pages) if (!readPlan && !page.isClosed()) await page.evaluate(async () => {
    const { terminateFirstHeroWorker } = await import('/tests/fixtures/firstHeroWorker.ts'); terminateFirstHeroWorker();
  }).catch(() => undefined);
  await browser.close();
  save('summary.json', { startedAt: stamp, completedAt: new Date().toISOString(), characterKey, mode, readPlan, identity, sources, plannedCaseCount,
    success: !fatal, message: fatal?.message ?? null, caseCount: results.length, passed: results.filter(row => row.passed).length,
    actualRuns: results.reduce((count, row) => count + (row.actualRuns ?? 0), 0), requests, browserErrors,
    independentPages: pages.length, computeWorkers, formalProofInstalled: false });
  save('raw-manifest.json', { files, sources, hashAlgorithm: 'sha256', businessWrites: requests.businessWrites.length });
}
if (fatal) throw fatal;
