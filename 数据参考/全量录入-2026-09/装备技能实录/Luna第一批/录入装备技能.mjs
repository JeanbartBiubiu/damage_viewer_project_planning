import { writeFile } from 'node:fs/promises';

const apiBaseUrl = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = 'local-entry';

const objects = [
  {
    equipmentKey: 'item_3091',
    equipmentName: '智慧末刃',
    skill: {
      skillKey: 'item_3091_passive',
      name: '智慧末刃·喧争',
      description: '普通攻击命中时造成45点额外魔法伤害，属于攻击特效。本次录入接入普通攻击命中事件；技能触发攻击特效的完整范围仍待运行时事件核对。',
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['passive']
    },
    parameters: [
      {
        parameterKey: 'on_hit_damage',
        name: '喧争额外伤害',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 45,
        levelValues: null,
        description: '固定额外魔法伤害，单位：伤害点。',
        sortOrder: 10
      }
    ],
    formulas: [],
    expectedMissingFormulaKeys: ['on_hit_damage'],
    effects: [
      {
        effectKey: 'on_hit_damage',
        name: '喧争攻击特效',
        description: '普通攻击命中时结算45点额外魔法伤害；触发范围按普通攻击命中事件保存。',
        sortOrder: 10,
        lifecycle: null,
        results: [
          {
            resultKey: 'magic_damage',
            name: '额外魔法伤害',
            resultType: 'DAMAGE',
            target: 'TARGET',
            description: '固定45点魔法伤害，属于攻击特效。',
            sortOrder: 10,
            lifecycleBehavior: null,
            spellShieldBlockScope: null,
            valueRule: {
              value: { kind: 'PARAMETER', parameterKey: 'on_hit_damage' },
              fixedMultiplier: 1,
              fixedMinValue: 0,
              fixedMaxValue: null
            },
            detail: {
              damageTypeKey: 'magic',
              deliveryKind: 'BASIC_ATTACK',
              originKind: 'DIRECT',
              critical: { mode: 'DISALLOWED', multiplierValue: null },
              vampRules: []
            }
          }
        ]
      }
    ],
    triggerRules: [
      {
        ruleKey: 'resolve_on_basic_attack_hit',
        name: '普通攻击命中结算喧争',
        description: '监听普通攻击命中并执行喧争额外魔法伤害。技能触发攻击特效的事件范围未在本次录入中扩大。',
        sortOrder: 10,
        eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} },
        conditionGroups: [],
        actions: [
          {
            actionKey: 'execute_on_hit_damage',
            name: '执行喧争额外伤害',
            actionType: 'EXECUTE_EFFECT',
            sortOrder: 10,
            targetContext: 'CURRENT_TARGET',
            detail: { effectKey: 'on_hit_damage' },
            runtimeInputBindings: [],
            resultModifiers: []
          }
        ],
        perTargetCooldown: null,
        maxTriggersPerProcess: null
      }
    ],
    relation: { equipmentKey: 'item_3091', skillKey: 'item_3091_passive', sortOrder: 10 }
  },
  {
    equipmentKey: 'item_3115',
    equipmentName: '纳什之牙',
    skill: {
      skillKey: 'item_3115_passive',
      name: '纳什之牙·艾卡西亚之咬',
      description: '普通攻击命中时造成15点加15%法术强度的额外魔法伤害，属于攻击特效。本次录入接入普通攻击命中事件；技能触发攻击特效的完整范围仍待运行时事件核对。',
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['passive']
    },
    parameters: [
      {
        parameterKey: 'base_damage',
        name: '基础额外伤害',
        valueType: 'INTEGER',
        valueMode: 'FIXED',
        fixedValue: 15,
        levelValues: null,
        description: '固定基础额外魔法伤害，单位：伤害点。',
        sortOrder: 10
      },
      {
        parameterKey: 'ap_ratio',
        name: '法术强度倍率',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 0.15,
        levelValues: null,
        description: '法术强度倍率，小数1表示100%。',
        sortOrder: 20
      }
    ],
    formulas: [
      {
        formulaKey: 'on_hit_damage',
        name: '艾卡西亚之咬额外魔法伤害',
        description: '15点基础伤害加15%法术强度。',
        sortOrder: 10,
        expression: {
          nodeType: 'OPERATION',
          operation: 'ADD',
          operands: [
            { nodeType: 'PARAMETER', parameterKey: 'base_damage' },
            {
              nodeType: 'OPERATION',
              operation: 'MULTIPLY',
              operands: [
                { nodeType: 'PARAMETER', parameterKey: 'ap_ratio' },
                { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'ability_power', attributeValueKind: 'TOTAL' }
              ]
            }
          ]
        }
      }
    ],
    effects: [
      {
        effectKey: 'on_hit_damage',
        name: '艾卡西亚之咬攻击特效',
        description: '普通攻击命中时结算15点加15%法术强度的额外魔法伤害；触发范围按普通攻击命中事件保存。',
        sortOrder: 10,
        lifecycle: null,
        results: [
          {
            resultKey: 'magic_damage',
            name: '额外魔法伤害',
            resultType: 'DAMAGE',
            target: 'TARGET',
            description: '15点基础伤害加15%法术强度，属于攻击特效。',
            sortOrder: 10,
            lifecycleBehavior: null,
            spellShieldBlockScope: null,
            valueRule: {
              value: { kind: 'FORMULA', formulaKey: 'on_hit_damage' },
              fixedMultiplier: 1,
              fixedMinValue: 0,
              fixedMaxValue: null
            },
            detail: {
              damageTypeKey: 'magic',
              deliveryKind: 'BASIC_ATTACK',
              originKind: 'DIRECT',
              critical: { mode: 'DISALLOWED', multiplierValue: null },
              vampRules: []
            }
          }
        ]
      }
    ],
    triggerRules: [
      {
        ruleKey: 'resolve_on_basic_attack_hit',
        name: '普通攻击命中结算艾卡西亚之咬',
        description: '监听普通攻击命中并执行艾卡西亚之咬额外魔法伤害。技能触发攻击特效的事件范围未在本次录入中扩大。',
        sortOrder: 10,
        eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} },
        conditionGroups: [],
        actions: [
          {
            actionKey: 'execute_on_hit_damage',
            name: '执行艾卡西亚之咬额外伤害',
            actionType: 'EXECUTE_EFFECT',
            sortOrder: 10,
            targetContext: 'CURRENT_TARGET',
            detail: { effectKey: 'on_hit_damage' },
            runtimeInputBindings: [],
            resultModifiers: []
          }
        ],
        perTargetCooldown: null,
        maxTriggersPerProcess: null
      }
    ],
    relation: { equipmentKey: 'item_3115', skillKey: 'item_3115_passive', sortOrder: 10 }
  }
];

async function request(method, path, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: response.status, data };
}

function mustOk(result, label) {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${label} failed: HTTP ${result.status} ${JSON.stringify(result.data)}`);
  }
  return result;
}

function mustNotFound(result, label) {
  if (result.status !== 404) {
    throw new Error(`${label} expected HTTP 404, got ${result.status}: ${JSON.stringify(result.data)}`);
  }
  return result;
}

async function readback(path, label) {
  return mustOk(await request('GET', path), `${label} readback`);
}

async function runObject(object) {
  const evidence = {
    equipmentKey: object.equipmentKey,
    equipmentName: object.equipmentName,
    skillKey: object.skill.skillKey,
    preflight: {},
    writes: [],
    relation: {}
  };
  const skillPath = `/skills/${encodeURIComponent(object.skill.skillKey)}`;
  const relationListPath = `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`;

  evidence.preflight.skill = mustNotFound(await request('GET', skillPath), 'skill occupancy');
  evidence.preflight.relations = mustOk(await request('GET', relationListPath), 'relation occupancy');
  if (evidence.preflight.relations.data.items.some(item => item.skillKey === object.skill.skillKey)) {
    throw new Error(`${object.skill.skillKey} already mounted on ${object.equipmentKey}`);
  }

  const writeAndRead = async (kind, method, path, body, readPath = path) => {
    const write = mustOk(await request(method, path, body), `${kind} write`);
    const read = await readback(readPath, kind);
    evidence.writes.push({ kind, path, body, response: write.data, readback: read.data });
  };

  await writeAndRead('skill', 'POST', '/skills', object.skill, skillPath);
  for (const parameter of object.parameters) {
    const path = `${skillPath}/parameters`;
    const readPath = `${path}/${encodeURIComponent(parameter.parameterKey)}`;
    await writeAndRead(`parameter:${parameter.parameterKey}`, 'POST', path, parameter, readPath);
  }
  for (const formula of object.formulas) {
    const path = `${skillPath}/formulas`;
    const readPath = `${path}/${encodeURIComponent(formula.formulaKey)}`;
    await writeAndRead(`formula:${formula.formulaKey}`, 'POST', path, formula, readPath);
  }
  for (const effect of object.effects) {
    const path = `${skillPath}/effects`;
    const readPath = `${path}/${encodeURIComponent(effect.effectKey)}`;
    await writeAndRead(`effect:${effect.effectKey}`, 'POST', path, effect, readPath);
  }
  for (const rule of object.triggerRules) {
    const path = `${skillPath}/trigger-rules`;
    const readPath = `${path}/${encodeURIComponent(rule.ruleKey)}`;
    await writeAndRead(`trigger-rule:${rule.ruleKey}`, 'POST', path, rule, readPath);
  }

  evidence.relation.preflight = mustOk(await request('GET', relationListPath), 'relation preflight before mount');
  const relationWrite = mustOk(await request('POST', '/equipment-skill-relations', object.relation), 'relation write');
  const relationListRead = mustOk(await request('GET', relationListPath), 'relation list readback');
  evidence.relation.write = { path: '/equipment-skill-relations', body: object.relation, response: relationWrite.data };
  evidence.relation.listReadback = relationListRead.data;
  return evidence;
}

function compareFields(expected, actual, path = '', rows = []) {
  if (expected === null || typeof expected !== 'object') {
    rows.push({ path, expected, actual, equal: Object.is(expected, actual) });
    return rows;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      rows.push({ path, expected, actual, equal: false });
      return rows;
    }
    rows.push({ path: `${path}[]`, expectedCount: expected.length, actualCount: actual.length, equal: expected.length === actual.length });
    expected.forEach((value, index) => compareFields(value, actual[index], `${path}[${index}]`, rows));
    return rows;
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    rows.push({ path, expected, actual, equal: false });
    return rows;
  }
  for (const [key, value] of Object.entries(expected)) {
    compareFields(value, actual[key], path ? `${path}.${key}` : key, rows);
  }
  return rows;
}

async function readExistingObject(object) {
  const skillPath = `/skills/${encodeURIComponent(object.skill.skillKey)}`;
  const relationListPath = `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`;
  const preflightSkill = mustOk(await request('GET', skillPath), 'skill existence readback');
  const relationList = mustOk(await request('GET', relationListPath), 'relation existence readback');
  const formulaList = mustOk(await request('GET', `${skillPath}/formulas`), 'formula list existence readback');
  const formulaRows = Array.isArray(formulaList.data)
    ? formulaList.data
    : (Array.isArray(formulaList.data?.items) ? formulaList.data.items : []);
  const expectedFormulaKeys = object.formulas.map(formula => formula.formulaKey).sort();
  const actualFormulaKeys = formulaRows.map(formula => formula.formulaKey).sort();
  const formulaListEqual = JSON.stringify(expectedFormulaKeys) === JSON.stringify(actualFormulaKeys);
  if (!formulaListEqual) {
    throw new Error(`${object.skill.skillKey} formula list mismatch: expected ${JSON.stringify(expectedFormulaKeys)}, got ${JSON.stringify(actualFormulaKeys)}`);
  }
  const missingFormulaChecks = [];
  for (const formulaKey of object.expectedMissingFormulaKeys ?? []) {
    const response = await request('GET', `${skillPath}/formulas/${encodeURIComponent(formulaKey)}`);
    const equal = response.status === 404;
    missingFormulaChecks.push({ formulaKey, path: `${skillPath}/formulas/${encodeURIComponent(formulaKey)}`, expectedStatus: 404, actualStatus: response.status, equal });
    if (!equal) throw new Error(`${object.skill.skillKey} deleted formula ${formulaKey} returned HTTP ${response.status}`);
  }
  const components = [];
  const capture = async (kind, path, expected) => {
    const response = mustOk(await request('GET', path), `${kind} independent readback`);
    components.push({ kind, path, expected, readback: response.data, fields: compareFields(expected, response.data) });
  };

  await capture('skill', skillPath, object.skill);
  for (const parameter of object.parameters) {
    await capture(`parameter:${parameter.parameterKey}`, `${skillPath}/parameters/${encodeURIComponent(parameter.parameterKey)}`, parameter);
  }
  for (const formula of object.formulas) {
    await capture(`formula:${formula.formulaKey}`, `${skillPath}/formulas/${encodeURIComponent(formula.formulaKey)}`, formula);
  }
  for (const effect of object.effects) {
    await capture(`effect:${effect.effectKey}`, `${skillPath}/effects/${encodeURIComponent(effect.effectKey)}`, effect);
  }
  for (const rule of object.triggerRules) {
    await capture(`trigger-rule:${rule.ruleKey}`, `${skillPath}/trigger-rules/${encodeURIComponent(rule.ruleKey)}`, rule);
  }

  const relation = relationList.data.items.find(item => item.skillKey === object.skill.skillKey);
  if (!relation) throw new Error(`${object.skill.skillKey} relation missing in list readback`);
  components.push({
    kind: 'equipment-skill-relation',
    path: relationListPath,
    expected: object.relation,
    readback: relation,
    fields: compareFields(object.relation, relation)
  });
  return {
    equipmentKey: object.equipmentKey,
    equipmentName: object.equipmentName,
    skillKey: object.skill.skillKey,
    preflight: { skill: preflightSkill.data, relations: relationList.data },
    formulaChecks: {
      expectedFormulaKeys,
      actualFormulaKeys,
      formulaListEqual,
      missingFormulaChecks
    },
    components
  };
}

function resultEnvelope() {
  return {
  generatedAt: new Date().toISOString(),
  apiBaseUrl,
  gameId: 'lol',
  source: {
    version: '16.17.1',
    clientDirectoryVersion: '16.17',
    note: '仅保存静态来源已证明的攻击特效组成；不把配置保存回读称为运行时验证。'
  },
  objects: []
  };
}

const result = resultEnvelope();
if (!process.argv.includes('--apply')) {
  result.mode = '逐字段独立回读';
  for (const object of objects) result.objects.push(await readExistingObject(object));
  result.summary = {
    objectCount: result.objects.length,
    componentCount: result.objects.reduce((sum, object) => sum + object.components.length, 0),
    fieldCount: result.objects.reduce((sum, object) => sum + object.components.reduce((inner, component) => inner + component.fields.length, 0), 0),
    mismatchCount: result.objects.reduce((sum, object) => sum + object.components.reduce((inner, component) => inner + component.fields.filter(field => !field.equal).length, 0), 0)
  };
  const evidencePath = new URL('./逐字段回读证据.json', import.meta.url);
  await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ mode: result.mode, summary: result.summary, evidencePath: evidencePath.pathname }, null, 2));
} else {
  for (const object of objects) result.objects.push(await runObject(object));
  console.log(JSON.stringify(result, null, 2));
}
