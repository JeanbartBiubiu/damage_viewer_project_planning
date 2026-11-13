package compile

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func validatePassiveProcessShape(def model.ProcessDefinition, provider model.ProviderDefinition, path string, ctx *genericCompileContext) {
	if def.EntryKind == "" {
		return
	}
	bad := func(field, message string) {
		ctx.collector.addError(model.GenericErrUnknownRef, path+field, message, def.ProcessKey)
	}
	if def.EntryKind != model.ProcessEntrySkillHitPassive {
		bad(".entryKind", "unknown process entry kind")
		return
	}
	if (provider.Kind != "character" && provider.Kind != "item" && provider.Kind != "build") || provider.StableID == "" || provider.Lifecycle != nil {
		bad(".entryKind", "passive process requires an owned permanent static source")
	}
	if len(def.Costs) != 0 || def.Cooldown != nil {
		bad(".costs", "passive process has no costs or ordinary cooldown")
	}
	for _, ability := range provider.Abilities {
		if ability.Kind != "passive_listener" || ability.ProcessControl != nil || ability.Cost != nil || ability.Cooldown != nil || ability.TickSpec != nil || ability.CastCondition != nil {
			bad(".entryKind", "passive process source contains an unbound active or timed ability")
		}
	}
	hasDelay, hasLeaf := false, false
	for i, step := range def.Steps {
		if (step.StepType != "IMMEDIATE" && step.StepType != "DELAY") || step.OccupiesAction == nil || *step.OccupiesAction {
			bad(".steps["+itoa(i)+"]", "passive steps must be explicitly non-occupying IMMEDIATE or DELAY")
		}
		hasDelay = hasDelay || step.StepType == "DELAY"
	}
	for i, moment := range def.MomentOperations {
		for j, op := range moment.Operations {
			switch op.Operation {
			case "damage", "heal", "state_change", "apply_provider", "refresh_provider", "expire_provider", "attribute_change", "resource_change", "shield":
				hasLeaf = true
			default:
				bad(".momentOperations["+itoa(i)+"].operations["+itoa(j)+"]", "passive process requires actual numeric or state leaves; no recursive starts, event emission, cooldown or hit dispatch")
			}
		}
	}
	if !hasDelay || !hasLeaf {
		bad(".momentOperations", "passive process requires a real delay and reachable leaf behavior")
	}
}

func compilePassiveProcessStart(op model.OperationDefinition, path string, owner int, ctx *genericCompileContext) {
	bad := func(field, message string) {
		ctx.collector.addError(model.GenericErrUnknownRef, path+field, message, op.ProcessKey)
	}
	listener, ability := ctx.currentListener, ctx.currentAbility
	if owner < 0 || owner >= len(ctx.session.Providers) || ctx.currentProcess != nil || ability == nil || ability.Kind != "passive_listener" || listener == nil ||
		!matcherAllContains(listener.EventMatcher, model.EventTypeSkillHit) || !matcherAllContains(listener.EventMatcher, "event/source_owner") ||
		listener.AbilityRef != "" || ability.ProcessControl != nil || ability.Cost != nil || ability.Cooldown != nil || ability.TickSpec != nil || ability.CastCondition != nil {
		bad(".operation", "passive process start requires only an owned inline SKILL_HIT passive listener")
	}
	if op.Target != model.SelectorSelf || op.ProcessKey == "" {
		bad(".target", "passive process start targets self and requires its own processKey")
	}
	if op.Amount != nil || op.ValuePolicy != "" || op.DamageType != "" || op.ResourceKey != "" || op.AttributeKey != "" || op.AbilityRef != "" || op.ShieldRef != "" || op.ProviderDefinitionRef != "" || op.ProviderRef != "" || op.EventType != "" || len(op.Payload)+len(op.Types)+len(op.Tags) != 0 || op.CopyableOnHit || op.CritEligible || op.SkillHit != nil || op.TargetMark != nil || op.OutputRef != "" || op.ProviderRefFromEvent || op.ShieldDurationMs != nil || op.RepeatCount != 0 || op.RepeatScope != "" || op.RepeatDelayMs != 0 || op.TriggerStateKey != "" || op.Threshold != 0 {
		bad(".operation", "passive process start cannot mix another operation payload")
	}
	index := -1
	if owner >= 0 && owner < len(ctx.session.Providers) {
		for i := range ctx.session.Providers[owner].Processes {
			p := &ctx.session.Providers[owner].Processes[i]
			if p.ProcessKey == op.ProcessKey {
				index = i
				if p.EntryKind != model.ProcessEntrySkillHitPassive || ability == nil || p.SkillKey != ability.SkillKey {
					bad(".processKey", "passive start must reference its own passive process and skill")
				}
			}
		}
	}
	// Abilities compile before process definitions; resolve to the declared provider process.
	if index < 0 && owner >= 0 && owner < len(ctx.session.Providers) {
		for _, provider := range ctx.sourceProviders {
			if provider.ProviderKey != ctx.session.Providers[owner].ProviderKey {
				continue
			}
			for i, p := range provider.Processes {
				if p.ProcessKey != op.ProcessKey {
					continue
				}
				index = i
				if p.EntryKind != model.ProcessEntrySkillHitPassive || ability == nil || p.SkillKey != ability.SkillKey {
					bad(".processKey", "passive start must reference its own passive process and skill")
				}
			}
		}
	}
	if index < 0 {
		bad(".processKey", "passive start process not found on its own provider")
	}
	compiled := plan.CompiledOperation{Operation: op.Operation, Target: op.Target, Ref: op.Ref, Path: path, OwnerProviderIndex: owner, PassiveProcessIndex: index}
	if op.Condition != nil {
		instr := formula.CompileGenericFormula(*op.Condition, path+".condition", ctx.namedFormulas, map[string]bool{}, ctx.collector.addError)
		compiled.ConditionProgram, compiled.HasCondition = ctx.registerFormula(path+".condition", instr)
	}
	ctx.session.Operations = append(ctx.session.Operations, compiled)
}

func finalizePassiveProcesses(ctx *genericCompileContext) {
	for _, listener := range ctx.session.Listeners {
		if !listener.HasAbilityRef {
			continue
		}
		parsed, valid := plan.ParseAbilityRef(listener.AbilityRef)
		if !valid {
			continue
		}
		for _, actor := range ctx.session.Combatants {
			owner := parsed.Combatant
			if owner == model.SelectorSelf {
				owner = listener.OwnerCombatantKey
			} else if owner == model.SelectorOpponent && listener.OwnerCombatantKey != "" {
				owner = model.SelectorSource
				if listener.OwnerCombatantKey == model.SelectorSource {
					owner = model.SelectorTarget
				}
			}
			if owner != "" && owner != model.SelectorOpponent && owner != actor.Key {
				continue
			}
			ref := actor.Key + ".provider[" + parsed.ProviderRef + "].ability[" + parsed.AbilityKey + "]"
			bound, found := ctx.session.AbilityRefIndex[ref]
			if !found {
				continue
			}
			ability := ctx.session.Abilities[bound.AbilityIndex]
			for _, op := range ctx.session.Operations[int(ability.OperationStart) : int(ability.OperationStart)+int(ability.OperationCount)] {
				if op.Operation == model.OperationKindStartPassiveProcess {
					ctx.collector.addError(model.GenericErrUnknownRef, "listeners."+listener.ListenerKey+".abilityRef", "passive process start cannot be invoked through a listener ability alias", listener.AbilityRef)
				}
			}
		}
	}
	for owner := range ctx.session.Providers {
		provider := &ctx.session.Providers[owner]
		for index, process := range provider.Processes {
			if process.EntryKind != model.ProcessEntrySkillHitPassive {
				continue
			}
			consumed := false
			for _, op := range ctx.session.Operations {
				if op.Operation == model.OperationKindStartPassiveProcess && op.OwnerProviderIndex == owner && op.PassiveProcessIndex == index {
					consumed = true
				}
			}
			if !consumed {
				ctx.collector.addError(model.GenericErrUnknownRef, process.Path, "passive process requires a real owned SKILL_HIT listener start", process.ProcessKey)
			}
		}
	}
}
