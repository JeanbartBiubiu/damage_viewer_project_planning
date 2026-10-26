package execution

import (
	"sort"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func (state *Engine) actionOccupied(owner string) bool { return state.actions.Occupied(owner) }
func (state *Engine) actionReadyAt(owner string) int64 {
	return state.actions.ReadyAt(owner, state.loop.TimeMs())
}
func (frame *Frame) prepareActionWait() *model.EngineError {
	if frame.pendingProcess == nil {
		return nil
	}
	if !frame.processChanges.ReconcileOccupancy(frame.processOriginal, frame.run.loop.TimeMs()) {
		return frame.run.processErr("processInstances.actionOccupancies", "action release requires its real active interval", frame.pendingProcess.UseKey())
	}
	attack := frame.run.actions.BasicAttack()
	if attack == nil {
		return nil
	}
	before, after := frame.processOriginal.OccupiesAction(attack.Plan().Source), frame.pendingProcess.OccupiesAction(attack.Plan().Source)
	frame.pendingActionWait = before != after || (before && frame.processOriginal.ActionDeadline() != frame.pendingProcess.ActionDeadline())
	return nil
}
func (state *Engine) actionContribution(start, end int64) *int64 {
	if state.actions.BasicAttack() == nil {
		return nil
	}
	value, present := state.actions.OccupancyContribution(state.actions.BasicAttack().Plan().Source, start, end)
	if !present {
		return nil
	}
	return &value
}
func (state *Engine) refreshActionContributions() {
	if state.actions.BasicAttack() == nil {
		return
	}
	starts := []int64{}
	for slot := 0; slot < state.actions.ProcessCount(); slot++ {
		process := state.actions.ProcessAt(slot)
		if process.AbilityRef() == state.actions.BasicAttack().Plan().InitialControlAbilityRef && process.Owner() == state.actions.BasicAttack().Plan().Source {
			starts = append(starts, process.StartedAtMs())
		}
	}
	sort.Slice(starts, func(i, j int) bool { return starts[i] < starts[j] })
	first := state.loop.TimeMs() + 1
	if len(starts) > 0 {
		first = starts[0]
	}
	state.actions.SetInitialActionReady(state.actionContribution(0, first))
	for index := 0; index < state.report.AttackRecordCount(); index++ {
		startedAt, _ := state.report.AttackStartAt(index)
		next := state.loop.TimeMs() + 1
		for _, start := range starts {
			if start > startedAt {
				next = start
				break
			}
		}
		state.report.SetAttackActionReadyAt(index, state.actionContribution(startedAt, next))
	}
}
func (frame *Frame) validatePlannedProcessDeadline() *model.EngineError {
	process := frame.pendingProcess
	if process == nil || frame.run.actions.ActionForUse(process.UseKey()) == nil {
		return nil
	}
	if process.AdvanceAtMs() > maxJSONSafeInteger || process.HasExpiry() && process.Expiry() > maxJSONSafeInteger {
		return frame.run.basicAttackErr("planned process requires a safe real step deadline", "processInstances.advanceAtMs")
	}
	if process.HasNextExecution() && process.NextExecutionAt() > maxJSONSafeInteger {
		return frame.run.basicAttackErr("planned segment requires a safe real execution deadline", "processInstances.repeat.nextExecutionAtMs")
	}
	if staged := frame.staged.Get(process.Owner()); staged != nil && staged.cooldowns.AbilityReadyAt(process.Owner(), process.AbilityRef()) > maxJSONSafeInteger {
		return frame.run.basicAttackErr("planned cooldown requires a safe actual deadline", "processInstances.cooldown")
	}
	return nil
}
func (state *Engine) freezeActionDeaths() {
	if !state.automatedRun() {
		return
	}
	for _, owner := range []string{model.SelectorSource, model.SelectorTarget} {
		if state.combatantHasHp(owner) && state.combatantHp(owner) <= 0 {
			state.actions.MarkDead(owner)
		}
	}
}

func (state *Engine) plannedSkillProvider(owner, provider string) bool {
	for _, action := range state.plannedSkillSources() {
		if action.Binding().Source == owner && action.Binding().ProviderRef == provider {
			return true
		}
	}
	return false
}

func (state *Engine) plannedSkillOperation(providerIndex int) bool {
	if providerIndex < 0 || providerIndex >= len(state.compiled.Providers) {
		return false
	}
	definition := state.compiled.Providers[providerIndex].ProviderKey
	for _, action := range state.plannedSkillSources() {
		if action.Binding().ProviderDefinitionRef == definition {
			return true
		}
	}
	return false
}

func (state *Engine) validatePlannedSkillProvider(owner, providerRef string, providerIndex uint16) *model.EngineError {
	provider := state.compiled.Providers[providerIndex]
	if provider.Kind != "character" || provider.StableID == "" || len(provider.Processes) != 1 || provider.Lifecycle != nil || provider.AmmoBinding != nil && !validBoundAmmoFields(provider) {
		return state.basicAttackErr("planned source requires its complete single-process character binding", "initialSnapshot.combatants.providers")
	}
	for _, ability := range state.compiled.Abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
		ref := owner + ".provider[" + providerRef + "].ability[" + ability.AbilityKey + "]"
		matched := false
		for _, action := range state.plannedSkillSources() {
			if action.Binding().ProviderRef == providerRef && action.Binding().Source == owner {
				for _, control := range action.Binding().Controls {
					matched = matched || ref == control.AbilityRef
				}
				for _, hit := range action.Binding().HitBindings {
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
		case model.OperationKindConsumeTargetMark:
			if operation.TargetMark == nil || operation.TargetMark.OwnerCombatantKey != owner || operation.TargetMark.OwnerProviderRef != providerRef {
				return state.basicAttackErr("planned mark consumption requires its exact compiled owner", operation.Path)
			}
		case "attribute_change":
			if operation.AttributeKey == "" || operation.AttributeKey == "hp" || operation.ValuePolicy != "add" ||
				(operation.Target != "source" && operation.Target != "self" && operation.Target != "target") ||
				!state.plannedAttributeOperationPosition(provider, index) {
				return state.basicAttackErr("planned attribute change requires an ordinary explicit additive process or instant hit result", operation.Path)
			}
			matched := false
			for _, action := range state.plannedSkillSources() {
				if action.Binding().Source != owner || action.Binding().ProviderRef != providerRef {
					continue
				}
				matched = true
				target, exists := state.resolveCombatantKey(operation.Target, action.Plan().Source(), action.Plan().Target())
				if !exists {
					return state.basicAttackErr("planned attribute change requires its actual action recipient", operation.Path)
				}
				if _, exists := state.combatants[target].attributesView().Lookup(operation.AttributeKey); !exists {
					return state.basicAttackErr("planned attribute change requires an explicit recipient slot", operation.Path+".attributeKey")
				}
			}
			if !matched {
				return state.basicAttackErr("planned attribute change requires its actual action binding", operation.Path)
			}
		case "damage", "heal", "shield", "state_change", "apply_provider", "expire_provider", "refresh_provider", "provider_duration_change", "cooldown_change", "resource_change", model.OperationKindResolveSkillHit, model.OperationKindApplyAttackLink, model.OperationKindApplyHitLink:
		case model.OperationKindStateDurationChange:
			field := provider.StateFields[operation.Ref]
			if operation.StateScope != effectpkg.StateScopeProvider || field.StateKind != model.ProviderStateKindAmmo || field.AmmoRecovery == nil || !field.AmmoRecovery.OneByOne {
				return state.basicAttackErr("planned duration change requires its own one-by-one ammo state", operation.Path)
			}
		default:
			return state.basicAttackErr("planned source operation is outside the finite action subset", operation.Path)
		}
	}
	return nil
}

// 两种输入模式在准入时都校验实际选择来源；运行中的自动使用不伪装成手动指令列表。

func (state *Engine) plannedAttributeOperationPosition(provider planbundle.CompiledProvider, index int) bool {
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

func (state *Engine) plannedSkillSources() []*actionpkg.SkillActionView {
	out := make([]*actionpkg.SkillActionView, 0, state.actions.ManualCount()+state.actions.AutomaticCount())
	if !state.actions.HasAutomatic() {
		for index := 0; index < state.actions.ManualCount(); index++ {
			out = append(out, state.actions.ManualAt(index))
		}
		return out
	}
	for index := 0; index < state.actions.AutomaticCount(); index++ {
		rule := state.actions.AutomaticAt(index)
		out = append(out, actionpkg.NewSkillAction(actionpkg.SkillActionSeed{Binding: rule.Binding(), Plan: model.SkillActionPlan{Source: rule.Binding().Source, Target: rule.Plan().Target()}}))
	}
	return out
}
