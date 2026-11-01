package execution

import (
	reflect "reflect"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func coldHealthExpiryInput(t *testing.T, endpoint int64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := coldHealthMomentInput(t, endpoint, false)
	parent := &c.SharedProviders[len(c.SharedProviders)-2]
	hit := parent.Abilities[1].Operations[0].SkillHit
	airborne := stunCand("airborne", "single_contact", "airborne", "")
	airborne.Semantic.StatusKey, airborne.Semantic.StatusKind = "airborne", model.StatusKindAirborne
	airborne.Semantic.Moment = model.SkillHitMomentPersistent
	airborne.Operations[0].ProviderDefinitionRef = "cleanup_airborne"
	hit.Candidates = []model.SkillHitCandidate{hit.Candidates[0], airborne, hit.Candidates[1]}
	hit.RuleGroups = []model.SkillHitRuleGroup{
		hitRule("damage", "damage", model.OncePerUseScopeProviderTarget, hit.Candidates[0].CandidateKey),
		hitRule("control", "control", model.OncePerUseScopeProviderTarget, "airborne", "slow"),
	}
	definition := stunProvider()
	definition.ProviderKey, definition.StableID = "cleanup_airborne", "cleanup_airborne"
	definition.Types = []string{model.ClosedStatusKindProviderType[model.StatusKindAirborne]}
	c.SharedProviders = append(c.SharedProviders, definition)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: definition.Types[0], Domain: "provider"})
	return c, r
}

func TestBasicAttackWaitPreviewKeepsParentLifecycleMutations(t *testing.T) {
	c, r := coldHealthExpiryInput(t, 4000)
	s := frameCommitState(t, c, r)
	s.loop.Advance(100)
	if err := s.applyProviderInstance("target", "source", "landing_slow", 2600, true, effectpkg.StatusContributions([]effectpkg.StatusContribution{{ResultRef: "slow", StatusKey: "landing", StatusKind: model.StatusKindMovementSlow}})); err != nil {
		t.Fatal(err)
	}
	var ref string
	for instanceIndex, instanceValues := 0, s.combatants["target"].instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		instance := instanceValues.At(instanceIndex)
		if instance.DefinitionRef == "landing_slow" {
			ref = instance.ProviderRef
		}
	}
	s.loop.Advance(2600)
	frame := s.newExecutionFrame("source", "target", "real_expiry")
	parent := frame.stageFor("target")
	parent.providerOps = []stagedProviderMutation{{kind: "expire", targetKey: "target", providerRef: ref, evidenceKind: model.EvidenceKindProviderExpire}}
	mutationsBefore := append([]stagedProviderMutation(nil), parent.providerOps...)
	providersBefore := mustJSON(effectpkg.ProvidersToSnapshot(parent.instances.Providers()))
	evidenceBefore := len(s.report.Snapshot().Evidence.Items)
	var preview Frame
	if err := frame.basicAttackWaitContext(&preview); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(parent.providerOps, mutationsBefore) {
		t.Fatal("waiting preview changed the real cleanup command", mutationsBefore, parent.providerOps)
	}
	assertProviderListSnapshot(t, parent.instances.Providers(), providersBefore)
	assertProviderListSnapshot(t, s.combatants["target"].instances.Providers(), providersBefore)
	if _, _, present := preview.stageFor("target").instances.Providers().Find(ref); present || len(s.report.Snapshot().Evidence.Items) != evidenceBefore {
		t.Fatal("waiting preview failed to remove its private instance or published evidence")
	}
	frame.commit()
	if frame.fatal || !frame.committed {
		t.Fatal("real cleanup did not commit", frame.fatalErr)
	}
	if _, _, present := s.combatants["target"].instances.Providers().Find(ref); present || s.report.Snapshot().Evidence.CountsByKind[string(model.EvidenceKindProviderExpire)] != 1 {
		t.Fatal("preview suppressed real removal or its lifecycle fact", s.combatants["target"].instances.Providers(), s.report.Snapshot().Evidence.CountsByKind)
	}
	assertProviderListSnapshot(t, parent.instances.Providers(), providersBefore)
}
