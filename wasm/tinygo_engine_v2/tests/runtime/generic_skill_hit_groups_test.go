// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	reflect "reflect"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func hitRule(key, group, scope string, candidates ...string) model.SkillHitRuleGroup {
	return model.SkillHitRuleGroup{RuleKey: key, CandidateKeys: candidates, OncePerUse: &model.OncePerUseLimit{GroupKey: group, Scope: scope}}
}

func groupedSkillInput(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	candidates := []model.SkillHitCandidate{damageCand("first", "occ", "first", "", 0), damageCand("second", "occ", "second", "", 0)}
	for i := range candidates {
		candidates[i].EventValueConditions = nil
	}
	c, r := withSkillHit(t, candidates, nil, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 0), hitEntry("h2", 10, 0), hitEntry("h3", 20, 0)},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}, {UseKey: "u2", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}, {DriverEntryKey: "h2", UseRef: hitUse("u1")}, {DriverEntryKey: "h3", UseRef: hitUse("u2")}}, 50)
	groupedPlan(&c).RuleGroups = []model.SkillHitRuleGroup{hitRule("both", "both", model.OncePerUseScopeProviderTarget, "first", "second")}
	return c, r
}

func groupedPlan(c *model.CompileRequest) *model.SkillHitDefinition {
	for pi := range c.SharedProviders {
		for ai := range c.SharedProviders[pi].Abilities {
			for oi := range c.SharedProviders[pi].Abilities[ai].Operations {
				if hit := c.SharedProviders[pi].Abilities[ai].Operations[oi].SkillHit; hit != nil {
					return hit
				}
			}
		}
	}
	return nil
}

func oneGroupedHit(r *model.RunRequest) {
	r.DriverPlan.Entries = r.DriverPlan.Entries[:1]
	r.SkillHitFacts = r.SkillHitFacts[:1]
}

func TestSkillHitRuleGroupWholeRuleAndNewUse(t *testing.T) {
	c, r := groupedSkillInput(t)
	done := runSkillHit(t, c, r)
	if done.Summary.SourceDamageDealt != 400 || targetHP(t, done) != 600 || len(done.DamageRecords) != 4 || len(skillHitItems(done)) != 3 || len(done.FinalSnapshot.UseTriggerLedger) != 2 {
		t.Fatal("one rule did not own both results or reused quota", done.Summary, done.DamageRecords, done.FinalSnapshot.UseTriggerLedger)
	}
	for _, row := range done.FinalSnapshot.UseTriggerLedger {
		if row.Owner != "source" || row.ProviderRef != "champion:source_demo" || row.GroupKey != "both" || row.UseSource != "source" || row.UseSkillKey != "author:q" || row.Target == nil || *row.Target != "target" {
			t.Fatal("invented group provenance", row)
		}
	}
	// Removing the optional groups retains the established per-candidate path.
	groupedPlan(&c).RuleGroups = nil
	old := runSkillHit(t, c, r)
	if old.Summary.SourceDamageDealt != 600 || len(old.FinalSnapshot.UseTriggerLedger) != 0 {
		t.Fatal("old hit semantics changed", old.Summary)
	}
}

func TestSkillHitRuleGroupScopesUseActualTarget(t *testing.T) {
	for _, scope := range []string{model.OncePerUseScopeProvider, model.OncePerUseScopeProviderTarget} {
		c, r := groupedSkillInput(t)
		r.DriverPlan.Entries = r.DriverPlan.Entries[:2]
		r.SkillHitFacts = r.SkillHitFacts[:2]
		r.DriverPlan.Entries[1].Target = "source"
		groupedPlan(&c).RuleGroups[0].OncePerUse.Scope = scope
		done := runSkillHit(t, c, r)
		want, count := 200.0, 1
		if scope == model.OncePerUseScopeProviderTarget {
			want, count = 400, 2
		}
		if done.Summary.SourceDamageDealt != want || len(done.FinalSnapshot.UseTriggerLedger) != count {
			t.Fatal(scope, done.Summary, done.FinalSnapshot.UseTriggerLedger)
		}
		if scope == model.OncePerUseScopeProvider && done.FinalSnapshot.UseTriggerLedger[0].Target != nil {
			t.Fatal("provider scope invented a target")
		}
	}
}

func TestSkillHitRuleGroupSharedKeyAndListenerStageOrder(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		c, r := groupedSkillInput(t)
		oneGroupedHit(&r)
		hit := groupedPlan(&c)
		hit.Candidates[1].Operations[0].Amount = hitConstAmt(30)
		hit.RuleGroups = []model.SkillHitRuleGroup{hitRule("first_rule", "shared", model.OncePerUseScopeProvider, "first"), hitRule("second_rule", "shared", model.OncePerUseScopeProvider, "second")}
		if reverse {
			hit.RuleGroups[0], hit.RuleGroups[1] = hit.RuleGroups[1], hit.RuleGroups[0]
		}
		ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: model.EventTypeDamageTaken, Domain: "event"})
		// Both a derived damage event and the later ordinary skill-hit listener
		// share the same actual mount/quota. Neither may precede its rule commit.
		for _, event := range []string{model.EventTypeDamageTaken, model.EventTypeSkillHit} {
			c.SharedProviders[0].Listeners = append(c.SharedProviders[0].Listeners, model.ListenerDefinition{ListenerKey: event, EventMatcher: model.TypeMatcher{All: []string{event}}, OncePerUse: &model.OncePerUseLimit{GroupKey: "shared", Scope: model.OncePerUseScopeProvider}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: hitConstAmt(5)}}})
		}
		done := runSkillHit(t, c, r)
		if done.Summary.SourceDamageDealt != 100 || len(done.FinalSnapshot.UseTriggerLedger) != 1 {
			t.Fatal("group order used wire group order or listener won before group", reverse, done.Summary, done.FinalSnapshot.UseTriggerLedger)
		}
	}
}

func TestSkillHitRuleGroupFreezesPredicateBeforePriorRuleWrites(t *testing.T) {
	c, r := groupedSkillInput(t)
	oneGroupedHit(&r)
	hit := groupedPlan(&c)
	hit.Candidates[0] = nullHealCand("buff", "occ", "buff")
	hit.Candidates[1].ParticipationCondition = &model.GenericFormulaExpr{Op: "eq", Args: []model.GenericFormulaExpr{{Op: "read", Path: "source.attr.attack_damage.current"}, hitConst(100)}}
	hit.RuleGroups = []model.SkillHitRuleGroup{hitRule("buff", "buff", model.OncePerUseScopeProvider, "buff"), hitRule("damage", "damage", model.OncePerUseScopeProvider, "second")}
	done := runSkillHit(t, c, r)
	if done.Summary.SourceDamageDealt != 100 || len(done.FinalSnapshot.UseTriggerLedger) != 2 {
		t.Fatal("later rule re-evaluated after earlier writes", done.Summary, done.FinalSnapshot.UseTriggerLedger)
	}
}

func TestSkillHitRuleGroupBlockedQuotaUsesPredicateNotConsumptionSet(t *testing.T) {
	for _, explicitUnblocked := range []bool{false, true} {
		c, r := groupedSkillInput(t)
		r.DriverPlan.Entries = r.DriverPlan.Entries[:2]
		r.SkillHitFacts = r.SkillHitFacts[:2]
		hit := groupedPlan(&c)
		for i := range hit.Candidates {
			hit.Candidates[i].SpellShieldBlockScope = hitScope(model.SpellShieldScopeSkill)
			if explicitUnblocked {
				hit.Candidates[i].EventValueConditions = []model.SkillHitEventValueCondition{{Key: model.SkillHitValueBlocked, Comparator: "eq", Value: hitConst(0)}}
			}
		}
		shield := spellShieldProvider()
		shield.Listeners[0].Operations = shield.Listeners[0].Operations[1:]
		c.SharedProviders = append(c.SharedProviders, shield)
		expires := int64(5000)
		r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: "shield:initial", DefinitionRef: shield.ProviderKey, Source: "target", Owner: "target", Stacks: 1, ExpireAt: &expires})
		done := runSkillHit(t, c, r)
		want := 1
		if explicitUnblocked {
			want = 0
		}
		if done.Summary.SourceDamageDealt != 0 || len(done.FinalSnapshot.UseTriggerLedger) != want || len(skillHitItems(done)) != 2 {
			t.Fatal("blocked consumption set became a true rule predicate", explicitUnblocked, done.Summary, done.FinalSnapshot.UseTriggerLedger)
		}
	}
}

func TestSkillHitRuleGroupConditionAndMissDoNotConsume(t *testing.T) {
	c, r := groupedSkillInput(t)
	oneGroupedHit(&r)
	zero := hitConst(0)
	for i := range groupedPlan(&c).Candidates {
		groupedPlan(&c).Candidates[i].ParticipationCondition = &zero
	}
	r.SkillHitFacts[0].UseRef = nil
	done := runSkillHit(t, c, r)
	if done.Summary.SourceDamageDealt != 0 || len(done.FinalSnapshot.UseTriggerLedger) != 0 {
		t.Fatal(done.Summary, done.FinalSnapshot.UseTriggerLedger)
	}
	c, r = singleSkillInput(false)
	groupedPlan(&c).RuleGroups = []model.SkillHitRuleGroup{hitRule("primary", "primary", model.OncePerUseScopeProviderTarget, "primary")}
	r.DriverPlan.SkillActions[0].HitBindings[0].Preset = "MISS"
	done = runSkillHit(t, c, r)
	if done.Summary.SkillUses.HitCount != 0 || len(done.FinalSnapshot.UseTriggerLedger) != 0 {
		t.Fatal("MISS consumed a hit-rule quota", done.Summary)
	}
}

func TestSkillHitRuleGroupSeparatesTwoRealMountsOfSameDefinition(t *testing.T) {
	c, r := groupedSkillInput(t)
	r.DriverPlan.Entries = r.DriverPlan.Entries[:2]
	r.SkillHitFacts = r.SkillHitFacts[:2]
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "second_mount", DefinitionRef: c.SharedProviders[0].ProviderKey})
	r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "second_mount", DefinitionRef: c.SharedProviders[0].ProviderKey, Source: "source", Owner: "source", Stacks: 1})
	r.DriverPlan.Entries[1].AbilityRef = "source.provider[second_mount].ability[skill_hit]"
	done := runSkillHit(t, c, r)
	if done.Summary.SourceDamageDealt != 400 || len(done.FinalSnapshot.UseTriggerLedger) != 2 || done.FinalSnapshot.UseTriggerLedger[0].ProviderRef == done.FinalSnapshot.UseTriggerLedger[1].ProviderRef {
		t.Fatal("definition replaced the real parent mount identity", done.Summary, done.FinalSnapshot.UseTriggerLedger)
	}
}

func TestSkillHitRuleGroupRestoresOnlyActualMountedGroupAndUse(t *testing.T) {
	c, r := groupedSkillInput(t)
	oneGroupedHit(&r)
	done := runSkillHit(t, c, r)
	r.InitialSnapshot.UseTriggerLedger = done.FinalSnapshot.UseTriggerLedger
	restored := runSkillHit(t, c, r)
	if restored.Summary.SourceDamageDealt != 0 || !reflect.DeepEqual(restored.FinalSnapshot.UseTriggerLedger, done.FinalSnapshot.UseTriggerLedger) {
		t.Fatal("valid restored quota replayed", restored.Summary)
	}
	for _, field := range []string{"owner", "provider", "group", "skill", "source", "duplicate"} {
		bad := r
		bad.InitialSnapshot.UseTriggerLedger = append([]model.UseTriggerLedgerEntry(nil), r.InitialSnapshot.UseTriggerLedger...)
		row := &bad.InitialSnapshot.UseTriggerLedger[0]
		switch field {
		case "owner":
			row.Owner = "target"
		case "provider":
			row.ProviderRef = "foreign"
		case "group":
			row.GroupKey = "foreign"
		case "skill":
			row.UseSkillKey = "foreign"
		case "source":
			row.UseSource = "target"
		case "duplicate":
			bad.InitialSnapshot.UseTriggerLedger = append(bad.InitialSnapshot.UseTriggerLedger, *row)
		}
		if err := runSkillHitErr(t, c, bad); err == nil {
			t.Fatal("accepted forged ledger", field)
		}
	}
}

func TestSkillHitRuleGroupCandidateDamageEventsRemainSeparateAfterAtomicCommit(t *testing.T) {
	c, r := groupedSkillInput(t)
	oneGroupedHit(&r)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "event/damage_dealt", Domain: "event"}, model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"})
	done := runSkillHit(t, c, r)
	events := emittedEventsByRef(done, "event/damage_dealt")
	if len(events) != 2 {
		t.Fatal("group aggregated two original candidate events", events)
	}
	for _, event := range events {
		if event.Data["rawAmount"] != 100.0 || event.Data["useRef"] != "u1" {
			t.Fatal(event)
		}
	}
	if len(emittedEventsByRef(done, "event/damage_instance")) != 2 {
		t.Fatal("lost per-instance child facts")
	}
}

func TestSkillHitRuleGroupRealPlannedControlAndRecordBudgets(t *testing.T) {
	for _, endpoint := range []int64{1124, 1125, 2124, 2125, 3624, 3625} {
		c, r := momentSlowSkillInput(t, endpoint, false)
		hit := groupedPlan(&c)
		hit.Candidates[0].EventValueConditions = nil
		hit.RuleGroups = []model.SkillHitRuleGroup{hitRule("damage", "damage", model.OncePerUseScopeProviderTarget, "damage"), hitRule("control", "control", model.OncePerUseScopeProviderTarget, "airborne", "slow")}
		detailed := runSkillHit(t, c, r)
		want := 0
		if endpoint >= 1125 {
			want = 2
		}
		if len(detailed.FinalSnapshot.UseTriggerLedger) != want || detailed.Summary.SkillUses.HitCount != boolInt(endpoint >= 1125) {
			t.Fatal(endpoint, detailed.Summary, detailed.FinalSnapshot.UseTriggerLedger)
		}
		for _, row := range detailed.FinalSnapshot.UseTriggerLedger {
			if row.ProviderRef != "caster" || row.UseKey != "skill:cast_once" || row.UseSkillKey != "configured_spell" {
				t.Fatal("planned group fabricated its origin", row)
			}
		}
		if got := effectiveSlow(t, detailed).Strength; got != map[bool]float64{false: 0, true: .6}[endpoint >= 2125 && endpoint < 3625] {
			t.Fatal("group changed elapsed slow", endpoint, got)
		}
		r.OutputMode = model.RunOutputSummary
		summary := runSkillHit(t, c, r)
		r.OutputMode = model.RunOutputDetailed
		zero := 0
		r.RecordBudget = &model.RecordBudget{MaxDamageRecords: &zero, MaxSkillUseRecords: &zero, MaxSkillActionRecords: &zero}
		clipped := runSkillHit(t, c, r)
		if !reflect.DeepEqual(detailed.FinalSnapshot, summary.FinalSnapshot) || !reflect.DeepEqual(detailed.FinalSnapshot, clipped.FinalSnapshot) || detailed.Summary.SourceDamageDealt != summary.Summary.SourceDamageDealt || detailed.Summary.SourceDamageDealt != clipped.Summary.SourceDamageDealt {
			t.Fatal("record budget affected quota or combat", endpoint)
		}
	}
	// Repeated runs use the same immutable compiled session with fresh quota state.
	c, r := groupedSkillInput(t)
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	first, err := runtimeengine.RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := json.Marshal(first)
	for i := 0; i < 10; i++ {
		got, err := runtimeengine.RunGeneric(compiled.Session, r)
		raw, _ := json.Marshal(got)
		if err != nil || string(raw) != string(want) {
			t.Fatal("same-session replay changed", i, err)
		}
	}
}
