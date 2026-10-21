package runtime

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

// A real process timer has priority over an ordinary anchored tick. The terminal
// tick must nevertheless settle the old window before that timer can expire or
// replace its target state.
func anchoredBoundaryFixture(t *testing.T, writeAt int64, refresh bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := loadAnchoredVenomFixture(t, anchoredFixtureOpts{
		intervalMs: 1000, durationMs: 1000, maxStacks: 1, tickAmount: 10, formulaReadsStacks: true,
	})
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "ability/spell", Domain: "ability"})
	operations := []model.OperationDefinition{{
		Operation: "damage", Target: "target", Ref: "op:boundary_probe", DamageType: "damage/true",
		Amount: &model.GenericFormulaExpr{Op: "read", Path: "provider.target_state." + anchoredVenomStateKey},
	}}
	if refresh {
		operations = append(operations, c.SharedProviders[0].Abilities[0].Operations[0])
	}
	c.SharedProviders[0].Processes = []model.ProcessDefinition{{
		ProcessKey: "boundary_probe", SkillKey: "skill:boundary_probe",
		Steps:            []model.ProcessStepDefinition{{StepKey: "delay", StepType: "DELAY", DelayMs: timedShieldExpr(1000)}},
		MomentOperations: []model.ProcessMomentOperations{{Moment: processMoment("STEP_EXECUTION", "delay", ""), Operations: operations}},
	}}
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{
		AbilityKey: "boundary_probe", Kind: "active", SkillKey: "skill:boundary_probe", Types: []string{"ability/spell"},
		ProcessControl: &model.ProcessControlDefinition{ProcessKey: "boundary_probe", Action: "INITIAL"},
	})
	r.DriverPlan.Entries[0].FirstAtMs = writeAt
	r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{
		EntryKey: "boundary_probe", AbilityRef: "source.provider[champion:source_demo].ability[boundary_probe]",
		Source: "source", Target: "target", FirstAtMs: writeAt,
	})
	r.SkillUses = []model.SkillUseFact{{UseKey: "boundary_probe_use", Source: "source", SkillKey: "skill:boundary_probe", HistoryState: "complete"}}
	r.ProcessCommandFacts = []model.ProcessCommandFact{{DriverEntryKey: "boundary_probe", UseRef: "boundary_probe_use"}}
	r.StopPolicy.DurationMs = writeAt + 2500
	return c, r
}

func TestAnchoredTerminalBeforeSameTimeProcessRead(t *testing.T) {
	for _, writeAt := range []int64{0, 500} {
		t.Run(map[int64]string{0: "zero_start", 500: "nonzero_start"}[writeAt], func(t *testing.T) {
			c, r := anchoredBoundaryFixture(t, writeAt, false)
			compiled := compile.CompileGeneric(c)
			if !compiled.OK {
				t.Fatal(compiled.Result.Errors)
			}
			done, err := RunGeneric(compiled.Session, r)
			if err != nil {
				t.Fatal(err)
			}
			if times := anchoredTickTimes(done); len(times) != 1 || times[0] != writeAt+1000 {
				t.Fatalf("terminal tick swallowed by earlier process read: got %v, want [%d]", times, writeAt+1000)
			}
			if done.Summary.SourceDamageDealt != 10 {
				t.Fatalf("old window must deal 10, expired probe must read zero: %+v", done.Summary)
			}
		})
	}
}

func TestAnchoredTerminalBeforeSameTimeProcessRefresh(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, true)
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	done, err := RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	times := anchoredTickTimes(done)
	if len(times) != 2 || times[0] != 1000 || times[1] != 2000 {
		t.Fatalf("old window lost during exact-expiry refresh: got %v, want [1000 2000]", times)
	}
	if done.Summary.SourceDamageDealt != 20 {
		t.Fatalf("old and new windows must each deal 10, with no duplicate or stale probe: %+v", done.Summary)
	}
}

func anchoredBoundarySkillPlan(c *model.CompileRequest, r *model.RunRequest) {
	ref := "source.provider[boundary_caster].ability[boundary_probe]"
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/ability_started", Domain: "event"})
	anchor := &c.SharedProviders[0]
	probe := model.ProviderDefinition{ProviderKey: "boundary_caster", StableID: "boundary_caster", Kind: "character",
		Processes: anchor.Processes, Abilities: []model.AbilityDefinition{anchor.Abilities[2]}}
	probe.Processes[0].Steps[0].OccupiesAction = model.BoolPtr(false)
	probe.Processes[0].MomentOperations[0].Operations = []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/true", Ref: "op:boundary_probe",
		Amount: &model.GenericFormulaExpr{Op: "read", Path: "source.attr.armor"}}}
	anchor.Kind = "character"
	anchor.Listeners = []model.ListenerDefinition{{ListenerKey: "open_window", EventMatcher: model.TypeMatcher{All: []string{"event/ability_started"}}, Operations: anchor.Abilities[0].Operations}}
	anchor.Abilities = anchor.Abilities[1:2]
	anchor.Processes = nil
	anchor.Modifiers = []model.ModifierDefinition{{ModifierKey: "window_armor", Kind: "attribute", Target: "self.attr.armor", ValuePolicy: "add", Value: model.GenericFormulaExpr{Op: "read", Path: "provider.target_state." + anchoredVenomStateKey}}}
	c.SharedProviders = append(c.SharedProviders, probe)
	for i := range c.Combatants {
		if c.Combatants[i].Key == "source" {
			c.Combatants[i].Providers = append(c.Combatants[i].Providers, model.CombatantProviderMount{ProviderRef: "boundary_caster", DefinitionRef: "boundary_caster"})
			c.Combatants[i].Attributes["armor"] = model.AttributeSlotDef{}
		}
	}
	for i := range r.InitialSnapshot.Combatants {
		if r.InitialSnapshot.Combatants[i].Key == "source" {
			r.InitialSnapshot.Combatants[i].Providers = append(r.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{ProviderRef: "boundary_caster", DefinitionRef: "boundary_caster", Source: "source", Owner: "source", Stacks: 1})
			r.InitialSnapshot.Combatants[i].Attributes["armor"] = model.AttributeSlotDef{}
		}
	}
	c.Rules.SkillActionBindings = []model.SkillActionBinding{{
		BindingKey: "boundary_probe", Source: "source", ProviderRef: "boundary_caster", ProviderDefinitionRef: "boundary_caster",
		SkillKey: "skill:boundary_probe", Controls: []model.SkillActionControl{{Action: "INITIAL", ProcessKey: "boundary_probe", AbilityRef: ref}},
	}}
	r.DriverPlan.Entries = []model.DriverEntry{}
	r.DriverPlan.SkillActions = []model.SkillActionPlan{{
		InstructionKey: "boundary_probe", Source: "source", Target: "target", SkillKey: "skill:boundary_probe", BindingKey: "boundary_probe", Action: "INITIAL", AbilityRef: ref, HitBindings: []model.SkillActionHitPreset{},
	}}
	r.SkillUses, r.ProcessCommandFacts = nil, nil
}

func anchoredBoundaryStateBeforeExpiry(t *testing.T, c model.CompileRequest, r model.RunRequest) *genericRunState {
	t.Helper()
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	state, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	for {
		at, ok := state.heap.PeekTime()
		if !ok || at > 0 {
			break
		}
		ev, _ := state.heap.Pop()
		state.nowMs, state.currentEventCommands = ev.TimeMs, 0
		state.processedEvents++
		switch ev.Kind {
		case scheduler.GenericEventAbilityAttempt:
			err = state.handleAbilityAttempt(ev)
		case scheduler.GenericEventSkillAction:
			err = state.handleSkillAction(ev.SkillActionIndex)
		case scheduler.GenericEventProcessTimer:
			err = state.handleProcessTimer(ev)
		default:
			t.Fatalf("unexpected setup event: %+v", ev)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	return state
}

func anchoredBoundaryAssertWindow(t *testing.T, state *genericRunState, value float64, expires int64) {
	t.Helper()
	bag := state.combatants["source"].providerState["champion:source_demo"]
	if bag == nil || bag.targetValues[anchoredVenomStateKey] != value || bag.targetExpireAt[anchoredVenomStateKey] != expires || expires == 0 && bag.inclusiveAtExpiryKey != "" {
		t.Fatalf("window value/expiry/temporary hold mismatch: %+v", bag)
	}
}

func TestAnchoredTerminalUsesNormalEventBudgetAndDoesNotRunTimerAfterStop(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, true)
	anchoredBoundarySkillPlan(&c, &r)
	state := anchoredBoundaryStateBeforeExpiry(t, c, r)
	before := state.processedEvents
	state.budget.MaxEvents = before + 1
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	if state.processedEvents != before+1 || state.sourceDamageDealt != 10 || state.budgetCause != model.BudgetCauseMaxEvents || state.processInstances[0].Status != "active" {
		t.Fatalf("terminal did not consume exactly one event before stop: events=%d, damage=%v, budget=%v, process=%+v", state.processedEvents, state.sourceDamageDealt, state.budgetCause, state.processInstances[0])
	}
	anchoredBoundaryAssertWindow(t, state, 0, 0)
}

func TestAnchoredTerminalFailureRollsBackCallbackAndCleanup(t *testing.T) {
	for _, failure := range []string{"commands", "queue", "formula"} {
		t.Run(failure, func(t *testing.T) {
			c, r := anchoredBoundaryFixture(t, 0, true)
			anchoredBoundarySkillPlan(&c, &r)
			tick := &c.SharedProviders[0].Abilities[0].TickSpec.OnTick
			if failure == "queue" {
				*tick = append(*tick, model.OperationDefinition{Operation: "state_change", Target: "source", Ref: anchoredVenomStateKey, Types: []string{"state_scope/provider_target"}, ValuePolicy: "add", Amount: timedShieldExpr(1)})
			}
			if failure == "formula" {
				for i := range r.InitialSnapshot.Combatants {
					if r.InitialSnapshot.Combatants[i].Key == "source" {
						r.InitialSnapshot.Combatants[i].Attributes["attack_damage"] = model.AttributeSlotDef{}
					}
				}
				for i := range c.Combatants {
					if c.Combatants[i].Key == "source" {
						c.Combatants[i].Attributes["attack_damage"] = model.AttributeSlotDef{}
					}
				}
				*tick = append(*tick, model.OperationDefinition{Operation: "damage", Target: "target", DamageType: "damage/true", Amount: &model.GenericFormulaExpr{
					Op: "div", Args: []model.GenericFormulaExpr{gfConst(1), {Op: "read", Path: "source.attr.attack_damage"}},
				}})
			}
			state := anchoredBoundaryStateBeforeExpiry(t, c, r)
			if failure == "commands" {
				state.budget.MaxCommandsPerEvent = 1 // one damage fits; the atomic expiry does not.
			}
			if failure == "queue" {
				state.heap.SetLimit(state.heap.Len()) // the pending process timer still occupies its slot.
			}
			err := state.runLoop()
			if failure == "formula" && err == nil || failure != "formula" && (state.budgetCause == "" || err != nil) {
				t.Fatalf("failure=%s err=%+v budget=%v", failure, err, state.budgetCause)
			}
			if state.sourceDamageDealt != 0 || state.combatantHp("target") != 1000 || state.processInstances[0].Status != "active" {
				t.Fatalf("failed terminal leaked effects or ran process timer: damage=%v hp=%v process=%+v", state.sourceDamageDealt, state.combatantHp("target"), state.processInstances[0])
			}
			anchoredBoundaryAssertWindow(t, state, 1, 1000)
			snapshot := sourceProviderState(t, state.buildDoneResult().FinalSnapshot, "champion:source_demo")["targetState"].(map[string]interface{})
			if snapshot["values"].(map[string]interface{})[anchoredVenomStateKey] != float64(1) || snapshot["expireAt"].(map[string]interface{})[anchoredVenomStateKey] != float64(1000) {
				t.Fatalf("failed terminal disappeared from final snapshot: %+v", snapshot)
			}
			for _, evidence := range state.evidence {
				if evidence.Kind == "provider_target_state_expired" || evidence.Kind == model.EvidenceKindProviderTick {
					t.Fatalf("failed frame published terminal facts: %+v", evidence)
				}
			}
		})
	}
}

func TestAnchoredTerminalDeathPreventsProcessRefresh(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, true)
	anchoredBoundarySkillPlan(&c, &r)
	for i := range r.InitialSnapshot.Combatants {
		if r.InitialSnapshot.Combatants[i].Key == "target" {
			hp := r.InitialSnapshot.Combatants[i].Attributes["hp"]
			hp.Current = 5
			r.InitialSnapshot.Combatants[i].Attributes["hp"] = hp
		}
	}
	for i := range c.Combatants {
		if c.Combatants[i].Key == "target" {
			hp := c.Combatants[i].Attributes["hp"]
			hp.Current = 5
			c.Combatants[i].Attributes["hp"] = hp
		}
	}
	state := anchoredBoundaryStateBeforeExpiry(t, c, r)
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	if state.combatantHp("target") != 0 || state.sourceDamageDealt != 10 || state.stopReason != model.StopReasonTargetDead || state.processInstances[0].Status != "active" {
		t.Fatalf("same-time timer ran after terminal kill: damage=%v hp=%v stop=%v process=%+v", state.sourceDamageDealt, state.combatantHp("target"), state.stopReason, state.processInstances[0])
	}
	anchoredBoundaryAssertWindow(t, state, 0, 0)
}

func TestAnchoredNonterminalTickKeepsOriginalProcessOrder(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, false)
	c.SharedProviders[0].Abilities[1].TickSpec.IntervalMs = 500
	c.SharedProviders[0].Processes[0].Steps[0].DelayMs = timedShieldExpr(500)
	done := processRun(t, c, r)
	var at500 []string
	for _, evidence := range done.Evidence.Items {
		if evidence.Kind == model.EvidenceKindDamage && evidence.TimeMs == 500 {
			at500 = append(at500, evidence.Ref)
		}
	}
	if !reflect.DeepEqual(at500, []string{"source.provider[champion:source_demo].ability[boundary_probe]", "source.provider[champion:source_demo].ability[venom_tick]"}) || done.Summary.SourceDamageDealt != 21 {
		t.Fatalf("nonterminal tick order changed: at500=%v damage=%v", at500, done.Summary.SourceDamageDealt)
	}
}

func anchoredBoundaryAddSecondWindow(c *model.CompileRequest, r *model.RunRequest) {
	for i := range c.Combatants {
		if c.Combatants[i].Key == "source" {
			c.Combatants[i].Providers = append(c.Combatants[i].Providers, model.CombatantProviderMount{ProviderRef: "other_window", DefinitionRef: c.SharedProviders[0].ProviderKey})
		}
	}
	for i := range r.InitialSnapshot.Combatants {
		if r.InitialSnapshot.Combatants[i].Key == "source" {
			r.InitialSnapshot.Combatants[i].Providers = append(r.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{ProviderRef: "other_window", DefinitionRef: c.SharedProviders[0].ProviderKey, Source: "source", Owner: "source", Stacks: 1})
		}
	}
}

func TestAnchoredTerminalPrioritySeqAndPerEventCommands(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, false)
	anchoredBoundarySkillPlan(&c, &r)
	anchoredBoundaryAddSecondWindow(&c, &r)
	state := anchoredBoundaryStateBeforeExpiry(t, c, r)
	var queued []scheduler.GenericEvent
	for ev, ok := state.heap.Pop(); ok; ev, ok = state.heap.Pop() {
		if ev.Kind == scheduler.GenericEventAnchoredTick && state.anchoredTickPayloads[ev.DriverEntryIndex].providerRef == "other_window" {
			ev.Priority = -1
		}
		queued = append(queued, ev)
	}
	for _, ev := range queued {
		if state.heap.Push(ev) != model.ErrOK {
			t.Fatal("restore test queue")
		}
	}
	var original []scheduler.GenericEvent
	for ev, ok := state.heap.Pop(); ok; ev, ok = state.heap.Pop() {
		original = append(original, ev)
	}
	for _, ev := range original {
		state.heap.Push(ev)
	}
	timer, _ := state.heap.Pop()
	selected, err := state.selectAnchoredTerminalBeforeProcessTimer(timer)
	if err != nil || selected.Kind != scheduler.GenericEventAnchoredTick || selected.Priority != -1 {
		t.Fatalf("wrong selected terminal: %+v err=%+v", selected, err)
	}
	var restored []scheduler.GenericEvent
	for ev, ok := state.heap.Pop(); ok; ev, ok = state.heap.Pop() {
		restored = append(restored, ev)
	}
	var want []scheduler.GenericEvent
	for _, ev := range original {
		if ev.Seq != selected.Seq {
			want = append(want, ev)
		}
	}
	if !reflect.DeepEqual(restored, want) {
		t.Fatalf("selection changed original queued identities or order: got %+v want %+v", restored, want)
	}
	state.heap.Push(selected)
	for _, ev := range restored {
		state.heap.Push(ev)
	}
	state.budget.MaxCommandsPerEvent = 2 // each terminal independently spends damage + cleanup.
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	var providers []string
	for _, ev := range state.evidence {
		if ev.Kind == model.EvidenceKindProviderTick {
			providers = append(providers, ev.Ref)
		}
	}
	if !reflect.DeepEqual(providers, []string{"other_window", "champion:source_demo"}) || state.sourceDamageDealt != 20 || state.budgetCause != "" || len(state.anchoredTerminalAt) != 0 {
		t.Fatalf("terminal order/budget/index mismatch: order=%v damage=%v budget=%v index=%v", providers, state.sourceDamageDealt, state.budgetCause, state.anchoredTerminalAt)
	}
	anchoredBoundaryAssertWindow(t, state, 0, 0)
}

func TestAnchoredTerminalFailureDoesNotExpireAnotherPendingWindow(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, false)
	anchoredBoundarySkillPlan(&c, &r)
	anchoredBoundaryAddSecondWindow(&c, &r)
	state := anchoredBoundaryStateBeforeExpiry(t, c, r)
	state.budget.MaxCommandsPerEvent = 1
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	if state.sourceDamageDealt != 0 || state.budgetCause != model.BudgetCauseMaxCommandsPerEvent || state.processInstances[0].Status != "active" {
		t.Fatalf("failed terminal published effects or continued process: damage=%v budget=%v process=%+v", state.sourceDamageDealt, state.budgetCause, state.processInstances[0])
	}
	done := state.buildDoneResult()
	for _, ref := range []string{"champion:source_demo", "other_window"} {
		target := sourceProviderState(t, done.FinalSnapshot, ref)["targetState"].(map[string]interface{})
		if target["values"].(map[string]interface{})[anchoredVenomStateKey] != float64(1) || target["expireAt"].(map[string]interface{})[anchoredVenomStateKey] != float64(1000) {
			t.Fatalf("failed callback swallowed pending window %s: %+v", ref, target)
		}
	}
}

func TestAnchoredTerminalDoesNotClearCallbackRefresh(t *testing.T) {
	c, r := loadAnchoredVenomFixture(t, anchoredFixtureOpts{intervalMs: 1000, durationMs: 1000, maxStacks: 1, tickAmount: 10, formulaReadsStacks: true})
	c.SharedProviders[0].Abilities[1].TickSpec.OnTick = append(c.SharedProviders[0].Abilities[1].TickSpec.OnTick, c.SharedProviders[0].Abilities[0].Operations[0])
	r.StopPolicy.DurationMs = 2500
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	for i := 0; i < 3; i++ {
		done, err := RunGeneric(compiled.Session, r)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(anchoredTickTimes(done), []int64{1000, 2000}) || done.Summary.SourceDamageDealt != 20 {
			t.Fatalf("callback refresh lost or duplicate across repeat %d: %+v", i, done.Summary)
		}
		bag := sourceProviderState(t, done.FinalSnapshot, "champion:source_demo")
		target := bag["targetState"].(map[string]interface{})
		if target["values"].(map[string]interface{})[anchoredVenomStateKey] != float64(1) || target["expireAt"].(map[string]interface{})[anchoredVenomStateKey] != float64(3000) {
			t.Fatalf("old terminal cleared newer window: %+v", target)
		}
	}
}

func TestAnchoredTerminalSelectionRejectsStaleAndForeignIdentity(t *testing.T) {
	for _, invalid := range []string{"generation", "target", "source", "owner", "provider", "state", "expiry", "cleared"} {
		t.Run(invalid, func(t *testing.T) {
			c, r := anchoredBoundaryFixture(t, 0, false)
			state := anchoredBoundaryStateBeforeExpiry(t, c, r)
			payload := &state.anchoredTickPayloads[0]
			bag := state.combatants["source"].providerState["champion:source_demo"]
			switch invalid {
			case "generation":
				bag.bumpAnchoredTickGeneration(anchoredVenomStateKey)
			case "target":
				payload.targetKey = "source"
			case "source":
				payload.sourceKey = "target"
			case "owner":
				payload.ownerKey = "target"
			case "provider":
				payload.providerRef = "not_mounted"
			case "state":
				payload.anchorStateKey = "not_anchored"
			case "expiry":
				payload.expectedExpireAt++
			case "cleared":
				bag.writableTargetValues()[anchoredVenomStateKey] = 0
				bag.writableTargetExpireAt()[anchoredVenomStateKey] = 0
			}
			timer, _ := state.heap.Pop()
			selected, err := state.selectAnchoredTerminalBeforeProcessTimer(timer)
			if err != nil || selected != timer {
				t.Fatalf("selected invalid terminal %s: %+v err=%+v", invalid, selected, err)
			}
		})
	}
}

func TestAnchoredTerminalIndexAbsentForLegacyTick(t *testing.T) {
	c, r := loadFixedTickProviderFixture(t)
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	state, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if err = state.runLoop(); err != nil {
		t.Fatal(err)
	}
	if state.anchoredTerminalAt != nil {
		t.Fatalf("unanchored legacy run allocated a terminal index: %+v", state.anchoredTerminalAt)
	}
}

func TestAnchoredTerminalFailedEnqueueDoesNotGrantHold(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, false)
	state := anchoredBoundaryStateBeforeExpiry(t, c, r)
	bag := state.combatants["source"].providerState["champion:source_demo"]
	bag.clearInclusiveAtExpiryHold()
	state.anchoredTerminalAt = nil
	state.heap.SetLimit(state.heap.Len())
	state.enqueueAnchoredTickAt(1000, state.anchoredTickPayloads[0])
	if state.anchoredTerminalAt != nil || bag.inclusiveAtExpiryKey != "" || state.budgetCause != model.BudgetCauseMaxQueueEvents {
		t.Fatalf("rejected terminal granted authority: hold=%+v index=%v budget=%v", bag, state.anchoredTerminalAt, state.budgetCause)
	}
}

func TestAnchoredWindowWithoutTerminalRetainsOrdinaryExpiry(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, false)
	anchoredBoundarySkillPlan(&c, &r)
	c.SharedProviders[0].Abilities[0].TickSpec.IntervalMs = 1500 // no tick lies within the 1000ms window.
	state := anchoredBoundaryStateBeforeExpiry(t, c, r)
	bag := state.combatants["source"].providerState["champion:source_demo"]
	if state.anchoredTerminalAt != nil || bag.inclusiveAtExpiryKey != "" {
		t.Fatalf("window without a real terminal gained a hold/index: %+v", bag)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	if len(anchoredTickTimes(state.buildDoneResult())) != 0 {
		t.Fatal("window with no scheduled terminal executed a callback")
	}
	anchoredBoundaryAssertWindow(t, state, 0, 0)
}

func TestAnchoredTerminalHoldLosesAuthorityWhenDeadlineOrGenerationChanges(t *testing.T) {
	for _, change := range []string{"deadline", "generation"} {
		t.Run(change, func(t *testing.T) {
			c, r := anchoredBoundaryFixture(t, 0, false)
			state := anchoredBoundaryStateBeforeExpiry(t, c, r)
			bag := state.combatants["source"].providerState["champion:source_demo"]
			now := int64(1000)
			if change == "deadline" {
				bag.writableTargetExpireAt()[anchoredVenomStateKey] = 900
				now = 900
			} else {
				bag.bumpAnchoredTickGeneration(anchoredVenomStateKey)
			}
			bag.lazyExpireProviderTargetState(now)
			if bag.targetValues[anchoredVenomStateKey] != 0 || bag.targetExpireAt[anchoredVenomStateKey] != 0 {
				t.Fatalf("stale queued terminal hold authorized a changed window: %+v", bag)
			}
		})
	}
}

func TestAnchoredWindowEarlyClearInvalidatesOldTerminal(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, false)
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "clear_window", Kind: "active", Types: []string{"ability/spell"}, Operations: []model.OperationDefinition{{
		Operation: "state_change", Target: "source", Ref: anchoredVenomStateKey, Types: []string{"state_scope/provider_target"}, ValuePolicy: "override", Amount: timedShieldExpr(0),
	}}})
	r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{EntryKey: "clear_window", AbilityRef: "source.provider[champion:source_demo].ability[clear_window]", Source: "source", Target: "target", FirstAtMs: 900})
	done := processRun(t, c, r)
	if len(anchoredTickTimes(done)) != 0 || done.Summary.SourceDamageDealt != 0 {
		t.Fatalf("early-cleared window detonated from stale callback: %+v", done.Summary)
	}
}

func TestAnchoredBlockedTerminalStillExpiresAtomically(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, false)
	c.SharedProviders[0].Abilities[1].CastCondition = timedShieldExpr(0)
	done := processRun(t, c, r)
	if len(anchoredTickTimes(done)) != 0 || done.Summary.SourceDamageDealt != 0 {
		t.Fatalf("blocked callback executed: %+v", done.Summary)
	}
	count := 0
	for _, evidence := range done.Evidence.Items {
		if evidence.Kind == "provider_target_state_expired" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("blocked callback did not publish one real expiry: %d", count)
	}
}
