package runtime

import (
	"sort"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func processOccupiesAction(process *processRuntime, owner string) bool {
	return process != nil && process.Owner == owner && process.Status == "active" && process.stepIndex >= 0 && process.stepIndex < len(process.definition.Steps) && process.definition.Steps[process.stepIndex].OccupiesAction
}

func (state *genericRunState) actionOccupied(owner string) bool {
	for _, process := range state.processInstances {
		if processOccupiesAction(process, owner) {
			return true
		}
	}
	return false
}

func (state *genericRunState) actionReadyAt(owner string) int64 {
	ready := state.nowMs
	for _, process := range state.processInstances {
		if processOccupiesAction(process, owner) && processActionDeadline(process) > ready {
			ready = processActionDeadline(process)
		}
	}
	return ready
}

func (frame *executionFrame) prepareActionWait() *model.EngineError {
	attack := frame.run.basicAttack
	if frame.pendingProcess == nil {
		return nil
	}
	previous, pending := frame.processOriginal, frame.pendingProcess
	beforeOwn, afterOwn := processOccupiesAction(previous, pending.Owner), processOccupiesAction(pending, pending.Owner)
	changedStep := previous != nil && previous.StepVersion != pending.StepVersion
	if beforeOwn && (!afterOwn || changedStep) {
		last := len(pending.ActionOccupancies) - 1
		if last < 0 || pending.ActionOccupancies[last].StepVersion != previous.StepVersion || pending.ActionOccupancies[last].FinishedAtMs != nil {
			return frame.run.processErr("processInstances.actionOccupancies", "action release requires its real active interval", pending.UseKey)
		}
		at := frame.run.nowMs
		pending.ActionOccupancies[last].FinishedAtMs = &at
	}
	if afterOwn && (!beforeOwn || changedStep) {
		pending.ActionOccupancies = append(pending.ActionOccupancies, model.ProcessActionOccupancy{StepKey: pending.StepKey, StepVersion: pending.StepVersion, StartedAtMs: pending.StepStartedAtMs, ExpectedEndAtMs: processActionDeadline(pending)})
	}
	if attack == nil {
		return nil
	}
	before, after := processOccupiesAction(frame.processOriginal, attack.plan.Source), processOccupiesAction(frame.pendingProcess, attack.plan.Source)
	frame.pendingActionWait = before != after || (before && processActionDeadline(frame.processOriginal) != processActionDeadline(frame.pendingProcess))
	return nil
}

func processActionDeadline(process *processRuntime) int64 {
	if process.ExpiresAtMs != nil {
		return *process.ExpiresAtMs
	}
	return process.AdvanceAtMs
}

func (state *genericRunState) actionContribution(start, end int64) *int64 {
	if state.basicAttack == nil {
		return nil
	}
	var contribution *int64
	for _, process := range state.processInstances {
		if process.Owner != state.basicAttack.plan.Source {
			continue
		}
		for _, interval := range process.ActionOccupancies {
			if interval.StartedAtMs < start || interval.StartedAtMs >= end {
				continue
			}
			deadline := interval.ExpectedEndAtMs
			if interval.FinishedAtMs != nil {
				deadline = *interval.FinishedAtMs
			}
			if deadline > interval.StartedAtMs && (contribution == nil || deadline > *contribution) {
				at := deadline
				contribution = &at
			}
		}
	}
	return contribution
}

func (state *genericRunState) refreshActionContributions() {
	if state.basicAttack == nil {
		return
	}
	starts := []int64{}
	for _, process := range state.processInstances {
		if process.abilityRef == state.basicAttack.plan.InitialControlAbilityRef && process.Owner == state.basicAttack.plan.Source {
			starts = append(starts, process.StartedAtMs)
		}
	}
	sort.Slice(starts, func(first, second int) bool { return starts[first] < starts[second] })
	first := state.nowMs + 1
	if len(starts) > 0 {
		first = starts[0]
	}
	state.basicAttack.summary.InitialActionReadyAtMs = state.actionContribution(0, first)
	for index := range state.attackRecords {
		record := &state.attackRecords[index]
		next := state.nowMs + 1
		for _, start := range starts {
			if start > record.StartAtMs {
				next = start
				break
			}
		}
		record.ActionReadyAtMs = state.actionContribution(record.StartAtMs, next)
	}
}

func (frame *executionFrame) validatePlannedProcessDeadline() *model.EngineError {
	process := frame.pendingProcess
	if process == nil || frame.run.skillActionByUse[process.UseKey] == nil {
		return nil
	}
	if process.AdvanceAtMs > maxJSONSafeInteger || (process.ExpiresAtMs != nil && *process.ExpiresAtMs > maxJSONSafeInteger) {
		return frame.run.basicAttackErr("planned process requires a safe real step deadline", "processInstances.advanceAtMs")
	}
	if process.Repeat != nil && process.Repeat.NextExecutionAtMs != nil && *process.Repeat.NextExecutionAtMs > maxJSONSafeInteger {
		return frame.run.basicAttackErr("planned segment requires a safe real execution deadline", "processInstances.repeat.nextExecutionAtMs")
	}
	if staged := frame.staged.Get(process.Owner); staged != nil && staged.cooldowns[process.abilityRef] > maxJSONSafeInteger {
		return frame.run.basicAttackErr("planned cooldown requires a safe actual deadline", "processInstances.cooldown")
	}
	return nil
}

func (state *genericRunState) freezeActionDeaths() {
	if !state.automatedRun() {
		return
	}
	for _, owner := range []string{model.SelectorSource, model.SelectorTarget} {
		if state.combatantHasHp(owner) && state.combatantHp(owner) <= 0 {
			if state.actionDeaths == nil {
				state.actionDeaths = map[string]bool{}
			}
			state.actionDeaths[owner] = true
		}
	}
}

func (state *genericRunState) plannedSkillProvider(owner, provider string) bool {
	for _, action := range state.skillActions {
		if action.binding.Source == owner && action.binding.ProviderRef == provider {
			return true
		}
	}
	return false
}

func (state *genericRunState) plannedSkillOperation(providerIndex int) bool {
	if providerIndex < 0 || providerIndex >= len(state.compiled.Providers) {
		return false
	}
	definition := state.compiled.Providers[providerIndex].ProviderKey
	for _, action := range state.skillActions {
		if action.binding.ProviderDefinitionRef == definition {
			return true
		}
	}
	return false
}

func (state *genericRunState) validatePlannedSkillProvider(owner, providerRef string, providerIndex uint16) *model.EngineError {
	provider := state.compiled.Providers[providerIndex]
	if provider.Kind != "character" || provider.StableID == "" || len(provider.Processes) != 1 || provider.Lifecycle != nil || provider.AmmoBinding != nil {
		return state.basicAttackErr("planned source requires its complete single-process character binding", "initialSnapshot.combatants.providers")
	}
	for _, ability := range state.compiled.Abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
		ref := owner + ".provider[" + providerRef + "].ability[" + ability.AbilityKey + "]"
		matched := false
		for _, action := range state.skillActions {
			if action.binding.ProviderRef == providerRef && action.binding.Source == owner {
				for _, control := range action.binding.Controls {
					matched = matched || ref == control.AbilityRef
				}
				for _, hit := range action.binding.HitBindings {
					matched = matched || ref == hit.HitAbilityRef
				}
				if matched {
					break
				}
			}
		}
		if !matched && (ability.Kind != "passive_listener" || ability.ProcessControl != nil || ability.Cooldown != nil || ability.Cost != nil || ability.TickSpec != nil || ability.HasSkillHit) {
			return state.basicAttackErr("unbound active ability in planned source", ref)
		}
	}
	for _, listener := range state.compiled.Listeners {
		if listener.OwnerCombatantKey != owner || listener.OwnerProviderRef != providerRef {
			continue
		}
		started, declared := state.compiled.RuntimeTypes.AbilityStarted.Lookup()
		if declared && listener.EventMatcher.RequiresAllType(started) && !listener.HasAbilityRef && listener.OperationCount > 0 && listener.MaxTriggersPerEvent == 1 {
			continue
		}
		if err := state.validateStaticInitializationListener(listener); err != nil {
			if err := state.validateEquipmentHitListener(listener); err != nil {
				return err
			}
		}
	}
	for index, operation := range state.compiled.Operations {
		if operation.OwnerProviderIndex != int(providerIndex) {
			continue
		}
		switch operation.Operation {
		case "attribute_change":
			if operation.AttributeKey == "" || operation.AttributeKey == "hp" || operation.ValuePolicy != "add" ||
				(operation.Target != "source" && operation.Target != "self" && operation.Target != "target") ||
				!state.plannedAttributeOperationPosition(provider, index) {
				return state.basicAttackErr("planned attribute change requires an ordinary explicit additive process or instant hit result", operation.Path)
			}
			matched := false
			for _, action := range state.skillActions {
				if action.binding.Source != owner || action.binding.ProviderRef != providerRef {
					continue
				}
				matched = true
				target, exists := state.resolveCombatantKey(operation.Target, action.plan.Source, action.plan.Target)
				if !exists {
					return state.basicAttackErr("planned attribute change requires its actual action recipient", operation.Path)
				}
				if _, exists := state.combatants[target].attributes.Lookup(operation.AttributeKey); !exists {
					return state.basicAttackErr("planned attribute change requires an explicit recipient slot", operation.Path+".attributeKey")
				}
			}
			if !matched {
				return state.basicAttackErr("planned attribute change requires its actual action binding", operation.Path)
			}
		case "damage", "heal", "shield", "state_change", "apply_provider", "expire_provider", "refresh_provider", "cooldown_change", "resource_change", model.OperationKindResolveSkillHit, model.OperationKindApplyAttackLink, model.OperationKindApplyHitLink:
		default:
			return state.basicAttackErr("planned source operation is outside the finite action subset", operation.Path)
		}
	}
	return nil
}

// 只开放现有过程时点和即时属性命中，不借此扩大监听器操作集合。
func (state *genericRunState) plannedAttributeOperationPosition(provider planbundle.CompiledProvider, index int) bool {
	contains := func(start, count uint16) bool { return index >= int(start) && index < int(start)+int(count) }
	for _, process := range provider.Processes {
		for _, moment := range process.MomentOperations {
			if contains(moment.OperationStart, moment.OperationCount) {
				return true
			}
		}
	}
	for _, ability := range state.compiled.Abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
		for _, operation := range state.compiled.Operations[int(ability.OperationStart) : int(ability.OperationStart)+int(ability.OperationCount)] {
			if operation.SkillHit == nil {
				continue
			}
			for _, candidate := range operation.SkillHit.Candidates {
				if candidate.Semantic.ResultType == model.SkillHitResultAttributeChange && candidate.Semantic.Moment == model.SkillHitMomentInstant && contains(candidate.OperationStart, candidate.OperationCount) {
					return true
				}
			}
		}
	}
	return false
}
