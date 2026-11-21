package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func beforePacketsInput() (model.CompileRequest, model.RunRequest) {
	c, r := targetRemainingInput()
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"})
	p := &c.SharedProviders[len(c.SharedProviders)-1]
	first := model.OperationDefinition{Operation: "damage", Target: "target", DamageType: "damage/physics", Ref: "packet1", Amount: timedShieldExpr(10)}
	second := first
	second.Ref, second.Amount = "packet2", timedShieldExpr(20)
	p.Abilities = append(p.Abilities, model.AbilityDefinition{AbilityKey: "packets", SkillKey: p.SkillKey, Kind: "active", Operations: []model.OperationDefinition{targetRemainingStateOperation(1), first, targetRemainingStateOperation(0), second}})
	condition := authoringBinary("min", authoringBinary("eq", authoringRead("event.damage.killed"), authoringConst(1)), authoringBinary("eq", authoringRead("event.provider_target_state_before.mark"), authoringConst(0)))
	p.Abilities = append(p.Abilities, model.AbilityDefinition{AbilityKey: "refund", Kind: "passive_listener", SkillKey: p.SkillKey, ListenerSpec: &model.ListenerDefinition{ListenerKey: "refund", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{"event/damage_instance", "event/source_owner"}}, Condition: &condition, Operations: []model.OperationDefinition{{Operation: "resource_change", Target: "self", ResourceKey: "mana", Amount: timedShieldExpr(20)}}}})
	c.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 0, Max: 100}
	health := c.Combatants[1].Attributes["hp"]
	health.Current = 25
	c.Combatants[1].Attributes["hp"] = health
	r.InitialSnapshot.Combatants[0].Resources = c.Combatants[0].Resources
	r.InitialSnapshot.Combatants[1].Attributes = c.Combatants[1].Attributes
	r.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{targetRemainingEntry("packets", "packets", 0)}}
	r.StopPolicy.DurationMs = 100
	return c, r
}

func TestDamageStateBeforeWrongContextsAndMissingAreNotZero(t *testing.T) {
	c, r := beforePacketsInput()
	session := authoringCompile(t, c)
	state, err := newGenericRunState(session, r)
	if err != nil {
		t.Fatal(err)
	}
	var f Frame
	state.initExecutionFrame(&f, "source", "target", "probe")
	f.ownerCombatantKey, f.ownerProviderRef = "source", targetRemainingProvider
	if _, err := f.damageStateBefore("mark"); err == nil {
		t.Fatal("missing context became zero")
	}
	f.eventCtx = &eventFormulaSnapshot{EventType: eventTypeDamageInstance, EventSourceKey: "source", EventTargetKey: "target", DamageID: 1}
	if _, err := f.damageStateBefore("mark"); err == nil {
		t.Fatal("missing declared frozen fact became zero")
	}
	f.eventCtx.DamageStateBefore = []frozenDamageStateBefore{{Reader: 0, Value: 0}}
	if value, err := f.damageStateBefore("mark"); err != nil || value != 0 {
		t.Fatal("legitimate frozen zero rejected", value, err)
	}
	f.ownerProviderRef = "foreign"
	if _, err := f.damageStateBefore("mark"); err == nil {
		t.Fatal("foreign mount read another instance")
	}
}

func TestDamageStateBeforeNoReaderSessionHasNoCapture(t *testing.T) {
	c, r := targetTimingInput(false, 0)
	session := authoringCompile(t, c)
	if session.Features.Has(plan.FeatureDamageStateBefore) || session.DamageStateReaders != nil {
		t.Fatal("readers enabled without a consumer")
	}
	state, err := newGenericRunState(session, r)
	if err != nil {
		t.Fatal(err)
	}
	var f Frame
	state.initExecutionFrame(&f, "source", "target", "probe")
	rows, err := f.captureDamageStateBefore("source", "target")
	if err != nil || rows != nil {
		t.Fatal(rows, err)
	}
	d := authoringRun(t, c, r)
	for _, item := range d.Evidence.Items {
		if item.Kind == "damage_state_before" || item.Kind == model.EvidenceKindEmittedEvent && item.Ref == eventTypeDamageInstance && item.Data["damageId"] != nil {
			t.Fatal("no-reader event acquired new facts", item)
		}
	}
}

func TestDamageStateBeforeFailedChildRecoveryDoesNotPublishPartialFacts(t *testing.T) {
	c, r := beforePacketsInput()
	p := &c.SharedProviders[len(c.SharedProviders)-1]
	listener := p.Abilities[len(p.Abilities)-1].ListenerSpec
	listener.Operations = append(listener.Operations, model.OperationDefinition{Operation: "resource_change", Target: "self", ResourceKey: "missing_resource", Amount: timedShieldExpr(1)})
	session := authoringCompile(t, c)
	s, err := newGenericRunState(session, r)
	if err != nil {
		t.Fatal(err)
	}
	err = s.runLoop()
	if err == nil {
		t.Fatal("missing resource did not fail the child frame")
	}
	if s.report.Totals().SourceDamageDealt != 30 || s.combatants["target"].attributesView().At("hp").Current != 0 || s.combatants["source"].resourceView().At("mana").Current != 0 || s.nextDamageID != 2 || s.report.Snapshot().Evidence.CountsByKind["damage_state_before"] != 2 || s.report.Snapshot().Evidence.CountsByKind["resource_restore"] != 0 {
		t.Fatal("child failure rolled back parent damage or published partial recovery", s.report.Totals().SourceDamageDealt, s.nextDamageID, s.report.Snapshot().Evidence.CountsByKind, s.combatants["source"].resourceView())
	}
}
