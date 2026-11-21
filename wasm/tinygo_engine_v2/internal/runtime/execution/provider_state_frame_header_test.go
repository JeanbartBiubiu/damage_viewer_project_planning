package execution

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func providerFrameHeaderState(t *testing.T, failAfterWrites bool) *Engine {
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

func providerFrameHeaderFrame(state *Engine, target string) (*Frame, planbundle.CompiledAbility, []planbundle.CompiledOperation) {
	entry := state.req.DriverPlan.Entries[0]
	ability, ref, _ := state.lookupDriverAbility(entry)
	frame := state.newExecutionFrame("source", target, ref)
	frame.ownerCombatantKey, frame.ownerProviderRef = "source", "attack"
	start := int(ability.OperationStart)
	return frame, ability, state.compiled.Operations[start : start+int(ability.OperationCount)]
}

func TestProviderFrameHeaderChildCommitAndParentWritesKeepTheirViews(t *testing.T) {
	state := providerFrameHeaderState(t, false)
	initialBag := state.combatants["source"].providerState.Lookup("attack")
	initial := providerStateOwnershipSnapshot(initialBag)
	parent, ability, ops := providerFrameHeaderFrame(state, "target")
	parentBag := parent.stageFor("source").providerState.Lookup("attack")

	// 子帧改为自身目标，清除旧目标值后写入新目标；父帧仍持有原目标视图。
	child, _, _ := providerFrameHeaderFrame(state, "source")
	if err := child.executeOperations(ability, ops); err != nil {
		t.Fatal(err)
	}
	child.commit()
	if child.fatal || !child.committed {
		t.Fatalf("child frame did not commit: %v", child.fatalErr)
	}
	childLive := state.combatants["source"].providerState.Lookup("attack")
	if childLive.State().At("stacks") != 3 || childLive.TargetKey() != "source" || childLive.TargetValues().At("hits") != 1 ||
		childLive.ExpireAt().At("stacks") != 100 || childLive.TargetExpireAt().At("hits") != 100 {
		t.Fatal("child target switch or timer writes were lost", providerStateOwnershipSnapshot(childLive))
	}
	childPublished := providerStateOwnershipSnapshot(childLive)
	assertProviderStateOwnershipView(t, "original live view after child commit", initialBag, initial)
	assertProviderStateOwnershipView(t, "parent view after child commit", parentBag, initial)

	if err := parent.executeOperations(ability, ops); err != nil {
		t.Fatal(err)
	}
	parentCurrent := parent.stageFor("source").providerState.Lookup("attack")
	if parentCurrent.State().At("stacks") != 3 || parentCurrent.TargetKey() != "target" || parentCurrent.TargetValues().At("hits") != 4 {
		t.Fatal("parent did not continue from its own state", providerStateOwnershipSnapshot(parentCurrent))
	}
	assertProviderStateOwnershipView(t, "published child after parent writes", state.combatants["source"].providerState.Lookup("attack"), childPublished)
	assertProviderStateOwnershipView(t, "saved child view after parent writes", childLive, childPublished)
	assertProviderStateOwnershipView(t, "saved parent view after parent writes", parentBag, initial)
}

func TestProviderFrameHeaderFailedTargetSwitchDoesNotPublish(t *testing.T) {
	state := providerFrameHeaderState(t, true)
	liveBag := state.combatants["source"].providerState.Lookup("attack")
	want := providerStateOwnershipSnapshot(liveBag)
	previous, _, _ := providerFrameHeaderFrame(state, "target")
	previousBag := previous.stageFor("source").providerState.Lookup("attack")
	state.budget.MaxCommandsPerEvent = 2
	failed, ability, ops := providerFrameHeaderFrame(state, "source")
	err := failed.executeOperations(ability, ops)
	if err == nil || err.BudgetCause != model.BudgetCauseMaxCommandsPerEvent {
		t.Fatalf("expected failure after the source write and target switch: %v", err)
	}
	staged := failed.stageFor("source").providerState.Lookup("attack")
	if staged.TargetKey() != "source" || staged.State().At("stacks") != 3 || staged.TargetValues().At("hits") != 1 ||
		staged.ExpireAt().At("stacks") != 100 || staged.TargetExpireAt().At("hits") != 100 {
		t.Fatal("frame failed before the intended header/state/timer writes", providerStateOwnershipSnapshot(staged))
	}
	failed.commit()
	if failed.committed {
		t.Fatal("failed frame committed its target switch")
	}
	assertProviderStateOwnershipView(t, "live after failed target switch", state.combatants["source"].providerState.Lookup("attack"), want)
	assertProviderStateOwnershipView(t, "borrowed live view after failure", liveBag, want)
	assertProviderStateOwnershipView(t, "previous frame after failure", previousBag, want)
}

func TestProviderFrameHeaderPostCommitGetterAndLiveExpiryKeepPublishedViews(t *testing.T) {
	state := providerFrameHeaderState(t, false)
	frame, ability, ops := providerFrameHeaderFrame(state, "target")
	if err := frame.executeOperations(ability, ops); err != nil {
		t.Fatal(err)
	}
	publishedBag := frame.stageFor("source").providerState.Lookup("attack")
	wantPublished := providerStateOwnershipSnapshot(publishedBag)
	frame.commit()
	if frame.fatal || !frame.committed {
		t.Fatalf("frame did not commit: %v", frame.fatalErr)
	}
	liveBeforeExpiry := state.combatants["source"].providerState.Lookup("attack")
	assertProviderStateOwnershipView(t, "committed live state", liveBeforeExpiry, wantPublished)

	// 已提交帧的读取会惰性清源状态，仍不能改当前live或先前发布的包。
	state.loop.Advance(100)
	local := frame.providerStateBag("source", "attack", false).View()
	if local.State().At("stacks") != 0 || local.ExpireAt().At("stacks") != 0 || local.TargetValues().At("hits") != 4 || local.TargetExpireAt().At("hits") != 100 {
		t.Fatal("post-commit getter changed provider/target expiry semantics", providerStateOwnershipSnapshot(local))
	}
	wantLocal := providerStateOwnershipSnapshot(local)
	assertProviderStateOwnershipView(t, "published bag after frame getter", publishedBag, wantPublished)
	assertProviderStateOwnershipView(t, "live after frame getter", state.combatants["source"].providerState.Lookup("attack"), wantPublished)

	state.lazyExpireAllProviderState()
	expired := state.combatants["source"].providerState.Lookup("attack")
	if expired.State().At("stacks") != 0 || expired.ExpireAt().At("stacks") != 0 || expired.TargetValues().At("hits") != 0 || expired.TargetExpireAt().At("hits") != 0 || expired.TargetKey() != "target" {
		t.Fatal("global inclusive expiry did not settle both scopes", providerStateOwnershipSnapshot(expired))
	}
	assertProviderStateOwnershipView(t, "published bag after live expiry", publishedBag, wantPublished)
	assertProviderStateOwnershipView(t, "borrowed live view after expiry", liveBeforeExpiry, wantPublished)
	assertProviderStateOwnershipView(t, "post-commit frame view after live expiry", local, wantLocal)
}

func TestProviderFrameHeaderFormulaReadsKeepOriginalExpiryScopes(t *testing.T) {
	t.Run("frame_context_only_expires_source", func(t *testing.T) {
		state := providerFrameHeaderState(t, false)
		original := state.combatants["source"].providerState.Lookup("attack")
		want := providerStateOwnershipSnapshot(original)
		state.loop.Advance(50)
		frame, ability, _ := providerFrameHeaderFrame(state, "target")
		context := requireFrameEvalContext(t, frame, ability)
		local := frame.stageFor("source").providerState.Lookup("attack")
		if context.ProviderState.At("stacks") != 0 || context.ProviderTargetState.At("hits") != 3 ||
			local.ExpireAt().At("stacks") != 0 || local.TargetExpireAt().At("hits") != 50 {
			t.Fatal("frame formula context changed its source-only expiry scope", providerStateOwnershipSnapshot(local))
		}
		assertProviderStateOwnershipView(t, "live after frame formula read", state.combatants["source"].providerState.Lookup("attack"), want)
		assertProviderStateOwnershipView(t, "saved live view after frame formula read", original, want)
	})
	t.Run("overlay_expires_invisible_target", func(t *testing.T) {
		state := providerFrameHeaderState(t, false)
		original := state.combatants["source"].providerState.Lookup("attack")
		want := providerStateOwnershipSnapshot(original)
		state.loop.Advance(50)
		frame, _, _ := providerFrameHeaderFrame(state, "source")
		context := frame.providerFormulaContextForTarget("source", "source", true)("source", "attack")
		local := frame.stageFor("source").providerState.Lookup("attack")
		if context.ProviderTargetState.Present() || context.ProviderState.At("stacks") != 0 ||
			local.TargetKey() != "target" || local.TargetValues().At("hits") != 0 || local.TargetExpireAt().At("hits") != 0 {
			t.Fatal("provider overlay tied expiry to target visibility", providerStateOwnershipSnapshot(local))
		}
		assertProviderStateOwnershipView(t, "live after invisible-target overlay", state.combatants["source"].providerState.Lookup("attack"), want)
		assertProviderStateOwnershipView(t, "saved live view after invisible-target overlay", original, want)
	})
}
