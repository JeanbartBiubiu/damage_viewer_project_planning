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
