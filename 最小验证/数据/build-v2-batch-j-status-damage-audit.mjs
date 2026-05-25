import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

const paths = {
  auditJson: path.join(repoRoot, '最小验证', 'V2-Batch-J-status-damage-audit.json'),
  skillsSnapshot: path.join(repoRoot, '最小验证', '数据', 'V2-Batch-J-skills-mechanics-snapshot.json'),
};

const WHITELIST = new Map([
  [
    'skill_malzahar_e',
    {
      classification: 'migrate_to_status_resource',
      reason: 'true dot with persistent interval semantics',
      targetStatusId: 'status_malzahar_e_dot',
    },
  ],
  [
    'skill_brand_w',
    {
      classification: 'keep_mechanics_config',
      reason: 'delayed detonation hit, not a persistent attached status',
    },
  ],
  [
    'skill_ahri_q',
    {
      classification: 'keep_mechanics_config',
      reason: 'multi-segment hit timing, not a status entity',
    },
  ],
  [
    'skill_katarina_r',
    {
      classification: 'keep_mechanics_config',
      reason: 'multi-tick cast channel damage, not a status lifecycle',
    },
  ],
  [
    'skill_leona_r',
    {
      classification: 'keep_mechanics_config',
      reason: 'delayed explosion hit, not a persistent attached status',
    },
  ],
  [
    'skill_leona_w',
    {
      classification: 'keep_mechanics_config',
      reason: 'delayed shield detonation hit, not a persistent attached status',
    },
  ],
  [
    'skill_drmundo_r',
    {
      classification: 'out_of_scope',
      reason: 'HoT sustain migration deferred for 1v1 damage-only validation scope',
    },
  ],
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function hasScheduleTick(mechanicsConfig) {
  const triggers = mechanicsConfig?.triggers;
  if (!Array.isArray(triggers)) {
    return false;
  }
  return triggers.some((trigger) =>
    Array.isArray(trigger?.actions)
      && trigger.actions.some((action) => action?.type === 'schedule_tick')
  );
}

function classifyUnknownScheduleTickSkill(skillId) {
  return {
    classification: 'keep_mechanics_config',
    reason: 'schedule_tick present but not on Batch J whitelist; requires manual review before migration',
  };
}

function loadSkillsFromDatabase(gameId) {
  const dbUrl = process.env.SPRING_DATASOURCE_URL || process.env.IT_DB_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    return null;
  }
  const query = `SELECT json_agg(json_build_object('skillId', skill_id, 'mechanicsConfig', mechanics_config) ORDER BY skill_id) AS skills
FROM public.skills
WHERE game_id = '${gameId.replace(/'/g, "''")}'`;
  const result = spawnSync('psql', [dbUrl, '-At', '-c', query], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.warn('psql scan skipped:', result.stderr || result.stdout);
    return null;
  }
  const payload = result.stdout.trim();
  if (!payload || payload === '' || payload === 'null') {
    return [];
  }
  const parsed = JSON.parse(payload);
  return Array.isArray(parsed) ? parsed : [];
}

function loadSkillsFromSnapshot() {
  if (!fs.existsSync(paths.skillsSnapshot)) {
    return null;
  }
  const snapshot = readJson(paths.skillsSnapshot);
  if (!Array.isArray(snapshot.skills)) {
    throw new Error('skills snapshot must contain `skills` array');
  }
  return snapshot.skills;
}

function buildRecords(skills, gameId) {
  const records = [];
  const seen = new Set();

  for (const [skillId, entry] of WHITELIST.entries()) {
    records.push({ skillId, ...entry });
    seen.add(skillId);
  }

  for (const skill of skills) {
    const skillId = skill.skillId;
    if (!skillId || seen.has(skillId)) {
      continue;
    }
    if (!hasScheduleTick(skill.mechanicsConfig)) {
      continue;
    }
    records.push({
      skillId,
      ...classifyUnknownScheduleTickSkill(skillId),
    });
    seen.add(skillId);
  }

  records.sort((left, right) => left.skillId.localeCompare(right.skillId));
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      gameId,
      source: 'build-v2-batch-j-status-damage-audit.mjs',
      rule: 'Explicit whitelist only; no automatic schedule_tick migration',
      scannedSkillCount: skills.length,
    },
    records,
  };
}

function main() {
  const gameId = process.env.BATCH_J_GAME_ID || 'lol';
  const skills = loadSkillsFromDatabase(gameId) || loadSkillsFromSnapshot() || [];
  if (skills.length === 0) {
    console.warn(
      'No skills input found. Emitting whitelist-only audit. '
        + 'Provide DATABASE_URL/SPRING_DATASOURCE_URL and psql, or '
        + '最小验证/数据/V2-Batch-J-skills-mechanics-snapshot.json for live scan.'
    );
  }
  const audit = buildRecords(skills, gameId);
  writeJson(paths.auditJson, audit);
  console.log(`Wrote ${paths.auditJson}`);
  console.log(`Records: ${audit.records.length}`);
  for (const record of audit.records) {
    console.log(`  ${record.skillId}: ${record.classification}`);
  }
}

main();
