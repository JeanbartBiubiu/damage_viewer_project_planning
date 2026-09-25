import type { GenericFormulaExpr } from '../types/genericEngine';

type Fraction = { n: bigint; d: bigint };

/** 静态比例沿十进制输入精确计算，最后一次转成运行数值，避免严格门槛被中间舍入改变。 */
export function staticRatioValue(expr: GenericFormulaExpr, path: string, fail: (path: string, message: string) => never): number {
  const reduce = (n: bigint, d: bigint): Fraction => {
    if (d === 0n) return fail(path, '门槛公式不能除零');
    if (d < 0n) { n = -n; d = -d; }
    let a = n < 0n ? -n : n, b = d;
    while (b) { const next = a % b; a = b; b = next; }
    return { n: n / a, d: d / a };
  };
  const evaluate = (node: GenericFormulaExpr, depth = 0): Fraction => {
    if (depth > 32) return fail(path, '门槛公式超过深度限制');
    if (node.op === 'const') {
      if (typeof node.value !== 'number' || !Number.isFinite(node.value)) return fail(path, '需要有限静态门槛');
      const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(node.value))!;
      const fraction = match[3] ?? '', power = Number(match[4] ?? 0) - fraction.length;
      const n = BigInt(`${match[1]}${match[2]}${fraction}`);
      return power >= 0 ? reduce(n * 10n ** BigInt(power), 1n) : reduce(n, 10n ** BigInt(-power));
    }
    if (node.args?.length !== 2) return fail(path, '门槛必须可静态求值');
    const a = evaluate(node.args[0]!, depth + 1), b = evaluate(node.args[1]!, depth + 1);
    switch (node.op) {
      case 'add': return reduce(a.n * b.d + b.n * a.d, a.d * b.d);
      case 'sub': return reduce(a.n * b.d - b.n * a.d, a.d * b.d);
      case 'mul': return reduce(a.n * b.n, a.d * b.d);
      case 'div': return reduce(a.n * b.d, a.d * b.n);
      case 'min': return a.n * b.d <= b.n * a.d ? a : b;
      case 'max': return a.n * b.d >= b.n * a.d ? a : b;
      default: return fail(path, '门槛必须可静态求值');
    }
  };
  const ratio = evaluate(expr);
  if (ratio.n < 0n || ratio.n > ratio.d) return fail(path, '生命比例门槛必须在0至1');
  if (ratio.n === ratio.d) return 1;
  // 350位小数覆盖双精度最小非零值；不先把巨大分子/分母分别转换成 Infinity。
  const digits = (ratio.n * 10n ** 350n / ratio.d).toString().padStart(350, '0');
  const value = Number(`0.${digits}`);
  if (value === 0 && ratio.n !== 0n) return fail(path, '门槛小于运行数值可表达的精度，不能补零');
  if (value === 1) return fail(path, '门槛与1的差值小于运行数值可表达的精度，不能当作1');
  return value;
}
