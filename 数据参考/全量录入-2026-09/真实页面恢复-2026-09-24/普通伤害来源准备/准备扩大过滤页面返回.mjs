import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const previous = JSON.parse(fs.readFileSync(path.join(here, '../58-符文安全草稿返回独立验收.json'), 'utf8'));
const values = {}, audit = [], token = crypto.randomUUID();
for (const [route, old] of Object.entries(previous.values)) {
  const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, {
    method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  assert.equal(response.status, 200, route); values[route] = await response.json();
  assert.deepEqual(values[route], old, `新候选必须沿实际未改现值准备：${route}`);
  audit.push({ method: 'GET', route, status: response.status });
}
assert.equal(audit.length, 38);
const writes = [];
for (const [id, name, limit] of [[8014, '致命一击', '低于40%'], [8017, '砍倒', '高于60%']]) {
  const skillKey = `rune_${id}_passive`;
  const description = `每笔普通直接伤害结算前，对敌方英雄判断生命当前比例严格${limit}，等值不成立。不限物理、魔法、真实类型及普攻或技能；惩戒和打野宠物不适用，反射仍待核定。本组成须在完成来源核定的场景使用，未知来源拒绝运行；不表示整符文或任意技能组合完成。`;
  for (const [collection, key] of [['effects', 'basic_attack_health_bonus'], ['trigger-rules', 'initialize_basic_attack_bonus']]) {
    const route = `/skills/${skillKey}/${collection}/${key}`, before = values[route];
    const body = structuredClone(before);
    for (const meta of ['gameId', 'skillKey', 'createdAt', 'updatedAt', collection === 'effects' ? 'effectKey' : 'ruleKey']) delete body[meta];
    body.name = collection === 'effects' ? `${name}普通直接伤害生命门槛增伤` : `初始化${name}普通直接伤害增幅`;
    body.description = description;
    if (collection === 'effects') {
      assert.equal(body.results.length, 1);
      const result = body.results[0]; assert.equal(result.resultType, 'DAMAGE_MODIFIER');
      assert.equal(result.detail.damageTypeKey, 'physics'); assert.equal(result.detail.deliveryKind, 'BASIC_ATTACK');
      result.name = '符合生命门槛时提高普通直接伤害'; result.description = description;
      result.detail.damageTypeKey = null; result.detail.deliveryKind = 'ANY';
      const protectedResult = structuredClone(result);
      protectedResult.name = before.results[0].name; protectedResult.description = before.results[0].description;
      protectedResult.detail.damageTypeKey = before.results[0].detail.damageTypeKey;
      protectedResult.detail.deliveryKind = before.results[0].detail.deliveryKind;
      assert.deepEqual(protectedResult, before.results[0]);
      assert.deepEqual(body.lifecycle, before.lifecycle);
    } else {
      const protectedRule = { ...body, name: before.name, description: before.description };
      const old = structuredClone(before); delete old.ruleKey;
      assert.deepEqual(protectedRule, old);
    }
    writes.push({ runeKey: `rune_${id}`, skillKey, method: 'PUT', route, detailRoute: route, body,
      allowedChanges: collection === 'effects'
        ? ['效果及结果名称和说明', 'damageTypeKey: physics → null', 'deliveryKind: BASIC_ATTACK → ANY']
        : ['规则名称和说明'], before });
  }
}
fs.writeFileSync(path.join(here, '08-扩大过滤前独立现值.json'), JSON.stringify({ at: new Date().toISOString(),
  businessWrites: 0, audit, values }, null, 2) + '\n', { flag: 'wx' });
const candidate = { at: new Date().toISOString(), status: 'PREPARED_PENDING_SOURCE_AUDIT_ACCEPTANCE',
  question: '已核普通魔法与真实伤害能否沿正常页面放宽过滤，并保留逐笔门槛及完整关联',
  gatesBeforeApproval: ['来源审计最终独立审查通过', '最终代码必要检查通过', '真实来源候选工作线程通过'],
  protection: '38项现值及11乘区；参数、公式、主体、挂载、结果/规则/动作稳定键、条件、金额、生命周期和引用保持',
  runtimeEvidence: '07-来源候选与反向拥有者运行.json', businessWrites: 0, wholeRunesComplete: false, writes };
fs.writeFileSync(path.join(here, '09-扩大过滤页面候选.json'), JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ independentGETs: 38, candidates: writes.length, status: candidate.status, businessWrites: 0 }));
