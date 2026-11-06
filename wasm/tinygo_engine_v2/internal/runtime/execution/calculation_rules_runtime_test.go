package execution

import (
	json "encoding/json"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func calculationRuleInput() (model.CompileRequest, model.RunRequest) {
	c := model.CompileRequest{SchemaVersion: "generic-p0", SchemaHash: "calculation-rules", RulesHash: "calculation-rules",
		TypeCatalog:     model.TypeCatalog{Types: []model.TypeCatalogEntry{{Key: "heat", Domain: "damage"}, {Key: "combatant/champion", Domain: "combatant"}}},
		SharedProviders: []model.ProviderDefinition{{ProviderKey: "probe", StableID: "probe", SkillKey: "probe", Kind: "generic", Abilities: []model.AbilityDefinition{{AbilityKey: "hit", Kind: "active", Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "heat", Amount: authoringAmount(authoringConst(100)), CritEligible: true, CritChance: authoringAmount(authoringRead("source.attr.hit_probability.resolved")), CritMultiplier: authoringAmount(authoringConst(2)), Ref: "explicit_hit"}}}}}},
		Rules:           model.RulesContainer{DamageTypeFormulas: []model.DamageTypeFormulaDefinition{{DamageType: "heat", Formula: formuladefinition.Definition(nil, []any{formuladefinition.Stage("factor", formuladefinition.Const(1))}, "factor")}}}}
	for _, key := range []string{"hp", "pulse", "force", "hit_probability"} {
		c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: "attribute"})
	}
	for i, side := range []string{"source", "target"} {
		actor := model.CombatantDefinition{Key: side, Types: []string{"combatant/champion"}, Attributes: map[string]model.AttributeSlotDef{"hp": authoringSlot(1000), "pulse": authoringSlot(float64(i + 1)), "force": authoringSlot(10), "hit_probability": authoringSlot(.25)}, Resources: map[string]model.ResourceSlotDef{}}
		if i == 0 {
			actor.Providers = []model.CombatantProviderMount{{ProviderRef: "probe", DefinitionRef: "probe"}}
		}
		c.Combatants = append(c.Combatants, actor)
	}
	r := model.RunRequest{SessionID: "calculation", ExpectedRulesHash: c.RulesHash, InitialSnapshot: model.Snapshot{TimeMs: 0}, DriverPlan: model.DriverPlan{Entries: []model.DriverEntry{{EntryKey: "hit", AbilityRef: "source.provider[probe].ability[hit]", Source: "source", Target: "target", FirstAtMs: 0}}}, StopPolicy: model.StopPolicy{DurationMs: 1, StopWhenNoEvents: model.BoolPtr(true), StopOnTargetDeath: model.BoolPtr(true)}}
	for _, actor := range c.Combatants {
		r.InitialSnapshot.Combatants = append(r.InitialSnapshot.Combatants, model.CombatantSnapshot{Key: actor.Key, Attributes: cloneAttributeMap(actor.Attributes), Resources: map[string]model.ResourceSlotDef{}})
	}
	r.InitialSnapshot.Combatants[0].Providers = []model.CombatantProviderSnapshot{{ProviderRef: "probe", DefinitionRef: "probe", Source: "source", Owner: "source", Stacks: 1}}
	return c, r
}

func calculationNumber(value float64) *float64 { return &value }

func TestCalculationAttributeBaseOverflowRejectsBeforeClampAndFrameCommit(t *testing.T) {
	for _, maximum := range []float64{0, 1e308} {
		c, r := calculationRuleInput()
		slot := model.AttributeSlotDef{Base: 1e308, Current: 1e308, Max: maximum, Resolved: 1e308}
		c.Combatants[0].Attributes["force"] = slot
		r.InitialSnapshot.Combatants[0].Attributes["force"] = slot
		c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
			{Operation: "shield", Target: "target", ShieldRef: "uncommitted_guard", Amount: authoringAmount(authoringConst(50))},
			{Operation: "attribute_change", Target: "source", AttributeKey: "force", ValuePolicy: "add", Amount: authoringAmount(authoringConst(1e308))},
		}
		state, issue := newGenericRunState(authoringCompile(t, c), r)
		if issue != nil {
			t.Fatal(issue)
		}
		issue = state.runLoop()
		if issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed || issue.Path != "combatants.source.attributes.force.base" {
			t.Fatal("nonfinite attribute accepted or silently clamped", maximum, issue)
		}
		if state.combatants["source"].attributesView().At("force").Base != 1e308 || state.combatants["target"].instances.Shields().Len() != 0 {
			t.Fatal("attribute overflow committed partial frame")
		}
		if _, issue := json.Marshal(state.report.Snapshot().Evidence.Items); issue != nil {
			t.Fatal(issue)
		}
	}
}

func TestCalculationCriticalAmountOverflowRejectsBeforeCommitAndSessionRecovers(t *testing.T) {
	for _, evidenceLimit := range []int{0, 1000} {
		c, r := calculationRuleInput()
		op := c.SharedProviders[0].Abilities[0].Operations[0]
		op.CritMultiplierMin = calculationNumber(1e308)
		c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
			{Operation: "shield", Target: "target", ShieldRef: "uncommitted_guard", Amount: authoringAmount(authoringConst(50))}, op,
		}
		c.Combatants[0].Attributes["hit_probability"] = authoringSlot(1)
		r.InitialSnapshot.Combatants[0].Attributes["hit_probability"] = authoringSlot(1)
		compiled := authoringCompile(t, c)
		state, issue := newGenericRunState(compiled, r)
		if issue != nil {
			t.Fatal(issue)
		}
		state.budget.MaxEvidenceItems = evidenceLimit
		issue = state.runLoop()
		if issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed || issue.Path != "sharedProviders[0].abilities[0].operations[1].critMultiplier" {
			t.Fatal("critical amount overflow accepted", issue)
		}
		if state.combatants["target"].attributesView().At("hp").Current != 1000 || state.combatants["target"].instances.Shields().Len() != 0 || state.report.Totals().SourceDamageDealt != 0 || len(reportedDamageHistory(state)) != 0 {
			t.Fatal("critical overflow committed frame", evidenceLimit)
		}
		if _, err := json.Marshal(state.report.Snapshot().Evidence.Items); err != nil {
			t.Fatal("nonfinite evidence escaped", err)
		}
		for repeat := 0; repeat < 2; repeat++ {
			if _, issue := runForTest(compiled, r); issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed {
				t.Fatal("repeated overflow did not fail", issue)
			}
		}
		// 使用同一已编译会话，明确概率0时大下限没有有效分支贡献。
		r.InitialSnapshot.Combatants[0].Attributes["hit_probability"] = authoringSlot(0)
		for repeat := 0; repeat < 2; repeat++ {
			done, issue := runForTest(compiled, r)
			if issue != nil || done.Summary.SourceDamageDealt != 100 || done.Summary.TargetFinalHp != 950 {
				t.Fatal("session did not recover after critical overflow", done.Summary, issue)
			}
			if _, err := json.Marshal(done); err != nil {
				t.Fatal("recovered result not serializable", err)
			}
		}
	}
}

func renamedCalculationSpeedInput() (model.CompileRequest, model.RunRequest) {
	c, r := continuousAttackInput(1, 10000, 0, 0, 0, 4000)
	r.DriverPlan.BasicAttack.AttackSpeedAttributeKey = "tempo"
	r.DriverPlan.BasicAttack.AttackSpeedInputMax = 10
	for index := range c.Combatants {
		if value, exists := c.Combatants[index].Attributes["attack_speed"]; exists {
			c.Combatants[index].Attributes["tempo"] = value
			delete(c.Combatants[index].Attributes, "attack_speed")
			r.InitialSnapshot.Combatants[index].Attributes["tempo"] = value
			delete(r.InitialSnapshot.Combatants[index].Attributes, "attack_speed")
		}
	}
	for index := range c.TypeCatalog.Types {
		if c.TypeCatalog.Types[index].Key == "attack_speed" && c.TypeCatalog.Types[index].Domain == "attribute" {
			c.TypeCatalog.Types[index].Key = "tempo"
		}
	}
	for _, named := range c.Formulas {
		definition := named.Expression.(map[string]any)
		for _, raw := range definition["inputs"].([]any) {
			binding := raw.(map[string]any)["binding"].(map[string]any)
			if binding["attributeKey"] == "attack_speed" {
				binding["attributeKey"] = "tempo"
			}
		}
	}
	return c, r
}

func TestCalculationRenamedSpeedKeepsWaitingProgressAndUniqueNode(t *testing.T) {
	c, r := renamedCalculationSpeedInput()
	state, err := newGenericRunState(authoringCompile(t, c), r)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := takeNextEventForTest(state.loop); !exists {
		t.Fatal("missing first attack")
	}
	if err := state.handleBasicAttack(); err != nil {
		t.Fatal(err)
	}
	state.loop.Advance(400)
	frame := state.newExecutionFrame("source", "target", "renamed-speed")
	staged := frame.stageFor("source")
	slot := staged.attributesView().At("tempo")
	slot.Base, slot.Resolved = 2, 2

	staged.setAttributes(staged.attributesView().With("tempo", slot))
	frame.commit()
	if frame.fatal || state.basicAttackReadyAt() != 700 || state.actions.BasicAttack().Wait().Remaining() != .6 || state.loop.QueuedEvents() != 1 {
		t.Fatal(frame.fatalErr, state.actions.BasicAttack().Wait(), state.loop.QueuedEvents())
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	if state.report.Snapshot().AttackRecords[1].StartAtMs != 700 {
		t.Fatal(state.report.Snapshot().AttackRecords)
	}
}

func TestCalculationFirstSpeedInvalidFrameDoesNotCommitAttributesOrClock(t *testing.T) {
	for _, invalid := range []float64{0, -1, 11} {
		c, r := renamedCalculationSpeedInput()
		state, err := newGenericRunState(authoringCompile(t, c), r)
		if err != nil {
			t.Fatal(err)
		}
		if state.actions.BasicAttack().Wait() != nil {
			t.Fatal("unexpected prior wait")
		}
		count := state.loop.QueuedEvents()
		frame := state.newExecutionFrame("source", "target", "invalid-initial-speed")
		staged := frame.stageFor("source")
		slot := staged.attributesView().At("tempo")
		slot.Base, slot.Resolved = invalid, invalid

		staged.setAttributes(staged.attributesView().With("tempo", slot))
		hp := staged.attributesView().At("hp")
		hp.Current -= 10

		staged.setAttributes(staged.attributesView().With("hp", hp))
		frame.commit()
		if !frame.fatal || state.combatants["source"].attributesView().At("tempo").Resolved != 1 || state.combatants["source"].attributesView().At("hp").Current != c.Combatants[0].Attributes["hp"].Current || state.loop.QueuedEvents() != count || state.actions.BasicAttack().Wait() != nil {
			t.Fatal(invalid, frame.fatalErr, state.combatants["source"].attributesView(), state.loop.QueuedEvents())
		}
	}
}
