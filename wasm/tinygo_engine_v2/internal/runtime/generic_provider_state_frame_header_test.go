package runtime

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func providerFrameHeaderState(t *testing.T, failAfterWrites bool) *genericRunState {
	t.Helper()
	change := func(key, scope string) model.OperationDefinition {
		return model.OperationDefinition{Operation: "state_change", Target: "source", Ref: key, Types: []string{scope},
			ValuePolicy: "add", Amount: authoringAmount(authoringConst(1))}
	}
	ops := []model.OperationDefinition{change("stacks", stateScopeProvider), change("hits", stateScopeProviderTarget)}
	if failAfterWrites {
		ops = append(ops, frameCommitDamage(1))
	}
	c, r := frameCommitInput(ops...)
	c.TypeCatalog.Types = append(c.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: stateScopeProvider, Domain: "state_scope"},
		model.TypeCatalogEntry{Key: stateScopeProviderTarget, Domain: "state_scope"})
	c.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"stacks": p6SchemaField(0, 99, 100, model.ProviderStateRefreshOnWrite),
		"hits":   p6SchemaField(0, 99, 100, model.ProviderStateRefreshOnWrite),
	}
	r.InitialSnapshot.Combatants[0].ProviderState = map[string]interface{}{"attack": map[string]interface{}{
		"state":    map[string]interface{}{"stacks": float64(2), "hits": float64(0)},
		"expireAt": map[string]interface{}{"stacks": float64(50)},
		"targetState": map[string]interface{}{
			"target": "target", "values": map[string]interface{}{"hits": float64(3)},
			"expireAt": map[string]interface{}{"hits": float64(50)},
		},
	}}
	return frameCommitState(t, c, r)
}

func providerFrameHeaderFrame(state *genericRunState, target string) (*executionFrame, planbundle.CompiledAbility, []planbundle.CompiledOperation) {
	entry := state.req.DriverPlan.Entries[0]
	ability, ref, _ := state.lookupDriverAbility(entry)
	frame := state.newExecutionFrame("source", target, ref)
	frame.ownerCombatantKey, frame.ownerProviderRef = "source", "attack"
	start := int(ability.OperationStart)
	return frame, ability, state.compiled.Operations[start : start+int(ability.OperationCount)]
}

func TestProviderFrameHeaderChildCommitAndParentWritesKeepTheirViews(t *testing.T) {
	state := providerFrameHeaderState(t, false)
	initialBag := state.combatants["source"].providerState["attack"]
	initial := providerStateOwnershipSnapshot(initialBag)
	parent, ability, ops := providerFrameHeaderFrame(state, "target")
	parentBag := parent.stageFor("source").providerState["attack"]

	// 子帧改为自身目标，清除旧目标值后写入新目标；父帧仍持有原目标视图。
	child, _, _ := providerFrameHeaderFrame(state, "source")
	if err := child.executeOperations(ability, ops); err != nil {
		t.Fatal(err)
	}
	child.commit()
	if child.fatal || !child.committed {
		t.Fatalf("child frame did not commit: %v", child.fatalErr)
	}
	childLive := state.combatants["source"].providerState["attack"]
	if childLive.state["stacks"] != 3 || childLive.targetKey != "source" || childLive.targetValues["hits"] != 1 ||
		childLive.expireAt["stacks"] != 100 || childLive.targetExpireAt["hits"] != 100 {
		t.Fatal("child target switch or timer writes were lost", providerStateOwnershipSnapshot(childLive))
	}
	childPublished := providerStateOwnershipSnapshot(childLive)
	assertProviderStateOwnershipView(t, "original live view after child commit", initialBag, initial)
	assertProviderStateOwnershipView(t, "parent view after child commit", parentBag, initial)

	if err := parent.executeOperations(ability, ops); err != nil {
		t.Fatal(err)
	}
	parentCurrent := parent.stageFor("source").providerState["attack"]
	if parentCurrent.state["stacks"] != 3 || parentCurrent.targetKey != "target" || parentCurrent.targetValues["hits"] != 4 {
		t.Fatal("parent did not continue from its own state", providerStateOwnershipSnapshot(parentCurrent))
	}
	assertProviderStateOwnershipView(t, "published child after parent writes", state.combatants["source"].providerState["attack"], childPublished)
	assertProviderStateOwnershipView(t, "saved child view after parent writes", childLive, childPublished)
	assertProviderStateOwnershipView(t, "saved parent view after parent writes", parentBag, initial)
}

func TestProviderFrameHeaderFailedTargetSwitchDoesNotPublish(t *testing.T) {
	state := providerFrameHeaderState(t, true)
	liveBag := state.combatants["source"].providerState["attack"]
	want := providerStateOwnershipSnapshot(liveBag)
	previous, _, _ := providerFrameHeaderFrame(state, "target")
	previousBag := previous.stageFor("source").providerState["attack"]
	state.budget.MaxCommandsPerEvent = 2
	failed, ability, ops := providerFrameHeaderFrame(state, "source")
	err := failed.executeOperations(ability, ops)
	if err == nil || err.BudgetCause != model.BudgetCauseMaxCommandsPerEvent {
		t.Fatalf("expected failure after the source write and target switch: %v", err)
	}
	staged := failed.stageFor("source").providerState["attack"]
	if staged.targetKey != "source" || staged.state["stacks"] != 3 || staged.targetValues["hits"] != 1 ||
		staged.expireAt["stacks"] != 100 || staged.targetExpireAt["hits"] != 100 {
		t.Fatal("frame failed before the intended header/state/timer writes", providerStateOwnershipSnapshot(staged))
	}
	failed.commit()
	if failed.committed {
		t.Fatal("failed frame committed its target switch")
	}
	assertProviderStateOwnershipView(t, "live after failed target switch", state.combatants["source"].providerState["attack"], want)
	assertProviderStateOwnershipView(t, "borrowed live view after failure", liveBag, want)
	assertProviderStateOwnershipView(t, "previous frame after failure", previousBag, want)
}

func TestProviderFrameHeaderPostCommitGetterAndLiveExpiryKeepPublishedViews(t *testing.T) {
	state := providerFrameHeaderState(t, false)
	frame, ability, ops := providerFrameHeaderFrame(state, "target")
	if err := frame.executeOperations(ability, ops); err != nil {
		t.Fatal(err)
	}
	publishedBag := frame.stageFor("source").providerState["attack"]
	wantPublished := providerStateOwnershipSnapshot(publishedBag)
	frame.commit()
	if frame.fatal || !frame.committed {
		t.Fatalf("frame did not commit: %v", frame.fatalErr)
	}
	liveBeforeExpiry := state.combatants["source"].providerState["attack"]
	assertProviderStateOwnershipView(t, "committed live state", liveBeforeExpiry, wantPublished)

	// 已提交帧的读取会惰性清源状态，仍不能改当前live或先前发布的包。
	state.nowMs = 100
	local := frame.providerStateBag("source", "attack", false)
	if local.state["stacks"] != 0 || local.expireAt["stacks"] != 0 || local.targetValues["hits"] != 4 || local.targetExpireAt["hits"] != 100 {
		t.Fatal("post-commit getter changed provider/target expiry semantics", providerStateOwnershipSnapshot(local))
	}
	wantLocal := providerStateOwnershipSnapshot(local)
	assertProviderStateOwnershipView(t, "published bag after frame getter", publishedBag, wantPublished)
	assertProviderStateOwnershipView(t, "live after frame getter", state.combatants["source"].providerState["attack"], wantPublished)

	state.lazyExpireAllProviderState()
	expired := state.combatants["source"].providerState["attack"]
	if expired.state["stacks"] != 0 || expired.expireAt["stacks"] != 0 || expired.targetValues["hits"] != 0 || expired.targetExpireAt["hits"] != 0 || expired.targetKey != "target" {
		t.Fatal("global inclusive expiry did not settle both scopes", providerStateOwnershipSnapshot(expired))
	}
	assertProviderStateOwnershipView(t, "published bag after live expiry", publishedBag, wantPublished)
	assertProviderStateOwnershipView(t, "borrowed live view after expiry", liveBeforeExpiry, wantPublished)
	assertProviderStateOwnershipView(t, "post-commit frame view after live expiry", local, wantLocal)
}

func TestProviderFrameHeaderFormulaReadsKeepOriginalExpiryScopes(t *testing.T) {
	t.Run("frame_context_only_expires_source", func(t *testing.T) {
		state := providerFrameHeaderState(t, false)
		original := state.combatants["source"].providerState["attack"]
		want := providerStateOwnershipSnapshot(original)
		state.nowMs = 50
		frame, ability, _ := providerFrameHeaderFrame(state, "target")
		context := frame.evalContext(ability)
		local := frame.stageFor("source").providerState["attack"]
		if context.ProviderState["stacks"] != 0 || context.ProviderTargetState["hits"] != 3 ||
			local.expireAt["stacks"] != 0 || local.targetExpireAt["hits"] != 50 {
			t.Fatal("frame formula context changed its source-only expiry scope", providerStateOwnershipSnapshot(local))
		}
		assertProviderStateOwnershipView(t, "live after frame formula read", state.combatants["source"].providerState["attack"], want)
		assertProviderStateOwnershipView(t, "saved live view after frame formula read", original, want)
	})
	t.Run("overlay_expires_invisible_target", func(t *testing.T) {
		state := providerFrameHeaderState(t, false)
		original := state.combatants["source"].providerState["attack"]
		want := providerStateOwnershipSnapshot(original)
		state.nowMs = 50
		frame, _, _ := providerFrameHeaderFrame(state, "source")
		context := frame.providerFormulaContextForTarget("source", "source", true)("source", "attack")
		local := frame.stageFor("source").providerState["attack"]
		if context.ProviderTargetState != nil || context.ProviderState["stacks"] != 0 ||
			local.targetKey != "target" || local.targetValues["hits"] != 0 || local.targetExpireAt["hits"] != 0 {
			t.Fatal("provider overlay tied expiry to target visibility", providerStateOwnershipSnapshot(local))
		}
		assertProviderStateOwnershipView(t, "live after invisible-target overlay", state.combatants["source"].providerState["attack"], want)
		assertProviderStateOwnershipView(t, "saved live view after invisible-target overlay", original, want)
	})
}
