package compile

import (
	"math"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

// Explicit zero is not a global change to ordinary or anchored tick defaults.
// It belongs only to one owned, finite, single-instance pure damage definition.
func finalizeImmediatePeriodic(ctx *genericCompileContext) {
	for index := range ctx.session.Abilities {
		ability := &ctx.session.Abilities[index]
		if ability.TickSpec == nil || !ability.TickSpec.ImmediateFirst {
			continue
		}
		provider := ctx.session.Providers[ability.ProviderIndex]
		fail := func(message string) {
			ctx.collector.addError(model.GenericErrFormulaTypeError, "sharedProviders."+provider.ProviderKey+".tickSpec.startDelayMs", message, ability.AbilityKey)
		}
		lc, tick := provider.Lifecycle, ability.TickSpec
		valid := provider.Kind == "status" && provider.StableID != "" && provider.SkillKey != "" && provider.AbilityCount == 1 && lc != nil && lc.HasDuration && lc.MaxStacks == 1 && lc.RefreshPolicy == model.RefreshPolicyReplace && lc.InstanceScope == model.InstanceScopeSourceTarget && lc.TickIntervalMs == 0 &&
			len(provider.Listeners)+len(provider.Processes)+len(provider.StateFields)+len(provider.Modifiers)+len(provider.StatusContributions) == 0 && provider.ShieldDefinitionRef == "" && provider.AmmoBinding == nil && !provider.NeedsElapsedTime &&
			ability.Kind == "tick" && ability.SkillKey == provider.SkillKey && !tick.IsAnchored() && tick.PhasePolicy == "" && tick.IntervalMs > 0 && tick.IntervalMs <= 9007199254740991 && tick.StartDelayMs == 0 && tick.OnTickCount > 0 && ability.OperationCount == 0 && ability.ProcessControl == nil && ability.TargetExpirySpec == nil && ability.Cost == nil && ability.Cooldown == nil && !ability.HasCastCondition && !ability.HasSkillHit
		if valid {
			duration, static := ctx.formulas.FoldStatic(lc.DurationProgram)
			valid = static && !math.IsNaN(duration) && !math.IsInf(duration, 0) && duration > 0 && duration <= 9007199254740991 && math.Trunc(duration) == duration
		}
		for _, op := range ctx.session.Operations[int(tick.OnTickStart) : int(tick.OnTickStart)+int(tick.OnTickCount)] {
			valid = valid && op.Operation == "damage" && op.Target == model.SelectorTarget && op.HasAmount && !op.HasCondition
		}
		parentIndex, applications := -1, 0
		for _, op := range ctx.session.Operations {
			if op.Operation != "apply_provider" || op.ProviderDefinitionRef != provider.ProviderKey {
				continue
			}
			applications++
			valid = valid && op.Target == model.SelectorSelf && !op.HasCondition && op.OwnerProviderIndex >= 0 && op.OwnerProviderIndex < len(ctx.session.Providers)
			if parentIndex >= 0 && parentIndex != op.OwnerProviderIndex {
				valid = false
			}
			parentIndex = op.OwnerProviderIndex
		}
		mounts := 0
		for _, actor := range ctx.session.Combatants {
			for _, mount := range actor.ProviderMounts {
				if mount.DefinitionIndex == ability.ProviderIndex {
					valid = false
				}
				if int(mount.DefinitionIndex) == parentIndex {
					mounts++
				}
			}
		}
		if parentIndex >= 0 && parentIndex < len(ctx.session.Providers) {
			parent := ctx.session.Providers[parentIndex]
			valid = valid && parent.Kind == "character" && parent.Lifecycle == nil && parent.StableID == provider.StableID && parent.SkillKey == provider.SkillKey
			bound := false
			for _, binding := range ctx.session.SkillActionBindings {
				bound = bound || int(ctx.session.Abilities[binding.InitialAbilityIndex].ProviderIndex) == parentIndex
			}
			valid = valid && bound
		}
		if !valid || applications == 0 || mounts != 1 {
			fail("immediate first period requires one actual planned character parent and complete finite single-instance damage")
			continue
		}
		ctx.session.HasImmediatePeriodic = true
	}
}

// The full binding is retained, not reconstructed from an ability-name suffix.
func ordinaryInitialTarget(refText, owner string, ctx *genericCompileContext) (*plan.CompiledCooldownDurationTarget, bool) {
	ref, exists := ctx.session.AbilityRefIndex[refText]
	parsed, shaped := plan.ParseAbilityRef(refText)
	if !exists || !shaped || parsed.Combatant != owner {
		return nil, false
	}
	ability := ctx.session.Abilities[ref.AbilityIndex]
	provider := ctx.session.Providers[ref.ProviderIndex]
	if provider.Kind != "character" || provider.StableID == "" || provider.Lifecycle != nil || ability.IsBasicAttack || ability.Kind != "active" || ability.HasSkillHit || ability.ProcessControl == nil || ability.ProcessControl.Action != "INITIAL" || ability.ProcessControl.UseRefFromEvent {
		return nil, false
	}
	processIndex := ability.ProcessControl.ProcessIndex
	if processIndex < 0 || processIndex >= len(provider.Processes) {
		return nil, false
	}
	process := provider.Processes[processIndex]
	if process.Cooldown == nil || !process.Cooldown.HasDuration || process.InitialAbilityIndex != int(ref.AbilityIndex) || process.SkillKey != ability.SkillKey {
		return nil, false
	}
	matches := 0
	for _, binding := range ctx.session.SkillActionBindings {
		if binding.Source == owner && binding.ProviderRef == parsed.ProviderRef && binding.ProviderDefinitionRef == provider.ProviderKey && binding.SkillKey == ability.SkillKey && binding.InitialAbilityIndex == ref.AbilityIndex {
			matches++
		}
	}
	if matches != 1 {
		return nil, false
	}
	return &plan.CompiledCooldownDurationTarget{CombatantKey: owner, ProviderRef: parsed.ProviderRef, ProviderIndex: ref.ProviderIndex, AbilityIndex: ref.AbilityIndex}, true
}

func finalizeTotalCooldownRefunds(ctx *genericCompileContext) {
	damage, hasDamage := ctx.session.RuntimeTypes.DamageInstance.Lookup()
	owner, hasOwner := ctx.session.RuntimeTypes.SourceOwner.Lookup()
	for index := range ctx.session.Operations {
		op := &ctx.session.Operations[index]
		if op.Operation != "cooldown_change" || op.ValuePolicy != "reduce_total_ratio" {
			continue
		}
		fail := func() {
			ctx.collector.addError(model.GenericErrFormulaTypeError, op.Path, "total cooldown ratio requires a single owned settled-damage listener and an actual sibling ordinary INITIAL", op.AbilityRefStr)
		}
		ratio, static := ctx.formulas.FoldStatic(op.AmountProgram)
		if !op.HasAmount || !static || math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0 || ratio > 1 || op.Target != model.SelectorSelf || op.HasCondition || !op.HasAbilityRef || !hasDamage || !hasOwner {
			fail()
			continue
		}
		matches := 0
		var target *plan.CompiledCooldownDurationTarget
		for _, listener := range ctx.session.Listeners {
			if int(listener.OperationStart) != index || listener.OperationCount != 1 {
				continue
			}
			if listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.HasAbilityRef || listener.SourceAbilityIndex < 0 || listener.SourceAbilityIndex >= len(ctx.session.Abilities) || !listener.EventMatcher.RequiresAllType(damage) || !listener.EventMatcher.RequiresAllType(owner) {
				continue
			}
			ability := ctx.session.Abilities[listener.SourceAbilityIndex]
			parent := ctx.session.Providers[ability.ProviderIndex]
			if int(ability.ProviderIndex) != op.OwnerProviderIndex || ability.Kind != "passive_listener" || parent.Kind != "character" && parent.Kind != "build" && parent.Kind != "item" || parent.Lifecycle != nil || parent.StableID == "" || listener.OwnerCombatantKey == "" || listener.OwnerProviderRef == "" {
				continue
			}
			var valid bool
			target, valid = ordinaryInitialTarget(op.AbilityRefStr, listener.OwnerCombatantKey, ctx)
			if valid {
				matches++
			}
		}
		if matches != 1 {
			fail()
			continue
		}
		op.TotalCooldownTarget, op.TotalCooldownRatio = target, ratio
		ctx.session.HasTotalCooldownRefund = true
	}
}
