import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const previous = JSON.parse(fs.readFileSync(path.join(here, '07-页面取消后独立回读.json'), 'utf8'));
const token = crypto.randomUUID(), values = {}, audit = [];
const candidates = [8014, 8017].map((id, index) => {
  const name = id === 8014 ? '致命一击' : '砍倒', comparator = id === 8014 ? 'LT' : 'GT';
  const skillKey = `rune_${id}_passive`, zoneKey = `rune_${id}_damage_increase`;
  const parameter = parameterKey => ({ kind: 'PARAMETER', parameterKey });
  const description = `本组成仅覆盖普通直接物理普攻；每笔结算前对敌方英雄判断生命当前比例严格${id === 8014 ? '低于40%' : '高于60%'}，等值不成立。技能及其他伤害来源另行接线，不表示整符文完成。`;
  return { runeKey: `rune_${id}`, skillKey, name,
    writes: [
      { method: 'POST', route: '/modifier-zones', detailRoute: `/modifier-zones/${zoneKey}`, body: {
        modifierZoneKey: zoneKey, name: `${name}独立增伤乘区`, domain: 'DAMAGE', calculationMode: 'RATIO_ADD',
        applicationStage: 'DAMAGE_PRE_DEFENSE', status: 'ENABLED', sortOrder: 270 + index * 10,
        description: `${name}合格伤害的独立增幅；同区比例加算，与其他独立增幅分区相乘。具体伤害资格由引用结果限定。`
      } },
      { method: 'POST', route: `/skills/${skillKey}/effects`, detailRoute: `/skills/${skillKey}/effects/basic_attack_health_bonus`, body: {
        effectKey: 'basic_attack_health_bonus', name: `${name}普通物理普攻生命门槛增伤`, description, sortOrder: 10,
        lifecycle: { instanceScope: 'SOURCE', durationValue: null, maxStacksValue: { kind: 'FIXED', value: 1 },
          applicationStacksValue: { kind: 'FIXED', value: 1 }, reapplicationStackMode: 'KEEP', reapplicationDurationMode: null,
          expiryMode: 'EXPLICIT_ONLY', periodicIntervalValue: null, firstPeriodicExecution: null },
        results: [{ resultKey: 'increase_damage', name: '符合生命门槛时提高普通物理普攻伤害', resultType: 'DAMAGE_MODIFIER', target: 'SOURCE',
          description, sortOrder: 10, spellShieldBlockScope: null,
          valueRule: { value: parameter('bonus_damage_ratio'), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
          lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED',
            reapplicationValueMode: null, periodicExecutionMode: null },
          detail: { modifierZoneKey: zoneKey, direction: 'DEALT', operation: 'INCREASE', damageTypeKey: 'physics',
            deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT', criticalFilter: 'ANY',
            condition: { receiver: 'ENEMY_CHAMPION', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO', comparator,
              comparisonValue: parameter('target_health_threshold_ratio') } } }]
      } },
      { method: 'POST', route: `/skills/${skillKey}/trigger-rules`, detailRoute: `/skills/${skillKey}/trigger-rules/initialize_basic_attack_bonus`, body: {
        ruleKey: 'initialize_basic_attack_bonus', name: `初始化${name}普通物理普攻增伤`, description, sortOrder: 10,
        eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} }, conditionGroups: [],
        actions: [{ actionKey: 'apply_bonus', name: '施加常驻生命门槛增伤', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
          targetContext: 'CURRENT_TARGET', detail: { effectKey: 'basic_attack_health_bonus' }, runtimeInputBindings: [], resultModifiers: [] }],
        perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
      } }
    ] };
});
const routes = [...Object.keys(previous.values), ...candidates.flatMap(c => c.writes.map(w => w.detailRoute))];
for (const route of routes) {
  const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route,
    { method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  const expected = route in previous.values ? 200 : 404;
  audit.push({ method: 'GET', route, status: response.status });
  assert.equal(response.status, expected, route);
  values[route] = response.status === 404 ? { http: 404 } : await response.json();
  if (route in previous.values) assert.deepEqual(values[route], previous.values[route], route);
}
const checks = candidates.flatMap(c => {
  const threshold = values[`/skills/${c.skillKey}/parameters/target_health_threshold_ratio`].fixedValue;
  const bonus = values[`/skills/${c.skillKey}/parameters/bonus_damage_ratio`].fixedValue;
  assert.equal(bonus, 0.08); assert.equal(threshold, c.runeKey === 'rune_8014' ? 0.4 : 0.6);
  return [-1, 0, 1].map(delta => {
    const hp = threshold * 1000 + delta, qualified = c.runeKey === 'rune_8014' ? hp / 1000 < threshold : hp / 1000 > threshold;
    return { rune: c.runeKey, hp, maxHp: 1000, raw: 100, expected: 100 * (qualified ? 1 + bonus : 1) };
  });
});
const at = new Date().toISOString();
fs.writeFileSync(path.join(here, '09-返回前独立现值.json'), JSON.stringify({ at, status: 'PASS', audit, values, businessWrites: 0 }, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(here, '10-页面候选待前端审查.json'), JSON.stringify({ at, status: 'CANDIDATE_PENDING_FRONTEND_REVIEW',
  question: '真实伤害修正表单能否明确每笔敌方英雄生命门槛、严格等值边界及现有过滤，保存重开与独立回读一致',
  scopeReason: '第一组成明确限定普通直接物理普攻，既有过滤能完整表达；不以空伤害类型掩盖惩戒/打野宠物来源例外缺口。符文其余伤害范围继续推进，不能据此记整符文完成。',
  source: ['02-来源引用与能力核对.json', '08-伤害范围与乘区口径.md'], candidates, arithmetic: checks,
  protect: { baseline: '09-返回前独立现值.json', existingResponses: 32, existingModifierZones: 9,
    noDeletes: true, noUpdatesToExistingObjects: true, preserveUnusedParametersAndFormulas: true },
  acceptance: ['由核验模型/max执行代理正常控件保存，每笔关闭重开后暂停供独立回读', '状态变化重新定位；结果不明先只读确认，不重放',
    '核对条件摘要、三个引用和SOURCE_INITIALIZED入口；未接线提示只在效果刚保存时允许', '原对象致命一击与同类砍倒分别返回',
    '不把管理组成、全符文管理和实际Wasm证据混为完成'] }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: 'PASS_PREPARATION_ONLY', GETs: audit.length, protected: 32, candidatesAbsent: 6, arithmetic: checks, businessWrites: 0 }));
