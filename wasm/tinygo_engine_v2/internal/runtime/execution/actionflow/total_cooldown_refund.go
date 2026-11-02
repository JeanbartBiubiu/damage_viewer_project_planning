package actionflow

import (
	"math"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// CooldownRefundWork 只借用本操作的真实冷却暂存，不接收帧或发布能力。
type CooldownRefundWork interface {
	// RefundCooldown 在资格核对后取得目标所属的当前冷却暂存。
	RefundCooldown(owner string) *actionpkg.CooldownLedger
	// StageCooldownRefund 暂存已核定的新期限，仍沿原统一提交发布。
	StageCooldownRefund(owner, ref string, ready int64) *model.EngineError
}

func (s SkillActionExecutor) ValidateRefundSnapshot(snapshot model.Snapshot, hasRefund bool) *model.EngineError {
	bad := func(path string) *model.EngineError {
		return s.error("immediate finite periods and total cooldown refunds require a fresh snapshot with no imported cooldown provenance", path)
	}
	if snapshot.TimeMs != 0 || len(snapshot.ProcessInstances) != 0 {
		return bad("initialSnapshot")
	}
	for _, actor := range snapshot.Combatants {
		if hasRefund && len(actor.Cooldowns) != 0 {
			return bad("initialSnapshot.combatants.cooldowns")
		}
		for _, instance := range actor.Providers {
			if s.immediatePeriodic(instance.DefinitionRef) {
				return bad("initialSnapshot.combatants.providers")
			}
		}
	}
	return nil
}

func (s SkillActionExecutor) ValidateImmediatePeriod(operation planbundle.CompiledOperation, process *actionpkg.ProcessView, moment, owner, provider, expectedTarget string, enabled bool) *model.EngineError {
	if !enabled || !s.immediatePeriodic(operation.ProviderDefinitionRef) {
		return nil
	}
	if process == nil || moment != "PROCESS_START" || operation.OwnerProviderIndex != int(process.Ability().ProviderIndex) || operation.Target != model.SelectorSelf || owner != process.Owner() || provider != process.ProviderRef() || process.Target() != expectedTarget || !s.PlannedProvider(process.Owner(), process.ProviderRef()) {
		err := s.error("immediate finite period requires its actual planned source process start", operation.Path)
		err.Ref = operation.ProviderDefinitionRef
		return err
	}
	return nil
}

func (s SkillActionExecutor) BindImmediatePeriod(owner, source, definition, use string, now int64, instances effectpkg.ProviderList) (effectpkg.Provider, int, bool) {
	if !s.immediatePeriodic(definition) {
		return effectpkg.Provider{}, 0, false
	}
	for index := 0; index < instances.Len(); index++ {
		instance := instances.At(index)
		if instance.DefinitionRef == definition && instance.Source == source && instance.Owner == owner && !instance.Expired(now) {
			instance.ActivationUseRef = use
			return instance, index, true
		}
	}
	return effectpkg.Provider{}, 0, false
}

func (s SkillActionExecutor) ApplyTotalCooldownRefund(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, mounted bool, event *contract.EventSnapshot, owner string, now int64, work CooldownRefundWork) *model.EngineError {
	target := operation.TotalCooldownTarget
	if target == nil || !mounted || event == nil || !event.HasDamageSnapshot || event.EventType != "event/damage_instance" || event.EventSourceKey != owner || target.CombatantKey != owner || int(ability.ProviderIndex) != operation.OwnerProviderIndex {
		err := s.error("total cooldown refund requires its actual owned settled packet and compiled INITIAL target", operation.Path)
		err.Ref = operation.AbilityRefStr
		return err
	}
	id := actionpkg.AbilityCooldownIdentity(target.CombatantKey, operation.AbilityRefStr)
	ledger := work.RefundCooldown(target.CombatantKey)
	if ledger.Remaining(id, now) == 0 {
		return nil
	}
	entry := ledger.EntryValue(id)
	if !entry.HasOrdinaryTotal || entry.OrdinaryTotalMs <= 0 || entry.OrdinaryTotalMs > maxJSONSafeInteger {
		err := s.error("active ordinary cooldown has no real committed total duration", operation.Path)
		err.Ref = operation.AbilityRefStr
		return err
	}
	refund := math.Round(float64(entry.OrdinaryTotalMs) * operation.TotalCooldownRatio)
	if math.IsNaN(refund) || math.IsInf(refund, 0) || refund < 0 || refund > float64(maxJSONSafeInteger) {
		err := s.error("total cooldown refund is not finite nonnegative safe milliseconds", operation.Path)
		err.Ref = operation.AbilityRefStr
		return err
	}
	if refund == 0 {
		return nil
	}
	ready := entry.ReadyAt - int64(refund)
	if ready < now {
		ready = now
	}
	return work.StageCooldownRefund(target.CombatantKey, operation.AbilityRefStr, ready)
}

func (s SkillActionExecutor) immediatePeriodic(definition string) bool {
	for _, provider := range s.providers {
		if provider.ProviderKey != definition {
			continue
		}
		for index := provider.AbilityStart; index < provider.AbilityStart+provider.AbilityCount; index++ {
			ability := s.abilities[index]
			if ability.Kind == "tick" {
				return ability.TickSpec != nil && ability.TickSpec.ImmediateFirst
			}
		}
	}
	return false
}
