package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/typeset"
)

// item_2520 Bastionbreaker / 破垒者 — Shaped Charge / 成型炸药 (ranged champion branch).
//
// Numeric authority (League Wiki item manifest only; no DDragon):
//   - revid 4030984
//   - SHA256 e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d
//
// Ranged champion branch only (explicit non-goals: melee split, epic-monster-only,
// Sabotage/破坏, pet expansion, DoT inclusion, Web UI):
//   - shaped_charge_ready default1/max1/duration45000/refresh_on_write; starts ready
//   - listener All{event/damage_instance, damage_trait/ability, event/source_owner}
//     None{ability/basic_attack, damage_trait/on_hit, damage_trait/item, damage_trait/dot}
//   - on first qualifying instance: child damage/true then ready override→0
//   - formula 15 + 0.75 * source.attr.armor_pen_flat.resolved (base22 → 31.5)
//   - child CopyableOnHit=false; no ability/item/on_hit/dot traits (no recursion)
//   - same-cast multi-hit: only first procs; CD until lazy expiry at t>=45000
//   - true bypasses resistance; shields still absorb per generic pipeline
//
// Path: CompileGeneric → RunGeneric only.

const (
	shapedChargeProviderRef = "item:2520_shaped_charge"
	shapedChargeStableID    = "item_2520"
	shapedChargeListenerKey = "listener_item_2520_shaped_charge"
	shapedChargeDamageOpRef = "op:shaped_charge_true"
	shapedChargeAbilityKey  = "shaped_charge_spell"
	shapedChargeAAKey       = "shaped_charge_aa"
	shapedChargeReadyKey    = "shaped_charge_ready"
	shapedChargeChampionRef = spellbladeChampionRef

	shapedChargeBaseFlat    = 15.0
	shapedChargePenRatio    = 0.75
	shapedChargeBasePenFlat = 22.0
	shapedChargeExpectedRaw = 31.5 // 15 + 0.75*22
	shapedChargeReadyMax    = 1.0
	shapedChargeDurationMs  = 45000.0
	shapedChargeAbilityRaw  = 10.0
	shapedChargeTargetHP    = 10000.0
	shapedChargeTol         = 1e-6
)

func shapedChargeReadyCond() *model.GenericFormulaExpr {
	one := 1.0
	return &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + shapedChargeReadyKey},
			{Op: "const", Value: &one},
		},
	}
}

func shapedChargeStateSchema() map[string]interface{} {
	return map[string]interface{}{
		shapedChargeReadyKey: map[string]interface{}{
			"defaultValue":  float64(1),
			"maxValue":      float64(shapedChargeReadyMax),
			"durationMs":    float64(shapedChargeDurationMs),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
}

func shapedChargeTrueAmount() *model.GenericFormulaExpr {
	base := shapedChargeBaseFlat
	ratio := shapedChargePenRatio
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &ratio},
					{Op: "read", Path: "source.attr.armor_pen_flat.resolved"},
				},
			},
		},
	}
}

func shapedChargeListener() model.ListenerDefinition {
	zero := 0.0
	ready := shapedChargeReadyCond()
	// Order: child true damage → consume ready (override 0 starts 45s refresh_on_write CD).
	return model.ListenerDefinition{
		ListenerKey: shapedChargeListenerKey,
		EventMatcher: model.TypeMatcher{
			All: []string{"event/damage_instance", "damage_trait/ability", "event/source_owner"},
			None: []string{
				"ability/basic_attack",
				"damage_trait/on_hit",
				"damage_trait/item",
				"damage_trait/dot",
			},
		},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/true",
				Ref:           shapedChargeDamageOpRef,
				CopyableOnHit: false,
				Condition:     ready,
				Amount:        shapedChargeTrueAmount(),
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         shapedChargeReadyKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Condition:   ready,
			},
		},
	}
}

func shapedChargeEnsureTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
	ensureDamageTrueType(req)
	need := []model.TypeCatalogEntry{
		{Key: "event/damage_instance", Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "ability/spell", Domain: "ability"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage_trait/ability", Domain: "damage_trait"},
		{Key: "damage_trait/on_hit", Domain: "damage_trait"},
		{Key: "damage_trait/item", Domain: "damage_trait"},
		{Key: "damage_trait/dot", Domain: "damage_trait"},
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "damage/true", Domain: "damage"},
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

func shapedChargeMountProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        shapedChargeProviderRef,
		Kind:               "item",
		StableID:           shapedChargeStableID,
		InitialStateSchema: shapedChargeStateSchema(),
		Listeners:          []model.ListenerDefinition{shapedChargeListener()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: shapedChargeProviderRef, DefinitionRef: shapedChargeProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: shapedChargeProviderRef, DefinitionRef: shapedChargeProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
		// Materialize provider bag so Condition reads schema default (starts ready=1).
		if runReq.InitialSnapshot.Combatants[i].ProviderState == nil {
			runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState[shapedChargeProviderRef] = map[string]interface{}{
			"state": map[string]interface{}{shapedChargeReadyKey: float64(1)},
		}
	}
}

func shapedChargeSpellOps(hitCount int, traits []string) []model.OperationDefinition {
	raw := shapedChargeAbilityRaw
	ops := make([]model.OperationDefinition, 0, hitCount)
	for i := 0; i < hitCount; i++ {
		ops = append(ops, model.OperationDefinition{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &raw},
			Types:      append([]string(nil), traits...),
			Ref:        "op:shaped_charge_spell_" + itoaRuntime(i),
		})
	}
	return ops
}

func shapedChargeLoadFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	shapedChargeEnsureTypes(&compileReq)
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: shapedChargeAbilityKey,
		Kind:       "active",
		Types:      []string{"ability/spell"},
		Operations: shapedChargeSpellOps(1, []string{"damage_trait/ability"}),
	}}
	shapedChargeMountProvider(&compileReq, &runReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor_pen_flat", model.AttributeSlotDef{
		Base: shapedChargeBasePenFlat, Current: shapedChargeBasePenFlat,
		Max: shapedChargeBasePenFlat, Resolved: shapedChargeBasePenFlat,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: shapedChargeTargetHP, Current: shapedChargeTargetHP,
		Max: shapedChargeTargetHP, Resolved: shapedChargeTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "mr", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func shapedChargeRun(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func shapedChargeCompile(t *testing.T, compileReq model.CompileRequest) compile.GenericCompileResult {
	t.Helper()
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	return result
}

func shapedChargeSpellRef() string {
	return "source.provider[" + shapedChargeChampionRef + "].ability[" + shapedChargeAbilityKey + "]"
}

func shapedChargeAARef() string {
	return "source.provider[" + shapedChargeChampionRef + "].ability[" + shapedChargeAAKey + "]"
}

func shapedChargeSetDriver(runReq *model.RunRequest, entries []model.DriverEntry, durationMs int64) {
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = durationMs
}

func shapedChargeCastAt(runReq *model.RunRequest, atMs int64, key string) {
	shapedChargeSetDriver(runReq, []model.DriverEntry{{
		EntryKey: key, AbilityRef: shapedChargeSpellRef(),
		Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: atMs,
	}}, atMs+100)
}

func shapedChargeStateValue(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, shapedChargeProviderRef)
	state, ok := bag["state"].(map[string]interface{})
	if !ok {
		t.Fatalf("shaped_charge state bag missing: %+v", bag)
	}
	v, _ := state[shapedChargeReadyKey].(float64)
	return v
}

func shapedChargeRawForPen(penFlat float64) float64 {
	return shapedChargeBaseFlat + shapedChargePenRatio*penFlat
}

func shapedChargeTypeSet(t *testing.T, result compile.GenericCompileResult, keys ...string) typeset.TypeSet {
	t.Helper()
	var set typeset.TypeSet
	for _, key := range keys {
		id, ok := result.Session.Types.Registry.Lookup(key)
		if !ok {
			t.Fatalf("missing type key %q in compiled catalog", key)
		}
		set.Add(id)
	}
	return set
}

func shapedChargeAssertMatcher(t *testing.T, result compile.GenericCompileResult) {
	t.Helper()
	var found *compile.CompiledListener
	for i := range result.Session.Providers {
		p := &result.Session.Providers[i]
		if p.ProviderKey != shapedChargeProviderRef {
			continue
		}
		for j := range p.Listeners {
			if p.Listeners[j].ListenerKey == shapedChargeListenerKey {
				found = &p.Listeners[j]
				break
			}
		}
	}
	if found == nil {
		t.Fatal("missing shaped_charge listener")
	}
	m := found.EventMatcher
	if !m.Match(shapedChargeTypeSet(t, result, "event/damage_instance", "damage_trait/ability", "event/source_owner")) {
		t.Fatal("matcher must accept ability damage_instance + source_owner")
	}
	if m.Match(shapedChargeTypeSet(t, result, "event/damage_instance", "damage_trait/ability", "event/source_owner", "ability/basic_attack")) {
		t.Fatal("matcher must reject ability/basic_attack")
	}
	if m.Match(shapedChargeTypeSet(t, result, "event/damage_instance", "damage_trait/ability", "event/source_owner", "damage_trait/on_hit")) {
		t.Fatal("matcher must reject damage_trait/on_hit")
	}
	if m.Match(shapedChargeTypeSet(t, result, "event/damage_instance", "damage_trait/ability", "event/source_owner", "damage_trait/item")) {
		t.Fatal("matcher must reject damage_trait/item")
	}
	if m.Match(shapedChargeTypeSet(t, result, "event/damage_instance", "damage_trait/ability", "event/source_owner", "damage_trait/dot")) {
		t.Fatal("matcher must reject damage_trait/dot")
	}
	if m.Match(shapedChargeTypeSet(t, result, "event/damage_instance", "event/source_owner")) {
		t.Fatal("matcher must require damage_trait/ability")
	}
	if m.Match(shapedChargeTypeSet(t, result, "event/damage_instance", "damage/true", "event/source_owner")) {
		t.Fatal("matcher must not accept child true (no ability trait)")
	}
}

func shapedChargeTargetShieldRemaining(done model.DoneResult) float64 {
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorTarget {
			continue
		}
		var sum float64
		for _, s := range c.Shields {
			sum += s.Remaining
		}
		return sum
	}
	return 0
}

// TestGenericShapedCharge2520SchemaAndMatcher: ready default1/max1/45000/refresh_on_write + exact matcher.
func TestGenericShapedCharge2520SchemaAndMatcher(t *testing.T) {
	compileReq, _ := shapedChargeLoadFixture(t)
	result := shapedChargeCompile(t, compileReq)
	var found *compile.CompiledProvider
	for i := range result.Session.Providers {
		p := &result.Session.Providers[i]
		if p.ProviderKey == shapedChargeProviderRef {
			found = p
			break
		}
	}
	if found == nil {
		t.Fatal("missing shaped_charge provider")
	}
	ready := found.StateFields[shapedChargeReadyKey]
	if ready.DefaultValue != 1 || !ready.HasCap || ready.MaxValue != shapedChargeReadyMax ||
		ready.DurationMs != shapedChargeDurationMs || ready.RefreshPolicy != model.ProviderStateRefreshOnWrite {
		t.Fatalf("shaped_charge_ready field=%+v want default1/max1/45000/refresh_on_write", ready)
	}
	shapedChargeAssertMatcher(t, result)
}

// TestGenericShapedCharge2520StartsReadyAndBaseProc: starts ready; base22 → 31.5 true; consume→0.
func TestGenericShapedCharge2520StartsReadyAndBaseProc(t *testing.T) {
	compileReq, runReq := shapedChargeLoadFixture(t)
	shapedChargeCastAt(&runReq, 0, "spell0")
	done := shapedChargeRun(t, compileReq, runReq)

	if n := countDamageByOpRef(done, shapedChargeDamageOpRef, false); n != 1 {
		t.Fatalf("shaped_charge proc count=%d want 1", n)
	}
	if got := sumDamageRawByOpRef(done, shapedChargeDamageOpRef); math.Abs(got-shapedChargeExpectedRaw) > shapedChargeTol {
		t.Fatalf("shaped_charge raw=%v want %v", got, shapedChargeExpectedRaw)
	}
	if got := sumDamageMitigatedByOpRef(done, shapedChargeDamageOpRef); math.Abs(got-shapedChargeExpectedRaw) > shapedChargeTol {
		t.Fatalf("shaped_charge mitigated=%v want %v (true)", got, shapedChargeExpectedRaw)
	}
	item := firstDamageEvidenceByOpRef(done, shapedChargeDamageOpRef)
	if item == nil {
		t.Fatal("missing shaped_charge damage evidence")
	}
	if evidenceDataString(item.Data, "damageType") != "damage/true" {
		t.Fatalf("damageType=%q want damage/true", evidenceDataString(item.Data, "damageType"))
	}
	if traits, _ := item.Data["traits"].([]string); len(traits) != 0 {
		// traits may also arrive as []interface{}; accept empty only.
	}
	if rawTraits := item.Data["traits"]; rawTraits != nil {
		switch v := rawTraits.(type) {
		case []string:
			if len(v) != 0 {
				t.Fatalf("child traits=%v want none", v)
			}
		case []interface{}:
			if len(v) != 0 {
				t.Fatalf("child traits=%v want none", v)
			}
		}
	}
	if got := shapedChargeStateValue(t, done); math.Abs(got) > shapedChargeTol {
		t.Fatalf("shaped_charge_ready after consume=%v want 0", got)
	}
}

// TestGenericShapedCharge2520PenFlatScalesFormula: additional flat pen changes 15+0.75*pen.
func TestGenericShapedCharge2520PenFlatScalesFormula(t *testing.T) {
	compileReq, runReq := shapedChargeLoadFixture(t)
	pen := 40.0
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor_pen_flat", model.AttributeSlotDef{
		Base: pen, Current: pen, Max: pen, Resolved: pen,
	})
	shapedChargeCastAt(&runReq, 0, "spell_pen")
	done := shapedChargeRun(t, compileReq, runReq)

	want := shapedChargeRawForPen(pen)
	if got := sumDamageRawByOpRef(done, shapedChargeDamageOpRef); math.Abs(got-want) > shapedChargeTol {
		t.Fatalf("shaped_charge raw=%v want %v (pen=%v)", got, want, pen)
	}
}

// TestGenericShapedCharge2520SameCastMultiHitOnlyFirst: same cast 2 ability hits → one proc.
func TestGenericShapedCharge2520SameCastMultiHitOnlyFirst(t *testing.T) {
	compileReq, runReq := shapedChargeLoadFixture(t)
	compileReq.SharedProviders[0].Abilities[0].Operations = shapedChargeSpellOps(2, []string{"damage_trait/ability"})
	shapedChargeCastAt(&runReq, 0, "multi")
	done := shapedChargeRun(t, compileReq, runReq)

	if n := countDamageByOpRef(done, shapedChargeDamageOpRef, false); n != 1 {
		t.Fatalf("shaped_charge proc count=%d want 1 (same-cast multi-hit)", n)
	}
	if got := shapedChargeStateValue(t, done); math.Abs(got) > shapedChargeTol {
		t.Fatalf("ready=%v want 0", got)
	}
}

// TestGenericShapedCharge2520NonAbilityTraitsDoNotConsume: BA / item / on_hit / DoT do not proc.
func TestGenericShapedCharge2520NonAbilityTraitsDoNotConsume(t *testing.T) {
	cases := []struct {
		name        string
		abilityKey  string
		abilityType string
		traits      []string
	}{
		{name: "basic_attack", abilityKey: shapedChargeAAKey, abilityType: "ability/basic_attack", traits: []string{"damage_trait/ability"}},
		{name: "item", abilityKey: shapedChargeAbilityKey, abilityType: "ability/spell", traits: []string{"damage_trait/ability", "damage_trait/item"}},
		{name: "on_hit", abilityKey: shapedChargeAbilityKey, abilityType: "ability/spell", traits: []string{"damage_trait/ability", "damage_trait/on_hit"}},
		{name: "dot", abilityKey: shapedChargeAbilityKey, abilityType: "ability/spell", traits: []string{"damage_trait/ability", "damage_trait/dot"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := shapedChargeLoadFixture(t)
			compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{{
				AbilityKey: tc.abilityKey,
				Kind:       "active",
				Types:      []string{tc.abilityType},
				Operations: shapedChargeSpellOps(1, tc.traits),
			}}
			ref := "source.provider[" + shapedChargeChampionRef + "].ability[" + tc.abilityKey + "]"
			shapedChargeSetDriver(&runReq, []model.DriverEntry{{
				EntryKey: "neg_" + tc.name, AbilityRef: ref,
				Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
			}}, 100)
			done := shapedChargeRun(t, compileReq, runReq)
			if n := countDamageByOpRef(done, shapedChargeDamageOpRef, false); n != 0 {
				t.Fatalf("proc count=%d want 0 for %s", n, tc.name)
			}
			if got := shapedChargeStateValue(t, done); math.Abs(got-1) > shapedChargeTol {
				t.Fatalf("ready=%v want 1 (unconsumed) for %s", got, tc.name)
			}
		})
	}
}

// TestGenericShapedCharge2520NoRecursiveSelfTrigger: child true does not re-fire listener.
func TestGenericShapedCharge2520NoRecursiveSelfTrigger(t *testing.T) {
	compileReq, runReq := shapedChargeLoadFixture(t)
	shapedChargeCastAt(&runReq, 0, "norecurse")
	done := shapedChargeRun(t, compileReq, runReq)

	if n := countDamageByOpRef(done, shapedChargeDamageOpRef, false); n != 1 {
		t.Fatalf("shaped_charge proc count=%d want 1 (no recursive self-trigger)", n)
	}
	// Parent ability instance + exactly one child true instance.
	evs := emittedEventsByRef(done, eventTypeDamageInstance)
	trueChildren := 0
	for _, ev := range evs {
		if evidenceDataString(ev.Data, "operationRef") != shapedChargeDamageOpRef {
			continue
		}
		trueChildren++
		if evidenceDataString(ev.Data, "damageType") != "damage/true" {
			t.Fatalf("child event damageType=%q", evidenceDataString(ev.Data, "damageType"))
		}
		if c1TraitsContain(ev.Data["traits"], "damage_trait/ability") ||
			c1TraitsContain(ev.Data["traits"], "damage_trait/item") ||
			c1TraitsContain(ev.Data["traits"], "damage_trait/on_hit") ||
			c1TraitsContain(ev.Data["traits"], "damage_trait/dot") {
			t.Fatalf("child traits must omit ability/item/on_hit/dot: %+v", ev.Data["traits"])
		}
	}
	if trueChildren != 1 {
		t.Fatalf("child true damage_instance count=%d want 1", trueChildren)
	}
}

// TestGenericShapedCharge2520SecondCastDuringCDNoProc: second cast before 45s → no proc.
func TestGenericShapedCharge2520SecondCastDuringCDNoProc(t *testing.T) {
	compileReq, runReq := shapedChargeLoadFixture(t)
	shapedChargeSetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "c0", AbilityRef: shapedChargeSpellRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "c1", AbilityRef: shapedChargeSpellRef(), Source: "source", Target: "target", FirstAtMs: 1000},
	}, 1100)
	done := shapedChargeRun(t, compileReq, runReq)

	if n := countDamageByOpRef(done, shapedChargeDamageOpRef, false); n != 1 {
		t.Fatalf("proc count=%d want 1 (second cast during CD)", n)
	}
	if got := shapedChargeStateValue(t, done); math.Abs(got) > shapedChargeTol {
		t.Fatalf("ready=%v want 0", got)
	}
}

// TestGenericShapedCharge2520Exact45000RearmAndLaterProc: lazy expiry at t=45000 restores ready; later procs.
func TestGenericShapedCharge2520Exact45000RearmAndLaterProc(t *testing.T) {
	compileReq, runReq := shapedChargeLoadFixture(t)
	shapedChargeSetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "c0", AbilityRef: shapedChargeSpellRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "live_cd", AbilityRef: shapedChargeSpellRef(), Source: "source", Target: "target", FirstAtMs: 44999},
		{EntryKey: "rearm", AbilityRef: shapedChargeSpellRef(), Source: "source", Target: "target", FirstAtMs: 45000},
	}, 45100)
	done := shapedChargeRun(t, compileReq, runReq)

	if n := countDamageByOpRef(done, shapedChargeDamageOpRef, false); n != 2 {
		t.Fatalf("proc count=%d want 2 (t0 + exact t=45000 rearm)", n)
	}
	if got := shapedChargeStateValue(t, done); math.Abs(got) > shapedChargeTol {
		t.Fatalf("ready after second consume=%v want 0", got)
	}
}

// TestGenericShapedCharge2520TrueIgnoresHighResistance: armor/MR 200 unused by true child.
func TestGenericShapedCharge2520TrueIgnoresHighResistance(t *testing.T) {
	compileReq, runReq := shapedChargeLoadFixture(t)
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: 200, Current: 200, Max: 200, Resolved: 200,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "mr", model.AttributeSlotDef{
		Base: 200, Current: 200, Max: 200, Resolved: 200,
	})
	shapedChargeCastAt(&runReq, 0, "resist")
	done := shapedChargeRun(t, compileReq, runReq)

	raw := sumDamageRawByOpRef(done, shapedChargeDamageOpRef)
	mit := sumDamageMitigatedByOpRef(done, shapedChargeDamageOpRef)
	if math.Abs(raw-shapedChargeExpectedRaw) > shapedChargeTol || math.Abs(mit-raw) > shapedChargeTol {
		t.Fatalf("true raw/mitigated=%v/%v want equal %v despite high resist", raw, mit, shapedChargeExpectedRaw)
	}
	item := firstDamageEvidenceByOpRef(done, shapedChargeDamageOpRef)
	if item == nil {
		t.Fatal("missing damage evidence")
	}
	if math.Abs(evidenceDataFloat(item.Data, "resistanceFactor")-1) > shapedChargeTol {
		t.Fatalf("resistanceFactor=%v want 1", evidenceDataFloat(item.Data, "resistanceFactor"))
	}
}

// TestGenericShapedCharge2520ShieldAbsorbsTrue: true bypasses resist but shields absorb per pipeline.
func TestGenericShapedCharge2520ShieldAbsorbsTrue(t *testing.T) {
	compileReq, runReq := shapedChargeLoadFixture(t)
	shieldAmt := 20.0
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorTarget {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Shields = []model.CombatantShieldSnapshot{{
			ShieldRef: "keep", Source: model.SelectorSource, Owner: model.SelectorTarget,
			Remaining: shieldAmt, Priority: 1, State: map[string]interface{}{},
		}}
	}
	shapedChargeCastAt(&runReq, 0, "shield")
	done := shapedChargeRun(t, compileReq, runReq)

	if n := countDamageByOpRef(done, shapedChargeDamageOpRef, false); n != 1 {
		t.Fatalf("proc count=%d want 1", n)
	}
	// Ability physical 10 + true 31.5 = 41.5 total post-mitigation; shield 20 absorbs first.
	wantHP := shapedChargeTargetHP - (shapedChargeAbilityRaw + shapedChargeExpectedRaw - shieldAmt)
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > shapedChargeTol {
		t.Fatalf("targetFinalHp=%v want %v (shield absorbed %v first)", done.Summary.TargetFinalHp, wantHP, shieldAmt)
	}
	if got := shapedChargeTargetShieldRemaining(done); math.Abs(got) > shapedChargeTol {
		t.Fatalf("shield remaining=%v want 0", got)
	}
}
