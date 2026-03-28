#![allow(dead_code)]

use crate::runtime::{ActionBehavior, ActionRuntime, ActorId, ActorTemplate, CooldownSpec};
use std::collections::HashMap;

pub const ATTR_HP: &str = "hp";
pub const ATTR_AD: &str = "ad";
pub const ATTR_ATTACK_SPEED_BASE: &str = "attack_speed_base";
pub const ATTR_ATTACK_SPEED_BONUS: &str = "attack_speed_bonus";
pub const ATTR_ATTACK_SPEED_RATIO: &str = "attack_speed_ratio";
pub const ATTR_AP: &str = "ap";
pub const ATTR_HP_REGEN: &str = "hp_regen";
pub const ATTR_MANA: &str = "mana";
pub const ATTR_MANA_REGEN: &str = "mana_regen";
pub const ATTR_ARMOR: &str = "armor";
pub const ATTR_MAGIC_RESIST: &str = "magic_resist";
pub const ATTR_ARMOR_PEN_FLAT: &str = "armor_pen_flat";
pub const ATTR_MAGIC_PEN_FLAT: &str = "magic_pen_flat";
pub const ATTR_ABILITY_HASTE: &str = "ability_haste";
pub const ATTR_CRIT_CHANCE: &str = "crit_chance";
pub const ATTR_CRIT_MULTIPLIER: &str = "crit_multiplier";
pub const ATTR_LIFE_STEAL: &str = "life_steal";
pub const ATTR_HEAL_POWER: &str = "heal_power";

pub const HERO_SELF_BENCHMARK: &str = "hero_self_benchmark";
pub const HERO_ENEMY_BENCHMARK: &str = "hero_enemy_benchmark";

pub const ITEM_LIFESTEAL_BLADE: &str = "item_lifesteal_blade";
pub const ITEM_MAGIC_BLADE: &str = "item_magic_blade";
pub const ITEM_MASK: &str = "item_mask";
pub const ITEM_BLACK_CLEAVER: &str = "item_black_cleaver";
pub const ITEM_DORANS_BLADE: &str = "item_dorans_blade";
pub const ITEM_THORN_ARMOR: &str = "item_thorn_armor";

pub const SKILL_BASIC_ATTACK: &str = "skill_basic_attack";
pub const SKILL_MYSTIC_SHOT: &str = "skill_mystic_shot";
pub const SKILL_ARCANE_SHIFT: &str = "skill_arcane_shift";
pub const SKILL_GENERATE_SHIELD: &str = "skill_generate_shield";
pub const SKILL_STUN: &str = "skill_stun";
pub const SKILL_BLACK_CLEAVER_PROBE: &str = "skill_benchmark_black_cleaver_probe";
pub const SKILL_FINAL_KILL: &str = "skill_benchmark_final_kill";

pub const TYPE_CAN_TRIGGER_ON_HIT: &str = "type_can_trigger_on_hit";
pub const TYPE_ACTIVE_SKILL: &str = "type_active_skill";
pub const TYPE_RESERVED_BENCHMARK: &str = "type_reserved_benchmark";

#[derive(Debug, Clone)]
pub struct BenchmarkSkillDef {
    pub skill_id: String,
    pub label: String,
    pub type_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct BenchmarkItemDef {
    pub item_id: String,
    pub label: String,
}

#[derive(Debug, Clone)]
pub struct BenchmarkFixture {
    pub hp_attr_key: String,
    pub self_hero_id: String,
    pub enemy_hero_id: String,
    pub self_actor: ActorTemplate,
    pub enemy_actor: ActorTemplate,
    pub skill_defs: HashMap<String, BenchmarkSkillDef>,
    pub item_defs: HashMap<String, BenchmarkItemDef>,
}

pub fn total_attack_speed_from_attrs(attrs: &HashMap<String, f64>) -> f64 {
    let base = attrs.get(ATTR_ATTACK_SPEED_BASE).copied().unwrap_or(0.0);
    let bonus = attrs.get(ATTR_ATTACK_SPEED_BONUS).copied().unwrap_or(0.0);
    let ratio = attrs.get(ATTR_ATTACK_SPEED_RATIO).copied().unwrap_or(0.0);
    base + bonus * ratio
}

pub fn build_benchmark_fixture() -> BenchmarkFixture {
    BenchmarkFixture {
        hp_attr_key: ATTR_HP.to_string(),
        self_hero_id: HERO_SELF_BENCHMARK.to_string(),
        enemy_hero_id: HERO_ENEMY_BENCHMARK.to_string(),
        self_actor: ActorTemplate {
            actor_id: ActorId::SelfActor,
            label: "我方基准角色".to_string(),
            attrs: HashMap::from([
                (ATTR_HP.to_string(), 2750.0),
                (ATTR_AD.to_string(), 185.0),
                (ATTR_ATTACK_SPEED_BASE.to_string(), 0.67),
                (ATTR_ATTACK_SPEED_BONUS.to_string(), 0.85),
                (ATTR_ATTACK_SPEED_RATIO.to_string(), 0.67),
                (ATTR_AP.to_string(), 150.0),
                (ATTR_HP_REGEN.to_string(), 3.0),
                (ATTR_MANA.to_string(), 1000.0),
                (ATTR_MANA_REGEN.to_string(), 5.0),
                (ATTR_ARMOR.to_string(), 71.0),
                (ATTR_MAGIC_RESIST.to_string(), 32.0),
                (ATTR_ARMOR_PEN_FLAT.to_string(), 10.0),
                (ATTR_MAGIC_PEN_FLAT.to_string(), 0.0),
                (ATTR_ABILITY_HASTE.to_string(), 35.0),
                (ATTR_CRIT_CHANCE.to_string(), 0.0),
                (ATTR_CRIT_MULTIPLIER.to_string(), 1.75),
                (ATTR_LIFE_STEAL.to_string(), 0.1),
                (ATTR_HEAL_POWER.to_string(), 0.0),
            ]),
            owned_items: vec![
                ITEM_LIFESTEAL_BLADE.to_string(),
                ITEM_MAGIC_BLADE.to_string(),
                ITEM_MASK.to_string(),
                ITEM_BLACK_CLEAVER.to_string(),
                ITEM_DORANS_BLADE.to_string(),
            ],
            priorities: vec![
                SKILL_ARCANE_SHIFT.to_string(),
                SKILL_MYSTIC_SHOT.to_string(),
                SKILL_BASIC_ATTACK.to_string(),
            ],
            actions: HashMap::from([
                (
                    SKILL_BASIC_ATTACK.to_string(),
                    ActionRuntime {
                        action_id: SKILL_BASIC_ATTACK.to_string(),
                        label: "普通攻击".to_string(),
                        priority: 30,
                        behavior: ActionBehavior::BasicAttack,
                        cooldown: CooldownSpec::BasicAttackInterval,
                        mana_cost: 0.0,
                    },
                ),
                (
                    SKILL_MYSTIC_SHOT.to_string(),
                    ActionRuntime {
                        action_id: SKILL_MYSTIC_SHOT.to_string(),
                        label: "秘术射击".to_string(),
                        priority: 20,
                        behavior: ActionBehavior::MysticShot,
                        cooldown: CooldownSpec::AbilityHasteScaled { base_ms: 10_000 },
                        mana_cost: 25.0,
                    },
                ),
                (
                    SKILL_ARCANE_SHIFT.to_string(),
                    ActionRuntime {
                        action_id: SKILL_ARCANE_SHIFT.to_string(),
                        label: "奥术跃迁".to_string(),
                        priority: 10,
                        behavior: ActionBehavior::ArcaneShift,
                        cooldown: CooldownSpec::AbilityHasteScaled { base_ms: 15_000 },
                        mana_cost: 40.0,
                    },
                ),
                (
                    SKILL_BLACK_CLEAVER_PROBE.to_string(),
                    ActionRuntime {
                        action_id: SKILL_BLACK_CLEAVER_PROBE.to_string(),
                        label: "数3".to_string(),
                        priority: 99,
                        behavior: ActionBehavior::BasicAttack,
                        cooldown: CooldownSpec::FixedMs(0),
                        mana_cost: 0.0,
                    },
                ),
            ]),
        },
        enemy_actor: ActorTemplate {
            actor_id: ActorId::Enemy,
            label: "敌方基准角色".to_string(),
            attrs: HashMap::from([
                (ATTR_HP.to_string(), 5550.0),
                (ATTR_AD.to_string(), 60.0),
                (ATTR_ATTACK_SPEED_BASE.to_string(), 0.80),
                (ATTR_ATTACK_SPEED_BONUS.to_string(), 0.05),
                (ATTR_ATTACK_SPEED_RATIO.to_string(), 0.67),
                (ATTR_AP.to_string(), 0.0),
                (ATTR_HP_REGEN.to_string(), 30.0),
                (ATTR_MANA.to_string(), 1000.0),
                (ATTR_MANA_REGEN.to_string(), 0.0),
                (ATTR_ARMOR.to_string(), 220.0),
                (ATTR_MAGIC_RESIST.to_string(), 60.0),
                (ATTR_ARMOR_PEN_FLAT.to_string(), 0.0),
                (ATTR_MAGIC_PEN_FLAT.to_string(), 0.0),
                (ATTR_ABILITY_HASTE.to_string(), 0.0),
                (ATTR_CRIT_CHANCE.to_string(), 0.0),
                (ATTR_CRIT_MULTIPLIER.to_string(), 1.75),
                (ATTR_LIFE_STEAL.to_string(), 0.0),
                (ATTR_HEAL_POWER.to_string(), 0.0),
            ]),
            owned_items: vec![ITEM_THORN_ARMOR.to_string(), ITEM_DORANS_BLADE.to_string()],
            priorities: vec![SKILL_GENERATE_SHIELD.to_string(), SKILL_STUN.to_string()],
            actions: HashMap::from([
                (
                    SKILL_GENERATE_SHIELD.to_string(),
                    ActionRuntime {
                        action_id: SKILL_GENERATE_SHIELD.to_string(),
                        label: "生成护盾".to_string(),
                        priority: 10,
                        behavior: ActionBehavior::GenerateShield,
                        cooldown: CooldownSpec::FixedMs(8_000),
                        mana_cost: 0.0,
                    },
                ),
                (
                    SKILL_STUN.to_string(),
                    ActionRuntime {
                        action_id: SKILL_STUN.to_string(),
                        label: "眩晕".to_string(),
                        priority: 10,
                        behavior: ActionBehavior::Stun,
                        cooldown: CooldownSpec::AbilityHasteScaled { base_ms: 7_000 },
                        mana_cost: 0.0,
                    },
                ),
            ]),
        },
        skill_defs: HashMap::from([
            (
                SKILL_BASIC_ATTACK.to_string(),
                BenchmarkSkillDef {
                    skill_id: SKILL_BASIC_ATTACK.to_string(),
                    label: "普通攻击".to_string(),
                    type_ids: vec![TYPE_CAN_TRIGGER_ON_HIT.to_string()],
                },
            ),
            (
                SKILL_MYSTIC_SHOT.to_string(),
                BenchmarkSkillDef {
                    skill_id: SKILL_MYSTIC_SHOT.to_string(),
                    label: "秘术射击".to_string(),
                    type_ids: vec![
                        TYPE_CAN_TRIGGER_ON_HIT.to_string(),
                        TYPE_ACTIVE_SKILL.to_string(),
                    ],
                },
            ),
            (
                SKILL_ARCANE_SHIFT.to_string(),
                BenchmarkSkillDef {
                    skill_id: SKILL_ARCANE_SHIFT.to_string(),
                    label: "奥术跃迁".to_string(),
                    type_ids: vec![TYPE_ACTIVE_SKILL.to_string()],
                },
            ),
            (
                SKILL_BLACK_CLEAVER_PROBE.to_string(),
                BenchmarkSkillDef {
                    skill_id: SKILL_BLACK_CLEAVER_PROBE.to_string(),
                    label: "数3".to_string(),
                    type_ids: vec![TYPE_RESERVED_BENCHMARK.to_string()],
                },
            ),
            (
                SKILL_GENERATE_SHIELD.to_string(),
                BenchmarkSkillDef {
                    skill_id: SKILL_GENERATE_SHIELD.to_string(),
                    label: "生成护盾".to_string(),
                    type_ids: vec![TYPE_RESERVED_BENCHMARK.to_string()],
                },
            ),
            (
                SKILL_STUN.to_string(),
                BenchmarkSkillDef {
                    skill_id: SKILL_STUN.to_string(),
                    label: "眩晕".to_string(),
                    type_ids: vec![TYPE_RESERVED_BENCHMARK.to_string()],
                },
            ),
            (
                SKILL_FINAL_KILL.to_string(),
                BenchmarkSkillDef {
                    skill_id: SKILL_FINAL_KILL.to_string(),
                    label: "benchmark_final_kill".to_string(),
                    type_ids: vec![TYPE_RESERVED_BENCHMARK.to_string()],
                },
            ),
        ]),
        item_defs: HashMap::from([
            (
                ITEM_LIFESTEAL_BLADE.to_string(),
                BenchmarkItemDef {
                    item_id: ITEM_LIFESTEAL_BLADE.to_string(),
                    label: "吸血刀".to_string(),
                },
            ),
            (
                ITEM_MAGIC_BLADE.to_string(),
                BenchmarkItemDef {
                    item_id: ITEM_MAGIC_BLADE.to_string(),
                    label: "魔法刀".to_string(),
                },
            ),
            (
                ITEM_MASK.to_string(),
                BenchmarkItemDef {
                    item_id: ITEM_MASK.to_string(),
                    label: "面具".to_string(),
                },
            ),
            (
                ITEM_BLACK_CLEAVER.to_string(),
                BenchmarkItemDef {
                    item_id: ITEM_BLACK_CLEAVER.to_string(),
                    label: "黑切".to_string(),
                },
            ),
            (
                ITEM_DORANS_BLADE.to_string(),
                BenchmarkItemDef {
                    item_id: ITEM_DORANS_BLADE.to_string(),
                    label: "多兰之刃".to_string(),
                },
            ),
            (
                ITEM_THORN_ARMOR.to_string(),
                BenchmarkItemDef {
                    item_id: ITEM_THORN_ARMOR.to_string(),
                    label: "反甲".to_string(),
                },
            ),
        ]),
    }
}
