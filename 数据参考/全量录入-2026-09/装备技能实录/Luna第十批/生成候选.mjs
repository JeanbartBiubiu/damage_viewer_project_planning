import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const planningRoot = path.resolve(directory, '..', '..', '..', '..');
const output = name => path.join(directory, name);
const source = relative => path.join(planningRoot, relative);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readGzipJson(file) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function writeJson(name, value) {
  fs.writeFileSync(output(name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(file) {
  const bytes = fs.readFileSync(file);
  const result = { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  if (file.endsWith('.gz')) {
    result.decompressedSha256 = crypto.createHash('sha256').update(zlib.gunzipSync(bytes)).digest('hex');
  }
  return result;
}

function rounded(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function requireNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`冻结来源缺少数值 ${label}`);
  return value;
}

function dataValues(raw) {
  return Object.fromEntries((raw.mDataValues ?? []).map(item => [item.mName, item.mValue]));
}

function requiredDataValue(values, name) {
  return requireNumber(values[name], name);
}

function findCoefficient(value) {
  if (value == null || typeof value !== 'object') return null;
  if (typeof value.mCoefficient === 'number') return value.mCoefficient;
  for (const child of Object.values(value)) {
    const found = findCoefficient(child);
    if (found != null) return found;
  }
  return null;
}

function strictStringEntry(entries, wanted) {
  const found = Object.entries(entries).find(([key]) => key.toLowerCase() === wanted.toLowerCase());
  return found ? { key: found[0], value: found[1] } : null;
}

function currentBoundStrings(raw, entries, extraKeys = []) {
  const client = raw.mItemDataClient ?? {};
  const locKeys = raw.mItemDataClient?.mTooltipData?.mLocKeys ?? {};
  const names = [...Object.values(locKeys), client.mDescription, client.mDynamicTooltip, client.mShopTooltip, ...extraKeys]
    .filter(value => typeof value === 'string');
  const strings = {};
  const missing = [];
  for (const name of [...new Set(names)]) {
    const found = strictStringEntry(entries, name);
    if (found) strings[found.key] = found.value;
    else missing.push(name);
  }
  return { strings, missing };
}

function fixed(value) {
  return { kind: 'FIXED', value };
}

function parameter(key) {
  return { kind: 'PARAMETER', parameterKey: key };
}

function formulaValue(key) {
  return { kind: 'FORMULA', formulaKey: key };
}

function valueRule(value) {
  return { value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null };
}

function lifecycle({ durationValue = null, maxStacksValue = fixed(1), applicationStacksValue = fixed(1), instanceScope = 'SOURCE', reapplicationStackMode = 'KEEP', reapplicationDurationMode = null, expiryMode = 'EXPLICIT_ONLY', periodicIntervalValue = null, firstPeriodicExecution = null }) {
  return { durationValue, maxStacksValue, applicationStacksValue, instanceScope, reapplicationStackMode, reapplicationDurationMode, expiryMode, periodicIntervalValue, firstPeriodicExecution };
}

function behavior(moment, valueReadMode = null, stackValueMode = null, reapplicationValueMode = null, periodicExecutionMode = null) {
  return { moment, valueReadMode, stackValueMode, reapplicationValueMode, periodicExecutionMode };
}

function parameterBody(parameterKey, name, valueType, fixedValue, description, sortOrder) {
  return { parameterKey, name, valueType, valueMode: 'FIXED', fixedValue, levelValues: null, description, sortOrder };
}

function formulaBody(formulaKey, name, description, expression, sortOrder) {
  return { formulaKey, name, description, sortOrder, expression };
}

function attributeResult(resultKey, name, description, numericValue, sortOrder = 10) {
  return {
    resultKey,
    name,
    resultType: 'ATTRIBUTE_CHANGE',
    target: 'SOURCE',
    description,
    sortOrder,
    valueRule: valueRule(numericValue),
    detail: { attributeKey: 'ability_power', operation: 'INCREASE', modifierZoneKey: 'attribute_flat_add' },
    lifecycleBehavior: behavior('PERSISTENT', 'APPLICATION_SNAPSHOT', 'PER_STACK', null, null),
    spellShieldBlockScope: null,
  };
}

const clientFile = source('数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz');
const stringTableFile = source('数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz');
const officialFile = source('数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json');
const dispositionFile = source('数据参考/全量录入-2026-09/装备符文/装备全量处置清单.json');
const coverageFile = source('数据参考/全量录入-2026-09/装备效果补证/来源与覆盖.json');
const apiSummaryFile = source('数据参考/全量录入-2026-09/API实录/装备/summary.json');
const relationFiles = [
  source('数据参考/全量录入-2026-09/装备技能实录/Luna第十批/关系识别-2026-09-08T02-52-11.404Z.json'),
  source('数据参考/全量录入-2026-09/装备技能实录/Luna第十批/关系识别-2026-09-08T02-53-49.953Z.json'),
];

const client = readGzipJson(clientFile);
const strings = readGzipJson(stringTableFile);
const official = readJson(officialFile);
const disposition = readJson(dispositionFile);
const coverage = readJson(coverageFile);
const apiSummary = readJson(apiSummaryFile);
const relationSnapshots = relationFiles.map(readJson);

const specs = [
  {
    itemId: '1056',
    requestedEquipmentKey: 'item_1056',
    equipmentKey: 'duolanjie',
    equipmentName: '多兰之戒',
    skillKey: 'duolanjie_passive',
    skillName: '多兰之戒·汲取',
    directAttributes: { hp: 90, ability_power: 18 },
    historicalAttributes: { hp: 90, mana: 50, ability_power: 18 },
  },
  {
    itemId: '1082',
    requestedEquipmentKey: 'item_1082',
    equipmentKey: 'item_1082',
    equipmentName: '黑暗封印',
    skillKey: 'item_1082_passive',
    skillName: '黑暗封印·荣耀',
    directAttributes: { hp: 50, ability_power: 15 },
    historicalAttributes: { hp: 50, ability_power: 15 },
  },
];

function relationSlice(snapshot, spec) {
  return snapshot.objects?.find(item => item.requestedEquipmentKey === spec.requestedEquipmentKey || item.selectedEquipmentKey === spec.equipmentKey) ?? null;
}

function sourceClient(spec) {
  const objectPath = `Items/${spec.itemId}`;
  const raw = client[objectPath];
  if (!raw) throw new Error(`冻结客户端缺少 ${objectPath}`);
  const extraCurrentKeys = spec.itemId === '1056'
    ? ['item_1056_tooltip', 'generatedtip_item_1056_description', 'generatedtip_item_1056_tooltipinventorywithextendedbehaviorhint']
    : ['item_1082_tooltip', 'item_1082_tooltipextended', 'item_1082_tooltipdynamic', 'generatedtip_item_1082_description', 'generatedtip_item_1082_tooltipinventorywithextendedbehaviorhint'];
  const boundStrings = currentBoundStrings(raw, strings.entries, extraCurrentKeys);
  const relevantNames = [
    'mDisplayName', 'itemID', 'spellName', 'mEffectAmount', 'mDataValues', 'DataValuesModeOverride',
    'mItemCalculations', 'mItemAttributes', 'mItemGroups', 'mFlatHPPoolMod', 'mFlatPhysicalDamageMod',
    'mFlatMagicDamageMod', 'mFlatArmorMod', 'mFlatSpellBlockMod', 'mPercentMovementSpeedMod',
    'mPercentAttackSpeedMod', 'mPercentBaseHPRegenMod', 'mPercentTenacityItemMod', 'mAbilityHasteMod',
    'flatMPPoolMod', 'PhysicalLethality', 'mItemDataAvailability', 'mItemDataClient',
    'mEffectByLevelAmount', 'effectRadius',
  ];
  const relevant = {};
  for (const name of relevantNames) {
    if (Object.prototype.hasOwnProperty.call(raw, name)) relevant[name] = clone(raw[name]);
  }
  const boundSpellObjects = {};
  for (const [objectPathKey, value] of Object.entries(client)) {
    if (objectPathKey.startsWith(`${objectPath}/Spells/`)) boundSpellObjects[objectPathKey] = clone(value);
  }
  const officialItem = official.data?.[spec.itemId];
  if (!officialItem) throw new Error(`官方装备资料缺少 ${spec.itemId}`);
  const dispositionIndex = disposition.items?.findIndex(item => String(item.itemId) === spec.itemId) ?? -1;
  const listItem = dispositionIndex >= 0 ? disposition.items[dispositionIndex] : null;
  const historical = apiSummary.results?.find(item => item.equipmentKey === spec.equipmentKey) ?? null;
  const relationEvidence = relationSnapshots.map((snapshot, index) => ({
    file: path.relative(planningRoot, relationFiles[index]).replaceAll('\\', '/'),
    generatedAt: snapshot.generatedAt,
    record: clone(relationSlice(snapshot, spec)),
  }));
  return { raw, relevant, boundSpellObjects, boundStrings, officialItem, listItem, dispositionIndex, historical, relationEvidence };
}

function build1056(sourceData) {
  const values = dataValues(sourceData.raw);
  const manaBase = requiredDataValue(values, 'ManaRestorePerSecond');
  const manaUpgraded = requiredDataValue(values, 'ManaRestorePerSecondUpgraded');
  const conversion = rounded(requiredDataValue(values, 'ManaToHealthConversion'));
  const upgradeDurationMs = Math.round(requiredDataValue(values, 'UpgradeDuration') * 1000);
  if (manaBase !== 1 || manaUpgraded !== 2 || conversion !== 0.45 || upgradeDurationMs !== 5000) throw new Error('1056冻结值与预期不一致');
  const parameters = [
    parameterBody('mana_restore_per_second', '汲取基础每秒回蓝', 'INTEGER', manaBase, '当前绑定DataValue ManaRestorePerSecond=1；这是每秒速率，不换算成单次跳频量。', 10),
    parameterBody('mana_restore_per_second_upgraded', '汲取强化每秒回蓝', 'INTEGER', manaUpgraded, '当前绑定DataValue ManaRestorePerSecondUpgraded=2；敌方英雄受伤后的5秒强化段。', 20),
    parameterBody('upgrade_duration_ms', '汲取强化持续时间', 'INTEGER', upgradeDurationMs, '当前绑定DataValue UpgradeDuration=5秒，换算为5000毫秒。', 30),
    parameterBody('mana_to_health_ratio', '无法回蓝时的治疗比例', 'DECIMAL', conversion, '当前绑定DataValue ManaToHealthConversion=0.45，即45%小数比例，不是45个百分点。', 40),
  ];
  const formulas = [
    formulaBody('mana_restore_rate_base', '汲取基础法力每秒速率', '当前绑定每秒1点法力的速率；周期跳频和首跳时点未由冻结源确认。', { nodeType: 'PARAMETER', parameterKey: 'mana_restore_per_second' }, 10),
    formulaBody('mana_restore_rate_upgraded', '汲取强化法力每秒速率', '当前绑定每秒2点法力的速率；强化持续时间为5000毫秒。', { nodeType: 'PARAMETER', parameterKey: 'mana_restore_per_second_upgraded' }, 20),
    formulaBody('fallback_health_rate_base', '无法回蓝时基础治疗每秒速率', '基础法力不可获得时按1乘45%得到0.45生命/秒；分支和跳频未接线。', { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [{ nodeType: 'PARAMETER', parameterKey: 'mana_restore_per_second' }, { nodeType: 'PARAMETER', parameterKey: 'mana_to_health_ratio' }] }, 30),
    formulaBody('fallback_health_rate_upgraded', '无法回蓝时强化治疗每秒速率', '强化法力不可获得时按2乘45%得到0.9生命/秒；分支和跳频未接线。', { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [{ nodeType: 'PARAMETER', parameterKey: 'mana_restore_per_second_upgraded' }, { nodeType: 'PARAMETER', parameterKey: 'mana_to_health_ratio' }] }, 40),
  ];
  const effects = [];
  const apiPayload = {
    skill: { skillKey: 'duolanjie_passive', name: '多兰之戒·汲取', description: '按冻结客户端16.17与官方16.17.1资料保存已确证的汲取速率和比例；周期与触发见待配清单。', maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive'] },
    parameters,
    formulas,
    effects,
    triggerRules: [],
  };
  const humanParameters = [
    ...parameters.map(item => ({ ...item, unit: item.parameterKey.endsWith('_ms') ? '毫秒' : item.parameterKey.endsWith('_ratio') ? '小数比例' : '法力值/秒' })),
  ];
  return {
    apiPayload,
    directAttributes: { hp: 90, ability_power: 18 },
    historicalAttributes: { hp: 90, mana: 50, ability_power: 18 },
    candidate: {
      parameters: humanParameters,
      formulas,
      effects,
      triggerBoundary: '强化回蓝必须接收对敌方英雄造成伤害事件并持续5000毫秒；无法回蓝治疗必须接收资源不可获得分支。当前不把普通施法或任意事件当成触发。',
      pending: ['每秒速率的实际跳频和首跳时点没有冻结来源，当前不生成周期效果或固定首跳', '敌方英雄伤害事件的归属、强化段刷新和结束', '无法获得法力的判定及同一周期转治疗', '帮助之手5点小兵额外物理伤害按要求跳过，不进入本次接口候选'],
      sourceOnly: [{ key: 'BonusDamage', value: 5, unit: '物理伤害', reason: '仅小兵分支，按本批要求跳过业务候选。' }],
      arithmetic: [{ sample: '基础回蓝速率', calculation: '1', expected: 1, unit: '法力/秒；不能当成单次跳频量' }, { sample: '强化回蓝速率', calculation: '2', expected: 2, unit: '法力/秒；强化持续5000毫秒但不推导跳数' }, { sample: '无法回蓝时基础治疗速率', calculation: '1 × 0.45', expected: 0.45, unit: '生命/秒；45%小数比例' }, { sample: '无法回蓝时强化治疗速率', calculation: '2 × 0.45', expected: 0.9, unit: '生命/秒；45%小数比例' }],
      scopeDecision: '固定属性沿用历史已回读值；本次只整理技能候选，不重复提交属性或覆盖既有技能。',
      crossSkillDependencies: [],
    },
  };
}

function build1082(sourceData) {
  const values = dataValues(sourceData.raw);
  const maxStacks = requiredDataValue(values, 'MaxGloryStacks');
  const apPerGlory = requiredDataValue(values, 'APPerGlory');
  const gloryOnKill = requiredDataValue(values, 'GloryOnKill');
  const gloryOnAssist = requiredDataValue(values, 'GloryOnAssist');
  const gloryLossOnDeath = requiredDataValue(values, 'GloryLossOnDeath');
  if (maxStacks !== 10 || apPerGlory !== 4 || gloryOnKill !== 2 || gloryOnAssist !== 1 || gloryLossOnDeath !== 5) throw new Error('1082冻结值与预期不一致');
  const parameters = [
    parameterBody('max_glory_stacks', '荣耀最大层数', 'INTEGER', maxStacks, '当前绑定DataValue MaxGloryStacks=10；普通地图值，模式覆盖值不采用。', 10),
    parameterBody('ability_power_per_glory', '每层荣耀法术强度', 'INTEGER', apPerGlory, '当前绑定DataValue APPerGlory=4；每层贡献4点法术强度。', 20),
    parameterBody('glory_on_kill', '击杀获得荣耀', 'INTEGER', gloryOnKill, '当前绑定DataValue GloryOnKill=2；击杀事件分支尚未接线。', 30),
    parameterBody('glory_on_assist', '助攻获得荣耀', 'INTEGER', gloryOnAssist, '当前绑定DataValue GloryOnAssist=1；助攻事件分支尚未接线。', 40),
    parameterBody('glory_loss_on_death', '阵亡损失荣耀', 'INTEGER', gloryLossOnDeath, '当前绑定DataValue GloryLossOnDeath=5；阵亡事件分支尚未接线。', 50),
  ];
  const formulas = [formulaBody('ability_power_from_glory', '荣耀法术强度贡献', '每个荣耀层数贡献4点法术强度；层数由生命周期的每层值承载。', { nodeType: 'PARAMETER', parameterKey: 'ability_power_per_glory' }, 10)];
  const effects = [{
    effectKey: 'glory_ability_power',
    name: '荣耀法术强度',
    description: '保存每层荣耀提供4点法术强度，最大10层；击杀、助攻、阵亡事件及跨装备共享层数尚待接线。',
    sortOrder: 10,
    lifecycle: lifecycle({ maxStacksValue: parameter('max_glory_stacks'), reapplicationStackMode: 'INCREASE' }),
    results: [attributeResult('ability_power_from_glory', '每层荣耀法术强度', '每个有效荣耀层数向持有者增加4点法术强度。', formulaValue('ability_power_from_glory'))],
  }];
  const apiPayload = {
    skill: { skillKey: 'item_1082_passive', name: '黑暗封印·荣耀', description: '按冻结客户端16.17与官方16.17.1资料保存已确证的荣耀法术强度组成；击杀、助攻、阵亡事件见待配清单。', maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive'] },
    parameters,
    formulas,
    effects,
    triggerRules: [],
  };
  const humanParameters = parameters.map(item => ({ ...item, unit: item.parameterKey === 'ability_power_per_glory' ? '法术强度/层' : item.parameterKey.includes('stacks') || item.parameterKey.includes('glory') ? '层数' : '法术强度' }));
  return {
    apiPayload,
    directAttributes: { hp: 50, ability_power: 15 },
    historicalAttributes: { hp: 50, ability_power: 15 },
    candidate: {
      parameters: humanParameters,
      formulas,
      effects,
      triggerBoundary: '荣耀层数需要区分击杀、助攻和阵亡事件；本候选只保存层数上限及每层法术强度，不猜通用事件。',
      pending: ['击杀+2、助攻+1、阵亡-5的事件来源与同次处理', '荣耀层数在黑暗封印与梅贾之间的共享状态接线', '达到10层后的上限处理和阵亡损失下限'],
      sourceOnly: [{ key: 'URF GloryOnKill', value: 1, reason: '模式覆盖值；冻结普通地图候选不采用。' }, { key: 'URF GloryLossOnDeath', value: 3, reason: '模式覆盖值；冻结普通地图候选不采用。' }],
      arithmetic: [{ sample: '满层法术强度', calculation: '10 × 4', expected: 40, unit: '法术强度' }, { sample: '一次击杀后层数', calculation: '已有层数 + 2，且不超过10', expected: 'min(10, 已有层数+2)', unit: '层' }, { sample: '阵亡损失', calculation: '已有层数 - 5，实际下限待事件契约确认', expected: '按层数状态规则处理', unit: '层' }],
      scopeDecision: '固定属性沿用历史已回读值；本次只整理荣耀法术强度候选。',
      crossSkillDependencies: [{ skillKey: 'item_3041_passive', relation: '同名荣耀状态应共享层数；本次不生成3041对象或业务写入。' }],
    },
  };
}

const built = specs.map(spec => {
  const sourceData = sourceClient(spec);
  const result = spec.itemId === '1056' ? build1056(sourceData) : build1082(sourceData);
  return { ...spec, sourceData, ...result };
});

const sourcePathList = [clientFile, stringTableFile, officialFile, dispositionFile, coverageFile, apiSummaryFile, ...relationFiles];
const sourceIndex = Object.fromEntries(sourcePathList.map(file => [path.relative(planningRoot, file).replaceAll('\\', '/'), sha256(file)]));
const generatedAt = new Date().toISOString();
const correctedSnapshot = relationSnapshots[1];

function sourceRefs(spec) {
  return {
    client: { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: `Items/${spec.itemId}` },
    stringTable: { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: `/entries/${spec.itemId === '1056' ? 'item_1056_tooltip' : 'item_1082_tooltip'}` },
    official: { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: `/data/${spec.itemId}` },
    disposition: { file: '数据参考/全量录入-2026-09/装备符文/装备全量处置清单.json', pointer: `/items/${spec.sourceData.dispositionIndex}` },
    historicalApi: { file: '数据参考/全量录入-2026-09/API实录/装备/summary.json', pointer: `/results[equipmentKey=${spec.equipmentKey}]` },
    relationCorrected: { file: '数据参考/全量录入-2026-09/装备技能实录/Luna第十批/关系识别-2026-09-08T02-53-49.953Z.json', pointer: `/objects[requestedEquipmentKey=${spec.requestedEquipmentKey}]` },
    relationInitial: { file: '数据参考/全量录入-2026-09/装备技能实录/Luna第十批/关系识别-2026-09-08T02-52-11.404Z.json', pointer: `/objects[requestedEquipmentKey=${spec.requestedEquipmentKey}]` },
  };
}

const frozenSources = {
  batch: 'Luna第十批',
  generatedAt,
  status: '仅冻结来源和候选整理；未调用业务写接口。当前只落地1056与1082。',
  versionBoundary: { client: '16.17', official: '16.17.1', locale: 'zh_CN', map: '普通地图候选；不采用模式覆盖值' },
  sourceIndex,
  coverageSourceHashes: clone(coverage['原始资料'] ?? coverage.sourceHashes ?? null),
  relationRule: '先解析真实装备键，再以关系GET为准；item_1056与item_1056_passive的404只是探针，1056选用关系快照确认的duolanjie，不能据此判定未录或覆盖既有技能。',
  objects: built.map(spec => ({
    requestedEquipmentKey: spec.requestedEquipmentKey,
    selectedEquipmentKey: spec.equipmentKey,
    equipmentName: spec.equipmentName,
    skillKey: spec.skillKey,
    client: { objectPath: `Items/${spec.itemId}`, object: spec.sourceData.relevant, currentBoundStringTable: spec.sourceData.boundStrings.strings, missingBoundStringNames: spec.sourceData.boundStrings.missing, boundSpellObjects: spec.sourceData.boundSpellObjects },
    official: { sourceVersion: '16.17.1', sourceUrl: 'https://ddragon.leagueoflegends.com/cdn/16.17.1/data/zh_CN/item.json', sourcePointer: `/data/${spec.itemId}`, item: clone(spec.sourceData.officialItem) },
    disposition: clone(spec.sourceData.listItem),
    historicalApi: clone(spec.sourceData.historical),
    relationEvidence: clone(spec.sourceData.relationEvidence),
    sourceRefs: sourceRefs(spec),
  })),
};

const entryObjects = built.map(spec => ({
  equipmentKey: spec.equipmentKey,
  equipmentName: spec.equipmentName,
  skill: { skillKey: spec.skillKey, name: spec.skillName, maxLevel: 1, status: '候选', description: '只保存当前冻结来源明确的独立组成；触发、时序和未绑定旧值单列待审。', sourceStringKeys: Object.keys(spec.sourceData.boundStrings.strings) },
  directAttributes: spec.directAttributes,
  historicalExistingAttributes: spec.historicalAttributes,
  candidate: spec.candidate,
  relation: { equipmentKey: spec.equipmentKey, skillKey: spec.skillKey, sortOrder: 10 },
  representativeImage: { planned: true, equipmentKey: spec.equipmentKey, imageKey: relationSlice(correctedSnapshot, spec)?.representativeImage?.data?.image?.imageKey ?? null, relation: '复用装备代表图GET回读；本阶段不写图片接口。' },
  sourceRefs: sourceRefs(spec),
}));

const apiObjects = built.map(spec => ({
  equipmentKey: spec.equipmentKey,
  equipmentName: spec.equipmentName,
  skillKey: spec.skillKey,
  sourceRefs: sourceRefs(spec),
  apiPayload: spec.apiPayload,
  omittedComponents: spec.candidate.pending.map((reason, index) => ({ kind: 'pending', key: `pending_${index + 1}`, reason })),
  fullEquipmentComplete: false,
  pendingComponents: clone(spec.candidate.pending),
  pendingFromHistoricalCandidate: [],
}));

const relations = built.map(spec => ({ equipmentKey: spec.equipmentKey, skillKey: spec.skillKey, sortOrder: 10 }));
const representativeImages = built.map(spec => ({ equipmentKey: spec.equipmentKey, skillKey: spec.skillKey, imageKey: relationSlice(correctedSnapshot, spec)?.representativeImage?.data?.image?.imageKey ?? null, writePath: `/skills/${spec.skillKey}/representative-image`, status: '未写；待独立审查后决定' }));

const interfaceCandidate = {
  batch: 'Luna第十批',
  generatedAt,
  status: '仅候选；未调用业务写接口；待根独立审查后放行。当前仅含1056与1082。',
  contract: { sourceVersion: '客户端16.17 + 官方16.17.1', writeBoundary: '禁止POST、PUT、PATCH、DELETE；本文件不是业务写执行记录。', apiPayloadRule: '只保留后端现有技能、参数、公式、效果、关系和代表图契约字段；未确证触发不生成触发规则。' },
  sourceFiles: sourceIndex,
  objects: apiObjects,
  relations,
  representativeImages,
  counts: { objects: apiObjects.length, skills: apiObjects.length, parameters: apiObjects.reduce((sum, item) => sum + item.apiPayload.parameters.length, 0), formulas: apiObjects.reduce((sum, item) => sum + item.apiPayload.formulas.length, 0), effects: apiObjects.reduce((sum, item) => sum + item.apiPayload.effects.length, 0), triggerRules: 0, relations: relations.length, representativeImages: representativeImages.length },
};

const arithmetic = {
  batch: 'Luna第十批',
  generatedAt,
  status: '独立算术核对；不等同运行时或数据库证据。',
  objects: built.map(spec => ({ equipmentKey: spec.equipmentKey, equipmentName: spec.equipmentName, directAttributes: spec.directAttributes, arithmetic: spec.candidate.arithmetic, sourceValues: dataValues(spec.sourceData.raw), sourceBindings: spec.itemId === '1056' ? { fallbackRatio: 0.45, upgradeDurationMs: 5000 } : { maxGloryStacks: 10, abilityPowerPerGlory: 4, gloryOnKill: 2, gloryOnAssist: 1, gloryLossOnDeath: 5 } })),
  checks: [{ expression: '1056: 1 × 0.45', expected: 0.45, meaning: '无法回蓝时基础自我治疗每秒量' }, { expression: '1082: 10 × 4', expected: 40, meaning: '满10层荣耀提供的额外法术强度' }],
};

const gapReuse = {
  batch: 'Luna第十批',
  generatedAt,
  status: '来源不足、排除项和同值复用清单；不足项不能被描述成系统不能表达。',
  objects: built.map(spec => ({ equipmentKey: spec.equipmentKey, equipmentName: spec.equipmentName, gaps: spec.candidate.pending, sourceOnly: spec.candidate.sourceOnly, sameValueReuse: spec.itemId === '1056' ? [{ value: '0.45', reusedBy: ['基础无法回蓝治疗速率', '强化无法回蓝治疗速率'], reason: '当前绑定ManaToHealthConversion；区分45%比例和45个百分点，不推导跳频。' }, { value: '1/2法力每秒速率', reusedBy: ['基础回蓝公式', '强化回蓝公式'], reason: '只复用速率语义，不把速率当成单次跳频量。' }] : [{ value: '4法术强度/层', reusedBy: ['荣耀法术强度结果', '客户端CurrentGloryAP计算树'], reason: '通过每层结果表达；层数事件仍待接线。' }], historicalBoundary: spec.itemId === '1056' ? '历史回读含mana=50；固定属性本轮仅标历史，不重新提交。' : '历史回读固定属性已一致，本轮不重复提交。' })),
  sharedPending: [{ value: '荣耀层数', relatedObjects: ['item_1082', 'item_3041'], note: '两件装备应共享同一荣耀状态；本次只落地1082，3041不在本次生成范围。' }],
};

const readme = `# Luna第十批候选（1056、1082）\n\n本目录当前只落地多兰之戒（真实装备键duolanjie）和黑暗封印（item_1082）。来源版本冻结为客户端16.17、官方16.17.1、简体中文。\n\n关系快照显示1056的item_1056探针为404，但duolanjie为200；该404不表示未录入，也不覆盖历史技能或属性。历史属性只作回读证据，未生成属性写入动作。\n\n1056当前只保留1/2法力每秒速率、5000毫秒强化时长和45%转生命比例；冻结来源没有跳频或首跳证据，因此接口候选不生成周期效果，也不把0.45当成瞬时治疗。\n\n接口候选只保存已能独立表达的参数、公式和效果。未确证的触发、周期首跳、荣耀事件、共享层数和小兵分支在待配清单中保留。\n\n默认只读入口：运行只读检查.mjs，它只读取装备、属性、代表图、关系和候选技能组成；也可直接使用GET /equipment/{equipmentKey}、GET /equipment/{equipmentKey}/attributes、GET /equipment/{equipmentKey}/representative-image、GET /equipment-skill-relations?equipmentKey={equipmentKey}。本批未调用业务写接口。\n\n生成：node 生成候选.mjs。候选需经根独立审查后才可放行。\n`;

writeJson('冻结来源.json', frozenSources);
writeJson('录入候选.json', { batch: 'Luna第十批', generatedAt, status: '仅候选；当前只含1056与1082。', writeBoundary: '不提交属性、不覆盖既有技能、不调用业务写接口。', objects: entryObjects });
writeJson('接口候选.json', interfaceCandidate);
writeJson('独立手算证据.json', arithmetic);
writeJson('不足与同值复用.json', gapReuse);
fs.writeFileSync(output('候选生成说明.md'), readme, 'utf8');

console.log(JSON.stringify({ batch: 'Luna第十批', objects: built.map(item => ({ equipmentKey: item.equipmentKey, skillKey: item.skillKey, parameters: item.apiPayload.parameters.length, formulas: item.apiPayload.formulas.length, effects: item.apiPayload.effects.length })), sourceFileCount: Object.keys(sourceIndex).length, outputFiles: ['冻结来源.json', '录入候选.json', '接口候选.json', '独立手算证据.json', '不足与同值复用.json', '候选生成说明.md'] }, null, 2));
