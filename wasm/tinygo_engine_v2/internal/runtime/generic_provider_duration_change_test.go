package runtime

import (
	"reflect"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
	"tinygo_engine_v2/internal/status"
)

func providerDurationInput(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := timedShieldLoad(t)
	for _, attributes := range []map[string]model.AttributeSlotDef{c.Combatants[0].Attributes, r.InitialSnapshot.Combatants[0].Attributes} {
		attributes["attack_damage"] = authoringSlot(100)
	}
	for _, attributes := range []map[string]model.AttributeSlotDef{c.Combatants[1].Attributes, r.InitialSnapshot.Combatants[1].Attributes} {
		attributes["hp"] = authoringSlot(10000)
	}
	parent := &c.SharedProviders[0]
	parent.SkillKey = "clock_skill"
	parent.Abilities = []model.AbilityDefinition{
		timedShieldAbility("apply", []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "attribute_window"}}),
		timedShieldAbility("ensure", []model.OperationDefinition{{Operation: "provider_duration_change", Target: "self", ProviderDefinitionRef: "attribute_window", ValuePolicy: "ensure_remaining", Amount: timedShieldExpr(2500)}}),
		timedShieldAbility("other_bonus", []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "other_window"}}),
		timedShieldAbility("sample", []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: authoringAmount(authoringRead("source.attr.attack_damage.resolved"))}}),
	}
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "attribute_window", SkillKey: "clock_skill", StableID: "attribute_window", Kind: "status",
		Lifecycle: &model.ProviderLifecycle{DurationMs: timedShieldExpr(3000), MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: model.InstanceScopeSourceTarget},
		Modifiers: []model.ModifierDefinition{
			{ModifierKey: "flat", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "add", Value: authoringConst(10)},
			{ModifierKey: "total", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "multiply", Stage: "total", Value: authoringConst(1.25)},
		}})
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "other_window", SkillKey: "clock_skill", StableID: "other_window", Kind: "status",
		Lifecycle: &model.ProviderLifecycle{DurationMs: timedShieldExpr(1000), MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: model.InstanceScopeSourceTarget},
		Modifiers: []model.ModifierDefinition{{ModifierKey: "other", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "add", Value: authoringConst(20)}}})
	r.DriverPlan.Entries = []model.DriverEntry{}
	r.StopPolicy.DurationMs = 5100
	return c, r
}

func durationInstance(t *testing.T, s *genericRunState) status.ProviderInstance {
	t.Helper()
	for _, instance := range s.combatants["source"].providers {
		if instance.DefinitionRef == "attribute_window" {
			return instance
		}
	}
	t.Fatal("missing applied attribute window")
	return status.ProviderInstance{}
}

func TestProviderEnsureRemainingUsesMaximumAndKeepsDynamicAttributeTotal(t *testing.T) {
	c, r := providerDurationInput(t)
	for i, row := range []struct {
		ability string
		at      int64
	}{{"apply", 0}, {"sample", 0}, {"ensure", 1000}, {"other_bonus", 1500}, {"sample", 1500}, {"ensure", 2000}, {"sample", 2500}, {"sample", 3000}, {"sample", 4499}, {"sample", 4500}, {"ensure", 5000}, {"sample", 5001}} {
		r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{EntryKey: row.ability + itoa(uint32(i)), AbilityRef: timedShieldRef(row.ability), Source: "source", Target: "target", FirstAtMs: row.at, Priority: i})
	}
	compiled := authoringCompile(t, c)
	done, err := RunGeneric(compiled, r)
	if err != nil {
		t.Fatal(err)
	}
	amounts := []float64{}
	deadlines := []float64{}
	for _, evidence := range done.Evidence.Items {
		if evidence.Kind == model.EvidenceKindDamage {
			amounts = append(amounts, evidence.Data["mitigatedAmount"].(float64))
		}
		if evidence.Kind == model.EvidenceKindProviderDurationChange {
			deadline, ok := evidence.Data["expireAt"].(int64)
			if !ok {
				t.Fatal("missing deadline evidence", evidence)
			}
			deadlines = append(deadlines, float64(deadline))
		}
	}
	if !reflect.DeepEqual(amounts, []float64{137.5, 162.5, 137.5, 137.5, 137.5, 100, 100}) {
		t.Fatal("own total multiplier must read current other AD and stop at 4500ms", amounts)
	}
	if !reflect.DeepEqual(deadlines, []float64{3500, 4500}) {
		t.Fatal("ensure is maximum remaining duration, not additive extension", deadlines, done.Evidence)
	}
	again, err := RunGeneric(compiled, r)
	if err != nil || !reflect.DeepEqual(done, again) {
		t.Fatal("same-session replay inherited provider deadlines", err)
	}
}

func TestProviderEnsureRemainingPreservesIdentityAndRollsBackQueueFailure(t *testing.T) {
	c, r := providerDurationInput(t)
	s := frameCommitState(t, c, r)
	linkedShieldExecute(t, s, "apply", "source", "target")
	original := durationInstance(t, s)
	s.nowMs = 1000
	linkedShieldExecute(t, s, "ensure", "source", "target")
	after := durationInstance(t, s)
	if after.ExpireAt != 3500 || after.ProviderRef != original.ProviderRef || after.Stacks != original.Stacks || after.AppliedAtMs != original.AppliedAtMs || after.HasAppliedAt != original.HasAppliedAt || after.ActivationUseRef != original.ActivationUseRef {
		t.Fatal("ensure reapplied the existing instance", original, after)
	}
	s.nowMs = 2000
	s.heap = scheduler.NewGenericHeap(1)
	s.heap.SetLimit(1)
	s.heap.Push(scheduler.GenericEvent{Kind: scheduler.GenericEventSample, TimeMs: 5000})
	ability, ref, _ := s.lookupDriverAbility(model.DriverEntry{AbilityRef: timedShieldRef("ensure"), Source: "source", Target: "target"})
	frame := s.newExecutionFrame("source", "target", ref)
	frame.ownerCombatantKey, frame.ownerProviderRef = "source", "champion:source_demo"
	if err := frame.executeOperations(ability, s.compiled.Operations[int(ability.OperationStart):int(ability.OperationStart)+int(ability.OperationCount)]); err != nil {
		t.Fatal(err)
	}
	frame.commit()
	if !frame.fatal || frame.fatalErr == nil || frame.fatalErr.BudgetCause != model.BudgetCauseMaxQueueEvents || !reflect.DeepEqual(after, durationInstance(t, s)) {
		t.Fatal("queue failure committed a partial provider deadline", frame.fatalErr, durationInstance(t, s))
	}
}

func TestProviderEnsureRemainingMissingActiveAndZeroAreNoOps(t *testing.T) {
	for _, mode := range []string{"not_applied", "zero", "expired"} {
		t.Run(mode, func(t *testing.T) {
			c, r := providerDurationInput(t)
			if mode == "zero" {
				c.SharedProviders[0].Abilities[1].Operations[0].Amount = timedShieldExpr(0)
			}
			s := frameCommitState(t, c, r)
			if mode != "not_applied" {
				linkedShieldExecute(t, s, "apply", "source", "target")
			}
			s.nowMs = 1000
			if mode == "expired" {
				s.nowMs = 3000
			}
			before := s.buildDoneResult().FinalSnapshot
			linkedShieldExecute(t, s, "ensure", "source", "target")
			if after := s.buildDoneResult().FinalSnapshot; !reflect.DeepEqual(before, after) {
				t.Fatal("inactive or zero ensure mutated the provider", before, after)
			}
		})
	}
}

func TestProviderEnsureRemainingRejectsUnsafeAmountsAndSharedApplyingMounts(t *testing.T) {
	for _, mode := range []string{"negative", "fractional", "unsafe", "dynamic", "foreign_skill", "double_mount", "hp", "no_duration", "overflow"} {
		t.Run(mode, func(t *testing.T) {
			c, r := providerDurationInput(t)
			switch mode {
			case "negative":
				c.SharedProviders[0].Abilities[1].Operations[0].Amount = timedShieldExpr(-1)
			case "fractional":
				c.SharedProviders[0].Abilities[1].Operations[0].Amount = timedShieldExpr(.5)
			case "unsafe":
				c.SharedProviders[0].Abilities[1].Operations[0].Amount = timedShieldExpr(9007199254740992)
			case "dynamic":
				c.SharedProviders[0].Abilities[1].Operations[0].Amount = authoringAmount(authoringRead("source.attr.hp.current"))
			case "foreign_skill":
				c.SharedProviders[1].SkillKey = "foreign"
			case "double_mount":
				c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "other_mount", DefinitionRef: c.SharedProviders[0].ProviderKey})
			case "hp":
				c.SharedProviders[1].Modifiers[0].Target = "self.attr.hp"
			case "no_duration":
				c.SharedProviders[1].Lifecycle.DurationMs = nil
			case "overflow":
				c.SharedProviders[0].Abilities[1].Operations[0].Amount = timedShieldExpr(9007199254740991)
				r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "overflow", AbilityRef: timedShieldRef("ensure"), Source: "source", Target: "target", FirstAtMs: 10}}
			}
			result := compilebundle.CompileGeneric(c)
			if !result.OK {
				return
			}
			if mode != "overflow" {
				t.Fatal("invalid duration operation compiled", mode)
			}
			if _, err := RunGeneric(result.Session, r); err == nil {
				t.Fatal("deadline overflow was accepted")
			}
		})
	}
}
