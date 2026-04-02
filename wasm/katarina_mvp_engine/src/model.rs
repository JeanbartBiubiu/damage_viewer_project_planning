use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInitPayload {
    pub meta: EngineMeta,
    pub bundle: GameDataBundle,
    #[serde(default)]
    pub engine_config: Option<EngineConfig>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineMeta {
    pub game_id: String,
    pub version_id: u64,
    pub data_hash: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    #[serde(default)]
    pub hp_attr_key: Option<String>,
    #[serde(default)]
    pub test_profile: Option<TestProfile>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TestProfile {
    #[default]
    Full,
    FormulaBypass,
    BucketIdentity,
    NoControl,
    NoShield,
}

impl EngineConfig {
    pub fn resolved_hp_attr_key(&self) -> &str {
        self.hp_attr_key.as_deref().unwrap_or("hp")
    }

    pub fn resolved_test_profile(&self) -> TestProfile {
        self.test_profile.unwrap_or_default()
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDataBundle {
    pub meta: BundleMeta,
    #[serde(default)]
    pub attribute_definitions: Vec<AttributeDefinition>,
    #[serde(default)]
    pub heroes: Vec<Hero>,
    #[serde(default)]
    pub skills: Vec<Skill>,
    #[serde(default)]
    pub items: Vec<Item>,
    #[serde(default)]
    pub benchmark: Option<BenchmarkBundle>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleMeta {
    pub game_id: String,
    pub version_id: u64,
    pub version_code: String,
    pub data_hash: String,
    pub generated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkBundle {
    pub hp_attr_key: String,
    pub self_actor: BenchmarkActorDefinition,
    pub enemy_actor: BenchmarkActorDefinition,
    pub rules: BenchmarkRules,
    #[serde(default)]
    pub skill_defs: Vec<BenchmarkSkillDefinition>,
    #[serde(default)]
    pub item_defs: Vec<BenchmarkItemDefinition>,
    #[serde(default)]
    pub formulas: Vec<BenchmarkFormulaDefinition>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkRules {
    pub scheduler: BenchmarkSchedulerRule,
    #[serde(default)]
    pub count_to_three: Option<BenchmarkCountToThreeRule>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkSchedulerRule {
    pub decide_priority: i32,
    pub dot_tick_priority: i32,
    pub stun_expire_priority: i32,
    pub black_cleaver_expire_priority: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkCountToThreeRule {
    pub source_skill_id: String,
    pub label: String,
    pub true_damage_formula_id: String,
    pub proc_every_hits: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkActorDefinition {
    pub hero_id: String,
    pub label: String,
    #[serde(default)]
    pub attrs: HashMap<String, f64>,
    #[serde(default)]
    pub requires_damage_taken_window: bool,
    #[serde(default)]
    pub owned_item_ids: Vec<String>,
    #[serde(default)]
    pub priorities: Vec<String>,
    #[serde(default)]
    pub actions: Vec<BenchmarkActionDefinition>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkActionDefinition {
    pub action_id: String,
    pub label: String,
    pub priority: i32,
    pub behavior: ActionBehavior,
    pub cooldown: BenchmarkCooldownDefinition,
    #[serde(default)]
    pub mana_cost: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionBehavior {
    BasicAttack,
    MysticShot,
    ArcaneShift,
    DamageWindowBurst,
    GenerateShield,
    Stun,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum BenchmarkCooldownDefinition {
    BasicAttackInterval,
    AbilityHasteScaled { base_ms: u32 },
    FixedMs { ms: u32 },
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkDamageFlags {
    #[serde(default)]
    pub can_trigger_on_hit: bool,
    #[serde(default)]
    pub can_life_steal: bool,
    #[serde(default)]
    pub can_apply_black_cleaver: bool,
    #[serde(default)]
    pub counts_as_attack: bool,
    #[serde(default)]
    pub is_active_skill_magic_damage: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkSkillDefinition {
    pub skill_id: String,
    pub label: String,
    #[serde(default)]
    pub type_ids: Vec<String>,
    #[serde(default)]
    pub primary_formula_id: Option<String>,
    #[serde(default)]
    pub damage_type: Option<DamageType>,
    #[serde(default)]
    pub flags: BenchmarkDamageFlags,
    #[serde(default)]
    pub attach_on_hit_item_ids: Vec<String>,
    #[serde(default)]
    pub cooldown_reduction_on_hit_ms: Option<u32>,
    #[serde(default)]
    pub shield_formula_id: Option<String>,
    #[serde(default)]
    pub stun_duration_ms: Option<u32>,
    #[serde(default)]
    pub dot_formula_id: Option<String>,
    #[serde(default)]
    pub dot_ticks: Option<u32>,
    #[serde(default)]
    pub dot_interval_ms: Option<u32>,
    #[serde(default)]
    pub final_kill_enemy_hp_override: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkItemDefinition {
    pub item_id: String,
    pub label: String,
    #[serde(default)]
    pub on_hit_formula_id: Option<String>,
    #[serde(default)]
    pub on_hit_damage_type: Option<DamageType>,
    #[serde(default)]
    pub on_hit_flags: BenchmarkDamageFlags,
    #[serde(default)]
    pub dot_formula_id: Option<String>,
    #[serde(default)]
    pub dot_ticks: Option<u32>,
    #[serde(default)]
    pub dot_interval_ms: Option<u32>,
    #[serde(default)]
    pub retaliate_formula_id: Option<String>,
    #[serde(default)]
    pub retaliate_damage_type: Option<DamageType>,
    #[serde(default)]
    pub black_cleaver_armor_ratio_per_stack: Option<f64>,
    #[serde(default)]
    pub black_cleaver_max_stacks: Option<u32>,
    #[serde(default)]
    pub black_cleaver_expire_after_ms: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkFormulaDefinition {
    pub formula_id: String,
    pub label: String,
    pub expr: BenchmarkFormulaExpr,
    #[serde(default)]
    pub bypass_value: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum BenchmarkFormulaExpr {
    Constant { value: f64 },
    ActorAttr {
        actor: BenchmarkFormulaActorRef,
        attr_key: String,
    },
    ActorHpCurrent { actor: BenchmarkFormulaActorRef },
    ActorHpMax { actor: BenchmarkFormulaActorRef },
    DamageTakenInWindow {
        actor: BenchmarkFormulaActorRef,
        window_ms: u32,
    },
    Add { terms: Vec<BenchmarkFormulaExpr> },
    Multiply { factors: Vec<BenchmarkFormulaExpr> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BenchmarkFormulaActorRef {
    Source,
    Target,
    SelfActor,
    Enemy,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttributeDefinition {
    pub attr_key: String,
    #[serde(default)]
    pub default_value: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hero {
    pub hero_id: String,
    pub name: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub base_stats: HashMap<String, f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub item_id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub stats_modifier: HashMap<String, f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub skill_id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub params: SkillParams,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillParams {
    #[serde(default)]
    pub damage_type: Option<String>,
    #[serde(default)]
    pub attack_ratio: Option<f64>,
    #[serde(default)]
    pub default_repeat_count: Option<u32>,
    #[serde(default)]
    pub hit_count: Option<u32>,
    #[serde(default)]
    pub hit_interval_ms: Option<u32>,
    #[serde(default)]
    pub channel_duration_ms: Option<u32>,
    #[serde(default)]
    pub base_damage_by_skill_level: Vec<f64>,
    #[serde(default)]
    pub base_damage: Option<f64>,
    #[serde(default)]
    pub ad_ratio: Option<f64>,
    #[serde(default)]
    pub ap_ratio: Option<f64>,
    #[serde(default)]
    pub bonus_attack_speed_ratio: Option<f64>,
    #[serde(default)]
    pub default_skill_level: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineRunInput {
    #[serde(default)]
    pub seed: Option<u64>,
    pub stop: StopCondition,
    pub initial: InitialCombatants,
    #[serde(default)]
    pub overrides: Option<CombatantOverrides>,
    pub plan: EngineActionPlan,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopCondition {
    pub max_seconds: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialCombatants {
    #[serde(rename = "self")]
    pub self_actor: CombatantInit,
    pub enemy: CombatantInit,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatantInit {
    pub hero_id: String,
    #[serde(default)]
    pub level: Option<u32>,
    #[serde(default)]
    pub item_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatantOverride {
    #[serde(default)]
    pub base_stats: HashMap<String, f64>,
    #[serde(default)]
    pub add_item_ids: Vec<String>,
    #[serde(default)]
    pub remove_item_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatantOverrides {
    #[serde(default, rename = "self")]
    pub self_actor: Option<CombatantOverride>,
    #[serde(default)]
    pub enemy: Option<CombatantOverride>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineActionPlan {
    BasicAttack {
        count: u32,
        #[serde(default)]
        skill_id: Option<String>,
    },
    CastSkill {
        skill_id: String,
        #[serde(default)]
        skill_level: Option<u32>,
        #[serde(default)]
        cast_count: Option<u32>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineRunOutput {
    pub result: EngineRunResult,
    pub samples: Vec<EngineSamplePoint>,
    pub events: Vec<EngineDamageEvent>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineSamplePoint {
    pub t_ms: u32,
    pub self_hp: f64,
    pub enemy_hp: f64,
    pub cumulative_damage_to_enemy: f64,
    pub cumulative_damage_to_self: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DamageSourceKind {
    BasicAttack,
    Skill,
    Item,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DamageType {
    Physical,
    Magic,
    True,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineDamageComponent {
    pub source_kind: DamageSourceKind,
    pub source_id: String,
    pub label: String,
    pub damage_type: DamageType,
    pub raw_damage: f64,
    pub dealt_damage: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineDamageEvent {
    pub sequence: u32,
    pub t_ms: u32,
    pub label: String,
    pub enemy_hp_before: f64,
    pub enemy_hp_after: f64,
    pub total_raw_damage: f64,
    pub total_dealt_damage: f64,
    pub components: Vec<EngineDamageComponent>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineRunResult {
    pub stop_reason: StopReason,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_to_kill_enemy_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_to_die_ms: Option<u32>,
    pub total_damage_to_enemy: f64,
    pub total_damage_to_self: f64,
    pub executed_hits: u32,
    pub action_duration_ms: u32,
    pub action_label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sample: Option<EngineSamplePoint>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineError {
    pub code: ErrorCode,
    pub message: String,
}

impl EngineError {
    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self { code: ErrorCode::InvalidInput, message: message.into() }
    }

    pub fn semantic(message: impl Into<String>) -> Self {
        Self { code: ErrorCode::SemanticError, message: message.into() }
    }

    pub fn runtime(message: impl Into<String>) -> Self {
        Self { code: ErrorCode::RuntimeError, message: message.into() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidInput,
    SemanticError,
    RuntimeError,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StopReason {
    EnemyDead,
    SelfDead,
    MaxSeconds,
    Cancelled,
    Error,
    Completed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostSuccess<T> {
    pub ok: bool,
    pub value: T,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostErrorResponse {
    pub ok: bool,
    pub error: EngineError,
}
