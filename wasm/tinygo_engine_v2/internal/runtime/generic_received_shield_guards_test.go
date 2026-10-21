package runtime

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	"tinygo_engine_v2/internal/plan"
)

func TestReceivedShieldRejectsIncompleteOrRestoredInitialIdentity(t *testing.T) {
	cases := []struct {
		name   string
		change func(*model.RunRequest)
	}{
		{"missing_parent", func(r *model.RunRequest) {
			r.InitialSnapshot.Combatants[0].Providers = r.InitialSnapshot.Combatants[0].Providers[:1]
		}},
		{"foreign_source", func(r *model.RunRequest) { r.InitialSnapshot.Combatants[0].Providers[1].Source = "target" }},
		{"wrong_owner", func(r *model.RunRequest) { r.InitialSnapshot.Combatants[0].Providers[1].Owner = "target" }},
		{"other_mount", func(r *model.RunRequest) { r.InitialSnapshot.Combatants[0].Providers[1].ProviderRef = "another_parent" }},
		{"duplicate_parent", func(r *model.RunRequest) {
			r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, r.InitialSnapshot.Combatants[0].Providers[1])
		}},
		{"stacked_parent", func(r *model.RunRequest) { r.InitialSnapshot.Combatants[0].Providers[1].Stacks = 2 }},
		{"finite_parent", func(r *model.RunRequest) {
			at := int64(1000)
			r.InitialSnapshot.Combatants[0].Providers[1].ExpireAt = &at
		}},
		{"changed_state", func(r *model.RunRequest) {
			r.InitialSnapshot.Combatants[0].Providers[1].State = map[string]interface{}{"wait": 1}
		}},
		{"resumed_time", func(r *model.RunRequest) { r.InitialSnapshot.TimeMs = 1 }},
		{"restored_child", func(r *model.RunRequest) {
			r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "old_shield_provider", DefinitionRef: "own_guard", Source: "source", Owner: "source", Stacks: 1})
		}},
		{"restored_shield", func(r *model.RunRequest) {
			r.InitialSnapshot.Combatants[0].Shields = []model.CombatantShieldSnapshot{{ShieldRef: "old_shield", DefinitionRef: "own_guard/value", Source: "source", Owner: "source", Remaining: 100}}
		}},
		{"missing_foreign_identity", func(r *model.RunRequest) {
			r.InitialSnapshot.Combatants[0].Shields = []model.CombatantShieldSnapshot{{Owner: "source", Remaining: 100}}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, r := receivedShieldInput(4000, 20)
			compiled := authoringCompile(t, c)
			tc.change(&r)
			if _, err := RunGeneric(compiled, r); err == nil {
				t.Fatal("incomplete or restored identity was accepted")
			}
		})
	}
}

func actualReceivedShieldEvent(t *testing.T, s *genericRunState, f *executionFrame) emittedEvent {
	t.Helper()
	f.commit()
	if f.fatal {
		t.Fatal(f.fatalErr)
	}
	for _, event := range f.pendingEvents {
		if event.eventType == model.EventTypeDamageTaken && event.targetKey == "source" {
			return event
		}
	}
	t.Fatal("real damage did not freeze its received event")
	return emittedEvent{}
}

func actualReceivedShieldReader(s *genericRunState, ev emittedEvent) (*executionFrame, uint16) {
	f := s.newExecutionFrame("source", "target", "listener:restart")
	f.ownerCombatantKey, f.ownerProviderRef = "source", "own_recharge"
	f.eventCtx = cloneEventSnapshot(&ev.snapshot)
	for i, provider := range s.compiled.Providers {
		if provider.HasReceivedShieldBinding {
			return f, uint16(i)
		}
	}
	return f, ^uint16(0)
}

func TestReceivedShieldReadRequiresRealContextAndSurvivesDepletion(t *testing.T) {
	s := receivedShieldInitializedState(t)
	ev := actualReceivedShieldEvent(t, s, receivedDamageFrame(t, s, 100))
	if len(s.combatants["source"].shields) != 0 {
		t.Fatal("test failed to deplete the real shield")
	}
	f, index := actualReceivedShieldReader(s, ev)
	if got, err := f.ReceivedLinkedShieldAbsorbed(index); err != nil || got != 100 {
		t.Fatal("exhausted shield was queried live instead of its immutable receipt", got, err)
	}
	// Every condition shares the same frozen rows. Cloning an event must not
	// allocate/copy a per-listener receipt or erase the completed-empty marker.
	clone := cloneEventSnapshot(&ev.snapshot)
	if clone.shieldAbsorptions != ev.snapshot.shieldAbsorptions {
		t.Fatal("condition snapshot copied the shield receipt")
	}
	zeroEvent := actualReceivedShieldEvent(t, s, receivedDamageFrame(t, s, 0))
	zeroReader, zeroIndex := actualReceivedShieldReader(s, zeroEvent)
	if got, err := zeroReader.ReceivedLinkedShieldAbsorbed(zeroIndex); err != nil || got != 0 {
		t.Fatal("completed empty receipt was confused with missing facts", got, err)
	}
	for _, mode := range []string{"missing_event", "sender_event", "aggregate_event", "missing_damage", "missing_facts", "wrong_event_target", "other_parent", "missing_owner", "unbound_definition", "wrong_lifecycle", "wrong_row_owner", "nonfinite_receipt"} {
		t.Run(mode, func(t *testing.T) {
			frame, bound := actualReceivedShieldReader(s, ev)
			snapshot := *frame.eventCtx.shieldAbsorptions
			snapshot.Rows = append([]pipeline.ShieldAbsorption(nil), snapshot.Rows...)
			frame.eventCtx.shieldAbsorptions = &snapshot
			switch mode {
			case "missing_event":
				frame.eventCtx = nil
			case "sender_event":
				frame.eventCtx.eventType = "event/damage_instance"
			case "aggregate_event":
				frame.eventCtx.eventType = "event/damage_dealt"
			case "missing_damage":
				frame.eventCtx.hasDamageSnapshot = false
			case "missing_facts":
				frame.eventCtx.shieldAbsorptions = nil
			case "wrong_event_target":
				frame.eventCtx.eventTargetKey = "target"
			case "other_parent":
				frame.ownerProviderRef = "attack"
			case "missing_owner":
				frame.ownerCombatantKey = "target"
			case "unbound_definition":
				bound = 0
			case "wrong_lifecycle":
				snapshot.Rows[0].LifecycleIndex = 0
			case "wrong_row_owner":
				snapshot.Rows[0].Owner = "target"
			case "nonfinite_receipt":
				snapshot.Rows[0].Absorbed = math.Inf(1)
			}
			if got, err := frame.ReceivedLinkedShieldAbsorbed(bound); err == nil {
				t.Fatal("invalid context/facts became a numeric zero or live read", mode, got)
			}
		})
	}
}

func TestReceivedShieldListenerFailureRetainsCommittedParentDamage(t *testing.T) {
	for _, mode := range []string{"queue", "formula"} {
		t.Run(mode, func(t *testing.T) {
			s := receivedShieldInitializedState(t)
			f := receivedDamageFrame(t, s, 20)
			ev := actualReceivedShieldEvent(t, s, f)
			before := s.buildDoneResult()
			var listener plan.CompiledListener
			for _, candidate := range s.compiled.Listeners {
				if candidate.ListenerKey == "restart" {
					listener = candidate
				}
			}
			if listener.OperationCount != 1 {
				t.Fatal("missing actual parent listener")
			}
			if mode == "queue" {
				s.heap.SetLimit(s.heap.Len())
			} else {
				bad := formula.GenericProgramID(len(s.formulas.Programs))
				s.formulas.Programs = append(s.formulas.Programs, formula.GenericProgram{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1}, {Op: formula.GenericOpConst, Value: 0}, {Op: formula.GenericOpDiv}}})
				s.compiled.Operations[listener.OperationStart].AmountProgram = bad
			}
			s.currentEventCommands = 0
			if err := s.dispatchListeners(ev, 1); err == nil || mode == "queue" && err.BudgetCause != model.BudgetCauseMaxQueueEvents {
				t.Fatal("failed listener did not stop the run", mode)
			}
			bag := s.combatants["source"].providerState["own_recharge"]
			if bag != nil && (bag.state["wait"] != 0 || bag.expireAt["wait"] != 0 || bag.sourceExpiryFacts["wait"] != (sourceStateExpiryFact{})) {
				t.Fatal("failed child published timer state or callback generation", mode, bag)
			}
			// buildDoneResult is observation-only. The parent receipt and shield
			// reduction survive; none of the child's pending facts can publish.
			afterDone := s.buildDoneResult()
			if !reflect.DeepEqual(before.FinalSnapshot, afterDone.FinalSnapshot) || !reflect.DeepEqual(before.DamageRecords, afterDone.DamageRecords) || !reflect.DeepEqual(before.Evidence, afterDone.Evidence) || afterDone.Summary.SourceHpLoss != before.Summary.SourceHpLoss || ownShieldRemaining(afterDone) != 80 || len(receivedShieldEvents(afterDone, "source")) != 1 || len(receivedRows(t, receivedShieldEvents(afterDone, "source")[0])) != 1 {
				t.Fatal("failed child changed already committed parent facts", mode, afterDone.FinalSnapshot)
			}
		})
	}
}

func TestReceivedShieldParentFailurePublishesNoPartialReceipt(t *testing.T) {
	s := receivedShieldInitializedState(t)
	beforeDone := s.buildDoneResult()
	before, _ := json.Marshal(beforeDone)
	f := receivedDamageFrame(t, s, 20)
	bad := formula.GenericProgramID(len(s.formulas.Programs))
	s.formulas.Programs = append(s.formulas.Programs, formula.GenericProgram{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1}, {Op: formula.GenericOpConst, Value: 0}, {Op: formula.GenericOpDiv}}})
	op := plan.CompiledOperation{Operation: "damage", Target: "target", Ref: "failed_second_packet", DamageType: "damage/physics", HasAmount: true, AmountProgram: bad}
	err := f.executeOperations(plan.CompiledAbility{}, []plan.CompiledOperation{op})
	if err == nil {
		t.Fatal("invalid second amount succeeded")
	}
	f.fatal, f.fatalErr = true, err
	f.commit()
	afterDone := s.buildDoneResult()
	after, _ := json.Marshal(afterDone)
	if string(before) != string(after) || ownShieldRemaining(afterDone) != 100 || len(receivedShieldEvents(afterDone, "source")) != 0 || len(f.pendingEvents) == 0 {
		t.Fatal("failed damage frame exposed a staged first packet or its receipt", afterDone.FinalSnapshot)
	}
}

func TestReceivedShieldOldNoReaderEvidenceAndCopyableMarkerStayUnchanged(t *testing.T) {
	c, r := receivedShieldInput(4000, 120)
	r.StopPolicy.DurationMs = 100
	newDone := authoringRun(t, c, r)
	c.SharedProviders[2].Listeners[1].Condition = authoringAmount(authoringBinary("gt", authoringRead("event.damage.actualHpLoss"), gfConst(0)))
	old := authoringCompile(t, c)
	if old.HasReceivedShieldReads {
		t.Fatal("a health-only listener enabled per-shield collection")
	}
	oldDone, err := RunGeneric(old, r)
	if err != nil || !reflect.DeepEqual(newDone.FinalSnapshot, oldDone.FinalSnapshot) || !reflect.DeepEqual(newDone.Summary, oldDone.Summary) {
		t.Fatal("receipt collection changed old health/shield behavior", err)
	}
	for _, event := range receivedShieldEvents(oldDone, "source") {
		if _, present := event.Data["damageId"]; present {
			t.Fatal("old no-reader event acquired a new identity field", event)
		}
		if _, present := event.Data["shieldAbsorptions"]; present {
			t.Fatal("old no-reader event acquired a per-damage receipt", event)
		}
	}
	c, r = receivedShieldInput(4000, 20)
	c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[0].Operations[0].CopyableOnHit = true
	if done := authoringRun(t, c, r); ownShieldRemaining(done) != 80 {
		t.Fatal("a marker without repeat was mistaken for replay", done.FinalSnapshot)
	}
}

func TestReceivedShieldDriverRepetitionIsNotCopyableDamageReplay(t *testing.T) {
	c, r := receivedShieldInput(4000)
	c.SharedProviders[3].Abilities = []model.AbilityDefinition{{AbilityKey: "incoming", Kind: "active", Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", Ref: "driver_damage", DamageType: "damage/physics", Amount: timedShieldExpr(20)}}}}
	r.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{{EntryKey: "incoming", AbilityRef: "target.provider[receiver].ability[incoming]", Source: "target", Target: "source", FirstAtMs: 0, Repeat: &model.DriverRepeat{IntervalMs: 1000, MaxAttempts: 2}}}}
	r.StopPolicy.DurationMs = 1001
	s, done := runReceivedShieldState(t, c, r)
	if len(receivedShieldEvents(done, "source")) != 2 || ownShieldRemaining(done) != 60 || s.combatants["source"].providerState["own_recharge"].sourceExpiryFacts["wait"] != (sourceStateExpiryFact{generation: 1, deadline: 4000}) {
		t.Fatal("normal driver attempts were rejected or mistaken for replay", done.Summary, done.FinalSnapshot)
	}
}

func TestReceivedShieldRunDriverCannotBorrowConditionReader(t *testing.T) {
	for _, reader := range []bool{false, true} {
		for _, mode := range []string{"condition", "interval"} {
			for _, hidden := range []bool{false, true} {
				c, r := receivedShieldInput(4000)
				if !reader {
					c.SharedProviders[2].Listeners[1].Condition = authoringAmount(authoringBinary("gt", authoringRead("event.damage.actualHpLoss"), gfConst(0)))
				}
				c.SharedProviders[3].Abilities = []model.AbilityDefinition{{AbilityKey: "incoming", Kind: "active", Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", Ref: "driver_damage", DamageType: "damage/physics", Amount: timedShieldExpr(20)}}}}
				read := authoringRead(ownReceivedShieldPath)
				if hidden {
					read = model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{gfConst(0), read, gfConst(1000)}}
				}
				entry := model.DriverEntry{EntryKey: "incoming", AbilityRef: "target.provider[receiver].ability[incoming]", Source: "target", Target: "source", FirstAtMs: 0}
				if mode == "condition" {
					entry.Condition = &read
				} else {
					entry.Repeat = &model.DriverRepeat{IntervalFormula: &read, MaxAttempts: 2}
				}
				r.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{entry}}
				r.StopPolicy.DurationMs = 1001
				if _, err := RunGeneric(authoringCompile(t, c), r); err == nil || !strings.Contains(err.Message, "linked shield absorption is unavailable in a driver") || !strings.HasPrefix(err.Path, "driverPlan.entries[") {
					t.Fatal("run formula bypassed receiver-condition authorization", reader, mode, hidden)
				}
			}
		}
	}
}
