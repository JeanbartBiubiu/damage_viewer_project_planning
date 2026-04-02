use crate::effects::{expire_black_cleaver, expire_stun};
use crate::model::{EngineError, StopReason};
use crate::runtime::{build_runtime, RuntimeState};
use crate::types::{
    ActionBehavior, ActorId, DotEffectKind, InternalEvent, RuntimeLog, ScheduledEvent, SimulationConfig,
};
use super::action::{
    execute_benchmark_action, execute_mask_dot_tick, has_enough_mana_for_action,
    log_mana_blocked, next_action_retry_ms,
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
        }
        InternalEvent::ActorDecide {
            actor_id: ActorId::Enemy,
        } => {
            execute_enemy_actor_decide(state)?;
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
        }
        InternalEvent::StunExpire { actor_id, until_ms } => {
            expire_stun(state, actor_id, until_ms);
        }
        InternalEvent::BlackCleaverExpire { actor_id, expire_at_ms } => {
            expire_black_cleaver(state, actor_id, expire_at_ms);
        }
    }

    if complete_when_queue_empty && state.stop_reason.is_none() && state.queue.is_empty() {
        state.stop_reason = Some(StopReason::Completed);
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
        .ok_or_else(|| EngineError::runtime(format!(
            "actor '{}' has no action with behavior '{behavior:?}'",
            actor_id.as_key()
        )))
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
