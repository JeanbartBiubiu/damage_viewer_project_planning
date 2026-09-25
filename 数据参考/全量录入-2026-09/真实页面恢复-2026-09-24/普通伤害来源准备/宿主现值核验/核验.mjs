import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const batch = dirname(here);
const webRoot = 'C:/project/damage_web_dev/web';
const sourcePath = join(batch, '01-普通物理魔法真实伤害实际来源.json');
const sourceBytes = readFileSync(sourcePath);
const source = JSON.parse(sourceBytes.toString('utf8'));
const base = 'http://localhost:8080/api/admin/games/lol';
const categoryKeys = ['basic_attack', 'common', 'ultimate'];
const selected = [
  { skillKey: 'shared_basic_attack', ruleKey: 'on_attack_hit', skillLevel: 1, characterLevel: 1 },
  { skillKey: 'annie_q', ruleKey: 'actual_hit', skillLevel: 1, characterLevel: 1 },
  { skillKey: 'garen_r', ruleKey: 'on_hit', skillLevel: 1, characterLevel: 6 }
];

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function get(route) {
  const response = await fetch(base + route, { headers: { Accept: 'application/json' } });
  const body = await response.text();
  if (!response.ok) throw new Error(`GET ${route} HTTP ${response.status}: ${body.slice(0, 400)}`);
  return { route, status: response.status, data: JSON.parse(body) };
}

function snapshotValue(route) {
  const value = source.values[route];
  if (value === undefined) throw new Error(`快照缺少 ${route}`);
  return structuredClone(value);
}

function selectedAuthored(row, vampRules, categories) {
  const root = `/skills/${row.skillKey}`;
  const skill = snapshotValue(root);
  for (const key of skill.skillCategoryKeys) {
    const category = categories.find((item) => item.data.skillCategoryKey === key);
    if (!category || category.data.status !== 'ENABLED') {
      throw new Error(`技能分类 ${key} 缺失或未启用`);
    }
  }
  const parameterKeys = snapshotValue(`${root}/parameters`).map((item) => item.parameterKey);
  const formulaKeys = snapshotValue(`${root}/formulas`).map((item) => item.formulaKey);
  const effectKeys = snapshotValue(`${root}/effects`).map((item) => item.effectKey);
  const rule = snapshotValue(`${root}/trigger-rules/${row.ruleKey}`);
  const effects = effectKeys.map((key) => snapshotValue(`${root}/effects/${key}`));
  for (const action of rule.actions) {
    if (action.actionType !== 'EXECUTE_EFFECT') continue;
    if (!effects.some((effect) => effect.effectKey === action.detail.effectKey)) {
      throw new Error(`所选规则引用的效果 ${action.detail.effectKey} 缺失`);
    }
  }
  return {
    gameId: skill.gameId, skillKey: row.skillKey,
    skillLevel: row.skillLevel, characterLevel: row.characterLevel,
    rules: [rule], effects,
    parameters: parameterKeys.map((key) => snapshotValue(`${root}/parameters/${key}`)),
    formulas: formulaKeys.map((key) => snapshotValue(`${root}/formulas/${key}`)),
    statuses: [], modifierZones: [],
    identity: {
      source: { category: 'CHAMPION', hostility: 'SELF' },
      target: { category: 'CHAMPION', hostility: 'ENEMY' }
    },
    skillCategoryKeys: [...skill.skillCategoryKeys],
    vampRules: structuredClone(vampRules)
  };
}

function attempt(adaptHitProgram, authored) {
  try {
    return { ok: true, output: adaptHitProgram(authored) };
  } catch (error) {
    return {
      ok: false,
      error: {
        name: error?.name ?? typeof error,
        path: error?.path ?? null,
        message: error?.message ?? String(error)
      }
    };
  }
}

const vitePath = join(webRoot, 'node_modules/vite/dist/node/index.js');
const { createServer } = await import(pathToFileURL(vitePath).href);
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { adaptHitProgram } = await server.ssrLoadModule('/src/engine/hitAdapter.ts');
  const catalog = await Promise.all([
    get('/vamp-rules'),
    ...categoryKeys.map((key) => get(`/skill-categories/${key}`))
  ]);
  const [vamp, ...categories] = catalog;
  const results = [];
  for (const row of selected) {
    const authored = selectedAuthored(row, vamp.data.rules, categories);
    const actual = attempt(adaptHitProgram, authored);
    const effects = authored.effects.map((effect) => ({
      effectKey: effect.effectKey,
      results: effect.results.map((result) => ({
        resultKey: result.resultKey, resultType: result.resultType,
        sortOrder: result.sortOrder, criticalMode: result.detail?.critical?.mode ?? null
      }))
    }));
    const entry = {
      skillKey: row.skillKey, selectedRuleKey: row.ruleKey,
      scenario: {
        skillLevel: row.skillLevel, characterLevel: row.characterLevel,
        source: authored.identity.source, target: authored.identity.target
      },
      skillCategoryKeys: authored.skillCategoryKeys,
      selectedRule: authored.rules[0],
      allEffectsPreserved: effects,
      parameterKeys: authored.parameters.map((item) => item.parameterKey),
      formulaKeys: authored.formulas.map((item) => item.formulaKey),
      actual
    };
    if (row.skillKey === 'shared_basic_attack') {
      const probe = structuredClone(authored);
      const hit = probe.effects.find((effect) => effect.effectKey === 'attack_hit');
      const link = hit?.results.find((result) => result.resultKey === 'hit_link');
      if (!hit || !link || hit.results.length !== 2) throw new Error('共享普攻并列结果不完整');
      const before = hit.results.map((item) => [item.resultKey, item.sortOrder, item.detail?.critical?.mode ?? null]);
      link.sortOrder = 0;
      entry.diagnosticOrderProbe = {
        explanation: '仅在内存副本中把并列 hit_link 排在伤害之前；未删结果、未改暴击策略或数值，不代表原作者顺序。',
        before, after: hit.results.map((item) => [item.resultKey, item.sortOrder, item.detail?.critical?.mode ?? null]),
        result: attempt(adaptHitProgram, probe)
      };
    }
    results.push(entry);
  }
  const afterSha = sha(readFileSync(sourcePath));
  const output = {
    at: new Date().toISOString(),
    sourceSnapshot: { path: sourcePath, sha256Before: sha(sourceBytes), sha256After: afterSha },
    method: '当前工作树 hitAdapter.ts 经 Vite 服务器端模块加载；游戏目录无凭据 GET；只选明确命中规则，效果详情全量保留。',
    catalog,
    results
  };
  if (output.sourceSnapshot.sha256Before !== afterSha) throw new Error('原始快照发生变化');
  writeFileSync(join(here, '适配结果.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({
    catalog: catalog.map((item) => [item.route, item.status]),
    results: results.map((item) => ({
      skillKey: item.skillKey, ok: item.actual.ok,
      error: item.actual.error ?? null,
      candidates: item.actual.output?.skillHit.candidates.length ?? null,
      diagnosticError: item.diagnosticOrderProbe?.result.error ?? null
    })),
    snapshotUnchanged: true
  }, null, 2));
} finally {
  await server.close();
}
