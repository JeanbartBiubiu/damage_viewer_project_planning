package runtime

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func TestTargetMarkEveryLeafUsesTheRealEventBudget(t *testing.T) {
	// W contact uses resolve+zero damage+SET1=3 commands. Q's event uses
	// resolve+root damage+wrapper+clear+W damage+restore=6. Each rejected leaf
	// retains Q's committed 100 and vamp20, but publishes none of the group.
	for _, budget := range []int{3, 4, 5} {
		c, r := targetMarkInput(true, false)
		r.SafetyBudget = &model.RunSafetyBudget{MaxCommandsPerEvent: budget}
		done := authoringRun(t, c, r)
		if done.Summary.Execution.Complete || done.Summary.Execution.BudgetCause == nil || *done.Summary.Execution.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || done.TargetMarkSummary.ConsumedCount != 0 {
			t.Fatal(budget, done.Summary.Execution, done.TargetMarkSummary)
		}
		if done.Summary.SourceDamageDealt != 100 || done.Summary.TargetFinalHp != 900 || done.Summary.SourceFinalHp != 520 || done.FinalSnapshot.Combatants[0].Resources["mana"].Current != 80 || len(targetMarkRows(done)) != 0 {
			t.Fatal(budget, done.Summary)
		}
		bag := done.FinalSnapshot.Combatants[0].ProviderState["w"].(map[string]any)["targetState"].(map[string]any)
		if bag["values"].(map[string]any)["mark"] != float64(1) || bag["expireAt"].(map[string]any)["mark"] != float64(4250) {
			t.Fatal("budget failure cleared mark", budget, bag)
		}
	}
}

func TestTargetMarkRepeatedFrozenConditionsCannotConsumeTwice(t *testing.T) {
	c, r := targetMarkInput(true, false)
	a := &c.SharedProviders[1].Abilities[3]
	condition := authoringBinary("eq", authoringRead("provider.target_state.mark"), authoringConst(1))
	a.ListenerSpec.Condition = &condition
	second := *a
	second.AbilityKey = "consume_q_again"
	spec := *a.ListenerSpec
	spec.ListenerKey = second.AbilityKey
	second.ListenerSpec = &spec
	c.SharedProviders[1].Abilities = append(c.SharedProviders[1].Abilities, second)
	done := authoringRun(t, c, r)
	if done.TargetMarkSummary.ConsumedCount != 1 || done.TargetMarkSummary.SkillCount != 1 || len(targetMarkRows(done)) != 1 || done.Summary.SourceDamageDealt != 210 || done.Summary.SourceFinalHp != 542 {
		t.Fatal("frozen true condition replayed a cleared field", done.TargetMarkSummary, done.Summary)
	}
}

func TestTargetMarkReapplicationSurvivesOldDeadline(t *testing.T) {
	c, r := targetMarkInput(true, false)
	// This synthetic generic process explicitly has a 1000ms cooldown; it is
	// not an assertion about Ezreal W's real cooldown. Both uses are real.
	c.SharedProviders[1].Processes[0].Cooldown.DurationMs = *timedShieldExpr(1000)
	second := r.DriverPlan.SkillActions[0]
	second.InstructionKey, second.FirstAtMs = "w_again", 1000
	r.DriverPlan.SkillActions = append(r.DriverPlan.SkillActions, second)
	r.DriverPlan.SkillActions[1].FirstAtMs = 4000
	r.StopPolicy.DurationMs = 4250
	done := authoringRun(t, c, r)
	rows := targetMarkRows(done)
	if len(rows) != 1 || rows[0].TimeMs != 4250 || rows[0].Data["deadlineBefore"] != int64(5250) || done.Summary.SourceDamageDealt != 210 || done.TargetMarkSummary.ConsumedCount != 1 {
		t.Fatal("old 4250 deadline removed the new 5250 window", done.Summary, rows)
	}
}

func TestTargetMarkSamplesChangedAPAtDetonation(t *testing.T) {
	c, r := targetMarkInput(true, false)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "ability/skill/stat", Domain: "ability"})
	c.Combatants[0].Attributes["ability_power"] = model.AttributeSlotDef{Base: 100, Current: 100, Resolved: 100, Max: 1000}
	p, b, a := targetMarkSkill("stat", 400, 0)
	p.Processes[0].Steps[0].OccupiesAction = model.BoolPtr(false)
	p.Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "attribute_change", Target: "self", Ref: "stat.ap", AttributeKey: "ability_power", ValuePolicy: "add", Amount: timedShieldExpr(100)}}}}
	c.SharedProviders = append(c.SharedProviders, p)
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "stat", DefinitionRef: p.ProviderKey})
	r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "stat", DefinitionRef: p.ProviderKey, Owner: "source", Source: "source", Stacks: 1})
	c.Rules.SkillActionBindings = append(c.Rules.SkillActionBindings, b)
	r.DriverPlan.SkillActions = append(r.DriverPlan.SkillActions, a)
	done := authoringRun(t, c, r)
	// Applied at250 with100AP, detonation at750 with200AP: (130+.9*200)/2=155.
	if done.Summary.SourceDamageDealt != 255 || done.TargetMarkSummary.ConsumedCount != 1 {
		t.Fatal(done.Summary, done.TargetMarkSummary)
	}
	for _, row := range done.DamageRecords {
		if row["operationRef"] == "w.detonate" && (row["rawAmount"] != 310.0 || row["postDefenseDamage"] != 155.0 || row["useRef"] != "skill:q") {
			t.Fatal(row)
		}
	}
}

func TestTargetMarkSourceDeathKeepsCommittedContactTail(t *testing.T) {
	c, r := targetMarkInput(true, false)
	c.Combatants[0].Attributes["armor"] = authoringSlot(0)
	hit := c.SharedProviders[2].Abilities[1].Operations[0].SkillHit
	self := hit.Candidates[0]
	self.CandidateKey, self.EffectOccurrenceKey, self.ResultKey = "self_tail", "self_tail", "self_tail"
	self.Semantic.Target = "SOURCE"
	self.SpellShieldBlockScope = nil
	self.Operations = []model.OperationDefinition{{Operation: "damage", Target: "source", Ref: "q.self_tail", DamageType: "damage/physics", Amount: timedShieldExpr(1000), Types: []string{"damage_trait/delivery_skill", "damage_trait/origin_direct"}, VampQualification: model.VampResolved}}
	hit.Candidates = append(hit.Candidates, self)
	done := authoringRun(t, c, r)
	if done.Summary.SourceFinalHp != 0 || done.Summary.TargetFinalHp != 790 || done.TargetMarkSummary.ConsumedCount != 1 || done.FinalSnapshot.Combatants[0].Resources["mana"].Current != 80 {
		t.Fatal("source death lost the already established W tail or revived source", done.Summary, done.TargetMarkSummary)
	}
	found := false
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindVamp && item.Ref == "w.detonate" {
			found = true
			if item.Data["skippedReason"] != "source_dead" {
				t.Fatal(item)
			}
		}
	}
	if !found {
		t.Fatal("missing source-dead vamp decision")
	}
}

func TestTargetMarkQueuePreflightCannotPublishStagedGroupFacts(t *testing.T) {
	c, r := targetMarkInput(true, false)
	// Let the public real Q commit while retaining the mark. Then exercise the
	// existing frame preflight directly with the actual compiled private leaves;
	// this is a transaction test, not a new external contact/resume protocol.
	c.SharedProviders[1].Abilities[3].ListenerSpec.Condition = timedShieldExpr(0)
	s := targetMarkState(t, c, r)
	if err := s.runLoop(); err != nil {
		t.Fatal(err)
	}
	var op plan.CompiledOperation
	var ability plan.CompiledAbility
	for _, candidate := range s.compiled.Operations {
		if candidate.TargetMark != nil {
			op = candidate
		}
	}
	for _, candidate := range s.compiled.Abilities {
		if candidate.AbilityKey == "consume_q" {
			ability = candidate
		}
	}
	var frame executionFrame
	s.initExecutionFrame(&frame, "source", "target", "source.provider[w].ability[consume_q]")
	frame.ownerCombatantKey, frame.ownerProviderRef, frame.mountedListener = "source", "w", true
	for _, leaf := range []*plan.CompiledOperation{op.TargetMark.Clear, op.TargetMark.Damage, op.TargetMark.Restore} {
		if err := frame.executeOperation(ability, leaf); err != nil {
			t.Fatal(err)
		}
	}
	frame.pendingTargetMark.ConsumedCount, frame.pendingTargetMark.SkillCount = 1, 1
	frame.stageProviderTargetStateExpiry("source", "w", "target", "mark", 4250)
	s.heap.SetLimit(s.heap.Len())
	frame.commit()
	if !frame.fatal || frame.fatalErr.BudgetCause != model.BudgetCauseMaxQueueEvents || frame.committed || s.targetMarkSummary.ConsumedCount != 0 || s.combatantHp("target") != 900 || s.combatantHp("source") != 520 || s.combatants["source"].resources["mana"].Current != 80 || s.combatants["source"].providerState["w"].targetValues["mark"] != 1 {
		t.Fatal("failed preflight published part of the group", frame.fatalErr, s.targetMarkSummary)
	}
	for _, row := range s.damageRecords {
		if row["operationRef"] == "w.detonate" {
			t.Fatal("uncommitted damage escaped", row)
		}
	}
}
