import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tool = 'tools/authoring/update-reviewed-parameters-v2.mjs';
const toolPath = path.join(web, tool);
const root = '/skills/parameter_test_v2', listRoute = root + '/parameters';
const durationRoute = listRoute + '/duration_ms', damageRoute = listRoute + '/base_damage';
const stamp = '2026-09-21T00:00:00Z';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const correctedLevels = { '1': 1250, '2': 1350, '3': 1450, '4': 1550, '5': 1650 };
const levelConfigRoute = '/level-config';
const characterLevels = Object.fromEntries([28, 38, 48, 58, 68, 78, 88, 98, 108, 118, 128, 138, 148, 157.5, 178, 198, 218, 240].map((value, index) => [String(index + 1), value]));
let sequence = 0;

async function fixture(run) {
  const prefix = path.join(web, '数据参考', '.parameter-tool-v2-test-'), dir = fs.mkdtempSync(prefix);
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value) + '\n');
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const sourceFile = path.join(dir, 'source.txt');
  fs.writeFileSync(sourceFile, '固定离线来源，不访问业务服务\n');
  const duration = { gameId: 'lol', skillKey: 'parameter_test_v2', parameterKey: 'duration_ms', name: '持续时间', description: '毫秒',
    valueType: 'DECIMAL', valueMode: 'SKILL_LEVEL', fixedValue: null,
    levelValues: { '1': 1250, '2': 1350.000024, '3': 1450.000048, '4': 1549.999952, '5': 1649.999976 },
    sortOrder: 10, createdAt: stamp, updatedAt: stamp };
  const damage = { ...structuredClone(duration), parameterKey: 'base_damage', name: '另一技能的伤害', description: null,
    valueType: 'INTEGER', levelValues: { '1': 50, '2': 75, '3': 100, '4': 125, '5': 150 }, sortOrder: 20 };
  const values = {
    [levelConfigRoute]: { gameId: 'lol', minLevel: 1, maxLevel: 18 },
    [root]: { gameId: 'lol', skillKey: 'parameter_test_v2', name: '参数测试', maxLevel: 5, status: 'ENABLED', createdAt: stamp, updatedAt: stamp },
    [listRoute]: [structuredClone(duration), structuredClone(damage)], [durationRoute]: duration, [damageRoute]: damage,
    [root + '/formulas']: [{ formulaKey: 'duration', name: '时长', createdAt: stamp, updatedAt: stamp }],
    [root + '/formulas/duration']: { formulaKey: 'duration', expression: { kind: 'PARAMETER', parameterKey: 'duration_ms' }, createdAt: stamp, updatedAt: stamp },
    [root + '/effects']: [], [root + '/processes']: [], [root + '/internal-states']: [], [root + '/trigger-rules']: []
  };
  const original = structuredClone(values);
  const state = { values, puts: 0, calls: [], bodies: [], malformed: false, fetchFailure: false, extraWrite: false, persistedBeforeParsing: false, afterGet: null, reorderList: false, reverseOtherRows: false, configStatus: 200, malformedConfig: false };
  const sourceFiles = [{ root: 'web', path: path.relative(web, sourceFile), sha256: hash(sourceFile) }];
  function plan(changes = [{ skillKey: 'parameter_test_v2', parameterKey: 'duration_ms', route: durationRoute,
    updates: { valueType: 'INTEGER', levelValues: correctedLevels } }]) {
    save('01-纠错计划.json', { changes, sourceFiles });
  }
  plan();
  async function invoke(mode, approved) {
    const previous = { argv: process.argv, fetch: globalThis.fetch, log: console.log, approved: process.env.DAMAGE_APPROVED_BATCH_SHA };
    const output = [];
    try {
      process.argv = [process.execPath, toolPath, mode, dir];
      console.log = line => output.push(JSON.parse(line));
      // 所有fetch均被替换；未列入离线资料的路径立即失败，绝不转发真实网络。
      globalThis.fetch = async (url, options) => {
        const parsed = new URL(url);
        assert.equal(parsed.origin, 'http://127.0.0.1:8080');
        const route = parsed.pathname.replace('/api/admin/games/lol', '');
        assert.equal(options.redirect, 'error');
        state.calls.push({ method: options.method, route });
        assert(Object.hasOwn(state.values, route), '未模拟的请求：' + route);
        if (options.method === 'PUT') {
          state.puts++;
          const body = JSON.parse(options.body), old = state.values[route];
          assert.deepEqual(Object.keys(body).sort(), ['name', 'description', 'valueType', 'valueMode', 'fixedValue', 'levelValues', 'sortOrder'].sort());
          const updates = read('01-纠错计划.json').changes.find(change => change.route === route).updates;
          const expectedBody = Object.fromEntries(Object.keys(body).map(key => [key, Object.hasOwn(updates, key) ? updates[key] : old[key]]));
          assert.deepEqual(body, expectedBody, '请求不得改动未明示字段');
          state.bodies.push(body);
          const updatedAt = '2026-09-21T00:00:' + String(state.puts).padStart(2, '0') + 'Z';
          state.values[route] = { ...old, ...body, updatedAt };
          if (state.extraWrite) state.values[route].description = '服务额外改动了未明示字段';
          state.values[listRoute] = state.values[listRoute].map(row => row.parameterKey === old.parameterKey ? structuredClone(state.values[route]) : row);
          if (state.reorderList) state.values[listRoute].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
          if (state.reverseOtherRows) {
            const targetRow = state.values[listRoute].find(row => row.parameterKey === old.parameterKey);
            state.values[listRoute] = [targetRow, ...state.values[listRoute].filter(row => row.parameterKey !== old.parameterKey).reverse()];
          }
          if (state.fetchFailure) throw new TypeError('模拟连接在写入后中断');
          if (state.malformed) return { status: 200, async json() {
            const journal = read('06-写入与即时回读.json');
            assert.equal(journal.operations.at(-1).responseStatus, 200);
            assert(journal.audit.some(row => row.method === 'PUT' && row.status === 200));
            state.persistedBeforeParsing = true;
            throw new SyntaxError('模拟损坏的200正文');
          } };
          return Response.json(state.values[route]);
        }
        assert.equal(options.method, 'GET', '测试禁止其他写入');
        if (route === levelConfigRoute) {
          if (state.malformedConfig) return { status: 200, async json() { throw new SyntaxError('模拟损坏的等级配置正文'); } };
          if (state.configStatus !== 200) return Response.json({ message: '模拟等级配置读取失败' }, { status: state.configStatus });
        }
        const response = Response.json(state.values[route]);
        if (state.afterGet) state.afterGet(route);
        return response;
      };
      if (approved === null) delete process.env.DAMAGE_APPROVED_BATCH_SHA;
      else if (approved !== undefined) process.env.DAMAGE_APPROVED_BATCH_SHA = approved;
      else if (fs.existsSync(path.join(dir, '02-冻结请求.json'))) process.env.DAMAGE_APPROVED_BATCH_SHA = hash(path.join(dir, '02-冻结请求.json'));
      await import(pathToFileURL(toolPath).href + '?test=' + (++sequence));
      return output;
    } finally {
      process.argv = previous.argv; globalThis.fetch = previous.fetch; console.log = previous.log;
      if (previous.approved === undefined) delete process.env.DAMAGE_APPROVED_BATCH_SHA;
      else process.env.DAMAGE_APPROVED_BATCH_SHA = previous.approved;
    }
  }
  function approve() {
    const required = [tool, '01-纠错计划.json', '02-冻结请求.json', '03-来源摘要.json', '04-写入前现值.json'];
    save('05-独立评审.json', { status: 'APPROVED', approvedFiles: Object.fromEntries(required.map(name => [name, hash(name === tool ? toolPath : path.join(dir, name))])) });
  }
  function setParameter(updates) {
    Object.assign(state.values[durationRoute], structuredClone(updates));
    state.values[listRoute] = state.values[listRoute].map(row => row.parameterKey === 'duration_ms' ? structuredClone(state.values[durationRoute]) : row);
  }
  function planCharacter(updates = {}, before = { valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null }) {
    setParameter(before);
    plan([{ skillKey: 'parameter_test_v2', parameterKey: 'duration_ms', route: durationRoute,
      updates: { valueMode: 'CHARACTER_LEVEL', fixedValue: null, levelValues: structuredClone(characterLevels), ...updates } }]);
  }
  try { await run({ state, original, invoke, approve, read, save, plan, planCharacter, setParameter, dir, sourceFile }); }
  finally {
    const resolved = path.resolve(dir);
    assert(resolved.startsWith(prefix) && path.dirname(resolved) === path.dirname(prefix));
    fs.rmSync(resolved, { recursive: true });
  }
}

test('DECIMAL转INTEGER仅按明示完整等级值更正，并通过独立GET回读', () => fixture(async f => {
  await f.invoke('prepare'); f.approve();
  const frozen = f.read('02-冻结请求.json').requests[0];
  assert.deepEqual(frozen.body.levelValues, correctedLevels);
  assert(!Object.hasOwn(frozen.body, 'parameterKey'));
  assert.deepEqual(frozen.expectedReadback, { ...f.original[durationRoute], valueType: 'INTEGER', levelValues: correctedLevels });
  assert.equal((await f.invoke('preflight'))[0].businessWrites, 0);
  assert.equal((await f.invoke('write'))[0].status, 'PASS');
  const callsBefore = f.state.calls.length, report = (await f.invoke('readback'))[0];
  assert.equal(report.status, 'PASS'); assert.equal(report.businessWrites, 0);
  assert.equal(report.GETs, 11); assert.equal(report.unchangedResponsesIncludingTimestamps, 9);
  assert.equal(report.expectedChangedCollections, 1);
  assert.deepEqual(report.values, f.state.values);
  assert(f.state.calls.slice(callsBefore).every(call => call.method === 'GET'));
  assert.deepEqual(report.values[durationRoute].levelValues, correctedLevels);
  assert.equal(report.values[durationRoute].createdAt, stamp);
  await assert.rejects(f.invoke('write'), /已有06记录/); assert.equal(f.state.puts, 1);
}));

test('名称更正保留原生DECIMAL全部数值，不隐式舍入', () => fixture(async f => {
  f.plan([{ skillKey: 'parameter_test_v2', parameterKey: 'duration_ms', route: durationRoute, updates: { name: '控制持续时间' } }]);
  await f.invoke('prepare'); f.approve(); await f.invoke('write');
  const report = (await f.invoke('readback'))[0];
  assert.equal(report.status, 'PASS');
  assert.deepEqual(report.values[durationRoute], { ...f.original[durationRoute], name: '控制持续时间', updatedAt: f.state.values[durationRoute].updatedAt });
  assert.deepEqual(f.state.bodies[0].levelValues, f.original[durationRoute].levelValues);
}));

test('同一列表多个参数累计核对完整字段和所有未变行', () => fixture(async f => {
  const p = f.read('01-纠错计划.json');
  p.changes.push({ skillKey: 'parameter_test_v2', parameterKey: 'base_damage', route: damageRoute, updates: { name: '基础伤害' } });
  f.plan(p.changes); await f.invoke('prepare'); f.approve(); await f.invoke('write');
  const report = (await f.invoke('readback'))[0];
  assert.equal(report.status, 'PASS'); assert.equal(f.state.puts, 2);
  assert.equal(report.expectedChangedCollections, 1);
  assert.deepEqual(report.values[damageRoute].levelValues, f.original[damageRoute].levelValues);
  assert.deepEqual(report.values[listRoute][1], report.values[damageRoute]);
}));

test('明示名称或排序更改只允许目标行移动，其他行相对顺序保持', async () => {
  for (const variant of ['sort', 'name', 'otherRows']) await fixture(async f => {
    const updates = variant === 'name' ? { name: 'Z' } : { sortOrder: 30 };
    if (variant === 'name') {
      f.state.values[durationRoute].name = 'A'; f.state.values[listRoute][0].name = 'A';
      f.state.values[damageRoute].name = 'B'; f.state.values[listRoute][1].name = 'B';
      f.state.values[damageRoute].sortOrder = 10; f.state.values[listRoute][1].sortOrder = 10;
    }
    if (variant === 'otherRows') {
      const other = { ...structuredClone(f.state.values[damageRoute]), parameterKey: 'another', sortOrder: 25 };
      f.state.values[listRoute].push(other); f.state.values[listRoute + '/another'] = structuredClone(other);
      f.state.reverseOtherRows = true;
    }
    f.plan([{ skillKey: 'parameter_test_v2', parameterKey: 'duration_ms', route: durationRoute, updates }]);
    await f.invoke('prepare'); f.approve(); f.state.reorderList = true;
    if (variant === 'otherRows') await assert.rejects(f.invoke('write'), /非目标行或相对顺序变化/);
    else {
      await f.invoke('write');
      assert.equal((await f.invoke('readback'))[0].status, 'PASS');
      assert.equal(f.state.values[listRoute][1].parameterKey, 'duration_ms');
    }
    assert.equal(f.state.puts, 1);
  });
});

test('FIXED和SKILL_LEVEL切换必须明确清空旧模式字段并提交完整目标值', () => fixture(async f => {
  f.plan([{ skillKey: 'parameter_test_v2', parameterKey: 'duration_ms', route: durationRoute,
    updates: { valueMode: 'FIXED', valueType: 'INTEGER', fixedValue: 1250, levelValues: null } }]);
  await f.invoke('prepare'); f.approve(); await f.invoke('write');
  assert.equal((await f.invoke('readback'))[0].status, 'PASS');
  assert.equal(f.state.values[durationRoute].fixedValue, 1250);
  assert.equal(f.state.values[durationRoute].levelValues, null);
}));

test('缺等级、错误等级键、数字字符串、非有限值及非整数均不能准备', async () => {
  for (const variant of ['missing', 'extra', 'key', 'string', 'fraction', 'typeOnly', 'nonfinite', 'unsafe']) await fixture(async f => {
    const p = f.read('01-纠错计划.json'), updates = p.changes[0].updates;
    if (variant === 'missing') delete updates.levelValues['5'];
    if (variant === 'extra') updates.levelValues['6'] = 1750;
    if (variant === 'key') { updates.levelValues['01'] = updates.levelValues['1']; delete updates.levelValues['1']; }
    if (variant === 'string') updates.levelValues['2'] = '1350';
    if (variant === 'fraction') updates.levelValues['2'] = 1350.000024;
    if (variant === 'typeOnly') delete updates.levelValues;
    if (variant === 'nonfinite') updates.levelValues['2'] = 'NONFINITE';
    if (variant === 'unsafe') updates.levelValues['2'] = Number.MAX_SAFE_INTEGER + 1;
    f.save('01-纠错计划.json', p);
    if (variant === 'nonfinite') {
      const file = path.join(f.dir, '01-纠错计划.json');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"NONFINITE"', '1e999'));
    }
    await assert.rejects(f.invoke('prepare')); assert.equal(f.state.puts, 0);
    assert(!fs.existsSync(path.join(f.dir, '02-冻结请求.json')));
  });
});

test('模式互斥、固定值数值类型及不支持的原值或目标模式都明确拒绝', async () => {
  for (const variant of ['fixedMap', 'levelFixed', 'fixedString', 'fixedNull', 'targetRuntime', 'originalRuntime']) await fixture(async f => {
    const p = f.read('01-纠错计划.json'), updates = p.changes[0].updates;
    if (variant === 'fixedMap') { updates.valueMode = 'FIXED'; updates.fixedValue = 1; }
    if (variant === 'levelFixed') updates.fixedValue = 1;
    if (variant === 'fixedString') Object.assign(updates, { valueMode: 'FIXED', levelValues: null, fixedValue: '1' });
    if (variant === 'fixedNull') Object.assign(updates, { valueMode: 'FIXED', levelValues: null, fixedValue: null });
    if (variant === 'targetRuntime') Object.assign(updates, { valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null });
    if (variant === 'originalRuntime') {
      f.state.values[durationRoute].valueMode = 'RUNTIME_INPUT';
      f.state.values[listRoute][0].valueMode = 'RUNTIME_INPUT';
    }
    f.save('01-纠错计划.json', p);
    await assert.rejects(f.invoke('prepare')); assert.equal(f.state.puts, 0);
  });
});

test('空更新、无实际变化、标识不符及未授权字段不能悄悄忽略', async () => {
  for (const variant of ['empty', 'unchanged', 'identity', 'metadata', 'implicit', 'route']) await fixture(async f => {
    const p = f.read('01-纠错计划.json'), change = p.changes[0];
    if (variant === 'empty') change.updates = {};
    if (variant === 'unchanged') change.updates = { name: f.original[durationRoute].name };
    if (variant === 'identity') change.updates.parameterKey = 'another';
    if (variant === 'metadata') change.updates.createdAt = '2026-09-21T02:00:00Z';
    if (variant === 'implicit') change.name = 'updates之外的隐式改动';
    if (variant === 'route') change.parameterKey = 'another';
    f.save('01-纠错计划.json', p);
    await assert.rejects(f.invoke('prepare')); assert.equal(f.state.puts, 0);
  });
});

test('写前全态、逐目标和列表漂移均阻止PUT', async () => {
  for (const variant of ['full', 'target', 'list']) await fixture(async f => {
    await f.invoke('prepare'); f.approve();
    if (variant === 'full') f.state.values[root + '/formulas/duration'].updatedAt = '2026-09-21T02:00:00Z';
    else f.state.afterGet = route => {
      if (route !== root + '/trigger-rules') return;
      if (variant === 'target') f.state.values[durationRoute].levelValues['2'] = 99;
      else f.state.values[listRoute][0].levelValues['2'] = 99;
      f.state.afterGet = null;
    };
    await assert.rejects(f.invoke('write')); assert.equal(f.state.puts, 0);
  });
});

test('响应包含未明示字段变化时失败并保留记录', () => fixture(async f => {
  await f.invoke('prepare'); f.approve(); f.state.extraWrite = true;
  await assert.rejects(f.invoke('write'), /明示更新/);
  assert.equal(f.read('06-写入与即时回读.json').status, 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');
  await assert.rejects(f.invoke('write'), /已有06记录/); assert.equal(f.state.puts, 1);
}));

test('损坏200先记录真实状态，连接未知和已有06也都禁止重放', async () => {
  for (const variant of ['malformed', 'network', 'existing']) await fixture(async f => {
    await f.invoke('prepare'); f.approve();
    if (variant === 'existing') f.save('06-写入与即时回读.json', { status: 'STARTED', businessWritesAttempted: 1 });
    else if (variant === 'malformed') f.state.malformed = true;
    else f.state.fetchFailure = true;
    await assert.rejects(f.invoke('write'));
    const journal = f.read('06-写入与即时回读.json');
    if (variant === 'malformed') {
      assert.equal(journal.operations[0].responseStatus, 200); assert.equal(f.state.persistedBeforeParsing, true);
    }
    if (variant !== 'existing') assert.equal(journal.status, 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');
    assert.equal(journal.businessWritesAttempted, 1);
    await assert.rejects(f.invoke('write'), /已有06记录/);
    await assert.rejects(f.invoke('readback'), /写入结果不明/);
    assert.equal(f.state.puts, variant === 'existing' ? 0 : 1);
  });
});

test('独立回读精确保护列表数值、创建时间、即时更新时间及旧行', async () => {
  for (const variant of ['listValue', 'created', 'updated', 'otherRow']) await fixture(async f => {
    await f.invoke('prepare'); f.approve(); await f.invoke('write');
    if (variant === 'listValue') f.state.values[listRoute][0].levelValues['2'] = 99;
    if (variant === 'created') f.state.values[durationRoute].createdAt = '2026-09-21T02:00:00Z';
    if (variant === 'updated') {
      f.state.values[durationRoute].updatedAt = '2026-09-21T02:00:00Z';
      f.state.values[listRoute][0].updatedAt = '2026-09-21T02:00:00Z';
    }
    if (variant === 'otherRow') f.state.values[listRoute][1].description = '其他参数变化';
    await assert.rejects(f.invoke('readback')); assert.equal(f.state.puts, 1);
  });
});

test('来源、批准、环境摘要及冻结中隐式字段变更全部受保护', async () => {
  for (const variant of ['source', 'approval', 'environment', 'frozen', 'frozenApproved']) await fixture(async f => {
    if (variant === 'source') {
      fs.writeFileSync(f.sourceFile, '变化的来源');
      await assert.rejects(f.invoke('prepare'), /来源漂移/); assert.equal(f.state.calls.length, 0);
    } else {
      await f.invoke('prepare');
      if (variant !== 'approval') f.approve();
      if (variant.startsWith('frozen')) {
        const frozen = f.read('02-冻结请求.json'); frozen.requests[0].body.name = '计划未授权的字段';
        frozen.requests[0].expectedReadback.name = '计划未授权的字段';
        f.save('02-冻结请求.json', frozen);
        if (variant === 'frozenApproved') f.approve();
      }
      await assert.rejects(f.invoke('write', variant === 'environment' ? null : undefined));
    }
    assert.equal(f.state.puts, 0); assert(!fs.existsSync(path.join(f.dir, '06-写入与即时回读.json')));
  });
});

test('独立回读拒绝错误写入计数和丢失的完整即时列表', async () => {
  for (const variant of ['count', 'list']) await fixture(async f => {
    await f.invoke('prepare'); f.approve(); await f.invoke('write');
    const journal = f.read('06-写入与即时回读.json');
    if (variant === 'count') journal.businessWritesAttempted = 0;
    else delete journal.operations[0].listReadback;
    f.save('06-写入与即时回读.json', journal);
    await assert.rejects(f.invoke('readback')); assert.equal(f.state.puts, 1);
  });
});

test('单参数由无默认运行输入转为完整18级角色等级，保留157.5并独立回读', () => fixture(async f => {
  f.planCharacter();
  delete f.state.values[damageRoute];
  f.state.values[listRoute] = [structuredClone(f.state.values[durationRoute])];
  const original = structuredClone(f.state.values[durationRoute]);
  const prepared = (await f.invoke('prepare'))[0];
  assert.equal(prepared.plannedPUTs, 1);
  const frozen = f.read('02-冻结请求.json'), baseline = f.read('04-写入前现值.json');
  assert.deepEqual(baseline.values[levelConfigRoute], { gameId: 'lol', minLevel: 1, maxLevel: 18 });
  assert.equal(baseline.audit.filter(row => row.path === levelConfigRoute && row.method === 'GET').length, 1);
  assert.equal(baseline.values[root].maxLevel, 5);
  assert.deepEqual(frozen.requests[0].body.levelValues, characterLevels);
  assert.equal(frozen.requests[0].body.levelValues['14'], 157.5);
  assert.deepEqual(frozen.requests[0].expectedReadback, { ...original, valueMode: 'CHARACTER_LEVEL', levelValues: characterLevels });
  f.approve();
  assert.equal((await f.invoke('preflight'))[0].status, 'PASS');
  assert.equal((await f.invoke('write'))[0].status, 'PASS');
  const callsBefore = f.state.calls.length, report = (await f.invoke('readback'))[0];
  assert.equal(report.status, 'PASS'); assert.equal(report.businessWrites, 0);
  assert.equal(report.GETs, 10); assert.equal(report.unchangedResponsesIncludingTimestamps, 8);
  assert.deepEqual(report.values, f.state.values);
  assert.deepEqual(report.values[durationRoute].levelValues, characterLevels);
  assert.equal(report.values[durationRoute].createdAt, original.createdAt);
  assert.equal(f.state.puts, 1);
  assert(f.state.calls.slice(callsBefore).every(call => call.method === 'GET'));
  assert(f.state.calls.filter(call => call.route === levelConfigRoute).every(call => call.method === 'GET'));
  await assert.rejects(f.invoke('write'), /已有06记录/); assert.equal(f.state.puts, 1);
}));

test('角色等级采用实际游戏范围，非1起点与单级范围不使用技能maxLevel', async () => {
  for (const [minLevel, maxLevel] of [[3, 7], [8, 8], [1, 20]]) await fixture(async f => {
    f.state.values[levelConfigRoute] = { gameId: 'lol', minLevel, maxLevel };
    const levels = Object.fromEntries(Array.from({ length: maxLevel - minLevel + 1 }, (_, index) => [String(minLevel + index), 100 + index + 0.5]));
    f.planCharacter({ levelValues: levels });
    await f.invoke('prepare'); f.approve(); await f.invoke('write');
    const report = (await f.invoke('readback'))[0];
    assert.equal(report.status, 'PASS');
    assert.deepEqual(report.values[durationRoute].levelValues, levels);
    assert.deepEqual(report.values[levelConfigRoute], { gameId: 'lol', minLevel, maxLevel });
    assert.equal(f.state.puts, 1);
  });
});

test('既有角色等级参数可维护，也可按合法目标切换固定值或技能等级', async () => {
  for (const variant of ['name', 'values', 'fixed', 'skill']) await fixture(async f => {
    f.setParameter({ valueMode: 'CHARACTER_LEVEL', fixedValue: null, levelValues: characterLevels });
    const updates = variant === 'name' ? { name: '角色等级基础值' }
      : variant === 'values' ? { levelValues: { ...characterLevels, '14': 158.5 } }
      : variant === 'fixed' ? { valueMode: 'FIXED', fixedValue: 157.5, levelValues: null }
      : { valueMode: 'SKILL_LEVEL', levelValues: correctedLevels };
    f.plan([{ skillKey: 'parameter_test_v2', parameterKey: 'duration_ms', route: durationRoute, updates }]);
    await f.invoke('prepare'); f.approve(); await f.invoke('write');
    assert.equal((await f.invoke('readback'))[0].status, 'PASS'); assert.equal(f.state.puts, 1);
  });
});

test('固定值和技能等级可转角色等级，原固定值必须明确清空', async () => {
  for (const originalMode of ['FIXED', 'SKILL_LEVEL']) await fixture(async f => {
    f.planCharacter({}, { valueMode: originalMode, fixedValue: originalMode === 'FIXED' ? 10 : null,
      levelValues: originalMode === 'FIXED' ? null : correctedLevels });
    await f.invoke('prepare'); f.approve(); await f.invoke('write');
    assert.equal((await f.invoke('readback'))[0].status, 'PASS');
    assert.equal(f.state.values[durationRoute].fixedValue, null);
    assert.deepEqual(f.state.values[durationRoute].levelValues, characterLevels);
  });
  await fixture(async f => {
    f.planCharacter({}, { valueMode: 'FIXED', fixedValue: 10, levelValues: null });
    const p = f.read('01-纠错计划.json'); delete p.changes[0].updates.fixedValue;
    f.save('01-纠错计划.json', p);
    await assert.rejects(f.invoke('prepare'), /须明确清空旧固定值/); assert.equal(f.state.puts, 0);
  });
});

test('等级配置缺失、非法边界、错误游戏和坏响应在准备阶段拒绝', async () => {
  const invalid = [null, [], {}, { minLevel: 1, maxLevel: 18 },
    { gameId: 'other', minLevel: 1, maxLevel: 18 },
    ...['minLevel', 'maxLevel'].flatMap(key => [undefined, null, '18', true, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity].map(value => ({ gameId: 'lol', minLevel: 1, maxLevel: 18, [key]: value }))),
    { gameId: 'lol', minLevel: 19, maxLevel: 18 }];
  for (const config of invalid) await fixture(async f => {
    f.planCharacter(); f.state.values[levelConfigRoute] = config;
    await assert.rejects(f.invoke('prepare'), /游戏等级配置/);
    assert.equal(f.state.puts, 0);
    assert(!fs.existsSync(path.join(f.dir, '02-冻结请求.json')));
  });
  for (const variant of ['missing', 'notFound', 'serverError', 'malformed']) await fixture(async f => {
    f.planCharacter();
    if (variant === 'missing') delete f.state.values[levelConfigRoute];
    else if (variant === 'malformed') f.state.malformedConfig = true;
    else f.state.configStatus = variant === 'notFound' ? 404 : 500;
    await assert.rejects(f.invoke('prepare')); assert.equal(f.state.puts, 0);
    assert(!fs.existsSync(path.join(f.dir, '02-冻结请求.json')));
  });
});

test('角色等级图拒绝空图、缺级、多级、错键、越界及固定值残留', async () => {
  for (const variant of ['null', 'array', 'empty', 'missing', 'extra', 'leadingZero', 'zero', 'fractionKey', 'negativeKey', 'fixed', 'belowMin', 'aboveMax']) await fixture(async f => {
    f.planCharacter();
    const p = f.read('01-纠错计划.json'), updates = p.changes[0].updates;
    if (variant === 'null') updates.levelValues = null;
    if (variant === 'array') updates.levelValues = Object.values(characterLevels);
    if (variant === 'empty') updates.levelValues = {};
    if (variant === 'missing') delete updates.levelValues['18'];
    if (variant === 'extra') updates.levelValues['19'] = 250;
    if (['leadingZero', 'zero', 'fractionKey', 'negativeKey'].includes(variant)) {
      const key = { leadingZero: '01', zero: '0', fractionKey: '1.5', negativeKey: '-1' }[variant];
      updates.levelValues[key] = updates.levelValues['1']; delete updates.levelValues['1'];
    }
    if (variant === 'fixed') updates.fixedValue = 0;
    if (variant === 'belowMin' || variant === 'aboveMax') {
      f.state.values[levelConfigRoute] = { gameId: 'lol', minLevel: 3, maxLevel: 5 };
      updates.levelValues = variant === 'belowMin' ? { '2': 20, '4': 40, '5': 50 } : { '3': 30, '4': 40, '6': 60 };
    }
    f.save('01-纠错计划.json', p);
    await assert.rejects(f.invoke('prepare')); assert.equal(f.state.puts, 0);
    assert(!fs.existsSync(path.join(f.dir, '02-冻结请求.json')));
  });
});

test('角色等级只接受原生有限数值，整数拒绝小数和不安全整数', async () => {
  for (const variant of ['string', 'null', 'boolean', 'object', 'nonfinite', 'fraction', 'unsafe']) await fixture(async f => {
    f.planCharacter();
    const p = f.read('01-纠错计划.json'), updates = p.changes[0].updates;
    const bad = { string: '157.5', null: null, boolean: true, object: {}, nonfinite: 'NONFINITE', fraction: 157.5, unsafe: Number.MAX_SAFE_INTEGER + 1 }[variant];
    if (variant === 'fraction' || variant === 'unsafe') {
      updates.valueType = 'INTEGER';
      updates.levelValues = Object.fromEntries(Object.keys(characterLevels).map(key => [key, 100]));
    }
    updates.levelValues['14'] = bad;
    f.save('01-纠错计划.json', p);
    if (variant === 'nonfinite') {
      const file = path.join(f.dir, '01-纠错计划.json');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"NONFINITE"', '1e999'));
    }
    await assert.rejects(f.invoke('prepare'), /原生有限数值|安全整数/); assert.equal(f.state.puts, 0);
  });
});

test('运行输入原值必须无默认值，且只能转为角色等级目标', async () => {
  for (const variant of ['fixedDefault', 'mapDefault', 'emptyMapDefault', 'fixedMissing', 'mapMissing', 'fixedTarget', 'skillTarget', 'runtimeTarget']) await fixture(async f => {
    f.planCharacter();
    if (variant === 'fixedDefault') f.setParameter({ fixedValue: 0 });
    if (variant === 'mapDefault') f.setParameter({ levelValues: { '1': 20 } });
    if (variant === 'emptyMapDefault') f.setParameter({ levelValues: {} });
    if (variant === 'fixedMissing' || variant === 'mapMissing') {
      const key = variant === 'fixedMissing' ? 'fixedValue' : 'levelValues';
      delete f.state.values[durationRoute][key]; delete f.state.values[listRoute][0][key];
    }
    const p = f.read('01-纠错计划.json');
    if (variant === 'fixedTarget') p.changes[0].updates = { valueMode: 'FIXED', fixedValue: 10, levelValues: null };
    if (variant === 'skillTarget') p.changes[0].updates = { valueMode: 'SKILL_LEVEL', fixedValue: null, levelValues: correctedLevels };
    if (variant === 'runtimeTarget') p.changes[0].updates = { valueMode: 'RUNTIME_INPUT', name: '仍为运行输入', fixedValue: null, levelValues: null };
    f.save('01-纠错计划.json', p);
    await assert.rejects(f.invoke('prepare')); assert.equal(f.state.puts, 0);
  });
  for (const originalMode of ['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL']) await fixture(async f => {
    f.setParameter({ valueMode: originalMode, fixedValue: originalMode === 'FIXED' ? 10 : null,
      levelValues: originalMode === 'FIXED' ? null : originalMode === 'CHARACTER_LEVEL' ? characterLevels : correctedLevels });
    f.plan([{ skillKey: 'parameter_test_v2', parameterKey: 'duration_ms', route: durationRoute,
      updates: { valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null } }]);
    await assert.rejects(f.invoke('prepare'), /不允许写入运行输入/); assert.equal(f.state.puts, 0);
  });
});

test('冻结后上下界漂移在预检和写前拒绝，逐笔写前也重核配置', async () => {
  for (const mode of ['preflight', 'write']) for (const key of ['minLevel', 'maxLevel']) await fixture(async f => {
    f.planCharacter(); await f.invoke('prepare'); f.approve();
    f.state.values[levelConfigRoute][key]++;
    await assert.rejects(f.invoke(mode), /保护现值漂移/); assert.equal(f.state.puts, 0);
    assert(!fs.existsSync(path.join(f.dir, '06-写入与即时回读.json')));
  });
  await fixture(async f => {
    f.planCharacter(); await f.invoke('prepare'); f.approve();
    f.state.afterGet = route => {
      if (route === root + '/trigger-rules') { f.state.values[levelConfigRoute].maxLevel++; f.state.afterGet = null; }
    };
    await assert.rejects(f.invoke('write'), /游戏等级配置漂移/); assert.equal(f.state.puts, 0);
    assert.equal(f.read('06-写入与即时回读.json').status, 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');
    await assert.rejects(f.invoke('write'), /已有06记录/); assert.equal(f.state.puts, 0);
  });
});

test('所有模式固定保护完整等级配置，独立回读拒绝写后的上下界漂移', async () => {
  for (const key of ['minLevel', 'maxLevel']) await fixture(async f => {
    f.planCharacter(); await f.invoke('prepare'); f.approve(); await f.invoke('write');
    f.state.values[levelConfigRoute][key]++;
    await assert.rejects(f.invoke('readback'), /独立回读与受保护终值不一致/); assert.equal(f.state.puts, 1);
  });
  await fixture(async f => {
    await f.invoke('prepare'); f.approve();
    f.state.values[levelConfigRoute].maxLevel++;
    await assert.rejects(f.invoke('write'), /保护现值漂移/); assert.equal(f.state.puts, 0);
  });
  await fixture(async f => {
    f.planCharacter(); await f.invoke('prepare');
    const baseline = f.read('04-写入前现值.json'); delete baseline.values[levelConfigRoute];
    f.save('04-写入前现值.json', baseline);
    const frozen = f.read('02-冻结请求.json'); frozen.baselineSha256 = hash(path.join(f.dir, '04-写入前现值.json'));
    f.save('02-冻结请求.json', frozen); f.approve();
    const callsBefore = f.state.calls.length;
    await assert.rejects(f.invoke('write'), /游戏等级配置缺失/);
    assert.equal(f.state.calls.length, callsBefore); assert.equal(f.state.puts, 0);
  });
});

test('角色等级转换的损坏响应、连接未知和已有06均保留防重放保护', async () => {
  for (const variant of ['malformed', 'network', 'existing']) await fixture(async f => {
    f.planCharacter(); await f.invoke('prepare'); f.approve();
    if (variant === 'existing') f.save('06-写入与即时回读.json', { status: 'STARTED', businessWritesAttempted: 1 });
    else if (variant === 'malformed') f.state.malformed = true;
    else f.state.fetchFailure = true;
    await assert.rejects(f.invoke('write'));
    const report = f.read('06-写入与即时回读.json');
    if (variant === 'malformed') {
      assert.equal(report.operations[0].responseStatus, 200);
      assert(f.state.persistedBeforeParsing);
    }
    if (variant !== 'existing') assert.equal(report.status, 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');
    await assert.rejects(f.invoke('write'), /已有06记录/);
    await assert.rejects(f.invoke('readback'), /写入结果不明/);
    assert.equal(f.state.puts, variant === 'existing' ? 0 : 1);
  });
});
