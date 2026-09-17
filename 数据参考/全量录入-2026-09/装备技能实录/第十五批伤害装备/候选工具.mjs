import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const selectedIds = [2503, 2508, 3118, 3152, 6660, 6655, 3094, 3095, 3087, 3147, 6699, 4646];
export const source = JSON.parse(await readFile(path.join(here, '冻结来源.json'), 'utf8'));
export const before = JSON.parse(await readFile(path.join(here, '写前现值.json'), 'utf8'));

export const clean = value => Math.round(value * 1e6) / 1e6;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const readJson = name => readFile(path.join(here, name), 'utf8').then(JSON.parse);
export const writeJson = (name, value) => writeFile(path.join(here, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
export const fixed = value => ({ kind: 'FIXED', value });
export const parameterNode = parameterKey => ({ nodeType: 'PARAMETER', parameterKey });
export const attributeNode = (attributeOwner, attributeKey, attributeValueKind) => ({
  nodeType: 'ATTRIBUTE', attributeOwner, attributeKey, attributeValueKind
});
export const operation = (operationName, ...operands) => ({ nodeType: 'OPERATION', operation: operationName, operands });
export const sourcePointer = id => `/Items~1${id}`;

const sourceById = new Map(source.objects.map(object => [object.id, object]));
const beforeByKey = new Map(before.objects.map(object => [object.equipmentKey, object]));

function record(live, route) {
  const item = live.records.find(entry => entry.route === route);
  assert.ok(item, `${live.equipmentKey} 缺少现值路由 ${route}`);
  return item;
}

function relationItems(data) {
  const items = Array.isArray(data) ? data : data?.items;
  assert.ok(Array.isArray(items), '装备技能关系现值不是列表');
  if (data?.total != null) assert.equal(data.total, items.length, '装备技能关系现值未完整');
  return items;
}

export function data(object, key) {
  const rows = object.object.mDataValues?.filter(value => value.mName === key) ?? [];
  assert.ok(rows.length, `${object.path}/${key} 缺少数据值`);
  assert.ok(rows.every(row => Number.isFinite(row.mValue)), `${object.path}/${key} 含缺失数值`);
  return clean(rows[0].mValue);
}

export function dataRows(object, key) {
  return (object.object.mDataValues ?? []).filter(value => value.mName === key);
}

export function numberCalculation(object, key) {
  const calculation = object.object.mItemCalculations?.[key];
  assert.ok(calculation, `${object.path}/mItemCalculations/${key} 缺少计算式`);
  assert.equal(calculation.__type, 'GameCalculation');
  assert.equal(calculation.mFormulaParts?.length, 1);
  const part = calculation.mFormulaParts[0];
  assert.equal(part.__type, 'NumberCalculationPart');
  assert.ok(Number.isFinite(part.mNumber));
  return clean(part.mNumber);
}

function liveSkill(live, skillKey) {
  const item = live.skills.find(skill => skill.skillKey === skillKey);
  assert.ok(item, `${live.equipmentKey} 缺少技能现值 ${skillKey}`);
  return item;
}

export function base(id, kind, title, description) {
  assert.ok(selectedIds.includes(id), `装备不在第十五批范围内：${id}`);
  const object = sourceById.get(id);
  assert.ok(object, `冻结来源缺少装备 ${id}`);
  const live = beforeByKey.get(object.equipmentKey);
  assert.ok(live, `写前现值缺少 ${object.equipmentKey}`);
  assert.deepEqual(live.possibleAliases, [], `${object.equipmentKey} 存在技能别名，必须先人工比较`);

  const skillKey = `${object.equipmentKey}_${kind}`;
  const equipment = record(live, `/equipment/${object.equipmentKey}`);
  const attributes = record(live, `/equipment/${object.equipmentKey}/attributes`);
  const image = record(live, `/equipment/${object.equipmentKey}/representative-image`);
  const relations = record(live, `/equipment-skill-relations?equipmentKey=${object.equipmentKey}`);
  assert.equal(equipment.status, 200, `${object.equipmentKey} 装备主体现值非200`);
  assert.equal(attributes.status, 200, `${object.equipmentKey} 装备属性现值非200`);
  assert.equal(image.status, 200, `${object.equipmentKey} 装备图片现值非200`);
  assert.equal(relations.status, 200, `${object.equipmentKey} 装备技能关系现值非200`);
  assert.equal(equipment.data?.equipmentKey, object.equipmentKey);
  assert.equal(equipment.data?.name, object.name);
  assert.equal(attributes.data?.equipmentKey, object.equipmentKey);
  assert.ok(image.data?.image?.imageKey, `${object.equipmentKey} 缺少装备代表图键`);
  assert.equal(relationItems(relations.data).length, 0, `${object.equipmentKey} 已有技能关系，停止候选生成`);
  assert.equal(liveSkill(live, skillKey).records[0]?.status, 404, `${skillKey} 已存在，停止候选生成`);

  return {
    equipmentKey: object.equipmentKey,
    equipmentName: object.name,
    skillKey,
    source: {
      path: object.path,
      bindings: object.bound,
      official: object.official,
      sourceFiles: source.sources
    },
    apiPayload: {
      skill: {
        skillKey,
        name: `${object.name}·${title}`,
        description,
        maxLevel: 1,
        status: 'ENABLED',
        sortOrder: kind === 'passive' ? 0 : 10,
        skillCategoryKeys: kind === 'passive' ? ['passive'] : []
      },
      parameters: [],
      formulas: [],
      effects: [],
      processes: [],
      internalStates: [],
      triggerRules: [],
      relation: { equipmentKey: object.equipmentKey, skillKey, sortOrder: kind === 'passive' ? 10 : 20 },
      representativeImage: { imageKey: image.data.image.imageKey }
    },
    disposition: { 范围外: [], 来源待核: [], 系统缺口: [], 尚未接线: [] },
    omittedComponents: [],
    pendingComponents: [],
    proofs: [],
    safeguards: {
      equipment: equipment.data,
      attributes: attributes.data,
      representativeImage: image.data,
      relations: relations.data
    }
  };
}

export function param(object, parameterKey, name, value, description, options = {}) {
  const valueMode = options.valueMode ?? 'FIXED';
  const valueType = options.valueType ?? (Number.isInteger(value) ? 'INTEGER' : 'DECIMAL');
  assert.ok(valueMode !== 'FIXED' || Number.isFinite(value), `${object.skillKey}/${parameterKey} 固定值必须为数值`);
  object.apiPayload.parameters.push({
    parameterKey,
    name,
    valueType,
    valueMode,
    fixedValue: valueMode === 'FIXED' ? value : null,
    levelValues: valueMode === 'CHARACTER_LEVEL' ? options.levelValues : null,
    description,
    sortOrder: (object.apiPayload.parameters.length + 1) * 10
  });
}

export function runtime(object, parameterKey, name, description) {
  param(object, parameterKey, name, null, description, { valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL' });
}

export function characterLevel(object, parameterKey, name, levelValues, description) {
  assert.equal(Object.keys(levelValues).length, 18, `${object.skillKey}/${parameterKey} 必须提供1至18级`);
  param(object, parameterKey, name, null, description, {
    valueMode: 'CHARACTER_LEVEL', valueType: 'INTEGER', levelValues
  });
}

export function formula(object, formulaKey, name, description, expression) {
  object.apiPayload.formulas.push({
    formulaKey,
    name,
    description,
    expression,
    sortOrder: (object.apiPayload.formulas.length + 1) * 10
  });
}

export function note(object, kind, component, reason) {
  assert.ok(Object.hasOwn(object.disposition, kind), `未知处置分类 ${kind}`);
  object.disposition[kind].push({ component, reason });
}

export function omitted(object, kind, key, reason) {
  object.omittedComponents.push({ kind, key, reason });
}

export function pending(object, component, reason) {
  object.pendingComponents.push({ component, reason });
}

export function proof(object, pointer, accepted, raw) {
  object.proofs.push({ pointer, accepted, raw });
}

function countTotals(objects) {
  const componentKinds = ['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'];
  const totals = {
    equipment: new Set(objects.map(object => object.equipmentKey)).size,
    skills: objects.length
  };
  for (const kind of componentKinds) totals[kind] = objects.reduce((sum, object) => sum + object.apiPayload[kind].length, 0);
  totals.relations = objects.length;
  totals.representativeImages = objects.length;
  totals.components = Object.entries(totals).filter(([key]) => !['equipment', 'components'].includes(key)).reduce((sum, [, value]) => sum + value, 0);
  totals.omittedComponents = objects.reduce((sum, object) => sum + object.omittedComponents.length, 0);
  totals.pendingComponents = objects.reduce((sum, object) => sum + object.pendingComponents.length, 0);
  return totals;
}

function currentStatus(live, route) {
  const entry = record(live, route);
  return { status: entry.status, ok: entry.status >= 200 && entry.status < 300 };
}

export async function writeReadOnlyPlan(objects) {
  const requests = [
    { method: 'GET', route: '/attributes?page=1&pageSize=200', purpose: '确认公式结果引用的属性目录完整' },
    { method: 'GET', route: '/modifier-zones?page=1&pageSize=200', purpose: '确认公式结果引用的修改区域目录完整' },
    { method: 'GET', route: '/skill-categories?page=1&pageSize=200', purpose: '确认技能分类目录完整' },
    { method: 'GET', route: '/skills?page=1&pageSize=200', purpose: '读取技能目录第一页并按total继续分页，不能写死935' }
  ];
  for (const object of objects) {
    const live = beforeByKey.get(object.equipmentKey);
    const equipmentRoutes = [
      `/equipment/${object.equipmentKey}`,
      `/equipment/${object.equipmentKey}/attributes`,
      `/equipment/${object.equipmentKey}/representative-image`,
      `/equipment-skill-relations?equipmentKey=${object.equipmentKey}`
    ];
    for (const route of equipmentRoutes) requests.push({
      method: 'GET', route, purpose: '保护原装备、属性、图片与已有关系', current: currentStatus(live, route)
    });
    const skillRoute = `/skills/${object.skillKey}`;
    requests.push({
      method: 'GET', route: skillRoute, purpose: '确认技能主体缺项或完整同值', expectedBeforeStatus: 404,
      current: { status: liveSkill(live, object.skillKey).records[0]?.status }
    });
    for (const [kind, idField, apiRoute] of [
      ['parameters', 'parameterKey', 'parameters'],
      ['formulas', 'formulaKey', 'formulas'],
      ['effects', 'effectKey', 'effects'],
      ['processes', 'processKey', 'processes'],
      ['internalStates', 'stateKey', 'internal-states'],
      ['triggerRules', 'ruleKey', 'trigger-rules']
    ]) {
      const listRoute = `${skillRoute}/${apiRoute}`;
      requests.push({
        method: 'GET', route: listRoute, purpose: `主体存在时完整读取${kind}列表`, conditionalOn: `${skillRoute}返回200`,
        expectedKeys: object.apiPayload[kind].map(row => row[idField])
      });
      for (const row of object.apiPayload[kind]) requests.push({
        method: 'GET', route: `${listRoute}/${row[idField]}`, purpose: `主体存在时读取${kind}详情`, conditionalOn: `${skillRoute}返回200`
      });
    }
    requests.push({
      method: 'GET', route: `${skillRoute}/representative-image`, purpose: '确认技能代表图缺项或与装备图同值', conditionalOn: `${skillRoute}返回200`,
      expectedImageKey: object.apiPayload.representativeImage.imageKey
    });
  }
  const plan = {
    generatedAt: new Date().toISOString(),
    stage: '写入前只读计划；本文件及生成过程不调用业务写接口',
    base: 'http://127.0.0.1:8080/api/admin/games/lol',
    authorizationHeader: '由获授权执行脚本在进程内提供认证头；本阶段不发请求、不落盘认证信息',
    sourceBoundary: { clientVersion: '16.17', officialVersion: '16.17.1', selectedIds },
    currentEvidence: { file: '写前现值.json', at: before.at, skillInventoryCount: before.skillInventory.length },
    safeguards: [
      '每个装备四条保护GET必须为200且归属、名称、属性、代表图与快照一致。',
      '关系列表必须完整且仍为空；发现既有关系、重复关系或批次外对象时停止该对象。',
      '每个候选技能主体当前应为404；若变为200必须逐字段比较，异值停止，不覆盖。',
      '主体404时不把下级列表404当成缺项写入依据；主体200后才读取下级列表与详情。',
      '任何超时、503或响应中断后先重新GET现值，禁止盲目重放。',
      '代表图只允许复用装备现有imageKey，同键跳过，异键停止，不上传新图。'
    ],
    noWrite: true,
    requests
  };
  await writeJson('写前只读计划.json', plan);
  return plan;
}

export async function output(objects) {
  assert.deepEqual([...new Set(objects.map(object => object.equipmentKey))].sort(), selectedIds.map(id => `item_${id}`).sort(), '候选装备范围不完整');
  const totals = countTotals(objects);
  const payload = {
    generatedAt: new Date().toISOString(),
    stage: '仅候选，未调用业务写接口',
    clientVersion: '16.17',
    officialVersion: '16.17.1',
    boundary: '只沿冻结来源中当前Items编号对象的绑定说明、直接模板引用和明确计算节点保存可证明组成；不以缺失值补零，不凭名称相似对象补规则。',
    objects,
    totals,
    entryBoundary: '候选生成只读取冻结来源.json与写前现值.json并写本目录文件；不含POST、PUT、DELETE或浏览器操作。',
    configurationBoundary: '参数和显式输入公式不等于合法事件、目标筛选、冷却消费、持续伤害节拍、护盾资格或战斗运行时已接线。',
    sourceEvidence: {
      frozenSourceFile: '冻结来源.json',
      beforeFile: '写前现值.json',
      frozenGeneratedAt: source.generatedAt,
      beforeAt: before.at,
      sourceRecords: source.sources
    }
  };
  const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await writeFile(path.join(here, '完整候选.json'), bytes);
  await writeJson('完整版本.json', {
    generatedAt: payload.generatedAt,
    file: '完整候选.json',
    sha256: sha256(bytes),
    totals,
    sourceBoundary: { clientVersion: '16.17', officialVersion: '16.17.1' }
  });
  const lines = [
    '# 第十五批伤害装备候选审查',
    '',
    `本候选包含 ${totals.equipment} 件装备、${totals.skills} 个技能槽、${totals.parameters} 个参数和 ${totals.formulas} 个公式；效果、过程、内部状态和触发规则均为0。共 ${totals.components} 项关系与组成，未调用业务写接口。`,
    '',
    '原装备直接属性、已有代表图和关系为空的现值仅作为保护证据；候选关联复用现有装备代表图，不重复施加直接属性，不创建新图片。',
    '',
    'mStat缺失的客户端计算只保存原始系数和显式小数输入公式，输入名不写成法术强度；未知触发、节拍、护盾资格、冷却消费、目标筛选和动态状态均列入缺口。',
    ''
  ];
  for (const object of objects) {
    lines.push(`## ${object.apiPayload.skill.name}`, '', object.apiPayload.skill.description, '');
    for (const [kind, rows] of Object.entries(object.disposition)) {
      lines.push(`**${kind}**：${rows.length ? rows.map(row => `${row.component}：${row.reason}`).join('；') : '当前没有新增记录。'}`, '');
    }
    if (object.omittedComponents.length) lines.push('**候选省略项**：', '', ...object.omittedComponents.map(row => `- ${row.kind}/${row.key}：${row.reason}`), '');
    if (object.pendingComponents.length) lines.push('**后续待配项**：', '', ...object.pendingComponents.map(row => `- ${row.component}：${row.reason}`), '');
  }
  await writeFile(path.join(here, '完整审查说明.md'), `${lines.join('\n')}\n`, 'utf8');
  await writeReadOnlyPlan(objects);
  return payload;
}
