import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token) throw new Error('缺少 DAMAGE_ENTRY_TOKEN');

const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const outputPath = path.join(here, '00-能力接口验收.json');
const temporaryRoutes = [
  '/skills/item_4629_passive/trigger-rules/temporary_damage_dealt_category_check',
  '/skills/item_3803_passive/trigger-rules/temporary_damage_taken_category_check'
];
const calls = [];

async function request(method, route, body = null) {
  const response = await fetch(base + route, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { parseError: true, responseBytes: Buffer.byteLength(text) }; }
  }
  const call = { method, route, status: response.status, data };
  calls.push(call);
  return call;
}

const categoryGroup = (detail = { categories: ['CHAMPION'] }) => [{
  groupKey: 'counterparty_category',
  name: '事件对方类别',
  sortOrder: 10,
  conditions: [{
    conditionKey: 'champion_counterparty',
    conditionType: 'TARGET_CATEGORY_CHECK',
    sortOrder: 10,
    detail
  }]
}];

const action = (effectKey, runtimeInputBindings = []) => [{
  actionKey: 'execute_effect',
  name: '执行既有效果',
  actionType: 'EXECUTE_EFFECT',
  sortOrder: 10,
  targetContext: 'CURRENT_TARGET',
  detail: { effectKey },
  runtimeInputBindings,
  resultModifiers: []
}];

const outgoing = {
  ruleKey: 'temporary_damage_dealt_category_check',
  name: '临时验证造成伤害对方类别',
  description: '仅用于接口能力验收，完成后立即删除。',
  sortOrder: 999999,
  eventSource: {
    eventType: 'DAMAGE_DEALT',
    detail: { damageTypeKey: 'magic', deliveryKind: 'ANY', originKind: 'ANY' }
  },
  conditionGroups: categoryGroup(),
  actions: action('spelldance_move_speed'),
  perTargetCooldown: null,
  maxTriggersPerProcess: null
};

const incoming = {
  ruleKey: 'temporary_damage_taken_category_check',
  name: '临时验证受到伤害对方类别',
  description: '仅用于接口能力验收，完成后立即删除。',
  sortOrder: 999999,
  eventSource: {
    eventType: 'DAMAGE_TAKEN',
    detail: { damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY' }
  },
  conditionGroups: categoryGroup(),
  actions: action('mana_from_hero_damage', [{
    bindingKey: 'raw_damage',
    parameterKey: 'damage_input',
    sourceType: 'EVENT_VALUE',
    detail: { eventValueKey: 'RAW_DAMAGE' }
  }]),
  perTargetCooldown: null,
  maxTriggersPerProcess: null
};

let failure = null;
try {
  const beforeOutgoing = await request('GET', '/skills/item_4629_passive/trigger-rules');
  const beforeIncoming = await request('GET', '/skills/item_3803_passive/trigger-rules');
  assert.equal(beforeOutgoing.status, 200);
  assert.equal(beforeIncoming.status, 200);
  assert.deepEqual(beforeOutgoing.data, []);
  assert.deepEqual(beforeIncoming.data, []);
  for (const route of temporaryRoutes) assert.equal((await request('GET', route)).status, 404);

  const unsupported = await request('POST', '/skills/item_4629_passive/trigger-rules', {
    ...outgoing,
    ruleKey: 'temporary_unsupported_category_check',
    eventSource: { eventType: 'BASIC_ATTACK_START', detail: {} }
  });
  assert.equal(unsupported.status, 400);
  assert.equal((await request('GET', '/skills/item_4629_passive/trigger-rules/temporary_unsupported_category_check')).status, 404);

  const mixed = await request('POST', '/skills/item_4629_passive/trigger-rules', {
    ...outgoing,
    ruleKey: 'temporary_mixed_category_check',
    conditionGroups: categoryGroup({ categories: ['CHAMPION'], subject: 'CURRENT_TARGET' })
  });
  assert.equal(mixed.status, 400);
  assert.equal((await request('GET', '/skills/item_4629_passive/trigger-rules/temporary_mixed_category_check')).status, 404);

  const createdOutgoing = await request('POST', '/skills/item_4629_passive/trigger-rules', outgoing);
  assert.equal(createdOutgoing.status, 201);
  const readOutgoing = await request('GET', temporaryRoutes[0]);
  assert.equal(readOutgoing.status, 200);
  assert.deepEqual(readOutgoing.data.conditionGroups[0].conditions[0].detail, { categories: ['CHAMPION'] });
  assert.equal(readOutgoing.data.eventSource.detail.damageTypeKey, 'magic');

  const createdIncoming = await request('POST', '/skills/item_3803_passive/trigger-rules', incoming);
  assert.equal(createdIncoming.status, 201);
  const readIncoming = await request('GET', temporaryRoutes[1]);
  assert.equal(readIncoming.status, 200);
  assert.deepEqual(readIncoming.data.conditionGroups[0].conditions[0].detail, { categories: ['CHAMPION'] });
  assert.equal(readIncoming.data.actions[0].runtimeInputBindings[0].detail.eventValueKey, 'RAW_DAMAGE');
} catch (error) {
  failure = error;
} finally {
  for (const route of temporaryRoutes) {
    const current = await request('GET', route);
    if (current.status === 200) assert.equal((await request('DELETE', route)).status, 204);
    else assert.equal(current.status, 404);
    assert.equal((await request('GET', route)).status, 404);
  }
}

if (failure) throw failure;
assert.deepEqual((await request('GET', '/skills/item_4629_passive/trigger-rules')).data, []);
assert.deepEqual((await request('GET', '/skills/item_3803_passive/trigger-rules')).data, []);

const report = {
  capturedAt: new Date().toISOString(),
  status: 'PASS',
  authorizationValueRecorded: false,
  businessWrites: calls.filter(call => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(call.method)).length,
  persistentBusinessWrites: 0,
  verified: [
    '不支持事件拒绝且不落库',
    '类别明细额外主体字段拒绝且不落库',
    '造成伤害可按当前伤害承受对象类别保存回读',
    '受到伤害可按事件来源类别保存并绑定减免前伤害',
    '两个临时规则均已删除，原规则列表保持为空'
  ],
  calls
};
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: report.status, calls: calls.length, businessWrites: report.businessWrites, persistentBusinessWrites: 0 }));
