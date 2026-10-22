package compile

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func finalizeDamageStateBefore(ctx *genericCompileContext) {
	s := ctx.session
	allowed := map[formula.GenericProgramID]bool{}
	damage, hasDamage := s.RuntimeTypes.DamageInstance.Lookup()
	ownerType, hasOwner := s.RuntimeTypes.SourceOwner.Lookup()
	for li := range s.Listeners {
		listener := &s.Listeners[li]
		if !listener.HasCondition {
			continue
		}
		for _, read := range s.Formulas.ReadDependencies(listener.ConditionProgram) {
			if read.ReadKind != formula.ReadEventProviderTargetStateBefore {
				continue
			}
			path := "listeners." + listener.ListenerKey + ".condition"
			fail := func(message string) {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path, message, read.ReadKey)
			}
			parent, mounts := -1, 0
			for _, actor := range s.Combatants {
				if actor.Key != listener.OwnerCombatantKey {
					continue
				}
				for _, mount := range actor.ProviderMounts {
					if mount.ProviderRef == listener.OwnerProviderRef {
						parent = int(mount.DefinitionIndex)
					}
				}
				if parent >= 0 {
					for _, mount := range actor.ProviderMounts {
						if int(mount.DefinitionIndex) == parent {
							mounts++
						}
					}
				}
			}
			if !hasDamage || !hasOwner || !listener.EventMatcher.RequiresAllType(damage) || !listener.EventMatcher.RequiresAllType(ownerType) || listener.OwnerProviderRef == "" || parent < 0 || parent >= len(s.Providers) || mounts != 1 || listener.HasAbilityRef {
				fail("damage state before requires an original damage_instance/source_owner condition and its unique actual parent mount")
				continue
			}
			p := s.Providers[parent]
			field, exists := p.StateFields[read.ReadKey]
			if !exists || !ordinaryTargetInteger(field) || field.DefaultValue != 0 || !field.HasCap || !validStateInteger(field.MaxValue) || field.MaxValue < 0 || (p.Kind != "character" && p.Kind != "build") || p.StableID == "" || p.SkillKey == "" || p.Lifecycle != nil {
				fail("damage state before requires its own finite ordinary target integer from a permanent natural skill source")
				continue
			}
			if listener.SourceAbilityIndex >= 0 {
				if listener.SourceAbilityIndex >= len(s.Abilities) {
					fail("damage state before listener lacks its actual ability")
					continue
				}
				a := s.Abilities[listener.SourceAbilityIndex]
				if int(a.ProviderIndex) != parent || a.Kind != "passive_listener" || a.SkillKey != p.SkillKey {
					fail("damage state before listener ability has a foreign parent")
					continue
				}
			}
			valid := int(listener.OperationStart)+int(listener.OperationCount) <= len(s.Operations)
			if valid {
				for _, op := range s.Operations[int(listener.OperationStart) : int(listener.OperationStart)+int(listener.OperationCount)] {
					valid = valid && op.OwnerProviderIndex == parent
				}
			}
			if !valid {
				fail("damage state before listener operations have a foreign owner")
				continue
			}
			found := false
			for _, reader := range s.DamageStateReaders {
				found = found || reader.Owner == listener.OwnerCombatantKey && reader.ProviderRef == listener.OwnerProviderRef && reader.StateKey == read.ReadKey
			}
			if !found {
				if len(s.DamageStateReaders) >= 65536 {
					fail("damage state before reader table exceeds bounded index capacity")
					continue
				}
				s.DamageStateReaders = append(s.DamageStateReaders, plan.CompiledDamageStateReader{Owner: listener.OwnerCombatantKey, ProviderRef: listener.OwnerProviderRef, ProviderIndex: uint16(parent), StateKey: read.ReadKey})
			}
			listener.ReadsDamageStateBefore = true
			s.HasDamageStateBefore = true
			allowed[listener.ConditionProgram] = true
		}
	}
	for i, program := range s.Formulas.Programs {
		for _, read := range s.Formulas.ReadDependencies(formula.GenericProgramID(i)) {
			if read.ReadKind == formula.ReadEventProviderTargetStateBefore && !program.DeclaredNamed && !allowed[formula.GenericProgramID(i)] {
				ctx.collector.addError(model.GenericErrFormulaTypeError, program.Key, "damage state before is only available in an actual owning damage_instance listener condition", read.ReadKey)
			}
		}
		for j, read := range program.Instr {
			if read.Op == formula.GenericOpRead && read.ReadKind == formula.ReadEventProviderTargetStateBefore {
				s.Formulas.Programs[i].Instr[j].ReferenceBound = true
			}
		}
	}
}
