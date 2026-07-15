package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// item_3032 Yun Tal Wildarrows — Practice Makes Lethal / 熟能生巧 (generic ABI).
// Source-owned untimed capped stacks grant crit_chance via attribute modifier:
// min(0.25, 0.004 * provider.state.practice_crit_stacks), capped at 63 stacks.
// Non-goals: Flurry/疾风骤雨 AS, timed Flurry state, crit/normal cooldown reduction,
// on-attack event, random crit-result semantics.

const (
	yunTalStackKey     = "practice_crit_stacks"
	yunTalProviderRef  = "item:yun_tal_practice_makes_lethal"
	yunTalChampionRef  = spellbladeChampionRef
	yunTalHitAbility   = spellbladeHitAbilityKey
	yunTalHitEvent     = spellbladeHitEvent
	yunTalAADamage     = 10.0
	yunTalStackMax     = 63.0
	yunTalCritPerStack = 0.004
	yunTalCritCap      = 0.25
)

func yunTalPracticeSchema() map[string]interface{} {
	return map[string]interface{}{
		yunTalStackKey: map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(yunTalStackMax),
			"durationMs":   float64(0),
		},
	}
}

func yunTalCritChanceModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: "yun_tal_practice_crit_chance",
		Kind:        "attribute",
		Target:      "crit_chance",
		ValuePolicy: "add",
		Value: model.GenericFormulaExpr{
			Op: "min",
			Args: []model.GenericFormulaExpr{
				gfConst(yunTalCritCap),
				{
					Op: "mul",
					Args: []model.GenericFormulaExpr{
						gfConst(yunTalCritPerStack),
						{Op: "read", Path: "provider.state." + yunTalStackKey},
					},
				},
			},
		},
	}
}

func yunTalHitListener() model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey:  "listener_item_3032_practice_makes_lethal",
		EventMatcher: model.TypeMatcher{All: []string{yunTalHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         yunTalStackKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "add",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		},
	}
}

func ensureYunTalTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
}

func yunTalAAOps() []model.OperationDefinition {
	aa := yunTalAADamage
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
			EventType: yunTalHitEvent,
			Ref:       yunTalHitEvent,
		},
	}
}

func yunTalAAOpsWithGuinsooStack() []model.OperationDefinition {
	aa := yunTalAADamage
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
			EventType: yunTalHitEvent,
			Ref:       yunTalHitEvent,
		},
	}
}

func mountYunTalProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        yunTalProviderRef,
		Kind:               "item",
		StableID:           "item_3032",
		InitialStateSchema: yunTalPracticeSchema(),
		Modifiers:          []model.ModifierDefinition{yunTalCritChanceModifier()},
		Listeners:          []model.ListenerDefinition{yunTalHitListener()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: yunTalProviderRef, DefinitionRef: yunTalProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
			ProviderRef: yunTalProviderRef, DefinitionRef: yunTalProviderRef, Stacks: 1, State: map[string]interface{}{},
		})
	}
}

func configureYunTalChampionAA(compileReq *model.CompileRequest) {
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: yunTalHitAbility,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Operations: yunTalAAOps(),
		},
	}
}

func yunTalAARef() string {
	return "source.provider[" + yunTalChampionRef + "].ability[" + yunTalHitAbility + "]"
}

func loadYunTalPracticeFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureYunTalTypes(&compileReq)
	configureYunTalChampionAA(&compileReq)
	mountYunTalProvider(&compileReq, &runReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "crit_chance", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 1, Resolved: 0,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func setYunTalDriverHits(runReq *model.RunRequest, hits int) {
	ref := yunTalAARef()
	entries := make([]model.DriverEntry, 0, hits)
	for i := 0; i < hits; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "yun_tal_aa_" + itoaRuntime(i),
			AbilityRef: ref,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  int64(i * 100),
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = int64(hits*100 + 100)
	if hits == 0 {
		runReq.StopPolicy.DurationMs = 100
	}
}

func runYunTalPractice(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func yunTalStackValue(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		raw, ok := c.ProviderState[yunTalProviderRef]
		if !ok {
			return 0
		}
		bag, ok := raw.(map[string]interface{})
		if !ok {
			t.Fatalf("yun tal providerState shape: %+v", raw)
		}
		state, ok := bag["state"].(map[string]interface{})
		if !ok {
			return 0
		}
		v, _ := state[yunTalStackKey].(float64)
		return v
	}
	t.Fatal("source combatant missing")
	return 0
}

func assertTargetLacksYunTal(t *testing.T, done model.DoneResult) {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorTarget {
			continue
		}
		for _, p := range c.Providers {
			if p.ProviderRef == yunTalProviderRef || p.DefinitionRef == yunTalProviderRef {
				t.Fatalf("target must not mount Yun Tal provider: %+v", c.Providers)
			}
		}
		if raw, ok := c.ProviderState[yunTalProviderRef]; ok {
			t.Fatalf("target must not own Yun Tal providerState: %+v", raw)
		}
		return
	}
	t.Fatal("target combatant missing")
}

func wantYunTalCrit(stacks float64) float64 {
	return math.Min(yunTalCritCap, yunTalCritPerStack*stacks)
}

// TestYunTalPracticeMakesLethalInitialCritZero: mounted but unhit → stacks 0, crit_chance.resolved 0.
func TestYunTalPracticeMakesLethalInitialCritZero(t *testing.T) {
	compileReq, runReq := loadYunTalPracticeFixture(t)
	setYunTalDriverHits(&runReq, 0)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	var fieldOK bool
	for _, p := range result.Session.Providers {
		if p.ProviderKey != yunTalProviderRef {
			continue
		}
		field, ok := p.StateFields[yunTalStackKey]
		if !ok {
			t.Fatalf("compiled state field %s missing", yunTalStackKey)
		}
		if field.DefaultValue != 0 || field.MaxValue != yunTalStackMax || !field.HasCap || field.DurationMs != 0 {
			t.Fatalf("compiled field=%+v want default0 max63 capped untimed", field)
		}
		fieldOK = true
	}
	if !fieldOK {
		t.Fatalf("yun tal provider %s missing from session", yunTalProviderRef)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if got := yunTalStackValue(t, done); got != 0 {
		t.Fatalf("practice_crit_stacks=%v want 0", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "crit_chance"); math.Abs(got) > 1e-12 {
		t.Fatalf("crit_chance.resolved=%v want 0", got)
	}
	assertTargetLacksYunTal(t, done)
}

// TestYunTalPracticeMakesLethalOneOriginalHit: one original basic_attack_hit → stack 1 / crit 0.004.
func TestYunTalPracticeMakesLethalOneOriginalHit(t *testing.T) {
	compileReq, runReq := loadYunTalPracticeFixture(t)
	setYunTalDriverHits(&runReq, 1)
	done := runYunTalPractice(t, compileReq, runReq)

	if countEmittedEvents(done, yunTalHitEvent) != 1 {
		t.Fatalf("basic_attack_hit count=%d want 1", countEmittedEvents(done, yunTalHitEvent))
	}
	if got := yunTalStackValue(t, done); got != 1 {
		t.Fatalf("practice_crit_stacks=%v want 1", got)
	}
	want := wantYunTalCrit(1)
	if math.Abs(want-0.004) > 1e-12 {
		t.Fatalf("formula check want 0.004 got %v", want)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "crit_chance"); math.Abs(got-want) > 1e-12 {
		t.Fatalf("crit_chance.resolved=%v want %v", got, want)
	}
	assertTargetLacksYunTal(t, done)
}

// TestYunTalPracticeMakesLethalCapAt63Never0_252: 63 originals → 63 / 0.25; 64th stays 63 / 0.25 (never 0.252).
func TestYunTalPracticeMakesLethalCapAt63Never0_252(t *testing.T) {
	compileReq, runReq := loadYunTalPracticeFixture(t)
	setYunTalDriverHits(&runReq, 63)
	done63 := runYunTalPractice(t, compileReq, runReq)

	if countEmittedEvents(done63, yunTalHitEvent) != 63 {
		t.Fatalf("basic_attack_hit count=%d want 63", countEmittedEvents(done63, yunTalHitEvent))
	}
	if got := yunTalStackValue(t, done63); got != yunTalStackMax {
		t.Fatalf("practice_crit_stacks=%v want 63", got)
	}
	uncapped := yunTalCritPerStack * yunTalStackMax
	if math.Abs(uncapped-0.252) > 1e-12 {
		t.Fatalf("uncapped product=%v want 0.252 (formula must clamp)", uncapped)
	}
	want := wantYunTalCrit(yunTalStackMax)
	if math.Abs(want-yunTalCritCap) > 1e-12 {
		t.Fatalf("capped crit=%v want 0.25", want)
	}
	if got := sourceAttrResolved(t, done63.FinalSnapshot, "crit_chance"); math.Abs(got-want) > 1e-12 {
		t.Fatalf("crit_chance.resolved=%v want 0.25 (never 0.252)", got)
	}
	if math.Abs(sourceAttrResolved(t, done63.FinalSnapshot, "crit_chance")-0.252) < 1e-12 {
		t.Fatal("crit_chance.resolved must not equal uncapped 0.252")
	}
	assertTargetLacksYunTal(t, done63)

	compileReq64, runReq64 := loadYunTalPracticeFixture(t)
	setYunTalDriverHits(&runReq64, 64)
	done64 := runYunTalPractice(t, compileReq64, runReq64)
	if got := yunTalStackValue(t, done64); got != yunTalStackMax {
		t.Fatalf("after 64 originals stacks=%v want 63", got)
	}
	if got := sourceAttrResolved(t, done64.FinalSnapshot, "crit_chance"); math.Abs(got-yunTalCritCap) > 1e-12 {
		t.Fatalf("after 64 originals crit_chance.resolved=%v want 0.25", got)
	}
	assertTargetLacksYunTal(t, done64)
}

// TestYunTalPracticeMakesLethalGuinsooPhantomDoesNotStack: phantom must not add a Yun Tal stack or crit side effect.
func TestYunTalPracticeMakesLethalGuinsooPhantomDoesNotStack(t *testing.T) {
	compileReq, runReq := loadYunTalPracticeFixture(t)
	// Champion owns AA + Guinsoo stack/repeat; Yun Tal lives on a separate item provider (source only).
	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[0].Operations = yunTalAAOpsWithGuinsooStack()
	copyableAmt := 30.0
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "guinsoo_copyable",
			EventMatcher: model.TypeMatcher{All: []string{yunTalHitEvent, "event/source_owner"}},
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
			EventMatcher: model.TypeMatcher{All: []string{yunTalHitEvent, "event/source_owner"}},
			Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
		},
	}
	seedStacks := 10.0
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			yunTalChampionRef: map[string]interface{}{
				"state": map[string]interface{}{guinsooStackKey: float64(3)},
			},
			yunTalProviderRef: map[string]interface{}{
				"state": map[string]interface{}{yunTalStackKey: seedStacks},
			},
		}
	}
	setYunTalDriverHits(&runReq, 1)
	done := runYunTalPractice(t, compileReq, runReq)

	if countEmittedEvents(done, yunTalHitEvent) != 1 {
		t.Fatalf("basic_attack_hit emits=%d want 1 (phantom must not re-emit)", countEmittedEvents(done, yunTalHitEvent))
	}
	wantStacks := seedStacks + 1
	if got := yunTalStackValue(t, done); math.Abs(got-wantStacks) > 1e-9 {
		t.Fatalf("practice_crit_stacks=%v want %v (phantom must not add an extra stack)", got, wantStacks)
	}
	wantCrit := wantYunTalCrit(wantStacks)
	if got := sourceAttrResolved(t, done.FinalSnapshot, "crit_chance"); math.Abs(got-wantCrit) > 1e-12 {
		t.Fatalf("crit_chance.resolved=%v want %v (phantom must not cause attribute-modifier side effect)", got, wantCrit)
	}
	if n := countPhantomDamageByOpRef(done, "op:guinsoo_copyable"); n != 1 {
		t.Fatalf("phantom guinsoo copyable=%d want 1", n)
	}
	assertTargetLacksYunTal(t, done)
}
