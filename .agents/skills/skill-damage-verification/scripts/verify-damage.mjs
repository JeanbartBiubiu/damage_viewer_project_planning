import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const functions = new Map([
  ['min', { run: Math.min, min: 1, max: 64 }],
  ['max', { run: Math.max, min: 1, max: 64 }],
  ...['abs', 'floor', 'ceil', 'round'].map(name => [name, { run: Math[name], min: 1, max: 1 }]),
  ['pow', { run: Math.pow, min: 2, max: 2 }],
]);
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function finite(value) {
  requireCondition(typeof value === 'number' && Number.isFinite(value), '需要有限数值，不能使用空值或无穷大。');
  return value;
}

function nonempty(value, label) {
  requireCondition(typeof value === 'string' && value.trim().length > 0, `${label}不能为空。`);
}

function namedValue(values, name, value) {
  requireCondition(typeof name === 'string' && identifier.test(name) && !functions.has(name), `变量名无效或占用函数名：${name}`);
  requireCondition(!values.has(name), `变量重复：${name}`);
  values.set(name, finite(value));
}

// 只解释算术；不执行 JavaScript，不导入生产公式或结算代码。
export function evaluateArithmetic(expression, values = new Map()) {
  nonempty(expression, '算式');
  requireCondition(expression.length <= 8192, '算式过长。');
  const tokens = [];
  const matcher = /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|[+\-*/%(),]))/y;
  const source = expression.trim();
  let position = 0;
  while (position < source.length) {
    matcher.lastIndex = position;
    const match = matcher.exec(source);
    requireCondition(match, `不支持的算式内容，位置 ${position}。`);
    tokens.push(match[1] ? { number: finite(Number(match[1])) } : match[2] ?? match[3]);
    position = matcher.lastIndex;
    requireCondition(tokens.length <= 512, '算式项过多。');
  }
  let index = 0;
  const take = symbol => tokens[index] === symbol ? (++index, true) : false;
  function primary() {
    if (take('(')) {
      const result = add();
      requireCondition(take(')'), '缺少右括号。');
      return result;
    }
    const token = tokens[index++];
    if (token && typeof token === 'object') return token.number;
    requireCondition(typeof token === 'string' && identifier.test(token), '缺少数值或变量。');
    if (!take('(')) {
      requireCondition(values.has(token), `未知变量：${token}`);
      return finite(values.get(token));
    }
    const fn = functions.get(token);
    requireCondition(fn, `不支持的函数：${token}`);
    const args = [];
    if (!take(')')) {
      do { args.push(add()); } while (take(','));
      requireCondition(take(')'), '函数缺少右括号。');
    }
    requireCondition(args.length >= fn.min && args.length <= fn.max, `函数参数数量无效：${token}`);
    return finite(fn.run(...args));
  }
  function power() {
    const left = primary();
    return take('**') ? finite(left ** unary()) : left;
  }
  function unary() {
    if (take('+')) return unary();
    if (take('-')) return finite(-unary());
    return power();
  }
  function multiply() {
    let left = unary();
    while (['*', '/', '%'].includes(tokens[index])) {
      const operator = tokens[index++];
      const right = unary();
      requireCondition(operator === '*' || right !== 0, '不能除以零或对零取余。');
      left = finite(operator === '*' ? left * right : operator === '/' ? left / right : left % right);
    }
    return left;
  }
  function add() {
    let left = multiply();
    while (['+', '-'].includes(tokens[index])) {
      const operator = tokens[index++];
      const right = multiply();
      left = finite(operator === '+' ? left + right : left - right);
    }
    return left;
  }
  const result = add();
  requireCondition(index === tokens.length, '算式包含多余内容。');
  return finite(result);
}

function scalar(value) {
  requireCondition(['number', 'string', 'boolean'].includes(typeof value), '对照值只接受数值、字符串或布尔值。');
  return typeof value === 'number' ? finite(value) : value;
}

export function calculatePlan(plan) {
  nonempty(plan?.basis, '规则来源与取舍说明');
  requireCondition(Array.isArray(plan.cases) && plan.cases.length > 0, '场景不能为空。');
  const ids = new Set();
  const cases = plan.cases.map(item => {
    nonempty(item.id, '场景标识');
    requireCondition(!ids.has(item.id), `重复场景：${item.id}`);
    ids.add(item.id);
    const values = new Map();
    requireCondition(item.inputs === undefined || (item.inputs !== null && typeof item.inputs === 'object' && !Array.isArray(item.inputs)), '输入变量必须是对象。');
    for (const [name, value] of Object.entries(item.inputs ?? {})) namedValue(values, name, value);
    requireCondition(item.steps === undefined || Array.isArray(item.steps), '分步算式必须是数组。');
    for (const step of item.steps ?? []) namedValue(values, step.name, evaluateArithmetic(step.expression, values));
    requireCondition(Array.isArray(item.checks) && item.checks.length > 0, `场景没有对照项：${item.id}`);
    const checks = item.checks.map(check => {
      requireCondition(typeof check.pointer === 'string' && (check.pointer === '' || check.pointer.startsWith('/')), '字段路径需要使用 JSON Pointer。');
      requireCondition(!/~(?:[^01]|$)/.test(check.pointer), '字段路径中的波浪号需要使用 ~0 或 ~1 转义。');
      const comparison = check.comparison ?? 'exact';
      const measure = check.measure ?? 'value';
      requireCondition(['exact', 'amount'].includes(comparison), '比较方式只接受 exact 或 amount。');
      requireCondition(['value', 'length'].includes(measure), '取值方式只接受 value 或 length。');
      requireCondition(measure !== 'length' || comparison === 'exact', '数组长度必须精确比较。');
      requireCondition(own(check, 'expression') !== own(check, 'value'), '每项须且只能提供算式或固定值。');
      const expected = own(check, 'expression') ? evaluateArithmetic(check.expression, values) : scalar(check.value);
      if (comparison === 'amount') finite(expected);
      return { pointer: check.pointer, measure, comparison, expected };
    });
    return { id: item.id, values: Object.fromEntries(values), checks };
  });
  return { version: 1, plan, cases };
}

function readPointer(result, pointer) {
  let value = result;
  for (const part of pointer === '' ? [] : pointer.slice(1).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    requireCondition(value !== null && typeof value === 'object' && own(value, key), `实际结果缺少字段：${pointer}`);
    value = value[key];
  }
  return value;
}

export function compareResults(expected, actualCases) {
  requireCondition(expected?.version === 1, '期望文件版本无效。');
  const recalculated = calculatePlan(expected.plan);
  requireCondition(isDeepStrictEqual(expected.cases, recalculated.cases), '期望与原计划重算不一致，不能手改计算结果。');
  requireCondition(Array.isArray(actualCases) && actualCases.length === expected.cases.length, '实际场景数量与期望不一致。');
  const actualById = new Map();
  for (const item of actualCases) {
    requireCondition(typeof item.id === 'string' && !actualById.has(item.id) && own(item, 'result'), '实际场景标识重复或缺少结果。');
    actualById.set(item.id, item.result);
  }
  const cases = expected.cases.map(item => {
    requireCondition(actualById.has(item.id), `缺少实际场景：${item.id}`);
    const checks = item.checks.map(check => {
      const value = readPointer(actualById.get(item.id), check.pointer);
      if (check.measure === 'length') requireCondition(Array.isArray(value), `需要数组：${check.pointer}`);
      const actual = scalar(check.measure === 'length' ? value.length : value);
      const tolerance = check.comparison === 'amount' ? 1e-9 * Math.max(1, Math.abs(check.expected)) : 0;
      const pass = check.comparison === 'amount'
        ? typeof actual === 'number' && Math.abs(actual - check.expected) <= tolerance
        : actual === check.expected;
      return { ...check, actual, tolerance, pass };
    });
    return { id: item.id, pass: checks.every(check => check.pass), checks };
  });
  return { version: 1, pass: cases.every(item => item.pass), cases };
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function loadJson(path) {
  const bytes = readFileSync(path);
  return { path, sha256: digest(bytes), data: JSON.parse(bytes.toString('utf8')) };
}
function writeNew(path, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  try { writeFileSync(path, bytes, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST' || readFileSync(path, 'utf8') !== bytes) throw error;
  }
}

function main(args) {
  if (args.length === 0 || args[0] === '--help') {
    console.log('离线独立算术与结果对照（不调用 Wasm，不读取凭据）\n'
      + '  node verify-damage.mjs calculate --plan <计划.json> --output <新期望.json>\n'
      + '  node verify-damage.mjs compare --expected <期望.json> --actual <结果清单.json> --output <新报告.json>\n'
      + 'calculate 必须先于被测运行；输出文件不覆盖已有不同内容。');
    return;
  }
  const [mode, ...rest] = args;
  requireCondition(['calculate', 'compare'].includes(mode), '操作只接受 calculate 或 compare。');
  const allowed = mode === 'calculate' ? ['--plan', '--output'] : ['--expected', '--actual', '--output'];
  const options = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    requireCondition(allowed.includes(rest[index]) && !options.has(rest[index]) && rest[index + 1] && !rest[index + 1].startsWith('--'), '参数未知、重复或缺少值。');
    options.set(rest[index], resolve(rest[index + 1]));
  }
  requireCondition(allowed.every(key => options.has(key)), `需要参数：${allowed.join('、')}`);
  const calculatorSha256 = digest(readFileSync(fileURLToPath(import.meta.url)));
  if (mode === 'calculate') {
    const input = loadJson(options.get('--plan'));
    const output = { ...calculatePlan(input.data), planSha256: input.sha256, calculatorSha256 };
    writeNew(options.get('--output'), output);
    console.log(`已计算 ${output.cases.length} 个场景并保存独立期望。`);
    return;
  }
  const expected = loadJson(options.get('--expected'));
  requireCondition(expected.data.calculatorSha256 === calculatorSha256, '计算工具已变化，请复查计划并重新生成期望。');
  const manifest = loadJson(options.get('--actual'));
  requireCondition(Array.isArray(manifest.data.cases), '实际结果清单缺少场景数组。');
  const actualFiles = [];
  const actualCases = manifest.data.cases.map(item => {
    nonempty(item.file, '原始结果文件');
    const raw = loadJson(resolve(dirname(manifest.path), item.file));
    actualFiles.push({ id: item.id, path: raw.path, sha256: raw.sha256 });
    return { id: item.id, result: raw.data };
  });
  const output = { ...compareResults(expected.data, actualCases), calculatorSha256, expectedSha256: expected.sha256, manifestSha256: manifest.sha256, actualFiles };
  writeNew(options.get('--output'), output);
  console.log(`数值字段对照${output.pass ? '通过' : '不通过'}：${output.cases.length} 个场景；真实运行身份和覆盖范围仍须核对。`);
  if (!output.pass) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
