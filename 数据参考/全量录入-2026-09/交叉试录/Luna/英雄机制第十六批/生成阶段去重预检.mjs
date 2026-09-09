import fs from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('./', import.meta.url);
const ledgerPath = 'C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/阶段进度.json';
const ledgerBytes = fs.readFileSync(ledgerPath);
const ledger = JSON.parse(ledgerBytes);
const snapshotBytes = fs.readFileSync(new URL('写前现值.json', here));
const snapshot = JSON.parse(snapshotBytes);
const selected = ['Malzahar', 'Anivia', 'Lissandra', 'Karthus'];
const selectedSkills = selected.flatMap(hero => {
  const key = hero.toLowerCase() === 'anivia' ? 'anivia' : hero.toLowerCase();
  return ['p', 'q', 'w', 'e', 'r'].map(slot => `${key}_${slot}`);
});

function walk(value, path, matches) {
  if (typeof value === 'string') {
    if (selected.includes(value) || selectedSkills.includes(value)) matches.push({ path, value });
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`, matches);
}

const matches = [];
walk(ledger, '$', matches);
const byValue = Object.fromEntries([...new Set([...selected, ...selectedSkills])].map(value => [value, matches.filter(row => row.value === value)]));
const existingSkillSlots = selectedSkills.filter(key => snapshot.skills[key]?.components?.parameters?.items?.length || Object.values(snapshot.skills[key]?.components ?? {}).some(component => component.items?.length));
const report = {
  at: new Date().toISOString(),
  ledgerPath,
  ledgerSha256: createHash('sha256').update(ledgerBytes).digest('hex'),
  sourceOfTruth: 'planning/master阶段进度.json；本脚本只读，不修改阶段账',
  candidateHeroes: selected,
  candidateSkills: selectedSkills,
  byValue,
  apiSnapshot: { sha256: createHash('sha256').update(snapshotBytes).digest('hex'), summary: snapshot.summary, existingSkillSlots },
  replacement: {
    excluded: ['Veigar'],
    excludedReason: 'Veigar P/Q/W/E/R在写前GET已有六类完整组成，避免重复录入。',
    selectedReplacement: 'Karthus',
    replacementReason: 'Karthus在阶段账只有公共参数记录，20技能位除既有22个公共参数外没有公式、效果、过程、状态或规则；与本批范围和来源冻结一致。'
  },
  noWrites: true
};
fs.writeFileSync(new URL('阶段去重预检.json', here), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ledgerSha256: report.ledgerSha256, selected: selected.length, skillSlots: selectedSkills.length, matchingEntries: matches.length, existingSkillSlots, replacement: report.replacement.selectedReplacement, noWrites: true }, null, 2));
