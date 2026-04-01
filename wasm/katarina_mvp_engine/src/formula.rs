#![allow(dead_code)]

use crate::model::{
    BenchmarkFormulaActorRef, BenchmarkFormulaDefinition, BenchmarkFormulaExpr, EngineError, ErrorCode,
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
    pub formula_id: String,
    pub expression: FormulaExpression,
    pub formula_bypass_value: Option<f64>,
}

#[derive(Debug, Clone)]
pub enum FormulaExpression {
    Constant(f64),
    ActorAttr { actor: FormulaActorRef, attr_key: String },
    ActorHpCurrent { actor: FormulaActorRef },
    ActorHpMax { actor: FormulaActorRef },
    ActorManaCurrent { actor: FormulaActorRef },
    DamageTakenInWindow { actor: FormulaActorRef, window_ms: u32 },
    Add(Vec<FormulaExpression>),
    Multiply(Vec<FormulaExpression>),
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
                return Err(semantic_error(format!(
                    "duplicate benchmark formula id '{}'",
                    input.formula_id
                )));
            }
            formulas.insert(
                input.formula_id.clone(),
                CompiledFormulaDefinition {
                    formula_id: input.formula_id.clone(),
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
        let definition = self
            .get(formula_id)
            .ok_or_else(|| semantic_error(format!("unknown benchmark formula id '{formula_id}'")))?;
        if profile_uses_bypass {
            return Ok(definition.formula_bypass_value.unwrap_or(0.0));
        }
        evaluate_expression(&definition.expression, view)
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
    fn actor_mana_current(&self, actor: Self::ActorRef) -> f64;
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
                return Err(semantic_error("benchmark formula add requires at least one term"));
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
                return Err(semantic_error("benchmark formula multiply requires at least one factor"));
            }
            FormulaExpression::Multiply(
                factors
                    .iter()
                    .map(compile_expression)
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
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
) -> Result<f64, EngineError> {
    Ok(match expression {
        FormulaExpression::Constant(value) => *value,
        FormulaExpression::ActorAttr { actor, attr_key } => {
            view.actor_attr(resolve_actor(*actor, view), attr_key)
        }
        FormulaExpression::ActorHpCurrent { actor } => view.actor_hp_current(resolve_actor(*actor, view)),
        FormulaExpression::ActorHpMax { actor } => view.actor_hp_max(resolve_actor(*actor, view)),
        FormulaExpression::ActorManaCurrent { actor } => {
            view.actor_mana_current(resolve_actor(*actor, view))
        }
        FormulaExpression::DamageTakenInWindow { actor, window_ms } => {
            view.actor_damage_taken_in_window(resolve_actor(*actor, view), *window_ms)
        }
        FormulaExpression::Add(terms) => terms
            .iter()
            .map(|term| evaluate_expression(term, view))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .sum(),
        FormulaExpression::Multiply(factors) => factors
            .iter()
            .map(|factor| evaluate_expression(factor, view))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .product(),
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

fn semantic_error(message: impl Into<String>) -> EngineError {
    EngineError {
        code: ErrorCode::SemanticError,
        message: message.into(),
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

        fn actor_mana_current(&self, _actor: Self::ActorRef) -> f64 {
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
}
