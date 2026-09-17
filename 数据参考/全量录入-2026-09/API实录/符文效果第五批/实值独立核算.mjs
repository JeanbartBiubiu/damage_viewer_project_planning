import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../../..');
const planning = path.resolve(webRoot, '..', 'damage_viewer_project_planning');
const sourceDir = path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '符文效果第五批');
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidateFile = path.join(sourceDir, '可审查候选.json');
const candidateBytes = fs.readFileSync(candidateFile);
const candidate = JSON.parse(candidateBytes);
const proposals = candidate.proposals;
const byId = new Map(proposals.map(item => [item.id, item]));
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesSha = value => crypto.createHash('sha256').update(value).digest('hex');
const reads = [];
const checks = [];
const issues = [];
const cases = [];
const check = (name, pass, detail = null) => {
  checks.push({ name, pass, detail });
  if (!pass) issues.push({ name, detail });
};
const token = process.env.RUNE5_API_TOKEN || 'local-entry';

async function get(route) {
  const response = await fetch(apiBase + route, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = { parseError: String(error), responseText: text.slice(0, 500) };
  }
  const item = { at: new Date().toISOString(), method: 'GET', route, status: response.status, objectSha256: response.status === 200 && data && !data.parseError ? sha(data) : null, data };
  reads.push(item);
  return item;
}

const parameterPlans = proposals.flatMap(p => p.parameters.map(item => ({ id: p.id, skillKey: p.skillKey, key: item.parameterKey, expected: item, route: `/skills/${p.skillKey}/parameters/${item.parameterKey}` })));
const formulaPlans = proposals.flatMap(p => p.formulas.map(item => ({ id: p.id, skillKey: p.skillKey, key: item.formulaKey, expected: item, route: `/skills/${p.skillKey}/formulas/${item.formulaKey}` })));
const effectPlans = proposals.flatMap(p => p.effects.map(item => ({ id: p.id, skillKey: p.skillKey, key: item.effectKey, expected: item, route: `/skills/${p.skillKey}/effects/${item.effectKey}` })));
const parameterData = new Map();
const formulaData = new Map();
const effectData = new Map();
const bodyMatches = (actual, expected) => actual?.status === 200 && Object.entries(expected).every(([key, value]) => isDeepStrictEqual(actual.data?.[key], value));

for (const plan of formulaPlans) {
  const actual = await get(plan.route);
  formulaData.set(`${plan.id}/${plan.key}`, actual);
  check(`${plan.id}/${plan.key}实时GET状态为200`, actual.status === 200, actual);
  check(`${plan.id}/${plan.key}实时字段匹配候选`, bodyMatches(actual, plan.expected), { expected: plan.expected, actual: actual.data });
}
for (const plan of parameterPlans) {
  const actual = await get(plan.route);
  parameterData.set(`${plan.id}/${plan.key}`, actual);
  check(`${plan.id}/${plan.key}实时GET状态为200`, actual.status === 200, actual);
  check(`${plan.id}/${plan.key}实时字段匹配候选`, bodyMatches(actual, plan.expected), { expected: plan.expected, actual: actual.data });
}
for (const plan of effectPlans) {
  const actual = await get(plan.route);
  effectData.set(`${plan.id}/${plan.key}`, actual);
  check(`${plan.id}/${plan.key}实时GET状态为200`, actual.status === 200, actual);
  check(`${plan.id}/${plan.key}实时字段匹配候选`, bodyMatches(actual, plan.expected), { expected: plan.expected, actual: actual.data });
}
check('实时GET数量正好覆盖31公式、105参数和2效果', reads.length === 138 && formulaPlans.length === 31 && parameterPlans.length === 105 && effectPlans.length === 2, { reads: reads.length, formulas: formulaPlans.length, parameters: parameterPlans.length, effects: effectPlans.length });
check('本次实时核算只有GET请求', reads.every(item => item.method === 'GET'), reads.map(item => item.method));

const parameter = (id, key) => parameterData.get(`${id}/${key}`)?.data;
const formula = (id, key) => formulaData.get(`${id}/${key}`)?.data;
const effect = (id, key) => effectData.get(`${id}/${key}`)?.data;
const attrs = {
  'SOURCE.attack_damage.BONUS': 100,
  'SOURCE.attack_damage.TOTAL': 250,
  'SOURCE.ability_power.TOTAL': 200,
  'SOURCE.hp.BONUS': 500,
  'SOURCE.hp.TOTAL': 2000,
  'TARGET.hp.TOTAL': 2000,
};
const inputs = {
  8005: { confirmed_level_damage: 100, qualified_damage_basis: 500 },
  8008: { actual_stacks: 6, confirmed_ranged_as_per_stack: 0.05, confirmed_melee_level_damage: 18, confirmed_ranged_level_damage: 17, confirmed_bonus_attack_speed_ratio: 0.5 },
  8010: { confirmed_adaptive_per_stack: 2.5, actual_stacks: 12, actual_damage_dealt_to_champion: 400 },
  8021: { confirmed_level_heal: 80 },
  8230: { confirmed_cooldown_seconds: 13.7 },
  8299: { confirmed_damage_amp_ratio: 0.09, qualified_damage_basis: 500 },
  8401: { confirmed_level_damage: 15, new_shield_value: 200 },
  8473: { confirmed_level_block: 45 },
  8369: { confirmed_cooldown_seconds: 20, qualified_damage_basis: 500 },
  8224: { current_ultimate_cooldown_ms: 20000, qualified_ultimate_damage: 500, qualified_self_healing_or_shield: 300 },
  8992: { confirmed_level_damage_per_second: 6 },
  8236: { confirmed_current_ability_power: 48, confirmed_current_attack_damage: 29 },
};
const evaluate = (id, node, runtime = inputs[id], attributes = attrs) => {
  if (node?.nodeType === 'PARAMETER') {
    const p = parameter(id, node.parameterKey);
    if (!p) throw new Error(`缺少实时参数对象 ${node.parameterKey}`);
    if (p.valueMode === 'RUNTIME_INPUT') {
      if (!Object.prototype.hasOwnProperty.call(runtime, node.parameterKey)) throw new Error(`缺少运行输入 ${node.parameterKey}`);
      return runtime[node.parameterKey];
    }
    return p.fixedValue;
  }
  if (node?.nodeType === 'ATTRIBUTE') {
    const key = `${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`;
    if (!Object.prototype.hasOwnProperty.call(attributes, key)) throw new Error(`缺少属性 ${key}`);
    return attributes[key];
  }
  if (node?.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2) throw new Error('未知实时表达式节点');
  const [left, right] = node.operands.map(item => evaluate(id, item, runtime, attributes));
  if (node.operation === 'ADD') return left + right;
  if (node.operation === 'SUBTRACT') return left - right;
  if (node.operation === 'MULTIPLY') return left * right;
  if (node.operation === 'DIVIDE') return left / right;
  throw new Error(`未知实时运算 ${node.operation}`);
};
const mathSpecs = [
  [8005, 'third_attack_damage', 100], [8005, 'additional_damage', 40],
  [8008, 'melee_attack_speed_amount', 0.36], [8008, 'ranged_attack_speed_amount', 0.3], [8008, 'melee_full_stack_damage', 27], [8008, 'ranged_full_stack_damage', 25.5],
  [8010, 'adaptive_force_amount', 30], [8010, 'melee_self_heal', 32], [8010, 'ranged_self_heal', 20],
  [8021, 'melee_heal', 100], [8021, 'ranged_heal', 60], [8021, 'melee_minion_heal', 15], [8021, 'ranged_minion_heal', 9], [8021, 'ranged_move_speed_ratio', 0.15],
  [8230, 'target_damage_threshold', 500], [8230, 'ranged_move_speed_ratio', 0.36], [8230, 'cooldown_ms', 13700],
  [8299, 'additional_damage', 45], [8299, 'maximum_branch_additional_damage', 55],
  [8401, 'damage_amount', 57.5], [8473, 'block_amount', 45],
  [8369, 'additional_damage', 35], [8369, 'cooldown_ms', 20000],
  [8224, 'ultimate_current_cooldown_refund_ms', 1400], [8224, 'single_target_additional_damage', 60], [8224, 'aoe_additional_damage', 40], [8224, 'additional_self_healing_or_shield', 36],
  [8992, 'damage_per_second', 18], [8992, 'amplified_damage_per_second', 31.5],
  [8236, 'ability_power_amount', 48], [8236, 'attack_damage_amount', 29],
];
for (const [id, formulaKey, expected] of mathSpecs) {
  const live = formula(id, formulaKey);
  let actual = null;
  let pass = false;
  try {
    actual = evaluate(id, live.expression);
    pass = Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8;
  } catch (error) {
    actual = { error: String(error) };
  }
  const item = { id, formulaKey, expected, actual, inputs: inputs[id], attributes: attrs, pass, inputOrigin: '本脚本独立指定，公式和固定参数来自本次实时GET' };
  cases.push(item);
  check(`${id}/${formulaKey}实时表达式独立算例`, pass, item);
}
check('31个实时公式均有独立算例', new Set(cases.map(item => `${item.id}/${item.formulaKey}`)).size === 31 && formulaPlans.every(item => cases.some(test => test.id === item.id && test.formulaKey === item.key)), { covered: new Set(cases.map(item => `${item.id}/${item.formulaKey}`)).size });

for (const p of proposals) {
  for (const f of p.formulas) {
    const runtimeKeys = new Set();
    const collect = node => {
      if (node?.nodeType === 'PARAMETER' && parameter(p.id, node.parameterKey)?.valueMode === 'RUNTIME_INPUT') runtimeKeys.add(node.parameterKey);
      if (node?.nodeType === 'OPERATION') node.operands.forEach(collect);
    };
    collect(formula(p.id, f.formulaKey)?.expression);
    for (const key of runtimeKeys) {
      const missing = { ...inputs[p.id] };
      delete missing[key];
      let rejected = false;
      try { evaluate(p.id, formula(p.id, f.formulaKey).expression, missing); } catch { rejected = true; }
      check(`${p.id}/${f.formulaKey}缺少${key}时拒算`, rejected);
    }
  }
}

const mutationCases = [
  { name: '8021总AD变化不影响额外AD公式', id: 8021, formulaKey: 'melee_heal', attrs: { ...attrs, 'SOURCE.attack_damage.TOTAL': 999 }, expected: 100 },
  { name: '8992总AD变化不影响额外AD口径', id: 8992, formulaKey: 'damage_per_second', attrs: { ...attrs, 'SOURCE.attack_damage.TOTAL': 999 }, expected: 18 },
  { name: '8401总生命变化不影响新盾伤害公式', id: 8401, formulaKey: 'damage_amount', attrs: { ...attrs, 'SOURCE.hp.TOTAL': 9000 }, expected: 57.5 },
];
for (const item of mutationCases) {
  const actual = evaluate(item.id, formula(item.id, item.formulaKey).expression, inputs[item.id], item.attrs);
  const pass = Math.abs(actual - item.expected) < 1e-8;
  const result = { ...item, actual, pass };
  cases.push(result);
  check(`实时属性口径算例：${item.name}`, pass, result);
}

const actual8008Effect = effect(8008, 'melee_current_attack_speed');
const actual8236Effect = effect(8236, 'confirmed_ability_power');
check('8008实时效果仍使用bonus_attack_speed_percent比例属性', actual8008Effect?.results?.[0]?.detail?.attributeKey === 'bonus_attack_speed_percent' && actual8008Effect?.results?.[0]?.detail?.modifierZoneKey === 'attribute_flat_add', actual8008Effect);
check('8236实时效果仍使用ability_power属性', actual8236Effect?.results?.[0]?.detail?.attributeKey === 'ability_power' && actual8236Effect?.results?.[0]?.detail?.modifierZoneKey === 'attribute_flat_add', actual8236Effect);
check('8010实时治疗公式均引用实际已结算英雄伤害', ['melee_self_heal', 'ranged_self_heal'].every(key => JSON.stringify(formula(8010, key)?.expression).includes('actual_damage_dealt_to_champion')));
check('8230实时参数保留3000毫秒和0.25门槛', parameter(8230, 'damage_window_ms')?.fixedValue === 3000 && parameter(8230, 'target_max_health_threshold_ratio')?.fixedValue === 0.25);
check('8224实时参数保留当前冷却7%和群体8%', parameter(8224, 'current_ultimate_cooldown_refund_ratio')?.fixedValue === 0.07 && parameter(8224, 'aoe_damage_amp_ratio')?.fixedValue === 0.08);
check('8992实时参数保留三种时长与75%后续增幅', parameter(8992, 'single_duration_ms')?.fixedValue === 4000 && parameter(8992, 'aoe_duration_ms')?.fixedValue === 2000 && parameter(8992, 'dot_duration_ms')?.fixedValue === 1000 && parameter(8992, 'amplification_threshold_ms')?.fixedValue === 3000 && parameter(8992, 'damage_increase_ratio')?.fixedValue === 0.75);
check('8236实时六档法强和当前法强输入存在', [8, 24, 48, 80, 120, 168].every((value, index) => parameter(8236, `ap_at_${(index + 1) * 10}_minutes`)?.fixedValue === value) && parameter(8236, 'confirmed_current_ability_power')?.valueMode === 'RUNTIME_INPUT');

const output = {
  at: new Date().toISOString(),
  pass: issues.length === 0,
  apiWrites: 0,
  candidateSha256: bytesSha(candidateBytes),
  counts: { formulaGets: formulaPlans.length, parameterGets: parameterPlans.length, effectGets: effectPlans.length, totalGets: reads.length },
  reads,
  checks,
  cases,
  issues,
  boundary: '本文件由本次实时GET生成，公式算例使用独立输入；未调用POST/PUT，未修改业务或候选，未运行战斗引擎或页面。',
};
fs.writeFileSync(path.join(here, '实值独立核算.json'), JSON.stringify(output, null, 2) + '\n');
const report = [
  '# 符文第五批实际GET实值独立核算',
  '',
  `结论：${output.pass ? '通过' : '发现问题'}。本次直接GET ${reads.length} 项：31 个公式、105 个参数、2 个效果；业务写入：0。候选散列：\`${output.candidateSha256}\`。`,
  '',
  '每条实时请求均记录请求时间、路由、HTTP 状态、完整返回对象和返回对象散列。公式计算使用本脚本另行指定的输入，并从本次GET返回的公式树和参数值求值；不是回放作者已有算例。',
  '',
  `31 个公式全部有算例，另有${mutationCases.length}个属性口径算例；缺少公式所需运行输入时均拒绝计算。重点核对8008比例属性、8010实际结算英雄伤害、8230三秒/25%门槛、8224当前冷却7%与群体8%、8992三类时长及三秒后1.75倍、8236六档法强。`,
  '',
  '独立 `--verify` 已另外完成174项全量对象、72组组成集合、身份、布局、原图和图片用途保护；本文件只追加公式、必要参数和效果的实时GET实值证据。',
  '',
  '本报告证明接口实时值和表达式算例，未宣称战斗运行或页面验收。',
  '',
  '## 实时对象散列',
  '',
  ...reads.map(item => `- ${item.route}：HTTP ${item.status}；SHA-256（返回JSON）\`${item.objectSha256 ?? '无'}\``),
  '',
  '## 检查结果',
  '',
  ...checks.map(item => `- ${item.pass ? '通过' : '问题'}：${item.name}`),
  '',
  `结构化证据：\`${path.join(here, '实值独立核算.json')}\`。`,
  '',
].join('\n');
fs.writeFileSync(path.join(here, '实值独立核算报告.md'), report);
console.log(JSON.stringify({ pass: output.pass, reads: reads.length, checks: checks.length, issues: issues.length, formulaCases: mathSpecs.length, apiWrites: output.apiWrites }));
if (!output.pass) process.exitCode = 1;
