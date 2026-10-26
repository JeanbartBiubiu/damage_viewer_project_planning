package execution

import (
	fmt "fmt"
	strings "strings"
	testing "testing"
	formula "tinygo_engine_v2/internal/formula"
	model "tinygo_engine_v2/internal/model"
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

func TestSkillHitRuleGroupUnknownUseAndForeignMountFail(t *testing.T) {
	c, r := groupedSkillInput(t)
	oneGroupedHit(&r)
	r.SkillHitFacts[0].UseRef = nil
	if err := runSkillHitErr(t, c, r); !strings.Contains(err.Message, "originating skill use") {
		t.Fatal(err)
	}
	c, r = groupedSkillInput(t)
	oneGroupedHit(&r)
	s := frameCommitState(t, c, r)
	ability, ref, _ := s.lookupDriverAbility(r.DriverPlan.Entries[0])
	plan := s.compiled.Operations[ability.OperationStart].SkillHit
	freeze := &frozenSkillHitContext{plan: plan, ability: ability, abilityRef: ref, sourceKey: "source", targetKey: "target", skillKey: "author:q", useRef: "u1"}
	ev := emittedEvent{eventType: model.EventTypeSkillHit, sourceKey: "source", targetKey: "target", hasUse: true, useSource: "source", useSkillKey: "author:q", useKey: "u1"}
	for _, mutate := range []func(){func() { freeze.abilityRef = "target.provider[champion:source_demo].ability[skill_hit]" }, func() { freeze.abilityRef = ref; ev.useSource = "target" }, func() { ev.useSource = "source"; freeze.plan.OwnerProviderIndex = -1 }} {
		mutate()
		if _, err := s.skillHitRuleQuota(ev, freeze, plan.RuleGroups[0]); err == nil {
			t.Fatal("foreign identity gained quota")
		}
	}
	if len(s.useTriggerLedger) != 0 {
		t.Fatal("bad identity allocated quota")
	}
	for _, field := range []string{"source", "owner", "duplicate"} {
		c, r = groupedSkillInput(t)
		oneGroupedHit(&r)
		snapshot := &r.InitialSnapshot.Combatants[0]
		switch field {
		case "source":
			snapshot.Providers[0].Source = "target"
		case "owner":
			snapshot.Providers[0].Owner = "target"
		case "duplicate":
			snapshot.Providers = append(snapshot.Providers, snapshot.Providers[0])
		}
		if err := runSkillHitErr(t, c, r); err == nil {
			t.Fatal("invalid actual mount gained quota", field)
		}
	}
}

func TestSkillHitRuleGroupSharesDedicatedLedgerBudget(t *testing.T) {
	c, r := groupedSkillInput(t)
	oneGroupedHit(&r)
	s := frameCommitState(t, c, r)
	for i := 0; i < maxUseTriggerLedger; i++ {
		key := useTriggerKey{useKey: fmt.Sprint(i)}
		s.useTriggerLedger[key] = &useTriggerRecord{key: key, committed: true}
	}
	err := s.executeAbilityCast(r.DriverPlan.Entries[0])
	if err == nil || err.BudgetCause != model.BudgetCauseMaxUseTriggerLedger || s.report.Totals().SourceDamageDealt != 0 || len(s.useTriggerLedger) != maxUseTriggerLedger || s.useTriggerReserving != 0 {
		t.Fatal("new groups bypassed or corrupted the shared budget", err, s.report.Totals().SourceDamageDealt, len(s.useTriggerLedger))
	}
}

func TestSkillHitRuleGroupSecondCommandFailureKeepsEarlierGroupOnly(t *testing.T) {
	c, r := groupedSkillInput(t)
	oneGroupedHit(&r)
	hit := groupedPlan(&c)
	third := damageCand("third", "occ", "third", "", 0)
	third.EventValueConditions = nil
	hit.Candidates = append(hit.Candidates, third)
	hit.RuleGroups = []model.SkillHitRuleGroup{hitRule("committed", "prior", model.OncePerUseScopeProvider, "first"), hitRule("failing", "both", model.OncePerUseScopeProvider, "second", "third")}
	s := frameCommitState(t, c, r)
	s.actions.SetAttackActive(true)
	s.budget.MaxCommandsPerEvent = 3
	err := s.executeAbilityCast(r.DriverPlan.Entries[0])
	if err == nil || err.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || s.report.Totals().SourceDamageDealt != 100 || s.combatantHp("target") != 900 || s.useTriggerReserving != 0 {
		t.Fatal("failed second result leaked a half-rule", err, s.report.Totals().SourceDamageDealt, s.combatantHp("target"), s.useTriggerLedger)
	}
	rows := s.snapshotUseTriggerLedger()
	if len(rows) != 1 || rows[0].GroupKey != "prior" || s.recordingSummary().DamageRecordCount != 1 {
		t.Fatal("earlier commit or failed reservation lost", rows, s.recordingSummary().DamageRecordCount)
	}
}

func TestSkillHitRuleGroupSecondFormulaFailureIsAtomic(t *testing.T) {
	c, r := groupedSkillInput(t)
	oneGroupedHit(&r)
	groupedPlan(&c).Candidates[1].Operations[0].Amount = &model.GenericFormulaExpr{Op: "div", Args: []model.GenericFormulaExpr{hitConst(1), hitConst(0)}}
	s := frameCommitState(t, c, r)
	err := s.executeAbilityCast(r.DriverPlan.Entries[0])
	if err == nil || err.Code != model.GenericErrFormulaTypeError || s.report.Totals().SourceDamageDealt != 0 || s.combatantHp("target") != 1000 || len(s.useTriggerLedger) != 0 || s.recordingSummary().DamageRecordCount != 0 {
		t.Fatal("second formula failure committed damage/quota", err, s.report.Totals().SourceDamageDealt, s.useTriggerLedger)
	}
	if len(s.report.Snapshot().Evidence.CountsByKind) == 0 || s.report.Snapshot().Evidence.CountsByKind[string(model.EvidenceKindSkillHit)] != 1 {
		t.Fatal("already committed parent hit disappeared", s.report.Snapshot().Evidence.CountsByKind)
	}
}

func TestSkillHitRuleGroupProviderBatchQueueAndSecondValueFailure(t *testing.T) {
	for _, failure := range []string{"queue", "second strength"} {
		base, _ := momentSlowSkillInput(t, 2125, false)
		c, r := withSkillHit(t, groupedPlan(&base).Candidates, base.SharedProviders[1:], nil,
			[]model.DriverEntry{hitEntry("contact", 1125, 0)},
			[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
			[]model.SkillHitFact{{DriverEntryKey: "contact", UseRef: hitUse("u1")}}, 2125)
		ensureC1CatalogTypes(&c, base.TypeCatalog.Types...)
		c.Rules.DamageTypeFormulas = base.Rules.DamageTypeFormulas
		hit := groupedPlan(&c)
		hit.RuleGroups = []model.SkillHitRuleGroup{hitRule("control", "control", model.OncePerUseScopeProviderTarget, "airborne", "slow")}
		if failure == "second strength" {
			for i := range c.SharedProviders {
				if c.SharedProviders[i].ProviderKey == "landing_slow" {
					c.SharedProviders[i].StatusContributions[0].Strength = hitConst(1.2)
				}
			}
		}
		// Isolate the actual hit transaction from the process timer's own queue
		// capacity. The separately tested process uses the same group executor.
		s := frameCommitState(t, c, r)
		s.loop.Advance(1125)
		if failure == "queue" {
			s.loop.Queue().SetLimit(1)
		}
		err := s.executeAbilityCast(r.DriverPlan.Entries[0])
		if err == nil || s.combatants["target"].instances.Providers().Len() != 0 || len(s.useTriggerLedger) != 0 || s.useTriggerReserving != 0 || s.report.Totals().SourceDamageDealt != 80 {
			t.Fatal("second provider failed after publishing first", failure, err, s.combatants["target"].instances.Providers(), s.useTriggerLedger)
		}
		if failure == "queue" && err.BudgetCause != model.BudgetCauseMaxQueueEvents {
			t.Fatal(err)
		}
	}
}

func TestSkillHitRuleGroupRuntimeDoesNotExposePreviousCandidateOutput(t *testing.T) {
	c, r := groupedSkillInput(t)
	oneGroupedHit(&r)
	hit := groupedPlan(&c)
	hit.Candidates[0].Operations[0].OutputRef = "first_out"
	hit.Candidates[1] = nullHealCand("second", "occ", "second")
	s := frameCommitState(t, c, r)
	// The public compile test rejects this reference already. Exercise the
	// runtime unit boundary independently by replacing only the compiled read,
	// so a shared-frame implementation cannot accidentally expose the first
	// result to a later candidate after compilation.
	id, err := s.formulas.Register(formula.GenericProgram{Key: "test:cross-candidate-output", Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadOperationOutput, ReadKey: "first_out.POST_DEFENSE_DAMAGE"}}})
	if err != nil {
		t.Fatal(err)
	}
	ability, _, _ := s.lookupDriverAbility(r.DriverPlan.Entries[0])
	plan := s.compiled.Operations[ability.OperationStart].SkillHit
	operation := &s.compiled.Operations[plan.Candidates[1].OperationStart]
	operation.AmountProgram, operation.HasAmount = id, true
	if issue := s.executeAbilityCast(r.DriverPlan.Entries[0]); issue == nil || s.report.Totals().SourceDamageDealt != 0 || s.combatantHp("target") != 1000 || len(s.useTriggerLedger) != 0 || s.recordingSummary().DamageRecordCount != 0 {
		t.Fatal("candidate reused another result's private output", issue, s.report.Totals().SourceDamageDealt, s.useTriggerLedger)
	}
}

func TestSkillHitRuleGroupQuotaCommittedBeforeDerivedFailure(t *testing.T) {
	c, r := groupedSkillInput(t)
	oneGroupedHit(&r)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: eventTypeDamageInstance, Domain: "event"})
	c.SharedProviders[0].Listeners = []model.ListenerDefinition{{ListenerKey: "fail_after_commit", EventMatcher: model.TypeMatcher{All: []string{eventTypeDamageInstance}}, Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: &model.GenericFormulaExpr{Op: "div", Args: []model.GenericFormulaExpr{hitConst(1), hitConst(0)}}}}}}
	s := frameCommitState(t, c, r)
	if err := s.executeAbilityCast(r.DriverPlan.Entries[0]); err == nil || s.report.Totals().SourceDamageDealt != 200 || len(s.snapshotUseTriggerLedger()) != 1 || s.useTriggerReserving != 0 {
		t.Fatal("derived failure rolled back committed quota/damage", err, s.report.Totals().SourceDamageDealt, s.useTriggerLedger)
	}
}

func TestSkillHitRuleGroupReservedIdentityCannotReenter(t *testing.T) {
	c, r := groupedSkillInput(t)
	oneGroupedHit(&r)
	s := frameCommitState(t, c, r)
	quota := s.mountedOncePerUseGroups()
	if len(quota) != 1 {
		t.Fatal("missing real group authorization", quota)
	}
	// This is the exact existing ledger reservation used while the rule's direct
	// operations are staged; no events are published before its commit.
	group := groupedPlan(&c).RuleGroups[0]
	ev := emittedEvent{eventType: model.EventTypeSkillHit, sourceKey: "source", targetKey: "target", hasUse: true, useSource: "source", useSkillKey: "author:q", useKey: "u1"}
	ability, ref, _ := s.lookupDriverAbility(r.DriverPlan.Entries[0])
	hit := s.compiled.Operations[ability.OperationStart].SkillHit
	freeze := &frozenSkillHitContext{ability: ability, abilityRef: ref, plan: hit, sourceKey: "source", targetKey: "target", useRef: "u1", skillKey: "author:q"}
	descriptor, err := s.skillHitRuleQuota(ev, freeze, hit.RuleGroups[0])
	if err != nil {
		t.Fatal(err)
	}
	reserved, _, err := s.reserveOncePerUse(descriptor, ev)
	if err != nil || !reserved {
		t.Fatal(err)
	}
	if err := s.executeSkillHitRuleGroup(ev, freeze, hit.RuleGroups[0], 1); err != nil || s.report.Totals().SourceDamageDealt != 0 || s.useTriggerReserving != 1 {
		t.Fatal("reservation recursively acquired", group, err, s.useTriggerLedger)
	}
	s.releaseUncommittedUseReservation(&pendingUseReservation{listener: descriptor, event: ev})
	if len(s.useTriggerLedger) != 0 {
		t.Fatal("reservation did not release")
	}
}
