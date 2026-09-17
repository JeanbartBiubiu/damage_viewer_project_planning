import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_VIEWER_BEARER;
if (!token) {
  throw new Error('请通过环境变量 DAMAGE_VIEWER_BEARER 提供本地访问凭据；脚本不保存凭据');
}

const args = process.argv.slice(2);
const apply = args.length === 1 && args[0] === '--apply';
if (args.length !== 0 && !apply) {
  throw new Error('仅允许无参数只读检查或--apply补缺');
}

const here = new URL('./', import.meta.url);
const candidateUrl = new URL('接口候选.json', here);
const sourceCandidateUrl = new URL('录入候选.json', here);
const relationUrl = new URL('关系识别-2026-09-08T02-53-49.953Z.json', here);
const candidateBytes = await readFile(candidateUrl);
const sourceCandidate = JSON.parse(await readFile(sourceCandidateUrl, 'utf8'));
const relationBytes = await readFile(relationUrl);
const candidate = JSON.parse(candidateBytes.toString('utf8'));
const relationEvidence = JSON.parse(relationBytes.toString('utf8'));
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
const outputUrl = new URL(
  '安全写入-' + (apply ? '执行' : '只读') + '-' + stamp + '.json',
  here
);
const journalUrl = new URL('安全写入流水.jsonl', here);
const expectedEquipmentKeys = ['duolanjie', 'item_1082'];

const report = {
  generatedAt: new Date().toISOString(),
  mode: apply ? '仅补缺；逐写独立GET；最终全组成回读' : '只读预检；不调用业务写接口',
  apiBaseUrl: base,
  candidateSha256: createHash('sha256').update(candidateBytes).digest('hex'),
  relationEvidenceSha256: createHash('sha256').update(relationBytes).digest('hex'),
  boundary: '本入口仅允许Luna第十批首组1056多兰之戒与1082黑暗封印；装备元数据和完整直接属性只核验、不写入。',
  objects: [],
  stopped: false
};

function isOk(response) {
  return response.status >= 200 && response.status < 300;
}

function itemsOf(data) {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.items) ? data.items : null;
}

async function request(method, path, body) {
  if (!['GET', 'POST', 'PUT'].includes(method)) {
    throw new Error('本入口禁止删除、修改和其他方法：' + method);
  }
  if (method !== 'GET' && !apply) {
    throw new Error('默认只读；只有--apply才允许写入');
  }
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/json'
  };
  const init = { method, headers, signal: AbortSignal.timeout(30000) };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(base + path, init);
  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { rawText: raw };
    }
  }
  return { status: response.status, data };
}

function compare(expected, actual, path = '', rows = []) {
  if (expected === null || typeof expected !== 'object') {
    rows.push({ path, expected, actual, equal: Object.is(expected, actual) });
    return rows;
  }
  if (Array.isArray(expected)) {
    const actualLength = Array.isArray(actual) ? actual.length : undefined;
    rows.push({
      path: path + '.length',
      expected: expected.length,
      actual: actualLength,
      equal: actualLength === expected.length
    });
    expected.forEach((value, index) => {
      compare(value, Array.isArray(actual) ? actual[index] : undefined, path + '[' + index + ']', rows);
    });
    return rows;
  }
  for (const [key, value] of Object.entries(expected)) {
    const child = actual === null || actual === undefined ? undefined : actual[key];
    compare(value, child, path ? path + '.' + key : key, rows);
  }
  return rows;
}

function mismatchText(fields) {
  return JSON.stringify(fields.filter(field => !field.equal));
}

function matchingFields(expected, actual, label) {
  const fields = compare(expected, actual);
  const mismatches = fields.filter(field => !field.equal);
  if (mismatches.length) {
    throw new Error(label + '已有值不同，异值停：' + mismatchText(fields));
  }
  return fields;
}

function relationObjectFor(object) {
  return relationEvidence.objects.find(
    value => value.selectedEquipmentKey === object.equipmentKey
  );
}

function sourceObjectFor(object) {
  return sourceCandidate.objects.find(
    value => value.equipmentKey === object.equipmentKey
  );
}

function imagePlanFor(object) {
  return candidate.representativeImages.find(
    value => value.equipmentKey === object.equipmentKey
  );
}

function validateCandidateBoundary() {
  const actualKeys = candidate.objects.map(object => object.equipmentKey);
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedEquipmentKeys)) {
    throw new Error('候选对象边界不匹配：' + JSON.stringify(actualKeys));
  }
  if (candidate.objects.length !== expectedEquipmentKeys.length) {
    throw new Error('候选对象数量不匹配');
  }
  if (!Array.isArray(candidate.relations) || candidate.relations.length !== expectedEquipmentKeys.length) {
    throw new Error('首组关系候选数量不匹配');
  }
  for (const object of candidate.objects) {
    const relation = relationObjectFor(object);
    const source = sourceObjectFor(object);
    const image = imagePlanFor(object);
    const relationCandidate = candidate.relations.find(
      value => value.equipmentKey === object.equipmentKey
    );
    if (!relation || relation.equipment?.status !== 200 || !relation.equipment.data) {
      throw new Error(object.equipmentKey + '缺少已解析装备元数据');
    }
    if (!relation.attributes || relation.attributes.status !== 200 || !relation.attributes.data) {
      throw new Error(object.equipmentKey + '缺少已解析完整直接属性');
    }
    if (!relation.representativeImage || relation.representativeImage.status !== 200) {
      throw new Error(object.equipmentKey + '缺少装备代表图证据');
    }
    if (!source || !source.historicalExistingAttributes || !source.directAttributes) {
      throw new Error(object.equipmentKey + '缺少历史属性保护证据');
    }
    if (!relationCandidate || relationCandidate.skillKey !== object.skillKey) {
      throw new Error(object.equipmentKey + '技能同键关系候选不一致');
    }
    if (!image || image.imageKey !== relation.representativeImage.data.image.imageKey) {
      throw new Error(object.equipmentKey + '代表图键与当前装备代表图不一致');
    }
    const selected = relation.selectedEquipmentKey;
    if (object.equipmentKey !== selected) {
      throw new Error(object.equipmentKey + '不是关系识别后的真实装备键');
    }
    if (object.skillKey !== relation.expectedPassiveProbe.data?.error?.details?.skillKey) {
      throw new Error(object.equipmentKey + '技能键未与关系探针对齐');
    }
    if (!Array.isArray(relation.keyProbes) || relation.keyProbes.length === 0) {
      throw new Error(object.equipmentKey + '缺少同键及别名探针');
    }
  }
}

async function readPagedDirectory(route, keyField) {
  const pageSize = 200;
  const pages = [];
  const rows = [];
  const seen = new Set();
  let total = null;
  let page = 1;
  while (page <= 1000) {
    const response = await request(
      'GET',
      route + '?page=' + page + '&pageSize=' + pageSize
    );
    if (!isOk(response)) {
      throw new Error('当前引用目录读取失败 ' + route + ' HTTP ' + response.status);
    }
    const pageItems = itemsOf(response.data);
    if (!pageItems) {
      throw new Error('当前引用目录不是数组 ' + route);
    }
    const reportedTotal = response.data && !Array.isArray(response.data)
      ? response.data.total
      : undefined;
    if (reportedTotal !== undefined && reportedTotal !== null) {
      if (!Number.isInteger(reportedTotal) || reportedTotal < 0) {
        throw new Error('当前引用目录总数不合法 ' + route);
      }
      if (total === null) total = reportedTotal;
      if (total !== reportedTotal) {
        throw new Error('当前引用目录总数在分页间变化 ' + route);
      }
    }
    const keys = pageItems.map(item => item?.[keyField]);
    if (keys.some(key => typeof key !== 'string' || key.length === 0)) {
      throw new Error('当前引用目录存在缺少标识的条目 ' + route);
    }
    if (keys.some(key => seen.has(key))) {
      throw new Error('当前引用目录分页出现重复标识 ' + route + ' page=' + page);
    }
    keys.forEach(key => seen.add(key));
    rows.push(...pageItems);
    pages.push({
      page,
      requestedPageSize: pageSize,
      status: response.status,
      itemCount: pageItems.length,
      reportedTotal: total,
      firstKey: keys[0] ?? null,
      lastKey: keys[keys.length - 1] ?? null
    });
    if (total !== null && rows.length >= total) break;
    if (pageItems.length === 0) {
      if (total === null || rows.length >= total) break;
      throw new Error('当前引用目录提前结束 ' + route);
    }
    if (pageItems.length < pageSize && total === null) break;
    if (pageItems.length < pageSize && total !== null && rows.length < total) {
      throw new Error('当前引用目录分页提前结束 ' + route);
    }
    page += 1;
  }
  if (page > 1000) throw new Error('当前引用目录分页超过1000页 ' + route);
  const finalTotal = total === null ? rows.length : total;
  if (rows.length !== finalTotal) {
    throw new Error('当前引用目录返回数量与总数不符 ' + route);
  }
  if (new Set(rows.map(item => item[keyField])).size !== rows.length) {
    throw new Error('当前引用目录标识不唯一 ' + route);
  }
  return { keyField, total: finalTotal, pages, items: rows };
}

function directorySummary(directory) {
  return {
    keyField: directory.keyField,
    total: directory.total,
    pageCount: directory.pages.length,
    pages: directory.pages,
    keys: directory.items.map(item => ({
      key: item[directory.keyField],
      name: item.name ?? null,
      status: item.status ?? null
    }))
  };
}

function collectNodes(value, callback) {
  if (!value || typeof value !== 'object') return;
  callback(value);
  if (Array.isArray(value)) {
    value.forEach(child => collectNodes(child, callback));
  } else {
    Object.values(value).forEach(child => collectNodes(child, callback));
  }
}

function referenceIssues(directories) {
  const issues = [];
  const skills = new Set(directories.skills.items.map(item => item.skillKey));
  const categories = new Set(directories.categories.items.map(item => item.skillCategoryKey));
  const attributes = new Set(directories.attributes.items.map(item => item.attributeKey));
  const modifierZones = new Set(directories.modifierZones.items.map(item => item.modifierZoneKey));
  const candidateSkillKeys = new Set();
  for (const object of candidate.objects) {
    const payload = object.apiPayload;
    if (candidateSkillKeys.has(payload.skill.skillKey)) {
      issues.push('候选技能同键重复：' + payload.skill.skillKey);
    }
    candidateSkillKeys.add(payload.skill.skillKey);
    if (skills.has(payload.skill.skillKey)) {
      report.directorySkillConflicts = report.directorySkillConflicts ?? [];
      report.directorySkillConflicts.push({
        equipmentKey: object.equipmentKey,
        skillKey: payload.skill.skillKey,
        action: '现有技能由逐项预检决定same或异值停'
      });
    }
    for (const categoryKey of payload.skill.skillCategoryKeys ?? []) {
      if (!categories.has(categoryKey)) {
        issues.push(object.skillKey + '引用未发现的技能分类：' + categoryKey);
      }
    }
    const source = sourceObjectFor(object);
    for (const attributeKey of Object.keys(source.historicalExistingAttributes)) {
      if (!attributes.has(attributeKey)) {
        issues.push(object.equipmentKey + '现有直接属性目录缺少：' + attributeKey);
      }
    }
    const parameterKeys = new Set(payload.parameters.map(value => value.parameterKey));
    const formulaKeys = new Set(payload.formulas.map(value => value.formulaKey));
    const formulaReferences = [];
    for (const formula of payload.formulas) {
      collectNodes(formula.expression, node => {
        if (node.nodeType === 'PARAMETER') formulaReferences.push(node.parameterKey);
      });
    }
    for (const key of formulaReferences) {
      if (!parameterKeys.has(key)) {
        issues.push(object.skillKey + '公式引用候选外参数：' + key);
      }
    }
    for (const effect of payload.effects) {
      collectNodes(effect.lifecycle, node => {
        if (node.kind === 'PARAMETER' && !parameterKeys.has(node.parameterKey)) {
          issues.push(object.skillKey + '生命周期引用候选外参数：' + node.parameterKey);
        }
      });
      for (const result of effect.results) {
        collectNodes(result.valueRule, node => {
          if (node.kind === 'FORMULA' && !formulaKeys.has(node.formulaKey)) {
            issues.push(object.skillKey + '结果引用候选外公式：' + node.formulaKey);
          }
        });
        const attributeKey = result.detail?.attributeKey;
        const modifierZoneKey = result.detail?.modifierZoneKey;
        if (attributeKey && !attributes.has(attributeKey)) {
          issues.push(object.skillKey + '效果引用未发现的属性：' + attributeKey);
        }
        if (modifierZoneKey && !modifierZones.has(modifierZoneKey)) {
          issues.push(object.skillKey + '效果引用未发现的乘区：' + modifierZoneKey);
        }
      }
    }
  }
  return issues;
}

async function aliasAndEquipmentGuard(object, record) {
  const relation = relationObjectFor(object);
  const source = sourceObjectFor(object);
  const imagePlan = imagePlanFor(object);
  const aliasProbes = [];
  for (const expectedProbe of relation.keyProbes) {
    const key = expectedProbe.key;
    const current = await request('GET', '/equipment/' + encodeURIComponent(key));
    if (current.status !== expectedProbe.response.status) {
      throw new Error(
        object.equipmentKey + '同键/别名探针状态变化：' + key +
        ' expected=' + expectedProbe.response.status + ' actual=' + current.status
      );
    }
    if (expectedProbe.response.status === 200) {
      matchingFields(expectedProbe.response.data, current.data, '/equipment/' + key);
      if (current.data?.equipmentKey !== object.equipmentKey) {
        throw new Error(object.equipmentKey + '别名探针返回了其他装备键：' + key);
      }
    } else if (expectedProbe.response.status !== 404) {
      throw new Error(object.equipmentKey + '存在未处理的别名探针状态：' + expectedProbe.response.status);
    }
    aliasProbes.push({ key, expectedStatus: expectedProbe.response.status, response: current });
  }
  record.safeguards.push({ kind: '同键及别名', probes: aliasProbes });

  const equipmentPath = '/equipment/' + encodeURIComponent(object.equipmentKey);
  const attributesPath = equipmentPath + '/attributes';
  const imagePath = equipmentPath + '/representative-image';
  const equipment = await request('GET', equipmentPath);
  const attributes = await request('GET', attributesPath);
  const image = await request('GET', imagePath);
  if (!isOk(equipment) || !isOk(attributes) || !isOk(image)) {
    throw new Error(
      object.equipmentKey + '装备元数据/完整属性/代表图预检失败：' +
      [equipment.status, attributes.status, image.status].join('/')
    );
  }
  const metadataFields = matchingFields(
    relation.equipment.data,
    equipment.data,
    equipmentPath
  );
  const attributeFields = matchingFields(
    relation.attributes.data,
    attributes.data,
    attributesPath
  );
  const imageFields = matchingFields(
    relation.representativeImage.data,
    image.data,
    imagePath
  );
  matchingFields(
    source.historicalExistingAttributes,
    attributes.data.attributeValues,
    attributesPath + '.attributeValues'
  );
  matchingFields(
    source.directAttributes,
    attributes.data.attributeValues,
    attributesPath + '.attributeValues.direct'
  );
  if (image.data?.image?.imageKey !== imagePlan.imageKey) {
    throw new Error(object.equipmentKey + '当前装备代表图与计划图片键不一致');
  }
  record.safeguards.push({
    kind: '装备元数据、完整直接属性和装备代表图',
    equipment: { path: equipmentPath, status: equipment.status, data: equipment.data, fields: metadataFields },
    attributes: {
      path: attributesPath,
      status: attributes.status,
      data: attributes.data,
      fields: attributeFields,
      preservedAttributeKeys: Object.keys(attributes.data.attributeValues ?? {})
    },
    representativeImage: { path: imagePath, status: image.status, data: image.data, fields: imageFields },
    note: '直接属性只保护现值；多兰之戒mana=50包含在完整属性回读中，未生成属性写入动作。'
  });
  return { imageKey: imagePlan.imageKey };
}

function resourceEntries(object, imageKey) {
  const payload = object.apiPayload;
  const skillPath = '/skills/' + encodeURIComponent(object.skillKey);
  const entries = [
    { kind: 'skill', path: skillPath, createPath: '/skills', expected: payload.skill }
  ];
  const collections = [
    ['parameters', 'parameterKey', 'parameter'],
    ['formulas', 'formulaKey', 'formula'],
    ['effects', 'effectKey', 'effect'],
    ['trigger-rules', 'ruleKey', 'trigger-rule']
  ];
  for (const [collection, keyField, kind] of collections) {
    const values = collection === 'trigger-rules' ? payload.triggerRules : payload[collection];
    for (const expected of values ?? []) {
      const key = expected[keyField];
      entries.push({
        kind,
        path: skillPath + '/' + collection + '/' + encodeURIComponent(key),
        createPath: skillPath + '/' + collection,
        expected
      });
    }
  }
  const relation = candidate.relations.find(
    value => value.equipmentKey === object.equipmentKey
  );
  entries.push({
    kind: 'relation',
    path: '/equipment-skill-relations?equipmentKey=' + encodeURIComponent(object.equipmentKey),
    createPath: '/equipment-skill-relations',
    expected: relation
  });
  entries.push({
    kind: 'representative-image',
    path: skillPath + '/representative-image',
    createPath: skillPath + '/representative-image',
    method: 'PUT',
    expected: { imageKey }
  });
  return entries;
}

function actualFor(entry, response) {
  if (entry.kind === 'relation') {
    const values = itemsOf(response.data) ?? [];
    const matches = values.filter(item => item?.skillKey === entry.expected.skillKey);
    if (matches.length > 1) {
      throw new Error('装备技能关系存在重复同键：' + entry.expected.skillKey);
    }
    return matches[0];
  }
  if (entry.kind === 'representative-image') {
    return response.data?.image
      ? { imageKey: response.data.image.imageKey }
      : null;
  }
  return response.data;
}

async function inspectEntry(entry) {
  const response = await request('GET', entry.path);
  if (isOk(response)) {
    const actual = actualFor(entry, response);
    if (actual === undefined || actual === null) {
      return { state: 'missing', response, actual: null };
    }
    const fields = matchingFields(entry.expected, actual, entry.path);
    return { state: 'same', response, actual, fields };
  }
  if (response.status === 404) {
    return { state: 'missing', response, actual: null };
  }
  throw new Error('写前或回读读取失败 ' + entry.path + ' HTTP ' + response.status);
}

function journalLine(value) {
  return JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n';
}

async function persist() {
  const entries = report.objects.flatMap(object => object.components ?? []);
  const states = ['same', 'created', 'missing'];
  report.summary = {
    objectCount: report.objects.length,
    componentCount: entries.length,
    failedObjectCount: report.objects.filter(object => object.error).length,
    createdCount: entries.filter(entry => entry.state === 'created').length,
    sameCount: entries.filter(entry => entry.state === 'same').length,
    missingCount: entries.filter(entry => entry.state === 'missing').length,
    verifiedWriteCount: entries.filter(
      entry => entry.write && entry.afterWriteFields?.every(field => field.equal)
    ).length,
    mismatchCount: entries.flatMap(entry => entry.afterWriteFields ?? []).filter(field => !field.equal).length,
    stateValues: states.reduce(
      (result, state) => ({ ...result, [state]: entries.filter(entry => entry.state === state).length }),
      {}
    ),
    kindCounts: Object.fromEntries(
      ['skill', 'parameter', 'formula', 'effect', 'trigger-rule', 'relation', 'representative-image']
        .map(kind => [
          kind,
          entries.filter(entry => entry.kind === kind && ['same', 'created'].includes(entry.state)).length
        ])
    )
  };
  await writeFile(outputUrl, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

async function applyMissing(entry, object, record) {
  const immediate = await inspectEntry(entry);
  entry.immediatePreflight = immediate.response;
  if (immediate.state === 'same') {
    entry.state = 'same';
    entry.raceResolution = '逐写前已被其他写入补齐，现值与候选一致，未重复写入';
    entry.fields = immediate.fields;
    return;
  }
  if (immediate.state !== 'missing') {
    throw new Error('逐写前状态不是缺项：' + entry.path);
  }
  await appendFile(
    journalUrl,
    journalLine({
      phase: 'before-write',
      equipmentKey: object.equipmentKey,
      skillKey: object.skillKey,
      kind: entry.kind,
      method: entry.method ?? 'POST',
      path: entry.createPath,
      expected: entry.expected
    }),
    'utf8'
  );
  try {
    entry.write = await request(entry.method ?? 'POST', entry.createPath, entry.expected);
  } catch (error) {
    entry.write = { networkError: error.message };
  }
  const after = await request('GET', entry.path);
  entry.afterWriteReadback = after;
  if (!isOk(after)) {
    throw new Error('写后独立GET失败 ' + entry.path + ' HTTP ' + after.status);
  }
  const actual = actualFor(entry, after);
  if (actual === undefined || actual === null) {
    throw new Error('写后独立GET未返回目标组成 ' + entry.path);
  }
  entry.afterWriteFields = matchingFields(entry.expected, actual, entry.path);
  entry.state = 'created';
  if (entry.write.networkError || !isOk(entry.write)) {
    entry.writeWarning = '写请求响应未确认，但写后独立GET已精确匹配；未重试写请求';
  }
  await appendFile(
    journalUrl,
    journalLine({
      phase: 'after-independent-get',
      equipmentKey: object.equipmentKey,
      skillKey: object.skillKey,
      kind: entry.kind,
      method: entry.method ?? 'POST',
      path: entry.path,
      write: entry.write,
      readback: entry.afterWriteReadback,
      mismatchCount: 0
    }),
    'utf8'
  );
  await persist();
}

async function finalReadback(record, object) {
  record.finalReadback = [];
  for (const entry of record.components) {
    const response = await request('GET', entry.path);
    const result = {
      kind: entry.kind,
      path: entry.path,
      status: response.status,
      data: response.data
    };
    if (isOk(response)) {
      const actual = actualFor(entry, response);
      if (actual === undefined || actual === null) {
        result.state = 'missing';
        if (apply) throw new Error('最终独立GET未返回目标组成 ' + entry.path);
      } else {
        result.fields = matchingFields(entry.expected, actual, entry.path);
        result.state = 'same';
      }
    } else if (response.status === 404) {
      result.state = 'missing';
      if (apply) throw new Error('最终独立GET仍缺项 ' + entry.path);
    } else {
      throw new Error('最终独立GET失败 ' + entry.path + ' HTTP ' + response.status);
    }
    record.finalReadback.push(result);
  }
}

async function main() {
  validateCandidateBoundary();
  const directories = {
    skills: await readPagedDirectory('/skills', 'skillKey'),
    categories: await readPagedDirectory('/skill-categories', 'skillCategoryKey'),
    attributes: await readPagedDirectory('/attributes', 'attributeKey'),
    modifierZones: await readPagedDirectory('/modifier-zones', 'modifierZoneKey')
  };
  report.directory = {
    skills: directorySummary(directories.skills),
    categories: directorySummary(directories.categories),
    attributes: directorySummary(directories.attributes),
    modifierZones: directorySummary(directories.modifierZones)
  };
  const issues = referenceIssues(directories);
  report.directoryReferenceCheck = {
    passed: issues.length === 0,
    issues,
    note: '技能目录总数取自本次GET返回并按返回total动态分页；没有固定905或其他旧总数。'
  };
  if (issues.length) {
    throw new Error('当前引用目录预检失败：' + JSON.stringify(issues));
  }
  await persist();

  for (const object of candidate.objects) {
    const record = {
      equipmentKey: object.equipmentKey,
      skillKey: object.skillKey,
      status: '进行中',
      safeguards: [],
      components: [],
      omittedComponents: object.omittedComponents ?? [],
      fullEquipmentComplete: object.fullEquipmentComplete === true
    };
    report.objects.push(record);
    try {
      const guard = await aliasAndEquipmentGuard(object, record);
      for (const entry of resourceEntries(object, guard.imageKey)) {
        const inspected = await inspectEntry(entry);
        Object.assign(entry, inspected);
        record.components.push(entry);
      }
      await persist();
      if (apply) {
        for (const entry of record.components) {
          if (entry.state === 'missing') {
            await applyMissing(entry, object, record);
          }
        }
      }
      await finalReadback(record, object);
      const missing = record.finalReadback.filter(item => item.state === 'missing');
      record.status = apply
        ? '已补缺并独立回读全组成'
        : missing.length
          ? '只读预检通过；存在候选缺项，待--apply'
          : '只读预检通过；候选组成已存在';
    } catch (error) {
      record.status = '停止当前批次';
      record.error = error.message;
      report.stopped = true;
      await persist();
      throw error;
    }
    await persist();
  }
  await persist();
  console.log(JSON.stringify({
    mode: report.mode,
    output: outputUrl.pathname,
    directorySkillTotal: report.directory.skills.total,
    summary: report.summary,
    stopped: report.stopped
  }, null, 2));
  if (report.stopped || report.summary.failedObjectCount) process.exitCode = 1;
}

await main().catch(async error => {
  report.stopped = true;
  report.error = error.message;
  try {
    await persist();
  } catch (persistError) {
    report.persistError = persistError.message;
  }
  console.error(JSON.stringify({
    mode: report.mode,
    output: outputUrl.pathname,
    error: report.error,
    stopped: true
  }, null, 2));
  process.exitCode = 1;
});
