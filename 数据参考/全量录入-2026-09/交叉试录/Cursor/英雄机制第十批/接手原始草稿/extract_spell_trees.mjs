/**
 * Extract bound spell trees and existing compositions. Read-only on 参考资料.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const REF = path.join(ROOT, "参考资料");
const OUT = __dirname;

function simplifyPart(obj) {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(simplifyPart);
  if (typeof obj !== "object") return obj;
  const t = obj.__type;
  const out = t ? { __type: t } : {};
  const keep = new Set([
    "mFormulaParts",
    "mSubparts",
    "mSubpart",
    "mPart1",
    "mPart2",
    "mMultiplier",
    "mModifiedGameCalculation",
    "mDataValue",
    "mStat",
    "mStatFormula",
    "mCoefficient",
    "mNumber",
    "values",
    "name",
    "mLevel1Value",
    "mBreakpoints",
    "mInitialBonusPerLevel",
    "mDisplayAsPercent",
    "mSimpleTooltipCalculationDisplay",
    "tooltipOnly",
    "mRatio",
    "mEndRatio",
    "DamageType",
    "ResultModifier",
  ]);
  for (const [k, v] of Object.entries(obj)) {
    if (k === "__type") continue;
    if (keep.has(k)) {
      out[k] = simplifyPart(v);
    } else if (v && typeof v === "object") {
      if (!Array.isArray(v) && (v.__type || v.mFormulaParts)) out[k] = simplifyPart(v);
      else if (Array.isArray(v) && v[0] && typeof v[0] === "object" && v[0].__type) {
        out[k] = simplifyPart(v);
      }
    }
  }
  return out;
}

function extractSpell(sp) {
  const obj = sp.object || {};
  const spell = obj.mSpell || {};
  const dvs = (spell.DataValues || []).map((dv) => ({ name: dv.name, values: dv.values }));
  const calcs = {};
  for (const [name, calc] of Object.entries(spell.mSpellCalculations || {})) {
    calcs[name] = simplifyPart(calc);
  }
  const fields = {};
  const interesting = [
    "cooldownTime",
    "mCooldown",
    "mana",
    "mMana",
    "mAmmoCount",
    "mMaxAmmo",
    "ammoRechargeTime",
    "castRange",
    "castRangeDisplayOverride",
    "mCastRange",
  ];
  for (const key of interesting) {
    if (key in spell) fields[key] = spell[key];
  }
  for (const [key, val] of Object.entries(spell)) {
    const lk = String(key).toLowerCase();
    if (["cooldown", "mana", "ammo", "cost", "castrange"].some((s) => lk.includes(s))) {
      if (!(key in fields) && key !== "mSpellCalculations" && key !== "DataValues" && key !== "mClientData" && key !== "mImgIconName") {
        fields[key] = val;
      }
    }
  }
  return {
    slot: sp.slot,
    skillKey: sp.skillKey,
    binding: sp.binding,
    name: sp.name,
    maxrank: sp.maxrank,
    officialCooldown: sp.officialCooldown,
    officialCost: sp.officialCost,
    officialResource: sp.officialResource,
    officialDescription: sp.officialDescription,
    dataValues: dvs,
    calculations: calcs,
    spellFields: fields,
    objectPath: obj.objectPath,
    objectName: obj.ObjectName || obj.mScriptName,
  };
}

function main() {
  const bind = JSON.parse(fs.readFileSync(path.join(REF, "根绑定与数值证据.json"), "utf8"));
  const present = JSON.parse(fs.readFileSync(path.join(REF, "写前现值.json"), "utf8"));
  const skills = {};
  const heroMeta = {};
  for (const hero of bind.heroes) {
    const root = hero.rootObject || {};
    heroMeta[hero.id] = {
      id: hero.id,
      chineseName: hero.chineseName,
      rootPath: hero.rootPath,
      clientSha256: (hero.client || {}).sha256,
      clientCompressedSha256: (hero.client || {}).compressedSha256,
      officialSha256: (hero.official || {}).sha256,
      critDamageMultiplier: root.critDamageMultiplier,
      baseDamage: (root.baseDamageModifiable || {}).baseValue,
      attackRange: (root.attackRangeModifiable || {}).baseValue,
      passive: root.mCharacterPassiveSpell,
      spells: root.spells,
    };
    for (const sp of hero.spells || []) {
      skills[sp.skillKey] = extractSpell(sp);
      skills[sp.skillKey].hero = hero.id;
    }
  }

  const existing = {};
  for (const [sk, rec] of Object.entries(present.skills || {})) {
    const comps = rec.components || {};
    const params = ((comps.parameters || {}).items || []).map((item) => ({
      parameterKey: item.parameterKey,
      name: item.name,
      valueType: item.valueType,
      valueMode: item.valueMode,
      fixedValue: item.fixedValue,
      levelValues: item.levelValues,
      description: item.description,
      sortOrder: item.sortOrder,
    }));
    existing[sk] = {
      subject: (rec.subject || {}).data,
      parameters: params,
      formulaCount: ((comps.formulas || {}).items || []).length,
      effectCount: ((comps.effects || {}).items || []).length,
      processCount: ((comps.processes || {}).items || []).length,
      stateCount: ((comps.internalStates || {}).items || []).length,
      ruleCount: ((comps.triggerRules || {}).items || []).length,
    };
  }

  const attrs = ((((present.catalogs || {}).attributes || {}).data || {}).items || []).map((it) => it.attributeKey);

  const payload = {
    heroMeta,
    existing,
    attributes: attrs,
    skills,
    bindGeneratedAt: bind.generatedAt,
    bindNote: bind.note,
    sourceFiles: JSON.parse(fs.readFileSync(path.join(REF, "输入摘要.json"), "utf8")),
  };
  const outPath = path.join(OUT, "_extracted_trees.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log("wrote", outPath);
  for (const [sk, ex] of Object.entries(existing)) {
    const keys = ex.parameters.map((p) => p.parameterKey);
    console.log(sk, "params", keys.join(",") || "(none)");
  }
}

main();
