package execution

import (
	fmt "fmt"
	reflect "reflect"
	testing "testing"
	formula "tinygo_engine_v2/internal/formula"
	model "tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	scheduler "tinygo_engine_v2/internal/scheduler"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func timingSet(key string, value float64) model.OperationDefinition {
	return model.OperationDefinition{Operation: "state_change", Target: "self", Ref: key, Types: []string{stateScopeProviderTarget}, ValuePolicy: "set", Amount: timedShieldExpr(value)}
}

func timingDamage(key string, amount model.GenericFormulaExpr) model.OperationDefinition {
	return model.OperationDefinition{Operation: "damage", Target: "target", Ref: key, DamageType: "damage/magic", Amount: &amount, Types: []string{"damage_trait/delivery_skill", "damage_trait/origin_direct"}, VampQualification: model.VampResolved}
}

func targetTimingInput(explode bool, hitTimes ...int64) (model.CompileRequest, model.RunRequest) {
	c, r := continuousAttackInput(1, 1000, 0, 0, 0, 6500)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "damage_trait/delivery_basic_attack", Domain: "damage_trait"})
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: stateScopeProviderTarget, Domain: "state_scope"}, model.TypeCatalogEntry{Key: "event/skill_hit", Domain: "event"}, model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"}, model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"}, model.TypeCatalogEntry{Key: "event/ability_started", Domain: "event"}, model.TypeCatalogEntry{Key: "ability/spell", Domain: "ability"}, model.TypeCatalogEntry{Key: "ability/passive", Domain: "ability"}, model.TypeCatalogEntry{Key: "damage/magic", Domain: "damage"}, model.TypeCatalogEntry{Key: "damage_trait/delivery_skill", Domain: "damage_trait"}, model.TypeCatalogEntry{Key: "damage_trait/origin_direct", Domain: "damage_trait"}, model.TypeCatalogEntry{Key: "combatant/champion", Domain: "combatant"})
	formuladefinition.DeclareAttributes(&c, "magic_resistance", "ability_power", "omnivamp_percent")
	formuladefinition.SetDamageFormula(&c, "damage/magic", formuladefinition.ConstantDefense("1"))
	c.Rules.VampRules = []model.VampRuleDefinition{{VampType: model.VampOmnivamp, SourceAttributeKey: "omnivamp_percent", BasisOutputKind: model.VampPostDefense, DefaultEfficiency: model.Float64Ptr(1), TargetMatcher: model.TypeMatcher{All: []string{"combatant/champion"}}, AbilityMatcher: model.TypeMatcher{Any: []string{"ability/spell", "ability/passive", model.AbilityTypeBasicAttack}}, DamageMatcher: model.TypeMatcher{All: []string{"damage_trait/origin_direct"}}}}
	for ai := range c.SharedProviders[0].Abilities {
		for oi := range c.SharedProviders[0].Abilities[ai].Operations {
			op := &c.SharedProviders[0].Abilities[ai].Operations[oi]
			if op.SkillHit != nil {
				for ci := range op.SkillHit.Candidates {
					for li := range op.SkillHit.Candidates[ci].Operations {
						leaf := &op.SkillHit.Candidates[ci].Operations[li]
						if leaf.Operation == "damage" {
							leaf.VampQualification = model.VampResolved
							leaf.Types = []string{"damage_trait/delivery_basic_attack", "damage_trait/origin_direct"}
						}
					}
				}
			}
		}
	}
	for i := range c.Combatants {
		c.Combatants[i].Attributes["ability_power"] = authoringSlot(0)
		c.Combatants[i].Attributes["omnivamp_percent"] = authoringSlot(0)
		c.Combatants[i].Attributes["magic_resistance"] = authoringSlot(0)
	}
	c.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Max: 1000, Current: 500, Resolved: 1000}
	c.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 0, Max: 100}
	r.DriverPlan.Entries = []model.DriverEntry{}
	for i, at := range hitTimes {
		key := fmt.Sprintf("phase_contact_%d", i)
		ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "ability/skill/" + key, Domain: "ability"})
		p, b, a := targetMarkSkill(key, at, 0)
		p.Processes[0].Steps[0] = model.ProcessStepDefinition{StepKey: "delay", StepType: "IMMEDIATE", OccupiesAction: model.BoolPtr(false)}
		c.SharedProviders = append(c.SharedProviders, p)
		c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: key, DefinitionRef: p.ProviderKey})
		c.Rules.SkillActionBindings = append(c.Rules.SkillActionBindings, b)
		r.DriverPlan.SkillActions = append(r.DriverPlan.SkillActions, a)
	}
	p := model.ProviderDefinition{ProviderKey: "timed_natural", Kind: "character", StableID: "timed_passive", SkillKey: "timed_passive", InitialStateSchema: map[string]interface{}{}}
	for _, key := range []string{"slot1", "slot2", "slot3", "pending", "cap", "count"} {
		max := float64(1)
		duration := float64(4000)
		if key == "count" {
			max = 3
		}
		if key == "pending" {
			duration = 2000
		}
		p.InitialStateSchema[key] = map[string]interface{}{"valueType": "integer", "defaultValue": 0, "maxValue": max, "durationMs": duration, "refreshPolicy": "refresh_on_write"}
	}
	for i := 1; i <= 3; i++ {
		key := fmt.Sprintf("slot%d", i)
		p.Abilities = append(p.Abilities, model.AbilityDefinition{AbilityKey: "tick_" + key, SkillKey: p.SkillKey, Kind: "tick", Types: []string{"ability/passive"}, TickSpec: &model.TickSpec{IntervalMs: 250, AnchorScope: stateScopeProviderTarget, AnchorStateKey: key, PhasePolicy: "preserve_on_extend", OnTick: []model.OperationDefinition{timingDamage("tick_"+key, authoringBinary("mul", authoringConst(.00125), authoringRead("target.attr.hp.max")))}}})
	}
	if explode {
		ops := []model.OperationDefinition{timingSet("slot1", 0), timingSet("slot2", 0), timingSet("slot3", 0), timingSet("count", 0), timingDamage("explosion", authoringBinary("mul", authoringBinary("add", authoringConst(.06), authoringBinary("mul", authoringConst(.0002), authoringRead("source.attr.ability_power.resolved"))), authoringRead("target.attr.hp.max"))), timingSet("cap", 1), timingSet("slot1", 1), timingSet("count", 1)}
		alive := authoringBinary("gt", authoringRead("target.attr.hp.current"), authoringConst(0))
		ops[6].Condition = &alive
		ops[7].Condition = &alive
		p.Abilities = append(p.Abilities, model.AbilityDefinition{AbilityKey: "detonate", Kind: "stateful", SkillKey: p.SkillKey, Types: []string{"ability/passive"}, TargetExpirySpec: &model.TargetExpirySpec{AnchorScope: stateScopeProviderTarget, AnchorStateKey: "pending", OnExpire: ops}})
	}
	for count := 0; count <= 3; count++ {
		unblocked := authoringBinary("eq", authoringRead("event.skill_hit.blocked"), authoringConst(0))
		isCount := authoringBinary("eq", authoringRead("provider.target_state.count"), authoringConst(float64(count)))
		cond := authoringBinary("min", unblocked, authoringBinary("min", isCount, authoringBinary("gt", authoringRead("target.attr.hp.current"), authoringConst(0))))
		ops := []model.OperationDefinition{}
		if count == 0 {
			ops = append(ops, timingSet("slot1", 0), timingSet("slot2", 0), timingSet("slot3", 0), timingSet("pending", 0))
		}
		if count < 3 {
			ops = append(ops, timingSet(fmt.Sprintf("slot%d", count+1), 1))
		}
		for i := 1; i <= 3; i++ {
			ops = append(ops, model.OperationDefinition{Operation: model.OperationKindStateDurationChange, Target: "self", Ref: fmt.Sprintf("slot%d", i), ValuePolicy: "ensure_remaining_preserve_phase", Types: []string{stateScopeProviderTarget}, Amount: timedShieldExpr(4000)})
		}
		next := count + 1
		if next > 3 {
			next = 3
		}
		ops = append(ops, timingSet("count", float64(next)))
		if count == 2 && explode {
			ops = append(ops, timingSet("pending", 1))
		}
		p.Abilities = append(p.Abilities, model.AbilityDefinition{AbilityKey: fmt.Sprintf("on_hit_%d", count), SkillKey: p.SkillKey, Kind: "passive_listener", Params: map[string]float64{}, ListenerSpec: &model.ListenerDefinition{ListenerKey: fmt.Sprintf("on_hit_%d", count), EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}}, MaxTriggersPerEvent: 1, Condition: &cond, Operations: ops}})
	}
	c.SharedProviders = append(c.SharedProviders, p)
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "timed_mount", DefinitionRef: p.ProviderKey})
	for i, actor := range c.Combatants {
		providers := []model.CombatantProviderSnapshot{}
		for _, m := range actor.Providers {
			providers = append(providers, model.CombatantProviderSnapshot{ProviderRef: m.ProviderRef, DefinitionRef: m.DefinitionRef, Source: actor.Key, Owner: actor.Key, Stacks: 1})
		}
		r.InitialSnapshot.Combatants[i] = model.CombatantSnapshot{Key: actor.Key, Attributes: actor.Attributes, Resources: actor.Resources, Providers: providers}
	}
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	return c, r
}

// This advances the real initial source/skill/attack/timer queue without
// serializing or restoring a new timing source. It leaves the real expiry fact
// and remaining public events available for a failure-path check.
func targetTimingStateUntil(t *testing.T, c model.CompileRequest, r model.RunRequest, until int64) *Engine {
	t.Helper()
	session := authoringCompile(t, c)
	s, err := newGenericRunState(session, r)
	if err != nil {
		t.Fatal(err)
	}
	for {
		at, ok := s.loop.Queue().PeekTime()
		if !ok || at > until {
			break
		}
		event, _ := s.loop.Queue().Pop()
		s.loop.AcceptEvent(event.TimeMs)
		s.currentEventCommands = 0
		switch event.Kind {
		case scheduler.GenericEventSourceInitialized:
			err = s.handleSourceInitialized(event)
		case scheduler.GenericEventSkillAction:
			err = s.handleSkillAction(event.SkillActionIndex)
		case scheduler.GenericEventProcessTimer:
			err = s.handleProcessTimer(event)
		case scheduler.GenericEventAnchoredTick:
			err = s.handleAnchoredTick(event)
		case scheduler.GenericEventExpireCleanup:
			s.handleExpireCleanup(event)
		case scheduler.GenericEventBasicAttack:
			err = s.handleBasicAttack()
		case scheduler.GenericEventAbilityAttempt:
			err = s.handleAbilityAttempt(event)
		default:
			t.Fatalf("unexpected setup event %+v", event)
		}
		if err != nil || s.processFailure != nil {
			t.Fatal(err, s.processFailure)
		}
	}
	return s
}

func targetTimingFactsForTest(bag effectpkg.BagView) (facts [4]effectpkg.TimingFact) {
	for index := range facts {
		facts[index] = bag.Timing(index)
	}
	return facts
}

func targetTimingExpiryPayload(t *testing.T, s *Engine, key string) effectpkg.ExpiryPayload {
	t.Helper()
	for payloadIndex := 0; payloadIndex < s.effectTimers.ExpiryCount(); payloadIndex++ {
		p := s.effectTimers.ExpiryAt(payloadIndex)
		if p.Kind == "target_timing" && p.StateKey == key {
			return p
		}
	}
	t.Fatal("real expiry payload absent")
	return effectpkg.ExpiryPayload{}
}

func TestTargetExpiryPayloadAtomicFailureAndExactNineCommands(t *testing.T) {
	for _, failure := range []string{"commands", "queue", "formula", "success"} {
		t.Run(failure, func(t *testing.T) {
			c, r := targetTimingInput(true, 0, 100, 200)
			s := targetTimingStateUntil(t, c, r, 2199)
			payload := targetTimingExpiryPayload(t, s, "pending")
			// Settle the actual 2200 phase first, as the production category does.
			for {
				at, ok := s.loop.Queue().PeekTime()
				if !ok || at != 2200 {
					break
				}
				ev, _ := s.loop.Queue().Pop()
				if ev.Kind == scheduler.GenericEventAnchoredTick {
					s.loop.Advance(2200)
					s.currentEventCommands = 0
					if err := s.handleAnchoredTick(ev); err != nil {
						t.Fatal(err)
					}
				} else if ev.Kind != scheduler.GenericEventExpireCleanup {
					t.Fatal(ev)
				}
			}
			s.loop.Advance(2200)
			s.currentEventCommands = 0
			before := s.report.Totals().SourceDamageDealt
			beforeID := s.nextDamageID
			beforeEvents := s.loop.Queue().Len()
			beforeFacts := targetTimingFactsForTest(s.combatants["source"].providerState.Lookup("timed_mount"))
			s.budget.MaxCommandsPerEvent = 9
			if failure == "commands" {
				s.budget.MaxCommandsPerEvent = 8
			}
			if failure == "queue" {
				s.loop.Queue().SetLimit(beforeEvents)
			}
			if failure == "formula" {
				for i := range s.compiled.Abilities {
					a := s.compiled.Abilities[i]
					if a.TargetExpirySpec != nil {
						damage := s.compiled.Operations[int(a.TargetExpirySpec.OnExpireStart)+4]
						program := &s.formulas.Programs[damage.AmountProgram]
						program.Instr = []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadAbilityParam, ReadKey: "missing_parameter"}}
					}
				}
			}
			s.applyTargetTimingExpiry(payload)
			bag := s.combatants["source"].providerState.Lookup("timed_mount")
			if failure == "success" {
				if s.processFailure != nil || s.currentEventCommands != 9 || s.report.Totals().SourceDamageDealt != 90 || bag.ReadTargetValue("count") != 1 || bag.Timing(3).Active {
					t.Fatal("payload did not commit exactly nine leaf commands", s.processFailure, s.currentEventCommands, s.report.Totals().SourceDamageDealt, bag)
				}
			} else {
				if s.processFailure == nil || s.report.Totals().SourceDamageDealt != before || s.nextDamageID != beforeID || s.loop.Queue().Len() != beforeEvents || !reflect.DeepEqual(targetTimingFactsForTest(bag), beforeFacts) || bag.ReadTargetValue("count") != 3 || bag.ReadTargetValue("slot1") != 1 {
					t.Fatal("failed expiry published partial state/damage/queue/ID", failure, s.processFailure, s.report.Totals().SourceDamageDealt, before, s.loop.Queue().Len(), beforeEvents, bag)
				}
			}
		})
	}
}

func TestTargetTimingGenerationsTargetSwitchAndInactiveDoNotResurrect(t *testing.T) {
	c, r := targetTimingInput(false, 0)
	s := targetTimingStateUntil(t, c, r, 0)
	owner := s.combatants["source"]
	bag := owner.providerState.Lookup("timed_mount")
	old := s.effectTimers.AnchoredAt(0)
	// A target switch goes through the ordinary staged state operation. Its
	// generation change must invalidate both old target events and holds.
	var f Frame
	s.initExecutionFrame(&f, "source", "source", "switch")
	f.ownerCombatantKey, f.ownerProviderRef = "source", "timed_mount"
	provider := s.compiled.Providers[len(s.compiled.Providers)-1]
	var setter *planbundle.CompiledOperation
	for i := range s.compiled.Operations {
		op := &s.compiled.Operations[i]
		if op.OwnerProviderIndex == len(s.compiled.Providers)-1 && op.Operation == "state_change" && op.Ref == "slot1" {
			v, _ := s.formulas.FoldStatic(op.AmountProgram)
			if v == 1 {
				setter = op
				break
			}
		}
	}
	if setter == nil {
		t.Fatal("real setter absent")
	}
	if err := f.applyStateChange(*setter, s.compiled.Abilities[provider.AbilityStart]); err != nil {
		t.Fatal(err)
	}
	f.commit()
	if f.fatal {
		t.Fatal(f.fatalErr)
	}
	before := s.report.Totals().SourceDamageDealt
	s.loop.Advance(250)
	if err := s.handlePhasedTick(scheduler.GenericEvent{TimeMs: 250}, old); err != nil || s.report.Totals().SourceDamageDealt != before {
		t.Fatal("old target tick survived target switch", err)
	}
	if bag.TargetKey() != "target" {
		t.Fatal("parent bag was written through staging", bag.TargetKey())
	}
	// Inactive extension returns before reading a deliberately broken amount.
	var extension planbundle.CompiledOperation
	for _, op := range s.compiled.Operations {
		if op.ValuePolicy == "ensure_remaining_preserve_phase" {
			extension = op
			break
		}
	}
	s.loop.Advance(5000)
	var noOp Frame
	s.initExecutionFrame(&noOp, "source", "target", "inactive")
	noOp.ownerCombatantKey, noOp.ownerProviderRef, noOp.mountedListener = "source", "timed_mount", true
	noOp.eventCtx = &eventFormulaSnapshot{eventType: model.EventTypeSkillHit, eventSourceKey: "source", eventTargetKey: "target", skillHit: &frozenSkillHitContext{}}
	extension.AmountProgram = formula.GenericProgramID(65535)
	if err := noOp.ensurePhasedTargetRemaining(extension, s.compiled.Abilities[provider.AbilityStart]); err != nil {
		t.Fatal("inactive extension evaluated amount", err)
	}
}
