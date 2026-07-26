package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// item_3032 Yun Tal Wildarrows — Flurry / 疾风骤雨 (generic ABI).
//
// Wiki (Module:ItemData/data, revid 4030984):
//
//	+30% bonus AS for 6000ms, 30000ms cooldown;
//	on-hit cooldown −1000ms; critical total −2000ms via expected-crit q.
//
// Frozen contract yun-tal-flurry-3032-v2:
//
//	listener event/damage_instance + ability/basic_attack + event/source_owner,
//	perCastThrottleMs=1; CDR = 1000 + 1000*clamp(event.damage.effectiveCritChance,0,1);
//	ops: arm active; arm cooldown; duration subtract. Triggering attack reduces CD;
//	later attacks do not refresh the 6s buff.
//
// Path: CompileGeneric → RunGeneric only. Independent of 熟能生巧 provider.

const (
	yunTalFlurryProviderRef = "item:yun_tal_flurry"
	yunTalFlurryStableID    = "item_3032"
	yunTalFlurryListener    = "listener_item_3032_yun_tal_flurry"
	yunTalFlurryASModKey    = "modifier_item_3032_yun_tal_flurry_as"
	yunTalFlurryActiveKey   = "flurry_active"
	yunTalFlurryCooldownKey = "flurry_cooldown"
	yunTalFlurryChampionRef = spellbladeChampionRef
	yunTalFlurryAAKey       = spellbladeHitAbilityKey
	yunTalFlurryMultiKey    = "basic_attack_multi"
	yunTalFlurryProbeKey    = "yun_tal_flurry_as_probe"
	yunTalFlurryAAOpRef     = "op:yun_tal_flurry_aa"
	yunTalFlurryAA2OpRef    = "op:yun_tal_flurry_aa2"

	yunTalFlurryActiveMs   = 6000.0
	yunTalFlurryCooldownMs = 30000.0
	yunTalFlurryASBonus    = 0.30
	yunTalFlurryBaseAS     = 0.60
	yunTalFlurryAADamage   = 10.0
	yunTalFlurryCritDamage = 1.75
	yunTalFlurryTol        = 1e-9
)

func yunTalFlurryExpectedAS(active float64) float64 {
	return yunTalFlurryBaseAS * (1 + yunTalFlurryASBonus*active)
}

func yunTalFlurryWantCDR(q float64) float64 {
	if q < 0 {
		q = 0
	}
	if q > 1 {
		q = 1
	}
	return 1000 + 1000*q
}

func yunTalFlurryTimedSlot(durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  float64(0),
		"maxValue":      float64(1),
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func yunTalFlurryStateSchema() map[string]interface{} {
	return map[string]interface{}{
		yunTalFlurryActiveKey:   yunTalFlurryTimedSlot(yunTalFlurryActiveMs),
		yunTalFlurryCooldownKey: yunTalFlurryTimedSlot(yunTalFlurryCooldownMs),
	}
}

func yunTalFlurryCooldownZeroCond() *model.GenericFormulaExpr {
	zero := 0.0
	return &model.GenericFormulaExpr{
		Op: "eq",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + yunTalFlurryCooldownKey},
			{Op: "const", Value: &zero},
		},
	}
}

func yunTalFlurryCDRAmount() *model.GenericFormulaExpr {
	zero := 0.0
	one := 1.0
	thousand := 1000.0
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &thousand},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &thousand},
					{
						Op:   "clamp",
						Expr: &model.GenericFormulaExpr{Op: "read", Path: "event.damage.effectiveCritChance"},
						Min:  &model.GenericFormulaExpr{Op: "const", Value: &zero},
						Max:  &model.GenericFormulaExpr{Op: "const", Value: &one},
					},
				},
			},
		},
	}
}

func yunTalFlurryASModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: yunTalFlurryASModKey,
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(yunTalFlurryASBonus),
				{Op: "read", Path: "provider.state." + yunTalFlurryActiveKey},
			},
		},
	}
}

func yunTalFlurryMakeListener() model.ListenerDefinition {
	one := 1.0
	cd0 := yunTalFlurryCooldownZeroCond()
	return model.ListenerDefinition{
		ListenerKey:       yunTalFlurryListener,
		PerCastThrottleMs: 1,
		EventMatcher: model.TypeMatcher{All: []string{
			"event/damage_instance", "ability/basic_attack", "event/source_owner",
		}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         yunTalFlurryActiveKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   cd0,
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         yunTalFlurryCooldownKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   cd0,
			},
			{
				Operation:   model.OperationKindStateDurationChange,
				Target:      "source",
				Ref:         yunTalFlurryCooldownKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "subtract",
				Amount:      yunTalFlurryCDRAmount(),
			},
		},
	}
}

func yunTalFlurryEnsureTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
	need := []model.TypeCatalogEntry{
		{Key: "event/damage_instance", Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "ability/spell", Domain: "ability"},
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "cast_origin/champion", Domain: "cast_origin"},
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

func yunTalFlurryAAOps(multi bool) []model.OperationDefinition {
	aa := yunTalFlurryAADamage
	ops := []model.OperationDefinition{{
		Operation:    "damage",
		Target:       "target",
		DamageType:   "damage/physical",
		Amount:       &model.GenericFormulaExpr{Op: "const", Value: &aa},
		CritEligible: true,
		Ref:          yunTalFlurryAAOpRef,
	}}
	if multi {
		ops = append(ops, model.OperationDefinition{
			Operation:    "damage",
			Target:       "target",
			DamageType:   "damage/physical",
			Amount:       &model.GenericFormulaExpr{Op: "const", Value: &aa},
			CritEligible: true,
			Ref:          yunTalFlurryAA2OpRef,
		})
	}
	return ops
}

func yunTalFlurryMountProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        yunTalFlurryProviderRef,
		Kind:               "item",
		StableID:           yunTalFlurryStableID,
		InitialStateSchema: yunTalFlurryStateSchema(),
		Modifiers:          []model.ModifierDefinition{yunTalFlurryASModifier()},
		Listeners:          []model.ListenerDefinition{yunTalFlurryMakeListener()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: yunTalFlurryProviderRef, DefinitionRef: yunTalFlurryProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: yunTalFlurryProviderRef, DefinitionRef: yunTalFlurryProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
		if runReq.InitialSnapshot.Combatants[i].ProviderState == nil {
			runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState[yunTalFlurryProviderRef] = map[string]interface{}{
			"state": map[string]interface{}{
				yunTalFlurryActiveKey:   float64(0),
				yunTalFlurryCooldownKey: float64(0),
			},
		}
	}
}

func yunTalFlurryAttachProbe(compileReq *model.CompileRequest) {
	one := 1.0
	compileReq.SharedProviders[0].Abilities = append(compileReq.SharedProviders[0].Abilities, model.AbilityDefinition{
		AbilityKey: yunTalFlurryProbeKey,
		Kind:       "active",
		// Typed ability/spell so damage_instance does not match Flurry's basic_attack listener.
		Types:      []string{"ability/spell"},
		CastOrigin: model.CastOriginChampion,
		Operations: []model.OperationDefinition{{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
			Ref:        "op:yun_tal_flurry_probe",
		}},
	})
}

func yunTalFlurryAARef() string {
	return "source.provider[" + yunTalFlurryChampionRef + "].ability[" + yunTalFlurryAAKey + "]"
}

func yunTalFlurryMultiRef() string {
	return "source.provider[" + yunTalFlurryChampionRef + "].ability[" + yunTalFlurryMultiKey + "]"
}

func yunTalFlurryProbeRef() string {
	return "source.provider[" + yunTalFlurryChampionRef + "].ability[" + yunTalFlurryProbeKey + "]"
}

func yunTalFlurryLoadFixture(t *testing.T, critChance float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	yunTalFlurryEnsureTypes(&compileReq)
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: yunTalFlurryAAKey,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			CastOrigin: model.CastOriginChampion,
			Operations: yunTalFlurryAAOps(false),
		},
		{
			AbilityKey: yunTalFlurryMultiKey,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			CastOrigin: model.CastOriginChampion,
			Operations: yunTalFlurryAAOps(true),
		},
	}
	yunTalFlurryAttachProbe(&compileReq)
	yunTalFlurryMountProvider(&compileReq, &runReq)
	setSourceCritAttrs(&compileReq, &runReq, critChance, yunTalFlurryCritDamage)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: yunTalFlurryBaseAS, Current: yunTalFlurryBaseAS, Max: yunTalFlurryBaseAS, Resolved: yunTalFlurryBaseAS,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func yunTalFlurryRun(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatalf("RunGeneric err=%+v", err)
	}
	return done
}

func yunTalFlurryState(t *testing.T, done model.DoneResult) (active, cooldown float64) {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, yunTalFlurryProviderRef)
	state, ok := bag["state"].(map[string]interface{})
	if !ok {
		t.Fatalf("state bag missing: %+v", bag)
	}
	active, _ = state[yunTalFlurryActiveKey].(float64)
	cooldown, _ = state[yunTalFlurryCooldownKey].(float64)
	return
}

func yunTalFlurrySetDriver(runReq *model.RunRequest, entries []model.DriverEntry, durationMs int64) {
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = durationMs
}

func TestYunTalFlurry3032WikiConstantsAndCompileContract(t *testing.T) {
	if yunTalFlurryASBonus != 0.30 || yunTalFlurryActiveMs != 6000 || yunTalFlurryCooldownMs != 30000 {
		t.Fatalf("wiki constants AS/active/cd=%v/%v/%v", yunTalFlurryASBonus, yunTalFlurryActiveMs, yunTalFlurryCooldownMs)
	}
	if yunTalFlurryWantCDR(0) != 1000 || yunTalFlurryWantCDR(0.25) != 1250 || yunTalFlurryWantCDR(1) != 2000 {
		t.Fatalf("CDR formula q=0/0.25/1 → %v/%v/%v", yunTalFlurryWantCDR(0), yunTalFlurryWantCDR(0.25), yunTalFlurryWantCDR(1))
	}
	compileReq, _ := yunTalFlurryLoadFixture(t, 0)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	var provider *compile.CompiledProvider
	for i := range result.Session.Providers {
		if result.Session.Providers[i].ProviderKey == yunTalFlurryProviderRef {
			provider = &result.Session.Providers[i]
			break
		}
	}
	if provider == nil {
		t.Fatal("missing flurry provider")
	}
	active := provider.StateFields[yunTalFlurryActiveKey]
	if active.DurationMs != int64(yunTalFlurryActiveMs) || active.RefreshPolicy != model.ProviderStateRefreshOnWrite {
		t.Fatalf("active field=%+v", active)
	}
	cd := provider.StateFields[yunTalFlurryCooldownKey]
	if cd.DurationMs != int64(yunTalFlurryCooldownMs) || cd.RefreshPolicy != model.ProviderStateRefreshOnWrite {
		t.Fatalf("cooldown field=%+v", cd)
	}
	if len(provider.Listeners) != 1 || provider.Listeners[0].ListenerKey != yunTalFlurryListener {
		t.Fatalf("listeners=%+v", provider.Listeners)
	}
	if provider.Listeners[0].PerCastThrottleMs != 1 {
		t.Fatalf("PerCastThrottleMs=%d want 1", provider.Listeners[0].PerCastThrottleMs)
	}
	if provider.Listeners[0].OperationCount != 3 {
		t.Fatalf("ops=%d want 3", provider.Listeners[0].OperationCount)
	}
	ops := result.Session.Operations[provider.Listeners[0].OperationStart : provider.Listeners[0].OperationStart+provider.Listeners[0].OperationCount]
	if ops[0].Operation != "state_change" || ops[0].Ref != yunTalFlurryActiveKey || !ops[0].HasCondition {
		t.Fatalf("op0=%+v", ops[0])
	}
	if ops[1].Operation != "state_change" || ops[1].Ref != yunTalFlurryCooldownKey || !ops[1].HasCondition {
		t.Fatalf("op1=%+v", ops[1])
	}
	if ops[2].Operation != model.OperationKindStateDurationChange || ops[2].Ref != yunTalFlurryCooldownKey ||
		ops[2].ValuePolicy != "subtract" || ops[2].StateScope != "state_scope/provider" {
		t.Fatalf("op2=%+v", ops[2])
	}
}

func TestYunTalFlurry3032FirstActivationAndCDRByQ(t *testing.T) {
	cases := []struct {
		name string
		q    float64
	}{
		{"q0", 0},
		{"q025", 0.25},
		{"q1", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := yunTalFlurryLoadFixture(t, tc.q)
			yunTalFlurrySetDriver(&runReq, []model.DriverEntry{
				{EntryKey: "aa0", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
				{EntryKey: "probe", AbilityRef: yunTalFlurryProbeRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
			}, 100)
			done := yunTalFlurryRun(t, compileReq, runReq)
			active, cd := yunTalFlurryState(t, done)
			if active != 1 || cd != 1 {
				t.Fatalf("after first hit active/cd=%v/%v want 1/1", active, cd)
			}
			wantAS := yunTalFlurryExpectedAS(1)
			if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-wantAS) > yunTalFlurryTol {
				t.Fatalf("AS=%v want %v", got, wantAS)
			}
			// Prove CDR via exact rearm boundary: expireAt = 30000 - wantCDR(q).
			// Do not fire another basic_attack before ready — that would subtract again.
			expireAt := int64(yunTalFlurryCooldownMs - yunTalFlurryWantCDR(tc.q))
			compileReq2, runReq2 := yunTalFlurryLoadFixture(t, tc.q)
			yunTalFlurrySetDriver(&runReq2, []model.DriverEntry{
				{EntryKey: "aa0", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
				{EntryKey: "probe_blocked", AbilityRef: yunTalFlurryProbeRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: expireAt - 1},
			}, expireAt-1)
			doneBlocked := yunTalFlurryRun(t, compileReq2, runReq2)
			activeBlocked, cdBlocked := yunTalFlurryState(t, doneBlocked)
			if cdBlocked != 1 {
				t.Fatalf("q=%v blocked rearm cd=%v want 1 at %d", tc.q, cdBlocked, expireAt-1)
			}
			if activeBlocked != 0 {
				t.Fatalf("q=%v active at blocked rearm=%v want 0 (CD still live)", tc.q, activeBlocked)
			}

			compileReq3, runReq3 := yunTalFlurryLoadFixture(t, tc.q)
			yunTalFlurrySetDriver(&runReq3, []model.DriverEntry{
				{EntryKey: "aa0", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
				{EntryKey: "ready", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: expireAt},
			}, expireAt)
			doneReady := yunTalFlurryRun(t, compileReq3, runReq3)
			activeReady, cdReady := yunTalFlurryState(t, doneReady)
			if activeReady != 1 || cdReady != 1 {
				t.Fatalf("q=%v rearm@%d active/cd=%v/%v want 1/1", tc.q, expireAt, activeReady, cdReady)
			}
		})
	}
}

func TestYunTalFlurry3032ForcedCritSharesQPath(t *testing.T) {
	const p = 0.25
	compileReq, runReq := yunTalFlurryLoadFixture(t, p)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, "item:flurry_force_crit", "flurry_force",
		c2PipelineMod("flurry_force_q", "crit", "all_damage", "crit_chance_pre_settlement", "override", 1, 0))
	expireAt := int64(yunTalFlurryCooldownMs - yunTalFlurryWantCDR(1)) // forced q=1 → 2000ms
	yunTalFlurrySetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "aa0", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "ready", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: expireAt},
	}, expireAt)
	done := yunTalFlurryRun(t, compileReq, runReq)
	active, cd := yunTalFlurryState(t, done)
	if active != 1 || cd != 1 {
		t.Fatalf("forced-crit rearm@%d active/cd=%v/%v want 1/1", expireAt, active, cd)
	}
	// Natural q=0.25 would only be ready at 28750; prove forced path used 28000.
	naturalReady := int64(yunTalFlurryCooldownMs - yunTalFlurryWantCDR(p))
	if expireAt >= naturalReady {
		t.Fatalf("forced expireAt=%d must be earlier than natural %d", expireAt, naturalReady)
	}
}

func TestYunTalFlurry3032ActiveExactBoundaryNoBuffRefresh(t *testing.T) {
	compileReq, runReq := yunTalFlurryLoadFixture(t, 0)
	yunTalFlurrySetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "aa0", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa_mid", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 3000},
		{EntryKey: "probe_live", AbilityRef: yunTalFlurryProbeRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 5999},
	}, 5999)
	doneLive := yunTalFlurryRun(t, compileReq, runReq)
	active, _ := yunTalFlurryState(t, doneLive)
	if active != 1 {
		t.Fatalf("active@5999 after mid-hit=%v want 1 (no refresh; still original 6s window)", active)
	}
	if got := sourceAttrResolved(t, doneLive.FinalSnapshot, "attack_speed"); math.Abs(got-yunTalFlurryExpectedAS(1)) > yunTalFlurryTol {
		t.Fatalf("AS@5999=%v want armed", got)
	}

	compileReq2, runReq2 := yunTalFlurryLoadFixture(t, 0)
	yunTalFlurrySetDriver(&runReq2, []model.DriverEntry{
		{EntryKey: "aa0", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa_mid", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 3000},
		{EntryKey: "probe_dead", AbilityRef: yunTalFlurryProbeRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 6000},
	}, 6000)
	doneDead := yunTalFlurryRun(t, compileReq2, runReq2)
	active, cd := yunTalFlurryState(t, doneDead)
	if active != 0 {
		t.Fatalf("active@6000=%v want 0 (exact expiry; mid-hit must not refresh)", active)
	}
	if cd != 1 {
		t.Fatalf("cooldown@6000=%v want 1", cd)
	}
	if got := sourceAttrResolved(t, doneDead.FinalSnapshot, "attack_speed"); math.Abs(got-yunTalFlurryExpectedAS(0)) > yunTalFlurryTol {
		t.Fatalf("AS@6000=%v want baseline", got)
	}
}

func TestYunTalFlurry3032RepeatedCooldownReductions(t *testing.T) {
	// q=0: first hit → CD 29000; two more hits −1000 each → ready at 27000.
	compileReq, runReq := yunTalFlurryLoadFixture(t, 0)
	yunTalFlurrySetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "aa0", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa1", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 1000},
		{EntryKey: "aa2", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 2000},
		{EntryKey: "probe_blocked", AbilityRef: yunTalFlurryProbeRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 26999},
	}, 26999)
	doneBlocked := yunTalFlurryRun(t, compileReq, runReq)
	active, cd := yunTalFlurryState(t, doneBlocked)
	if active != 0 || cd != 1 {
		t.Fatalf("blocked@26999 active/cd=%v/%v want 0/1", active, cd)
	}

	compileReq2, runReq2 := yunTalFlurryLoadFixture(t, 0)
	yunTalFlurrySetDriver(&runReq2, []model.DriverEntry{
		{EntryKey: "aa0", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa1", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 1000},
		{EntryKey: "aa2", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 2000},
		{EntryKey: "ready", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 27000},
	}, 27000)
	doneReady := yunTalFlurryRun(t, compileReq2, runReq2)
	active, cd = yunTalFlurryState(t, doneReady)
	if active != 1 || cd != 1 {
		t.Fatalf("ready@27000 active/cd=%v/%v want 1/1", active, cd)
	}
}

func TestYunTalFlurry3032MultiDamageSameCastThrottledOnce(t *testing.T) {
	compileReq, runReq := yunTalFlurryLoadFixture(t, 0)
	// Multi-op cast: two damage_instance events, throttle must apply CDR once (29000 ready).
	expireOnce := int64(yunTalFlurryCooldownMs - yunTalFlurryWantCDR(0))
	yunTalFlurrySetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "multi", AbilityRef: yunTalFlurryMultiRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "probe_blocked", AbilityRef: yunTalFlurryProbeRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: expireOnce - 1},
	}, expireOnce-1)
	doneBlocked := yunTalFlurryRun(t, compileReq, runReq)
	_, cd := yunTalFlurryState(t, doneBlocked)
	if cd != 1 {
		t.Fatalf("throttled once: cd@%d=%v want 1", expireOnce-1, cd)
	}

	compileReq2, runReq2 := yunTalFlurryLoadFixture(t, 0)
	yunTalFlurrySetDriver(&runReq2, []model.DriverEntry{
		{EntryKey: "multi", AbilityRef: yunTalFlurryMultiRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "ready", AbilityRef: yunTalFlurryAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: expireOnce},
	}, expireOnce)
	doneReady := yunTalFlurryRun(t, compileReq2, runReq2)
	active, cd := yunTalFlurryState(t, doneReady)
	if active != 1 || cd != 1 {
		t.Fatalf("throttled once rearm@%d active/cd=%v/%v want 1/1", expireOnce, active, cd)
	}
	if expireOnce != 29000 {
		t.Fatalf("single-reduce expireAt=%d want 29000", expireOnce)
	}
}
