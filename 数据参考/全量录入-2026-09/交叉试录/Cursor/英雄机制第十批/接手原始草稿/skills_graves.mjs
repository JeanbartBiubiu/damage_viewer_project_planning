import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  P,
  ADD,
  SUB,
  MUL,
  DIV,
  param,
  formula,
  lv,
  SRC_AD_TOTAL,
  SRC_AD_BONUS,
  SRC_AP,
  TGT_HP_TOTAL,
  TGT_HP_MISSING,
} from "./formula_nodes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REF = path.resolve(__dirname, "..", "参考资料");
const OUT = __dirname;

const SOURCE_FILES = JSON.parse(fs.readFileSync(path.join(REF, "输入摘要.json"), "utf8"));
const PRESENT = JSON.parse(fs.readFileSync(path.join(REF, "写前现值.json"), "utf8"));
const BIND = JSON.parse(fs.readFileSync(path.join(REF, "根绑定与数值证据.json"), "utf8"));

const CLIENT_VER = "16.17.8104348";
const OFFICIAL_VER = "16.17.1";
const STAT_NOTE =
  "静态来源推断：UseNewStats缺省false、OutputType缺省0时，mStat缺省0为法强，mStat2且mStatFormula缺省0为总攻击力，显式mStat2/mStatFormula2为额外攻击力。";

function heroOf(id) {
  return BIND.heroes.find((h) => h.id === id);
}

function existingParams(skillKey) {
  const rec = PRESENT.skills[skillKey];
  return ((rec.components.parameters.items) || []).map((p) => ({
    parameterKey: p.parameterKey,
    name: p.name,
    valueType: p.valueType,
    valueMode: p.valueMode,
    fixedValue: p.fixedValue,
    levelValues: p.levelValues,
    description: p.description,
    sortOrder: p.sortOrder,
  }));
}

function srcEv(heroId, skillKey, binding, extra) {
  const h = heroOf(heroId);
  return {
    hero: heroId,
    clientVersion: CLIENT_VER,
    officialVersion: OFFICIAL_VER,
    rootPath: h.rootPath,
    binding,
    clientSha256: h.client.sha256,
    officialSha256: h.official.sha256,
    chineseKeysFileSha256: SOURCE_FILES.find((x) => x.name === "补充文本证据.json").sha256,
    bindFileSha256: SOURCE_FILES.find((x) => x.name === "根绑定与数值证据.json").sha256,
    presentFileSha256: SOURCE_FILES.find((x) => x.name === "写前现值.json").sha256,
    skillKey,
    ...extra,
  };
}

const emptyWriteRest = {
  effects: [],
  processes: [],
  internalStates: [],
  triggerRules: [],
};

const qualDamageOnly = {
  damageEffect: "仅存伤害公式；归属/暴击/吸血/护盾资格均未在本批根绑定证明，不造 DAMAGE 效果。",
  triggers: "无过程、无触发规则；条件收益不得接无条件初始化。",
  writeReady: "参数与有来源公式可审查；不声称已保存或战斗通过。",
};

function sliceProof(raw, offset, count, why) {
  return {
    raw,
    offset,
    values: raw.slice(offset, offset + count),
    why,
  };
}

const IDX1_MAXRANK =
  "技能等级数组与同对象 cooldownTime 一致：官方DDragon等级1=客户端索引1；values[0]为未用槽（可为负/0/残留），R的索引4起不是额外技能等级。";

function graves() {
  const g = heroOf("Graves");
  const out = [];

  out.push({
    skillKey: "graves_p",
    sourceEvidence: srcEv("Graves", "graves_p", "Characters/Graves/Spells/GravesPassiveAbility/GravesPassive", {
      calculations: ["SingleBulletDamage", "MultiBulletDamage", "CritDamageMult"],
      chineseKeys: ["spell_gravespassive_name", "spell_gravespassive_summary", "spell_gravespassive_tooltip"],
      characterRoot: { critDamageMultiplier: g.rootObject.critDamageMultiplier, secondaryAmmoBase: 2 },
    }),
    write: {
      parameters: [
        param("single_bullet_ad_ratio", "单颗弹丸总攻击力系数（等级曲线待核输入）", {
          valueType: "DECIMAL",
          valueMode: "RUNTIME_INPUT",
          sortOrder: 10,
          description:
            "SingleBulletDamage=StatBySubPart(mStat=2缺省formula0=总AD)×ByCharLevelFormulaCalculationPart。31点表原文保留在核对文件；求值算法未证，不按角色等级自动取下标，只在外部已核系数时计算。",
        }),
        param("subsequent_pellet_ratio", "后续弹丸相对首弹系数", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 0.3330000042915344,
          sortOrder: 20,
          description: "MultiBulletDamage 为 GameCalculationModified，mMultiplier.mNumber=0.3330000042915344，修改 SingleBulletDamage。",
        }),
        param("subsequent_pellet_count_normal", "非暴击后续弹丸数（同一英雄）", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 3,
          sortOrder: 30,
          description: "当前绑定中文与官方说明每次攻击发射4颗弹丸；同一英雄首弹+3颗后续。不是 DataValues 字段。",
        }),
        param("pellet_count_normal", "非暴击弹丸数", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 4,
          sortOrder: 40,
          description: "当前绑定中文 Spell_GravesPassive_Tooltip 与官方说明：每次攻击发射4颗弹丸。",
        }),
        param("pellet_count_crit", "暴击弹丸数", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 6,
          sortOrder: 50,
          description: "当前绑定中文：暴击将弹丸数量提升至6颗。",
        }),
        param("ammo_max", "霰弹枪弹药上限", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 2,
          sortOrder: 60,
          description: "角色根 secondaryAbilityResource.arDisplayAsPips 且 {726ee5cd}.baseValue=2；当前绑定中文明确只有2颗子弹。",
        }),
        param("crit_damage_ratio", "暴击弹丸增幅具名系数", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 0.5,
          sortOrder: 70,
          description: "DataValues.CritDamageRatio 七槽全为0.5，取索引1。CritDamageMult 另乘 (mStat9−1)，mStat9未证。",
        }),
        param("character_root_crit_multiplier", "角色根明确暴击倍率", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 2,
          sortOrder: 80,
          description: "Characters/Graves/CharacterRecords/Root.critDamageMultiplier=2。只保存该明确数值，不把 mStat9 映射为属性。",
        }),
        param("one", "暴击倍率减一用基准值", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 1,
          sortOrder: 90,
          description: "供 暴击倍率−1 使用。",
        }),
      ],
      formulas: [
        formula(
          "single_bullet_damage",
          "同一英雄首颗弹丸物理伤害",
          MUL(SRC_AD_TOTAL, P("single_bullet_ad_ratio")),
          "总攻击力×外部已核等级系数。ByCharLevelFormula 算法未证。" + STAT_NOTE,
          10
        ),
        formula(
          "multi_bullet_damage",
          "同一英雄后续弹丸物理伤害",
          MUL(P("subsequent_pellet_ratio"), MUL(SRC_AD_TOTAL, P("single_bullet_ad_ratio"))),
          "0.3330000042915344×首弹。子算式内联，不引用其他公式键。",
          20
        ),
        formula(
          "four_pellet_same_hero_damage",
          "非暴击四弹全中同一英雄物理伤害",
          ADD(
            MUL(SRC_AD_TOTAL, P("single_bullet_ad_ratio")),
            MUL(P("subsequent_pellet_count_normal"), MUL(P("subsequent_pellet_ratio"), MUL(SRC_AD_TOTAL, P("single_bullet_ad_ratio"))))
          ),
          "首弹+3×后续弹。暴击6弹及每弹CritDamageMult因 mStat9 未证不写入。",
          30
        ),
        formula(
          "crit_pellet_increase_root_default",
          "根暴击倍率下的弹丸增幅",
          MUL(P("crit_damage_ratio"), SUB(P("character_root_crit_multiplier"), P("one"))),
          "0.5×(2−1)=0.5。只使用角色根明确倍率2，不含装备额外暴击伤害；活体 mStat9 待证。",
          40
        ),
      ],
      ...emptyWriteRest,
    },
    preserve: [],
    excluded: [
      { item: "StructureDamageReduction=0.25", reason: "对建筑减伤，非1V1英雄伤害。" },
      { item: "击退非英雄", reason: "非英雄单位击退排除。" },
      { item: "CritDamageMult 活体 mStat9", reason: "mStat9 不在本批已证枚举，不映射属性。" },
    ],
    pending: [
      { gap: "来源缺口", detail: "ByCharLevelFormulaCalculationPart 31点表求值算法未证，不能按等级下标取值。" },
      { gap: "来源缺口", detail: "mStat9 暴击倍率活体读取未证。" },
      { gap: "系统缺口", detail: "弹药消耗、装弹、弹丸命中过滤无触发与过程模型。" },
      { gap: "未接线", detail: "散弹命中与暴击改弹数尚未接效果/过程。" },
    ],
    qualification: qualDamageOnly,
    proofs: [
      { key: "CritDamageRatio", ...sliceProof([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 1, 1, "七槽恒等，取索引1。") },
      {
        key: "SingleBulletDamage.values",
        rawLength: 31,
        index0: 0,
        index1: 0.7000017762184143,
        index18: 1.000051736831665,
        why: "完整表保留，不按角色等级求值。",
      },
    ],
  });

  out.push({
    skillKey: "graves_q",
    sourceEvidence: srcEv("Graves", "graves_q", "Characters/Graves/Spells/GravesQLineSpellAbility/GravesQLineSpell", {
      calculations: ["TotalDamage", "TotalDetonationDamage"],
      chineseKeys: ["spell_gravesqlinespell_name", "spell_gravesqlinespell_summary", "spell_gravesqlinespell_tooltip"],
    }),
    write: {
      parameters: [
        param("base_damage", "火药卷基础物理伤害", {
          valueType: "INTEGER",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([50, 75, 100, 125, 150]),
          sortOrder: 10,
          description: "DataValues.BaseDamage 原始[25,50,75,100,125,150,175]。" + IDX1_MAXRANK + "取索引1至5。",
        }),
        param("bonus_ad_ratio", "火药卷额外攻击力系数", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 0.550000011920929,
          sortOrder: 20,
          description: "DataValues.FirstADRatio 七槽恒等0.550000011920929；计算树 StatByNamedDataValue mStat=2 mStatFormula=2。",
        }),
        param("detonation_base_damage", "引爆基础物理伤害", {
          valueType: "INTEGER",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([80, 125, 170, 215, 260]),
          sortOrder: 30,
          description: "DataValues.BaseDetonationDamage 原始[35,80,125,170,215,260,305]。" + IDX1_MAXRANK + "取索引1至5。",
        }),
        param("detonation_bonus_ad_ratio", "引爆额外攻击力系数", {
          valueType: "DECIMAL",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([0.44999998807907104, 0.6000000238418579, 0.75, 0.8999999761581421, 1.0499999523162842]),
          sortOrder: 40,
          description: "DataValues.bADDetonationRatio 原始[0.3,0.45,0.6,0.75,0.9,1.05,1.2]。" + IDX1_MAXRANK + "取索引1至5；mStat=2 mStatFormula=2。",
        }),
      ],
      formulas: [
        formula(
          "total_damage",
          "火药卷物理伤害",
          ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), SRC_AD_BONUS)),
          "BaseDamage+FirstADRatio×额外AD。同一英雄可再吃引爆，不把两段合成一段。" + STAT_NOTE,
          10
        ),
        formula(
          "total_detonation_damage",
          "引爆物理伤害",
          ADD(P("detonation_base_damage"), MUL(P("detonation_bonus_ad_ratio"), SRC_AD_BONUS)),
          "BaseDetonationDamage+bADDetonationRatio×额外AD。" + STAT_NOTE,
          20
        ),
      ],
      ...emptyWriteRest,
    },
    preserve: existingParams("graves_q"),
    excluded: [{ item: "TerrainCollisionDelay=0.2", reason: "地形碰撞几何，不改对英雄伤害公式。" }],
    pending: [
      { gap: "来源缺口", detail: "绑定中文“1秒后引爆”未出现在 DataValues，不把1秒写成客户端数组。" },
      { gap: "系统缺口", detail: "两段伤害时点、地形立即引爆无过程。" },
      { gap: "未接线", detail: "冷却/法力已存，不重建；伤害公式尚未接效果。" },
    ],
    qualification: qualDamageOnly,
    proofs: [
      { key: "BaseDamage", ...sliceProof([25, 50, 75, 100, 125, 150, 175], 1, 5, IDX1_MAXRANK) },
      { key: "FirstADRatio", ...sliceProof([0.550000011920929, 0.550000011920929, 0.550000011920929, 0.550000011920929, 0.550000011920929, 0.550000011920929, 0.550000011920929], 1, 1, "恒等") },
      { key: "cooldownTime", official: [13, 11.25, 9.5, 7.75, 6], clientIndex1to5: [13, 11.25, 9.5, 7.75, 6], preserved: true },
    ],
  });

  out.push({
    skillKey: "graves_w",
    sourceEvidence: srcEv("Graves", "graves_w", "Characters/Graves/Spells/GravesSmokeGrenadeAbility/GravesSmokeGrenade", {
      calculations: ["ImpactDamage"],
      chineseKeys: ["spell_gravessmokegrenade_name", "spell_gravessmokegrenade_summary", "spell_gravessmokegrenade_tooltip"],
    }),
    write: {
      parameters: [
        param("base_damage", "初始冲击基础魔法伤害", {
          valueType: "INTEGER",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([60, 110, 160, 210, 260]),
          sortOrder: 10,
          description: "DataValues.BaseDamage 原始[10,60,110,160,210,260,310]。" + IDX1_MAXRANK,
        }),
        param("ap_ratio", "初始冲击法强系数", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 0.6000000238418579,
          sortOrder: 20,
          description: "ImpactDamage 第二段 StatByCoefficient 仅 mCoefficient=0.6000000238418579，mStat缺省0=法强。",
        }),
        param("slow_amount_percent_points", "烟幕减速百分比点数", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 50,
          sortOrder: 30,
          description: "DataValues.SlowAmount 七槽为50；工具提示 @SlowAmount@%。原值50，换算比例0.5。",
        }),
        param("slow_duration_s", "初始冲击减速时间（秒）", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 0.5,
          sortOrder: 40,
          description: "DataValues.SlowDuration 七槽为0.5。",
        }),
      ],
      formulas: [
        formula(
          "impact_damage",
          "初始冲击魔法伤害",
          ADD(P("base_damage"), MUL(P("ap_ratio"), SRC_AP)),
          "BaseDamage+0.6×法强。" + STAT_NOTE,
          10
        ),
      ],
      ...emptyWriteRest,
    },
    preserve: existingParams("graves_w"),
    excluded: [
      { item: "烟幕视野遮挡", reason: "纯视野排除。" },
      { item: "SmokeRadius", reason: "范围几何，不改变单目标冲击伤害公式。" },
    ],
    pending: [
      { gap: "系统缺口", detail: "烟幕持续减速是否等于 SlowDuration 或覆盖整段 SmokeDuration=4 未由计算树证明。" },
      { gap: "未接线", detail: "减速无效果对象；伤害资格不足不造 DAMAGE。" },
    ],
    qualification: qualDamageOnly,
    proofs: [{ key: "BaseDamage", ...sliceProof([10, 60, 110, 160, 210, 260, 310], 1, 5, IDX1_MAXRANK) }],
  });

  out.push({
    skillKey: "graves_e",
    sourceEvidence: srcEv("Graves", "graves_e", "Characters/Graves/Spells/GravesMoveAbility/GravesMove", {
      calculations: ["MRGrant"],
      chineseKeys: ["spell_gravesmove_name", "spell_gravesmove_summary", "spell_gravesmove_tooltip"],
    }),
    write: {
      parameters: [
        param("armor_per_stack", "每层护甲", {
          valueType: "INTEGER",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([7, 10, 13, 16, 19]),
          sortOrder: 10,
          description: "DataValues.ArmorPerStack 原始[4,7,10,13,16,19,22]。" + IDX1_MAXRANK,
        }),
        param("mr_grant_percent", "魔抗相对护甲比例", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 0.5,
          sortOrder: 20,
          description: "DataValues.MRGrantPercent=0.5；MRGrant=ArmorPerStack×该比例。",
        }),
        param("buff_duration_s", "纯爷们持续时间（秒）", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 4,
          sortOrder: 30,
          description: "DataValues.BuffDuration 七槽为4。",
        }),
        param("max_stacks", "纯爷们最大层数", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 8,
          sortOrder: 40,
          description: "DataValues.MaxStacks 七槽为8。",
        }),
        param("cooldown_reduction_per_pellet_s", "每颗弹丸命中缩短冷却（秒）", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 0.5,
          sortOrder: 50,
          description: "DataValues.CooldownPerHit=0.5；绑定中文：攻击每有一颗弹丸命中敌人缩短该冷却。",
        }),
        param("dash_toward_enemy_bonus_stacks", "朝敌人突进额外层数", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 2,
          sortOrder: 60,
          description: "当前绑定中文：朝着敌人突进时获得2层。不是位移几何本身。",
        }),
      ],
      formulas: [
        formula(
          "mr_per_stack",
          "每层魔法抗性",
          MUL(P("mr_grant_percent"), P("armor_per_stack")),
          "ArmorPerStack×0.5。层数是整数进度，不默认满层。",
          10
        ),
      ],
      ...emptyWriteRest,
    },
    preserve: existingParams("graves_e"),
    excluded: [
      { item: "DashSpeed/DashMaxDistance/DashMinDistance/DashAngle", reason: "位移几何排除。" },
    ],
    pending: [
      { gap: "系统缺口", detail: "层数刷新、朝英雄双层、弹丸缩CD 无触发。" },
      { gap: "未接线", detail: "护甲/魔抗公式未接效果；不能无条件初始化满层。" },
    ],
    qualification: { ...qualDamageOnly, damageEffect: "本槽无伤害公式；只有每层魔抗派生。" },
    proofs: [{ key: "ArmorPerStack", ...sliceProof([4, 7, 10, 13, 16, 19, 22], 1, 5, IDX1_MAXRANK) }],
  });

  out.push({
    skillKey: "graves_r",
    sourceEvidence: srcEv("Graves", "graves_r", "Characters/Graves/Spells/GravesChargeShotAbility/GravesChargeShot", {
      calculations: ["Damage", "FalloffDamage"],
      chineseKeys: ["spell_graveschargeshot_name", "spell_graveschargeshot_summary", "spell_graveschargeshot_tooltip"],
    }),
    write: {
      parameters: [
        param("base_damage", "爆破弹基础物理伤害", {
          valueType: "INTEGER",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([275, 425, 575]),
          sortOrder: 10,
          description: "DataValues.RBaseDamage 原始[125,275,425,575,725,875,1025]。最大等级3，取索引1至3，不用索引4起。",
        }),
        param("bonus_ad_ratio", "爆破弹额外攻击力系数", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 1.5,
          sortOrder: 20,
          description: "Damage 第二段 StatByCoefficient mStat=2 mStatFormula=2 mCoefficient=1.5。",
        }),
        param("falloff_base_damage", "爆裂基础物理伤害", {
          valueType: "INTEGER",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([200, 320, 440]),
          sortOrder: 30,
          description: "DataValues.RFalloffDamage 原始[80,200,320,440,560,680,800]。取索引1至3。",
        }),
        param("falloff_bonus_ad_ratio", "爆裂额外攻击力系数", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 1.2000000476837158,
          sortOrder: 40,
          description: "FalloffDamage StatByCoefficient mStat=2 mStatFormula=2 mCoefficient=1.2000000476837158。",
        }),
      ],
      formulas: [
        formula(
          "damage",
          "爆破弹第一敌人物理伤害",
          ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), SRC_AD_BONUS)),
          "RBaseDamage+1.5×额外AD。1V1取第一敌人。" + STAT_NOTE,
          10
        ),
        formula(
          "falloff_damage",
          "爆裂锥物理伤害",
          ADD(P("falloff_base_damage"), MUL(P("falloff_bonus_ad_ratio"), SRC_AD_BONUS)),
          "RFalloffDamage+1.2×额外AD。第一英雄是否再吃爆裂未证，两式独立保存。",
          20
        ),
      ],
      ...emptyWriteRest,
    },
    preserve: existingParams("graves_r"),
    excluded: [
      { item: "RKnockbackDistance=400", reason: "后坐力/击退位移几何。" },
      { item: "manaValues 索引3起的0", reason: "R只有3级，缺字段不补0；已存 mana_cost 固定100。" },
    ],
    pending: [
      { gap: "来源缺口", detail: "第一命中英雄是否叠加 FalloffDamage 无计算树证明。" },
      { gap: "未接线", detail: "两段伤害资格不足，不造 DAMAGE。" },
    ],
    qualification: qualDamageOnly,
    proofs: [
      { key: "RBaseDamage", ...sliceProof([125, 275, 425, 575, 725, 875, 1025], 1, 3, "maxrank=3") },
      { key: "mana", client: [100, 100, 100, 0, 0, 0], official: [100, 100, 100], preservedFixed: 100 },
    ],
  });

  return out;
}

export { heroOf, existingParams, srcEv, emptyWriteRest, qualDamageOnly, sliceProof, IDX1_MAXRANK, CLIENT_VER, OFFICIAL_VER, STAT_NOTE, SOURCE_FILES, PRESENT, BIND, REF, OUT, graves };
