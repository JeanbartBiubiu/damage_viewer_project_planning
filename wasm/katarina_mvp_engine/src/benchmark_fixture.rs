#![allow(dead_code)]

pub const BENCHMARK_INIT_PAYLOAD_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../benchmark_m1_init_payload.json");

// Test-only attribute constants (not used by production code)
pub const ATTR_CRIT_CHANCE: &str = "crit_chance";
pub const ATTR_CRIT_MULTIPLIER: &str = "crit_multiplier";

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
pub const SKILL_DAMAGE_WINDOW_BURST: &str = "skill_damage_taken_window_probe";
pub const SKILL_FINAL_KILL: &str = "skill_benchmark_final_kill";

pub const TYPE_CAN_TRIGGER_ON_HIT: &str = "type_can_trigger_on_hit";
pub const TYPE_ACTIVE_SKILL: &str = "type_active_skill";
pub const TYPE_RESERVED_BENCHMARK: &str = "type_reserved_benchmark";

pub const FORMULA_BASIC_ATTACK_DAMAGE: &str = "formula_basic_attack_damage";
pub const FORMULA_LIFESTEAL_BLADE_ON_HIT: &str = "formula_lifesteal_blade_on_hit";
pub const FORMULA_MAGIC_BLADE_ON_HIT: &str = "formula_magic_blade_on_hit";
pub const FORMULA_MYSTIC_SHOT_DAMAGE: &str = "formula_mystic_shot_damage";
pub const FORMULA_ARCANE_SHIFT_DAMAGE: &str = "formula_arcane_shift_damage";
pub const FORMULA_MASK_DOT_DAMAGE: &str = "formula_mask_dot_damage";
pub const FORMULA_GENERATE_SHIELD_AMOUNT: &str = "formula_generate_shield_amount";
pub const FORMULA_COUNT_TO_THREE_DAMAGE: &str = "formula_count_to_three_damage";
pub const FORMULA_DAMAGE_WINDOW_BURST: &str = "formula_damage_taken_window_probe";
pub const FORMULA_THORN_ARMOR_DAMAGE: &str = "formula_thorn_armor_damage";

pub fn sanitize_broken_label_lines(raw: &str) -> String {
    raw.lines()
        .map(|line| {
            let trimmed = line.trim_start();
            let indent = &line[..line.len().saturating_sub(trimmed.len())];
            if trimmed.starts_with("\"name\":") && !trimmed.ends_with("\",") && !trimmed.ends_with('"') {
                return format!(r#"{indent}"name": "sanitized_name","#);
            }
            if trimmed.starts_with("\"label\":") && !trimmed.ends_with("\",") && !trimmed.ends_with('"') {
                return format!(r#"{indent}"label": "sanitized_label","#);
            }
            line.to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}