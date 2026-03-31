/**
 * 公式 AST 编译器
 *
 * 将 skill.params.vars（5 种 kind）或 FormulaProfile.params 中的 formulaText
 * 编译为 BenchmarkFormulaExpr AST，供 Wasm 引擎消费。
 *
 * 支持的 var kind：
 *   const              → Constant(value)
 *   table              → Constant(values[level])
 *   scaled_attr        → Multiply(ActorAttr(attr), Constant(coefficient))
 *   formula            → 递归解析 formulaText
 *   mapping_scaled_attr → Multiply(ActorAttr/…, Constant(mappedCoeff))
 *
 * formulaText 表达力（递归下降解析器）：
 *   运算符：+  -  *  /   （标准四则运算优先级）
 *   括号：( )
 *   函数：max(a, b, ...)  min(a, b, ...)
 *   关键字：x / input_value → InputValue 管线输入
 *   属性引用：self.ad  target.armor  a.xxx  b.xxx
 *   变量引用：从 varExprs Map 查表
 *   数字字面量：42  3.14  -1.5
 */

import type {
  BenchmarkFormulaExpr,
  BenchmarkFormulaDefinition,
  FormulaActorRef,
} from './benchmarkTypes';

// ─── 公开接口 ────────────────────────────────────────────────

export type VarDefinition = {
  label?: string;
  kind: string;
  value?: number;
  values?: number[];
  by?: 'skillLevel' | 'championLevel';
  attr?: string;
  coefficient?: number;
  formulaText?: string;
  formulaVars?: string[];
  selector?: string;
};

export type FormulaCompileContext = {
  /** 技能等级 (1-based，范围 1–5) */
  skillLevel: number;
  /** 英雄等级 (1-based，范围 1–18) */
  championLevel: number;
  /** mapping_scaled_attr 需要的选择器值映射，如 { "self.profession": "近战" } */
  selectorValues?: Record<string, string>;
};

/**
 * 将一组 params.vars 编译为完整的 BenchmarkFormulaExpr。
 * 返回一个 Map，key 是 var 名称，value 是编译后的 AST 节点。
 */
export function compileVarsToExprMap(
  vars: Record<string, VarDefinition>,
  ctx: FormulaCompileContext,
  externalSymbols?: Map<string, BenchmarkFormulaExpr>
): Map<string, BenchmarkFormulaExpr> {
  const resolved = new Map<string, BenchmarkFormulaExpr>();
  const resolving = new Set<string>();

  function resolve(name: string): BenchmarkFormulaExpr {
    const cached = resolved.get(name);
    if (cached) return cached;
    if (resolving.has(name)) {
      throw new Error(`Circular formula reference detected: ${name}`);
    }
    const def = vars[name];
    if (!def) {
      const external = externalSymbols?.get(name);
      if (external) {
        return external;
      }
      throw new Error(`Unknown formula variable: ${name}`);
    }
    resolving.add(name);
    const expr = compileVar(name, def, ctx, resolve, externalSymbols);
    resolving.delete(name);
    resolved.set(name, expr);
    return expr;
  }

  for (const name of Object.keys(vars)) {
    resolve(name);
  }
  return resolved;
}

export function compileConstantSymbols(constants: Record<string, unknown> | undefined): Map<string, BenchmarkFormulaExpr> {
  const symbols = new Map<string, BenchmarkFormulaExpr>();
  if (!constants) {
    return symbols;
  }

  for (const [name, rawValue] of Object.entries(constants)) {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    symbols.set(name, { type: 'constant', value: numeric });
  }

  return symbols;
}

/**
 * 从 skill 的 mechanicsConfig 中提取主伤害 trigger 的 formulaText，
 * 结合 params.vars 编译为单个 BenchmarkFormulaExpr。
 *
 * @param formulaText  如 "base_damage + ap_damage"
 * @param formulaVars  引用的变量名列表
 * @param allVarExprs  先前用 compileVarsToExprMap 编译出的变量 AST
 */
export function compileFormulaText(
  formulaText: string,
  _formulaVars: string[] | undefined,
  allVarExprs: Map<string, BenchmarkFormulaExpr>
): BenchmarkFormulaExpr {
  return parseSimpleExpr(formulaText.trim(), allVarExprs);
}

/**
 * 构建完整的 BenchmarkFormulaDefinition。
 */
export function buildFormulaDefinition(
  formulaId: string,
  label: string,
  expr: BenchmarkFormulaExpr,
  bypassValue?: number
): BenchmarkFormulaDefinition {
  return { formulaId, label, expr, ...(bypassValue != null ? { bypassValue } : {}) };
}

// ─── 属性引用解析 ──────────────────────────────────────────────

/**
 * 将 "self.ability_power"、"target.hp_current" 等属性引用解析为 FormulaExpr。
 * 同时支持 a.xxx / b.xxx 速记（a=source, b=target），兼容公式.csv 格式。
 */
function resolveAttrRef(attrStr: string): BenchmarkFormulaExpr {
  const dot = attrStr.indexOf('.');
  if (dot === -1) {
    // 纯属性名，默认 source
    return { type: 'actor_attr', actor: 'source', attrKey: attrStr };
  }
  const prefix = attrStr.substring(0, dot);
  const suffix = attrStr.substring(dot + 1);

  const actorMap: Record<string, FormulaActorRef> = {
    self: 'source',
    owner: 'source',
    a: 'source',
    target: 'target',
    enemy: 'target',
    b: 'target',
  };
  const actor: FormulaActorRef = actorMap[prefix] ?? 'source';

  // 特殊属性
  if (suffix === 'hp_current' || suffix === 'hp') {
    return { type: 'actor_hp_current', actor };
  }
  if (suffix === 'hp_max' || suffix === 'max_hp') {
    return { type: 'actor_hp_max', actor };
  }
  return { type: 'actor_attr', actor, attrKey: suffix };
}

// ─── 单变量编译 ──────────────────────────────────────────────

function compileVar(
  name: string,
  def: VarDefinition,
  ctx: FormulaCompileContext,
  resolve: (name: string) => BenchmarkFormulaExpr,
  externalSymbols?: Map<string, BenchmarkFormulaExpr>
): BenchmarkFormulaExpr {
  switch (def.kind) {
    case 'const':
      return { type: 'constant', value: toNum(def.value) };

    case 'table': {
      const values = def.values ?? [];
      const level =
        def.by === 'championLevel'
          ? clamp(ctx.championLevel, 1, values.length)
          : clamp(ctx.skillLevel, 1, values.length);
      return { type: 'constant', value: toNum(values[level - 1]) };
    }

    case 'scaled_attr': {
      const attrExpr = resolveAttrRef(def.attr ?? '');
      const coeff = toNum(def.coefficient, 1);
      if (coeff === 1) return attrExpr;
      return { type: 'multiply', factors: [attrExpr, { type: 'constant', value: coeff }] };
    }

    case 'mapping_scaled_attr': {
      // 根据 selector 从 values 映射中取系数
      const selectorKey = def.selector ?? '';
      const mappingValues = (def as any).values as Record<string, number> | undefined;
      let coeff = toNum(def.coefficient, 1);
      if (mappingValues && ctx.selectorValues) {
        const selectorVal = ctx.selectorValues[selectorKey];
        if (selectorVal && selectorVal in mappingValues) {
          coeff = mappingValues[selectorVal];
        } else {
          // fallback：取第一个值
          const firstVal = Object.values(mappingValues)[0];
          if (firstVal != null) coeff = firstVal;
        }
      }
      const attrExpr = resolveAttrRef(def.attr ?? '');
      if (coeff === 1) return attrExpr;
      return { type: 'multiply', factors: [attrExpr, { type: 'constant', value: coeff }] };
    }

    case 'formula': {
      const text = def.formulaText ?? name;
      const varExprs = new Map<string, BenchmarkFormulaExpr>(externalSymbols);
      for (const refName of def.formulaVars ?? []) {
        varExprs.set(refName, resolve(refName));
      }
      return parseSimpleExpr(text, varExprs);
    }

    default:
      // 未知 kind，尝试当已知变量解析
      console.warn(`Unknown var kind "${def.kind}" for "${name}", treating as constant 0`);
      return { type: 'constant', value: 0 };
  }
}

// ─── 递归下降表达式解析器 ─────────────────────────────────────

/**
 * 完整的 formulaText 解析器（递归下降）。
 *
 * 语法（优先级从低到高）：
 *   expr     → addExpr
 *   addExpr  → mulExpr ( ('+' | '-') mulExpr )*
 *   mulExpr  → unary   ( ('*' | '/') unary )*
 *   unary    → '-' unary | atom
 *   atom     → NUMBER | IDENT(.IDENT)* | '(' expr ')' | FUNC '(' argList ')'
 *   argList  → expr (',' expr)*
 *
 * 特殊关键字:
 *   'x' / 'input_value' → { type: 'input_value' }
 *
 * 函数:
 *   max(a, b, ...) → { type: 'max', operands: [...] }
 *   min(a, b, ...) → { type: 'min', operands: [...] }
 *
 * 属性引用（与 resolveAttrRef 统一逻辑）:
 *   self.ad / a.ad      → ActorAttr(source, ad)
 *   target.armor / b.armor → ActorAttr(target, armor)
 *
 * 变量引用: 从 varExprs Map 查表。
 */

/** Tokenizer 产出的 token */
type Token =
  | { kind: 'number'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string }   // + - * /
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' }
  | { kind: 'eof' };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    // 跳过空白
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // 运算符
    if (ch === '+' || ch === '*' || ch === '/') {
      tokens.push({ kind: 'op', value: ch });
      i++;
      continue;
    }

    // 减号：区分负号和减法运算符
    if (ch === '-') {
      tokens.push({ kind: 'op', value: '-' });
      i++;
      continue;
    }

    // 括号 / 逗号
    if (ch === '(') { tokens.push({ kind: 'lparen' }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen' }); i++; continue; }
    if (ch === ',') { tokens.push({ kind: 'comma' }); i++; continue; }

    // 数字字面量（含小数点）
    if (isDigit(ch) || (ch === '.' && i + 1 < len && isDigit(text[i + 1]))) {
      let num = '';
      while (i < len && (isDigit(text[i]) || text[i] === '.')) {
        num += text[i];
        i++;
      }
      tokens.push({ kind: 'number', value: Number(num) });
      continue;
    }

    // 标识符（含点号，如 self.ad, a.armor_pen_flat）
    if (isIdentStart(ch)) {
      let ident = '';
      while (i < len && isIdentPart(text[i])) {
        ident += text[i];
        i++;
      }
      tokens.push({ kind: 'ident', value: ident });
      continue;
    }

    // 未识别字符——跳过
    console.warn(`Formula tokenizer: unexpected char '${ch}' at pos ${i}, skipping`);
    i++;
  }

  tokens.push({ kind: 'eof' });
  return tokens;
}

function isDigit(ch: string): boolean { return ch >= '0' && ch <= '9'; }
function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}
function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch) || ch === '.';
}

/**
 * 解析器状态。
 */
class Parser {
  private tokens: Token[];
  private pos = 0;
  private varExprs: Map<string, BenchmarkFormulaExpr>;

  constructor(tokens: Token[], varExprs: Map<string, BenchmarkFormulaExpr>) {
    this.tokens = tokens;
    this.varExprs = varExprs;
  }

  parse(): BenchmarkFormulaExpr {
    const result = this.parseAddExpr();
    if (this.peek().kind !== 'eof') {
      console.warn(`Formula parser: unexpected token after expression: ${JSON.stringify(this.peek())}`);
    }
    return result;
  }

  // ── addExpr → mulExpr ( ('+' | '-') mulExpr )* ──
  private parseAddExpr(): BenchmarkFormulaExpr {
    let left = this.parseMulExpr();

    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.advance() as { kind: 'op'; value: string }).value;
      const right = this.parseMulExpr();
      if (op === '+') {
        // 合并连续 add
        if (left.type === 'add') {
          left = { type: 'add', terms: [...left.terms, right] };
        } else {
          left = { type: 'add', terms: [left, right] };
        }
      } else {
        // a - b → subtract(a, b)
        left = { type: 'subtract', left, right };
      }
    }
    return left;
  }

  // ── mulExpr → unary ( ('*' | '/') unary )* ──
  private parseMulExpr(): BenchmarkFormulaExpr {
    let left = this.parseUnary();

    while (this.isOp('*') || this.isOp('/')) {
      const op = (this.advance() as { kind: 'op'; value: string }).value;
      const right = this.parseUnary();
      if (op === '*') {
        if (left.type === 'multiply') {
          left = { type: 'multiply', factors: [...left.factors, right] };
        } else {
          left = { type: 'multiply', factors: [left, right] };
        }
      } else {
        left = { type: 'divide', numerator: left, denominator: right };
      }
    }
    return left;
  }

  // ── unary → '-' unary | atom ──
  private parseUnary(): BenchmarkFormulaExpr {
    if (this.isOp('-')) {
      this.advance();
      const operand = this.parseUnary();
      // 常量优化：-3 → Constant(-3)
      if (operand.type === 'constant') {
        return { type: 'constant', value: -operand.value };
      }
      return { type: 'negate', operand };
    }
    return this.parseAtom();
  }

  // ── atom ──
  private parseAtom(): BenchmarkFormulaExpr {
    const tok = this.peek();

    // 数字
    if (tok.kind === 'number') {
      this.advance();
      return { type: 'constant', value: tok.value };
    }

    // 括号
    if (tok.kind === 'lparen') {
      this.advance(); // consume (
      const inner = this.parseAddExpr();
      this.expect('rparen');
      return inner;
    }

    // 标识符（可能是函数调用、变量引用、属性引用、关键字）
    if (tok.kind === 'ident') {
      const ident = tok.value;
      this.advance();

      // 关键字：x / input_value → 管线输入
      if (ident === 'x' || ident === 'input_value') {
        return { type: 'input_value' };
      }

      // 函数调用：max(...) / min(...)
      if ((ident === 'max' || ident === 'min') && this.peek().kind === 'lparen') {
        this.advance(); // consume (
        const args = this.parseArgList();
        this.expect('rparen');
        if (args.length === 0) {
          console.warn(`Formula: ${ident}() called with no arguments, returning 0`);
          return { type: 'constant', value: 0 };
        }
        return { type: ident, operands: args };
      }

      // 变量引用（从 varExprs Map 查表）
      const varExpr = this.varExprs.get(ident);
      if (varExpr) return varExpr;

      // 属性引用（含 a.xxx / b.xxx / self.xxx / target.xxx）
      if (ident.includes('.')) {
        return resolveAttrRefExtended(ident);
      }

      // 未识别标识符——当 0 并警告
      console.warn(`Formula atom not resolved: "${ident}", treating as 0`);
      return { type: 'constant', value: 0 };
    }

    // 意外 token
    console.warn(`Formula parser: unexpected token ${JSON.stringify(tok)}, treating as 0`);
    this.advance();
    return { type: 'constant', value: 0 };
  }

  private parseArgList(): BenchmarkFormulaExpr[] {
    const args: BenchmarkFormulaExpr[] = [];
    if (this.peek().kind === 'rparen') return args; // 空参数列表
    args.push(this.parseAddExpr());
    while (this.peek().kind === 'comma') {
      this.advance(); // consume ,
      args.push(this.parseAddExpr());
    }
    return args;
  }

  // ── 辅助 ──
  private peek(): Token { return this.tokens[this.pos] ?? { kind: 'eof' }; }
  private advance(): Token { return this.tokens[this.pos++] ?? { kind: 'eof' }; }
  private isOp(op: string): boolean {
    const tok = this.peek();
    return tok.kind === 'op' && tok.value === op;
  }
  private expect(kind: Token['kind']): void {
    const tok = this.peek();
    if (tok.kind !== kind) {
      console.warn(`Formula parser: expected ${kind}, got ${JSON.stringify(tok)}`);
      return;
    }
    this.advance();
  }
}

/**
 * 扩展属性引用（兼容别名，供解析器内部使用）。
 * 复用统一的 resolveAttrRef。
 */
function resolveAttrRefExtended(attrStr: string): BenchmarkFormulaExpr {
  return resolveAttrRef(attrStr);
}

/**
 * 解析 formulaText 为 AST。
 * 兼容旧的简单格式和新的完整表达式语法。
 */
function parseSimpleExpr(
  text: string,
  varExprs: Map<string, BenchmarkFormulaExpr>
): BenchmarkFormulaExpr {
  if (!text || text.trim().length === 0) return { type: 'constant', value: 0 };
  const tokens = tokenize(text);
  const parser = new Parser(tokens, varExprs);
  return parser.parse();
}

// ─── 工具函数 ─────────────────────────────────────────────────

function toNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── 导出工具给其他模块用 ────────────────────────────────────

export { resolveAttrRef };
