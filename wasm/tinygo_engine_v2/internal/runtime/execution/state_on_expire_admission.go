package execution

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/execution/admission"
)

func (s *Engine) initStateOnExpireSources() *model.EngineError {
	if !s.compiled.HasStateOnExpire {
		return nil
	}
	for _, actor := range s.compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			provider := s.compiled.Providers[mount.DefinitionIndex]
			if provider.HasStateOnExpire {
				if err := s.validateStateOnExpireProvider(provider, actor.Key, mount.ProviderRef); err != nil {
					return err
				}
			}
		}
	}
	for _, entry := range s.req.DriverPlan.Entries {
		source, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
		target, _ := s.resolveDriverCombatantKey(entry.Target, source)
		if ref, exists := s.compiled.AbilityRefIndex[normalizeAbilityRef(entry.AbilityRef, source, target)]; exists && s.compiled.Providers[s.compiled.Abilities[ref.AbilityIndex].ProviderIndex].HasStateOnExpire {
			return s.basicAttackErr("state expiry source abilities can only run through their actual initialization or received-damage listeners", "driverPlan.entries")
		}
	}
	return nil
}

func (s *Engine) ownLinkedShieldInitialization(listener plan.CompiledListener) bool {
	return admission.OwnLinkedShieldInitialization(s.compiled, listener)
}

func (s *Engine) validateStateOnExpireProvider(provider plan.CompiledProvider, owner, ref string) *model.EngineError {
	if err := admission.ValidateStateOnExpireDefinition(s.admissionInput(owner), provider); err != nil {
		return err
	}
	fail := func() *model.EngineError {
		return s.basicAttackErr("state expiry source requires complete permanent own shield initialization and damage-driven state writes", "initialSnapshot.combatants.providers")
	}
	initializers := 0
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey != owner || listener.OwnerProviderRef != ref {
			continue
		}
		if s.ownLinkedShieldInitialization(listener) {
			initializers++
			continue
		}
		damage, declared := s.compiled.RuntimeTypes.DamageTaken.Lookup()
		receiver, receiverDeclared := s.compiled.RuntimeTypes.TargetOwner.Lookup()
		if !declared || !receiverDeclared || !listener.EventMatcher.RequiresAllType(damage) || !listener.EventMatcher.RequiresAllType(receiver) || !listener.HasCondition || listener.HasOncePerUse {
			return fail()
		}
		if err := s.validateEquipmentHitListener(listener); err != nil {
			return err
		}
		for _, operation := range s.compiled.Operations[int(listener.OperationStart) : int(listener.OperationStart)+int(listener.OperationCount)] {
			field := provider.StateFields[operation.Ref]
			amount, static := s.formulas.FoldStatic(operation.AmountProgram)
			if operation.Operation != "state_change" || operation.StateScope != stateScopeProvider || operation.Target != "self" || field.OnExpireCount == 0 || !static || amount != 1 || (operation.ValuePolicy != "set" && operation.ValuePolicy != "override") {
				return fail()
			}
		}
	}
	if initializers != 1 {
		return fail()
	}
	return nil
}
