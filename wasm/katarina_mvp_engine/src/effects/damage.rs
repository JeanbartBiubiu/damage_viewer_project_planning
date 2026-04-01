#![allow(dead_code)]

use crate::combat_math::{mitigation_multiplier, round_number};
use crate::model::{
    DamageType, EngineDamageComponent, EngineDamageEvent, EngineError, ErrorCode,
};
use crate::runtime::{apply_black_cleaver_stack, RuntimeState};
use crate::types::{ActorId, DamageComponentTrace, DamagePacket, RuntimeLog};

use super::status::queue_black_cleaver_expire;

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

#[derive(Debug, Clone)]
enum PostHitAction {
    ApplyBlackCleaver {
        actor_id: ActorId,
        added_stacks: u32,
        expire_after_ms: u32,
        armor_reduce_per_stack_ratio: f64,
        max_stacks: u32,
    },
    CountToThreeTrueDamage {
        source_actor: ActorId,
        target_actor: ActorId,
        source_id: String,
        label: String,
        raw_damage: f64,
    },
    ThornmailRetaliate {
        source_actor: ActorId,
        target_actor: ActorId,
        source_id: String,
        label: String,
        damage_type: DamageType,
        raw_damage: f64,
    },
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
    let mut post_hit_actions = Vec::new();

    for packet in packets {
        let resolved = resolve_component(state, source_actor, target_actor, &packet)?;
        total_raw_damage += resolved.component.raw_damage;
        total_dealt_damage += resolved.component.dealt_damage;
        total_hp_damage += resolved.hp_damage;
        total_life_steal += resolved.life_steal_heal;
        post_hit_actions.extend(apply_status_effects_after_hit(
            state,
            source_actor,
            target_actor,
            &packet,
            &resolved,
        )?);
        event_components.push(resolved.component.clone());
        components.push(resolved);
    }

    let target_hp_after = state.actor(target_actor).hp_current;
    let target_shield_after = state.actor(target_actor).shield_amount();
    if matches!(target_actor, ActorId::Enemy) {
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
    }
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
    if matches!(target_actor, ActorId::Enemy) {
        state.executed_hits = state.executed_hits.saturating_add(1);
        state.push_sample();
    }
    state.check_terminal_state();
    let now_ms = state.now_ms;
    {
        let target = state.actor_mut(target_actor);
        for component in &components {
            target.record_damage_taken(
                now_ms,
                component.hp_damage,
                component.component.damage_type,
                &component.component.source_id,
            );
        }
    }

    for action in post_hit_actions {
        execute_post_hit_action(state, action)?;
    }

    Ok(ResolvedEvent {
        total_raw_damage: round_number(total_raw_damage),
        total_dealt_damage: round_number(total_dealt_damage),
        total_hp_damage: round_number(total_hp_damage),
        total_life_steal: round_number(total_life_steal),
        components,
    })
}

fn apply_status_effects_after_hit(
    state: &mut RuntimeState,
    source_actor: ActorId,
    target_actor: ActorId,
    packet: &DamagePacket,
    resolved: &DamageComponentTrace,
) -> Result<Vec<PostHitAction>, EngineError> {
    let mut actions = Vec::new();

    if packet.flags.can_apply_black_cleaver && resolved.component.dealt_damage > 0.0 {
        for item_def in equipped_item_defs(state, source_actor) {
            if let Some(black_cleaver) = item_def.black_cleaver.as_ref() {
                actions.push(PostHitAction::ApplyBlackCleaver {
                    actor_id: target_actor,
                    added_stacks: 1,
                    expire_after_ms: black_cleaver.expire_after_ms,
                    armor_reduce_per_stack_ratio: black_cleaver.armor_reduce_per_stack_ratio,
                    max_stacks: black_cleaver.max_stacks,
                });
            }
        }
    }

    if packet.flags.counts_as_attack && resolved.component.dealt_damage > 0.0 {
        let count_to_three = state.count_to_three().cloned();
        let Some(count_to_three) = count_to_three else {
            return Ok(actions);
        };
        let should_trigger = {
            let actor = state.actor_mut(source_actor);
            actor.count_to_three_marks = actor.count_to_three_marks.saturating_add(1);
            if actor.count_to_three_marks >= count_to_three.proc_every_hits.max(1) {
                actor.count_to_three_marks = 0;
                true
            } else {
                false
            }
        };
        if should_trigger {
            let raw_damage = round_number(state.eval_formula(
                &count_to_three.true_damage_formula_id,
                source_actor,
                target_actor,
            )?);
            actions.push(PostHitAction::CountToThreeTrueDamage {
                source_actor,
                target_actor,
                source_id: count_to_three.source_skill_id,
                label: count_to_three.label,
                raw_damage,
            });
        }
    }

    if packet.flags.can_trigger_on_hit && resolved.component.dealt_damage > 0.0 {
        for thornmail in equipped_item_defs(state, target_actor) {
            if let Some(formula_id) = thornmail.thornmail_retaliate_formula_id.as_deref() {
                let raw_damage = round_number(state.eval_formula(formula_id, target_actor, source_actor)?);
                actions.push(PostHitAction::ThornmailRetaliate {
                    source_actor: target_actor,
                    target_actor: source_actor,
                    source_id: thornmail.item_id.clone(),
                    label: thornmail.label.clone(),
                    damage_type: thornmail.thornmail_retaliate_damage_type.unwrap_or(DamageType::Magic),
                    raw_damage,
                });
            }
        }
    }

    Ok(actions)
}

fn resolve_component(
    state: &mut RuntimeState,
    source_actor: ActorId,
    target_actor: ActorId,
    packet: &DamagePacket,
) -> Result<DamageComponentTrace, EngineError> {
    if packet.raw_damage.is_sign_negative() {
        return Err(runtime_error(format!(
            "damage packet '{}' has negative raw_damage",
            packet.label
        )));
    }

    let source_pen_flat = match packet.damage_type {
        DamageType::Physical => state.actor(source_actor).attr(crate::types::ATTR_ARMOR_PEN_FLAT),
        DamageType::Magic => state.actor(source_actor).attr(crate::types::ATTR_MAGIC_PEN_FLAT),
        DamageType::True => 0.0,
    };
    let target_resistance = match packet.damage_type {
        DamageType::Physical => state.actor(target_actor).attr(crate::types::ATTR_ARMOR),
        DamageType::Magic => state.actor(target_actor).attr(crate::types::ATTR_MAGIC_RESIST),
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
        heal_source_from_life_steal(state, source_actor, dealt_damage)
    } else {
        0.0
    };

    Ok(DamageComponentTrace {
        component: EngineDamageComponent {
            source_kind: packet.source_kind,
            source_id: packet.source_id.clone(),
            label: packet.label.clone(),
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

fn execute_post_hit_action(state: &mut RuntimeState, action: PostHitAction) -> Result<(), EngineError> {
    match action {
        PostHitAction::ApplyBlackCleaver {
            actor_id,
            added_stacks,
            expire_after_ms,
            armor_reduce_per_stack_ratio,
            max_stacks,
        } => {
            if state.actor(actor_id).is_dead() {
                return Ok(());
            }
            apply_black_cleaver_stack(
                state,
                actor_id,
                added_stacks,
                expire_after_ms,
                armor_reduce_per_stack_ratio,
                max_stacks,
            );
            queue_black_cleaver_expire(state, actor_id);
            Ok(())
        }
        PostHitAction::CountToThreeTrueDamage {
            source_actor,
            target_actor,
            source_id,
            label,
            raw_damage,
            ..
        } => {
            if state.actor(target_actor).is_dead() {
                return Ok(());
            }
            let packet = DamagePacket {
                source_kind: crate::model::DamageSourceKind::Skill,
                source_id,
                label,
                damage_type: DamageType::True,
                raw_damage,
                flags: crate::types::DamageFlags::none(),
            };
            let _ = apply_damage_packet(state, source_actor, target_actor, packet)?;
            Ok(())
        }
        PostHitAction::ThornmailRetaliate {
            source_actor,
            target_actor,
            source_id,
            label,
            damage_type,
            raw_damage,
            ..
        } => {
            if state.actor(source_actor).is_dead() || state.actor(target_actor).is_dead() {
                return Ok(());
            }
            let packet = DamagePacket {
                source_kind: crate::model::DamageSourceKind::Item,
                source_id,
                label,
                damage_type,
                raw_damage,
                flags: crate::types::DamageFlags::none(),
            };
            let _ = apply_damage_packet(state, source_actor, target_actor, packet)?;
            Ok(())
        }
    }
}

fn heal_source_from_life_steal(state: &mut RuntimeState, source_actor: ActorId, dealt_damage: f64) -> f64 {
    let life_steal = state.actor(source_actor).attr(crate::types::ATTR_LIFE_STEAL);
    let heal_power = state.actor(source_actor).attr(crate::types::ATTR_HEAL_POWER);
    let heal_amount = round_number(dealt_damage * life_steal * (1.0 + heal_power));
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

fn equipped_item_defs(
    state: &RuntimeState,
    actor_id: ActorId,
) -> Vec<crate::types::BenchmarkItemRuntimeDef> {
    state
        .actor(actor_id)
        .owned_items
        .iter()
        .filter_map(|item_id| state.item_def(item_id).cloned())
        .collect()
}

fn runtime_error(message: impl Into<String>) -> EngineError {
    EngineError {
        code: ErrorCode::RuntimeError,
        message: message.into(),
    }
}
