package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// item_2510 Dusk and Dawn（黄昏与黎明）core Spellblade — generic ABI 交叉验证。
// Backend 合同：ICD 从强化普攻消耗开始；arm 门控为 mul(eq(ready,0), eq(icd,0))。

const (
	duskAndDawnProviderRef = "item:dusk_and_dawn_spellblade"
	duskAndDawnDamageOpRef = "op:dusk_and_dawn_spellblade_damage"
	duskAndDawnADBase      = 100.0
	duskAndDawnAP          = 100.0
	duskAndDawnMR          = 100.0
	duskAndDawnAADamage    = 10.0
	duskAndDawnADRatio     = 0.75
	duskAndDawnAPRatio     = 0.10
)

func duskAndDawnExpectedRaw(baseAD, resolvedAP float64) float64 {
	return duskAndDawnADRatio*baseAD + duskAndDawnAPRatio*resolvedAP
}

func duskAndDawnExpectedMitigated(baseAD, resolvedAP, mr float64) float64 {
	return expectedMitigatedMagic(duskAndDawnExpectedRaw(baseAD, resolvedAP), mr)
}

func duskAndDawnArmReadyCond() *model.GenericFormulaExpr {
	zero := 0.0
	return &model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{
				Op: "eq",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "provider.state." + spellbladeReadyKey},
					{Op: "const", Value: &zero},
				},
			},
			{
				Op: "eq",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "provider.state." + spellbladeICDKey},
					{Op: "const", Value: &zero},
				},
			},
		},
	}
}

func duskAndDawnCastArmListener() model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey:  "dusk_and_dawn_on_ability_started",
		EventMatcher: model.TypeMatcher{All: []string{spellbladeCastEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         spellbladeReadyKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   duskAndDawnArmReadyCond(),
			},
		},
	}
}

func duskAndDawnHitConsumeListener() model.ListenerDefinition {
	adRatio := duskAndDawnADRatio
	apRatio := duskAndDawnAPRatio
	zero := 0.0
	one := 1.0
	readyCond := spellbladeReadyArmedCond()
	return model.ListenerDefinition{
		ListenerKey:  "dusk_and_dawn_on_basic_attack_hit",
		EventMatcher: model.TypeMatcher{All: []string{spellbladeHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Ref:           duskAndDawnDamageOpRef,
				CopyableOnHit: false,
				Condition:     readyCond,
				Amount: &model.GenericFormulaExpr{
					Op: "add",
					Args: []model.GenericFormulaExpr{
						{
							Op: "mul",
							Args: []model.GenericFormulaExpr{
								{Op: "const", Value: &adRatio},
								{Op: "read", Path: "event.entry_source.attr.ad.base"},
							},
						},
						{
							Op: "mul",
							Args: []model.GenericFormulaExpr{
								{Op: "const", Value: &apRatio},
								{Op: "read", Path: "event.entry_source.attr.ap.resolved"},
							},
						},
					},
				},
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         spellbladeICDKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   readyCond,
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         spellbladeReadyKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Condition:   readyCond,
			},
		},
	}
}

func duskAndDawnAAOps() []model.OperationDefinition {
	aa := duskAndDawnAADamage
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
			Ref:        "op:aa",
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: spellbladeHitEvent,
			Ref:       spellbladeHitEvent,
		},
	}
}

func duskAndDawnAAOpsWithGuinsooStack() []model.OperationDefinition {
	aa := duskAndDawnAADamage
	one := 1.0
	return []model.OperationDefinition{
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
			EventType: spellbladeHitEvent,
			Ref:       spellbladeHitEvent,
		},
	}
}

func duskAndDawnAAOpsWithAttrPollution() []model.OperationDefinition {
	aa := duskAndDawnAADamage
	polluteAD := 999.0
	polluteAP := 0.0
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
			Ref:        "op:aa",
		},
		{
			Operation:    "attribute_change",
			Target:       "source",
			AttributeKey: "ad",
			ValuePolicy:  "set",
			Amount:       &model.GenericFormulaExpr{Op: "const", Value: &polluteAD},
		},
		{
			Operation:    "attribute_change",
			Target:       "source",
			AttributeKey: "ap",
			ValuePolicy:  "set",
			Amount:       &model.GenericFormulaExpr{Op: "const", Value: &polluteAP},
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: spellbladeHitEvent,
			Ref:       spellbladeHitEvent,
		},
	}
}

func mountDuskAndDawnProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        duskAndDawnProviderRef,
		Kind:               "item",
		StableID:           "item_2510",
		InitialStateSchema: spellbladeStateSchema(),
		Listeners:          []model.ListenerDefinition{duskAndDawnCastArmListener(), duskAndDawnHitConsumeListener()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: duskAndDawnProviderRef, DefinitionRef: duskAndDawnProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
			ProviderRef: duskAndDawnProviderRef, DefinitionRef: duskAndDawnProviderRef, Stacks: 1, State: map[string]interface{}{},
		})
	}
}

func configureDuskAndDawnChampionAbilities(compileReq *model.CompileRequest) {
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: spellbladeTumbleKey,
			Kind:       "active",
			Types:      []string{},
			Operations: []model.OperationDefinition{},
		},
		{
			AbilityKey: spellbladeHitAbilityKey,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Operations: duskAndDawnAAOps(),
		},
	}
}

func loadDuskAndDawnFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureSpellbladeTypes(&compileReq)
	configureDuskAndDawnChampionAbilities(&compileReq)
	mountDuskAndDawnProvider(&compileReq, &runReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: duskAndDawnADBase, Current: duskAndDawnADBase, Max: duskAndDawnADBase, Resolved: duskAndDawnADBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: duskAndDawnAP, Current: duskAndDawnAP, Max: duskAndDawnAP, Resolved: duskAndDawnAP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: duskAndDawnMR, Current: duskAndDawnMR, Max: duskAndDawnMR, Resolved: duskAndDawnMR,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func duskAndDawnStateValue(t *testing.T, done model.DoneResult, key string) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[duskAndDawnProviderRef].(map[string]interface{})
		if !ok {
			return 0
		}
		state, ok := bag["state"].(map[string]interface{})
		if !ok {
			return 0
		}
		v, _ := state[key].(float64)
		return v
	}
	t.Fatalf("source combatant missing")
	return 0
}

func TestDuskAndDawnCompileAndExactMagicDamage(t *testing.T) {
	compileReq, runReq := loadDuskAndDawnFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa1", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 100},
		{EntryKey: "aa2", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 200},
	}
	runReq.StopPolicy.DurationMs = 300
	done := runSpellblade(t, compileReq, runReq)

	wantRaw := duskAndDawnExpectedRaw(duskAndDawnADBase, duskAndDawnAP) // 85
	if math.Abs(wantRaw-85) > 1e-9 {
		t.Fatalf("helper raw=%v want 85", wantRaw)
	}
	if got := sumDamageRawByOpRef(done, duskAndDawnDamageOpRef); math.Abs(got-wantRaw) > 1e-6 {
		t.Fatalf("dusk and dawn raw=%v want %v", got, wantRaw)
	}
	wantMitigated := duskAndDawnExpectedMitigated(duskAndDawnADBase, duskAndDawnAP, duskAndDawnMR) // 42.5
	if math.Abs(wantMitigated-42.5) > 1e-9 {
		t.Fatalf("helper mitigated=%v want 42.5", wantMitigated)
	}
	if got := sumDamageMitigatedByOpRef(done, duskAndDawnDamageOpRef); math.Abs(got-wantMitigated) > 1e-6 {
		t.Fatalf("dusk and dawn mitigated=%v want %v (MR=100)", got, wantMitigated)
	}
	if countDamageByOpRef(done, duskAndDawnDamageOpRef, false) != 1 {
		t.Fatalf("dusk and dawn damage count=%d want 1", countDamageByOpRef(done, duskAndDawnDamageOpRef, false))
	}
	item := firstDamageEvidenceByOpRef(done, duskAndDawnDamageOpRef)
	if item == nil {
		t.Fatal("missing dusk and dawn damage evidence")
	}
	if evidenceDataString(item.Data, "damageType") != "damage/magic" {
		t.Fatalf("damageType=%q want damage/magic", evidenceDataString(item.Data, "damageType"))
	}
}

func TestDuskAndDawnAbilityStartedArmsReadyOnly(t *testing.T) {
	compileReq, runReq := loadDuskAndDawnFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runSpellblade(t, compileReq, runReq)
	if countEmittedEvents(done, spellbladeCastEvent) != 1 {
		t.Fatalf("ability_started count=%d want 1", countEmittedEvents(done, spellbladeCastEvent))
	}
	if got := duskAndDawnStateValue(t, done, spellbladeReadyKey); got != 1 {
		t.Fatalf("spellblade_ready=%v want 1", got)
	}
	if got := duskAndDawnStateValue(t, done, spellbladeICDKey); got != 0 {
		t.Fatalf("spellblade_icd=%v want 0 (ICD starts on empowered hit consume)", got)
	}
}

func TestDuskAndDawnArmedHitConsumesReadyAndArmsICD(t *testing.T) {
	compileReq, runReq := loadDuskAndDawnFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runSpellblade(t, compileReq, runReq)
	if countDamageByOpRef(done, duskAndDawnDamageOpRef, false) != 1 {
		t.Fatalf("dusk and dawn damage count=%d want 1", countDamageByOpRef(done, duskAndDawnDamageOpRef, false))
	}
	if got := duskAndDawnStateValue(t, done, spellbladeReadyKey); got != 0 {
		t.Fatalf("spellblade_ready=%v want 0 after consume", got)
	}
	if got := duskAndDawnStateValue(t, done, spellbladeICDKey); got != 1 {
		t.Fatalf("spellblade_icd=%v want 1 after empowered hit", got)
	}
}

func TestDuskAndDawnICDBlocksRearmWithin1500ms(t *testing.T) {
	compileReq, runReq := loadDuskAndDawnFixture(t)
	const hitAt int64 = 100
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble1", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa1", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: hitAt},
		{EntryKey: "tumble2", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: hitAt + spellbladeICDDuration - 1},
		{EntryKey: "aa2", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: hitAt + spellbladeICDDuration + 50},
	}
	runReq.StopPolicy.DurationMs = hitAt + spellbladeICDDuration + 100
	done := runSpellblade(t, compileReq, runReq)
	if countEmittedEvents(done, spellbladeCastEvent) != 2 {
		t.Fatalf("ability_started count=%d want 2", countEmittedEvents(done, spellbladeCastEvent))
	}
	if countDamageByOpRef(done, duskAndDawnDamageOpRef, false) != 1 {
		t.Fatalf("dusk and dawn damage count=%d want 1 (ICD must block rearm)", countDamageByOpRef(done, duskAndDawnDamageOpRef, false))
	}
	if got := duskAndDawnStateValue(t, done, spellbladeReadyKey); got != 0 {
		t.Fatalf("spellblade_ready=%v want 0 (blocked rearm)", got)
	}
}

func TestDuskAndDawnICDExpiresAllowsRearm(t *testing.T) {
	compileReq, runReq := loadDuskAndDawnFixture(t)
	const hitAt int64 = 100
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble1", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa1", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: hitAt},
		{EntryKey: "tumble2", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: hitAt + spellbladeICDDuration},
		{EntryKey: "aa2", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: hitAt + spellbladeICDDuration + 100},
	}
	runReq.StopPolicy.DurationMs = hitAt + spellbladeICDDuration + 200
	done := runSpellblade(t, compileReq, runReq)
	if countDamageByOpRef(done, duskAndDawnDamageOpRef, false) != 2 {
		t.Fatalf("dusk and dawn damage count=%d want 2 (after ICD expiry rearm)", countDamageByOpRef(done, duskAndDawnDamageOpRef, false))
	}
	wantRaw := 2 * duskAndDawnExpectedRaw(duskAndDawnADBase, duskAndDawnAP)
	if got := sumDamageRawByOpRef(done, duskAndDawnDamageOpRef); math.Abs(got-wantRaw) > 1e-6 {
		t.Fatalf("dusk and dawn raw sum=%v want %v", got, wantRaw)
	}
}

func TestDuskAndDawnReadyExpiresWithoutProc(t *testing.T) {
	compileReq, runReq := loadDuskAndDawnFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: spellbladeReadyDuration},
	}
	runReq.StopPolicy.DurationMs = spellbladeReadyDuration + 50
	done := runSpellblade(t, compileReq, runReq)
	if countDamageByOpRef(done, duskAndDawnDamageOpRef, false) != 0 {
		t.Fatalf("dusk and dawn damage after ready expiry=%d want 0", countDamageByOpRef(done, duskAndDawnDamageOpRef, false))
	}
	if got := duskAndDawnStateValue(t, done, spellbladeReadyKey); got != 0 {
		t.Fatalf("spellblade_ready=%v want 0 after expiry", got)
	}
}

func TestDuskAndDawnUsesEntrySourceAttrSnapshot(t *testing.T) {
	compileReq, runReq := loadDuskAndDawnFixture(t)
	compileReq.SharedProviders[0].Abilities[1].Operations = duskAndDawnAAOpsWithAttrPollution()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runSpellblade(t, compileReq, runReq)

	wantRaw := duskAndDawnExpectedRaw(duskAndDawnADBase, duskAndDawnAP) // 85 from entry snapshot
	livePollutedRaw := duskAndDawnExpectedRaw(999, 0)                   // would be 749.25 if live attrs used
	if math.Abs(livePollutedRaw-wantRaw) < 1e-6 {
		t.Fatal("polluted live raw must diverge from entry raw for this assertion")
	}
	if got := sumDamageRawByOpRef(done, duskAndDawnDamageOpRef); math.Abs(got-wantRaw) > 1e-6 {
		t.Fatalf("dusk and dawn raw=%v want entry snapshot %v (live polluted would be %v)", got, wantRaw, livePollutedRaw)
	}
	wantMitigated := duskAndDawnExpectedMitigated(duskAndDawnADBase, duskAndDawnAP, duskAndDawnMR)
	if got := sumDamageMitigatedByOpRef(done, duskAndDawnDamageOpRef); math.Abs(got-wantMitigated) > 1e-6 {
		t.Fatalf("dusk and dawn mitigated=%v want %v", got, wantMitigated)
	}
}

func TestDuskAndDawnPhantomDoesNotCopyOrConsume(t *testing.T) {
	compileReq, runReq := loadDuskAndDawnFixture(t)
	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[1].Operations = duskAndDawnAAOpsWithGuinsooStack()
	copyableAmt := 30.0
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "guinsoo_copyable",
			EventMatcher: model.TypeMatcher{All: []string{spellbladeHitEvent, "event/source_owner"}},
			Operations: []model.OperationDefinition{
				{
					Operation:     "damage",
					Target:        "target",
					DamageType:    "damage/magic",
					Amount:        &model.GenericFormulaExpr{Op: "const", Value: &copyableAmt},
					CopyableOnHit: true,
					Ref:           "op:guinsoo_copyable",
				},
			},
		},
		{
			ListenerKey:  "guinsoo_repeat",
			EventMatcher: model.TypeMatcher{All: []string{spellbladeHitEvent, "event/source_owner"}},
			Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
		},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			spellbladeChampionRef: map[string]interface{}{
				"state": map[string]interface{}{guinsooStackKey: float64(3)},
			},
		}
	}
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runSpellblade(t, compileReq, runReq)

	if countDamageByOpRef(done, duskAndDawnDamageOpRef, false) != 1 {
		t.Fatalf("original dusk and dawn damage count=%d want 1", countDamageByOpRef(done, duskAndDawnDamageOpRef, false))
	}
	if countDamageByOpRef(done, duskAndDawnDamageOpRef, true) != 0 {
		t.Fatalf("phantom dusk and dawn damage count=%d want 0", countDamageByOpRef(done, duskAndDawnDamageOpRef, true))
	}
	wantRaw := duskAndDawnExpectedRaw(duskAndDawnADBase, duskAndDawnAP)
	if got := sumDamageRawByOpRef(done, duskAndDawnDamageOpRef); math.Abs(got-wantRaw) > 1e-6 {
		t.Fatalf("dusk and dawn raw=%v want %v", got, wantRaw)
	}
	if got := duskAndDawnStateValue(t, done, spellbladeReadyKey); got != 0 {
		t.Fatalf("spellblade_ready=%v want 0 (consumed once by real hit)", got)
	}
	if got := duskAndDawnStateValue(t, done, spellbladeICDKey); got != 1 {
		t.Fatalf("spellblade_icd=%v want 1 (phantom must not touch ICD)", got)
	}
	if countDamageByOpRef(done, "op:guinsoo_copyable", true) != 1 {
		t.Fatalf("phantom guinsoo copyable count=%d want 1", countDamageByOpRef(done, "op:guinsoo_copyable", true))
	}
}
