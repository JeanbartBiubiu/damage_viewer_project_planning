/**
 * 读取真实矩阵原始包，执行真实E闭包的受控通用协议专项。
 * node scripts/first-hero-mechanisms.mjs --base output/first-hero-2026-10-17/<run>/raw/source-level-18.json.gz
 * 仅用于额外机制证据，不签发整英雄或装备PASSED；无业务HTTP写入。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseIndex = process.argv.indexOf('--base');
assert(baseIndex >= 0 && process.argv[baseIndex + 1], '必须明确指定真实矩阵原始包 --base');
const basePath = resolve(root, process.argv[baseIndex + 1]);
const bytes = readFileSync(basePath), base = JSON.parse(gunzipSync(bytes).toString('utf8'));
const productionManifestPath = resolve(dirname(basePath), '../production-source-manifest.json');
const productionManifestBytes = readFileSync(productionManifestPath);
const productionSources = JSON.parse(productionManifestBytes.toString('utf8'));
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const outputRoot = resolve(root, `output/first-hero-2026-10-17/mechanisms-${stamp}`);
const webBase = process.env.SIMULATION_WEB_BASE_URL ?? 'http://127.0.0.1:5173';
const hash = value => createHash('sha256').update(value).digest('hex');
const wasmSha256 = process.env.SIMULATION_EXPECTED_WASM_SHA256;
assert(/^[a-f0-9]{64}$/.test(wasmSha256 ?? ''), '必须显式指定最终正式Wasm摘要');
assert.equal(hash(readFileSync(resolve(root, 'src/engine/wasm/tinygo_engine_v2.wasm'))), wasmSha256);
mkdirSync(outputRoot, { recursive: true });
const manifest = [], results = [], errors = [], writes = [];
const save = (name, value) => {
  const path = resolve(outputRoot, name), data = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data);
  const item = { path: relative(root, path).replaceAll('\\', '/'), sha256: hash(data), bytes: data.length };
  const previous = manifest.findIndex(row => row.path === item.path);
  if (previous < 0) manifest.push(item); else manifest[previous] = item;
  return item;
};
const raw = (name, value) => {
  const path = resolve(outputRoot, `${name}.json.gz`), data = gzipSync(Buffer.from(JSON.stringify(value)));
  writeFileSync(path, data);
  const item = { path: relative(root, path).replaceAll('\\', '/'), sha256: hash(data), bytes: data.length }; manifest.push(item); return item;
};
const close = (actual, expected, label) => assert(typeof actual === 'number' && Number.isFinite(actual)
  && Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(actual), Math.abs(expected)), `${label}: ${actual} != ${expected}`);
const baseHash = hash(bytes);
for (const file of productionSources) assert.equal(hash(readFileSync(resolve(root, file.path))), file.sha256,
  `真实矩阵结束后宿主源码已改变：${file.path}；请先重采集基线`);
const sources = ['scripts/first-hero-mechanisms.mjs', 'tests/fixtures/firstHeroProtocolProbe.ts'].map(path => {
  const value = readFileSync(resolve(root, path));
  writeFileSync(resolve(outputRoot, path.replaceAll('/', '-')), value);
  return { path, sha256: hash(value), bytes: value.length };
});
const snapshot = base.snapshot;
const shieldConfig = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'annie_e');
assert(shieldConfig && base.prepared && base.runRequest && base.done && base.release?.released, '基线必须是已通过真实Worker并释放的完整记录');
const level = snapshot.source.skillSources.find(row => row.skillKey === shieldConfig.skill.skillKey).skillLevel;
function parameter(key) {
  const row = shieldConfig.parameters.find(row => row.parameterKey === key);
  assert(row, `缺少作者参数 ${key}`);
  const value = row.valueMode === 'FIXED' ? row.fixedValue : row.levelValues[row.valueMode === 'CHARACTER_LEVEL' ? snapshot.selection.sourceLevel : level];
  assert(Number.isFinite(value)); return value;
}
const ap = snapshot.source.selectedLevelValues.ability_power ?? base.attributes.source.ability_power;
assert(Number.isFinite(ap), '必须真实保存法强，不能默认0');
const expectedShield = parameter('base_shield') + parameter('shield_ap_ratio') * ap;
const expectedReturn = parameter('base_return_damage') + parameter('return_ap_ratio') * ap;
  const expectedMoveRatio = parameter('move_speed_ratio');
  const moveDuration = parameter('move_speed_duration_ms');
const browser = await chromium.launch({ headless: true });
let failure = null;
try {
  const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push({ method: request.method(), path: new URL(request.url()).pathname }); });
  await page.goto(webBase + '/');
  const identity = await page.evaluate(async () => {
    const { SIMULATION_AVAILABILITY_IDENTITY } = await import('/src/services/simulationAvailabilityClient.ts');
    const bytes = await (await fetch('/src/engine/wasm/tinygo_engine_v2.wasm')).arrayBuffer();
    return { ...SIMULATION_AVAILABILITY_IDENTITY, observedSha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(value => value.toString(16).padStart(2, '0')).join('') };
  });
  assert.equal(identity.observedSha256, wasmSha256); assert.equal(identity.wasmSha256, wasmSha256);
  const actualSchema = base.prepared.compileRequest.sharedProviders;
  const eOrigin = base.prepared.skillOrigins.find(row => row.side === 'source' && row.skillKey === shieldConfig.skill.skillKey);
  assert(eOrigin?.definitionRef, 'E必须有真实同源挂载');
  const definition = actualSchema.find(row => row.providerKey === eOrigin.definitionRef);
  assert(definition, 'E真实父定义缺失');
  const shieldLife = definition.processes.flatMap(row => row.momentOperations.flatMap(moment => moment.operations))
    .find(row => row.operation === 'shield' && row.shieldLifecycleProviderDefinitionRef)?.shieldLifecycleProviderDefinitionRef;
  assert(shieldLife, '真实E施盾动作必须显式关联生命周期定义');
  const reflected = done => done.damageRecords.filter(row => (row.providerDefinitionRef === eOrigin.definitionRef
    || row.abilityRef.startsWith(`source.provider[${eOrigin.providerRef}].ability[`)) && row.source === 'source' && row.target === 'target');
  const source = done => done.finalSnapshot.combatants.find(row => row.key === 'source');
  const selfCast = [{ skillKey: shieldConfig.skill.skillKey, atMs: 0, target: 'source' }];
  const damageType = shieldConfig.effects.find(row => row.effectKey === 'return_damage').results.find(row => row.resultType === 'DAMAGE').detail.damageTypeKey;
  async function execute(id, options, assertions) {
    let result;
    try {
      result = await page.evaluate(async ({ compile, run, options }) => {
        const { runFirstHeroProtocolProbe } = await import('/tests/fixtures/firstHeroProtocolProbe.ts');
        return runFirstHeroProtocolProbe(compile, run, options);
      }, { compile: base.prepared.compileRequest, run: base.runRequest, options });
    } catch (error) {
      const diagnostics = await page.evaluate(async () => {
        const { firstHeroProtocolFailure } = await import('/tests/fixtures/firstHeroProtocolProbe.ts'); return firstHeroProtocolFailure();
      });
      raw('failure-' + id, { options, diagnostics, error: error.message }); throw error;
    }
    const artifact = raw(id, result);
    assertions(result.done, result);
    assert.equal(result.runRequest.driverPlan.basicAttack, undefined, '专项明确无背景AA，不能冒充混合矩阵');
    assert.equal(result.release.released, true);
    results.push({ id, passed: true, raw: artifact, actualRuns: result.iterations });
    save('progress.json', { identity, basePath: relative(root, basePath), baseHash, results });
    console.log(`${id}: 真实E闭包/受控入伤/正式Worker通过`);
    return result;
  }
  const partial = await execute('e-partial-and-once', { durationMs: 1000, casts: selfCast,
    incoming: [{ atMs: 500, amount: 10, damageType }, { atMs: 600, amount: 10, damageType }] }, done => {
    const incoming = done.damageRecords.filter(row => row.source === 'target' && row.target === 'source');
    assert.equal(incoming.length, 2); assert.equal(reflected(done).length, 1, '当前盾同敌方只反伤一次');
    close(reflected(done)[0].rawAmount, expectedReturn, '真实反伤原始数值');
    assert.equal(source(done).shields.length, 1);
    close(source(done).shields[0].remaining, expectedShield - incoming.reduce((total, row) => total + row.shieldAbsorbed, 0), '实际盾吸收账');
    close(incoming.reduce((total, row) => total + row.actualHpLoss, 0), 0, '全盾吸收不失血');
    close(source(done).attributes.move_speed.resolved,
      snapshot.source.selectedLevelValues.move_speed * (1 + expectedMoveRatio * Math.max(0, 1 - 1000 / moveDuration)),
      '真实应用时间0的独立速度效果按当前时点衰减');
    const timed = source(done).providers.filter(row => actualSchema.find(definition => definition.providerKey === row.definitionRef)
      ?.modifiers?.some(modifier => modifier.target === 'self.attr.move_speed'));
    assert.equal(timed.length, 1); assert.equal(timed[0].appliedAtMs, 0, '实际施加时刻0不能在快照中丢失');
  });
  const factor = partial.done.damageRecords.find(row => row.source === 'target').resistanceFactor;
  assert(Number.isFinite(factor) && factor > 0);
  await execute('e-breaking-hit-no-reflection', { durationMs: 1000, casts: selfCast,
    incoming: [{ atMs: 500, amount: (expectedShield + 1) / factor, damageType }, { atMs: 600, amount: 10, damageType }] }, done => {
    assert.equal(reflected(done).length, 0, '破盾当笔和后续不反伤'); assert.equal(source(done).shields.length, 0);
    assert(!source(done).providers.some(row => row.definitionRef === shieldLife), '破盾应终止真实关联实例');
  });
  await execute('e-expiry-no-reflection', { durationMs: 3200, casts: selfCast,
    incoming: [{ atMs: 3100, amount: 10, damageType }] }, done => {
    assert.equal(reflected(done).length, 0); assert.equal(source(done).shields.length, 0, '实际盾到期清除');
    close(source(done).attributes.move_speed.resolved, snapshot.source.selectedLevelValues.move_speed, '独立速度效果到期');
  });
  await execute('e-refresh-and-stale-expiry', { durationMs: 3100, casts: [...selfCast, { skillKey: shieldConfig.skill.skillKey, atMs: 1001, target: 'source' }],
    cooldownResets: [{ atMs: 1000, skillKey: shieldConfig.skill.skillKey }], incoming: [500, 600, 1100, 1200].map(atMs => ({ atMs, amount: 10, damageType })) }, done => {
    assert.equal(reflected(done).length, 2, '新盾重置同敌方反伤额度'); assert.equal(source(done).shields.length, 1, '重施覆盖而非叠加');
    assert.equal(source(done).shields[0].expireAt, 4001, '旧到期不得结束新盾');
    close(source(done).shields[0].remaining, expectedShield - 20 * factor, '新盾独立吸收账');
  });
  await execute('e-omnivamp-post-defense-full-absorb', { durationMs: 1000, casts: selfCast,
    incoming: [{ atMs: 500, amount: 10, damageType }], attributeOverrides: [{ side: 'source', attributeKey: 'omnivamp_percent', value: .2 }],
    initialHealthRatios: { source: .5, target: 1 }, targetShieldAmount: 10000 }, done => {
    const returned = reflected(done); assert.equal(returned.length, 1); assert.equal(returned[0].actualHpLoss, 0);
    assert(returned[0].postDefenseDamage > 0 && returned[0].shieldAbsorbed > 0);
    const vamp = done.evidence.items.filter(row => row.kind === 'vamp' && row.data?.source === 'source');
    assert.equal(vamp.length, 1, '原生受控协议以逐笔吸血证据核对，不要求不存在的自动模式汇总字段');
    const healing = vamp[0].data.actualHealing;
    close(healing, returned[0].postDefenseDamage * .2, '反伤按后防御伤害吸血，全盾吸收也生效');
    const hpStart = base.runRequest.initialSnapshot.combatants.find(row => row.key === 'source').attributes.hp.max * .5;
    close(done.summary.sourceFinalHp, hpStart + healing, '反伤吸血真实生命账');
  });
  const pOrigin = base.prepared.skillOrigins.find(row => row.side === 'source' && row.skillKey === 'annie_p');
  assert(pOrigin?.providerRef && pOrigin.definitionRef, '被动必须有真实父挂载');
  const pDefinition = actualSchema.find(row => row.providerKey === pOrigin.definitionRef);
  assert(pDefinition?.initialStateSchema?.stacks, '当前真实P必须声明stacks，不猜状态初值');
  const stunDefinitions = new Set(actualSchema.filter(row => row.types?.includes('provider/status_stun')).map(row => row.providerKey));
  assert(stunDefinitions.size, '原编译闭包中必须有完整控制定义');
  const pValue = (done, result) => {
    const actor = source(done), mount = actor.providers.find(row => row.providerRef === pOrigin.providerRef);
    assert(mount, '被动原静态挂载必须存活');
    const bag = actor.providerState[pOrigin.providerRef];
    if (bag) {
      assert(Object.hasOwn(bag.state, 'stacks'), '已物化状态必须保留真实字段');
      return bag.state.stacks;
    }
    const schema = result.compileRequest.sharedProviders.find(row => row.providerKey === mount.definitionRef)?.initialStateSchema?.stacks;
    const initial = typeof schema === 'number' ? schema : schema?.defaultValue;
    assert(Number.isFinite(initial), '未物化状态只能读取本次真实编译声明的初值');
    return initial;
  };
  const hasStun = done => done.finalSnapshot.combatants.find(row => row.key === 'target').providers.some(row => stunDefinitions.has(row.definitionRef));
  const oneCast = (skillKey, preset = 'TARGET_HIT') => [{ skillKey, atMs: 0, target: skillKey === 'annie_e' ? 'source' : 'target', preset }];
  for (const skillKey of ['annie_q', 'annie_w', 'annie_r']) {
    await execute(`p-${skillKey}-three-to-four`, { durationMs: 500, casts: [], plannedCasts: oneCast(skillKey),
      providerStates: [{ side: 'source', skillKey: 'annie_p', stateKey: 'stacks', value: 3 }] }, (done, result) => {
      assert.equal(pValue(done, result), 4, '第三层命中只充至第四层，不在同事件立即消费'); assert.equal(hasStun(done), false);
    });
    await execute(`p-${skillKey}-full-contact`, { durationMs: 500, casts: [], plannedCasts: oneCast(skillKey) }, (done, result) => {
      assert.equal(pValue(done, result), 0, '普通新战斗满层命中应消费'); assert.equal(hasStun(done), true, '真实原命中候选应施加控制');
    });
    await execute(`p-${skillKey}-full-blocked`, { durationMs: 500, casts: [], plannedCasts: oneCast(skillKey), spellShieldTarget: true }, (done, result) => {
      assert.equal(pValue(done, result), 0, '法术盾阻挡仍是接触并消费满层'); assert.equal(hasStun(done), false, '不能另行绕过真实原命中阻挡');
      assert.equal(done.summary.sourceDamageDealt, 0);
    });
    await execute(`p-${skillKey}-three-miss`, { durationMs: 500, casts: [], plannedCasts: oneCast(skillKey, 'MISS'),
      providerStates: [{ side: 'source', skillKey: 'annie_p', stateKey: 'stacks', value: 3 }] }, (done, result) => {
      assert.equal(pValue(done, result), skillKey === 'annie_q' ? 3 : 4, 'Q空放不加层，W/R终结无接触只加一次'); assert.equal(hasStun(done), false);
      assert.equal(done.summary.sourceDamageDealt, 0);
    });
    await execute(`p-${skillKey}-full-miss`, { durationMs: 500, casts: [], plannedCasts: oneCast(skillKey, 'MISS') }, (done, result) => {
      assert.equal(pValue(done, result), skillKey === 'annie_q' ? 4 : 0, 'Q空放保留满层，W/R终结无接触消费满层'); assert.equal(hasStun(done), false);
    });
  }
  await execute('p-full-e-retained', { durationMs: 500, casts: [], plannedCasts: oneCast('annie_e', null) }, (done, result) => {
    assert.equal(pValue(done, result), 4, '满层E不能消费眩晕资格'); assert.equal(hasStun(done), false);
  });
  await execute('p-three-e-charged', { durationMs: 500, casts: [], plannedCasts: oneCast('annie_e', null),
    providerStates: [{ side: 'source', skillKey: 'annie_p', stateKey: 'stacks', value: 3 }] }, (done, result) => {
    assert.equal(pValue(done, result), 4, '成功E终结加层'); assert.equal(hasStun(done), false);
  });
  const rConfig = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'annie_r');
  const rRank = snapshot.source.skillSources.find(row => row.skillKey === 'annie_r').skillLevel;
  const penetration = rConfig.parameters.find(row => row.parameterKey === 'magic_penetration_ratio').levelValues[rRank];
  const rCooldown = rConfig.parameters.find(row => row.parameterKey === 'cooldown_ms').levelValues[rRank];
  assert(Number.isFinite(penetration) && Number.isFinite(rCooldown));
  await execute('r-learned-without-cast-composition', { durationMs: 500, casts: [], plannedCasts: oneCast('annie_e', null),
    attributeOverrides: [{ side: 'source', attributeKey: 'magic_pen_percent', value: .4 }] }, done => {
    close(source(done).attributes.magic_pen_percent.resolved, 1 - .6 * (1 - penetration), '40%与R常驻比例按剩余比例连乘');
    assert(!done.skillUseRecords.some(row => row.skillKey === 'annie_r' && row.kind === 'STARTED'), '不用主动施放R也有被动法穿');
  });
  const sourceHaste = snapshot.source.selectedLevelValues.ability_haste ?? base.attributes.source.ability_haste;
  assert(Number.isFinite(sourceHaste));
  const secondRAt = Math.ceil(rCooldown * 100 / (100 + sourceHaste)) + 1000;
  await execute('r-repeated-cast-no-permanent-stack', { durationMs: secondRAt + 500, casts: [],
    plannedCasts: [{ skillKey: 'annie_r', atMs: 0, target: 'target', preset: 'TARGET_HIT' },
      { skillKey: 'annie_r', atMs: secondRAt, target: 'target', preset: 'TARGET_HIT' }],
    attributeOverrides: [{ side: 'source', attributeKey: 'magic_pen_percent', value: .4 }] }, done => {
    close(source(done).attributes.magic_pen_percent.resolved, 1 - .6 * (1 - penetration), '多次主动R不得永久叠加常驻法穿');
    assert.equal(done.skillUseRecords.filter(row => row.skillKey === 'annie_r' && row.kind === 'STARTED').length, 2);
    assert.equal(done.skillUseRecords.filter(row => row.skillKey === 'annie_r' && row.kind === 'COMPLETED').length, 2);
  });
  const qConfig = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'annie_q');
  const qDuration = qConfig.parameters.find(row => row.parameterKey === 'cast_time_ms').fixedValue;
  await execute('direct-damage-target-killed-termination', { durationMs: 500, casts: [], plannedCasts: oneCast('annie_q'),
    initialHealthRatios: { source: 1, target: .01 } }, done => {
    assert.equal(done.summary.execution.targetKilled, true);
    assert.equal(done.summary.execution.targetKilledAtMs, qDuration);
    assert.equal(done.summary.durationMs, qDuration, '目标死亡后在实际击杀时点终止');
    assert.equal(done.summary.stopReason, 'target_dead');
    assert.equal(done.summary.targetFinalHp, 0);
  });
  assert.equal(errors.length, 0); assert.equal(writes.length, 0);
  assert.equal(hash(readFileSync(basePath)), baseHash); assert.equal(hash(readFileSync(resolve(root, 'src/engine/wasm/tinygo_engine_v2.wasm'))), wasmSha256);
  for (const item of sources) assert.equal(hash(readFileSync(resolve(root, item.path))), item.sha256);
  for (const item of productionSources) assert.equal(hash(readFileSync(resolve(root, item.path))), item.sha256, '机制采集期间宿主源码发生变化');
  save('mechanism-evidence-candidate.json', { identity, basePath: relative(root, basePath), baseHash, sources, results,
    productionManifestSha256: hash(productionManifestBytes), formalProofOutcome: 'NOT_ISSUED',
    boundary: '真实作者E闭包及明确构造；不替代保留背景AA的混合矩阵，不证明目标自主施法、友军或独立召唤物' });
} catch (error) { failure = error; save('failure.json', { message: error.message, stack: error.stack, results }); }
finally {
  await browser.close();
  save('summary.json', { success: !failure, message: failure?.message ?? null, basePath: relative(root, basePath), baseHash,
    wasmSha256, sources, results, errors, businessWrites: writes, actualRuns: results.reduce((count, row) => count + row.actualRuns, 0) });
  save('raw-manifest.json', { files: manifest.slice(), hashAlgorithm: 'sha256' });
}
if (failure) throw failure;
