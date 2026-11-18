package execution

import (
	json "encoding/json"
	strings "strings"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func primaryReplacementInput(t *testing.T, family string, window, duration int64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := empoweredInput(t, family, 200, window, duration)
	c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[0].AttackDamageRole = model.AttackDamageRolePrimary
	c.SharedProviders[1].Abilities[1].Operations[0].SkillHit.Candidates[0].AttackDamageRole = model.AttackDamageRoleReplacePrimary
	return c, r
}

func primaryExtra(c *model.CompileRequest, before bool) {
	candidates := &c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates
	extra := (*candidates)[0]
	extra.AttackDamageRole, extra.CandidateKey, extra.EffectOccurrenceKey, extra.EffectKey, extra.ResultKey = "", "extra", "extra_occurrence", "extra_effect", "extra_result"
	extra.Operations = []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physics", Ref: "extra", Amount: timedShieldExpr(7)}}
	if before {
		*candidates = append([]model.SkillHitCandidate{extra}, (*candidates)...)
	} else {
		*candidates = append(*candidates, extra)
	}
}

func replacementRow(t *testing.T, done model.DoneResult) model.BasicAttackPrimaryReplacement {
	t.Helper()
	if done.Summary.BasicAttack == nil || len(done.Summary.BasicAttack.PrimaryReplacements) != 1 {
		t.Fatal(done.Summary)
	}
	return done.Summary.BasicAttack.PrimaryReplacements[0]
}

func TestPrimaryReplacementCompileAndNativeBindingGates(t *testing.T) {
	for _, variant := range []string{"unknown", "participation", "event_condition", "op_condition", "extra_payload", "primary_on_spell", "replace_on_basic", "two_primary", "missing_binding", "no_self", "primary_shield", "repeat"} {
		t.Run(variant, func(t *testing.T) {
			c, _ := primaryReplacementInput(t, "gated", 1500, 2500)
			primary := &c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates
			payload := &c.SharedProviders[1].Abilities[1].Operations[0].SkillHit.Candidates
			switch variant {
			case "unknown":
				(*payload)[0].AttackDamageRole = "other"
			case "participation":
				(*payload)[0].ParticipationCondition = timedShieldExpr(1)
			case "event_condition":
				(*payload)[0].EventValueConditions = []model.SkillHitEventValueCondition{{Key: "blocked", Comparator: "eq", Value: authoringConst(0)}}
			case "op_condition":
				(*payload)[0].Operations[0].Condition = timedShieldExpr(1)
			case "extra_payload":
				extra := (*payload)[0]
				extra.CandidateKey = "other"
				*payload = append(*payload, extra)
			case "primary_on_spell":
				(*payload)[0].AttackDamageRole = model.AttackDamageRolePrimary
			case "replace_on_basic":
				(*primary)[0].AttackDamageRole = model.AttackDamageRoleReplacePrimary
			case "two_primary":
				extra := (*primary)[0]
				extra.CandidateKey = "other"
				*primary = append(*primary, extra)
			case "missing_binding":
				c.Rules.SkillActionBindings = nil
			case "no_self":
				c.SharedProviders[1].Abilities[0].ProcessControl.RequireExplicitSelfTarget = nil
			case "primary_shield":
				(*primary)[0].SpellShieldBlockScope = hitScope(model.SpellShieldScopeResult)
			case "repeat":
				(*payload)[0].Operations[0].RepeatCount = 2
			}
			if result := compilebundle.CompileGeneric(c); result.OK {
				t.Fatal("invalid role admitted")
			}
		})
	}
	c, r := primaryReplacementInput(t, "missing_primary", 1500, 2500)
	c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[0].AttackDamageRole = ""
	if _, err := newGenericRunState(authoringCompile(t, c), r); err == nil {
		t.Fatal("missing actual primary admitted")
	}
	for _, raw := range []string{`null`, `""`, `1`, `true`, `"other"`} {
		var cand model.SkillHitCandidate
		if err := json.Unmarshal([]byte(`{"attackDamageRole":`+raw+`}`), &cand); err == nil {
			t.Fatal(raw, "invalid JSON role admitted")
		}
	}
}

func TestPrimaryReplacementExpiryRefreshRemovalAndConflict(t *testing.T) {
	for _, window := range []int64{799, 800, 801} {
		c, r := primaryReplacementInput(t, "expiry", window, 1200)
		done := authoringRun(t, c, r)
		if window <= 800 {
			if len(done.Summary.BasicAttack.PrimaryReplacements) != 0 || done.Summary.SourceDamageDealt != 20 {
				t.Fatal(window, done.Summary)
			}
		} else if replacementRow(t, done).Count != 1 || done.Summary.SourceDamageDealt != 110 {
			t.Fatal(window, done.Summary)
		}
	}
	for _, variant := range []string{"refresh", "removed", "conflict", "inactive_definition"} {
		t.Run(variant, func(t *testing.T) {
			c, r := primaryReplacementInput(t, "first", 2000, 1300)
			if variant == "conflict" || variant == "inactive_definition" {
				addEmpoweredAttack(t, &c, &r, "second", 300, 2000, 200)
				c.SharedProviders[2].Abilities[1].Operations[0].SkillHit.Candidates[0].AttackDamageRole = model.AttackDamageRoleReplacePrimary
				if variant == "inactive_definition" {
					r.DriverPlan.SkillActions[1].FirstAtMs = 1200
				}
			}
			state, err := newGenericRunState(authoringCompile(t, c), r)
			if err != nil {
				t.Fatal(err)
			}
			if variant == "refresh" || variant == "removed" {
				runPrefixThroughForTest(t, state, 999)
				waits := state.freezeEmpoweredWaits("source")
				if len(waits) != 1 {
					t.Fatal(waits)
				}
				state.loop.Advance(1000)
				if variant == "refresh" {
					process := state.actions.EmpoweredAt(0)
					row := process.Snapshot()
					row.StepVersion++
					changed := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: row, Definition: process.Definition(), Ability: process.Ability(), AbilityRef: process.AbilityRef(), StepIndex: process.StepIndex()})
					actionpkg.StageProcess(changed).Publish(process)
				} else {
					actor := state.combatants["source"]
					for i, instanceValues := 0, actor.instances.Providers(); i < instanceValues.Len(); i++ {
						p := instanceValues.At(i)
						if p.ProviderRef == "first" {
							actor.instances.SetProviders(actor.instances.Providers().Slice(0, i).AppendList(actor.instances.Providers().Slice(i+1, actor.instances.Providers().Len())))
							break
						}
					}
					state.combatants["source"] = actor
				}
				if state.empoweredWaitCurrent(waits[0], "source") {
					t.Fatal("stale frozen wait remained eligible")
				}
				return
			}
			err = state.runLoop()
			if variant == "conflict" {
				if err == nil || !strings.Contains(err.Message, "multiple live primary") || len(state.actions.BasicAttack().Summary().PrimaryReplacements) != 0 || state.report.Totals().SourceDamageDealt != 10 {
					t.Fatal(err, state.buildDoneResult(false).Summary)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if replacementRow(t, state.buildDoneResult(false)).Count != 1 {
					t.Fatal(state.buildDoneResult(false).Summary)
				}
			}
		})
	}
}

// Shield fixtures enter the already compiled run through the real lifecycle API;
// this tests the transaction boundary, not continuous-input author admission.
func primaryShieldState(t *testing.T, c model.CompileRequest, r model.RunRequest) *Engine {
	t.Helper()
	full := authoringCompile(t, c)
	plain := c
	plain.SharedProviders = append([]model.ProviderDefinition(nil), c.SharedProviders[:len(c.SharedProviders)-1]...)
	state, err := newGenericRunState(authoringCompile(t, plain), r)
	if err != nil {
		t.Fatal(err)
	}
	state.compiled, state.formulas = full, full.Formulas
	hit := full.AbilityRefIndex[r.DriverPlan.BasicAttack.HitAbilityRef]
	if err := state.bindBasicAttackPrimary(full.Abilities[hit.AbilityIndex], "attack"); err != nil {
		t.Fatal(err)
	}
	if err = state.applyProviderInstance("target", "target", "ward_definition", 5000, true, effectpkg.ContributionView{}); err != nil {
		t.Fatal(err)
	}
	return state
}

func TestPrimaryReplacementBlockedAndShieldRollback(t *testing.T) {
	for _, variant := range []string{"blocked", "shield_listener_error", "completion_error", "command_budget"} {
		t.Run(variant, func(t *testing.T) {
			c, r := primaryReplacementInput(t, "warded", 2000, 1300)
			payload := &c.SharedProviders[1].Abilities[1].Operations[0].SkillHit.Candidates[0]
			payload.SpellShieldBlockScope = hitScope(model.SpellShieldScopeResult)
			if variant == "completion_error" {
				c.SharedProviders[1].Processes[0].MomentOperations = append(c.SharedProviders[1].Processes[0].MomentOperations, model.ProcessMomentOperations{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}, Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: authoringAmount(model.GenericFormulaExpr{Op: "div", Args: []model.GenericFormulaExpr{authoringConst(1), authoringConst(0)}})}}})
			}
			mountEmpoweredSpellShield(&c, &r, false)
			if variant == "shield_listener_error" {
				ops := &c.SharedProviders[len(c.SharedProviders)-1].Listeners[0].Operations
				*ops = append(*ops, model.OperationDefinition{Operation: "heal", Target: "self", Amount: authoringAmount(model.GenericFormulaExpr{Op: "div", Args: []model.GenericFormulaExpr{authoringConst(1), authoringConst(0)}})})
			}
			state := primaryShieldState(t, c, r)
			if variant == "command_budget" {
				runPrefixThroughForTest(t, state, 999)
				state.budget.MaxCommandsPerEvent = 2
			}
			err := state.runLoop()
			done := state.buildDoneResult(false)
			p := empoweredProcess(t, done, "skill:warded_first")
			if variant == "blocked" {
				if err != nil {
					t.Fatal(err)
				}
				row := replacementRow(t, done)
				if row.Count != 1 || row.BlockedCount != 1 || row.PostDefenseDamage != 0 || done.Summary.SourceDamageDealt != 10 || p.Status != "complete" || len(done.FinalSnapshot.Combatants[1].Providers) != 0 {
					t.Fatal(row, done.Summary, p)
				}
			} else {
				if err == nil && variant != "command_budget" {
					t.Fatal("missing failure")
				}
				if p.Status != "active" || p.EmpoweredAttack != nil || len(done.Summary.BasicAttack.PrimaryReplacements) != 0 || done.Summary.SourceDamageDealt != 10 || len(done.FinalSnapshot.Combatants[1].Providers) != 1 {
					t.Fatal(err, done.Summary, p, done.FinalSnapshot.Combatants[1])
				}
			}
		})
	}
}

func TestPrimaryReplacementNumericShieldAndLateFailureAreAtomic(t *testing.T) {
	c, r := primaryReplacementInput(t, "atomic", 2000, 1300)
	c.SharedProviders[1].Processes[0].MomentOperations = append(c.SharedProviders[1].Processes[0].MomentOperations, model.ProcessMomentOperations{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}, Operations: []model.OperationDefinition{{Operation: "resource_change", Target: "self", ResourceKey: "missing", Amount: timedShieldExpr(1)}}})
	state, err := newGenericRunState(authoringCompile(t, c), r)
	if err != nil {
		t.Fatal(err)
	}
	runPrefixThroughForTest(t, state, 999)
	actor := state.combatants["target"]
	actor.instances.SetShields(effectpkg.Shields([]effectpkg.Shield{{ShieldRef: "numeric", Remaining: 50}}))
	state.combatants["target"] = actor
	err = state.runLoop()
	done := state.buildDoneResult(false)
	if err == nil || done.Summary.SourceDamageDealt != 10 || done.Summary.TargetFinalHp != 99990 || len(done.Summary.BasicAttack.PrimaryReplacements) != 0 || state.combatants["target"].instances.Shields().At(0).Remaining != 50 || empoweredProcess(t, done, "skill:atomic_first").Status != "active" {
		t.Fatal(err, done.Summary, state.combatants["target"].instances.Shields())
	}
}

func TestPrimaryReplacementNativeHitAndRootListenersStaySeparate(t *testing.T) {
	c, r := primaryReplacementInput(t, "real_root", 2000, 1300)
	addEmpoweredAttack(t, &c, &r, "old_tail", 300, 2000, 23)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: stateScopeProvider, Domain: "state_scope"}, model.TypeCatalogEntry{Key: eventTypeDamageDealt, Domain: "event"}, model.TypeCatalogEntry{Key: eventTypeDamageDealtBasicAttack, Domain: "event"})
	counter := model.ProviderDefinition{ProviderKey: "observer_definition", Kind: "character", StableID: "observer", InitialStateSchema: map[string]interface{}{"hits": float64(0), "roots": float64(0)}}
	for _, entry := range []struct{ key, event string }{{"hits", model.EventTypeBasicAttackHit}, {"roots", eventTypeDamageDealtBasicAttack}} {
		counter.Listeners = append(counter.Listeners, model.ListenerDefinition{ListenerKey: entry.key, MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{entry.event, "event/source_owner"}}, Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Ref: entry.key, Types: []string{stateScopeProvider}, ValuePolicy: "add", Amount: timedShieldExpr(1)}}})
	}
	c.SharedProviders = append(c.SharedProviders, counter)
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "observer", DefinitionRef: counter.ProviderKey})
	r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "observer", DefinitionRef: counter.ProviderKey, Source: "source", Owner: "source", Stacks: 1})
	// The observer is a direct runtime test. Continuous-input admission does
	// not yet admit arbitrary root-damage listeners on natural character data.
	full := authoringCompile(t, c)
	plain := c
	plain.SharedProviders = append([]model.ProviderDefinition(nil), c.SharedProviders...)
	plain.SharedProviders[len(plain.SharedProviders)-1].Listeners = append([]model.ListenerDefinition(nil), counter.Listeners[:1]...)
	makeState := func() *Engine {
		state, err := newGenericRunState(authoringCompile(t, plain), r)
		if err != nil {
			t.Fatal(err)
		}
		state.compiled, state.formulas = full, full.Formulas
		hit := full.AbilityRefIndex[r.DriverPlan.BasicAttack.HitAbilityRef]
		if err = state.bindBasicAttackPrimary(full.Abilities[hit.AbilityIndex], "attack"); err != nil {
			t.Fatal(err)
		}
		return state
	}
	state := makeState()
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	raw, _ := json.Marshal(done.FinalSnapshot.Combatants[0].ProviderState["observer"])
	var saved struct {
		State map[string]float64 `json:"state"`
	}
	if err := json.Unmarshal(raw, &saved); err != nil {
		t.Fatal(err)
	}
	if saved.State["hits"] != 2 || saved.State["roots"] != 2 || done.Summary.SourceDamageDealt != 133 {
		t.Fatal(string(raw), done.Summary)
	}
	state = makeState()
	state.budget.MaxChainDepth = 1
	if err := state.runLoop(); state.budgetCause != model.BudgetCauseMaxChainDepth && (err == nil || err.BudgetCause != model.BudgetCauseMaxChainDepth) {
		t.Fatal("replacement reduced real event depth", err, state.budgetCause)
	}
}

func TestPrimaryReplacementSuccessfulNumericShield(t *testing.T) {
	c, r := primaryReplacementInput(t, "numeric", 2000, 1300)
	state, err := newGenericRunState(authoringCompile(t, c), r)
	if err != nil {
		t.Fatal(err)
	}
	runPrefixThroughForTest(t, state, 999)
	actor := state.combatants["target"]
	actor.instances.SetShields(effectpkg.Shields([]effectpkg.Shield{{ShieldRef: "numeric", Remaining: 50}}))
	state.combatants["target"] = actor
	if err = state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	row := replacementRow(t, done)
	if row.PostDefenseDamage != 100 || row.ShieldAbsorbed != 50 || row.ActualHpLoss != 50 || done.Summary.SourceDamageDealt != 110 || done.Summary.TargetHpLoss != 60 {
		t.Fatal(row, done.Summary)
	}
}

func TestPrimaryReplacementPriorCandidatesSurviveFailure(t *testing.T) {
	c, r := primaryReplacementInput(t, "late_error", 2000, 1300)
	primaryExtra(&c, true)
	c.SharedProviders[1].Processes[0].MomentOperations = append(c.SharedProviders[1].Processes[0].MomentOperations, model.ProcessMomentOperations{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}, Operations: []model.OperationDefinition{{Operation: "resource_change", Target: "self", ResourceKey: "missing", Amount: timedShieldExpr(1)}}})
	state, err := newGenericRunState(authoringCompile(t, c), r)
	if err != nil {
		t.Fatal(err)
	}
	err = state.runLoop()
	done := state.buildDoneResult(false)
	if err == nil || done.Summary.SourceDamageDealt != 24 || done.Summary.TargetFinalHp != 99976 || len(done.Summary.BasicAttack.PrimaryReplacements) != 0 || empoweredProcess(t, done, "skill:late_error_first").Status != "active" {
		t.Fatal(err, done.Summary)
	}
}

func TestPrimaryReplacementQueueBudgetRollsBackWholeGroup(t *testing.T) {
	c, r := primaryReplacementInput(t, "queue_guard", 2000, 1300)
	c.SharedProviders[1].Processes[0].MomentOperations = append(c.SharedProviders[1].Processes[0].MomentOperations, model.ProcessMomentOperations{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}, Operations: []model.OperationDefinition{{Operation: "shield", Target: "self", ShieldRef: "completion_shield", Amount: timedShieldExpr(25), ShieldDurationMs: timedShieldExpr(100)}}})
	state, err := newGenericRunState(authoringCompile(t, c), r)
	if err != nil {
		t.Fatal(err)
	}
	runPrefixThroughForTest(t, state, 999)
	state.loop.SetQueueLimit(state.loop.QueuedEvents())
	err = state.runLoop()
	done := state.buildDoneResult(false)
	if state.budgetCause != model.BudgetCauseMaxQueueEvents && (err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents) {
		t.Fatal(err, state.budgetCause)
	}
	if done.Summary.SourceDamageDealt != 10 || len(done.Summary.BasicAttack.PrimaryReplacements) != 0 || state.combatants["source"].instances.Shields().Len() != 0 || empoweredProcess(t, done, "skill:queue_guard_first").Status != "active" {
		t.Fatal(done.Summary, done.FinalSnapshot)
	}
}

func TestPrimaryReplacementPayloadCannotRunAsOrdinaryCast(t *testing.T) {
	c, r := primaryReplacementInput(t, "no_bypass", 2000, 1300)
	state, err := newGenericRunState(authoringCompile(t, c), r)
	if err != nil {
		t.Fatal(err)
	}
	ref := "source.provider[no_bypass].ability[hit]"
	index := state.compiled.AbilityRefIndex[ref]
	ability := state.compiled.Abilities[index.AbilityIndex]
	f := state.newExecutionFrame("source", "target", ref)
	f.driverEntryKey = "ordinary_cast"
	err = f.resolveSkillHit(state.compiled.Operations[ability.OperationStart], ability)
	if err == nil || !strings.Contains(err.Message, "actual empowered") {
		t.Fatal(err)
	}
}
