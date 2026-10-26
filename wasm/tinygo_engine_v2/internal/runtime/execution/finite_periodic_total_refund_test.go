package execution

import (
	json "encoding/json"
	strconv "strconv"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	scheduler "tinygo_engine_v2/internal/scheduler"
)

// Independent hand mathematics is frozen in the parent w-mechanism-analysis.
// This synthetic source retains the real continuous attack and active process.
func finitePeriodicCastInput(t *testing.T, cooldown float64, refund bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := continuousAttackInput(.1, 1000, 10, 0, 0, 5000)
	setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Max: 1000, Current: 500, Resolved: 1000})
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "ability_power", Domain: "attribute"}, model.TypeCatalogEntry{Key: settledEventDeliverySkill, Domain: "damage_trait"}, model.TypeCatalogEntry{Key: receivedOriginDirect, Domain: "damage_trait"})
	setCombatantAttr(&c, &r, "source", "ability_power", authoringSlot(100))
	addMixedSpell(&c, &r, "area_cast", 0, 250, true)
	p := &c.SharedProviders[1]
	p.SkillKey = "area_cast"
	p.Abilities = p.Abilities[:1]
	p.Processes[0].Cooldown.DurationMs = authoringConst(cooldown)
	p.Processes[0].Cooldown.RoundPositiveMs = true
	p.Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "finite_area"}}}}
	c.Rules.SkillActionBindings[0].HitBindings = []model.SkillActionHitBinding{}
	r.DriverPlan.SkillActions[0].HitBindings = []model.SkillActionHitPreset{}
	var tick model.TickSpec
	if err := json.Unmarshal([]byte(`{"intervalMs":500,"startDelayMs":0,"onTick":[]}`), &tick); err != nil {
		t.Fatal(err)
	}
	minimum := authoringBinary("div", authoringBinary("add", authoringConst(18), authoringBinary("mul", authoringConst(.2), authoringRead("source.attr.ability_power.resolved"))), authoringConst(2))
	missingMultiplier := authoringBinary("sub", authoringConst(2), authoringBinary("div", authoringRead("target.attr.hp.current"), authoringRead("target.attr.hp.max")))
	tick.OnTick = []model.OperationDefinition{{Operation: "damage", Target: "target", Ref: "area_damage", DamageType: "damage/physics", Amount: authoringAmount(authoringBinary("mul", minimum, missingMultiplier)), Types: []string{settledEventDeliverySkill, receivedOriginDirect}}}
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "finite_area", Kind: "status", StableID: p.StableID, SkillKey: p.SkillKey, Lifecycle: sourceTargetLifecycle(5000), Abilities: []model.AbilityDefinition{{AbilityKey: "tick", Kind: "tick", SkillKey: p.SkillKey, Types: []string{"ability/spell"}, TickSpec: &tick}}})
	addKilledRecovery(&c, &r, 0, eventTypeDamageInstance)
	healing := &c.SharedProviders[3].Abilities[0]
	healing.ListenerSpec.Condition = authoringAmount(authoringBinary("gt", authoringRead("event.damage.mitigatedAmount"), authoringConst(0)))
	healing.ListenerSpec.EventMatcher.All = append(healing.ListenerSpec.EventMatcher.All, settledEventDeliverySkill)
	healing.ListenerSpec.Operations = []model.OperationDefinition{{Operation: "heal", Target: "self", Ref: "area_p_heal", Amount: authoringAmount(authoringBinary("mul", authoringRead("event.damage.mitigatedAmount"), authoringConst(.18)))}}
	if refund {
		c.SharedProviders[3].Abilities = append(c.SharedProviders[3].Abilities, model.AbilityDefinition{AbilityKey: "refund", Kind: "passive_listener", SkillKey: c.SharedProviders[3].SkillKey, ListenerSpec: &model.ListenerDefinition{ListenerKey: "refund", EventMatcher: healing.ListenerSpec.EventMatcher, Condition: healing.ListenerSpec.Condition, MaxTriggersPerEvent: 1, Operations: []model.OperationDefinition{{Operation: "cooldown_change", Target: "self", Ref: "area_refund", ValuePolicy: "reduce_total_ratio", AbilityRef: c.Rules.SkillActionBindings[0].Controls[0].AbilityRef, Amount: timedShieldExpr(.05)}}}})
	}
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	return c, r
}

func TestFinitePeriodicFirstQueueBudgetRollsBackOrdinaryCooldownAndMount(t *testing.T) {
	c, r := finitePeriodicCastInput(t, 12000, true)
	s := frameCommitState(t, c, r)
	*s.loop.Queue() = scheduler.NewGenericHeap(1)
	s.loop.Queue().SetLimit(1)
	if s.loop.Queue().Push(scheduler.GenericEvent{TimeMs: 10000}) != model.ErrOK {
		t.Fatal("heap setup")
	}
	err := s.handleSkillAction(0)
	id := actionpkg.AbilityCooldownIdentity("source", c.Rules.SkillActionBindings[0].Controls[0].AbilityRef)
	if err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents || s.combatants["source"].cooldowns.ReadyAt(id) != 0 || s.combatants["source"].cooldowns.EntryValue(id).HasOrdinaryTotal || s.report.Totals().SourceDamageDealt != 0 || s.loop.Queue().Len() != 1 {
		t.Fatal("failed first tick frame leaked CD/metadata/queue", err, s.combatants["source"].cooldowns, s.report.Totals().SourceDamageDealt)
	}
	for instanceIndex, instanceValues := 0, s.combatants["source"].instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		inst := instanceValues.At(instanceIndex)
		if inst.DefinitionRef == "finite_area" {
			t.Fatal("failed first frame published area", inst)
		}
	}
}

func TestFinitePeriodicRefreshRetainsCreationPhaseButRecordsLatestAcceptedApplyingUse(t *testing.T) {
	for _, projected := range []bool{false, true} {
		t.Run(strconv.FormatBool(projected), func(t *testing.T) {
			c, r := finitePeriodicCastInput(t, 6000, true)
			b := c.Rules.SkillActionBindings[0]
			r.DriverPlan.SkillActions = []model.SkillActionPlan{}
			r.DriverPlan.AutomaticSkills = &model.AutomaticSkillPlan{Rules: []model.AutomaticSkillRule{{RuleKey: "area", BindingKey: b.BindingKey, Target: "target", HitBindings: []model.SkillActionHitPreset{}, WaitForCooldowns: []string{}}}}
			if projected {
				refs := []string{}
				window := hitFlatProvider("projected_window", "armor", 0)
				window.Modifiers = []model.ModifierDefinition{{ModifierKey: "no_match", Kind: "cooldown_duration", Target: "self", ValuePolicy: "multiply", Value: authoringConst(.5), AffectedAbilityRefs: &refs}}
				c.SharedProviders = append(c.SharedProviders, window)
			}
			s := frameCommitState(t, c, r)
			if err := s.runLoop(); err != nil {
				t.Fatal(err)
			}
			count := 0
			for instanceIndex, instanceValues := 0, s.combatants["source"].instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
				inst := instanceValues.At(instanceIndex)
				if inst.DefinitionRef == "finite_area" {
					count++
					use, found := s.skillUses[inst.ActivationUseRef]
					if !found || s.processForUse(use) == nil || s.processForUse(use).StartedAtMs() != 3600 || inst.ExpireAt != 8600 {
						t.Fatal("refresh did not retain actual latest applying use", inst, use)
					}
				}
			}
			if count != 1 {
				t.Fatal("area count", count)
			}
			var ref string
			casts := map[uint64]bool{}
			for _, row := range s.report.Snapshot().DamageRecords {
				if row["operationRef"] == "area_damage" {
					if ref == "" {
						ref = row["providerRef"].(string)
					}
					cast := row["castInstanceId"].(uint64)
					if row["providerRef"] != ref || row["providerActivatedAtMs"] != int64(0) || row["useRef"] != "" || casts[cast] {
						t.Fatal("refresh changed creation phase or fabricated a parent use for the tick", row)
					}
					casts[cast] = true
				}
			}
			if len(casts) != 11 {
				t.Fatal("not independent real tick casts", casts)
			}
		})
	}
}
