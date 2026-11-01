package execution

import (
	json "encoding/json"
	math "math"
	reflect "reflect"
	testing "testing"
	formula "tinygo_engine_v2/internal/formula"
	model "tinygo_engine_v2/internal/model"
	pipeline "tinygo_engine_v2/internal/pipeline"
	plan "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func actualReceivedShieldEvent(t *testing.T, s *Engine, f *Frame) emittedEvent {
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

func actualReceivedShieldReader(s *Engine, ev emittedEvent) (*Frame, uint16) {
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
	if s.combatants["source"].instances.Shields().Len() != 0 {
		t.Fatal("test failed to deplete the real shield")
	}
	f, index := actualReceivedShieldReader(s, ev)
	if got, err := f.ReceivedLinkedShieldAbsorbed(index); err != nil || got != 100 {
		t.Fatal("exhausted shield was queried live instead of its immutable receipt", got, err)
	}
	// Every condition shares the same frozen rows. Cloning an event must not
	// allocate/copy a per-listener receipt or erase the completed-empty marker.
	clone := cloneEventSnapshot(&ev.snapshot)
	if clone.ShieldAbsorptions != ev.snapshot.ShieldAbsorptions {
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
			snapshot := *frame.eventCtx.ShieldAbsorptions
			snapshot.Rows = append([]pipeline.ShieldAbsorption(nil), snapshot.Rows...)
			frame.eventCtx.ShieldAbsorptions = &snapshot
			switch mode {
			case "missing_event":
				frame.eventCtx = nil
			case "sender_event":
				frame.eventCtx.EventType = "event/damage_instance"
			case "aggregate_event":
				frame.eventCtx.EventType = "event/damage_dealt"
			case "missing_damage":
				frame.eventCtx.HasDamageSnapshot = false
			case "missing_facts":
				frame.eventCtx.ShieldAbsorptions = nil
			case "wrong_event_target":
				frame.eventCtx.EventTargetKey = "target"
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
			before := s.buildDoneResult(false)
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
				s.loop.Queue().SetLimit(s.loop.Queue().Len())
			} else {
				bad := formula.GenericProgramID(len(s.formulas.Programs))
				s.formulas.Programs = append(s.formulas.Programs, formula.GenericProgram{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1}, {Op: formula.GenericOpConst, Value: 0}, {Op: formula.GenericOpDiv}}})
				s.compiled.Operations[listener.OperationStart].AmountProgram = bad
			}
			s.currentEventCommands = 0
			if err := s.dispatchListeners(ev, 1); err == nil || mode == "queue" && err.BudgetCause != model.BudgetCauseMaxQueueEvents {
				t.Fatal("failed listener did not stop the run", mode)
			}
			bag := s.combatants["source"].providerState.Lookup("own_recharge")
			if bag.Present() && (bag.State().At("wait") != 0 || bag.ExpireAt().At("wait") != 0 || bag.SourceExpiry("wait") != (effectpkg.SourceExpiryFact{})) {
				t.Fatal("failed child published timer state or callback generation", mode, bag)
			}
			// buildDoneResult is observation-only. The parent receipt and shield
			// reduction survive; none of the child's pending facts can publish.
			afterDone := s.buildDoneResult(false)
			if !reflect.DeepEqual(before.FinalSnapshot, afterDone.FinalSnapshot) || !reflect.DeepEqual(before.DamageRecords, afterDone.DamageRecords) || !reflect.DeepEqual(before.Evidence, afterDone.Evidence) || afterDone.Summary.SourceHpLoss != before.Summary.SourceHpLoss || ownShieldRemaining(afterDone) != 80 || len(receivedShieldEvents(afterDone, "source")) != 1 || len(receivedRows(t, receivedShieldEvents(afterDone, "source")[0])) != 1 {
				t.Fatal("failed child changed already committed parent facts", mode, afterDone.FinalSnapshot)
			}
		})
	}
}

func TestReceivedShieldParentFailurePublishesNoPartialReceipt(t *testing.T) {
	s := receivedShieldInitializedState(t)
	beforeDone := s.buildDoneResult(false)
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
	afterDone := s.buildDoneResult(false)
	after, _ := json.Marshal(afterDone)
	if string(before) != string(after) || ownShieldRemaining(afterDone) != 100 || len(receivedShieldEvents(afterDone, "source")) != 0 || len(f.pendingEvents) == 0 {
		t.Fatal("failed damage frame exposed a staged first packet or its receipt", afterDone.FinalSnapshot)
	}
}

func TestReceivedShieldDriverRepetitionIsNotCopyableDamageReplay(t *testing.T) {
	c, r := receivedShieldInput(4000)
	c.SharedProviders[3].Abilities = []model.AbilityDefinition{{AbilityKey: "incoming", Kind: "active", Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", Ref: "driver_damage", DamageType: "damage/physics", Amount: timedShieldExpr(20)}}}}
	r.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{{EntryKey: "incoming", AbilityRef: "target.provider[receiver].ability[incoming]", Source: "target", Target: "source", FirstAtMs: 0, Repeat: &model.DriverRepeat{IntervalMs: 1000, MaxAttempts: 2}}}}
	r.StopPolicy.DurationMs = 1001
	s, done := runReceivedShieldState(t, c, r)
	if len(receivedShieldEvents(done, "source")) != 2 || ownShieldRemaining(done) != 60 || s.combatants["source"].providerState.Lookup("own_recharge").SourceExpiry("wait") != (effectpkg.SourceExpiryFact{Generation: 1, Deadline: 4000}) {
		t.Fatal("normal driver attempts were rejected or mistaken for replay", done.Summary, done.FinalSnapshot)
	}
}
