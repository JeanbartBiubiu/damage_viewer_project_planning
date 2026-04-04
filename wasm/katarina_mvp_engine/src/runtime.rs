use crate::combat_math::{resolve_cooldown_ms, round_number};
use crate::conversion_pipeline::apply_static_conversions;
use crate::formula::FormulaRuntimeView;
use crate::model::{
    DamageType, EngineDamageEvent, EngineError, EngineRunResult, EngineSamplePoint, StopReason, TestProfile,
};
use crate::types::*;
use std::collections::{BinaryHeap, HashMap};

// ===== ActorRuntime =====

#[derive(Debug, Clone)]
#[allow(dead_code)] // actor_id/label are identity fields for debug output
pub struct ActorRuntime {
    pub actor_id: ActorId,
    pub label: String,
    pub hp_current: f64,
    pub hp_max: f64,
    pub mana_current: f64,
    pub attrs: HashMap<String, f64>,
    pub base_attrs: HashMap<String, f64>,
    pub cooldowns: HashMap<String, u32>,
    pub black_cleaver: Option<BlackCleaverState>,
    pub count_to_three_marks: u32,
    pub shield: Option<ShieldState>,
    pub stun: Option<StunState>,
    pub damage_taken_window: Option<TemporalRingBuffer<DamageReceivedEntry>>,
    /// Deterministic crit counter. Shared across all crit-eligible damage components.
    /// Incremented on each crit-eligible hit; reset to 0 on crit.
    pub crit_counter: u32,
    pub priorities: Vec<String>,
    pub actions: HashMap<String, ActionRuntime>,
    pub owned_items: Vec<String>,
}

impl ActorRuntime {
    pub fn from_template(template: ActorTemplate) -> Self {
        let hp_max = template.attrs.get(ATTR_HP).copied().unwrap_or(0.0).max(0.0);
        let mana_current = template.attrs.get(ATTR_MANA).copied().unwrap_or(0.0).max(0.0);
        let cooldowns = template
            .actions
            .keys()
            .map(|action_id| (action_id.clone(), 0))
            .collect::<HashMap<_, _>>();

        Self {
            actor_id: template.actor_id,
            label: template.label,
            hp_current: hp_max,
            hp_max,
            mana_current,
            attrs: template.attrs.clone(),
            base_attrs: template.attrs,
            cooldowns,
            black_cleaver: None,
            count_to_three_marks: 0,
            shield: None,
            stun: None,
            damage_taken_window: template.requires_damage_taken_window.then(|| {
                TemporalRingBuffer::new(DAMAGE_TAKEN_WINDOW_MS, DAMAGE_TAKEN_WINDOW_SAMPLE_INTERVAL_MS)
            }),
            crit_counter: 0,
            priorities: template.priorities,
            actions: template.actions,
            owned_items: template.owned_items,
        }
    }

    pub fn attr(&self, key: &str) -> f64 {
        self.attrs.get(key).copied().unwrap_or(0.0)
    }

    pub fn base_attr(&self, key: &str) -> f64 {
        self.base_attrs.get(key).copied().unwrap_or(0.0)
    }

    pub fn set_attr(&mut self, key: &str, value: f64) {
        self.attrs.insert(key.to_string(), value);
    }

    pub fn has_item(&self, item_id: &str) -> bool {
        self.owned_items.iter().any(|owned| owned == item_id)
    }

    pub fn action(&self, action_id: &str) -> Option<&ActionRuntime> {
        self.actions.get(action_id)
    }

    pub fn action_ready_at(&self, action_id: &str) -> u32 {
        self.cooldowns.get(action_id).copied().unwrap_or(0)
    }

    pub fn action_mana_cost(&self, action_id: &str) -> f64 {
        self.action(action_id).map(|action| action.mana_cost).unwrap_or(0.0)
    }

    pub fn is_dead(&self) -> bool {
        self.hp_current <= 0.0
    }

    pub fn shield_amount(&self) -> f64 {
        self.shield.as_ref().map(|shield| shield.amount).unwrap_or(0.0)
    }

    pub fn record_damage_taken(&mut self, t_ms: u32, amount: f64, damage_type: DamageType, source_id: &str) {
        if amount <= 0.0 {
            return;
        }
        if let Some(window) = self.damage_taken_window.as_mut() {
            window.push(
                t_ms,
                DamageReceivedEntry {
                    amount: round_number(amount),
                    damage_type,
                    source_id: source_id.to_string(),
                },
            );
        }
    }

    pub fn damage_taken_in_window(&self, now_ms: u32, window_ms: u32) -> f64 {
        let Some(window) = self.damage_taken_window.as_ref() else {
            return 0.0;
        };
        let from_ms = now_ms.saturating_sub(window_ms);
        round_number(window.aggregate_window(from_ms, now_ms, 0.0, |acc, entry| acc + entry.amount))
    }
}

// ===== RuntimeState =====

pub struct RuntimeState {
    pub now_ms: u32,
    pub profile: TestProfile,
    pub max_duration_ms: u32,
    pub max_events: usize,
    pub processed_events: usize,
    pub queue: BinaryHeap<ScheduledEvent>,
    pub next_seq: u64,
    pub next_rate_tick_ms: u32,
    pub self_actor: ActorRuntime,
    pub enemy_actor: ActorRuntime,
    pub benchmark: BenchmarkRuntimeCatalog,
    pub logs: Vec<RuntimeLog>,
    pub samples: Vec<EngineSamplePoint>,
    pub damage_events: Vec<EngineDamageEvent>,
    pub stop_reason: Option<StopReason>,
    pub total_damage_to_enemy: f64,
    pub total_damage_to_self: f64,
    pub executed_hits: u32,
    pub time_to_kill_enemy_ms: Option<u32>,
    pub time_to_die_ms: Option<u32>,
}

impl RuntimeState {
    pub fn new(config: SimulationConfig) -> Self {
        Self {
            now_ms: 0,
            profile: config.profile,
            max_duration_ms: config.max_duration_ms,
            max_events: config.max_events.max(1),
            processed_events: 0,
            queue: BinaryHeap::new(),
            next_seq: 0,
            next_rate_tick_ms: 1000,
            self_actor: ActorRuntime::from_template(config.self_actor),
            enemy_actor: ActorRuntime::from_template(config.enemy_actor),
            benchmark: config.benchmark,
            logs: Vec::new(),
            samples: Vec::new(),
            damage_events: Vec::new(),
            stop_reason: None,
            total_damage_to_enemy: 0.0,
            total_damage_to_self: 0.0,
            executed_hits: 0,
            time_to_kill_enemy_ms: None,
            time_to_die_ms: None,
        }
    }

    pub fn actor(&self, actor_id: ActorId) -> &ActorRuntime {
        match actor_id {
            ActorId::SelfActor => &self.self_actor,
            ActorId::Enemy => &self.enemy_actor,
        }
    }

    pub fn actor_mut(&mut self, actor_id: ActorId) -> &mut ActorRuntime {
        match actor_id {
            ActorId::SelfActor => &mut self.self_actor,
            ActorId::Enemy => &mut self.enemy_actor,
        }
    }

    pub fn skill_def(&self, skill_id: &str) -> Option<&BenchmarkSkillRuntimeDef> {
        self.benchmark.skill_defs.get(skill_id)
    }

    pub fn item_def(&self, item_id: &str) -> Option<&BenchmarkItemRuntimeDef> {
        self.benchmark.item_defs.get(item_id)
    }

    pub fn count_to_three(&self) -> Option<&BenchmarkCountToThreeRuntime> {
        self.benchmark.rules.count_to_three.as_ref()
    }

    pub fn scheduler(&self) -> &BenchmarkSchedulerRuntime {
        &self.benchmark.rules.scheduler
    }

    pub fn eval_formula(
        &self,
        formula_id: &str,
        source_actor: ActorId,
        target_actor: ActorId,
    ) -> Result<f64, crate::model::EngineError> {
        let view = RuntimeFormulaView {
            state: self,
            source_actor,
            target_actor,
        };
        self.benchmark.formulas.evaluate(
            formula_id,
            &view,
            matches!(self.profile, TestProfile::FormulaBypass),
        )
    }

    /// Evaluate a pipeline formula (e.g. "mitigation.physical") with an injected `input_value`.
    /// Returns `None` if no pipeline formula is registered for the given binding key.
    pub fn eval_pipeline_formula(
        &self,
        binding_key: &str,
        input_value: f64,
        source_actor: ActorId,
        target_actor: ActorId,
    ) -> Option<Result<f64, crate::model::EngineError>> {
        let def = self.benchmark.pipeline_formulas.get(binding_key)?;
        let view = RuntimeFormulaView {
            state: self,
            source_actor,
            target_actor,
        };
        Some(def.evaluate(
            &view,
            Some(input_value),
            matches!(self.profile, TestProfile::FormulaBypass),
        ))
    }

    pub fn push_event(&mut self, t_ms: u32, priority: i32, event: InternalEvent) {
        self.next_seq += 1;
        self.queue.push(ScheduledEvent {
            t_ms,
            priority,
            seq: self.next_seq,
            event,
        });
    }

    pub fn pop_event(&mut self) -> Option<ScheduledEvent> {
        self.queue.pop()
    }

    pub fn log(&mut self, entry: RuntimeLog) {
        self.logs.push(entry);
    }

    pub fn push_sample(&mut self) {
        self.samples.push(EngineSamplePoint {
            t_ms: self.now_ms,
            self_hp: round_number(self.self_actor.hp_current),
            enemy_hp: round_number(self.enemy_actor.hp_current),
            cumulative_damage_to_enemy: round_number(self.total_damage_to_enemy),
            cumulative_damage_to_self: round_number(self.total_damage_to_self),
        });
    }

    pub fn mark_enemy_dead(&mut self) {
        if self.time_to_kill_enemy_ms.is_none() {
            self.time_to_kill_enemy_ms = Some(self.now_ms);
        }
        self.stop_reason.get_or_insert(StopReason::EnemyDead);
    }

    pub fn mark_self_dead(&mut self) {
        if self.time_to_die_ms.is_none() {
            self.time_to_die_ms = Some(self.now_ms);
        }
        if self.stop_reason.is_none() {
            self.stop_reason = Some(StopReason::SelfDead);
        }
    }

    pub fn check_terminal_state(&mut self) {
        if self.enemy_actor.hp_current <= 0.0 {
            self.mark_enemy_dead();
        }
        if self.self_actor.hp_current <= 0.0 {
            self.mark_self_dead();
        }
    }

    pub fn should_stop(&self) -> bool {
        self.stop_reason.is_some()
    }

    pub fn apply_periodic_regen_until(&mut self, now_ms: u32) {
        while self.next_rate_tick_ms <= now_ms {
            self.now_ms = self.next_rate_tick_ms;
            self.apply_regen_tick(ActorId::SelfActor);
            self.apply_regen_tick(ActorId::Enemy);
            self.next_rate_tick_ms = self.next_rate_tick_ms.saturating_add(1000);
        }
        self.now_ms = now_ms;
    }

    pub fn build_result(&self) -> EngineRunResult {
        EngineRunResult {
            stop_reason: self.stop_reason.unwrap_or(StopReason::Completed),
            time_to_kill_enemy_ms: self.time_to_kill_enemy_ms,
            time_to_die_ms: self.time_to_die_ms,
            total_damage_to_enemy: round_number(self.total_damage_to_enemy),
            total_damage_to_self: round_number(self.total_damage_to_self),
            executed_hits: self.executed_hits,
            action_duration_ms: self.now_ms,
            action_label: ACTION_LABEL_AUTO_BATTLE.to_string(),
            last_sample: self.samples.last().cloned(),
        }
    }

    fn apply_regen_tick(&mut self, actor_id: ActorId) {
        if self.actor(actor_id).is_dead() {
            return;
        }
        let hp_regen = self.actor(actor_id).attr(ATTR_HP_REGEN);
        if hp_regen > 0.0 {
            let (hp_before, hp_after, actual_heal) = {
                let actor = self.actor_mut(actor_id);
                let hp_before = actor.hp_current;
                actor.hp_current = (actor.hp_current + hp_regen).min(actor.hp_max);
                let hp_after = actor.hp_current;
                (hp_before, hp_after, hp_after - hp_before)
            };
            if actual_heal > 0.0 {
                self.log(RuntimeLog::HealApplied {
                    t_ms: self.now_ms,
                    actor_id,
                    amount: round_number(actual_heal),
                    reason: "hp_regen".to_string(),
                    hp_before: round_number(hp_before),
                    hp_after: round_number(hp_after),
                });
            }
        }

        let mana_regen = self.actor(actor_id).attr(ATTR_MANA_REGEN);
        let mana_max = self.actor(actor_id).base_attr(ATTR_MANA).max(0.0);
        if mana_regen > 0.0 && mana_max > 0.0 {
            let (mana_before, mana_after, actual_restore) = {
                let actor = self.actor_mut(actor_id);
                let mana_before = actor.mana_current;
                actor.mana_current = (actor.mana_current + mana_regen).min(mana_max);
                let mana_after = actor.mana_current;
                (mana_before, mana_after, mana_after - mana_before)
            };
            if actual_restore > 0.0 {
                self.log(RuntimeLog::ManaRestored {
                    t_ms: self.now_ms,
                    actor_id,
                    amount: round_number(actual_restore),
                    mana_before: round_number(mana_before),
                    mana_after: round_number(mana_after),
                });
            }
        }
    }
}

pub fn build_runtime(config: SimulationConfig) -> Result<RuntimeState, EngineError> {
    let uses_bypass = matches!(config.profile, TestProfile::FormulaBypass);
    let hp_attr_key = config.benchmark.hp_attr_key.clone();
    let rules = config.benchmark.conversion_rules.clone();
    let mut state = RuntimeState::new(config);
    apply_static_conversions(&mut state.self_actor, &rules, &hp_attr_key, uses_bypass)?;
    apply_static_conversions(&mut state.enemy_actor, &rules, &hp_attr_key, uses_bypass)?;
    Ok(state)
}

// ===== State mutation helpers =====

pub fn resolve_action_cooldown_ms(state: &RuntimeState, actor_id: ActorId, action_id: &str) -> Option<u32> {
    let actor = state.actor(actor_id);
    let action = actor.action(action_id)?;
    Some(resolve_cooldown_ms(action.cooldown, &actor.attrs))
}

pub fn start_action_cooldown(state: &mut RuntimeState, actor_id: ActorId, action_id: &str, reason: &str) {
    let Some(cooldown_ms) = resolve_action_cooldown_ms(state, actor_id, action_id) else {
        return;
    };
    let now_ms = state.now_ms;
    let action_id_owned = action_id.to_string();
    let (before_ready_ms, after_ready_ms) = {
        let actor = state.actor_mut(actor_id);
        let before = actor.cooldowns.get(action_id).copied().unwrap_or(now_ms);
        let after = now_ms.saturating_add(cooldown_ms);
        actor.cooldowns.insert(action_id_owned.clone(), after);
        (before, after)
    };
    state.log(RuntimeLog::CooldownAdjusted {
        t_ms: now_ms,
        actor_id,
        action_id: action_id_owned,
        before_ready_ms,
        after_ready_ms,
        reason: reason.to_string(),
    });
}

pub fn reduce_skill_cooldowns(state: &mut RuntimeState, actor_id: ActorId, reduction_ms: u32, reason: &str) {
    let action_ids = state
        .actor(actor_id)
        .actions
        .iter()
        .filter(|(_, action)| !action.behavior.is_basic_attack())
        .map(|(action_id, _)| action_id.clone())
        .collect::<Vec<_>>();

    let now_ms = state.now_ms;
    for action_id in action_ids {
        let (before_ready_ms, after_ready_ms) = {
            let actor = state.actor_mut(actor_id);
            let before = actor.cooldowns.get(&action_id).copied().unwrap_or(now_ms);
            let after = before.saturating_sub(reduction_ms).max(now_ms);
            actor.cooldowns.insert(action_id.clone(), after);
            (before, after)
        };
        state.log(RuntimeLog::CooldownAdjusted {
            t_ms: now_ms,
            actor_id,
            action_id,
            before_ready_ms,
            after_ready_ms,
            reason: reason.to_string(),
        });
    }
}

pub fn apply_black_cleaver_stack(
    state: &mut RuntimeState,
    actor_id: ActorId,
    added_stacks: u32,
    expire_after_ms: u32,
    armor_reduce_per_stack_ratio: f64,
    max_stacks: u32,
) {
    let now_ms = state.now_ms;
    let (stacks, armor_after, expire_at_ms) = {
        let actor = state.actor_mut(actor_id);
        let armor_max = actor
            .black_cleaver
            .as_ref()
            .map(|black_cleaver| black_cleaver.armor_max)
            .unwrap_or_else(|| actor.base_attr(ATTR_ARMOR));
        let current_stacks = actor.black_cleaver.as_ref().map(|black_cleaver| black_cleaver.stacks).unwrap_or(0);
        let stacks = current_stacks.saturating_add(added_stacks).min(max_stacks.max(1));
        let expire_at_ms = now_ms.saturating_add(expire_after_ms);
        actor.black_cleaver = Some(BlackCleaverState {
            stacks,
            expire_at_ms,
            armor_max,
        });
        let armor_after =
            (actor.base_attr(ATTR_ARMOR) - armor_max * armor_reduce_per_stack_ratio * stacks as f64).max(0.0);
        actor.set_attr(ATTR_ARMOR, armor_after);
        (stacks, armor_after, expire_at_ms)
    };
    state.log(RuntimeLog::BlackCleaverChanged {
        t_ms: now_ms,
        actor_id,
        stacks,
        armor_after: round_number(armor_after),
        expire_at_ms,
    });
}

// ===== Formula View Bridge =====

pub(crate) struct RuntimeFormulaView<'a> {
    pub(crate) state: &'a RuntimeState,
    pub(crate) source_actor: ActorId,
    pub(crate) target_actor: ActorId,
}

impl FormulaRuntimeView for RuntimeFormulaView<'_> {
    type ActorRef = ActorId;

    fn source_actor(&self) -> Self::ActorRef {
        self.source_actor
    }

    fn target_actor(&self) -> Self::ActorRef {
        self.target_actor
    }

    fn self_actor(&self) -> Self::ActorRef {
        ActorId::SelfActor
    }

    fn enemy_actor(&self) -> Self::ActorRef {
        ActorId::Enemy
    }

    fn actor_attr(&self, actor: Self::ActorRef, attr_key: &str) -> f64 {
        self.state.actor(actor).attr(attr_key)
    }

    fn actor_hp_current(&self, actor: Self::ActorRef) -> f64 {
        self.state.actor(actor).hp_current
    }

    fn actor_hp_max(&self, actor: Self::ActorRef) -> f64 {
        self.state.actor(actor).hp_max
    }

    fn actor_damage_taken_in_window(&self, actor: Self::ActorRef, window_ms: u32) -> f64 {
        self.state.actor(actor).damage_taken_in_window(self.state.now_ms, window_ms)
    }
}
