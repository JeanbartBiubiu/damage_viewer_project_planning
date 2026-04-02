use crate::combat_math::round_number;
use crate::runtime::RuntimeState;
use crate::types::{ActorId, InternalEvent, RuntimeLog, ShieldState, StunState, ATTR_ARMOR};

pub fn apply_generate_shield(
    state: &mut RuntimeState,
    actor_id: ActorId,
    shield_amount: f64,
) {
    if shield_amount <= 0.0 || state.actor(actor_id).is_dead() {
        return;
    }
    let requested = round_number(shield_amount);
    let now_ms = state.now_ms;
    let previous_amount = state.actor(actor_id).shield_amount();
    let new_amount = round_number(previous_amount.max(requested));
    let actor = state.actor_mut(actor_id);
    actor.shield = Some(ShieldState {
        amount: new_amount,
        refreshed_at_ms: now_ms,
    });
    state.log(RuntimeLog::ShieldChanged {
        t_ms: now_ms,
        actor_id,
        previous_amount: round_number(previous_amount),
        new_amount,
        requested_amount: requested,
    });
}

pub fn apply_stun(
    state: &mut RuntimeState,
    actor_id: ActorId,
    until_ms: u32,
) {
    {
        let actor = state.actor_mut(actor_id);
        actor.stun = Some(StunState { until_ms });
    }
    state.log(RuntimeLog::StunApplied {
        t_ms: state.now_ms,
        actor_id,
        until_ms,
    });
}

pub fn expire_stun(state: &mut RuntimeState, actor_id: ActorId, until_ms: u32) {
    let actor = state.actor_mut(actor_id);
    let should_expire = actor.stun.as_ref().is_some_and(|s| s.until_ms == until_ms);
    if should_expire {
        actor.stun = None;
        state.log(RuntimeLog::StunExpired {
            t_ms: state.now_ms,
            actor_id,
        });
    }
}

pub fn expire_black_cleaver(state: &mut RuntimeState, actor_id: ActorId, expire_at_ms: u32) {
    let result = {
        let actor = state.actor_mut(actor_id);
        match &actor.black_cleaver {
            Some(bc) if bc.expire_at_ms == expire_at_ms => {
                let armor_max = bc.armor_max;
                actor.black_cleaver = None;
                actor.set_attr(ATTR_ARMOR, armor_max);
                Some(round_number(armor_max))
            }
            _ => None,
        }
    };
    if let Some(armor_after) = result {
        state.log(RuntimeLog::BlackCleaverExpired {
            t_ms: state.now_ms,
            actor_id,
            armor_after,
        });
    }
}

pub(super) fn queue_black_cleaver_expire(state: &mut RuntimeState, actor_id: ActorId) {
    let bc = state.actor(actor_id).black_cleaver.as_ref();
    if let Some(bc) = bc {
        let expire_at_ms = bc.expire_at_ms;
        let priority = state.scheduler().black_cleaver_expire_priority;
        state.push_event(
            expire_at_ms,
            priority,
            InternalEvent::BlackCleaverExpire {
                actor_id,
                expire_at_ms,
            },
        );
    }
}
