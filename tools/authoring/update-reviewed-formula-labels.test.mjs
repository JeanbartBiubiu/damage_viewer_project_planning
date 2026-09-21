import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tool = 'tools/authoring/update-reviewed-formula-labels.mjs';
const toolPath = path.join(web, tool);
const root = '/skills/formula_test', listRoute = root + '/formulas';
const damageRoute = listRoute + '/total_damage', secondRoute = listRoute + '/other_damage';
const stamp = '2026-09-21T00:00:00Z';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const summary = ({ expression, ...rest }) => structuredClone(rest);
const change = (updates, formulaKey = 'total_damage') => ({ skillKey: 'formula_test', formulaKey, route: listRoute + '/' + formulaKey, updates });
let sequence = 0;

async function fixture(run) {
  const prefix = path.join(web, '数据参考', '.formula-label-tool-test-');
  const dir = fs.mkdtempSync(prefix);
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value) + '\n');
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const sourceFile = path.join(dir, 'source.txt');
  fs.writeFileSync(sourceFile, '固定离线来源，不访问业务服务\n');
  const damage = {
    gameId: 'lol', skillKey: 'formula_test', formulaKey: 'total_damage', name: 'A', description: '旧阶段说明',
    sortOrder: 10, createdAt: stamp, updatedAt: stamp,
    expression: { nodeType: 'OPERATION', operation: 'ADD', operands: [
      { nodeType: 'PARAMETER', parameterKey: 'base_damage' },
      { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [
        { nodeType: 'PARAMETER', parameterKey: 'ability_power_ratio' },
        { nodeType: 'ATTRIBUTE', attributeKey: 'ability_power', attributeOwner: 'SOURCE', attributeValueKind: 'TOTAL' }
      ] }
    ] }
  };
  const other = { ...structuredClone(damage), formulaKey: 'other_damage', name: 'B', description: null };
  const third = { ...structuredClone(damage), formulaKey: 'third_damage', name: 'C', description: '第三公式' };
  const parameter = { gameId: 'lol', skillKey: 'formula_test', parameterKey: 'base_damage', name: '基础伤害',
    description: null, valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 60.0000000001,
    levelValues: null, sortOrder: 10, createdAt: stamp, updatedAt: stamp };
  const effect = { effectKey: 'primary_hit', name: '本体伤害', createdAt: stamp, updatedAt: stamp,
    results: [{ resultKey: 'damage', valueRule: { formulaKey: 'total_damage' } }] };
  const values = {
    [root]: { gameId: 'lol', skillKey: 'formula_test', name: '公式测试', maxLevel: 5, status: 'ENABLED', createdAt: stamp, updatedAt: stamp },
    [listRoute]: [summary(damage), summary(other), summary(third)],
    [damageRoute]: damage, [secondRoute]: other, [listRoute + '/third_damage']: third,
    [root + '/parameters']: [structuredClone(parameter)], [root + '/parameters/base_damage']: parameter,
    [root + '/effects']: [summary(effect)], [root + '/effects/primary_hit']: effect,
    [root + '/processes']: [], [root + '/internal-states']: [], [root + '/trigger-rules']: []
  };
  const original = structuredClone(values);
  const state = { values, puts: 0, calls: [], bodies: [], malformed: false, fetchFailure: false,
    persistedBeforeParsing: false, afterGet: null, afterPut: null, status: 200, reorderList: false };
  const sourceFiles = [{ root: 'web', path: path.relative(web, sourceFile), sha256: hash(sourceFile) }];
  const plan = (changes = [change({ description: '本体命中总魔法伤害的数值公式。' })]) => save('01-纠错计划.json', { changes, sourceFiles });
  plan();
  async function invoke(mode, approved) {
    const previous = { argv: process.argv, fetch: globalThis.fetch, log: console.log, approved: process.env.DAMAGE_APPROVED_BATCH_SHA };
    const output = [];
    try {
      process.argv = [process.execPath, toolPath, mode, dir];
      console.log = line => output.push(JSON.parse(line));
      // 所有 fetch 均被替换；未模拟的路径立即失败，绝不转发真实网络。
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
          assert.deepEqual(Object.keys(body).sort(), ['name', 'description', 'expression', 'sortOrder'].sort());
          const updates = read('01-纠错计划.json').changes.find(item => item.route === route).updates;
          const expectedBody = Object.fromEntries(Object.keys(body).map(key => [key, Object.hasOwn(updates, key) ? updates[key] : old[key]]));
          assert.deepEqual(body, expectedBody, '请求不得改动未明示字段');
          state.bodies.push(body);
          const updatedAt = '2026-09-21T00:00:' + String(state.puts).padStart(2, '0') + 'Z';
          state.values[route] = { ...old, ...body, updatedAt };
          state.values[listRoute] = state.values[listRoute].map(row => row.formulaKey === old.formulaKey ? summary(state.values[route]) : row);
          if (state.reorderList) state.values[listRoute].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
          if (state.afterPut) state.afterPut(route);
          if (state.fetchFailure) throw new TypeError('模拟连接在写入后中断');
          if (state.malformed) return { status: state.status, async json() {
            const journal = read('06-写入与即时回读.json');
            assert.equal(journal.operations.at(-1).responseStatus, state.status);
            assert(journal.audit.some(row => row.method === 'PUT' && row.status === state.status));
            state.persistedBeforeParsing = true;
            throw new SyntaxError('模拟损坏的响应正文');
          } };
          return Response.json(state.values[route], { status: state.status });
        }
        assert.equal(options.method, 'GET', '测试禁止其他写入');
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
  try { await run({ state, original, invoke, approve, read, save, plan, dir, sourceFile }); }
  finally {
    const resolved = path.resolve(dir);
    assert(resolved.startsWith(prefix) && path.dirname(resolved) === path.dirname(prefix));
    fs.rmSync(resolved, { recursive: true });
  }
}

test('说明更正保留完整表达式、引用、顺序及所有其他组成，独立回读只发GET', () => fixture(async f => {
  const prepared = (await f.invoke('prepare'))[0];
  assert.equal(prepared.plannedPUTs, 1); assert.equal(f.state.puts, 0);
  const frozen = f.read('02-冻结请求.json').requests[0];
  assert.deepEqual(frozen.body.expression, f.original[damageRoute].expression);
  assert.equal(frozen.body.sortOrder, f.original[damageRoute].sortOrder);
  assert(!Object.hasOwn(frozen.body, 'formulaKey'));
  f.approve(); assert.equal((await f.invoke('preflight'))[0].businessWrites, 0);
  assert.equal((await f.invoke('write'))[0].status, 'PASS');
  const callsBefore = f.state.calls.length, report = (await f.invoke('readback'))[0];
  assert.equal(report.status, 'PASS'); assert.equal(report.businessWrites, 0);
  assert.equal(report.GETs, 12); assert.equal(report.unchangedResponsesIncludingTimestamps, 10);
  assert.equal(report.expectedChangedCollections, 1); assert.deepEqual(report.values, f.state.values);
  assert(f.state.calls.slice(callsBefore).every(call => call.method === 'GET'));
  assert(!Object.hasOwn(report.values[listRoute][0], 'expression'));
  assert.deepEqual(report.values[damageRoute].expression, f.original[damageRoute].expression);
  assert.equal(report.values[damageRoute].createdAt, stamp);
  await assert.rejects(f.invoke('write'), /已有06记录/); assert.equal(f.state.puts, 1);
}));

test('名称与说明可同时修改，说明可明确清为null', async () => {
  for (const description of [null, '稳定公式用途']) await fixture(async f => {
    f.plan([change({ name: '本体魔法伤害', description })]);
    await f.invoke('prepare'); f.approve(); await f.invoke('write');
    assert.equal((await f.invoke('readback'))[0].status, 'PASS');
    assert.equal(f.state.values[damageRoute].description, description);
    assert.deepEqual(f.state.values[damageRoute].expression, f.original[damageRoute].expression);
  });
});

test('名称和说明的边界长度可保存，不做隐式裁剪', () => fixture(async f => {
  f.plan([change({ name: '名'.repeat(100), description: '述'.repeat(2000) })]);
  await f.invoke('prepare'); f.approve(); await f.invoke('write');
  assert.equal((await f.invoke('readback'))[0].status, 'PASS');
}));

test('非法名称或说明拒绝准备', async () => {
  for (const updates of [{ name: null }, { name: '' }, { name: ' A' }, { name: 'A ' }, { name: '名'.repeat(101) },
    { name: 1 }, { description: '' }, { description: '  ' }, { description: ' 说明' }, { description: '说明 ' },
    { description: 1 }, { description: '述'.repeat(2001) }]) await fixture(async f => {
    f.plan([change(updates)]); await assert.rejects(f.invoke('prepare')); assert.equal(f.state.puts, 0);
    assert(!fs.existsSync(path.join(f.dir, '02-冻结请求.json')));
  });
});

test('空更新、无实际变化、额外字段或标识不一致不能准备', async () => {
  for (const variant of ['empty', 'unchanged', 'extra', 'identity', 'route', 'duplicate', 'array', 'kind']) await fixture(async f => {
    const p = f.read('01-纠错计划.json'), item = p.changes[0];
    if (variant === 'empty') item.updates = {};
    if (variant === 'unchanged') item.updates = { name: 'A' };
    if (variant === 'extra') item.name = '隐式名称';
    if (variant === 'identity') item.formulaKey = 'other_damage';
    if (variant === 'route') item.route = root + '/parameters/total_damage';
    if (variant === 'duplicate') p.changes.push(structuredClone(item));
    if (variant === 'array') item.updates = [];
    if (variant === 'kind') item.kind = 'formula';
    f.save('01-纠错计划.json', p); await assert.rejects(f.invoke('prepare')); assert.equal(f.state.puts, 0);
  });
});

test('计划不能修改表达式、引用、排序、标识或元数据', async () => {
  for (const updates of [{ expression: { nodeType: 'PARAMETER', parameterKey: 'different' } },
    { parameterKey: 'different' }, { sortOrder: 20 }, { formulaKey: 'new_key' }, { skillKey: 'other_skill' },
    { gameId: 'other' }, { createdAt: stamp }, { updatedAt: stamp }, { status: 'DISABLED' }]) await fixture(async f => {
    f.plan([change(updates)]); await assert.rejects(f.invoke('prepare'), /未授权字段/);
    assert.equal(f.state.calls.length, 0);
  });
});

test('缺目标、列表缺失重复、摘要字段不符或原表达式为空均拒绝准备', async () => {
  for (const variant of ['absent', 'duplicate', 'mismatch', 'extra', 'expression', 'missingField']) await fixture(async f => {
    if (variant === 'absent') f.state.values[listRoute].shift();
    if (variant === 'duplicate') f.state.values[listRoute].push(structuredClone(f.state.values[listRoute][0]));
    if (variant === 'mismatch') f.state.values[listRoute][0].description = '与详情不符';
    if (variant === 'extra') f.state.values[listRoute][0].expression = structuredClone(f.state.values[damageRoute].expression);
    if (variant === 'expression') f.state.values[damageRoute].expression = null;
    if (variant === 'missingField') { delete f.state.values[damageRoute].description; delete f.state.values[listRoute][0].description; }
    await assert.rejects(f.invoke('prepare')); assert.equal(f.state.puts, 0);
  });
});

test('同一列表多个公式逐行累计，后续名称修改可移动自己的行', () => fixture(async f => {
  f.plan([change({ name: 'Z' }), change({ name: 'Y', description: '另一个公式' }, 'other_damage')]);
  await f.invoke('prepare'); f.approve(); f.state.reorderList = true;
  await f.invoke('write'); const report = (await f.invoke('readback'))[0];
  assert.equal(report.status, 'PASS'); assert.equal(f.state.puts, 2);
  assert.deepEqual(report.values[listRoute].map(row => row.formulaKey), ['third_damage', 'other_damage', 'total_damage']);
  assert.equal(report.unchangedResponsesIncludingTimestamps, 9);
}));

test('名称实际变化允许同排序目标行移动，其他行顺序与字段保持', () => fixture(async f => {
  f.plan([change({ name: 'Z' })]); await f.invoke('prepare'); f.approve(); f.state.reorderList = true;
  await f.invoke('write'); assert.equal((await f.invoke('readback'))[0].status, 'PASS');
  assert.equal(f.state.values[listRoute].at(-1).formulaKey, 'total_damage');
}));

test('只改说明或明示未改变的名称均不允许行重排', async () => {
  for (const updates of [{ description: '稳定说明' }, { name: 'A', description: '稳定说明' }]) await fixture(async f => {
    f.plan([change(updates)]); await f.invoke('prepare'); f.approve();
    f.state.afterPut = () => f.state.values[listRoute].push(f.state.values[listRoute].shift());
    await assert.rejects(f.invoke('write'), /目标列表出现/); assert.equal(f.state.puts, 1);
  });
});

test('改名不能带动其他行重排、变更其他行或跨排序值移动', async () => {
  for (const variant of ['reorderOthers', 'changeOther', 'sort']) await fixture(async f => {
    if (variant === 'sort') {
      f.state.values[secondRoute].sortOrder = 20; f.state.values[listRoute][1].sortOrder = 20;
      f.state.values[listRoute + '/third_damage'].sortOrder = 30; f.state.values[listRoute][2].sortOrder = 30;
    }
    f.plan([change({ name: 'Z' })]); await f.invoke('prepare'); f.approve();
    f.state.afterPut = () => {
      const [target, ...others] = f.state.values[listRoute];
      if (variant === 'reorderOthers') f.state.values[listRoute] = [...others.reverse(), target];
      if (variant === 'changeOther') f.state.values[listRoute][1].description = '其他行被改';
      if (variant === 'sort') f.state.values[listRoute] = [...others, target];
    };
    await assert.rejects(f.invoke('write'), /非目标行或相对顺序变化|排序值顺序异常/);
  });
});

test('写前完整技能的表达式、效果引用及时间戳漂移均阻止PUT', async () => {
  for (const variant of ['expression', 'reference', 'timestamp', 'root']) await fixture(async f => {
    await f.invoke('prepare'); f.approve();
    if (variant === 'expression') f.state.values[damageRoute].expression.operands[0].parameterKey = 'other';
    if (variant === 'reference') f.state.values[root + '/effects/primary_hit'].results[0].valueRule.formulaKey = 'other_damage';
    if (variant === 'timestamp') f.state.values[root + '/parameters/base_damage'].updatedAt = '2026-09-21T02:00:00Z';
    if (variant === 'root') f.state.values[root].name = '根被修改';
    await assert.rejects(f.invoke('write'), /保护现值漂移/); assert.equal(f.state.puts, 0);
  });
});

test('完整快照后发生的目标或目标列表漂移在该笔PUT前拦截', async () => {
  for (const variant of ['target', 'list']) await fixture(async f => {
    await f.invoke('prepare'); f.approve();
    f.state.afterGet = route => {
      if (route !== root + '/trigger-rules') return;
      if (variant === 'target') f.state.values[damageRoute].expression.operands.reverse();
      else f.state.values[listRoute][0].name = '并发更正';
      f.state.afterGet = null;
    };
    await assert.rejects(f.invoke('write'), /当前目标/); assert.equal(f.state.puts, 0);
  });
});

test('保存响应额外改变表达式、引用、稳定键、排序或创建时间均失败', async () => {
  for (const variant of ['expression', 'reference', 'identity', 'sort', 'created']) await fixture(async f => {
    await f.invoke('prepare'); f.approve();
    f.state.afterPut = route => {
      const detail = f.state.values[route];
      if (variant === 'expression') detail.expression.operands.reverse();
      if (variant === 'reference') detail.expression.operands[0].parameterKey = 'other';
      if (variant === 'identity') detail.formulaKey = 'other';
      if (variant === 'sort') detail.sortOrder = 20;
      if (variant === 'created') detail.createdAt = '2026-09-21T02:00:00Z';
    };
    await assert.rejects(f.invoke('write'), /明示更新/);
    assert.equal(f.read('06-写入与即时回读.json').status, 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');
    await assert.rejects(f.invoke('write'), /已有06记录/); assert.equal(f.state.puts, 1);
  });
});

test('即时完整列表必须与详情说明和更新时间一致，不能多行或少行', async () => {
  for (const variant of ['description', 'updated', 'duplicate', 'missing']) await fixture(async f => {
    await f.invoke('prepare'); f.approve();
    f.state.afterPut = () => {
      if (variant === 'description') f.state.values[listRoute][0].description = '不同说明';
      if (variant === 'updated') f.state.values[listRoute][0].updatedAt = stamp;
      if (variant === 'duplicate') f.state.values[listRoute].push(structuredClone(f.state.values[listRoute][0]));
      if (variant === 'missing') f.state.values[listRoute].pop();
    };
    await assert.rejects(f.invoke('write')); assert.equal(f.state.puts, 1);
  });
});

test('200或500损坏正文都在解析前保存真实HTTP状态并禁止重放', async () => {
  for (const status of [200, 500]) await fixture(async f => {
    await f.invoke('prepare'); f.approve(); f.state.malformed = true; f.state.status = status;
    await assert.rejects(f.invoke('write'), /损坏的响应正文/);
    const journal = f.read('06-写入与即时回读.json');
    assert.equal(journal.operations[0].responseStatus, status); assert.equal(f.state.persistedBeforeParsing, true);
    assert.equal(journal.status, 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');
    assert.equal(journal.businessWritesAttempted, 1);
    await assert.rejects(f.invoke('write'), /已有06记录/);
    await assert.rejects(f.invoke('readback'), /写入结果不明/); assert.equal(f.state.puts, 1);
  });
});

test('连接结果未知及已有06记录均禁止重放且不能用独立回读宣告成功', async () => {
  for (const variant of ['network', 'existing']) await fixture(async f => {
    await f.invoke('prepare'); f.approve();
    if (variant === 'existing') f.save('06-写入与即时回读.json', { status: 'STARTED', businessWritesAttempted: 1 });
    else f.state.fetchFailure = true;
    await assert.rejects(f.invoke('write'));
    assert.equal(f.read('06-写入与即时回读.json').businessWritesAttempted, 1);
    await assert.rejects(f.invoke('write'), /已有06记录/);
    await assert.rejects(f.invoke('readback'), /写入结果不明/);
    assert.equal(f.state.puts, variant === 'existing' ? 0 : 1);
  });
});

test('来源改变在准备前或批准后均拒绝，且不发送业务写入', async () => {
  for (const variant of ['before', 'after']) await fixture(async f => {
    if (variant === 'after') { await f.invoke('prepare'); f.approve(); }
    fs.writeFileSync(f.sourceFile, '来源被改');
    await assert.rejects(f.invoke(variant === 'after' ? 'write' : 'prepare'), /来源漂移/);
    assert.equal(f.state.puts, 0);
  });
});

test('来源必须声明准确摘要且不能越过指定根目录', async () => {
  for (const variant of ['empty', 'hash', 'root', 'escape']) await fixture(async f => {
    const p = f.read('01-纠错计划.json');
    if (variant === 'empty') p.sourceFiles = [];
    if (variant === 'hash') delete p.sourceFiles[0].sha256;
    if (variant === 'root') p.sourceFiles[0].root = 'elsewhere';
    if (variant === 'escape') p.sourceFiles[0].path = '../outside.txt';
    f.save('01-纠错计划.json', p); await assert.rejects(f.invoke('prepare'));
    assert.equal(f.state.calls.length, 0);
  });
});

test('缺批准、拒绝批准、工具摘要错误及环境摘要缺失或错误均拒绝写入', async () => {
  for (const variant of ['missing', 'rejected', 'tool', 'noenv', 'wrongenv']) await fixture(async f => {
    await f.invoke('prepare');
    if (variant !== 'missing') f.approve();
    if (variant === 'rejected' || variant === 'tool') {
      const review = f.read('05-独立评审.json');
      if (variant === 'rejected') review.status = 'REVISE';
      else review.approvedFiles[tool] = '0'.repeat(64);
      f.save('05-独立评审.json', review);
    }
    await assert.rejects(f.invoke('write', variant === 'noenv' ? null : variant === 'wrongenv' ? '0'.repeat(64) : undefined));
    assert.equal(f.state.puts, 0); assert(!fs.existsSync(path.join(f.dir, '06-写入与即时回读.json')));
  });
});

test('01至04批准文件漂移均拒绝，不重新冻结当前现值', async () => {
  for (const name of ['01-纠错计划.json', '02-冻结请求.json', '03-来源摘要.json', '04-写入前现值.json']) await fixture(async f => {
    await f.invoke('prepare'); f.approve();
    fs.appendFileSync(path.join(f.dir, name), '\n');
    await assert.rejects(f.invoke('write'), /批准文件漂移/); assert.equal(f.state.puts, 0);
  });
});

test('即使重新签摘要，冻结请求的表达式或引用也不能偏离计划与现值', async () => {
  for (const variant of ['expression', 'reference', 'sort', 'extra']) await fixture(async f => {
    await f.invoke('prepare'); const frozen = f.read('02-冻结请求.json');
    if (variant === 'expression') frozen.requests[0].body.expression.operands.reverse();
    if (variant === 'reference') frozen.requests[0].body.expression.operands[0].parameterKey = 'other';
    if (variant === 'sort') frozen.requests[0].body.sortOrder = 20;
    if (variant === 'extra') frozen.requests[0].body.formulaKey = 'other';
    f.save('02-冻结请求.json', frozen); f.approve();
    await assert.rejects(f.invoke('write')); assert.equal(f.state.puts, 0);
  });
});

test('独立回读保护全部表达式、引用、摘要、创建和更新时间及未改组成', async () => {
  for (const variant of ['expression', 'reference', 'summary', 'created', 'updated', 'otherRow', 'parameter']) await fixture(async f => {
    await f.invoke('prepare'); f.approve(); await f.invoke('write');
    if (variant === 'expression') f.state.values[damageRoute].expression.operands.reverse();
    if (variant === 'reference') f.state.values[root + '/effects/primary_hit'].results[0].valueRule.formulaKey = 'other_damage';
    if (variant === 'summary') f.state.values[listRoute][0].description = '新说明';
    if (variant === 'created') f.state.values[damageRoute].createdAt = '2026-09-21T02:00:00Z';
    if (variant === 'updated') { f.state.values[damageRoute].updatedAt = '2026-09-21T02:00:00Z'; f.state.values[listRoute][0].updatedAt = '2026-09-21T02:00:00Z'; }
    if (variant === 'otherRow') f.state.values[listRoute][1].name = '其他行变化';
    if (variant === 'parameter') f.state.values[root + '/parameters/base_damage'].fixedValue = 60;
    const callsBefore = f.state.calls.length;
    await assert.rejects(f.invoke('readback')); assert.equal(f.state.puts, 1);
    assert(f.state.calls.slice(callsBefore).every(call => call.method === 'GET'));
  });
});

test('独立回读拒绝错误写入计数、缺即时列表、挂起目标或审计丢失', async () => {
  for (const variant of ['count', 'list', 'pending', 'audit', 'response']) await fixture(async f => {
    await f.invoke('prepare'); f.approve(); await f.invoke('write');
    const journal = f.read('06-写入与即时回读.json');
    if (variant === 'count') journal.businessWritesAttempted = 0;
    if (variant === 'list') delete journal.operations[0].listReadback;
    if (variant === 'pending') journal.pendingRoute = damageRoute;
    if (variant === 'audit') journal.audit = journal.audit.filter(row => row.method === 'GET');
    if (variant === 'response') journal.operations[0].response.data.expression.operands.reverse();
    f.save('06-写入与即时回读.json', journal);
    await assert.rejects(f.invoke('readback')); assert.equal(f.state.puts, 1);
  });
});

test('已有冻结文件、批准文件或尝试记录时准备不能覆盖', async () => {
  for (const name of ['02-冻结请求.json', '03-来源摘要.json', '04-写入前现值.json', '05-独立评审.json', '06-写入与即时回读.json']) await fixture(async f => {
    f.save(name, { marker: '保留原字节' }); const before = fs.readFileSync(path.join(f.dir, name));
    await assert.rejects(f.invoke('prepare'), /拒绝覆盖/);
    assert.deepEqual(fs.readFileSync(path.join(f.dir, name)), before); assert.equal(f.state.calls.length, 0);
  });
});
