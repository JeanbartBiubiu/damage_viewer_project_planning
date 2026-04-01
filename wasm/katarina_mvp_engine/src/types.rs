#![allow(dead_code)]

use crate::formula::CompiledFormulaCatalog;
use crate::model::{DamageSourceKind, DamageType, EngineDamageComponent, TestProfile};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::fmt::Debug;

// ===== Attribute Key Constants =====

pub const ATTR_HP: &str = "hp";
pub const ATTR_MANA: &str = "mana";
pub const ATTR_MANA_REGEN: &str = "mana_regen";
pub const ATTR_AD: &str = "ad";
pub const ATTR_AP: &str = "ap";
pub const ATTR_ARMOR: &str = "armor";
pub const ATTR_MAGIC_RESIST: &str = "magic_resist";
pub const ATTR_ARMOR_PEN_FLAT: &str = "armor_pen_flat";
pub const ATTR_MAGIC_PEN_FLAT: &str = "magic_pen_flat";
pub const ATTR_ATTACK_SPEED_BASE: &str = "attack_speed_base";
pub const ATTR_ATTACK_SPEED_BONUS: &str = "attack_speed_bonus";
pub const ATTR_ATTACK_SPEED_RATIO: &str = "attack_speed_ratio";
pub const ATTR_HP_REGEN: &str = "hp_regen";
pub const ATTR_ABILITY_HASTE: &str = "ability_haste";
pub const ATTR_LIFE_STEAL: &str = "life_steal";
pub const ATTR_HEAL_POWER: &str = "heal_power";
pub const DAMAGE_TAKEN_WINDOW_MS: u32 = 4_000;
pub const DAMAGE_TAKEN_WINDOW_SAMPLE_INTERVAL_MS: u32 = 50;

pub const ACTION_LABEL_AUTO_BATTLE: &str = "benchmark_auto_battle";

// ===== Actor Identity =====

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ActorId {
    SelfActor,
    Enemy,
}

impl ActorId {
    pub fn as_key(self) -> &'static str {
        match self {
            Self::SelfActor => "self",
            Self::Enemy => "enemy",
        }
    }

    pub fn opponent(self) -> Self {
        match self {
            Self::SelfActor => Self::Enemy,
            Self::Enemy => Self::SelfActor,
        }
    }
}

pub use crate::model::ActionBehavior;

impl ActionBehavior {
    pub fn is_basic_attack(self) -> bool {
        matches!(self, Self::BasicAttack)
    }
}

// ===== Cooldown & Action =====

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CooldownSpec {
    BasicAttackInterval,
    AbilityHasteScaled { base_ms: u32 },
    FixedMs(u32),
}

#[derive(Debug, Clone)]
pub struct ActionRuntime {
    pub action_id: String,
    pub label: String,
    pub priority: i32,
    pub behavior: ActionBehavior,
    pub cooldown: CooldownSpec,
    pub mana_cost: f64,
}

// ===== Benchmark Runtime Definitions =====

#[derive(Debug, Clone)]
pub struct BenchmarkDotRuntime {
    pub source_id: String,
    pub label: String,
    pub formula_id: String,
    pub ticks: u32,
    pub interval_ms: u32,
    pub damage_type: DamageType,
}

#[derive(Debug, Clone, Default)]
pub struct BenchmarkSkillMechanics {
    pub damage_formula_id: Option<String>,
    pub on_hit_cooldown_reduction_ms: Option<u32>,
    pub stun_duration_ms: Option<u32>,
    pub dot: Option<BenchmarkDotRuntime>,
    pub triggers_item_dot: bool,
}

#[derive(Debug, Clone)]
pub struct BenchmarkSkillRuntimeDef {
    pub skill_id: String,
    pub label: String,
    pub type_ids: Vec<String>,
    pub damage_type: Option<DamageType>,
    pub flags: DamageFlags,
    pub attach_on_hit_item_ids: Vec<String>,
    pub mechanics: BenchmarkSkillMechanics,
    pub final_kill_enemy_hp_override: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct BenchmarkBlackCleaverRuntime {
    pub expire_after_ms: u32,
    pub armor_reduce_per_stack_ratio: f64,
    pub max_stacks: u32,
}

#[derive(Debug, Clone)]
pub struct BenchmarkItemRuntimeDef {
    pub item_id: String,
    pub label: String,
    pub on_hit_damage_formula_id: Option<String>,
    pub on_hit_damage_type: Option<DamageType>,
    pub on_hit_flags: DamageFlags,
    pub dot: Option<BenchmarkDotRuntime>,
    pub thornmail_retaliate_formula_id: Option<String>,
    pub thornmail_retaliate_damage_type: Option<DamageType>,
    pub black_cleaver: Option<BenchmarkBlackCleaverRuntime>,
}

#[derive(Debug, Clone)]
pub struct BenchmarkCountToThreeRuntime {
    pub source_skill_id: String,
    pub label: String,
    pub proc_every_hits: u32,
    pub true_damage_formula_id: String,
}

#[derive(Debug, Clone, Default)]
pub struct BenchmarkSchedulerRuntime {
    pub decide_priority: i32,
    pub dot_tick_priority: i32,
    pub stun_expire_priority: i32,
    pub black_cleaver_expire_priority: i32,
}

#[derive(Debug, Clone, Default)]
pub struct BenchmarkRulesRuntime {
    pub scheduler: BenchmarkSchedulerRuntime,
    pub count_to_three: Option<BenchmarkCountToThreeRuntime>,
}

#[derive(Debug, Clone, Default)]
pub struct BenchmarkRuntimeCatalog {
    pub skill_defs: HashMap<String, BenchmarkSkillRuntimeDef>,
    pub item_defs: HashMap<String, BenchmarkItemRuntimeDef>,
    pub formulas: CompiledFormulaCatalog,
    pub rules: BenchmarkRulesRuntime,
}

// ===== Temporal Ring Buffer =====

#[derive(Debug, Clone)]
struct TimestampedEntry<T: Clone + Debug> {
    t_ms: u32,
    value: T,
}

#[derive(Debug, Clone)]
pub struct TemporalRingBuffer<T: Clone + Debug> {
    entries: Vec<Option<TimestampedEntry<T>>>,
    write_cursor: usize,
    len: usize,
    capacity: usize,
}

impl<T: Clone + Debug> TemporalRingBuffer<T> {
    pub fn new(window_ms: u32, sample_interval_ms: u32) -> Self {
        let normalized_interval_ms = sample_interval_ms.max(1);
        let capacity = (window_ms / normalized_interval_ms).max(1) as usize + 1;
        Self {
            entries: (0..capacity).map(|_| None).collect(),
            write_cursor: 0,
            len: 0,
            capacity,
        }
    }

    pub fn push(&mut self, t_ms: u32, value: T) {
        self.entries[self.write_cursor] = Some(TimestampedEntry { t_ms, value });
        self.write_cursor = (self.write_cursor + 1) % self.capacity;
        if self.len < self.capacity {
            self.len += 1;
        }
    }

    pub fn aggregate_window<F, R>(&self, from_ms: u32, to_ms: u32, init: R, mut f: F) -> R
    where
        F: FnMut(R, &T) -> R,
    {
        self.entries
            .iter()
            .flatten()
            .filter(|entry| entry.t_ms >= from_ms && entry.t_ms <= to_ms)
            .fold(init, |acc, entry| f(acc, &entry.value))
    }

    pub fn len(&self) -> usize {
        self.len
    }
}

// ===== Actor State Types =====

#[derive(Debug, Clone)]
pub struct ShieldState {
    pub amount: f64,
    pub refreshed_at_ms: u32,
}

#[derive(Debug, Clone)]
pub struct BlackCleaverState {
    pub stacks: u32,
    pub expire_at_ms: u32,
    pub armor_max: f64,
}

#[derive(Debug, Clone)]
pub struct StunState {
    pub until_ms: u32,
}

#[derive(Debug, Clone)]
pub struct DamageReceivedEntry {
    pub amount: f64,
    pub damage_type: DamageType,
    pub source_id: String,
}

// ===== Templates =====

#[derive(Debug, Clone)]
pub struct ActorTemplate {
    pub actor_id: ActorId,
    pub label: String,
    pub attrs: HashMap<String, f64>,
    pub requires_damage_taken_window: bool,
    pub owned_items: Vec<String>,
    pub priorities: Vec<String>,
    pub actions: HashMap<String, ActionRuntime>,
}

#[derive(Debug, Clone)]
pub struct SimulationConfig {
    pub profile: TestProfile,
    pub max_duration_ms: u32,
    pub max_events: usize,
    pub self_actor: ActorTemplate,
    pub enemy_actor: ActorTemplate,
    pub benchmark: BenchmarkRuntimeCatalog,
}

// ===== Damage Types =====

#[derive(Debug, Clone)]
pub struct DamageFlags {
    pub can_trigger_on_hit: bool,
    pub can_life_steal: bool,
    pub can_apply_black_cleaver: bool,
    pub counts_as_attack: bool,
    pub is_active_skill_magic_damage: bool,
}

impl DamageFlags {
    pub fn none() -> Self {
        Self {
            can_trigger_on_hit: false,
            can_life_steal: false,
            can_apply_black_cleaver: false,
            counts_as_attack: false,
            is_active_skill_magic_damage: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct DamagePacket {
    pub source_kind: DamageSourceKind,
    pub source_id: String,
    pub label: String,
    pub damage_type: DamageType,
    pub raw_damage: f64,
    pub flags: DamageFlags,
}

#[derive(Debug, Clone)]
pub struct DamageComponentTrace {
    pub component: EngineDamageComponent,
    pub shield_before: f64,
    pub shield_after: f64,
    pub shield_absorbed: f64,
    pub hp_damage: f64,
    pub life_steal_heal: f64,
}

// ===== Runtime Logging =====

#[derive(Debug, Clone)]
pub enum RuntimeLog {
    ActionChosen {
        t_ms: u32,
        actor_id: ActorId,
        action_id: String,
        label: String,
    },
    ActionBlocked {
        t_ms: u32,
        actor_id: ActorId,
        action_id: String,
        reason: String,
        retry_at_ms: u32,
        current_mana: Option<f64>,
        required_mana: Option<f64>,
    },
    DamageResolved {
        t_ms: u32,
        source_actor: ActorId,
        target_actor: ActorId,
        label: String,
        target_hp_before: f64,
        target_hp_after: f64,
        target_shield_before: f64,
        target_shield_after: f64,
        total_raw_damage: f64,
        total_dealt_damage: f64,
        total_hp_damage: f64,
        total_life_steal: f64,
        components: Vec<DamageComponentTrace>,
    },
    ShieldChanged {
        t_ms: u32,
        actor_id: ActorId,
        previous_amount: f64,
        new_amount: f64,
        requested_amount: f64,
    },
    HealApplied {
        t_ms: u32,
        actor_id: ActorId,
        amount: f64,
        reason: String,
        hp_before: f64,
        hp_after: f64,
    },
    ManaRestored {
        t_ms: u32,
        actor_id: ActorId,
        amount: f64,
        mana_before: f64,
        mana_after: f64,
    },
    ManaSpent {
        t_ms: u32,
        actor_id: ActorId,
        action_id: String,
        amount: f64,
        mana_before: f64,
        mana_after: f64,
    },
    DotScheduled {
        t_ms: u32,
        source_actor: ActorId,
        target_actor: ActorId,
        label: String,
        tick_at_ms: u32,
        remaining_ticks_after_schedule: u32,
    },
    CooldownAdjusted {
        t_ms: u32,
        actor_id: ActorId,
        action_id: String,
        before_ready_ms: u32,
        after_ready_ms: u32,
        reason: String,
    },
    BlackCleaverChanged {
        t_ms: u32,
        actor_id: ActorId,
        stacks: u32,
        armor_after: f64,
        expire_at_ms: u32,
    },
    BlackCleaverExpired {
        t_ms: u32,
        actor_id: ActorId,
        armor_after: f64,
    },
    StunApplied {
        t_ms: u32,
        actor_id: ActorId,
        until_ms: u32,
    },
    StunExpired {
        t_ms: u32,
        actor_id: ActorId,
    },
}

// ===== Event System =====

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DotEffectKind {
    Mask,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InternalEvent {
    ActorDecide { actor_id: ActorId },
    DotTick {
        source_actor: ActorId,
        target_actor: ActorId,
        source_id: String,
        label: String,
        dot_kind: DotEffectKind,
        remaining_ticks: u32,
    },
    StunExpire {
        actor_id: ActorId,
        until_ms: u32,
    },
    BlackCleaverExpire {
        actor_id: ActorId,
        expire_at_ms: u32,
    },
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct ScheduledEvent {
    pub t_ms: u32,
    pub priority: i32,
    pub seq: u64,
    pub event: InternalEvent,
}

impl Ord for ScheduledEvent {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .t_ms
            .cmp(&self.t_ms)
            .then_with(|| other.priority.cmp(&self.priority))
            .then_with(|| other.seq.cmp(&self.seq))
    }
}

impl PartialOrd for ScheduledEvent {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

// ===== Utility =====

pub fn total_attack_speed_from_attrs(attrs: &HashMap<String, f64>) -> f64 {
    let base = attrs.get(ATTR_ATTACK_SPEED_BASE).copied().unwrap_or(0.0);
    let bonus = attrs.get(ATTR_ATTACK_SPEED_BONUS).copied().unwrap_or(0.0);
    let ratio = attrs.get(ATTR_ATTACK_SPEED_RATIO).copied().unwrap_or(0.0);
    base + bonus * ratio
}

// ===== Tests =====

#[cfg(test)]
mod tests {
    use super::TemporalRingBuffer;

    #[test]
    fn temporal_ring_buffer_starts_empty() {
        let buffer = TemporalRingBuffer::<u32>::new(4_000, 50);
        assert_eq!(buffer.len(), 0);
        let sum = buffer.aggregate_window(0, 4_000, 0, |acc, value| acc + value);
        assert_eq!(sum, 0);
    }

    #[test]
    fn temporal_ring_buffer_aggregates_single_entry() {
        let mut buffer = TemporalRingBuffer::<u32>::new(4_000, 50);
        buffer.push(250, 7);

        let sum = buffer.aggregate_window(0, 4_000, 0, |acc, value| acc + value);
        assert_eq!(buffer.len(), 1);
        assert_eq!(sum, 7);
    }

    #[test]
    fn temporal_ring_buffer_overwrites_old_entries_when_full() {
        let mut buffer = TemporalRingBuffer::<u32>::new(100, 50);
        buffer.push(0, 1);
        buffer.push(50, 2);
        buffer.push(100, 3);
        buffer.push(150, 4);

        let sum = buffer.aggregate_window(0, 150, 0, |acc, value| acc + value);
        assert_eq!(buffer.len(), 3);
        assert_eq!(sum, 9);
    }

    #[test]
    fn temporal_ring_buffer_filters_to_requested_window() {
        let mut buffer = TemporalRingBuffer::<u32>::new(4_000, 50);
        buffer.push(500, 3);
        buffer.push(3_000, 5);
        buffer.push(4_500, 7);

        let sum = buffer.aggregate_window(1_000, 4_500, 0, |acc, value| acc + value);
        assert_eq!(sum, 12);
    }
}
