use crate::catalog::{compile_benchmark_catalog, CompiledCatalog};
use crate::model::{
    AttributeDefinition, CombatantInit, CombatantOverride, CombatantOverrides, DamageSourceKind, DamageType,
    EngineActionPlan, EngineConfig, EngineDamageComponent, EngineDamageEvent, EngineError, EngineInitPayload,
    EngineRunInput, EngineRunOutput, EngineRunResult, EngineSamplePoint, ErrorCode, GameDataBundle, Hero, Item,
    Skill, StopReason,
};
use crate::runtime::RuntimeState;
use crate::runtime::{ActionBehavior, ActorId};
use crate::sim::{
    run_benchmark_action_sequence, run_minimal_benchmark_battle, BenchmarkSequenceFinish,
    BenchmarkSequenceStep,
};
use crate::sim::run_single_benchmark_action;
use std::collections::{HashMap, HashSet};

const BORK_ITEM_ID: &str = "item_blade_of_the_ruined_king";
const NASHOR_ITEM_ID: &str = "item_nashors_tooth";
const BORK_CURRENT_HP_RATIO: f64 = 0.12;
const NASHOR_ON_HIT_BASE: f64 = 15.0;
const NASHOR_AP_RATIO: f64 = 0.15;
const BASIC_ATTACK_LABEL: &str = "\u{5E73}A";
const BENCHMARK_FINAL_KILL_CAST_COUNT: u32 = 3;
const BORK_PASSIVE_LABEL: &str =
    "\u{7834}\u{8D25}\u{738B}\u{8005}\u{4E4B}\u{5203}\u{88AB}\u{52A8}\u{FF08}\u{5F53}\u{524D}\u{751F}\u{547D}\u{503C}\u{FF09}";
const NASHOR_PASSIVE_LABEL: &str = "\u{7EB3}\u{4EC0}\u{4E4B}\u{7259}\u{88AB}\u{52A8}";

#[derive(Clone)]
pub struct EngineSession {
    catalog: Catalog,
    hp_attr_key: String,
    benchmark_catalog: Option<CompiledCatalog>,
}

impl EngineSession {
    #[cfg(test)]
    pub(crate) fn has_benchmark_catalog(&self) -> bool {
        self.benchmark_catalog.is_some()
    }
}

#[derive(Clone)]
struct Catalog {
    attribute_keys: HashSet<String>,
    default_stats: HashMap<String, f64>,
    heroes_by_id: HashMap<String, Hero>,
    items_by_id: HashMap<String, Item>,
    skills_by_id: HashMap<String, Skill>,
}

#[derive(Clone)]
struct CombatantState {
    stats: HashMap<String, f64>,
    base_hero_stats: HashMap<String, f64>,
    item_ids: Vec<String>,
    hp: f64,
}

struct PendingDamageComponent {
    source_kind: DamageSourceKind,
    source_id: String,
    label: String,
    damage_type: DamageType,
    raw_damage: f64,
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
    let hp_attr_key = resolved_engine_config.resolved_hp_attr_key().to_string();
    let benchmark_catalog = if resolved_engine_config.test_profile.is_some() {
        Some(compile_benchmark_catalog(&bundle, &resolved_engine_config)?)
    } else {
        None
    };
    let catalog = build_catalog(bundle)?;

    if !catalog.attribute_keys.contains(&hp_attr_key) {
        return Err(semantic_error(format!("Unknown hp attr key: {hp_attr_key}")));
    }

    Ok(EngineSession {
        catalog,
        hp_attr_key,
        benchmark_catalog,
    })
}

pub fn run(session: &EngineSession, input: EngineRunInput) -> Result<EngineRunOutput, EngineError> {
    if let Some(benchmark_catalog) = &session.benchmark_catalog {
        return run_benchmark_skeleton(benchmark_catalog, input);
    }

    validate_input(&session.catalog, &input)?;

    let self_override = input.overrides.as_ref().and_then(|overrides| overrides.self_actor.as_ref());
    let enemy_override = input.overrides.as_ref().and_then(|overrides| overrides.enemy.as_ref());

    let self_actor = resolve_combatant(
        &session.catalog,
        &input.initial.self_actor,
        self_override,
        &session.hp_attr_key,
    )?;
    let mut enemy = resolve_combatant(
        &session.catalog,
        &input.initial.enemy,
        enemy_override,
        &session.hp_attr_key,
    )?;
    let max_duration_ms = (input.stop.max_seconds.max(0.001) * 1000.0).round() as u32;

    let mut t_ms: u32 = 0;
    let mut executed_hits: u32 = 0;
    let mut cumulative_damage_to_enemy = 0.0;
    let cumulative_damage_to_self = 0.0;
    let mut stop_reason = StopReason::Completed;
    let mut time_to_kill_enemy = None;
    let mut samples: Vec<EngineSamplePoint> = Vec::new();
    let mut events: Vec<EngineDamageEvent> = Vec::new();
    let mut event_sequence: u32 = 0;

    let push_sample = |samples: &mut Vec<EngineSamplePoint>,
                       t_ms: u32,
                       self_hp: f64,
                       enemy_hp: f64,
                       cumulative_damage_to_enemy: f64,
                       cumulative_damage_to_self: f64| {
        samples.push(EngineSamplePoint {
            t_ms,
            self_hp: round_number(self_hp),
            enemy_hp: round_number(enemy_hp),
            cumulative_damage_to_enemy: round_number(cumulative_damage_to_enemy),
            cumulative_damage_to_self: round_number(cumulative_damage_to_self),
        });
    };

    match &input.plan {
        EngineActionPlan::BasicAttack { count, skill_id } => {
            let attack_speed = self_actor.stats.get("attack_speed").copied().unwrap_or(0.0).max(0.1);
            let interval_ms = 1000.0 / attack_speed;
            let skill = skill_id
                .as_ref()
                .and_then(|id| session.catalog.skills_by_id.get(id));
            let attack_ratio = skill
                .and_then(|skill| skill.params.attack_ratio)
                .unwrap_or(1.0);
            let damage_type = skill
                .and_then(|skill| skill.params.damage_type.as_deref())
                .map(parse_damage_type)
                .unwrap_or(DamageType::Physical);

            for hit_index in 0..*count {
                t_ms = (((hit_index + 1) as f64) * interval_ms).round() as u32;
                if t_ms > max_duration_ms {
                    stop_reason = StopReason::MaxSeconds;
                    break;
                }
                let enemy_current_hp = enemy.hp;
                let basic_attack_label = skill
                    .and_then(|resolved_skill| resolved_skill.name.clone())
                    .unwrap_or_else(|| BASIC_ATTACK_LABEL.to_string());
                let mut components = vec![PendingDamageComponent {
                    source_kind: DamageSourceKind::BasicAttack,
                    source_id: skill
                        .map(|resolved_skill| resolved_skill.skill_id.clone())
                        .unwrap_or_else(|| "basic_attack".to_string()),
                    label: basic_attack_label,
                    damage_type,
                    raw_damage: self_actor.stats.get("ad").copied().unwrap_or(0.0) * attack_ratio,
                }];

                if self_actor.item_ids.iter().any(|item_id| item_id == BORK_ITEM_ID) {
                    components.push(PendingDamageComponent {
                        source_kind: DamageSourceKind::Item,
                        source_id: BORK_ITEM_ID.to_string(),
                        label: BORK_PASSIVE_LABEL.to_string(),
                        damage_type: DamageType::Physical,
                        raw_damage: enemy_current_hp * BORK_CURRENT_HP_RATIO,
                    });
                }

                if self_actor.item_ids.iter().any(|item_id| item_id == NASHOR_ITEM_ID) {
                    components.push(PendingDamageComponent {
                        source_kind: DamageSourceKind::Item,
                        source_id: NASHOR_ITEM_ID.to_string(),
                        label: NASHOR_PASSIVE_LABEL.to_string(),
                        damage_type: DamageType::Magic,
                        raw_damage: NASHOR_ON_HIT_BASE
                            + self_actor.stats.get("ap").copied().unwrap_or(0.0) * NASHOR_AP_RATIO,
                    });
                }

                apply_enemy_damage_event(
                    format!("{} {}", BASIC_ATTACK_LABEL, hit_index + 1),
                    components,
                    t_ms,
                    &self_actor,
                    &mut enemy,
                    &mut executed_hits,
                    &mut cumulative_damage_to_enemy,
                    cumulative_damage_to_self,
                    &mut samples,
                    &mut events,
                    &mut event_sequence,
                    &mut stop_reason,
                    &mut time_to_kill_enemy,
                    &push_sample,
                );
                if enemy.hp <= 0.0 {
                    break;
                }
            }
        }
        EngineActionPlan::CastSkill {
            skill_id,
            skill_level,
            cast_count,
        } => {
            let skill = session
                .catalog
                .skills_by_id
                .get(skill_id)
                .ok_or_else(|| semantic_error(format!("Skill not found: {skill_id}")))?;

            let resolved_skill_level =
                clamp_skill_level(skill_level.unwrap_or(skill.params.default_skill_level.unwrap_or(1)));
            let hits_per_cast = skill.params.hit_count.unwrap_or(1).max(1);
            let total_hits = hits_per_cast * cast_count.unwrap_or(1).max(1);
            let hit_interval_ms = skill.params.hit_interval_ms.unwrap_or(100).max(1);
            let base_damage = resolve_base_damage(skill, resolved_skill_level);
            let ad_ratio = skill.params.ad_ratio.unwrap_or(0.0);
            let ap_ratio = skill.params.ap_ratio.unwrap_or(0.0);
            let bonus_attack_speed_ratio = skill.params.bonus_attack_speed_ratio.unwrap_or(0.0);
            let damage_type = parse_damage_type(skill.params.damage_type.as_deref().unwrap_or("magic"));
            let bonus_attack_speed = (self_actor.stats.get("attack_speed").copied().unwrap_or(0.0)
                - self_actor.base_hero_stats.get("attack_speed").copied().unwrap_or(0.0))
                .max(0.0);

            for hit_index in 0..total_hits {
                t_ms = if hit_index == 0 {
                    0
                } else {
                    hit_index * hit_interval_ms
                };
                if t_ms > max_duration_ms {
                    stop_reason = StopReason::MaxSeconds;
                    break;
                }
                let raw_damage = base_damage
                    + self_actor.stats.get("ad").copied().unwrap_or(0.0)
                        * ad_ratio
                        * (1.0 + bonus_attack_speed * bonus_attack_speed_ratio)
                    + self_actor.stats.get("ap").copied().unwrap_or(0.0) * ap_ratio;
                let skill_label = skill.name.clone().unwrap_or_else(|| skill.skill_id.clone());
                apply_enemy_damage_event(
                    skill_label.clone(),
                    vec![PendingDamageComponent {
                        source_kind: DamageSourceKind::Skill,
                        source_id: skill.skill_id.clone(),
                        label: skill_label,
                        damage_type,
                        raw_damage,
                    }],
                    t_ms,
                    &self_actor,
                    &mut enemy,
                    &mut executed_hits,
                    &mut cumulative_damage_to_enemy,
                    cumulative_damage_to_self,
                    &mut samples,
                    &mut events,
                    &mut event_sequence,
                    &mut stop_reason,
                    &mut time_to_kill_enemy,
                    &push_sample,
                );
                if enemy.hp <= 0.0 {
                    break;
                }
            }

            if stop_reason == StopReason::Completed {
                let channel_duration_ms = skill
                    .params
                    .channel_duration_ms
                    .unwrap_or(hit_interval_ms.saturating_mul(total_hits));
                t_ms = t_ms.max(channel_duration_ms);
                if t_ms > max_duration_ms {
                    t_ms = max_duration_ms;
                    stop_reason = StopReason::MaxSeconds;
                }
            }
        }
    }

    let last_sample = samples.last().cloned();
    Ok(EngineRunOutput {
        result: EngineRunResult {
            stop_reason,
            time_to_kill_enemy_ms: time_to_kill_enemy,
            time_to_die_ms: None,
            total_damage_to_enemy: round_number(cumulative_damage_to_enemy),
            total_damage_to_self: round_number(cumulative_damage_to_self),
            executed_hits,
            action_duration_ms: t_ms,
            action_label: build_action_label(&session.catalog.skills_by_id, &input.plan),
            last_sample,
        },
        samples,
        events,
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
    BasicAttack {
        action_id: String,
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
) -> Option<&'a crate::runtime::ActionRuntime> {
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
                return Err(invalid_input("basic_attack.count must be greater than 0"));
            }
            let action_id = match skill_id {
                Some(action_id) => {
                    let action = find_benchmark_action(benchmark_catalog, ActorId::SelfActor, action_id)
                        .ok_or_else(|| semantic_error(format!("benchmark self action not found: {action_id}")))?;
                    if action.behavior != ActionBehavior::BasicAttack {
                        return Err(semantic_error(format!(
                            "benchmark action '{}' is not a basic attack action",
                            action_id
                        )));
                    }
                    action_id.clone()
                }
                None => find_first_action_by_behavior(benchmark_catalog, ActorId::SelfActor, ActionBehavior::BasicAttack)
                    .ok_or_else(|| semantic_error("benchmark self actor has no basic attack action"))?,
            };
            Ok(BenchmarkRoute::BasicAttack { action_id })
        }
        EngineActionPlan::CastSkill {
            skill_id,
            cast_count,
            ..
        } => {
            if let Some(action) = find_benchmark_action(benchmark_catalog, ActorId::SelfActor, skill_id) {
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
                        .ok_or_else(|| semantic_error("benchmark self actor has no basic attack action"))?;
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
                    _ => Err(semantic_error(format!(
                        "benchmark enemy action '{}' is not mapped to a benchmark scenario",
                        skill_id
                    ))),
                };
            }
            if cast_count == &Some(BENCHMARK_FINAL_KILL_CAST_COUNT) {
                if benchmark_catalog
                    .benchmark
                    .skill_defs
                    .get(skill_id)
                    .is_some_and(|skill| skill.final_kill_enemy_hp_override.is_some())
                {
                    return Ok(BenchmarkRoute::FinalKill {
                        skill_id: skill_id.clone(),
                    });
                }
            }
            Err(semantic_error(format!(
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
        return Err(invalid_input("stop.maxSeconds must be greater than 0"));
    }
    let route = resolve_benchmark_route(benchmark_catalog, &input.plan)?;

    let max_duration_ms = (input.stop.max_seconds.max(0.001) * 1000.0).round() as u32;
    let overrides = input.overrides.clone();
    let mut simulation_config = benchmark_catalog.to_simulation_config(max_duration_ms, 1024);
    apply_benchmark_overrides(&mut simulation_config, overrides.as_ref());
    let runtime = match route {
        BenchmarkRoute::BasicAttack { action_id } => {
            run_single_benchmark_action(simulation_config, ActorId::SelfActor, &action_id, false)?
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

fn run_benchmark_final_kill(
    mut config: crate::runtime::SimulationConfig,
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
            .insert(crate::runtime::ATTR_HP.to_string(), enemy_hp_override);
    }
    run_minimal_benchmark_battle(config)
}

fn apply_benchmark_overrides(
    simulation_config: &mut crate::runtime::SimulationConfig,
    overrides: Option<&CombatantOverrides>,
) {
    let Some(overrides) = overrides else {
        return;
    };
    apply_benchmark_actor_override(&mut simulation_config.self_actor, overrides.self_actor.as_ref());
    apply_benchmark_actor_override(&mut simulation_config.enemy_actor, overrides.enemy.as_ref());
}

fn apply_benchmark_actor_override(
    actor: &mut crate::runtime::ActorTemplate,
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
    let benchmark_catalog = session
        .benchmark_catalog
        .as_ref()
        .ok_or_else(|| semantic_error("benchmark catalog not initialized"))?;
    run_benchmark_runtime(benchmark_catalog, input)
}


#[allow(clippy::too_many_arguments)]
fn apply_enemy_damage_event<F>(
    label: String,
    pending_components: Vec<PendingDamageComponent>,
    t_ms: u32,
    self_actor: &CombatantState,
    enemy: &mut CombatantState,
    executed_hits: &mut u32,
    cumulative_damage_to_enemy: &mut f64,
    cumulative_damage_to_self: f64,
    samples: &mut Vec<EngineSamplePoint>,
    events: &mut Vec<EngineDamageEvent>,
    event_sequence: &mut u32,
    stop_reason: &mut StopReason,
    time_to_kill_enemy: &mut Option<u32>,
    push_sample: &F,
) where
    F: Fn(&mut Vec<EngineSamplePoint>, u32, f64, f64, f64, f64),
{
    let enemy_hp_before = enemy.hp;
    let components = pending_components
        .into_iter()
        .map(|component| EngineDamageComponent {
            source_kind: component.source_kind,
            source_id: component.source_id,
            label: component.label,
            damage_type: component.damage_type,
            raw_damage: round_number(component.raw_damage),
            dealt_damage: apply_mitigation(component.raw_damage, component.damage_type, &enemy.stats),
        })
        .collect::<Vec<_>>();
    let total_raw_damage = round_number(components.iter().map(|component| component.raw_damage).sum::<f64>());
    let total_dealt_damage = round_number(components.iter().map(|component| component.dealt_damage).sum::<f64>());

    enemy.hp = (enemy.hp - total_dealt_damage).max(0.0);
    *executed_hits += 1;
    *cumulative_damage_to_enemy += total_dealt_damage;
    *event_sequence += 1;
    events.push(EngineDamageEvent {
        sequence: *event_sequence,
        t_ms,
        label,
        enemy_hp_before: round_number(enemy_hp_before),
        enemy_hp_after: round_number(enemy.hp),
        total_raw_damage,
        total_dealt_damage,
        components,
    });
    push_sample(
        samples,
        t_ms,
        self_actor.hp,
        enemy.hp,
        *cumulative_damage_to_enemy,
        cumulative_damage_to_self,
    );
    if enemy.hp <= 0.0 && time_to_kill_enemy.is_none() {
        *time_to_kill_enemy = Some(t_ms);
        *stop_reason = StopReason::EnemyDead;
    }
}

fn build_catalog(bundle: GameDataBundle) -> Result<Catalog, EngineError> {
    let attribute_keys: HashSet<String> = bundle
        .attribute_definitions
        .iter()
        .map(|attribute| attribute.attr_key.clone())
        .collect();
    let default_stats = build_default_stats(&bundle.attribute_definitions);
    let heroes_by_id = bundle
        .heroes
        .into_iter()
        .map(|hero| (hero.hero_id.clone(), hero))
        .collect();
    let items_by_id = bundle
        .items
        .into_iter()
        .map(|item| (item.item_id.clone(), item))
        .collect();
    let skills_by_id = bundle
        .skills
        .into_iter()
        .map(|skill| (skill.skill_id.clone(), skill))
        .collect();

    if attribute_keys.is_empty() {
        return Err(invalid_input("bundle.attributeDefinitions cannot be empty"));
    }

    Ok(Catalog {
        attribute_keys,
        default_stats,
        heroes_by_id,
        items_by_id,
        skills_by_id,
    })
}

fn validate_input(catalog: &Catalog, input: &EngineRunInput) -> Result<(), EngineError> {
    if input.stop.max_seconds <= 0.0 {
        return Err(invalid_input("stop.maxSeconds must be greater than 0"));
    }
    validate_combatant_ref(catalog, &input.initial.self_actor)?;
    validate_combatant_ref(catalog, &input.initial.enemy)?;
    validate_override(catalog, input.overrides.as_ref().and_then(|overrides| overrides.self_actor.as_ref()))?;
    validate_override(catalog, input.overrides.as_ref().and_then(|overrides| overrides.enemy.as_ref()))?;

    match &input.plan {
        EngineActionPlan::BasicAttack { count, skill_id } => {
            if *count == 0 {
                return Err(invalid_input("basic_attack.count must be greater than 0"));
            }
            if let Some(skill_id) = skill_id {
                if !catalog.skills_by_id.contains_key(skill_id) {
                    return Err(semantic_error(format!("Skill not found: {skill_id}")));
                }
            }
        }
        EngineActionPlan::CastSkill { skill_id, .. } => {
            if !catalog.skills_by_id.contains_key(skill_id) {
                return Err(semantic_error(format!("Skill not found: {skill_id}")));
            }
        }
    }

    Ok(())
}

fn validate_combatant_ref(catalog: &Catalog, combatant: &CombatantInit) -> Result<(), EngineError> {
    if !catalog.heroes_by_id.contains_key(&combatant.hero_id) {
        return Err(semantic_error(format!("Hero not found: {}", combatant.hero_id)));
    }
    for item_id in &combatant.item_ids {
        if !catalog.items_by_id.contains_key(item_id) {
            return Err(semantic_error(format!("Item not found: {item_id}")));
        }
    }
    Ok(())
}

fn validate_override(catalog: &Catalog, override_input: Option<&CombatantOverride>) -> Result<(), EngineError> {
    let Some(override_input) = override_input else {
        return Ok(());
    };

    for attr_key in override_input.base_stats.keys() {
        if !catalog.attribute_keys.contains(attr_key) {
            return Err(semantic_error(format!("Unknown attribute override: {attr_key}")));
        }
    }

    for item_id in override_input
        .add_item_ids
        .iter()
        .chain(override_input.remove_item_ids.iter())
    {
        if !catalog.items_by_id.contains_key(item_id) {
            return Err(semantic_error(format!("Item not found: {item_id}")));
        }
    }

    Ok(())
}

fn resolve_combatant(
    catalog: &Catalog,
    init: &CombatantInit,
    override_input: Option<&CombatantOverride>,
    hp_attr_key: &str,
) -> Result<CombatantState, EngineError> {
    let hero = catalog
        .heroes_by_id
        .get(&init.hero_id)
        .ok_or_else(|| semantic_error(format!("Hero not found: {}", init.hero_id)))?;

    let mut base_hero_stats = catalog.default_stats.clone();
    merge_stats(&mut base_hero_stats, &hero.base_stats);

    let mut effective_item_ids: Vec<String> = init.item_ids.clone();
    if let Some(override_input) = override_input {
        let remove_item_ids: HashSet<&str> = override_input.remove_item_ids.iter().map(String::as_str).collect();
        effective_item_ids.retain(|item_id| !remove_item_ids.contains(item_id.as_str()));
        effective_item_ids.extend(override_input.add_item_ids.clone());
    }

    let mut item_stats = HashMap::new();
    for item_id in &effective_item_ids {
        let item = catalog
            .items_by_id
            .get(item_id)
            .ok_or_else(|| semantic_error(format!("Item not found: {item_id}")))?;
        merge_stats(&mut item_stats, &item.stats_modifier);
    }

    let mut stats = base_hero_stats.clone();
    merge_stats(&mut stats, &item_stats);
    if let Some(override_input) = override_input {
        merge_stats(&mut stats, &override_input.base_stats);
    }

    let hp = stats.get(hp_attr_key).copied().unwrap_or(0.0);

    Ok(CombatantState {
        stats,
        base_hero_stats,
        item_ids: effective_item_ids,
        hp,
    })
}

fn build_default_stats(attribute_definitions: &[AttributeDefinition]) -> HashMap<String, f64> {
    attribute_definitions
        .iter()
        .map(|attribute| (attribute.attr_key.clone(), attribute.default_value.unwrap_or(0.0)))
        .collect()
}

fn merge_stats(target: &mut HashMap<String, f64>, source: &HashMap<String, f64>) {
    for (key, value) in source {
        *target.entry(key.clone()).or_insert(0.0) += value;
    }
}

fn parse_damage_type(raw: &str) -> DamageType {
    match raw {
        "magic" => DamageType::Magic,
        "true" => DamageType::True,
        _ => DamageType::Physical,
    }
}

fn apply_mitigation(raw_damage: f64, damage_type: DamageType, stats: &HashMap<String, f64>) -> f64 {
    if matches!(damage_type, DamageType::True) {
        return round_number(raw_damage);
    }
    let resistance_key = if matches!(damage_type, DamageType::Physical) {
        "armor"
    } else {
        "magic_resist"
    };
    let resistance = stats.get(resistance_key).copied().unwrap_or(0.0);
    let reduced = if resistance >= 0.0 {
        raw_damage * (100.0 / (100.0 + resistance))
    } else {
        raw_damage * (2.0 - 100.0 / (100.0 - resistance))
    };
    round_number(reduced)
}

fn resolve_base_damage(skill: &Skill, skill_level: u32) -> f64 {
    if !skill.params.base_damage_by_skill_level.is_empty() {
        let index = (skill_level.saturating_sub(1) as usize).min(skill.params.base_damage_by_skill_level.len() - 1);
        return skill.params.base_damage_by_skill_level[index];
    }
    skill.params.base_damage.unwrap_or(0.0)
}

fn build_action_label(skills_by_id: &HashMap<String, Skill>, plan: &EngineActionPlan) -> String {
    match plan {
        EngineActionPlan::BasicAttack { count, .. } => format!("{} x{}", BASIC_ATTACK_LABEL, count),
        EngineActionPlan::CastSkill {
            skill_id,
            cast_count,
            ..
        } => {
            let skill_name = skills_by_id
                .get(skill_id)
                .and_then(|skill| skill.name.clone())
                .unwrap_or_else(|| skill_id.clone());
            match cast_count {
                Some(count) if *count > 1 => format!("{skill_name} x{count}"),
                _ => skill_name,
            }
        }
    }
}

fn clamp_skill_level(value: u32) -> u32 {
    value.clamp(1, 5)
}

fn round_number(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn invalid_input(message: impl Into<String>) -> EngineError {
    EngineError {
        code: ErrorCode::InvalidInput,
        message: message.into(),
    }
}

fn semantic_error(message: impl Into<String>) -> EngineError {
    EngineError {
        code: ErrorCode::SemanticError,
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{BundleMeta, CombatantOverrides, EngineMeta, InitialCombatants, SkillParams, StopCondition};

    fn base_bundle() -> GameDataBundle {
        GameDataBundle {
            meta: BundleMeta {
                game_id: "lol".into(),
                version_id: 69,
                version_code: "mvp_katarina_001".into(),
                data_hash: "hash".into(),
                generated_at: "2026-03-22T08:22:06Z".into(),
            },
            attribute_definitions: vec![
                AttributeDefinition { attr_key: "hp".into(), default_value: Some(0.0) },
                AttributeDefinition { attr_key: "ad".into(), default_value: Some(0.0) },
                AttributeDefinition { attr_key: "ap".into(), default_value: Some(0.0) },
                AttributeDefinition { attr_key: "attack_speed".into(), default_value: Some(0.0) },
                AttributeDefinition { attr_key: "armor".into(), default_value: Some(0.0) },
                AttributeDefinition { attr_key: "magic_resist".into(), default_value: Some(0.0) },
            ],
            heroes: vec![
                Hero {
                    hero_id: "hero_katarina".into(),
                    name: "Katarina".into(),
                    title: None,
                    base_stats: HashMap::from([
                        ("hp".into(), 2508.0),
                        ("ad".into(), 112.4),
                        ("ap".into(), 0.0),
                        ("attack_speed".into(), 0.66),
                        ("armor".into(), 107.9),
                        ("magic_resist".into(), 66.85),
                    ]),
                },
                Hero {
                    hero_id: "hero_dummy".into(),
                    name: "Dummy".into(),
                    title: None,
                    base_stats: HashMap::from([
                        ("hp".into(), 10000.0),
                        ("ad".into(), 0.0),
                        ("ap".into(), 0.0),
                        ("attack_speed".into(), 0.0),
                        ("armor".into(), 100.0),
                        ("magic_resist".into(), 100.0),
                    ]),
                },
            ],
            items: vec![
                Item {
                    item_id: "item_blade_of_the_ruined_king".into(),
                    name: Some("BORK".into()),
                    stats_modifier: HashMap::from([
                        ("ad".into(), 55.0),
                        ("attack_speed".into(), 0.3),
                    ]),
                },
                Item {
                    item_id: "item_nashors_tooth".into(),
                    name: Some("Nashor".into()),
                    stats_modifier: HashMap::from([
                        ("ap".into(), 90.0),
                        ("attack_speed".into(), 0.5),
                    ]),
                },
            ],
            skills: vec![
                Skill {
                    skill_id: "skill_katarina_basic_attack".into(),
                    name: Some("Basic Attack".into()),
                    params: SkillParams {
                        damage_type: Some("physical".into()),
                        attack_ratio: Some(1.0),
                        ..Default::default()
                    },
                },
                Skill {
                    skill_id: "skill_katarina_r".into(),
                    name: Some("Death Lotus".into()),
                    params: SkillParams {
                        damage_type: Some("magic".into()),
                        hit_count: Some(15),
                        hit_interval_ms: Some(167),
                        channel_duration_ms: Some(2500),
                        base_damage_by_skill_level: vec![25.0, 37.5, 50.0],
                        ad_ratio: Some(0.16),
                        ap_ratio: Some(0.19),
                        bonus_attack_speed_ratio: Some(0.5),
                        default_skill_level: Some(3),
                        ..Default::default()
                    },
                },
            ],
            benchmark: None,
        }
    }

    fn base_input(plan: EngineActionPlan, item_ids: Vec<String>) -> EngineRunInput {
        EngineRunInput {
            seed: None,
            stop: StopCondition { max_seconds: 10.0 },
            initial: InitialCombatants {
                self_actor: CombatantInit {
                    hero_id: "hero_katarina".into(),
                    level: Some(18),
                    item_ids,
                },
                enemy: CombatantInit {
                    hero_id: "hero_dummy".into(),
                    level: Some(1),
                    item_ids: vec![],
                },
            },
            overrides: Some(CombatantOverrides::default()),
            plan,
        }
    }

    fn session() -> EngineSession {
        init_session(EngineInitPayload {
            meta: EngineMeta {
                game_id: "lol".into(),
                version_id: 69,
                data_hash: "hash".into(),
            },
            bundle: base_bundle(),
            engine_config: None,
        })
        .unwrap()
    }

    #[test]
    fn item_stats_are_added_not_overwritten() {
        let session = session();

        let resolved = resolve_combatant(
            &session.catalog,
            &CombatantInit {
                hero_id: "hero_katarina".into(),
                level: Some(18),
                item_ids: vec![
                    "item_blade_of_the_ruined_king".into(),
                    "item_nashors_tooth".into(),
                ],
            },
            None,
            "hp",
        )
        .unwrap();

        assert_eq!(round_number(*resolved.stats.get("ad").unwrap()), 167.4);
        assert_eq!(round_number(*resolved.stats.get("ap").unwrap()), 90.0);
        assert_eq!(round_number(*resolved.stats.get("attack_speed").unwrap()), 1.46);
    }

    #[test]
    fn dual_items_increase_basic_attack_damage() {
        let session = session();

        let no_items = run(
            &session,
            base_input(
                EngineActionPlan::BasicAttack {
                    count: 10,
                    skill_id: Some("skill_katarina_basic_attack".into()),
                },
                vec![],
            ),
        )
        .unwrap();

        let dual_items = run(
            &session,
            base_input(
                EngineActionPlan::BasicAttack {
                    count: 10,
                    skill_id: Some("skill_katarina_basic_attack".into()),
                },
                vec![
                    "item_blade_of_the_ruined_king".into(),
                    "item_nashors_tooth".into(),
                ],
            ),
        )
        .unwrap();

        assert!(dual_items.result.total_damage_to_enemy > no_items.result.total_damage_to_enemy);
    }

    #[test]
    fn dual_items_basic_attack_emits_split_damage_events() {
        let session = session();

        let output = run(
            &session,
            base_input(
                EngineActionPlan::BasicAttack {
                    count: 2,
                    skill_id: Some("skill_katarina_basic_attack".into()),
                },
                vec![
                    "item_blade_of_the_ruined_king".into(),
                    "item_nashors_tooth".into(),
                ],
            ),
        )
        .unwrap();

        assert_eq!(output.events.len(), 2);
        assert_eq!(output.samples.len(), 2);

        let first_event = &output.events[0];
        assert_eq!(first_event.sequence, 1);
        assert_eq!(first_event.label, format!("{} 1", BASIC_ATTACK_LABEL));
        assert_eq!(first_event.enemy_hp_before, 10000.0);
        assert_eq!(first_event.enemy_hp_after, 9302.05);
        assert_eq!(first_event.total_raw_damage, 1395.9);
        assert_eq!(first_event.total_dealt_damage, 697.95);
        assert_eq!(first_event.components.len(), 3);

        assert_eq!(first_event.components[0].source_kind, DamageSourceKind::BasicAttack);
        assert_eq!(first_event.components[0].source_id, "skill_katarina_basic_attack");
        assert_eq!(first_event.components[0].damage_type, DamageType::Physical);
        assert_eq!(first_event.components[0].raw_damage, 167.4);
        assert_eq!(first_event.components[0].dealt_damage, 83.7);

        assert_eq!(first_event.components[1].source_kind, DamageSourceKind::Item);
        assert_eq!(first_event.components[1].source_id, BORK_ITEM_ID);
        assert_eq!(first_event.components[1].damage_type, DamageType::Physical);
        assert_eq!(first_event.components[1].raw_damage, 1200.0);
        assert_eq!(first_event.components[1].dealt_damage, 600.0);

        assert_eq!(first_event.components[2].source_kind, DamageSourceKind::Item);
        assert_eq!(first_event.components[2].source_id, NASHOR_ITEM_ID);
        assert_eq!(first_event.components[2].damage_type, DamageType::Magic);
        assert_eq!(first_event.components[2].raw_damage, 28.5);
        assert_eq!(first_event.components[2].dealt_damage, 14.25);

        let second_event = &output.events[1];
        assert_eq!(second_event.sequence, 2);
        assert_eq!(second_event.enemy_hp_before, 9302.05);
        assert_eq!(second_event.components[1].raw_damage, 1116.246);
        assert_eq!(second_event.components[1].dealt_damage, 558.123);
        assert!(second_event.components[1].raw_damage < first_event.components[1].raw_damage);

        assert_eq!(output.result.total_damage_to_enemy, 1354.023);
        assert_eq!(output.result.executed_hits, 2);
        assert_eq!(output.result.last_sample.as_ref().map(|sample| sample.enemy_hp), Some(8645.977));
    }

    #[test]
    fn dual_items_increase_death_lotus_damage() {
        let session = session();

        let no_items = run(
            &session,
            base_input(
                EngineActionPlan::CastSkill {
                    skill_id: "skill_katarina_r".into(),
                    skill_level: Some(3),
                    cast_count: None,
                },
                vec![],
            ),
        )
        .unwrap();

        let dual_items = run(
            &session,
            base_input(
                EngineActionPlan::CastSkill {
                    skill_id: "skill_katarina_r".into(),
                    skill_level: Some(3),
                    cast_count: None,
                },
                vec![
                    "item_blade_of_the_ruined_king".into(),
                    "item_nashors_tooth".into(),
                ],
            ),
        )
        .unwrap();

        assert!(dual_items.result.total_damage_to_enemy > no_items.result.total_damage_to_enemy);
    }

    #[test]
    fn engine_output_serializes_event_fields_for_json_abi() {
        let session = session();
        let output = run(
            &session,
            base_input(
                EngineActionPlan::BasicAttack {
                    count: 1,
                    skill_id: Some("skill_katarina_basic_attack".into()),
                },
                vec![
                    "item_blade_of_the_ruined_king".into(),
                    "item_nashors_tooth".into(),
                ],
            ),
        )
        .unwrap();

        let json = serde_json::to_value(output).unwrap();
        let event = &json["events"][0];
        let component = &event["components"][1];

        assert_eq!(event["sequence"].as_u64(), Some(1));
        assert_eq!(event["tMs"].as_u64(), Some(685));
        assert_eq!(event["totalDealtDamage"].as_f64(), Some(697.95));
        assert_eq!(component["sourceKind"].as_str(), Some("item"));
        assert_eq!(component["sourceId"].as_str(), Some(BORK_ITEM_ID));
        assert_eq!(component["damageType"].as_str(), Some("physical"));
        assert_eq!(component["dealtDamage"].as_f64(), Some(600.0));
    }
}
