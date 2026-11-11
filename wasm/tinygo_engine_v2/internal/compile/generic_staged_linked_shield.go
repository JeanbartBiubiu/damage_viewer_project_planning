package compile

import (
	"math"
	"strings"
	"tinygo_engine_v2/internal/model"
)

func finalizeStagedLinkedShields(ctx *genericCompileContext) {
	for pi := range ctx.session.Providers {
		p := &ctx.session.Providers[pi]
		if p.ShieldDefinitionRef == "" || len(p.Modifiers) == 0 {
			continue
		}
		valid := p.Kind == "status" && p.TypeSet.Empty() && p.AbilityCount == 0 && len(p.Listeners)+len(p.StateFields)+len(p.Processes)+len(p.StatusContributions) == 0 && p.AmmoBinding == nil && !p.NeedsElapsedTime
		valid = valid && (p.Lifecycle == nil || p.Lifecycle.MaxStacks == 1 && p.Lifecycle.RefreshPolicy == "replace" && p.Lifecycle.TickIntervalMs == 0)
		for mi := range p.Modifiers {
			mod := &p.Modifiers[mi]
			key, own := strings.CutPrefix(mod.Target, "self.attr.")
			value, static := ctx.formulas.FoldStatic(mod.ValueProgram)
			valid = valid && mod.Kind == "attribute" && own && key != "" && key != "hp" && !strings.Contains(key, ".") && !mod.HasCondition && !mod.HasMultiplierGroup && mod.HasValue && mod.ValueReadMode == "" && static && !math.IsNaN(value) && !math.IsInf(value, 0) && (mod.ValuePolicy == "add" || mod.ValuePolicy == "percent_add" || mod.ValuePolicy == "multiply") && (mod.Stage == "" || mod.Stage == "total") && mod.Command == "" && mod.Channel == "" && mod.CurrentValuePolicy == "" && !mod.HasAffectedAbilityRefs
			mod.StaticValue = value
		}
		if !valid {
			ctx.collector.addError(model.GenericErrFormulaTypeError, "sharedProviders["+itoa(pi)+"]", "linked shield attributes require a complete pure static own non-HP modifier group", p.ProviderKey)
			continue
		}
		p.AtomicLinkedShield, ctx.session.HasStagedLinkedShield = true, true
	}
}
