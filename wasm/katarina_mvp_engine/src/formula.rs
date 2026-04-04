use crate::model::{
    BenchmarkFormulaActorRef, BenchmarkFormulaDefinition, BenchmarkFormulaExpr, EngineError,
};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FormulaActorRef {
    Source,
    Target,
    SelfActor,
    Enemy,
}

#[derive(Debug, Clone)]
pub struct CompiledFormulaDefinition {
    pub expression: FormulaExpression,
    pub formula_bypass_value: Option<f64>,
}

impl CompiledFormulaDefinition {
    /// Evaluate this definition directly, injecting `input_value` for `InputValue` nodes.
    pub fn evaluate<V: FormulaRuntimeView>(
        &self,
        view: &V,
        input_value: Option<f64>,
        profile_uses_bypass: bool,
    ) -> Result<f64, EngineError> {
        if profile_uses_bypass {
            return Ok(self.formula_bypass_value.unwrap_or(0.0));
        }
        evaluate_expression(&self.expression, view, input_value)
    }
}

#[derive(Debug, Clone)]
pub enum FormulaExpression {
    Constant(f64),
    ActorAttr { actor: FormulaActorRef, attr_key: String },
    ActorHpCurrent { actor: FormulaActorRef },
    ActorHpMax { actor: FormulaActorRef },
    DamageTakenInWindow { actor: FormulaActorRef, window_ms: u32 },
    Add(Vec<FormulaExpression>),
    Multiply(Vec<FormulaExpression>),
    /// numerator / denominator; returns 0.0 when denominator is zero.
    Divide {
        numerator: Box<FormulaExpression>,
        denominator: Box<FormulaExpression>,
    },
    /// Arithmetic negation: -operand.
    Negate(Box<FormulaExpression>),
    /// Maximum over one or more operands; returns 0.0 for empty list.
    Max(Vec<FormulaExpression>),
    /// Minimum over one or more operands; returns 0.0 for empty list.
    Min(Vec<FormulaExpression>),
    /// Pipeline injection: the scalar value provided by the caller (e.g. raw_damage).
    InputValue,
}

#[derive(Debug, Clone, Default)]
pub struct CompiledFormulaCatalog {
    formulas: HashMap<String, CompiledFormulaDefinition>,
}

impl CompiledFormulaCatalog {
    pub fn compile(inputs: &[BenchmarkFormulaDefinition]) -> Result<Self, EngineError> {
        let mut formulas = HashMap::with_capacity(inputs.len());
        for input in inputs {
            if formulas.contains_key(&input.formula_id) {
                return Err(EngineError::semantic(format!(
                    "duplicate benchmark formula id '{}'",
                    input.formula_id
                )));
            }
            formulas.insert(
                input.formula_id.clone(),
                CompiledFormulaDefinition {
                    expression: compile_expression(&input.expr)?,
                    formula_bypass_value: input.bypass_value,
                },
            );
        }
        Ok(Self { formulas })
    }

    pub fn get(&self, formula_id: &str) -> Option<&CompiledFormulaDefinition> {
        self.formulas.get(formula_id)
    }

    pub fn contains(&self, formula_id: &str) -> bool {
        self.formulas.contains_key(formula_id)
    }

    pub fn evaluate<V: FormulaRuntimeView>(
        &self,
        formula_id: &str,
        view: &V,
        profile_uses_bypass: bool,
    ) -> Result<f64, EngineError> {
        self.evaluate_with_input(formula_id, view, None, profile_uses_bypass)
    }

    /// Evaluate a formula, injecting `input_value` for any `InputValue` nodes.
    /// Use this for pipeline formulas where the raw value (e.g. raw_damage) is the input.
    pub fn evaluate_with_input<V: FormulaRuntimeView>(
        &self,
        formula_id: &str,
        view: &V,
        input_value: Option<f64>,
        profile_uses_bypass: bool,
    ) -> Result<f64, EngineError> {
        let definition = self
            .get(formula_id)
            .ok_or_else(|| EngineError::semantic(format!("unknown benchmark formula id '{formula_id}'")))?;
        if profile_uses_bypass {
            return Ok(definition.formula_bypass_value.unwrap_or(0.0));
        }
        evaluate_expression(&definition.expression, view, input_value)
    }
}

pub trait FormulaRuntimeView {
    type ActorRef: Copy;

    fn source_actor(&self) -> Self::ActorRef;
    fn target_actor(&self) -> Self::ActorRef;
    fn self_actor(&self) -> Self::ActorRef;
    fn enemy_actor(&self) -> Self::ActorRef;
    fn actor_attr(&self, actor: Self::ActorRef, attr_key: &str) -> f64;
    fn actor_hp_current(&self, actor: Self::ActorRef) -> f64;
    fn actor_hp_max(&self, actor: Self::ActorRef) -> f64;
    fn actor_damage_taken_in_window(&self, actor: Self::ActorRef, window_ms: u32) -> f64;
}

fn compile_expression(input: &BenchmarkFormulaExpr) -> Result<FormulaExpression, EngineError> {
    Ok(match input {
        BenchmarkFormulaExpr::Constant { value } => FormulaExpression::Constant(*value),
        BenchmarkFormulaExpr::ActorAttr { actor, attr_key } => FormulaExpression::ActorAttr {
            actor: compile_actor_ref(*actor),
            attr_key: attr_key.clone(),
        },
        BenchmarkFormulaExpr::ActorHpCurrent { actor } => FormulaExpression::ActorHpCurrent {
            actor: compile_actor_ref(*actor),
        },
        BenchmarkFormulaExpr::ActorHpMax { actor } => FormulaExpression::ActorHpMax {
            actor: compile_actor_ref(*actor),
        },
        BenchmarkFormulaExpr::DamageTakenInWindow { actor, window_ms } => {
            FormulaExpression::DamageTakenInWindow {
                actor: compile_actor_ref(*actor),
                window_ms: *window_ms,
            }
        }
        BenchmarkFormulaExpr::Add { terms } => {
            if terms.is_empty() {
                return Err(EngineError::semantic("benchmark formula add requires at least one term"));
            }
            FormulaExpression::Add(
                terms
                    .iter()
                    .map(compile_expression)
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
        BenchmarkFormulaExpr::Multiply { factors } => {
            if factors.is_empty() {
                return Err(EngineError::semantic("benchmark formula multiply requires at least one factor"));
            }
            FormulaExpression::Multiply(
                factors
                    .iter()
                    .map(compile_expression)
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
        BenchmarkFormulaExpr::Divide { numerator, denominator } => FormulaExpression::Divide {
            numerator: Box::new(compile_expression(numerator)?),
            denominator: Box::new(compile_expression(denominator)?),
        },
        BenchmarkFormulaExpr::Negate { operand } => {
            FormulaExpression::Negate(Box::new(compile_expression(operand)?))
        }
        BenchmarkFormulaExpr::Max { operands } => {
            if operands.is_empty() {
                return Err(EngineError::semantic("benchmark formula max requires at least one operand"));
            }
            FormulaExpression::Max(
                operands
                    .iter()
                    .map(compile_expression)
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
        BenchmarkFormulaExpr::Min { operands } => {
            if operands.is_empty() {
                return Err(EngineError::semantic("benchmark formula min requires at least one operand"));
            }
            FormulaExpression::Min(
                operands
                    .iter()
                    .map(compile_expression)
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
        BenchmarkFormulaExpr::InputValue => FormulaExpression::InputValue,
    })
}

fn compile_actor_ref(input: BenchmarkFormulaActorRef) -> FormulaActorRef {
    match input {
        BenchmarkFormulaActorRef::Source => FormulaActorRef::Source,
        BenchmarkFormulaActorRef::Target => FormulaActorRef::Target,
        BenchmarkFormulaActorRef::SelfActor => FormulaActorRef::SelfActor,
        BenchmarkFormulaActorRef::Enemy => FormulaActorRef::Enemy,
    }
}

fn evaluate_expression<V: FormulaRuntimeView>(
    expression: &FormulaExpression,
    view: &V,
    input_value: Option<f64>,
) -> Result<f64, EngineError> {
    Ok(match expression {
        FormulaExpression::Constant(value) => *value,
        FormulaExpression::ActorAttr { actor, attr_key } => {
            view.actor_attr(resolve_actor(*actor, view), attr_key)
        }
        FormulaExpression::ActorHpCurrent { actor } => view.actor_hp_current(resolve_actor(*actor, view)),
        FormulaExpression::ActorHpMax { actor } => view.actor_hp_max(resolve_actor(*actor, view)),
        FormulaExpression::DamageTakenInWindow { actor, window_ms } => {
            view.actor_damage_taken_in_window(resolve_actor(*actor, view), *window_ms)
        }
        FormulaExpression::Add(terms) => terms
            .iter()
            .map(|term| evaluate_expression(term, view, input_value))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .sum(),
        FormulaExpression::Multiply(factors) => factors
            .iter()
            .map(|factor| evaluate_expression(factor, view, input_value))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .product(),
        FormulaExpression::Divide { numerator, denominator } => {
            let num = evaluate_expression(numerator, view, input_value)?;
            let den = evaluate_expression(denominator, view, input_value)?;
            if den == 0.0 { 0.0 } else { num / den }
        }
        FormulaExpression::Negate(operand) => {
            -evaluate_expression(operand, view, input_value)?
        }
        FormulaExpression::Max(operands) => {
            operands
                .iter()
                .map(|op| evaluate_expression(op, view, input_value))
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .fold(f64::NEG_INFINITY, f64::max)
        }
        FormulaExpression::Min(operands) => {
            operands
                .iter()
                .map(|op| evaluate_expression(op, view, input_value))
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .fold(f64::INFINITY, f64::min)
        }
        FormulaExpression::InputValue => input_value.unwrap_or(0.0),
    })
}

fn resolve_actor<V: FormulaRuntimeView>(actor: FormulaActorRef, view: &V) -> V::ActorRef {
    match actor {
        FormulaActorRef::Source => view.source_actor(),
        FormulaActorRef::Target => view.target_actor(),
        FormulaActorRef::SelfActor => view.self_actor(),
        FormulaActorRef::Enemy => view.enemy_actor(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CompiledFormulaCatalog, FormulaActorRef, FormulaRuntimeView,
    };
    use crate::model::{
        BenchmarkFormulaActorRef, BenchmarkFormulaDefinition, BenchmarkFormulaExpr,
    };

    #[derive(Clone, Copy)]
    enum TestActorRef {
        Source,
        Target,
        SelfActor,
        Enemy,
    }

    struct TestFormulaView {
        damage_taken_window_value: f64,
    }

    impl FormulaRuntimeView for TestFormulaView {
        type ActorRef = TestActorRef;

        fn source_actor(&self) -> Self::ActorRef {
            TestActorRef::Source
        }

        fn target_actor(&self) -> Self::ActorRef {
            TestActorRef::Target
        }

        fn self_actor(&self) -> Self::ActorRef {
            TestActorRef::SelfActor
        }

        fn enemy_actor(&self) -> Self::ActorRef {
            TestActorRef::Enemy
        }

        fn actor_attr(&self, _actor: Self::ActorRef, _attr_key: &str) -> f64 {
            0.0
        }

        fn actor_hp_current(&self, _actor: Self::ActorRef) -> f64 {
            0.0
        }

        fn actor_hp_max(&self, _actor: Self::ActorRef) -> f64 {
            0.0
        }

        fn actor_damage_taken_in_window(&self, actor: Self::ActorRef, window_ms: u32) -> f64 {
            assert!(matches!(actor, TestActorRef::SelfActor));
            assert_eq!(window_ms, 4_000);
            self.damage_taken_window_value
        }
    }

    #[test]
    fn compiles_damage_taken_in_window_expression() {
        let catalog = CompiledFormulaCatalog::compile(&[BenchmarkFormulaDefinition {
            formula_id: "formula_damage_window".to_string(),
            label: "Damage window".to_string(),
            expr: BenchmarkFormulaExpr::DamageTakenInWindow {
                actor: BenchmarkFormulaActorRef::SelfActor,
                window_ms: 4_000,
            },
            bypass_value: None,
        }])
        .expect("formula should compile");

        let definition = catalog
            .get("formula_damage_window")
            .expect("compiled formula should exist");
        assert!(matches!(
            definition.expression,
            super::FormulaExpression::DamageTakenInWindow {
                actor: FormulaActorRef::SelfActor,
                window_ms: 4_000,
            }
        ));
    }

    #[test]
    fn evaluates_damage_taken_in_window_expression() {
        let catalog = CompiledFormulaCatalog::compile(&[BenchmarkFormulaDefinition {
            formula_id: "formula_damage_window".to_string(),
            label: "Damage window".to_string(),
            expr: BenchmarkFormulaExpr::Multiply {
                factors: vec![
                    BenchmarkFormulaExpr::DamageTakenInWindow {
                        actor: BenchmarkFormulaActorRef::SelfActor,
                        window_ms: 4_000,
                    },
                    BenchmarkFormulaExpr::Constant { value: 2.0 },
                ],
            },
            bypass_value: None,
        }])
        .expect("formula should compile");

        let value = catalog
            .evaluate(
                "formula_damage_window",
                &TestFormulaView {
                    damage_taken_window_value: 24.242,
                },
                false,
            )
            .expect("formula should evaluate");

        assert_eq!(value, 48.484);
    }

    #[test]
    fn damage_taken_in_window_can_fallback_to_zero() {
        let catalog = CompiledFormulaCatalog::compile(&[BenchmarkFormulaDefinition {
            formula_id: "formula_damage_window".to_string(),
            label: "Damage window".to_string(),
            expr: BenchmarkFormulaExpr::DamageTakenInWindow {
                actor: BenchmarkFormulaActorRef::SelfActor,
                window_ms: 4_000,
            },
            bypass_value: None,
        }])
        .expect("formula should compile");

        let value = catalog
            .evaluate(
                "formula_damage_window",
                &TestFormulaView {
                    damage_taken_window_value: 0.0,
                },
                false,
            )
            .expect("formula should evaluate");

        assert_eq!(value, 0.0);
    }

    // ===== Tests for new node types (T08) =====

    fn make_catalog(id: &str, expr: BenchmarkFormulaExpr) -> CompiledFormulaCatalog {
        CompiledFormulaCatalog::compile(&[BenchmarkFormulaDefinition {
            formula_id: id.to_string(),
            label: id.to_string(),
            expr,
            bypass_value: None,
        }])
        .expect("formula should compile")
    }

    fn empty_view() -> TestFormulaView {
        TestFormulaView { damage_taken_window_value: 0.0 }
    }

    #[test]
    fn divide_evaluates_correctly() {
        let catalog = make_catalog(
            "f",
            BenchmarkFormulaExpr::Divide {
                numerator: Box::new(BenchmarkFormulaExpr::Constant { value: 100.0 }),
                denominator: Box::new(BenchmarkFormulaExpr::Constant { value: 4.0 }),
            },
        );
        let v = catalog.evaluate("f", &empty_view(), false).unwrap();
        assert_eq!(v, 25.0);
    }

    #[test]
    fn divide_by_zero_returns_zero() {
        let catalog = make_catalog(
            "f",
            BenchmarkFormulaExpr::Divide {
                numerator: Box::new(BenchmarkFormulaExpr::Constant { value: 50.0 }),
                denominator: Box::new(BenchmarkFormulaExpr::Constant { value: 0.0 }),
            },
        );
        let v = catalog.evaluate("f", &empty_view(), false).unwrap();
        assert_eq!(v, 0.0);
    }

    #[test]
    fn negate_flips_sign() {
        let catalog = make_catalog(
            "f",
            BenchmarkFormulaExpr::Negate {
                operand: Box::new(BenchmarkFormulaExpr::Constant { value: 42.0 }),
            },
        );
        let v = catalog.evaluate("f", &empty_view(), false).unwrap();
        assert_eq!(v, -42.0);
    }

    #[test]
    fn negate_of_negative_is_positive() {
        let catalog = make_catalog(
            "f",
            BenchmarkFormulaExpr::Negate {
                operand: Box::new(BenchmarkFormulaExpr::Constant { value: -7.5 }),
            },
        );
        let v = catalog.evaluate("f", &empty_view(), false).unwrap();
        assert_eq!(v, 7.5);
    }

    #[test]
    fn max_returns_largest() {
        let catalog = make_catalog(
            "f",
            BenchmarkFormulaExpr::Max {
                operands: vec![
                    BenchmarkFormulaExpr::Constant { value: 0.0 },
                    BenchmarkFormulaExpr::Constant { value: 200.0 },
                    BenchmarkFormulaExpr::Constant { value: -50.0 },
                ],
            },
        );
        let v = catalog.evaluate("f", &empty_view(), false).unwrap();
        assert_eq!(v, 200.0);
    }

    #[test]
    fn min_returns_smallest() {
        let catalog = make_catalog(
            "f",
            BenchmarkFormulaExpr::Min {
                operands: vec![
                    BenchmarkFormulaExpr::Constant { value: 10.0 },
                    BenchmarkFormulaExpr::Constant { value: -3.0 },
                    BenchmarkFormulaExpr::Constant { value: 5.0 },
                ],
            },
        );
        let v = catalog.evaluate("f", &empty_view(), false).unwrap();
        assert_eq!(v, -3.0);
    }

    #[test]
    fn input_value_reads_injected_value() {
        let catalog = make_catalog("f", BenchmarkFormulaExpr::InputValue);
        let v = catalog
            .evaluate_with_input("f", &empty_view(), Some(99.0), false)
            .unwrap();
        assert_eq!(v, 99.0);
    }

    #[test]
    fn input_value_defaults_to_zero_when_none_injected() {
        let catalog = make_catalog("f", BenchmarkFormulaExpr::InputValue);
        // evaluate() passes None → InputValue returns 0.0
        let v = catalog.evaluate("f", &empty_view(), false).unwrap();
        assert_eq!(v, 0.0);
    }

    /// Simulate the LoL physical mitigation formula: x * 100 / (100 + max(0, resistance))
    /// where x = InputValue (raw_damage) and resistance = 200.
    #[test]
    fn mitigation_formula_matches_hardcoded_result() {
        // 100 / (100 + 200) = 0.333...
        // With resistance = 200: mitigation_multiplier(200) = 100/300
        let expected = 100.0_f64 / (100.0 + 200.0);

        let catalog = make_catalog(
            "mitigation.physical",
            BenchmarkFormulaExpr::Multiply {
                factors: vec![
                    BenchmarkFormulaExpr::InputValue,
                    BenchmarkFormulaExpr::Divide {
                        numerator: Box::new(BenchmarkFormulaExpr::Constant { value: 100.0 }),
                        denominator: Box::new(BenchmarkFormulaExpr::Add {
                            terms: vec![
                                BenchmarkFormulaExpr::Constant { value: 100.0 },
                                BenchmarkFormulaExpr::Max {
                                    operands: vec![
                                        BenchmarkFormulaExpr::Constant { value: 0.0 },
                                        BenchmarkFormulaExpr::Constant { value: 200.0 },
                                    ],
                                },
                            ],
                        }),
                    },
                ],
            },
        );

        // InputValue = 1.0 so the result equals just the mitigation multiplier
        let v = catalog
            .evaluate_with_input("mitigation.physical", &empty_view(), Some(1.0), false)
            .unwrap();

        let diff = (v - expected).abs();
        assert!(diff < 1e-12, "expected {expected}, got {v}");
    }
}
