use crate::effects::{
    apply_damage_packets_as_event, apply_generate_shield, apply_stun, expire_black_cleaver, expire_stun,
};
use crate::model::{DamageSourceKind, DamageType, EngineError, StopReason};
use crate::runtime::{
    build_runtime, reduce_skill_cooldowns, round_number, start_action_cooldown, ActionBehavior, ActorId,
    BenchmarkDotRuntime, BenchmarkSkillRuntimeDef, DamageFlags, DamagePacket, DotEffectKind, InternalEvent,
    RuntimeLog, RuntimeState, ScheduledEvent, SimulationConfig,
};

enum BenchmarkActionSelection {
    Ready(String),
    WaitUntil(u32),
}

#[derive(Debug, Clone)]
pub enum BenchmarkSequenceStep {
    ExecuteAction {
        actor_id: ActorId,
        action_id: String,
        advance_after_ms: u32,
    },
    QueueActorDecide {
        actor_id: ActorId,
        delay_ms: u32,
    },
}

#[derive(Debug, Clone, Copy)]
pub enum BenchmarkSequenceFinish {
    Complete,
    UntilFirstDamageOrStop,
}

#[allow(dead_code)]
pub fn run_first_basic_attack(config: SimulationConfig) -> Result<RuntimeState, EngineError> {
    let mut state = build_runtime(config);
    let action_id = find_action_id_by_behavior(&state, ActorId::SelfActor, ActionBehavior::BasicAttack)?;
    execute_benchmark_action(&mut state, ActorId::SelfActor, &action_id)?;
    if state.stop_reason.is_none() {
        state.stop_reason = Some(StopReason::Completed);
    }
    Ok(state)
}

#[allow(dead_code)]
pub fn run_first_mystic_shot(config: SimulationConfig) -> Result<RuntimeState, EngineError> {
    let mut state = build_runtime(config);
    let action_id = find_action_id_by_behavior(&state, ActorId::SelfActor, ActionBehavior::MysticShot)?;
    execute_benchmark_action(&mut state, ActorId::SelfActor, &action_id)?;
    if state.stop_reason.is_none() {
        state.stop_reason = Some(StopReason::Completed);
    }
    Ok(state)
}

#[allow(dead_code)]
pub fn run_first_arcane_shift(config: SimulationConfig) -> Result<RuntimeState, EngineError> {
    let mut state = build_runtime(config);
    let action_id = find_action_id_by_behavior(&state, ActorId::SelfActor, ActionBehavior::ArcaneShift)?;
    execute_benchmark_action(&mut state, ActorId::SelfActor, &action_id)?;
    run_until_stop(&mut state)?;
    Ok(state)
}

pub fn run_benchmark_action_sequence(
    config: SimulationConfig,
    steps: &[BenchmarkSequenceStep],
    finish: BenchmarkSequenceFinish,
) -> Result<RuntimeState, EngineError> {
    let mut state = build_runtime(config);
    for step in steps {
        match step {
            BenchmarkSequenceStep::ExecuteAction {
                actor_id,
                action_id,
                advance_after_ms,
            } => {
                execute_benchmark_action(&mut state, *actor_id, action_id)?;
                state.now_ms = state.now_ms.saturating_add(*advance_after_ms);
            }
            BenchmarkSequenceStep::QueueActorDecide { actor_id, delay_ms } => {
                let trigger_ms = state.now_ms.saturating_add(*delay_ms);
                state.push_event(
                    trigger_ms,
                    decide_event_priority(&state, *actor_id),
                    InternalEvent::ActorDecide { actor_id: *actor_id },
                );
            }
        }
    }

    match finish {
        BenchmarkSequenceFinish::Complete => {
            if state.stop_reason.is_none() {
                state.stop_reason = Some(StopReason::Completed);
            }
        }
        BenchmarkSequenceFinish::UntilFirstDamageOrStop => run_until_first_damage_or_stop(&mut state)?,
    }
    Ok(state)
}

pub fn run_single_benchmark_action(
    config: SimulationConfig,
    actor_id: ActorId,
    action_id: &str,
    continue_until_stop: bool,
) -> Result<RuntimeState, EngineError> {
    let mut state = build_runtime(config);
    execute_benchmark_action(&mut state, actor_id, action_id)?;
    if continue_until_stop {
        run_until_stop(&mut state)?;
    } else if state.stop_reason.is_none() {
        state.stop_reason = Some(StopReason::Completed);
    }
    Ok(state)
}

pub fn run_minimal_benchmark_battle(config: SimulationConfig) -> Result<RuntimeState, EngineError> {
    let mut state = build_runtime(config);
    seed_full_battle_events(&mut state);

    while !state.should_stop() {
        if state.processed_events >= state.max_events {
            state.stop_reason = Some(StopReason::Cancelled);
            break;
        }

        let action_selection = select_benchmark_action(&mut state);
        let next_action_ms = match action_selection {
            BenchmarkActionSelection::Ready(_) => state.now_ms,
            BenchmarkActionSelection::WaitUntil(next_ms) => next_ms,
        };
        let next_event_ms = state.queue.peek().map(|scheduled| scheduled.t_ms);

        if let Some(event_ms) = next_event_ms {
            if event_ms <= next_action_ms {
                let scheduled = state.pop_event().expect("queue.peek() matched pop_event()");
                if scheduled.t_ms > state.max_duration_ms {
                    state.now_ms = state.max_duration_ms;
                    state.stop_reason = Some(StopReason::MaxSeconds);
                    break;
                }
                state.apply_periodic_regen_until(scheduled.t_ms);
                state.processed_events += 1;
                dispatch_scheduled_event(&mut state, scheduled, false)?;
                continue;
            }
        }

        if next_action_ms > state.max_duration_ms {
            state.apply_periodic_regen_until(state.max_duration_ms);
            state.stop_reason = Some(StopReason::MaxSeconds);
            break;
        }

        match action_selection {
            BenchmarkActionSelection::Ready(action_id) => {
                state.apply_periodic_regen_until(next_action_ms);
                state.processed_events += 1;
                execute_self_action_by_id(&mut state, &action_id)?;
            }
            BenchmarkActionSelection::WaitUntil(wait_ms) => {
                state.apply_periodic_regen_until(wait_ms);
                continue;
            }
        }
    }

    if state.stop_reason.is_none() {
        state.stop_reason = Some(StopReason::Completed);
    }
    Ok(state)
}

fn seed_full_battle_events(state: &mut RuntimeState) {
    state.push_event(0, decide_event_priority(state, ActorId::Enemy), InternalEvent::ActorDecide {
        actor_id: ActorId::Enemy,
    });
}

pub fn run_until_stop(state: &mut RuntimeState) -> Result<(), EngineError> {
    while let Some(scheduled) = state.pop_event() {
        if state.should_stop() {
            break;
        }
        if scheduled.t_ms > state.max_duration_ms {
            state.now_ms = state.max_duration_ms;
            state.stop_reason = Some(StopReason::MaxSeconds);
            break;
        }

        state.apply_periodic_regen_until(scheduled.t_ms);
        state.processed_events += 1;
        dispatch_scheduled_event(state, scheduled, true)?;
    }

    if state.stop_reason.is_none() {
        state.stop_reason = Some(StopReason::Completed);
    }
    Ok(())
}

fn run_until_first_damage_or_stop(state: &mut RuntimeState) -> Result<(), EngineError> {
    let initial_event_count = state.damage_events.len();
    while let Some(scheduled) = state.pop_event() {
        if state.should_stop() {
            break;
        }
        if scheduled.t_ms > state.max_duration_ms {
            state.now_ms = state.max_duration_ms;
            state.stop_reason = Some(StopReason::MaxSeconds);
            break;
        }

        state.apply_periodic_regen_until(scheduled.t_ms);
        state.processed_events += 1;
        dispatch_scheduled_event(state, scheduled, false)?;
        if state.damage_events.len() > initial_event_count {
            break;
        }
    }

    if state.stop_reason.is_none() {
        state.stop_reason = Some(StopReason::Completed);
    }
    Ok(())
}

fn ordered_action_ids(state: &RuntimeState, actor_id: ActorId) -> Vec<String> {
    let actor = state.actor(actor_id);
    let mut ordered = Vec::with_capacity(actor.priorities.len().max(actor.actions.len()));
    for action_id in &actor.priorities {
        if actor.actions.contains_key(action_id) && !ordered.iter().any(|existing| existing == action_id) {
            ordered.push(action_id.clone());
        }
    }

    if !ordered.is_empty() {
        return ordered;
    }

    let mut fallback = actor.actions.values().collect::<Vec<_>>();
    fallback.sort_by(|left, right| {
        left.priority
            .cmp(&right.priority)
            .then_with(|| left.action_id.cmp(&right.action_id))
    });
    fallback.into_iter().map(|action| action.action_id.clone()).collect()
}

fn decide_event_priority(state: &RuntimeState, _actor_id: ActorId) -> i32 {
    state.scheduler().decide_priority
}

fn dot_tick_event_priority(state: &RuntimeState) -> i32 {
    state.scheduler().dot_tick_priority
}

fn stun_expire_event_priority(state: &RuntimeState) -> i32 {
    state.scheduler().stun_expire_priority
}

fn owned_dot_effects(state: &RuntimeState, actor_id: ActorId) -> Vec<BenchmarkDotRuntime> {
    state
        .actor(actor_id)
        .owned_items
        .iter()
        .filter_map(|item_id| state.item_def(item_id).and_then(|item| item.dot.clone()))
        .collect()
}

fn dot_effect_by_source_id(state: &RuntimeState, source_id: &str) -> Option<BenchmarkDotRuntime> {
    state.item_def(source_id).and_then(|item| item.dot.clone())
}

fn dispatch_scheduled_event(
    state: &mut RuntimeState,
    scheduled: ScheduledEvent,
    complete_when_queue_empty: bool,
) -> Result<(), EngineError> {
    match scheduled.event {
        InternalEvent::ActorDecide {
            actor_id: ActorId::SelfActor,
        } => {
            if let Some(stun_until_ms) = active_self_stun_until_ms(state) {
                let action_id = preferred_self_action_id(state);
                state.log(RuntimeLog::ActionBlocked {
                    t_ms: state.now_ms,
                    actor_id: ActorId::SelfActor,
                    action_id,
                    reason: "stun".to_string(),
                    retry_at_ms: stun_until_ms,
                    current_mana: None,
                    required_mana: None,
                });
                state.push_event(
                    stun_until_ms,
                    decide_event_priority(state, ActorId::SelfActor),
                    InternalEvent::ActorDecide {
                        actor_id: ActorId::SelfActor,
                    },
                );
                return Ok(());
            }

            let action_id = find_action_id_by_behavior(state, ActorId::SelfActor, ActionBehavior::BasicAttack)?;
            execute_benchmark_action(state, ActorId::SelfActor, &action_id)?;
            if complete_when_queue_empty && state.stop_reason.is_none() && state.queue.is_empty() {
                state.stop_reason = Some(StopReason::Completed);
            }
        }
        InternalEvent::ActorDecide {
            actor_id: ActorId::Enemy,
        } => {
            execute_enemy_actor_decide(state)?;
            if complete_when_queue_empty && state.stop_reason.is_none() && state.queue.is_empty() {
                state.stop_reason = Some(StopReason::Completed);
            }
        }
        InternalEvent::DotTick {
            source_actor,
            target_actor,
            source_id,
            label,
            dot_kind: DotEffectKind::Mask,
            remaining_ticks,
        } => {
            execute_mask_dot_tick(state, source_actor, target_actor, source_id, label, remaining_ticks)?;
            if complete_when_queue_empty && state.stop_reason.is_none() && state.queue.is_empty() {
                state.stop_reason = Some(StopReason::Completed);
            }
        }
        InternalEvent::StunExpire { actor_id, until_ms } => {
            expire_stun(state, actor_id, until_ms);
            if complete_when_queue_empty && state.stop_reason.is_none() && state.queue.is_empty() {
                state.stop_reason = Some(StopReason::Completed);
            }
        }
        InternalEvent::BlackCleaverExpire { actor_id, expire_at_ms } => {
            expire_black_cleaver(state, actor_id, expire_at_ms);
            if complete_when_queue_empty && state.stop_reason.is_none() && state.queue.is_empty() {
                state.stop_reason = Some(StopReason::Completed);
            }
        }
    }

    Ok(())
}

fn select_benchmark_action(state: &mut RuntimeState) -> BenchmarkActionSelection {
    let now_ms = state.now_ms;
    if let Some(stun_until_ms) = active_self_stun_until_ms(state) {
        let action_id = preferred_self_action_id(state);
        state.log(RuntimeLog::ActionBlocked {
            t_ms: now_ms,
            actor_id: ActorId::SelfActor,
            action_id: action_id.clone(),
            reason: "stun".to_string(),
            retry_at_ms: stun_until_ms,
            current_mana: None,
            required_mana: None,
        });
        return BenchmarkActionSelection::WaitUntil(stun_until_ms.max(now_ms.saturating_add(1)));
    }

    let mut next_check_ms = u32::MAX;
    for action_id in ordered_action_ids(state, ActorId::SelfActor) {
        let ready_ms = state.actor(ActorId::SelfActor).action_ready_at(&action_id);
        if ready_ms > now_ms {
            next_check_ms = next_check_ms.min(ready_ms);
            continue;
        }

        if has_enough_mana_for_action(state, ActorId::SelfActor, &action_id) {
            return BenchmarkActionSelection::Ready(action_id);
        }

        let retry_at_ms = next_action_retry_ms(state, ActorId::SelfActor);
        log_mana_blocked(state, ActorId::SelfActor, &action_id, retry_at_ms);
        next_check_ms = next_check_ms.min(retry_at_ms);
    }

    if next_check_ms == u32::MAX {
        BenchmarkActionSelection::WaitUntil(now_ms.saturating_add(1_000))
    } else {
        BenchmarkActionSelection::WaitUntil(next_check_ms.max(now_ms.saturating_add(1)))
    }
}

fn active_stun_until_ms(state: &RuntimeState, actor_id: ActorId) -> Option<u32> {
    if matches!(state.profile, crate::model::TestProfile::NoControl) {
        return None;
    }
    state
        .actor(actor_id)
        .stun
        .as_ref()
        .map(|stun| stun.until_ms)
        .filter(|until_ms| *until_ms > state.now_ms)
}

fn active_self_stun_until_ms(state: &RuntimeState) -> Option<u32> {
    active_stun_until_ms(state, ActorId::SelfActor)
}

fn find_action_id_by_behavior(
    state: &RuntimeState,
    actor_id: ActorId,
    behavior: ActionBehavior,
) -> Result<String, EngineError> {
    ordered_action_ids(state, actor_id)
        .into_iter()
        .find(|action_id| {
            state
                .actor(actor_id)
                .action(action_id)
                .is_some_and(|action| action.behavior == behavior)
        })
        .ok_or_else(|| runtime_error(format!(
            "actor '{}' has no action with behavior '{behavior:?}'",
            actor_id.as_key()
        )))
}

fn required_skill_def(state: &RuntimeState, action_id: &str) -> Result<BenchmarkSkillRuntimeDef, EngineError> {
    state
        .skill_def(action_id)
        .cloned()
        .ok_or_else(|| runtime_error(format!("missing benchmark skill def: {action_id}")))
}

fn action_label(state: &RuntimeState, actor_id: ActorId, action_id: &str, fallback: &str) -> String {
    state
        .actor(actor_id)
        .action(action_id)
        .map(|action| action.label.clone())
        .or_else(|| state.skill_def(action_id).map(|skill| skill.label.clone()))
        .unwrap_or_else(|| fallback.to_string())
}

fn preferred_self_action_id(state: &RuntimeState) -> String {
    for action_id in ordered_action_ids(state, ActorId::SelfActor) {
        if state.actor(ActorId::SelfActor).action_ready_at(&action_id) <= state.now_ms
            && has_enough_mana_for_action(state, ActorId::SelfActor, &action_id)
        {
            return action_id;
        }
    }

    for action_id in ordered_action_ids(state, ActorId::SelfActor) {
        if state.actor(ActorId::SelfActor).action_ready_at(&action_id) <= state.now_ms {
            return action_id;
        }
    }

    state
        .actor(ActorId::SelfActor)
        .priorities
        .first()
        .cloned()
        .unwrap_or_default()
}

fn preferred_enemy_action_id(state: &RuntimeState) -> String {
    for action_id in ordered_action_ids(state, ActorId::Enemy) {
        if state.actor(ActorId::Enemy).action_ready_at(&action_id) <= state.now_ms {
            return action_id;
        }
    }

    state
        .actor(ActorId::Enemy)
        .priorities
        .first()
        .cloned()
        .unwrap_or_default()
}

fn next_enemy_action_ready_ms(state: &RuntimeState) -> u32 {
    ordered_action_ids(state, ActorId::Enemy)
        .into_iter()
        .map(|action_id| state.actor(ActorId::Enemy).action_ready_at(&action_id))
        .min()
        .unwrap_or(state.now_ms.saturating_add(1_000))
}

fn execute_enemy_actor_decide(state: &mut RuntimeState) -> Result<(), EngineError> {
    let now_ms = state.now_ms;
    if let Some(stun_until_ms) = active_stun_until_ms(state, ActorId::Enemy) {
        let action_id = preferred_enemy_action_id(state);
        state.log(RuntimeLog::ActionBlocked {
            t_ms: now_ms,
            actor_id: ActorId::Enemy,
            action_id,
            reason: "stun".to_string(),
            retry_at_ms: stun_until_ms,
            current_mana: None,
            required_mana: None,
        });
        state.push_event(
            stun_until_ms,
            decide_event_priority(state, ActorId::Enemy),
            InternalEvent::ActorDecide {
                actor_id: ActorId::Enemy,
            },
        );
        return Ok(());
    }

    for action_id in ordered_action_ids(state, ActorId::Enemy) {
        if state.actor(ActorId::Enemy).action_ready_at(&action_id) > now_ms {
            continue;
        }
        if !has_enough_mana_for_action(state, ActorId::Enemy, &action_id) {
            let retry_at_ms = next_action_retry_ms(state, ActorId::Enemy);
            log_mana_blocked(state, ActorId::Enemy, &action_id, retry_at_ms);
            continue;
        }
        execute_enemy_action_by_id(state, &action_id)?;
    }

    if state.stop_reason.is_none() {
        state.push_event(
            next_enemy_action_ready_ms(state),
            decide_event_priority(state, ActorId::Enemy),
            InternalEvent::ActorDecide {
                actor_id: ActorId::Enemy,
            },
        );
    }
    Ok(())
}

fn execute_self_action_by_id(state: &mut RuntimeState, action_id: &str) -> Result<(), EngineError> {
    execute_benchmark_action(state, ActorId::SelfActor, action_id)
}

fn execute_enemy_action_by_id(state: &mut RuntimeState, action_id: &str) -> Result<(), EngineError> {
    execute_benchmark_action(state, ActorId::Enemy, action_id)
}

fn evaluate_formula(
    state: &RuntimeState,
    formula_id: &str,
    source_actor: ActorId,
    target_actor: ActorId,
) -> Result<f64, EngineError> {
    Ok(round_number(state.eval_formula(formula_id, source_actor, target_actor)?))
}

fn normalized_flags(state: &RuntimeState, source_actor: ActorId, template: &DamageFlags) -> DamageFlags {
    let mut flags = template.clone();
    if flags.can_apply_black_cleaver {
        flags.can_apply_black_cleaver = state
            .actor(source_actor)
            .owned_items
            .iter()
            .filter_map(|item_id| state.item_def(item_id))
            .any(|item| item.black_cleaver.is_some());
    }
    flags
}

fn build_attached_on_hit_packets(
    state: &RuntimeState,
    source_actor: ActorId,
    target_actor: ActorId,
    item_ids: &[String],
) -> Result<Vec<DamagePacket>, EngineError> {
    let mut packets = Vec::with_capacity(item_ids.len());
    for item_id in item_ids {
        if !state.actor(source_actor).has_item(item_id) {
            continue;
        }
        let Some(item_def) = state.item_def(item_id) else {
            continue;
        };
        let Some(formula_id) = item_def.on_hit_damage_formula_id.as_deref() else {
            continue;
        };
        packets.push(DamagePacket {
            source_kind: DamageSourceKind::Item,
            source_id: item_def.item_id.clone(),
            label: item_def.label.clone(),
            damage_type: item_def.on_hit_damage_type.unwrap_or(DamageType::Physical),
            raw_damage: evaluate_formula(state, formula_id, source_actor, target_actor)?,
            flags: normalized_flags(state, source_actor, &item_def.on_hit_flags),
        });
    }
    Ok(packets)
}

fn has_enough_mana_for_action(state: &RuntimeState, actor_id: ActorId, action_id: &str) -> bool {
    let required_mana = state.actor(actor_id).action_mana_cost(action_id).max(0.0);
    if required_mana <= 0.0 {
        return true;
    }
    state.actor(actor_id).mana_current + 1e-9 >= required_mana
}

fn next_action_retry_ms(state: &RuntimeState, actor_id: ActorId) -> u32 {
    if state.actor(actor_id).attr(crate::runtime::ATTR_MANA_REGEN) > 0.0 {
        state.next_rate_tick_ms.max(state.now_ms.saturating_add(1))
    } else {
        state.now_ms.saturating_add(1)
    }
}

fn log_mana_blocked(state: &mut RuntimeState, actor_id: ActorId, action_id: &str, retry_at_ms: u32) {
    let current_mana = round_number(state.actor(actor_id).mana_current.max(0.0));
    let required_mana = round_number(state.actor(actor_id).action_mana_cost(action_id).max(0.0));
    state.log(RuntimeLog::ActionBlocked {
        t_ms: state.now_ms,
        actor_id,
        action_id: action_id.to_string(),
        reason: "mana".to_string(),
        retry_at_ms,
        current_mana: Some(current_mana),
        required_mana: Some(required_mana),
    });
}

fn try_spend_action_mana(state: &mut RuntimeState, actor_id: ActorId, action_id: &str) -> bool {
    let required_mana = state.actor(actor_id).action_mana_cost(action_id).max(0.0);
    if required_mana <= 0.0 {
        return true;
    }

    let mana_before = state.actor(actor_id).mana_current.max(0.0);
    if mana_before + 1e-9 < required_mana {
        let retry_at_ms = next_action_retry_ms(state, actor_id);
        log_mana_blocked(state, actor_id, action_id, retry_at_ms);
        return false;
    }

    let mana_after = {
        let actor = state.actor_mut(actor_id);
        actor.mana_current = (actor.mana_current - required_mana).max(0.0);
        actor.mana_current
    };
    state.log(RuntimeLog::ManaSpent {
        t_ms: state.now_ms,
        actor_id,
        action_id: action_id.to_string(),
        amount: round_number(required_mana),
        mana_before: round_number(mana_before),
        mana_after: round_number(mana_after),
    });
    true
}

fn execute_benchmark_action(
    state: &mut RuntimeState,
    actor_id: ActorId,
    action_id: &str,
) -> Result<(), EngineError> {
    let behavior = state
        .actor(actor_id)
        .action(action_id)
        .map(|action| action.behavior)
        .ok_or_else(|| runtime_error(format!("actor '{}' missing action '{}'", actor_id.as_key(), action_id)))?;

    match behavior {
        ActionBehavior::BasicAttack => execute_basic_attack_action(state, actor_id, action_id),
        ActionBehavior::MysticShot => execute_mystic_shot_action(state, actor_id, action_id),
        ActionBehavior::ArcaneShift => execute_arcane_shift_action(state, actor_id, action_id),
        ActionBehavior::GenerateShield => execute_generate_shield_action(state, actor_id, action_id),
        ActionBehavior::Stun => execute_stun_action(state, actor_id, action_id),
    }
}

fn execute_basic_attack_action(
    state: &mut RuntimeState,
    actor_id: ActorId,
    action_id: &str,
) -> Result<(), EngineError> {
    let t_ms = state.now_ms;
    let target_actor = actor_id.opponent();
    let skill_def = required_skill_def(state, action_id)?;
    let resolved_label = action_label(state, actor_id, action_id, &skill_def.label);
    if !try_spend_action_mana(state, actor_id, action_id) {
        state.stop_reason.get_or_insert(StopReason::Completed);
        return Ok(());
    }
    let damage_formula_id = skill_def
        .mechanics
        .damage_formula_id
        .as_deref()
        .ok_or_else(|| runtime_error(format!("{action_id} missing damage formula")))?;
    let mut packets = Vec::with_capacity(1 + skill_def.attach_on_hit_item_ids.len());
    packets.push(DamagePacket {
        source_kind: DamageSourceKind::BasicAttack,
        source_id: skill_def.skill_id.clone(),
        label: resolved_label.clone(),
        damage_type: skill_def.damage_type.unwrap_or(DamageType::Physical),
        raw_damage: evaluate_formula(state, damage_formula_id, actor_id, target_actor)?,
        flags: normalized_flags(state, actor_id, &skill_def.flags),
    });
    packets.extend(build_attached_on_hit_packets(
        state,
        actor_id,
        target_actor,
        &skill_def.attach_on_hit_item_ids,
    )?);

    state.log(RuntimeLog::ActionChosen {
        t_ms,
        actor_id,
        action_id: action_id.to_string(),
        label: resolved_label.clone(),
    });
    start_action_cooldown(state, actor_id, action_id, "basic_attack");
    apply_damage_packets_as_event(state, actor_id, target_actor, resolved_label, packets)?;
    Ok(())
}

fn execute_mystic_shot_action(
    state: &mut RuntimeState,
    actor_id: ActorId,
    action_id: &str,
) -> Result<(), EngineError> {
    let t_ms = state.now_ms;
    let target_actor = actor_id.opponent();
    let skill_def = required_skill_def(state, action_id)?;
    let resolved_label = action_label(state, actor_id, action_id, &skill_def.label);

    if !try_spend_action_mana(state, actor_id, action_id) {
        state.stop_reason.get_or_insert(StopReason::Completed);
        return Ok(());
    }
    state.log(RuntimeLog::ActionChosen {
        t_ms,
        actor_id,
        action_id: action_id.to_string(),
        label: resolved_label.clone(),
    });
    start_action_cooldown(state, actor_id, action_id, "cast");

    let damage_formula_id = skill_def
        .mechanics
        .damage_formula_id
        .as_deref()
        .ok_or_else(|| runtime_error(format!("{action_id} missing damage formula")))?;
    let mut packets = Vec::with_capacity(1 + skill_def.attach_on_hit_item_ids.len());
    packets.push(DamagePacket {
        source_kind: DamageSourceKind::Skill,
        source_id: skill_def.skill_id.clone(),
        label: resolved_label.clone(),
        damage_type: skill_def.damage_type.unwrap_or(DamageType::Physical),
        raw_damage: evaluate_formula(state, damage_formula_id, actor_id, target_actor)?,
        flags: normalized_flags(state, actor_id, &skill_def.flags),
    });
    packets.extend(build_attached_on_hit_packets(
        state,
        actor_id,
        target_actor,
        &skill_def.attach_on_hit_item_ids,
    )?);

    apply_damage_packets_as_event(state, actor_id, target_actor, resolved_label, packets)?;
    reduce_skill_cooldowns(
        state,
        actor_id,
        skill_def.mechanics.on_hit_cooldown_reduction_ms.unwrap_or(0),
        "mystic_shot_hit",
    );
    Ok(())
}

fn execute_arcane_shift_action(
    state: &mut RuntimeState,
    actor_id: ActorId,
    action_id: &str,
) -> Result<(), EngineError> {
    let t_ms = state.now_ms;
    let target_actor = actor_id.opponent();
    let skill_def = required_skill_def(state, action_id)?;
    let dot_effects = owned_dot_effects(state, actor_id);
    let resolved_label = action_label(state, actor_id, action_id, &skill_def.label);

    if !try_spend_action_mana(state, actor_id, action_id) {
        state.stop_reason.get_or_insert(StopReason::Completed);
        return Ok(());
    }
    state.log(RuntimeLog::ActionChosen {
        t_ms,
        actor_id,
        action_id: action_id.to_string(),
        label: resolved_label.clone(),
    });
    start_action_cooldown(state, actor_id, action_id, "cast");

    let damage_formula_id = skill_def
        .mechanics
        .damage_formula_id
        .as_deref()
        .ok_or_else(|| runtime_error(format!("{action_id} missing damage formula")))?;
    let result = apply_damage_packets_as_event(
        state,
        actor_id,
        target_actor,
        resolved_label.clone(),
        vec![DamagePacket {
            source_kind: DamageSourceKind::Skill,
            source_id: skill_def.skill_id.clone(),
            label: resolved_label,
            damage_type: skill_def.damage_type.unwrap_or(DamageType::Magic),
            raw_damage: evaluate_formula(state, damage_formula_id, actor_id, target_actor)?,
            flags: normalized_flags(state, actor_id, &skill_def.flags),
        }],
    )?;

    if result.total_hp_damage > 0.0 {
        for dot in &dot_effects {
            schedule_dot_ticks(state, actor_id, target_actor, dot);
        }
    } else if state.stop_reason.is_none() {
        state.stop_reason = Some(StopReason::Completed);
    }
    Ok(())
}

fn execute_generate_shield_action(
    state: &mut RuntimeState,
    actor_id: ActorId,
    action_id: &str,
) -> Result<(), EngineError> {
    let t_ms = state.now_ms;
    let skill_def = required_skill_def(state, action_id)?;
    let resolved_label = action_label(state, actor_id, action_id, &skill_def.label);
    state.log(RuntimeLog::ActionChosen {
        t_ms,
        actor_id,
        action_id: action_id.to_string(),
        label: resolved_label,
    });
    if let Some(formula_id) = skill_def.mechanics.damage_formula_id.as_deref() {
        let requested_amount = evaluate_formula(state, formula_id, actor_id, actor_id)?;
        apply_generate_shield(state, actor_id, requested_amount);
    }
    start_action_cooldown(state, actor_id, action_id, "cast");
    Ok(())
}

fn execute_stun_action(
    state: &mut RuntimeState,
    actor_id: ActorId,
    action_id: &str,
) -> Result<(), EngineError> {
    let t_ms = state.now_ms;
    let skill_def = required_skill_def(state, action_id)?;
    let target_actor = actor_id.opponent();
    let resolved_label = action_label(state, actor_id, action_id, &skill_def.label);
    state.log(RuntimeLog::ActionChosen {
        t_ms,
        actor_id,
        action_id: action_id.to_string(),
        label: resolved_label,
    });
    let Some(duration_ms) = skill_def.mechanics.stun_duration_ms else {
        return Ok(());
    };
    let until_ms = t_ms.saturating_add(duration_ms);
    apply_stun(state, target_actor, until_ms);
    state.push_event(
        until_ms,
        stun_expire_event_priority(state),
        InternalEvent::StunExpire {
            actor_id: target_actor,
            until_ms,
        },
    );
    start_action_cooldown(state, actor_id, action_id, "cast");
    Ok(())
}


fn schedule_dot_ticks(
    state: &mut RuntimeState,
    source_actor: ActorId,
    target_actor: ActorId,
    dot: &BenchmarkDotRuntime,
) {
    for remaining_ticks in (1..=dot.ticks).rev() {
        let elapsed_ticks = dot.ticks.saturating_sub(remaining_ticks).saturating_add(1);
        let tick_at_ms = state
            .now_ms
            .saturating_add(elapsed_ticks.saturating_mul(dot.interval_ms));
        state.push_event(
            tick_at_ms,
            dot_tick_event_priority(state),
            InternalEvent::DotTick {
                source_actor,
                target_actor,
                source_id: dot.source_id.clone(),
                label: dot.label.clone(),
                dot_kind: DotEffectKind::Mask,
                remaining_ticks,
            },
        );
        state.log(RuntimeLog::DotScheduled {
            t_ms: state.now_ms,
            source_actor,
            target_actor,
            label: dot.label.clone(),
            tick_at_ms,
            remaining_ticks_after_schedule: remaining_ticks.saturating_sub(1),
        });
    }
}

fn execute_mask_dot_tick(
    state: &mut RuntimeState,
    source_actor: ActorId,
    target_actor: ActorId,
    source_id: String,
    label: String,
    remaining_ticks: u32,
) -> Result<(), EngineError> {
    let dot = dot_effect_by_source_id(state, &source_id)
        .ok_or_else(|| runtime_error(format!("missing dot config for source '{source_id}'")))?;
    let tick_index = dot.ticks.saturating_sub(remaining_ticks).saturating_add(1);
    let tick_label = format!("{label} {tick_index}");
    apply_damage_packets_as_event(
        state,
        source_actor,
        target_actor,
        tick_label.clone(),
        vec![DamagePacket {
            source_kind: DamageSourceKind::Item,
            source_id,
            label: tick_label,
            damage_type: dot.damage_type,
            raw_damage: evaluate_formula(state, &dot.formula_id, source_actor, target_actor)?,
            flags: DamageFlags {
                can_trigger_on_hit: false,
                can_life_steal: false,
                can_apply_black_cleaver: false,
                counts_as_attack: false,
                is_active_skill_magic_damage: false,
            },
        }],
    )?;
    Ok(())
}

fn runtime_error(message: impl Into<String>) -> EngineError {
    EngineError {
        code: crate::model::ErrorCode::RuntimeError,
        message: message.into(),
    }
}
