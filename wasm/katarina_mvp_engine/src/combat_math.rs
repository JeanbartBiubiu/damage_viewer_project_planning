use crate::model::TestProfile;
use crate::types::{
    CooldownSpec,
    ATTR_ABILITY_HASTE, ATTR_ATTACK_SPEED_BASE,
    ATTR_ATTACK_SPEED_BONUS, ATTR_ATTACK_SPEED_RATIO,
};
use std::collections::HashMap;

/// Pure cooldown calculation — no runtime state dependency.
pub fn resolve_cooldown_ms(cooldown: CooldownSpec, attrs: &HashMap<String, f64>) -> u32 {
    match cooldown {
        CooldownSpec::BasicAttackInterval => {
            let total_attack_speed =
                attrs.get(ATTR_ATTACK_SPEED_BASE).copied().unwrap_or(0.0)
                    + attrs.get(ATTR_ATTACK_SPEED_BONUS).copied().unwrap_or(0.0)
                        * attrs.get(ATTR_ATTACK_SPEED_RATIO).copied().unwrap_or(0.0);
            let total_attack_speed = total_attack_speed.max(0.1);
            (1000.0 / total_attack_speed).round() as u32
        }
        CooldownSpec::AbilityHasteScaled { base_ms } => {
            let ability_haste = attrs.get(ATTR_ABILITY_HASTE).copied().unwrap_or(0.0).max(0.0);
            ((base_ms as f64) * (100.0 / (100.0 + ability_haste))).round() as u32
        }
        CooldownSpec::FixedMs(base_ms) => base_ms,
    }
}

pub fn mitigation_multiplier(profile: TestProfile, resistance: f64) -> f64 {
    if matches!(profile, TestProfile::BucketIdentity) {
        return 1.0;
    }
    if resistance >= 0.0 {
        100.0 / (100.0 + resistance)
    } else {
        2.0 - 100.0 / (100.0 - resistance)
    }
}

pub fn round_number(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}
