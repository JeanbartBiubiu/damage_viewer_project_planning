// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	math "math"
	reflect "reflect"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func snapshotAttributeInput(t *testing.T, duration int64, refresh bool) (model.CompileRequest, model.RunRequest) {
	c, r := hitFlatFixture(t, "snapshot", duration, refresh)
	c.SharedProviders[0].Abilities[0].Operations[0].SkillHit.Candidates = []model.SkillHitCandidate{hitFlatCandidate("snapshot_armor")}
	for i := range c.SharedProviders {
		if c.SharedProviders[i].ProviderKey == "snapshot_armor" {
			c.SharedProviders[i].Modifiers = []model.ModifierDefinition{
				{ModifierKey: "reduce", Kind: "attribute", Target: "self.attr.move_speed", Stage: "total", ValuePolicy: "multiply", Value: gfConst(.8), ValueReadMode: "APPLICATION_SNAPSHOT"},
				{ModifierKey: "gain", Kind: "attribute", Target: "opponent.attr.move_speed", ValuePolicy: "add", ValueReadMode: "APPLICATION_SNAPSHOT", Value: model.GenericFormulaExpr{Op: "mul", Args: []model.GenericFormulaExpr{gfConst(.2), authoringRead("target.attr.move_speed.resolved")}}},
			}
		}
	}
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "move_speed", Domain: "attribute"})
	setCombatantAttr(&c, &r, "source", "move_speed", authoringSlot(300))
	setCombatantAttr(&c, &r, "target", "move_speed", authoringSlot(400))
	return c, r
}

func TestModifierSnapshotFreezesBothActorsAndRefreshesFromOldState(t *testing.T) {
	for _, refresh := range []bool{false, true} {
		c, r := snapshotAttributeInput(t, 1999, refresh)
		done := runSkillHit(t, c, r)
		want := float64(380)
		if refresh {
			want = 364
		}
		if math.Abs(snapshotAttribute(t, done, "source", "move_speed")-want) > 1e-9 || snapshotAttribute(t, done, "target", "move_speed") != 320 {
			t.Fatal(done.FinalSnapshot)
		}
		var values map[string]float64
		for _, actor := range done.FinalSnapshot.Combatants {
			for _, provider := range actor.Providers {
				if provider.DefinitionRef == "snapshot_armor" {
					values = provider.ModifierSnapshots
				}
			}
		}
		gain := 80.0
		if refresh {
			gain = 64
		}
		if values["reduce"] != .8 || math.Abs(values["gain"]-gain) > 1e-9 || len(values) != 2 {
			t.Fatal(values)
		}
	}
	c, r := snapshotAttributeInput(t, 2000, false)
	done := runSkillHit(t, c, r)
	if snapshotAttribute(t, done, "source", "move_speed") != 300 || snapshotAttribute(t, done, "target", "move_speed") != 400 {
		t.Fatal(done.FinalSnapshot)
	}
}

func TestModifierSnapshotMissingSourceSlotRollsBackBoth(t *testing.T) {
	c, r := snapshotAttributeInput(t, 100, false)
	delete(r.InitialSnapshot.Combatants[0].Attributes, "move_speed")
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	if _, err := runtimeengine.RunGeneric(compiled.Session, r); err == nil {
		t.Fatal("missing actual source slot accepted")
	}
}

func TestModifierSnapshotNamedFormulaAndRecordingModes(t *testing.T) {
	c, r := snapshotAttributeInput(t, 100, false)
	for i := range c.SharedProviders {
		if c.SharedProviders[i].ProviderKey == "snapshot_armor" {
			c.SharedProviders[i].SkillKey = "author:q"
			c.Formulas = append(c.Formulas, formuladefinition.FromExpr("gain_formula", "author:q", authoringBinary("mul", authoringRead("target.attr.move_speed.resolved"), authoringRead("ability.param.ratio")), map[string]float64{"ratio": .2}))
			c.SharedProviders[i].Modifiers[1].Value = model.GenericFormulaExpr{Op: "ref", Ref: "gain_formula"}
		}
	}
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	first, err := runtimeengine.RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	r.OutputMode = model.RunOutputSummary
	second, err := runtimeengine.RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first.FinalSnapshot, second.FinalSnapshot) || snapshotAttribute(t, second, "source", "move_speed") != 380 {
		t.Fatal(first.FinalSnapshot, second.FinalSnapshot)
	}
}

func TestModifierSnapshotRestoresFrozenValuesWithoutFollowingTargetChanges(t *testing.T) {
	c, r := snapshotAttributeInput(t, 100, false)
	done := runSkillHit(t, c, r)
	r.InitialSnapshot = done.FinalSnapshot
	r.DriverPlan.Entries = []model.DriverEntry{}
	r.SkillUses = nil
	r.SkillHitFacts = nil
	r.StopPolicy.DurationMs = 1
	for i := range r.InitialSnapshot.Combatants {
		if r.InitialSnapshot.Combatants[i].Key == "target" {
			r.InitialSnapshot.Combatants[i].Attributes["move_speed"] = authoringSlot(800)
		}
	}
	restored := runSkillHit(t, c, r)
	if snapshotAttribute(t, restored, "source", "move_speed") != 380 || snapshotAttribute(t, restored, "target", "move_speed") != 640 {
		t.Fatal(restored.FinalSnapshot)
	}
}

func TestModifierSnapshotRestoreRejectsMissingForeignOrInvalidValues(t *testing.T) {
	for _, mode := range []string{"missing", "missing_key", "extra", "negative", "nonfinite", "wrong_multiplier", "foreign_owner", "foreign_source", "unknown_definition"} {
		t.Run(mode, func(t *testing.T) {
			c, r := snapshotAttributeInput(t, 100, false)
			done := runSkillHit(t, c, r)
			r.InitialSnapshot = done.FinalSnapshot
			r.DriverPlan.Entries = []model.DriverEntry{}
			r.SkillUses = nil
			r.SkillHitFacts = nil
			r.StopPolicy.DurationMs = 1
			for i := range r.InitialSnapshot.Combatants {
				for j := range r.InitialSnapshot.Combatants[i].Providers {
					p := &r.InitialSnapshot.Combatants[i].Providers[j]
					if p.DefinitionRef != "snapshot_armor" {
						continue
					}
					switch mode {
					case "missing":
						p.ModifierSnapshots = nil
					case "missing_key":
						delete(p.ModifierSnapshots, "gain")
					case "extra":
						p.ModifierSnapshots["extra"] = 0
					case "negative":
						p.ModifierSnapshots["gain"] = -1
					case "nonfinite":
						p.ModifierSnapshots["gain"] = math.Inf(1)
					case "wrong_multiplier":
						p.ModifierSnapshots["reduce"] = .9
					case "foreign_owner":
						p.Owner = "source"
					case "foreign_source":
						p.Source = "target"
					case "unknown_definition":
						p.DefinitionRef = "unknown"
					}
				}
			}
			compiled := compile.CompileGeneric(c)
			if !compiled.OK {
				t.Fatal(compiled.Result.Errors)
			}
			if _, err := runtimeengine.RunGeneric(compiled.Session, r); err == nil {
				t.Fatal("accepted malformed snapshot", mode)
			}
		})
	}
}

func TestModifierSnapshotLegitimateZeroSurvivesJSON(t *testing.T) {
	c, r := snapshotAttributeInput(t, 100, false)
	setCombatantAttr(&c, &r, "target", "move_speed", authoringSlot(0))
	done := runSkillHit(t, c, r)
	data, err := json.Marshal(done.FinalSnapshot)
	if err != nil {
		t.Fatal(err)
	}
	var restored model.Snapshot
	if err = json.Unmarshal(data, &restored); err != nil {
		t.Fatal(err)
	}
	for _, actor := range restored.Combatants {
		for _, p := range actor.Providers {
			if p.DefinitionRef == "snapshot_armor" {
				value, present := p.ModifierSnapshots["gain"]
				if !present || value != 0 {
					t.Fatal(p)
				}
			}
		}
	}
}

func TestModifierSnapshotSpellShieldBlocksTheWholeAttributePair(t *testing.T) {
	for _, scope := range []string{model.SpellShieldScopeSkill, model.SpellShieldScopeEffect, model.SpellShieldScopeResult} {
		t.Run(scope, func(t *testing.T) {
			c, r := snapshotAttributeInput(t, 100, false)
			candidate := &c.SharedProviders[0].Abilities[0].Operations[0].SkillHit.Candidates[0]
			candidate.SpellShieldBlockScope = &scope
			c.SharedProviders = append(c.SharedProviders, spellShieldProvider())
			c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "spell_guard", DefinitionRef: "shield:spell"})
			r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: "spell_guard", DefinitionRef: "shield:spell", Source: "target", Owner: "target", Stacks: 1})
			done := runSkillHit(t, c, r)
			if snapshotAttribute(t, done, "source", "move_speed") != 300 || snapshotAttribute(t, done, "target", "move_speed") != 400 {
				t.Fatal("blocked pair still changed attributes", done.FinalSnapshot)
			}
			if hits := skillHitItems(done); len(hits) != 1 || hits[0].Data["blocked"] != 1.0 {
				t.Fatal(hits)
			}
		})
	}
}

func TestModifierSnapshotRejectsUnsupportedCompleteGraphs(t *testing.T) {
	for _, mode := range []string{"unmarked_gain", "live_gain", "ratio_mismatch", "wrong_attribute", "wrong_actor", "nonlinear", "clamped", "offset", "condition", "active", "state", "permanent", "third_modifier", "same_key", "event_read", "target_state", "runtime_input", "raw_apply"} {
		t.Run(mode, func(t *testing.T) {
			c, r := snapshotAttributeInput(t, 100, false)
			var p *model.ProviderDefinition
			for i := range c.SharedProviders {
				if c.SharedProviders[i].ProviderKey == "snapshot_armor" {
					p = &c.SharedProviders[i]
				}
			}
			switch mode {
			case "unmarked_gain":
				p.Modifiers[1].ValueReadMode = ""
			case "live_gain":
				p.Modifiers[1].ValueReadMode = "LIVE"
			case "ratio_mismatch":
				p.Modifiers[0].Value = gfConst(.7)
			case "wrong_attribute":
				p.Modifiers[1].Target = "opponent.attr.armor"
			case "wrong_actor":
				p.Modifiers[1].Target = "self.attr.move_speed"
			case "nonlinear":
				p.Modifiers[1].Value = authoringBinary("mul", authoringRead("target.attr.move_speed.resolved"), authoringRead("target.attr.move_speed.resolved"))
			case "clamped":
				p.Modifiers[1].Value = authoringBinary("max", p.Modifiers[1].Value, gfConst(0))
			case "offset":
				p.Modifiers[1].Value = authoringBinary("add", p.Modifiers[1].Value, gfConst(1))
			case "condition":
				p.Modifiers[1].Condition = timedShieldExpr(1)
			case "active":
				p.Abilities = []model.AbilityDefinition{{AbilityKey: "hidden", Kind: "active"}}
			case "state":
				p.InitialStateSchema = map[string]interface{}{"hidden": 0.0}
			case "permanent":
				p.Lifecycle = nil
			case "third_modifier":
				p.Modifiers = append(p.Modifiers, model.ModifierDefinition{ModifierKey: "hidden", Kind: "attribute", Target: "self.attr.armor", ValuePolicy: "add", Value: gfConst(1)})
			case "same_key":
				p.Modifiers[1].ModifierKey = p.Modifiers[0].ModifierKey
			case "event_read":
				p.Modifiers[1].Value = authoringRead("event.damage.mitigatedAmount")
			case "target_state":
				p.Modifiers[1].Value = authoringRead("provider.target_state.stacks")
			case "runtime_input":
				p.Modifiers[1].Value = authoringRead("ability.param.rate")
			case "raw_apply":
				c.SharedProviders[0].Abilities[0].Operations = append(c.SharedProviders[0].Abilities[0].Operations, model.OperationDefinition{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: p.ProviderKey})
			}
			compiled := compile.CompileGeneric(c)
			if compiled.OK {
				if _, err := runtimeengine.RunGeneric(compiled.Session, r); err == nil {
					t.Fatal("accepted unsupported snapshot graph", mode)
				}
			}
		})
	}
}
