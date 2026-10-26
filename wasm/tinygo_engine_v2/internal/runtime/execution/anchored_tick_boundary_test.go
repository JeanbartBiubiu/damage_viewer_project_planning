package execution

import (
	reflect "reflect"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	scheduler "tinygo_engine_v2/internal/scheduler"
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

func anchoredBoundaryStateBeforeExpiry(t *testing.T, c model.CompileRequest, r model.RunRequest) *Engine {
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
		at, ok := state.loop.Queue().PeekTime()
		if !ok || at > 0 {
			break
		}
		ev, _ := state.loop.Queue().Pop()
		state.loop.AcceptEvent(ev.TimeMs)
		state.currentEventCommands = 0
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

func anchoredBoundaryAssertWindow(t *testing.T, state *Engine, value float64, expires int64) {
	t.Helper()
	bag := state.combatants["source"].providerState.Lookup("champion:source_demo")
	if !bag.Present() || bag.TargetValues().At(anchoredVenomStateKey) != value || bag.TargetExpireAt().At(anchoredVenomStateKey) != expires {
		t.Fatalf("window value/expiry/temporary hold mismatch: %+v", bag)
	}
}

func TestAnchoredTerminalUsesNormalEventBudgetAndDoesNotRunTimerAfterStop(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, true)
	anchoredBoundarySkillPlan(&c, &r)
	state := anchoredBoundaryStateBeforeExpiry(t, c, r)
	before := state.loop.ProcessedEvents()
	state.budget.MaxEvents = before + 1
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	if state.loop.ProcessedEvents() != before+1 || state.report.Totals().SourceDamageDealt != 10 || state.budgetCause != model.BudgetCauseMaxEvents || state.actions.ProcessAt(0).Status() != "active" {
		t.Fatalf("terminal did not consume exactly one event before stop: events=%d, damage=%v, budget=%v, process=%+v", state.loop.ProcessedEvents(), state.report.Totals().SourceDamageDealt, state.budgetCause, state.actions.ProcessAt(0))
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
				state.loop.Queue().SetLimit(state.loop.Queue().Len()) // the pending process timer still occupies its slot.
			}
			err := state.runLoop()
			if failure == "formula" && err == nil || failure != "formula" && (state.budgetCause == "" || err != nil) {
				t.Fatalf("failure=%s err=%+v budget=%v", failure, err, state.budgetCause)
			}
			if state.report.Totals().SourceDamageDealt != 0 || state.combatantHp("target") != 1000 || state.actions.ProcessAt(0).Status() != "active" {
				t.Fatalf("failed terminal leaked effects or ran process timer: damage=%v hp=%v process=%+v", state.report.Totals().SourceDamageDealt, state.combatantHp("target"), state.actions.ProcessAt(0))
			}
			anchoredBoundaryAssertWindow(t, state, 1, 1000)
			snapshot := sourceProviderState(t, state.buildDoneResult(false).FinalSnapshot, "champion:source_demo")["targetState"].(map[string]interface{})
			if snapshot["values"].(map[string]interface{})[anchoredVenomStateKey] != float64(1) || snapshot["expireAt"].(map[string]interface{})[anchoredVenomStateKey] != float64(1000) {
				t.Fatalf("failed terminal disappeared from final snapshot: %+v", snapshot)
			}
			for _, evidence := range state.report.Snapshot().Evidence.Items {
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
	if state.combatantHp("target") != 0 || state.report.Totals().SourceDamageDealt != 10 || state.loop.Reason() != model.StopReasonTargetDead || state.actions.ProcessAt(0).Status() != "active" {
		t.Fatalf("same-time timer ran after terminal kill: damage=%v hp=%v stop=%v process=%+v", state.report.Totals().SourceDamageDealt, state.combatantHp("target"), state.loop.Reason(), state.actions.ProcessAt(0))
	}
	anchoredBoundaryAssertWindow(t, state, 0, 0)
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
	for ev, ok := state.loop.Queue().Pop(); ok; ev, ok = state.loop.Queue().Pop() {
		if ev.Kind == scheduler.GenericEventAnchoredTick && state.effectTimers.AnchoredAt(ev.DriverEntryIndex).ProviderRef == "other_window" {
			ev.Priority = -1
		}
		queued = append(queued, ev)
	}
	for _, ev := range queued {
		if state.loop.Queue().Push(ev) != model.ErrOK {
			t.Fatal("restore test queue")
		}
	}
	var original []scheduler.GenericEvent
	for ev, ok := state.loop.Queue().Pop(); ok; ev, ok = state.loop.Queue().Pop() {
		original = append(original, ev)
	}
	for _, ev := range original {
		state.loop.Queue().Push(ev)
	}
	timer, _ := state.loop.Queue().Pop()
	selected, err := state.selectAnchoredTerminalBeforeProcessTimer(timer)
	if err != nil || selected.Kind != scheduler.GenericEventAnchoredTick || selected.Priority != -1 {
		t.Fatalf("wrong selected terminal: %+v err=%+v", selected, err)
	}
	var restored []scheduler.GenericEvent
	for ev, ok := state.loop.Queue().Pop(); ok; ev, ok = state.loop.Queue().Pop() {
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
	state.loop.Queue().Push(selected)
	for _, ev := range restored {
		state.loop.Queue().Push(ev)
	}
	state.budget.MaxCommandsPerEvent = 2 // each terminal independently spends damage + cleanup.
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	var providers []string
	for _, ev := range state.report.Snapshot().Evidence.Items {
		if ev.Kind == model.EvidenceKindProviderTick {
			providers = append(providers, ev.Ref)
		}
	}
	if !reflect.DeepEqual(providers, []string{"other_window", "champion:source_demo"}) || state.report.Totals().SourceDamageDealt != 20 || state.budgetCause != "" || state.effectTimers.HasTerminals() {
		t.Fatalf("terminal order/budget/index mismatch: order=%v damage=%v budget=%v active=%v", providers, state.report.Totals().SourceDamageDealt, state.budgetCause, state.effectTimers.HasTerminals())
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
	if state.report.Totals().SourceDamageDealt != 0 || state.budgetCause != model.BudgetCauseMaxCommandsPerEvent || state.actions.ProcessAt(0).Status() != "active" {
		t.Fatalf("failed terminal published effects or continued process: damage=%v budget=%v process=%+v", state.report.Totals().SourceDamageDealt, state.budgetCause, state.actions.ProcessAt(0))
	}
	done := state.buildDoneResult(false)
	for _, ref := range []string{"champion:source_demo", "other_window"} {
		target := sourceProviderState(t, done.FinalSnapshot, ref)["targetState"].(map[string]interface{})
		if target["values"].(map[string]interface{})[anchoredVenomStateKey] != float64(1) || target["expireAt"].(map[string]interface{})[anchoredVenomStateKey] != float64(1000) {
			t.Fatalf("failed callback swallowed pending window %s: %+v", ref, target)
		}
	}
}

func TestAnchoredTerminalSelectionRejectsStaleAndForeignIdentity(t *testing.T) {
	for _, invalid := range []string{"generation", "target", "source", "owner", "provider", "state", "expiry", "cleared"} {
		t.Run(invalid, func(t *testing.T) {
			c, r := anchoredBoundaryFixture(t, 0, false)
			state := anchoredBoundaryStateBeforeExpiry(t, c, r)
			payload := state.effectTimers.AnchoredAt(0)
			owner := state.combatants["source"]
			bag := owner.providerState.Edit("champion:source_demo", false)
			state.combatants["source"] = owner
			switch invalid {
			case "generation":
				bag.BumpAnchoredTickGeneration(anchoredVenomStateKey)
			case "target":
				payload.TargetKey = "source"
			case "source":
				payload.SourceKey = "target"
			case "owner":
				payload.OwnerKey = "target"
			case "provider":
				payload.ProviderRef = "not_mounted"
			case "state":
				payload.AnchorStateKey = "not_anchored"
			case "expiry":
				payload.ExpectedExpireAt++
			case "cleared":
				bag.SetTargetValue(anchoredVenomStateKey, 0)
				bag.SetTargetExpireAt(anchoredVenomStateKey, 0)
			}
			anchored := anchoredPayloadsForTest(state)
			anchored[0] = payload
			replaceEffectTimePayloadsForTest(state, expiryPayloadsForTest(state), anchored, true)
			timer, _ := state.loop.Queue().Pop()
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
	if state.effectTimers.HasTerminals() {
		t.Fatal("unanchored legacy run created a terminal fact")
	}
}

func TestAnchoredTerminalFailedEnqueueDoesNotGrantHold(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, false)
	state := anchoredBoundaryStateBeforeExpiry(t, c, r)
	owner := state.combatants["source"]
	bag := owner.providerState.Edit("champion:source_demo", false)
	state.combatants["source"] = owner
	bag.ClearInclusiveAtExpiryHold()
	replaceEffectTimePayloadsForTest(state, expiryPayloadsForTest(state), anchoredPayloadsForTest(state), false)
	state.loop.Queue().SetLimit(state.loop.Queue().Len())
	state.enqueueAnchoredTickAt(1000, state.effectTimers.AnchoredAt(0))
	// 若失败入队仍授予了hold，精确期限的惰性到期就会错误保留该值。
	bag.LazyExpireProviderTargetState(1000)
	if state.effectTimers.HasTerminals() || bag.TargetValues().At(anchoredVenomStateKey) != 0 || bag.TargetExpireAt().At(anchoredVenomStateKey) != 0 || state.budgetCause != model.BudgetCauseMaxQueueEvents {
		t.Fatalf("rejected terminal granted authority: bag=%+v active=%v budget=%v", bag.View(), state.effectTimers.HasTerminals(), state.budgetCause)
	}
}

func TestAnchoredWindowWithoutTerminalRetainsOrdinaryExpiry(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, false)
	anchoredBoundarySkillPlan(&c, &r)
	c.SharedProviders[0].Abilities[0].TickSpec.IntervalMs = 1500 // no tick lies within the 1000ms window.
	state := anchoredBoundaryStateBeforeExpiry(t, c, r)
	owner := state.combatants["source"]
	projection := owner.providerState.Clone()
	bag := projection.Edit("champion:source_demo", false)
	bag.LazyExpireProviderTargetState(1000)
	if state.effectTimers.HasTerminals() || bag.TargetValues().At(anchoredVenomStateKey) != 0 || bag.TargetExpireAt().At(anchoredVenomStateKey) != 0 {
		t.Fatalf("window without a real terminal gained a hold/index: %+v", bag.View())
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	if len(anchoredTickTimes(state.buildDoneResult(false))) != 0 {
		t.Fatal("window with no scheduled terminal executed a callback")
	}
	anchoredBoundaryAssertWindow(t, state, 0, 0)
}

func TestAnchoredTerminalHoldLosesAuthorityWhenDeadlineOrGenerationChanges(t *testing.T) {
	for _, change := range []string{"deadline", "generation"} {
		t.Run(change, func(t *testing.T) {
			c, r := anchoredBoundaryFixture(t, 0, false)
			state := anchoredBoundaryStateBeforeExpiry(t, c, r)
			owner := state.combatants["source"]
			bag := owner.providerState.Edit("champion:source_demo", false)
			state.combatants["source"] = owner
			now := int64(1000)
			if change == "deadline" {
				bag.SetTargetExpireAt(anchoredVenomStateKey, 900)
				now = 900
			} else {
				bag.BumpAnchoredTickGeneration(anchoredVenomStateKey)
			}
			bag.LazyExpireProviderTargetState(now)
			if bag.TargetValues().At(anchoredVenomStateKey) != 0 || bag.TargetExpireAt().At(anchoredVenomStateKey) != 0 {
				t.Fatalf("stale queued terminal hold authorized a changed window: %+v", bag)
			}
		})
	}
}
