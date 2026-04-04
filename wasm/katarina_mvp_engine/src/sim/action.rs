use crate::combat_math::round_number;
use crate::effects::{apply_damage_packets_as_event, apply_generate_shield, apply_stun};
use crate::model::{DamageSourceKind, DamageType, EngineError, StopReason};
use crate::runtime::{reduce_skill_cooldowns, start_action_cooldown, RuntimeState};
use crate::types::{
    ActionBehavior, ActorId, BenchmarkDotRuntime, BenchmarkSkillRuntimeDef, DamageFlags, DamagePacket,
    DotEffectKind, InternalEvent, RuntimeLog,
};

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

fn required_skill_def(state: &RuntimeState, action_id: &str) -> Result<BenchmarkSkillRuntimeDef, EngineError> {
    state
        .skill_def(action_id)
        .cloned()
        .ok_or_else(|| EngineError::runtime(format!("missing benchmark skill def: {action_id}")))
}

fn action_label(state: &RuntimeState, actor_id: ActorId, action_id: &str, fallback: &str) -> String {
    state
        .actor(actor_id)
        .action(action_id)
        .map(|action| action.label.clone())
        .or_else(|| state.skill_def(action_id).map(|skill| skill.label.clone()))
        .unwrap_or_else(|| fallback.to_string())
}

fn evaluate_formula(
    state: &RuntimeState,
    formula_id: &str,
    source_actor: ActorId,
    target_actor: ActorId,
) -> Result<f64, EngineError> {
    Ok(round_number(state.eval_formula(formula_id, source_actor, target_actor)?))
}

fn normalized_flags(
    state: &RuntimeState,
    source_actor: ActorId,
    template: &DamageFlags,
    skill_crit_type: Option<&str>,
) -> DamageFlags {
    let mut flags = template.clone();
    // Inherit skill-level default critType if the component doesn’t specify one
    if flags.crit_type.is_none() {
        flags.crit_type = skill_crit_type.map(|s| s.to_string());
    }
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
            flags: normalized_flags(state, source_actor, &item_def.on_hit_flags, None),
        });
    }
    Ok(packets)
}

pub(super) fn has_enough_mana_for_action(state: &RuntimeState, actor_id: ActorId, action_id: &str) -> bool {
    let required_mana = state.actor(actor_id).action_mana_cost(action_id).max(0.0);
    if required_mana <= 0.0 {
        return true;
    }
    state.actor(actor_id).mana_current + 1e-9 >= required_mana
}

pub(super) fn next_action_retry_ms(state: &RuntimeState, actor_id: ActorId) -> u32 {
    if state.actor(actor_id).attr(crate::types::ATTR_MANA_REGEN) > 0.0 {
        state.next_rate_tick_ms.max(state.now_ms.saturating_add(1))
    } else {
        state.now_ms.saturating_add(1)
    }
}

pub(super) fn log_mana_blocked(state: &mut RuntimeState, actor_id: ActorId, action_id: &str, retry_at_ms: u32) {
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

pub(super) fn execute_benchmark_action(
    state: &mut RuntimeState,
    actor_id: ActorId,
    action_id: &str,
) -> Result<(), EngineError> {
    let behavior = state
        .actor(actor_id)
        .action(action_id)
        .map(|action| action.behavior)
        .ok_or_else(|| EngineError::runtime(format!("actor '{}' missing action '{}'", actor_id.as_key(), action_id)))?;

    match behavior {
        ActionBehavior::BasicAttack
        | ActionBehavior::MysticShot
        | ActionBehavior::ArcaneShift
        | ActionBehavior::DamageWindowBurst => execute_damage_action(state, actor_id, action_id),
        ActionBehavior::GenerateShield => execute_generate_shield_action(state, actor_id, action_id),
        ActionBehavior::Stun => execute_stun_action(state, actor_id, action_id),
    }
}

fn execute_damage_action(
    state: &mut RuntimeState,
    actor_id: ActorId,
    action_id: &str,
) -> Result<(), EngineError> {
    let t_ms = state.now_ms;
    let target_actor = actor_id.opponent();
    let skill_def = required_skill_def(state, action_id)?;
    let resolved_label = action_label(state, actor_id, action_id, &skill_def.label);
    let is_basic_attack = state
        .actor(actor_id)
        .action(action_id)
        .map(|a| a.behavior.is_basic_attack())
        .unwrap_or(false);
    let source_kind = if is_basic_attack {
        DamageSourceKind::BasicAttack
    } else {
        DamageSourceKind::Skill
    };
    let cooldown_tag = if is_basic_attack { "basic_attack" } else { "cast" };

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
    start_action_cooldown(state, actor_id, action_id, cooldown_tag);

    let damage_formula_id = skill_def
        .mechanics
        .damage_formula_id
        .as_deref()
        .ok_or_else(|| EngineError::runtime(format!("{action_id} missing damage formula")))?;
    let mut packets = Vec::with_capacity(1 + skill_def.attach_on_hit_item_ids.len());
    let skill_crit_type = skill_def.crit_type.clone();
    packets.push(DamagePacket {
        source_kind,
        source_id: skill_def.skill_id.clone(),
        label: resolved_label.clone(),
        damage_type: skill_def.damage_type.unwrap_or(DamageType::Physical),
        raw_damage: evaluate_formula(state, damage_formula_id, actor_id, target_actor)?,
        flags: normalized_flags(state, actor_id, &skill_def.flags, skill_crit_type.as_deref()),
    });
    packets.extend(build_attached_on_hit_packets(
        state,
        actor_id,
        target_actor,
        &skill_def.attach_on_hit_item_ids,
    )?);

    let result = apply_damage_packets_as_event(state, actor_id, target_actor, resolved_label, packets)?;

    // Data-driven post-hit: cooldown reduction
    if let Some(reduction_ms) = skill_def.mechanics.on_hit_cooldown_reduction_ms {
        if reduction_ms > 0 {
            reduce_skill_cooldowns(state, actor_id, reduction_ms, "on_hit_cooldown_reduction");
        }
    }

    // Data-driven post-hit: item DOT scheduling
    if skill_def.mechanics.triggers_item_dot {
        let dot_effects = owned_dot_effects(state, actor_id);
        if result.total_hp_damage > 0.0 {
            for dot in &dot_effects {
                schedule_dot_ticks(state, actor_id, target_actor, dot);
            }
        } else if state.stop_reason.is_none() {
            state.stop_reason = Some(StopReason::Completed);
        }
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

pub(super) fn execute_mask_dot_tick(
    state: &mut RuntimeState,
    source_actor: ActorId,
    target_actor: ActorId,
    source_id: String,
    label: String,
    remaining_ticks: u32,
) -> Result<(), EngineError> {
    let dot = dot_effect_by_source_id(state, &source_id)
        .ok_or_else(|| EngineError::runtime(format!("missing dot config for source '{source_id}'")))?;
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
                crit_type: None,
            },
        }],
    )?;
    Ok(())
}
