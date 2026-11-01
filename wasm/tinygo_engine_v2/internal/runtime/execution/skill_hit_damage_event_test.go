package execution

import (
	reflect "reflect"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/runtime/contract"
)

func rootCandidateDamageFixture(t *testing.T, basic bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	first, second := damageCand("first", "one", "physical", "", 0), damageCand("second", "two", "other", "", 0)
	first.Operations[0].Amount, second.Operations[0].Amount = hitConstAmt(60), hitConstAmt(12)
	c, r := withSkillHit(t, []model.SkillHitCandidate{first, second}, nil, nil, []model.DriverEntry{hitEntry("hit", 0, 0)},
		[]model.SkillUseFact{{UseKey: "parent_use", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "hit", UseRef: hitUse("parent_use")}}, 10)
	ensureC1CatalogTypes(&c,
		model.TypeCatalogEntry{Key: eventTypeDamageDealt, Domain: "event"},
		model.TypeCatalogEntry{Key: eventTypeDamageDealtBasicAttack, Domain: "event"},
		model.TypeCatalogEntry{Key: model.EventTypeBasicAttackHit, Domain: "event"},
		model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"},
		model.TypeCatalogEntry{Key: "event/candidate_probe", Domain: "event"},
	)
	if basic {
		c.SharedProviders[0].Abilities[0].Types = []string{model.AbilityTypeBasicAttack}
	}
	return c, r
}

func TestRootSkillHitCandidateDamageEventsKeepDepthAndRecordingIndependent(t *testing.T) {
	c, r := rootCandidateDamageFixture(t, false)
	c.SharedProviders[0].Listeners = []model.ListenerDefinition{{ListenerKey: "probe", EventMatcher: model.TypeMatcher{All: []string{eventTypeDamageDealt}}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: hitConstAmt(5)}}}}
	state := frameCommitState(t, c, r)
	state.budget.MaxChainDepth = 1
	if issue := state.runLoop(); issue == nil || issue.BudgetCause != model.BudgetCauseMaxChainDepth {
		t.Fatalf("candidate lowered the real chain depth: %+v", issue)
	}
	full := runSkillHit(t, c, r)
	state = frameCommitState(t, c, r)
	state.budget.MaxEvidenceItems = 0
	if issue := state.runLoop(); issue != nil {
		t.Fatal(issue)
	}
	zero := state.buildDoneResult(false)
	if zero.Summary.SourceDamageDealt != full.Summary.SourceDamageDealt || !reflect.DeepEqual(zero.FinalSnapshot, full.FinalSnapshot) {
		t.Fatal("record limit changed candidate execution")
	}
	r.OutputMode = model.RunOutputSummary
	summary := runSkillHit(t, c, r)
	if summary.Summary.SourceDamageDealt != full.Summary.SourceDamageDealt {
		t.Fatal("summary changed candidate execution")
	}
}

func TestSkillHitOldContextDoesNotGrantRootDamageQualification(t *testing.T) {
	c, r := rootCandidateDamageFixture(t, false)
	state := frameCommitState(t, c, r)
	ability, ref, ok := state.lookupDriverAbility(r.DriverPlan.Entries[0])
	if !ok {
		t.Fatal("ability not found")
	}
	frame := state.newExecutionFrame("source", "target", ref)
	frame.chainDepth = 1
	frame.driverEntryKey = "hit"
	frame.eventCtx = &eventFormulaSnapshot{HasSkillHit: true, SkillHit: &contract.SkillHitFacts{RootDamageEvent: true}}
	op := state.compiled.Operations[ability.OperationStart]
	if issue := frame.resolveSkillHit(op, ability); issue != nil {
		t.Fatal(issue)
	}
	if len(frame.pendingEvents) != 1 || frame.pendingEvents[0].skillHit.View().RootDamageEvent {
		t.Fatal("old event context leaked root qualification")
	}
}
