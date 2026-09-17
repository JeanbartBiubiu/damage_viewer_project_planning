import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token) throw new Error('缺少 DAMAGE_ENTRY_TOKEN');

const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const skillKeys = ['item_2422_passive', 'item_3742_passive', 'item_3042_passive', 'item_3040_passive'];
const equipmentKeys = skillKeys.map(key => key.replace('_passive', ''));
let getCount = 0;

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
};
const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaValue = value => shaBytes(JSON.stringify(stable(value)));

async function get(route, expectedStatus = 200) {
  getCount += 1;
  const response = await fetch(base + route, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let data = null;
  if (text) data = JSON.parse(text);
  assert.equal(response.status, expectedStatus, route);
  return { method: 'GET', route, status: response.status, data };
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

const withoutServerFields = object => {
  const result = structuredClone(object);
  for (const key of ['createdAt', 'updatedAt', 'gameId', 'skillKey', 'equipmentKey']) delete result[key];
  return result;
};

const rule = ({ ruleKey, name, description, effectKey, actionName }) => ({
  ruleKey,
  name,
  description,
  sortOrder: 10,
  eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} },
  conditionGroups: [],
  actions: [{
    actionKey: `execute_${effectKey}`,
    name: actionName,
    actionType: 'EXECUTE_EFFECT',
    sortOrder: 10,
    targetContext: 'EVENT_SOURCE',
    detail: { effectKey },
    runtimeInputBindings: [],
    resultModifiers: []
  }],
  perTargetCooldown: null,
  maxTriggersPerProcess: null
});

const sourcePaths = [
  'C:/project/damage_web_dev/数据参考/lol-wiki-current-items/current-items.normalized.json',
  'C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/装备技能实录/第十六批成长与触发装备/冻结来源.json',
  'C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/API实录/符文生成装备第一批/候选与来源.json'
];
const expectedSourceHashes = [
  '17769e0891a0cfc3873abe3d74f1806e8b7a1bc5b21258308c0612121f4b56f4',
  '5a1ac9819cf064de2b6f743dfd0f3a512857224650746e423fdf9ebeed343cc2',
  'd8f769c5c407406bd38d1154115334403e92141001b5c5a39e2b049c45e3f92f'
];
const sources = sourcePaths.map((sourcePath, index) => {
  const sha256 = shaBytes(fs.readFileSync(sourcePath));
  assert.equal(sha256, expectedSourceHashes[index], `来源散列漂移：${sourcePath}`);
  return { path: sourcePath, sha256 };
});

const staticRequests = [];
const remember = async (route, expectedStatus = 200) => {
  const response = await get(route, expectedStatus);
  staticRequests.push(response);
  return response.data;
};

for (const route of [
  '/attributes/move_speed',
  '/attributes/slow_resist_percent',
  '/attributes/attack_damage',
  '/attributes/ability_power',
  '/attributes/mana',
  '/modifier-zones/attribute_flat_add'
]) await remember(route);

for (const equipmentKey of equipmentKeys) {
  await remember(`/equipment/${equipmentKey}`);
  await remember(`/equipment/${equipmentKey}/attributes`);
  await remember(`/equipment-skill-relations?equipmentKey=${equipmentKey}`);
}

const listKinds = ['parameters', 'formulas', 'effects', 'processes', 'internal-states', 'trigger-rules'];
const detailKey = {
  parameters: 'parameterKey',
  formulas: 'formulaKey',
  effects: 'effectKey',
  processes: 'processKey',
  'internal-states': 'stateKey',
  'trigger-rules': 'ruleKey'
};
const current = {};
for (const skillKey of [...skillKeys, 'item_3003_passive']) {
  current[skillKey] = { skill: await remember(`/skills/${skillKey}`), lists: {}, details: {} };
  await remember(`/skills/${skillKey}/representative-image`);
  for (const kind of listKinds) {
    const list = await remember(`/skills/${skillKey}/${kind}`);
    current[skillKey].lists[kind] = list;
    current[skillKey].details[kind] = {};
    for (const entry of list) {
      const key = entry[detailKey[kind]];
      current[skillKey].details[kind][key] = await remember(`/skills/${skillKey}/${kind}/${encodeURIComponent(key)}`);
    }
  }
}

const candidateRoutes = [
  '/skills/item_2422_passive/trigger-rules/initialize_magical_footwear_additional_speed',
  '/skills/item_3742_passive/trigger-rules/initialize_unsinkable_slow_resist',
  '/skills/item_3042_passive/trigger-rules/initialize_bonus_attack_damage_from_max_mana',
  '/skills/item_3040_passive/parameters/ap_from_bonus_mana_ratio',
  '/skills/item_3040_passive/formulas/ap_from_bonus_mana',
  '/skills/item_3040_passive/effects/ap_from_bonus_mana',
  '/skills/item_3040_passive/trigger-rules/initialize_ap_from_bonus_mana'
];
for (const route of candidateRoutes) await remember(route, 404);

const skillsResponse = await get('/skills');
assert(Array.isArray(skillsResponse.data?.items));
assert.equal(skillsResponse.data.items.length, skillsResponse.data.total);
const allSkillKeys = skillsResponse.data.items.map(item => item.skillKey).sort();
assert.equal(allSkillKeys.length, 1062, '技能总数漂移');
const ruleLists = await mapLimit(allSkillKeys, 24, async skillKey => {
  const response = await get(`/skills/${encodeURIComponent(skillKey)}/trigger-rules`);
  assert(Array.isArray(response.data));
  return { skillKey, rules: response.data };
});
const summaries = ruleLists.flatMap(item => item.rules.map(entry => ({ skillKey: item.skillKey, ruleKey: entry.ruleKey })));
const ruleDetails = await mapLimit(summaries, 24, async item => {
  const response = await get(`/skills/${encodeURIComponent(item.skillKey)}/trigger-rules/${encodeURIComponent(item.ruleKey)}`);
  return { ...item, data: response.data };
});
ruleDetails.sort((left, right) => left.skillKey.localeCompare(right.skillKey) || left.ruleKey.localeCompare(right.ruleKey));
assert.equal(ruleDetails.length, 90, '触发规则总数漂移');

const effect2422 = withoutServerFields(current.item_2422_passive.details.effects.magical_footwear_additional_speed);
effect2422.description = '持有者初始化时建立单层常驻10点固定移动速度；装备主体25点移动速度不重复施加，外部显式移除。';
effect2422.results[0].description = '固定增加10点移动速度；不重复装备主体的25点直接移动速度。';

const effect3742 = withoutServerFields(current.item_3742_passive.details.effects.unsinkable_slow_resist);
effect3742.description = '持有者初始化时建立单层常驻15%减速抗性；装备主体没有该直接属性，外部显式移除。';

const effect3042 = withoutServerFields(current.item_3042_passive.details.effects.bonus_attack_damage_from_max_mana);
effect3042.description = '来源初始化时建立按当前最大法力值动态读取的额外攻击力；外部显式移除。';
effect3042.results[0].description = '按当前总最大法力值动态读取额外攻击力；不重复装备主体的35点直接攻击力。';

const writes = [
  {
    method: 'PUT',
    route: '/skills/item_2422_passive',
    body: {
      name: '有点神奇之鞋·额外移速',
      description: '保存并初始化有点神奇之鞋额外10点固定移动速度；装备主体的25点移动速度保持为直接属性，不重复施加。通过其合成的鞋类继承仍待升级流程验证；管理配置已接线，战斗运行时未验证。',
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['passive']
    }
  },
  {
    method: 'PUT',
    route: '/skills/item_2422_passive/effects/magical_footwear_additional_speed',
    body: effect2422
  },
  {
    method: 'POST',
    route: '/skills/item_2422_passive/trigger-rules',
    detailRoute: '/skills/item_2422_passive/trigger-rules/initialize_magical_footwear_additional_speed',
    body: rule({
      ruleKey: 'initialize_magical_footwear_additional_speed',
      name: '初始化有点神奇之鞋额外移速',
      description: '装备生效时建立额外10点固定移动速度；装备主体25点直接属性不在本规则重复执行。',
      effectKey: 'magical_footwear_additional_speed',
      actionName: '执行有点神奇之鞋额外移速'
    })
  },
  {
    method: 'PUT',
    route: '/skills/item_3742_passive',
    body: {
      name: '亡者的板甲·沉船者',
      description: '保存移动积攒上限、下一次攻击的最大额外物理伤害、达到满层时间和自身减速抗性；15%减速抗性在来源初始化时建立。最大攻击公式使用基础攻击力窄映射；移动过程和中间层数不按端点猜曲线。管理配置已接线，战斗运行时未验证。',
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['passive']
    }
  },
  {
    method: 'PUT',
    route: '/skills/item_3742_passive/effects/unsinkable_slow_resist',
    body: effect3742
  },
  {
    method: 'POST',
    route: '/skills/item_3742_passive/trigger-rules',
    detailRoute: '/skills/item_3742_passive/trigger-rules/initialize_unsinkable_slow_resist',
    body: rule({
      ruleKey: 'initialize_unsinkable_slow_resist',
      name: '初始化不沉减速抗性',
      description: '装备生效时建立15%减速抗性；装备主体没有减速抗性直接属性。',
      effectKey: 'unsinkable_slow_resist',
      actionName: '执行不沉减速抗性'
    })
  },
  {
    method: 'PUT',
    route: '/skills/item_3042_passive',
    body: {
      name: '魔切·敬畏与冲击',
      description: '保存并初始化2%最大法力值转额外攻击力；另保存1.2%最大法力值攻击特效伤害、伤害型技能远程3%与近战4%最大法力值伤害，以及客户端远程施法分支1/2。所有法力公式使用来源总法力值；冲击的攻击或技能伤害事件仍未接线。管理配置已接线，战斗运行时未验证。',
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['passive']
    }
  },
  {
    method: 'PUT',
    route: '/skills/item_3042_passive/effects/bonus_attack_damage_from_max_mana',
    body: effect3042
  },
  {
    method: 'POST',
    route: '/skills/item_3042_passive/trigger-rules',
    detailRoute: '/skills/item_3042_passive/trigger-rules/initialize_bonus_attack_damage_from_max_mana',
    body: rule({
      ruleKey: 'initialize_bonus_attack_damage_from_max_mana',
      name: '初始化敬畏最大法力转攻击力',
      description: '装备生效时建立按当前最大法力值动态读取的额外攻击力效果；冲击伤害不在本规则执行。',
      effectKey: 'bonus_attack_damage_from_max_mana',
      actionName: '执行敬畏额外攻击力'
    })
  },
  {
    method: 'POST',
    route: '/skills/item_3040_passive/parameters',
    detailRoute: '/skills/item_3040_passive/parameters/ap_from_bonus_mana_ratio',
    body: {
      parameterKey: 'ap_from_bonus_mana_ratio',
      name: '敬畏额外法力转法术强度比例',
      valueType: 'DECIMAL',
      valueMode: 'FIXED',
      fixedValue: 0.02,
      levelValues: null,
      description: '每1点额外法力提供0.02点法术强度，小数0.02表示2%。',
      sortOrder: 10
    }
  },
  {
    method: 'POST',
    route: '/skills/item_3040_passive/formulas',
    detailRoute: '/skills/item_3040_passive/formulas/ap_from_bonus_mana',
    body: {
      formulaKey: 'ap_from_bonus_mana',
      name: '额外法力转法术强度',
      description: '按来源对象当前额外法力值乘以2%敬畏比例计算法术强度。',
      sortOrder: 10,
      expression: {
        nodeType: 'OPERATION',
        operands: [
          { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'mana', attributeValueKind: 'BONUS' },
          { nodeType: 'PARAMETER', parameterKey: 'ap_from_bonus_mana_ratio' }
        ],
        operation: 'MULTIPLY'
      }
    }
  },
  {
    method: 'POST',
    route: '/skills/item_3040_passive/effects',
    detailRoute: '/skills/item_3040_passive/effects/ap_from_bonus_mana',
    body: {
      effectKey: 'ap_from_bonus_mana',
      name: '敬畏额外法力转法术强度',
      description: '来源初始化时建立按当前额外法力值动态读取的2%法术强度；外部显式移除。',
      sortOrder: 20,
      lifecycle: {
        applicationStacksValue: { kind: 'FIXED', value: 1 },
        durationValue: null,
        expiryMode: 'EXPLICIT_ONLY',
        firstPeriodicExecution: null,
        instanceScope: 'SOURCE',
        maxStacksValue: { kind: 'FIXED', value: 1 },
        periodicIntervalValue: null,
        reapplicationDurationMode: null,
        reapplicationStackMode: 'KEEP'
      },
      results: [{
        resultKey: 'ap_from_bonus_mana',
        name: '额外法力提供的法术强度',
        target: 'SOURCE',
        resultType: 'ATTRIBUTE_CHANGE',
        description: '每1点额外法力提供0.02点法术强度；按当前时点动态读取。',
        sortOrder: 10,
        lifecycleBehavior: {
          moment: 'PERSISTENT',
          valueReadMode: 'MOMENT_EVALUATION',
          stackValueMode: 'SHARED',
          reapplicationValueMode: null,
          periodicExecutionMode: null
        },
        spellShieldBlockScope: null,
        valueRule: {
          value: { kind: 'FORMULA', formulaKey: 'ap_from_bonus_mana' },
          fixedMultiplier: 1,
          fixedMinValue: 0,
          fixedMaxValue: null
        },
        detail: {
          attributeKey: 'ability_power',
          operation: 'INCREASE',
          modifierZoneKey: 'attribute_flat_add'
        }
      }]
    }
  },
  {
    method: 'POST',
    route: '/skills/item_3040_passive/trigger-rules',
    detailRoute: '/skills/item_3040_passive/trigger-rules/initialize_ap_from_bonus_mana',
    body: rule({
      ruleKey: 'initialize_ap_from_bonus_mana',
      name: '初始化敬畏额外法力转法术强度',
      description: '装备生效时建立按当前额外法力值动态读取的敬畏属性效果；救主灵刃保持由伤前阈值规则独立触发。',
      effectKey: 'ap_from_bonus_mana',
      actionName: '执行敬畏法术强度'
    })
  },
  {
    method: 'PUT',
    route: '/skills/item_3040_passive',
    body: {
      name: '炽天使之拥·敬畏与救主灵刃',
      description: '敬畏按当前额外法力值的2%动态提供法术强度，并在来源初始化时建立常驻效果。救主灵刃在待处理伤害使持有者生命值从不低于最大生命值30%降到低于30%时，先获得最大法力值18%的3秒普通护盾；同一持有者冷却90秒。管理配置已接线，战斗运行时未验证。',
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['passive']
    }
  },
  {
    method: 'DELETE',
    route: '/skills/item_3040_passive/formulas/bonus_ap_from_max_mana',
    expectedBeforeSha256: shaValue(current.item_3040_passive.details.formulas.bonus_ap_from_max_mana)
  },
  {
    method: 'DELETE',
    route: '/skills/item_3040_passive/parameters/bonus_ap_from_max_mana_ratio',
    expectedBeforeSha256: shaValue(current.item_3040_passive.details.parameters.bonus_ap_from_max_mana_ratio)
  }
];

assert.equal(writes.length, 16);
assert.equal(writes.filter(item => item.method === 'POST').length, 7);
assert.equal(writes.filter(item => item.method === 'PUT').length, 7);
assert.equal(writes.filter(item => item.method === 'DELETE').length, 2);

const containsFieldValue = (value, field, expected) => {
  if (Array.isArray(value)) return value.some(item => containsFieldValue(item, field, expected));
  if (!value || typeof value !== 'object') return false;
  if (value[field] === expected) return true;
  return Object.values(value).some(item => containsFieldValue(item, field, expected));
};
const oldFormulaReferences = [];
const oldParameterReferences = [];
for (const [kind, details] of Object.entries(current.item_3040_passive.details)) {
  for (const [key, value] of Object.entries(details)) {
    if (kind !== 'formulas' || key !== 'bonus_ap_from_max_mana') {
      if (containsFieldValue(value, 'formulaKey', 'bonus_ap_from_max_mana')) oldFormulaReferences.push({ kind, key });
    }
    if (kind !== 'parameters' || key !== 'bonus_ap_from_max_mana_ratio') {
      if (containsFieldValue(value, 'parameterKey', 'bonus_ap_from_max_mana_ratio')) oldParameterReferences.push({ kind, key });
    }
  }
}
assert.deepEqual(oldFormulaReferences, []);
assert.deepEqual(oldParameterReferences, [{ kind: 'formulas', key: 'bonus_ap_from_max_mana' }]);

const frozen = {
  planRevision: 1,
  plannedWrites: writes.length,
  methodCounts: { PUT: 7, POST: 7, DELETE: 2 },
  sources,
  writes,
  replacementSafety: {
    oldFormula: 'bonus_ap_from_max_mana',
    oldFormulaIncomingReferences: oldFormulaReferences,
    oldParameter: 'bonus_ap_from_max_mana_ratio',
    oldParameterReferencesBeforeFormulaDeletion: oldParameterReferences,
    deletionOrder: ['formula', 'parameter']
  },
  excluded: [
    '四件装备主体属性、装备技能关系和图片保持不变',
    '亡者的板甲移动积攒与强化攻击不接线',
    '魔切冲击攻击和技能伤害不接线',
    '有点神奇之鞋升级继承过程不接线',
    '不修改炽天使之拥救主灵刃现有组成',
    '不声称战斗运行时、装备卸除或升级过程已经验证'
  ]
};
fs.writeFileSync(path.join(here, '02-冻结请求.json'), JSON.stringify(frozen, null, 2) + '\n', { flag: 'wx' });

const normalized = JSON.parse(fs.readFileSync(sourcePaths[0], 'utf8'));
const sourceItems = normalized.items.filter(item => [2422, 3004, 3040, 3042, 3742].includes(item.id));
assert.deepEqual(sourceItems.map(item => item.id).sort((a, b) => a - b), [2422, 3004, 3040, 3042, 3742]);
const runeGeneratedSource = JSON.parse(fs.readFileSync(sourcePaths[2], 'utf8'));
const runeEquipment = (runeGeneratedSource.candidates ?? runeGeneratedSource.items ?? [])
  .find(item => item.equipmentKey === 'item_2422');

const sourceSnapshot = {
  capturedAt: new Date().toISOString(),
  methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
  authorizationValueRecorded: false,
  sources,
  normalizedMetadata: {
    fetchedAt: normalized.fetchedAt,
    revision: normalized.revision,
    source: normalized.source
  },
  sourceItems,
  runeGeneratedItem2422: runeEquipment ?? null,
  analogousLiveShape: {
    skillKey: 'item_3003_passive',
    parameter: current.item_3003_passive.details.parameters.ap_from_bonus_mana_ratio,
    formula: current.item_3003_passive.details.formulas.ap_from_bonus_mana,
    effect: current.item_3003_passive.details.effects.ap_from_bonus_mana,
    triggerRule: current.item_3003_passive.details['trigger-rules'].initialize_ap_from_bonus_mana
  },
  acceptedFacts: {
    item_2422: { directMoveSpeed: 25, additionalMoveSpeed: 10 },
    item_3742: { directAttributesExcludeSlowResist: true, slowResist: 0.15 },
    item_3042: { directAttackDamage: 35, manaValueKind: 'TOTAL', ratio: 0.02 },
    item_3040: { directAbilityPower: 70, manaValueKind: 'BONUS', ratio: 0.02 }
  },
  replacementSafety: frozen.replacementSafety,
  excluded: frozen.excluded
};
fs.writeFileSync(path.join(here, '03-来源快照.json'), JSON.stringify(sourceSnapshot, null, 2) + '\n', { flag: 'wx' });

const baseline = {
  capturedAt: new Date().toISOString(),
  methodPolicy: 'GET_ONLY',
  authorizationValueRecorded: false,
  businessWrites: 0,
  getCount,
  staticRequests,
  triggerRuleScan: {
    skillCount: allSkillKeys.length,
    listGetCount: allSkillKeys.length,
    detailGetCount: ruleDetails.length,
    ruleCount: ruleDetails.length,
    sourceInitializedRuleCount: ruleDetails.filter(item => item.data.eventSource.eventType === 'SOURCE_INITIALIZED').length,
    sha256: shaValue(ruleDetails),
    rules: ruleDetails
  }
};
fs.writeFileSync(path.join(here, '04-写入前现值.json'), JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx' });

const hashes = Object.fromEntries(['01-来源与方案.md', '02-冻结请求.json', '03-来源快照.json', '04-写入前现值.json']
  .map(file => [file, shaBytes(fs.readFileSync(path.join(here, file)))]));
console.log(JSON.stringify({
  status: 'PASS',
  getCount,
  businessWrites: 0,
  skillCount: allSkillKeys.length,
  ruleCount: ruleDetails.length,
  sourceInitializedRuleCount: baseline.triggerRuleScan.sourceInitializedRuleCount,
  plannedWrites: writes.length,
  hashes
}, null, 2));
