import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameConfiguration } from '../../.agents/skills/damage-api-authoring/scripts/apply-skill-plan.mjs';
import { validateCandidate, verifySourceEvidence } from './candidate.mjs';
import { makeClient } from './client.mjs';
import { digestJson, options, readJson, requireValue, writeNew } from './artifacts.mjs';

/** 独立回读已保存的完整配置和普通场景，复用冻结预期；不保存业务或重跑计算。 */
export async function collectSavedScenes(client, input, outputDirectory) {
  const candidate = validateCandidate(input), output = resolve(outputDirectory);
  mkdirSync(output);
  const baselinePath = `/internal/maintenance/games/${candidate.gameId}/baseline`;
  const before = (await client.request('GET', baselinePath)).data;
  const configurations = [];
  for (const item of candidate.skillPlan.items) {
    const actual = (await client.request('GET', `/api/admin/games/${candidate.gameId}/skills/${item.skillKey}/configuration`)).data;
    requireValue(sameConfiguration(actual, item.expected), '保存后完整配置与冻结预期不符；未生成成功场景计划。');
    configurations.push({ skillKey: item.skillKey, actual });
  }
  writeNew(resolve(output, 'configurations.json'), configurations);
  mkdirSync(resolve(output, 'snapshots'));
  const cases = [];
  for (const scene of candidate.scenes) {
    const selection = (scene.previewSnapshot ?? scene.snapshot).selection;
    const snapshot = (await client.request('POST', `/api/admin/games/${candidate.gameId}/simulation-snapshot`, JSON.stringify(selection))).data;
    requireValue(snapshot.gameId === candidate.gameId && digestJson(snapshot.selection) === digestJson(selection), '保存后普通快照的游戏或选择不符。');
    for (const item of candidate.skillPlan.items) {
      const actual = snapshot.skillConfigurations.find(row => row.skill.skillKey === item.skillKey);
      requireValue(!actual || sameConfiguration(actual, item.expected), '普通快照配置与本批完整预期不符。');
    }
    const snapshotFile = `snapshots/${scene.id}.json`;
    writeNew(resolve(output, snapshotFile), snapshot);
    cases.push({ id: scene.id, snapshotFile, ...scene.scenario });
  }
  const after = (await client.request('GET', baselinePath)).data;
  requireValue(before.baselineDigest === after.baselineDigest, '保存后场景读取期间游戏基线变化；未生成成功场景计划。');
  writeNew(resolve(output, 'expected-plan.json'), candidate.expectedPlan);
  writeNew(resolve(output, 'scenes.json'), { cases });
  const summary = { complete: true, candidateDigest: candidate.candidateDigest, baselineDigest: after.baselineDigest,
    configurations: configurations.map(row => ({ skillKey: row.skillKey, baseDigest: row.actual.baseDigest })), scenes: cases.length };
  writeNew(resolve(output, 'summary.json'), summary);
  return summary;
}

async function main(args) {
  if (!args.length || args[0] === '--help') {
    console.log('保存后普通场景采集；不写业务数据、不运行计算。\nnode tools/maintenance/collect-saved-scenes.mjs --candidate <冻结候选.json> --read-config <私密读取配置.json> --output <新目录>');
    return;
  }
  const opts = options(args, ['--candidate', '--read-config', '--output']);
  const candidatePath = resolve(opts['--candidate']), candidate = validateCandidate(readJson(candidatePath));
  verifySourceEvidence(candidate, dirname(candidatePath));
  const configPath = resolve(opts['--read-config']), client = makeClient(readJson(configPath), dirname(configPath));
  console.log(JSON.stringify(await collectSavedScenes(client, candidate, opts['--output'])));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => { console.error('保存后场景采集未完成；保留产物，未写业务或自动重试。'); process.exitCode = 1; });
}
