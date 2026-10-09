package runtime

import (
	"fmt"
	"math"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

func resolveDerivedAttributes(compiled planbundle.CompiledSession, formulas formula.GenericRegistry, actorKey string, attrs map[string]model.AttributeSlotDef, resolver pipeline.AttributeResolver, sourceAttrs, targetAttrs map[string]model.AttributeSlotDef, providerContext pipeline.ProviderFormulaContextFunc) (map[string]model.AttributeSlotDef, error) {
	if len(compiled.AttributeDerivations) == 0 {
		return attrs, nil
	}
	out := cloneAttributeMap(attrs)
	for _, derivation := range compiled.AttributeDerivations {
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
		if derivation.SkillKey != "" {
			actorContext.RuntimeSkillKey = derivation.SkillKey
			actorContext.HasAuthoredActorContext = true
			actorContext.AuthoredCombatantKey = actorKey
			actorContext.AuthoredSourceAttrs, actorContext.AuthoredTargetAttrs = ctx.SourceAttrs, ctx.TargetAttrs
			if actorKey == "target" {
				actorContext.AuthoredSourceAttrs, actorContext.AuthoredTargetAttrs = ctx.TargetAttrs, ctx.SourceAttrs
			}
		}
		for _, instruction := range formulas.ReadDependencies(derivation.ValueProgram) {
			if instruction.Op != formula.GenericOpRead || instruction.ReadKey != "attack_speed_ratio.resolved" {
				continue
			}
			ratioAttrs := ctx.SourceAttrs
			if instruction.ReadKind == formula.ReadTargetAttr {
				ratioAttrs = ctx.TargetAttrs
			}
			if instruction.AuthoredRead && actorContext.HasAuthoredActorContext {
				ratioAttrs = actorContext.AuthoredSourceAttrs
				if instruction.ReadKind == formula.ReadTargetAttr {
					ratioAttrs = actorContext.AuthoredTargetAttrs
				}
			}
			ratio, exists := ratioAttrs["attack_speed_ratio"]
			if !exists || math.IsNaN(ratio.Resolved) || math.IsInf(ratio.Resolved, 0) || ratio.Resolved <= 0 {
				return nil, fmt.Errorf("%s: attack_speed_ratio must be explicitly finite and positive", derivation.Path)
			}
		}
		value, err := formulas.Eval(derivation.ValueProgram, actorContext)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", derivation.Path, err)
		}
		if math.IsNaN(value) || math.IsInf(value, 0) || (derivation.ValuePolicy == "multiply" && value < 0) || (derivation.ValuePolicy != "multiply" && value <= 0) {
			return nil, fmt.Errorf("%s: attack speed must be finite and positive; attack damage factor must be finite and non-negative", derivation.Path)
		}
		slot := out[derivation.AttributeKey]
		if derivation.ValuePolicy == "multiply" {
			slot.Resolved *= value
			if math.IsNaN(slot.Resolved) || math.IsInf(slot.Resolved, 0) || slot.Resolved < 0 {
				return nil, fmt.Errorf("%s: converted attack damage must be finite and non-negative", derivation.Path)
			}
			out[derivation.AttributeKey] = slot
			continue
		}
		slot.Resolved = value
		out[derivation.AttributeKey] = slot
		if actorKey == "source" {
			ctx.SourceAttrs = out
		} else {
			ctx.TargetAttrs = out
		}
		resolvedSlot, resolveErr := resolver.ResolveDerivedAttribute(derivation.AttributeKey, slot, value, ctx, formulas, providerContext)
		if resolveErr != nil {
			return nil, fmt.Errorf("%s: %w", derivation.Path, resolveErr)
		}
		if resolvedSlot.Resolved <= 0 {
			return nil, fmt.Errorf("%s: modified attack speed must be positive", derivation.Path)
		}
		out[derivation.AttributeKey] = resolvedSlot
	}
	return out, nil
}
