import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPackageBoundaries, parsePackageStream } from './check-package-boundaries.mjs';

const pkg = (name, imports = [], testImports = []) => ({ ImportPath: `tinygo_engine_v2/internal/${name}`, Imports: imports.map(value => `tinygo_engine_v2/internal/${value}`), TestImports: testImports });

test('合法基础和运行子包依赖通过，包内测试依赖不冒充生产依赖', () => {
  const packages = [pkg('model'), pkg('base/expression'), pkg('base/inputbinding', ['base/expression']), pkg('base/attribute', ['model']), pkg('runtime/contract', ['model', 'base/attribute']), pkg('runtime/actor', ['runtime/contract', 'base/attribute', 'model']), pkg('runtime/report', ['model'], ['tinygo_engine_v2/internal/runtime'])];
  assert.deepEqual(checkPackageBoundaries(packages), []);
});

test('基础层越界和共享模型反向依赖会失败', () => {
  const errors = checkPackageBoundaries([pkg('base/expression', ['formula']), pkg('base/attribute', ['runtime']), pkg('model', ['pipeline'])]);
  assert.equal(errors.length, 3);
  assert.ok(errors.some(value => value.includes('base/expression -> formula')));
  assert.ok(errors.some(value => value.includes('base/attribute -> runtime')));
  assert.ok(errors.some(value => value.includes('model -> pipeline')));
});

test('运行子系统不得反向依赖根包或互相取得执行控制', () => {
  const errors = checkPackageBoundaries([pkg('runtime/action', ['runtime/effect', 'runtime']), pkg('runtime/effect', ['runtime/action']), pkg('runtime/report', ['runtime/execution']), pkg('runtime/contract', ['runtime/actor'])]);
  assert.equal(errors.length, 6);
  for (const edge of ['runtime/action -> runtime/effect', 'runtime/action -> runtime', 'runtime/effect -> runtime/action', 'runtime/report -> runtime/execution', 'runtime/contract -> runtime/actor']) assert.ok(errors.some(value => value.includes(edge)), edge);
  assert.ok(errors.some(value => value.startsWith('包依赖循环:')));
});

test('只读计划不得依赖编译器或运行包，旧路径与未知叶包拒绝', () => {
  const errors = checkPackageBoundaries([pkg('plan', ['compile', 'runtime/action']), pkg('compile', ['attribute']), pkg('trigger'), pkg('base'), pkg('base/new'), pkg('runtime/new')]);
  assert.equal(errors.length, 7);
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
