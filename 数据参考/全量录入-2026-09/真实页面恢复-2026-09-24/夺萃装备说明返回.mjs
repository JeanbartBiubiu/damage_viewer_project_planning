import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// 本脚本仅 GET 并保存本地证据；业务修改由执行代理通过真实页面完成。
const here = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
assert(['prepare', 'readback'].includes(mode));
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(here, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const old = read(mode === 'prepare' ? '夺萃-合并-回读-3.json' : '夺萃装备说明-01-写前现值.json');
const routes = [...new Set([...Object.keys(old.values), '/equipment/item_3508/attributes', '/equipment-skill-relations?skillKey=item_3508_passive'])];
const values = {}, audit = [], token = crypto.randomUUID();
for (const route of routes) {
  const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, {
    method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  audit.push({ method: 'GET', route, status: response.status });
  assert.equal(response.status, 200, route);
  values[route] = await response.json();
}
const route = '/equipment/item_3508';
if (mode === 'prepare') {
  for (const [key, value] of Object.entries(old.values)) assert.deepEqual(values[key], value, '上次独立回读后变化：' + key);
  const previous = values[route];
  assert.equal(previous.description.split('被动与主动效果尚待配置。').length, 2);
  const body = { name: previous.name, description: previous.description.replace('被动与主动效果尚待配置。',
    '咒刃在本轮有限范围已配置并核对：成功首次主动施法开启10秒待击窗口，重复施法刷新；实际普攻命中时结算附加物理伤害和法力恢复，消费后启动1.5秒内部冷却，超时仅清待命。附伤生命偷取使用必要覆盖，全能吸血继承游戏规则。时序及回蓝采用项目已定模拟口径；特殊使用、近远程差异及完整装备装配尚未验证。') };
  write('夺萃装备说明-01-写前现值.json', { at: new Date().toISOString(), audit, values, businessWrites: 0 });
  write('夺萃装备说明-02-页面批准.json', {
    at: new Date().toISOString(), executionMode: 'PLAYWRIGHT_UI_ONLY', model: 'gpt-6-sol', effort: 'max',
    question: '从装备入口返回后，作者能否看见当前已保存能力及其模拟边界，而非过时的待配置结论',
    baseline: '夺萃装备说明-01-写前现值.json',
    baselineSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(here, '夺萃装备说明-01-写前现值.json'))).digest('hex'),
    request: { method: 'PUT', route, body },
    protected: '仅装备顶层说明变化；装备名称、属性、技能关联、代表图及所有已保存技能组成保持，旧7笔不重做',
    plannedPageWrites: 1, wholeEquipmentComplete: false
  });
  console.log(JSON.stringify({ status: 'APPROVED_UI_ONLY', GETs: audit.length, businessWrites: 0 }));
} else {
  const plan = read('夺萃装备说明-02-页面批准.json');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(here, plan.baseline))).digest('hex'), plan.baselineSha256);
  assert.deepEqual(values[route], { ...old.values[route], description: plan.request.body.description, updatedAt: values[route].updatedAt });
  assert.equal(values[route].name, plan.request.body.name);
  for (const [key, value] of Object.entries(old.values)) if (key !== route) assert.deepEqual(values[key], value, '保护内容变化：' + key);
  write('夺萃装备说明-03-独立回读.json', { at: new Date().toISOString(), status: 'PASS', audit, values,
    protectedResponses: routes.length - 1, completedTotalPageWrites: 8, businessWrites: 0 });
  console.log(JSON.stringify({ status: 'PASS', GETs: audit.length, protectedResponses: routes.length - 1, businessWrites: 0 }));
}
