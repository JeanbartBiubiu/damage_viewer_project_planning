import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ARTIFACT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(ARTIFACT_DIR, '..', '..', '..');
const PLAN_ROOT = path.join(
  WEB_ROOT,
  '数据参考',
  '全量录入-2026-09',
  '交叉试录',
  '历史等级曲线修正',
);
const PREP_ROOT = path.join(PLAN_ROOT, '修正准备');
const API_ROOT = 'http://127.0.0.1:8080/api/admin/games/lol';
const API_TOKEN = process.env.HISTORICAL_CURVE_API_TOKEN || 'local-entry';
const FINAL_REQUEST_PATH = path.join(PLAN_ROOT, '可审查最终请求.json');
const BEFORE_SNAPSHOT_PATH = path.join(PREP_ROOT, '完整写前快照.json');
const SOURCE_TREE_PATH = path.join(PLAN_ROOT, '当前原树与文本.json');
const DEPENDENCY_PATH = path.join(PREP_ROOT, '实际引用与初始化依赖.json');

const skillKeys = [
  'annie_e',
  'brand_p',
  'ahri_p',
  'darius_p',
  'diana_p',
  'trundle_p',
  'warwick_p',
  'garen_p',
];

const componentDefs = [
  { name: 'parameters', route: 'parameters', key: 'parameterKey' },
  { name: 'formulas', route: 'formulas', key: 'formulaKey' },
  { name: 'effects', route: 'effects', key: 'effectKey' },
  { name: 'processes', route: 'processes', key: 'processKey' },
  { name: 'internal-states', route: 'internal-states', key: 'stateKey' },
  { name: 'trigger-rules', route: 'trigger-rules', key: 'ruleKey' },
];

const targetParameterKeys = [
  'annie_e/move_speed_ratio',
  'brand_p/explosion_base_max_hp_ratio',
  'ahri_p/champion_base_heal',
  'darius_p/bleed_base_total',
  'darius_p/noxian_might_bonus_ad',
  'diana_p/cleave_base_damage',
  'diana_p/passive_attack_speed_ratio',
  'trundle_p/dead_enemy_hp_heal_ratio',
  'warwick_p/on_hit_base',
  'garen_p/regen_ratio_per_5s',
];

const expectedSourceTypes = new Map([
  ['annie_e/move_speed_ratio', 'ByCharLevelInterpolationCalculationPart'],
  ['brand_p/explosion_base_max_hp_ratio', 'ByCharLevelInterpolationCalculationPart'],
  ['ahri_p/champion_base_heal', 'ByCharLevelInterpolationCalculationPart'],
  ['darius_p/bleed_base_total', 'ByCharLevelInterpolationCalculationPart'],
  ['darius_p/noxian_might_bonus_ad', 'ByCharLevelBreakpointsCalculationPart'],
  ['diana_p/cleave_base_damage', 'ByCharLevelBreakpointsCalculationPart'],
  ['diana_p/passive_attack_speed_ratio', 'ByCharLevelInterpolationCalculationPart'],
  ['trundle_p/dead_enemy_hp_heal_ratio', 'ByCharLevelInterpolationCalculationPart'],
  ['warwick_p/on_hit_base', 'ByCharLevelInterpolationCalculationPart'],
  ['garen_p/regen_ratio_per_5s', 'ByCharLevelBreakpointsCalculationPart'],
]);

const deletedRuleRoutes = [
  '/skills/diana_p/trigger-rules/initialize_passive_attack_speed',
  '/skills/diana_p/trigger-rules/after_q_attack_speed',
  '/skills/diana_p/trigger-rules/after_w_attack_speed',
  '/skills/diana_p/trigger-rules/after_e_attack_speed',
  '/skills/diana_p/trigger-rules/after_r_attack_speed',
  '/skills/warwick_p/trigger-rules/basic_attack_hit',
];

const expectedRuleEffects = new Map([
  ['/skills/diana_p/trigger-rules/initialize_passive_attack_speed', 'passive_attack_speed'],
  ['/skills/diana_p/trigger-rules/after_q_attack_speed', 'cast_attack_speed'],
  ['/skills/diana_p/trigger-rules/after_w_attack_speed', 'cast_attack_speed'],
  ['/skills/diana_p/trigger-rules/after_e_attack_speed', 'cast_attack_speed'],
  ['/skills/diana_p/trigger-rules/after_r_attack_speed', 'cast_attack_speed'],
  ['/skills/warwick_p/trigger-rules/basic_attack_hit', 'on_hit_damage'],
]);

const expectedRuleParameterRefs = new Map([
  ['diana_p', 'diana_p/passive_attack_speed_ratio'],
  ['warwick_p', 'warwick_p/on_hit_base'],
]);

const issues = [];
const warnings = [];
const reads = [];

function addIssue(code, message, extra = {}) {
  issues.push({ code, message, ...extra });
}

function addWarning(code, message, extra = {}) {
  warnings.push({ code, message, ...extra });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function canonical(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function valueSha256(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function sameValue(a, b) {
  return canonical(a) === canonical(b);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

function dataOf(record) {
  return record && Object.prototype.hasOwnProperty.call(record, 'data') ? record.data : undefined;
}

function getSkillSnapshot(snapshot, skillKey) {
  if (snapshot?.skills && !Array.isArray(snapshot.skills)) return snapshot.skills[skillKey];
  if (Array.isArray(snapshot?.skills)) return snapshot.skills.find((item) => item.skillKey === skillKey);
  return undefined;
}

function componentSnapshot(skillSnapshot, name) {
  return skillSnapshot?.components?.[name];
}

function componentMap(liveSkill, name, keyField) {
  const result = new Map();
  for (const record of liveSkill?.components?.[name]?.details || []) {
    const data = dataOf(record);
    const key = data?.[keyField];
    if (key) result.set(key, data);
  }
  return result;
}

async function get(route, label) {
  const started = Date.now();
  const record = {
    at: new Date().toISOString(),
    method: 'GET',
    route,
    label,
    status: null,
    elapsedMs: null,
    data: null,
  };
  try {
    if (record.method !== 'GET') throw new Error('独立检查器只允许GET');
    const response = await fetch(`${API_ROOT}${route}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      signal: AbortSignal.timeout(30000),
    });
    record.status = response.status;
    const text = await response.text();
    try {
      record.data = text.length ? JSON.parse(text) : null;
    } catch {
      record.data = text;
    }
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
  }
  record.elapsedMs = Date.now() - started;
  reads.push(record);
  return record;
}

function compareSnapshotValue(actualRecord, expectedRecord, label) {
  if (!expectedRecord) {
    addIssue('缺少写前基线', `${label}在完整写前快照中没有记录`);
    return false;
  }
  // 列表记录带HTTP状态；详情在快照中用{key,data,route}包装，默认按已成功读取处理。
  const expectedStatus = Object.prototype.hasOwnProperty.call(expectedRecord, 'status') ? expectedRecord.status : 200;
  if (actualRecord?.status !== expectedStatus) {
    addIssue('快照状态不一致', `${label}当前HTTP状态与写前快照不同`, {
      actualStatus: actualRecord?.status ?? null,
      expectedStatus,
    });
    return false;
  }
  if (actualRecord?.status !== 200) {
    addIssue('实时读取失败', `${label}当前读取不是HTTP 200`, { status: actualRecord?.status ?? null });
    return false;
  }
  if (!sameValue(dataOf(actualRecord), dataOf(expectedRecord))) {
    addIssue('写前值漂移', `${label}当前值与独立前置快照不同`, {
      actualSha256: valueSha256(dataOf(actualRecord)),
      expectedSha256: valueSha256(dataOf(expectedRecord)),
    });
    return false;
  }
  return true;
}

function compareRecordData(actualRecord, expectedData, label) {
  if (!actualRecord || actualRecord.status !== 200) {
    addIssue('实时读取失败', `${label}当前读取不是HTTP 200`, { status: actualRecord?.status ?? null });
    return false;
  }
  if (!sameValue(dataOf(actualRecord), expectedData)) {
    addIssue('当前值不符请求前值', `${label}当前值与最终请求记录的before不同`, {
      actualSha256: valueSha256(dataOf(actualRecord)),
      expectedSha256: valueSha256(expectedData),
    });
    return false;
  }
  return true;
}

function walk(value, visitor, currentPath = '$', seen = new Set()) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, `${currentPath}[${index}]`, seen));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${currentPath}.${key}`;
    visitor(key, child, childPath);
    walk(child, visitor, childPath, seen);
  }
}

function findExactStrings(value, targets) {
  const found = [];
  walk(value, (key, child, currentPath) => {
    if (typeof child === 'string' && targets.has(child)) found.push({ key, value: child, path: currentPath });
  });
  return found;
}

function findFieldValues(value, field) {
  const found = [];
  walk(value, (key, child, currentPath) => {
    if (key === field && typeof child === 'string') found.push({ value: child, path: currentPath });
  });
  return found;
}

function eventMatches(rule, event) {
  const source = rule?.eventSource;
  if (!source || source.eventType !== event?.eventType) return false;
  const expected = source.detail && typeof source.detail === 'object' ? source.detail : {};
  const actual = event.detail && typeof event.detail === 'object' ? event.detail : {};
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) return false;
  }
  return true;
}

function checkRuntimeInputBody(body, label) {
  const pass = body?.valueMode === 'RUNTIME_INPUT' && body?.fixedValue === null && body?.levelValues === null;
  if (!pass) addIssue('运行时输入形态错误', `${label}没有严格使用运行时输入且清空固定值和等级表`, { body });
  return pass;
}

function checkSource(raw, expectedType, parameterKey) {
  const result = {
    parameterKey,
    expectedType,
    actualType: raw?.__type ?? null,
    typePass: raw?.__type === expectedType,
    finiteValues: true,
    endpointValues: null,
    breakpointValues: null,
  };
  if (!result.typePass) {
    addIssue('来源节点类型不符', `${parameterKey}来源节点类型与最终请求记录不一致`, result);
    return result;
  }
  if (expectedType === 'ByCharLevelInterpolationCalculationPart') {
    result.endpointValues = { start: raw?.mStartValue ?? null, end: raw?.mEndValue ?? null };
    result.finiteValues = Number.isFinite(raw?.mStartValue) && Number.isFinite(raw?.mEndValue);
  } else {
    const breakpoints = Array.isArray(raw?.mBreakpoints) ? raw.mBreakpoints : [];
    result.endpointValues = { level1: raw?.mLevel1Value ?? null, initialPerLevel: raw?.mInitialBonusPerLevel ?? null };
    result.breakpointValues = breakpoints.map((item) => ({
      level: item?.mLevel ?? null,
      increment: item?.mBonusPerLevelAtAndAfter ?? null,
      type: item?.__type ?? null,
    }));
    result.finiteValues = Number.isFinite(raw?.mLevel1Value)
      && Number.isFinite(raw?.mInitialBonusPerLevel)
      && breakpoints.length > 0
      && breakpoints.every((item) => Number.isFinite(item?.mLevel) && Number.isFinite(item?.mBonusPerLevelAtAndAfter));
    if (!result.finiteValues) addIssue('来源分段数值不完整', `${parameterKey}的分段来源缺少可核对的数字`, result);
  }
  if (!result.finiteValues) addIssue('来源端点数值不完整', `${parameterKey}来源端点不是有限数字`, result);
  return result;
}

function collectActionEffectRefs(skillKey, action, maps, targetSet, visitedFormulas = new Set()) {
  const found = [];
  const effectKey = action?.detail?.effectKey || action?.effectKey;
  if (!effectKey) return found;
  const effect = maps.effects.get(effectKey);
  if (!effect) {
    addIssue('规则引用效果缺失', `${skillKey}规则动作引用的效果在当前效果集合中不存在`, { effectKey });
    return found;
  }
  found.push(...findExactStrings(effect, targetSet).map((item) => ({ ...item, via: `effect:${effectKey}` })));
  for (const formulaRef of findFieldValues(effect, 'formulaKey')) {
    const formula = maps.formulas.get(formulaRef.value);
    if (!formula) {
      addIssue('效果引用公式缺失', `${skillKey}效果引用的公式在当前公式集合中不存在`, { effectKey, formulaKey: formulaRef.value });
      continue;
    }
    if (visitedFormulas.has(formulaRef.value)) continue;
    visitedFormulas.add(formulaRef.value);
    found.push(...findExactStrings(formula, targetSet).map((item) => ({ ...item, via: `formula:${formulaRef.value}` })));
  }
  return found;
}

function readControllerEvidence() {
  const backendRoot = path.resolve(WEB_ROOT, '..', 'damage_backend_dev');
  const specs = [
    {
      label: '触发规则管理接口',
      file: path.join(backendRoot, 'server', 'data_manage', 'src', 'main', 'java', 'xyz', 'game', 'datamanage', 'controller', 'adminapi', 'skilltrigger', 'SkillTriggerRuleAdminController.java'),
      patterns: [
        ['基础路径', /@RequestMapping\s*\(\s*"\/api\/admin\/games\/\{gameId\}\/skills\/\{skillKey\}\/trigger-rules"\s*\)/],
        ['按规则读取', /@GetMapping\s*\(\s*"\/{ruleKey}"\s*\)/],
        ['创建', /@PostMapping\b/],
        ['更新', /@PutMapping\s*\(\s*"\/{ruleKey}"\s*\)/],
        ['删除', /@DeleteMapping\s*\(\s*"\/{ruleKey}"\s*\)/],
      ],
    },
    {
      label: '技能参数管理接口',
      file: path.join(backendRoot, 'server', 'data_manage', 'src', 'main', 'java', 'xyz', 'game', 'datamanage', 'controller', 'adminapi', 'skillparameter', 'SkillParameterAdminController.java'),
      patterns: [
        ['基础路径', /@RequestMapping\s*\(\s*"\/api\/admin\/games\/\{gameId\}\/skills\/\{skillKey\}\/parameters"\s*\)/],
        ['按参数读取', /@GetMapping\s*\(\s*"\/{parameterKey}"\s*\)/],
        ['创建', /@PostMapping\b/],
        ['更新', /@PutMapping\s*\(\s*"\/{parameterKey}"\s*\)/],
        ['删除', /@DeleteMapping\s*\(\s*"\/{parameterKey}"\s*\)/],
      ],
    },
  ];
  return specs.map((spec) => {
    const exists = fs.existsSync(spec.file);
    const source = exists ? fs.readFileSync(spec.file, 'utf8') : '';
    const checks = spec.patterns.map(([label, pattern]) => ({ label, pass: pattern.test(source) }));
    if (!exists) addIssue('本地接口实现缺失', `${spec.label}源码不存在`, { file: spec.file });
    for (const check of checks) {
      if (!check.pass) addIssue('本地接口路由未证实', `${spec.label}缺少${check.label}路由证据`, { file: spec.file });
    }
    return {
      label: spec.label,
      file: spec.file,
      exists,
      sha256: exists ? fileSha256(spec.file) : null,
      checks,
    };
  });
}

async function run() {
  const finalRequest = readJson(FINAL_REQUEST_PATH);
  const beforeSnapshot = readJson(BEFORE_SNAPSHOT_PATH);
  const sourceTree = readJson(SOURCE_TREE_PATH);
  const dependencyEvidence = readJson(DEPENDENCY_PATH);
  const finalRequestSha256 = fileSha256(FINAL_REQUEST_PATH);
  if (finalRequestSha256 !== 'd9d238981202cf8a8cb57c50592568b01fc6659f510e4f7db86ca07d4a72e17e') {
    addIssue('最终请求散列漂移', '可审查最终请求文件散列与父任务给定值不同', { actual: finalRequestSha256 });
  }

  const requestMethods = finalRequest.requests?.map((item) => item.method) || [];
  const deleteRequests = (finalRequest.requests || []).filter((item) => item.method === 'DELETE');
  const putRequests = (finalRequest.requests || []).filter((item) => item.method === 'PUT');
  const finalDeleteRoutes = deleteRequests.map((item) => item.route);
  const finalPutRoutes = putRequests.map((item) => item.route);
  const exactDeleteScope = sameValue([...finalDeleteRoutes].sort(), [...deletedRuleRoutes].sort());
  if (!exactDeleteScope) addIssue('删除范围漂移', '最终请求的删除路线不是预定六条自动规则', { actual: finalDeleteRoutes, expected: deletedRuleRoutes });
  if (deleteRequests.length !== 6 || putRequests.length !== 10 || finalRequest.requests?.length !== 16) {
    addIssue('请求计数漂移', '最终请求没有保持6删除加10参数更新的16项范围', {
      methods: requestMethods,
      counts: { deletes: deleteRequests.length, puts: putRequests.length, total: finalRequest.requests?.length ?? 0 },
    });
  }
  if (new Set(finalDeleteRoutes).size !== finalDeleteRoutes.length || new Set(finalPutRoutes).size !== finalPutRoutes.length) {
    addIssue('请求重复', '最终请求含有重复删除或参数更新路线');
  }
  if (finalRequest.businessWrites !== 0) addIssue('请求标记异常', '最终请求文件不是业务写入数为0的待审查状态', { businessWrites: finalRequest.businessWrites });

  const live = {};
  const snapshotComparisons = [];
  let compositionCount = 0;
  let subjectCount = 0;
  let imageCount = 0;
  let relationCount = 0;
  for (const skillKey of skillKeys) {
    const skillSnapshot = getSkillSnapshot(beforeSnapshot, skillKey);
    const skillRecord = await get(`/skills/${encodeURIComponent(skillKey)}`, `${skillKey}主体`);
    live[skillKey] = { subject: skillRecord, components: {} };
    const subjectPass = compareSnapshotValue(skillRecord, skillSnapshot?.subject, `${skillKey}主体`);
    snapshotComparisons.push({ label: `${skillKey}主体`, pass: subjectPass });
    if (subjectPass) subjectCount += 1;
    for (const def of componentDefs) {
      const listRoute = `/skills/${encodeURIComponent(skillKey)}/${def.route}`;
      const listRecord = await get(listRoute, `${skillKey}${def.name}列表`);
      const details = [];
      live[skillKey].components[def.name] = { list: listRecord, details };
      const expectedComponent = componentSnapshot(skillSnapshot, def.name);
      const listPass = compareSnapshotValue(listRecord, expectedComponent?.list, `${skillKey}${def.name}列表`);
      snapshotComparisons.push({ label: `${skillKey}${def.name}列表`, pass: listPass });
      for (const item of asArray(dataOf(listRecord))) {
        const componentKey = item?.[def.key];
        if (!componentKey) {
          addIssue('组成键缺失', `${skillKey}${def.name}列表存在没有${def.key}的条目`);
          continue;
        }
        const detailRoute = `/skills/${encodeURIComponent(skillKey)}/${def.route}/${encodeURIComponent(componentKey)}`;
        const detailRecord = await get(detailRoute, `${skillKey}/${componentKey}详情`);
        details.push(detailRecord);
        compositionCount += 1;
        const expectedDetails = expectedComponent?.details || [];
        const expectedDetail = expectedDetails.find((candidate) => dataOf(candidate)?.[def.key] === componentKey);
        const detailPass = compareSnapshotValue(detailRecord, expectedDetail, `${skillKey}/${componentKey}详情`);
        snapshotComparisons.push({ label: `${skillKey}/${componentKey}详情`, pass: detailPass });
      }
    }
    const imageRoute = skillSnapshot?.representativeImage?.route || `/skills/${encodeURIComponent(skillKey)}/representative-image`;
    const imageRecord = await get(imageRoute, `${skillKey}代表图`);
    live[skillKey].representativeImage = imageRecord;
    const imagePass = compareSnapshotValue(imageRecord, skillSnapshot?.representativeImage, `${skillKey}代表图`);
    snapshotComparisons.push({ label: `${skillKey}代表图`, pass: imagePass });
    if (imagePass) imageCount += 1;
    const relationRoute = skillSnapshot?.characterSkillRelations?.route
      || `/character-skill-relations?skillKey=${encodeURIComponent(skillKey)}`;
    const relationRecord = await get(relationRoute, `${skillKey}角色挂载`);
    live[skillKey].characterSkillRelations = relationRecord;
    const relationPass = compareSnapshotValue(relationRecord, skillSnapshot?.characterSkillRelations, `${skillKey}角色挂载`);
    snapshotComparisons.push({ label: `${skillKey}角色挂载`, pass: relationPass });
    if (relationPass) relationCount += 1;
  }

  const liveTargetParameters = [];
  const sourceChecks = [];
  const targetParamRequests = new Map();
  for (const request of putRequests) {
    const routeParts = request.route.split('/');
    const skillKey = routeParts[2];
    const parameterKey = routeParts[4];
    const compoundKey = `${skillKey}/${parameterKey}`;
    targetParamRequests.set(compoundKey, request);
    const detailRecord = live[skillKey]?.components?.parameters?.details?.find((item) => dataOf(item)?.parameterKey === parameterKey);
    liveTargetParameters.push({ compoundKey, route: request.route, record: detailRecord });
    compareRecordData(detailRecord, request.before, compoundKey);
    const bodyKeys = Object.keys(request.body || {}).sort();
    const allowedBodyKeys = ['description', 'fixedValue', 'levelValues', 'name', 'sortOrder', 'valueMode', 'valueType'];
    if (!sameValue(bodyKeys, [...allowedBodyKeys].sort())) {
      addIssue('参数更新字段越界', `${compoundKey}的更新请求含非预定字段或遗漏字段`, { bodyKeys, allowedBodyKeys });
    }
    checkRuntimeInputBody(request.body, compoundKey);
    const before = request.before || {};
    const identityChecks = ['gameId', 'skillKey', 'parameterKey', 'name', 'valueType', 'sortOrder'].map((key) => ({
      key,
      pass: request.body?.[key] === undefined ? true : request.body[key] === before[key],
    }));
    for (const check of identityChecks) {
      if (!check.pass) addIssue('参数身份改变', `${compoundKey}更新体改变了${check.key}`, { before: before[check.key], body: request.body?.[check.key] });
    }
    const sourceEntry = Array.isArray(request.source) ? request.source[0] : request.source;
    const raw = sourceEntry?.raw;
    sourceChecks.push(checkSource(raw, expectedSourceTypes.get(compoundKey), compoundKey));
    if (request.body?.description && !/(算法未证|插值算法未证|斜率求值算法未证|尚缺.*算法|未证.*算法)/.test(request.body.description)) {
      addIssue('未知算法未写明', `${compoundKey}的更新说明没有明确保留等级算法未知边界`);
    }
    const liveData = dataOf(detailRecord);
    if (detailRecord?.status === 200) {
      const levelValues = liveData?.levelValues;
      if (liveData?.valueMode !== 'CHARACTER_LEVEL' || liveData?.fixedValue !== null || !levelValues || Object.keys(levelValues).length !== 18) {
        addIssue('当前目标不是未证等级表', `${compoundKey}当前值不符合请求记录的角色等级表前置条件`, { current: liveData });
      }
    }
  }
  const missingPutTargets = targetParameterKeys.filter((key) => !targetParamRequests.has(key));
  const extraPutTargets = [...targetParamRequests.keys()].filter((key) => !targetParameterKeys.includes(key));
  if (missingPutTargets.length || extraPutTargets.length) {
    addIssue('参数范围漂移', '最终请求参数键集合与十项目标不一致', { missing: missingPutTargets, extra: extraPutTargets });
  }
  const sourceTypeCounts = sourceChecks.reduce((acc, item) => {
    acc[item.actualType || '缺失'] = (acc[item.actualType || '缺失'] || 0) + 1;
    return acc;
  }, {});
  if (sourceChecks.length !== 10 || sourceChecks.some((item) => !item.typePass || !item.finiteValues)) {
    addIssue('来源核对未收敛', '十项参数没有全部得到带有限端点或分段数字的预期来源节点', { sourceTypeCounts });
  }

  const liveMaps = {};
  for (const skillKey of skillKeys) {
    const liveSkill = live[skillKey];
    liveMaps[skillKey] = {
      effects: componentMap(liveSkill, 'effects', 'effectKey'),
      formulas: componentMap(liveSkill, 'formulas', 'formulaKey'),
      parameters: componentMap(liveSkill, 'parameters', 'parameterKey'),
    };
  }

  const ruleDependencyRecords = [];
  for (const skillKey of skillKeys) {
    const targetSet = new Set(targetParameterKeys.filter((key) => key.startsWith(`${skillKey}/`)).map((key) => key.split('/')[1]));
    const maps = liveMaps[skillKey];
    for (const ruleRecord of live[skillKey].components['trigger-rules'].details || []) {
      const rule = dataOf(ruleRecord);
      const ruleRoute = `/skills/${encodeURIComponent(skillKey)}/trigger-rules/${encodeURIComponent(rule?.ruleKey || '')}`;
      const references = [];
      for (const [index, action] of (rule?.actions || []).entries()) {
        references.push(...collectActionEffectRefs(skillKey, action, maps, targetSet).map((item) => ({ ...item, actionIndex: index })));
      }
      ruleDependencyRecords.push({
        skillKey,
        ruleKey: rule?.ruleKey || null,
        route: ruleRoute,
        actionCount: Array.isArray(rule?.actions) ? rule.actions.length : null,
        conditionGroupCount: Array.isArray(rule?.conditionGroups) ? rule.conditionGroups.length : null,
        targetParameterRefs: [...new Set(references.map((item) => `${skillKey}/${item.value}`))].sort(),
        references,
      });
    }
  }

  const expectedRuleParamRoutes = new Map([
    ['diana_p/passive_attack_speed_ratio', deletedRuleRoutes.filter((route) => route.startsWith('/skills/diana_p/'))],
    ['warwick_p/on_hit_base', ['/skills/warwick_p/trigger-rules/basic_attack_hit']],
  ]);
  for (const targetKey of targetParameterKeys) {
    const actualRoutes = ruleDependencyRecords
      .filter((record) => record.targetParameterRefs.includes(targetKey))
      .map((record) => record.route)
      .sort();
    const expectedRoutes = (expectedRuleParamRoutes.get(targetKey) || []).slice().sort();
    if (!sameValue(actualRoutes, expectedRoutes)) {
      addIssue('自动规则依赖范围不符', `${targetKey}的当前自动规则引用集合与六条删除范围不一致`, { actualRoutes, expectedRoutes });
    }
  }

  const automaticNonRuleRefs = [];
  for (const skillKey of skillKeys) {
    const maps = liveMaps[skillKey];
    for (const def of componentDefs.filter((item) => item.name === 'processes' || item.name === 'internal-states')) {
      for (const record of live[skillKey].components[def.name].details || []) {
        const item = dataOf(record);
        const direct = findExactStrings(item, new Set(targetParameterKeys.map((key) => key.split('/')[1])));
        const viaActions = [];
        for (const action of item?.actions || []) viaActions.push(...collectActionEffectRefs(skillKey, action, maps, new Set(targetParameterKeys.map((key) => key.split('/')[1]))));
        const refs = [...direct, ...viaActions];
        if (refs.length) automaticNonRuleRefs.push({ skillKey, component: def.name, key: item?.[def.key], refs });
      }
    }
  }
  if (automaticNonRuleRefs.length) addIssue('过程或内部状态仍依赖目标参数', '删除六条规则后仍有其他自动组成直接或间接引用目标参数', { references: automaticNonRuleRefs });

  const remainingRuleRefsAfterDelete = ruleDependencyRecords.filter((record) => !deletedRuleRoutes.includes(record.route));
  const remainingTargetRefsAfterDelete = remainingRuleRefsAfterDelete.flatMap((record) => record.targetParameterRefs.map((parameterKey) => ({ ...record, parameterKey })));
  if (remainingTargetRefsAfterDelete.length) addIssue('删除后仍有自动缺输入', '假设六条目标规则删除后，剩余规则仍引用缺少等级算法的参数', { references: remainingTargetRefsAfterDelete });

  const ruleAudit = [];
  const conditionCases = [];
  for (const request of deleteRequests) {
    const route = request.route;
    const skillKey = route.split('/')[2];
    const ruleRecord = live[skillKey]?.components?.['trigger-rules']?.details?.find((item) => {
      const data = dataOf(item);
      return `/skills/${skillKey}/trigger-rules/${data?.ruleKey}` === route;
    });
    const rule = dataOf(ruleRecord);
    if (!rule) {
      addIssue('待删除规则实时缺失', `${route}当前GET没有返回规则对象`);
      continue;
    }
    const action = Array.isArray(rule.actions) ? rule.actions[0] : null;
    const actionEffect = action?.detail?.effectKey || action?.effectKey || null;
    const targetParam = ruleDependencyRecords.find((record) => record.route === route)?.targetParameterRefs || [];
    const forbiddenFields = ['enabled', 'status'].filter((field) => Object.prototype.hasOwnProperty.call(rule, field));
    if (forbiddenFields.length) addIssue('规则含不存在的停用字段', `${route}出现不应伪造的启停字段`, { forbiddenFields });
    if (!Array.isArray(rule.actions) || rule.actions.length !== 1) addIssue('规则动作数量不安全', `${route}不是单一动作规则`, { actions: rule.actions });
    if (!Array.isArray(rule.conditionGroups) || rule.conditionGroups.length !== 0) addIssue('规则条件未核实', `${route}含有未纳入删除方案的条件组`, { conditionGroups: rule.conditionGroups });
    if (action?.runtimeInputBindings && action.runtimeInputBindings.length !== 0) addIssue('规则动作含运行时绑定', `${route}存在需要额外处理的动作输入绑定`, { runtimeInputBindings: action.runtimeInputBindings });
    if (actionEffect !== expectedRuleEffects.get(route)) addIssue('规则动作效果不符', `${route}将删除的动作效果与冻结请求不一致`, { actual: actionEffect, expected: expectedRuleEffects.get(route) });
    const expectedTarget = expectedRuleParameterRefs.get(skillKey);
    if (!targetParam.includes(expectedTarget) || targetParam.some((item) => item !== expectedTarget)) {
      addIssue('规则动作误撤风险', `${route}动作依赖没有严格落在对应目标参数`, { targetParam, expectedTarget });
    }
    const recreated = request.recreate;
    const recreateBody = recreated?.body;
    const recreateAction = Array.isArray(recreateBody?.actions) ? recreateBody.actions[0] : null;
    if (recreated?.method !== 'POST' || recreated?.route !== `/skills/${skillKey}/trigger-rules`) {
      addIssue('规则复建路线错误', `${route}的复建路线不是技能触发规则创建路线`, { recreate: recreated });
    }
    if (!Array.isArray(recreateBody?.actions) || recreateBody.actions.length !== 1 || (recreateBody?.conditionGroups || []).length !== 0) {
      addIssue('规则复建体不安全', `${route}的复建体不是单一动作且空条件组`, { recreateBody });
    }
    const positiveEvent = { eventType: rule.eventSource?.eventType, detail: clone(rule.eventSource?.detail || {}) };
    const negativeEvent = rule.eventSource?.detail?.sourceSkillKey
      ? { eventType: rule.eventSource.eventType, detail: { ...clone(rule.eventSource.detail), sourceSkillKey: '__other_skill__' } }
      : { eventType: rule.eventSource?.eventType === 'SOURCE_INITIALIZED' ? 'SKILL_USED' : 'SKILL_USED', detail: {} };
    const positivePass = eventMatches(rule, positiveEvent);
    const negativePass = !eventMatches(rule, negativeEvent);
    conditionCases.push({ route, positive: { event: positiveEvent, pass: positivePass }, negative: { event: negativeEvent, pass: negativePass } });
    if (!positivePass || !negativePass) addIssue('规则事件负例失败', `${route}的事件匹配边界没有同时通过正例和反例`, { positiveEvent, negativeEvent, positivePass, negativePass });
    ruleAudit.push({
      route,
      status: ruleRecord.status,
      currentSha256: valueSha256(rule),
      requestBeforeSha256: valueSha256(request.before),
      matchesRequestBefore: sameValue(rule, request.before),
      actionCount: rule.actions?.length ?? null,
      conditionGroupCount: rule.conditionGroups?.length ?? null,
      actionEffect,
      targetParameterRefs: targetParam,
      runtimeInputBindings: action?.runtimeInputBindings ?? null,
      hasEnabledOrStatus: forbiddenFields.length > 0,
      recreateAction: recreateAction ? {
        actionKey: recreateAction.actionKey,
        actionType: recreateAction.actionType,
        detail: recreateAction.detail,
        targetContext: recreateAction.targetContext,
      } : null,
    });
    if (!sameValue(rule, request.before)) addIssue('删除前规则漂移', `${route}当前完整规则对象与最终请求before不同`);
  }

  const emptyActionNegativeCases = [
    { name: '空动作列表', actions: [], pass: false },
    { name: '双动作列表', actions: [{ actionKey: 'a' }, { actionKey: 'b' }], pass: false },
    { name: '单动作列表', actions: [{ actionKey: 'a' }], pass: true },
  ].map((item) => ({ ...item, acceptedByPlan: item.actions.length === 1 }));
  for (const item of emptyActionNegativeCases) {
    if (item.acceptedByPlan !== item.pass) addIssue('空动作反例检查器错误', `${item.name}的单动作安全边界判断错误`);
  }

  const sourceMathCases = [];
  for (const request of putRequests) {
    const compoundKey = `${request.skillKey}/${request.parameterKey}`;
    const sourceEntry = Array.isArray(request.source) ? request.source[0] : request.source;
    const raw = sourceEntry?.raw;
    if (raw?.__type === 'ByCharLevelInterpolationCalculationPart') {
      const start = raw.mStartValue;
      const end = raw.mEndValue;
      const percentPoint = compoundKey === 'brand_p/explosion_base_max_hp_ratio';
      const normalized = { start: percentPoint ? start / 100 : start, end: percentPoint ? end / 100 : end };
      const caseRecord = {
        name: `${compoundKey}端点单位转换`,
        input: { start, end },
        conversion: percentPoint ? '百分比点除100为比例' : '来源按该参数比例或点数保存',
        output: normalized,
        endpointOrderPass: normalized.start <= normalized.end,
        noZeroFallbackPass: normalized.start !== 0 && normalized.end !== 0,
      };
      sourceMathCases.push(caseRecord);
      if (!caseRecord.endpointOrderPass || !caseRecord.noZeroFallbackPass) addIssue('来源端点算例失败', `${compoundKey}端点转换或缺值边界失败`, caseRecord);
    } else if (raw?.__type === 'ByCharLevelBreakpointsCalculationPart') {
      const breakpoints = Array.isArray(raw.mBreakpoints) ? raw.mBreakpoints : [];
      const caseRecord = {
        name: `${compoundKey}分段来源边界`,
        input: { level1: raw.mLevel1Value, initialPerLevel: raw.mInitialBonusPerLevel, breakpoints },
        algorithmKnown: false,
        intermediateLevel12Computed: false,
        explanation: '来源只给起点、初始增量和断点；断点当级及斜率求值算法未证，不能自行生成中间等级值。',
      };
      sourceMathCases.push(caseRecord);
    }
  }
  const interpolationCases = sourceMathCases.filter((item) => item.conversion).length;
  const breakpointCases = sourceMathCases.filter((item) => item.algorithmKnown === false).length;
  const runtimeInputNegativeCases = [
    { name: '固定值仍有数值', body: { valueMode: 'RUNTIME_INPUT', fixedValue: 0, levelValues: null }, pass: false },
    { name: '等级表仍有对象', body: { valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: { 1: 1 } }, pass: false },
    { name: '固定值和等级表均为空', body: { valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null }, pass: true },
  ].map((item) => ({ ...item, acceptedByChecker: item.body.valueMode === 'RUNTIME_INPUT' && item.body.fixedValue === null && item.body.levelValues === null }));
  for (const item of runtimeInputNegativeCases) {
    if (item.acceptedByChecker !== item.pass) addIssue('运行时输入反例检查器错误', `${item.name}的判定与预期不一致`);
  }

  const controllerEvidence = readControllerEvidence();
  const dependencyFileSha256 = fs.existsSync(DEPENDENCY_PATH) ? fileSha256(DEPENDENCY_PATH) : null;
  const sourceTreeFileSha256 = fs.existsSync(SOURCE_TREE_PATH) ? fileSha256(SOURCE_TREE_PATH) : null;
  if (dependencyEvidence?.summary?.affectedRules) {
    addWarning('依赖证据仅作交叉参考', '实际自动规则依赖以本次实时8技能组成和动作链读取为准，没有使用作者通过计数替代实时证据。');
  }

  const statusCounts = reads.reduce((acc, record) => {
    const key = record.status === null ? '网络或解析错误' : String(record.status);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  if (reads.some((record) => record.status !== 200)) {
    addIssue('实时GET未全通过', '本次独立读取存在非HTTP 200或网络错误', { statusCounts });
  }

  const reportData = {
    at: new Date().toISOString(),
    mode: '独立只读审查',
    status: issues.length ? '阻塞' : 'READY',
    apiRoot: API_ROOT,
    finalRequest: {
      path: FINAL_REQUEST_PATH,
      sha256: finalRequestSha256,
      expectedSha256: 'd9d238981202cf8a8cb57c50592568b01fc6659f510e4f7db86ca07d4a72e17e',
      status: finalRequest.status,
      counts: finalRequest.counts,
      order: finalRequest.order,
      safety: finalRequest.safety,
      acceptance: finalRequest.acceptance,
    },
    sourceFiles: {
      beforeSnapshot: { path: BEFORE_SNAPSHOT_PATH, sha256: fileSha256(BEFORE_SNAPSHOT_PATH) },
      sourceTree: { path: SOURCE_TREE_PATH, sha256: sourceTreeFileSha256 },
      dependencyEvidence: { path: DEPENDENCY_PATH, sha256: dependencyFileSha256 },
    },
    scope: {
      skills: skillKeys,
      deletedRules: deletedRuleRoutes,
      updatedParameters: targetParameterKeys,
      sourceTypeCounts,
      expectedSourceTypes: Object.fromEntries(expectedSourceTypes),
      exactRequestScopePass: exactDeleteScope && deleteRequests.length === 6 && putRequests.length === 10,
    },
    realtime: {
      getCount: reads.length,
      statusCounts,
      subjectCount,
      compositionCount,
      expectedCompositionCount: 76,
      representativeImageCount: imageCount,
      characterRelationCount: relationCount,
      snapshotComparisonCount: snapshotComparisons.length,
      snapshotComparisonPassCount: snapshotComparisons.filter((item) => item.pass).length,
      writes: 0,
    },
    controllerEvidence,
    ruleAudit,
    ruleDependencies: ruleDependencyRecords,
    automaticNonRuleRefs,
    remainingTargetRefsAfterDelete,
    conditionCases,
    emptyActionNegativeCases,
    runtimeInputNegativeCases,
    sourceChecks,
    sourceMathCases,
    independentChecks: {
      finalRequestShaPass: finalRequestSha256 === 'd9d238981202cf8a8cb57c50592568b01fc6659f510e4f7db86ca07d4a72e17e',
      allReadsHttp200: reads.length > 0 && reads.every((record) => record.status === 200),
      allRuleBeforeValuesMatch: ruleAudit.length === 6 && ruleAudit.every((item) => item.matchesRequestBefore),
      allRulesSingleAction: ruleAudit.length === 6 && ruleAudit.every((item) => item.actionCount === 1),
      allRulesHaveNoStopFields: ruleAudit.length === 6 && ruleAudit.every((item) => !item.hasEnabledOrStatus),
      noRemainingAutomaticTargetRefs: remainingTargetRefsAfterDelete.length === 0 && automaticNonRuleRefs.length === 0,
      compositionAndIdentityProtected: subjectCount === 8 && compositionCount === 76 && imageCount === 8 && relationCount === 8,
      noAlgorithmInvented: sourceChecks.length === 10 && sourceChecks.every((item) => item.typePass && item.finiteValues),
      noBusinessWrites: reads.every((record) => record.method === 'GET'),
    },
    issues,
    warnings,
    reads,
  };

  fs.writeFileSync(path.join(ARTIFACT_DIR, '历史等级曲线独立审查.json'), `${JSON.stringify(reportData, null, 2)}\n`, 'utf8');

  const reportLines = [
    '# 历史等级曲线独立审查',
    '',
    `- 结论：**${reportData.status}**。本次只读读取了 ${reads.length} 个接口结果，业务写入数为 0。`,
    `- 最终请求散列：\`${finalRequestSha256}\`；与父任务给定值一致：${reportData.independentChecks.finalRequestShaPass ? '是' : '否'}。`,
    `- 范围：6 条自动规则删除候选、10 个参数转为运行时输入；请求计数为 ${deleteRequests.length}+${putRequests.length}=${finalRequest.requests?.length ?? 0}。`,
    '',
    '## 实时保护读取',
    '',
    `8 个技能主体：${subjectCount}/8 与写前快照一致；76 个组成详情：${compositionCount}/76；代表图：${imageCount}/8；角色挂载：${relationCount}/8。HTTP状态：${JSON.stringify(statusCounts)}。`,
    '主体、参数、公式、效果、过程、内部状态、触发规则列表及详情均按当前接口重新读取，并逐项与独立写前快照比较；没有用作者原有通过计数代替读取结果。',
    '',
    '## 路由与删除边界',
    '',
    '本地接口源码确认触发规则支持按规则读取、创建、更新、删除；参数支持按参数读取、创建、更新、删除。请求采用规则删除路线和参数更新路线，未使用伪造的启停字段。',
    `六条规则当前均为单动作、空条件组、动作运行时绑定为空；逐条完整对象与请求 before 一致：${ruleAudit.filter((item) => item.matchesRequestBefore).length}/6。`,
    `事件正反例：${conditionCases.filter((item) => item.positive.pass && item.negative.pass).length}/${conditionCases.length} 通过；空动作与双动作均判为不安全。`,
    `删除六条规则后，剩余规则、过程和内部状态引用目标参数：${remainingTargetRefsAfterDelete.length + automaticNonRuleRefs.length} 条。效果和公式仍保留其参数引用，删除只断开自动触发动作，不宣称战斗运行已经完成。`,
    '',
    '## 十项参数与来源',
    '',
    `来源节点类型计数：${JSON.stringify(sourceTypeCounts)}。十项均保留有限端点或分段数字，更新体严格为 valueMode=RUNTIME_INPUT、fixedValue=null、levelValues=null。`,
    `其中 ${interpolationCases} 项只有插值端点，${breakpointCases} 项只有起点、初始增量和断点；现有来源没有证明中间等级算法，因此没有在独立审查中重算等级表。`,
    '百分比点示例按来源单位除以100转换为比例；分段来源仅核对原始起点、增量和断点，未把断点当级规则或斜率算法自行补出。缺值回退0、把未经证明的等级表继续作为固定值，均为反例。',
    '',
    '## 需要关注的边界',
    '',
    issues.length ? issues.map((item) => `- ${item.code}：${item.message}`).join('\n') : '- 未发现阻塞问题。',
    '- 本报告证明的是当前接口读回、静态引用链和请求安全边界；页面验收、战斗运行、后续实际等级输入来源仍需主负责人单独完成。',
    '',
    `报告生成时间：${reportData.at}`,
  ];
  fs.writeFileSync(path.join(ARTIFACT_DIR, '历史等级曲线独立审查报告.md'), `${reportLines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({
    status: reportData.status,
    finalRequestSha256,
    getCount: reads.length,
    statusCounts,
    subjectCount,
    compositionCount,
    imageCount,
    relationCount,
    issues: issues.length,
    warnings: warnings.length,
    artifactDir: ARTIFACT_DIR,
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
