package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func TestPerCastThrottleCapacityBounds(t *testing.T) {
	if got := perCastThrottleCapacity(1); got != 256 {
		t.Fatalf("capacity(1)=%d want 256", got)
	}
	if got := perCastThrottleCapacity(512); got != 512 {
		t.Fatalf("capacity(512)=%d want 512", got)
	}
	if got := perCastThrottleCapacity(100000); got != 4096 {
		t.Fatalf("capacity(100000)=%d want 4096", got)
	}
}

func TestPerCastThrottleAllowBoundaries(t *testing.T) {
	s := &genericRunState{
		nowMs:           0,
		perCastThrottle: map[perCastThrottleKey]int64{},
	}
	if !s.allowPerCastThrottle(0, "source", "p", 1, 0) {
		t.Fatal("throttle 0 must always allow")
	}
	s.notePerCastThrottleTrigger(0, "source", "p", 1)
	s.nowMs = 999
	if !s.allowPerCastThrottle(0, "source", "p", 1, 999) {
		t.Fatal("elapsed 999 with throttle 999 must allow")
	}
	s.nowMs = 998
	if s.allowPerCastThrottle(0, "source", "p", 1, 999) {
		t.Fatal("elapsed 998 with throttle 999 must block")
	}
	s.nowMs = 999
	if s.allowPerCastThrottle(0, "source", "p", 1, 1000) {
		t.Fatal("elapsed 999 with throttle 1000 must block")
	}
	s.nowMs = 1000
	if !s.allowPerCastThrottle(0, "source", "p", 1, 1000) {
		t.Fatal("elapsed 1000 with throttle 1000 must allow")
	}
	// Overlapping casts are independent.
	s.nowMs = 500
	if !s.allowPerCastThrottle(0, "source", "p", 2, 1000) {
		t.Fatal("distinct castInstanceId must not share throttle")
	}
	if s.allowPerCastThrottle(0, "source", "p", 0, 1000) {
		t.Fatal("missing cast id must fail closed when throttle>0")
	}
}

func TestPerCastThrottleOverflowEvictsSmallestAndWarnsOnce(t *testing.T) {
	s := &genericRunState{
		nowMs:                   0,
		budget:                  model.SafetyBudget{MaxEvents: 1},
		perCastThrottle:         map[perCastThrottleKey]int64{},
		perCastThrottleCapacity: 4,
	}
	for id := uint64(1); id <= 4; id++ {
		s.notePerCastThrottleTrigger(0, "source", "p", id)
	}
	if len(s.perCastThrottle) != 4 {
		t.Fatalf("len=%d want 4", len(s.perCastThrottle))
	}
	s.notePerCastThrottleTrigger(0, "source", "p", 5)
	if len(s.perCastThrottle) != 4 {
		t.Fatalf("after overflow len=%d want 4", len(s.perCastThrottle))
	}
	if _, ok := s.perCastThrottle[perCastThrottleKey{0, "source", "p", 1}]; ok {
		t.Fatal("smallest castInstanceId=1 should be evicted")
	}
	if !s.perCastThrottleOverflowWarned || s.perCastThrottleOverflowCount != 1 {
		t.Fatalf("warned=%v count=%d", s.perCastThrottleOverflowWarned, s.perCastThrottleOverflowCount)
	}
	s.notePerCastThrottleTrigger(0, "source", "p", 6)
	if s.perCastThrottleOverflowCount != 2 {
		t.Fatalf("count=%d want 2", s.perCastThrottleOverflowCount)
	}
	w := s.perCastThrottleOverflowWarning()
	if w == nil || w.Code != string(model.WarningCodePerCastThrottleOverflow) || w.Count != 2 {
		t.Fatalf("warning=%+v", w)
	}
}

func TestPerCastThrottleLessTieBreak(t *testing.T) {
	a := perCastThrottleKey{listenerIndex: 1, ownerCombatantKey: "b", ownerProviderRef: "q", castInstanceID: 1}
	b := perCastThrottleKey{listenerIndex: 2, ownerCombatantKey: "a", ownerProviderRef: "p", castInstanceID: 1}
	if !perCastThrottleLess(a, b) {
		t.Fatal("same cast id: smaller listenerIndex must win")
	}
	c := perCastThrottleKey{listenerIndex: 1, ownerCombatantKey: "a", ownerProviderRef: "z", castInstanceID: 1}
	d := perCastThrottleKey{listenerIndex: 1, ownerCombatantKey: "b", ownerProviderRef: "a", castInstanceID: 1}
	if !perCastThrottleLess(c, d) {
		t.Fatal("tie: smaller combatant key must win")
	}
	e := perCastThrottleKey{listenerIndex: 1, ownerCombatantKey: "a", ownerProviderRef: "p", castInstanceID: 1}
	f := perCastThrottleKey{listenerIndex: 1, ownerCombatantKey: "a", ownerProviderRef: "q", castInstanceID: 1}
	if !perCastThrottleLess(e, f) {
		t.Fatal("tie: smaller provider ref must win")
	}
}

func castCtxEnsureTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
	need := []model.TypeCatalogEntry{
		{Key: "event/damage_instance", Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "cast_origin/champion", Domain: "cast_origin"},
		{Key: "cast_origin/item", Domain: "cast_origin"},
		{Key: "cast_origin/pet", Domain: "cast_origin"},
		{Key: "cast_origin/innate", Domain: "cast_origin"},
		{Key: "ability/spell", Domain: "ability"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage_trait/ability", Domain: "damage_trait"},
		{Key: "damage_trait/pet", Domain: "damage_trait"},
		{Key: "damage_trait/proc", Domain: "damage_trait"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "state_scope/provider", Domain: "state_scope"},
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

func castCtxEvidenceID(data map[string]interface{}) uint64 {
	switch v := data["castInstanceId"].(type) {
	case float64:
		return uint64(v)
	case uint64:
		return v
	case int:
		return uint64(v)
	default:
		return 0
	}
}

func castCtxDamageIDs(done model.DoneResult, opRef string) []uint64 {
	out := make([]uint64, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindDamage {
			continue
		}
		if opRef != "" {
			ref, _ := item.Data["operationRef"].(string)
			if ref != opRef {
				continue
			}
		}
		out = append(out, castCtxEvidenceID(item.Data))
	}
	return out
}

func TestCastInstanceIDMultiOpInheritanceAndDistinctTopLevel(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	castCtxEnsureTypes(&compileReq)
	ten := 10.0
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: "multi_hit",
		Kind:       "active",
		Types:      []string{"ability/spell"},
		CastOrigin: model.CastOriginChampion,
		Operations: []model.OperationDefinition{
			{Operation: "damage", Target: "target", DamageType: "damage/physical", Ref: "op:hit_a",
				Amount: &model.GenericFormulaExpr{Op: "const", Value: &ten}, Types: []string{"damage_trait/ability"}},
			{Operation: "damage", Target: "target", DamageType: "damage/physical", Ref: "op:hit_b",
				Amount: &model.GenericFormulaExpr{Op: "const", Value: &ten}, Types: []string{"damage_trait/ability"}},
		},
	}}
	abilityRef := "source.provider[champion:source_demo].ability[multi_hit]"
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "c1", AbilityRef: abilityRef, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "c2", AbilityRef: abilityRef, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	a := castCtxDamageIDs(done, "op:hit_a")
	b := castCtxDamageIDs(done, "op:hit_b")
	if len(a) != 2 || len(b) != 2 {
		t.Fatalf("hit counts a=%v b=%v", a, b)
	}
	if a[0] == 0 || a[0] != b[0] {
		t.Fatalf("same cast multi-op must share id: a0=%d b0=%d", a[0], b[0])
	}
	if a[1] == 0 || a[1] != b[1] {
		t.Fatalf("second cast multi-op must share id: a1=%d b1=%d", a[1], b[1])
	}
	if a[0] == a[1] {
		t.Fatalf("distinct top-level casts must mint distinct ids: %d", a[0])
	}
	// Evidence origin
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindDamage {
			continue
		}
		if origin, _ := item.Data["castOrigin"].(string); origin != model.CastOriginChampion {
			t.Fatalf("castOrigin=%q", origin)
		}
	}
}

func TestCastInstanceIDListenerOpsInheritAbilityRefMints(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	castCtxEnsureTypes(&compileReq)
	ten := 10.0
	five := 5.0
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: "parent_spell",
			Kind:       "active",
			Types:      []string{"ability/spell"},
			CastOrigin: model.CastOriginChampion,
			Operations: []model.OperationDefinition{{
				Operation: "damage", Target: "target", DamageType: "damage/physical", Ref: "op:parent",
				Amount: &model.GenericFormulaExpr{Op: "const", Value: &ten}, Types: []string{"damage_trait/ability"},
			}},
		},
		{
			AbilityKey: "child_spell",
			Kind:       "active",
			Types:      []string{"ability/spell"},
			CastOrigin: model.CastOriginItem,
			Operations: []model.OperationDefinition{{
				Operation: "damage", Target: "target", DamageType: "damage/physical", Ref: "op:child_ability",
				Amount: &model.GenericFormulaExpr{Op: "const", Value: &five}, Types: []string{"damage_trait/ability"},
			}},
		},
	}
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "ops_inherit",
			EventMatcher: model.TypeMatcher{All: []string{"event/damage_instance", "event/source_owner"}},
			Operations: []model.OperationDefinition{{
				Operation: "damage", Target: "target", DamageType: "damage/physical", Ref: "op:listener_ops",
				Amount: &model.GenericFormulaExpr{Op: "const", Value: &five}, Types: []string{"damage_trait/proc"},
			}},
		},
		{
			ListenerKey:  "ability_mint",
			EventMatcher: model.TypeMatcher{All: []string{"event/damage_instance", "event/source_owner"}},
			AbilityRef:   "source.provider[champion:source_demo].ability[child_spell]",
			// Avoid re-entry recursion from child damage: only match parent op via None on listener_ops traits.
			// Child has damage_trait/ability; parent also does — use MaxTriggersPerEvent=1 and
			// match only when cast_origin/champion (parent), excluding item child.
			// Rebuild matcher with cast_origin filter instead:
		},
	}
	// Rebuild ability_mint matcher to only fire on champion-origin parent.
	compileReq.SharedProviders[0].Listeners[1].EventMatcher = model.TypeMatcher{
		All:  []string{"event/damage_instance", "event/source_owner", "cast_origin/champion"},
		None: []string{"damage_trait/proc"},
	}
	// ops_inherit only on champion parent, exclude child item and its own proc.
	compileReq.SharedProviders[0].Listeners[0].EventMatcher = model.TypeMatcher{
		All:  []string{"event/damage_instance", "event/source_owner", "cast_origin/champion"},
		None: []string{"damage_trait/proc"},
	}

	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 10000, Current: 10000, Max: 10000, Resolved: 10000,
	})
	abilityRef := "source.provider[champion:source_demo].ability[parent_spell]"
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "c1", AbilityRef: abilityRef, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	parentIDs := castCtxDamageIDs(done, "op:parent")
	opsIDs := castCtxDamageIDs(done, "op:listener_ops")
	childIDs := castCtxDamageIDs(done, "op:child_ability")
	if len(parentIDs) != 1 || len(opsIDs) != 1 || len(childIDs) != 1 {
		t.Fatalf("counts parent=%v ops=%v child=%v", parentIDs, opsIDs, childIDs)
	}
	if parentIDs[0] != opsIDs[0] {
		t.Fatalf("listener ops must inherit parent cast id: parent=%d ops=%d", parentIDs[0], opsIDs[0])
	}
	if childIDs[0] == parentIDs[0] {
		t.Fatalf("listener AbilityRef must mint new id: parent=%d child=%d", parentIDs[0], childIDs[0])
	}
	var childOrigin string
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindDamage {
			continue
		}
		if ref, _ := item.Data["operationRef"].(string); ref == "op:child_ability" {
			childOrigin, _ = item.Data["castOrigin"].(string)
		}
	}
	if childOrigin != model.CastOriginItem {
		t.Fatalf("child castOrigin=%q want item", childOrigin)
	}
}

func TestCastOriginUnknownSkipsEventTypeKnownAttaches(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	castCtxEnsureTypes(&compileReq)
	ten := 10.0
	var sawChampion, sawUnknown bool
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: "known_origin",
			Kind:       "active",
			Types:      []string{"ability/spell"},
			CastOrigin: model.CastOriginChampion,
			Operations: []model.OperationDefinition{{
				Operation: "damage", Target: "target", DamageType: "damage/physical", Ref: "op:known",
				Amount: &model.GenericFormulaExpr{Op: "const", Value: &ten}, Types: []string{"damage_trait/ability"},
			}},
		},
	}
	// Empty origin: no cast_origin/* on event; formula predicates still 0.
	compileReq.SharedProviders[0].Abilities = append(compileReq.SharedProviders[0].Abilities, model.AbilityDefinition{
		AbilityKey: "empty_origin",
		Kind:       "active",
		Types:      []string{"ability/spell"},
		Operations: []model.OperationDefinition{{
			Operation: "damage", Target: "target", DamageType: "damage/physical", Ref: "op:empty",
			Amount: &model.GenericFormulaExpr{Op: "const", Value: &ten}, Types: []string{"damage_trait/ability"},
		}},
	})
	_ = sawChampion
	_ = sawUnknown
	abilityKnown := "source.provider[champion:source_demo].ability[known_origin]"
	abilityEmpty := "source.provider[champion:source_demo].ability[empty_origin]"
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "k", AbilityRef: abilityKnown, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "e", AbilityRef: abilityEmpty, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 50},
	}
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent || item.Ref != "event/damage_instance" {
			continue
		}
		ref, _ := item.Data["operationRef"].(string)
		origin, _ := item.Data["castOrigin"].(string)
		switch ref {
		case "op:known":
			if origin != model.CastOriginChampion {
				t.Fatalf("known origin evidence=%q", origin)
			}
			sawChampion = true
		case "op:empty":
			if origin != "" {
				t.Fatalf("empty origin should omit castOrigin, got %q", origin)
			}
			sawUnknown = true
		}
	}
	if !sawChampion || !sawUnknown {
		t.Fatalf("sawChampion=%v sawEmpty=%v", sawChampion, sawUnknown)
	}
}

func TestPerCastThrottleRuntimeOverlapAndZero(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	castCtxEnsureTypes(&compileReq)
	one := 1.0
	ten := 10.0
	compileReq.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"hits": map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(100),
			"durationMs":   float64(0),
		},
	}
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: "spell",
		Kind:       "active",
		Types:      []string{"ability/spell"},
		CastOrigin: model.CastOriginChampion,
		Operations: []model.OperationDefinition{
			{Operation: "damage", Target: "target", DamageType: "damage/physical", Ref: "op:t0",
				Amount: &model.GenericFormulaExpr{Op: "const", Value: &ten}, Types: []string{"damage_trait/ability"}},
			{Operation: "damage", Target: "target", DamageType: "damage/physical", Ref: "op:t1",
				Amount: &model.GenericFormulaExpr{Op: "const", Value: &ten}, Types: []string{"damage_trait/ability"}},
		},
	}}
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{{
		ListenerKey:       "throttle_counter",
		EventMatcher:      model.TypeMatcher{All: []string{"event/damage_instance", "event/source_owner"}},
		PerCastThrottleMs: 1000,
		Operations: []model.OperationDefinition{{
			Operation: "state_change", Target: "source", Ref: "hits",
			Types: []string{"state_scope/provider"}, ValuePolicy: "add",
			Amount: &model.GenericFormulaExpr{Op: "const", Value: &one},
		}},
	}}
	abilityRef := "source.provider[champion:source_demo].ability[spell]"
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "c1", AbilityRef: abilityRef, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "c2", AbilityRef: abilityRef, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 500},
		{EntryKey: "c3", AbilityRef: abilityRef, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 1000},
	}
	runReq.StopPolicy.DurationMs = 1100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	state := sourceProviderState(t, done.FinalSnapshot, "champion:source_demo")["state"].(map[string]interface{})
	hits, _ := state["hits"].(float64)
	// Same-cast multi-hit: one grant; overlapping cast at 500: independent grant; cast at 1000: new cast grant.
	if math.Abs(hits-3) > 1e-9 {
		t.Fatalf("hits=%v want 3 (per-cast throttle with overlap)", hits)
	}
}
