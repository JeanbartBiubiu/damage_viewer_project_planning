package evaluation

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"fmt"
	"math"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

// ResolveDerivedAttributes 依据已选时点的双方视图计算所属派生属性，不发布或缓存状态。
func ResolveDerivedAttributes(derivations []planbundle.CompiledAttributeDerivation, formulas formula.GenericRegistry, actorKey string, attrs attribute.Table, resolver effectpkg.AttributeResolver, sourceAttrs, targetAttrs attribute.Table, providerContext pipeline.ProviderFormulaContextFunc) (attribute.Table, error) {
	if len(derivations) == 0 {
		return attrs, nil
	}
	out := attrs
	for _, derivation := range derivations {
		if derivation.CombatantKey != actorKey {
			continue
		}
		ctx := formula.GenericEvalContext{StrictReads: true, SourceAttrs: sourceAttrs, TargetAttrs: targetAttrs}
		if actorKey == "source" {
			ctx.SourceAttrs = attrs
		} else {
			ctx.TargetAttrs = attrs
		}
		actorContext := ctx
		{
			actorContext.RuntimeSkillKey = derivation.SkillKey
			actorContext.HasAuthoredActorContext = true
			actorContext.AuthoredCombatantKey = actorKey
			actorContext.AuthoredSourceAttrs, actorContext.AuthoredTargetAttrs = ctx.SourceAttrs, ctx.TargetAttrs
			if actorKey == "target" {
				actorContext.AuthoredSourceAttrs, actorContext.AuthoredTargetAttrs = ctx.TargetAttrs, ctx.SourceAttrs
			}
		}
		value, err := formulas.EvalContext(derivation.ValueProgram, &actorContext)
		if err != nil {
			return attribute.Table{}, fmt.Errorf("%s: %w", derivation.Path, err)
		}
		if math.IsNaN(value) || math.IsInf(value, 0) || (derivation.ValuePolicy == "multiply" && value < 0) {
			return attribute.Table{}, fmt.Errorf("%s: derived value must be finite; multiplier must be nonnegative", derivation.Path)
		}
		slot := out.At(derivation.AttributeKey)
		if derivation.ValuePolicy == "multiply" {
			slot.Resolved *= value
			if math.IsNaN(slot.Resolved) || math.IsInf(slot.Resolved, 0) {
				return attribute.Table{}, fmt.Errorf("%s: derived attribute must remain finite", derivation.Path)
			}
			if err := validateDerivedOutput(derivation, slot.Resolved); err != nil {
				return attribute.Table{}, err
			}
			out = out.With(derivation.AttributeKey, slot)
			continue
		}
		slot.Resolved = value
		out = out.With(derivation.AttributeKey, slot)
		if actorKey == "source" {
			ctx.SourceAttrs = out
		} else {
			ctx.TargetAttrs = out
		}
		resolvedSlot, resolveErr := resolver.ResolveDerivedAttribute(derivation.AttributeKey, slot, value, attrs, ctx, formulas, providerContext)
		if resolveErr != nil {
			return attribute.Table{}, fmt.Errorf("%s: %w", derivation.Path, resolveErr)
		}
		if err := validateDerivedOutput(derivation, resolvedSlot.Resolved); err != nil {
			return attribute.Table{}, err
		}
		out = out.With(derivation.AttributeKey, resolvedSlot)
	}
	return out, nil
}

func validateDerivedOutput(derivation planbundle.CompiledAttributeDerivation, value float64) error {
	if math.IsNaN(value) || math.IsInf(value, 0) || (derivation.ValueType == "INTEGER" && (math.Trunc(value) != value || math.Abs(value) > float64(9007199254740991))) {
		return fmt.Errorf("%s: derived output violates its explicit numeric type", derivation.Path)
	}
	return nil
}
