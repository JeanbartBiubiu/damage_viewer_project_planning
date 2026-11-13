package runtime_test

import (
	"encoding/json"
	"reflect"
	"strconv"
	"strings"
	"testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

const passiveProcessRef = "source.provider[delayed].ability[on_hit]"

func passiveDelayInput(t *testing.T, duration int64, hitTimes ...int64) (model.CompileRequest, model.RunRequest) {
	entries, uses, facts := []model.DriverEntry{}, []model.SkillUseFact{}, []model.SkillHitFact{}
	for i, at := range hitTimes {
		key := []string{"first", "second", "third"}[i]
		entries = append(entries, hitEntry(key, at, 0))
		uses = append(uses, model.SkillUseFact{UseKey: key, Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete})
		facts = append(facts, model.SkillHitFact{DriverEntryKey: key, UseRef: hitUse(key), Sequence: seqN(1)})
	}
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("contact", "hit", "damage", "RESULT", 0)}, nil, nil, entries, uses, facts, duration)
	c.SharedProviders[0].Abilities[0].SkillKey = "author:q"
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"}, model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"})
	field := model.GenericFormulaExpr{Op: "read", Path: "provider.state.marks"}
	amount := model.GenericFormulaExpr{Op: "mul", Args: []model.GenericFormulaExpr{field, hitConst(10)}}
	positive := model.GenericFormulaExpr{Op: "gt", Args: []model.GenericFormulaExpr{field, hitConst(0)}}
	p := model.ProviderDefinition{ProviderKey: "delayed_def", SkillKey: "author:w", Kind: "character", StableID: "delayed", InitialStateSchema: map[string]interface{}{"marks": p6SchemaField(0, 3, 0, "")},
		Processes: []model.ProcessDefinition{{ProcessKey: "recheck", SkillKey: "author:w", EntryKind: model.ProcessEntrySkillHitPassive,
			Steps: []model.ProcessStepDefinition{{StepKey: "wait", StepType: "DELAY", OccupiesAction: model.BoolPtr(false), DelayMs: hitConstAmt(300)}}, Costs: []model.ProcessCostDefinition{},
			MomentOperations: []model.ProcessMomentOperations{{Moment: processMoment("STEP_EXECUTION", "wait", ""), Operations: []model.OperationDefinition{
				{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: &amount, Condition: &positive, Ref: "delayed_damage"},
				{Operation: "state_change", Target: "self", Types: []string{"state_scope/provider"}, Ref: "marks", ValuePolicy: "set", Amount: hitConstAmt(0)},
			}}}}},
		Abilities: []model.AbilityDefinition{{AbilityKey: "on_hit", SkillKey: "author:w", Kind: "passive_listener", ListenerSpec: &model.ListenerDefinition{
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}}, MaxTriggersPerEvent: 1},
			Operations: []model.OperationDefinition{{Operation: model.OperationKindStartPassiveProcess, Target: "self", ProcessKey: "recheck"}}}}}
	c.SharedProviders = append(c.SharedProviders, p)
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "delayed", DefinitionRef: p.ProviderKey})
	r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "delayed", DefinitionRef: p.ProviderKey, Source: "source", Owner: "source", Stacks: 1})
	return c, r
}

func passiveMarks(t *testing.T, request *model.RunRequest, n float64) {
	t.Helper()
	for i := range request.InitialSnapshot.Combatants[0].Providers {
		p := &request.InitialSnapshot.Combatants[0].Providers[i]
		if p.ProviderRef == "delayed" {
			request.InitialSnapshot.Combatants[0].ProviderState = map[string]interface{}{"delayed": map[string]interface{}{"state": map[string]interface{}{"marks": n}}}
			return
		}
	}
	t.Fatal("missing passive source")
}

func passiveDelayMixedInput(t *testing.T, duration int64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := continuousAttackInput(1, 10000, 10, 0, 0, duration)
	addMixedSpell(&c, &r, "original", 100, 400, false)
	template, _ := passiveDelayInput(t, duration, 500)
	provider := template.SharedProviders[1]
	provider.Processes[0].MomentOperations[0].Operations[0].DamageType = "damage/physics"
	c.SharedProviders = append(c.SharedProviders, provider)
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "delayed", DefinitionRef: provider.ProviderKey})
	r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "delayed", DefinitionRef: provider.ProviderKey, Source: "source", Owner: "source", Stacks: 1})
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"}, model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"})
	return c, r
}

func passiveProcessSnapshots(done model.DoneResult) []model.ProcessInstanceSnapshot {
	processes := []model.ProcessInstanceSnapshot{}
	for _, process := range done.FinalSnapshot.ProcessInstances {
		if process.PassiveOrigin != nil {
			processes = append(processes, process)
		}
	}
	return processes
}

func TestPassiveProcessSkillActionRetainsNaturalSourceAndBackgroundAttack(t *testing.T) {
	for _, stop := range []int64{799, 800, 801} {
		t.Run(strconv.FormatInt(stop, 10), func(t *testing.T) {
			c, r := passiveDelayMixedInput(t, stop)
			c.SharedProviders[2].InitialStateSchema["marks"] = p6SchemaField(2, 3, 0, "")
			done := timedShieldMustRun(t, c, r)
			baseline, baseRun := continuousAttackInput(1, 10000, 10, 0, 0, stop)
			addMixedSpell(&baseline, &baseRun, "original", 100, 400, false)
			base := timedShieldMustRun(t, baseline, baseRun)
			ps := passiveProcessSnapshots(done)
			want := 110.0
			if stop >= 800 {
				want = 130
			}
			if done.Summary.SourceDamageDealt != want || len(ps) != 1 || ps[0].StartedAtMs != 500 || ps[0].PassiveOrigin.UseKey != "skill:original_first" || ps[0].UseKey == ps[0].PassiveOrigin.UseKey {
				t.Fatal(done.Summary, ps)
			}
			if !reflect.DeepEqual(done.Summary.SkillUses, base.Summary.SkillUses) || !reflect.DeepEqual(done.AttackRecords, base.AttackRecords) || done.Summary.AbilityCastCount != base.Summary.AbilityCastCount || !reflect.DeepEqual(done.FinalSnapshot.Combatants[0].Cooldowns, base.FinalSnapshot.Combatants[0].Cooldowns) {
				t.Fatal("passive introduced active-use, cast, attack or cooldown side effects", done.Summary, base.Summary)
			}
			if len(ps[0].ActualCosts)+len(ps[0].ActionOccupancies) != 0 || ps[0].CooldownStarted || stop < 800 && ps[0].Status != "active" || stop >= 800 && (ps[0].Status != "complete" || *ps[0].FinishedAtMs != 800) {
				t.Fatal(ps[0])
			}
		})
	}
}

func TestPassiveProcessNativeMissAndSpellShieldDoNotSchedule(t *testing.T) {
	for _, shield := range []bool{false, true} {
		c, r := passiveDelayMixedInput(t, 801)
		c.SharedProviders[2].InitialStateSchema["marks"] = p6SchemaField(3, 3, 0, "")
		if !shield {
			r.DriverPlan.SkillActions[0].HitBindings[0].Preset = "MISS"
		} else {
			ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: model.ProviderTypeSpellShield, Domain: "provider"}, model.TypeCatalogEntry{Key: model.EventTypeSpellShieldBlocked, Domain: "event"})
			scope := model.SpellShieldScopeSkill
			candidate := &c.SharedProviders[1].Abilities[1].Operations[0].SkillHit.Candidates[0]
			candidate.SpellShieldBlockScope = &scope
			candidate.EventValueConditions = []model.SkillHitEventValueCondition{{Key: "blocked", Comparator: "eq", Value: *timedShieldExpr(0)}}
			blocking := spellShieldProvider()
			blocking.Listeners = nil
			c.SharedProviders = append(c.SharedProviders, blocking)
			c.SharedProviders[1].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: processMoment("PROCESS_START", "", ""), Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: blocking.ProviderKey}}}}
		}
		done := timedShieldMustRun(t, c, r)
		if len(passiveProcessSnapshots(done)) != 0 || done.Summary.SourceDamageDealt != 10 {
			t.Fatal("miss or shield created passive callback", shield, done.Summary, done.FinalSnapshot.ProcessInstances)
		}
	}
}

func TestPassiveProcessNativeTimingCurrentReadAndOriginalUse(t *testing.T) {
	for _, stop := range []int64{799, 800, 801} {
		t.Run(strconv.FormatInt(stop, 10), func(t *testing.T) {
			c, r := passiveDelayInput(t, stop, 500)
			passiveMarks(t, &r, 2)
			done := timedShieldMustRun(t, c, r)
			if len(done.FinalSnapshot.ProcessInstances) != 1 || len(skillHitItems(done)) != 1 {
				t.Fatal(done.FinalSnapshot.ProcessInstances, skillHitItems(done))
			}
			p := done.FinalSnapshot.ProcessInstances[0]
			if p.PassiveOrigin == nil || p.PassiveOrigin.UseKey != "first" || p.PassiveOrigin.UseSkillKey != "author:q" || p.UseKey == "first" || p.SkillKey != "author:w" || p.StartedAtMs != 500 || len(p.ActualCosts)+len(p.ActionOccupancies) != 0 || p.CooldownStarted {
				t.Fatal(p)
			}
			want := 100.0
			if stop >= 800 {
				want += 20
				if p.Status != "complete" || *p.FinishedAtMs != 800 {
					t.Fatal(p)
				}
			} else if p.Status != "active" {
				t.Fatal(p)
			}
			if done.Summary.SourceDamageDealt != want {
				t.Fatalf("damage %v want %v", done.Summary.SourceDamageDealt, want)
			}
			if stop >= 800 && done.DamageRecords[1]["timeMs"] != int64(800) {
				t.Fatal(done.DamageRecords)
			}
			if done.Summary.SkillUses != nil && done.Summary.SkillUses.StartedCount != 0 {
				t.Fatal("fabricated passive active use", done.Summary.SkillUses)
			}
		})
	}
}

func TestPassiveProcessIndependentOverlappingUsesAndZero(t *testing.T) {
	for _, marks := range []float64{0, 3} {
		c, r := passiveDelayInput(t, 901, 500, 600)
		passiveMarks(t, &r, marks)
		done := timedShieldMustRun(t, c, r)
		ps := done.FinalSnapshot.ProcessInstances
		if len(ps) != 2 || ps[0].UseKey == ps[1].UseKey || ps[0].PassiveOrigin.UseKey != "first" || ps[1].PassiveOrigin.UseKey != "second" || *ps[0].FinishedAtMs != 800 || *ps[1].FinishedAtMs != 900 {
			t.Fatal(ps)
		}
		if done.Summary.SourceDamageDealt != 200+marks*10 {
			t.Fatal(done.Summary)
		}
		if marks == 0 && len(done.DamageRecords) != 2 || marks > 0 && len(done.DamageRecords) != 3 {
			t.Fatal(done.DamageRecords)
		}
	}
}

func TestPassiveProcessIndependentNaturalUsesRemainBoundToTheirOwnCast(t *testing.T) {
	c, r := passiveDelayMixedInput(t, 901)
	addMixedSpell(&c, &r, "second", 200, 400, false)
	c.SharedProviders[2].InitialStateSchema["marks"] = p6SchemaField(3, 3, 0, "")
	done := timedShieldMustRun(t, c, r)
	ps := passiveProcessSnapshots(done)
	if len(ps) != 2 || ps[0].PassiveOrigin.UseKey != "skill:original_first" || ps[1].PassiveOrigin.UseKey != "skill:second_first" || *ps[0].FinishedAtMs != 800 || *ps[1].FinishedAtMs != 900 || done.Summary.SourceDamageDealt != 240 || done.Summary.SkillUses.StartedCount != 2 || done.Summary.SkillUses.HitCount != 2 || done.Summary.BasicAttack.CompletedCount != 1 {
		t.Fatal(done.Summary, ps)
	}
}

func TestPassiveProcessOriginMatchesReliableContactDespiteOmittedRecords(t *testing.T) {
	for _, staged := range []bool{false, true} {
		for _, mode := range []string{"detailed", "summary", "no-records", "zero-damage", "no-result"} {
			c, r := passiveDelayMixedInput(t, 801)
			c.SharedProviders[2].InitialStateSchema["marks"] = p6SchemaField(2, 3, 0, "")
			if staged {
				c.Rules.SkillActionBindings[0].HitBindings[0].Moment = processMoment("STEP_EXECUTION", "delay", "")
			}
			if mode == "summary" {
				r.OutputMode = model.RunOutputSummary
			}
			if mode == "no-records" {
				zero := 0
				r.RecordBudget = &model.RecordBudget{MaxDamageRecords: &zero, MaxSkillUseRecords: &zero}
			}
			if mode == "zero-damage" {
				c.SharedProviders[1].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = timedShieldExpr(0)
			}
			if mode == "no-result" {
				c.SharedProviders[1].Abilities[1].Operations[0].SkillHit.Candidates = nil
			}
			done := timedShieldMustRun(t, c, r)
			ps := passiveProcessSnapshots(done)
			var original *model.ProcessInstanceSnapshot
			for index := range done.FinalSnapshot.ProcessInstances {
				row := &done.FinalSnapshot.ProcessInstances[index]
				if row.UseKey == "skill:original_first" {
					original = row
				}
			}
			if original == nil || original.SkillHitStages == nil || len(*original.SkillHitStages) != 1 || len(ps) != 1 {
				t.Fatal(mode, original, ps)
			}
			contact := (*original.SkillHitStages)[0]
			if !contact.Released || !contact.Contact || !contact.Completed || contact.TimeMs != 500 || contact.HitSequence == nil || contact.HitOccurrenceID == nil || contact.HitBlocked == nil || *contact.HitSequence != ps[0].PassiveOrigin.HitSequence || *contact.HitOccurrenceID != ps[0].PassiveOrigin.HitOccurrenceID || *contact.HitBlocked != 0 {
				t.Fatal(mode, contact, ps[0].PassiveOrigin)
			}
			encoded, err := json.Marshal(done)
			if err != nil {
				t.Fatal(err)
			}
			var decoded model.DoneResult
			if err := json.Unmarshal(encoded, &decoded); err != nil {
				t.Fatal(mode, err)
			}
		}
	}
}

func TestPassiveProcessRechecksStateChangedBetweenHitAndTail(t *testing.T) {
	for _, marks := range []float64{1, 2, 3} {
		c, r := passiveDelayMixedInput(t, 801)
		speed := 1000.0 / 650.0
		c.Combatants[0].Attributes["attack_speed"] = authoringSlot(speed)
		r.InitialSnapshot.Combatants[0].Attributes["attack_speed"] = authoringSlot(speed)
		r.DriverPlan.BasicAttack.AttackSpeedInputMax = speed
		p := &c.SharedProviders[2]
		p.InitialStateSchema["attacks"] = p6SchemaField(0, 3, 0, "")
		later := authoringBinary("gt", authoringRead("provider.state.attacks"), authoringConst(0))
		p.Listeners = []model.ListenerDefinition{{ListenerKey: "add_after_first_attack", MaxTriggersPerEvent: 1,
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}}, Operations: []model.OperationDefinition{
				{Operation: "state_change", Target: "self", Types: []string{"state_scope/provider"}, Ref: "marks", ValuePolicy: "add", Amount: hitConstAmt(marks), Condition: &later},
				{Operation: "state_change", Target: "self", Types: []string{"state_scope/provider"}, Ref: "attacks", ValuePolicy: "add", Amount: hitConstAmt(1)},
			}}}
		c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "current_attribute", Kind: "status", StableID: "delayed", Lifecycle: sourceTargetLifecycle(1000),
			Modifiers: []model.ModifierDefinition{{ModifierKey: "current_attack_damage", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "add", Value: authoringConst(5)}}})
		p = &c.SharedProviders[2]
		ops := p.Listeners[0].Operations
		p.Listeners[0].Operations = []model.OperationDefinition{ops[0], {Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "current_attribute", Condition: &later}, ops[1]}
		p.Processes[0].MomentOperations[0].Operations[0].Amount = &model.GenericFormulaExpr{Op: "mul", Args: []model.GenericFormulaExpr{authoringRead("provider.state.marks"), authoringRead("source.attr.attack_damage.resolved")}}
		done := timedShieldMustRun(t, c, r)
		if done.Summary.SourceDamageDealt != 120+marks*15 || done.DamageRecords[len(done.DamageRecords)-1]["timeMs"] != int64(800) || len(passiveProcessSnapshots(done)) != 1 || done.AttackRecords[1].StartAtMs != 650 {
			t.Fatal(done.Summary, done.DamageRecords, done.AttackRecords)
		}
	}
}

func TestPassiveProcessRejectsDriverAndRestoredProvenance(t *testing.T) {
	c, r := passiveDelayInput(t, 801, 500)
	bad := r
	bad.DriverPlan.Entries = append(append([]model.DriverEntry{}, r.DriverPlan.Entries...), model.DriverEntry{EntryKey: "forged", AbilityRef: passiveProcessRef, Source: "source", Target: "target", FirstAtMs: 100})
	if err := runSkillHitErr(t, c, bad); err == nil || !strings.Contains(err.Message, "direct driver") {
		t.Fatal(err)
	}
	done := timedShieldMustRun(t, c, r)
	r.InitialSnapshot.ProcessInstances = done.FinalSnapshot.ProcessInstances
	if err := runSkillHitErr(t, c, r); err == nil || !strings.Contains(err.Message, "cannot be restored") {
		t.Fatal(err)
	}
	r.InitialSnapshot.ProcessInstances[0].PassiveOrigin = nil
	if err := runSkillHitErr(t, c, r); err == nil {
		t.Fatal("removing output provenance enabled passive restoration")
	}
}

func TestPassiveProcessCompileRejectsInvalidContracts(t *testing.T) {
	c, _ := passiveDelayInput(t, 801, 500)
	mutations := []struct {
		name   string
		change func(*model.CompileRequest)
	}{
		{"wrong-event", func(c *model.CompileRequest) {
			c.SharedProviders[1].Abilities[0].ListenerSpec.EventMatcher.All = []string{"event/damage_dealt", "event/source_owner"}
		}},
		{"missing-owner", func(c *model.CompileRequest) {
			c.SharedProviders[1].Abilities[0].ListenerSpec.EventMatcher.All = []string{model.EventTypeSkillHit}
		}},
		{"active-start", func(c *model.CompileRequest) { c.SharedProviders[1].Abilities[0].Kind = "active" }},
		{"no-start", func(c *model.CompileRequest) { c.SharedProviders[1].Abilities[0].Operations = nil }},
		{"wrong-process", func(c *model.CompileRequest) { c.SharedProviders[1].Abilities[0].Operations[0].ProcessKey = "missing" }},
		{"occupancy", func(c *model.CompileRequest) {
			c.SharedProviders[1].Processes[0].Steps[0].OccupiesAction = model.BoolPtr(true)
		}},
		{"no-delay", func(c *model.CompileRequest) {
			c.SharedProviders[1].Processes[0].Steps[0].StepType = "IMMEDIATE"
			c.SharedProviders[1].Processes[0].Steps[0].DelayMs = nil
		}},
		{"cost", func(c *model.CompileRequest) {
			c.SharedProviders[1].Processes[0].Costs = []model.ProcessCostDefinition{{ResourceKey: "mana", Amount: hitConst(10)}}
		}},
		{"no-leaf", func(c *model.CompileRequest) { c.SharedProviders[1].Processes[0].MomentOperations = nil }},
		{"recursive", func(c *model.CompileRequest) {
			c.SharedProviders[1].Processes[0].MomentOperations[0].Operations = []model.OperationDefinition{{Operation: model.OperationKindStartPassiveProcess, Target: "self", ProcessKey: "recheck"}}
		}},
		{"initial-control", func(c *model.CompileRequest) {
			c.SharedProviders[1].Abilities = append(c.SharedProviders[1].Abilities, model.AbilityDefinition{AbilityKey: "start", SkillKey: "author:w", Kind: "active", ProcessControl: &model.ProcessControlDefinition{ProcessKey: "recheck", Action: "INITIAL"}})
		}},
		{"extra-active", func(c *model.CompileRequest) {
			c.SharedProviders[1].Abilities = append(c.SharedProviders[1].Abilities, model.AbilityDefinition{AbilityKey: "extra", SkillKey: "author:w", Kind: "active"})
		}},
		{"listener-alias", func(c *model.CompileRequest) {
			c.SharedProviders[1].Listeners = []model.ListenerDefinition{{ListenerKey: "alias", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}}, AbilityRef: passiveProcessRef}}
		}},
		{"temporary-source", func(c *model.CompileRequest) {
			c.SharedProviders[1].Lifecycle = &model.ProviderLifecycle{DurationMs: hitConstAmt(1000), MaxStacks: 1, RefreshPolicy: model.RefreshPolicyReplace}
		}},
		{"ordinary-cooldown", func(c *model.CompileRequest) {
			c.SharedProviders[1].Processes[0].Cooldown = &model.ProcessCooldownDefinition{DurationMs: hitConst(1000), StartMoment: processMoment("PROCESS_START", "", "")}
		}},
		{"wrong-target", func(c *model.CompileRequest) { c.SharedProviders[1].Abilities[0].Operations[0].Target = "target" }},
		{"fake-hit", func(c *model.CompileRequest) {
			c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "emit_event", Target: "target", EventType: model.EventTypeSkillHit}}
		}},
	}
	bytes, _ := json.Marshal(c)
	for _, entry := range mutations {
		t.Run(entry.name, func(t *testing.T) {
			var changed model.CompileRequest
			if err := json.Unmarshal(bytes, &changed); err != nil {
				t.Fatal(err)
			}
			entry.change(&changed)
			result := compilebundle.CompileGeneric(changed)
			if result.OK {
				t.Fatal("invalid passive contract compiled")
			}
		})
	}
}

func TestPassiveProcessStrictJSONShapes(t *testing.T) {
	var operation model.OperationDefinition
	if err := json.Unmarshal([]byte(`{"operation":"start_passive_process","target":"self","processKey":"tail"}`), &operation); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{
		`{"operation":"start_passive_process","target":"self"}`,
		`{"operation":"start_passive_process","target":"self","processKey":null}`,
		`{"operation":"start_passive_process","target":"self","processKey":"tail","condition":null}`,
		`{"operation":"start_passive_process","target":"self","processKey":"tail","abilityRef":"forged"}`,
		`{"operation":"state_change","target":"self","processKey":"tail"}`,
	} {
		if json.Unmarshal([]byte(raw), &operation) == nil {
			t.Fatal("ignored invalid operation shape", raw)
		}
	}
	for _, raw := range []string{
		`{"useSource":"source","useKey":"u","useSkillKey":"q","hitAbilityRef":"source.provider[q].ability[hit]","hitSequence":1}`,
		`{"useSource":"source","useKey":"u","useSkillKey":"q","hitAbilityRef":"source.provider[q].ability[hit]","hitSequence":0,"hitOccurrenceId":1}`,
		`{"useSource":"source","useKey":"u","useSkillKey":"q","hitAbilityRef":"source.provider[q].ability[hit]","hitSequence":1,"hitOccurrenceId":1,"other":true}`,
	} {
		var origin model.PassiveProcessOrigin
		if json.Unmarshal([]byte(raw), &origin) == nil {
			t.Fatal("ignored invalid passive origin", raw)
		}
	}
}

func TestPassiveProcessSameSessionDeterminismAndNoStateLeak(t *testing.T) {
	c, r := passiveDelayInput(t, 801, 500)
	passiveMarks(t, &r, 2)
	compiled := compilebundle.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	one, err := runtimeengine.RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	two, err := runtimeengine.RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(one, two) {
		t.Fatal("passive process session leaked state")
	}
}
