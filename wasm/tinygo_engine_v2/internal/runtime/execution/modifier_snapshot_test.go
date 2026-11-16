package execution

import (
	reflect "reflect"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
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

func TestModifierSnapshotQueueFailureDoesNotInstallEitherSide(t *testing.T) {
	c, r := snapshotAttributeInput(t, 100, true)
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	s, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	s.loop.SetQueueLimit(1)
	if err = s.runLoop(); err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents {
		t.Fatal(err)
	}
	if s.combatants["source"].attributesView().At("move_speed").Resolved != 300 || s.combatants["target"].attributesView().At("move_speed").Resolved != 400 {
		t.Fatal("failed snapshot group leaked an attribute")
	}
}

func TestModifierSnapshotOrdinaryDriverCannotRefreshAnActualInstance(t *testing.T) {
	for _, actor := range []string{"source", "target"} {
		t.Run(actor, func(t *testing.T) {
			c, r := snapshotAttributeInput(t, 100, false)
			done := runSkillHit(t, c, r)
			instanceRef := ""
			for _, provider := range done.FinalSnapshot.Combatants[1].Providers {
				if provider.DefinitionRef == "snapshot_armor" {
					instanceRef = provider.ProviderRef
				}
			}
			if instanceRef == "" {
				t.Fatal("actual hit did not install snapshot instance")
			}
			c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "foreign_refresh", Kind: "active", Operations: []model.OperationDefinition{{Operation: "refresh_provider", Target: "target", ProviderRef: instanceRef}}})
			r.InitialSnapshot, r.SkillUses, r.SkillHitFacts = done.FinalSnapshot, nil, nil
			r.InitialSnapshot.Combatants[1].Attributes["move_speed"] = authoringSlot(800)
			r.StopPolicy.DurationMs = 1
			r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "foreign_refresh", AbilityRef: "source.provider[champion:source_demo].ability[foreign_refresh]", Source: actor, Target: "target", FirstAtMs: 100}}
			compiled := compile.CompileGeneric(c)
			if !compiled.OK {
				t.Fatal(compiled.Result.Errors)
			}
			s, err := newGenericRunState(compiled.Session, r)
			if err != nil {
				t.Fatal(err)
			}
			before := s.buildDoneResult(false).FinalSnapshot
			if err = s.runLoop(); err == nil {
				t.Fatal("ordinary refresh resampled an actual hit instance")
			}
			if !reflect.DeepEqual(before, s.buildDoneResult(false).FinalSnapshot) {
				t.Fatal("rejected refresh changed the snapshot group")
			}
		})
	}
}

func selfSnapshotFrameInput(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := snapshotAttributeInput(t, 100, false)
	c.SharedProviders[0].SkillKey = "author:q"
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "snapshot_armor"}}
	for i := range c.SharedProviders {
		if c.SharedProviders[i].ProviderKey != "snapshot_armor" {
			continue
		}
		c.SharedProviders[i].SkillKey = "author:q"
		c.SharedProviders[i].Modifiers = []model.ModifierDefinition{
			{ModifierKey: "speed", Kind: "attribute", Target: "self.attr.move_speed", ValuePolicy: "add", ValueReadMode: "APPLICATION_SNAPSHOT", Value: gfConst(20)},
			{ModifierKey: "armor", Kind: "attribute", Target: "self.attr.armor", ValuePolicy: "add", ValueReadMode: "APPLICATION_SNAPSHOT", Value: model.GenericFormulaExpr{Op: "mul", Args: []model.GenericFormulaExpr{gfConst(.5), authoringRead("source.attr.move_speed.resolved")}}},
		}
	}
	r.SkillUses, r.SkillHitFacts = nil, nil
	return c, r
}

func TestSelfModifierSnapshotFrameFailureDoesNotPublishPartialGroup(t *testing.T) {
	for _, mode := range []string{"queue", "invalid_later_amount"} {
		t.Run(mode, func(t *testing.T) {
			c, r := selfSnapshotFrameInput(t)
			if mode == "queue" {
				var second model.ProviderDefinition
				for _, provider := range c.SharedProviders {
					if provider.ProviderKey == "snapshot_armor" {
						second = provider
					}
				}
				second.ProviderKey, second.StableID = "self_second", "self_second"
				c.SharedProviders = append(c.SharedProviders, second)
				c.SharedProviders[0].Abilities[0].Operations = append(c.SharedProviders[0].Abilities[0].Operations, model.OperationDefinition{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: second.ProviderKey})
			} else {
				for i := range c.SharedProviders {
					if c.SharedProviders[i].ProviderKey == "snapshot_armor" {
						c.SharedProviders[i].Modifiers[1].Value = model.GenericFormulaExpr{Op: "mul", Args: []model.GenericFormulaExpr{gfConst(-1), authoringRead("source.attr.move_speed.resolved")}}
					}
				}
			}
			compiled := compile.CompileGeneric(c)
			if !compiled.OK {
				t.Fatal(compiled.Result.Errors)
			}
			s, err := newGenericRunState(compiled.Session, r)
			if err != nil {
				t.Fatal(err)
			}
			if mode == "queue" {
				s.loop.SetQueueLimit(1)
			}
			if err = s.runLoop(); err == nil {
				t.Fatal("accepted failing self snapshot frame", mode)
			}
			if mode == "queue" && err.BudgetCause != model.BudgetCauseMaxQueueEvents {
				t.Fatal("wrong queue failure", err)
			}
			if s.combatants["source"].attributesView().At("move_speed").Resolved != 300 || s.combatants["source"].attributesView().At("armor").Resolved != 0 {
				t.Fatal("failed self snapshot frame published part of a group", mode)
			}
			for _, actor := range s.buildDoneResult(false).FinalSnapshot.Combatants {
				for _, provider := range actor.Providers {
					if provider.DefinitionRef == "snapshot_armor" || provider.DefinitionRef == "self_second" {
						t.Fatal("failed self snapshot frame leaked an instance", mode)
					}
				}
			}
		})
	}
}

func TestSelfModifierSnapshotRejectsInstanceRefreshWithoutMutation(t *testing.T) {
	c, r := selfSnapshotFrameInput(t)
	done := runSkillHit(t, c, r)
	actualRef := ""
	for _, p := range done.FinalSnapshot.Combatants[0].Providers {
		if p.DefinitionRef == "snapshot_armor" {
			actualRef = p.ProviderRef
		}
	}
	if actualRef == "" {
		t.Fatal("self snapshot application missing")
	}
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "foreign_refresh", Kind: "active", Operations: []model.OperationDefinition{{Operation: "refresh_provider", Target: "self", ProviderRef: actualRef}}})
	r.InitialSnapshot, r.StopPolicy.DurationMs = done.FinalSnapshot, 1
	r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "foreign_refresh", AbilityRef: "source.provider[champion:source_demo].ability[foreign_refresh]", Source: "source", Target: "target", FirstAtMs: 100}}
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	s, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	before := s.buildDoneResult(false).FinalSnapshot
	if err = s.runLoop(); err == nil {
		t.Fatal("instance reference silently resampled a self snapshot")
	}
	if !reflect.DeepEqual(before, s.buildDoneResult(false).FinalSnapshot) {
		t.Fatal("rejected instance refresh changed a frozen group")
	}
}
