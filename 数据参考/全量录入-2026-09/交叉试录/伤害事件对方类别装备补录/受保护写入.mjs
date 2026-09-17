import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token) throw new Error('缺少 DAMAGE_ENTRY_TOKEN');

const approvedHashes = JSON.parse(process.env.DAMAGE_APPROVED_HASHES_JSON ?? 'null');
const requiredFiles = [
  '01-来源与方案.md',
  '02-冻结请求.json',
  '03-来源快照.json',
  '04-写入前现值.json',
  '05-Cursor独立评审.json'
];
if (!approvedHashes || typeof approvedHashes !== 'object'
  || Object.keys(approvedHashes).length !== requiredFiles.length
  || requiredFiles.some(file => !/^[0-9a-f]{64}$/.test(approvedHashes[file] ?? ''))) {
  throw new Error('批准散列文件集合不符');
}

const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const outputPath = path.join(here, '06-写入与即时回读.json');
const report = {
  startedAt: new Date().toISOString(),
  status: 'RUNNING',
  authorizationValueRecorded: false,
  approvedHashes,
  cursorReview: null,
  preflight: { staticRequests: [], triggerRuleScan: null },
  writes: [],
  finalReadback: { targets: [], protectedStaticRequests: [], triggerRuleScan: null },
  businessWriteCount: 0,
  error: null
};

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
};
const equal = (actual, expected) => JSON.stringify(stable(actual)) === JSON.stringify(stable(expected));
const subsetEqual = (actual, expected) => {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length
      && expected.every((value, index) => subsetEqual(actual[index], value));
  }
  if (expected && typeof expected === 'object') {
    return actual && typeof actual === 'object' && !Array.isArray(actual)
      && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && subsetEqual(actual[key], value));
  }
  return Object.is(actual, expected);
};
const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaFile = file => shaBytes(fs.readFileSync(file));
const shaValue = value => shaBytes(JSON.stringify(stable(value)));
const persist = () => fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');

async function request(method, route, body = null) {
  if (!['GET', 'PUT', 'POST'].includes(method)) throw new Error(`拒绝未批准的请求方法：${method}`);
  const response = await fetch(base + route, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === null ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { parseError: true, responseBytes: Buffer.byteLength(text) }; }
  }
  return { method, route, status: response.status, data };
}

async function mapLimit(values, limit, work) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await work(values[index], index);
    }
  }));
  return results;
}

const conditionsOf = rule => (rule.conditionGroups ?? []).flatMap(group => group.conditions ?? []);
const damageEventTypes = new Set(['DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN']);

async function scanTriggerRules() {
  const skills = await request('GET', '/skills');
  if (skills.status !== 200 || !Array.isArray(skills.data?.items)
    || skills.data.items.length !== skills.data.total) throw new Error('技能清单回读异常');
  const skillKeys = skills.data.items.map(item => item.skillKey).sort();
  const lists = await mapLimit(skillKeys, 24, async skillKey => {
    const route = `/skills/${encodeURIComponent(skillKey)}/trigger-rules`;
    const response = await request('GET', route);
    if (response.status !== 200 || !Array.isArray(response.data)) throw new Error(`规则列表回读异常：${route}`);
    return { skillKey, rules: response.data };
  });
  const summaries = lists.flatMap(item => item.rules.map(rule => ({ skillKey: item.skillKey, ruleKey: rule.ruleKey })));
  const rules = await mapLimit(summaries, 24, async item => {
    const route = `/skills/${encodeURIComponent(item.skillKey)}/trigger-rules/${encodeURIComponent(item.ruleKey)}`;
    const response = await request('GET', route);
    if (response.status !== 200) throw new Error(`规则详情回读异常：${route}`);
    return { ...item, data: response.data };
  });
  rules.sort((left, right) => left.skillKey.localeCompare(right.skillKey) || left.ruleKey.localeCompare(right.ruleKey));
  const categoryConditionCount = rules.reduce((sum, item) => sum
    + conditionsOf(item.data).filter(condition => condition.conditionType === 'TARGET_CATEGORY_CHECK').length, 0);
  const damageRules = rules.filter(item => damageEventTypes.has(item.data.eventSource?.eventType));
  const damageRulesWithTargetCategory = damageRules.filter(item => conditionsOf(item.data)
    .some(condition => condition.conditionType === 'TARGET_CATEGORY_CHECK'));
  return {
    skillCount: skillKeys.length,
    listGetCount: skillKeys.length,
    detailGetCount: rules.length,
    ruleCount: rules.length,
    targetCategoryConditionCount: categoryConditionCount,
    damageRuleCount: damageRules.length,
    damageRulesWithTargetCategoryCount: damageRulesWithTargetCategory.length,
    sha256: shaValue(rules),
    rules
  };
}

const detailRoute = entry => entry.detailRoute ?? entry.route;

try {
  for (const file of requiredFiles) {
    const actual = shaFile(path.join(here, file));
    if (actual !== approvedHashes[file]) throw new Error(`${file} 散列漂移：${actual}`);
  }

  const frozen = JSON.parse(fs.readFileSync(path.join(here, '02-冻结请求.json'), 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(path.join(here, '04-写入前现值.json'), 'utf8'));
  const review = JSON.parse(fs.readFileSync(path.join(here, '05b-冻结请求Cursor复核.json'), 'utf8'));
  if (frozen.planRevision !== 1 || frozen.plannedWrites !== 9 || frozen.writes?.length !== 9
    || frozen.writes.filter(item => item.method === 'PUT').length !== 6
    || frozen.writes.filter(item => item.method === 'POST').length !== 3
    || frozen.writes.some(item => !['PUT', 'POST'].includes(item.method))) {
    throw new Error('冻结写入数量、方法或版本不符');
  }
  const allowedWriteRoutes = new Set([
    'PUT /skills/item_4629_passive',
    'PUT /skills/item_4629_passive/effects/spelldance_move_speed',
    'POST /skills/item_4629_passive/trigger-rules',
    'PUT /skills/item_3803_passive',
    'PUT /skills/item_3803_passive/parameters/damage_input',
    'PUT /skills/item_3803_passive/formulas/mana_restore_from_damage',
    'PUT /skills/item_3803_passive/effects/mana_from_hero_damage',
    'POST /skills/item_3803_passive/trigger-rules'
  ]);
  if (frozen.writes.some(item => !allowedWriteRoutes.has(`${item.method} ${item.route}`))) {
    throw new Error('冻结请求包含范围外写入路由');
  }
  const detailRoutes = frozen.writes.map(detailRoute);
  if (new Set(detailRoutes).size !== 9) throw new Error('冻结请求存在重复写入目标');

  for (const source of frozen.sources ?? []) {
    if (shaFile(source.path) !== source.sha256) throw new Error(`固定来源散列漂移：${source.path}`);
  }
  if (baseline.methodPolicy !== 'GET_ONLY' || baseline.businessWrites !== 0
    || baseline.triggerRuleScan?.skillCount !== 1062 || baseline.triggerRuleScan?.ruleCount !== 87
    || baseline.triggerRuleScan?.targetCategoryConditionCount !== 5
    || baseline.triggerRuleScan?.damageRuleCount !== 3
    || baseline.triggerRuleScan?.damageRulesWithTargetCategoryCount !== 0) {
    throw new Error('写入前基线元数据不符');
  }

  if (review.resultStatus !== 'finished' || review.verdict !== 'READY' || review.reviewedPlanRevision !== 1
    || !equal(review.approvedHashes, approvedHashes) || review.blockers?.length !== 0
    || review.model?.id !== 'grok-4.6' || review.model?.effort !== 'high' || review.model?.fast !== false
    || review.model?.sdkVersion !== '1.0.24'
    || review.writeAllowlistAudit?.auditAvailable !== true || review.writeAllowlistAudit?.runDeltaCount !== 0
    || review.writeAllowlistAudit?.outsideScopeCount !== 0 || review.writeAllowlistAudit?.runDeltaOutsideScopeCount !== 0
    || review.toolEvents?.allTerminalCallsCompleted !== true || review.toolEvents?.anyTruncated !== false
    || review.shellCommandsAudited !== true || review.apiWrites !== 0) {
    throw new Error('Cursor 冻结请求复核未满足写入门禁');
  }
  const cursorSummaryPath = path.resolve(review.artifactSummary);
  if (shaFile(cursorSummaryPath) !== review.artifactSummarySha256) throw new Error('Cursor 复核原始摘要散列漂移');
  const cursorSummary = JSON.parse(fs.readFileSync(cursorSummaryPath, 'utf8'));
  const cursorCallIds = [...new Set((cursorSummary.toolCalls ?? []).map(call => call.callId))];
  const incompleteCursorCalls = cursorCallIds.filter(callId => !(cursorSummary.toolCalls ?? [])
    .filter(call => call.callId === callId).some(call => call.status === 'completed'));
  if (cursorSummary.runId !== review.runId || cursorSummary.requestId !== review.requestId
    || cursorSummary.resultStatus !== 'finished' || cursorSummary.resultModel?.id !== 'grok-4.6'
    || cursorSummary.writeAllowlistAudit?.runDeltaCount !== 0
    || cursorSummary.writeAllowlistAudit?.outsideScopeCount !== 0
    || cursorSummary.writeAllowlistAudit?.runDeltaOutsideScopeCount !== 0
    || incompleteCursorCalls.length !== 0
    || (cursorSummary.toolCalls ?? []).some(call => call.truncated === true)
    || !cursorSummary.result?.result?.includes('VERDICT: READY')
    || !requiredFiles.every(file => cursorSummary.result.result.includes(`${file}: ${approvedHashes[file]}`))) {
    throw new Error('Cursor 复核原始摘要内容不符');
  }
  report.cursorReview = {
    runId: review.runId,
    requestId: review.requestId,
    resultStatus: review.resultStatus,
    model: review.model,
    verdict: review.verdict,
    reviewedPlanRevision: review.reviewedPlanRevision,
    uniqueToolCalls: cursorCallIds.length,
    allTerminalCallsCompleted: true,
    anyTruncated: false,
    runDeltaCount: 0,
    apiWrites: 0
  };
  persist();

  for (const expected of baseline.staticRequests) {
    const actual = await request('GET', expected.route);
    report.preflight.staticRequests.push({
      route: expected.route,
      status: actual.status,
      sha256: shaValue(actual.data),
      matched: actual.status === expected.status && equal(actual.data, expected.data)
    });
    persist();
    if (actual.status !== expected.status || !equal(actual.data, expected.data)) {
      throw new Error(`写前现值漂移：${expected.route}`);
    }
  }

  const preflightScan = await scanTriggerRules();
  report.preflight.triggerRuleScan = { ...preflightScan, rules: undefined };
  persist();
  if (!equal(preflightScan.rules, baseline.triggerRuleScan.rules)
    || preflightScan.sha256 !== baseline.triggerRuleScan.sha256
    || preflightScan.skillCount !== 1062 || preflightScan.ruleCount !== 87
    || preflightScan.targetCategoryConditionCount !== 5
    || preflightScan.damageRuleCount !== 3
    || preflightScan.damageRulesWithTargetCategoryCount !== 0) {
    throw new Error('写前全库触发规则基线漂移');
  }

  for (const entry of frozen.writes) {
    const route = detailRoute(entry);
    const before = await request('GET', route);
    const expectedBefore = baseline.staticRequests.find(item => item.route === route);
    if (!expectedBefore || before.status !== expectedBefore.status || !equal(before.data, expectedBefore.data)) {
      throw new Error(`写入目标即时现值漂移：${route}`);
    }
    const bodySha256 = shaValue(entry.body);
    const changed = await request(entry.method, entry.route, entry.body);
    report.businessWriteCount += 1;
    const writeLog = {
      method: entry.method,
      route: entry.route,
      detailRoute: route,
      bodySha256,
      responseStatus: changed.status,
      immediateReadback: null
    };
    report.writes.push(writeLog);
    persist();
    const expectedStatus = entry.method === 'POST' ? 201 : 200;
    if (changed.status !== expectedStatus || !subsetEqual(changed.data, entry.body)) {
      throw new Error(`写入响应不符：${entry.method} ${entry.route} (${changed.status})`);
    }
    const immediate = await request('GET', route);
    writeLog.immediateReadback = immediate;
    persist();
    if (immediate.status !== 200 || !subsetEqual(immediate.data, entry.body)) {
      throw new Error(`即时回读不符：${route}`);
    }
  }

  for (const entry of frozen.writes) {
    const route = detailRoute(entry);
    const actual = await request('GET', route);
    report.finalReadback.targets.push(actual);
    if (actual.status !== 200 || !subsetEqual(actual.data, entry.body)) {
      throw new Error(`最终目标回读不符：${route}`);
    }
  }

  const affectedListRoutes = new Set([
    '/skills/item_4629_passive/effects',
    '/skills/item_4629_passive/trigger-rules',
    '/skills/item_3803_passive/parameters',
    '/skills/item_3803_passive/formulas',
    '/skills/item_3803_passive/effects',
    '/skills/item_3803_passive/trigger-rules'
  ]);
  const changedRoutes = new Set(detailRoutes);
  for (const expected of baseline.staticRequests) {
    if (changedRoutes.has(expected.route) || affectedListRoutes.has(expected.route)) continue;
    const actual = await request('GET', expected.route);
    report.finalReadback.protectedStaticRequests.push({
      route: expected.route,
      status: actual.status,
      sha256: shaValue(actual.data),
      matched: actual.status === expected.status && equal(actual.data, expected.data)
    });
    if (actual.status !== expected.status || !equal(actual.data, expected.data)) {
      throw new Error(`受保护接口发生变化：${expected.route}`);
    }
  }

  const listExpectations = [
    ['/skills/item_4629_passive/effects', 'effectKey', ['spelldance_move_speed']],
    ['/skills/item_4629_passive/trigger-rules', 'ruleKey', ['on_magic_damage_dealt_to_champion', 'on_real_damage_dealt_to_champion']],
    ['/skills/item_3803_passive/parameters', 'parameterKey', baseline.staticRequests
      .find(item => item.route === '/skills/item_3803_passive/parameters').data.map(item => item.parameterKey)],
    ['/skills/item_3803_passive/formulas', 'formulaKey', baseline.staticRequests
      .find(item => item.route === '/skills/item_3803_passive/formulas').data.map(item => item.formulaKey)],
    ['/skills/item_3803_passive/effects', 'effectKey', baseline.staticRequests
      .find(item => item.route === '/skills/item_3803_passive/effects').data.map(item => item.effectKey)],
    ['/skills/item_3803_passive/trigger-rules', 'ruleKey', ['on_damage_taken_from_champion_restore_mana']]
  ];
  for (const [route, key, expectedKeys] of listExpectations) {
    const actual = await request('GET', route);
    report.finalReadback.protectedStaticRequests.push({ route, status: actual.status, keys: actual.data?.map?.(item => item[key]) });
    const actualKeys = actual.data?.map?.(item => item[key]).sort();
    if (actual.status !== 200 || !equal(actualKeys, [...expectedKeys].sort())) {
      throw new Error(`受影响列表结构不符：${route}`);
    }
  }

  const finalScan = await scanTriggerRules();
  const baselineMap = new Map(baseline.triggerRuleScan.rules
    .map(item => [`${item.skillKey}\u0000${item.ruleKey}`, item.data]));
  const postMap = new Map(frozen.writes.filter(item => item.method === 'POST')
    .map(item => [`${item.detailRoute.split('/')[2]}\u0000${item.body.ruleKey}`, item.body]));
  const finalMap = new Map(finalScan.rules.map(item => [`${item.skillKey}\u0000${item.ruleKey}`, item.data]));
  const expectedKeys = new Set([...baselineMap.keys(), ...postMap.keys()]);
  if (finalMap.size !== expectedKeys.size || [...finalMap.keys()].some(key => !expectedKeys.has(key))) {
    throw new Error('写后出现非冻结触发规则增删');
  }
  for (const [key, expected] of baselineMap) {
    if (!equal(finalMap.get(key), expected)) throw new Error(`既有触发规则发生变化：${key.replace('\u0000', '/')}`);
  }
  for (const [key, expected] of postMap) {
    if (!subsetEqual(finalMap.get(key), expected)) throw new Error(`新增触发规则回读不符：${key.replace('\u0000', '/')}`);
  }
  if (finalScan.skillCount !== 1062 || finalScan.ruleCount !== 90
    || finalScan.targetCategoryConditionCount !== 8
    || finalScan.damageRuleCount !== 6
    || finalScan.damageRulesWithTargetCategoryCount !== 3) {
    throw new Error('写后全库触发规则计数不符');
  }
  report.finalReadback.triggerRuleScan = { ...finalScan, rules: undefined };

  report.status = 'PASS';
  report.completedAt = new Date().toISOString();
  persist();
  process.stdout.write(JSON.stringify({
    status: report.status,
    approvedHashCount: requiredFiles.length,
    cursorUniqueToolCalls: cursorCallIds.length,
    preflightStaticGETs: report.preflight.staticRequests.length,
    preflightRuleGETs: preflightScan.listGetCount + preflightScan.detailGetCount + 1,
    businessWrites: report.businessWriteCount,
    immediateReadbacks: report.writes.length,
    finalRuleCount: finalScan.ruleCount,
    finalCategoryConditionCount: finalScan.targetCategoryConditionCount,
    finalDamageRuleCount: finalScan.damageRuleCount,
    finalDamageRulesWithCategory: finalScan.damageRulesWithTargetCategoryCount
  }, null, 2));
} catch (error) {
  report.status = 'FAILED';
  report.error = { message: error instanceof Error ? error.message : String(error) };
  report.completedAt = new Date().toISOString();
  persist();
  throw error;
}
