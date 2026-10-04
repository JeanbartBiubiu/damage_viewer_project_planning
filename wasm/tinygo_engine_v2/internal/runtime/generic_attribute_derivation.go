package runtime

import (
	"fmt"
	"math"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

func resolveDerivedAttributes(compiled compilebundle.CompiledSession, actorKey string, attrs map[string]model.AttributeSlotDef, resolver pipeline.AttributeResolver, sourceAttrs, targetAttrs map[string]model.AttributeSlotDef, providerContext pipeline.ProviderFormulaContextFunc) (map[string]model.AttributeSlotDef, error) {
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
		program := compiled.Formulas.Programs[derivation.ValueProgram]
		for _, instruction := range program.Instr {
			if instruction.Op != formula.GenericOpRead || instruction.ReadKey != "attack_speed_ratio.resolved" {
				continue
			}
			ratioAttrs := ctx.SourceAttrs
			if instruction.ReadKind == formula.ReadTargetAttr {
				ratioAttrs = ctx.TargetAttrs
			}
			ratio, exists := ratioAttrs["attack_speed_ratio"]
			if !exists || math.IsNaN(ratio.Resolved) || math.IsInf(ratio.Resolved, 0) || ratio.Resolved <= 0 {
				return nil, fmt.Errorf("%s: attack_speed_ratio must be explicitly finite and positive", derivation.Path)
			}
		}
		value, err := compiled.Formulas.Eval(derivation.ValueProgram, ctx)
		if err != nil {
			return nil, fmt.Errorf("%s: %v", derivation.Path, err)
		}
		if math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 {
			return nil, fmt.Errorf("%s: derived attack speed must be finite and positive", derivation.Path)
		}
		out := cloneAttributeMap(attrs)
		slot := out[derivation.AttributeKey]
		slot.Resolved = value
		out[derivation.AttributeKey] = slot
		if actorKey == "source" {
			ctx.SourceAttrs = out
		} else {
			ctx.TargetAttrs = out
		}
		resolvedSlot, resolveErr := resolver.ResolveDerivedAttribute(derivation.AttributeKey, slot, value, ctx, compiled.Formulas, providerContext)
		if resolveErr != nil {
			return nil, fmt.Errorf("%s: %v", derivation.Path, resolveErr)
		}
		if resolvedSlot.Resolved <= 0 {
			return nil, fmt.Errorf("%s: modified attack speed must be positive", derivation.Path)
		}
		out[derivation.AttributeKey] = resolvedSlot
		return out, nil
	}
	return attrs, nil
}
