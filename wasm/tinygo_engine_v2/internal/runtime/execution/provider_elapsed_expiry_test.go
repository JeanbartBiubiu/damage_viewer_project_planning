package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"fmt"
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

func elapsedExpiryState(t *testing.T, names string) *Engine {
	t.Helper()
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 4000)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "configured_speed", Domain: "attribute"})
	for i := range input.Combatants {
		input.Combatants[i].Attributes["configured_speed"] = authoringSlot(100)
		request.InitialSnapshot.Combatants[i].Attributes["configured_speed"] = authoringSlot(100)
	}
	for _, name := range []string{"first", "second"} {
		input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{
			ProviderKey: names + ":" + name, StableID: names + ":" + name, Kind: "status",
			Lifecycle: &model.ProviderLifecycle{DurationMs: timedShieldExpr(1500), MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: model.InstanceScopeSourceTarget},
			Modifiers: []model.ModifierDefinition{{ModifierKey: "configured_value", Kind: "attribute", Target: "self.attr.configured_speed", ValuePolicy: "add", Value: elapsedModelValue(20)}},
		})
	}
	input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{ProviderKey: names + ":control", StableID: names + ":control", Kind: "status",
		Lifecycle: &model.ProviderLifecycle{DurationMs: timedShieldExpr(1500), MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: model.InstanceScopeSourceTarget}})
	return frameCommitState(t, input, request)
}

func applyElapsedExpiryDefinition(t *testing.T, state *Engine, definition, owner string) string {
	t.Helper()
	before := state.combatants[owner].instances.Providers().Len()
	if err := state.applyProviderInstance(owner, "source", definition, state.loop.TimeMs()+1500, true, effectpkg.ContributionView{}); err != nil {
		t.Fatal(err)
	}
	providers := state.combatants[owner].instances.Providers()
	if providers.Len() != before+1 {
		t.Fatal("new instance not mounted")
	}
	return providers.At(providers.Len() - 1).ProviderRef
}

func startFirstElapsedAttack(t *testing.T, state *Engine) {
	t.Helper()
	event, found := state.loop.Queue().Pop()
	if !found || event.Kind != scheduler.GenericEventBasicAttack || event.TimeMs != 0 {
		t.Fatal("missing first attack", event)
	}
	if err := state.handleBasicAttack(); err != nil {
		t.Fatal(err)
	}
}

func TestProviderElapsedSimultaneousExpiryBeforeAttackRecalculation(t *testing.T) {
	for _, names := range []string{"configured_decay", "other_haste"} {
		for _, applied := range []int64{0, 500} {
			for _, controlFirst := range []bool{true, false} {
				t.Run(fmt.Sprintf("%s/%d/control_first_%v", names, applied, controlFirst), func(t *testing.T) {
					state := elapsedExpiryState(t, names)
					if applied > 0 {
						startFirstElapsedAttack(t, state)
					}
					state.loop.Advance(applied)
					if controlFirst {
						applyElapsedExpiryDefinition(t, state, names+":control", "target")
					}
					applyElapsedExpiryDefinition(t, state, names+":first", "source")
					applyElapsedExpiryDefinition(t, state, names+":second", "target")
					if !controlFirst {
						applyElapsedExpiryDefinition(t, state, names+":control", "target")
					}
					if err := state.runLoop(); err != nil {
						t.Fatal("same-time expiry lost elapsed instance context", err)
					}
					if state.actions.BasicAttack().CompletedCount() < 3 {
						t.Fatal("background basic attacks stopped at expiry", state.actions.BasicAttack().Summary())
					}
					for _, owner := range []string{"source", "target"} {
						actor := state.combatants[owner]
						if value := actor.attributesView().At("configured_speed").Resolved; value != 100 {
							t.Fatal("expired modifier survived", owner, value)
						}
						for instanceIndex, instanceValues := 0, actor.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
							inst := instanceValues.At(instanceIndex)
							if inst.HasAppliedAt {
								t.Fatal("real cleanup did not remove elapsed provider", inst)
							}
						}
					}
					if state.report.Snapshot().Evidence.CountsByKind[string(model.EvidenceKindProviderExpire)] != 3 {
						t.Fatal("cleanup evidence changed", state.report.Snapshot().Evidence.CountsByKind)
					}
				})
			}
		}
	}
}

func TestProviderElapsedRepeatedApplicationKeepsNewDeadlineDuringOtherExpiry(t *testing.T) {
	state := elapsedExpiryState(t, "configured_refresh")
	startFirstElapsedAttack(t, state)
	state.loop.Advance(500)
	applyElapsedExpiryDefinition(t, state, "configured_refresh:control", "target")
	ref := applyElapsedExpiryDefinition(t, state, "configured_refresh:first", "source")
	state.loop.Advance(750)
	if err := state.applyProviderInstance("source", "source", "configured_refresh:first", 2250, true, effectpkg.ContributionView{}); err != nil {
		t.Fatal(err)
	}
	setTestLoopDuration(state, 2000)
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	inst, _, found := state.combatants["source"].instances.Providers().Find(ref)
	if !found || inst.AppliedAtMs != 750 || inst.ExpireAt != 2250 {
		t.Fatal("stale expiry removed refreshed instance", inst, found)
	}
	want := 100 + 20*(1-float64(2000-750)/1500)
	state.refreshProviderAwareAttributes("source", "target")
	if state.processFailure != nil || math.Abs(state.combatants["source"].attributesView().At("configured_speed").Resolved-want) > 1e-9 {
		t.Fatal("refresh time was lost", state.processFailure, state.combatants["source"].attributesView().At("configured_speed"))
	}
	state.loop.Advance(2250)
	for index := state.effectTimers.ExpiryCount() - 1; index >= 0; index-- {
		if pending := state.effectTimers.ExpiryAt(index); pending.Kind == "provider" && pending.ProviderRef == ref {
			state.handleExpireCleanup(scheduler.GenericEvent{Kind: scheduler.GenericEventExpireCleanup, Category: scheduler.GenericCategoryExpireCleanup, DriverEntryIndex: index, TimeMs: 2250})
			break
		}
	}
	if state.processFailure != nil {
		t.Fatal(state.processFailure)
	}
	if _, _, found := state.combatants["source"].instances.Providers().Find(ref); found {
		t.Fatal("real new expiry did not remove refreshed instance")
	}
}

func TestProviderElapsedExpiredFilterCannotMaskInvalidInstanceContext(t *testing.T) {
	definitions := []planbundle.CompiledProvider{{NeedsElapsedTime: true}, {}}
	valid := effectpkg.Provider{ProviderRef: "configured", DefinitionIndex: 0, AppliedAtMs: 500, HasAppliedAt: true, ExpireAt: 2000}
	for _, tc := range []struct {
		name   string
		change func(*effectpkg.Provider)
	}{
		{"missing_application", func(p *effectpkg.Provider) { p.HasAppliedAt = false }},
		{"negative_application", func(p *effectpkg.Provider) { p.AppliedAtMs = -1 }},
		{"future_application", func(p *effectpkg.Provider) { p.AppliedAtMs = 2001 }},
		{"invalid_deadline", func(p *effectpkg.Provider) { p.AppliedAtMs = 2000 }},
		{"untracked_definition", func(p *effectpkg.Provider) { p.DefinitionIndex = 1 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			instance := valid
			tc.change(&instance)
			ctx := withProviderElapsed(pipeline.ProviderFormulaContext{HasProviderContext: true}, effectpkg.Providers([]effectpkg.Provider{instance}), "configured", 2000, definitions)
			if ctx.SkipExpiredAttributeModifier || ctx.HasProviderElapsed {
				t.Fatal("invalid instance was hidden by expiry filter", ctx)
			}
		})
	}
	ctx := withProviderElapsed(pipeline.ProviderFormulaContext{HasProviderContext: true}, effectpkg.Providers([]effectpkg.Provider{valid}), "configured", 1999, definitions)
	if ctx.SkipExpiredAttributeModifier || !ctx.HasProviderElapsed || ctx.ProviderElapsedMs != 1499 {
		t.Fatal("active endpoint was excluded", ctx)
	}
	ctx = withProviderElapsed(pipeline.ProviderFormulaContext{HasProviderContext: true}, effectpkg.Providers([]effectpkg.Provider{valid}), "configured", 2000, definitions)
	if !ctx.SkipExpiredAttributeModifier || ctx.HasProviderElapsed {
		t.Fatal("proven expired modifier was evaluated", ctx)
	}
}
