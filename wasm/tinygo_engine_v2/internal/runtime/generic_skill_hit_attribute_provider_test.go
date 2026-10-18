package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
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
		if _, issue := RunGeneric(result.Session, r); issue == nil || issue.Code != model.GenericErrMissingRequiredField || issue.Ref != "magic_resist" {
			t.Fatalf("missing actual target slot was silently skipped, compileMissing=%v issue=%+v", missingAtCompile, issue)
		}
		state := frameCommitState(t, c, r)
		before := len(state.combatants["target"].providers)
		if issue := state.runLoop(); issue == nil || len(state.combatants["target"].providers) != before || state.combatants["target"].attributes.At("armor").Resolved != 100 {
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

func TestSkillHitFiniteTargetAttributeAppliesBeforeDamageAndExpires(t *testing.T) {
	for _, prefix := range []string{"quartz", "amber"} {
		for _, end := range []int64{0, 1999, 2000} {
			c, r := hitFlatFixture(t, prefix, end, false)
			done := runSkillHit(t, c, r)
			if math.Abs(done.Summary.SourceDamageDealt-100.0*100.0/150.0) > 1e-9 {
				t.Fatalf("damage did not read the committed full reduction: %+v", done.Summary)
			}
			armor, magic := 50.0, 80.0
			if end >= 2000 {
				armor, magic = 100, 100
			}
			if snapshotAttribute(t, done, "target", "armor") != armor || snapshotAttribute(t, done, "target", "magic_resist") != magic || snapshotAttribute(t, done, "source", "armor") != 0 {
				t.Fatalf("wrong recipient or expiry prefix=%s at=%d snapshot=%+v", prefix, end, done.FinalSnapshot)
			}
		}
	}
}

func TestSkillHitFiniteTargetAttributeRefreshReplacesWithoutStackOrOldExpiry(t *testing.T) {
	for _, end := range []int64{1999, 2000, 2999, 3000} {
		c, r := hitFlatFixture(t, "flat", end, true)
		done := runSkillHit(t, c, r)
		if math.Abs(done.Summary.SourceDamageDealt-2.0*100.0*100.0/150.0) > 1e-9 {
			t.Fatal("refresh stacked or lost the reduction", done.Summary)
		}
		armor := 50.0
		if end == 3000 {
			armor = 100
		}
		if snapshotAttribute(t, done, "target", "armor") != armor {
			t.Fatalf("old expiration removed refreshed instance at %d: %+v", end, done.FinalSnapshot)
		}
		count := 0
		for _, provider := range done.FinalSnapshot.Combatants[1].Providers {
			if provider.DefinitionRef == "flat_armor" {
				count++
			}
		}
		if end < 3000 && count != 1 || end == 3000 && count != 0 {
			t.Fatalf("unexpected active instance count=%d at=%d", count, end)
		}
	}
}

func TestSkillHitFiniteTargetAttributeUnselectedAndRecordingDoNotInventEffects(t *testing.T) {
	c, r := hitFlatFixture(t, "flat", 1999, false)
	for index := range c.SharedProviders[0].Abilities[0].Operations[0].SkillHit.Candidates {
		c.SharedProviders[0].Abilities[0].Operations[0].SkillHit.Candidates[index].ParticipationCondition = hitConstAmt(0)
	}
	done := runSkillHit(t, c, r)
	if done.Summary.SourceDamageDealt != 0 || snapshotAttribute(t, done, "target", "armor") != 100 {
		t.Fatal("unselected hit changed attributes or HP", done.Summary)
	}
	c, r = hitFlatFixture(t, "flat", 1999, false)
	full := runSkillHit(t, c, r)
	r.OutputMode = model.RunOutputSummary
	summary := runSkillHit(t, c, r)
	if full.Summary.SourceDamageDealt != summary.Summary.SourceDamageDealt || full.Summary.TargetFinalHp != summary.Summary.TargetFinalHp {
		t.Fatal("summary changed persistent result")
	}
}
