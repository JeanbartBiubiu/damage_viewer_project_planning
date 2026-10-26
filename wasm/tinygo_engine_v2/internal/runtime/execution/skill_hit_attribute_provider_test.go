package execution

import (
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func hitFlatProvider(name, attribute string, value float64) model.ProviderDefinition {
	return model.ProviderDefinition{ProviderKey: name, StableID: name, Kind: "status",
		Lifecycle: &model.ProviderLifecycle{DurationMs: hitConstAmt(2000), MaxStacks: 1, RefreshPolicy: model.RefreshPolicyReplace, InstanceScope: model.InstanceScopeSourceTarget},
		Modifiers: []model.ModifierDefinition{{ModifierKey: "flat", Kind: "attribute", Target: "self.attr." + attribute, ValuePolicy: "add", Value: hitConst(value)}},
	}
}

func TestSkillHitFiniteTargetAttributeRejectsMissingActualTargetSlot(t *testing.T) {
	for _, missingAtCompile := range []bool{false, true} {
		c, r := hitFlatFixture(t, "flat", 1999, false)
		c.SharedProviders[0].Abilities[0].Operations[0].SkillHit.Candidates = c.SharedProviders[0].Abilities[0].Operations[0].SkillHit.Candidates[1:2]
		if missingAtCompile {
			delete(c.Combatants[1].Attributes, "magic_resist")
		}
		delete(r.InitialSnapshot.Combatants[1].Attributes, "magic_resist")
		result := compile.CompileGeneric(c)
		if !result.OK {
			t.Fatal(result.Result.Errors)
		}
		if c.Combatants[0].Attributes["magic_resist"].Resolved != 0 {
			t.Fatal("source zero slot must remain present")
		}
		if _, issue := runForTest(result.Session, r); issue == nil || issue.Code != model.GenericErrMissingRequiredField || issue.Ref != "magic_resist" {
			t.Fatalf("missing actual target slot was silently skipped, compileMissing=%v issue=%+v", missingAtCompile, issue)
		}
		state := frameCommitState(t, c, r)
		before := state.combatants["target"].instances.Providers().Len()
		if issue := state.runLoop(); issue == nil || state.combatants["target"].instances.Providers().Len() != before || state.combatants["target"].attributesView().At("armor").Resolved != 100 {
			t.Fatal("missing slot committed part of its candidate", issue)
		}
	}
	c, r := hitFlatFixture(t, "zero", 100, false)
	value := model.AttributeSlotDef{}
	c.Combatants[1].Attributes["magic_resist"], r.InitialSnapshot.Combatants[1].Attributes["magic_resist"] = value, value
	if done := runSkillHit(t, c, r); snapshotAttribute(t, done, "target", "magic_resist") != -20 {
		t.Fatal("an explicit zero slot is valid")
	}
}

func hitFlatCandidate(name string) model.SkillHitCandidate {
	return model.SkillHitCandidate{CandidateKey: name, EffectOccurrenceKey: name, EffectKey: name, ResultKey: "flat",
		Semantic:   model.SkillHitSemantic{ResultType: model.SkillHitResultAttributeChange, Target: model.SkillHitTargetTARGET, Moment: model.SkillHitMomentPersistent},
		Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: name}},
	}
}

func hitFlatFixture(t *testing.T, prefix string, duration int64, refresh bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	entries := []model.DriverEntry{hitEntry("first", 0, 0)}
	facts := []model.SkillHitFact{{DriverEntryKey: "first", UseRef: hitUse("first_use")}}
	uses := []model.SkillUseFact{{UseKey: "first_use", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}}
	if refresh {
		entries = append(entries, hitEntry("second", 1000, 0))
		facts = append(facts, model.SkillHitFact{DriverEntryKey: "second", UseRef: hitUse("second_use")})
		uses = append(uses, model.SkillUseFact{UseKey: "second_use", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete})
	}
	providers := []model.ProviderDefinition{hitFlatProvider(prefix+"_armor", "armor", -50), hitFlatProvider(prefix+"_magic", "magic_resist", -20)}
	c, r := withSkillHit(t, []model.SkillHitCandidate{hitFlatCandidate(providers[0].ProviderKey), hitFlatCandidate(providers[1].ProviderKey), damageCand("full", "full_hit", "full_damage", "", 0)}, providers, nil, entries, uses, facts, duration)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "armor", Domain: "attribute"})
	formuladefinition.SetDamageFormula(&c, "damage/physical", formuladefinition.ResistanceDefense("armor"))
	for _, key := range []string{"armor", "magic_resist"} {
		value := model.AttributeSlotDef{Base: 100, Current: 100, Max: 100, Resolved: 100}
		c.Combatants[1].Attributes[key], r.InitialSnapshot.Combatants[1].Attributes[key] = value, value
	}
	return c, r
}

func snapshotAttribute(t *testing.T, done model.DoneResult, owner, key string) float64 {
	t.Helper()
	for _, combatant := range done.FinalSnapshot.Combatants {
		if combatant.Key == owner {
			return combatant.Attributes[key].Resolved
		}
	}
	t.Fatal("missing combatant", owner)
	return 0
}
