package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	scheduler "tinygo_engine_v2/internal/scheduler"
)

func coldHealthMomentInput(t *testing.T, endpoint int64, lethal bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := permanentResourceMaxInput(t, 655, 160)
	setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Max: 1160, Resolved: 1160, Current: 1160})
	addPermanentSkillSource(&c, &r, 1, "target_cold_health", "character", model.ModifierDefinition{ModifierKey: "permanent_hp", Kind: "resource_max", Target: "self.attr.hp", ValuePolicy: "add", Value: authoringConst(160), CurrentValuePolicy: "preserve_initial_current"})
	for i := len(c.SharedProviders) - 2; i < len(c.SharedProviders); i++ {
		c.SharedProviders[i].SkillKey = "target_cold_health"
	}
	addMixedSpell(&c, &r, "elapsed_control", 0, 1125, false)
	parent := &c.SharedProviders[len(c.SharedProviders)-1]
	slow := stunCand("slow", "single_contact", "slow", "")
	slow.Semantic.StatusKey, slow.Semantic.StatusKind, slow.Semantic.Moment = "landing", model.StatusKindMovementSlow, model.SkillHitMomentPersistent
	slow.Operations[0].ProviderDefinitionRef = "landing_slow"
	parent.Abilities[1].Operations[0].SkillHit.Candidates = append(parent.Abilities[1].Operations[0].SkillHit.Candidates, slow)
	if lethal {
		parent.Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = hitConstAmt(2000)
	}
	c.SharedProviders = append(c.SharedProviders, momentSlowProvider())
	r.StopPolicy.DurationMs = endpoint
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	r.StopPolicy.StopOnTargetDeath = model.BoolPtr(true)
	r.Sampling.Disabled = true
	return c, r
}

func TestResourceMaxMomentLiveProviderRebuildPreservesColdCurrent(t *testing.T) {
	c, r := coldHealthMomentInput(t, 4000, false)
	s := frameCommitState(t, c, r)
	// Run actual source initializers before isolating each existing provider
	// rebuild contact. Initial capacity validation still used the raw full Max.
	for _, key := range []string{"source", "target"} {
		if err := s.handleSourceInitialized(scheduler.GenericEvent{ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: key}}); err != nil {
			t.Fatal(err)
		}
	}
	apply := func(now int64) {
		s.loop.Advance(now)
		var frame Frame
		s.initExecutionFrame(&frame, "source", "target", "real_control")
		if err := frame.executeOperations(planbundle.CompiledAbility{}, []planbundle.CompiledOperation{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "landing_slow"}}); err != nil {
			t.Fatal(err)
		}
		frame.commit()
		if frame.fatal {
			t.Fatal(frame.fatalErr)
		}
	}
	check := func() {
		for _, key := range []string{"source", "target"} {
			hp := s.combatants[key].attributesView().At("hp")
			if hp.Resolved != hp.Current {
				t.Fatal("provider lifecycle rebuilt HP from Base", key, hp)
			}
		}
	}
	apply(100)
	check()
	apply(200)
	check()
	s.refreshProviderAwareAttributes("source", "target")
	check()
	var ref string
	for instanceIndex, instanceValues := 0, s.combatants["target"].instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		provider := instanceValues.At(instanceIndex)
		if provider.DefinitionRef == "landing_slow" {
			ref = provider.ProviderRef
		}
	}
	s.expireProviderInstance("target", ref, s.evalContextForCombatants("source", "target"))
	check()
	apply(300)
	check()
	s.loop.Advance(2800)
	s.sweepExpiredInstances()
	check()
	if s.resourceSummaryOutput().ChangeCount != 0 || s.combatants["source"].attributesView().At("hp").Max != 1310 || s.combatants["target"].attributesView().At("hp").Max != 1160 {
		t.Fatal("status reconstruction rewrote capacity", s.resourceSummaryOutput())
	}
}
