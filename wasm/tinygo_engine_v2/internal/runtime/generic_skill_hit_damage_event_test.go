package runtime

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
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

func TestRootSkillHitCandidateDamageEventsKeepParentIdentityAndDoNotRecurse(t *testing.T) {
	for _, basic := range []bool{false, true} {
		t.Run(map[bool]string{false: "skill", true: "basic"}[basic], func(t *testing.T) {
			c, r := rootCandidateDamageFixture(t, basic)
			c.SharedProviders[0].Listeners = []model.ListenerDefinition{
				{ListenerKey: "per_result", EventMatcher: model.TypeMatcher{All: []string{eventTypeDamageDealt}}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: hitConstAmt(5), Ref: "listener_damage"}}},
				{ListenerKey: "observe_result", EventMatcher: model.TypeMatcher{All: []string{eventTypeDamageDealt}}, Operations: []model.OperationDefinition{{Operation: "emit_event", Target: "target", EventType: "event/candidate_probe"}}},
			}
			done := runSkillHit(t, c, r)
			events := damageDealtEmittedEvidence(done)
			if len(events) != 2 || done.Summary.SourceDamageDealt != 82 {
				t.Fatalf("events=%d summary=%+v", len(events), done.Summary)
			}
			for index, event := range events {
				want := []float64{60, 12}[index]
				if event.Data["rawAmount"] != want || event.Data["mitigatedAmount"] != want || event.Data["abilityRef"] != skillHitAbilityRef() || event.Data["operationRef"] != []string{"op-first", "op-second"}[index] || event.Data["useRef"] != "parent_use" || event.Data["skillKey"] != "author:q" || event.Data["phantom"] != false {
					t.Fatalf("event=%+v", event.Data)
				}
			}
			if events[0].Data["castInstanceId"] == nil || events[0].Data["castInstanceId"] != events[1].Data["castInstanceId"] {
				t.Fatalf("parent cast mismatch: %+v", events)
			}
			if len(emittedEventsByRef(done, "event/candidate_probe")) != 2 {
				t.Fatal("derived result listener count differs from actual positive candidates")
			}
			kind := model.EventTypeSkillHit
			if basic {
				kind = model.EventTypeBasicAttackHit
			}
			if len(emittedEventsByRef(done, kind)) != 1 {
				t.Fatal("a result contribution created another parent hit")
			}
		})
	}
}

func TestRootSkillHitCandidateDamageEventsAbsentForUndeclaredZeroAndUnselected(t *testing.T) {
	for _, variant := range []string{"undeclared", "zero", "unselected"} {
		t.Run(variant, func(t *testing.T) {
			c, r := rootCandidateDamageFixture(t, true)
			candidates := c.SharedProviders[0].Abilities[0].Operations[0].SkillHit.Candidates
			switch variant {
			case "undeclared":
				types := c.TypeCatalog.Types[:0]
				for _, row := range c.TypeCatalog.Types {
					if row.Key != eventTypeDamageDealt {
						types = append(types, row)
					}
				}
				c.TypeCatalog.Types = types
			case "zero":
				for i := range candidates {
					candidates[i].Operations[0].Amount = hitConstAmt(0)
				}
			case "unselected":
				for i := range candidates {
					candidates[i].ParticipationCondition = hitConstAmt(0)
				}
			}
			if done := runSkillHit(t, c, r); len(damageDealtEmittedEvidence(done)) != 0 {
				t.Fatal("unqualified damage emitted a derived event", done.Evidence)
			}
		})
	}
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
	zero := state.buildDoneResult()
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
	frame.eventCtx = &eventFormulaSnapshot{hasSkillHit: true, skillHit: &frozenSkillHitContext{rootDamageEvent: true}}
	op := state.compiled.Operations[ability.OperationStart]
	if issue := frame.resolveSkillHit(op, ability); issue != nil {
		t.Fatal(issue)
	}
	if len(frame.pendingEvents) != 1 || frame.pendingEvents[0].skillHit.rootDamageEvent {
		t.Fatal("old event context leaked root qualification")
	}
}
