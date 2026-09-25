import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// 本脚本仅GET和本地证据写入，业务变更只允许指定代理走真实页面。
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const mode = process.argv[2], completed = Number(process.argv[3] ?? 0);
assert(['prepare', 'readback'].includes(mode));
assert(Number.isInteger(completed) && completed >= 0 && completed <= 9);
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const write = (name, data) => fs.writeFileSync(path.join(here, name), JSON.stringify(data, null, 2) + '\n', {flag:'wx'});
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const prefix = '/skills/item_3057_passive', base = 'http://127.0.0.1:8080/api/admin/games/lol';
const values = {}, audit = [], token = crypto.randomUUID();
async function get(route, allowMissing = false) {
  const result = await fetch(base + route, {method:'GET', headers:{Authorization:'Bearer ' + token}, redirect:'error', signal:AbortSignal.timeout(15000)});
  audit.push({method:'GET',route,status:result.status});
  assert(result.status === 200 || allowMissing && result.status === 404, route + ': ' + result.status);
  return values[route] = result.status === 404 ? {http:404} : await result.json();
}
const kinds = {parameters:'parameterKey', formulas:'formulaKey', effects:'effectKey', processes:'processKey', 'internal-states':'stateKey', 'trigger-rules':'ruleKey'};
await get(prefix);
for (const [kind,key] of Object.entries(kinds)) {
  const list = await get(prefix + '/' + kind);
  for (const row of list) await get(prefix + '/' + kind + '/' + row[key]);
}
for (const route of ['/equipment/item_3057', '/equipment/item_3057/attributes', '/equipment/item_3057/representative-image', '/equipment-skill-relations?equipmentKey=item_3057', '/equipment-skill-relations?skillKey=item_3057_passive', prefix + '/representative-image', '/vamp-rules', '/skill-categories/passive', '/attributes/attack_damage', '/attributes/ability_haste', '/damage-types/physics']) await get(route);
for (const suffix of ['/parameters/spellblade_window_ms','/internal-states/spellblade_ready','/internal-states/spellblade_icd','/processes/spellblade_consume','/trigger-rules/spellblade_arm']) if (!Object.hasOwn(values, prefix + suffix)) await get(prefix + suffix, true);
const strip = value => {
  const {gameId, skillKey, createdAt, updatedAt, ...body} = value;
  return body;
};
if (mode === 'prepare') {
  const proposed = read('同类装备准备/04-耀光页面候选.json');
  const old = read('同类装备准备/01-耀光当前GET.json');
  for (const [route,body] of Object.entries(old.bodies)) assert.deepEqual(values[route.replace('/api/admin/games/lol','')],body,'候选准备后现值漂移：'+route);
  for (const item of proposed.derivation.sourceHashes) assert.equal(sha(fs.readFileSync(path.join(root,item.file))),item.sha256,'来源文件变化：'+item.file);
  const requests = structuredClone([...proposed.requests, ...proposed.descriptionOnlyPutCandidates]).map(({method,route,detailRoute,key,body})=>({method,route,detailRoute,key,body}));
  assert.equal(requests.length,9);
  requests[0].body.description = '本项目采用10000毫秒待击窗口；重复符合条件的施法刷新期限，不叠加次数。时长与刷新为模拟近似。';
  requests[1].body.description = '普通成功首次主动施法且冷却就绪时开启；重复施法刷新窗口，强化普攻命中或超时关闭。窗口与刷新按项目近似。';
  requests[2].body.description = '冷却1500毫秒来自本物品资料。命中消费后起算、超时不启动为项目近似。';
  requests[3].body.description = '普通成功首次主动施法后待击10秒，重复施法刷新，不叠次数；普攻命中执行原咒刃伤害并启动1500毫秒冷却，超时只清待命。窗口、刷新及冷却起算点为项目近似；特殊使用和吸血资格仍待核。';
  requests[3].body.steps[0].description = '等待实际普攻命中，取该次普攻目标；待击窗口为项目近似。';
  requests[4].body.description = '普通成功首次主动施法且咒刃内部冷却就绪时启动或刷新同一待击过程；强化步骤负责唯一伤害与消费。窗口、刷新和冷却起算按项目近似；重施、开关等特殊使用未验证。';
  for (const request of requests) {
    if (request.method === 'POST') assert.deepEqual(values[request.detailRoute],{http:404});
    else {
      const before = strip(values[request.detailRoute]);
      if (request.key !== 'skillKey') delete before[request.key];
      const {description: _old, ...protectedBefore} = before;
      const {description: _new, ...protectedAfter} = request.body;
      assert.deepEqual(protectedAfter,protectedBefore,'说明候选修改了保护字段：'+request.route);
    }
  }
  const process = requests[3].body, rule = requests[4].body;
  assert.equal(process.effectBindings.length,1);
  assert.equal(process.effectBindings[0].effectKey,'spellblade_damage');
  assert.equal(process.steps[0].detail.consumeMoment,'ATTACK_HIT');
  assert.equal(rule.conditionGroups.length,1);
  assert.equal(rule.conditionGroups[0].conditions.length,1);
  assert.equal(rule.actions.length,1);
  assert.equal(values[prefix+'/effects/spellblade_damage'].results[0].detail.vampQualification,'UNRESOLVED');
  const ast = values[prefix+'/formulas/spellblade_damage'].expression;
  function evaluate(node, baseAttack) {
    if (node.nodeType === 'OPERATION') {assert.equal(node.operation,'MULTIPLY');return node.operands.reduce((n,x)=>n*evaluate(x,baseAttack),1);}
    if (node.nodeType === 'PARAMETER') return values[prefix+'/parameters/'+node.parameterKey].fixedValue;
    assert.deepEqual(node,{nodeType:'ATTRIBUTE',attributeKey:'attack_damage',attributeOwner:'SOURCE',attributeValueKind:'BASE'});
    return baseAttack;
  }
  const arithmetic = [60,100,150].map(baseAttack => ({baseAttack,totalAttack:baseAttack+50,rawDamage:evaluate(ast,baseAttack)}));
  for(const item of arithmetic) assert.equal(item.rawDamage,item.baseAttack);
  write('耀光-01-写前现值.json',{at:new Date().toISOString(),audit,values,businessWrites:0});
  write('耀光-02-页面批准.json',{
    at:new Date().toISOString(),executionMode:'PLAYWRIGHT_UI_ONLY',model:'gpt-6-sol',effort:'max',
    question:'仅一个原伤害效果的相邻咒刃装备能否复用单步骤和单启动规则，避免回蓝或额外命中规则依赖',
    scope:'普通成功首次主动施法后下一次真实普攻；明确项目近似，不扩大为完整特殊技能使用或整装备运行',
    projectApproximations:proposed.projectApproximations,
    baselineSha256:sha(fs.readFileSync(path.join(here,'耀光-01-写前现值.json'))),candidateSha256:sha(fs.readFileSync(path.join(here,'同类装备准备/04-耀光页面候选.json'))),
    sourceHashes:proposed.derivation.sourceHashes,requests,arithmetic,
    protected:'原伤害结果、公式及参数数值、UNRESOLVED吸血、装备属性、关系、图片保持；后四笔仅更正过时说明',
    wholeEquipmentComplete:false, runtimeValidated:false
  });
  console.log(JSON.stringify({status:'APPROVED_UI_ONLY',GETs:audit.length,plannedPageWrites:requests.length,arithmetic,businessWrites:0}));
} else {
  const before = read('耀光-01-写前现值.json'), plan = read('耀光-02-页面批准.json');
  assert.equal(sha(fs.readFileSync(path.join(here,'耀光-01-写前现值.json'))),plan.baselineSha256);
  const applied = plan.requests.slice(0,completed), changed = new Set(applied.map(x=>x.detailRoute));
  for(const item of applied) {
    const actual = strip(values[item.detailRoute]);
    const expected = structuredClone(item.body);
    if(item.key === 'processKey') {
      // 服务端SkillProcessMoment只省略空failureReason，其他字段继续严格比较。
      for(const row of [...expected.effectBindings,...expected.stateOperations]) {
        assert.equal(row.moment.failureReason,null);
        delete row.moment.failureReason;
      }
    }
    if(item.method === 'PUT') {
      if(item.key !== 'skillKey') delete actual[item.key];
      for(const field of ['gameId','skillKey','equipmentKey','createdAt']) assert.equal(values[item.detailRoute][field],before.values[item.detailRoute][field]);
    }
    assert.deepEqual(actual,expected,'正文不一致：'+item.detailRoute);
  }
  let protectedResponses=0;
  for(const [route,original] of Object.entries(before.values)) {
    if(changed.has(route)) continue;
    const key = Object.entries(kinds).find(([kind])=>route===prefix+'/'+kind)?.[1];
    if(key) {
      const additions = applied.filter(x=>x.method==='POST' && x.route===route);
      const updates = applied.filter(x=>x.method==='PUT' && x.route.startsWith(route+'/'));
      if(additions.length || updates.length) {
        const expected = structuredClone(original);
        for(const update of updates) {
          const row = expected.find(x=>x[key]===update.detailRoute.split('/').at(-1));
          row.description=update.body.description;
          row.updatedAt=values[update.detailRoute].updatedAt;
        }
        assert.equal(values[route].length,original.length+additions.length);
        assert.deepEqual(values[route].filter(x=>!additions.some(a=>a.body[key]===x[key])),expected);
        continue;
      }
    }
    assert.deepEqual(values[route],original,'保护内容变化：'+route);
    protectedResponses++;
  }
  write(`耀光-回读-${completed}.json`,{status:'PASS',at:new Date().toISOString(),completedPageWrites:completed,audit,values,protectedResponses,businessWrites:0,wholeEquipmentRuntime:false});
  console.log(JSON.stringify({status:'PASS',completed,GETs:audit.length,protectedResponses,businessWrites:0}));
}
