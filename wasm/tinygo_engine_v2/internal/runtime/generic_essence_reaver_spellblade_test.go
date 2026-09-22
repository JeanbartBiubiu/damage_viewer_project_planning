package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// item_3508 Essence Reaver（夺萃之镰）Spellblade — generic ABI 交叉验证。
// Backend 合同：ICD 从强化普攻消耗开始；arm 门控为 mul(eq(ready,0), eq(icd,0))。

const (
	essenceReaverProviderRef = "item:essence_reaver_spellblade"
	essenceReaverDamageOpRef = "op:essence_reaver_spellblade_damage"
	essenceReaverADBase      = 100.0
	essenceReaverCritChance  = 0.25
	essenceReaverArmor       = 100.0
	essenceReaverAADamage    = 10.0
	essenceReaverADRatio     = 1.25
	essenceReaverCritBonus   = 50.0
)

func essenceReaverExpectedRaw(baseAD, critChance float64) float64 {
	return essenceReaverADRatio*baseAD + essenceReaverCritBonus*critChance
}

func essenceReaverExpectedMitigated(baseAD, critChance, armor float64) float64 {
	return expectedMitigatedPhysical(essenceReaverExpectedRaw(baseAD, critChance), armor)
}

// mul(eq(ready,0), eq(icd,0)) — 新版 formula VM 数值 0/1 门控，禁止 and/or/not。
func essenceReaverArmReadyCond() *model.GenericFormulaExpr {
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

func essenceReaverCastArmListener() model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey:  "essence_reaver_on_ability_started",
		EventMatcher: model.TypeMatcher{All: []string{spellbladeCastEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         spellbladeReadyKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   essenceReaverArmReadyCond(),
			},
		},
	}
}

func essenceReaverHitConsumeListener() model.ListenerDefinition {
	adRatio := essenceReaverADRatio
	critBonus := essenceReaverCritBonus
	zero := 0.0
	one := 1.0
	readyCond := spellbladeReadyArmedCond()
	return model.ListenerDefinition{
		ListenerKey:  "essence_reaver_on_basic_attack_hit",
		EventMatcher: model.TypeMatcher{All: []string{spellbladeHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           essenceReaverDamageOpRef,
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
								{Op: "const", Value: &critBonus},
								{Op: "read", Path: "event.entry_source.attr.crit_chance.resolved"},
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

func essenceReaverAAOps() []model.OperationDefinition {
	aa := essenceReaverAADamage
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

func essenceReaverAAOpsWithGuinsooStack() []model.OperationDefinition {
	aa := essenceReaverAADamage
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

// AA 内先污染 live ad/crit，再 emit；Spellblade 必须读 entry 快照而非 live。
func essenceReaverAAOpsWithAttrPollution() []model.OperationDefinition {
	aa := essenceReaverAADamage
	polluteAD := 999.0
	polluteCrit := 0.0
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
			AttributeKey: "crit_chance",
			ValuePolicy:  "set",
			Amount:       &model.GenericFormulaExpr{Op: "const", Value: &polluteCrit},
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: spellbladeHitEvent,
			Ref:       spellbladeHitEvent,
		},
	}
}

func mountEssenceReaverProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        essenceReaverProviderRef,
		Kind:               "item",
		StableID:           "item_3508",
		InitialStateSchema: spellbladeStateSchema(),
		Listeners:          []model.ListenerDefinition{essenceReaverCastArmListener(), essenceReaverHitConsumeListener()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: essenceReaverProviderRef, DefinitionRef: essenceReaverProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
			ProviderRef: essenceReaverProviderRef, DefinitionRef: essenceReaverProviderRef, Stacks: 1, State: map[string]interface{}{},
		})
	}
}

func configureEssenceReaverChampionAbilities(compileReq *model.CompileRequest) {
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
			Operations: essenceReaverAAOps(),
		},
	}
}

func loadEssenceReaverFixture(t *testing.T, critChance float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureSpellbladeTypes(&compileReq)
	configureEssenceReaverChampionAbilities(&compileReq)
	mountEssenceReaverProvider(&compileReq, &runReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: essenceReaverADBase, Current: essenceReaverADBase, Max: essenceReaverADBase, Resolved: essenceReaverADBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "crit_chance", model.AttributeSlotDef{
		Base: critChance, Current: critChance, Max: 1, Resolved: critChance,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: essenceReaverArmor, Current: essenceReaverArmor, Max: essenceReaverArmor, Resolved: essenceReaverArmor,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func essenceReaverStateValue(t *testing.T, done model.DoneResult, key string) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[essenceReaverProviderRef].(map[string]interface{})
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

// TestEssenceReaverCompileAndExactPhysicalDamage: baseAD=100、crit=0.25、armor=100 → raw=137.5 / mitigated=68.75；crit=1 → raw=175。
func TestEssenceReaverCompileAndExactPhysicalDamage(t *testing.T) {
	t.Run("crit_0_25", func(t *testing.T) {
		compileReq, runReq := loadEssenceReaverFixture(t, essenceReaverCritChance)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "aa1", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 100},
			{EntryKey: "aa2", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 200},
		}
		runReq.StopPolicy.DurationMs = 300
		done := runSpellblade(t, compileReq, runReq)

		wantRaw := essenceReaverExpectedRaw(essenceReaverADBase, essenceReaverCritChance) // 137.5
		if math.Abs(wantRaw-137.5) > 1e-9 {
			t.Fatalf("helper raw=%v want 137.5", wantRaw)
		}
		if got := sumDamageRawByOpRef(done, essenceReaverDamageOpRef); math.Abs(got-wantRaw) > 1e-6 {
			t.Fatalf("essence reaver raw=%v want %v", got, wantRaw)
		}
		wantMitigated := essenceReaverExpectedMitigated(essenceReaverADBase, essenceReaverCritChance, essenceReaverArmor) // 68.75
		if math.Abs(wantMitigated-68.75) > 1e-9 {
			t.Fatalf("helper mitigated=%v want 68.75", wantMitigated)
		}
		if got := sumDamageMitigatedByOpRef(done, essenceReaverDamageOpRef); math.Abs(got-wantMitigated) > 1e-6 {
			t.Fatalf("essence reaver mitigated=%v want %v (armor=100)", got, wantMitigated)
		}
		if countDamageByOpRef(done, essenceReaverDamageOpRef, false) != 1 {
			t.Fatalf("essence reaver damage count=%d want 1", countDamageByOpRef(done, essenceReaverDamageOpRef, false))
		}
		item := firstDamageEvidenceByOpRef(done, essenceReaverDamageOpRef)
		if item == nil {
			t.Fatal("missing essence reaver damage evidence")
		}
		if evidenceDataString(item.Data, "damageType") != "damage/physical" {
			t.Fatalf("damageType=%q want damage/physical", evidenceDataString(item.Data, "damageType"))
		}
		aaMitigated := expectedMitigatedPhysical(essenceReaverAADamage, essenceReaverArmor)
		wantDealt := aaMitigated*2 + wantMitigated
		if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
			t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
		}
	})

	t.Run("crit_1", func(t *testing.T) {
		compileReq, runReq := loadEssenceReaverFixture(t, 1.0)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "aa", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 100},
		}
		runReq.StopPolicy.DurationMs = 200
		done := runSpellblade(t, compileReq, runReq)

		wantRaw := essenceReaverExpectedRaw(essenceReaverADBase, 1.0) // 175
		if math.Abs(wantRaw-175) > 1e-9 {
			t.Fatalf("helper raw=%v want 175", wantRaw)
		}
		if got := sumDamageRawByOpRef(done, essenceReaverDamageOpRef); math.Abs(got-wantRaw) > 1e-6 {
			t.Fatalf("essence reaver raw=%v want %v", got, wantRaw)
		}
	})
}

// TestEssenceReaverAbilityStartedArmsReadyOnly: cast 武装 ready=1，ICD 仍为 0（ICD 从强化攻击消耗开始）。
func TestEssenceReaverAbilityStartedArmsReadyOnly(t *testing.T) {
	compileReq, runReq := loadEssenceReaverFixture(t, essenceReaverCritChance)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runSpellblade(t, compileReq, runReq)
	if countEmittedEvents(done, spellbladeCastEvent) != 1 {
		t.Fatalf("ability_started count=%d want 1", countEmittedEvents(done, spellbladeCastEvent))
	}
	if got := essenceReaverStateValue(t, done, spellbladeReadyKey); got != 1 {
		t.Fatalf("spellblade_ready=%v want 1", got)
	}
	if got := essenceReaverStateValue(t, done, spellbladeICDKey); got != 0 {
		t.Fatalf("spellblade_icd=%v want 0 (ICD starts on empowered hit consume)", got)
	}
}

// TestEssenceReaverArmedHitConsumesReadyAndArmsICD: 强化命中后 ready=0、ICD=1；顺序 damage→ICD→consume。
func TestEssenceReaverArmedHitConsumesReadyAndArmsICD(t *testing.T) {
	compileReq, runReq := loadEssenceReaverFixture(t, essenceReaverCritChance)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runSpellblade(t, compileReq, runReq)
	if countDamageByOpRef(done, essenceReaverDamageOpRef, false) != 1 {
		t.Fatalf("essence reaver damage count=%d want 1", countDamageByOpRef(done, essenceReaverDamageOpRef, false))
	}
	if got := essenceReaverStateValue(t, done, spellbladeReadyKey); got != 0 {
		t.Fatalf("spellblade_ready=%v want 0 after consume", got)
	}
	if got := essenceReaverStateValue(t, done, spellbladeICDKey); got != 1 {
		t.Fatalf("spellblade_icd=%v want 1 after empowered hit", got)
	}
}

// TestEssenceReaverICDBlocksRearmWithin1500ms: 消耗后 1.5s 内再 cast 不得武装。
func TestEssenceReaverICDBlocksRearmWithin1500ms(t *testing.T) {
	compileReq, runReq := loadEssenceReaverFixture(t, essenceReaverCritChance)
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
	if countDamageByOpRef(done, essenceReaverDamageOpRef, false) != 1 {
		t.Fatalf("essence reaver damage count=%d want 1 (ICD must block rearm)", countDamageByOpRef(done, essenceReaverDamageOpRef, false))
	}
	if got := essenceReaverStateValue(t, done, spellbladeReadyKey); got != 0 {
		t.Fatalf("spellblade_ready=%v want 0 (blocked rearm)", got)
	}
}

// TestEssenceReaverICDExpiresAllowsRearm: ICD 到期后可重新武装并再触发一次。
func TestEssenceReaverICDExpiresAllowsRearm(t *testing.T) {
	compileReq, runReq := loadEssenceReaverFixture(t, essenceReaverCritChance)
	const hitAt int64 = 100
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble1", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa1", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: hitAt},
		{EntryKey: "tumble2", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: hitAt + spellbladeICDDuration},
		{EntryKey: "aa2", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: hitAt + spellbladeICDDuration + 100},
	}
	runReq.StopPolicy.DurationMs = hitAt + spellbladeICDDuration + 200
	done := runSpellblade(t, compileReq, runReq)
	if countDamageByOpRef(done, essenceReaverDamageOpRef, false) != 2 {
		t.Fatalf("essence reaver damage count=%d want 2 (after ICD expiry rearm)", countDamageByOpRef(done, essenceReaverDamageOpRef, false))
	}
	wantRaw := 2 * essenceReaverExpectedRaw(essenceReaverADBase, essenceReaverCritChance)
	if got := sumDamageRawByOpRef(done, essenceReaverDamageOpRef); math.Abs(got-wantRaw) > 1e-6 {
		t.Fatalf("essence reaver raw sum=%v want %v", got, wantRaw)
	}
}

// TestEssenceReaverReadyExpiresWithoutProc: ready 10s 超时后命中不触发。
func TestEssenceReaverReadyExpiresWithoutProc(t *testing.T) {
	compileReq, runReq := loadEssenceReaverFixture(t, essenceReaverCritChance)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: spellbladeReadyDuration},
	}
	runReq.StopPolicy.DurationMs = spellbladeReadyDuration + 50
	done := runSpellblade(t, compileReq, runReq)
	if countDamageByOpRef(done, essenceReaverDamageOpRef, false) != 0 {
		t.Fatalf("essence reaver damage after ready expiry=%d want 0", countDamageByOpRef(done, essenceReaverDamageOpRef, false))
	}
	if got := essenceReaverStateValue(t, done, spellbladeReadyKey); got != 0 {
		t.Fatalf("spellblade_ready=%v want 0 after expiry", got)
	}
}

// TestEssenceReaverReadyGateBlocksRefresh: ready=1 时再 cast 不得刷新 ready 窗口。
func TestEssenceReaverReadyGateBlocksRefresh(t *testing.T) {
	compileReq, runReq := loadEssenceReaverFixture(t, essenceReaverCritChance)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble1", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "tumble2", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 500},
		{EntryKey: "aa", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: spellbladeReadyDuration},
	}
	runReq.StopPolicy.DurationMs = spellbladeReadyDuration + 50
	done := runSpellblade(t, compileReq, runReq)
	if countEmittedEvents(done, spellbladeCastEvent) != 2 {
		t.Fatalf("ability_started count=%d want 2", countEmittedEvents(done, spellbladeCastEvent))
	}
	if countDamageByOpRef(done, essenceReaverDamageOpRef, false) != 0 {
		t.Fatalf("essence reaver damage=%d want 0 (ready=0 gate must not refresh window)", countDamageByOpRef(done, essenceReaverDamageOpRef, false))
	}
}

// TestEssenceReaverPhantomDoesNotCopyOrConsume: Guinsoo phantom 不复制 Spellblade bonus，也不消耗 ready / 改写 ICD。
func TestEssenceReaverPhantomDoesNotCopyOrConsume(t *testing.T) {
	compileReq, runReq := loadEssenceReaverFixture(t, essenceReaverCritChance)
	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[1].Operations = essenceReaverAAOpsWithGuinsooStack()
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
				"state":    map[string]interface{}{guinsooStackKey: float64(3)},
				"expireAt": map[string]interface{}{guinsooStackKey: float64(10000)},
			},
		}
	}
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runSpellblade(t, compileReq, runReq)

	if countDamageByOpRef(done, essenceReaverDamageOpRef, false) != 1 {
		t.Fatalf("original essence reaver damage count=%d want 1", countDamageByOpRef(done, essenceReaverDamageOpRef, false))
	}
	if countDamageByOpRef(done, essenceReaverDamageOpRef, true) != 0 {
		t.Fatalf("phantom essence reaver damage count=%d want 0", countDamageByOpRef(done, essenceReaverDamageOpRef, true))
	}
	wantRaw := essenceReaverExpectedRaw(essenceReaverADBase, essenceReaverCritChance)
	if got := sumDamageRawByOpRef(done, essenceReaverDamageOpRef); math.Abs(got-wantRaw) > 1e-6 {
		t.Fatalf("essence reaver raw=%v want %v", got, wantRaw)
	}
	if got := essenceReaverStateValue(t, done, spellbladeReadyKey); got != 0 {
		t.Fatalf("spellblade_ready=%v want 0 (consumed once by real hit)", got)
	}
	if got := essenceReaverStateValue(t, done, spellbladeICDKey); got != 1 {
		t.Fatalf("spellblade_icd=%v want 1 (phantom must not touch ICD)", got)
	}
	if countDamageByOpRef(done, "op:guinsoo_copyable", true) != 1 {
		t.Fatalf("phantom guinsoo copyable count=%d want 1", countDamageByOpRef(done, "op:guinsoo_copyable", true))
	}
}

// TestEssenceReaverUsesEntrySourceAttrSnapshot: emit 前污染 live ad/crit 不得影响 Spellblade 公式（entry 快照）。
func TestEssenceReaverUsesEntrySourceAttrSnapshot(t *testing.T) {
	compileReq, runReq := loadEssenceReaverFixture(t, essenceReaverCritChance)
	compileReq.SharedProviders[0].Abilities[1].Operations = essenceReaverAAOpsWithAttrPollution()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runSpellblade(t, compileReq, runReq)

	wantRaw := essenceReaverExpectedRaw(essenceReaverADBase, essenceReaverCritChance) // 137.5 from entry snapshot
	livePollutedRaw := essenceReaverExpectedRaw(999, 0)                               // would be 1248.75 if live attrs used
	if math.Abs(livePollutedRaw-wantRaw) < 1e-6 {
		t.Fatal("polluted live raw must diverge from entry raw for this assertion")
	}
	if got := sumDamageRawByOpRef(done, essenceReaverDamageOpRef); math.Abs(got-wantRaw) > 1e-6 {
		t.Fatalf("essence reaver raw=%v want entry snapshot %v (live polluted would be %v)", got, wantRaw, livePollutedRaw)
	}
	wantMitigated := essenceReaverExpectedMitigated(essenceReaverADBase, essenceReaverCritChance, essenceReaverArmor)
	if got := sumDamageMitigatedByOpRef(done, essenceReaverDamageOpRef); math.Abs(got-wantMitigated) > 1e-6 {
		t.Fatalf("essence reaver mitigated=%v want %v", got, wantMitigated)
	}
}
