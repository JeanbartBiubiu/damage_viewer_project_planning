import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const planningDir = here;
const files = {
  current: path.join(planningDir, '完整候选.json'),
  previous: path.join(planningDir, '完整候选-主审前.json'),
  finalVersion: path.join(planningDir, '主审最终版本.json'),
  reviewPatch: path.join(planningDir, '主审修正.json'),
  frozen: path.join(planningDir, '冻结来源.json'),
  before: path.join(planningDir, '写前现值.json'),
  readOnlyPlan: path.join(planningDir, '写前只读计划.json'),
  readOnlyCheck: path.join(planningDir, '当前只读核对.json')
};

const bytes = {};
const data = {};
for (const [key, file] of Object.entries(files)) {
  bytes[key] = await readFile(file);
  data[key] = JSON.parse(bytes[key]);
}
const writeRecordName = (await readdir(planningDir)).filter(name => /^写入执行记录-.*\.json$/.test(name)).sort().at(-1) ?? null;
const writeRecord = writeRecordName ? JSON.parse(await readFile(path.join(planningDir, writeRecordName))) : null;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hashes = Object.fromEntries(Object.keys(files).map(key => [key, sha256(bytes[key])]));
const expectedIds = [2510, 2512, 2517, 2520, 2523, 2524, 2526, 2530, 3040, 3042, 3073, 3083];
const expectedChangedIds = [2510, 2524, 3042, 3083];
const currentObjects = new Map(data.current.objects.map(item => [item.equipmentKey, item]));
const previousObjects = new Map(data.previous.objects.map(item => [item.equipmentKey, item]));
const frozenObjects = new Map(data.frozen.objects.map(item => [item.id, item]));
const checks = [];

function check(name, fn, details = {}) {
  try {
    fn();
    checks.push({ name, status: '通过', ...details });
  } catch (error) {
    checks.push({ name, status: '阻塞', reason: error instanceof Error ? error.message : String(error), ...details });
  }
}

function item(id, source = data.current) {
  const found = source.objects.find(object => object.equipmentKey === `item_${id}`);
  assert.ok(found, `缺少装备对象 item_${id}`);
  return found;
}

function payload(id, source = data.current) {
  return item(id, source).apiPayload;
}

function parameter(id, key) {
  const found = payload(id).parameters.find(row => row.parameterKey === key);
  assert.ok(found, `item_${id}缺少参数${key}`);
  return found;
}

function maybeParameter(id, key) {
  return payload(id).parameters.find(row => row.parameterKey === key);
}

function formula(id, key) {
  const found = payload(id).formulas.find(row => row.formulaKey === key);
  assert.ok(found, `item_${id}缺少公式${key}`);
  return found;
}

function walkExpression(node, visitor) {
  visitor(node);
  if (node?.nodeType === 'OPERATION') {
    assert.ok(Array.isArray(node.operands), '公式运算节点的操作数不是数组');
    for (const child of node.operands) walkExpression(child, visitor);
  }
}

function collectAttributes(expression) {
  const nodes = [];
  walkExpression(expression, node => {
    if (node?.nodeType === 'ATTRIBUTE') nodes.push(node);
  });
  return nodes;
}

function collectParameters(expression) {
  const nodes = [];
  walkExpression(expression, node => {
    if (node?.nodeType === 'PARAMETER') nodes.push(node.parameterKey);
  });
  return nodes;
}

function assertExpression(expression, proposal) {
  walkExpression(expression, node => {
    assert.ok(node && typeof node === 'object', `${proposal.skillKey}公式节点不是对象`);
    if (node.nodeType === 'PARAMETER') {
      assert.ok(proposal.parameters.some(row => row.parameterKey === node.parameterKey), `${proposal.skillKey}引用未知参数${node.parameterKey}`);
      return;
    }
    if (node.nodeType === 'ATTRIBUTE') {
      assert.equal(node.attributeOwner, 'SOURCE', `${proposal.skillKey}属性归属不是SOURCE`);
      assert.equal(typeof node.attributeKey, 'string');
      assert.equal(typeof node.attributeValueKind, 'string');
      return;
    }
    assert.equal(node.nodeType, 'OPERATION', `${proposal.skillKey}公式节点类型异常`);
    assert.ok(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'].includes(node.operation), `${proposal.skillKey}公式运算异常`);
    assert.equal(node.operands.length, 2, `${proposal.skillKey}公式不是二元运算`);
  });
}

function evaluate(node, context) {
  if (node.nodeType === 'PARAMETER') {
    assert.ok(Object.hasOwn(context.parameters, node.parameterKey), `算例缺少参数${node.parameterKey}`);
    return context.parameters[node.parameterKey];
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const key = `${node.attributeOwner}:${node.attributeKey}:${node.attributeValueKind}`;
    assert.ok(Object.hasOwn(context.attributes, key), `算例缺少属性${key}`);
    return context.attributes[key];
  }
  assert.equal(node.nodeType, 'OPERATION');
  const left = evaluate(node.operands[0], context);
  const right = evaluate(node.operands[1], context);
  switch (node.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'DIVIDE': return left / right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw new Error(`未知运算${node.operation}`);
  }
}

function runCase(name, id, formulaKey, parameters, attributes, expected, explanation) {
  check(`算例 ${name}`, () => {
    const proposal = payload(id);
    const fixed = Object.fromEntries(proposal.parameters.filter(row => row.valueMode === 'FIXED').map(row => [row.parameterKey, row.fixedValue]));
    const actual = evaluate(formula(id, formulaKey).expression, { parameters: { ...fixed, ...parameters }, attributes });
    assert.ok(Math.abs(actual - expected) < 1e-9, `得到${actual}，预期${expected}`);
    arithmetic.push({ name, id, skillKey: proposal.skillKey, formulaKey, parameters, attributes, expected, actual, explanation });
  });
}

check('最终候选版本与主审记录一致', () => {
  assert.equal(hashes.current, '9a83728eadbc0ca64925e50a5f3bf249f114e7e4dff78b45e99760c476a55983');
  assert.equal(data.finalVersion.candidateSha256, hashes.current);
  assert.deepEqual(data.finalVersion.totals, data.current.totals);
  assert.equal(data.reviewPatch.originalSha256, hashes.previous);
  assert.equal(data.current.totals.parameters, 67);
  assert.equal(data.current.totals.formulas, 29);
  assert.equal(data.current.totals.components, 132);
});

check('12个来源对象和候选主体范围完整', () => {
  assert.deepEqual(data.current.objects.map(object => Number(object.equipmentKey.slice(5))), expectedIds);
  assert.deepEqual(data.previous.objects.map(object => Number(object.equipmentKey.slice(5))), expectedIds);
  assert.deepEqual(data.frozen.objects.map(object => object.id), expectedIds);
  for (const id of expectedIds) {
    const current = item(id);
    const source = frozenObjects.get(id);
    assert.equal(current.skillKey, `item_${id}_passive`);
    assert.equal(current.source.path, `Items/${id}`);
    assert.equal(current.apiPayload.skill.skillKey, `item_${id}_passive`);
    assert.equal(current.apiPayload.relation.equipmentKey, `item_${id}`);
    assert.equal(current.apiPayload.representativeImage.imageKey, `item_${id}`);
    assert.deepEqual(current.source.bindings, source.bound);
    assert.equal(current.source.sourceFiles.length, 3);
  }
});

check('主审候选变化范围与四项记录一致', () => {
  const changed = [];
  for (const id of expectedIds) {
    const before = previousObjects.get(`item_${id}`);
    const after = currentObjects.get(`item_${id}`);
    if (JSON.stringify(before) !== JSON.stringify(after)) changed.push(id);
  }
  assert.deepEqual(changed, [2510, 2512, 2520, 2523, 2524, 2530, 3042, 3083]);
  for (const id of expectedChangedIds) assert.ok(changed.includes(id), `主审标记的${id}没有实际变化`);
  assert.equal(data.reviewPatch.notes.length, 4);
  assert.deepEqual(data.reviewPatch.notes.map(note => note.id), expectedChangedIds);
});

check('全部最终公式结构可回读', () => {
  for (const object of data.current.objects) {
    for (const row of object.apiPayload.formulas) assertExpression(row.expression, object.apiPayload);
  }
});

check('2510治疗第二项改为来源额外生命值', () => {
  assert.equal(maybeParameter(2510, 'spellblade_healing_mstat12_formula2_input'), undefined);
  assert.equal(parameter(2510, 'spellblade_healing_mstat12_formula2_ratio').fixedValue, 0.03);
  const healing = formula(2510, 'spellblade_healing_value');
  const attributes = collectAttributes(healing.expression);
  assert(attributes.some(node => node.attributeOwner === 'SOURCE' && node.attributeKey === 'hp' && node.attributeValueKind === 'BONUS'));
  assert(!collectParameters(healing.expression).includes('spellblade_healing_mstat12_formula2_input'));
  assert.match(healing.description, /额外生命值/);
  assert.match(payload(2510).skill.description, /额外生命值/);
});

check('2524自身攻速、远程分支和两个哈希映射准确', () => {
  const raw = frozenObjects.get(2524).object;
  const calculations = raw.mItemCalculations;
  assert.equal(calculations.BuffDuration.mRangedMultiplier.mNumber, 0.5);
  assert.equal(calculations.AuraAttackSpeed.mFormulaParts[0].mDataValue, '{eb8d750f}');
  assert.equal(calculations.AuraAttackSpeed.mRangedMultiplier.mDataValue, '{ca6deae2}');
  assert.equal(parameter(2524, 'melody_duration_ms').fixedValue, 8000);
  assert.equal(parameter(2524, 'melody_ranged_duration_multiplier').fixedValue, 0.5);
  assert.equal(parameter(2524, 'melody_self_base_attack_speed_ratio').fixedValue, 0.3);
  assert.equal(parameter(2524, 'melody_self_ranged_attack_speed_multiplier').fixedValue, 0.667);
  assert.equal(evaluate(formula(2524, 'melody_self_ranged_attack_speed_ratio').expression, { parameters: Object.fromEntries(payload(2524).parameters.map(row => [row.parameterKey, row.fixedValue])), attributes: {} }), 0.2001);
  assert.equal(evaluate(formula(2524, 'melody_ranged_duration_ms').expression, { parameters: Object.fromEntries(payload(2524).parameters.map(row => [row.parameterKey, row.fixedValue])), attributes: {} }), 4000);
  assert.match(payload(2524).skill.description, /包括自己|包括自身/);
  assert.match(payload(2524).skill.description, /排除第三者/);
  const omitted = item(2524).omittedComponents.map(row => `${row.key} ${row.reason}`).join('；');
  assert.match(omitted, /第三者友军/);
  assert.match(formula(2524, 'melody_self_ranged_attack_speed_ratio').description, /0\.2001/);
});

check('2524源文本与最终分支用途一致', () => {
  const source = frozenObjects.get(2524).bound;
  assert.match(source.keyTooltip.text, /附近的友军，包括你自己/);
  assert.equal(item(2524).disposition['范围外'].some(row => /第三者/.test(row.reason)), true);
  assert.equal(item(2524).disposition['范围外'].some(row => row.component === '自身攻速'), false);
});

check('3042公式仅表达已证法力组成并保留缺失项', () => {
  const names = ['bonus_attack_damage_from_max_mana', 'on_hit_damage_from_max_mana', 'melee_ability_damage_from_max_mana', 'ranged_ability_damage_from_max_mana'];
  for (const key of names) {
    const row = formula(3042, key);
    const attributes = collectAttributes(row.expression);
    assert.deepEqual(attributes.map(({ attributeOwner, attributeKey, attributeValueKind }) => ({ attributeOwner, attributeKey, attributeValueKind })), [{ attributeOwner: 'SOURCE', attributeKey: 'mana', attributeValueKind: 'TOTAL' }]);
  }
  assert.equal(maybeParameter(3042, 'ability_tad_ratio'), undefined);
  assert.equal(maybeParameter(3042, 'per_cast_id_lockout'), undefined);
  assert.match(formula(3042, 'melee_ability_damage_from_max_mana').description, /仅法力组成/);
  assert.match(formula(3042, 'ranged_ability_damage_from_max_mana').description, /不能作为完整技能冲击伤害/);
  assert.match(payload(3042).skill.description, /AbilityTADRatio缺失不填0/);
});

check('3083保留非英雄伤害后三秒失能', () => {
  assert.equal(parameter(3083, 'warmog_nonchampion_damage_lockout_ms').fixedValue, 3000);
  assert.equal(maybeParameter(3083, 'seconds_per_heal'), undefined);
  const source = frozenObjects.get(3083).bound;
  assert.match(source.keyTooltip.text, /每秒回复/);
  assert.match(source.keyTooltipExtendedRules.text, /非英雄单位的伤害.*失能.*秒/);
  assert.match(payload(3083).skill.description, /非英雄伤害后的3秒失能/);
  assert.match(payload(3083).skill.description, /0\.5与每秒提示×2可在算术上对应/);
  assert.match(item(3083).omittedComponents.map(row => row.key).join(','), /seconds_per_heal/);
  assert.equal(item(3083).disposition['范围外'].some(row => /非英雄/.test(row.reason)), false);
});

check('主审来源证据哈希和近远程映射一致', () => {
  assert.equal(data.reviewPatch.sourceEvidence.attackSpeedHashes.MeleeAuraAttackSpeed, '{eb8d750f}');
  assert.equal(data.reviewPatch.sourceEvidence.attackSpeedHashes.RangedAttackSpeedMultiplier, '{ca6deae2}');
  assert.match(data.reviewPatch.sourceEvidence.aftershockSourceObjectSha256, /^[0-9a-f]{64}$/);
  function fnv1a(value) {
    let hash = 0x811c9dc5;
    for (const byte of Buffer.from(value.toLowerCase(), 'ascii')) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    return `{${hash.toString(16).padStart(8, '0')}}`;
  }
  assert.equal(fnv1a('MeleeAuraAttackSpeed'), '{eb8d750f}');
  assert.equal(fnv1a('RangedAttackSpeedMultiplier'), '{ca6deae2}');
});

const arithmetic = [];
runCase('2510咒刃伤害', 2510, 'spellblade_damage_value', { spellblade_damage_mstat2_formula1_input: 20 }, { 'SOURCE:ability_power:TOTAL': 100 }, 25, '0.75×20+0.1×100');
runCase('2510自身治疗', 2510, 'spellblade_healing_value', {}, { 'SOURCE:ability_power:TOTAL': 100, 'SOURCE:hp:BONUS': 1000 }, 40, '0.1×100+0.03×1000');
runCase('2524远程持续', 2524, 'melody_ranged_duration_ms', {}, {}, 4000, '8000×0.5');
runCase('2524自身远程攻速', 2524, 'melody_self_ranged_attack_speed_ratio', {}, {}, 0.2001, '0.3×0.667，保留0.2001');
runCase('3042最大法力转额外攻击力', 3042, 'bonus_attack_damage_from_max_mana', {}, { 'SOURCE:mana:TOTAL': 2000 }, 40, '2000×0.02');
runCase('3042攻击特效法力伤害', 3042, 'on_hit_damage_from_max_mana', {}, { 'SOURCE:mana:TOTAL': 2000 }, 24, '2000×0.012');
runCase('3042近战技能法力组成', 3042, 'melee_ability_damage_from_max_mana', {}, { 'SOURCE:mana:TOTAL': 2000 }, 80, '2000×0.04');
runCase('3042远程技能法力组成', 3042, 'ranged_ability_damage_from_max_mana', {}, { 'SOURCE:mana:TOTAL': 2000 }, 60, '2000×0.03');
runCase('3083基础治疗', 3083, 'warmog_base_healing_value', { warmog_healing_stat_input: 1000 }, {}, 15, '0.015×1000');
runCase('3083提示治疗', 3083, 'warmog_tooltip_healing_value', { warmog_healing_stat_input: 1000 }, {}, 30, '0.015×1000×2');
runCase('3083装备生命转化', 3083, 'warmog_bonus_health_from_equipment', { warmog_equipment_health_input: 1000 }, {}, 120, '1000×0.12');

check('现有写入记录仅作回读证据', () => {
  assert.ok(writeRecord, '未发现现有写入执行记录');
  assert.equal(writeRecord.candidateSha256, hashes.current);
  assert.equal(writeRecord.sourceHash, hashes.frozen);
  assert.equal(writeRecord.beforeHash, hashes.before);
  assert.equal(writeRecord.finalSummary.same, 132);
  assert.equal(writeRecord.finalSummary.missing, 0);
  assert.equal(writeRecord.finalSummary.conflicts, 0);
  assert.equal(writeRecord.finalSummary.deferred, 0);
  assert.equal(writeRecord.errors.length, 0);
  assert.equal(writeRecord.events.length, 264);
  assert.equal(writeRecord.mode, '显式补缺写入');
}, { note: '只读取既有记录，本脚本没有调用业务接口' });

const passed = checks.filter(row => row.status === '通过').length;
const failed = checks.length - passed;
const result = {
  generatedAt: new Date().toISOString(),
  stage: '装备第十六批主审四项变更独立只读核对；只读候选、冻结来源、历史候选、主审记录和既有执行记录',
  planningDir,
  inputSha256: hashes,
  expected: {
    finalCandidateSha256: '9a83728eadbc0ca64925e50a5f3bf249f114e7e4dff78b45e99760c476a55983',
    sourceSha256: hashes.frozen,
    beforeSha256: hashes.before,
    objectIds: expectedIds,
    changedObjectIds: expectedChangedIds
  },
  currentTotals: data.current.totals,
  historicalCandidateSha256: hashes.previous,
  mainReview: data.finalVersion,
  reviewPatch: data.reviewPatch,
  changedObjects: expectedChangedIds.map(id => ({
    id,
    beforeParameterKeys: previousObjects.get(`item_${id}`).apiPayload.parameters.map(row => row.parameterKey),
    afterParameterKeys: currentObjects.get(`item_${id}`).apiPayload.parameters.map(row => row.parameterKey),
    beforeFormulaKeys: previousObjects.get(`item_${id}`).apiPayload.formulas.map(row => row.formulaKey),
    afterFormulaKeys: currentObjects.get(`item_${id}`).apiPayload.formulas.map(row => row.formulaKey)
  })),
  arithmetic: { count: arithmetic.length, passed: arithmetic.length, cases: arithmetic },
  checks: { count: checks.length, passed, failed, allPassed: failed === 0, details: checks },
  observedWriteRecord: writeRecord ? {
    file: writeRecordName,
    mode: writeRecord.mode,
    eventCount: writeRecord.events.length,
    finalSummary: writeRecord.finalSummary,
    errors: writeRecord.errors,
    candidateSha256: writeRecord.candidateSha256
  } : null,
  conclusions: {
    item2510: '治疗第二项从显式未知属性输入改为SOURCE hp BONUS；mStat2/formula1第一伤害基数仍为显式输入。',
    item2524: '恢复包括自身的攻速数值；0.3×0.667保留为0.2001，持续时间基础8秒与远程0.5分支分开。',
    item3042: '四个伤害或转化公式均只表达SOURCE mana TOTAL已证组成；缺失AbilityTADRatio和6.5锁定单位仍保留缺口。',
    item3083: '非英雄伤害后3秒失能进入候选；0.5秒原字段与每秒提示×2按算术对应记录，未构造治疗周期。'
  },
  blockers: checks.filter(row => row.status === '阻塞')
};

await writeFile(path.join(here, '最终变更核对.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
const report = [
  '# 装备第十六批主审最终变更独立核对',
  '',
  '本次只读取第十六批最终候选、主审前历史候选、冻结来源、主审版本记录、写前现值和已有执行记录；没有调用业务接口，也没有修改规划候选。',
  '',
  `最终候选SHA256：\`${hashes.current}\`；冻结来源SHA256：\`${hashes.frozen}\`；写前现值SHA256：\`${hashes.before}\`；历史候选SHA256：\`${hashes.previous}\`。`,
  '',
  `当前候选为12个装备、67个参数、29个公式、12个关系、12个代表图复用计划，共132项组成。与主审前历史候选比较，变化对象为2510、2512、2520、2523、2524、2530、3042、3083；主审最终版本明确记录的四项变更为2510、2524、3042、3083。`,
  '',
  '## 四项变更核对',
  '',
  '- 2510：治疗第二项使用来源额外生命值，移除该项的显式未知属性输入；第一伤害项仍保留显式输入。',
  '- 2524：保留文本“包括你自己”的自身攻速，基础0.3、远程0.667，乘积为0.2001；基础持续8000毫秒，远程分支另乘0.5得到4000毫秒。',
  '- 3042：最大法力转化、攻击特效、近战技能和远程技能四个公式均只引用SOURCE mana TOTAL；缺失的AbilityTADRatio没有补零，也没有把6.5写成毫秒。',
  '- 3083：保留非英雄伤害后的3000毫秒恢复禁用；0.5秒原字段与每秒提示乘2的数值对应被记录，但没有据此新增周期治疗。',
  '',
  `独立算例${arithmetic.length}项全部通过；结构与变更检查${checks.length}项，通过${passed}项，阻塞${failed}项。`,
  '',
  writeRecord ? `既有执行记录${writeRecordName}仅作回读证据：最终摘要为${writeRecord.finalSummary.same}项相同、${writeRecord.finalSummary.missing}项缺失、${writeRecord.finalSummary.conflicts}项冲突、${writeRecord.finalSummary.deferred}项延期；本次核对未重放写入。` : '未发现既有执行记录；本次核对未调用业务接口。',
  '',
  '完整输入哈希、逐项检查、变化前后参数和公式键、独立算例及执行记录摘要见 `最终变更核对.json`。上述结果只证明静态候选、来源和既有回读证据，不扩大为战斗运行或浏览器证明。',
  ''
].join('\n');
await writeFile(path.join(here, '最终变更核对.md'), report, 'utf8');
console.log(JSON.stringify({ checks: { count: checks.length, passed, failed }, arithmetic: arithmetic.length, candidateSha256: hashes.current, writeRecord: writeRecordName ?? null }));
if (failed) process.exitCode = 1;
