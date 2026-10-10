import { pathToFileURL } from 'node:url';
import type { DamageModifierScenario } from '../../src/engine/damageModifierAdapter';

const builderUrl = process.env.FORMULA_PHASE5_INPUT_BUILDER_PATH
  ? pathToFileURL(process.env.FORMULA_PHASE5_INPUT_BUILDER_PATH).href
  : new URL('../../../wasm/tinygo_engine_v2/scripts/formula-phase5-input.mjs', import.meta.url).href;
const builder = await import(/* @vite-ignore */ builderUrl);
export const createDamageEventInput = builder.createDamageEventInput as (options?: {
  mixed?: boolean; overflow?: boolean; sameType?: boolean; declared?: boolean;
}) => DamageModifierScenario;
