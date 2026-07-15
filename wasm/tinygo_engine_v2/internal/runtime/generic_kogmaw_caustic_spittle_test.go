package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_kogmaw Q Caustic Spittle / 腐蚀唾液 (generic ABI, rank-5 passive only).
// Permanent attack_speed percent_add 0.25 via provider-mounted static ModifierDefinition.
// Non-goals: Q active magic hit, armor/MR shred, cast/cooldown/rotation, ranks 1-4.

const (
	kogmawCausticSpittleProviderRef = "provider_hero_kogmaw_caustic_spittle"
	kogmawCausticSpittleStableID    = "hero_kogmaw_q_caustic_spittle"
	kogmawCausticSpittleModKey      = "kogmaw_q_caustic_spittle_attack_speed"
	kogmawCausticSpittleASBonus     = 0.25
	kogmawCausticSpittleASBase      = 0.72
	kogmawCausticSpittleASResolved  = 0.90 // 0.72 * (1 + 0.25)
)

func kogmawCausticSpittleASModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: kogmawCausticSpittleModKey,
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value:       gfConst(kogmawCausticSpittleASBonus),
	}
}

func kogmawCausticSpittleProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey: kogmawCausticSpittleProviderRef,
		Kind:        "passive",
		StableID:    kogmawCausticSpittleStableID,
		Modifiers:   []model.ModifierDefinition{kogmawCausticSpittleASModifier()},
		// Attribute-only: no abilities, listeners, or initial state schema.
	}
}

func mountKogmawCausticSpittleProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, kogmawCausticSpittleProviderDef())
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: kogmawCausticSpittleProviderRef, DefinitionRef: kogmawCausticSpittleProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: kogmawCausticSpittleProviderRef, DefinitionRef: kogmawCausticSpittleProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func loadKogmawCausticSpittleFixture(t *testing.T, mount bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	if mount {
		mountKogmawCausticSpittleProvider(&compileReq, &runReq)
	}

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: kogmawCausticSpittleASBase, Current: kogmawCausticSpittleASBase,
		Max: kogmawCausticSpittleASBase, Resolved: kogmawCausticSpittleASBase,
	})

	// Attribute-only contract: no driver casts / damage ops.
	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runKogmawCausticSpittle(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func assertKogmawCausticSpittleProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	var found *model.ProviderDefinition
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == kogmawCausticSpittleProviderRef {
			found = p
			break
		}
	}
	if found == nil {
		t.Fatal("provider_hero_kogmaw_caustic_spittle missing from SharedProviders")
	}
	if len(found.Abilities) != 0 {
		t.Fatalf("provider must not add abilities: %+v", found.Abilities)
	}
	if len(found.Listeners) != 0 {
		t.Fatalf("provider must not add listeners: %+v", found.Listeners)
	}
	if len(found.InitialStateSchema) != 0 {
		t.Fatalf("provider must not add initialStateSchema: %+v", found.InitialStateSchema)
	}
	if found.Lifecycle != nil {
		t.Fatalf("provider must not add lifecycle: %+v", found.Lifecycle)
	}
	if len(found.Modifiers) != 1 {
		t.Fatalf("modifiers=%d want 1", len(found.Modifiers))
	}
	mod := found.Modifiers[0]
	if mod.Kind != "attribute" || mod.Target != "attack_speed" || mod.ValuePolicy != "percent_add" {
		t.Fatalf("modifier shape=%+v want attribute/attack_speed/percent_add", mod)
	}
	if mod.Value.Op != "const" || mod.Value.Value == nil || math.Abs(*mod.Value.Value-kogmawCausticSpittleASBonus) > 1e-12 {
		t.Fatalf("modifier value=%+v want const 0.25", mod.Value)
	}
}

func assertKogmawCausticSpittleNoDamageOrEvents(t *testing.T, done model.DoneResult) {
	t.Helper()
	if math.Abs(done.Summary.SourceDamageDealt) > 1e-12 {
		t.Fatalf("sourceDamageDealt=%v want 0 (attribute-only; no damage ops)", done.Summary.SourceDamageDealt)
	}
	if n := len(damageEvidenceItems(done)); n != 0 {
		t.Fatalf("damage evidence items=%d want 0", n)
	}
	if done.Summary.AbilityCastCount != 0 || done.Summary.AbilityAttemptCount != 0 {
		t.Fatalf("abilityAttempt/Cast=%d/%d want 0/0", done.Summary.AbilityAttemptCount, done.Summary.AbilityCastCount)
	}
	for _, item := range done.Evidence.Items {
		switch item.Kind {
		case model.EvidenceKindDamage, model.EvidenceKindEmittedEvent, model.EvidenceKindProviderTick:
			t.Fatalf("unexpected evidence kind=%q item=%+v", item.Kind, item)
		}
	}
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[kogmawCausticSpittleProviderRef].(map[string]interface{})
		if !ok {
			return
		}
		if state, ok := bag["state"].(map[string]interface{}); ok && len(state) != 0 {
			t.Fatalf("provider state must stay empty: %+v", state)
		}
		return
	}
}

// TestKogmawCausticSpittleRank5ASCrossCheck: independent numeric cross-check
// base AS 0.72 * (1 + 0.25) = 0.90.
func TestKogmawCausticSpittleRank5ASCrossCheck(t *testing.T) {
	want := kogmawCausticSpittleASBase * (1 + kogmawCausticSpittleASBonus)
	if math.Abs(want-kogmawCausticSpittleASResolved) > 1e-12 {
		t.Fatalf("formula=%v want %v", want, kogmawCausticSpittleASResolved)
	}
	if math.Abs(want-0.90) > 1e-12 {
		t.Fatalf("resolved AS=%v want 0.90", want)
	}
}

// TestKogmawCausticSpittleRank5PermanentAS: mount provider → resolved AS 0.90;
// provider is attribute-only (no ability/listener/state/damage/event).
func TestKogmawCausticSpittleRank5PermanentAS(t *testing.T) {
	compileReq, runReq := loadKogmawCausticSpittleFixture(t, true)
	assertKogmawCausticSpittleProviderShape(t, compileReq)
	done := runKogmawCausticSpittle(t, compileReq, runReq)

	got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed")
	if math.Abs(got-kogmawCausticSpittleASResolved) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want %v (base %v +25%% percent_add)",
			got, kogmawCausticSpittleASResolved, kogmawCausticSpittleASBase)
	}
	assertKogmawCausticSpittleNoDamageOrEvents(t, done)
}

// TestKogmawCausticSpittleWithoutMountKeepsBaseAS: no provider → AS stays 0.72.
func TestKogmawCausticSpittleWithoutMountKeepsBaseAS(t *testing.T) {
	compileReq, runReq := loadKogmawCausticSpittleFixture(t, false)
	done := runKogmawCausticSpittle(t, compileReq, runReq)

	got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed")
	if math.Abs(got-kogmawCausticSpittleASBase) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want %v (unmounted)", got, kogmawCausticSpittleASBase)
	}
}
