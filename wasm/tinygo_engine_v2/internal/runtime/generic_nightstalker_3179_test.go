package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/typeset"
)

// item_3179 Umbral Glaive / 黯影阔剑 — Nightstalker / 夜行者 (generic ABI Phase-A).
//
// Numeric authority (League Wiki item manifest only; no DDragon):
//   - current-items.raw.lua 8550-8584
//   - revid 4030984
//   - SHA256 e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d
//
// User-approved Phase-A (explicit exclusions — not claimed by these tests):
//   - visibility / stealth / unseen≥1s detection
//   - 4s empowered window after being seen
//   - re-arm / recharge after consume
//   - Blackout (wards/traps)
//   - multi-target / multi-champion
//   - live migrate / publish
//
// Phase-A contract expressed on current canonical ABI:
//   - nightstalker_ready default1/max1, untimed (durationMs=0, no refreshPolicy)
//   - combat starts ready; first qualifying basic_attack_hit triggers once; no re-arm
//   - listener All{event/basic_attack_hit, event/source_owner}; ready>=1; maxTriggersPerEvent=1
//   - ordered ops: child true `50 + 1.5 * source.attr.armor_pen_flat.resolved` → override ready0
//   - child Types empty, CopyableOnHit=false (no recursive hit emit; phantom/repeat cannot copy)
//   - true ignores armor/MR; current shield pipeline still absorbs
//
// Path: CompileGeneric → RunGeneric only.

const (
	nightstalkerProviderRef = "item:3179_nightstalker"
	nightstalkerStableID    = "item_3179"
	nightstalkerListenerKey = "listener_item_3179_nightstalker"
	nightstalkerDamageOpRef = "op:nightstalker_true"
	nightstalkerAAOpRef     = "op:nightstalker_aa"
	nightstalkerReadyKey    = "nightstalker_ready"
	nightstalkerHitEvent    = spellbladeHitEvent
	nightstalkerChampionRef = spellbladeChampionRef
	nightstalkerHitAbility  = spellbladeHitAbilityKey

	nightstalkerBaseFlat    = 50.0
	nightstalkerPenRatio    = 1.5
	nightstalkerWikiPenFlat = 18.0 // Wiki item lethality → armor_pen_flat
	nightstalkerWikiRaw     = 77.0 // 50 + 1.5*18
	nightstalkerReadyMax    = 1.0
	nightstalkerAADamage    = 100.0
	nightstalkerTargetHP    = 10000.0
	nightstalkerTol         = 1e-6
)

func nightstalkerReadyCond() *model.GenericFormulaExpr {
	one := 1.0
	return &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + nightstalkerReadyKey},
			{Op: "const", Value: &one},
		},
	}
}

func nightstalkerStateSchema() map[string]interface{} {
	// Untimed: durationMs=0 (or omitted) and no refreshPolicy.
	return map[string]interface{}{
		nightstalkerReadyKey: map[string]interface{}{
			"defaultValue": float64(1),
			"maxValue":     float64(nightstalkerReadyMax),
			"durationMs":   float64(0),
		},
	}
}

func nightstalkerTrueAmount() *model.GenericFormulaExpr {
	base := nightstalkerBaseFlat
	ratio := nightstalkerPenRatio
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

func nightstalkerListener() model.ListenerDefinition {
	zero := 0.0
	ready := nightstalkerReadyCond()
	// Order: child true damage → consume ready (override 0; Phase-A no re-arm).
	return model.ListenerDefinition{
		ListenerKey:         nightstalkerListenerKey,
		MaxTriggersPerEvent: 1,
		EventMatcher:        model.TypeMatcher{All: []string{nightstalkerHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/true",
				Ref:           nightstalkerDamageOpRef,
				Types:         []string{},
				CopyableOnHit: false,
				Condition:     ready,
				Amount:        nightstalkerTrueAmount(),
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         nightstalkerReadyKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Condition:   ready,
			},
		},
	}
}

func nightstalkerEnsureTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
	ensureDamageTrueType(req)
	need := []model.TypeCatalogEntry{
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: "damage/true", Domain: "damage"},
		{Key: "event/damage_instance", Domain: "event"}, // negative matcher probe only
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

func nightstalkerAAOps() []model.OperationDefinition {
	aa := nightstalkerAADamage
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
			Ref:        nightstalkerAAOpRef,
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: nightstalkerHitEvent,
			Ref:       nightstalkerHitEvent,
		},
	}
}

func nightstalkerAAOpsWithGuinsooStack() []model.OperationDefinition {
	aa := nightstalkerAADamage
	one := 1.0
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
			Ref:        nightstalkerAAOpRef,
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
			EventType: nightstalkerHitEvent,
			Ref:       nightstalkerHitEvent,
		},
	}
}

func nightstalkerMountProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        nightstalkerProviderRef,
		Kind:               "item",
		StableID:           nightstalkerStableID,
		InitialStateSchema: nightstalkerStateSchema(),
		Listeners:          []model.ListenerDefinition{nightstalkerListener()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: nightstalkerProviderRef, DefinitionRef: nightstalkerProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: nightstalkerProviderRef, DefinitionRef: nightstalkerProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
		// Materialize provider bag so Condition reads start ready=1 (Phase-A: combat starts ready).
		// evalContext uses create=false; absent bag → empty ProviderState → ready reads as 0.
		if runReq.InitialSnapshot.Combatants[i].ProviderState == nil {
			runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState[nightstalkerProviderRef] = map[string]interface{}{
			"state": map[string]interface{}{nightstalkerReadyKey: float64(1)},
		}
	}
}

func nightstalkerAARef() string {
	return "source.provider[" + nightstalkerChampionRef + "].ability[" + nightstalkerHitAbility + "]"
}

func nightstalkerLoadFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	nightstalkerEnsureTypes(&compileReq)
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: nightstalkerHitAbility,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: nightstalkerAAOps(),
	}}
	nightstalkerMountProvider(&compileReq, &runReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor_pen_flat", model.AttributeSlotDef{
		Base: nightstalkerWikiPenFlat, Current: nightstalkerWikiPenFlat,
		Max: nightstalkerWikiPenFlat, Resolved: nightstalkerWikiPenFlat,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: nightstalkerTargetHP, Current: nightstalkerTargetHP,
		Max: nightstalkerTargetHP, Resolved: nightstalkerTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func nightstalkerCompile(t *testing.T, compileReq model.CompileRequest) compile.GenericCompileResult {
	t.Helper()
	result := compileMigrated(&compileReq, nil)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	return result
}

func nightstalkerRun(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func nightstalkerSetDriverHits(runReq *model.RunRequest, hits int, prefix string) {
	ref := nightstalkerAARef()
	entries := make([]model.DriverEntry, 0, hits)
	for i := 0; i < hits; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   prefix + "_aa_" + itoaRuntime(i),
			AbilityRef: ref,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  int64(i * 100),
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = int64(hits*100 + 100)
}

func nightstalkerRawForPen(penFlat float64) float64 {
	return nightstalkerBaseFlat + nightstalkerPenRatio*penFlat
}

func nightstalkerStateValue(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, nightstalkerProviderRef)
	state, ok := bag["state"].(map[string]interface{})
	if !ok {
		t.Fatalf("nightstalker state bag missing: %+v", bag)
	}
	v, _ := state[nightstalkerReadyKey].(float64)
	return v
}

func nightstalkerTargetShieldRemaining(done model.DoneResult) float64 {
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

func nightstalkerFindProvider(t *testing.T, result compile.GenericCompileResult) *compile.CompiledProvider {
	t.Helper()
	for i := range result.Session.Providers {
		p := &result.Session.Providers[i]
		if p.ProviderKey == nightstalkerProviderRef {
			return p
		}
	}
	t.Fatal("missing nightstalker provider")
	return nil
}

func nightstalkerFindListener(t *testing.T, result compile.GenericCompileResult) *compile.CompiledListener {
	t.Helper()
	p := nightstalkerFindProvider(t, result)
	for i := range p.Listeners {
		if p.Listeners[i].ListenerKey == nightstalkerListenerKey {
			return &p.Listeners[i]
		}
	}
	t.Fatal("missing nightstalker listener")
	return nil
}

func nightstalkerTypeSet(t *testing.T, result compile.GenericCompileResult, keys ...string) typeset.TypeSet {
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

func nightstalkerProgramInstr(t *testing.T, result compile.GenericCompileResult, id formula.GenericProgramID) []formula.GenericInstr {
	t.Helper()
	idx := int(id)
	if idx < 0 || idx >= len(result.Session.Formulas.Programs) {
		t.Fatalf("formula program id %d out of range (n=%d)", idx, len(result.Session.Formulas.Programs))
	}
	return result.Session.Formulas.Programs[idx].Instr
}

// TestGenericNightstalker3179SchemaListenerOrderFormulaCopyable:
// compile exact state / matcher / maxTriggers / op order / formula bytecode / CopyableOnHit=false / empty Types.
func TestGenericNightstalker3179SchemaListenerOrderFormulaCopyable(t *testing.T) {
	compileReq, _ := nightstalkerLoadFixture(t)
	result := nightstalkerCompile(t, compileReq)
	found := nightstalkerFindProvider(t, result)

	ready := found.StateFields[nightstalkerReadyKey]
	if ready.DefaultValue != 1 || !ready.HasCap || ready.MaxValue != nightstalkerReadyMax ||
		ready.DurationMs != 0 || ready.RefreshPolicy != "" {
		t.Fatalf("nightstalker_ready field=%+v want default1/max1/untimed(duration0,no refresh)", ready)
	}

	listener := nightstalkerFindListener(t, result)
	if listener.MaxTriggersPerEvent != 1 {
		t.Fatalf("MaxTriggersPerEvent=%d want 1", listener.MaxTriggersPerEvent)
	}
	m := listener.EventMatcher
	if !m.Match(nightstalkerTypeSet(t, result, nightstalkerHitEvent, "event/source_owner")) {
		t.Fatal("matcher must accept basic_attack_hit + source_owner")
	}
	if m.Match(nightstalkerTypeSet(t, result, nightstalkerHitEvent)) {
		t.Fatal("matcher must require event/source_owner")
	}
	if m.Match(nightstalkerTypeSet(t, result, "event/damage_instance", "event/source_owner")) {
		t.Fatal("matcher must not accept damage_instance (hit-event contract)")
	}

	if listener.OperationCount != 2 {
		t.Fatalf("OperationCount=%d want 2 (true then ready override)", listener.OperationCount)
	}
	ops := result.Session.Operations[listener.OperationStart : listener.OperationStart+listener.OperationCount]
	dmg := ops[0]
	if dmg.Operation != "damage" || dmg.DamageType != "damage/true" || dmg.Ref != nightstalkerDamageOpRef {
		t.Fatalf("op[0]=%+v want damage/true %s", dmg, nightstalkerDamageOpRef)
	}
	if dmg.CopyableOnHit {
		t.Fatal("child CopyableOnHit must be false")
	}
	if len(dmg.Types) != 0 {
		t.Fatalf("child Types=%v want empty", dmg.Types)
	}
	if !dmg.HasAmount || !dmg.HasCondition {
		t.Fatalf("damage op must compile amount+condition: %+v", dmg)
	}
	amountInstr := nightstalkerProgramInstr(t, result, dmg.AmountProgram)
	// 50 + (1.5 * source.attr.armor_pen_flat.resolved) → const, const, read, mul, add
	if len(amountInstr) != 5 ||
		amountInstr[0].Op != formula.GenericOpConst || math.Abs(amountInstr[0].Value-nightstalkerBaseFlat) > nightstalkerTol ||
		amountInstr[1].Op != formula.GenericOpConst || math.Abs(amountInstr[1].Value-nightstalkerPenRatio) > nightstalkerTol ||
		amountInstr[2].Op != formula.GenericOpRead || amountInstr[2].ReadKind != formula.ReadSourceAttr ||
		amountInstr[2].ReadKey != "armor_pen_flat.resolved" ||
		amountInstr[3].Op != formula.GenericOpMul ||
		amountInstr[4].Op != formula.GenericOpAdd {
		t.Fatalf("amount bytecode=%+v want 50 + 1.5 * source.attr.armor_pen_flat.resolved", amountInstr)
	}
	condInstr := nightstalkerProgramInstr(t, result, dmg.ConditionProgram)
	if len(condInstr) != 3 ||
		condInstr[0].Op != formula.GenericOpRead || condInstr[0].ReadKind != formula.ReadProviderState ||
		condInstr[0].ReadKey != nightstalkerReadyKey ||
		condInstr[1].Op != formula.GenericOpConst || math.Abs(condInstr[1].Value-1) > nightstalkerTol ||
		condInstr[2].Op != formula.GenericOpGte {
		t.Fatalf("ready condition bytecode=%+v want provider.state.nightstalker_ready >= 1", condInstr)
	}

	consume := ops[1]
	if consume.Operation != "state_change" || consume.Ref != nightstalkerReadyKey ||
		consume.ValuePolicy != "override" || consume.StateScope != "state_scope/provider" {
		t.Fatalf("op[1]=%+v want state_change override nightstalker_ready provider-scope", consume)
	}
	if !consume.HasAmount {
		t.Fatal("consume amount missing")
	}
	consumeInstr := nightstalkerProgramInstr(t, result, consume.AmountProgram)
	if len(consumeInstr) != 1 || consumeInstr[0].Op != formula.GenericOpConst || math.Abs(consumeInstr[0].Value) > nightstalkerTol {
		t.Fatalf("consume amount bytecode=%+v want const 0", consumeInstr)
	}
}

// TestGenericNightstalker3179PenFlatNumericTable: 0→50, 18→77, 20→80.
func TestGenericNightstalker3179PenFlatNumericTable(t *testing.T) {
	cases := []struct {
		pen  float64
		want float64
	}{
		{pen: 0, want: 50},
		{pen: 18, want: 77},
		{pen: 20, want: 80},
	}
	for _, tc := range cases {
		t.Run("pen_"+itoaRuntime(int(tc.pen)), func(t *testing.T) {
			compileReq, runReq := nightstalkerLoadFixture(t)
			setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor_pen_flat", model.AttributeSlotDef{
				Base: tc.pen, Current: tc.pen, Max: tc.pen, Resolved: tc.pen,
			})
			nightstalkerSetDriverHits(&runReq, 1, "pen")
			done := nightstalkerRun(t, compileReq, runReq)

			if n := countDamageByOpRef(done, nightstalkerDamageOpRef, false); n != 1 {
				t.Fatalf("proc count=%d want 1", n)
			}
			got := sumDamageRawByOpRef(done, nightstalkerDamageOpRef)
			if math.Abs(got-tc.want) > nightstalkerTol {
				t.Fatalf("raw=%v want %v (pen=%v; formula=%v)", got, tc.want, tc.pen, nightstalkerRawForPen(tc.pen))
			}
			if math.Abs(got-nightstalkerRawForPen(tc.pen)) > nightstalkerTol {
				t.Fatalf("raw=%v disagrees with helper %v", got, nightstalkerRawForPen(tc.pen))
			}
		})
	}
}

// TestGenericNightstalker3179FirstAABonusSecondBaseOnly: first AA base+bonus; second base only; ready→0.
func TestGenericNightstalker3179FirstAABonusSecondBaseOnly(t *testing.T) {
	compileReq, runReq := nightstalkerLoadFixture(t)
	nightstalkerSetDriverHits(&runReq, 2, "seq")
	done := nightstalkerRun(t, compileReq, runReq)

	if n := countEmittedEvents(done, nightstalkerHitEvent); n != 2 {
		t.Fatalf("basic_attack_hit=%d want 2", n)
	}
	if n := countDamageByOpRef(done, nightstalkerDamageOpRef, false); n != 1 {
		t.Fatalf("nightstalker proc count=%d want 1 (no re-arm)", n)
	}
	if got := sumDamageRawByOpRef(done, nightstalkerDamageOpRef); math.Abs(got-nightstalkerWikiRaw) > nightstalkerTol {
		t.Fatalf("bonus raw=%v want %v", got, nightstalkerWikiRaw)
	}
	if got := nightstalkerStateValue(t, done); math.Abs(got) > nightstalkerTol {
		t.Fatalf("nightstalker_ready=%v want 0", got)
	}
	// Two AA physical 100 + one true 77; armor 0.
	wantHP := nightstalkerTargetHP - (2*nightstalkerAADamage + nightstalkerWikiRaw)
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > nightstalkerTol {
		t.Fatalf("targetFinalHp=%v want %v (first AA+bonus, second AA only)", done.Summary.TargetFinalHp, wantHP)
	}
}

// TestGenericNightstalker3179NoRecursiveSelfTrigger: child true does not re-emit hit / re-fire.
func TestGenericNightstalker3179NoRecursiveSelfTrigger(t *testing.T) {
	compileReq, runReq := nightstalkerLoadFixture(t)
	nightstalkerSetDriverHits(&runReq, 1, "norecurse")
	done := nightstalkerRun(t, compileReq, runReq)

	if n := countEmittedEvents(done, nightstalkerHitEvent); n != 1 {
		t.Fatalf("basic_attack_hit=%d want 1 (child must not emit hit)", n)
	}
	if n := countDamageByOpRef(done, nightstalkerDamageOpRef, false); n != 1 {
		t.Fatalf("proc count=%d want 1 (no recursive double trigger)", n)
	}
	item := firstDamageEvidenceByOpRef(done, nightstalkerDamageOpRef)
	if item == nil {
		t.Fatal("missing nightstalker damage evidence")
	}
	if evidenceDataString(item.Data, "damageType") != "damage/true" {
		t.Fatalf("damageType=%q want damage/true", evidenceDataString(item.Data, "damageType"))
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
	if c1TraitsContain(item.Data["traits"], "damage_trait/on_hit") ||
		c1TraitsContain(item.Data["traits"], "damage_trait/item") ||
		c1TraitsContain(item.Data["traits"], "damage_trait/ability") {
		t.Fatalf("child traits must stay empty: %+v", item.Data["traits"])
	}
}

// TestGenericNightstalker3179PhantomCannotCopyBonus: Guinsoo phantom copies a true copyable peer,
// but Nightstalker (CopyableOnHit=false) is not copied and does not re-consume.
func TestGenericNightstalker3179PhantomCannotCopyBonus(t *testing.T) {
	compileReq, runReq := nightstalkerLoadFixture(t)
	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[0].Operations = nightstalkerAAOpsWithGuinsooStack()
	copyableAmt := 30.0
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "guinsoo_copyable",
			EventMatcher: model.TypeMatcher{All: []string{nightstalkerHitEvent, "event/source_owner"}},
			Operations: []model.OperationDefinition{{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Amount:        &model.GenericFormulaExpr{Op: "const", Value: &copyableAmt},
				CopyableOnHit: true,
				Ref:           "op:guinsoo_copyable",
			}},
		},
		{
			ListenerKey:  "guinsoo_repeat",
			EventMatcher: model.TypeMatcher{All: []string{nightstalkerHitEvent, "event/source_owner"}},
			Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
		},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			nightstalkerChampionRef: map[string]interface{}{
				"state":    map[string]interface{}{guinsooStackKey: float64(3)},
				"expireAt": map[string]interface{}{guinsooStackKey: float64(10000)},
			},
			nightstalkerProviderRef: map[string]interface{}{
				"state": map[string]interface{}{nightstalkerReadyKey: float64(1)},
			},
		}
	}
	nightstalkerSetDriverHits(&runReq, 1, "ph")
	done := nightstalkerRun(t, compileReq, runReq)

	if n := countEmittedEvents(done, nightstalkerHitEvent); n != 1 {
		t.Fatalf("basic_attack_hit emits=%d want 1 (phantom must not re-emit)", n)
	}
	if n := countDamageByOpRef(done, nightstalkerDamageOpRef, false); n != 1 {
		t.Fatalf("original nightstalker proc=%d want 1", n)
	}
	if n := countPhantomDamageByOpRef(done, nightstalkerDamageOpRef); n != 0 {
		t.Fatalf("phantom nightstalker damage=%d want 0", n)
	}
	if n := countPhantomDamageByOpRef(done, "op:guinsoo_copyable"); n != 1 {
		t.Fatalf("phantom guinsoo copyable=%d want 1 (fixture must fire phantom)", n)
	}
	if got := nightstalkerStateValue(t, done); math.Abs(got) > nightstalkerTol {
		t.Fatalf("ready=%v want 0 (phantom must not re-consume / re-arm)", got)
	}
}

// TestGenericNightstalker3179TrueIgnoresArmorMR: armor/MR do not reduce the true bonus.
func TestGenericNightstalker3179TrueIgnoresArmorMR(t *testing.T) {
	compileReq, runReq := nightstalkerLoadFixture(t)
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: 200, Current: 200, Max: 200, Resolved: 200,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: 200, Current: 200, Max: 200, Resolved: 200,
	})
	nightstalkerSetDriverHits(&runReq, 1, "resist")
	done := nightstalkerRun(t, compileReq, runReq)

	raw := sumDamageRawByOpRef(done, nightstalkerDamageOpRef)
	mit := sumDamageMitigatedByOpRef(done, nightstalkerDamageOpRef)
	if math.Abs(raw-nightstalkerWikiRaw) > nightstalkerTol || math.Abs(mit-raw) > nightstalkerTol {
		t.Fatalf("true raw/mitigated=%v/%v want equal %v despite high resist", raw, mit, nightstalkerWikiRaw)
	}
	item := firstDamageEvidenceByOpRef(done, nightstalkerDamageOpRef)
	if item == nil {
		t.Fatal("missing damage evidence")
	}
	if math.Abs(evidenceDataFloat(item.Data, "resistanceFactor")-1) > nightstalkerTol {
		t.Fatalf("resistanceFactor=%v want 1", evidenceDataFloat(item.Data, "resistanceFactor"))
	}
}

// TestGenericNightstalker3179ShieldAbsorbsTrue: true bypasses resist but shields absorb per pipeline.
func TestGenericNightstalker3179ShieldAbsorbsTrue(t *testing.T) {
	compileReq, runReq := nightstalkerLoadFixture(t)
	shieldAmt := 40.0
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorTarget {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Shields = []model.CombatantShieldSnapshot{{
			ShieldRef: "keep", Source: model.SelectorSource, Owner: model.SelectorTarget,
			Remaining: shieldAmt, Priority: 1, State: map[string]interface{}{},
		}}
	}
	nightstalkerSetDriverHits(&runReq, 1, "shield")
	done := nightstalkerRun(t, compileReq, runReq)

	if n := countDamageByOpRef(done, nightstalkerDamageOpRef, false); n != 1 {
		t.Fatalf("proc count=%d want 1", n)
	}
	// AA physical 100 + true 77 = 177 post-mitigation (armor 0); shield 40 absorbs first.
	wantHP := nightstalkerTargetHP - (nightstalkerAADamage + nightstalkerWikiRaw - shieldAmt)
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > nightstalkerTol {
		t.Fatalf("targetFinalHp=%v want %v (shield absorbed %v first)", done.Summary.TargetFinalHp, wantHP, shieldAmt)
	}
	if got := nightstalkerTargetShieldRemaining(done); math.Abs(got) > nightstalkerTol {
		t.Fatalf("shield remaining=%v want 0", got)
	}
}
