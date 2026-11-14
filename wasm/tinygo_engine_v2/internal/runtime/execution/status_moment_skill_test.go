package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

// One actual delayed contact owns damage and both independent control instances.
// The optional real basic attack plan stays active through the quiet slow phase.
func momentSlowSkillInput(t *testing.T, endpoint int64, mixed bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := singleSkillInput(false)
	index := 0
	r.DriverPlan.SkillActions[0].FirstAtMs = 0
	if mixed {
		c, r = continuousAttackInput(1, 10000, 10, 0, 0, endpoint)
		addMixedSpell(&c, &r, "delayed_control", 0, 1125, true)
		index = len(c.SharedProviders) - 1
	}
	provider := &c.SharedProviders[index]
	provider.Processes[0].Steps = []model.ProcessStepDefinition{
		{StepKey: "cast", StepType: "DELAY", DelayMs: statusDuration(500), OccupiesAction: model.BoolPtr(true)},
		{StepKey: "travel", StepType: "DELAY", DelayMs: statusDuration(625), OccupiesAction: model.BoolPtr(false)},
	}
	provider.Processes[0].Cooldown.DurationMs = statusConst(6000)
	provider.Processes[0].Cooldown.StartMoment = model.ProcessMomentDefinition{MomentType: "PROCESS_START"}
	damage := damageCand("damage", "one_contact", "damage", model.SpellShieldScopeSkill, 0)
	damage.Operations[0].DamageType, damage.Operations[0].Amount = "damage/magic", statusDuration(80)
	airborne := stunCand("airborne", "one_contact", "airborne", model.SpellShieldScopeSkill)
	airborne.Semantic.StatusKey, airborne.Semantic.StatusKind = "airborne", model.StatusKindAirborne
	airborne.Semantic.Moment, airborne.SpellShieldBlockScope = model.SkillHitMomentPersistent, hitScope(model.SpellShieldScopeResult)
	airborne.Operations[0].ProviderDefinitionRef = "airborne"
	slow := stunCand("slow", "one_contact", "slow", model.SpellShieldScopeSkill)
	slow.Semantic.StatusKey, slow.Semantic.StatusKind = "landing", model.StatusKindMovementSlow
	slow.Semantic.Moment, slow.SpellShieldBlockScope = model.SkillHitMomentPersistent, hitScope(model.SpellShieldScopeResult)
	slow.Operations[0].ProviderDefinitionRef = "landing_slow"
	provider.Abilities[1].Operations[0].SkillHit.Candidates = []model.SkillHitCandidate{damage, airborne, slow}
	airborneProvider := stunProvider()
	airborneProvider.ProviderKey, airborneProvider.StableID = "airborne", "airborne"
	airborneProvider.Types = []string{model.ClosedStatusKindProviderType[model.StatusKindAirborne]}
	slowProvider := momentSlowProvider()
	slowProvider.SkillKey = provider.Processes[0].SkillKey
	c.SharedProviders = append(c.SharedProviders, airborneProvider, slowProvider)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "damage/magic", Domain: "damage"}, model.TypeCatalogEntry{Key: airborneProvider.Types[0], Domain: "provider"}, model.TypeCatalogEntry{Key: "status/airborne", Domain: "status"})
	formuladefinition.SetDamageFormula(&c, "damage/magic", formuladefinition.ConstantDefense("1"))
	r.StopPolicy.DurationMs = endpoint
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	r.Sampling.Disabled = true
	return c, r
}
