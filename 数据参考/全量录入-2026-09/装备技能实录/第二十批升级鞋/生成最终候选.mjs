import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECOVERY = path.resolve(HERE, '..', '..', '..', '..', '..', 'damage_web_dev', '.agents', 'artifacts', 'gear20-recovery');
const ARTIFACT = path.resolve(HERE, '..', '..', '..', '..', '..', 'damage_web_dev', '.agents', 'artifacts', 'gear20-finalize');
const SOURCE_PATH = path.join(HERE, '冻结来源.json');
const SNAPSHOT_PATH = path.join(HERE, '写前保护快照.json');
const ORIGINAL_PATH = path.join(RECOVERY, '完整候选.json');
const OUTPUT_PATH = path.join(HERE, '最终候选.json');
const AUDIT_PATH = path.join(ARTIFACT, '候选独立审查.json');
const EXPECTED_ORIGINAL_SHA = 'ba7b5103003075cde856e5855079be031653b589f94c7fcbfb01603a3a099b1a';
const EXPECTED_SOURCE_SHA = '3861cdd2d66da43deb99aca9c085c894258f58a21bfdfc967b9feaa71203e649';

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function approx(actual, expected, epsilon = 1e-6) { return typeof actual === 'number' && Math.abs(actual - expected) <= epsilon; }
function fail(message) { throw new Error(message); }
function check(condition, message) { if (!condition) fail(message); }
function findSource(source, key) { return source.objects.find(item => item.equipmentKey === key); }
function findCandidate(candidate, key) { return candidate.objects.find(item => item.equipmentKey === key); }
function valuesByName(raw) { return Object.fromEntries((raw.mDataValues ?? []).map(item => [item.mName, item.mValue])); }
function walk(node, visit, p = '') {
  if (!node || typeof node !== 'object') return;
  visit(node, p);
  if (Array.isArray(node)) node.forEach((v, i) => walk(v, visit, `${p}/${i}`));
  else Object.entries(node).forEach(([k, v]) => walk(v, visit, `${p}/${k}`));
}
function formulaMap(object) { return Object.fromEntries(object.apiPayload.formulas.map(formula => [formula.formulaKey, formula])); }
function parameterMap(object) { return Object.fromEntries(object.apiPayload.parameters.map(parameter => [parameter.parameterKey, parameter])); }
function getSnapshotRows(snapshot, kind) { return snapshot.rows.filter(row => row.kind === kind); }
function snapshotData(snapshot, kind, equipmentKey) { return snapshot.rows.find(row => row.kind === kind && row.equipmentKey === equipmentKey)?.response?.data; }
function attrs(snapshot, equipmentKey) { return snapshotData(snapshot, 'equipmentAttributesGET', equipmentKey)?.attributeValues; }
function image(snapshot, equipmentKey) { return snapshotData(snapshot, 'representativeImageGET', equipmentKey)?.image; }
function relationItems(snapshot, equipmentKey) { return snapshotData(snapshot, 'relationGET', equipmentKey)?.items; }

const originalSha = sha256File(ORIGINAL_PATH);
const sourceSha = sha256File(SOURCE_PATH);
check(originalSha === EXPECTED_ORIGINAL_SHA, `恢复候选哈希变化：${originalSha}`);
check(sourceSha === EXPECTED_SOURCE_SHA, `冻结来源哈希变化：${sourceSha}`);
const original = readJson(ORIGINAL_PATH);
const source = readJson(SOURCE_PATH);
const snapshot = readJson(SNAPSHOT_PATH);
const candidate = structuredClone(original);
const now = new Date().toISOString();
const selectedKeys = ['item_3168', 'item_3170', 'item_3171', 'item_3173', 'item_3174'];
const expectedAttributes = {
  item_3168: { move_speed: 45, omnivamp_percent: 0.04 },
  item_3170: { move_speed: 65, slow_resist_percent: 0.25 },
  item_3171: { move_speed: 45, ability_haste: 20 },
  item_3173: { move_speed: 45, magic_resistance: 25, tenacity_percent: 0.3 },
  item_3174: { move_speed: 45, armor: 35 },
};
const checks = [];
function record(name, pass, detail = null) { checks.push({ name, pass, ...(detail === null ? {} : { detail }) }); check(pass, `独立候选审查失败：${name}`); }

record('五件装备键完整', JSON.stringify(candidate.objects.map(o => o.equipmentKey)) === JSON.stringify(selectedKeys));
record('冻结来源五件键完整', JSON.stringify(source.objects.map(o => o.equipmentKey)) === JSON.stringify(selectedKeys));
record('实时保护快照26项GET', snapshot.counts?.totalGets === 26 && snapshot.apiWrites === 0 && snapshot.noBusinessWrites === true);
record('实时装备主体5项200', snapshot.statusSummary?.equipment200 === 5);
record('实时直接属性5项200', snapshot.statusSummary?.attributes200 === 5);
record('实时代表图5项200', snapshot.statusSummary?.representativeImages200 === 5);
record('实时关联5项空列表', snapshot.statusSummary?.relations200 === 5 && snapshot.statusSummary?.relationsEmpty === 5);
record('实时目标技能5项404', snapshot.statusSummary?.targetSkills404 === 5);
record('实时分类字典200', snapshot.statusSummary?.category200 === true && JSON.stringify(snapshot.category?.data?.items?.map(item => item.skillCategoryKey)) === JSON.stringify(['move_skill', 'common', 'passive']));

candidate.generatedAt = now;
candidate.stage = '实时保护读取与独立候选审查后最终版，未写业务';
candidate.sourceFreezeSha256 = sourceSha;
candidate.sourceFreezePath = '冻结来源.json';
candidate.currentSnapshotSha256 = sha256File(SNAPSHOT_PATH);
candidate.currentSnapshotPath = '写前保护快照.json';
candidate.currentSnapshotAt = snapshot.finishedAt;
candidate.currentSnapshotNote = '本次重新执行26项GET：五件主体、直接属性、代表图、空关联和目标技能主体各5项，另读技能分类；全部保护条件通过，业务写入0。';
candidate.apiWrites = 0;
candidate.boundary = '第二十批五件升级鞋被动：只新建未写技能与确定参数/数学公式；不重建主体、不改直接属性、不改原图；不创建效果/过程/内部状态/触发/初始化。未知数值运行输入使用RUNTIME_INPUT DECIMAL且无默认；层数和次数输入使用RUNTIME_INPUT INTEGER且无默认。官方护盾0、商店锁定、风味、未知buffcounter显示占位不录。';
const stackObject = findCandidate(candidate, 'item_3168');
const stackParameter = stackObject.apiPayload.parameters.find(parameter => parameter.parameterKey === 'actual_stacks');
check(stackParameter?.valueType === 'DECIMAL', '恢复候选actual_stacks原始类型不是DECIMAL，拒绝静默修订');
stackParameter.valueType = 'INTEGER';
stackParameter.description = '无默认值。战前或对局中已累积层数由运行时提供；层数是整数输入，不因击杀参与事件未接线而丢弃。';
candidate.entryBoundary.selected = selectedKeys.map(equipmentKey => ({
  equipmentKey,
  skillKey: findCandidate(candidate, equipmentKey).skillKey,
  currentRelationCount: relationItems(snapshot, equipmentKey)?.length ?? -1,
}));
candidate.revision = {
  basedOnRecoveryCandidateSha256: originalSha,
  reason: '独立审查按项目现行约束修正层数输入类型；次数与层数保持整数，其他候选载荷不作语义扩展。',
  changes: [{ path: 'objects[item_3168].apiPayload.parameters[actual_stacks].valueType', from: 'DECIMAL', to: 'INTEGER' }],
  realtimeProtection: { snapshotSha256: candidate.currentSnapshotSha256, totalGets: snapshot.counts.totalGets, apiWrites: snapshot.apiWrites },
};

const sourceValueChecks = [
  ['item_3168', 'OmnivampOnTakedown', 0.006], ['item_3168', 'MaxStacks', 10], ['item_3168', 'DamageMod', 0.04], ['item_3168', 'HealingMod', 0.12],
  ['item_3170', 'MSAdaptiveRatio', 0.05],
  ['item_3171', 'SummonerHaste', 20], ['item_3171', 'MeleeMS', 0.1], ['item_3171', 'Duration', 4], ['item_3171', 'RangedMSMultiplier', 0.8],
  ['item_3173', 'Cooldown', 15], ['item_3173', 'ShieldAmount', 0.08], ['item_3173', 'ShieldDuration', 5],
  ['item_3174', 'DamageReduction', 0.1], ['item_3174', 'Cooldown', 15], ['item_3174', 'ShieldAmount', 0.08], ['item_3174', 'ShieldDuration', 5],
];
for (const [equipmentKey, dataValueName, expected] of sourceValueChecks) record(`来源值 ${equipmentKey}/${dataValueName}`, approx(valuesByName(findSource(source, equipmentKey).raw)[dataValueName], expected), { expected });
record('3170 MSToAdaptiveCalc引用', findSource(source, 'item_3170').raw.mItemCalculations.MSToAdaptiveCalc.mFormulaParts[0].mStat === 7 && findSource(source, 'item_3170').raw.mItemCalculations.MSToAdaptiveCalc.mFormulaParts[0].mDataValue === 'MSAdaptiveRatio');
record('3171 MSAmount结构', findSource(source, 'item_3171').raw.mItemCalculations.MSAmount.mFormulaParts[0].mDataValue === 'MeleeMS' && findSource(source, 'item_3171').raw.mItemCalculations.MSAmount.mDisplayAsPercent === true && findSource(source, 'item_3171').raw.mItemCalculations.MSAmount.mRangedMultiplier.mDataValue === 'RangedMSMultiplier');
for (const key of ['item_3173', 'item_3174']) {
  const calc = findSource(source, key).raw.mItemCalculations.ShieldAmountCalc;
  record(`${key}护盾计算树`, calc.mFormulaParts[0].mLevel1Value === 90 && calc.mFormulaParts[0].mBreakpoints[0].mLevel === 9 && calc.mFormulaParts[0].mBreakpoints[0].mBonusPerLevelAtAndAfter === 10 && calc.mFormulaParts[1].mStat === 12 && calc.mFormulaParts[1].mStatFormula === 2 && calc.mFormulaParts[1].mDataValue === 'ShieldAmount');
}

for (const equipmentKey of selectedKeys) {
  const sourceObject = findSource(source, equipmentKey);
  const object = findCandidate(candidate, equipmentKey);
  record(`${equipmentKey}来源原对象哈希`, object.source.rawObjectSha256 === sourceObject.rawSha256);
  record(`${equipmentKey}主体名称与实时装备`, object.equipmentName === snapshotData(snapshot, 'equipmentGET', equipmentKey)?.name);
  record(`${equipmentKey}直接属性未被候选重建`, JSON.stringify(attrs(snapshot, equipmentKey)) === JSON.stringify(expectedAttributes[equipmentKey]));
  record(`${equipmentKey}原图键可复用`, image(snapshot, equipmentKey)?.imageKey === equipmentKey && object.apiPayload.representativeImage.imageKey === equipmentKey);
  record(`${equipmentKey}现有关联为空`, Array.isArray(relationItems(snapshot, equipmentKey)) && relationItems(snapshot, equipmentKey).length === 0 && object.apiPayload.relation.equipmentKey === equipmentKey);
  record(`${equipmentKey}目标技能尚不存在`, snapshot.rows.find(row => row.kind === 'targetSkillGET' && row.equipmentKey === equipmentKey)?.response?.status === 404);
  record(`${equipmentKey}分类为被动`, JSON.stringify(object.apiPayload.skill.skillCategoryKeys) === JSON.stringify(['passive']));
  record(`${equipmentKey}组成列表为空`, ['effects', 'processes', 'internalStates', 'triggerRules'].every(kind => Array.isArray(object.apiPayload[kind]) && object.apiPayload[kind].length === 0));
  const params = parameterMap(object);
  for (const parameter of object.apiPayload.parameters) {
    if (parameter.valueMode === 'RUNTIME_INPUT') {
      const expectedType = parameter.parameterKey === 'actual_stacks' ? 'INTEGER' : 'DECIMAL';
      record(`${equipmentKey}/${parameter.parameterKey}运行时类型`, parameter.valueType === expectedType && parameter.fixedValue === null && parameter.levelValues === null, { expectedType });
    }
  }
  for (const parameter of object.apiPayload.parameters.filter(parameter => /_ms$/.test(parameter.parameterKey))) record(`${equipmentKey}/${parameter.parameterKey}时间为整数毫秒`, parameter.valueType === 'INTEGER' && parameter.valueMode === 'FIXED' && Number.isInteger(parameter.fixedValue) && parameter.fixedValue > 0);
  const formulas = formulaMap(object);
  for (const formula of object.apiPayload.formulas) {
    const refs = [];
    walk(formula.expression, (node, p) => {
      if (node.nodeType === 'PARAMETER') refs.push({kind: 'parameter', key: node.parameterKey, path: p});
      if (node.nodeType === 'FORMULA') refs.push({kind: 'formula', key: node.formulaKey, path: p});
      if (node.nodeType === 'ATTRIBUTE') refs.push({kind: 'attribute', key: `${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`, path: p});
      if (node.nodeType === 'OPERATION') check(['ADD', 'MULTIPLY', 'MIN'].includes(node.operation), `${equipmentKey}/${formula.formulaKey}存在未允许运算`);
      if (node.nodeType && !['PARAMETER', 'FORMULA', 'ATTRIBUTE', 'OPERATION'].includes(node.nodeType)) fail(`${equipmentKey}/${formula.formulaKey}存在未知节点${node.nodeType}`);
    });
    record(`${equipmentKey}/${formula.formulaKey}参数引用存在`, refs.filter(ref => ref.kind === 'parameter').every(ref => Boolean(params[ref.key])) && refs.every(ref => ref.kind !== 'formula'), refs);
  }
}
record('层数公式包含MIN上限', (() => {
  const formula = formulaMap(stackObject).stacked_omnivamp;
  const e = formula.expression;
  return e.nodeType === 'OPERATION' && e.operation === 'MULTIPLY' && e.operands[0]?.nodeType === 'OPERATION' && e.operands[0].operation === 'MIN' && e.operands[0].operands[0]?.parameterKey === 'actual_stacks' && e.operands[0].operands[1]?.parameterKey === 'max_stacks' && e.operands[1]?.parameterKey === 'omnivamp_per_stack';
})());
record('层数上限参数为10整数', parameterMap(stackObject).max_stacks.valueType === 'INTEGER' && parameterMap(stackObject).max_stacks.fixedValue === 10);
record('五件候选分类无active', candidate.objects.every(object => JSON.stringify(object.apiPayload.skill.skillCategoryKeys) === JSON.stringify(['passive'])));
const computedTotals = {
 equipment: candidate.objects.length,
 skills: candidate.objects.length,
 parameters: candidate.objects.reduce((n, o) => n + o.apiPayload.parameters.length, 0),
 formulas: candidate.objects.reduce((n, o) => n + o.apiPayload.formulas.length, 0),
 effects: candidate.objects.reduce((n, o) => n + o.apiPayload.effects.length, 0),
 processes: candidate.objects.reduce((n, o) => n + o.apiPayload.processes.length, 0),
 internalStates: candidate.objects.reduce((n, o) => n + o.apiPayload.internalStates.length, 0),
 triggerRules: candidate.objects.reduce((n, o) => n + o.apiPayload.triggerRules.length, 0),
 relations: candidate.objects.reduce((n, o) => n + 1, 0),
 representativeImages: candidate.objects.reduce((n, o) => n + 1, 0),
};
const expectedTotals = { equipment: 5, skills: 5, parameters: 32, formulas: 5, effects: 0, processes: 0, internalStates: 0, triggerRules: 0, relations: 5, representativeImages: 5 };
record('候选总计32参数5公式5关联5图', JSON.stringify(computedTotals) === JSON.stringify(expectedTotals), { computedTotals, expectedTotals });
candidate.totals = expectedTotals;
const audit = {
  generatedAt: now,
  mode: '独立候选审查',
  noBusinessWrites: true,
  apiWrites: 0,
  originalCandidateSha256: originalSha,
  sourceSha256: sourceSha,
  snapshotSha256: candidate.currentSnapshotSha256,
  correctedCandidateSha256: null,
  changedPaths: candidate.revision.changes,
  checks,
  allPass: checks.every(item => item.pass),
};
check(audit.allPass, '独立候选审查存在失败项');
if (fs.existsSync(OUTPUT_PATH)) fail(`最终候选已存在：${OUTPUT_PATH}`);
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(candidate, null, 2) + '\n', 'utf8');
audit.correctedCandidateSha256 = sha256File(OUTPUT_PATH);
fs.mkdirSync(ARTIFACT, { recursive: true });
fs.writeFileSync(AUDIT_PATH, JSON.stringify(audit, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({outputPath: OUTPUT_PATH, auditPath: AUDIT_PATH, originalCandidateSha256: originalSha, correctedCandidateSha256: audit.correctedCandidateSha256, sourceSha256: sourceSha, snapshotSha256: candidate.currentSnapshotSha256, checkCount: checks.length, allPass: audit.allPass, apiWrites: 0}));

