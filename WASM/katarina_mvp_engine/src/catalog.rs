#![allow(dead_code)]

use crate::benchmark_fixture::{
    total_attack_speed_from_attrs, ATTR_ATTACK_SPEED_BASE, ATTR_ATTACK_SPEED_BONUS, ATTR_ATTACK_SPEED_RATIO,
};
use crate::formula::CompiledFormulaCatalog;
use crate::model::{
    BenchmarkBundle, BenchmarkCountToThreeRule, BenchmarkCooldownDefinition,
    BenchmarkItemDefinition, BenchmarkRules, BenchmarkSkillDefinition, DamageType, EngineConfig, EngineError,
    ErrorCode, GameDataBundle, TestProfile,
};
use crate::runtime::{
    ActionRuntime, ActorId, ActorTemplate, BenchmarkBlackCleaverRuntime, BenchmarkCountToThreeRuntime,
    BenchmarkItemRuntimeDef, BenchmarkRulesRuntime, BenchmarkRuntimeCatalog, BenchmarkSchedulerRuntime,
    BenchmarkSkillMechanics, BenchmarkSkillRuntimeDef, CooldownSpec, DamageFlags, SimulationConfig,
};
use std::collections::{HashMap, HashSet};

pub type CompiledActor = ActorTemplate;
pub type CompiledSkill = BenchmarkSkillRuntimeDef;
pub type CompiledItem = BenchmarkItemRuntimeDef;

#[derive(Debug, Clone)]
pub struct CompiledActorInitSnapshot {
    pub hero_id: String,
    pub label: String,
    pub hp_initial: f64,
    pub attack_speed_base: f64,
    pub attack_speed_bonus: f64,
    pub attack_speed_ratio: f64,
    pub total_attack_speed: f64,
    pub equipped_item_ids: Vec<String>,
}

impl CompiledActorInitSnapshot {
    pub fn attack_speed_triplet(&self) -> (f64, f64, f64) {
        (
            self.attack_speed_base,
            self.attack_speed_bonus,
            self.attack_speed_ratio,
        )
    }
}

#[derive(Debug, Clone)]
pub struct CompiledCatalog {
    pub profile: TestProfile,
    pub requested_profile: TestProfile,
    pub hp_attr_key: String,
    pub self_hero_id: String,
    pub enemy_hero_id: String,
    pub self_actor: CompiledActor,
    pub enemy_actor: CompiledActor,
    pub self_init: CompiledActorInitSnapshot,
    pub enemy_init: CompiledActorInitSnapshot,
    pub benchmark: BenchmarkRuntimeCatalog,
}

impl CompiledCatalog {
    pub fn to_simulation_config(&self, max_duration_ms: u32, max_events: usize) -> SimulationConfig {
        SimulationConfig {
            profile: self.profile,
            max_duration_ms,
            max_events,
            self_actor: self.self_actor.clone(),
            enemy_actor: self.enemy_actor.clone(),
            benchmark: self.benchmark.clone(),
        }
    }
}

pub fn compile_benchmark_catalog(
    bundle: &GameDataBundle,
    config: &EngineConfig,
) -> Result<CompiledCatalog, EngineError> {
    let benchmark = bundle
        .benchmark
        .as_ref()
        .ok_or_else(|| semantic_error("bundle.benchmark is required for benchmark profile"))?;
    validate_hp_attr_key(config, benchmark)?;

    let benchmark_runtime = compile_runtime_catalog(benchmark)?;
    let self_actor = compile_actor_template(&benchmark.self_actor, ActorId::SelfActor)?;
    let enemy_actor = compile_actor_template(&benchmark.enemy_actor, ActorId::Enemy)?;
    let self_init = build_actor_init_snapshot(&benchmark.self_actor.hero_id, &self_actor, config);
    let enemy_init = build_actor_init_snapshot(&benchmark.enemy_actor.hero_id, &enemy_actor, config);
    let requested_profile = config.resolved_test_profile();

    Ok(CompiledCatalog {
        profile: requested_profile,
        requested_profile,
        hp_attr_key: benchmark.hp_attr_key.clone(),
        self_hero_id: benchmark.self_actor.hero_id.clone(),
        enemy_hero_id: benchmark.enemy_actor.hero_id.clone(),
        self_actor,
        enemy_actor,
        self_init,
        enemy_init,
        benchmark: benchmark_runtime,
    })
}

fn compile_runtime_catalog(benchmark: &BenchmarkBundle) -> Result<BenchmarkRuntimeCatalog, EngineError> {
    let formulas = CompiledFormulaCatalog::compile(&benchmark.formulas)?;

    let mut skill_defs = HashMap::with_capacity(benchmark.skill_defs.len());
    for skill in &benchmark.skill_defs {
        if skill_defs.contains_key(&skill.skill_id) {
            return Err(semantic_error(format!(
                "duplicate benchmark skill id '{}'",
                skill.skill_id
            )));
        }
        validate_skill_formula_refs(skill, &formulas)?;
        skill_defs.insert(
            skill.skill_id.clone(),
            BenchmarkSkillRuntimeDef {
                skill_id: skill.skill_id.clone(),
                label: skill.label.clone(),
                type_ids: skill.type_ids.clone(),
                damage_type: skill.damage_type,
                flags: map_flags(&skill.flags),
                attach_on_hit_item_ids: skill.attach_on_hit_item_ids.clone(),
                mechanics: BenchmarkSkillMechanics {
                    damage_formula_id: skill
                        .primary_formula_id
                        .clone()
                        .or_else(|| skill.shield_formula_id.clone()),
                    on_hit_cooldown_reduction_ms: skill.cooldown_reduction_on_hit_ms,
                    stun_duration_ms: skill.stun_duration_ms,
                    dot: None,
                    triggers_item_dot: skill.dot_formula_id.is_some(),
                },
                final_kill_enemy_hp_override: skill.final_kill_enemy_hp_override,
            },
        );
    }

    let mut item_defs = HashMap::with_capacity(benchmark.item_defs.len());
    for item in &benchmark.item_defs {
        if item_defs.contains_key(&item.item_id) {
            return Err(semantic_error(format!(
                "duplicate benchmark item id '{}'",
                item.item_id
            )));
        }
        validate_item_formula_refs(item, &formulas)?;
        item_defs.insert(
            item.item_id.clone(),
            BenchmarkItemRuntimeDef {
                item_id: item.item_id.clone(),
                label: item.label.clone(),
                on_hit_damage_formula_id: item.on_hit_formula_id.clone(),
                on_hit_damage_type: item.on_hit_damage_type,
                on_hit_flags: map_flags(&item.on_hit_flags),
                dot: compile_item_dot_runtime(item)?,
                thornmail_retaliate_formula_id: item.retaliate_formula_id.clone(),
                thornmail_retaliate_damage_type: item.retaliate_damage_type,
                black_cleaver: match (
                    item.black_cleaver_expire_after_ms,
                    item.black_cleaver_armor_ratio_per_stack,
                    item.black_cleaver_max_stacks,
                ) {
                    (Some(expire_after_ms), Some(armor_reduce_per_stack_ratio), Some(max_stacks)) => {
                        Some(BenchmarkBlackCleaverRuntime {
                            expire_after_ms,
                            armor_reduce_per_stack_ratio,
                            max_stacks,
                        })
                    }
                    _ => None,
                },
            },
        );
    }

    let rules = compile_rules_runtime(&benchmark.rules, &formulas, &skill_defs)?;
    Ok(BenchmarkRuntimeCatalog {
        skill_defs,
        item_defs,
        formulas,
        rules,
    })
}

fn compile_item_dot_runtime(
    item: &BenchmarkItemDefinition,
) -> Result<Option<crate::runtime::BenchmarkDotRuntime>, EngineError> {
    let Some(formula_id) = item.dot_formula_id.as_ref() else {
        return Ok(None);
    };
    let ticks = item.dot_ticks.ok_or_else(|| {
        semantic_error(format!(
            "item '{}' dot config requires dotTicks when dotFormulaId is present",
            item.item_id
        ))
    })?;
    let interval_ms = item.dot_interval_ms.ok_or_else(|| {
        semantic_error(format!(
            "item '{}' dot config requires dotIntervalMs when dotFormulaId is present",
            item.item_id
        ))
    })?;

    Ok(Some(crate::runtime::BenchmarkDotRuntime {
        source_id: item.item_id.clone(),
        label: format!("{} DoT", item.label),
        formula_id: formula_id.clone(),
        ticks,
        interval_ms,
        damage_type: DamageType::Magic,
    }))
}

fn compile_rules_runtime(
    rules: &BenchmarkRules,
    formulas: &CompiledFormulaCatalog,
    skill_defs: &HashMap<String, BenchmarkSkillRuntimeDef>,
) -> Result<BenchmarkRulesRuntime, EngineError> {
    Ok(BenchmarkRulesRuntime {
        scheduler: BenchmarkSchedulerRuntime {
            decide_priority: rules.scheduler.decide_priority,
            dot_tick_priority: rules.scheduler.dot_tick_priority,
            stun_expire_priority: rules.scheduler.stun_expire_priority,
            black_cleaver_expire_priority: rules.scheduler.black_cleaver_expire_priority,
        },
        count_to_three: compile_count_to_three_runtime(rules.count_to_three.as_ref(), formulas, skill_defs)?,
    })
}

fn compile_count_to_three_runtime(
    rule: Option<&BenchmarkCountToThreeRule>,
    formulas: &CompiledFormulaCatalog,
    skill_defs: &HashMap<String, BenchmarkSkillRuntimeDef>,
) -> Result<Option<BenchmarkCountToThreeRuntime>, EngineError> {
    let Some(rule) = rule else {
        return Ok(None);
    };

    if rule.proc_every_hits == 0 {
        return Err(semantic_error(
            "benchmark count_to_three.proc_every_hits must be greater than 0",
        ));
    }
    if !skill_defs.contains_key(&rule.source_skill_id) {
        return Err(semantic_error(format!(
            "count_to_three references unknown skill '{}'",
            rule.source_skill_id
        )));
    }
    if !formulas.contains(&rule.true_damage_formula_id) {
        return Err(semantic_error(format!(
            "count_to_three references unknown formula '{}'",
            rule.true_damage_formula_id
        )));
    }

    Ok(Some(BenchmarkCountToThreeRuntime {
        source_skill_id: rule.source_skill_id.clone(),
        label: rule.label.clone(),
        proc_every_hits: rule.proc_every_hits,
        true_damage_formula_id: rule.true_damage_formula_id.clone(),
    }))
}

fn compile_actor_template(
    actor: &crate::model::BenchmarkActorDefinition,
    actor_id: ActorId,
) -> Result<ActorTemplate, EngineError> {
    let mut actions = HashMap::with_capacity(actor.actions.len());
    for action in &actor.actions {
        if actions.contains_key(&action.action_id) {
            return Err(semantic_error(format!(
                "duplicate benchmark action id '{}' for actor '{}'",
                action.action_id, actor.hero_id
            )));
        }
        actions.insert(
            action.action_id.clone(),
            ActionRuntime {
                action_id: action.action_id.clone(),
                label: action.label.clone(),
                priority: action.priority,
                behavior: action.behavior,
                cooldown: map_cooldown(&action.cooldown),
                mana_cost: action.mana_cost,
            },
        );
    }

    let priorities = if actor.priorities.is_empty() {
        let mut ordered_actions = actions
            .values()
            .map(|action| (action.priority, action.action_id.clone()))
            .collect::<Vec<_>>();
        ordered_actions.sort_by(|left, right| {
            left.0
                .cmp(&right.0)
                .then_with(|| left.1.cmp(&right.1))
        });
        ordered_actions
            .into_iter()
            .map(|(_, action_id)| action_id)
            .collect::<Vec<_>>()
    } else {
        let mut priorities = Vec::with_capacity(actor.priorities.len());
        let mut seen = HashSet::with_capacity(actor.priorities.len());
        for action_id in &actor.priorities {
            if !actions.contains_key(action_id) {
                return Err(semantic_error(format!(
                    "actor '{}' priority references unknown action '{}'",
                    actor.hero_id, action_id
                )));
            }
            if seen.insert(action_id.clone()) {
                priorities.push(action_id.clone());
            }
        }
        priorities
    };

    Ok(ActorTemplate {
        actor_id,
        label: actor.label.clone(),
        attrs: actor.attrs.clone(),
        owned_items: actor.owned_item_ids.clone(),
        priorities,
        actions,
    })
}

fn build_actor_init_snapshot(
    hero_id: &str,
    actor: &ActorTemplate,
    config: &EngineConfig,
) -> CompiledActorInitSnapshot {
    let hp_attr_key = config.resolved_hp_attr_key();
    CompiledActorInitSnapshot {
        hero_id: hero_id.to_string(),
        label: actor.label.clone(),
        hp_initial: actor.attrs.get(hp_attr_key).copied().unwrap_or(0.0),
        attack_speed_base: actor.attrs.get(ATTR_ATTACK_SPEED_BASE).copied().unwrap_or(0.0),
        attack_speed_bonus: actor.attrs.get(ATTR_ATTACK_SPEED_BONUS).copied().unwrap_or(0.0),
        attack_speed_ratio: actor.attrs.get(ATTR_ATTACK_SPEED_RATIO).copied().unwrap_or(0.0),
        total_attack_speed: total_attack_speed_from_attrs(&actor.attrs),
        equipped_item_ids: actor.owned_items.clone(),
    }
}

fn validate_hp_attr_key(config: &EngineConfig, benchmark: &BenchmarkBundle) -> Result<(), EngineError> {
    let hp_attr_key = config.resolved_hp_attr_key();
    if hp_attr_key != benchmark.hp_attr_key.as_str() {
        return Err(EngineError {
            code: ErrorCode::SemanticError,
            message: format!(
                "Benchmark bundle only supports hpAttrKey='{}', got '{}'",
                benchmark.hp_attr_key, hp_attr_key
            ),
        });
    }
    Ok(())
}

fn validate_skill_formula_refs(
    skill: &BenchmarkSkillDefinition,
    formulas: &CompiledFormulaCatalog,
) -> Result<(), EngineError> {
    for formula_id in [
        skill.primary_formula_id.as_deref(),
        skill.shield_formula_id.as_deref(),
        skill.dot_formula_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if !formulas.contains(formula_id) {
            return Err(semantic_error(format!(
                "skill '{}' references unknown formula '{}'",
                skill.skill_id, formula_id
            )));
        }
    }
    Ok(())
}

fn validate_item_formula_refs(
    item: &BenchmarkItemDefinition,
    formulas: &CompiledFormulaCatalog,
) -> Result<(), EngineError> {
    for formula_id in [
        item.on_hit_formula_id.as_deref(),
        item.dot_formula_id.as_deref(),
        item.retaliate_formula_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if !formulas.contains(formula_id) {
            return Err(semantic_error(format!(
                "item '{}' references unknown formula '{}'",
                item.item_id, formula_id
            )));
        }
    }
    Ok(())
}

fn map_cooldown(cooldown: &BenchmarkCooldownDefinition) -> CooldownSpec {
    match cooldown {
        BenchmarkCooldownDefinition::BasicAttackInterval => CooldownSpec::BasicAttackInterval,
        BenchmarkCooldownDefinition::AbilityHasteScaled { base_ms } => {
            CooldownSpec::AbilityHasteScaled { base_ms: *base_ms }
        }
        BenchmarkCooldownDefinition::FixedMs { ms } => CooldownSpec::FixedMs(*ms),
    }
}

fn map_flags(flags: &crate::model::BenchmarkDamageFlags) -> DamageFlags {
    DamageFlags {
        can_trigger_on_hit: flags.can_trigger_on_hit,
        can_life_steal: flags.can_life_steal,
        can_apply_black_cleaver: flags.can_apply_black_cleaver,
        counts_as_attack: flags.counts_as_attack,
        is_active_skill_magic_damage: flags.is_active_skill_magic_damage,
    }
}

fn semantic_error(message: impl Into<String>) -> EngineError {
    EngineError {
        code: ErrorCode::SemanticError,
        message: message.into(),
    }
}
