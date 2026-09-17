import {
  P,
  ADD,
  MUL,
  param,
  formula,
  lv,
  SRC_AD_TOTAL,
  SRC_AD_BONUS,
  SRC_AP,
  TGT_HP_MISSING,
} from "./formula_nodes.mjs";
import {
  existingParams,
  srcEv,
  emptyWriteRest,
  qualDamageOnly,
  sliceProof,
  IDX1_MAXRANK,
  STAT_NOTE,
} from "./skills_graves.mjs";

export function jinx() {
  const out = [];

  out.push({
    skillKey: "jinx_p",
    sourceEvidence: srcEv("Jinx", "jinx_p", "Characters/Jinx/Spells/JinxPassiveMarkerAbility/JinxPassiveMarker", {
      calculations: [],
      chineseKeys: [
        "spell_jinxpassivemarker_name",
        "spell_jinxpassivemarker_summary",
        "spell_jinxpassivemarker_tooltip",
        "spell_jinxpassivemarker_tooltipextended",
      ],
    }),
    write: {
      parameters: [
        param("buff_duration_s", "罪恶快感持续时间（秒）", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 6,
          sortOrder: 10,
          description: "DataValues.BuffDuration 七槽为6。",
        }),
        param("attack_speed_buff_percent_points", "攻击速度加成百分比点数", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 25,
          sortOrder: 20,
          description: "DataValues.ASBuff=25；工具提示 @ASBuff@%。原值25，换算比例0.25。参与击杀英雄可叠加，见 max_champion_kill_as_stacks。",
        }),
        param("move_speed_buff_percent_points", "移动速度加成百分比点数", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 175,
          sortOrder: 30,
          description: "DataValues.MSBuff=175；工具提示 @MSBuff@%。原值175，换算比例1.75。衰减算法未证。",
        }),
        param("ms_decay_rate", "移动速度衰减率具名值", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 0.875,
          sortOrder: 40,
          description: "DataValues.MSDecayRate=0.875。衰减如何按时间求值未证，只保存原值。",
        }),
        param("assist_marker_duration_s", "参与击杀标记窗口（秒）", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 3,
          sortOrder: 50,
          description: "DataValues.AssistMarkerDuration=3。",
        }),
        param("max_champion_kill_as_stacks", "参与击杀英雄攻速最大层数", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 5,
          sortOrder: 60,
          description: "当前绑定中文：参与击杀英雄使攻击速度叠加至多5次。不是 DataValues。",
        }),
      ],
      formulas: [],
      ...emptyWriteRest,
    },
    preserve: [],
    excluded: [{ item: "摧毁建筑物/史诗野怪触发的非战斗经济", reason: "纯金币经验排除；攻速移速数值因可改变1V1而保留。" }],
    pending: [
      { gap: "来源缺口", detail: "MSDecayRate 的时间函数未证，不均分6秒。" },
      { gap: "系统缺口", detail: "击杀参与、层数、突破攻速上限无触发。" },
      { gap: "未接线", detail: "无公式可接；不能把5层当默认输入。" },
    ],
    qualification: { ...qualDamageOnly, damageEffect: "无伤害。" },
    proofs: [{ key: "ASBuff", ...sliceProof([25, 25, 25, 25, 25, 25, 25], 1, 1, "恒等") }],
  });

  out.push({
    skillKey: "jinx_q",
    sourceEvidence: srcEv("Jinx", "jinx_q", "Characters/Jinx/Spells/JinxQAbility/JinxQ", {
      calculations: ["RocketDamage"],
      chineseKeys: ["spell_jinxq_name", "spell_jinxq_summary", "spell_jinxq_tooltip", "spell_jinxq_cost", "spell_jinxq_tooltipextendedbelowline"],
      flags: { mDoesNotConsumeMana: true, mCooldownNotAffectedByCDR: true },
    }),
    write: {
      parameters: [
        param("cooldown_ms", "武器切换基础冷却时间（毫秒）", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 900,
          sortOrder: 100,
          description:
            "当前技能写前无公共冷却。DDragon16.17.1 Jinx.spells[0].cooldown 全0.9；客户端 cooldownTime 七槽0.8999999761581421，索引1起一致。秒转毫秒取900。mCooldownNotAffectedByCDR=true。不是火箭攻击间隔。",
        }),
        param("rocket_mana_cost", "每发火箭法力消耗", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 20,
          sortOrder: 110,
          description:
            "官方资源“每发火箭{{ cost }}法力值”，cost全20；客户端 mana 六槽20。切换技能 mDoesNotConsumeMana=true，故不用公共 mana_cost 键。",
        }),
        param("rocket_total_ad_ratio", "火箭总攻击力系数", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 1.100000023841858,
          sortOrder: 10,
          description: "DataValues.RocketTAD 七槽1.100000023841858；RocketDamage=StatByNamedDataValue mStat=2 缺省formula0=总AD。",
        }),
        param("rocket_bonus_range", "火箭额外攻击距离", {
          valueType: "INTEGER",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([100, 125, 150, 175, 200]),
          sortOrder: 20,
          description: "DataValues.RocketBonusRange 原始[75,100,125,150,175,200,225]。" + IDX1_MAXRANK + "攻击距离改变1V1可打到的范围，保留。",
        }),
        param("rocket_as_penalty_ratio", "火箭所享攻速加成减少比例", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 0.10000000149011612,
          sortOrder: 30,
          description: "DataValues.RocketASPDPenalty=0.10000000149011612；工具提示 ×100 为10%。原值0.10，换算10个百分点。",
        }),
        param("minigun_attack_speed_max_percent_points", "轻机枪最大攻速加成百分比点数", {
          valueType: "INTEGER",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([30, 55, 80, 105, 130]),
          sortOrder: 40,
          description: "DataValues.MinigunAttackSpeedMax 原始[5,30,55,80,105,130,155]。" + IDX1_MAXRANK + "不把最大值除以层数。",
        }),
        param("minigun_attack_speed_duration_s", "轻机枪攻速层持续时间（秒）", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 2.5,
          sortOrder: 50,
          description: "DataValues.MinigunAttackSpeedDuration=2.5。",
        }),
        param("minigun_attack_speed_stacks", "轻机枪攻速最大层数", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 3,
          sortOrder: 60,
          description: "DataValues.MinigunAttackSpeedStacks=3。不默认满层。",
        }),
      ],
      formulas: [
        formula(
          "rocket_damage",
          "火箭对当前目标物理伤害",
          MUL(P("rocket_total_ad_ratio"), SRC_AD_TOTAL),
          "1.1×总攻击力。只保留对当前1V1目标；附近溅射排除。" + STAT_NOTE,
          10
        ),
      ],
      ...emptyWriteRest,
    },
    preserve: [],
    excluded: [
      { item: "RocketAoERadius=250", reason: "多目标溅射分发排除；主目标伤害已用总AD公式。" },
    ],
    pending: [
      { gap: "系统缺口", detail: "机枪/火箭切换状态、每发火箭扣蓝时点、攻速层衰减（中文：一次只消一层）无过程。" },
      { gap: "未接线", detail: "轻机枪仍是普通攻击，无独立伤害公式；不能把3层当默认。" },
    ],
    qualification: qualDamageOnly,
    proofs: [
      { key: "RocketTAD", ...sliceProof([1.100000023841858, 1.100000023841858, 1.100000023841858, 1.100000023841858, 1.100000023841858, 1.100000023841858, 1.100000023841858], 1, 1, "恒等") },
      { key: "MinigunAttackSpeedMax", ...sliceProof([5, 30, 55, 80, 105, 130, 155], 1, 5, IDX1_MAXRANK) },
      { key: "cooldownTime", official: [0.9, 0.9, 0.9, 0.9, 0.9], client: 0.8999999761581421, ms: 900 },
    ],
  });

  out.push({
    skillKey: "jinx_w",
    sourceEvidence: srcEv("Jinx", "jinx_w", "Characters/Jinx/Spells/JinxWAbility/JinxW", {
      calculations: ["TotalDamage"],
      chineseKeys: ["spell_jinxw_name", "spell_jinxw_summary", "spell_jinxw_tooltip", "spell_jinxw_tooltipextendedbelowline"],
    }),
    write: {
      parameters: [
        param("base_damage", "震荡波基础物理伤害", {
          valueType: "INTEGER",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([10, 60, 110, 160, 210]),
          sortOrder: 10,
          description: "DataValues.Damage 原始[-40,10,60,110,160,210,260]。索引0为负未用槽。" + IDX1_MAXRANK,
        }),
        param("total_ad_ratio", "震荡波总攻击力系数", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 1.399999976158142,
          sortOrder: 20,
          description: "DataValues.ADRatio 七槽1.399999976158142；StatByNamedDataValue mStat=2 缺省formula0=总AD。",
        }),
        param("slow_percent_points", "减速百分比点数", {
          valueType: "INTEGER",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([40, 50, 60, 70, 80]),
          sortOrder: 30,
          description: "DataValues.SlowPercent 原始[30,40,50,60,70,80,90]。" + IDX1_MAXRANK + "原值40表示40%，换算0.40。",
        }),
        param("slow_duration_s", "减速与显形时间（秒）", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 2,
          sortOrder: 40,
          description: "DataValues.SlowDuration=2。显形属视野，数值与减速共用此时长只作记录。",
        }),
      ],
      formulas: [
        formula(
          "total_damage",
          "震荡电磁波物理伤害",
          ADD(P("base_damage"), MUL(P("total_ad_ratio"), SRC_AD_TOTAL)),
          "Damage+1.4×总AD。命中第一个目标，1V1适用。" + STAT_NOTE,
          10
        ),
      ],
      ...emptyWriteRest,
    },
    preserve: existingParams("jinx_w"),
    excluded: [
      { item: "显形/侦测隐形", reason: "纯视野排除。" },
      { item: "JinxLowEndWCastTime / JinxWASpeedCastTimeScalarPerHundrethSecond", reason: "施放时间随攻速缩放算法未证，不推广。" },
    ],
    pending: [
      { gap: "来源缺口", detail: "攻速缩短施放时间的求值未证。" },
      { gap: "未接线", detail: "减速无效果对象。" },
    ],
    qualification: qualDamageOnly,
    proofs: [
      { key: "Damage", ...sliceProof([-40, 10, 60, 110, 160, 210, 260], 1, 5, "索引0=-40 未用槽") },
      { key: "cooldownTime", official: [8, 7, 6, 5, 4], clientIndex1to5: [8, 7, 6, 5, 4] },
    ],
  });

  out.push({
    skillKey: "jinx_e",
    sourceEvidence: srcEv("Jinx", "jinx_e", "Characters/Jinx/Spells/JinxEAbility/JinxE", {
      calculations: ["TotalDamage"],
      chineseKeys: ["spell_jinxe_name", "spell_jinxe_summary", "spell_jinxe_tooltip", "spell_jinxe_tooltipextendedbelowline"],
    }),
    write: {
      parameters: [
        param("cooldown_ms", "基础冷却时间（毫秒）", {
          valueType: "INTEGER",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([24000, 20500, 17000, 13500, 10000]),
          sortOrder: 100,
          description:
            "当前技能写前无公共冷却。DDragon16.17.1 Jinx.spells[2].cooldown=[24,20.5,17,13.5,10]；客户端 cooldownTime=[27.5,24,20.5,17,13.5,10,10] 索引1至5一致。秒转毫秒。",
        }),
        param("mana_cost", "基础法力消耗", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 90,
          sortOrder: 110,
          description: "当前技能写前无公共消耗。官方 cost 全90；客户端 mana 六槽90，索引0起一致。",
        }),
        param("base_damage", "手雷基础魔法伤害", {
          valueType: "INTEGER",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([90, 140, 190, 240, 290]),
          sortOrder: 10,
          description: "DataValues.Damage 原始[40,90,140,190,240,290,340]。" + IDX1_MAXRANK,
        }),
        param("ap_ratio", "手雷法强系数", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 1,
          sortOrder: 20,
          description: "TotalDamage 第二段 StatByCoefficient 仅 mCoefficient=1，mStat缺省0=法强。",
        }),
        param("root_duration_s", "禁锢时间（秒）", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 1.5,
          sortOrder: 30,
          description: "DataValues.RootDuration=1.5。",
        }),
        param("grenade_duration_s", "手雷存在时间（秒）", {
          valueType: "INTEGER",
          valueMode: "FIXED",
          fixedValue: 5,
          sortOrder: 40,
          description: "DataValues.GrenadeDuration=5。",
        }),
      ],
      formulas: [
        formula(
          "total_damage",
          "嚼火者手雷魔法伤害",
          ADD(P("base_damage"), MUL(P("ap_ratio"), SRC_AP)),
          "Damage+1.0×法强。1V1取命中该英雄的爆炸。" + STAT_NOTE,
          10
        ),
      ],
      ...emptyWriteRest,
    },
    preserve: [],
    excluded: [
      { item: "3颗手雷布置几何 / 中断位移", reason: "多目标布置与位移几何排除。" },
      { item: "GrenadeArmTime=0.5", reason: "布置延迟几何，不改变爆炸伤害公式。" },
    ],
    pending: [
      { gap: "系统缺口", detail: "踩中触发、禁锢效果无过程。" },
      { gap: "未接线", detail: "公共冷却/消耗为本批新增，伤害资格不足不造 DAMAGE。" },
    ],
    qualification: qualDamageOnly,
    proofs: [
      { key: "Damage", ...sliceProof([40, 90, 140, 190, 240, 290, 340], 1, 5, IDX1_MAXRANK) },
      { key: "cooldownTime", official: [24, 20.5, 17, 13.5, 10], clientIndex1to5: [24, 20.5, 17, 13.5, 10] },
    ],
  });

  out.push({
    skillKey: "jinx_r",
    sourceEvidence: srcEv("Jinx", "jinx_r", "Characters/Jinx/Spells/JinxRAbility/JinxR", {
      calculations: ["DamageFloor", "DamageMax"],
      chineseKeys: ["spell_jinxr_name", "spell_jinxr_summary", "spell_jinxr_tooltip"],
    }),
    write: {
      parameters: [
        param("floor_base_damage", "飞弹下限基础物理伤害", {
          valueType: "INTEGER",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([20, 35, 50]),
          sortOrder: 10,
          description: "DataValues.BaseDamage 原始[5,20,35,50,65,80,95]。maxrank=3 取索引1至3。",
        }),
        param("floor_bonus_ad_ratio", "飞弹下限额外攻击力系数", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 0.11999999731779099,
          sortOrder: 20,
          description: "DamageFloor StatByCoefficient mStat=2 mStatFormula=2 mCoefficient=0.11999999731779099。",
        }),
        param("max_base_damage", "飞弹上限基础物理伤害", {
          valueType: "INTEGER",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([200, 350, 500]),
          sortOrder: 30,
          description: "DataValues.MaxDamage 原始[50,200,350,500,650,800,950]。取索引1至3。",
        }),
        param("max_bonus_ad_ratio", "飞弹上限额外攻击力系数", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 1.2000000476837158,
          sortOrder: 40,
          description: "DamageMax StatByCoefficient mStat=2 mStatFormula=2 mCoefficient=1.2000000476837158。",
        }),
        param("missing_health_percent_points", "已损失生命额外伤害百分比点数", {
          valueType: "INTEGER",
          valueMode: "SKILL_LEVEL",
          levelValues: lv([25, 30, 35]),
          sortOrder: 50,
          description: "DataValues.PercentDamage 原始[20,25,30,35,40,45,50]。取索引1至3。工具提示 @PercentDamage@%。原值25表示25%，换算0.25。",
        }),
        param("percent_scale", "百分比点数换算比例", {
          valueType: "DECIMAL",
          valueMode: "FIXED",
          fixedValue: 0.01,
          sortOrder: 60,
          description: "将 PercentDamage 点数换算为比例：25→0.25。",
        }),
      ],
      formulas: [
        formula(
          "damage_floor",
          "飞弹最短飞行物理伤害下限",
          ADD(P("floor_base_damage"), MUL(P("floor_bonus_ad_ratio"), SRC_AD_BONUS)),
          "BaseDamage+0.12×额外AD。飞行时间插值算法未证，不在上下限之间自猜线性。" + STAT_NOTE,
          10
        ),
        formula(
          "damage_max",
          "飞弹最长飞行物理伤害上限（不含已损生命）",
          ADD(P("max_base_damage"), MUL(P("max_bonus_ad_ratio"), SRC_AD_BONUS)),
          "MaxDamage+1.2×额外AD。" + STAT_NOTE,
          20
        ),
        formula(
          "missing_health_bonus",
          "已损失生命额外物理伤害",
          MUL(MUL(P("missing_health_percent_points"), P("percent_scale")), TGT_HP_MISSING),
          "PercentDamage点数×0.01×目标已损生命。与上限相加才是工具提示的 @DamageMax@+@PercentDamage@% 已损生命。",
          30
        ),
        formula(
          "damage_max_with_missing_health",
          "飞弹上限加已损生命物理伤害",
          ADD(
            ADD(P("max_base_damage"), MUL(P("max_bonus_ad_ratio"), SRC_AD_BONUS)),
            MUL(MUL(P("missing_health_percent_points"), P("percent_scale")), TGT_HP_MISSING)
          ),
          "上限基础和式 + 已损生命项。飞行超过1秒后如何从下限插到此值未证。",
          40
        ),
      ],
      ...emptyWriteRest,
    },
    preserve: existingParams("jinx_r"),
    excluded: [
      { item: "AoEDamageMult=0.8 / AoERadius", reason: "附近敌人分发排除；1V1主目标用 Floor/Max。" },
      { item: "MonsterExecuteMax=1200", reason: "野怪已损生命上限排除。" },
    ],
    pending: [
      { gap: "来源缺口", detail: "飞行时间>1秒后的伤害插值算法未证，不能用起止值线性。" },
      { gap: "未接线", detail: "伤害资格不足不造 DAMAGE。" },
    ],
    qualification: qualDamageOnly,
    proofs: [
      { key: "BaseDamage", ...sliceProof([5, 20, 35, 50, 65, 80, 95], 1, 3, "maxrank=3") },
      { key: "PercentDamage", ...sliceProof([20, 25, 30, 35, 40, 45, 50], 1, 3, "maxrank=3") },
    ],
  });

  return out;
}
