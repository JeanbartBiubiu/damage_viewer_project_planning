package runtime

import (
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_draven Q Spinning Axe / 旋转飞斧 (generic ABI, Backend simplified Q).
//
// Contract:
//   - Main provider state spinning_axe_ready: max 2, duration 5800ms,
//     refresh_on_write (refresh_duration); absent initial → 0.
//   - Q active: 45 mana, 8000ms cooldown. Successful cast → ability_started;
//     owner listener adds 1 only while ready < 2.
//   - source-owner basic_attack_hit when ready >= 1:
//     1) bonus physical 60 + 1.15*(ad.resolved - ad.base);
//     2) apply transient flight provider (unique ref);
//     3) consume exactly 1 ready.
//   - Flight: duration 1401ms; tick interval/startDelay 1400ms; tick emits axe_caught.
//   - Owner axe_caught listener adds 1 ready only while < 2.
//
// Non-goals: landing/movement/path, W cooldown reset, other ranks.

const (
	dravenSpinningAxeProviderRef  = "hero:draven_spinning_axe"
	dravenSpinningAxeFlightRef    = "hero:draven_axe_flight"
	dravenSpinningAxeDamageOpRef  = "op:draven_spinning_axe_damage"
	dravenSpinningAxeListenerArm  = "listener_hero_draven_spinning_axe_arm"
	dravenSpinningAxeListenerHit  = "listener_hero_draven_spinning_axe_hit"
	dravenSpinningAxeListenerCatch = "listener_hero_draven_spinning_axe_catch"
	dravenSpinningAxeReadyKey     = "spinning_axe_ready"
	dravenSpinningAxeQKey         = "spinning_axe"
	dravenSpinningAxeFlightTick   = "axe_flight_tick"
	dravenSpinningAxeChampionRef  = spellbladeChampionRef
	dravenSpinningAxeHitAbility   = spellbladeHitAbilityKey
	dravenSpinningAxeCastEvent    = spellbladeCastEvent
	dravenSpinningAxeHitEvent     = spellbladeHitEvent
	dravenSpinningAxeCaughtEvent  = "event/axe_caught"

	dravenLevel1HP        = 675.0
	dravenLevel1Mana      = 361.0
	dravenLevel1AS        = 0.679
	dravenLevel1Armor     = 29.0
	dravenLevel1MR        = 30.0
	dravenLevel1HPRegen   = 3.75
	dravenLevel1ManaRegen = 8.05

	dravenSpinningAxeADBase = 60.0
	dravenSpinningAxeADRes  = 100.0
	dravenSpinningAxeArmor  = 0.0
	dravenSpinningAxeAA     = 10.0
	dravenSpinningAxeFlat   = 60.0
	dravenSpinningAxeRatio  = 1.15
	dravenSpinningAxeReady  = 5800
	dravenSpinningAxeMana   = 45.0
	dravenSpinningAxeCDMs   = 8000.0
	dravenSpinningAxeFlightDur = 1401.0
	dravenSpinningAxeCatchMs   = int64(1400)
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

func dravenSpinningAxeReadyBelowMaxCond() *model.GenericFormulaExpr {
	two := 2.0
	return &model.GenericFormulaExpr{
		Op: "lt",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + dravenSpinningAxeReadyKey},
			{Op: "const", Value: &two},
		},
	}
}

func dravenSpinningAxeStateSchema() map[string]interface{} {
	return map[string]interface{}{
		dravenSpinningAxeReadyKey: map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(2),
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
				ValuePolicy: "add",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   dravenSpinningAxeReadyBelowMaxCond(),
			},
		},
	}
}

func dravenSpinningAxeHitConsumeListener() model.ListenerDefinition {
	negOne := -1.0
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
				Operation:             "apply_provider",
				Target:                "source",
				ProviderDefinitionRef: dravenSpinningAxeFlightRef,
				Condition:             readyCond,
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         dravenSpinningAxeReadyKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "add",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &negOne},
				Condition:   readyCond,
			},
		},
	}
}

func dravenSpinningAxeCatchListener() model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey:  dravenSpinningAxeListenerCatch,
		EventMatcher: model.TypeMatcher{All: []string{dravenSpinningAxeCaughtEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         dravenSpinningAxeReadyKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "add",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   dravenSpinningAxeReadyBelowMaxCond(),
			},
		},
	}
}

func dravenSpinningAxeFlightProvider() model.ProviderDefinition {
	dur := dravenSpinningAxeFlightDur
	return model.ProviderDefinition{
		ProviderKey: dravenSpinningAxeFlightRef,
		Kind:        "status",
		StableID:    "hero_draven_q_axe_flight",
		Lifecycle: &model.ProviderLifecycle{
			DurationMs:     &model.GenericFormulaExpr{Op: "const", Value: &dur},
			MaxStacks:      1,
			RefreshPolicy:  "replace",
			TickIntervalMs: dravenSpinningAxeCatchMs,
		},
		Abilities: []model.AbilityDefinition{
			{
				AbilityKey: dravenSpinningAxeFlightTick,
				Kind:       "tick",
				Types:      []string{"ability/tick"},
				TickSpec: &model.TickSpec{
					IntervalMs:   dravenSpinningAxeCatchMs,
					StartDelayMs: dravenSpinningAxeCatchMs,
					OnTick: []model.OperationDefinition{
						{
							Operation: "emit_event",
							Target:    "source",
							EventType: dravenSpinningAxeCaughtEvent,
							Ref:       dravenSpinningAxeCaughtEvent,
						},
					},
				},
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
	need := []model.TypeCatalogEntry{
		{Key: dravenSpinningAxeCaughtEvent, Domain: "event"},
		{Key: "ability/tick", Domain: "ability"},
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

func mountDravenSpinningAxeProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders,
		model.ProviderDefinition{
			ProviderKey:        dravenSpinningAxeProviderRef,
			Kind:               "passive",
			StableID:           "hero_draven_q_spinning_axe",
			InitialStateSchema: dravenSpinningAxeStateSchema(),
			Listeners: []model.ListenerDefinition{
				dravenSpinningAxeCastArmListener(),
				dravenSpinningAxeHitConsumeListener(),
				dravenSpinningAxeCatchListener(),
			},
		},
		dravenSpinningAxeFlightProvider(),
	)
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
	cost := dravenSpinningAxeMana
	cd := dravenSpinningAxeCDMs
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: dravenSpinningAxeQKey,
			Kind:       "active",
			Types:      []string{},
			Cost: &model.AbilityCost{
				ResourceKey: "mana",
				Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
			},
			Cooldown: &model.AbilityCooldown{
				DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
			},
			Operations: []model.OperationDefinition{},
		},
		{
			AbilityKey: dravenSpinningAxeHitAbility,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Operations: dravenSpinningAxeAAOps(),
		},
	}
	bonusAD := dravenSpinningAxeADRes - dravenSpinningAxeADBase
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
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: dravenLevel1Mana, Max: dravenLevel1Mana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: dravenSpinningAxeADBase, Current: dravenSpinningAxeADBase, Max: dravenSpinningAxeADBase, Resolved: dravenSpinningAxeADBase,
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

func dravenSpinningAxeSourceMana(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Resources["mana"]
		if !ok {
			t.Fatal("source mana missing")
		}
		return slot.Current
	}
	t.Fatal("source missing")
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
	if got, _ := ready["maxValue"].(float64); got != 2 {
		t.Fatalf("maxValue=%v want 2", got)
	}
	if got, _ := ready["durationMs"].(float64); got != float64(dravenSpinningAxeReady) {
		t.Fatalf("durationMs=%v want %d", got, dravenSpinningAxeReady)
	}
	if got, _ := ready["refreshPolicy"].(string); got != model.ProviderStateRefreshOnWrite {
		t.Fatalf("refreshPolicy=%q want %q", got, model.ProviderStateRefreshOnWrite)
	}
	if got, _ := ready["defaultValue"].(float64); got != 0 {
		t.Fatalf("defaultValue=%v want 0", got)
	}
}

func assertDravenLevel1BaseAttrs(t *testing.T, done model.DoneResult) {
	t.Helper()
	checks := []struct {
		attr string
		want float64
	}{
		{"hp", dravenLevel1HP},
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
		t.Fatalf("ad.resolved=%v want %v (base %v + fixture bonus)", got, dravenSpinningAxeADRes, dravenSpinningAxeADBase)
	}
	adBase := sourceAttrBase(t, done.FinalSnapshot, "ad")
	if math.Abs(adBase-dravenSpinningAxeADBase) > 1e-9 {
		t.Fatalf("ad.base=%v want %v", adBase, dravenSpinningAxeADBase)
	}
}

func sourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Attributes[attr]
		if !ok {
			t.Fatalf("source attr %s missing", attr)
		}
		return slot.Base
	}
	t.Fatal("source missing")
	return 0
}

func emittedEventsAt(done model.DoneResult, ref string, timeMs int64) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == ref && item.TimeMs == timeMs {
			n++
		}
	}
	return n
}

func providerTicksByPrefix(done model.DoneResult, defPrefix string) []model.EvidenceItem {
	var out []model.EvidenceItem
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindProviderTick {
			continue
		}
		ref := item.Ref
		if ref == "" {
			ref = evidenceDataString(item.Data, "providerRef")
		}
		if strings.HasPrefix(ref, defPrefix+"#") || ref == defPrefix {
			out = append(out, item)
		}
	}
	return out
}

func liveFlightProviderRefs(done model.DoneResult) []string {
	var refs []string
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		for _, p := range c.Providers {
			if strings.HasPrefix(p.ProviderRef, dravenSpinningAxeFlightRef+"#") {
				refs = append(refs, p.ProviderRef)
			}
		}
	}
	return refs
}

// reconstructReadyTrace walks chronological evidence to observe spinning_axe_ready
// transitions implied by Q arm / qualifying hit consume / catch rearm.
func reconstructReadyTrace(done model.DoneResult) []float64 {
	ready := 0.0
	trace := []float64{ready}
	for _, item := range done.Evidence.Items {
		switch item.Kind {
		case model.EvidenceKindEmittedEvent:
			switch item.Ref {
			case dravenSpinningAxeCastEvent:
				before := ready
				if ready < 2 {
					ready++
				}
				if ready != before {
					trace = append(trace, ready)
				}
			case dravenSpinningAxeCaughtEvent:
				before := ready
				if ready < 2 {
					ready++
				}
				if ready != before {
					trace = append(trace, ready)
				}
			}
		case model.EvidenceKindDamage:
			if evidenceDataString(item.Data, "operationRef") != dravenSpinningAxeDamageOpRef {
				continue
			}
			if evidenceDataBool(item.Data, "phantom") {
				continue
			}
			ready--
			trace = append(trace, ready)
		}
	}
	return trace
}

func assertReadyTraceInvariants(t *testing.T, done model.DoneResult) {
	t.Helper()
	trace := reconstructReadyTrace(done)
	for i, v := range trace {
		if v < 0 || v > 2 {
			t.Fatalf("ready trace[%d]=%v out of [0,2]: %v", i, v, trace)
		}
	}
	ready := 0.0
	for _, item := range done.Evidence.Items {
		switch item.Kind {
		case model.EvidenceKindEmittedEvent:
			switch item.Ref {
			case dravenSpinningAxeCastEvent:
				if ready < 2 {
					ready++
				}
			case dravenSpinningAxeCaughtEvent:
				delta := 0.0
				if ready < 2 {
					ready++
					delta = 1
				}
				if delta > 1 {
					t.Fatalf("catch added more than 1")
				}
			}
		case model.EvidenceKindDamage:
			if evidenceDataString(item.Data, "operationRef") != dravenSpinningAxeDamageOpRef {
				continue
			}
			if evidenceDataBool(item.Data, "phantom") {
				continue
			}
			before := ready
			ready--
			if math.Abs((before-ready)-1) > 1e-9 {
				t.Fatalf("qualifying hit delta=%v want -1 (before=%v after=%v)", before-ready, before, ready)
			}
		}
	}
}

// TestGenericDravenSpinningAxeFormulaCrossCheck: AD100/base60 @ armor0 → raw106.
func TestGenericDravenSpinningAxeFormulaCrossCheck(t *testing.T) {
	raw := dravenSpinningAxeExpectedRaw(dravenSpinningAxeADRes, dravenSpinningAxeADBase)
	if math.Abs(raw-106) > 1e-9 {
		t.Fatalf("raw=%v want 106 (60 + 1.15*40)", raw)
	}
	mitigated := dravenSpinningAxeExpectedMitigated(dravenSpinningAxeADRes, dravenSpinningAxeADBase, dravenSpinningAxeArmor)
	if math.Abs(mitigated-106) > 1e-9 {
		t.Fatalf("mitigated=%v want 106 (armor 0)", mitigated)
	}
	rawBaseOnly := dravenSpinningAxeExpectedRaw(dravenSpinningAxeADBase, dravenSpinningAxeADBase)
	if math.Abs(rawBaseOnly-60) > 1e-9 {
		t.Fatalf("rawBaseOnly=%v want 60", rawBaseOnly)
	}
}

// TestGenericDravenSpinningAxeCompileRunRank5InitialAxe: Q arms; first AA procs once
// then consumes; second AA before catch does not proc.
func TestGenericDravenSpinningAxeCompileRunRank5InitialAxe(t *testing.T) {
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
	assertReadyTraceInvariants(t, done)

	if countEmittedEvents(done, dravenSpinningAxeCastEvent) != 1 {
		t.Fatalf("ability_started count=%d want 1 (Q only; AA must not arm)", countEmittedEvents(done, dravenSpinningAxeCastEvent))
	}
	if countEmittedEvents(done, dravenSpinningAxeHitEvent) != 2 {
		t.Fatalf("basic_attack_hit emits=%d want 2", countEmittedEvents(done, dravenSpinningAxeHitEvent))
	}

	wantRaw := dravenSpinningAxeExpectedRaw(dravenSpinningAxeADRes, dravenSpinningAxeADBase)
	wantMitigated := dravenSpinningAxeExpectedMitigated(dravenSpinningAxeADRes, dravenSpinningAxeADBase, dravenSpinningAxeArmor)
	if math.Abs(wantRaw-106) > 1e-9 || math.Abs(wantMitigated-106) > 1e-9 {
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
	if item.TimeMs != 100 {
		t.Fatalf("proc time=%d want 100", item.TimeMs)
	}

	if got := dravenSpinningAxeStateValue(t, done, dravenSpinningAxeReadyKey); got != 0 {
		t.Fatalf("spinning_axe_ready=%v want 0 after consume (before catch)", got)
	}
	if got := dravenSpinningAxeSourceMana(t, done.FinalSnapshot); math.Abs(got-(dravenLevel1Mana-dravenSpinningAxeMana)) > 1e-9 {
		t.Fatalf("mana=%v want %v", got, dravenLevel1Mana-dravenSpinningAxeMana)
	}

	aaMitigated := expectedMitigatedPhysical(dravenSpinningAxeAA, dravenSpinningAxeArmor)
	wantDealt := 2*aaMitigated + wantMitigated
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
}

// TestGenericDravenSpinningAxeCatchRearmAndDualAxe: catch at apply+1400; keep axe
// alive via catch refresh; Q recast at 8000ms reaches ready=2; two overlapping
// flights with distinct refs.
func TestGenericDravenSpinningAxeCatchRearmAndDualAxe(t *testing.T) {
	compileReq, runReq := loadDravenSpinningAxeFixture(t)
	assertDravenSpinningAxeSchema(t, compileReq)

	const (
		aa1At   = int64(100)
		aaKeep  = int64(6000) // refresh ready duration past Q2 via throw+catch
		q2At    = int64(8000)
		aa2At   = int64(8100)
		aa3At   = int64(8200)
		catch1  = aa1At + dravenSpinningAxeCatchMs   // 1500
		catchKeep = aaKeep + dravenSpinningAxeCatchMs // 7400
		catch2  = aa2At + dravenSpinningAxeCatchMs    // 9500
		catch3  = aa3At + dravenSpinningAxeCatchMs    // 9600
		overlap = int64(8300)                         // both dual flights live
	)

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q1", AbilityRef: dravenQRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa1", AbilityRef: dravenAARef(), Source: "source", Target: "target", FirstAtMs: aa1At},
		{EntryKey: "aa_keep", AbilityRef: dravenAARef(), Source: "source", Target: "target", FirstAtMs: aaKeep},
		{EntryKey: "q2", AbilityRef: dravenQRef(), Source: "source", Target: "target", FirstAtMs: q2At},
		{EntryKey: "aa2", AbilityRef: dravenAARef(), Source: "source", Target: "target", FirstAtMs: aa2At},
		{EntryKey: "aa3", AbilityRef: dravenAARef(), Source: "source", Target: "target", FirstAtMs: aa3At},
	}
	runReq.StopPolicy.DurationMs = catch3 + 50
	done := runDravenSpinningAxe(t, compileReq, runReq)
	assertReadyTraceInvariants(t, done)

	// First axe: consume + flight tick + catch exactly 1400ms after apply.
	if countDamageByOpRef(done, dravenSpinningAxeDamageOpRef, false) != 4 {
		t.Fatalf("axe proc count=%d want 4", countDamageByOpRef(done, dravenSpinningAxeDamageOpRef, false))
	}
	ticks := providerTicksByPrefix(done, dravenSpinningAxeFlightRef)
	if len(ticks) != 4 {
		t.Fatalf("flight ticks=%d want 4", len(ticks))
	}
	tickAt := map[int64]string{}
	for _, item := range ticks {
		ref := item.Ref
		if ref == "" {
			ref = evidenceDataString(item.Data, "providerRef")
		}
		tickAt[item.TimeMs] = ref
	}
	if _, ok := tickAt[catch1]; !ok {
		t.Fatalf("missing flight tick at %d (aa1 apply+1400): %+v", catch1, tickAt)
	}
	if emittedEventsAt(done, dravenSpinningAxeCaughtEvent, catch1) != 1 {
		t.Fatalf("axe_caught at %d count=%d want 1", catch1, emittedEventsAt(done, dravenSpinningAxeCaughtEvent, catch1))
	}
	if _, ok := tickAt[catchKeep]; !ok {
		t.Fatalf("missing keep-alive flight tick at %d: %+v", catchKeep, tickAt)
	}

	// After catch refresh, Q2 at 8000 establishes ready=2.
	if countEmittedEvents(done, dravenSpinningAxeCastEvent) != 2 {
		t.Fatalf("ability_started=%d want 2", countEmittedEvents(done, dravenSpinningAxeCastEvent))
	}
	if got := dravenSpinningAxeSourceMana(t, done.FinalSnapshot); math.Abs(got-(dravenLevel1Mana-2*dravenSpinningAxeMana)) > 1e-9 {
		t.Fatalf("mana after 2 Q casts=%v want %v", got, dravenLevel1Mana-2*dravenSpinningAxeMana)
	}

	if _, ok := tickAt[catch2]; !ok {
		t.Fatalf("missing flight tick at %d: %+v", catch2, tickAt)
	}
	if _, ok := tickAt[catch3]; !ok {
		t.Fatalf("missing flight tick at %d: %+v", catch3, tickAt)
	}
	if tickAt[catch2] == tickAt[catch3] {
		t.Fatalf("overlapping flights must use distinct provider refs; both %q", tickAt[catch2])
	}
	if emittedEventsAt(done, dravenSpinningAxeCaughtEvent, catch2) != 1 {
		t.Fatalf("axe_caught at %d count=%d want 1", catch2, emittedEventsAt(done, dravenSpinningAxeCaughtEvent, catch2))
	}
	if emittedEventsAt(done, dravenSpinningAxeCaughtEvent, catch3) != 1 {
		t.Fatalf("axe_caught at %d count=%d want 1", catch3, emittedEventsAt(done, dravenSpinningAxeCaughtEvent, catch3))
	}

	wantRaw := dravenSpinningAxeExpectedRaw(dravenSpinningAxeADRes, dravenSpinningAxeADBase)
	if math.Abs(wantRaw-106) > 1e-9 {
		t.Fatalf("raw=%v want 106", wantRaw)
	}
	if got := sumDamageRawByOpRef(done, dravenSpinningAxeDamageOpRef); math.Abs(got-4*wantRaw) > 1e-6 {
		t.Fatalf("total axe raw=%v want %v", got, 4*wantRaw)
	}
	if got := dravenSpinningAxeStateValue(t, done, dravenSpinningAxeReadyKey); got != 2 {
		t.Fatalf("spinning_axe_ready final=%v want 2 (two catches after dual throw)", got)
	}

	// Overlap window: two live flight instances with distinct refs.
	compileReq2, runReq2 := loadDravenSpinningAxeFixture(t)
	runReq2.DriverPlan.Entries = runReq.DriverPlan.Entries
	runReq2.StopPolicy.DurationMs = overlap
	doneOverlap := runDravenSpinningAxe(t, compileReq2, runReq2)
	refs := liveFlightProviderRefs(doneOverlap)
	if len(refs) != 2 {
		t.Fatalf("overlapping flight refs=%v want exactly 2 distinct instances", refs)
	}
	if refs[0] == refs[1] {
		t.Fatalf("flight refs not distinct: %v", refs)
	}
}

// TestGenericDravenSpinningAxeQCastArmsReadyOnly: successful Q cast arms ready without proc.
func TestGenericDravenSpinningAxeQCastArmsReadyOnly(t *testing.T) {
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
	if got := dravenSpinningAxeSourceMana(t, done.FinalSnapshot); math.Abs(got-(dravenLevel1Mana-dravenSpinningAxeMana)) > 1e-9 {
		t.Fatalf("mana=%v want %v", got, dravenLevel1Mana-dravenSpinningAxeMana)
	}
}

// TestGenericDravenSpinningAxeBasicAttackDoesNotEmitAbilityStarted: AA alone never arms.
func TestGenericDravenSpinningAxeBasicAttackDoesNotEmitAbilityStarted(t *testing.T) {
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

// TestGenericDravenSpinningAxeReadyExpiresAt5800: attack at exactly 5800ms after arm does not proc.
func TestGenericDravenSpinningAxeReadyExpiresAt5800(t *testing.T) {
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

// TestGenericDravenSpinningAxePhantomDoesNotCopy: copyable_on_hit=false; Guinsoo phantom skips axe.
func TestGenericDravenSpinningAxePhantomDoesNotCopy(t *testing.T) {
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
