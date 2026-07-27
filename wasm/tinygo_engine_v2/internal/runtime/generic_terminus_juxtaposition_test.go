package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// item_3302 Terminus / 界弓 — Juxtaposition / 交相 (generic ABI, Phase-A).
//
// Numeric authority (League Wiki item manifest only; no DDragon):
//   - revid 4030984
//   - SHA256 e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d
//
// Reuses provider_item_3302_terminus + Shadow flat 30 magic on-hit (copyable).
// Phase-A assumptions (explicit, not Wiki-published facts):
//   - first qualifying landed champion basic attack is Light
//   - aggregate refresh_on_write for light_stacks / dark_stacks (not independent per-stack timers)
//   - untimed next_polarity persists through stack expiry
//
// State (all state_scope/provider):
//   - next_polarity: untimed, default Light=0, Dark=1
//   - light_stacks / dark_stacks: default0 / max3 / durationMs=5000 / refresh_on_write
//
// Light: armor + magic_resist add light_stacks * pp(level), pp = piecewiseLinear
//   6@1, 7@11, 8@14 with endpoint clamps and linear interpolation.
// Dark: armor_pen_percent + magic_pen_percent add 0.10 * dark_stacks (flat add, not percent_add).
//
// Non-goals: Backend seed/live publish, multi-target/non-champion, independent per-stack expiry,
// production runtime/ABI changes.

const (
	tjProviderRef = "item:3302_terminus"
	tjStableID    = "provider_item_3302_terminus"
	tjListenerKey = "listener_item_3302_terminus"
	tjShadowOpRef = "op:terminus_on_hit"
	tjShadowRaw   = 30.0

	tjPolarityKey = "next_polarity"
	tjLightKey    = "light_stacks"
	tjDarkKey     = "dark_stacks"

	tjPolarityLight = 0.0
	tjPolarityDark  = 1.0

	tjStackMax     = 3.0
	tjDurationMs   = 5000.0
	tjDarkPenPer   = 0.10
	tjLevelAttr    = "champion_level"
	tjAADamage     = 10.0
	tjProbePhysRef = "op:tj_probe_phys"
	tjProbeMagRef  = "op:tj_probe_mag"
	tjProbePhysKey = "tj_probe_phys"
	tjProbeMagKey  = "tj_probe_mag"
	tjNonBasicKey  = "tj_non_basic"
	tjNonBasicRef  = "op:tj_non_basic"
	tjGatedAAKey   = "tj_gated_aa"
	tjTol          = 1e-9
)

func tjConst(v float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: &v}
}

func tjTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func tjStateSchema() map[string]interface{} {
	return map[string]interface{}{
		tjPolarityKey: map[string]interface{}{
			"defaultValue": tjPolarityLight,
			"maxValue":     tjPolarityDark,
			"durationMs":   float64(0),
		},
		tjLightKey: tjTimedSlot(0, tjStackMax, tjDurationMs),
		tjDarkKey:  tjTimedSlot(0, tjStackMax, tjDurationMs),
	}
}

// Independent expected pp (must not re-walk the model formula AST).
func tjExpectedPP(level float64) float64 {
	if level < 1 {
		level = 1
	}
	if level > 14 {
		level = 14
	}
	if level < 11 {
		return 6 + (level-1)/10
	}
	return 7 + (level-11)/3
}

func tjExpectedLightBonus(level, stacks float64) float64 {
	return stacks * tjExpectedPP(level)
}

func tjExpectedDarkPen(stacks float64) float64 {
	return tjDarkPenPer * stacks
}

func tjExpectedMitigatedWithPercentPen(raw, resist, penPct float64) float64 {
	eff := resist * (1 - penPct)
	return expectedMitigatedPhysical(raw, eff)
}

func tjPolarityIs(light bool) *model.GenericFormulaExpr {
	want := tjPolarityDark
	if light {
		want = tjPolarityLight
	}
	return &model.GenericFormulaExpr{
		Op: "eq",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + tjPolarityKey},
			{Op: "const", Value: &want},
		},
	}
}

func tjPiecewiseResistPerStack() model.GenericFormulaExpr {
	one := 1.0
	eleven := 11.0
	fourteen := 14.0
	six := 6.0
	seven := 7.0
	ten := 10.0
	three := 3.0
	levelPath := "source.attr." + tjLevelAttr + ".resolved"
	levelClamped := model.GenericFormulaExpr{
		Op: "clamp",
		Expr: &model.GenericFormulaExpr{
			Op: "read", Path: levelPath,
		},
		Min: &model.GenericFormulaExpr{Op: "const", Value: &one},
		Max: &model.GenericFormulaExpr{Op: "const", Value: &fourteen},
	}
	// seg1 = 6 + (level-1)/10
	seg1 := model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &six},
			{
				Op: "div",
				Args: []model.GenericFormulaExpr{
					{
						Op: "sub",
						Args: []model.GenericFormulaExpr{
							levelClamped,
							{Op: "const", Value: &one},
						},
					},
					{Op: "const", Value: &ten},
				},
			},
		},
	}
	// seg2 = 7 + (level-11)/3
	seg2 := model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &seven},
			{
				Op: "div",
				Args: []model.GenericFormulaExpr{
					{
						Op: "sub",
						Args: []model.GenericFormulaExpr{
							{
								Op: "clamp",
								Expr: &model.GenericFormulaExpr{
									Op: "read", Path: levelPath,
								},
								Min: &model.GenericFormulaExpr{Op: "const", Value: &one},
								Max: &model.GenericFormulaExpr{Op: "const", Value: &fourteen},
							},
							{Op: "const", Value: &eleven},
						},
					},
					{Op: "const", Value: &three},
				},
			},
		},
	}
	useSeg2 := model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{
				Op: "clamp",
				Expr: &model.GenericFormulaExpr{
					Op: "read", Path: levelPath,
				},
				Min: &model.GenericFormulaExpr{Op: "const", Value: &one},
				Max: &model.GenericFormulaExpr{Op: "const", Value: &fourteen},
			},
			{Op: "const", Value: &eleven},
		},
	}
	oneMinus := model.GenericFormulaExpr{
		Op: "sub",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &one},
			useSeg2,
		},
	}
	return model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "mul", Args: []model.GenericFormulaExpr{seg1, oneMinus}},
			{Op: "mul", Args: []model.GenericFormulaExpr{seg2, useSeg2}},
		},
	}
}

func tjLightResistValue() model.GenericFormulaExpr {
	pp := tjPiecewiseResistPerStack()
	return model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + tjLightKey},
			pp,
		},
	}
}

func tjDarkPenValue() model.GenericFormulaExpr {
	per := tjDarkPenPer
	return model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &per},
			{Op: "read", Path: "provider.state." + tjDarkKey},
		},
	}
}

func tjModifiers() []model.ModifierDefinition {
	return []model.ModifierDefinition{
		{
			ModifierKey: "terminus_juxtaposition_light_armor",
			Kind:        "attribute",
			Target:      "armor",
			ValuePolicy: "add",
			Value:       tjLightResistValue(),
		},
		{
			ModifierKey: "terminus_juxtaposition_light_mr",
			Kind:        "attribute",
			Target:      "magic_resist",
			ValuePolicy: "add",
			Value:       tjLightResistValue(),
		},
		{
			ModifierKey: "terminus_juxtaposition_dark_armor_pen",
			Kind:        "attribute",
			Target:      "armor_pen_percent",
			ValuePolicy: "add",
			Value:       tjDarkPenValue(),
		},
		{
			ModifierKey: "terminus_juxtaposition_dark_magic_pen",
			Kind:        "attribute",
			Target:      "magic_pen_percent",
			ValuePolicy: "add",
			Value:       tjDarkPenValue(),
		},
	}
}

func tjListenerOps() []model.OperationDefinition {
	one := 1.0
	return []model.OperationDefinition{
		{
			Operation:     "damage",
			Target:        "target",
			DamageType:    "damage/magic",
			Ref:           tjShadowOpRef,
			ValuePolicy:   "add",
			CopyableOnHit: true,
			Amount:        tjConst(tjShadowRaw),
		},
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         tjLightKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      tjConst(1),
			Condition:   tjPolarityIs(true),
		},
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         tjDarkKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      tjConst(1),
			Condition:   tjPolarityIs(false),
		},
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         tjPolarityKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "override",
			Amount: &model.GenericFormulaExpr{
				Op: "sub",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &one},
					{Op: "read", Path: "provider.state." + tjPolarityKey},
				},
			},
		},
	}
}

func tjListener() model.ListenerDefinition {
	return model.ListenerDefinition{
		ListenerKey:         tjListenerKey,
		EventMatcher:        model.TypeMatcher{All: []string{gcohHitEvent, "event/source_owner"}},
		MaxTriggersPerEvent: 1,
		Operations:          tjListenerOps(),
	}
}

func tjEnsureTypes(req *model.CompileRequest) {
	gcohEnsureTypes(req)
	need := []model.TypeCatalogEntry{
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: "damage/magic", Domain: "damage"},
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

func tjMountProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        tjProviderRef,
		Kind:               "passive",
		StableID:           tjStableID,
		InitialStateSchema: tjStateSchema(),
		Modifiers:          tjModifiers(),
		Listeners:          []model.ListenerDefinition{tjListener()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: tjProviderRef, DefinitionRef: tjProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: tjProviderRef, DefinitionRef: tjProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func tjAttachProbeAbilities(compileReq *model.CompileRequest) {
	phys := 100.0
	mag := 100.0
	compileReq.SharedProviders[0].Abilities = append(compileReq.SharedProviders[0].Abilities,
		model.AbilityDefinition{
			AbilityKey: tjProbePhysKey,
			Kind:       "active",
			Types:      []string{},
			Operations: []model.OperationDefinition{{
				Operation: "damage", Target: "target", DamageType: "damage/physical",
				Ref: tjProbePhysRef, Amount: tjConst(phys),
			}},
		},
		model.AbilityDefinition{
			AbilityKey: tjProbeMagKey,
			Kind:       "active",
			Types:      []string{},
			Operations: []model.OperationDefinition{{
				Operation: "damage", Target: "target", DamageType: "damage/magic",
				Ref: tjProbeMagRef, Amount: tjConst(mag),
			}},
		},
	)
}

func tjAttachNonBasicAbility(compileReq *model.CompileRequest) {
	amt := 50.0
	compileReq.SharedProviders[0].Abilities = append(compileReq.SharedProviders[0].Abilities,
		model.AbilityDefinition{
			AbilityKey: tjNonBasicKey,
			Kind:       "active",
			Types:      []string{},
			Operations: []model.OperationDefinition{{
				Operation: "damage", Target: "target", DamageType: "damage/physical",
				Ref: tjNonBasicRef, Amount: tjConst(amt),
			}},
		},
	)
}

func tjAttachGatedAA(compileReq *model.CompileRequest) {
	aa := tjAADamage
	cd := 5000.0
	compileReq.SharedProviders[0].Abilities = append(compileReq.SharedProviders[0].Abilities,
		model.AbilityDefinition{
			AbilityKey: tjGatedAAKey,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Cooldown: &model.AbilityCooldown{
				DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
			},
			Operations: []model.OperationDefinition{
				{
					Operation: "damage", Target: "target", DamageType: "damage/physical",
					Ref: "op:aa_gated", Amount: tjConst(aa),
				},
				{
					Operation: "emit_event", Target: "target",
					EventType: gcohHitEvent, Ref: gcohHitEvent,
				},
			},
		},
	)
}

func tjProbeRef(abilityKey string) string {
	return "source.provider[" + gcohChampionRef + "].ability[" + abilityKey + "]"
}

func tjLoadFixture(t *testing.T, level float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := gcohBaseFixture(t)
	tjEnsureTypes(&compileReq)
	tjMountProvider(&compileReq, &runReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, tjLevelAttr, model.AttributeSlotDef{
		Base: level, Current: level, Max: level, Resolved: level,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "magic_resist", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor_pen_percent", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 1, Resolved: 0,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "magic_pen_percent", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 1, Resolved: 0,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: 100, Current: 100, Max: 100, Resolved: 100,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: 100, Current: 100, Max: 100, Resolved: 100,
	})
	return compileReq, runReq
}

func tjRun(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	return gcohRun(t, compileReq, runReq)
}

func tjStateValue(t *testing.T, done model.DoneResult, key string) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[tjProviderRef].(map[string]interface{})
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

func tjAssertStacks(t *testing.T, done model.DoneResult, light, dark, polarity float64) {
	t.Helper()
	if got := tjStateValue(t, done, tjLightKey); math.Abs(got-light) > tjTol {
		t.Fatalf("light_stacks=%v want %v", got, light)
	}
	if got := tjStateValue(t, done, tjDarkKey); math.Abs(got-dark) > tjTol {
		t.Fatalf("dark_stacks=%v want %v", got, dark)
	}
	if got := tjStateValue(t, done, tjPolarityKey); math.Abs(got-polarity) > tjTol {
		t.Fatalf("next_polarity=%v want %v", got, polarity)
	}
}

func tjAssertShadowRaw(t *testing.T, done model.DoneResult, wantCount int) {
	t.Helper()
	n, raw, _ := gcohDamageEvidence(done, tjShadowOpRef, false)
	if n != wantCount || math.Abs(raw-tjShadowRaw*float64(wantCount)) > tjTol {
		t.Fatalf("shadow original count=%d rawSum=%v want count=%d rawSum=%v",
			n, raw, wantCount, tjShadowRaw*float64(wantCount))
	}
}

func TestGenericTerminusJuxtapositionPPCrossCheck(t *testing.T) {
	cases := []struct {
		level float64
		want  float64
	}{
		{1, 6},
		{6, 6.5},
		{11, 7},
		{12.5, 7.5},
		{14, 8},
		{0, 6},   // clamp low
		{18, 8},  // clamp high
	}
	for _, tc := range cases {
		if got := tjExpectedPP(tc.level); math.Abs(got-tc.want) > 1e-12 {
			t.Fatalf("pp(level=%v)=%v want %v", tc.level, got, tc.want)
		}
	}
}

func TestGenericTerminusJuxtapositionSchemaCompiled(t *testing.T) {
	compileReq, _ := tjLoadFixture(t, 1)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	var found *compile.CompiledProvider
	for i := range result.Session.Providers {
		p := &result.Session.Providers[i]
		if p.ProviderKey == tjProviderRef {
			found = p
			break
		}
	}
	if found == nil {
		t.Fatal("missing terminus provider")
	}
	pol := found.StateFields[tjPolarityKey]
	if pol.DurationMs != 0 || pol.DefaultValue != 0 {
		t.Fatalf("next_polarity field=%+v want untimed default 0", pol)
	}
	for _, key := range []string{tjLightKey, tjDarkKey} {
		f := found.StateFields[key]
		if !f.HasCap || f.MaxValue != 3 || f.DurationMs != 5000 || f.RefreshPolicy != model.ProviderStateRefreshOnWrite {
			t.Fatalf("%s field=%+v want max3/5000/refresh_on_write", key, f)
		}
	}
}

func TestGenericTerminusJuxtapositionFirstSixHitsAlternateToThreeThree(t *testing.T) {
	compileReq, runReq := tjLoadFixture(t, 1)
	gcohSetDriverHits(&runReq, 6, "tj_alt")
	done := tjRun(t, compileReq, runReq)

	if countEmittedEvents(done, gcohHitEvent) != 6 {
		t.Fatalf("basic_attack_hit=%d want 6", countEmittedEvents(done, gcohHitEvent))
	}
	tjAssertStacks(t, done, 3, 3, tjPolarityLight)
	tjAssertShadowRaw(t, done, 6)
	wantArmor := tjExpectedLightBonus(1, 3)
	if got := sourceAttrResolved(t, done.FinalSnapshot, "armor"); math.Abs(got-wantArmor) > tjTol {
		t.Fatalf("armor=%v want %v", got, wantArmor)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "magic_resist"); math.Abs(got-wantArmor) > tjTol {
		t.Fatalf("magic_resist=%v want %v", got, wantArmor)
	}
	wantPen := tjExpectedDarkPen(3)
	if got := sourceAttrResolved(t, done.FinalSnapshot, "armor_pen_percent"); math.Abs(got-wantPen) > tjTol {
		t.Fatalf("armor_pen_percent=%v want %v", got, wantPen)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "magic_pen_percent"); math.Abs(got-wantPen) > tjTol {
		t.Fatalf("magic_pen_percent=%v want %v", got, wantPen)
	}
}

func TestGenericTerminusJuxtapositionPolarityPersistsAfterStackExpiry(t *testing.T) {
	compileReq, runReq := tjLoadFixture(t, 1)
	tjAttachProbeAbilities(&compileReq)
	// Light@0 → expireAt 5000; probe forces lazy-expire; polarity stays Dark.
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa1", AbilityRef: gcohAARef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "probe", AbilityRef: tjProbeRef(tjProbePhysKey), Source: "source", Target: "target", FirstAtMs: 5000},
	}
	runReq.StopPolicy.DurationMs = 5100
	done := tjRun(t, compileReq, runReq)

	tjAssertStacks(t, done, 0, 0, tjPolarityDark)
	if got := sourceAttrResolved(t, done.FinalSnapshot, "armor"); math.Abs(got) > tjTol {
		t.Fatalf("armor after light expiry=%v want 0", got)
	}
}

func TestGenericTerminusJuxtapositionLightAndDarkIndependentExpiry(t *testing.T) {
	compileReq, runReq := tjLoadFixture(t, 1)
	tjAttachProbeAbilities(&compileReq)
	// Light@0 expire 5000; Dark@100 expire 5100. Probe@5000: light cleared, dark live.
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "l1", AbilityRef: gcohAARef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "d1", AbilityRef: gcohAARef(), Source: "source", Target: "target", FirstAtMs: 100},
		{EntryKey: "mid", AbilityRef: tjProbeRef(tjProbePhysKey), Source: "source", Target: "target", FirstAtMs: 5000},
	}
	runReq.StopPolicy.DurationMs = 5050
	done := tjRun(t, compileReq, runReq)

	tjAssertStacks(t, done, 0, 1, tjPolarityLight)
	if got := sourceAttrResolved(t, done.FinalSnapshot, "armor"); math.Abs(got) > tjTol {
		t.Fatalf("armor after light-only expiry=%v want 0", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "armor_pen_percent"); math.Abs(got-0.10) > tjTol {
		t.Fatalf("armor_pen_percent=%v want 0.10 (dark still live)", got)
	}
}

func TestGenericTerminusJuxtapositionLightAggregateRefreshAndExactExpiry(t *testing.T) {
	compileReq, runReq := tjLoadFixture(t, 1)
	tjAttachProbeAbilities(&compileReq)
	// L@0 D@50 L@2000 D@2100: light refresh→expire 7000; dark refresh→expire 7100.
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "l1", AbilityRef: gcohAARef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "d1", AbilityRef: gcohAARef(), Source: "source", Target: "target", FirstAtMs: 50},
		{EntryKey: "l2", AbilityRef: gcohAARef(), Source: "source", Target: "target", FirstAtMs: 2000},
		{EntryKey: "d2", AbilityRef: gcohAARef(), Source: "source", Target: "target", FirstAtMs: 2100},
		{EntryKey: "live", AbilityRef: tjProbeRef(tjProbePhysKey), Source: "source", Target: "target", FirstAtMs: 6999},
		{EntryKey: "light_dead", AbilityRef: tjProbeRef(tjProbePhysKey), Source: "source", Target: "target", FirstAtMs: 7001},
	}
	runReq.StopPolicy.DurationMs = 7050
	done := tjRun(t, compileReq, runReq)

	if got := tjStateValue(t, done, tjLightKey); math.Abs(got) > tjTol {
		t.Fatalf("light_stacks after exact expiry=%v want 0", got)
	}
	if got := tjStateValue(t, done, tjDarkKey); math.Abs(got-2) > tjTol {
		t.Fatalf("dark_stacks=%v want 2 (still live until 7100)", got)
	}
	if got := tjStateValue(t, done, tjPolarityKey); math.Abs(got-tjPolarityLight) > tjTol {
		t.Fatalf("next_polarity=%v want Light after second Dark", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "armor"); math.Abs(got) > tjTol {
		t.Fatalf("armor after light expiry=%v want 0 (recalc)", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "armor_pen_percent"); math.Abs(got-0.20) > tjTol {
		t.Fatalf("armor_pen_percent=%v want 0.20 while dark live", got)
	}
}

func TestGenericTerminusJuxtapositionDarkAggregateRefreshAndExactExpiry(t *testing.T) {
	compileReq, runReq := tjLoadFixture(t, 1)
	tjAttachProbeAbilities(&compileReq)
	// Same refresh timeline; probe@7101 clears dark after exact 5000ms from 2100.
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "l1", AbilityRef: gcohAARef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "d1", AbilityRef: gcohAARef(), Source: "source", Target: "target", FirstAtMs: 50},
		{EntryKey: "l2", AbilityRef: gcohAARef(), Source: "source", Target: "target", FirstAtMs: 2000},
		{EntryKey: "d2", AbilityRef: gcohAARef(), Source: "source", Target: "target", FirstAtMs: 2100},
		{EntryKey: "dark_dead", AbilityRef: tjProbeRef(tjProbePhysKey), Source: "source", Target: "target", FirstAtMs: 7101},
	}
	runReq.StopPolicy.DurationMs = 7150
	done := tjRun(t, compileReq, runReq)

	if got := tjStateValue(t, done, tjDarkKey); math.Abs(got) > tjTol {
		t.Fatalf("dark_stacks after exact expiry=%v want 0", got)
	}
	if got := tjStateValue(t, done, tjLightKey); math.Abs(got) > tjTol {
		t.Fatalf("light_stacks=%v want 0 (expired at 7000 before dark probe)", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "armor_pen_percent"); math.Abs(got) > tjTol {
		t.Fatalf("armor_pen_percent after dark expiry=%v want 0", got)
	}
}

func TestGenericTerminusJuxtapositionDarkPenetrationDamageEvidence(t *testing.T) {
	for _, stacks := range []float64{1, 2, 3} {
		t.Run("stacks_"+itoaRuntime(int(stacks)), func(t *testing.T) {
			compileReq, runReq := tjLoadFixture(t, 1)
			tjAttachProbeAbilities(&compileReq)
			// Alternate hits: odd=Light even=Dark. Need `stacks` Dark hits → 2*stacks total AA.
			hits := int(stacks) * 2
			entries := make([]model.DriverEntry, 0, hits+2)
			for i := 0; i < hits; i++ {
				entries = append(entries, model.DriverEntry{
					EntryKey: "aa_" + itoaRuntime(i), AbilityRef: gcohAARef(),
					Source: "source", Target: "target", FirstAtMs: int64(i * 100),
				})
			}
			at := int64(hits * 100)
			entries = append(entries,
				model.DriverEntry{EntryKey: "phys", AbilityRef: tjProbeRef(tjProbePhysKey),
					Source: "source", Target: "target", FirstAtMs: at},
				model.DriverEntry{EntryKey: "mag", AbilityRef: tjProbeRef(tjProbeMagKey),
					Source: "source", Target: "target", FirstAtMs: at + 50},
			)
			runReq.DriverPlan.Entries = entries
			runReq.StopPolicy.DurationMs = at + 100
			done := tjRun(t, compileReq, runReq)

			wantPen := tjExpectedDarkPen(stacks)
			if got := sourceAttrResolved(t, done.FinalSnapshot, "armor_pen_percent"); math.Abs(got-wantPen) > tjTol {
				t.Fatalf("armor_pen_percent=%v want %v", got, wantPen)
			}
			if got := sourceAttrResolved(t, done.FinalSnapshot, "magic_pen_percent"); math.Abs(got-wantPen) > tjTol {
				t.Fatalf("magic_pen_percent=%v want %v", got, wantPen)
			}
			wantMit := tjExpectedMitigatedWithPercentPen(100, 100, wantPen)
			nPhys, _, mitPhys := gcohDamageEvidence(done, tjProbePhysRef, false)
			if nPhys != 1 || math.Abs(mitPhys-wantMit) > tjTol {
				t.Fatalf("phys probe n=%d mit=%v want 1 / %v", nPhys, mitPhys, wantMit)
			}
			nMag, _, mitMag := gcohDamageEvidence(done, tjProbeMagRef, false)
			if nMag != 1 || math.Abs(mitMag-wantMit) > tjTol {
				t.Fatalf("mag probe n=%d mit=%v want 1 / %v", nMag, mitMag, wantMit)
			}
			var physEv map[string]interface{}
			for _, item := range damageEvidenceItems(done) {
				if evidenceDataString(item.Data, "operationRef") == tjProbePhysRef && !evidenceDataBool(item.Data, "phantom") {
					physEv = item.Data
					break
				}
			}
			if physEv == nil {
				t.Fatal("missing phys probe evidence")
			}
			if math.Abs(evidenceDataFloat(physEv, "penetrationPercent")-wantPen) > tjTol {
				t.Fatalf("penetrationPercent=%v want %v", evidenceDataFloat(physEv, "penetrationPercent"), wantPen)
			}
		})
	}
}

func TestGenericTerminusJuxtapositionLightLevelAndStacks(t *testing.T) {
	cases := []struct {
		name   string
		level  float64
		lights int // number of Light hits (= ceil(totalAA/2) via alternate start Light)
	}{
		{name: "lv1_s1", level: 1, lights: 1},
		{name: "lv1_s2", level: 1, lights: 2},
		{name: "lv1_s3", level: 1, lights: 3},
		{name: "lv11_s2", level: 11, lights: 2},
		{name: "lv14_s3", level: 14, lights: 3},
		{name: "lv6_s1", level: 6, lights: 1},
		{name: "lv12_5_s2", level: 12.5, lights: 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := tjLoadFixture(t, tc.level)
			// lights Light hits require 2*lights-1 total AA (L D L D … L).
			hits := tc.lights*2 - 1
			gcohSetDriverHits(&runReq, hits, "tj_light")
			done := tjRun(t, compileReq, runReq)

			wantStacks := float64(tc.lights)
			if got := tjStateValue(t, done, tjLightKey); math.Abs(got-wantStacks) > tjTol {
				t.Fatalf("light_stacks=%v want %v", got, wantStacks)
			}
			want := tjExpectedLightBonus(tc.level, wantStacks)
			if got := sourceAttrResolved(t, done.FinalSnapshot, "armor"); math.Abs(got-want) > tjTol {
				t.Fatalf("armor=%v want %v (level=%v stacks=%v)", got, want, tc.level, wantStacks)
			}
			if got := sourceAttrResolved(t, done.FinalSnapshot, "magic_resist"); math.Abs(got-want) > tjTol {
				t.Fatalf("magic_resist=%v want %v", got, want)
			}
		})
	}
}

func TestGenericTerminusJuxtapositionNonBasicDoesNotAdvance(t *testing.T) {
	compileReq, runReq := tjLoadFixture(t, 1)
	tjAttachNonBasicAbility(&compileReq)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "spell", AbilityRef: tjProbeRef(tjNonBasicKey), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 100
	done := tjRun(t, compileReq, runReq)

	if countEmittedEvents(done, gcohHitEvent) != 0 {
		t.Fatalf("basic_attack_hit=%d want 0", countEmittedEvents(done, gcohHitEvent))
	}
	tjAssertStacks(t, done, 0, 0, tjPolarityLight)
	n, _, _ := gcohDamageEvidence(done, tjShadowOpRef, false)
	if n != 0 {
		t.Fatalf("shadow procs=%d want 0", n)
	}
}

func TestGenericTerminusJuxtapositionSkippedAttemptDoesNotAdvance(t *testing.T) {
	compileReq, runReq := tjLoadFixture(t, 1)
	tjAttachGatedAA(&compileReq)
	gatedRef := tjProbeRef(tjGatedAAKey)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa1", AbilityRef: gatedRef, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa_skip", AbilityRef: gatedRef, Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := tjRun(t, compileReq, runReq)

	if done.Summary.AttemptSkippedCount < 1 {
		t.Fatalf("attemptSkippedCount=%d want >=1", done.Summary.AttemptSkippedCount)
	}
	skipN := 0
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindAttemptSkipped &&
			item.Data["skipReason"] == string(model.AttemptSkipCooldownNotReady) {
			skipN++
		}
	}
	if skipN < 1 {
		t.Fatal("expected cooldown skip evidence")
	}
	if countEmittedEvents(done, gcohHitEvent) != 1 {
		t.Fatalf("basic_attack_hit=%d want 1", countEmittedEvents(done, gcohHitEvent))
	}
	tjAssertStacks(t, done, 1, 0, tjPolarityDark)
	tjAssertShadowRaw(t, done, 1)
}

func TestGenericTerminusJuxtapositionShadowRemainsAndPhantomDoesNotDoubleAdvance(t *testing.T) {
	compileReq, runReq := tjLoadFixture(t, 1)
	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[0].Operations = gcohAAOpsWithGuinsooStack()
	copyableAmt := 30.0
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "guinsoo_copyable",
			EventMatcher: model.TypeMatcher{All: []string{gcohHitEvent, "event/source_owner"}},
			Operations: []model.OperationDefinition{{
				Operation: "damage", Target: "target", DamageType: "damage/magic",
				Amount: tjConst(copyableAmt), CopyableOnHit: true, Ref: "op:guinsoo_copyable",
			}},
		},
		{
			ListenerKey:  "guinsoo_repeat",
			EventMatcher: model.TypeMatcher{All: []string{gcohHitEvent, "event/source_owner"}},
			Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
		},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			gcohChampionRef: map[string]interface{}{
				"state": map[string]interface{}{guinsooStackKey: float64(3)},
			},
		}
	}
	gcohSetDriverHits(&runReq, 1, "tj_phant")
	done := tjRun(t, compileReq, runReq)

	if countEmittedEvents(done, gcohHitEvent) != 1 {
		t.Fatalf("basic_attack_hit=%d want 1 (phantom must not re-emit)", countEmittedEvents(done, gcohHitEvent))
	}
	tjAssertStacks(t, done, 1, 0, tjPolarityDark)
	tjAssertShadowRaw(t, done, 1)
	nPhant, rawPhant, _ := gcohDamageEvidence(done, tjShadowOpRef, true)
	if nPhant != 1 || math.Abs(rawPhant-tjShadowRaw) > tjTol {
		t.Fatalf("phantom shadow n=%d raw=%v want 1 / 30", nPhant, rawPhant)
	}
	if n := countPhantomDamageByOpRef(done, "op:guinsoo_copyable"); n != 1 {
		t.Fatalf("phantom guinsoo copyable=%d want 1", n)
	}
}

func TestGenericTerminusJuxtapositionSameRunAttributeRecalc(t *testing.T) {
	compileReq, runReq := tjLoadFixture(t, 11)
	tjAttachProbeAbilities(&compileReq)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa1", AbilityRef: gcohAARef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa2", AbilityRef: gcohAARef(), Source: "source", Target: "target", FirstAtMs: 100},
		{EntryKey: "aa3", AbilityRef: gcohAARef(), Source: "source", Target: "target", FirstAtMs: 200},
		// light last write @200 → expire 5200; dark @100 → expire 5100; probe forces recalc.
		{EntryKey: "probe", AbilityRef: tjProbeRef(tjProbePhysKey), Source: "source", Target: "target", FirstAtMs: 5200},
	}
	runReq.StopPolicy.DurationMs = 5250
	done := tjRun(t, compileReq, runReq)

	tjAssertStacks(t, done, 0, 0, tjPolarityDark)
	if got := sourceAttrResolved(t, done.FinalSnapshot, "armor"); math.Abs(got) > tjTol {
		t.Fatalf("armor after expiry recalc=%v want 0", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "armor_pen_percent"); math.Abs(got) > tjTol {
		t.Fatalf("armor_pen_percent after expiry recalc=%v want 0", got)
	}
}
