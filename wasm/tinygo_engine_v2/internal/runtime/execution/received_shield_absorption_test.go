package execution

import (
	testing "testing"
	formula "tinygo_engine_v2/internal/formula"
	model "tinygo_engine_v2/internal/model"
	plan "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	scheduler "tinygo_engine_v2/internal/scheduler"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

const ownReceivedShieldPath = "event.damage.linked_shield[own_guard/value].absorbed"

// Keep the existing attack/received/expiry plan. A constant defense formula makes
// each independently chosen incoming amount equal to its post-defense amount;
// the real shield's attached armor still has to disappear and return correctly.
func receivedShieldInput(delay int64, amounts ...float64) (model.CompileRequest, model.RunRequest) {
	c, r := ownExpiryInput(delay, 1, 0, len(amounts))
	c.Rules.DamageTypeFormulas = []model.DamageTypeFormulaDefinition{{DamageType: "damage/physics", Formula: formuladefinition.ConstantDefense("1")}}
	c.SharedProviders[1].SkillKey, c.SharedProviders[2].SkillKey = "native_guard", "native_guard"
	p := &c.SharedProviders[2]
	hpLoss := authoringBinary("gt", authoringRead("event.damage.actualHpLoss"), gfConst(0))
	firstShieldLoss := authoringBinary("min", authoringBinary("eq", authoringRead("provider.state.wait"), gfConst(0)), authoringBinary("gt", authoringRead(ownReceivedShieldPath), gfConst(0)))
	p.Listeners[1].Condition = authoringAmount(authoringBinary("max", hpLoss, firstShieldLoss))
	if len(amounts) > 0 {
		expr := gfConst(amounts[len(amounts)-1])
		for i := len(amounts) - 2; i >= 0; i-- {
			expr = model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringBinary("eq", authoringRead("provider.state.count"), gfConst(float64(i))), gfConst(amounts[i]), expr}}
		}
		c.SharedProviders[3].Listeners[0].Operations[0].Amount = &expr
	}
	r.StopPolicy.DurationMs = int64(len(amounts))*1000 + 100
	return c, r
}

func receivedShieldState(t *testing.T, c model.CompileRequest, r model.RunRequest) *Engine {
	t.Helper()
	s := frameCommitState(t, c, r)
	if !s.compiled.HasReceivedShieldReads {
		t.Fatal("the actual listener did not authorize collection")
	}
	return s
}

func runReceivedShieldState(t *testing.T, c model.CompileRequest, r model.RunRequest) (*Engine, model.DoneResult) {
	t.Helper()
	s := receivedShieldState(t, c, r)
	if err := s.runLoop(); err != nil {
		t.Fatalf("run: %+v", err)
	}
	return s, s.buildDoneResult(false)
}

func receivedShieldEvents(done model.DoneResult, target string) []model.EvidenceItem {
	var events []model.EvidenceItem
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == model.EventTypeDamageTaken && item.Data["target"] == target {
			events = append(events, item)
		}
	}
	return events
}

func receivedRows(t *testing.T, event model.EvidenceItem) []model.ShieldAbsorptionRecord {
	t.Helper()
	rows, present := event.Data["shieldAbsorptions"].([]model.ShieldAbsorptionRecord)
	if !present || rows == nil {
		t.Fatal("missing completed native receipt", event)
	}
	return rows
}

func assertReceivedShieldHealth(t *testing.T, s *Engine, done model.DoneResult, remaining, hp, armor float64) {
	t.Helper()
	if !done.Summary.Execution.Complete || done.Summary.BasicAttack == nil || done.Summary.BasicAttack.CompletedCount == 0 || ownShieldRemaining(done) != remaining || s.combatantHp("source") != hp || done.FinalSnapshot.Combatants[0].Attributes["armor"].Resolved != armor {
		t.Fatal("independent health/shield/armor expectation failed", remaining, hp, armor, done.Summary, done.FinalSnapshot)
	}
}

func TestReceivedShieldFirstLossAndExistingWaitPolicy(t *testing.T) {
	cases := []struct {
		name                 string
		amounts              []float64
		remaining, hp, armor float64
		deadline             int64
		generation           uint64
	}{
		{"zero", []float64{0}, 100, 1000, 130, 0, 0},
		{"first_partial", []float64{20}, 80, 1000, 130, 4000, 1},
		{"exact_depletion", []float64{100}, 0, 1000, 100, 4000, 1},
		{"already_waiting", []float64{20, 20}, 60, 1000, 130, 4000, 1},
		{"real_hp_loss_restarts", []float64{60, 60}, 0, 980, 100, 5000, 2},
		{"shield_and_hp_once", []float64{120}, 0, 980, 100, 4000, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, r := receivedShieldInput(4000, tc.amounts...)
			s, done := runReceivedShieldState(t, c, r)
			assertReceivedShieldHealth(t, s, done, tc.remaining, tc.hp, tc.armor)
			bag := s.combatants["source"].providerState.Lookup("own_recharge")
			fact := bag.SourceExpiry("wait")
			if fact.Deadline != tc.deadline || fact.Generation != tc.generation || bag.ExpireAt().At("wait") != tc.deadline {
				t.Fatal("first damage/restart selected the wrong deadline", fact, bag.ExpireAt())
			}
			events := receivedShieldEvents(done, "source")
			if len(events) != len(tc.amounts) {
				t.Fatal("one received fact is required per actual damage operation", events)
			}
			for i, event := range events {
				rows := receivedRows(t, event)
				sum := 0.0
				for _, row := range rows {
					if row.DefinitionRef != "own_guard/value" || row.LifecycleProviderRef == "" || row.Source != "source" || row.Owner != "source" {
						t.Fatal("lost the actual exhausted or partial own shield identity", row)
					}
					sum += row.Absorbed
				}
				if sum != event.Data["shieldAbsorbed"] || event.TimeMs != int64(i)*1000 || event.Data["postDefenseDamage"] != tc.amounts[i] {
					t.Fatal("receipt changed the actual settlement", rows, event)
				}
				id, ok := event.Data["damageId"].(uint64)
				matched := false
				for _, record := range done.DamageRecords {
					matched = matched || record["damageId"] == id && record["target"] == "source" && record["timeMs"] == event.TimeMs
				}
				if !ok || id == 0 || !matched {
					t.Fatal("received receipt did not retain its original damage identity", id, done.DamageRecords)
				}
			}
		})
	}
}

func TestReceivedShieldExactDeadlineAndRealRechargeDurations(t *testing.T) {
	for _, delay := range []int64{6000, 7000, 8000} {
		c, r := receivedShieldInput(delay, 20)
		for _, end := range []int64{delay - 1, delay} {
			r.StopPolicy.DurationMs = end
			s, done := runReceivedShieldState(t, c, r)
			want := float64(80)
			if end == delay {
				want = 100
			}
			assertReceivedShieldHealth(t, s, done, want, 1000, 130)
			count := 0
			for _, event := range done.Evidence.Items {
				if event.Kind == "provider_state_expired" {
					count++
					if event.TimeMs != delay {
						t.Fatal("wrong real recharge deadline", event)
					}
				}
			}
			if (end == delay) != (count == 1) {
				t.Fatal("recharge executed early or failed at exact deadline", delay, end, count)
			}
		}
	}
	for _, hpLoss := range []bool{false, true} {
		amount := float64(20)
		if hpLoss {
			amount = 60
		}
		c, r := receivedShieldInput(2000, amount, 0, amount)
		r.StopPolicy.DurationMs = 2000
		s, done := runReceivedShieldState(t, c, r)
		bag := s.combatants["source"].providerState.Lookup("own_recharge")
		if hpLoss {
			assertReceivedShieldHealth(t, s, done, 0, 980, 100)
			if bag.SourceExpiry("wait") != (effectpkg.SourceExpiryFact{Generation: 2, Deadline: 4000}) {
				t.Fatal("real health loss did not invalidate the original callback", bag.SourceExpiry("wait"))
			}
			for _, event := range done.Evidence.Items {
				if event.Kind == "provider_state_expired" {
					t.Fatal("old deadline incorrectly replenished before real damage", event)
				}
			}
		} else {
			assertReceivedShieldHealth(t, s, done, 100, 1000, 130)
			if bag.SourceExpiry("wait") != (effectpkg.SourceExpiryFact{Generation: 1, Deadline: 0}) || bag.State().At("wait") != 0 {
				t.Fatal("pure shield loss at the held deadline falsely restarted the timer", bag.SourceExpiry("wait"), bag.State())
			}
		}
	}
}

func TestReceivedShieldSameFramePacketsRetainSeparateDamageFacts(t *testing.T) {
	for _, amount := range []float64{20, 60} {
		c, r := receivedShieldInput(4000, amount)
		ops := c.SharedProviders[3].Listeners[0].Operations
		second := ops[0]
		second.Ref = "second_packet"
		c.SharedProviders[3].Listeners[0].Operations = []model.OperationDefinition{ops[0], second, ops[1]}
		r.StopPolicy.DurationMs = 100
		s, done := runReceivedShieldState(t, c, r)
		events := receivedShieldEvents(done, "source")
		if len(events) != 2 || events[0].Data["damageId"] == events[1].Data["damageId"] || events[0].TimeMs != 0 || events[1].TimeMs != 0 {
			t.Fatal("same-frame packets shared or lost their damage identity", events)
		}
		first, secondRows := receivedRows(t, events[0]), receivedRows(t, events[1])
		wantSecond, wantRemaining, wantHP, wantGeneration := amount, 100-2*amount, 1000.0, uint64(1)
		if amount == 60 {
			wantSecond, wantRemaining, wantHP, wantGeneration = 40, 0, 980, 2
		}
		if len(first) != 1 || len(secondRows) != 1 || first[0].RemainingBefore != 100 || first[0].RemainingAfter != 100-amount || secondRows[0].RemainingBefore != 100-amount || secondRows[0].Absorbed != wantSecond || secondRows[0].RemainingAfter != wantRemaining {
			t.Fatal("later packet or listener observed a live shield instead of its frozen receipt", first, secondRows)
		}
		armor := float64(130)
		if wantRemaining == 0 {
			armor = 100
		}
		assertReceivedShieldHealth(t, s, done, wantRemaining, wantHP, armor)
		if s.combatants["source"].providerState.Lookup("own_recharge").SourceExpiry("wait").Generation != wantGeneration {
			t.Fatal("same-frame first shield and actual health loss were not separately qualified")
		}
	}
}

func TestReceivedShieldForeignShieldAndCrossShieldAttribution(t *testing.T) {
	for _, amount := range []float64{40, 70, 150, 170} {
		c, r := receivedShieldInput(4000)
		// A real different actor casts its ordinary shield, then a real damage
		// operation crosses that shield and the initialized own P shield.
		giver := &c.SharedProviders[3]
		giver.Abilities = []model.AbilityDefinition{
			{AbilityKey: "foreign_shield", Kind: "active", Operations: []model.OperationDefinition{{Operation: "shield", Target: "target", ShieldRef: "a_foreign", Amount: timedShieldExpr(50)}}},
			{AbilityKey: "incoming", Kind: "active", Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", Ref: "foreign_damage", DamageType: "damage/physics", Amount: timedShieldExpr(amount)}}},
		}
		r.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{
			{EntryKey: "shield", AbilityRef: "target.provider[receiver].ability[foreign_shield]", Source: "target", Target: "source", FirstAtMs: 1},
			{EntryKey: "incoming", AbilityRef: "target.provider[receiver].ability[incoming]", Source: "target", Target: "source", FirstAtMs: 2},
		}}
		r.StopPolicy.DurationMs = 100
		s, done := runReceivedShieldState(t, c, r)
		events := receivedShieldEvents(done, "source")
		if len(events) != 1 {
			t.Fatal(events)
		}
		rows := receivedRows(t, events[0])
		wantRows, ownTake, hpLoss, deadline := 1, 0.0, 0.0, int64(0)
		if amount > 50 {
			wantRows, ownTake, deadline = 2, amount-50, 4002
		}
		if ownTake > 100 {
			ownTake, hpLoss = 100, ownTake-100
		}
		if len(rows) != wantRows || rows[0].Source != "target" || rows[0].Owner != "source" || rows[0].DefinitionRef != "" || rows[0].LifecycleProviderRef != "" {
			t.Fatal("foreign shield acquired the P association", rows)
		}
		if wantRows == 2 && (rows[1].DefinitionRef != "own_guard/value" || rows[1].Source != "source" || rows[1].Absorbed != ownTake) {
			t.Fatal("cross-shield damage selected total absorption rather than own P", rows)
		}
		bag := s.combatants["source"].providerState.Lookup("own_recharge")
		fact := effectpkg.SourceExpiryFact{}
		if bag.Present() {
			fact = bag.SourceExpiry("wait")
		}
		if fact.Deadline != deadline || s.combatantHp("source") != 1000-hpLoss {
			t.Fatal("foreign-only damage armed the P timer or changed health", fact, done.FinalSnapshot)
		}
	}
}

func TestReceivedShieldSameDefinitionOnOppositeOwnersKeepsActualMounts(t *testing.T) {
	c, r := receivedShieldInput(4000, 20)
	setCombatantAttr(&c, &r, "source", "attack_damage", authoringSlot(100))
	c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "their_recharge", DefinitionRef: "own_recharge"})
	r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: "their_recharge", DefinitionRef: "own_recharge", Source: "target", Owner: "target", Stacks: 1})
	r.StopPolicy.DurationMs = 100
	s, done := runReceivedShieldState(t, c, r)
	if ownShieldRemaining(done) != 80 || s.combatantHp("source") != 1000 || s.combatantHp("target") != 10000 {
		t.Fatal("opposite owner's same static definition changed own settlement", done.FinalSnapshot)
	}
	for _, actor := range []string{"source", "target"} {
		ref := "own_recharge"
		if actor == "target" {
			ref = "their_recharge"
		}
		if s.combatants[actor].providerState.Lookup(ref).SourceExpiry("wait") != (effectpkg.SourceExpiryFact{Generation: 1, Deadline: 4000}) {
			t.Fatal("same definition on another actual mount borrowed the timer", actor, done.FinalSnapshot)
		}
		events := receivedShieldEvents(done, actor)
		if len(events) != 1 || len(receivedRows(t, events[0])) != 1 || receivedRows(t, events[0])[0].Owner != actor || receivedRows(t, events[0])[0].Source != actor {
			t.Fatal("receipt crossed actual owners", actor, events)
		}
	}
}

// These helpers run the public plan's actual initializers, then let transaction
// tests place one real damage frame at a controlled point before dispatch.
func receivedShieldInitializedState(t *testing.T) *Engine {
	t.Helper()
	c, r := receivedShieldInput(4000)
	s := receivedShieldState(t, c, r)
	for s.effectInitialization.Pending() > 0 {
		event, ok := s.loop.Queue().Pop()
		if !ok || event.Kind != scheduler.GenericEventSourceInitialized {
			t.Fatal("actual source initialization was not first", event)
		}
		s.loop.Advance(event.TimeMs)
		if err := s.handleSourceInitialized(event); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func receivedDamageFrame(t *testing.T, s *Engine, amount float64) *Frame {
	t.Helper()
	s.currentEventCommands = 0
	f := s.newExecutionFrame("target", "source", "native_received_probe")
	f.ownerCombatantKey, f.ownerProviderRef = "target", "receiver"
	program := formula.GenericProgramID(len(s.formulas.Programs))
	s.formulas.Programs = append(s.formulas.Programs, formula.GenericProgram{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: amount}}})
	op := plan.CompiledOperation{Operation: "damage", Target: "target", Ref: "native_received_probe", DamageType: "damage/physics", HasAmount: true, AmountProgram: program}
	if err := f.executeOperations(plan.CompiledAbility{}, []plan.CompiledOperation{op}); err != nil {
		t.Fatal(err)
	}
	return f
}
