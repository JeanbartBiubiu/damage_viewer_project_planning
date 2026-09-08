import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const rootUrl = 'http://127.0.0.1:8080';
const apiBase = '/api/admin/games/lol';
const equipment = [
  { requestedEquipmentKey: 'item_1056', requestedEquipmentName: '多兰戒', keyCandidates: ['item_1056', 'duolanjie', '1056'] },
  { requestedEquipmentKey: 'item_1082', requestedEquipmentName: '黑暗封印', keyCandidates: ['item_1082'] },
  { requestedEquipmentKey: 'item_3004', requestedEquipmentName: '魔宗', keyCandidates: ['item_3004'] },
  { requestedEquipmentKey: 'item_3041', requestedEquipmentName: '梅贾的窃魂卷', keyCandidates: ['item_3041'] },
  { requestedEquipmentKey: 'item_3053', requestedEquipmentName: '斯特拉克的挑战护手', keyCandidates: ['item_3053'] },
  { requestedEquipmentKey: 'item_3068', requestedEquipmentName: '日炎圣盾', keyCandidates: ['item_3068'] }
];
const stamp = new Date().toISOString().replaceAll(':', '-');
const outputPath = path.join(dir, `关系识别-${stamp}.json`);

async function request(route) {
  try {
    const response = await fetch(`${rootUrl}${apiBase}${route}`, {
      headers: { Authorization: 'Bearer local-entry' },
      signal: AbortSignal.timeout(30000)
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    return { status: response.status, data };
  } catch (error) {
    return { status: 0, error: String(error?.message ?? error) };
  }
}

function listItems(data) {
  return Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
}

const rows = [];
for (const item of equipment) {
  const keyProbes = [];
  let selectedKey = null;
  let selectedEquipment = null;
  for (const key of item.keyCandidates) {
    const response = await request(`/equipment/${encodeURIComponent(key)}`);
    keyProbes.push({ key, response });
    if (!selectedKey && response.status === 200) {
      selectedKey = key;
      selectedEquipment = response;
    }
  }
  selectedKey ??= item.requestedEquipmentKey;
  const relationPath = `/equipment-skill-relations?equipmentKey=${encodeURIComponent(selectedKey)}`;
  const relation = await request(relationPath);
  const relations = listItems(relation.data);
  const linkedSkills = [];
  for (const row of relations) {
    const skillKey = row.skillKey;
    const skill = skillKey ? await request(`/skills/${encodeURIComponent(skillKey)}`) : { status: 0, error: '关联记录没有skillKey' };
    linkedSkills.push({
      relation: row,
      skill,
      isExpectedPassive: skillKey === `${selectedKey}_passive`,
      isAlias: Boolean(skillKey && skillKey !== `${selectedKey}_passive`)
    });
  }
  // 仅作识别记录，不能用预期键404推断装备未录入；真正候选键以上面的真实关联为准。
  const expectedPassiveProbe = await request(`/skills/${encodeURIComponent(`${selectedKey}_passive`)}`);
  rows.push({
    requestedEquipmentKey: item.requestedEquipmentKey,
    requestedEquipmentName: item.requestedEquipmentName,
    keyCandidates: item.keyCandidates,
    keyProbes,
    selectedEquipmentKey: selectedKey,
    equipmentName: selectedEquipment?.data?.name ?? item.requestedEquipmentName,
    equipment: selectedEquipment ?? await request(`/equipment/${encodeURIComponent(selectedKey)}`),
    attributes: await request(`/equipment/${encodeURIComponent(selectedKey)}/attributes`),
    representativeImage: await request(`/equipment/${encodeURIComponent(selectedKey)}/representative-image`),
    relation: { path: relationPath, response: relation, items: relations },
    linkedSkills,
    expectedPassiveProbe,
    selectedSkillKeys: linkedSkills.map(row => row.relation.skillKey).filter(Boolean),
    aliasWarning: linkedSkills.filter(row => row.isAlias).map(row => row.relation.skillKey)
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: '只读真实GET关系识别；不写业务API',
  apiBaseUrl: `${rootUrl}${apiBase}`,
  rule: '必须先解析真实装备键，再以装备技能关联返回的真实skillKey为准；预期item_ID_passive的404只作探针，不判定未录入，不覆盖既有技能。',
  objects: rows,
  summary: {
    equipmentCount: rows.length,
    keyResolutions: rows.map(row => ({ requestedEquipmentKey: row.requestedEquipmentKey, selectedEquipmentKey: row.selectedEquipmentKey, keyProbeStatuses: row.keyProbes.map(probe => ({ key: probe.key, status: probe.response.status })) })),
    relationStatuses: rows.map(row => ({ equipmentKey: row.selectedEquipmentKey, status: row.relation.response.status, linkedCount: row.relation.items.length, aliases: row.aliasWarning })),
    aliasEquipmentCount: rows.filter(row => row.aliasWarning.length > 0).length,
    expectedPassive404Count: rows.filter(row => row.expectedPassiveProbe.status === 404).length,
    requestErrorCount: rows.flatMap(row => [row.equipment, row.attributes, row.representativeImage, row.relation.response, row.expectedPassiveProbe, ...row.keyProbes.map(probe => probe.response), ...row.linkedSkills.map(item => item.skill)]).filter(response => response.status === 0).length
  }
};
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ report: outputPath, mode: report.mode, summary: report.summary }, null, 2));
