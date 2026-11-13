// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	fmt "fmt"
	reflect "reflect"
	strings "strings"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

// 三段各100，时间250/1000/1750；后两段只依赖第一段真实接触。
func stagedSkillInput(count int) (model.CompileRequest, model.RunRequest) {
	c, r := singleSkillInput(false)
	p, binding := &c.SharedProviders[0], &c.Rules.SkillActionBindings[0]
	p.Processes[0].Steps = nil
	p.Processes[0].Cooldown.DurationMs = *timedShieldExpr(10000)
	p.Abilities = p.Abilities[:1]
	binding.HitBindings = nil
	r.DriverPlan.SkillActions[0].FirstAtMs = 0
	r.DriverPlan.SkillActions[0].HitBindings = nil
	r.StopPolicy.DurationMs = 1900
	r.Sampling.Disabled = true
	for index := 0; index < count; index++ {
		key := fmt.Sprintf("phase_%02d", index)
		delay := float64(750)
		if index == 0 {
			delay = 250
		}
		p.Processes[0].Steps = append(p.Processes[0].Steps, model.ProcessStepDefinition{StepKey: key, StepType: "DELAY", DelayMs: timedShieldExpr(delay), OccupiesAction: model.BoolPtr(index == 0)})
		candidate := damageCand(key, key, key, model.SpellShieldScopeDamageInstance, 0)
		p.Abilities = append(p.Abilities, model.AbilityDefinition{AbilityKey: key, Kind: "active", SkillKey: binding.SkillKey,
			Operations: []model.OperationDefinition{{Operation: model.OperationKindResolveSkillHit, Target: "target", SkillHit: &model.SkillHitDefinition{SkillKey: binding.SkillKey, Candidates: []model.SkillHitCandidate{candidate}}}}})
		hit := model.SkillActionHitBinding{HitBindingKey: key, ProcessKey: "cast", Moment: model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: hitUse(key)}, HitAbilityRef: "source.provider[caster].ability[" + key + "]"}
		if index > 0 {
			hit.RequiresPriorHitBindingKey = hitUse("phase_00")
		}
		binding.HitBindings = append(binding.HitBindings, hit)
		r.DriverPlan.SkillActions[0].HitBindings = append(r.DriverPlan.SkillActions[0].HitBindings, model.SkillActionHitPreset{HitBindingKey: key, Preset: "TARGET_HIT"})
	}
	return c, r
}

func stagedAutomatic(r *model.RunRequest, binding model.SkillActionBinding) {
	r.DriverPlan.SkillActions = []model.SkillActionPlan{}
	r.DriverPlan.AutomaticSkills = &model.AutomaticSkillPlan{Rules: []model.AutomaticSkillRule{{RuleKey: "staged", BindingKey: binding.BindingKey, SortOrder: 0, Target: "target", WaitForCooldowns: []string{}, HitBindings: []model.SkillActionHitPreset{}}}}
	for _, hit := range binding.HitBindings {
		r.DriverPlan.AutomaticSkills.Rules[0].HitBindings = append(r.DriverPlan.AutomaticSkills.Rules[0].HitBindings, model.SkillActionHitPreset{HitBindingKey: hit.HitBindingKey, Preset: "TARGET_HIT"})
	}
}

func stagedAddSpellShield(c *model.CompileRequest, moment model.ProcessMomentDefinition) {
	skillHitCatalog(c)
	found := false
	for _, provider := range c.SharedProviders {
		found = found || provider.ProviderKey == "shield:spell"
	}
	if !found {
		shield := spellShieldProvider()
		shield.Listeners[0].Operations = shield.Listeners[0].Operations[1:]
		c.SharedProviders = append(c.SharedProviders, shield)
	}
	c.SharedProviders[0].Processes[0].MomentOperations = append(c.SharedProviders[0].Processes[0].MomentOperations, model.ProcessMomentOperations{Moment: moment,
		Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "shield:spell"}}})
}

func TestStagedSkillThreeContactsMissAndBlock(t *testing.T) {
	for _, automatic := range []bool{false, true} {
		for _, kind := range []string{"hit", "first_miss", "middle_miss", "first_blocked", "later_shield"} {
			t.Run(fmt.Sprintf("automatic_%v/%s", automatic, kind), func(t *testing.T) {
				c, r := stagedSkillInput(3)
				if automatic {
					stagedAutomatic(&r, c.Rules.SkillActionBindings[0])
				}
				presets := r.DriverPlan.SkillActions
				setMiss := func(index int) {
					if automatic {
						r.DriverPlan.AutomaticSkills.Rules[0].HitBindings[index].Preset = "MISS"
					} else {
						presets[0].HitBindings[index].Preset = "MISS"
					}
				}
				wantDamage, wantHits, wantReleases := float64(300), 3, 3
				switch kind {
				case "first_miss":
					setMiss(0)
					wantDamage, wantHits, wantReleases = 0, 0, 1
				case "middle_miss":
					setMiss(1)
					wantDamage, wantHits = 200, 2
				case "first_blocked":
					stagedAddSpellShield(&c, model.ProcessMomentDefinition{MomentType: "PROCESS_START"})
					wantDamage = 200
				case "later_shield":
					stagedAddSpellShield(&c, model.ProcessMomentDefinition{MomentType: "STEP_START", StepKey: hitUse("phase_01")})
					wantDamage = 200
				}
				done := timedShieldMustRun(t, c, r)
				if !done.Summary.Execution.Complete || done.Summary.SourceDamageDealt != wantDamage || done.Summary.SkillUses.HitCount != wantHits || done.Summary.SkillUses.ReleasedCount != wantReleases || done.Summary.SkillUses.StepExecutedCount != 3 || done.Summary.SkillUses.CompletedCount != 1 {
					t.Fatal(done.Summary)
				}
				if kind == "hit" {
					for index, at := range []int64{250, 1000, 1750} {
						if done.DamageRecords[index]["timeMs"] != at || done.DamageRecords[index]["useRef"] == nil {
							t.Fatal(done.DamageRecords)
						}
					}
				}
				stages := *done.FinalSnapshot.ProcessInstances[0].SkillHitStages
				if len(stages) != 3 {
					t.Fatal("missing immutable stage facts", stages)
				}
				for index, stage := range stages {
					wantRelease := kind != "first_miss" || index == 0
					wantContact := wantRelease && !(kind == "first_miss" && index == 0 || kind == "middle_miss" && index == 1)
					if stage.Released != wantRelease || stage.Contact != wantContact || !stage.Completed || stage.TimeMs != []int64{250, 1000, 1750}[index] {
						t.Fatal(kind, stages)
					}
				}
			})
		}
	}
}

func TestStagedSkillZeroRecordsSummaryAndRepeatedRuns(t *testing.T) {
	c, r := stagedSkillInput(3)
	stagedAutomatic(&r, c.Rules.SkillActionBindings[0])
	expected := timedShieldMustRun(t, c, r)
	zero := 0
	r.RecordBudget = &model.RecordBudget{MaxDamageRecords: &zero, MaxSkillUseRecords: &zero, MaxSkillActionRecords: &zero, MaxAutomaticSkillRecords: &zero, MaxHealingRecords: &zero}
	for _, mode := range []model.RunOutputMode{model.RunOutputDetailed, model.RunOutputSummary} {
		r.OutputMode = mode
		compiled := compilebundle.CompileGeneric(c)
		var previous model.DoneResult
		for index := 0; index < 5; index++ {
			done, err := runtimeengine.RunGeneric(compiled.Session, r)
			if err != nil || done.Summary.SourceDamageDealt != expected.Summary.SourceDamageDealt || !reflect.DeepEqual(done.Summary.SkillUses, expected.Summary.SkillUses) || len(done.DamageRecords)+len(done.SkillUseRecords)+len(done.AutomaticSkillRecords) != 0 || !reflect.DeepEqual(done.FinalSnapshot.ProcessInstances[0].SkillHitStages, expected.FinalSnapshot.ProcessInstances[0].SkillHitStages) {
				t.Fatal(mode, err, done.Summary)
			}
			if index > 0 && !reflect.DeepEqual(previous, done) {
				t.Fatal("repeat changed result")
			}
			previous = done
		}
	}
}

func TestStagedSkillContactIsolationAcrossSourceMounts(t *testing.T) {
	c, r := stagedSkillInput(3)
	for index := range c.SharedProviders[0].Processes[0].Steps {
		c.SharedProviders[0].Processes[0].Steps[index].OccupiesAction = model.BoolPtr(false)
	}
	encoded, err := json.Marshal(c.SharedProviders[0])
	if err != nil {
		t.Fatal(err)
	}
	var provider model.ProviderDefinition
	if err := json.Unmarshal([]byte(strings.NewReplacer("skill_source", "other_definition", "configured_spell", "other_spell").Replace(string(encoded))), &provider); err != nil {
		t.Fatal(err)
	}
	c.SharedProviders = append(c.SharedProviders, provider)
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "other", DefinitionRef: "other_definition"})
	r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "other", DefinitionRef: "other_definition", Owner: "source", Source: "source", Stacks: 1})
	encoded, _ = json.Marshal(c.Rules.SkillActionBindings[0])
	var binding model.SkillActionBinding
	if err := json.Unmarshal([]byte(strings.NewReplacer("bound_spell", "other_binding", "skill_source", "other_definition", "configured_spell", "other_spell", "provider[caster]", "provider[other]").Replace(string(encoded))), &binding); err != nil {
		t.Fatal(err)
	}
	binding.ProviderRef = "other"
	c.Rules.SkillActionBindings = append(c.Rules.SkillActionBindings, binding)
	other := r.DriverPlan.SkillActions[0]
	other.InstructionKey, other.SkillKey, other.BindingKey, other.AbilityRef, other.SortOrder = "other_use", "other_spell", "other_binding", binding.Controls[0].AbilityRef, 1
	other.HitBindings = append([]model.SkillActionHitPreset(nil), other.HitBindings...)
	other.HitBindings[0].Preset = "MISS"
	r.DriverPlan.SkillActions = append(r.DriverPlan.SkillActions, other)
	done := timedShieldMustRun(t, c, r)
	if done.Summary.SourceDamageDealt != 300 || done.Summary.SkillUses.HitCount != 3 || done.Summary.SkillUses.ReleasedCount != 4 || done.Summary.SkillUses.StartedCount != 2 {
		t.Fatal(done.Summary)
	}
}

func TestStagedSkillTwoContactsBlockIndependently(t *testing.T) {
	for _, shieldAt := range []string{"none", "early", "late"} {
		t.Run(shieldAt, func(t *testing.T) {
			c, r := stagedSkillInput(2)
			c.SharedProviders[0].Processes[0].Steps[0].DelayMs = timedShieldExpr(1250)
			c.SharedProviders[0].Processes[0].Steps[0].OccupiesAction = model.BoolPtr(false)
			c.SharedProviders[0].Processes[0].Steps[1].DelayMs = timedShieldExpr(600)
			c.SharedProviders[0].Processes[0].Steps[1].OccupiesAction = model.BoolPtr(true)
			c.Rules.SkillActionBindings[0].HitBindings[1].RequiresPriorHitBindingKey = nil
			skillHitCatalog(&c)
			airborne := stunProvider()
			airborne.ProviderKey, airborne.StableID = "status:airborne", "airborne"
			airborne.Types = []string{model.ClosedStatusKindProviderType[model.StatusKindAirborne]}
			airborne.Lifecycle.DurationMs = timedShieldExpr(600)
			stun := stunProvider()
			stun.Lifecycle.DurationMs = timedShieldExpr(750)
			c.SharedProviders = append(c.SharedProviders, airborne, stun)
			ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: airborne.Types[0], Domain: "provider"})
			early := stunCand("airborne", "early", "airborne", model.SpellShieldScopeResult)
			early.Semantic.Moment, early.Semantic.StatusKey, early.Semantic.StatusKind = model.SkillHitMomentPersistent, "airborne", model.StatusKindAirborne
			early.Operations[0].ProviderDefinitionRef = airborne.ProviderKey
			late := stunCand("stun", "late", "stun", model.SpellShieldScopeResult)
			late.Semantic.Moment = model.SkillHitMomentPersistent
			c.SharedProviders[0].Abilities[1].Operations[0].SkillHit.Candidates = []model.SkillHitCandidate{early}
			c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates = []model.SkillHitCandidate{damageCand("burst", "late", "damage", model.SpellShieldScopeSkill, 0), late}
			if shieldAt == "early" {
				stagedAddSpellShield(&c, model.ProcessMomentDefinition{MomentType: "PROCESS_START"})
			} else if shieldAt == "late" {
				stagedAddSpellShield(&c, model.ProcessMomentDefinition{MomentType: "STEP_START", StepKey: hitUse("phase_01")})
			}
			done := timedShieldMustRun(t, c, r)
			wantDamage := float64(100)
			if shieldAt == "late" {
				wantDamage = 0
			}
			if done.Summary.SourceDamageDealt != wantDamage || done.Summary.SkillUses.HitCount != 2 {
				t.Fatal(done.Summary)
			}
			hits := skillHitItems(done)
			if len(hits) != 2 || hits[0].TimeMs != 1250 || hits[1].TimeMs != 1850 || hits[1].Data["reused"] != false {
				t.Fatal("contacts merged into one use-wide shield block", hits)
			}
			if shieldAt == "early" && (hits[0].Data["blocked"] != float64(1) || hits[1].Data["blocked"] != float64(0)) || shieldAt == "late" && (hits[0].Data["blocked"] != float64(0) || hits[1].Data["blocked"] != float64(1)) {
				t.Fatal(hits)
			}
			hasStun := false
			for _, provider := range done.FinalSnapshot.Combatants[1].Providers {
				hasStun = hasStun || provider.DefinitionRef == "status:stun"
			}
			if hasStun != (shieldAt != "late") {
				t.Fatal("landing damage and stun did not share one block", done.FinalSnapshot.Combatants[1].Providers)
			}
			facts := *done.FinalSnapshot.ProcessInstances[0].SkillHitStages
			if len(facts) != 2 || facts[0].TimeMs != 1250 || facts[1].TimeMs != 1850 || !facts[0].Contact || !facts[1].Contact {
				t.Fatal(facts)
			}
		})
	}
}

func TestStagedSkillPreparationAllowsExistingActionsAndLocksNewOnes(t *testing.T) {
	for _, siblingAt := range []int64{1200, 1250} {
		c, r := continuousAttackInput(2, 10000, 10, 0, 0, 2100)
		addMixedSpell(&c, &r, "preparing", 0, 1250, false)
		process := &c.SharedProviders[1].Processes[0]
		process.Steps[0].StepKey = "prepare"
		process.Steps = append(process.Steps, model.ProcessStepDefinition{StepKey: "cast", StepType: "DELAY", DelayMs: timedShieldExpr(600), OccupiesAction: model.BoolPtr(true)})
		c.Rules.SkillActionBindings[0].HitBindings[0].Moment = model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: hitUse("cast")}
		addMixedSpell(&c, &r, "sibling", siblingAt, 250, true)
		done := authoringRun(t, c, r)
		for index, at := range []int64{0, 500, 1000, 1850} {
			if len(done.AttackRecords) != 4 || done.AttackRecords[index].StartAtMs != at {
				t.Fatal("preparation occupied the whole delay or final lock was missed", done.AttackRecords)
			}
		}
		mainDamage := false
		for _, damage := range done.DamageRecords {
			if damage["instructionKey"] == "preparing_first" {
				mainDamage = damage["timeMs"] == int64(1850)
			}
		}
		if !mainDamage {
			t.Fatal("final damage moved from 1850", done.DamageRecords)
		}
		if siblingAt == 1200 && done.Summary.SkillActions.AcceptedCount != 2 || siblingAt == 1250 && (done.Summary.SkillActions.RejectedCount != 1 || *done.SkillActionRecords[1].Reason != "action_occupied") {
			t.Fatal(done.Summary, done.SkillActionRecords)
		}
	}
}

func TestStagedSkillAutomaticPreparationPreservesBackgroundAttacks(t *testing.T) {
	c, r := continuousAttackInput(2, 10000, 10, 0, 0, 2100)
	addMixedSpell(&c, &r, "preparing", 0, 1250, false)
	process := &c.SharedProviders[1].Processes[0]
	process.Cooldown.DurationMs = *timedShieldExpr(10000)
	process.Steps[0].StepKey = "prepare"
	process.Steps = append(process.Steps, model.ProcessStepDefinition{StepKey: "cast", StepType: "DELAY", DelayMs: timedShieldExpr(600), OccupiesAction: model.BoolPtr(true)})
	c.Rules.SkillActionBindings[0].HitBindings[0].Moment = model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: hitUse("cast")}
	stagedAutomatic(&r, c.Rules.SkillActionBindings[0])
	done := authoringRun(t, c, r)
	if done.Summary.SkillUses.HitCount != 1 || done.Summary.SkillUses.CompletedCount != 1 || !done.Summary.Execution.Complete || len(done.AttackRecords) != 4 {
		t.Fatal(done.Summary)
	}
	for index, at := range []int64{0, 500, 1000, 1850} {
		if done.AttackRecords[index].StartAtMs != at {
			t.Fatal(done.AttackRecords)
		}
	}
	for _, row := range done.FinalSnapshot.ProcessInstances {
		if row.SkillKey == "preparing" {
			if *row.FinishedAtMs != 1850 || len(row.ActionOccupancies) != 1 || row.ActionOccupancies[0].StartedAtMs != 1250 || *row.ActionOccupancies[0].FinishedAtMs != 1850 || row.SkillHitStages == nil || len(*row.SkillHitStages) != 1 || (*row.SkillHitStages)[0].TimeMs != 1850 {
				t.Fatal(row)
			}
		}
	}
}

func TestStagedSkillEmptyBeforeExecutionAndSimpleCompletionFacts(t *testing.T) {
	for _, automatic := range []bool{false, true} {
		c, r := stagedSkillInput(3)
		r.StopPolicy.DurationMs = 249
		if automatic {
			stagedAutomatic(&r, c.Rules.SkillActionBindings[0])
		}
		done := timedShieldMustRun(t, c, r)
		row := done.FinalSnapshot.ProcessInstances[0]
		encoded, err := json.Marshal(row)
		if err != nil || row.SkillHitStages == nil || len(*row.SkillHitStages) != 0 || !strings.Contains(string(encoded), `"skillHitStages":[]`) || done.Summary.SkillUses.HitCount != 0 {
			t.Fatal("unexecuted stage was omitted or invented", automatic, string(encoded), err)
		}
	}
	for _, complex := range []bool{false, true} {
		c, r := singleSkillInput(false)
		if complex {
			c, r = complexSkillInput("CHANNEL", false)
		}
		done := timedShieldMustRun(t, c, r)
		encoded, err := json.Marshal(done.FinalSnapshot.ProcessInstances[0])
		if err != nil {
			t.Fatal(err)
		}
		if complex {
			if done.FinalSnapshot.ProcessInstances[0].SkillHitStages != nil || strings.Contains(string(encoded), "skillHitStages") {
				t.Fatal("complex process gained unsupported stage facts", string(encoded))
			}
		} else {
			facts := done.FinalSnapshot.ProcessInstances[0].SkillHitStages
			if facts == nil || len(*facts) != 1 || !(*facts)[0].Contact || (*facts)[0].TimeMs != 350 || (*facts)[0].HitOccurrenceID == nil {
				t.Fatal("simple completion omitted actual hit stage", string(encoded))
			}
		}
	}
	for _, window := range []int64{349, 350} {
		c, r := singleSkillInput(false)
		r.StopPolicy.DurationMs = window
		done := timedShieldMustRun(t, c, r)
		facts := done.FinalSnapshot.ProcessInstances[0].SkillHitStages
		want := 0
		if window == 350 {
			want = 1
		}
		if facts == nil || len(*facts) != want {
			t.Fatal("completion stage appeared before real completion", window, facts)
		}
	}
}

func TestStagedSkillLethalFirstContactStopsLaterStages(t *testing.T) {
	c, r := stagedSkillInput(3)
	for index := range c.Combatants {
		if c.Combatants[index].Key == "target" {
			c.Combatants[index].Attributes["hp"] = authoringSlot(80)
			r.InitialSnapshot.Combatants[index].Attributes["hp"] = authoringSlot(80)
		}
	}
	done := timedShieldMustRun(t, c, r)
	if !done.Summary.Execution.TargetKilled || done.Summary.DurationMs != 250 || done.Summary.SkillUses.HitCount != 1 || done.Summary.SkillUses.ReleasedCount != 1 || len(*done.FinalSnapshot.ProcessInstances[0].SkillHitStages) != 1 {
		t.Fatal(done.Summary, done.FinalSnapshot.ProcessInstances)
	}
}

func TestStagedSkillGraphAdmission(t *testing.T) {
	for _, kind := range []string{"missing", "self", "forward", "cycle", "cross_process", "same_step", "mix_completion", "unknown_step", "empty_prior", "foreign_source", "too_many_hits", "too_many_steps", "all_immediate"} {
		t.Run(kind, func(t *testing.T) {
			c, _ := stagedSkillInput(3)
			b := &c.Rules.SkillActionBindings[0]
			switch kind {
			case "missing":
				b.HitBindings[1].RequiresPriorHitBindingKey = hitUse("absent")
			case "self":
				b.HitBindings[1].RequiresPriorHitBindingKey = hitUse("phase_01")
			case "forward":
				b.HitBindings[0].RequiresPriorHitBindingKey = hitUse("phase_02")
			case "cycle":
				b.HitBindings[0].RequiresPriorHitBindingKey = hitUse("phase_01")
			case "cross_process":
				b.HitBindings[0].ProcessKey = "foreign"
			case "same_step":
				b.HitBindings[1].Moment.StepKey = hitUse("phase_00")
			case "mix_completion":
				b.HitBindings[2].Moment = model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}
			case "unknown_step":
				b.HitBindings[0].Moment.StepKey = hitUse("absent")
			case "empty_prior":
				b.HitBindings[1].RequiresPriorHitBindingKey = hitUse("")
			case "foreign_source":
				b.HitBindings[0].HitAbilityRef = "target.provider[caster].ability[phase_00]"
			case "too_many_hits":
				for len(b.HitBindings) < 65 {
					b.HitBindings = append(b.HitBindings, b.HitBindings[0])
				}
			case "too_many_steps":
				c, _ = stagedSkillInput(65)
			case "all_immediate":
				for index := range c.SharedProviders[0].Processes[0].Steps {
					step := &c.SharedProviders[0].Processes[0].Steps[index]
					step.StepType, step.DelayMs = "IMMEDIATE", nil
				}
			}
			if result := compilebundle.CompileGeneric(c); result.OK {
				t.Fatal("invalid staged graph admitted", kind)
			}
		})
	}
}

func TestStagedSkillActualOrderAndSixtyFourthContact(t *testing.T) {
	c, r := stagedSkillInput(64)
	for index := range c.SharedProviders[0].Processes[0].Steps {
		step := &c.SharedProviders[0].Processes[0].Steps[index]
		step.StepType, step.DelayMs = "IMMEDIATE", nil
		*c.SharedProviders[0].Abilities[index+1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = *timedShieldExpr(1)
	}
	c.SharedProviders[0].Processes[0].Steps[0].StepType = "DELAY"
	c.SharedProviders[0].Processes[0].Steps[0].DelayMs = timedShieldExpr(1)
	// 数组顺序不是时间顺序；第一阶段放在第64位，必须仍按实际过程成功。
	hits := c.Rules.SkillActionBindings[0].HitBindings
	for left, right := 0, len(hits)-1; left < right; left, right = left+1, right-1 {
		hits[left], hits[right] = hits[right], hits[left]
	}
	stagedAutomatic(&r, c.Rules.SkillActionBindings[0])
	r.StopPolicy.DurationMs = 1
	done := timedShieldMustRun(t, c, r)
	if !done.Summary.Execution.Complete || done.Summary.SourceDamageDealt != 64 || done.Summary.SkillUses.HitCount != 64 || done.Summary.SkillUses.ReleasedCount != 64 {
		t.Fatal(done.Summary)
	}
}

func TestStagedSkillAutomaticDoesNotAdmitComplexSequences(t *testing.T) {
	for _, kind := range []string{"CHANNEL", "CHARGE", "MULTI_HIT", "RECAST"} {
		c, r := complexSkillInput(kind, false)
		prefix := model.ProcessStepDefinition{StepKey: "prefix", StepType: "DELAY", DelayMs: timedShieldExpr(1), OccupiesAction: model.BoolPtr(false)}
		c.SharedProviders[0].Processes[0].Steps = append([]model.ProcessStepDefinition{prefix}, c.SharedProviders[0].Processes[0].Steps...)
		stagedAutomatic(&r, c.Rules.SkillActionBindings[0])
		compiled := compilebundle.CompileGeneric(c)
		if !compiled.OK {
			t.Fatal(compiled.Result)
		}
		if _, err := runtimeengine.RunGeneric(compiled.Session, r); err == nil || !strings.Contains(err.Message, "automatic") {
			t.Fatal("complex automatic sequence admitted", kind, err)
		}
	}
}
