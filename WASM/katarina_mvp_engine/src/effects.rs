#![allow(dead_code)]

use crate::model::{
    DamageType, EngineDamageComponent, EngineDamageEvent, EngineError, ErrorCode,
};
use crate::runtime::{
    apply_black_cleaver_stack, mitigation_multiplier, round_number, ActorId, DamageComponentTrace, DamagePacket,
    RuntimeLog, RuntimeState,
};

#[derive(Debug, Clone)]
pub struct ResolvedDamage {
    pub total_raw_damage: f64,
    pub total_dealt_damage: f64,
    pub total_hp_damage: f64,
    pub total_life_steal: f64,
    pub component_trace: DamageComponentTrace,
}

#[derive(Debug, Clone)]
pub struct ResolvedEvent {
    pub total_raw_damage: f64,
    pub total_dealt_damage: f64,
    pub total_hp_damage: f64,
    pub total_life_steal: f64,
    pub components: Vec<DamageComponentTrace>,
}

pub fn apply_damage_packet(
    state: &mut RuntimeState,
    source_actor: ActorId,
    target_actor: ActorId,
    packet: DamagePacket,
) -> Result<ResolvedDamage, EngineError> {
    let resolved = apply_damage_packets_as_event(
        state,
        source_actor,
        target_actor,
        packet.label.clone(),
        vec![packet],
    )?;
    let component_trace = resolved
        .components
        .into_iter()
        .next()
        .ok_or_else(|| runtime_error("resolved event has no components"))?;
    Ok(ResolvedDamage {
        total_raw_damage: resolved.total_raw_damage,
        total_dealt_damage: resolved.total_dealt_damage,
        total_hp_damage: resolved.total_hp_damage,
        total_life_steal: resolved.total_life_steal,
        component_trace,
    })
}

pub fn apply_damage_packets_as_event(
    state: &mut RuntimeState,
    source_actor: ActorId,
    target_actor: ActorId,
    label: String,
    packets: Vec<DamagePacket>,
) -> Result<ResolvedEvent, EngineError> {
    if packets.is_empty() {
        return Err(runtime_error("damage event requires at least one packet"));
    }

    let target_hp_before = state.actor(target_actor).hp_current;
    let target_shield_before = state.actor(target_actor).shield_amount();
    let mut components = Vec::with_capacity(packets.len());
    let mut event_components = Vec::with_capacity(packets.len());
    let mut total_raw_damage = 0.0;
    let mut total_dealt_damage = 0.0;
    let mut total_hp_damage = 0.0;
    let mut total_life_steal = 0.0;

    for packet in packets {
        let can_apply_black_cleaver = packet.flags.can_apply_black_cleaver;
        let resolved = resolve_component(state, source_actor, target_actor, packet)?;
        total_raw_damage += resolved.component.raw_damage;
        total_dealt_damage += resolved.component.dealt_damage;
        total_hp_damage += resolved.hp_damage;
        total_life_steal += resolved.life_steal_heal;
        if can_apply_black_cleaver && resolved.hp_damage > 0.0 {
            apply_black_cleaver_stack(state, target_actor, 1, 5_000);
            if let Some(expire_at_ms) = state.actor(target_actor).black_cleaver.as_ref().map(|black_cleaver| black_cleaver.expire_at_ms) {
                state.push_event(
                    expire_at_ms,
                    5,
                    crate::runtime::InternalEvent::BlackCleaverExpire {
                        actor_id: target_actor,
                        expire_at_ms,
                    },
                );
            }
        }
        event_components.push(resolved.component.clone());
        components.push(resolved);
    }

    let target_hp_after = state.actor(target_actor).hp_current;
    let target_shield_after = state.actor(target_actor).shield_amount();
    state.damage_events.push(EngineDamageEvent {
        sequence: state.damage_events.len() as u32 + 1,
        t_ms: state.now_ms,
        label: label.clone(),
        enemy_hp_before: round_number(target_hp_before),
        enemy_hp_after: round_number(target_hp_after),
        total_raw_damage: round_number(total_raw_damage),
        total_dealt_damage: round_number(total_dealt_damage),
        components: event_components,
    });
    state.log(RuntimeLog::DamageResolved {
        t_ms: state.now_ms,
        source_actor,
        target_actor,
        label,
        target_hp_before: round_number(target_hp_before),
        target_hp_after: round_number(target_hp_after),
        target_shield_before: round_number(target_shield_before),
        target_shield_after: round_number(target_shield_after),
        total_raw_damage: round_number(total_raw_damage),
        total_dealt_damage: round_number(total_dealt_damage),
        total_hp_damage: round_number(total_hp_damage),
        total_life_steal: round_number(total_life_steal),
        components: components.clone(),
    });

    match target_actor {
        ActorId::Enemy => state.total_damage_to_enemy += total_hp_damage,
        ActorId::SelfActor => state.total_damage_to_self += total_hp_damage,
    }
    state.executed_hits = state.executed_hits.saturating_add(1);
    state.push_sample();
    state.check_terminal_state();

    Ok(ResolvedEvent {
        total_raw_damage: round_number(total_raw_damage),
        total_dealt_damage: round_number(total_dealt_damage),
        total_hp_damage: round_number(total_hp_damage),
        total_life_steal: round_number(total_life_steal),
        components,
    })
}

pub fn apply_status_effects_after_hit(
    _state: &mut RuntimeState,
    _source_actor: ActorId,
    _target_actor: ActorId,
    _resolved: &ResolvedDamage,
) -> Result<(), EngineError> {
    Ok(())
}

pub fn apply_generate_shield(state: &mut RuntimeState, actor_id: ActorId, requested_amount: f64) {
    let now_ms = state.now_ms;
    let (previous_amount, new_amount) = {
        let actor = state.actor_mut(actor_id);
        let previous_amount = actor.shield_amount();
        let new_amount = previous_amount.max(requested_amount);
        actor.shield = Some(crate::runtime::ShieldState {
            amount: new_amount,
            refreshed_at_ms: now_ms,
        });
        (previous_amount, new_amount)
    };
    state.log(RuntimeLog::ShieldChanged {
        t_ms: now_ms,
        actor_id,
        previous_amount: round_number(previous_amount),
        new_amount: round_number(new_amount),
        requested_amount: round_number(requested_amount),
    });
}

pub fn apply_stun(state: &mut RuntimeState, actor_id: ActorId, until_ms: u32) {
    let now_ms = state.now_ms;
    state.actor_mut(actor_id).stun = Some(crate::runtime::StunState { until_ms });
    state.log(RuntimeLog::StunApplied {
        t_ms: now_ms,
        actor_id,
        until_ms,
    });
}

pub fn expire_stun(state: &mut RuntimeState, actor_id: ActorId, until_ms: u32) {
    let should_clear = state
        .actor(actor_id)
        .stun
        .as_ref()
        .is_some_and(|stun| stun.until_ms <= until_ms);
    if should_clear {
        let now_ms = state.now_ms;
        state.actor_mut(actor_id).stun = None;
        state.log(RuntimeLog::StunExpired {
            t_ms: now_ms,
            actor_id,
        });
    }
}

pub fn expire_black_cleaver(state: &mut RuntimeState, actor_id: ActorId, expire_at_ms: u32) {
    let should_clear = state
        .actor(actor_id)
        .black_cleaver
        .as_ref()
        .is_some_and(|black_cleaver| black_cleaver.expire_at_ms <= expire_at_ms);
    if should_clear {
        let now_ms = state.now_ms;
        let armor_after = state.actor(actor_id).base_attr(crate::runtime::ATTR_ARMOR);
        {
            let actor = state.actor_mut(actor_id);
            actor.black_cleaver = None;
            actor.set_attr(crate::runtime::ATTR_ARMOR, armor_after);
        }
        state.log(RuntimeLog::BlackCleaverExpired {
            t_ms: now_ms,
            actor_id,
            armor_after: round_number(armor_after),
        });
    }
}

fn resolve_component(
    state: &mut RuntimeState,
    source_actor: ActorId,
    target_actor: ActorId,
    packet: DamagePacket,
) -> Result<DamageComponentTrace, EngineError> {
    if packet.raw_damage.is_sign_negative() {
        return Err(runtime_error(format!(
            "damage packet '{}' has negative raw_damage",
            packet.label
        )));
    }

    let source_pen_flat = match packet.damage_type {
        DamageType::Physical => state.actor(source_actor).attr(crate::runtime::ATTR_ARMOR_PEN_FLAT),
        DamageType::Magic => state.actor(source_actor).attr(crate::runtime::ATTR_MAGIC_PEN_FLAT),
        DamageType::True => 0.0,
    };
    let target_resistance = match packet.damage_type {
        DamageType::Physical => state.actor(target_actor).attr(crate::runtime::ATTR_ARMOR),
        DamageType::Magic => state.actor(target_actor).attr(crate::runtime::ATTR_MAGIC_RESIST),
        DamageType::True => 0.0,
    };
    let effective_resistance = (target_resistance - source_pen_flat).max(-99.0);
    let mitigation = match packet.damage_type {
        DamageType::True => 1.0,
        _ => mitigation_multiplier(state.profile, effective_resistance),
    };

    let no_shield = matches!(state.profile, crate::model::TestProfile::NoShield);
    let target_shield_before = state.actor(target_actor).shield_amount();
    let dealt_damage = round_number(packet.raw_damage * mitigation);
    let (shield_after, shield_absorbed, hp_damage) = {
        let target = state.actor_mut(target_actor);
        let mut remaining = dealt_damage;
        let mut shield_absorbed = 0.0;
        if !no_shield {
            if let Some(shield) = target.shield.as_mut() {
                shield_absorbed = remaining.min(shield.amount);
                shield.amount -= shield_absorbed;
                remaining -= shield_absorbed;
                if shield.amount <= 0.0 {
                    target.shield = None;
                }
            }
        }
        let hp_damage = remaining.min(target.hp_current);
        target.hp_current = (target.hp_current - hp_damage).max(0.0);
        (target.shield_amount(), shield_absorbed, hp_damage)
    };

    let life_steal_heal = if packet.flags.can_life_steal {
        heal_source_from_life_steal(state, source_actor, hp_damage)
    } else {
        0.0
    };

    Ok(DamageComponentTrace {
        component: EngineDamageComponent {
            source_kind: packet.source_kind,
            source_id: packet.source_id,
            label: packet.label,
            damage_type: packet.damage_type,
            raw_damage: round_number(packet.raw_damage),
            dealt_damage,
        },
        shield_before: round_number(target_shield_before),
        shield_after: round_number(shield_after),
        shield_absorbed: round_number(shield_absorbed),
        hp_damage: round_number(hp_damage),
        life_steal_heal: round_number(life_steal_heal),
    })
}

fn heal_source_from_life_steal(state: &mut RuntimeState, source_actor: ActorId, hp_damage: f64) -> f64 {
    let life_steal = state.actor(source_actor).attr(crate::runtime::ATTR_LIFE_STEAL);
    let heal_power = state.actor(source_actor).attr(crate::runtime::ATTR_HEAL_POWER);
    let heal_amount = round_number(hp_damage * life_steal * (1.0 + heal_power));
    if heal_amount <= 0.0 || state.actor(source_actor).is_dead() {
        return 0.0;
    }

    let t_ms = state.now_ms;
    let (hp_before, hp_after) = {
        let source = state.actor_mut(source_actor);
        let hp_before = source.hp_current;
        source.hp_current = (source.hp_current + heal_amount).min(source.hp_max);
        (hp_before, source.hp_current)
    };
    let actual_heal = round_number(hp_after - hp_before);
    if actual_heal > 0.0 {
        state.log(RuntimeLog::HealApplied {
            t_ms,
            actor_id: source_actor,
            amount: actual_heal,
            reason: "life_steal".to_string(),
            hp_before: round_number(hp_before),
            hp_after: round_number(hp_after),
        });
    }
    actual_heal
}

fn runtime_error(message: impl Into<String>) -> EngineError {
    EngineError {
        code: ErrorCode::RuntimeError,
        message: message.into(),
    }
}
