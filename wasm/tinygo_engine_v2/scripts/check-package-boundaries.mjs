import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const modulePrefix = 'tinygo_engine_v2/internal/';
const baseDependencies = new Map([
  ['base/abi', new Set(['model'])],
  ['base/attribute', new Set(['model'])],
  ['base/expression', new Set()],
  ['base/inputbinding', new Set(['base/expression'])],
  ['base/numeric', new Set(['model'])],
  ['base/typeset', new Set(['model'])],
]);
const runtimeDependencies = new Map([
  ['runtime', new Set(['base/abi', 'compile', 'model', 'plan', 'runtime/execution', 'scheduler'])],
  ['scheduler', new Set(['model'])],
  ['runtime/execution', new Set(['runtime/actor', 'runtime/action', 'runtime/effect', 'runtime/report', 'runtime/contract', 'model', 'plan', 'formula', 'pipeline', 'resource', 'command', 'scheduler', 'base/attribute', 'base/expression', 'base/inputbinding', 'base/numeric', 'base/typeset'])],
  ['runtime/action', new Set(['runtime/contract', 'model', 'plan', 'formula', 'base/attribute', 'base/expression', 'base/inputbinding', 'base/typeset'])],
  ['runtime/effect', new Set(['runtime/contract', 'model', 'plan', 'formula', 'pipeline', 'shield', 'base/attribute', 'command'])],
  ['runtime/actor', new Set(['runtime/contract', 'base/attribute', 'model'])],
  ['runtime/report', new Set(['runtime/contract', 'model'])],
  ['runtime/contract', new Set(['model', 'plan', 'base/attribute'])],
]);
const retiredPackages = new Set(['abi', 'attribute', 'expression', 'inputbinding', 'typeset', 'trigger', 'crit', 'control', 'mark', 'status']);

// go list 输出连续的 JSON 对象；只在字符串以外计算括号，避免源码注释或转义影响边界。
export function parsePackageStream(source) {
  const packages = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (depth === 0 && char !== '{' && !/\s/.test(char)) throw new Error('go list 输出不是连续 JSON 对象');
    if (char === '"') inString = true;
    else if (char === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth < 0) throw new Error('go list JSON 对象边界不完整');
      if (depth === 0) {
        packages.push(JSON.parse(source.slice(start, i + 1)));
        start = -1;
      }
    } else if (depth === 0 && !/\s/.test(char)) {
      throw new Error('go list 输出不是连续 JSON 对象');
    }
  }
  if (depth !== 0 || inString) throw new Error('go list JSON 对象未结束');
  return packages;
}

export function checkPackageBoundaries(packages) {
  const errors = [];
  const graph = new Map();
  for (const pkg of packages) {
    if (!pkg.ImportPath?.startsWith(modulePrefix)) continue;
    const name = pkg.ImportPath.slice(modulePrefix.length);
    const imports = (pkg.Imports ?? []).filter(value => value.startsWith(modulePrefix)).map(value => value.slice(modulePrefix.length));
    graph.set(name, imports);
    if (retiredPackages.has(name)) errors.push(`${name}: 已删除的旧包路径不能恢复`);
    if ((name === 'base' || name.startsWith('base/')) && !baseDependencies.has(name)) errors.push(`${name}: 基础层没有声明此包的依赖边界`);
    if (name.startsWith('runtime/') && !runtimeDependencies.has(name)) errors.push(`${name}: 运行子包没有声明依赖边界`);
    for (const dependency of imports) {
      if (retiredPackages.has(dependency)) errors.push(`${name} -> ${dependency}: 禁止旧包或转发兼容路径`);
      const allowed = baseDependencies.get(name) ?? runtimeDependencies.get(name);
      if (allowed && !allowed.has(dependency)) errors.push(`${name} -> ${dependency}: 越出该包依赖白名单`);
      if (name === 'model') errors.push(`${name} -> ${dependency}: 共享协议不得反向依赖业务包`);
      if (name === 'plan' && (dependency === 'compile' || dependency === 'runtime' || dependency.startsWith('runtime/'))) errors.push(`${name} -> ${dependency}: 只读计划不得依赖编译器或运行包`);
    }
  }
  const active = new Set();
  const visited = new Set();
  function visit(name, chain) {
    if (active.has(name)) {
      errors.push(`包依赖循环: ${[...chain, name].join(' -> ')}`);
      return;
    }
    if (visited.has(name)) return;
    active.add(name);
    for (const dependency of graph.get(name) ?? []) visit(dependency, [...chain, name]);
    active.delete(name);
    visited.add(name);
  }
  for (const name of graph.keys()) visit(name, []);
  return [...new Set(errors)];
}

export function readPackages(moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  return parsePackageStream(execFileSync('go', ['list', '-json', './internal/...'], { cwd: moduleRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const packages = readPackages();
  const errors = checkPackageBoundaries(packages);
  if (errors.length) {
    process.stderr.write(errors.join('\n') + '\n');
    process.exitCode = 1;
  } else {
    process.stdout.write(JSON.stringify({ packages: packages.length, scope: 'base/model/plan/scheduler/runtime及全部子包生产导入', rootRuntime: '接线与唯一循环组合' }) + '\n');
  }
}
