package runtime

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func loadBasicFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture.CompileRequest, fixture.RunRequest
}

func TestGenericRunMissingExpectedRulesHash(t *testing.T) {
	session, compiled := compileBasicDamageSession(t)
	runReq := loadBasicDamageRunRequest(t)
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = ""
	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != -1 {
		t.Fatalf("RunJSON code=%d want -1", code)
	}
	errPayload := lastGenericError(session.OutboxBytes())
	if errPayload.Code != model.GenericErrMissingRequiredField {
		t.Fatalf("code=%q want missing_required_field", errPayload.Code)
	}
}

func TestGenericRunMissingInitialSnapshotSchemaHash(t *testing.T) {
	session, compiled := compileBasicDamageSession(t)
	runReq := loadBasicDamageRunRequest(t)
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	runReq.InitialSnapshot.SchemaHash = ""
	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != -1 {
		t.Fatalf("RunJSON code=%d want -1", code)
	}
	errPayload := lastGenericError(session.OutboxBytes())
	if errPayload.Code != model.GenericErrMissingRequiredField {
		t.Fatalf("code=%q want missing_required_field", errPayload.Code)
	}
}

func TestGenericRunMissingInitialSnapshotRulesHash(t *testing.T) {
	session, compiled := compileBasicDamageSession(t)
	runReq := loadBasicDamageRunRequest(t)
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	runReq.InitialSnapshot.RulesHash = ""
	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != -1 {
		t.Fatalf("RunJSON code=%d want -1", code)
	}
	errPayload := lastGenericError(session.OutboxBytes())
	if errPayload.Code != model.GenericErrMissingRequiredField {
		t.Fatalf("code=%q want missing_required_field", errPayload.Code)
	}
}

func TestGenericRunSelfOpponentAbilityRef(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	// Mount the same provider on target so opponent.provider[...] can resolve.
	compileReq.Combatants[1].Providers = []model.CombatantProviderMount{
		{ProviderRef: "champion:source_demo", DefinitionRef: "champion:source_demo"},
	}
	runReq.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{
		{ProviderRef: "champion:source_demo", DefinitionRef: "champion:source_demo", Stacks: 1},
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	runReq.DriverPlan.Entries[0].AbilityRef = "self.provider[champion:source_demo].ability[basic_attack]"
	done, runErr := RunGeneric(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1 for self.provider ref", done.Summary.AbilityCastCount)
	}
	if done.Summary.TargetFinalHp != 900 {
		t.Fatalf("targetFinalHp=%v want 900", done.Summary.TargetFinalHp)
	}

	runReq.DriverPlan.Entries[0].AbilityRef = "opponent.provider[champion:source_demo].ability[basic_attack]"
	runReq.DriverPlan.Entries[0].Source = "source"
	runReq.DriverPlan.Entries[0].Target = "target"
	done2, runErr := RunGeneric(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if done2.Summary.AbilityCastCount != 1 {
		t.Fatalf("opponent castCount=%d want 1", done2.Summary.AbilityCastCount)
	}
}

func TestGenericRunAbilityStatsAccumulateAcrossCasts(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatal("compile failed")
	}
	abilityRef := runReq.DriverPlan.Entries[0].AbilityRef
	runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{IntervalMs: 50, MaxAttempts: 3}
	runReq.StopPolicy.DurationMs = 200
	done, runErr := RunGeneric(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if done.Summary.AbilityCastCount != 3 {
		t.Fatalf("castCount=%d want 3", done.Summary.AbilityCastCount)
	}
	var found bool
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef != abilityRef {
			continue
		}
		found = true
		if st.DamageDealt == nil || *st.DamageDealt != 300 {
			t.Fatalf("damageDealt=%v want 300 (sum of 3 casts)", st.DamageDealt)
		}
	}
	if !found {
		t.Fatal("missing abilityStats row")
	}
}

func TestGenericRunFinalSnapshotStableShapeMarshaled(t *testing.T) {
	done, _ := compileAndRunBasicDamage(t)
	raw, err := json.Marshal(done)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	finalSnap, ok := decoded["finalSnapshot"].(map[string]interface{})
	if !ok {
		t.Fatal("finalSnapshot missing")
	}
	combatants, ok := finalSnap["combatants"].([]interface{})
	if !ok || len(combatants) != 2 {
		t.Fatalf("combatants=%v", combatants)
	}
	required := []string{"cooldowns", "providers", "shields", "abilityState", "providerState", "vars"}
	for _, c := range combatants {
		cm, ok := c.(map[string]interface{})
		if !ok {
			t.Fatal("combatant not object")
		}
		for _, key := range required {
			if _, exists := cm[key]; !exists {
				t.Fatalf("combatant %v missing key %q", cm["key"], key)
			}
		}
		attrs, ok := cm["attributes"].(map[string]interface{})
		if !ok || len(attrs) == 0 {
			t.Fatalf("attributes missing for %v", cm["key"])
		}
		for attrKey, slot := range attrs {
			sm, ok := slot.(map[string]interface{})
			if !ok {
				t.Fatalf("attr %s not object", attrKey)
			}
			if _, exists := sm["resolved"]; !exists {
				t.Fatalf("attr %s missing resolved", attrKey)
			}
		}
	}
}

func TestGenericRunRulesModifiersAffectResolved(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	add := 40.0
	compileReq.Rules.Modifiers = []model.ModifierDefinition{
		{
			ModifierKey: "global_ad",
			Kind:        "attribute",
			Target:      "source.attr.attack_damage",
			Bucket:      "flat",
			ValuePolicy: "add",
			Value:       model.GenericFormulaExpr{Op: "const", Value: &add},
		},
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	if len(result.Session.RuleModifiers) != 1 {
		t.Fatalf("RuleModifiers=%d want 1", len(result.Session.RuleModifiers))
	}
	done, runErr := RunGeneric(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	var source map[string]model.AttributeSlotDef
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key == model.SelectorSource {
			source = c.Attributes
		}
	}
	slot, ok := source["attack_damage"]
	if !ok {
		t.Fatal("missing attack_damage")
	}
	if slot.Resolved != 140 {
		t.Fatalf("resolved=%v want 140 (100+40 rules modifier)", slot.Resolved)
	}
}

func TestGenericRunProviderListenerOnEmitEvent(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/test_hit", Domain: "event"})
	dmg := 15.0
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "on_test_hit",
			EventMatcher: model.TypeMatcher{Any: []string{"event/test_hit"}},
			Operations: []model.OperationDefinition{
				{
					Operation:  "damage",
					Target:     "target",
					Amount:     &model.GenericFormulaExpr{Op: "const", Value: &dmg},
					DamageType: "damage/physical",
				},
			},
		},
	}
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: "event/test_hit",
			Ref:       "event/test_hit",
		},
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, runErr := RunGeneric(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if done.Summary.TargetFinalHp != 985 {
		t.Fatalf("targetFinalHp=%v want 985 (listener damage 15)", done.Summary.TargetFinalHp)
	}
	foundEmit := false
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindEmittedEvent {
			foundEmit = true
		}
	}
	if !foundEmit {
		t.Fatal("missing emitted_event evidence")
	}
}

func TestGenericRunInlineListenerSpecPassive(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/passive_proc", Domain: "event"})
	heal := 20.0
	compileReq.SharedProviders[0].Abilities = append(compileReq.SharedProviders[0].Abilities, model.AbilityDefinition{
		AbilityKey: "on_passive",
		Kind:       "passive_listener",
		ListenerSpec: &model.ListenerDefinition{
			ListenerKey:  "passive_proc",
			EventMatcher: model.TypeMatcher{Any: []string{"event/passive_proc"}},
		},
		Operations: []model.OperationDefinition{
			{
				Operation: "heal",
				Target:    "source",
				Amount:    &model.GenericFormulaExpr{Op: "const", Value: &heal},
			},
		},
	})
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation: "emit_event",
			Target:    "source",
			EventType: "event/passive_proc",
			Ref:       "event/passive_proc",
		},
	}
	// Give source an hp slot so heal is observable.
	compileReq.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{Base: 500, Current: 500, Max: 1000, Resolved: 500}
	runReq.InitialSnapshot.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{Base: 500, Current: 500, Max: 1000, Resolved: 500}

	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, runErr := RunGeneric(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if done.Summary.SourceFinalHp != 520 {
		t.Fatalf("sourceFinalHp=%v want 520 (passive heal 20)", done.Summary.SourceFinalHp)
	}
}

func TestGenericRunListenerUnmatchedEventDoesNotFire(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "event/test_hit", Domain: "event"},
		model.TypeCatalogEntry{Key: "event/other", Domain: "event"},
	)
	dmg := 50.0
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "on_other",
			EventMatcher: model.TypeMatcher{Any: []string{"event/other"}},
			Operations: []model.OperationDefinition{
				{
					Operation:  "damage",
					Target:     "target",
					Amount:     &model.GenericFormulaExpr{Op: "const", Value: &dmg},
					DamageType: "damage/physical",
				},
			},
		},
	}
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: "event/test_hit",
			Ref:       "event/test_hit",
		},
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, runErr := RunGeneric(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if done.Summary.TargetFinalHp != 1000 {
		t.Fatalf("targetFinalHp=%v want 1000 (unmatched listener must not fire)", done.Summary.TargetFinalHp)
	}
}

func TestGenericRunProviderListenerAbilityRefChildDispatch(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/child_proc", Domain: "event"})
	childDmg := 25.0
	compileReq.SharedProviders[0].Abilities = append(compileReq.SharedProviders[0].Abilities, model.AbilityDefinition{
		AbilityKey: "child_burst",
		Kind:       "active",
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &childDmg},
				DamageType: "damage/physical",
			},
		},
	})
	childRef := "source.provider[champion:source_demo].ability[child_burst]"
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "on_child_proc",
			EventMatcher: model.TypeMatcher{Any: []string{"event/child_proc"}},
			AbilityRef:   childRef,
		},
	}
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: "event/child_proc",
			Ref:       "event/child_proc",
		},
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, runErr := RunGeneric(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if done.Summary.TargetFinalHp != 975 {
		t.Fatalf("targetFinalHp=%v want 975 (child ability damage 25)", done.Summary.TargetFinalHp)
	}
	var childStat *model.AbilityStat
	for i := range done.Summary.AbilityStats {
		if done.Summary.AbilityStats[i].AbilityRef == childRef {
			childStat = &done.Summary.AbilityStats[i]
			break
		}
	}
	if childStat == nil {
		t.Fatalf("missing abilityStats for child %s: %+v", childRef, done.Summary.AbilityStats)
	}
	if childStat.CastCount != 1 {
		t.Fatalf("child castCount=%d want 1", childStat.CastCount)
	}
	if childStat.DamageDealt == nil || *childStat.DamageDealt != 25 {
		t.Fatalf("child damageDealt=%v want 25", childStat.DamageDealt)
	}
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindListenerSkipped {
			t.Fatalf("unexpected listener_skipped for supported child ability: %+v", item)
		}
	}
}

func TestGenericRunListenerAbilityRefMaxChainDepth(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/recurse", Domain: "event"})
	compileReq.SharedProviders[0].Abilities = append(compileReq.SharedProviders[0].Abilities, model.AbilityDefinition{
		AbilityKey: "recurse_child",
		Kind:       "active",
		Operations: []model.OperationDefinition{
			{
				Operation: "emit_event",
				Target:    "target",
				EventType: "event/recurse",
				Ref:       "event/recurse",
			},
		},
	})
	childRef := "source.provider[champion:source_demo].ability[recurse_child]"
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "on_recurse",
			EventMatcher: model.TypeMatcher{Any: []string{"event/recurse"}},
			AbilityRef:   childRef,
		},
	}
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: "event/recurse",
			Ref:       "event/recurse",
		},
	}
	runReq.SafetyBudget = &model.RunSafetyBudget{MaxChainDepth: 1}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	_, runErr := RunGeneric(result.Session, runReq)
	if runErr == nil {
		t.Fatal("expected max chain depth error")
	}
	if runErr.Code != model.GenericErrRuntimeInvariantFailed {
		t.Fatalf("code=%q want runtime_invariant_failed", runErr.Code)
	}
	if runErr.Message != "max chain depth exceeded" {
		t.Fatalf("message=%q want max chain depth exceeded", runErr.Message)
	}
}

func TestGenericRunFinalSnapshotNestedProviderShieldCooldown(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	// Initial provider without source/owner; persistent expire omitted.
	runReq.InitialSnapshot.Combatants[0].Providers = []model.CombatantProviderSnapshot{
		{ProviderRef: "champion:source_demo", DefinitionRef: "champion:source_demo", Stacks: 1},
	}
	shieldAmt := 40.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation: "shield",
			Target:    "source",
			Amount:    &model.GenericFormulaExpr{Op: "const", Value: &shieldAmt},
			ShieldRef: "shield:persist",
		},
		{
			Operation:  "damage",
			Target:     "target",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: floatPtr(10)},
			DamageType: "damage/physical",
		},
	}
	cdMs := 500.0
	compileReq.SharedProviders[0].Abilities[0].Cooldown = &model.AbilityCooldown{
		DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cdMs},
		StartsOn:   "cast",
	}
	runReq.StopPolicy.DurationMs = 100
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, runErr := RunGeneric(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	raw, err := json.Marshal(done.FinalSnapshot)
	if err != nil {
		t.Fatal(err)
	}
	var snap map[string]interface{}
	if err := json.Unmarshal(raw, &snap); err != nil {
		t.Fatal(err)
	}
	combatants, _ := snap["combatants"].([]interface{})
	var source map[string]interface{}
	for _, c := range combatants {
		cm := c.(map[string]interface{})
		if cm["key"] == "source" {
			source = cm
			break
		}
	}
	if source == nil {
		t.Fatal("source combatant missing")
	}
	providers, _ := source["providers"].([]interface{})
	if len(providers) == 0 {
		t.Fatal("expected provider entries")
	}
	prov := providers[0].(map[string]interface{})
	for _, key := range []string{"providerRef", "definitionRef", "source", "owner", "stacks", "expireAt", "state"} {
		if _, ok := prov[key]; !ok {
			t.Fatalf("provider missing %s: %+v", key, prov)
		}
	}
	if prov["source"] != "source" || prov["owner"] != "source" {
		t.Fatalf("provider source/owner=%v/%v want source/source", prov["source"], prov["owner"])
	}
	if prov["expireAt"] != nil {
		t.Fatalf("persistent provider expireAt=%v want null", prov["expireAt"])
	}
	shields, _ := source["shields"].([]interface{})
	if len(shields) == 0 {
		t.Fatal("expected shield entries")
	}
	sh := shields[0].(map[string]interface{})
	for _, key := range []string{"shieldRef", "source", "owner", "remaining", "priority", "expireAt", "state"} {
		if _, ok := sh[key]; !ok {
			t.Fatalf("shield missing %s: %+v", key, sh)
		}
	}
	if sh["source"] != "source" || sh["owner"] != "source" {
		t.Fatalf("shield source/owner=%v/%v", sh["source"], sh["owner"])
	}
	if sh["expireAt"] != nil {
		t.Fatalf("persistent shield expireAt=%v want null", sh["expireAt"])
	}
	abilityRef := runReq.DriverPlan.Entries[0].AbilityRef
	cds, _ := source["cooldowns"].(map[string]interface{})
	cd, ok := cds[abilityRef].(map[string]interface{})
	if !ok {
		t.Fatalf("cooldown missing for %s: %+v", abilityRef, cds)
	}
	if _, ok := cd["readyAtMs"]; !ok {
		t.Fatalf("cooldown missing readyAtMs: %+v", cd)
	}
	if _, ok := cd["remainingMs"]; !ok {
		t.Fatalf("cooldown missing remainingMs: %+v", cd)
	}
}

func TestNormalizeAbilityRef(t *testing.T) {
	got := normalizeAbilityRef("self.provider[champion:source_demo].ability[basic_attack]", "source", "target")
	want := "source.provider[champion:source_demo].ability[basic_attack]"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	got = normalizeAbilityRef("opponent.provider[champion:source_demo].ability[basic_attack]", "source", "target")
	want = "target.provider[champion:source_demo].ability[basic_attack]"
	if got != want {
		t.Fatalf("opponent from source got %q want %q", got, want)
	}
	got = normalizeAbilityRef("opponent.provider[champion:source_demo].ability[basic_attack]", "target", "source")
	want = "source.provider[champion:source_demo].ability[basic_attack]"
	if got != want {
		t.Fatalf("opponent from target got %q want %q", got, want)
	}
}
