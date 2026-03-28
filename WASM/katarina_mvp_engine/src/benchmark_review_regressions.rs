use crate::benchmark_fixture::{
    BENCHMARK_INIT_PAYLOAD_PATH, ITEM_LIFESTEAL_BLADE, ITEM_THORN_ARMOR, SKILL_BASIC_ATTACK, SKILL_BLACK_CLEAVER_PROBE,
};
use crate::catalog::compile_benchmark_catalog;
use crate::effects::apply_generate_shield;
use crate::engine::{init_session, run_benchmark_runtime_for_test};
use crate::model::{
    CombatantInit, DamageType, EngineActionPlan, EngineConfig, EngineInitPayload, EngineRunInput, GameDataBundle,
    InitialCombatants, StopCondition, TestProfile,
};
use crate::runtime::{build_runtime, ActorId, InternalEvent, RuntimeLog, SimulationConfig};
use crate::sim::{run_first_basic_attack, run_minimal_benchmark_battle, run_until_stop};
use std::fs;

fn benchmark_payload() -> EngineInitPayload {
    let raw = fs::read_to_string(BENCHMARK_INIT_PAYLOAD_PATH).expect("benchmark payload json should exist");
    let sanitized = sanitize_broken_label_lines(&raw);
    serde_json::from_str(&sanitized).expect("benchmark payload json should deserialize")
}

fn sanitize_broken_label_lines(raw: &str) -> String {
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

fn minimal_bundle() -> GameDataBundle {
    benchmark_payload().bundle
}

fn benchmark_session(profile: TestProfile) -> crate::engine::EngineSession {
    let mut payload = benchmark_payload();
    payload.engine_config = Some(EngineConfig {
        hp_attr_key: payload
            .engine_config
            .as_ref()
            .and_then(|config| config.hp_attr_key.clone()),
        test_profile: Some(profile),
    });
    init_session(payload).unwrap()
}

fn benchmark_input_basic_attack() -> EngineRunInput {
    EngineRunInput {
        seed: None,
        stop: StopCondition { max_seconds: 5.0 },
        initial: InitialCombatants {
            self_actor: CombatantInit {
                hero_id: "ignored_self".into(),
                level: None,
                item_ids: vec![],
            },
            enemy: CombatantInit {
                hero_id: "ignored_enemy".into(),
                level: None,
                item_ids: vec![],
            },
        },
        overrides: None,
        plan: EngineActionPlan::BasicAttack {
            count: 1,
            skill_id: None,
        },
    }
}

fn benchmark_config(profile: TestProfile) -> SimulationConfig {
    let compiled = compile_benchmark_catalog(&minimal_bundle(), &EngineConfig {
        hp_attr_key: None,
        test_profile: Some(profile),
    })
    .unwrap();
    compiled.to_simulation_config(60_000, 100_000)
}

fn replace_owned_item_id(item_ids: &mut [String], from: &str, to: &str) {
    if let Some(item_id) = item_ids.iter_mut().find(|item_id| item_id.as_str() == from) {
        *item_id = to.to_string();
    }
}

#[test]
fn review_basic_attack_triggers_black_cleaver_on_each_physical_component() {
    let session = benchmark_session(TestProfile::Full);
    let runtime = run_benchmark_runtime_for_test(&session, benchmark_input_basic_attack()).unwrap();

    let black_cleaver_changes = runtime
        .logs
        .iter()
        .filter_map(|entry| match entry {
            RuntimeLog::BlackCleaverChanged {
                actor_id,
                stacks,
                ..
            } if *actor_id == ActorId::Enemy => Some(*stacks),
            _ => None,
        })
        .collect::<Vec<_>>();

    assert_eq!(black_cleaver_changes.len(), 2);
    assert_eq!(black_cleaver_changes[0], 1);
    assert_eq!(black_cleaver_changes[1], 2);
    assert!(runtime.actor(ActorId::Enemy).attr("armor") < runtime.actor(ActorId::Enemy).base_attr("armor"));

    let damage_event = runtime
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::DamageResolved {
                source_actor,
                target_actor,
                components,
                ..
            } if *source_actor == ActorId::SelfActor && *target_actor == ActorId::Enemy => Some(components),
            _ => None,
        })
        .expect("expected a self-to-enemy damage resolution");

    assert!(damage_event.iter().any(|component| {
        component.component.source_id == SKILL_BASIC_ATTACK
            && component.component.damage_type == DamageType::Physical
            && component.component.source_kind == crate::model::DamageSourceKind::BasicAttack
    }));
    assert!(damage_event.iter().any(|component| {
        component.component.source_id == ITEM_LIFESTEAL_BLADE
            && component.component.damage_type == DamageType::Physical
            && component.component.source_kind == crate::model::DamageSourceKind::Item
    }));
}

#[test]
fn review_count_to_three_emits_true_damage_and_resets() {
    let mut state = build_runtime(benchmark_config(TestProfile::Full));
    state.push_event(0, 0, InternalEvent::ActorDecide { actor_id: ActorId::SelfActor });
    state.push_event(1_000, 0, InternalEvent::ActorDecide { actor_id: ActorId::SelfActor });
    state.push_event(2_000, 0, InternalEvent::ActorDecide { actor_id: ActorId::SelfActor });
    run_until_stop(&mut state).unwrap();

    let true_damage_component = state
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::DamageResolved {
                source_actor,
                target_actor,
                components,
                ..
            } if *source_actor == ActorId::SelfActor && *target_actor == ActorId::Enemy => components
                .iter()
                .find(|component| {
                    component.component.source_id == SKILL_BLACK_CLEAVER_PROBE
                        && component.component.damage_type == DamageType::True
                })
                .cloned(),
            _ => None,
        })
        .expect("expected a true-damage component from the third mark");

    assert_eq!(true_damage_component.component.raw_damage, 55.5);
    assert_eq!(true_damage_component.component.dealt_damage, 55.5);
    assert_eq!(state.actor(ActorId::SelfActor).count_to_three_marks, 0);
}

#[test]
fn review_thornmail_reflects_magic_damage_to_attacker() {
    let runtime = run_first_basic_attack(benchmark_config(TestProfile::Full)).unwrap();
    let reflect_log = runtime
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::DamageResolved {
                source_actor,
                target_actor,
                components,
                ..
            } if *source_actor == ActorId::Enemy && *target_actor == ActorId::SelfActor => {
                components
                    .iter()
                    .find(|component| component.component.source_id == ITEM_THORN_ARMOR)
                    .cloned()
            }
            _ => None,
        })
        .expect("expected thornmail reflection on the attacker");

    assert_eq!(reflect_log.component.damage_type, DamageType::Magic);
    assert!(reflect_log.component.dealt_damage > 0.0);
    assert!(runtime.total_damage_to_self > 0.0);
}

#[test]
fn review_lifesteal_uses_dealt_damage_even_when_shield_is_present() {
    let mut state = build_runtime(benchmark_config(TestProfile::Full));
    state.self_actor.hp_current = (state.self_actor.hp_max - 250.0).max(1.0);
    let requested_amount = 100.0 + state.actor(ActorId::Enemy).hp_max * 0.08;
    apply_generate_shield(&mut state, ActorId::Enemy, requested_amount);
    state.push_event(0, 0, InternalEvent::ActorDecide { actor_id: ActorId::SelfActor });
    run_until_stop(&mut state).unwrap();

    let life_steal_log = state
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::HealApplied {
                actor_id,
                reason,
                amount,
                ..
            } if *actor_id == ActorId::SelfActor && reason == "life_steal" => Some(*amount),
            _ => None,
        })
        .expect("expected a life-steal heal when shield absorbs part of the damage");

    assert!(life_steal_log > 0.0);
    assert!(state.actor(ActorId::SelfActor).hp_current > state.actor(ActorId::SelfActor).hp_max - 250.0);
}

#[test]
fn review_full_battle_records_enemy_actions() {
    let config = benchmark_config(TestProfile::Full);
    let runtime = run_minimal_benchmark_battle(config).unwrap();

    let enemy_action_seen = runtime.logs.iter().any(|entry| {
        matches!(
            entry,
            RuntimeLog::ActionChosen {
                actor_id: ActorId::Enemy,
                ..
            }
        )
    });
    let enemy_effect_seen = runtime.logs.iter().any(|entry| {
        matches!(
            entry,
            RuntimeLog::ShieldChanged { actor_id: ActorId::Enemy, .. }
                | RuntimeLog::StunApplied { actor_id: ActorId::SelfActor, .. }
        )
    });

    assert!(enemy_action_seen);
    assert!(enemy_effect_seen);
}

#[test]
fn review_item_abilities_follow_equipped_item_defs_instead_of_fixed_ids() {
    let mut payload = benchmark_payload();
    let benchmark = payload
        .bundle
        .benchmark
        .as_mut()
        .expect("benchmark bundle should exist");

    let alt_black_cleaver = "item_black_cleaver_alt";
    let alt_thornmail = "item_thorn_armor_alt";

    replace_owned_item_id(&mut benchmark.self_actor.owned_item_ids, "item_black_cleaver", alt_black_cleaver);
    replace_owned_item_id(&mut benchmark.enemy_actor.owned_item_ids, ITEM_THORN_ARMOR, alt_thornmail);

    let black_cleaver_def = benchmark
        .item_defs
        .iter_mut()
        .find(|item| item.item_id == "item_black_cleaver")
        .expect("black cleaver item def should exist");
    black_cleaver_def.item_id = alt_black_cleaver.to_string();

    let thornmail_def = benchmark
        .item_defs
        .iter_mut()
        .find(|item| item.item_id == ITEM_THORN_ARMOR)
        .expect("thornmail item def should exist");
    thornmail_def.item_id = alt_thornmail.to_string();

    payload.engine_config = Some(EngineConfig {
        hp_attr_key: None,
        test_profile: Some(TestProfile::Full),
    });

    let session = init_session(payload).unwrap();
    let runtime = run_benchmark_runtime_for_test(&session, benchmark_input_basic_attack()).unwrap();

    let black_cleaver_applied = runtime.logs.iter().any(|entry| {
        matches!(
            entry,
            RuntimeLog::BlackCleaverChanged {
                actor_id: ActorId::Enemy,
                ..
            }
        )
    });
    assert!(black_cleaver_applied);

    let reflect_component = runtime
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::DamageResolved {
                source_actor,
                target_actor,
                components,
                ..
            } if *source_actor == ActorId::Enemy && *target_actor == ActorId::SelfActor => {
                components
                    .iter()
                    .find(|component| component.component.source_id == alt_thornmail)
                    .cloned()
            }
            _ => None,
        })
        .expect("expected retaliate damage from renamed thornmail item");

    assert_eq!(reflect_component.component.source_id, alt_thornmail);
    assert_eq!(reflect_component.component.damage_type, DamageType::Magic);
}
