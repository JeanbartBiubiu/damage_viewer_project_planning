use crate::benchmark_fixture::{
    ITEM_BLACK_CLEAVER, ITEM_LIFESTEAL_BLADE, ITEM_MAGIC_BLADE, ITEM_MASK, SKILL_ARCANE_SHIFT,
    SKILL_BASIC_ATTACK, SKILL_GENERATE_SHIELD, SKILL_MYSTIC_SHOT, SKILL_STUN,
};
use crate::effects::{
    apply_damage_packets_as_event, apply_generate_shield, apply_stun, expire_black_cleaver, expire_stun,
};
use crate::model::{DamageSourceKind, DamageType, EngineError, StopReason};
use crate::runtime::{
    build_runtime, reduce_skill_cooldowns, round_number, start_action_cooldown, ActorId, DamageFlags, DamagePacket,
    DotEffectKind, InternalEvent, RuntimeLog, RuntimeState, ScheduledEvent, SimulationConfig,
};

const DECIDE_PRIORITY: i32 = 0;
const DOT_TICK_PRIORITY: i32 = 10;
const STUN_EXPIRE_PRIORITY: i32 = -10;
const STUN_DURATION_MS: u32 = 1_500;
const BASIC_ATTACK_BYPASS_DAMAGE: f64 = 100.0;
const LIFESTEAL_BLADE_BYPASS_DAMAGE: f64 = 30.0;
const MAGIC_BLADE_BYPASS_DAMAGE: f64 = 20.0;
const MYSTIC_SHOT_BYPASS_DAMAGE: f64 = 140.0;
const ARCANE_SHIFT_BYPASS_DAMAGE: f64 = 160.0;
const MASK_DOT_BYPASS_DAMAGE: f64 = 25.0;
const SHIELD_BYPASS_AMOUNT: f64 = 300.0;

#[derive(Clone, Copy)]
enum BenchmarkActionKind {
    ArcaneShift,
    MysticShot,
    BasicAttack,
}

#[derive(Clone, Copy)]
enum BenchmarkActionSelection {
    Ready(BenchmarkActionKind),
    WaitUntil(u32),
}

pub fn run_first_basic_attack(config: SimulationConfig) -> Result<RuntimeState, EngineError> {
    let mut state = build_runtime(config);
    seed_initial_events(&mut state);
    run_until_stop(&mut state)?;
    Ok(state)
}

pub fn run_first_mystic_shot(config: SimulationConfig) -> Result<RuntimeState, EngineError> {
    let mut state = build_runtime(config);
    execute_first_mystic_shot(&mut state)?;
    if state.stop_reason.is_none() {
        state.stop_reason = Some(StopReason::Completed);
    }
    Ok(state)
}

pub fn run_first_arcane_shift(config: SimulationConfig) -> Result<RuntimeState, EngineError> {
    let mut state = build_runtime(config);
    execute_first_arcane_shift(&mut state)?;
    run_until_stop(&mut state)?;
    Ok(state)
}

pub fn run_first_basic_attack_with_enemy_shield(config: SimulationConfig) -> Result<RuntimeState, EngineError> {
    let mut state = build_runtime(config);
    execute_enemy_generate_shield(&mut state);
    execute_first_basic_attack(&mut state)?;
    if state.stop_reason.is_none() {
        state.now_ms = state.now_ms.saturating_add(1);
        execute_enemy_generate_shield(&mut state);
        state.stop_reason = Some(StopReason::Completed);
    }
    Ok(state)
}

pub fn run_stun_blocks_first_basic_attack(config: SimulationConfig) -> Result<RuntimeState, EngineError> {
    let mut state = build_runtime(config);
    execute_enemy_stun(&mut state);
    state.push_event(0, DECIDE_PRIORITY, InternalEvent::ActorDecide {
        actor_id: ActorId::SelfActor,
    });
    run_until_stop(&mut state)?;
    Ok(state)
}

pub fn run_black_cleaver_stack_then_expire(config: SimulationConfig) -> Result<RuntimeState, EngineError> {
    let mut state = build_runtime(config);
    execute_first_mystic_shot(&mut state)?;
    run_until_stop(&mut state)?;
    Ok(state)
}

pub fn run_minimal_benchmark_battle(config: SimulationConfig) -> Result<RuntimeState, EngineError> {
    let mut state = build_runtime(config);

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
            BenchmarkActionSelection::Ready(action_kind) => {
                state.apply_periodic_regen_until(next_action_ms);
                state.processed_events += 1;
                match action_kind {
                    BenchmarkActionKind::ArcaneShift => execute_first_arcane_shift(&mut state)?,
                    BenchmarkActionKind::MysticShot => execute_first_mystic_shot(&mut state)?,
                    BenchmarkActionKind::BasicAttack => {
                        execute_first_basic_attack(&mut state)?;
                        start_action_cooldown(&mut state, ActorId::SelfActor, SKILL_BASIC_ATTACK, "basic_attack");
                    }
                }
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

pub fn seed_initial_events(state: &mut RuntimeState) {
    state.push_event(0, DECIDE_PRIORITY, InternalEvent::ActorDecide {
        actor_id: ActorId::SelfActor,
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

fn dispatch_scheduled_event(
    state: &mut RuntimeState,
    scheduled: ScheduledEvent,
    complete_when_queue_empty: bool,
) -> Result<(), EngineError> {
    match scheduled.event {
        InternalEvent::ActorDecide {
            actor_id: ActorId::SelfActor,
        } => {
            let control_disabled = matches!(state.profile, crate::model::TestProfile::NoControl);
            if !control_disabled {
                if let Some(stun_until_ms) = state.actor(ActorId::SelfActor).stun.as_ref().map(|stun| stun.until_ms) {
                    if stun_until_ms > state.now_ms {
                        state.log(RuntimeLog::ActionBlocked {
                            t_ms: state.now_ms,
                            actor_id: ActorId::SelfActor,
                            action_id: SKILL_BASIC_ATTACK.to_string(),
                            reason: "stun".to_string(),
                            retry_at_ms: stun_until_ms,
                            current_mana: None,
                            required_mana: None,
                        });
                        state.push_event(
                            stun_until_ms,
                            DECIDE_PRIORITY,
                            InternalEvent::ActorDecide {
                                actor_id: ActorId::SelfActor,
                            },
                        );
                        return Ok(());
                    }
                }
            }

            execute_first_basic_attack(state)?;
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
        InternalEvent::BlackCleaverExpire {
            actor_id,
            expire_at_ms,
        } => {
            expire_black_cleaver(state, actor_id, expire_at_ms);
            if complete_when_queue_empty && state.stop_reason.is_none() && state.queue.is_empty() {
                state.stop_reason = Some(StopReason::Completed);
            }
        }
        _ => {
            if complete_when_queue_empty {
                state.stop_reason.get_or_insert(StopReason::Completed);
            }
        }
    }

    Ok(())
}

fn select_benchmark_action(state: &mut RuntimeState) -> BenchmarkActionSelection {
    let now_ms = state.now_ms;
    let mut next_check_ms = u32::MAX;
    for (action_kind, action_id) in [
        (BenchmarkActionKind::ArcaneShift, SKILL_ARCANE_SHIFT),
        (BenchmarkActionKind::MysticShot, SKILL_MYSTIC_SHOT),
        (BenchmarkActionKind::BasicAttack, SKILL_BASIC_ATTACK),
    ] {
        let ready_ms = state.actor(ActorId::SelfActor).action_ready_at(action_id);
        if ready_ms > now_ms {
            next_check_ms = next_check_ms.min(ready_ms);
            continue;
        }

        if has_enough_mana_for_action(state, ActorId::SelfActor, action_id) {
            return BenchmarkActionSelection::Ready(action_kind);
        }

        let retry_at_ms = next_action_retry_ms(state, ActorId::SelfActor);
        log_mana_blocked(state, ActorId::SelfActor, action_id, retry_at_ms);
        next_check_ms = next_check_ms.min(retry_at_ms);
    }

    if next_check_ms == u32::MAX {
        BenchmarkActionSelection::WaitUntil(now_ms.saturating_add(1_000))
    } else {
        BenchmarkActionSelection::WaitUntil(next_check_ms.max(now_ms.saturating_add(1)))
    }
}

fn formula_value(state: &RuntimeState, computed: f64, fallback: f64) -> f64 {
    let value = if matches!(state.profile, crate::model::TestProfile::FormulaBypass) {
        fallback
    } else {
        computed
    };
    round_number(value)
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

fn execute_first_basic_attack(state: &mut RuntimeState) -> Result<(), EngineError> {
    let t_ms = state.now_ms;
    let self_ad = state.actor(ActorId::SelfActor).attr(crate::runtime::ATTR_AD);
    let self_ap = state.actor(ActorId::SelfActor).attr(crate::runtime::ATTR_AP);
    let enemy_hp_current = state.actor(ActorId::Enemy).hp_current;
    let has_lifesteal_blade = state.actor(ActorId::SelfActor).has_item(ITEM_LIFESTEAL_BLADE);
    let has_magic_blade = state.actor(ActorId::SelfActor).has_item(ITEM_MAGIC_BLADE);
    let basic_attack_label = state
        .actor(ActorId::SelfActor)
        .action(SKILL_BASIC_ATTACK)
        .map(|action| action.label.clone())
        .unwrap_or_else(|| "普通攻击".to_string());

    let mut packets = Vec::with_capacity(3);
    packets.push(DamagePacket {
        source_kind: DamageSourceKind::BasicAttack,
        source_id: SKILL_BASIC_ATTACK.to_string(),
        label: basic_attack_label.clone(),
        damage_type: DamageType::Physical,
        raw_damage: formula_value(state, self_ad, BASIC_ATTACK_BYPASS_DAMAGE),
        flags: DamageFlags {
            can_trigger_on_hit: true,
            can_life_steal: true,
            can_apply_black_cleaver: false,
            counts_as_attack: true,
            is_active_skill_magic_damage: false,
        },
    });

    if has_lifesteal_blade {
        packets.push(DamagePacket {
            source_kind: DamageSourceKind::Item,
            source_id: ITEM_LIFESTEAL_BLADE.to_string(),
            label: "吸血刀".to_string(),
            damage_type: DamageType::Physical,
            raw_damage: formula_value(state, enemy_hp_current * 0.08, LIFESTEAL_BLADE_BYPASS_DAMAGE),
            flags: DamageFlags {
                can_trigger_on_hit: false,
                can_life_steal: true,
                can_apply_black_cleaver: false,
                counts_as_attack: false,
                is_active_skill_magic_damage: false,
            },
        });
    }

    if has_magic_blade {
        packets.push(DamagePacket {
            source_kind: DamageSourceKind::Item,
            source_id: ITEM_MAGIC_BLADE.to_string(),
            label: "魔法刀".to_string(),
            damage_type: DamageType::Magic,
            raw_damage: formula_value(state, 20.0 + self_ap * 0.15, MAGIC_BLADE_BYPASS_DAMAGE),
            flags: DamageFlags {
                can_trigger_on_hit: false,
                can_life_steal: true,
                can_apply_black_cleaver: false,
                counts_as_attack: false,
                is_active_skill_magic_damage: false,
            },
        });
    }

    state.log(RuntimeLog::ActionChosen {
        t_ms,
        actor_id: ActorId::SelfActor,
        action_id: SKILL_BASIC_ATTACK.to_string(),
        label: basic_attack_label.clone(),
    });
    apply_damage_packets_as_event(
        state,
        ActorId::SelfActor,
        ActorId::Enemy,
        basic_attack_label,
        packets,
    )?;

    Ok(())
}

fn execute_first_mystic_shot(state: &mut RuntimeState) -> Result<(), EngineError> {
    let t_ms = state.now_ms;
    let self_ad = state.actor(ActorId::SelfActor).attr(crate::runtime::ATTR_AD);
    let self_ap = state.actor(ActorId::SelfActor).attr(crate::runtime::ATTR_AP);
    let enemy_hp_current = state.actor(ActorId::Enemy).hp_current;
    let has_lifesteal_blade = state.actor(ActorId::SelfActor).has_item(ITEM_LIFESTEAL_BLADE);
    let has_magic_blade = state.actor(ActorId::SelfActor).has_item(ITEM_MAGIC_BLADE);
    let has_black_cleaver = state.actor(ActorId::SelfActor).has_item(ITEM_BLACK_CLEAVER);
    let mystic_shot_label = state
        .actor(ActorId::SelfActor)
        .action(SKILL_MYSTIC_SHOT)
        .map(|action| action.label.clone())
        .unwrap_or_else(|| "秘术射击".to_string());

    if !try_spend_action_mana(state, ActorId::SelfActor, SKILL_MYSTIC_SHOT) {
        state.stop_reason.get_or_insert(StopReason::Completed);
        return Ok(());
    }
    state.log(RuntimeLog::ActionChosen {
        t_ms,
        actor_id: ActorId::SelfActor,
        action_id: SKILL_MYSTIC_SHOT.to_string(),
        label: mystic_shot_label.clone(),
    });
    start_action_cooldown(state, ActorId::SelfActor, SKILL_MYSTIC_SHOT, "cast");

    let mut packets = Vec::with_capacity(3);
    packets.push(DamagePacket {
        source_kind: DamageSourceKind::Skill,
        source_id: SKILL_MYSTIC_SHOT.to_string(),
        label: mystic_shot_label.clone(),
        damage_type: DamageType::Physical,
        raw_damage: formula_value(state, 100.0 + self_ad + self_ap * 0.2, MYSTIC_SHOT_BYPASS_DAMAGE),
        flags: DamageFlags {
            can_trigger_on_hit: true,
            can_life_steal: false,
            can_apply_black_cleaver: has_black_cleaver,
            counts_as_attack: true,
            is_active_skill_magic_damage: false,
        },
    });

    if has_lifesteal_blade {
        packets.push(DamagePacket {
            source_kind: DamageSourceKind::Item,
            source_id: ITEM_LIFESTEAL_BLADE.to_string(),
            label: "吸血刀".to_string(),
            damage_type: DamageType::Physical,
            raw_damage: formula_value(state, enemy_hp_current * 0.08, LIFESTEAL_BLADE_BYPASS_DAMAGE),
            flags: DamageFlags {
                can_trigger_on_hit: false,
                can_life_steal: true,
                can_apply_black_cleaver: false,
                counts_as_attack: false,
                is_active_skill_magic_damage: false,
            },
        });
    }

    if has_magic_blade {
        packets.push(DamagePacket {
            source_kind: DamageSourceKind::Item,
            source_id: ITEM_MAGIC_BLADE.to_string(),
            label: "魔法刀".to_string(),
            damage_type: DamageType::Magic,
            raw_damage: formula_value(state, 20.0 + self_ap * 0.15, MAGIC_BLADE_BYPASS_DAMAGE),
            flags: DamageFlags {
                can_trigger_on_hit: false,
                can_life_steal: true,
                can_apply_black_cleaver: false,
                counts_as_attack: false,
                is_active_skill_magic_damage: false,
            },
        });
    }

    apply_damage_packets_as_event(
        state,
        ActorId::SelfActor,
        ActorId::Enemy,
        mystic_shot_label,
        packets,
    )?;
    reduce_skill_cooldowns(state, ActorId::SelfActor, 1_000, "mystic_shot_hit");

    Ok(())
}

fn execute_first_arcane_shift(state: &mut RuntimeState) -> Result<(), EngineError> {
    let t_ms = state.now_ms;
    let self_ap = state.actor(ActorId::SelfActor).attr(crate::runtime::ATTR_AP);
    let has_mask = state.actor(ActorId::SelfActor).has_item(ITEM_MASK);
    let arcane_shift_label = state
        .actor(ActorId::SelfActor)
        .action(SKILL_ARCANE_SHIFT)
        .map(|action| action.label.clone())
        .unwrap_or_else(|| "奥术跃迁".to_string());

    if !try_spend_action_mana(state, ActorId::SelfActor, SKILL_ARCANE_SHIFT) {
        state.stop_reason.get_or_insert(StopReason::Completed);
        return Ok(());
    }
    state.log(RuntimeLog::ActionChosen {
        t_ms,
        actor_id: ActorId::SelfActor,
        action_id: SKILL_ARCANE_SHIFT.to_string(),
        label: arcane_shift_label.clone(),
    });
    start_action_cooldown(state, ActorId::SelfActor, SKILL_ARCANE_SHIFT, "cast");

    let result = apply_damage_packets_as_event(
        state,
        ActorId::SelfActor,
        ActorId::Enemy,
        arcane_shift_label.clone(),
        vec![DamagePacket {
            source_kind: DamageSourceKind::Skill,
            source_id: SKILL_ARCANE_SHIFT.to_string(),
            label: arcane_shift_label,
            damage_type: DamageType::Magic,
            raw_damage: formula_value(state, 200.0 + self_ap * 0.8, ARCANE_SHIFT_BYPASS_DAMAGE),
            flags: DamageFlags {
                can_trigger_on_hit: false,
                can_life_steal: false,
                can_apply_black_cleaver: false,
                counts_as_attack: false,
                is_active_skill_magic_damage: true,
            },
        }],
    )?;

    if has_mask && result.total_hp_damage > 0.0 {
        schedule_mask_dot_ticks(state, ActorId::SelfActor, ActorId::Enemy);
    } else if state.stop_reason.is_none() {
        state.stop_reason = Some(StopReason::Completed);
    }

    Ok(())
}

fn execute_enemy_generate_shield(state: &mut RuntimeState) {
    let t_ms = state.now_ms;
    let shield_label = state
        .actor(ActorId::Enemy)
        .action(SKILL_GENERATE_SHIELD)
        .map(|action| action.label.clone())
        .unwrap_or_else(|| "生成护盾".to_string());
    state.log(RuntimeLog::ActionChosen {
        t_ms,
        actor_id: ActorId::Enemy,
        action_id: SKILL_GENERATE_SHIELD.to_string(),
        label: shield_label,
    });
    let requested_amount = formula_value(
        state,
        100.0 + state.actor(ActorId::Enemy).hp_max * 0.08,
        SHIELD_BYPASS_AMOUNT,
    );
    apply_generate_shield(state, ActorId::Enemy, requested_amount);
}

fn execute_enemy_stun(state: &mut RuntimeState) {
    let t_ms = state.now_ms;
    let stun_label = state
        .actor(ActorId::Enemy)
        .action(SKILL_STUN)
        .map(|action| action.label.clone())
        .unwrap_or_else(|| "眩晕".to_string());
    state.log(RuntimeLog::ActionChosen {
        t_ms,
        actor_id: ActorId::Enemy,
        action_id: SKILL_STUN.to_string(),
        label: stun_label,
    });
    let until_ms = t_ms.saturating_add(STUN_DURATION_MS);
    apply_stun(state, ActorId::SelfActor, until_ms);
    state.push_event(
        until_ms,
        STUN_EXPIRE_PRIORITY,
        InternalEvent::StunExpire {
            actor_id: ActorId::SelfActor,
            until_ms,
        },
    );
}

fn schedule_mask_dot_ticks(state: &mut RuntimeState, source_actor: ActorId, target_actor: ActorId) {
    for remaining_ticks in (1..=3).rev() {
        let tick_at_ms = state.now_ms + (4 - remaining_ticks) * 1000;
        state.push_event(
            tick_at_ms,
            DOT_TICK_PRIORITY,
            InternalEvent::DotTick {
                source_actor,
                target_actor,
                source_id: ITEM_MASK.to_string(),
                label: "面具 DoT".to_string(),
                dot_kind: DotEffectKind::Mask,
                remaining_ticks,
            },
        );
        state.log(RuntimeLog::DotScheduled {
            t_ms: state.now_ms,
            source_actor,
            target_actor,
            label: "面具 DoT".to_string(),
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
    let target_hp_max = state.actor(target_actor).hp_max;
    let tick_index = 4u32.saturating_sub(remaining_ticks);
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
            damage_type: DamageType::Magic,
            raw_damage: formula_value(state, target_hp_max * 0.02, MASK_DOT_BYPASS_DAMAGE),
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
