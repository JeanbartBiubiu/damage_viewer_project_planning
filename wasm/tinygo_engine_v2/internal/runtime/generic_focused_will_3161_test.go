package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// item_3161 Spear of Shojin — Focused Will / 专注意志 (generic ABI Phase-A).
//
// Numeric authority (League Wiki item manifest only; no DDragon):
//   - current-items.raw.lua lines 7449-7452
//   - revid 4030984
//   - SHA256 e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d
//
// State focused_will_stacks: default0 / max4 / durationMs=6000 / aggregate refresh_on_write.
// Two grant listeners (champion|pet origin), Any ability|pet traits, None basic_attack|item|innate,
// perCastThrottleMs=1000, add+1. Proc never grants.
// Outgoing pre-mitigation multiply 1+0.03*stacks when
//   (trait ability|pet|proc) AND (origin champion|pet) AND ability_type.basic_attack==0.
// Pipeline runs before listeners: triggering damage uses old stacks.
//
// Non-goals: Backend seed/live publish, Dragonforce, independent per-stack expiry, pet AI.

const (
	fwProviderRef   = "item:3161_focused_will"
	fwStableID      = "item_3161"
	fwStackKey      = "focused_will_stacks"
	fwChampionGrant = "listener_item_3161_focused_will_champion"
	fwPetGrant      = "listener_item_3161_focused_will_pet"
	fwModifierKey   = "modifier_item_3161_focused_will_amp"
	fwChampionRef   = spellbladeChampionRef

	fwStackMax   = 4.0
	fwDurationMs = 6000.0
	fwAmpPer     = 0.03
	fwBaseRaw    = 100.0
	fwTol        = 1e-9
)

func fwConst(v float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: &v}
}

func fwStateSchema() map[string]interface{} {
	return map[string]interface{}{
		fwStackKey: map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      fwStackMax,
			"durationMs":    fwDurationMs,
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
}

func fwGrantListener(key, origin string) model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey: key,
		EventMatcher: model.TypeMatcher{
			All: []string{"event/damage_instance", "event/source_owner", "cast_origin/" + origin},
			Any: []string{"damage_trait/ability", "damage_trait/pet"},
			None: []string{
				"ability/basic_attack",
				"cast_origin/item",
				"cast_origin/innate",
			},
		},
		PerCastThrottleMs: 1000,
		Operations: []model.OperationDefinition{{
			Operation:   "state_change",
			Target:      "source",
			Ref:         fwStackKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		}},
	}
}

func fwAmpCondition() *model.GenericFormulaExpr {
	zero := 0.0
	// max/min are binary-only in the formula compiler; nest for 3-way OR/AND.
	traitOK := model.GenericFormulaExpr{
		Op: "max",
		Args: []model.GenericFormulaExpr{
			{
				Op: "max",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "damage.trait.ability"},
					{Op: "read", Path: "damage.trait.pet"},
				},
			},
			{Op: "read", Path: "damage.trait.proc"},
		},
	}
	originOK := model.GenericFormulaExpr{
		Op: "max",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "damage.cast_origin.champion"},
			{Op: "read", Path: "damage.cast_origin.pet"},
		},
	}
	notBasic := model.GenericFormulaExpr{
		Op: "eq",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "damage.ability_type.basic_attack"},
			{Op: "const", Value: &zero},
		},
	}
	return &model.GenericFormulaExpr{
		Op: "min",
		Args: []model.GenericFormulaExpr{
			{
				Op:   "min",
				Args: []model.GenericFormulaExpr{traitOK, originOK},
			},
			notBasic,
		},
	}
}

func fwAmpValue() model.GenericFormulaExpr {
	one := 1.0
	amp := fwAmpPer
	return model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &one},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &amp},
					{Op: "read", Path: "provider.state." + fwStackKey},
				},
			},
		},
	}
}

func fwAmpModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: fwModifierKey,
		Kind:        "pipeline",
		Command:     "damage",
		Channel:     "all_damage",
		Stage:       "outgoing_pre_mitigation",
		Bucket:      "all_instances",
		Priority:    0,
		ValuePolicy: "multiply",
		Value:       fwAmpValue(),
		Condition:   fwAmpCondition(),
	}
}

func fwEnsureTypes(req *model.CompileRequest) {
	castCtxEnsureTypes(req)
}

func fwMountProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        fwProviderRef,
		Kind:               "item",
		StableID:           fwStableID,
		InitialStateSchema: fwStateSchema(),
		Listeners: []model.ListenerDefinition{
			fwGrantListener(fwChampionGrant, model.CastOriginChampion),
			fwGrantListener(fwPetGrant, model.CastOriginPet),
		},
		Modifiers: []model.ModifierDefinition{fwAmpModifier()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: fwProviderRef, DefinitionRef: fwProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: fwProviderRef, DefinitionRef: fwProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
		if runReq.InitialSnapshot.Combatants[i].ProviderState == nil {
			runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState[fwProviderRef] = map[string]interface{}{
			"state": map[string]interface{}{fwStackKey: float64(0)},
		}
	}
}

func fwLoadFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	fwEnsureTypes(&compileReq)
	fwMountProvider(&compileReq, &runReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func fwRun(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compileMigrated(&compileReq, &runReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func fwStacks(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, fwProviderRef)
	state, ok := bag["state"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing state: %+v", bag)
	}
	v, _ := state[fwStackKey].(float64)
	return v
}

func fwAbilityRef(key string) string {
	return "source.provider[" + fwChampionRef + "].ability[" + key + "]"
}

func fwAddAbility(compileReq *model.CompileRequest, def model.AbilityDefinition) {
	for i := range compileReq.SharedProviders {
		if compileReq.SharedProviders[i].ProviderKey == "champion:source_demo" ||
			compileReq.SharedProviders[i].ProviderKey == fwChampionRef {
			compileReq.SharedProviders[i].Abilities = append(compileReq.SharedProviders[i].Abilities, def)
			return
		}
	}
	compileReq.SharedProviders[0].Abilities = append(compileReq.SharedProviders[0].Abilities, def)
}

func fwSpell(key, origin string, traits, abilityTypes []string, hits int) model.AbilityDefinition {
	ops := make([]model.OperationDefinition, 0, hits)
	raw := fwBaseRaw
	for i := 0; i < hits; i++ {
		ops = append(ops, model.OperationDefinition{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Ref:        "op:fw_" + key + "_" + itoaRuntime(i),
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &raw},
			Types:      append([]string(nil), traits...),
		})
	}
	return model.AbilityDefinition{
		AbilityKey: key,
		Kind:       "active",
		Types:      abilityTypes,
		CastOrigin: origin,
		Operations: ops,
	}
}

func fwDamageAmounts(done model.DoneResult, opPrefix string) []float64 {
	out := make([]float64, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindDamage {
			continue
		}
		ref, _ := item.Data["operationRef"].(string)
		if opPrefix != "" && (len(ref) < len(opPrefix) || ref[:len(opPrefix)] != opPrefix) {
			continue
		}
		if phantom, _ := item.Data["phantom"].(bool); phantom {
			continue
		}
		amt, _ := item.Data["rawAmount"].(float64)
		out = append(out, amt)
	}
	return out
}

func fwExpected(stacks float64) float64 {
	return fwBaseRaw * (1 + fwAmpPer*stacks)
}

func TestFocusedWill3161ProgressionCapAndOldStackOrdering(t *testing.T) {
	compileReq, runReq := fwLoadFixture(t)
	fwAddAbility(&compileReq, fwSpell("fw_ability", model.CastOriginChampion,
		[]string{"damage_trait/ability"}, []string{"ability/spell"}, 1))
	ref := fwAbilityRef("fw_ability")
	entries := make([]model.DriverEntry, 0, 5)
	for i := 0; i < 5; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey: "h" + itoaRuntime(i), AbilityRef: ref,
			Source: model.SelectorSource, Target: model.SelectorTarget,
			FirstAtMs: int64(i * 1100), // >1000 throttle between casts
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = 5500
	done := fwRun(t, compileReq, runReq)
	amts := fwDamageAmounts(done, "op:fw_fw_ability_")
	if len(amts) != 5 {
		t.Fatalf("hits=%d want 5: %v", len(amts), amts)
	}
	want := []float64{100, 103, 106, 109, 112}
	for i := range want {
		if math.Abs(amts[i]-want[i]) > fwTol {
			t.Fatalf("hit[%d]=%v want %v (old-stack ordering)", i, amts[i], want[i])
		}
	}
	if stacks := fwStacks(t, done); math.Abs(stacks-4) > fwTol {
		t.Fatalf("stacks=%v want 4 (cap)", stacks)
	}
}

func TestFocusedWill3161SameCastMultiHitThrottleAndAfter1000(t *testing.T) {
	compileReq, runReq := fwLoadFixture(t)
	fwAddAbility(&compileReq, fwSpell("fw_multi", model.CastOriginChampion,
		[]string{"damage_trait/ability"}, []string{"ability/spell"}, 3))
	ref := fwAbilityRef("fw_multi")
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "c1", AbilityRef: ref, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "c2", AbilityRef: ref, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 1000},
	}
	runReq.StopPolicy.DurationMs = 1100
	done := fwRun(t, compileReq, runReq)
	amts := fwDamageAmounts(done, "op:fw_fw_multi_")
	if len(amts) != 6 {
		t.Fatalf("hits=%d want 6: %v", len(amts), amts)
	}
	// Cast1 @ stacks0: all three hits 100 (grant once after first), then stacks=1
	for i := 0; i < 3; i++ {
		if math.Abs(amts[i]-100) > fwTol {
			t.Fatalf("cast1 hit[%d]=%v want 100", i, amts[i])
		}
	}
	// Cast2 @ stacks1: all three hits 103, grant once → stacks=2
	for i := 3; i < 6; i++ {
		if math.Abs(amts[i]-103) > fwTol {
			t.Fatalf("cast2 hit[%d]=%v want 103", i, amts[i])
		}
	}
	if stacks := fwStacks(t, done); math.Abs(stacks-2) > fwTol {
		t.Fatalf("stacks=%v want 2", stacks)
	}
}

func TestFocusedWill3161OverlappingCastsIndependentThrottle(t *testing.T) {
	compileReq, runReq := fwLoadFixture(t)
	fwAddAbility(&compileReq, fwSpell("fw_overlap", model.CastOriginChampion,
		[]string{"damage_trait/ability"}, []string{"ability/spell"}, 1))
	ref := fwAbilityRef("fw_overlap")
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "a", AbilityRef: ref, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "b", AbilityRef: ref, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := fwRun(t, compileReq, runReq)
	amts := fwDamageAmounts(done, "op:fw_fw_overlap_")
	if len(amts) != 2 {
		t.Fatalf("hits=%v", amts)
	}
	if math.Abs(amts[0]-100) > fwTol || math.Abs(amts[1]-103) > fwTol {
		t.Fatalf("overlap amts=%v want [100,103]", amts)
	}
	if stacks := fwStacks(t, done); math.Abs(stacks-2) > fwTol {
		t.Fatalf("stacks=%v want 2", stacks)
	}
}

func TestFocusedWill3161PetGrantAndProcAmpNoGrant(t *testing.T) {
	compileReq, runReq := fwLoadFixture(t)
	fwAddAbility(&compileReq, fwSpell("fw_pet", model.CastOriginPet,
		[]string{"damage_trait/pet"}, []string{"ability/spell"}, 1))
	fwAddAbility(&compileReq, fwSpell("fw_proc", model.CastOriginChampion,
		[]string{"damage_trait/proc"}, []string{"ability/spell"}, 1))
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "pet", AbilityRef: fwAbilityRef("fw_pet"), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "proc", AbilityRef: fwAbilityRef("fw_proc"), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 1100},
	}
	runReq.StopPolicy.DurationMs = 1200
	done := fwRun(t, compileReq, runReq)
	petAmts := fwDamageAmounts(done, "op:fw_fw_pet_")
	procAmts := fwDamageAmounts(done, "op:fw_fw_proc_")
	if len(petAmts) != 1 || math.Abs(petAmts[0]-100) > fwTol {
		t.Fatalf("pet=%v", petAmts)
	}
	if len(procAmts) != 1 || math.Abs(procAmts[0]-103) > fwTol {
		t.Fatalf("proc amp no grant=%v want 103", procAmts)
	}
	if stacks := fwStacks(t, done); math.Abs(stacks-1) > fwTol {
		t.Fatalf("stacks=%v want 1 (proc must not grant)", stacks)
	}
}

func TestFocusedWill3161ExclusionsBasicItemInnate(t *testing.T) {
	compileReq, runReq := fwLoadFixture(t)
	fwAddAbility(&compileReq, fwSpell("fw_basic", model.CastOriginChampion,
		[]string{"damage_trait/ability"}, []string{"ability/basic_attack"}, 1))
	fwAddAbility(&compileReq, fwSpell("fw_item", model.CastOriginItem,
		[]string{"damage_trait/ability"}, []string{"ability/spell"}, 1))
	fwAddAbility(&compileReq, fwSpell("fw_innate", model.CastOriginInnate,
		[]string{"damage_trait/ability"}, []string{"ability/spell"}, 1))
	fwAddAbility(&compileReq, fwSpell("fw_ok", model.CastOriginChampion,
		[]string{"damage_trait/ability"}, []string{"ability/spell"}, 1))
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "b", AbilityRef: fwAbilityRef("fw_basic"), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "i", AbilityRef: fwAbilityRef("fw_item"), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
		{EntryKey: "n", AbilityRef: fwAbilityRef("fw_innate"), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 200},
		{EntryKey: "ok", AbilityRef: fwAbilityRef("fw_ok"), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 300},
	}
	runReq.StopPolicy.DurationMs = 400
	done := fwRun(t, compileReq, runReq)
	for _, prefix := range []string{"op:fw_fw_basic_", "op:fw_fw_item_", "op:fw_fw_innate_"} {
		amts := fwDamageAmounts(done, prefix)
		if len(amts) != 1 || math.Abs(amts[0]-100) > fwTol {
			t.Fatalf("%s amts=%v want unamplified 100", prefix, amts)
		}
	}
	okAmts := fwDamageAmounts(done, "op:fw_fw_ok_")
	if len(okAmts) != 1 || math.Abs(okAmts[0]-100) > fwTol {
		t.Fatalf("ok first hit=%v want 100", okAmts)
	}
	if stacks := fwStacks(t, done); math.Abs(stacks-1) > fwTol {
		t.Fatalf("stacks=%v want 1 (only ok grants)", stacks)
	}
}

func TestFocusedWill3161NoDoubleGrantAcrossTwoListeners(t *testing.T) {
	compileReq, runReq := fwLoadFixture(t)
	fwAddAbility(&compileReq, fwSpell("fw_once", model.CastOriginChampion,
		[]string{"damage_trait/ability"}, []string{"ability/spell"}, 1))
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "h", AbilityRef: fwAbilityRef("fw_once"), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := fwRun(t, compileReq, runReq)
	if stacks := fwStacks(t, done); math.Abs(stacks-1) > fwTol {
		t.Fatalf("stacks=%v want 1 (champion+pet listeners must not double-grant)", stacks)
	}
}

func TestFocusedWill3161RefreshAndExpiry(t *testing.T) {
	compileReq, runReq := fwLoadFixture(t)
	fwAddAbility(&compileReq, fwSpell("fw_refresh", model.CastOriginChampion,
		[]string{"damage_trait/ability"}, []string{"ability/spell"}, 1))
	ref := fwAbilityRef("fw_refresh")
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "s1", AbilityRef: ref, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "s2", AbilityRef: ref, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 1100},
		// Refresh window from write at 1100 => expireAt=7100; hit at 5000 keeps alive.
		{EntryKey: "refresh", AbilityRef: ref, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 5000},
		// After 5000+6000=11000, lazy expire then add 1.
		{EntryKey: "after", AbilityRef: ref, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 11000},
	}
	runReq.StopPolicy.DurationMs = 11100
	done := fwRun(t, compileReq, runReq)
	if stacks := fwStacks(t, done); math.Abs(stacks-1) > fwTol {
		t.Fatalf("stacks after expiry=%v want 1", stacks)
	}
	amts := fwDamageAmounts(done, "op:fw_fw_refresh_")
	if len(amts) != 4 {
		t.Fatalf("hits=%v", amts)
	}
	// after expiry: old stacks=0 → 100
	if math.Abs(amts[3]-100) > fwTol {
		t.Fatalf("post-expiry hit=%v want 100", amts[3])
	}
}

func TestFocusedWill3161NoRecursiveGrantFromAmpOnly(t *testing.T) {
	// Proc amp path must not feed grant listeners (no ability|pet trait).
	compileReq, runReq := fwLoadFixture(t)
	fwAddAbility(&compileReq, fwSpell("fw_seed", model.CastOriginChampion,
		[]string{"damage_trait/ability"}, []string{"ability/spell"}, 1))
	fwAddAbility(&compileReq, fwSpell("fw_proc_only", model.CastOriginChampion,
		[]string{"damage_trait/proc"}, []string{"ability/spell"}, 1))
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "seed", AbilityRef: fwAbilityRef("fw_seed"), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "p1", AbilityRef: fwAbilityRef("fw_proc_only"), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 1100},
		{EntryKey: "p2", AbilityRef: fwAbilityRef("fw_proc_only"), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 2200},
	}
	runReq.StopPolicy.DurationMs = 2300
	done := fwRun(t, compileReq, runReq)
	if stacks := fwStacks(t, done); math.Abs(stacks-1) > fwTol {
		t.Fatalf("stacks=%v want 1 (no recursive proc grants)", stacks)
	}
}
