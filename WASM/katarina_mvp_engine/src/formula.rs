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
