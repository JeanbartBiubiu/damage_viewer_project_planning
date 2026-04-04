use crate::formula::FormulaRuntimeView;
use crate::model::{ConversionMode, EngineError};
use crate::runtime::ActorRuntime;
use crate::types::CompiledConversionRule;

// ===== Minimal FormulaRuntimeView for a single actor =====

/// A single-actor formula view used during conversion evaluation.
/// All actor-role methods (source/target/self/enemy) resolve to the same actor,
/// because conversions operate on one actor at a time.
struct ConversionView<'a> {
    actor: &'a ActorRuntime,
}

impl FormulaRuntimeView for ConversionView<'_> {
    type ActorRef = ();

    fn source_actor(&self) -> () {}
    fn target_actor(&self) -> () {}
    fn self_actor(&self) -> () {}
    fn enemy_actor(&self) -> () {}

    fn actor_attr(&self, _: (), attr_key: &str) -> f64 {
        self.actor.attr(attr_key)
    }

    fn actor_hp_current(&self, _: ()) -> f64 {
        self.actor.hp_current
    }

    fn actor_hp_max(&self, _: ()) -> f64 {
        self.actor.hp_max
    }

    fn actor_damage_taken_in_window(&self, _: (), _window_ms: u32) -> f64 {
        0.0
    }
}

// ===== Core application function =====

/// Apply all conversion rules to a single actor in declaration order (one pass, no re-iteration).
///
/// After the pass, `hp_max` and `hp_current` are re-synced if the HP attribute was affected.
/// A negative formula result is clamped to zero (treated as no conversion).
pub fn apply_static_conversions(
    actor: &mut ActorRuntime,
    rules: &[CompiledConversionRule],
    hp_attr_key: &str,
    profile_uses_bypass: bool,
) -> Result<(), EngineError> {
    let mut hp_changed = false;

    for rule in rules {
        let source_value = actor.attr(&rule.source_attr);

        // Evaluate formula with InputValue = source attribute value.
        // Use a block to limit the lifetime of the immutable borrow of `actor`.
        let amount = {
            let view = ConversionView { actor };
            rule.formula.evaluate(&view, Some(source_value), profile_uses_bypass)?
        };

        if amount <= 0.0 {
            continue;
        }

        if rule.mode == ConversionMode::Convert {
            let new_source = (source_value - amount).max(0.0);
            actor.set_attr(&rule.source_attr, new_source);
            if rule.source_attr == hp_attr_key {
                hp_changed = true;
            }
        }

        let current_target = actor.attr(&rule.target_attr);
        actor.set_attr(&rule.target_attr, current_target + amount);
        if rule.target_attr == hp_attr_key {
            hp_changed = true;
        }
    }

    // Re-sync hp_max / hp_current if the HP attribute was modified.
    if hp_changed {
        let new_hp_max = actor.attr(hp_attr_key).max(0.0);
        actor.hp_max = new_hp_max;
        actor.hp_current = actor.hp_current.min(new_hp_max);
    }

    Ok(())
}

// ===== Tests =====

#[cfg(test)]
mod tests {
    use super::apply_static_conversions;
    use crate::formula::CompiledFormulaCatalog;
    use crate::model::{
        BenchmarkFormulaDefinition, BenchmarkFormulaExpr,
        ConversionMode, ConversionPhase,
    };
    use crate::runtime::ActorRuntime;
    use crate::types::{ActorId, ActorTemplate, CompiledConversionRule};
    use std::collections::HashMap;

    fn make_compiled_rule(
        source_attr: &str,
        target_attr: &str,
        amount_expr: BenchmarkFormulaExpr,
        mode: ConversionMode,
    ) -> CompiledConversionRule {
        let formula_id = format!("conv_{}_{}", source_attr, target_attr);
        let def = BenchmarkFormulaDefinition {
            formula_id: formula_id.clone(),
            label: formula_id.clone(),
            expr: amount_expr,
            bypass_value: None,
        };
        let catalog = CompiledFormulaCatalog::compile(&[def]).expect("should compile");
        CompiledConversionRule {
            source_attr: source_attr.to_string(),
            target_attr: target_attr.to_string(),
            formula: catalog.get(&formula_id).cloned().unwrap(),
            phase: ConversionPhase::AfterBase,
            mode,
        }
    }

    fn make_actor(attrs: HashMap<String, f64>) -> ActorRuntime {
        ActorRuntime::from_template(ActorTemplate {
            actor_id: ActorId::SelfActor,
            label: "test".to_string(),
            attrs,
            requires_damage_taken_window: false,
            owned_items: vec![],
            priorities: vec![],
            actions: HashMap::new(),
        })
    }

    #[test]
    fn grant_mode_adds_to_target_without_reducing_source() {
        let mut actor = make_actor(HashMap::from([
            ("hp".to_string(), 1000.0),
            ("ad".to_string(), 50.0),
        ]));
        let rule = make_compiled_rule(
            "hp",
            "ad",
            BenchmarkFormulaExpr::Constant { value: 30.0 },
            ConversionMode::Grant,
        );
        apply_static_conversions(&mut actor, &[rule], "hp", false).unwrap();
        assert_eq!(actor.attr("hp"), 1000.0, "source unchanged in Grant mode");
        assert_eq!(actor.attr("ad"), 80.0, "target increases by amount");
        assert_eq!(actor.hp_max, 1000.0, "hp_max unchanged when HP is source in Grant mode");
    }

    #[test]
    fn convert_mode_reduces_source_and_adds_to_target() {
        let mut actor = make_actor(HashMap::from([
            ("hp".to_string(), 1000.0),
            ("ad".to_string(), 50.0),
        ]));
        let rule = make_compiled_rule(
            "hp",
            "ad",
            BenchmarkFormulaExpr::Constant { value: 200.0 },
            ConversionMode::Convert,
        );
        apply_static_conversions(&mut actor, &[rule], "hp", false).unwrap();
        assert_eq!(actor.attr("hp"), 800.0, "source reduced");
        assert_eq!(actor.attr("ad"), 250.0, "target increased");
        assert_eq!(actor.hp_max, 800.0, "hp_max re-synced");
        assert_eq!(actor.hp_current, 800.0, "hp_current capped to new hp_max");
    }

    #[test]
    fn convert_mode_clamps_source_to_zero() {
        let mut actor = make_actor(HashMap::from([
            ("excess".to_string(), 100.0),
            ("ad".to_string(), 50.0),
        ]));
        let rule = make_compiled_rule(
            "excess",
            "ad",
            BenchmarkFormulaExpr::Constant { value: 999.0 },
            ConversionMode::Convert,
        );
        apply_static_conversions(&mut actor, &[rule], "hp", false).unwrap();
        assert_eq!(actor.attr("excess"), 0.0, "source clamped to 0");
        assert_eq!(actor.attr("ad"), 1049.0, "target increases by full formula amount");
    }

    #[test]
    fn zero_or_negative_amount_is_skipped() {
        let mut actor = make_actor(HashMap::from([
            ("hp".to_string(), 500.0),
            ("ad".to_string(), 40.0),
        ]));
        let rule = make_compiled_rule(
            "hp",
            "ad",
            BenchmarkFormulaExpr::Constant { value: 0.0 },
            ConversionMode::Convert,
        );
        apply_static_conversions(&mut actor, &[rule], "hp", false).unwrap();
        assert_eq!(actor.attr("hp"), 500.0, "no change when amount = 0");
        assert_eq!(actor.attr("ad"), 40.0, "no change when amount = 0");
    }

    /// Pyke-style: excess HP above 1000 converts to AD.
    /// Formula: max(0, InputValue - 1000)
    #[test]
    fn pyke_style_overflow_conversion() {
        let mut actor = make_actor(HashMap::from([
            ("hp".to_string(), 1500.0),
            ("ad".to_string(), 60.0),
        ]));
        let rule = make_compiled_rule(
            "hp",
            "ad",
            BenchmarkFormulaExpr::Max {
                operands: vec![
                    BenchmarkFormulaExpr::Constant { value: 0.0 },
                    BenchmarkFormulaExpr::Add {
                        terms: vec![
                            BenchmarkFormulaExpr::InputValue,
                            BenchmarkFormulaExpr::Negate {
                                operand: Box::new(BenchmarkFormulaExpr::Constant { value: 1000.0 }),
                            },
                        ],
                    },
                ],
            },
            ConversionMode::Convert,
        );
        apply_static_conversions(&mut actor, &[rule], "hp", false).unwrap();
        // excess = max(0, 1500 - 1000) = 500
        assert_eq!(actor.attr("hp"), 1000.0, "HP reduced to threshold");
        assert_eq!(actor.attr("ad"), 560.0, "AD gains excess 500");
        assert_eq!(actor.hp_max, 1000.0, "hp_max re-synced to 1000");
    }

    /// Multiple rules execute in declaration order, each sees updated attrs.
    #[test]
    fn multiple_rules_execute_in_order() {
        let mut actor = make_actor(HashMap::from([
            ("ap".to_string(), 200.0),
            ("ad".to_string(), 50.0),
            ("hp".to_string(), 600.0),
        ]));
        // Rule 1: grant 10% of AP as bonus AD
        let rule1 = make_compiled_rule(
            "ap",
            "ad",
            BenchmarkFormulaExpr::Multiply {
                factors: vec![
                    BenchmarkFormulaExpr::InputValue,
                    BenchmarkFormulaExpr::Constant { value: 0.1 },
                ],
            },
            ConversionMode::Grant,
        );
        // Rule 2: convert 50 HP into AD (fixed)
        let rule2 = make_compiled_rule(
            "hp",
            "ad",
            BenchmarkFormulaExpr::Constant { value: 50.0 },
            ConversionMode::Convert,
        );
        apply_static_conversions(&mut actor, &[rule1, rule2], "hp", false).unwrap();
        assert_eq!(actor.attr("ap"), 200.0, "AP unchanged (grant mode)");
        // ad = 50 + 20 (10% of 200 AP) + 50 (from HP convert) = 120
        assert_eq!(actor.attr("ad"), 120.0, "AD = 50 + 20 + 50");
        assert_eq!(actor.attr("hp"), 550.0, "HP reduced by 50");
        assert_eq!(actor.hp_max, 550.0, "hp_max re-synced");
    }
}
