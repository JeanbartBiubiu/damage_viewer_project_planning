import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPackageBoundaries, parsePackageStream } from './check-package-boundaries.mjs';

const pkg = (name, imports = [], testImports = []) => ({ ImportPath: `tinygo_engine_v2/internal/${name}`, Imports: imports.map(value => `tinygo_engine_v2/internal/${value}`), TestImports: testImports });

test('合法基础和运行子包依赖通过，包内测试依赖不冒充生产依赖', () => {
  const packages = [pkg('model'), pkg('base/expression'), pkg('base/inputbinding', ['base/expression']), pkg('base/attribute', ['model']), pkg('base/numeric', ['model']), pkg('runtime/contract', ['model', 'base/attribute']), pkg('runtime/actor', ['runtime/contract', 'base/attribute', 'model']), pkg('runtime/execution', ['base/numeric', 'pipeline']), pkg('runtime/report', ['model'], ['tinygo_engine_v2/internal/runtime'])];
  assert.deepEqual(checkPackageBoundaries(packages), []);
});

test('基础层越界和共享模型反向依赖会失败', () => {
  const errors = checkPackageBoundaries([pkg('base/expression', ['formula']), pkg('base/attribute', ['runtime']), pkg('base/numeric', ['pipeline']), pkg('model', ['pipeline'])]);
  assert.equal(errors.length, 4);
  assert.ok(errors.some(value => value.includes('base/expression -> formula')));
  assert.ok(errors.some(value => value.includes('base/attribute -> runtime')));
  assert.ok(errors.some(value => value.includes('base/numeric -> pipeline')));
  assert.ok(errors.some(value => value.includes('model -> pipeline')));
});

test('运行子系统不得反向依赖根包或互相取得执行控制', () => {
  const errors = checkPackageBoundaries([pkg('runtime/action', ['runtime/effect', 'runtime']), pkg('runtime/effect', ['runtime/action']), pkg('runtime/report', ['runtime/execution']), pkg('runtime/contract', ['runtime/actor'])]);
  assert.equal(errors.length, 6);
  for (const edge of ['runtime/action -> runtime/effect', 'runtime/action -> runtime', 'runtime/effect -> runtime/action', 'runtime/report -> runtime/execution', 'runtime/contract -> runtime/actor']) assert.ok(errors.some(value => value.includes(edge)), edge);
  assert.ok(errors.some(value => value.startsWith('包依赖循环:')));
});

test('只读计划不得依赖编译器或运行包，旧路径与未知叶包拒绝', () => {
  const errors = checkPackageBoundaries([pkg('plan', ['compile', 'runtime/action']), pkg('compile', ['attribute']), pkg('trigger'), pkg('base'), pkg('base/new'), pkg('runtime/new'), ...['crit', 'control', 'mark', 'status', 'command', 'resource', 'shield'].map(name => pkg(name))]);
  assert.equal(errors.length, 14);
  for (const name of ['crit', 'control', 'mark', 'status', 'command', 'resource', 'shield']) assert.ok(errors.some(value => value.startsWith(`${name}:`)), name);
});

test('统一结算不得反向取得执行器、状态所有者或旧包能力', () => {
  assert.deepEqual(checkPackageBoundaries([pkg('pipeline', ['model', 'plan', 'formula', 'base/attribute', 'base/numeric'])]), []);
  const errors = checkPackageBoundaries([pkg('pipeline', ['runtime/execution', 'runtime/effect', 'compile', 'shield'])]);
  for (const edge of ['pipeline -> runtime/execution', 'pipeline -> runtime/effect', 'pipeline -> compile', 'pipeline -> shield']) assert.ok(errors.some(value => value.includes(edge)), edge);
});

test('连续JSON解析保留嵌套对象和转义字符串', () => {
  const packages = [pkg('model'), { ...pkg('base/abi', ['model']), Doc: 'a { brace } and "quote" and \\', Module: { Path: 'tinygo_engine_v2' } }];
  assert.deepEqual(parsePackageStream(packages.map(value => JSON.stringify(value, null, 2)).join('\n')), packages);
  assert.throws(() => parsePackageStream('{"ImportPath":"unfinished"'));
  assert.throws(() => parsePackageStream('not json'));
  assert.throws(() => parsePackageStream('"not an object"'));
});

test('根运行入口与调度不能重新持有业务依赖或形成第二套执行循环', () => {
  assert.deepEqual(checkPackageBoundaries([pkg('runtime', ['compile', 'base/abi', 'model', 'plan', 'runtime/execution', 'scheduler']), pkg('scheduler', ['model'])]), []);
  const errors = checkPackageBoundaries([pkg('runtime', ['pipeline', 'runtime/action', 'base/attribute']), pkg('scheduler', ['runtime/execution'])]);
  assert.equal(errors.length, 4);
  for (const edge of ['runtime -> pipeline', 'runtime -> runtime/action', 'runtime -> base/attribute', 'scheduler -> runtime/execution']) assert.ok(errors.some(value => value.includes(edge)), edge);
});

const executionLeaves = ['admission', 'hit', 'listener', 'evaluation'].map(name => `runtime/execution/${name}`);

test('四个执行子包按明确白名单供父执行器组合', () => {
  assert.deepEqual(checkPackageBoundaries([
    pkg('runtime/execution', executionLeaves),
    pkg('runtime/execution/admission', ['model', 'plan', 'formula', 'pipeline', 'base/attribute']),
    pkg('runtime/execution/hit', ['model', 'plan']),
    pkg('runtime/execution/listener', ['model', 'plan', 'base/typeset']),
    pkg('runtime/execution/evaluation', ['model', 'plan', 'formula', 'pipeline', 'runtime/effect', 'base/attribute', 'base/expression', 'base/inputbinding']),
  ]), []);
});

test('执行子包不能反向调用父层、调度或相互取得控制能力', () => {
  for (const leaf of executionLeaves) {
    const forbidden = ['runtime', 'runtime/execution', 'scheduler', ...executionLeaves.filter(other => other !== leaf)];
    const errors = checkPackageBoundaries([pkg(leaf, forbidden)]);
    for (const dependency of forbidden) {
      assert.ok(errors.some(value => value.includes(`${leaf} -> ${dependency}:`)), `${leaf} -> ${dependency}`);
    }
  }
  const unknown = checkPackageBoundaries([pkg('runtime/execution/undeclared')]);
  assert.ok(unknown.some(value => value.includes('没有声明依赖边界')));
});

test('数值、行动、效果、报告和调度不能取得四个执行子包的能力', () => {
  for (const owner of ['runtime/actor', 'runtime/action', 'runtime/effect', 'runtime/report', 'pipeline', 'scheduler']) {
    const errors = checkPackageBoundaries([pkg(owner, executionLeaves)]);
    for (const leaf of executionLeaves) {
      assert.ok(errors.some(value => value.includes(`${owner} -> ${leaf}:`)), `${owner} -> ${leaf}`);
    }
  }
});
