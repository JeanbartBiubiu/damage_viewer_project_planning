import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const planningRoot = path.resolve(directory, '..', '..', '..', '..', '..');
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

function sourceHash(file) {
  const bytes = fs.readFileSync(file);
  const result = {
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  };
  if (file.endsWith('.gz')) {
    result.decompressedSha256 = crypto
      .createHash('sha256')
      .update(zlib.gunzipSync(bytes))
      .digest('hex');
  }
  return result;
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function requireNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`冻结来源缺少数值 ${label}`);
  }
  return value;
}

function dataValues(raw) {
  return Object.fromEntries((raw.mDataValues ?? []).map(item => [
    item.mName,
    Object.prototype.hasOwnProperty.call(item, 'mValue') ? item.mValue : null,
  ]));
}

function requiredDataValue(values, name) {
  return requireNumber(values[name], name);
}

function strictStringEntry(entries, wanted) {
  const found = Object.entries(entries).find(([key]) => key.toLowerCase() === wanted.toLowerCase());
  return found ? { key: found[0], value: found[1] } : null;
}

function currentBoundStrings(raw, entries, extraKeys = []) {
  const client = raw.mItemDataClient ?? {};
  const locKeys = client.mTooltipData?.mLocKeys ?? {};
  const names = [
    ...Object.values(locKeys),
    client.mDescription,
    client.mDynamicTooltip,
    client.mShopTooltip,
    ...extraKeys,
  ].filter(value => typeof value === 'string');
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

function parameterRef(parameterKey) {
  return { kind: 'PARAMETER', parameterKey };
}

function formulaRef(formulaKey) {
  return { kind: 'FORMULA', formulaKey };
}

function valueRule(value) {
  return {
    value,
    fixedMultiplier: 1,
    fixedMinValue: 0,
    fixedMaxValue: null,
  };
}

function lifecycle({
  durationValue = null,
  maxStacksValue = fixed(1),
  applicationStacksValue = fixed(1),
  instanceScope = 'SOURCE',
  reapplicationStackMode = 'KEEP',
  reapplicationDurationMode = null,
  expiryMode = 'EXPLICIT_ONLY',
  periodicIntervalValue = null,
  firstPeriodicExecution = null,
} = {}) {
  return {
    durationValue,
    maxStacksValue,
    applicationStacksValue,
    instanceScope,
    reapplicationStackMode,
    reapplicationDurationMode,
    expiryMode,
    periodicIntervalValue,
    firstPeriodicExecution,
  };
}

function behavior(
  moment,
  valueReadMode = null,
  stackValueMode = null,
  reapplicationValueMode = null,
  periodicExecutionMode = null,
) {
  return {
    moment,
    valueReadMode,
    stackValueMode,
    reapplicationValueMode,
    periodicExecutionMode,
  };
}

function parameterBody(parameterKey, name, valueType, fixedValue, description, sortOrder) {
  return {
    parameterKey,
    name,
    valueType,
    valueMode: 'FIXED',
    fixedValue,
    levelValues: null,
    description,
    sortOrder,
  };
}

function formulaBody(formulaKey, name, description, expression, sortOrder) {
  return { formulaKey, name, description, sortOrder, expression };
}

function attributeNode(attributeKey, attributeValueKind) {
  return {
    nodeType: 'ATTRIBUTE',
    attributeOwner: 'SOURCE',
    attributeKey,
    attributeValueKind,
  };
}

function operation(operationName, operands) {
  return { nodeType: 'OPERATION', operation: operationName, operands };
}

function attributeResult({
  resultKey,
  name,
  description,
  numericValue,
  formulaKey,
  attributeKey,
  valueReadMode,
  stackValueMode,
  reapplicationValueMode = null,
}) {
  return {
    resultKey,
    name,
    resultType: 'ATTRIBUTE_CHANGE',
    target: 'SOURCE',
    description,
    sortOrder: 10,
    valueRule: valueRule(formulaKey ? formulaRef(formulaKey) : numericValue),
    detail: {
      attributeKey,
      operation: 'INCREASE',
      modifierZoneKey: 'attribute_flat_add',
    },
    lifecycleBehavior: behavior(
      'PERSISTENT',
      valueReadMode,
      stackValueMode,
      reapplicationValueMode,
      null,
    ),
    spellShieldBlockScope: null,
  };
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

function findCurrentGloryCalculation(raw) {
  const calculation = raw.mItemCalculations?.CurrentGloryAP;
  const part = calculation?.mFormulaParts?.[0];
  return {
    calculationName: 'CurrentGloryAP',
    formulaPartType: part?.__type ?? null,
    buffName: part?.mBuffName ?? null,
    dataValue: part?.mDataValue ?? null,
    raw: clone(calculation),
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
    itemId: '3004',
    requestedEquipmentKey: 'item_3004',
    equipmentKey: 'item_3004',
    equipmentName: '魔宗',
    skillKey: 'item_3004_passive',
    skillName: '魔宗·敬畏与法力流',
    directAttributes: { mana: 500, attack_damage: 35, ability_haste: 15 },
    historicalAttributes: { mana: 500, attack_damage: 35, ability_haste: 15 },
  },
  {
    itemId: '3041',
    requestedEquipmentKey: 'item_3041',
    equipmentKey: 'item_3041',
    equipmentName: '梅贾的窃魂卷',
    skillKey: 'item_3041_passive',
    skillName: '梅贾的窃魂卷·荣耀',
    directAttributes: { hp: 100, ability_power: 20 },
    historicalAttributes: { hp: 100, ability_power: 20 },
  },
];

function relationSlice(snapshot, spec) {
  return snapshot.objects?.find(item => (
    item.requestedEquipmentKey === spec.requestedEquipmentKey
      || item.selectedEquipmentKey === spec.equipmentKey
  )) ?? null;
}

function sourceClient(spec) {
  const objectPath = `Items/${spec.itemId}`;
  const raw = client[objectPath];
  if (!raw) throw new Error(`冻结客户端缺少 ${objectPath}`);
  const extraCurrentKeys = spec.itemId === '3004'
    ? [
      'item_3004_tooltip',
      'generatedtip_item_3004_description',
      'generatedtip_item_3004_tooltipinventory',
      'generatedtip_item_3004_tooltipshop',
    ]
    : [
      'item_3041_tooltip',
      'item_3041_tooltipextended',
      'item_3041_keyworddefinitions',
      'generatedtip_item_3041_description',
      'generatedtip_item_3041_tooltipinventory',
      'generatedtip_item_3041_tooltipshop',
    ];
  const boundStrings = currentBoundStrings(raw, strings.entries, extraCurrentKeys);
  const relevantNames = [
    'spellName',
    'mDisplayName',
    'itemID',
    'maxStack',
    'price',
    'recipeItemLinks',
    'mScripts',
    'mDataValues',
    'DataValuesModeOverride',
    'mItemCalculations',
    'mItemAttributes',
    'mCategories',
    'mFlatHPPoolMod',
    'mFlatPhysicalDamageMod',
    'mFlatMagicDamageMod',
    'mAbilityHasteMod',
    'flatMPPoolMod',
    'mItemDataAvailability',
    'mItemDataClient',
    'mEffectAmount',
  ];
  const relevant = {};
  for (const name of relevantNames) {
    if (Object.prototype.hasOwnProperty.call(raw, name)) relevant[name] = clone(raw[name]);
  }
  const boundSpellObjects = {};
  for (const [objectPathKey, value] of Object.entries(client)) {
    if (objectPathKey.startsWith(`${objectPath}/Spells/`)) {
      boundSpellObjects[objectPathKey] = clone(value);
    }
  }
  const officialItem = official.data?.[spec.itemId];
  if (!officialItem) throw new Error(`官方装备资料缺少 ${spec.itemId}`);
  const dispositionIndex = disposition.items?.findIndex(
    item => String(item.itemId) === spec.itemId,
  ) ?? -1;
  const listItem = dispositionIndex >= 0 ? disposition.items[dispositionIndex] : null;
  if (!listItem) throw new Error(`处置清单缺少 ${spec.itemId}`);
  const historical = apiSummary.results?.find(
    item => item.equipmentKey === spec.equipmentKey,
  ) ?? null;
  if (!historical) throw new Error(`历史接口实录缺少 ${spec.equipmentKey}`);
  const relationEvidence = relationSnapshots.map((snapshot, index) => ({
    file: path.relative(planningRoot, relationFiles[index]).replaceAll('\\', '/'),
    generatedAt: snapshot.generatedAt,
    record: clone(relationSlice(snapshot, spec)),
  }));
  const corrected = relationSlice(relationSnapshots[1], spec);
  if (!corrected || corrected.selectedEquipmentKey !== spec.equipmentKey) {
    throw new Error(`关系快照未确认 ${spec.equipmentKey}`);
  }
  if (corrected.equipment?.status !== 200 || corrected.attributes?.status !== 200) {
    throw new Error(`关系快照装备或属性GET不是200：${spec.equipmentKey}`);
  }
  if (corrected.relation?.response?.status !== 200 || corrected.relation?.items?.length !== 0) {
    throw new Error(`关系快照关联不为空或不是200：${spec.equipmentKey}`);
  }
  return {
    raw,
    relevant,
    boundSpellObjects,
    boundStrings,
    officialItem,
    listItem,
    dispositionIndex,
    historical,
    relationEvidence,
    correctedRelation: corrected,
  };
}

function build3004(sourceData) {
  const values = dataValues(sourceData.raw);
  const manaPerCharge = requiredDataValue(values, 'ManaPerCharge');
  const chargeWindowMs = Math.round(requiredDataValue(values, 'ManaChargeAmmoCD') * 1000);
  const maxCharges = requiredDataValue(values, 'ManaChargeMaxAmmo');
  const transformThreshold = requiredDataValue(values, 'MaxMana');
  const coefficientRaw = findCoefficient(sourceData.raw.mItemCalculations?.BonusADFromMana);
  const coefficient = round(requireNumber(coefficientRaw, 'BonusADFromMana.mCoefficient'));
  if (
    manaPerCharge !== 3
    || chargeWindowMs !== 8000
    || maxCharges !== 4
    || transformThreshold !== 360
    || coefficient !== 0.02
  ) {
    throw new Error('3004冻结值与预期不一致');
  }
  const parameters = [
    parameterBody(
      'bonus_ad_from_max_mana_ratio',
      '敬畏最大法力转攻击力比例',
      'DECIMAL',
      coefficient,
      '当前客户端计算树BonusADFromMana系数为0.019999999552965164，按小数比例规范化为0.02；基数是来源持有者最大法力值TOTAL。',
      10,
    ),
    parameterBody(
      'mana_flow_charge_window_ms',
      '法力流充能窗口',
      'INTEGER',
      chargeWindowMs,
      '当前绑定DataValue ManaChargeAmmoCD=8秒，换算为8000毫秒；窗口内的具体充能消费时序仍待配。',
      20,
    ),
    parameterBody(
      'mana_flow_max_stacks',
      '法力流最大层数',
      'INTEGER',
      maxCharges,
      '当前绑定DataValue ManaChargeMaxAmmo=4；普通地图候选不采用模式覆盖值。',
      30,
    ),
    parameterBody(
      'mana_flow_max_mana_per_hit',
      '法力流每次命中最大法力值',
      'INTEGER',
      manaPerCharge,
      '当前绑定DataValue ManaPerCharge=3；说明同时覆盖普攻和技能命中，命中事件筛选另列待配。',
      40,
    ),
    parameterBody(
      'mana_flow_hero_hit_multiplier',
      '法力流英雄命中倍率',
      'INTEGER',
      2,
      '当前中文和官方说明均写明对英雄命中时翻倍；这里只保存2倍，不把目标筛选扩展为任意事件。',
      50,
    ),
    parameterBody(
      'mana_flow_transform_threshold',
      '法力流累计最大法力升级阈值',
      'INTEGER',
      transformThreshold,
      '当前绑定DataValue MaxMana=360；这是法力流累计增加的最大法力阈值，不是角色总最大法力达到360，也不导入魔切或3146的未证数值。',
      60,
    ),
  ];
  const formulas = [
    formulaBody(
      'bonus_attack_damage_from_max_mana',
      '敬畏最大法力转攻击力',
      '当前最大法力值TOTAL乘以0.02小数比例；直接属性mana=500只作为装备固定属性回读，不从公式中扣除或重复写入。',
      operation('MULTIPLY', [
        attributeNode('mana', 'TOTAL'),
        { nodeType: 'PARAMETER', parameterKey: 'bonus_ad_from_max_mana_ratio' },
      ]),
      10,
    ),
    formulaBody(
      'mana_flow_max_mana_per_hit',
      '法力流普通命中增加最大法力',
      '单次符合条件的普攻或技能命中按3点最大法力计算；事件身份和窗口消费未在此公式中假定。',
      { nodeType: 'PARAMETER', parameterKey: 'mana_flow_max_mana_per_hit' },
      20,
    ),
    formulaBody(
      'mana_flow_hero_hit_max_mana',
      '法力流英雄命中增加最大法力',
      '英雄目标符合条件时按3乘2得到6点最大法力；不把目标判定或每次命中次数写成公式之外的默认规则。',
      operation('MULTIPLY', [
        { nodeType: 'PARAMETER', parameterKey: 'mana_flow_max_mana_per_hit' },
        { nodeType: 'PARAMETER', parameterKey: 'mana_flow_hero_hit_multiplier' },
      ]),
      30,
    ),
  ];
  const effects = [
    {
      effectKey: 'bonus_attack_damage_from_max_mana',
      name: '敬畏最大法力转攻击力',
      description: '当前客户端计算树给出最大法力乘0.02的攻击力组成；结果按当前时点读取。官方16.17.1说明文本显示0额外攻击力，与客户端系数不一致，应用阶段和显示占位列入待审。',
      sortOrder: 10,
      lifecycle: lifecycle({ maxStacksValue: fixed(1), reapplicationStackMode: 'KEEP' }),
      results: [attributeResult({
        resultKey: 'bonus_attack_damage_from_max_mana',
        name: '最大法力提供的额外攻击力',
        description: '每1点当前最大法力按0.02比例提供额外攻击力；使用TOTAL并按当前时点读取，避免把装备固定500法力误当成BONUS。',
        formulaKey: 'bonus_attack_damage_from_max_mana',
        attributeKey: 'attack_damage',
        valueReadMode: 'MOMENT_EVALUATION',
        stackValueMode: 'SHARED',
      })],
    },
  ];
  const triggerRules = [
    {
      ruleKey: 'initialize_bonus_attack_damage_from_max_mana',
      name: '初始化敬畏最大法力转攻击力',
      description: '装备生效时建立按当前最大法力读取的属性效果；法力流命中事件和魔切替换不在本规则中扩大。',
      sortOrder: 10,
      eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} },
      conditionGroups: [],
      maxTriggersPerProcess: null,
      perTargetCooldown: null,
      actions: [{
        actionKey: 'execute_bonus_attack_damage_from_max_mana',
        name: '执行敬畏属性效果',
        actionType: 'EXECUTE_EFFECT',
        sortOrder: 10,
        targetContext: 'EVENT_SOURCE',
        runtimeInputBindings: [],
        resultModifiers: [],
        detail: { effectKey: 'bonus_attack_damage_from_max_mana' },
      }],
    },
  ];
  const apiPayload = {
    skill: {
      skillKey: 'item_3004_passive',
      name: '魔宗·敬畏与法力流',
      description: '按冻结客户端16.17、官方16.17.1和当前绑定中文说明保存最大法力转攻击力及法力流数值；命中筛选、升级替换和文本系数矛盾见待配清单。',
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['passive'],
    },
    parameters,
    formulas,
    effects,
    triggerRules,
  };
  const humanParameters = parameters.map(item => ({
    ...item,
    unit: item.parameterKey === 'bonus_ad_from_max_mana_ratio'
      ? '小数比例'
      : item.parameterKey.endsWith('_ms')
        ? '毫秒'
        : item.parameterKey.includes('multiplier')
          ? '倍率'
          : item.parameterKey.includes('stacks')
            ? '层数'
            : '最大法力值',
  }));
  const modeOverrides = clone(sourceData.raw.DataValuesModeOverride ?? {});
  return {
    apiPayload,
    directAttributes: { ...specs[0].directAttributes },
    historicalAttributes: { ...specs[0].historicalAttributes },
    candidate: {
      parameters: humanParameters,
      formulas,
      effects,
      triggerRules,
      triggerBoundary: '敬畏属性效果可由持有者初始化后按当前最大法力读取；法力流必须区分普攻/技能命中、英雄目标翻倍、8秒窗口和4层上限，当前不把任意事件当成命中触发。',
      pending: [
        '法力流命中事件的来源、普攻与技能归属、每次命中是否只计一次及英雄目标筛选',
        '法力流8秒窗口和4层状态的消费、刷新、并行技能命中处理；不从秒数推导跳频',
        '累计增加360最大法力后的魔切替换目标、装备关系、进度持久化和替换时点',
        '官方说明显示0额外攻击力与客户端计算树0.02系数的应用阶段、显示占位和升级状态需定点复核',
      ],
      pendingEffects: [
        {
          effectKey: 'mana_flow_max_mana_stack',
          resultType: 'ATTRIBUTE_CHANGE',
          target: 'SOURCE',
          reason: '数值公式已能表达3点基础命中和英雄6点命中；命中事件、充能窗口、层数状态和最大法力累计尚未形成可安全提交的单一效果与触发形状。',
        },
        {
          effectKey: 'transform_to_muramana',
          resultType: 'LIFECYCLE_OPERATION',
          target: 'SOURCE',
          reason: '360阈值有来源，但魔切替换关系与装备生命周期操作尚未由当前绑定资料完整确认；不插入3146或其他升级形态数值。',
        },
      ],
      sourceOnly: [
        {
          key: 'InternalCDPerCastID',
          value: values.InternalCDPerCastID,
          unit: null,
          reason: '客户端根有原始6.5，但当前绑定说明未确认其单位、事件归属和是否为业务冷却；保留原值作来源证据，不转换成6500毫秒参数。',
        },
        {
          key: 'TakedownMana',
          value: null,
          unit: null,
          reason: '客户端DataValue存在名称但没有mValue；不补数字、不猜击杀或助攻增加法力。',
        },
        {
          key: 'DataValuesModeOverride.ManaPerCharge',
          value: 4.5,
          modes: Object.keys(modeOverrides),
          unit: '最大法力值/次',
          reason: '仅模式覆盖值；普通地图候选固定为3，不把ARAM、NEXUSBLITZ、ONEFORALL、Ruby及哈希模式值混入。',
        },
      ],
      arithmetic: [
        {
          sample: '输入最大法力500时的敬畏额外攻击力',
          calculation: '500 × 0.02',
          expected: 10,
          unit: '攻击力；只作为公式算例，500是输入TOTAL，不是新增属性写入',
        },
        {
          sample: '一次普通命中法力流增加',
          calculation: '3',
          expected: 3,
          unit: '最大法力值；不代表已确认的跳频或触发次数',
        },
        {
          sample: '一次英雄命中法力流增加',
          calculation: '3 × 2',
          expected: 6,
          unit: '最大法力值；目标筛选仍待接线',
        },
        {
          sample: '四次符合条件的英雄命中累计',
          calculation: '4 × 6',
          expected: 24,
          unit: '最大法力值；仅按4层×每层6的算术，不推导实际事件时序',
        },
        {
          sample: '法力流升级阈值比较',
          calculation: '累计增加359 < 360，累计增加360 ≥ 360',
          expected: '前者不满足，后者满足',
          unit: '阈值；与角色当前总最大法力和装备固定500法力分开',
        },
      ],
      scopeDecision: '固定属性沿用历史GET回读的mana=500、attack_damage=35、ability_haste=15；本阶段只保留技能候选，不重复提交属性，不把魔切或3146式未证值展开。',
      crossSkillDependencies: [
        {
          equipmentKey: 'item_3042',
          relation: '360累计最大法力后替换为魔切的装备关系只作依赖提示；不复用升级形态数值。',
        },
      ],
    },
  };
}

function build3041(sourceData, sharedGloryEvidence) {
  const values = dataValues(sourceData.raw);
  const maxStacks = requiredDataValue(values, 'MaxGloryStacks');
  const apPerGlory = requiredDataValue(values, 'APPerGlory');
  const gloryOnKill = requiredDataValue(values, 'GloryOnKill');
  const gloryOnAssist = requiredDataValue(values, 'GloryOnAssist');
  const gloryLossOnDeath = requiredDataValue(values, 'GloryLossOnDeath');
  const gloryThreshold = requiredDataValue(values, 'GloryThreshold');
  const moveSpeedRatio = round(requiredDataValue(values, 'MoveSpeedMod'));
  if (
    maxStacks !== 25
    || apPerGlory !== 5
    || gloryOnKill !== 4
    || gloryOnAssist !== 2
    || gloryLossOnDeath !== 10
    || gloryThreshold !== 10
    || moveSpeedRatio !== 0.1
  ) {
    throw new Error('3041冻结值与预期不一致');
  }
  const parameters = [
    parameterBody(
      'max_glory_stacks',
      '荣耀最大层数',
      'INTEGER',
      maxStacks,
      '当前绑定DataValue MaxGloryStacks=25；普通地图候选不采用模式覆盖值。',
      10,
    ),
    parameterBody(
      'ability_power_per_glory',
      '每层荣耀法术强度',
      'INTEGER',
      apPerGlory,
      '当前绑定DataValue APPerGlory=5；单位是法术强度/层，不是层数。',
      20,
    ),
    parameterBody(
      'glory_on_kill',
      '击杀获得荣耀',
      'INTEGER',
      gloryOnKill,
      '当前绑定DataValue GloryOnKill=4；击杀事件身份和同次处理尚未接线。',
      30,
    ),
    parameterBody(
      'glory_on_assist',
      '助攻获得荣耀',
      'INTEGER',
      gloryOnAssist,
      '当前绑定DataValue GloryOnAssist=2；助攻事件身份和与击杀的互斥关系尚未接线。',
      40,
    ),
    parameterBody(
      'glory_loss_on_death',
      '阵亡损失荣耀',
      'INTEGER',
      gloryLossOnDeath,
      '当前绑定DataValue GloryLossOnDeath=10；阵亡事件、下限和层数共享尚未接线。',
      50,
    ),
    parameterBody(
      'glory_threshold_for_move_speed',
      '移动速度荣耀层数门槛',
      'INTEGER',
      gloryThreshold,
      '当前绑定DataValue GloryThreshold=10；单独保存10层门槛，不与法术强度每层数值合并。',
      60,
    ),
    parameterBody(
      'move_speed_percent_at_threshold',
      '达到门槛时移动速度比例',
      'DECIMAL',
      moveSpeedRatio,
      '当前绑定DataValue MoveSpeedMod=0.10000000149011612，规范化为0.1，即10%小数比例，不是10个百分点。',
      70,
    ),
  ];
  const formulas = [
    formulaBody(
      'ability_power_from_glory',
      '荣耀法术强度贡献',
      '每个有效荣耀层数贡献5点法术强度；共享荣耀层数和最大层数裁决仍待接线。',
      { nodeType: 'PARAMETER', parameterKey: 'ability_power_per_glory' },
      10,
    ),
    formulaBody(
      'move_speed_percent_from_glory_threshold',
      '荣耀门槛移动速度比例',
      '达到至少10层时使用0.1移动速度比例；本公式只保存比例，门槛启停和阵亡后的动态撤销另列待配。',
      { nodeType: 'PARAMETER', parameterKey: 'move_speed_percent_at_threshold' },
      20,
    ),
  ];
  const effects = [
    {
      effectKey: 'glory_ability_power',
      name: '荣耀法术强度',
      description: '保存每层荣耀提供5点法术强度，最大25层；客户端与1082均引用同一荣耀计算标识，但击杀、助攻、阵亡事件及共享层数接线尚待配。',
      sortOrder: 10,
      lifecycle: lifecycle({
        maxStacksValue: parameterRef('max_glory_stacks'),
        reapplicationStackMode: 'INCREASE',
      }),
      results: [attributeResult({
        resultKey: 'ability_power_from_glory',
        name: '每层荣耀法术强度',
        description: '每个有效荣耀层数向持有者增加5点法术强度；每层单位为法术强度/层。',
        formulaKey: 'ability_power_from_glory',
        attributeKey: 'ability_power',
        valueReadMode: 'APPLICATION_SNAPSHOT',
        stackValueMode: 'PER_STACK',
      })],
    },
  ];
  const triggerRules = [];
  const apiPayload = {
    skill: {
      skillKey: 'item_3041_passive',
      name: '梅贾的窃魂卷·荣耀',
      description: '按冻结客户端16.17、官方16.17.1和当前绑定扩展文本保存荣耀层数、法术强度和移动速度门槛；击杀、助攻、阵亡及跨装备共享事件见待配清单。',
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['passive'],
    },
    parameters,
    formulas,
    effects,
    triggerRules,
  };
  const humanParameters = parameters.map(item => ({
    ...item,
    unit: item.parameterKey === 'ability_power_per_glory'
      ? '法术强度/层'
      : item.parameterKey === 'move_speed_percent_at_threshold'
        ? '小数比例'
        : item.parameterKey.includes('threshold')
          ? '层数'
          : item.parameterKey.includes('glory')
            ? '层数'
            : '法术强度',
  }));
  const modeOverrides = clone(sourceData.raw.DataValuesModeOverride ?? {});
  return {
    apiPayload,
    directAttributes: { ...specs[1].directAttributes },
    historicalAttributes: { ...specs[1].historicalAttributes },
    candidate: {
      parameters: humanParameters,
      formulas,
      effects,
      triggerRules,
      triggerBoundary: '荣耀必须承接同一荣耀计数；击杀+4、助攻+2、阵亡-10分别作为参数保存，不把参与击杀关键字扩展成任意伤害或通用事件。10层移动速度是独立门槛，不能随意并入每层法术强度结果。',
      pending: [
        '击杀、助攻、阵亡事件的准确来源、同一次击杀的互斥处理和事件顺序',
        '与黑暗封印item_1082_passive共享同一荣耀计数；当前不新建第二个计数器，也不声称共享接线已经存在',
        '荣耀最大层数在1082的10层与3041的25层同时存在时的裁决、阵亡损失下限和持有者状态生命周期',
        '达到10层或以上时开启0.1移动速度、低于10层时撤销的动态门槛；当前不生成无条件10%效果',
      ],
      pendingEffects: [
        {
          effectKey: 'glory_move_speed_at_threshold',
          resultType: 'ATTRIBUTE_CHANGE',
          target: 'SOURCE',
          reason: '0.1比例和10层门槛均有来源，但现有候选结果不能安全表达条件启停；不把移动速度效果无条件授予0层持有者。',
        },
        {
          effectKey: 'glory_takedown_and_death_state',
          resultType: 'LIFECYCLE_OPERATION',
          target: 'SOURCE',
          reason: '击杀、助攻、阵亡的事件身份和共享状态尚未形成可安全提交的触发与层数操作；参数保留，不猜通用事件。',
        },
      ],
      sourceOnly: [
        {
          key: 'DataValuesModeOverride.URF',
          value: modeOverrides.URF ?? null,
          reason: 'URF模式覆盖击杀2、助攻1、阵亡损失5；本批普通地图候选不采用，也不把覆盖值当正式值。',
        },
        {
          key: 'mEffectAmount',
          value: clone(sourceData.raw.mEffectAmount),
          reason: '当前装备对象为全0数组；没有可绑定的数值标签，不从数组插值荣耀或移动速度。',
        },
      ],
      arithmetic: [
        {
          sample: '满25层荣耀法术强度',
          calculation: '25 × 5',
          expected: 125,
          unit: '额外法术强度；不含装备固定20法术强度',
        },
        {
          sample: '正常地图一次击杀获得荣耀',
          calculation: '已有层数 + 4',
          expected: 'min(25, 已有层数 + 4)',
          unit: '层；实际上限裁决与事件接线待配',
        },
        {
          sample: '正常地图一次助攻获得荣耀',
          calculation: '已有层数 + 2',
          expected: '按共享荣耀状态规则处理',
          unit: '层；不与同次击杀重复相加',
        },
        {
          sample: '阵亡损失荣耀',
          calculation: '已有层数 - 10',
          expected: '按层数状态下限规则处理',
          unit: '层；来源确认损失10，实际下限待配',
        },
        {
          sample: '移动速度门槛',
          calculation: '9层 < 10层；10层 ≥ 10层',
          expected: '9层不启用；10层使用0.1比例',
          unit: '0.1=10%比例，不是10个百分点；条件启停待配',
        },
        {
          sample: '与黑暗封印每层法术强度对照',
          calculation: '黑暗封印10 × 4；梅贾25 × 5',
          expected: '40；125',
          unit: '两项均为额外法术强度，层数共享关系仍待接线',
        },
      ],
      scopeDecision: '固定属性沿用历史GET回读的hp=100、ability_power=20；本阶段只整理荣耀组成，不重复提交属性，不把击杀筛选或条件移动速度说成已完成。',
      crossSkillDependencies: [
        {
          skillKey: 'item_1082_passive',
          relation: '客户端两件装备CurrentGloryAP均使用mBuffName={22eeba1f}和APPerGlory，候选承接同一荣耀计数；共享状态、上限裁决和事件接线交独立审查。',
          clientEvidence: clone(sharedGloryEvidence),
        },
      ],
    },
    sharedGloryEvidence: clone(sharedGloryEvidence),
  };
}

const sourceDataBySpec = new Map(specs.map(spec => [spec.itemId, sourceClient(spec)]));
const sharedGloryEvidence = {
  item_1082: findCurrentGloryCalculation(client.Items?.['1082'] ?? client['Items/1082']),
  item_3041: findCurrentGloryCalculation(client.Items?.['3041'] ?? client['Items/3041']),
  conclusion: '冻结客户端中1082和3041的CurrentGloryAP均绑定同一mBuffName={22eeba1f}与DataValue APPerGlory；本候选只记录共享依赖，不创建第二个计数器或虚构运行时字段。',
};
if (!sharedGloryEvidence.item_1082.buffName || !sharedGloryEvidence.item_3041.buffName) {
  throw new Error('1082或3041缺少CurrentGloryAP绑定');
}
if (sharedGloryEvidence.item_1082.buffName !== sharedGloryEvidence.item_3041.buffName) {
  throw new Error('1082与3041荣耀mBuffName不一致');
}

const built = specs.map(spec => {
  const sourceData = sourceDataBySpec.get(spec.itemId);
  const result = spec.itemId === '3004'
    ? build3004(sourceData)
    : build3041(sourceData, sharedGloryEvidence);
  return { ...spec, sourceData, ...result };
});

const sourcePathList = [
  clientFile,
  stringTableFile,
  officialFile,
  dispositionFile,
  coverageFile,
  apiSummaryFile,
  ...relationFiles,
];
const sourceIndex = Object.fromEntries(sourcePathList.map(file => [
  path.relative(planningRoot, file).replaceAll('\\', '/'),
  sourceHash(file),
]));
const generatedAt = new Date().toISOString();
const correctedSnapshot = relationSnapshots[1];

function sourceRefs(spec) {
  const stringPointer = spec.itemId === '3004'
    ? 'entries/item_3004_tooltip、entries/generatedtip_item_3004_description、entries/generatedtip_item_3004_tooltipinventory'
    : 'entries/item_3041_tooltip、entries/item_3041_tooltipextended、entries/item_3041_keyworddefinitions、entries/generatedtip_item_3041_description、entries/generatedtip_item_3041_tooltipinventory';
  const sourceData = sourceDataBySpec.get(spec.itemId);
  return [
    {
      file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz',
      pointer: `Items/${spec.itemId}/mDataValues、Items/${spec.itemId}/mItemCalculations、Items/${spec.itemId}/mItemDataClient/mTooltipData/mLocKeys`,
      evidence: spec.itemId === '3004'
        ? 'ManaPerCharge=3、ManaChargeAmmoCD=8、ManaChargeMaxAmmo=4、MaxMana=360；BonusADFromMana系数原始值约0.02；直接属性为500法力、35攻击力、15技能急速。'
        : 'MaxGloryStacks=25、APPerGlory=5、GloryOnKill=4、GloryOnAssist=2、GloryLossOnDeath=10、GloryThreshold=10、MoveSpeedMod约0.1；CurrentGloryAP绑定荣耀计数。',
    },
    {
      file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz',
      pointer: stringPointer,
      evidence: spec.itemId === '3004'
        ? '当前绑定扩展文本确认0.02计算占位、8秒4层、3最大法力且英雄翻倍、360累计阈值。'
        : '当前绑定基础及扩展文本分别确认25层、每层5法术强度、击杀4、助攻2、阵亡损失10和10层10%移动速度门槛。',
    },
    {
      file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json',
      pointer: `/data/${spec.itemId}/description、/data/${spec.itemId}/stats`,
      evidence: '官方16.17.1资料与当前冻结客户端交叉核对；地图和模式范围按处置清单保留。',
    },
    {
      file: '数据参考/全量录入-2026-09/装备符文/装备全量处置清单.json',
      pointer: `/items/${sourceData.dispositionIndex}`,
      evidence: '普通地图可购买装备处置条目；不把清单的待录状态当成客户端机制证明。',
    },
    {
      file: '数据参考/全量录入-2026-09/API实录/装备/summary.json',
      pointer: `/results[equipmentKey=${spec.equipmentKey}]`,
      evidence: '历史装备和属性GET回读；固定属性本阶段保护，不重复提交。',
    },
    {
      file: '数据参考/全量录入-2026-09/装备技能实录/Luna第十批/关系识别-2026-09-08T02-53-49.953Z.json',
      pointer: `/objects[requestedEquipmentKey=${spec.requestedEquipmentKey}]`,
      evidence: `关系快照选中${spec.equipmentKey}且装备、属性、关系GET为200；当前关联为空，预期${spec.skillKey}探针404只作探针。`,
    },
    {
      file: '数据参考/全量录入-2026-09/装备技能实录/Luna第十批/关系识别-2026-09-08T02-52-11.404Z.json',
      pointer: `/objects[requestedEquipmentKey=${spec.requestedEquipmentKey}]`,
      evidence: '初始关系快照留作时间顺序和重复核对证据。',
    },
  ];
}

const frozenSources = {
  batch: 'Luna第十批/第二组',
  generatedAt,
  status: '仅冻结来源和候选整理；未调用业务写接口；对象为3004和3041。',
  versionBoundary: {
    client: '16.17',
    official: '16.17.1',
    locale: 'zh_CN',
    map: '普通地图候选；不采用模式覆盖值',
  },
  sourceIndex,
  coverageSourceHashes: clone(coverage['原始资料'] ?? coverage.sourceHashes ?? null),
  relationRule: '先使用关系快照确认真实装备键；关系为空和预期被动404只能说明当前没有关联，不覆盖既有属性或技能。',
  sharedGloryBinding: clone(sharedGloryEvidence),
  objects: built.map(spec => ({
    itemId: spec.itemId,
    requestedEquipmentKey: spec.requestedEquipmentKey,
    selectedEquipmentKey: spec.equipmentKey,
    equipmentName: spec.equipmentName,
    skillKey: spec.skillKey,
    client: {
      objectPath: `Items/${spec.itemId}`,
      object: spec.sourceData.relevant,
      dataValues: dataValues(spec.sourceData.raw),
      currentBoundStringTable: spec.sourceData.boundStrings.strings,
      missingBoundStringNames: spec.sourceData.boundStrings.missing,
      boundSpellObjects: spec.sourceData.boundSpellObjects,
    },
    official: {
      sourceVersion: '16.17.1',
      sourceUrl: 'https://ddragon.leagueoflegends.com/cdn/16.17.1/data/zh_CN/item.json',
      sourcePointer: `/data/${spec.itemId}`,
      item: clone(spec.sourceData.officialItem),
    },
    disposition: clone(spec.sourceData.listItem),
    historicalApi: clone(spec.sourceData.historical),
    relationEvidence: clone(spec.sourceData.relationEvidence),
    sourceRefs: sourceRefs(spec),
  })),
};

const entryObjects = built.map(spec => ({
  itemId: spec.itemId,
  equipmentKey: spec.equipmentKey,
  equipmentName: spec.equipmentName,
  skill: {
    skillKey: spec.skillKey,
    name: spec.skillName,
    maxLevel: 1,
    status: '候选',
    description: '只保存当前冻结来源明确的独立组成；触发、时序、共享状态和未绑定旧值单列待审。',
    sourceStringKeys: Object.keys(spec.sourceData.boundStrings.strings),
  },
  directAttributes: spec.directAttributes,
  historicalExistingAttributes: spec.historicalAttributes,
  candidate: spec.candidate,
  relation: {
    equipmentKey: spec.equipmentKey,
    skillKey: spec.skillKey,
    sortOrder: 10,
  },
  representativeImage: {
    planned: true,
    equipmentKey: spec.equipmentKey,
    imageKey: relationSlice(correctedSnapshot, spec)?.representativeImage?.data?.image?.imageKey ?? null,
    relation: '复用装备代表图GET回读；本阶段不写图片接口。',
  },
  sourceRefs: sourceRefs(spec),
}));

const apiObjects = built.map(spec => ({
  itemId: spec.itemId,
  equipmentKey: spec.equipmentKey,
  equipmentName: spec.equipmentName,
  skillKey: spec.skillKey,
  sourceRefs: sourceRefs(spec),
  apiPayload: spec.apiPayload,
  omittedComponents: [
    ...spec.candidate.pending.map((reason, index) => ({
      kind: 'pending',
      key: `pending_${index + 1}`,
      reason,
    })),
    ...spec.candidate.pendingEffects.map(item => ({
      kind: 'effect',
      key: item.effectKey,
      reason: item.reason,
    })),
  ],
  fullEquipmentComplete: false,
  pendingComponents: clone(spec.candidate.pending),
  pendingEffects: clone(spec.candidate.pendingEffects),
  pendingFromHistoricalCandidate: [],
}));

const relations = built.map(spec => ({
  equipmentKey: spec.equipmentKey,
  skillKey: spec.skillKey,
  sortOrder: 10,
}));
const representativeImages = built.map(spec => ({
  equipmentKey: spec.equipmentKey,
  skillKey: spec.skillKey,
  imageKey: relationSlice(correctedSnapshot, spec)?.representativeImage?.data?.image?.imageKey ?? null,
  writePath: `/skills/${spec.skillKey}/representative-image`,
  status: '未写；待根独立审查后决定',
}));

const interfaceCandidate = {
  batch: 'Luna第十批/第二组',
  generatedAt,
  status: '仅候选；未调用业务写接口；待根独立审查后放行。',
  contract: {
    sourceVersion: '客户端16.17 + 官方16.17.1',
    writeBoundary: '禁止POST、PUT、PATCH、DELETE；本文件不是业务写执行记录。',
    apiPayloadRule: '只保留后端现有技能、参数、公式、效果、触发、关系和代表图契约字段；未确证触发不生成触发规则。',
  },
  sourceFiles: sourceIndex,
  objects: apiObjects,
  relations,
  representativeImages,
  counts: {
    objects: apiObjects.length,
    skills: apiObjects.length,
    parameters: apiObjects.reduce((sum, item) => sum + item.apiPayload.parameters.length, 0),
    formulas: apiObjects.reduce((sum, item) => sum + item.apiPayload.formulas.length, 0),
    effects: apiObjects.reduce((sum, item) => sum + item.apiPayload.effects.length, 0),
    triggerRules: apiObjects.reduce((sum, item) => sum + item.apiPayload.triggerRules.length, 0),
    relations: relations.length,
    representativeImages: representativeImages.length,
    omittedComponents: apiObjects.reduce((sum, item) => sum + item.omittedComponents.length, 0),
  },
};

const arithmetic = {
  batch: 'Luna第十批/第二组',
  generatedAt,
  status: '独立算术核对；不等同运行时、数据库或页面证据。',
  objects: built.map(spec => ({
    equipmentKey: spec.equipmentKey,
    equipmentName: spec.equipmentName,
    directAttributes: spec.directAttributes,
    arithmetic: spec.candidate.arithmetic,
    sourceValues: dataValues(spec.sourceData.raw),
    sourceBindings: spec.itemId === '3004'
      ? {
        maxManaAttributeKind: 'TOTAL',
        bonusAdRatio: 0.02,
        manaPerCharge: 3,
        heroHitMultiplier: 2,
        chargeWindowMs: 8000,
        maxStacks: 4,
        transformThreshold: 360,
      }
      : {
        maxGloryStacks: 25,
        abilityPowerPerGlory: 5,
        gloryOnKill: 4,
        gloryOnAssist: 2,
        gloryLossOnDeath: 10,
        gloryThreshold: 10,
        moveSpeedRatio: 0.1,
      },
  })),
  checks: [
    { expression: '3004: 500 × 0.02', expected: 10, meaning: '示例最大法力TOTAL转额外攻击力' },
    { expression: '3004: 3 × 2', expected: 6, meaning: '示例英雄命中最大法力增加' },
    { expression: '3041: 25 × 5', expected: 125, meaning: '满25层荣耀额外法术强度' },
    { expression: '3041: 10层触发0.1', expected: 0.1, meaning: '达到门槛的移动速度小数比例；条件启停未配' },
  ],
};

const gapReuse = {
  batch: 'Luna第十批/第二组',
  generatedAt,
  status: '来源不足、排除项和同值复用清单；不足项不能被描述成系统不能表达。',
  objects: built.map(spec => ({
    equipmentKey: spec.equipmentKey,
    equipmentName: spec.equipmentName,
    gaps: spec.candidate.pending,
    pendingEffects: spec.candidate.pendingEffects,
    sourceOnly: spec.candidate.sourceOnly,
    sameValueReuse: spec.itemId === '3004'
      ? [
        {
          value: '0.02',
          reusedBy: ['敬畏最大法力转攻击力公式', '敬畏最大法力转攻击力属性结果'],
          reason: '客户端BonusADFromMana系数归一化为小数比例；官方文本的0占位单列矛盾，不把0与0.02混为同值。',
        },
        {
          value: '3',
          reusedBy: ['法力流普通命中公式', '法力流英雄命中公式的基础值'],
          reason: '当前绑定ManaPerCharge；英雄分支另乘2。',
        },
        {
          value: '8000毫秒、4层',
          reusedBy: ['法力流参数说明', '法力流待配窗口与上限'],
          reason: '由8秒和最大4层组成；只复用来源数值，不推导周期跳频。',
        },
        {
          value: '360',
          reusedBy: ['法力流升级阈值参数', '阈值算例'],
          reason: '表示累计增加最大法力的升级阈值，与角色总最大法力和装备固定500法力分开。',
        },
      ]
      : [
        {
          value: '5法术强度/层',
          reusedBy: ['荣耀法术强度公式', '荣耀法术强度属性结果', '客户端CurrentGloryAP的APPerGlory绑定'],
          reason: '人工单位固定为法术强度/层，不把5写成荣耀层数。',
        },
        {
          value: '10层',
          reusedBy: ['荣耀门槛参数', '10层门槛算例'],
          reason: '只用于移动速度条件，不能替代25层上限或阵亡损失10层。',
        },
        {
          value: '0.1',
          reusedBy: ['移动速度比例参数', '达到门槛移动速度公式'],
          reason: '0.1是10%小数比例，不是10个百分点；未生成无条件属性效果。',
        },
        {
          value: '同一mBuffName={22eeba1f}',
          reusedBy: ['3041 CurrentGloryAP', '1082 CurrentGloryAP'],
          reason: '客户端根对象交叉证据；只记录共享荣耀依赖，不复制状态。',
        },
      ],
    historicalBoundary: spec.itemId === '3004'
      ? '历史回读含mana=500、attack_damage=35、ability_haste=15；本阶段只保护这些固定属性，不重复提交。'
      : '历史回读含hp=100、ability_power=20；本阶段只保护这些固定属性，不重复提交。',
  })),
  sharedPending: [
    {
      value: '荣耀层数',
      relatedObjects: ['item_1082', 'item_3041'],
      note: '两件装备的客户端CurrentGloryAP均指向同一mBuffName；本候选不创建第二个状态，也不声称事件共享已经配置。',
    },
  ],
  explicitExclusions: [
    '不展开3146式或其他升级形态未证实的默认插值和数值。',
    '不把3004的8秒窗口、3041的事件数值或任意秒数转换成未经来源确认的跳频。',
    '不把3041的参与击杀关键字扩展为通用伤害事件；击杀、助攻、阵亡保持三条独立待配边界。',
    '不把3041的10层移动速度门槛写成0层即生效的持续属性。',
  ],
};

const readme = `# Luna第十批第二组候选（3004、3041）

本子目录只落地魔宗（3004）和梅贾的窃魂卷（3041）的来源、候选、算例和待配清单，不触碰首组文件，不调用业务写接口，也不提交。

来源版本冻结为客户端16.17、官方16.17.1和同一份简体中文字符串表。固定属性沿用历史接口回读：魔宗为500法力、35攻击力、15技能急速；梅贾为100生命值、20法术强度。属性值只作保护证据，不生成属性写入。

魔宗的敬畏按客户端计算树系数0.019999999552965164归一化为0.02，公式基数明确使用来源最大法力TOTAL；500法力只是装备固定属性输入示例。法力流保留3、英雄翻倍2、8秒窗口、4层上限和360累计阈值，但命中事件、窗口消费、累计状态和魔切替换仍在待配清单。官方文本显示0额外攻击力的占位与客户端系数矛盾，已单列待审。

梅贾保留25层、每层5法术强度、击杀4、助攻2、阵亡损失10、10层门槛和0.1移动速度比例。客户端根对象显示梅贾与黑暗封印的CurrentGloryAP共用mBuffName={22eeba1f}，候选承接这一共享依赖，不创建第二个荣耀计数器。击杀、助攻、阵亡以及10层移动速度的条件启停都没有虚构触发规则；不会生成无条件移动速度效果。

默认只读入口是本子目录的第二组只读检查.mjs。它只请求装备、属性、代表图、关系和候选技能探针；令牌从环境变量DAMAGE_VIEWER_LOCAL_BEARER读取，不在文件中保存。候选正式业务写入前必须由根独立审查并逐项预检。

生成命令：使用冻结运行时执行“第二组生成候选.mjs”。生成物：第二组冻结来源.json、第二组录入候选.json、第二组接口候选.json、第二组独立手算证据.json、第二组不足与同值复用.json、第二组只读检查.mjs。
`;

writeJson('第二组冻结来源.json', frozenSources);
writeJson('第二组录入候选.json', {
  batch: 'Luna第十批/第二组',
  generatedAt,
  status: '仅候选；对象为3004与3041。',
  writeBoundary: '不提交属性、不覆盖既有技能、不调用业务写接口。',
  objects: entryObjects,
});
writeJson('第二组接口候选.json', interfaceCandidate);
writeJson('第二组独立手算证据.json', arithmetic);
writeJson('第二组不足与同值复用.json', gapReuse);
fs.writeFileSync(output('第二组README.md'), readme, 'utf8');

console.log(JSON.stringify({
  batch: 'Luna第十批/第二组',
  objects: built.map(item => ({
    equipmentKey: item.equipmentKey,
    skillKey: item.skillKey,
    parameters: item.apiPayload.parameters.length,
    formulas: item.apiPayload.formulas.length,
    effects: item.apiPayload.effects.length,
    triggerRules: item.apiPayload.triggerRules.length,
  })),
  sourceFileCount: Object.keys(sourceIndex).length,
  outputFiles: [
    '第二组冻结来源.json',
    '第二组录入候选.json',
    '第二组接口候选.json',
    '第二组独立手算证据.json',
    '第二组不足与同值复用.json',
    '第二组README.md',
    '第二组只读检查.mjs',
  ],
}, null, 2));
