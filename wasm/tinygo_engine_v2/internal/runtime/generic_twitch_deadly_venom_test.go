package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_twitch P Deadly Venom / 死亡毒液 — generic ABI evidence
// (FROZEN_PLAN_REV: twitch-deadly-venom-anchored-tick-v3).
//
// Self-contained CompileGeneric + RunGeneric fixture aligned with
// db/game_manage/seeds/lol_generic_twitch_deadly_venom_seed.sql:
//   - source owns champion AA (exactly one event/basic_attack_hit after damage)
//     plus independent passive provider_hero_twitch_deadly_venom
//   - provider_target deadly_venom_stacks: base0/max6/duration6000/refresh_on_write
//   - source-owner basic_attack_hit listener, ALL matcher, max1/event, add1 stack
//   - anchored tick interval1000/startDelay0,
//     anchorScope=state_scope/provider_target, anchorStateKey=deadly_venom_stacks
//   - five mutually exclusive onTick true-damage bands by champion_level:
//     1-4→1, 5-8→2, 9-12→3, 13-16→4, 17-18→5;
//     amount = (flat + 0.03*AP.resolved)*stacks; noncrit/noncopyable; dot+proc traits
//
// Paths use Wasm-canonical source.attr.* (Backend $owner projects here).
// No private scheduler handlers; no production edits.

const (
	twitchDVHeroStableID   = "hero_twitch"
	twitchDVProviderRef    = "provider_hero_twitch_deadly_venom"
	twitchDVListenerKey    = "listener_hero_twitch_deadly_venom"
	twitchDVTickAbilityKey = "deadly_venom_tick"
	twitchDVStateKey       = "deadly_venom_stacks"
	twitchDVHitEvent       = spellbladeHitEvent
	twitchDVChampionRef    = spellbladeChampionRef
	twitchDVAAOpRef        = "op:twitch_aa"

	twitchDVMaxStacks   = 6.0
	twitchDVDurationMs  = 6000.0
	twitchDVIntervalMs  = int64(1000)
	twitchDVAPRatio     = 0.03
	twitchDVAADamage    = 10.0
	twitchDVTargetHP    = 100000.0
	twitchDVTol         = 1e-9
)

var twitchDVFlatByLevel = []struct {
	level float64
	flat  float64
	opRef string
}{
	{1, 1, "op:deadly_venom_tick_flat1"},
	{5, 2, "op:deadly_venom_tick_flat2"},
	{9, 3, "op:deadly_venom_tick_flat3"},
	{13, 4, "op:deadly_venom_tick_flat4"},
	{17, 5, "op:deadly_venom_tick_flat5"},
	{18, 5, "op:deadly_venom_tick_flat5"},
}

func twitchDVExpectedTickRaw(flat, ap, stacks float64) float64 {
	return (flat + twitchDVAPRatio*ap) * stacks
}

func twitchDVConst(v float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: &v}
}

func twitchDVTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func twitchDVStateSchema() map[string]interface{} {
	return map[string]interface{}{
		twitchDVStateKey: twitchDVTimedSlot(0, twitchDVMaxStacks, twitchDVDurationMs),
	}
}

func twitchDVEnsureTypes(req *model.CompileRequest) {
	gcohEnsureTypes(req)
	need := []model.TypeCatalogEntry{
		{Key: "ability/tick", Domain: "ability"},
		{Key: "state_scope/provider_target", Domain: "state_scope"},
		{Key: "damage/true", Domain: "damage"},
		{Key: "damage_trait/dot", Domain: "damage_trait"},
		{Key: "damage_trait/proc", Domain: "damage_trait"},
	}
	have := map[string]bool{}
	for _, t := range req.TypeCatalog.Types {
		have[t.Key] = true
	}
	for _, e := range need {
		if !have[e.Key] {
			req.TypeCatalog.Types = append(req.TypeCatalog.Types, e)
		}
	}
}

func twitchDVLevelBandCond(lo, hi float64) *model.GenericFormulaExpr {
	levelPath := "source.attr.champion_level.resolved"
	return &model.GenericFormulaExpr{
		Op: "min",
		Args: []model.GenericFormulaExpr{
			{
				Op: "gte",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: levelPath},
					{Op: "const", Value: &lo},
				},
			},
			{
				Op: "lte",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: levelPath},
					{Op: "const", Value: &hi},
				},
			},
		},
	}
}

func twitchDVTickAmount(flat float64) *model.GenericFormulaExpr {
	ratio := twitchDVAPRatio
	return &model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &flat},
					{
						Op: "mul",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &ratio},
							{Op: "read", Path: "source.attr.ap.resolved"},
						},
					},
				},
			},
			{Op: "read", Path: "provider.target_state." + twitchDVStateKey},
		},
	}
}

func twitchDVTickDamageOp(flat float64, lo, hi float64, opRef string) model.OperationDefinition {
	return model.OperationDefinition{
		Operation:     "damage",
		Target:        "target",
		DamageType:    "damage/true",
		Ref:           opRef,
		Types:         []string{"damage_trait/dot", "damage_trait/proc"},
		CopyableOnHit: false,
		CritEligible:  false,
		Condition:     twitchDVLevelBandCond(lo, hi),
		Amount:        twitchDVTickAmount(flat),
	}
}

func twitchDVTickAbility() model.AbilityDefinition {
	return model.AbilityDefinition{
		AbilityKey: twitchDVTickAbilityKey,
		Kind:       "tick",
		Types:      []string{"ability/tick"},
		TickSpec: &model.TickSpec{
			IntervalMs:     twitchDVIntervalMs,
			StartDelayMs:   0,
			AnchorScope:    "state_scope/provider_target",
			AnchorStateKey: twitchDVStateKey,
			OnTick: []model.OperationDefinition{
				twitchDVTickDamageOp(1, 1, 4, "op:deadly_venom_tick_flat1"),
				twitchDVTickDamageOp(2, 5, 8, "op:deadly_venom_tick_flat2"),
				twitchDVTickDamageOp(3, 9, 12, "op:deadly_venom_tick_flat3"),
				twitchDVTickDamageOp(4, 13, 16, "op:deadly_venom_tick_flat4"),
				twitchDVTickDamageOp(5, 17, 18, "op:deadly_venom_tick_flat5"),
			},
		},
	}
}

func twitchDVListener() model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey:         twitchDVListenerKey,
		MaxTriggersPerEvent: 1,
		EventMatcher:        model.TypeMatcher{All: []string{twitchDVHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{{
			Operation:   "state_change",
			Target:      "source",
			Ref:         twitchDVStateKey,
			Types:       []string{"state_scope/provider_target"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		}},
	}
}

func twitchDVConfigureAA(compileReq *model.CompileRequest) {
	aa := twitchDVAADamage
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: gcohHitAbility,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
				Ref:        twitchDVAAOpRef,
			},
			{
				Operation: "emit_event",
				Target:    "target",
				EventType: twitchDVHitEvent,
				Ref:       twitchDVHitEvent,
			},
		},
	}}
}

func twitchDVMountPassive(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        twitchDVProviderRef,
		Kind:               "passive",
		StableID:           twitchDVHeroStableID,
		InitialStateSchema: twitchDVStateSchema(),
		Listeners:          []model.ListenerDefinition{twitchDVListener()},
		Abilities:          []model.AbilityDefinition{twitchDVTickAbility()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: twitchDVProviderRef, DefinitionRef: twitchDVProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: twitchDVProviderRef, DefinitionRef: twitchDVProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

type twitchDVFixtureOpts struct {
	level float64
	ap    float64
	armor float64
	mr    float64
}

func twitchDVLoadFixture(t *testing.T, opts twitchDVFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.level <= 0 {
		opts.level = 1
	}
	compileReq, runReq := loadBasicFixture(t)
	twitchDVEnsureTypes(&compileReq)
	twitchDVConfigureAA(&compileReq)
	twitchDVMountPassive(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "champion_level", model.AttributeSlotDef{
		Base: opts.level, Current: opts.level, Max: opts.level, Resolved: opts.level,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.ap, Current: opts.ap, Max: opts.ap, Resolved: opts.ap,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: twitchDVTargetHP, Current: twitchDVTargetHP, Max: twitchDVTargetHP, Resolved: twitchDVTargetHP,
	})
	if opts.armor != 0 {
		setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
			Base: opts.armor, Current: opts.armor, Max: opts.armor, Resolved: opts.armor,
		})
	}
	if opts.mr != 0 {
		setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
			Base: opts.mr, Current: opts.mr, Max: opts.mr, Resolved: opts.mr,
		})
	}

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 100
	return compileReq, runReq
}

func twitchDVAARef() string {
	return "source.provider[" + twitchDVChampionRef + "].ability[" + gcohHitAbility + "]"
}

func twitchDVSetDriverHits(runReq *model.RunRequest, times []int64) {
	ref := twitchDVAARef()
	entries := make([]model.DriverEntry, 0, len(times))
	for i, at := range times {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "hit_" + itoaRuntime(i),
			AbilityRef: ref,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  at,
		})
	}
	runReq.DriverPlan.Entries = entries
}

func twitchDVRun(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func twitchDVAllTickOpRefs() []string {
	return []string{
		"op:deadly_venom_tick_flat1",
		"op:deadly_venom_tick_flat2",
		"op:deadly_venom_tick_flat3",
		"op:deadly_venom_tick_flat4",
		"op:deadly_venom_tick_flat5",
	}
}

func twitchDVTickDamageItems(done model.DoneResult) []model.EvidenceItem {
	want := map[string]bool{}
	for _, ref := range twitchDVAllTickOpRefs() {
		want[ref] = true
	}
	var out []model.EvidenceItem
	for _, item := range damageEvidenceItems(done) {
		if phantom, _ := item.Data["phantom"].(bool); phantom {
			continue
		}
		if !want[evidenceDataString(item.Data, "operationRef")] {
			continue
		}
		out = append(out, item)
	}
	return out
}

func twitchDVTickDamageAt(done model.DoneResult, timeMs int64) (raw, mitigated float64, source, target, opRef string, ok bool) {
	for _, item := range twitchDVTickDamageItems(done) {
		if item.TimeMs != timeMs {
			continue
		}
		return evidenceDataFloat(item.Data, "rawAmount"),
			evidenceDataFloat(item.Data, "mitigatedAmount"),
			evidenceDataString(item.Data, "source"),
			evidenceDataString(item.Data, "target"),
			evidenceDataString(item.Data, "operationRef"),
			true
	}
	return 0, 0, "", "", "", false
}

func twitchDVStacks(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		raw, ok := c.ProviderState[twitchDVProviderRef]
		if !ok {
			return 0
		}
		bag, ok := raw.(map[string]interface{})
		if !ok {
			return 0
		}
		ts, ok := bag["targetState"].(map[string]interface{})
		if !ok {
			return 0
		}
		values, ok := ts["values"].(map[string]interface{})
		if !ok {
			return 0
		}
		v, _ := values[twitchDVStateKey].(float64)
		return v
	}
	t.Fatalf("source combatant missing in finalSnapshot")
	return 0
}

func twitchDVAssertExactTimes(t *testing.T, got, want []int64) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("times=%v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("times=%v want %v", got, want)
		}
	}
}

// ---------------------------------------------------------------------------
// Evidence tests
// ---------------------------------------------------------------------------

func TestGenericTwitchDeadlyVenomNoPoisonBeforeFirstHit(t *testing.T) {
	compileReq, runReq := twitchDVLoadFixture(t, twitchDVFixtureOpts{level: 1, ap: 0})
	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 3000
	done := twitchDVRun(t, compileReq, runReq)

	if n := done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)]; n != 0 {
		t.Fatalf("provider_tick=%d want 0 before first basic_attack_hit", n)
	}
	if n := len(twitchDVTickDamageItems(done)); n != 0 {
		t.Fatalf("tick damage count=%d want 0", n)
	}
	if n := countEmittedEvents(done, twitchDVHitEvent); n != 0 {
		t.Fatalf("basic_attack_hit=%d want 0", n)
	}
	if got := twitchDVStacks(t, done); got != 0 {
		t.Fatalf("stacks=%v want 0", got)
	}
	if math.Abs(done.Summary.TargetFinalHp-twitchDVTargetHP) > twitchDVTol {
		t.Fatalf("targetFinalHp=%v want %v (no poison)", done.Summary.TargetFinalHp, twitchDVTargetHP)
	}
}

func TestGenericTwitchDeadlyVenomStacksPerHitCapAndSeventhRefresh(t *testing.T) {
	t.Run("one_stack_per_hit", func(t *testing.T) {
		for _, hits := range []int{1, 3, 6} {
			hits := hits
			t.Run("hits_"+itoaRuntime(hits), func(t *testing.T) {
				compileReq, runReq := twitchDVLoadFixture(t, twitchDVFixtureOpts{level: 1})
				times := make([]int64, hits)
				for i := 0; i < hits; i++ {
					times[i] = int64(i * 50)
				}
				twitchDVSetDriverHits(&runReq, times)
				// Stop before first possible tick (writeAt+1000).
				runReq.StopPolicy.DurationMs = times[len(times)-1] + 100
				done := twitchDVRun(t, compileReq, runReq)

				if n := countEmittedEvents(done, twitchDVHitEvent); n != hits {
					t.Fatalf("basic_attack_hit=%d want %d", n, hits)
				}
				if got := twitchDVStacks(t, done); math.Abs(got-float64(hits)) > twitchDVTol {
					t.Fatalf("stacks=%v want %d", got, hits)
				}
				if n := len(anchoredTickTimes(done)); n != 0 {
					t.Fatalf("premature ticks=%d want 0", n)
				}
			})
		}
	})

	t.Run("seventh_hit_clamps_six_and_refreshes_duration", func(t *testing.T) {
		compileReq, runReq := twitchDVLoadFixture(t, twitchDVFixtureOpts{level: 1, ap: 0})
		// Seven hits → stacks stay 6; last write at 600 refreshes expireAt to 6600.
		times := []int64{0, 100, 200, 300, 400, 500, 600}
		twitchDVSetDriverHits(&runReq, times)
		runReq.StopPolicy.DurationMs = 7000
		done := twitchDVRun(t, compileReq, runReq)

		if n := countEmittedEvents(done, twitchDVHitEvent); n != 7 {
			t.Fatalf("basic_attack_hit=%d want 7", n)
		}
		// After expire_cleanup at 6600, stacks reset; prove clamp via tick raw at inclusive expiry.
		wantTimes := []int64{1600, 2600, 3600, 4600, 5600, 6600}
		twitchDVAssertExactTimes(t, anchoredTickTimes(done), wantTimes)

		wantRaw := twitchDVExpectedTickRaw(1, 0, 6)
		for _, at := range wantTimes {
			raw, _, _, _, opRef, ok := twitchDVTickDamageAt(done, at)
			if !ok {
				t.Fatalf("missing tick damage at %d", at)
			}
			if opRef != "op:deadly_venom_tick_flat1" {
				t.Fatalf("at %d opRef=%q want flat1", at, opRef)
			}
			if math.Abs(raw-wantRaw) > twitchDVTol {
				t.Fatalf("at %d raw=%v want %v (6 stacks after seventh hit)", at, raw, wantRaw)
			}
		}
		if got := twitchDVStacks(t, done); got != 0 {
			t.Fatalf("after cleanup stacks=%v want 0", got)
		}
	})
}

func TestGenericTwitchDeadlyVenomLevelBandsChooseExactFlat(t *testing.T) {
	for _, tc := range twitchDVFlatByLevel {
		tc := tc
		t.Run("level_"+itoaRuntime(int(tc.level)), func(t *testing.T) {
			compileReq, runReq := twitchDVLoadFixture(t, twitchDVFixtureOpts{level: tc.level, ap: 0})
			twitchDVSetDriverHits(&runReq, []int64{0})
			runReq.StopPolicy.DurationMs = 1500
			done := twitchDVRun(t, compileReq, runReq)

			ticks := anchoredTickTimes(done)
			if len(ticks) != 1 || ticks[0] != 1000 {
				t.Fatalf("tick times=%v want [1000]", ticks)
			}
			raw, mitigated, source, target, opRef, ok := twitchDVTickDamageAt(done, 1000)
			if !ok {
				t.Fatal("missing tick damage at 1000")
			}
			wantRaw := twitchDVExpectedTickRaw(tc.flat, 0, 1)
			if opRef != tc.opRef {
				t.Fatalf("opRef=%q want %q (exactly one band)", opRef, tc.opRef)
			}
			if math.Abs(raw-wantRaw) > twitchDVTol {
				t.Fatalf("raw=%v want %v", raw, wantRaw)
			}
			if math.Abs(mitigated-wantRaw) > twitchDVTol {
				t.Fatalf("mitigated=%v want %v (true)", mitigated, wantRaw)
			}
			if source != model.SelectorSource || target != model.SelectorTarget {
				t.Fatalf("source/target=%q/%q want source/target", source, target)
			}
			for _, other := range twitchDVAllTickOpRefs() {
				if other == tc.opRef {
					continue
				}
				if n := countDamageByOpRef(done, other, false); n != 0 {
					t.Fatalf("other band %s count=%d want 0", other, n)
				}
			}
			if n := countDamageByOpRef(done, tc.opRef, false); n != 1 {
				t.Fatalf("band %s count=%d want 1", tc.opRef, n)
			}
		})
	}
}

func TestGenericTwitchDeadlyVenomAPRatioMultipliedByStacks(t *testing.T) {
	const ap = 100.0
	compileReq, runReq := twitchDVLoadFixture(t, twitchDVFixtureOpts{level: 1, ap: ap})
	// Two hits → stacks=2; last write at 100 → first live tick at 1100.
	twitchDVSetDriverHits(&runReq, []int64{0, 100})
	runReq.StopPolicy.DurationMs = 1200
	done := twitchDVRun(t, compileReq, runReq)

	ticks := anchoredTickTimes(done)
	if len(ticks) != 1 || ticks[0] != 1100 {
		t.Fatalf("tick times=%v want [1100]", ticks)
	}
	wantRaw := twitchDVExpectedTickRaw(1, ap, 2) // (1 + 0.03*100)*2 = 8
	if math.Abs(wantRaw-8) > twitchDVTol {
		t.Fatalf("helper algebra=%v want 8", wantRaw)
	}
	raw, mitigated, _, _, opRef, ok := twitchDVTickDamageAt(done, 1100)
	if !ok {
		t.Fatal("missing tick damage at 1100")
	}
	if opRef != "op:deadly_venom_tick_flat1" {
		t.Fatalf("opRef=%q want flat1", opRef)
	}
	if math.Abs(raw-wantRaw) > twitchDVTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mitigated-wantRaw) > twitchDVTol {
		t.Fatalf("mitigated=%v want %v", mitigated, wantRaw)
	}
}

func TestGenericTwitchDeadlyVenomTrueIgnoresExtremeArmorMR(t *testing.T) {
	compileReq, runReq := twitchDVLoadFixture(t, twitchDVFixtureOpts{
		level: 9, // flat3
		ap:    0,
		armor: 9999,
		mr:    9999,
	})
	twitchDVSetDriverHits(&runReq, []int64{0})
	runReq.StopPolicy.DurationMs = 1500
	done := twitchDVRun(t, compileReq, runReq)

	wantRaw := twitchDVExpectedTickRaw(3, 0, 1)
	raw, mitigated, source, target, opRef, ok := twitchDVTickDamageAt(done, 1000)
	if !ok {
		t.Fatal("missing tick damage at 1000")
	}
	if opRef != "op:deadly_venom_tick_flat3" {
		t.Fatalf("opRef=%q want flat3", opRef)
	}
	if math.Abs(raw-wantRaw) > twitchDVTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mitigated-wantRaw) > twitchDVTol {
		t.Fatalf("mitigated=%v want %v (true ignores armor/MR)", mitigated, wantRaw)
	}
	if source != model.SelectorSource || target != model.SelectorTarget {
		t.Fatalf("source/target=%q/%q want source/target", source, target)
	}
	// AA physical is mitigated; tick true is not — HP drop must include full tick raw.
	aaCount, _, aaMit := gcohDamageEvidence(done, twitchDVAAOpRef, false)
	if aaCount != 1 {
		t.Fatalf("aa damage count=%d want 1", aaCount)
	}
	wantHP := twitchDVTargetHP - aaMit - wantRaw
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > twitchDVTol {
		t.Fatalf("targetFinalHp=%v want %v (aaMit=%v + tick=%v)", done.Summary.TargetFinalHp, wantHP, aaMit, wantRaw)
	}
}

func TestGenericTwitchDeadlyVenomRefreshRestartsCadenceInclusiveCleanup(t *testing.T) {
	compileReq, runReq := twitchDVLoadFixture(t, twitchDVFixtureOpts{level: 1, ap: 0})
	twitchDVSetDriverHits(&runReq, []int64{0, 2500})
	runReq.StopPolicy.DurationMs = 9000
	done := twitchDVRun(t, compileReq, runReq)

	// gen1 executed: 1000,2000; gen1 3000..6000 stale after refresh at 2500.
	// gen2 from 2500: 3500..8500 inclusive.
	want := []int64{1000, 2000, 3500, 4500, 5500, 6500, 7500, 8500}
	twitchDVAssertExactTimes(t, anchoredTickTimes(done), want)

	// Hit at 0 → stacks=1 for gen1 ticks; hit at 2500 → stacks=2 for gen2 ticks.
	raw1000, _, _, _, _, ok := twitchDVTickDamageAt(done, 1000)
	if !ok {
		t.Fatal("missing damage at 1000")
	}
	if math.Abs(raw1000-twitchDVExpectedTickRaw(1, 0, 1)) > twitchDVTol {
		t.Fatalf("raw@1000=%v want %v", raw1000, twitchDVExpectedTickRaw(1, 0, 1))
	}
	raw2000, _, _, _, _, ok := twitchDVTickDamageAt(done, 2000)
	if !ok {
		t.Fatal("missing damage at 2000")
	}
	if math.Abs(raw2000-twitchDVExpectedTickRaw(1, 0, 1)) > twitchDVTol {
		t.Fatalf("raw@2000=%v want %v", raw2000, twitchDVExpectedTickRaw(1, 0, 1))
	}
	wantRawGen2 := twitchDVExpectedTickRaw(1, 0, 2)
	for _, at := range []int64{3500, 4500, 5500, 6500, 7500, 8500} {
		raw, _, source, target, _, ok := twitchDVTickDamageAt(done, at)
		if !ok {
			t.Fatalf("missing damage at %d", at)
		}
		if math.Abs(raw-wantRawGen2) > twitchDVTol {
			t.Fatalf("raw@%d=%v want %v", at, raw, wantRawGen2)
		}
		if source != model.SelectorSource || target != model.SelectorTarget {
			t.Fatalf("at %d source/target=%q/%q", at, source, target)
		}
	}
	// Inclusive final tick at refreshed expireAt=8500; cleanup resets state.
	if got := twitchDVStacks(t, done); got != 0 {
		t.Fatalf("after cleanup stacks=%v want 0", got)
	}
}

func TestGenericTwitchDeadlyVenomSourceTargetAndNoRecursiveTickScheduling(t *testing.T) {
	compileReq, runReq := twitchDVLoadFixture(t, twitchDVFixtureOpts{level: 13, ap: 50})
	twitchDVSetDriverHits(&runReq, []int64{0})
	runReq.StopPolicy.DurationMs = 7000
	done := twitchDVRun(t, compileReq, runReq)

	wantTimes := []int64{1000, 2000, 3000, 4000, 5000, 6000}
	twitchDVAssertExactTimes(t, anchoredTickTimes(done), wantTimes)

	if n := countEmittedEvents(done, twitchDVHitEvent); n != 1 {
		t.Fatalf("basic_attack_hit=%d want 1 (tick must not re-emit)", n)
	}
	if n := done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)]; n != 6 {
		t.Fatalf("provider_tick=%d want 6 (no recursive reschedule)", n)
	}

	items := twitchDVTickDamageItems(done)
	if len(items) != 6 {
		t.Fatalf("tick damage count=%d want 6", len(items))
	}
	wantRaw := twitchDVExpectedTickRaw(4, 50, 1) // flat4 + 0.03*50
	for _, item := range items {
		raw := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		src := evidenceDataString(item.Data, "source")
		tgt := evidenceDataString(item.Data, "target")
		opRef := evidenceDataString(item.Data, "operationRef")
		if opRef != "op:deadly_venom_tick_flat4" {
			t.Fatalf("opRef=%q want flat4", opRef)
		}
		if math.Abs(raw-wantRaw) > twitchDVTol || math.Abs(mit-wantRaw) > twitchDVTol {
			t.Fatalf("at %d raw/mit=%v/%v want %v", item.TimeMs, raw, mit, wantRaw)
		}
		if src != model.SelectorSource {
			t.Fatalf("damage source=%q want source (Twitch provider owner, never owner-fallback)", src)
		}
		if tgt != model.SelectorTarget {
			t.Fatalf("damage target=%q want active event target", tgt)
		}
		traits := item.Data["traits"]
		if !c1TraitsContain(traits, "damage_trait/dot") || !c1TraitsContain(traits, "damage_trait/proc") {
			t.Fatalf("traits=%v want dot+proc", traits)
		}
	}
	for _, other := range twitchDVAllTickOpRefs() {
		if other == "op:deadly_venom_tick_flat4" {
			continue
		}
		if n := countDamageByOpRef(done, other, false); n != 0 {
			t.Fatalf("other band %s=%d want 0", other, n)
		}
	}
	if got := twitchDVStacks(t, done); got != 0 {
		t.Fatalf("after cleanup stacks=%v want 0", got)
	}
}
