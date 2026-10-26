package execution

import (
	json "encoding/json"
	math "math"
	testing "testing"
	command "tinygo_engine_v2/internal/command"
	formula "tinygo_engine_v2/internal/formula"
	model "tinygo_engine_v2/internal/model"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func cappedFlatInput(t *testing.T, chance float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := continuousAttackInput(1, 1000, 20, 0, chance, 1)
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.EventTypeSourceInitialized, Domain: "event"})
	var mod model.ModifierDefinition
	if err := json.Unmarshal([]byte(`{"modifierKey":"physical_cap","kind":"pipeline","command":"damage","channel":"all_damage","stage":"incoming_pre_mitigation","bucket":"all_instances","valuePolicy":"subtract","value":{"op":"const","value":13},"condition":{"op":"read","path":"damage.type.damage/physics"},"maximumReductionRatio":0.5}`), &mod); err != nil {
		t.Fatal(err)
	}
	addPermanentSkillSource(&c, &r, 1, "guard_skill", "character", mod)
	c.SharedProviders[len(c.SharedProviders)-2].SkillKey = "guard_skill"
	c.SharedProviders[len(c.SharedProviders)-1].SkillKey = "guard_skill"
	return c, r
}

// Internal numeric probes keep the product's global-modifier/driver gates closed.
// Initialization and the same shared settlement functions are real; these are not product-adapter fixtures.
func cappedNumbers(t *testing.T, c model.CompileRequest, r model.RunRequest) damageNumbers {
	t.Helper()
	r.DriverPlan.BasicAttack = nil
	session := authoringCompile(t, c)
	state, err := newGenericRunState(session, r)
	if err != nil {
		t.Fatal(err)
	}
	if err = state.runLoop(); err != nil {
		t.Fatal(err)
	}
	ability := session.Abilities[2]
	entry := session.Operations[ability.OperationStart]
	op := session.Operations[entry.SkillHit.Candidates[0].OperationStart]
	frame := state.newExecutionFrame("source", "target", authoringRef("native_hit"))
	base := c.Combatants[0].Attributes["attack_damage"].Resolved
	crit, amount, evidence, issue := frame.settleExpectedCrit(op, ability, base, "target")
	if issue != nil {
		t.Fatal(issue)
	}
	got, issue := frame.resolveDamageNumbers(command.Command{Kind: command.KindDamage, Source: "source", Target: "target", DamageType: "damage/physics", Amount: amount}, op, crit, ability, evidence)
	if issue != nil {
		t.Fatal(issue)
	}
	return got
}

func TestIncomingCappedFlatBranchBoundariesAndSourceProjection(t *testing.T) {
	for _, tc := range []struct {
		name                               string
		p, base, out, armor, wantRaw, want float64
	}{
		{"normal", 0, 20, 1, 0, 20, 10},
		{"critical", 1, 20, 1, 0, 40, 27},
		{"source_projection", .5, 20, 2, 100, 60, 23.5},
		{"zero", .5, 0, 1, 0, 0, 0},
		{"zero_overridden", .5, 0, 8, 0, 8, 4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, r := cappedFlatInput(t, tc.p)
			setCombatantAttr(&c, &r, "source", "attack_damage", authoringSlot(tc.base))
			setCombatantAttr(&c, &r, "target", "armor", authoringSlot(tc.armor))
			if tc.out != 1 {
				policy := "multiply"
				if tc.base == 0 {
					policy = "override"
				}
				c.Rules.Modifiers = append(c.Rules.Modifiers, c2PipelineMod("one_source_projection", "damage", "all_damage", "outgoing_pre_mitigation", policy, tc.out, 0))
			}
			got := cappedNumbers(t, c, r)
			if math.Abs(got.mitigatedAmount-tc.want) > 1e-10 {
				t.Fatal(got.mitigatedAmount, tc.want)
			}
			if math.Abs(got.rawAmount-tc.wantRaw) > 1e-10 {
				t.Fatal("raw was changed", got)
			}
			outCount := 0
			for _, row := range got.modifiers {
				if row["stage"] == "outgoing_pre_mitigation" {
					outCount++
				}
			}
			if tc.out != 1 && outCount != 1 {
				t.Fatal("source modifier evaluated more than once", got.modifiers)
			}
		})
	}
}

func TestIncomingCappedFlatNaturalAndForcedStaySeparate(t *testing.T) {
	c, r := cappedFlatInput(t, .25)
	c.Rules.Modifiers = append(c.Rules.Modifiers,
		c2PipelineMod("force_chance", "crit", "all_damage", "crit_chance_pre_settlement", "override", .75, 0),
		c2PipelineMod("natural", "crit", "all_damage", "crit_multiplier_natural_branch", "override", 2, 0),
		c2PipelineMod("forced", "crit", "all_damage", "crit_multiplier_forced_branch", "override", 4, 0))
	got := cappedNumbers(t, c, r)
	// .25*10 + .25*27 + .5*67 = 42.75; merged critical cap is not equivalent.
	if got.mitigatedAmount != 42.75 {
		t.Fatal(got)
	}
	if got.rawAmount != 55 || got.crit.normalPart != 5 || got.crit.critPart != 50 {
		t.Fatal(got)
	}
}

func cappedOwnedResistance(c *model.CompileRequest) {
	formuladefinition.DeclareAttributes(c, "armor", "magic_resistance")
	expression := map[string]any{
		"inputs": []any{phase3Input("a", "source", "armor", "BONUS"), phase3Input("m", "source", "magic_resistance", "BONUS")},
		"stages": []any{phase3Stage("output", phase3Binary("add", phase3Const("5"), phase3Binary("add", phase3Binary("mul", phase3Const("0.03"), phase3Read("a")), phase3Binary("mul", phase3Const("0.03"), phase3Read("m")))))}, "outputStageKey": "output",
	}
	c.Formulas = append(c.Formulas, model.NamedFormula{Key: "guard_points", Scope: "skill", SkillKey: "guard_skill", Expression: expression, Parameters: []model.FormulaParameter{}})
	c.SharedProviders[len(c.SharedProviders)-2].Modifiers[0].Value = model.GenericFormulaExpr{Op: "ref", Ref: "guard_points"}
}

func TestIncomingCappedFlatReadsActualOwnerAndFrozenCopyView(t *testing.T) {
	for _, owner := range []string{"source", "target"} {
		t.Run(owner, func(t *testing.T) {
			c, r := cappedFlatInput(t, .5)
			if owner == "source" {
				mount := c.Combatants[1].Providers[0]
				c.Combatants[1].Providers = nil
				c.Combatants[0].Providers = append(c.Combatants[0].Providers, mount)
				inst := r.InitialSnapshot.Combatants[1].Providers[0]
				inst.Owner, inst.Source = "source", "source"
				r.InitialSnapshot.Combatants[1].Providers = nil
				r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, inst)
			}
			cappedOwnedResistance(&c)
			for actorIndex, side := range []string{"source", "target"} {
				bonus := 1000.0
				if side == owner {
					bonus = 10
				}
				setCombatantAttr(&c, &r, side, "armor", authoringSlot(0))
				setCombatantAttr(&c, &r, side, "magic_resistance", authoringSlot(0))
				setCombatantAttr(&c, &r, side, "armor_pen_percent", authoringSlot(0))
				setCombatantAttr(&c, &r, side, "armor_pen_flat", authoringSlot(0))
				for _, key := range []string{"armor", "magic_resistance"} {
					amount := bonus
					if key == "magic_resistance" {
						amount *= 2
					}
					addPermanentSkillSource(&c, &r, actorIndex, side+"_bonus_"+key, "character", model.ModifierDefinition{ModifierKey: "bonus", Kind: "attribute", Target: "self.attr." + key, ValuePolicy: "add", Value: authoringConst(amount)})
				}
			}
			r.DriverPlan.BasicAttack = nil
			session := authoringCompile(t, c)
			state, err := newGenericRunState(session, r)
			if err != nil {
				t.Fatal(err)
			}
			if err = state.runLoop(); err != nil {
				t.Fatal(err)
			}
			attacker := opponentCombatantKey(owner)
			frame := state.newExecutionFrame(attacker, owner, "")
			op := session.Operations[session.Abilities[2].OperationStart] // entry is only used for shared formula context
			ability := session.Abilities[2]
			crit := frozenCritEvidence{present: true, eligible: true, baseRawAmount: 20, originalCritChance: .5, chanceEffective: .5, naturalWeight: .5, naturalMultiplier: 2, forcedMultiplier: 2, normalPart: 10, critPart: 20, critAdjustedRawAmount: 30}
			cmd := command.Command{Kind: command.KindDamage, Source: attacker, Target: owner, DamageType: "damage/physics", Amount: 30}
			got, e := frame.resolveDamageNumbers(cmd, op, crit, ability, nil)
			if e != nil {
				t.Fatal(e)
			}
			if math.Abs(got.mitigatedAmount-24.1/1.1) > 1e-9 {
				t.Fatal("wrong owner's BONUS resistance", got.mitigatedAmount)
			}
			frozen := frame.stageFor(owner).attributesView()
			frame.damageDefenseContext = &formula.GenericEvalContext{SourceAttrs: frame.stageFor(attacker).attributesView(), TargetAttrs: frozen}

			frame.stageFor(owner).setAttributes(frame.stageFor(owner).attributesView().With("armor", authoringSlot(9999)))
			copied, e := frame.resolveDamageNumbers(cmd, op, crit, ability, nil)
			if e != nil || math.Abs(copied.mitigatedAmount-got.mitigatedAmount) > 1e-9 {
				t.Fatal("copy lost frozen recipient view", copied, e)
			}
		})
	}
}

func TestIncomingCappedFlatDeathAndInvalidDynamicValue(t *testing.T) {
	t.Run("death", func(t *testing.T) {
		c, r := cappedFlatInput(t, .5)
		r.StopPolicy.DurationMs = 10000
		setCombatantAttr(&c, &r, "target", "hp", authoringSlot(8))
		done := authoringRun(t, c, r)
		if !done.Summary.Execution.TargetKilled || done.Summary.Execution.TargetKilledAtMs == nil || *done.Summary.Execution.TargetKilledAtMs != 0 || done.Summary.SourceDamageDealt != 18.5 || done.Summary.TargetHpLoss != 8 || len(done.AttackRecords) != 1 {
			t.Fatal(done.Summary)
		}
	})
	t.Run("negative_dynamic", func(t *testing.T) {
		c, r := cappedFlatInput(t, .5)
		formuladefinition.DeclareAttributes(&c, "armor")
		expr := map[string]any{"inputs": []any{phase3Input("bonus", "source", "armor", "BONUS")}, "stages": []any{phase3Stage("out", phase3Binary("sub", phase3Read("bonus"), phase3Const("1")))}, "outputStageKey": "out"}
		c.Formulas = append(c.Formulas, model.NamedFormula{Key: "invalid_guard", Scope: "skill", SkillKey: "guard_skill", Expression: expr, Parameters: []model.FormulaParameter{}})
		c.SharedProviders[len(c.SharedProviders)-2].Modifiers[0].Value = model.GenericFormulaExpr{Op: "ref", Ref: "invalid_guard"}
		session := authoringCompile(t, c)
		state, err := newGenericRunState(session, r)
		if err != nil {
			t.Fatal(err)
		}
		if err = state.runLoop(); err == nil {
			t.Fatal("negative current amount silently admitted")
		}
		if state.combatantHp("target") != 1000 {
			t.Fatal("failed child damage committed HP", state.combatantHp("target"))
		}
	})
}
