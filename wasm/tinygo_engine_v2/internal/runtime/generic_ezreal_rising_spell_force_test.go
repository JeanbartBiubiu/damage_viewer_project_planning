package runtime

import (
	"math"
	"strconv"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_ezreal P Rising Spell Force / 咒能高涨 (generic ABI, bounded 1v1 proof).
//
// League Wiki Template:Data Ezreal/Rising Spell Force (revision 3932280,
// SHA256 5996c969e2d1b53b3c805737fa161b4a9e235d6e7b7c74899a6580de34ca77ba):
//   - each enemy hit by Ezreal's abilities gives one stack
//   - duration 6000 ms; subsequent hits refresh the whole stack window
//   - maximum 5 stacks
//   - each stack grants 10% bonus attack speed (max +50%)
//
// Screenshots / OCR are not numeric provenance for this contract; Wiki revision
// + hash above are the approved numeric source.
//
// Approved deterministic 1v1 boundary for this proof only:
//   - every scheduled top-level non-basic Ezreal spell ability represents exactly
//     one hit on the unique target
//   - canonical automatic event/ability_started is the hit producer inside that
//     boundary (listener: provider-scope state_change add 1)
//   - ability/basic_attack is excluded by the runtime TypeSet check (no
//     ability_started synthesis)
//
// Explicit non-goals: misses, multi-target, multi-hit from one cast, real
// Q/W/E/R damage/cost/cooldown graphs, Backend publish / live migration.

const (
	ezrealRSFProviderRef = "hero:ezreal"
	ezrealRSFStableID    = "hero_ezreal"
	ezrealRSFSpellKey    = "rising_spell_force_spell"
	ezrealRSFGatedKey    = "rising_spell_force_gated"
	ezrealRSFProbeKey    = "ezreal_rsf_probe"
	ezrealRSFStacksKey   = "rising_spell_force_stacks"
	ezrealRSFASModKey    = "rising_spell_force_attack_speed"
	ezrealRSFListenerKey = "listener_hero_ezreal_rising_spell_force"
	ezrealRSFCastEvent   = "event/ability_started"

	ezrealRSFMaxStacks   = 5.0
	ezrealRSFDurationMs  = 6000.0
	ezrealRSFPerStackAS  = 0.10
	ezrealRSFBaseAS      = 1.0
	ezrealRSFGatedCDMs   = 5000.0
	ezrealRSFGatedMana   = 30.0
	ezrealRSFFixtureMana = 200.0
)

func ezrealRSFTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func ezrealRSFStateSchema() map[string]interface{} {
	return map[string]interface{}{
		ezrealRSFStacksKey: ezrealRSFTimedSlot(0, ezrealRSFMaxStacks, ezrealRSFDurationMs),
	}
}

func ezrealRSFWantAS(stacks float64) float64 {
	return ezrealRSFBaseAS * (1 + ezrealRSFPerStackAS*stacks)
}

func ezrealRSFASModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: ezrealRSFASModKey,
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(ezrealRSFPerStackAS),
				{Op: "read", Path: "provider.state." + ezrealRSFStacksKey},
			},
		},
	}
}

func ezrealRSFStackListener() model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey:  ezrealRSFListenerKey,
		EventMatcher: model.TypeMatcher{All: []string{ezrealRSFCastEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         ezrealRSFStacksKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "add",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		},
	}
}

func ezrealRSFSpellAbility() model.AbilityDefinition {
	// Boundary stand-in for any top-level non-basic spell hit: empty ops; stack
	// accrual is solely via automatic ability_started → source-owner listener.
	return model.AbilityDefinition{
		AbilityKey: ezrealRSFSpellKey,
		Kind:       "active",
		Types:      []string{},
		Operations: []model.OperationDefinition{},
	}
}

func ezrealRSFGatedAbility() model.AbilityDefinition {
	cost := ezrealRSFGatedMana
	cd := ezrealRSFGatedCDMs
	return model.AbilityDefinition{
		AbilityKey: ezrealRSFGatedKey,
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
	}
}

func ezrealRSFProbeAbility() model.AbilityDefinition {
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: ezrealRSFProbeKey,
		Kind:       "active",
		// Typed as basic_attack so the probe does not synthesize ability_started
		// (which would add a Rising Spell Force stack via the source-owner listener).
		Types: []string{"ability/basic_attack"},
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
				Ref:        "op:ezreal_rsf_probe",
			},
		},
	}
}

func ensureEzrealRSFTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: ezrealRSFCastEvent, Domain: "event"},
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

func configureEzrealRSFProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders[0] = model.ProviderDefinition{
		ProviderKey:        ezrealRSFProviderRef,
		Kind:               "champion",
		StableID:           ezrealRSFStableID,
		InitialStateSchema: ezrealRSFStateSchema(),
		Modifiers:          []model.ModifierDefinition{ezrealRSFASModifier()},
		Listeners:          []model.ListenerDefinition{ezrealRSFStackListener()},
		Abilities: []model.AbilityDefinition{
			ezrealRSFSpellAbility(),
			ezrealRSFGatedAbility(),
			ezrealRSFProbeAbility(),
		},
	}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: ezrealRSFProviderRef, DefinitionRef: ezrealRSFProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: ezrealRSFProviderRef, DefinitionRef: ezrealRSFProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ezrealRSFSpellRef() string {
	return "source.provider[" + ezrealRSFProviderRef + "].ability[" + ezrealRSFSpellKey + "]"
}

func ezrealRSFGatedRef() string {
	return "source.provider[" + ezrealRSFProviderRef + "].ability[" + ezrealRSFGatedKey + "]"
}

func ezrealRSFProbeRef() string {
	return "source.provider[" + ezrealRSFProviderRef + "].ability[" + ezrealRSFProbeKey + "]"
}

func loadEzrealRSFFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureEzrealRSFTypes(&compileReq)
	configureEzrealRSFProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: ezrealRSFBaseAS, Current: ezrealRSFBaseAS, Max: ezrealRSFBaseAS, Resolved: ezrealRSFBaseAS,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: ezrealRSFFixtureMana, Max: ezrealRSFFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runEzrealRSF(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	field := result.Session.Providers[0].StateFields[ezrealRSFStacksKey]
	if !field.HasCap || field.MaxValue != ezrealRSFMaxStacks || field.DurationMs != int64(ezrealRSFDurationMs) {
		t.Fatalf("compiled stacks field=%+v want max=5 durationMs=6000", field)
	}
	if field.RefreshPolicy != model.ProviderStateRefreshOnWrite {
		t.Fatalf("refreshPolicy=%q want %q", field.RefreshPolicy, model.ProviderStateRefreshOnWrite)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func ezrealRSFStacks(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[ezrealRSFProviderRef].(map[string]interface{})
		if !ok {
			return 0
		}
		state, ok := bag["state"].(map[string]interface{})
		if !ok {
			return 0
		}
		v, _ := state[ezrealRSFStacksKey].(float64)
		return v
	}
	t.Fatal("source combatant missing")
	return 0
}

func ezrealRSFSourceASSlot(t *testing.T, snap model.Snapshot) model.AttributeSlotDef {
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

func ezrealRSFSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func ezrealRSFSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindAttemptSkipped && item.Data["skipReason"] == string(reason) {
			n++
		}
	}
	return n
}

func ezrealRSFSpellDriver(times ...int64) []model.DriverEntry {
	entries := make([]model.DriverEntry, 0, len(times))
	for i, at := range times {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "spell_" + strconv.Itoa(i),
			AbilityRef: ezrealRSFSpellRef(),
			Source:     "source",
			Target:     "target",
			FirstAtMs:  at,
		})
	}
	return entries
}

// TestGenericEzrealRisingSpellForceASCrossCheck: independent numeric cross-check
// base AS 1.0 * (1 + 0.10 * stacks); max 5 → 1.50.
func TestGenericEzrealRisingSpellForceASCrossCheck(t *testing.T) {
	if math.Abs(ezrealRSFWantAS(1)-1.10) > 1e-12 {
		t.Fatalf("1 stack AS=%v want 1.10", ezrealRSFWantAS(1))
	}
	if math.Abs(ezrealRSFWantAS(5)-1.50) > 1e-12 {
		t.Fatalf("5 stack AS=%v want 1.50", ezrealRSFWantAS(5))
	}
	if math.Abs(ezrealRSFPerStackAS*ezrealRSFMaxStacks-0.50) > 1e-12 {
		t.Fatalf("max bonus=%v want 0.50", ezrealRSFPerStackAS*ezrealRSFMaxStacks)
	}
}

// TestGenericEzrealRisingSpellForceSingleSpellHitAddsOneStack: one non-basic spell
// → ability_started, exactly one provider-scoped stack, AS = baseline + 10%.
func TestGenericEzrealRisingSpellForceSingleSpellHitAddsOneStack(t *testing.T) {
	compileReq, runReq := loadEzrealRSFFixture(t)
	runReq.DriverPlan.Entries = ezrealRSFSpellDriver(0)
	runReq.StopPolicy.DurationMs = 50
	done := runEzrealRSF(t, compileReq, runReq)

	if countEmittedEvents(done, ezrealRSFCastEvent) != 1 {
		t.Fatalf("ability_started=%d want 1", countEmittedEvents(done, ezrealRSFCastEvent))
	}
	times := emittedEventTimes(done, ezrealRSFCastEvent)
	if len(times) != 1 || times[0] != 0 {
		t.Fatalf("ability_started times=%v want [0]", times)
	}
	if got := ezrealRSFStacks(t, done); got != 1 {
		t.Fatalf("stacks=%v want 1", got)
	}
	slot := ezrealRSFSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-ezrealRSFBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base=%v want %v (modifier must not mutate base)", slot.Base, ezrealRSFBaseAS)
	}
	wantAS := ezrealRSFWantAS(1)
	if math.Abs(slot.Resolved-wantAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want %v", slot.Resolved, wantAS)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1", done.Summary.AbilityCastCount)
	}
	bag := sourceProviderState(t, done.FinalSnapshot, ezrealRSFProviderRef)
	if _, has := bag["expireAt"]; has {
		t.Fatalf("snapshot must not emit expireAt: %+v", bag)
	}
	state, _ := bag["state"].(map[string]interface{})
	if _, has := state["expireAt"]; has {
		t.Fatalf("state must stay numeric shape: %+v", state)
	}
}

// TestGenericEzrealRisingSpellForceCapsAtFiveStacks: six spell hits clamp at 5
// stacks and resolved AS at +50%.
func TestGenericEzrealRisingSpellForceCapsAtFiveStacks(t *testing.T) {
	compileReq, runReq := loadEzrealRSFFixture(t)
	runReq.DriverPlan.Entries = ezrealRSFSpellDriver(0, 100, 200, 300, 400, 500)
	runReq.StopPolicy.DurationMs = 600
	done := runEzrealRSF(t, compileReq, runReq)

	if countEmittedEvents(done, ezrealRSFCastEvent) != 6 {
		t.Fatalf("ability_started=%d want 6", countEmittedEvents(done, ezrealRSFCastEvent))
	}
	if got := ezrealRSFStacks(t, done); got != 5 {
		t.Fatalf("stacks=%v want 5 (capped)", got)
	}
	wantAS := ezrealRSFWantAS(5)
	if math.Abs(wantAS-1.50) > 1e-12 {
		t.Fatalf("wantAS=%v want 1.50", wantAS)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-wantAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want %v (+50%% cap)", got, wantAS)
	}
	if done.Summary.AbilityCastCount != 6 {
		t.Fatalf("abilityCastCount=%d want 6", done.Summary.AbilityCastCount)
	}
}

// TestGenericEzrealRisingSpellForceBasicAttackDoesNotStack: ability/basic_attack
// does not emit ability_started and does not add a stack.
func TestGenericEzrealRisingSpellForceBasicAttackDoesNotStack(t *testing.T) {
	compileReq, runReq := loadEzrealRSFFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: ezrealRSFProbeRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runEzrealRSF(t, compileReq, runReq)

	if countEmittedEvents(done, ezrealRSFCastEvent) != 0 {
		t.Fatalf("ability_started=%d want 0 for basic_attack", countEmittedEvents(done, ezrealRSFCastEvent))
	}
	if got := ezrealRSFStacks(t, done); got != 0 {
		t.Fatalf("stacks=%v want 0", got)
	}
	slot := ezrealRSFSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Resolved-ezrealRSFBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want baseline %v", slot.Resolved, ezrealRSFBaseAS)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1 (probe cast still counts)", done.Summary.AbilityCastCount)
	}
}

// TestGenericEzrealRisingSpellForceCooldownSkipDoesNotStack: cooldown_not_ready
// skip does not emit ability_started and does not add a second stack.
func TestGenericEzrealRisingSpellForceCooldownSkipDoesNotStack(t *testing.T) {
	compileReq, runReq := loadEzrealRSFFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "gated1", AbilityRef: ezrealRSFGatedRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "gated2", AbilityRef: ezrealRSFGatedRef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runEzrealRSF(t, compileReq, runReq)

	if ezrealRSFSkipReasonCount(done, model.AttemptSkipCooldownNotReady) < 1 {
		t.Fatal("expected cooldown_not_ready skip for second gated cast during CD")
	}
	var skipAt int64 = -1
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		skipAt = item.TimeMs
		break
	}
	if skipAt != 100 {
		t.Fatalf("cooldown skip TimeMs=%d want 100", skipAt)
	}
	if countEmittedEvents(done, ezrealRSFCastEvent) != 1 {
		t.Fatalf("ability_started=%d want 1 (no second cast event)", countEmittedEvents(done, ezrealRSFCastEvent))
	}
	if got := ezrealRSFStacks(t, done); got != 1 {
		t.Fatalf("stacks=%v want 1 (skip must not add)", got)
	}
	wantMana := ezrealRSFFixtureMana - ezrealRSFGatedMana
	if got := ezrealRSFSourceMana(t, done.FinalSnapshot); math.Abs(got-wantMana) > 1e-9 {
		t.Fatalf("mana=%v want %v (no second cost)", got, wantMana)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1 (second gated skipped)", done.Summary.AbilityCastCount)
	}
}

// TestGenericEzrealRisingSpellForceRefreshKeepsStacksBeforeBoundary: hit at 0,
// refresh hit at 2000 → window becomes [2000, 8000); probe at 7999 still sees
// stacks and boosted AS (scheduler: nowMs >= expireAt expires).
func TestGenericEzrealRisingSpellForceRefreshKeepsStacksBeforeBoundary(t *testing.T) {
	compileReq, runReq := loadEzrealRSFFixture(t)
	runReq.DriverPlan.Entries = append(ezrealRSFSpellDriver(0, 2000), model.DriverEntry{
		EntryKey:   "probe_live",
		AbilityRef: ezrealRSFProbeRef(),
		Source:     "source",
		Target:     "target",
		FirstAtMs:  7999,
	})
	runReq.StopPolicy.DurationMs = 8050
	done := runEzrealRSF(t, compileReq, runReq)

	if countEmittedEvents(done, ezrealRSFCastEvent) != 2 {
		t.Fatalf("ability_started=%d want 2 (spell only; probe is basic_attack)", countEmittedEvents(done, ezrealRSFCastEvent))
	}
	times := emittedEventTimes(done, ezrealRSFCastEvent)
	if len(times) != 2 || times[0] != 0 || times[1] != 2000 {
		t.Fatalf("ability_started times=%v want [0 2000]", times)
	}
	if got := ezrealRSFStacks(t, done); got != 2 {
		t.Fatalf("stacks before refreshed boundary=%v want 2", got)
	}
	wantAS := ezrealRSFWantAS(2)
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-wantAS) > 1e-9 {
		t.Fatalf("attack_speed before boundary=%v want %v", got, wantAS)
	}
	// AbilityCastCount includes the basic_attack probe used to force final resolve.
	if done.Summary.AbilityCastCount != 3 {
		t.Fatalf("abilityCastCount=%d want 3 (2 spell + 1 probe)", done.Summary.AbilityCastCount)
	}
}

// TestGenericEzrealRisingSpellForceRefreshExpiresAtBoundary: refresh at 2000 →
// expireAt=8000; at/after exact boundary stacks clear and AS returns to baseline.
func TestGenericEzrealRisingSpellForceRefreshExpiresAtBoundary(t *testing.T) {
	compileReq, runReq := loadEzrealRSFFixture(t)
	runReq.DriverPlan.Entries = append(ezrealRSFSpellDriver(0, 2000), model.DriverEntry{
		EntryKey:   "probe_expired",
		AbilityRef: ezrealRSFProbeRef(),
		Source:     "source",
		Target:     "target",
		FirstAtMs:  8000, // nowMs >= expireAt → lazy-expire
	})
	runReq.StopPolicy.DurationMs = 8100
	done := runEzrealRSF(t, compileReq, runReq)

	if countEmittedEvents(done, ezrealRSFCastEvent) != 2 {
		t.Fatalf("ability_started=%d want 2", countEmittedEvents(done, ezrealRSFCastEvent))
	}
	if got := ezrealRSFStacks(t, done); got != 0 {
		t.Fatalf("stacks at/after refreshed boundary=%v want 0", got)
	}
	slot := ezrealRSFSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-ezrealRSFBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base after expiry=%v want %v", slot.Base, ezrealRSFBaseAS)
	}
	if math.Abs(slot.Resolved-ezrealRSFBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved after expiry=%v want baseline %v", slot.Resolved, ezrealRSFBaseAS)
	}
}
