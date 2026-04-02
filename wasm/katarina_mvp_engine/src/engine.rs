use crate::catalog::{compile_benchmark_catalog, CompiledCatalog};
use crate::combat_math::resolve_cooldown_ms;
use crate::model::{
    CombatantOverride, CombatantOverrides, EngineActionPlan, EngineConfig, EngineError,
    EngineInitPayload, EngineRunInput, EngineRunOutput,
};
use crate::runtime::RuntimeState;
use crate::types::{ActionBehavior, ActorId, ActorTemplate, ActionRuntime, SimulationConfig, ATTR_HP};
use crate::sim::{
    run_benchmark_action_sequence, run_minimal_benchmark_battle, BenchmarkSequenceFinish,
    BenchmarkSequenceStep,
};
use crate::sim::run_single_benchmark_action;
use std::collections::{HashMap, HashSet};

const BENCHMARK_FINAL_KILL_CAST_COUNT: u32 = 3;

#[derive(Clone)]
pub struct EngineSession {
    benchmark_catalog: CompiledCatalog,
}

impl EngineSession {
    #[cfg(test)]
    pub(crate) fn has_benchmark_catalog(&self) -> bool {
        true
    }
}

pub fn init_session(payload: EngineInitPayload) -> Result<EngineSession, EngineError> {
    let EngineInitPayload {
        meta: _,
        bundle,
        engine_config,
    } = payload;
    let resolved_engine_config = engine_config.unwrap_or(EngineConfig {
        hp_attr_key: None,
        test_profile: None,
    });
    let benchmark_catalog = compile_benchmark_catalog(&bundle, &resolved_engine_config)?;

    Ok(EngineSession {
        benchmark_catalog,
    })
}

pub fn run(session: &EngineSession, input: EngineRunInput) -> Result<EngineRunOutput, EngineError> {
    run_benchmark_skeleton(&session.benchmark_catalog, input)
}

/// Run a complete auto-battle from full HP until enemy dies or max time reached.
/// Useful for performance benchmarking without constructing an EngineRunInput.
pub fn run_full_battle(session: &EngineSession) -> Result<EngineRunOutput, EngineError> {
    use crate::sim::run_minimal_benchmark_battle;
    let config = session.benchmark_catalog.to_simulation_config(30_000, 4096);
    let runtime = run_minimal_benchmark_battle(config)?;
    Ok(EngineRunOutput {
        result: runtime.build_result(),
        samples: runtime.samples,
        events: runtime.damage_events,
    })
}

fn run_benchmark_skeleton(
    benchmark_catalog: &CompiledCatalog,
    input: EngineRunInput,
) -> Result<EngineRunOutput, EngineError> {
    let runtime = run_benchmark_runtime(benchmark_catalog, input)?;

    Ok(EngineRunOutput {
        result: runtime.build_result(),
        samples: runtime.samples,
        events: runtime.damage_events,
    })
}

enum BenchmarkRoute {
    BasicAttackSequence {
        action_id: String,
        count: u32,
    },
    SelfAction {
        action_id: String,
        continue_until_stop: bool,
    },
    ActionSequence {
        steps: Vec<BenchmarkSequenceStep>,
        finish: BenchmarkSequenceFinish,
    },
    FinalKill {
        skill_id: String,
    },
}

fn find_benchmark_action<'a>(
    benchmark_catalog: &'a CompiledCatalog,
    actor_id: ActorId,
    action_id: &str,
) -> Option<&'a ActionRuntime> {
    match actor_id {
        ActorId::SelfActor => benchmark_catalog.self_actor.actions.get(action_id),
        ActorId::Enemy => benchmark_catalog.enemy_actor.actions.get(action_id),
    }
}

fn find_first_action_by_behavior(
    benchmark_catalog: &CompiledCatalog,
    actor_id: ActorId,
    behavior: ActionBehavior,
) -> Option<String> {
    let actor = match actor_id {
        ActorId::SelfActor => &benchmark_catalog.self_actor,
        ActorId::Enemy => &benchmark_catalog.enemy_actor,
    };
    actor
        .priorities
        .iter()
        .find(|action_id| actor.actions.get(*action_id).is_some_and(|action| action.behavior == behavior))
        .cloned()
        .or_else(|| {
            actor.actions
                .values()
                .find(|action| action.behavior == behavior)
                .map(|action| action.action_id.clone())
        })
}

fn resolve_benchmark_route(
    benchmark_catalog: &CompiledCatalog,
    plan: &EngineActionPlan,
) -> Result<BenchmarkRoute, EngineError> {
    match plan {
        EngineActionPlan::BasicAttack { count, skill_id } => {
            if *count == 0 {
                return Err(EngineError::invalid_input("basic_attack.count must be greater than 0"));
            }
            let action_id = match skill_id {
                Some(action_id) => {
                    let action = find_benchmark_action(benchmark_catalog, ActorId::SelfActor, action_id)
                        .ok_or_else(|| EngineError::semantic(format!("benchmark self action not found: {action_id}")))?;
                    if action.behavior != ActionBehavior::BasicAttack {
                        return Err(EngineError::semantic(format!(
                            "benchmark action '{}' is not a basic attack action",
                            action_id
                        )));
                    }
                    action_id.clone()
                }
                None => find_first_action_by_behavior(benchmark_catalog, ActorId::SelfActor, ActionBehavior::BasicAttack)
                    .ok_or_else(|| EngineError::semantic("benchmark self actor has no basic attack action"))?,
            };
            Ok(BenchmarkRoute::BasicAttackSequence {
                action_id,
                count: *count,
            })
        }
        EngineActionPlan::CastSkill {
            skill_id,
            cast_count,
            ..
        } => {
            if let Some(action) = find_benchmark_action(benchmark_catalog, ActorId::SelfActor, skill_id) {
                if action.behavior == ActionBehavior::DamageWindowBurst {
                    let self_basic_attack_action = find_first_action_by_behavior(
                        benchmark_catalog,
                        ActorId::SelfActor,
                        ActionBehavior::BasicAttack,
                    )
                    .ok_or_else(|| EngineError::semantic("benchmark self actor has no basic attack action"))?;
                    return Ok(BenchmarkRoute::ActionSequence {
                        steps: vec![
                            BenchmarkSequenceStep::ExecuteAction {
                                actor_id: ActorId::SelfActor,
                                action_id: self_basic_attack_action,
                                advance_after_ms: 1,
                            },
                            BenchmarkSequenceStep::ExecuteAction {
                                actor_id: ActorId::SelfActor,
                                action_id: action.action_id.clone(),
                                advance_after_ms: 0,
                            },
                        ],
                        finish: BenchmarkSequenceFinish::Complete,
                    });
                }
                let continue_until_stop =
                    action.behavior == ActionBehavior::ArcaneShift || action.behavior == ActionBehavior::BasicAttack;
                return Ok(BenchmarkRoute::SelfAction {
                    action_id: action.action_id.clone(),
                    continue_until_stop,
                });
            }
            if let Some(action) = find_benchmark_action(benchmark_catalog, ActorId::Enemy, skill_id) {
                return match action.behavior {
                    ActionBehavior::GenerateShield => {
                        let self_basic_attack_action = find_first_action_by_behavior(
                            benchmark_catalog,
                            ActorId::SelfActor,
                            ActionBehavior::BasicAttack,
                        )
                        .ok_or_else(|| EngineError::semantic("benchmark self actor has no basic attack action"))?;
                        Ok(BenchmarkRoute::ActionSequence {
                            steps: vec![
                                BenchmarkSequenceStep::ExecuteAction {
                                    actor_id: ActorId::Enemy,
                                    action_id: action.action_id.clone(),
                                    advance_after_ms: 0,
                                },
                                BenchmarkSequenceStep::ExecuteAction {
                                    actor_id: ActorId::SelfActor,
                                    action_id: self_basic_attack_action,
                                    advance_after_ms: 1,
                                },
                                BenchmarkSequenceStep::ExecuteAction {
                                    actor_id: ActorId::Enemy,
                                    action_id: action.action_id.clone(),
                                    advance_after_ms: 0,
                                },
                            ],
                            finish: BenchmarkSequenceFinish::Complete,
                        })
                    }
                    ActionBehavior::Stun => Ok(BenchmarkRoute::ActionSequence {
                        steps: vec![
                            BenchmarkSequenceStep::ExecuteAction {
                                actor_id: ActorId::Enemy,
                                action_id: action.action_id.clone(),
                                advance_after_ms: 0,
                            },
                            BenchmarkSequenceStep::QueueActorDecide {
                                actor_id: ActorId::SelfActor,
                                delay_ms: 0,
                            },
                        ],
                        finish: BenchmarkSequenceFinish::UntilFirstDamageOrStop,
                    }),
                    _ => Err(EngineError::semantic(format!(
                        "benchmark enemy action '{}' is not mapped to a benchmark scenario",
                        skill_id
                    ))),
                };
            }
            if cast_count == &Some(BENCHMARK_FINAL_KILL_CAST_COUNT)
                && benchmark_catalog
                    .benchmark
                    .skill_defs
                    .get(skill_id)
                    .is_some_and(|skill| skill.final_kill_enemy_hp_override.is_some())
            {
                return Ok(BenchmarkRoute::FinalKill {
                    skill_id: skill_id.clone(),
                });
            }
            Err(EngineError::semantic(format!(
                "benchmark skeleton does not support action plan for skill '{}'",
                skill_id
            )))
        }
    }
}

fn run_benchmark_runtime(
    benchmark_catalog: &CompiledCatalog,
    input: EngineRunInput,
) -> Result<RuntimeState, EngineError> {
    if input.stop.max_seconds <= 0.0 {
        return Err(EngineError::invalid_input("stop.maxSeconds must be greater than 0"));
    }
    let route = resolve_benchmark_route(benchmark_catalog, &input.plan)?;

    let max_duration_ms = (input.stop.max_seconds.max(0.001) * 1000.0).round() as u32;
    let overrides = input.overrides.clone();
    let mut simulation_config = benchmark_catalog.to_simulation_config(max_duration_ms, 1024);
    apply_benchmark_overrides(&mut simulation_config, overrides.as_ref());
    let runtime = match route {
        BenchmarkRoute::BasicAttackSequence { action_id, count } => {
            let steps = build_basic_attack_sequence(&simulation_config.self_actor, &action_id, count)?;
            run_benchmark_action_sequence(simulation_config, &steps, BenchmarkSequenceFinish::Complete)?
        }
        BenchmarkRoute::SelfAction {
            action_id,
            continue_until_stop,
        } => run_single_benchmark_action(
            simulation_config,
            ActorId::SelfActor,
            &action_id,
            continue_until_stop,
        )?,
        BenchmarkRoute::ActionSequence { steps, finish } => {
            run_benchmark_action_sequence(simulation_config, &steps, finish)?
        }
        BenchmarkRoute::FinalKill { skill_id } => run_benchmark_final_kill(simulation_config, &skill_id)?,
    };

    Ok(runtime)
}

fn build_basic_attack_sequence(
    actor: &ActorTemplate,
    action_id: &str,
    count: u32,
) -> Result<Vec<BenchmarkSequenceStep>, EngineError> {
    let advance_after_ms = resolve_actor_action_cooldown_ms(actor, action_id)?;
    let mut steps = Vec::with_capacity(count as usize);
    for index in 0..count {
        steps.push(BenchmarkSequenceStep::ExecuteAction {
            actor_id: ActorId::SelfActor,
            action_id: action_id.to_string(),
            advance_after_ms: if index + 1 < count {
                advance_after_ms
            } else {
                0
            },
        });
    }
    Ok(steps)
}

fn resolve_actor_action_cooldown_ms(
    actor: &ActorTemplate,
    action_id: &str,
) -> Result<u32, EngineError> {
    let action = actor
        .actions
        .get(action_id)
        .ok_or_else(|| EngineError::semantic(format!("benchmark self action not found: {action_id}")))?;
    Ok(resolve_cooldown_ms(action.cooldown, &actor.attrs))
}

fn run_benchmark_final_kill(
    mut config: SimulationConfig,
    skill_id: &str,
) -> Result<RuntimeState, EngineError> {
    if let Some(enemy_hp_override) = config
        .benchmark
        .skill_defs
        .get(skill_id)
        .and_then(|skill| skill.final_kill_enemy_hp_override)
    {
        config
            .enemy_actor
            .attrs
            .insert(ATTR_HP.to_string(), enemy_hp_override);
    }
    run_minimal_benchmark_battle(config)
}

fn apply_benchmark_overrides(
    simulation_config: &mut SimulationConfig,
    overrides: Option<&CombatantOverrides>,
) {
    let Some(overrides) = overrides else {
        return;
    };
    apply_benchmark_actor_override(&mut simulation_config.self_actor, overrides.self_actor.as_ref());
    apply_benchmark_actor_override(&mut simulation_config.enemy_actor, overrides.enemy.as_ref());
}

fn apply_benchmark_actor_override(
    actor: &mut ActorTemplate,
    override_input: Option<&CombatantOverride>,
) {
    let Some(override_input) = override_input else {
        return;
    };

    merge_stats(&mut actor.attrs, &override_input.base_stats);

    let remove_item_ids: HashSet<&str> = override_input.remove_item_ids.iter().map(String::as_str).collect();
    actor
        .owned_items
        .retain(|item_id| !remove_item_ids.contains(item_id.as_str()));
    actor.owned_items.extend(override_input.add_item_ids.clone());
}

#[cfg(test)]
pub(crate) fn run_benchmark_runtime_for_test(
    session: &EngineSession,
    input: EngineRunInput,
) -> Result<RuntimeState, EngineError> {
    run_benchmark_runtime(&session.benchmark_catalog, input)
}

fn merge_stats(target: &mut HashMap<String, f64>, source: &HashMap<String, f64>) {
    for (key, value) in source {
        *target.entry(key.clone()).or_insert(0.0) += value;
    }
}
