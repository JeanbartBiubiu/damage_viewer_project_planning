package runtime

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/shield"
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

func savePrimaryCase(t *testing.T, c model.CompileRequest, r model.RunRequest, done model.DoneResult) {
	t.Helper()
	if os.Getenv("DAMAGE_PRIMARY_DUMP") != "1" {
		return
	}
	dir := filepath.Join("..", "..", "target", "w-primary-integration-2026-10-19", "native-cases", strings.ReplaceAll(t.Name(), "/", "--"))
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		name  string
		value any
	}{{"input", map[string]any{"compileRequest": c, "runRequest": r}}, {"done", done}} {
		raw, err := json.MarshalIndent(entry.value, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, entry.name+".json"), raw, 0644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPrimaryReplacementOrderedIndependentSources(t *testing.T) {
	for _, before := range []bool{false, true} {
		for _, additive := range []bool{false, true} {
			name := "after"
			if before {
				name = "before"
			}
			if additive {
				name += "_old_additive"
			}
			t.Run(name, func(t *testing.T) {
				c, r := primaryReplacementInput(t, "unrelated_payload", 1500, 2500)
				primaryExtra(&c, before)
				if additive {
					addEmpoweredAttack(t, &c, &r, "untouched_additive", 300, 1500, 23)
				}
				done := authoringRun(t, c, r)
				want := 141.0
				if additive {
					want += 23
				}
				if done.Summary.SourceDamageDealt != want || done.Summary.BasicAttack.HitCount != 3 {
					t.Fatal(done.Summary)
				}
				p := empoweredProcess(t, done, "skill:unrelated_payload_first")
				if p.Status != "complete" || p.EmpoweredAttack == nil || p.EmpoweredAttack.ReplacedPrimary == nil || p.EmpoweredAttack.UseRef != done.AttackRecords[1].UseRef || p.UseKey == p.EmpoweredAttack.UseRef || p.EmpoweredAttack.HitRef != "hit:2" {
					t.Fatal(p)
				}
				identity := *p.EmpoweredAttack.ReplacedPrimary
				if identity.Owner != "source" || identity.ProviderRef != "attack" || identity.DefinitionRef != "test_attack" || identity.StartAbilityRef != r.DriverPlan.BasicAttack.StartAbilityRef || identity.InitialControlAbilityRef != r.DriverPlan.BasicAttack.InitialControlAbilityRef || identity.HitAbilityRef != r.DriverPlan.BasicAttack.HitAbilityRef || identity.CandidateKey != "damage" || identity.EffectOccurrenceKey != "attack_hit" || identity.EffectKey != "body_effect" || identity.ResultKey != "damage" {
					t.Fatal(identity)
				}
				row := replacementRow(t, done)
				if row.Primary != identity || row.Target != "target" || row.Replacement.Owner != "source" || row.Replacement.ProviderRef != "unrelated_payload" || row.Replacement.DefinitionRef != "unrelated_payload_definition" || row.Replacement.SkillKey != "unrelated_payload" || row.Replacement.ProcessKey != "cast" || row.Replacement.HitAbilityRef != "source.provider[unrelated_payload].ability[hit]" || row.Count != 1 || row.BlockedCount != 0 || row.PostDefenseDamage != 100 || row.ActualHpLoss != 100 || row.ShieldAbsorbed != 0 {
					t.Fatal(row)
				}
				var order []string
				for _, damage := range done.DamageRecords {
					if damage["hitRef"] == "hit:2" {
						order = append(order, damage["abilityRef"].(string))
					}
				}
				wantOrder := []string{row.Replacement.HitAbilityRef, r.DriverPlan.BasicAttack.HitAbilityRef}
				if before {
					wantOrder[0], wantOrder[1] = wantOrder[1], wantOrder[0]
				}
				if additive {
					wantOrder = append(wantOrder, "source.provider[untouched_additive].ability[hit]")
				}
				if !reflect.DeepEqual(order, wantOrder) {
					t.Fatal(order, wantOrder)
				}
				if len(emittedEventsByRef(done, model.EventTypeBasicAttackHit)) != 3 || len(emittedEventsByRef(done, model.EventTypeHitLinkApplied)) != 3 {
					t.Fatal("parent hit/link changed")
				}
				savePrimaryCase(t, c, r, done)
			})
		}
	}
}

func TestPrimaryReplacementNoWaitZeroAndRecordModes(t *testing.T) {
	for _, amount := range []float64{0, 100} {
		c, r := primaryReplacementInput(t, "recording", 1500, 2500)
		c.SharedProviders[1].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = timedShieldExpr(amount)
		detailed := authoringRun(t, c, r)
		row := replacementRow(t, detailed)
		if row.Count != 1 || row.PostDefenseDamage != amount || detailed.Summary.SourceDamageDealt != 20+amount || detailed.Summary.DamageBreakdown[1].DamageCount != 1 {
			t.Fatal(detailed.Summary)
		}
		for _, mode := range []string{"summary", "zero", "truncated"} {
			run := r
			if mode == "summary" {
				run.OutputMode = model.RunOutputSummary
			} else {
				limit := 0
				if mode == "truncated" {
					limit = 1
				}
				run.RecordBudget = &model.RecordBudget{MaxDamageRecords: &limit, MaxSkillUseRecords: &limit, MaxAttackRecords: &limit, MaxMechanicRecords: &limit}
			}
			done := authoringRun(t, c, run)
			if !reflect.DeepEqual(done.Summary, detailed.Summary) || !reflect.DeepEqual(done.FinalSnapshot, detailed.FinalSnapshot) {
				t.Fatal(mode, "recording changed execution", done.Summary, detailed.Summary)
			}
		}
		raw, err := json.Marshal(detailed.FinalSnapshot.ProcessInstances)
		if err != nil {
			t.Fatal(err)
		}
		var roundtrip []model.ProcessInstanceSnapshot
		if err = json.Unmarshal(raw, &roundtrip); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(roundtrip, detailed.FinalSnapshot.ProcessInstances) {
			t.Fatal("association roundtrip changed")
		}
	}
	c, r := primaryReplacementInput(t, "future", 1500, 199)
	r.DriverPlan.SkillActions[0].FirstAtMs = 199
	done := authoringRun(t, c, r)
	if len(done.Summary.BasicAttack.PrimaryReplacements) != 0 {
		t.Fatal(done.Summary)
	}
	raw, _ := json.Marshal(done)
	if strings.Contains(string(raw), "primaryReplacements") || strings.Contains(string(raw), "replacedPrimary") {
		t.Fatal("unused fields not omitted")
	}
}

func TestPrimaryReplacementCompileAndNativeBindingGates(t *testing.T) {
	for _, variant := range []string{"unknown", "participation", "event_condition", "op_condition", "extra_payload", "primary_on_spell", "replace_on_basic", "two_primary", "missing_binding", "no_self", "primary_shield", "other_parent_shield", "repeat"} {
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
			case "other_parent_shield":
				(*primary)[1].SpellShieldBlockScope = hitScope(model.SpellShieldScopeResult)
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
				state.durationMs = 999
				if err = state.runLoop(); err != nil {
					t.Fatal(err)
				}
				waits := state.freezeEmpoweredWaits("source")
				if len(waits) != 1 {
					t.Fatal(waits)
				}
				state.nowMs = 1000
				if variant == "refresh" {
					state.empoweredWaits[0].StepVersion++
				} else {
					actor := state.combatants["source"]
					for i, p := range actor.providers {
						if p.ProviderRef == "first" {
							actor.providers = append(actor.providers[:i], actor.providers[i+1:]...)
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
				if err == nil || !strings.Contains(err.Message, "multiple live primary") || len(state.basicAttack.summary.PrimaryReplacements) != 0 || state.sourceDamageDealt != 10 {
					t.Fatal(err, state.buildDoneResult().Summary)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if replacementRow(t, state.buildDoneResult()).Count != 1 {
					t.Fatal(state.buildDoneResult().Summary)
				}
			}
		})
	}
}

// Shield fixtures enter the already compiled run through the real lifecycle API;
// this tests the transaction boundary, not continuous-input author admission.
func primaryShieldState(t *testing.T, c model.CompileRequest, r model.RunRequest) *genericRunState {
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
	if err = state.applyProviderInstance("target", "target", "ward_definition", 5000, true, nil); err != nil {
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
				state.durationMs = 999
				if err := state.runLoop(); err != nil {
					t.Fatal(err)
				}
				state.durationMs = 1300
				state.budget.MaxCommandsPerEvent = 2
			}
			err := state.runLoop()
			done := state.buildDoneResult()
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
	state.durationMs = 999
	if err = state.runLoop(); err != nil {
		t.Fatal(err)
	}
	actor := state.combatants["target"]
	actor.shields = []shield.Instance{{ShieldRef: "numeric", Remaining: 50}}
	state.combatants["target"] = actor
	state.durationMs = 1300
	err = state.runLoop()
	done := state.buildDoneResult()
	if err == nil || done.Summary.SourceDamageDealt != 10 || done.Summary.TargetFinalHp != 99990 || len(done.Summary.BasicAttack.PrimaryReplacements) != 0 || state.combatants["target"].shields[0].Remaining != 50 || empoweredProcess(t, done, "skill:atomic_first").Status != "active" {
		t.Fatal(err, done.Summary, state.combatants["target"].shields)
	}
}

func TestPrimaryReplacementRootEventsKeepActualIdentityAndDepth(t *testing.T) {
	for _, amount := range []float64{0, 100} {
		t.Run(itoaRuntime(int(amount)), func(t *testing.T) {
			c, r := primaryReplacementInput(t, "root_payload", 2000, 1300)
			c.SharedProviders[1].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = timedShieldExpr(amount)
			ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: eventTypeDamageDealt, Domain: "event"}, model.TypeCatalogEntry{Key: eventTypeDamageDealtBasicAttack, Domain: "event"})
			done := authoringRun(t, c, r)
			events := damageDealtEmittedEvidence(done)
			want := 1
			if amount > 0 {
				want = 2
			}
			if len(events) != want {
				t.Fatal(events)
			}
			if amount > 0 {
				event := events[1]
				if event.Data["abilityRef"] != "source.provider[root_payload].ability[hit]" || event.Data["useRef"] != "skill:root_payload_first" || event.Data["skillKey"] != "root_payload" || event.Data["empoweredAttack"] == nil || event.Data["rawAmount"] != float64(100) {
					t.Fatal(event)
				}
			}
			savePrimaryCase(t, c, r, done)
		})
	}
}

func TestPrimaryReplacementLethalAndRepeatedSessions(t *testing.T) {
	c, r := primaryReplacementInput(t, "lethal", 2000, 6000)
	hp := authoringSlot(50)
	c.Combatants[1].Attributes["hp"], r.InitialSnapshot.Combatants[1].Attributes["hp"] = hp, hp
	compiled := authoringCompile(t, c)
	r.ExpectedRulesHash = compiled.RulesHash
	var first model.DoneResult
	for i := 0; i < 20; i++ {
		done, err := RunGeneric(compiled, r)
		if err != nil {
			t.Fatal(err)
		}
		if done.Summary.BasicAttack.HitCount != 2 || done.Summary.TargetFinalHp != 0 || *done.Summary.Execution.TargetKilledAtMs != 1000 || replacementRow(t, done).ActualHpLoss != 40 || empoweredProcess(t, done, "skill:lethal_first").Status != "complete" {
			t.Fatal(done.Summary)
		}
		if i == 0 {
			first = done
		} else if !reflect.DeepEqual(done, first) {
			t.Fatal("same compiled session diverged")
		}
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
	makeState := func() *genericRunState {
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
	done := state.buildDoneResult()
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
	state.durationMs = 999
	if err = state.runLoop(); err != nil {
		t.Fatal(err)
	}
	actor := state.combatants["target"]
	actor.shields = []shield.Instance{{ShieldRef: "numeric", Remaining: 50}}
	state.combatants["target"] = actor
	state.durationMs = 1300
	if err = state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult()
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
	done := state.buildDoneResult()
	if err == nil || done.Summary.SourceDamageDealt != 24 || done.Summary.TargetFinalHp != 99976 || len(done.Summary.BasicAttack.PrimaryReplacements) != 0 || empoweredProcess(t, done, "skill:late_error_first").Status != "active" {
		t.Fatal(err, done.Summary)
	}
}

func TestPrimaryReplacementMomentsAreNotRootContributions(t *testing.T) {
	c, r := primaryReplacementInput(t, "moments", 2000, 1300)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: eventTypeDamageDealt, Domain: "event"}, model.TypeCatalogEntry{Key: eventTypeDamageDealtBasicAttack, Domain: "event"})
	c.SharedProviders[1].Processes[0].MomentOperations = append(c.SharedProviders[1].Processes[0].MomentOperations, model.ProcessMomentOperations{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physics", Ref: "moment_damage", Amount: timedShieldExpr(3)}}})
	done := authoringRun(t, c, r)
	events := damageDealtEmittedEvidence(done)
	if len(events) != 2 || events[1].Data["rawAmount"] != float64(100) || replacementRow(t, done).PostDefenseDamage != 100 || done.Summary.SourceDamageDealt != 113 {
		t.Fatal(events, done.Summary)
	}
}

func TestPrimaryReplacementQueueBudgetRollsBackWholeGroup(t *testing.T) {
	c, r := primaryReplacementInput(t, "queue_guard", 2000, 1300)
	c.SharedProviders[1].Processes[0].MomentOperations = append(c.SharedProviders[1].Processes[0].MomentOperations, model.ProcessMomentOperations{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}, Operations: []model.OperationDefinition{{Operation: "shield", Target: "self", ShieldRef: "completion_shield", Amount: timedShieldExpr(25), ShieldDurationMs: timedShieldExpr(100)}}})
	state, err := newGenericRunState(authoringCompile(t, c), r)
	if err != nil {
		t.Fatal(err)
	}
	state.durationMs = 999
	if err = state.runLoop(); err != nil {
		t.Fatal(err)
	}
	state.heap.SetLimit(state.heap.Len())
	state.durationMs = 1300
	err = state.runLoop()
	done := state.buildDoneResult()
	if state.budgetCause != model.BudgetCauseMaxQueueEvents && (err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents) {
		t.Fatal(err, state.budgetCause)
	}
	if done.Summary.SourceDamageDealt != 10 || len(done.Summary.BasicAttack.PrimaryReplacements) != 0 || len(state.combatants["source"].shields) != 0 || empoweredProcess(t, done, "skill:queue_guard_first").Status != "active" {
		t.Fatal(done.Summary, done.FinalSnapshot)
	}
}

func TestPrimaryReplacementReliableAggregationKeepsMountIdentity(t *testing.T) {
	for _, otherMount := range []bool{false, true} {
		c, r := primaryReplacementInput(t, "repeated", 2000, 4500)
		again := r.DriverPlan.SkillActions[0]
		again.InstructionKey, again.FirstAtMs = "again", 2200
		if otherMount {
			mount := c.Combatants[0].Providers[1]
			mount.ProviderRef = "another_mount"
			c.Combatants[0].Providers = append(c.Combatants[0].Providers, mount)
			snapshot := r.InitialSnapshot.Combatants[0].Providers[1]
			snapshot.ProviderRef = "another_mount"
			r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, snapshot)
			binding := c.Rules.SkillActionBindings[0]
			binding.BindingKey, binding.ProviderRef = "another_binding", "another_mount"
			binding.Controls = append([]model.SkillActionControl(nil), binding.Controls...)
			binding.Controls[0].AbilityRef = strings.ReplaceAll(binding.Controls[0].AbilityRef, "[repeated]", "[another_mount]")
			binding.HitBindings = append([]model.SkillActionHitBinding(nil), binding.HitBindings...)
			binding.HitBindings[0].HitAbilityRef = strings.ReplaceAll(binding.HitBindings[0].HitAbilityRef, "[repeated]", "[another_mount]")
			c.Rules.SkillActionBindings = append(c.Rules.SkillActionBindings, binding)
			again.BindingKey, again.AbilityRef = binding.BindingKey, binding.Controls[0].AbilityRef
		}
		r.DriverPlan.SkillActions = append(r.DriverPlan.SkillActions, again)
		done := authoringRun(t, c, r)
		rows := done.Summary.BasicAttack.PrimaryReplacements
		if done.Summary.SourceDamageDealt != 230 {
			t.Fatal(done.Summary)
		}
		if otherMount {
			if len(rows) != 2 || rows[0].Count != 1 || rows[1].Count != 1 || rows[0].Replacement.ProviderRef == rows[1].Replacement.ProviderRef {
				t.Fatal(rows)
			}
		} else if len(rows) != 1 || rows[0].Count != 2 || rows[0].PostDefenseDamage != 200 {
			t.Fatal(rows)
		}
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
