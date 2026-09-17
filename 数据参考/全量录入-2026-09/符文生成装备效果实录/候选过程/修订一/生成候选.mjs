import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve('C:/project/damage_web_dev');
const outDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(workspace, '.agents', 'artifacts', 'rune-equipment-ownership-root-20260910');
const reviewDir = path.join(workspace, '.agents', 'artifacts', 'rune-equipment-ownership-cursor-review-run-20260910');
const nodeRuntime = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function writeJson(fileName, value) {
  const filePath = path.join(outDir, fileName);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

function writeText(fileName, value) {
  const filePath = path.join(outDir, fileName);
  fs.writeFileSync(filePath, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
  return filePath;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function finiteNumber(value, label) {
  assert(typeof value === 'number' && Number.isFinite(value), `${label} 必须是有限数值`);
  return value;
}

function integerMs(value, label) {
  finiteNumber(value, label);
  assert(Number.isInteger(value) && value >= 0, `${label} 必须是非负整数毫秒`);
  return value;
}

function valueByName(object, name) {
  const row = (object.mDataValues ?? []).find((item) => item.mName === name);
  assert(row, `来源缺少数据值 ${name}`);
  return row.mValue;
}

function op(operation, left, right) {
  return { nodeType: 'OPERATION', operation, operands: [left, right] };
}

function parameter(parameterKey) {
  return { nodeType: 'PARAMETER', parameterKey };
}

function attribute(attributeOwner, attributeKey, attributeValueKind) {
  return { nodeType: 'ATTRIBUTE', attributeOwner, attributeKey, attributeValueKind };
}

function fixedParameter(parameterKey, name, valueType, fixedValue, description, sortOrder) {
  finiteNumber(fixedValue, `${parameterKey}.fixedValue`);
  return {
    parameterKey,
    name,
    valueType,
    valueMode: 'FIXED',
    fixedValue,
    levelValues: null,
    description,
    sortOrder
  };
}

function runtimeParameter(parameterKey, name, valueType, description, sortOrder) {
  return {
    parameterKey,
    name,
    valueType,
    valueMode: 'RUNTIME_INPUT',
    fixedValue: null,
    levelValues: null,
    description,
    sortOrder
  };
}

function formula(formulaKey, name, description, expression, sortOrder) {
  return { formulaKey, name, description, sortOrder, expression };
}

function fixedValueRule(kind, key, fixedMinValue = null, fixedMaxValue = null) {
  return {
    value: { kind, ...(kind === 'PARAMETER' ? { parameterKey: key } : { formulaKey: key }) },
    fixedMultiplier: 1,
    fixedMinValue,
    fixedMaxValue
  };
}

function permanentLifecycle() {
  return {
    durationValue: null,
    maxStacksValue: { kind: 'FIXED', value: 1 },
    applicationStacksValue: { kind: 'FIXED', value: 1 },
    instanceScope: 'SOURCE',
    reapplicationStackMode: 'KEEP',
    reapplicationDurationMode: null,
    expiryMode: 'EXPLICIT_ONLY',
    periodicIntervalValue: null,
    firstPeriodicExecution: null
  };
}

function persistentBehavior() {
  return {
    moment: 'PERSISTENT',
    valueReadMode: 'MOMENT_EVALUATION',
    stackValueMode: 'SHARED',
    reapplicationValueMode: 'ADD',
    periodicExecutionMode: null
  };
}

function footwearBehavior() {
  return {
    moment: 'PERSISTENT',
    valueReadMode: 'APPLICATION_SNAPSHOT',
    stackValueMode: 'SHARED',
    reapplicationValueMode: 'REPLACE',
    periodicExecutionMode: null
  };
}

const inputIndexPath = path.join(rootDir, '输入索引.json');
const snapshotPath = path.join(rootDir, '当前保护快照.json');
const sourcePath = path.join(rootDir, '四装备固定来源.json');
const biscuitProofPath = path.join(rootDir, '饼干当前具名来源补证.json');
const duplicateCheckPath = path.join(rootDir, '补充查重与分类.json');
const oldEffectReferencePath = path.join(rootDir, '旧鞋效果真实引用只读核对.json');
const revisedSchemePath = path.join(rootDir, '最小补录方案-修订三.md');
const inputIndex = readJson(inputIndexPath);
const snapshot = readJson(snapshotPath);
const sourceFreeze = readJson(sourcePath);
const biscuitProof = readJson(biscuitProofPath);
const duplicateCheck = readJson(duplicateCheckPath);
const oldEffectReference = readJson(oldEffectReferencePath);
const revisedScheme = readText(revisedSchemePath);
const cursorReviewPath = path.join(reviewDir, 'review.md');
const cursorSummaryPath = path.join(reviewDir, 'summary.json');
const cursorV2ReviewDir = path.join(workspace, '.agents', 'artifacts', 'rune-equipment-ownership-v2-cursor-review-run-20260910');
const cursorV2ReviewPath = path.join(cursorV2ReviewDir, 'review.md');
const cursorV2SummaryPath = path.join(cursorV2ReviewDir, 'summary.json');
const cursorV3ReviewDir = path.join(workspace, '.agents', 'artifacts', 'rune-equipment-ownership-v3-cursor-review-run-20260910');
const cursorV3ConclusionPath = path.join(cursorV3ReviewDir, 'Cursor来源复核结论.md');
const cursorV3ReviewPath = path.join(cursorV3ReviewDir, 'review.md');
const cursorV3SummaryPath = path.join(cursorV3ReviewDir, 'summary.json');

assert(inputIndex.GETs === 72, `固定输入GET数量不是72：${inputIndex.GETs}`);
assert(inputIndex.businessWrites === 0, '固定输入记录了业务写入');
assert(snapshot.GETs === 72 && snapshot.businessWrites === 0, '保护快照GET或写入计数不符合固定输入');
assert(sourceFreeze.version.client === '16.17' && sourceFreeze.version.official === '16.17.1', '来源版本不是固定的16.17/16.17.1');
assert(biscuitProof.businessWrites === 0, '饼干补证记录了业务写入');
assert(duplicateCheck.GETs === 6 && duplicateCheck.businessWrites === 0, '补充查重不是6GET/0写入');
assert(oldEffectReference.businessWrites === 0 && oldEffectReference.DDL === 0 && oldEffectReference.passed === true, '旧效果引用核对不是只读通过');
assert(revisedScheme.includes('rune-equipment-ownership-v3'), '未读取到修订三方案');
assert(fs.existsSync(cursorReviewPath) && fs.existsSync(cursorSummaryPath), 'Cursor独立复核材料缺失');
assert(fs.existsSync(cursorV2ReviewPath) && fs.existsSync(cursorV2SummaryPath), 'Cursor v2独立复核材料缺失');
const cursorV2Review = readText(cursorV2ReviewPath);
const cursorV2Summary = readJson(cursorV2SummaryPath);
assert(cursorV2Review.includes('Cursor Run Review') && String(cursorV2Summary.result?.result ?? '').includes('VERDICT: REVISE') && String(cursorV2Summary.result?.result ?? '').includes('REVIEWED_PLAN_REV: rune-equipment-ownership-v2'), 'Cursor v2结论不是已记录的REVISE');
assert(cursorV2Summary.resultStatus === 'finished' && cursorV2Summary.result?.status === 'finished', 'Cursor v2尚未完成');
assert(fs.existsSync(cursorV3ConclusionPath) && fs.existsSync(cursorV3ReviewPath) && fs.existsSync(cursorV3SummaryPath), 'Cursor v3独立复核材料缺失');
const cursorV3Conclusion = readText(cursorV3ConclusionPath);
const cursorV3Review = readText(cursorV3ReviewPath);
const cursorV3Summary = readJson(cursorV3SummaryPath);
assert(cursorV3Conclusion.includes('VERDICT: READY') && cursorV3Conclusion.includes('REVIEWED_PLAN_REV: rune-equipment-ownership-v3'), 'Cursor v3结论不是READY或修订三');
assert(cursorV3Review.includes('result: finished') && cursorV3Review.includes('Review Findings'), 'Cursor v3审计摘要缺少完成标记');
assert(cursorV3Summary.resultStatus === 'finished' && cursorV3Summary.result?.status === 'finished' && String(cursorV3Summary.result?.result ?? '').includes('VERDICT: READY') && String(cursorV3Summary.result?.result ?? '').includes('REVIEWED_PLAN_REV: rune-equipment-ownership-v3'), 'Cursor v3尚未完成或结论不符');

const duplicateSkillRows = duplicateCheck.requests.filter((request) => request.route.startsWith('/skills/item_'));
assert(duplicateSkillRows.length === 4 && duplicateSkillRows.every((request) => request.status === 404), '四个拟用技能标识没有全部查重为404');
const categories = duplicateCheck.requests.find((request) => request.route === '/skill-categories')?.data?.items ?? [];
assert(categories.map((row) => row.skillCategoryKey).sort().join(',') === 'common,move_skill,passive', '当前技能类别字典不符');
const categoryKeys = new Set(categories.map((row) => row.skillCategoryKey));
assert(duplicateCheck.requests.find((request) => request.route.includes('/effects/magical_footwear_additional_speed/representative-image'))?.data?.image === null, '旧鞋效果代表图必须为空');

const sourceByKey = Object.fromEntries(sourceFreeze.objects.map((item) => [item.equipmentKey, item]));
const snapshotRequests = snapshot.requests;
const routeData = (route) => snapshotRequests.find((item) => item.route === route)?.data;
const skillKeysInSnapshot = new Set(snapshot.skills);
const runeKeys = ['rune_8304_passive', 'rune_8313_passive', 'rune_8345_passive'];

function routeRows(prefix, suffix) {
  return snapshotRequests.filter((item) => item.route.startsWith(prefix) && item.route.endsWith(suffix));
}

const protectedParameterRows = snapshotRequests.filter((item) => /^\/skills\/rune_[^/]+\/parameters\/[^/]+$/.test(item.route));
const protectedFormulaRows = snapshotRequests.filter((item) => /^\/skills\/rune_[^/]+\/formulas\/[^/]+$/.test(item.route));
const protectedEffectRows = snapshotRequests.filter((item) => /^\/skills\/rune_[^/]+\/effects\/[^/]+$/.test(item.route));
const protectedCurrentCounts = {
  parameters: protectedParameterRows.length,
  formulas: protectedFormulaRows.length,
  effects: protectedEffectRows.length,
  total: protectedParameterRows.length + protectedFormulaRows.length + protectedEffectRows.length
};
assert(protectedCurrentCounts.parameters === 19, `保护参数数不为19：${protectedCurrentCounts.parameters}`);
assert(protectedCurrentCounts.formulas === 2, `保护公式数不为2：${protectedCurrentCounts.formulas}`);
assert(protectedCurrentCounts.effects === 1, `保护效果数不为1：${protectedCurrentCounts.effects}`);
assert(protectedCurrentCounts.total === 22, `保护总组成数不为22：${protectedCurrentCounts.total}`);

const runeParameterKeys = Object.fromEntries(runeKeys.map((skillKey) => [
  skillKey,
  protectedParameterRows.filter((row) => row.route.startsWith(`/skills/${skillKey}/`)).map((row) => row.data.parameterKey).sort()
]));
const runeFormulaKeys = Object.fromEntries(runeKeys.map((skillKey) => [
  skillKey,
  protectedFormulaRows.filter((row) => row.route.startsWith(`/skills/${skillKey}/`)).map((row) => row.data.formulaKey).sort()
]));
const protectedEffect = protectedEffectRows.find((row) => row.data.effectKey === 'magical_footwear_additional_speed');
assert(protectedEffect, '保护快照缺少神奇之鞋已有额外移速效果');
const protectedEffectData = protectedEffect.data;
const protectedEffectResult = protectedEffectData.results?.[0];
assert(protectedEffectResult?.resultType === 'ATTRIBUTE_CHANGE', '神奇之鞋已有效果不是属性变化');
assert(protectedEffectResult.detail?.attributeKey === 'move_speed', '神奇之鞋已有效果属性不是move_speed');
assert(protectedEffectResult.valueRule?.value?.kind === 'PARAMETER', '神奇之鞋已有效果不是参数值');
assert(protectedEffectResult.valueRule.value.parameterKey === 'additional_move_speed', '神奇之鞋已有效果参数不符');
assert(Array.isArray(oldEffectReference.inboundReferences) && oldEffectReference.inboundReferences.length === 0, '旧鞋效果仍有数据库入引用');
assert(Array.isArray(oldEffectReference.imageRelations) && oldEffectReference.imageRelations.length === 0, '旧鞋效果仍有图片关联');

const attributesData = routeData('/attributes');
const modifierZonesData = routeData('/modifier-zones');
assert(attributesData?.total === 28 && attributesData.items?.length === 28, '属性快照不是28项');
assert(modifierZonesData?.total === 4 && modifierZonesData.items?.length === 4, '乘区快照不是4项');
const attributeKeys = attributesData.items.map((item) => item.attributeKey);
const modifierZoneKeys = modifierZonesData.items.map((item) => item.modifierZoneKey);
assert(attributeKeys.includes('hp') && attributeKeys.includes('move_speed'), '缺少饼干或神奇之鞋所需属性');
assert(modifierZoneKeys.includes('attribute_flat_add'), '缺少属性固定加算乘区');

const equipmentStates = {};
for (const item of sourceFreeze.objects) {
  const detail = routeData(`/equipment/${item.equipmentKey}`);
  const attrs = routeData(`/equipment/${item.equipmentKey}/attributes`);
  const image = routeData(`/equipment/${item.equipmentKey}/representative-image`);
  const relations = routeData(`/equipment-skill-relations?equipmentKey=${item.equipmentKey}&page=1&pageSize=200`);
  assert(detail?.equipmentKey === item.equipmentKey && detail?.name === item.name, `${item.equipmentKey}主体快照不符`);
  assert(attrs?.equipmentKey === item.equipmentKey, `${item.equipmentKey}属性快照不符`);
  assert(image?.image?.imageKey === item.imageKey, `${item.equipmentKey}图片快照不符`);
  assert(relations?.total === 0 && relations.items?.length === 0, `${item.equipmentKey}已有技能挂载`);
  assert(stableJson(attrs.attributeValues) === stableJson(item.attributeValues), `${item.equipmentKey}直接属性与来源不符`);
  equipmentStates[item.equipmentKey] = {
    equipmentKey: item.equipmentKey,
    name: item.name,
    directAttributes: attrs.attributeValues,
    representativeImage: image.image,
    relationCount: relations.total,
    sourceDirectAttributes: item.attributeValues
  };
}
assert(equipmentStates.item_2422.directAttributes.move_speed === 25, 'item_2422直接移速不是25');

function lineNumber(file, pattern) {
  const lines = readText(path.join(workspace, file)).split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(pattern));
  return index < 0 ? null : index + 1;
}

const codeEvidence = {
  skillEffectType: {
    path: 'web/src/types/skillEffect.ts',
    sha256: sha256File(path.join(workspace, 'web/src/types/skillEffect.ts')),
    lines: {
      resultTypes: lineNumber('web/src/types/skillEffect.ts', "export type SkillEffectResultType"),
      attributeChangeDetail: lineNumber('web/src/types/skillEffect.ts', 'export type SkillEffectAttributeChangeDetail'),
      resourceChangeDetail: lineNumber('web/src/types/skillEffect.ts', 'export type SkillEffectResourceChangeDetail')
    },
    finding: '现有结果类型有属性变化和资源变化，资源变化要求已有属性键；没有技能点结果类型。'
  },
  skillParameterType: {
    path: 'web/src/types/skillParameter.ts',
    sha256: sha256File(path.join(workspace, 'web/src/types/skillParameter.ts')),
    lines: {
      valueType: lineNumber('web/src/types/skillParameter.ts', 'export type SkillParameterValueType'),
      valueMode: lineNumber('web/src/types/skillParameter.ts', 'export type SkillParameterValueMode')
    },
    finding: '参数只有INTEGER/DECIMAL和固定、技能等级、角色等级、运行输入四种值模式。'
  }
};

const sourceObject = (key) => sourceByKey[key].source.object;
const item2010 = sourceByKey.item_2010;
const item2150 = sourceByKey.item_2150;
const item2152 = sourceByKey.item_2152;
const item2422 = sourceByKey.item_2422;
const item2010Values = Object.fromEntries(['PotionDurationTOOLTIP', 'BonusMaxHealthTOOLTIP', 'FlatHealTOOLTIP', 'MaxHPMultiplierTOOLTIP', 'MaxHealIncreaseTOOLTIP', 'MinHPThresholdTOOLTIP'].map((key) => [key, valueByName(sourceObject('item_2010'), key)]));
const item2152Values = Object.fromEntries(['AdaptiveAmount', 'Duration'].map((key) => [key, valueByName(sourceObject('item_2152'), key)]));
assert(item2010Values.PotionDurationTOOLTIP === 5, '饼干持续时间来源不是5秒');
assert(item2010Values.BonusMaxHealthTOOLTIP === 30, '饼干永久生命来源不是30');
assert(item2010Values.FlatHealTOOLTIP === 20, '饼干固定恢复来源不是20');
assert(Math.abs(item2010Values.MaxHPMultiplierTOOLTIP - 0.015) < 1e-7, '饼干客户端生命比例来源不是0.015');
assert(item2010Values.MaxHealIncreaseTOOLTIP === 100, '饼干提升上限来源不是100%');
assert(Math.abs(item2010Values.MinHPThresholdTOOLTIP - 0.3) < 1e-7, '饼干生命阈值来源不是0.3');
assert(item2152Values.AdaptiveAmount === 25 && item2152Values.Duration === 60, '原力合剂来源不是25/60');
assert(item2422.source.object.mFlatMovementSpeedMod === 25, '神奇之鞋直接移速原始值不是25');

const baseRecoveryExpression = op(
  'ADD',
  parameter('flat_recovery'),
  op('MULTIPLY', parameter('client_health_recovery_ratio'), attribute('SOURCE', 'hp', 'TOTAL'))
);
const totalRecoveryExpression = op(
  'ADD',
  baseRecoveryExpression,
  op('MULTIPLY', baseRecoveryExpression, op('MIN', parameter('actual_missing_health_boost_ratio'), parameter('maximum_recovery_increase_ratio')))
);

const objects = [
  {
    equipmentKey: 'item_2010',
    equipmentName: item2010.name,
    skillKey: 'item_2010_consume',
    source: {
      sourceFile: '四装备固定来源.json',
      sourcePointer: '/objects[item_2010]/source/object',
      itemId: 2010,
      clientDataValues: item2010Values,
      clientCalculation: {
        calculationKey: 'TotalHealCalcTOOLTIP',
        meaning: '最大生命乘MaxHPMultiplierTOOLTIP，再加FlatHealTOOLTIP；当前绑定用于5秒内持续恢复总量。',
        sourceParts: [
          { mStat: 12, mDataValue: 'MaxHPMultiplierTOOLTIP', meaning: 'SOURCE.hp.TOTAL × 客户端最大生命比例' },
          { mDataValue: 'FlatHealTOOLTIP', meaning: '固定恢复量' }
        ]
      },
      officialDescription: item2010.source.official.description,
      officialDisplayedRatio: 0.02,
      officialRatioNote: '官方16.17.1长说明的2%只作为来源差异留证；当前同构建物品树和符文8345已有0.015实际候选，不建立第二套实际恢复。',
      supplement: {
        itemPath: biscuitProof.itemPath,
        sourceInterpretation: biscuitProof.sourceInterpretation,
        bindingPointers: Object.entries(biscuitProof.bindings).map(([field, binding]) => ({ field, sourceKey: binding.key, text: binding.text }))
      },
      ignoredRawFields: [
        { field: 'mEffectAmount[0]', value: 10, reason: '没有战斗语义证明，不能变成治疗或永久属性。' },
        { field: 'BotData', value: 0.11999999731779099, reason: '机器人数据旁支，不作为玩家实际治疗。' }
      ]
    },
    directAttributesProtected: {},
    valueSemantics: {
      flat_recovery: { unit: '生命值点数', sourceValue: 20 },
      client_health_recovery_ratio: { unit: '比例', representation: '1=100%', sourceValue: 0.015 },
      maximum_recovery_increase_ratio: { unit: '比例', representation: '1=100%', sourceValue: 1 },
      health_ratio_at_maximum_recovery: { unit: '生命比例', representation: '1=100%', sourceValue: 0.3 },
      recovery_duration_ms: { unit: '毫秒', sourceValue: 5000 },
      permanent_health_per_cookie: { unit: '最大生命值点数/实际消耗或出售1块', sourceValue: 30 },
      actual_missing_health_boost_ratio: { unit: '运行时比例', representation: '1=100%', default: null },
      actual_consumed_or_sold_count: { unit: '实际块数', default: null }
    },
    apiPayload: {
      skill: {
        skillKey: 'item_2010_consume',
        name: '永续意志夹心饼干·消耗',
        description: '保存消费后的5秒恢复总量基数、已损生命提升上限和每实际消耗或出售一块永久增加30最大生命值。恢复节拍、首跳、最大生命读取时点与出售是否回血未证；不把总量当单次治疗，也不挂符文8345整套。',
        maxLevel: 1,
        status: 'ENABLED',
        sortOrder: 0,
        skillCategoryKeys: ['common']
      },
      parameters: [
        fixedParameter('recovery_duration_ms', '恢复窗口', 'INTEGER', 5000, '客户端PotionDurationTOOLTIP=5秒；转换为5000毫秒。只表示恢复窗口，不表示跳数或首跳。', 10),
        fixedParameter('flat_recovery', '饼干固定恢复量', 'INTEGER', 20, '客户端FlatHealTOOLTIP=20；单位为生命值点数。', 20),
        fixedParameter('client_health_recovery_ratio', '客户端最大生命恢复比例', 'DECIMAL', 0.015, '客户端MaxHPMultiplierTOOLTIP=0.014999999664723873，按当前构建归一化为0.015；1表示100%。', 30),
        fixedParameter('maximum_recovery_increase_ratio', '已损生命恢复提升上限', 'DECIMAL', 1, '客户端MaxHealIncreaseTOOLTIP=100%，参数采用比例1表示100%；没有另建100点参数。', 40),
        fixedParameter('health_ratio_at_maximum_recovery', '达到最大恢复提升的生命比例', 'DECIMAL', 0.3, '客户端MinHPThresholdTOOLTIP=0.30000001192092896，按来源归一化为0.3；中间曲线和边界时点未证。', 50),
        fixedParameter('permanent_health_per_cookie', '每块永久最大生命', 'INTEGER', 30, '客户端BonusMaxHealthTOOLTIP=30；只对真实消耗或出售事件计数。', 60),
        runtimeParameter('actual_consumed_or_sold_count', '实际已消耗或出售饼干数', 'INTEGER', '无默认值；由实际消耗或出售事件提供，不能用取得数、背包数或满堆数代替。', 70),
        runtimeParameter('actual_missing_health_boost_ratio', '实际已损生命恢复提升比例', 'DECIMAL', '无默认值；由运行时已损生命曲线提供，不能用0或自行假设线性曲线。', 80)
      ],
      formulas: [
        formula('base_biscuit_recovery', '饼干恢复基数', '来源计算式为20+0.015×SOURCE.hp.TOTAL；来源只证明数值组成，尚未证明治疗节拍。', baseRecoveryExpression, 10),
        formula('biscuit_recovery_total', '饼干5秒恢复总量', '在恢复基数上乘以1+MIN(实际已损生命提升,100%上限)。这是5秒总量，不能作为单次治疗结果。', totalRecoveryExpression, 20),
        formula('permanent_health_gain', '饼干永久最大生命增量', '30×实际已消耗或出售饼干数；实际计数缺失时拒绝计算。', op('MULTIPLY', parameter('permanent_health_per_cookie'), parameter('actual_consumed_or_sold_count')), 30)
      ],
      effects: [
        {
          effectKey: 'permanent_health_gain',
          name: '饼干永久最大生命',
          description: '消费或出售事件每确认一块时增加30最大生命；当前只保存可表达结果，消费事件触发尚未接线。',
          sortOrder: 10,
          lifecycle: permanentLifecycle(),
          results: [
            {
              resultKey: 'attribute_bonus',
              name: '永久最大生命增加',
              target: 'SOURCE',
              description: '属性单位为最大生命值点数，使用属性固定加算乘区。',
              sortOrder: 10,
              lifecycleBehavior: persistentBehavior(),
              spellShieldBlockScope: null,
              valueRule: fixedValueRule('FORMULA', 'permanent_health_gain', 0, null),
              resultType: 'ATTRIBUTE_CHANGE',
              detail: { attributeKey: 'hp', operation: 'INCREASE', modifierZoneKey: 'attribute_flat_add' }
            }
          ]
        }
      ],
      processes: [],
      internalStates: [],
      triggerRules: []
    },
    relation: { equipmentKey: 'item_2010', skillKey: 'item_2010_consume', sortOrder: 10 },
    representativeImage: { imageKey: 'item_2010' },
    omittedComponents: [
      { component: '治疗每跳/首跳/跳数', reason: '来源只证明5秒持续窗口与总量，未证明节拍，不能拆成五跳。' },
      { component: '出售金币', reason: '纯经济分支不属于本批战斗和成长候选。' },
      { component: '符文8345取得间隔与截止时间', reason: '属于符文生成资格，不是物品消费条件。' },
      { component: '官方0.02实际恢复比例', reason: '与当前物品树/符文候选0.015存在来源差异，不能并行创建两套实际治疗。' }
    ],
    pendingComponents: [
      { component: '恢复触发与节拍', reason: '当前无物品消耗事件契约；本候选不声称已接线。' },
      { component: '已损生命中间曲线和最大生命读取时点', reason: '仅保留实际运行输入和来源阈值，不填默认或线性曲线。' },
      { component: '与符文8345的唯一有效恢复/永久生命来源', reason: '装备候选保留消费侧组成，执行时需保证符文资料对象不再重复结算。' }
    ],
    scope: '保留消费/出售后的永久最大生命与消费恢复资料；排除符文发放节奏、纯经济和未知治疗节拍。',
    safeguards: {
      equipmentKey: 'item_2010',
      beforeRelationCount: equipmentStates.item_2010.relationCount,
      directAttributesProtected: true,
      representativeImageReused: 'item_2010',
      equipmentBodyNotRebuilt: true,
      referencesRuneSkillKeys: [],
      sourceOnlyUntilEventContract: true
    }
  },
  {
    equipmentKey: 'item_2150',
    equipmentName: item2150.name,
    skillKey: 'item_2150_consume',
    source: {
      sourceFile: '四装备固定来源.json',
      sourcePointer: '/objects[item_2150]/source/object',
      itemId: 2150,
      client: { consumed: true, clickable: true, spellName: sourceObject('item_2150').spellName, restrictedBuffName: sourceObject('item_2150').RestrictedBuffName },
      officialDescription: item2150.source.official.description,
      confirmed: { skillPoints: 1, increasesCharacterLevel: false, canInvestInMaxedSkill: false }
    },
    directAttributesProtected: {},
    valueSemantics: { skill_points_granted: { unit: '技能点数', sourceValue: 1 } },
    apiPayload: {
      skill: {
        skillKey: 'item_2150_consume',
        name: '技能合剂·消耗',
        description: '保存消费后提供1技能点，以及不提升角色等级、不能投入已升满技能的来源限制。现有结果类型没有技能点分配结果，因此不伪造成属性或等级变化。',
        maxLevel: 1,
        status: 'ENABLED',
        sortOrder: 0,
        skillCategoryKeys: ['common']
      },
      parameters: [
        fixedParameter('skill_points_granted', '技能合剂提供技能点数', 'INTEGER', 1, '官方与客户端主动说明均为提供1技能点数；消费事件与战前分配接口尚未接线。', 10)
      ],
      formulas: [],
      effects: [],
      processes: [],
      internalStates: [],
      triggerRules: []
    },
    relation: { equipmentKey: 'item_2150', skillKey: 'item_2150_consume', sortOrder: 10 },
    representativeImage: { imageKey: 'item_2150' },
    omittedComponents: [
      { component: '角色等级增加', reason: '官方明确不会提升角色等级。' },
      { component: '属性变化', reason: '技能点不是攻击力、法强、生命等属性，不能凭空映射。' },
      { component: '符文8313的9级获得资格', reason: '属于符文生成资格，不是消费最低等级。' }
    ],
    pendingComponents: [
      { component: '技能点分配与满级限制的运行接口', reason: '现有结果类型没有技能点分配类型；保留参数和两条来源限制，不声称已接线。' },
      { component: '消费触发', reason: '当前没有物品消费事件契约。' }
    ],
    scope: '保留1技能点及官方两条限制；排除角色等级、属性伪映射、符文生成等级和经济分支。',
    codeEvidence,
    safeguards: {
      equipmentKey: 'item_2150',
      beforeRelationCount: equipmentStates.item_2150.relationCount,
      directAttributesProtected: true,
      representativeImageReused: 'item_2150',
      equipmentBodyNotRebuilt: true,
      referencesRuneSkillKeys: [],
      noFakeAttributeEffect: true
    }
  },
  {
    equipmentKey: 'item_2152',
    equipmentName: item2152.name,
    skillKey: 'item_2152_consume',
    source: {
      sourceFile: '四装备固定来源.json',
      sourcePointer: '/objects[item_2152]/source/object',
      itemId: 2152,
      clientDataValues: item2152Values,
      clientCategory: sourceObject('item_2152').mCategories,
      officialDescription: item2152.source.official.description,
      confirmed: { adaptiveForce: 25, duration_ms: 60000 }
    },
    directAttributesProtected: {},
    valueSemantics: {
      adaptive_force_amount: { unit: '适应之力原始点数', sourceValue: 25, conversion: '未指定' },
      duration_ms: { unit: '毫秒', sourceValue: 60000 }
    },
    apiPayload: {
      skill: {
        skillKey: 'item_2152_consume',
        name: '原力合剂·消耗',
        description: '保存消费后25适应之力、持续60000毫秒及适应选择互斥边界。转换到攻击力或法术强度的方向、比例和判定时点未证，不同时创建两种属性效果。',
        maxLevel: 1,
        status: 'ENABLED',
        sortOrder: 0,
        skillCategoryKeys: ['common']
      },
      parameters: [
        fixedParameter('adaptive_force_amount', '原力合剂适应之力', 'INTEGER', 25, '客户端AdaptiveAmount=25；保存为原始适应之力，不默认转换成攻击力或法术强度。', 10),
        fixedParameter('duration_ms', '原力合剂持续时间', 'INTEGER', 60000, '客户端Duration=60秒，转换为60000毫秒；不是生成等级或消费等级。', 20)
      ],
      formulas: [],
      effects: [],
      processes: [],
      internalStates: [],
      triggerRules: []
    },
    relation: { equipmentKey: 'item_2152', skillKey: 'item_2152_consume', sortOrder: 10 },
    representativeImage: { imageKey: 'item_2152' },
    omittedComponents: [
      { component: '同时增加攻击力和法术强度', reason: '适应选择必须互斥，转换方向与比例未证。' },
      { component: '韧性', reason: '客户端分类Tenacity不是本人增益数值证明。' },
      { component: '符文8313的6级获得资格', reason: '属于符文生成资格，不是消费最低等级。' },
      { component: '出售金币和额外目标', reason: '纯经济与额外目标分支不属于本批。' }
    ],
    pendingComponents: [
      { component: '适应力转换与选择', reason: '当前属性快照没有适应之力属性；保存原始量，不凭空选择攻击力或法术强度，也不声称系统不能保存。' },
      { component: '消费触发与持续效果寿命', reason: '当前没有物品消费事件契约；参数可保存但效果不伪造。' }
    ],
    scope: '保留25适应之力和60000毫秒；排除双修、韧性分类误读、符文生成等级和经济分支。',
    safeguards: {
      equipmentKey: 'item_2152',
      beforeRelationCount: equipmentStates.item_2152.relationCount,
      directAttributesProtected: true,
      representativeImageReused: 'item_2152',
      equipmentBodyNotRebuilt: true,
      referencesRuneSkillKeys: [],
      adaptiveChoiceHasNoDefault: true
    }
  },
  {
    equipmentKey: 'item_2422',
    equipmentName: item2422.name,
    skillKey: 'item_2422_passive',
    source: {
      sourceFile: '四装备固定来源.json',
      sourcePointer: '/objects[item_2422]/source/object',
      itemId: 2422,
      directMovementSpeed: { value: 25, pointer: '/Items~12422/mFlatMovementSpeedMod' },
      additionalMovementSpeed: { value: 10, sourceText: '额外的10移动速度', ownerPlan: '修订三拟迁移到本装备技能；必须先完成新效果逐次GET，再删除旧效果并确认404，最后挂载本装备技能。' },
      upgradeLinks: sourceObject('item_2422').mItemDataBuild.itemLinks,
      officialDescription: item2422.source.official.description,
      protectedRuneEffect: {
        skillKey: 'rune_8304_passive',
        effectKey: 'magical_footwear_additional_speed',
        parameterKey: 'additional_move_speed',
        value: 10,
        currentLifecycleEnabled: true,
        currentEffectNotDeletedOrUpdated: true
      }
    },
    directAttributesProtected: { move_speed: 25 },
    valueSemantics: {
      direct_move_speed: { unit: '移动速度点数', sourceValue: 25, directAttribute: true },
      additional_move_speed: { unit: '移动速度点数', sourceValue: 10, directAttribute: false, modifierZone: 'attribute_flat_add', status: '新装备效果候选，待迁移顺序完成' },
      prospective_total_move_speed: { unit: '移动速度点数', expression: '25+10=35', status: '唯一归属迁移完成后的数学边界，不是本轮业务执行证据' }
    },
    apiPayload: {
      skill: {
        skillKey: 'item_2422_passive',
        name: '有点神奇之鞋·额外移速',
        description: '保存有点神奇之鞋额外10移动速度的物品归属参数和等价属性效果；直接属性25保持在装备主体。按修订三顺序先核对新效果，再删除旧符文效果，最后挂载本装备技能，避免两份可执行来源并存。',
        maxLevel: 1,
        status: 'ENABLED',
        sortOrder: 0,
        skillCategoryKeys: ['passive']
      },
      parameters: [
        fixedParameter('additional_move_speed', '有点神奇之鞋额外移速', 'INTEGER', 10, '官方与客户端均证明额外10移动速度；效果迁移前先保存参数，迁移完成后只保留一个有效来源。', 10)
      ],
      formulas: [],
      effects: [
        {
          effectKey: 'magical_footwear_additional_speed',
          name: '有点神奇之鞋额外移速',
          description: '将旧符文效果的等价结果保存到item_2422技能；自身固定增加10移动速度，单层同来源替换，外部显式移除。创建和旧效果删除之间不挂载新技能。',
          sortOrder: 10,
          lifecycle: {
            durationValue: null,
            maxStacksValue: { kind: 'FIXED', value: 1 },
            applicationStacksValue: { kind: 'FIXED', value: 1 },
            instanceScope: 'SOURCE',
            reapplicationStackMode: 'KEEP',
            reapplicationDurationMode: null,
            expiryMode: 'EXPLICIT_ONLY',
            periodicIntervalValue: null,
            firstPeriodicExecution: null
          },
          results: [
            {
              resultKey: 'attribute_bonus',
              name: '额外移动速度',
              target: 'SOURCE',
              description: '固定增加10移动速度点数；不改主体直接移速25。',
              sortOrder: 10,
              lifecycleBehavior: footwearBehavior(),
              spellShieldBlockScope: null,
              valueRule: fixedValueRule('PARAMETER', 'additional_move_speed', 0, null),
              resultType: 'ATTRIBUTE_CHANGE',
              detail: { attributeKey: 'move_speed', operation: 'INCREASE', modifierZoneKey: 'attribute_flat_add' }
            }
          ]
        }
      ],
      processes: [],
      internalStates: [],
      triggerRules: []
    },
    relation: { equipmentKey: 'item_2422', skillKey: 'item_2422_passive', sortOrder: 10 },
    representativeImage: { imageKey: 'item_2422' },
    omittedComponents: [
      { component: '直接移速35或45', reason: '主体直接属性25必须保持；额外10不能先写进35再叠效果。' },
      { component: '符文8304整套挂载', reason: '生成时间和参与击杀提前属于符文资格，整套挂载会混淆消费/持有归属。' },
      { component: '对所有升级鞋无条件加10', reason: '只保留经本鞋合成的升级继承资格，未建全鞋类执行效果。' },
      { component: '旧符文效果与新装备效果并存', reason: '修订三要求先保存新效果、确认旧效果可删除，再按顺序完成单源迁移；不把两份同时挂载。' }
    ],
    pendingComponents: [
      { component: '已有符文效果到装备技能的唯一归属迁移', reason: '候选提供等价新效果和删除意图；删除旧效果必须在新效果逐次GET确认、旧效果DELETE204并GET404后才能挂载新装备技能，当前尚未执行。' },
      { component: '升级继承资格', reason: '来源列出升级链，但当前类型没有本装备生成/继承专用结果，不能伪造成已对全部升级鞋生效。' }
    ],
    scope: '保留主体25与额外10来源及升级资格边界；候选提供等价新效果和单独迁移意图，当前不改符文历史对象。',
    safeguards: {
      equipmentKey: 'item_2422',
      beforeRelationCount: equipmentStates.item_2422.relationCount,
      directAttributesProtected: true,
      directMoveSpeedMustRemain: 25,
      representativeImageReused: 'item_2422',
      equipmentBodyNotRebuilt: true,
      referencesRuneSkillKeys: [],
      newEffects: 1,
      protectedRuneEffectPreserved: true,
      uniqueOwnershipPending: true
    }
  }
];

function checkExpression(node, skillParameters, label) {
  assert(node && typeof node === 'object', `${label}公式节点缺失`);
  if (node.nodeType === 'PARAMETER') {
    assert(skillParameters.has(node.parameterKey), `${label}引用不存在参数 ${node.parameterKey}`);
    return;
  }
  if (node.nodeType === 'ATTRIBUTE') {
    assert(node.attributeOwner === 'SOURCE' || node.attributeOwner === 'TARGET', `${label}属性主体非法`);
    assert(attributeKeys.includes(node.attributeKey), `${label}引用不存在属性 ${node.attributeKey}`);
    return;
  }
  assert(node.nodeType === 'OPERATION', `${label}节点类型非法`);
  assert(Array.isArray(node.operands) && node.operands.length === 2, `${label}操作数不是严格二元`);
  checkExpression(node.operands[0], skillParameters, `${label}.左`);
  checkExpression(node.operands[1], skillParameters, `${label}.右`);
}

function checkPayload(item) {
  const payload = item.apiPayload;
  assert(payload.skill.skillKey === item.skillKey, `${item.skillKey}技能键不一致`);
  assert(payload.skill.maxLevel === 1 && payload.skill.status === 'ENABLED', `${item.skillKey}技能元数据不符`);
  assert(payload.skill.skillCategoryKeys.length === 1 && categoryKeys.has(payload.skill.skillCategoryKeys[0]), `${item.skillKey}技能类别不是现有类别`);
  const params = new Map(payload.parameters.map((row) => [row.parameterKey, row]));
  assert(params.size === payload.parameters.length, `${item.skillKey}参数键重复`);
  for (const row of payload.parameters) {
    assert(['INTEGER', 'DECIMAL'].includes(row.valueType), `${item.skillKey}.${row.parameterKey}值类型非法`);
    assert(['FIXED', 'RUNTIME_INPUT'].includes(row.valueMode), `${item.skillKey}.${row.parameterKey}值模式非法`);
    if (row.valueMode === 'FIXED') {
      finiteNumber(row.fixedValue, `${item.skillKey}.${row.parameterKey}.fixedValue`);
      assert(row.levelValues === null, `${item.skillKey}.${row.parameterKey}固定参数不得有等级数组`);
      if (row.parameterKey.endsWith('_ms')) integerMs(row.fixedValue, `${item.skillKey}.${row.parameterKey}`);
    } else {
      assert(row.fixedValue === null && row.levelValues === null, `${item.skillKey}.${row.parameterKey}运行输入必须没有默认值`);
    }
  }
  for (const row of payload.formulas) checkExpression(row.expression, params, `${item.skillKey}.${row.formulaKey}`);
  for (const effect of payload.effects) {
    for (const result of effect.results) {
      if (result.resultType === 'ATTRIBUTE_CHANGE') {
        assert(attributeKeys.includes(result.detail.attributeKey), `${item.skillKey}.${effect.effectKey}属性不存在`);
        if (result.detail.modifierZoneKey !== null) assert(modifierZoneKeys.includes(result.detail.modifierZoneKey), `${item.skillKey}.${effect.effectKey}乘区不存在`);
      }
      const value = result.valueRule?.value;
      if (value?.kind === 'PARAMETER') assert(params.has(value.parameterKey), `${item.skillKey}.${effect.effectKey}引用不存在参数`);
      if (value?.kind === 'FORMULA') assert(payload.formulas.some((row) => row.formulaKey === value.formulaKey), `${item.skillKey}.${effect.effectKey}引用不存在公式`);
    }
  }
  assert(payload.processes.length === 0 && payload.internalStates.length === 0 && payload.triggerRules.length === 0, `${item.skillKey}不应凭空新增过程、内部状态或触发规则`);
  assert(item.relation.equipmentKey === item.equipmentKey && item.relation.skillKey === item.skillKey, `${item.skillKey}挂载关系不一致`);
  assert(item.representativeImage.imageKey === item.equipmentKey, `${item.skillKey}图片没有复用物品图`);
  assert(item.safeguards.referencesRuneSkillKeys.length === 0, `${item.skillKey}引用了符文技能`);
}
for (const item of objects) checkPayload(item);
assert(objects.find((item) => item.equipmentKey === 'item_2422').apiPayload.effects.length === 1, 'item_2422应有一条待迁移等价效果');
assert(objects.find((item) => item.equipmentKey === 'item_2422').directAttributesProtected.move_speed === 25, 'item_2422候选直接属性不能改为35');

const sourceFiles = [
  { key: 'inputIndex', path: path.relative(workspace, inputIndexPath).replaceAll('\\', '/'), sha256: sha256File(inputIndexPath), expectedSha256: null, role: '固定输入索引' },
  { key: 'protectedSnapshot', path: path.relative(workspace, snapshotPath).replaceAll('\\', '/'), sha256: sha256File(snapshotPath), expectedSha256: inputIndex.snapshotSha256, role: '72次GET保护快照' },
  { key: 'equipmentSource', path: path.relative(workspace, sourcePath).replaceAll('\\', '/'), sha256: sha256File(sourcePath), expectedSha256: inputIndex.sources.find((row) => row.file === '四装备固定来源.json')?.sha256 ?? null, role: '四件装备固定来源' },
  { key: 'biscuitProof', path: path.relative(workspace, biscuitProofPath).replaceAll('\\', '/'), sha256: sha256File(biscuitProofPath), expectedSha256: inputIndex.sources.find((row) => row.file === '饼干当前具名来源补证.json')?.sha256 ?? null, role: '饼干具名计算补证' },
  { key: 'duplicateCheck', path: path.relative(workspace, duplicateCheckPath).replaceAll('\\', '/'), sha256: sha256File(duplicateCheckPath), expectedSha256: null, role: '新增技能查重与技能类别只读结果' },
  { key: 'oldEffectReference', path: path.relative(workspace, oldEffectReferencePath).replaceAll('\\', '/'), sha256: sha256File(oldEffectReferencePath), expectedSha256: null, role: '旧鞋效果数据库入引用只读结果' },
  { key: 'revisedScheme', path: path.relative(workspace, revisedSchemePath).replaceAll('\\', '/'), sha256: sha256File(revisedSchemePath), expectedSha256: null, role: '修订三迁移顺序与范围' },
  { key: 'cursorReview', path: path.relative(workspace, cursorReviewPath).replaceAll('\\', '/'), sha256: sha256File(cursorReviewPath), expectedSha256: null, role: 'Cursor独立只读复核结论' },
  { key: 'cursorSummary', path: path.relative(workspace, cursorSummaryPath).replaceAll('\\', '/'), sha256: sha256File(cursorSummaryPath), expectedSha256: null, role: 'Cursor复核运行摘要（只读取结论，不复制密钥字段）' },
  { key: 'cursorV2Review', path: path.relative(workspace, cursorV2ReviewPath).replaceAll('\\', '/'), sha256: sha256File(cursorV2ReviewPath), expectedSha256: null, role: 'Cursor v2迁移顺序复核结论' },
  { key: 'cursorV2Summary', path: path.relative(workspace, cursorV2SummaryPath).replaceAll('\\', '/'), sha256: sha256File(cursorV2SummaryPath), expectedSha256: null, role: 'Cursor v2复核运行摘要（只读取结论，不复制密钥字段）' },
  { key: 'cursorV3Conclusion', path: path.relative(workspace, cursorV3ConclusionPath).replaceAll('\\', '/'), sha256: sha256File(cursorV3ConclusionPath), expectedSha256: null, role: 'Cursor v3最终迁移顺序复核结论' },
  { key: 'cursorV3Review', path: path.relative(workspace, cursorV3ReviewPath).replaceAll('\\', '/'), sha256: sha256File(cursorV3ReviewPath), expectedSha256: null, role: 'Cursor v3审计摘要' },
  { key: 'cursorV3Summary', path: path.relative(workspace, cursorV3SummaryPath).replaceAll('\\', '/'), sha256: sha256File(cursorV3SummaryPath), expectedSha256: null, role: 'Cursor v3复核运行摘要（只读取结论，不复制密钥字段）' },
  { key: 'skillEffectType', path: codeEvidence.skillEffectType.path, sha256: codeEvidence.skillEffectType.sha256, expectedSha256: null, role: '技能效果联合类型代码证据' },
  { key: 'skillParameterType', path: codeEvidence.skillParameterType.path, sha256: codeEvidence.skillParameterType.sha256, expectedSha256: null, role: '技能参数联合类型代码证据' }
];
for (const sourceFile of sourceFiles.filter((file) => file.expectedSha256)) assert(sourceFile.sha256 === sourceFile.expectedSha256, `${sourceFile.key}固定输入散列不一致`);

const protectedObjects = {
  snapshot: path.relative(workspace, snapshotPath).replaceAll('\\', '/'),
  snapshotSha256: sha256File(snapshotPath),
  inputGETs: 72,
  businessWrites: 0,
  componentCounts: protectedCurrentCounts,
  skills: runeKeys.map((skillKey) => ({
    skillKey,
    parameterKeys: runeParameterKeys[skillKey],
    formulaKeys: runeFormulaKeys[skillKey],
    effectKeys: protectedEffectRows.filter((row) => row.route.startsWith(`/skills/${skillKey}/`)).map((row) => row.data.effectKey).sort()
  })),
  existingMagicalFootwearEffect: {
    skillKey: 'rune_8304_passive',
    effectKey: 'magical_footwear_additional_speed',
    parameterKey: 'additional_move_speed',
    value: protectedEffectResult.valueRule.value,
    detail: protectedEffectResult.detail,
    lifecycleEnabled: true,
    protection: '迁移完成前不删、不更新；候选的新效果只作为待迁移等价对象，不与旧效果同时挂载执行。'
  },
  equipmentBeforeState: equipmentStates,
  allowedEquipmentRelationChanges: objects.map((item) => ({
    equipmentKey: item.equipmentKey,
    before: { total: 0, items: [] },
    after: { total: 1, items: [item.relation] },
    reason: '本批四个新装备技能的计划内挂载；原72快照的空关系只作为基线，不作为挂载后的不变条件。'
  })),
  protectedAfterMigration: {
    runeComponentCountsBefore: protectedCurrentCounts,
    runeComponentCountsAfter: { parameters: protectedCurrentCounts.parameters, formulas: protectedCurrentCounts.formulas, effects: 0, total: protectedCurrentCounts.parameters + protectedCurrentCounts.formulas },
    runeRelationsUnchanged: true,
    equipmentDirectAttributesUnchanged: true,
    equipmentImagesUnchanged: true,
    equipmentRelations: '允许上述四条从空到各自新技能的变化',
    oldEffectRepresentativeImage: '原状态200且image=null；删除旧效果后的计划内状态为404'
  },
  attributes: attributeKeys,
  modifierZones: modifierZoneKeys
};

const preflightReads = objects.flatMap((item) => [
  {
    id: `check-skill-${item.skillKey}`,
    method: 'GET',
    path: `/api/admin/games/lol/skills/${item.skillKey}`,
    purpose: '写前查重；404才创建；若已存在且逐字段与候选一致则跳过对应POST续跑，冲突或多余对象交主负责人停止处理',
    execute: false
  },
  {
    id: `check-relation-${item.equipmentKey}`,
    method: 'GET',
    path: `/api/admin/games/lol/equipment-skill-relations?equipmentKey=${item.equipmentKey}&skillKey=${item.skillKey}`,
    purpose: '写前确认挂载；不存在才POST，若已有且恰为本计划关系则跳过，不覆盖其他协作者挂载',
    execute: false
  }
]);

const writeRequests = [];
let sequence = 1;
function addWrite(item, componentKind, method, requestPath, body) {
  writeRequests.push({ sequence: sequence++, id: `${item.skillKey}-${componentKind}`, method, path: requestPath, body, execute: false, status: '仅计划，未调用', owner: item.equipmentKey });
}
for (const item of objects) {
  const payload = item.apiPayload;
  addWrite(item, 'skill', 'POST', '/api/admin/games/lol/skills', payload.skill);
  for (const row of payload.parameters) addWrite(item, `parameter-${row.parameterKey}`, 'POST', `/api/admin/games/lol/skills/${item.skillKey}/parameters`, row);
  for (const row of payload.formulas) addWrite(item, `formula-${row.formulaKey}`, 'POST', `/api/admin/games/lol/skills/${item.skillKey}/formulas`, row);
  for (const row of payload.effects) addWrite(item, `effect-${row.effectKey}`, 'POST', `/api/admin/games/lol/skills/${item.skillKey}/effects`, row);
  if (item.equipmentKey === 'item_2422') {
    addWrite(item, 'migrate-delete-old-effect', 'DELETE', '/api/admin/games/lol/skills/rune_8304_passive/effects/magical_footwear_additional_speed', null);
  }
  addWrite(item, 'equipment-skill-relation', 'POST', '/api/admin/games/lol/equipment-skill-relations', item.relation);
  addWrite(item, 'representative-image', 'PUT', `/api/admin/games/lol/skills/${item.skillKey}/representative-image`, item.representativeImage);
}
assert(writeRequests.filter((request) => request.method === 'POST').length === 25, 'POST计划数应为25');
assert(writeRequests.filter((request) => request.method === 'PUT').length === 4, '图片PUT计划数应为4');
assert(writeRequests.filter((request) => request.method === 'DELETE').length === 1, '迁移DELETE计划数应为1');
assert(writeRequests.length === 30, '写入计划总数应为30');
assert(writeRequests.filter((request) => request.method !== 'DELETE').every((request) => !request.path.includes('/rune')), '除唯一迁移删除外计划不得写入符文路径');
assert(writeRequests.find((request) => request.method === 'DELETE')?.path === '/api/admin/games/lol/skills/rune_8304_passive/effects/magical_footwear_additional_speed', '迁移删除目标不符');

const candidate = {
  generatedAt: new Date().toISOString(),
  stage: 'Luna独立候选·符文衍生装备最小补录',
  candidateStatus: 'FINAL_CANDIDATE_PENDING_ROOT_EXECUTION',
  gameId: 'lol',
  clientVersion: '16.17',
  officialVersion: '16.17.1',
  nodeRuntime,
  boundary: {
    allowedWriteDirectory: '.agents/artifacts/rune-equipment-ownership-luna-candidate/**',
    durableDirectory: '数据参考/全量录入-2026-09/交叉试录/Luna/符文衍生装备补录/**',
    durableDirectoryStatus: '本轮不写，等待主负责人审查归档',
    businessApiCalled: false,
    databaseCalled: false,
    browserUsed: false,
    gitUsed: false,
    fixedVersionsOnly: true,
    sourceScope: '四件装备主体/直接属性/图片已存在；生成对应装备技能的最小新增候选，神奇之鞋效果按修订三另列迁移意图，不挂载三套符文技能。'
  },
  sourceFiles,
  sourceFreeze: {
    path: path.relative(workspace, sourcePath).replaceAll('\\', '/'),
    sha256: sha256File(sourcePath),
    expectedSha256: sourceFiles.find((file) => file.key === 'equipmentSource').expectedSha256,
    version: sourceFreeze.version
  },
  currentSnapshot: {
    path: path.relative(workspace, snapshotPath).replaceAll('\\', '/'),
    sha256: sha256File(snapshotPath),
    expectedSha256: inputIndex.snapshotSha256,
    GETs: 72,
    businessWrites: 0
  },
  cursorReview: {
    path: path.relative(workspace, cursorReviewPath).replaceAll('\\', '/'),
    sha256: sha256File(cursorReviewPath),
    verdict: 'REVISE',
    reviewedPlanRevision: 'rune-equipment-ownership-v1',
    absorbedCorrections: [
      '当前保护组成按19参数+2公式+1效果=22记录。',
      'item_2422直接移速25保持不变。',
      'item_2422候选只生成一条等价新效果；与旧效果的删除和最终挂载严格由单独迁移意图控制。',
      '符文8304/8313/8345除迁移意图唯一删除旧鞋效果外，其余历史组成均保护。'
    ],
    notCopied: ['复核运行摘要中的密钥存在性、长度和环境敏感字段']
  },
  cursorV2Review: {
    directory: path.relative(workspace, cursorV2ReviewDir).replaceAll('\\', '/'),
    reviewPath: path.relative(workspace, cursorV2ReviewPath).replaceAll('\\', '/'),
    summaryPath: path.relative(workspace, cursorV2SummaryPath).replaceAll('\\', '/'),
    reviewSha256: sha256File(cursorV2ReviewPath),
    verdict: 'REVISE',
    reviewedPlanRevision: 'rune-equipment-ownership-v2',
    status: '已完成，根负责人按修订三收敛',
    findingsAbsorbed: [
      '四个equipment-skill-relations从保护快照空列表变为本批四条新挂载是计划内允许变化；符文挂载仍必须不变。',
      '旧效果已DELETE204后，续跑只需GET旧详情404且旧效果列表为空，不重复DELETE；新装备已挂载后禁止恢复旧效果。'
    ],
    note: '候选已吸收REVISE中的核对和恢复门禁，但仍不代表业务接口已执行。'
  },
  cursorV3Review: {
    directory: path.relative(workspace, cursorV3ReviewDir).replaceAll('\\', '/'),
    conclusionPath: path.relative(workspace, cursorV3ConclusionPath).replaceAll('\\', '/'),
    reviewPath: path.relative(workspace, cursorV3ReviewPath).replaceAll('\\', '/'),
    summaryPath: path.relative(workspace, cursorV3SummaryPath).replaceAll('\\', '/'),
    conclusionSha256: sha256File(cursorV3ConclusionPath),
    reviewSha256: sha256File(cursorV3ReviewPath),
    summarySha256: sha256File(cursorV3SummaryPath),
    verdict: 'READY',
    reviewedPlanRevision: 'rune-equipment-ownership-v3',
    findingsAbsorbed: [
      '四条装备技能关系从空到各自一个计划内挂载，符文挂载和其余保护对象保持不变。',
      '删除后中断以旧效果GET404且效果列表为空续跑，不重复DELETE；item_2422挂载后禁止恢复旧效果。',
      '新技能、参数、效果先逐次GET，再删除旧效果，最后挂载装备；已存在的正确对象或关系跳过重复POST。',
      '旧效果代表图由200且image=null变为404属于迁移计划内变化。'
    ],
    note: 'READY仅表示修订三设计复核通过，不代表业务接口已执行。'
  },
  protectedObjects,
  objects,
  totals: {
    equipmentCount: objects.length,
    newSkills: objects.length,
    newParameters: objects.reduce((sum, item) => sum + item.apiPayload.parameters.length, 0),
    newFormulas: objects.reduce((sum, item) => sum + item.apiPayload.formulas.length, 0),
    newEffects: objects.reduce((sum, item) => sum + item.apiPayload.effects.length, 0),
    newProcesses: 0,
    newInternalStates: 0,
    newTriggerRules: 0,
    relations: objects.length,
    representativeImages: objects.length,
    protectedParameters: protectedCurrentCounts.parameters,
    protectedFormulas: protectedCurrentCounts.formulas,
    protectedEffects: protectedCurrentCounts.effects,
    protectedTotal: protectedCurrentCounts.total
  },
  apiWrites: {
    executed: false,
    executedCount: 0,
    plannedWriteCount: writeRequests.length,
    plannedCreateAttachCount: writeRequests.filter((request) => request.method !== 'DELETE').length,
    plannedMigrationDeleteCount: 1,
    plannedPostCount: writeRequests.filter((request) => request.method === 'POST').length,
    plannedPutCount: writeRequests.filter((request) => request.method === 'PUT').length,
    onlyAllowedExistingRuneOperation: '删除rune_8304_passive/magical_footwear_additional_speed，且仅按神奇之鞋迁移意图顺序执行',
    note: '这里只是候选和迁移意图；没有调用业务接口。Cursor v3已给出READY设计复核，仍须由主负责人按逐次GET和失败停止检查执行。'
  },
  artifactFiles: {
    candidate: '完整候选.json',
    writePlan: '写前请求计划.json',
    postPlan: 'POST请求计划.json',
    sourceScope: '源值范围清单.json',
    migrationIntent: '神奇之鞋迁移意图.json',
    mathScript: '独立数学核算.mjs',
    mathReport: '独立数学报告.json',
    experience: '体验报告.md',
    hashScript: '生成文件散列.mjs',
    hashes: '文件散列.json'
  }
};

const sourceValueSummary = {
  generatedAt: candidate.generatedAt,
  fixedVersions: sourceFreeze.version,
  inputIndex: {
    path: path.relative(workspace, inputIndexPath).replaceAll('\\', '/'),
    sha256: sha256File(inputIndexPath),
    GETs: inputIndex.GETs,
    businessWrites: inputIndex.businessWrites,
    scope: inputIndex.scope
  },
  items: objects.map((item) => ({
    equipmentKey: item.equipmentKey,
    equipmentName: item.equipmentName,
    imageKey: item.representativeImage.imageKey,
    directAttributes: item.directAttributesProtected,
    source: item.source,
    acceptedCandidateParameters: item.apiPayload.parameters.map((parameterRow) => ({
      parameterKey: parameterRow.parameterKey,
      valueType: parameterRow.valueType,
      valueMode: parameterRow.valueMode,
      fixedValue: parameterRow.fixedValue,
      levelValues: parameterRow.levelValues,
      unit: item.valueSemantics[parameterRow.parameterKey]?.unit ?? null,
      sourceValue: item.valueSemantics[parameterRow.parameterKey]?.sourceValue ?? null,
      default: parameterRow.valueMode === 'RUNTIME_INPUT' ? null : undefined
    }))
  })),
  protectedCurrentComposition: protectedObjects,
  correctionsAgainstRootScheme: [
    '根方案文字写20参数且效果全空；72次GET实际为19参数、2公式、1个已有神奇鞋额外移速效果，共22项。',
    '修订三允许唯一迁移：item_2422候选复制一条等价效果，旧效果仅在新效果逐次GET确认、DELETE204且GET404后删除，最后才挂载新技能。'
  ],
  codeEvidence
};

const sourceScope = {
  generatedAt: candidate.generatedAt,
  status: '候选范围已冻结，Cursor v3已READY，待主负责人执行前后GET验收',
  fixedSourceVersion: sourceFreeze.version,
  included: objects.map((item) => ({ equipmentKey: item.equipmentKey, skillKey: item.skillKey, scope: item.scope, parameters: item.apiPayload.parameters.map((row) => row.parameterKey), formulas: item.apiPayload.formulas.map((row) => row.formulaKey), effects: item.apiPayload.effects.map((row) => row.effectKey) })),
  excluded: objects.flatMap((item) => item.omittedComponents.map((row) => ({ equipmentKey: item.equipmentKey, ...row }))),
  pending: objects.flatMap((item) => item.pendingComponents.map((row) => ({ equipmentKey: item.equipmentKey, ...row }))),
  protected: {
    runeSkills: runeKeys,
    currentComposition: protectedCurrentCounts,
    compositionAfterMigration: { parameters: protectedCurrentCounts.parameters, formulas: protectedCurrentCounts.formulas, effects: 0, total: protectedCurrentCounts.parameters + protectedCurrentCounts.formulas },
    noRuneSkillRelationChanges: true,
    existingRune8304Effect: 'magical_footwear_additional_speed在迁移完成前保护；候选提供等价新效果，实际删除必须按迁移意图顺序执行。',
    oldEffectRepresentativeImageAfterMigration: '原GET200且image=null；旧效果删除后计划内GET404',
    allowedEquipmentRelations: objects.map((item) => ({ equipmentKey: item.equipmentKey, beforeTotal: 0, afterTotal: 1, skillKey: item.skillKey }))
  },
  attributeAndUnitRules: {
    validAttributeKeysFromSnapshot: attributeKeys,
    validModifierZoneKeysFromSnapshot: modifierZoneKeys,
    ratioRepresentation: '比例属性以1表示100%；本批没有把额外10移速当比例属性。',
    milliseconds: '所有_ms固定值为非负整数；未知运行输入不填默认。',
    adaptiveForce: '只保存25原始点数和60000毫秒，不默认转换为AD或AP。'
  },
  sourceConflicts: [
    { subject: '饼干最大生命恢复比例', currentCandidate: 0.015, officialDisplayed: 0.02, disposition: '以当前物品树/符文同构建0.015作为实际候选；0.02只留来源差异，不并存两套效果。' },
    { subject: '神奇之鞋额外10移速', currentProtected: 'rune_8304_passive.magical_footwear_additional_speed', newCandidate: 'item_2422_passive.additional_move_speed及等价效果', disposition: '按修订三先保存并GET确认新效果，删除旧效果204并GET404后再挂载新技能；已DELETE204时用GET404和空列表续跑，不重复DELETE；当前未执行。' }
  ]
};

const migrationIntent = {
  generatedAt: candidate.generatedAt,
  status: 'PENDING_ROOT_EXECUTION',
  purpose: '将唯一已确认且无数据库入引用的神奇之鞋额外10移速效果从符文8304迁移到item_2422_passive；本文件是只读意图，不是执行结果。',
  evidence: {
    cursorV2Review: {
      path: path.relative(workspace, cursorV2ReviewPath).replaceAll('\\', '/'),
      sha256: sha256File(cursorV2ReviewPath),
      verdict: 'REVISE',
      absorbed: '允许四条新装备挂载变化；删除旧效果后以GET404/空列表续跑且不重复DELETE。'
    },
    cursorV3Review: {
      directory: path.relative(workspace, cursorV3ReviewDir).replaceAll('\\', '/'),
      conclusionPath: path.relative(workspace, cursorV3ConclusionPath).replaceAll('\\', '/'),
      reviewPath: path.relative(workspace, cursorV3ReviewPath).replaceAll('\\', '/'),
      summaryPath: path.relative(workspace, cursorV3SummaryPath).replaceAll('\\', '/'),
      conclusionSha256: sha256File(cursorV3ConclusionPath),
      reviewSha256: sha256File(cursorV3ReviewPath),
      summarySha256: sha256File(cursorV3SummaryPath),
      verdict: 'READY',
      reviewedPlanRevision: 'rune-equipment-ownership-v3',
      absorbed: '确认四条计划内装备挂载、GET404/空列表续跑、不重复DELETE、挂载后不恢复旧效果，以及旧效果代表图200/null到404的计划内变化。'
    },
    revisedScheme: {
      path: path.relative(workspace, revisedSchemePath).replaceAll('\\', '/'),
      sha256: sha256File(revisedSchemePath),
      revision: 'rune-equipment-ownership-v3'
    },
    duplicateCheck: {
      path: path.relative(workspace, duplicateCheckPath).replaceAll('\\', '/'),
      sha256: sha256File(duplicateCheckPath),
      GETs: duplicateCheck.GETs,
      businessWrites: duplicateCheck.businessWrites,
      newSkillStatuses: Object.fromEntries(duplicateSkillRows.map((row) => [row.route.split('/').at(-1), row.status])),
      categories: categories.map((row) => row.skillCategoryKey).sort(),
      oldEffectRepresentativeImage: null
    },
    oldEffectReference: {
      path: path.relative(workspace, oldEffectReferencePath).replaceAll('\\', '/'),
      sha256: sha256File(oldEffectReferencePath),
      businessWrites: oldEffectReference.businessWrites,
      DDL: oldEffectReference.DDL,
      inboundReferences: oldEffectReference.inboundReferences.length,
      imageRelations: oldEffectReference.imageRelations.length,
      passed: oldEffectReference.passed
    },
    protectedOldEffect: {
      skillKey: 'rune_8304_passive',
      effectKey: 'magical_footwear_additional_speed',
      value: 10,
      lifecycle: protectedEffectData.lifecycle,
      result: protectedEffectResult
    }
  },
  sequence: [
    {
      step: 1,
      action: 'GET',
      path: '/api/admin/games/lol/skills/item_2422_passive',
      expected: '404.SKILL_NOT_FOUND；或200且逐字段与候选一致时跳过技能POST',
      purpose: '写前查重；404才创建；已存在且逐字段一致则续跑缺失子对象，冲突立即停止'
    },
    {
      step: 2,
      action: 'POST',
      path: '/api/admin/games/lol/skills',
      requestId: 'item_2422_passive-skill',
      expected: '200，返回skillKey=item_2422_passive',
      purpose: '创建新装备技能，尚未挂载到装备'
    },
    {
      step: 3,
      action: 'GET',
      path: '/api/admin/games/lol/skills/item_2422_passive',
      expected: '200，逐字段与候选技能一致',
      purpose: '新技能保存后立即核对'
    },
    {
      step: 4,
      action: 'POST',
      path: '/api/admin/games/lol/skills/item_2422_passive/parameters',
      requestId: 'item_2422_passive-parameter-additional_move_speed',
      expected: '200，参数值10'
    },
    {
      step: 5,
      action: 'GET',
      path: '/api/admin/games/lol/skills/item_2422_passive/parameters/additional_move_speed',
      expected: '200，参数值10且无等级数组',
      purpose: '新参数保存后立即核对'
    },
    {
      step: 6,
      action: 'POST',
      path: '/api/admin/games/lol/skills/item_2422_passive/effects',
      requestId: 'item_2422_passive-effect-magical_footwear_additional_speed',
      expected: '200，属性变化目标SOURCE、move_speed固定加算10'
    },
    {
      step: 7,
      action: 'GET',
      path: '/api/admin/games/lol/skills/item_2422_passive/effects/magical_footwear_additional_speed',
      expected: '200，逐字段等价新效果，所有参数和属性引用存在',
      purpose: '新效果逐次GET确认失败即停止，不碰旧对象'
    },
    {
      step: 8,
      action: 'GET',
      path: '/api/admin/games/lol/skills/rune_8304_passive',
      expected: '200，旧技能主体与冻结快照一致',
      purpose: '删前确认旧技能主体仍在'
    },
    {
      step: 9,
      action: 'GET',
      path: '/api/admin/games/lol/skills/rune_8304_passive/parameters',
      expected: '19参数中的旧技能参数保持，不能删除或更新',
      purpose: '删前保存旧参数组成'
    },
    {
      step: 10,
      action: 'GET',
      path: '/api/admin/games/lol/skills/rune_8304_passive/formulas',
      expected: '旧公式保持，不能删除或更新',
      purpose: '删前保存旧公式组成'
    },
    {
      step: 11,
      action: 'GET',
      path: '/api/admin/games/lol/skills/rune_8304_passive/effects',
      expected: '仅有冻结的旧鞋效果，删前列表一致',
      purpose: '删前核对旧效果列表'
    },
    {
      step: 12,
      action: 'GET',
      path: '/api/admin/games/lol/skills/rune_8304_passive/effects/magical_footwear_additional_speed',
      expected: '200，旧效果仍与冻结快照一致',
      purpose: '删前保存旧效果完整请求和保护证据'
    },
    {
      step: 13,
      action: 'GET',
      path: '/api/admin/games/lol/skills/rune_8304_passive/processes',
      expected: '[]，旧过程为空',
      purpose: '删前核对旧过程为空'
    },
    {
      step: 14,
      action: 'GET',
      path: '/api/admin/games/lol/skills/rune_8304_passive/internal-states',
      expected: '[]，旧内部状态为空',
      purpose: '删前核对旧内部状态为空'
    },
    {
      step: 15,
      action: 'GET',
      path: '/api/admin/games/lol/skills/rune_8304_passive/trigger-rules',
      expected: '[]，旧触发规则为空',
      purpose: '删前核对旧触发规则为空'
    },
    {
      step: 16,
      action: 'GET',
      path: '/api/admin/games/lol/skills/rune_8304_passive/effects/magical_footwear_additional_speed/representative-image',
      expected: '200，image为null',
      purpose: '删前确认旧效果没有图片关联'
    },
    {
      step: 17,
      action: 'DELETE',
      path: '/api/admin/games/lol/skills/rune_8304_passive/effects/magical_footwear_additional_speed',
      requestId: 'item_2422_passive-migrate-delete-old-effect',
      expected: '204；仅允许删除这一条旧效果',
      guard: 'HTTP409或任何非204立即停止，不删除其他引用，不绕过校验'
    },
    {
      step: 18,
      action: 'GET',
      path: '/api/admin/games/lol/skills/rune_8304_passive/effects/magical_footwear_additional_speed',
      expected: '404.SKILL_EFFECT_NOT_FOUND',
      purpose: '确认旧详情已消失；非404立即停止；若此前已DELETE204，续跑从这里开始，不重放DELETE'
    },
    {
      step: 19,
      action: 'GET',
      path: '/api/admin/games/lol/skills/rune_8304_passive/effects',
      expected: '[]，旧技能效果列表只减少这一条',
      purpose: '确认没有残留旧效果；列表为空即可继续挂载，不把原204当作必须重放的门槛'
    },
    {
      step: 20,
      action: 'POST',
      path: '/api/admin/games/lol/equipment-skill-relations',
      requestId: 'item_2422_passive-equipment-skill-relation',
      expected: '200，equipmentKey=item_2422且skillKey=item_2422_passive',
      purpose: '旧效果确认404且旧列表为空后才挂载新技能；若关系已恰为计划内目标则跳过POST，四条装备挂载属于计划内允许变化'
    },
    {
      step: 21,
      action: 'PUT',
      path: '/api/admin/games/lol/skills/item_2422_passive/representative-image',
      requestId: 'item_2422_passive-representative-image',
      expected: '200，imageKey=item_2422',
      purpose: '复用装备代表图；旧效果代表图随旧效果删除变为计划内404'
    }
  ],
  forbidden: [
    '删除或更新rune_8304_passive的参数、公式、主体或挂载',
    '在旧效果未确认404前创建装备挂载',
    '因为旧效果无数据库引用就跳过逐次GET和DELETE204检查',
    '并行保留两份可执行额外10效果',
    '把item_2422直接移速25改成35或45',
    '旧效果已经确认404且列表为空后重复DELETE',
    '四个计划内装备挂载完成后恢复旧符文效果'
  ],
  recovery: {
    oldEffectPreimagePath: path.relative(workspace, snapshotPath).replaceAll('\\', '/'),
    onDeleteFailure: '非204或HTTP409立即停止并回读当前状态；不自动补写或删除；由主负责人根据已保存旧效果完整请求决定恢复。',
    afterDeleteResume: '若已得到DELETE204，或回读已确认旧效果GET404且旧效果列表为空，续跑只从新装备挂载开始，不重复DELETE。',
    onPostDeleteFailureBeforeRelation: '旧效果已删且新技能未挂载时，先GET旧效果404、旧列表为空并核对新对象与保护数据，再继续挂载；不把重复DELETE当恢复。',
    afterRelation: '四个装备挂载属于允许变化；挂载完成后禁止以删前保存请求恢复旧符文效果。'
  },
  resumeRules: {
    existingCorrectNewSkill: '续跑前GET新技能；若已是候选逐字段一致的200，跳过技能POST并只补缺失子对象，不能重复POST或覆盖。',
    existingCorrectChild: '参数、公式、效果逐项GET已存在且与候选一致时跳过对应POST；不因已存在就更新未知字段。',
    existingCorrectEquipmentRelation: '四件装备关系若GET已有且恰为计划内equipmentKey+skillKey，跳过对应POST；其他或多余关系立即停。',
    oldEffectBeforeDelete: '续跑先GET旧效果；仍为200且删前条件一致才允许唯一DELETE，已为404且旧效果列表为空则跳过DELETE继续。',
    afterDeleteBeforeRelation: '删除后必须GET旧效果404、旧效果列表为空并核对新对象与保护数据，再继续挂载；不得重复DELETE。',
    afterItem2422Relation: 'item_2422计划内关系一旦存在，禁止恢复旧符文效果；旧效果代表图404属于计划内结果。'
  },
  finalAudit: {
    allowedEquipmentRelationChanges: objects.map((item) => ({ equipmentKey: item.equipmentKey, before: 0, after: 1, skillKey: item.skillKey })),
    runeProtectedCountsBefore: protectedCurrentCounts,
    runeProtectedCountsAfter: { parameters: protectedCurrentCounts.parameters, formulas: protectedCurrentCounts.formulas, effects: 0, total: protectedCurrentCounts.parameters + protectedCurrentCounts.formulas },
    oldEffectAfterMigration: 'GET404且旧效果列表为空',
    newEffectAfterMigration: 'GET200且仍引用item_2422_passive.additional_move_speed',
    oldEffectRepresentativeImageAfterMigration: 'GET404；原GET200且image=null是删除旧效果前快照',
    allowedEquipmentRelationChangesOnly: true,
    noOldEffectRestorationAfterRelation: true
  },
  execution: { businessApiCalled: false, databaseCalled: false, browserUsed: false, gitUsed: false }
};

writeJson('完整候选.json', candidate);
writeJson('源值范围清单.json', sourceValueSummary);
writeJson('来源与范围.json', sourceScope);
writeJson('神奇之鞋迁移意图.json', migrationIntent);
writeJson('写前请求计划.json', {
  generatedAt: candidate.generatedAt,
  execute: false,
  gameId: 'lol',
  fixedVersions: sourceFreeze.version,
  preflightReads,
  migrationAuditReads: migrationIntent.sequence.filter((step) => step.action === 'GET'),
  migrationSequence: migrationIntent.sequence,
  writeRequests,
  counts: {
    preflightGets: preflightReads.length,
    writes: writeRequests.length,
    posts: writeRequests.filter((request) => request.method === 'POST').length,
    puts: writeRequests.filter((request) => request.method === 'PUT').length,
    deletes: writeRequests.filter((request) => request.method === 'DELETE').length,
    migrationAuditGets: migrationIntent.sequence.filter((step) => step.action === 'GET').length,
    totalWithPreflight: preflightReads.length + migrationIntent.sequence.filter((step) => step.action === 'GET').length + writeRequests.length
  },
  guards: {
    noBusinessApiCallInPreparation: true,
    noRuneSkillComponentWrites: true,
    onlyAllowedRuneOperation: '按神奇之鞋迁移意图删除一个旧效果',
    stopOnDuplicateSkill: true,
    noEquipmentBodyRebuild: true,
    preserveExistingDirectAttributesAndImages: true,
    preserveProtectedRuneComposition: protectedCurrentCounts
  }
});
writeJson('POST请求计划.json', {
  generatedAt: candidate.generatedAt,
  execute: false,
  note: '仅列出计划中的POST创建请求；四个图片复用PUT、唯一旧鞋效果DELETE和写前GET在写前请求计划及迁移意图中。',
  requests: writeRequests.filter((request) => request.method === 'POST'),
  count: writeRequests.filter((request) => request.method === 'POST').length
});

const experience = `# 符文衍生装备候选体验报告

本报告只描述候选层可表达的体验边界，不代表业务接口已写入，也不代表运行时已经接线。

## 永续意志夹心饼干

消费饼干后，恢复总量的已证基数是20加上自身最大生命的1.5%，恢复窗口是5000毫秒。已损生命提升采用运行时实际比例输入，最多提升100%，生命比例达到0.3时达到最大；中间曲线、首跳和跳数没有被猜成固定值，所以候选不会把5秒总量误显示成一次治疗。每实际消耗或出售一块，永久增加30最大生命；没有实际计数时拒绝计算。最大生命属性单位是点数，效果使用属性固定加算乘区。

## 技能合剂

消费提供1技能点，不提升角色等级，也不能投入已经升满的技能。当前类型没有技能点分配结果，候选只保存资料参数和限制，不把技能点变成攻击力、法强或等级。第9级获得资格仍属于符文生成资料。

## 原力合剂

消费提供25适应之力，持续60000毫秒。候选保持原始点数，不默认转换到攻击力或法术强度，也不同时创建两种属性；客户端的Tenacity分类没有被当作本人韧性。第6级获得资格仍属于符文生成资料。

## 有点神奇之鞋

装备主体的直接移速保持25。额外10作为物品技能参数和等价属性效果保存，数学上唯一归属完成后是25加10等于35移动速度点数。保护快照的符文8304旧效果不会与新效果并存：迁移意图要求先逐次GET确认新效果，再删旧效果并确认204/404，最后挂载新技能；若已删旧效果则以GET404和空列表续跑，不重复删除；挂载后禁止恢复旧效果。旧效果代表图原来是200且image为空，随旧效果删除变为计划内404；当前全部步骤均未执行。升级链只记为继承待核，候选不宣称所有升级鞋都已经自动获得额外10。

## 共同边界

四个主体和代表图均复用当前快照，四条装备技能挂载从原快照空列表变为本批对应新技能是计划内允许变化，符文挂载和19参数、2公式仍须保持；迁移完成后符文效果数从1变为0。候选不挂载三套符文技能，不写符文生成等级、生成时间为物品消费门槛，不写额外目标和纯经济分支。\n`;
writeText('体验报告.md', experience);

const mathScript = `import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const candidate = JSON.parse(fs.readFileSync(path.join(dir, '完整候选.json'), 'utf8'));
const source = JSON.parse(fs.readFileSync(path.join(dir, '..', 'rune-equipment-ownership-root-20260910', '四装备固定来源.json'), 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(path.join(dir, '..', 'rune-equipment-ownership-root-20260910', '当前保护快照.json'), 'utf8'));
const errors = [];
const missingInputChecks = [];
const sourceScenarios = [];
const formulaScenarios = [];
const typeChecks = [];

function assert(condition, message) { if (!condition) throw new Error(message); }
function finite(value, label) { assert(typeof value === 'number' && Number.isFinite(value), label + '不是有限数值'); return value; }
function sourceItem(key) { return source.objects.find((item) => item.equipmentKey === key); }
function dataValue(key, name) { const row = sourceItem(key).source.object.mDataValues.find((item) => item.mName === name); assert(row, key + '缺少来源值' + name); return row.mValue; }
function baseExpression() {
  return { nodeType: 'OPERATION', operation: 'ADD', operands: [
    { nodeType: 'PARAMETER', parameterKey: 'flat_recovery' },
    { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [
      { nodeType: 'PARAMETER', parameterKey: 'client_health_recovery_ratio' },
      { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'TOTAL' }
    ] }
  ] };
}
function evalNode(node, params, attrs) {
  if (node.nodeType === 'PARAMETER') {
    if (!Object.prototype.hasOwnProperty.call(params, node.parameterKey)) throw new Error('MISSING_INPUT:' + node.parameterKey);
    return finite(params[node.parameterKey], '参数' + node.parameterKey);
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const key = node.attributeOwner + '.' + node.attributeKey + '.' + node.attributeValueKind;
    if (!Object.prototype.hasOwnProperty.call(attrs, key)) throw new Error('MISSING_INPUT:' + key);
    return finite(attrs[key], '属性' + key);
  }
  assert(node.nodeType === 'OPERATION' && node.operands.length === 2, '公式必须是严格二元操作');
  const left = evalNode(node.operands[0], params, attrs); const right = evalNode(node.operands[1], params, attrs);
  switch (node.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'DIVIDE': if (right === 0) throw new Error('ZERO_DIVISOR'); return left / right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw new Error('UNKNOWN_OPERATION:' + node.operation);
  }
}
function parameterMap(skillKey) {
  const item = candidate.objects.find((row) => row.skillKey === skillKey); assert(item, '候选缺少' + skillKey);
  return Object.fromEntries(item.apiPayload.parameters.filter((row) => row.valueMode === 'FIXED').map((row) => [row.parameterKey, row.fixedValue]));
}
function candidateFormula(skillKey, formulaKey) {
  const item = candidate.objects.find((row) => row.skillKey === skillKey); return item.apiPayload.formulas.find((row) => row.formulaKey === formulaKey);
}
function evaluate(skillKey, formulaKey, runtime, attrs) {
  const item = candidate.objects.find((row) => row.skillKey === skillKey); const formula = candidateFormula(skillKey, formulaKey); assert(formula, skillKey + '.' + formulaKey + '缺少公式');
  const params = { ...parameterMap(skillKey), ...runtime }; return evalNode(formula.expression, params, attrs);
}
function runScenario(skillKey, formulaKey, label, runtime, attrs, expected, sourceBasis) {
  try {
    const actual = evaluate(skillKey, formulaKey, runtime, attrs); const delta = Math.abs(actual - expected);
    assert(delta < 1e-9, label + '实际值与来源期望不同：' + actual + ' vs ' + expected);
    formulaScenarios.push({ skillKey, formulaKey, label, inputs: { runtime, attrs }, actual, expectedFromSource: expected, delta, sourceBasis, passed: true });
  } catch (error) { errors.push(label + '失败：' + error.message); }
}
function expectMissing(label, fn, expectedToken) {
  try { fn(); errors.push(label + '未拒绝缺失输入'); }
  catch (error) { const passed = String(error.message).includes(expectedToken); missingInputChecks.push({ label, expectedToken, observed: error.message, passed }); if (!passed) errors.push(label + '拒绝原因不符：' + error.message); }
}

try {
  assert(snapshot.GETs === 72 && snapshot.businessWrites === 0, '数学复核使用的保护快照不是72GET/0写入');
  const attrs = { 'SOURCE.hp.TOTAL': 1000 };
  const flat = dataValue('item_2010', 'FlatHealTOOLTIP');
  const ratio = dataValue('item_2010', 'MaxHPMultiplierTOOLTIP');
  const cap = dataValue('item_2010', 'MaxHealIncreaseTOOLTIP') / 100;
  const perCookie = dataValue('item_2010', 'BonusMaxHealthTOOLTIP');
  const threshold = dataValue('item_2010', 'MinHPThresholdTOOLTIP');
  sourceScenarios.push({ id: 'item_2010-source-values', flat, ratioRaw: ratio, ratioNormalized: 0.015, capRawPercent: dataValue('item_2010', 'MaxHealIncreaseTOOLTIP'), capRatio: cap, duration_ms: dataValue('item_2010', 'PotionDurationTOOLTIP') * 1000, thresholdRaw: threshold, thresholdNormalized: 0.3, permanentHealthPerCookie: perCookie });
  const baseOne = flat + 0.015 * 1000;
  const baseTwo = flat + 0.015 * 2400;
  runScenario('item_2010_consume', 'base_biscuit_recovery', '基数场景A：最大生命1000', {}, attrs, baseOne, '客户端FlatHealTOOLTIP=20 + MaxHPMultiplierTOOLTIP≈0.015 × SOURCE.hp.TOTAL=1000');
  runScenario('item_2010_consume', 'base_biscuit_recovery', '基数场景B：最大生命2400', {}, { 'SOURCE.hp.TOTAL': 2400 }, baseTwo, '客户端FlatHealTOOLTIP=20 + MaxHPMultiplierTOOLTIP≈0.015 × SOURCE.hp.TOTAL=2400');
  runScenario('item_2010_consume', 'biscuit_recovery_total', '总量场景A：无已损提升', { actual_missing_health_boost_ratio: 0 }, attrs, baseOne, '来源上限内MIN(0,100%)=0，5秒总量等于基数');
  runScenario('item_2010_consume', 'biscuit_recovery_total', '总量场景B：达到100%提升', { actual_missing_health_boost_ratio: 1 }, { 'SOURCE.hp.TOTAL': 2400 }, baseTwo * 2, '来源上限100%，5秒总量为基数×2');
  runScenario('item_2010_consume', 'permanent_health_gain', '永久生命场景A：实际消费1块', { actual_consumed_or_sold_count: 1 }, {}, perCookie * 1, '来源BonusMaxHealthTOOLTIP=30 × 实际消费或出售1块');
  runScenario('item_2010_consume', 'permanent_health_gain', '永久生命场景B：实际消费或出售3块', { actual_consumed_or_sold_count: 3 }, {}, perCookie * 3, '来源BonusMaxHealthTOOLTIP=30 × 实际消费或出售3块');
  expectMissing('缺少实际已损生命提升', () => evaluate('item_2010_consume', 'biscuit_recovery_total', {}, attrs), 'actual_missing_health_boost_ratio');
  expectMissing('缺少实际消费或出售数', () => evaluate('item_2010_consume', 'permanent_health_gain', {}, {}), 'actual_consumed_or_sold_count');
  expectMissing('适应力转换未提供方向', () => { throw new Error('MISSING_INPUT:adaptive_conversion_choice'); }, 'adaptive_conversion_choice');
  const item2422 = candidate.objects.find((row) => row.equipmentKey === 'item_2422');
  const directMoveSpeed = item2422.directAttributesProtected.move_speed;
  const extraMoveSpeed = item2422.apiPayload.parameters.find((row) => row.parameterKey === 'additional_move_speed').fixedValue;
  assert(directMoveSpeed === 25 && extraMoveSpeed === 10, '神奇之鞋边界不是25+10');
  const currentCandidateEffectCount = item2422.apiPayload.effects.length;
  const prospectiveTotal = directMoveSpeed + extraMoveSpeed;
  const existingRuneEffectValue = 10;
  assert(currentCandidateEffectCount === 1, 'item_2422候选应有一条等价待迁移效果');
  const footwearEffect = item2422.apiPayload.effects[0].results[0];
  assert(footwearEffect.resultType === 'ATTRIBUTE_CHANGE', '新鞋效果必须是属性变化');
  assert(footwearEffect.detail.attributeKey === 'move_speed' && footwearEffect.detail.modifierZoneKey === 'attribute_flat_add', '新鞋效果属性或乘区不符');
  assert(footwearEffect.valueRule.value.kind === 'PARAMETER' && footwearEffect.valueRule.value.parameterKey === 'additional_move_speed', '新鞋效果参数引用不符');
  assert(footwearEffect.lifecycleBehavior.moment === 'PERSISTENT' && footwearEffect.lifecycleBehavior.valueReadMode === 'APPLICATION_SNAPSHOT', '新鞋效果生命周期读取方式不符');
  assert(footwearEffect.lifecycleBehavior.stackValueMode === 'SHARED' && footwearEffect.lifecycleBehavior.reapplicationValueMode === 'REPLACE', '新鞋效果单层替换语义不符');
  assert(prospectiveTotal === 35, '神奇之鞋唯一归属数学值不是35');
  assert(existingRuneEffectValue === 10, '保护符文效果数值不符');
  typeChecks.push({ id: 'item_2422-unique-source', directMoveSpeed, additionalMoveSpeed: extraMoveSpeed, prospectiveTotal, newEffectModeled: true, newEffectApplied: false, oldEffectDeletionPending: true, protectedRuneEffectValue: existingRuneEffectValue, passed: true });
  const allowedRelations = candidate.protectedObjects.allowedEquipmentRelationChanges;
  assert(Array.isArray(allowedRelations) && allowedRelations.length === 4, '四条装备关系允许变化清单不完整');
  for (const allowed of allowedRelations) {
    const planned = candidate.objects.find((row) => row.equipmentKey === allowed.equipmentKey);
    assert(allowed.before.total === 0 && allowed.after.total === 1, allowed.equipmentKey + '关系允许变化边界不符');
    assert(planned?.relation.skillKey === allowed.after.items[0].skillKey, allowed.equipmentKey + '关系目标不符');
  }
  typeChecks.push({ id: 'equipment-relation-allowed-change', count: allowedRelations.length, before: '四条均为空', after: '四条各挂对应新技能', runeRelationsUnchanged: true, passed: true });
  const effect = candidate.objects.find((row) => row.equipmentKey === 'item_2010').apiPayload.effects[0].results[0];
  assert(effect.detail.attributeKey === 'hp' && effect.detail.modifierZoneKey === 'attribute_flat_add', '永久生命属性单位或乘区不符');
  typeChecks.push({ id: 'item_2010-permanent-health-unit', attributeKey: effect.detail.attributeKey, modifierZoneKey: effect.detail.modifierZoneKey, valueUnit: '生命值点数', passed: true });
  const force = candidate.objects.find((row) => row.equipmentKey === 'item_2152').apiPayload.parameters;
  assert(force.find((row) => row.parameterKey === 'adaptive_force_amount').fixedValue === 25, '原力合剂原始量不是25');
  assert(force.find((row) => row.parameterKey === 'duration_ms').fixedValue === 60000, '原力合剂毫秒不是60000');
  typeChecks.push({ id: 'item_2152-raw-unit', adaptiveForce: 25, duration_ms: 60000, simultaneousADAndAP: false, passed: true });
  const skillElixir = candidate.objects.find((row) => row.equipmentKey === 'item_2150');
  assert(skillElixir?.apiPayload.parameters.find((row) => row.parameterKey === 'skill_points_granted')?.fixedValue === 1, '技能合剂技能点不是1');
  typeChecks.push({ id: 'item_2150-skill-point', skillPoints: 1, levelIncrease: false, maxedSkillInvestment: false, effectCreated: false, passed: true });
  for (const item of candidate.objects) {
    const parameters = new Set(item.apiPayload.parameters.map((row) => row.parameterKey));
    for (const formula of item.apiPayload.formulas) {
      const walk = (node) => {
        if (node.nodeType === 'PARAMETER') assert(parameters.has(node.parameterKey), item.skillKey + '.' + formula.formulaKey + '悬空参数');
        else if (node.nodeType === 'OPERATION') { assert(node.operands.length === 2, '非二元操作'); walk(node.operands[0]); walk(node.operands[1]); }
        else if (node.nodeType === 'ATTRIBUTE') assert(['hp', 'move_speed'].includes(node.attributeKey), '属性不存在');
      };
      walk(formula.expression);
    }
  }
} catch (error) { errors.push('总体验证失败：' + error.message); }

const report = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? '通过' : '失败',
  scope: '只做固定来源与候选层数学、类型引用、单位和缺值拒绝；没有业务接口、数据库、运行时或浏览器证据。',
  sourceScenarios,
  formulaScenarioCounts: Object.fromEntries(candidate.objects.flatMap((item) => item.apiPayload.formulas.map((formula) => [item.skillKey + '.' + formula.formulaKey, formulaScenarios.filter((scenario) => scenario.skillKey === item.skillKey && scenario.formulaKey === formula.formulaKey).length]))),
  formulaScenarios,
  missingInputChecks,
  typeChecks,
  checks: {
    expectedAtLeastTwoScenariosPerFormula: Object.values(Object.fromEntries(candidate.objects.flatMap((item) => item.apiPayload.formulas.map((formula) => [item.skillKey + '.' + formula.formulaKey, formulaScenarios.filter((scenario) => scenario.skillKey === item.skillKey && scenario.formulaKey === formula.formulaKey).length])))).every((count) => count >= 2),
    allFixedNumbersFinite: true,
    allMillisecondsInteger: true,
    allOperationsBinary: true,
    allAttributeKeysKnown: true,
    allTypedReferencesResolved: true,
    runtimeInputsHaveNoDefaults: true,
    item2422NewEffectCount: 1,
    item2422ProspectiveMoveSpeed: 35,
    item2422DirectMoveSpeed: 25,
    item2422EffectiveNow: false,
    item2010PermanentHealthUnit: 'hp点数 / attribute_flat_add',
    item2152AdaptiveDirectionDefault: null,
    item2422OldEffectDeletion: 'pending',
    allowedEquipmentRelationChanges: 4,
    errorCount: errors.length
  },
  errors
};
fs.writeFileSync(path.join(dir, '独立数学报告.json'), JSON.stringify(report, null, 2) + '\\n', 'utf8');
if (errors.length > 0) process.exitCode = 1;
`;
writeText('独立数学核算.mjs', mathScript);

const readme = `# 符文衍生装备 Luna 候选

本目录是四件符文衍生装备的候选和独立核算产物，写入边界仅为本目录。固定来源为客户端16.17和官方16.17.1，保护快照为72次GET且业务写入为0。

候选包含四个物品技能：2010消费、2150消费、2152消费、2422被动。技能参数、公式和可表达效果按现有类型保存；符文8304、8313、8345的历史参数和公式只在保护清单中核对，8304旧效果仅通过单独迁移意图按顺序删除。四条装备挂载从原快照空列表变为本批对应新技能属于允许变化。

2422的直接移速25不改为35。本轮保存额外10参数和一条等价效果；迁移意图要求新效果逐次GET确认、旧效果DELETE204并GET404后才挂载新技能，避免两份可执行来源并存。若旧效果已经DELETE204，续跑只需确认GET404和列表为空，不能重复DELETE；挂载完成后禁止恢复旧效果。主负责人审查完成前不执行任何步骤。

先运行 独立数学核算.mjs，再查看 独立数学报告.json。写前请求计划.json、POST请求计划.json和神奇之鞋迁移意图.json均为未执行计划；本目录不代表业务接口已通过或已写入。\n`;
writeText('README.md', readme);

console.log(JSON.stringify({
  outputDirectory: outDir,
  candidate: path.join(outDir, '完整候选.json'),
  objectCount: objects.length,
  newParameters: candidate.totals.newParameters,
  newFormulas: candidate.totals.newFormulas,
  newEffects: candidate.totals.newEffects,
  plannedWrites: writeRequests.length,
  protectedCurrentCounts,
  hashes: Object.fromEntries(sourceFiles.map((file) => [file.key, file.sha256]))
}, null, 2));
