package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_draven Q Spinning Axe / 旋转飞斧 (generic ABI, rank-5 initial axe only).
// Q active cast → ability_started arms source-owner provider timed state
// spinning_axe_ready=1 (max1, durationMs=5800, refresh_on_write); first
// source-owner basic_attack_hit deals physical raw =
// 60 + 1.15*(event.entry_source.attr.ad.resolved - event.entry_source.attr.ad.base),
// copyable_on_hit=false, then consumes ready.
// Non-goals: catch rearm, dual-axe cap, 45 mana, 8s CD, other ranks,
// landing movement, W/E/R.

const (
	dravenSpinningAxeProviderRef = "hero:draven_spinning_axe"
	dravenSpinningAxeDamageOpRef = "op:draven_spinning_axe_damage"
	dravenSpinningAxeListenerArm = "listener_hero_draven_spinning_axe_arm"
	dravenSpinningAxeListenerHit = "listener_hero_draven_spinning_axe_hit"
	dravenSpinningAxeReadyKey    = "spinning_axe_ready"
	dravenSpinningAxeQKey        = "spinning_axe"
	dravenSpinningAxeChampionRef = spellbladeChampionRef
	dravenSpinningAxeHitAbility  = spellbladeHitAbilityKey
	dravenSpinningAxeCastEvent   = spellbladeCastEvent
	dravenSpinningAxeHitEvent    = spellbladeHitEvent

	dravenLevel1HP         = 675.0
	dravenLevel1Mana       = 361.0
	dravenLevel1AD         = 62.0
	dravenLevel1AS         = 0.679
	dravenLevel1Armor      = 29.0
	dravenLevel1MR         = 30.0
	dravenLevel1HPRegen    = 3.75
	dravenLevel1ManaRegen  = 8.05
	dravenSpinningAxeADRes = 162.0
	dravenSpinningAxeArmor = 100.0
	dravenSpinningAxeAA    = 10.0
	dravenSpinningAxeFlat  = 60.0
	dravenSpinningAxeRatio = 1.15
	dravenSpinningAxeReady = 5800
)

func dravenSpinningAxeExpectedRaw(resolvedAD, baseAD float64) float64 {
	return dravenSpinningAxeFlat + dravenSpinningAxeRatio*(resolvedAD-baseAD)
}

func dravenSpinningAxeExpectedMitigated(resolvedAD, baseAD, armor float64) float64 {
	return expectedMitigatedPhysical(dravenSpinningAxeExpectedRaw(resolvedAD, baseAD), armor)
}

func dravenSpinningAxeReadyArmedCond() *model.GenericFormulaExpr {
	one := 1.0
	return &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + dravenSpinningAxeReadyKey},
			{Op: "const", Value: &one},
		},
	}
}

func dravenSpinningAxeStateSchema() map[string]interface{} {
	return map[string]interface{}{
		dravenSpinningAxeReadyKey: map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(1),
			"durationMs":    float64(dravenSpinningAxeReady),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
}

func dravenSpinningAxeProcAmount() *model.GenericFormulaExpr {
	flat := dravenSpinningAxeFlat
	ratio := dravenSpinningAxeRatio
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &flat},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &ratio},
					{
						Op: "sub",
						Args: []model.GenericFormulaExpr{
							{Op: "read", Path: "event.entry_source.attr.ad.resolved"},
							{Op: "read", Path: "event.entry_source.attr.ad.base"},
						},
					},
				},
			},
		},
	}
}

func dravenSpinningAxeCastArmListener() model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey:  dravenSpinningAxeListenerArm,
		EventMatcher: model.TypeMatcher{All: []string{dravenSpinningAxeCastEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         dravenSpinningAxeReadyKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		},
	}
}

func dravenSpinningAxeHitConsumeListener() model.ListenerDefinition {
	zero := 0.0
	readyCond := dravenSpinningAxeReadyArmedCond()
	return model.ListenerDefinition{
		ListenerKey:  dravenSpinningAxeListenerHit,
		EventMatcher: model.TypeMatcher{All: []string{dravenSpinningAxeHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           dravenSpinningAxeDamageOpRef,
				CopyableOnHit: false,
				Condition:     readyCond,
				Amount:        dravenSpinningAxeProcAmount(),
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         dravenSpinningAxeReadyKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Condition:   readyCond,
			},
		},
	}
}

func dravenSpinningAxeAAOps() []model.OperationDefinition {
	aa := dravenSpinningAxeAA
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
			EventType: dravenSpinningAxeHitEvent,
			Ref:       dravenSpinningAxeHitEvent,
		},
	}
}

func dravenSpinningAxeAAOpsWithGuinsooStack() []model.OperationDefinition {
	aa := dravenSpinningAxeAA
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
			EventType: dravenSpinningAxeHitEvent,
			Ref:       dravenSpinningAxeHitEvent,
		},
	}
}

func ensureDravenSpinningAxeTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
}

func mountDravenSpinningAxeProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        dravenSpinningAxeProviderRef,
		Kind:               "passive",
		StableID:           "hero_draven_q_spinning_axe",
		InitialStateSchema: dravenSpinningAxeStateSchema(),
		Listeners: []model.ListenerDefinition{
			dravenSpinningAxeCastArmListener(),
			dravenSpinningAxeHitConsumeListener(),
		},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: dravenSpinningAxeProviderRef, DefinitionRef: dravenSpinningAxeProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: dravenSpinningAxeProviderRef, DefinitionRef: dravenSpinningAxeProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func configureDravenSpinningAxeChampionAbilities(compileReq *model.CompileRequest) {
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: dravenSpinningAxeQKey,
			Kind:       "active",
			Types:      []string{},
			Operations: []model.OperationDefinition{},
		},
		{
			AbilityKey: dravenSpinningAxeHitAbility,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Operations: dravenSpinningAxeAAOps(),
		},
	}
	bonusAD := dravenSpinningAxeADRes - dravenLevel1AD
	compileReq.SharedProviders[0].Modifiers = append(compileReq.SharedProviders[0].Modifiers, model.ModifierDefinition{
		ModifierKey: "fixture_draven_bonus_ad",
		Kind:        "attribute",
		Target:      "ad",
		ValuePolicy: "add",
		Value:       gfConst(bonusAD),
	})
}

func dravenQRef() string {
	return "source.provider[" + dravenSpinningAxeChampionRef + "].ability[" + dravenSpinningAxeQKey + "]"
}

func dravenAARef() string {
	return "source.provider[" + dravenSpinningAxeChampionRef + "].ability[" + dravenSpinningAxeHitAbility + "]"
}

func loadDravenSpinningAxeFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureDravenSpinningAxeTypes(&compileReq)
	configureDravenSpinningAxeChampionAbilities(&compileReq)
	mountDravenSpinningAxeProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
		Base: dravenLevel1HP, Current: dravenLevel1HP, Max: dravenLevel1HP, Resolved: dravenLevel1HP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "mana", model.AttributeSlotDef{
		Base: dravenLevel1Mana, Current: dravenLevel1Mana, Max: dravenLevel1Mana, Resolved: dravenLevel1Mana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: dravenLevel1AD, Current: dravenLevel1AD, Max: dravenLevel1AD, Resolved: dravenLevel1AD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: dravenLevel1AS, Current: dravenLevel1AS, Max: dravenLevel1AS, Resolved: dravenLevel1AS,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor", model.AttributeSlotDef{
		Base: dravenLevel1Armor, Current: dravenLevel1Armor, Max: dravenLevel1Armor, Resolved: dravenLevel1Armor,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "magic_resist", model.AttributeSlotDef{
		Base: dravenLevel1MR, Current: dravenLevel1MR, Max: dravenLevel1MR, Resolved: dravenLevel1MR,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp_regen", model.AttributeSlotDef{
		Base: dravenLevel1HPRegen, Current: dravenLevel1HPRegen, Max: dravenLevel1HPRegen, Resolved: dravenLevel1HPRegen,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "mana_regen", model.AttributeSlotDef{
		Base: dravenLevel1ManaRegen, Current: dravenLevel1ManaRegen, Max: dravenLevel1ManaRegen, Resolved: dravenLevel1ManaRegen,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: dravenSpinningAxeArmor, Current: dravenSpinningAxeArmor, Max: dravenSpinningAxeArmor, Resolved: dravenSpinningAxeArmor,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runDravenSpinningAxe(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func dravenSpinningAxeStateValue(t *testing.T, done model.DoneResult, key string) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[dravenSpinningAxeProviderRef].(map[string]interface{})
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
	t.Fatal("source combatant missing")
	return 0
}

func assertDravenSpinningAxeSchema(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	var schema map[string]interface{}
	for _, p := range compileReq.SharedProviders {
		if p.ProviderKey == dravenSpinningAxeProviderRef {
			schema = p.InitialStateSchema
			break
		}
	}
	if schema == nil {
		t.Fatal("draven spinning axe provider schema missing")
	}
	ready, ok := schema[dravenSpinningAxeReadyKey].(map[string]interface{})
	if !ok {
		t.Fatalf("spinning_axe_ready schema missing: %+v", schema)
	}
	if got, _ := ready["maxValue"].(float64); got != 1 {
		t.Fatalf("maxValue=%v want 1", got)
	}
	if got, _ := ready["durationMs"].(float64); got != float64(dravenSpinningAxeReady) {
		t.Fatalf("durationMs=%v want %d", got, dravenSpinningAxeReady)
	}
	if got, _ := ready["refreshPolicy"].(string); got != model.ProviderStateRefreshOnWrite {
		t.Fatalf("refreshPolicy=%q want %q", got, model.ProviderStateRefreshOnWrite)
	}
}

func assertDravenLevel1BaseAttrs(t *testing.T, done model.DoneResult) {
	t.Helper()
	checks := []struct {
		attr string
		want float64
	}{
		{"hp", dravenLevel1HP},
		{"mana", dravenLevel1Mana},
		{"attack_speed", dravenLevel1AS},
		{"armor", dravenLevel1Armor},
		{"magic_resist", dravenLevel1MR},
		{"hp_regen", dravenLevel1HPRegen},
		{"mana_regen", dravenLevel1ManaRegen},
	}
	for _, c := range checks {
		if got := sourceAttrResolved(t, done.FinalSnapshot, c.attr); math.Abs(got-c.want) > 1e-9 {
			t.Fatalf("%s.resolved=%v want level1 %v", c.attr, got, c.want)
		}
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ad"); math.Abs(got-dravenSpinningAxeADRes) > 1e-9 {
		t.Fatalf("ad.resolved=%v want %v (base %v + fixture bonus)", got, dravenSpinningAxeADRes, dravenLevel1AD)
	}
}

// TestDravenSpinningAxeFormulaCrossCheck: AD162/base62 @ armor100 → raw175 / mitigated87.5.
func TestDravenSpinningAxeFormulaCrossCheck(t *testing.T) {
	raw := dravenSpinningAxeExpectedRaw(dravenSpinningAxeADRes, dravenLevel1AD)
	if math.Abs(raw-175) > 1e-9 {
		t.Fatalf("raw=%v want 175", raw)
	}
	mitigated := dravenSpinningAxeExpectedMitigated(dravenSpinningAxeADRes, dravenLevel1AD, dravenSpinningAxeArmor)
	if math.Abs(mitigated-87.5) > 1e-9 {
		t.Fatalf("mitigated=%v want 87.5", mitigated)
	}
	rawBaseOnly := dravenSpinningAxeExpectedRaw(dravenLevel1AD, dravenLevel1AD)
	if math.Abs(rawBaseOnly-60) > 1e-9 {
		t.Fatalf("rawBaseOnly=%v want 60", rawBaseOnly)
	}
}

// TestDravenSpinningAxeCompileRunRank5InitialAxe: Q cast arms ready; first AA procs once
// then consumes; second AA no proc; physical/copyable/owner/schema asserted.
func TestDravenSpinningAxeCompileRunRank5InitialAxe(t *testing.T) {
	compileReq, runReq := loadDravenSpinningAxeFixture(t)
	assertDravenSpinningAxeSchema(t, compileReq)

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q", AbilityRef: dravenQRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa1", AbilityRef: dravenAARef(), Source: "source", Target: "target", FirstAtMs: 100},
		{EntryKey: "aa2", AbilityRef: dravenAARef(), Source: "source", Target: "target", FirstAtMs: 200},
	}
	runReq.StopPolicy.DurationMs = 300
	done := runDravenSpinningAxe(t, compileReq, runReq)

	assertDravenLevel1BaseAttrs(t, done)

	if countEmittedEvents(done, dravenSpinningAxeCastEvent) != 1 {
		t.Fatalf("ability_started count=%d want 1 (Q only; AA must not arm)", countEmittedEvents(done, dravenSpinningAxeCastEvent))
	}
	if countEmittedEvents(done, dravenSpinningAxeHitEvent) != 2 {
		t.Fatalf("basic_attack_hit emits=%d want 2", countEmittedEvents(done, dravenSpinningAxeHitEvent))
	}

	wantRaw := dravenSpinningAxeExpectedRaw(dravenSpinningAxeADRes, dravenLevel1AD)
	wantMitigated := dravenSpinningAxeExpectedMitigated(dravenSpinningAxeADRes, dravenLevel1AD, dravenSpinningAxeArmor)
	if math.Abs(wantRaw-175) > 1e-9 || math.Abs(wantMitigated-87.5) > 1e-9 {
		t.Fatalf("fixture expectations drifted: raw=%v mitigated=%v", wantRaw, wantMitigated)
	}
	if countDamageByOpRef(done, dravenSpinningAxeDamageOpRef, false) != 1 {
		t.Fatalf("spinning axe proc count=%d want 1 (first AA only)", countDamageByOpRef(done, dravenSpinningAxeDamageOpRef, false))
	}
	if got := sumDamageRawByOpRef(done, dravenSpinningAxeDamageOpRef); math.Abs(got-wantRaw) > 1e-6 {
		t.Fatalf("proc raw=%v want %v", got, wantRaw)
	}
	if got := sumDamageMitigatedByOpRef(done, dravenSpinningAxeDamageOpRef); math.Abs(got-wantMitigated) > 1e-6 {
		t.Fatalf("proc mitigated=%v want %v", got, wantMitigated)
	}

	item := firstDamageEvidenceByOpRef(done, dravenSpinningAxeDamageOpRef)
	if item == nil {
		t.Fatal("missing spinning axe damage evidence")
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q want damage/physical", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataBool(item.Data, "phantom") {
		t.Fatal("original proc must not be phantom")
	}

	if got := dravenSpinningAxeStateValue(t, done, dravenSpinningAxeReadyKey); got != 0 {
		t.Fatalf("spinning_axe_ready=%v want 0 after consume", got)
	}

	aaMitigated := expectedMitigatedPhysical(dravenSpinningAxeAA, dravenSpinningAxeArmor)
	wantDealt := 2*aaMitigated + wantMitigated
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
}

// TestDravenSpinningAxeQCastArmsReadyOnly: successful Q cast arms ready without proc.
func TestDravenSpinningAxeQCastArmsReadyOnly(t *testing.T) {
	compileReq, runReq := loadDravenSpinningAxeFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q", AbilityRef: dravenQRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runDravenSpinningAxe(t, compileReq, runReq)
	if countEmittedEvents(done, dravenSpinningAxeCastEvent) != 1 {
		t.Fatalf("ability_started count=%d want 1", countEmittedEvents(done, dravenSpinningAxeCastEvent))
	}
	if got := dravenSpinningAxeStateValue(t, done, dravenSpinningAxeReadyKey); got != 1 {
		t.Fatalf("spinning_axe_ready=%v want 1 after Q cast", got)
	}
	if countDamageByOpRef(done, dravenSpinningAxeDamageOpRef, false) != 0 {
		t.Fatalf("proc count=%d want 0 before AA", countDamageByOpRef(done, dravenSpinningAxeDamageOpRef, false))
	}
}

// TestDravenSpinningAxeBasicAttackDoesNotEmitAbilityStarted: AA alone never arms.
func TestDravenSpinningAxeBasicAttackDoesNotEmitAbilityStarted(t *testing.T) {
	compileReq, runReq := loadDravenSpinningAxeFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: dravenAARef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runDravenSpinningAxe(t, compileReq, runReq)
	if countEmittedEvents(done, dravenSpinningAxeCastEvent) != 0 {
		t.Fatalf("ability_started count=%d want 0 for basic_attack", countEmittedEvents(done, dravenSpinningAxeCastEvent))
	}
	if got := dravenSpinningAxeStateValue(t, done, dravenSpinningAxeReadyKey); got != 0 {
		t.Fatalf("spinning_axe_ready=%v want 0", got)
	}
	if countDamageByOpRef(done, dravenSpinningAxeDamageOpRef, false) != 0 {
		t.Fatalf("proc count=%d want 0 without Q arm", countDamageByOpRef(done, dravenSpinningAxeDamageOpRef, false))
	}
}

// TestDravenSpinningAxeReadyExpiresAt5800: attack at exactly 5800ms after arm does not proc.
func TestDravenSpinningAxeReadyExpiresAt5800(t *testing.T) {
	compileReq, runReq := loadDravenSpinningAxeFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q", AbilityRef: dravenQRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: dravenAARef(), Source: "source", Target: "target", FirstAtMs: int64(dravenSpinningAxeReady)},
	}
	runReq.StopPolicy.DurationMs = int64(dravenSpinningAxeReady) + 50
	done := runDravenSpinningAxe(t, compileReq, runReq)
	if countDamageByOpRef(done, dravenSpinningAxeDamageOpRef, false) != 0 {
		t.Fatalf("proc after ready expiry=%d want 0", countDamageByOpRef(done, dravenSpinningAxeDamageOpRef, false))
	}
	if got := dravenSpinningAxeStateValue(t, done, dravenSpinningAxeReadyKey); got != 0 {
		t.Fatalf("spinning_axe_ready=%v want 0 after expiry", got)
	}
}

// TestDravenSpinningAxePhantomDoesNotCopy: copyable_on_hit=false; Guinsoo phantom skips axe.
func TestDravenSpinningAxePhantomDoesNotCopy(t *testing.T) {
	compileReq, runReq := loadDravenSpinningAxeFixture(t)
	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[1].Operations = dravenSpinningAxeAAOpsWithGuinsooStack()
	copyableAmt := 30.0
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "guinsoo_copyable",
			EventMatcher: model.TypeMatcher{All: []string{dravenSpinningAxeHitEvent, "event/source_owner"}},
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
			EventMatcher: model.TypeMatcher{All: []string{dravenSpinningAxeHitEvent, "event/source_owner"}},
			Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
		},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			dravenSpinningAxeChampionRef: map[string]interface{}{
				"state": map[string]interface{}{guinsooStackKey: float64(3)},
			},
		}
	}
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q", AbilityRef: dravenQRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: dravenAARef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runDravenSpinningAxe(t, compileReq, runReq)

	if countDamageByOpRef(done, dravenSpinningAxeDamageOpRef, false) != 1 {
		t.Fatalf("original spinning axe count=%d want 1", countDamageByOpRef(done, dravenSpinningAxeDamageOpRef, false))
	}
	if countDamageByOpRef(done, dravenSpinningAxeDamageOpRef, true) != 0 {
		t.Fatalf("phantom spinning axe count=%d want 0 (copyable=false)", countDamageByOpRef(done, dravenSpinningAxeDamageOpRef, true))
	}
	if got := dravenSpinningAxeStateValue(t, done, dravenSpinningAxeReadyKey); got != 0 {
		t.Fatalf("spinning_axe_ready=%v want 0 (consumed once by real hit)", got)
	}
	if countDamageByOpRef(done, "op:guinsoo_copyable", true) != 1 {
		t.Fatalf("phantom guinsoo copyable count=%d want 1", countDamageByOpRef(done, "op:guinsoo_copyable", true))
	}
}
