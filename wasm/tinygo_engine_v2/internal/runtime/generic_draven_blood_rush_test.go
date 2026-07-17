package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_draven W Blood Rush / 血性冲刺 (generic ABI, rank-5 AS partial).
//
// Local Data Dragon 16.9.1 DravenFury (rank5):
//   - active ability; mana cost 20; cooldown 12000 ms
//   - successful cast arms timed provider state blood_rush_active=1
//     (max1, durationMs=3000, refresh_on_write / refresh_duration)
//   - owner-self attack_speed percent_add = 0.40 * provider.state.blood_rush_active
//
// Remaining gaps (explicit non-goals this batch):
//   - move-speed decaying branch
//   - catch spinning axe → refresh W cooldown
//   - other ranks / ghost / Backend publish

const (
	dravenBloodRushProviderRef = "hero:draven"
	dravenBloodRushStableID    = "hero_draven"
	dravenBloodRushWKey        = "blood_rush"
	dravenBloodRushProbeKey    = "draven_blood_rush_probe"
	dravenBloodRushActiveKey   = "blood_rush_active"
	dravenBloodRushASModKey    = "blood_rush_attack_speed"
	dravenBloodRushListenerArm = "listener_hero_draven_blood_rush_arm"
	dravenBloodRushCastEvent   = "event/ability_started"

	dravenBloodRushManaCost    = 20.0
	dravenBloodRushCDMs        = 12000.0
	dravenBloodRushASBuffDurMs = 3000.0
	dravenBloodRushASBonus     = 0.40
	dravenBloodRushBaseAS      = 0.60
	dravenBloodRushResolvedAS  = 0.84 // 0.60 * (1 + 0.40)
	dravenBloodRushFixtureMana = 100.0
	dravenBloodRushManaAfter1  = 80.0 // 100 - 20
	dravenBloodRushManaAfter2  = 60.0 // 100 - 20 - 20
)

func dravenBloodRushTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func dravenBloodRushStateSchema() map[string]interface{} {
	return map[string]interface{}{
		dravenBloodRushActiveKey: dravenBloodRushTimedSlot(0, 1, dravenBloodRushASBuffDurMs),
	}
}

func dravenBloodRushASModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: dravenBloodRushASModKey,
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(dravenBloodRushASBonus),
				{Op: "read", Path: "provider.state." + dravenBloodRushActiveKey},
			},
		},
	}
}

func dravenBloodRushCastArmListener() model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey:  dravenBloodRushListenerArm,
		EventMatcher: model.TypeMatcher{All: []string{dravenBloodRushCastEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         dravenBloodRushActiveKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		},
	}
}

func dravenBloodRushWAbility() model.AbilityDefinition {
	cost := dravenBloodRushManaCost
	cd := dravenBloodRushCDMs
	return model.AbilityDefinition{
		AbilityKey: dravenBloodRushWKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// AS arm is via ability_started → source-owner listener; W itself has no damage ops.
		Operations: []model.OperationDefinition{},
	}
}

func dravenBloodRushProbeAbility() model.AbilityDefinition {
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: dravenBloodRushProbeKey,
		Kind:       "active",
		// Typed as basic_attack so the probe does not synthesize ability_started
		// (which would re-arm blood_rush_active via the source-owner listener).
		Types: []string{"ability/basic_attack"},
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
				Ref:        "op:draven_blood_rush_probe",
			},
		},
	}
}

func ensureDravenBloodRushTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: dravenBloodRushCastEvent, Domain: "event"},
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

func configureDravenBloodRushProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders[0] = model.ProviderDefinition{
		ProviderKey:        dravenBloodRushProviderRef,
		Kind:               "champion",
		StableID:           dravenBloodRushStableID,
		InitialStateSchema: dravenBloodRushStateSchema(),
		Modifiers:          []model.ModifierDefinition{dravenBloodRushASModifier()},
		Listeners:          []model.ListenerDefinition{dravenBloodRushCastArmListener()},
		Abilities: []model.AbilityDefinition{
			dravenBloodRushWAbility(),
			dravenBloodRushProbeAbility(),
		},
	}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: dravenBloodRushProviderRef, DefinitionRef: dravenBloodRushProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: dravenBloodRushProviderRef, DefinitionRef: dravenBloodRushProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func dravenBloodRushWRef() string {
	return "source.provider[" + dravenBloodRushProviderRef + "].ability[" + dravenBloodRushWKey + "]"
}

func dravenBloodRushProbeRef() string {
	return "source.provider[" + dravenBloodRushProviderRef + "].ability[" + dravenBloodRushProbeKey + "]"
}

func loadDravenBloodRushFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureDravenBloodRushTypes(&compileReq)
	configureDravenBloodRushProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: dravenBloodRushBaseAS, Current: dravenBloodRushBaseAS, Max: dravenBloodRushBaseAS, Resolved: dravenBloodRushBaseAS,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: dravenBloodRushFixtureMana, Max: dravenBloodRushFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runDravenBloodRush(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func dravenBloodRushStateValue(t *testing.T, done model.DoneResult, key string) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[dravenBloodRushProviderRef].(map[string]interface{})
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

func dravenBloodRushSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func dravenBloodRushSourceASSlot(t *testing.T, snap model.Snapshot) model.AttributeSlotDef {
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

func dravenBloodRushSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Data["skipReason"] == string(reason) {
			n++
		}
	}
	return n
}

func assertDravenBloodRushWHasNoDamageOperations(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	var ability *model.AbilityDefinition
	for i := range compileReq.SharedProviders[0].Abilities {
		a := &compileReq.SharedProviders[0].Abilities[i]
		if a.AbilityKey == dravenBloodRushWKey {
			ability = a
			break
		}
	}
	if ability == nil {
		t.Fatal("blood_rush ability missing")
	}
	if len(ability.Operations) != 0 {
		t.Fatalf("blood_rush operations=%+v want empty (no damage ops)", ability.Operations)
	}
}

// TestGenericDravenBloodRushRank5ASCrossCheck: base AS 0.60 * (1 + 0.40) = 0.84.
func TestGenericDravenBloodRushRank5ASCrossCheck(t *testing.T) {
	want := dravenBloodRushBaseAS * (1 + dravenBloodRushASBonus)
	if math.Abs(want-dravenBloodRushResolvedAS) > 1e-12 {
		t.Fatalf("formula=%v want %v", want, dravenBloodRushResolvedAS)
	}
	if math.Abs(want-0.84) > 1e-12 {
		t.Fatalf("resolved AS=%v want 0.84", want)
	}
}

// TestGenericDravenBloodRushBaselineASBeforeCast: no W cast → AS stays base; state idle.
func TestGenericDravenBloodRushBaselineASBeforeCast(t *testing.T) {
	compileReq, runReq := loadDravenBloodRushFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "probe", AbilityRef: dravenBloodRushProbeRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runDravenBloodRush(t, compileReq, runReq)

	if countEmittedEvents(done, dravenBloodRushCastEvent) != 0 {
		t.Fatalf("ability_started=%d want 0 before W cast", countEmittedEvents(done, dravenBloodRushCastEvent))
	}
	if got := dravenBloodRushStateValue(t, done, dravenBloodRushActiveKey); got != 0 {
		t.Fatalf("blood_rush_active=%v want 0 before cast", got)
	}
	slot := dravenBloodRushSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-dravenBloodRushBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base=%v want %v", slot.Base, dravenBloodRushBaseAS)
	}
	if math.Abs(slot.Resolved-dravenBloodRushBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want baseline %v", slot.Resolved, dravenBloodRushBaseAS)
	}
	if got := dravenBloodRushSourceMana(t, done.FinalSnapshot); math.Abs(got-dravenBloodRushFixtureMana) > 1e-9 {
		t.Fatalf("mana=%v want %v (no W cost)", got, dravenBloodRushFixtureMana)
	}
}

// TestGenericDravenBloodRushCastSpendsManaArmsTimedAS: cast → mana 100→80, state armed,
// AS 0.60→0.84; W itself deals no damage; base view unpolluted.
func TestGenericDravenBloodRushCastSpendsManaArmsTimedAS(t *testing.T) {
	compileReq, runReq := loadDravenBloodRushFixture(t)
	assertDravenBloodRushWHasNoDamageOperations(t, compileReq)

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w", AbilityRef: dravenBloodRushWRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runDravenBloodRush(t, compileReq, runReq)

	if countEmittedEvents(done, dravenBloodRushCastEvent) != 1 {
		t.Fatalf("ability_started=%d want 1", countEmittedEvents(done, dravenBloodRushCastEvent))
	}
	if got := dravenBloodRushSourceMana(t, done.FinalSnapshot); math.Abs(got-dravenBloodRushManaAfter1) > 1e-9 {
		t.Fatalf("mana=%v want %v", got, dravenBloodRushManaAfter1)
	}
	if got := dravenBloodRushStateValue(t, done, dravenBloodRushActiveKey); got != 1 {
		t.Fatalf("blood_rush_active=%v want 1", got)
	}
	slot := dravenBloodRushSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-dravenBloodRushBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base=%v want %v (modifier must not mutate base)", slot.Base, dravenBloodRushBaseAS)
	}
	if math.Abs(slot.Resolved-dravenBloodRushResolvedAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want %v", slot.Resolved, dravenBloodRushResolvedAS)
	}
	if math.Abs(done.Summary.SourceDamageDealt) > 1e-12 {
		t.Fatalf("sourceDamageDealt=%v want 0 (W has no damage ops)", done.Summary.SourceDamageDealt)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1", done.Summary.AbilityCastCount)
	}
}

// TestGenericDravenBloodRushASExpiresAfter3000ms: timed state expires → AS restores to 0.60.
func TestGenericDravenBloodRushASExpiresAfter3000ms(t *testing.T) {
	compileReq, runReq := loadDravenBloodRushFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w", AbilityRef: dravenBloodRushWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "probe_expired", AbilityRef: dravenBloodRushProbeRef(), Source: "source", Target: "target", FirstAtMs: 3001},
	}
	runReq.StopPolicy.DurationMs = 3100
	done := runDravenBloodRush(t, compileReq, runReq)

	if got := dravenBloodRushStateValue(t, done, dravenBloodRushActiveKey); got != 0 {
		t.Fatalf("blood_rush_active after expiry=%v want 0", got)
	}
	slot := dravenBloodRushSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-dravenBloodRushBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base after expiry=%v want %v", slot.Base, dravenBloodRushBaseAS)
	}
	if math.Abs(slot.Resolved-dravenBloodRushBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved after expiry=%v want baseline %v", slot.Resolved, dravenBloodRushBaseAS)
	}
}

// TestGenericDravenBloodRushCooldownSkipDoesNotRecast: during CD, second attempt skips;
// no second cost / state rewrite / ability_started.
func TestGenericDravenBloodRushCooldownSkipDoesNotRecast(t *testing.T) {
	compileReq, runReq := loadDravenBloodRushFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w1", AbilityRef: dravenBloodRushWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w2", AbilityRef: dravenBloodRushWRef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runDravenBloodRush(t, compileReq, runReq)

	if dravenBloodRushSkipReasonCount(done, model.AttemptSkipCooldownNotReady) < 1 {
		t.Fatal("expected cooldown_not_ready skip for second W during CD")
	}
	if countEmittedEvents(done, dravenBloodRushCastEvent) != 1 {
		t.Fatalf("ability_started=%d want 1 (no second cast event)", countEmittedEvents(done, dravenBloodRushCastEvent))
	}
	if got := dravenBloodRushSourceMana(t, done.FinalSnapshot); math.Abs(got-dravenBloodRushManaAfter1) > 1e-9 {
		t.Fatalf("mana=%v want %v (no second cost)", got, dravenBloodRushManaAfter1)
	}
	if got := dravenBloodRushStateValue(t, done, dravenBloodRushActiveKey); got != 1 {
		t.Fatalf("blood_rush_active=%v want 1 (still armed once)", got)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1 (second W skipped)", done.Summary.AbilityCastCount)
	}
}

// TestGenericDravenBloodRushRecastAfterCDRefreshesAS: after 12000ms CD, second cast succeeds,
// spends another 20 mana, and refresh_on_write re-arms the 3000ms AS window.
func TestGenericDravenBloodRushRecastAfterCDRefreshesAS(t *testing.T) {
	compileReq, runReq := loadDravenBloodRushFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w1", AbilityRef: dravenBloodRushWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w2", AbilityRef: dravenBloodRushWRef(), Source: "source", Target: "target", FirstAtMs: 12000},
		{EntryKey: "probe_live", AbilityRef: dravenBloodRushProbeRef(), Source: "source", Target: "target", FirstAtMs: 14999},
	}
	runReq.StopPolicy.DurationMs = 15050
	done := runDravenBloodRush(t, compileReq, runReq)

	if countEmittedEvents(done, dravenBloodRushCastEvent) != 2 {
		t.Fatalf("ability_started=%d want 2 (W only; probe is basic_attack)", countEmittedEvents(done, dravenBloodRushCastEvent))
	}
	// AbilityCastCount includes the basic_attack probe used to force final resolve.
	if done.Summary.AbilityCastCount != 3 {
		t.Fatalf("abilityCastCount=%d want 3 (2 W + 1 probe)", done.Summary.AbilityCastCount)
	}
	if got := dravenBloodRushSourceMana(t, done.FinalSnapshot); math.Abs(got-dravenBloodRushManaAfter2) > 1e-9 {
		t.Fatalf("mana=%v want %v (two successful casts)", got, dravenBloodRushManaAfter2)
	}
	if got := dravenBloodRushStateValue(t, done, dravenBloodRushActiveKey); got != 1 {
		t.Fatalf("blood_rush_active after refresh=%v want 1", got)
	}
	slot := dravenBloodRushSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-dravenBloodRushBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base=%v want %v (modifier must not mutate base)", slot.Base, dravenBloodRushBaseAS)
	}
	if math.Abs(slot.Resolved-dravenBloodRushResolvedAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved after refresh=%v want %v", slot.Resolved, dravenBloodRushResolvedAS)
	}
}

// TestGenericDravenBloodRushRefreshWindowExpires: second cast at 12000ms → AS expires at 15001.
func TestGenericDravenBloodRushRefreshWindowExpires(t *testing.T) {
	compileReq, runReq := loadDravenBloodRushFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w1", AbilityRef: dravenBloodRushWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w2", AbilityRef: dravenBloodRushWRef(), Source: "source", Target: "target", FirstAtMs: 12000},
		{EntryKey: "probe_expired", AbilityRef: dravenBloodRushProbeRef(), Source: "source", Target: "target", FirstAtMs: 15001},
	}
	runReq.StopPolicy.DurationMs = 15100
	done := runDravenBloodRush(t, compileReq, runReq)

	if got := dravenBloodRushStateValue(t, done, dravenBloodRushActiveKey); got != 0 {
		t.Fatalf("blood_rush_active after refresh expiry=%v want 0", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-dravenBloodRushBaseAS) > 1e-9 {
		t.Fatalf("attack_speed after refresh expiry=%v want baseline %v", got, dravenBloodRushBaseAS)
	}
}
