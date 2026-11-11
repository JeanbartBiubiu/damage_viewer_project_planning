package execution

import (
	testing "testing"
	formula "tinygo_engine_v2/internal/formula"
	model "tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	scheduler "tinygo_engine_v2/internal/scheduler"
)

const targetRemainingProvider = "target_marks"

func targetRemainingStateOperation(value float64) model.OperationDefinition {
	return model.OperationDefinition{Operation: "state_change", Target: "self", Ref: "mark", Types: []string{stateScopeProviderTarget}, ValuePolicy: "set", Amount: authoringAmount(authoringConst(value))}
}

func targetRemainingProtectCondition() *model.GenericFormulaExpr {
	read := authoringRead("provider.target_state_remaining_ms.mark")
	return authoringAmount(authoringBinary("min", authoringBinary("gt", read, authoringConst(0)), authoringBinary("lt", read, authoringConst(1000))))
}

func targetRemainingInput() (model.CompileRequest, model.RunRequest) {
	c, r := continuousAttackInput(1, 10000, 0, 0, 0, 8000)
	r.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{}}
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: stateScopeProvider, Domain: "state_scope"}, model.TypeCatalogEntry{Key: stateScopeProviderTarget, Domain: "state_scope"})
	ensure := model.OperationDefinition{Operation: model.OperationKindStateDurationChange, Target: "self", Ref: "mark", Types: []string{stateScopeProviderTarget},
		ValuePolicy: "ensure_remaining", Amount: authoringAmount(authoringConst(1250))}
	protect := ensure
	protect.Condition = targetRemainingProtectCondition()
	probe := model.OperationDefinition{Operation: "damage", Target: "target", Ref: "live_mark_probe", DamageType: "damage/physics", Amount: authoringAmount(authoringConst(10)),
		Condition: authoringAmount(authoringBinary("gt", authoringRead("provider.target_state_remaining_ms.mark"), authoringConst(0)))}
	ability := func(key string, operations ...model.OperationDefinition) model.AbilityDefinition {
		return model.AbilityDefinition{AbilityKey: key, SkillKey: "test_mark", Kind: "active", Operations: operations}
	}
	p := model.ProviderDefinition{ProviderKey: targetRemainingProvider, StableID: "test_mark", SkillKey: "test_mark", Kind: "character",
		InitialStateSchema: map[string]any{"mark": map[string]any{"valueType": "integer", "defaultValue": 0, "maxValue": 1, "durationMs": 6000, "refreshPolicy": "refresh_on_write"}},
		Abilities: []model.AbilityDefinition{ability("arm", targetRemainingStateOperation(1)), ability("clear", targetRemainingStateOperation(0)), ability("ensure", ensure), ability("protect", protect), ability("probe", probe),
			ability("fail", ensure, model.OperationDefinition{Operation: "damage", Target: "target", DamageType: "damage/physics", Ref: "failing_tail", Amount: authoringAmount(authoringBinary("div", authoringConst(1), authoringRead("source.attr.attack_damage.resolved")))})}}
	c.SharedProviders = append(c.SharedProviders, p)
	targetRemainingMount(&c, &r, "source", targetRemainingProvider)
	return c, r
}

func targetRemainingMount(c *model.CompileRequest, r *model.RunRequest, owner, ref string) {
	for i := range c.Combatants {
		if c.Combatants[i].Key == owner {
			c.Combatants[i].Providers = append(c.Combatants[i].Providers, model.CombatantProviderMount{ProviderRef: ref, DefinitionRef: targetRemainingProvider})
		}
	}
	for i := range r.InitialSnapshot.Combatants {
		if r.InitialSnapshot.Combatants[i].Key == owner {
			r.InitialSnapshot.Combatants[i].Providers = append(r.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{ProviderRef: ref, DefinitionRef: targetRemainingProvider, Source: owner, Owner: owner, Stacks: 1})
		}
	}
}

func targetRemainingEntry(key, ability string, at int64) model.DriverEntry {
	return model.DriverEntry{EntryKey: key, AbilityRef: "source.provider[" + targetRemainingProvider + "].ability[" + ability + "]", Source: "source", Target: "target", FirstAtMs: at}
}

func targetRemainingFrame(s *Engine, owner, target, ref, key string) (*Frame, planbundle.CompiledAbility, []planbundle.CompiledOperation) {
	abilityRef := owner + ".provider[" + ref + "].ability[" + key + "]"
	index := s.compiled.AbilityRefIndex[abilityRef]
	ability := s.compiled.Abilities[index.AbilityIndex]
	f := s.newExecutionFrame(owner, target, abilityRef)
	f.ownerCombatantKey, f.ownerProviderRef = owner, ref
	return f, ability, s.compiled.Operations[int(ability.OperationStart) : int(ability.OperationStart)+int(ability.OperationCount)]
}

func targetRemainingApply(t *testing.T, s *Engine, owner, target, ref, key string) {
	t.Helper()
	f, a, ops := targetRemainingFrame(s, owner, target, ref, key)
	if err := f.executeOperations(a, ops); err != nil {
		t.Fatal(err)
	}
	f.commit()
	if f.fatalErr != nil {
		t.Fatal(f.fatalErr)
	}
}

func TestTargetStateRemainingSourceAndTargetIsolation(t *testing.T) {
	c, r := targetRemainingInput()
	targetRemainingMount(&c, &r, "source", "other_mount")
	targetRemainingMount(&c, &r, "target", targetRemainingProvider)
	s, err := newGenericRunState(authoringCompile(t, c), r)
	if err != nil {
		t.Fatal(err)
	}
	targetRemainingApply(t, s, "source", "target", targetRemainingProvider, "arm")
	targetRemainingApply(t, s, "source", "target", "other_mount", "arm")
	targetRemainingApply(t, s, "target", "source", targetRemainingProvider, "arm")
	s.loop.Advance(5500)
	targetRemainingApply(t, s, "source", "target", targetRemainingProvider, "ensure")
	again, ability, operations := targetRemainingFrame(s, "source", "target", targetRemainingProvider, "ensure")
	if err := again.executeOperations(ability, operations); err != nil || len(again.pendingStateExpiry) != 0 {
		t.Fatal("same remaining floor created a duplicate deadline", err)
	}
	again.commit()
	if again.fatalErr != nil {
		t.Fatal(again.fatalErr)
	}
	if s.combatants["source"].providerState.Lookup(targetRemainingProvider).TargetExpireAt().At("mark") != 6750 || s.combatants["source"].providerState.Lookup("other_mount").TargetExpireAt().At("mark") != 6000 || s.combatants["target"].providerState.Lookup(targetRemainingProvider).TargetExpireAt().At("mark") != 6000 {
		t.Fatal("timer crossed source or mount")
	}
	for _, target := range []string{"source", ""} {
		f, a, ops := targetRemainingFrame(s, "source", target, targetRemainingProvider, "probe")
		value, err := s.formulas.Evaluation.Eval(ops[0].ConditionProgram, f.evalContext(a))
		if err != nil || value != 0 {
			t.Fatal("foreign or absent target inherited mark", target, value, err)
		}
	}
}

func TestTargetStateRemainingInactiveSkipsFailingAmount(t *testing.T) {
	for _, inactive := range []string{"never", "cleared", "expired", "missing_target"} {
		c, r := targetRemainingInput()
		s, err := newGenericRunState(authoringCompile(t, c), r)
		if err != nil {
			t.Fatal(err)
		}
		if inactive != "never" {
			targetRemainingApply(t, s, "source", "target", targetRemainingProvider, "arm")
		}
		if inactive == "cleared" {
			targetRemainingApply(t, s, "source", "target", targetRemainingProvider, "clear")
		}
		if inactive == "expired" {
			s.loop.Advance(6000)
		}
		target := "target"
		if inactive == "missing_target" {
			target = ""
		}
		f, a, ops := targetRemainingFrame(s, "source", target, targetRemainingProvider, "ensure")
		op := ops[0]
		bad, registerErr := fixtureRegister(&s.formulas, formula.GenericProgram{Key: "test/failing_ensure", Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1}, {Op: formula.GenericOpConst, Value: 0}, {Op: formula.GenericOpDiv}}})
		if registerErr != nil {
			t.Fatal(registerErr)
		}
		op.AmountProgram = bad
		if err := f.executeOperation(a, &op); err != nil || len(f.pendingStateExpiry) != 0 {
			t.Fatal("inactive ensure evaluated amount or queued timer", inactive, err)
		}
		if inactive == "never" && s.combatants["source"].providerState.Len() != 0 {
			t.Fatal("inactive ensure created a live bag")
		}
	}
}

func TestTargetStateRemainingFailedFramePreservesCommittedParent(t *testing.T) {
	for _, failure := range []string{"operation", "queue"} {
		t.Run(failure, func(t *testing.T) {
			c, r := targetRemainingInput()
			s, err := newGenericRunState(authoringCompile(t, c), r)
			if err != nil {
				t.Fatal(err)
			}
			targetRemainingApply(t, s, "source", "target", targetRemainingProvider, "arm")
			s.loop.Advance(5500)
			beforeEvidence, beforePayloads := len(s.report.Snapshot().Evidence.Items), s.effectTimers.ExpiryCount()
			key := "fail"
			if failure == "queue" {
				key = "ensure"
				clearQueuedEventsForTest(s.loop)
				s.loop.SetQueueLimit(1)
				if s.loop.Enqueue(scheduler.GenericEvent{TimeMs: 6000}) != model.ErrOK {
					t.Fatal("queue setup")
				}
			}
			f, a, ops := targetRemainingFrame(s, "source", "target", targetRemainingProvider, key)
			err = f.executeOperations(a, ops)
			if failure == "queue" {
				if err != nil {
					t.Fatal(err)
				}
				f.commit()
				err = f.fatalErr
			}
			if err == nil || f.committed {
				t.Fatal("failure unexpectedly committed", failure, err)
			}
			bag := s.combatants["source"].providerState.Lookup(targetRemainingProvider)
			if bag.TargetExpireAt().At("mark") != 6000 || bag.TargetValues().At("mark") != 1 || len(s.report.Snapshot().Evidence.Items) != beforeEvidence || s.effectTimers.ExpiryCount() != beforePayloads {
				t.Fatal("failed child changed committed marker", bag, err)
			}
		})
	}
}
