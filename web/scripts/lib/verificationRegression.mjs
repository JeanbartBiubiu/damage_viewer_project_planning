/** 正式对象的内容摘要与机制依赖一起维护，防止配置改变后沿用旧依赖声明。 */
export function coverageGaps(proof, coverage, game, covered) {
  if (coverage.schemaVersion !== 'mechanism-coverage-v1') throw new Error('admitted-coverage.json 版本不正确');
  const entries = proof.entries?.filter(row => row.outcome === 'PASSED');
  if (!entries?.length) throw new Error('正式证明没有 PASSED 对象，不能生成空回归证明');
  const declared = coverage.games?.[game] ?? {};
  const gaps = [];
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.key}`;
    if (seen.has(key)) gaps.push(`${key}: 正式证明对象重复`);
    seen.add(key);
    const dependency = declared[key];
    if (!dependency) { gaps.push(`${key}: 未声明依赖机制`); continue; }
    if (dependency.contentDigest !== entry.contentDigest || dependency.externalDigest !== entry.externalDigest) {
      gaps.push(`${key}: 配置摘要已变，需重新核对机制依赖及首次准入`);
    }
    const tags = dependency.mechanisms;
    if (!Array.isArray(tags) || !tags.length || tags.some(tag => typeof tag !== 'string') || new Set(tags).size !== tags.length) {
      gaps.push(`${key}: 依赖机制需要非空且不重复的标识数组`);
    } else for (const tag of tags) if (!covered.has(tag)) gaps.push(`${key}: 机制 ${tag} 还没有用例`);
    if (typeof dependency.rationale !== 'string' || !dependency.rationale.trim()) gaps.push(`${key}: 需要说明机制依赖的核对依据`);
  }
  for (const key of Object.keys(declared)) if (!seen.has(key)) gaps.push(`${key}: 依赖声明没有对应的 PASSED 对象`);
  return gaps;
}
