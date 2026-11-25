import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { parseSimulationAvailabilityResponse, SIMULATION_AVAILABILITY_IDENTITY, simulationAvailabilityPath } from '../../src/services/simulationAvailabilityClient';
import type { SimulationAvailabilityResponse } from '../../src/types/simulationAvailability';
import { setCombatAnalysisInitialHealth } from '../fixtures/combatAnalysisPage';
import { chooseSimulationEntity, chooseSimulationLevel } from '../fixtures/simulationSelection';
import { chooseSimulationEquipment, selectedEquipment } from '../fixtures/simulationEquipmentPicker';

const output = resolve(process.env.SIMULATION_LIVE_OUTPUT_DIR || 'output/combat-analysis/availability-gate');
const api = process.env.SIMULATION_API_BASE || 'http://127.0.0.1:8080';

test.beforeEach(() => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '需要真实只读服务；跳过不计作真实目录或页面验收');
  mkdirSync(output, { recursive: true });
});

function statusCounts(response: SimulationAvailabilityResponse) {
  const count = (entries: SimulationAvailabilityResponse['characters']) => Object.fromEntries(
    [...new Set(entries.map(entry => entry.status))].map(status => [status, entries.filter(entry => entry.status === status).length]));
  return { characters: count(response.characters), equipment: count(response.equipment) };
}

type ExpectedVerification = {
  mode: 'installed-verification-file' | 'no-proof-baseline';
  file: string | null;
  sha256: string | null;
  directory: SimulationAvailabilityResponse | null;
};

function object(value: unknown, fields: string[], label: string, optional: string[] = []): Record<string, unknown> {
  expect(value, label).not.toBeNull();
  expect(typeof value, label).toBe('object');
  expect(Array.isArray(value), label).toBe(false);
  const actual = Object.keys(value as object);
  expect(actual.sort(), label).toEqual([...fields, ...optional.filter(key => actual.includes(key))].sort());
  return value as Record<string, unknown>;
}

function readExpectedVerification(): ExpectedVerification {
  const expectedWasm = process.env.SIMULATION_EXPECTED_WASM_SHA256?.toLowerCase();
  expect(expectedWasm, '真实专项必须显式指定负责人确认的正式Wasm摘要').toMatch(/^[0-9a-f]{64}$/);
  const wasm = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(wasm.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(wasm).digest('hex')).toBe(expectedWasm);
  expect(SIMULATION_AVAILABILITY_IDENTITY.wasmSha256).toBe(expectedWasm);
  const filename = process.env.SIMULATION_EXPECTED_VERIFICATION_FILE;
  if (!filename) return { mode: 'no-proof-baseline', file: null, sha256: null, directory: null };
  const file = resolve(filename);
  const bytes = readFileSync(file);
  const proof = object(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')), ['schemaVersion', 'gameId', 'profile',
    'digestVersion', 'scopeDigest', 'sharedDigest', 'wasmSha256', 'adapterVersion', 'entries'], '正式证明文件', ['mechanismRegression']);
  expect(proof.schemaVersion).toBe('simulation-verification-v1');
  expect(proof.gameId).toBe('lol');
  expect(proof.profile).toBe('combat-analysis-v1');
  expect(proof.digestVersion).toBe('simulation-availability-v1');
  expect(proof.wasmSha256).toBe(expectedWasm);
  expect(proof.adapterVersion).toBe(SIMULATION_AVAILABILITY_IDENTITY.adapterVersion);
  expect(Array.isArray(proof.entries)).toBe(true);
  const entries = (proof.entries as unknown[]).map((value, index) => {
    const row = object(value, ['kind', 'key', 'contentDigest', 'externalDigest', 'outcome', 'coverage', 'evidenceRefs', 'issues'],
      `证明条目${index}`, ['validationCases']);
    expect(['CHARACTER', 'EQUIPMENT']).toContain(row.kind);
    expect(['PASSED', 'ENGINE_UNSUPPORTED']).toContain(row.outcome);
    if (row.outcome === 'ENGINE_UNSUPPORTED') {
      expect(Array.isArray(row.issues)).toBe(true);
      expect((row.issues as unknown[]).length).toBeGreaterThan(0);
    }
    const coverage = row.coverage as Record<string, unknown>;
    expect(['each-declared-level', 'representative-cases']).toContain(coverage.levelValidation);
    return { kind: row.kind, entry: { key: row.key, status: row.outcome === 'PASSED' ? 'READY' : 'ENGINE_UNSUPPORTED',
      contentDigest: row.contentDigest, issues: row.issues, excludedSkillSources: [], verification: {
        wasmSha256: proof.wasmSha256, adapterVersion: proof.adapterVersion, externalDigest: row.externalDigest,
        requiredCoverage: { ...coverage, levelValidation: 'representative-cases' }, matched: true, evidenceRefs: row.evidenceRefs } } };
  });
  // 仅把正式文件投影为期望值并复用严格解析；不提供HTTP替身、不安装或生成任何证明。
  const directory = parseSimulationAvailabilityResponse({ gameId: proof.gameId, profile: proof.profile, digestVersion: proof.digestVersion,
    scopeDigest: proof.scopeDigest, sharedDigest: proof.sharedDigest,
    characters: entries.filter(row => row.kind === 'CHARACTER').map(row => row.entry),
    equipment: entries.filter(row => row.kind === 'EQUIPMENT').map(row => row.entry) }, 'lol');
  return { mode: 'installed-verification-file', file, sha256: createHash('sha256').update(bytes).digest('hex'), directory };
}

function assertDirectoryMatchesVerification(response: SimulationAvailabilityResponse, expected: ExpectedVerification) {
  expect(response.characters.length).toBeGreaterThan(0);
  expect(response.equipment.length).toBeGreaterThan(0);
  expect(response.gameId).toBe('lol');
  expect(response.profile).toBe('combat-analysis-v1');
  expect(response.digestVersion).toBe('simulation-availability-v1');
  if (expected.directory) {
    expect(response.scopeDigest, '正式证明的范围摘要必须仍与服务一致').toBe(expected.directory.scopeDigest);
    expect(response.sharedDigest, '正式证明的共享配置摘要必须仍与服务一致').toBe(expected.directory.sharedDigest);
  }
  for (const kind of ['characters', 'equipment'] as const) {
    const proofs = expected.directory?.[kind] ?? [];
    const byKey = new Map(response[kind].map(entry => [entry.key, entry]));
    const currentProofs = new Map(proofs.flatMap(proof => {
      const entry = byKey.get(proof.key);
      expect(entry, `正式证明对象${proof.key}必须存在`).toBeDefined();
      return entry?.contentDigest === proof.contentDigest && entry.verification.externalDigest === proof.verification.externalDigest
        ? [[proof.key, proof] as const] : [];
    }));
    expect(response[kind].filter(entry => entry.status === 'READY').map(entry => entry.key).sort(),
      `${kind}的READY集合必须精确等于当前配置匹配的PASSED证明`).toEqual([...currentProofs.values()]
      .filter(entry => entry.status === 'READY').map(entry => entry.key).sort());
    for (const entry of response[kind]) {
      expect(entry.verification.wasmSha256).toBe(SIMULATION_AVAILABILITY_IDENTITY.wasmSha256);
      expect(entry.verification.adapterVersion).toBe(SIMULATION_AVAILABILITY_IDENTITY.adapterVersion);
      const proof = currentProofs.get(entry.key);
      if (proof) {
        expect(entry.status, `${entry.key}正式结论`).toBe(proof.status);
        expect(entry.contentDigest, `${entry.key}完整配置摘要`).toBe(proof.contentDigest);
        expect(entry.issues, `${entry.key}正式问题集合`).toEqual(proof.issues);
        expect(entry.verification, `${entry.key}匹配、外部摘要、完整覆盖与证据引用必须逐项一致`).toEqual(proof.verification);
      } else {
        expect(entry.status, `${entry.key}没有匹配当前配置的正式通过证明`).not.toBe('READY');
        expect(entry.verification.matched, `${entry.key}没有匹配的证明`).toBe(false);
        expect(entry.verification.evidenceRefs, `${entry.key}没有匹配的证明引用`).toEqual([]);
      }
    }
  }
}

test('真实维护核验目录：逐项核对已安装的英雄与装备证明', async ({ request }, testInfo) => {
  const expected = readExpectedVerification();
  const response = await request.get(api + simulationAvailabilityPath('lol'), { timeout: 100_000 });
  expect(response.status(), '读取真实目录，不替换HTTP或后端证明').toBe(200);
  const directory = parseSimulationAvailabilityResponse(await response.json(), 'lol');
  assertDirectoryMatchesVerification(directory, expected);
  const evidence = { layer: 'live-readonly-availability', requestMethod: 'GET', directory, counts: statusCounts(directory),
    expectedVerification: expected, identity: SIMULATION_AVAILABILITY_IDENTITY,
    calculationExecuted: false, wholeHeroRuntimeVerified: false };
  writeFileSync(resolve(output, 'live-directory.json'), JSON.stringify(evidence, null, 2));
  await testInfo.attach('真实完整计算目录', { body: JSON.stringify(evidence), contentType: 'application/json' });
});

test('真实页面：已录入的未通过核验角色和装备可选择', async ({ page, request }, testInfo) => {
  const game = `${api}/api/admin/games/lol`;
  const [verification, characters, equipment] = await Promise.all([
    request.get(api + simulationAvailabilityPath('lol'), { timeout: 100_000 }),
    request.get(`${game}/characters`), request.get(`${game}/equipment`)
  ]);
  expect(verification.ok() && characters.ok() && equipment.ok()).toBe(true);
  const directory = parseSimulationAvailabilityResponse(await verification.json(), 'lol');
  const characterKeys = new Set((await characters.json()).items.map((row: { characterKey: string }) => row.characterKey));
  const equipmentKeys = new Set((await equipment.json()).items.map((row: { equipmentKey: string }) => row.equipmentKey));
  const character = directory.characters.find(entry => entry.status !== 'READY' && characterKeys.has(entry.key));
  const item = directory.equipment.find(entry => entry.status !== 'READY' && equipmentKeys.has(entry.key));
  expect(character, '现场需要已录入但未通过整体验证的角色').toBeDefined();
  expect(item, '现场需要已录入但未通过整体验证的装备').toBeDefined();

  const requests: Array<{ method: string; path: string }> = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/admin/games/') && request.method() !== 'OPTIONS') {
      requests.push({ method: request.method(), path: pathname });
    }
  });
  await page.goto('/#/simulation/combat-analysis');
  await expect(page.getByRole('heading', { name: '混合战斗分析', exact: true })).toBeVisible();
  await chooseSimulationEntity(page, '攻击方角色', character!.key);
  await chooseSimulationLevel(page, '攻击方等级', 18);
  await chooseSimulationEntity(page, '目标角色', character!.key);
  await chooseSimulationLevel(page, '目标等级', 18);
  await chooseSimulationEquipment(page, '攻击方装备', item!.key);
  await expect(selectedEquipment(page, '攻击方装备').locator(`[data-equipment-key="${item!.key}"]`)).toBeVisible();
  expect(requests.every(request => request.method === 'GET' && !request.path.endsWith('/simulation-availability'))).toBe(true);
  expect(errors).toEqual([]);
  const evidence = { layer: 'live-page-selection', character, equipment: item, requests, errors };
  writeFileSync(resolve(output, 'live-page-selection.json'), JSON.stringify(evidence, null, 2));
  await testInfo.attach('真实页面选择证据', { body: JSON.stringify(evidence), contentType: 'application/json' });
});

test('真实页面：按当前技能配置完成计算并释放会话', async ({ page, request }, testInfo) => {
  const characterKey = process.env.SIMULATION_LIVE_CHARACTER_KEY || 'champion_annie';
  let proofReads = 0;
  const errors: string[] = [], workers: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  page.on('request', row => {
    const url = new URL(row.url());
    if (url.pathname.endsWith('/simulation-availability')) proofReads++;
    if (url.pathname.startsWith('/api/admin/games/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(row.method())
      && !url.pathname.endsWith('/simulation-snapshot')) writes.push(row.method() + ' ' + url.pathname);
  });
  await page.goto('/#/simulation/combat-analysis');
  const snapshotResponses: unknown[] = [];
  page.on('response', response => {
    if (new URL(response.url()).pathname.endsWith('/simulation-snapshot') && response.status() === 200) {
      void response.json().then(value => snapshotResponses.push(value));
    }
  });
  for (const [characterLabel, levelLabel] of [['攻击方角色', '攻击方等级'], ['目标角色', '目标等级']] as const) {
    await chooseSimulationEntity(page, characterLabel, characterKey);
    await expect(page.getByRole('combobox', { name: levelLabel, exact: true })).toBeEnabled({ timeout: 25_000 });
    await chooseSimulationLevel(page, levelLabel, 18);
  }
  await expect(page.getByRole('combobox', { name: '普攻技能', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '攻击方主动技能候选', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '准备计算', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /^声明施法成本 / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '确认最新技能配置', exact: true })).toHaveCount(0);
  const attributesResponse = await request.get(`${api}/api/admin/games/lol/characters/${characterKey}/attributes`);
  expect(attributesResponse.status()).toBe(200);
  const attributes = await attributesResponse.json();
  const health = attributes.levelValues['18'].hp;
  expect(Number.isFinite(health) && health > 0).toBe(true);
  await setCombatAnalysisInitialHealth(page, health, health);

  const start = page.getByRole('button', { name: '开始计算', exact: true });
  const archiveButton = page.getByRole('button', { name: '下载自动冻结档案', exact: true });
  const startAndWait = async () => {
    await start.click();
    await expect(start).toBeEnabled({ timeout: 60_000 });
  };
  await startAndWait();
  const sceneFields = page.locator('section[aria-label="战前机制初值"] input[aria-label]');
  const sceneFieldCount = await sceneFields.count();
  const explicitSceneValues: number[] = process.env.SIMULATION_LIVE_INITIAL_PARAMETER_VALUES
    ? JSON.parse(process.env.SIMULATION_LIVE_INITIAL_PARAMETER_VALUES) : [];
  expect(explicitSceneValues.length, '需要对本场初值显式提供验收输入，不在测试里代补0').toBe(sceneFieldCount);
  if (sceneFieldCount) {
    await expect(archiveButton, '初值未填时停在输入检查').toHaveCount(0);
    for (let index = 0; index < sceneFieldCount; index++) {
      await expect(sceneFields.nth(index), '初始化参数首次必须留空').toHaveValue('');
      expect(Number.isFinite(explicitSceneValues[index])).toBe(true);
      await sceneFields.nth(index).fill(String(explicitSceneValues[index]));
      await sceneFields.nth(index).press('Tab');
    }
    await startAndWait();
  }
  await expect(page.getByRole('button', { name: '将缺失属性填写为0', exact: true })).toHaveCount(0);
  const explicitAttributeInputs: Partial<Record<'source' | 'target', Record<string, number>>> =
    JSON.parse(process.env.SIMULATION_LIVE_ATTRIBUTE_INPUTS || '{}');
  expect(Object.keys(explicitAttributeInputs).every(side => side === 'source' || side === 'target')).toBe(true);
  const attributeFields = page.locator('section[aria-label="必要属性"] input[aria-label*="补充属性 "]');
  const attributeEntries = (['source', 'target'] as const).flatMap(side =>
    Object.entries(explicitAttributeInputs[side] ?? {}).map(([key, value]) => ({ side, key, value })));
  expect(attributeEntries.length, '场景缺失属性须明确提供验收输入，不在测试里补零').toBe(await attributeFields.count());
  for (const { side, key, value } of attributeEntries) {
    expect(Number.isFinite(value)).toBe(true);
    const input = page.getByLabel(`${side === 'source' ? '攻击方' : '目标'}补充属性 ${key}`, { exact: true });
    await expect(input).toHaveValue('');
    await input.fill(String(value)); await input.press('Tab');
  }
  if (attributeEntries.length) {
    await expect(archiveButton, '缺失属性未填时停在输入检查').toHaveCount(0);
    await startAndWait();
  }
  await expect(archiveButton).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('alert').filter({ hasText: /^计算完成。$/ })).toBeVisible({ timeout: 60_000 });
  const result = page.getByRole('region', { name: '自动技能结果', exact: true });
  const technical = result.locator('summary', { hasText: /^技术与调试详情$/ });
  const released = result.getByText('会话已正常释放。', { exact: true });
  await expect(released).toBeHidden();
  await technical.click();
  await expect(released).toBeVisible();
  await technical.click();
  const archiveDownload = page.waitForEvent('download');
  await archiveButton.click();
  await (await archiveDownload).saveAs(resolve(output, 'live-page-run-archive.json'));
  const frozenArchive = JSON.parse(readFileSync(resolve(output, 'live-page-run-archive.json'), 'utf8'));
  expect(frozenArchive.sceneParameterInputs.map((input: { value: number }) => input.value)).toEqual(explicitSceneValues);
  for (const { side, key, value } of attributeEntries) expect(frozenArchive.attributeInputs[side][key]).toBe(value);
  expect(frozenArchive).toMatchObject({ initialHealth: { source: health, target: health }, cleanup: 'released', releaseResult: { ok: true, released: true } });
  expect(snapshotResponses.length).toBeGreaterThan(0);
  expect(workers.length).toBeGreaterThan(0);
  expect(errors).toEqual([]); expect(writes).toEqual([]);
  expect(proofReads).toBe(0);
  const evidence = { layer: 'live-page-run', characterKey,
    snapshotResponses, workers, errors, businessWrites: writes, proofReads, explicitSceneValues, explicitAttributeInputs,
    actualUiCalculationCompletedAndReleased: true };
  writeFileSync(resolve(output, 'live-page-ready-run.json'), JSON.stringify(evidence, null, 2));
  await testInfo.attach('真实英雄页面运行', { body: JSON.stringify(evidence), contentType: 'application/json' });
  await page.screenshot({ path: resolve(output, 'live-page-ready-run.png'), fullPage: true });
});
