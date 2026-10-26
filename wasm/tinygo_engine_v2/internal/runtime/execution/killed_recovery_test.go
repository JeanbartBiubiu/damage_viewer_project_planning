package execution

import (
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func killedCondition() *model.GenericFormulaExpr {
	return authoringAmount(authoringBinary("eq", authoringRead("event.damage.killed"), authoringConst(1)))
}

func addKilledRecovery(c *model.CompileRequest, r *model.RunRequest, actor int, event string) {
	ensureC1CatalogTypes(c,
		model.TypeCatalogEntry{Key: eventTypeDamageInstance, Domain: "event"},
		model.TypeCatalogEntry{Key: model.EventTypeDamageTaken, Domain: "event"},
		model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"},
		model.TypeCatalogEntry{Key: "event/target_owner", Domain: "event"})
	owner := c.Combatants[actor].Key
	filter := "event/source_owner"
	if actor == 1 {
		filter = "event/target_owner"
	}
	p := model.ProviderDefinition{ProviderKey: "recovery_definition", StableID: "recovery_definition", SkillKey: "recovery_skill", Kind: "character",
		Abilities: []model.AbilityDefinition{{AbilityKey: "ordinary_recovery", Kind: "passive_listener", SkillKey: "recovery_skill",
			ListenerSpec: &model.ListenerDefinition{ListenerKey: "ordinary_recovery", EventMatcher: model.TypeMatcher{All: []string{event, filter}}, Condition: killedCondition(),
				Operations: []model.OperationDefinition{
					{Operation: "heal", Target: "self", Amount: timedShieldExpr(40), Ref: "restore_hp"},
					{Operation: "resource_change", Target: "self", ResourceKey: "mana", Amount: timedShieldExpr(12), Ref: "restore_mana"},
				}}}}}
	c.SharedProviders = append(c.SharedProviders, p)
	c.Combatants[actor].Providers = append(c.Combatants[actor].Providers, model.CombatantProviderMount{ProviderRef: "original_recovery_mount", DefinitionRef: p.ProviderKey})
	r.InitialSnapshot.Combatants[actor].Providers = append(r.InitialSnapshot.Combatants[actor].Providers, model.CombatantProviderSnapshot{ProviderRef: "original_recovery_mount", DefinitionRef: p.ProviderKey, Owner: owner, Source: owner, Stacks: 1})
	c.Combatants[actor].Resources = map[string]model.ResourceSlotDef{"mana": {Current: 1, Max: 50}}
	r.InitialSnapshot.Combatants[actor].Resources = c.Combatants[actor].Resources
}

func killedRecoveryInput(event string) (model.CompileRequest, model.RunRequest) {
	c, r := singleSkillInput(false)
	addKilledRecovery(&c, &r, 0, event)
	setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Current: 100, Max: 1000, Resolved: 100})
	r.Sampling.Disabled = true
	return c, r
}

func recoveryEvidence(done model.DoneResult, kind model.EvidenceKind) []model.EvidenceItem {
	var out []model.EvidenceItem
	for _, item := range done.Evidence.Items {
		if item.Kind == kind {
			out = append(out, item)
		}
	}
	return out
}

func TestKilledMissingSettlementAndRuntimeForgingFailBeforeRecovery(t *testing.T) {
	for _, event := range []string{eventTypeDamageInstance, model.EventTypeDamageTaken} {
		t.Run(event, func(t *testing.T) {
			c, r := killedRecoveryInput(event)
			s := frameCommitState(t, c, r)
			f := s.newExecutionFrame("source", "target", "external")
			ev := emittedEvent{eventType: event, sourceKey: "source", targetKey: "target", types: []string{event}, snapshot: f.captureEmitSnapshot(event, "source", "target")}
			// Non-settlement callers cannot turn a missing fact into the valid value zero.
			ev.snapshot.hasDamageSnapshot = true
			if err := s.dispatchListeners(ev, 1); err == nil || !strings.Contains(err.Message, "actual per-instance damage settlement") {
				t.Fatal("missing native settlement was accepted", err)
			}
			if s.combatantHp("source") != 500 || s.combatants["source"].resourceView().At("mana").Current != 1 || len(s.report.Snapshot().HealingRecords) != 0 || s.report.Snapshot().Evidence.CountsByKind["resource_restore"] != 0 {
				t.Fatal("failed fact check published recovery")
			}
			forged := planbundle.CompiledOperation{Operation: "emit_event", Target: "self", EventType: event}
			if err := f.executeOperation(s.compiled.Abilities[0], &forged); err == nil || !strings.Contains(err.Message, "cannot forge") {
				t.Fatal("runtime author emission forged a native settlement", err)
			}
		})
	}
}

func TestKilledRecoveryLeavesActiveHealPrimitiveSemantics(t *testing.T) {
	c, r := frameCommitInput(model.OperationDefinition{Operation: "heal", Target: "target", Amount: timedShieldExpr(40), Ref: "active_heal"})
	setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Current: 0, Max: 1000, Resolved: 0})
	s := frameCommitState(t, c, r)
	f, ability, ops := frameCommitFrame(s)
	if err := f.executeOperations(ability, ops); err != nil {
		t.Fatal(err)
	}
	f.commit()
	if !f.committed || s.combatantHp("target") != 40 || len(s.report.Snapshot().HealingRecords) != 1 {
		t.Fatal("ordinary-listener gate changed the existing active healing primitive", f.fatalErr, s.combatantHp("target"))
	}
}

func TestKilledRecoveryChildFailureKeepsParentDamageAndDropsBothRecoveries(t *testing.T) {
	for _, failAfterMana := range []bool{false, true} {
		t.Run(map[bool]string{false: "mana_formula_failure", true: "failure_after_heal_and_mana"}[failAfterMana], func(t *testing.T) {
			c, r := killedRecoveryInput(eventTypeDamageInstance)
			ops := &c.SharedProviders[1].Abilities[0].ListenerSpec.Operations
			badAmount := authoringAmount(authoringBinary("div", authoringConst(1), authoringRead("target.attr.hp.current")))
			if failAfterMana {
				*ops = append(*ops, model.OperationDefinition{Operation: "resource_change", Target: "self", ResourceKey: "mana", Ref: "bad_restore", Amount: badAmount})
			} else {
				(*ops)[1].Amount = badAmount
			}
			s := frameCommitState(t, c, r)
			if err := s.runLoop(); err == nil {
				t.Fatal("expected listener formula failure")
			}
			done := s.buildDoneResult(false)
			if s.combatantHp("target") != 0 || s.combatantHp("source") != 500 || s.combatants["source"].resourceView().At("mana").Current != 1 || s.report.Totals().SourceDamageDealt != 100 || len(damageEvidenceItems(done)) != 1 || len(recoveryEvidence(done, model.EvidenceKindHeal)) != 0 || len(recoveryEvidence(done, "resource_restore")) != 0 || len(s.report.Snapshot().HealingRecords) != 0 {
				t.Fatal("failed child published recovery or rolled back committed parent damage", done.Summary, done.Evidence)
			}
		})
	}
}
