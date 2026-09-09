import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

const artifactDir = dirname(fileURLToPath(import.meta.url));
const webRoot = 'C:/project/damage_web_dev';
const candidateDir = join(webRoot, '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第十一批');
const currentPath = join(candidateDir, '完整候选.json');
const oldPath = join(candidateDir, '主审前', '完整候选.json');
const selfHealEvidencePath = join(candidateDir, '菲奥娜自身治疗补证.json');
const expectedCurrentSha256 = '98eb0627937a403ddcecd5b597469271ef5b9e074113083bac38d3572e1f2a83';
const expectedOldSha256 = '36bf395af31e0365b3f69d9eaf31600e58ae6ab7d9aa8b0713a55456693c5aa2';
const expectedCurrentCounts = { parameters: 175, formulas: 44, effects: 16, processes: 0, internalStates: 0, triggerRules: 0 };
const checks = [];
const issues = [];
const examples = [];

const sha256 = value => createHash('sha256').update(value).digest('hex');
const near = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-5;
const check = (name, ok, detail, severity = '一般') => {
  const item = { name, ok: Boolean(ok), severity, detail };
  checks.push(item);
  if (!ok) issues.push(item);
  return Boolean(ok);
};
const parameter = (skill, key) => skill.write.parameters.find(item => item.parameterKey === key);
const formula = (skill, key) => skill.write.formulas.find(item => item.formulaKey === key);
const walk = (node, visit) => {
  if (!node || typeof node !== 'object') return;
  visit(node);
  if (node.nodeType === 'OPERATION') for (const child of node.operands ?? []) walk(child, visit);
};
const parameterRefs = expression => {
  const out = [];
  walk(expression, node => { if (node.nodeType === 'PARAMETER') out.push(node.parameterKey); });
  return out;
};
const attributeRefs = expression => {
  const out = [];
  walk(expression, node => { if (node.nodeType === 'ATTRIBUTE') out.push(`${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`); });
  return out;
};
const valueOf = (node, skill, rank, level, runtime, attributes) => {
  if (node.nodeType === 'PARAMETER') {
    const p = parameter(skill, node.parameterKey);
    if (!p) throw new Error(`缺参数 ${node.parameterKey}`);
    if (p.valueMode === 'FIXED') return p.fixedValue;
    if (p.valueMode === 'RUNTIME_INPUT') return runtime[node.parameterKey];
    return p.levelValues[String(p.valueMode === 'CHARACTER_LEVEL' ? level : rank)];
  }
  if (node.nodeType === 'ATTRIBUTE') return attributes[`${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`];
  const [left, right] = node.operands.map(child => valueOf(child, skill, rank, level, runtime, attributes));
  if (node.operation === 'ADD') return left + right;
  if (node.operation === 'MULTIPLY') return left * right;
  throw new Error(`不支持运算 ${node.operation}`);
};
const run = (label, skill, formulaKey, rank, level, expected, runtime, attributes) => {
  try {
    const value = valueOf(formula(skill, formulaKey).expression, skill, rank, level, runtime, attributes);
    const item = { label, formulaKey, rank, level, expected, value, ok: near(value, expected) };
    examples.push(item);
    check(`算例 ${label}`, item.ok, item);
  } catch (error) {
    const item = { label, formulaKey, rank, level, expected, error: String(error), ok: false };
    examples.push(item);
    check(`算例 ${label}`, false, item);
  }
};

const currentBytes = await readFile(currentPath);
const oldBytes = await readFile(oldPath);
const current = JSON.parse(currentBytes);
const old = JSON.parse(oldBytes);
check('修正后候选散列', sha256(currentBytes) === expectedCurrentSha256, { expected: expectedCurrentSha256, actual: sha256(currentBytes) }, '阻塞');
check('主审前候选散列', sha256(oldBytes) === expectedOldSha256, { expected: expectedOldSha256, actual: sha256(oldBytes) }, '阻塞');
check('候选仍声明未写业务接口', current.meta?.apiWrites === 0, current.meta?.apiWrites, '阻塞');
check('四名英雄20技能槽未变', isDeepStrictEqual(Object.keys(current.skills), Object.keys(old.skills)) && Object.keys(current.skills).length === 20, Object.keys(current.skills));

const counts = { parameters: 0, formulas: 0, effects: 0, processes: 0, internalStates: 0, triggerRules: 0 };
for (const skill of Object.values(current.skills)) for (const kind of Object.keys(counts)) counts[kind] += skill.write[kind]?.length ?? 0;
check('修正后组成总数为175/44/16/0/0/0', isDeepStrictEqual(counts, expectedCurrentCounts), { expected: expectedCurrentCounts, actual: counts }, '阻塞');

for (const key of Object.keys(old.skills)) {
  if (key === 'fiora_r') continue;
  check(`其他技能未发生变更 ${key}`, isDeepStrictEqual(current.skills[key], old.skills[key]), '只允许菲奥娜R变化');
}
const before = old.skills.fiora_r;
const after = current.skills.fiora_r;
const withoutSortOrder = value => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(withoutSortOrder);
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'sortOrder').map(([key, child]) => [key, withoutSortOrder(child)]));
};
check('菲奥娜R来源绑定未漂移', isDeepStrictEqual(after.source, before.source), { before: before.source, after: after.source });
check('菲奥娜R非治疗公式保持原值', isDeepStrictEqual(withoutSortOrder(formula(after, 'r_vital_true_damage')), withoutSortOrder(formula(before, 'r_vital_true_damage'))), formula(after, 'r_vital_true_damage'));
check('菲奥娜R法力效果保持原值', isDeepStrictEqual(after.write.effects, before.write.effects), after.write.effects);
check('菲奥娜R无新增过程状态触发', after.write.processes.length === 0 && after.write.internalStates.length === 0 && after.write.triggerRules.length === 0, { processes: after.write.processes, internalStates: after.write.internalStates, triggerRules: after.write.triggerRules });

const oldParameters = new Set(before.write.parameters.map(item => item.parameterKey));
const newParameters = after.write.parameters.filter(item => !oldParameters.has(item.parameterKey));
const oldFormulas = new Set(before.write.formulas.map(item => item.formulaKey));
const newFormulas = after.write.formulas.filter(item => !oldFormulas.has(item.formulaKey));
check('只新增3个治疗参数', newParameters.map(item => item.parameterKey).join(',') === 'healing_source_duration_ms,healing_base_per_second,healing_bonus_ad_ratio', newParameters);
check('只新增1个自身每秒治疗公式', newFormulas.map(item => item.formulaKey).join(',') === 'self_healing_per_second', newFormulas);
check('治疗持续时间5000毫秒', parameter(after, 'healing_source_duration_ms')?.valueMode === 'FIXED' && parameter(after, 'healing_source_duration_ms')?.fixedValue === 5000, parameter(after, 'healing_source_duration_ms'));
check('治疗基础值为技能1至3级75/100/125', isDeepStrictEqual(parameter(after, 'healing_base_per_second')?.levelValues, { '1': 75, '2': 100, '3': 125 }), parameter(after, 'healing_base_per_second'));
check('治疗额外攻击力系数为0.6', parameter(after, 'healing_bonus_ad_ratio')?.valueMode === 'FIXED' && parameter(after, 'healing_bonus_ad_ratio')?.fixedValue === 0.6, parameter(after, 'healing_bonus_ad_ratio'));
const healFormula = formula(after, 'self_healing_per_second');
check('自身治疗公式引用基础值、0.6额外攻击力和来源额外攻击力', isDeepStrictEqual(parameterRefs(healFormula?.expression), ['healing_base_per_second', 'healing_bonus_ad_ratio']) && attributeRefs(healFormula?.expression).includes('SOURCE.attack_damage.BONUS'), healFormula);
check('自身治疗公式保持每秒口径', /每秒/.test(healFormula?.description ?? '') && /不能直接作为每跳量或瞬时总治疗/.test(healFormula?.description ?? ''), healFormula?.description);

const sourceProof = JSON.parse(await readFile(selfHealEvidencePath, 'utf8'));
check('自身治疗补证不含业务写入', sourceProof.businessWrites === 0, sourceProof.businessWrites, '阻塞');
check('自身治疗补证与候选来源散列一致', sourceProof.sourceHashes?.some(item => item.id === 'Fiora' && item.clientSha256 === after.source.clientSha256 && item.officialSha256 === after.source.officialSha256), sourceProof.sourceHashes);
const proofBySource = new Map(after.proofs.map(item => [item.source, item]));
check('治疗持续时间证明保留', proofBySource.get('DataValues.HealDuration')?.parameterKey === 'healing_source_duration_ms' && isDeepStrictEqual(proofBySource.get('DataValues.HealDuration')?.values, [5000, 5000, 5000]), proofBySource.get('DataValues.HealDuration'));
check('每秒基础治疗证明保留', proofBySource.get('DataValues.HealPerSecond')?.parameterKey === 'healing_base_per_second' && isDeepStrictEqual(proofBySource.get('DataValues.HealPerSecond')?.values, [75, 100, 125]), proofBySource.get('DataValues.HealPerSecond'));
check('额外攻击力比例证明保留', proofBySource.get('DataValues.Ratio')?.parameterKey === 'healing_bonus_ad_ratio' && isDeepStrictEqual(proofBySource.get('DataValues.Ratio')?.values, [0.6, 0.6, 0.6]), proofBySource.get('DataValues.Ratio'));
check('缺失MinHealDuration没有补值', proofBySource.get('DataValues.MinHealDuration')?.sourcePending === true && proofBySource.get('DataValues.MinHealDuration')?.raw?.values === undefined, proofBySource.get('DataValues.MinHealDuration'));
check('HealDurationExtension保持来源待核', proofBySource.get('DataValues.HealDurationExtension')?.sourcePending === true && isDeepStrictEqual(proofBySource.get('DataValues.HealDurationExtension')?.raw?.values, [1, 1, 1, 1, 1, 1, 1]), proofBySource.get('DataValues.HealDurationExtension'));
check('只排除第三者治疗分发', after.excluded?.some(item => item.component === '第三名友方英雄治疗分发') && !after.excluded?.some(item => item.component === '周围友方持续治疗'), after.excluded);
check('自身治疗条件和首跳间隔继续待核', after.pending?.some(item => item.component === '自身持续治疗触发与时序' && /首跳与间隔未证/.test(item.reason) && /自身实际位于治疗圈内/.test(item.reason)), after.pending);

const runtime = { passive_vital_damage_ratio: 0.078 };
const attrs = { 'SOURCE.attack_damage.BONUS': 120, 'TARGET.hp.TOTAL': 1800 };
run('自身每秒治疗（1级）', after, 'self_healing_per_second', 1, 1, 147, runtime, attrs);
run('自身每秒治疗（3级）', after, 'self_healing_per_second', 3, 9, 197, runtime, attrs);
run('R四处破绽共享伤害', after, 'r_vital_true_damage', 3, 9, 561.6, runtime, attrs);
const healingAtFiveSeconds = 5 * 147;
check('算例明确5秒只是乘法参考不生成周期效果', healingAtFiveSeconds === 735 && after.write.effects.length === 1 && after.write.processes.length === 0, { perSecond: 147, sourceDurationSeconds: 5, arithmeticReferenceTotal: healingAtFiveSeconds, effects: after.write.effects.length, processes: after.write.processes.length });

const report = {
  generatedAt: new Date().toISOString(),
  scope: '只复核菲奥娜R候选从主审前版本到修正版本的差异；不代表业务接口、战斗运行或页面验收。',
  oldCandidateSha256: sha256(oldBytes),
  currentCandidateSha256: sha256(currentBytes),
  parentReportedObjectSha256: '32550e330bafe6d0783f38bcbbf62656aed3ac70d2b5bd9a2d53cd9d92e583a1',
  counts: { before: { parameters: Object.values(old.skills).reduce((n, item) => n + item.write.parameters.length, 0), formulas: Object.values(old.skills).reduce((n, item) => n + item.write.formulas.length, 0) }, after: counts },
  changedParameters: newParameters,
  changedFormulas: newFormulas,
  sourceEvidenceSha256: sha256(Buffer.from(JSON.stringify(sourceProof))),
  examples,
  issues,
  checks,
  pass: issues.length === 0,
};
await writeFile(join(artifactDir, '菲奥娜R修正复核.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ pass: report.pass, checkCount: checks.length, issueCount: issues.length, output: join(artifactDir, '菲奥娜R修正复核.json') }));
