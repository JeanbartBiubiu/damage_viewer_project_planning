/** Formula node helpers. Not used by independent arithmetic verifier. */

export const P = (parameterKey) => ({ nodeType: "PARAMETER", parameterKey });
export const A = (attributeOwner, attributeKey, attributeValueKind) => ({
  nodeType: "ATTRIBUTE",
  attributeOwner,
  attributeKey,
  attributeValueKind,
});
export const Op = (operation, operands) => ({
  nodeType: "OPERATION",
  operation,
  operands,
});
export const ADD = (...ops) => Op("ADD", ops);
export const SUB = (a, b) => Op("SUBTRACT", [a, b]);
export const MUL = (...ops) => Op("MULTIPLY", ops);
export const DIV = (a, b) => Op("DIVIDE", [a, b]);

export function param(parameterKey, name, spec) {
  return {
    parameterKey,
    name,
    valueType: spec.valueType,
    valueMode: spec.valueMode,
    fixedValue: spec.fixedValue ?? null,
    levelValues: spec.levelValues ?? null,
    description: spec.description,
    sortOrder: spec.sortOrder,
  };
}

export function formula(formulaKey, name, expression, description, sortOrder) {
  return { formulaKey, name, expression, description, sortOrder };
}

export function lv(values) {
  const out = {};
  values.forEach((v, i) => {
    out[String(i + 1)] = v;
  });
  return out;
}

export const SRC_AD_TOTAL = A("SOURCE", "attack_damage", "TOTAL");
export const SRC_AD_BONUS = A("SOURCE", "attack_damage", "BONUS");
export const SRC_AP = A("SOURCE", "ability_power", "TOTAL");
export const TGT_HP_TOTAL = A("TARGET", "hp", "TOTAL");
export const TGT_HP_MISSING = A("TARGET", "hp", "MISSING");
