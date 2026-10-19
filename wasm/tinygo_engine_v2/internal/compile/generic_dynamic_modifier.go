package compile

import (
	"math"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func finalizeDynamicModifiers(ctx *genericCompileContext) {
	for pi := range ctx.session.Providers {
		p := &ctx.session.Providers[pi]
		for mi := range p.Modifiers {
			mod := &p.Modifiers[mi]
			if mod.Kind != "resource_max" && mod.Kind != "cooldown_duration" {
				continue
			}
			path := "sharedProviders[" + itoa(pi) + "].modifiers[" + itoa(mi) + "]"
			fail := func(field, message string) {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path+field, message, mod.ModifierKey)
			}
			lc := p.Lifecycle
			valid := p.Kind == "status" && p.TypeSet.Empty() && p.AbilityCount == 0 && len(p.Listeners)+len(p.StateFields)+len(p.Processes)+len(p.StatusContributions) == 0 && p.ShieldDefinitionRef == "" && p.AmmoBinding == nil && !p.NeedsElapsedTime
			valid = valid && lc != nil && lc.HasDuration && lc.MaxStacks == 1 && lc.RefreshPolicy == model.RefreshPolicyReplace && lc.InstanceScope == model.InstanceScopeSourceTarget && lc.TickIntervalMs == 0
			if lc != nil && lc.HasDuration {
				duration, static := ctx.session.Formulas.FoldStatic(lc.DurationProgram)
				valid = valid && static && formula.ValidPositiveInt64DurationMs(duration)
			}
			valid = valid && mod.HasValue && !mod.HasCondition && mod.Command == "" && mod.Channel == "" && mod.Stage == "" && mod.Bucket == "" && mod.Priority == 0 && mod.HealDirection == "" && mod.HealCategory == "" && mod.HealGroupKey == "" && mod.HealGroupCalculationMode == ""
			value, static := ctx.session.Formulas.FoldStatic(mod.ValueProgram)
			valid = valid && static && !math.IsNaN(value) && !math.IsInf(value, 0)
			if !valid {
				fail("", "dynamic modifier requires a pure finite static own single-layer provider")
				continue
			}
			mod.StaticValue = value
			duration, _ := ctx.session.Formulas.FoldStatic(lc.DurationProgram)
			p.StaticDurationMs = int64(duration)
			if mod.Kind == "resource_max" {
				if mod.Target != "self.attr.hp" || mod.ValuePolicy != "add" || value < 0 || mod.CurrentValuePolicy != "grant_positive_delta_clamp" || mod.HasAffectedAbilityRefs {
					fail("", "resource_max requires nonnegative hp add and its explicit current-value policy")
					continue
				}
				p.HasResourceMax, ctx.session.HasResourceMax = true, true
			} else {
				if mod.Target != "self" || mod.ValuePolicy != "multiply" || value <= 0 || mod.CurrentValuePolicy != "" || !mod.HasAffectedAbilityRefs {
					fail("", "cooldown_duration requires a positive multiplier and explicit ability reference array")
					continue
				}
				seen := map[string]bool{}
				for _, text := range mod.AffectedAbilityRefs {
					ref, found := ctx.session.AbilityRefIndex[text]
					parsed, shaped := plan.ParseAbilityRef(text)
					if seen[text] || !found || !shaped {
						fail(".affectedAbilityRefs", "cooldown duration target must be a unique actual INITIAL reference")
						continue
					}
					seen[text] = true
					ability := ctx.session.Abilities[ref.AbilityIndex]
					valid := ability.Kind == "active" && !ability.IsBasicAttack && !ability.HasSkillHit && ability.ProcessControl != nil && ability.ProcessControl.Action == "INITIAL" && !ability.ProcessControl.UseRefFromEvent
					if valid {
						cp := ctx.session.Providers[ref.ProviderIndex].Processes[ability.ProcessControl.ProcessIndex]
						valid = cp.Cooldown != nil && cp.Cooldown.HasDuration
					}
					if !valid {
						fail(".affectedAbilityRefs", "cooldown duration target must have its ordinary own INITIAL process cooldown")
						continue
					}
					mod.CooldownTargets = append(mod.CooldownTargets, plan.CompiledCooldownDurationTarget{CombatantKey: parsed.Combatant, ProviderRef: parsed.ProviderRef, ProviderIndex: ref.ProviderIndex, AbilityIndex: ref.AbilityIndex})
				}
				p.HasCooldownDuration, ctx.session.HasCooldownDuration = true, true
			}
			p.NeedsModifierExpiry, ctx.session.HasFiniteModifierExpiry = true, true
		}
		if p.HasResourceMax || p.HasCooldownDuration {
			for _, mod := range p.Modifiers {
				if mod.Kind == "resource_max" || mod.Kind == "cooldown_duration" {
					continue
				}
				value, static := ctx.session.Formulas.FoldStatic(mod.ValueProgram)
				if mod.Kind != "attribute" || mod.HasCondition || !mod.HasValue || !static || math.IsNaN(value) || math.IsInf(value, 0) || mod.ValuePolicy != "add" || mod.Stage != "" || mod.Command != "" || mod.Channel != "" || len(mod.Target) <= len("self.attr.") || mod.Target[:len("self.attr.")] != "self.attr." || mod.Target == "self.attr.hp" {
					ctx.collector.addError(model.GenericErrFormulaTypeError, "sharedProviders["+itoa(pi)+"]", "dynamic modifier sibling must be a static own non-hp flat attribute", mod.ModifierKey)
				}
			}
		}
	}
	for _, mod := range ctx.session.RuleModifiers {
		if mod.Kind == "resource_max" || mod.Kind == "cooldown_duration" {
			ctx.collector.addError(model.GenericErrFormulaTypeError, "rules.modifiers", "dynamic modifiers require their finite actual provider", mod.ModifierKey)
		}
	}
	for i := range ctx.session.Providers {
		p := &ctx.session.Providers[i]
		p.AtomicDynamic = p.HasResourceMax || p.HasCooldownDuration || pureFiniteTargetAttributeProvider(p.ProviderKey, ctx)
		if p.AtomicDynamic {
			duration, _ := ctx.session.Formulas.FoldStatic(p.Lifecycle.DurationProgram)
			p.StaticDurationMs = int64(duration)
		}
	}
	for _, op := range ctx.session.Operations {
		if op.Operation != "apply_provider" {
			continue
		}
		idx, found := ctx.providerKeyIndex[op.ProviderDefinitionRef]
		if !found {
			continue
		}
		p := ctx.session.Providers[idx]
		if (p.HasResourceMax || p.HasCooldownDuration) && op.Target != "self" && op.Target != "source" {
			ctx.collector.addError(model.GenericErrFormulaTypeError, op.Path+".target", "dynamic modifier provider can only be applied to its actual source", op.ProviderDefinitionRef)
		}
		if p.HasCooldownDuration {
			for _, actor := range ctx.session.Combatants {
				owns := false
				for _, mount := range actor.ProviderMounts {
					if int(mount.DefinitionIndex) == op.OwnerProviderIndex {
						owns = true
						break
					}
				}
				if !owns {
					continue
				}
				for _, mod := range p.Modifiers {
					for _, ref := range mod.CooldownTargets {
						if ref.CombatantKey != actor.Key {
							ctx.collector.addError(model.GenericErrFormulaTypeError, op.Path, "cooldown duration scope must name the applying actual owner", ref.CombatantKey)
						}
					}
				}
			}
		}
	}
}
