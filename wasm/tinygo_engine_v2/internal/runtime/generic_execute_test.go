package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

const (
	executeProviderRef = "item:collector_execute"
	executeOpRef       = "op:collector_execute"
	executeHitAbility  = "basic_attack_hit"
	executeHitEvent    = "event/basic_attack_hit"
	executeAADamage    = 10.0
	executeMaxHP       = 1000.0
	executeThreshold   = 0.05
)

func ensureExecuteTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: executeHitEvent, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "damage/magic", Domain: "damage"},
	}
	have := map[string]bool{}
	for _, t := range req.TypeCatalog.Types {
		have[t.Key] = true
	}
	for _, t := range need {
		if !have[t.Key] {
			req.TypeCatalog.Types = append(req.TypeCatalog.Types, t)
		}
	}
}

func executeThresholdOp() model.OperationDefinition {
	return model.OperationDefinition{
		Operation: model.OperationKindExecuteThreshold,
		Target:    model.SelectorOpponent,
		Threshold: executeThreshold,
		Ref:       executeOpRef,
	}
}

func executeHitListener() model.ListenerDefinition {
	return model.ListenerDefinition{
		ListenerKey:  "listener_item_6676_execute",
		EventMatcher: model.TypeMatcher{All: []string{executeHitEvent, "event/source_owner"}},
		Operations:   []model.OperationDefinition{executeThresholdOp()},
	}
}

func executeAAOps(damage float64) []model.OperationDefinition {
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &damage},
			Ref:        "op:aa",
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: executeHitEvent,
			Ref:       executeHitEvent,
		},
	}
}

func executeAAOpsNoEmit(damage float64) []model.OperationDefinition {
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &damage},
			Ref:        "op:aa",
		},
	}
}

func mountExecuteProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: executeProviderRef,
		Kind:        "item",
		StableID:    "collector_execute",
		Listeners:   []model.ListenerDefinition{executeHitListener()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: executeProviderRef, DefinitionRef: executeProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
			ProviderRef: executeProviderRef, DefinitionRef: executeProviderRef, Stacks: 1, State: map[string]interface{}{},
		})
	}
}

func configureExecuteChampionAA(compileReq *model.CompileRequest, ops []model.OperationDefinition) {
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: executeHitAbility,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Operations: ops,
		},
	}
}

func executeAARef() string {
	return "source.provider[champion:source_demo].ability[" + executeHitAbility + "]"
}

func loadExecuteFixture(t *testing.T, startHP, aaDamage float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureExecuteTypes(&compileReq)
	configureExecuteChampionAA(&compileReq, executeAAOps(aaDamage))
	mountExecuteProvider(&compileReq, &runReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: startHP, Current: startHP, Max: executeMaxHP, Resolved: startHP,
	})
	runReq.DriverPlan.Entries = []model.DriverEntry{{
		EntryKey:   "execute_aa",
		AbilityRef: executeAARef(),
		Source:     model.SelectorSource,
		Target:     model.SelectorTarget,
		FirstAtMs:  0,
	}}
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(true)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runExecute(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func countExecuteEvidence(done model.DoneResult) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindExecute {
			n++
		}
	}
	return n
}

func firstExecuteEvidence(done model.DoneResult) *model.EvidenceItem {
	for i := range done.Evidence.Items {
		if done.Evidence.Items[i].Kind == model.EvidenceKindExecute {
			return &done.Evidence.Items[i]
		}
	}
	return nil
}

func targetShieldRemaining(done model.DoneResult) float64 {
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorTarget {
			continue
		}
		var total float64
		for _, s := range c.Shields {
			total += s.Remaining
		}
		return total
	}
	return 0
}

func TestGenericExecuteRatioStrictBelow(t *testing.T) {
	// After AA 10: 61→51 (5.1%), 60→50 (5.0%), 59→49 (4.9%).
	cases := []struct {
		name    string
		startHP float64
		want    int
	}{
		{"5.1_pct_no", 61, 0},
		{"5.0_pct_no", 60, 0},
		{"4.9_pct_yes", 59, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, r := loadExecuteFixture(t, tc.startHP, executeAADamage)
			r.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
			done := runExecute(t, c, r)
			if got := countExecuteEvidence(done); got != tc.want {
				t.Fatalf("execute evidence=%d want %d (finalHp=%v dealt=%v)", got, tc.want, done.Summary.TargetFinalHp, done.Summary.SourceDamageDealt)
			}
			if tc.want == 0 && done.Summary.TargetFinalHp != tc.startHP-executeAADamage {
				t.Fatalf("hp=%v want %v", done.Summary.TargetFinalHp, tc.startHP-executeAADamage)
			}
			if tc.want == 1 && done.Summary.TargetFinalHp != 0 {
				t.Fatalf("hp=%v want 0 after execute", done.Summary.TargetFinalHp)
			}
		})
	}
}

func TestGenericExecuteCrossThresholdFromAbove(t *testing.T) {
	// 70 - 30 = 40 → 4% < 5% → execute.
	c, r := loadExecuteFixture(t, 70, 30)
	done := runExecute(t, c, r)
	if countExecuteEvidence(done) != 1 {
		t.Fatalf("execute count=%d want 1", countExecuteEvidence(done))
	}
	if done.Summary.TargetFinalHp != 0 {
		t.Fatalf("hp=%v want 0", done.Summary.TargetFinalHp)
	}
	if done.Summary.StopReason != model.StopReasonTargetDead {
		t.Fatalf("stopReason=%q want target_dead", done.Summary.StopReason)
	}
	// Execute is not damage: summary only reflects AA 30.
	if math.Abs(done.Summary.SourceDamageDealt-30) > 1e-6 {
		t.Fatalf("dealt=%v want 30 (execute must not add damage)", done.Summary.SourceDamageDealt)
	}
	if math.Abs(done.Summary.TargetDamageTaken-30) > 1e-6 {
		t.Fatalf("taken=%v want 30", done.Summary.TargetDamageTaken)
	}
}

func TestGenericExecuteAlreadyKilledNoEvidence(t *testing.T) {
	// AA kills: 50 - 100 → 0; execute must skip (live dead).
	c, r := loadExecuteFixture(t, 50, 100)
	done := runExecute(t, c, r)
	if countExecuteEvidence(done) != 0 {
		t.Fatalf("execute count=%d want 0 after lethal AA", countExecuteEvidence(done))
	}
	if done.Summary.TargetFinalHp != 0 {
		t.Fatalf("hp=%v want 0", done.Summary.TargetFinalHp)
	}
	if done.Summary.StopReason != model.StopReasonTargetDead {
		t.Fatalf("stopReason=%q want target_dead", done.Summary.StopReason)
	}
}

func TestGenericExecuteBypassesShield(t *testing.T) {
	c, r := loadExecuteFixture(t, 49, 0) // already 4.9%; AA 0 so snapshot stays 4.9%
	// Use tiny AA so snapshot still below threshold: 49-0 not possible with amount 0;
	// use AA=0 via const 0.
	configureExecuteChampionAA(&c, executeAAOps(0))
	setCombatantAttr(&c, &r, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 49, Current: 49, Max: executeMaxHP, Resolved: 49,
	})
	for i := range r.InitialSnapshot.Combatants {
		if r.InitialSnapshot.Combatants[i].Key != model.SelectorTarget {
			continue
		}
		r.InitialSnapshot.Combatants[i].Shields = []model.CombatantShieldSnapshot{{
			ShieldRef: "keep", Source: model.SelectorSource, Owner: model.SelectorTarget,
			Remaining: 200, Priority: 1, State: map[string]interface{}{},
		}}
	}
	done := runExecute(t, c, r)
	if countExecuteEvidence(done) != 1 {
		t.Fatalf("execute count=%d want 1", countExecuteEvidence(done))
	}
	if done.Summary.TargetFinalHp != 0 {
		t.Fatalf("hp=%v want 0", done.Summary.TargetFinalHp)
	}
	if got := targetShieldRemaining(done); math.Abs(got-200) > 1e-6 {
		t.Fatalf("shield remaining=%v want 200", got)
	}
	ev := firstExecuteEvidence(done)
	if ev == nil {
		t.Fatal("missing execute evidence")
	}
	if !evidenceDataBool(ev.Data, "shieldBypassed") || !evidenceDataBool(ev.Data, "killed") {
		t.Fatalf("evidence data=%+v", ev.Data)
	}
	if evidenceDataBool(ev.Data, "phantom") {
		t.Fatal("execute must set phantom=false")
	}
	if evidenceDataString(ev.Data, "operationRef") != executeOpRef {
		t.Fatalf("operationRef=%q", evidenceDataString(ev.Data, "operationRef"))
	}
	if evidenceDataString(ev.Data, "thresholdType") != "current_hp_ratio" {
		t.Fatalf("thresholdType=%q", evidenceDataString(ev.Data, "thresholdType"))
	}
	if evidenceDataString(ev.Data, "comparison") != "strict_below" {
		t.Fatalf("comparison=%q", evidenceDataString(ev.Data, "comparison"))
	}
}

func TestGenericExecuteStopOnTargetDeathFalseOnlyOnce(t *testing.T) {
	c, r := loadExecuteFixture(t, 59, executeAADamage)
	r.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	// Second hit while already dead must not produce another execute.
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa0", AbilityRef: executeAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa1", AbilityRef: executeAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 50},
	}
	r.StopPolicy.DurationMs = 200
	done := runExecute(t, c, r)
	if countExecuteEvidence(done) != 1 {
		t.Fatalf("execute count=%d want 1", countExecuteEvidence(done))
	}
	if done.Summary.TargetFinalHp != 0 {
		t.Fatalf("hp=%v want 0", done.Summary.TargetFinalHp)
	}
}

func TestGenericExecuteNoBasicAttackHitNoTrigger(t *testing.T) {
	c, r := loadExecuteFixture(t, 40, executeAADamage)
	configureExecuteChampionAA(&c, executeAAOpsNoEmit(executeAADamage))
	r.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	done := runExecute(t, c, r)
	if countExecuteEvidence(done) != 0 {
		t.Fatalf("execute count=%d want 0 without basic_attack_hit", countExecuteEvidence(done))
	}
	if done.Summary.TargetFinalHp != 30 {
		t.Fatalf("hp=%v want 30", done.Summary.TargetFinalHp)
	}
}

func TestGenericExecuteActiveSkillDamageNoTrigger(t *testing.T) {
	c, r := loadExecuteFixture(t, 40, 0)
	skillDmg := 20.0
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: "skill_q",
			Kind:       "active",
			Types:      []string{}, // not basic_attack; no basic_attack_hit emit
			Operations: []model.OperationDefinition{
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/magic",
					Amount:     &model.GenericFormulaExpr{Op: "const", Value: &skillDmg},
					Ref:        "op:skill",
				},
			},
		},
	}
	ref := "source.provider[champion:source_demo].ability[skill_q]"
	r.DriverPlan.Entries = []model.DriverEntry{{
		EntryKey: "skill", AbilityRef: ref, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
	}}
	r.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	done := runExecute(t, c, r)
	if countExecuteEvidence(done) != 0 {
		t.Fatalf("execute count=%d want 0 for active skill", countExecuteEvidence(done))
	}
	if done.Summary.TargetFinalHp != 20 {
		t.Fatalf("hp=%v want 20", done.Summary.TargetFinalHp)
	}
}

func TestGenericExecuteDeterministic(t *testing.T) {
	runOnce := func() model.DoneResult {
		c, r := loadExecuteFixture(t, 59, executeAADamage)
		return runExecute(t, c, r)
	}
	a := runOnce()
	b := runOnce()
	if countExecuteEvidence(a) != 1 || countExecuteEvidence(b) != 1 {
		t.Fatalf("execute counts=%d,%d", countExecuteEvidence(a), countExecuteEvidence(b))
	}
	if math.Abs(a.Summary.SourceDamageDealt-b.Summary.SourceDamageDealt) > 1e-9 {
		t.Fatalf("dealt unstable %v vs %v", a.Summary.SourceDamageDealt, b.Summary.SourceDamageDealt)
	}
	if math.Abs(a.Summary.TargetFinalHp-b.Summary.TargetFinalHp) > 1e-9 {
		t.Fatalf("hp unstable %v vs %v", a.Summary.TargetFinalHp, b.Summary.TargetFinalHp)
	}
	ea, eb := firstExecuteEvidence(a), firstExecuteEvidence(b)
	if ea == nil || eb == nil {
		t.Fatal("missing evidence")
	}
	if math.Abs(evidenceDataFloat(ea.Data, "hpRatio")-evidenceDataFloat(eb.Data, "hpRatio")) > 1e-12 {
		t.Fatalf("hpRatio unstable")
	}
}

func TestGenericExecuteDBShapedHPRepeatedAAReachesTargetDead(t *testing.T) {
	// Real Web/DB regression: hp Base=Current=Max=Resolved=5000; refresh resets Resolved to Base
	// between casts while SetHP only changes Current. Damage must accumulate on Current so
	// Collector execute_threshold on basic_attack_hit fires once below 5% → target_dead.
	const (
		dbHP     = 5000.0
		aaDmg    = 100.0
		hitCount = 48 // 48*100 = 4800 → Current=200 (4% < 5%)
	)
	c, r := loadExecuteFixture(t, dbHP, aaDmg)
	setCombatantAttr(&c, &r, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: dbHP, Current: dbHP, Max: dbHP, Resolved: dbHP,
	})
	ref := executeAARef()
	entries := make([]model.DriverEntry, 0, hitCount)
	for i := 0; i < hitCount; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "aa_" + itoaRuntime(i),
			AbilityRef: ref,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  int64(i * 10),
		})
	}
	r.DriverPlan.Entries = entries
	r.StopPolicy.DurationMs = int64(hitCount*10 + 50)
	r.StopPolicy.StopOnTargetDeath = model.BoolPtr(true)
	r.Sampling.SampleEveryMs = 100000

	done := runExecute(t, c, r)
	if countExecuteEvidence(done) != 1 {
		t.Fatalf("execute evidence=%d want 1 (finalHp=%v dealt=%v stop=%q)",
			countExecuteEvidence(done), done.Summary.TargetFinalHp, done.Summary.SourceDamageDealt, done.Summary.StopReason)
	}
	if done.Summary.TargetFinalHp != 0 {
		t.Fatalf("hp=%v want 0 after execute", done.Summary.TargetFinalHp)
	}
	if done.Summary.StopReason != model.StopReasonTargetDead {
		t.Fatalf("stopReason=%q want target_dead", done.Summary.StopReason)
	}
	// Execute is not damage: summary reflects AA mitigated total only (no armor in fixture).
	wantDealt := aaDmg * float64(hitCount)
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("dealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
}

func TestGenericExecutePhantomGuinsooDoesNotTriggerOrCopy(t *testing.T) {
	// Phantom replay 不重派 listener；execute 不可 copyable。高血量下仅 phantom 结算，不应出现 execute evidence。
	c, r := loadBasicFixture(t)
	ensureExecuteTypes(&c)
	ensureGuinsooKTypes(&c)

	aa := executeAADamage
	copyAmt := 30.0
	one := 1.0
	c.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: executeHitAbility,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Operations: []model.OperationDefinition{
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/physical",
					Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
					Ref:        "op:aa",
				},
				{
					Operation:   "state_change",
					Target:      "source",
					Ref:         guinsooStackKey,
					Types:       []string{"state_scope/provider"},
					ValuePolicy: "add",
					Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				},
				{
					Operation: "emit_event",
					Target:    "target",
					EventType: executeHitEvent,
					Ref:       executeHitEvent,
				},
			},
		},
	}
	c.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "guinsoo_copyable",
			EventMatcher: model.TypeMatcher{All: []string{executeHitEvent, "event/source_owner"}},
			Operations: []model.OperationDefinition{
				{
					Operation:     "damage",
					Target:        "target",
					DamageType:    "damage/magic",
					Amount:        &model.GenericFormulaExpr{Op: "const", Value: &copyAmt},
					Ref:           "op:guinsoo_copyable",
					CopyableOnHit: true,
				},
				guinsooKRepeatOp(),
			},
		},
	}
	mountExecuteProvider(&c, &r)

	startHP := 1000.0
	setCombatantAttr(&c, &r, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: startHP, Current: startHP, Max: executeMaxHP, Resolved: startHP,
	})
	ref := executeAARef()
	entries := make([]model.DriverEntry, 0, 4)
	for i := 0; i < 4; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "aa_" + itoaRuntime(i),
			AbilityRef: ref,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  int64(i * 100),
		})
	}
	r.DriverPlan.Entries = entries
	r.StopPolicy.DurationMs = 500
	r.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	r.Sampling.SampleEveryMs = 100000

	done := runExecute(t, c, r)
	if countExecuteEvidence(done) != 0 {
		t.Fatalf("execute count=%d want 0 (phantom must not trigger/copy execute)", countExecuteEvidence(done))
	}
	if countPhantomDamageByOpRef(done, "op:guinsoo_copyable") != 1 {
		t.Fatalf("expected one phantom copyable damage, got %d", countPhantomDamageByOpRef(done, "op:guinsoo_copyable"))
	}
	if countDamageByOpRef(done, "op:guinsoo_copyable", false) != 4 {
		t.Fatalf("original copyable count=%d want 4", countDamageByOpRef(done, "op:guinsoo_copyable", false))
	}
	if countEmittedEvents(done, executeHitEvent) != 4 {
		t.Fatalf("basic_attack_hit emits=%d want 4 (phantom must not re-emit)", countEmittedEvents(done, executeHitEvent))
	}
	wantDealt := executeAADamage*4 + copyAmt*4 + copyAmt
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("dealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
}
