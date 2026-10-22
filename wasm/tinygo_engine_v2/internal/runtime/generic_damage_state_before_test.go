package runtime

import (
	"reflect"
	"strings"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func addTimingKillRecovery(c *model.CompileRequest) {
	p := &c.SharedProviders[len(c.SharedProviders)-1]
	before := authoringRead("event.provider_target_state_before.count")
	killed := authoringBinary("eq", authoringRead("event.damage.killed"), authoringConst(1))
	for _, branch := range []string{"burning", "first_spell", "producer"} {
		compare := "eq"
		if branch == "burning" {
			compare = "gt"
		}
		cond := authoringBinary("min", killed, authoringBinary(compare, before, authoringConst(0)))
		matcher := model.TypeMatcher{All: []string{"event/damage_instance", "event/source_owner"}}
		if branch == "first_spell" {
			for _, a := range c.SharedProviders {
				if strings.HasPrefix(a.SkillKey, "phase_contact_") {
					matcher.Any = append(matcher.Any, "ability/skill/"+a.SkillKey)
				}
			}
		}
		if branch == "producer" {
			matcher.All = append(matcher.All, "ability/passive")
		}
		p.Abilities = append(p.Abilities, model.AbilityDefinition{AbilityKey: "refund_" + branch, Kind: "passive_listener", SkillKey: p.SkillKey, Types: []string{"ability/passive"}, Params: map[string]float64{"refund": 20}, ListenerSpec: &model.ListenerDefinition{ListenerKey: "refund_" + branch, EventMatcher: matcher, MaxTriggersPerEvent: 1, Condition: &cond, Operations: []model.OperationDefinition{{Operation: "resource_change", Target: "self", ResourceKey: "mana", Ref: "refund_" + branch, Amount: authoringAmount(authoringRead("ability.param.refund"))}}}})
	}
}

func TestDamageStateBeforeKillORAndRealDamageIdentity(t *testing.T) {
	for _, scenario := range []string{"first_spell", "burning_attack", "terminal_tick", "explosion"} {
		t.Run(scenario, func(t *testing.T) {
			explode := scenario == "explosion"
			hits := []int64{0}
			if explode {
				hits = []int64{0, 100, 200}
			}
			c, r := targetTimingInput(explode, hits...)
			addTimingKillRecovery(&c)
			r.StopPolicy.DurationMs = 4500
			health := c.Combatants[1].Attributes["hp"]
			health.Current = 20
			if explode {
				health.Current = 90
			}
			if scenario == "first_spell" {
				health.Current = 1000
				c.SharedProviders[1].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = timedShieldExpr(1000)
			}
			if scenario == "burning_attack" {
				health.Current = 25
				c.Combatants[0].Attributes["attack_damage"] = authoringSlot(10)
			}
			c.Combatants[1].Attributes["hp"] = health
			d := authoringRun(t, c, r)
			if !d.Summary.Execution.TargetKilled {
				t.Fatal(d.Summary)
			}
			if d.FinalSnapshot.Combatants[0].Resources["mana"].Current != 20 {
				t.Fatal("mutually exclusive branches did not refund exactly once", d.FinalSnapshot.Combatants[0].Resources)
			}
			beforeByID := map[uint64]model.EvidenceItem{}
			events := map[uint64]model.EvidenceItem{}
			var restores []model.EvidenceItem
			for _, item := range d.Evidence.Items {
				switch item.Kind {
				case "damage_state_before":
					if len(item.Data) != 7 || item.Data["owner"] != "source" || item.Data["providerRef"] != "timed_mount" || item.Data["definitionRef"] != "timed_natural" || item.Data["stateKey"] != "count" || item.Data["target"] != "target" {
						t.Fatal(item)
					}
					id, ok := item.Data["damageId"].(uint64)
					if !ok || id == 0 || beforeByID[id].Data != nil {
						t.Fatal("invalid or duplicate real damage ID", item)
					}
					beforeByID[id] = item
				case model.EvidenceKindEmittedEvent:
					if item.Ref == eventTypeDamageInstance {
						id, ok := item.Data["damageId"].(uint64)
						if !ok || id == 0 {
							t.Fatal("real damage event omitted its ID", item)
						}
						events[id] = item
					}
				case "resource_restore":
					restores = append(restores, item)
				}
			}
			if len(restores) != 1 {
				t.Fatal(restores)
			}
			refund := restores[0]
			id, ok := refund.Data["triggerDamageId"].(uint64)
			if !ok || refund.Data["triggerDamageSource"] != "source" || refund.Data["triggerDamageTarget"] != "target" || beforeByID[id].Data == nil || events[id].Data == nil {
				t.Fatal("refund has no real frozen damage join", refund)
			}
			wantBefore := float64(0)
			if scenario == "burning_attack" {
				wantBefore = 1
			}
			if beforeByID[id].Data["beforeValue"] != wantBefore {
				t.Fatal("read live/count after cleanup instead of before actual HP loss", scenario, beforeByID[id])
			}
			found := false
			for _, row := range d.DamageRecords {
				if row["damageId"] == id {
					found = true
					if scenario == "burning_attack" && row["operationRef"] != "body" {
						t.Fatal("kill was not the actual background attack", row)
					}
				}
			}
			if !found {
				t.Fatal("joined ID absent in actual damage records", id, d.DamageRecords)
			}
			if scenario == "terminal_tick" || scenario == "explosion" {
				if refund.Data["useRef"] != nil {
					t.Fatal("periodic damage manufactured a use", refund)
				}
			}
		})
	}
}

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

func TestDamageStateBeforeSameFrameUsesEachStagedValue(t *testing.T) {
	c, r := beforePacketsInput()
	d := authoringRun(t, c, r)
	var values []float64
	var ids []uint64
	for _, item := range d.Evidence.Items {
		if item.Kind == "damage_state_before" {
			values = append(values, item.Data["beforeValue"].(float64))
			ids = append(ids, item.Data["damageId"].(uint64))
		}
	}
	if !reflect.DeepEqual(values, []float64{1, 0}) || len(ids) != 2 || ids[0] == ids[1] || d.FinalSnapshot.Combatants[0].Resources["mana"].Current != 20 {
		t.Fatal("same frame froze an entry/live value instead of each packet", values, ids, d.FinalSnapshot.Combatants[0].Resources)
	}
	zero := 0
	r.RecordBudget = &model.RecordBudget{MaxDamageRecords: &zero}
	r.OutputMode = "summary"
	summary := authoringRun(t, c, r)
	if summary.Summary.SourceDamageDealt != 30 || summary.FinalSnapshot.Combatants[0].Resources["mana"].Current != 20 || len(summary.Evidence.Items) != 0 {
		t.Fatal(summary)
	}
}

func TestDamageStateBeforeUntimedCounterPreservesRealPositiveValue(t *testing.T) {
	c, r := beforePacketsInput()
	p := &c.SharedProviders[len(c.SharedProviders)-1]
	field := p.InitialStateSchema["mark"].(map[string]interface{})
	field["durationMs"] = 0
	delete(field, "refreshPolicy")
	p.Abilities = p.Abilities[len(p.Abilities)-2:]
	// The first positive value has no expiry. It still belongs to the actual
	// target and must survive until the explicit intervening SET0.
	d := authoringRun(t, c, r)
	var values []float64
	for _, item := range d.Evidence.Items {
		if item.Kind == "damage_state_before" {
			values = append(values, item.Data["beforeValue"].(float64))
		}
	}
	if !reflect.DeepEqual(values, []float64{1, 0}) || d.FinalSnapshot.Combatants[0].Resources["mana"].Current != 20 {
		t.Fatal("untimed positive counter was treated as expired", values, d.FinalSnapshot.Combatants[0].Resources)
	}
}

func TestDamageStateBeforeWrongContextsAndMissingAreNotZero(t *testing.T) {
	c, r := beforePacketsInput()
	session := authoringCompile(t, c)
	state, err := newGenericRunState(session, r)
	if err != nil {
		t.Fatal(err)
	}
	var f executionFrame
	state.initExecutionFrame(&f, "source", "target", "probe")
	f.ownerCombatantKey, f.ownerProviderRef = "source", targetRemainingProvider
	if _, err := f.DamageStateBefore("mark"); err == nil {
		t.Fatal("missing context became zero")
	}
	f.eventCtx = &eventFormulaSnapshot{eventType: eventTypeDamageInstance, eventSourceKey: "source", eventTargetKey: "target", damageID: 1}
	if _, err := f.DamageStateBefore("mark"); err == nil {
		t.Fatal("missing declared frozen fact became zero")
	}
	f.eventCtx.damageStateBefore = []frozenDamageStateBefore{{reader: 0, value: 0}}
	if value, err := f.DamageStateBefore("mark"); err != nil || value != 0 {
		t.Fatal("legitimate frozen zero rejected", value, err)
	}
	f.ownerProviderRef = "foreign"
	if _, err := f.DamageStateBefore("mark"); err == nil {
		t.Fatal("foreign mount read another instance")
	}
}

func TestDamageStateBeforeCompileDedicatedConditionOnly(t *testing.T) {
	for _, bad := range []string{"any", "aggregate", "receiver", "active_condition", "amount", "modifier", "hidden_amount", "foreign_field", "event_op", "listener_operation_condition"} {
		t.Run(bad, func(t *testing.T) {
			c, _ := beforePacketsInput()
			p := &c.SharedProviders[len(c.SharedProviders)-1]
			listener := p.Abilities[len(p.Abilities)-1].ListenerSpec
			read := authoringRead("event.provider_target_state_before.mark")
			switch bad {
			case "any":
				listener.EventMatcher = model.TypeMatcher{Any: []string{"event/damage_instance", "event/source_owner"}}
			case "aggregate":
				ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "event/damage_dealt", Domain: "event"})
				listener.EventMatcher.All[0] = "event/damage_dealt"
			case "receiver":
				ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "event/target_owner", Domain: "event"})
				listener.EventMatcher.All[1] = "event/target_owner"
			case "active_condition":
				p.Abilities[0].CastCondition = &read
			case "amount":
				p.Abilities[0].Operations[0].Amount = &read
			case "modifier":
				p.Modifiers = []model.ModifierDefinition{{ModifierKey: "bad", Kind: "attribute", Target: "self.attr.armor", ValuePolicy: "add", Value: read}}
			case "hidden_amount":
				p.Abilities[0].Operations[0].Amount = &model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringConst(1), authoringConst(1), read}}
			case "foreign_field":
				delete(p.InitialStateSchema, "mark")
			case "event_op":
				p.Abilities[0].Operations = append(p.Abilities[0].Operations, model.OperationDefinition{Operation: "emit_event", Target: "target", EventType: "event/damage_instance"})
			case "listener_operation_condition":
				listener.Operations[0].Condition = &read
			}
			if result := compilebundle.CompileGeneric(c); result.OK {
				t.Fatal("unauthorized before read accepted", bad)
			}
		})
	}
	for _, repeat := range []bool{false, true} {
		c, r := beforePacketsInput()
		read := authoringRead("event.provider_target_state_before.mark")
		hidden := model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringConst(1), authoringConst(100), read}}
		if repeat {
			r.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{IntervalFormula: &hidden}
		} else {
			r.DriverPlan.Entries[0].Condition = &hidden
		}
		session := authoringCompile(t, c)
		if _, err := RunGeneric(session, r); err == nil {
			t.Fatal("hidden driver dependency accepted", repeat)
		}
	}
}

func TestDamageStateBeforeNoReaderSessionHasNoCapture(t *testing.T) {
	c, r := targetTimingInput(false, 0)
	session := authoringCompile(t, c)
	if session.HasDamageStateBefore || session.DamageStateReaders != nil {
		t.Fatal("readers enabled without a consumer")
	}
	state, err := newGenericRunState(session, r)
	if err != nil {
		t.Fatal(err)
	}
	var f executionFrame
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

func TestDamageStateBeforeOwnersTargetsAndResourceClipping(t *testing.T) {
	for _, current := range []float64{0, 90, 100} {
		c, r := beforePacketsInput()
		c.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: current, Max: 100}
		r.InitialSnapshot.Combatants[0].Resources = c.Combatants[0].Resources
		d := authoringRun(t, c, r)
		actual := 20.0
		if actual > 100-current {
			actual = 100 - current
		}
		var rows []model.EvidenceItem
		for _, item := range d.Evidence.Items {
			if item.Kind == "resource_restore" {
				rows = append(rows, item)
			}
		}
		if len(rows) != 1 || rows[0].Data["requestedAmount"] != float64(20) || rows[0].Data["currentBefore"] != current || rows[0].Data["currentAfter"] != current+actual || rows[0].Data["actualDelta"] != actual || rows[0].Data["overflow"] != 20-actual {
			t.Fatal("clip accounting changed the frozen trigger", current, rows)
		}
	}
	c, r := beforePacketsInput()
	p := c.SharedProviders[len(c.SharedProviders)-1]
	c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "other_owner", DefinitionRef: p.ProviderKey})
	r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: "other_owner", DefinitionRef: p.ProviderKey, Owner: "target", Source: "target", Stacks: 1})
	c.Combatants[1].Resources["mana"] = model.ResourceSlotDef{Current: 0, Max: 100}
	r.InitialSnapshot.Combatants[1].Resources = c.Combatants[1].Resources
	health := c.Combatants[1].Attributes["hp"]
	health.Current = 1000
	c.Combatants[1].Attributes["hp"] = health
	r.InitialSnapshot.Combatants[1].Attributes = c.Combatants[1].Attributes
	r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{EntryKey: "other_packets", AbilityRef: "target.provider[other_owner].ability[packets]", Source: "target", Target: "source", FirstAtMs: 1})
	formuladefinition.SetDamageFormula(&c, "damage/physics", formuladefinition.ConstantDefense("1"))
	d := authoringRun(t, c, r)
	var keys []string
	for _, item := range d.Evidence.Items {
		if item.Kind == "damage_state_before" {
			owner := item.Data["owner"].(string)
			target := item.Data["target"].(string)
			ref := item.Data["providerRef"].(string)
			if owner == target || owner == "source" && ref != targetRemainingProvider || owner == "target" && ref != "other_owner" {
				t.Fatal("fact crossed actual owner/target mount", item)
			}
			keys = append(keys, owner)
		}
	}
	if !reflect.DeepEqual(keys, []string{"source", "source", "target", "target"}) {
		t.Fatal(keys)
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
	if s.sourceDamageDealt != 30 || s.combatants["target"].attributes.At("hp").Current != 0 || s.combatants["source"].resources["mana"].Current != 0 || s.nextDamageID != 2 || s.evidenceCountsByKind["damage_state_before"] != 2 || s.evidenceCountsByKind["resource_restore"] != 0 {
		t.Fatal("child failure rolled back parent damage or published partial recovery", s.sourceDamageDealt, s.nextDamageID, s.evidenceCountsByKind, s.combatants["source"].resources)
	}
}
