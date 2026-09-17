import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { request } from './录入.mjs';

// 仅 GET。页面操作由主负责人通过真实浏览器完成，此处保存其后的独立接口证据。
const canceled = [];
for (const route of ['/skills/veigar_e/effects/event_horizon_stun', '/skills/veigar_e/trigger-rules/actual_cage_contact']) {
  const response = await request(route);
  assert.equal(response.status, 404, route);
  canceled.push({ route, ...response });
}
await writeFile(new URL('./维迦E页面未保存.json', import.meta.url), JSON.stringify({
  checkedAt: new Date().toISOString(), status: '真实页面试录发现结构缺口，草稿已取消，未保存',
  page: 'http://127.0.0.1:5173/#/skills', skillKey: 'veigar_e',
  observations: [
    '新增效果采用来源与目标范围、眩晕时长参数；新增状态结果选择当前目标与持续生效后，法术护盾阻挡粒度控件消失。',
    '结果和父效果的保存按钮均未点击；依次取消结果、取消效果并关闭列表。',
    '前后端同时禁止持续目标状态携带非空法术护盾粒度；改成施加时点没有本次状态随效果到期结束的保证，空粒度会绕过护盾。',
    '同一牢笼重复命中限制也缺冻结来源证据；效果和触发两项均保留待修，不属于范围外。',
  ], readbacks: canceled, runtimeValidation: '未执行',
}, null, 2) + '\n');
const effects = [];
for (const key of ['passive_attack_speed', 'cast_attack_speed']) {
  const response = await request('/skills/diana_p/effects/' + key);
  assert.equal(response.status, 200);
  const behavior = response.data.results[0].lifecycleBehavior;
  assert.equal(behavior.valueReadMode, 'MOMENT_EVALUATION');
  assert.equal(behavior.stackValueMode, 'SHARED');
  effects.push({ key, ...response });
}
await writeFile(new URL('./页面验收.json', import.meta.url), JSON.stringify({
  checkedAt: new Date().toISOString(), passed: true,
  page: 'http://127.0.0.1:5173/#/skills', skillKey: 'diana_p',
  observations: [
    '按 diana_p 查询后显示月银之刃代表图片；效果列表有常态攻速、施法后攻速和顺劈三个效果。',
    '查看常态攻速：施法者、持续生效、到当前时点重新读取、整个实例共享数值；按来源对象、仅显式移除。',
    '关闭常态详情再打开施法后攻速：引用 empowered_duration_ms，保留层数、刷新全部时间、一次全部到期；结果同样为施法者持续生效并动态读取。',
  ], readbacks: effects,
  boundary: '代表配置真实页面查看及独立 GET；没有新增战斗或 Wasm 验证，维迦失败草稿另有未保存记录。',
}, null, 2) + '\n');
console.log(JSON.stringify({ canceledMissing: canceled.length, dynamicEffects: effects.length, passed: true }));
