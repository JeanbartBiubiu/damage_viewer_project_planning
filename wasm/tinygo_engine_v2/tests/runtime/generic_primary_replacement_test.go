// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	os "os"
	filepath "path/filepath"
	reflect "reflect"
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
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

func TestPrimaryReplacementRootEventsKeepActualIdentityAndDepth(t *testing.T) {
	for _, amount := range []float64{0, 100} {
		t.Run(itoaRuntime(int(amount)), func(t *testing.T) {
			c, r := primaryReplacementInput(t, "root_payload", 2000, 1300)
			c.SharedProviders[1].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = timedShieldExpr(amount)
			ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "event/damage_dealt", Domain: "event"}, model.TypeCatalogEntry{Key: "event/damage_dealt/basic_attack", Domain: "event"})
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
		done, err := runtimeengine.RunGeneric(compiled, r)
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

func TestPrimaryReplacementMomentsAreNotRootContributions(t *testing.T) {
	c, r := primaryReplacementInput(t, "moments", 2000, 1300)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "event/damage_dealt", Domain: "event"}, model.TypeCatalogEntry{Key: "event/damage_dealt/basic_attack", Domain: "event"})
	c.SharedProviders[1].Processes[0].MomentOperations = append(c.SharedProviders[1].Processes[0].MomentOperations, model.ProcessMomentOperations{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physics", Ref: "moment_damage", Amount: timedShieldExpr(3)}}})
	done := authoringRun(t, c, r)
	events := damageDealtEmittedEvidence(done)
	if len(events) != 2 || events[1].Data["rawAmount"] != float64(100) || replacementRow(t, done).PostDefenseDamage != 100 || done.Summary.SourceDamageDealt != 113 {
		t.Fatal(events, done.Summary)
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
