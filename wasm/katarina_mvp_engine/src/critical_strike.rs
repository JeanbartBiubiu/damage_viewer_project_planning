//! Critical strike determination and multiplier resolution.
//!
//! Uses a deterministic counter (truncation mode) per actor,
//! shared across all crit-eligible damage components.
//! Crit multiplier is computed via formula lookup keyed by `crit_type`.

use crate::model::EngineError;
use crate::runtime::RuntimeState;
use crate::types::{ActorId, CompiledCritRule, DamageFlags, ATTR_CRIT_CHANCE, ATTR_CRIT_MULTIPLIER};

/// Result of a crit determination for a single damage component.
#[derive(Debug, Clone, Copy)]
pub struct CritResult {
    pub is_critical: bool,
    /// Multiplier to apply to raw_damage. 1.0 if not critical.
    pub multiplier: f64,
}

const NOT_CRIT: CritResult = CritResult {
    is_critical: false,
    multiplier: 1.0,
};

/// Resolve crit for one damage component.
///
/// # Short-circuit rules
/// - `flags.crit_type` is `None` → skip (no counter advancement)
/// - No matching enabled `CritRule` → skip
/// - `crit_chance` ≤ 0 → skip
/// - `crit_chance` ≥ 1 → always crit (no counter advancement)
///
/// # Counter logic (deterministic truncation)
/// ```text
/// threshold = ceil(1.0 / crit_chance) as u32
/// counter += 1
/// if counter >= threshold → crit, reset counter to 0
/// ```
///
/// # Multiplier
/// Evaluated from the matching rule's `multiplier_formula`.
/// Falls back to `actor.attr("crit_multiplier")`, then to 1.75.
pub fn resolve_crit(
    state: &mut RuntimeState,
    source_actor: ActorId,
    target_actor: ActorId,
    flags: &DamageFlags,
) -> Result<CritResult, EngineError> {
    // 1. Check crit_type eligibility
    let crit_type = match flags.crit_type.as_deref() {
        Some(ct) => ct,
        None => return Ok(NOT_CRIT),
    };

    // 2. Find matching enabled rule
    let rule = match find_crit_rule(&state.benchmark.crit_rules, crit_type) {
        Some(r) => r.clone(),
        None => return Ok(NOT_CRIT),
    };

    // 3. Read crit_chance
    let crit_chance = state.actor(source_actor).attr(ATTR_CRIT_CHANCE);
    if crit_chance <= 0.0 {
        return Ok(NOT_CRIT);
    }

    // 4. Determine if critical
    let is_critical = if crit_chance >= 1.0 {
        // Always crit — do not advance counter
        true
    } else {
        let threshold = (1.0_f64 / crit_chance).ceil() as u32;
        let counter = &mut state.actor_mut(source_actor).crit_counter;
        *counter += 1;
        if *counter >= threshold {
            *counter = 0;
            true
        } else {
            false
        }
    };

    if !is_critical {
        return Ok(NOT_CRIT);
    }

    // 5. Compute multiplier via formula
    let multiplier = eval_crit_multiplier(state, source_actor, target_actor, &rule)?;

    Ok(CritResult {
        is_critical: true,
        multiplier,
    })
}

/// Find the first enabled crit rule matching the given crit_type.
fn find_crit_rule<'a>(
    rules: &'a [CompiledCritRule],
    crit_type: &str,
) -> Option<&'a CompiledCritRule> {
    rules
        .iter()
        .find(|r| r.enabled && r.crit_type == crit_type)
}

/// Evaluate the crit multiplier formula.
///
/// The formula is evaluated with `source_actor` as the formula's "source"
/// and `target_actor` as "target". If evaluation fails, falls back to
/// `actor.attr("crit_multiplier")`, then to 1.75.
fn eval_crit_multiplier(
    state: &RuntimeState,
    source_actor: ActorId,
    target_actor: ActorId,
    rule: &CompiledCritRule,
) -> Result<f64, EngineError> {
    let view = crate::runtime::RuntimeFormulaView {
        state,
        source_actor,
        target_actor,
    };
    let use_bypass = matches!(state.profile, crate::model::TestProfile::FormulaBypass);

    match rule.multiplier_formula.evaluate(&view, None, use_bypass) {
        Ok(value) if value > 0.0 => Ok(value),
        Ok(_) => {
            // Non-positive multiplier from formula — fallback
            let fallback = state.actor(source_actor).attr(ATTR_CRIT_MULTIPLIER);
            Ok(if fallback > 0.0 { fallback } else { 1.75 })
        }
        Err(_) => {
            // Formula evaluation failed — fallback
            let fallback = state.actor(source_actor).attr(ATTR_CRIT_MULTIPLIER);
            Ok(if fallback > 0.0 { fallback } else { 1.75 })
        }
    }
}

// ===== Unit Tests =====

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formula::CompiledFormulaCatalog;
    use crate::model::{BenchmarkFormulaDefinition, BenchmarkFormulaExpr, BenchmarkFormulaActorRef};
    use crate::types::{
        ActorId, ActorTemplate, BenchmarkRuntimeCatalog, BenchmarkRulesRuntime,
        CompiledCritRule, DamageFlags, SimulationConfig,
    };
    use std::collections::HashMap;

    /// Helper: create a minimal SimulationConfig with given crit properties.
    fn crit_test_config(
        crit_chance: f64,
        crit_multiplier: f64,
        crit_rules: Vec<CompiledCritRule>,
    ) -> SimulationConfig {
        let mut attrs = HashMap::new();
        attrs.insert("hp".to_string(), 1000.0);
        attrs.insert(ATTR_CRIT_CHANCE.to_string(), crit_chance);
        attrs.insert(ATTR_CRIT_MULTIPLIER.to_string(), crit_multiplier);

        let actor_template = ActorTemplate {
            actor_id: ActorId::SelfActor,
            label: "test".to_string(),
            attrs: attrs.clone(),
            requires_damage_taken_window: false,
            owned_items: vec![],
            priorities: vec![],
            actions: HashMap::new(),
        };
        let enemy_template = ActorTemplate {
            actor_id: ActorId::Enemy,
            label: "enemy".to_string(),
            attrs: {
                let mut a = HashMap::new();
                a.insert("hp".to_string(), 1000.0);
                a
            },
            requires_damage_taken_window: false,
            owned_items: vec![],
            priorities: vec![],
            actions: HashMap::new(),
        };

        SimulationConfig {
            profile: crate::model::TestProfile::Full,
            max_duration_ms: 10_000,
            max_events: 128,
            self_actor: actor_template,
            enemy_actor: enemy_template,
            benchmark: BenchmarkRuntimeCatalog {
                skill_defs: HashMap::new(),
                item_defs: HashMap::new(),
                formulas: CompiledFormulaCatalog::compile(&[]).unwrap(),
                rules: BenchmarkRulesRuntime::default(),
                pipeline_formulas: HashMap::new(),
                conversion_rules: vec![],
                hp_attr_key: "hp".to_string(),
                crit_rules,
            },
        }
    }

    /// Helper: basic crit rule using a formula that reads source.crit_multiplier.
    fn basic_crit_rule(crit_type: &str) -> CompiledCritRule {
        let formula_def = BenchmarkFormulaDefinition {
            formula_id: "crit_mult".to_string(),
            label: "crit multiplier".to_string(),
            expr: BenchmarkFormulaExpr::ActorAttr {
                actor: BenchmarkFormulaActorRef::Source,
                attr_key: ATTR_CRIT_MULTIPLIER.to_string(),
            },
            bypass_value: Some(1.75),
        };
        let catalog = CompiledFormulaCatalog::compile(&[formula_def]).unwrap();
        CompiledCritRule {
            rule_id: "test_rule".to_string(),
            crit_type: crit_type.to_string(),
            multiplier_formula: catalog.get("crit_mult").unwrap().clone(),
            enabled: true,
        }
    }

    fn crit_flags(crit_type: &str) -> DamageFlags {
        DamageFlags {
            can_trigger_on_hit: false,
            can_life_steal: false,
            can_apply_black_cleaver: false,
            counts_as_attack: false,
            is_active_skill_magic_damage: false,
            crit_type: Some(crit_type.to_string()),
        }
    }

    fn no_crit_flags() -> DamageFlags {
        DamageFlags::none()
    }

    // ── Tests ──

    #[test]
    fn crit_100_always_crits() {
        let config = crit_test_config(1.0, 1.75, vec![basic_crit_rule("basic_attack")]);
        let mut state = crate::runtime::build_runtime(config).unwrap();
        let flags = crit_flags("basic_attack");

        for _ in 0..5 {
            let result = resolve_crit(&mut state, ActorId::SelfActor, ActorId::Enemy, &flags).unwrap();
            assert!(result.is_critical, "should always crit at 100%");
            assert!((result.multiplier - 1.75).abs() < 0.001);
        }
        // Counter should not have advanced (100% bypasses counter)
        assert_eq!(state.self_actor.crit_counter, 0);
    }

    #[test]
    fn crit_0_never_crits() {
        let config = crit_test_config(0.0, 1.75, vec![basic_crit_rule("basic_attack")]);
        let mut state = crate::runtime::build_runtime(config).unwrap();
        let flags = crit_flags("basic_attack");

        for _ in 0..5 {
            let result = resolve_crit(&mut state, ActorId::SelfActor, ActorId::Enemy, &flags).unwrap();
            assert!(!result.is_critical, "should never crit at 0%");
            assert!((result.multiplier - 1.0).abs() < 0.001);
        }
    }

    #[test]
    fn crit_50_alternates() {
        let config = crit_test_config(0.5, 1.75, vec![basic_crit_rule("basic_attack")]);
        let mut state = crate::runtime::build_runtime(config).unwrap();
        let flags = crit_flags("basic_attack");

        // 50% → threshold=2 → pattern: ✗✓✗✓✗✓
        let expected = [false, true, false, true, false, true];
        for (i, &expect_crit) in expected.iter().enumerate() {
            let result = resolve_crit(&mut state, ActorId::SelfActor, ActorId::Enemy, &flags).unwrap();
            assert_eq!(
                result.is_critical, expect_crit,
                "hit #{}: expected crit={expect_crit}",
                i + 1
            );
        }
    }

    #[test]
    fn crit_25_every_fourth() {
        let config = crit_test_config(0.25, 1.75, vec![basic_crit_rule("basic_attack")]);
        let mut state = crate::runtime::build_runtime(config).unwrap();
        let flags = crit_flags("basic_attack");

        // 25% → threshold=4 → pattern: ✗✗✗✓
        let expected = [false, false, false, true, false, false, false, true];
        for (i, &expect_crit) in expected.iter().enumerate() {
            let result = resolve_crit(&mut state, ActorId::SelfActor, ActorId::Enemy, &flags).unwrap();
            assert_eq!(
                result.is_critical, expect_crit,
                "hit #{}: expected crit={expect_crit}",
                i + 1
            );
        }
    }

    #[test]
    fn no_crit_type_skips_entirely() {
        let config = crit_test_config(1.0, 1.75, vec![basic_crit_rule("basic_attack")]);
        let mut state = crate::runtime::build_runtime(config).unwrap();
        let flags = no_crit_flags();

        let result = resolve_crit(&mut state, ActorId::SelfActor, ActorId::Enemy, &flags).unwrap();
        assert!(!result.is_critical);
        assert_eq!(state.self_actor.crit_counter, 0, "counter should not advance");
    }

    #[test]
    fn no_matching_rule_skips() {
        // Rule is for "basic_attack" but flags say "skill"
        let config = crit_test_config(1.0, 1.75, vec![basic_crit_rule("basic_attack")]);
        let mut state = crate::runtime::build_runtime(config).unwrap();
        let flags = crit_flags("skill");

        let result = resolve_crit(&mut state, ActorId::SelfActor, ActorId::Enemy, &flags).unwrap();
        assert!(!result.is_critical);
    }

    #[test]
    fn disabled_rule_skips() {
        let mut rule = basic_crit_rule("basic_attack");
        rule.enabled = false;
        let config = crit_test_config(1.0, 1.75, vec![rule]);
        let mut state = crate::runtime::build_runtime(config).unwrap();
        let flags = crit_flags("basic_attack");

        let result = resolve_crit(&mut state, ActorId::SelfActor, ActorId::Enemy, &flags).unwrap();
        assert!(!result.is_critical);
    }

    #[test]
    fn formula_driven_multiplier() {
        let formula_def = BenchmarkFormulaDefinition {
            formula_id: "custom_mult".to_string(),
            label: "custom crit".to_string(),
            expr: BenchmarkFormulaExpr::Constant { value: 2.5 },
            bypass_value: None,
        };
        let catalog = CompiledFormulaCatalog::compile(&[formula_def]).unwrap();
        let rule = CompiledCritRule {
            rule_id: "custom".to_string(),
            crit_type: "basic_attack".to_string(),
            multiplier_formula: catalog.get("custom_mult").unwrap().clone(),
            enabled: true,
        };

        let config = crit_test_config(1.0, 1.75, vec![rule]);
        let mut state = crate::runtime::build_runtime(config).unwrap();
        let flags = crit_flags("basic_attack");

        let result = resolve_crit(&mut state, ActorId::SelfActor, ActorId::Enemy, &flags).unwrap();
        assert!(result.is_critical);
        assert!((result.multiplier - 2.5).abs() < 0.001, "should use formula value 2.5");
    }

    #[test]
    fn non_crit_components_dont_advance_counter() {
        let config = crit_test_config(0.5, 1.75, vec![basic_crit_rule("basic_attack")]);
        let mut state = crate::runtime::build_runtime(config).unwrap();

        // Fire 3 non-crit components (no crit_type)
        let no_crit = no_crit_flags();
        for _ in 0..3 {
            resolve_crit(&mut state, ActorId::SelfActor, ActorId::Enemy, &no_crit).unwrap();
        }
        assert_eq!(state.self_actor.crit_counter, 0, "counter must not have advanced");

        // Now fire crit-eligible: should start fresh
        let crit = crit_flags("basic_attack");
        let r1 = resolve_crit(&mut state, ActorId::SelfActor, ActorId::Enemy, &crit).unwrap();
        assert!(!r1.is_critical, "first hit at 50% should not crit");
        let r2 = resolve_crit(&mut state, ActorId::SelfActor, ActorId::Enemy, &crit).unwrap();
        assert!(r2.is_critical, "second hit at 50% should crit");
    }

    #[test]
    fn multiple_crit_types_share_counter() {
        // Two rules: one for "basic_attack", one for "skill"
        let rules = vec![
            basic_crit_rule("basic_attack"),
            {
                let mut r = basic_crit_rule("skill");
                r.rule_id = "skill_rule".to_string();
                r.crit_type = "skill".to_string();
                r
            },
        ];
        let config = crit_test_config(0.5, 1.75, rules);
        let mut state = crate::runtime::build_runtime(config).unwrap();

        // 50% → threshold=2. Counter is shared.
        let ba_flags = crit_flags("basic_attack");
        let skill_flags = crit_flags("skill");

        // hit 1 (basic_attack): counter 0→1, not crit
        let r1 = resolve_crit(&mut state, ActorId::SelfActor, ActorId::Enemy, &ba_flags).unwrap();
        assert!(!r1.is_critical);

        // hit 2 (skill): counter 1→2 → crit, reset to 0
        let r2 = resolve_crit(&mut state, ActorId::SelfActor, ActorId::Enemy, &skill_flags).unwrap();
        assert!(r2.is_critical);

        // hit 3 (basic_attack): counter 0→1, not crit
        let r3 = resolve_crit(&mut state, ActorId::SelfActor, ActorId::Enemy, &ba_flags).unwrap();
        assert!(!r3.is_critical);
    }
}
