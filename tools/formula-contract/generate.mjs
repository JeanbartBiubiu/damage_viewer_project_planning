import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const canonicalRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const target = args[args.indexOf('--target') + 1];
const rootArgument = args[args.indexOf('--root') + 1];
if (!args.includes('--target') || !args.includes('--root') || !['web', 'backend', 'wasm'].includes(target) || !rootArgument || !isAbsolute(rootArgument)) {
  throw new Error('用法：node tools/formula-contract/generate.mjs --target web|backend|wasm --root <绝对工作树路径> [--check]');
}
const targetRoot = resolve(rootArgument);
const markers = { web: 'web/package.json', backend: 'server/data_manage/pom.xml', wasm: 'wasm/tinygo_engine_v2/go.mod' };
await readFile(resolve(targetRoot, markers[target]));
const schemaText = (await readFile(resolve(canonicalRoot, 'contracts/formula/formula.schema.json'), 'utf8')).replaceAll('\r\n', '\n');
const casesText = (await readFile(resolve(canonicalRoot, 'contracts/formula/cases.json'), 'utf8')).replaceAll('\r\n', '\n');
const schema = JSON.parse(schemaText);
const cases = JSON.parse(casesText);
const hash = value => createHash('sha256').update(value).digest('hex');
const schemaHash = hash(schemaText);
const casesHash = hash(casesText);
const banner = '由 tools/formula-contract/generate.mjs 生成，禁止手改。';
const schemaJSON = JSON.stringify(schema);
const casesJSON = JSON.stringify({ schemaSha256: schemaHash, casesSha256: casesHash, ...cases });
const typeName = name => name[0].toUpperCase() + name.slice(1);
function toType(node) {
  if (node.$ref) return typeName(node.$ref.split('/').at(-1));
  if ('const' in node) return JSON.stringify(node.const);
  if (node.enum) return node.enum.map(value => JSON.stringify(value)).join(' | ');
  if (node.oneOf) return node.oneOf.map(value => '(' + toType(value) + ')').join(' | ');
  if (node.type === 'object') return '{ ' + Object.entries(node.properties).map(([key, value]) => JSON.stringify(key) + (node.required.includes(key) ? '' : '?') + ': ' + toType(value) + ';').join(' ') + ' }';
  if (node.type === 'array') {
    if (node.minItems === node.maxItems && node.minItems !== undefined) return '[' + Array(node.minItems).fill(toType(node.items)).join(', ') + ']';
    return '(' + toType(node.items) + ')[]';
  }
  if (node.type === 'string') return 'string';
  if (node.type === 'integer' || node.type === 'number') return 'number';
  throw new Error('规范出现未支持的类型：' + JSON.stringify(node));
}
const outputs = [];
if (target === 'web') {
  const types = Object.entries(schema.$defs).map(([key, value]) => 'export type ' + typeName(key) + ' = ' + toType(value) + ';').join('\n');
  outputs.push(['web/src/types/formulaContract.generated.ts', '// ' + banner + '\nexport const FORMULA_SCHEMA_SHA256 = ' + JSON.stringify(schemaHash) + ';\nexport const FORMULA_SCHEMA = ' + schemaJSON + ' as const;\n' + types + '\nexport type FormulaDefinition = ' + toType(schema) + ';\nexport type FormulaContractErrorCode = ' + schema['x-errors'].map(x => JSON.stringify(x)).join(' | ') + ';\n']);
  outputs.push(['web/src/services/__fixtures__/formulaContractCases.generated.json', casesJSON + '\n']);
} else if (target === 'backend') {
  outputs.push(['server/data_manage/src/main/java/xyz/game/datamanage/support/formula/FormulaContractSchema.java', 'package xyz.game.datamanage.support.formula;\n\n// ' + banner + '\nfinal class FormulaContractSchema {\n    static final String SHA256 = ' + JSON.stringify(schemaHash) + ';\n    static final String JSON = ' + JSON.stringify(schemaJSON) + ';\n    private FormulaContractSchema() {}\n}\n']);
  outputs.push(['server/data_manage/src/test/resources/formula-contract/cases.generated.json', casesJSON + '\n']);
} else {
  const limits = Object.entries(schema['x-limits']).map(([key, value]) => 'const Definition' + key[0].toUpperCase() + key.slice(1) + ' = ' + value).join('\n');
  outputs.push(['wasm/tinygo_engine_v2/internal/expression/contract_schema_generated.go', 'package expression\n\n// ' + banner + '\nconst contractSchemaSHA256 = ' + JSON.stringify(schemaHash) + '\n' + limits + '\nconst contractSchemaJSON = `' + schemaJSON + '`\n']);
  outputs.push(['wasm/tinygo_engine_v2/internal/expression/contract_cases_generated_test.go', 'package expression\n\n// ' + banner + '\nconst contractCasesJSON = `' + casesJSON + '`\n']);
}
const mismatches = [];
for (const [path, content] of outputs) {
  const destination = resolve(targetRoot, path);
  if (relative(targetRoot, destination).startsWith('..') || isAbsolute(relative(targetRoot, destination))) throw new Error('生成目标越出工作树');
  if (check) {
    let actual;
    try { actual = await readFile(destination, 'utf8'); } catch { actual = undefined; }
    if (actual?.replaceAll('\r\n', '\n') !== content) mismatches.push(path);
  } else {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, 'utf8');
  }
}
if (mismatches.length) throw new Error('生成文件漂移：\n' + mismatches.join('\n'));
process.stdout.write(JSON.stringify({ target, mode: check ? 'check' : 'generate', schemaSha256: schemaHash, casesSha256: casesHash, cases: cases.cases.length, files: outputs.map(x => x[0]) }, null, 2) + '\n');
