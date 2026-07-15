package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_kaisa E Supercharge / 极限超载 (generic ABI, rank-5 partial core).
//
// Data-owned modelling (rank5):
//   - E costs 30 mana; CD 10000 ms; ability Operations empty (no damage).
//   - generic ability_started represents "charge completed" (no cast-time sim).
//   - source-owner ability_started listener arms timed provider state
//     supercharge_as_active=1 (max1, durationMs=4000, refresh_on_write).
//   - rank-5 +80% AS via 0.80 * provider.state.supercharge_as_active
//     (dynamic percent_add; not modifier.Condition).
//
// Non-goals: move speed / ghost / attack-windup, real cast time, on-attack
// 0.5 CD refund, evolution invisibility, other ranks / rotation / E2E.

const (
	kaisaProviderRef   = "hero:kaisa"
	kaisaStableID      = "hero_kaisa"
	kaisaEKey          = "supercharge"
	kaisaProbeKey      = "kaisa_probe"
	kaisaASActiveKey   = "supercharge_as_active"
	kaisaASModKey      = "supercharge_attack_speed"
	kaisaListenerArm   = "listener_hero_kaisa_supercharge_arm"
	kaisaCastEvent     = "event/ability_started"
	kaisaEManaCost     = 30.0
	kaisaECDMs         = 10000.0
	kaisaASBuffDurMs   = 4000.0
	kaisaASBonus       = 0.80
	kaisaBaseAS        = 0.60
	kaisaResolvedAS    = 1.08 // 0.60 * (1 + 0.80)
	kaisaFixtureMana   = 100.0
	kaisaManaAfterCast = 70.0 // 100 - 30
)

func kaisaTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func kaisaStateSchema() map[string]interface{} {
	return map[string]interface{}{
		kaisaASActiveKey: kaisaTimedSlot(0, 1, kaisaASBuffDurMs),
	}
}

func kaisaASModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: kaisaASModKey,
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(kaisaASBonus),
				{Op: "read", Path: "provider.state." + kaisaASActiveKey},
			},
		},
	}
}

func kaisaCastArmListener() model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey:  kaisaListenerArm,
		EventMatcher: model.TypeMatcher{All: []string{kaisaCastEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         kaisaASActiveKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		},
	}
}

func kaisaEAbility() model.AbilityDefinition {
	cost := kaisaEManaCost
	cd := kaisaECDMs
	return model.AbilityDefinition{
		AbilityKey: kaisaEKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Charge-complete is represented by generic ability_started; no cast-time
		// ops and no damage operations on the ability itself.
		Operations: []model.OperationDefinition{},
	}
}

func kaisaProbeAbility() model.AbilityDefinition {
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: kaisaProbeKey,
		Kind:       "active",
		// Typed as basic_attack so the probe does not synthesize ability_started
		// (which would re-arm supercharge_as_active via the source-owner listener).
		Types: []string{"ability/basic_attack"},
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
				Ref:        "op:kaisa_probe",
			},
		},
	}
}

func ensureKaisaSuperchargeTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: kaisaCastEvent, Domain: "event"},
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

func configureKaisaSuperchargeProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders[0] = model.ProviderDefinition{
		ProviderKey:        kaisaProviderRef,
		Kind:               "champion",
		StableID:           kaisaStableID,
		InitialStateSchema: kaisaStateSchema(),
		Modifiers:          []model.ModifierDefinition{kaisaASModifier()},
		Listeners:          []model.ListenerDefinition{kaisaCastArmListener()},
		Abilities: []model.AbilityDefinition{
			kaisaEAbility(),
			kaisaProbeAbility(),
		},
	}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: kaisaProviderRef, DefinitionRef: kaisaProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: kaisaProviderRef, DefinitionRef: kaisaProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func kaisaERef() string {
	return "source.provider[" + kaisaProviderRef + "].ability[" + kaisaEKey + "]"
}

func kaisaProbeRef() string {
	return "source.provider[" + kaisaProviderRef + "].ability[" + kaisaProbeKey + "]"
}

func loadKaisaSuperchargeFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureKaisaSuperchargeTypes(&compileReq)
	configureKaisaSuperchargeProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: kaisaBaseAS, Current: kaisaBaseAS, Max: kaisaBaseAS, Resolved: kaisaBaseAS,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: kaisaFixtureMana, Max: kaisaFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runKaisaSupercharge(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func kaisaStateValue(t *testing.T, done model.DoneResult, key string) float64 {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, kaisaProviderRef)
	state, ok := bag["state"].(map[string]interface{})
	if !ok {
		return 0
	}
	v, _ := state[key].(float64)
	return v
}

func kaisaSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func kaisaSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Data["skipReason"] == string(reason) {
			n++
		}
	}
	return n
}

func assertKaisaEHasNoDamageOperations(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	var ability *model.AbilityDefinition
	for i := range compileReq.SharedProviders[0].Abilities {
		a := &compileReq.SharedProviders[0].Abilities[i]
		if a.AbilityKey == kaisaEKey {
			ability = a
			break
		}
	}
	if ability == nil {
		t.Fatal("supercharge ability missing")
	}
	if len(ability.Operations) != 0 {
		t.Fatalf("supercharge operations=%+v want empty (no damage ops)", ability.Operations)
	}
	for _, op := range ability.Operations {
		if op.Operation == "damage" {
			t.Fatalf("supercharge must not have damage operations: %+v", op)
		}
	}
}

// TestKaisaSuperchargeRank5ASCrossCheck: independent numeric cross-check
// base AS 0.60 * (1 + 0.80) = 1.08.
func TestKaisaSuperchargeRank5ASCrossCheck(t *testing.T) {
	want := kaisaBaseAS * (1 + kaisaASBonus)
	if math.Abs(want-kaisaResolvedAS) > 1e-12 {
		t.Fatalf("formula=%v want %v", want, kaisaResolvedAS)
	}
	if math.Abs(want-1.08) > 1e-12 {
		t.Fatalf("resolved AS=%v want 1.08", want)
	}
}

// TestKaisaSuperchargeCastSpendsManaArmsTimedAS: cast → mana 100→70, state armed,
// AS 0.60→1.08, one ability_started; E itself deals no damage.
func TestKaisaSuperchargeCastSpendsManaArmsTimedAS(t *testing.T) {
	compileReq, runReq := loadKaisaSuperchargeFixture(t)
	assertKaisaEHasNoDamageOperations(t, compileReq)

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e", AbilityRef: kaisaERef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runKaisaSupercharge(t, compileReq, runReq)

	if countEmittedEvents(done, kaisaCastEvent) != 1 {
		t.Fatalf("ability_started=%d want 1", countEmittedEvents(done, kaisaCastEvent))
	}
	if got := kaisaSourceMana(t, done.FinalSnapshot); math.Abs(got-kaisaManaAfterCast) > 1e-9 {
		t.Fatalf("mana=%v want %v", got, kaisaManaAfterCast)
	}
	if got := kaisaStateValue(t, done, kaisaASActiveKey); got != 1 {
		t.Fatalf("supercharge_as_active=%v want 1", got)
	}
	wantAS := kaisaBaseAS * (1 + kaisaASBonus)
	if math.Abs(wantAS-kaisaResolvedAS) > 1e-12 {
		t.Fatalf("wantAS=%v want constant %v", wantAS, kaisaResolvedAS)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-kaisaResolvedAS) > 1e-9 {
		t.Fatalf("attack_speed=%v want %v", got, kaisaResolvedAS)
	}
	if math.Abs(done.Summary.SourceDamageDealt) > 1e-12 {
		t.Fatalf("sourceDamageDealt=%v want 0 (E has no damage ops)", done.Summary.SourceDamageDealt)
	}
	if n := len(damageEvidenceItems(done)); n != 0 {
		t.Fatalf("damage evidence items=%d want 0", n)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1", done.Summary.AbilityCastCount)
	}
}

// TestKaisaSuperchargeASExpiresAfter4000ms: timed state expires → AS restores to 0.60.
func TestKaisaSuperchargeASExpiresAfter4000ms(t *testing.T) {
	compileReq, runReq := loadKaisaSuperchargeFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e", AbilityRef: kaisaERef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "probe_expired", AbilityRef: kaisaProbeRef(), Source: "source", Target: "target", FirstAtMs: 4001},
	}
	runReq.StopPolicy.DurationMs = 4100
	done := runKaisaSupercharge(t, compileReq, runReq)

	if got := kaisaStateValue(t, done, kaisaASActiveKey); got != 0 {
		t.Fatalf("supercharge_as_active after expiry=%v want 0", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-kaisaBaseAS) > 1e-9 {
		t.Fatalf("attack_speed after expiry=%v want baseline %v", got, kaisaBaseAS)
	}
}

// TestKaisaSuperchargeCooldownSkipDoesNotRecast: during CD, second attempt skips;
// no second cost / state rewrite / ability_started.
func TestKaisaSuperchargeCooldownSkipDoesNotRecast(t *testing.T) {
	compileReq, runReq := loadKaisaSuperchargeFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e1", AbilityRef: kaisaERef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "e2", AbilityRef: kaisaERef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runKaisaSupercharge(t, compileReq, runReq)

	if kaisaSkipReasonCount(done, model.AttemptSkipCooldownNotReady) < 1 {
		t.Fatal("expected cooldown_not_ready skip for second E during CD")
	}
	if countEmittedEvents(done, kaisaCastEvent) != 1 {
		t.Fatalf("ability_started=%d want 1 (no second cast event)", countEmittedEvents(done, kaisaCastEvent))
	}
	if got := kaisaSourceMana(t, done.FinalSnapshot); math.Abs(got-kaisaManaAfterCast) > 1e-9 {
		t.Fatalf("mana=%v want %v (no second cost)", got, kaisaManaAfterCast)
	}
	if got := kaisaStateValue(t, done, kaisaASActiveKey); got != 1 {
		t.Fatalf("supercharge_as_active=%v want 1 (still armed once)", got)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1 (second E skipped)", done.Summary.AbilityCastCount)
	}
}
