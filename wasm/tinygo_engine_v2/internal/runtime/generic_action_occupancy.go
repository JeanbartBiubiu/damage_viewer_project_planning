package runtime

import "tinygo_engine_v2/internal/model"

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
		if processOccupiesAction(process, owner) && process.AdvanceAtMs > ready {
			ready = process.AdvanceAtMs
		}
	}
	return ready
}

func (frame *executionFrame) prepareActionWait() *model.EngineError {
	attack := frame.run.basicAttack
	if attack == nil || frame.pendingProcess == nil {
		return nil
	}
	before, after := processOccupiesAction(frame.processOriginal, attack.plan.Source), processOccupiesAction(frame.pendingProcess, attack.plan.Source)
	frame.pendingActionWait = before != after || (before && frame.processOriginal.AdvanceAtMs != frame.pendingProcess.AdvanceAtMs)
	return nil
}

func (frame *executionFrame) validatePlannedProcessDeadline() *model.EngineError {
	process := frame.pendingProcess
	if process == nil || frame.run.skillActionByUse[process.UseKey] == nil {
		return nil
	}
	if process.AdvanceAtMs > maxJSONSafeInteger || (process.ExpiresAtMs != nil && *process.ExpiresAtMs > maxJSONSafeInteger) {
		return frame.run.basicAttackErr("planned process requires a safe real step deadline", "processInstances.advanceAtMs")
	}
	if staged := frame.staged[process.Owner]; staged != nil && staged.cooldowns[process.abilityRef] > maxJSONSafeInteger {
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
				matched = ref == action.binding.Controls[0].AbilityRef || (len(action.binding.HitBindings) == 1 && ref == action.binding.HitBindings[0].HitAbilityRef)
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
		started, declared := state.compiled.Types.Registry.Lookup(eventTypeAbilityStarted)
		if declared && listener.EventMatcher.RequiresAllType(started) && !listener.HasAbilityRef && listener.OperationCount > 0 && listener.MaxTriggersPerEvent == 1 {
			continue
		}
		if err := state.validateStaticInitializationListener(listener); err != nil {
			if err := state.validateEquipmentHitListener(listener); err != nil {
				return err
			}
		}
	}
	for _, operation := range state.compiled.Operations {
		if operation.OwnerProviderIndex != int(providerIndex) {
			continue
		}
		switch operation.Operation {
		case "damage", "heal", "shield", "state_change", "apply_provider", "expire_provider", "refresh_provider", "cooldown_change", "resource_change", model.OperationKindResolveSkillHit, model.OperationKindApplyAttackLink, model.OperationKindApplyHitLink:
		default:
			return state.basicAttackErr("planned source operation is outside the finite action subset", operation.Path)
		}
	}
	return nil
}
