package execution

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestParticipationLinkedShieldFactsUseActualBorrowedProvider(t *testing.T) {
	condition := model.GenericFormulaExpr{Op: "read", Path: "provider.linked_shield[participation_guard].present"}
	control := stunCand("control", "hit", "control", "SKILL")
	control.ParticipationProviderRef, control.ParticipationCondition = "passive_mount", &condition
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("damage", "hit", "damage", "SKILL", 0), control}, []model.ProviderDefinition{stunProvider()}, nil,
		[]model.DriverEntry{{EntryKey: "hit", AbilityRef: skillHitAbilityRef(), Source: "source", Target: "target", FirstAtMs: 10}},
		[]model.SkillUseFact{{UseKey: "cast", Source: "source", SkillKey: "author:q", HistoryState: "complete"}},
		[]model.SkillHitFact{{DriverEntryKey: "hit", UseRef: hitUse("cast"), Sequence: seqN(1)}}, 10)
	passive := model.ProviderDefinition{ProviderKey: "passive", Kind: "character", StableID: "passive",
		Abilities: []model.AbilityDefinition{{AbilityKey: "guard", Kind: "active", Operations: []model.OperationDefinition{
			{Operation: "shield", Target: "self", ShieldRef: "participation_guard", ShieldLifecycleProviderDefinitionRef: "guard_lifetime", Amount: hitExprPtr(20), ShieldDurationMs: hitExprPtr(100)},
		}}}}
	c.SharedProviders = append(c.SharedProviders, passive, model.ProviderDefinition{ProviderKey: "guard_lifetime", Kind: "buff", StableID: "guard_lifetime", LinkedShieldDefinitionRef: "participation_guard"})
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "passive_mount", DefinitionRef: passive.ProviderKey})
	r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "passive_mount", DefinitionRef: passive.ProviderKey, Source: "source", Owner: "source", Stacks: 1})
	state := frameCommitState(t, c, r)
	var ability, guard planbundle.CompiledAbility
	var candidate planbundle.CompiledSkillHitCandidate
	for _, compiled := range state.compiled.Abilities {
		if compiled.AbilityKey == "guard" {
			guard = compiled
		}
		for index := int(compiled.OperationStart); index < int(compiled.OperationStart)+int(compiled.OperationCount); index++ {
			if hit := state.compiled.Operations[index].SkillHit; hit != nil {
				for _, row := range hit.Candidates {
					if row.ParticipationProviderRef == "passive_mount" {
						ability, candidate = compiled, row
					}
				}
			}
		}
	}
	if !candidate.HasParticipation || guard.OperationCount != 1 {
		t.Fatal("missing real compiled participation or shield creator")
	}
	definition := candidate.ParticipationProviderDefinitions[0]
	for _, want := range []float64{0, 1} {
		if want == 1 {
			apply := state.newExecutionFrame("source", "source", "guard")
			apply.ownerCombatantKey, apply.ownerProviderRef = "source", "passive_mount"
			if err := apply.executeOperations(guard, state.compiled.Operations[int(guard.OperationStart):int(guard.OperationStart)+int(guard.OperationCount)]); err != nil {
				t.Fatal(err)
			}
			apply.commit()
			if apply.fatal {
				t.Fatal(apply.fatalErr)
			}
		}
		frame := state.newExecutionFrame("source", "target", "participation")
		frame.ownerCombatantKey, frame.ownerProviderRef = "source", "original_action"
		value, active, err := (*hitFrameHost)(frame).HitParticipation(candidate.ParticipationProgram, ability, "passive_mount", definition)
		if err != nil || !active || value != want {
			t.Fatal("participation lost the actual provider's linked shield fact", want, value, active, err)
		}
		if frame.ownerProviderRef != "original_action" {
			t.Fatal("participation did not restore the original owning context")
		}
	}
	frame := state.newExecutionFrame("source", "target", "inactive")
	if _, active, err := (*hitFrameHost)(frame).HitParticipation(candidate.ParticipationProgram, ability, "missing_mount", definition); active || err != nil {
		t.Fatal("missing actual mount still evaluated participation", active, err)
	}
}

func hitExprPtr(value float64) *model.GenericFormulaExpr {
	expression := hitConst(value)
	return &expression
}
