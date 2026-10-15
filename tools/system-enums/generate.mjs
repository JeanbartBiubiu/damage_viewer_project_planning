import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const canonicalRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values: args } = parseArgs({ options: {
  target: { type: 'string' }, root: { type: 'string' }, check: { type: 'boolean' },
  'backend-root': { type: 'string' }, 'wasm-root': { type: 'string' }
} });
assert(['web', 'docs'].includes(args.target) && args.root && isAbsolute(args.root),
  '用法：node tools/system-enums/generate.mjs --target web|docs --root <绝对工作树路径> [--check] [--backend-root <路径>] [--wasm-root <路径>]');
const targetRoot = resolve(args.root);
if (args.target === 'web') await readFile(resolve(targetRoot, 'web/package.json'));
else assert(targetRoot === canonicalRoot && !args['backend-root'] && !args['wasm-root'], '清单表只能在规划真源维护');
const contract = JSON.parse(await readFile(resolve(canonicalRoot, 'contracts/system-enums/authoring.json'), 'utf8'));
assert(Array.isArray(contract.groups) && contract.groups.length > 0, '系统枚举清单不能为空');
const identifiers = new Set();
const groupNames = new Set();
const validIdentifier = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(value);
function exportName(name) {
  assert(validIdentifier(name) && !identifiers.has(name), `重复或非法导出：${name}`);
  identifiers.add(name);
  return name;
}
function containedPath(root, path) {
  const destination = resolve(root, path);
  const rel = relative(root, destination);
  assert(rel && !rel.startsWith('..') && !isAbsolute(rel), '枚举文件路径越出指定工作树');
  return destination;
}
const lines = ['// 由 planning 真源 tools/system-enums/generate.mjs 生成；修改 contracts/system-enums/authoring.json 后重新生成。',
  '// 固定值不表示所有运行位置都已支持；位置准入与作者目录保持独立。', ''];
for (const group of contract.groups) {
  assert(validIdentifier(group.name) && !groupNames.has(group.name), `重复枚举族：${group.name}`);
  groupNames.add(group.name);
  assert(typeof group.title === 'string' && group.title.trim(), '枚举族必须有中文用途');
  assert(group.backend === undefined || /^(skilltrigger|skillprocess)\/[A-Za-z]+\.java$/.test(group.backend), '非法后端枚举路径');
  assert(group.web && Array.isArray(group.members) && group.members.length, `空枚举族：${group.name}`);
  assert(group.backend || group.members.every(member => member.native), `运行枚举必须完整绑定原生常量：${group.name}`);
  const members = group.members.map(member => member.value);
  assert(new Set(members).size === members.length && members.every(validIdentifier), `重复或非法成员：${group.name}`);
  assert(group.members.every(member => typeof member.label === 'string' && member.label.trim()), `中文标签缺失：${group.name}`);
  const values = exportName(group.web.values), labels = exportName(group.web.labels), typeName = exportName(group.web.typeName);
  lines.push(`// ${group.title}`, `export const ${values} = ${JSON.stringify(members)} as const;`,
    `export type ${typeName} = (typeof ${values})[number];`, `export const ${labels} = {`);
  for (const member of group.members) lines.push(`  ${member.value}: ${JSON.stringify(member.label)},`);
  lines.push(`} as const satisfies Record<${typeName}, string>;`);
  if (group.web.domains) {
    const domains = exportName(group.web.domains);
    assert(group.members.every(member => ['INTEGER', 'DECIMAL'].includes(member.domain)), `数值口径缺失：${group.name}`);
    lines.push(`export const ${domains} = {`);
    for (const member of group.members) lines.push(`  ${member.value}: ${JSON.stringify(member.domain)},`);
    lines.push(`} as const satisfies Record<${typeName}, SkillTriggerValueDomain>;`);
  }
  for (const subset of group.subsets ?? []) {
    assert(Array.isArray(subset.members) && subset.members.length && new Set(subset.members).size === subset.members.length
      && subset.members.every(member => members.includes(member)), `非法语义子集：${group.name}`);
    const subsetValues = exportName(subset.values), subsetType = exportName(subset.typeName);
    lines.push(`export const ${subsetValues} = ${JSON.stringify(subset.members)} as const satisfies readonly ${typeName}[];`,
      `export type ${subsetType} = (typeof ${subsetValues})[number];`);
  }
  lines.push('');
}
const output = args.target === 'web' ? 'web/src/types/skillSystemEnums.generated.ts' : 'contracts/system-enums/README.md';
const destination = containedPath(targetRoot, output);
let expected = lines.join('\n');
if (args.target === 'docs') {
  const before = (await readFile(destination, 'utf8')).replaceAll('\r\n', '\n');
  const start = '<!-- system-enums:members:start -->', end = '<!-- system-enums:members:end -->';
  assert(before.indexOf(start) >= 0 && before.indexOf(end) > before.indexOf(start), '清单表标记缺失或顺序错误');
  const rows = contract.groups.map(group => `| ${group.title} | ${group.web.typeName} | ${group.members.map(member =>
    `\`${member.value}\`（${member.label}）`).join('、')} |`);
  const table = [start, '| 用途 | 类型 | 固定值与显示 |', '| --- | --- | --- |', ...rows, end].join('\n');
  expected = before.slice(0, before.indexOf(start)) + table + before.slice(before.indexOf(end) + end.length);
}
const problems = [];
if (args.check) {
  let actual;
  try { actual = await readFile(destination, 'utf8'); } catch { actual = ''; }
  if (actual.replaceAll('\r\n', '\n') !== expected) problems.push('生成文件与系统枚举清单不一致');
} else {
  assert(!args['backend-root'] && !args['wasm-root'], '跨端参数仅用于只读检查，不能在生成时隐式写其他模块');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, expected, 'utf8');
}
let backendChecked = 0, nativeChecked = 0;
if (args['backend-root']) {
  assert(args.check && isAbsolute(args['backend-root']), '后端检查必须提供绝对工作树路径并使用--check');
  const root = resolve(args['backend-root']);
  await readFile(resolve(root, 'server/data_manage/pom.xml'));
  for (const group of contract.groups) {
    if (!group.backend) continue;
    const path = containedPath(root, `server/data_manage/src/main/java/xyz/game/datamanage/model/${group.backend}`);
    const source = await readFile(path, 'utf8');
    const match = new RegExp(`public enum ${group.name}\\s*\\{([^;}]+)`).exec(source);
    assert(match, `未找到后端枚举定义：${group.name}`);
    const actual = match[1].trim().split(',').map(value => value.trim()).sort();
    const declared = group.members.map(member => member.value).sort();
    if (JSON.stringify(actual) !== JSON.stringify(declared)) problems.push(`后端成员漂移：${group.name}`);
    backendChecked++;
  }
}
if (args['wasm-root']) {
  assert(args.check && isAbsolute(args['wasm-root']), '原生检查必须提供绝对工作树路径并使用--check');
  const root = resolve(args['wasm-root']);
  await readFile(resolve(root, 'wasm/tinygo_engine_v2/go.mod'));
  for (const group of contract.groups) for (const member of group.members) if (member.native) {
    const binding = member.native;
    assert(validIdentifier(binding.constant) && /^internal\/(model|runtime)\/[a-z0-9_]+\.go$/.test(binding.file)
      && (/^event\/[a-z0-9_]+$/.test(binding.value)
        || (!group.backend && binding.value === member.value && /^[A-Z][A-Z0-9_]*$/.test(binding.value))), '非法原生常量绑定');
    const path = containedPath(root, `wasm/tinygo_engine_v2/${binding.file}`);
    const source = await readFile(path, 'utf8');
    const match = new RegExp(`\\b${binding.constant}\\s*=\\s*"([^"]+)"`).exec(source);
    if (match?.[1] !== binding.value) problems.push(`原生常量漂移：${binding.constant}`);
    nativeChecked++;
  }
}
console.log(JSON.stringify({ mode: args.check ? 'check' : 'generate', groups: contract.groups.length,
  members: contract.groups.reduce((sum, group) => sum + group.members.length, 0), backendChecked, nativeChecked,
  output, problems }, null, 2));
if (problems.length) process.exitCode = 1;
