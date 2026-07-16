package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_xayah W Deadly Plumage / 致死羽衣 (generic ABI, rank-5 AS partial).
//
// Local Data Dragon 16.9.1 XayahW (rank5 partial):
//   - active ability; mana cost 40; cooldown 14000 ms
//   - successful cast arms timed provider state deadly_plumage_active=1
//     (max1, durationMs=4000, refresh_on_write / refresh_duration)
//   - owner-self attack_speed percent_add =
//     0.55 * provider.state.deadly_plumage_active
//
// Remaining gaps (explicit non-goals this batch):
//   - Secondary feather blades deal 20% of the original attack's damage: requires
//     copy/proportion settlement from already-resolved real attack damage, without
//     copying on-hit / phantom semantics. Not implemented here (no fake secondary
//     feather damage ops).
//   - Move-speed branch and Rakan synergy are non-damage OOS.
//   - Other ranks / Backend publish / live publish.

const (
	xayahDPProviderRef = "hero:xayah"
	xayahDPStableID    = "hero_xayah"
	xayahDPWKey        = "deadly_plumage"
	xayahDPProbeKey    = "xayah_deadly_plumage_probe"
	xayahDPActiveKey   = "deadly_plumage_active"
	xayahDPASModKey    = "deadly_plumage_attack_speed"
	xayahDPListenerArm = "listener_hero_xayah_deadly_plumage_arm"
	xayahDPCastEvent   = "event/ability_started"

	xayahDPManaCost    = 40.0
	xayahDPCDMs        = 14000.0
	xayahDPASBuffDurMs = 4000.0
	xayahDPASBonus     = 0.55
	xayahDPBaseAS      = 0.60
	xayahDPResolvedAS  = 0.93 // 0.60 * (1 + 0.55)
	xayahDPFixtureMana = 100.0
	xayahDPManaAfter1  = 60.0 // 100 - 40
	xayahDPManaAfter2  = 20.0 // 100 - 40 - 40
)

func xayahDPTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func xayahDPStateSchema() map[string]interface{} {
	return map[string]interface{}{
		xayahDPActiveKey: xayahDPTimedSlot(0, 1, xayahDPASBuffDurMs),
	}
}

func xayahDPASModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: xayahDPASModKey,
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(xayahDPASBonus),
				{Op: "read", Path: "provider.state." + xayahDPActiveKey},
			},
		},
	}
}

func xayahDPCastArmListener() model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey:  xayahDPListenerArm,
		EventMatcher: model.TypeMatcher{All: []string{xayahDPCastEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         xayahDPActiveKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		},
	}
}

func xayahDPWAbility() model.AbilityDefinition {
	cost := xayahDPManaCost
	cd := xayahDPCDMs
	return model.AbilityDefinition{
		AbilityKey: xayahDPWKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// AS arm is via ability_started → source-owner listener; W itself has no
		// damage ops (secondary feather gap is explicit above — not stubbed here).
		Operations: []model.OperationDefinition{},
	}
}

func xayahDPProbeAbility() model.AbilityDefinition {
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: xayahDPProbeKey,
		Kind:       "active",
		// Typed as basic_attack so the probe does not synthesize ability_started
		// (which would re-arm deadly_plumage_active via the source-owner listener).
		Types: []string{"ability/basic_attack"},
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
				Ref:        "op:xayah_deadly_plumage_probe",
			},
		},
	}
}

func ensureXayahDPTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: xayahDPCastEvent, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
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

func configureXayahDPProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders[0] = model.ProviderDefinition{
		ProviderKey:        xayahDPProviderRef,
		Kind:               "champion",
		StableID:           xayahDPStableID,
		InitialStateSchema: xayahDPStateSchema(),
		Modifiers:          []model.ModifierDefinition{xayahDPASModifier()},
		Listeners:          []model.ListenerDefinition{xayahDPCastArmListener()},
		Abilities: []model.AbilityDefinition{
			xayahDPWAbility(),
			xayahDPProbeAbility(),
		},
	}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: xayahDPProviderRef, DefinitionRef: xayahDPProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: xayahDPProviderRef, DefinitionRef: xayahDPProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func xayahDPWRef() string {
	return "source.provider[" + xayahDPProviderRef + "].ability[" + xayahDPWKey + "]"
}

func xayahDPProbeRef() string {
	return "source.provider[" + xayahDPProviderRef + "].ability[" + xayahDPProbeKey + "]"
}

func loadXayahDPFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureXayahDPTypes(&compileReq)
	configureXayahDPProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: xayahDPBaseAS, Current: xayahDPBaseAS, Max: xayahDPBaseAS, Resolved: xayahDPBaseAS,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: xayahDPFixtureMana, Max: xayahDPFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runXayahDP(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func xayahDPStateValue(t *testing.T, done model.DoneResult, key string) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[xayahDPProviderRef].(map[string]interface{})
		if !ok {
			// Idle schema fields may be absent from the snapshot until first write.
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

func xayahDPSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func xayahDPSourceASSlot(t *testing.T, snap model.Snapshot) model.AttributeSlotDef {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Attributes["attack_speed"]
		if !ok {
			t.Fatal("source attack_speed missing")
		}
		return slot
	}
	t.Fatal("source missing")
	return model.AttributeSlotDef{}
}

func xayahDPSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Data["skipReason"] == string(reason) {
			n++
		}
	}
	return n
}

func assertXayahDPWHasNoDamageOperations(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	var ability *model.AbilityDefinition
	for i := range compileReq.SharedProviders[0].Abilities {
		a := &compileReq.SharedProviders[0].Abilities[i]
		if a.AbilityKey == xayahDPWKey {
			ability = a
			break
		}
	}
	if ability == nil {
		t.Fatal("deadly_plumage ability missing")
	}
	if len(ability.Operations) != 0 {
		t.Fatalf("deadly_plumage operations=%+v want empty (no damage ops)", ability.Operations)
	}
}

// TestGenericXayahDeadlyPlumageRank5ASCrossCheck: base AS 0.60 * (1 + 0.55) = 0.93.
func TestGenericXayahDeadlyPlumageRank5ASCrossCheck(t *testing.T) {
	want := xayahDPBaseAS * (1 + xayahDPASBonus)
	if math.Abs(want-xayahDPResolvedAS) > 1e-12 {
		t.Fatalf("formula=%v want %v", want, xayahDPResolvedAS)
	}
	if math.Abs(want-0.93) > 1e-12 {
		t.Fatalf("resolved AS=%v want 0.93", want)
	}
}

// TestGenericXayahDeadlyPlumageBaselineASBeforeCast: no W cast → AS stays base; state idle.
func TestGenericXayahDeadlyPlumageBaselineASBeforeCast(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "probe", AbilityRef: xayahDPProbeRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runXayahDP(t, compileReq, runReq)

	if countEmittedEvents(done, xayahDPCastEvent) != 0 {
		t.Fatalf("ability_started=%d want 0 before W cast", countEmittedEvents(done, xayahDPCastEvent))
	}
	if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 0 {
		t.Fatalf("deadly_plumage_active=%v want 0 before cast", got)
	}
	slot := xayahDPSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-xayahDPBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base=%v want %v", slot.Base, xayahDPBaseAS)
	}
	if math.Abs(slot.Resolved-xayahDPBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want baseline %v", slot.Resolved, xayahDPBaseAS)
	}
	if got := xayahDPSourceMana(t, done.FinalSnapshot); math.Abs(got-xayahDPFixtureMana) > 1e-9 {
		t.Fatalf("mana=%v want %v (no W cost)", got, xayahDPFixtureMana)
	}
}

// TestGenericXayahDeadlyPlumageCastSpendsManaArmsTimedAS: cast → mana 100→60, state armed,
// AS 0.60→0.93; W itself deals no damage; base view unpolluted.
func TestGenericXayahDeadlyPlumageCastSpendsManaArmsTimedAS(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)
	assertXayahDPWHasNoDamageOperations(t, compileReq)

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runXayahDP(t, compileReq, runReq)

	if countEmittedEvents(done, xayahDPCastEvent) != 1 {
		t.Fatalf("ability_started=%d want 1", countEmittedEvents(done, xayahDPCastEvent))
	}
	if got := xayahDPSourceMana(t, done.FinalSnapshot); math.Abs(got-xayahDPManaAfter1) > 1e-9 {
		t.Fatalf("mana=%v want %v", got, xayahDPManaAfter1)
	}
	if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 1 {
		t.Fatalf("deadly_plumage_active=%v want 1", got)
	}
	slot := xayahDPSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-xayahDPBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base=%v want %v (modifier must not mutate base)", slot.Base, xayahDPBaseAS)
	}
	if math.Abs(slot.Resolved-xayahDPResolvedAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want %v", slot.Resolved, xayahDPResolvedAS)
	}
	if math.Abs(done.Summary.SourceDamageDealt) > 1e-12 {
		t.Fatalf("sourceDamageDealt=%v want 0 (W has no damage ops)", done.Summary.SourceDamageDealt)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1", done.Summary.AbilityCastCount)
	}
}

// TestGenericXayahDeadlyPlumageASExpiresAfter4000ms: timed state expires → AS restores to 0.60.
func TestGenericXayahDeadlyPlumageASExpiresAfter4000ms(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "probe_expired", AbilityRef: xayahDPProbeRef(), Source: "source", Target: "target", FirstAtMs: 4001},
	}
	runReq.StopPolicy.DurationMs = 4100
	done := runXayahDP(t, compileReq, runReq)

	if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 0 {
		t.Fatalf("deadly_plumage_active after expiry=%v want 0", got)
	}
	slot := xayahDPSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-xayahDPBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base after expiry=%v want %v", slot.Base, xayahDPBaseAS)
	}
	if math.Abs(slot.Resolved-xayahDPBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved after expiry=%v want baseline %v", slot.Resolved, xayahDPBaseAS)
	}
}

// TestGenericXayahDeadlyPlumageCooldownSkipDoesNotRecast: during CD, second attempt skips;
// no second cost / state rewrite / ability_started.
func TestGenericXayahDeadlyPlumageCooldownSkipDoesNotRecast(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w1", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w2", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runXayahDP(t, compileReq, runReq)

	if xayahDPSkipReasonCount(done, model.AttemptSkipCooldownNotReady) < 1 {
		t.Fatal("expected cooldown_not_ready skip for second W during CD")
	}
	if countEmittedEvents(done, xayahDPCastEvent) != 1 {
		t.Fatalf("ability_started=%d want 1 (no second cast event)", countEmittedEvents(done, xayahDPCastEvent))
	}
	if got := xayahDPSourceMana(t, done.FinalSnapshot); math.Abs(got-xayahDPManaAfter1) > 1e-9 {
		t.Fatalf("mana=%v want %v (no second cost)", got, xayahDPManaAfter1)
	}
	if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 1 {
		t.Fatalf("deadly_plumage_active=%v want 1 (still armed once)", got)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1 (second W skipped)", done.Summary.AbilityCastCount)
	}
}

// TestGenericXayahDeadlyPlumageRecastAfterCDRefreshesAS: after 14000ms CD, second cast succeeds,
// spends another 40 mana, and refresh_on_write re-arms the 4000ms AS window.
func TestGenericXayahDeadlyPlumageRecastAfterCDRefreshesAS(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w1", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w2", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 14000},
		{EntryKey: "probe_live", AbilityRef: xayahDPProbeRef(), Source: "source", Target: "target", FirstAtMs: 17999},
	}
	runReq.StopPolicy.DurationMs = 18050
	done := runXayahDP(t, compileReq, runReq)

	if countEmittedEvents(done, xayahDPCastEvent) != 2 {
		t.Fatalf("ability_started=%d want 2 (W only; probe is basic_attack)", countEmittedEvents(done, xayahDPCastEvent))
	}
	// AbilityCastCount includes the basic_attack probe used to force final resolve.
	if done.Summary.AbilityCastCount != 3 {
		t.Fatalf("abilityCastCount=%d want 3 (2 W + 1 probe)", done.Summary.AbilityCastCount)
	}
	if got := xayahDPSourceMana(t, done.FinalSnapshot); math.Abs(got-xayahDPManaAfter2) > 1e-9 {
		t.Fatalf("mana=%v want %v (two successful casts)", got, xayahDPManaAfter2)
	}
	if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 1 {
		t.Fatalf("deadly_plumage_active after refresh=%v want 1", got)
	}
	slot := xayahDPSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-xayahDPBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base=%v want %v (modifier must not mutate base)", slot.Base, xayahDPBaseAS)
	}
	if math.Abs(slot.Resolved-xayahDPResolvedAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved after refresh=%v want %v", slot.Resolved, xayahDPResolvedAS)
	}
}

// TestGenericXayahDeadlyPlumageRefreshWindowExpires: second cast at 14000ms → AS expires at 18001.
func TestGenericXayahDeadlyPlumageRefreshWindowExpires(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w1", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w2", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 14000},
		{EntryKey: "probe_expired", AbilityRef: xayahDPProbeRef(), Source: "source", Target: "target", FirstAtMs: 18001},
	}
	runReq.StopPolicy.DurationMs = 18100
	done := runXayahDP(t, compileReq, runReq)

	if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 0 {
		t.Fatalf("deadly_plumage_active after refresh expiry=%v want 0", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-xayahDPBaseAS) > 1e-9 {
		t.Fatalf("attack_speed after refresh expiry=%v want baseline %v", got, xayahDPBaseAS)
	}
}
