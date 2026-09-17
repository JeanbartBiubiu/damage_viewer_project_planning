/**
 * Lightweight lint without ESLint: fail if production source still references
 * removed Bundle / Wasm Catalog / hero-item-skill REST surfaces.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'src');

/** Exact approved independent skill-management lines; `/skills` stays forbidden elsewhere. */
const APPROVED_INDEPENDENT_SKILL_LINES = [
  {
    file: 'src/pages/admin/characters/CharacterManagementPage.tsx',
    text: "import { SkillManagementPage } from '../skills/SkillManagementPage';"
  },
  {
    file: 'src/services/skillClient.ts',
    text: 'const base = `/api/admin/games/${encodePathSegment(gameId)}/skills`;'
  },
  {
    file: 'src/App.tsx',
    text: "import { SkillManagementPage } from './pages/admin/skills/SkillManagementPage';"
  },
  {
    file: 'src/services/imageRelationClient.ts',
    text: "case 'skill': return `${base}/skills/${key}/representative-image`;"
  },
  {
    file: 'src/services/imageRelationClient.ts',
    text: 'return `${base}/skills/${encodePathSegment(target.skillKey)}/effects/${key}/representative-image`;'
  }
];

const FORBIDDEN = [
  { id: 'bundle-path', pattern: /\/versions\/[^'"\s]+\/bundle\b|getBundle\b|loadPublishedBundleSnapshot\b/ },
  { id: 'wasm-catalog-path', pattern: /wasm-catalog|getWasmCatalog\b|loadPublishedWasmCatalogSnapshot\b|WasmCatalogV1\b/ },
  { id: 'owner-categories', pattern: /owner-categories|getOwnerCategories\b/ },
  {
    id: 'legacy-admin-resources',
    pattern:
      /\/heroes\b|\/items\b|\/skills\b|skill-mounts|formula-profiles|formula-bindings|coefficient-buckets|status-definitions|status-action-control|control-state-profiles|getHeroes\b|putHero\b|getItems\b|putItem\b|getSkills\b|putSkill\b/
  },
  {
    id: 'legacy-modules',
    pattern:
      /genericCatalogMaterializer|tinygoV2DpsAdapter|tinygoV2BundleAdapter|bundleCache|bundleSnapshot|wasmCatalogSnapshot/
  },
  {
    id: 'legacy-dps-abi',
    pattern:
      /tinygoV2DpsAdapter|SingleAttackerDPS|single_attacker_dps|engine_init\b|engine_begin_run\b|engine_snapshot_initial\b|engine_snapshot_actions_initial\b|engine_step\b|engine_abort_run\b|legacyRequiredExports|TinyGoV2BridgeProfile|profile:\s*['"]legacy['"]/
  },
  {
    id: 'legacy-combat-data-pages',
    pattern:
      /pages\/(OverviewPage|VersionPublishPage|WasmValidationGenericPage)|pages\/admin\/(provider-setup|ability-setup|effect-sequence-setup|effect-step-setup|direct-damage-ability|entity-setup|entity-growth|entity-provider-mount|combat-data|AdminPublishRail|combatDataNav|usePublishFlow|versionPublishModel)\b/
  },
  {
    id: 'legacy-combat-data-modules',
    pattern:
      /combatDataClient|combatDataLoader|combatDataCache|combatDataImageReference|combatDataAssembler|CombatDataImageReferenceField|types\/combatData\b|getCurrentVersion\b|publishVersion\b/
  },
  {
    id: 'legacy-combat-data-requests',
    pattern: /\/combat-data\/|versions\/current|versions:publish|versions\/:publish|versions\/publish/
  }
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'wasm') {
        continue;
      }
      walk(full, files);
      continue;
    }
    if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

const files = walk(ROOT);
const violations = [];

for (const file of files) {
  const rel = relative(process.cwd(), file).replace(/\\/g, '/');
  const content = readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(text) && /deprecated|removed|legacy|迁移/.test(text)) {
      continue;
    }
    for (const rule of FORBIDDEN) {
      if (
        rule.id === 'legacy-admin-resources' &&
        APPROVED_INDEPENDENT_SKILL_LINES.some(
          (approved) => rel === approved.file && text.trim() === approved.text
        )
      ) {
        continue;
      }
      if (rule.pattern.test(text)) {
        violations.push({ file: rel, id: rule.id, line: i + 1, text: text.trim() });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`lint failed: ${violations.length} forbidden legacy reference(s)`);
  for (const item of violations.slice(0, 50)) {
    console.error(`  [${item.id}] ${item.file}:${item.line}  ${item.text}`);
  }
  if (violations.length > 50) {
    console.error(`  ... and ${violations.length - 50} more`);
  }
  process.exit(1);
}

console.log(`lint ok: scanned ${files.length} production source files, no forbidden legacy REST/module refs`);
