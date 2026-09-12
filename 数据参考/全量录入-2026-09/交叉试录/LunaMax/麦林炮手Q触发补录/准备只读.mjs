import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const sharedHere = path.dirname(scriptPath);
const repo = 'C:/project/damage_web_dev';
const planning = 'C:/project/damage_viewer_project_planning';
const baseUrl = process.env.DAMAGE_ENTRY_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol';

const CONFIGS = {
  tristana: {
    directoryName: '麦林炮手Q触发补录',
    characterKey: 'champion_tristana',
    characterName: '崔丝塔娜',
    skillKey: 'tristana_q',
    skillName: '急速射击',
    ruleKey: 'active',
    candidateBatch: 'Luna/英雄机制第十二批',
    candidateFileName: '候选原始.json',
    sourceEvidenceFiles: [
      { kind: '归档正文候选', relativePath: 'Luna/英雄机制第十二批/完整候选.json' },
      { kind: '归档效果过程候选', relativePath: 'Cursor/英雄机制第三批/录入候选.json' }
    ],
    clientHero: 'Tristana',
    clientPointer: 'Characters/Tristana/Spells/TristanaQAbility/TristanaQ',
    officialChampion: 'Tristana',
    officialSpellId: 'TristanaQ',
    sourceEffectKeys: ['mana_cost', 'rapid_fire'],
    sourceProcessKeys: ['cast'],
    sourceFormulaKeys: [],
    sourceParameterKeys: ['cooldown_ms', 'mana_cost', 'bonus_attack_speed_ratio', 'buff_duration_ms'],
    actionEffectKeys: ['rapid_fire'],
    effectExpectations: {
      rapid_fire: {
        resultTarget: 'SOURCE',
        resultType: 'ATTRIBUTE_CHANGE',
        attributeKey: 'bonus_attack_speed_percent',
        operation: 'INCREASE',
        modifierZoneKey: 'attribute_flat_add',
        valueParameterKey: 'bonus_attack_speed_ratio',
        durationParameterKey: 'buff_duration_ms'
      }
    },
    catalogAttributeKeys: ['bonus_attack_speed_percent'],
    name: '急速射击主动使用',
    description: '接收 tristana_q 主动使用，在 CURRENT_TARGET 上启动已有 cast 过程；过程已绑定法力、冷却和 rapid_fire，自身攻击速度增益由过程执行一次。',
    processKey: 'cast',
    actionNames: [{ actionKey: 'start_cast', name: '启动急速射击施放过程' }],
    excluded: [
      '不重复执行 mana_cost 或 cooldown；这两项属于施放过程。',
      '不新增攻击命中、爆炸火花层数、火箭跳跃重置或其他敌方目标事件。',
      '不把急速射击的归档参数再次写入；本批只接已有 rapid_fire 效果。',
      '不直接 EXECUTE_EFFECT rapid_fire；本条规则只启动已有 cast 过程，避免重复执行自益效果。'
    ]
  },
  twitch: {
    directoryName: '瘟疫之源R触发补录',
    characterKey: 'champion_twitch',
    characterName: '图奇',
    skillKey: 'twitch_r',
    skillName: '火力全开',
    ruleKey: 'on_used',
    candidateBatch: 'Luna/英雄机制第十二批',
    candidateFileName: '候选原始.json',
    sourceEvidenceFiles: [
      { kind: '归档正文候选', relativePath: 'Luna/英雄机制第十二批/完整候选.json' },
      { kind: '归档效果过程候选', relativePath: 'Cursor/英雄机制第三批/录入候选.json' }
    ],
    clientHero: 'Twitch',
    clientPointer: 'Characters/Twitch/Spells/TwitchFullAutomaticAbility/TwitchFullAutomatic',
    officialChampion: 'Twitch',
    officialSpellId: 'TwitchFullAutomatic',
    sourceEffectKeys: ['mana_cost', 'bonus_ad', 'bonus_range'],
    sourceProcessKeys: ['cast'],
    sourceFormulaKeys: [],
    sourceParameterKeys: ['cooldown_ms', 'mana_cost', 'bonus_attack_damage', 'bonus_attack_range', 'buff_duration_ms'],
    actionEffectKeys: ['bonus_ad', 'bonus_range'],
    effectExpectations: {
      bonus_ad: {
        resultTarget: 'SOURCE',
        resultType: 'ATTRIBUTE_CHANGE',
        attributeKey: 'attack_damage',
        operation: 'INCREASE',
        modifierZoneKey: 'attribute_flat_add',
        valueParameterKey: 'bonus_attack_damage',
        durationParameterKey: 'buff_duration_ms'
      },
      bonus_range: {
        resultTarget: 'SOURCE',
        resultType: 'ATTRIBUTE_CHANGE',
        attributeKey: 'attack_range',
        operation: 'INCREASE',
        modifierZoneKey: 'attribute_flat_add',
        valueParameterKey: 'bonus_attack_range',
        durationParameterKey: 'buff_duration_ms'
      }
    },
    catalogAttributeKeys: ['attack_damage', 'attack_range'],
    name: '火力全开主动使用',
    description: '接收 twitch_r 主动使用，在 CURRENT_TARGET 上启动已有 cast 过程；过程已绑定法力、冷却、bonus_ad 和 bonus_range，两项自益效果由过程执行一次。',
    processKey: 'cast',
    actionNames: [
      { actionKey: 'start_cast', name: '启动火力全开施放过程' }
    ],
    excluded: [
      '不重复执行 mana_cost 或 cooldown；这两项属于施放过程。',
      '不新增穿刺路径、多目标伤害衰减、越程、普通攻击伤害或攻击解除伪装事件。',
      '不把 bonus_attack_damage、bonus_attack_range 或 buff_duration_ms 归档数值当作本批新增参数。',
      '不直接 EXECUTE_EFFECT bonus_ad 或 bonus_range；本条规则只启动已有 cast 过程，避免重复执行自益效果。'
    ]
  },
  vayne: {
    directoryName: '暗夜猎手R触发补录',
    characterKey: 'champion_vayne',
    characterName: '薇恩',
    skillKey: 'vayne_r',
    skillName: '终极时刻',
    ruleKey: 'on_used',
    candidateBatch: 'Cursor/英雄机制第七批',
    candidateFileName: '完整候选.json',
    sourceEvidenceFiles: [],
    clientHero: 'Vayne',
    clientPointer: 'Characters/Vayne/Spells/VayneInquisitionAbility/VayneInquisition',
    officialChampion: 'Vayne',
    officialSpellId: 'VayneInquisition',
    sourceEffectKeys: ['mana_cost', 'bonus_attack_damage'],
    sourceProcessKeys: ['cast'],
    sourceFormulaKeys: ['night_hunter_extra_over_base', 'tumble_cooldown_during_final_hour'],
    sourceParameterKeys: [
      'cooldown_ms', 'mana_cost', 'bonus_attack_damage', 'base_duration_ms',
      'night_hunter_replacement_move_speed', 'duration_extension_ms',
      'damage_marker_window_ms', 'tumble_cooldown_reduction_ratio',
      'tumble_invisibility_ms', 'ordinary_night_hunter_move_speed', 'one',
      'current_tumble_cooldown_ms'
    ],
    actionEffectKeys: ['bonus_attack_damage'],
    effectExpectations: {
      bonus_attack_damage: {
        resultTarget: 'SOURCE',
        resultType: 'ATTRIBUTE_CHANGE',
        attributeKey: 'attack_damage',
        operation: 'INCREASE',
        modifierZoneKey: 'attribute_flat_add',
        valueParameterKey: 'bonus_attack_damage',
        durationParameterKey: 'base_duration_ms'
      }
    },
    catalogAttributeKeys: ['attack_damage'],
    name: '终极时刻主动使用',
    description: '接收 vayne_r 主动使用，在 CURRENT_TARGET 上启动已有 cast 过程；过程已绑定法力、冷却和 bonus_attack_damage，自身攻击力增益由过程执行一次。',
    processKey: 'cast',
    actionNames: [{ actionKey: 'start_cast', name: '启动终极时刻施放过程' }],
    excluded: [
      '不重复执行 mana_cost 或 cooldown；这两项属于施放过程。',
      '不新增敌方命中、伤害或其他目标效果；本条只处理主动施放过程。',
      '不直接 EXECUTE_EFFECT bonus_attack_damage；本条规则只启动已有 cast 过程，避免重复执行自益效果。'
    ],
    deferred: [
      '暗夜猎手被动的移速替换及普通移速差异可能参与 1V1 计算，本条暂缓接入。',
      '闪避突袭相关冷却变化、隐身状态及隐身持续时间可能参与 1V1 计算，本条暂缓接入。',
      '本人造成伤害后的击杀延长、最大持续时间和相关判定窗口可能参与 1V1 计算，本条暂缓接入。'
    ]
  }
};

const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];

const stableStringify = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};
const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaValue = value => shaBytes(Buffer.from(stableStringify(value), 'utf8'));
const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const listData = response => Array.isArray(response?.data) ? response.data : (response?.data?.items || []);
const mapBy = (rows, key) => Object.fromEntries(rows.map(row => [row[key], row]));
const sorted = values => [...values].sort();
const sameSet = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const writeJson = (outputDir, name, value) => fs.writeFileSync(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const writeText = (outputDir, name, value) => fs.writeFileSync(path.join(outputDir, name), value.endsWith('\n') ? value : `${value}\n`, 'utf8');

function fileRecord(kind, filePath) {
  assert(fs.existsSync(filePath), `来源文件不存在：${filePath}`);
  const bytes = fs.readFileSync(filePath);
  const record = { kind, path: filePath, byteSize: bytes.byteLength, sha256: shaBytes(bytes) };
  if (filePath.toLowerCase().endsWith('.gz')) {
    const expanded = gunzipSync(bytes);
    record.decompressedByteSize = expanded.byteLength;
    record.decompressedSha256 = shaBytes(expanded);
  }
  return record;
}

function pick(value, keys) {
  return Object.fromEntries(keys.filter(key => value && Object.prototype.hasOwnProperty.call(value, key)).map(key => [key, value[key]]));
}

function readClientExcerpt(config, clientPath) {
  const bytes = fs.readFileSync(clientPath);
  const document = JSON.parse(gunzipSync(bytes));
  const object = document[config.clientPointer];
  const spell = object?.mSpell;
  if (!spell) return { objectPath: config.clientPointer, found: false };
  return {
    objectPath: config.clientPointer,
    found: true,
    objectName: object.ObjectName || null,
    scriptName: object.mScriptName || null,
    dataValues: spell.DataValues || [],
    cooldownTime: spell.cooldownTime || [],
    cooldown: spell.Cooldown || null,
    mana: spell.mana || [],
    manaValues: spell.manaValues || null,
    spellCastTime: spell.spellCastTime ?? null,
    spellTotalTime: spell.spellTotalTime ?? null,
    castRange: spell.castRange || [],
    castRangeValues: spell.castRangeValues || [],
    castRadius: spell.castRadius || [],
    missileSpeed: spell.missileSpeed ?? null,
    spellTags: spell.mSpellTags || [],
    targetingTypeData: spell.mTargetingTypeData || null,
    spellCalculationKeys: Object.keys(spell.mSpellCalculations || {})
  };
}

function readOfficialExcerpt(config, officialPath) {
  const document = readJson(officialPath);
  const spell = document.data?.[config.officialChampion]?.spells?.find(item => item.id === config.officialSpellId);
  if (!spell) return { pointer: `data/${config.officialChampion}/spells[id=${config.officialSpellId}]`, found: false };
  return {
    pointer: `data/${config.officialChampion}/spells[id=${config.officialSpellId}]`,
    found: true,
    spell: pick(spell, ['id', 'name', 'description', 'tooltip', 'leveltip', 'maxrank', 'cooldown', 'cost', 'effect', 'effectBurn', 'image', 'resource'])
  };
}

function findNode(value, predicate) {
  if (!value || typeof value !== 'object') return false;
  if (predicate(value)) return true;
  return Array.isArray(value) ? value.some(item => findNode(item, predicate)) : Object.values(value).some(item => findNode(item, predicate));
}

function sourceSemantic(config, candidateSkill) {
  const write = candidateSkill?.write || {};
  const effects = Array.isArray(write.effects) ? write.effects : [];
  const effectMap = mapBy(effects, 'effectKey');
  const checks = {
    candidatePresent: Boolean(candidateSkill),
    sourceEffectKeys: sameSet(effects.map(item => item.effectKey), config.sourceEffectKeys),
    sourceParameterKeys: sameSet((write.parameters || []).map(item => item.parameterKey), config.sourceParameterKeys),
    sourceFormulaKeys: sameSet((write.formulas || []).map(item => item.formulaKey), config.sourceFormulaKeys),
    sourceProcessKeys: sameSet((write.processes || []).map(item => item.processKey), config.sourceProcessKeys)
  };
  const effectChecks = {};
  for (const [effectKey, expectation] of Object.entries(config.effectExpectations)) {
    const effect = effectMap[effectKey];
    const result = effect?.results?.[0];
    const duration = effect?.lifecycle?.durationValue;
    const value = result?.valueRule?.value;
    effectChecks[effectKey] = {
      effectPresent: Boolean(effect),
      exactlyOneResult: Array.isArray(effect?.results) && effect.results.length === 1,
      resultType: result?.resultType === expectation.resultType,
      resultTarget: result?.target === expectation.resultTarget,
      attributeKey: result?.detail?.attributeKey === expectation.attributeKey,
      operation: result?.detail?.operation === expectation.operation,
      modifierZoneKey: result?.detail?.modifierZoneKey === expectation.modifierZoneKey,
      valueParameter: value?.kind === 'PARAMETER' && value.parameterKey === expectation.valueParameterKey,
      durationParameter: duration?.kind === 'PARAMETER' && duration.parameterKey === expectation.durationParameterKey
    };
  }
  checks.actionEffectSemantics = Object.values(effectChecks).every(check => Object.values(check).every(Boolean));
  checks.all = Object.values(checks).every(value => value === true);
  return {
    checks,
    effectChecks,
    componentKeys: {
      parameters: (write.parameters || []).map(item => item.parameterKey),
      formulas: (write.formulas || []).map(item => item.formulaKey),
      effects: effects.map(item => item.effectKey),
      processes: (write.processes || []).map(item => item.processKey),
      internalStates: (write.internalStates || []).map(item => item.stateKey),
      triggerRules: (write.triggerRules || []).map(item => item.ruleKey)
    }
  };
}

function bodyForRule(config) {
  return {
    ruleKey: config.ruleKey,
    name: config.name,
    description: config.description,
    sortOrder: 10,
    eventSource: {
      eventType: 'SKILL_USED',
      detail: { sourceSkillKey: config.skillKey, useKind: 'ACTIVE' }
    },
    conditionGroups: [],
    actions: config.actionNames.map((action, index) => ({
      actionKey: action.actionKey,
      name: action.name,
      actionType: 'START_PROCESS',
      sortOrder: (index + 1) * 10,
      targetContext: 'CURRENT_TARGET',
      detail: { processKey: config.processKey },
      runtimeInputBindings: [],
      resultModifiers: []
    })),
    perTargetCooldown: null,
    maxTriggersPerProcess: null
  };
}

async function runForDirectory(outputDir, configKey) {
  const config = CONFIGS[configKey];
  assert(config, `未知候选配置：${configKey}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const token = crypto.randomUUID();
  assert(token && token.trim(), '运行时令牌生成失败');
  const statusCounts = {};
  const requestLog = [];
  let getCount = 0;
  const get = async (route) => {
    const response = await fetch(`${baseUrl}${route}`, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${token}` }
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = { rawText: raw }; }
    getCount += 1;
    const status = String(response.status);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    const record = { method: 'GET', route, status: response.status, data };
    requestLog.push(record);
    return record;
  };

  const candidatePath = path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', config.candidateBatch, config.candidateFileName);
  const clientPath = path.join(planning, '数据参考', '全量录入-2026-09', '技能公共参数实录', '客户端原文', `${config.clientHero}.json.gz`);
  const officialPath = path.join(planning, '数据参考', '全量录入-2026-09', '英雄', '原始资料', 'zh_CN', 'champion', `${config.clientHero}.json`);
  const sourceIndexPath = path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', config.candidateBatch, '来源冻结', '来源与哈希汇总.json');
  const sourceFiles = [
    fileRecord('归档候选组成', candidatePath),
    fileRecord('16.17客户端原始资料', clientPath),
    fileRecord('16.17.1官方中文资料', officialPath),
    fileRecord('归档来源冻结索引', sourceIndexPath)
  ];
  for (const evidence of config.sourceEvidenceFiles || []) {
    sourceFiles.push(fileRecord(evidence.kind, path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', evidence.relativePath)));
  }
  const candidateDocument = readJson(candidatePath);
  const candidateSkill = candidateDocument.skills?.[config.skillKey] || null;
  const source = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    sourcePolicy: '固定客户端16.17与官方16.17.1；归档候选只作来源证据，不覆盖实时接口现值。',
    methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
    authorizationValueRecorded: false,
    sourceFiles,
    candidate: {
      path: candidatePath,
      fileSha256: shaBytes(fs.readFileSync(candidatePath)),
      revision: candidateDocument.revision || candidateDocument.meta?.revision || null,
      skill: candidateSkill
    },
    client: readClientExcerpt(config, clientPath),
    official: readOfficialExcerpt(config, officialPath),
    sourceSemantic: sourceSemantic(config, candidateSkill),
    archiveChecks: {
      candidateSkillPresent: Boolean(candidateSkill),
      clientPointerPresent: readClientExcerpt(config, clientPath).found,
      officialSpellPresent: readOfficialExcerpt(config, officialPath).found,
      clientVersionFixed: true,
      officialVersionFixed: true
    },
    fixedFacts: {
      clientVersion: '16.17',
      officialVersion: '16.17.1',
      skillKey: config.skillKey,
      ruleKey: config.ruleKey,
      eventType: 'SKILL_USED',
      useKind: 'ACTIVE',
      actionEffectKeys: config.actionEffectKeys,
      actionType: 'START_PROCESS',
      processKey: config.processKey,
      actionResultTargets: Object.fromEntries(Object.entries(config.effectExpectations).map(([key, value]) => [key, value.resultTarget])),
      deferred: config.deferred || []
    }
  };
  const sourceSnapshotSha256 = shaValue(source);
  writeJson(outputDir, '03-来源快照.json', source);

  async function readComponents(skillKey) {
    const result = {};
    for (const [component, keyField] of componentKinds) {
      const list = await get(`/skills/${encodeURIComponent(skillKey)}/${component}`);
      const rows = listData(list);
      const details = [];
      for (const row of rows) {
        const key = row[keyField];
        details.push({ key, response: await get(`/skills/${encodeURIComponent(skillKey)}/${component}/${encodeURIComponent(key)}`) });
      }
      result[component] = { list, keys: rows.map(row => row[keyField]), details };
    }
    return result;
  }

  const relationRoute = `/character-skill-relations?characterKey=${encodeURIComponent(config.characterKey)}`;
  const staticRoutes = [
    `/characters/${encodeURIComponent(config.characterKey)}`,
    `/characters/${encodeURIComponent(config.characterKey)}/attributes`,
    `/characters/${encodeURIComponent(config.characterKey)}/representative-image`,
    relationRoute,
    `/skills/${encodeURIComponent(config.skillKey)}`,
    `/skills/${encodeURIComponent(config.skillKey)}/representative-image`
  ];
  const staticResponses = {};
  for (const route of staticRoutes) staticResponses[route] = await get(route);
  const components = await readComponents(config.skillKey);
  const candidateRoute = `/skills/${encodeURIComponent(config.skillKey)}/trigger-rules/${encodeURIComponent(config.ruleKey)}`;
  const candidateDetail = await get(candidateRoute);
  const relationRows = listData(staticResponses[relationRoute]);
  const target = {
    characterKey: config.characterKey,
    skillKey: config.skillKey,
    staticResponses,
    relationRows,
    components,
    candidateDetail,
    targetRuleKeysBefore: components['trigger-rules'].keys,
    existingEffectKeys: components.effects.keys
  };

  const catalogs = { attributes: {}, modifierZones: {} };
  catalogs.attributes.list = await get('/attributes');
  catalogs.attributes.details = {};
  for (const key of config.catalogAttributeKeys) catalogs.attributes.details[key] = await get(`/attributes/${encodeURIComponent(key)}`);
  catalogs.modifierZones.list = await get('/modifier-zones');
  catalogs.modifierZones.details = { attribute_flat_add: await get('/modifier-zones/attribute_flat_add') };

  function detailData(targetComponents, component, key) {
    return targetComponents[component]?.details.find(item => item.key === key)?.response?.data;
  }

  function validateEffect(targetComponents, effectKey, expectation) {
    const effect = detailData(targetComponents, 'effects', effectKey);
    const result = effect?.results?.[0];
    const duration = effect?.lifecycle?.durationValue;
    const value = result?.valueRule?.value;
    return {
      effectPresent: Boolean(effect),
      exactlyOneResult: Array.isArray(effect?.results) && effect.results.length === 1,
      resultType: result?.resultType === expectation.resultType,
      resultTarget: result?.target === expectation.resultTarget,
      attributeKey: result?.detail?.attributeKey === expectation.attributeKey,
      operation: result?.detail?.operation === expectation.operation,
      modifierZoneKey: result?.detail?.modifierZoneKey === expectation.modifierZoneKey,
      valueParameter: value?.kind === 'PARAMETER' && value.parameterKey === expectation.valueParameterKey,
      durationParameter: duration?.kind === 'PARAMETER' && duration.parameterKey === expectation.durationParameterKey
    };
  }

  const targetEffectChecks = Object.fromEntries(Object.entries(config.effectExpectations).map(([key, value]) => [key, validateEffect(components, key, value)]));
  const castProcess = detailData(components, 'processes', config.processKey);
  const castEffectBindings = Array.isArray(castProcess?.effectBindings) ? castProcess.effectBindings : [];
  const castEffectBindingKeys = castEffectBindings.map(binding => binding.effectKey);
  const castCooldown = castProcess?.cooldown;
  const castCooldownDuration = castCooldown?.durationValue;
  const processBinding = effectKey => castEffectBindings.find(binding => binding.effectKey === effectKey);
  const castProcessCheck = {
    processPresent: Boolean(castProcess),
    activeProcess: castProcess?.activationType === 'ACTIVE',
    cooldownPresent: Boolean(castCooldown),
    cooldownParameter: castCooldownDuration?.kind === 'PARAMETER' && castCooldownDuration.parameterKey === 'cooldown_ms',
    cooldownStartsAtProcessStart: castCooldown?.startMoment?.momentType === 'PROCESS_START',
    exactEffectBindings: sameSet(castEffectBindingKeys, config.sourceEffectKeys),
    manaEffectBound: processBinding('mana_cost')?.moment?.momentType === 'PROCESS_START',
    actionEffectsBound: config.actionEffectKeys.every(effectKey => {
      const momentType = processBinding(effectKey)?.moment?.momentType;
      return momentType === 'STEP_EXECUTION' || momentType === 'STEP_COMPLETE';
    })
  };
  const targetStaticStatusPass = staticRoutes.every(route => staticResponses[route].status === 200);
  const targetChecks = {
    characterSubject: staticResponses[staticRoutes[0]].status === 200 && staticResponses[staticRoutes[0]].data?.characterKey === config.characterKey,
    characterAttributes: staticResponses[staticRoutes[1]].status === 200,
    characterRepresentativeImage: staticResponses[staticRoutes[2]].status === 200 && staticResponses[staticRoutes[2]].data?.image?.enabled === true,
    characterSkillRelation: staticResponses[relationRoute].status === 200 && relationRows.some(row => row.skillKey === config.skillKey),
    skillSubject: staticResponses[staticRoutes[4]].status === 200 && staticResponses[staticRoutes[4]].data?.skillKey === config.skillKey,
    skillRepresentativeImage: staticResponses[staticRoutes[5]].status === 200 && staticResponses[staticRoutes[5]].data?.image?.enabled === true,
    candidateAbsent: candidateDetail.status === 404,
    targetRuleBaselineEmpty: components['trigger-rules'].keys.length === 0,
    sourceActionEffectsPresent: config.actionEffectKeys.every(key => components.effects.keys.includes(key)),
    sourceActionEffectSemantics: Object.values(targetEffectChecks).every(check => Object.values(check).every(Boolean)),
    castProcessSemantics: Object.values(castProcessCheck).every(value => value === true),
    requiredParametersPresent: config.actionEffectKeys.every(effectKey => {
      const expected = config.effectExpectations[effectKey];
      return components.parameters.keys.includes(expected.valueParameterKey) && components.parameters.keys.includes(expected.durationParameterKey);
    }),
    allTargetListsReadable: componentKinds.every(([component]) => components[component].list.status === 200),
    allTargetDetailsReadable: componentKinds.every(([component]) => components[component].details.every(item => item.response.status === 200)),
    staticRoutesReadable: targetStaticStatusPass
  };
  targetChecks.triggerDependenciesReady = targetChecks.sourceActionEffectsPresent && targetChecks.sourceActionEffectSemantics && targetChecks.castProcessSemantics && targetChecks.requiredParametersPresent;
  targetChecks.all = Object.values(targetChecks).every(value => value === true);

  function scanStats(scan) {
    const eventTypeCounts = {};
    let sourceInitializedCount = 0;
    let detailStatus200Count = 0;
    for (const skill of scan.perSkill) {
      for (const detail of skill.details) {
        if (detail.response.status === 200) detailStatus200Count += 1;
        const eventType = detail.response.data?.eventSource?.eventType || 'UNKNOWN';
        eventTypeCounts[eventType] = (eventTypeCounts[eventType] || 0) + 1;
        if (eventType === 'SOURCE_INITIALIZED') sourceInitializedCount += 1;
      }
    }
    return { skillCount: scan.skillCount, ruleCount: scan.ruleCount, eventTypeCounts, sourceInitializedCount, detailStatus200Count };
  }

  async function scanRules() {
    const skillList = await get('/skills');
    const skills = listData(skillList);
    const perSkill = [];
    let ruleCount = 0;
    for (const skill of skills) {
      const skillKey = skill.skillKey;
      const list = await get(`/skills/${encodeURIComponent(skillKey)}/trigger-rules`);
      const rows = listData(list);
      const details = [];
      for (const row of rows) {
        const ruleKey = row.ruleKey;
        const detail = await get(`/skills/${encodeURIComponent(skillKey)}/trigger-rules/${encodeURIComponent(ruleKey)}`);
        details.push({ ruleKey, response: detail });
        ruleCount += 1;
      }
      perSkill.push({ skillKey, list, ruleKeys: rows.map(row => row.ruleKey), details });
    }
    return {
      skillList,
      skillCount: skills.length,
      skillKeys: skills.map(skill => skill.skillKey),
      ruleCount,
      perSkill,
      stats: scanStats({ skillCount: skills.length, ruleCount, perSkill })
    };
  }

  const firstScan = await scanRules();
  const secondScan = await scanRules();
  const scanPairs = scan => scan.perSkill.flatMap(skill => skill.ruleKeys.map(ruleKey => `${skill.skillKey}/${ruleKey}`)).sort();
  const firstPairs = scanPairs(firstScan);
  const secondPairs = scanPairs(secondScan);
  const oldRuleDigest = scan => shaValue(scan.perSkill.map(skill => ({
    skillKey: skill.skillKey,
    ruleKeys: skill.ruleKeys,
    details: skill.details.map(item => ({ ruleKey: item.ruleKey, status: item.response.status, data: item.response.data }))
  })));
  const firstStats = firstScan.stats;
  const secondStats = secondScan.stats;
  const globalChecks = {
    firstSkillList200: firstScan.skillList.status === 200,
    secondSkillList200: secondScan.skillList.status === 200,
    firstSkillCount: firstStats.skillCount === 1062,
    secondSkillCount: secondStats.skillCount === 1062,
    firstRuleCount: firstStats.ruleCount === 108,
    secondRuleCount: secondStats.ruleCount === 108,
    firstRuleDetails200: firstStats.detailStatus200Count === firstStats.ruleCount,
    secondRuleDetails200: secondStats.detailStatus200Count === secondStats.ruleCount,
    stableSkillKeys: shaValue(firstScan.skillKeys) === shaValue(secondScan.skillKeys),
    stableRuleKeys: JSON.stringify(firstPairs) === JSON.stringify(secondPairs),
    stableRuleDetails: oldRuleDigest(firstScan) === oldRuleDigest(secondScan),
    firstSourceInitializedCount: firstStats.sourceInitializedCount === 24,
    secondSourceInitializedCount: secondStats.sourceInitializedCount === 24
  };
  globalChecks.old108Unchanged = globalChecks.firstRuleCount && globalChecks.secondRuleCount && globalChecks.firstRuleDetails200 && globalChecks.secondRuleDetails200 && globalChecks.stableRuleKeys && globalChecks.stableRuleDetails;
  globalChecks.all = Object.values(globalChecks).every(value => value === true);

  const body = bodyForRule(config);
  const sourceReady = source.sourceSemantic.checks.all === true && Object.values(source.archiveChecks).every(value => value === true);
  const requestEligible = sourceReady && targetChecks.triggerDependenciesReady && globalChecks.old108Unchanged && globalChecks.firstSourceInitializedCount && globalChecks.secondSourceInitializedCount && targetChecks.candidateAbsent && targetChecks.targetRuleBaselineEmpty;
  const globalStable = globalChecks.old108Unchanged && globalChecks.stableSkillKeys && globalChecks.firstSourceInitializedCount && globalChecks.secondSourceInitializedCount;
  const status = !globalStable || !targetChecks.candidateAbsent || !targetChecks.targetRuleBaselineEmpty
    ? 'REVISE'
    : requestEligible ? 'READY_FOR_INDEPENDENT_REVIEW' : 'DEFERRED';
  const frozen = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    writable: requestEligible,
    methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
    authorizationValueRecorded: false,
    sourceVersion: { client: '16.17', official: '16.17.1' },
    sourceSnapshotSha256,
    expectedCurrent: { skillCount: 1062, ruleCount: 108, sourceInitializedCount: 24 },
    observedCurrent: { first: firstStats, second: secondStats, oldRuleKeysSha256: shaValue(firstPairs), oldRuleDetailsSha256: oldRuleDigest(firstScan) },
    targetBefore: {
      characterKey: config.characterKey,
      skillKey: config.skillKey,
      ruleKey: config.ruleKey,
      targetRuleKeys: target.targetRuleKeysBefore,
      existingEffectKeys: target.existingEffectKeys,
      candidateDetailStatus: candidateDetail.status,
      triggerDependenciesReady: targetChecks.triggerDependenciesReady
    },
    plannedWrites: requestEligible ? 1 : 0,
    writes: requestEligible ? [{
      id: `${config.skillKey}/${config.ruleKey}`,
      kind: '新增触发规则',
      method: 'POST',
      route: `/skills/${config.skillKey}/trigger-rules`,
      detailRoute: `/skills/${config.skillKey}/trigger-rules/${config.ruleKey}`,
      expectedStatus: 201,
      body,
      bodySha256: shaValue(body)
    }] : [],
    proposedRequest: requestEligible ? body : null,
    conditionalRequest: sourceReady ? {
      method: 'POST',
      route: `/skills/${config.skillKey}/trigger-rules`,
      detailRoute: `/skills/${config.skillKey}/trigger-rules/${config.ruleKey}`,
      expectedStatus: 201,
      body,
      bodySha256: shaValue(body),
      executable: false,
      condition: '仅当实时参数、效果结果、持续时间字段、目标与触发规则保护门槛全部通过后，才可升级为冻结请求；本轮未发送。'
    } : null,
    conflicts: [],
    deferredReasons: requestEligible ? [] : [
      ...(sourceReady ? [] : ['归档候选的参数、公式、效果或过程语义未能完整核对，或固定资料指针未命中。']),
      ...(targetChecks.triggerDependenciesReady ? [] : ['实时目标缺少触发动作依赖的参数、效果或 ACTIVE cast 过程绑定。']),
      ...(globalStable ? [] : ['全局108条旧规则或24条 SOURCE_INITIALIZED 保护基线未通过。']),
      ...(targetChecks.candidateAbsent ? [] : ['候选详情不是404。'])
    ],
    excluded: config.excluded,
    deferredScope: config.deferred || []
  };
  const frozenRequestSha256 = shaValue(frozen);
  writeJson(outputDir, '02-冻结请求.json', frozen);

  const writeBefore = {
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    status,
    baseUrl,
    requestPolicy: { method: 'GET', businessMethodsSent: [], authorizationValueRecorded: false, businessWritesIssued: 0 },
    sourceSnapshotSha256,
    frozenRequestSha256,
    expectedCurrent: { skillCount: 1062, ruleCount: 108, sourceInitializedCount: 24 },
    targetSnapshot: target,
    targetChecks,
    targetEffectChecks,
    castProcessCheck,
    sourceComposition: source.sourceSemantic,
    archiveChecks: source.archiveChecks,
    protectionCatalogs: catalogs,
    triggerRuleBaseline: firstScan,
    triggerRuleStableSecondScan: secondScan,
    protection: {
      firstRuleKeysSha256: shaValue(firstPairs),
      secondRuleKeysSha256: shaValue(secondPairs),
      firstRuleDetailsSha256: oldRuleDigest(firstScan),
      secondRuleDetailsSha256: oldRuleDigest(secondScan),
      old108Unchanged: globalChecks.old108Unchanged,
      firstSourceInitializedCount: firstStats.sourceInitializedCount,
      secondSourceInitializedCount: secondStats.sourceInitializedCount,
      targetCandidateStatus: candidateDetail.status,
      targetExistingRuleKeys: target.targetRuleKeysBefore,
      targetStaticSha256: shaValue(target.staticResponses),
      targetComponentsSha256: shaValue(target.components)
    },
    globalChecks,
    getCount,
    statusCounts,
    businessWrites: 0,
    requestLedger: requestLog.map(({ method, route, status: responseStatus }) => ({ method, route, status: responseStatus }))
  };
  writeJson(outputDir, '04-写入前现值.json', writeBefore);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    recommendedStatus: status,
    recommendation: status,
    methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
    authorizationValueRecorded: false,
    fixedVersion: '16.17.1',
    scope: {
      skillKey: config.skillKey,
      skillName: config.skillName,
      ruleKey: config.ruleKey,
      eventType: 'SKILL_USED',
      sourceSkillKey: config.skillKey,
      useKind: 'ACTIVE',
      actionEffectKeys: config.actionEffectKeys,
      actionType: 'START_PROCESS',
      processKey: config.processKey,
      actionTargetContext: 'CURRENT_TARGET',
      actionResultTargets: Object.fromEntries(Object.entries(config.effectExpectations).map(([key, expectation]) => [key, expectation.resultTarget])),
      skippedEffects: config.excluded,
      deferredScope: config.deferred || []
    },
    checks: {
      ...targetChecks,
      globalOld108Unchanged: globalChecks.old108Unchanged,
      globalTwoPassStable: globalStable,
      sourceSemanticComplete: sourceReady,
      archiveChecksComplete: Object.values(source.archiveChecks).every(value => value === true),
      noBusinessWrite: true
    },
    source: {
      snapshotFile: '03-来源快照.json',
      snapshotSha256: sourceSnapshotSha256,
      candidateFileSha256: source.candidate.fileSha256,
      clientSha256: sourceFiles.find(item => item.kind === '16.17客户端原始资料').sha256,
      clientDecompressedSha256: sourceFiles.find(item => item.kind === '16.17客户端原始资料').decompressedSha256,
      officialSha256: sourceFiles.find(item => item.kind === '16.17.1官方中文资料').sha256
    },
    getSummary: {
      getCount,
      businessWrites: 0,
      statusCounts,
      targetGetCount: requestLog.filter(item => item.route.includes('/characters/') || item.route.includes('/character-skill-relations') || item.route.includes(`/skills/${config.skillKey}`)).length,
      globalSkillListGetCount: requestLog.filter(item => item.route === '/skills').length,
      globalTriggerRuleListGetCount: requestLog.filter(item => item.route.endsWith('/trigger-rules')).length,
      globalTriggerRuleDetailGetCount: requestLog.filter(item => item.route.includes('/trigger-rules/') && item.route !== candidateRoute).length,
      candidateDetailGetCount: requestLog.filter(item => item.route === candidateRoute).length,
      catalogGetCount: requestLog.filter(item => item.route === '/attributes' || item.route.startsWith('/attributes/') || item.route === '/modifier-zones' || item.route.startsWith('/modifier-zones/')).length
    },
    observedCurrent: {
      first: firstStats,
      second: secondStats,
      oldRuleKeysSha256: shaValue(firstPairs),
      oldRuleDetailsSha256: oldRuleDigest(firstScan),
      targetRuleKeys: target.targetRuleKeysBefore,
      targetComponentKeys: Object.fromEntries(componentKinds.map(([component]) => [component, components[component].keys])),
      targetEffectChecks,
      castProcessCheck
    },
    candidate: {
      ruleKey: config.ruleKey,
      detailRoute: candidateRoute,
      preflightStatus: candidateDetail.status,
      frozenRequestFile: '02-冻结请求.json',
      frozenRequestSha256,
      proposedRequest: requestEligible ? body : null,
      conditionalRequestBody: sourceReady ? body : null,
      conditionalRequestBodySha256: sourceReady ? shaValue(body) : null
    },
    conflicts: [],
    deferred: frozen.deferredReasons,
    deferredScope: config.deferred || [],
    excluded: config.excluded
  };
  writeJson(outputDir, '05-只读准备报告.json', report);

  const statusText = status === 'READY_FOR_INDEPENDENT_REVIEW'
    ? '本轮实时依赖已齐全，条件请求可以交给独立评审。'
    : status === 'DEFERRED'
      ? '本轮标记为 DEFERRED：归档或实时语义仍有缺口，不能冻结可写请求。'
      : '本轮标记为 REVISE：保护基线或候选唯一性检查未通过。';
  const experience = [
    `# ${config.directoryName}体验报告`,
    '',
    statusText,
    '',
    `- 目标技能：\`${config.skillKey}\`；规则键：\`${config.ruleKey}\`；事件：\`SKILL_USED\` 且 \`useKind=ACTIVE\`。`,
    `- 本轮只发送 GET，共 ${getCount} 次；返回码统计：${JSON.stringify(statusCounts)}；业务写入次数为 0。`,
    `- 全局两轮读取：第一轮 ${firstStats.skillCount} 个技能、${firstStats.ruleCount} 条规则；第二轮 ${secondStats.skillCount} 个技能、${secondStats.ruleCount} 条规则；旧108条规则详情散列 ${oldRuleDigest(firstScan)} 与 ${oldRuleDigest(secondScan)}。`,
    `- 两轮 \`SOURCE_INITIALIZED\` 数量分别为 ${firstStats.sourceInitializedCount} 和 ${secondStats.sourceInitializedCount}；候选详情 \`${candidateRoute}\` 返回 ${candidateDetail.status}。`,
    `- 实时组件现值：参数 ${components.parameters.keys.length}、公式 ${components.formulas.keys.length}、效果 ${components.effects.keys.length}、过程 ${components.processes.keys.length}、内部状态 ${components['internal-states'].keys.length}、触发规则 ${components['trigger-rules'].keys.length}。`,
    '',
    '## 语义核对',
    '',
    `归档候选中的动作效果为：${config.actionEffectKeys.map(key => `\`${key}\``).join('、')}。脚本逐一核对结果类型、结果目标、属性键、属性操作、属性乘区、参数引用和持续时间参数；核对详情保存在“03-来源快照.json”和“05-只读准备报告.json”。`,
    `当前 GET 已读取这些效果、参数和 ACTIVE \`${config.processKey}\` 过程；条件请求只启动该过程，由过程负责法力、冷却和自益效果，未直接重复执行效果。`,
    ...(config.deferred?.length ? [`相关但暂缓的组成：${config.deferred.join('；')}`] : []),
    '',
    '## 体验问题与后续门槛',
    '',
    '- 管理页需要同时呈现过程及其效果绑定，录入人才能判断应启动 cast 过程，而不是再次直接执行已绑定效果。',
    '- 归档候选的数值和效果不能代替实时数据库现值；每次录入前仍需重新读取目标参数、效果、结果生命周期和施放过程。',
    '- 本次没有浏览器写入、业务写入、运行时或 Wasm 验证；该报告只说明资料、管理接口 GET 和录入前保护证据。',
    '',
    `详细 GET 账本和完整旧规则回读见 \`04-写入前现值.json\`；本轮结论见 \`05-只读准备报告.json\`。`
  ].join('\n');
  writeText(outputDir, '06-体验报告.md', experience);
  console.log(JSON.stringify({
    status,
    skillKey: config.skillKey,
    ruleKey: config.ruleKey,
    getCount,
    statusCounts,
    skillCount: firstStats.skillCount,
    firstRuleCount: firstStats.ruleCount,
    secondRuleCount: secondStats.ruleCount,
    sourceInitializedCount: firstStats.sourceInitializedCount,
    secondSourceInitializedCount: secondStats.sourceInitializedCount,
    candidateStatus: candidateDetail.status,
    old108Unchanged: globalChecks.old108Unchanged,
    businessWrites: 0,
    conditionalRequestBodySha256: sourceReady ? shaValue(body) : null
  }));
}

const invokedDirectly = path.resolve(process.argv[1] || '') === path.resolve(scriptPath);
if (invokedDirectly) {
  const configKey = Object.entries(CONFIGS).find(([, config]) => config.directoryName === path.basename(sharedHere))?.[0];
  if (!configKey) throw new Error(`当前目录没有对应候选配置：${sharedHere}`);
  await runForDirectory(sharedHere, configKey);
}

export { runForDirectory };
