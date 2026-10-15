package runtime

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

const listenerCooldownProvider = "item:listener_cooldown_regression"

func listenerCooldownUseState(t *testing.T) (*genericRunState, string) {
	t.Helper()
	// 有限手动多段过程提供同一真实使用及施放身份，六次真实命中发生在100～600ms。
	input, request := complexSkillInput("MULTI_HIT", false)
	input.SharedProviders[0].Processes[0].Steps[0].RepeatCount = timedShieldExpr(6)
	for index := range input.Combatants {
		hp := model.AttributeSlotDef{Base: 10000, Current: 10000, Max: 10000, Resolved: 10000}
		input.Combatants[index].Attributes["hp"] = hp
		request.InitialSnapshot.Combatants[index].Attributes["hp"] = hp
	}
	childRef := "source.provider[" + listenerCooldownProvider + "].ability[proc]"
	ensureC1CatalogTypes(&input, model.TypeCatalogEntry{Key: eventTypeDamageInstance, Domain: "event"})
	listener := model.ListenerDefinition{
		ListenerKey: "child_cd_gate", MaxTriggersPerEvent: 1,
		EventMatcher: model.TypeMatcher{All: []string{eventTypeDamageInstance, "event/source_owner"}},
		AbilityRef:   childRef, PerCastThrottleMs: 300,
	}
	mountP6Item(&input, &request, model.ProviderDefinition{
		ProviderKey: listenerCooldownProvider, Kind: "item", StableID: "listener_cooldown_regression",
		InitialStateSchema: map[string]interface{}{"procs": p6SchemaField(0, 99, 0, "")},
		Listeners:          []model.ListenerDefinition{listener},
		Abilities: []model.AbilityDefinition{{
			AbilityKey: "proc", Kind: "active",
			Cooldown:   &model.AbilityCooldown{DurationMs: *timedShieldExpr(200)},
			Operations: []model.OperationDefinition{p6StateAdd("procs", 1)},
		}},
	})
	state, err := newGenericRunState(authoringCompile(t, input), request)
	if err != nil {
		t.Fatal(err)
	}
	for _, compiled := range state.compiled.Listeners {
		if compiled.ListenerKey == listener.ListenerKey && (!compiled.HasAbilityRef || compiled.OperationCount != 0) {
			t.Fatal("regression listener must execute only its child ability", compiled)
		}
	}
	// 使用真实子能力施放建立200ms冷却；不预置期限或伪造成功命中事件。
	if err := state.castAbilityAt("source", "target", childRef, 0, nil, nil, ""); err != nil {
		t.Fatal(err)
	}
	if state.combatants["source"].cooldowns.abilityReadyAt("source", childRef) != 200 || state.statFor(childRef).castCount != 1 {
		t.Fatal("priming child cast did not commit its real cooldown")
	}
	return state, childRef
}

func listenerCooldownNextHit(t *testing.T, state *genericRunState, at int64) {
	t.Helper()
	event, exists := state.heap.Pop()
	if !exists || event.TimeMs != at {
		t.Fatal("missing real skill process event", event, exists, at)
	}
	state.nowMs, state.currentEventCommands = event.TimeMs, 0
	state.processedEvents++
	var err *model.EngineError
	switch event.Kind {
	case scheduler.GenericEventSkillAction:
		err = state.handleSkillAction(event.SkillActionIndex)
	case scheduler.GenericEventProcessTimer:
		err = state.handleProcessTimer(event)
	default:
		t.Fatal("unexpected event in native skill process", event)
	}
	if err != nil || state.processFailure != nil {
		t.Fatal(err, state.processFailure)
	}
}

func listenerCooldownProcCount(t *testing.T, state *genericRunState) float64 {
	t.Helper()
	bag := state.combatants["source"].providerState[listenerCooldownProvider]
	if bag == nil {
		t.Fatal("missing committed child provider state")
	}
	return bag.state["procs"]
}

func TestListenerChildCooldownSkipPreservesSameUseCastThrottle(t *testing.T) {
	state, childRef := listenerCooldownUseState(t)
	listenerCooldownNextHit(t, state, 100)
	action := state.skillActionByUse["skill:cast_once"]
	if action == nil || action.uses.StartedCount != 1 || action.uses.HitCount != 1 || len(state.processInstances) != 1 {
		t.Fatal("first event lacked its real originating use", action)
	}
	castID := state.processInstances[0].castID
	if castID == 0 || state.statFor(childRef).castCount != 1 || listenerCooldownProcCount(t, state) != 1 {
		t.Fatal("cooldown-blocked event executed the child", castID)
	}
	if len(state.useTriggerLedger) != 0 || state.useTriggerReserving != 0 || len(state.perCastThrottle) != 0 {
		t.Fatal("cooldown skip recorded a cast throttle", state.useTriggerLedger, state.perCastThrottle)
	}
	listenerCooldownNextHit(t, state, 200)
	if action.uses.HitCount != 2 || state.processInstances[0].castID != castID || state.statFor(childRef).castCount != 2 || listenerCooldownProcCount(t, state) != 2 {
		t.Fatal("same use did not trigger at the exact cooldown boundary", action.uses, state.statFor(childRef))
	}
	if state.combatants["source"].cooldowns.abilityReadyAt("source", childRef) != 400 {
		t.Fatal("successful child did not commit its next cooldown")
	}
	if len(state.perCastThrottle) != 1 {
		t.Fatal("successful child omitted the real cast throttle", state.perCastThrottle)
	}
	for key, last := range state.perCastThrottle {
		if key.castInstanceID != castID || key.ownerCombatantKey != "source" || key.ownerProviderRef != listenerCooldownProvider || last != 200 {
			t.Fatal("throttle captured a skipped event or child cast identity", key, last)
		}
	}
	listenerCooldownNextHit(t, state, 300)
	listenerCooldownNextHit(t, state, 400)
	if state.statFor(childRef).castCount != 2 {
		t.Fatal("ready child bypassed the active cast throttle")
	}
	listenerCooldownNextHit(t, state, 500)
	if state.statFor(childRef).castCount != 3 {
		t.Fatal("same-cast throttle boundary changed", state.statFor(childRef))
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	if action.uses.HitCount != 6 || action.uses.CompletedCount != 1 || state.statFor(childRef).castCount != 3 || listenerCooldownProcCount(t, state) != 3 {
		t.Fatal("native completion or successful child count changed", action.uses, state.statFor(childRef))
	}
	if len(state.snapshotUseTriggerLedger()) != 0 || state.useTriggerReserving != 0 {
		t.Fatal("cast-throttle-only listener invented a use quota")
	}
}
