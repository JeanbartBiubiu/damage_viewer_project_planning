package runtime

import (
	"testing"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

// Regression from the independent overlay: only the final continuous batch is
// numerically observable, including during publication to the live state.
func TestIndependentDynamicBatchCommitCannotObserveRemovedIntermediate(t *testing.T) {
	input, run := resourceMaxInput(t, 500, 1500, false)
	ensureC1CatalogTypes(&input, model.TypeCatalogEntry{Key: "review_factor", Domain: "attribute"})
	for _, attrs := range []map[string]model.AttributeSlotDef{input.Combatants[0].Attributes, run.InitialSnapshot.Combatants[0].Attributes} {
		attrs["review_factor"] = authoringSlot(1)
	}
	input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{{ValuePolicy: "set", ValueType: "DECIMAL", CombatantKey: "source", AttributeKey: "review_factor", Value: model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringBinary("gt", authoringRead("source.attr.hp.current"), authoringConst(600)), authoringBinary("div", authoringConst(1), authoringRead("source.attr.armor.resolved")), authoringConst(1)}}}}
	state := frameCommitState(t, input, run)
	applyHealthWindow(t, state)
	if state.processFailure != nil {
		t.Fatal(state.processFailure)
	}
	ref := state.combatants["source"].providers[1].ProviderRef
	var frame executionFrame
	state.initExecutionFrame(&frame, "source", "target", "independent_net_batch")
	if err := frame.executeOperations(plan.CompiledAbility{}, []plan.CompiledOperation{{Operation: "expire_provider", Target: "self", ProviderRef: ref}, {Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "health_window"}}); err != nil {
		t.Fatal(err)
	}
	_ = frame.evalContext(plan.CompiledAbility{})
	if frame.fatal {
		t.Fatal(frame.fatalErr)
	}
	frame.commit()
	if frame.fatal || state.processFailure != nil {
		t.Fatal("commit evaluated an invisible removed intermediate", frame.fatalErr, state.processFailure)
	}
	if hp := state.combatants["source"].attributes.At("hp"); hp.Current != 800 || hp.Max != 1800 {
		t.Fatal(hp)
	}
	if state.resourceChangeSummary.ChangeCount != 1 {
		t.Fatal("net replacement invented a resource fact", state.resourceChangeSummary)
	}
	var kinds []model.EvidenceKind
	for _, ev := range state.evidence {
		if ev.Kind == model.EvidenceKindProviderApply || ev.Kind == model.EvidenceKindProviderRemove {
			kinds = append(kinds, ev.Kind)
		}
	}
	if len(kinds) != 3 || kinds[0] != model.EvidenceKindProviderApply || kinds[1] != model.EvidenceKindProviderRemove || kinds[2] != model.EvidenceKindProviderApply {
		t.Fatal("lifecycle order dropped or changed", kinds)
	}
}

func TestDynamicBatchRejectsMixedNonPureLifecycleBeforePublication(t *testing.T) {
	input, run := resourceMaxInput(t, 500, 1500, false)
	p := hitFlatProvider("stateful_provider", "armor", 10)
	p.InitialStateSchema = map[string]interface{}{"counter": float64(0)}
	input.SharedProviders = append(input.SharedProviders, p)
	state := frameCommitState(t, input, run)
	var frame executionFrame
	state.initExecutionFrame(&frame, "source", "target", "mixed_provider_batch")
	if err := frame.executeOperations(plan.CompiledAbility{}, []plan.CompiledOperation{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "health_window"}, {Operation: "apply_provider", Target: "self", ProviderDefinitionRef: p.ProviderKey}}); err != nil {
		t.Fatal(err)
	}
	frame.commit()
	if !frame.fatal || frame.fatalErr.Code != model.GenericErrRuntimeInvariantFailed || state.combatantHp("source") != 500 || len(state.combatants["source"].providers) != 1 || state.resourceChangeSummary.ChangeCount != 0 || len(state.evidence) != 0 {
		t.Fatal("mixed unsupported lifecycle partially published", frame.fatalErr, state.resourceChangeSummary, state.evidence)
	}
}

func TestDynamicBatchDuplicateRemovalIsIdempotent(t *testing.T) {
	input, run := resourceMaxInput(t, 1500, 1500, false)
	state := frameCommitState(t, input, run)
	applyHealthWindow(t, state)
	ref := state.combatants["source"].providers[1].ProviderRef
	var frame executionFrame
	state.initExecutionFrame(&frame, "source", "target", "duplicate_remove")
	op := plan.CompiledOperation{Operation: "expire_provider", Target: "self", ProviderRef: ref}
	if err := frame.executeOperations(plan.CompiledAbility{}, []plan.CompiledOperation{op, op}); err != nil {
		t.Fatal(err)
	}
	frame.commit()
	if frame.fatal {
		t.Fatal(frame.fatalErr)
	}
	if state.combatantHp("source") != 1500 || state.resourceChangeSummary.ChangeCount != 2 || len(state.combatants["source"].providers) != 1 {
		t.Fatal(state.resourceChangeSummary)
	}
}
