// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func selfModifierSnapshotInput(t *testing.T, duration int64, refresh bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := withSkillHit(t, nil, nil, nil, nil, nil, nil, duration)
	c.SharedProviders[0].SkillKey = "author:snapshot"
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{{AbilityKey: "skill_hit", Kind: "active", Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "self_snapshot"}}}}
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{
		ProviderKey: "self_snapshot", StableID: "self_snapshot", SkillKey: "author:snapshot", Kind: "status",
		Lifecycle: &model.ProviderLifecycle{DurationMs: hitConstAmt(2000), MaxStacks: 1, RefreshPolicy: model.RefreshPolicyReplace, InstanceScope: model.InstanceScopeSourceTarget},
		Modifiers: []model.ModifierDefinition{
			{ModifierKey: "ad", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "add", ValueReadMode: "APPLICATION_SNAPSHOT", Value: authoringConst(20)},
			{ModifierKey: "armor", Kind: "attribute", Target: "self.attr.armor", ValuePolicy: "add", ValueReadMode: "APPLICATION_SNAPSHOT", Value: authoringBinary("mul", authoringConst(.5), authoringRead("source.attr.attack_damage.resolved"))},
			{ModifierKey: "magic", Kind: "attribute", Target: "self.attr.magic_resist", ValuePolicy: "add", ValueReadMode: "APPLICATION_SNAPSHOT", Value: authoringBinary("mul", authoringConst(.3), authoringRead("source.attr.attack_damage.resolved"))},
		},
	})
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "attack_damage", Domain: "attribute"}, model.TypeCatalogEntry{Key: "armor", Domain: "attribute"}, model.TypeCatalogEntry{Key: "magic_resist", Domain: "attribute"})
	for _, side := range []string{"source", "target"} {
		setCombatantAttr(&c, &r, side, "attack_damage", authoringSlot(100))
		setCombatantAttr(&c, &r, side, "armor", authoringSlot(10))
		setCombatantAttr(&c, &r, side, "magic_resist", authoringSlot(20))
	}
	r.DriverPlan.Entries = []model.DriverEntry{hitEntry("apply", 0, 0)}
	if refresh {
		r.DriverPlan.Entries = append(r.DriverPlan.Entries, hitEntry("reapply", 1000, 0))
	}
	return c, r
}

func selfModifierSnapshotDefinition(t *testing.T, c *model.CompileRequest) *model.ProviderDefinition {
	t.Helper()
	for i := range c.SharedProviders {
		if c.SharedProviders[i].ProviderKey == "self_snapshot" {
			return &c.SharedProviders[i]
		}
	}
	t.Fatal("missing self snapshot definition")
	return nil
}

func selfModifierSnapshotInstance(t *testing.T, snapshot *model.Snapshot) *model.CombatantProviderSnapshot {
	t.Helper()
	for i := range snapshot.Combatants {
		for j := range snapshot.Combatants[i].Providers {
			if snapshot.Combatants[i].Providers[j].DefinitionRef == "self_snapshot" {
				return &snapshot.Combatants[i].Providers[j]
			}
		}
	}
	t.Fatal("missing actual self snapshot instance")
	return nil
}

func TestSelfModifierSnapshotGroupReadsOnePreApplicationState(t *testing.T) {
	for _, reversed := range []bool{false, true} {
		c, r := selfModifierSnapshotInput(t, 100, false)
		if reversed {
			p := selfModifierSnapshotDefinition(t, &c)
			p.Modifiers[0], p.Modifiers[2] = p.Modifiers[2], p.Modifiers[0]
		}
		done := runSkillHit(t, c, r)
		for key, expected := range map[string]float64{"attack_damage": 100 + 20, "armor": 10 + 100*.5, "magic_resist": 20 + 100*.3} {
			if actual := snapshotAttribute(t, done, "source", key); actual != expected {
				t.Fatalf("result order=%v %s: got %v want %v", reversed, key, actual, expected)
			}
		}
		p := selfModifierSnapshotInstance(t, &done.FinalSnapshot)
		if p.Source != "source" || p.Owner != "source" || !reflect.DeepEqual(p.ModifierSnapshots, model.ModifierSnapshotValues{"ad": 20, "armor": 100 * .5, "magic": 100 * .3}) {
			t.Fatalf("wrong group identity or frozen amounts: %+v", p)
		}
		if snapshotAttribute(t, done, "target", "armor") != 10 || snapshotAttribute(t, done, "target", "magic_resist") != 20 {
			t.Fatal("self application changed its opponent")
		}
	}
}

func TestSelfModifierSnapshotFreezesRefreshesAndExpiresAsOneGroup(t *testing.T) {
	for _, row := range []struct {
		end     int64
		refresh bool
		armor   float64
		magic   float64
		ad      float64
	}{
		{1999, false, 10 + 100*.5, 20 + 100*.3, 120},
		{2000, false, 10, 20, 100},
		{2000, true, 10 + 120*.5, 20 + 120*.3, 120},
		{2999, true, 10 + 120*.5, 20 + 120*.3, 120},
		{3000, true, 10, 20, 100},
	} {
		c, r := selfModifierSnapshotInput(t, row.end, row.refresh)
		done := runSkillHit(t, c, r)
		if snapshotAttribute(t, done, "source", "armor") != row.armor || snapshotAttribute(t, done, "source", "magic_resist") != row.magic || snapshotAttribute(t, done, "source", "attack_damage") != row.ad {
			t.Fatalf("expiry/refresh end=%d refresh=%v: %+v", row.end, row.refresh, done.FinalSnapshot)
		}
		count := 0
		for _, p := range done.FinalSnapshot.Combatants[0].Providers {
			if p.DefinitionRef == "self_snapshot" {
				count++
				if p.ExpireAt == nil || *p.ExpireAt != 3000 || p.Stacks != 1 {
					if row.refresh {
						t.Fatalf("reapplication did not replace one complete instance: %+v", p)
					}
				}
			}
		}
		if row.end == 2000 && !row.refresh || row.end == 3000 {
			if count != 0 {
				t.Fatal("expired self snapshot instance survived")
			}
		} else if count != 1 {
			t.Fatalf("self snapshot group split or duplicated: %d", count)
		}
	}
}

func TestSelfModifierSnapshotRestoreKeepsFrozenAmountsAndZero(t *testing.T) {
	for _, ad := range []float64{0, 100} {
		c, r := selfModifierSnapshotInput(t, 100, false)
		setCombatantAttr(&c, &r, "source", "attack_damage", authoringSlot(ad))
		done := runSkillHit(t, c, r)
		encoded, err := json.Marshal(done.FinalSnapshot)
		if err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(encoded, &r.InitialSnapshot); err != nil {
			t.Fatal(err)
		}
		p := selfModifierSnapshotInstance(t, &r.InitialSnapshot)
		if value, present := p.ModifierSnapshots["armor"]; !present || value != ad*.5 {
			t.Fatal("valid zero disappeared in JSON", p.ModifierSnapshots)
		}
		r.DriverPlan.Entries = nil
		r.StopPolicy.DurationMs = 1
		for i := range r.InitialSnapshot.Combatants {
			if r.InitialSnapshot.Combatants[i].Key == "source" {
				r.InitialSnapshot.Combatants[i].Attributes["attack_damage"] = authoringSlot(500)
			}
		}
		restored := runSkillHit(t, c, r)
		if snapshotAttribute(t, restored, "source", "armor") != 10+ad*.5 || snapshotAttribute(t, restored, "source", "magic_resist") != 20+ad*.3 || snapshotAttribute(t, restored, "source", "attack_damage") != 520 {
			t.Fatalf("restore recalculated frozen amounts for original AD %v: %+v", ad, restored.FinalSnapshot)
		}
	}
}

func TestSelfModifierSnapshotIgnoresLaterADChange(t *testing.T) {
	c, r := selfModifierSnapshotInput(t, 999, false)
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "later_ad", StableID: "later_ad", Kind: "status",
		Lifecycle: &model.ProviderLifecycle{DurationMs: hitConstAmt(1000), MaxStacks: 1, RefreshPolicy: model.RefreshPolicyReplace, InstanceScope: model.InstanceScopeSourceTarget},
		Modifiers: []model.ModifierDefinition{{ModifierKey: "extra_ad", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "add", Value: authoringConst(100)}}})
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "change_ad", Kind: "active", Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "later_ad"}}})
	r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{EntryKey: "change_ad", AbilityRef: "source.provider[champion:source_demo].ability[change_ad]", Source: "source", Target: "target", FirstAtMs: 500})
	done := runSkillHit(t, c, r)
	if snapshotAttribute(t, done, "source", "attack_damage") != 100+20+100 {
		t.Fatal("later AD change did not execute")
	}
	if snapshotAttribute(t, done, "source", "armor") != 10+100*.5 || snapshotAttribute(t, done, "source", "magic_resist") != 20+100*.3 {
		t.Fatal("frozen self attributes followed later AD changes", done.FinalSnapshot)
	}
}

func TestSelfModifierSnapshotUsesActualOwnerWhenSidesAreExchanged(t *testing.T) {
	c, r := selfModifierSnapshotInput(t, 100, false)
	c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "target_author", DefinitionRef: c.SharedProviders[0].ProviderKey})
	r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: "target_author", DefinitionRef: c.SharedProviders[0].ProviderKey, Source: "target", Owner: "target", Stacks: 1})
	r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "apply_target", AbilityRef: "target.provider[target_author].ability[skill_hit]", Source: "target", Target: "source", FirstAtMs: 0}}
	done := runSkillHit(t, c, r)
	p := selfModifierSnapshotInstance(t, &done.FinalSnapshot)
	if p.Source != "target" || p.Owner != "target" || snapshotAttribute(t, done, "target", "armor") != 60 || snapshotAttribute(t, done, "source", "armor") != 10 {
		t.Fatal("self snapshot used fixed source-side ownership", done.FinalSnapshot)
	}
}

func TestSelfModifierSnapshotRestoreRejectsMalformedAmountsAndOwners(t *testing.T) {
	for _, mode := range []string{"missing", "missing_key", "extra", "negative", "nonfinite", "foreign_source", "foreign_owner"} {
		t.Run(mode, func(t *testing.T) {
			c, r := selfModifierSnapshotInput(t, 100, false)
			done := runSkillHit(t, c, r)
			r.InitialSnapshot, r.DriverPlan.Entries, r.StopPolicy.DurationMs = done.FinalSnapshot, nil, 1
			p := selfModifierSnapshotInstance(t, &r.InitialSnapshot)
			switch mode {
			case "missing":
				p.ModifierSnapshots = nil
			case "missing_key":
				delete(p.ModifierSnapshots, "armor")
			case "extra":
				p.ModifierSnapshots["extra"] = 0
			case "negative":
				p.ModifierSnapshots["armor"] = -1
			case "nonfinite":
				p.ModifierSnapshots["armor"] = math.Inf(1)
			case "foreign_source":
				p.Source = "target"
			case "foreign_owner":
				p.Owner = "target"
			}
			compiled := compile.CompileGeneric(c)
			if !compiled.OK {
				t.Fatal(compiled.Result.Errors)
			}
			if _, err := runtimeengine.RunGeneric(compiled.Session, r); err == nil {
				t.Fatal("accepted malformed self snapshot", mode)
			}
		})
	}
}

func TestSelfModifierSnapshotRejectsForeignReadsAndApplications(t *testing.T) {
	for _, mode := range []string{"target_read", "hidden_target_read", "resource_read", "hp_read", "event_read", "state_read", "elapsed_read", "dynamic_parameter", "mixed_live", "ratio", "hp_target", "target_modifier", "condition", "initial_mount", "foreign_skill", "missing_skill", "foreign_apply", "global_apply"} {
		t.Run(mode, func(t *testing.T) {
			c, _ := selfModifierSnapshotInput(t, 100, false)
			p := selfModifierSnapshotDefinition(t, &c)
			switch mode {
			case "target_read":
				p.Modifiers[1].Value = authoringRead("target.attr.attack_damage.resolved")
			case "hidden_target_read":
				p.Modifiers[1].Value = model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringConst(1), authoringConst(2), authoringRead("target.attr.attack_damage.resolved")}}
			case "resource_read":
				p.Modifiers[1].Value = authoringRead("source.resource.mana.current")
			case "hp_read":
				p.Modifiers[1].Value = authoringRead("source.attr.hp.resolved")
			case "event_read":
				p.Modifiers[1].Value = authoringRead("event.damage.mitigatedAmount")
			case "state_read":
				p.Modifiers[1].Value = authoringRead("provider.state.stacks")
			case "elapsed_read":
				p.Modifiers[1].Value = authoringRead("provider.elapsed_ms")
			case "dynamic_parameter":
				p.Modifiers[1].Value = authoringRead("ability.param.rate")
			case "mixed_live":
				p.Modifiers[0].ValueReadMode = ""
			case "ratio":
				p.Modifiers[0].ValuePolicy, p.Modifiers[0].Stage = "multiply", "total"
			case "hp_target":
				p.Modifiers[0].Target = "self.attr.hp"
			case "target_modifier":
				p.Modifiers[0].Target = "opponent.attr.attack_damage"
			case "condition":
				p.Modifiers[0].Condition = authoringAmount(authoringConst(1))
			case "initial_mount":
				c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "invalid_initial", DefinitionRef: p.ProviderKey})
			case "foreign_skill":
				p.SkillKey = "another_skill"
			case "missing_skill":
				p.SkillKey = ""
			case "foreign_apply":
				c.SharedProviders[0].Abilities[0].Operations[0].Target = "target"
			case "global_apply":
				c.Rules.Operations = append(c.Rules.Operations, c.SharedProviders[0].Abilities[0].Operations[0])
			}
			if result := compile.CompileGeneric(c); result.OK {
				t.Fatal("accepted unsupported self snapshot graph", mode)
			}
		})
	}
}

func TestSelfModifierSnapshotNamedStaticParametersAndSummaryRemainEquivalent(t *testing.T) {
	c, r := selfModifierSnapshotInput(t, 100, false)
	p := selfModifierSnapshotDefinition(t, &c)
	c.Formulas = append(c.Formulas, formuladefinition.FromExpr("snapshot_static_ratio", p.SkillKey, authoringBinary("mul", authoringRead("source.attr.attack_damage.resolved"), authoringRead("ability.param.ratio")), map[string]float64{"ratio": .5}))
	p.Modifiers[1].Value = model.GenericFormulaExpr{Op: "ref", Ref: "snapshot_static_ratio"}
	full := runSkillHit(t, c, r)
	r.OutputMode = model.RunOutputSummary
	summary := runSkillHit(t, c, r)
	if !reflect.DeepEqual(full.FinalSnapshot, summary.FinalSnapshot) || snapshotAttribute(t, summary, "source", "armor") != 60 {
		t.Fatal("named static parameter or recording mode changed frozen amount")
	}
}
