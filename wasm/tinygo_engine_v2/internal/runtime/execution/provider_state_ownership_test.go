package execution

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

// 首次写入计时既要保留活跃期限，也要在期限已过后独立重建。

func TestProviderStateOwnershipFailedFrameDoesNotPublishStateOrTimers(t *testing.T) {
	sourceChange := model.OperationDefinition{Operation: "state_change", Target: "source", Ref: "stacks", Types: []string{stateScopeProvider}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(1))}
	targetChange := model.OperationDefinition{Operation: "state_change", Target: "source", Ref: "hits", Types: []string{stateScopeProviderTarget}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(1))}
	c, r := frameCommitInput(sourceChange, targetChange, frameCommitDamage(1))
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: stateScopeProvider, Domain: "state_scope"}, model.TypeCatalogEntry{Key: stateScopeProviderTarget, Domain: "state_scope"})
	c.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"stacks": map[string]interface{}{"defaultValue": float64(0), "maxValue": float64(99), "durationMs": float64(100), "refreshPolicy": model.ProviderStateRefreshOnWrite},
		"hits":   map[string]interface{}{"defaultValue": float64(0), "maxValue": float64(99), "durationMs": float64(100), "refreshPolicy": model.ProviderStateRefreshOnWrite},
	}
	r.InitialSnapshot.Combatants[0].ProviderState = map[string]interface{}{"attack": map[string]interface{}{
		"state": map[string]interface{}{"stacks": float64(2), "hits": float64(0)}, "expireAt": map[string]interface{}{"stacks": float64(50)},
		"targetState": map[string]interface{}{"target": "target", "values": map[string]interface{}{"hits": float64(3)}, "expireAt": map[string]interface{}{"hits": float64(50)}},
	}}
	state := frameCommitState(t, c, r)
	liveBag := state.combatants["source"].providerState.Lookup("attack")
	want := providerStateOwnershipSnapshot(liveBag)
	previous, _, _ := frameCommitFrame(state)
	previousBag := previous.stageFor("source").providerState.Lookup("attack")
	state.budget.MaxCommandsPerEvent = 2
	frame, ability, ops := frameCommitFrame(state)
	err := frame.executeOperations(ability, ops)
	if err == nil || err.BudgetCause != model.BudgetCauseMaxCommandsPerEvent {
		t.Fatalf("expected budget failure after both state changes: %v", err)
	}
	stagedBag := frame.stageFor("source").providerState.Lookup("attack")
	if stagedBag.State().At("stacks") != 3 || stagedBag.TargetValues().At("hits") != 4 || stagedBag.ExpireAt().At("stacks") != 100 || stagedBag.TargetExpireAt().At("hits") != 100 {
		t.Fatal("failure occurred before the intended state/timer writes", providerStateOwnershipSnapshot(stagedBag))
	}
	frame.commit()
	if frame.committed {
		t.Fatal("failed frame committed")
	}
	assertProviderStateOwnershipView(t, "live after failed frame", state.combatants["source"].providerState.Lookup("attack"), want)
	assertProviderStateOwnershipView(t, "borrowed live bag", liveBag, want)
	assertProviderStateOwnershipView(t, "previous staged bag", previousBag, want)
}
