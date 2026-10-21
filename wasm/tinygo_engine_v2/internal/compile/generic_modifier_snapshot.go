package compile

import (
	"math"
	"strings"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func pureSnapshotAttributeProvider(reference string, ctx *genericCompileContext) bool {
	index, exists := ctx.providerKeyIndex[reference]
	if !exists {
		return false
	}
	p := ctx.session.Providers[index]
	lc := p.Lifecycle
	if p.Kind != "status" || !p.TypeSet.Empty() || p.ShieldDefinitionRef != "" || p.AbilityCount != 0 || len(p.Listeners)+len(p.StateFields)+len(p.Processes)+len(p.StatusContributions) != 0 || p.AmmoBinding != nil || p.NeedsElapsedTime || len(p.Modifiers) != 2 || lc == nil || !lc.HasDuration || lc.MaxStacks != 1 || lc.RefreshPolicy != "replace" || lc.InstanceScope != model.InstanceScopeSourceTarget || lc.TickIntervalMs != 0 {
		return false
	}
	duration, static := ctx.session.Formulas.FoldStatic(lc.DurationProgram)
	if !static || !formula.ValidPositiveInt64DurationMs(duration) {
		return false
	}
	var target, source = -1, -1
	attribute := ""
	rate := float64(0)
	for i, mod := range p.Modifiers {
		if mod.Kind != "attribute" || !mod.HasValue || mod.HasCondition || mod.Command != "" || mod.Channel != "" || mod.CurrentValuePolicy != "" || mod.HasAffectedAbilityRefs || mod.HealDirection != "" || mod.HealCategory != "" || mod.HealGroupKey != "" || mod.HealGroupCalculationMode != "" {
			return false
		}
		if key, own := strings.CutPrefix(mod.Target, "self.attr."); own && mod.Stage == "total" && mod.ValuePolicy == "multiply" && (mod.ValueReadMode == "" || mod.ValueReadMode == "APPLICATION_SNAPSHOT") {
			value, fixed := ctx.session.Formulas.FoldStatic(mod.ValueProgram)
			if target >= 0 || !fixed || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 || key == "" || key == "hp" || strings.Contains(key, ".") {
				return false
			}
			target, attribute, rate = i, key, 1-value
		} else if strings.HasPrefix(mod.Target, "opponent.attr.") && mod.Stage == "" && mod.ValuePolicy == "add" && mod.ValueReadMode == "APPLICATION_SNAPSHOT" {
			if source >= 0 {
				return false
			}
			source = i
		} else {
			return false
		}
	}
	if target < 0 || source < 0 || p.Modifiers[source].Target != "opponent.attr."+attribute || p.Modifiers[source].ModifierKey == p.Modifiers[target].ModifierKey {
		return false
	}
	linear, valid := ctx.session.Formulas.TargetAttributeLinear(p.Modifiers[source].ValueProgram, attribute)
	return valid && linear.Offset == 0 && math.Abs(linear.Factor-rate) <= 1e-12
}

func finalizeModifierSnapshots(ctx *genericCompileContext) {
	for pi := range ctx.session.Providers {
		p := &ctx.session.Providers[pi]
		marked := false
		for _, mod := range p.Modifiers {
			marked = marked || mod.ValueReadMode != ""
		}
		if !marked {
			continue
		}
		if !pureSnapshotAttributeProvider(p.ProviderKey, ctx) {
			ctx.collector.addError(model.GenericErrFormulaTypeError, "sharedProviders["+itoa(pi)+"]", "application snapshots require the complete finite target reduction and same-ratio source gain graph", p.ProviderKey)
			continue
		}
		p.HasModifierSnapshots, p.AtomicDynamic, ctx.session.HasModifierSnapshots = true, true, true
		for i := range p.Modifiers {
			if value, fixed := ctx.session.Formulas.FoldStatic(p.Modifiers[i].ValueProgram); fixed {
				p.Modifiers[i].StaticValue = value
			}
		}
		value, _ := ctx.session.Formulas.FoldStatic(p.Lifecycle.DurationProgram)
		p.StaticDurationMs = int64(value)
	}
	for _, mod := range ctx.session.RuleModifiers {
		if mod.ValueReadMode != "" {
			ctx.collector.addError(model.GenericErrFormulaTypeError, "rules.modifiers", "snapshot modifier requires its actual finite provider", mod.ModifierKey)
		}
	}
	for _, actor := range ctx.session.Combatants {
		for _, mount := range actor.ProviderMounts {
			if ctx.session.Providers[mount.DefinitionIndex].HasModifierSnapshots {
				ctx.collector.addError(model.GenericErrFormulaTypeError, "combatants.providers", "snapshot attribute provider cannot be initially mounted", mount.ProviderRef)
			}
		}
	}
	for _, operation := range ctx.session.Operations {
		index, exists := ctx.providerKeyIndex[operation.ProviderDefinitionRef]
		if !exists || !ctx.session.Providers[index].HasModifierSnapshots {
			continue
		}
		if operation.Operation != "apply_provider" || operation.Target != "target" || !strings.Contains(operation.Path, ".skillHit.candidates[") {
			ctx.collector.addError(model.GenericErrFormulaTypeError, operation.Path, "snapshot attribute provider must be applied by a complete actual target hit candidate", operation.ProviderDefinitionRef)
		}
	}
}
