use crate::benchmark_fixture::{
    BENCHMARK_INIT_PAYLOAD_PATH, SKILL_ARCANE_SHIFT, SKILL_BASIC_ATTACK, SKILL_BLACK_CLEAVER_PROBE, SKILL_FINAL_KILL,
    SKILL_MYSTIC_SHOT,
};
use crate::catalog::compile_benchmark_catalog;
use crate::engine::{init_session, run, run_benchmark_runtime_for_test};
use crate::effects::apply_stun;
use crate::model::{
    CombatantInit, CombatantOverride, CombatantOverrides, DamageSourceKind, DamageType, EngineActionPlan,
    EngineConfig, EngineInitPayload, EngineMeta, EngineRunInput, GameDataBundle, InitialCombatants, StopCondition,
    TestProfile,
};
use crate::runtime::{build_runtime, ActorId, InternalEvent, RuntimeLog};
use crate::sim::run_until_stop;
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

fn benchmark_input() -> EngineRunInput {
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

fn benchmark_mystic_shot_input() -> EngineRunInput {
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
        plan: EngineActionPlan::CastSkill {
            skill_id: "skill_mystic_shot".into(),
            skill_level: None,
            cast_count: None,
        },
    }
}

fn benchmark_arcane_shift_input() -> EngineRunInput {
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
        plan: EngineActionPlan::CastSkill {
            skill_id: "skill_arcane_shift".into(),
            skill_level: None,
            cast_count: None,
        },
    }
}

fn benchmark_generate_shield_input() -> EngineRunInput {
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
        plan: EngineActionPlan::CastSkill {
            skill_id: "skill_generate_shield".into(),
            skill_level: None,
            cast_count: None,
        },
    }
}

fn benchmark_stun_input() -> EngineRunInput {
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
        plan: EngineActionPlan::CastSkill {
            skill_id: "skill_stun".into(),
            skill_level: None,
            cast_count: None,
        },
    }
}

fn benchmark_black_cleaver_expire_input() -> EngineRunInput {
    EngineRunInput {
        seed: None,
        stop: StopCondition { max_seconds: 6.0 },
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
        plan: EngineActionPlan::CastSkill {
            skill_id: SKILL_BLACK_CLEAVER_PROBE.into(),
            skill_level: None,
            cast_count: None,
        },
    }
}

fn benchmark_final_kill_input() -> EngineRunInput {
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
        plan: EngineActionPlan::CastSkill {
            skill_id: SKILL_FINAL_KILL.into(),
            skill_level: None,
            cast_count: Some(3),
        },
    }
}

fn with_self_mana_delta(mut input: EngineRunInput, mana_delta: f64) -> EngineRunInput {
    input.overrides = Some(CombatantOverrides {
        self_actor: Some(CombatantOverride {
            base_stats: std::collections::HashMap::from([("mana".to_string(), mana_delta)]),
            ..Default::default()
        }),
        enemy: None,
    });
    input
}

#[test]
fn t01_init_compile() {
    let session = init_session(EngineInitPayload {
        meta: EngineMeta {
            game_id: "benchmark".into(),
            version_id: 1,
            data_hash: "hash".into(),
        },
        bundle: minimal_bundle(),
        engine_config: Some(EngineConfig {
            hp_attr_key: None,
            test_profile: Some(TestProfile::Full),
        }),
    })
    .unwrap();

    assert!(session.has_benchmark_catalog());
}

#[test]
fn t02_first_basic_attack() {
    let session = init_session(EngineInitPayload {
        meta: EngineMeta {
            game_id: "benchmark".into(),
            version_id: 1,
            data_hash: "hash".into(),
        },
        bundle: minimal_bundle(),
        engine_config: Some(EngineConfig {
            hp_attr_key: None,
            test_profile: Some(TestProfile::Full),
        }),
    })
    .unwrap();

    let output = run(&session, benchmark_input()).unwrap();

    assert_eq!(output.result.action_label, "benchmark_auto_battle");
    assert_eq!(output.result.stop_reason, crate::model::StopReason::Completed);
    assert_eq!(output.result.action_duration_ms, 0);
    assert_eq!(output.samples.len(), 1);
    assert_eq!(output.samples[0].t_ms, 0);
    assert!(!output.events.is_empty());

    let first_event = &output.events[0];
    assert_eq!(first_event.sequence, 1);
    assert_eq!(first_event.components.len(), 3);
    assert_eq!(first_event.components[0].source_kind, DamageSourceKind::BasicAttack);
    assert_eq!(first_event.components[0].source_id, "skill_basic_attack");
    assert_eq!(first_event.components[0].damage_type, DamageType::Physical);
    assert_eq!(first_event.components[1].source_kind, DamageSourceKind::Item);
    assert_eq!(first_event.components[1].source_id, "item_lifesteal_blade");
    assert_eq!(first_event.components[2].source_kind, DamageSourceKind::Item);
    assert_eq!(first_event.components[2].source_id, "item_magic_blade");
    assert_eq!(first_event.components[2].damage_type, DamageType::Magic);
}

#[test]
fn t03_first_mystic_shot() {
    let session = init_session(EngineInitPayload {
        meta: EngineMeta {
            game_id: "benchmark".into(),
            version_id: 1,
            data_hash: "hash".into(),
        },
        bundle: minimal_bundle(),
        engine_config: Some(EngineConfig {
            hp_attr_key: None,
            test_profile: Some(TestProfile::Full),
        }),
    })
    .unwrap();

    let output = run(&session, benchmark_mystic_shot_input()).unwrap();

    assert_eq!(output.result.action_label, "benchmark_auto_battle");
    assert!(!output.events.is_empty());

    let first_event = &output.events[0];
    assert!(first_event.components.len() >= 3);
    assert_eq!(first_event.components[0].source_kind, DamageSourceKind::Skill);
    assert_eq!(first_event.components[0].source_id, "skill_mystic_shot");
    assert_eq!(first_event.components[0].damage_type, DamageType::Physical);
    assert_eq!(first_event.components[1].source_kind, DamageSourceKind::Item);
    assert_eq!(first_event.components[1].source_id, "item_lifesteal_blade");
    assert_eq!(first_event.components[2].source_kind, DamageSourceKind::Item);
    assert_eq!(first_event.components[2].source_id, "item_magic_blade");
    assert!(first_event.components[0].raw_damage > 0.0);
    assert!(first_event.components[0].dealt_damage > 0.0);

    let runtime = run_benchmark_runtime_for_test(&session, benchmark_mystic_shot_input()).unwrap();
    let mana_spent = runtime
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::ManaSpent {
                action_id,
                amount,
                mana_before,
                mana_after,
                ..
            } if action_id == SKILL_MYSTIC_SHOT => Some((*amount, *mana_before, *mana_after)),
            _ => None,
        })
        .expect("expected a mana spent log for mystic shot");
    assert_eq!(mana_spent, (25.0, 1000.0, 975.0));
}

#[test]
fn t04_first_arcane_shift() {
    let session = init_session(EngineInitPayload {
        meta: EngineMeta {
            game_id: "benchmark".into(),
            version_id: 1,
            data_hash: "hash".into(),
        },
        bundle: minimal_bundle(),
        engine_config: Some(EngineConfig {
            hp_attr_key: None,
            test_profile: Some(TestProfile::Full),
        }),
    })
    .unwrap();

    let output = run(&session, benchmark_arcane_shift_input()).unwrap();

    assert_eq!(output.result.action_label, "benchmark_auto_battle");

    let arcane_events = output
        .events
        .iter()
        .filter(|event| {
            event.components.iter().any(|component| {
                component.source_kind == DamageSourceKind::Skill
                    && component.source_id == "skill_arcane_shift"
                    && component.damage_type == DamageType::Magic
            })
        })
        .count();
    assert!(arcane_events >= 1);

    let dot_ticks = output
        .events
        .iter()
        .filter(|event| {
            event.components
                .iter()
                .any(|component| component.source_id == "item_mask")
        })
        .count();
    assert_eq!(dot_ticks, 3);

    let runtime = run_benchmark_runtime_for_test(&session, benchmark_arcane_shift_input()).unwrap();
    let mana_spent = runtime
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::ManaSpent {
                action_id,
                amount,
                mana_before,
                mana_after,
                ..
            } if action_id == SKILL_ARCANE_SHIFT => Some((*amount, *mana_before, *mana_after)),
            _ => None,
        })
        .expect("expected a mana spent log for arcane shift");
    assert_eq!(mana_spent, (40.0, 1000.0, 960.0));
}

#[test]
fn t05_shield_generation_and_refresh() {
    let session = init_session(EngineInitPayload {
        meta: EngineMeta {
            game_id: "benchmark".into(),
            version_id: 1,
            data_hash: "hash".into(),
        },
        bundle: minimal_bundle(),
        engine_config: Some(EngineConfig {
            hp_attr_key: None,
            test_profile: Some(TestProfile::Full),
        }),
    })
    .unwrap();

    let output = run(&session, benchmark_generate_shield_input()).unwrap();

    assert_eq!(output.result.action_label, "benchmark_auto_battle");
    assert_eq!(output.result.stop_reason, crate::model::StopReason::Completed);
    assert_eq!(output.events.len(), 1);

    let first_event = &output.events[0];
    assert_eq!(first_event.t_ms, 0);
    assert!(first_event.total_dealt_damage > 0.0);
    assert!(first_event.enemy_hp_after < first_event.enemy_hp_before);
    assert!(output.result.total_damage_to_enemy > 0.0);
    assert!(output.result.total_damage_to_enemy < first_event.total_dealt_damage);
    assert_eq!(output.samples[0].enemy_hp, first_event.enemy_hp_after);

    let runtime = run_benchmark_runtime_for_test(&session, benchmark_generate_shield_input()).unwrap();

    let shield_logs = runtime
        .logs
        .iter()
        .filter_map(|entry| match entry {
            RuntimeLog::ShieldChanged {
                t_ms,
                actor_id,
                previous_amount,
                new_amount,
                requested_amount,
            } => Some((*t_ms, *actor_id, *previous_amount, *new_amount, *requested_amount)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert!(shield_logs.len() >= 2);

    let initial_shield = shield_logs[0];
    assert_eq!(initial_shield.0, 0);
    assert_eq!(initial_shield.1, ActorId::Enemy);
    assert_eq!(initial_shield.2, 0.0);
    assert_eq!(initial_shield.3, 105.5);
    assert_eq!(initial_shield.4, 105.5);

    let refresh_log = shield_logs[1];
    assert_eq!(refresh_log.0, 1);
    assert_eq!(refresh_log.1, ActorId::Enemy);
    assert_eq!(refresh_log.3, refresh_log.2.max(refresh_log.4));
    assert!(refresh_log.3 >= refresh_log.2);
    assert_eq!(refresh_log.4, 105.5);

    let damage_log = runtime
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::DamageResolved {
                t_ms,
                target_actor,
                target_hp_before,
                target_hp_after,
                target_shield_before,
                target_shield_after,
                total_hp_damage,
                ..
            } => Some((
                *t_ms,
                *target_actor,
                *target_hp_before,
                *target_hp_after,
                *target_shield_before,
                *target_shield_after,
                *total_hp_damage,
            )),
            _ => None,
        })
        .expect("expected a damage resolution log");
    assert_eq!(damage_log.0, 0);
    assert_eq!(damage_log.1, ActorId::Enemy);
    assert!(damage_log.3 < damage_log.2);
    assert_eq!(damage_log.4, 105.5);
    assert_eq!(damage_log.5, 0.0);
    assert!(damage_log.6 > 0.0);
}

#[test]
fn t06_stun_blocks_action_until_expire() {
    let session = init_session(EngineInitPayload {
        meta: EngineMeta {
            game_id: "benchmark".into(),
            version_id: 1,
            data_hash: "hash".into(),
        },
        bundle: minimal_bundle(),
        engine_config: Some(EngineConfig {
            hp_attr_key: None,
            test_profile: Some(TestProfile::Full),
        }),
    })
    .unwrap();

    let output = run(&session, benchmark_stun_input()).unwrap();

    assert_eq!(output.result.action_label, "benchmark_auto_battle");
    assert_eq!(output.result.stop_reason, crate::model::StopReason::Completed);
    assert!(!output.events.is_empty());

    let runtime = run_benchmark_runtime_for_test(&session, benchmark_stun_input()).unwrap();

    let stun_start = runtime
        .logs
        .iter()
        .enumerate()
        .find_map(|entry| match entry {
            (
                index,
                RuntimeLog::StunApplied {
                    t_ms,
                    actor_id,
                    until_ms,
                },
            ) => Some((index, *t_ms, *actor_id, *until_ms)),
            _ => None,
        })
        .expect("expected a stun start log");
    assert_eq!(stun_start.1, 0);
    assert_eq!(stun_start.2, ActorId::SelfActor);

    let stun_end = runtime
        .logs
        .iter()
        .enumerate()
        .find_map(|entry| match entry {
            (index, RuntimeLog::StunExpired { t_ms, actor_id }) => Some((index, *t_ms, *actor_id)),
            _ => None,
        })
        .expect("expected a stun end log");
    assert_eq!(stun_end.1, stun_start.3);
    assert_eq!(stun_end.2, ActorId::SelfActor);

    let blocked_log = runtime
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::ActionBlocked {
                actor_id,
                action_id,
                retry_at_ms,
                ..
            } if *actor_id == ActorId::SelfActor => Some((action_id.as_str(), *retry_at_ms)),
            _ => None,
        })
        .expect("expected a blocked action log while stunned");
    assert_eq!(blocked_log.0, "skill_arcane_shift");
    assert_eq!(blocked_log.1, stun_start.3);

    let self_action = runtime
        .logs
        .iter()
        .enumerate()
        .find_map(|entry| match entry {
            (
                index,
                RuntimeLog::ActionChosen {
                    t_ms,
                    actor_id,
                    action_id,
                    ..
                },
            ) if *actor_id == ActorId::SelfActor => Some((index, *t_ms, action_id.as_str())),
            _ => None,
        })
        .expect("expected a self action after stun");
    assert_eq!(self_action.2, "skill_basic_attack");
    assert!(self_action.0 > stun_end.0);
    assert!(self_action.1 >= stun_end.1);
    assert_eq!(output.events[0].t_ms, self_action.1);
}

#[test]
fn t07_black_cleaver_expires_and_restores_armor() {
    let session = init_session(EngineInitPayload {
        meta: EngineMeta {
            game_id: "benchmark".into(),
            version_id: 1,
            data_hash: "hash".into(),
        },
        bundle: minimal_bundle(),
        engine_config: Some(EngineConfig {
            hp_attr_key: None,
            test_profile: Some(TestProfile::Full),
        }),
    })
    .unwrap();

    let output = run(&session, benchmark_black_cleaver_expire_input()).unwrap();

    assert_eq!(output.result.action_label, "benchmark_auto_battle");
    assert_eq!(output.result.stop_reason, crate::model::StopReason::Completed);
    assert!(!output.events.is_empty());

    let runtime = run_benchmark_runtime_for_test(&session, benchmark_black_cleaver_expire_input()).unwrap();

    let changed_log = runtime
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::BlackCleaverChanged {
                t_ms,
                actor_id,
                stacks,
                armor_after,
                expire_at_ms,
            } => Some((*t_ms, *actor_id, *stacks, *armor_after, *expire_at_ms)),
            _ => None,
        })
        .expect("expected a BlackCleaverChanged log");
    assert_eq!(changed_log.0, 0);
    assert_eq!(changed_log.1, ActorId::Enemy);
    assert!(changed_log.2 >= 1);

    let expired_log = runtime
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::BlackCleaverExpired {
                t_ms,
                actor_id,
                armor_after,
            } => Some((*t_ms, *actor_id, *armor_after)),
            _ => None,
        })
        .expect("expected a BlackCleaverExpired log");
    assert_eq!(expired_log.0, changed_log.4);
    assert_eq!(expired_log.1, ActorId::Enemy);
    assert!(changed_log.3 < expired_log.2);

    let enemy_armor_base = runtime.actor(ActorId::Enemy).base_attr("armor");
    let enemy_armor_current = runtime.actor(ActorId::Enemy).attr("armor");
    assert_eq!(expired_log.2, enemy_armor_base);
    assert_eq!(enemy_armor_current, enemy_armor_base);
}

#[test]
fn t08_enemy_dead_stop_reason_and_output_integrity() {
    let session = init_session(EngineInitPayload {
        meta: EngineMeta {
            game_id: "benchmark".into(),
            version_id: 1,
            data_hash: "hash".into(),
        },
        bundle: minimal_bundle(),
        engine_config: Some(EngineConfig {
            hp_attr_key: None,
            test_profile: Some(TestProfile::Full),
        }),
    })
    .unwrap();

    let output = run(&session, benchmark_final_kill_input()).unwrap();

    assert_eq!(output.result.action_label, "benchmark_auto_battle");
    assert_eq!(output.result.stop_reason, crate::model::StopReason::EnemyDead);
    assert_eq!(output.result.time_to_kill_enemy_ms, Some(500));
    assert_eq!(output.result.executed_hits, 2);
    assert!(!output.events.is_empty());
    assert!(!output.samples.is_empty());
    assert!(output.result.last_sample.is_some());

    let last_sample = output.result.last_sample.as_ref().unwrap();
    assert_eq!(last_sample.t_ms, 500);
    assert_eq!(last_sample.enemy_hp, 0.0);
    assert_eq!(output.samples.last().map(|sample| sample.enemy_hp), Some(0.0));
    assert_eq!(output.events[0].t_ms, 500);
    assert_eq!(output.events[1].t_ms, 500);
    assert!(output.events[0].enemy_hp_after > 0.0);
    assert_eq!(output.events.last().map(|event| event.enemy_hp_after), Some(0.0));
    assert!(!output.events[0].components.is_empty());
    assert!(!output.events[1].components.is_empty());

    let runtime = run_benchmark_runtime_for_test(&session, benchmark_final_kill_input()).unwrap();
    assert_eq!(runtime.stop_reason, Some(crate::model::StopReason::EnemyDead));
    assert!(runtime.actor(ActorId::Enemy).is_dead());
}

#[test]
fn t09_no_shield_profile_ignores_shield_absorption() {
    let session = benchmark_session(TestProfile::NoShield);

    let output = run(&session, benchmark_generate_shield_input()).unwrap();
    assert_eq!(output.result.stop_reason, crate::model::StopReason::Completed);
    assert_eq!(output.events.len(), 1);
    assert!(output.result.total_damage_to_enemy > 0.0);

    let first_event = &output.events[0];
    assert!(first_event.enemy_hp_after < first_event.enemy_hp_before);

    let runtime = run_benchmark_runtime_for_test(&session, benchmark_generate_shield_input()).unwrap();
    let damage_log = runtime
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::DamageResolved {
                target_shield_before,
                target_shield_after,
                total_hp_damage,
                ..
            } => Some((*target_shield_before, *target_shield_after, *total_hp_damage)),
            _ => None,
        })
        .expect("expected a damage resolution log");
    assert_eq!(damage_log.0, damage_log.1);
    assert!(damage_log.0 > 0.0);
    assert!(damage_log.2 > 0.0);
}

#[test]
fn t10_bucket_identity_profile_skips_mitigation() {
    let full_session = benchmark_session(TestProfile::Full);
    let bucket_identity_session = benchmark_session(TestProfile::BucketIdentity);

    let full_output = run(&full_session, benchmark_input()).unwrap();
    let bucket_identity_output = run(&bucket_identity_session, benchmark_input()).unwrap();

    let full_component = &full_output.events[0].components[0];
    let bucket_identity_component = &bucket_identity_output.events[0].components[0];

    assert!(full_component.dealt_damage < full_component.raw_damage);
    assert_eq!(bucket_identity_component.dealt_damage, bucket_identity_component.raw_damage);
    assert!(bucket_identity_output.result.total_damage_to_enemy > full_output.result.total_damage_to_enemy);
}

#[test]
fn t11_no_control_profile_allows_action_while_stunned() {
    let session = benchmark_session(TestProfile::NoControl);

    let output = run(&session, benchmark_stun_input()).unwrap();
    assert_eq!(output.result.stop_reason, crate::model::StopReason::Completed);
    assert_eq!(output.events[0].t_ms, 0);

    let runtime = run_benchmark_runtime_for_test(&session, benchmark_stun_input()).unwrap();
    let blocked = runtime
        .logs
        .iter()
        .any(|entry| matches!(entry, RuntimeLog::ActionBlocked { .. }));
    assert!(!blocked);

    let self_action = runtime
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::ActionChosen {
                t_ms,
                actor_id,
                action_id,
                ..
            } if *actor_id == ActorId::SelfActor => Some((*t_ms, action_id.as_str())),
            _ => None,
        })
        .expect("expected an immediate self action");
    assert_eq!(self_action.0, 0);
    assert_eq!(self_action.1, "skill_basic_attack");
}

#[test]
fn t12_formula_bypass_profile_uses_fallback_values() {
    let full_session = benchmark_session(TestProfile::Full);
    let formula_bypass_session = benchmark_session(TestProfile::FormulaBypass);

    let full_output = run(&full_session, benchmark_input()).unwrap();
    let formula_bypass_output = run(&formula_bypass_session, benchmark_input()).unwrap();

    let full_components = &full_output.events[0].components;
    let formula_bypass_components = &formula_bypass_output.events[0].components;

    assert_eq!(formula_bypass_components[0].raw_damage, 100.0);
    assert_eq!(formula_bypass_components[1].raw_damage, 30.0);
    assert_eq!(formula_bypass_components[2].raw_damage, 20.0);
    assert_ne!(formula_bypass_components[0].raw_damage, full_components[0].raw_damage);
    assert_ne!(formula_bypass_components[1].raw_damage, full_components[1].raw_damage);
    assert_ne!(formula_bypass_components[2].raw_damage, full_components[2].raw_damage);
}

#[test]
fn t13_hp_regen_ticks_every_second_until_stop() {
    let session = benchmark_session(TestProfile::Full);

    let runtime = run_benchmark_runtime_for_test(&session, benchmark_black_cleaver_expire_input()).unwrap();

    let enemy_regen_ticks = runtime
        .logs
        .iter()
        .filter_map(|entry| match entry {
            RuntimeLog::HealApplied {
                t_ms,
                actor_id,
                amount,
                reason,
                ..
            } if *actor_id == ActorId::Enemy && reason == "hp_regen" => Some((*t_ms, *amount)),
            _ => None,
        })
        .collect::<Vec<_>>();

    assert_eq!(enemy_regen_ticks.len(), 5);
    assert_eq!(enemy_regen_ticks[0], (1_000, 30.0));
    assert_eq!(enemy_regen_ticks[1], (2_000, 30.0));
    assert_eq!(enemy_regen_ticks[2], (3_000, 30.0));
    assert_eq!(enemy_regen_ticks[3], (4_000, 30.0));
    assert_eq!(enemy_regen_ticks[4], (5_000, 30.0));
}

#[test]
fn t14_mana_regen_ticks_restore_self_mana_after_skill_cast() {
    let session = benchmark_session(TestProfile::Full);

    let runtime = run_benchmark_runtime_for_test(&session, benchmark_black_cleaver_expire_input()).unwrap();

    let self_mana_regen_ticks = runtime
        .logs
        .iter()
        .filter_map(|entry| match entry {
            RuntimeLog::ManaRestored {
                t_ms,
                actor_id,
                amount,
                ..
            } if *actor_id == ActorId::SelfActor => Some((*t_ms, *amount)),
            _ => None,
        })
        .collect::<Vec<_>>();

    assert_eq!(self_mana_regen_ticks.len(), 5);
    assert_eq!(self_mana_regen_ticks[0], (1_000, 5.0));
    assert_eq!(self_mana_regen_ticks[1], (2_000, 5.0));
    assert_eq!(self_mana_regen_ticks[2], (3_000, 5.0));
    assert_eq!(self_mana_regen_ticks[3], (4_000, 5.0));
    assert_eq!(self_mana_regen_ticks[4], (5_000, 5.0));

    let self_actor = runtime.actor(ActorId::SelfActor);
    assert_eq!(self_actor.mana_current, self_actor.base_attr("mana"));
}

#[test]
fn t15_insufficient_mana_blocks_direct_skill_cast() {
    let session = benchmark_session(TestProfile::Full);
    let input = with_self_mana_delta(benchmark_mystic_shot_input(), -980.0);

    let output = run(&session, input.clone()).unwrap();
    assert_eq!(output.result.stop_reason, crate::model::StopReason::Completed);
    assert_eq!(output.result.total_damage_to_enemy, 0.0);
    assert!(output.events.is_empty());

    let runtime = run_benchmark_runtime_for_test(&session, input).unwrap();
    let blocked_log = runtime
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::ActionBlocked {
                actor_id,
                action_id,
                reason,
                current_mana,
                required_mana,
                ..
            } if *actor_id == ActorId::SelfActor && reason == "mana" => {
                Some((action_id.as_str(), *current_mana, *required_mana))
            }
            _ => None,
        })
        .expect("expected a mana-blocked action log");
    assert_eq!(blocked_log.0, SKILL_MYSTIC_SHOT);
    assert_eq!(blocked_log.1, Some(20.0));
    assert_eq!(blocked_log.2, Some(25.0));

    let spent = runtime.logs.iter().any(|entry| {
        matches!(
            entry,
            RuntimeLog::ManaSpent { action_id, .. } if action_id == SKILL_MYSTIC_SHOT
        )
    });
    assert!(!spent);
    assert_eq!(runtime.actor(ActorId::SelfActor).mana_current, 20.0);
    assert_eq!(runtime.actor(ActorId::SelfActor).action_ready_at(SKILL_MYSTIC_SHOT), 0);
}

#[test]
fn t16_auto_battle_falls_back_to_basic_attack_when_skills_are_oom() {
    let session = benchmark_session(TestProfile::Full);
    let input = with_self_mana_delta(benchmark_final_kill_input(), -990.0);

    let output = run(&session, input.clone()).unwrap();
    assert!(!output.events.is_empty());
    assert_eq!(output.events[0].components[0].source_kind, DamageSourceKind::BasicAttack);
    assert_eq!(output.events[0].components[0].source_id, SKILL_BASIC_ATTACK);

    let runtime = run_benchmark_runtime_for_test(&session, input).unwrap();
    let blocked_actions = runtime
        .logs
        .iter()
        .filter_map(|entry| match entry {
            RuntimeLog::ActionBlocked {
                reason,
                action_id,
                actor_id,
                ..
            } if *actor_id == ActorId::SelfActor && reason == "mana" => Some(action_id.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert!(blocked_actions.contains(&SKILL_ARCANE_SHIFT));
    assert!(blocked_actions.contains(&SKILL_MYSTIC_SHOT));

    let first_action = runtime
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::ActionChosen {
                actor_id,
                action_id,
                t_ms,
                ..
            } if *actor_id == ActorId::SelfActor => Some((*t_ms, action_id.as_str())),
            _ => None,
        })
        .expect("expected a chosen self action");
    assert_eq!(first_action, (500, SKILL_BASIC_ATTACK));
}

#[test]
fn t17_same_tms_enemy_status_events_precede_self_action_in_full_battle() {
    let session = benchmark_session(TestProfile::Full);

    let runtime = run_benchmark_runtime_for_test(&session, benchmark_final_kill_input()).unwrap();

    let enemy_shield_or_stun_index = runtime
        .logs
        .iter()
        .enumerate()
        .find_map(|(index, entry)| match entry {
            RuntimeLog::ActionChosen {
                t_ms,
                actor_id,
                action_id,
                ..
            } if *actor_id == ActorId::Enemy
                && *t_ms == 0
                && (action_id == "skill_generate_shield" || action_id == "skill_stun") =>
            {
                Some(index)
            }
            RuntimeLog::StunApplied { t_ms, actor_id, .. } if *actor_id == ActorId::SelfActor && *t_ms == 0 => {
                Some(index)
            }
            _ => None,
        })
        .expect("expected an enemy control/status log at t=0");

    let first_self_action = runtime
        .logs
        .iter()
        .enumerate()
        .find_map(|(index, entry)| match entry {
            RuntimeLog::ActionChosen {
                t_ms,
                actor_id,
                action_id,
                ..
            } if *actor_id == ActorId::SelfActor => Some((index, *t_ms, action_id.as_str())),
            _ => None,
        })
        .expect("expected a self action after same-timestamp enemy events");

    assert!(first_self_action.0 > enemy_shield_or_stun_index);
    assert_eq!(first_self_action.1, 500);
    assert!(matches!(first_self_action.2, SKILL_ARCANE_SHIFT | SKILL_BASIC_ATTACK));
}

#[test]
fn t18_enemy_stun_blocks_enemy_actions_until_expire() {
    let config = EngineConfig {
        hp_attr_key: None,
        test_profile: Some(TestProfile::Full),
    };
    let compiled = compile_benchmark_catalog(&minimal_bundle(), &config).unwrap();
    let mut runtime = build_runtime(compiled.to_simulation_config(1_000, 128));

    apply_stun(&mut runtime, ActorId::Enemy, 500);
    runtime.push_event(
        0,
        0,
        InternalEvent::ActorDecide {
            actor_id: ActorId::Enemy,
        },
    );
    run_until_stop(&mut runtime).unwrap();

    let blocked_log = runtime
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::ActionBlocked {
                t_ms,
                actor_id,
                action_id,
                reason,
                retry_at_ms,
                ..
            } if *actor_id == ActorId::Enemy && reason == "stun" => {
                Some((*t_ms, action_id.as_str(), *retry_at_ms))
            }
            _ => None,
        })
        .expect("expected enemy action to be blocked by stun");
    assert_eq!(blocked_log, (0, "skill_generate_shield", 500));

    let premature_enemy_action = runtime.logs.iter().find_map(|entry| match entry {
        RuntimeLog::ActionChosen {
            t_ms,
            actor_id,
            action_id,
            ..
        } if *actor_id == ActorId::Enemy && *t_ms < 500 => Some((*t_ms, action_id.as_str())),
        _ => None,
    });
    assert!(premature_enemy_action.is_none());

    let resumed_enemy_action = runtime
        .logs
        .iter()
        .find_map(|entry| match entry {
            RuntimeLog::ActionChosen {
                t_ms,
                actor_id,
                action_id,
                ..
            } if *actor_id == ActorId::Enemy && *t_ms >= 500 => Some((*t_ms, action_id.as_str())),
            _ => None,
        })
        .expect("expected enemy to resume action after stun expires");
    assert_eq!(resumed_enemy_action, (500, "skill_generate_shield"));
}
