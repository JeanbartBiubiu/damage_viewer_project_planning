package runtime

import (
	"encoding/json"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func ensureDamageTrueType(req *model.CompileRequest) {
	for _, t := range req.TypeCatalog.Types {
		if t.Key == "damage/true" {
			return
		}
	}
	req.TypeCatalog.Types = append(req.TypeCatalog.Types, model.TypeCatalogEntry{Key: "damage/true", Domain: "damage"})
}

func gteHitsCond(threshold float64) *model.GenericFormulaExpr {
	th := threshold
	return &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.target_state.hits"},
			{Op: "const", Value: &th},
		},
	}
}

func silverBoltsStyleOps(bonus float64) []model.OperationDefinition {
	one := 1.0
	zero := 0.0
	return []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "hits",
			Types:       []string{"state_scope/provider_target"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/true",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &bonus},
			Condition:  gteHitsCond(3),
		},
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "hits",
			Types:       []string{"state_scope/provider_target"},
			ValuePolicy: "override",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
			Condition:   gteHitsCond(3),
		},
	}
}

func TestGenericRunConditionFalseSkipsOperationSideEffect(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageTrueType(&compileReq)
	zero := 0.0
	fifty := 50.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/true",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &fifty},
			Condition:  &model.GenericFormulaExpr{Op: "const", Value: &zero},
		},
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if done.Summary.TargetFinalHp != 1000 {
		t.Fatalf("targetFinalHp=%v want 1000 (condition false skips damage)", done.Summary.TargetFinalHp)
	}
}

func TestGenericRunSilverBoltsStyleHitSequenceProcAndReset(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageTrueType(&compileReq)
	bonus := 50.0
	compileReq.SharedProviders[0].Abilities[0].Operations = silverBoltsStyleOps(bonus)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "h1", AbilityRef: "source.provider[champion:source_demo].ability[basic_attack]", Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "h2", AbilityRef: "source.provider[champion:source_demo].ability[basic_attack]", Source: "source", Target: "target", FirstAtMs: 100},
		{EntryKey: "h3", AbilityRef: "source.provider[champion:source_demo].ability[basic_attack]", Source: "source", Target: "target", FirstAtMs: 200},
		{EntryKey: "h4", AbilityRef: "source.provider[champion:source_demo].ability[basic_attack]", Source: "source", Target: "target", FirstAtMs: 300},
	}
	runReq.StopPolicy.DurationMs = 500
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	// hits 1/2: no bonus; hit 3: +50 then reset; hit 4: stack=1 no bonus => total bonus 50
	if done.Summary.TargetFinalHp != 950 {
		t.Fatalf("targetFinalHp=%v want 950 (only hit3 bonus 50)", done.Summary.TargetFinalHp)
	}
	var sourceSnap model.CombatantSnapshot
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key == model.SelectorSource {
			sourceSnap = c
		}
	}
	bag, ok := sourceSnap.ProviderState["champion:source_demo"].(map[string]interface{})
	if !ok {
		t.Fatalf("providerState shape missing: %+v", sourceSnap.ProviderState)
	}
	ts, ok := bag["targetState"].(map[string]interface{})
	if !ok {
		t.Fatalf("targetState missing in stable shape: %+v", bag)
	}
	values, ok := ts["values"].(map[string]interface{})
	if !ok {
		t.Fatalf("targetState.values missing: %+v", ts)
	}
	if hits, _ := values["hits"].(float64); hits != 1 {
		t.Fatalf("after hit4 hits=%v want 1 (restarted after reset)", hits)
	}
}

func TestGenericRunProviderTargetStateSwitchClearsPreviousTarget(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageTrueType(&compileReq)
	bonus := 50.0
	compileReq.SharedProviders[0].Abilities[0].Operations = silverBoltsStyleOps(bonus)
	// A=target twice, B=source once, A=target once -> no proc
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "a1", AbilityRef: "source.provider[champion:source_demo].ability[basic_attack]", Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "a2", AbilityRef: "source.provider[champion:source_demo].ability[basic_attack]", Source: "source", Target: "target", FirstAtMs: 100},
		{EntryKey: "b1", AbilityRef: "source.provider[champion:source_demo].ability[basic_attack]", Source: "source", Target: "source", FirstAtMs: 200},
		{EntryKey: "a3", AbilityRef: "source.provider[champion:source_demo].ability[basic_attack]", Source: "source", Target: "target", FirstAtMs: 300},
	}
	runReq.StopPolicy.DurationMs = 500
	// Give source HP so self-target damage path is safe if bonus ever fired on B.
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key == model.SelectorSource {
			runReq.InitialSnapshot.Combatants[i].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Current: 1000, Max: 1000, Resolved: 1000}
		}
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if done.Summary.TargetFinalHp != 1000 {
		t.Fatalf("targetFinalHp=%v want 1000 (A->B->A must not proc)", done.Summary.TargetFinalHp)
	}
	if done.Summary.SourceFinalHp != 1000 {
		t.Fatalf("sourceFinalHp=%v want 1000 (B hit must not proc)", done.Summary.SourceFinalHp)
	}
}

func TestGenericRunProviderStateDistinctFromTargetState(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	one := 1.0
	seven := 7.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "counter",
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &seven},
		},
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "hits",
			Types:       []string{"state_scope/provider_target"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	var sourceSnap model.CombatantSnapshot
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key == model.SelectorSource {
			sourceSnap = c
		}
	}
	bag := sourceSnap.ProviderState["champion:source_demo"].(map[string]interface{})
	state := bag["state"].(map[string]interface{})
	if state["counter"].(float64) != 7 {
		t.Fatalf("provider.state.counter=%v want 7", state["counter"])
	}
	ts := bag["targetState"].(map[string]interface{})
	values := ts["values"].(map[string]interface{})
	if values["hits"].(float64) != 1 {
		t.Fatalf("target hits=%v want 1", values["hits"])
	}
	if _, exists := state["hits"]; exists {
		t.Fatal("provider.state must stay distinct from target-bound hits")
	}
}

func TestGenericRunProviderListenerIsolatedByOwnerCombatant(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageTrueType(&compileReq)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "event/on_hit", Domain: "event"},
		model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"},
	)
	bonus := 25.0
	compileReq.Combatants[1].Providers = []model.CombatantProviderMount{
		{ProviderRef: "champion:source_demo", DefinitionRef: "champion:source_demo"},
	}
	runReq.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{
		{ProviderRef: "champion:source_demo", DefinitionRef: "champion:source_demo", Stacks: 1, State: map[string]interface{}{}},
	}
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "on_hit_stack",
			EventMatcher: model.TypeMatcher{All: []string{"event/on_hit", "event/source_owner"}},
			Operations: []model.OperationDefinition{
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Amount:     &model.GenericFormulaExpr{Op: "const", Value: &bonus},
				},
			},
		},
	}
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{Operation: "emit_event", Target: "target", EventType: "event/on_hit", Ref: "event/on_hit"},
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	if len(result.Session.Listeners) < 2 {
		t.Fatalf("expected bound listeners on both mounts, got %d", len(result.Session.Listeners))
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	// Only owner's (source) listener matches source_owner => one 25 damage.
	if done.Summary.TargetFinalHp != 975 {
		t.Fatalf("targetFinalHp=%v want 975 (owner listener only)", done.Summary.TargetFinalHp)
	}
}

func mountEmitOnlyOpponent(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: "utility:emit_hit",
		Kind:        "utility",
		StableID:    "emit_hit",
		Abilities: []model.AbilityDefinition{
			{
				AbilityKey: "emit",
				Kind:       "active",
				Operations: []model.OperationDefinition{
					{Operation: "emit_event", Target: "target", EventType: "event/on_hit", Ref: "event/on_hit"},
				},
			},
		},
	})
	compileReq.Combatants[1].Providers = []model.CombatantProviderMount{
		{ProviderRef: "utility:emit_hit", DefinitionRef: "utility:emit_hit"},
	}
	runReq.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{
		{ProviderRef: "utility:emit_hit", DefinitionRef: "utility:emit_hit", Stacks: 1, State: map[string]interface{}{}},
	}
	// Source/Target are role selectors: both "target" means the target combatant casts at itself.
	runReq.DriverPlan.Entries[0].AbilityRef = "target.provider[utility:emit_hit].ability[emit]"
	runReq.DriverPlan.Entries[0].Source = "target"
	runReq.DriverPlan.Entries[0].Target = "target"
}

func ensureSourceHP(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	hp := model.AttributeSlotDef{Base: 1000, Current: 1000, Max: 1000, Resolved: 1000}
	compileReq.Combatants[0].Attributes["hp"] = hp
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key == model.SelectorSource {
			runReq.InitialSnapshot.Combatants[i].Attributes["hp"] = hp
		}
	}
}

func TestGenericRunProviderListenerDefaultAnyStillReceivesOpponentSourcedEvents(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageTrueType(&compileReq)
	ensureSourceHP(&compileReq, &runReq)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/on_hit", Domain: "event"})
	bonus := 40.0
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "any_on_hit",
			EventMatcher: model.TypeMatcher{Any: []string{"event/on_hit"}},
			Operations: []model.OperationDefinition{
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Amount:     &model.GenericFormulaExpr{Op: "const", Value: &bonus},
				},
			},
		},
	}
	mountEmitOnlyOpponent(&compileReq, &runReq)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	// Opponent emit; source-owned default-any listener still fires and damages remapped opponent (target).
	if done.Summary.TargetFinalHp != 960 {
		t.Fatalf("targetFinalHp=%v want 960 (default-any listener reacts to opponent-sourced event)", done.Summary.TargetFinalHp)
	}
}

func TestGenericRunProviderListenerAllSourceOwnerRequiresOwnerSourcedEvent(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageTrueType(&compileReq)
	ensureSourceHP(&compileReq, &runReq)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "event/on_hit", Domain: "event"},
		model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"},
	)
	bonus := 40.0
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "owner_only_hit",
			EventMatcher: model.TypeMatcher{All: []string{"event/on_hit", "event/source_owner"}},
			Operations: []model.OperationDefinition{
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Amount:     &model.GenericFormulaExpr{Op: "const", Value: &bonus},
				},
			},
		},
	}
	mountEmitOnlyOpponent(&compileReq, &runReq)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if done.Summary.TargetFinalHp != 1000 {
		t.Fatalf("targetFinalHp=%v want 1000 (ALL source_owner ignores opponent-sourced event)", done.Summary.TargetFinalHp)
	}
	if done.Summary.SourceFinalHp != 1000 {
		t.Fatalf("sourceFinalHp=%v want 1000", done.Summary.SourceFinalHp)
	}
}

func TestGenericRunProviderListenerSourceOpponentMatchesTargetSideReactive(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageTrueType(&compileReq)
	ensureSourceHP(&compileReq, &runReq)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "event/on_hit", Domain: "event"},
		model.TypeCatalogEntry{Key: "event/source_opponent", Domain: "event"},
	)
	bonus := 30.0
	compileReq.Combatants[1].Providers = []model.CombatantProviderMount{
		{ProviderRef: "champion:source_demo", DefinitionRef: "champion:source_demo"},
	}
	runReq.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{
		{ProviderRef: "champion:source_demo", DefinitionRef: "champion:source_demo", Stacks: 1, State: map[string]interface{}{}},
	}
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "reactive_on_opponent_hit",
			EventMatcher: model.TypeMatcher{All: []string{"event/on_hit", "event/source_opponent"}},
			Operations: []model.OperationDefinition{
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Amount:     &model.GenericFormulaExpr{Op: "const", Value: &bonus},
				},
			},
		},
	}
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{Operation: "emit_event", Target: "target", EventType: "event/on_hit", Ref: "event/on_hit"},
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if done.Summary.TargetFinalHp != 1000 {
		t.Fatalf("targetFinalHp=%v want 1000 (source-owned source_opponent does not match own emit)", done.Summary.TargetFinalHp)
	}
	if done.Summary.SourceFinalHp != 970 {
		t.Fatalf("sourceFinalHp=%v want 970 (target-side source_opponent listener)", done.Summary.SourceFinalHp)
	}
}

func TestGenericRunAppliedProviderTickStateOwnedByMountCombatant(t *testing.T) {
	compileReq, runReq := loadFixedTickProviderFixture(t)
	one := 1.0
	compileReq.SharedProviders[1].Abilities[0].TickSpec.OnTick = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "ticks",
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
	}
	runReq.StopPolicy.DurationMs = 500
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	var sourceSnap, targetSnap model.CombatantSnapshot
	for _, c := range done.FinalSnapshot.Combatants {
		switch c.Key {
		case model.SelectorSource:
			sourceSnap = c
		case model.SelectorTarget:
			targetSnap = c
		}
	}
	if len(sourceSnap.ProviderState) != 0 {
		// champion mount may still be empty map; ensure no applied-dot state leaked to applier.
		for ref := range sourceSnap.ProviderState {
			if ref != "champion:source_demo" {
				t.Fatalf("applied provider state leaked onto source under %q: %+v", ref, sourceSnap.ProviderState)
			}
			bag := sourceSnap.ProviderState[ref].(map[string]interface{})
			if state, ok := bag["state"].(map[string]interface{}); ok {
				if _, has := state["ticks"]; has {
					t.Fatalf("tick state written under source: %+v", sourceSnap.ProviderState)
				}
			}
		}
	}
	found := false
	for ref, raw := range targetSnap.ProviderState {
		bag, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		state, _ := bag["state"].(map[string]interface{})
		if ticks, ok := state["ticks"].(float64); ok && ticks >= 1 {
			found = true
			if ticks != 2 {
				t.Fatalf("target provider %s ticks=%v want 2 (ticks at 200/400)", ref, ticks)
			}
		}
	}
	if !found {
		t.Fatalf("expected tick providerState under target, got %+v", targetSnap.ProviderState)
	}
}

func TestGenericRunAbilityStateUsesCanonicalOwnerNotExecutionSource(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageTrueType(&compileReq)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/on_hit", Domain: "event"})
	seven := 7.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "self",
			Ref:         "counter",
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &seven},
		},
	}
	// Target-owned listener child-casts source's ability: execution source=target, canonical owner=source.
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: "utility:child_cast",
		Kind:        "utility",
		StableID:    "child_cast",
		Listeners: []model.ListenerDefinition{
			{
				ListenerKey:  "cast_source_ability",
				EventMatcher: model.TypeMatcher{Any: []string{"event/on_hit"}},
				AbilityRef:   "source.provider[champion:source_demo].ability[basic_attack]",
			},
		},
		Abilities: []model.AbilityDefinition{
			{
				AbilityKey: "emit",
				Kind:       "active",
				Operations: []model.OperationDefinition{
					{Operation: "emit_event", Target: "target", EventType: "event/on_hit", Ref: "event/on_hit"},
				},
			},
		},
	})
	compileReq.Combatants[1].Providers = []model.CombatantProviderMount{
		{ProviderRef: "utility:child_cast", DefinitionRef: "utility:child_cast"},
	}
	runReq.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{
		{ProviderRef: "utility:child_cast", DefinitionRef: "utility:child_cast", Stacks: 1, State: map[string]interface{}{}},
	}
	runReq.DriverPlan.Entries[0].AbilityRef = "target.provider[utility:child_cast].ability[emit]"
	runReq.DriverPlan.Entries[0].Source = "target"
	runReq.DriverPlan.Entries[0].Target = "target"
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	var sourceSnap, targetSnap model.CombatantSnapshot
	for _, c := range done.FinalSnapshot.Combatants {
		switch c.Key {
		case model.SelectorSource:
			sourceSnap = c
		case model.SelectorTarget:
			targetSnap = c
		}
	}
	bag, ok := sourceSnap.ProviderState["champion:source_demo"].(map[string]interface{})
	if !ok {
		t.Fatalf("canonical owner providerState missing: %+v", sourceSnap.ProviderState)
	}
	if bag["state"].(map[string]interface{})["counter"].(float64) != 7 {
		t.Fatalf("source counter=%v want 7", bag["state"])
	}
	if raw, exists := targetSnap.ProviderState["champion:source_demo"]; exists {
		if tb, ok := raw.(map[string]interface{}); ok {
			if state, _ := tb["state"].(map[string]interface{}); state["counter"] != nil {
				t.Fatalf("execution source must not own provider state: %+v", targetSnap.ProviderState)
			}
		}
	}
}

func TestGenericRunTrueDamageIgnoresArmorMRAttrs(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageTrueType(&compileReq)
	fifty := 50.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/true",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &fifty},
		},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key == model.SelectorTarget {
			attrs := runReq.InitialSnapshot.Combatants[i].Attributes
			attrs["armor"] = model.AttributeSlotDef{Base: 200, Current: 200, Max: 200, Resolved: 200}
			attrs["magic_resist"] = model.AttributeSlotDef{Base: 200, Current: 200, Max: 200, Resolved: 200}
		}
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if done.Summary.TargetFinalHp != 950 {
		t.Fatalf("targetFinalHp=%v want 950 (true damage not reduced by armor/MR)", done.Summary.TargetFinalHp)
	}
}

func TestGenericRunProviderStateSnapshotShapeAndHydrationResume(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	two := 2.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "hits",
			Types:       []string{"state_scope/provider_target"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &two},
		},
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	var sourceSnap model.CombatantSnapshot
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key == model.SelectorSource {
			sourceSnap = c
		}
	}
	raw, marshalErr := json.Marshal(sourceSnap.ProviderState)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	var decoded map[string]interface{}
	if unmarshalErr := json.Unmarshal(raw, &decoded); unmarshalErr != nil {
		t.Fatal(unmarshalErr)
	}
	bag := decoded["champion:source_demo"].(map[string]interface{})
	if _, ok := bag["state"].(map[string]interface{}); !ok {
		t.Fatalf("stable shape requires state object: %s", raw)
	}
	ts := bag["targetState"].(map[string]interface{})
	if ts["target"] != "target" {
		t.Fatalf("targetState.target=%v want target", ts["target"])
	}
	if ts["values"].(map[string]interface{})["hits"].(float64) != 2 {
		t.Fatalf("hits=%v want 2", ts["values"])
	}

	// Resume: hydrate providerState from final snapshot and add +1 => hits become 3.
	one := 1.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "hits",
			Types:       []string{"state_scope/provider_target"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
	}
	result2 := compile.CompileGeneric(compileReq)
	if !result2.OK {
		t.Fatalf("compile2 failed: %+v", result2.Result.Errors)
	}
	runReq2 := runReq
	runReq2.InitialSnapshot = done.FinalSnapshot
	runReq2.ExpectedRulesHash = compileReq.RulesHash
	runReq2.DriverPlan.Entries[0].FirstAtMs = done.FinalSnapshot.TimeMs
	runReq2.StopPolicy.DurationMs = 100
	done2, err := RunGeneric(result2.Session, runReq2)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range done2.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag := c.ProviderState["champion:source_demo"].(map[string]interface{})
		hits := bag["targetState"].(map[string]interface{})["values"].(map[string]interface{})["hits"].(float64)
		if hits != 3 {
			t.Fatalf("hydrated resume hits=%v want 3", hits)
		}
	}
}

func TestGenericRunProviderExpireRemovesOwningProviderStateBag(t *testing.T) {
	compileReq, runReq := loadFixedTickProviderFixture(t)
	one := 1.0
	compileReq.SharedProviders[1].Abilities[0].TickSpec.OnTick = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "ticks",
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
	}
	// Unrelated bags must survive cleanup of the expired mount only.
	for i := range runReq.InitialSnapshot.Combatants {
		c := &runReq.InitialSnapshot.Combatants[i]
		switch c.Key {
		case model.SelectorSource:
			c.ProviderState = map[string]interface{}{
				"champion:source_demo": map[string]interface{}{
					"state": map[string]interface{}{"marker": float64(3)},
				},
			}
		case model.SelectorTarget:
			c.ProviderState = map[string]interface{}{
				"other:keep#1": map[string]interface{}{
					"state": map[string]interface{}{"marker": float64(9)},
				},
			}
		}
	}
	// Fixture durationMs=1200 is past burn_dot expireAt=1100 (handleExpireCleanup path).
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	var sourceSnap, targetSnap model.CombatantSnapshot
	for _, c := range done.FinalSnapshot.Combatants {
		switch c.Key {
		case model.SelectorSource:
			sourceSnap = c
		case model.SelectorTarget:
			targetSnap = c
		}
	}
	for _, p := range targetSnap.Providers {
		if p.DefinitionRef == "status:burn_dot" {
			t.Fatalf("expected burn_dot provider removed after expire, got %+v", targetSnap.Providers)
		}
	}
	for ref := range targetSnap.ProviderState {
		if strings.HasPrefix(ref, "status:burn_dot") {
			t.Fatalf("orphan providerState after expire: %q in %+v", ref, targetSnap.ProviderState)
		}
	}
	keepRaw, ok := targetSnap.ProviderState["other:keep#1"].(map[string]interface{})
	if !ok {
		t.Fatalf("unrelated target providerState missing: %+v", targetSnap.ProviderState)
	}
	keepState, _ := keepRaw["state"].(map[string]interface{})
	if marker, _ := keepState["marker"].(float64); marker != 9 {
		t.Fatalf("unrelated target bag marker=%v want 9", marker)
	}
	srcRaw, ok := sourceSnap.ProviderState["champion:source_demo"].(map[string]interface{})
	if !ok {
		t.Fatalf("source champion providerState missing: %+v", sourceSnap.ProviderState)
	}
	srcState, _ := srcRaw["state"].(map[string]interface{})
	if marker, _ := srcState["marker"].(float64); marker != 3 {
		t.Fatalf("source bag marker=%v want 3", marker)
	}
}

func sourceProviderState(t *testing.T, snap model.Snapshot, providerRef string) map[string]interface{} {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[providerRef].(map[string]interface{})
		if !ok {
			t.Fatalf("providerState[%s] missing: %+v", providerRef, c.ProviderState)
		}
		return bag
	}
	t.Fatalf("source combatant missing")
	return nil
}

func TestGenericRunLegacyNumericProviderStateUncapped(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	one := 1.0
	compileReq.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"stacks": float64(0),
	}
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "stacks",
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
	}
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "a1", AbilityRef: "source.provider[champion:source_demo].ability[basic_attack]", Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "a2", AbilityRef: "source.provider[champion:source_demo].ability[basic_attack]", Source: "source", Target: "target", FirstAtMs: 100},
		{EntryKey: "a3", AbilityRef: "source.provider[champion:source_demo].ability[basic_attack]", Source: "source", Target: "target", FirstAtMs: 200},
		{EntryKey: "a4", AbilityRef: "source.provider[champion:source_demo].ability[basic_attack]", Source: "source", Target: "target", FirstAtMs: 300},
		{EntryKey: "a5", AbilityRef: "source.provider[champion:source_demo].ability[basic_attack]", Source: "source", Target: "target", FirstAtMs: 400},
	}
	runReq.StopPolicy.DurationMs = 500
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	state := sourceProviderState(t, done.FinalSnapshot, "champion:source_demo")["state"].(map[string]interface{})
	if stacks, _ := state["stacks"].(float64); stacks != 5 {
		t.Fatalf("legacy stacks=%v want 5 (uncapped)", stacks)
	}
}

func TestGenericRunTimedCappedProviderStateClampAndLazyExpire(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	one := 1.0
	compileReq.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"stacks": map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(4),
			"durationMs":    float64(3000),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "stacks",
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
	}
	abilityRef := "source.provider[champion:source_demo].ability[basic_attack]"
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "s1", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "s2", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 100},
		{EntryKey: "s3", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 200},
		{EntryKey: "s4", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 300},
		{EntryKey: "s5", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 400},
		// Refresh window from last write at 400 => expireAt=3400; write at 2000 keeps alive.
		{EntryKey: "refresh", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 2000},
		// After 2000+3000=5000, first write lazy-expires to 0 then adds 1.
		{EntryKey: "after_expire", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 5000},
	}
	runReq.StopPolicy.DurationMs = 5100
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	if field := result.Session.Providers[0].StateFields["stacks"]; !field.HasCap || field.MaxValue != 4 || field.DurationMs != 3000 {
		t.Fatalf("compiled field=%+v", field)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	state := sourceProviderState(t, done.FinalSnapshot, "champion:source_demo")["state"].(map[string]interface{})
	if stacks, _ := state["stacks"].(float64); stacks != 1 {
		t.Fatalf("stacks after lazy-expire write=%v want 1", stacks)
	}
	// Snapshot must keep numeric shape only (no expireAt leak).
	bag := sourceProviderState(t, done.FinalSnapshot, "champion:source_demo")
	if _, has := bag["expireAt"]; has {
		t.Fatalf("snapshot must not emit expireAt: %+v", bag)
	}
	if _, has := bag["state"].(map[string]interface{})["expireAt"]; has {
		t.Fatalf("state must stay numeric shape: %+v", bag["state"])
	}
}

func TestGenericRunTimedCappedProviderStateCapAtMax(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	one := 1.0
	compileReq.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"stacks": map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(4),
			"durationMs":    float64(3000),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "stacks",
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
	}
	abilityRef := "source.provider[champion:source_demo].ability[basic_attack]"
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "s1", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "s2", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 100},
		{EntryKey: "s3", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 200},
		{EntryKey: "s4", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 300},
		{EntryKey: "s5", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 400},
	}
	runReq.StopPolicy.DurationMs = 500
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	state := sourceProviderState(t, done.FinalSnapshot, "champion:source_demo")["state"].(map[string]interface{})
	if stacks, _ := state["stacks"].(float64); stacks != 4 {
		t.Fatalf("stacks=%v want 4 (add 1..5 capped)", stacks)
	}
}

func TestGenericRunTimedProviderStateIsolatedFromTargetState(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	one := 1.0
	compileReq.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"stacks": map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(4),
			"durationMs":    float64(3000),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "stacks",
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "hits",
			Types:       []string{"state_scope/provider_target"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	bag := sourceProviderState(t, done.FinalSnapshot, "champion:source_demo")
	state := bag["state"].(map[string]interface{})
	if stacks, _ := state["stacks"].(float64); stacks != 1 {
		t.Fatalf("provider stacks=%v want 1", stacks)
	}
	if _, exists := state["hits"]; exists {
		t.Fatalf("hits must not leak into provider.state: %+v", state)
	}
	ts := bag["targetState"].(map[string]interface{})
	values := ts["values"].(map[string]interface{})
	if hits, _ := values["hits"].(float64); hits != 1 {
		t.Fatalf("target hits=%v want 1", hits)
	}
	if _, exists := values["stacks"]; exists {
		t.Fatalf("stacks must not leak into targetState: %+v", values)
	}
}

func TestGenericRunTimedProviderStateRefreshKeepsAliveAcrossNowMs(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	one := 1.0
	compileReq.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"stacks": map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(4),
			"durationMs":    float64(3000),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "stacks",
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
	}
	abilityRef := "source.provider[champion:source_demo].ability[basic_attack]"
	// Write at 0 (expireAt=3000), refresh write at 2500 (expireAt=5500), probe at 5000 must still see stacks.
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w1", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w2", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 2500},
		{EntryKey: "probe", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 5000},
	}
	runReq.StopPolicy.DurationMs = 5100
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	state := sourceProviderState(t, done.FinalSnapshot, "champion:source_demo")["state"].(map[string]interface{})
	if stacks, _ := state["stacks"].(float64); stacks != 3 {
		t.Fatalf("stacks=%v want 3 (refresh kept window alive through 5000)", stacks)
	}
}

func TestProviderStateBagLazyExpireAndRefreshExpireAt(t *testing.T) {
	bag := &providerStateBag{
		state:    map[string]float64{"stacks": 0},
		expireAt: map[string]int64{},
		fieldDefs: map[string]providerStateFieldDef{
			"stacks": {
				defaultValue:  0,
				maxValue:      4,
				hasCap:        true,
				durationMs:    3000,
				refreshPolicy: model.ProviderStateRefreshOnWrite,
			},
		},
		targetValues: map[string]float64{},
	}
	bag.state["stacks"] = bag.clampProviderStateValue("stacks", 5)
	if bag.state["stacks"] != 4 {
		t.Fatalf("clamp=%v want 4", bag.state["stacks"])
	}
	bag.refreshExpireAtOnWrite("stacks", 1000)
	if bag.expireAt["stacks"] != 4000 {
		t.Fatalf("expireAt=%d want 4000", bag.expireAt["stacks"])
	}
	bag.refreshExpireAtOnWrite("stacks", 2500)
	if bag.expireAt["stacks"] != 5500 {
		t.Fatalf("expireAt after refresh=%d want 5500", bag.expireAt["stacks"])
	}
	bag.state["stacks"] = 3
	bag.lazyExpireProviderState(5499)
	if bag.state["stacks"] != 3 {
		t.Fatalf("before expire stacks=%v want 3", bag.state["stacks"])
	}
	bag.lazyExpireProviderState(5500)
	if bag.state["stacks"] != 0 {
		t.Fatalf("lazy expire stacks=%v want 0", bag.state["stacks"])
	}
	if bag.expireAt["stacks"] != 0 {
		t.Fatalf("expireAt cleared=%d want 0", bag.expireAt["stacks"])
	}
}

func TestProviderTargetStateBagCapDurationRefreshAndClear(t *testing.T) {
	bag := &providerStateBag{
		state:    map[string]float64{},
		expireAt: map[string]int64{},
		fieldDefs: map[string]providerStateFieldDef{
			"carve_stacks": {
				defaultValue:  0,
				maxValue:      5,
				hasCap:        true,
				durationMs:    6000,
				refreshPolicy: model.ProviderStateRefreshOnWrite,
			},
		},
		targetValues:   map[string]float64{},
		targetExpireAt: map[string]int64{},
	}
	bag.targetKey = "target"
	bag.targetValues["carve_stacks"] = bag.clampProviderStateValue("carve_stacks", 6)
	if bag.targetValues["carve_stacks"] != 5 {
		t.Fatalf("cap=%v want 5", bag.targetValues["carve_stacks"])
	}
	exp := bag.refreshTargetExpireAtOnWrite("carve_stacks", 1000)
	if exp != 7000 || bag.targetExpireAt["carve_stacks"] != 7000 {
		t.Fatalf("expireAt=%d want 7000", bag.targetExpireAt["carve_stacks"])
	}
	// Cap write still refreshes.
	bag.targetValues["carve_stacks"] = bag.clampProviderStateValue("carve_stacks", bag.targetValues["carve_stacks"]+1)
	exp2 := bag.refreshTargetExpireAtOnWrite("carve_stacks", 2500)
	if bag.targetValues["carve_stacks"] != 5 {
		t.Fatalf("at-cap value=%v want 5", bag.targetValues["carve_stacks"])
	}
	if exp2 != 8500 {
		t.Fatalf("refresh expireAt=%d want 8500", exp2)
	}
	bag.lazyExpireProviderTargetState(8499)
	if bag.targetValues["carve_stacks"] != 5 {
		t.Fatalf("before expire stacks=%v want 5", bag.targetValues["carve_stacks"])
	}
	bag.lazyExpireProviderTargetState(8500)
	if bag.targetValues["carve_stacks"] != 0 {
		t.Fatalf("lazy expire stacks=%v want 0", bag.targetValues["carve_stacks"])
	}
	bag.targetKey = "target"
	bag.targetValues["carve_stacks"] = 3
	bag.targetExpireAt["carve_stacks"] = 9000
	bag.clearProviderTargetState()
	if bag.targetKey != "" || len(bag.targetValues) != 0 || len(bag.targetExpireAt) != 0 {
		t.Fatalf("clearProviderTargetState incomplete: %+v", bag)
	}
}

// TestProviderTargetStateNonZeroDefaultFirstAddAndExpire: first add starts from defaultValue;
// expiry restores the same default (not hard-coded 0).
func TestProviderTargetStateNonZeroDefaultFirstAddAndExpire(t *testing.T) {
	const def = 2.0
	bag := &providerStateBag{}
	bag.bindFieldDefs(map[string]providerStateFieldDef{
		"hits": {
			defaultValue:  def,
			maxValue:      10,
			hasCap:        true,
			durationMs:    1000,
			refreshPolicy: model.ProviderStateRefreshOnWrite,
		},
	})
	bag.activateProviderTarget("target")
	if got := bag.readTargetValue("hits"); got != def {
		t.Fatalf("after activate hits=%v want default %v", got, def)
	}
	bag.seedTargetValueIfAbsent("hits")
	next, ok := applyStatePolicy(bag.readTargetValue("hits"), 1, "add")
	if !ok {
		t.Fatal("applyStatePolicy failed")
	}
	bag.targetValues["hits"] = bag.clampProviderStateValue("hits", next)
	if bag.targetValues["hits"] != def+1 {
		t.Fatalf("first add hits=%v want %v", bag.targetValues["hits"], def+1)
	}
	bag.refreshTargetExpireAtOnWrite("hits", 0)
	bag.lazyExpireProviderTargetState(1000)
	if bag.targetValues["hits"] != def {
		t.Fatalf("after expire hits=%v want default %v", bag.targetValues["hits"], def)
	}

	// Target switch must re-seed defaults for the new active target on first touch.
	bag.activateProviderTarget("source")
	if bag.targetKey != "source" {
		t.Fatalf("targetKey=%q want source", bag.targetKey)
	}
	if _, exists := bag.targetValues["hits"]; exists {
		t.Fatalf("switch must clear prior values, got %+v", bag.targetValues)
	}
	if bag.readTargetValue("hits") != def {
		t.Fatalf("after switch read hits=%v want default %v", bag.readTargetValue("hits"), def)
	}
	bag.seedTargetValueIfAbsent("hits")
	if bag.targetValues["hits"] != def {
		t.Fatalf("after switch seed hits=%v want default %v", bag.targetValues["hits"], def)
	}
}

// TestProviderTargetStateMixedScopeFormulaOverlayNoLeak: formula overlay must expose only
// specifically seeded/written target keys — never inject untouched provider-scope fieldDefs
// defaults into ProviderTargetState.
func TestProviderTargetStateMixedScopeFormulaOverlayNoLeak(t *testing.T) {
	const (
		providerOnlyDef = 7.0
		targetKeyDef    = 3.0
	)
	bag := &providerStateBag{}
	bag.bindFieldDefs(map[string]providerStateFieldDef{
		"provider_only": {
			defaultValue: providerOnlyDef,
		},
		"target_key": {
			defaultValue:  targetKeyDef,
			maxValue:      10,
			hasCap:        true,
			durationMs:    1000,
			refreshPolicy: model.ProviderStateRefreshOnWrite,
		},
	})
	if bag.state["provider_only"] != providerOnlyDef {
		t.Fatalf("provider_only seeded in state=%v want %v", bag.state["provider_only"], providerOnlyDef)
	}
	if _, exists := bag.targetValues["provider_only"]; exists {
		t.Fatalf("bindFieldDefs must not seed provider_only into targetValues: %+v", bag.targetValues)
	}

	bag.activateProviderTarget("target")
	if overlay := bag.targetStateForFormula(); len(overlay) != 0 {
		t.Fatalf("before touch formula overlay must be empty, got %+v", overlay)
	}

	// First add starts from the concrete target_key default (not 0).
	if got := bag.readTargetValue("target_key"); got != targetKeyDef {
		t.Fatalf("read before seed target_key=%v want default %v", got, targetKeyDef)
	}
	bag.seedTargetValueIfAbsent("target_key")
	next, ok := applyStatePolicy(bag.readTargetValue("target_key"), 1, "add")
	if !ok {
		t.Fatal("applyStatePolicy failed")
	}
	bag.targetValues["target_key"] = bag.clampProviderStateValue("target_key", next)
	if bag.targetValues["target_key"] != targetKeyDef+1 {
		t.Fatalf("first add target_key=%v want %v", bag.targetValues["target_key"], targetKeyDef+1)
	}

	overlay := bag.targetStateForFormula()
	if got, ok := overlay["target_key"]; !ok || got != targetKeyDef+1 {
		t.Fatalf("formula overlay target_key=%v ok=%v want %v", got, ok, targetKeyDef+1)
	}
	if _, leaked := overlay["provider_only"]; leaked {
		t.Fatalf("provider_only must not leak into formula overlay: %+v", overlay)
	}
	if len(overlay) != 1 {
		t.Fatalf("formula overlay keys=%d want 1 (only touched target_key): %+v", len(overlay), overlay)
	}

	// Expiry of the touched key restores its defaultValue; still no provider_only leak.
	bag.refreshTargetExpireAtOnWrite("target_key", 0)
	bag.lazyExpireProviderTargetState(1000)
	if bag.targetValues["target_key"] != targetKeyDef {
		t.Fatalf("after expire target_key=%v want default %v", bag.targetValues["target_key"], targetKeyDef)
	}
	overlay = bag.targetStateForFormula()
	if got, ok := overlay["target_key"]; !ok || got != targetKeyDef {
		t.Fatalf("after expire formula overlay target_key=%v ok=%v want %v", got, ok, targetKeyDef)
	}
	if _, leaked := overlay["provider_only"]; leaked {
		t.Fatalf("after expire provider_only must not leak into formula overlay: %+v", overlay)
	}
	if bag.state["provider_only"] != providerOnlyDef {
		t.Fatalf("provider-scope state must stay untouched: provider_only=%v want %v", bag.state["provider_only"], providerOnlyDef)
	}
}
