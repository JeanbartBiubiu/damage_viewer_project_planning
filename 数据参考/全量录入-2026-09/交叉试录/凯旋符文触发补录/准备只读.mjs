import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const planning = 'C:/project/damage_viewer_project_planning';
const webRepo = 'C:/project/damage_web_dev';
const backendRepo = 'C:/project/damage_backend_dev';
const baseUrl = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token) throw new Error('缺少 DAMAGE_ENTRY_TOKEN；只读脚本不会保存令牌。');

const target = {
  runeKey: 'rune_9111',
  skillKey: 'rune_9111_passive',
  runeName: '凯旋',
  skillName: '符文·凯旋'
};

const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];

const freezeSourcePath = path.join(
  planning,
  '数据参考',
  '全量录入-2026-09',
  'API实录',
  '符文机制盘点',
  '冻结来源.json'
);
const nextBatchPath = path.join(
  planning,
  '数据参考',
  '全量录入-2026-09',
  'API实录',
  '符文机制盘点',
  '下一批最多12项.json'
);
const machineListPath = path.join(
  planning,
  '数据参考',
  '全量录入-2026-09',
  'API实录',
  '符文机制盘点',
  '逐项机器清单.json'
);
const officialPath = path.join(
  planning,
  '数据参考',
  '全量录入-2026-09',
  '装备符文',
  '官方原始资料',
  'runesReforged-16.17.1-zh_CN.json'
);
const clientPath = path.join(
  planning,
  '数据参考',
  '全量录入-2026-09',
  '装备符文',
  '客户端提取资料',
  'perks-16.17-zh_CN.json'
);
const backendTargetContextPath = path.join(
  backendRepo,
  'server',
  'data_manage',
  'src',
  'main',
  'java',
  'xyz',
  'game',
  'datamanage',
  'model',
  'skilltrigger',
  'SkillTriggerTargetContext.java'
);
const backendEventCapabilitiesPath = path.join(
  backendRepo,
  'server',
  'data_manage',
  'src',
  'main',
  'java',
  'xyz',
  'game',
  'datamanage',
  'model',
  'skilltrigger',
  'SkillTriggerEventCapabilities.java'
);
const backendCategorySemanticsPath = path.join(
  backendRepo,
  'server',
  'data_manage',
  'src',
  'main',
  'java',
  'xyz',
  'game',
  'datamanage',
  'support',
  'authoring',
  'SkillTargetCategoryConditionSemantics.java'
);
const backendCategorySemanticsTestPath = path.join(
  backendRepo,
  'server',
  'data_manage',
  'src',
  'test',
  'java',
  'xyz',
  'game',
  'datamanage',
  'support',
  'authoring',
  'SkillTargetCategoryConditionSemanticsTest.java'
);
const frontendRuleTypePath = path.join(webRepo, 'web', 'src', 'types', 'skillTriggerRule.ts');
const designDocPath = path.join(
  webRepo,
  '文档记录',
  '详细设计',
  '项目',
  '条件事件与动态输入供值管理详细设计.md'
);

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fileSha = (filePath) => sha256(fs.readFileSync(filePath));
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const writeJson = (fileName, value) => {
  fs.writeFileSync(path.join(here, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};
const digestOf = (fileName) => fileSha(path.join(here, fileName));

function sourceRecord(filePath, kind) {
  if (!fs.existsSync(filePath)) throw new Error(`来源文件不存在：${filePath}`);
  const bytes = fs.readFileSync(filePath);
  return { kind, path: filePath, byteSize: bytes.byteLength, sha256: sha256(bytes) };
}

function lineEvidence(filePath, patterns) {
  if (!fs.existsSync(filePath)) throw new Error(`契约文件不存在：${filePath}`);
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  return {
    path: filePath,
    sha256: fileSha(filePath),
    matches: lines
      .map((text, index) => ({ line: index + 1, text }))
      .filter(({ text }) => patterns.some((pattern) => text.includes(pattern)))
      .slice(0, 40)
  };
}

function arrayData(response, context) {
  if (response.status !== 200) throw new Error(`${context} 预期 200，实际 ${response.status}`);
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.items)) return response.data.items;
  throw new Error(`${context} 没有数组结果`);
}

function requireStatus(response, expected, context) {
  if (response.status !== expected) throw new Error(`${context} 预期 ${expected}，实际 ${response.status}`);
  return response;
}

function statusCounts(responses) {
  return responses.reduce((counts, response) => {
    const key = String(response.status);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

let getCount = 0;
async function get(route) {
  getCount += 1;
  const response = await fetch(baseUrl + route, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000)
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { parseError: true, responseBytes: Buffer.byteLength(raw) };
    }
  }
  return { method: 'GET', route, status: response.status, data };
}

async function getMany(routes, concurrency = 24) {
  const result = new Array(routes.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= routes.length) return;
      result[index] = await get(routes[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, routes.length || 1) }, () => worker()));
  return result;
}

function sortedUnique(values, context) {
  if (values.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error(`${context} 存在空键或非文字键`);
  }
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) throw new Error(`${context} 存在重复键`);
  return sorted;
}

function ruleRefsFromScan(scan) {
  return scan.lists
    .flatMap(({ skillKey, ruleKeys }) => ruleKeys.map((ruleKey) => ({ skillKey, ruleKey })))
    .sort((a, b) => `${a.skillKey}/${a.ruleKey}`.localeCompare(`${b.skillKey}/${b.ruleKey}`));
}

async function scanSkillRules(includeDetails, passName) {
  const skillsResponse = requireStatus(await get('/skills'), 200, `${passName}全技能目录`);
  const skills = arrayData(skillsResponse, `${passName}全技能目录`);
  const skillKeys = sortedUnique(skills.map((skill) => skill.skillKey), `${passName}全技能目录`);
  const listResponses = await getMany(skillKeys.map((skillKey) => `/skills/${encodeURIComponent(skillKey)}/trigger-rules`));
  const lists = listResponses.map((response, index) => {
    const skillKey = skillKeys[index];
    requireStatus(response, 200, `${passName}技能触发规则列表 ${skillKey}`);
    const rules = arrayData(response, `${passName}技能触发规则列表 ${skillKey}`);
    const ruleKeys = sortedUnique(rules.map((rule) => rule.ruleKey), `${passName}技能 ${skillKey} 规则`);
    return { skillKey, response, rules, ruleKeys };
  });
  const ruleRefs = ruleRefsFromScan({ lists });
  const detailResponses = includeDetails
    ? await getMany(
        ruleRefs.map(({ skillKey, ruleKey }) =>
          `/skills/${encodeURIComponent(skillKey)}/trigger-rules/${encodeURIComponent(ruleKey)}`
        )
      )
    : [];
  if (includeDetails) {
    detailResponses.forEach((response, index) =>
      requireStatus(response, 200, `${passName}技能触发规则详情 ${ruleRefs[index].skillKey}/${ruleRefs[index].ruleKey}`)
    );
  }
  return {
    skillsResponse,
    skills,
    skillKeys,
    lists,
    ruleRefs,
    details: detailResponses.map((response, index) => ({ ...ruleRefs[index], response })),
    statusSummary: {
      catalog: statusCounts([skillsResponse]),
      triggerRuleLists: statusCounts(listResponses),
      triggerRuleDetails: statusCounts(detailResponses)
    }
  };
}

async function readTarget() {
  const subject = requireStatus(await get(`/skills/${target.skillKey}`), 200, '凯旋技能主体');
  const rune = requireStatus(await get(`/runes/${target.runeKey}`), 200, '凯旋符文主体');
  const runeSkillRelations = requireStatus(
    await get(`/rune-skill-relations?runeKey=${encodeURIComponent(target.runeKey)}`),
    200,
    '凯旋符文技能关系'
  );
  const runeSkillRelationFiltered = requireStatus(
    await get(
      `/rune-skill-relations?runeKey=${encodeURIComponent(target.runeKey)}&skillKey=${encodeURIComponent(target.skillKey)}`
    ),
    200,
    '凯旋符文技能关系过滤核对'
  );
  const representativeImage = requireStatus(
    await get(`/skills/${target.skillKey}/representative-image`),
    200,
    '凯旋技能代表图片'
  );
  const components = {};
  for (const [apiName, keyName] of componentKinds) {
    const listResponse = requireStatus(
      await get(`/skills/${target.skillKey}/${apiName}`),
      200,
      `凯旋/${apiName}`
    );
    const items = arrayData(listResponse, `凯旋/${apiName}`);
    const keys = sortedUnique(items.map((item) => item[keyName]), `凯旋/${apiName}`);
    const detailResponses = await getMany(
      keys.map((key) => `/skills/${target.skillKey}/${apiName}/${encodeURIComponent(key)}`)
    );
    detailResponses.forEach((response, index) =>
      requireStatus(response, 200, `凯旋/${apiName}/${keys[index]}`)
    );
    components[apiName] = {
      list: listResponse,
      details: detailResponses.map((response, index) => ({ key: keys[index], response }))
    };
  }
  return {
    ...target,
    subject,
    rune,
    runeSkillRelations,
    runeSkillRelationFiltered,
    representativeImage,
    components
  };
}

function targetComponentCounts(targetRecord) {
  return Object.fromEntries(
    componentKinds.map(([apiName]) => [
      apiName,
      arrayData(targetRecord.components[apiName].list, `凯旋/${apiName}`).length
    ])
  );
}

function targetComponentKeys(targetRecord) {
  return Object.fromEntries(
    componentKinds.map(([apiName, keyName]) => [
      apiName,
      arrayData(targetRecord.components[apiName].list, `凯旋/${apiName}`)
        .map((item) => item[keyName])
        .sort()
    ])
  );
}

function detailData(details) {
  return details.map(({ skillKey, ruleKey, response }) => ({
    skillKey,
    ruleKey,
    status: response.status,
    data: response.data
  }));
}

function targetDetails(targetRecord) {
  return targetRecord.components['trigger-rules'].details.map(({ key, response }) => ({
    ruleKey: key,
    status: response.status,
    data: response.data
  }));
}

function eventCounts(details) {
  const counts = {};
  for (const { response } of details) {
    const eventType = response.data?.eventSource?.eventType;
    if (eventType) counts[eventType] = (counts[eventType] ?? 0) + 1;
  }
  return counts;
}

function conditionCounts(details) {
  const counts = {};
  for (const { response } of details) {
    for (const group of response.data?.conditionGroups ?? []) {
      for (const condition of group.conditions ?? []) {
        const conditionType = condition.conditionType;
        if (conditionType) counts[conditionType] = (counts[conditionType] ?? 0) + 1;
      }
    }
  }
  return counts;
}

function findRule(details, skillKey, ruleKey) {
  return details.find((item) => item.skillKey === skillKey && item.ruleKey === ruleKey)?.response?.data ?? null;
}

function sourceSnapshotFor(planItem, nextItem) {
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    sourcePolicy: '冻结官方16.17.1与客户端16.17；候选只记录已见事实，不把缺失事件语义补成已有字段。',
    target,
    sourceFiles: [
      sourceRecord(freezeSourcePath, '规划真源：冻结来源'),
      sourceRecord(nextBatchPath, '规划候选：下一批最多12项'),
      sourceRecord(machineListPath, '规划索引：逐项机器清单'),
      sourceRecord(officialPath, '官方原始资料'),
      sourceRecord(clientPath, '客户端提取资料')
    ],
    runeSourcePointers: {
      official: planItem.source.official,
      client: planItem.source.client
    },
    planningRuneItem: planItem,
    planningCandidate: nextItem,
    contractEvidence: [
      lineEvidence(backendTargetContextPath, ['enum SkillTriggerTargetContext', 'CURRENT_TARGET', 'EVENT_SOURCE']),
      lineEvidence(backendEventCapabilitiesPath, ['KILL', 'TARGET_CATEGORY_CHECK', '当前被击杀对象', 'EVENT_SOURCE']),
      lineEvidence(backendCategorySemanticsPath, ['SkillTriggerEventType.KILL', 'TARGET_CATEGORY_CHECK']),
      lineEvidence(backendCategorySemanticsTestPath, ['killCategoryCheckReadsTheKilledObjectAsCurrentTarget', '"KILL"']),
      lineEvidence(frontendRuleTypePath, ['SkillTriggerTargetContext', 'CURRENT_TARGET', 'EVENT_SOURCE']),
      lineEvidence(designDocPath, ['EXECUTE_EFFECT', 'targetContext', 'CURRENT_TARGET', 'EVENT_SOURCE'])
    ],
    contractFacts: {
      actionTargetContexts: ['CURRENT_TARGET', 'EVENT_SOURCE'],
      eventSourceEvents: [
        'SOURCE_INITIALIZED',
        'DAMAGE_PENDING',
        'DAMAGE_TAKEN',
        'STATUS_CHANGED',
        'CONTROL_RECEIVED',
        'SPELL_SHIELD_BLOCKED'
      ],
      killHasEventSource: false,
      killCurrentTargetBinding: '本次被击杀对象',
      killRequiresEmptyDetail: true,
      killTargetCategoryCheckSupported: true,
      frontendActionTargetContexts: ['CURRENT_TARGET', 'EVENT_SOURCE']
    },
    requestedSemantic: {
      eventType: 'KILL',
      targetCategoryCheck: { conditionType: 'TARGET_CATEGORY_CHECK', categories: ['CHAMPION'] },
      executeEffect: {
        actionType: 'EXECUTE_EFFECT',
        effectKey: 'triumph_heal',
        requestedTargetContext: 'EVENT_SOURCE',
        normalizedFrom: 'CURRENT_SOURCE'
      },
      excludedBranch: '额外的20金币',
      note: '以上是语义请求快照，不是可提交的接口请求体。'
    }
  };
}

const freezeSource = readJson(freezeSourcePath);
const nextBatch = readJson(nextBatchPath);
const planItem = freezeSource.items?.find((item) => item.runeKey === target.runeKey);
const nextItem = nextBatch.proposals?.find((item) => item.runeKey === target.runeKey);
if (!planItem || !nextItem) throw new Error('规划真源没有找到 rune_9111；停止准备。');

const sourceSnapshot = sourceSnapshotFor(planItem, nextItem);
writeJson('03-来源快照.json', sourceSnapshot);

const targetRecord = await readTarget();
const initialInventory = await scanSkillRules(true, '第一轮');
const stableInventory = await scanSkillRules(true, '第二轮');
const initialRuleRefs = ruleRefsFromScan(initialInventory);
const stableRuleRefs = ruleRefsFromScan(stableInventory);
const stableSkillKeys = isDeepStrictEqual(initialInventory.skillKeys, stableInventory.skillKeys);
const stableRuleRefsEqual = isDeepStrictEqual(initialRuleRefs, stableRuleRefs);
const stableRuleDetails = isDeepStrictEqual(
  detailData(initialInventory.details),
  detailData(stableInventory.details)
);
const stable = stableSkillKeys && stableRuleRefsEqual && stableRuleDetails;
const currentRuleCount = initialRuleRefs.length;
const sourceInitializedCount = eventCounts(initialInventory.details).SOURCE_INITIALIZED ?? 0;
const killRuleCount = eventCounts(initialInventory.details).KILL ?? 0;
const expectedCurrent = {
  skillCount: 1062,
  ruleCount: 96,
  sourceInitializedCount: 24,
  killRuleCount: 1
};

const targetKeys = targetComponentKeys(targetRecord);
const targetCounts = targetComponentCounts(targetRecord);
const targetRuleKeys = targetKeys['trigger-rules'];
const existingKillRule = findRule(initialInventory.details, 'tristana_w', 'own_kill_reset');
const targetRelationRows = arrayData(targetRecord.runeSkillRelations, '凯旋符文技能关系');
const filteredRelationRows = arrayData(targetRecord.runeSkillRelationFiltered, '凯旋符文技能关系过滤核对');
const targetRelationExact =
  targetRelationRows.length === 1 &&
  filteredRelationRows.length === 1 &&
  targetRelationRows[0].runeKey === target.runeKey &&
  targetRelationRows[0].skillKey === target.skillKey &&
  filteredRelationRows[0].runeKey === target.runeKey &&
  filteredRelationRows[0].skillKey === target.skillKey;

const requestedSemantic = sourceSnapshot.requestedSemantic;
const supportedTargetContexts = ['CURRENT_TARGET', 'EVENT_SOURCE'];
const protocolConflicts = [
  {
    severity: '阻塞',
    field: 'KILL.targetContext',
    requested: requestedSemantic.executeEffect.requestedTargetContext,
    supported: supportedTargetContexts,
    requestedSemanticName: requestedSemantic.executeEffect.normalizedFrom,
    currentTargetBinding: '本次被击杀对象',
    eventSourceAvailable: false,
    reason: '用户语义中的来源对象已按现行枚举标准化为 EVENT_SOURCE；但当前后端能力表明确 KILL 不提供事件来源，不能把 EVENT_SOURCE 写入一个无法提供来源的 KILL 事件。'
  }
];
const semanticLimitations = [
  {
    severity: '需补证',
    fact: '参与击杀',
    currentCandidate: 'KILL',
    reason: '冻结来源明确说参与击杀，但当前 KILL 事件仅表示来源对象完成击杀；不能把它宣称为包含助攻的完整参与击杀。'
  },
  {
    severity: '需补定',
    fact: 'ruleKey、名称、顺序',
    reason: '任务只给出触发语义，没有给出可提交的稳定规则键及展示字段；本轮不凭空生成。'
  }
];

const baselineMatches =
  initialInventory.skillKeys.length === expectedCurrent.skillCount &&
  currentRuleCount === expectedCurrent.ruleCount &&
  sourceInitializedCount === expectedCurrent.sourceInitializedCount &&
  killRuleCount === expectedCurrent.killRuleCount;
const targetDataMatches =
  targetRecord.subject.data?.skillKey === target.skillKey &&
  targetRecord.rune.data?.runeKey === target.runeKey &&
  targetRecord.representativeImage.data?.image?.imageKey === 'rune_9111' &&
  targetCounts.parameters === 2 &&
  targetCounts.formulas === 1 &&
  targetCounts.effects === 1 &&
  targetCounts.processes === 0 &&
  targetCounts['internal-states'] === 0 &&
  targetCounts['trigger-rules'] === 0 &&
  targetKeys.parameters.includes('missing_health_ratio') &&
  targetKeys.parameters.includes('maximum_health_ratio') &&
  targetKeys.formulas.includes('triumph_heal') &&
  targetKeys.effects.includes('triumph_heal') &&
  targetRelationExact;
const existingKillEvidenceMatches =
  existingKillRule?.eventSource?.eventType === 'KILL' &&
  existingKillRule.conditionGroups?.some((group) =>
    group.conditions?.some(
      (condition) =>
        condition.conditionType === 'TARGET_CATEGORY_CHECK' &&
        condition.detail?.categories?.includes('CHAMPION')
    )
  );

const status =
  stable &&
  baselineMatches &&
  targetDataMatches &&
  existingKillEvidenceMatches &&
  protocolConflicts.length === 0
    ? 'READY'
    : 'REVISE';

const frozen = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status,
  writable: false,
  methodPolicy: 'GET_ONLY',
  sourceSnapshotSha256: digestOf('03-来源快照.json'),
  target,
  expectedCurrent,
  observedCurrent: {
    skillCount: initialInventory.skillKeys.length,
    ruleCount: currentRuleCount,
    sourceInitializedCount,
    killRuleCount,
    eventCounts: eventCounts(initialInventory.details),
    conditionCounts: conditionCounts(initialInventory.details),
    stableRead: stable
  },
  targetBefore: {
    subject: targetRecord.subject.data,
    rune: targetRecord.rune.data,
    relationRows: targetRelationRows,
    filteredRelationRows,
    representativeImage: targetRecord.representativeImage.data,
    componentCounts: targetCounts,
    componentKeys: targetKeys
  },
  existingKillEvidence: {
    skillKey: 'tristana_w',
    ruleKey: 'own_kill_reset',
    present: Boolean(existingKillRule),
    detail: existingKillRule,
    purpose: '只证明当前 KILL + TARGET_CATEGORY_CHECK(CHAMPION) 组合已存在；不把它当作凯旋规则。'
  },
  requestedSemantic,
  exclusions: [
    {
      branch: '额外的20金币',
      included: false,
      reason: '与1V1伤害、治疗和属性结果无关，冻结来源与候选都要求排除。'
    }
  ],
  protocolCheck: {
    supportedTargetContexts,
    killCurrentTargetBinding: '本次被击杀对象',
    killHasEventSource: false,
    requestedTargetContext: requestedSemantic.executeEffect.requestedTargetContext,
    requestedTargetContextSupported: false
  },
  conflicts: protocolConflicts,
  limitations: semanticLimitations,
  gates: {
    baselineMatches,
    targetDataMatches,
    existingKillEvidenceMatches,
    stableRead: stable,
    requestedTargetContextSupported: false,
    readyForPost: false
  },
  plannedRuleAdds: 0,
  plannedWrites: 0,
  writes: [],
  singlePostBoundary: null
};
writeJson('02-冻结请求.json', frozen);

const initialRuleKeys = initialRuleRefs.map(({ skillKey, ruleKey }) => `${skillKey}/${ruleKey}`);
const stableRuleKeys = stableRuleRefs.map(({ skillKey, ruleKey }) => `${skillKey}/${ruleKey}`);
const baseline = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  baseUrl,
  requestPolicy: {
    method: 'GET',
    authorizationValueRecorded: false,
    businessWriteIssued: false,
    writeMethodsObserved: []
  },
  sourceSnapshotSha256: digestOf('03-来源快照.json'),
  frozenRequestSha256: digestOf('02-冻结请求.json'),
  expectedCurrent,
  observedCurrent: frozen.observedCurrent,
  targetReadStatus: {
    subject: targetRecord.subject.status,
    rune: targetRecord.rune.status,
    relation: targetRecord.runeSkillRelations.status,
    filteredRelation: targetRecord.runeSkillRelationFiltered.status,
    representativeImage: targetRecord.representativeImage.status
  },
  targetComponentStatus: Object.fromEntries(
    componentKinds.map(([apiName]) => [
      apiName,
      {
        list: targetRecord.components[apiName].list.status,
        details: statusCounts(targetRecord.components[apiName].details.map(({ response }) => response))
      }
    ])
  ),
  stableVerification: {
    secondScanSkillCount: stableInventory.skillKeys.length,
    secondScanRuleCount: stableRuleRefs.length,
    secondScanEventCounts: eventCounts(stableInventory.details),
    firstScanRuleKeysSha256: sha256(Buffer.from(JSON.stringify(initialRuleKeys), 'utf8')),
    secondScanRuleKeysSha256: sha256(Buffer.from(JSON.stringify(stableRuleKeys), 'utf8')),
    stableSkillKeys,
    stableRuleRefs: stableRuleRefsEqual,
    stableRuleDetails,
    stableRead: stable
  },
  getCount,
  businessWrites: 0,
  target: targetRecord,
  allSkillRuleScan: {
    pass: '第一轮',
    skillsCatalog: initialInventory.skillsResponse,
    skillCount: initialInventory.skillKeys.length,
    ruleListCount: initialInventory.lists.length,
    ruleSummaryCount: initialRuleRefs.length,
    eventCounts: eventCounts(initialInventory.details),
    conditionCounts: conditionCounts(initialInventory.details),
    statusSummary: initialInventory.statusSummary,
    ruleLists: initialInventory.lists.map(({ skillKey, response, rules, ruleKeys }) => ({
      skillKey,
      response,
      rules,
      ruleKeys
    })),
    ruleDetails: initialInventory.details
  },
  allSkillRuleScanSecondPass: {
    pass: '第二轮',
    skillsCatalog: stableInventory.skillsResponse,
    skillCount: stableInventory.skillKeys.length,
    ruleListCount: stableInventory.lists.length,
    ruleSummaryCount: stableRuleRefs.length,
    eventCounts: eventCounts(stableInventory.details),
    conditionCounts: conditionCounts(stableInventory.details),
    statusSummary: stableInventory.statusSummary,
    skillKeys: stableInventory.skillKeys,
    ruleKeys: stableRuleKeys,
    ruleLists: stableInventory.lists.map(({ skillKey, response, rules, ruleKeys }) => ({
      skillKey,
      response,
      rules,
      ruleKeys
    })),
    ruleDetails: stableInventory.details
  },
  preservation: {
    existingRuleCount: currentRuleCount,
    existingRuleKeys: initialRuleKeys,
    targetRuleKeysBefore: targetRuleKeys,
    existingRuleObjects: initialInventory.details,
    expectedRuleCountAfterOneApprovedPost: currentRuleCount + 1,
    expectedNewRuleKeys: []
  }
};
writeJson('04-写入前现值.json', baseline);

console.log(
  JSON.stringify(
    {
      status,
      writable: false,
      getCount,
      targetStatus: {
        subject: targetRecord.subject.status,
        rune: targetRecord.rune.status,
        relation: targetRecord.runeSkillRelations.status,
        image: targetRecord.representativeImage.status,
        componentCounts: targetCounts
      },
      globalStatus: {
        skillCount: initialInventory.skillKeys.length,
        ruleCount: currentRuleCount,
        sourceInitializedCount,
        killRuleCount,
        eventCounts: eventCounts(initialInventory.details),
        conditionCounts: conditionCounts(initialInventory.details),
        stableRead: stable
      },
      sourceSnapshotSha256: digestOf('03-来源快照.json'),
      frozenRequestSha256: digestOf('02-冻结请求.json'),
      baselineSha256: digestOf('04-写入前现值.json'),
      plannedWrites: 0,
      singlePostBoundary: null,
      conflicts: protocolConflicts
    },
    null,
    2
  )
);
