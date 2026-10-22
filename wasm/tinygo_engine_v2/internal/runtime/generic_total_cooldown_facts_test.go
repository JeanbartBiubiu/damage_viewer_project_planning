package runtime

import (
	"math"
	"reflect"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func totalRatioPacketInput(t *testing.T, total float64, amounts ...float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := finitePeriodicCastInput(t, total, true)
	op := c.SharedProviders[2].Abilities[0].TickSpec.OnTick[0]
	c.SharedProviders = append(c.SharedProviders[:2], c.SharedProviders[3:]...)
	var ops []model.OperationDefinition
	for _, amount := range amounts {
		next := op
		next.Amount = timedShieldExpr(amount)
		ops = append(ops, next)
	}
	c.SharedProviders[1].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: ops}}
	r.StopPolicy.DurationMs = 500
	return c, r
}

func TestTotalCooldownRatioEachPacketAndFullHealthShieldZeroAndLethal(t *testing.T) {
	for _, mode := range []string{"two_packets_same_use", "full_health", "full_shield", "zero", "lethal", "post_defense_modifier", "no_active_cooldown", "round_to_zero"} {
		t.Run(mode, func(t *testing.T) {
			c, r := totalRatioPacketInput(t, 12000, 19)
			wantHP, wantTarget, wantReady, wantHeals := 503.42, 971.0, int64(11400), 1
			switch mode {
			case "two_packets_same_use":
				c, r = totalRatioPacketInput(t, 12000, 10, 20)
				wantHP, wantTarget, wantReady, wantHeals = 505.4, 960, 10800, 2
			case "full_health":
				setCombatantAttr(&c, &r, "source", "hp", authoringSlot(1000))
				wantHP = 1000
			case "full_shield":
				ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: model.EventTypeSourceInitialized, Domain: "event"})
				addPureInitializedShield(&c, &r, "target", "direct", 19)
				wantTarget = 990
			case "zero":
				c.SharedProviders[1].Processes[0].MomentOperations[0].Operations[0].Amount = timedShieldExpr(0)
				wantHP, wantTarget, wantReady, wantHeals = 500, 990, 12000, 0
			case "lethal":
				setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Current: 10, Max: 1000, Resolved: 1000})
				c.SharedProviders[1].Processes[0].MomentOperations[0].Operations[0].Amount = timedShieldExpr(37.81)
				wantHP, wantTarget = 506.8058, 0
			case "post_defense_modifier":
				ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "damage/magic", Domain: "damage"}, model.TypeCatalogEntry{Key: "magic_resist", Domain: "attribute"})
				setCombatantAttr(&c, &r, "target", "magic_resist", authoringSlot(100))
				formuladefinition.SetDamageFormula(&c, "damage/magic", formuladefinition.ResistanceDefense("magic_resist"))
				damage := c.SharedProviders[1].Processes[0].MomentOperations[0].Operations[0]
				damage.DamageType = "damage/magic"
				c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "half_magic", Kind: "status", StableID: "half_magic", Lifecycle: sourceTargetLifecycle(1000), Modifiers: []model.ModifierDefinition{{ModifierKey: "half_magic", Kind: "pipeline", Command: "damage", Channel: "all_damage", Stage: "incoming_post_mitigation", Bucket: "all_instances", ValuePolicy: "multiply", Value: authoringConst(.5), Condition: authoringAmount(authoringRead("damage.type.damage/magic"))}}})
				c.SharedProviders[1].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "half_magic"}}}, {Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}, Operations: []model.OperationDefinition{damage}}}
				wantHP, wantTarget = 500.855, 985.25
			case "no_active_cooldown":
				c.SharedProviders[1].Processes[0].Cooldown.DurationMs = authoringConst(100)
				c.SharedProviders[1].Processes[0].MomentOperations[0].Moment.MomentType = "PROCESS_COMPLETE"
				wantReady = 100
			case "round_to_zero":
				c.SharedProviders[1].Processes[0].Cooldown.DurationMs = authoringConst(1)
				r.StopPolicy.DurationMs = 1
				wantTarget, wantReady = 981, 1
			}
			done := authoringRun(t, c, r)
			if math.Abs(done.Summary.SourceFinalHp-wantHP) > 1e-9 || math.Abs(done.Summary.TargetFinalHp-wantTarget) > 1e-9 || finiteAreaReady(t, done) != wantReady || len(recoveryEvidence(done, model.EvidenceKindHeal)) != wantHeals {
				t.Fatal(mode, done.Summary, done.FinalSnapshot.Combatants)
			}
			if mode == "two_packets_same_use" {
				var uses []interface{}
				for _, row := range done.DamageRecords {
					if row["operationRef"] == "area_damage" {
						uses = append(uses, row["useRef"])
					}
				}
				if len(uses) != 2 || uses[0] != uses[1] {
					t.Fatal("not two actual packets of one use", uses)
				}
			}
			if mode == "full_health" {
				heal := recoveryEvidence(done, model.EvidenceKindHeal)[0]
				vampAmount(t, heal.Data, "healingBeforeModifiers", 3.42)
				vampAmount(t, heal.Data, "actualHealing", 0)
				vampAmount(t, heal.Data, "overheal", 3.42)
			}
			if mode == "lethal" && (done.Summary.DurationMs != 0 || len(done.AttackRecords) != 0) {
				t.Fatal("lethal commit failed to stop future work", done.Summary)
			}
		})
	}
}

func TestTotalCooldownRatioCommitsFinalDurationAndNeverRecomputesAfterAttributeOrModifierChange(t *testing.T) {
	for _, mode := range []string{"haste17", "duration_factor"} {
		t.Run(mode, func(t *testing.T) {
			c, r := totalRatioPacketInput(t, 12000, 100)
			c.SharedProviders[1].Processes[0].MomentOperations[0].Moment.MomentType = "PROCESS_COMPLETE"
			wantTotal, wantRefund := int64(10256), int64(513)
			if mode == "haste17" {
				ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "ability_haste", Domain: "attribute"})
				setCombatantAttr(&c, &r, "source", "ability_haste", authoringSlot(17))
				c.SharedProviders[1].Processes[0].Cooldown.DurationMs = authoringBinary("div", authoringConst(1200000), authoringBinary("add", authoringConst(100), authoringRead("source.attr.ability_haste.resolved")))
				c.SharedProviders = append(c.SharedProviders, hitFlatProvider("haste_change_window", "ability_haste", -17))
				c.SharedProviders[1].Processes[0].MomentOperations = append([]model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "haste_change_window"}}}}, c.SharedProviders[1].Processes[0].MomentOperations...)
			} else {
				c.SharedProviders[1].Processes[0].Cooldown.DurationMs = authoringConst(6000)
				refs := []string{c.Rules.SkillActionBindings[0].Controls[0].AbilityRef}
				p := hitFlatProvider("duration_window", "armor", 0)
				p.Modifiers = []model.ModifierDefinition{{ModifierKey: "duration", Kind: "cooldown_duration", Target: "self", ValuePolicy: "multiply", Value: authoringConst(.5), AffectedAbilityRefs: &refs}}
				c.SharedProviders = append(c.SharedProviders, p)
				wantTotal, wantRefund = 3000, 150
			}
			s := frameCommitState(t, c, r)
			s.heap = scheduler.NewGenericHeap(32)
			if mode == "duration_factor" {
				applyDurationWindow(t, s)
			}
			if err := s.handleSkillAction(0); err != nil {
				t.Fatal(err)
			}
			id := genericAbilityCooldownIdentity("source", c.Rules.SkillActionBindings[0].Controls[0].AbilityRef)
			entry := s.combatants["source"].cooldowns.entryValue(id)
			if !entry.hasOrdinaryTotal || entry.ordinaryTotalMs != wantTotal {
				t.Fatal("not a real final commit fact", entry, wantTotal)
			}
			var frame executionFrame
			s.initExecutionFrame(&frame, "source", "target", "later_change")
			if mode == "haste17" {
				slot, exists := s.combatants["source"].attributes.Lookup("ability_haste")
				if !exists || slot.Resolved != 0 {
					t.Fatal("actual post-commit attribute operation did not change haste", slot)
				}
			} else {
				for _, inst := range s.combatants["source"].providers {
					if inst.DefinitionRef == "duration_window" {
						if err := frame.executeOperations(planbundle.CompiledAbility{}, []planbundle.CompiledOperation{{Operation: "expire_provider", Target: "self", ProviderRef: inst.ProviderRef}}); err != nil {
							t.Fatal(err)
						}
					}
				}
				frame.commit()
				if frame.fatal {
					t.Fatal(frame.fatalErr)
				}
			}
			if err := s.runLoop(); err != nil {
				t.Fatal(err)
			}
			entry = s.combatants["source"].cooldowns.entryValue(id)
			if entry.readyAt != wantTotal-wantRefund || entry.ordinaryTotalMs != wantTotal || !entry.hasOrdinaryTotal {
				t.Fatal("refund recomputed total or dropped provenance", entry, wantTotal, wantRefund)
			}
		})
	}
}

func TestTotalCooldownRatioMissingContextKeepsCommittedDamageAndIndependentHeal(t *testing.T) {
	c, r := finitePeriodicCastInput(t, 12000, true)
	s := frameCommitState(t, c, r)
	s.heap = scheduler.NewGenericHeap(32)
	if err := s.handleSkillAction(0); err != nil {
		t.Fatal(err)
	}
	id := genericAbilityCooldownIdentity("source", c.Rules.SkillActionBindings[0].Controls[0].AbilityRef)
	ledger := s.combatants["source"].cooldowns
	entryIndex := ledger.entryIndex(id)
	ledger.entries[entryIndex].value.hasOrdinaryTotal = false // Deliberately missing provenance, never inferred from deadline.
	err := s.runLoop()
	if err == nil || s.combatantHp("target") != 981 || math.Abs(s.combatantHp("source")-503.42) > 1e-9 || s.sourceDamageDealt != 19 || ledger.readyAt(id) != 12000 {
		t.Fatal("refund failure crossed an already committed child frame", err, s.combatantHp("source"), s.combatantHp("target"), ledger.entryValue(id))
	}
}

func TestTotalCooldownLedgerPreservesOnlyTheRealActiveOrdinaryCommit(t *testing.T) {
	id := genericAbilityCooldownIdentity("source", "source.provider[x].ability[initial]")
	ledger := newGenericCooldownLedger()
	ledger.commitOrdinary(id, 12000, 0)
	for _, ready := range []int64{11400, 13000, 5000} {
		ledger.set(id, ready, 100)
		entry := ledger.entryValue(id)
		if !entry.hasOrdinaryTotal || entry.ordinaryTotalMs != 12000 {
			t.Fatal("deadline edit lost committed base", entry)
		}
	}
	clone := ledger.clone()
	clone.reset(id, 200)
	if clone.entryValue(id).hasOrdinaryTotal || !ledger.entryValue(id).hasOrdinaryTotal {
		t.Fatal("reset or staged isolation", clone.entryValue(id), ledger.entryValue(id))
	}
	ledger.commitOrdinary(id, 3200, 200)
	if ledger.entryValue(id).ordinaryTotalMs != 3000 {
		t.Fatal("new real commit did not replace old total", ledger.entryValue(id))
	}
	ledger.set(id, 10000, 4000)
	if ledger.entryValue(id).hasOrdinaryTotal {
		t.Fatal("expiry was resurrected as a real base", ledger.entryValue(id))
	}
}

func TestTotalCooldownRatioAdmissionRejectsIncompleteTargetsAndOrigins(t *testing.T) {
	for _, name := range []string{"target_owner", "wrong_event", "dynamic", "unselected_dynamic", "negative", "over_one", "missing_amount", "mixed_operation", "once", "per_cast", "op_condition", "target_context", "target_hit", "target_basic", "wrong_owner", "missing_ref", "missing_ordinary", "unplanned", "external_restore", "runtime_time", "provider_listener"} {
		t.Run(name, func(t *testing.T) {
			c, r := totalRatioPacketInput(t, 12000, 19)
			listener := c.SharedProviders[2].Abilities[1].ListenerSpec
			op := &listener.Operations[0]
			switch name {
			case "target_owner":
				listener.EventMatcher.All[1] = "event/target_owner"
			case "wrong_event":
				listener.EventMatcher.All[0] = model.EventTypeDamageTaken
			case "dynamic":
				op.Amount = authoringAmount(authoringRead("source.attr.hp.current"))
			case "unselected_dynamic":
				op.Amount = authoringAmount(model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringConst(1), authoringConst(.05), authoringRead("source.attr.hp.current")}})
			case "negative":
				op.Amount = timedShieldExpr(-.01)
			case "over_one":
				op.Amount = timedShieldExpr(1.01)
			case "missing_amount":
				op.Amount = nil
			case "mixed_operation":
				listener.Operations = append(listener.Operations, model.OperationDefinition{Operation: "heal", Target: "self", Amount: timedShieldExpr(1)})
			case "once":
				listener.OncePerUse = &model.OncePerUseLimit{Scope: "provider", GroupKey: "must_reject"}
			case "per_cast":
				listener.PerCastThrottleMs = 1
			case "op_condition":
				op.Condition = timedShieldExpr(1)
			case "target_context":
				op.Target = "target"
			case "target_hit":
				op.AbilityRef = "source.provider[area_cast].ability[hit]"
			case "target_basic":
				op.AbilityRef = r.DriverPlan.BasicAttack.InitialControlAbilityRef
			case "wrong_owner":
				op.AbilityRef = "target.provider[area_cast].ability[initial]"
			case "missing_ref":
				op.AbilityRef = ""
			case "missing_ordinary":
				c.SharedProviders[1].Processes[0].Cooldown = nil
			case "unplanned":
				r.DriverPlan.SkillActions = []model.SkillActionPlan{}
			case "external_restore":
				r.InitialSnapshot.Combatants[0].Cooldowns = map[string]interface{}{op.AbilityRef: map[string]interface{}{"readyAtMs": 12000}}
			case "runtime_time":
				r.InitialSnapshot.TimeMs = 1
			case "provider_listener":
				c.SharedProviders[2].Listeners = []model.ListenerDefinition{*listener}
				c.SharedProviders[2].Abilities = c.SharedProviders[2].Abilities[:1]
			}
			compiled := compilebundle.CompileGeneric(c)
			if !compiled.OK {
				return
			}
			if _, err := RunGeneric(compiled.Session, r); err == nil {
				t.Fatal("unsupported total cooldown capability admitted", name)
			}
		})
	}
}

func TestTotalCooldownRatioClampsARealPartlyReducedOrdinaryCooldown(t *testing.T) {
	c, r := totalRatioPacketInput(t, 12000, 19)
	packet := c.SharedProviders[1].Processes[0].MomentOperations[0].Operations[0]
	c.SharedProviders[1].Processes[0].Steps[0].DelayMs = timedShieldExpr(900)
	c.SharedProviders[1].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "cooldown_change", Target: "self", ValuePolicy: "reduce", AbilityRef: c.Rules.SkillActionBindings[0].Controls[0].AbilityRef, Amount: timedShieldExpr(11000)}}}, {Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}, Operations: []model.OperationDefinition{packet}}}
	r.StopPolicy.DurationMs = 950
	done := authoringRun(t, c, r)
	if finiteAreaReady(t, done) != 900 || math.Abs(done.Summary.SourceFinalHp-503.42) > 1e-9 || done.Summary.TargetFinalHp != 971 || done.AttackRecords[0].StartAtMs != 900 {
		t.Fatal("requested 600 must consume only remaining 100 and wake real attack", done.Summary, done.AttackRecords)
	}
}

func TestTotalCooldownRatioZeroCoefficientKeepsTheBaseAndReplay(t *testing.T) {
	c, r := totalRatioPacketInput(t, 12000, 19)
	c.SharedProviders[2].Abilities[1].ListenerSpec.Operations[0].Amount = timedShieldExpr(0)
	compiled := authoringCompile(t, c)
	done, err := RunGeneric(compiled, r)
	if err != nil || finiteAreaReady(t, done) != 12000 {
		t.Fatal(done.Summary, err)
	}
	again, err := RunGeneric(compiled, r)
	if err != nil || !reflect.DeepEqual(done, again) {
		t.Fatal("replay changed zero-ratio semantics", err)
	}
}
