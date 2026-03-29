/**
 * 公式 AST 编译器
 *
 * 将 skill.params.vars（5 种 kind）编译为 BenchmarkFormulaExpr AST，
 * 供 Wasm 引擎消费。
 *
 * 支持的 var kind：
 *   const          → Constant(value)
 *   table          → Constant(values[level])
 *   scaled_attr    → Multiply(ActorAttr(attr), Constant(coefficient))
 *   formula        → 递归解析 formulaText（加法/乘法/变量引用）
 *   mapping_scaled_attr → Multiply(ActorAttr/ActorHpCurrent/…, Constant(mappedCoeff))
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
  ctx: FormulaCompileContext
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
      throw new Error(`Unknown formula variable: ${name}`);
    }
    resolving.add(name);
    const expr = compileVar(name, def, ctx, resolve);
    resolving.delete(name);
    resolved.set(name, expr);
    return expr;
  }

  for (const name of Object.keys(vars)) {
    resolve(name);
  }
  return resolved;
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
    target: 'target',
    enemy: 'target',
  };
  const actor: FormulaActorRef = actorMap[prefix] ?? 'source';

  // 特殊属性
  if (suffix === 'hp_current') {
    return { type: 'actor_hp_current', actor };
  }
  if (suffix === 'hp_max') {
    return { type: 'actor_hp_max', actor };
  }
  return { type: 'actor_attr', actor, attrKey: suffix };
}

// ─── 单变量编译 ──────────────────────────────────────────────

function compileVar(
  name: string,
  def: VarDefinition,
  ctx: FormulaCompileContext,
  resolve: (name: string) => BenchmarkFormulaExpr
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
      const varExprs = new Map<string, BenchmarkFormulaExpr>();
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

// ─── 简单表达式解析器 ─────────────────────────────────────────

/**
 * 解析简单的 formulaText：
 * - 支持 `+` 和 `*` 运算符
 * - 支持变量引用（从 varExprs 查表）
 * - 支持数字字面量
 * - 支持 `self.attr` 形式的属性引用
 * - 优先级：`*` > `+`，不支持括号（MVP 足够）
 *
 * 例：
 *   "base_damage + ap_damage"
 *   "ap_ratio_coefficient * self.ability_power"
 *   "100 + self.ad + self.ap * 0.2"
 */
function parseSimpleExpr(
  text: string,
  varExprs: Map<string, BenchmarkFormulaExpr>
): BenchmarkFormulaExpr {
  // 按 + 拆分为加法项（trimmed）
  const addTerms = splitByOperator(text, '+');
  if (addTerms.length === 0) {
    return { type: 'constant', value: 0 };
  }
  const parsedAddTerms = addTerms.map((term) => parseMulTerm(term, varExprs));
  if (parsedAddTerms.length === 1) return parsedAddTerms[0];
  return { type: 'add', terms: parsedAddTerms };
}

function parseMulTerm(
  text: string,
  varExprs: Map<string, BenchmarkFormulaExpr>
): BenchmarkFormulaExpr {
  const mulFactors = splitByOperator(text, '*');
  if (mulFactors.length === 0) {
    return { type: 'constant', value: 0 };
  }
  const parsedFactors = mulFactors.map((factor) => parseAtom(factor, varExprs));
  if (parsedFactors.length === 1) return parsedFactors[0];
  return { type: 'multiply', factors: parsedFactors };
}

function parseAtom(
  text: string,
  varExprs: Map<string, BenchmarkFormulaExpr>
): BenchmarkFormulaExpr {
  const trimmed = text.trim();

  // 数字字面量
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== '') {
    return { type: 'constant', value: num };
  }

  // 已编译的变量引用
  const varExpr = varExprs.get(trimmed);
  if (varExpr) return varExpr;

  // self.xxx / target.xxx 属性引用
  if (trimmed.includes('.')) {
    return resolveAttrRef(trimmed);
  }

  // 未识别——当作 0 并警告
  console.warn(`Formula atom not resolved: "${trimmed}", treating as 0`);
  return { type: 'constant', value: 0 };
}

/**
 * 按运算符拆分字符串，注意不要拆小数点。
 * 例如 "a + b * c + d" 按 '+' 拆分 → ["a", "b * c", "d"]
 */
function splitByOperator(text: string, op: string): string[] {
  // 简单按字符拆分；对于 + 要注意避免拆科学计数法中的 +
  const parts: string[] = [];
  let current = '';
  const chars = text.split('');
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === op) {
      // 对于 *: 直接拆
      // 对于 +: 确保不是数字后面的 + (e.g. 1e+5) — MVP 暂不处理科学计数法
      parts.push(current);
      current = '';
    } else {
      current += chars[i];
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
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
