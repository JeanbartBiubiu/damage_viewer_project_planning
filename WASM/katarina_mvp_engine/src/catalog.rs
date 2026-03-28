#![allow(dead_code)]

use crate::benchmark_fixture::{
    build_benchmark_fixture, total_attack_speed_from_attrs, BenchmarkFixture, BenchmarkItemDef,
    BenchmarkSkillDef, ATTR_ATTACK_SPEED_BASE, ATTR_ATTACK_SPEED_BONUS, ATTR_ATTACK_SPEED_RATIO,
};
use crate::model::{EngineConfig, EngineError, ErrorCode, TestProfile};
use crate::runtime::{ActorTemplate, SimulationConfig};
use std::collections::HashMap;

pub type CompiledActor = ActorTemplate;
pub type CompiledSkill = BenchmarkSkillDef;
pub type CompiledItem = BenchmarkItemDef;

#[derive(Debug, Clone)]
pub struct CompiledActorInitSnapshot {
    pub hero_id: String,
    pub label: String,
    pub hp_initial: f64,
    pub attack_speed_base: f64,
    pub attack_speed_bonus: f64,
    pub attack_speed_ratio: f64,
    pub total_attack_speed: f64,
    pub equipped_item_ids: Vec<String>,
}

impl CompiledActorInitSnapshot {
    pub fn attack_speed_triplet(&self) -> (f64, f64, f64) {
        (
            self.attack_speed_base,
            self.attack_speed_bonus,
            self.attack_speed_ratio,
        )
    }
}

#[derive(Debug, Clone)]
pub struct CompiledCatalog {
    pub profile: TestProfile,
    pub requested_profile: TestProfile,
    pub hp_attr_key: String,
    pub self_hero_id: String,
    pub enemy_hero_id: String,
    pub self_actor: CompiledActor,
    pub enemy_actor: CompiledActor,
    pub self_init: CompiledActorInitSnapshot,
    pub enemy_init: CompiledActorInitSnapshot,
    pub skill_defs: HashMap<String, CompiledSkill>,
    pub item_defs: HashMap<String, CompiledItem>,
}

impl CompiledCatalog {
    pub fn to_simulation_config(&self, max_duration_ms: u32, max_events: usize) -> SimulationConfig {
        SimulationConfig {
            profile: self.profile,
            max_duration_ms,
            max_events,
            self_actor: self.self_actor.clone(),
            enemy_actor: self.enemy_actor.clone(),
        }
    }

    pub fn self_total_attack_speed(&self) -> f64 {
        self.self_init.total_attack_speed
    }

    pub fn enemy_total_attack_speed(&self) -> f64 {
        self.enemy_init.total_attack_speed
    }
}

pub fn compile_benchmark_catalog(config: &EngineConfig) -> Result<CompiledCatalog, EngineError> {
    let fixture = build_benchmark_fixture();
    validate_hp_attr_key(config, &fixture)?;

    let requested_profile = config.resolved_test_profile();
    let self_init = build_actor_init_snapshot(&fixture.self_hero_id, &fixture.self_actor, config);
    let enemy_init = build_actor_init_snapshot(&fixture.enemy_hero_id, &fixture.enemy_actor, config);
    Ok(CompiledCatalog {
        profile: map_test_profile(requested_profile),
        requested_profile,
        hp_attr_key: fixture.hp_attr_key,
        self_hero_id: fixture.self_hero_id,
        enemy_hero_id: fixture.enemy_hero_id,
        self_init,
        enemy_init,
        self_actor: fixture.self_actor,
        enemy_actor: fixture.enemy_actor,
        skill_defs: fixture.skill_defs,
        item_defs: fixture.item_defs,
    })
}

fn validate_hp_attr_key(config: &EngineConfig, fixture: &BenchmarkFixture) -> Result<(), EngineError> {
    let hp_attr_key = config.resolved_hp_attr_key();
    if hp_attr_key != fixture.hp_attr_key.as_str() {
        return Err(EngineError {
            code: ErrorCode::SemanticError,
            message: format!(
                "Benchmark fixture only supports hpAttrKey='{}', got '{}'",
                fixture.hp_attr_key, hp_attr_key
            ),
        });
    }
    Ok(())
}

fn map_test_profile(profile: TestProfile) -> TestProfile {
    profile
}

fn build_actor_init_snapshot(
    hero_id: &str,
    actor: &ActorTemplate,
    config: &EngineConfig,
) -> CompiledActorInitSnapshot {
    let hp_attr_key = config.resolved_hp_attr_key();
    CompiledActorInitSnapshot {
        hero_id: hero_id.to_string(),
        label: actor.label.clone(),
        hp_initial: actor.attrs.get(hp_attr_key).copied().unwrap_or(0.0),
        attack_speed_base: actor
            .attrs
            .get(ATTR_ATTACK_SPEED_BASE)
            .copied()
            .unwrap_or(0.0),
        attack_speed_bonus: actor
            .attrs
            .get(ATTR_ATTACK_SPEED_BONUS)
            .copied()
            .unwrap_or(0.0),
        attack_speed_ratio: actor
            .attrs
            .get(ATTR_ATTACK_SPEED_RATIO)
            .copied()
            .unwrap_or(0.0),
        total_attack_speed: total_attack_speed_from_attrs(&actor.attrs),
        equipped_item_ids: actor.owned_items.clone(),
    }
}
