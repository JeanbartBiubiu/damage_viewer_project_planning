package runtime

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	gort "runtime"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func vampFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	_, file, _, _ := gort.Caller(0)
	raw, e := os.ReadFile(filepath.Join(filepath.Dir(file), "..", "testkit", "fixtures", "generic_vamp_damage.json"))
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if e := json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	return f.CompileRequest, f.RunRequest
}
func vampValue(v float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: &v}
}
func vampNear(t *testing.T, label string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("%s=%v want %v", label, got, want)
	}
}
func vampEvents(done model.DoneResult) []model.EvidenceItem {
	var out []model.EvidenceItem
	for _, e := range done.Evidence.Items {
		if e.Kind == model.EvidenceKindVamp {
			out = append(out, e)
		}
	}
	return out
}
func vampAmount(t *testing.T, data map[string]interface{}, key string, want float64) {
	t.Helper()
	got, ok := data[key].(float64)
	if !ok {
		t.Fatalf("%s is %T", key, data[key])
	}
	vampNear(t, key, got, want)
}
func vampSetHP(r *model.RunRequest, actor int, value, max float64) {
	r.InitialSnapshot.Combatants[actor].Attributes["hp"] = model.AttributeSlotDef{Base: max, Current: value, Max: max, Resolved: value}
}
func vampOpenScenario(c *model.CompileRequest, r *model.RunRequest) {
	c.SharedProviders[0].Modifiers = nil
	c.Rules.VampRules = c.Rules.VampRules[:1] // only omnivamp
	vampSetHP(r, 0, 10, 1000)
	vampSetHP(r, 1, 1000, 1000)
	r.InitialSnapshot.Combatants[1].Shields = nil
	for _, attrs := range []map[string]model.AttributeSlotDef{c.Combatants[0].Attributes, r.InitialSnapshot.Combatants[0].Attributes} {
		slot := attrs["omnivamp_percent"]
		slot.Max = 1
		attrs["omnivamp_percent"] = slot
	}
}

func TestVampDamageBreakdownHealingOrderAndOverheal(t *testing.T) {
	c, r := vampFixture(t)
	done := c1Run(t, c, r)
	events := vampEvents(done)
	if len(events) != 1 {
		t.Fatalf("vamp events=%d", len(events))
	}
	d := events[0].Data
	for key, want := range map[string]float64{"postDefenseDamage": 50, "shieldAbsorbed": 20, "actualHpLoss": 20, "overkillDamage": 10, "healingBeforeModifiers": 15, "healingAfterDone": 18, "healingAfterModifiers": 10.8, "actualHealing": 5, "overheal": 5.8} {
		vampAmount(t, d, key, want)
	}
	contrib := d["contributions"].([]map[string]interface{})
	if len(contrib) != 2 || contrib[0]["vampType"] != model.VampLifeSteal || contrib[1]["vampType"] != model.VampOmnivamp {
		t.Fatalf("contributions=%v", contrib)
	}
	vampAmount(t, contrib[0], "amount", 5)
	vampAmount(t, contrib[1], "amount", 10)
	mods := d["modifiers"].([]map[string]interface{})
	if len(mods) != 2 || mods[0]["direction"] != model.HealDone || mods[1]["direction"] != model.HealReceived {
		t.Fatalf("modifiers=%v", mods)
	}
	vampNear(t, "source hp", done.Summary.SourceFinalHp, 100)
	vampNear(t, "overheal summary", done.Summary.SourceOverheal, 5.8)
	for _, e := range done.Evidence.Items {
		if e.Kind == model.EvidenceKindDamage {
			if e.Data["damageId"] != d["damageId"] {
				t.Fatal("damage link mismatch")
			}
			vampAmount(t, e.Data, "actualHpLoss", 20)
		}
	}
}

func TestVampActualHPLossBasisAndCompleteShield(t *testing.T) {
	for _, shield := range []float64{20, 100} {
		name := "partial"
		if shield == 100 {
			name = "complete"
		}
		t.Run(name, func(t *testing.T) {
			c, r := vampFixture(t)
			c.SharedProviders[0].Modifiers = nil
			c.Rules.VampRules = c.Rules.VampRules[:1]
			c.Rules.VampRules[0].BasisOutputKind = model.VampActualHPLoss
			vampSetHP(&r, 0, 10, 100)
			r.InitialSnapshot.Combatants[1].Shields[0].Remaining = shield
			done := c1Run(t, c, r)
			d := vampEvents(done)[0].Data
			want := 4.0
			if shield == 100 {
				want = 0
			}
			vampAmount(t, d, "actualHealing", want)
			vampAmount(t, d, "postDefenseDamage", 50)
		})
	}
}

func TestVampQualificationMatchersDisabledAndOverride(t *testing.T) {
	tests := []struct {
		name   string
		change func(*model.CompileRequest)
		want   float64
	}{
		{"default", func(*model.CompileRequest) {}, 10},
		{"skill delivery", func(c *model.CompileRequest) {
			c.SharedProviders[0].Abilities[0].Types = []string{"ability/common"}
			c.SharedProviders[0].Abilities[0].Operations[0].Types = []string{"damage_trait/delivery_skill", "damage_trait/origin_direct"}
		}, 10},
		{"summoner", func(c *model.CompileRequest) { c.SharedProviders[0].Abilities[0].Types = []string{"ability/summoner"} }, 0},
		{"reflected", func(c *model.CompileRequest) {
			c.SharedProviders[0].Abilities[0].Operations[0].Types = []string{"damage_trait/delivery_basic_attack", "damage_trait/origin_reflected"}
		}, 0},
		{"disabled", func(c *model.CompileRequest) {
			c.SharedProviders[0].Abilities[0].Operations[0].VampOverrides = []model.VampOverrideDefinition{{VampType: model.VampOmnivamp, Mode: model.VampDisabled}}
		}, 0},
		{"override outside default", func(c *model.CompileRequest) {
			c.SharedProviders[0].Abilities[0].Types = []string{"ability/summoner"}
			op := &c.SharedProviders[0].Abilities[0].Operations[0]
			op.Types = []string{"damage_trait/delivery_skill", "damage_trait/origin_reflected"}
			op.VampOverrides = []model.VampOverrideDefinition{{VampType: model.VampOmnivamp, Mode: model.VampOverride, BasisOutputKind: model.VampPostDefense, Efficiency: vampValue(.5)}}
		}, 5},
		{"override cannot escape target", func(c *model.CompileRequest) {
			c.Combatants[1].Types = []string{"combatant/minion"}
			c.SharedProviders[0].Abilities[0].Operations[0].VampOverrides = []model.VampOverrideDefinition{{VampType: model.VampOmnivamp, Mode: model.VampOverride, BasisOutputKind: model.VampPostDefense, Efficiency: vampValue(1)}}
		}, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c, r := vampFixture(t)
			vampOpenScenario(&c, &r)
			tc.change(&c)
			done := c1Run(t, c, r)
			vampAmount(t, vampEvents(done)[0].Data, "actualHealing", tc.want)
		})
	}
}

func TestVampStrictMissingInputsAndInvalidEfficiency(t *testing.T) {
	tests := []struct {
		name    string
		change  func(*model.CompileRequest, *model.RunRequest)
		message string
	}{
		{"missing ratio", func(c *model.CompileRequest, r *model.RunRequest) {
			delete(r.InitialSnapshot.Combatants[0].Attributes, "omnivamp_percent")
		}, "missing vamp source attribute"},
		{"missing efficiency attribute", func(c *model.CompileRequest, r *model.RunRequest) {
			c.SharedProviders[0].Abilities[0].Operations[0].VampOverrides = []model.VampOverrideDefinition{{VampType: model.VampOmnivamp, Mode: model.VampOverride, BasisOutputKind: model.VampPostDefense, Efficiency: &model.GenericFormulaExpr{Op: "read", Path: "source.attr.absent.resolved"}}}
		}, "missing attribute"},
		{"negative dynamic efficiency", func(c *model.CompileRequest, r *model.RunRequest) {
			c.SharedProviders[0].Abilities[0].Params["efficiency"] = -1
			c.SharedProviders[0].Abilities[0].Operations[0].VampOverrides = []model.VampOverrideDefinition{{VampType: model.VampOmnivamp, Mode: model.VampOverride, BasisOutputKind: model.VampPostDefense, Efficiency: &model.GenericFormulaExpr{Op: "read", Path: "ability.param.efficiency"}}}
		}, "non-negative"},
		{"overflow efficiency", func(c *model.CompileRequest, r *model.RunRequest) {
			c.SharedProviders[0].Abilities[0].Operations[0].VampOverrides = []model.VampOverrideDefinition{{VampType: model.VampOmnivamp, Mode: model.VampOverride, BasisOutputKind: model.VampPostDefense, Efficiency: &model.GenericFormulaExpr{Op: "mul", Args: []model.GenericFormulaExpr{*vampValue(math.MaxFloat64), *vampValue(2)}}}}
		}, "non-finite"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c, r := vampFixture(t)
			vampOpenScenario(&c, &r)
			tc.change(&c, &r)
			result := compile.CompileGeneric(c)
			if !result.OK {
				t.Fatalf("unexpected compile failure: %+v", result.Result.Errors)
			}
			_, err := RunGeneric(result.Session, r)
			if err == nil || !strings.Contains(err.Message, tc.message) || err.Path == "" {
				t.Fatalf("err=%+v want %s and path", err, tc.message)
			}
		})
	}
}

func TestVampSessionErrorPreservesPathAndSessionCanRunAgain(t *testing.T) {
	c, r := vampFixture(t)
	session := NewSession()
	if code := session.CompileJSON(mustJSON(c)); code != 0 {
		t.Fatalf("compile code=%d", code)
	}
	compiled := lastGenericCompileResult(session.OutboxBytes())
	r.SessionID, r.ExpectedRulesHash = compiled.SessionID, compiled.RulesHash
	delete(r.InitialSnapshot.Combatants[0].Attributes, "omnivamp_percent")
	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(r)); code != -1 {
		t.Fatalf("missing ratio code=%d", code)
	}
	err := lastGenericError(session.OutboxBytes())
	if err.Path != "combatants[source].attributes.omnivamp_percent" || err.Ref != "sample_hit" || err.SessionID != compiled.SessionID {
		t.Fatalf("lost error details: %+v", err)
	}
	_, valid := vampFixture(t)
	valid.SessionID, valid.ExpectedRulesHash = compiled.SessionID, compiled.RulesHash
	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(valid)); code != 0 {
		t.Fatalf("session cannot run again: %+v", lastGenericError(session.OutboxBytes()))
	}
	vampNear(t, "reused session hp", lastGenericRunDone(session.OutboxBytes()).Summary.SourceFinalHp, 100)
	session.ClearOutbox()
	if code := session.ReleaseSessionJSON(mustJSON(model.ReleaseSessionRequest{SessionID: compiled.SessionID, ExpectedRulesHash: compiled.RulesHash})); code != 0 {
		t.Fatalf("release code=%d", code)
	}
}

func TestVampExplicitResolvedZeroNeverFallsBackToCurrent(t *testing.T) {
	for _, field := range []string{"ratio", "efficiency"} {
		t.Run(field, func(t *testing.T) {
			c, r := vampFixture(t)
			vampOpenScenario(&c, &r)
			key := "omnivamp_percent"
			if field == "efficiency" {
				key = "efficiency_ratio"
				c.SharedProviders[0].Abilities[0].Operations[0].VampOverrides = []model.VampOverrideDefinition{{VampType: model.VampOmnivamp, Mode: model.VampOverride, BasisOutputKind: model.VampPostDefense, Efficiency: &model.GenericFormulaExpr{Op: "read", Path: "source.attr.efficiency_ratio.resolved"}}}
			}
			r.InitialSnapshot.Combatants[0].Attributes[key] = model.AttributeSlotDef{Base: 1, Current: 1, Max: 1, Resolved: 0}
			c.SharedProviders[0].Modifiers = []model.ModifierDefinition{{ModifierKey: "force_resolved_zero", Kind: "attribute", Target: key, ValuePolicy: "multiply", Value: *vampValue(0)}}
			done := c1Run(t, c, r)
			vampAmount(t, vampEvents(done)[0].Data, "actualHealing", 0)
		})
	}
}

func TestVampHealingGroupsAddWithinGroupAndMultiplyBetweenGroups(t *testing.T) {
	c, r := vampFixture(t)
	vampOpenScenario(&c, &r)
	makeMod := func(key, group, direction string, value float64) model.ModifierDefinition {
		return model.ModifierDefinition{ModifierKey: key, Kind: "pipeline", Command: "heal", HealDirection: direction, HealCategory: model.HealVamp, HealGroupKey: group, ValuePolicy: "add_percent", Value: *vampValue(value)}
	}
	c.SharedProviders[0].Modifiers = []model.ModifierDefinition{makeMod("a", "same", model.HealDone, .5), makeMod("b", "same", model.HealDone, -.2), makeMod("c", "other", model.HealDone, .1), makeMod("d", "received", model.HealReceived, -.4)}
	done := c1Run(t, c, r)
	d := vampEvents(done)[0].Data
	vampAmount(t, d, "healingAfterModifiers", 10*1.3*1.1*.6)
	mods := d["modifiers"].([]map[string]interface{})
	if len(mods) != 3 {
		t.Fatalf("groups=%v", mods)
	}
	vampAmount(t, mods[0], "netRatio", .3)
	c.SharedProviders[0].Modifiers[1].Value = *vampValue(-2)
	done = c1Run(t, c, r)
	vampAmount(t, vampEvents(done)[0].Data, "actualHealing", 0)
}

func TestVampMultipleHitsReadCurrentRatioAndEventChangesOnlyAffectNextHit(t *testing.T) {
	c, r := vampFixture(t)
	vampOpenScenario(&c, &r)
	c.Rules.Listeners = []model.ListenerDefinition{{ListenerKey: "gain_ratio_after_damage", EventMatcher: model.TypeMatcher{All: []string{"event/damage_instance"}}, Operations: []model.OperationDefinition{{Operation: "attribute_change", Target: "source", AttributeKey: "omnivamp_percent", ValuePolicy: "add", Amount: vampValue(.2)}}}}
	r.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{IntervalMs: 50, MaxAttempts: 2}
	done := c1Run(t, c, r)
	events := vampEvents(done)
	if len(events) != 2 {
		t.Fatalf("events=%d", len(events))
	}
	vampAmount(t, events[0].Data, "actualHealing", 10)
	vampAmount(t, events[1].Data, "actualHealing", 20)
	vampNear(t, "source hp", done.Summary.SourceFinalHp, 40)
}

func TestVampDeathSelfDamageZeroAndFullHealthBoundaries(t *testing.T) {
	tests := []struct {
		name   string
		change func(*model.CompileRequest, *model.RunRequest)
		heals  []float64
		reason string
	}{
		{"self damage", func(c *model.CompileRequest, r *model.RunRequest) {
			c.SharedProviders[0].Abilities[0].Operations[0].Target = "source"
		}, []float64{0}, "self_damage"},
		{"source killed within frame", func(c *model.CompileRequest, r *model.RunRequest) {
			op := c.SharedProviders[0].Abilities[0].Operations[0]
			op.Target = "source"
			op.DamageType = "damage/true"
			c.SharedProviders[0].Abilities[0].Operations = append([]model.OperationDefinition{op}, c.SharedProviders[0].Abilities[0].Operations...)
		}, []float64{0, 0}, "source_dead"},
		{"target killed first hit", func(c *model.CompileRequest, r *model.RunRequest) {
			vampSetHP(r, 1, 20, 100)
			op := c.SharedProviders[0].Abilities[0].Operations[0]
			c.SharedProviders[0].Abilities[0].Operations = append(c.SharedProviders[0].Abilities[0].Operations, op)
		}, []float64{10, 0}, "target_was_dead"},
		{"zero damage", func(c *model.CompileRequest, r *model.RunRequest) {
			c.SharedProviders[0].Abilities[0].Operations[0].Amount = vampValue(0)
		}, []float64{0}, "no_damage_applied"},
		{"full health", func(c *model.CompileRequest, r *model.RunRequest) { vampSetHP(r, 0, 1000, 1000) }, []float64{0}, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c, r := vampFixture(t)
			vampOpenScenario(&c, &r)
			tc.change(&c, &r)
			done := c1Run(t, c, r)
			events := vampEvents(done)
			if len(events) != len(tc.heals) {
				t.Fatalf("events=%d", len(events))
			}
			for i, h := range tc.heals {
				vampAmount(t, events[i].Data, "actualHealing", h)
			}
			if tc.reason != "" && events[len(events)-1].Data["skippedReason"] != tc.reason {
				t.Fatalf("reason=%v", events[len(events)-1].Data)
			}
			if tc.name == "source killed within frame" && done.Summary.SourceFinalHp != 0 {
				t.Fatal("vamp resurrected source")
			}
			if tc.name == "full health" {
				vampAmount(t, events[0].Data, "overheal", 10)
			}
		})
	}
}

func TestVampCopyCollectorKeepsOwnAbilityAndOverrides(t *testing.T) {
	c, r := vampFixture(t)
	vampOpenScenario(&c, &r)
	op := c.SharedProviders[0].Abilities[0].Operations[0]
	op.CopyableOnHit = true
	op.Types = []string{"damage_trait/delivery_skill", "damage_trait/origin_reflected"}
	op.VampOverrides = []model.VampOverrideDefinition{{VampType: model.VampOmnivamp, Mode: model.VampOverride, BasisOutputKind: model.VampPostDefense, Efficiency: vampValue(.5)}}
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "emit_event", Target: "target", EventType: "event/on_hit"}}
	c.SharedProviders[0].InitialStateSchema = map[string]interface{}{"stacks": float64(1)}
	r.InitialSnapshot.Combatants[0].ProviderState = map[string]interface{}{"champion": map[string]interface{}{"state": map[string]interface{}{"stacks": float64(1)}}}
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{
		AbilityKey: "on_hit", Kind: "passive_listener", Types: []string{"ability/summoner"},
		ListenerSpec: &model.ListenerDefinition{ListenerKey: "copyable", EventMatcher: model.TypeMatcher{All: []string{"event/on_hit"}}},
		Operations: []model.OperationDefinition{op,
			{Operation: "attribute_change", Target: "source", AttributeKey: "omnivamp_percent", ValuePolicy: "set", Amount: vampValue(.4)},
			{Operation: model.OperationKindRepeat, RepeatScope: model.RepeatScopeCopyableOnHit, RepeatCount: 1, RepeatTag: "vamp_copy", TriggerStateKey: "stacks", Threshold: 1},
		},
	})
	done := c1Run(t, c, r)
	events := vampEvents(done)
	if len(events) != 2 {
		t.Fatalf("expected original and copied vamp: %v", events)
	}
	vampAmount(t, events[0].Data, "actualHealing", 5)
	vampAmount(t, events[1].Data, "actualHealing", 10)
	if events[0].Data["phantom"] != false || events[1].Data["phantom"] != true {
		t.Fatalf("phases: %v", events)
	}
	vampNear(t, "source hp", done.Summary.SourceFinalHp, 25)
}

func TestVampExecuteDoesNotGenerateVamp(t *testing.T) {
	c, r := vampFixture(t)
	vampOpenScenario(&c, &r)
	vampSetHP(&r, 1, 10, 1000)
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: model.OperationKindExecuteThreshold, Target: "target", Threshold: .2}}
	done := c1Run(t, c, r)
	if len(vampEvents(done)) != 0 {
		t.Fatal("execute produced vamp")
	}
	vampNear(t, "source hp", done.Summary.SourceFinalHp, 10)
}

func TestVampDirectHealCoexistsWithoutRecursiveVamp(t *testing.T) {
	c, r := vampFixture(t)
	vampOpenScenario(&c, &r)
	c.SharedProviders[0].Modifiers = []model.ModifierDefinition{{ModifierKey: "direct_only", Kind: "pipeline", Command: "heal", HealDirection: model.HealDone, HealCategory: model.HealDirect, HealGroupKey: "direct", ValuePolicy: "add_percent", Value: *vampValue(.5)}}
	c.SharedProviders[0].Abilities[0].Operations = append(c.SharedProviders[0].Abilities[0].Operations, model.OperationDefinition{Operation: "heal", Target: "source", Amount: vampValue(10)})
	done := c1Run(t, c, r)
	if len(vampEvents(done)) != 1 {
		t.Fatal("direct heal produced extra vamp")
	}
	vampNear(t, "source hp", done.Summary.SourceFinalHp, 35)
}

func TestVampPhantomUsesOriginalQualificationAndCurrentRatio(t *testing.T) {
	c, r := vampFixture(t)
	vampOpenScenario(&c, &r)
	c.SharedProviders[0].Abilities[0].Types = []string{"ability/summoner"}
	op := &c.SharedProviders[0].Abilities[0].Operations[0]
	op.Types = []string{"damage_trait/delivery_skill", "damage_trait/origin_reflected"}
	op.VampOverrides = []model.VampOverrideDefinition{{VampType: model.VampOmnivamp, Mode: model.VampOverride, BasisOutputKind: model.VampPostDefense, Efficiency: vampValue(.5)}}
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatalf("compile: %+v", compiled.Result.Errors)
	}
	s, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	dmg := copyableDamageFrozen{rawAmount: 100, damageType: "damage/physical", sourceKey: "source", targetKey: "target", originRef: r.DriverPlan.Entries[0].AbilityRef, providerRef: "champion", operationRef: "sample_hit", ability: compiled.Session.Abilities[0], operation: compiled.Session.Operations[0], eventSourceKey: "source", eventTargetKey: "target", entrySourceAttrs: cloneAttributeMap(s.combatants["source"].attributes), entryTargetAttrs: cloneAttributeMap(s.combatants["target"].attributes), castInstanceID: 7}
	collector := &eventCopyableCollector{}
	if err := s.applyPhantomCopyableDamage(collector, dmg, "sample_copy"); err != nil {
		t.Fatal(err)
	}
	source := s.combatants["source"]
	ratio := source.attributes["omnivamp_percent"]
	ratio.Base, ratio.Resolved = .4, .4
	source.attributes["omnivamp_percent"] = ratio
	s.combatants["source"] = source
	if err := s.applyPhantomCopyableDamage(collector, dmg, "sample_copy"); err != nil {
		t.Fatal(err)
	}
	events := vampEvents(s.buildDoneResult())
	if len(events) != 2 {
		t.Fatalf("events=%d", len(events))
	}
	vampAmount(t, events[0].Data, "actualHealing", 5)
	vampAmount(t, events[1].Data, "actualHealing", 10)
	for _, e := range events {
		if e.Data["phantom"] != true || e.Data["castInstanceId"] != float64(7) {
			t.Fatalf("lost provenance: %v", e.Data)
		}
	}
}
