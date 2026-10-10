import { pathToFileURL } from 'node:url';
import type { DamageModifierScenario } from '../../src/engine/damageModifierAdapter';

// 与原生共用从零构造的作者输入，加载入口不补公式、不读取旧固定样例。
const builderUrl = process.env.FORMULA_PHASE4_INPUT_BUILDER_PATH
  ? pathToFileURL(process.env.FORMULA_PHASE4_INPUT_BUILDER_PATH).href
  : new URL('../../../wasm/tinygo_engine_v2/scripts/formula-phase4-input.mjs', import.meta.url).href;
const builder = await import(/* @vite-ignore */ builderUrl);
export const createExplicitDamageInput = builder.createFormulaPhase4Input as () => DamageModifierScenario & {
  name: string; expectedSummarySubset: Record<string, number>;
};
