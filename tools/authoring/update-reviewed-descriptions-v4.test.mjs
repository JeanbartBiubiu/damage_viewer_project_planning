import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tool = 'tools/authoring/update-reviewed-descriptions-v4.mjs';
const toolPath = path.join(web, tool);
const root = '/skills/description_test';
const ruleRoute = root + '/trigger-rules/on_used';
const parameterRoute = root + '/parameters/base_damage';
const effectRoute = root + '/effects/damage';
const stamp = '2026-09-21T00:00:00Z';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let sequence = 0;

async function fixture(run) {
  const prefix = path.join(web, '数据参考', '.description-v4-tool-test-');
  const dir = fs.mkdtempSync(prefix);
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value) + '\n');
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const sourceFile = path.join(dir, 'source.txt');
  fs.writeFileSync(sourceFile, '固定离线来源，不访问业务服务\n');
  const rootValue = { gameId: 'lol', skillKey: 'description_test', name: '说明测试', description: '原技能说明',
    maxLevel: 3, status: 'ENABLED', sortOrder: 10, skillCategoryKeys: ['ultimate'], createdAt: stamp, updatedAt: stamp };
  const rule = { ruleKey: 'on_used', name: '使用入口', description: '原规则说明', sortOrder: 10,
    eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'description_test', useKind: null } },
    conditionGroups: [{ groupKey: 'self', name: '自身', sortOrder: 10, conditions: [
      { conditionKey: 'self', conditionType: 'EXPLICIT_TARGET_IS_SOURCE', detail: {}, sortOrder: 10 }
    ] }],
    actions: [{ actionKey: 'start', name: '开始过程', actionType: 'START_PROCESS', sortOrder: 10,
      targetContext: 'SOURCE', detail: { processKey: 'cast' }, runtimeInputBindings: [], resultModifiers: [] }],
    perTargetCooldown: { durationValue: { kind: 'FIXED', value: 1 } }, maxTriggersPerProcess: 2 };
  const ruleSummary = { ruleKey: rule.ruleKey, name: rule.name, description: rule.description, sortOrder: rule.sortOrder,
    eventType: rule.eventSource.eventType, conditionGroupCount: rule.conditionGroups.length, actionCount: rule.actions.length,
    perTargetCooldownEnabled: true, maxTriggersPerProcessEnabled: true, createdAt: stamp, updatedAt: stamp };
  const parameter = { gameId: 'lol', skillKey: 'description_test', parameterKey: 'base_damage', name: '基础伤害', description: '原参数说明',
    valueType: 'NUMBER', valueMode: 'LEVEL', fixedValue: null, levelValues: [{ level: 1, value: 100 }, { level: 2, value: 200 }],
    sortOrder: 10, createdAt: stamp, updatedAt: stamp };
  const otherParameter = { ...structuredClone(parameter), parameterKey: 'scaling', name: '系数', sortOrder: 20 };
  const effect = { gameId: 'lol', skillKey: 'description_test', effectKey: 'damage', name: '伤害', description: '原效果说明',
    lifecycle: null, results: [
      { resultKey: 'damage', name: '伤害', resultType: 'DAMAGE', target: 'TARGET', description: '原伤害说明', sortOrder: 10,
        detail: { damageTypeKey: 'magic', deliveryKind: 'DIRECT', originKind: 'SKILL' },
        valueRule: { value: { kind: 'FORMULA', formulaKey: 'total' }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        spellShieldBlockScope: 'RESULT', lifecycleBehavior: null },
      { resultKey: 'consume_mana', name: '消耗法力', resultType: 'RESOURCE_CHANGE', target: 'SOURCE', description: '消耗法力尚未接线', sortOrder: 20,
        detail: { attributeKey: 'mp', operation: 'CONSUME' },
        valueRule: { value: { kind: 'PARAMETER', parameterKey: 'base_damage' }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        spellShieldBlockScope: null, lifecycleBehavior: null },
      { resultKey: 'consume_energy', name: '消耗能量', resultType: 'RESOURCE_CHANGE', target: 'SOURCE', description: '其他结果说明', sortOrder: 30,
        detail: { attributeKey: 'energy', operation: 'CONSUME' },
        valueRule: { value: { kind: 'FIXED', value: 5 }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        spellShieldBlockScope: null, lifecycleBehavior: null }
    ],
    sortOrder: 10, createdAt: stamp, updatedAt: stamp };
  const { lifecycle, results, ...effectMeta } = effect;
  const values = {
    [root]: rootValue,
    [root + '/parameters']: [structuredClone(parameter), structuredClone(otherParameter)],
    [parameterRoute]: parameter, [root + '/parameters/scaling']: otherParameter,
    [root + '/formulas']: [{ formulaKey: 'total', name: '总量', createdAt: stamp, updatedAt: stamp }],
    [root + '/formulas/total']: { formulaKey: 'total', expression: { kind: 'FIXED', value: 100 }, createdAt: stamp, updatedAt: stamp },
    [root + '/effects']: [{ ...effectMeta, resultCount: results.length, lifecycleEnabled: false }], [effectRoute]: effect,
    [root + '/processes']: [], [root + '/internal-states']: [],
    [root + '/trigger-rules']: [ruleSummary], [ruleRoute]: rule
  };
  const original = structuredClone(values);
  const state = { values, puts: 0, putBodies: [], calls: [], malformed: false, fetchFailure: false, persistedBeforeParsing: false };
  const sourceFiles = [{ root: 'web', path: path.relative(web, sourceFile), sha256: hash(sourceFile) }];
  function plan(changes = [{ kind: 'trigger-rule', route: ruleRoute, skillKey: 'description_test', description: '实际伤害仍由原命中规则处理' }]) {
    save('01-纠错计划.json', { changes, sourceFiles });
  }
  plan();
  async function invoke(mode, approved) {
    const previous = { argv: process.argv, fetch: globalThis.fetch, log: console.log, approved: process.env.DAMAGE_APPROVED_BATCH_SHA };
    const output = [];
    try {
      process.argv = [process.execPath, toolPath, mode, dir];
      console.log = line => output.push(JSON.parse(line));
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
          state.putBodies.push(structuredClone(body));
          assert.equal(body.description, read('01-纠错计划.json').changes.find(change => change.route === route).description);
          const isRule = route.includes('/trigger-rules/');
          if (isRule) {
            const expectedBody = structuredClone({ ...old, description: body.description });
            delete expectedBody.ruleKey;
            if (expectedBody.eventSource.detail.useKind === null) delete expectedBody.eventSource.detail.useKind;
            assert.deepEqual(body, expectedBody, '规则只能修改说明并移除请求禁用字段');
          }
          const updatedAt = '2026-09-21T00:00:' + String(state.puts).padStart(2, '0') + 'Z';
          state.values[route] = { ...old, ...body, ...(isRule ? { eventSource: old.eventSource } : { updatedAt }) };
          if (route !== root) {
            const listRoute = route.slice(0, route.lastIndexOf('/'));
            const stableKey = isRule ? 'ruleKey' : route.includes('/parameters/') ? 'parameterKey' : 'effectKey';
            state.values[listRoute] = state.values[listRoute].map(row => row[stableKey] === old[stableKey] ? { ...row, description: body.description, updatedAt } : row);
          }
          if (state.afterPut) state.afterPut(route);
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
        return Response.json(state.values[route]);
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
  try { await run({ state, original, invoke, approve, read, save, plan, dir, sourceFile }); }
  finally {
    const resolved = path.resolve(dir);
    assert(resolved.startsWith(prefix) && path.dirname(resolved) === path.dirname(prefix));
    fs.rmSync(resolved, { recursive: true });
  }
}

test('规则仅改说明，完整保留事件动作限流，独立GET回读通过', () => fixture(async f => {
  await f.invoke('prepare');
  const frozen = f.read('02-冻结请求.json').requests[0];
  assert(!Object.hasOwn(frozen.body, 'ruleKey'));
  assert(!Object.hasOwn(frozen.body.eventSource.detail, 'useKind'));
  assert.equal(frozen.expectedReadback.eventSource.detail.useKind, null);
  assert.deepEqual(frozen.expectedReadback, { ...f.original[ruleRoute], description: frozen.body.description });
  f.approve();
  assert.equal((await f.invoke('preflight'))[0].businessWrites, 0);
  assert.equal((await f.invoke('write'))[0].status, 'PASS');
  assert.deepEqual(f.state.values[ruleRoute], frozen.expectedReadback);
  const readsBefore = f.state.calls.length;
  const report = (await f.invoke('readback'))[0];
  assert.equal(report.status, 'PASS'); assert.equal(report.businessWrites, 0);
  assert.equal(report.GETs, 12); assert.equal(report.unchangedResponsesIncludingTimestamps, 10);
  assert.equal(report.expectedChangedCollections, 1);
  assert.deepEqual(report.values, f.state.values);
  assert(f.state.calls.slice(readsBefore).every(call => call.method === 'GET'));
  await assert.rejects(f.invoke('write'), /已有06记录/);
  assert.equal(f.state.puts, 1);
}));

test('非空使用类型保持原值', () => fixture(async f => {
  f.state.values[ruleRoute].eventSource.detail.useKind = 'NORMAL';
  await f.invoke('prepare');
  assert.equal(f.read('02-冻结请求.json').requests[0].body.eventSource.detail.useKind, 'NORMAL');
  f.approve(); await f.invoke('write');
  assert.equal((await f.invoke('readback'))[0].status, 'PASS');
}));

test('事件或动作漂移时不写入；独立回读也拒绝后续漂移', async () => {
  for (const field of ['eventSource', 'actions']) for (const phase of ['before', 'after']) await fixture(async f => {
    await f.invoke('prepare'); f.approve();
    if (phase === 'after') await f.invoke('write');
    if (field === 'eventSource') f.state.values[ruleRoute].eventSource.detail.sourceSkillKey = 'another_skill';
    else f.state.values[ruleRoute].actions[0].detail.processKey = 'another_process';
    await assert.rejects(f.invoke(phase === 'before' ? 'write' : 'readback'));
    assert.equal(f.state.puts, phase === 'before' ? 0 : 1);
    if (phase === 'before') assert(!fs.existsSync(path.join(f.dir, '06-写入与即时回读.json')));
  });
});

test('规则列表时间戳必须与即时写入记录精确一致，旧响应时间戳和其他字段也受保护', async () => {
  for (const variant of ['ruleTime', 'ruleField', 'oldTime']) await fixture(async f => {
    await f.invoke('prepare'); f.approve(); await f.invoke('write');
    if (variant === 'ruleTime') f.state.values[root + '/trigger-rules'][0].updatedAt = '2026-09-21T00:02:00Z';
    if (variant === 'ruleField') f.state.values[root + '/trigger-rules'][0].name = '未经批准的新名称';
    if (variant === 'oldTime') f.state.values[root + '/formulas/total'].updatedAt = '2026-09-21T00:02:00Z';
    await assert.rejects(f.invoke('readback'));
    assert.equal(f.state.puts, 1);
  });
});

test('已有06记录且现值未变时仍禁止重放', () => fixture(async f => {
  await f.invoke('prepare'); f.approve();
  f.save('06-写入与即时回读.json', { status: 'STARTED', businessWritesAttempted: 1 });
  const bytes = fs.readFileSync(path.join(f.dir, '06-写入与即时回读.json'));
  await assert.rejects(f.invoke('write'), /已有06记录/);
  assert.equal(f.state.puts, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.dir, '06-写入与即时回读.json')), bytes);
}));

test('非规则三种路径及同一参数列表多目标均保留完整字段并独立回读', () => fixture(async f => {
  f.plan([
    { kind: 'skill', route: root, skillKey: 'description_test', description: '新技能说明' },
    { kind: 'parameter', route: parameterRoute, skillKey: 'description_test', description: '新参数说明' },
    { kind: 'parameter', route: root + '/parameters/scaling', skillKey: 'description_test', description: '新系数说明' },
    { kind: 'effect', route: effectRoute, skillKey: 'description_test', description: '新效果说明' }
  ]);
  await f.invoke('prepare'); f.approve(); await f.invoke('write');
  const report = (await f.invoke('readback'))[0];
  assert.equal(report.status, 'PASS'); assert.equal(f.state.puts, 4);
  assert.deepEqual(report.values[parameterRoute].levelValues, f.original[parameterRoute].levelValues);
  assert.deepEqual(report.values[root + '/parameters'][0], report.values[parameterRoute]);
  assert.equal(report.expectedChangedCollections, 2);
  // 仅修改列表中的完整数值字段，也不能被摘要比较漏掉。
  f.state.values[root + '/parameters'][0].levelValues[0].value = 999;
  await assert.rejects(f.invoke('readback'));
}));

test('损坏200响应在解析前持久化状态和尝试，禁止重放', () => fixture(async f => {
  await f.invoke('prepare'); f.approve(); f.state.malformed = true;
  await assert.rejects(f.invoke('write'), /模拟损坏/);
  const journal = f.read('06-写入与即时回读.json');
  assert.equal(journal.status, 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');
  assert.equal(journal.operations[0].responseStatus, 200);
  assert.equal(journal.businessWritesAttempted, 1);
  assert.equal(journal.pendingRoute, ruleRoute);
  assert.equal(f.state.persistedBeforeParsing, true);
  assert.equal(f.state.values[ruleRoute].description, f.read('01-纠错计划.json').changes[0].description);
  await assert.rejects(f.invoke('write'), /已有06记录/);
  await assert.rejects(f.invoke('readback'), /写入结果不明/);
  assert.equal(f.state.puts, 1);
}));

test('网络中断但服务已落地时仍保留尝试，不重放', () => fixture(async f => {
  await f.invoke('prepare'); f.approve(); f.state.fetchFailure = true;
  await assert.rejects(f.invoke('write'), /模拟连接/);
  const journal = f.read('06-写入与即时回读.json');
  assert.equal(journal.businessWritesAttempted, 1);
  assert.equal(journal.operations.length, 1);
  assert.equal(journal.status, 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');
  assert(!Object.hasOwn(journal.operations[0], 'responseStatus'));
  await assert.rejects(f.invoke('write'), /已有06记录/);
  assert.equal(f.state.puts, 1);
}));

test('来源声明不符、批准缺失、摘要不匹配、冻结篡改均阻止写入', async () => {
  for (const variant of ['source', 'approval', 'environment', 'frozen', 'frozenWithApproval']) await fixture(async f => {
    if (variant === 'source') {
      fs.writeFileSync(f.sourceFile, '变化的来源');
      await assert.rejects(f.invoke('prepare'), /来源漂移/);
      assert.equal(f.state.calls.length, 0);
    } else {
      await f.invoke('prepare');
      if (variant !== 'approval') f.approve();
      if (variant.startsWith('frozen')) {
        const frozen = f.read('02-冻结请求.json'); frozen.requests[0].body.actions = [];
        f.save('02-冻结请求.json', frozen);
        if (variant === 'frozenWithApproval') f.approve();
      }
      await assert.rejects(f.invoke('write', variant === 'environment' ? null : undefined));
    }
    assert.equal(f.state.puts, 0);
    assert(!fs.existsSync(path.join(f.dir, '06-写入与即时回读.json')));
  });
});

test('独立回读拒绝伪造的成功计数、丢失即时列表或错误批准绑定', async () => {
  for (const variant of ['count', 'list', 'approval']) await fixture(async f => {
    await f.invoke('prepare'); f.approve(); await f.invoke('write');
    const journal = f.read('06-写入与即时回读.json');
    if (variant === 'count') journal.businessWritesAttempted = 0;
    if (variant === 'list') delete journal.operations[0].listReadback;
    if (variant === 'approval') journal.approvedFiles[tool] = '0'.repeat(64);
    f.save('06-写入与即时回读.json', journal);
    await assert.rejects(f.invoke('readback'));
    assert.equal(f.state.puts, 1);
  });
});

const resultDescription = { resultKey: 'consume_mana', description: '普通使用时由使用成本入口消耗法力' };
const effectChange = (updates = {}) => ({
  kind: 'effect', route: effectRoute, skillKey: 'description_test', description: '法力消耗已接入使用成本',
  resultDescriptions: [structuredClone(resultDescription)], ...updates
});

test('父说明与指定子结果说明一次PUT完成，冻结正文及独立回读保留所有其他字段', () => fixture(async f => {
  f.plan([effectChange()]);
  const prepared = (await f.invoke('prepare'))[0];
  assert.equal(prepared.plannedPUTs, 1);
  const frozen = f.read('02-冻结请求.json').requests[0];
  const expected = structuredClone(f.original[effectRoute]);
  expected.description = '法力消耗已接入使用成本';
  expected.results[1].description = resultDescription.description;
  assert.deepEqual(frozen.expectedReadback, expected);
  const { gameId, skillKey, effectKey, createdAt, updatedAt, ...body } = expected;
  assert.deepEqual(frozen.body, body);
  assert.deepEqual(f.read('04-写入前现值.json').values, f.original);
  assert(f.state.calls.every(call => call.method === 'GET'));
  f.approve();
  assert.equal((await f.invoke('preflight'))[0].businessWrites, 0);
  assert.equal(f.state.puts, 0);
  assert.equal((await f.invoke('write'))[0].PUTs, 1);
  assert.deepEqual(f.state.putBodies, [body]);
  const journal = f.read('06-写入与即时回读.json');
  assert.deepEqual(journal.operations[0].readback, f.state.values[effectRoute]);
  assert.deepEqual(journal.operations[0].listReadback, f.state.values[root + '/effects']);
  const callsBefore = f.state.calls.length;
  const report = (await f.invoke('readback'))[0];
  assert.equal(report.status, 'PASS');
  assert.equal(report.businessWrites, 0);
  assert.deepEqual(report.values, f.state.values);
  assert(f.state.calls.slice(callsBefore).every(call => call.method === 'GET'));
}));

test('父说明保持原值而子说明变化仍只写一次；独立回读保留父说明', () => fixture(async f => {
  f.plan([effectChange({ description: f.original[effectRoute].description })]);
  await f.invoke('prepare'); f.approve(); await f.invoke('write');
  const report = (await f.invoke('readback'))[0];
  assert.equal(f.state.puts, 1);
  assert.equal(report.values[effectRoute].description, f.original[effectRoute].description);
  assert.equal(report.values[effectRoute].results[1].description, resultDescription.description);
}));

test('多个子结果按标识修改，计划顺序不改变原结果数组或未指定结果', () => fixture(async f => {
  f.state.values[effectRoute].lifecycle = { durationValue: { kind: 'FIXED', value: 1000 }, instanceScope: 'SOURCE' };
  f.state.values[root + '/effects'][0].lifecycleEnabled = true;
  f.state.values[effectRoute].results[0].lifecycleBehavior = { moment: 'ON_APPLY', valueReadMode: 'SNAPSHOT' };
  const before = structuredClone(f.state.values[effectRoute]);
  f.plan([effectChange({ resultDescriptions: [resultDescription, { resultKey: 'damage', description: '命中伤害说明纠正' }] })]);
  await f.invoke('prepare'); f.approve(); await f.invoke('write');
  const after = (await f.invoke('readback'))[0].values[effectRoute];
  assert.equal(f.state.puts, 1);
  assert.deepEqual(after.results.map(result => result.resultKey), before.results.map(result => result.resultKey));
  assert.deepEqual(after.results, before.results.map((result, index) => index === 2 ? result
    : { ...result, description: index === 0 ? '命中伤害说明纠正' : resultDescription.description }));
  assert.deepEqual(after.lifecycle, before.lifecycle);
}));

test('空数组、非法结构、重复标识、额外字段及越权数值在GET之前拒绝', async () => {
  const invalidChanges = [
    null, [],
    effectChange({ resultDescriptions: [] }), effectChange({ resultDescriptions: null }),
    effectChange({ resultDescriptions: {} }), effectChange({ resultDescriptions: 'consume_mana' }),
    effectChange({ resultDescriptions: [null] }), effectChange({ resultDescriptions: [[]] }),
    effectChange({ resultDescriptions: [{ resultKey: 'consume_mana' }] }),
    effectChange({ resultDescriptions: [{ description: '缺少标识' }] }),
    effectChange({ resultDescriptions: [resultDescription, resultDescription] }),
    effectChange({ resultDescriptions: [{ ...resultDescription, resultKey: '' }] }),
    effectChange({ resultDescriptions: [{ ...resultDescription, resultKey: '../damage' }] }),
    effectChange({ resultDescriptions: [{ ...resultDescription, resultKey: '0invalid' }] }),
    effectChange({ resultDescriptions: [{ ...resultDescription, resultKey: 'a'.repeat(65) }] }),
    effectChange({ resultDescriptions: [{ ...resultDescription, resultKey: 3 }] }),
    effectChange({ resultDescriptions: [{ ...resultDescription, valueRule: { value: { kind: 'FIXED', value: 999 } } }] }),
    effectChange({ resultDescriptions: [{ ...resultDescription, newResultKey: 'new_result' }] }),
    effectChange({ resultDescriptions: [{ ...resultDescription, detail: { attributeKey: 'hp' } }] }),
    effectChange({ resultDescriptions: [{ ...resultDescription, spellShieldBlockScope: null }] }),
    effectChange({ resultDescriptions: [{ ...resultDescription, lifecycleBehavior: null }] }),
    effectChange({ results: [] }), effectChange({ lifecycle: null }), effectChange({ sortOrder: 0 }),
    effectChange({ unknown: true }), effectChange({ route: effectRoute + '/results/consume_mana' })
  ];
  for (const change of invalidChanges) await fixture(async f => {
    f.plan([change]);
    await assert.rejects(f.invoke('prepare'));
    assert.equal(f.state.calls.length, 0);
    assert.equal(f.state.puts, 0);
    assert(!fs.existsSync(path.join(f.dir, '02-冻结请求.json')));
  });
});

test('技能、参数、触发规则禁止resultDescriptions，无论数组是否为空', async () => {
  for (const [kind, route] of [['skill', root], ['parameter', parameterRoute], ['trigger-rule', ruleRoute]]) {
    for (const resultDescriptions of [[], [resultDescription]]) await fixture(async f => {
      f.plan([{ kind, route, skillKey: 'description_test', description: '新说明', resultDescriptions }]);
      await assert.rejects(f.invoke('prepare'), /仅效果允许/);
      assert.equal(f.state.calls.length, 0);
    });
  }
});

test('子结果说明须非空且最多2000字符，拒绝服务端会规范化的首尾空格', async () => {
  for (const description of [null, 1, '', ' ', ' 说明', '说明\n', '字'.repeat(2001)]) await fixture(async f => {
    f.plan([effectChange({ resultDescriptions: [{ ...resultDescription, description }] })]);
    await assert.rejects(f.invoke('prepare'), /子结果说明须/);
    assert.equal(f.state.calls.length, 0);
  });
  await fixture(async f => {
    const description = '字'.repeat(2000);
    f.plan([effectChange({ description, resultDescriptions: [{ ...resultDescription, description }] })]);
    await f.invoke('prepare'); f.approve(); await f.invoke('write');
    assert.equal((await f.invoke('readback'))[0].values[effectRoute].results[1].description, description);
  });
});

test('缺失或重复的既有结果、缺少结果数组拒绝准备；不会新增或猜测目标', async () => {
  for (const variant of ['missing', 'duplicate', 'invalid', 'noResults']) await fixture(async f => {
    f.plan([effectChange()]);
    if (variant === 'missing') f.plan([effectChange({ resultDescriptions: [{ ...resultDescription, resultKey: 'not_found' }] })]);
    if (variant === 'duplicate') f.state.values[effectRoute].results.push(structuredClone(f.state.values[effectRoute].results[1]));
    if (variant === 'invalid') f.state.values[effectRoute].results[0].resultKey = null;
    if (variant === 'noResults') delete f.state.values[effectRoute].results;
    await assert.rejects(f.invoke('prepare'), /子结果不存在|既有结果标识|缺少结果数组/);
    assert.equal(f.state.puts, 0);
    assert(!fs.existsSync(path.join(f.dir, '02-冻结请求.json')));
  });
});

test('父子均无实际变化拒绝写入计划，父变化允许子说明保持原值', async () => {
  for (const withChildren of [false, true]) await fixture(async f => {
    const change = effectChange({ description: f.original[effectRoute].description,
      resultDescriptions: [{ resultKey: 'consume_mana', description: f.original[effectRoute].results[1].description }] });
    if (!withChildren) delete change.resultDescriptions;
    f.plan([change]);
    await assert.rejects(f.invoke('prepare'), /说明已一致/);
    assert.equal(f.state.puts, 0);
    assert(!fs.existsSync(path.join(f.dir, '02-冻结请求.json')));
  });
  await fixture(async f => {
    f.plan([effectChange({ resultDescriptions: [{ resultKey: 'consume_mana', description: f.original[effectRoute].results[1].description }] })]);
    await f.invoke('prepare'); f.approve(); await f.invoke('write');
    assert.equal((await f.invoke('readback'))[0].status, 'PASS');
    assert.equal(f.state.puts, 1);
  });
});

test('来源或完整基线在批准后变化时，写前核对和写入均停止且不建立06', async () => {
  for (const phase of ['preflight', 'write']) for (const variant of ['source', 'description', 'value', 'order', 'otherComponent']) await fixture(async f => {
    f.plan([effectChange()]);
    await f.invoke('prepare'); f.approve();
    if (variant === 'source') fs.writeFileSync(f.sourceFile, '批准后来源变化');
    if (variant === 'description') f.state.values[effectRoute].results[1].description = '旁路说明';
    if (variant === 'value') f.state.values[effectRoute].results[2].valueRule.fixedMultiplier = 2;
    if (variant === 'order') f.state.values[effectRoute].results.reverse();
    if (variant === 'otherComponent') f.state.values[root + '/formulas/total'].expression.value = 500;
    await assert.rejects(f.invoke(phase), /来源漂移|保护现值漂移/);
    assert.equal(f.state.puts, 0);
    assert(!fs.existsSync(path.join(f.dir, '06-写入与即时回读.json')));
  });
});

test('即使重新批准冻结文件，也不能借结果说明计划修改数值、键、顺序或未选说明', async () => {
  for (const variant of ['value', 'key', 'order', 'unselected']) await fixture(async f => {
    f.plan([effectChange()]);
    await f.invoke('prepare');
    const frozen = f.read('02-冻结请求.json');
    for (const resultContainer of [frozen.requests[0].body, frozen.requests[0].expectedReadback]) {
      if (variant === 'value') resultContainer.results[1].valueRule.fixedMultiplier = 999;
      if (variant === 'key') resultContainer.results[1].resultKey = 'renamed';
      if (variant === 'order') resultContainer.results.reverse();
      if (variant === 'unselected') resultContainer.results[2].description = '计划外说明';
    }
    f.save('02-冻结请求.json', frozen); f.approve();
    await assert.rejects(f.invoke('write'));
    assert.equal(f.state.puts, 0);
    assert(!fs.existsSync(path.join(f.dir, '06-写入与即时回读.json')));
  });
});

test('父子写入损坏响应或网络结果不明时记录一次尝试，禁止重放和成功回读', async () => {
  for (const failure of ['malformed', 'fetchFailure']) await fixture(async f => {
    f.plan([effectChange()]);
    await f.invoke('prepare'); f.approve(); f.state[failure] = true;
    await assert.rejects(f.invoke('write'), /模拟/);
    const journal = f.read('06-写入与即时回读.json');
    assert.equal(journal.status, 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');
    assert.equal(journal.businessWritesAttempted, 1);
    assert.equal(journal.pendingRoute, effectRoute);
    assert.equal(f.state.values[effectRoute].results[1].description, resultDescription.description);
    if (failure === 'malformed') {
      assert.equal(journal.operations[0].responseStatus, 200);
      assert.equal(f.state.persistedBeforeParsing, true);
    } else assert(!Object.hasOwn(journal.operations[0], 'responseStatus'));
    await assert.rejects(f.invoke('write'), /已有06记录/);
    await assert.rejects(f.invoke('readback'), /写入结果不明/);
    assert.equal(f.state.puts, 1);
  });
});

test('写响应中子结果出现非说明变化时立即失败且禁止重放', () => fixture(async f => {
  f.plan([effectChange()]);
  await f.invoke('prepare'); f.approve();
  f.state.afterPut = route => { f.state.values[route].results[1].valueRule.fixedMultiplier = 99; };
  await assert.rejects(f.invoke('write'), /详情出现说明和更新时间之外的变化/);
  const journal = f.read('06-写入与即时回读.json');
  assert.equal(journal.status, 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');
  assert.equal(journal.operations[0].responseStatus, 200);
  await assert.rejects(f.invoke('write'), /已有06记录/);
  assert.equal(f.state.puts, 1);
}));

test('独立回读发现子结果、生命周期、完整列表、其他组成及时间戳的旁路变化', async () => {
  const mutations = [
    values => { values[effectRoute].results[1].valueRule.fixedMultiplier = 99; },
    values => { values[effectRoute].results[1].valueRule.value.parameterKey = 'scaling'; },
    values => { values[effectRoute].results[1].detail.attributeKey = 'hp'; },
    values => { values[effectRoute].results[1].resultKey = 'renamed'; },
    values => { values[effectRoute].results[1].spellShieldBlockScope = 'RESULT'; },
    values => { values[effectRoute].results[1].lifecycleBehavior = { moment: 'ON_APPLY' }; },
    values => { values[effectRoute].results[2].description = '未选结果说明旁路变化'; },
    values => { values[effectRoute].results.reverse(); },
    values => { values[effectRoute].lifecycle = { durationValue: { kind: 'FIXED', value: 1000 } }; },
    values => { values[effectRoute].createdAt = '2026-09-20T00:00:00Z'; },
    values => { values[effectRoute].updatedAt = '2026-09-21T00:00:59Z'; },
    values => { values[root + '/effects'][0].resultCount = 99; },
    values => { values[root + '/effects'][0].updatedAt = '2026-09-21T00:00:59Z'; },
    values => { values[root + '/parameters'][0].levelValues[0].value = 999; },
    values => { values[root + '/formulas/total'].updatedAt = '2026-09-21T00:00:59Z'; }
  ];
  for (const mutate of mutations) await fixture(async f => {
    f.plan([effectChange()]);
    await f.invoke('prepare'); f.approve(); await f.invoke('write');
    mutate(f.state.values);
    await assert.rejects(f.invoke('readback'), /独立回读与受保护终值不一致/);
    assert.equal(f.state.puts, 1);
  });
});
