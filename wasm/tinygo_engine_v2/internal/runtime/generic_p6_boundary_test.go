package runtime

import (
	"testing"
	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func p6BoundaryFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	return p6SkillHit(t, []model.ListenerDefinition{{
		ListenerKey: "once", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
		OncePerUse: &model.OncePerUseLimit{GroupKey: "proc", Scope: model.OncePerUseScopeProviderTarget},
		Operations: []model.OperationDefinition{p6StateAdd("count", 1)},
	}}, map[string]interface{}{"count": p6SchemaField(0, 2, 100, model.ProviderStateRefreshStartOnFirstWrite)}, 0, false, 50)
}

func TestP6RestoreRejectsRawStateBeforeCoercion(t *testing.T) {
	cases := map[string]interface{}{
		"bag":            "not-an-object",
		"state":          map[string]interface{}{"state": "not-an-object"},
		"value":          map[string]interface{}{"state": map[string]interface{}{"count": "not-a-number"}},
		"unknown_value":  map[string]interface{}{"state": map[string]interface{}{"not_declared": "not-a-number"}},
		"timers":         map[string]interface{}{"expireAt": "not-an-object"},
		"missing_target": map[string]interface{}{"targetState": map[string]interface{}{"values": map[string]interface{}{"count": float64(1)}, "expireAt": map[string]interface{}{"count": float64(100)}}},
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			c, r := p6BoundaryFixture(t)
			r.InitialSnapshot.Combatants[0].ProviderState = map[string]interface{}{p6ItemRef: raw}
			p6MustFailRun(t, c, r)
		})
	}
}

func TestP6RestoreLedgerRequiresRealActors(t *testing.T) {
	for _, field := range []string{"source", "target"} {
		t.Run(field, func(t *testing.T) {
			c, r := p6BoundaryFixture(t)
			target := "target"
			row := model.UseTriggerLedgerEntry{Owner: "source", ProviderRef: p6ItemRef, GroupKey: "proc", Scope: model.OncePerUseScopeProviderTarget, UseSource: "source", UseSkillKey: "past_skill", UseKey: "past_use", Target: &target}
			if field == "source" {
				row.UseSource = "absent_actor"
			} else {
				target = "absent_actor"
			}
			r.InitialSnapshot.UseTriggerLedger = []model.UseTriggerLedgerEntry{row}
			p6MustFailRun(t, c, r)
		})
	}
}

func TestP6LedgerSortOrdersDistinctSources(t *testing.T) {
	a := model.UseTriggerLedgerEntry{Owner: "source", ProviderRef: "p", GroupKey: "g", Scope: model.OncePerUseScopeProvider, UseSource: "source", UseSkillKey: "q", UseKey: "u"}
	b := a
	b.UseSource = "target"
	if !useTriggerLedgerLess(a, b) || useTriggerLedgerLess(b, a) {
		t.Fatal("different source identities require a total deterministic ordering")
	}
}

func TestP6OnceCannotSilentlyLoseLimitOnDynamicProvider(t *testing.T) {
	c, _ := p6BoundaryFixture(t)
	p := &c.SharedProviders[len(c.SharedProviders)-1]
	p.Kind = "status"
	p.Lifecycle = &model.ProviderLifecycle{DurationMs: p6Amt(100), MaxStacks: 1, RefreshPolicy: "replace"}
	if result := compile.CompileGeneric(c); result.OK {
		t.Fatal("dynamic provider must reject unsupported oncePerUse instead of silently bypassing it")
	}
}

func TestP6OutputCannotBeReadByCastGate(t *testing.T) {
	c, _ := p6BoundaryFixture(t)
	read := p6Read("operation.output.other.POST_DEFENSE_DAMAGE")
	c.SharedProviders[0].Abilities[0].CastCondition = &read
	if result := compile.CompileGeneric(c); result.OK {
		t.Fatal("cast gate cannot read a future or different-frame damage output")
	}
}

func TestP6InlineAbilityCannotBypassFrozenCondition(t *testing.T) {
	c, _ := p6BoundaryFixture(t)
	p := &c.SharedProviders[len(c.SharedProviders)-1]
	spec := p.Listeners[0]
	spec.Operations = nil
	p.Listeners = nil
	op := p6StateAdd("count", 1)
	op.Condition = p6Eq("provider.state.count", 0)
	p.Abilities = []model.AbilityDefinition{{AbilityKey: "inline_once", Kind: "passive_listener", ListenerSpec: &spec, Operations: []model.OperationDefinition{op}}}
	if result := compile.CompileGeneric(c); result.OK {
		t.Fatal("inline ability operations must obey the same oncePerUse frozen-condition restriction")
	}
}

func TestP6AttackStartReverseActorsPreserveOriginalUse(t *testing.T) {
	c, r := p6BoundaryFixture(t)
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{{AbilityKey: "start", Kind: "active", SkillKey: "actual_attack", Types: []string{model.AbilityTypeBasicAttack}}}
	c.SharedProviders[len(c.SharedProviders)-1].Listeners[0].EventMatcher.All[0] = model.EventTypeBasicAttackStart
	for _, mount := range c.Combatants[0].Providers {
		c.Combatants[1].Providers = append(c.Combatants[1].Providers, mount)
		r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{
			ProviderRef: mount.ProviderRef, DefinitionRef: mount.DefinitionRef, Source: "target", Owner: "target", Stacks: 1, State: map[string]interface{}{},
		})
	}
	r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "reverse_start", AbilityRef: "target.provider[champion:source_demo].ability[start]", Source: "target", Target: "source"}}
	r.SkillUses = []model.SkillUseFact{{UseKey: "actual_use", Source: "target", SkillKey: "actual_attack", HistoryState: model.SkillHitHistoryComplete}}
	r.AttackStartFacts = []model.AttackStartFact{{DriverEntryKey: "reverse_start", UseRef: "actual_use"}}
	done := p6MustRun(t, c, r)
	ledger := done.FinalSnapshot.UseTriggerLedger
	if len(ledger) != 1 || ledger[0].Owner != "target" || ledger[0].UseSource != "target" || ledger[0].Target == nil || *ledger[0].Target != "source" {
		t.Fatalf("attack-start quota must belong to the actual actor and original target: %+v", ledger)
	}
	found := false
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == model.EventTypeBasicAttackStart {
			found = true
			if item.Data["source"] != "target" || item.Data["target"] != "source" || item.Data["useRef"] != "actual_use" {
				t.Fatalf("start event: %+v", item)
			}
		}
	}
	if !found {
		t.Fatal("missing native attack-start event")
	}
}
