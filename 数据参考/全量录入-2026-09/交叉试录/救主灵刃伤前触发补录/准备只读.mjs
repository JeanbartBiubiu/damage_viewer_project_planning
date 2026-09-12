import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..', '..');
const planningRepo = 'C:/project/damage_viewer_project_planning';
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token) throw new Error('缺少 DAMAGE_ENTRY_TOKEN');

const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidateRoutes = [
  '/skills/item_3040_passive/formulas/lifeline_health_threshold_value',
  '/skills/item_3040_passive/trigger-rules/on_damage_cross_below_lifeline_threshold'
];
const routes = [
  '/attributes/hp',
  '/attributes/mana',
  '/damage-types',
  '/skills/item_3040_passive',
  '/skills/item_3040_passive/parameters',
  '/skills/item_3040_passive/parameters/lifeline_shield_resource_ratio',
  '/skills/item_3040_passive/parameters/lifeline_shield_resource_input',
  '/skills/item_3040_passive/formulas',
  '/skills/item_3040_passive/formulas/lifeline_shield_value',
  '/skills/item_3040_passive/effects',
  '/skills/item_3040_passive/effects/lifeline_shield',
  '/skills/item_3040_passive/processes',
  '/skills/item_3040_passive/internal-states',
  '/skills/item_3040_passive/trigger-rules',
  '/skills/item_3040_passive/representative-image',
  '/equipment-skill-relations?equipmentKey=item_3040',
  ...candidateRoutes
];

async function get(route) {
  const response = await fetch(base + route, { headers: { Authorization: `Bearer ${token}` } });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { parseError: true, responseBytes: Buffer.byteLength(text) }; }
  }
  return { method: 'GET', route, status: response.status, data };
}

const requests = [];
for (const route of routes) requests.push(await get(route));
for (const item of requests) {
  const expected = candidateRoutes.includes(item.route) ? 404 : 200;
  if (item.status !== expected) throw new Error(`${item.route} 预期 ${expected}，实际 ${item.status}`);
}

const normalizedPath = path.join(repo, '数据参考', 'lol-wiki-current-items', 'current-items.normalized.json');
const normalizedBytes = fs.readFileSync(normalizedPath);
const normalized = JSON.parse(normalizedBytes.toString('utf8'));
const items = normalized.items.filter(item => [3040, 3173, 3174].includes(item.id));
if (items.length !== 3) throw new Error(`固定装备来源只找到 ${items.length} 项`);

const planningSourcePath = path.join(planningRepo, '数据参考', '全量录入-2026-09', '装备技能实录', '第二十批升级鞋', '冻结来源.json');
const planningSourceBytes = fs.readFileSync(planningSourcePath);
const planningSource = JSON.parse(planningSourceBytes.toString('utf8'));
const shoes = planningSource.objects.filter(item => ['带链碾碎者', '装甲战靴'].includes(item.name)).map(item => ({
  equipmentKey: item.equipmentKey,
  name: item.name,
  rawSha256: item.rawSha256,
  shieldCalculation: item.raw?.mItemCalculations?.ShieldAmountCalc ?? null,
  bindings: item.bindings
}));
if (shoes.length !== 2) throw new Error(`升级鞋来源只找到 ${shoes.length} 项`);

const seraphSourcePath = path.join(planningRepo, '数据参考', '全量录入-2026-09', '装备技能实录', '第十六批成长与触发装备', '冻结来源.json');
const seraphSourceBytes = fs.readFileSync(seraphSourcePath);
const seraphSource = JSON.parse(seraphSourceBytes.toString('utf8'));
const seraph = seraphSource.objects.find(item => item.equipmentKey === 'item_3040');
if (!seraph) throw new Error('成长与触发装备来源缺少 item_3040');

const designPath = path.join(repo, '文档记录', '详细设计', '项目', '持续修正与伤前保护详细设计.md');
const sourceSnapshot = {
  capturedAt: new Date().toISOString(),
  normalized: {
    path: '数据参考/lol-wiki-current-items/current-items.normalized.json',
    sha256: crypto.createHash('sha256').update(normalizedBytes).digest('hex'),
    fetchedAt: normalized.fetchedAt,
    items
  },
  upgradedShoesClientSource: {
    path: 'C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/装备技能实录/第二十批升级鞋/冻结来源.json',
    sha256: crypto.createHash('sha256').update(planningSourceBytes).digest('hex'),
    clientVersion: planningSource.clientVersion,
    officialVersion: planningSource.officialVersion,
    gameSourceBuild: planningSource.gameSourceBuild,
    shoes
  },
  seraphClientSource: {
    path: 'C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/装备技能实录/第十六批成长与触发装备/冻结来源.json',
    sha256: crypto.createHash('sha256').update(seraphSourceBytes).digest('hex'),
    clientVersion: seraphSource.clientVersion,
    officialVersion: seraphSource.officialVersion,
    item: seraph
  },
  contract: {
    path: '文档记录/详细设计/项目/持续修正与伤前保护详细设计.md',
    sha256: crypto.createHash('sha256').update(fs.readFileSync(designPath)).digest('hex')
  },
  unresolved: [
    '3173/3174 的伤害事件来源英雄类别当前不能通用保存。',
    '3173/3174 的客户端等级计算树与100至200公开正文存在差异，本批不写等级数组。',
    '3040 的极地大乱斗75秒冷却覆盖无法放入当前单一参数。',
    '3040 敬畏当前读取总法力值，而公开正文写额外法力值；本批保护该既有公式。'
  ]
};
const baseline = {
  capturedAt: new Date().toISOString(),
  methodPolicy: 'GET_ONLY',
  authorizationValueRecorded: false,
  getCount: requests.length,
  businessWrites: 0,
  candidateExpectedStatus: 404,
  requests
};

fs.writeFileSync(path.join(here, '03-来源快照.json'), JSON.stringify(sourceSnapshot, null, 2) + '\n');
fs.writeFileSync(path.join(here, '04-写入前现值.json'), JSON.stringify(baseline, null, 2) + '\n');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(here, file))).digest('hex');
process.stdout.write(JSON.stringify({
  status: 'PASS',
  getCount: requests.length,
  writes: 0,
  planSha256: digest('02-冻结请求.json'),
  sourceSnapshotSha256: digest('03-来源快照.json'),
  baselineSha256: digest('04-写入前现值.json'),
  normalizedSha256: sourceSnapshot.normalized.sha256,
  planningSourceSha256: sourceSnapshot.upgradedShoesClientSource.sha256,
  seraphSourceSha256: sourceSnapshot.seraphClientSource.sha256
}, null, 2));
