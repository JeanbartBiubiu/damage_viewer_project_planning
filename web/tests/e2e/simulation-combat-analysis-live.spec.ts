import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { applySimulationAvailability, type SimulationEntityOption } from '../../src/pages/simulation/simulationSelectionOptions';
import { parseSimulationAvailabilityResponse, SIMULATION_AVAILABILITY_IDENTITY, simulationAvailabilityPath } from '../../src/services/simulationAvailabilityClient';
import type { SimulationAvailabilityResponse } from '../../src/types/simulationAvailability';

const output = resolve(process.env.SIMULATION_LIVE_OUTPUT_DIR || 'output/combat-analysis/availability-gate');
const api = process.env.SIMULATION_API_BASE || 'http://127.0.0.1:8080';
const token = 'local-readonly-check';

// 旧安妮Q/W关闭兄弟来源的局部机制诊断已归档至 output/combat-analysis/availability-gate/
// historical-annie-local-combination.spec.ts.txt。该历史证据不构成整英雄READY证明；本入口不再绕过门禁。
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

function object(value: unknown, fields: string[], label: string): Record<string, unknown> {
  expect(value, label).not.toBeNull();
  expect(typeof value, label).toBe('object');
  expect(Array.isArray(value), label).toBe(false);
  expect(Object.keys(value as object).sort(), label).toEqual([...fields].sort());
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
    'digestVersion', 'scopeDigest', 'sharedDigest', 'wasmSha256', 'adapterVersion', 'entries'], '正式证明文件');
  expect(proof.schemaVersion).toBe('simulation-verification-v1');
  expect(proof.gameId).toBe('lol');
  expect(proof.profile).toBe('combat-analysis-v1');
  expect(proof.digestVersion).toBe('simulation-availability-v1');
  expect(proof.wasmSha256).toBe(expectedWasm);
  expect(proof.adapterVersion).toBe(SIMULATION_AVAILABILITY_IDENTITY.adapterVersion);
  expect(Array.isArray(proof.entries)).toBe(true);
  const entries = (proof.entries as unknown[]).map((value, index) => {
    const row = object(value, ['kind', 'key', 'contentDigest', 'externalDigest', 'outcome', 'coverage', 'evidenceRefs', 'issues'], `证明条目${index}`);
    expect(['CHARACTER', 'EQUIPMENT']).toContain(row.kind);
    expect(['PASSED', 'ENGINE_UNSUPPORTED']).toContain(row.outcome);
    if (row.outcome === 'ENGINE_UNSUPPORTED') {
      expect(Array.isArray(row.issues)).toBe(true);
      expect((row.issues as unknown[]).length).toBeGreaterThan(0);
    }
    return { kind: row.kind, entry: { key: row.key, status: row.outcome === 'PASSED' ? 'READY' : 'ENGINE_UNSUPPORTED',
      contentDigest: row.contentDigest, issues: row.issues, excludedSkillSources: [], verification: {
        wasmSha256: proof.wasmSha256, adapterVersion: proof.adapterVersion, externalDigest: row.externalDigest,
        requiredCoverage: row.coverage, matched: true, evidenceRefs: row.evidenceRefs } } };
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
    expect(response[kind].filter(entry => entry.status === 'READY').map(entry => entry.key).sort(),
      `${kind}的READY集合必须精确等于正式文件PASSED集合`).toEqual(proofs.filter(entry => entry.status === 'READY').map(entry => entry.key).sort());
    for (const proof of proofs) expect(response[kind].some(entry => entry.key === proof.key), `正式证明对象${proof.key}必须存在`).toBe(true);
    const byKey = new Map(proofs.map(entry => [entry.key, entry]));
    for (const entry of response[kind]) {
      expect(entry.verification.wasmSha256).toBe(SIMULATION_AVAILABILITY_IDENTITY.wasmSha256);
      expect(entry.verification.adapterVersion).toBe(SIMULATION_AVAILABILITY_IDENTITY.adapterVersion);
      const proof = byKey.get(entry.key);
      if (proof) {
        expect(entry.status, `${entry.key}正式结论`).toBe(proof.status);
        expect(entry.contentDigest, `${entry.key}完整配置摘要`).toBe(proof.contentDigest);
        expect(entry.issues, `${entry.key}正式问题集合`).toEqual(proof.issues);
        expect(entry.verification, `${entry.key}匹配、外部摘要、完整覆盖与证据引用必须逐项一致`).toEqual(proof.verification);
      } else {
        expect(entry.status, `${entry.key}没有正式通过证明`).not.toBe('READY');
        expect(entry.verification.matched, `${entry.key}不能借用其他对象证明`).toBe(false);
        expect(entry.verification.evidenceRefs, `${entry.key}不能返回不存在的证明引用`).toEqual([]);
      }
    }
  }
  const options: SimulationEntityOption[] = [
    ...response.characters.map(entry => ({ key: entry.key, name: entry.key, kind: 'character' as const })),
    ...response.equipment.map(entry => ({ key: entry.key, name: entry.key, kind: 'equipment' as const }))
  ];
  const filtered = applySimulationAvailability(options, response);
  const acceptedEquipment = filtered.filter(option => option.kind === 'equipment' && !option.disabled).map(option => option.key).sort();
  const expectedEquipment = (expected.directory?.equipment ?? []).filter(entry => entry.status === 'READY').map(entry => entry.key).sort();
  expect(acceptedEquipment, '生产装备准入函数接受且只接受当前正式PASSED集合').toEqual(expectedEquipment);
  const acceptedCharacters = filtered.filter(option => option.kind === 'character' && !option.disabled).map(option => option.key).sort();
  const expectedCharacters = (expected.directory?.characters ?? []).filter(entry => entry.status === 'READY').map(entry => entry.key).sort();
  expect(acceptedCharacters, '生产英雄准入只接受正式PASSED集合').toEqual(expectedCharacters);
  expect(filtered.filter(option => option.kind === 'character' && option.disabled).every(option => !!option.unavailableReason)).toBe(true);
  const rejectedEquipment = filtered.filter(option => option.kind === 'equipment' && option.disabled);
  expect(rejectedEquipment.length, '必须保留未证明装备的反向验证').toBeGreaterThan(0);
  expect(rejectedEquipment.every(option => !!option.unavailableReason), '未证明装备保留禁选原因').toBe(true);
  return { acceptedCharacters, acceptedEquipment, rejectedEquipment: rejectedEquipment.map(option => option.key).sort() };
}

test('真实计算可用目录：精确接受正式英雄与装备证明，未证明对象均不放行', async ({ request }, testInfo) => {
  const expected = readExpectedVerification();
  const response = await request.get(api + simulationAvailabilityPath('lol'), { headers: { Authorization: 'Bearer ' + token } });
  expect(response.status(), '读取真实目录，不替换HTTP或后端证明').toBe(200);
  const directory = parseSimulationAvailabilityResponse(await response.json(), 'lol');
  const admission = assertDirectoryMatchesVerification(directory, expected);
  const evidence = { layer: 'live-readonly-availability', requestMethod: 'GET', directory, counts: statusCounts(directory),
    expectedVerification: expected, identity: SIMULATION_AVAILABILITY_IDENTITY, productionOptionAdmission: admission,
    calculationExecuted: false, wholeHeroRuntimeVerified: false };
  writeFileSync(resolve(output, 'live-directory.json'), JSON.stringify(evidence, null, 2));
  await testInfo.attach('真实完整计算目录', { body: JSON.stringify(evidence), contentType: 'application/json' });
});

async function searchCharacter(page: Page, label: string, key: string) {
  const select = page.locator('.simulation-entity-select[aria-label="' + label + '"]');
  await expect(select).not.toHaveClass(/arco-select-disabled/);
  await select.click();
  await select.locator('input').fill(key);
  const popup = page.locator('#' + await select.getAttribute('aria-controls'));
  const option = popup.getByRole('option').filter({ has: page.getByText(key, { exact: true }) });
  await expect(option).toHaveCount(1);
  return option;
}

test('真实新页面：未就绪英雄禁选，装备与准备保持阻断且不建立计算Worker', async ({ page }, testInfo) => {
  const expected = readExpectedVerification();
  const errors: string[] = [];
  const workers: string[] = [];
  const requests: Array<{ method: string; path: string }> = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === api && request.method() !== 'OPTIONS') requests.push({ method: request.method(), path: url.pathname });
  });
  await page.addInitScript(({ api, token }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', token);
  }, { api, token });
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/simulation-availability')
    && response.request().method() === 'GET');
  await page.goto('/?combat-availability-live=1#/simulation/combat-analysis');
  await expect(page.getByRole('heading', { name: '混合战斗分析', exact: true })).toBeVisible();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const directory = parseSimulationAvailabilityResponse(await response.json(), 'lol');
  const admission = assertDirectoryMatchesVerification(directory, expected);
  if (!admission.acceptedCharacters.length) {
    await expect(page.getByRole('alert').filter({ hasText: '当前还没有完成整英雄计算验证的角色' })).toBeVisible();
  }
  const blocked = directory.characters.find(entry => entry.status !== 'READY');
  expect(blocked, '真实目录必须保留未通过对象的反向验证').toBeDefined();
  for (const label of ['攻击方角色', '目标角色']) {
    const option = await searchCharacter(page, label, blocked!.key);
    await expect(option).toHaveClass(/arco-select-option-disabled/);
    if (blocked!.issues[0]) expect(await option.locator('.simulation-entity-option').getAttribute('title')).toContain(blocked!.issues[0].message);
    await option.click();
    await expect(page.locator('.simulation-level-select[aria-label="' + (label === '攻击方角色' ? '攻击方等级' : '目标等级') + '"]')).toHaveClass(/arco-select-disabled/);
    await page.keyboard.press('Escape');
  }
  await expect(page.locator('.simulation-equipment-select[aria-label="攻击方装备"]')).toHaveClass(/arco-select-disabled/);
  await expect(page.locator('.simulation-equipment-select[aria-label="目标装备"]')).toHaveClass(/arco-select-disabled/);
  await expect(page.getByRole('button', { name: '准备计算', exact: true })).toBeDisabled();
  expect(requests.filter(request => request.path.endsWith('/simulation-snapshot'))).toEqual([]);
  expect(requests.every(request => request.method === 'GET'), '真实门禁页面只读业务数据').toBe(true);
  expect(workers).toEqual([]);
  expect(errors).toEqual([]);
  const evidence = { layer: 'live-page-gate', counts: statusCounts(directory), expectedVerification: expected,
    identity: SIMULATION_AVAILABILITY_IDENTITY, productionOptionAdmission: admission, blocked, requests, workers,
    snapshotReads: 0, calculationExecuted: false, wholeHeroRuntimeVerified: false, errors };
  writeFileSync(resolve(output, 'live-page-blocked.json'), JSON.stringify(evidence, null, 2));
  await testInfo.attach('真实页面禁选证据', { body: JSON.stringify(evidence), contentType: 'application/json' });
  await page.screenshot({ path: resolve(output, 'live-page-blocked.png'), fullPage: true });
});

test('真实新页面：正式通过英雄直接配置全技能并运行，显示结果且释放会话', async ({ page, request }, testInfo) => {
  const expected = readExpectedVerification();
  const requestedCharacter = process.env.SIMULATION_LIVE_CHARACTER_KEY;
  const ready = expected.directory?.characters.find(entry => entry.status === 'READY'
    && (!requestedCharacter || entry.key === requestedCharacter));
  if (requestedCharacter) expect(ready, '明确指定的英雄必须已有匹配的正式证明').toBeDefined();
  test.skip(!ready, '当前正式资源没有已独立核验英雄；不能借局部技能或构造目录绕过门禁');
  const errors: string[] = [], workers: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  page.on('request', row => {
    const url = new URL(row.url());
    if (url.origin === api && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(row.method())
      && !url.pathname.endsWith('/simulation-snapshot')) writes.push(row.method() + ' ' + url.pathname);
  });
  await page.addInitScript(({ api, token }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', token);
  }, { api, token });
  const readyDirectoryResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/simulation-availability')
    && response.request().method() === 'GET');
  await page.goto('/?combat-availability-live=ready#/simulation/combat-analysis');
  const directoryResponse = await readyDirectoryResponse;
  expect(directoryResponse.status()).toBe(200);
  const liveDirectory = parseSimulationAvailabilityResponse(await directoryResponse.json(), 'lol');
  const admission = assertDirectoryMatchesVerification(liveDirectory, expected);
  expect(admission.acceptedCharacters).toContain(ready!.key);
  const snapshotResponses: unknown[] = [];
  page.on('response', response => {
    if (new URL(response.url()).pathname.endsWith('/simulation-snapshot') && response.status() === 200) {
      void response.json().then(value => snapshotResponses.push(value));
    }
  });
  for (const [characterLabel, levelLabel] of [['攻击方角色', '攻击方等级'], ['目标角色', '目标等级']]) {
    const option = await searchCharacter(page, characterLabel!, ready!.key);
    await expect(option).not.toHaveClass(/arco-select-option-disabled/);
    await option.click();
    const level = page.locator('.simulation-level-select[aria-label="' + levelLabel + '"]');
    await level.click();
    const popup = page.locator('#' + await level.getAttribute('aria-controls'));
    await popup.getByRole('option', { name: '18', exact: true }).click();
  }
  await expect(page.getByRole('combobox', { name: '普攻技能', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '攻击方主动技能候选', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '准备计算', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '准备计算', exact: true }).click();
  await expect(page.getByRole('button', { name: '准备计算', exact: true })).toBeEnabled({ timeout: 60_000 });
  const sceneFields = page.locator('section[aria-label="战前机制初值"] input[aria-label]');
  const sceneFieldCount = await sceneFields.count();
  const explicitSceneValues: number[] = process.env.SIMULATION_LIVE_INITIAL_PARAMETER_VALUES
    ? JSON.parse(process.env.SIMULATION_LIVE_INITIAL_PARAMETER_VALUES) : [];
  expect(explicitSceneValues.length, '需要对本场初值显式提供验收输入，不在测试里代补0').toBe(sceneFieldCount);
  if (sceneFieldCount) {
    await expect(page.getByRole('button', { name: '开始计算', exact: true }), '初值未填时不生成可运行的准备结果').toHaveCount(0);
    for (let index = 0; index < sceneFieldCount; index++) {
      await expect(sceneFields.nth(index), '初始化参数首次必须留空').toHaveValue('');
      expect(Number.isFinite(explicitSceneValues[index])).toBe(true);
      await sceneFields.nth(index).fill(String(explicitSceneValues[index]));
      await sceneFields.nth(index).press('Tab');
    }
    await page.getByRole('button', { name: '准备计算', exact: true }).click();
    await expect(page.getByRole('button', { name: '准备计算', exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: '计算条件', exact: true })).toBeVisible();
  }
  await expect(page.getByRole('checkbox', { name: /^声明施法成本 / })).toHaveCount(0);
  await expect(page.getByLabel('攻击方初始当前生命', { exact: true })).toBeVisible();
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
  const attributesResponse = await request.get(`${api}/api/admin/games/lol/characters/${ready!.key}/attributes`,
    { headers: { Authorization: 'Bearer ' + token } });
  expect(attributesResponse.status()).toBe(200);
  const attributes = await attributesResponse.json();
  const health = attributes.levelValues['18'].hp;
  expect(Number.isFinite(health) && health > 0).toBe(true);
  for (const label of ['攻击方初始当前生命', '目标初始当前生命']) {
    const input = page.getByLabel(label, { exact: true });
    await input.fill(String(health)); await input.press('Tab');
  }
  await page.getByLabel('攻速输入上界', { exact: true }).fill('5');
  await page.getByLabel('攻速输入上界', { exact: true }).press('Tab');
  await expect(page.getByRole('button', { name: '确认最新技能配置', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始计算', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '开始计算', exact: true }).click();
  const archiveButton = page.getByRole('button', { name: '下载自动冻结档案', exact: true });
  await expect(archiveButton).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('alert').filter({ hasText: '自动循环观察完成，会话已释放' })).toBeVisible({ timeout: 60_000 });
  const archiveDownload = page.waitForEvent('download');
  await archiveButton.click();
  await (await archiveDownload).saveAs(resolve(output, 'live-page-run-archive.json'));
  const frozenArchive = JSON.parse(readFileSync(resolve(output, 'live-page-run-archive.json'), 'utf8'));
  expect(frozenArchive.sceneParameterInputs.map((input: { value: number }) => input.value)).toEqual(explicitSceneValues);
  for (const { side, key, value } of attributeEntries) expect(frozenArchive.attributeInputs[side][key]).toBe(value);
  expect(frozenArchive.cleanup).toBe('released');
  expect(snapshotResponses.length).toBeGreaterThan(0);
  expect(workers.length).toBeGreaterThan(0);
  expect(errors).toEqual([]); expect(writes).toEqual([]);
  const evidence = { layer: 'live-page-ready-run', expectedVerification: expected, characterKey: ready!.key,
    identity: SIMULATION_AVAILABILITY_IDENTITY, snapshotResponses, workers, errors, businessWrites: writes, explicitSceneValues, explicitAttributeInputs,
    actualUiCalculationCompletedAndReleased: true };
  writeFileSync(resolve(output, 'live-page-ready-run.json'), JSON.stringify(evidence, null, 2));
  await testInfo.attach('真实英雄页面运行', { body: JSON.stringify(evidence), contentType: 'application/json' });
  await page.screenshot({ path: resolve(output, 'live-page-ready-run.png'), fullPage: true });
});
