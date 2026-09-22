package runtime

import (
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

const (
	sdcProviderRef = "item:sdc_timer_probe"
	sdcTimedKey    = "timed_flag"
	sdcTargetKey   = "target_flag"
	sdcSubListener = "listener_sdc_subtract"
	sdcDurationMs  = 6000.0
	sdcChampionRef = spellbladeChampionRef
	sdcHitAbility  = spellbladeHitAbilityKey
	sdcProbeKey    = "sdc_probe"
)

func sdcTimedSlot(durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  float64(0),
		"maxValue":      float64(1),
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func sdcEnsureTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
	need := []model.TypeCatalogEntry{
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: "state_scope/provider_target", Domain: "state_scope"},
		{Key: "event/damage_instance", Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "ability/spell", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
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

func TestSubtractProviderExpireAtSemantics(t *testing.T) {
	bag := &providerStateBag{
		state:    map[string]float64{sdcTimedKey: 1},
		expireAt: map[string]int64{sdcTimedKey: 6000},
		fieldDefs: map[string]providerStateFieldDef{
			sdcTimedKey: {defaultValue: 0, maxValue: 1, hasCap: true, durationMs: 6000, refreshPolicy: model.ProviderStateRefreshOnWrite},
		},
	}
	// Inactive no-op.
	empty := &providerStateBag{expireAt: map[string]int64{}}
	applied, expired, exp := empty.subtractProviderExpireAt(sdcTimedKey, 0, 1000)
	if applied || expired || exp != 0 {
		t.Fatalf("inactive=%v/%v/%d", applied, expired, exp)
	}
	// Shorten without expiry.
	applied, expired, exp = bag.subtractProviderExpireAt(sdcTimedKey, 0, 1000)
	if !applied || expired || exp != 5000 || bag.expireAt[sdcTimedKey] != 5000 {
		t.Fatalf("shorten=%v/%v/%d bag=%d", applied, expired, exp, bag.expireAt[sdcTimedKey])
	}
	if bag.state[sdcTimedKey] != 1 {
		t.Fatalf("value mutated=%v", bag.state[sdcTimedKey])
	}
	// Immediate expiry at nowMs.
	bag.expireAt[sdcTimedKey] = 5500
	applied, expired, exp = bag.subtractProviderExpireAt(sdcTimedKey, 5000, 1000)
	if !applied || !expired || exp != 0 || bag.expireAt[sdcTimedKey] != 0 {
		t.Fatalf("immediate=%v/%v/%d bag=%d", applied, expired, exp, bag.expireAt[sdcTimedKey])
	}
}

func TestSubtractTargetExpireAtSemantics(t *testing.T) {
	bag := &providerStateBag{
		targetKey:      "target",
		targetValues:   map[string]float64{sdcTargetKey: 1},
		targetExpireAt: map[string]int64{sdcTargetKey: 8000},
		fieldDefs: map[string]providerStateFieldDef{
			sdcTargetKey: {defaultValue: 0, maxValue: 1, hasCap: true, durationMs: 8000, refreshPolicy: model.ProviderStateRefreshOnWrite},
		},
	}
	applied, expired, exp := bag.subtractTargetExpireAt(sdcTargetKey, 1000, 2000)
	if !applied || expired || exp != 6000 {
		t.Fatalf("target shorten=%v/%v/%d", applied, expired, exp)
	}
	if bag.targetValues[sdcTargetKey] != 1 {
		t.Fatalf("target value mutated=%v", bag.targetValues[sdcTargetKey])
	}
	applied, expired, exp = bag.subtractTargetExpireAt(sdcTargetKey, 6000, 5000)
	if !applied || !expired || exp != 0 || bag.targetExpireAt[sdcTargetKey] != 0 {
		t.Fatalf("target immediate=%v/%v/%d", applied, expired, exp)
	}
}

func sdcMountProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, scope string, subtractAmount float64, armOnDamage bool) {
	one := 1.0
	schemaKey := sdcTimedKey
	if scope == "state_scope/provider_target" {
		schemaKey = sdcTargetKey
	}
	ops := []model.OperationDefinition{}
	if armOnDamage {
		ops = append(ops, model.OperationDefinition{
			Operation:   "state_change",
			Target:      "source",
			Ref:         schemaKey,
			Types:       []string{scope},
			ValuePolicy: "override",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		})
	}
	ops = append(ops, model.OperationDefinition{
		Operation:   model.OperationKindStateDurationChange,
		Target:      "source",
		Ref:         schemaKey,
		Types:       []string{scope},
		ValuePolicy: "subtract",
		Amount:      &model.GenericFormulaExpr{Op: "const", Value: &subtractAmount},
	})
	listener := model.ListenerDefinition{
		ListenerKey:  sdcSubListener,
		EventMatcher: model.TypeMatcher{All: []string{"event/damage_instance", "ability/basic_attack", "event/source_owner"}},
		Operations:   ops,
	}
	readPath := "provider.state." + schemaKey
	if scope == "state_scope/provider_target" {
		readPath = "provider.target_state." + schemaKey
	}
	// Modifier forces attribute resolve to lazy-expire the timed key on probes.
	mod := model.ModifierDefinition{
		ModifierKey: "sdc_probe_as",
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(0.01),
				{Op: "read", Path: readPath},
			},
		},
	}
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: sdcProviderRef,
		Kind:        "item",
		StableID:    "sdc_probe",
		InitialStateSchema: map[string]interface{}{
			schemaKey: sdcTimedSlot(sdcDurationMs),
		},
		Modifiers: []model.ModifierDefinition{mod},
		Listeners: []model.ListenerDefinition{listener},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: sdcProviderRef, DefinitionRef: sdcProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{ProviderRef: sdcProviderRef, DefinitionRef: sdcProviderRef, Stacks: 1, State: map[string]interface{}{}},
		)
	}
}

func sdcConfigureAA(compileReq *model.CompileRequest) {
	one := 1.0
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: sdcHitAbility,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		CastOrigin: model.CastOriginChampion,
		Operations: []model.OperationDefinition{{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
			Ref:        "op:sdc_aa",
		}},
	}}
}

func sdcAARef() string {
	return "source.provider[" + sdcChampionRef + "].ability[" + sdcHitAbility + "]"
}

func sdcProbeRef() string {
	return "source.provider[" + sdcChampionRef + "].ability[" + sdcProbeKey + "]"
}

func sdcAttachProbe(compileReq *model.CompileRequest) {
	one := 1.0
	compileReq.SharedProviders[0].Abilities = append(compileReq.SharedProviders[0].Abilities, model.AbilityDefinition{
		AbilityKey: sdcProbeKey,
		Kind:       "active",
		Types:      []string{"ability/spell"},
		CastOrigin: model.CastOriginChampion,
		Operations: []model.OperationDefinition{{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
			Ref:        "op:sdc_probe",
		}},
	})
}

func sdcLoad(t *testing.T, scope string, subtractAmount float64, armOnDamage bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	sdcEnsureTypes(&compileReq)
	sdcConfigureAA(&compileReq)
	sdcAttachProbe(&compileReq)
	sdcMountProvider(&compileReq, &runReq, scope, subtractAmount, armOnDamage)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: 0.6, Current: 0.6, Max: 0.6, Resolved: 0.6,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func sdcRun(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compileMigrated(&compileReq, &runReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatalf("RunGeneric err=%+v", err)
	}
	return done
}

func sdcStateValue(t *testing.T, done model.DoneResult, scope, key string) float64 {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, sdcProviderRef)
	if scope == "state_scope/provider_target" {
		ts, ok := bag["targetState"].(map[string]interface{})
		if !ok {
			return 0
		}
		values, _ := ts["values"].(map[string]interface{})
		v, _ := values[key].(float64)
		return v
	}
	state, ok := bag["state"].(map[string]interface{})
	if !ok {
		t.Fatalf("state missing: %+v", bag)
	}
	v, _ := state[key].(float64)
	return v
}

// TestStateDurationChangeProviderShortenAndExactExpiry: arm@0, subtract 1000 → live@4999 dead@5000.
func TestStateDurationChangeProviderShortenAndExactExpiry(t *testing.T) {
	compileReq, runReq := sdcLoad(t, "state_scope/provider", 1000, true)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "arm", AbilityRef: sdcAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "probe_live", AbilityRef: sdcProbeRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 4999},
	}
	runReq.StopPolicy.DurationMs = 4999
	doneLive := sdcRun(t, compileReq, runReq)
	if got := sdcStateValue(t, doneLive, "state_scope/provider", sdcTimedKey); got != 1 {
		t.Fatalf("live@4999=%v want 1", got)
	}

	compileReq2, runReq2 := sdcLoad(t, "state_scope/provider", 1000, true)
	runReq2.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "arm", AbilityRef: sdcAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "probe_dead", AbilityRef: sdcProbeRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 5000},
	}
	runReq2.StopPolicy.DurationMs = 5000
	doneDead := sdcRun(t, compileReq2, runReq2)
	if got := sdcStateValue(t, doneDead, "state_scope/provider", sdcTimedKey); got != 0 {
		t.Fatalf("dead@5000=%v want 0", got)
	}
}

// TestStateDurationChangeRoundSemantics: 1000.4→1000ms; 1000.5→1001ms (math.Round half away from zero).
func TestStateDurationChangeRoundSemantics(t *testing.T) {
	compileReq, runReq := sdcLoad(t, "state_scope/provider", 1000.4, true)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "arm", AbilityRef: sdcAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "probe", AbilityRef: sdcProbeRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 5000},
	}
	runReq.StopPolicy.DurationMs = 5000
	done := sdcRun(t, compileReq, runReq)
	if got := sdcStateValue(t, done, "state_scope/provider", sdcTimedKey); got != 0 {
		t.Fatalf("1000.4→1000: @5000=%v want 0", got)
	}

	compileReq2, runReq2 := sdcLoad(t, "state_scope/provider", 1000.5, true)
	runReq2.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "arm", AbilityRef: sdcAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "probe_live", AbilityRef: sdcProbeRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 4998},
	}
	runReq2.StopPolicy.DurationMs = 4998
	doneLive := sdcRun(t, compileReq2, runReq2)
	if got := sdcStateValue(t, doneLive, "state_scope/provider", sdcTimedKey); got != 1 {
		t.Fatalf("1000.5→1001: @4998=%v want 1 (expireAt=4999)", got)
	}

	compileReq3, runReq3 := sdcLoad(t, "state_scope/provider", 1000.5, true)
	runReq3.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "arm", AbilityRef: sdcAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "probe_dead", AbilityRef: sdcProbeRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 4999},
	}
	runReq3.StopPolicy.DurationMs = 4999
	doneDead := sdcRun(t, compileReq3, runReq3)
	if got := sdcStateValue(t, doneDead, "state_scope/provider", sdcTimedKey); got != 0 {
		t.Fatalf("1000.5→1001: @4999=%v want 0", got)
	}
}

func TestStateDurationChangeInactiveTimerNoOp(t *testing.T) {
	compileReq, runReq := sdcLoad(t, "state_scope/provider", 1000, false)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: sdcAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 100
	done := sdcRun(t, compileReq, runReq)
	if got := sdcStateValue(t, done, "state_scope/provider", sdcTimedKey); got != 0 {
		t.Fatalf("inactive no-op left state=%v", got)
	}
}

func TestStateDurationChangeImmediateExpiryRestoresDefault(t *testing.T) {
	compileReq, runReq := sdcLoad(t, "state_scope/provider", 6000, true)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "arm", AbilityRef: sdcAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 10
	done := sdcRun(t, compileReq, runReq)
	if got := sdcStateValue(t, done, "state_scope/provider", sdcTimedKey); got != 0 {
		t.Fatalf("immediate expiry state=%v want 0", got)
	}
}

func TestStateDurationChangeNegativeAndNonFiniteFailClosed(t *testing.T) {
	t.Run("negative", func(t *testing.T) {
		compileReq, runReq := sdcLoad(t, "state_scope/provider", -1, true)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "arm", AbilityRef: sdcAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 10
		result := compile.CompileGeneric(compileReq)
		if !result.OK {
			t.Fatalf("compile failed: %+v", result.Result.Errors)
		}
		_, err := RunGeneric(result.Session, runReq)
		if err == nil {
			t.Fatal("expected fail-closed run error")
		}
	})
	for _, tc := range []struct {
		name string
		amt  *model.GenericFormulaExpr
	}{
		{
			name: "divByZeroInf",
			amt: &model.GenericFormulaExpr{
				Op: "div",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: floatPtrRuntime(1)},
					{Op: "const", Value: floatPtrRuntime(0)},
				},
			},
		},
		{
			name: "zeroDivZeroNan",
			amt: &model.GenericFormulaExpr{
				Op: "div",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: floatPtrRuntime(0)},
					{Op: "const", Value: floatPtrRuntime(0)},
				},
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := sdcLoad(t, "state_scope/provider", 1000, true)
			for i := range compileReq.SharedProviders {
				if compileReq.SharedProviders[i].ProviderKey != sdcProviderRef {
					continue
				}
				for j := range compileReq.SharedProviders[i].Listeners {
					ops := compileReq.SharedProviders[i].Listeners[j].Operations
					for k := range ops {
						if ops[k].Operation == model.OperationKindStateDurationChange {
							ops[k].Amount = tc.amt
						}
					}
				}
			}
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "arm", AbilityRef: sdcAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 10
			result := compile.CompileGeneric(compileReq)
			if !result.OK {
				t.Fatalf("compile failed: %+v", result.Result.Errors)
			}
			_, err := RunGeneric(result.Session, runReq)
			if err == nil {
				t.Fatal("expected fail-closed run error")
			}
		})
	}
}

func floatPtrRuntime(v float64) *float64 { return &v }

func sdcFailingAmountDivByZero() *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{
		Op: "div",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: floatPtrRuntime(1)},
			{Op: "const", Value: floatPtrRuntime(0)},
		},
	}
}

func sdcPatchSubtractAmount(compileReq *model.CompileRequest, amount *model.GenericFormulaExpr) {
	for i := range compileReq.SharedProviders {
		if compileReq.SharedProviders[i].ProviderKey != sdcProviderRef {
			continue
		}
		for j := range compileReq.SharedProviders[i].Listeners {
			ops := compileReq.SharedProviders[i].Listeners[j].Operations
			for k := range ops {
				if ops[k].Operation == model.OperationKindStateDurationChange {
					ops[k].Amount = amount
				}
			}
		}
		for j := range compileReq.SharedProviders[i].Abilities {
			ops := compileReq.SharedProviders[i].Abilities[j].Operations
			for k := range ops {
				if ops[k].Operation == model.OperationKindStateDurationChange {
					ops[k].Amount = amount
				}
			}
		}
	}
}

const sdcArmAbilityKey = "sdc_arm"

func sdcArmRef() string {
	return "source.provider[" + sdcProviderRef + "].ability[" + sdcArmAbilityKey + "]"
}

// sdcMountArmAbilityAndSubtractListener arms via cast ability; subtract-only damage listener
// never re-arms, so exact-expiry boundaries can prove amount is skipped after lazy-expire.
func sdcMountArmAbilityAndSubtractListener(compileReq *model.CompileRequest, runReq *model.RunRequest, subtractAmount *model.GenericFormulaExpr) {
	one := 1.0
	schemaKey := sdcTimedKey
	armAbility := model.AbilityDefinition{
		AbilityKey: sdcArmAbilityKey,
		Kind:       "active",
		Types:      []string{"ability/spell"},
		CastOrigin: model.CastOriginItem,
		Operations: []model.OperationDefinition{{
			Operation:   "state_change",
			Target:      "source",
			Ref:         schemaKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "override",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		}},
	}
	listener := model.ListenerDefinition{
		ListenerKey:  sdcSubListener,
		EventMatcher: model.TypeMatcher{All: []string{"event/damage_instance", "ability/basic_attack", "event/source_owner"}},
		Operations: []model.OperationDefinition{{
			Operation:   model.OperationKindStateDurationChange,
			Target:      "source",
			Ref:         schemaKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "subtract",
			Amount:      subtractAmount,
		}},
	}
	readPath := "provider.state." + schemaKey
	mod := model.ModifierDefinition{
		ModifierKey: "sdc_probe_as",
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(0.01),
				{Op: "read", Path: readPath},
			},
		},
	}
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: sdcProviderRef,
		Kind:        "item",
		StableID:    "sdc_probe",
		InitialStateSchema: map[string]interface{}{
			schemaKey: sdcTimedSlot(sdcDurationMs),
		},
		Modifiers: []model.ModifierDefinition{mod},
		Abilities: []model.AbilityDefinition{armAbility},
		Listeners: []model.ListenerDefinition{listener},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: sdcProviderRef, DefinitionRef: sdcProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{ProviderRef: sdcProviderRef, DefinitionRef: sdcProviderRef, Stacks: 1, State: map[string]interface{}{}},
		)
	}
}

// TestStateDurationChangeInactiveSkipsFailingAmount: inactive timer must no-op before
// amount evaluation, so a non-finite amount formula is a successful no-op.
func TestStateDurationChangeInactiveSkipsFailingAmount(t *testing.T) {
	compileReq, runReq := sdcLoad(t, "state_scope/provider", 1000, false)
	sdcPatchSubtractAmount(&compileReq, sdcFailingAmountDivByZero())
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: sdcAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 100
	done := sdcRun(t, compileReq, runReq)
	if got := sdcStateValue(t, done, "state_scope/provider", sdcTimedKey); got != 0 {
		t.Fatalf("inactive skip-amount left state=%v", got)
	}
}

// TestStateDurationChangeExactExpirySkipsFailingAmount: timer exactly expired at the
// current event boundary must lazy-expire to inactive and skip a failing amount formula.
func TestStateDurationChangeExactExpirySkipsFailingAmount(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	sdcEnsureTypes(&compileReq)
	sdcConfigureAA(&compileReq)
	sdcAttachProbe(&compileReq)
	sdcMountArmAbilityAndSubtractListener(&compileReq, &runReq, sdcFailingAmountDivByZero())
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: 0.6, Current: 0.6, Max: 0.6, Resolved: 0.6,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	// Arm@0 → expireAt=6000; AA@6000 lazy-expires then inactive no-op before amount eval.
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "arm", AbilityRef: sdcArmRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "exact_expiry", AbilityRef: sdcAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 6000},
	}
	runReq.StopPolicy.DurationMs = 6000
	done := sdcRun(t, compileReq, runReq)
	if got := sdcStateValue(t, done, "state_scope/provider", sdcTimedKey); got != 0 {
		t.Fatalf("exact-expiry skip-amount left state=%v want 0", got)
	}
}

// TestStateDurationChangeProviderTargetRescheduleAndStaleExpiry:
// arm+sub@0 → exp=4000; refresh+sub@3500 → exp=7500; stale 4000 cleanup must not clear refreshed cycle.
func TestStateDurationChangeProviderTargetRescheduleAndStaleExpiry(t *testing.T) {
	compileReq, runReq := sdcLoad(t, "state_scope/provider_target", 2000, true)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "arm0", AbilityRef: sdcAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "refresh", AbilityRef: sdcAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 3500},
		{EntryKey: "after_stale", AbilityRef: sdcProbeRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 5000},
	}
	runReq.StopPolicy.DurationMs = 5000
	done := sdcRun(t, compileReq, runReq)
	if got := sdcStateValue(t, done, "state_scope/provider_target", sdcTargetKey); got != 1 {
		t.Fatalf("after stale window state=%v want 1", got)
	}

	compileReq2, runReq2 := sdcLoad(t, "state_scope/provider_target", 2000, true)
	runReq2.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "arm0", AbilityRef: sdcAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
	}
	runReq2.StopPolicy.DurationMs = 4000
	doneExpired := sdcRun(t, compileReq2, runReq2)
	if got := sdcStateValue(t, doneExpired, "state_scope/provider_target", sdcTargetKey); got != 0 {
		t.Fatalf("provider_target scheduled expiry@4000 state=%v want 0", got)
	}
}
